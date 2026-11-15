/*
 * New file: frontend/src/features/settings/components/forms/tabs/SalesInventorySettingsTab.weighted-barcode.spec.tsx
 *
 * WHAT THIS PINS: the weighted-barcode format fields (prefix, product-code
 * length, weight digits, weight decimals, value mode) used to live inside the
 * super-admin-only manual-switches block of ModulesSettingsTab, so a tenant
 * admin who enabled the scale app via the Apps Store could never see or edit
 * them. They now live in their own FormSection «إعدادات باركود الميزان» in
 * the sales/inventory tab, which is where SettingsMainForm already maps all six
 * weightedBarcode* keys (tab 'sales_inventory').
 *
 * WHAT IS DRIVEN (real tab, mocked i18n + POS bridge + router): render the
 * sales/inventory tab with a real react-hook-form form.
 * - Case 1 (the fix): non-super-admin retail tenant + weightedBarcodeEnabled
 *   -> all five format-field labels render.
 * - Case 2: same tenant + weightedBarcodeEnabled=false -> none render.
 * - Case 3 (no regression): super admin + retail + enabled -> labels render.
 * - Case 4 (all-modes unblock): non-super-admin contracting tenant + enabled
 *   -> labels render (scale format works whenever weightedBarcodeEnabled is active).
 * - Case 5 (super-admin escape kept): super admin + contracting + enabled ->
 *   labels render.
 *
 * NOT DRIVEN: the Apps Store enable toggle itself (modules tab, unchanged);
 * the scale-barcode parsing at POS (covered by
 * PosWorkspace.weighted-barcode.spec.tsx); saving the values (settings
 * mutation, unchanged).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesInventorySettingsTab } from './SalesInventorySettingsTab';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';

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
  posApi: {
    testTerminalConnection: vi.fn().mockResolvedValue({ success: false }),
  },
  HardwareBridgeClient: {
    isAvailable: vi.fn().mockResolvedValue(false),
    testTerminal: vi.fn().mockResolvedValue({ success: false }),
  },
}));

const PREFIX_LABEL = 'بداية باركود الميزان';
const CODE_LENGTH_LABEL = 'أرقام كود الصنف';
const WEIGHT_DIGITS_LABEL = 'أرقام الوزن';
const WEIGHT_DECIMALS_LABEL = 'دقة الوزن (خانات عشرية)';
const VALUE_MODE_LABEL = 'محتوى باركود الميزان';
const ALL_LABELS = [PREFIX_LABEL, CODE_LENGTH_LABEL, WEIGHT_DIGITS_LABEL, WEIGHT_DECIMALS_LABEL, VALUE_MODE_LABEL];

const TENANT_ADMIN: AuthUser = {
  id: 'u-admin',
  username: 'owner',
  role: 'admin',
  permissions: ['settings'],
  displayName: 'Owner',
  branchIds: [],
  defaultBranchId: '',
  tenantId: 'shop1',
} as AuthUser;

const SUPER_ADMIN: AuthUser = {
  id: 'u-root',
  username: 'zs',
  role: 'super_admin',
  permissions: [],
  displayName: 'Super Admin',
  branchIds: [],
  defaultBranchId: '',
  tenantId: 'zs',
  accountId: 'zs',
} as AuthUser;

function renderTab(options: {
  businessIndustry: string;
  weightedBarcodeEnabled: boolean;
  user: AuthUser | null;
}) {
  const { businessIndustry, weightedBarcodeEnabled, user } = options;
  useAuthStore.setState({ user, tenant: null });
  const TestHost = () => {
    const form = useForm<SettingsFormInput, undefined, SettingsFormOutput>({
      defaultValues: {
        businessIndustry,
        posModuleEnabled: true,
        restaurantModuleEnabled: false,
        contractingModuleEnabled: false,
        maritimeFreightModuleEnabled: false,
        manufacturingModuleEnabled: false,
        weightedBarcodeEnabled,
        weightedBarcodePrefix: '21',
        weightedBarcodeProductCodeLength: 5,
        weightedBarcodeWeightDigits: 5,
        weightedBarcodeWeightDecimals: 3,
        weightedBarcodeValueMode: 'weight',
        loyaltyPointsPer100Egp: 10,
        loyaltyPointRedeemValue: 0.1,
      } as any,
    });
    return (
      <MemoryRouter>
        <SalesInventorySettingsTab
          form={form}
          disabled={false}
          activeTab="sales_inventory"
          settings={{ businessIndustry, posModuleEnabled: true } as any}
        />
      </MemoryRouter>
    );
  };
  return render(<TestHost />);
}

describe('SalesInventorySettingsTab weighted-barcode fields', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, tenant: null });
  });

  it('shows the scale-barcode format fields to a tenant admin when the scale app is enabled', () => {
    renderTab({ businessIndustry: 'retail_general', weightedBarcodeEnabled: true, user: TENANT_ADMIN });
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('hides the scale-barcode format fields when the scale app is disabled', () => {
    renderTab({ businessIndustry: 'retail_general', weightedBarcodeEnabled: false, user: TENANT_ADMIN });
    for (const label of ALL_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('still shows the scale-barcode format fields to a super admin', () => {
    renderTab({ businessIndustry: 'retail_general', weightedBarcodeEnabled: true, user: SUPER_ADMIN });
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the scale-barcode format fields on a contracting or warehousing tenant when weighted barcode is enabled', () => {
    renderTab({ businessIndustry: 'contracting', weightedBarcodeEnabled: true, user: TENANT_ADMIN });
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('still shows the scale-barcode format fields to a super admin on a contracting tenant', () => {
    renderTab({ businessIndustry: 'contracting', weightedBarcodeEnabled: true, user: SUPER_ADMIN });
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
