import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { settingsFormSchema, type SettingsFormInput, type SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { normalizeText, type SettingsMainFormProps } from '@/features/settings/components/forms/settings-forms.shared';
import { useLocalePreference } from '@/shared/locale/LocaleProvider';
import { useSettingsUpdateMutation } from '@/features/settings/hooks/useSettingsMutations';
import { buildZPayFormValues, buildAntiTheftFormValues } from '@/features/settings/contracts';
import { resolveBridgePrinter, resolveElectronPrinter } from '@/lib/printer-preferences';
import { useAuthStore } from '@/stores/auth-store';

import { SETTINGS_FIELD_METADATA, parseBoundedNumber } from './settings-field-metadata';
import { SettingsMainFormSetupBanner } from './settings-main-form/settings-main-form-setup-banner';
import { SettingsMainFormNotices } from './settings-main-form/settings-main-form-notices';
import { SettingsMainFormTabs } from './settings-main-form/settings-main-form-tabs';
import { SettingsMainFormActions } from './settings-main-form/settings-main-form-actions';
export { SETTINGS_FIELD_METADATA };

export function SettingsMainForm({ settings, branches, locations, canManageSettings, setupMode = false, onSetupAdvance, onUpdateBranch }: SettingsMainFormProps) {
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocalePreference();
  const setLocaleLanguage = locale.setLanguage;
  const [activeTab, setActiveTab] = useState<'general' | 'sales_inventory' | 'modules' | 'printing'>('general');
  const form = useForm<SettingsFormInput, undefined, SettingsFormOutput>({
    resolver: zodResolver(settingsFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: {
      storeName: '',
      brandName: 'Z Systems',
      phone: '',
      address: '',
      lowStockThreshold: 5,
      expiryAlertDays: 60,
      stagnantProductDays: 60,
      invoiceFooter: '',
      invoiceQR: '',
      taxNumber: '',
      taxRate: 0,
      taxMode: 'exclusive',
      paperSize: 'receipt',
      receiptWidthMm: 80,
      managerPin: '',
      autoBackup: 'on',
      accentColor: '#170c5c',
      logoData: '',
      businessIndustry: 'general',
      currentBranchId: '',
      currentLocationId: '',
      posModuleEnabled: true,
      purchasesModuleEnabled: true,
      inventoryModuleEnabled: true,
      hrModuleEnabled: false,
      manufacturingModuleEnabled: false,
      importModuleEnabled: false,
      maritimeFreightModuleEnabled: false,
      contractingModuleEnabled: false,
      comboModuleEnabled: false,
      restaurantModuleEnabled: false,
      phoneOrdersModuleEnabled: false,
      posShowCartMeta: false,
      posProductCardLayout: 'comfortable',
      posShowSearchBar: true,
      posShowPriceTierToggle: true,
      posDefaultPriceType: 'retail',
      posShowCategories: true,
      posShowQuickFilters: true,
      posMobileGridColumns: 'auto',
      posAutoHideBottomNav: true,
      printDeliveryRepOnReceipt: false,
      storefrontModuleEnabled: false,
      installmentsModuleEnabled: false,
      fixedAssetsModuleEnabled: false,
      taxDeclarationModuleEnabled: false,
      deliveryFleetModuleEnabled: false,
      deliveryRepsModuleEnabled: false,
      vanSalesModuleEnabled: false,
      clothingModuleEnabled: false,
      enableMobileStoreFeatures: false,
      enablePharmacyModule: false,
      servicesModuleEnabled: false,
      maintenanceProfile: 'mobile',
      enableEnterpriseFeatures: false,
      technicianCommissionRate: 30,
      defaultProductKind: 'standard',
      defaultPosMode: 'scanner',
      deliveryFeeMode: 'freelance_courier',
      storeFleetCommissionRate: 0,
      defaultDeliveryFee: 0,
      vanSettlementRequireSupervisorPin: false,
      vanSettlementBlindMode: false,
      vanRepDiscountCapPercent: 5,
      cashDiscountPercent: 0,
      allowNegativeStockSales: false,
      posHideOutOfStockItems: false,
      allowZeroPurchaseCost: false,
      requireCashierShiftForSales: true,
      requirePasswordOnShiftOpen: false,
      restaurantTablesCount: 12,
      loyaltyEnabled: false,
      loyaltyPointsPer100Egp: 10,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMinRedeemPoints: 50,
      loyaltyMaxDiscountPercentage: 50,
      printShowLoyaltyPoints: false,
      posMaxDiscountThresholdEnabled: false,
      posMaxDiscountThresholdType: 'percentage',
      posMaxDiscountThresholdValue: 10,
      posSmallDiscountFlatAllowance: 2,
      posLargeCashRefundThreshold: 500,
      posKitchenPrinterEnabled: false,
      posAutoPrintReceipt: true,
      posCashDrawerPrinterEnabled: false,
      posKitchenPrinterAuto: false,
      posKitchenPrinterMode: 'detailed',
      posKitchenLanguage: 'dual',
      printBilingualItemNames: false,
      posElectronCashierPrinter: '', posElectronKitchenPrinter: '', posElectronBarcodePrinter: '', posElectronDocumentPrinter: '',
      posWindowsPrinterName: '', posWindowsBarcodePrinterName: '', posWindowsDocumentPrinterName: '',
      posNetworkThermalPrinterIp: '',
      posNetworkThermalPrinterPort: 9100,
      weightedBarcodeEnabled: false,
      weightedBarcodePrefix: '21',
      weightedBarcodeProductCodeLength: 5,
      weightedBarcodeWeightDigits: 5,
      weightedBarcodeWeightDecimals: 3,
      weightedBarcodeValueMode: 'weight',
      printShowLogo: true,
      printShowDocumentType: true,
      printShowDocumentNumber: true,
      printShowOrderType: true,
      printShowPhone: true,
      printShowAddress: true,
      printShowTaxNumber: false,
      printShowCustomer: true,
      printShowDeliveryCustomerDetails: true,
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
      printNumberFormat: 'arabic',
      printDualReceiptForOnlineDelivery: false,
      uiLanguage: locale.language,
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      dateFormat: 'dd/MM/yyyy',
      timeFormat: '12h',
      whatsappLinkMode: 'wa_me',
      defaultBranchIssueMode: 'final_issue',
      invoiceNumberingScheme: 'daily',
      posTerminalEnabled: false,
      posTerminalProvider: 'mock_sandbox',
      posTerminalName: 'جهاز الكاشير الرئيسي (EDC)',
      posTerminalIp: '192.168.1.150',
      posTerminalPort: 8080,
      posTerminals: [],
      contractingRetentionPercent: 5,
      contractingAdvanceRecoveryMode: 'proportional',
      contractingDefaultProfitMargin: 15,
      contractingDefaultOverhead: 7,
      contractingDefaultWaste: 5,
      contractingRequireBoqLinkForIssue: false,
      maritimeDemurrageFreeDays: 14,
      maritimeDefaultCurrency: 'USD',
      importLandedCostMethod: 'by_value',
      importAutoLinkBankExpenses: 'auto_link',
      servicesBillingMethod: 'deliverable',
      servicesContractRenewalNoticeDays: 30,
      ...buildZPayFormValues(undefined),
      ...buildAntiTheftFormValues(undefined),
    },
  });

  const tenant = useAuthStore((s) => s.tenant);
  const mutation = useSettingsUpdateMutation(settings, setupMode ? onSetupAdvance : undefined);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  useEffect(() => {
    if (mutation.isSuccess) {
      setShowSaveSuccess(true);
      const timer = window.setTimeout(() => setShowSaveSuccess(false), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [mutation.isSuccess, mutation.data]);

  const [showBranchQuickAdd, setShowBranchQuickAdd] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchPrefillName, setBranchPrefillName] = useState('');
  const currentBranchId = form.watch('currentBranchId');

  const clothingModuleEnabled = form.watch('clothingModuleEnabled');
  const canNavigateAway = useUnsavedChangesGuard(form.formState.isDirty && !mutation.isPending);

  const rawActivity = String(form.watch('businessIndustry') || tenant?.activityType || settings?.activityType || (settings as any)?.businessIndustry || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));

  const isEn = locale.language === 'en';
  const salesInventoryTabLabel = isContractingVertical
    ? (isEn ? 'Contracting & Projects Controls' : 'ضوابط المقاولات والمشاريع')
    : isMaritimeVertical
    ? (isEn ? 'Freight & Shipping Controls' : 'ضوابط الشحن والعمليات الملاحية')
    : isManufacturingVertical
    ? (isEn ? 'Manufacturing & Production Controls' : 'ضوابط التصنيع والإنتاج')
    : isServicesVertical
    ? (isEn ? 'Services & Maintenance Controls' : 'ضوابط الخدمات وعقود الصيانة')
    : isImportVertical
    ? (isEn ? 'Import & POS Controls' : 'ضوابط الاستيراد ونقاط البيع')
    : isRestaurantVertical
    ? (isEn ? 'Restaurant, Sales & Inventory' : 'إعدادات المطاعم والمبيعات والمخزون')
    : (isEn ? 'POS, Sales & Inventory Settings' : 'إعدادات نقطة البيع والمبيعات والمخزون');

  const printingTabLabel = isContractingVertical || isMaritimeVertical || isServicesVertical || isManufacturingVertical
    ? (isEn ? 'Print Templates & Letterheads' : 'نماذج المطبوعات والترويسة')
    : (isEn ? 'Printing & Receipts' : 'الطباعة والإيصالات');

  const resolvedBranchId = SINGLE_STORE_MODE ? (currentBranchId || settings?.currentBranchId || branches[0]?.id || '') : currentBranchId;
  const visibleLocations = useMemo(() => locations, [locations]);

  const selectedBranch = branches.find((branch) => String(branch.id) === String(resolvedBranchId)) || branches[0] || null;

  // Branch stock settings state
  const [stockMode, setStockMode] = useState<'single_location' | 'all_operational_locations'>('single_location');
  const [defaultStockLocationId, setDefaultStockLocationId] = useState<string>('');
  const [allowExternalSalesStock, setAllowExternalSalesStock] = useState<boolean>(false);
  const [branchStockSaving, setBranchStockSaving] = useState(false);
  const [branchStockSaved, setBranchStockSaved] = useState(false);
  const [branchStockError, setBranchStockError] = useState<string | null>(null);
  const [branchStockDirty, setBranchStockDirty] = useState(false);

  const [systemPrinters, setSystemPrinters] = useState<{name: string, displayName: string}[]>([]);
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronPrinter) {
      (window as any).electronPrinter.getPrinters().then((printers: any[]) => {
        if (printers && Array.isArray(printers)) {
          setSystemPrinters(printers);
        }
      }).catch(() => undefined);
    }
  }, []);

  // Re-apply saved printer values after system printers list loads,
  // because the <select> loses its value if the matching <option> wasn't rendered yet during form.reset()
  useEffect(() => {
    if (!systemPrinters.length || !settings) return;
    for (const key of ['posElectronCashierPrinter', 'posElectronKitchenPrinter', 'posElectronBarcodePrinter', 'posElectronDocumentPrinter'] as const) {
      const saved = String((settings as any)[key] || '').trim();
      if (saved && form.getValues(key) !== saved) form.setValue(key, saved, { shouldDirty: false });
    }
  }, [systemPrinters, settings, form]);

  // Sync branch stock state when selected branch changes
  useEffect(() => {
    if (!selectedBranch) return;
    setStockMode((selectedBranch as any).salesStockMode === 'all_operational_locations' ? 'all_operational_locations' : 'single_location');
    setDefaultStockLocationId((selectedBranch as any).defaultStockLocationId || '');
    setAllowExternalSalesStock((selectedBranch as any).allowExternalSalesStock === true);
    setBranchStockDirty(false);
    setBranchStockSaved(false);
    setBranchStockError(null);
  }, [selectedBranch?.id]);

  const filteredBranches = useMemo(
    () => branches.filter((branch) => !normalizeText(branchQuery) || normalizeText(String(branch.name || '')).includes(normalizeText(branchQuery))),
    [branchQuery, branches]
  );
  
  const branchHasExactMatch = useMemo(
    () => branches.some((branch) => normalizeText(String(branch.name || '')) === normalizeText(branchQuery)),
    [branchQuery, branches]
  );
  
  const branchCreateOptionVisible = Boolean(normalizeText(branchQuery) && !branchHasExactMatch);
  
  const branchMenuHasContent = filteredBranches.length > 0 || branchCreateOptionVisible;

  const commitSelectedBranch = (branchId: string, branchName?: string) => {
    const normalizedBranchId = String(branchId || '').trim();
    if (!normalizedBranchId) return;
    form.setValue('currentBranchId', normalizedBranchId, { shouldDirty: true, shouldValidate: true });
    form.clearErrors('currentBranchId');
    form.clearErrors('currentLocationId');
    form.clearErrors('root.serverError');
    if (typeof branchName === 'string' && branchName.trim()) {
      setBranchQuery(branchName.trim());
    }
    setBranchMenuOpen(false);
  };

  useEffect(() => {
    if (!settings) return;
    const clothingEnabled = settings.clothingModuleEnabled === true;
    const rawActivity = String(tenant?.activityType || tenant?.pillar || settings.activityType || (settings as any)?.businessIndustry || tenant?.businessName || settings?.storeName || 'retail_general').trim().toLowerCase();
    const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
    const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';
    const isWholesaleVertical = rawActivity === 'wholesale_van' || rawActivity === 'wholesale' || rawActivity === 'distribution' || rawActivity.includes('توزيع') || rawActivity.includes('فان') || rawActivity.includes('جمل');
    const isWarehousingVertical = rawActivity === 'warehousing' || rawActivity === 'warehouse' || rawActivity === 'wms' || rawActivity.includes('مخازن') || rawActivity.includes('مستودع');

    form.reset({
      storeName: settings.storeName || 'Z Systems',
      brandName: settings.brandName || settings.storeName || 'Z Systems',
      phone: settings.phone || '',
      address: settings.address || '',
      lowStockThreshold: Number(settings.lowStockThreshold || 5),
      invoiceFooter: settings.invoiceFooter || '',
      invoiceQR: settings.invoiceQR || '',
      taxNumber: settings.taxNumber || '',
      taxRate: Number(settings.taxRate || 0),
      taxMode: settings.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
      paperSize: settings.paperSize === 'receipt' ? 'receipt' : 'a4',
      receiptWidthMm: settings.receiptWidthMm === 58 ? 58 : 80,
      managerPin: '',
      autoBackup: settings.autoBackup === 'off' ? 'off' : 'on',
      accentColor: settings.accentColor || '#170c5c',
      logoData: settings.logoData || '',
      businessIndustry: ((settings as any)?.businessIndustry as any) || (isWholesaleVertical ? 'wholesale' : 'general'),
      currentBranchId: settings.currentBranchId || '',
      currentLocationId: settings.currentLocationId || '',
      clothingModuleEnabled: clothingEnabled,
      enableMobileStoreFeatures: settings.enableMobileStoreFeatures === true,
      enablePharmacyModule: settings.enablePharmacyModule === true,
      servicesModuleEnabled: settings.servicesModuleEnabled === true,
      maintenanceProfile: settings.maintenanceProfile || 'mobile',
      enableEnterpriseFeatures: isContractingVertical || isMaritimeVertical || isWholesaleVertical || isWarehousingVertical ? true : (settings.enableEnterpriseFeatures === true),
      technicianCommissionRate: Number(settings.technicianCommissionRate ?? 30),
      defaultProductKind: clothingEnabled && settings.defaultProductKind === 'fashion' ? 'fashion' : 'standard',
      defaultPosMode: settings.defaultPosMode === 'touch' ? 'touch' : 'scanner',
      deliveryFeeMode: settings.deliveryFeeMode === 'store_fleet' ? 'store_fleet' : 'freelance_courier',
      storeFleetCommissionRate: Number(settings.storeFleetCommissionRate ?? 0),
      defaultDeliveryFee: Number(settings.defaultDeliveryFee ?? 0),
      vanSettlementRequireSupervisorPin: (settings as any).vanSettlementRequireSupervisorPin === true,
      vanSettlementBlindMode: (settings as any).vanSettlementBlindMode === true,
      vanRepDiscountCapPercent: parseBoundedNumber(
        (settings as any).vanRepDiscountCapPercent ?? (settings as any).van_rep_discount_cap_percent,
        5,
        0,
        100,
      ),
      cashDiscountPercent: parseBoundedNumber(
        (settings as any).cashDiscountPercent ?? (settings as any).cash_discount_percent,
        0,
        0,
        100,
      ),
      manufacturingModuleEnabled: settings.manufacturingModuleEnabled === true,
      importModuleEnabled: settings.importModuleEnabled === true,
      maritimeFreightModuleEnabled: isMaritimeVertical ? true : (settings.maritimeFreightModuleEnabled === true),
      contractingModuleEnabled: isContractingVertical ? true : (settings.contractingModuleEnabled === true),
      comboModuleEnabled: settings.comboModuleEnabled === true,
      restaurantModuleEnabled: settings.restaurantModuleEnabled === true,
      phoneOrdersModuleEnabled: settings.phoneOrdersModuleEnabled === true,
      posShowCartMeta: settings.posShowCartMeta === true,
      posProductCardLayout: (settings.posProductCardLayout as any) || 'comfortable',
      posShowSearchBar: settings.posShowSearchBar !== false,
      posShowPriceTierToggle: settings.posShowPriceTierToggle !== false,
      posDefaultPriceType: settings.posDefaultPriceType === 'wholesale' ? 'wholesale' : 'retail',
      posShowCategories: settings.posShowCategories !== false,
      posShowQuickFilters: settings.posShowQuickFilters !== false,
      posMobileGridColumns: settings.posMobileGridColumns === '3' ? '3' : settings.posMobileGridColumns === '2' ? '2' : 'auto',
      posAutoHideBottomNav: settings.posAutoHideBottomNav !== false,
      printDeliveryRepOnReceipt: settings.printDeliveryRepOnReceipt === true,
      posModuleEnabled: isContractingVertical || isMaritimeVertical || isWholesaleVertical || isWarehousingVertical ? false : (settings.posModuleEnabled !== false),
      purchasesModuleEnabled: isContractingVertical || isMaritimeVertical ? true : (settings.purchasesModuleEnabled !== false),
      inventoryModuleEnabled: isContractingVertical ? true : (isMaritimeVertical ? false : (settings.inventoryModuleEnabled !== false)),
      hrModuleEnabled: isContractingVertical || isMaritimeVertical ? true : (settings.hrModuleEnabled === true),
      storefrontModuleEnabled: isWarehousingVertical || isContractingVertical || isMaritimeVertical || isWholesaleVertical ? false : (settings.storefrontModuleEnabled === true),
      installmentsModuleEnabled: isWholesaleVertical ? true : (settings.installmentsModuleEnabled === true),
      fixedAssetsModuleEnabled: isContractingVertical || isMaritimeVertical ? true : (settings.fixedAssetsModuleEnabled === true),
      taxDeclarationModuleEnabled: isContractingVertical || isMaritimeVertical ? true : (settings.taxDeclarationModuleEnabled === true),
      deliveryFleetModuleEnabled: isWholesaleVertical ? true : (settings.deliveryFleetModuleEnabled === true),
      deliveryRepsModuleEnabled: settings.deliveryRepsModuleEnabled !== undefined
        ? settings.deliveryRepsModuleEnabled === true
        : (!isWholesaleVertical && settings.deliveryFleetModuleEnabled === true),
      vanSalesModuleEnabled: isWholesaleVertical
        ? true
        : (settings.vanSalesModuleEnabled !== undefined
          ? settings.vanSalesModuleEnabled === true
          : (isWholesaleVertical && settings.deliveryFleetModuleEnabled === true)),
      allowNegativeStockSales: settings.allowNegativeStockSales === true || settings.allowSellingBelowStock === true,
      posHideOutOfStockItems: settings.posHideOutOfStockItems === true,
      allowZeroPurchaseCost: settings.allowZeroPurchaseCost === true,
      requireCashierShiftForSales: isWholesaleVertical || isWarehousingVertical || isContractingVertical || isMaritimeVertical ? false : (settings.requireCashierShiftForSales !== false),
      requirePasswordOnShiftOpen: settings.requirePasswordOnShiftOpen === true,
      restaurantTablesCount: Math.min(200, Math.max(1, Math.floor(Number(settings.restaurantTablesCount || 12)))),
      loyaltyEnabled: (settings as any)?.loyaltyEnabled === true,
      loyaltyPointsPer100Egp: Number((settings as any)?.loyaltyPointsPer100Egp ?? 10),
      loyaltyPointRedeemValue: Number((settings as any)?.loyaltyPointRedeemValue ?? 0.1),
      loyaltyMinRedeemPoints: Number((settings as any)?.loyaltyMinRedeemPoints ?? 50),
      loyaltyMaxDiscountPercentage: Number((settings as any)?.loyaltyMaxDiscountPercentage ?? 50),
      printShowLoyaltyPoints: (settings as any)?.printShowLoyaltyPoints === true,
      posMaxDiscountThresholdEnabled: settings.posMaxDiscountThresholdEnabled === true,
      posMaxDiscountThresholdType: (settings.posMaxDiscountThresholdType as any) || 'percentage',
      posMaxDiscountThresholdValue: Number(settings.posMaxDiscountThresholdValue ?? 10),
      posSmallDiscountFlatAllowance: Number((settings as any).posSmallDiscountFlatAllowance ?? 2),
      posLargeCashRefundThreshold: Number((settings as any).posLargeCashRefundThreshold ?? 500),
      posKitchenPrinterEnabled: settings.posKitchenPrinterEnabled === true,
      posAutoPrintReceipt: settings.posAutoPrintReceipt !== false,
      posCashDrawerPrinterEnabled: settings.posCashDrawerPrinterEnabled === true,
      posKitchenPrinterAuto: settings.posKitchenPrinterAuto === true,
      posKitchenPrinterMode: settings.posKitchenPrinterMode || 'detailed',
      posKitchenLanguage: (settings as any).posKitchenLanguage || 'dual',
      printBilingualItemNames: (settings as any).printBilingualItemNames === true,
      posElectronCashierPrinter: resolveElectronPrinter('cashier', settings), posElectronKitchenPrinter: resolveElectronPrinter('kitchen', settings), posElectronBarcodePrinter: resolveElectronPrinter('barcode', settings), posElectronDocumentPrinter: resolveElectronPrinter('document', settings),
      posWindowsPrinterName: resolveBridgePrinter('cashier', settings), posWindowsBarcodePrinterName: resolveBridgePrinter('barcode', settings), posWindowsDocumentPrinterName: resolveBridgePrinter('document', settings),
      posNetworkThermalPrinterIp: settings.posNetworkThermalPrinterIp || '',
      posNetworkThermalPrinterPort: Number((settings as any).posNetworkThermalPrinterPort ?? 9100) || 9100,
      weightedBarcodeEnabled: settings.weightedBarcodeEnabled === true,
      weightedBarcodePrefix: String(settings.weightedBarcodePrefix || '21').replace(/\D/g, '') || '21',
      weightedBarcodeProductCodeLength: Math.min(8, Math.max(3, Math.floor(Number(settings.weightedBarcodeProductCodeLength || 5)))),
      weightedBarcodeWeightDigits: Math.min(8, Math.max(3, Math.floor(Number(settings.weightedBarcodeWeightDigits || 5)))),
      weightedBarcodeWeightDecimals: Math.min(3, Math.max(0, Math.floor(Number(settings.weightedBarcodeWeightDecimals ?? 3)))),
      weightedBarcodeValueMode: settings.weightedBarcodeValueMode === 'price' ? 'price' : 'weight',
      printShowLogo: settings.printShowLogo !== false,
      printShowDocumentType: settings.printShowDocumentType !== false,
      printShowDocumentNumber: settings.printShowDocumentNumber !== false,
      printShowOrderType: settings.printShowOrderType !== false,
      printShowPhone: settings.printShowPhone !== false,
      printShowAddress: settings.printShowAddress !== false,
      printShowTaxNumber: settings.printShowTaxNumber === true,
      printShowCustomer: settings.printShowCustomer !== false,
      printShowDeliveryCustomerDetails: settings.printShowDeliveryCustomerDetails !== false,
      printShowCashier: settings.printShowCashier !== false,
      printShowBranch: settings.printShowBranch !== false,
      printShowLocation: settings.printShowLocation !== false,
      printShowTax: settings.printShowTax !== false,
      printShowPaymentMethod: settings.printShowPaymentMethod !== false,
      printShowItemSummary: settings.printShowItemSummary !== false,
      printShowItemCount: settings.printShowItemCount !== false,
      printShowPiecesCount: settings.printShowPiecesCount !== false,
      printShowPaymentBreakdown: settings.printShowPaymentBreakdown !== false,
      printShowDate: settings.printShowDate !== false,
      printShowHijriDate: Boolean(settings.printShowHijriDate),
      printShowItemOffers: settings.printShowItemOffers !== false,
      printShowDiscountBreakdown: settings.printShowDiscountBreakdown !== false,
      printShowSavingsBanner: settings.printShowSavingsBanner !== false,
      printShowInvoiceBarcode: settings.printShowInvoiceBarcode !== false,
      printShowFooter: settings.printShowFooter !== false,
      printCompactReceipt: settings.printCompactReceipt !== false,
      posReceiptTheme: settings.posReceiptTheme || 'classic',
      printNumberFormat: settings.printNumberFormat === 'english' ? 'english' : 'arabic',
      printDualReceiptForOnlineDelivery: Boolean(settings.printDualReceiptForOnlineDelivery),
      uiLanguage: settings.uiLanguage === 'en' ? 'en' : 'ar',
      currency: String(settings.currency || 'EGP').trim() || 'EGP',
      timezone: String(settings.timezone || 'Africa/Cairo').trim() || 'Africa/Cairo',
      dateFormat: settings.dateFormat === 'dd/MM/yyyy' ? 'dd/MM/yyyy' : 'yyyy-MM-dd',
      timeFormat: settings.timeFormat === '12h' ? '12h' : '24h',
      whatsappLinkMode: settings.whatsappLinkMode === 'app' ? 'app' : settings.whatsappLinkMode === 'web' ? 'web' : 'wa_me',
      defaultBranchIssueMode: settings.defaultBranchIssueMode === 'transfer_to_branch_stock' ? 'transfer_to_branch_stock' : 'final_issue',
      invoiceNumberingScheme: settings.invoiceNumberingScheme === 'sequential' ? 'sequential' : 'daily',
      expiryAlertDays: Math.max(1, Number(settings.expiryAlertDays || 60)),
      stagnantProductDays: Math.max(1, Number(settings.stagnantProductDays || 60)),
      posTerminalEnabled: settings.posTerminalEnabled === true,
      posTerminalProvider: (['geidea', 'paymob', 'fawry', 'network_international', 'mock_sandbox'].includes(settings.posTerminalProvider as any) ? settings.posTerminalProvider : 'mock_sandbox') as any,
      posTerminalName: settings.posTerminalName || 'جهاز الكاشير الرئيسي (EDC)',
      posTerminalIp: settings.posTerminalIp || '192.168.1.150',
      posTerminalPort: Number(settings.posTerminalPort || 8080),
      posTerminals: (Array.isArray(settings.posTerminals) && settings.posTerminals.length > 0)
        ? settings.posTerminals.map((t: any, idx: number) => ({
            id: t.id || `term-${idx + 1}`,
            name: t.name || `ماكينة ${idx + 1}`,
            provider: (['geidea', 'paymob', 'fawry', 'network_international', 'mock_sandbox'].includes(t.provider) ? t.provider : 'fawry') as any,
            ip: t.ip || '192.168.1.150',
            port: Number(t.port || 8080),
            enabled: Boolean(t.enabled),
            isDefault: t.isDefault ?? (idx === 0),
          }))
        : [
            {
              id: 'term-1',
              name: settings.posTerminalName || 'جهاز الكاشير الرئيسي (EDC)',
              provider: (['geidea', 'paymob', 'fawry', 'network_international', 'mock_sandbox'].includes(settings.posTerminalProvider as any) ? settings.posTerminalProvider : 'fawry') as any,
              ip: settings.posTerminalIp || '192.168.1.150',
              port: Number(settings.posTerminalPort || 8080),
              enabled: settings.posTerminalEnabled === true,
              isDefault: true,
            },
          ],
      contractingRetentionPercent: Number((settings as any).contractingRetentionPercent ?? 5),
      contractingAdvanceRecoveryMode: ((settings as any).contractingAdvanceRecoveryMode as any) || 'proportional',
      contractingDefaultProfitMargin: Number((settings as any).contractingDefaultProfitMargin ?? 15),
      contractingDefaultOverhead: Number((settings as any).contractingDefaultOverhead ?? 7),
      contractingDefaultWaste: Number((settings as any).contractingDefaultWaste ?? 5),
      contractingRequireBoqLinkForIssue: (settings as any).contractingRequireBoqLinkForIssue === true,
      maritimeDemurrageFreeDays: Number((settings as any).maritimeDemurrageFreeDays ?? 14),
      maritimeDefaultCurrency: (['EGP', 'USD', 'EUR'].includes((settings as any).maritimeDefaultCurrency) ? (settings as any).maritimeDefaultCurrency : 'USD') as 'EGP' | 'USD' | 'EUR',
      importLandedCostMethod: ((settings as any).importLandedCostMethod as any) || 'by_value',
      importAutoLinkBankExpenses: ((settings as any).importAutoLinkBankExpenses as any) || 'auto_link',
      servicesBillingMethod: ((settings as any).servicesBillingMethod as any) || 'deliverable',
      servicesContractRenewalNoticeDays: Number((settings as any).servicesContractRenewalNoticeDays ?? 30),
      ...buildZPayFormValues(settings),
      ...buildAntiTheftFormValues(settings),
    });
  }, [settings, form, branches]);

  useEffect(() => {
    const selectedLocationId = form.getValues('currentLocationId');
    if (selectedLocationId && !visibleLocations.some((location) => String(location.id) === String(selectedLocationId))) {
      form.setValue('currentLocationId', '', { shouldDirty: false });
    }
  }, [visibleLocations, form]);

  useEffect(() => {
    if (SINGLE_STORE_MODE) {
      const currentId = form.getValues('currentBranchId');
      const branchExists = currentId ? branches.some((b) => String(b.id) === String(currentId)) : false;
      
      if ((!currentId || !branchExists) && branches[0]?.id) {
        form.setValue('currentBranchId', String(branches[0].id), { shouldDirty: false });
      }
    }
  }, [branches, form]);

  useEffect(() => {
    if (!form.getValues('currentLocationId')) {
      const currentBranchId = form.getValues('currentBranchId');
      const branch = branches.find(b => String(b.id) === String(currentBranchId)) || branches[0];
      if (branch?.defaultStockLocationId) {
        form.setValue('currentLocationId', String(branch.defaultStockLocationId), { shouldDirty: false });
      } else if (SINGLE_STORE_MODE && visibleLocations[0]?.id) {
        form.setValue('currentLocationId', String(visibleLocations[0].id), { shouldDirty: false });
      }
    }
  }, [visibleLocations, branches, form]);

  useEffect(() => {
    if (!clothingModuleEnabled && form.getValues('defaultProductKind') !== 'standard') {
      form.setValue('defaultProductKind', 'standard', { shouldDirty: false });
    }
  }, [clothingModuleEnabled, form]);

  useEffect(() => {
    if (!branchMenuOpen) setBranchQuery(selectedBranch?.name || '');
  }, [branchMenuOpen, selectedBranch?.name]);

  useEffect(() => {
    if (!form.getValues('currentBranchId') && branches.length === 1 && branches[0]?.id) {
      form.setValue('currentBranchId', String(branches[0].id), { shouldDirty: false });
    }
  }, [branches, form]);

  useEffect(() => {
    if (!form.getValues('currentLocationId') && visibleLocations.length === 1 && visibleLocations[0]?.id) {
      form.setValue('currentLocationId', String(visibleLocations[0].id), { shouldDirty: false });
    }
  }, [visibleLocations, form]);


  const disabled = mutation.isPending || !canManageSettings;
  const watchedLanguage = form.watch('uiLanguage');

  useEffect(() => {
    if (form.formState.dirtyFields.uiLanguage) {
      setLocaleLanguage(watchedLanguage === 'en' ? 'en' : 'ar');
    }
  }, [setLocaleLanguage, watchedLanguage, form.formState.dirtyFields.uiLanguage]);

  const navigateToFieldAndHighlight = (fieldKey: string) => {
    const meta = SETTINGS_FIELD_METADATA[fieldKey];
    const targetTab = meta ? meta.tab : 'general';

    setActiveTab(targetTab);

    setTimeout(() => {
      // 1. Search for input element by name, id or data-field
      const input =
        document.querySelector<HTMLElement>(`[name="${fieldKey}"]`) ||
        document.getElementById(fieldKey) ||
        document.querySelector<HTMLElement>(`#${fieldKey}`) ||
        document.querySelector<HTMLElement>(`[data-field="${fieldKey}"]`);

      let highlightTarget: HTMLElement | null = input;

      if (input) {
        // Walk up to find the enclosing card, label, or field row
        let curr: HTMLElement | null = input.parentElement;
        while (
          curr &&
          curr !== document.body &&
          !curr.classList.contains('settings-two-col-grid') &&
          !curr.classList.contains('settings-tab-content-wrapper') &&
          !curr.classList.contains('document-prototype-section') &&
          !curr.classList.contains('page-stack')
        ) {
          if (
            curr.tagName === 'LABEL' ||
            curr.style.border ||
            curr.style.borderRadius ||
            curr.classList.contains('field') ||
            curr.classList.contains('form-group') ||
            curr.classList.contains('form-row')
          ) {
            highlightTarget = curr;
            break;
          }
          curr = curr.parentElement;
        }
      }

      if (highlightTarget) {
        highlightTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

        document.querySelectorAll('.settings-error-highlight').forEach((el) => {
          el.classList.remove('settings-error-highlight');
        });

        void highlightTarget.offsetWidth;
        highlightTarget.classList.add('settings-error-highlight');

        if (input && typeof input.focus === 'function') {
          try {
            input.focus({ preventScroll: true });
          } catch {
            // Ignore focus errors
          }
        }

        setTimeout(() => {
          highlightTarget?.classList.remove('settings-error-highlight');
        }, 3600);
      } else {
        const wrapper = document.querySelector('.settings-tab-content-wrapper');
        wrapper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 120);
  };

  const submit = form.handleSubmit(
    async (values) => {
      let branchIdToUse = String(values.currentBranchId || '').trim();
      const locationIdToUse = String(values.currentLocationId || '').trim();

      if (!branchIdToUse && branchQuery.trim()) {
        const existingBranch = branches.find((b) => normalizeText(String(b.name || '')) === normalizeText(branchQuery));
        if (existingBranch) {
          branchIdToUse = String(existingBranch.id);
        } else {
          try {
            // Fallback dynamic import if settingsApi is not at the top
            const { settingsApi } = await import('@/features/settings/api/settings.api');
            const res = await settingsApi.createBranch({ name: branchQuery.trim() });
            const newId = res.branchId || res.branch?.id;
            if (res.ok && newId) branchIdToUse = String(newId);
          } catch (err) {
            console.error(err);
          }
        }
      }

      const rawActivity = String(values.businessIndustry || tenant?.activityType || tenant?.pillar || settings?.activityType || tenant?.businessName || settings?.storeName || 'retail_general').trim().toLowerCase();
      const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
      const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';
      const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع';
      const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
      const isWholesaleVertical = rawActivity === 'wholesale_van' || rawActivity === 'wholesale' || rawActivity === 'distribution' || rawActivity.includes('توزيع') || rawActivity.includes('فان') || rawActivity.includes('جمل');
      const isWarehousingVertical = rawActivity === 'warehousing' || rawActivity === 'warehouse' || rawActivity === 'wms' || rawActivity.includes('مخازن') || rawActivity.includes('مستودع');

      values.currentBranchId = branchIdToUse;
      values.currentLocationId = locationIdToUse;

      const isBranchMissing = !String(values.currentBranchId || '').trim();
      const isLocationMissing = !isMaritimeVertical && !String(values.currentLocationId || '').trim();

      if (isBranchMissing) {
        form.setError('currentBranchId', { type: 'manual', message: 'يجب اختيار الفرع الرئيسي قبل حفظ الإعدادات.' });
      }
      
      if (isLocationMissing) {
        form.setError('currentLocationId', { type: 'manual', message: 'يجب اختيار مكان الاستلام الافتراضي قبل حفظ الإعدادات.' });
      }

      const missingCoreFields =
        !String(values.storeName || '').trim() ||
        !String(values.defaultPosMode || '').trim() ||
        !String(values.paperSize || '').trim();

      if (missingCoreFields) {
        form.setError('storeName', {
          type: 'manual',
          message: form.formState.errors.storeName?.message || 'يرجى إكمال الحقول المطلوبة قبل حفظ الإعدادات.',
        });
      }

      if (isBranchMissing || isLocationMissing || missingCoreFields) {
        form.setError('root.serverError', { type: 'manual', message: 'يرجى إكمال الحقول المطلوبة قبل حفظ الإعدادات.' });
        if (isBranchMissing) navigateToFieldAndHighlight('currentBranchId');
        else if (isLocationMissing) navigateToFieldAndHighlight('currentLocationId');
        else if (missingCoreFields) navigateToFieldAndHighlight('storeName');
        return;
      }

      form.clearErrors('root.serverError');

      if (isContractingVertical) {
        values.contractingModuleEnabled = true;
        values.purchasesModuleEnabled = true;
        values.inventoryModuleEnabled = true;
        values.hrModuleEnabled = true;
        values.enableEnterpriseFeatures = true;
        values.fixedAssetsModuleEnabled = true;
        values.taxDeclarationModuleEnabled = true;
        values.posModuleEnabled = false;
        values.maritimeFreightModuleEnabled = false;
        values.manufacturingModuleEnabled = false;
        values.servicesModuleEnabled = false;
      } else if (isMaritimeVertical) {
        values.maritimeFreightModuleEnabled = true;
        values.purchasesModuleEnabled = true;
        values.hrModuleEnabled = true;
        values.enableEnterpriseFeatures = true;
        values.fixedAssetsModuleEnabled = true;
        values.taxDeclarationModuleEnabled = true;
        values.contractingModuleEnabled = false;
        values.manufacturingModuleEnabled = false;
        values.inventoryModuleEnabled = false;
        values.posModuleEnabled = false;
        values.servicesModuleEnabled = false;
      } else if (isManufacturingVertical) {
        values.manufacturingModuleEnabled = true;
        values.purchasesModuleEnabled = true;
        values.inventoryModuleEnabled = true;
        values.hrModuleEnabled = true;
        values.enableEnterpriseFeatures = true;
        values.fixedAssetsModuleEnabled = true;
        values.taxDeclarationModuleEnabled = true;
        values.contractingModuleEnabled = false;
        values.maritimeFreightModuleEnabled = false;
        values.servicesModuleEnabled = false;
        values.posModuleEnabled = false;
      } else if (isWholesaleVertical) {
        values.posModuleEnabled = false;
        values.requireCashierShiftForSales = false;
        values.requirePasswordOnShiftOpen = false;
        values.vanSalesModuleEnabled = true;
        values.deliveryFleetModuleEnabled = true;
        values.deliveryRepsModuleEnabled = false;
        values.enableEnterpriseFeatures = true;
        values.installmentsModuleEnabled = true;
        values.contractingModuleEnabled = false;
        values.maritimeFreightModuleEnabled = false;
        values.manufacturingModuleEnabled = false;
        values.servicesModuleEnabled = false;
      } else if (isWarehousingVertical) {
        values.posModuleEnabled = false;
        values.requireCashierShiftForSales = false;
        values.requirePasswordOnShiftOpen = false;
        values.inventoryModuleEnabled = true;
        values.purchasesModuleEnabled = true;
        values.enableEnterpriseFeatures = true;
        values.contractingModuleEnabled = false;
        values.maritimeFreightModuleEnabled = false;
        values.manufacturingModuleEnabled = false;
        values.servicesModuleEnabled = false;
        values.deliveryRepsModuleEnabled = false;
        values.deliveryFleetModuleEnabled = false;
        values.vanSalesModuleEnabled = false;
        values.storefrontModuleEnabled = false;
      } else {
        values.contractingModuleEnabled = false;
        values.maritimeFreightModuleEnabled = false;
        values.manufacturingModuleEnabled = false;
        if (!isServicesVertical) {
          values.servicesModuleEnabled = false;
        }
      }

      values.activityType = values.businessIndustry;

      mutation.mutate(values);
    },
    (errors) => {
      // Auto navigate to the first invalid field and highlight it with glow
      const errorKeys = Object.keys(errors).filter((k) => k !== 'root');
      if (errorKeys.length > 0) {
        navigateToFieldAndHighlight(errorKeys[0]);
      }
    }
  );

  const tabErrors = useMemo(() => {
    const errors = form.formState.errors;
    const map: Record<
      'general' | 'sales_inventory' | 'modules' | 'printing',
      { fieldKey: string; label: string; message?: string }[]
    > = {
      general: [],
      sales_inventory: [],
      modules: [],
      printing: [],
    };

    for (const [field, err] of Object.entries(errors)) {
      if (!err || field === 'root') continue;
      const meta = SETTINGS_FIELD_METADATA[field];
      const label = meta ? meta.label : field;
      const tab = meta ? meta.tab : 'general';
      const rawMessage = (err as any)?.message;
      const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.trim() : undefined;

      map[tab].push({
        fieldKey: field,
        label,
        message,
      });
    }
    return map;
  }, [form.formState.errors]);

  return (
    <form id="settings-main-form" className="page-stack settings-core-form" autoComplete="off" onSubmit={submit} noValidate>
      <style>{`
        @keyframes settingsErrorGlowPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7), inset 0 0 0 1px rgba(239, 68, 68, 0.5);
            border-color: #ef4444 !important;
            background-color: #fef2f2 !important;
          }
          50% {
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0.25), inset 0 0 0 2px rgba(239, 68, 68, 0.8);
            border-color: #dc2626 !important;
            background-color: #fee2e2 !important;
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0), inset 0 0 0 1px rgba(239, 68, 68, 0.5);
            border-color: #ef4444 !important;
            background-color: #fef2f2 !important;
          }
        }

        .settings-error-highlight {
          animation: settingsErrorGlowPulse 1.1s ease-in-out 3 !important;
          border-color: #ef4444 !important;
          outline: 2.5px solid #ef4444 !important;
          outline-offset: 3px !important;
          border-radius: 10px !important;
          transition: all 0.25s ease-in-out !important;
        }
      `}</style>

        <SettingsMainFormSetupBanner
          setupMode={setupMode}
          __t={__t}
          onSetupAdvance={onSetupAdvance}
          navigate={navigate}
        />

        <SettingsMainFormNotices
          form={form}
          mutation={mutation}
          __t={__t}
          canManageSettings={canManageSettings}
          tabErrors={tabErrors}
          navigateToFieldAndHighlight={navigateToFieldAndHighlight}
        />
        <SettingsMainFormTabs
          __t={__t}
          salesInventoryTabLabel={salesInventoryTabLabel}
          printingTabLabel={printingTabLabel}
          setActiveTab={setActiveTab}
          activeTab={activeTab}
          tabErrors={tabErrors}
          form={form}
          branches={branches}
          locations={locations}
          canManageSettings={canManageSettings}
          disabled={disabled}
          branchQuery={branchQuery}
          setBranchQuery={setBranchQuery}
          filteredBranches={filteredBranches}
          selectedBranch={selectedBranch || undefined}
          stockMode={stockMode}
          setStockMode={setStockMode}
          defaultStockLocationId={defaultStockLocationId}
          setDefaultStockLocationId={setDefaultStockLocationId}
          allowExternalSalesStock={allowExternalSalesStock}
          setAllowExternalSalesStock={setAllowExternalSalesStock}
          branchStockSaving={branchStockSaving}
          setBranchStockSaving={setBranchStockSaving}
          branchStockSaved={branchStockSaved}
          setBranchStockSaved={setBranchStockSaved}
          branchStockError={branchStockError}
          setBranchStockError={setBranchStockError}
          branchStockDirty={branchStockDirty}
          setBranchStockDirty={setBranchStockDirty}
          branchMenuOpen={branchMenuOpen}
          setBranchMenuOpen={setBranchMenuOpen}
          branchMenuHasContent={branchMenuHasContent}
          branchCreateOptionVisible={branchCreateOptionVisible}
          commitSelectedBranch={commitSelectedBranch}
          setBranchPrefillName={setBranchPrefillName}
          setShowBranchQuickAdd={setShowBranchQuickAdd}
          visibleLocations={visibleLocations}
          onUpdateBranch={onUpdateBranch}
          settings={settings}
          systemPrinters={systemPrinters}
        />

      <SettingsMainFormActions
        canManageSettings={canManageSettings}
        __t={__t}
        mutation={mutation}
        setupMode={setupMode}
        canNavigateAway={canNavigateAway}
        form={form}
        showSaveSuccess={showSaveSuccess}
        showBranchQuickAdd={showBranchQuickAdd}
        setShowBranchQuickAdd={setShowBranchQuickAdd}
        onSetupAdvance={onSetupAdvance}
        locations={locations}
        branchPrefillName={branchPrefillName}
        commitSelectedBranch={commitSelectedBranch}
        branches={branches}
        setBranchQuery={setBranchQuery}
      />


    </form>
  );
}
