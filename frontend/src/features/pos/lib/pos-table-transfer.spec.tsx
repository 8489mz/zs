/* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the whole-table transfer
 * persisted via raw API calls and never invalidated the held-drafts query,
 * so the draft existed on table 5 in the DB while every list still showed
 * the pre-transfer snapshot — and the fall-through branch toasted success
 * while persisting nothing (notably for split checks stored as
 * "N - شيك k", which never equalled "N").
 *
 * These specs drive the real shared transfer handler plus the real
 * saveHeldDraftMutation: a live-cart transfer 2 -> 5 must leave the
 * held-drafts QUERY data holding the draft under "5" (invalidation proven,
 * not just the toast); a rename must do the same with no mutation
 * onSuccess involved; a missing source must error and persist nothing.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/app/query-keys';
import { createTestQueryClient } from '@/test/test-query-client';
import { usePosWorkspaceMutations } from '@/features/pos/hooks/usePosWorkspaceMutations';
import {
  buildTransferHeldDraftPayload,
  findTransferSourceDrafts,
  normalizeTableNumber,
  renameHeldDraftTableAndRefresh,
  transferTableOrder,
} from '@/features/pos/lib/pos-table-transfer';

const { listHeldDraftsMock, saveHeldDraftMock, renameMock, listOpenShiftsMock } = vi.hoisted(() => ({
  listHeldDraftsMock: vi.fn(),
  saveHeldDraftMock: vi.fn(),
  renameMock: vi.fn(),
  listOpenShiftsMock: vi.fn(),
}));

vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    listHeldDrafts: listHeldDraftsMock,
    saveHeldDraft: saveHeldDraftMock,
  },
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    renameHeldDraftTable: renameMock,
  },
}));

vi.mock('@/lib/api/cash-drawer', () => ({
  cashDrawerApi: {
    listPage: listOpenShiftsMock,
  },
}));

type ServerDraft = { id: string; tableNumber: string; cart: unknown[] };

let serverDrafts: ServerDraft[];

function createWrapper(queryClient: ReturnType<typeof createTestQueryClient>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const cartItem = {
  productId: '11',
  qty: 1,
  price: 75,
  name: 'وجبة',
  unitName: 'طبق',
  unitMultiplier: 1,
  priceType: 'retail',
  notes: '',
  modifiers: [],
};

/* jsdom reports its own visibilityState; the visibility tests drive it
 * explicitly so the hidden -> visible transition is deterministic. */
function setVisibilityState(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function restoreVisibilityState() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
}

describe('normalizeTableNumber', () => {
  it('keeps a plain table number', () => {
    expect(normalizeTableNumber('2')).toBe('2');
    expect(normalizeTableNumber(' 5 ')).toBe('5');
  });

  it('maps a split check "N - شيك k" back to its source table N', () => {
    expect(normalizeTableNumber('2 - شيك 1')).toBe('2');
    expect(normalizeTableNumber('2 - شيك 12')).toBe('2');
    expect(normalizeTableNumber('VIP 2 - شيك 1')).toBe('VIP 2');
  });

  it('does not strip a table name that merely contains a dash', () => {
    expect(normalizeTableNumber('VIP 2')).toBe('VIP 2');
  });
});

describe('findTransferSourceDrafts', () => {
  it('matches an exact table and a split check on the same table', () => {
    const drafts = [
      { id: 'a', tableNumber: '2 - شيك 1' },
      { id: 'b', tableNumber: '3' },
    ];
    expect(findTransferSourceDrafts(drafts, '2')).toEqual([drafts[0]]);
    expect(findTransferSourceDrafts(drafts, '3')).toEqual([drafts[1]]);
    expect(findTransferSourceDrafts(drafts, '9')).toEqual([]);
  });
});

describe('transferTableOrder — live cart 2 -> 5', () => {
  beforeEach(() => {
    serverDrafts = [];
    listHeldDraftsMock.mockImplementation(async () => serverDrafts.map((d) => ({ ...d })));
    saveHeldDraftMock.mockImplementation(async (payload: any) => {
      const draft = {
        id: `draft-${serverDrafts.length + 1}`,
        savedAt: new Date().toISOString(),
        ...payload,
        cart: payload.items ?? [],
      };
      serverDrafts.push(draft);
      return draft;
    });
    renameMock.mockImplementation(async (id: number, tableNumber: string) => {
      const draft = serverDrafts.find((d) => Number(d.id.replace('draft-', '')) === id || d.id === String(id));
      if (draft) draft.tableNumber = tableNumber;
      return {};
    });
    listOpenShiftsMock.mockResolvedValue({ rows: [] });
  });

  it('saves the live cart as a held draft on table 5 AND the held-drafts query data shows it under "5"', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [],
        tableNumber: '2',
        cart: [cartItem],
        customerId: '',
        paymentType: 'cash',
        discount: 0,
        deliveryFee: 0,
        note: '',
        search: '',
        priceType: 'retail',
        branchId: null,
        locationId: null,
        cashAmount: 0,
        cardAmount: 0,
        transferAmount: 0,
        paymentChannel: 'cash',
        orderType: 'dine_in',
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('held-saved');
    expect(saveHeldDraftMock).toHaveBeenCalledTimes(1);
    expect((saveHeldDraftMock.mock.calls[0][0] as any).tableNumber).toBe('5');
    // Invalidation proven, not just the toast: the query cache itself
    // holds the draft under "5" after the handler resolves.
    const cached = queryClient.getQueryData<ServerDraft[]>(queryKeys.posHeldDrafts) || [];
    expect(cached.some((d) => d.tableNumber === '5')).toBe(true);
    expect(cached.some((d) => d.tableNumber === '2')).toBe(false);
  });

  it('renames a held draft 2 -> 5 and the query data moves with it (no mutation onSuccess involved)', async () => {
    serverDrafts = [{ id: '7', tableNumber: '2', cart: [cartItem] }];
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    // Let the initial fetch land so the cache holds the pre-transfer draft.
    await act(async () => {
      await result.current.heldDraftsQuery.refetch();
    });
    expect((queryClient.getQueryData(queryKeys.posHeldDrafts) as ServerDraft[] | undefined)?.[0]?.tableNumber).toBe('2');

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [{ id: '7', tableNumber: '2' }],
        tableNumber: '2',
        cart: [],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome).toEqual({ status: 'renamed', draftId: '7' });
    expect(renameMock).toHaveBeenCalledWith(7, '5');
    expect(saveHeldDraftMock).not.toHaveBeenCalled();
    const cached = queryClient.getQueryData<ServerDraft[]>(queryKeys.posHeldDrafts) || [];
    expect(cached.some((d) => d.tableNumber === '5')).toBe(true);
    expect(cached.some((d) => d.tableNumber === '2')).toBe(false);
  });

  it('matches a split check "2 - شيك 1" as the order on table 2', async () => {
    serverDrafts = [{ id: '9', tableNumber: '2 - شيك 1', cart: [cartItem] }];
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    await act(async () => {
      await result.current.heldDraftsQuery.refetch();
    });

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [{ id: '9', tableNumber: '2 - شيك 1' }],
        tableNumber: '2',
        cart: [],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome).toEqual({ status: 'renamed', draftId: '9' });
    expect(renameMock).toHaveBeenCalledWith(9, '5');
  });

  it('refuses with a named error when the source table holds several split checks', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [
          { id: '9', tableNumber: '2 - شيك 1' },
          { id: '10', tableNumber: '2 - شيك 2' },
        ],
        tableNumber: '2',
        cart: [cartItem],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('error');
    expect(outcome?.status === 'error' ? outcome.message : '').toContain('2');
    expect(renameMock).not.toHaveBeenCalled();
    expect(saveHeldDraftMock).not.toHaveBeenCalled();
    expect(serverDrafts).toEqual([]);
  });

  it('missing source: errors naming the table, persists nothing, changes no list', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    await act(async () => {
      await result.current.heldDraftsQuery.refetch();
    });

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [],
        tableNumber: '9',
        cart: [],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('error');
    expect(outcome?.status === 'error' ? outcome.message : '').toContain('2');
    expect(renameMock).not.toHaveBeenCalled();
    expect(saveHeldDraftMock).not.toHaveBeenCalled();
    expect(serverDrafts).toEqual([]);
    expect(queryClient.getQueryData(queryKeys.posHeldDrafts)).toEqual([]);
  });

  it('a failed held-save errors and leaves the query data untouched', async () => {
    saveHeldDraftMock.mockRejectedValueOnce(new Error('تعذر الاتصال بالخادم'));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [],
        tableNumber: '2',
        cart: [cartItem],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('error');
    expect(serverDrafts).toEqual([]);
    expect(queryClient.getQueryData(queryKeys.posHeldDrafts)).toEqual([]);
  });
});

describe('renameHeldDraftTableAndRefresh', () => {
  beforeEach(() => {
    serverDrafts = [{ id: '7', tableNumber: '2', cart: [cartItem] }];
    listHeldDraftsMock.mockImplementation(async () => serverDrafts.map((d) => ({ ...d })));
    renameMock.mockImplementation(async (id: number, tableNumber: string) => {
      const draft = serverDrafts.find((d) => d.id === String(id));
      if (draft) draft.tableNumber = tableNumber;
      return {};
    });
    listOpenShiftsMock.mockResolvedValue({ rows: [] });
  });

  it('renames the draft and the held-drafts query data shows the new table', async () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    await act(async () => {
      await result.current.heldDraftsQuery.refetch();
    });

    let outcome: Awaited<ReturnType<typeof renameHeldDraftTableAndRefresh>> | undefined;
    await act(async () => {
      outcome = await renameHeldDraftTableAndRefresh({ queryClient, draftId: '7', toTable: '5' });
    });

    expect(outcome).toEqual({ status: 'renamed', draftId: '7' });
    expect(renameMock).toHaveBeenCalledWith(7, '5');
    const cached = queryClient.getQueryData<ServerDraft[]>(queryKeys.posHeldDrafts) || [];
    expect(cached.some((d) => d.tableNumber === '5')).toBe(true);
  });

  it('refuses an empty target table without calling the server', async () => {
    const queryClient = createTestQueryClient();
    let outcome: Awaited<ReturnType<typeof renameHeldDraftTableAndRefresh>> | undefined;
    await act(async () => {
      outcome = await renameHeldDraftTableAndRefresh({ queryClient, draftId: '7', toTable: '   ' });
    });
    expect(outcome?.status).toBe('error');
    expect(renameMock).not.toHaveBeenCalled();
  });
});

describe('buildTransferHeldDraftPayload', () => {
  it('carries the live cart onto the target table with the same field mapping as the old handler', () => {
    const payload = buildTransferHeldDraftPayload({
      to: '5',
      cart: [{ ...cartItem, priceType: 'wholesale', seatNumber: 3, course: 'main' }],
      customerId: 'c1',
      paymentType: 'cash',
      discount: 5,
      deliveryFee: 0,
      note: 'n',
      search: '',
      priceType: 'retail',
      branchId: '1',
      locationId: '2',
      cashAmount: 75,
      cardAmount: 0,
      transferAmount: 0,
      paymentChannel: 'cash',
      orderType: 'dine_in',
    }) as any;
    expect(payload.tableNumber).toBe('5');
    expect(payload.orderType).toBe('dine_in');
    expect(payload.items).toEqual([{
      productId: 11,
      qty: 1,
      price: 75,
      name: 'وجبة',
      unitName: 'طبق',
      unitMultiplier: 1,
      priceType: 'wholesale',
      notes: '',
      modifiers: [],
      seatNumber: 3,
      course: 'main',
    }]);
  });

  it('defaults the order type to dine_in when none is set', () => {
    const payload = buildTransferHeldDraftPayload({ to: '5', cart: [] }) as any;
    expect(payload.orderType).toBe('dine_in');
    expect(payload.tableNumber).toBe('5');
  });
});

/* INV-REST-FLOOR-VERIFY-REFETCH (T13-A): the handler used to report
 * success as soon as the write resolved and the refetch was kicked off —
 * a write the server accepted but never landed (rename no-op, save that
 * resolves without persisting) still toasted success while the floor
 * kept showing the old table. The handler now re-reads the held-drafts
 * cache after the refetch and only reports success when the re-read
 * shows the order on the target table and nothing left on the source.
 *
 * Both cases are base-red: at base the handler returns success
 * regardless of what the re-read shows.
 */
describe('transferTableOrder — verify after write (INV-REST-FLOOR-VERIFY-REFETCH)', () => {
  beforeEach(() => {
    serverDrafts = [{ id: '7', tableNumber: '2', cart: [cartItem] }];
    listHeldDraftsMock.mockImplementation(async () => serverDrafts.map((d) => ({ ...d })));
    saveHeldDraftMock.mockImplementation(async (payload: any) => {
      const draft = {
        id: `draft-${serverDrafts.length + 1}`,
        savedAt: new Date().toISOString(),
        ...payload,
        cart: payload.items ?? [],
      };
      serverDrafts.push(draft);
      return draft;
    });
    renameMock.mockImplementation(async (id: number, tableNumber: string) => {
      const draft = serverDrafts.find((d) => Number(d.id.replace('draft-', '')) === id || d.id === String(id));
      if (draft) draft.tableNumber = tableNumber;
      return {};
    });
    listOpenShiftsMock.mockResolvedValue({ rows: [] });
  });

  it('a rename the server accepts but does not land errors instead of reporting success', async () => {
    // The rename call resolves, but the draft never moves: the re-read
    // still shows it on table 2, so the transfer must NOT report success.
    renameMock.mockImplementationOnce(async () => ({}));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    await act(async () => {
      await result.current.heldDraftsQuery.refetch();
    });

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [{ id: '7', tableNumber: '2' }],
        tableNumber: '2',
        cart: [],
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('error');
    expect(outcome?.status === 'error' ? outcome.message : '').toContain('5');
    const cached = queryClient.getQueryData<ServerDraft[]>(queryKeys.posHeldDrafts) || [];
    expect(cached.some((d) => d.tableNumber === '2')).toBe(true);
    expect(cached.some((d) => d.tableNumber === '5')).toBe(false);
  });

  it('a held-save the server accepts but does not land errors instead of reporting success', async () => {
    // The save resolves with a draft, but nothing lands server-side:
    // the re-read shows no draft on table 5, so no success toast.
    saveHeldDraftMock.mockImplementationOnce(async (payload: any) => ({
      id: 'draft-99',
      savedAt: new Date().toISOString(),
      ...payload,
      cart: payload.items ?? [],
    }));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );

    let outcome: Awaited<ReturnType<typeof transferTableOrder>> | undefined;
    await act(async () => {
      outcome = await transferTableOrder({
        queryClient,
        from: '2',
        to: '5',
        heldDrafts: [],
        tableNumber: '2',
        cart: [cartItem],
        customerId: '',
        paymentType: 'cash',
        discount: 0,
        deliveryFee: 0,
        note: '',
        search: '',
        priceType: 'retail',
        branchId: null,
        locationId: null,
        cashAmount: 0,
        cardAmount: 0,
        transferAmount: 0,
        paymentChannel: 'cash',
        orderType: 'dine_in',
        saveHeldDraft: (payload) => result.current.saveHeldDraftMutation.mutateAsync(payload),
      });
    });

    expect(outcome?.status).toBe('error');
    expect(outcome?.status === 'error' ? outcome.message : '').toContain('5');
    // Nothing new landed: the pre-existing draft on table 2 is untouched
    // and no draft appeared on table 5.
    expect(serverDrafts).toEqual([{ id: '7', tableNumber: '2', cart: [cartItem] }]);
    const cached = queryClient.getQueryData<ServerDraft[]>(queryKeys.posHeldDrafts) || [];
    expect(cached.some((d) => d.tableNumber === '5')).toBe(false);
  });
});

/* INV-REST-FLOOR-VERIFY-REFETCH (T13-A, H7): the held-drafts query
 * inherits the global focus-refetch-off default, so a draft moved by
 * another station while the POS tab sat in the background never
 * appeared until a manual reload. Returning to the tab must refetch
 * it via the shared visibility hook.
 *
 * Base-red: at base nothing listens for visibilitychange, so the
 * call count never grows after the tab returns.
 */
describe('heldDraftsQuery — refetch on tab return (INV-REST-FLOOR-VERIFY-REFETCH)', () => {
  beforeEach(() => {
    serverDrafts = [{ id: '7', tableNumber: '2', cart: [cartItem] }];
    listHeldDraftsMock.mockImplementation(async () => serverDrafts.map((d) => ({ ...d })));
    listOpenShiftsMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    restoreVisibilityState();
  });

  it('refetches the held drafts when the tab returns to visible, without a manual reload', async () => {
    const queryClient = createTestQueryClient();
    renderHook(
      () => usePosWorkspaceMutations({ queryClient, storedHeld: [] }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(listHeldDraftsMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(queryKeys.posHeldDrafts) as ServerDraft[] | undefined)?.[0]?.tableNumber,
      ).toBe('2'),
    );
    const callsAfterMount = listHeldDraftsMock.mock.calls.length;

    // The tab goes to the background; the draft moves on the server
    // (another station transfers it) while nobody is watching.
    setVisibilityState('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(listHeldDraftsMock.mock.calls.length).toBe(callsAfterMount);
    serverDrafts = [{ id: '7', tableNumber: '5', cart: [cartItem] }];

    // Returning to the tab refetches: the list shows table 5 with no
    // manual reload and no focus event involved.
    setVisibilityState('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(listHeldDraftsMock.mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
    expect(
      (queryClient.getQueryData(queryKeys.posHeldDrafts) as ServerDraft[] | undefined)?.[0]?.tableNumber,
    ).toBe('5');
  });
});
