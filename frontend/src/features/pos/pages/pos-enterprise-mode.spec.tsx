/*
 * I5-D1: POS reads as intentionally off in Enterprise Trading mode
 * (INV-IMPORT-POS-ENTERPRISE-MODE).
 *
 * WHAT WAS WRONG (live trial phase 2, problem 1): on the trial tenant
 * ("اختبار سرعة 10K", operation mode "مؤسسة تجارية متقدمة (Enterprise
 * Trading)") /pos showed the disabled state and the sales register
 * offered no working sale entry — its only creation button, "فتح
 * الكاشير", linked straight to that same disabled page.
 *
 * WHAT THE GROUNDING PROVED: POS-off is BY DESIGN, not a code defect.
 * The /pos route exists and its guard only requires the 'sales'
 * feature; POS-off is decided by the tenant's industry vertical and
 * the stored posModuleEnabled flag, never by the Enterprise mode
 * toggle — SettingsMainForm forces enableEnterpriseFeatures=true AND
 * posModuleEnabled=false at every save for a warehousing/wholesale/
 * contracting/maritime vertical, so switching the mode toggle to
 * Simple Retail would NOT re-enable POS (PosPage gates on the
 * vertical directly, and the next save re-forces the flag). The real
 * defects were in the UI: (1) the register's "فتح الكاشير" link was a
 * dead end; (2) the /pos disabled state never named the current mode
 * nor the working sale path (sales orders -> invoice, I3-D3).
 *
 * WHAT THIS PINS (helper unit cases + the real PosPage and
 * SalesWorkspaceHeader, settings mocked per case):
 * - The shared rule: warehousing/wholesale/contracting/maritime/
 *   services industries and posModuleEnabled=false are all disabled;
 *   a retail tenant with the module on is available.
 * - Enterprise mode: /pos names "مؤسسة تجارية متقدمة (Enterprise
 *   Trading)", says POS is intentionally off in this mode, and offers
 *   the working path — an "أوامر البيع" button to /sales/orders.
 *   THIS case fails on base (no mode line, no orders button).
 * - Module-off, non-enterprise: the settings-path message renders and
 *   NO enterprise line or orders button appears.
 * - Register header: no link to /pos at all when POS is off, and a
 *   "فتح الكاشير" link to /pos when POS is on — pinned in the header's
 *   own spec (features/sales/components/sales-workspace-header.spec.tsx),
 *   kept out of this file because the feature-boundary guard forbids
 *   cross-feature imports. The off-case asserts on the link href, not
 *   on the label: on base the label is the raw key (no fallback there),
 *   so a text-only assertion would pass vacuously.
 *
 * FAIL-ON-BASE NOTE: this spec is new, so a pristine base tree has no
 * file to run. Proven on a base tree with only this spec + the helper
 * copied in (production code at base): the two enterprise render cases
 * fail there (no mode line, no orders button) while the 11 helper cases
 * and the preserved-behavior module-off case pass — the helper is a
 * verbatim extraction of the base rule, so only the render cases pin
 * the fix. Either way the exit is 1 on base, 0 on the fix tree.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosPage } from '@/features/pos/pages/PosPage';
import { getPosAvailability, isPosAvailable } from '@/features/pos/lib/pos-availability';

const { useSettingsQueryMock } = vi.hoisted(() => ({
  useSettingsQueryMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: useSettingsQueryMock,
}));

vi.mock('@/features/pos/components/PosWorkspace', () => ({
  PosWorkspace: () => <div>pos-workspace-stub</div>,
}));

const ENTERPRISE_MODE_LINE =
  'النمط الحالي: مؤسسة تجارية متقدمة (Enterprise Trading) — نقاط البيع مغلقة عن قصد في هذا النمط، وتتم المبيعات عبر أوامر البيع ثم تحويلها إلى فواتير.';

function renderScreen(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

function setSettings(settings: Record<string, unknown> | null) {
  useSettingsQueryMock.mockReturnValue({ data: settings, isLoading: false });
}

describe('I5-D1 POS availability rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['warehousing industry', { businessIndustry: 'warehousing' }, false, 'warehousing'],
    ['warehouse industry', { businessIndustry: 'warehouse' }, false, 'warehousing'],
    ['wholesale industry', { businessIndustry: 'wholesale' }, false, 'wholesale'],
    ['wholesale van industry', { businessIndustry: 'wholesale_van' }, false, 'wholesale'],
    ['contracting industry', { businessIndustry: 'contracting' }, false, 'specialized'],
    ['maritime industry', { businessIndustry: 'maritime' }, false, 'specialized'],
    ['services industry', { businessIndustry: 'services' }, false, 'specialized'],
    ['module off, retail industry', { businessIndustry: 'retail_general', posModuleEnabled: false }, false, 'module-off'],
    ['module off via activityType', { activityType: 'warehousing', posModuleEnabled: true }, false, 'warehousing'],
    ['retail industry, module on', { businessIndustry: 'retail_general', posModuleEnabled: true }, true, null],
    ['no settings at all', null, true, null],
  ])('%s -> available=%s reason=%s', (_label, settings, available, reason) => {
    expect(getPosAvailability(settings)).toEqual({ available, reason });
    expect(isPosAvailable(settings)).toBe(available);
  });

  it('enterprise warehousing tenant: /pos names the Enterprise mode and offers sales orders, never the workspace', () => {
    // The trial tenant shape: warehousing vertical, enterprise mode on,
    // POS module forced off at every settings save.
    setSettings({ businessIndustry: 'warehousing', activityType: 'warehousing', posModuleEnabled: false, enableEnterpriseFeatures: true });
    renderScreen(<PosPage />);

    expect(screen.getByText(ENTERPRISE_MODE_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أوامر البيع' })).toBeInTheDocument();
    expect(screen.queryByText('pos-workspace-stub')).toBeNull();
  });

  it('enterprise mode with the module off on a retail industry: mode line and orders button still render', () => {
    setSettings({ businessIndustry: 'retail_general', posModuleEnabled: false, enableEnterpriseFeatures: true });
    renderScreen(<PosPage />);

    expect(screen.getByText(ENTERPRISE_MODE_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أوامر البيع' })).toBeInTheDocument();
    // The settings-path message still applies to this branch.
    expect(screen.getByText(/يمكنك تفعيله من شاشة إعدادات الموديولات/)).toBeInTheDocument();
  });

  it('module off, non-enterprise retail: settings-path message, no enterprise line, no orders button', () => {
    setSettings({ businessIndustry: 'retail_general', posModuleEnabled: false, enableEnterpriseFeatures: false });
    renderScreen(<PosPage />);

    expect(screen.getByText(/يمكنك تفعيله من شاشة إعدادات الموديولات/)).toBeInTheDocument();
    expect(screen.queryByText(ENTERPRISE_MODE_LINE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'أوامر البيع' })).toBeNull();
    expect(screen.queryByText('pos-workspace-stub')).toBeNull();
  });
});
