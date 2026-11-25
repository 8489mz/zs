import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type Kysely, sql } from '../../../database/kysely';
import { type Database } from '../../../database/database.types';
import { type AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { applyStockDelta, lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { upsertInventoryBatchFromReceipt } from '../helpers/inventory-batch-receipt.helper';
import { allocateLandedCosts } from '../engines/landed-cost-allocation.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { type AccountingPostingService } from '../../accounting/accounting-posting.service';
import { advancePurchaseOrderReceipt } from '../engines/purchase-order-receipt.engine';
import { stockMovementTotal } from '../../catalog/engines/stock-movement-total.engine';

/**
 * GoodsReceiptPostService — slice S2 of the goods-receipt split.
 * Pure move of the receipt-posting flow from the goods-receipt
 * service. No behavior change: the body is byte-identical; the
 * facade keeps a thin public delegate with the same name and
 * signature. This slice reaches the kernel helpers and the
 * sibling slices only through bound deps — it never imports
 * another slice service.
 */

export interface GoodsReceiptPostDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // body stays byte-identical).
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
  validateGrnFreight: (freight: number | undefined, moneyDigits: 2 | 3) => number;
  // Bound facade delegates (S1 / S0; bound from the facade itself, so
  // this slice is independent of merge order).
  getGoodsReceipt: (id: number, auth: AuthContext, externalTrx?: any) => Promise<any>;
  resolveAccountByCode: (trx: any, tenantId: string, accountId: string, code: string) => Promise<number | null>;
}

@Injectable()
export class GoodsReceiptPostService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;
  private readonly validateGrnFreight: (freight: number | undefined, moneyDigits: 2 | 3) => number;
  private readonly getGoodsReceipt: (id: number, auth: AuthContext, externalTrx?: any) => Promise<any>;
  private readonly resolveAccountByCode: (
    trx: any,
    tenantId: string,
    accountId: string,
    code: string,
  ) => Promise<number | null>;

  constructor(deps: GoodsReceiptPostDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.tenantPredicate = deps.tenantPredicate;
    this.validateGrnFreight = deps.validateGrnFreight;
    this.getGoodsReceipt = deps.getGoodsReceipt;
    this.resolveAccountByCode = deps.resolveAccountByCode;
  }

  async postGoodsReceipt(id: number, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx: any) => {
      // Book precision for every amount in this flow. goods-receipt previously
      // used no moneyDigits at all — every site below was hard-coded to 2.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const receiptLink = await trx
        .selectFrom('goods_receipt_notes')
        .select('purchase_order_id')
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (!receiptLink) throw new NotFoundException(`إذن الاستلام رقم ${id} غير موجود.`);
      if (receiptLink.purchase_order_id) {
        const lockedOrder = await trx
          .selectFrom('purchase_orders')
          .select(['id', 'status'])
          .where('id', '=', Number(receiptLink.purchase_order_id))
          .where('tenant_id', '=', scope.tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        // INV-SPIRIT-GRN-PENDING-REVIEW: a draft order posts as a
        // pending-review receipt (flagged below); only a cancelled
        // order blocks posting.
        if (
          !['draft', 'confirmed', 'partially_received', 'received', 'converted_to_bill'].includes(
            String(lockedOrder.status),
          )
        ) {
          throw new BadRequestException('تم رفض ترحيل الاستلام: أمر الشراء غير معتمد أو ملغي');
        }
      }
      // 1. Pessimistic lock on GRN header to prevent concurrent double-posting
      const grnRow = await trx
        .selectFrom('goods_receipt_notes')
        .selectAll()
        .where('id', '=', id)
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();

      if (!grnRow) {
        throw new NotFoundException(`إذن الاستلام رقم ${id} غير موجود.`);
      }
      if (Number(grnRow.purchase_order_id || 0) !== Number(receiptLink.purchase_order_id || 0)) {
        throw new BadRequestException('تغير ارتباط محضر الاستلام بأمر الشراء أثناء الترحيل.');
      }

      if (grnRow.status === 'posted') {
        throw new BadRequestException('تم ترحيل إذن الاستلام هذا مسبقاً.');
      }
      if (grnRow.status === 'cancelled') {
        throw new BadRequestException('لا يمكن ترحيل محضر استلام ملغى.');
      }
      const alreadyReceivedBill = await trx
        .selectFrom('purchases')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'posted')
        .where((eb: any) => eb.or([eb('lifecycle_status', 'is', null), eb('lifecycle_status', '!=', 'grn_bill')]))
        .where((eb: any) =>
          eb.or([
            eb('grn_id', '=', id),
            ...(grnRow.purchase_order_id ? [eb('po_id', '=', Number(grnRow.purchase_order_id))] : []),
          ]),
        )
        .limit(1)
        .executeTakeFirst();
      if (alreadyReceivedBill) {
        throw new BadRequestException('فاتورة مرتبطة بهذا الاستلام رحّلت المخزون بالفعل؛ لا يجوز ترحيله مرتين.');
      }

      const grn = await this.getGoodsReceipt(id, auth, trx);
      await lockStockProducts(trx, { ...scope, productIds: grn.lines.map((line: any) => Number(line.productId)) });

      // INV-SHIPPING-ALLOCATION: freight on the receipt is allocated
      // to item cost at posting time by the same canonical allocator
      // the direct invoice uses (value proportion), so the WAC
      // reflects the true landed cost instead of the bare item cost.
      // Rejected quantities never carry freight: only accepted stock
      // is valued, and a receipt with no accepted value fails closed
      // instead of posting freight into nothing.
      const freight = this.validateGrnFreight(grn.freightAmount, moneyDigits);
      const acceptedLines = [...grn.lines]
        .sort((a, b) => Number(a.productId) - Number(b.productId))
        .filter((line: any) => Number(line.acceptedQty || 0) > 0);
      if (
        freight > 0 &&
        !acceptedLines.some((line: any) => Number(line.acceptedQty || 0) * Number(line.unitCost || 0) > 0)
      ) {
        throw new BadRequestException(
          'الشحن يحتاج صنفاً مقبولاً واحداً على الأقل في إذن الاستلام؛ الكميات المرفوضة وحدها لا تحمل تكلفة وصول.',
        );
      }
      const freightByLineId = new Map<number, number>();
      if (freight > 0) {
        const shares = allocateLandedCosts(
          freight,
          acceptedLines.map((line: any) => Math.max(0, Number(line.acceptedQty || 0) * Number(line.unitCost || 0))),
          moneyDigits,
        );
        acceptedLines.forEach((line: any, i: number) => freightByLineId.set(Number(line.id), shares[i]));
      }

      let totalGrniAmount = 0;

      // Stock movements must carry branch attribution like every other stock path does.
      const grnLocation = await trx
        .selectFrom('stock_locations')
        .select('branch_id')
        .where('id', '=', grn.locationId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const grnBranchId = grnLocation?.branch_id != null ? Number(grnLocation.branch_id) : null;

      // INV-GRN-REAL-QUARANTINE: resolve every quarantine location
      // up front, with its branch, and re-check the type at posting
      // time — the type may have changed since the draft was created,
      // and a line whose quarantine pointer no longer names a real
      // quarantine location must fail closed instead of silently
      // posting sellable stock.
      const quarantineLocationIds = [
        ...new Set(grn.lines.map((line: any) => Number(line.quarantineLocationId || 0)).filter((id: number) => id > 0)),
      ];
      const quarantineLocationsById = new Map<number, { branchId: number | null }>();
      if (quarantineLocationIds.length) {
        const quarantineRows = await trx
          .selectFrom('stock_locations')
          .select(['id', 'branch_id', 'location_type'])
          .where('id', 'in', quarantineLocationIds)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
        for (const row of quarantineRows) {
          if (String(row.location_type || '') !== 'quarantine') {
            throw new BadRequestException(
              'مكان الحجر في إذن الاستلام ليس مخزن حجر صحي؛ أوقف الترحيل قبل دخول بضاعة محجوزة إلى مخزن بيع.',
            );
          }
          quarantineLocationsById.set(Number(row.id), {
            branchId: row.branch_id != null ? Number(row.branch_id) : null,
          });
        }
        if (quarantineLocationsById.size !== quarantineLocationIds.length) {
          throw new NotFoundException('مكان الحجر في إذن الاستلام غير موجود في المنشأة.');
        }
      }

      // 2. Update physical inventory for accepted quantities & write audit movements
      for (const line of [...grn.lines].sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const accepted = Number(line.acceptedQty || 0);
        if (accepted > 0) {
          // INV-GRN-REAL-QUARANTINE: an accepted line with a
          // quarantine location posts to the QUARANTINE location, not
          // the receipt warehouse — the old code posted every line to
          // grn.locationId and the quarantine id never appeared in
          // the acceptance path, so quarantined goods entered normal
          // stock and were sellable immediately. The global balance
          // and the WAC still move (the goods are owned inventory,
          // Dr 1140 posts on receipt exactly as before); only the
          // location leg changes.
          const quarantineLocationId = Number(line.quarantineLocationId || 0) || null;
          const targetLocationId = quarantineLocationId ?? grn.locationId;
          const targetBranchId = quarantineLocationId
            ? quarantineLocationsById.get(quarantineLocationId)!.branchId
            : grnBranchId;
          const lineUnitCost = Number(line.unitCost || 0);
          if (
            !Number.isFinite(lineUnitCost) ||
            lineUnitCost <= 0 ||
            roundMoney(accepted * lineUnitCost, moneyDigits) <= 0
          ) {
            throw new BadRequestException(`لا يمكن ترحيل استلام الصنف ${line.productId} بدون تكلفة مالية صالحة.`);
          }
          // INV-SHIPPING-ALLOCATION: this line's share of the receipt
          // freight, by value. The landed line total is the bare line
          // total at book digits plus the share, so the GRNI journal
          // below (the sum of these totals) can never diverge from
          // the stored movement totals by rounding.
          const allocatedFreight = freightByLineId.get(Number(line.id)) || 0;
          const landedUnitCost =
            allocatedFreight > 0 ? Number((lineUnitCost + allocatedFreight / accepted).toFixed(6)) : lineUnitCost;
          const landedLineTotal = stockMovementTotal(accepted, lineUnitCost, moneyDigits) + allocatedFreight;
          totalGrniAmount += landedLineTotal;

          // Route stock through the shared ledger helper instead of writing the two balance tables
          // by hand. Doing it by hand skipped the canonical lock order (products BEFORE
          // product_location_stock), which deadlocked against concurrent sales, and produced
          // stock_movements rows whose before/after balances were hardcoded 0 / accepted.
          const stockChange = await applyStockDelta(trx, {
            productId: Number(line.productId),
            delta: accepted,
            branchId: targetBranchId,
            locationId: targetLocationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId || scope.tenantId,
            allowNegative: true, // a receipt only adds; never reject it on a negative-stock rule
          });

          // Moving average cost on receipt. Without this, goods arriving at a new price never
          // updated products.cost_price, so COGS kept using a stale cost indefinitely.
          // INV-WAC-SINGLE-WRITER: the one writer blends the receipt
          // through the canonical engine. accepted > 0 and lineUnitCost
          // > 0 are enforced above; the engine never returns a negative
          // cost, so the old non-negativity guard is subsumed. The
          // product row is locked by the stock delta above, so the
          // writer's read cannot miss it.
          // INV-SHIPPING-ALLOCATION: freight carried on the receipt
          // blends into the receipt value, so the WAC reflects the true
          // landed cost instead of the bare item cost — the same blend
          // the direct invoice performs at its own receipt.
          await valueStockReceipt(
            trx,
            scope.tenantId,
            Number(line.productId),
            stockChange.globalAfter,
            accepted,
            accepted * landedUnitCost,
          );

          // INV-SHIPPING-ALLOCATION: the landed line total is the proof
          // the freight reached this line; unit_cost stays the net item
          // cost on the pharmacy batch below, exactly as the
          // post-posting step leaves it.
          if (allocatedFreight > 0) {
            await trx
              .updateTable('goods_receipt_lines')
              .set({
                allocated_landed_cost: allocatedFreight,
                landed_unit_cost: landedUnitCost,
              })
              .where('id', '=', Number(line.id))
              .where('tenant_id', '=', scope.tenantId)
              .execute();
          }

          // Record formal stock movement with the real running balances.
          await trx
            .insertInto('stock_movements')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId || scope.tenantId,
              product_id: line.productId,
              movement_type: 'goods_receipt',
              qty: accepted,
              before_qty: stockChange.scopeBefore,
              after_qty: stockChange.scopeAfter,
              unit_cost: landedUnitCost,
              // INV-GRN-JOURNAL-CENTRAL-POSTING: the stored movement total
              // is the single book-digits computation (stockMovementTotal
              // plus the line's allocated freight), so it can never
              // diverge from the posted GRNI leg by rounding. The old
              // toFixed(4) stored 100.125 for a 2dp tenant while the
              // journal leg rounded to 100.13.
              total_cost: landedLineTotal,
              reason: 'goods_receipt',
              note: `إذن استلام مخزني GRN - ${grn.docNo}`,
              reference_type: 'goods_receipt',
              reference_id: grn.id,
              branch_id: targetBranchId,
              location_id: targetLocationId,
              created_by: auth.userId,
            })
            .execute();

          const drug = await trx
            .selectFrom('pharmacy_drugs')
            .select('id')
            .where('tenant_id', '=', scope.tenantId)
            .where('product_id', '=', Number(line.productId))
            .executeTakeFirst();
          const batchNumber = String(line.batchNumber || '').trim();
          const rawExpiry = line.expiryDate;
          const expiryDate = rawExpiry
            ? rawExpiry instanceof Date
              ? rawExpiry.toISOString().slice(0, 10)
              : String(rawExpiry).slice(0, 10)
            : '';
          if (drug && (!batchNumber || !expiryDate)) {
            throw new UnprocessableEntityException('محضر استلام الدواء يتطلب رقم التشغيلة وتاريخ الصلاحية');
          }
          // INV-VAN-GENERIC-FEFO: drug-linked products keep the pharmacy
          // ledger above; every other product with a batch number lands
          // in the generic ledger (this block used to write non-drug
          // batches into pharmacy_batches too).
          if (batchNumber && drug) {
            const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
            if (
              !/^\d{4}-\d{2}(?:-\d{2})?$/.test(expiryDate) ||
              (expiryDate.length === 7 ? expiryDate < today.slice(0, 7) : expiryDate < today)
            ) {
              throw new UnprocessableEntityException('لا يمكن ترحيل تشغيلة منتهية أو بتاريخ صلاحية غير صالح');
            }
            const existingBatch = await trx
              .selectFrom('pharmacy_batches')
              .select(['id', 'quantity', 'expiry_date'])
              .where('tenant_id', '=', scope.tenantId)
              .where('product_id', '=', Number(line.productId))
              .where('location_id', '=', targetLocationId)
              .where('batch_number', '=', batchNumber)
              .forUpdate()
              .executeTakeFirst();
            if (existingBatch) {
              if (String(existingBatch.expiry_date).slice(0, 10) !== expiryDate) {
                throw new UnprocessableEntityException('تاريخ صلاحية التشغيلة المسجلة لا يطابق محضر الاستلام');
              }
              await trx
                .updateTable('pharmacy_batches')
                .set({
                  quantity: Number((Number(existingBatch.quantity) + accepted).toFixed(3)),
                  expiry_date: expiryDate,
                  unit_cost: lineUnitCost,
                  status: 'active',
                  updated_at: sql`NOW()`,
                })
                .where('tenant_id', '=', scope.tenantId)
                .where('id', '=', Number(existingBatch.id))
                .execute();
            } else {
              await trx
                .insertInto('pharmacy_batches')
                .values({
                  tenant_id: scope.tenantId,
                  account_id: scope.accountId,
                  product_id: Number(line.productId),
                  drug_id: drug?.id || null,
                  batch_number: batchNumber,
                  expiry_date: expiryDate,
                  quantity: accepted,
                  unit_cost: lineUnitCost,
                  location_id: targetLocationId,
                  supplier_name: grn.supplierName || null,
                  status: 'active',
                  notes: `وارد ${grn.docNo}`,
                })
                .execute();
            }
          }
          if (batchNumber && !drug) {
            // INV-VAN-GENERIC-FEFO: expiry optional (NULL when absent);
            // merge requires identical expiry. The helper owns the
            // validation; drug-linked products never reach it.
            await upsertInventoryBatchFromReceipt(trx, {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              productId: Number(line.productId),
              batchNumber,
              expiryDate,
              qty: accepted,
              unitCost: lineUnitCost,
              locationId: targetLocationId,
              supplierName: grn.supplierName || null,
              notes: `وارد ${grn.docNo}`,
            });
          }
        }
      }

      // INV-SPIRIT-GRN-PENDING-REVIEW: reflect this receipt on its
      // purchase order in the same transaction, after every stock write
      // above succeeded, so a failed receipt advances nothing. Rejected
      // quantities never advance: only accepted stock counts as received.
      // Over-receipt is measured against the ordered quantity still
      // unreceived BEFORE this receipt advances it, in GRN line order,
      // so a second line for the same PO item only counts the part past
      // what the first line already filled. A draft order advances its
      // received quantities but keeps status 'draft' — receiving must
      // not approve the order by side effect.
      let pendingReview = false;
      let pendingReviewReason: string | null = null;
      if (grn.purchaseOrderId) {
        const poRow = await trx
          .selectFrom('purchase_orders')
          .select(['status'])
          .where('id', '=', Number(grn.purchaseOrderId))
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const poUnapproved = String(poRow?.status || '') === 'draft';
        const poItemStates = await trx
          .selectFrom('purchase_order_items')
          .select(['id', 'quantity', 'received_quantity'])
          .where('purchase_order_id', '=', Number(grn.purchaseOrderId))
          .where('tenant_id', '=', scope.tenantId)
          .forUpdate()
          .execute();
        const remainingByItem = new Map<number, number>();
        for (const item of poItemStates) {
          remainingByItem.set(
            Number(item.id),
            Math.max(0, Number(item.quantity || 0) - Number(item.received_quantity || 0)),
          );
        }
        const overReceivedByLineId = new Map<number, number>();
        for (const line of grn.lines) {
          const poItemId = line.purchaseOrderItemId ? Number(line.purchaseOrderItemId) : 0;
          const accepted = Number(line.acceptedQty || 0);
          if (poItemId > 0 && accepted > 0 && remainingByItem.has(poItemId)) {
            const remaining = remainingByItem.get(poItemId) || 0;
            const excess = Math.max(0, Number((accepted - remaining).toFixed(3)));
            if (excess > 0) overReceivedByLineId.set(Number(line.id), excess);
            remainingByItem.set(poItemId, Math.max(0, Number((remaining - accepted).toFixed(3))));
          }
        }
        const receivedByItem = new Map<number, number>();
        for (const line of grn.lines) {
          const accepted = Number(line.acceptedQty || 0);
          const poItemId = line.purchaseOrderItemId ? Number(line.purchaseOrderItemId) : 0;
          if (accepted > 0 && poItemId > 0) {
            receivedByItem.set(poItemId, Number(((receivedByItem.get(poItemId) || 0) + accepted).toFixed(3)));
          }
        }
        if (receivedByItem.size > 0) {
          await advancePurchaseOrderReceipt(
            trx,
            scope.tenantId,
            Number(grn.purchaseOrderId),
            [...receivedByItem.entries()].map(([poItemId, quantity]) => ({ poItemId, quantity })),
            { allowUnapproved: true },
          );
        }
        for (const [lineId, excess] of overReceivedByLineId) {
          await trx
            .updateTable('goods_receipt_lines')
            .set({ over_received_qty: excess })
            .where('id', '=', lineId)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }
        const reasonParts: string[] = [];
        if (poUnapproved) reasonParts.push('أمر الشراء غير معتمد بعد');
        if (overReceivedByLineId.size > 0) reasonParts.push('كمية مستلمة زائدة عن الكمية المطلوبة في أمر الشراء');
        pendingReview = reasonParts.length > 0;
        pendingReviewReason = pendingReview ? `استلام قيد المراجعة: ${reasonParts.join('؛ ')}` : null;
      }

      // 3. Generate GRNI Journal Entry (Dr. Inventory Asset 1140 / Cr. GRNI 2125)
      let grniEntryId: number | null = null;
      if (totalGrniAmount > 0 && roundMoney(totalGrniAmount, moneyDigits) <= 0) {
        throw new BadRequestException('تكلفة البضاعة المستلمة أقل من أصغر وحدة نقدية؛ تعذر إنشاء قيد المخزون.');
      }
      if (totalGrniAmount > 0) {
        const entryDate = grn.receivedAt ? new Date(grn.receivedAt) : new Date();

        const grniAccount = await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '2125');
        const invAccount = await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '1140');

        // Never skip the journal silently. Stock has already been increased above; posting the GRN
        // without its GRNI liability would leave the books short by the full receipt value with no
        // error and no trace.
        if (!grniAccount || !invAccount) {
          throw new BadRequestException(
            'تعذر ترحيل إذن الاستلام: حساب استحقاق البضاعة المستلمة (2125) أو حساب المخزون (1140) غير متاح في شجرة الحسابات.',
          );
        }

        const grniAmount = roundMoney(totalGrniAmount, moneyDigits);

        // INV-GRN-JOURNAL-CENTRAL-POSTING: the GRNI journal posts only
        // through the central boundary on this same transaction. The
        // boundary stamps posted_by/posted_at, numbers the entry JE-<id>,
        // re-rounds both legs at book digits, validates branch/location/
        // partner references against this tenant, and asserts the period
        // is open — the old direct inserts carried none of that, and
        // branch/location reporting missed every GRN journal. The
        // pre-resolved accounts above are kept: resolveAccountByCode
        // creates 1140/2125 when the tenant's chart lacks them, and the
        // boundary would fail closed instead. Double-posting is still
        // guarded by the GRN row lock + posted-status check above;
        // 'goods_receipt' is not a dedup-key source in the boundary.
        grniEntryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'goods_receipt',
          sourceId: grn.id,
          tenantId: scope.tenantId,
          accountId: scope.accountId || scope.tenantId,
          entryDate,
          description: `إثبات استلام بضاعة مخزنية GRNI - إذن رقم ${grn.docNo}`,
          branchId: grnBranchId,
          locationId: grn.locationId,
          createdBy: auth.userId,
          postedBy: auth.userId,
          lines: [
            {
              accountId: Number(invAccount),
              description: `إضافة مخزون مستلم - ${grn.docNo}`,
              debit: grniAmount,
              credit: 0,
              // Inventory is not a supplier sub-ledger account. Tagging it with the supplier
              // polluted supplier statements and aging with inventory debits.
              partnerType: 'none',
              partnerId: null,
              branchId: grnBranchId,
              locationId: grn.locationId,
            },
            {
              accountId: Number(grniAccount),
              description: `استحقاق بضاعة مستلمة غير مفوترة GRNI - ${grn.docNo}`,
              debit: 0,
              credit: grniAmount,
              // postPurchase convention: a supplier partner only when the
              // document carries a real supplier id; a supplier-less
              // receipt posts the liability untagged instead of failing
              // the boundary's partner validation on id 0.
              partnerType: Number(grn.supplierId) > 0 ? 'supplier' : 'none',
              partnerId: Number(grn.supplierId) > 0 ? Number(grn.supplierId) : null,
              branchId: grnBranchId,
              locationId: grn.locationId,
            },
          ],
        });
      }

      await trx
        .updateTable('goods_receipt_notes')
        .set({
          status: 'posted',
          pending_review: pendingReview,
          pending_review_reason: pendingReviewReason,
          grni_journal_entry_id: grniEntryId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where(this.tenantPredicate(auth))
        .execute();

      return {
        success: true,
        grnId: id,
        docNo: grn.docNo,
        status: 'posted',
        pendingReview,
        pendingReviewReason,
        grniJournalEntryId: grniEntryId,
        totalGrniAmount: roundMoney(totalGrniAmount, moneyDigits),
        freightAmount: freight,
      };
    });
  }
}
