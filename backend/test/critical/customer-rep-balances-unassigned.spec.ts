import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { getCustomerRepBalancesMap } from '../../src/modules/delivery-reps/services/van-common.util';
import { mapCustomerRow } from '../../src/modules/partners/helpers/partners-listing.helper';

/*
 * Customer rep-balances unassigned amount (INV-CUSTOMER-REP-BALANCES-UNASSIGNED).
 *
 * THE GAP: customer C-1054 owes 645.00 but the per-rep breakdown shows
 * only 570.00 (كابتن تست) — 75.00 is not attributed to any rep in the
 * visible breakdown, so the breakdown visibly fails to reconcile
 * (645 shown, 570 attributed, 75 invisible). The 75 IS real and
 * correctly unattributed: the engine computes
 * unassignedBalance = explicitTotal - totalRepBalance (645 - 570) —
 * a legacy opening balance that predates any rep assignment, so no
 * rep can own it. But mapCustomerRow drops the field: the customers
 * list passes only .repBalances into it, so the register card's
 * "مباشر/إدارة:" chip (which reads customer.unassignedBalance) never
 * renders, and the editor card's breakdown has no unassigned chip
 * at all.
 *
 * THE RULE: pass unassignedBalance through — partners.service passes
 * repBalancesMap.get(id)?.unassignedBalance into mapCustomerRow, the
 * row carries it, and the editor card renders the same
 * "مباشر/إدارة:" chip when it is > 0. No money changes: this only
 * makes the existing reconciliation visible.
 *
 * HARNESS: the real getCustomerRepBalancesMap + the real
 * mapCustomerRow on PGlite. The ledger seed mirrors C-1054: one rep
 * entry of 570 (sale by rep 7) and one legacy opening entry of 75
 * (no rep attribution), with the customer total at 645.
 *
 * WHAT THIS PINS:
 * - Case 1: the customers-list row carries unassignedBalance = 75,
 *   repBalances sums to 570, and 570 + 75 = 645 (reconciliation).
 * - Case 2: a customer with no legacy balance carries
 *   unassignedBalance = 0 (nothing invented).
 */

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigint PRIMARY KEY, tenant_id text, account_id text, status text, van_location_id bigint, source_warehouse_id bigint, rep_id bigint, cash_collected numeric, cash_refunds numeric, returns_amount numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, subtotal numeric, discount numeric, tax_amount numeric, total numeric, paid_amount numeric, store_credit_used numeric, exchange_return_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, delivery_fee numeric, delivery_fee_mode text, service_charge numeric, tip_amount numeric, prices_include_tax boolean, sale_origin text, payment_type text, collection_status text, status text, delivery_rep_id bigint, van_trip_id bigint);
    CREATE TABLE van_field_returns (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, type text, is_active boolean, van_location_id bigint, vehicle_plate text, require_gps_on_visit boolean, can_give_discount boolean, commission_rate numeric);
  `);
  return { pg, db };
}

function customerRow(id: number, balance: number): any {
  return {
    id,
    name: 'محل اختبار',
    phone: '01000000000',
    address: '',
    metadata: JSON.stringify({ customer_code: `C-${id}` }),
    customer_type: 'wholesale',
    balance,
    credit_limit: 5000,
    store_credit_balance: 0,
    company_name: '',
    tax_number: '',
    loyalty_points: 0,
  };
}

async function main(): Promise<void> {
  // Case 1: C-1054 — rep 570, legacy 75, total 645.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('delivery_representatives' as never).values({
        id: 7, tenant_id: 't1', account_id: 'a1', name: 'كابتن تست', phone: '01000000007',
        pin_hash: 'x', type: 'van', is_active: true, van_location_id: null, vehicle_plate: null,
        require_gps_on_visit: true, can_give_discount: false, commission_rate: 1,
      } as never).execute();
      await db.insertInto('sales' as never).values({
        id: 1, tenant_id: 't1', doc_no: 'S-1', customer_id: 1054, subtotal: 570,
        discount: 0, tax_amount: 0, total: 570, paid_amount: 0, store_credit_used: 0,
        exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
        delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
        sale_origin: 'van', payment_type: 'credit', collection_status: 'paid', status: 'posted',
        delivery_rep_id: 7, van_trip_id: null,
      } as never).execute();
      await db.insertInto('customer_ledger' as never).values([
        { customer_id: 1054, entry_type: 'sale', amount: 570, balance_after: 570, note: 'sale by rep 7', reference_type: 'sale', reference_id: 1, van_trip_id: null, tenant_id: 't1', account_id: 'a1', created_by: 1 },
        { customer_id: 1054, entry_type: 'opening_balance', amount: 75, balance_after: 645, note: 'legacy opening balance', reference_type: 'opening_balance', reference_id: null, van_trip_id: null, tenant_id: 't1', account_id: 'a1', created_by: 1 },
      ] as never).execute();

      const map = await getCustomerRepBalancesMap(db as any, 't1', {
        customerIds: [1054],
        customerTotalBalances: { 1054: 645 },
        moneyDigits: 2,
      });
      const breakdown = map.get(1054);
      assert.ok(breakdown, 'breakdown must exist for 1054');
      assert.equal(breakdown!.unassignedBalance, 75, 'engine: 645 - 570 = 75 unattributed');
      const repSum = breakdown!.repBalances.reduce((sum, r) => sum + Number(r.balance || 0), 0);
      assert.equal(repSum, 570, 'rep balances sum to 570');

      // Type-loose call on purpose: on unfixed code the 3rd parameter
      // does not exist, so a typed 3-arg call would fail compilation
      // instead of producing the behavioral RED below (row lacks the
      // field). The typed contract is proven by backend tsc on the
      // real call sites in partners.service.ts.
      const row = (mapCustomerRow as (...args: any[]) => any)(
        customerRow(1054, 645), breakdown!.repBalances, breakdown!.unassignedBalance,
      ) as any;
      assert.equal(row.unassignedBalance, 75, 'the customers-list row must carry unassignedBalance');
      assert.equal(Number(row.balance), 645);
      assert.equal(repSum + Number(row.unassignedBalance), 645, 'breakdown reconciles to the total');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: no legacy balance — unassigned is 0, nothing invented.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('delivery_representatives' as never).values({
        id: 7, tenant_id: 't1', account_id: 'a1', name: 'كابتن تست', phone: '01000000007',
        pin_hash: 'x', type: 'van', is_active: true, van_location_id: null, vehicle_plate: null,
        require_gps_on_visit: true, can_give_discount: false, commission_rate: 1,
      } as never).execute();
      await db.insertInto('sales' as never).values({
        id: 1, tenant_id: 't1', doc_no: 'S-1', customer_id: 1055, subtotal: 570,
        discount: 0, tax_amount: 0, total: 570, paid_amount: 0, store_credit_used: 0,
        exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
        delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
        sale_origin: 'van', payment_type: 'credit', collection_status: 'paid', status: 'posted',
        delivery_rep_id: 7, van_trip_id: null,
      } as never).execute();
      await db.insertInto('customer_ledger' as never).values([
        { customer_id: 1055, entry_type: 'sale', amount: 570, balance_after: 570, note: 'sale by rep 7', reference_type: 'sale', reference_id: 1, van_trip_id: null, tenant_id: 't1', account_id: 'a1', created_by: 1 },
      ] as never).execute();

      const map = await getCustomerRepBalancesMap(db as any, 't1', {
        customerIds: [1055],
        customerTotalBalances: { 1055: 570 },
        moneyDigits: 2,
      });
      const breakdown = map.get(1055);
      assert.ok(breakdown, 'breakdown must exist for 1055');
      assert.equal(breakdown!.unassignedBalance, 0, 'no legacy balance: unassigned is 0');
      const row = (mapCustomerRow as (...args: any[]) => any)(
        customerRow(1055, 570), breakdown!.repBalances, breakdown!.unassignedBalance,
      ) as any;
      assert.equal(row.unassignedBalance, 0, 'the row carries 0, not undefined');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: source + invariant pins.
  {
    const here = __dirname;
    const helperSource = readFileSync(resolve(here, '../../src/modules/partners/helpers/partners-listing.helper.ts'), 'utf8');
    assert.ok(helperSource.includes('unassignedBalance'), 'mapCustomerRow must carry unassignedBalance');
    const serviceSource = readFileSync(resolve(here, '../../src/modules/partners/partners.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('unassignedBalance'), 'partners.service must pass unassignedBalance into mapCustomerRow');
    const editorSource = readFileSync(resolve(here, '../../../frontend/src/features/customers/components/CustomerEditorCard.tsx'), 'utf8');
    assert.ok(editorSource.includes('unassignedBalance'), 'the editor card must render the unassigned chip');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CUSTOMER-REP-BALANCES-UNASSIGNED').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Customer rep-balances unassigned tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
