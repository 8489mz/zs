/**
 * MarketplaceSyncWebhooksReceiveService — slice S10 of the marketplace-sync split.
 * Pure move of 4 methods from MarketplaceSyncService (inbound webhook
 * receipt: the public receiver, the durable store, tenant-candidate
 * loading, staff review of stored events). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures. Deps: db only (the store/inbox queries run
 * on the facade's db via line-broken chains). NO kernel deps — the span
 * calls neither setting helper (prep section 3's receive-only note is
 * wrong, ground-proven). NO audit dep. The slice declares its own Logger
 * (the receipt method logs once; prep section 4 is wrong for this slice,
 * same class as S3/S4/S7). Types come from ./marketplace-sync.types (S0).
 * Clock: no date sites in this span; no instant comparison, no UTC
 * normalizer. The handle/receive/load chain is all in-slice, so there
 * is no cross-slice dep.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  extractMarketplaceEventIdentity,
  marketplaceWebhookDedupKey,
  matchMarketplaceTenant,
  type MarketplaceTenantCandidate,
} from '../engines/marketplace-webhook-event.engine';
import type { MarketplaceWebhookReceiptOpts, SupportedMarketplace } from './marketplace-sync.types';

export interface MarketplaceSyncWebhooksReceiveDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MarketplaceSyncWebhooksReceiveService {
  private readonly logger = new Logger(MarketplaceSyncWebhooksReceiveService.name);
  private readonly db: Kysely<Database>;

  constructor(deps: MarketplaceSyncWebhooksReceiveDeps) {
    this.db = deps.db;
  }

  // =========================================================================
  // PUBLIC WEBHOOK RECEIVER ("مستقبل إشعارات الويب هوك اللحظي")
  // =========================================================================

  /**
   * Inbound webhook persistence (INV-MARKETPLACE-WEBHOOK-PERSISTENCE).
   *
   * The old handler logged the payload and returned 200 without writing
   * any row -- and its reply strings claimed stock was updated and the
   * repricing bot ran, neither of which ever happened. This version
   * stores the raw payload FIRST (insert with ON CONFLICT DO NOTHING on
   * the dedup key) and only then returns 200. A duplicate redelivery
   * returns the stored row instead of a second row. An insert failure
   * propagates, so the gateway gets a 5xx and retries -- a 200 is never
   * returned for an event that was not durably stored.
   *
   * Rows are inert evidence at receipt: NOTHING processes them here
   * (no order, no stock movement, no repricing). The signature header
   * and the exact raw request bytes are captured alongside the payload
   * (INV-MARKETPLACE-OUTBOX-RELAY, migration 0298) so the relay can
   * verify HMAC-SHA256 over the bytes the gateway actually signed;
   * receipt statuses stay 'pending' / 'unresolved' and no event is
   * ever processed at receipt time. Staff review the stored rows
   * through listMarketplaceWebhookEvents and trigger the relay.
   *
   * Tenant resolution, in order: (1) a seller identifier in the payload
   * matching exactly one tenant's enabled config for this marketplace;
   * (2) the session tenant hint from the guarded route, when the payload
   * carries no matching seller id; (3) unresolved (NULL tenant). A
   * seller id matching two tenants is ambiguous and resolves to
   * unresolved -- never attributed to the wrong tenant.
   */
  async handleMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    return this.receiveMarketplaceWebhook(marketplace, payload, sessionTenantId, opts);
  }

  async receiveMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    this.logger.log(`[Marketplace Webhook] Received webhook event for ${marketplace}`);
    const identity = extractMarketplaceEventIdentity(payload ?? {});
    const candidates = await this.loadMarketplaceTenantCandidates(marketplace);
    const payloadTenantId = matchMarketplaceTenant(candidates, identity.sellerIds);
    const tenantId = payloadTenantId ?? (identity.sellerIds.length === 0 ? (sessionTenantId ?? null) : null);
    const dedupKey = marketplaceWebhookDedupKey(marketplace, identity);

    const inserted = await this.db
      .insertInto('marketplace_webhook_events')
      .values({
        tenant_id: tenantId,
        account_id: null,
        marketplace,
        event_type: identity.eventType,
        event_key: identity.eventKey,
        dedup_key: dedupKey,
        payload: payload ?? {},
        payload_hash: identity.payloadHash,
        signature: opts?.signature ?? null,
        raw_body:
          opts?.rawBody === undefined
            ? null
            : Buffer.isBuffer(opts.rawBody)
              ? opts.rawBody.toString('utf8')
              : opts.rawBody,
        status: tenantId ? 'pending' : 'unresolved',
      })
      .onConflict((oc) => oc.column('dedup_key').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (!inserted) {
      const existing = await this.db
        .selectFrom('marketplace_webhook_events')
        .select(['id'])
        .where('dedup_key', '=', dedupKey)
        .executeTakeFirst();
      return {
        received: true,
        duplicate: true,
        eventId: existing?.id ?? null,
        actionTaken: 'تم استلام هذا الإشعار من قبل، وهو محفوظ بالفعل وسيتم مراجعته',
      };
    }

    return {
      received: true,
      duplicate: false,
      eventId: inserted.id,
      actionTaken: tenantId
        ? 'تم حفظ إشعار الويب هوك وسيتم مراجعته قبل أي معالجة'
        : 'تم حفظ إشعار الويب هوك بدون تحديد التاجر، وسيتم مراجعته يدويا',
    };
  }

  private async loadMarketplaceTenantCandidates(
    marketplace: SupportedMarketplace,
  ): Promise<MarketplaceTenantCandidate[]> {
    const keyByMarketplace: Record<SupportedMarketplace, string> = {
      amazon: 'marketplace_amazon_config',
      noon: 'marketplace_noon_config',
      jumia: 'marketplace_jumia_config',
      trendyol: 'marketplace_trendyol_config',
    };
    const sellerKeyByMarketplace: Record<SupportedMarketplace, string> = {
      amazon: 'sellerId',
      noon: 'merchantId',
      jumia: 'sellerEmail',
      trendyol: 'supplierId',
    };
    const rows = await this.db
      .selectFrom('settings')
      .select(['tenant_id', 'value'])
      .where('key', '=', keyByMarketplace[marketplace])
      .execute();
    const candidates: MarketplaceTenantCandidate[] = [];
    for (const row of rows) {
      try {
        const cfg = JSON.parse(String(row.value)) as Record<string, unknown>;
        if (cfg.enabled !== true) continue;
        const sellerId = cfg[sellerKeyByMarketplace[marketplace]];
        if (typeof sellerId !== 'string' || !sellerId.trim()) continue;
        candidates.push({ tenantId: row.tenant_id, sellerIds: [sellerId.trim()] });
      } catch {
        // A corrupt config row must never break webhook receipt: the
        // event is still stored (unresolved) by the caller.
        continue;
      }
    }
    return candidates;
  }

  /** Staff review of stored webhook events. Tenant-scoped, read-only. */
  async listMarketplaceWebhookEvents(
    auth: AuthContext,
    filters: { marketplace?: SupportedMarketplace; status?: string; limit?: number },
  ): Promise<
    Array<{
      id: number;
      marketplace: string;
      eventType: string;
      eventKey: string;
      status: string;
      receivedAt: Date;
      processedAt: Date | null;
      payload: unknown;
    }>
  > {
    const scope = requireTenantScope(auth);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 50);
    let query = this.db
      .selectFrom('marketplace_webhook_events')
      .select(['id', 'marketplace', 'event_type', 'event_key', 'status', 'received_at', 'processed_at', 'payload'])
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('received_at', 'desc')
      .limit(limit);
    if (filters.marketplace) query = query.where('marketplace', '=', filters.marketplace);
    if (filters.status) query = query.where('status', '=', filters.status);
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      marketplace: row.marketplace,
      eventType: row.event_type,
      eventKey: row.event_key,
      status: row.status,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      payload: row.payload,
    }));
  }
}
