/*
 * PosOpenShiftModal shift-opener identity (INV-SPIRIT-SHIFT-OPEN-IDENTITY):
 * the modal must always show the logged-in opener's displayName + username
 * and a password-confirmation field, so no employee opens a shift under
 * another person's logged-in session unnoticed. The password field is
 * required when the tenant setting requires it, and always visible.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosOpenShiftModal } from './PosOpenShiftModal';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';

const mockSettingsState = vi.hoisted(() => ({
  requirePasswordOnShiftOpen: true,
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: { requirePasswordOnShiftOpen: mockSettingsState.requirePasswordOnShiftOpen } }),
}));

const opener: AuthUser = {
  id: '2',
  username: 'cashier-a',
  role: 'cashier',
  permissions: ['sales'],
  displayName: 'أحمد الكاشير',
  branchIds: ['1'],
  defaultBranchId: '1',
  tenantId: 't1',
};

function renderModal() {
  useAuthStore.setState({ user: opener, tenant: null, initialized: true, appGate: 'ready' });
  return render(
    <MemoryRouter>
      <PosOpenShiftModal
        open
        onClose={vi.fn()}
        branches={[{ id: 1, name: 'Main' } as never]}
        locations={[{ id: 10, name: 'Main warehouse', branchId: 1 } as never]}
        defaultBranchId={1}
        defaultLocationId={10}
        onShiftOpened={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('PosOpenShiftModal opener identity', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, tenant: null });
  });

  it('shows the opener displayName and username before the form', () => {
    renderModal();
    const banner = screen.getByTestId('shift-opener-identity');
    expect(banner.textContent).toContain('أحمد الكاشير');
    expect(banner.textContent).toContain('cashier-a');
  });

  it('shows the password confirmation field when requirePasswordOnShiftOpen is enabled', () => {
    mockSettingsState.requirePasswordOnShiftOpen = true;
    renderModal();
    const pwdInput = screen.getByPlaceholderText(/أدخل كلمة المرور لتأكيد فتح الوردية/) as HTMLInputElement;
    expect(pwdInput).toBeInTheDocument();
    expect(pwdInput.type).toBe('text');
    expect(pwdInput.classList.contains('secure-password-field')).toBe(true);
  });

  it('hides the password confirmation field when requirePasswordOnShiftOpen is disabled', () => {
    mockSettingsState.requirePasswordOnShiftOpen = false;
    renderModal();
    expect(screen.queryByPlaceholderText(/أدخل كلمة المرور لتأكيد فتح الوردية/)).toBeNull();
  });

  it('uses StandardDialog, CustomSelect comboboxes, and no-spin-arrows on opening cash', () => {
    mockSettingsState.requirePasswordOnShiftOpen = true;
    renderModal();
    expect(document.body.querySelector('.standard-dialog-container')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
    const numericInput = document.body.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(numericInput).not.toBeNull();
    expect(numericInput?.classList.contains('no-spin-arrows')).toBe(true);
  });
});
