/* S7 (INV-REST-MANAGER-COMP-PIN-GATE): the Manager Comp tile opens the
 * comp dialog for a non-manager cashier, and on the live build the
 * dialog's security PIN was optional with an enabled approve button —
 * a cashier could reach comp approval with no manager code at all
 * (live-proven 2026-11-12 on test10k: cashier_test opened the full
 * dialog, PIN "(اختياري)", approve "اعتماد الضيافة (75.00)" enabled;
 * the dialog was closed without approving, so no comp was posted).
 *
 * The fix, pinned here against the real dialog:
 * - (1) the approve button is DISABLED while the PIN field is empty,
 *   so the button cannot act without a manager PIN. At base the
 *   button is enabled with an empty PIN and only a toast stops the
 *   submit — a cashier could still reach (and click) approve.
 * - (2) typing a PIN enables the button again (the manager flow is
 *   unchanged: type the PIN, approve).
 * - (3) the approving-manager name field is NOT pre-filled with a
 *   cashier's name: at base it always showed 'مدير الصالة' (AuthUser
 *   has no `name` field, so `currentUser?.name` was always undefined)
 *   for whoever opened the dialog — a cashier was presented as the
 *   approving manager. Now the field stays empty for a non-manager.
 * - (4) for a manager the name IS pre-filled with their displayName
 *   (the manager flow keeps its one-field-less convenience).
 * - (5) with a PIN typed, approve still calls the server with the
 *   PIN and then applies the comp to the cart (the manager flow
 *   posts exactly as before).
 *
 * The server half is pinned at controller level by
 * backend/test/critical/restaurant-manager-comp-gate.spec.ts (a
 * cashier fails 403 even with the correct PIN; a manager with the
 * correct PIN records the comp with the VERIFIED approver). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosManagerCompModal } from './PosManagerCompModal';
import { useAuthStore } from '@/stores/auth-store';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import type { AuthUser } from '@/types/auth';

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    recordManagerComp: vi.fn(),
  },
}));

vi.mock('@/shared/components/system-alert', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

const cashier: AuthUser = {
  id: '2',
  username: 'cashier-a',
  role: 'cashier',
  permissions: ['sales'],
  displayName: 'أحمد الكاشير',
  branchIds: ['1'],
  defaultBranchId: '1',
  tenantId: 't1',
};

const manager: AuthUser = {
  id: '1',
  username: 'boss',
  role: 'admin',
  permissions: [],
  displayName: 'مدير الصالة',
  branchIds: ['1'],
  defaultBranchId: '1',
  tenantId: 't1',
};

function renderModal(user: AuthUser) {
  useAuthStore.setState({ user, tenant: null, initialized: true, appGate: 'ready' });
  const onClose = vi.fn();
  const onApplyComp = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <MemoryRouter>
      <PosManagerCompModal
        open
        onClose={onClose}
        currentCartTotal={75}
        currentTableNumber="5"
        cartSummary="1 × منتج"
        onApplyComp={onApplyComp}
      />
    </MemoryRouter>,
  );
  return { ...utils, onClose, onApplyComp };
}

function approveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /اعتماد الضيافة/ }) as HTMLButtonElement;
}

function pinInput(): HTMLInputElement {
  return screen.getByPlaceholderText('••••') as HTMLInputElement;
}

function managerNameInput(): HTMLInputElement {
  // The dialog renders in a portal attached to document.body, so
  // the inputs live outside the render container. The dialog's text
  // inputs in DOM order: approving-manager name, then the notes
  // field. The PIN input is type=password, so it is not in this list.
  const textInputs = document.querySelectorAll('input[type="text"]');
  return textInputs[0] as HTMLInputElement;
}

describe('PosManagerCompModal — manager PIN gate (S7)', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, tenant: null });
    vi.clearAllMocks();
  });

  it('(1) the approve button is disabled while the PIN is empty', () => {
    renderModal(cashier);
    expect(approveButton().disabled).toBe(true);
  });

  it('(2) typing a PIN enables the approve button', () => {
    renderModal(cashier);
    fireEvent.change(pinInput(), { target: { value: '1234' } });
    expect(approveButton().disabled).toBe(false);
  });

  it('(3) the manager-name field is empty for a cashier, not pre-filled with their name', () => {
    renderModal(cashier);
    expect(managerNameInput().value).toBe('');
    expect(screen.queryByDisplayValue('أحمد الكاشير')).toBeNull();
    expect(screen.queryByDisplayValue('مدير الصالة')).toBeNull();
  });

  it('(4) the manager-name field is pre-filled with the manager displayName', () => {
    renderModal(manager);
    expect(managerNameInput().value).toBe('مدير الصالة');
    // …and the approve button is still disabled until a PIN is typed.
    expect(approveButton().disabled).toBe(true);
  });

  it('(5) with a PIN typed, approve sends the PIN to the server and applies the comp', async () => {
    const { onClose, onApplyComp } = renderModal(manager);
    const recordMock = restaurantAdvancedFnbApi.recordManagerComp as unknown as ReturnType<typeof vi.fn>;
    recordMock.mockResolvedValue({ success: true, comp: {}, message: 'ok' });
    fireEvent.change(pinInput(), { target: { value: '1234' } });
    fireEvent.click(approveButton());
    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    const payload = recordMock.mock.calls[0][0];
    expect(payload.managerPin).toBe('1234');
    expect(payload.amount).toBe(75);
    await waitFor(() => expect(onApplyComp).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 30000);
});
