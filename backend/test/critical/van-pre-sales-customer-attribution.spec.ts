import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanPreSalesService } from '../../src/modules/delivery-reps/services/van-pre-sales.service';

/*
 * Van pre-sales customer attribution (INV-VAN-PRE-SALES-CUSTOMER-ATTRIBUTION).
 *
 * THE GAP: createPreSalesOrder resolved the customer NAME only when
 * no customerId was given (the !customerId && customerName branch
 * looks the customer up by name). When the rep picked an existing
 * customer (customerId 3060, "محل اختبار جملة 1"), customerName kept
 * the default 'عميل تجزئة ميداني' and the order was stored under
 * that generic name — every read path (listPreSalesOrders,
 * getPreSalesOrderById) selects the denormalized so.customer_name,
 * so the order was attributed to nobody (live trial test10k
 * 2026-11-13, SO-261113-0010). The money path was safe (conversion
 * uses customer_id), but the supervisor could not tell whose order
 * it was.
 *
 * THE RULE: when customerId is provided, look the tenant-scoped
 * customer row up by id and store its name (and its phone/address
 * when the payload omits them). The generic default survives only
 * when no row is found. Prospective only.
 *
 * HARNESS: the real VanPreSalesService on PGlite. warehouseLocationId
 * is passed explicitly, so the warehouse resolution (and the branches
 * table) is skipped. All queries inside the order transaction use the
 * trx handle, so the PGlite single-connection hang does not apply.
 *
 * WHAT THIS PINS, driving the REAL createPreSalesOrder +
 * listPreSalesOrders:
 * - Case 1: createPreSalesOrder with customerId 3060 and no
 *   customerName -> stored customer_name 'محل اختبار جملة 1',
 *   customer_id 3060, phone/address filled from the row.
 * - Case 2: listPreSalesOrders for that customer returns
 *   customerName 'محل اختبار جملة 1'.
 * - Case 3 (no regression): no customerId + customerName 'عميل
 *   جديد' still creates/resolves the customer by name.
 */

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, is_active boolean, balance numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, cost_price numeric, retail_price numeric, wholesale_price numeric, credit_price numeric, consumer_price numeric, stock_qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date date, end_date date, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, is_active boolean);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, location_type text, is_active boolean);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, full_name text);
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, branch_id bigint, warehouse_location_id bigint, rep_id bigint, order_source text, payment_terms text, subtotal numeric, discount_amount numeric, tax_amount numeric, total_amount numeric, status text, supervisor_approved_at timestamptz, supervisor_approved_by bigint, supervisor_rejection_reason text, notes text, delivery_date timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sales_order_id bigint, product_id bigint, product_name text, unit_name text, unit_multiplier numeric, quantity numeric, reserved_quantity numeric, delivered_quantity numeric, unit_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, discount numeric, total numeric, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

async function seedWorld(db: Kysely<Database>): Promise<void> {
  await seedCurrency(db, 'EGP');
  await db.insertInto('stock_locations' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', name: 'المستودع الرئيسي', branch_id: null, location_type: 'internal_warehouse', is_active: true,
  } as never).execute();
  await db.insertInto('customers' as never).values({
    id: 3060, tenant_id: 't1', account_id: 'a1', name: 'محل اختبار جملة 1', phone: '01122220001', address: 'مدينة نصر', is_active: true, balance: 18,
  } as never).execute();
  await db.insertInto('products' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', name: 'صنف اختبار جملة أ', cost_price: 8, retail_price: 12, wholesale_price: 10, credit_price: 11, consumer_price: 15, stock_qty: 120, reserved_qty: 0,
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values([
    { tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: null, location_id: 1, qty: 120, reserved_qty: 0 },
    { tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: null, location_id: null, qty: 0, reserved_qty: 0 },
  ] as never).execute();
}

async function orderRow(db: Kysely<Database>, orderId: number): Promise<any> {
  const rows = await (db as any).selectFrom('sales_orders')
    .select(['customer_id as customerId', 'customer_name as customerName', 'customer_phone as customerPhone', 'customer_address as customerAddress', 'status'])
    .where('id', '=', orderId).where('tenant_id', '=', 't1').execute() as any[];
  assert.equal(rows.length, 1, `expected exactly one order ${orderId}`);
  return rows[0];
}

async function main(): Promise<void> {
  // Case 1: customerId given, no customerName -> the stored name
  // (and phone/address) come from the customer row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      const created = await service.createPreSalesOrder(38, 't1', 'a1', {
        customerId: 3060,
        paymentMethod: 'cash',
        warehouseLocationId: 1,
        items: [{ productId: 1, qty: 3 }],
      });
      assert.equal(created.ok, true, 'order created');
      const row = await orderRow(db, created.orderId);
      assert.equal(Number(row.customerId), 3060, 'customer_id stored');
      assert.equal(row.customerName, 'محل اختبار جملة 1', 'customer_name resolved from the customer row, not the generic default');
      assert.equal(row.customerPhone, '01122220001', 'phone filled from the customer row');
      assert.equal(row.customerAddress, 'مدينة نصر', 'address filled from the customer row');
      console.log('case 1 passed: customerId 3060 -> name/phone/address from the row');
    } finally {
      await pg.close();
    }
  }

  // Case 2: the list read path returns the resolved name.
  {
    const { pg, db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      const created = await service.createPreSalesOrder(38, 't1', 'a1', {
        customerId: 3060,
        paymentMethod: 'cash',
        warehouseLocationId: 1,
        items: [{ productId: 1, qty: 3 }],
      });
      const listed = await service.listPreSalesOrders('t1', { customerId: 3060 });
      const rows = (listed as any).orders ?? (listed as any).items ?? listed;
      assert.equal(rows.length, 1, 'one order listed for the customer');
      assert.equal(rows[0].customerName, 'محل اختبار جملة 1', 'list shows the resolved customer name');
      assert.equal(rows[0].orderNumber, created.orderNumber, 'listed order is the created one');
      console.log('case 2 passed: list returns the resolved name');
    } finally {
      await pg.close();
    }
  }

  // Case 3 (no regression): no customerId + a name still creates /
  // resolves the customer by name, as before.
  {
    const { pg, db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      const created = await service.createPreSalesOrder(38, 't1', 'a1', {
        customerName: 'عميل جديد',
        customerPhone: '01000000000',
        paymentMethod: 'cash',
        warehouseLocationId: 1,
        items: [{ productId: 1, qty: 2 }],
      });
      assert.equal(created.ok, true, 'order created');
      const row = await orderRow(db, created.orderId);
      assert.equal(row.customerName, 'عميل جديد', 'name-path attribution unchanged');
      assert.ok(Number(row.customerId) > 0, 'a customer row was created for the new name');
      console.log('case 3 passed: name path still creates/resolves by name');
    } finally {
      await pg.close();
    }
  }

  console.log('van-pre-sales-customer-attribution checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
