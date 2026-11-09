/* R8-B (INV-REST-KDS-TOGGLE-FEEDBACK): the ready → cooking un-mark
 * toggle is refused server-side by design (R4-E I18 forward-only), but
 * the failure was silent — the cook tapped a ready item, the 400 came
 * back, and nothing on the wall said why the item stayed ready. The
 * fix adds an onError to itemStatusMutation that surfaces the server's
 * own Arabic message in the page's existing banner.
 *
 * Cases 1 and 4 are base-red: at base (c371a838) there is no onError
 * on itemStatusMutation, so no banner ever appears. Cases 2, 3 and 5
 * pass at base and pin the behaviour the fix must not change: forward
 * taps stay silent, the idempotent re-tap stays silent, and a failed
 * tickets query still renders the loud disconnected state (R2-D).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import KitchenDisplayPage from './KitchenDisplayPage';

// Local fixture shapes only — the spec must not import anything from the
// api module (the page-composition check flags any direct api import,
// type-only imports included). The page under test goes through the
// mocked module above; these shapes just describe the fixture objects.
type FixtureItemStatus = 'pending' | 'cooking' | 'ready';
interface FixtureItem {
  id: number;
  name: string;
  qty: number;
  status: FixtureItemStatus;
  station: 'kitchen' | 'grill' | 'beverages' | 'bakery' | 'general' | 'expo';
}
interface FixtureTicket {
  id: number;
  docNo: string;
  orderNumber: string;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  tableNumber?: string;
  status: 'pending' | 'cooking' | 'ready' | 'served';
  elapsedMinutes: number;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  items: FixtureItem[];
  urgencyLevel: 'normal' | 'warning' | 'critical';
}

// Hoisted mocks: the spec must not import the api module directly — the
// page-composition check flags a direct api import in any file under
// pages/, specs included. The page under test goes through the mocked
// module; the spec only ever touches these hoisted fns.
const getTicketsMock = vi.hoisted(() => vi.fn());
const setItemStatusMock = vi.hoisted(() => vi.fn());
const advanceStatusMock = vi.hoisted(() => vi.fn());
const recallLastServedMock = vi.hoisted(() => vi.fn());
const get86ItemsMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/pos/api/kds.api', () => ({
  kdsApi: {
    getTickets: getTicketsMock,
    setItemStatus: setItemStatusMock,
    advanceStatus: advanceStatusMock,
    recallLastServed: recallLastServedMock,
  },
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: { get86Items: get86ItemsMock },
}));

// The language hook calls i18n.changeLanguage in an effect; the test
// harness's react-i18next instance has no changeLanguage. The hook is
// orthogonal to the toggle-feedback wiring under test here.
vi.mock('@/features/pos/hooks/useIsolatedDisplayLanguage', () => ({
  useIsolatedDisplayLanguage: () => ({
    currentLang: 'ar',
    isEn: false,
    setLanguage: vi.fn(),
    toggleLanguage: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-catalog-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/hooks/use-catalog-queries')>();
  return {
    ...actual,
    useProductsQuery: () =>
      ({ data: [] }) as unknown as ReturnType<typeof actual.useProductsQuery>,
  };
});

// The exact server message for the refused backward move
// (backend kds.service.ts setItemStatus, R4-E I18 forward-only).
const UNMARK_REFUSED_MESSAGE = 'لا يمكن إعادة صنف المطبخ إلى حالة سابقة — التقدم للأمام فقط';

function ticketWithItems(items: FixtureItem[]): FixtureTicket {
  return {
    id: 1,
    docNo: 'KDS-1',
    orderNumber: '1',
    orderType: 'dine_in',
    tableNumber: '5',
    status: 'cooking',
    elapsedMinutes: 3,
    elapsedSeconds: 0,
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:03:00.000Z',
    items,
    urgencyLevel: 'normal',
  };
}

function ticketsResponse(tickets: FixtureTicket[]) {
  return {
    tickets,
    stats: { pendingCount: 1, cookingCount: 0, readyCount: 1, criticalCount: 0, avgPrepMinutes: 10 },
    truncated: false,
    totalActive: tickets.length,
    kdsStateCorrupt: false,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <KitchenDisplayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KitchenDisplayPage KDS un-mark toggle feedback (INV-REST-KDS-TOGGLE-FEEDBACK)', () => {
  beforeEach(() => {
    get86ItemsMock.mockResolvedValue([]);
    advanceStatusMock.mockResolvedValue({ ticketId: 1, newStatus: 'ready' });
    recallLastServedMock.mockResolvedValue({ recalled: false });
  });

  it('surfaces the server refusal in the banner when un-marking a ready item', async () => {
    getTicketsMock.mockResolvedValue(
      ticketsResponse([
        ticketWithItems([
          { id: 11, name: 'كباب مشكل', qty: 1, status: 'ready', station: 'grill' },
        ]),
      ]),
    );
    setItemStatusMock.mockRejectedValue(new Error(UNMARK_REFUSED_MESSAGE));
    renderPage();

    await screen.findByText('كباب مشكل');
    fireEvent.click(screen.getByText('كباب مشكل'));

    // The un-mark attempt itself still goes out (ready -> cooking).
    await waitFor(() =>
      expect(setItemStatusMock).toHaveBeenCalledWith(1, 11, 'cooking'),
    );
    // And the failure is now visible, in the server's own words.
    await screen.findByText(UNMARK_REFUSED_MESSAGE);
    // The backward move is refused: the item stays rendered as ready
    // (struck-through), it is not silently un-marked.
    expect(screen.getByText('كباب مشكل')).toHaveStyle({ textDecoration: 'line-through' });
  });

  it('keeps a forward tap silent: pending -> ready shows no error banner', async () => {
    getTicketsMock.mockResolvedValue(
      ticketsResponse([
        ticketWithItems([
          { id: 12, name: 'شوربة عدس', qty: 1, status: 'pending', station: 'kitchen' },
        ]),
      ]),
    );
    setItemStatusMock.mockResolvedValue({ ticketId: 1, itemId: 12, itemStatus: 'ready' });
    const { container } = renderPage();

    await screen.findByText('شوربة عدس');
    fireEvent.click(screen.getByText('شوربة عدس'));

    await waitFor(() =>
      expect(setItemStatusMock).toHaveBeenCalledWith(1, 12, 'ready'),
    );
    expect(container.textContent).not.toContain(UNMARK_REFUSED_MESSAGE);
  });

  it('stays silent when the server no-ops an already-ready item', async () => {
    getTicketsMock.mockResolvedValue(
      ticketsResponse([
        ticketWithItems([
          { id: 13, name: 'سلطة خضراء', qty: 1, status: 'ready', station: 'kitchen' },
        ]),
      ]),
    );
    // Same-status re-set is an idempotent no-op server-side.
    setItemStatusMock.mockResolvedValue({ ticketId: 1, itemId: 13, itemStatus: 'ready' });
    const { container } = renderPage();

    await screen.findByText('سلطة خضراء');
    fireEvent.click(screen.getByText('سلطة خضراء'));

    await waitFor(() =>
      expect(setItemStatusMock).toHaveBeenCalledWith(1, 13, 'cooking'),
    );
    expect(container.textContent).not.toContain(UNMARK_REFUSED_MESSAGE);
  });

  it('clears the error banner after its timeout', async () => {
    getTicketsMock.mockResolvedValue(
      ticketsResponse([
        ticketWithItems([
          { id: 14, name: 'مشاوي مشكلة', qty: 1, status: 'ready', station: 'grill' },
        ]),
      ]),
    );
    setItemStatusMock.mockRejectedValue(new Error(UNMARK_REFUSED_MESSAGE));
    renderPage();

    await screen.findByText('مشاوي مشكلة');
    fireEvent.click(screen.getByText('مشاوي مشكلة'));
    await screen.findByText(UNMARK_REFUSED_MESSAGE);

    // The banner auto-clears (5s timeout in the fix) so a stale error
    // does not sit on the kitchen wall forever.
    await waitFor(
      () => expect(screen.queryByText(UNMARK_REFUSED_MESSAGE)).not.toBeInTheDocument(),
      { timeout: 8000 },
    );
  }, 15000);

  it('still renders the loud disconnected state when the tickets query fails', async () => {
    getTicketsMock.mockRejectedValue(new Error('Network failed'));
    renderPage();

    await screen.findByText('انقطع الاتصال بخادم المطبخ');
    expect(screen.queryByText('كباب مشكل')).not.toBeInTheDocument();
  });
});
