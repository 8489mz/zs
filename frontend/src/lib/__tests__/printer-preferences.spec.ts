import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/app/providers';
import { queryKeys } from '@/app/query-keys';
import { useAuthStore } from '@/stores/auth-store';
import { printHtmlDocument, resolvePrintSettings } from '@/lib/browser';
import { printBatchBarcodeLabels } from '@/lib/barcode-labels';
import {
  clearWorkstationPrinterPreferencesForCurrentTenant,
  resolveBridgePrinter,
  resolveElectronPrinter,
  saveWorkstationPrinterPreference,
  syncWorkstationPrintersFromSettings,
} from '@/lib/printer-preferences';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import type { Product } from '@/types/domain';

vi.mock('@/features/pos/lib/hardware-bridge-client', () => ({
  HardwareBridgeClient: {
    isAvailable: vi.fn(),
    printWindows: vi.fn(),
    listPrinters: vi.fn(),
  },
}));

const sampleProduct: Product = {
  id: 'p-1',
  name: 'تيشيرت قطن',
  barcode: '6221234567890',
  costPrice: 50,
  retailPrice: 120,
  wholesalePrice: 90,
  stock: 10,
  minStock: 1,
  categoryId: 'c-1',
  supplierId: 's-1',
  notes: '',
  units: [],
};

describe('workstation & tenant printer preferences persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    queryClient.removeQueries({ queryKey: queryKeys.posSettings });
    useAuthStore.setState({ tenant: { id: 'tenant-1', slug: 't1', businessName: 'Store 1' } as any });
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).electronPrinter;
    vi.restoreAllMocks();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    queryClient.removeQueries({ queryKey: queryKeys.posSettings });
    useAuthStore.setState({ tenant: null });
  });

  it('persists chosen Electron printers across reloads and isolates per tenant', () => {
    saveWorkstationPrinterPreference('electron', 'barcode', 'Xprinter XP-246B');
    saveWorkstationPrinterPreference('electron', 'document', 'HP LaserJet Pro');

    expect(resolveElectronPrinter('barcode', null)).toBe('Xprinter XP-246B');
    expect(resolveElectronPrinter('document', null)).toBe('HP LaserJet Pro');

    useAuthStore.setState({ tenant: { id: 'tenant-2', slug: 't2', businessName: 'Store 2' } as any });
    expect(resolveElectronPrinter('barcode', null)).toBe('');

    useAuthStore.setState({ tenant: { id: 'tenant-1', slug: 't1', businessName: 'Store 1' } as any });
    expect(resolveElectronPrinter('barcode', { posElectronBarcodePrinter: 'Old DB Printer' })).toBe('Xprinter XP-246B');
  });

  it('respects intentional clearing on a workstation over stale tenant DB defaults', () => {
    saveWorkstationPrinterPreference('electron', 'barcode', '');
    expect(resolveElectronPrinter('barcode', { posElectronBarcodePrinter: 'Old DB Printer' })).toBe('');

    clearWorkstationPrinterPreferencesForCurrentTenant();
    expect(resolveElectronPrinter('barcode', { posElectronBarcodePrinter: 'DB Fallback Printer' })).toBe('DB Fallback Printer');
  });

  it('never leaks SaaS cashier receipt printer to barcode labels while isolating dedicated barcode printer', () => {
    const dbSettings = { posWindowsPrinterName: 'EPSON TM-T20 Receipt' };
    expect(resolveBridgePrinter('cashier', dbSettings)).toBe('EPSON TM-T20 Receipt');
    expect(resolveBridgePrinter('document', dbSettings)).toBe('EPSON TM-T20 Receipt');
    expect(resolveBridgePrinter('barcode', dbSettings)).toBe('');

    saveWorkstationPrinterPreference('bridge', 'barcode', 'Xprinter XP-246B');
    expect(resolvePrintSettings().windowsBarcodePrinter).toBe('Xprinter XP-246B');
  });

  it('routes Electron A4 reports and thermal barcodes automatically using remembered printers', async () => {
    const printHtmlSilentSpy = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronPrinter = {
      getPrinters: vi.fn().mockResolvedValue([]),
      printHtmlSilent: printHtmlSilentSpy,
    };

    syncWorkstationPrintersFromSettings({
      posElectronBarcodePrinter: 'Xprinter XP-246B',
      posElectronDocumentPrinter: 'Canon LBP6030',
    });

    printHtmlDocument('تقرير مبيعات', '<div>Sales report</div>', { pageSize: 'A4' });
    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'Canon LBP6030',
        pageSize: 'A4',
      }),
    );

    printBatchBarcodeLabels(
      [{ product: sampleProduct, copies: 1 }],
      { presetId: 'thermal-38x25', copies: 1, labelsPerPage: 1, rotateDeg: 180 },
    );
    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'Xprinter XP-246B',
        pageSize: 'auto',
        pageSizeMm: { widthMm: 38, heightMm: 25 },
      }),
    );
  });

  it('routes Cloud SaaS barcode labels to remembered bridge printer when configured', async () => {
    saveWorkstationPrinterPreference('bridge', 'barcode', 'Xprinter XP-246B');
    vi.mocked(HardwareBridgeClient.isAvailable).mockResolvedValue(true);
    vi.mocked(HardwareBridgeClient.printWindows).mockResolvedValue({ success: true, printer: 'Xprinter XP-246B' });

    printBatchBarcodeLabels(
      [{ product: sampleProduct, copies: 1 }],
      { presetId: 'thermal-38x25', copies: 1, labelsPerPage: 1, rotateDeg: 180 },
    );

    await vi.waitFor(() => {
      expect(HardwareBridgeClient.printWindows).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceName: 'Xprinter XP-246B',
          pageSize: 'auto',
          pageSizeMm: { widthMm: 38, heightMm: 25 },
        }),
      );
    });
  });
});
