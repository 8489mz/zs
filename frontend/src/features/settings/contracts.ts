import type { AppSettings } from '@/types/domain';
import type { BranchFormOutput, LocationFormOutput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

function cleanText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
}

export function buildSettingsUpdatePayload(
  currentSettings: AppSettings | undefined,
  values: SettingsFormOutput | Record<string, any>
) {
  const current = currentSettings as Record<string, any> | undefined;

  // Preserve core branding and store identity safely
  const storeName = values.storeName !== undefined && cleanText(values.storeName)
    ? cleanText(values.storeName)
    : cleanText(current?.storeName, 'Z Systems');

  const brandName = values.brandName !== undefined && cleanText(values.brandName)
    ? cleanText(values.brandName)
    : cleanText(current?.brandName, current?.storeName || 'Z Systems');

  const phone = values.phone !== undefined ? cleanText(values.phone) : cleanText(current?.phone);
  const address = values.address !== undefined ? cleanText(values.address) : cleanText(current?.address);
  const logoData = values.logoData !== undefined ? cleanText(values.logoData) : cleanText(current?.logoData);
  const currentBranchId = values.currentBranchId !== undefined && cleanText(values.currentBranchId)
    ? cleanText(values.currentBranchId)
    : cleanText(current?.currentBranchId);
  const currentLocationId = values.currentLocationId !== undefined && cleanText(values.currentLocationId)
    ? cleanText(values.currentLocationId)
    : cleanText(current?.currentLocationId);

  const lowStockThreshold = values.lowStockThreshold !== undefined
    ? Math.max(0, Number(values.lowStockThreshold || 0))
    : Math.max(0, Number(current?.lowStockThreshold || 0));

  const invoiceFooter = values.invoiceFooter !== undefined ? cleanText(values.invoiceFooter) : cleanText(current?.invoiceFooter);
  const invoiceQR = values.invoiceQR !== undefined ? cleanText(values.invoiceQR) : cleanText(current?.invoiceQR);
  const taxNumber = values.taxNumber !== undefined ? cleanText(values.taxNumber) : cleanText(current?.taxNumber);
  const taxRate = values.taxRate !== undefined
    ? normalizeMoney(Number(values.taxRate || 0))
    : normalizeMoney(Number(current?.taxRate || 0));
  const taxMode = values.taxMode !== undefined
    ? (values.taxMode === 'inclusive' ? 'inclusive' : 'exclusive')
    : (current?.taxMode === 'inclusive' ? 'inclusive' : 'exclusive');
  const paperSize = values.paperSize !== undefined
    ? (values.paperSize === 'receipt' ? 'receipt' : 'a4')
    : (current?.paperSize === 'a4' ? 'a4' : 'receipt');

  const managerPin = values.managerPin !== undefined ? cleanText(values.managerPin) : cleanText(current?.managerPin);
  const autoBackup = values.autoBackup !== undefined
    ? (values.autoBackup === 'off' ? 'off' : 'on')
    : (current?.autoBackup === 'off' ? 'off' : 'on');
  const accentColor = values.accentColor !== undefined && cleanText(values.accentColor)
    ? cleanText(values.accentColor)
    : cleanText(current?.accentColor, '#170c5c');

  // Module configurations
  const clothingModuleEnabled = values.clothingModuleEnabled !== undefined
    ? values.clothingModuleEnabled === true
    : current?.clothingModuleEnabled === true;

  const defaultProductKind = values.defaultProductKind !== undefined
    ? (clothingModuleEnabled && values.defaultProductKind === 'fashion' ? 'fashion' : 'standard')
    : (current?.defaultProductKind || 'standard');

  const defaultPosMode = values.defaultPosMode !== undefined
    ? (values.defaultPosMode === 'touch' ? 'touch' : 'scanner')
    : (current?.defaultPosMode || 'scanner');

  const deliveryFeeMode = values.deliveryFeeMode !== undefined
    ? (values.deliveryFeeMode === 'store_fleet' ? 'store_fleet' : 'freelance_courier')
    : (current?.deliveryFeeMode || 'freelance_courier');

  const storeFleetCommissionRate = values.storeFleetCommissionRate !== undefined
    ? Math.max(0, Math.min(100, Number(values.storeFleetCommissionRate || 0)))
    : Math.max(0, Math.min(100, Number(current?.storeFleetCommissionRate || 0)));

  const defaultDeliveryFee = values.defaultDeliveryFee !== undefined
    ? Math.max(0, normalizeMoney(Number(values.defaultDeliveryFee || 0)))
    : Math.max(0, normalizeMoney(Number(current?.defaultDeliveryFee || 0)));

  const settings = {
    ...(currentSettings || {}),
    storeName,
    brandName,
    phone,
    address,
    lowStockThreshold,
    invoiceFooter,
    invoiceQR,
    taxNumber,
    taxRate,
    taxMode,
    paperSize,
    receiptWidthMm: Number(values.receiptWidthMm ?? current?.receiptWidthMm) === 58 ? 58 : 80,
    ...(managerPin ? { managerPin } : {}),
    autoBackup,
    accentColor,
    logoData,
    currentBranchId,
    currentLocationId,
    clothingModuleEnabled,
    enableMobileStoreFeatures: values.enableMobileStoreFeatures !== undefined
      ? values.enableMobileStoreFeatures === true
      : current?.enableMobileStoreFeatures === true,
    enablePharmacyModule: values.enablePharmacyModule !== undefined
      ? values.enablePharmacyModule === true
      : current?.enablePharmacyModule === true,
    servicesModuleEnabled: values.servicesModuleEnabled !== undefined
      ? values.servicesModuleEnabled === true
      : current?.servicesModuleEnabled === true,
    maintenanceProfile: values.maintenanceProfile || current?.maintenanceProfile || 'mobile',
    enableEnterpriseFeatures: values.enableEnterpriseFeatures !== undefined
      ? values.enableEnterpriseFeatures === true
      : current?.enableEnterpriseFeatures === true,
    technicianCommissionRate: values.technicianCommissionRate !== undefined
      ? Number(values.technicianCommissionRate ?? 30)
      : Number(current?.technicianCommissionRate ?? 30),
    defaultProductKind,
    defaultPosMode,
    deliveryFeeMode,
    storeFleetCommissionRate,
    defaultDeliveryFee,
    crmModuleEnabled: values.crmModuleEnabled !== undefined
      ? values.crmModuleEnabled === true
      : current?.crmModuleEnabled === true,
    manufacturingModuleEnabled: values.manufacturingModuleEnabled !== undefined
      ? values.manufacturingModuleEnabled === true
      : current?.manufacturingModuleEnabled === true,
    importModuleEnabled: values.importModuleEnabled !== undefined
      ? values.importModuleEnabled === true
      : current?.importModuleEnabled === true,
    autoPartsModuleEnabled: values.autoPartsModuleEnabled !== undefined
      ? values.autoPartsModuleEnabled === true
      : current?.autoPartsModuleEnabled === true,
    maritimeFreightModuleEnabled: values.maritimeFreightModuleEnabled !== undefined
      ? values.maritimeFreightModuleEnabled === true
      : current?.maritimeFreightModuleEnabled === true,
    contractingModuleEnabled: values.contractingModuleEnabled !== undefined
      ? values.contractingModuleEnabled === true
      : current?.contractingModuleEnabled === true,
    comboModuleEnabled: values.comboModuleEnabled !== undefined
      ? values.comboModuleEnabled === true
      : current?.comboModuleEnabled === true,
    restaurantModuleEnabled: values.restaurantModuleEnabled !== undefined
      ? values.restaurantModuleEnabled === true
      : current?.restaurantModuleEnabled === true,
    phoneOrdersModuleEnabled: values.phoneOrdersModuleEnabled !== undefined
      ? values.phoneOrdersModuleEnabled === true
      : current?.phoneOrdersModuleEnabled === true,
    posShowCartMeta: values.posShowCartMeta !== undefined
      ? values.posShowCartMeta === true
      : current?.posShowCartMeta === true,
    posProductCardLayout: values.posProductCardLayout !== undefined
      ? values.posProductCardLayout
      : (current?.posProductCardLayout || 'comfortable'),
    posShowSearchBar: values.posShowSearchBar !== undefined
      ? values.posShowSearchBar === true
      : (current?.posShowSearchBar !== false),
    posShowPriceTierToggle: values.posShowPriceTierToggle !== undefined
      ? values.posShowPriceTierToggle === true
      : (current?.posShowPriceTierToggle !== false),
    posDefaultPriceType: values.posDefaultPriceType !== undefined
      ? (values.posDefaultPriceType === 'wholesale' ? 'wholesale' : 'retail')
      : (current?.posDefaultPriceType === 'wholesale' ? 'wholesale' : 'retail'),
    posShowCategories: values.posShowCategories !== undefined
      ? values.posShowCategories === true
      : (current?.posShowCategories !== false),
    posShowQuickFilters: values.posShowQuickFilters !== undefined
      ? values.posShowQuickFilters === true
      : (current?.posShowQuickFilters !== false),
    posMobileGridColumns: values.posMobileGridColumns !== undefined
      ? values.posMobileGridColumns
      : (current?.posMobileGridColumns || 'auto'),
    posAutoHideBottomNav: values.posAutoHideBottomNav !== undefined
      ? values.posAutoHideBottomNav === true
      : (current?.posAutoHideBottomNav !== false),
    printDeliveryRepOnReceipt: values.printDeliveryRepOnReceipt !== undefined
      ? values.printDeliveryRepOnReceipt === true
      : current?.printDeliveryRepOnReceipt === true,
    posModuleEnabled: values.posModuleEnabled !== undefined
      ? values.posModuleEnabled !== false
      : current?.posModuleEnabled !== false,
    purchasesModuleEnabled: values.purchasesModuleEnabled !== undefined
      ? values.purchasesModuleEnabled !== false
      : current?.purchasesModuleEnabled !== false,
    inventoryModuleEnabled: values.inventoryModuleEnabled !== undefined
      ? values.inventoryModuleEnabled !== false
      : current?.inventoryModuleEnabled !== false,
    hrModuleEnabled: values.hrModuleEnabled !== undefined
      ? values.hrModuleEnabled === true
      : current?.hrModuleEnabled === true,
    businessIndustry: values.businessIndustry || current?.businessIndustry || 'general',
    activityType: values.activityType || values.businessIndustry || current?.activityType || undefined,
    onboardingCompleted: values.onboardingCompleted !== undefined
      ? Boolean(values.onboardingCompleted)
      : (current?.onboardingCompleted ?? true),
    storefrontModuleEnabled: values.storefrontModuleEnabled !== undefined
      ? values.storefrontModuleEnabled === true
      : current?.storefrontModuleEnabled === true,
    installmentsModuleEnabled: values.installmentsModuleEnabled !== undefined
      ? values.installmentsModuleEnabled === true
      : current?.installmentsModuleEnabled === true,
    fixedAssetsModuleEnabled: values.fixedAssetsModuleEnabled !== undefined
      ? values.fixedAssetsModuleEnabled === true
      : current?.fixedAssetsModuleEnabled === true,
    taxDeclarationModuleEnabled: values.taxDeclarationModuleEnabled !== undefined
      ? values.taxDeclarationModuleEnabled === true
      : current?.taxDeclarationModuleEnabled === true,
    deliveryFleetModuleEnabled: values.deliveryFleetModuleEnabled !== undefined
      ? values.deliveryFleetModuleEnabled === true
      : current?.deliveryFleetModuleEnabled === true,
    deliveryRepsModuleEnabled: values.deliveryRepsModuleEnabled !== undefined
      ? values.deliveryRepsModuleEnabled === true
      : current?.deliveryRepsModuleEnabled === true,
    vanSalesModuleEnabled: values.vanSalesModuleEnabled !== undefined
      ? values.vanSalesModuleEnabled === true
      : current?.vanSalesModuleEnabled === true,
    loyaltyEnabled: values.loyaltyEnabled !== undefined
      ? values.loyaltyEnabled === true
      : current?.loyaltyEnabled === true,
    loyaltyPointsPer100Egp: values.loyaltyPointsPer100Egp !== undefined
      ? Math.max(0, Number(values.loyaltyPointsPer100Egp ?? 10))
      : Math.max(0, Number(current?.loyaltyPointsPer100Egp ?? 10)),
    loyaltyPointRedeemValue: values.loyaltyPointRedeemValue !== undefined
      ? Math.max(0.01, Number(values.loyaltyPointRedeemValue ?? 0.1))
      : Math.max(0.01, Number(current?.loyaltyPointRedeemValue ?? 0.1)),
    loyaltyMinRedeemPoints: values.loyaltyMinRedeemPoints !== undefined
      ? Math.max(0, Number(values.loyaltyMinRedeemPoints ?? 50))
      : Math.max(0, Number(current?.loyaltyMinRedeemPoints ?? 50)),
    loyaltyMaxDiscountPercentage: values.loyaltyMaxDiscountPercentage !== undefined
      ? Math.max(1, Math.min(100, Number(values.loyaltyMaxDiscountPercentage ?? 50)))
      : Math.max(1, Math.min(100, Number(current?.loyaltyMaxDiscountPercentage ?? 50))),
    printShowLoyaltyPoints: values.printShowLoyaltyPoints !== undefined
      ? values.printShowLoyaltyPoints === true
      : current?.printShowLoyaltyPoints === true,
    allowNegativeStockSales: values.allowNegativeStockSales !== undefined
      ? values.allowNegativeStockSales === true
      : current?.allowNegativeStockSales === true,
    allowSellingBelowStock: values.allowNegativeStockSales !== undefined
      ? values.allowNegativeStockSales === true
      : current?.allowNegativeStockSales === true,
    posHideOutOfStockItems: values.posHideOutOfStockItems !== undefined
      ? values.posHideOutOfStockItems === true
      : current?.posHideOutOfStockItems === true,
    allowZeroPurchaseCost: values.allowZeroPurchaseCost !== undefined
      ? values.allowZeroPurchaseCost === true
      : current?.allowZeroPurchaseCost === true,
    requireCashierShiftForSales: values.requireCashierShiftForSales !== undefined
      ? values.requireCashierShiftForSales !== false
      : current?.requireCashierShiftForSales !== false,
    requirePasswordOnShiftOpen: values.requirePasswordOnShiftOpen !== undefined
      ? values.requirePasswordOnShiftOpen === true
      : current?.requirePasswordOnShiftOpen === true,
    restaurantTablesCount: values.restaurantTablesCount !== undefined
      ? Math.min(200, Math.max(1, Math.floor(Number(values.restaurantTablesCount || 12))))
      : Math.min(200, Math.max(1, Math.floor(Number(current?.restaurantTablesCount || 12)))),
    restaurantServiceChargeEnabled: values.restaurantServiceChargeEnabled !== undefined
      ? values.restaurantServiceChargeEnabled === true
      : current?.restaurantServiceChargeEnabled === true,
    restaurantServiceChargePercent: values.restaurantServiceChargePercent !== undefined
      ? Math.min(100, Math.max(0, Number(values.restaurantServiceChargePercent ?? 12)))
      : Math.min(100, Math.max(0, Number(current?.restaurantServiceChargePercent ?? 12))),
    posMaxDiscountThresholdEnabled: values.posMaxDiscountThresholdEnabled !== undefined
      ? values.posMaxDiscountThresholdEnabled === true
      : current?.posMaxDiscountThresholdEnabled === true,
    posMaxDiscountThresholdType: values.posMaxDiscountThresholdType !== undefined
      ? (values.posMaxDiscountThresholdType === 'fixed' ? 'fixed' : 'percentage')
      : (current?.posMaxDiscountThresholdType === 'fixed' ? 'fixed' : 'percentage'),
    posMaxDiscountThresholdValue: values.posMaxDiscountThresholdValue !== undefined
      ? Math.max(0, Number(values.posMaxDiscountThresholdValue ?? 10))
      : Math.max(0, Number(current?.posMaxDiscountThresholdValue ?? 10)),
    posSmallDiscountFlatAllowance: values.posSmallDiscountFlatAllowance !== undefined
      ? Math.max(0, Number(values.posSmallDiscountFlatAllowance ?? 2))
      : Math.max(0, Number(current?.posSmallDiscountFlatAllowance ?? 2)),
    posKitchenPrinterEnabled: values.posKitchenPrinterEnabled !== undefined
      ? values.posKitchenPrinterEnabled === true
      : current?.posKitchenPrinterEnabled === true,
    posKitchenPrinterAuto: values.posKitchenPrinterAuto !== undefined
      ? values.posKitchenPrinterAuto === true
      : current?.posKitchenPrinterAuto === true,
    posKitchenPrinterMode: values.posKitchenPrinterMode !== undefined
      ? (values.posKitchenPrinterMode === 'mini' ? 'mini' : 'detailed')
      : (current?.posKitchenPrinterMode === 'mini' ? 'mini' : 'detailed'),
    posKitchenLanguage: values.posKitchenLanguage !== undefined
      ? values.posKitchenLanguage
      : (current?.posKitchenLanguage || 'dual'),
    printBilingualItemNames: values.printBilingualItemNames !== undefined
      ? values.printBilingualItemNames === true
      : current?.printBilingualItemNames === true,
    posElectronCashierPrinter: values.posElectronCashierPrinter !== undefined
      ? cleanText(values.posElectronCashierPrinter)
      : cleanText(current?.posElectronCashierPrinter),
    posElectronKitchenPrinter: values.posElectronKitchenPrinter !== undefined
      ? cleanText(values.posElectronKitchenPrinter)
      : cleanText(current?.posElectronKitchenPrinter),
    weightedBarcodeEnabled: values.weightedBarcodeEnabled !== undefined
      ? values.weightedBarcodeEnabled === true
      : current?.weightedBarcodeEnabled === true,
    weightedBarcodePrefix: values.weightedBarcodePrefix !== undefined
      ? (cleanText(values.weightedBarcodePrefix, '21').replace(/\D/g, '') || '21')
      : (cleanText(current?.weightedBarcodePrefix, '21').replace(/\D/g, '') || '21'),
    weightedBarcodeProductCodeLength: values.weightedBarcodeProductCodeLength !== undefined
      ? Math.min(8, Math.max(3, Math.floor(Number(values.weightedBarcodeProductCodeLength || 5))))
      : Math.min(8, Math.max(3, Math.floor(Number(current?.weightedBarcodeProductCodeLength || 5)))),
    weightedBarcodeWeightDigits: values.weightedBarcodeWeightDigits !== undefined
      ? Math.min(8, Math.max(3, Math.floor(Number(values.weightedBarcodeWeightDigits || 5))))
      : Math.min(8, Math.max(3, Math.floor(Number(current?.weightedBarcodeWeightDigits || 5)))),
    weightedBarcodeWeightDecimals: values.weightedBarcodeWeightDecimals !== undefined
      ? Math.min(3, Math.max(0, Math.floor(Number(values.weightedBarcodeWeightDecimals ?? 3))))
      : Math.min(3, Math.max(0, Math.floor(Number(current?.weightedBarcodeWeightDecimals ?? 3)))),
    weightedBarcodeValueMode: values.weightedBarcodeValueMode !== undefined
      ? (values.weightedBarcodeValueMode === 'price' ? 'price' : 'weight')
      : (current?.weightedBarcodeValueMode === 'price' ? 'price' : 'weight'),
    printShowLogo: values.printShowLogo !== undefined ? values.printShowLogo !== false : current?.printShowLogo !== false,
    printShowDocumentType: values.printShowDocumentType !== undefined ? values.printShowDocumentType !== false : current?.printShowDocumentType !== false,
    printShowDocumentNumber: values.printShowDocumentNumber !== undefined ? values.printShowDocumentNumber !== false : current?.printShowDocumentNumber !== false,
    printShowOrderType: values.printShowOrderType !== undefined ? values.printShowOrderType !== false : current?.printShowOrderType !== false,
    printShowPhone: values.printShowPhone !== undefined ? values.printShowPhone !== false : current?.printShowPhone !== false,
    printShowAddress: values.printShowAddress !== undefined ? values.printShowAddress !== false : current?.printShowAddress !== false,
    printShowTaxNumber: values.printShowTaxNumber !== undefined ? values.printShowTaxNumber === true : current?.printShowTaxNumber === true,
    printShowCustomer: values.printShowCustomer !== undefined ? values.printShowCustomer !== false : current?.printShowCustomer !== false,
    printShowDeliveryCustomerDetails: values.printShowDeliveryCustomerDetails !== undefined ? values.printShowDeliveryCustomerDetails !== false : current?.printShowDeliveryCustomerDetails !== false,
    printShowCashier: values.printShowCashier !== undefined ? values.printShowCashier !== false : current?.printShowCashier !== false,
    printShowBranch: values.printShowBranch !== undefined ? values.printShowBranch !== false : current?.printShowBranch !== false,
    printShowLocation: values.printShowLocation !== undefined ? values.printShowLocation !== false : current?.printShowLocation !== false,
    printShowTax: values.printShowTax !== undefined ? values.printShowTax !== false : current?.printShowTax !== false,
    printShowPaymentMethod: values.printShowPaymentMethod !== undefined ? values.printShowPaymentMethod !== false : current?.printShowPaymentMethod !== false,
    printShowItemSummary: values.printShowItemSummary !== undefined ? values.printShowItemSummary !== false : current?.printShowItemSummary !== false,
    printShowItemCount: values.printShowItemCount !== undefined ? values.printShowItemCount !== false : current?.printShowItemCount !== false,
    printShowPiecesCount: values.printShowPiecesCount !== undefined ? values.printShowPiecesCount !== false : current?.printShowPiecesCount !== false,
    printShowPaymentBreakdown: values.printShowPaymentBreakdown !== undefined ? values.printShowPaymentBreakdown !== false : current?.printShowPaymentBreakdown !== false,
    printShowDate: values.printShowDate !== undefined ? values.printShowDate !== false : current?.printShowDate !== false,
    printShowHijriDate: values.printShowHijriDate !== undefined ? Boolean(values.printShowHijriDate) : Boolean(current?.printShowHijriDate),
    printShowItemOffers: values.printShowItemOffers !== undefined ? values.printShowItemOffers !== false : current?.printShowItemOffers !== false,
    printShowDiscountBreakdown: values.printShowDiscountBreakdown !== undefined ? values.printShowDiscountBreakdown !== false : current?.printShowDiscountBreakdown !== false,
    printShowSavingsBanner: values.printShowSavingsBanner !== undefined ? values.printShowSavingsBanner !== false : current?.printShowSavingsBanner !== false,
    printShowInvoiceBarcode: values.printShowInvoiceBarcode !== undefined ? values.printShowInvoiceBarcode !== false : current?.printShowInvoiceBarcode !== false,
    printShowFooter: values.printShowFooter !== undefined ? values.printShowFooter !== false : current?.printShowFooter !== false,
    printCompactReceipt: values.printCompactReceipt !== undefined ? values.printCompactReceipt !== false : current?.printCompactReceipt !== false,
    posReceiptTheme: values.posReceiptTheme || current?.posReceiptTheme || 'classic',
    receiptItemLanguageMode: values.receiptItemLanguageMode || current?.receiptItemLanguageMode || 'ar_only',
    printNumberFormat: values.printNumberFormat !== undefined
      ? (values.printNumberFormat === 'english' ? 'english' : 'arabic')
      : (current?.printNumberFormat === 'english' ? 'english' : 'arabic'),
    printDualReceiptForOnlineDelivery: values.printDualReceiptForOnlineDelivery !== undefined
      ? Boolean(values.printDualReceiptForOnlineDelivery)
      : Boolean(current?.printDualReceiptForOnlineDelivery),
    uiLanguage: values.uiLanguage !== undefined
      ? (values.uiLanguage === 'en' ? 'en' : 'ar')
      : (current?.uiLanguage === 'en' ? 'en' : 'ar'),
    currency: values.currency !== undefined
      ? cleanText(values.currency, 'EGP').toUpperCase()
      : cleanText(current?.currency, 'EGP').toUpperCase(),
    timezone: values.timezone !== undefined
      ? cleanText(values.timezone, 'Africa/Cairo')
      : cleanText(current?.timezone, 'Africa/Cairo'),
    dateFormat: values.dateFormat !== undefined
      ? (values.dateFormat === 'yyyy-MM-dd' ? 'yyyy-MM-dd' : 'dd/MM/yyyy')
      : (current?.dateFormat === 'yyyy-MM-dd' ? 'yyyy-MM-dd' : 'dd/MM/yyyy'),
    timeFormat: values.timeFormat !== undefined
      ? (values.timeFormat === '24h' ? '24h' : '12h')
      : (current?.timeFormat === '24h' ? '24h' : '12h'),
    whatsappLinkMode: values.whatsappLinkMode !== undefined
      ? (values.whatsappLinkMode === 'web' ? 'web' : values.whatsappLinkMode === 'app' ? 'app' : 'wa_me')
      : (current?.whatsappLinkMode || 'wa_me'),
    invoiceNumberingScheme: values.invoiceNumberingScheme !== undefined
      ? (values.invoiceNumberingScheme === 'sequential' ? 'sequential' : 'daily')
      : (current?.invoiceNumberingScheme === 'sequential' ? 'sequential' : 'daily'),
    defaultBranchIssueMode: values.defaultBranchIssueMode !== undefined
      ? (values.defaultBranchIssueMode === 'transfer_to_branch_stock' ? 'transfer_to_branch_stock' : 'final_issue')
      : (current?.defaultBranchIssueMode || 'final_issue'),
    expiryAlertDays: values.expiryAlertDays !== undefined
      ? Math.max(1, Number(values.expiryAlertDays || 60))
      : Math.max(1, Number(current?.expiryAlertDays || 60)),
    stagnantProductDays: values.stagnantProductDays !== undefined
      ? Math.max(1, Number(values.stagnantProductDays || 60))
      : Math.max(1, Number(current?.stagnantProductDays || 60)),
    posTerminalEnabled: values.posTerminalEnabled !== undefined
      ? values.posTerminalEnabled === true
      : current?.posTerminalEnabled === true,
    posTerminalProvider: values.posTerminalProvider !== undefined
      ? values.posTerminalProvider
      : (current?.posTerminalProvider || 'mock_sandbox'),
    posTerminalName: values.posTerminalName !== undefined
      ? cleanText(values.posTerminalName, 'جهاز الكاشير الرئيسي (EDC)')
      : cleanText(current?.posTerminalName, 'جهاز الكاشير الرئيسي (EDC)'),
    posTerminalIp: values.posTerminalIp !== undefined
      ? cleanText(values.posTerminalIp, '192.168.1.150')
      : cleanText(current?.posTerminalIp, '192.168.1.150'),
    posTerminalPort: values.posTerminalPort !== undefined
      ? Number(values.posTerminalPort || 8080)
      : Number(current?.posTerminalPort || 8080),
    posTerminalProtocol: values.posTerminalProtocol !== undefined
      ? values.posTerminalProtocol
      : (current?.posTerminalProtocol || 'tcp_ip'),
    posTerminalAutoFinalize: values.posTerminalAutoFinalize !== undefined
      ? values.posTerminalAutoFinalize === true
      : current?.posTerminalAutoFinalize === true,
    posTerminals: Array.isArray(values.posTerminals)
      ? values.posTerminals
      : Array.isArray(current?.posTerminals)
      ? current.posTerminals
      : [],
    instapayAddress: values.instapayAddress !== undefined
      ? cleanText(values.instapayAddress, '01018017523')
      : cleanText(current?.instapayAddress, '01018017523'),
    walletNumber: values.walletNumber !== undefined
      ? cleanText(values.walletNumber, '01018017523')
      : cleanText(current?.walletNumber, '01018017523'),
    walletProviderName: values.walletProviderName !== undefined
      ? cleanText(values.walletProviderName, 'فودافون كاش')
      : cleanText(current?.walletProviderName, 'فودافون كاش'),
    paymentLinkBaseUrl: values.paymentLinkBaseUrl !== undefined
      ? cleanText(values.paymentLinkBaseUrl, '')
      : cleanText(current?.paymentLinkBaseUrl, ''),
    enableDynamicPaymentQr: values.enableDynamicPaymentQr !== undefined
      ? values.enableDynamicPaymentQr !== false
      : current?.enableDynamicPaymentQr !== false,
    printPaymentQrOnReceipt: values.printPaymentQrOnReceipt !== undefined
      ? values.printPaymentQrOnReceipt === true
      : current?.printPaymentQrOnReceipt === true,
    taxComplianceMode: values.taxComplianceMode || current?.taxComplianceMode || 'disabled',
    contractingRetentionPercent: values.contractingRetentionPercent !== undefined
      ? Number(values.contractingRetentionPercent ?? 5)
      : Number(current?.contractingRetentionPercent ?? 5),
    contractingAdvanceRecoveryMode: values.contractingAdvanceRecoveryMode || current?.contractingAdvanceRecoveryMode || 'proportional',
    contractingDefaultProfitMargin: values.contractingDefaultProfitMargin !== undefined
      ? Number(values.contractingDefaultProfitMargin ?? 15)
      : Number(current?.contractingDefaultProfitMargin ?? 15),
    contractingDefaultOverhead: values.contractingDefaultOverhead !== undefined
      ? Number(values.contractingDefaultOverhead ?? 7)
      : Number(current?.contractingDefaultOverhead ?? 7),
    contractingDefaultWaste: values.contractingDefaultWaste !== undefined
      ? Number(values.contractingDefaultWaste ?? 5)
      : Number(current?.contractingDefaultWaste ?? 5),
    contractingRequireBoqLinkForIssue: values.contractingRequireBoqLinkForIssue !== undefined
      ? values.contractingRequireBoqLinkForIssue === true
      : current?.contractingRequireBoqLinkForIssue === true,
    maritimeDemurrageFreeDays: values.maritimeDemurrageFreeDays !== undefined
      ? Number(values.maritimeDemurrageFreeDays ?? 14)
      : Number(current?.maritimeDemurrageFreeDays ?? 14),
    maritimeDefaultCurrency: values.maritimeDefaultCurrency || current?.maritimeDefaultCurrency || 'USD',
    importLandedCostMethod: values.importLandedCostMethod || current?.importLandedCostMethod || 'by_value',
    importAutoLinkBankExpenses: values.importAutoLinkBankExpenses || current?.importAutoLinkBankExpenses || 'auto_link',
    servicesBillingMethod: values.servicesBillingMethod || current?.servicesBillingMethod || 'deliverable',
    servicesContractRenewalNoticeDays: values.servicesContractRenewalNoticeDays !== undefined
      ? Number(values.servicesContractRenewalNoticeDays ?? 30)
      : Number(current?.servicesContractRenewalNoticeDays ?? 30),
  };

  const rawActivity = String(values.businessIndustry || values.activityType || (current as any)?.activityType || (current as any)?.pillar || current?.businessIndustry || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات';
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن';
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع';

  if (isContractingVertical) {
    settings.contractingModuleEnabled = true;
    settings.crmModuleEnabled = true;
    settings.purchasesModuleEnabled = true;
    settings.inventoryModuleEnabled = true;
    settings.hrModuleEnabled = true;
    settings.enableEnterpriseFeatures = true;
    settings.fixedAssetsModuleEnabled = true;
    settings.taxDeclarationModuleEnabled = true;
    settings.posModuleEnabled = false;
    settings.maritimeFreightModuleEnabled = false;
    settings.manufacturingModuleEnabled = false;
  } else if (isMaritimeVertical) {
    settings.maritimeFreightModuleEnabled = true;
    settings.crmModuleEnabled = true;
    settings.purchasesModuleEnabled = true;
    settings.hrModuleEnabled = true;
    settings.enableEnterpriseFeatures = true;
    settings.fixedAssetsModuleEnabled = true;
    settings.taxDeclarationModuleEnabled = true;
    settings.contractingModuleEnabled = false;
    settings.manufacturingModuleEnabled = false;
    settings.inventoryModuleEnabled = false;
    settings.posModuleEnabled = false;
  } else if (isManufacturingVertical) {
    settings.manufacturingModuleEnabled = true;
    settings.crmModuleEnabled = true;
    settings.purchasesModuleEnabled = true;
    settings.inventoryModuleEnabled = true;
    settings.hrModuleEnabled = true;
    settings.enableEnterpriseFeatures = true;
    settings.fixedAssetsModuleEnabled = true;
    settings.taxDeclarationModuleEnabled = true;
    settings.contractingModuleEnabled = false;
    settings.maritimeFreightModuleEnabled = false;
    settings.posModuleEnabled = false;
  } else {
    settings.contractingModuleEnabled = false;
    settings.maritimeFreightModuleEnabled = false;
  }

  return { settings };
}

export function buildBranchPayload(values: BranchFormOutput) {
  return {
    name: cleanText(values.name),
    code: cleanText(values.code),
    defaultStockLocationId: cleanText(values.defaultStockLocationId) || null,
    salesStockMode: values.salesStockMode || 'single_location',
    allowExternalSalesStock: values.allowExternalSalesStock === true
  };
}

export function buildLocationPayload(values: LocationFormOutput) {
  const branchId = cleanText(values.branchId);
  const payload: { name: string; code: string; locationType: string; branchId?: number } = {
    name: cleanText(values.name),
    code: cleanText(values.code),
    locationType: values.locationType || 'internal_warehouse',
  };
  if (branchId && branchId !== '0' && !Number.isNaN(Number(branchId))) {
    payload.branchId = Number(branchId);
  }
  return payload;
}
