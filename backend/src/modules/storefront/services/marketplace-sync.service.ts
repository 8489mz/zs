import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import {
  MARKETPLACE_WEBHOOK_SIGNATURE_HEADER,
} from '../engines/marketplace-webhook-event.engine';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { MarketplaceSyncOnboardingService } from './marketplace-sync-onboarding.service';
import { MarketplaceSyncWebhookRelayService } from './marketplace-sync-webhook-relay.service';
import { MarketplaceSyncWebhooksReceiveService } from './marketplace-sync-webhooks-receive.service';
import { MarketplaceSyncAnalyticsService } from './marketplace-sync-analytics.service';
import { MarketplaceSyncInboundService } from './marketplace-sync-inbound.service';
import { MarketplaceSyncRepricingService } from './marketplace-sync-repricing.service';
import { MarketplaceSyncSettlementsService } from './marketplace-sync-settlements.service';
import { MarketplaceSyncFeesListingService } from './marketplace-sync-fees-listing.service';
import { MarketplaceSyncSimulationService } from './marketplace-sync-simulation.service';
import { MarketplaceSyncInventoryService } from './marketplace-sync-inventory.service';
import { MarketplaceSyncMappingsService } from './marketplace-sync-mappings.service';
import { MarketplaceSyncConfigService } from './marketplace-sync-config.service';

import type {
  AmazonConfig,
  NoonConfig,
  JumiaConfig,
  TrendyolConfig,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  MarketplaceFeeCalculationInput,
  MarketplaceFeeCalculationResult,
  ListingStudioResult,
  BulkMappingImportRow,
  BulkMappingImportResult,
  MarketplaceSettlementInput,
  MarketplaceSettlementRecord,
  SettlementAccountItem,
  FbaInboundShipment,
  FbaDiscrepancyClaimReport,
  MarketplaceAnalyticsSummary,
  RepricingBotLog,
  RepricingBotResult,
  MarketplaceOnboardingCheck,
  GtinExemptionApplication,
  StoredMarketplaceWebhookEvent,
  MarketplaceWebhookHandler,
  MarketplaceWebhookRelayResult,
  MarketplaceWebhookReceiptOpts,
} from './marketplace-sync.types';
export type {
  AmazonConfig,
  NoonConfig,
  JumiaConfig,
  TrendyolConfig,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  MarketplaceFeeCalculationInput,
  MarketplaceFeeCalculationResult,
  ListingStudioResult,
  BulkMappingImportRow,
  BulkMappingImportResult,
  MarketplaceSettlementInput,
  MarketplaceSettlementRecord,
  SettlementAccountItem,
  FbaInboundItem,
  FbaInboundShipment,
  FbaDiscrepancyClaimReport,
  MarketplaceAnalyticsSummary,
  RepricingBotLog,
  RepricingBotResult,
  MarketplaceOnboardingCheck,
  GtinExemptionApplication,
  StoredMarketplaceWebhookEvent,
  MarketplaceWebhookHandler,
  MarketplaceWebhookRelayOutcome,
  MarketplaceWebhookRelayResult,
  MarketplaceWebhookReceiptOpts,
} from './marketplace-sync.types';

@Injectable()
export class MarketplaceSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceSyncService.name);
  private readonly configService: MarketplaceSyncConfigService;
  private readonly mappingsService: MarketplaceSyncMappingsService;
  private readonly inventoryService: MarketplaceSyncInventoryService;
  private readonly simulationService: MarketplaceSyncSimulationService;
  private readonly feesListingService: MarketplaceSyncFeesListingService;
  private readonly settlementsService: MarketplaceSyncSettlementsService;
  private readonly repricingService: MarketplaceSyncRepricingService;
  private readonly inboundService: MarketplaceSyncInboundService;
  private readonly analyticsService: MarketplaceSyncAnalyticsService;
  private readonly webhooksReceiveService: MarketplaceSyncWebhooksReceiveService;
  private readonly webhookRelayService: MarketplaceSyncWebhookRelayService;
  private readonly onboardingService: MarketplaceSyncOnboardingService;

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
  ) {
    this.configService = new MarketplaceSyncConfigService({
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
      audit: this.audit,
    });
    this.mappingsService = new MarketplaceSyncMappingsService({
      db: this.db,
      audit: this.audit,
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
    });
    this.inventoryService = new MarketplaceSyncInventoryService({
      db: this.db,
      audit: this.audit,
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
      getConfig: this.getConfig.bind(this),
    });
    this.simulationService = new MarketplaceSyncSimulationService({
      db: this.db,
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
      syncInventory: this.syncInventory.bind(this),
      audit: this.audit,
      whatsappService: this.whatsappService,
      planFeatureService: this.planFeatureService,
    });
    this.feesListingService = new MarketplaceSyncFeesListingService({
      db: this.db,
      getMappings: this.getMappings.bind(this),
    });
    this.settlementsService = new MarketplaceSyncSettlementsService({
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      getSettingJson: this.getSettingJson.bind(this),
    });
    this.repricingService = new MarketplaceSyncRepricingService({
      db: this.db,
      audit: this.audit,
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
    });
    this.inboundService = new MarketplaceSyncInboundService({
      db: this.db,
      audit: this.audit,
      getSettingJson: this.getSettingJson.bind(this),
      setSettingJson: this.setSettingJson.bind(this),
    });
    this.analyticsService = new MarketplaceSyncAnalyticsService({
      db: this.db,
      getMappings: this.getMappings.bind(this),
      getSettlements: this.getSettlements.bind(this),
    });
    this.webhooksReceiveService = new MarketplaceSyncWebhooksReceiveService({
      db: this.db,
    });
    this.webhookRelayService = new MarketplaceSyncWebhookRelayService({
      db: this.db,
      getSettingJson: this.getSettingJson.bind(this),
    });
    this.onboardingService = new MarketplaceSyncOnboardingService({
      db: this.db,
    });
  }

  onModuleInit() {
    return this.repricingService.onModuleInit();
  }

  onModuleDestroy() {
    return this.repricingService.onModuleDestroy();
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
    return this.configService.getConfig(auth);
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
    return this.configService.saveConfig(payload, auth);
  }

  async testConnection(
    marketplace: SupportedMarketplace,
    auth: AuthContext,
  ): Promise<{ success: boolean; message: string; pingMs: number; accountName?: string }> {
    return this.configService.testConnection(marketplace, auth);
  }

  async getMappings(auth: AuthContext): Promise<MarketplaceSkuMapping[]> {
    return this.mappingsService.getMappings(auth);
  }

  async saveMapping(payload: Omit<MarketplaceSkuMapping, 'id'> & { id?: string }, auth: AuthContext): Promise<MarketplaceSkuMapping> {
    return this.mappingsService.saveMapping(payload, auth);
  }

  async deleteMapping(id: string, auth: AuthContext): Promise<{ ok: boolean }> {
    return this.mappingsService.deleteMapping(id, auth);
  }

  async syncInventory(
    auth: AuthContext,
    marketplace?: 'amazon' | 'noon',
  ): Promise<{ syncedCount: number; updatedMappings: MarketplaceSkuMapping[] }> {
    return this.inventoryService.syncInventory(auth, marketplace);
  }

  async simulateIncomingOrder(
    marketplace: 'amazon' | 'noon',
    auth: AuthContext,
  ): Promise<{ success: boolean; orderId: number; orderNumber: string; totalAmount: number; reservedProductName: string }> {
    return this.simulationService.simulateIncomingOrder(marketplace, auth);
  }

  async updateCompetitorPrice(
    mappingId: string,
    payload: { competitorPrice?: number; buyBoxPrice?: number },
    auth: AuthContext,
  ): Promise<MarketplaceSkuMapping> {
    return this.simulationService.updateCompetitorPrice(mappingId, payload, auth);
  }

  calculateMarketplaceFees(input: MarketplaceFeeCalculationInput): MarketplaceFeeCalculationResult {
    return this.feesListingService.calculateMarketplaceFees(input);
  }

  async generateListingContent(productId: number, auth: AuthContext): Promise<ListingStudioResult> {
    return this.feesListingService.generateListingContent(productId, auth);
  }

  async exportFlatFile(
    marketplace: SupportedMarketplace,
    auth: AuthContext,
  ): Promise<{ filename: string; contentType: string; data: string; rowCount: number }> {
    return this.feesListingService.exportFlatFile(marketplace, auth);
  }

  async importMappings(rows: BulkMappingImportRow[], auth: AuthContext): Promise<BulkMappingImportResult> {
    return this.mappingsService.importMappings(rows, auth);
  }

  async getSettlements(auth: AuthContext): Promise<MarketplaceSettlementRecord[]> {
    return this.settlementsService.getSettlements(auth);
  }

  async getSettlementAccounts(auth: AuthContext): Promise<{
    bankAccounts: SettlementAccountItem[];
    expenseAccounts: SettlementAccountItem[];
    revenueAccounts: SettlementAccountItem[];
  }> {
    return this.settlementsService.getSettlementAccounts(auth);
  }

  async reconcileSettlement(
    input: MarketplaceSettlementInput,
    auth: AuthContext,
  ): Promise<{ ok: boolean; journalEntryId: number; journalEntryNo: string; settlement: MarketplaceSettlementRecord }> {
    return this.settlementsService.reconcileSettlement(input, auth);
  }

  async notifyProductStockChanged(productId: number, newStock: number, tenantId: string): Promise<void> {
    return this.inventoryService.notifyProductStockChanged(productId, newStock, tenantId);
  }

  async syncStockLive(productId?: number, auth?: AuthContext): Promise<{ syncedCount: number; message: string }> {
    return this.inventoryService.syncStockLive(productId, auth);
  }

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
    return this.repricingService.saveRepricingSettings(mappingId, settings, auth);
  }

  async runRepricingBot(
    marketplace?: SupportedMarketplace,
    auth?: AuthContext,
  ): Promise<RepricingBotResult> {
    return this.repricingService.runRepricingBot(marketplace, auth);
  }

  async getInboundShipments(auth: AuthContext): Promise<FbaInboundShipment[]> {
    return this.inboundService.getInboundShipments(auth);
  }

  async createInboundShipment(
    input: Omit<FbaInboundShipment, 'id' | 'shipmentNumber' | 'createdAt'>,
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    return this.inboundService.createInboundShipment(input, auth);
  }

  async exportPackingSlip(
    shipmentId: string,
    auth: AuthContext,
  ): Promise<{ filename: string; contentType: string; data: string }> {
    return this.inboundService.exportPackingSlip(shipmentId, auth);
  }

  async recordShipmentReceiving(
    shipmentId: string,
    receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[],
    auth: AuthContext,
  ): Promise<FbaInboundShipment> {
    return this.inboundService.recordShipmentReceiving(shipmentId, receivedItems, auth);
  }

  async getDiscrepancyClaimReport(
    shipmentId: string,
    auth: AuthContext,
  ): Promise<FbaDiscrepancyClaimReport> {
    return this.inboundService.getDiscrepancyClaimReport(shipmentId, auth);
  }

  async getMarketplaceAnalytics(
    period: 'all' | '30d' | '7d',
    auth: AuthContext,
  ): Promise<MarketplaceAnalyticsSummary> {
    return this.analyticsService.getMarketplaceAnalytics(period, auth);
  }

  async handleMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    return this.webhooksReceiveService.handleMarketplaceWebhook(marketplace, payload, sessionTenantId, opts);
  }

  async receiveMarketplaceWebhook(
    marketplace: SupportedMarketplace,
    payload: any,
    sessionTenantId?: string,
    opts?: MarketplaceWebhookReceiptOpts,
  ): Promise<{ received: boolean; duplicate: boolean; eventId: number | null; actionTaken: string }> {
    return this.webhooksReceiveService.receiveMarketplaceWebhook(marketplace, payload, sessionTenantId, opts);
  }

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
    return this.webhooksReceiveService.listMarketplaceWebhookEvents(auth, filters);
  }

  registerMarketplaceWebhookHandler(eventType: string, handler: MarketplaceWebhookHandler): void {
    return this.webhookRelayService.registerMarketplaceWebhookHandler(eventType, handler);
  }

  unregisterMarketplaceWebhookHandler(eventType: string): void {
    return this.webhookRelayService.unregisterMarketplaceWebhookHandler(eventType);
  }

  async relayMarketplaceWebhookEvents(
    auth: AuthContext,
    filters: { limit?: number } = {},
  ): Promise<MarketplaceWebhookRelayResult> {
    return this.webhookRelayService.relayMarketplaceWebhookEvents(auth, filters);
  }

  async getSellerOnboardingCheck(auth: AuthContext): Promise<MarketplaceOnboardingCheck> {
    return this.onboardingService.getSellerOnboardingCheck(auth);
  }

  async saveOnboardingProfile(
    data: Partial<MarketplaceOnboardingCheck>,
    auth: AuthContext,
  ): Promise<MarketplaceOnboardingCheck> {
    return this.onboardingService.saveOnboardingProfile(data, auth);
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



