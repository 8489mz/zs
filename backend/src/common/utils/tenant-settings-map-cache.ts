/*
 * Shared tenant settings-map cache (Phase 1 B2 — the sales|settings pair break).
 *
 * The settings map is loaded by the sales write path (getTenantSettingsMap in
 * SalesWriteService) and invalidated by the settings path (SettingsCache).
 * It used to live as a static field on SalesWriteService, which forced
 * settings to import the sales module — the settings->sales leg of the
 * sales|settings circular pair. The store now lives here, in the neutral
 * shared layer: both sides import this file, neither imports the other.
 * One store, one invalidation function — MOVE, never duplicate.
 */

export type TenantSettingsMapEntry = {
  map: Map<string, any>;
  expiresAt: number;
};

export const tenantSettingsMapCache = new Map<string, TenantSettingsMapEntry>();

export function invalidateTenantSettingsMapCache(tenantId?: string): void {
  if (tenantId) {
    tenantSettingsMapCache.delete(tenantId);
  } else {
    tenantSettingsMapCache.clear();
  }
}
