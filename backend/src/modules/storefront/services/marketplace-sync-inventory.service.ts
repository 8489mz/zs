/**
 * MarketplaceSyncInventoryService — slice S3 of the marketplace-sync split.
 * Pure move of 3 methods from MarketplaceSyncService (live inventory sync:
 * immediate stock sync, live stock-change push, live sync endpoint). No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. Deps are db + audit +
 * the bound kernel helpers getSettingJson/setSettingJson + the bound
 * cross-slice getConfig (S1, S10 form — the facade's own method). Types
 * come from ./marketplace-sync.types (S0). The slice carries its own
 * Logger (notifyProductStockChanged logs via this.logger, 2x in the
 * moved text — prep §4's "no logger use" claim is wrong for this slice).
 * Date handling travels verbatim: syncInventory stamps lastSyncedAt with
 * new Date().toISOString() (the KNOWN clock-chain violation — moved
 * byte-identical, NOT fixed); notifyProductStockChanged / syncStockLive
 * stamp lastSyncedAt the same way. No instant comparison, no UTC-slice
 * normalizer.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import type {
  AmazonConfig,
  JumiaConfig,
  MarketplaceSkuMapping,
  NoonConfig,
  TrendyolConfig,
} from './marketplace-sync.types';

export interface MarketplaceSyncInventoryDeps {
  db: Kysely<Database>;
  audit: AuditService;
  // Bound kernel helpers (same names as the facade members, so the moved
  // bodies are byte-identical). getSettingJson/setSettingJson stay in the
  // facade forever (kernel).
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
  // Bound cross-slice dep (S1, S10 form): the facade's own getConfig.
  getConfig: (auth: AuthContext) => Promise<{
    amazon: AmazonConfig;
    noon: NoonConfig;
    jumia: JumiaConfig;
    trendyol: TrendyolConfig;
  }>;
}

@Injectable()
export class MarketplaceSyncInventoryService {
  private readonly logger = new Logger(MarketplaceSyncInventoryService.name);
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;
  private readonly setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
  private readonly getConfig: (auth: AuthContext) => Promise<{
    amazon: AmazonConfig;
    noon: NoonConfig;
    jumia: JumiaConfig;
    trendyol: TrendyolConfig;
  }>;

  constructor(deps: MarketplaceSyncInventoryDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
    this.getConfig = deps.getConfig;
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
      this.logger.log(
        `[Marketplace Live Sync] Updated stock for product ${productId} -> ${newStock} across ${matching.length} mappings`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[Marketplace Live Sync] Failed to update stock for product ${productId}: ${err?.message || err}`,
      );
    }
  }

  async syncStockLive(productId?: number, auth?: AuthContext): Promise<{ syncedCount: number; message: string }> {
    if (!auth) throw new BadRequestException('المستخدم غير مسجل.');
    const scope = requireTenantScope(auth);
    const mappings = await this.getSettingJson<MarketplaceSkuMapping[]>('marketplace_sku_mappings', scope.tenantId, []);

    const targetMappings = productId
      ? mappings.filter((m) => m.productId === productId)
      : mappings.filter((m) => m.syncStock);
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
}
