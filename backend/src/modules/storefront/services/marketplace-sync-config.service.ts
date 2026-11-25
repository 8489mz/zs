/**
 * MarketplaceSyncConfigService — slice S1 of the marketplace-sync split.
 * Pure move of 3 methods from MarketplaceSyncService (marketplace
 * connection configuration): getConfig, saveConfig, testConnection.
 * No behavior change: bodies are byte-identical. Deps: the get/set
 * setting JSON kernel methods bound from the facade + AuditService.
 * The facade keeps thin delegates with the same names and signatures.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import { AmazonConfig, JumiaConfig, NoonConfig, SupportedMarketplace, TrendyolConfig } from './marketplace-sync.types';

export interface MarketplaceSyncConfigDeps {
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
  audit: AuditService;
}

@Injectable()
export class MarketplaceSyncConfigService {
  private readonly getSettingJson: MarketplaceSyncConfigDeps['getSettingJson'];
  private readonly setSettingJson: MarketplaceSyncConfigDeps['setSettingJson'];
  private readonly audit: AuditService;

  constructor(deps: MarketplaceSyncConfigDeps) {
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
    this.audit = deps.audit;
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
    const rawTrendyol = await this.getSettingJson<Partial<TrendyolConfig>>(
      'marketplace_trendyol_config',
      scope.tenantId,
      {},
    );

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
      const existing = await this.getSettingJson<Partial<AmazonConfig>>(
        'marketplace_amazon_config',
        scope.tenantId,
        {},
      );
      const merged: Partial<AmazonConfig> = { ...existing, ...payload.amazon };
      if (payload.amazon.refreshToken === '••••••••') merged.refreshToken = existing.refreshToken;
      if (payload.amazon.clientSecret === '••••••••') merged.clientSecret = existing.clientSecret;
      if (payload.amazon.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (
        payload.amazon.webhookSecret &&
        payload.amazon.webhookSecret !== '••••••••' &&
        payload.amazon.webhookSecret.length < 32
      )
        throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_amazon_config', scope.tenantId, merged);
    }

    if (payload.noon) {
      const existing = await this.getSettingJson<Partial<NoonConfig>>('marketplace_noon_config', scope.tenantId, {});
      const merged: Partial<NoonConfig> = { ...existing, ...payload.noon };
      if (payload.noon.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.noon.appSecret === '••••••••') merged.appSecret = existing.appSecret;
      if (payload.noon.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (
        payload.noon.webhookSecret &&
        payload.noon.webhookSecret !== '••••••••' &&
        payload.noon.webhookSecret.length < 32
      )
        throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_noon_config', scope.tenantId, merged);
    }

    if (payload.jumia) {
      const existing = await this.getSettingJson<Partial<JumiaConfig>>('marketplace_jumia_config', scope.tenantId, {});
      const merged: Partial<JumiaConfig> = { ...existing, ...payload.jumia };
      if (payload.jumia.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.jumia.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (
        payload.jumia.webhookSecret &&
        payload.jumia.webhookSecret !== '••••••••' &&
        payload.jumia.webhookSecret.length < 32
      )
        throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_jumia_config', scope.tenantId, merged);
    }

    if (payload.trendyol) {
      const existing = await this.getSettingJson<Partial<TrendyolConfig>>(
        'marketplace_trendyol_config',
        scope.tenantId,
        {},
      );
      const merged: Partial<TrendyolConfig> = { ...existing, ...payload.trendyol };
      if (payload.trendyol.apiKey === '••••••••') merged.apiKey = existing.apiKey;
      if (payload.trendyol.apiSecret === '••••••••') merged.apiSecret = existing.apiSecret;
      if (payload.trendyol.webhookSecret === '••••••••') merged.webhookSecret = existing.webhookSecret;
      if (
        payload.trendyol.webhookSecret &&
        payload.trendyol.webhookSecret !== '••••••••' &&
        payload.trendyol.webhookSecret.length < 32
      )
        throw new BadRequestException('Webhook secret must be at least 32 characters');
      await this.setSettingJson('marketplace_trendyol_config', scope.tenantId, merged);
    }

    await this.audit.log(
      'تحديث إعدادات ربط منصات التجارة الإلكترونية',
      `تم تحديث بيانات الربط السحابي بواسطة ${auth.username}`,
      auth,
    );
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
}
