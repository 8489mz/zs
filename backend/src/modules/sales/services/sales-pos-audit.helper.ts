import type { Logger } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import type { PosAuditEventDto } from '../dto/pos-audit-event.dto';
import {
  buildSnapshotAuditText,
  normalizeSnapshotItems,
  type AuditSnapshotItem,
} from '../engines/cashier-peer-benchmark.engine';
import type { SalesAuthorizationService } from './sales-authorization.service';
import type { CashierFraudRadarService } from './cashier-fraud-radar.service';

export interface PosAuditDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  authz: SalesAuthorizationService;
  fraudRadarService?: CashierFraudRadarService;
  logger: Logger;
}

export async function executeLogPosAuditEvent(
  deps: PosAuditDeps,
  payload: PosAuditEventDto,
  auth: AuthContext,
): Promise<Record<string, unknown>> {
  const scope = requireTenantScope(auth);
  const reason = String(payload.note || '').trim();
  const snapshotItems = normalizeSnapshotItems(payload.items);
  const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(deps.db, scope.tenantId));
  const antiTheft = await loadAntiTheftSettings(deps.db, scope.tenantId);

  const itemsTotalSum = snapshotItems.reduce((sum, it) => sum + Number(it.lineTotal || 0), 0);
  const computedEventAmount =
    payload.eventType === 'cart_remove' || payload.eventType === 'qty_decrease'
      ? Number(
          payload.removedValue ??
            (itemsTotalSum > 0
              ? itemsTotalSum
              : Number(payload.unitPrice || 0) *
                Math.abs(
                  payload.eventType === 'qty_decrease' && payload.previousQty != null
                    ? Number(payload.previousQty) - Number(payload.qty || 0)
                    : Number(payload.qty || 0),
                )),
        )
      : Number(payload.total ?? itemsTotalSum ?? 0);
  const eventAmount = roundMoney(
    Math.max(0, Number.isFinite(computedEventAmount) ? computedEventAmount : 0),
    moneyDigits,
  );

  const effectiveItems: AuditSnapshotItem[] =
    snapshotItems.length > 0
      ? snapshotItems
      : payload.productName
        ? [
            {
              ...(payload.productId ? { productId: Number(payload.productId) } : {}),
              productName: payload.productName,
              qty: Number(payload.qty || 0),
              ...(payload.previousQty != null ? { previousQty: Number(payload.previousQty) } : {}),
              unitPrice: Number(payload.unitPrice || 0),
              lineTotal: eventAmount,
            },
          ]
        : [];

  const event = {
    tenant_id: scope.tenantId,
    account_id: scope.accountId,
    event_type: payload.eventType,
    user_id: auth.userId,
    sale_id: payload.saleId ? Number(payload.saleId) : null,
    product_id: payload.productId || null,
    amount: eventAmount,
    reason,
    metadata: {
      branchId: payload.branchId,
      saleDocNo: payload.saleDocNo,
      productName: payload.productName,
      qty: payload.qty,
      previousQty: payload.previousQty,
      unitPrice: payload.unitPrice,
      removedValue: eventAmount,
      remainingCartTotal: payload.total,
      cartItemsCount: payload.cartItemsCount ?? effectiveItems.length,
      items: effectiveItems,
      sourceBarcode: payload.sourceBarcode,
      terminalCode: payload.terminalCode,
      username: auth.username,
    },
  };

  if (payload.eventType === 'no_sale') {
    const branchId = Number(payload.branchId);
    // INV-SPIRIT-NO-SALE-DRAWER: default keeps reason + open shift only;
    // when tenant opts into strict antiTheftRequirePinForNoSale, non-admins must present manager approval.
    if (!branchId || !reason) throw new AppError('حدد الفرع وسبب فتح الدرج', 'NO_SALE_REASON_REQUIRED', 400);
    if (antiTheft.requirePinForNoSale && auth.role !== 'admin' && auth.role !== 'super_admin') {
      const pin = String(payload.managerPin || '').trim();
      if (!pin) {
        throw new AppError(
          'فتح الدرج بدون بيع يتطلب اعتماد مدير (درع منع السرقة مفعّل)',
          'NO_SALE_MANAGER_PIN_REQUIRED',
          403,
        );
      }
      await authorizeManagerSecret(deps.db, auth, pin);
    }
    await deps.tx.runInTransaction(deps.db, async (trx) => {
      if (!(await deps.authz.hasOpenCashierShift(trx, auth, branchId))) {
        throw new AppError('وردية كاشير مفتوحة مطلوبة لفتح الدرج', 'OPEN_SHIFT_REQUIRED', 400);
      }
      const shift = await trx
        .selectFrom('cashier_shifts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', auth.userId)
        .where('branch_id', '=', branchId)
        .where('status', '=', 'open')
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('pos_audit_events')
        .values({ ...event, metadata: { ...event.metadata, shiftId: Number(shift.id), username: auth.username } })
        .execute();
    });
  } else {
    await deps.db.insertInto('pos_audit_events').values(event).execute();
  }

  let detailInfo = '';
  if (payload.eventType === 'cart_remove') {
    const headerParts = [
      `تم حذف عنصر من السلة بواسطة ${auth.username}`,
      payload.productName ? `الصنف: ${payload.productName}` : '',
      payload.qty ? `الكمية: ${payload.qty}` : '',
      eventAmount > 0 ? `القيمة: ${eventAmount}` : '',
      typeof payload.total === 'number' ? `الإجمالي بعد الحذف: ${payload.total}` : '',
      typeof payload.cartItemsCount === 'number' ? `المتبقي بالسلة: ${payload.cartItemsCount}` : '',
      reason ? `ملاحظة: ${reason}` : '',
    ];
    await deps.audit.log(
      'حدث أمني - حذف عنصر من السلة',
      buildSnapshotAuditText(headerParts, effectiveItems, moneyDigits),
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED,
      },
    );
    detailInfo = payload.productName
      ? `${payload.productName} (كمية: ${payload.qty || 1} — قيمة: ${eventAmount})`
      : reason || 'حذف صنف من السلة';
  } else if (payload.eventType === 'qty_decrease') {
    const deltaQty =
      payload.previousQty != null
        ? Number((Number(payload.previousQty) - Number(payload.qty || 0)).toFixed(3))
        : Number(payload.qty || 0);
    const headerParts = [
      `تم تنقيص كمية صنف بالسلة بواسطة ${auth.username}`,
      payload.productName ? `الصنف: ${payload.productName}` : '',
      payload.previousQty != null ? `الكمية: ${payload.previousQty} ← ${payload.qty}` : `الكمية: ${payload.qty}`,
      eventAmount > 0 ? `القيمة: ${eventAmount}` : '',
      reason ? `ملاحظة: ${reason}` : '',
    ];
    await deps.audit.log(
      'حدث أمني - تنقيص كمية بالسلة',
      buildSnapshotAuditText(headerParts, effectiveItems, moneyDigits),
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_CART_QTY_DECREASED,
      },
    );
    detailInfo = `${payload.productName || 'صنف'} (-${deltaQty} — فارق: ${eventAmount})`;
  } else if (payload.eventType === 'no_sale') {
    detailInfo = reason || 'فتح درج بدون بيع';
    await deps.audit.log(
      'حدث أمني - فتح درج بدون بيع',
      `فتح درج بدون بيع بواسطة ${auth.username} | السبب: ${detailInfo}`,
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_NO_SALE_DRAWER_OPEN,
      },
    );
  } else if (payload.eventType === 'receipt_reprint') {
    const headerParts = [
      `إعادة طباعة فاتورة بواسطة ${auth.username}`,
      payload.saleDocNo ? `الفاتورة: ${payload.saleDocNo}` : payload.saleId ? `الفاتورة: #${payload.saleId}` : '',
      eventAmount > 0 ? `الإجمالي: ${eventAmount}` : '',
      reason ? `ملاحظة: ${reason}` : '',
    ];
    await deps.audit.log(
      'حدث أمني - إعادة طباعة فاتورة',
      buildSnapshotAuditText(headerParts, effectiveItems, moneyDigits),
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_RECEIPT_REPRINTED,
      },
    );
    detailInfo = `إعادة طباعة ${payload.saleDocNo || `#${payload.saleId || ''}`} بقيمة ${eventAmount}`;
  } else if (payload.eventType === 'weighted_barcode_replay') {
    const headerParts = [
      `تكرار مسح نفس باركود الميزان في نفس الوردية بواسطة ${auth.username}`,
      payload.productName ? `الصنف: ${payload.productName}` : '',
      payload.sourceBarcode ? `الباركود: ${payload.sourceBarcode}` : '',
      eventAmount > 0 ? `القيمة: ${eventAmount}` : '',
    ];
    await deps.audit.log(
      'حدث أمني - تكرار باركود ميزان',
      buildSnapshotAuditText(headerParts, effectiveItems, moneyDigits),
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_WEIGHTED_BARCODE_REPLAY,
      },
    );
    detailInfo = `تكرار باركود ميزان ${payload.sourceBarcode || ''} (${payload.productName || ''})`;
  } else {
    const cancelHeaderParts = [
      `تم مسح/إلغاء السلة قبل الإرسال بواسطة ${auth.username}`,
      `الإجمالي: ${eventAmount}`,
      `عدد العناصر: ${payload.cartItemsCount ?? effectiveItems.length}`,
      reason ? `ملاحظة: ${reason}` : '',
    ];
    await deps.audit.log(
      'حدث أمني - إلغاء/مسح سلة الكاشير',
      buildSnapshotAuditText(cancelHeaderParts, effectiveItems, moneyDigits),
      auth,
      {
        eventCode: AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED,
      },
    );
    const previewNames = effectiveItems
      .slice(0, 4)
      .map((it) => `${it.productName} (${it.qty})`)
      .join('، ');
    detailInfo = `مسح سلة بقيمة ${eventAmount}${previewNames ? ` — [${previewNames}]` : ''}`;
  }

  if (deps.fraudRadarService) {
    deps.fraudRadarService
      .checkAndAlertAnomaly(scope.tenantId, auth.userId, auth.username, payload.eventType, detailInfo, eventAmount)
      .catch((err) => deps.logger.warn(`Fraud radar anomaly check error: ${err?.message}`));
  }

  return { ok: true };
}

export async function executeRecordReceiptReprint(
  deps: PosAuditDeps,
  saleId: number,
  auth: AuthContext,
): Promise<Record<string, unknown>> {
  const scope = requireTenantScope(auth);
  const sale = await deps.db
    .selectFrom('sales')
    .select(['id', 'doc_no', 'total', 'branch_id', 'reprint_count'])
    .where('id', '=', saleId)
    .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
    .executeTakeFirst();
  if (!sale) throw new AppError('الفاتورة غير موجودة', 'SALE_NOT_FOUND', 404);

  const updated = await deps.db
    .updateTable('sales')
    .set({
      reprint_count: sql`COALESCE(reprint_count, 0) + 1`,
      last_reprinted_at: sql`NOW()`,
      last_reprinted_by: auth.userId,
    })
    .where('id', '=', saleId)
    .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
    .returning(['reprint_count'])
    .executeTakeFirst();

  const nextCount = Number(updated?.reprint_count ?? Number(sale.reprint_count || 0) + 1);
  const docNo = String(sale.doc_no || `Z-${sale.id}`);
  const total = Number(sale.total || 0);

  await executeLogPosAuditEvent(
    deps,
    {
      eventType: 'receipt_reprint',
      saleId: Number(sale.id),
      saleDocNo: docNo,
      branchId: sale.branch_id ? Number(sale.branch_id) : undefined,
      total,
      note: `إعادة طباعة رقم #${nextCount} للفاتورة ${docNo}`,
    },
    auth,
  );

  return { ok: true, saleId: Number(sale.id), docNo, reprintCount: nextCount };
}
