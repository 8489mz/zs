import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction, Selectable } from 'kysely';
import { Database, ImportInventoryReceiptTable, ImportShipmentTable } from '../../../database/database.types';
import { revalueStockCost } from '../../accounting/inventory-valuation';
import { ProcessLateExpenseDto } from '../dto/import-sales.dto';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

/**
 * ImportCostRevaluationService — slice S5 of the import-sales split.
 * Pure move of 3 methods from ImportSalesService
 * (applyImportCostRevaluation, processLateShipmentExpense,
 * applySuggestedPrices). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. This slice is kernel-only: it calls no other slice.
 * The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * applyImportCostRevaluation — accountingPosting arrives as an
 * OPTIONAL bound dep, so specs constructing
 * new ImportSalesService(db, undefined) keep working. Date handling
 * travels verbatim: expense_date resolves through
 * resolveBusinessDateKey (tenant day); entryDate /
 * catalog_updated_at are server-instants-as-evidence, never pg DATE
 * keys. applyImportCostRevaluation is public here (private in the
 * facade delegate) — the facade, a different class, cannot call a
 * private slice method (tsc TS2341); the facade delegate stays
 * private, so the facade public surface is unchanged.
 * revalueStockCost is NOT here as a method — it is an imported engine
 * function (accounting/inventory-valuation), called from inside
 * applyImportCostRevaluation; the import travels with the move.
 * directMutationAllowList holds only the stock ledger
 * (INV-DIRECT-MUTATION-ALLOWLIST-LEDGER-ONLY), so there is no
 * allowlist entry for the facade — and none is needed, because
 * applySuggestedPrices writes no products.stock_qty.
 */

export interface ImportCostRevaluationDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // applyImportCostRevaluation builds its own AccountingPostingService
  // when this is undefined — the 7 specs constructing
  // new ImportSalesService(db, undefined) depend on that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveImportProjectCostCenter +
  // resolveTenantAccount + lockShipment are the shared kernel helpers
  // (stay in the facade forever).
  resolveImportProjectCostCenter: (...args: any[]) => any;
  resolveTenantAccount: (...args: any[]) => any;
  lockShipment: (...args: any[]) => any;
}

@Injectable()
export class ImportCostRevaluationService {
  private readonly db: Kysely<any>;
  private readonly inventoryDb: Kysely<Database>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveImportProjectCostCenter: (...args: any[]) => any;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly lockShipment: (...args: any[]) => any;

  constructor(deps: ImportCostRevaluationDeps) {
    this.db = deps.db;
    this.inventoryDb = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveImportProjectCostCenter = deps.resolveImportProjectCostCenter;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.lockShipment = deps.lockShipment;
  }

  /**
   * Shared cost-revaluation core (INV-IMPORT-BROKER-CAPITALISATION):
   * spreads one landed-cost amount over a posted receipt's lots and
   * WAC pool exactly like a late expense, in the caller's
   * transaction. The credit leg is either the supplier payable
   * (ordinary late expense) or the broker-advance asset (a
   * liquidated broker expense capitalised after posting). The
   * caller owns the shipment lock, the posted-receipt proof and
   * the credit-side identity; this core never defaults either.
   */
  async applyImportCostRevaluation(
    trx: Transaction<Database>,
    tenantId: string,
    userId: number,
    shipment: Selectable<ImportShipmentTable>,
    receipt: Selectable<ImportInventoryReceiptTable> | undefined,
    opts: {
      amount: number;
      title: string;
      note?: string | null;
      idempotencyKey?: string;
      accountId?: number | null;
      payableAccountId?: number | null;
      credit:
        | { kind: 'payable'; supplierId: number }
        | { kind: 'broker_advance'; accountId: number }
        | { kind: 'clearing'; accountId: number; reason: string };
      /** Attribution recorded on the late-expense event row (INV-IMPORT-SUPPLIER-ATTRIBUTION). */
      supplierId?: number | null;
      unallocableReason?: string | null;
      brokerExpenseId?: string;
    },
  ) {
    if (!receipt || receipt.state !== 'posted') {
      throw new BadRequestException('لا يمكن تسوية تكلفة إلا بعد استلام الشحنة وترحيل المخزون.');
    }
    const shipmentId = shipment.id;

    if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
      throw new BadRequestException('مبلغ التسوية يجب أن يكون أكبر من صفر.');
    }
    // INV-IMPORT-LATE-EXPENSE-JE-COST-CENTRE: resolve the project
    // cost centre BEFORE any write, exactly as P11 does for the
    // receipt journal — a missing project row fails closed with
    // zero writes, and every revaluation JE line below carries
    // the centre (project-less shipments post with honest NULL).
    const lateExpenseCostCenterId = await this.resolveImportProjectCostCenter(trx, tenantId, shipment);
    // Idempotency (the deposit/preorder refund pattern): a supplied
    // key is checked before any write, and a provisional event row
    // is inserted after validation (pass 1) so the partial unique
    // index serialises concurrent retries. Without a key the call
    // behaves exactly as before.
    const lateExpenseKey = opts.idempotencyKey ? String(opts.idempotencyKey).trim() : '';
    if (lateExpenseKey.length > 128) {
      throw new BadRequestException('مفتاح عدم التكرار للمصروف المتأخر يجب ألا يتجاوز 128 حرفاً.');
    }
    let lateExpenseEventId: number | null = null;
    if (lateExpenseKey) {
      const previousLateExpense = await trx
        .selectFrom('import_late_expense_events')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .where('idempotency_key', '=', lateExpenseKey)
        .executeTakeFirst();
      if (previousLateExpense) {
        throw new ConflictException('تم تسجيل هذا المصروف المتأخر مسبقاً بنفس مفتاح عدم التكرار.');
      }
    }

    const items = await trx
      .selectFrom('import_shipment_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .execute();

    if (!items.length) {
      throw new BadRequestException('الشحنة لا تحتوي على أصناف.');
    }

    let totalReceivedQty = 0;
    for (const item of items) {
      totalReceivedQty += Number(item.received_quantity ?? item.quantity);
    }

    const productIds = items.map((i) => Number(i.product_id));
    const products = await trx
      .selectFrom('products')
      .select(['id', 'cost_price', 'account_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', productIds)
      .execute();

    for (const p of products.sort((a, b) => Number(a.id) - Number(b.id))) {
      await lockStockProducts(trx, { tenantId, accountId: p.account_id, productIds: [Number(p.id)] });
    }

    // Allocation honours the shipment's cost_allocation_method
    // with the landed-cost engine's guards: weight/cbm require a
    // positive unit weight/CBM on every item. Share bases mirror
    // the engine (B/L quantity x unit value/weight/CBM); when the
    // chosen base totals zero, fall back to the value base, then
    // to the received-quantity share used before this change.
    const allocationMethod = (shipment.cost_allocation_method as 'value' | 'weight' | 'cbm') || 'value';
    if (allocationMethod === 'weight' && items.some((item) => Number(item.gross_weight_kg_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد وزن الوحدة لكل صنف قبل التوزيع بالوزن.');
    }
    if (allocationMethod === 'cbm' && items.some((item) => Number(item.cbm_unit || 0) <= 0)) {
      throw new BadRequestException('يلزم تحديد CBM الوحدة لكل صنف قبل التوزيع بالحجم.');
    }
    const itemShareBases = items.map((it) => {
      const qty = Math.max(0, Number(it.quantity || 0));
      if (allocationMethod === 'weight') return qty * Math.max(0, Number(it.gross_weight_kg_unit || 0));
      if (allocationMethod === 'cbm') return qty * Math.max(0, Number(it.cbm_unit || 0));
      return qty * Math.max(0, Number(it.factory_unit_price_usd || 0));
    });
    const totalShareBase = itemShareBases.reduce((sum, v) => sum + v, 0);
    const itemValueBases = items.map(
      (it) => Math.max(0, Number(it.quantity || 0)) * Math.max(0, Number(it.factory_unit_price_usd || 0)),
    );
    const totalValueBase = itemValueBases.reduce((sum, v) => sum + v, 0);

    // Book digits: per-item adjustments round at the tenant base
    // currency's digits so their sum equals the journal totals.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const roundedTotal = roundMoney(opts.amount, digits);

    let totalSoldUnits = 0;
    let totalOnHandUnits = 0;
    const rawAdjustments: Array<{
      item: (typeof items)[number];
      receivedQty: number;
      onHandQty: number;
      soldQty: number;
      rawCogs: number;
      rawInventory: number;
      companyStock: number;
    }> = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const pId = Number(item.product_id);
      const itemReceivedQty = Number(item.received_quantity ?? item.quantity);
      if (!Number.isFinite(itemReceivedQty) || itemReceivedQty <= 0) {
        throw new UnprocessableEntityException('لا يمكن تحميل مصروف متأخر على بند ليس له كمية مستلمة.');
      }

      // Query remaining stock specifically for this shipment's lots (IAS 2 compliance)
      const lotRow = await trx
        .selectFrom('import_inventory_lots')
        .select([
          sql<number>`count(*)`.as('lot_count'),
          sql<number>`coalesce(sum(remaining_quantity), 0)`.as('total_remaining'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .where('shipment_item_id', '=', item.id)
        .executeTakeFirst();

      let itemOnHandQty = 0;
      if (lotRow && Number(lotRow.lot_count) > 0) {
        itemOnHandQty = Math.min(itemReceivedQty, Math.max(0, Number(lotRow.total_remaining)));
      } else {
        throw new UnprocessableEntityException('لا يمكن تسوية المصروف المتأخر دون باتش استيراد موثق للبند.');
      }

      const itemSoldQty = Math.max(0, itemReceivedQty - itemOnHandQty);

      totalOnHandUnits += itemOnHandQty;
      totalSoldUnits += itemSoldQty;

      // Share of the late expense allocated to this item, on the
      // shipment's allocation method (see the bases above).
      const itemShare =
        totalShareBase > 0
          ? itemShareBases[idx] / totalShareBase
          : totalValueBase > 0
            ? itemValueBases[idx] / totalValueBase
            : itemReceivedQty / Math.max(1, totalReceivedQty);
      const itemLateExpense = roundedTotal * itemShare;
      const itemCogsAdj = (itemSoldQty / itemReceivedQty) * itemLateExpense;
      const itemInventoryAdj = (itemOnHandQty / itemReceivedQty) * itemLateExpense;

      // Query total company-wide on-hand stock for this product across all locations
      // to maintain exact Weighted Average Cost (WAC) and General Ledger inventory reconciliation (IAS 2)
      const totalCompanyStockRow = await trx
        .selectFrom('product_location_stock')
        .select([sql<number>`coalesce(sum(qty), 0)`.as('total_qty')])
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', pId)
        .executeTakeFirst();
      const totalCompanyStock = Math.max(itemOnHandQty, Number(totalCompanyStockRow?.total_qty || 0));

      rawAdjustments.push({
        item,
        receivedQty: itemReceivedQty,
        onHandQty: itemOnHandQty,
        soldQty: itemSoldQty,
        rawCogs: itemCogsAdj,
        rawInventory: itemInventoryAdj,
        companyStock: totalCompanyStock,
      });
    }

    // Pass 2: round each part at book digits; the remainder lands
    // on the last item so the rounded parts sum exactly to the
    // posted total (no drift between parts and journal).
    const roundedAdjustments = rawAdjustments.map((adj) => ({
      ...adj,
      cogs: roundMoney(adj.rawCogs, digits),
      inventory: roundMoney(adj.rawInventory, digits),
    }));
    let roundingDrift = roundMoney(
      roundedTotal - roundedAdjustments.reduce((sum, adj) => sum + adj.cogs + adj.inventory, 0),
      digits,
    );
    for (let i = roundedAdjustments.length - 1; i >= 0 && roundingDrift !== 0; i--) {
      const target = roundedAdjustments[i];
      if (roundingDrift > 0) {
        target.inventory += roundingDrift;
        roundingDrift = 0;
      } else {
        const fromInventory = Math.min(target.inventory, -roundingDrift);
        target.inventory -= fromInventory;
        roundingDrift += fromInventory;
        if (roundingDrift !== 0) {
          const fromCogs = Math.min(target.cogs, -roundingDrift);
          target.cogs -= fromCogs;
          roundingDrift += fromCogs;
        }
      }
    }
    if (roundingDrift !== 0) {
      throw new UnprocessableEntityException('تعذر توزيع المصروف المتأخر بدقة وحدات العملة.');
    }

    // All validations passed: record the idempotency event row
    // here, before any write, with a provisional split that keeps
    // the amounts CHECK true at all times. The partial unique
    // index serialises concurrent retries with the same key.
    if (lateExpenseKey) {
      try {
        const provisional = await trx
          .insertInto('import_late_expense_events')
          .values({
            tenant_id: tenantId,
            shipment_id: shipmentId,
            title: opts.title,
            total_amount_egp: opts.amount,
            inventory_amount_egp: roundedTotal,
            cogs_amount_egp: 0,
            created_by: userId,
            journal_entry_id: null,
            idempotency_key: lateExpenseKey,
            broker_expense_id: opts.brokerExpenseId ?? null,
            supplier_id: opts.supplierId ?? null,
            unallocable_reason: opts.unallocableReason ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        lateExpenseEventId = provisional.id;
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException('تم تسجيل هذا المصروف المتأخر مسبقاً بنفس مفتاح عدم التكرار.');
        }
        throw err;
      }
    }

    // Pass 3: apply the rounded adjustments. The pool revaluation
    // writer spreads the inventory adjustment over the
    // company-wide on-hand stock; under the product lock held
    // above, read-primitive-write is safe, and the rounding
    // policy is the primitive's round-the-result. The lot and
    // shipment-item increments stay SQL-atomic deliberately: no
    // lot lock is held in this flow.
    let totalLateCogs = 0;
    let totalLateInventory = 0;
    for (const adj of roundedAdjustments) {
      const { item } = adj;
      const adjProductId = Number(item.product_id);
      totalLateCogs += adj.cogs;
      totalLateInventory += adj.inventory;

      const wacUnitCostIncrease = adj.companyStock > 0 ? adj.inventory / adj.companyStock : 0;
      if (wacUnitCostIncrease > 0) {
        await revalueStockCost(trx, tenantId, adjProductId, adj.companyStock, adj.inventory);
      }

      const lotUnitCostIncrease = adj.onHandQty > 0 ? adj.inventory / adj.onHandQty : 0;
      if (lotUnitCostIncrease > 0) {
        await trx
          .updateTable('import_inventory_lots')
          .set((eb) => ({
            unit_landed_cost_egp: sql`${eb.ref('unit_landed_cost_egp')} + ${Number(lotUnitCostIncrease.toFixed(6))}`,
            updated_at: sql`NOW()`,
          }))
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', shipmentId)
          .where('shipment_item_id', '=', item.id)
          .execute();
      }

      await trx
        .updateTable('import_shipment_items')
        .set((eb) => ({
          landed_cost_egp: sql`${eb.ref('landed_cost_egp')} + ${Number(((adj.cogs + adj.inventory) / adj.receivedQty).toFixed(6))}`,
        }))
        .where('tenant_id', '=', tenantId)
        .where('id', '=', item.id)
        .execute();
    }

    // Resolve accounts dynamically from COA / Accounting Settings.
    // Branch/location stay null on these lines: on-hand is read
    // company-wide across locations, so no single receipt location
    // can be attributed honestly here.
    const cogsAccountId = await this.resolveTenantAccount(
      trx,
      tenantId,
      'cogs',
      opts.accountId ? Number(opts.accountId) : null,
    );
    const inventoryAccountId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
    // The credit side is caller-owned: the supplier payable for an
    // ordinary late expense, the designated clearing account
    // (already resolved by the caller, never defaulted here) for
    // a genuinely unallocable expense, or the broker-advance
    // asset (already resolved by the caller) for a capitalised
    // broker expense.
    const creditAccountId =
      opts.credit.kind === 'payable'
        ? await this.resolveTenantAccount(
            trx,
            tenantId,
            'payable',
            opts.payableAccountId ? Number(opts.payableAccountId) : null,
          )
        : opts.credit.accountId;

    let expenseId: number | null = null;
    if (totalLateCogs > 0) {
      const exp = await trx
        .insertInto('expenses')
        .values({
          tenant_id: tenantId,
          account_id: String(cogsAccountId),
          title: `${opts.title} (تسوية تكلفة متأخرة على مبيعات سابقة) - حاوية ${shipment.container_number}`,
          amount: totalLateCogs,
          expense_date: await resolveBusinessDateKey(trx, tenantId, new Date()),
          created_by: userId,
          note: opts.note || `تم تحميل ${totalSoldUnits} وحدة مباعة بقيمة ${totalLateCogs} ج.م`,
          branch_id: null,
          location_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expenseId = exp.id;
    }

    // Every late expense has a proper source document, including inventory-only capitalization.
    let lateExpenseDocument: { id: number };
    if (lateExpenseEventId !== null) {
      await trx
        .updateTable('import_late_expense_events')
        .set({
          total_amount_egp: roundedTotal,
          inventory_amount_egp: totalLateInventory,
          cogs_amount_egp: totalLateCogs,
          supplier_id: opts.supplierId ?? null,
          unallocable_reason: opts.unallocableReason ?? null,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', lateExpenseEventId)
        .execute();
      lateExpenseDocument = { id: lateExpenseEventId };
    } else {
      lateExpenseDocument = await trx
        .insertInto('import_late_expense_events')
        .values({
          tenant_id: tenantId,
          shipment_id: shipmentId,
          title: opts.title,
          total_amount_egp: roundedTotal,
          inventory_amount_egp: totalLateInventory,
          cogs_amount_egp: totalLateCogs,
          created_by: userId,
          journal_entry_id: null,
          broker_expense_id: opts.brokerExpenseId ?? null,
          supplier_id: opts.supplierId ?? null,
          unallocable_reason: opts.unallocableReason ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    }
    const postingService =
      this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
    const lines: any[] = [];
    if (totalLateCogs > 0) {
      lines.push({
        accountId: cogsAccountId,
        description: `تسوية تكلفة مبيعات سابقة لمصروف متأخر - حاوية ${shipment.container_number}`,
        debit: totalLateCogs,
        credit: 0,
        costCenterId: lateExpenseCostCenterId,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }
    if (totalLateInventory > 0) {
      lines.push({
        accountId: inventoryAccountId,
        description: `رسملة مصروف متأخر على المخزون المتبقي - حاوية ${shipment.container_number}`,
        debit: totalLateInventory,
        credit: 0,
        costCenterId: lateExpenseCostCenterId,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }
    if (opts.credit.kind === 'payable') {
      lines.push({
        accountId: creditAccountId,
        description: `استحقاق مصروف متأخر - حاوية ${shipment.container_number}`,
        debit: 0,
        credit: roundedTotal,
        costCenterId: lateExpenseCostCenterId,
        partnerType: 'supplier',
        partnerId: opts.credit.supplierId,
        branchId: null,
        locationId: null,
      });
    } else if (opts.credit.kind === 'clearing') {
      // Genuinely unallocable late expense: the credit posts to
      // the tenant-designated clearing account (an unflagged
      // account the partner sync skips), labelled with the
      // recorded reason — never to a default supplier.
      lines.push({
        accountId: creditAccountId,
        description: `استحقاق مصروف متأخر غير قابل للتخصيص - سبب: ${opts.credit.reason} - حاوية ${shipment.container_number}`,
        debit: 0,
        credit: roundedTotal,
        costCenterId: lateExpenseCostCenterId,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    } else {
      // Capitalised broker expense: the advance asset is relieved
      // here, in the same transaction as the spread. No supplier
      // payable is created for money already spent from the
      // broker's advance, and no separate broker journal is
      // posted for the capitalised portion.
      lines.push({
        accountId: creditAccountId,
        description: `تخفيض عهدة المخلص الجمركي برسملة مصروف - حاوية ${shipment.container_number}`,
        debit: 0,
        credit: roundedTotal,
        costCenterId: lateExpenseCostCenterId,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    const journalEntryId = await postingService.postDomainJournal(trx, {
      // The broker-capitalisation journal carries no supplier
      // payable leg, so it must not run the partner-subledger
      // sync (its allowlist is the payable-carrying source
      // types); the advance-asset leg has no partner subledger.
      // A clearing late-expense journal keeps the
      // import_late_expense type: its partner-less credit sits
      // on the unflagged clearing account, which the sync's own
      // account filter skips.
      sourceType: opts.credit.kind === 'broker_advance' ? 'import_broker_capitalization' : 'import_late_expense',
      sourceId: Number(lateExpenseDocument.id),
      tenantId,
      accountId: tenantId,
      entryDate: new Date(),
      description: `تسوية مصروف استيراد متأخر - حاوية ${shipment.container_number} (${opts.title})`,
      branchId: null,
      locationId: null,
      createdBy: userId,
      postedBy: userId,
      lines,
    });

    await trx
      .updateTable('import_late_expense_events')
      .set({ journal_entry_id: journalEntryId })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', lateExpenseDocument.id)
      .execute();

    await trx
      .updateTable('import_shipments')
      .set((eb) => ({
        late_expenses_total_egp: sql`coalesce(late_expenses_total_egp, 0) + ${roundedTotal}`,
        late_cogs_adjustment_egp: sql`coalesce(late_cogs_adjustment_egp, 0) + ${totalLateCogs}`,
        late_inventory_adjustment_egp: sql`coalesce(late_inventory_adjustment_egp, 0) + ${totalLateInventory}`,
      }))
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shipmentId)
      .execute();

    return {
      journalEntryId,
      lateExpenseEventId: lateExpenseDocument.id,
      roundedTotal,
      totalLateCogs,
      totalLateInventory,
      soldQuantity: totalSoldUnits,
      onHandQuantity: totalOnHandUnits,
      cogsExpenseId: expenseId,
    };
  }

  async processLateShipmentExpense(tenantId: string, userId: number, shipmentId: string, dto: ProcessLateExpenseDto) {
    return await this.inventoryDb.transaction().execute(async (trx) => {
      const state = await this.lockShipment(trx, tenantId, shipmentId);
      const { shipment, receipt } = state;
      if (!receipt || receipt.state !== 'posted') {
        throw new BadRequestException('لا يمكن تسجيل مصروفات متأخرة إلا بعد استلام الشحنة وترحيل المخزون.');
      }

      // INV-IMPORT-SUPPLIER-ATTRIBUTION: fail closed BEFORE any
      // revaluation or journal write. A late expense is never
      // silently attributed to the goods supplier: the caller
      // names the explicit payee, or records the reason the
      // expense is genuinely unallocable (clearing path). The
      // old default — crediting the whole expense to the shipment
      // supplier — overstated that subledger for demurrage,
      // storage and broker fees owed to other parties.
      const lateExpenseSupplierId =
        dto.supplierId !== undefined && dto.supplierId !== null ? Number(dto.supplierId) : null;
      const lateExpenseUnallocableReason =
        typeof dto.unallocableReason === 'string' ? dto.unallocableReason.trim() : '';
      let lateExpenseCredit:
        { kind: 'payable'; supplierId: number } | { kind: 'clearing'; accountId: number; reason: string };
      if (lateExpenseSupplierId !== null) {
        const payee = await trx
          .selectFrom('suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', lateExpenseSupplierId)
          .executeTakeFirst();
        if (!payee) {
          throw new BadRequestException(
            'مورد المصروف المتأخر المحدد غير موجود في هذه المنشأة؛ حدد مورداً حقيقياً قبل الترحيل. [IMPORT_LATE_EXPENSE_PAYEE_REQUIRED]',
          );
        }
        lateExpenseCredit = { kind: 'payable', supplierId: lateExpenseSupplierId };
      } else if (lateExpenseUnallocableReason) {
        const clearingAccountId = await this.resolveTenantAccount(trx, tenantId, 'clearing');
        lateExpenseCredit = { kind: 'clearing', accountId: clearingAccountId, reason: lateExpenseUnallocableReason };
      } else {
        throw new BadRequestException(
          'لا يمكن تسجيل مصروف متأخر بلا مورد محدد: حدد مورد المصروف أو سجل سبب عدم قابلية التخصيص قبل الترحيل. [IMPORT_LATE_EXPENSE_PAYEE_REQUIRED]',
        );
      }

      const result = await this.applyImportCostRevaluation(trx, tenantId, userId, shipment, receipt, {
        amount: dto.lateExpenseAmount,
        title: dto.title,
        note: dto.note,
        idempotencyKey: dto.idempotencyKey,
        accountId: dto.accountId ? Number(dto.accountId) : null,
        payableAccountId: dto.payableAccountId ? Number(dto.payableAccountId) : null,
        credit: lateExpenseCredit,
        supplierId: lateExpenseSupplierId,
        unallocableReason: lateExpenseUnallocableReason || null,
      });
      return {
        success: true,
        message: 'تمت معالجة المصروف المتأخر وتوزيعه محاسبياً بين تكلفة البضاعة المباعة والمخزون المتبقي بنجاح.',
        allocation: {
          lateExpenseAmount: result.roundedTotal,
          lateCogsAdjustmentEgp: result.totalLateCogs,
          lateInventoryAdjustmentEgp: result.totalLateInventory,
          soldQuantity: result.soldQuantity,
          onHandQuantity: result.onHandQuantity,
          journalEntryId: result.journalEntryId,
        },
        cogsExpenseId: result.cogsExpenseId,
      };
    });
  }

  async applySuggestedPrices(tenantId: string, shipmentId: string) {
    return await this.db.transaction().execute(async (trx) => {
      const items = await trx
        .selectFrom('import_shipment_items')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', shipmentId)
        .execute();

      const shipment = await trx
        .selectFrom('import_shipments')
        .select(['exchange_rate_at_arrival', 'pricing_exchange_rate'])
        .where('id', '=', shipmentId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!shipment) throw new NotFoundException('الشحنة غير موجودة');

      const arrivalRate = Number(shipment?.exchange_rate_at_arrival) || 1;
      const pricingRate = Number(shipment?.pricing_exchange_rate) || arrivalRate;

      // INV-IMPORT-ESTIMATES-HONEST: the pricing adjustment reprices from
      // the DIFFERENCE between the pricing rate and the arrival rate. When
      // a pricing rate is recorded but no arrival rate exists, the silent
      // `|| 1` arrival fallback would inflate every selling price by
      // unitUsd x (pricingRate - 1). That inconsistent state fails closed
      // before any price write; when neither rate exists the adjustment is
      // exactly zero and pricing proceeds from the stored landed cost.
      const hasPricingRate =
        shipment?.pricing_exchange_rate !== null &&
        shipment?.pricing_exchange_rate !== undefined &&
        Number(shipment.pricing_exchange_rate) > 0;
      const hasArrivalRate =
        shipment?.exchange_rate_at_arrival !== null &&
        shipment?.exchange_rate_at_arrival !== undefined &&
        Number(shipment.exchange_rate_at_arrival) > 0;
      if (hasPricingRate && !hasArrivalRate) {
        throw new BadRequestException(
          'لا يمكن تطبيق الأسعار المقترحة بسعر تسعير مسجل بلا سعر صرف وصول؛ حدد سعر الصرف عند الوصول أولاً. [IMPORT_ARRIVAL_RATE_REQUIRED]',
        );
      }

      // INV-IMPORT-APPLY-PRICES-NO-WAC-OVERWRITE: lock every touched
      // product row FOR UPDATE in global ID order, grouped by its own
      // account scope (the canonical lockStockProducts helper), before
      // any price write. This function must never write cost_price
      // (the blended WAC) and never overwrite catalog identity
      // (supplier/category); only retail/wholesale selling prices move.
      if (items.length) {
        const products = await trx
          .selectFrom('products')
          .select(['id', 'account_id'])
          .where('tenant_id', '=', tenantId)
          .where(
            'id',
            'in',
            items.map((item) => Number(item.product_id)),
          )
          .orderBy('id', 'asc')
          .execute();
        const idsByAccount = new Map<string, number[]>();
        for (const product of products) {
          const accountId = String(product.account_id);
          const ids = idsByAccount.get(accountId) || [];
          ids.push(Number(product.id));
          idsByAccount.set(accountId, ids);
        }
        for (const [accountId, productIds] of idsByAccount) {
          await lockStockProducts(trx as any, { tenantId, accountId, productIds });
        }
      }

      let updatedCount = 0;
      for (const item of items) {
        const cost = Number(item.landed_cost_egp || 0);

        // If pricing rate is different, adjust the base cost for pricing
        const unitUsd = Number(item.factory_unit_price_usd || 0);
        const pricingCostEgp = cost + unitUsd * (pricingRate - arrivalRate);

        const updateData: any = {
          catalog_updated_at: new Date(),
        };

        if (item.target_retail_margin !== null && Number(item.target_retail_margin) > 0) {
          const rMargin = Number(item.target_retail_margin) / 100;
          updateData.retail_price = Number((pricingCostEgp * (1 + rMargin)).toFixed(2));
        }

        if (item.target_wholesale_margin !== null && Number(item.target_wholesale_margin) > 0) {
          const wMargin = Number(item.target_wholesale_margin) / 100;
          updateData.wholesale_price = Number((pricingCostEgp * (1 + wMargin)).toFixed(2));
        }

        if (Object.keys(updateData).length > 0) {
          await trx
            .updateTable('products')
            .set(updateData)
            .where('id', '=', Number(item.product_id))
            .where('tenant_id', '=', tenantId)
            .execute();

          updatedCount++;
        }
      }
      return { success: true, updatedCount };
    });
  }
}
