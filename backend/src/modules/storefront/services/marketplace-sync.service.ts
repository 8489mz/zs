import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { Inject, Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { MARKETPLACE_WEBHOOK_SIGNATURE_HEADER } from '../engines/marketplace-webhook-event.engine';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { MarketplaceSyncGtinService } from './marketplace-sync-gtin.service';
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
  private readonly gtinService: MarketplaceSyncGtinService;

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
    this.gtinService = new MarketplaceSyncGtinService({
      db: this.db,
    });
  }

  onModuleInit() {
    return this.repricingService.onModuleInit();
  }

  onModuleDestroy() {
    return this.repricingService.onModuleDestroy();
  }

  private async getSettingJson<T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor: Kysely<Database> = this.db,
  ): Promise<T> {
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

  async saveMapping(
    payload: Omit<MarketplaceSkuMapping, 'id'> & { id?: string },
    auth: AuthContext,
  ): Promise<MarketplaceSkuMapping> {
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
  ): Promise<{
    success: boolean;
    orderId: number;
    orderNumber: string;
    totalAmount: number;
    reservedProductName: string;
  }> {
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

  async runRepricingBot(marketplace?: SupportedMarketplace, auth?: AuthContext): Promise<RepricingBotResult> {
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

  async getDiscrepancyClaimReport(shipmentId: string, auth: AuthContext): Promise<FbaDiscrepancyClaimReport> {
    return this.inboundService.getDiscrepancyClaimReport(shipmentId, auth);
  }

  async getMarketplaceAnalytics(period: 'all' | '30d' | '7d', auth: AuthContext): Promise<MarketplaceAnalyticsSummary> {
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
  ): Promise<
    Array<{
      id: number;
      marketplace: string;
      eventType: string;
      eventKey: string;
      status: string;
      receivedAt: Date;
      processedAt: Date | null;
      payload: unknown;
    }>
  > {
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
    return this.gtinService.generateGtinExemption(data, auth);
  }
}
