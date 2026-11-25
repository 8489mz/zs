/**
 * MarketplaceSyncWebhookRelayService — slice S11 of the marketplace-sync split.
 * Pure move of 3 methods from MarketplaceSyncService (handler registry +
 * the staff-triggered relay of stored inbound events to their handlers).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures. The handler
 * registry field moves here with its doc block (it is only touched by
 * these 3 methods). Deps: db (the candidate query + the per-event
 * transaction opener) + the bound setting-read helper (used once, in
 * the relay, with the transaction handle passed as executor). NO audit
 * dep. The slice declares its own Logger (the relay logs once, in the
 * per-event catch; prep section 4 is wrong for this slice, same class
 * as S3/S4/S7/S10). Types come from ./marketplace-sync.types (S0).
 * Clock: one date site in the relay (the processed stamp, inside the
 * transaction); no instant comparison, no UTC normalizer. The relay
 * transaction stays threaded on its own handle.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { verifyMarketplaceWebhookSignature } from '../engines/marketplace-webhook-event.engine';
import type {
  MarketplaceWebhookHandler,
  MarketplaceWebhookRelayResult,
  StoredMarketplaceWebhookEvent,
  SupportedMarketplace,
} from './marketplace-sync.types';

export interface MarketplaceSyncWebhookRelayDeps {
  db: Kysely<Database>;
  // Bound kernel helper (same name as the facade member, so the moved
  // body is byte-identical). getSettingJson stays in the facade forever
  // (kernel). setSettingJson is NOT used in this span (ground-proven).
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
}

@Injectable()
export class MarketplaceSyncWebhookRelayService {
  /**
   * Webhook handler registry (INV-MARKETPLACE-OUTBOX-RELAY). The relay
   * dispatches verified stored events to the handler registered for
   * their event type; no handler is registered in production yet --
   * there is no order-ingestion handler to register (see the relay
   * docs below), so verified events wait as 'pending' until one
   * exists. Handlers run inside the relay's per-event transaction on
   * its handle: a handler throw rolls the event back to 'pending'
   * (retryable) instead of marking it processed.
   */
  private readonly marketplaceWebhookHandlers = new Map<string, MarketplaceWebhookHandler>();
  private readonly logger = new Logger(MarketplaceSyncWebhookRelayService.name);
  private readonly db: Kysely<Database>;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;

  constructor(deps: MarketplaceSyncWebhookRelayDeps) {
    this.db = deps.db;
    this.getSettingJson = deps.getSettingJson;
  }

  // =========================================================================
  // MARKETPLACE WEBHOOK OUTBOX RELAY (INV-MARKETPLACE-OUTBOX-RELAY)
  // =========================================================================

  /**
   * Register a handler for one marketplace event type. Handlers are
   * the relay's dispatch targets; registration is explicit and
   * per-event-type so an unhandled type can never be silently
   * "processed". Production registers ZERO handlers today: there is
   * no order-ingestion handler to register (the only ingestion path,
   * `simulateIncomingOrder`, fabricates a test order and is not a
   * webhook handler), and inventing one here -- guessed
   * per-marketplace payload schemas plus real-money order/stock
   * creation from unauthenticated public payloads -- would violate
   * the strict-money spirit of the law. The order-ingestion handler
   * is a recorded follow-up needing a policy decision; until it
   * exists, verified events report `skipped-no-handler` and stay
   * 'pending' for staff review. The spec registers a counting test
   * handler to prove the relay machinery.
   */
  registerMarketplaceWebhookHandler(eventType: string, handler: MarketplaceWebhookHandler): void {
    this.marketplaceWebhookHandlers.set(eventType, handler);
  }

  unregisterMarketplaceWebhookHandler(eventType: string): void {
    this.marketplaceWebhookHandlers.delete(eventType);
  }

  /**
   * Relay stored inbound marketplace webhook events to their
   * handlers. Staff-triggered (guarded `POST webhooks/relay`), never
   * automatic: an unsigned public payload must never self-execute.
   *
   * Per event, in ONE transaction: the row is re-read `FOR UPDATE`
   * (a concurrent relay blocks on the lock, then sees the new status
   * and skips -- exactly-once), the stored signature is verified
   * against the tenant's CURRENT per-marketplace `webhookSecret`
   * (HMAC-SHA256 over the stored raw bytes), and only then is the
   * registered handler invoked on the same transaction handle; the
   * event is marked 'processed' with `processed_at` in that same
   * transaction, so a handler's writes and its processed mark commit
   * or roll back together.
   *
   * Outcomes, all loud, nothing silently dropped:
   * - `processed`: verified and handled; a second relay is a no-op.
   * - `rejected`: secret, signature and raw body were all present
   *   but the HMAC mismatched -- proven forgery/tampering. The event
   *   is NEVER dispatched. Terminal.
   * - `unverifiable`: the secret is missing/short, or the signature
   *   or raw body was never captured (e.g. a legacy row stored
   *   before migration 0298). Verification is impossible, so the
   *   event stays 'pending' for manual staff review -- fail-closed,
   *   never guessed. (A secret rotated after receipt also lands
   *   here only when the old secret is gone; a present-but-wrong
   *   secret lands in `rejected`.)
   * - `skipped-no-handler`: verified, but no handler is registered
   *   for the event type yet. Stays 'pending'.
   * - `failed`: the handler threw. The transaction rolls back, the
   *   event stays 'pending' (retryable), the batch continues.
   * - `skipped`: the row was already processed (or foreign) by the
   *   time its transaction ran -- a concurrent relay claimed it.
   *
   * Only 'pending' rows for the caller's tenant are claimed, oldest
   * first, at most 50 per call. 'unresolved' rows (no tenant) have
   * no secret to verify against and are never relayed.
   */
  async relayMarketplaceWebhookEvents(
    auth: AuthContext,
    filters: { limit?: number } = {},
  ): Promise<MarketplaceWebhookRelayResult> {
    const scope = requireTenantScope(auth);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 50);
    const candidates = await this.db
      .selectFrom('marketplace_webhook_events')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'pending')
      .orderBy('received_at', 'asc')
      .limit(limit)
      .execute();

    const result: MarketplaceWebhookRelayResult = {
      claimed: candidates.length,
      processed: 0,
      rejected: 0,
      skippedNoHandler: 0,
      unverifiable: 0,
      failed: 0,
      results: [],
    };

    for (const candidate of candidates) {
      try {
        const outcome = await this.db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('marketplace_webhook_events')
            .selectAll()
            .where('id', '=', candidate.id)
            .forUpdate()
            .executeTakeFirst();
          if (!row || row.status !== 'pending' || row.tenant_id !== scope.tenantId) {
            return { outcome: 'skipped' as const };
          }
          const config = await this.getSettingJson<Record<string, unknown>>(
            `marketplace_${row.marketplace}_config`,
            row.tenant_id,
            {},
            trx,
          );
          const secret = typeof config.webhookSecret === 'string' ? config.webhookSecret : undefined;
          if (!secret || secret.length < 32 || !row.signature || !row.raw_body) {
            return { outcome: 'unverifiable' as const };
          }
          if (
            !verifyMarketplaceWebhookSignature({
              secret,
              signature: row.signature,
              rawBody: row.raw_body,
            })
          ) {
            await trx
              .updateTable('marketplace_webhook_events')
              .set({ status: 'rejected' })
              .where('id', '=', row.id)
              .execute();
            return { outcome: 'rejected' as const };
          }
          const handler = this.marketplaceWebhookHandlers.get(row.event_type);
          if (!handler) {
            return { outcome: 'skipped-no-handler' as const };
          }
          const event: StoredMarketplaceWebhookEvent = {
            id: row.id,
            tenantId: row.tenant_id as string,
            marketplace: row.marketplace as SupportedMarketplace,
            eventType: row.event_type,
            eventKey: row.event_key,
            status: row.status,
            receivedAt: row.received_at,
            payload: row.payload,
          };
          const handled = await handler(trx, event);
          if (!handled.handled) {
            return { outcome: 'skipped-no-handler' as const };
          }
          await trx
            .updateTable('marketplace_webhook_events')
            .set({ status: 'processed', processed_at: new Date() })
            .where('id', '=', row.id)
            .execute();
          return { outcome: 'processed' as const, actionTaken: handled.actionTaken };
        });
        if (outcome.outcome === 'processed') result.processed += 1;
        if (outcome.outcome === 'rejected') result.rejected += 1;
        if (outcome.outcome === 'skipped-no-handler') result.skippedNoHandler += 1;
        if (outcome.outcome === 'unverifiable') result.unverifiable += 1;
        result.results.push({ eventId: candidate.id, ...outcome });
      } catch (err) {
        // The per-event transaction rolled back: the event stays
        // 'pending' and retryable; the batch continues.
        result.failed += 1;
        result.results.push({
          eventId: candidate.id,
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(`[Marketplace Webhook Relay] Event ${candidate.id} failed`, err);
      }
    }
    return result;
  }
}
