import { type Transaction } from '../../../database/kysely';
import { Database } from '../../../database/database.types';

export interface AmazonConfig {
  enabled: boolean;
  sellerId: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Shared webhook secret (minimum 32 characters) for HMAC-SHA256
   *  verification of inbound marketplace webhooks
   *  (INV-MARKETPLACE-OUTBOX-RELAY). Never returned in clear. */
  webhookSecret?: string;
  marketplaceId: 'eg' | 'sa' | 'ae';
  autoSyncStock: boolean;
  autoPullOrders: boolean;
  fulfillmentType: 'fba' | 'fbm';
}

export interface NoonConfig {
  enabled: boolean;
  merchantId: string;
  apiKey?: string;
  appSecret?: string;
  /** Shared webhook secret, see AmazonConfig.webhookSecret. */
  webhookSecret?: string;
  marketplace: 'eg' | 'sa' | 'ae';
  autoSyncStock: boolean;
  autoPullOrders: boolean;
  fulfillmentType: 'fbn' | 'direct';
}

export interface JumiaConfig {
  enabled: boolean;
  sellerEmail: string;
  apiKey?: string;
  /** Shared webhook secret, see AmazonConfig.webhookSecret. */
  webhookSecret?: string;
  marketplace: 'eg' | 'ng' | 'ke';
  autoSyncStock: boolean;
  autoPullOrders: boolean;
  fulfillmentType: 'express' | 'dropshipping';
}

export interface TrendyolConfig {
  enabled: boolean;
  supplierId: string;
  apiKey?: string;
  apiSecret?: string;
  /** Shared webhook secret, see AmazonConfig.webhookSecret. */
  webhookSecret?: string;
  autoSyncStock: boolean;
  autoPullOrders: boolean;
  fulfillmentType: 'trendyol_cargo' | 'merchant_cargo';
}

export type SupportedMarketplace = 'amazon' | 'noon' | 'jumia' | 'trendyol';

export interface MarketplaceSkuMapping {
  id: string;
  productId: number;
  productName?: string;
  barcode?: string;
  costPrice?: number;
  retailPrice?: number;
  marketplace: SupportedMarketplace;
  marketplaceSku: string; // ASIN, Partner SKU, Seller SKU
  marketplaceTitle?: string;
  customPrice?: number;
  syncStock: boolean;
  currentLocalStock?: number;
  lastSyncedStock?: number;
  lastSyncedAt?: string;
  status: 'synced' | 'pending' | 'error';
  errorMessage?: string;
  // Competitor & Buy Box Tracking (روبوت تتبع صندوق الشراء والأسعار)
  competitorPrice?: number;
  buyBoxPrice?: number;
  buyBoxStatus?: 'winning' | 'at_risk' | 'losing';
  lastPriceCheckedAt?: string;
  // Automated Repricing Bot ("روبوت إعادة التسعير الآلي")
  repricingEnabled?: boolean;
  minPrice?: number;
  maxPrice?: number;
  repricingRule?: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
  repricingDelta?: number;
  lastRepricedAt?: string;
  repricingLog?: string;
}

export interface MarketplaceFeeCalculationInput {
  marketplace: SupportedMarketplace;
  region: 'eg' | 'sa' | 'ae';
  category: string;
  fulfillmentType: string;
  weightTier: 'small' | 'standard' | 'medium' | 'large' | 'heavy';
  sellingPrice: number;
  itemCost: number;
  inboundShippingCost?: number;
  packagingCost?: number;
}

export interface MarketplaceFeeCalculationResult {
  sellingPrice: number;
  itemCost: number;
  inboundShippingCost: number;
  packagingCost: number;
  referralRatePercent: number;
  referralFee: number;
  fulfillmentFee: number;
  closingFee: number;
  totalMarketplaceFeesBeforeVat: number;
  vatRatePercent: number;
  vatOnFees: number;
  totalMarketplaceDeductions: number;
  netPayoutToMerchant: number;
  netProfit: number;
  netMarginPercent: number;
  roiPercent: number;
  breakEvenPrice: number;
  currency: string;
  ratingStatus: 'exceptional' | 'healthy' | 'tight' | 'loss';
}

export interface ListingStudioResult {
  productId: number;
  productName: string;
  brand: string;
  barcode?: string;
  categoryName?: string;
  retailPrice: number;
  costPrice: number;
  optimizedTitleAr: string;
  optimizedTitleEn: string;
  bulletPointsAr: string[];
  bulletPointsEn: string[];
  backendKeywordsAr: string;
  backendKeywordsEn: string;
  metaDescription: string;
}

export interface BulkMappingImportRow {
  barcode?: string;
  sku?: string;
  productName?: string;
  marketplace: SupportedMarketplace;
  marketplaceSku: string;
  marketplaceTitle?: string;
  customPrice?: number;
  syncStock?: boolean;
  competitorPrice?: number;
}

export interface BulkMappingImportResult {
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: { row: number; reason: string }[];
}

export interface MarketplaceSettlementInput {
  marketplace: SupportedMarketplace;
  settlementId: string;
  periodStart: string;
  periodEnd: string;
  currency?: string;
  grossSales: number;
  referralFees: number;
  fulfillmentFees: number;
  refunds?: number;
  storageOrOtherFees?: number;
  netPayout: number;
  bankAccountId?: number;
  referralFeesAccountId?: number;
  fulfillmentFeesAccountId?: number;
  salesAccountId?: number;
  notes?: string;
}

export interface MarketplaceSettlementRecord extends MarketplaceSettlementInput {
  id: string;
  status: 'reconciled' | 'pending';
  journalEntryId?: number;
  journalEntryNo?: string;
  reconciledAt?: string;
  createdAt: string;
}

export interface SettlementAccountItem {
  id: number;
  code: string;
  name: string;
  accountType: string;
  isCashBank?: boolean;
}

export interface FbaInboundItem {
  productId: number;
  marketplaceSku: string;
  productName: string;
  barcode?: string;
  quantityShipped: number;
  quantityReceived?: number;
  discrepancy?: number;
  boxNumber?: number;
  unitsPerBox?: number;
  costPrice?: number;
}

export interface FbaInboundShipment {
  id: string;
  shipmentNumber: string;
  marketplace: 'amazon' | 'noon';
  fulfillmentCenterId: string;
  sourceBranchId?: number | null;
  sourceLocationId?: number | null;
  status: 'draft' | 'shipped' | 'received' | 'cancelled';
  items: FbaInboundItem[];
  totalUnits: number;
  totalReceivedUnits?: number;
  totalDiscrepancyUnits?: number;
  discrepancyLossAmount?: number;
  totalBoxes: number;
  trackingNumber?: string;
  notes?: string;
  createdAt: string;
  shippedAt?: string;
  receivedAt?: string;
}

export interface FbaDiscrepancyClaimReport {
  shipmentId: string;
  shipmentNumber: string;
  marketplace: 'amazon' | 'noon';
  fulfillmentCenterId: string;
  trackingNumber?: string;
  shippedDate: string;
  totalShippedUnits: number;
  totalReceivedUnits: number;
  missingUnits: number;
  estimatedReimbursementAmount: number;
  items: {
    productId: number;
    marketplaceSku: string;
    productName: string;
    barcode?: string;
    quantityShipped: number;
    quantityReceived: number;
    missingQuantity: number;
    unitCost: number;
    totalLoss: number;
  }[];
  generatedClaimTemplateAr: string;
  generatedClaimTemplateEn: string;
}

export interface MarketplaceAnalyticsSummary {
  period: string;
  totalGrossSales: number;
  totalNetPayout: number;
  totalFees: number;
  totalOrders: number;
  netMarginPercent: number;
  marketplaceBreakdown: {
    marketplace: SupportedMarketplace;
    grossSales: number;
    netPayout: number;
    fees: number;
    ordersCount: number;
    sharePercent: number;
    returnRatePercent: number;
  }[];
  topSellingProducts: {
    productId: number;
    productName: string;
    marketplace: SupportedMarketplace;
    sku: string;
    unitsSold: number;
    totalRevenue: number;
  }[];
}

export interface RepricingBotLog {
  sku: string;
  marketplace: SupportedMarketplace;
  productName: string;
  oldPrice: number;
  newPrice: number;
  competitorPrice?: number;
  buyBoxPrice?: number;
  rule: string;
  reason: string;
  timestamp: string;
}

export interface RepricingBotResult {
  totalEvaluated: number;
  totalRepriced: number;
  logs: RepricingBotLog[];
}

export interface MarketplaceOnboardingCheck {
  companyLegalName: string;
  tradeName: string;
  ownerName: string;
  ownerNationalId?: string;
  legalEntityType?: 'business' | 'individual';
  hasCreditCard?: boolean;
  commercialRegister: string;
  taxNumber: string;
  vatRegistered: boolean;
  bankName: string;
  bankAccountName: string;
  bankIban: string;
  bankSwift: string;
  businessAddress: string;
  phone: string;
  email: string;
  overallReadinessScore: number;
  nameMatchStatus: 'perfect_match' | 'name_mismatch' | 'missing_info';
  nameMatchDetails: string;
  checklist: {
    key: string;
    label: string;
    required: boolean;
    status: 'ready' | 'missing' | 'warning';
    notes: string;
  }[];
  platformGuides: {
    marketplace: SupportedMarketplace;
    nameAr: string;
    portalUrl: string;
    steps: { stepNumber: number; title: string; instruction: string; tip?: string }[];
  }[];
  letterOfAuthorizationAr: string;
  letterOfAuthorizationEn: string;
}

export interface GtinExemptionApplication {
  productId?: number;
  productName: string;
  brandName: string;
  category: string;
  marketplace: SupportedMarketplace;
  reason: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
  letterEn: string;
  letterAr: string;
  submissionInstructions: string[];
}

/** A stored marketplace webhook event as the relay hands it to a handler. */
export interface StoredMarketplaceWebhookEvent {
  id: number;
  tenantId: string;
  marketplace: SupportedMarketplace;
  eventType: string;
  eventKey: string;
  status: string;
  receivedAt: Date;
  payload: unknown;
}

/**
 * A relay handler for one marketplace event type. Runs inside the
 * relay's per-event transaction on its handle: any throw rolls the
 * event back to 'pending' (retryable) and is reported as `failed`,
 * never as processed. Return `handled: false` to leave the event
 * pending without failing it.
 */
export type MarketplaceWebhookHandler = (
  trx: Transaction<Database>,
  event: StoredMarketplaceWebhookEvent,
) => Promise<{ handled: boolean; actionTaken: string }>;

export type MarketplaceWebhookRelayOutcome =
  'processed' | 'rejected' | 'skipped-no-handler' | 'unverifiable' | 'failed' | 'skipped';

export interface MarketplaceWebhookRelayResult {
  claimed: number;
  processed: number;
  rejected: number;
  skippedNoHandler: number;
  unverifiable: number;
  failed: number;
  results: Array<{
    eventId: number;
    outcome: MarketplaceWebhookRelayOutcome;
    actionTaken?: string;
    error?: string;
  }>;
}

/** Signature material captured at receipt (INV-MARKETPLACE-OUTBOX-RELAY). */
export interface MarketplaceWebhookReceiptOpts {
  /** Value of the `x-zs-webhook-signature` header as received, if any. */
  signature?: string;
  /** Exact request bytes, when the transport captured them. */
  rawBody?: Buffer | string;
}
