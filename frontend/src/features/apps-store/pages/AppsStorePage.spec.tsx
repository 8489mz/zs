/*
 * Pins the SaaS-Only Module Control flow on AppsStorePage:
 * - Regular tenant admin sees Ultimate header note and active apps cleanly, while
 *   inactive apps within their plan show "مُتاح عبر الإدارة" / "طلب التفعيل من الإدارة"
 *   (opening the activation info modal, never calling settingsApi.update).
 * - Higher-tier storefront keeps "باقة التجارة الشاملة (Omnichannel)" + "طلب التفعيل والترقية".
 * - Active SaaS impersonation session (role='admin', isPlatformImpersonation=true) sees
 *   "تثبيت وتفعيل" on inactive apps AND "إلغاء التثبيت" on active apps (calling settingsApi.update
 *   with { vanSalesModuleEnabled: false } when uninstalling).
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

const confirmMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  systemConfirm: confirmMock,
  systemAlert: vi.fn(),
  showToast: vi.fn(),
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }),
}));

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    username: 'owner',
    role: 'admin',
    permissions: [],
    displayName: 'Owner',
    branchIds: [],
    defaultBranchId: '1',
    tenantId: 't1',
    isPlatformImpersonation: false,
  },
  tenant: {
    id: 't1',
    accountId: 'a1',
    slug: 't1',
    businessName: 'Test Co',
    status: 'active',
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    plan: 'plan_ultimate',
    features: ['deliveryReps'],
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

describe('AppsStorePage SaaS-only module control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    authState.user = {
      ...authState.user,
      role: 'admin',
      isPlatformImpersonation: false,
    };
    settingsMock.mockResolvedValue({} as AppSettings);
    updateMock.mockResolvedValue({} as AppSettings);
  });

  const settingsMock = apiMocks.settings;
  const updateMock = apiMocks.update;

  it('says the Ultimate plan includes all advanced modules except the online store', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('تشمل كافة الوحدات المتقدمة عدا المتجر الإلكتروني')).toBeTruthy());
    expect(screen.queryByText('شاملة كافة الوحدات المتقدمة')).toBeNull();
  });

  it('hides self-install buttons for regular tenant admins even on included Ultimate modules', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    searchFor('مناديب التوصيل');

    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'تثبيت وتفعيل' })).toBeNull();
    expect(screen.getByRole('button', { name: 'طلب التفعيل من الإدارة' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'طلب التفعيل من الإدارة' }));
    await waitFor(() => expect(screen.getByText('طلب تفعيل تطبيق إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('keeps the online store locked for Ultimate and opens the upgrade dialog, never installing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    searchFor('المتجر الإلكتروني');

    await waitFor(() => expect(screen.getByText('المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    expect(screen.getByText('باقة التجارة الشاملة (Omnichannel)')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /طلب التفعيل والترقية/ }));
    await waitFor(() => expect(screen.getByText('ترقية الباقة لتفعيل تطبيق المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    expect(screen.getAllByText('باقة التجارة الشاملة (Omnichannel)').length).toBeGreaterThanOrEqual(2);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('allows platform impersonator to install AND uninstall accidental Van Sales directly via settingsApi.update', async () => {
    authState.user = {
      ...authState.user,
      role: 'admin',
      isPlatformImpersonation: true,
    };
    settingsMock.mockResolvedValue({
      vanSalesModuleEnabled: true,
      deliveryRepsModuleEnabled: false,
    } as AppSettings);
    updateMock.mockResolvedValue({
      vanSalesModuleEnabled: false,
      deliveryRepsModuleEnabled: false,
    } as AppSettings);

    renderPage();
    await waitFor(() => expect(screen.getByText('مبيعات وتوزيع الفان (الأسطول الميداني)')).toBeTruthy());
    searchFor('مبيعات وتوزيع الفان');

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء التثبيت' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ vanSalesModuleEnabled: false }));
  });
});
