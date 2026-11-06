/* Updates page (INV-UPDATES-PAGE-BUILT, decision (أ)): /updates is a real
 * in-app page rendering the existing SystemUpdatesSection (current version,
 * channel, changelog, working check button), listed in the menu and found by
 * menu search. The page is gated like settings (settings /
 * canManageSettings); apply stays desktop-only inside the section, because
 * the backend always 400s apply on cloud. Drives the REAL registry, the
 * REAL access maps and the REAL section component.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { appRoutes, navigationItems } from '@/app/router/registry';
import {
  canAccessNavigationItem,
  canAccessPath,
  getRoutePermissionRequirement,
} from '@/app/router/access';
import { UpdatesPage } from './UpdatesPage';
import type { AuthUser } from '@/types/auth';

const mockAuth = vi.hoisted(() => ({ deploymentMode: 'server' as string }));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) =>
      selector({
        activationStatus: { deploymentMode: mockAuth.deploymentMode },
        user: { username: 'admin', role: 'admin', tenantId: 't1' },
      }),
    ),
    { setState: vi.fn(), getState: () => ({ activationStatus: { deploymentMode: mockAuth.deploymentMode } }) },
  ),
}));

const checkResponse = {
  updateAvailable: true,
  currentVersion: '1.1.40',
  latestVersion: '1.1.41',
  patchUrl: 'https://example.invalid/patch-1.1.41.zip',
  changelog: 'إصلاحات وتحسينات',
  cumulativeChangelog: 'إصلاحات وتحسينات تراكمية',
  releases: [],
};

const httpMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/updates/history')) return [];
  if (url.startsWith('/api/updates/check')) return checkResponse;
  return {};
});

vi.mock('@/lib/http', () => ({
  http: (...args: unknown[]) => httpMock(args[0] as string),
  resolveRequestUrl: (path: string) => path,
}));

const adminWithoutSettings: AuthUser = {
  id: 'u-admin',
  username: 'admin',
  role: 'admin',
  permissions: ['dashboard', 'inventory', 'reports', 'treasury'],
  displayName: 'Admin',
  branchIds: ['b-1'],
  defaultBranchId: 'b-1',
};

const settingsManager: AuthUser = {
  ...adminWithoutSettings,
  permissions: ['dashboard', 'canManageSettings'],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('INV-UPDATES-PAGE-BUILT', () => {
  beforeEach(() => {
    mockAuth.deploymentMode = 'server';
    httpMock.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.1.40' }),
    }) as unknown as typeof fetch;
  });

  it('registers the /updates route and navigation entry', () => {
    expect(appRoutes.some((route) => route.path === 'updates')).toBe(true);
    expect(
      navigationItems.some(
        (item) => item.key === 'updates' && item.label === 'التحديثات' && item.to === '/updates',
      ),
    ).toBe(true);
  });

  it('gates /updates like settings', () => {
    expect(getRoutePermissionRequirement('/updates')).toEqual(['settings', 'canManageSettings']);
    expect(
      canAccessNavigationItem(adminWithoutSettings, { key: 'updates', label: 'التحديثات', to: '/updates' }),
    ).toBe(false);
    expect(
      canAccessNavigationItem(settingsManager, { key: 'updates', label: 'التحديثات', to: '/updates' }),
    ).toBe(true);
    expect(canAccessPath(adminWithoutSettings, '/updates')).toBe(false);
    expect(canAccessPath(settingsManager, '/updates')).toBe(true);
  });

  it('renders the update centre for a server tenant, without apply affordances', async () => {
    render(<UpdatesPage />, { wrapper: createWrapper() });
    expect(await screen.findByText('مركز إدارة وتحديثات النظام')).toBeInTheDocument();
    expect(screen.getByText(/الإصدار الحالي: v/)).toBeInTheDocument();
    expect(screen.getByText(/القناة: الإصدارات المستقرة للمؤسسات/)).toBeInTheDocument();
    expect(screen.getByText('فحص التحديثات الآن')).toBeInTheDocument();
    expect(screen.queryByText('تحديث يدوي من ملف ZIP')).not.toBeInTheDocument();
    expect(screen.queryByText('تطبيق الترقية الآن')).not.toBeInTheDocument();
  });

  it('check button calls the check endpoint on a server tenant and shows the available update', async () => {
    render(<UpdatesPage />, { wrapper: createWrapper() });
    const checkButton = await screen.findByText('فحص التحديثات الآن');
    fireEvent.click(checkButton);
    await screen.findByText('يتوفر إصدار جديد معتمد للنظام:');
    expect(httpMock).toHaveBeenCalledWith(expect.stringContaining('/api/updates/check?version='));
    // No dead apply on the web tenant: the dialog offers no apply button,
    // only the desktop-only note — and the banner shows the same note.
    expect(screen.queryByText('تطبيق الترقية الآن')).not.toBeInTheDocument();
    expect(screen.getAllByText('تطبيق الترقية متاح على نسخة الديسكتوب فقط.')).toHaveLength(2);
  });

  it('shows the apply affordances on desktop', async () => {
    mockAuth.deploymentMode = 'desktop';
    render(<UpdatesPage />, { wrapper: createWrapper() });
    expect(await screen.findByText('تحديث يدوي من ملف ZIP')).toBeInTheDocument();
    // Desktop auto-check on mount finds the mocked available update.
    expect(await screen.findByText('تطبيق الترقية الآن')).toBeInTheDocument();
    expect(screen.queryByText('تطبيق الترقية متاح على نسخة الديسكتوب فقط.')).not.toBeInTheDocument();
  });
});
