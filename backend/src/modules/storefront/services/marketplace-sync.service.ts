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
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import {
  extractMarketplaceEventIdentity,
  marketplaceWebhookDedupKey,
  matchMarketplaceTenant,
  verifyMarketplaceWebhookSignature,
  MARKETPLACE_WEBHOOK_SIGNATURE_HEADER,
  type MarketplaceTenantCandidate,
} from '../engines/marketplace-webhook-event.engine';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
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
  private readonly configService: MarketplaceSyncConfigService;
  private readonly mappingsService: MarketplaceSyncMappingsService;
  private readonly inventoryService: MarketplaceSyncInventoryService;
  private readonly simulationService: MarketplaceSyncSimulationService;
  private readonly feesListingService: MarketplaceSyncFeesListingService;
  private readonly settlementsService: MarketplaceSyncSettlementsService;
  private readonly repricingService: MarketplaceSyncRepricingService;

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
    const shipmentNumber = formatDailyDocumentNumber(prefix, existing.length + 1, new Date(), 4, await getTenantTimezone(this.db, scope.tenantId));

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



