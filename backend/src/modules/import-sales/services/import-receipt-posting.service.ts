import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, Transaction, Selectable, Updateable } from 'kysely';
import { Database, ImportShipmentItemTable, ImportShipmentTable } from '../../../database/database.types';
import { groupImportReceipts, requireImportNumber } from '../import-inventory-cost.engine';
import { revalueStockReturn, valueStockReceipt } from '../../accounting/inventory-valuation';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { calculateLandedCostBreakdown } from '../engines/import-landed-cost.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import {
  ReverseImportReceiptDto,
  ResolveLegacyReceiptDto,
  UpdateShipmentItemDto,
} from '../dto/import-sales.dto';

/**
 * INV-IMPORT-SUPPLIER-ATTRIBUTION: apportion a cent-exact total
 * across non-negative bucket weights by share, largest-remainder
 * to the tenant's book minor unit (2dp, or 3dp for KWD/OMR/BHD and
 * the other 3dp currencies — the old cents-only math rounded a
 * one-fils overhead share to a whole cent on a 3dp tenant). The
 * returned shares always sum to exactly `total`
 * (a final correction on the largest weight absorbs float dust),
 * so a split journal can never drift from its single-line total
 * by rounding. Zero total or all-zero weights yield all zeros;
 * the caller decides whether that is a mismatch.
 */
export function apportionByBucketShares(total: number, weights: number[], minorUnits: MoneyDigits = 2): number[] {
  const factor = 10 ** minorUnits;
  const totalMinor = Math.round(Number(total) * factor);
  const shares = weights.map(() => 0);
  const weightSum = weights.reduce((sum, w) => sum + Math.max(0, Number(w) || 0), 0);
  if (totalMinor === 0 || weightSum <= 0) return shares;
  const raw = weights.map((w) => (totalMinor * Math.max(0, Number(w) || 0)) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalMinor - floors.reduce((sum, f) => sum + f, 0);
  const order = raw.map((r, i) => i).sort((a, b) => raw[b] - Math.floor(raw[b]) - (raw[a] - Math.floor(raw[a])));
  for (const i of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  const out = floors.map((f) => Number((f / factor).toFixed(minorUnits)));
  const drift = roundMoney(total - out.reduce((sum, s) => sum + s, 0), minorUnits);
  if (drift !== 0) {
    let largest = 0;
    for (let i = 1; i < weights.length; i += 1) if (weights[i] > weights[largest]) largest = i;
    out[largest] = roundMoney(out[largest] + drift, minorUnits);
  }
  return out;
}

export interface ImportReceiptPostingDeps {
  db: Kysely<any>;
  accountingPosting?: AccountingPostingService;
  // Bound facade kernel methods (same names as the facade members, so the
  // moved bodies are byte-identical). All seven stay in the facade forever:
  // resolveImportReceiptSupplierId + resolveImportProjectCostCenter +
  // costLine + resolveTenantAccount are the receipt-posting kernel;
  // lockShipment + verifyAndConsumeApprovalRequest + assertShipmentEditable
  // are the shared shipment guards.
  resolveImportReceiptSupplierId: (...args: any[]) => any;
  resolveImportProjectCostCenter: (...args: any[]) => any;
  costLine: (...args: any[]) => any;
  resolveTenantAccount: (...args: any[]) => any;
  lockShipment: (...args: any[]) => any;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  assertShipmentEditable: (...args: any[]) => any;
}

/**
 * ImportReceiptPostingService — slice S4 of the import-sales split.
 * Pure move of 5 methods from ImportSalesService
 * (postShipmentToInventory, reversePostedReceipt, resolveLegacyReceipt,
 * calculateLandedCostInTransaction, updateShipmentItem) plus the free
 * function apportionByBucketShares (INV-IMPORT-SUPPLIER-ATTRIBUTION),
 * whose only caller is postShipmentToInventory. No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures. The posting fallback (accountingPosting ??
 * new AccountingPostingService(...)) is preserved verbatim in
 * postShipmentToInventory and reversePostedReceipt. Date keying travels
 * verbatim: receipt/expense dates resolve through resolveBusinessDateKey
 * (tenant day), journal entryDate is the server instant, and
 * resolveLegacyReceipt reports posted_at from the earliest receipt
 * movement as evidence. postShipmentToInventory and
 * calculateLandedCostInTransaction are public here (private in the
 * facade delegate) — the facade, a different class, cannot call a
 * private slice method (tsc TS2341); the facade delegates stay private,
 * so the facade public surface is unchanged.
 */
@Injectable()
export class ImportReceiptPostingService {
  private readonly inventoryDb: Kysely<Database>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveImportReceiptSupplierId: (...args: any[]) => any;
  private readonly resolveImportProjectCostCenter: (...args: any[]) => any;
  private readonly costLine: (...args: any[]) => any;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly lockShipment: (...args: any[]) => any;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  private readonly assertShipmentEditable: (...args: any[]) => any;

  constructor(deps: ImportReceiptPostingDeps) {
    this.inventoryDb = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveImportReceiptSupplierId = deps.resolveImportReceiptSupplierId;
    this.resolveImportProjectCostCenter = deps.resolveImportProjectCostCenter;
    this.costLine = deps.costLine;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.lockShipment = deps.lockShipment;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
    this.assertShipmentEditable = deps.assertShipmentEditable;
  }

  /** Caller holds the shipment lock; status, costs, receipt and stock commit together. */
  async postShipmentToInventory(trx: Transaction<Database>, tenantId: string, shipmentId: string, userId: number, receiptLocationId?: number) {
    // No warehouse can be inferred safely from an unlocated import receipt.
    if (!Number.isSafeInteger(receiptLocationId) || Number(receiptLocationId) <= 0) {
      throw new BadRequestException('يجب تحديد مخزن الاستلام الحقيقي (receiptLocationId) قبل ترحيل الحاوية؛ يمنع إنشاء باتشات بلا موقع.');
    }
    const receivingLocation = await trx.selectFrom('stock_locations').select(['id', 'tenant_id', 'branch_id'])
      .where('id', '=', Number(receiptLocationId)).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!receivingLocation) throw new BadRequestException('مخزن استلام الحاوية غير موجود في المنشأة.');
    const receiptBranchId = receivingLocation.branch_id ? Number(receivingLocation.branch_id) : null;
    const shipment = await trx.selectFrom('import_shipments').selectAll().where('tenant_id', '=', tenantId).where('id', '=', shipmentId).executeTakeFirstOrThrow();
    const items = await trx.selectFrom('import_shipment_items').selectAll()
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).execute();
    if (!items.length) throw new BadRequestException('لا يمكن استلام شحنة بدون أصناف');
    // Fail closed BEFORE any stock or journal write: the payable
    // supplier must be identified now, never defaulted later.
    const effectiveReceiptSupplierId = await this.resolveImportReceiptSupplierId(trx, tenantId, shipment);
    // INV-IMPORT-RECEIPT-JE-SUPPLIER-SUBACCOUNT: resolve the
    // project cost centre BEFORE any stock or journal write, so
    // a missing project row fails closed with zero writes.
    const receiptCostCenterId = await this.resolveImportProjectCostCenter(trx, tenantId, shipment);
    // Never silently allocate more pre-sold stock than the physically received quantity.
    const receivedByProduct = new Map<number, number>();
    for (const item of items) {
      const id = Number(item.product_id);
      const received = Number(item.received_quantity ?? item.quantity);
      receivedByProduct.set(id, (receivedByProduct.get(id) || 0) + received);
    }
    const reserved = await trx.selectFrom('import_container_preorders')
      .select(['product_id', 'reserved_quantity'])
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
      .where('status', '=', 'reserved').execute();
    const bookedByProduct = new Map<number, number>();
    for (const booking of reserved) {
      const id = Number(booking.product_id);
      bookedByProduct.set(id, (bookedByProduct.get(id) || 0) + Number(booking.reserved_quantity));
    }
    for (const [id, qty] of bookedByProduct) {
      if (qty > (receivedByProduct.get(id) || 0) + 0.0001) {
        throw new BadRequestException(`الحجز المسبق للصنف ${id} يتجاوز الكمية المستلمة فعلياً، يجب معالجة العجز والحجوزات قبل الترحيل.`);
      }
    }
    // INV-IMPORT-RECEIPT-BOOK-DIGITS: the receipt journal, the WAC
    // blend and the shortage expense all round at the tenant's book
    // digits, resolved fail-closed on this trx handle (a settings /
    // rates mismatch throws before any stock or journal write).
    // The old code cut every total to a hardcoded 2dp while the
    // groups carried raw floats: on a 3dp tenant the journal said
    // 42.88 for a receipt the pool blended at 42.875.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const groups = groupImportReceipts(items.map((item) => ({ ...this.costLine(item), landedCost: Number(item.landed_cost_egp) })), digits);
    const products = await trx.selectFrom('products').select(['id', 'account_id'])
      .where('tenant_id', '=', tenantId).where('id', 'in', groups.map((group) => group.productId))
      .orderBy('id', 'asc').execute();
    if (products.length !== groups.length) throw new NotFoundException('أحد أصناف الشحنة غير موجود في المنشأة');
    const accountByProduct = new Map(products.map((product) => [Number(product.id), product.account_id]));
    // Lock ALL products, across accounts, in global ID order before touching any location.
    for (const product of products) {
      await lockStockProducts(trx, { tenantId, accountId: product.account_id, productIds: [Number(product.id)] });
    }
    // INV-IMPORT-SUPPLIER-ATTRIBUTION: split the receipt credit
    // into per-component lines BEFORE any write, so a missing
    // payee fails closed with zero writes. Until this package the
    // whole landed value (goods + freight + customs + transport
    // + demurrage) was credited to one payable line attributed
    // to the goods supplier: the goods subledger was overstated
    // and the carrier/customs/transporter payees had no record.
    // The split is derived from stored values only (no engine
    // recomputation): goods = ordered qty x factory price x the
    // arrival rate updateShipmentCosts recalculated with in this
    // same transaction; the overhead residual (total landed less
    // goods) is apportioned across the shipment buckets net of
    // the broker-folded portion of each bucket, so the component
    // lines always sum to exactly the old single-line total. A
    // final dust correction on the goods line (at most a cent of
    // 4-decimal unit rounding) keeps the journal balanced to the
    // cent; a residual more than 0.50 below zero means the stored
    // costs disagree with the arrival rate and fails closed.
    const totalInventoryValue = roundMoney(groups.reduce((sum, g) => sum + g.value, 0), digits);
    const totalShortageExpense = roundMoney(groups.reduce((sum, g) => sum + g.shortageExpense, 0), digits);
    const totalCreditPayable = roundMoney(totalInventoryValue + totalShortageExpense, digits);
    const foldedRows = await trx.selectFrom('import_broker_capitalizations')
      .select(['id', 'broker_expense_id', 'amount_egp', 'cost_bucket'])
      .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).where('state', '=', 'folded')
      .execute();
    const foldedBrokerTotal = roundMoney(foldedRows.reduce((sum, r) => sum + Number(r.amount_egp || 0), 0), digits);
    if (foldedBrokerTotal > totalInventoryValue + 0.001) {
      throw new BadRequestException('إجمالي مصروفات المخلص المرسملة يتجاوز قيمة المخزون المستلم؛ راجع بنود تكلفة الشحنة قبل الترحيل. [IMPORT_BROKER_CAPITALIZATION_EXCEEDS_LANDED]');
    }
    const arrivalRateForSplit = requireImportNumber(shipment.exchange_rate_at_arrival, 'سعر الصرف عند الوصول', Number.MIN_VALUE);
    const goodsValue = roundMoney(items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.factory_unit_price_usd || 0) * arrivalRateForSplit, 0), digits);
    const overheadResidual = roundMoney(totalCreditPayable - goodsValue, digits);
    if (overheadResidual < -0.5) {
      throw new BadRequestException('تعذر تقسيم قيد الاستلام على بنود التكلفة: قيمة البضاعة المحسوبة بسعر الوصول تتجاوز إجمالي التكلفة المحملة؛ راجع سعر الصرف وبنود الشحنة قبل الترحيل. [IMPORT_RECEIPT_COMPONENT_SPLIT_MISMATCH]');
    }
    const foldedByBucket = new Map<string, number>();
    for (const row of foldedRows) {
      const bucket = String((row as any).cost_bucket || '');
      foldedByBucket.set(bucket, (foldedByBucket.get(bucket) || 0) + Number(row.amount_egp || 0));
    }
    // INV-IMPORT-LANDED-COST-DUTY-VAT: duty/VAT itemized on the
    // same CIF basis as the landed-cost engine, from the raw USD
    // values so the engine total and the split agree to the cent:
    // CIF = (goods + freight + insurance) x the arrival rate;
    // duty on CIF, VAT on (CIF + duty), intermediates unrounded
    // exactly like the engine. The insurance rides with the
    // freight payee, duty/VAT with the customs payee — no new
    // payee type, no new GL account.
    const cifUsd = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.factory_unit_price_usd || 0), 0)
      + Number(shipment.shipping_cost_usd || 0) + Number(shipment.insurance_cost_usd || 0);
    const cifEgp = cifUsd * arrivalRateForSplit;
    const rawDutyEgp = cifEgp * (Math.max(0, Number(shipment.customs_duty_rate_percent || 0)) / 100);
    const bucketTotals = {
      freight: roundMoney(Number(shipment.shipping_cost_usd || 0) * arrivalRateForSplit, digits),
      customs: roundMoney(Number(shipment.customs_cost_egp || 0), digits),
      transport: roundMoney(Number(shipment.internal_transport_cost_egp || 0), digits),
      demurrage: roundMoney(Number(shipment.actual_demurrage_fees || 0), digits),
      insurance: roundMoney(Number(shipment.insurance_cost_usd || 0) * arrivalRateForSplit, digits),
      duty: roundMoney(rawDutyEgp, digits),
      vat: roundMoney((cifEgp + rawDutyEgp) * (Math.max(0, Number(shipment.vat_rate_percent || 0)) / 100), digits),
    };
    const netWeights = [
      Math.max(0, bucketTotals.freight),
      Math.max(0, bucketTotals.customs - (foldedByBucket.get('customs_cost_egp') || 0)),
      Math.max(0, bucketTotals.transport - (foldedByBucket.get('internal_transport_cost_egp') || 0)),
      Math.max(0, bucketTotals.demurrage - (foldedByBucket.get('actual_demurrage_fees') || 0)),
      Math.max(0, bucketTotals.duty),
      Math.max(0, bucketTotals.vat),
      Math.max(0, bucketTotals.insurance),
    ];
    const payableOverhead = roundMoney(overheadResidual - foldedBrokerTotal, digits);
    if (payableOverhead < -0.005) {
      throw new BadRequestException('إجمالي مصروفات المخلص المرسملة يتجاوز الأعباء المستحقة؛ راجع بنود تكلفة الشحنة قبل الترحيل. [IMPORT_BROKER_CAPITALIZATION_EXCEEDS_LANDED]');
    }
    const overheadKeys = ['freight', 'customs', 'transport', 'demurrage', 'duty', 'vat', 'insurance'] as const;
    const overheadLabels: Record<string, string> = { freight: 'شحن بحري', customs: 'جمارك وتخليص', transport: 'نقل داخلي', demurrage: 'غرامات تأخير وأرضيات', duty: 'رسوم جمركية (ضريبة)', vat: 'ضريبة قيمة مضافة', insurance: 'تأمين شحن' };
    const overheadPayeeColumns: Record<string, string> = {
      freight: 'freight_supplier_id', customs: 'customs_supplier_id',
      transport: 'transport_supplier_id', demurrage: 'demurrage_supplier_id',
      duty: 'customs_supplier_id', vat: 'customs_supplier_id',
      insurance: 'freight_supplier_id',
    };
    const overheadShares = apportionByBucketShares(payableOverhead, netWeights, digits);
    const unallocableReason = typeof (shipment as any).unallocable_cost_reason === 'string'
      ? (shipment as any).unallocable_cost_reason.trim() : '';
    let clearingAccountId: number | null = null;
    const resolveComponentPayee = async (
      key: string, amount: number,
    ): Promise<{ kind: 'supplier'; supplierId: number } | { kind: 'clearing'; reason: string }> => {
      const supplierId = Number((shipment as any)[overheadPayeeColumns[key]]);
      if (Number.isSafeInteger(supplierId) && supplierId > 0) {
        const supplier = await trx.selectFrom('suppliers').select('id')
          .where('tenant_id', '=', tenantId).where('id', '=', supplierId).executeTakeFirst();
        if (supplier) return { kind: 'supplier', supplierId };
        throw new BadRequestException(`مورد بند التكلفة (${overheadLabels[key]}) غير موجود في هذه المنشأة؛ حدد مورداً حقيقياً قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
      }
      // Clearing is ONLY for a fee proven genuinely unallocable:
      // the reason must be recorded on the shipment, and the
      // credit posts to the tenant-designated clearing account,
      // labelled with the reason — never silently to the goods
      // supplier or any other default payee.
      if (unallocableReason) {
        if (clearingAccountId === null) clearingAccountId = await this.resolveTenantAccount(trx, tenantId, 'clearing');
        return { kind: 'clearing', reason: unallocableReason };
      }
      throw new BadRequestException(`لا يمكن ترحيل بند التكلفة (${overheadLabels[key]}) بلا مورد محدد: حدد مورد البند أو سجل سبب عدم قابلية التخصيص قبل الترحيل. [IMPORT_COMPONENT_PAYEE_REQUIRED]`);
    };
    type ReceiptCreditComponent = {
      key: string; label: string; amount: number;
      payee: { kind: 'supplier'; supplierId: number } | { kind: 'clearing'; reason: string };
      clearingAccountId?: number | null;
    };
    const receiptCreditComponents: ReceiptCreditComponent[] = [];
    const payableTotal = roundMoney(totalCreditPayable - foldedBrokerTotal, digits);
    const dust = roundMoney(payableTotal - (goodsValue + totalShortageExpense + overheadShares.reduce((s, v) => s + v, 0)), digits);
    let goodsCredit = roundMoney(goodsValue + totalShortageExpense + dust, digits);
    const overheadEntries = overheadKeys
      .map((key, i) => ({ key, amount: overheadShares[i] }))
      .filter((entry) => entry.amount > 0);
    if (goodsCredit <= 0 && overheadEntries.length > 0) {
      // A zero-goods shipment (free goods + freight): the dust
      // correction rides on the largest overhead component so the
      // split still sums exactly, with no goods line at all.
      let largest = overheadEntries[0];
      for (const entry of overheadEntries) if (entry.amount > largest.amount) largest = entry;
      largest.amount = roundMoney(largest.amount + dust, digits);
      goodsCredit = 0;
    }
    if (goodsCredit > 0) {
      receiptCreditComponents.push({
        key: 'goods', label: 'بضاعة', amount: goodsCredit,
        payee: { kind: 'supplier', supplierId: effectiveReceiptSupplierId },
      });
    }
    for (const entry of overheadEntries) {
      const payee = await resolveComponentPayee(entry.key, entry.amount);
      receiptCreditComponents.push({
        key: entry.key, label: overheadLabels[entry.key], amount: entry.amount, payee,
        clearingAccountId: payee.kind === 'clearing' ? clearingAccountId : null,
      });
    }
    const receipt = await trx.insertInto('import_inventory_receipts').values({
      tenant_id: tenantId, shipment_id: shipmentId, state: 'posted', review_reason: null,
      posted_at: new Date(), created_by: userId,
    }).returning('id').executeTakeFirstOrThrow();
    for (const group of groups) {
      const accountId = accountByProduct.get(group.productId);
      if (!accountId) throw new BadRequestException('حساب الصنف غير صالح');
      if (group.quantity > 0) {
        // Phase 1 A10: the row goes through recordStockMovement
        // (full-precision mode) — the total is computed from the FULL
        // value / qty (totalUnitCost), not the 6dp stored unit: the
        // group value is already book-rounded (groupImportReceipts
        // rounds it once at book digits), so roundMoney(qty x
        // value/qty) reproduces it exactly at any qty (BF2/BF2b), while
        // the 6dp unit diverges on most lines at container quantities.
        // The stored unit stays the 6dp value, exactly as today.
        const stock = await recordStockMovement(trx, {
          tenantId,
          accountId,
          productId: group.productId,
          delta: group.quantity,
          allowNegative: true,
          locationId: Number(receiptLocationId),
          disableAutoDrain: true,
          movementType: 'import_receipt',
          unitCost: Number((group.value / group.quantity).toFixed(6)),
          totalUnitCost: group.value / group.quantity,
          moneyDigits: digits,
          referenceType: 'import_inventory_receipt',
          referenceId: receipt.id,
          importReceiptId: receipt.id,
          reason: 'استلام شحنة استيراد',
          note: `شحنة استيراد #${shipmentId}`,
          createdBy: userId,
          branchId: null,
        });
        // globalBefore is a cached product counter. globalAfter is reconciled by the ledger
        // from locked location balances (including its legacy unassigned-stock policy).
        // INV-WAC-SINGLE-WRITER: the one writer blends the receipt
        // through the canonical engine. The product row is locked by
        // lockStockProducts above, so the writer's read cannot miss
        // it; id is the global primary key, so the old account_id
        // predicate on the write was vestigial.
        await valueStockReceipt(trx, tenantId, group.productId, stock.globalAfter, group.quantity, group.value);
      }
      if (group.shortageExpense > 0) {
        await trx.insertInto('expenses').values({
          tenant_id: tenantId, account_id: accountId,
          title: `خسائر نواقص حاوية (تسوية عجز) - صنف ${group.productId}`,
          amount: roundMoney(group.shortageExpense, digits), expense_date: await resolveBusinessDateKey(trx, tenantId, new Date()),
          note: `شحنة استيراد #${shipmentId} - سند استلام ${receipt.id}`,
          created_by: userId, branch_id: null, location_id: null,
        }).execute();
      }
    }

    for (const item of items) {
      const receivedQty = Number(item.received_quantity ?? item.quantity);
      const unitLandedCost = Number(Number(item.landed_cost_egp || 0).toFixed(4));
      const cleanContainer = (shipment.container_number || 'CONT').replace(/[^a-zA-Z0-9]/g, '');
      const lotNumber = 'LOT-' + cleanContainer.slice(0, 25) + '-' + item.product_id + '-' + item.id;

      await trx
        .insertInto('import_inventory_lots')
        .values({
          tenant_id: tenantId,
          lot_number: lotNumber,
          project_id: shipment.project_id || null,
          shipment_id: shipmentId,
          shipment_item_id: item.id,
          product_id: Number(item.product_id),
          location_id: Number(receiptLocationId),
          initial_quantity: receivedQty,
          remaining_quantity: receivedQty,
          unit_landed_cost_egp: unitLandedCost,
          status: 'active',
          receipt_date: await resolveBusinessDateKey(trx, tenantId, new Date()),
        } as any)
        .execute();
    }

    // --- ACCOUNTING: Double-entry journal for inventory receipt ---
    // DR: Inventory (at total landed cost of all received goods)
    // DR: Shortage Expense (if any items had shortage_handling_method = 'expense')
    // CR: one payable/clearing line PER COST COMPONENT
    // (INV-IMPORT-SUPPLIER-ATTRIBUTION), each attributed to its
    // explicit payee, less the broker costs already spent from
    // broker advances and folded into the shipment buckets
    // (INV-IMPORT-BROKER-CAPITALISATION). Those folded amounts
    // reach inventory through the landed cost above, but they
    // were never owed to a supplier: the credit for them
    // relieves the broker-advance asset instead. The split keeps
    // the journal balanced and every supplier subledger honest,
    // and the package-3 reversal mirrors all credit legs because
    // they share this one journal (it mirrors lines generically).
    // The component amounts and payees were resolved before any
    // stock or receipt write above; this block only posts them.
    if (totalCreditPayable > 0) {
      const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const inventoryAccountId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
      const needsPayableAccount = receiptCreditComponents.some((c) => c.payee.kind === 'supplier');
      const payableAccountId = needsPayableAccount ? await this.resolveTenantAccount(trx, tenantId, 'payable') : null;

      const journalLines: Array<{
        accountId: number; description: string;
        debit: number; credit: number;
        partnerType: 'supplier' | 'none'; partnerId: number | null;
        branchId: number | null; locationId: number | null;
        costCenterId: number | null;
      }> = [];

      // DR: Inventory (landed cost value of physically received goods)
      if (totalInventoryValue > 0) {
        journalLines.push({
          accountId: inventoryAccountId,
          description: `استلام مخزون استيراد - حاوية ${shipment.container_number || shipmentId}`,
          debit: totalInventoryValue,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: receiptBranchId,
          locationId: Number(receiptLocationId),
          costCenterId: receiptCostCenterId,
        });
      }

      // DR: Shortage Expense (shortages handled as expense, not capitalized)
      if (totalShortageExpense > 0) {
        const cogsAccountId = await this.resolveTenantAccount(trx, tenantId, 'cogs');
        journalLines.push({
          accountId: cogsAccountId,
          description: `خسائر نواقص حاوية (تسوية عجز) - حاوية ${shipment.container_number || shipmentId}`,
          debit: totalShortageExpense,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: receiptBranchId,
          locationId: Number(receiptLocationId),
          costCenterId: receiptCostCenterId,
        });
      }

      // CR: one line per cost component, each to its explicit
      // payee (supplier payable) or, for a component with a
      // recorded unallocable reason, to the designated clearing
      // account labelled with the reason. The component lines
      // sum to exactly the old single-line total.
      for (const component of receiptCreditComponents) {
        if (component.payee.kind === 'supplier') {
          journalLines.push({
            accountId: payableAccountId!,
            description: `استحقاق مورد استيراد (${component.label}) - حاوية ${shipment.container_number || shipmentId}`,
            debit: 0,
            credit: component.amount,
            partnerType: 'supplier',
            partnerId: component.payee.supplierId,
            branchId: receiptBranchId,
            locationId: Number(receiptLocationId),
            costCenterId: receiptCostCenterId,
          });
        } else {
          journalLines.push({
            accountId: component.clearingAccountId!,
            description: `استحقاق غير قابل للتخصيص (${component.label}) - سبب: ${component.payee.reason} - حاوية ${shipment.container_number || shipmentId}`,
            debit: 0,
            credit: component.amount,
            partnerType: 'none',
            partnerId: null,
            branchId: receiptBranchId,
            locationId: Number(receiptLocationId),
            costCenterId: receiptCostCenterId,
          });
        }
      }

      // CR: Broker-advance asset (folded broker costs already
      // spent from the advance; no supplier payable arises)
      if (foldedBrokerTotal > 0) {
        const advanceAccountId = await this.resolveTenantAccount(trx, tenantId, 'broker_advance');
        journalLines.push({
          accountId: advanceAccountId,
          description: `تخفيض عهدة المخلص الجمركي بمصروفات مرسملة - حاوية ${shipment.container_number || shipmentId}`,
          debit: 0,
          credit: foldedBrokerTotal,
          partnerType: 'none',
          partnerId: null,
          branchId: receiptBranchId,
          locationId: Number(receiptLocationId),
          costCenterId: receiptCostCenterId,
        });
      }

      const journalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_inventory_receipt',
        sourceId: Number(receipt.id),
        tenantId,
        accountId: tenantId,
        entryDate: new Date(),
        description: `قيد استلام مخزون استيراد - حاوية ${shipment.container_number || shipmentId} (سند استلام #${receipt.id})`,
        branchId: receiptBranchId,
        locationId: Number(receiptLocationId),
        createdBy: userId,
        postedBy: userId,
        lines: journalLines,
      });

      await trx.updateTable('import_inventory_receipts')
        .set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', receipt.id)
        .execute();
    }

    // Consume the folded capitalisations: the receipt journal
    // above is their single GL recognition. A consumed fold can
    // never be recognised again, and the expense rows record the
    // same transition so the two sides of the link always agree.
    if (foldedRows.length > 0) {
      await trx.updateTable('import_broker_capitalizations')
        .set({ state: 'consumed' })
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', foldedRows.map((r) => Number(r.id)))
        .execute();
      await trx.updateTable('import_broker_expenses')
        .set({ capitalization_state: 'consumed' })
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', foldedRows.map((r) => r.broker_expense_id))
        .execute();
    }

    await trx
      .updateTable('import_container_preorders')
      .set({ status: 'allocated' })
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .where('status', '=', 'reserved')
      .execute();
  }
  /**
   * Approval-gated, prospective-only reversal of a posted import
   * receipt (INV-IMPORT-RECEIPT-REVERSAL). The original receipt
   * row and the original journal are NEVER rewritten or deleted:
   * stock is restored, the WAC is un-blended through the
   * canonical engine, lots are zeroed and marked reversed,
   * allocated preorders return to reserved, and a REVERSAL
   * journal mirrors the original lines exactly (debit/credit
   * swapped) through the posting boundary with the reversal
   * link. Everything commits in one transaction: a failure
   * anywhere (including a closed period at the posting
   * boundary) rolls the whole correction back.
   *
   * Fail-closed blockers, all checked before any write:
   * no approval token; no single posted receipt; a reversal
   * already exists; the project is closed; a late-expense
   * revaluation already spread this shipment's costs; a lot was
   * consumed or is missing; an invoiced preorder exists; no
   * receipt movements exist; the original journal was already
   * reversed. The shipment status is left at 'Arrived': the
   * reversal is a terminal correction, not a re-receipt path —
   * re-receipt needs a new shipment record (recorded residual).
   * Shortage `expenses` rows from the original posting are left
   * as historical records; the reversal journal offsets their GL
   * effect (recorded residual: no FK links them to the receipt).
   */
  async reversePostedReceipt(tenantId: string, userId: number, shipmentId: string, dto: ReverseImportReceiptDto) {
    if (!dto.approvalRequestId?.trim()) {
      throw new BadRequestException('عكس استلام الشحنة يتطلب موافقة Maker-Checker معتمدة.');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('عكس الاستلام يتطلب سبباً موثقاً.');
    }
    return await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment } = state;

      const receipts = await trx.selectFrom('import_inventory_receipts').selectAll()
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
        .orderBy('id', 'asc').execute();
      const posted = receipts.filter((r) => r.state === 'posted');
      if (posted.length === 0) {
        throw new BadRequestException('لا يوجد سند استلام مرحل لعكسه على هذه الشحنة. [IMPORT_RECEIPT_REVERSAL_NO_POSTED_RECEIPT]');
      }
      if (posted.length > 1) {
        throw new BadRequestException('يوجد أكثر من سند استلام مرحل على الشحنة؛ العكس يتطلب سنداً واحداً فقط. [IMPORT_RECEIPT_REVERSAL_AMBIGUOUS_RECEIPT]');
      }
      const receipt = posted[0];
      const receiptId = Number(receipt.id);

      const existingReversal = await trx.selectFrom('import_inventory_receipt_reversals').select('id')
        .where('tenant_id', '=', tenantId).where('receipt_id', '=', receiptId).executeTakeFirst();
      if (existingReversal) {
        throw new BadRequestException('سند الاستلام هذا تم عكسه مسبقاً ولا يمكن عكسه مرة أخرى. [IMPORT_RECEIPT_ALREADY_REVERSED]');
      }

      if (shipment.project_id) {
        const project = await trx.selectFrom('import_projects').select('status')
          .where('tenant_id', '=', tenantId).where('id', '=', shipment.project_id).executeTakeFirst();
        if (project?.status === 'closed') {
          throw new BadRequestException('لا يمكن عكس استلام شحنة تابعة لمشروع مقفل. [IMPORT_RECEIPT_REVERSAL_PROJECT_CLOSED]');
        }
      }

      const lateEvent = await trx.selectFrom('import_late_expense_events').select('id')
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).executeTakeFirst();
      if (lateEvent) {
        throw new BadRequestException('لا يمكن عكس الاستلام بعد تحميل مصروفات متأخرة على الشحنة؛ التكلفة أعيد توزيعها بالفعل. [IMPORT_RECEIPT_REVERSAL_LATE_EXPENSE_EXISTS]');
      }

      const invoicedPreorder = await trx.selectFrom('import_container_preorders').select('id')
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
        .where('status', '=', 'invoiced').executeTakeFirst();
      if (invoicedPreorder) {
        throw new BadRequestException('لا يمكن عكس الاستلام بعد فوترة حجز مسبق من الشحنة. [IMPORT_RECEIPT_REVERSAL_PREORDER_INVOICED]');
      }

      const lots = await trx.selectFrom('import_inventory_lots').selectAll()
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId).execute();
      if (!lots.length) {
        throw new BadRequestException('لا توجد باتشات مخزنية لسند الاستلام؛ لا يمكن التحقق من سلامة العكس. [IMPORT_RECEIPT_REVERSAL_NO_LOTS]');
      }
      for (const lot of lots) {
        const initial = Number(lot.initial_quantity || 0);
        const remaining = Number(lot.remaining_quantity || 0);
        if (lot.status !== 'active' || Math.abs(remaining - initial) > 0.0001) {
          throw new BadRequestException(`لا يمكن عكس الاستلام: الباتش ${lot.lot_number} تم استهلاك جزء منه أو لم يعد نشطاً. [IMPORT_RECEIPT_REVERSAL_LOT_CONSUMED]`);
        }
      }

      const movements = await trx.selectFrom('stock_movements').selectAll()
        .where('tenant_id', '=', tenantId).where('import_receipt_id', '=', receiptId)
        .where('movement_type', '=', 'import_receipt').execute();
      if (!movements.length) {
        throw new BadRequestException('لا توجد حركات مخزنية لسند الاستلام؛ لا يمكن استعادة الرصيد من مصدر موثوق. [IMPORT_RECEIPT_REVERSAL_NO_MOVEMENTS]');
      }
      const groups = new Map<string, { productId: number; accountId: string; locationId: number; quantity: number; value: number }>();
      for (const movement of movements) {
        const productId = Number(movement.product_id);
        const qty = Number(movement.qty || 0);
        const value = Number(movement.total_cost || 0);
        if (!Number.isSafeInteger(productId) || productId <= 0 || qty <= 0 || value < 0) {
          throw new BadRequestException('حركة مخزنية غير متسقة لسند الاستلام؛ العكس مرفوض. [IMPORT_RECEIPT_REVERSAL_INCONSISTENT_MOVEMENT]');
        }
        const key = `${productId}:${movement.location_id}`;
        const existing = groups.get(key);
        if (existing) {
          existing.quantity = Number((existing.quantity + qty).toFixed(3));
          existing.value = Number((existing.value + value).toFixed(4));
        } else {
          groups.set(key, {
            productId,
            accountId: String(movement.account_id),
            locationId: Number(movement.location_id),
            quantity: qty,
            value,
          });
        }
      }

      let originalJournal: { id: number; branch_id: number | null; location_id: number | null; reversed_by_entry_id: number | null | undefined } | undefined;
      if (receipt.journal_entry_id) {
        originalJournal = await trx.selectFrom('journal_entries')
          .select(['id', 'branch_id', 'location_id', 'reversed_by_entry_id'])
          .where('tenant_id', '=', tenantId).where('id', '=', Number(receipt.journal_entry_id)).executeTakeFirst();
        if (!originalJournal) {
          throw new BadRequestException('قيد الاستلام الأصلي المشار إليه غير موجود؛ العكس مرفوض. [IMPORT_RECEIPT_REVERSAL_JOURNAL_MISSING]');
        }
        if (originalJournal?.reversed_by_entry_id) {
          throw new BadRequestException('قيد الاستلام الأصلي تم عكسه مسبقاً. [IMPORT_RECEIPT_REVERSAL_JOURNAL_REVERSED]');
        }
      }

      // Maker-checker: the token is bound to this shipment and
      // this receipt, single-use, and consumed here. The helper
      // returns silently without a token, so the token is
      // required above; the payload binding below rejects a
      // token minted for a different receipt.
      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'import_receipt_reversal', shipmentId, dto.approvalRequestId, {
        shipmentId,
        receiptId: String(receiptId),
      });

      // Lock ALL products in global ID order before touching any
      // location (canonical lock order), exactly as posting does.
      const productIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.productId))).sort((a, b) => a - b);
      const accountByProduct = new Map<number, string>();
      for (const group of groups.values()) accountByProduct.set(group.productId, group.accountId);
      for (const productId of productIds) {
        await lockStockProducts(trx, { tenantId, accountId: accountByProduct.get(productId)!, productIds: [productId] });
      }

      // Phase 1 A10: book digits, resolved fail-closed on this trx
      // handle — the reversal groups are built from the ORIGINAL rows'
      // stored totals (already book-digit values after :339 migrates),
      // so the writer's roundMoney(qty x value/qty) reproduces each
      // reversal total exactly (BF3: 0/2M).
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      for (const group of groups.values()) {
        // Phase 1 A10: the row goes through recordStockMovement
        // (full-precision mode) — same totalUnitCost shape as :339.
        const stock = await recordStockMovement(trx, {
          tenantId,
          accountId: group.accountId,
          productId: group.productId,
          delta: -group.quantity,
          allowNegative: false,
          locationId: group.locationId,
          disableAutoDrain: true,
          movementType: 'import_receipt_reversal',
          unitCost: Number((group.value / group.quantity).toFixed(6)),
          totalUnitCost: group.value / group.quantity,
          moneyDigits: digits,
          referenceType: 'import_inventory_receipt',
          referenceId: receiptId,
          importReceiptId: receiptId,
          reason: 'عكس استلام شحنة استيراد',
          note: `عكس سند استلام #${receiptId} - شحنة استيراد #${shipmentId}`,
          createdBy: userId,
          branchId: null,
        });
        // The WAC un-blend mirrors valueStockReceipt: the delta's
        // corrected globalAfter already includes this deduction.
        await revalueStockReturn(trx, tenantId, group.productId, stock.globalAfter, group.quantity, group.value);
      }

      for (const lot of lots) {
        const updated = await trx.updateTable('import_inventory_lots')
          .set({ remaining_quantity: 0, status: 'reversed' })
          .where('tenant_id', '=', tenantId).where('id', '=', lot.id)
          .where('status', '=', 'active')
          .where('remaining_quantity', '=', lot.remaining_quantity)
          .executeTakeFirst();
        if (Number(updated.numUpdatedRows || 0) !== 1) {
          throw new BadRequestException(`تعارض متزامن على الباتش ${lot.lot_number} أثناء العكس؛ أعد المحاولة. [IMPORT_RECEIPT_REVERSAL_LOT_RACE]`);
        }
      }

      await trx.updateTable('import_container_preorders').set({ status: 'reserved' })
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
        .where('status', '=', 'allocated').execute();

      // Mirror journal: the original lines exactly, debit and
      // credit swapped, through the posting boundary with the
      // reversal link. No journal exists when the original
      // receipt posted none (zero value): then there is nothing
      // to mirror and no journal is created.
      let reversalJournalId: number | null = null;
      if (originalJournal) {
        const originalLines = await trx.selectFrom('journal_entry_lines').selectAll()
          .where('tenant_id', '=', tenantId).where('journal_entry_id', '=', Number(originalJournal.id))
          .orderBy('id', 'asc').execute();
        if (!originalLines.length) {
          throw new BadRequestException('قيد الاستلام الأصلي بلا سطور؛ لا يمكن عكس قيد غير مكتمل. [IMPORT_RECEIPT_REVERSAL_EMPTY_JOURNAL]');
        }
        const postingService = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        reversalJournalId = await postingService.postDomainJournal(trx, {
          sourceType: 'import_inventory_receipt_reversal',
          sourceId: receiptId,
          tenantId,
          accountId: tenantId,
          entryDate: new Date(),
          description: `قيد عكس استلام مخزون استيراد - سند استلام #${receiptId} (شحنة ${shipmentId})`,
          branchId: originalJournal.branch_id ? Number(originalJournal.branch_id) : null,
          locationId: originalJournal.location_id ? Number(originalJournal.location_id) : null,
          createdBy: userId,
          postedBy: userId,
          reversalOfEntryId: Number(originalJournal.id),
          lines: originalLines.map((line) => ({
            accountId: Number(line.account_id),
            description: `عكس: ${line.description}`,
            debit: Number(line.credit || 0),
            credit: Number(line.debit || 0),
            partnerType: (line.partner_type as 'none' | 'customer' | 'supplier' | 'employee') || 'none',
            partnerId: line.partner_id ? Number(line.partner_id) : null,
            branchId: line.branch_id ? Number(line.branch_id) : null,
            locationId: line.location_id ? Number(line.location_id) : null,
            costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
          })),
        });
      }

      const reversal = await trx.insertInto('import_inventory_receipt_reversals').values({
        tenant_id: tenantId, receipt_id: receiptId, shipment_id: shipmentId,
        approval_request_id: dto.approvalRequestId, journal_entry_id: reversalJournalId,
        reason: dto.reason.trim(), created_by: userId,
      }).returning('id').executeTakeFirstOrThrow();

      return {
        success: true,
        shipmentId,
        receiptId,
        reversalId: Number(reversal.id),
        journalEntryId: reversalJournalId,
        restoredGroups: Array.from(groups.values()).map((g) => ({ productId: g.productId, quantity: g.quantity, value: g.value })),
      };
    });
  }
  /**
   * Approval-gated review/resolve path for shipments frozen in
   * legacy_review_required (INV-IMPORT-LEGACY-RECEIPT-REVIEW).
   * No silent unfreeze: the caller proves the receipt really
   * posted (a posted journal AND at least one receipt stock
   * movement) and a maker-checker approval bound to the shipment
   * and receipt authorizes the transition. posted_at is set to
   * the earliest receipt movement date — evidence, never
   * fabricated. No stock, lot or journal write happens here:
   * the receipt already posted; this only unfreezes its state.
   * Legacy rows with no journal and no movements (the migration
   * 0231 seed shape) can never satisfy the proof and stay frozen.
   */
  async resolveLegacyReceipt(tenantId: string, userId: number, shipmentId: string, dto: ResolveLegacyReceiptDto) {
    if (!dto.approvalRequestId?.trim()) {
      throw new BadRequestException('مراجعة الاستلام القديم تتطلب موافقة Maker-Checker معتمدة.');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('مراجعة الاستلام القديم تتطلب سبباً موثقاً.');
    }
    return await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment } = state;

      const receipts = await trx.selectFrom('import_inventory_receipts').selectAll()
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', shipmentId)
        .orderBy('id', 'asc').execute();
      const frozen = receipts.filter((r) => r.state === 'legacy_review_required');
      if (frozen.length === 0) {
        throw new BadRequestException('لا يوجد سند استلام مجمد بانتظار المراجعة على هذه الشحنة. [IMPORT_LEGACY_REVIEW_NO_FROZEN_RECEIPT]');
      }
      if (frozen.length > 1) {
        throw new BadRequestException('يوجد أكثر من سند مجمد على الشحنة؛ المراجعة تتطلب سنداً واحداً فقط. [IMPORT_LEGACY_REVIEW_AMBIGUOUS_RECEIPT]');
      }
      const receipt = frozen[0];
      const receiptId = Number(receipt.id);

      if (shipment.project_id) {
        const project = await trx.selectFrom('import_projects').select('status')
          .where('tenant_id', '=', tenantId).where('id', '=', shipment.project_id).executeTakeFirst();
        if (project?.status === 'closed') {
          throw new BadRequestException('لا يمكن مراجعة استلام شحنة تابعة لمشروع مقفل. [IMPORT_LEGACY_REVIEW_PROJECT_CLOSED]');
        }
      }

      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'import_legacy_receipt_review', shipmentId, dto.approvalRequestId, {
        shipmentId,
        receiptId: String(receiptId),
      });

      // Proof: a posted journal AND at least one receipt movement.
      // Either one alone is not proof the receipt posted.
      let journalPosted = false;
      if (receipt.journal_entry_id) {
        const journal = await trx.selectFrom('journal_entries').select(['id', 'status'])
          .where('tenant_id', '=', tenantId).where('id', '=', Number(receipt.journal_entry_id)).executeTakeFirst();
        journalPosted = journal?.status === 'posted';
      }
      const movements = await trx.selectFrom('stock_movements')
        .select(['id', 'created_at'])
        .where('tenant_id', '=', tenantId).where('import_receipt_id', '=', receiptId)
        .where('movement_type', '=', 'import_receipt')
        .orderBy('created_at', 'asc').execute();
      if (!journalPosted || !movements.length) {
        throw new BadRequestException('لا يمكن اعتماد الاستلام القديم بلا دليل ترحيل: يلزم قيد مرحل وحركة مخزنية واحدة على الأقل. [IMPORT_LEGACY_REVIEW_NO_PROOF]');
      }
      const postedAt = movements[0].created_at ? new Date(movements[0].created_at) : new Date();
      await trx.updateTable('import_inventory_receipts')
        .set({ state: 'posted', posted_at: postedAt })
        .where('tenant_id', '=', tenantId).where('id', '=', receiptId).execute();

      return { success: true, shipmentId, receiptId, postedAt: postedAt.toISOString() };
    });
  }
  async calculateLandedCostInTransaction(
    trx: Transaction<Database>,
    shipment: Selectable<ImportShipmentTable>
  ) {
    const items = await trx
      .selectFrom('import_shipment_items')
      .selectAll()
      .where('tenant_id', '=', shipment.tenant_id)
      .where('shipment_id', '=', shipment.id)
      .execute();

    if (!items.length) {
      return { success: true, message: 'لا توجد أصناف بالشحنة' };
    }

    // INV-IMPORT-ARRIVAL-RATE-FAIL-CLOSED: a missing, zero,
    // negative or non-finite arrival rate fails closed with a named
    // shipment-specific error. The generic requireImportNumber
    // below cannot carry this meaning, and the migration-2033
    // DEFAULT 1 used to make every fresh shipment silently pass
    // at rate 1. No item may be costed and no shipment may post
    // on an invented rate.
    const arrivalRateRaw = shipment.exchange_rate_at_arrival;
    if (arrivalRateRaw === null || arrivalRateRaw === undefined || !Number.isFinite(Number(arrivalRateRaw)) || Number(arrivalRateRaw) <= 0) {
      throw new BadRequestException(
        'لا يمكن احتساب التكلفة المحملة أو ترحيل الشحنة بلا سعر صرف وصول حقيقي وموجب؛ حدد سعر الصرف عند الوصول قبل إضافة الأصناف أو الترحيل. [IMPORT_ARRIVAL_RATE_REQUIRED]',
      );
    }
    const rate = requireImportNumber(shipment.exchange_rate_at_arrival, 'سعر الصرف', Number.MIN_VALUE);
    const method = (shipment.cost_allocation_method as 'value' | 'weight' | 'cbm') || 'value';

    // Book digits: the breakdown's money totals round at the tenant
    // base currency's digits so the allocation ties to the books
    // (U4 W1 canonical wiring — the engine must not guess EGP).
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, shipment.tenant_id));

    if (method === 'weight' && items.some((item) => Number(item.gross_weight_kg_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد وزن الوحدة لكل صنف قبل التوزيع بالوزن.');
    }
    if (method === 'cbm' && items.some((item) => Number(item.cbm_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد CBM الوحدة لكل صنف قبل التوزيع بالحجم.');
    }
    const breakdown = calculateLandedCostBreakdown({
      items: items.map((item) => ({
        id: item.id,
        productId: Number(item.product_id),
        quantity: Number(item.quantity),
        receivedQuantity: item.received_quantity !== null && item.received_quantity !== undefined ? Number(item.received_quantity) : Number(item.quantity),
        factoryUnitPriceUsd: Number(item.factory_unit_price_usd),
        unitWeightKg: Number(item.gross_weight_kg_unit || 0),
        unitCbm: Number(item.cbm_unit || 0),
        shortageHandlingMethod: (item.shortage_handling_method as any) || 'capitalize',
      })),
      exchangeRate: rate,
      shippingCostUsd: Number(shipment.shipping_cost_usd ?? 0),
      customsCostEgp: Number(shipment.customs_cost_egp ?? 0),
      internalTransportCostEgp: Number(shipment.internal_transport_cost_egp ?? 0),
      demurrageFeesEgp: Number(shipment.actual_demurrage_fees ?? 0),
      vatRefundableEgp: Number(shipment.vat_refundable_egp ?? 0),
      vatIsRefundable: true,
      // INV-IMPORT-LANDED-COST-DUTY-VAT: the itemized tax rates
      // and the CIF insurance stored on the shipment; a NULL
      // reads as 0 so legacy rows keep their old totals.
      insuranceCostUsd: Number(shipment.insurance_cost_usd ?? 0),
      customsDutyRatePercent: Number(shipment.customs_duty_rate_percent ?? 0),
      vatRatePercent: Number(shipment.vat_rate_percent ?? 0),
      allocationMethod: method,
      moneyDigits: digits,
    });

    for (const line of breakdown.items) {
      await trx
        .updateTable('import_shipment_items')
        .set({
          allocated_overhead_egp: line.unitOverheadEgp,
          landed_cost_egp: line.landedCostEgp,
        })
        .where('tenant_id', '=', shipment.tenant_id)
        .where('shipment_id', '=', shipment.id)
        .where('id', '=', line.id)
        .execute();
    }

    return {
      success: true,
      message: 'تم إعادة احتساب التكلفة الفعلية وتوزيع الأعباء بنجاح وفق محرك Landed Cost المعتمد',
      breakdown,
    };
  }
  async updateShipmentItem(tenantId: string, itemId: string, dto: UpdateShipmentItemDto) {
    return this.inventoryDb.transaction().execute(async (trx) => {
      const parent = await trx.selectFrom('import_shipment_items').select('shipment_id')
        .where('tenant_id', '=', tenantId).where('id', '=', itemId).executeTakeFirst();
      if (!parent) throw new NotFoundException('بند الشحنة غير موجود');
      // Do not lock an item before its parent; every edit/post uses the same ordering.
      const state = await this.lockShipment(trx, tenantId, parent.shipment_id);
      const item = await trx.selectFrom('import_shipment_items').selectAll()
        .where('tenant_id', '=', tenantId).where('shipment_id', '=', parent.shipment_id)
        .where('id', '=', itemId).executeTakeFirstOrThrow();
      const payload: Updateable<ImportShipmentItemTable> = {};
      const stockEdit = dto.receivedQuantity !== undefined || dto.shortageHandlingMethod !== undefined ||
        dto.unitWeightKg !== undefined || dto.unitCbm !== undefined;
      if (stockEdit) {
        this.assertShipmentEditable(state);
        if (dto.receivedQuantity !== undefined) {
          payload.received_quantity = requireImportNumber(dto.receivedQuantity, 'الكمية المستلمة');
          // validateImportLine precedent: receiving more than the
          // B/L quantity, or beyond 3-decimal stock precision, is
          // rejected, never silently clamped.
          const receivedQty = Number(payload.received_quantity);
          if (receivedQty > Number(item.quantity) || Math.abs(receivedQty - Number(receivedQty.toFixed(3))) > 1e-9) {
            throw new BadRequestException('الكمية المستلمة تتجاوز البوليصة أو دقة المخزون (3 منازل)');
          }
        }
        if (dto.shortageHandlingMethod !== undefined) payload.shortage_handling_method = dto.shortageHandlingMethod;
        if (dto.unitWeightKg !== undefined) payload.gross_weight_kg_unit = requireImportNumber(dto.unitWeightKg, 'وزن الوحدة');
        if (dto.unitCbm !== undefined) payload.cbm_unit = requireImportNumber(dto.unitCbm, 'حجم الوحدة');
      }
      if (dto.targetRetailMargin !== undefined) payload.target_retail_margin = requireImportNumber(dto.targetRetailMargin, 'هامش التجزئة');
      if (dto.targetWholesaleMargin !== undefined) payload.target_wholesale_margin = requireImportNumber(dto.targetWholesaleMargin, 'هامش الجملة');
      if (Object.keys(payload).length) {
        await trx.updateTable('import_shipment_items').set(payload)
          .where('tenant_id', '=', tenantId).where('shipment_id', '=', item.shipment_id).where('id', '=', itemId).execute();
        if (stockEdit) await this.calculateLandedCostInTransaction(trx, state.shipment);
      }
      return { success: true };
    });
  }
}
