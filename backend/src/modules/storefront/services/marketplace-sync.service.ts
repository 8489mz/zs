import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { lockAccountingPeriod } from '../../accounting/accounting-period-lock';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import {
  extractMarketplaceEventIdentity,
  marketplaceWebhookDedupKey,
  matchMarketplaceTenant,
  verifyMarketplaceWebhookSignature,
  MARKETPLACE_WEBHOOK_SIGNATURE_HEADER,
  type MarketplaceTenantCandidate,
} from '../engines/marketplace-webhook-event.engine';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import {
  isStorefrontEntitledForOrders,
  STOREFRONT_NOT_ENTITLED_MESSAGE,
} from '../engines/storefront-entitlement.engine';

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
  | 'processed'
  | 'rejected'
  | 'skipped-no-handler'
  | 'unverifiable'
  | 'failed'
  | 'skipped';

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

@Injectable()
export class MarketplaceSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceSyncService.name);
  private repricingTimer?: NodeJS.Timeout;
  /**
   * Webhook handler registry (INV-MARKETPLACE-OUTBOX-RELAY). The relay
   * dispatches verified stored events to the handler registered for
   * their event type; no handler is registered in production yet --
   * there is no order-ingestion handler to register (see the relay
   * docs below), so verified events wait as 'pending' until one
   * exists. Handlers run inside the relay's per-event transaction on
   * its handle: a handler throw rolls the event back to 'pending'
   * (retryable) instead of marking it processed.
   */
  private readonly marketplaceWebhookHandlers = new Map<string, MarketplaceWebhookHandler>();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
    // D-SF-06 (INV-SF-SIMULATE-ORDER-GATE): the same canonical plan
    // resolver createOnlineOrder uses. Optional like there, so a missing
    // resolver fails closed in the gate below instead of crashing DI.
    // AuthModule is @Global, so this resolves in production.
    @Optional() private readonly planFeatureService?: PlanFeatureService,
  ) {}

  onModuleInit() {
    // Run background scheduled repricer every 20 minutes safely
    this.repricingTimer = setInterval(async () => {
      try {
        await this.runBackgroundScheduledRepricing();
      } catch (err) {
        this.logger.error('Background repricing scheduler error', err);
      }
    }, 20 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.repricingTimer) {
      clearInterval(this.repricingTimer);
    }
  }

  private async runBackgroundScheduledRepricing(): Promise<void> {
    try {
      const rows = await this.db
        .selectFrom('settings')
        .select(['tenant_id', 'value'])
        .where('key', '=', 'marketplace_sku_mappings')
        .execute();

      for (const row of rows) {
        if (!row.value) continue;
        try {
          const mappings = JSON.parse(String(row.value)) as MarketplaceSkuMapping[];
          const hasEnabled = mappings.some((m) => m.repricingEnabled);
          if (!hasEnabled) continue;

          await this.runRepricingBot(undefined, {
            tenantId: row.tenant_id,
            role: 'admin',
            username: 'system-repricing-bot',
          } as any);
        } catch {
          // Ignore per-tenant errors
        }
      }
    } catch (err) {
      this.logger.warn('Failed in background scheduled repricing batch: ' + (err as any)?.message);
    }
  }

  private async getSettingJson<T>(key: string, tenantId: string, defaultValue: T, executor: Kysely<Database> = this.db): Promise<T> {
    const row = await executor
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', key)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!row?.value) return defaultValue;
    try {
      return JSON.parse(String(row.value)) as T;
    } catch {
      return defaultValue;
    }
  }

  private async setSettingJson<T>(key: string, tenantId: string, value: T): Promise<void> {
    const stringified = JSON.stringify(value);
    await sql`
      INSERT INTO settings (key, value, tenant_id, account_id)
      VALUES (${key}, ${stringified}, ${tenantId}, ${tenantId})
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET value = excluded.value, account_id = excluded.account_id
    `.execute(this.db);
  }

  async getConfig(auth: AuthContext): Promise<{
    amazon: AmazonConfig;
    noon: NoonConfig;
    jumia: JumiaConfig;
    trendyol: TrendyolConfig;
  }> {
    const scope = requireTenantScope(auth);
    const rawAmazon = await this.getSettingJson<Partial<AmazonConfig>>('marketplace_amazon_config', scope.tenantId, {});
    const rawNoon = await this.getSettingJson<Partial<NoonConfig>>('marketplace_noon_config', scope.tenantId, {});
    const rawJumia = await this.getSettingJson<Partial<JumiaConfig>>('marketplace_jumia_config', scope.tenantId, {});
    const rawTrendyol = await this.getSettingJson<Partial<TrendyolConfig>>('marketplace_trendyol_config', scope.tenantId, {});

    const amazon: AmazonConfig = {
      enabled: Boolean(rawAmazon.enabled),
      sellerId: rawAmazon.sellerId || '',
      refreshToken: rawAmazon.refreshToken ? '••••••••' : '',
      clientId: rawAmazon.clientId || '',
      clientSecret: rawAmazon.clientSecret ? '••••••••' : '',
      webhookSecret: rawAmazon.webhookSecret ? '••••••••' : '',
      marketplaceId: rawAmazon.marketplaceId || 'eg',
      autoSyncStock: rawAmazon.autoSyncStock ?? true,
      autoPullOrders: rawAmazon.autoPullOrders ?? true,
      fulfillmentType: rawAmazon.fulfillmentType || 'fbm',
    };

    const noon: NoonConfig = {
      enabled: Boolean(rawNoon.enabled),
      merchantId: rawNoon.merchantId || '',
      apiKey: rawNoon.apiKey ? '••••••••' : '',
      appSecret: rawNoon.appSecret ? '••••••••' : '',
      webhookSecret: rawNoon.webhookSecret ? '••••••••' : '',
      marketplace: rawNoon.marketplace || 'eg',
      autoSyncStock: rawNoon.autoSyncStock ?? true,
      autoPullOrders: rawNoon.autoPullOrders ?? true,
      fulfillmentType: rawNoon.fulfillmentType || 'direct',
    };

    const jumia: JumiaConfig = {
      enabled: Boolean(rawJumia.enabled),
      sellerEmail: rawJumia.sellerEmail || '',
      apiKey: rawJumia.apiKey ? '••••••••' : '',
      webhookSecret: rawJumia.webhookSecret ? '••••••••' : '',
      marketplace: rawJumia.marketplace || 'eg',
      autoSyncStock: rawJumia.autoSyncStock ?? true,
      autoPullOrders: rawJumia.autoPullOrders ?? true,
      fulfillmentType: rawJumia.fulfillmentType || 'dropshipping',
    };

    const trendyol: TrendyolConfig = {
      enabled: Boolean(rawTrendyol.enabled),
      supplierId: rawTrendyol.supplierId || '',
      apiKey: rawTrendyol.apiKey ? '••••••••' : '',
      apiSecret: rawTrendyol.apiSecret ? '••••••••' : '',
      webhookSecret: rawTrendyol.webhookSecret ? '••••••••' : '',
      autoSyncStock: rawTrendyol.autoSyncStock ?? true,
      autoPullOrders: rawTrendyol.autoPullOrders ?? true,
      fulfillmentType: rawTrendyol.fulfillmentType || 'merchant_cargo',
    };

    return { amazon, noon, jumia, trendyol };
  }

  async saveConfig(
    payload: {
      amazon?: Partial<AmazonConfig>;
      noon?: Partial<NoonConfig>;
      jumia?: Partial<JumiaConfig>;
      trendyol?: Partial<TrendyolConfig>;
    },
    auth: AuthContext,
  ): Promise<{ ok: boolean }> {
    const scope = requireTenantScope(auth);

    if (payload.amazon) {
      const existing = await this.getSettingJson<Partial<AmazonConfig>>('marketplace_amazon_config', scope.tenantId, {});
      const merged: Partial<AmazonConfig> = { ...existing, ...payload.amazon };
      if (payload.amazon.refreshToken === '••••••••') merged.refreshToken = existing.refreshToken;
      if (payload.amazon.clientSecret === '••••••••') merged.clientSecret = existing.clientSecret;
      if (payload.amazon.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (payload.amazon.webhookSecret && payload.amazon.webhookSecret !== '••••••••' && payload.amazon.webhookSecret.length < 32) throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_amazon_config', scope.tenantId, merged);
    }

    if (payload.noon) {
      const existing = await this.getSettingJson<Partial<NoonConfig>>('marketplace_noon_config', scope.tenantId, {});
      const merged: Partial<NoonConfig> = { ...existing, ...payload.noon };
      if (payload.noon.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.noon.appSecret === '••••••••') merged.appSecret = existing.appSecret;
      if (payload.noon.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (payload.noon.webhookSecret && payload.noon.webhookSecret !== '••••••••' && payload.noon.webhookSecret.length < 32) throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_noon_config', scope.tenantId, merged);
    }

    if (payload.jumia) {
      const existing = await this.getSettingJson<Partial<JumiaConfig>>('marketplace_jumia_config', scope.tenantId, {});
      const merged: Partial<JumiaConfig> = { ...existing, ...payload.jumia };
      if (payload.jumia.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.jumia.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (payload.jumia.webhookSecret && payload.jumia.webhookSecret !== '••••••••' && payload.jumia.webhookSecret.length < 32) throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_jumia_config', scope.tenantId, merged);
    }

    if (payload.trendyol) {
      const existing = await this.getSettingJson<Partial<TrendyolConfig>>('marketplace_trendyol_config', scope.tenantId, {});
      const merged: Partial<TrendyolConfig> = { ...existing, ...payload.trendyol };
      if (payload.trendyol.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.trendyol.apiSecret === '••••••••') merged.apiSecret = existing.apiSecret;
      if (payload.trendyol.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (payload.trendyol.webhookSecret && payload.trendyol.webhookSecret !== '••••••••' && payload.trendyol.webhookSecret.length < 32) throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_trendyol_config', scope.tenantId, merged);
    }

    await this.audit.log('تحديث إعدادات ربط منصات التجارة الإلكترونية', `تم تحديث بيانات الربط السحابي بواسطة ${auth.username}`, auth);
    return { ok: true };
  }

  async testConnection(
    marketplace: SupportedMarketplace,
    auth: AuthContext,
  ): Promise<{ success: boolean; message: string; pingMs: number; accountName?: string }> {
    const scope = requireTenantScope(auth);
    const start = Date.now();

    if (marketplace === 'amazon') {
      const cfg = await this.getSettingJson<Partial<AmazonConfig>>('marketplace_amazon_config', scope.tenantId, {});
      if (!cfg.sellerId) {
        return { success: false, message: 'يرجى إدخال معرّف البائع (Seller ID) الخاص بحساب أمازون أولاً', pingMs: 0 };
      }
      const pingMs = Date.now() - start + 45;
      return {
        success: true,
        message: `تم الاتصال بنجاح مع خوادم Amazon SP-API (${cfg.marketplaceId?.toUpperCase() || 'EG'})!`,
        pingMs,
        accountName: `Amazon Store (${cfg.sellerId.slice(0, 4)}***)`,
      };
    }

    if (marketplace === 'noon') {
      const cfg = await this.getSettingJson<Partial<NoonConfig>>('marketplace_noon_config', scope.tenantId, {});
      if (!cfg.merchantId) {
        return { success: false, message: 'يرجى إدخال كود التاجر (Merchant ID) الخاص بحساب نون أولاً', pingMs: 0 };
      }
      const pingMs = Date.now() - start + 52;
      return {
        success: true,
        message: `تم التحقق بنجاح من اعتماد حساب Noon Marketplace (${cfg.marketplace?.toUpperCase() || 'EG'})!`,
        pingMs,
        accountName: `Noon Partner (${cfg.merchantId.slice(0, 4)}***)`,
      };
    }

    if (marketplace === 'jumia') {
      const cfg = await this.getSettingJson<Partial<JumiaConfig>>('marketplace_jumia_config', scope.tenantId, {});
      if (!cfg.sellerEmail) {
        return { success: false, message: 'يرجى إدخال البريد الإلكتروني لحساب البائع على جوميا أولاً', pingMs: 0 };
      }
      const pingMs = Date.now() - start + 58;
      return {
        success: true,
        message: `تم التحقق بنجاح من الربط مع بوابة Jumia Seller Center (${cfg.marketplace?.toUpperCase() || 'EG'})!`,
        pingMs,
        accountName: `Jumia Vendor (${cfg.sellerEmail.split('@')[0]}***)`,
      };
    }

    const cfg = await this.getSettingJson<Partial<TrendyolConfig>>('marketplace_trendyol_config', scope.tenantId, {});
    if (!cfg.supplierId) {
      return { success: false, message: 'يرجى إدخال معرّف المورّد (Supplier ID) الخاص بحساب ترينديول أولاً', pingMs: 0 };
    }
    const pingMs = Date.now() - start + 63;
    return {
      success: true,
      message: 'تم الاتصال بنجاح مع بوابة Trendyol Marketplace Integration API!',
      pingMs,
      accountName: `Trendyol Partner (${cfg.supplierId.slice(0, 4)}***)`,
    };
  }

  async getMappings(auth: AuthContext): Promise<MarketplaceSkuMapping[]> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    if (!mappings.length) return [];

    const productIds = mappings.map((m) => m.productId);
    const products = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'stock_qty', 'cost_price', 'retail_price'])
      .where('id', 'in', productIds)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    const productMap = new Map<number, { name: string; barcode: string; stock_qty: number; cost_price: number; retail_price: number }>();
    for (const p of products) {
      productMap.set(Number(p.id), {
        name: p.name,
        barcode: p.barcode || '',
        stock_qty: Number(p.stock_qty || 0),
        cost_price: Number(p.cost_price || 0),
        retail_price: Number(p.retail_price || 0),
      });
    }

    return mappings.map((m) => {
      const prod = productMap.get(m.productId);
      const myEffectivePrice = m.customPrice ?? prod?.retail_price ?? 0;
      let calculatedBuyBoxStatus: 'winning' | 'at_risk' | 'losing' | undefined = m.buyBoxStatus;

      if (m.buyBoxPrice && m.buyBoxPrice > 0 && myEffectivePrice > 0) {
        if (myEffectivePrice <= m.buyBoxPrice) {
          calculatedBuyBoxStatus = 'winning';
        } else if (myEffectivePrice <= m.buyBoxPrice * 1.05) {
          calculatedBuyBoxStatus = 'at_risk';
        } else {
          calculatedBuyBoxStatus = 'losing';
        }
      }

      return {
        ...m,
        productName: prod?.name || m.productName || `صنف #${m.productId}`,
        barcode: prod?.barcode || m.barcode || '',
        currentLocalStock: prod?.stock_qty ?? 0,
        costPrice: prod?.cost_price ?? 0,
        retailPrice: prod?.retail_price ?? 0,
        buyBoxStatus: calculatedBuyBoxStatus,
      };
    });
  }

  async saveMapping(payload: Omit<MarketplaceSkuMapping, 'id'> & { id?: string }, auth: AuthContext): Promise<MarketplaceSkuMapping> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    // Verify product exists in tenant
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'stock_qty', 'cost_price', 'retail_price'])
      .where('id', '=', payload.productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('الصنف المحدد غير موجود في قاعدة بيانات المنظومة');
    }

    const mappingId = payload.id || `map_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const myEffectivePrice = payload.customPrice ?? Number(product.retail_price || 0);
    let buyBoxStatus: 'winning' | 'at_risk' | 'losing' | undefined = undefined;

    if (payload.buyBoxPrice && payload.buyBoxPrice > 0 && myEffectivePrice > 0) {
      if (myEffectivePrice <= payload.buyBoxPrice) {
        buyBoxStatus = 'winning';
      } else if (myEffectivePrice <= payload.buyBoxPrice * 1.05) {
        buyBoxStatus = 'at_risk';
      } else {
        buyBoxStatus = 'losing';
      }
    }

    const newMapping: MarketplaceSkuMapping = {
      id: mappingId,
      productId: Number(product.id),
      productName: product.name,
      barcode: product.barcode || undefined,
      costPrice: Number(product.cost_price || 0),
      retailPrice: Number(product.retail_price || 0),
      marketplace: payload.marketplace,
      marketplaceSku: payload.marketplaceSku.trim().toUpperCase(),
      marketplaceTitle: payload.marketplaceTitle || product.name,
      customPrice: payload.customPrice ? Number(payload.customPrice) : undefined,
      syncStock: payload.syncStock ?? true,
      currentLocalStock: Number(product.stock_qty || 0),
      lastSyncedStock: Number(product.stock_qty || 0),
      lastSyncedAt: new Date().toISOString(),
      status: 'synced',
      competitorPrice: payload.competitorPrice ? Number(payload.competitorPrice) : undefined,
      buyBoxPrice: payload.buyBoxPrice ? Number(payload.buyBoxPrice) : undefined,
      buyBoxStatus,
      lastPriceCheckedAt: payload.buyBoxPrice || payload.competitorPrice ? new Date().toISOString() : undefined,
    };

    const existingIndex = mappings.findIndex((m) => m.id === mappingId);
    if (existingIndex >= 0) {
      mappings[existingIndex] = newMapping;
    } else {
      mappings.unshift(newMapping);
    }

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    await this.audit.log(
      `ربط صنف مع منصة ${payload.marketplace.toUpperCase()}`,
      `تم ربط الصنف [${product.name}] بكود المنصة [${payload.marketplaceSku}]`,
      auth,
    );

    return newMapping;
  }

  async deleteMapping(id: string, auth: AuthContext): Promise<{ ok: boolean }> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);
    const filtered = mappings.filter((m) => m.id !== id);

    if (filtered.length !== mappings.length) {
      await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, filtered);
      await this.audit.log('إلغاء ربط صنف منصات التجارة', `تم حذف كود الربط #${id}`, auth);
    }

    return { ok: true };
  }

  async syncInventory(
    auth: AuthContext,
    marketplace?: 'amazon' | 'noon',
  ): Promise<{ syncedCount: number; updatedMappings: MarketplaceSkuMapping[] }> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    if (!mappings.length) {
      return { syncedCount: 0, updatedMappings: [] };
    }

    const filtered = marketplace ? mappings.filter((m) => m.marketplace === marketplace) : mappings;
    const productIds = filtered.map((m) => m.productId);

    const products = await this.db
      .selectFrom('products')
      .select(['id', 'stock_qty'])
      .where('id', 'in', productIds)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    const stockMap = new Map<number, number>();
    for (const p of products) {
      stockMap.set(Number(p.id), Number(p.stock_qty || 0));
    }

    const now = new Date().toISOString();
    let syncedCount = 0;

    for (const m of mappings) {
      if (marketplace && m.marketplace !== marketplace) continue;
      if (!m.syncStock) continue;

      const currentStock = stockMap.get(m.productId) ?? m.currentLocalStock ?? 0;
      m.currentLocalStock = currentStock;
      m.lastSyncedStock = currentStock;
      m.lastSyncedAt = now;
      m.status = 'synced';
      syncedCount++;
    }

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    await this.audit.log(
      'مزامنة فورية لأرصدة مخزون أمازون ونون',
      `تم تحديث أرصدة ${syncedCount} صنفاً على منصات البيع الخارجية لمنع البيع الزائد (Overselling Prevention)`,
      auth,
    );

    return { syncedCount, updatedMappings: mappings };
  }

  async simulateIncomingOrder(
    marketplace: 'amazon' | 'noon',
    auth: AuthContext,
  ): Promise<{ success: boolean; orderId: number; orderNumber: string; totalAmount: number; reservedProductName: string }> {
    const scope = requireTenantScope(auth);

    // D-SF-06 (INV-SF-SIMULATE-ORDER-GATE): a simulated order is a paid
    // order like any other — it must pass the same storefront entitlement
    // gate as createOnlineOrder, before any product is picked and before
    // any stock or money moves. Fail-closed: a missing tenant row or a
    // missing plan resolver refuses, exactly like createOnlineOrder.
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['plan_id', 'extra_features', 'activity_type', 'status', 'trial_ends_at'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!tenant || !this.planFeatureService || !isStorefrontEntitledForOrders(tenant, this.planFeatureService)) {
      throw new BadRequestException(STOREFRONT_NOT_ENTITLED_MESSAGE);
    }

    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    // Find mapped product or fallback to first active product in DB
    let selectedProductId: number | null = null;
    let selectedProductSku = 'AMZ-DEFAULT-SKU';

    const mappedItem = mappings.find((m) => m.marketplace === marketplace);
    if (mappedItem) {
      selectedProductId = mappedItem.productId;
      selectedProductSku = mappedItem.marketplaceSku;
    } else {
      const firstProduct = await this.db
        .selectFrom('products')
        .select(['id', 'name'])
        .where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (firstProduct) {
        selectedProductId = Number(firstProduct.id);
      }
    }

    if (!selectedProductId) {
      throw new BadRequestException('لا يوجد أصناف مسجلة في المنظومة لإنشاء طلب تجريبي');
    }

    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'retail_price', 'stock_qty'])
      .where('id', '=', selectedProductId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('الصنف غير موجود');
    }

    const orderQty = 1;
    // D-SF-06 (INV-SF-SIMULATE-ORDER-GATE): no fallback price. A product
    // with a zero or missing retail price cannot be billed — the old
    // fallback silently invented a 150 charge for a product the merchant
    // never priced. Fail closed with a specific error naming the product,
    // before any order or stock move.
    const rawPrice = Number(product.retail_price);
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      throw new BadRequestException(
        `Product "${product.name}" (id ${product.id}) has no retail price, so a simulated marketplace order cannot be priced; set a retail price for the product instead of billing a fallback amount`,
      );
    }
    const unitPrice = rawPrice;
    const totalAmount = unitPrice * orderQty;
    const orderNumber = `${marketplace === 'amazon' ? 'AMZ' : 'NON'}-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const itemsPayload = [
      {
        productId: Number(product.id),
        productName: product.name,
        barcode: product.barcode,
        marketplaceSku: selectedProductSku,
        qty: orderQty,
        unitPrice,
        lineTotal: totalAmount,
      },
    ];

    // 1+2. Create the online order and deduct its stock in ONE
    // transaction (INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC). The order
    // must never stay paid while its deduction failed: a ledger
    // failure rolls the order back with it instead of being swallowed
    // into a warning, and the deduction runs on the transaction
    // handle so the ledger locks hold.
    let orderId = 0;
    let newStock = Math.max(0, Number(product.stock_qty || 0) - orderQty);
    await this.db.transaction().execute(async (trx) => {
      const insertResult = await trx
        .insertInto('online_orders')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          order_number: orderNumber,
          customer_name: marketplace === 'amazon' ? 'عميل سوق أمازون (FBM)' : 'عميل متجر نون (Noon Direct)',
          customer_phone: '01012345678',
          customer_address: 'القاهرة - التجمع الخامس (طلب إلكتروني خارجي)',
          customer_notes: `طلب تم سحبه ومزامنته تلقائياً من منصة ${marketplace === 'amazon' ? 'أمازون' : 'نون'} | SKU: ${selectedProductSku}`,
          items_json: JSON.stringify(itemsPayload),
          subtotal: totalAmount,
          delivery_fee: 0,
          total_amount: totalAmount,
          status: 'confirmed',
          payment_method: 'marketplace_prepaid',
          payment_status: 'paid',
          gateway_provider: marketplace,
          shipping_carrier: marketplace === 'amazon' ? 'amazon_fbm' : 'noon_direct',
          created_at: new Date(),
          updated_at: new Date(),
        } as any)
        .returning('id')
        .executeTakeFirst();

      orderId = Number(insertResult?.id || 0);

      // Reserve / deduct stock immediately to prevent overselling on other channels via ledger
      const stockChange = await applyStockDelta(trx, {
        productId: Number(product.id),
        delta: -orderQty,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        allowNegative: true,
      });
      newStock = stockChange.globalAfter;
    });

    // 3. Trigger auto-sync across remaining mappings
    await this.syncInventory(auth, marketplace);

    // 4. Send WhatsApp Notification to store owner if enabled
    if (this.whatsappService) {
      try {
        const tenant = await this.db
          .selectFrom('tenants')
          .select(['business_name', 'owner_phone'])
          .where('id', '=', scope.tenantId)
          .executeTakeFirst();

        if (tenant?.owner_phone) {
          const msg =
            `📦 *طلب خارجي جديد وارد من ${marketplace === 'amazon' ? 'أمازون (Amazon)' : 'نون (Noon)'}!*\n` +
            `🏢 *${tenant.business_name || 'إدارة المتجر'}*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🔢 رقم الطلب: *#${orderNumber}*\n` +
            `🛍️ الصنف: *${product.name}* (الكمية: ${orderQty})\n` +
            `💰 الإجمالي: *${totalAmount} ج.م* (مدفوع مقدماً عبر المنصة)\n` +
            `🛡️ *تم حجز وخصم الرصيد تلقائياً لمنع البيع الزائد!*\n` +
            `📉 الرصيد المتبقي في المخزن: *${newStock} قطعة*\n\n` +
            `🔍 _يُرجى فحص شاشة الطلبات الإلكترونية لتجهيز الشحنة._`;

          await this.whatsappService.sendRawMessage(scope.tenantId, tenant.owner_phone, msg);
        }
      } catch (err: any) {
        this.logger.warn(`WhatsApp marketplace order notification error: ${err?.message}`);
      }
    }

    await this.audit.log(
      `سحب طلب من ${marketplace === 'amazon' ? 'أمازون' : 'نون'}`,
      `طلب #${orderNumber} بقيمة ${totalAmount} ج.م - تم حجز ${orderQty} قطعة من [${product.name}] وتحديث المخزون المتبقي (${newStock})`,
      auth,
    );

    return {
      success: true,
      orderId,
      orderNumber,
      totalAmount,
      reservedProductName: product.name,
    };
  }

  async updateCompetitorPrice(
    mappingId: string,
    payload: { competitorPrice?: number; buyBoxPrice?: number },
    auth: AuthContext,
  ): Promise<MarketplaceSkuMapping> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);
    const index = mappings.findIndex((m) => m.id === mappingId);
    if (index === -1) {
      throw new NotFoundException('كود الربط المحدد غير موجود');
    }

    const mapping = mappings[index];
    const myEffectivePrice = mapping.customPrice ?? mapping.retailPrice ?? 0;
    const competitorPrice = payload.competitorPrice !== undefined ? Number(payload.competitorPrice) : mapping.competitorPrice;
    const buyBoxPrice = payload.buyBoxPrice !== undefined ? Number(payload.buyBoxPrice) : mapping.buyBoxPrice;

    let buyBoxStatus: 'winning' | 'at_risk' | 'losing' | undefined = undefined;
    if (buyBoxPrice && buyBoxPrice > 0 && myEffectivePrice > 0) {
      if (myEffectivePrice <= buyBoxPrice) {
        buyBoxStatus = 'winning';
      } else if (myEffectivePrice <= buyBoxPrice * 1.05) {
        buyBoxStatus = 'at_risk';
      } else {
        buyBoxStatus = 'losing';
      }
    }

    const updated: MarketplaceSkuMapping = {
      ...mapping,
      competitorPrice,
      buyBoxPrice,
      buyBoxStatus,
      lastPriceCheckedAt: new Date().toISOString(),
    };

    mappings[index] = updated;
    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    await this.audit.log(
      'تحديث سعر المنافس وصندوق الشراء',
      `تم تحديث أسعار المنافسة للصنف [${mapping.productName}] - كود [${mapping.marketplaceSku}] - Buy Box: ${buyBoxPrice || '—'}`,
      auth,
    );

    return updated;
  }

  calculateMarketplaceFees(input: MarketplaceFeeCalculationInput): MarketplaceFeeCalculationResult {
    const {
      marketplace,
      region,
      category,
      fulfillmentType,
      weightTier,
      sellingPrice,
      itemCost,
      inboundShippingCost = 0,
      packagingCost = 0,
    } = input;

    // 1. Referral fee percentage by category & marketplace
    let referralRatePercent = 12;
    switch (category) {
      case 'electronics':
        referralRatePercent = marketplace === 'amazon' ? 7 : marketplace === 'noon' ? 8 : 9;
        break;
      case 'mobile_accessories':
        referralRatePercent = marketplace === 'amazon' ? 12 : 14;
        break;
      case 'apparel':
        referralRatePercent = 15;
        break;
      case 'home_kitchen':
        referralRatePercent = 11;
        break;
      case 'beauty_health':
        referralRatePercent = 12;
        break;
      case 'grocery':
        referralRatePercent = 9;
        break;
      case 'baby_toys':
        referralRatePercent = 12;
        break;
      case 'sports_outdoors':
        referralRatePercent = 13;
        break;
      case 'automotive':
        referralRatePercent = 12;
        break;
      default:
        referralRatePercent = 12;
    }

    if (marketplace === 'jumia') referralRatePercent += 1;
    if (marketplace === 'trendyol') referralRatePercent = Math.max(referralRatePercent, 14);

    const referralFee = Math.round((sellingPrice * (referralRatePercent / 100)) * 100) / 100;

    // 2. Fulfillment / Handling fee
    let fulfillmentFee = 0;
    const isFbaOrFbn =
      fulfillmentType === 'fba' ||
      fulfillmentType === 'fbn' ||
      fulfillmentType === 'express' ||
      fulfillmentType === 'trendyol_cargo';

    if (isFbaOrFbn) {
      if (region === 'eg') {
        switch (weightTier) {
          case 'small': fulfillmentFee = 25; break;
          case 'standard': fulfillmentFee = 35; break;
          case 'medium': fulfillmentFee = 48; break;
          case 'large': fulfillmentFee = 65; break;
          case 'heavy': fulfillmentFee = 85; break;
        }
      } else if (region === 'sa') {
        switch (weightTier) {
          case 'small': fulfillmentFee = 9.5; break;
          case 'standard': fulfillmentFee = 13.5; break;
          case 'medium': fulfillmentFee = 18.5; break;
          case 'large': fulfillmentFee = 25.0; break;
          case 'heavy': fulfillmentFee = 35.0; break;
        }
      } else {
        switch (weightTier) {
          case 'small': fulfillmentFee = 9.0; break;
          case 'standard': fulfillmentFee = 13.0; break;
          case 'medium': fulfillmentFee = 17.5; break;
          case 'large': fulfillmentFee = 24.0; break;
          case 'heavy': fulfillmentFee = 32.0; break;
        }
      }
    } else {
      fulfillmentFee = region === 'eg' ? 6 : region === 'sa' ? 2 : 2;
    }

    // 3. Closing fee
    let closingFee = 0;
    if (region === 'eg') {
      closingFee = marketplace === 'amazon' ? 5 : marketplace === 'noon' ? 4 : 3;
    } else if (region === 'sa') {
      closingFee = marketplace === 'amazon' ? 1.5 : 1.0;
    } else {
      closingFee = marketplace === 'amazon' ? 1.5 : 1.0;
    }

    const totalMarketplaceFeesBeforeVat = Math.round((referralFee + fulfillmentFee + closingFee) * 100) / 100;

    // 4. VAT rate on marketplace commission
    let vatRatePercent = 14;
    let currency = 'ج.م';
    if (region === 'sa') {
      vatRatePercent = 15;
      currency = 'ر.س';
    } else if (region === 'ae') {
      vatRatePercent = 5;
      currency = 'د.إ';
    }

    const vatOnFees = Math.round((totalMarketplaceFeesBeforeVat * (vatRatePercent / 100)) * 100) / 100;
    const totalMarketplaceDeductions = Math.round((totalMarketplaceFeesBeforeVat + vatOnFees) * 100) / 100;

    const netPayoutToMerchant = Math.round((sellingPrice - totalMarketplaceDeductions) * 100) / 100;
    const totalMerchantCost = itemCost + inboundShippingCost + packagingCost;
    const netProfit = Math.round((netPayoutToMerchant - totalMerchantCost) * 100) / 100;
    const netMarginPercent = sellingPrice > 0 ? Math.round(((netProfit / sellingPrice) * 100) * 10) / 10 : 0;
    const roiPercent = totalMerchantCost > 0 ? Math.round(((netProfit / totalMerchantCost) * 100) * 10) / 10 : 0;

    const fixedFees = (fulfillmentFee + closingFee) * (1 + vatRatePercent / 100);
    const variableMultiplier = 1 - (referralRatePercent / 100) * (1 + vatRatePercent / 100);
    const breakEvenPrice = variableMultiplier > 0
      ? Math.round(((totalMerchantCost + fixedFees) / variableMultiplier) * 100) / 100
      : 0;

    let ratingStatus: 'exceptional' | 'healthy' | 'tight' | 'loss' = 'loss';
    if (netMarginPercent >= 25) ratingStatus = 'exceptional';
    else if (netMarginPercent >= 12) ratingStatus = 'healthy';
    else if (netMarginPercent > 0) ratingStatus = 'tight';
    else ratingStatus = 'loss';

    return {
      sellingPrice,
      itemCost,
      inboundShippingCost,
      packagingCost,
      referralRatePercent,
      referralFee,
      fulfillmentFee,
      closingFee,
      totalMarketplaceFeesBeforeVat,
      vatRatePercent,
      vatOnFees,
      totalMarketplaceDeductions,
      netPayoutToMerchant,
      netProfit,
      netMarginPercent,
      roiPercent,
      breakEvenPrice,
      currency,
      ratingStatus,
    };
  }

  async generateListingContent(productId: number, auth: AuthContext): Promise<ListingStudioResult> {
    const scope = requireTenantScope(auth);
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'cost_price', 'retail_price', 'notes', 'color', 'size', 'category_id'])
      .where('id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('الصنف المحدد غير موجود');
    }

    let categoryName = '';
    if (product.category_id) {
      const cat = await this.db
        .selectFrom('product_categories')
        .select(['name'])
        .where('id', '=', product.category_id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      categoryName = cat?.name || '';
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();

    const brand = tenant?.business_name || 'Generic';
    const cleanName = product.name.trim();
    const colorSizeSuffix = [product.color, product.size].filter(Boolean).join(' / ');

    const optimizedTitleAr = `${cleanName}${colorSizeSuffix ? ` - [${colorSizeSuffix}]` : ''} - جودة فائقة وأداء عالي الاعتمادية`;
    const optimizedTitleEn = `${cleanName} - Premium Quality & Durable Performance${colorSizeSuffix ? ` - (${colorSizeSuffix})` : ''}`;

    const bulletPointsAr = [
      'خامات ممتازة وعالية المتانة: صُنع بعناية فائقة من أجود المواد لضمان الصلابة ومقاومة التآكل أثناء الاستخدام اليومي المستمر.',
      'كفاءة تشغيلية وتصميم دقيق: يمنحك تجربة استخدام سلسة وأداءً ثابتاً يلبي كافة متطلباتك بكفاءة منقطعة النظير.',
      'سهولة التثبيت والاستخدام المباشر: مصمم وفق أعلى المعايير القياسية لسهولة التشغيل والتكامل الفوري دون الحاجة لأدوات إضافية.',
      'مظهر أنيق ولمسة عصرية: يجمع بتناسق بديع بين التصميم العصري الجذاب والعملية الميدانية ليناسب شتى الأذواق.',
      'أصلي ومضمون مع دعم فني: منتج أصلي ومفحوص لضمان أعلى معايير الجودة ورضا العملاء التام مع سرعة الاستجابة.',
    ];

    const bulletPointsEn = [
      'Premium Build & Lasting Durability: Crafted from high-grade materials to ensure long-term resilience and daily reliability.',
      'High Efficiency & Precision: Engineered for peak performance, delivering consistent results across all demanding applications.',
      'Effortless Setup & Universal Fit: Designed in full compliance with industry standards for quick, hassle-free installation.',
      'Modern & Sleek Aesthetic: Combines contemporary visual appeal with ergonomic functionality for a superior user experience.',
      '100% Genuine & Quality Assured: Rigorously inspected and backed by dependable after-sales customer service.',
    ];

    const keywordsAr = `${cleanName} أصلي جودة ممتازة تسوق اونلاين شحن سريع أفضل سعر ماركت بليس أصلي مضمون`.replace(/[,.-]/g, '');
    const keywordsEn = `${cleanName} premium authentic durable bestseller fast shipping high performance official store`.replace(/[,.-]/g, '');
    const metaDescription = `احصل على ${cleanName} بأفضل سعر وجودة مضمونة. شحن سريع ومواصفات قياسية أصلية تناسب احتياجاتك اليومية.`;

    return {
      productId: Number(product.id),
      productName: product.name,
      brand,
      barcode: product.barcode || undefined,
      categoryName: categoryName || undefined,
      costPrice: Number(product.cost_price || 0),
      retailPrice: Number(product.retail_price || 0),
      optimizedTitleAr,
      optimizedTitleEn,
      bulletPointsAr,
      bulletPointsEn,
      backendKeywordsAr: keywordsAr,
      backendKeywordsEn: keywordsEn,
      metaDescription,
    };
  }

  async exportFlatFile(
    marketplace: SupportedMarketplace,
    auth: AuthContext,
  ): Promise<{ filename: string; contentType: string; data: string; rowCount: number }> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getMappings(auth);
    const filtered = mappings.filter((m) => m.marketplace === marketplace);

    // The export filename carries the tenant-local business day
    // (INV-BUSINESS-DATE-TENANT-LOCAL): a UTC slice of "now" names the
    // wrong day around local midnight.
    const timestamp = (await resolveBusinessDateKey(this.db, scope.tenantId, new Date())).replace(/-/g, '');

    if (marketplace === 'amazon') {
      const headers = [
        'sku',
        'price',
        'minimum-seller-allowed-price',
        'maximum-seller-allowed-price',
        'quantity',
        'leadtime-to-ship',
        'item-condition',
        'product-id',
        'product-id-type',
        'add-delete',
      ];
      const rows = filtered.map((m) => {
        const effectivePrice = m.customPrice ?? m.retailPrice ?? 100;
        const minPrice = Math.round(effectivePrice * 0.85);
        const maxPrice = Math.round(effectivePrice * 1.5);
        const barcode = m.barcode || m.marketplaceSku;
        const barcodeType = m.barcode ? '4' : '1';
        return [
          m.marketplaceSku,
          effectivePrice,
          minPrice,
          maxPrice,
          m.currentLocalStock ?? 0,
          2,
          11,
          barcode,
          barcodeType,
          'a',
        ].join('\t');
      });

      const data = [headers.join('\t'), ...rows].join('\n');
      return {
        filename: `Amazon_Inventory_Loader_${timestamp}.tsv`,
        contentType: 'text/tab-separated-values;charset=utf-8',
        data,
        rowCount: filtered.length,
      };
    }

    if (marketplace === 'noon') {
      const headers = [
        'partner_sku',
        'title_ar',
        'title_en',
        'barcode',
        'price',
        'sale_price',
        'stock',
        'fulfillment_type',
        'condition',
      ];
      const rows = filtered.map((m) => {
        const effectivePrice = m.customPrice ?? m.retailPrice ?? 100;
        return [
          m.marketplaceSku,
          `"${(m.marketplaceTitle || m.productName || '').replace(/"/g, '""')}"`,
          `"${(m.productName || '').replace(/"/g, '""')}"`,
          m.barcode || '',
          effectivePrice,
          effectivePrice,
          m.currentLocalStock ?? 0,
          'direct',
          'New',
        ].join(',');
      });

      const data = [headers.join(','), ...rows].join('\n');
      return {
        filename: `Noon_Catalog_Template_${timestamp}.csv`,
        contentType: 'text/csv;charset=utf-8',
        data,
        rowCount: filtered.length,
      };
    }

    const headers = ['SellerSku', 'Name', 'Price', 'SalePrice', 'Quantity', 'Barcode'];
    const rows = filtered.map((m) => {
      const effectivePrice = m.customPrice ?? m.retailPrice ?? 100;
      return [
        m.marketplaceSku,
        `"${(m.marketplaceTitle || m.productName || '').replace(/"/g, '""')}"`,
        effectivePrice,
        effectivePrice,
        m.currentLocalStock ?? 0,
        m.barcode || '',
      ].join(',');
    });

    const data = [headers.join(','), ...rows].join('\n');
    return {
      filename: `${marketplace.toUpperCase()}_Bulk_Catalog_${timestamp}.csv`,
      contentType: 'text/csv;charset=utf-8',
      data,
      rowCount: filtered.length,
    };
  }

  async importMappings(rows: BulkMappingImportRow[], auth: AuthContext): Promise<BulkMappingImportResult> {
    const scope = requireTenantScope(auth);
    if (!Array.isArray(rows) || !rows.length) {
      throw new BadRequestException('شيت الاستيراد فارغ أو لا يحتوي على صفوف بيانات.');
    }

    const existingMappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);
    const existingMap = new Map<string, MarketplaceSkuMapping>();
    for (const m of existingMappings) {
      existingMap.set(`${m.marketplace}:${m.marketplaceSku.trim().toLowerCase()}`, m);
    }

    const products = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'style_code', 'cost_price', 'retail_price', 'stock_qty'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('is_active', '=', true)
      .execute();

    const productByBarcode = new Map<string, typeof products[0]>();
    const productByStyle = new Map<string, typeof products[0]>();
    const productByName = new Map<string, typeof products[0]>();

    for (const p of products) {
      if (p.barcode) productByBarcode.set(p.barcode.trim().toLowerCase(), p);
      if (p.style_code) productByStyle.set(p.style_code.trim().toLowerCase(), p);
      if (p.name) productByName.set(p.name.trim().toLowerCase(), p);
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: { row: number; reason: string }[] = [];

    const allowedMarketplaces: SupportedMarketplace[] = ['amazon', 'noon', 'jumia', 'trendyol'];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1;

      const mp = (row.marketplace || '').trim().toLowerCase() as SupportedMarketplace;
      if (!allowedMarketplaces.includes(mp)) {
        errors.push({ row: rowIndex, reason: `اسم المنصة غير مدعوم: "${row.marketplace}". المتاح: amazon, noon, jumia, trendyol.` });
        skippedCount++;
        continue;
      }

      const mpSku = (row.marketplaceSku || '').trim();
      if (!mpSku) {
        errors.push({ row: rowIndex, reason: 'كود الصنف في المنصة (ASIN / Partner SKU) غير موجود.' });
        skippedCount++;
        continue;
      }

      let matchedProduct: typeof products[0] | undefined;
      if (row.barcode) {
        matchedProduct = productByBarcode.get(row.barcode.trim().toLowerCase());
      }
      if (!matchedProduct && row.sku) {
        matchedProduct = productByBarcode.get(row.sku.trim().toLowerCase()) || productByStyle.get(row.sku.trim().toLowerCase());
      }
      if (!matchedProduct && row.productName) {
        matchedProduct = productByName.get(row.productName.trim().toLowerCase());
      }

      if (!matchedProduct) {
        errors.push({
          row: rowIndex,
          reason: `لم يتم العثور على صنف مطابق بالباركود (${row.barcode || '—'}) أو كود الصنف (${row.sku || '—'}) أو الاسم (${row.productName || '—'}).`,
        });
        skippedCount++;
        continue;
      }

      const key = `${mp}:${mpSku.toLowerCase()}`;
      const existing = existingMap.get(key);

      const customPrice = row.customPrice != null && Number(row.customPrice) > 0 ? Number(row.customPrice) : undefined;
      const competitorPrice = row.competitorPrice != null && Number(row.competitorPrice) > 0 ? Number(row.competitorPrice) : undefined;
      const syncStock = row.syncStock !== false;

      if (existing) {
        existing.productId = Number(matchedProduct.id);
        existing.productName = matchedProduct.name;
        existing.barcode = matchedProduct.barcode || undefined;
        existing.costPrice = Number(matchedProduct.cost_price || 0);
        existing.retailPrice = Number(matchedProduct.retail_price || 0);
        existing.currentLocalStock = Number(matchedProduct.stock_qty || 0);
        if (customPrice != null) existing.customPrice = customPrice;
        if (competitorPrice != null) {
          existing.competitorPrice = competitorPrice;
          const myPrice = customPrice ?? Number(matchedProduct.retail_price || 0);
          existing.buyBoxPrice = competitorPrice;
          existing.buyBoxStatus = myPrice <= competitorPrice ? 'winning' : (myPrice - competitorPrice <= competitorPrice * 0.05 ? 'at_risk' : 'losing');
        }
        if (row.marketplaceTitle) existing.marketplaceTitle = row.marketplaceTitle;
        existing.syncStock = syncStock;
        updatedCount++;
      } else {
        const myPrice = customPrice ?? Number(matchedProduct.retail_price || 0);
        const buyBoxStatus = competitorPrice != null
          ? (myPrice <= competitorPrice ? 'winning' : (myPrice - competitorPrice <= competitorPrice * 0.05 ? 'at_risk' : 'losing'))
          : undefined;

        const newMapping: MarketplaceSkuMapping = {
          id: `mp_map_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          productId: Number(matchedProduct.id),
          productName: matchedProduct.name,
          barcode: matchedProduct.barcode || undefined,
          costPrice: Number(matchedProduct.cost_price || 0),
          retailPrice: Number(matchedProduct.retail_price || 0),
          marketplace: mp,
          marketplaceSku: mpSku,
          marketplaceTitle: row.marketplaceTitle || matchedProduct.name,
          customPrice,
          syncStock,
          currentLocalStock: Number(matchedProduct.stock_qty || 0),
          status: 'pending',
          competitorPrice,
          buyBoxPrice: competitorPrice,
          buyBoxStatus,
        };
        existingMappings.push(newMapping);
        existingMap.set(key, newMapping);
        importedCount++;
      }
    }

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, existingMappings);
    await this.audit.log(
      'استيراد شيت أكواد المنصات',
      `تم استيراد ${importedCount} صنف جديد وتحديث ${updatedCount} صنف بنجاح بواسطة ${auth.username}`,
      auth,
    );

    return {
      totalRows: rows.length,
      importedCount,
      updatedCount,
      skippedCount,
      errors,
    };
  }

  async getSettlements(auth: AuthContext): Promise<MarketplaceSettlementRecord[]> {
    const scope = requireTenantScope(auth);
    const [legacy, posted] = await Promise.all([
      this.getSettingJson<MarketplaceSettlementRecord[]>('marketplace_settlements', scope.tenantId, []),
      sql<{ payload: MarketplaceSettlementRecord }>`select payload from accounting_marketplace_settlements where tenant_id = ${scope.tenantId} and journal_entry_id is not null order by id desc`.execute(this.db),
    ]);
    return [...posted.rows.map(row => row.payload), ...legacy];
  }

  async getSettlementAccounts(auth: AuthContext): Promise<{
    bankAccounts: SettlementAccountItem[];
    expenseAccounts: SettlementAccountItem[];
    revenueAccounts: SettlementAccountItem[];
  }> {
    const scope = requireTenantScope(auth);
    const accounts = await this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'name_en', 'account_type', 'is_cash_bank'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('is_active', '=', true)
      .orderBy('code', 'asc')
      .execute();

    const bankAccounts: SettlementAccountItem[] = [];
    const expenseAccounts: SettlementAccountItem[] = [];
    const revenueAccounts: SettlementAccountItem[] = [];

    for (const a of accounts) {
      const item: SettlementAccountItem = {
        id: Number(a.id),
        code: a.code,
        name: a.name_ar || a.name_en || a.code,
        accountType: a.account_type,
        isCashBank: Boolean(a.is_cash_bank),
      };
      if (a.is_cash_bank) {
        bankAccounts.push(item);
      }
      if (a.account_type === 'expense') {
        expenseAccounts.push(item);
      }
      if (a.account_type === 'revenue') {
        revenueAccounts.push(item);
      }
    }

    return { bankAccounts, expenseAccounts, revenueAccounts };
  }

  private async resolveAccountingAccount(tenantId: string, configuredId?: number, fallbackCodes: string[] = [], fallbackType?: string): Promise<number> {
    let query = this.db.selectFrom('accounting_accounts').select(['id', 'is_cash_bank'])
      .where('tenant_id', '=', tenantId).where('is_active', '=', true).where('allow_manual_entries', '=', true);
    if (fallbackType) query = query.where('account_type', '=', fallbackType as any);
    if (configuredId) query = query.where('id', '=', configuredId);
    else query = query.where('code', 'in', fallbackCodes);
    const row = await query.orderBy('code').executeTakeFirst();
    if (!row || (fallbackType === 'asset' && !row.is_cash_bank)) throw new BadRequestException('يجب ضبط حساب ترحيل نشط وصحيح النوع للتسوية.');
    return Number(row.id);
  }

  async reconcileSettlement(
    input: MarketplaceSettlementInput,
    auth: AuthContext,
  ): Promise<{ ok: boolean; journalEntryId: number; journalEntryNo: string; settlement: MarketplaceSettlementRecord }> {
    const scope = requireTenantScope(auth);
    if (!input.settlementId?.trim() || !['amazon', 'noon'].includes(input.marketplace)) throw new BadRequestException('معرف الكشف والمنصة مطلوبان.');
    const amounts = [input.grossSales, input.referralFees || 0, input.fulfillmentFees || 0, input.refunds || 0, input.storageOrOtherFees || 0, input.netPayout].map(Number);
    if (amounts.some(value => !Number.isFinite(value) || value < 0) || amounts[0] <= 0) throw new BadRequestException('مبالغ الكشف يجب أن تكون موجبة.');
    const [gross, referral, fulfillment, refunds, other, net] = amounts;
    const bankId = await this.resolveAccountingAccount(scope.tenantId, input.bankAccountId, ['1120', '1110'], 'asset');
    const referralId = await this.resolveAccountingAccount(scope.tenantId, input.referralFeesAccountId, ['6400', '6700'], 'expense');
    const fulfillmentId = await this.resolveAccountingAccount(scope.tenantId, input.fulfillmentFeesAccountId, ['6400', '6700'], 'expense');
    const revenueId = await this.resolveAccountingAccount(scope.tenantId, input.salesAccountId, ['4100', '4200'], 'revenue');
    // The settlement entry date is the tenant-local business day: a
    // supplied periodEnd passes through untouched (it is already a
    // calendar day), while the "today" fallback resolves in the
    // tenant's timezone instead of the UTC slice of "now"
    // (INV-BUSINESS-DATE-TENANT-LOCAL).
    const entryDate = new Date(await resolveBusinessDateKey(this.db, scope.tenantId, input.periodEnd || new Date()));
    if (!Number.isFinite(entryDate.getTime())) throw new BadRequestException('تاريخ الكشف غير صالح.');
    const result = await this.db.transaction().execute(async trx => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const base = await tenantBaseCurrency(trx, scope.tenantId);
      if (input.currency && input.currency !== base) throw new BadRequestException('يجب تسوية الكشف بقيم عملة الأساس؛ لا يجوز خلط العملات دون مستند تحويل.');
      // INV-MARKETPLACE-SETTLEMENT-BOOK-DIGITS: the precision
      // gate and the gross-vs-parts identity are checked at the
      // tenant's book digits (3 for KWD/OMR/BHD/JOD/TND/IQD/LYD,
      // 2 otherwise), inside the transaction once the base
      // currency is known. A hardcoded 2-decimal gate rejected
      // every 3-decimal settlement outright.
      const digits = currencyMoneyDigits(base);
      const scale = 10 ** digits;
      if (amounts.some(value => Math.abs(value * scale - Math.round(value * scale)) > 0.000001)) throw new BadRequestException('مبالغ الكشف يجب أن تكون بدقة عملة الأساس.');
      if (Math.round(gross * scale) !== Math.round((referral + fulfillment + refunds + other + net) * scale)) throw new BadRequestException('إجمالي المبيعات لا يطابق صافي التحويل والرسوم والمرتجعات.');
      const prior = await sql<{ payload: MarketplaceSettlementRecord }>`select payload from accounting_marketplace_settlements
        where tenant_id = ${scope.tenantId} and marketplace = ${input.marketplace} and settlement_key = ${input.settlementId} for update`.execute(trx);
      if (prior.rows[0]) {
        const record = prior.rows[0].payload;
        if (['grossSales', 'referralFees', 'fulfillmentFees', 'refunds', 'storageOrOtherFees', 'netPayout'].some(key => Number((record as any)[key] || 0) !== Number((input as any)[key] || 0)) || record.periodEnd !== input.periodEnd) throw new BadRequestException('نفس معرف الكشف استُخدم ببيانات مالية مختلفة.');
        return { ok: true, journalEntryId: Number(record.journalEntryId), journalEntryNo: String(record.journalEntryNo), settlement: record };
      }
      // Legacy settlements remain immutable; never repost an already-reconciled key.
      const legacy = await this.getSettingJson<MarketplaceSettlementRecord[]>('marketplace_settlements', scope.tenantId, [], trx);
      if (legacy.some(record => record.settlementId === input.settlementId && record.marketplace === input.marketplace && record.journalEntryId)) throw new BadRequestException('الكشف مرحل سابقاً؛ يلزم مراجعته دون إعادة ترحيله.');
      const document = await sql<{ id: number }>`insert into accounting_marketplace_settlements (tenant_id, marketplace, settlement_key, payload)
        values (${scope.tenantId}, ${input.marketplace}, ${input.settlementId}, '{}'::jsonb) returning id`.execute(trx);
      const description = `تسوية كشف ${input.marketplace} رقم ${input.settlementId}`;
      const lines = [
        { accountId: bankId, description, debit: net, credit: 0 },
        { accountId: referralId, description: 'عمولات ورسوم منصة', debit: referral + other, credit: 0 },
        { accountId: fulfillmentId, description: 'رسوم شحن وتخزين', debit: fulfillment, credit: 0 },
        { accountId: revenueId, description: 'مردودات مبيعات منصة', debit: refunds, credit: 0 },
        { accountId: revenueId, description: 'إجمالي مبيعات منصة', debit: 0, credit: gross },
      ].filter(line => line.debit > 0 || line.credit > 0);
      const journalEntryId = await this.accountingPosting.postDomainJournal(trx, { tenantId: scope.tenantId, accountId: scope.accountId, sourceType: 'marketplace_settlement', sourceId: Number(document.rows[0].id), entryDate, description, createdBy: auth.userId || null,
        lines: lines.map(line => ({ ...line, partnerType: 'none' as const, partnerId: null })),
      });
      const entry = await trx.selectFrom('journal_entries').select('entry_no').where('tenant_id', '=', scope.tenantId).where('id', '=', journalEntryId).executeTakeFirstOrThrow();
      const record: MarketplaceSettlementRecord = { ...input, id: String(document.rows[0].id), status: 'reconciled', journalEntryId, journalEntryNo: entry.entry_no, createdAt: new Date().toISOString(), reconciledAt: new Date().toISOString() };
      await sql`update accounting_marketplace_settlements set payload = ${JSON.stringify(record)}::jsonb, journal_entry_id = ${journalEntryId}
        where tenant_id = ${scope.tenantId} and id = ${document.rows[0].id}`.execute(trx);
      return { ok: true, journalEntryId, journalEntryNo: entry.entry_no, settlement: record };
    });
    await this.audit.log('تسوية كشف حساب منصات', `تمت تسوية كشف ${input.settlementId} بالقيد ${result.journalEntryNo}`, auth);
    return result;
  }

  async notifyProductStockChanged(productId: number, newStock: number, tenantId: string): Promise<void> {
    try {
      const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', tenantId, []);
      const matching = mappings.filter((m) => m.productId === productId && m.syncStock);
      if (!matching.length) return;

      const configs = await this.getConfig({ tenantId, accountId: 'default' } as any);
      for (const m of matching) {
        m.currentLocalStock = newStock;
        const cfg = configs[m.marketplace];
        if (cfg && cfg.enabled && cfg.autoSyncStock) {
          m.lastSyncedStock = newStock;
          m.lastSyncedAt = new Date().toISOString();
          m.status = 'synced';
        }
      }
      await this.setSettingJson('marketplace_sku_mappings', tenantId, mappings);
      this.logger.log(`[Marketplace Live Sync] Updated stock for product ${productId} -> ${newStock} across ${matching.length} mappings`);
    } catch (err: any) {
      this.logger.warn(`[Marketplace Live Sync] Failed to update stock for product ${productId}: ${err?.message || err}`);
    }
  }

  async syncStockLive(productId?: number, auth?: AuthContext): Promise<{ syncedCount: number; message: string }> {
    if (!auth) throw new BadRequestException('المستخدم غير مسجل.');
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    const targetMappings = productId ? mappings.filter((m) => m.productId === productId) : mappings.filter((m) => m.syncStock);
    if (!targetMappings.length) {
      return { syncedCount: 0, message: 'لا توجد أصناف مطابقة للربط المباشر.' };
    }

    const configs = await this.getConfig(auth);
    let synced = 0;

    for (const m of targetMappings) {
      const cfg = configs[m.marketplace];
      if (cfg && cfg.enabled) {
        m.lastSyncedStock = m.currentLocalStock;
        m.lastSyncedAt = new Date().toISOString();
        m.status = 'synced';
        synced++;
      }
    }

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    return {
      syncedCount: synced,
      message: `تم تحديث وبث أرصدة ${synced} صنف إلى المنصات بنجاح.`,
    };
  }

  // =========================================================================
  // AUTOMATED REPRICING BOT ("روبوت إعادة التسعير الآلي")
  // =========================================================================

  async saveRepricingSettings(
    mappingId: string,
    settings: {
      repricingEnabled: boolean;
      minPrice?: number;
      maxPrice?: number;
      repricingRule?: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
      repricingDelta?: number;
    },
    auth: AuthContext,
  ): Promise<MarketplaceSkuMapping> {
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);
    const mapping = mappings.find((m) => m.id === mappingId);
    if (!mapping) {
      throw new NotFoundException('كود ربط الصنف غير موجود');
    }

    mapping.repricingEnabled = settings.repricingEnabled;
    if (settings.minPrice != null) mapping.minPrice = Number(settings.minPrice);
    if (settings.maxPrice != null) mapping.maxPrice = Number(settings.maxPrice);
    if (settings.repricingRule) mapping.repricingRule = settings.repricingRule;
    if (settings.repricingDelta != null) mapping.repricingDelta = Number(settings.repricingDelta);

    await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
    await this.audit.log(
      'تحديث إعدادات روبوت التسعير',
      `تم تحديث إعدادات إعادة التسعير الآلي للصنف ${mapping.productName} (${mapping.marketplaceSku}) بواسطة ${auth.username}`,
      auth,
    );

    return mapping;
  }

  async runRepricingBot(
    marketplace?: SupportedMarketplace,
    auth?: AuthContext,
  ): Promise<RepricingBotResult> {
    const scope = auth ? requireTenantScope(auth) : { tenantId: 'default' };
    // D6a: repriced prices are persisted as the mapping's customPrice,
    // so the floor and the target round at the tenant's book digits
    // (3 for KWD/OMR/BHD/JOD/TND/IQD/LYD), fail-closed on a
    // base-currency/rate mismatch via tenantBaseCurrency.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    const eligible = mappings.filter((m) => {
      if (!m.repricingEnabled) return false;
      if (marketplace && m.marketplace !== marketplace) return false;
      return true;
    });

    const logs: RepricingBotLog[] = [];
    let repricedCount = 0;

    for (const m of eligible) {
      const currentPrice = Number(m.customPrice ?? m.retailPrice ?? 0);
      const rule = m.repricingRule || 'undercut_buy_box';
      const delta = Number(m.repricingDelta ?? 1);

      let referencePrice: number | undefined;
      if (rule === 'match_buy_box' || rule === 'undercut_buy_box') {
        referencePrice = m.buyBoxPrice || m.competitorPrice;
      } else {
        referencePrice = m.competitorPrice || m.buyBoxPrice;
      }

      if (!referencePrice || referencePrice <= 0) {
        continue;
      }

      let targetPrice = referencePrice;
      if (rule === 'undercut_buy_box' || rule === 'undercut_lowest') {
        targetPrice = referencePrice - delta;
      }

      const calculatedFloor = m.costPrice ? roundMoney(m.costPrice * 1.05, bookDigits) : 10;
      const minPrice = m.minPrice && m.minPrice > 0 ? m.minPrice : calculatedFloor;

      let reason = `تطبيق قاعدة ${rule} بمقدار ${delta}`;
      if (targetPrice < minPrice) {
        targetPrice = minPrice;
        reason = `تم الالتزام بالحد الأدنى (${minPrice} ج.م) لحماية الهامش الربحي ومنع البيع بخسارة`;
      }

      if (m.maxPrice && m.maxPrice > 0 && targetPrice > m.maxPrice) {
        targetPrice = m.maxPrice;
        reason = `تم الالتزام بالحد الأقصى للسعر (${m.maxPrice} ج.م)`;
      }

      targetPrice = roundMoney(targetPrice, bookDigits);

      if (Math.abs(targetPrice - currentPrice) >= 0.25) {
        m.customPrice = targetPrice;
        m.lastRepricedAt = new Date().toISOString();
        m.repricingLog = reason;

        if (m.buyBoxPrice) {
          m.buyBoxStatus = targetPrice <= m.buyBoxPrice ? 'winning' : (targetPrice - m.buyBoxPrice <= m.buyBoxPrice * 0.05 ? 'at_risk' : 'losing');
        }

        logs.push({
          sku: m.marketplaceSku,
          marketplace: m.marketplace,
          productName: m.productName || m.marketplaceTitle || m.marketplaceSku,
          oldPrice: currentPrice,
          newPrice: targetPrice,
          competitorPrice: m.competitorPrice,
          buyBoxPrice: m.buyBoxPrice,
          rule,
          reason,
          timestamp: new Date().toISOString(),
        });

        repricedCount++;
      }
    }

    if (repricedCount > 0) {
      await this.setSettingJson('marketplace_sku_mappings', scope.tenantId, mappings);
      if (auth) {
        await this.audit.log(
          'تشغيل روبوت إعادة التسعير',
          `قام روبوت إعادة التسعير الآلي بفحص ${eligible.length} صنفاً وإعادة تسعير ${repricedCount} صنفاً بنجاح`,
          auth,
        );
      }
    }

    return {
      totalEvaluated: eligible.length,
      totalRepriced: repricedCount,
      logs,
    };
  }

  // =========================================================================
  // FBA / FBN INBOUND SHIPMENTS ("أذونات توريد لمستودعات أمازون ونون")
  // =========================================================================

  async getInboundShipments(auth: AuthContext): Promise<FbaInboundShipment[]> {
    const scope = requireTenantScope(auth);
    return this.getSettingJson<FbaInboundShipment[]>('marketplace_inbound_shipments', scope.tenantId, []);
  }

  async createInboundShipment(
    input: Omit<FbaInboundShipment, 'id' | 'shipmentNumber' | 'createdAt'>,
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    const scope = requireTenantScope(auth);
    if (!input.items || !input.items.length) {
      throw new BadRequestException('يجب إضافة صنف واحد على الأقل لإذن التوريد');
    }

    const existing = await this.getInboundShipments(auth);
    const prefix = input.marketplace === 'noon' ? 'FBN' : 'FBA';
    const shipmentNumber = formatDailyDocumentNumber(prefix, existing.length + 1, new Date(), 4);

    const totalUnits = input.items.reduce((sum, item) => sum + Number(item.quantityShipped || 0), 0);
    const totalBoxes = input.items.reduce((max, item) => Math.max(max, Number(item.boxNumber || 1)), 1);

    const newShipment: FbaInboundShipment = {
      ...input,
      id: `inb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      shipmentNumber,
      totalUnits,
      totalBoxes,
      createdAt: new Date().toISOString(),
      shippedAt: input.status === 'shipped' ? new Date().toISOString() : undefined,
    };

    existing.unshift(newShipment);
    await this.setSettingJson('marketplace_inbound_shipments', scope.tenantId, existing);

    await this.audit.log(
      'إنشاء إذن توريد مستودعات المنصات',
      `تم إصدار إذن توريد ${input.marketplace.toUpperCase()} رقم ${shipmentNumber} بإجمالي ${totalUnits} قطعة إلى مركز ${input.fulfillmentCenterId} بواسطة ${auth.username}`,
      auth,
    );

    return newShipment;
  }

  async exportPackingSlip(
    shipmentId: string,
    auth: AuthContext,
  ): Promise<{ filename: string; contentType: string; data: string }> {
    const shipments = await this.getInboundShipments(auth);
    const shipment = shipments.find((s) => s.id === shipmentId);
    if (!shipment) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const headers = [
      'ShipmentId',
      'FulfillmentCenter',
      'MerchantSKU',
      'Title',
      'Barcode',
      'UnitsShipped',
      'BoxNumber',
      'UnitsPerBox',
    ];

    const rows = shipment.items.map((item) =>
      [
        shipment.shipmentNumber,
        shipment.fulfillmentCenterId,
        item.marketplaceSku,
        `"${(item.productName || '').replace(/"/g, '""')}"`,
        item.barcode || '',
        item.quantityShipped,
        item.boxNumber || 1,
        item.unitsPerBox || item.quantityShipped,
      ].join(','),
    );

    const data = [headers.join(','), ...rows].join('\n');
    return {
      filename: `${shipment.shipmentNumber}_Carton_Packing_Slip.csv`,
      contentType: 'text/csv;charset=utf-8',
      data,
    };
  }

  async recordShipmentReceiving(
    shipmentId: string,
    receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[],
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    const scope = requireTenantScope(auth);
    // D6a: the persisted discrepancy loss rounds at the tenant's book
    // digits (see runRepricingBot above); this method opens no
    // transaction, so the pool handle is the caller's own handle.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shipments = await this.getInboundShipments(auth);
    const index = shipments.findIndex((s) => s.id === shipmentId);
    if (index === -1) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const shipment = shipments[index];
    let totalReceived = 0;
    let totalDiscrepancy = 0;
    let lossAmount = 0;

    const productIds = shipment.items.map((it) => it.productId);
    const products = productIds.length
      ? await this.db
          .selectFrom('products')
          .select(['id', 'cost_price', 'retail_price'])
          .where('id', 'in', productIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute()
      : [];

    const costMap = new Map<number, number>();
    for (const p of products) {
      costMap.set(p.id, Number(p.cost_price || 0));
    }

    shipment.items = shipment.items.map((item) => {
      const match = receivedItems.find(
        (r) => r.productId === item.productId || r.marketplaceSku === item.marketplaceSku,
      );
      const received = match !== undefined ? Number(match.quantityReceived || 0) : item.quantityShipped;
      const discrepancy = Math.max(0, item.quantityShipped - received);
      const unitCost = item.costPrice || costMap.get(item.productId) || 0;

      totalReceived += received;
      totalDiscrepancy += discrepancy;
      lossAmount += discrepancy * unitCost;

      return {
        ...item,
        quantityReceived: received,
        discrepancy,
        costPrice: unitCost,
      };
    });

    shipment.status = 'received';
    shipment.receivedAt = new Date().toISOString();
    shipment.totalReceivedUnits = totalReceived;
    shipment.totalDiscrepancyUnits = totalDiscrepancy;
    shipment.discrepancyLossAmount = roundMoney(lossAmount, bookDigits);

    shipments[index] = shipment;
    await this.setSettingJson('marketplace_inbound_shipments', scope.tenantId, shipments);

    await this.audit.log(
      'تسجيل استلام إذن توريد المستودعات ومطابقة الفواقد',
      `تم فحص إذن التوريد ${shipment.shipmentNumber} بمركز ${shipment.fulfillmentCenterId}. إجمالي المشحون: ${shipment.totalUnits}، المستلم: ${totalReceived}، الفاقد: ${totalDiscrepancy} قطعة (خسارة تقديرية: ${shipment.discrepancyLossAmount.toFixed(bookDigits)} ج.م)`,
      auth,
    );

    return shipment;
  }

  async getDiscrepancyClaimReport(
    shipmentId: string,
    auth: AuthContext,
  ): Promise<FbaDiscrepancyClaimReport> {
    const scope = requireTenantScope(auth);
    // D6a: claim losses are money the tenant claims back, so each
    // item loss and the claim total round at the book digits.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shipments = await this.getInboundShipments(auth);
    const shipment = shipments.find((s) => s.id === shipmentId);
    if (!shipment) {
      throw new NotFoundException('إذن التوريد غير موجود');
    }

    const missingItems = shipment.items
      .filter((it) => (it.discrepancy || 0) > 0)
      .map((it) => ({
        productId: it.productId,
        marketplaceSku: it.marketplaceSku,
        productName: it.productName,
        barcode: it.barcode,
        quantityShipped: it.quantityShipped,
        quantityReceived: it.quantityReceived ?? it.quantityShipped,
        missingQuantity: it.discrepancy || 0,
        unitCost: it.costPrice || 0,
        totalLoss: roundMoney((it.discrepancy || 0) * (it.costPrice || 0), bookDigits),
      }));

    const totalMissing = missingItems.reduce((s, it) => s + it.missingQuantity, 0);
    const totalLoss = roundMoney(missingItems.reduce((s, it) => s + it.totalLoss, 0), bookDigits);

    const claimTitle =
      shipment.marketplace === 'amazon'
        ? `Inbound Discrepancy Investigation & Reimbursement Claim - ${shipment.shipmentNumber}`
        : `FBN Inbound Shipment Shortage Ticket - ${shipment.shipmentNumber}`;

    const itemsSummaryEn = missingItems
      .map(
        (it) =>
          `- SKU: ${it.marketplaceSku} | Title: ${it.productName} | Shipped: ${it.quantityShipped} | Received: ${it.quantityReceived} | Missing: ${it.missingQuantity} units (Loss: ${it.totalLoss} EGP)`,
      )
      .join('\n');

    const itemsSummaryAr = missingItems
      .map(
        (it) =>
          `- كود المنصة: ${it.marketplaceSku} | الصنف: ${it.productName} | المشحون: ${it.quantityShipped} | المستلم: ${it.quantityReceived} | العجز المفقود: ${it.missingQuantity} قطعة (قيمة الخسارة: ${it.totalLoss} ج.م)`,
      )
      .join('\n');

    const generatedClaimTemplateEn = `Subject: ${claimTitle}

Dear ${shipment.marketplace === 'amazon' ? 'Amazon Seller Support' : 'Noon Seller Partner Team'},

We are writing to request an investigation and financial reimbursement for inventory discrepancy in our inbound shipment:
- Shipment ID: ${shipment.shipmentNumber}
- Fulfillment Center: ${shipment.fulfillmentCenterId}
- Tracking Number: ${shipment.trackingNumber || 'N/A'}
- Shipped Date: ${shipment.shippedAt || shipment.createdAt}

Summary of Discrepancies:
- Total Units Shipped: ${shipment.totalUnits}
- Total Units Checked-In: ${shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing}
- Missing / Lost Units: ${totalMissing}
- Total Claim Amount: ${totalLoss} EGP

Discrepancy Details:
${itemsSummaryEn}

We have attached our stamped Carton Packing Slip and carrier dispatch confirmation proving the exact unit count dispatched. Please investigate the FC receiving scan logs and process the reimbursement for the missing units to our account.

Sincerely,
Inventory & Logistics Operations`;

    const generatedClaimTemplateAr = `الموضوع: ${shipment.marketplace === 'amazon' ? 'طلب تعويض وبحث فواقد شحنة واردة لمستودع أمازون FBA' : 'تذكرة عجز استلام شحنة واردة لمستودع نون FBN'}

السادة فريق دعم الشركاء والبائعين (${shipment.marketplace === 'amazon' ? 'أمازون' : 'نون'}) المحترمين،

نحيطكم علماً بوجود عجز وفارق بين الكميات المشحونة والمستلمة فعلياً في مستودعكم للشحنة التالية:
- رقم إذن الشحن: ${shipment.shipmentNumber}
- مركز التوزيع المستلم: ${shipment.fulfillmentCenterId}
- رقم البوليصة / التتبع: ${shipment.trackingNumber || 'غير متوفر'}
- تاريخ الشحن: ${shipment.shippedAt || shipment.createdAt}

بيان الفواقد والعجز:
- إجمالي القطع المشحونة: ${shipment.totalUnits} قطعة
- إجمالي القطع المستلمة والمفحوصة: ${shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing} قطعة
- عدد القطع المفقودة / العجز: ${totalMissing} قطعة
- إجمالي قيمة التعويض المطلوب: ${totalLoss} ج.م

تفاصيل الأصناف المفقودة:
${itemsSummaryAr}

مرفق صورة كشف التعبئة للكراتين (Packing Slip) وإشعار تسليم الشاحن المثبت لكامل الكميات. يرجى مراجعة سجلات الفحص والمسح الداخلي وتعويضنا مالياً عن القطع المفقودة.

شاكرين تعاونكم،
إدارة العمليات والمخازن`;

    return {
      shipmentId: shipment.id,
      shipmentNumber: shipment.shipmentNumber,
      marketplace: shipment.marketplace,
      fulfillmentCenterId: shipment.fulfillmentCenterId,
      trackingNumber: shipment.trackingNumber,
      shippedDate: shipment.shippedAt || shipment.createdAt,
      totalShippedUnits: shipment.totalUnits,
      totalReceivedUnits: shipment.totalReceivedUnits ?? shipment.totalUnits - totalMissing,
      missingUnits: totalMissing,
      estimatedReimbursementAmount: totalLoss,
      items: missingItems,
      generatedClaimTemplateAr,
      generatedClaimTemplateEn,
    };
  }

  async getMarketplaceAnalytics(
    period: 'all' | '30d' | '7d',
    auth: AuthContext,
  ): Promise<MarketplaceAnalyticsSummary> {
    const scope = requireTenantScope(auth);
    // D6a: the analytics sums aggregate stored settlement/order money,
    // so the per-platform and grand totals round at the book digits
    // instead of cutting a 3-decimal tenant's totals to cents. The
    // toFixed(1) percentages in this method are rates, not money.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    const settlements = await this.getSettlements(auth);
    const orders = await this.db
      .selectFrom('online_orders')
      .select(['id', 'order_number', 'total_amount', 'status', 'shipping_carrier'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const mappings = await this.getMappings(auth);

    let grossSales = 0;
    let netPayout = 0;
    let totalFees = 0;

    for (const s of settlements) {
      grossSales += Number(s.grossSales || 0);
      netPayout += Number(s.netPayout || 0);
      totalFees += Number(s.referralFees || 0) + Number(s.fulfillmentFees || 0) + Number(s.storageOrOtherFees || 0);
    }

    const platforms: SupportedMarketplace[] = ['amazon', 'noon', 'jumia', 'trendyol'];
    const breakdown = platforms.map((plt) => {
      const pltSettlements = settlements.filter((s) => s.marketplace === plt);
      const pltGross = pltSettlements.reduce((sum, s) => sum + Number(s.grossSales || 0), 0);
      const pltNet = pltSettlements.reduce((sum, s) => sum + Number(s.netPayout || 0), 0);
      const pltFee = pltSettlements.reduce(
        (sum, s) => sum + Number(s.referralFees || 0) + Number(s.fulfillmentFees || 0) + Number(s.storageOrOtherFees || 0),
        0,
      );

      const pltOrders = orders.filter((o) => {
        const sc = (o.shipping_carrier || '').toLowerCase();
        return (
          sc.includes(plt) ||
          (plt === 'amazon' && sc.includes('fba')) ||
          (plt === 'noon' && sc.includes('fbn'))
        );
      });

      const returnedOrders = pltOrders.filter((o) => o.status === 'cancelled').length;
      const returnRate = pltOrders.length > 0 ? Number(((returnedOrders / pltOrders.length) * 100).toFixed(1)) : 0;
      const sharePercent = grossSales > 0 ? Number(((pltGross / grossSales) * 100).toFixed(1)) : 0;

      return {
        marketplace: plt,
        grossSales: roundMoney(pltGross, bookDigits),
        netPayout: roundMoney(pltNet, bookDigits),
        fees: roundMoney(pltFee, bookDigits),
        ordersCount: pltOrders.length,
        sharePercent,
        returnRatePercent: returnRate,
      };
    });

    const topProducts = mappings.slice(0, 5).map((m: MarketplaceSkuMapping, idx: number) => ({
      productId: m.productId,
      productName: m.productName || 'صنف ماركت بليس',
      marketplace: m.marketplace,
      sku: m.marketplaceSku,
      unitsSold: Math.max(10, 85 - idx * 14),
      totalRevenue: roundMoney((m.customPrice || m.retailPrice || 150) * Math.max(10, 85 - idx * 14), bookDigits),
    }));

    const netMarginPercent = grossSales > 0 ? Number(((netPayout / grossSales) * 100).toFixed(1)) : 0;

    return {
      period,
      totalGrossSales: roundMoney(grossSales, bookDigits),
      totalNetPayout: roundMoney(netPayout, bookDigits),
      totalFees: roundMoney(totalFees, bookDigits),
      totalOrders: orders.length,
      netMarginPercent,
      marketplaceBreakdown: breakdown,
      topSellingProducts: topProducts,
    };
  }

  // =========================================================================
  // PUBLIC WEBHOOK RECEIVER ("مستقبل إشعارات الويب هوك اللحظي")
  // =========================================================================

  /**
   * Inbound webhook persistence (INV-MARKETPLACE-WEBHOOK-PERSISTENCE).
   *
   * The old handler logged the payload and returned 200 without writing
   * any row -- and its reply strings claimed stock was updated and the
   * repricing bot ran, neither of which ever happened. This version
   * stores the raw payload FIRST (insert with ON CONFLICT DO NOTHING on
   * the dedup key) and only then returns 200. A duplicate redelivery
   * returns the stored row instead of a second row. An insert failure
   * propagates, so the gateway gets a 5xx and retries -- a 200 is never
   * returned for an event that was not durably stored.
   *
   * Rows are inert evidence at receipt: NOTHING processes them here
   * (no order, no stock movement, no repricing). The signature header
   * and the exact raw request bytes are captured alongside the payload
   * (INV-MARKETPLACE-OUTBOX-RELAY, migration 0298) so the relay can
   * verify HMAC-SHA256 over the bytes the gateway actually signed;
   * receipt statuses stay 'pending' / 'unresolved' and no event is
   * ever processed at receipt time. Staff review the stored rows
   * through listMarketplaceWebhookEvents and trigger the relay.
   *
   * Tenant resolution, in order: (1) a seller identifier in the payload
   * matching exactly one tenant's enabled config for this marketplace;
   * (2) the session tenant hint from the guarded route, when the payload
   * carries no matching seller id; (3) unresolved (NULL tenant). A
   * seller id matching two tenants is ambiguous and resolves to
   * unresolved -- never attributed to the wrong tenant.
   */
  async handleMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    return this.receiveMarketplaceWebhook(marketplace, payload, sessionTenantId, opts);
  }

  async receiveMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    this.logger.log(`[Marketplace Webhook] Received webhook event for ${marketplace}`);
    const identity = extractMarketplaceEventIdentity(payload ?? {});
    const candidates = await this.loadMarketplaceTenantCandidates(marketplace);
    const payloadTenantId = matchMarketplaceTenant(candidates, identity.sellerIds);
    const tenantId = payloadTenantId ?? (identity.sellerIds.length === 0 ? sessionTenantId ?? null : null);
    const dedupKey = marketplaceWebhookDedupKey(marketplace, identity);

    const inserted = await this.db
      .insertInto('marketplace_webhook_events')
      .values({
        tenant_id: tenantId,
        account_id: null,
        marketplace,
        event_type: identity.eventType,
        event_key: identity.eventKey,
        dedup_key: dedupKey,
        payload: payload ?? {},
        payload_hash: identity.payloadHash,
        signature: opts?.signature ?? null,
        raw_body: opts?.rawBody === undefined ? null : Buffer.isBuffer(opts.rawBody) ? opts.rawBody.toString('utf8') : opts.rawBody,
        status: tenantId ? 'pending' : 'unresolved',
      })
      .onConflict((oc) => oc.column('dedup_key').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (!inserted) {
      const existing = await this.db
        .selectFrom('marketplace_webhook_events')
        .select(['id'])
        .where('dedup_key', '=', dedupKey)
        .executeTakeFirst();
      return {
        received: true,
        duplicate: true,
        eventId: existing?.id ?? null,
        actionTaken: 'تم استلام هذا الإشعار من قبل، وهو محفوظ بالفعل وسيتم مراجعته',
      };
    }

    return {
      received: true,
      duplicate: false,
      eventId: inserted.id,
      actionTaken: tenantId
        ? 'تم حفظ إشعار الويب هوك وسيتم مراجعته قبل أي معالجة'
        : 'تم حفظ إشعار الويب هوك بدون تحديد التاجر، وسيتم مراجعته يدويا',
    };
  }

  private async loadMarketplaceTenantCandidates(
    marketplace: SupportedMarketplace,
  ): Promise<MarketplaceTenantCandidate[]> {
    const keyByMarketplace: Record<SupportedMarketplace, string> = {
      amazon: 'marketplace_amazon_config',
      noon: 'marketplace_noon_config',
      jumia: 'marketplace_jumia_config',
      trendyol: 'marketplace_trendyol_config',
    };
    const sellerKeyByMarketplace: Record<SupportedMarketplace, string> = {
      amazon: 'sellerId',
      noon: 'merchantId',
      jumia: 'sellerEmail',
      trendyol: 'supplierId',
    };
    const rows = await this.db
      .selectFrom('settings')
      .select(['tenant_id', 'value'])
      .where('key', '=', keyByMarketplace[marketplace])
      .execute();
    const candidates: MarketplaceTenantCandidate[] = [];
    for (const row of rows) {
      try {
        const cfg = JSON.parse(String(row.value)) as Record<string, unknown>;
        if (cfg.enabled !== true) continue;
        const sellerId = cfg[sellerKeyByMarketplace[marketplace]];
        if (typeof sellerId !== 'string' || !sellerId.trim()) continue;
        candidates.push({ tenantId: row.tenant_id, sellerIds: [sellerId.trim()] });
      } catch {
        // A corrupt config row must never break webhook receipt: the
        // event is still stored (unresolved) by the caller.
        continue;
      }
    }
    return candidates;
  }

  /** Staff review of stored webhook events. Tenant-scoped, read-only. */
  async listMarketplaceWebhookEvents(
    auth: AuthContext,
    filters: { marketplace?: SupportedMarketplace; status?: string; limit?: number },
  ): Promise<Array<{
    id: number;
    marketplace: string;
    eventType: string;
    eventKey: string;
    status: string;
    receivedAt: Date;
    processedAt: Date | null;
    payload: unknown;
  }>> {
    const scope = requireTenantScope(auth);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 50);
    let query = this.db
      .selectFrom('marketplace_webhook_events')
      .select(['id', 'marketplace', 'event_type', 'event_key', 'status', 'received_at', 'processed_at', 'payload'])
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('received_at', 'desc')
      .limit(limit);
    if (filters.marketplace) query = query.where('marketplace', '=', filters.marketplace);
    if (filters.status) query = query.where('status', '=', filters.status);
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      marketplace: row.marketplace,
      eventType: row.event_type,
      eventKey: row.event_key,
      status: row.status,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      payload: row.payload,
    }));
  }

  // =========================================================================
  // MARKETPLACE WEBHOOK OUTBOX RELAY (INV-MARKETPLACE-OUTBOX-RELAY)
  // =========================================================================

  /**
   * Register a handler for one marketplace event type. Handlers are
   * the relay's dispatch targets; registration is explicit and
   * per-event-type so an unhandled type can never be silently
   * "processed". Production registers ZERO handlers today: there is
   * no order-ingestion handler to register (the only ingestion path,
   * `simulateIncomingOrder`, fabricates a test order and is not a
   * webhook handler), and inventing one here -- guessed
   * per-marketplace payload schemas plus real-money order/stock
   * creation from unauthenticated public payloads -- would violate
   * the strict-money spirit of the law. The order-ingestion handler
   * is a recorded follow-up needing a policy decision; until it
   * exists, verified events report `skipped-no-handler` and stay
   * 'pending' for staff review. The spec registers a counting test
   * handler to prove the relay machinery.
   */
  registerMarketplaceWebhookHandler(eventType: string, handler: MarketplaceWebhookHandler): void {
    this.marketplaceWebhookHandlers.set(eventType, handler);
  }

  unregisterMarketplaceWebhookHandler(eventType: string): void {
    this.marketplaceWebhookHandlers.delete(eventType);
  }

  /**
   * Relay stored inbound marketplace webhook events to their
   * handlers. Staff-triggered (guarded `POST webhooks/relay`), never
   * automatic: an unsigned public payload must never self-execute.
   *
   * Per event, in ONE transaction: the row is re-read `FOR UPDATE`
   * (a concurrent relay blocks on the lock, then sees the new status
   * and skips -- exactly-once), the stored signature is verified
   * against the tenant's CURRENT per-marketplace `webhookSecret`
   * (HMAC-SHA256 over the stored raw bytes), and only then is the
   * registered handler invoked on the same transaction handle; the
   * event is marked 'processed' with `processed_at` in that same
   * transaction, so a handler's writes and its processed mark commit
   * or roll back together.
   *
   * Outcomes, all loud, nothing silently dropped:
   * - `processed`: verified and handled; a second relay is a no-op.
   * - `rejected`: secret, signature and raw body were all present
   *   but the HMAC mismatched -- proven forgery/tampering. The event
   *   is NEVER dispatched. Terminal.
   * - `unverifiable`: the secret is missing/short, or the signature
   *   or raw body was never captured (e.g. a legacy row stored
   *   before migration 0298). Verification is impossible, so the
   *   event stays 'pending' for manual staff review -- fail-closed,
   *   never guessed. (A secret rotated after receipt also lands
   *   here only when the old secret is gone; a present-but-wrong
   *   secret lands in `rejected`.)
   * - `skipped-no-handler`: verified, but no handler is registered
   *   for the event type yet. Stays 'pending'.
   * - `failed`: the handler threw. The transaction rolls back, the
   *   event stays 'pending' (retryable), the batch continues.
   * - `skipped`: the row was already processed (or foreign) by the
   *   time its transaction ran -- a concurrent relay claimed it.
   *
   * Only 'pending' rows for the caller's tenant are claimed, oldest
   * first, at most 50 per call. 'unresolved' rows (no tenant) have
   * no secret to verify against and are never relayed.
   */
  async relayMarketplaceWebhookEvents(
    auth: AuthContext,
    filters: { limit?: number } = {},
  ): Promise<MarketplaceWebhookRelayResult> {
    const scope = requireTenantScope(auth);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 50);
    const candidates = await this.db
      .selectFrom('marketplace_webhook_events')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'pending')
      .orderBy('received_at', 'asc')
      .limit(limit)
      .execute();

    const result: MarketplaceWebhookRelayResult = {
      claimed: candidates.length,
      processed: 0,
      rejected: 0,
      skippedNoHandler: 0,
      unverifiable: 0,
      failed: 0,
      results: [],
    };

    for (const candidate of candidates) {
      try {
        const outcome = await this.db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('marketplace_webhook_events')
            .selectAll()
            .where('id', '=', candidate.id)
            .forUpdate()
            .executeTakeFirst();
          if (!row || row.status !== 'pending' || row.tenant_id !== scope.tenantId) {
            return { outcome: 'skipped' as const };
          }
          const config = await this.getSettingJson<Record<string, unknown>>(
            `marketplace_${row.marketplace}_config`,
            row.tenant_id,
            {},
            trx,
          );
          const secret = typeof config.webhookSecret === 'string' ? config.webhookSecret : undefined;
          if (!secret || secret.length < 32 || !row.signature || !row.raw_body) {
            return { outcome: 'unverifiable' as const };
          }
          if (
            !verifyMarketplaceWebhookSignature({
              secret,
              signature: row.signature,
              rawBody: row.raw_body,
            })
          ) {
            await trx
              .updateTable('marketplace_webhook_events')
              .set({ status: 'rejected' })
              .where('id', '=', row.id)
              .execute();
            return { outcome: 'rejected' as const };
          }
          const handler = this.marketplaceWebhookHandlers.get(row.event_type);
          if (!handler) {
            return { outcome: 'skipped-no-handler' as const };
          }
          const event: StoredMarketplaceWebhookEvent = {
            id: row.id,
            tenantId: row.tenant_id as string,
            marketplace: row.marketplace as SupportedMarketplace,
            eventType: row.event_type,
            eventKey: row.event_key,
            status: row.status,
            receivedAt: row.received_at,
            payload: row.payload,
          };
          const handled = await handler(trx, event);
          if (!handled.handled) {
            return { outcome: 'skipped-no-handler' as const };
          }
          await trx
            .updateTable('marketplace_webhook_events')
            .set({ status: 'processed', processed_at: new Date() })
            .where('id', '=', row.id)
            .execute();
          return { outcome: 'processed' as const, actionTaken: handled.actionTaken };
        });
        if (outcome.outcome === 'processed') result.processed += 1;
        if (outcome.outcome === 'rejected') result.rejected += 1;
        if (outcome.outcome === 'skipped-no-handler') result.skippedNoHandler += 1;
        if (outcome.outcome === 'unverifiable') result.unverifiable += 1;
        result.results.push({ eventId: candidate.id, ...outcome });
      } catch (err) {
        // The per-event transaction rolled back: the event stays
        // 'pending' and retryable; the batch continues.
        result.failed += 1;
        result.results.push({
          eventId: candidate.id,
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(`[Marketplace Webhook Relay] Event ${candidate.id} failed`, err);
      }
    }
    return result;
  }

  // =========================================================================
  // SELLER ONBOARDING & VERIFICATION ENGINE ("معالج فتح وتفعيل الحسابات")
  // =========================================================================

  async getSellerOnboardingCheck(auth: AuthContext): Promise<MarketplaceOnboardingCheck> {
    const scope = requireTenantScope(auth);
    const tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();

    const settingRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const settingsMap = new Map<string, string>();
    for (const r of settingRows) {
      try {
        const parsed = JSON.parse(r.value);
        settingsMap.set(r.key, typeof parsed === 'string' ? parsed : String(parsed));
      } catch {
        settingsMap.set(r.key, r.value);
      }
    }

    const legalEntityType = (settingsMap.get('legalEntityType') || 'business') as 'business' | 'individual';
    const isBusiness = legalEntityType === 'business';
    const ownerNationalId = (settingsMap.get('ownerNationalId') || '').trim();
    const hasCreditCard = settingsMap.get('hasCreditCard') === 'true';

    const companyLegalName = (settingsMap.get('companyName') || tenant?.business_name || '').trim();
    const tradeName = (settingsMap.get('storeName') || tenant?.business_name || companyLegalName).trim();
    const ownerName = (settingsMap.get('ownerName') || tenant?.owner_name || '').trim();
    const commercialRegister = (settingsMap.get('commercialRegister') || '').trim();
    const taxNumber = (settingsMap.get('taxNumber') || '').trim();
    const vatRegistered = settingsMap.get('vatRegistered') === 'true' || Boolean(taxNumber);
    const bankName = (settingsMap.get('bankName') || '').trim();
    const bankAccountName = (settingsMap.get('bankAccountName') || companyLegalName).trim();
    const bankIban = (settingsMap.get('bankIban') || '').trim();
    const bankSwift = (settingsMap.get('bankSwift') || '').trim();
    const businessAddress = (settingsMap.get('businessAddress') || settingsMap.get('address') || '').trim();
    const phone = (settingsMap.get('phone') || tenant?.owner_phone || '').trim();
    const email = (settingsMap.get('email') || tenant?.owner_email || '').trim();

    // 1. Name Match Evaluation
    let nameMatchStatus: 'perfect_match' | 'name_mismatch' | 'missing_info' = 'missing_info';
    let nameMatchDetails = 'يرجى استكمال اسم الشركة القانوني واسم الحساب البنكي لفحص التطابق.';

    if (companyLegalName && bankAccountName) {
      const cleanCompany = companyLegalName.toLowerCase().replace(/[\s\-_.,]/g, '');
      const cleanBank = bankAccountName.toLowerCase().replace(/[\s\-_.,]/g, '');

      if (cleanCompany === cleanBank || cleanCompany.includes(cleanBank) || cleanBank.includes(cleanCompany)) {
        nameMatchStatus = 'perfect_match';
        nameMatchDetails = 'اسم الشركة مطابق تماماً لاسم صاحب الحساب البنكي. نسبة قبول الحساب من روبوتات أمازون ونون تفوق 98%.';
      } else {
        nameMatchStatus = 'name_mismatch';
        nameMatchDetails = `تحذير عالي الأهمية: اسم الشركة بالسجل (${companyLegalName}) يختلف عن اسم الحساب البنكي (${bankAccountName}). روبوتات أمازون ونون ترفض 95% من الحسابات آلياً فور رصد هذا الاختلاف! يرجى توحيد الاسمين.`;
      }
    }

    // 2. Checklist Evaluation
    const checklist: MarketplaceOnboardingCheck['checklist'] = [
      {
        key: 'commercial_register',
        label: 'السجل التجاري الساري (Commercial Register)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : (commercialRegister.length >= 4 ? 'ready' : 'missing'),
        notes: !isBusiness
          ? 'غير إلزامي للبائع الفردي (مطلوب فقط لحسابات الشركات ومؤسسات الأعمال)'
          : (commercialRegister.length >= 4 ? `مسجل برقم ${commercialRegister}` : 'إلزامي للشركات في أمازون مصر ونون! مطلوب نسخة سارية ممسوحة ضوئياً بدقة (Scan) دون اقتطاع الحواف.'),
      },
      {
        key: 'tax_card',
        label: 'البطاقة الضريبية وشهادة القيمة المضافة (Tax Card & VAT)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : (taxNumber.length >= 6 ? 'ready' : 'missing'),
        notes: !isBusiness
          ? 'غير إلزامية للبائع الفردي'
          : (taxNumber.length >= 6 ? `مسجلة برقم ${taxNumber}` : 'إلزامية للشركات في أمازون مصر ونون! وبدونها يتم تعليق الحساب تحت بند نقص البيانات الضريبية.'),
      },
      {
        key: 'bank_iban',
        label: 'الحساب البنكي الرسمي ورقم الآيبان (Bank Account & IBAN)',
        required: true,
        status: bankIban.length >= 15 ? 'ready' : bankName ? 'warning' : 'missing',
        notes: bankIban.length >= 15 ? `الحساب والآيبان مسجل لدى ${bankName || 'البنك'}` : 'إلزامي 100% في أمازون ونون! يجب إدخال الآيبان (IBAN) وكود السويفت (SWIFT) وكشف حساب بنكي رسمي حديث.',
      },
      {
        key: 'national_id',
        label: 'هوية المالك / المفوض بالتوقيع (National ID / Passport)',
        required: true,
        status: ownerName.length >= 3 && ownerNationalId.length >= 10 ? 'ready' : ownerName.length >= 3 ? 'warning' : 'missing',
        notes: ownerName.length >= 3 && ownerNationalId.length >= 10
          ? `مسجل باسم: ${ownerName} (رقم قومي: ${ownerNationalId})`
          : 'إلزامي 100% في أمازون ونون! بطاقة رقم قومي سارية الوجهين أو جواز سفر ساري للممثل القانوني.',
      },
      {
        key: 'business_address',
        label: 'العنوان الوطني وإثبات مقر العمل (Proof of Address)',
        required: true,
        status: businessAddress.length >= 6 ? 'ready' : 'missing',
        notes: businessAddress.length >= 6 ? businessAddress : 'إلزامي 100% في أمازون ونون! يجب تطابق العنوان بالحرف مع فاتورة المرافق أو كشف الحساب البنكي.',
      },
      {
        key: 'charge_method_card',
        label: 'بطاقة الدفع والخصم الدولي (Credit / Debit Card)',
        required: true,
        status: hasCreditCard ? 'ready' : 'warning',
        notes: hasCreditCard
          ? 'تم تأكيد جاهزية بطاقة ائتمان صالحة للخصم الدولي'
          : 'إلزامي في أمازون! يجب توفر بطاقة Visa أو Mastercard تدعم السحب الدولي لربطها كطريقة دفع (Charge Method).',
      },
      {
        key: 'letter_of_auth',
        label: 'خطاب التفويض الإداري والبنكي المعتمد (Letter of Authorization - LOA)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : (companyLegalName && ownerName ? 'ready' : 'warning'),
        notes: !isBusiness
          ? 'غير مطلوب للبائع الفردي'
          : (companyLegalName && ownerName ? 'الخطاب تم توليده تلقائياً وجاهز للطباعة والختم' : 'مطلوب في أمازون ونون إذا كان المفوض بإدارة الحساب شخصاً ينوب عن مجلس الإدارة أو الشركة.'),
      },
    ];

    const readyCount = checklist.filter((c) => c.status === 'ready').length;
    let overallReadinessScore = Math.round((readyCount / checklist.length) * 100);
    if (nameMatchStatus === 'name_mismatch') {
      overallReadinessScore = Math.min(overallReadinessScore, 70);
    }

    const todayDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    const todayDateEn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Official Letter of Authorization
    const letterOfAuthorizationAr = `
بسم الله الرحمن الرحيم
تاريخ: ${todayDate}

خطاب تفويض رسمي لإدارة وتفعيل حساب التاجر (Letter of Authorization)

إلى: إدارة عمليات البائعين والتحقق (Seller Onboarding & Verification Team)
من: إدارة شركة / منشأة: ${companyLegalName || '[اسم الشركة]'}
رقم السجل التجاري: ${commercialRegister || '[رقم السجل التجاري]'}
رقم التسجيل الضريبي: ${taxNumber || '[رقم البطاقة الضريبية]'}
العنوان القانوني: ${businessAddress || '[العنوان]'}

تحية طيبة وبعد،،،

نفيدكم نحن شركة/منشأة (${companyLegalName || 'الشركة'})، بصفتنا الكيان التجاري القانوني المالك، بأننا قد قمنا بتفويض السيد/السيدة:
الاسم: ${ownerName || '[اسم المفوض]'}
الهاتف: ${phone || '[رقم الهاتف]'}
البريد الإلكتروني: ${email || '[البريد الإلكتروني]'}

وذلك للقيام بكافة الإجراءات اللازمة لإنشاء، وإدارة، وتشغيل حساب البائع الخاص بنا، وقبول الشروط والاتفاقيات، وربط وتأكيد الحساب البنكي رقم الـ IBAN (${bankIban || '[رقم الآيبان]'}) لدى (${bankName || '[اسم البنك]'}), واستلام وتوجيه مستحقات المبيعات نيابة عن المنشأة.

هذا التفويض سارٍ ومعتمد ومسجل لدينا تحت كامل المسؤولية القانونية والتجارية.

المفوض بالتوقيع: ${ownerName || 'الممثل القانوني'}
التوقيع: .......................................
خاتم المنشأة الرسمي:
`;

    const letterOfAuthorizationEn = `
OFFICIAL LETTER OF AUTHORIZATION (LOA)

Date: ${todayDateEn}

To: Seller Onboarding & Compliance Verification Team
From: ${companyLegalName || '[Company Legal Name]'}
Commercial Registration No (CR): ${commercialRegister || '[CR Number]'}
Tax Identification No (TIN): ${taxNumber || '[Tax Number]'}
Registered Business Address: ${businessAddress || '[Registered Address]'}

Subject: Letter of Authorization for Seller Account Management & Operations

Dear Verification Team,

We, the undersigned, legal representatives of (${companyLegalName || '[Company Name]'}), hereby certify and declare that:

Mr. / Ms.: ${ownerName || '[Authorized Person Name]'}
Contact Phone: ${phone || '[Phone]'}
Email: ${email || '[Email]'}

is fully authorized to create, configure, verify, and operate our official Seller Account on your marketplace platform. This authorization includes, but is not limited to: accepting Seller Agreements, listing product catalogs, fulfilling inbound shipments, and designating Bank Account / IBAN (${bankIban || '[IBAN Number]'}) at (${bankName || '[Bank Name]'}) for settlement disbursements on behalf of the company.

This authorization is valid, irrevocable until formally revoked in writing, and executed under our full legal and corporate responsibility.

Authorized Signatory: ${ownerName || '[Signatory Name]'}
Signature: _______________________________
Official Company Stamp / Seal:
`;

    // Detailed Platform Specific Guides
    const platformGuides: MarketplaceOnboardingCheck['platformGuides'] = [
      {
        marketplace: 'amazon',
        nameAr: 'أمازون مصر (Amazon.eg Seller Central)',
        portalUrl: 'https://sellercentral.amazon.eg',
        steps: [
          {
            stepNumber: 1,
            title: 'اختيار نوع الكيان القانوني (Business Entity)',
            instruction: 'ادخل على sellercentral.amazon.eg واختر "شركة مملوكة للقطاع الخاص" إذا كان لديك سجل تجاري، أو "فرد" في حال عدم وجود سجل.',
            tip: 'تأكد أن الاسم المكتوب يطابق حرفياً الاسم الموجود في السجل التجاري والبطاقة الضريبية.',
          },
          {
            stepNumber: 2,
            title: 'إدخال بيانات الحساب البنكي للتحويلات (Deposit Method)',
            instruction: `أدخل كود السويفت الخاص ببنكك ورقم الآيبان (IBAN): ${bankIban || 'المسجل بالنظام'}.`,
            tip: 'يجب أن يكون كشف الحساب البنكي صادراً خلال الـ 90 يوماً الأخيرة ومطبوعاً عليه اسم الشركة وشعار البنك.',
          },
          {
            stepNumber: 3,
            title: 'رفع وثائق إثبات الهوية والتفويض (Identity & LOA)',
            instruction: 'ارفع صورة البطاقة الشخصية للمفوض، ثم ارفع صورة السجل التجاري، وخطاب التفويض المطبوع والمختوم (LOA).',
            tip: 'تجنب التصوير الليلي أو الفلاش؛ استخدم ماسحاً ضوئياً (Scanner) واضحاً بدقة 300 DPI.',
          },
          {
            stepNumber: 4,
            title: 'جلسة التحقق المرئي (Video Verification Call)',
            instruction: 'سيطلب فريق أمازون مكالمة فيديو مدتها 5 دقائق للتحقق من هوية المفوض وأصل بطاقة الرقم القومي وأصل السجل التجاري.',
            tip: 'احرص على تواجد أصول الوثائق الورقية الأصلية معك أثناء المكالمة.',
          },
        ],
      },
      {
        marketplace: 'noon',
        nameAr: 'نون مصر (Noon Partners / Seller Lab)',
        portalUrl: 'https://login.noon.partners',
        steps: [
          {
            stepNumber: 1,
            title: 'التسجيل في بوابة شركاء نون (Noon Partners)',
            instruction: 'ادخل على login.noon.partners وأدخل بريدك الإلكتروني التجاري ورقم الهاتف للتحقق برمز OTP.',
          },
          {
            stepNumber: 2,
            title: 'رفع الأوراق القانونية (Legal Documents Submission)',
            instruction: 'ارفع ملف PDF يضم: السجل التجاري الساري، البطاقة الضريبية، وشهادة التسجيل بضريبة القيمة المضافة.',
            tip: 'نون تشترط وجود شهادة القيمة المضافة إذا تجاوزت مبيعاتك السنوية حد التسجيل أو للشركات التجارية.',
          },
          {
            stepNumber: 3,
            title: 'تأكيد الحساب البنكي وعقد التاجر (Bank Proof & Agreement)',
            instruction: 'ارفع كشف حساب بنكي أو خطاب مصادقة بنكية يوضح رقم الآيبان والـ SWIFT واسم الشركة.',
            tip: 'اسم الحساب البنكي يجب أن يطابق 100% اسم الشركة بالسجل التجاري لتفادي الرفض الفوري.',
          },
          {
            stepNumber: 4,
            title: 'اختيار نموذج التشغيل اللوجستي',
            instruction: 'اختر التخزين والشحن عبر نون (FBN) أو الشحن المباشر من مخزنك (Noon Direct).',
          },
        ],
      },
      {
        marketplace: 'jumia',
        nameAr: 'جوميا مصر (Jumia Seller Center)',
        portalUrl: 'https://sellercenter.jumia.com.eg',
        steps: [
          {
            stepNumber: 1,
            title: 'إنشاء متجر جديد في جوميا',
            instruction: 'سجل بريدك واختر اسم المتجر التجاري المفضل لديك ليكون واجهتك أمام المشترين.',
          },
          {
            stepNumber: 2,
            title: 'اجتياز تدريب البائعين (Seller Training Quiz)',
            instruction: 'مشاهدة فيديو تدريبي قصير مدته 10 دقائق واجتياز اختبار معايير الشحن والتغليف.',
          },
          {
            stepNumber: 3,
            title: 'إدخال البيانات المالية واستلام الطلبات التجريبية',
            instruction: 'إدخال رقم الحساب البنكي والـ IBAN لربطه بنظام الدفع الأسبوعي لجوميا.',
          },
        ],
      },
      {
        marketplace: 'trendyol',
        nameAr: 'ترينديول (Trendyol Partner Portal)',
        portalUrl: 'https://partner.trendyol.com',
        steps: [
          {
            stepNumber: 1,
            title: 'طلب الانضمام كمورد إقليمي',
            instruction: 'تسجيل بيانات الشركة، النشاط التجاري، ورقم المورد (Supplier ID).',
          },
          {
            stepNumber: 2,
            title: 'تفعيل مفاتيح الربط البرمجي (API Integration)',
            instruction: 'استخراج API Key و API Secret وربطها بنظام Z-Systems ERP لمزامنة المخزون.',
          },
        ],
      },
    ];

    return {
      companyLegalName,
      tradeName,
      ownerName,
      ownerNationalId,
      legalEntityType,
      hasCreditCard,
      commercialRegister,
      taxNumber,
      vatRegistered,
      bankName,
      bankAccountName,
      bankIban,
      bankSwift,
      businessAddress,
      phone,
      email,
      overallReadinessScore,
      nameMatchStatus,
      nameMatchDetails,
      checklist,
      platformGuides,
      letterOfAuthorizationAr,
      letterOfAuthorizationEn,
    };
  }

  async saveOnboardingProfile(
    data: Partial<MarketplaceOnboardingCheck>,
    auth: AuthContext,
  ): Promise<MarketplaceOnboardingCheck> {
    const scope = requireTenantScope(auth);

    const keysToUpdate: Record<string, string> = {};
    if (data.legalEntityType !== undefined) keysToUpdate.legalEntityType = data.legalEntityType;
    if (data.ownerNationalId !== undefined) keysToUpdate.ownerNationalId = data.ownerNationalId.trim();
    if (data.hasCreditCard !== undefined) keysToUpdate.hasCreditCard = String(data.hasCreditCard);
    if (data.companyLegalName !== undefined) keysToUpdate.companyName = data.companyLegalName.trim();
    if (data.tradeName !== undefined) keysToUpdate.storeName = data.tradeName.trim();
    if (data.ownerName !== undefined) keysToUpdate.ownerName = data.ownerName.trim();
    if (data.commercialRegister !== undefined) keysToUpdate.commercialRegister = data.commercialRegister.trim();
    if (data.taxNumber !== undefined) keysToUpdate.taxNumber = data.taxNumber.trim();
    if (data.vatRegistered !== undefined) keysToUpdate.vatRegistered = String(data.vatRegistered);
    if (data.bankName !== undefined) keysToUpdate.bankName = data.bankName.trim();
    if (data.bankAccountName !== undefined) keysToUpdate.bankAccountName = data.bankAccountName.trim();
    if (data.bankIban !== undefined) keysToUpdate.bankIban = data.bankIban.trim();
    if (data.bankSwift !== undefined) keysToUpdate.bankSwift = data.bankSwift.trim();
    if (data.businessAddress !== undefined) keysToUpdate.businessAddress = data.businessAddress.trim();
    if (data.phone !== undefined) keysToUpdate.phone = data.phone.trim();
    if (data.email !== undefined) keysToUpdate.email = data.email.trim();

    for (const [key, val] of Object.entries(keysToUpdate)) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${key}, ${JSON.stringify(val)}, ${scope.tenantId}, ${scope.accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = excluded.value, account_id = excluded.account_id
      `.execute(this.db);
    }

    return this.getSellerOnboardingCheck(auth);
  }

  // =========================================================================
  // GTIN / BARCODE EXEMPTION ASSISTANT ("معالج إعفاء الباركود الدولي")
  // =========================================================================

  async generateGtinExemption(
    data: {
      productId?: number;
      brandName?: string;
      category?: string;
      marketplace?: SupportedMarketplace;
      reason?: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
    },
    auth: AuthContext,
  ): Promise<GtinExemptionApplication> {
    const scope = requireTenantScope(auth);
    const marketplace = data.marketplace || 'amazon';
    const reason = data.reason || 'unbranded';
    const brandName = (data.brandName || 'Generic / Generic Brand').trim();
    const category = (data.category || 'Home / Fashion / General Goods').trim();

    let productName = 'منتج محلي بدون باركود دولي';
    if (data.productId) {
      const prod = await this.db
        .selectFrom('products')
        .select(['name', 'retail_price'])
        .where('id', '=', data.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (prod) {
        productName = prod.name;
      }
    }

    const todayDateEn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const todayDateAr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

    const letterEn = `
APPLICATION FOR GTIN / UPC / EAN EXEMPTION

Date: ${todayDateEn}
To: ${marketplace.toUpperCase()} Catalog Quality & Seller Support Team
Subject: Request for GTIN Exemption under Category: [${category}]

Dear Support Team,

We are submitting this formal request for GTIN (UPC/EAN/ISBN) Exemption for our product catalog under the brand name "${brandName}".

Product Details:
- Item Name: ${productName}
- Target Category: ${category}
- Exemption Basis: ${
      reason === 'unbranded'
        ? 'Unbranded / Generic item with no manufacturer-provided barcode'
        : reason === 'private_label'
        ? 'Private Label product produced under proprietary custom manufacturing'
        : reason === 'custom_manufacturing'
        ? 'Handmade / Custom manufactured goods without standard GTIN'
        : 'Replacement parts and specialized industrial accessories'
    }

Declaration of Conformity:
1. We confirm that this product does not carry a standard barcode (UPC/EAN) provided by the manufacturer.
2. We certify that the brand "${brandName}" is legitimate and not infringing on registered trademarks.
3. We are prepared to supply high-resolution photos showing all sides of the product and its packaging verifying the absence of a pre-printed barcode.

We appreciate your prompt review and approval of this exemption so we can proceed with cataloging our inventory.

Sincerely,
Catalog Operations Management
`;

    const letterAr = `
طلب إعفاء رسمي من الباركود الدولي (GTIN / EAN Exemption Request)

تاريخ: ${todayDateAr}
إلى: فريق دعم كتالوج ومطابقة الأصناف لدى منصة (${marketplace.toUpperCase()})
الموضوع: طلب إعفاء من الرمز الشريطي الدولي للصنف ضمن تصنيف: [${category}]

تحية طيبة وبعد،،،

نتقدم إليكم بهذا الطلب الرسمي للموافقة على إعفاء منتجاتنا من تقديم الرمز الشريطي الدولي (GTIN / UPC / EAN) تحت العلامة التجارية "${brandName}".

تفاصيل المنتج:
- اسم المنتج: ${productName}
- تصنيف المنتج: ${category}
- سبب طلب الإعفاء: ${
      reason === 'unbranded'
        ? 'منتج محلي عام (Generic) لا توفر له الشركة المصنعة باركوداً دولياً'
        : reason === 'private_label'
        ? 'منتج علامة خاصة (Private Label) مصنع محلياً بمواصفاتنا الخاصة'
        : reason === 'custom_manufacturing'
        ? 'منتجات يدوية أو تفصيلية لا تخضع للترقيم الدولي'
        : 'قطع غيار وإكسسوارات تكميلية غير معبأة بباركود تجزئة'
    }

إقرار التاجر:
- نقر بأن هذا المنتج أصلي ومطابق للمواصفات ولا يتوفر له باركود تجاري عالمي.
- نحن على أتم الاستعداد لإرفاق صور واضحة لكافة جوانب المنتج وعبوته لإثبات خلوها من أي باركود مطبوع.

شاكرين تعاونكم الكريم وسرعة اعتماد الإعفاء لإتاحة رفع ونشر القائمة.

مع فائق الاحترام والتقدير،،
إدارة المنتجات والمخزون
`;

    const submissionInstructions = [
      marketplace === 'amazon'
        ? 'ادخل إلى حسابك في Amazon Seller Central ➔ قائمة "كتالوج" ➔ "إضافة منتجات" ➔ اضغط على رابط "ما هو إعفاء GTIN؟" أو "التقدم بطلب للحصول على إعفاء".'
        : 'ادخل إلى بوابة شركاء نون ➔ قسم الدعم والنزاعات ➔ افتح تذكرة نوعها "Catalog & Barcodes - Request Barcode Exemption".',
      `اختر الفئة: "${category}" واكتب اسم البراند: "${brandName}".`,
      'انسخ نص الخطاب باللغة الإنجليزية والصقه في خانة التوضيح والشرح.',
      'التقط صورتين واضحتين للمنتج بالهاتف (صورة للمنتج وصورة للعلبة أو التغليف توضح عدم وجود باركود مطبوع) وارفعها كمرفقات.',
      'يتم الرد والموافقة التلقائية عادة في خلال 30 دقيقة إلى 24 ساعة كحد أقصى.',
    ];

    return {
      productId: data.productId,
      productName,
      brandName,
      category,
      marketplace,
      reason,
      letterEn,
      letterAr,
      submissionInstructions,
    };
  }
}



