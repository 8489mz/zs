import { strict as assert } from 'node:assert';
import {
  isReservationExpired,
  extractReservationItems,
  DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS,
  DEFAULT_COD_STALE_TIMEOUT_MS,
  OrderReservationCandidate,
} from '../../src/modules/storefront/engines/storefront-reservation.engine';

/**
 * Critical tests for Storefront stock reservation reaper and failure compensation (Phase 6).
 *
 * Invariants:
 * 1. An online order abandoned or unpaid past its timeout window MUST be
 *    declared expired — whether or not it reserved stock.
 * 2. Paid orders, converted sales, and orders already in preparation MUST NEVER be auto-reaped.
 * 3. Items extraction from JSON payloads must be resilient against corruption or missing fields.
 *
 * D-SF-12 / INV-SF-REAPER-UNRESERVED-EXPIRY: the old invariant 1 required
 * stock_reserved = true. That was WRONG: placement stores stock_reserved =
 * false (stock_reserved_at NULL) whenever the storefront setting "allow
 * ordering without stock" is ON, so every such order was invisible to the
 * reaper and abandoned unpaid orders sat pending forever (live: heartbeat
 * scannedCount 0 while four orders were past threshold on test10k). The
 * reaper's job — cancel abandoned unpaid orders — is independent of
 * whether stock was reserved; only the stock RELEASE is reservation-gated.
 * An unreserved order therefore expires by the same clock from created_at
 * (stock_reserved_at is NULL for it, so the engine's fallback is created_at),
 * same thresholds: online 30 min, COD 24 h. The old "never expire" pin
 * below is REVERSED, not kept.
 */

function testUnreservedOrdersExpireByCreatedAt(): void {
  const now = new Date('2026-10-03T12:00:00Z');
  const oldDate = new Date('2026-10-01T12:00:00Z');
  const recentDate = new Date('2026-10-03T11:50:00Z');

  // Unreserved + expired by created_at (2 days old, online method) -> expired.
  // Placement stores stock_reserved_at NULL for unreserved orders, so the
  // clock is created_at.
  const notReservedExpired: OrderReservationCandidate = {
    id: 1,
    stock_reserved: false,
    status: 'pending',
    payment_method: 'card',
    payment_status: 'pending',
    stock_reserved_at: null,
    created_at: oldDate,
  };
  assert.equal(isReservationExpired(notReservedExpired, now), true, 'Unreserved order past the 30-min window must expire by created_at');

  // stock_reserved NULL behaves the same as false.
  const nullReservedExpired: OrderReservationCandidate = {
    id: 2,
    stock_reserved: null,
    status: 'pending',
    payment_method: 'card',
    payment_status: 'pending',
    stock_reserved_at: null,
    created_at: oldDate,
  };
  assert.equal(isReservationExpired(nullReservedExpired, now), true, 'Order with null stock_reserved past the window must expire by created_at');

  // Unreserved + inside the window (10 min old) -> NOT expired.
  const notReservedRecent: OrderReservationCandidate = {
    id: 12,
    stock_reserved: false,
    status: 'pending',
    payment_method: 'card',
    payment_status: 'pending',
    stock_reserved_at: null,
    created_at: recentDate,
  };
  assert.equal(isReservationExpired(notReservedRecent, now), false, 'Unreserved order inside the 30-min window must not expire');

  console.log('  -> Unreserved orders expire by created_at, same thresholds as reserved ones.');
}

function testPaidOrConvertedOrdersNeverExpire(): void {
  const now = new Date('2026-10-03T12:00:00Z');
  const oldDate = new Date('2026-10-01T12:00:00Z');

  const paidOrder: OrderReservationCandidate = {
    id: 3,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'paymob',
    payment_status: 'paid',
    stock_reserved_at: oldDate,
  };
  assert.equal(isReservationExpired(paidOrder, now), false, 'Paid orders must NEVER be reaped even if old');

  const convertedOrder: OrderReservationCandidate = {
    id: 4,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'card',
    payment_status: 'pending',
    sale_id: 105,
    stock_reserved_at: oldDate,
  };
  assert.equal(isReservationExpired(convertedOrder, now), false, 'Orders converted to formal sales must NEVER be reaped');

  const processingOrder: OrderReservationCandidate = {
    id: 5,
    stock_reserved: true,
    status: 'processing',
    payment_method: 'card',
    payment_status: 'pending',
    stock_reserved_at: oldDate,
  };
  assert.equal(isReservationExpired(processingOrder, now), false, 'Orders being prepared (processing) must NEVER be auto-cancelled');

  console.log('  -> Paid, converted, and in-progress orders are safely protected from reaping.');
}

function testOnlinePaymentTimeoutWindow(): void {
  const baseTime = new Date('2026-10-03T12:00:00Z').getTime();

  // 10 minutes ago (< 30 min) -> Not expired
  const recentOrder: OrderReservationCandidate = {
    id: 6,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'card',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - 10 * 60 * 1000),
  };
  assert.equal(isReservationExpired(recentOrder, new Date(baseTime)), false, 'Recent order within 10m must not expire');

  // Exactly 29m 59s ago -> Not expired
  const boundaryNotExpired: OrderReservationCandidate = {
    id: 7,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'paymob',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - (DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS - 1000)),
  };
  assert.equal(isReservationExpired(boundaryNotExpired, new Date(baseTime)), false, 'Order at 29m59s must not expire');

  // Exactly 30m 00s ago -> Expired
  const boundaryExpired: OrderReservationCandidate = {
    id: 8,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'stripe',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS),
  };
  assert.equal(isReservationExpired(boundaryExpired, new Date(baseTime)), true, 'Order at 30m00s must expire');

  // 45 minutes ago -> Expired
  const staleOrder: OrderReservationCandidate = {
    id: 9,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'tap',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - 45 * 60 * 1000),
  };
  assert.equal(isReservationExpired(staleOrder, new Date(baseTime)), true, 'Order past 30m window must expire');

  console.log('  -> Online payment 30-minute timeout boundary behaves strictly.');
}

function testCodStaleTimeoutWindow(): void {
  const baseTime = new Date('2026-10-03T12:00:00Z').getTime();

  // COD order 2 hours ago -> Not expired (COD orders give customer longer margin)
  const codRecent: OrderReservationCandidate = {
    id: 10,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'cod',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - 2 * 60 * 60 * 1000),
  };
  assert.equal(isReservationExpired(codRecent, new Date(baseTime)), false, 'COD order within 2 hours must not expire');

  // COD order 25 hours ago -> Expired (past 24h stale window)
  const codStale: OrderReservationCandidate = {
    id: 11,
    stock_reserved: true,
    status: 'pending',
    payment_method: 'cod',
    payment_status: 'pending',
    stock_reserved_at: new Date(baseTime - (DEFAULT_COD_STALE_TIMEOUT_MS + 60 * 1000)),
  };
  assert.equal(isReservationExpired(codStale, new Date(baseTime)), true, 'COD order older than 24h must expire');

  console.log('  -> COD 24-hour stale order timeout window verified.');
}

function testReservationItemsExtraction(): void {
  // 1. JSON string with valid items
  const jsonRaw = JSON.stringify([
    { productId: 101, quantity: 3, unitPrice: 50, name: 'Product A' },
    { productId: 102, quantity: 1, unitPrice: 120, name: 'Product B' },
    { productId: 0, quantity: 5 }, // Invalid productId -> skipped
    { productId: 103, quantity: 0 }, // Invalid quantity -> skipped
  ]);

  const extracted = extractReservationItems(jsonRaw);
  assert.equal(extracted.length, 2, 'Should extract only valid items with id > 0 and qty > 0');
  assert.equal(extracted[0].productId, 101);
  assert.equal(extracted[0].quantity, 3);
  assert.equal(extracted[1].productId, 102);
  assert.equal(extracted[1].quantity, 1);

  // 2. Corrupt string -> returns empty array without throwing
  assert.deepEqual(extractReservationItems('INVALID_JSON{{{'), []);

  // 3. Null / undefined / non-array -> returns empty array
  assert.deepEqual(extractReservationItems(null), []);
  assert.deepEqual(extractReservationItems(undefined), []);
  assert.deepEqual(extractReservationItems({ not: 'an array' }), []);

  console.log('  -> extractReservationItems is robust against corrupt input.');
}

async function main(): Promise<void> {
  console.log('=== [PHASE 6] STOREFRONT STOCK RESERVATION REAPER & HARDENING ===\n');

  console.log('[Test 1] Unreserved orders expire by created_at (reversed pin)');
  testUnreservedOrdersExpireByCreatedAt();

  console.log('[Test 2] Paid or converted orders never expire');
  testPaidOrConvertedOrdersNeverExpire();

  console.log('[Test 3] Online payment 30-minute timeout boundary');
  testOnlinePaymentTimeoutWindow();

  console.log('[Test 4] COD stale order timeout window');
  testCodStaleTimeoutWindow();

  console.log('[Test 5] Line items extraction resilience');
  testReservationItemsExtraction();

  console.log('\n=== ALL STOREFRONT REAPER TESTS PASSED (5/5) ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
