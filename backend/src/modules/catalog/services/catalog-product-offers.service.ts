import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { NormalizedUpsertProduct } from '../dto/upsert-product.dto';
import { ProductOfferColumnCapabilities } from './catalog-product-types';

/**
 * CatalogProductOffersService — slice P2 of the catalog-product split.
 * Pure move of 2 private methods from CatalogProductService (offer column
 * capability detection + the advanced-offers schema guard). No behavior
 * change: the bodies are byte-identical; the facade keeps thin private
 * delegates with the same names and signatures. The per-instance cache
 * promise field (productOfferColumnCapabilitiesPromise) moves with this
 * slice — only getProductOfferColumnCapabilities uses it, and the facade
 * does not keep it. Both methods are public here (private in the facade
 * delegate) — the facade, a different class, cannot call a private slice
 * method (tsc TS2341); the facade delegates stay private, so the facade
 * public surface is unchanged. Their only callers (listProducts,
 * listPosProducts, fetchProductOffers, replaceProductRelations,
 * saveFashionGroup, createProduct, updateProduct, getProduct) call the
 * facade delegates, never this slice directly. The shared type
 * ProductOfferColumnCapabilities is imported from ./catalog-product-types,
 * the module P1 creates at the first merge (the 9 type aliases move there).
 * No clock sites in this slice. No driving spec pins these methods
 * directly (P2/P3/P8 have no driving spec — prep §7.4).
 */

export interface CatalogProductOffersDeps {
  db: Kysely<Database>;
}

@Injectable()
export class CatalogProductOffersService {
  private readonly db: Kysely<Database>;
  private productOfferColumnCapabilitiesPromise?: Promise<ProductOfferColumnCapabilities>;

  constructor(deps: CatalogProductOffersDeps) {
    this.db = deps.db;
  }

  async getProductOfferColumnCapabilities(): Promise<ProductOfferColumnCapabilities> {
    if (!this.productOfferColumnCapabilitiesPromise) {
      this.productOfferColumnCapabilitiesPromise = sql<{ column_name: string }>`
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'product_offers'
        `
        .execute(this.db)
        .then((result) => {
          const columns = new Set(result.rows.map((row) => String(row.column_name || '').toLowerCase()));
          return {
            hasMinQty: columns.has('min_qty'),
            hasAdvancedPromotions: columns.has('bogo_buy_qty'),
          };
        })
        .catch(() => ({ hasMinQty: false, hasAdvancedPromotions: false }));
    }
    return this.productOfferColumnCapabilitiesPromise;
  }

  ensureAdvancedOffersSupported(payload: NormalizedUpsertProduct, capabilities: ProductOfferColumnCapabilities): void {
    const requiresAdvancedOfferSchema = payload.offers.some(
      (offer) => offer.type === 'price' || Number(offer.minQty || 1) > 1,
    );
    if (requiresAdvancedOfferSchema && !capabilities.hasMinQty) {
      throw new AppError(
        'Advanced product offers require the latest database migration. Run backend migrations first, then retry saving offers.',
        'PRODUCT_OFFERS_MIGRATION_REQUIRED',
        400,
      );
    }
  }
}
