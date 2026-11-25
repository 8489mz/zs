/**
 * MarketplaceSyncSimulationService — slice S4 of the marketplace-sync split.
 * Pure move of 2 methods from MarketplaceSyncService (order simulation:
 * simulateIncomingOrder, updateCompetitorPrice). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures. Deps: db + audit + the bound kernel helpers
 * getSettingJson/setSettingJson + the bound cross-slice dep syncInventory
 * (S3, S10 form) + optional whatsappService / planFeatureService. Types
 * come from ./marketplace-sync.types (S0). The simulate tx uses
 * applyStockDelta(trx, ...) only — never a pool handle. Clock sites
 * travel verbatim: Date.now() order-number suffix, new Date() created_at /
 * updated_at inside the tx, lastPriceCheckedAt ISO stamp; no instant
 * comparison, no UTC-slice normalizer.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import {
  STOREFRONT_NOT_ENTITLED_MESSAGE,
  isStorefrontEntitledForOrders,
} from '../engines/storefront-entitlement.engine';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import type { MarketplaceSkuMapping } from './marketplace-sync.types';

export interface MarketplaceSyncSimulationDeps {
  db: Kysely<Database>;
  // Bound kernel helpers (same names as the facade members, so the moved
  // bodies are byte-identical). getSettingJson/setSettingJson stay in the
  // facade forever (kernel).
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
  // Bound cross-slice dep (S3 syncInventory, S10 form: the facade binds its
  // own method so this slice is standalone-compilable; merge orders S3 first).
  syncInventory: (
    auth: AuthContext,
    marketplace?: 'amazon' | 'noon',
  ) => Promise<{ syncedCount: number; updatedMappings: MarketplaceSkuMapping[] }>;
  audit: AuditService;
  // Optional like the facade ctor: a missing resolver fails closed in the
  // entitlement gate instead of crashing DI.
  whatsappService?: WhatsAppGatewayService;
  planFeatureService?: PlanFeatureService;
}

@Injectable()
export class MarketplaceSyncSimulationService {
  private readonly logger = new Logger(MarketplaceSyncSimulationService.name);
  private readonly db: Kysely<Database>;
  private readonly getSettingJson: MarketplaceSyncSimulationDeps['getSettingJson'];
  private readonly setSettingJson: MarketplaceSyncSimulationDeps['setSettingJson'];
  private readonly syncInventory: MarketplaceSyncSimulationDeps['syncInventory'];
  private readonly audit: AuditService;
  private readonly whatsappService?: WhatsAppGatewayService;
  private readonly planFeatureService?: PlanFeatureService;

  constructor(deps: MarketplaceSyncSimulationDeps) {
    this.db = deps.db;
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
    this.syncInventory = deps.syncInventory;
    this.audit = deps.audit;
    this.whatsappService = deps.whatsappService;
    this.planFeatureService = deps.planFeatureService;
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
    const competitorPrice =
      payload.competitorPrice !== undefined ? Number(payload.competitorPrice) : mapping.competitorPrice;
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
}
