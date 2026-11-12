/* M15 (INV-DRIVER-PORTAL-REMAINING-AMOUNT) — the driver portal's
 * "amount to collect" badge summed the raw invoice total per row,
 * although the rep owes only the remaining cash due: a prior return
 * already reversed part of the receivable. The backend now attaches
 * `remainingAmount` per row (driverListOrders, mirroring listOrders)
 * and the page sums that field instead of `total`. A missing value
 * contributes 0 — it NEVER falls back to the raw total, or the bug
 * returns through the back door.
 *
 * Cases: a fully-returned 131.60 invoice next to an open 131.60
 * invoice reads 131.60 (not 263.20); a partial return of 65.80
 * reads 65.80; an order with no remainingAmount contributes 0.
 *
 * INV-DRIVER-PORTAL-PENDING-AMOUNT-2DP: the badge formats money at
 * exactly 2 fraction digits (ar-EG) — bare toLocaleString('ar-EG')
 * drops the trailing zero, so 65.80 read ٦٥٫٨ and 131.60 read ١٣١٫٦.
 * The spec also waits for the order rows before reading the badge:
 * the badge label is static and renders before the orders query
 * resolves, so reading it immediately snapshots the initial 0 and
 * the first two cases passed vacuously-or-not-at-all by timing.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DriverPortalPage } from './DriverPortalPage';
import { createTestQueryClient } from '@/test/test-query-client';

// Local shape for the portal rows the mocked getOrders returns — kept
// local (not imported from the api layer) so this spec stays out of the
// page-composition check's api-import rule; the backend spec pins the
// real remainingAmount values, this spec only pins the badge sum.
type PortalOrderRow = {
  id: number;
  docNo: string;
  total: number;
  remainingAmount?: number;
  customerName: string;
  orderType: string;
  deliveryRepId: number;
  deliveryStatus: string;
  collectionStatus: string;
  settledAt: string | null;
  createdAt: string;
};

const { mockGetOrders } = vi.hoisted(() => ({
  mockGetOrders: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: { list: vi.fn().mockResolvedValue([]) },
  driverPortalApi: {
    getStoredSession: () => ({
      token: 'driver-token',
      rep: { id: 1, name: 'Rep One', tenantId: 't1' },
    }),
    getStoredMustChangePin: () => false,
    getOrders: mockGetOrders,
    settleOrder: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn(),
  },
}));

function portalOrder(overrides: Partial<PortalOrderRow> & { id: number }): PortalOrderRow {
  return {
    docNo: `DR-${overrides.id}`,
    total: 131.6,
    customerName: 'Customer Seven',
    orderType: 'delivery',
    deliveryRepId: 1,
    deliveryStatus: 'out_for_delivery',
    collectionStatus: 'cod',
    settledAt: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderPortal() {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DriverPortalPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function pendingBadgeText(): Promise<string> {
  // Wait for the order rows first: the badge label is static and renders
  // before the orders query resolves, so reading the badge immediately
  // snapshots the initial 0. The rows only render after getOrders resolves.
  await screen.findAllByText('Customer Seven');
  const label = await screen.findByText('المطلوب تحصيله');
  const card = label.parentElement;
  expect(card).not.toBeNull();
  return card!.textContent ?? '';
}

// Same explicit 2dp ar-EG format as the page badge (see the INV note
// above): the expectation must not drift by environment.
const fmtBadge = (n: number) =>
  n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('DriverPortalPage pending amount', () => {
  it('sums remainingAmount, not the raw total: a fully-returned 131.60 invoice next to an open one reads 131.60, not 263.20', async () => {
    mockGetOrders.mockResolvedValue([
      portalOrder({ id: 1, total: 131.6, remainingAmount: 0 }),
      portalOrder({ id: 2, total: 131.6, remainingAmount: 131.6 }),
    ]);
    renderPortal();
    const badge = await pendingBadgeText();
    expect(badge).toContain(fmtBadge(131.6));
    expect(badge).not.toContain(fmtBadge(263.2));
  });

  it('a partial return of 65.80 reads 65.80', async () => {
    mockGetOrders.mockResolvedValue([
      portalOrder({ id: 1, total: 131.6, remainingAmount: 65.8 }),
    ]);
    renderPortal();
    const badge = await pendingBadgeText();
    expect(badge).toContain(fmtBadge(65.8));
    expect(badge).not.toContain(fmtBadge(131.6));
  });

  it('an order with no remainingAmount contributes 0 and never falls back to its raw total', async () => {
    mockGetOrders.mockResolvedValue([
      portalOrder({ id: 1, total: 100, remainingAmount: undefined }),
    ]);
    renderPortal();
    const badge = await pendingBadgeText();
    expect(badge).toContain(fmtBadge(0));
    expect(badge).not.toContain(fmtBadge(100));
  });
});
