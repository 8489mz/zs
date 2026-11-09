/*
 * Pins D6c (unification batch U3): miscellaneous money computation rounds
 * at the tenant's book digits instead of a hardcoded toFixed(2).
 *
 * WHAT THIS PINS (drives the real code, no copies of the rounding math):
 * - AR dunning (pure engine): FIFO overdue allocation at 3 digits keeps
 *   100.125 (old code: 100.13); the 2dp default is unchanged.
 * - Import feasibility (pure engine): money outputs at 3 digits keep
 *   100.125 / 300.375 (old code: 100.13 / 300.38); a missing, zero or
 *   negative commercial exchange rate now FAILS CLOSED instead of
 *   silently pricing at the old hardcoded fallback 50 (F1).
 * - Import lot sale cost (pure) + lot allocation / cancel-restore on
 *   PGlite: the stored gross_margin_egp columns round at EGP digits (2)
 *   — NOT tenant book digits — because the amount is EGP-denominated
 *   (W3 policy correction, supersedes the D6c choice: a KWD tenant's
 *   3 book digits on an EGP column would leave 3dp in EGP amounts
 *   that are 2dp everywhere else). KWD tenant stores 100.13, reversal
 *   -100.13; the helper no longer resolves digits on the transaction
 *   handle. The pure calculateImportSaleCost moneyDigits param is
 *   unchanged (Phase C still pins an explicit 3-digit call at 83.438);
 *   its live caller passes no digits, so the live total stays EGP 2dp.
 * - Cash-drawer helpers + returns-listing summary (pure): 3-digit totals
 *   keep 100.125.
 * - Live service paths on PGlite (KWD vs EGP tenants): services list
 *   summary, partner remaining credit, settings diagnostics finance,
 *   RFQ-to-PO totals, tip-pool split (last member takes the remainder so
 *   the split still sums to the pool), pending food-waste stored cost,
 *   returns listing summary, contracting escalation compensation.
 *
 * Deliberately NOT pinned here: loyalty-points balances (a points unit,
 * not money — D4 precedent); display-only template strings; percentages,
 * ratios, weights and volumes (non-money toFixed sites left as-is).
 *
 * WIRING FOLLOW-UP (U3, same package): the optional-digits engines are
 * now wired at their live callers, pinned by live-service phases:
 * - N: ar-collections syncCollections stores the dunning case total at
 *   book digits (KWD 100.125, EGP 100.13).
 * - O: cash-drawer listCashierShifts summary totalVariance + the shift
 *   cash-return movement item at book digits (KWD 100.125, EGP 100.13).
 * - P: purchases getReorderSuggestions estimated totals at book digits
 *   (KWD 100.125, EGP 100.13) — the helper's money outputs now take the
 *   service's resolved digits; quantities and run rates stay at 2dp.
 * - Q: contracting getProjectEvmMetrics cv/sv/eac/vac at book digits
 *   (KWD 66.755 / -399.875 / 333.333 / 666.667; EGP 66.76 / -399.87 /
 *   333.33 / 666.67). AC comes from the cost breakdown, which still
 *   rounds its own total to 2dp (33.37) — that cut is out of scope here.
 * NOT wired here (owned elsewhere this batch): import-sales
 * calculateFeasibility (F1 owns import-sales.service.ts).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import {
  evaluateCustomerDunning,
  type DunningLevel,
  type CustomerDunningInput,
} from '../../src/modules/accounting/engines/ar-dunning.engine';
import { calculateImportFeasibility } from '../../src/modules/import-sales/engines/import-feasibility.engine';
import {
  allocateSaleFromImportLots,
  calculateImportSaleCost,
  restoreImportLotsFromCancelledSale,
} from '../../src/modules/import-sales/helpers/import-lot-allocation.helper';
import {
  buildShiftCashReturnItem,
  summarizeCashDrawerRows,
} from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';
import { summarizeReturnRows } from '../../src/modules/returns/helpers/returns-listing.helper';
import { ServicesService } from '../../src/modules/services/services.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { SettingsAdminService } from '../../src/modules/settings/services/settings-admin.service';
import { PurchaseRfqsService } from '../../src/modules/purchases/services/purchase-rfqs.service';
import { RestaurantAdvancedFnbService } from '../../src/modules/sales/services/restaurant-advanced-fnb.service';
import { RestaurantFoodWasteService } from '../../src/modules/sales/services/restaurant-food-waste.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { ContractingService } from '../../src/modules/contracting/contracting.service';
import { ArCollectionsService } from '../../src/modules/accounting/services/ar-collections.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { PurchasesReorderService } from '../../src/modules/purchases/services/purchases-reorder.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

const KWD_AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;
const EGP_AUTH = {
  tenantId: 't3', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;
const SUPER_AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'super_admin', userId: 1, username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;
const SUPER_AUTH_EGP = {
  tenantId: 't3', accountId: 'a1', role: 'super_admin', userId: 1, username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, tenantId: string, currency: string): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS settings (tenant_id text, key text, value text, PRIMARY KEY (tenant_id, key))`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric)`.execute(db);
  await sql`INSERT INTO settings (tenant_id, key, value) VALUES (${tenantId}, 'currency', ${currency})`.execute(db);
  await sql`INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES (${tenantId}, ${currency}, true, 1)`.execute(db);
}

async function main(): Promise<void> {
  // Phase A: AR dunning, pure engine.
  {
    const levels: DunningLevel[] = [{
      id: 'lvl-1', level_order: 1, level_name: 'تذكير ودي', days_past_due: 7,
      auto_block_sales: false, action_type: 'whatsapp', template_text: 'مستحق {total_overdue}',
    }];
    const input: CustomerDunningInput = {
      customerId: 101, customerName: 'شركة النور', balance: 100.125,
      invoices: [{ id: 1, invoiceNumber: 'INV-001', createdAt: '2026-08-01T10:00:00Z', total: 100.125, paidAmount: 0 }],
      asOfDate: new Date('2026-10-01T12:00:00Z'),
    };
    const kwd = evaluateCustomerDunning(input, levels, undefined, 3);
    assert.equal(kwd.totalBalance, 100.125);
    assert.equal(kwd.totalOverdue, 100.125);
    assert.equal(kwd.overdueInvoices[0].allocatedOverdueAmount, 100.125);
    assert.equal(kwd.overdueInvoices[0].total, 100.125);
    const egp = evaluateCustomerDunning(input, levels);
    assert.equal(egp.totalBalance, 100.13);
    assert.equal(egp.totalOverdue, 100.13);
    console.log('phase A dunning passed');
  }

  // Phase B: import feasibility, pure engine + FX fail-closed.
  {
    const base = {
      items: [{ name: 'Item A', qty: 3, factoryPriceUsd: 10 }],
      exchangeRateCommercial: 10.0125,
      exchangeRateCustoms: 10.0125,
      internationalShippingUsd: 0,
      insuranceUsd: 0,
      customsDutyRatePercent: 0,
      vatRatePercent: 0,
      clearanceAndPortFeesEgp: 0,
      internalTransportEgp: 0,
      travelAndSourcingCostEgp: 0,
      targetMarkupPercent: 0,
      vatIsRefundable: false,
    };
    const kwd = calculateImportFeasibility({ ...base, moneyDigits: 3 });
    assert.equal(kwd.totalFactoryCostEgp, 300.375);
    assert.equal(kwd.items[0].unitLandedCostEgp, 100.125);
    assert.equal(kwd.items[0].totalFactoryUsd, 30);
    const egp = calculateImportFeasibility(base);
    assert.equal(egp.totalFactoryCostEgp, 300.38);
    assert.equal(egp.items[0].unitLandedCostEgp, 100.13);
    // F1: no silent fallback-50 — a missing, zero or negative rate throws.
    assert.throws(() => calculateImportFeasibility({ ...base, exchangeRateCommercial: undefined as never }));
    assert.throws(() => calculateImportFeasibility({ ...base, exchangeRateCommercial: 0 }));
    assert.throws(() => calculateImportFeasibility({ ...base, exchangeRateCommercial: -5 }));
    console.log('phase B feasibility passed');
  }

  // Phase C: import lot sale cost, pure.
  {
    const kwd = calculateImportSaleCost({ qty: 3, allocatedQty: 2, allocCostEgp: 66.75, fallbackUnitCostEgp: 16.6875, moneyDigits: 3 });
    assert.equal(kwd.shortfallQty, 1);
    assert.equal(kwd.totalCostEgp, 83.438);
    const egp = calculateImportSaleCost({ qty: 3, allocatedQty: 2, allocCostEgp: 66.75, fallbackUnitCostEgp: 16.6875 });
    assert.equal(egp.totalCostEgp, 83.44);
    console.log('phase C lot sale cost passed');
  }

  // Phase D: cash-drawer helpers + returns-listing summary, pure.
  {
    const summary = summarizeCashDrawerRows([{ status: 'open', variance: 100.125 } as never], 3);
    assert.equal(summary.totalVariance, 100.125);
    assert.equal(summarizeCashDrawerRows([{ status: 'open', variance: 100.125 } as never]).totalVariance, 100.13);
    const item = buildShiftCashReturnItem({ id: 1, cash_refund: 100.125 }, 3);
    assert.equal(item?.amount, 100.125);
    assert.equal(buildShiftCashReturnItem({ id: 1, cash_refund: 100.125 })?.amount, 100.13);
    const ret = summarizeReturnRows([{ id: '1', total: 100.125, returnType: 'sale', createdAt: '2026-11-08' } as never, { id: '2', total: 0, returnType: 'sale', createdAt: '2026-11-08' } as never], '2026-11-08', 3);
    assert.equal(ret.totalAmount, 100.125);
    assert.equal(summarizeReturnRows([{ id: '1', total: 100.125, returnType: 'sale', createdAt: '2026-11-08' } as never], '2026-11-08').totalAmount, 100.13);
    console.log('phase D helpers passed');
  }

  // Phase E: services list summary on PGlite, KWD vs EGP.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, is_active boolean DEFAULT true);
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
        CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, name text, amount numeric, notes text, service_date timestamptz, payment_channel text, branch_id bigint, location_id bigint, created_by bigint);
        INSERT INTO branches VALUES (1, 't1', 'Main', true), (2, 't3', 'Main', true);
        INSERT INTO stock_locations VALUES (1, 't1', 1, 'Store', true), (2, 't3', 2, 'Store', true);
        INSERT INTO users VALUES (1, 't1', 'admin'), (2, 't3', 'admin');
        INSERT INTO services (id, tenant_id, name, amount, service_date, payment_channel, branch_id, location_id, created_by)
          VALUES (1, 't1', 'cash svc', 66.75, NOW(), 'cash', 1, 1, 1), (2, 't1', 'card svc', 33.375, NOW(), 'card', 1, 1, 1),
                 (3, 't3', 'cash svc', 66.75, NOW(), 'cash', 2, 2, 2), (4, 't3', 'card svc', 33.375, NOW(), 'card', 2, 2, 2);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      await sql`INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'Africa/Cairo'), ('t3', 'timezone', 'Africa/Cairo')`.execute(db);
      const service = new ServicesService(db as never, {} as never, {} as never, {} as never, {} as never);
      const kwd = await service.listServices({}, KWD_AUTH) as any;
      assert.equal(kwd.summary.totalAmount, 100.125);
      assert.equal(kwd.summary.cashAmount, 66.75);
      assert.equal(kwd.summary.cardAmount, 33.375);
      assert.equal(kwd.summary.averageAmount, 50.063);
      const egp = await service.listServices({}, EGP_AUTH) as any;
      assert.equal(egp.summary.totalAmount, 100.13);
      assert.equal(egp.summary.cardAmount, 33.38);
      console.log('phase E services list passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase F: partner remaining credit on PGlite.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric, credit_limit numeric, store_credit_balance numeric, customer_type text, loyalty_points numeric, is_active boolean);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, total numeric, status text, created_at timestamptz);
        CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, invoice_id bigint);
        INSERT INTO customers VALUES (1, 't1', 0.005, 100.13, 0, 'cash', 0, true), (2, 't3', 0.005, 100.13, 0, 'cash', 0, true);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new PartnersService(db as never, {} as never, {} as never);
      const kwd = await service.getCustomerPosSummary(1, KWD_AUTH) as any;
      assert.equal(kwd.remainingCredit, 100.125);
      const egp = await service.getCustomerPosSummary(2, EGP_AUTH) as any;
      assert.equal(egp.remainingCredit, 100.13);
      console.log('phase F partner credit passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase G: settings diagnostics finance summary on PGlite.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, is_active boolean);
        CREATE TABLE sessions (id bigint PRIMARY KEY, tenant_id text, expires_at timestamptz);
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, is_active boolean);
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, is_active boolean);
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, is_active boolean, balance numeric);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, is_active boolean, balance numeric);
        CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, is_active boolean);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text);
        CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text);
        CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text);
        CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text);
        CREATE TABLE treasury_transactions (id bigint PRIMARY KEY, tenant_id text, amount numeric);
        CREATE TABLE backup_snapshots (id bigint PRIMARY KEY, tenant_id text);
        CREATE TABLE audit_logs (id bigint PRIMARY KEY, tenant_id text);
        INSERT INTO customers VALUES (1, 't1', true, 100.125), (2, 't3', true, 100.125);
        INSERT INTO suppliers VALUES (1, 't1', true, 66.75), (2, 't3', true, 66.75);
        INSERT INTO treasury_transactions VALUES (1, 't1', 33.375), (2, 't3', 33.375);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new SettingsAdminService(db as never, {} as never);
      const kwd = await service.getDiagnostics(SUPER_AUTH) as any;
      assert.equal(kwd.finance.customerBalance, 100.125);
      assert.equal(kwd.finance.supplierBalance, 66.75);
      assert.equal(kwd.finance.treasuryNet, 33.375);
      const egp = await service.getDiagnostics(SUPER_AUTH_EGP) as any;
      assert.equal(egp.finance.customerBalance, 100.13);
      assert.equal(egp.finance.treasuryNet, 33.38);
      console.log('phase G diagnostics passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase H: RFQ winner conversion stores PO totals at book digits.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE purchase_rfqs (id bigint PRIMARY KEY, tenant_id text, rfq_number text, status text, expected_delivery_date timestamptz, winning_supplier_id bigint, winning_supplier_name text, converted_po_id bigint, updated_at timestamptz);
        CREATE TABLE purchase_rfq_items (id bigint PRIMARY KEY, tenant_id text, rfq_id bigint, product_id bigint, product_name text, unit_name text, target_quantity numeric);
        CREATE TABLE purchase_rfq_vendor_bids (id bigint PRIMARY KEY, tenant_id text, rfq_id bigint, rfq_item_id bigint, supplier_id bigint, supplier_name text, supplier_phone text, quoted_unit_cost numeric, tax_rate numeric, is_winner boolean);
        CREATE TABLE purchase_orders (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, order_number text, supplier_id bigint, supplier_name text, supplier_phone text, subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, status text, expected_delivery_date timestamptz, notes text, created_by bigint);
        CREATE TABLE purchase_order_items (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint, product_id bigint, product_name text, unit_name text, quantity numeric, received_quantity numeric, unit_cost numeric, tax_rate numeric, discount numeric, total numeric);
        INSERT INTO purchase_rfqs VALUES (1, 't1', 'RFQ-1', 'open', NULL, NULL, NULL, NULL, NOW()), (2, 't3', 'RFQ-2', 'open', NULL, NULL, NULL, NULL, NOW());
        INSERT INTO purchase_rfq_items VALUES (1, 't1', 1, 10, 'Widget', 'pcs', 3), (2, 't3', 2, 10, 'Widget', 'pcs', 3);
        INSERT INTO purchase_rfq_vendor_bids VALUES (1, 't1', 1, 1, 5, 'Supplier A', '0100', 33.375, 0, false), (2, 't3', 2, 2, 5, 'Supplier A', '0100', 33.375, 0, false);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new PurchaseRfqsService(db as never);
      await service.selectWinnerAndConvertToPo(KWD_AUTH, 1, 5);
      await service.selectWinnerAndConvertToPo(EGP_AUTH, 2, 5);
      const kwdPo = await db.selectFrom('purchase_orders').selectAll().where('tenant_id', '=', 't1').executeTakeFirstOrThrow();
      const egpPo = await db.selectFrom('purchase_orders').selectAll().where('tenant_id', '=', 't3').executeTakeFirstOrThrow();
      assert.equal(Number(kwdPo.subtotal), 100.125);
      assert.equal(Number(kwdPo.total_amount), 100.125);
      assert.equal(Number(egpPo.subtotal), 100.13);
      assert.equal(Number(egpPo.total_amount), 100.13);
      const kwdItem = await db.selectFrom('purchase_order_items').selectAll().where('tenant_id', '=', 't1').executeTakeFirstOrThrow();
      assert.equal(Number(kwdItem.total), 100.125);
      console.log('phase H rfq conversion passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase I: tip pool splits at book digits; the last member takes the
  // remainder so the split still sums exactly to the pool.
  // INV-REST-FNB-CLAIMS-POST (R3-E): the pool is no longer built from
  // invented client totals — it reconciles against the tips the branch
  // actually collected on the tenant-local business day, every recipient
  // must be a real active employee, and only a manager caller may create
  // it. So this phase seeds 2 active employees + 1 posted cash sale with
  // tip 100.125 on the 2026-11-08 Cairo day, and calls as an admin.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE restaurant_tip_pools (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, branch_id bigint, shift_date text, shift_name text, total_cash_tips numeric, total_card_tips numeric, total_tips numeric, distribution_method text, status text, notes text, created_at timestamptz, updated_at timestamptz);
        CREATE TABLE restaurant_tip_pool_distributions (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, pool_id bigint, employee_id bigint, employee_name text, role_name text, hours_worked numeric, point_weight numeric, allocated_amount numeric, is_paid boolean, created_at timestamptz);
        CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, status text);
        INSERT INTO hr_employees (id, tenant_id, status) VALUES (1, 't1', 'active'), (2, 't1', 'active');
        CREATE TABLE sales (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, branch_id bigint, status text, payment_type text, tip_amount numeric, created_at timestamptz);
        INSERT INTO sales (tenant_id, branch_id, status, payment_type, tip_amount, created_at) VALUES ('t1', NULL, 'posted', 'cash', 100.125, '2026-11-08T10:00:00+02:00');
      `);
      await seedCurrency(db, 't1', 'KWD');
      const service = new RestaurantAdvancedFnbService(db as never);
      const result = await service.calculateAndSaveTipPool({ tenantId: 't1', role: 'admin' }, {
        shiftDate: '2026-11-08',
        totalCashTips: 66.75,
        totalCardTips: 33.375,
        distributionMethod: 'equal',
        staff: [
          { employeeId: 1, employeeName: 'Ali', roleName: 'waiter', hoursWorked: 8 },
          { employeeId: 2, employeeName: 'Mona', roleName: 'waiter', hoursWorked: 8 },
        ],
      });
      assert.equal(result.totalTips, 100.125);
      assert.equal((result.distributions as any[])[0].allocatedAmount, 50.063);
      assert.equal((result.distributions as any[])[1].allocatedAmount, 50.062);
      assert.equal((result.distributions as any[]).reduce((s: number, d: any) => s + d.allocatedAmount, 0), 100.125);
      const stored = await db.selectFrom('restaurant_tip_pools').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(stored.total_tips), 100.125);
      console.log('phase I tip pool passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase J: pending food-waste stores the cost at book digits.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, is_active boolean);
        CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, cost_price numeric, stock_qty numeric);
        CREATE TABLE product_location_stock (id bigint PRIMARY KEY, tenant_id text, product_id bigint, location_id bigint, qty numeric);
        CREATE TABLE restaurant_food_waste_logs (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, product_id bigint, quantity numeric, cost_price numeric, total_cost numeric, reason text, notes text, logged_by bigint);
        INSERT INTO branches VALUES (1, 't1', 1), (2, 't3', 2);
        INSERT INTO stock_locations VALUES (1, 't1', 1, true), (2, 't3', 2, true);
        INSERT INTO products VALUES (10, 't1', 'a1', 'Rice', 33.375, 100), (11, 't3', 'a1', 'Rice', 33.375, 100);
        INSERT INTO product_location_stock VALUES (1, 't1', 10, 1, 1), (2, 't3', 11, 2, 1);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new RestaurantFoodWasteService(db as never, {} as never);
      await service.logWaste(KWD_AUTH, { branchId: 1, productId: 10, quantity: 3, reason: 'spoilage', allowPending: true });
      await service.logWaste(EGP_AUTH, { branchId: 2, productId: 11, quantity: 3, reason: 'spoilage', allowPending: true });
      const kwdLog = await db.selectFrom('restaurant_food_waste_logs').selectAll().where('tenant_id', '=', 't1').executeTakeFirstOrThrow();
      const egpLog = await db.selectFrom('restaurant_food_waste_logs').selectAll().where('tenant_id', '=', 't3').executeTakeFirstOrThrow();
      assert.equal(Number(kwdLog.total_cost), 100.125);
      assert.equal(Number(egpLog.total_cost), 100.13);
      console.log('phase J food waste passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase K: import lot allocation + cancel-restore store margins at
  // EGP digits (2) — the _egp denomination, not tenant book digits
  // (W3 policy correction of the D6c choice). Even the KWD tenant
  // stores 100.13, and the reversal stores -100.13.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE import_inventory_lots (id bigint PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date timestamptz, created_at timestamptz, updated_at timestamptz, unit_landed_cost_egp numeric, project_id bigint, shipment_id bigint);
        CREATE TABLE import_sale_allocations (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, project_id bigint, shipment_id bigint, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id bigint, created_at timestamptz);
        INSERT INTO import_inventory_lots VALUES (1, 't1', 7, 'active', 10, 5, NOW(), NOW(), NOW(), 10.0125, NULL, NULL), (2, 't3', 7, 'active', 10, 5, NOW(), NOW(), NOW(), 10.0125, NULL, NULL);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      await db.transaction().execute(async (trx) => {
        await allocateSaleFromImportLots(trx as never, {
          tenantId: 't1', saleId: 1, locationId: 5,
          items: [{ productId: 7, qty: 1, netUnitPrice: 110.1375 }],
        });
        await allocateSaleFromImportLots(trx as never, {
          tenantId: 't3', saleId: 2, locationId: 5,
          items: [{ productId: 7, qty: 1, netUnitPrice: 110.1375 }],
        });
      });
      const kwdAlloc = await db.selectFrom('import_sale_allocations').selectAll().where('tenant_id', '=', 't1').executeTakeFirstOrThrow();
      const egpAlloc = await db.selectFrom('import_sale_allocations').selectAll().where('tenant_id', '=', 't3').executeTakeFirstOrThrow();
      assert.equal(Number(kwdAlloc.gross_margin_egp), 100.13);
      assert.equal(Number(egpAlloc.gross_margin_egp), 100.13);
      await db.transaction().execute(async (trx) => {
        await restoreImportLotsFromCancelledSale(trx as never, { tenantId: 't1', saleId: 1 });
      });
      const reversal = await db.selectFrom('import_sale_allocations').selectAll().where('tenant_id', '=', 't1').where('allocation_type', '=', 'cancellation').executeTakeFirstOrThrow();
      assert.equal(Number(reversal.gross_margin_egp), -100.13);
      console.log('phase K lot allocation passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase L: returns listing summary at book digits (live service wiring).
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE return_items (id bigint PRIMARY KEY, return_document_id bigint, product_id bigint, product_name text, qty numeric, line_total numeric, tenant_id text);
        CREATE TABLE return_documents (id bigint PRIMARY KEY, doc_no text, return_type text, invoice_id bigint, note text, settlement_mode text, refund_method text, created_at timestamptz, created_by bigint, tenant_id text);
        CREATE TABLE users (id bigint PRIMARY KEY, username text, tenant_id text);
        CREATE TABLE sales (id bigint PRIMARY KEY, doc_no text, order_type text, customer_id bigint, tenant_id text);
        CREATE TABLE customers (id bigint PRIMARY KEY, name text, tenant_id text);
        CREATE TABLE purchases (id bigint PRIMARY KEY, doc_no text, supplier_id bigint, tenant_id text);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, name text, tenant_id text);
        INSERT INTO sales VALUES (20, 'Z-20', 'pos', NULL, 't1'), (21, 'Z-21', 'pos', NULL, 't3');
        INSERT INTO return_documents VALUES (10, 'RET-10', 'sale', 20, '', 'refund', 'cash', NOW(), NULL, 't1'), (11, 'RET-11', 'sale', 21, '', 'refund', 'cash', NOW(), NULL, 't3');
        INSERT INTO return_items VALUES (1, 10, 2, 'Tea', 1, 100.125, 't1'), (2, 11, 2, 'Tea', 1, 100.125, 't3');
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new ReturnsService(db as never, {} as never, {} as never, {} as never, {} as never);
      const kwd = await service.listReturns({}, KWD_AUTH) as any;
      const egp = await service.listReturns({}, EGP_AUTH) as any;
      assert.equal(kwd.summary.totalAmount, 100.125);
      assert.equal(egp.summary.totalAmount, 100.13);
      console.log('phase L returns listing passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase M: contracting material escalation at book digits.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE contracting_material_escalations (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, project_id bigint, claim_number text, material_type text, material_name text, base_price_contract numeric, current_market_price numeric, price_difference numeric, executed_quantity numeric, unit text, total_compensation_amount numeric, bulletin_source_reference text, status text, ipc_invoice_id bigint, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      await sql`INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'Africa/Cairo'), ('t3', 'timezone', 'Africa/Cairo')`.execute(db);
      const service = new ContractingService(db as never, {} as never);
      const kwd = await service.createMaterialEscalation(KWD_AUTH, '1', { materialType: 'steel', materialName: 'Rebar', basePriceContract: 0, currentMarketPrice: 33.375, executedQuantity: 3, unit: 'ton' } as never) as any;
      const egp = await service.createMaterialEscalation(EGP_AUTH, '1', { materialType: 'steel', materialName: 'Rebar', basePriceContract: 0, currentMarketPrice: 33.375, executedQuantity: 3, unit: 'ton' } as never) as any;
      assert.equal(Number(kwd.totalCompensationAmount), 100.125);
      assert.equal(Number(egp.totalCompensationAmount), 100.13);
      console.log('phase M contracting escalation passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase N: AR dunning, LIVE service path — syncCollections stores the
  // case total at book digits (the engine call now receives digits).
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE ar_dunning_levels (id text PRIMARY KEY, tenant_id text, level_order int, level_name text, days_past_due int, auto_block_sales boolean, action_type text, template_text text);
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric, credit_limit numeric, is_credit_blocked boolean, is_active boolean);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, created_at timestamptz, total numeric, paid_amount numeric, status text);
        CREATE TABLE ar_collection_cases (id text PRIMARY KEY, tenant_id text, customer_id bigint, current_level_id text, total_overdue numeric, oldest_overdue_days int, status text, promised_payment_date timestamptz, promised_amount numeric, updated_at timestamptz, UNIQUE (tenant_id, customer_id));
        INSERT INTO ar_dunning_levels VALUES ('lvl-1-t1', 't1', 1, 'تذكير ودي', 7, false, 'whatsapp', 'مستحق {total_overdue}'), ('lvl-1-t3', 't3', 1, 'تذكير ودي', 7, false, 'whatsapp', 'مستحق {total_overdue}');
        INSERT INTO customers VALUES (1, 't1', 'Cust A', NULL, 100.125, 0, false, true), (2, 't3', 'Cust A', NULL, 100.125, 0, false, true);
        INSERT INTO sales (id, tenant_id, customer_id, created_at, total, paid_amount, status) VALUES (1, 't1', 1, NOW() - INTERVAL '10 days', 100.125, 0, 'posted'), (2, 't3', 2, NOW() - INTERVAL '10 days', 100.125, 0, 'posted');
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new ArCollectionsService(db as never);
      const kwd = await service.syncCollections(KWD_AUTH);
      const egp = await service.syncCollections(EGP_AUTH);
      assert.equal(kwd.activeCases, 1);
      assert.equal(egp.activeCases, 1);
      const kwdCase = await db.selectFrom('ar_collection_cases').selectAll().where('tenant_id', '=', 't1').executeTakeFirstOrThrow();
      const egpCase = await db.selectFrom('ar_collection_cases').selectAll().where('tenant_id', '=', 't3').executeTakeFirstOrThrow();
      assert.equal(Number(kwdCase.total_overdue), 100.125);
      assert.equal(Number(egpCase.total_overdue), 100.13);
      console.log('phase N dunning live sync passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase O: cash-drawer, LIVE service path — listCashierShifts summary
  // totalVariance + the shift cash-return movement item at book digits.
  // Fixture tables copied from closed-shift-row-sales.spec.ts (the proven
  // hydrate path: every listed row is hydrated, so this also drives
  // fetchShiftMovementItems).
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE tenants (id text PRIMARY KEY);
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
        CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
        CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
        CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_cash_bank boolean, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
        CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
        CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
        CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
        CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
        CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
        CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
        CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
        CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
        CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
        CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
        CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, request_key text, created_at timestamptz DEFAULT NOW());
        CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
        CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, updated_at timestamptz, variance_resolution text, variance_journal_entry_id bigint, variance_charged_to_user_id bigint, variance_approved_by bigint, variance_approved_at timestamptz);
        INSERT INTO users VALUES (2, 't1', 'cashier-a', NULL, 'cashier', NULL, NULL, true), (3, 't3', 'cashier-a', NULL, 'cashier', NULL, NULL, true);
        INSERT INTO cashier_shifts (id, tenant_id, account_id, doc_no, opened_by, status, opening_cash, expected_cash, counted_cash, variance, created_at) VALUES (1, 't1', 'a1', 'SHIFT-1', 2, 'open', 0, 0, 0, 100.125, '2026-01-01T00:00:00Z'), (2, 't3', 'a1', 'SHIFT-2', 3, 'open', 0, 0, 0, 100.125, '2026-01-01T00:00:00Z');
        INSERT INTO return_documents (id, tenant_id, doc_no, return_type, settlement_mode, refund_method, refund_allocations, created_at) VALUES (10, 't1', 'RET-10', 'sale', 'refund', 'cash', '[]', '2026-01-01T10:00:00Z'), (11, 't3', 'RET-11', 'sale', 'refund', 'cash', '[]', '2026-01-01T10:00:00Z');
        INSERT INTO treasury_transactions (id, tenant_id, account_id, amount, reference_type, reference_id, payment_channel, return_document_id, created_at) VALUES (1, 't1', 'a1', -100.125, 'cashier_shift', 1, 'cash', 10, '2026-01-01T10:00:00Z'), (2, 't3', 'a1', -100.125, 'cashier_shift', 2, 'cash', 11, '2026-01-01T10:00:00Z');
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
      const posting = new AccountingPostingService(foundation);
      const drawer = new CashDrawerService(db as never, new TransactionHelper(), posting);
      const kwd = await drawer.listCashierShifts({}, KWD_AUTH) as any;
      const egp = await drawer.listCashierShifts({}, EGP_AUTH) as any;
      assert.equal(kwd.summary.totalVariance, 100.125);
      assert.equal(egp.summary.totalVariance, 100.13);
      const kwdRow = (kwd.cashierShifts as any[]).find((r) => Number(r.id) === 1);
      const egpRow = (egp.cashierShifts as any[]).find((r) => Number(r.id) === 2);
      assert.ok(kwdRow, 'KWD shift row must be listed');
      assert.ok(egpRow, 'EGP shift row must be listed');
      const kwdReturn = (kwdRow.movementItems as any[]).find((i) => i.kind === 'return');
      const egpReturn = (egpRow.movementItems as any[]).find((i) => i.kind === 'return');
      assert.ok(kwdReturn, 'KWD cash-return movement item must be present');
      assert.ok(egpReturn, 'EGP cash-return movement item must be present');
      assert.equal(kwdReturn.amount, 100.125);
      assert.equal(egpReturn.amount, 100.13);
      console.log('phase O cash-drawer live listing passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase P: purchases reorder, LIVE service path — getReorderSuggestions
  // estimated totals at book digits (helper now takes the service digits).
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, barcode text, stock_qty numeric, min_stock_qty numeric, cost_price numeric, retail_price numeric, supplier_id bigint, category_id bigint, default_location_id bigint, is_active boolean);
        CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, name text);
        CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, metadata jsonb, is_active boolean);
        INSERT INTO products VALUES (1, 't1', 'Widget', 'W-1', 0, 3, 33.375, 50, 5, NULL, NULL, true), (2, 't3', 'Widget', 'W-1', 0, 3, 33.375, 50, 6, NULL, NULL, true);
        INSERT INTO suppliers VALUES (5, 't1', 'Supplier A', '0100', NULL, true), (6, 't3', 'Supplier A', '0100', NULL, true);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new PurchasesReorderService(db as never, {} as never);
      const kwd = await service.getReorderSuggestions(KWD_AUTH, {});
      const egp = await service.getReorderSuggestions(EGP_AUTH, {});
      assert.equal(kwd.allSuggestions.length, 1);
      assert.equal(kwd.allSuggestions[0].suggestedQty, 3);
      assert.equal(kwd.allSuggestions[0].estimatedTotalCost, 100.125);
      assert.equal(kwd.allSuggestions[0].costPrice, 33.375);
      assert.equal(kwd.summary.totalEstimatedProcurementCost, 100.125);
      assert.equal(kwd.supplierGroups[0].totalEstimatedCost, 100.125);
      assert.equal(egp.allSuggestions[0].estimatedTotalCost, 100.13);
      assert.equal(egp.allSuggestions[0].costPrice, 33.38);
      assert.equal(egp.summary.totalEstimatedProcurementCost, 100.13);
      assert.equal(egp.supplierGroups[0].totalEstimatedCost, 100.13);
      console.log('phase P reorder live suggestions passed');
    } finally {
      await db.destroy();
    }
  }

  // Phase Q: contracting EVM, LIVE service path — getProjectEvmMetrics
  // cv/sv/eac/vac at book digits. AC (33.37) comes from the cost
  // breakdown, which still rounds its own total to 2dp (out of scope);
  // EV (100.125) is the raw billed total, so the variances still carry
  // a 3rd decimal on KWD.
  {
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE contracting_projects (id bigint PRIMARY KEY, tenant_id text, code text, name text, client_id bigint, client_name text, status text, contract_value numeric, revised_contract_value numeric, down_payment_amount numeric, down_payment_recovered numeric, retention_percent numeric, retention_total_held numeric, retention_released numeric, start_date text, expected_end_date text, actual_end_date text, site_location_id bigint, cost_center_id bigint, project_manager text, location_address text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
        CREATE TABLE contracting_invoices (id bigint PRIMARY KEY, tenant_id text, project_id bigint, ipc_type text, status text, current_amount numeric, stored_materials_amount numeric);
        CREATE TABLE contracting_change_orders (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, cost_impact numeric);
        CREATE TABLE contracting_subcontracts (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, total_amount numeric);
        CREATE TABLE contracting_cost_snapshots (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_budget_cost numeric, created_at timestamptz DEFAULT NOW());
        CREATE TABLE contracting_material_requisitions (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_cost numeric);
        CREATE TABLE contracting_labor_attendance_records (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_payable numeric);
        CREATE TABLE contracting_site_mobilization_expenses (id bigint PRIMARY KEY, tenant_id text, project_id bigint, amount numeric);
        CREATE TABLE contracting_petty_cash (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, spent_amount numeric);
        CREATE TABLE contracting_schedule_tasks (id bigint PRIMARY KEY, tenant_id text, project_id bigint, start_date text);
        INSERT INTO contracting_projects (id, tenant_id, code, name, status, contract_value, revised_contract_value, down_payment_amount, down_payment_recovered, retention_percent, retention_total_held, retention_released) VALUES (1, 't1', 'PRJ-1', 'Tower A', 'active', 1000, 1000, 0, 0, 5, 0, 0), (2, 't3', 'PRJ-2', 'Tower A', 'active', 1000, 1000, 0, 0, 5, 0, 0);
        INSERT INTO contracting_invoices VALUES (1, 't1', 1, 'client', 'approved', 100.125, 0), (2, 't3', 2, 'client', 'approved', 100.125, 0);
        INSERT INTO contracting_material_requisitions VALUES (1, 't1', 1, 33.374), (2, 't3', 2, 33.374);
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      const service = new ContractingService(db as never, {} as never);
      const kwd = await service.getProjectEvmMetrics(KWD_AUTH, '1') as any;
      const egp = await service.getProjectEvmMetrics(EGP_AUTH, '2') as any;
      assert.equal(kwd.earnedValue, 100.125);
      assert.equal(kwd.actualCost, 33.37);
      assert.equal(kwd.plannedValue, 500);
      assert.equal(kwd.budgetAtCompletion, 1000);
      assert.equal(kwd.costVariance, 66.755);
      assert.equal(kwd.scheduleVariance, -399.875);
      assert.equal(kwd.estimateAtCompletion, 333.333);
      assert.equal(kwd.varianceAtCompletion, 666.667);
      assert.equal(egp.earnedValue, 100.13);
      assert.equal(egp.actualCost, 33.37);
      assert.equal(egp.costVariance, 66.76);
      assert.equal(egp.scheduleVariance, -399.87);
      assert.equal(egp.estimateAtCompletion, 333.33);
      assert.equal(egp.varianceAtCompletion, 666.67);
      console.log('phase Q contracting EVM live passed');
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => console.log('d6c-misc-book-digits: all phases passed'),
  (err) => { console.error(err); process.exit(1); },
);
