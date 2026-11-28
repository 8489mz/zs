import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { WhatsAppAlertPort } from '../../../common/utils/whatsapp-alert.port';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { ensureNonNegativeStock, roundMoneyToTwoDecimals } from '../../../common/utils/financial-integrity';
import {
  applyStockDelta,
  getLocationAvailability,
  previewConsumableStockQty,
} from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { InventoryAdjustmentDto } from '../dto/inventory-adjustment.dto';
import { InventoryCountService } from './inventory-count.service';
import { dispatchTrackedStock } from '../helpers/stock-transfer-trace.helper';
import { recordTrackedStockIncrease } from '../helpers/tracked-stock-increase.helper';
import { InventoryScopeService } from './inventory-scope.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { recordStockMovementRow } from '../../../common/utils/stock-movement-writer';

@Injectable()
export class InventoryAdjustmentService {
  private readonly logger = new Logger(InventoryAdjustmentService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly countService: InventoryCountService,
    private readonly scopeService: InventoryScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppAlertPort,
  ) {}

  async createInventoryAdjustment(
    payload: InventoryAdjustmentDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, scope);
      if (cached) return cached.response;
    }

    let result: any = {
      productId: payload.productId,
      locationId: payload.locationId,
      beforeQty: 0,
      afterQty: 0,
      scopeBefore: 0,
      scopeAfter: 0,
      globalBefore: 0,
      globalAfter: 0,
    };

    const location = payload.locationId
      ? await this.scopeService.assertLocationScope(payload.locationId, auth, false, 'write')
      : null;
    if (location && payload.branchId != null && Number(payload.branchId) !== Number(location.branchId)) {
      throw new AppError('الفرع لا يطابق المخزن المختار', 'ADJUSTMENT_BRANCH_LOCATION_MISMATCH', 409);
    }
    if (!location && payload.branchId != null) {
      throw new AppError('المخزن مطلوب عند تحديد الفرع للتسوية', 'LOCATION_REQUIRED_FOR_BRANCH', 400);
    }
    const effectiveBranchId = location ? location.branchId : (payload.branchId ?? null);

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      const requestedQty = Number(payload.qty);
      if (
        !Number.isFinite(requestedQty) ||
        requestedQty < 0 ||
        Math.abs(requestedQty * 1000 - Math.round(requestedQty * 1000)) > 0.000001
      ) {
        throw new AppError(
          'Quantity must be finite, non-negative and have at most three decimal places',
          'INVALID_QTY',
          400,
        );
      }
      const product = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', payload.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('account_id', '=', scope.accountId)
        .where('is_active', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const [serialRecord, batchRecord, drugRecord] = await Promise.all([
        trx
          .selectFrom('product_serials')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', payload.productId)
          .limit(1)
          .executeTakeFirst(),
        trx
          .selectFrom('pharmacy_batches')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', payload.productId)
          .limit(1)
          .executeTakeFirst(),
        trx
          .selectFrom('pharmacy_drugs')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', payload.productId)
          .limit(1)
          .executeTakeFirst(),
      ]);
      const tracked = Boolean(product.track_serials || serialRecord || batchRecord || drugRecord);
      if (!tracked && (payload.serials?.length || payload.batchAllocations?.length)) {
        throw new AppError('الصنف غير متتبع؛ لا تقبل بيانات سيريال أو تشغيلة', 'ADJUSTMENT_UNEXPECTED_TRACE', 400);
      }
      const rawCost = Number(product.cost_price || 0);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
      const stockScope = {
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        productId: payload.productId,
        branchId: effectiveBranchId,
        locationId: payload.locationId,
      };
      // INV-ADJUST-SINGLE-QTY-BASIS: one quantity basis for `adjust` --
      // AVAILABLE. The requested target is the available quantity the
      // dialog shows, so the before-quantity must be read on that same
      // basis: location qty minus reserved plus unassigned available,
      // capped by the global available (previewConsumableStockQty).
      // The old read (the location-only available preview) also
      // disagreed with the write whenever unassigned stock
      // existed. With no location the basis is the global available
      // (stock minus reserved), not the raw global counter.
      const beforeQty = payload.locationId
        ? await previewConsumableStockQty(trx, stockScope)
        : Number(Math.max(0, Number(product.stock_qty || 0) - Number(product.reserved_qty || 0)).toFixed(3));
      let afterQty = beforeQty;
      let movementQty = requestedQty;
      let stockChange: { scopeBefore: number; scopeAfter: number; globalBefore: number; globalAfter: number };

      if (payload.actionType !== 'adjust' && movementQty <= 0) {
        throw new AppError('Quantity must be strictly positive for add and deduct operations', 'INVALID_QTY', 400);
      }

      const deltaRequested =
        payload.actionType === 'adjust'
          ? requestedQty - beforeQty
          : payload.actionType === 'add'
            ? requestedQty
            : -requestedQty;
      if (tracked) {
        if (!payload.locationId || !Number.isSafeInteger(Number(payload.locationId))) {
          throw new AppError('يجب تحديد المخزن عند تسوية صنف متتبع', 'ADJUSTMENT_TRACKED_LOCATION_REQUIRED', 422);
        }
        if (deltaRequested > 0) {
          // INV-SPIRIT-TRACKED-INCREASE: a documented increase naming
          // the specific serials/batches is recorded directly; no full
          // tracked count is required. Serial/batch uniqueness and
          // duplicate guards stay inside the helper.
          await recordTrackedStockIncrease(
            trx,
            scope,
            {
              productId: Number(payload.productId),
              qty: deltaRequested,
              unitCost,
              serials: payload.serials,
              batchAllocations: payload.batchAllocations,
              reason: payload.reason,
            },
            Number(payload.locationId),
            effectiveBranchId,
          );
        } else if (deltaRequested === 0) {
          throw new AppError(
            'زيادة الأصناف المتتبعة أو تغييرها بدون توثيق الاستلام يتم من خلال الجرد المتتبع',
            'ADJUSTMENT_TRACKED_INCREASE_REQUIRES_COUNT',
            409,
          );
        } else {
          await dispatchTrackedStock(
            trx,
            scope,
            {
              productId: Number(payload.productId),
              qty: -deltaRequested,
              serials: payload.serials,
              batchAllocations: payload.batchAllocations?.map((a) => ({
                batchId: Number(a.batchId),
                qty: Number(a.qty),
              })),
            },
            Number(payload.locationId),
            effectiveBranchId,
            null,
            Number(payload.productId),
          );
        }
      }

      if (payload.actionType === 'adjust') {
        // INV-ADJUST-SINGLE-QTY-BASIS: the requested target is an
        // AVAILABLE quantity, so the write moves by the available
        // delta (requested - beforeQty) instead of setting the raw
        // scoped quantity to the target. The old raw setter wrote
        // the raw location qty from the target: with 10 on hand / 2
        // (8 available) saving the displayed 8 set raw 10 -> 8 and
        // booked a phantom -2 loss (Dr 5200 / Cr 1140). A delta write
        // moves raw and available by the same amount because
        // reservations are untouched, so the movement and the journal
        // agree with the requested target. A zero delta still reaches
        // the no-change guard below.
        afterQty = requestedQty;
        stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: Number((requestedQty - beforeQty).toFixed(3)),
          disableAutoDrain: tracked,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Cannot deduct more than current stock',
        });
      } else if (payload.actionType === 'add') {
        afterQty = beforeQty + Number(payload.qty || 0);
        stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: Number(payload.qty || 0),
        });
      } else {
        afterQty = beforeQty - Number(payload.qty || 0);
        ensureNonNegativeStock(afterQty, 'INSUFFICIENT_STOCK', 'Cannot deduct more than current stock');
        stockChange = await applyStockDelta(trx, {
          ...stockScope,
          delta: -Number(payload.qty || 0),
          disableAutoDrain: tracked,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Cannot deduct more than current stock',
        });
      }

      // The actual post-lock delta is authoritative. A physical count may decrease
      // stock even though the requested target quantity itself is positive.
      const signedDelta = Number((stockChange.scopeAfter - stockChange.scopeBefore).toFixed(3));
      movementQty = Math.abs(signedDelta);
      if (movementQty < 0.001) throw new AppError('Adjustment did not change stock', 'STOCK_ADJUSTMENT_NO_CHANGE', 400);

      let writeOffAlertMeta: {
        productName: string;
        locationName: string;
        qty: number;
        totalCost: number;
        reason: string;
        actorName: string;
        approvedByName?: string;
      } | null = null;
      let approvedByName: string | undefined;

      if (signedDelta < -0.0001) {
        const antiTheft = await loadAntiTheftSettings(trx, scope.tenantId);
        const lossCost = roundMoneyToTwoDecimals(movementQty * unitCost);
        const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
        if (antiTheft.requireManagerForWriteOff && !isAdmin) {
          if (!String(payload.managerPin || '').trim()) {
            throw new AppError(
              'خصم أو تخفيض المخزون اليدوي يتطلب كلمة مرور مدير محدد (درع منع السرقة)',
              'WRITE_OFF_MANAGER_APPROVAL_REQUIRED',
              403,
            );
          }
          const approval = await authorizeManagerSecret(trx, auth, String(payload.managerPin || '').trim());
          if (approval.mode !== 'account') {
            throw new AppError(
              'رمز المدير المشترك لا يكفي؛ اعتماد خصم المخزون يتطلب كلمة مرور حساب مدير محدد',
              'WRITE_OFF_MANAGER_PASSWORD_REQUIRED',
              403,
            );
          }
          approvedByName = approval.authorizedByName;
        }
        if (lossCost >= antiTheft.writeOffAlertThreshold) {
          writeOffAlertMeta = {
            productName: String(product.name || `#${payload.productId}`),
            locationName: location?.name || 'الرصيد العام',
            qty: movementQty,
            totalCost: lossCost,
            reason: String(payload.reason || payload.note || 'تسوية سالبة'),
            actorName: auth.username,
            approvedByName,
          };
        }
      }
      // Source movement and GL must represent the same tenant-currency minor units.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));

      // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the row goes through
      // the row-writer in row-only mode — it is stamped from the carried
      // signedDelta / stockChange, and the no-change guard above still
      // throws after the ledger call but before the row, so a no-change
      // run rolls back exactly as before. The writer computes the total
      // as roundMoney(|signedDelta| * unitCost, moneyDigits), the same
      // expression the old totalCost used, and throws MOVEMENT_INSERT_FAILED
      // itself when the insert captures no id.
      const movementId = await recordStockMovementRow(trx, {
        productId: payload.productId,
        branchId: effectiveBranchId,
        locationId: payload.locationId ?? null,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        movementType: payload.actionType,
        delta: signedDelta,
        beforeQty: stockChange.scopeBefore,
        afterQty: stockChange.scopeAfter,
        referenceType: 'inventory_adjustment',
        referenceId: payload.productId,
        reason: payload.reason,
        note: payload.note || '',
        unitCost,
        moneyDigits,
        createdBy: auth.userId,
      });

      if (signedDelta < -0.0001) {
        await syncImportLotsOnStockDeduction(trx, {
          tenantId: scope.tenantId,
          productId: Number(payload.productId),
          locationId: payload.locationId ?? null,
          qty: Math.abs(signedDelta),
          reason: payload.reason || 'inventory_adjustment',
        });
      }

      const posting = await this.accountingPosting.postInventoryAdjustment(trx, movementId, auth);
      if (posting.hasFinancialImpact && !posting.journalEntryId) {
        throw new AppError(`Inventory adjustment ${movementId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
      }
      // before/after stay the ledger's raw scoped quantities: the
      // movement chain and the frontend cache patch (scopeAfter is
      // written back as the raw location qty) both read them as
      // on-hand. Their DIFFERENCE is the available delta above, so
      // the movement and the journal agree with the requested target
      // while reservations stay untouched.
      result = {
        productId: payload.productId,
        locationId: payload.locationId,
        beforeQty: stockChange.scopeBefore,
        afterQty: stockChange.scopeAfter,
        scopeBefore: stockChange.scopeBefore,
        scopeAfter: stockChange.scopeAfter,
        globalBefore: stockChange.globalBefore,
        globalAfter: stockChange.globalAfter,
      };

      await this.audit.logWithExecutor(
        trx,
        signedDelta < -0.0001 ? 'خصم/تسوية مخزون سالبة' : 'تعديل مخزون',
        `تم تعديل مخزون الصنف ${product.name || `#${payload.productId}`} من ${result.beforeQty} إلى ${result.afterQty} (الفرق: ${signedDelta}) | السبب: ${payload.reason}` +
          (approvedByName ? ` | اعتماد المدير: ${approvedByName}` : ''),
        auth,
        signedDelta < -0.0001 ? { eventCode: AUDIT_EVENT_CODES.INVENTORY_NEGATIVE_ADJUSTMENT } : undefined,
      );

      const responsePayload = {
        ok: true,
        adjustment: result,
        products: (
          await trx
            .selectFrom('products')
            .select(['id', 'name'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .where('is_active', '=', true)
            .execute()
        ).map((p) => ({ id: String(p.id), name: p.name })),
        stockMovements: (await this.countService.listStockMovements({}, auth)).stockMovements,
        auditLogs: [],
        _writeOffAlert: writeOffAlertMeta,
      };

      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          {
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            idempotencyKey: idemCtx.idempotencyKey,
            operationType: idemCtx.operationType,
          },
          { ...responsePayload, _writeOffAlert: undefined },
        );
      }

      return responsePayload;
    });

    const alertMeta = (finalResponse as any)?._writeOffAlert;
    if (finalResponse && '_writeOffAlert' in (finalResponse as any)) {
      delete (finalResponse as any)._writeOffAlert;
    }
    if (alertMeta && this.whatsappService) {
      void this.notifyWriteOffWhatsApp(scope.tenantId, alertMeta).catch((err) =>
        this.logger.warn(`Write-off WhatsApp alert failed: ${err?.message}`),
      );
    }

    return finalResponse;
  }

  private async notifyWriteOffWhatsApp(
    tenantId: string,
    meta: {
      productName: string;
      locationName: string;
      qty: number;
      totalCost: number;
      reason: string;
      actorName: string;
      approvedByName?: string;
    },
  ): Promise<void> {
    if (!this.whatsappService) return;
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!tenant?.owner_phone) return;
    const text =
      `*درع منع الخسائر - إنذار خصم/تسوية مخزنية سالبة*\n` +
      `*${tenant.business_name || 'إدارة المخازن'}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `الصنف: *${meta.productName}*\n` +
      `المخزن: ${meta.locationName}\n` +
      `الكمية المخصومة: *${meta.qty}*\n` +
      `التكلفة التقديرية: *${meta.totalCost.toLocaleString('en-US')}*\n` +
      `المنفذ: ${meta.actorName}\n` +
      (meta.approvedByName ? `المعتمد: ${meta.approvedByName}\n` : '') +
      `السبب: ${meta.reason}\n\n` +
      `_يرجى المراجعة للتأكد من عدم وجود إخفاء عجز أو سحب غير مبرر._`;
    await this.whatsappService.sendRawMessage(tenantId, tenant.owner_phone, text);
  }

  // INV-ADJUST-SINGLE-QTY-BASIS: the read side of the dialog prefill.
  // The adjustment dialog shows the location's AVAILABLE quantity, so
  // it needs the same read the backend targets: the ledger's
  // read-only getLocationAvailability (location qty minus reserved
  // plus unassigned available, capped by the global available). It
  // never writes, so a display read can never mutate stock. The
  // sales-orders availability endpoint serves the same ledger
  // function but is gated on the `sales` permission, which an
  // inventory-only user may not hold; this inventory-permissioned
  // read is the one the dialog uses. With no location the display
  // figure is the global available, exactly like the approval check.
  async getProductLocationAvailability(
    productId: number,
    locationId: number | null,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }
    let branchId: number | null = null;
    if (locationId != null) {
      const location = await this.scopeService.assertLocationScope(locationId, auth, false, 'read');
      branchId = location.branchId;
    }
    const availability = await getLocationAvailability(this.db, {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      productId,
      locationId,
      branchId,
    });
    if (locationId == null) {
      return { ...availability, availableAtLocation: availability.globalAvailable };
    }
    return { ...availability };
  }
}
