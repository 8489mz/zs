/**
 * Pure decision engine for inbound marketplace webhook events.
 *
 * Why this is a gate and not a lookup detail:
 * `POST /webhooks/:marketplace` is public and unauthenticated by design
 * (marketplace gateways cannot hold a staff session), so the service must
 * decide, from the payload alone, (a) what event this is, (b) which tenant
 * it belongs to, and (c) the dedup key under which it is stored. The
 * previous handler answered 200 after only logging the payload -- an
 * ACK-and-dropped webhook: the gateway never retries a 200, so the order
 * notification was gone with only a log line as evidence.
 *
 * Invariant INV-MARKETPLACE-WEBHOOK-PERSISTENCE: a 200 response is only
 * ever returned AFTER the raw payload is durably stored (insert with
 * ON CONFLICT DO NOTHING on the dedup key). A duplicate redelivery
 * returns the already-stored row instead of a second row. An insert
 * failure propagates (5xx) so the gateway retries -- never a silent 200.
 *
 * Kept pure (no db, no I/O) so the critical test imports the same
 * functions the service runs -- a duplicated copy inside the test would
 * guard nothing. Mirrors the WH-1 precedent in
 * `webhook-order-resolution.engine.ts`.
 */
import { createHash } from 'crypto';

/** Stable JSON: object keys sorted recursively, so key order in the
 *  delivered payload cannot change the dedup key. Mirrors JSON.stringify
 *  for undefined/function/symbol values (dropped from objects, null in
 *  arrays) and non-finite numbers (null). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function' && typeof v !== 'symbol')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const SELLER_ID_KEYS = [
  'sellerId',
  'SellerId',
  'seller_id',
  'merchantId',
  'MerchantId',
  'merchant_id',
  'supplierId',
  'SupplierId',
  'supplier_id',
  'sellerEmail',
  'seller_email',
] as const;

const EVENT_TYPE_KEYS = ['eventType', 'NotificationType', 'notification_type', 'type'] as const;

const EVENT_KEY_KEYS = [
  'NotificationId',
  'notificationId',
  'notification_id',
  'eventId',
  'event_id',
  'messageId',
  'AmazonOrderId',
  'order_number',
] as const;

function stringField(payload: Record<string, unknown>, keys: readonly string[]): string | '' {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function nestedPayload(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  const nested: Record<string, unknown>[] = [root];
  for (const key of ['notification', 'Notification', 'data', 'payload']) {
    const child = root[key];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      nested.push(child as Record<string, unknown>);
    }
  }
  return nested;
}

export interface MarketplaceWebhookEventIdentity {
  eventType: string;
  /** External event/order identifier when the payload carries one, else ''. */
  eventKey: string;
  /** Every seller/merchant/supplier identifier found in the payload. */
  sellerIds: string[];
  /** sha256 of the canonical payload JSON. */
  payloadHash: string;
}

export function extractMarketplaceEventIdentity(
  payload: unknown,
): MarketplaceWebhookEventIdentity {
  const layers = nestedPayload(payload);
  const flat: Record<string, unknown> = {};
  for (const layer of layers) Object.assign(flat, layer);
  const eventType = stringField(flat, EVENT_TYPE_KEYS) || 'UNKNOWN';
  const eventKey = stringField(flat, EVENT_KEY_KEYS);
  const sellerIds = [...new Set(layers.flatMap((layer) => SELLER_ID_KEYS.map((k) => layer[k]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())))];
  return { eventType, eventKey, sellerIds, payloadHash: sha256Hex(canonicalJson(payload)) };
}

/**
 * Dedup key. The seller scope is the first seller id found in the
 * payload, or 'unresolved' when the payload carries none: two tenants
 * can never share a seller id, so scoping by seller id keeps their
 * identical-looking events distinct, and unresolved events dedup only
 * against other unresolved events with the same external key or hash.
 * An external event key wins over the content hash, so a gateway that
 * re-serializes the same event (different whitespace/key order) still
 * dedups; the hash covers payloads with no external key at all.
 */
export function marketplaceWebhookDedupKey(
  marketplace: string,
  identity: MarketplaceWebhookEventIdentity,
): string {
  const scope = identity.sellerIds[0] ?? 'unresolved';
  const key = identity.eventKey || identity.payloadHash;
  return `${marketplace}:${scope}:${key}`;
}

export interface MarketplaceTenantCandidate {
  tenantId: string;
  /** Seller/merchant/supplier identifiers from the tenant's enabled config. */
  sellerIds: string[];
}

/**
 * Tenant match: exactly one candidate sharing any seller id wins. Zero
 * matches and ambiguous matches (the same seller id configured under two
 * tenants) both resolve to null -- the event is stored UNRESOLVED and
 * must never be attributed to the wrong tenant. Fail-closed, mirroring
 * the WH-1 exact-one rule for public payment webhooks.
 */
export function matchMarketplaceTenant(
  candidates: MarketplaceTenantCandidate[],
  sellerIds: string[],
): string | null {
  const wanted = new Set(sellerIds);
  if (!wanted.size) return null;
  const matched = candidates.filter((c) => c.sellerIds.some((id) => wanted.has(id)));
  if (matched.length !== 1) return null;
  return matched[0].tenantId;
}
