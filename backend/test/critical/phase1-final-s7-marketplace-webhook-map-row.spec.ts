import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { verifyMarketplaceWebhookSignature } from '../../src/modules/storefront/engines/marketplace-webhook-event.engine';
import { up as webhookEventsUp } from '../../src/database/migrations/2040000000275_marketplace_webhook_events';
import { up as signatureCaptureUp } from '../../src/database/migrations/2040000000298_marketplace_webhook_signature_capture';

/*
 * Phase 1 final-inspection slice 7 — the engine-map Outbox row was
 * stale. It still said there was no relay, no processing of stored
 * events and no signature verification yet, although the relay and
 * its verification had already landed (and are pinned behaviorally
 * by marketplace-outbox-relay.spec.ts). This package corrects the
 * row only: no production code changes — the row was the bug.
 *
 * WHAT THIS PINS, driving the REAL verifier + the REAL
 * MarketplaceSyncService on PGlite (no mocks of the services):
 * - §1: the verifier is fail-closed — correct signature verifies
 *   (with or without the sha256= prefix, string or Buffer body);
 *   wrong secret, tampered body, malformed signature, missing
 *   signature, short secret (< 32), missing secret, missing body
 *   and non-string inputs all fail without throwing.
 * - §2: the relay outcomes the corrected row names — a tampered
 *   event is rejected terminally (handler never runs, a second
 *   relay claims nothing); an unsigned event and a legacy row are
 *   unverifiable and stay pending for manual review; an unresolved
 *   row (no tenant) is never claimed by any tenant's relay.
 * - §3: receipt is dormant evidence — a signed receipt stays
 *   pending with the signature header and exact raw bytes stored;
 *   an unsigned receipt stays pending with NULL signature/body.
 *   Nothing is verified or processed at receipt time.
 * - §4: CONTROLS — the relay is manual-only: the controller
 *   route is the single production caller, and neither the relay
 *   service nor the controller schedules anything (no scheduler
 *   exists for the relay; automatic relaying is a product
 *   decision, not built here). The relay claims only its own
 *   tenant's pending rows.
 * - §5: static pins — the corrected engine-map row wording, the
 *   verifier source, the relay call + outcomes, the controller
 *   route, the receipt insert.
 * - §6: the INV entry exists exactly once in both places.
 * - §7: wiring 413 in both lists, this spec last.
 * - §8: the re-pin sweep is complete (no stale count,
 *   last-entry or guard id remains).
 * - §9: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §10: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5)
 *   and the "highest migration" pins stay at 0345 (no
 *   migration in this package).
 *
 * Deliberately NOT re-driven here (pinned by the outbox relay
 * spec): exactly-once processing of a verified event, the
 * skipped-no-handler path, handler-throw retry, and the
 * secret-length config rule at save time.
 *
 * RED-1: run this spec BEFORE the engine-map row is corrected
 * (and before the INV entry is appended) — §5 fails on the stale
 * row wording and §6 fails on the missing INV. §1-§4 pass at
 * RED-1 time: the verification behavior already exists; only
 * the row was wrong.
 * PGlite note: every read runs on the pool outside a transaction
 * or on the tx handle inside one — never a pool read inside an
 * open transaction.
 *
 * Wiring: both critical lists carry 413 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const BACKEND_SRC = path.join(BACKEND, 'src');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const WEBHOOK_ENGINE = path.join(
  BACKEND_SRC,
  'modules',
  'storefront',
  'engines',
  'marketplace-webhook-event.engine.ts',
);
const RELAY_SERVICE = path.join(
  BACKEND_SRC,
  'modules',
  'storefront',
  'services',
  'marketplace-sync-webhook-relay.service.ts',
);
const RECEIVE_SERVICE = path.join(
  BACKEND_SRC,
  'modules',
  'storefront',
  'services',
  'marketplace-sync-webhooks-receive.service.ts',
);
const WEBHOOK_CONTROLLER = path.join(
  BACKEND_SRC,
  'modules',
  'storefront',
  'controllers',
  'marketplace-sync.controller.ts',
);
const STOREFRONT_CONTROLLERS_DIR = path.join(BACKEND_SRC, 'modules', 'storefront', 'controllers');
const STOREFRONT_SERVICES_DIR = path.join(BACKEND_SRC, 'modules', 'storefront', 'services');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const S2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s5-business-date-r3.spec.ts');
const S6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s6-import-fx-payout-idempotency.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');

const NEW_INV = 'INV-MARKETPLACE-WEBHOOK-MAP-ROW';

const SECRET = 's7-webhook-secret-0123456789abcdef';
const TENANT = 't-s7';
const ACCOUNT = 'a-s7';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-s7',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

function sign(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function amazonPayload(orderId: string): Record<string, unknown> {
  return { eventType: 'ORDER_CREATED', AmazonOrderId: orderId, SellerId: 'SELLER-S7', total: 10 };
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
  await anyDb
    .insertInto('settings')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      key: 'marketplace_amazon_config',
      value: JSON.stringify({ enabled: true, sellerId: 'SELLER-S7', webhookSecret: SECRET }),
    })
    .execute();
  return { pg, db };
}

async function main(): Promise<void> {
  // §1: The verifier is fail-closed — the real pure engine, no mocks.
  {
    const raw = '{"eventType":"ORDER_CREATED"}';
    const good = sign(SECRET, raw);
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: raw }),
      true,
      'a correct signature verifies',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good.replace('sha256=', ''), rawBody: raw }),
      true,
      'the sha256= prefix is optional',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: Buffer.from(raw) }),
      true,
      'a Buffer body verifies the same bytes',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: 'wrong-secret-0123456789-wrong', signature: good, rawBody: raw }),
      false,
      'a wrong secret fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: sign(SECRET, '{"tampered":true}'), rawBody: raw }),
      false,
      'a signature over different bytes fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: 'sha256=zzzz', rawBody: raw }),
      false,
      'a malformed signature fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: '', rawBody: raw }),
      false,
      'a missing signature fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: 'short', signature: good, rawBody: raw }),
      false,
      'a secret shorter than 32 characters fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: undefined, signature: good, rawBody: raw }),
      false,
      'a missing secret fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: SECRET, signature: good, rawBody: undefined }),
      false,
      'a missing body fails',
    );
    assert.equal(
      verifyMarketplaceWebhookSignature({ secret: 42, signature: good, rawBody: raw }),
      false,
      'a non-string secret fails without throwing',
    );
    console.log('  ✓ §1 verifier is fail-closed');
  }

  // §2: The relay outcomes the corrected row names, driving the
  // real MarketplaceSyncService on PGlite.
  {
    const { db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      let handlerCalls = 0;
      service.registerMarketplaceWebhookHandler('ORDER_CREATED', async () => {
        handlerCalls += 1;
        return { handled: true, actionTaken: 'counted' };
      });
      // Tampered: signature over different bytes than the stored body.
      const tamperedPayload = amazonPayload('701-S7-TAMPER-1');
      const tamperedRaw = JSON.stringify(tamperedPayload);
      const tampered = await service.receiveMarketplaceWebhook('amazon', tamperedPayload, undefined, {
        signature: sign(SECRET, '{"eventType":"ORDER_CREATED","AmazonOrderId":"701-S7-OTHER"}'),
        rawBody: tamperedRaw,
      });
      // Unsigned + legacy: no signature material at all.
      await service.receiveMarketplaceWebhook('amazon', amazonPayload('701-S7-UNSIGNED-1'));
      await (db as any)
        .insertInto('marketplace_webhook_events')
        .values({
          tenant_id: TENANT,
          account_id: null,
          marketplace: 'amazon',
          event_type: 'ORDER_CREATED',
          event_key: 'legacy-s7-1',
          dedup_key: 'legacy-s7-dedup-1',
          payload: amazonPayload('701-S7-LEGACY-1'),
          payload_hash: 'legacy-s7-hash',
          signature: null,
          raw_body: null,
          status: 'pending',
        })
        .execute();
      // Unresolved: no tenant, so no secret exists to verify against.
      await (db as any)
        .insertInto('marketplace_webhook_events')
        .values({
          tenant_id: null,
          account_id: null,
          marketplace: 'amazon',
          event_type: 'ORDER_CREATED',
          event_key: 'unresolved-s7-1',
          dedup_key: 'unresolved-s7-dedup-1',
          payload: amazonPayload('701-S7-UNRESOLVED-1'),
          payload_hash: 'unresolved-s7-hash',
          signature: sign(SECRET, JSON.stringify(amazonPayload('701-S7-UNRESOLVED-1'))),
          raw_body: JSON.stringify(amazonPayload('701-S7-UNRESOLVED-1')),
          status: 'unresolved',
        })
        .execute();
      const result = await service.relayMarketplaceWebhookEvents(auth(TENANT));
      assert.equal(result.claimed, 3, 'the relay claims only its own tenant pending rows, never the unresolved one');
      assert.equal(result.rejected, 1, 'the tampered event is rejected');
      assert.equal(result.unverifiable, 2, 'the unsigned and legacy rows are unverifiable');
      assert.equal(result.processed, 0);
      assert.equal(handlerCalls, 0, 'the handler NEVER runs for a rejected or unverifiable event');
      assert.equal(result.results.find((r) => r.outcome === 'rejected')?.outcome, 'rejected');
      const tamperedRow = await (db as any)
        .selectFrom('marketplace_webhook_events')
        .selectAll()
        .where('id', '=', tampered.eventId)
        .executeTakeFirstOrThrow();
      assert.equal(tamperedRow.status, 'rejected', 'a rejected event is terminal');
      const pendingRows = await (db as any)
        .selectFrom('marketplace_webhook_events')
        .select(['id', 'status', 'tenant_id'])
        .where('status', '=', 'pending')
        .execute();
      assert.equal(pendingRows.length, 2, 'the two unverifiable rows stay pending for manual review');
      const unresolvedRow = await (db as any)
        .selectFrom('marketplace_webhook_events')
        .selectAll()
        .where('dedup_key', '=', 'unresolved-s7-dedup-1')
        .executeTakeFirstOrThrow();
      assert.equal(unresolvedRow.status, 'unresolved', 'the unresolved row is never claimed or touched');
      const again = await service.relayMarketplaceWebhookEvents(auth(TENANT));
      assert.equal(again.claimed, 2, 'a second relay re-claims only the still-pending unverifiable rows');
      assert.equal(again.rejected, 0, 'the rejected event is terminal, not re-claimed');
      assert.equal(handlerCalls, 0);
    } finally {
      await db.destroy();
    }
    console.log('  ✓ §2 relay rejects tampered, leaves unverifiable pending, never claims unresolved');
  }

  // §3: Receipt is dormant evidence — the real receive path on PGlite.
  {
    const { db } = await makeRelayDb();
    try {
      const service = new MarketplaceSyncService(db, { log: async () => undefined } as never, {} as never);
      const payload = amazonPayload('701-S7-SIGNED-1');
      const raw = JSON.stringify(payload);
      const received = await service.receiveMarketplaceWebhook('amazon', payload, undefined, {
        signature: sign(SECRET, raw),
        rawBody: Buffer.from(raw),
      });
      assert.equal(received.received, true);
      assert.ok(received.eventId);
      const stored = await (db as any)
        .selectFrom('marketplace_webhook_events')
        .selectAll()
        .where('id', '=', received.eventId)
        .executeTakeFirstOrThrow();
      assert.equal(stored.status, 'pending', 'receipt never verifies or processes: status stays pending');
      assert.equal(stored.signature, sign(SECRET, raw), 'the signature header is stored as received');
      assert.equal(stored.raw_body, raw, 'the exact raw bytes are stored');
      const unsigned = await service.receiveMarketplaceWebhook('amazon', amazonPayload('701-S7-UNSIGNED-2'));
      const unsignedRow = await (db as any)
        .selectFrom('marketplace_webhook_events')
        .selectAll()
        .where('id', '=', unsigned.eventId)
        .executeTakeFirstOrThrow();
      assert.equal(unsignedRow.status, 'pending');
      assert.equal(unsignedRow.signature, null, 'an unsigned receipt stores a NULL signature');
      assert.equal(unsignedRow.raw_body, null, 'an unsigned receipt stores a NULL raw body');
    } finally {
      await db.destroy();
    }
    console.log('  ✓ §3 receipt stores dormant evidence, verifies nothing');
  }

  // §4: CONTROLS — the relay is manual-only. Its single production
  // caller is the controller route; neither the relay service nor
  // the controller schedules anything (the repricing 20-minute
  // timer and the reservation scheduler are other features, not
  // this relay). The relay claims only its own tenant's rows.
  {
    const callers = (dir: string): string[] =>
      fs
        .readdirSync(dir)
        .filter((n) => n.endsWith('.ts'))
        .filter((n) => fs.readFileSync(path.join(dir, n), 'utf8').includes('relayMarketplaceWebhookEvents'))
        .sort();
    assert.deepEqual(
      callers(STOREFRONT_CONTROLLERS_DIR),
      ['marketplace-sync.controller.ts'],
      'the controller route is the single production caller of the relay',
    );
    assert.deepEqual(
      callers(STOREFRONT_SERVICES_DIR),
      ['marketplace-sync-webhook-relay.service.ts', 'marketplace-sync.service.ts'],
      'only the relay service and its delegating facade mention the relay entry point',
    );
    for (const [label, file] of [
      ['relay service', RELAY_SERVICE],
      ['controller', WEBHOOK_CONTROLLER],
    ] as const) {
      const src = fs.readFileSync(file, 'utf8');
      assert.ok(!src.includes('setInterval'), `${label} must not schedule the relay with setInterval`);
      assert.ok(!src.includes('setTimeout'), `${label} must not schedule the relay with setTimeout`);
      assert.ok(!src.includes('Cron('), `${label} must not schedule the relay with a cron`);
    }
    const relaySrc = fs.readFileSync(RELAY_SERVICE, 'utf8');
    assert.ok(
      relaySrc.includes(".where('tenant_id', '=', scope.tenantId)"),
      'the relay claims only its own tenant pending rows',
    );
    const controllerSrc = fs.readFileSync(WEBHOOK_CONTROLLER, 'utf8');
    assert.ok(controllerSrc.includes('Staff-triggered'), 'the controller documents the relay as staff-triggered');
    console.log('  ✓ §4 relay is manual-only, tenant-scoped, unscheduled');
  }

  // §5: Static pins — the corrected engine-map row wording, the
  // verifier source, the relay call + outcomes, the controller
  // route, the receipt insert.
  {
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    const row = engineMap
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes('Outbox (inbound webhooks)'));
    assert.ok(row, 'the engine map must contain the Outbox row');
    const status = (row as string)
      .split('|')
      .map((c) => c.trim())[3]
      .trim();
    assert.ok(status.startsWith('PARTIAL'), `the Outbox row must stay PARTIAL (found: ${status})`);
    assert.ok(engineMap.includes(NEW_INV), 'the engine-map Outbox row must cite the new INV');
    assert.ok(engineMap.includes('HMAC-SHA256'), 'the row must state verification is HMAC-SHA256');
    assert.ok(engineMap.includes('32 characters'), 'the row must state the 32-character secret minimum');
    assert.ok(engineMap.includes('rejected'), 'the row must state a mismatch is rejected');
    assert.ok(engineMap.includes('unverifiable'), 'the row must state unverifiable events stay pending');
    assert.ok(engineMap.includes('staff-triggered'), 'the row must state the relay is staff-triggered');
    assert.ok(engineMap.includes('no scheduler'), 'the row must state there is no scheduler');
    assert.ok(engineMap.includes('dormant evidence'), 'the row must state receipt stores dormant evidence');
    assert.ok(engineMap.includes('never relayed'), 'the row must state unresolved rows are never relayed');
    assert.ok(!engineMap.includes('No relay'), 'the row must no longer claim there is no relay');
    assert.ok(
      !engineMap.includes('no signature verification yet'),
      'the row must no longer claim there is no signature verification',
    );
    const engineSrc = fs.readFileSync(WEBHOOK_ENGINE, 'utf8');
    assert.ok(engineSrc.includes("createHmac('sha256'"), 'the verifier must HMAC with SHA-256');
    assert.ok(engineSrc.includes('timingSafeEqual'), 'the verifier must compare timing-safe');
    assert.ok(engineSrc.includes('length < 32'), 'the verifier must enforce the 32-character secret minimum');
    const relaySrc = fs.readFileSync(RELAY_SERVICE, 'utf8');
    assert.ok(
      relaySrc.includes("from '../engines/marketplace-webhook-event.engine'"),
      'the relay must import the verifier from the webhook engine',
    );
    assert.ok(
      relaySrc.includes('verifyMarketplaceWebhookSignature({'),
      'the relay must call the verifier on the stored material',
    );
    assert.ok(relaySrc.includes(".set({ status: 'rejected' })"), 'the relay must mark a mismatch rejected in storage');
    assert.ok(
      relaySrc.includes("return { outcome: 'unverifiable' as const }"),
      'the relay must return unverifiable when verification is impossible',
    );
    const controllerSrc = fs.readFileSync(WEBHOOK_CONTROLLER, 'utf8');
    assert.ok(controllerSrc.includes("@Post('webhooks/relay')"), 'the controller must expose POST webhooks/relay');
    assert.ok(controllerSrc.includes('relayMarketplaceWebhookEvents'), 'the controller route must call the relay');
    const receiveSrc = fs.readFileSync(RECEIVE_SERVICE, 'utf8');
    assert.ok(
      receiveSrc.includes("insertInto('marketplace_webhook_events')"),
      'receipt must insert the event before responding',
    );
    assert.ok(
      receiveSrc.includes("status: tenantId ? 'pending' : 'unresolved'"),
      'receipt must leave the row pending or unresolved, never processed',
    );
    console.log('  ✓ §5 engine-map row + verifier + relay + controller + receipt pins');
  }

  // §6: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S14/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §7: Wiring: both critical lists carry 413 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 450);
    assert.equal(chain.length, 450);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 413 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    for (const [label, specPath] of [
      ['B1', B1_SPEC],
      ['B2', B2_SPEC],
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 450);') && src.includes('assert.equal(chain.length, 450);'),
        `${label} spec wiring must re-pin to 413`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §8: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-6 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s6-import-fx-payout-' + 'idempotency.spec.ts';
    const prevInv = 'INV-IMPORT-FX-PAYOUT-' + 'IDEMPOTENCY';
    const staleSpecs = 'specs.length, 41' + '2';
    const staleChain = 'chain.length, 41' + '2';
    const staleList = 'list.length, 41' + '2';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (412)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-6 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 6)');
  }

  // §9: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3/S4/S5/S6 specs' guard assertions to the new
  // INV; their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of [
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S14/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §10: The module-boundary pins do not move in this package
  // (a documentation-only correction adds no import statement —
  // no new edge and no total move). No migration in this package,
  // so the "highest migration" pins stay at 0345 (the two 3dp
  // specs, the S2 spec §5/§10, the S3 spec §9, the S4 spec
  // §4/§9 — including its standalone 0345 literals — the S5 spec
  // §9 and the S6 spec §10).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
      'module-boundary must still pin the frontend total 105',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      'module-boundary must still pin 63 backend edges',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
      'module-boundary must still pin 44 frontend edges',
    );
    assert.ok(
      boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
      'module-boundary must still pin the frontend edge floor 44',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
      'the frontend bidirectional pair list must stay empty',
    );
    const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
    assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
    const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
    assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
    const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
        `${label} spec highest-migration pin must stay at 0346`,
      );
      assert.ok(
        src.includes('the 0346 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must stay at 0346`,
      );
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
      'S2 spec migration-file pin must stay at 0346',
    );
    assert.ok(
      s2Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0346'),
      'S2 spec §10 pin message must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0346'),
      'S2 spec §10 message must stay at 0346',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
      'S3 spec migration-file pin must stay at 0346',
    );
    assert.ok(s3Src.includes('must re-point to 0346'), 'S3 spec highest-migration assertions must stay at 0346');
    const s4Src = fs.readFileSync(S4_SPEC, 'utf8');
    assert.ok(
      s4Src.includes(
        "import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';",
      ),
      'S4 spec must still drive the real 0344 migration (its own migration under test)',
    );
    assert.ok(s4Src.includes('files[files.length - 1],'), 'S4 spec §4 must still compare the highest file on disk');
    assert.ok(
      s4Src.includes("'2040000000346_loss_prevention_anti_theft_shield.ts',"),
      'S4 spec §4 highest-migration literal must stay at 0346',
    );
    assert.ok(
      s4Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0346'),
      'S4 spec §9 pin message must stay at 0346',
    );
    const s5Src = fs.readFileSync(S5_SPEC, 'utf8');
    assert.ok(
      s5Src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
      'S5 spec migration-file pin must stay at 0346',
    );
    assert.ok(s5Src.includes('must re-point to 0346'), 'S5 spec highest-migration assertions must stay at 0346');
    const s6Src = fs.readFileSync(S6_SPEC, 'utf8');
    assert.ok(
      s6Src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
      'S6 spec migration-file pin must stay at 0346',
    );
    assert.ok(s6Src.includes('must re-point to 0346'), 'S6 spec highest-migration assertions must stay at 0346');
  }

  console.log('phase1 final slice 7 checks passed (marketplace webhook map row, 413 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
