/*
 * INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2).
 *
 * Drives the REAL AppsStorePage as a super-admin on a warehousing tenant
 * — the exact trial situation: the backend forces posModuleEnabled false
 * for warehousing tenants for any actor, so a POS install can never
 * persist even though the toggle itself goes through.
 *
 * THE RULE: the install toast comes from the server response, never from
 * the requested variables. A rejected install must say so (POS is not
 * available to a warehousing tenant) instead of toasting success; an
 * install the server confirms still toasts success.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppsStorePage } from '@/features/apps-store/pages/AppsStorePage';
import type { AppSettings } from '@/types/domain';

// The api module is mocked through a hoisted factory only: this spec file
// must NOT import the api layer at all (the page-composition check scans
// page files for direct api-layer imports, mocks included).
const apiMocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn() }));

vi.mock('@/features/settings/api/settings.api', () => ({
  settingsApi: apiMocks,
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  systemConfirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning,
    info: toastMocks.info,
  },
  systemConfirm: toastMocks.systemConfirm,
  systemAlert: vi.fn(),
  showToast: vi.fn(),
  useToast: () => ({
    toast: {
      success: toastMocks.success,
      error: toastMocks.error,
      warning: toastMocks.warning,
      info: toastMocks.info,
    },
  }),
}));

const authState = vi.hoisted(() => ({
  user: {
    id: 'u-zs', username: 'zs', role: 'super_admin', permissions: [],
    displayName: 'ZS', branchIds: [], defaultBranchId: '1', tenantId: 'zs',
  },
  tenant: {
    id: 't-warehousing', accountId: 'a1', slug: 'warehousing-tenant', businessName: 'Warehouses Co',
    status: 'active', isTrial: false, trialEndsAt: null, trialDaysRemaining: null,
    plan: 'plan_ultimate', activityType: 'warehousing', features: [],
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

const settingsMock = apiMocks.settings;
const updateMock = apiMocks.update;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AppsStorePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function searchFor(query: string) {
  fireEvent.change(screen.getByPlaceholderText('ابحث في التطبيقات، الموديولات، أو المزايا...'), { target: { value: query } });
}

describe('AppsStorePage install feedback on a warehousing tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.mockResolvedValue({ posModuleEnabled: false } as AppSettings);
  });

  it('says the POS install failed instead of toasting success when the server keeps POS off', async () => {
    // The warehousing force: any actor, posModuleEnabled comes back false.
    updateMock.mockResolvedValue({ posModuleEnabled: false } as AppSettings);

    renderPage();
    await waitFor(() => expect(screen.getByText('نقاط البيع السريعة والكاشير (POS)')).toBeTruthy());
    searchFor('نقاط البيع');

    fireEvent.click(screen.getByRole('button', { name: 'تثبيت وتفعيل' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ posModuleEnabled: true }));

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1));
    expect(toastMocks.error.mock.calls[0][0]).toContain('نقاط البيع');
    expect(toastMocks.error.mock.calls[0][0]).toContain('المخازن');
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('still toasts success for an install the server confirms', async () => {
    // Echo the request back as the saved state: the server persisted it.
    updateMock.mockImplementation((vars: Record<string, unknown>) =>
      Promise.resolve({ ...vars } as AppSettings),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    searchFor('مناديب التوصيل');

    fireEvent.click(screen.getByRole('button', { name: 'تثبيت وتفعيل' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ deliveryRepsModuleEnabled: true }));

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledTimes(1));
    expect(toastMocks.success.mock.calls[0][0]).toContain('إدارة مناديب التوصيل والدليفري');
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
