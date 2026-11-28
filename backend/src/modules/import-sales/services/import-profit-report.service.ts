import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { addDaysToDayKey } from '../../../common/utils/client-date-bounds.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { calculateDemurrageRisk } from '../engines/import-landed-cost.engine';

export interface ImportProfitReportDeps {
  db: Kysely<any>;
  // Bound facade kernel method (same name as the facade member, so the
  // moved bodies are byte-identical). eligibleRoleAccountIds stays in the
  // facade forever: it is shared kernel (S6 profit + S11 autopsy).
  eligibleRoleAccountIds: (...args: any[]) => any;
}

/**
 * ImportProfitReportService — slice S6 of the import-sales split.
 * Pure move of 3 methods from ImportSalesService
 * (sumPostedProjectCostComponents, generatePeriodProfitReport,
 * getImportCommandCenterMetrics). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures. The B5-P3 tenant-day ACI expiry window (acidBound via
 * resolveBusinessDateKey + addDaysToDayKey) travels verbatim inside
 * getImportCommandCenterMetrics. No accountingPosting dep: the three
 * methods post nothing (0 occurrences in the moved text).
 */
@Injectable()
export class ImportProfitReportService {
  private readonly db: Kysely<any>;
  private readonly eligibleRoleAccountIds: (...args: any[]) => any;

  constructor(deps: ImportProfitReportDeps) {
    this.db = deps.db;
    this.eligibleRoleAccountIds = deps.eligibleRoleAccountIds;
  }

  /**
   * Posted-ledger cost components for one project
   * (INV-IMPORT-PROFIT-HONESTY). Every figure is read from journals
   * with status='posted' through the attribution chain the posting
   * path already records; estimates and memo rows are never read
   * here. Folded/revalued broker costs are deliberately NOT read:
   * they reached the GL inside the receipt / late-expense journals,
   * so counting them again would double-count. All sums are
   * debit-minus-credit over the resolver-eligible account sets,
   * so an FX gain (a credit) reduces its component and a reversal
   * mirror nets its original journal to zero.
   */
  async sumPostedProjectCostComponents(
    qb: any,
    tenantId: string,
    projectId: string,
    start: Date,
    end: Date,
  ): Promise<{
    shortageExpenseEgp: number;
    brokerExpensedEgp: number;
    fxVarianceEgp: number;
    depositDeductionsEgp: number;
  }> {
    const cogsAccountIds = await this.eligibleRoleAccountIds(qb, tenantId, 'cogs');
    const fxAccountIds = [
      ...(await this.eligibleRoleAccountIds(qb, tenantId, 'forex_loss')),
      ...(await this.eligibleRoleAccountIds(qb, tenantId, 'forex_gain')),
    ];

    const sumLines = async (entryIds: number[], accountIds: number[]): Promise<number> => {
      if (entryIds.length === 0 || accountIds.length === 0) return 0;
      const rows: any[] = await qb
        .selectFrom('journal_entry_lines')
        .select(['debit', 'credit'])
        .where('journal_entry_id', 'in', entryIds)
        .where('account_id', 'in', accountIds)
        .execute();
      return rows.reduce((sum, r) => sum + Number(r.debit || 0) - Number(r.credit || 0), 0);
    };
    const postedEntries = async (sourceType: string, sourceIds: number[]): Promise<number[]> => {
      if (sourceIds.length === 0) return [];
      const rows: any[] = await qb
        .selectFrom('journal_entries')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('source_type', '=', sourceType)
        .where('source_id', 'in', sourceIds)
        .where('status', '=', 'posted')
        .where('entry_date', '>=', start)
        .where('entry_date', '<=', end)
        .execute();
      return rows.map((r) => Number(r.id));
    };

    const projectShipments: any[] = await qb
      .selectFrom('import_shipments')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();
    const shipmentIds = projectShipments.map((s) => String(s.id));

    // 1. Shortage expense: the COGS line of the posted receipt
    // journal, netted with its Batch-3 reversal mirror posted in
    // the same period (the mirror credits the same COGS line).
    const receipts: any[] = shipmentIds.length
      ? await qb
          .selectFrom('import_inventory_receipts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', 'in', shipmentIds)
          .execute()
      : [];
    // Receipt ids are BIGSERIAL in production (migration 0230) and
    // the receipt journal carries Number(receipt.id) as its
    // source_id. Non-numeric ids (a UUID-shaped harness table
    // that predates 0230) can never reference a journal entry,
    // so they are skipped rather than sent to a BIGINT column.
    const receiptIds = receipts.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    const receiptEntries = await postedEntries('import_inventory_receipt', receiptIds);
    let reversalIds: number[] = [];
    if (receiptEntries.length > 0) {
      const mirrors: any[] = await qb
        .selectFrom('journal_entries')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('source_type', '=', 'import_inventory_receipt_reversal')
        .where('reversal_of_entry_id', 'in', receiptEntries)
        .where('status', '=', 'posted')
        .where('entry_date', '>=', start)
        .where('entry_date', '<=', end)
        .execute();
      reversalIds = mirrors.map((m) => Number(m.id));
    }
    const shortageExpenseEgp = await sumLines([...receiptEntries, ...reversalIds], cogsAccountIds);

    // 2. Expensed broker costs: the COGS line of the posted
    // broker-expense journal (Dr COGS / Cr broker-advance). Only
    // the 'expensed' path posts this source type; folded and
    // revalued costs post under other source types and are
    // already inside the receipt / late-expense journals.
    const brokerByProject: any[] = await qb
      .selectFrom('import_broker_expenses')
      .select('serial_id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();
    const brokerByShipment: any[] = shipmentIds.length
      ? await qb
          .selectFrom('import_broker_expenses')
          .select('serial_id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', 'in', shipmentIds)
          .execute()
      : [];
    const brokerSerialIds = [
      ...new Set(
        [...brokerByProject, ...brokerByShipment]
          .map((e) => Number(e.serial_id))
          .filter((n) => Number.isSafeInteger(n) && n > 0),
      ),
    ];
    const brokerEntries = await postedEntries('import_broker_expense', brokerSerialIds);
    const brokerExpensedEgp = await sumLines(brokerEntries, cogsAccountIds);

    // 3. FX variance: the forex loss/gain lines of transfer
    // journals, attributed through the proforma invoice to the
    // project. Unlinked transfers have no project and are
    // excluded from the project report by construction.
    const pis: any[] = await qb
      .selectFrom('import_proforma_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();
    const piIds = pis.map((p) => String(p.id));
    const payments: any[] = piIds.length
      ? await qb
          .selectFrom('supplier_payments')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('proforma_invoice_id', 'in', piIds)
          .execute()
      : [];
    const paymentIds = payments.map((p) => Number(p.id));
    const fxEntries = await postedEntries('supplier_payment', paymentIds);
    const fxVarianceEgp = await sumLines(fxEntries, fxAccountIds);

    // 4. Deposit deductions: the COGS line of the posted
    // container-refund journal, attributed through the deposit
    // to the project.
    const depositsByProject: any[] = await qb
      .selectFrom('import_container_deposits')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId)
      .execute();
    const depositsByShipment: any[] = shipmentIds.length
      ? await qb
          .selectFrom('import_container_deposits')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', 'in', shipmentIds)
          .execute()
      : [];
    const depositIds = [...new Set([...depositsByProject, ...depositsByShipment].map((d) => String(d.id)))];
    const refundEvents: any[] = depositIds.length
      ? await qb
          .selectFrom('import_container_refund_events')
          .select('serial_id')
          .where('tenant_id', '=', tenantId)
          .where('deposit_id', 'in', depositIds)
          .execute()
      : [];
    const refundSerialIds = refundEvents
      .map((e) => Number(e.serial_id))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    const refundEntries = await postedEntries('import_container_refund', refundSerialIds);
    const depositDeductionsEgp = await sumLines(refundEntries, cogsAccountIds);

    return { shortageExpenseEgp, brokerExpensedEgp, fxVarianceEgp, depositDeductionsEgp };
  }

  async generatePeriodProfitReport(
    tenantId: string,
    startDate: string | Date,
    endDate: string | Date,
    projectId?: string,
    executor?: any,
  ) {
    const qb = (executor || this.db) as Kysely<Database>;
    // Book digits for every EGP figure in this report
    // (INV-MONEY-PRECISION-HR-IMPORT-3DP): report totals are
    // tenant-currency money, so they round through roundMoney at
    // the tenant's book digits, never a hardcoded two-decimal spelling.
    // Resolved through qb so a caller-passed executor/trx stays
    // in the same connection.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(qb, tenantId));
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (typeof endDate === 'string' && !endDate.includes('T')) {
      end.setHours(23, 59, 59, 999);
    }
    // Range bounds are stored DATEs: compare day keys resolved from the
    // caller's own inputs (a YYYY-MM-DD string passes through; an
    // instant is keyed in the tenant zone), not UTC slices of the bounds.
    const startKey = await resolveBusinessDateKey(qb, tenantId, startDate);
    const endKey = await resolveBusinessDateKey(qb, tenantId, endDate);

    let projectProductIds: number[] = [];
    let projectShipmentIds: string[] = [];

    if (projectId) {
      const shipments = await qb
        .selectFrom('import_shipments')
        .select(['id', 'shipping_expense_id', 'customs_expense_id', 'transport_expense_id'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .execute();

      projectShipmentIds = shipments.map((s) => s.id);

      if (projectShipmentIds.length > 0) {
        const items = await qb
          .selectFrom('import_shipment_items')
          .select('product_id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', 'in', projectShipmentIds)
          .execute();

        projectProductIds = [...new Set(items.map((i) => Number(i.product_id)))];
      }
    }

    let totalRevenue = 0;
    let totalCost = 0;
    let totalDiscounts = 0;
    let returnRevenue = 0;
    let returnCost = 0;
    let profitAttributionVerified = false;
    let attributionStatus = 'UNVERIFIED_SOURCE';

    if (projectId) {
      // 1. Query exact lot allocations for this project
      const lotAllocations = await qb
        .selectFrom('import_sale_allocations')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('created_at', '>=', start)
        .where('created_at', '<=', end)
        .execute();

      // Check if this project has traceable inventory lots
      const projectLotsCount = await qb
        .selectFrom('import_inventory_lots')
        .select(sql<number>`count(*)`.as('c'))
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const hasLots = Number(projectLotsCount?.c || 0) > 0;

      if (lotAllocations.length > 0) {
        let grossRevenue = 0;
        let grossCost = 0;
        let cancelledRevenue = 0;
        let cancelledCost = 0;

        for (const alloc of lotAllocations) {
          const q = Number(alloc.quantity);
          const price = Number(alloc.unit_sale_price_egp || 0);
          const cost = Number(alloc.unit_cost_egp || 0);
          const absQty = Math.abs(q);

          if (alloc.allocation_type === 'return') {
            returnRevenue += absQty * price;
            returnCost += absQty * cost;
          } else if (alloc.allocation_type === 'cancellation' || alloc.allocation_type === 'reversal') {
            cancelledRevenue += absQty * price;
            cancelledCost += absQty * cost;
          } else {
            grossRevenue += absQty * price;
            grossCost += absQty * cost;
          }
        }
        totalRevenue = grossRevenue - cancelledRevenue;
        totalCost = grossCost - cancelledCost;
        // A partial set of lot allocations is not proof that every sale has provenance.
        const candidateLines = projectProductIds.length
          ? await qb
              .selectFrom('sale_items as si')
              .innerJoin('sales as sa', 'sa.id', 'si.sale_id')
              .select(['si.id', 'si.qty'])
              .where('sa.tenant_id', '=', tenantId)
              .where('sa.status', '!=', 'cancelled')
              .where('sa.created_at', '>=', start)
              .where('sa.created_at', '<=', end)
              .where('si.product_id', 'in', projectProductIds)
              .execute()
          : [];
        const saleItemIds = candidateLines.map((l) => Number(l.id));
        const allSaleAllocations = saleItemIds.length
          ? await qb
              .selectFrom('import_sale_allocations')
              .select(['sale_item_id', 'quantity'])
              .where('tenant_id', '=', tenantId)
              .where('allocation_type', '=', 'sale')
              .where('sale_item_id', 'in', saleItemIds)
              .execute()
          : [];
        const allocated = new Map<number, number>();
        for (const al of allSaleAllocations) {
          const key = Number(al.sale_item_id);
          allocated.set(key, (allocated.get(key) || 0) + Number(al.quantity));
        }
        const incomplete = candidateLines.some((l) => (allocated.get(Number(l.id)) || 0) + 0.0001 < Number(l.qty));
        profitAttributionVerified = !incomplete;
        attributionStatus = incomplete ? 'INCOMPLETE_SALE_LOT_ALLOCATION' : 'VERIFIED_LOT_ALLOCATIONS';
      } else if (hasLots) {
        // Zero allocation records are not proof of zero POS sales.
        const possibleSale = projectProductIds.length
          ? await qb
              .selectFrom('sale_items as si')
              .innerJoin('sales as sa', 'sa.id', 'si.sale_id')
              .select('si.sale_id')
              .where('sa.tenant_id', '=', tenantId)
              .where('sa.status', '!=', 'cancelled')
              .where('sa.created_at', '>=', start)
              .where('sa.created_at', '<=', end)
              .where('si.product_id', 'in', projectProductIds)
              .executeTakeFirst()
          : null;
        totalRevenue = 0;
        totalCost = 0;
        returnRevenue = 0;
        returnCost = 0;
        profitAttributionVerified = !possibleSale;
        attributionStatus = possibleSale ? 'UNVERIFIED_SOURCE' : 'NO_SALES_RECORDED';
      } else {
        // Fallback: Check if project items have any provisional sales (legacy non-lotted projects only)
        const projectItems =
          projectShipmentIds.length > 0
            ? await qb
                .selectFrom('import_shipment_items')
                .select(['product_id', 'received_quantity', 'quantity', 'landed_cost_egp'])
                .where('tenant_id', '=', tenantId)
                .where('shipment_id', 'in', projectShipmentIds)
                .execute()
            : [];

        const productSources = new Map<number, { receivedQty: number; unitCost: number }>();
        for (const item of projectItems) {
          const pId = Number(item.product_id);
          const qty = Number(item.received_quantity ?? item.quantity ?? 0);
          const cost = Number(item.landed_cost_egp || 0);
          const existing = productSources.get(pId);
          if (existing) {
            const totalQ = existing.receivedQty + qty;
            const weightedCost = totalQ > 0 ? (existing.receivedQty * existing.unitCost + qty * cost) / totalQ : cost;
            productSources.set(pId, { receivedQty: totalQ, unitCost: weightedCost });
          } else {
            productSources.set(pId, { receivedQty: qty, unitCost: cost });
          }
        }

        if (projectProductIds.length > 0) {
          const salesRows = await qb
            .selectFrom('sales')
            .innerJoin('sale_items', 'sale_items.sale_id', 'sales.id')
            .select([
              'sale_items.product_id',
              'sale_items.qty',
              'sale_items.line_total',
              'sale_items.allocated_discount',
            ])
            .where('sales.tenant_id', '=', tenantId)
            .where('sales.status', '!=', 'cancelled')
            .where('sales.created_at', '>=', start)
            .where('sales.created_at', '<=', end)
            .where('sale_items.product_id', 'in', projectProductIds)
            .orderBy('sales.created_at', 'asc')
            .execute();

          const remainingSource = new Map<number, number>();
          for (const [pId, src] of productSources.entries()) {
            remainingSource.set(pId, src.receivedQty);
          }

          for (const row of salesRows) {
            const pId = Number(row.product_id);
            const avail = remainingSource.get(pId) || 0;
            if (avail > 0) {
              const soldFromProject = Math.min(Number(row.qty), avail);
              const ratio = Number(row.qty) > 0 ? soldFromProject / Number(row.qty) : 1;
              totalRevenue += Number(row.line_total) * ratio;
              totalDiscounts += Number(row.allocated_discount || 0) * ratio;
              totalCost += soldFromProject * (productSources.get(pId)?.unitCost || 0);
              remainingSource.set(pId, avail - soldFromProject);
            }
          }

          const returnRows = await qb
            .selectFrom('return_documents')
            .innerJoin('return_items', 'return_items.return_document_id', 'return_documents.id')
            .select(['return_items.product_id', 'return_items.qty', 'return_items.line_total'])
            .where('return_documents.tenant_id', '=', tenantId)
            .where('return_documents.return_type', '=', 'sale')
            .where('return_documents.created_at', '>=', start)
            .where('return_documents.created_at', '<=', end)
            .where('return_items.product_id', 'in', projectProductIds)
            .execute();

          for (const rRow of returnRows) {
            const pId = Number(rRow.product_id);
            const src = productSources.get(pId);
            if (src) {
              returnRevenue += Number(rRow.line_total);
              returnCost += Number(rRow.qty) * src.unitCost;
            }
          }
        }

        if (totalRevenue === 0 && returnRevenue === 0) {
          profitAttributionVerified = true;
          attributionStatus = 'NO_SALES_RECORDED';
        } else {
          profitAttributionVerified = false;
          attributionStatus = 'UNVERIFIED_SOURCE';
        }
      }
    } else {
      profitAttributionVerified = true;
      attributionStatus = 'COMPANY_WIDE';
      // General company-wide period report
      const salesData = await qb
        .selectFrom('sales')
        .innerJoin('sale_items', 'sale_items.sale_id', 'sales.id')
        .select([
          sql<number>`coalesce(sum(sale_items.line_total), 0)`.as('total_revenue'),
          sql<number>`coalesce(sum(sale_items.qty * sale_items.cost_price), 0)`.as('total_cost'),
          sql<number>`coalesce(sum(sale_items.allocated_discount), 0)`.as('total_discount'),
        ])
        .where('sales.tenant_id', '=', tenantId)
        .where('sales.status', '!=', 'cancelled')
        .where('sales.created_at', '>=', start)
        .where('sales.created_at', '<=', end)
        .executeTakeFirst();

      totalRevenue = Number(salesData?.total_revenue || 0);
      totalCost = Number(salesData?.total_cost || 0);
      totalDiscounts = Number(salesData?.total_discount || 0);

      const returnData = await qb
        .selectFrom('return_documents')
        .innerJoin('return_items', 'return_items.return_document_id', 'return_documents.id')
        .select([
          sql<number>`coalesce(sum(return_items.line_total), 0)`.as('return_revenue'),
          sql<number>`coalesce(sum(return_items.qty * return_items.cost_price), 0)`.as('return_cost'),
        ])
        .where('return_documents.tenant_id', '=', tenantId)
        .where('return_documents.return_type', '=', 'sale')
        .where('return_documents.created_at', '>=', start)
        .where('return_documents.created_at', '<=', end)
        .executeTakeFirst();

      returnRevenue = Number(returnData?.return_revenue || 0);
      returnCost = Number(returnData?.return_cost || 0);
    }

    const netSalesRevenue = totalRevenue - totalDiscounts - returnRevenue;
    const netCogs = totalCost - returnCost;
    const grossProfit = netSalesRevenue - netCogs;

    let totalExpenses = 0;
    let postedCostComponents: {
      shortageExpenseEgp: number;
      brokerExpensedEgp: number;
      fxVarianceEgp: number;
      depositDeductionsEgp: number;
      totalPostedCostComponentsEgp: number;
    } | null = null;
    let unpostedEstimatesExcluded: {
      unpostedTripEstimatesEgp: number;
      unpostedLateExpenseMemosEgp: number;
      totalExcludedEgp: number;
    } | null = null;

    if (projectId) {
      const sourcingExpenses = await qb
        .selectFrom('import_sourcing_trips')
        .select([sql<number>`coalesce(sum(actual_cost_egp), 0)`.as('total_sourcing')])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        // Posted expenses only (INV-IMPORT-FX-TRIPS-POSTING):
        // an unposted trip is a memo estimate, never a financial
        // report figure. Counting it here would double-count the
        // moment it posts, and overstate profit before it does.
        .where('journal_entry_id', 'is not', null)
        .where('start_date', '>=', startKey)
        .where('start_date', '<=', endKey)
        .executeTakeFirst();

      const lateCogsExp = projectShipmentIds.length
        ? await qb
            .selectFrom('import_late_expense_events')
            .select([sql<number>`coalesce(sum(cogs_amount_egp), 0)`.as('total_late_cogs')])
            .where('tenant_id', '=', tenantId)
            .where('shipment_id', 'in', projectShipmentIds)
            .where('created_at', '>=', start)
            .where('created_at', '<=', end)
            .executeTakeFirst()
        : null;

      totalExpenses = Number(sourcingExpenses?.total_sourcing || 0) + Number(lateCogsExp?.total_late_cogs || 0);

      // Posted-ledger components (INV-IMPORT-PROFIT-HONESTY): the
      // project report counts only posted evidence. Each component
      // below is read from a posted journal; folded/revalued broker
      // costs are excluded by construction (already inside the
      // receipt / late-expense journals). A signed FX variance is
      // kept signed: a gain reduces expenses.
      const components = await this.sumPostedProjectCostComponents(qb, tenantId, projectId, start, end);
      const totalPostedCostComponentsEgp = roundMoney(
        components.shortageExpenseEgp +
          components.brokerExpensedEgp +
          components.fxVarianceEgp +
          components.depositDeductionsEgp,
        digits,
      );
      postedCostComponents = {
        shortageExpenseEgp: roundMoney(components.shortageExpenseEgp, digits),
        brokerExpensedEgp: roundMoney(components.brokerExpensedEgp, digits),
        fxVarianceEgp: roundMoney(components.fxVarianceEgp, digits),
        depositDeductionsEgp: roundMoney(components.depositDeductionsEgp, digits),
        totalPostedCostComponentsEgp,
      };
      totalExpenses = roundMoney(totalExpenses + totalPostedCostComponentsEgp, digits);

      // Estimates that must NOT enter profit, reported so the
      // reader can see exactly what was left out and why: trips
      // with no posted journal and late-expense memo rows with no
      // posted journal are not financial evidence yet.
      const unpostedTrips = await qb
        .selectFrom('import_sourcing_trips')
        .select([sql<number>`coalesce(sum(actual_cost_egp), 0)`.as('total_unposted')])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('journal_entry_id', 'is', null)
        .where('start_date', '>=', startKey)
        .where('start_date', '<=', endKey)
        .executeTakeFirst();
      const unpostedLate = projectShipmentIds.length
        ? await qb
            .selectFrom('import_late_expense_events')
            .select([sql<number>`coalesce(sum(total_amount_egp), 0)`.as('total_unposted')])
            .where('tenant_id', '=', tenantId)
            .where('shipment_id', 'in', projectShipmentIds)
            .where('journal_entry_id', 'is', null)
            .where('created_at', '>=', start)
            .where('created_at', '<=', end)
            .executeTakeFirst()
        : null;
      const unpostedTripEstimatesEgp = Number(unpostedTrips?.total_unposted || 0);
      const unpostedLateExpenseMemosEgp = Number(unpostedLate?.total_unposted || 0);
      unpostedEstimatesExcluded = {
        unpostedTripEstimatesEgp: roundMoney(unpostedTripEstimatesEgp, digits),
        unpostedLateExpenseMemosEgp: roundMoney(unpostedLateExpenseMemosEgp, digits),
        totalExcludedEgp: roundMoney(unpostedTripEstimatesEgp + unpostedLateExpenseMemosEgp, digits),
      };
    } else {
      const shipmentExpenseIds = await qb
        .selectFrom('import_shipments')
        .select(['shipping_expense_id', 'customs_expense_id', 'transport_expense_id'])
        .where('tenant_id', '=', tenantId)
        .execute();

      const excludedExpenseIds = new Set<number>();
      for (const s of shipmentExpenseIds) {
        if (s.shipping_expense_id) excludedExpenseIds.add(Number(s.shipping_expense_id));
        if (s.customs_expense_id) excludedExpenseIds.add(Number(s.customs_expense_id));
        if (s.transport_expense_id) excludedExpenseIds.add(Number(s.transport_expense_id));
      }

      let expensesQuery = qb
        .selectFrom('expenses')
        .select([sql<number>`coalesce(sum(amount), 0)`.as('total_expenses')])
        .where('tenant_id', '=', tenantId)
        .where('expense_date', '>=', start)
        .where('expense_date', '<=', end)
        .where((eb) =>
          eb.and([eb('title', 'not like', 'حوالة خارجية%'), eb('title', 'not like', 'صرف أرباح الشريك%')]),
        );

      if (excludedExpenseIds.size > 0) {
        expensesQuery = expensesQuery.where('id', 'not in', Array.from(excludedExpenseIds));
      }

      const expensesData = await expensesQuery.executeTakeFirst();
      totalExpenses = Number(expensesData?.total_expenses || 0);
    }

    const netProfitPool = grossProfit - totalExpenses;

    let partners: any[] = [];
    if (projectId) {
      partners = await qb
        .selectFrom('import_project_partners')
        .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
        .select([
          'import_partners.id',
          'import_partners.name',
          'import_project_partners.profit_percentage as profit_share_percentage',
          'import_partners.withdrawn_profit',
        ])
        .where('import_project_partners.tenant_id', '=', tenantId)
        .where('import_project_partners.project_id', '=', projectId)
        .where('import_project_partners.is_active', '=', true)
        .execute();
    }

    if (!projectId && partners.length === 0) {
      partners = await qb.selectFrom('import_partners').selectAll().where('tenant_id', '=', tenantId).execute();
    }

    const paidForProject = projectId
      ? await qb
          .selectFrom('import_partner_project_payouts')
          .select(['partner_id', sql<number>`coalesce(sum(amount_egp), 0)`.as('paid')])
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', projectId)
          .groupBy('partner_id')
          .execute()
      : [];
    const payoutMap = new Map(paidForProject.map((v) => [String(v.partner_id), Number(v.paid)]));
    const partnerShares = partners.map((p) => {
      const percentage = Number(p.profit_share_percentage) || 0;
      const shareAmount = netProfitPool > 0 ? (netProfitPool * percentage) / 100 : 0;
      const withdrawn = projectId ? payoutMap.get(String(p.id)) || 0 : Number(p.withdrawn_profit) || 0;
      return {
        partnerId: p.id,
        name: p.name,
        percentage,
        shareAmount: roundMoney(shareAmount, digits),
        withdrawnProfit: roundMoney(withdrawn, digits),
        currentBalance: roundMoney(shareAmount - withdrawn, digits),
      };
    });

    return {
      success: true,
      message: projectId ? 'تم تجميع أرباح مشروع الاستيراد بنجاح' : 'تم تجميع أرباح الشراكة العامة بنجاح',
      data: {
        projectId: projectId || null,
        profitAttributionVerified,
        attributionStatus,
        grossSalesRevenue: roundMoney(totalRevenue, digits),
        salesDiscounts: roundMoney(totalDiscounts, digits),
        salesReturnsRevenue: roundMoney(returnRevenue, digits),
        netSalesRevenue: roundMoney(netSalesRevenue, digits),
        totalRevenue: roundMoney(netSalesRevenue, digits),
        grossCogs: roundMoney(totalCost, digits),
        returnsCogs: roundMoney(returnCost, digits),
        netCogs: roundMoney(netCogs, digits),
        totalCost: roundMoney(netCogs, digits),
        grossProfit: roundMoney(grossProfit, digits),
        operatingExpenses: roundMoney(totalExpenses, digits),
        totalExpenses: roundMoney(totalExpenses, digits),
        netProfitPool: roundMoney(netProfitPool, digits),
        postedCostComponents,
        unpostedEstimatesExcluded,
        profitBasis: projectId ? 'POSTED_LEDGER_ONLY' : 'COMPANY_WIDE_EXPENSES_TABLE',
        partnerShares,
      },
    };
  }

  async getImportCommandCenterMetrics(tenantId: string) {
    const partnerCapital = await this.db
      .selectFrom('import_partner_ledger')
      .select([
        sql<number>`coalesce(sum(case when type = 'DEPOSIT' then amount else 0 end), 0)`.as('total_deposits'),
        sql<number>`coalesce(sum(case when type = 'WITHDRAWAL' then amount else 0 end), 0)`.as('total_withdrawals'),
      ])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const netPaidInCapital = Math.max(
      0,
      Number(partnerCapital?.total_deposits || 0) - Number(partnerCapital?.total_withdrawals || 0),
    );

    const shipmentExpenses = await this.db
      .selectFrom('import_shipments')
      .innerJoin('expenses', (join) =>
        join.on((eb) =>
          eb.or([
            eb('expenses.id', '=', eb.ref('import_shipments.shipping_expense_id')),
            eb('expenses.id', '=', eb.ref('import_shipments.customs_expense_id')),
            eb('expenses.id', '=', eb.ref('import_shipments.transport_expense_id')),
          ]),
        ),
      )
      .select([sql<number>`coalesce(sum(expenses.amount), 0)`.as('total_shipment_costs')])
      .where('import_shipments.tenant_id', '=', tenantId)
      .executeTakeFirst();

    const transferOutflows = await this.db
      .selectFrom('treasury_transactions')
      .select([sql<number>`coalesce(sum(abs(amount)), 0)`.as('total_transfers')])
      .where('tenant_id', '=', tenantId)
      .where('txn_type', '=', 'supplier_payment')
      .where('reference_type', '=', 'supplier_payment')
      .executeTakeFirst();

    const sourcingTripCosts = await this.db
      .selectFrom('import_sourcing_trips')
      .select([sql<number>`coalesce(sum(actual_cost_egp), 0)`.as('total_trips')])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const deployedCapital =
      Number(shipmentExpenses?.total_shipment_costs || 0) +
      Number(transferOutflows?.total_transfers || 0) +
      Number(sourcingTripCosts?.total_trips || 0);

    const availableCapital = Math.max(0, netPaidInCapital - deployedCapital);

    const projectRows = await this.db
      .selectFrom('import_projects')
      .select(['status', sql<number>`count(*)`.as('count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('status')
      .execute();

    const projectCounts: Record<string, number> = {};
    for (const r of projectRows) {
      projectCounts[r.status || 'unknown'] = Number(r.count || 0);
    }

    const shipmentRows = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();

    let inTransitCount = 0;
    let inCustomsCount = 0;
    let arrivedCount = 0;

    for (const s of shipmentRows) {
      if (s.status === 'Arrived') arrivedCount++;
      else if (s.status === 'In Customs') inCustomsCount++;
      else inTransitCount++;
    }

    const foreignDebts = await this.db
      .selectFrom('suppliers')
      .leftJoin('import_suppliers_meta', 'import_suppliers_meta.supplier_id', 'suppliers.id')
      .select(['suppliers.id', 'suppliers.name', 'suppliers.balance', 'import_suppliers_meta.audit_status'])
      .where('suppliers.tenant_id', '=', tenantId)
      .where('suppliers.balance', '>', 0)
      .execute();

    const openProformas = await this.db
      .selectFrom('import_proforma_invoices')
      .select(['supplier_id', 'total_amount_foreign', 'paid_amount_foreign', 'currency'])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'cancelled')
      .where('payment_status', '!=', 'paid')
      .execute();

    const unpaidProformaBySupplier = new Map<number, number>();
    let unpaidProformaForeign = 0;
    for (const pi of openProformas) {
      const rem = Math.max(0, Number(pi.total_amount_foreign || 0) - Number(pi.paid_amount_foreign || 0));
      unpaidProformaForeign += rem;
      if (pi.supplier_id) {
        const sId = Number(pi.supplier_id);
        unpaidProformaBySupplier.set(sId, (unpaidProformaBySupplier.get(sId) || 0) + rem);
      }
    }

    // Book digits for the EGP figures below (U4 W1 canonical wiring
    // for the demurrage estimates; INV-MONEY-PRECISION-HR-IMPORT-3DP
    // for the capital / debt totals): the USD figures keep their
    // hardcoded 2dp, which is correct for USD.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    const supplierLiabilities = foreignDebts.map((s) => ({
      supplierId: s.id,
      supplierName: s.name,
      balance: Number(s.balance || 0),
      balanceEgp: Number(s.balance || 0),
      unpaidForeignUsd: Number((unpaidProformaBySupplier.get(Number(s.id)) || 0).toFixed(2)),
      currency: 'EGP',
      isBankVerified: s.audit_status === 'verified',
    }));

    const totalDebtEgp = foreignDebts.reduce((sum, s) => sum + Number(s.balance || 0), 0);
    // Mixed currency by design: the foreign branch is USD (2dp is
    // correct), the fallback is the EGP total at book digits.
    const totalDebtForeign =
      unpaidProformaForeign > 0 ? Number(unpaidProformaForeign.toFixed(2)) : roundMoney(totalDebtEgp, digits);

    const demurrageAlerts: any[] = [];
    for (const s of shipmentRows.filter((r) => r.status !== 'Arrived')) {
      const risk = calculateDemurrageRisk({
        arrivalDate: s.arrival_date,
        demurrageStartDate: s.demurrage_start_date,
        freeDays: s.free_demurrage_days,
        ratePerDayUsd: s.demurrage_rate_per_day,
        exchangeRate: s.exchange_rate_at_arrival,
        status: s.container_status === 'empty_returned' ? 'empty_returned' : s.status || 'Pending',
        moneyDigits: digits,
      });
      if (risk.isOverdue || (risk.daysRemaining !== null && risk.daysRemaining <= 3)) {
        demurrageAlerts.push({
          shipmentId: s.id,
          containerNumber: s.container_number,
          status: s.status,
          ...risk,
        });
      }
    }

    // The ACI expiry window is the TENANT's day + 14 days, not the DB
    // host's day + 14: CURRENT_DATE is the database server's day, which
    // differs from the tenant's around the tenant midnight.
    const todayKey = await resolveBusinessDateKey(this.db, tenantId, new Date());
    const acidBound = addDaysToDayKey(todayKey, 14) ?? todayKey;
    const aciExpiring = await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', 'not in', ['approved', 'expired'])
      .where('acid_expiry_date', 'is not', null)
      .where('acid_expiry_date', '<=', acidBound)
      .execute();

    const monthStart = new Date();
    monthStart.setDate(1);
    const profitReport = await this.generatePeriodProfitReport(tenantId, monthStart, new Date());

    return {
      capital: {
        totalCapital: roundMoney(netPaidInCapital, digits),
        deployedCapital: roundMoney(deployedCapital, digits),
        availableCapital: roundMoney(availableCapital, digits),
      },
      pipeline: {
        projects: projectCounts,
        shipments: {
          inTransit: inTransitCount,
          inCustoms: inCustomsCount,
          arrived: arrivedCount,
          total: shipmentRows.length,
        },
      },
      liabilities: {
        totalDebtForeign,
        totalDebtEgp: roundMoney(totalDebtEgp, digits),
        unpaidProformaUsd: Number(unpaidProformaForeign.toFixed(2)),
        supplierLiabilities,
      },
      alerts: {
        demurrageAlerts,
        aciExpiring,
      },
      performance: profitReport.data,
    };
  }
}
