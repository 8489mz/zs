/*
 * F17 (trial problem 29): the sidebar must follow feature overrides.
 *
 * WHAT WAS WRONG (live trial 2026-11-21, problem 29): on test10k
 * (wholesale_van) POS is ACTIVE in the Apps Store and /pos works by
 * direct URL, but the admin sidebar has NO 'pos' or 'cash-drawer'
 * entry. The P10 super-admin override grants 'pos' + 'cashDrawer'
 * above the mode pattern and the backend builds tenant.features
 * override-aware, so the route guard (isRouteAllowedInVertical P10
 * escape) and getPosAvailability both honour the grant — but the
 * sidebar's isWholesaleVanVertical / isWarehousingVertical blocks in
 * useVisibleNavigationItems return false for pos/cash-drawer
 * UNCONDITIONALLY, and they run BEFORE the P10-aware gate at the end
 * of the same filter, so the granted items never render.
 *
 * WHAT THIS PINS (the REAL hook + the REAL navigation registry, the
 * auth store tenant set the way access.spec.ts sets it, because
 * canAccessNavigationItem reads the store tenant, not the hook arg):
 * - wholesale_van + 'pos' + 'cashDrawer' in features -> pos AND
 *   cash-drawer visible (FAILS on base: both hidden).
 * - wholesale_van + settings.posGrantedByOverride (the read-path flag
 *   for the same grant, module switch still off) -> both visible
 *   (FAILS on base).
 * - wholesale_van + 'pos' only -> pos visible, cash-drawer stays
 *   hidden: the drawer needs its own 'cashDrawer' grant (FAILS on
 *   base for pos).
 * - warehousing + both grants -> both visible (FAILS on base).
 * - no grant -> both stay hidden on both verticals (control, passes
 *   on base: the fix grants nothing by itself).
 * - cashier user (not just admin) with the grant sees both items.
 * - F8 regression guard: 'price-lists' stays visible on wholesale_van
 *   with and without the pos grant.
 * - kds/signage stay hidden even with the grant: a later `return
 *   false` hides them as direct sidebar items for every vertical.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVisibleNavigationItems } from './use-visible-navigation-items';
import { useAuthStore } from '@/stores/auth-store';
import type { AppSettings } from '@/types/domain';
import type { AuthTenant, AuthUser } from '@/types/auth';

const adminUser: AuthUser = {
  id: 'u-admin',
  username: 'admin',
  role: 'admin',
  permissions: ['*'],
  displayName: 'Admin',
  branchIds: [],
  defaultBranchId: '',
};

const cashierUser: AuthUser = {
  id: 'u-cashier',
  username: 'cashier',
  role: 'cashier',
  permissions: ['sales', 'cashDrawer'],
  displayName: 'Cashier',
  branchIds: [],
  defaultBranchId: '',
};

const BASE_FEATURES = ['deliveryReps', 'sales', 'catalog', 'products', 'inventory', 'customers', 'treasury', 'reports', 'pricing'];

function makeTenant(vertical: string, features: string[]): AuthTenant {
  return {
    id: 't-van',
    accountId: 'a-van',
    slug: 'van-client',
    businessName: 'Van Client',
    activityType: vertical,
    status: 'active',
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    features,
  };
}

function makeSettings(vertical: string, overrides: Partial<AppSettings> = {}): AppSettings {
  return { storeName: 'Van Client', businessIndustry: vertical, posModuleEnabled: false, ...overrides };
}

function visibleKeys(user: AuthUser, tenant: AuthTenant, settings: AppSettings): string[] {
  useAuthStore.setState({ user, tenant });
  const { result } = renderHook(() =>
    useVisibleNavigationItems({ user, tenant, settings, isEtaActive: false, totalOnlineOrdersCount: 0 }),
  );
  return result.current.map((item) => item.key);
}

describe('F17: sidebar follows feature overrides (trial problem 29)', () => {
  it('wholesale_van without any grant hides pos and cash-drawer', () => {
    const keys = visibleKeys(adminUser, makeTenant('wholesale_van', [...BASE_FEATURES]), makeSettings('wholesale_van'));
    expect(keys).not.toContain('pos');
    expect(keys).not.toContain('cash-drawer');
  });

  it('wholesale_van with pos + cashDrawer in features shows both', () => {
    const keys = visibleKeys(
      adminUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('wholesale_van'),
    );
    expect(keys).toContain('pos');
    expect(keys).toContain('cash-drawer');
  });

  it('wholesale_van with posGrantedByOverride shows both even with the module switch off', () => {
    const keys = visibleKeys(
      adminUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('wholesale_van', { posModuleEnabled: false, posGrantedByOverride: true }),
    );
    expect(keys).toContain('pos');
    expect(keys).toContain('cash-drawer');
  });

  it('wholesale_van with pos only shows pos but keeps cash-drawer hidden', () => {
    const keys = visibleKeys(
      adminUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos']),
      makeSettings('wholesale_van'),
    );
    expect(keys).toContain('pos');
    expect(keys).not.toContain('cash-drawer');
  });

  it('wholesale_van cashier with the grant sees both items', () => {
    const keys = visibleKeys(
      cashierUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('wholesale_van'),
    );
    expect(keys).toContain('pos');
    expect(keys).toContain('cash-drawer');
  });

  it('warehousing without any grant hides pos and cash-drawer', () => {
    const keys = visibleKeys(adminUser, makeTenant('warehousing', [...BASE_FEATURES]), makeSettings('warehousing'));
    expect(keys).not.toContain('pos');
    expect(keys).not.toContain('cash-drawer');
  });

  it('warehousing with pos + cashDrawer in features shows both', () => {
    const keys = visibleKeys(
      adminUser,
      makeTenant('warehousing', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('warehousing'),
    );
    expect(keys).toContain('pos');
    expect(keys).toContain('cash-drawer');
  });

  it('F8 regression: price-lists stays visible on wholesale_van with and without the pos grant', () => {
    const withoutGrant = visibleKeys(adminUser, makeTenant('wholesale_van', [...BASE_FEATURES]), makeSettings('wholesale_van'));
    expect(withoutGrant).toContain('price-lists');
    const withGrant = visibleKeys(
      adminUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('wholesale_van'),
    );
    expect(withGrant).toContain('price-lists');
  });

  it('kds and signage stay hidden even with the pos grant', () => {
    const keys = visibleKeys(
      adminUser,
      makeTenant('wholesale_van', [...BASE_FEATURES, 'pos', 'cashDrawer']),
      makeSettings('wholesale_van'),
    );
    expect(keys).not.toContain('kds');
    expect(keys).not.toContain('signage');
  });
});
