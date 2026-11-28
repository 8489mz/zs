import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { GccShippingService } from '../../src/modules/gcc-shipping/gcc-shipping.service';

/*
 * Phase 1 final-inspection slice 14 — baseline spec for the
 * gcc-shipping module (one of the 5 modules still unverified on
 * 56bb6d4).
 *
 * GROUNDING (live code, read before writing):
 * - GccShippingService (gcc-shipping/gcc-shipping.service.ts) is
 *   Kysely-DB-backed (settings + online_orders; columns mirrored
 *   from migrations 2040000000020 / 0032 / 0033 / 0039).
 *   getSettings/saveSettings round-trip the gcc_shipping_* keys;
 *   getSettings masks stored secrets as '••••••••'. createShipment
 *   loads the order, rejects a cancelled order, derives COD
 *   (explicit dto.codAmount, else 0 when paid online, else the
 *   order total) and the currency (DTO, else the SMSA customs
 *   currency, else SAR), then either calls the real carrier API
 *   (global fetch: Aramex JSON endpoint, or the SMSA form endpoint
 *   returning XML) or takes the sandbox path (mock tracking
 *   ARM-SA-NNNNNNNN / SMSA-NNNNNNNN). A missing Aramex credential
 *   or SMSA passkey rejects BadRequest BEFORE any HTTP call. The
 *   shipment is written back onto the online_orders row (status
 *   'shipped'). getTracking builds a 3-event local history from
 *   the stored row (no live call). getAwbPrintData reads the stored
 *   row and derives COD from the payment status.
 * - The carrier HTTP is stubbed in-spec (globalThis.fetch replaced;
 *   the stub records every call and returns a canned Aramex JSON
 *   payload or a canned SMSA XML payload). No live carrier call is
 *   ever made. The stub proves the service's request mapping (URL,
 *   credentials, COD, receiver) and the DB writes — not the
 *   carrier's API.
 * - The p0a-commerce-shipping-rbac spec (wired here as shared
 *   primary with bosta) proves the permission boundary
 *   (canManageShippingConfig / canOperateShipping reject before any
 *   DB query or HTTP call); this spec proves the happy paths and
 *   the validation errors with a permitted actor.
 *
 * WHAT THIS PROVES (real service on PGlite, fetch stubbed only):
 * - Settings round-trip + secret masking.
 * - Sandbox shipments for both carriers: mock tracking, order
 *   shipped with the carrier recorded.
 * - Production Aramex: stubbed fetch called with the right URL and
 *   credentials, COD 320 on an unpaid order, live ids written back.
 * - Production Aramex with missing credentials -> BadRequest
 *   before any HTTP call.
 * - Production SMSA: stubbed fetch called with the right URL and
 *   passkey, COD 0 on a paid order, live tracking written back;
 *   a 'Failed:' XML answer -> BadRequest.
 * - Missing order -> NotFound; cancelled order -> BadRequest.
 * - Tracking history, AWB print data, Forbidden for an actor
 *   without permissions.
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
  zone: string,
): Promise<void> {
  await (db as any)
    .insertInto('online_orders')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      order_number: orderNumber,
      customer_name: 'سارة علي',
      customer_phone: '05022223333',
      customer_address: 'حي النرجس 12',
      customer_notes: '',
      items_json: '[]',
      subtotal: total,
      delivery_fee: 0,
      total_amount: total,
      status,
      payment_method: 'cod',
      payment_status: paymentStatus,
      delivery_zone_name: zone,
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
        gcc_shipping_carrier varchar(32),
        gcc_shipping_id varchar(128),
        gcc_tracking_number varchar(128),
        gcc_shipping_status varchar(64),
        gcc_awb_url text,
        gcc_shipping_created_at timestamptz,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL
      );
    `);

    await seedOrder(db, 1, 'ORD-2001', 250, 'pending', 'confirmed', 'الرياض');
    await seedOrder(db, 2, 'ORD-2002', 180, 'pending', 'confirmed', 'جدة');
    await seedOrder(db, 3, 'ORD-2003', 100, 'pending', 'cancelled', 'الرياض');
    await seedOrder(db, 4, 'ORD-2004', 320, 'pending', 'confirmed', 'جدة');
    await seedOrder(db, 5, 'ORD-2005', 500, 'paid', 'confirmed', 'الدمام');
    await seedOrder(db, 6, 'ORD-2006', 90, 'pending', 'confirmed', 'الرياض');
    await seedOrder(db, 7, 'ORD-2007', 60, 'pending', 'confirmed', 'الرياض');

    const service = new GccShippingService(db);

    // 1) Settings round-trip + secret masking.
    {
      const saved = await service.saveSettings(
        {
          enabled: true,
          activeCarrier: 'aramex',
          environment: 'sandbox',
          aramexAccountNumber: '20012345',
          aramexAccountPin: '1234',
          aramexAccountEntity: 'RUH',
          aramexCountryCode: 'SA',
          aramexUserName: 'aramex-user',
          aramexPassword: 'aramex-pass',
          smsaPassKey: 'smsa-key-1',
          smsaCustomsCurrency: 'SAR',
          pickupBusinessName: 'مستودع الرياض',
          pickupContactPerson: 'خالد',
          pickupPhone: '0501111222',
          pickupCountry: 'المملكة العربية السعودية',
          pickupCity: 'الرياض',
          pickupAddress: 'حي العليا',
        },
        ACTOR,
      );
      assert.equal(saved.ok, true, 'saveSettings must answer ok');
      const settings = await service.getSettings(ACTOR);
      assert.equal(settings.enabled, true, 'settings must keep enabled true');
      assert.equal(settings.activeCarrier, 'aramex', 'settings must keep the active carrier');
      assert.equal(settings.environment, 'sandbox', 'settings must keep sandbox');
      assert.equal(settings.aramexAccountNumber, '20012345', 'aramex account number must round-trip');
      assert.equal(settings.aramexAccountPin, '••••••••', 'aramex pin must be masked');
      assert.equal(settings.aramexPassword, '••••••••', 'aramex password must be masked');
      assert.equal(settings.smsaPassKey, '••••••••', 'smsa passkey must be masked');
      assert.equal(settings.pickupCity, 'الرياض', 'pickup city must round-trip');
      console.log('  settings round-trip passed');
    }

    const calls: FetchCall[] = [];
    const installFetch = (responder: (url: string, init: any) => any): void => {
      calls.length = 0;
      (globalThis as any).fetch = async (url: string, init: any) => {
        calls.push({ url, init });
        return responder(url, init);
      };
    };

    // 2) Sandbox shipments for both carriers: mock tracking, order shipped.
    {
      installFetch(() => {
        throw new Error('no carrier call may happen in sandbox mode');
      });
      const arm = await service.createShipment(1, { carrier: 'aramex' }, ACTOR);
      assert.equal(arm.ok, true, 'aramex sandbox shipment must answer ok');
      assert.equal(arm.carrier, 'aramex', 'aramex sandbox shipment must report aramex');
      assert.equal(arm.isSandbox, true, 'aramex sandbox shipment must report sandbox');
      assert.match(arm.trackingNumber, /^ARM-SA-\d{8}$/, 'aramex sandbox tracking must match ARM-SA-NNNNNNNN');
      assert.ok(arm.shipmentId.startsWith('arm_'), 'aramex sandbox shipment id must be a mock id');
      const row1 = await readOrder(db, 1);
      assert.equal(row1.status, 'shipped', 'the aramex order must move to shipped');
      assert.equal(row1.gcc_shipping_carrier, 'aramex', 'the aramex carrier must be written back');
      assert.equal(row1.gcc_tracking_number, arm.trackingNumber, 'the aramex tracking must be written back');
      assert.equal(row1.shipping_carrier, 'aramex', 'the shipping carrier must be written back');

      const smsa = await service.createShipment(2, { carrier: 'smsa' }, ACTOR);
      assert.equal(smsa.ok, true, 'smsa sandbox shipment must answer ok');
      assert.equal(smsa.carrier, 'smsa', 'smsa sandbox shipment must report smsa');
      assert.match(smsa.trackingNumber, /^SMSA-\d{8}$/, 'smsa sandbox tracking must match SMSA-NNNNNNNN');
      assert.ok(smsa.shipmentId.startsWith('smsa_'), 'smsa sandbox shipment id must be a mock id');
      const row2 = await readOrder(db, 2);
      assert.equal(row2.status, 'shipped', 'the smsa order must move to shipped');
      assert.equal(row2.gcc_shipping_carrier, 'smsa', 'the smsa carrier must be written back');
      assert.equal(calls.length, 0, 'sandbox shipments must not call any carrier');
      console.log('  sandbox shipments passed');
    }

    // 3) Missing order -> NotFound; cancelled order -> BadRequest.
    {
      await assert.rejects(
        () => service.createShipment(999, {}, ACTOR),
        NotFoundException,
        'a missing order must reject NotFound',
      );
      await assert.rejects(
        () => service.createShipment(3, {}, ACTOR),
        BadRequestException,
        'a cancelled order must reject BadRequest',
      );
      console.log('  missing/cancelled order errors passed');
    }

    // 4) Production Aramex with a stubbed fetch: request mapping + COD.
    {
      await service.saveSettings({ environment: 'production' }, ACTOR);
      installFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ Shipments: [{ ID: 'ARM-987654321', HasErrors: false }] }),
      }));
      const res = await service.createShipment(4, { carrier: 'aramex', weight: 2.5, piecesCount: 2 }, ACTOR);
      assert.equal(res.ok, true, 'production aramex shipment must answer ok');
      assert.equal(res.isSandbox, false, 'production aramex shipment must not report sandbox');
      assert.equal(res.shipmentId, 'ARM-987654321', 'aramex shipment id must come from the carrier payload');
      assert.equal(res.trackingNumber, 'ARM-987654321', 'aramex tracking must come from the carrier payload');
      assert.equal(res.codAmount, 320, 'an unpaid order must carry its total as COD');
      assert.equal(res.currency, 'SAR', 'the currency must default to SAR');
      assert.equal(
        res.awbUrl,
        'https://www.aramex.com/us/en/track/shipments?ShipmentNumber=ARM-987654321',
        'the aramex AWB URL must be built',
      );
      assert.equal(calls.length, 1, 'exactly one carrier call must be made');
      assert.equal(
        calls[0].url,
        'https://ws.aramex.net/ShippingAPI.V2/Shipping/Service_1_0.svc/json/CreateShipments',
        'the carrier URL must be the Aramex endpoint',
      );
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.ClientInfo.UserName, 'aramex-user', 'the aramex username must be sent');
      assert.equal(body.ClientInfo.AccountNumber, '20012345', 'the aramex account number must be sent');
      assert.equal(body.Shipments[0].Reference1, 'ORD-4', 'the shipment reference must be the order id');
      assert.equal(body.Shipments[0].Details.ActualWeight.Value, 2.5, 'the DTO weight must be sent');
      assert.equal(body.Shipments[0].Details.NumberOfPieces, 2, 'the DTO piece count must be sent');
      assert.deepEqual(
        body.Shipments[0].Details.CashOnDeliveryAmount,
        { CurrencyCode: 'SAR', Value: 320 },
        'the COD block must carry the order total in SAR',
      );
      const row = await readOrder(db, 4);
      assert.equal(row.status, 'shipped', 'the production order must move to shipped');
      assert.equal(row.gcc_shipping_id, 'ARM-987654321', 'the live shipment id must be written back');
      assert.equal(row.gcc_tracking_number, 'ARM-987654321', 'the live tracking number must be written back');
      console.log('  production aramex passed');
    }

    // 5) Production Aramex with missing credentials -> BadRequest before any HTTP call.
    {
      await (db as any)
        .deleteFrom('settings')
        .where('tenant_id', '=', TENANT)
        .where('key', '=', 'gcc_shipping_aramex_password')
        .execute();
      installFetch(() => {
        throw new Error('no carrier call may happen without credentials');
      });
      await assert.rejects(
        () => service.createShipment(6, { carrier: 'aramex' }, ACTOR),
        BadRequestException,
        'missing aramex credentials must reject BadRequest',
      );
      assert.equal(calls.length, 0, 'missing credentials must not reach the carrier');
      await service.saveSettings({ aramexPassword: 'aramex-pass' }, ACTOR);
      console.log('  missing aramex credentials passed');
    }

    // 6) Production SMSA with a stubbed fetch: XML answer, COD 0 on a paid order.
    {
      installFetch(() => ({
        ok: true,
        status: 200,
        text: async () => '<string xmlns="http://tempuri.org/">987654321</string>',
      }));
      const res = await service.createShipment(5, { carrier: 'smsa' }, ACTOR);
      assert.equal(res.ok, true, 'production smsa shipment must answer ok');
      assert.equal(res.isSandbox, false, 'production smsa shipment must not report sandbox');
      assert.equal(res.trackingNumber, '987654321', 'smsa tracking must come from the XML answer');
      assert.equal(res.shipmentId, '987654321', 'smsa shipment id must come from the XML answer');
      assert.equal(res.codAmount, 0, 'a paid-online order must carry COD 0');
      assert.equal(
        res.awbUrl,
        'https://www.smsaexpress.com/ar/trackingdetails?tracknumbers=987654321',
        'the smsa AWB URL must be built',
      );
      assert.equal(calls.length, 1, 'exactly one carrier call must be made');
      assert.equal(
        calls[0].url,
        'https://track.smsaexpress.com/SecomEPASClean/SMSAwebService.asmx/addShipment',
        'the carrier URL must be the SMSA endpoint',
      );
      const form = String(calls[0].init.body);
      assert.ok(form.includes('passKey=smsa-key-1'), 'the smsa passkey must be sent');
      assert.ok(form.includes('codAmt=0'), 'the SMSA form must carry COD 0');
      assert.ok(form.includes('refNos=ORD-5'), 'the SMSA form must carry the order reference');
      const row = await readOrder(db, 5);
      assert.equal(row.gcc_shipping_carrier, 'smsa', 'the smsa carrier must be written back');
      assert.equal(row.gcc_tracking_number, '987654321', 'the smsa tracking must be written back');
      console.log('  production smsa passed');
    }

    // 7) A 'Failed:' SMSA answer -> BadRequest.
    {
      installFetch(() => ({
        ok: true,
        status: 200,
        text: async () => '<string xmlns="http://tempuri.org/">Failed: invalid passkey</string>',
      }));
      await assert.rejects(
        () => service.createShipment(7, { carrier: 'smsa' }, ACTOR),
        BadRequestException,
        'a failed SMSA answer must reject BadRequest',
      );
      const row = await readOrder(db, 7);
      assert.equal(row.status, 'confirmed', 'a failed shipment must not ship the order');
      console.log('  failed smsa answer passed');
    }

    // 8) Tracking history + AWB print data from the stored row.
    {
      const track = await service.getTracking('ARM-987654321', ACTOR);
      assert.equal(track.ok, true, 'tracking must answer ok');
      assert.equal(track.carrier, 'aramex', 'tracking must report aramex');
      assert.equal(track.history.length, 3, 'tracking must build a 3-event history');
      assert.equal(track.destinationCity, 'جدة', 'tracking must use the order zone as destination');
      assert.equal(track.originCity, 'الرياض', 'tracking must use the pickup city as origin');
      assert.ok(track.officialTrackingUrl.includes('ARM-987654321'), 'tracking must link the official aramex page');
      const awb = await service.getAwbPrintData('ARM-987654321', ACTOR);
      assert.equal(awb.carrierLabel, 'ARAMEX EXPRESS', 'the AWB label must be ARAMEX EXPRESS');
      assert.equal(awb.barcodeValue, 'ARM-987654321', 'the AWB barcode must be the tracking number');
      assert.equal(awb.codAmount, 320, 'the AWB COD must be the unpaid order total');
      assert.equal(awb.currency, 'SAR', 'the AWB currency must be SAR');
      assert.equal(awb.receiver.name, 'سارة علي', 'the AWB receiver must come from the order');
      await assert.rejects(
        () => service.getAwbPrintData('ARM-unknown', ACTOR),
        NotFoundException,
        'an unknown tracking number must reject NotFound on AWB read',
      );
      console.log('  tracking + AWB passed');
    }

    // 9) An actor without permissions is forbidden before any DB write.
    {
      await assert.rejects(
        () => service.createShipment(1, {}, NO_PERM_ACTOR),
        ForbiddenException,
        'an actor without deliveryReps must be forbidden',
      );
      console.log('  permission guard passed');
    }
  } finally {
    (globalThis as any).fetch = realFetch;
    await db.destroy();
  }
  console.log('phase1 final slice 14 gcc-shipping baseline passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
