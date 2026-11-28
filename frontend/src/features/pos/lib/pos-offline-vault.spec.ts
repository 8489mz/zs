import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOfflineProvisionalShift,
  createOfflineQuickCustomer,
  getActiveOfflineProvisionalShifts,
  getOfflineHeldDrafts,
  getOfflineQuickCustomers,
  getPosBootSnapshotSync,
  saveOfflineHeldDraft,
  savePosBootSnapshot,
  updateOfflineProvisionalShiftStatus,
} from './pos-offline-vault';
import { enqueueOfflineSale, getOfflineSalesQueue } from './pos-offline-sync';
import {
  isFastOfflineMode,
  markNetworkFailure,
  markNetworkSuccess,
  resetNetworkCircuitBreakerForTests,
} from '@/lib/network-circuit-breaker';
import { useAuthStore } from '@/stores/auth-store';
import type { CreatePosSaleInput } from '@/features/pos/contracts';
import type { AppSettings, Branch, Customer, Location } from '@/types/domain';

function activateTenant(tenantId: string, accountId: string, userId = 'u-1') {
  const auth = useAuthStore.getState();
  useAuthStore.setState({
    tenant: { ...(auth.tenant ?? {}), id: tenantId, accountId } as typeof auth.tenant,
    user: {
      ...(auth.user ?? {}),
      id: userId,
      username: 'cashier1',
      displayName: 'كاشير 1',
      tenantId,
      accountId,
    } as typeof auth.user,
  });
}

describe('POS SaaS Offline Vault & Circuit Breaker', () => {
  beforeEach(() => {
    localStorage.clear();
    resetNetworkCircuitBreakerForTests();
    activateTenant('tenant-alpha', 'acc-alpha', '101');
  });

  it('persists operational boot snapshot for instant offline F5 reload and strictly isolates tenants', async () => {
    await savePosBootSnapshot({
      settings: { currency: 'EGP', taxRate: 14, storeName: 'متجر ألفا' } as unknown as AppSettings,
      branches: [{ id: '1', name: 'الفرع الرئيسي' }] as unknown as Branch[],
      locations: [{ id: '10', name: 'المخزن الرئيسي', branchId: '1' }] as unknown as Location[],
      openShifts: [{ id: '500', docNo: 'SHIFT-261128-0001', openedById: '101', status: 'open' }],
      customers: [{ id: '900', name: 'أحمد محمد', phone: '01000000001' }] as unknown as Customer[],
    });

    const alphaSnap = getPosBootSnapshotSync();
    expect(alphaSnap?.settings?.storeName).toBe('متجر ألفا');
    expect(alphaSnap?.branches).toHaveLength(1);
    expect(alphaSnap?.locations).toHaveLength(1);
    expect(alphaSnap?.openShifts).toHaveLength(1);
    expect(alphaSnap?.customers).toHaveLength(1);

    // Switch to Tenant Beta — must NEVER see Tenant Alpha's cached POS state
    activateTenant('tenant-beta', 'acc-beta', '202');
    expect(getPosBootSnapshotSync()).toBeNull();
  });

  it('opens a provisional morning shift offline, scopes it per tenant, and clears it once synced', () => {
    const shift = createOfflineProvisionalShift({
      openingCash: 750,
      branchId: 1,
      locationId: 10,
      note: 'فتح صباحي بدون نت',
      terminalCode: 'T4A2',
    });

    expect(shift.id).toMatch(/^off-shift-/);
    expect(shift.openingCash).toBe(750);
    expect(getActiveOfflineProvisionalShifts()).toHaveLength(1);

    activateTenant('tenant-beta', 'acc-beta', '202');
    expect(getActiveOfflineProvisionalShifts()).toHaveLength(0);

    activateTenant('tenant-alpha', 'acc-alpha', '101');
    updateOfflineProvisionalShiftStatus(shift.id, 'synced');
    expect(getActiveOfflineProvisionalShifts()).toHaveLength(0);
  });

  it('supports offline held drafts and quick customers without cross-tenant leakage', () => {
    const held = saveOfflineHeldDraft({
      items: [{ productId: 1, name: 'صنف تجريبي', qty: 2, price: 50 }],
      orderType: 'takeaway',
    });
    const cust = createOfflineQuickCustomer({
      name: 'عميل أوفلاين',
      phone: '01122334455',
      address: 'شارع التحرير',
    });

    expect(held.id).toMatch(/^local-held-/);
    expect(cust.id).toMatch(/^off-cust-/);
    expect(getOfflineHeldDrafts()).toHaveLength(1);
    expect(getOfflineQuickCustomers()).toHaveLength(1);

    activateTenant('tenant-beta', 'acc-beta', '202');
    expect(getOfflineHeldDrafts()).toHaveLength(0);
    expect(getOfflineQuickCustomers()).toHaveLength(0);
  });

  it('keeps payload.note unmodified in enqueueOfflineSale so idempotency requestHash never drifts', () => {
    const queued = enqueueOfflineSale(
      { note: 'ملاحظة العميل الأصلية', expectedTotal: 100, cart: [] } as unknown as CreatePosSaleInput,
      'stable-uuid-1',
    );
    expect(queued.payload.note).toBe('ملاحظة العميل الأصلية');
    expect((queued.payload as unknown as { offlineDocNo?: string }).offlineDocNo).toMatch(/^INV-/);
    expect(getOfflineSalesQueue()).toHaveLength(1);
  });

  it('opens and closes the fast-offline network circuit breaker when WAN drops while LAN stays up', () => {
    expect(isFastOfflineMode()).toBe(false);
    markNetworkFailure('http_timeout');
    expect(isFastOfflineMode()).toBe(true);
    markNetworkSuccess('health_probe');
    expect(isFastOfflineMode()).toBe(false);
  });
});
