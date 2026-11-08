/*
 * INV-MARKETPLACE-OUTBOX-RELAY: stored inbound marketplace webhook
 * events are relayed to their handlers ONLY after HMAC-SHA256
 * signature verification over the exact raw bytes the gateway
 * signed. A stored unsigned or tampered event is NEVER processed;
 * a stored signed event is relayed to its handler EXACTLY ONCE
 * across retries; a relay failure leaves the event stored and
 * retryable, never silently dropped.
 *
 * WHAT THE AUDIT FEARED: marketplace-sync.service.ts persisted
 * events before returning 200 but had NO relay, NO processing of
 * stored events, and NO signature verification -- stored rows were
 * inert evidence and any future processing would have had to trust
 * re-serialised payload bytes no gateway ever signed.
 *
 * WHAT THIS PINS, driving the REAL MarketplaceSyncService on PGlite
 * (the real migrations 0275 + 0298 create the table and the
 * signature columns; audit/posting are stubbed except where the
 * settlement date pin needs the real posting service):
 * 1. Pure-engine pins: the verifier accepts a correct signature
 *    (with or without the `sha256=` prefix) and fails closed on a
 *    wrong secret, a tampered body, a malformed signature, a short
 *    secret, and non-string inputs -- it never throws on bad input.
 * 2. Receipt captures the signature header and the exact raw bytes
 *    alongside the payload; an unsigned receipt stores NULLs. In
 *    both cases the status stays 'pending' -- nothing is verified
 *    or processed at receipt time.
 * 3. A stored signed event relays to a registered counting handler
 *    exactly once: status 'processed', processed_at set, a second
 *    relay claims nothing and the handler is still invoked once.
 * 4. A tampered event (signature over different bytes than the
 *    stored body) is 'rejected', the handler is NEVER called, and a
 *    second relay does not re-claim it.
 * 5. An unsigned event -- and a legacy row stored before migration
 *    0298 -- is 'unverifiable': it stays 'pending' for manual
 *    review, the handler is never called.
 * 6. A verified event with no handler registered is
 *    'skipped-no-handler' and stays 'pending'; registering a
 *    handler and relaying again processes it.
 * 7. A handler that throws fails the relay outcome, rolls the
 *    event back to 'pending', and the batch continues; relaying
 *    again with a good handler processes it (retryable, never
 *    dropped, never double-processed).
 * 8. Config: a webhookSecret shorter than 32 characters is
 *    rejected at save; a valid secret is stored and masked on
 *    read, and saving the masked value preserves it.
 * 9. Date pin (deterministic): a settlement whose periodEnd is a
 *    datetime instant (2026-01-15T00:30:00Z) posts its journal on
 *    the tenant-local business day (2026-01-14 in America/New_York);
 *    a plain YYYY-MM-DD periodEnd passes through untouched. The
 *    old code used the UTC slice of the instant and would post
 *    2026-01-15.
 * 10. Export filename pin: the filename carries the tenant-local
 *     business day (Pacific/Kiritimati, UTC+14), computed
 *     independently in the spec via Intl. Caveat, stated honestly:
 *     this pin discriminates only while the UTC date and the
 *     Kiritimati date differ (14 hours of each day); the
 *     deterministic proof of the gateway routing is case 9 plus
 *     the code path itself.
 * 11. Source pins: the public route passes the signature header
 *     and rawBody into receipt; the guarded controller exposes
 *     POST webhooks/relay; production registers no webhook handler
 *     (the order-ingestion handler is a follow-up needing a policy
 *     decision -- see the relay docs in the service).
 *
 * Deliberately NOT driven here: the HTTP layer (controllers) and
 * any order-ingestion handler (none exists to dispatch to).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import {
  MARKETPLACE_WEBHOOK_SIGNATURE_HEADER,
  verifyMarketplaceWebhookSignature,
} from '../../src/modules/storefront/engines/marketplace-webhook-event.engine';
import { up as webhookEventsUp } from '../../src/database/migrations/2040000000275_marketplace_webhook_events';
import { up as signatureCaptureUp } from '../../src/database/migrations/2040000000298_marketplace_webhook_signature_capture';

const SECRET = 'relay-test-webhook-secret-0123456789';
const ACCOUNT = 'a-relay';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-relay',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

/** Calendar key from local parts -- never from a UTC slice. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sign(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function amazonPayload(orderId: string): Record<string, unknown> {
  return { eventType: 'ORDER_CREATED', AmazonOrderId: orderId, SellerId: 'SELLER-R', total: 10 };
}

async function makeRelayDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
  `);
  await webhookEventsUp(db as never);
  await signatureCaptureUp(db as never);
  await signatureCaptureUp(db as never);
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({
    tenant_id: 't-relay', account_id: ACCOUNT, key: 'marketplace_amazon_config',
    value: JSON.stringify({ enabled: true, sellerId: 'SELLER-R', webhookSecret: SECRET }),
  }).execute();
  return { pg, db };
}

async function makeSettlementDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_marketplace_settlements (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL, marketplace text NOT NULL, settlement_key text NOT NULL, payload jsonb NOT NULL, journal_entry_id bigint, UNIQUE (tenant_id, marketplace, settlement_key));
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: 't-settle' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: 't-settle', key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: 't-settle', key: 'timezone', value: 'America/New_York' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: 't-settle', currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: 't-settle' }).execute();
  const accounts: Array<[number, string, string, boolean]> = [
    [1120, '1120', 'asset', true],
    [4100, '4100', 'revenue', false],
    [6400, '6400', 'expense', false],
    [6700, '6700', 'expense', false],
  ];
  for (const [id, code, type, isCashBank] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({
      id, tenant_id: 't-settle', code, name_ar: code, account_type: type,
      is_active: true, is_cash_bank: isCashBank, allow_manual_entries: true,
    }).execute();
  }
  return { pg, db };
}

async function main(): Promise<void> {
  // 1. Pure-engine pins: fail-closed, never throws on bad input.
  {
    const raw = '{"eventType":"ORDER_CREATED"}';
    const good = sign(SECRET, raw);
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: raw }), true, 'a correct signature verifies');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good.replace('sha256=', ''), rawBody: raw }), true, 'the sha256= prefix is optional');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: Buffer.from(raw) }), true, 'a Buffer body verifies the same bytes');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: 'wrong-secret-0123456789-wrong', signature: good, rawBody: raw }), false, 'a wrong secret fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: sign(SECRET, '{"tampered":true}'), rawBody: raw }), false, 'a signature over different bytes fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: 'sha256=zzzz', rawBody: raw }), false, 'a malformed signature fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: '', rawBody: raw }), false, 'a missing signature fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: 'short', signature: good, rawBody: raw }), false, 'a secret shorter than 32 characters fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: undefined, signature: good, rawBody: raw }), false, 'a missing secret fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: undefined }), false, 'a missing body fails');
    assert.equal(verifyMarketplaceWebhookSignature({ secret: 42, signature: good, rawBody: raw }), false, 'a non-string secret fails without throwing');
    console.log('  pure-engine signature pins passed');
  }

  // 2. Receipt captures signature material; status stays 'pending'.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      const payload = amazonPayload('701-SIGNED-1');
      const raw = JSON.stringify(payload);
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw),
        rawBody: Buffer.from(raw),
      });
      assert.equal(received.received, true);
      assert.ok(received.eventId);
      const stored = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(stored.status, 'pending', 'receipt never verifies or processes: status stays pending');
      assert.equal(stored.signature, sign(SECRET, raw), 'the signature header is stored as received');
      assert.equal(stored.raw_body, raw, 'the exact raw bytes are stored');

      const unsigned = await service.receiveMarketplaceWebhook('amazon', amazonPayload('701-UNSIGNED-1'));
      const unsignedRow = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', unsigned.eventId).executeTakeFirstOrThrow();
      assert.equal(unsignedRow.status, 'pending');
      assert.equal(unsignedRow.signature, null, 'an unsigned receipt stores a NULL signature');
      assert.equal(unsignedRow.raw_body, null, 'an unsigned receipt stores a NULL raw body');
    } finally {
      await db.destroy();
    }
    console.log('  receipt capture pins passed');
  }

  // 3. A stored signed event relays exactly once.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      let handlerCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async (_trx, event) => {
        handlerCalls += 1;
        assert.equal(event.eventType, 'ORDER_CREATED');
        assert.equal(event.tenantId, 't-relay');
        return { handled: true, actionTaken: 'counted' };
      });
      const payload = amazonPayload('701-ONCE-1');
      const raw = JSON.stringify(payload);
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw), rawBody: raw,
      });
      const first = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(first.claimed, 1);
      assert.equal(first.processed, 1, 'the signed event is relayed');
      assert.equal(first.results[0].outcome, 'processed');
      assert.equal(handlerCalls, 1, 'the handler runs once');
      const row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'processed');
      assert.ok(row.processed_at, 'processed_at is set on the same transaction');
      const second = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(second.claimed, 0, 'a second relay finds no pending rows');
      assert.equal(handlerCalls, 1, 'the handler is NOT invoked a second time');
    } finally {
      await db.destroy();
    }
    console.log('  exactly-once relay passed');
  }

  // 4. A tampered event is rejected loudly, never dispatched.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      let handlerCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        handlerCalls += 1;
        return { handled: true, actionTaken: 'counted' };
      });
      const payload = amazonPayload('701-TAMPER-1');
      const raw = JSON.stringify(payload);
      // Signature over DIFFERENT bytes than the stored body.
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, '{"eventType":"ORDER_CREATED","AmazonOrderId":"701-OTHER"}'),
        rawBody: raw,
      });
      const result = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(result.rejected, 1, 'the tampered event is rejected');
      assert.equal(result.results[0].outcome, 'rejected');
      assert.equal(handlerCalls, 0, 'the handler NEVER runs for a bad signature');
      const row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'rejected');
      const again = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(again.claimed, 0, 'a rejected event is terminal, not re-claimed');
      assert.equal(handlerCalls, 0);
    } finally {
      await db.destroy();
    }
    console.log('  tampered-event rejection passed');
  }

  // 5. Unsigned and legacy rows are unverifiable and stay pending.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      let handlerCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        handlerCalls += 1;
        return { handled: true, actionTaken: 'counted' };
      });
      await service.receiveMarketplaceWebhook('amazon', amazonPayload('701-UNSIGNED-2'));
      // A legacy row stored before migration 0298: no signature material.
      await (db as any).insertInto('marketplace_webhook_events').values({
        tenant_id: 't-relay', account_id: null, marketplace: 'amazon',
        event_type: 'ORDER_CREATED', event_key: 'legacy-1', dedup_key: 'legacy-dedup-1',
        payload: amazonPayload('701-LEGACY-1'), payload_hash: 'legacy-hash',
        signature: null, raw_body: null, status: 'pending',
      }).execute();
      const result = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(result.claimed, 2);
      assert.equal(result.unverifiable, 2, 'both rows lack signature material');
      assert.equal(result.processed, 0);
      assert.equal(handlerCalls, 0, 'the handler NEVER runs for an unverifiable event');
      const rows = await (db as any).selectFrom('marketplace_webhook_events').select(['status']).execute();
      assert.ok(rows.every((r: any) => r.status === 'pending'), 'unverifiable events stay pending for manual review');
    } finally {
      await db.destroy();
    }
    console.log('  unverifiable-events stay pending passed');
  }

  // 6. No handler: skipped, stays pending; register, relay again: processed.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      const payload = amazonPayload('701-NOHANDLER-1');
      const raw = JSON.stringify(payload);
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw), rawBody: raw,
      });
      const first = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(first.skippedNoHandler, 1, 'a verified event with no handler is skipped, not failed');
      let row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'pending', 'the event waits for a handler to exist');
      let handlerCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        handlerCalls += 1;
        return { handled: true, actionTaken: 'counted' };
      });
      const second = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(second.processed, 1);
      assert.equal(handlerCalls, 1);
      row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'processed');
    } finally {
      await db.destroy();
    }
    console.log('  skipped-no-handler then processed passed');
  }

  // 7. A throwing handler fails the outcome, rolls back, stays retryable.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        throw new Error('downstream boom');
      });
      const payload = amazonPayload('701-THROW-1');
      const raw = JSON.stringify(payload);
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw), rawBody: raw,
      });
      const first = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(first.failed, 1, 'a handler throw is reported as failed');
      assert.equal(first.results[0].outcome, 'failed');
      assert.match(first.results[0].error || '', /downstream boom/);
      let row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'pending', 'the failed event rolls back to pending, retryable');
      service.unregisterMarketplaceWebhookHandler('ORDER_CREATED');
      let goodCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        goodCalls += 1;
        return { handled: true, actionTaken: 'counted' };
      });
      const second = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(second.processed, 1, 'the retry after a handler failure processes the event');
      assert.equal(goodCalls, 1);
      row = await (db as any).selectFrom('marketplace_webhook_events').selectAll().where('id', '=', received.eventId).executeTakeFirstOrThrow();
      assert.equal(row.status, 'processed');
    } finally {
      await db.destroy();
    }
    console.log('  handler-failure retry passed');
  }

  // 8. Config: short secrets rejected, valid secrets masked and preserved.
  {
    const { pg, db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      await assert.rejects(
        () => service.saveConfig({ amazon: { webhookSecret: 'too-short' } } as never, auth('t-relay')),
        /at least 32 characters/,
        'a webhook secret shorter than 32 characters is rejected at save',
      );
      await service.saveConfig({ amazon: { webhookSecret: SECRET } } as never, auth('t-relay'));
      const config = await service.getConfig(auth('t-relay'));
      assert.equal(config.amazon.webhookSecret, '••••••••', 'the stored secret is masked on read');
      await service.saveConfig({ amazon: { webhookSecret: '••••••••' } } as never, auth('t-relay'));
      const configAgain = await service.getConfig(auth('t-relay'));
      assert.equal(configAgain.amazon.webhookSecret, '••••••••', 'saving the masked value preserves the secret');
      // The preserved secret still verifies: a signed event relays.
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => ({ handled: true, actionTaken: 'counted' }));
      const payload = amazonPayload('701-SECRET-1');
      const raw = JSON.stringify(payload);
      await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw), rawBody: raw,
      });
      const result = await service.relayMarketplaceWebhookEvents(auth('t-relay'));
      assert.equal(result.processed, 1, 'the preserved secret still verifies after a masked save');
    } finally {
      await db.destroy();
    }
    console.log('  webhook-secret config pins passed');
  }

  // 9. Date pin (deterministic): a datetime periodEnd posts on the
  //    tenant-local business day; a plain date passes through.
  {
    const { pg, db } = await makeSettlementDb();
    try {
      const foundation = {
        ensureForAuth: async () => {},
        ensureForScope: async () => {},
      } as unknown as AccountingTenantFoundationService;
      const posting = new AccountingPostingService(foundation);
      const service = new MarketplaceSyncService(db, new AuditService(db), posting);
      const settlementAuth: AuthContext = {
        userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
        permissions: ['sales'], tenantId: 't-settle', accountId: 'a1',
      } as unknown as AuthContext;
      // 2026-01-15T00:30:00Z is 2026-01-14 19:30 in America/New_York.
      const instantResult = await service.reconcileSettlement({
        marketplace: 'amazon', settlementId: 'SET-DATE-1',
        periodStart: '2026-01-01', periodEnd: '2026-01-15T00:30:00.000Z', currency: 'EGP',
        grossSales: 100, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.5,
      }, settlementAuth);
      assert.equal(instantResult.ok, true);
      const instantRow = await (db as any).selectFrom('journal_entries').select(['entry_date']).where('id', '=', instantResult.journalEntryId).executeTakeFirstOrThrow();
      assert.equal(dateKey(instantRow.entry_date), '2026-01-14', 'a datetime periodEnd keys the tenant-local day, not the UTC day');
      const plainResult = await service.reconcileSettlement({
        marketplace: 'amazon', settlementId: 'SET-DATE-2',
        periodStart: '2026-01-01', periodEnd: '2026-01-15', currency: 'EGP',
        grossSales: 100, referralFees: 10, fulfillmentFees: 5,
        refunds: 0, storageOrOtherFees: 0.5, netPayout: 84.5,
      }, settlementAuth);
      assert.equal(plainResult.ok, true);
      const plainRow = await (db as any).selectFrom('journal_entries').select(['entry_date']).where('id', '=', plainResult.journalEntryId).executeTakeFirstOrThrow();
      assert.equal(dateKey(plainRow.entry_date), '2026-01-15', 'a plain YYYY-MM-DD periodEnd passes through untouched');
    } finally {
      await db.destroy();
    }
    console.log('  settlement business-date pin passed');
  }

  // 10. Export filename pin: the tenant-local business day.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
      `);
      const anyDb = db as any;
      await anyDb.insertInto('settings').values({ tenant_id: 't-export', key: 'timezone', value: 'Pacific/Kiritimati' }).execute();
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      const exported = await service.exportFlatFile('amazon', auth('t-export'));
      const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date()).replace(/-/g, '');
      assert.equal(exported.filename, `Amazon_Inventory_Loader_${expected}.tsv`, 'the filename carries the tenant-local day (Kiritimati), not the UTC day');
      assert.equal(exported.rowCount, 0, 'no mappings seeded, so no rows');
    } finally {
      await db.destroy();
    }
    console.log('  export filename business-date pin passed');
  }

  // 11. Source pins: the routes are wired and production registers
  //     no handler.
  {
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/storefront/services/marketplace-sync.service.ts'),
      'utf8',
    );
    const publicSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/storefront/storefront-public.controller.ts'),
      'utf8',
    );
    const guardedSource = fs.readFileSync(
      path.join(__dirname, '../../src/modules/storefront/controllers/marketplace-sync.controller.ts'),
      'utf8',
    );
    assert.equal(publicSource.includes('MARKETPLACE_WEBHOOK_SIGNATURE_HEADER'), true, 'the public route reads the signature header');
    assert.equal(publicSource.includes('rawBody'), true, 'the public route passes the raw body into receipt');
    assert.equal(guardedSource.includes("webhooks/relay"), true, 'the guarded controller exposes the relay endpoint');
    assert.equal(guardedSource.includes('relayMarketplaceWebhookEvents'), true, 'the relay endpoint calls the relay');
    // \b excludes unregisterMarketplaceWebhookHandler (the "un" prefix
    // means no word boundary before "register" there).
    const registrations = (serviceSource.match(/\bregisterMarketplaceWebhookHandler\(/g) || []).length;
    assert.equal(registrations, 1, 'only the registry method definition calls registerMarketplaceWebhookHandler -- production registers no handler');
    assert.equal(serviceSource.includes('relayMarketplaceWebhookEvents'), true, 'the relay method exists on the service');
    console.log('  source wiring pins passed');
  }

  console.log('Marketplace outbox relay tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
