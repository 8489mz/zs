/**
 * MarketplaceSyncFeesListingService — slice S5 of the marketplace-sync split.
 * Pure move of 3 methods from MarketplaceSyncService (marketplace fee
 * estimation, listing-content generation, flat-file catalog export). No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. Deps are db + the bound
 * cross-slice dep getMappings (S2, S10 form); NO kernel deps — no
 * getSettingJson/setSettingJson call exists in this span (prep §3 K-column
 * correction, ground-proven). Types come from ./marketplace-sync.types (S0).
 * Money-math: all 7 inline Math.round(x*100)/100 sites in the file sit in
 * calculateMarketplaceFees — the allowlist entry moved with this slice
 * (facade entry removed, slice entry { toFixed2: 0, inlineRound: 7 }).
 * Clock travels verbatim: exportFlatFile uses resolveBusinessDateKey for
 * the tenant-local business day; no instant comparison, no UTC normalizer.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import type {
  ListingStudioResult,
  MarketplaceFeeCalculationInput,
  MarketplaceFeeCalculationResult,
  MarketplaceSkuMapping,
  SupportedMarketplace,
} from './marketplace-sync.types';

export interface MarketplaceSyncFeesListingDeps {
  db: Kysely<Database>;
  // Bound cross-slice dep (S10 form): the facade binds its own getMappings
  // so this slice stays standalone-compilable. getMappings lives in S2.
  getMappings: (auth: AuthContext) => Promise<MarketplaceSkuMapping[]>;
}

@Injectable()
export class MarketplaceSyncFeesListingService {
  private readonly db: Kysely<Database>;
  private readonly getMappings: (auth: AuthContext) => Promise<MarketplaceSkuMapping[]>;

  constructor(deps: MarketplaceSyncFeesListingDeps) {
    this.db = deps.db;
    this.getMappings = deps.getMappings;
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

    const referralFee = Math.round(sellingPrice * (referralRatePercent / 100) * 100) / 100;

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
          case 'small':
            fulfillmentFee = 25;
            break;
          case 'standard':
            fulfillmentFee = 35;
            break;
          case 'medium':
            fulfillmentFee = 48;
            break;
          case 'large':
            fulfillmentFee = 65;
            break;
          case 'heavy':
            fulfillmentFee = 85;
            break;
        }
      } else if (region === 'sa') {
        switch (weightTier) {
          case 'small':
            fulfillmentFee = 9.5;
            break;
          case 'standard':
            fulfillmentFee = 13.5;
            break;
          case 'medium':
            fulfillmentFee = 18.5;
            break;
          case 'large':
            fulfillmentFee = 25.0;
            break;
          case 'heavy':
            fulfillmentFee = 35.0;
            break;
        }
      } else {
        switch (weightTier) {
          case 'small':
            fulfillmentFee = 9.0;
            break;
          case 'standard':
            fulfillmentFee = 13.0;
            break;
          case 'medium':
            fulfillmentFee = 17.5;
            break;
          case 'large':
            fulfillmentFee = 24.0;
            break;
          case 'heavy':
            fulfillmentFee = 32.0;
            break;
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

    const vatOnFees = Math.round(totalMarketplaceFeesBeforeVat * (vatRatePercent / 100) * 100) / 100;
    const totalMarketplaceDeductions = Math.round((totalMarketplaceFeesBeforeVat + vatOnFees) * 100) / 100;

    const netPayoutToMerchant = Math.round((sellingPrice - totalMarketplaceDeductions) * 100) / 100;
    const totalMerchantCost = itemCost + inboundShippingCost + packagingCost;
    const netProfit = Math.round((netPayoutToMerchant - totalMerchantCost) * 100) / 100;
    const netMarginPercent = sellingPrice > 0 ? Math.round((netProfit / sellingPrice) * 100 * 10) / 10 : 0;
    const roiPercent = totalMerchantCost > 0 ? Math.round((netProfit / totalMerchantCost) * 100 * 10) / 10 : 0;

    const fixedFees = (fulfillmentFee + closingFee) * (1 + vatRatePercent / 100);
    const variableMultiplier = 1 - (referralRatePercent / 100) * (1 + vatRatePercent / 100);
    const breakEvenPrice =
      variableMultiplier > 0 ? Math.round(((totalMerchantCost + fixedFees) / variableMultiplier) * 100) / 100 : 0;

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

    const keywordsAr = `${cleanName} أصلي جودة ممتازة تسوق اونلاين شحن سريع أفضل سعر ماركت بليس أصلي مضمون`.replace(
      /[,.-]/g,
      '',
    );
    const keywordsEn =
      `${cleanName} premium authentic durable bestseller fast shipping high performance official store`.replace(
        /[,.-]/g,
        '',
      );
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
}
