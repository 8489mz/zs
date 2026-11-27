import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import { moveVanStock, sortItemsByProductId } from '../van-common.util';
import { restoreReturnedInventoryBatches } from '../van-inventory-batches.helper';

export type ApproveFieldReturnBoundDeps = {
  resolveSaleRefundLegs(
    q: any,
    tenantId: string,
    sale: {
      id: number;
      payment_type?: string | null;
      total?: unknown;
      paid_amount?: unknown;
      store_credit_used?: unknown;
      customer_id?: number | null;
    },
    moneyDigits: MoneyDigits,
    opts: {
      excludeReturnId?: number | null;
      priorReturns?: Array<{ id?: unknown; refund_method?: string | null; total_amount?: unknown }> | null;
    },
  ): Promise<{ paymentMethod: string; cashRemaining: number; creditRemaining: number }>;
  assertRefundMethodCoveredByLegs(
    legs: { paymentMethod: string; cashRemaining: number; creditRemaining: number },
    refundMethod: 'credit' | 'cash',
    totalAmount: number,
    moneyDigits: MoneyDigits,
  ): void;
};

export class ApproveFieldReturnSlice {
  private readonly bound: ApproveFieldReturnBoundDeps;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    bound: ApproveFieldReturnBoundDeps,
  ) {
    this.bound = bound;
  }

  private async resolveSaleRefundLegs(
    q: any,
    tenantId: string,
    sale: {
      id: number;
      payment_type?: string | null;
      total?: unknown;
      paid_amount?: unknown;
      store_credit_used?: unknown;
      customer_id?: number | null;
    },
    moneyDigits: MoneyDigits,
    opts: {
      excludeReturnId?: number | null;
      priorReturns?: Array<{ id?: unknown; refund_method?: string | null; total_amount?: unknown }> | null;
    } = {},
  ): Promise<{ paymentMethod: string; cashRemaining: number; creditRemaining: number }> {
    return this.bound.resolveSaleRefundLegs(q, tenantId, sale, moneyDigits, opts);
  }

  private assertRefundMethodCoveredByLegs(
    legs: { paymentMethod: string; cashRemaining: number; creditRemaining: number },
    refundMethod: 'credit' | 'cash',
    totalAmount: number,
    moneyDigits: MoneyDigits,
  ): void {
    return this.bound.assertRefundMethodCoveredByLegs(legs, refundMethod, totalAmount, moneyDigits);
  }

  /**
   * Approves a pending field return, crediting the customer and moving stock.
   */
  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.db.transaction().execute(async (trx) => {
      const trxAny = trx;
      const ret = await trxAny
        .selectFrom('van_field_returns')
        .selectAll()
        .where('id', '=', returnId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!ret) throw new AppError('طلب المرتجع غير موجود', 'RETURN_NOT_FOUND', 404);
      if (ret.status !== 'pending_approval') {
        throw new AppError(`طلب المرتجع تمت معالجته بالفعل بحالة (${ret.status})`, 'RETURN_ALREADY_PROCESSED', 400);
      }

      // Lock the trip row first: approval-time provenance re-validation
      // below reads the rep's sales and other returns, and this lock
      // serializes concurrent approvals for the same trip (and against
      // settleTrip, which takes the same lock) so two approvals cannot
      // both pay out against the same remaining quantity.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status'])
        .where('id', '=', ret.trip_id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
      }

      // Book digits resolved once on THIS transaction handle (D4), AFTER
      // the trip lock above: the custody-guard spec pins the settings
      // read after the lock, and the cash check + net-unit caps below
      // both use these digits.
      const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));

      const trip = await trxAny
        .selectFrom('van_sales_trips as vt')
        .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
        .select([
          'vt.id',
          'vt.van_location_id',
          'vt.source_warehouse_id',
          'vt.cash_collected',
          'van.branch_id as vanBranchId',
        ])
        .where('vt.id', '=', ret.trip_id)
        .where('vt.tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) throw new AppError('رحلة التوزيع المربوطة بالمرتجع غير صالحة', 'INVALID_TRIP', 400);

      const items = typeof ret.items_json === 'string' ? JSON.parse(ret.items_json) : ret.items_json || [];
      const totalAmount = Number(ret.total_amount || 0);
      const isDamaged = ret.return_reason === 'damaged' || ret.return_reason === 'expired';
      const branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;
      const refundMethod: 'credit' | 'cash' = ret.refund_method === 'cash' ? 'cash' : 'credit';

      if (refundMethod === 'cash') {
        // Custody guard (van F5): this check runs inside the transaction
        // on the trip row freshly re-read AFTER the FOR UPDATE lock
        // above, so a concurrent approval waits for the lock and then
        // sees the first approval's committed deduction — two cash
        // refunds can never both pay out against the same balance
        // (the deduction below is a relative SQL update, exact under
        // the lock). The tolerance is one minor unit of the tenant's
        // book currency, never a hardcoded 0.01 — 0.01 is ten minor
        // units on a 3-decimal tenant and let a refund overdraw the
        // rep's custody by up to that much, even sequentially.
        const tolerance = 1 / 10 ** moneyDigits;
        const repCash = Number(trip.cash_collected || 0);
        if (totalAmount > repCash + tolerance) {
          throw new AppError(
            `رصيد النقدية المحصلة بعهدة المندوب بالرحلة (${repCash} ج.م) لا يكفي لاعتماد مرتجع نقدي بقيمة (${totalAmount} ج.م)`,
            'INSUFFICIENT_REP_CASH_FOR_REFUND',
            400,
          );
        }
      }

      // APPROVAL-TIME PROVENANCE RE-VALIDATION (van F3): submit-time
      // checks run outside any transaction, so the basis they verified
      // can evaporate before approval — the sale edited down or
      // cancelled, another return approved first, or the trip settled.
      // Approval trusts nothing from submission: it re-reads the
      // current sales/returns state inside this transaction (under
      // the trip lock above) and fails closed, leaving the request
      // pending_approval for a human to reject or re-examine. No
      // fraud-radar event is recorded here: a changed basis is often
      // a legitimate edit, not an attempted fraud.
      const returnItems = (items || []).map((i: any) => ({ ...i, productId: Number(i.productId) }));
      // INV-VAN-FIELD-RETURN-CARTON-QTY: the matched sale lines are
      // needed again at stock posting (each line's own multiplier);
      // hoisted out of the provenance block so the restock loop can
      // read them without a second query.
      let linkedSaleLines: any[] = [];
      if (ret.sale_id) {
        const sale = await trxAny
          .selectFrom('sales as s')
          .leftJoin('van_sales_trips as vt', (join: any) =>
            join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
          )
          .select([
            's.id',
            's.status',
            's.customer_id',
            's.payment_type',
            's.total',
            's.paid_amount',
            's.store_credit_used',
            sql<number | null>`coalesce(s.delivery_rep_id, vt.rep_id)`.as('resolved_rep_id'),
          ])
          .where('s.id', '=', ret.sale_id)
          .where('s.tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (!sale) throw new AppError('الفاتورة الأصلية غير موجودة', 'SALE_NOT_FOUND', 404);
        if (sale.status !== 'posted') {
          throw new AppError(
            'الفاتورة الأصلية غير مرحّلة أو تم إلغاؤها بعد تقديم المرتجع',
            'RETURN_SALE_NOT_POSTED',
            400,
          );
        }
        if (Number(sale.customer_id) !== Number(ret.customer_id)) {
          throw new AppError('الفاتورة المحددة لا تخص هذا العميل', 'SALE_CUSTOMER_MISMATCH', 400);
        }
        if (sale.resolved_rep_id != null && Number(sale.resolved_rep_id) !== Number(ret.rep_id)) {
          throw new AppError(
            'لا يمكن عمل مرتجع على فاتورة تخص مندوباً آخر — عهد وحسابات كل مندوب معزولة تماماً',
            'SALE_REP_MISMATCH',
            403,
          );
        }
        linkedSaleLines = await trxAny
          .selectFrom('sale_items')
          .selectAll()
          .where('sale_id', '=', ret.sale_id)
          .where('tenant_id', '=', tenantId)
          .execute();
        const priorReturns = await trxAny
          .selectFrom('van_field_returns')
          .select(['id', 'items_json', 'refund_method', 'total_amount'])
          .where('sale_id', '=', ret.sale_id)
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`status in ('approved', 'pending_approval')`)
          .execute();
        const alreadyReturnedBySaleItem = new Map<number, number>();
        for (const prior of priorReturns) {
          // Exclude this return itself: it is pending_approval and
          // would otherwise count its own quantity against itself.
          if (Number(prior.id) === Number(returnId)) continue;
          const parsed = typeof prior.items_json === 'string' ? JSON.parse(prior.items_json) : prior.items_json || [];
          for (const it of parsed) {
            if (it.saleItemId) {
              const sid = Number(it.saleItemId);
              alreadyReturnedBySaleItem.set(sid, (alreadyReturnedBySaleItem.get(sid) || 0) + Number(it.qty || 0));
            }
          }
        }
        for (const item of returnItems) {
          const line = item.saleItemId
            ? linkedSaleLines.find((sl: any) => Number(sl.id) === Number(item.saleItemId))
            : linkedSaleLines.find((sl: any) => Number(sl.product_id) === Number(item.productId));
          if (!line) {
            throw new AppError(
              `الصنف #${item.productId} لم يتم العثور عليه في الفاتورة الأصلية`,
              'ITEM_NOT_IN_SALE',
              400,
            );
          }
          const soldQty = Number(line.qty || 0);
          const lineTotal = Number(line.line_total || 0);
          const netUnit = soldQty > 0 ? roundMoney(lineTotal / soldQty, moneyDigits) : 0;
          if (Number(item.unitPrice) > netUnit + 0.05) {
            throw new AppError(
              `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي بعد الخصم بالفاتورة الأصلية (${netUnit})`,
              'RETURN_PRICE_EXCEEDS_NET',
              400,
            );
          }
          const alreadyReturned = alreadyReturnedBySaleItem.get(Number(line.id)) || 0;
          const remainingReturnableQty = Number((soldQty - alreadyReturned).toFixed(3));
          if (Number(item.qty) > remainingReturnableQty + 0.001) {
            throw new AppError(
              `الكمية المطلوب ردها (${item.qty}) تتجاوز المتبقي القابل للرد من الفاتورة الأصلية (${Math.max(0, remainingReturnableQty)}) — بيع ${soldQty}، مرتجع سابقاً ${alreadyReturned}`,
              'RETURN_QTY_EXCEEDS_SOLD',
              400,
            );
          }
        }
        // INV-VAN-RETURN-METHOD-MATCH: the refund method must match
        // the original sale's payment legs (the provenance re-check
        // above re-reads the sale inside this transaction, so the
        // legs are current — a sale edited between submit and
        // approval cannot smuggle a wrong-leg refund through).
        // priorReturns is reused here so the leg consumption and the
        // quantity re-check above read the same snapshot.
        const legs = await this.resolveSaleRefundLegs(trxAny, tenantId, sale, moneyDigits, {
          excludeReturnId: returnId,
          priorReturns,
        });
        this.assertRefundMethodCoveredByLegs(legs, refundMethod, totalAmount, moneyDigits);
      } else {
        const repCustomerSales = await trxAny
          .selectFrom('sales as s')
          .leftJoin('van_sales_trips as vt', (join: any) =>
            join.onRef('vt.id', '=', 's.van_trip_id').onRef('vt.tenant_id', '=', 's.tenant_id'),
          )
          .select(['s.id'])
          .where('s.customer_id', '=', ret.customer_id)
          .where('s.tenant_id', '=', tenantId)
          .where('s.status', '=', 'posted')
          .where(sql<boolean>`coalesce(s.delivery_rep_id, vt.rep_id) = ${Number(ret.rep_id)}`)
          .execute();
        const repSaleIds = repCustomerSales.map((s: any) => Number(s.id));
        if (!repSaleIds.length) {
          throw new AppError(
            'لا يمكن تسجيل مرتجع بدون فاتورة لعميل لم يسبق لهذا المندوب البيع له',
            'NO_REP_SALES_HISTORY_FOR_RETURN',
            403,
          );
        }
        const soldLines = await trxAny
          .selectFrom('sale_items')
          .select(['product_id', 'product_name', 'qty', 'line_total'])
          .where('sale_id', 'in', repSaleIds)
          .where('tenant_id', '=', tenantId)
          .execute();
        const existingCustomerReturns = await trxAny
          .selectFrom('van_field_returns')
          .select(['id', 'items_json'])
          .where('customer_id', '=', ret.customer_id)
          .where('rep_id', '=', ret.rep_id)
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`status in ('approved', 'pending_approval')`)
          .execute();
        const returnedByProduct = new Map<number, number>();
        for (const retRow of existingCustomerReturns) {
          if (Number(retRow.id) === Number(returnId)) continue;
          const parsed =
            typeof retRow.items_json === 'string' ? JSON.parse(retRow.items_json) : retRow.items_json || [];
          for (const it of parsed) {
            const pid = Number(it.productId);
            returnedByProduct.set(pid, (returnedByProduct.get(pid) || 0) + Number(it.qty || 0));
          }
        }
        for (const item of returnItems) {
          const pid = Number(item.productId);
          const matchingLines = soldLines.filter((sl: any) => Number(sl.product_id) === pid);
          const totalSoldQty = matchingLines.reduce((sum: number, sl: any) => sum + Number(sl.qty || 0), 0);
          const maxNetUnitPrice = matchingLines.reduce((maxP: number, sl: any) => {
            const q = Number(sl.qty || 0);
            const netU = q > 0 ? roundMoney(Number(sl.line_total || 0) / q, moneyDigits) : 0;
            return Math.max(maxP, netU);
          }, 0);
          const alreadyRet = returnedByProduct.get(pid) || 0;
          const remainingQty = Number((totalSoldQty - alreadyRet).toFixed(3));
          if (totalSoldQty <= 0 || Number(item.qty) > remainingQty + 0.001) {
            throw new AppError(
              `الكمية المطلوب ردها (${item.qty}) للصنف #${pid} تتجاوز إجمالي ما باعه هذا المندوب للعميل صافي المرتجعات السابقة (${Math.max(0, remainingQty)})`,
              'RETURN_QTY_EXCEEDS_SOLD',
              400,
            );
          }
          if (Number(item.unitPrice) > maxNetUnitPrice + 0.05) {
            throw new AppError(
              `سعر المرتجع (${item.unitPrice}) يتجاوز السعر الصافي الذي بيع به الصنف للعميل (${maxNetUnitPrice})`,
              'RETURN_PRICE_EXCEEDS_NET',
              400,
            );
          }
        }
      }

      // INV-VAN-RETURN-METHOD-MATCH: a credit refund must never
      // drive the customer's balance below zero. The leg check above
      // bounds a linked refund by the sale's credit leg, but a
      // collection since the sale may already have lowered the
      // balance below that leg — and an unlinked refund has no sale
      // leg at all. The customer row is locked FOR UPDATE here,
      // before any stock work, so two concurrent approvals cannot
      // both pass the floor against the same balance. Fail closed,
      // never silently clamp: the request stays pending_approval for
      // a human to settle the remainder.
      if (refundMethod === 'credit') {
        const tolerance = 1 / 10 ** moneyDigits;
        const custRow = await trxAny
          .selectFrom('customers')
          .select(['balance'])
          .where('id', '=', ret.customer_id)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        const balanceBefore = Number(custRow?.balance || 0);
        if (totalAmount > balanceBefore + tolerance) {
          throw new AppError(
            `رصيد العميل الحالي (${roundMoney(balanceBefore, moneyDigits)}) أقل من قيمة المرتجع كائتمان (${roundMoney(totalAmount, moneyDigits)}) — لا يمكن أن يصبح رصيد العميل سالباً نتيجة مرتجع`,
            'REFUND_EXCEEDS_CUSTOMER_BALANCE',
            400,
          );
        }
      }

      let targetLocationId = Number(trip.van_location_id);
      if (isDamaged) {
        const damagedLoc = await trxAny
          .selectFrom('stock_locations')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where('location_type', '=', 'damaged')
          .executeTakeFirst();
        if (damagedLoc?.id) targetLocationId = Number(damagedLoc.id);
      }

      const itemsWithCost: { productId: number; qty: number; costPrice: number; saleItemId: number | null }[] = [];
      // INV-VAN-GENERIC-FEFO: approved-only prior returns per sale line
      // (sale units), for the batch restore's skip below — pending
      // returns have not restored any batch yet, so they must not be
      // skipped (skipping them would under-restore the batch).
      const approvedReturnedBySaleItem = new Map<number, number>();
      if (ret.sale_id) {
        const approvedPriors = await trxAny
          .selectFrom('van_field_returns')
          .select(['id', 'items_json'])
          .where('sale_id', '=', ret.sale_id)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'approved')
          .execute();
        for (const prior of approvedPriors) {
          if (Number(prior.id) === Number(returnId)) continue;
          const parsed = typeof prior.items_json === 'string' ? JSON.parse(prior.items_json) : prior.items_json || [];
          for (const it of parsed) {
            if (it.saleItemId) {
              const sid = Number(it.saleItemId);
              approvedReturnedBySaleItem.set(sid, (approvedReturnedBySaleItem.get(sid) || 0) + Number(it.qty || 0));
            }
          }
        }
      }
      const sortedReturnItems: any[] = sortItemsByProductId(
        (items || []).map((i: any) => ({ ...i, productId: Number(i.productId) })),
      );
      for (const item of sortedReturnItems) {
        const pid = Number(item.productId);
        const qty = Number(item.qty || 0);
        const price = Number(item.unitPrice || 0);
        if (qty <= 0) continue;

        // INV-VAN-FIELD-RETURN-CARTON-QTY: qty is in SALE units
        // (cartons); van stock is in PIECES. Convert with the matched
        // DB sale line's own multiplier — never the client value
        // (the provenance re-check above already matched this line).
        // Unlinked returns have no sale line, so their qty is already
        // pieces (multiplier 1). unitCost becomes the per-piece price,
        // so the movement value is unchanged (12 x 12 = 1 x 144).
        const linkedLine =
          item.saleItemId != null
            ? linkedSaleLines.find((sl: any) => Number(sl.id) === Number(item.saleItemId))
            : linkedSaleLines.find((sl: any) => Number(sl.product_id) === Number(pid));
        const rawMultiplier = linkedLine ? Number(linkedLine.unit_multiplier ?? 1) : 1;
        const unitMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
        const pieceQty = qty * unitMultiplier;
        const pieceUnitCost = price / unitMultiplier;

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['cost_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        await moveVanStock(trx, {
          productId: pid,
          delta: pieceQty,
          locationId: targetLocationId,
          tenantId,
          accountId,
          userId: approvedByUserId,
          movementType: 'van_sale_return',
          note: `مرتجع عميل معتمد (${ret.doc_no}) - سبب: ${ret.return_reason}`,
          referenceType: 'van_field_return',
          referenceId: returnId,
          skipGlobalUpdate: false,
          unitCost: pieceUnitCost,
        });

        // INV-VAN-GENERIC-FEFO: restore the generic batches the original
        // sale consumed, newest allocation first. Linked returns only:
        // an unlinked return has no sale line to attribute the original
        // batch to, so it restocks pooled-only (recorded limitation).
        // Damaged returns skip the restore — the goods leave the
        // saleable ledger instead of returning to it.
        if (linkedLine && !isDamaged && ret.sale_id) {
          const priorApproved = approvedReturnedBySaleItem.get(Number(linkedLine.id)) || 0;
          await restoreReturnedInventoryBatches(
            trx,
            Number(ret.sale_id),
            Number(linkedLine.id),
            pid,
            Number((priorApproved * unitMultiplier).toFixed(3)),
            pieceQty,
            { tenantId, accountId },
          );
        }

        // itemsWithCost keeps SALE-unit qty on purpose:
        // postVanFieldReturn's COGS mirror expects sold units and
        // converts to base units itself via each line's multiplier —
        // passing pieces there would 12x the COGS reversal.
        itemsWithCost.push({
          productId: pid,
          qty,
          costPrice: Number(prod?.cost_price || 0),
          saleItemId: item.saleItemId != null ? Number(item.saleItemId) : null,
        });
      }

      if (refundMethod === 'credit') {
        const updatedCust = await trxAny
          .updateTable('customers')
          .set({ balance: sql`COALESCE(balance, 0) - ${totalAmount}`, updated_at: sql`NOW()` })
          .where('id', '=', ret.customer_id)
          .where('tenant_id', '=', tenantId)
          .returning(['balance'])
          .executeTakeFirst();
        const balanceAfter = Number(updatedCust?.balance || 0);

        await trxAny
          .insertInto('customer_ledger')
          .values({
            customer_id: ret.customer_id,
            entry_type: 'return',
            amount: -totalAmount,
            balance_after: balanceAfter,
            note: `مرتجع بضاعة ميداني معتمد (#${ret.doc_no}) - خصم من الحساب`,
            reference_type: 'van_field_return',
            reference_id: returnId,
            van_trip_id: ret.trip_id,
            tenant_id: tenantId,
            account_id: accountId,
            created_by: approvedByUserId,
          })
          .execute();
      } else {
        // Immediate Cash Refund from Van: deduct from cash_collected and track cash_refunds
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            cash_refunds: sql`COALESCE(cash_refunds, 0) + ${totalAmount}`,
            cash_collected: sql`cash_collected - ${totalAmount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', ret.trip_id)
          .where('tenant_id', '=', tenantId)
          .execute();

        const currentCust = await trxAny
          .selectFrom('customers')
          .select(['balance'])
          .where('id', '=', ret.customer_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const balanceAfter = Number(currentCust?.balance || 0);

        await trxAny
          .insertInto('customer_ledger')
          .values({
            customer_id: ret.customer_id,
            entry_type: 'return',
            amount: 0,
            balance_after: balanceAfter,
            note: `مرتجع بضاعة نقدي فوري مسدد من عهدة المندوب (#${ret.doc_no}) بقيمة ${totalAmount}`,
            reference_type: 'van_field_return',
            reference_id: returnId,
            van_trip_id: ret.trip_id,
            tenant_id: tenantId,
            account_id: accountId,
            created_by: approvedByUserId,
          })
          .execute();
      }

      await trxAny
        .updateTable('van_sales_trips')
        .set({
          returns_amount: sql`returns_amount + ${totalAmount}`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', ret.trip_id)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trxAny
        .updateTable('van_field_returns')
        .set({
          status: 'approved',
          approved_by: approvedByUserId,
          approved_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', returnId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const auth: AuthContext = {
        userId: approvedByUserId,
        sessionId: 'van-field-return-approval',
        username: 'admin',
        role: 'admin',
        permissions: ['accounting'],
        tenantId,
        accountId,
      };
      await this.accountingPosting.postVanFieldReturn(
        trx,
        returnId,
        {
          customerId: Number(ret.customer_id),
          totalAmount,
          refundMethod,
          items: itemsWithCost,
          // INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: the sale link,
          // per-item sale-line link, and damaged flag decide whether
          // the reversal uses the shared residual basis or the legacy
          // plain computation; the posting method reads the frozen
          // costs itself and never trusts the caller cost for the
          // mirror path.
          saleId: ret.sale_id ? Number(ret.sale_id) : null,
          isDamaged,
          branchId,
          locationId: targetLocationId,
        },
        auth,
      );

      return { ok: true, returnId, status: 'approved' };
    });
  }
}
