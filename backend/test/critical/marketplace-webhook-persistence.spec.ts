/*
 * INV-MARKETPLACE-WEBHOOK-PERSISTENCE: a marketplace webhook event is
 * durably stored BEFORE the 200 response is returned, duplicates
 * collapse into the stored row, and events that cannot be attributed
 * to a tenant are stored unresolved -- never dropped, never
 * attributed to the wrong tenant.
 *
 * WHAT THE AUDIT FEARED: handleMarketplaceWebhook logged the payload
 * and returned { received: true } without writing any row -- and its
 * reply strings claimed stock was updated and the repricing bot ran,
 * neither of which ever happened. A gateway that got its 200 never
 * retries, so the notification was gone with only a log line as
 * evidence. The route also lived behind SessionAuthGuard, so no
 * external marketplace gateway could ever reach it at all.
 *
 * WHAT THIS PINS, driving the REAL MarketplaceSyncService on PGlite
 * (the real migration file creates the table; audit/posting are
 * stubbed: neighbours, not the unit under test):
 * 1. Amazon ORDER_CREATED payload -> one row, duplicate:false,
 *    eventId set; the seller id is configured under TWO tenants, so
 *    the match is ambiguous and the row is stored unresolved.
 * 2. Identical redelivery (even with keys in a different order) ->
 *    duplicate:true, still exactly one row.
 * 3. Noon payload -> tenant resolved by merchantId match.
 * 4. Unknown seller id -> row stored with NULL tenant, status
 *    'unresolved'.
 * 5. Same seller id under two tenants -> unresolved (ambiguous,
 *    fail-closed). A disabled config never matches.
 * 6. Session-tenant hint with no seller ids in the payload -> the
 *    session tenant owns the event.
 * 7. Insert failure -> the call THROWS (the gateway gets a 5xx and
 *    retries); no silent 200. (Run last; the table is dropped.)
 * 8. The guarded list method returns only the caller's tenant rows.
 * 9. Pure-engine pins: canonical JSON is key-order insensitive, the
 *    dedup key prefers the external event key over the content hash,
 *    tenant matching needs exactly one match.
 * 10. Source pin: the old reply strings claiming stock/repricing
 *     updates are gone from the service file.
 *
 * Deliberately NOT driven here: signature verification (a separate
 * package -- these rows are inert evidence until then), any relay or
 * processing of stored events, and the HTTP layer (controllers).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import {
  canonicalJson,
  extractMarketplaceEventIdentity,
  marketplaceWebhookDedupKey,
  matchMarketplaceTenant,
} from '../../src/modules/storefront/engines/marketplace-webhook-event.engine';
import { up as webhookEventsUp } from '../../src/database/migrations/2040000000275_marketplace_webhook_events';
import { up as signatureCaptureUp } from '../../src/database/migrations/2040000000298_marketplace_webhook_signature_capture';

const TENANT_AMZ = 't-amz';
const TENANT_AMZ2 = 't-amz2';
const TENANT_NOON = 't-noon';
const ACCOUNT = 'a-mkt';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
    `);
    await webhookEventsUp(db as never);
    await webhookEventsUp(db as never);
    // INV-MARKETPLACE-OUTBOX-RELAY (0298): receipt now stores the
    // signature header and raw body columns; the fixture must run the
    // migration or every receive call fails on missing columns.
    await signatureCaptureUp(db as never);

    const auditStub = { log: async () => undefined };
    const service = new MarketplaceSyncService(db, auditStub as never, {} as never);

    async function seedConfig(tenantId: string, key: string, cfg: Record<string, unknown>): Promise<void> {
      await anyDb
        .insertInto('settings')
        .values({ tenant_id: tenantId, account_id: ACCOUNT, key, value: JSON.stringify(cfg) })
        .execute();
    }

    await seedConfig(TENANT_AMZ, 'marketplace_amazon_config', { enabled: true, sellerId: 'SELLER-1' });
    await seedConfig(TENANT_AMZ2, 'marketplace_amazon_config', { enabled: true, sellerId: 'SELLER-1' });
    await seedConfig(TENANT_NOON, 'marketplace_noon_config', { enabled: true, merchantId: 'MERCHANT-9' });
    await seedConfig(TENANT_AMZ, 'marketplace_noon_config', { enabled: false, merchantId: 'MERCHANT-OFF' });

    async function rowCount(): Promise<number> {
      const rows = await anyDb.selectFrom('marketplace_webhook_events').select('id').execute();
      return rows.length;
    }

    // 1. Amazon order-created payload: stored, tenant resolved, not a duplicate.
    const amazonPayload = { eventType: 'ORDER_CREATED', AmazonOrderId: '701-1234567', SellerId: 'SELLER-1', total: 42.5 };
    const first = await service.receiveMarketplaceWebhook('amazon', amazonPayload);
    assert.equal(first.received, true);
    assert.equal(first.duplicate, false);
    assert.equal(typeof first.eventId, 'number');
    assert.equal(await rowCount(), 1);
    const stored = await anyDb
      .selectFrom('marketplace_webhook_events')
      .select(['tenant_id', 'marketplace', 'event_type', 'event_key', 'status', 'payload'])
      .where('id', '=', first.eventId)
      .executeTakeFirst();
    // Two tenants share SELLER-1, so the match is ambiguous -> unresolved.
    assert.equal(stored.tenant_id, null);
    assert.equal(stored.status, 'unresolved');
    assert.equal(stored.marketplace, 'amazon');
    assert.equal(stored.event_type, 'ORDER_CREATED');
    assert.equal(stored.event_key, '701-1234567');
    assert.equal(canonicalJson(stored.payload), canonicalJson(amazonPayload));

    // 2. Identical redelivery, keys shuffled: duplicate, still one row.
    const shuffled = { total: 42.5, SellerId: 'SELLER-1', AmazonOrderId: '701-1234567', eventType: 'ORDER_CREATED' };
    const dup = await service.receiveMarketplaceWebhook('amazon', shuffled);
    assert.equal(dup.received, true);
    assert.equal(dup.duplicate, true);
    assert.equal(dup.eventId, first.eventId);
    assert.equal(await rowCount(), 1);

    // 3. Noon payload: merchantId match resolves the tenant exactly.
    const noonPayload = { notification_type: 'ORDER_CREATED', order_number: 'NOON-77', merchantId: 'MERCHANT-9' };
    const noon = await service.receiveMarketplaceWebhook('noon', noonPayload);
    assert.equal(noon.duplicate, false);
    const noonRow = await anyDb
      .selectFrom('marketplace_webhook_events')
      .select(['tenant_id', 'status'])
      .where('id', '=', noon.eventId)
      .executeTakeFirst();
    assert.equal(noonRow.tenant_id, TENANT_NOON);
    assert.equal(noonRow.status, 'pending');

    // 4. Unknown seller: stored unresolved, never dropped.
    const unknown = await service.receiveMarketplaceWebhook('amazon', {
      eventType: 'ORDER_CREATED',
      AmazonOrderId: '701-999',
      SellerId: 'SELLER-NOBODY',
    });
    assert.equal(unknown.duplicate, false);
    const unknownRow = await anyDb
      .selectFrom('marketplace_webhook_events')
      .select(['tenant_id', 'status'])
      .where('id', '=', unknown.eventId)
      .executeTakeFirst();
    assert.equal(unknownRow.tenant_id, null);
    assert.equal(unknownRow.status, 'unresolved');

    // 5. Disabled config never matches: merchantId MERCHANT-OFF with
    //    no session hint -> unresolved, even though a row exists.
    const disabled = await service.receiveMarketplaceWebhook('noon', {
      notification_type: 'PRICE_CHANGED',
      merchantId: 'MERCHANT-OFF',
      eventId: 'EV-DISABLED-1',
    });
    const disabledRow = await anyDb
      .selectFrom('marketplace_webhook_events')
      .select(['tenant_id', 'status'])
      .where('id', '=', disabled.eventId)
      .executeTakeFirst();
    assert.equal(disabledRow.tenant_id, null);
    assert.equal(disabledRow.status, 'unresolved');

    // 6. Session-tenant hint, payload with no seller ids: session tenant wins.
    const hinted = await service.receiveMarketplaceWebhook(
      'amazon',
      { eventType: 'UNKNOWN_PING', ping: 1 },
      TENANT_AMZ,
    );
    const hintedRow = await anyDb
      .selectFrom('marketplace_webhook_events')
      .select(['tenant_id', 'status'])
      .where('id', '=', hinted.eventId)
      .executeTakeFirst();
    assert.equal(hintedRow.tenant_id, TENANT_AMZ);
    assert.equal(hintedRow.status, 'pending');

    // 8. List method: tenant-scoped, read-only view of stored rows.
    const listed = await service.listMarketplaceWebhookEvents(auth(TENANT_NOON), {});
    assert.equal(listed.length, 1);
    assert.equal(listed[0].marketplace, 'noon');
    assert.equal(canonicalJson(listed[0].payload), canonicalJson(noonPayload));
    const listedUnresolved = await service.listMarketplaceWebhookEvents(auth(TENANT_NOON), { status: 'unresolved' });
    assert.equal(listedUnresolved.length, 0);
    const listedAmz = await service.listMarketplaceWebhookEvents(auth(TENANT_AMZ), {});
    assert.equal(listedAmz.length, 1);

    // 9. Pure-engine pins.
    assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
    const identity = extractMarketplaceEventIdentity(amazonPayload);
    assert.equal(identity.eventType, 'ORDER_CREATED');
    assert.equal(identity.eventKey, '701-1234567');
    assert.deepEqual(identity.sellerIds, ['SELLER-1']);
    const keyWithId = marketplaceWebhookDedupKey('amazon', identity);
    assert.ok(keyWithId.startsWith('amazon:SELLER-1:701-1234567'));
    const noKeyIdentity = extractMarketplaceEventIdentity({ foo: 'bar' });
    assert.equal(noKeyIdentity.eventKey, '');
    assert.equal(
      marketplaceWebhookDedupKey('amazon', noKeyIdentity),
      `amazon:unresolved:${noKeyIdentity.payloadHash}`,
    );
    assert.equal(
      matchMarketplaceTenant(
        [{ tenantId: 't1', sellerIds: ['S1'] }, { tenantId: 't2', sellerIds: ['S2'] }],
        ['S2'],
      ),
      't2',
    );
    assert.equal(matchMarketplaceTenant([{ tenantId: 't1', sellerIds: ['S1'] }], ['S9']), null);
    assert.equal(
      matchMarketplaceTenant(
        [{ tenantId: 't1', sellerIds: ['S1'] }, { tenantId: 't2', sellerIds: ['S1'] }],
        ['S1'],
      ),
      null,
    );
    assert.equal(matchMarketplaceTenant([{ tenantId: 't1', sellerIds: ['S1'] }], []), null);

    // 10. Source pin: the old reply strings claiming stock/repricing
    //     updates are gone, and the persist path is present.
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/storefront/services/marketplace-sync.service.ts'),
      'utf8',
    );
    assert.equal(serviceSource.includes('تحديث رصيد المخزن تلقائياً'), false);
    assert.equal(serviceSource.includes('روبوت التسعير الذكي'), false);
    assert.equal(serviceSource.includes('marketplace_webhook_events'), true);

    // 7. Insert failure propagates: the gateway must get a 5xx and
    //    retry, never a silent 200 for an unstored event.
    await pg.exec('DROP TABLE marketplace_webhook_events');
    await assert.rejects(() => service.receiveMarketplaceWebhook('amazon', amazonPayload));
  } finally {
    await db.destroy();
  }
  console.log('marketplace webhook persistence checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
