/*
 * New file: frontend/src/features/settings/components/forms/tabs/PrintingSettingsTab.spec.tsx
 *
 * WHAT THIS PINS (INV-ELECTRON-CASHIER-PRINTER-ALL-VERTICALS): the Electron
 * cashier direct-printer picker lived inside the KOT/kitchen section, gated
 * on the restaurant vertical or kitchen printing — so on a retail/clothes
 * tenant with kitchen printing off the picker never appeared (user 2026-11-14:
 * remembered it from the restaurant setup, gone on the clothes tenant).
 *
 * WHAT IS DRIVEN (real tab, mocked i18n + bridge): render the printing tab
 * with a real react-hook-form form.
 * - Case 1 (the fix): retail tenant + Electron + kitchen printing OFF ->
 *   the cashier printer label renders (it used to render only for
 *   restaurant/kitchen-ON tenants).
 * - Case 2 (no regression, browser): retail tenant + NO window.electronPrinter
 *   -> the cashier printer label does NOT render (browser keeps the bridge
 *   path in section 2c).
 * - Case 3 (no regression, kitchen stays gated): retail tenant + Electron +
 *   kitchen printing OFF -> the kitchen printer label does NOT render.
 * - Case 4 (no regression, restaurant): restaurant tenant + Electron ->
 *   BOTH the cashier and the kitchen printer labels render.
 *
 * NOT DRIVEN: the actual print dispatch to the chosen printer (Electron
 * main-process IPC, unchanged); the bridge printer list in section 2c
 * (unchanged); saving the chosen printer name (settings mutation,
 * unchanged).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintingSettingsTab } from './PrintingSettingsTab';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'ar' },
    }),
  };
});

vi.mock('@/features/pos', () => ({
  HardwareBridgeClient: {
    listPrinters: vi.fn().mockResolvedValue({ success: false, printers: [] }),
  },
}));

const SYSTEM_PRINTERS = [{ name: 'EPSON WF-C5290BA', displayName: 'EPSON WF-C5290BA' }];

const CASHIER_LABEL = 'طابعة الكاشير المباشرة (الريسيت)';
const BARCODE_LABEL = 'طابعة الباركود المباشرة (الاستيكر — اختياري)';
const KITCHEN_LABEL = 'طابعة المطبخ المباشرة (KOT)';

function setElectron(on: boolean, printHtmlSilent?: ReturnType<typeof vi.fn>) {
  if (on) {
    (window as any).electronPrinter = {
      getPrinters: () => Promise.resolve(SYSTEM_PRINTERS),
      ...(printHtmlSilent ? { printHtmlSilent } : {}),
    };
  } else {
    delete (window as any).electronPrinter;
  }
}

function renderTab(options: {
  businessIndustry: string;
  kitchenEnabled: boolean;
  electron: boolean;
  manufacturingModuleEnabled?: boolean;
  posModuleEnabled?: boolean;
  inventoryModuleEnabled?: boolean;
  printHtmlSilent?: ReturnType<typeof vi.fn>;
  formOverrides?: Record<string, unknown>;
  settingsOverrides?: Record<string, unknown>;
  branchName?: string;
  locationName?: string;
}) {
  const {
    businessIndustry,
    kitchenEnabled,
    electron,
    manufacturingModuleEnabled = false,
    posModuleEnabled = true,
    inventoryModuleEnabled = true,
    printHtmlSilent,
    formOverrides = {},
    settingsOverrides = {},
    branchName,
    locationName,
  } = options;
  setElectron(electron, printHtmlSilent);
  const TestHost = () => {
    const form = useForm<SettingsFormInput, undefined, SettingsFormOutput>({
      defaultValues: {
        businessIndustry,
        posModuleEnabled,
        inventoryModuleEnabled,
        restaurantModuleEnabled: false,
        contractingModuleEnabled: false,
        maritimeFreightModuleEnabled: false,
        manufacturingModuleEnabled,
        posKitchenPrinterEnabled: kitchenEnabled,
        posCashDrawerPrinterEnabled: false,
        posKitchenPrinterAuto: false,
        posKitchenPrinterMode: 'detailed',
        posKitchenLanguage: 'dual',
        posElectronCashierPrinter: '',
        posElectronKitchenPrinter: '',
        posElectronBarcodePrinter: '',
        posWindowsPrinterName: '',
        posNetworkThermalPrinterIp: '',
        posNetworkThermalPrinterPort: 9100,
        paperSize: 'receipt',
        receiptWidthMm: 80,
        printShowLogo: true,
        printShowPhone: true,
        printShowAddress: true,
        printShowTaxNumber: false,
        printShowBranch: true,
        printShowLocation: true,
        printShowDocumentType: true,
        printShowDocumentNumber: true,
        printShowDate: true,
        printShowHijriDate: false,
        printShowOrderType: true,
        printShowCashier: true,
        printShowTax: true,
        printShowItemCount: true,
        printShowPiecesCount: true,
        printShowPaymentBreakdown: true,
        printShowInvoiceBarcode: true,
        printShowFooter: true,
        printCompactReceipt: true,
        ...formOverrides,
      } as any,
    });
    return (
      <PrintingSettingsTab
        form={form}
        disabled={false}
        activeTab="printing"
        settings={{ businessIndustry, posModuleEnabled, inventoryModuleEnabled, ...settingsOverrides } as any}
        systemPrinters={SYSTEM_PRINTERS}
        savedCashierPrinter=""
        savedKitchenPrinter=""
        savedBarcodePrinter=""
        posKitchenPrinterEnabled={kitchenEnabled}
        branchName={branchName}
        locationName={locationName}
      />
    );
  };
  return render(<TestHost />);
}

describe('PrintingSettingsTab electron direct printers', () => {
  afterEach(() => {
    delete (window as any).electronPrinter;
  });

  it('shows both cashier and optional barcode pickers for a retail tenant in Electron with kitchen printing off', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: true });
    expect(screen.getByText(CASHIER_LABEL)).toBeInTheDocument();
    expect(screen.getByText(BARCODE_LABEL)).toBeInTheDocument();
  });

  it('does not show cashier or barcode pickers in the browser (no window.electronPrinter)', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: false });
    expect(screen.queryByText(CASHIER_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(BARCODE_LABEL)).not.toBeInTheDocument();
  });

  it('keeps the kitchen picker gated: retail tenant with kitchen printing off has no kitchen picker', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: true });
    expect(screen.queryByText(KITCHEN_LABEL)).not.toBeInTheDocument();
  });

  it('shows cashier, barcode, and kitchen pickers for a restaurant tenant in Electron', () => {
    renderTab({ businessIndustry: 'restaurant', kitchenEnabled: false, electron: true });
    expect(screen.getByText(CASHIER_LABEL)).toBeInTheDocument();
    expect(screen.getByText(BARCODE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KITCHEN_LABEL)).toBeInTheDocument();
  });

  it('still shows cashier and barcode pickers when a retail tenant enables manufacturing as an add-on', () => {
    renderTab({
      businessIndustry: 'retail_general',
      kitchenEnabled: false,
      electron: true,
      manufacturingModuleEnabled: true,
    });
    expect(screen.getByText(CASHIER_LABEL)).toBeInTheDocument();
    expect(screen.getByText(BARCODE_LABEL)).toBeInTheDocument();
  });

  it('shows the barcode picker for non-POS inventory verticals like warehousing in Electron', () => {
    renderTab({
      businessIndustry: 'warehousing',
      kitchenEnabled: false,
      electron: true,
      posModuleEnabled: false,
      inventoryModuleEnabled: true,
    });
    expect(screen.queryByText(CASHIER_LABEL)).not.toBeInTheDocument();
    expect(screen.getByText(BARCODE_LABEL)).toBeInTheDocument();
  });

  it('syncs both the live preview and Test Print with store details and receipt toggles (e.g. hiding cashier)', () => {
    const printHtmlSilent = vi.fn().mockResolvedValue({ ok: true });
    renderTab({
      businessIndustry: 'retail_general',
      kitchenEnabled: false,
      electron: true,
      printHtmlSilent,
      branchName: 'فرع المعادي',
      locationName: 'مخزن المعادي',
      formOverrides: {
        storeName: 'متجر النور',
        phone: '01099887766',
        address: 'شارع 9 المعادي',
        taxNumber: '300400500',
        printShowTaxNumber: true,
        printShowCashier: true,
        printShowInvoiceBarcode: true,
        invoiceFooter: 'أهلاً بكم دائماً',
        posElectronCashierPrinter: 'EPSON WF-C5290BA',
      },
    });

    const previewFrame = screen.getByTitle('معاينة الفاتورة الحية') as HTMLIFrameElement;
    const initialSrcDoc = previewFrame.getAttribute('srcdoc') || '';
    expect(initialSrcDoc).toContain('متجر النور');
    expect(initialSrcDoc).toContain('01099887766');
    expect(initialSrcDoc).toContain('شارع 9 المعادي');
    expect(initialSrcDoc).toContain('300400500');
    expect(initialSrcDoc).toContain('فرع المعادي');
    expect(initialSrcDoc).toContain('مخزن المعادي');
    expect(initialSrcDoc).toContain('أهلاً بكم دائماً');
    expect(initialSrcDoc).toContain('الكاشير:');
    expect(initialSrcDoc).toContain('invoice-barcode-card');

    // Uncheck "إظهار الكاشير" and "إظهار الفرع" live
    fireEvent.click(screen.getByLabelText('إظهار الكاشير'));
    fireEvent.click(screen.getByLabelText('إظهار الفرع'));

    const updatedSrcDoc = previewFrame.getAttribute('srcdoc') || '';
    expect(updatedSrcDoc).not.toContain('الكاشير:');
    expect(updatedSrcDoc).not.toContain('فرع المعادي');

    // Trigger "طباعة تجريبية حية (Test Print)"
    fireEvent.click(screen.getByRole('button', { name: /طباعة تجريبية حية/ }));

    expect(printHtmlSilent).toHaveBeenCalledTimes(1);
    const callArg = printHtmlSilent.mock.calls[0][0];
    expect(callArg.deviceName).toBe('EPSON WF-C5290BA');
    expect(callArg.pageSize).toBe('receipt');
    expect(callArg.html).toContain('متجر النور');
    expect(callArg.html).toContain('أهلاً بكم دائماً');
    expect(callArg.html).not.toContain('الكاشير:');
    expect(callArg.html).not.toContain('فرع المعادي');
  });
});
