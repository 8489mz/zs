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



