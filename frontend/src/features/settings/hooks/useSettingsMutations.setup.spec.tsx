import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsUpdateMutation } from '@/features/settings/hooks/useSettingsMutations';
import { useAuthStore } from '@/stores/auth-store';

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
}));

vi.mock('@/features/settings/api/settings.api', () => ({
  settingsApi: {
    update: updateMock,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const baseSettingsMutationValues = {
  storeName: 'My Store',
  brandName: 'My Store',
  country: 'EG',
  phone: '',
  address: '',
  lowStockThreshold: 5,
  expiryAlertDays: 30,
  stagnantProductDays: 30,
  invoiceFooter: '',
  invoiceQR: '',
  taxNumber: '',
  taxRate: 0,
  taxMode: 'exclusive' as const,
  paperSize: 'a4' as const,
  receiptWidthMm: 80 as const,
  managerPin: '',
  autoBackup: 'on' as const,
  accentColor: '#170c5c',
  logoData: '',
  businessIndustry: 'general' as const,
  currentBranchId: '',
  currentLocationId: '',
  manufacturingModuleEnabled: false,
  importModuleEnabled: false,
  maritimeFreightModuleEnabled: false,
  contractingModuleEnabled: false,
  autoPartsModuleEnabled: false,
  comboModuleEnabled: false,
  restaurantModuleEnabled: false,
  enableGuestPagers: false,
  instapayAddress: '01018017523',
  walletNumber: '01018017523',
  walletProviderName: 'فودافون كاش',
  paymentLinkBaseUrl: '',
  enableDynamicPaymentQr: true,
  printPaymentQrOnReceipt: false,
  taxComplianceMode: 'disabled' as const,
  posModuleEnabled: true,
  purchasesModuleEnabled: true,
  inventoryModuleEnabled: true,
  hrModuleEnabled: true,
  crmModuleEnabled: false,
  onboardingCompleted: false,
  storefrontModuleEnabled: false,
  installmentsModuleEnabled: false,
  fixedAssetsModuleEnabled: false,
  taxDeclarationModuleEnabled: false,
  deliveryFleetModuleEnabled: false,
  deliveryRepsModuleEnabled: false,
  vanSalesModuleEnabled: false,
  phoneOrdersModuleEnabled: false,
  posShowCartMeta: false,
  posProductCardLayout: 'comfortable' as const,
  posShowSearchBar: true,
  posShowPriceTierToggle: true,
  posDefaultPriceType: 'retail' as const,
  posShowCategories: true,
  posShowQuickFilters: true,
  posMobileGridColumns: 'auto' as const,
  posAutoHideBottomNav: true,
  posHideOutOfStockItems: false,
  printDeliveryRepOnReceipt: false,
  clothingModuleEnabled: false,
  enableMobileStoreFeatures: false,
  enablePharmacyModule: false,
  servicesModuleEnabled: false,
  maintenanceProfile: 'mobile',
  enableEnterpriseFeatures: false,
  technicianCommissionRate: 30,
  defaultProductKind: 'standard' as const,
  defaultPosMode: 'scanner' as const,
  defaultBranchIssueMode: 'final_issue' as const,
  invoiceNumberingScheme: 'daily' as const,
  allowNegativeStockSales: false,
  allowZeroPurchaseCost: false,
  posMaxDiscountThresholdEnabled: false,
  posMaxDiscountThresholdType: 'percentage' as const,
  posMaxDiscountThresholdValue: 15,
  // INV-SETTINGS-SPEC-FIXTURE-FIELDS: the Q3/Q6 settings are required
  // SettingsFormOutput fields (schema defaults 2 / 500); the fixture
  // must carry them or frontend typecheck fails on both mutate calls.
  posSmallDiscountFlatAllowance: 2,
  posLargeCashRefundThreshold: 500,
  requireCashierShiftForSales: true,
  requirePasswordOnShiftOpen: false,
  restaurantServiceChargeEnabled: false,
  restaurantServiceChargePercent: 0,
  posTerminalProtocol: 'tcp_ip' as const,
  posTerminalAutoFinalize: false,
  loyaltyEnabled: true,
  loyaltyPointsPer100Egp: 10,
  loyaltyPointRedeemValue: 0.1,
  loyaltyMinRedeemPoints: 50,
  loyaltyMaxDiscountPercentage: 50,
  printShowLoyaltyPoints: true,
  posKitchenPrinterEnabled: false,
  posKitchenPrinterAuto: false,
  posKitchenPrinterMode: 'detailed' as const,
  posKitchenLanguage: 'ar' as const,
  printBilingualItemNames: false,
  weightedBarcodeEnabled: false,
  weightedBarcodePrefix: '21',
  weightedBarcodeProductCodeLength: 5,
  weightedBarcodeWeightDigits: 5,
  weightedBarcodeWeightDecimals: 3,
  weightedBarcodeValueMode: 'weight' as const,
  printShowLogo: true,
  printShowDocumentType: true,
  printShowDocumentNumber: true,
  printShowOrderType: true,
  printShowPhone: true,
  printShowAddress: true,
  printShowTaxNumber: false,
  printShowCustomer: true,
  printShowCashier: true,
  printShowBranch: true,
  printShowLocation: true,
  printShowTax: true,
  printShowPaymentMethod: true,
  printShowItemSummary: true,
  printShowItemCount: true,
  printShowPiecesCount: true,
  printShowPaymentBreakdown: true,
  printShowDate: true,
  printShowHijriDate: false,
  printShowItemOffers: true,
  printShowDiscountBreakdown: true,
  printShowSavingsBanner: true,
  printShowInvoiceBarcode: true,
  printShowFooter: true,
  printCompactReceipt: true,
  posReceiptTheme: 'classic',
  printNumberFormat: 'arabic' as const,
  uiLanguage: 'ar' as const,
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  dateFormat: 'dd/MM/yyyy' as const,
  timeFormat: '12h' as const,
  whatsappLinkMode: 'wa_me' as const,
  printShowDeliveryCustomerDetails: true,
  deliveryFeeMode: 'freelance_courier' as const,
  storeFleetCommissionRate: 0,
  defaultDeliveryFee: 0,
  printDualReceiptForOnlineDelivery: false,
  posTerminalEnabled: true,
  posTerminalProvider: 'mock_sandbox' as const,
  posTerminalName: 'جهاز الكاشير الرئيسي (EDC)',
  posTerminalIp: '192.168.1.150',
  posTerminalPort: 8080,
  posTerminals: [],
  restaurantTablesCount: 12,
  contractingRetentionPercent: 5,
  contractingAdvanceRecoveryMode: 'proportional' as const,
  contractingDefaultProfitMargin: 15,
  contractingDefaultOverhead: 7,
  contractingDefaultWaste: 5,
  contractingRequireBoqLinkForIssue: false,
  maritimeDemurrageFreeDays: 14,
  maritimeDefaultCurrency: 'USD' as const,
  importLandedCostMethod: 'by_value' as const,
  importAutoLinkBankExpenses: 'auto_link' as const,
  servicesBillingMethod: 'deliverable' as const,
  servicesContractRenewalNoticeDays: 30,
        receiptItemLanguageMode: "ar_primary" as const,
};

describe('useSettingsUpdateMutation setup flow', () => {
  it('advances the first-run flow only after a successful save', async () => {
    updateMock.mockReset();
    updateMock.mockResolvedValueOnce({ storeName: 'My Store', theme: 'light' });
    useAuthStore.setState({
      user: {
        id: 'u-root',
        username: 'root',
        role: 'super_admin',
        permissions: [],
        displayName: 'Root',
        branchIds: ['b-1'],
        defaultBranchId: 'b-1',
      },
      storeName: 'Z Systems',
      theme: 'light',
      initialized: true,
    });

    const onSetupAdvance = vi.fn();
    const { result } = renderHook(() => useSettingsUpdateMutation(undefined, onSetupAdvance), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync(baseSettingsMutationValues);
    });

    await waitFor(() => {
      expect(onSetupAdvance).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().storeName).toBe('My Store');
    });
  });

  it('does not advance the first-run flow when saving fails', async () => {
    updateMock.mockReset();
    updateMock.mockRejectedValueOnce(new Error('تعذر حفظ الإعدادات'));
    const onSetupAdvance = vi.fn();
    const { result } = renderHook(() => useSettingsUpdateMutation(undefined, onSetupAdvance), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync({
      ...baseSettingsMutationValues,
      storeName: 'Broken Store',
      brandName: 'Broken Store',
    })).rejects.toThrow('تعذر حفظ الإعدادات');

    expect(onSetupAdvance).not.toHaveBeenCalled();
  });
});
