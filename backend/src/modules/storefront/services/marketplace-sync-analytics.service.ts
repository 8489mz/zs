/**
 * MarketplaceSyncAnalyticsService — slice S9 of the marketplace-sync split.
 * Pure move of 1 method from MarketplaceSyncService (per-marketplace
 * analytics summary: settlement/order aggregation, platform breakdown,
 * top-selling products). No behavior change: the body is byte-identical;
 * the facade keeps a thin delegate with the same name and signature. Deps
 * are db + the two bound cross-slice deps getMappings (S2) and
 * getSettlements (S6), both S10 form. NO kernel deps — no
 * getSettingJson/setSettingJson call exists in this span (prep §3: K
 * neither, ground-proven). NO audit, NO logger use (the span logs
 * nothing — prep §4 holds for S9). Types come from ./marketplace-sync.types
 * (S0). Money-math routes through the canonical engines (roundMoney /
 * currencyMoneyDigits); the toFixed(1) sites here are percentages, not
 * money. No date sites in this span — no clock handling.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import type {
  MarketplaceAnalyticsSummary,
  MarketplaceSettlementRecord,
  MarketplaceSkuMapping,
  SupportedMarketplace,
} from './marketplace-sync.types';

export interface MarketplaceSyncAnalyticsDeps {
  db: Kysely<Database>;
  // Bound cross-slice deps (S10 form): the facade binds its own methods so
  // this slice stays standalone-compilable. getMappings lives in S2,
  // getSettlements in S6.
  getMappings: (auth: AuthContext) => Promise<MarketplaceSkuMapping[]>;
  getSettlements: (auth: AuthContext) => Promise<MarketplaceSettlementRecord[]>;
}

@Injectable()
export class MarketplaceSyncAnalyticsService {
  private readonly db: Kysely<Database>;
  private readonly getMappings: (auth: AuthContext) => Promise<MarketplaceSkuMapping[]>;
  private readonly getSettlements: (auth: AuthContext) => Promise<MarketplaceSettlementRecord[]>;

  constructor(deps: MarketplaceSyncAnalyticsDeps) {
    this.db = deps.db;
    this.getMappings = deps.getMappings;
    this.getSettlements = deps.getSettlements;
  }

  async getMarketplaceAnalytics(period: 'all' | '30d' | '7d', auth: AuthContext): Promise<MarketplaceAnalyticsSummary> {
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
        (sum, s) =>
          sum + Number(s.referralFees || 0) + Number(s.fulfillmentFees || 0) + Number(s.storageOrOtherFees || 0),
        0,
      );

      const pltOrders = orders.filter((o) => {
        const sc = (o.shipping_carrier || '').toLowerCase();
        return sc.includes(plt) || (plt === 'amazon' && sc.includes('fba')) || (plt === 'noon' && sc.includes('fbn'));
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
}
