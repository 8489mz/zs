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
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintingSettingsTab } from './PrintingSettingsTab';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/features/pos', () => ({
  HardwareBridgeClient: {
    listPrinters: vi.fn().mockResolvedValue({ success: false, printers: [] }),
  },
}));

const SYSTEM_PRINTERS = [{ name: 'EPSON WF-C5290BA', displayName: 'EPSON WF-C5290BA' }];

const CASHIER_LABEL = 'طابعة الكاشير المباشرة (الريسيت)';
const KITCHEN_LABEL = 'طابعة المطبخ المباشرة (KOT)';

function setElectron(on: boolean) {
  if (on) {
    (window as any).electronPrinter = {
      getPrinters: () => Promise.resolve(SYSTEM_PRINTERS),
    };
  } else {
    delete (window as any).electronPrinter;
  }
}

function renderTab(options: {
  businessIndustry: string;
  kitchenEnabled: boolean;
  electron: boolean;
}) {
  const { businessIndustry, kitchenEnabled, electron } = options;
  setElectron(electron);
  const TestHost = () => {
    const form = useForm<SettingsFormInput, undefined, SettingsFormOutput>({
      defaultValues: {
        businessIndustry,
        posModuleEnabled: true,
        restaurantModuleEnabled: false,
        contractingModuleEnabled: false,
        maritimeFreightModuleEnabled: false,
        manufacturingModuleEnabled: false,
        posKitchenPrinterEnabled: kitchenEnabled,
        posCashDrawerPrinterEnabled: false,
        posKitchenPrinterAuto: false,
        posKitchenPrinterMode: 'detailed',
        posKitchenLanguage: 'dual',
        posElectronCashierPrinter: '',
        posElectronKitchenPrinter: '',
        posWindowsPrinterName: '',
        posNetworkThermalPrinterIp: '',
        posNetworkThermalPrinterPort: 9100,
        paperSize: 'receipt',
      } as any,
    });
    return (
      <PrintingSettingsTab
        form={form}
        disabled={false}
        activeTab="printing"
        settings={{ businessIndustry, posModuleEnabled: true } as any}
        systemPrinters={SYSTEM_PRINTERS}
        savedCashierPrinter=""
        savedKitchenPrinter=""
        posKitchenPrinterEnabled={kitchenEnabled}
      />
    );
  };
  return render(<TestHost />);
}

describe('PrintingSettingsTab electron cashier printer', () => {
  afterEach(() => {
    delete (window as any).electronPrinter;
  });

  it('shows the cashier direct-printer picker for a retail tenant in Electron with kitchen printing off', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: true });
    expect(screen.getByText(CASHIER_LABEL)).toBeInTheDocument();
  });

  it('does not show the cashier picker in the browser (no window.electronPrinter)', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: false });
    expect(screen.queryByText(CASHIER_LABEL)).not.toBeInTheDocument();
  });

  it('keeps the kitchen picker gated: retail tenant with kitchen printing off has no kitchen picker', () => {
    renderTab({ businessIndustry: 'retail_general', kitchenEnabled: false, electron: true });
    expect(screen.queryByText(KITCHEN_LABEL)).not.toBeInTheDocument();
  });

  it('shows both pickers for a restaurant tenant in Electron', () => {
    renderTab({ businessIndustry: 'restaurant', kitchenEnabled: false, electron: true });
    expect(screen.getByText(CASHIER_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KITCHEN_LABEL)).toBeInTheDocument();
  });
});
