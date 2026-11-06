/*
New file: frontend/src/features/apps-store/pages/AppsStorePage.spec.tsx
Pins the tenant-admin install gate end to end (INV-ULTIMATE-TENANT-SELF-INSTALL).

THE GAP: a tenant admin on the Ultimate plan saw every installable app as
locked — handleToggle blocked ALL tenant-admin installs with a
super-admin-only toast, even though isAppAllowedByPlan already said the
apps were allowed, and the card agreed with the block.

THE RULE: a tenant admin installs an app his plan allows himself. The
install button calls settingsApi.update with the app key; the block (and
the super-admin-only toast) applies only to apps above the tenant's plan,
and uninstall stays super-admin-only. The online store (plan_omnichannel)
stays locked for Ultimate, and the Ultimate header note says so
explicitly instead of "شاملة كافة الوحدات المتقدمة".

WHAT THIS PINS, driving the REAL AppsStorePage as a real Ultimate tenant
(admin role, plan_ultimate, deliveryReps feature granted), settings mocked
at the api boundary, all apps inactive:
- The header note reads "تشمل كافة الوحدات المتقدمة عدا المتجر الإلكتروني".
- Searching each allowed app (table selection, couriers, van sales,
  barcode scales) shows "تثبيت وتفعيل" and never "طلب التفعيل والترقية".
- Installing the couriers app calls settingsApi.update with
  { deliveryRepsModuleEnabled: true }.
- The online store shows the lock badge "باقة التجارة الشاملة
  (Omnichannel)" and "طلب التفعيل والترقية"; opening it shows the upgrade
  dialog ("متاح ضمن: باقة التجارة الشاملة (Omnichannel)") and never calls
  settingsApi.update.
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

const settingsMock = apiMocks.settings;
const updateMock = apiMocks.update;

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1', username: 'owner', role: 'admin', permissions: [],
    displayName: 'Owner', branchIds: [], defaultBranchId: '1', tenantId: 't1',
  },
  tenant: {
    id: 't1', accountId: 'a1', slug: 't1', businessName: 'Test Co',
    status: 'active', isTrial: false, trialEndsAt: null, trialDaysRemaining: null,
    plan: 'plan_ultimate', features: ['deliveryReps'],
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

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

describe('AppsStorePage Ultimate tenant self-install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMock.mockResolvedValue({} as AppSettings);
    updateMock.mockResolvedValue({} as AppSettings);
  });

  it('says the Ultimate plan includes all advanced modules except the online store', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('تشمل كافة الوحدات المتقدمة عدا المتجر الإلكتروني')).toBeTruthy());
    expect(screen.queryByText('شاملة كافة الوحدات المتقدمة')).toBeNull();
  });

  it.each([
    ['تحديد الطاولة', 'تحديد الطاولة والعميل بالسلة'],
    ['مناديب التوصيل', 'إدارة مناديب التوصيل والدليفري'],
    ['مبيعات وتوزيع الفان', 'مبيعات وتوزيع الفان (الأسطول الميداني)'],
    ['تشفير باركود', 'تشفير باركود الموازين الإلكترونية'],
  ])('Ultimate tenant sees %s as installable, never as an upgrade request', async (query, title) => {
    renderPage();
    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    searchFor(query);

    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'تثبيت وتفعيل' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('طلب التفعيل والترقية')).toBeNull();
    expect(screen.queryByText('متاح للتثبيت')).toBeTruthy();
  });

  it('installs an allowed app through settingsApi.update', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    searchFor('مناديب التوصيل');

    fireEvent.click(screen.getByRole('button', { name: 'تثبيت وتفعيل' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ deliveryRepsModuleEnabled: true }));
  });

  it('keeps the online store locked for Ultimate and opens the upgrade dialog, never installing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    searchFor('المتجر الإلكتروني');

    await waitFor(() => expect(screen.getByText('المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    expect(screen.getByText('باقة التجارة الشاملة (Omnichannel)')).toBeTruthy();
    expect(screen.queryByText('تثبيت وتفعيل')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /طلب التفعيل والترقية/ }));
    // The upgrade dialog opens (its title names the app); the card badge and
    // the dialog banner agree on the required plan.
    await waitFor(() => expect(screen.getByText('ترقية الباقة لتفعيل تطبيق المتجر الإلكتروني السحابي وبوابات الدفع')).toBeTruthy());
    expect(screen.getAllByText('باقة التجارة الشاملة (Omnichannel)').length).toBeGreaterThanOrEqual(2);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
