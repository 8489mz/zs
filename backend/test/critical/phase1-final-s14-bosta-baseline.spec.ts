import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { BostaService } from '../../src/modules/bosta/bosta.service';

/*
 * Phase 1 final-inspection slice 14 — baseline spec for the bosta
 * module (one of the 5 modules still unverified on 56bb6d4).
 *
 * GROUNDING (live code, read before writing):
 * - BostaService (bosta/bosta.service.ts) is Kysely-DB-backed
 *   (settings + online_orders; columns mirrored from migrations
 *   2040000000020 / 0032 / 0033 / 0038). getSettings/saveSettings
 *   round-trip the bosta_* settings keys; getSettings masks the
 *   stored API key as '••••••••'. createDelivery loads the order,
 *   rejects a cancelled order, derives COD (explicit dto.cod, else
 *   0 when paid online, else the order total), then either calls
 *   the real Bosta production API (global fetch, only when an API
 *   key is stored AND the key does not contain 'test' AND the
 *   environment is production) or takes the sandbox path (mock
 *   delivery id bst_mock_* + tracking 24NNNNNNN). The created
 *   shipment is written back onto the online_orders row (status
 *   'shipped'). getTracking returns SANDBOX_CREATED without a live
 *   call in sandbox mode. cancelDelivery updates the order back to
 *   'confirmed' + bosta_status 'Cancelled'. getAwbUrl returns the
 *   stored AWB URL and rejects an untrusted URL.
 * - The carrier HTTP is stubbed in-spec (globalThis.fetch replaced;
 *   the stub records every call and returns a canned Bosta payload).
 *   No live carrier call is ever made. The stub proves the
 *   service's request mapping (URL, auth header, COD, receiver)
 *   and the DB writes — not the carrier's API.
 * - The p0a-commerce-shipping-rbac spec (wired here as shared
 *   primary with gcc-shipping) proves the permission boundary
 *   (canManageShippingConfig / canOperateShipping reject before any
 *   DB query or HTTP call); this spec proves the happy paths and
 *   the validation errors with a permitted actor.
 *
 * WHAT THIS PROVES (real service on PGlite, fetch stubbed only):
 * - Settings round-trip + key masking + raw key stored.
 * - Sandbox delivery: mock ids, order shipped, COD defaults.
 * - Production delivery: stubbed fetch called with the right URL,
 *   auth header and COD (explicit 75, default 300 on an unpaid
 *   order, 0 on a paid order); live ids written back.
 * - Production fetch failure -> BadRequest; missing order ->
 *   NotFound; cancelled order -> BadRequest.
 * - Tracking sandbox state, AWB URL read, cancel back to
 *   confirmed, Forbidden for an actor without permissions.
 */

const TENANT = 'merchant-a';
const ACCOUNT = 'merchant-a:main';

const ACTOR = {
  userId: 9,
  role: 'admin',
  tenantId: TENANT,
  accountId: ACCOUNT,
  permissions: ['deliveryReps', 'canManageSettings'],
} as unknown as AuthContext;

const NO_PERM_ACTOR = {
  userId: 10,
  role: 'cashier',
  tenantId: TENANT,
  accountId: ACCOUNT,
  permissions: [],
} as unknown as AuthContext;

async function seedOrder(
  db: Kysely<Database>,
  id: number,
  orderNumber: string,
  total: number,
  paymentStatus: string,
  status: string,
): Promise<void> {
  await (db as any)
    .insertInto('online_orders')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      order_number: orderNumber,
      customer_name: 'أحمد محمد',
      customer_phone: '01011112222',
      customer_address: 'شارع التحرير 5',
      customer_notes: 'اتصل قبل الوصول',
      items_json: '[]',
      subtotal: total,
      delivery_fee: 0,
      total_amount: total,
      status,
      payment_method: 'cod',
      payment_status: paymentStatus,
      delivery_zone_name: 'Cairo',
    })
    .execute();
}

async function readOrder(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any)
    .selectFrom('online_orders')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('id', '=', id)
    .executeTakeFirst();
}

interface FetchCall {
  url: string;
  init: any;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const realFetch = globalThis.fetch;
  try {
    await pg.exec(`
      CREATE TABLE settings (
        key text NOT NULL,
        value text,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
      CREATE TABLE online_orders (
        id serial PRIMARY KEY,
        tenant_id varchar(128) NOT NULL,
        account_id varchar(160) NOT NULL,
        order_number varchar(64) NOT NULL,
        customer_name varchar(255) NOT NULL,
        customer_phone varchar(64) NOT NULL,
        customer_address text,
        customer_notes text,
        items_json text DEFAULT '[]' NOT NULL,
        subtotal numeric(15,2) DEFAULT 0 NOT NULL,
        delivery_fee numeric(15,2) DEFAULT 0 NOT NULL,
        total_amount numeric(15,2) DEFAULT 0 NOT NULL,
        status varchar(32) DEFAULT 'pending' NOT NULL,
        payment_method varchar(64) DEFAULT 'cod' NOT NULL,
        payment_status varchar(32) DEFAULT 'pending',
        delivery_zone_name varchar(255),
        branch_id integer,
        sale_id integer,
        shipping_carrier varchar(32) DEFAULT 'internal',
        bosta_delivery_id varchar(128),
        bosta_tracking_number varchar(128),
        bosta_status varchar(64),
        bosta_awb_url text,
        bosta_created_at timestamptz,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL
      );
    `);

    await seedOrder(db, 1, 'ORD-1001', 250, 'pending', 'confirmed');
    await seedOrder(db, 2, 'ORD-1002', 400, 'paid', 'confirmed');
    await seedOrder(db, 3, 'ORD-1003', 100, 'pending', 'cancelled');
    await seedOrder(db, 4, 'ORD-1004', 120, 'pending', 'confirmed');
    await seedOrder(db, 5, 'ORD-1005', 300, 'pending', 'confirmed');
    await seedOrder(db, 6, 'ORD-1006', 400, 'paid', 'confirmed');
    await seedOrder(db, 7, 'ORD-1007', 50, 'pending', 'confirmed');

    const service = new BostaService(db);

    // 1) Settings round-trip + key masking.
    {
      const saved = await service.saveSettings(
        {
          enabled: true,
          environment: 'sandbox',
          apiKey: 'test-key-123',
          pickupBusinessName: 'متجر النور',
          pickupPhone: '01000000000',
          pickupCity: 'Giza',
          pickupAddress: 'شارع فيصل 10',
        },
        ACTOR,
      );
      assert.equal(saved.ok, true, 'saveSettings must answer ok');
      const settings = await service.getSettings(ACTOR);
      assert.equal(settings.enabled, true, 'settings must keep enabled true');
      assert.equal(settings.environment, 'sandbox', 'settings must keep sandbox');
      assert.equal(settings.apiKey, '••••••••', 'getSettings must mask the stored key');
      assert.equal(settings.pickupBusinessName, 'متجر النور', 'pickup business name must round-trip');
      assert.equal(settings.pickupCity, 'Giza', 'pickup city must round-trip');
      const raw = await (db as any)
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', TENANT)
        .where('key', '=', 'bosta_api_key')
        .executeTakeFirst();
      assert.equal(raw.value, '"test-key-123"', 'the raw key must be stored JSON-encoded');
      console.log('  settings round-trip passed');
    }

    // 2) Sandbox delivery on an unpaid order: mock ids, order shipped.
    {
      const res = await service.createDelivery(1, {}, ACTOR);
      assert.equal(res.ok, true, 'sandbox delivery must answer ok');
      assert.equal(res.isSandbox, true, 'sandbox delivery must report sandbox');
      assert.ok(res.deliveryId.startsWith('bst_mock_'), 'sandbox delivery id must be a mock id');
      assert.match(res.trackingNumber, /^24\d{7}$/, 'sandbox tracking must be 24 + 7 digits');
      assert.equal(res.status, 'Created', 'sandbox delivery status must be Created');
      assert.ok(res.message?.includes('تجريبية'), 'sandbox message must say it is a trial shipment');
      const row = await readOrder(db, 1);
      assert.equal(row.status, 'shipped', 'the order must move to shipped');
      assert.equal(row.shipping_carrier, 'bosta', 'the order carrier must be bosta');
      assert.equal(row.bosta_delivery_id, res.deliveryId, 'the delivery id must be written back');
      assert.equal(row.bosta_tracking_number, res.trackingNumber, 'the tracking number must be written back');
      assert.equal(row.bosta_status, 'Created', 'the bosta status must be written back');
      console.log('  sandbox delivery passed');
    }

    // 3) Sandbox delivery on a paid order with an explicit COD.
    {
      const res = await service.createDelivery(2, { cod: 50 }, ACTOR);
      assert.equal(res.ok, true, 'paid-order sandbox delivery must answer ok');
      assert.equal(res.isSandbox, true, 'paid-order delivery must still be sandbox');
      const row = await readOrder(db, 2);
      assert.equal(row.status, 'shipped', 'the paid order must move to shipped');
      console.log('  paid-order sandbox delivery passed');
    }

    // 4) Missing order -> NotFound; cancelled order -> BadRequest.
    {
      await assert.rejects(
        () => service.createDelivery(999, {}, ACTOR),
        NotFoundException,
        'a missing order must reject NotFound',
      );
      await assert.rejects(
        () => service.createDelivery(3, {}, ACTOR),
        BadRequestException,
        'a cancelled order must reject BadRequest',
      );
      console.log('  missing/cancelled order errors passed');
    }

    // 5) Production delivery with a stubbed fetch: request mapping + COD.
    const calls: FetchCall[] = [];
    const installFetch = (responder: (url: string, init: any) => any): void => {
      calls.length = 0;
      (globalThis as any).fetch = async (url: string, init: any) => {
        calls.push({ url, init });
        return responder(url, init);
      };
    };
    const okResponder = () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: { _id: 'bst_live_001', trackingNumber: '241234567', status: { value: 'Created' } },
      }),
    });
    {
      await service.saveSettings({ environment: 'production', apiKey: 'live-key-abc' }, ACTOR);
      installFetch(okResponder);
      const res = await service.createDelivery(4, { cod: 75, receiverCity: 'Alexandria', notes: 'fragile' }, ACTOR);
      assert.equal(res.ok, true, 'production delivery must answer ok');
      assert.equal(res.isSandbox, false, 'production delivery must not report sandbox');
      assert.equal(res.deliveryId, 'bst_live_001', 'production delivery id must come from the carrier payload');
      assert.equal(res.trackingNumber, '241234567', 'production tracking must come from the carrier payload');
      assert.equal(res.awbUrl, 'https://app.bosta.co/api/v1/deliveries/awb/bst_live_001', 'AWB URL must be built');
      assert.equal(calls.length, 1, 'exactly one carrier call must be made');
      assert.equal(calls[0].url, 'https://app.bosta.co/api/v1/deliveries', 'the carrier URL must be Bosta deliveries');
      assert.equal(calls[0].init.method, 'POST', 'the carrier call must be a POST');
      assert.equal(calls[0].init.headers.Authorization, 'live-key-abc', 'the raw key must be the auth header');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.type, 10, 'the Bosta type must be Deliver & Collect Cash');
      assert.equal(body.cod, 75, 'the explicit COD must be sent');
      assert.equal(body.receiver.phone, '01011112222', 'the receiver phone must come from the order');
      assert.equal(body.dropOffAddress.city, 'Alexandria', 'the DTO city must override the order zone');
      assert.equal(body.notes, 'fragile', 'the DTO notes must be sent');
      const row = await readOrder(db, 4);
      assert.equal(row.status, 'shipped', 'the production order must move to shipped');
      assert.equal(row.bosta_delivery_id, 'bst_live_001', 'the live delivery id must be written back');
      assert.equal(row.bosta_tracking_number, '241234567', 'the live tracking number must be written back');
      console.log('  production delivery passed');
    }

    // 6) COD derivation on the production path: unpaid total, paid zero.
    {
      installFetch(okResponder);
      await service.createDelivery(5, {}, ACTOR);
      assert.equal(JSON.parse(calls[0].init.body).cod, 300, 'an unpaid order must send its total as COD');
      installFetch(okResponder);
      await service.createDelivery(6, {}, ACTOR);
      assert.equal(JSON.parse(calls[0].init.body).cod, 0, 'a paid-online order must send COD 0');
      console.log('  COD derivation passed');
    }

    // 7) Production fetch failure -> BadRequest.
    {
      installFetch(() => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'carrier down' }),
      }));
      await assert.rejects(
        () => service.createDelivery(7, {}, ACTOR),
        BadRequestException,
        'a carrier failure must reject BadRequest',
      );
      const row = await readOrder(db, 7);
      assert.equal(row.status, 'confirmed', 'a failed delivery must not ship the order');
      console.log('  carrier failure passed');
    }

    // 8) AWB URL read + cancel back to confirmed.
    {
      installFetch(okResponder);
      const awb = await service.getAwbUrl('bst_live_001', ACTOR);
      assert.equal(
        awb.url,
        'https://app.bosta.co/api/v1/deliveries/awb/bst_live_001',
        'the AWB URL must be the stored one',
      );
      assert.equal(awb.isSandbox, false, 'the live AWB must not report sandbox');
      assert.equal(awb.trackingNumber, '241234567', 'the AWB tracking must be the stored one');
      await assert.rejects(
        () => service.getAwbUrl('bst_unknown', ACTOR),
        NotFoundException,
        'an unknown delivery must reject NotFound on AWB read',
      );
      const cancelled = await service.cancelDelivery('bst_live_001', ACTOR);
      assert.equal(cancelled.ok, true, 'cancel must answer ok');
      const row = await readOrder(db, 4);
      assert.equal(row.status, 'confirmed', 'cancel must move the order back to confirmed');
      assert.equal(row.bosta_status, 'Cancelled', 'cancel must mark the bosta status Cancelled');
      console.log('  AWB + cancel passed');
    }

    // 9) Tracking in sandbox mode: simulated state, no live call.
    {
      await service.saveSettings({ environment: 'sandbox' }, ACTOR);
      installFetch(() => {
        throw new Error('no carrier call may happen in sandbox tracking');
      });
      const track = await service.getTracking('241234567', ACTOR);
      assert.equal(track.ok, true, 'sandbox tracking must answer ok');
      assert.equal(track.currentStatus, 'SANDBOX_CREATED', 'sandbox tracking must report the simulated state');
      assert.equal(track.history[0].state, 'SANDBOX_CREATED', 'sandbox history must state the simulation');
      assert.equal(calls.length, 0, 'sandbox tracking must not call the carrier');
      console.log('  sandbox tracking passed');
    }

    // 10) An actor without permissions is forbidden before any DB write.
    {
      await assert.rejects(
        () => service.createDelivery(1, {}, NO_PERM_ACTOR),
        ForbiddenException,
        'an actor without deliveryReps must be forbidden',
      );
      console.log('  permission guard passed');
    }
  } finally {
    (globalThis as any).fetch = realFetch;
    await db.destroy();
  }
  console.log('phase1 final slice 14 bosta baseline passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
