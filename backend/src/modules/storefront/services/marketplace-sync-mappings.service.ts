/**
 * MarketplaceSyncMappingsService — slice S2 of the marketplace-sync split.
 * Pure move of 4 methods from MarketplaceSyncService (SKU mappings: read,
 * save, delete, bulk import). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are kernel only (db + audit + the bound kernel
 * helpers getSettingJson/setSettingJson); no cross-slice deps. Types
 * come from ./marketplace-sync.types (S0). Date handling travels
 * verbatim: saveMapping stamps lastSyncedAt/lastPriceCheckedAt with
 * new Date().toISOString(); importMappings uses Date.now() for ids;
 * no instant comparison, no UTC-slice normalizer.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AuditService } from '../../../core/audit/audit.service';
import type {
  BulkMappingImportResult,
  BulkMappingImportRow,
  MarketplaceSkuMapping,
  SupportedMarketplace,
} from './marketplace-sync.types';
import type { SaveMarketplaceSkuMappingDto } from '../dto/marketplace-sync-write.dto';

export interface MarketplaceSyncMappingsDeps {
  db: Kysely<Database>;
  audit: AuditService;
  // Bound kernel helpers (same names as the facade members, so the moved
  // bodies are byte-identical). getSettingJson/setSettingJson stay in the
  // facade forever (kernel).
  getSettingJson: <T>(key: string, tenantId: string, defaultValue: T, executor?: Kysely<Database>) => Promise<T>;
  setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;
}

@Injectable()
export class MarketplaceSyncMappingsService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly getSettingJson: <T>(
    key: string,
    tenantId: string,
    defaultValue: T,
    executor?: Kysely<Database>,
  ) => Promise<T>;
  private readonly setSettingJson: <T>(key: string, tenantId: string, value: T) => Promise<void>;

  constructor(deps: MarketplaceSyncMappingsDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.getSettingJson = deps.getSettingJson;
    this.setSettingJson = deps.setSettingJson;
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

    const productMap = new Map<
      number,
      { name: string; barcode: string; stock_qty: number; cost_price: number; retail_price: number }
    >();
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

  async saveMapping(payload: SaveMarketplaceSkuMappingDto, auth: AuthContext): Promise<MarketplaceSkuMapping> {
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

  async importMappings(rows: BulkMappingImportRow[], auth: AuthContext): Promise<BulkMappingImportResult> {
    const scope = requireTenantScope(auth);
    if (!Array.isArray(rows) || !rows.length) {
      throw new BadRequestException('شيت الاستيراد فارغ أو لا يحتوي على صفوف بيانات.');
    }

    const existingMappings = await this.getSettingJson<MarketplaceSkuMapping[]>(
      'marketplace_sku_mappings',
      scope.tenantId,
      [],
    );
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

    const productByBarcode = new Map<string, (typeof products)[0]>();
    const productByStyle = new Map<string, (typeof products)[0]>();
    const productByName = new Map<string, (typeof products)[0]>();

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
        errors.push({
          row: rowIndex,
          reason: `اسم المنصة غير مدعوم: "${row.marketplace}". المتاح: amazon, noon, jumia, trendyol.`,
        });
        skippedCount++;
        continue;
      }

      const mpSku = (row.marketplaceSku || '').trim();
      if (!mpSku) {
        errors.push({ row: rowIndex, reason: 'كود الصنف في المنصة (ASIN / Partner SKU) غير موجود.' });
        skippedCount++;
        continue;
      }

      let matchedProduct: (typeof products)[0] | undefined;
      if (row.barcode) {
        matchedProduct = productByBarcode.get(row.barcode.trim().toLowerCase());
      }
      if (!matchedProduct && row.sku) {
        matchedProduct =
          productByBarcode.get(row.sku.trim().toLowerCase()) || productByStyle.get(row.sku.trim().toLowerCase());
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
      const competitorPrice =
        row.competitorPrice != null && Number(row.competitorPrice) > 0 ? Number(row.competitorPrice) : undefined;
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
          existing.buyBoxStatus =
            myPrice <= competitorPrice
              ? 'winning'
              : myPrice - competitorPrice <= competitorPrice * 0.05
                ? 'at_risk'
                : 'losing';
        }
        if (row.marketplaceTitle) existing.marketplaceTitle = row.marketplaceTitle;
        existing.syncStock = syncStock;
        updatedCount++;
      } else {
        const myPrice = customPrice ?? Number(matchedProduct.retail_price || 0);
        const buyBoxStatus =
          competitorPrice != null
            ? myPrice <= competitorPrice
              ? 'winning'
              : myPrice - competitorPrice <= competitorPrice * 0.05
                ? 'at_risk'
                : 'losing'
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
}
