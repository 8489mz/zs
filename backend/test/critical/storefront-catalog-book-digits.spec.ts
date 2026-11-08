/*
New file: backend/test/critical/storefront-catalog-book-digits.spec.ts
Pins D6a (U2): toFixed(2) cuts in storefront/catalog money computation
now round at the tenant's canonical book digits (3 for KWD/OMR/BHD/
JOD/TND/IQD/LYD, 2 otherwise), through the shared roundMoney engine.

THE GAP: four money computations cut every value to cents with
Number(x.toFixed(2)) — the coupon preview discount, the marketplace
repricing floor/target price, the inbound-shipment discrepancy loss
(and its claim report), and the POS combo original price. A 3-decimal
tenant computed 100.125 in one place and displayed/charged 100.13 in
another. Display-only formatters (the WhatsApp order text, the audit
log sentence) already read the same digits value and are untouched.

WHAT THIS PINS (real services, no re-implemented math):
(a) validateCoupon, JOD tenant: a 10% coupon on 1001.25 discounts
    100.125, not 100.13 — the fail-first discrimination (the old code
    gave 100.13). EGP tenant: the same discount is 100.13, exactly
    as before — 2-decimal behaviour is identical.
(b) runRepricingBot, KWD tenant: an undercut target of 200.626
    reprices to 200.626 (old: 200.63), and a floor of
    100.125 x 1.05 binds at 105.131 (old: 105.13). EGP tenant: the
    same mappings reprice to 200.63 / 105.13, as before.
(c) recordShipmentReceiving + getDiscrepancyClaimReport, KWD tenant:
    1 missing unit at cost 10.0125 loses 10.013, not 10.01, and the
    claim report's estimated reimbursement agrees.
(d) fetchPosBomCombos, KWD tenant: components 2 x 33.375 + 33.375
    give a combo original price of 100.125, not 100.13. EGP tenant:
    100.13, as before.

HOW THIS IS DRIVEN: (a) and (d) run the real services over the
same stubbed-Kysely proxy the storefront line-total spec uses;
(b) and (c) run the real MarketplaceSyncService over PGlite with
real settings / currency_exchange_rates / products rows, so the
fail-closed tenantBaseCurrency read and the settings upsert run
for real. PGlite teardown is db.destroy() only.

RED PROOF: on the unfixed tree (a) returns 100.13, (b) reprices
to 200.63 / 105.13, (c) loses 10.01, and (d) returns 100.13.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

/* Stubbed-Kysely proxy: every chained call returns the same query
object; execute/executeTakeFirst answer from rowsByTable. Mirrors
the storefront line-total spec's harness. */
function makeFakeDb(rowsByTable: Record<string, any[]>): any {
  const eb: any = Object.assign(
    (..._args: any[]) => true,
    { or: (..._args: any[]) => true, and: (..._args: any[]) => true },
  );
  const makeQuery = (table: string): any => {
    const q: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'execute') return async () => rowsByTable[table] ?? [];
        if (prop === 'executeTakeFirst') return async () => (rowsByTable[table] ?? [])[0];
        if (prop === 'then') return undefined;
        return (...args: any[]) => {
          for (const arg of args) {
            if (typeof arg === 'function') {
              try { arg(eb); } catch { /* expression-builder shapes only */ }
            }
          }
          return q;
        };
      },
      apply() { return q; },
    });
    return q;
  };
  return { selectFrom: (table: string) => makeQuery(table) };
}

/* (a) Coupon preview discount ------------------------------------------- */

const COUPON = {
  code: 'SAVE10',
  is_active: true,
  start_date: null,
  end_date: null,
  usage_limit: null,
  times_used: 0,
  min_order_amount: 0,
  discount_type: 'percentage',
  discount_value: 10,
  max_discount_amount: null,
};

function makeStorefrontService(settingsCurrency: string): any {
  const svc: any = new (StorefrontService as any)(makeFakeDb({ storefront_coupons: [COUPON] }), {}, {}, {});
  svc.getTenantBySlug = async () => ({ id: TENANT, currency: settingsCurrency, slug: 'shop', activity_type: null });
  svc.getTenantSettingsMap = async () => new Map<string, string>([['currency', settingsCurrency]]);
  return svc;
}

/* (d) POS combo original price ------------------------------------------ */

function makeCatalogService(currency: string): any {
  const svc: any = new (CatalogProductService as any)(
    makeFakeDb({
      'manufacturing_bom_lines as bl': [
        { bom_id: 7, component_product_id: 1, quantity: 2, component_name: 'A', component_retail_price: 33.375 },
        { bom_id: 7, component_product_id: 2, quantity: 1, component_name: 'B', component_retail_price: 33.375 },
      ],
      settings: [{ value: currency }],
      currency_exchange_rates: [{ currency_code: currency, exchange_rate: 1 }],
    }),
    {},
    {},
  );
  return svc;
}

/* (b) + (c) Marketplace repricing / inbound receiving on PGlite --------- */

async function makeMarketplaceDb(currency: string): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text, account_id text, UNIQUE (tenant_id, key));
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, cost_price numeric, retail_price numeric);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: currency, account_id: ACCOUNT }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('products').values({ id: 1, tenant_id: TENANT, cost_price: 10.0125, retail_price: 200 }).execute();
  return { pg, db };
}

function buildMarketplaceService(db: Kysely<Database>): MarketplaceSyncService {
  const audit = { log: async () => undefined };
  return new MarketplaceSyncService(db as any, audit as any, {} as any);
}

async function readMappings(db: Kysely<Database>): Promise<any[]> {
  const rows = await (db as any).selectFrom('settings').select(['value'])
    .where('key', '=', 'marketplace_sku_mappings')
    .where(sql<boolean>`tenant_id = ${TENANT}`).execute();
  return JSON.parse(String(rows[0].value));
}

const REPRICING_MAPPINGS = [
  {
    marketplace: 'amazon', marketplaceSku: 'SKU-1', productId: 1,
    productName: 'Widget', retailPrice: 200, costPrice: 100.125,
    repricingEnabled: true, repricingRule: 'undercut_buy_box',
    repricingDelta: 1, buyBoxPrice: 201.626, competitorPrice: 201.626,
  },
  {
    marketplace: 'amazon', marketplaceSku: 'SKU-2', productId: 1,
    productName: 'Gadget', retailPrice: 100, costPrice: 100.125,
    repricingEnabled: true, repricingRule: 'match_buy_box',
    buyBoxPrice: 100, competitorPrice: 100,
  },
];

const SHIPMENT = {
  id: 'sh1', shipmentNumber: 'SH-1', marketplace: 'amazon',
  fulfillmentCenterId: 'FC-1', totalUnits: 10, totalBoxes: 1,
  status: 'shipped', createdAt: '2026-11-08T00:00:00.000Z',
  trackingNumber: 'TRK-1',
  items: [
    { productId: 1, marketplaceSku: 'SKU-1', productName: 'Widget', quantityShipped: 10, costPrice: 10.0125 },
  ],
};

async function main(): Promise<void> {
  // (a) Coupon preview: 10% of 1001.25 is 100.125.
  {
    const jod = await makeStorefrontService('JOD').validateCoupon('shop', 'SAVE10', 1001.25);
    assert.equal(jod.ok, true);
    assert.equal(jod.discountAmount, 100.125, 'JOD coupon discount must keep the third decimal');
    const egp = await makeStorefrontService('EGP').validateCoupon('shop', 'SAVE10', 1001.25);
    assert.equal(egp.ok, true);
    assert.equal(egp.discountAmount, 100.13, 'EGP coupon discount rounds to cents exactly as before');
  }

  // (d) POS combo original price: 2 x 33.375 + 33.375 = 100.125.
  {
    const kwd = await makeCatalogService('KWD').fetchPosBomCombos([7], adminAuth);
    assert.equal(kwd.get(7).comboOriginalPrice, 100.125, 'KWD combo original price must keep the third decimal');
    const egp = await makeCatalogService('EGP').fetchPosBomCombos([7], adminAuth);
    assert.equal(egp.get(7).comboOriginalPrice, 100.13, 'EGP combo original price rounds to cents exactly as before');
  }

  // (b) Repricing bot on PGlite.
  for (const [currency, expectedTarget, expectedFloor] of [
    ['KWD', 200.626, 105.131],
    ['EGP', 200.63, 105.13],
  ] as const) {
    const { pg, db } = await makeMarketplaceDb(currency);
    try {
      const anyDb = db as any;
      await anyDb.insertInto('settings').values({
        tenant_id: TENANT, key: 'marketplace_sku_mappings',
        value: JSON.stringify(REPRICING_MAPPINGS), account_id: ACCOUNT,
      }).execute();
      const service = buildMarketplaceService(db);
      const result = await service.runRepricingBot('amazon', adminAuth);
      assert.equal(result.totalRepriced, 2, `${currency}: both mappings must reprice`);
      const mappings = await readMappings(db);
      assert.equal(mappings[0].customPrice, expectedTarget, `${currency}: undercut target`);
      assert.equal(mappings[1].customPrice, expectedFloor, `${currency}: cost floor binds at book digits`);
    } finally {
      await db.destroy();
    }
  }

  // (c) Inbound receiving + discrepancy claim on PGlite (KWD).
  {
    const { pg, db } = await makeMarketplaceDb('KWD');
    try {
      const anyDb = db as any;
      await anyDb.insertInto('settings').values({
        tenant_id: TENANT, key: 'marketplace_inbound_shipments',
        value: JSON.stringify([SHIPMENT]), account_id: ACCOUNT,
      }).execute();
      const service = buildMarketplaceService(db);
      const received = await service.recordShipmentReceiving(
        'sh1',
        [{ productId: 1, marketplaceSku: 'SKU-1', quantityReceived: 9 }],
        adminAuth,
      );
      assert.equal(received.discrepancyLossAmount, 10.013, '1 missing unit at 10.0125 loses 10.013, not 10.01');
      const claim = await service.getDiscrepancyClaimReport('sh1', adminAuth);
      assert.equal(claim.estimatedReimbursementAmount, 10.013, 'claim total agrees with the stored loss');
      assert.equal(claim.items[0].totalLoss, 10.013, 'claim item loss agrees with the stored loss');
    } finally {
      await db.destroy();
    }
  }

  console.log('storefront-catalog-book-digits.spec: ok');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
