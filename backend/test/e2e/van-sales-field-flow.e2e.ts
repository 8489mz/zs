import 'dotenv/config';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import type { Database } from '../../src/database/database.types';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../src/core/audit/audit.service';
import type { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

// Regression coverage for the van/field-sales flow (delivery reps who load stock from a warehouse
// and sell it door-to-door from a van). Before this test existed, the only guard for this module
// was test/critical/phase8-logistics.spec.ts, which reimplements the margin/settlement arithmetic
// inline and never calls VanSalesService against a database — so it could not catch (and did not
// catch) three separate showstoppers found only by actually running this flow against a real,
// constrained Postgres instance:
//   1. executeFieldSale wrote to a `sales.payment_method` column that does not exist (the real
//      column is `payment_type`) and to `sale_items.total_price` instead of `line_total` — every
//      field sale crashed outright.
//   2. getOrCreateVanLocation inserts `stock_locations.location_type = 'van_stock'`, a value the
//      `stock_locations_type_valid` CHECK constraint (migration 2028000000006) never allowed — a
//      rep's very first action (opening a trip) was rejected before the sale bug above was even
//      reachable.
//   3. Even patched, no journal entry was ever posted and the sale was stamped status='completed'
//      instead of 'posted' — invisible to every financial report and to the general ledger, which
//      filter on status='posted'.
//
// Unlike test/critical specs (pure logic, no DB, run before migrations in CI), this drives the real
// VanSalesService end to end against a live, migrated database and cleans up everything it wrote in
// a `finally` block scoped to one disposable tenant id, because the service opens its own top-level
// transactions per call (openTripAndLoad must commit before executeFieldSale can see the trip row),
// so the whole flow cannot be wrapped in one outer rolled-back transaction the way a single-call
// e2e test (e.g. dashboard-overview-aggregates.e2e.ts) can.

const TENANT = '__van_sales_verify_tmp__';
const ACCOUNT = 'e2e-van-sales';

async function cleanup(db: Kysely<Database>): Promise<void> {
  const dbAny = db as any;
  const tables = [
    'journal_entry_lines',
    'journal_entries',
    'accounting_posting_failures',
    'customer_ledger',
    'customer_payments',
    'sale_items',
    'sales',
    'van_sales_trips',
    'cashier_shifts',
    'treasury_transactions',
    'stock_movements',
    'product_location_stock',
    'customers',
    'products',
    'delivery_representatives',
    'stock_locations',
    'accounting_settings',
    'accounting_accounts',
    'users',
    'branches',
  ];
  for (const table of tables) {
    if (table === 'journal_entry_lines') {
      await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${TENANT})`.execute(db);
      continue;
    }
    await dbAny.deleteFrom(table).where('tenant_id', '=', TENANT).execute();
  }
}

async function main(): Promise<void> {
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    application_name: 'backend-e2e-van-sales',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const dbAny = db as any;

  await cleanup(db); // in case a previous failed run left rows behind

  try {
    // --- Fixtures --------------------------------------------------------------------------
    const branch = await dbAny
      .insertInto('branches')
      .values({ name: `Van Test Branch ${Date.now()}`, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const warehouse = await dbAny
      .insertInto('stock_locations')
      .values({ name: 'Main Warehouse', branch_id: branch.id, location_type: 'internal_warehouse', is_active: true, tenant_id: TENANT, account_id: ACCOUNT })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const user = await dbAny
      .insertInto('users')
      .values({ username: `van-e2e-${Date.now()}`, password_hash: 'x', password_salt: 'x', role: 'admin', is_active: true, tenant_id: TENANT, account_id: ACCOUNT })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const rep = await dbAny
      .insertInto('delivery_representatives')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, name: 'Test Rep', is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // applyStockDelta's non-negative guard checks products.stock_qty as the global ceiling even for
    // a skipGlobalUpdate location-to-location move (it just skips WRITING it) — so the fixture must
    // start with stock_qty already equal to the sum of its location balances, exactly the invariant
    // migration 115 (stock reconciliation) restored in production.
    const productA = await dbAny
      .insertInto('products')
      .values({ name: 'Van Product A', cost_price: 10, retail_price: 25, stock_qty: 100, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const productB = await dbAny
      .insertInto('products')
      .values({ name: 'Van Product B', cost_price: 4, retail_price: 9, stock_qty: 100, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await dbAny
      .insertInto('product_location_stock')
      .values([
        { product_id: productA.id, location_id: warehouse.id, branch_id: branch.id, qty: 100, tenant_id: TENANT, account_id: ACCOUNT },
        { product_id: productB.id, location_id: warehouse.id, branch_id: branch.id, qty: 100, tenant_id: TENANT, account_id: ACCOUNT },
      ])
      .execute();

    const customer = await dbAny
      .insertInto('customers')
      .values({ name: 'Field Shop Customer', customer_type: 'credit', credit_limit: 5000, is_active: true, tenant_id: TENANT, account_id: ACCOUNT })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // --- Services (constructed directly, no NestJS DI needed for plain classes) ------------
    const foundation = new AccountingTenantFoundationService();
    const accountingPosting = new AccountingPostingService(foundation);
    const vanSales = new VanSalesService(
      db,
      {} as AuditService,
      {} as DeliveryRepsService,
      accountingPosting,
    );
    const drawer = new CashDrawerService(db, new TransactionHelper(), accountingPosting);

    const repId = Number(rep.id);

    // --- 1. Open a trip: load 10xA + 20xB from the warehouse onto the van ------------------
    const loadResult = await vanSales.openTripAndLoad(repId, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      items: [
        { productId: Number(productA.id), qty: 10 },
        { productId: Number(productB.id), qty: 20 },
      ],
    });
    assert.equal(loadResult.ok, true);
    assert.equal(loadResult.totalLoadedValue, 10 * 25 + 20 * 9, 'loaded value priced at retail_price');

    const warehouseAfterLoad = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productA.id)
      .where('location_id', '=', warehouse.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(warehouseAfterLoad.qty), 90, 'warehouse stock decreases by the loaded qty');

    const productAAfterLoad = await db.selectFrom('products').select(['stock_qty']).where('id', '=', Number(productA.id)).executeTakeFirstOrThrow();
    assert.equal(Number(productAAfterLoad.stock_qty), 100, 'a van load is a location transfer: company-wide stock is untouched');

    // --- 2. Cash field sale: 3xA -----------------------------------------------------------
    const cashSale = await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      paymentMethod: 'cash',
      items: [{ productId: Number(productA.id), qty: 3 }],
    });
    assert.equal(cashSale.ok, true);
    assert.equal(cashSale.total, 75);
    assert.match(cashSale.docNo, /^VAN-\d{6}-0001$/, 'daily sequence must start at 0001');

    const cashSaleRow = await db
      .selectFrom('sales')
      .select(['status', 'payment_type', 'payment_channel', 'collection_status', 'paid_amount', 'total'])
      .where('id', '=', cashSale.saleId)
      .executeTakeFirstOrThrow();
    assert.equal(cashSaleRow.status, 'posted', 'must be posted, not the old bogus "completed", or it is invisible to every report');
    assert.equal(cashSaleRow.payment_type, 'cash');
    assert.equal(cashSaleRow.collection_status, 'prepaid_by_rep');
    assert.equal(Number(cashSaleRow.paid_amount), 0, 'cash sits with the rep, not the till, until settleTrip');

    const cashSaleItems = await db.selectFrom('sale_items').selectAll().where('sale_id', '=', cashSale.saleId).execute();
    assert.equal(cashSaleItems.length, 1);
    assert.equal(Number(cashSaleItems[0]!.line_total), 75);
    assert.equal(cashSaleItems[0]!.product_name, 'Van Product A');

    const productAAfterCashSale = await db.selectFrom('products').select(['stock_qty']).where('id', '=', Number(productA.id)).executeTakeFirstOrThrow();
    assert.equal(Number(productAAfterCashSale.stock_qty), 97, 'unlike a load, an actual sale DOES reduce company-wide stock (100 - 3 sold)');

    const cashSaleJournal = await db.selectFrom('journal_entries').selectAll().where('source_type', '=', 'sale').where('source_id', '=', cashSale.saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
    const cashSaleLines = await db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', cashSaleJournal.id).execute();
    const cashDebit = cashSaleLines.reduce((s, l) => s + Number(l.debit), 0);
    const cashCredit = cashSaleLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(cashDebit - cashCredit) < 0.01, 'journal must balance');
    assert.equal(cashDebit, 75 + 30, 'receivable (75) + COGS (3 units * cost_price 10 = 30)');
    const cashReceivableLine = cashSaleLines.find((l) => Number(l.debit) === 75);
    assert.equal(cashReceivableLine?.partner_type, 'none', 'an anonymous cash field sale books to the pooled rep-custody receivable, not a named customer');

    // Re-posting the same sale must be a no-op: exactly one journal entry, ever.
    const systemAuth: AuthContext = { userId: Number(user.id), sessionId: 'test', username: 'test', role: 'admin', permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT };
    const repost = await db.transaction().execute(trx => accountingPosting.postSale(trx, cashSale.saleId, systemAuth));
    assert.equal(repost.posted, false, 'idempotency guard must reject a duplicate posting');
    const journalCountForSale = await db.selectFrom('journal_entries').select((eb) => eb.fn.countAll<number>().as('c')).where('source_type', '=', 'sale').where('source_id', '=', cashSale.saleId).executeTakeFirstOrThrow();
    assert.equal(Number(journalCountForSale.c), 1);

    // --- 3. Credit field sale to a real customer: 2xB ---------------------------------------
    const creditSale = await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customer.id),
      paymentMethod: 'credit',
      items: [{ productId: Number(productB.id), qty: 2 }],
    });
    assert.equal(creditSale.total, 18);

    const customerAfterCreditSale = await db.selectFrom('customers').select(['balance']).where('id', '=', customer.id).executeTakeFirstOrThrow();
    assert.equal(Number(customerAfterCreditSale.balance), 18, "credit sale increases the customer's own debt");

    const creditSaleJournal = await db.selectFrom('journal_entries').selectAll().where('source_type', '=', 'sale').where('source_id', '=', creditSale.saleId).executeTakeFirstOrThrow();
    const creditSaleLines = await db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', creditSaleJournal.id).execute();
    const creditReceivableLine = creditSaleLines.find((l) => Number(l.debit) === 18);
    assert.equal(creditReceivableLine?.partner_type, 'customer');
    assert.equal(Number(creditReceivableLine?.partner_id), Number(customer.id), 'a credit sale is booked against the actual customer, unlike an anonymous cash sale');

    // --- 4. Field collection against that customer's existing debt (partial) ---------------
    const collection = await vanSales.recordFieldCollection(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customer.id),
      amount: 10,
    });
    assert.equal(collection.newBalance, 8, '18 owed minus 10 collected');

    const collectionJournal = await db.selectFrom('journal_entries').selectAll().where('source_type', '=', 'van_field_collection').where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
    const collectionLines = await db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', collectionJournal.id).execute();
    assert.equal(collectionLines.length, 2);
    const collDebit = collectionLines.reduce((s, l) => s + Number(l.debit), 0);
    const collCredit = collectionLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(collDebit - collCredit) < 0.01);
    const collCreditLine = collectionLines.find((l) => Number(l.credit) === 10);
    assert.equal(collCreditLine?.partner_type, 'customer', 'the collection reduces the SAME customer receivable the credit sale booked');
    assert.equal(Number(collCreditLine?.partner_id), Number(customer.id));

    // --- 5. Settle the trip with a deliberate cash shortage ---------------------------------
    // INV-E2E-VAN-SALES-OPEN-SHIFT: settleTrip remits the counted cash to the
    // receiving shift — insertRepCashRemittanceRow throws OPEN_SHIFT_REQUIRED
    // when no open shift exists on the trip's branch (the van location's
    // branch, here the fixture branch), so open that branch's shift first.
    const openedShift = await drawer.openCashierShift(
      { openingCash: 0, branchId: Number(branch.id), note: 'E2E van sales shift' },
      systemAuth,
    );
    assert.equal(openedShift.ok, true, 'branch shift must open before settleTrip');
    // Rep should be holding: 75 (cash sale) + 10 (field collection) = 85. Hands over only 80.
    const tripBeforeSettle = await dbAny.selectFrom('van_sales_trips').select(['cash_collected']).where('id', '=', loadResult.tripId).executeTakeFirstOrThrow();
    assert.equal(Number(tripBeforeSettle.cash_collected), 85);

    const settlement = await vanSales.settleTrip(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      countedCash: 80,
      countedStock: [
        { productId: Number(productA.id), countedQty: 7 },
        { productId: Number(productB.id), countedQty: 18 },
      ],
      unloadRemainingToWarehouse: true,
    });
    assert.equal(settlement.expectedCash, 85);
    assert.equal(settlement.variance, -5);
    // Loaded 10xA - sold 3xA = 7xA remaining; loaded 20xB - sold 2xB = 18xB remaining.
    assert.equal(settlement.unloadedItemsCount, 2);

    const warehouseAfterSettle = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productA.id)
      .where('location_id', '=', warehouse.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(warehouseAfterSettle.qty), 97, '90 after load-out + 7 unsold returned');

    const settlementJournal = await db.selectFrom('journal_entries').selectAll().where('source_type', '=', 'van_trip_settlement').where('source_id', '=', loadResult.tripId).executeTakeFirstOrThrow();
    const settlementLines = await db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', settlementJournal.id).execute();
    const setDebit = settlementLines.reduce((s, l) => s + Number(l.debit), 0);
    const setCredit = settlementLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(setDebit - setCredit) < 0.01, 'settlement journal must balance even with a shortage');
    assert.equal(settlementLines.find((l) => Number(l.credit) === 85)?.partner_type, 'none', 'clears the same pooled receivable the sale/collection debited');
    assert.equal(Number(settlementLines.find((l) => l.description.includes('عجز'))?.debit), 5, 'the 5 EGP shortage is booked, not silently absorbed into the cash line');
    assert.equal(Number(settlementLines.find((l) => l.description.includes('نقدية مسلَّمة'))?.debit), 80, 'only the cash actually counted reaches the real cash account');

    // --- 6. Whole-tenant sanity: every journal line this test created still nets to zero ---
    const allLines = await db.selectFrom('journal_entry_lines as jel').innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id').select(['jel.debit', 'jel.credit']).where('je.tenant_id', '=', TENANT).execute();
    const totalDebit = allLines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = allLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(totalDebit - totalCredit) < 0.01, `every journal entry this flow produced must balance in aggregate too (debit=${totalDebit}, credit=${totalCredit})`);

    process.stdout.write('van-sales-field-flow.e2e: all checks passed\n');
  } finally {
    await cleanup(db);
    await pool.end();
  }
}

main().catch((error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`van-sales-field-flow.e2e failed:\n${details}\n`);
  process.exit(1);
});
