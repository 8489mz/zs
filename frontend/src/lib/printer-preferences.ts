import { useAuthStore } from '@/stores/auth-store';
import type { AppSettings } from '@/types/domain';

export type PrinterTransportMode = 'electron' | 'bridge';
export type PrinterRole = 'cashier' | 'barcode' | 'document' | 'kitchen';

export const WORKSTATION_PRINTER_PREFS_KEY = 'z_erp_workstation_printer_prefs_v1';

type RolePrinterMap = Partial<Record<PrinterRole, string>>;

interface TenantPrinterPrefs {
  electron?: RolePrinterMap;
  bridge?: RolePrinterMap;
}

type StoredPrinterPrefsByTenant = Record<string, TenantPrinterPrefs>;

const ELECTRON_SETTING_KEY: Record<PrinterRole, keyof AppSettings> = {
  cashier: 'posElectronCashierPrinter',
  barcode: 'posElectronBarcodePrinter',
  document: 'posElectronDocumentPrinter',
  kitchen: 'posElectronKitchenPrinter',
};

const BRIDGE_SETTING_KEY: Record<Exclude<PrinterRole, 'kitchen'>, keyof AppSettings> = {
  cashier: 'posWindowsPrinterName',
  barcode: 'posWindowsBarcodePrinterName',
  document: 'posWindowsDocumentPrinterName',
};

function getCurrentTenantKey(): string {
  try {
    const tenant = useAuthStore.getState().tenant;
    const raw = String(tenant?.id || tenant?.slug || 'default').trim();
    return raw || 'default';
  } catch {
    return 'default';
  }
}

function readAllPrefs(): StoredPrinterPrefsByTenant {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(WORKSTATION_PRINTER_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllPrefs(all: StoredPrinterPrefsByTenant): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WORKSTATION_PRINTER_PREFS_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

function readWorkstationPrinterEntry(
  mode: PrinterTransportMode,
  role: PrinterRole,
): { hasValue: boolean; value: string } {
  const all = readAllPrefs();
  const bucket = all[getCurrentTenantKey()]?.[mode];
  if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, role)) {
    return { hasValue: false, value: '' };
  }
  return { hasValue: true, value: String(bucket[role] || '').trim() };
}

export function saveWorkstationPrinterPreference(
  mode: PrinterTransportMode,
  role: PrinterRole,
  printerName: string,
): void {
  const tenantKey = getCurrentTenantKey();
  const all = readAllPrefs();
  const currentTenant = all[tenantKey] || {};
  const modeBucket = { ...(currentTenant[mode] || {}), [role]: String(printerName || '').trim() };
  all[tenantKey] = { ...currentTenant, [mode]: modeBucket };
  writeAllPrefs(all);
}

export function syncWorkstationPrintersFromSettings(settings?: Partial<AppSettings> | null): void {
  if (!settings) return;
  const electronRoles: PrinterRole[] = ['cashier', 'barcode', 'document', 'kitchen'];
  for (const role of electronRoles) {
    const key = ELECTRON_SETTING_KEY[role];
    if (key in settings) {
      saveWorkstationPrinterPreference('electron', role, String(settings[key] || '').trim());
    }
  }
  const bridgeRoles: Array<Exclude<PrinterRole, 'kitchen'>> = ['cashier', 'barcode', 'document'];
  for (const role of bridgeRoles) {
    const key = BRIDGE_SETTING_KEY[role];
    if (key in settings) {
      saveWorkstationPrinterPreference('bridge', role, String(settings[key] || '').trim());
    }
  }
}

export function resolveElectronPrinter(
  role: PrinterRole,
  settings?: Partial<AppSettings> | null,
): string {
  const local = readWorkstationPrinterEntry('electron', role);
  if (local.hasValue) return local.value;
  return String(settings?.[ELECTRON_SETTING_KEY[role]] || '').trim();
}

export function resolveBridgePrinter(
  role: Exclude<PrinterRole, 'kitchen'>,
  settings?: Partial<AppSettings> | null,
): string {
  const local = readWorkstationPrinterEntry('bridge', role);
  if (local.hasValue) {
    if (local.value || role !== 'document') return local.value;
  }

  const direct = String(settings?.[BRIDGE_SETTING_KEY[role]] || '').trim();
  if (direct) return direct;

  // Barcode stickers must NEVER fall back to the cashier receipt printer.
  if (role === 'barcode') return '';

  // Document/A4 bridge prints fall back to the configured Windows printer to preserve single-printer setups.
  if (role === 'document') {
    const localCashier = readWorkstationPrinterEntry('bridge', 'cashier');
    if (localCashier.hasValue) return localCashier.value;
    return String(settings?.posWindowsPrinterName || '').trim();
  }

  return '';
}

export function clearWorkstationPrinterPreferencesForCurrentTenant(): void {
  const all = readAllPrefs();
  delete all[getCurrentTenantKey()];
  writeAllPrefs(all);
}
