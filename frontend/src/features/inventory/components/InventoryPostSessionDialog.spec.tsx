/*
 * Pins the post-session approval field for admins
 * (INV-STOCK-COUNT-SELF-APPROVAL, the frontend half of the
 * stock-count approval fix; backend pinned by
 * stock-count-self-approval.spec.ts and
 * stock-count-dual-approval.spec.ts).
 *
 * THE GAP: since INV-STOCK-COUNT-DUAL-APPROVAL (2026-11-12) the
 * backend has no admin bypass — a variance post needs an identified
 * manager's password — but the post-session dialog hid the password
 * field for admins (`managerPinRequired={!isAdmin && hasVariance}`),
 * a condition that predates the tightening. An admin posting a
 * variance saw no field, confirmed, and the mutation sent no
 * credential, so the post failed 403 ADMIN_PASSWORD_REQUIRED. The
 * label/hint were also stale: they offered the shared manager PIN,
 * which the backend rejects.
 *
 * WHAT THIS PINS, driving the REAL dialog:
 * - an admin posting a variance session sees the approval field
 *   with the corrected label and the hint (own password or another
 *   admin's; the shared PIN does not work); confirming without a
 *   password is blocked; with a password onConfirm is called
 *   carrying the managerPin.
 * - a non-admin posting a variance session sees the same field.
 * - a zero-variance session shows no approval field and confirms
 *   without any credential.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryPostSessionDialog } from './InventoryWorkspaceDialogs';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';
import type { StockCountSession } from '@/types/domain';

function makeUser(role: 'admin' | 'cashier'): AuthUser {
  return {
    id: role === 'admin' ? '10' : '11',
    username: role === 'admin' ? 'soleadmin' : 'cashier2',
    role,
    permissions: [],
    displayName: role === 'admin' ? 'Sole Admin' : 'Cashier',
    branchIds: ['1'],
    defaultBranchId: '1',
  };
}

function makeSession(varianceQty: number): StockCountSession {
  return {
    id: '401',
    docNo: 'ZSC-401',
    status: 'draft',
    createdAt: '2026-11-14T00:00:00.000Z',
    items: [
      {
        id: '1',
        productId: '101',
        productName: 'صنف أ',
        expectedQty: 90,
        countedQty: 85,
        varianceQty,
      },
    ],
  };
}

describe('post stock count session approval field', () => {
  it('shows the approval field to an admin posting a variance, with the corrected label and hint', () => {
    useAuthStore.setState({ user: makeUser('admin') });
    const onConfirm = vi.fn();
    render(
      <InventoryPostSessionDialog
        sessions={[makeSession(5)]}
        isBusy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const approverInput = screen.getByLabelText(/كلمة مرور المدير المعتمد/);
    expect(screen.getByText(/الرمز المشترك لا يكفي/)).toBeTruthy();

    // Confirming without a password is blocked.
    fireEvent.click(screen.getByRole('button', { name: /اعتماد الجلسة/ }));
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // With a password the confirm carries the credential.
    fireEvent.change(approverInput, { target: { value: 'sole-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /اعتماد الجلسة/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ managerPin: 'sole-pass' });
  });

  it('shows the same approval field to a non-admin posting a variance', () => {
    useAuthStore.setState({ user: makeUser('cashier') });
    const onConfirm = vi.fn();
    render(
      <InventoryPostSessionDialog
        sessions={[makeSession(5)]}
        isBusy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByLabelText(/كلمة مرور المدير المعتمد/)).toBeTruthy();
  });

  it('shows no approval field for a zero-variance session and confirms without any credential', () => {
    useAuthStore.setState({ user: makeUser('admin') });
    const onConfirm = vi.fn();
    render(
      <InventoryPostSessionDialog
        sessions={[makeSession(0)]}
        isBusy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByLabelText(/كلمة مرور المدير المعتمد/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /اعتماد الجلسة/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ managerPin: '' });
  });
});
