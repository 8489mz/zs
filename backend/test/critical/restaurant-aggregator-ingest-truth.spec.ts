/*
 * R-I7 (INV-REST-FNB-TRUTH-2): aggregator ingest must use the channel's
 * stored commission rate and pay out the delivery fee.
 *
 * On the unfixed tree ingestOrder lets the caller override the rate
 * (dto.commissionRate ?? stored rate), so commissionRate: 0 stores a
 * zero commission, and netPayout = subtotal - commission drops the
 * delivery fee the aggregator collected on the restaurant's behalf.
 * updateOrderStatus accepts any status string and returns success
 * even when the id does not exist.
 *
 * The fix, driven here against the real service over PGlite (one
 * shared database, db.destroy() teardown):
 * - the stored channel rate ALWAYS wins; a caller rate is accepted in
 *   the DTO (old callers must not 400) but ignored (debug-logged when
 *   it differs);
 * - netPayout = subtotal + deliveryFee - commission (commission base
 *   stays subtotal only);
 * - updateOrderStatus allows only the six real statuses (400 on
 *   nonsense) and 404s when the id does not exist.
 *
 * RED PROOF: on the unfixed tree the commissionRate: 0 case stores
 * commission 0 / net 1000 instead of 180 / 870, the caller-rate case
 * stores 5% instead of 18%, and both updateOrderStatus cases
 * succeed — see the base-run note at the end of the report.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { DeliveryAggregatorsService } from '../../src/modules/sales/services/delivery-aggregators.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 't1:main';

const DDL = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  CREATE TABLE pos_delivery_aggregators (id bigserial PRIMARY KEY, tenant_id text, account_id text,
    code text, name text, name_en text, commission_rate numeric(5, 2) DEFAULT 0,
    is_active boolean DEFAULT true, auto_accept_orders boolean DEFAULT true,
    price_markup_percentage numeric, price_markup_fixed numeric,
    api_key text, webhook_secret text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  CREATE TABLE pos_aggregator_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text,
    aggregator_id bigint, external_order_id text, display_number text, branch_id bigint,
    status text DEFAULT 'received', customer_name text, customer_phone text, delivery_address text,
    rider_name text, rider_phone text, subtotal numeric(14, 2) DEFAULT 0, delivery_fee numeric(14, 2) DEFAULT 0,
    aggregator_commission numeric(14, 2) DEFAULT 0, net_payout numeric(14, 2) DEFAULT 0,
    order_payload jsonb DEFAULT '{}', sale_id bigint, kds_ticket_id bigint,
    created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"EGP"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({
    tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1,
  }).execute();
  // Talabat Egypt: the channel's configured rate is 18%.
  await anyDb.insertInto('pos_delivery_aggregators').values({
    tenant_id: TENANT, account_id: ACCOUNT, code: 'talabat', name: 'Talabat',
    name_en: 'Talabat', commission_rate: 18, is_active: true, auto_accept_orders: true,
  }).execute();
  return { pg, db };
}

function buildService(db: Kysely<Database>): DeliveryAggregatorsService {
  return new DeliveryAggregatorsService(db);
}

const auth = { tenantId: TENANT, accountId: ACCOUNT, userId: 1, role: 'admin' } as unknown as AuthContext;

function ingestDto(externalOrderId: string, commissionRate?: number) {
  return {
    aggregatorCode: 'talabat',
    externalOrderId,
    subtotal: 1000,
    deliveryFee: 50,
    commissionRate,
    items: [{ name: 'Burger', qty: 1, unitPrice: 1000 }],
  };
}

async function storedOrder(db: Kysely<Database>, externalOrderId: string): Promise<any> {
  return (db as any).selectFrom('pos_aggregator_orders').selectAll()
    .where('external_order_id', '=', externalOrderId).executeTakeFirstOrThrow();
}

function statusOf(error: unknown): number | undefined {
  const err = error as any;
  if (typeof err?.getStatus === 'function') return err.getStatus();
  return err?.status ?? err?.statusCode;
}

async function main() {
  // One PGlite instance shared by all cases (a fresh instance per
  // case OOM-killed the VM when sibling agents ran alongside).
  const { pg, db } = await makeDb();
  const service = buildService(db);
  try {
  // 1. A caller rate of 0 must NOT zero the commission: the stored 18%
  // applies, and the delivery fee joins the payout.
  {
      const result = await service.ingestOrder(auth, ingestDto('EXT-1', 0));
      assert.equal(Number(result.commissionAmount), 180);
      assert.equal(Number(result.netPayout), 870);
      const row = await storedOrder(db, 'EXT-1');
      assert.equal(Number(row.aggregator_commission), 180);
      assert.equal(Number(row.net_payout), 870);
  }

  // 2. A different caller rate (5%) is likewise ignored.
  {
      const result = await service.ingestOrder(auth, ingestDto('EXT-2', 5));
      assert.equal(Number(result.commissionAmount), 180);
      assert.equal(Number(result.netPayout), 870);
      const row = await storedOrder(db, 'EXT-2');
      assert.equal(Number(row.aggregator_commission), 180);
      assert.equal(Number(row.net_payout), 870);
  }

  // 3. No caller rate at all: same stored-rate result (the honest path
  // already worked; it must not regress).
  {
      const result = await service.ingestOrder(auth, ingestDto('EXT-3'));
      assert.equal(Number(result.commissionAmount), 180);
      assert.equal(Number(result.netPayout), 870);
  }

  // 4. updateOrderStatus on a nonexistent id -> 404.
  {
      await assert.rejects(
        async () => service.updateOrderStatus(auth, 999999, 'delivered'),
        (err: unknown) => statusOf(err) === 404,
      );
  }

  // 5. updateOrderStatus with a nonsense status -> 400, and the row is
  // untouched; a real status then succeeds and lands on the row.
  {
      const created = await service.ingestOrder(auth, ingestDto('EXT-5'));
      await assert.rejects(
        async () => service.updateOrderStatus(auth, Number(created.orderId), 'teleported'),
        (err: unknown) => statusOf(err) === 400,
      );
      const untouched = await storedOrder(db, 'EXT-5');
      assert.notEqual(String(untouched.status), 'teleported');
      const ok = await service.updateOrderStatus(auth, Number(created.orderId), 'delivered');
      assert.equal(ok.success, true);
      const row = await storedOrder(db, 'EXT-5');
      assert.equal(String(row.status), 'delivered');
  }
  } finally { await db.destroy(); }

  console.log('Aggregator ingest truth tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
