/* INV-POS-EMPTY-CART-MUTATION-RESET-GATE: the empty-cart effect in
 * usePosWorkspaceEffects called createSale.reset() UNCONDITIONALLY whenever
 * the cart was empty, with createSale (a useMutation result) in the dep
 * array. React Query's useBaseMutation returns a FRESH object on every
 * render, so the dep "changed" after every render; MutationObserver.reset()
 * builds a new result object and notifies listeners unconditionally, which
 * re-renders the workspace, which re-runs the effect, which resets again —
 * a self-sustaining render loop that ran until the POS route unmounted
 * (~5.4 s on the live 10K-product tenant; the deployed trace's dominant
 * stack was React work -> anon in the PosWorkspace chunk -> reset -> #n ->
 * batch -> flush -> setTimeout). The reset now fires ONLY when the mutation
 * is in a terminal state (isSuccess / isError) — the stale status a
 * finished sale leaves behind. An idle mutation is never reset, so the
 * normal empty cart (including every POS exit with an empty cart) cannot
 * start the loop; a finished sale is still cleared exactly once, and the
 * status flip to idle closes the gate on the next effect run.
 *
 * These cases drive the REAL code: a real QueryClient, a real useMutation
 * result, and the real usePosWorkspaceEffects hook — no stubbed createSale.
 * Every other prop is referentially stable across renders, so createSale
 * is the only dep that can change. On UNFIXED code every case FAILS
 * (render counts in the hundreds, reset called on every cycle); on FIXED
 * code every case PASSES. */
import { QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePosWorkspaceEffects } from './usePosWorkspaceEffects';
import { createTestQueryClient } from '@/test/test-query-client';
import type { PosItem } from '@/features/pos/types/pos.types';

const cartItem = {
  lineKey: 'line-1',
  productId: '10',
  name: 'Item 000001',
  unitId: '1',
  unitName: 'piece',
  unitMultiplier: 1,
  price: 75,
  costPrice: 5,
  qty: 1,
  stockLimit: 100,
  currentStock: 100,
  minStock: 0,
  priceType: 'retail',
} as PosItem;

/* Stable empty references — the harness must hand the hook the same
 * array identity on every render, or the draft/stock effects would
 * re-run for reasons unrelated to createSale. */
const EMPTY_PRODUCTS: never[] = [];
const EMPTY_RECENT_IDS: string[] = [];

function createSetters() {
  return {
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setPaymentChannel: vi.fn(),
    setSubmitMessage: vi.fn(),
    setSelectedLineKey: vi.fn(),
    setLastAddedLineKey: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
  };
}

type Setters = ReturnType<typeof createSetters>;

interface Probe {
  renderCount: number;
  resetCalls: number;
  setCart: (cart: PosItem[]) => void;
  mutate: () => Promise<unknown>;
  mutationStatus: () => string;
}

function Harness({
  probe,
  setters,
  initialCart,
  mutationFn,
  countResets,
}: {
  probe: Probe;
  setters: Setters;
  initialCart: PosItem[];
  mutationFn: () => Promise<{ id: string }>;
  countResets: boolean;
}) {
  const [cart, setCart] = useState<PosItem[]>(initialCart);
  const mutation = useMutation({ mutationFn });
  probe.renderCount += 1;
  probe.setCart = setCart;
  probe.mutate = () => mutation.mutateAsync();
  probe.mutationStatus = () => mutation.status;
  /* Counting wrapper: a fresh object on every render (exactly like the
   * raw result), and reset() still reaches the real observer — only the
   * call is counted. The loop mechanism is untouched by the wrapper. */
  const createSale = countResets
    ? { ...mutation, reset: () => { probe.resetCalls += 1; mutation.reset(); } }
    : mutation;
  usePosWorkspaceEffects({
    cart,
    customerId: '',
    discount: 0,
    paidAmount: 0,
    cashAmount: 0,
    setCashAmount: setters.setCashAmount,
    cardAmount: 0,
    setCardAmount: setters.setCardAmount,
    transferAmount: 0,
    setTransferAmount: setters.setTransferAmount,
    paymentType: 'cash',
    paymentChannel: 'cash',
    setPaymentChannel: setters.setPaymentChannel,
    note: '',
    search: '',
    priceType: 'retail',
    tableNumber: '',
    orderType: 'takeaway',
    createSale,
    products: EMPTY_PRODUCTS,
    setCart,
    setSubmitMessage: setters.setSubmitMessage,
    recentProductIds: EMPTY_RECENT_IDS,
    lastSale: null,
    lastAddedLineKey: '',
    setLastAddedLineKey: setters.setLastAddedLineKey,
    selectedLineKey: '',
    setSelectedLineKey: setters.setSelectedLineKey,
    discountApprovalSecret: '',
    setDiscountApprovalSecret: setters.setDiscountApprovalSecret,
  });
  return null;
}

function mountHarness(options: {
  initialCart: PosItem[];
  mutationFn: () => Promise<{ id: string }>;
  countResets: boolean;
}) {
  const queryClient = createTestQueryClient();
  const setters = createSetters();
  const probe: Probe = {
    renderCount: 0,
    resetCalls: 0,
    setCart: () => undefined,
    mutate: async () => undefined,
    mutationStatus: () => 'idle',
  };
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(
    <Harness
      probe={probe}
      setters={setters}
      initialCart={options.initialCart}
      mutationFn={options.mutationFn}
      countResets={options.countResets}
    />,
    { wrapper: Wrapper },
  );
  return { ...utils, probe, queryClient };
}

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

describe('empty-cart mutation reset must not loop (INV-POS-EMPTY-CART-MUTATION-RESET-GATE)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('an idle mutation with an empty cart does NOT loop: renders stay bounded over 600 ms', async () => {
    const { probe } = mountHarness({
      initialCart: [],
      mutationFn: async () => ({ id: 'sale-1' }),
      countResets: false,
    });

    await act(async () => { await sleep(600); });

    /* RED on unfixed code: the reset -> notify -> re-render -> reset
     * cycle runs for the whole window (hundreds of renders). */
    expect(probe.renderCount).toBeLessThanOrEqual(5);
  });

  it('an idle mutation with an empty cart never has reset() called', async () => {
    const { probe } = mountHarness({
      initialCart: [],
      mutationFn: async () => ({ id: 'sale-1' }),
      countResets: true,
    });

    await act(async () => { await sleep(300); });

    /* RED on unfixed code: reset() fires on every cycle of the loop. */
    expect(probe.resetCalls).toBe(0);
    expect(probe.renderCount).toBeLessThanOrEqual(5);
  });

  it('a successful sale is cleared exactly once when the cart empties, then the loop stops', async () => {
    const { probe } = mountHarness({
      initialCart: [cartItem],
      mutationFn: async () => ({ id: 'sale-1' }),
      countResets: true,
    });

    await act(async () => { await probe.mutate(); });
    /* The success status reaches React through the notifyManager flush
     * (a setTimeout(0)), so the re-render lands after the mutate promise
     * resolves — wait for it to settle before reading the status. */
    await waitFor(() => expect(probe.mutationStatus()).toBe('success'));

    await act(async () => { probe.setCart([]); });
    await act(async () => { await sleep(300); });

    /* RED on unfixed code: the unconditional reset keeps firing after
     * the status is already idle, so resetCalls explodes with the loop. */
    expect(probe.resetCalls).toBe(1);
    expect(probe.mutationStatus()).toBe('idle');
    expect(probe.renderCount).toBeLessThanOrEqual(10);
  });

  it('a failed sale is cleared exactly once when the cart empties, then the loop stops', async () => {
    const { probe } = mountHarness({
      initialCart: [cartItem],
      mutationFn: async () => { throw new Error('sale failed'); },
      countResets: true,
    });

    await act(async () => { await probe.mutate().catch(() => undefined); });
    await waitFor(() => expect(probe.mutationStatus()).toBe('error'));

    await act(async () => { probe.setCart([]); });
    await act(async () => { await sleep(300); });

    expect(probe.resetCalls).toBe(1);
    expect(probe.mutationStatus()).toBe('idle');
    expect(probe.renderCount).toBeLessThanOrEqual(10);
  });
});
