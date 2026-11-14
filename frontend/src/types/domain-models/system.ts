export interface TreasuryTransaction {
  id: string;
  txnType: string;
  type?: string;
  amount: number;
  note: string;
  referenceType?: string;
  referenceId?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  createdAt: string;
  date?: string;
  createdByName?: string;
}

export interface ServiceRecord {
  id: string;
  name: string;
  amount: number;
  notes: string;
  serviceDate: string;
  paymentChannel?: 'cash' | 'card' | string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  createdByName?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  details: string;
  detailsSummary?: string;
  createdAt: string;
  created_at?: string;
  createdByName?: string;
  createdBy?: string;
}

export interface ShiftMovementItem {
  id: string;
  kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
  kindLabel: string;
  amount: number;
  note: string;
  createdAt: string;
}

export interface BlindCloseChannelReconciliation {
  declared: number;
  computed: number;
  delta: number;
  declaredCount: number;
  computedCount: number;
  countDelta: number;
  detailTotal?: number;
  detailDelta?: number;
}

export interface BlindCloseReconciliation {
  card: BlindCloseChannelReconciliation;
  wallet: BlindCloseChannelReconciliation;
  instapay: BlindCloseChannelReconciliation;
}

export interface ShiftCustomerCollectionsByChannel {
  cash: number;
  card: number;
  wallet: number;
  instapay: number;
  cashCount: number;
  cardCount: number;
  walletCount: number;
  instapayCount: number;
}

export interface CashierShift {
  id: string;
  docNo: string;
  status: string;
  openingCash: number;
  /** INV-REST-SHIFT-CLOSE-CONTROL (I24): the POS station code of this shift. */
  terminalCode?: string | null;
  /** INV-REST-SHIFT-CLOSE-CONTROL (I25): expected-cash components the close card and Z-report render. */
  customerCollectionsTotal?: number;
  /** INV-SHIFT-EXPECTED-PER-METHOD-COLLECTIONS: per-channel customer collections feeding the electronic expected totals. */
  customerCollectionsByChannel?: ShiftCustomerCollectionsByChannel | null;
  cancelledSaleCashTotal?: number;
  /** INV-REST-SHIFT-CLOSE-CONTROL (I22): the server's declared-vs-computed reconciliation, when reviewed. */
  reconciliation?: BlindCloseReconciliation | null;
  expectedCash: number;
  countedCash: number;
  cashSalesTotal?: number;
  cardSalesTotal?: number;
  walletSalesTotal?: number;
  instapaySalesTotal?: number;
  creditSalesTotal?: number;
  deliverySalesTotal?: number;
  deliveryFeeTotal?: number;
  freelanceDeliveryFeeTotal?: number;
  storeDeliveryFeeTotal?: number;
  netStoreSalesTotal?: number;
  shiftSalesTotal?: number;
  tipSalesTotal?: number;
  saleCount?: number;
  mixedSalesCount?: number;
  cardOperationCount?: number;
  walletOperationCount?: number;
  instapayOperationCount?: number;
  cashDrawerMovementTotal?: number;
  cashDrawerCashInTotal?: number;
  cashDrawerDeliveryCashInTotal?: number;
  cashDrawerManualCashInTotal?: number;
  cashDrawerCashOutTotal?: number;
  supplierPaymentsTotal?: number;
  expensesTotal?: number;
  serviceCashTotal?: number;
  serviceCardTotal?: number;
  serviceTotal?: number;
  saleReturnCashRefundTotal?: number;
  saleReturnCardRefundTotal?: number;
  saleReturnTotal?: number;
  variance: number;
  openingNote?: string;
  closeNote?: string;
  closeNoteRaw?: string;
  blindCloseMode?: boolean;
  blindCloseMetadataStatus?: 'valid' | 'missing' | 'invalid' | string;
  declaredCash?: number | null;
  declaredCardTotal?: number | null;
  declaredCardCount?: number | null;
  declaredWalletTotal?: number | null;
  declaredWalletCount?: number | null;
  declaredInstapayTotal?: number | null;
  declaredInstapayCount?: number | null;
  cardDetailsTotal?: number;
  walletDetailsTotal?: number;
  instapayDetailsTotal?: number;
  cardDetails?: Array<{ amount: number; reference?: string }>;
  walletDetails?: Array<{ amount: number; reference?: string }>;
  instapayDetails?: Array<{ amount: number; reference?: string }>;
  movementItems?: ShiftMovementItem[];
  managerReviewNote?: string;
  managerReviewedById?: number | null;
  managerReviewedByName?: string;
  managerReviewedAt?: string;
  note?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  openedById?: string;
  createdAt: string;
  closedAt?: string;
  openedByName?: string;
  closedByName?: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  defaultStockLocationId?: string | null;
  salesStockMode?: 'single_location' | 'all_operational_locations';
  allowExternalSalesStock?: boolean;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  branchId?: string;
  branchName?: string;
  locationType?: string;
}

export interface AppSettings {
  printPaymentQrOnReceipt?: boolean;
  instapayAddress?: string;
  walletNumber?: string;
  walletProviderName?: string;
  paymentLinkBaseUrl?: string;
  storeName: string;
  brandName?: string;
  phone?: string;
  address?: string;
  lowStockThreshold?: number;
  expiryAlertDays?: number;
  stagnantProductDays?: number;
  invoiceFooter?: string;
  invoiceQR?: string;
  taxNumber?: string;
  taxRate?: number;
  taxMode?: string;
  paperSize?: 'a4' | 'receipt' | string;
  receiptWidthMm?: 58 | 80;
  invoiceNumberingScheme?: 'daily' | 'sequential' | string;
  managerPin?: string;
  hasManagerPin?: boolean;
  autoBackup?: 'on' | 'off' | string;
  accentColor?: string;
  logoData?: string;
  businessIndustry?: string;
  activityType?: string;
  pillar?: string;
  currentBranchId?: string;
  currentLocationId?: string;
  printShowLogo?: boolean;
  printShowDocumentType?: boolean;
  printShowPhone?: boolean;
  printShowAddress?: boolean;
  printShowTaxNumber?: boolean;
  printDeliveryRepOnReceipt?: boolean;
  vanSettlementRequireSupervisorPin?: boolean;
  vanSettlementBlindMode?: boolean;
  printShowCustomer?: boolean;
  printShowDocumentNumber?: boolean;
  printShowOrderType?: boolean;
  printShowDeliveryCustomerDetails?: boolean;
  printShowCashier?: boolean;
  printShowBranch?: boolean;
  printShowLocation?: boolean;
  printShowTax?: boolean;
  printShowPaymentMethod?: boolean;
  printShowItemSummary?: boolean;
  printShowItemCount?: boolean;
  printShowPiecesCount?: boolean;
  printShowPaymentBreakdown?: boolean;
  printShowDate?: boolean;
  printShowHijriDate?: boolean;
  printShowItemOffers?: boolean;
  printShowDiscountBreakdown?: boolean;
  printShowSavingsBanner?: boolean;
  printShowInvoiceBarcode?: boolean;
  printShowFooter?: boolean;
  printCompactReceipt?: boolean;
  posReceiptTheme?: 'boxed' | 'classic' | 'ultra-compact' | string;
  printNumberFormat?: 'arabic' | 'english' | string;
  printDualReceiptForOnlineDelivery?: boolean;
  posModuleEnabled?: boolean;
  purchasesModuleEnabled?: boolean;
  inventoryModuleEnabled?: boolean;
  hrModuleEnabled?: boolean;
  crmModuleEnabled?: boolean;
  onboardingCompleted?: boolean;
  manufacturingModuleEnabled?: boolean;
  importModuleEnabled?: boolean;
  autoPartsModuleEnabled?: boolean;
  maritimeFreightModuleEnabled?: boolean;
  contractingModuleEnabled?: boolean;
  comboModuleEnabled?: boolean;
  restaurantModuleEnabled?: boolean;
  restaurantTablesCount?: number;
  enableGuestPagers?: boolean;
  phoneOrdersModuleEnabled?: boolean;
  posShowCartMeta?: boolean;
  posProductCardLayout?: 'comfortable' | 'compact' | 'gallery';
  posShowSearchBar?: boolean;
  posShowPriceTierToggle?: boolean;
  posDefaultPriceType?: 'retail' | 'wholesale';
  posShowCategories?: boolean;
  posShowQuickFilters?: boolean;
  posMobileGridColumns?: '2' | '3' | 'auto';
  posAutoHideBottomNav?: boolean;
  clothingModuleEnabled?: boolean;
  enableMobileStoreFeatures?: boolean;
  posMaxDiscountThresholdEnabled?: boolean;
  posMaxDiscountThresholdType?: 'percentage' | 'fixed' | string;
  posMaxDiscountThresholdValue?: number;
  enablePharmacyModule?: boolean;
  servicesModuleEnabled?: boolean;
  storefrontModuleEnabled?: boolean;
  installmentsModuleEnabled?: boolean;
  fixedAssetsModuleEnabled?: boolean;
  taxDeclarationModuleEnabled?: boolean;
  deliveryFleetModuleEnabled?: boolean;
  deliveryRepsModuleEnabled?: boolean;
  vanSalesModuleEnabled?: boolean;
  maintenanceProfile?: string;
  enableEnterpriseFeatures?: boolean;
  technicianCommissionRate?: number;
  defaultProductKind?: 'standard' | 'fashion' | string;
  defaultPosMode?: 'scanner' | 'touch' | string;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet' | string;
  storeFleetCommissionRate?: number;
  defaultDeliveryFee?: number;
  allowNegativeStockSales?: boolean;
  allowSellingBelowStock?: boolean;
  posHideOutOfStockItems?: boolean;
  allowZeroPurchaseCost?: boolean;
  requireCashierShiftForSales?: boolean;
  requirePasswordOnShiftOpen?: boolean;
  posKitchenPrinterEnabled?: boolean;
  posCashDrawerPrinterEnabled?: boolean;
  posKitchenPrinterAuto?: boolean;
  posAutoPrintKitchenReceipt?: boolean;
  posKitchenPrinterMode?: 'detailed' | 'mini';
  posKitchenLanguage?: 'dual' | 'en' | 'ar' | string;
  printBilingualItemNames?: boolean;
  posElectronCashierPrinter?: string;
  posElectronKitchenPrinter?: string;
  posWindowsPrinterName?: string;
  posNetworkThermalPrinterIp?: string;
  posNetworkThermalPrinterPort?: number;
  weightedBarcodeEnabled?: boolean;
  weightedBarcodePrefix?: string;
  weightedBarcodeProductCodeLength?: number;
  weightedBarcodeWeightDigits?: number;
  weightedBarcodeWeightDecimals?: number;
  weightedBarcodeValueMode?: 'weight' | 'price';
  theme?: string;
  uiLanguage?: 'ar' | 'en' | string;
  country?: string;
  currency?: string;
  timezone?: string;
  dateFormat?: string;
  timeFormat?: '12h' | '24h' | string;
  whatsappLinkMode?: 'web' | 'app' | 'wa_me' | string;
  defaultBranchIssueMode?: 'final_issue' | 'transfer_to_branch_stock';
  hrSalesCommissionType?: 'none' | 'percentage' | 'target_bonus' | string;
  hrSalesCommissionValue?: number;
  hrSalesCommissionTarget?: number;
  hrDelayPolicyEnabled?: boolean;
  hrDelayPenalty1st?: number;
  hrDelayPenalty2nd?: number;
  hrDelayPenalty3rd?: number;
  hrDelayPenalty4th?: number;
  loyaltyEnabled?: boolean;
  loyaltyPointsPer100Egp?: number;
  loyaltyPointRedeemValue?: number;
  loyaltyMinRedeemPoints?: number;
  loyaltyMaxDiscountPercentage?: number;
  printShowLoyaltyPoints?: boolean;
  posTerminalEnabled?: boolean;
  posTerminalProvider?: 'geidea' | 'paymob' | 'fawry' | 'network_international' | 'knet_pos' | 'mock_sandbox' | string;
  posTerminalProtocol?: 'tcp_ip' | 'http_rest';
  posTerminalAutoFinalize?: boolean;
  posTerminalName?: string;
  posTerminalIp?: string;
  posTerminalPort?: number;
  posTerminals?: import('./settings').PosTerminalDeviceConfig[];
}

export interface ExpenseRecord {
  id: string;
  title: string;
  amount: number;
  date: string;
  note?: string;
  createdBy?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  cancelledAt?: string | null;
  cancelledBy?: string;
  cancelReason?: string;
}
