import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppsStorePage } from '@/features/apps-store/pages/AppsStorePage';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import {
  isTieredBandPlan,
  resolveBandForVertical,
  resolveFrontendCatalogLevel,
  resolveFrontendPlanDisplayName,
  resolveFrontendPlanRank,
} from '@/shared/verticals/plan-tiers';
import { tenantHasFeature } from '@/app/router/access';
import type { AppSettings } from '@/types/domain';

const apiMocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn() }));

vi.mock('@/features/settings/api/settings.api', () => ({
  settingsApi: apiMocks,
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
    businessName: 'Test Store',
    status: 'active' as const,
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    plan: 'plan_basic',
    planId: 'plan_basic',
    features: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  } as Record<string, any>,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

function makeSettings(): AppSettings {
  return {
    businessName: 'Test Store',
    businessIndustry: 'retail_general',
    activityType: 'retail_general',
    vatRate: 0.14,
    currency: 'EGP',
    invoicePrefix: 'INV',
    receiptFooter: '',
    posModuleEnabled: true,
    inventoryModuleEnabled: false,
    purchasesModuleEnabled: false,
    crmModuleEnabled: false,
    deliveryRepsModuleEnabled: false,
    vanSalesModuleEnabled: false,
    servicesModuleEnabled: false,
    installmentsModuleEnabled: false,
    fixedAssetsModuleEnabled: false,
    taxDeclarationModuleEnabled: false,
    hrModuleEnabled: false,
  } as unknown as AppSettings;
}

function renderStore() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppsStorePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function searchFor(query: string) {
  fireEvent.change(
    screen.getByPlaceholderText('ابحث في التطبيقات، الموديولات، أو المزايا...'),
    { target: { value: query } },
  );
}

describe('AppsStorePage & shared plan-tier compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { ...authState.user, role: 'admin', isPlatformImpersonation: false };
    apiMocks.settings.mockResolvedValue(makeSettings());
    apiMocks.update.mockResolvedValue(makeSettings());
  });

  it('displays Basic Plan correctly on plan_basic instead of masquerading as Ultimate', async () => {
    authState.tenant = {
      ...authState.tenant,
      plan: 'plan_basic',
      planId: 'plan_basic',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer'],
    };

    renderStore();

    await waitFor(() => expect(screen.getByText('الباقة الأساسية')).toBeTruthy());
    expect(screen.queryByText('تشمل كافة الوحدات المتقدمة عدا المتجر الإلكتروني')).toBeNull();
  });

  it('recognizes deliveryReps on tier_band1_L2 without requiring Ultimate upgrade', async () => {
    authState.tenant = {
      ...authState.tenant,
      plan: 'tier_band1_L2',
      planId: 'tier_band1_L2',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
    };

    renderStore();

    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    expect(screen.getByText('تجزئة عامة — متعدد الفروع')).toBeTruthy();

    searchFor('مناديب التوصيل');
    await waitFor(() => expect(screen.getByText('إدارة مناديب التوصيل والدليفري')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'طلب التفعيل من الإدارة' })).toBeTruthy();
    expect(screen.queryByText('طلب التفعيل والترقية')).toBeNull();
  });

  it('unlocks CRM app on plan_pro for SaaS impersonator without broken crm featureFlag gate', async () => {
    authState.user = { ...authState.user, isPlatformImpersonation: true };
    authState.tenant = {
      ...authState.tenant,
      plan: 'plan_pro',
      planId: 'plan_pro',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
    };

    renderStore();

    await waitFor(() => expect(screen.getByText('إدارة علاقات العملاء والصفقات (CRM)')).toBeTruthy());
    searchFor('علاقات العملاء');
    await waitFor(() => expect(screen.getByText('إدارة علاقات العملاء والصفقات (CRM)')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'تثبيت وتفعيل' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('طلب التفعيل والترقية')).toBeNull();
  });

  it('keeps frontend plan-tiers helper and tenantHasFeature aligned across Band 4 & Band 5 verticals', () => {
    expect(isTieredBandPlan('tier_band3_L2')).toBe(true);
    expect(isTieredBandPlan('BAND5_L3')).toBe(true);
    expect(isTieredBandPlan('plan_pro')).toBe(false);

    expect(resolveFrontendPlanRank('plan_basic')).toBe(1);
    expect(resolveFrontendPlanRank('tier_band4_L2')).toBe(2);
    expect(resolveFrontendPlanRank('tier_band5_L3')).toBe(3);
    expect(resolveFrontendPlanRank('plan_omnichannel')).toBe(4);

    expect(resolveFrontendCatalogLevel('BAND2_L1')).toBe('L1');
    expect(resolveFrontendCatalogLevel('tier_band2_L2')).toBe('L2');
    expect(resolveFrontendCatalogLevel('OMNICHANNEL')).toBe('L3');

    expect(resolveBandForVertical(resolveCurrentVertical({ activityType: 'restaurant' } as any))).toBe(3);
    expect(resolveBandForVertical(resolveCurrentVertical({ activityType: 'manufacturing' } as any))).toBe(4);
    expect(resolveBandForVertical(resolveCurrentVertical({ activityType: 'contracting' } as any))).toBe(5);
    expect(resolveFrontendPlanDisplayName('tier_band3_L2')).toBe('مطاعم وكافيهات — ثلاثة فروع');

    // Band 4 L1 tenant with explicit features must NOT bypass hr / accounting gates
    const mfgL1Tenant = {
      activityType: 'manufacturing',
      planId: 'tier_band4_L1',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'manufacturing'],
    } as any;
    expect(tenantHasFeature('manufacturing', mfgL1Tenant, null)).toBe(true);
    expect(tenantHasFeature('hr', mfgL1Tenant, null)).toBe(false);
    expect(tenantHasFeature('accounting', mfgL1Tenant, null)).toBe(false);

    // Band 5 all-inclusive vertical keeps suite features
    const contractingTenant = {
      activityType: 'contracting',
      planId: 'tier_band5_L3',
      features: ['contracting'],
    } as any;
    expect(tenantHasFeature('hr', contractingTenant, null)).toBe(true);
    expect(tenantHasFeature('accounting', contractingTenant, null)).toBe(true);
  });
});
