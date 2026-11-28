import { useEffect, useRef, useState, useCallback } from 'react';
import { posApi } from '@/features/pos/api/pos.api';
import {
  saveCatalogToStorage,
  clearCatalogStorage,
  getCatalogVersionFromStorage,
  getCatalogCountFromStorage,
  getLastSyncedAtFromStorage,
  getStoredTenantIdFromStorage,
} from '@/features/pos/lib/pos-catalog-storage';
import { isPosCatalogWarmupTenantStable, shouldDownloadFullCatalog } from '@/features/pos/lib/pos-catalog-sync-policy';
import { getPendingOfflineSoldQuantities } from '@/features/pos/lib/pos-offline-sync';
import { useAuthStore } from '@/stores/auth-store';

interface PosCatalogWarmupOptions {
  branchId?: string;
  locationId?: string;
  enabled?: boolean;
}

const WARMUP_INITIAL_DELAY_MS = 3500;
const HEARTBEAT_INTERVAL_MS = 300_000; // 5 minutes — cheap version check; full reload policy in pos-catalog-sync-policy.ts

function getCurrentCatalogTenantId(): string {
  const auth = useAuthStore.getState();
  return String(auth.user?.tenantId || auth.tenant?.id || '').trim();
}

export function usePosCatalogWarmup({ branchId, locationId, enabled = true }: PosCatalogWarmupOptions = {}) {
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState<string | null>(null);
  const [totalCached, setTotalCached] = useState<number>(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const syncCatalog = useCallback(async () => {
    if (inFlightRef.current || !enabled) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    // Capture ownership BEFORE the first request. Never assign an old response
    // to the tenant that happens to be active after the network round trip.
    const activeTenantId = getCurrentCatalogTenantId();
    if (!activeTenantId) return;
    const tenantIsStable = () => isPosCatalogWarmupTenantStable(activeTenantId, getCurrentCatalogTenantId());

    inFlightRef.current = true;
    try {
      const remote = await posApi.getCatalogVersion();
      if (!remote?.version || !tenantIsStable()) return;
      const [storedVersion, storedCount, storedLastSync, storedTenant] = await Promise.all([
        getCatalogVersionFromStorage(),
        getCatalogCountFromStorage(),
        getLastSyncedAtFromStorage(),
        getStoredTenantIdFromStorage(),
      ]);
      if (!tenantIsStable()) return;

      setCatalogVersion(storedVersion);
      setTotalCached(storedCount);
      setLastSyncedAt(storedLastSync);

      // If remote has 0 products, purge local storage immediately
      if (remote.totalCount === 0) {
        if (!tenantIsStable()) return;
        await clearCatalogStorage();
        try {
          localStorage.removeItem('zsystems_pos_catalog_cache');
        } catch {}
        setCatalogVersion(remote.version);
        setTotalCached(0);
        return;
      }

      // PERF-9: re-download only when the catalog really changed, tenant changed, or the offline copy is > 1 hour old.
      if (!shouldDownloadFullCatalog({
        remoteVersion: remote.version,
        storedVersion,
        storedCount,
        lastSyncedAt: storedLastSync,
        tenantId: activeTenantId,
        storedTenantId: storedTenant,
      })) {
        return;
      }

      setIsWarmingUp(true);

      const products = await posApi.lookupProducts({
        fullCatalog: true,
        limit: 25000,
        branchId,
        locationId,
      });

      if (Array.isArray(products) && tenantIsStable()) {
        // The authenticated identity may have changed while 25k SKU records were
        // downloading. Never write that response under a different tenant.
        await saveCatalogToStorage(products, remote.version, activeTenantId, getPendingOfflineSoldQuantities());
        if (!tenantIsStable()) return;
        setCatalogVersion(remote.version);
        setTotalCached(products.length);
        setLastSyncedAt(new Date().toISOString());
      }
    } catch {
      // Silent background failure: POS operations must never be interrupted
    } finally {
      inFlightRef.current = false;
      setIsWarmingUp(false);
    }
  }, [branchId, locationId, enabled]);

  useEffect(() => {
    let active = true;

    // Load initial stored metadata
    Promise.all([
      getCatalogVersionFromStorage(),
      getCatalogCountFromStorage(),
      getLastSyncedAtFromStorage(),
    ]).then(([version, count, lastSync]) => {
      if (active) {
        setCatalogVersion(version);
        setTotalCached(count);
        setLastSyncedAt(lastSync);
      }
    });

    // Schedule initial warmup after UI has rendered and settled
    const initialTimer = setTimeout(() => {
      if (active) {
        syncCatalog();
      }
    }, WARMUP_INITIAL_DELAY_MS);

    // Periodic heartbeat to detect catalog/price edits from other cashiers
    const intervalTimer = setInterval(() => {
      if (active && typeof document !== 'undefined' && !document.hidden) {
        syncCatalog();
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [syncCatalog]);

  return {
    isWarmingUp,
    catalogVersion,
    totalCached,
    lastSyncedAt,
    refreshCatalog: syncCatalog,
  };
}
