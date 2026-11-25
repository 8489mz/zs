import { Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { AuditService } from '../../../../core/audit/audit.service';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../../database/database.types';
import { TransactionHelper } from '../../../../database/helpers/transaction.helper';
import { type TripSaleContribution } from '../../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from '../sales-authorization.service';
import { SalesFinanceService } from '../sales-finance.service';
import { SalesQueryService } from '../sales-query.service';
import { PlanFeatureService } from '../../../../core/auth/services/plan-feature.service';
import { CashDrawerService } from '../../../cash-drawer/cash-drawer.service';

/*
 * Sale edit + cancel (slice 3 of the sales-write split).
 * Pure move: updateSale, cancelSale, detectPreparedWasteSale and the two
 * closed-shift refresh helpers, plus the trip-counter top-level helpers
 * they use (lockOpenTripRow, applyTripCounterDelta), unchanged, behind
 * the SalesWriteService delegating facade. The facade owns the serials,
 * stock/pricing and restaurant helpers; this service receives them bound
 * via SalesEditAndCancelDeps, so the moved bodies are byte-identical to
 * the originals.
 *
 * Two deliberate deviations from byte-identical: refreshClosedShiftsForBackdatedOfflineSale
 * is public here (not private) because createSale still calls it through a
 * private facade forwarder; and the facade keeps importing
 * previewConsumableStockQty even though no method left in the facade calls
 * it, because check-architecture-guardrails.cjs requires that token in
 * sales-write.service.ts.
 */

/**
 * Trip-counter maintenance for field (van) sales edited or cancelled
 * through the generic writer. The field flow maintains four counters
 * on van_sales_trips at creation time; the generic paths never did,
 * so an edit or a cancellation left settleTrip expecting cash the
 * books no longer showed. The lock is taken early (right after the
 * locked sale row is read, before any stock work — the same order
 * settleTrip uses) and held for the transaction; the counter delta
 * is applied once the replacement rows exist. A settled trip's
 * counters are history: they are never moved, in either method.
 */
export async function lockOpenTripRow(trx: any, tenantId: string, tripId: number): Promise<boolean> {
  const trip = await trx
    .selectFrom('van_sales_trips')
    .select(['id', 'status'])
    .where('id', '=', tripId)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();
  return Boolean(trip) && trip.status !== 'settled';
}

export async function applyTripCounterDelta(
  trx: any,
  tenantId: string,
  tripId: number,
  delta: TripSaleContribution,
): Promise<void> {
  if (!delta.salesAmount && !delta.cashCollected && !delta.creditSales && !delta.instapaySales) return;
  await trx
    .updateTable('van_sales_trips')
    .set({
      sales_amount: sql`sales_amount + ${delta.salesAmount}`,
      cash_collected: sql`cash_collected + ${delta.cashCollected}`,
      credit_sales: sql`credit_sales + ${delta.creditSales}`,
      total_instapay_sales: sql`total_instapay_sales + ${delta.instapaySales}`,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', tripId)
    .where('tenant_id', '=', tenantId)
    .execute();
}

export type SalesEditAndCancelDeps = {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  authz: SalesAuthorizationService;
  finance: SalesFinanceService;
  query: SalesQueryService;
  accountingPosting: AccountingPostingService;
  planFeatureService: PlanFeatureService;
  cashDrawerService?: CashDrawerService;
  logger: Logger;
  assertDiscountChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ) => Promise<void>;
  assertUnitPriceChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    providedPrice: number,
    allowedPrice: number,
    productId: number,
    managerPin?: string,
    saleId?: number,
  ) => Promise<void>;
  getTenantSettingsMap: (trx: Kysely<Database> | Transaction<Database>, tenantId: string) => Promise<Map<string, any>>;
  claimSaleSerials: (
    trx: Kysely<Database>,
    item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number,
    saleItemId: number,
    tenantId: string,
  ) => Promise<string[]>;
  releaseSaleSerials: (trx: Kysely<Database>, saleId: number, tenantId: string) => Promise<void>;
  resolveSaleModifierCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  loadFlatAddonCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ) => Promise<Map<number, number>>;
  enforceRestaurantModifierContract: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  autoProduceShortfall: (
    trx: Kysely<Database> | Transaction<Database>,
    items: {
      productId: number;
      requiredQty: number;
      availableQty: number;
      hasBOM?: boolean;
      bomId?: number;
      unitMultiplier?: number;
    }[],
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    scope: { tenantId: string; accountId: string },
    auth: AuthContext,
    visitedProductIds?: Set<number>,
    depth?: number,
  ) => Promise<void>;
  deductPharmacyBatchesFefo: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ) => Promise<void>;
  deductInventoryBatchesFefo: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ) => Promise<void>;
  restoreSalePharmacyBatches: (
    trx: Kysely<Database> | Transaction<Database>,
    saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string },
    removeAllocations: boolean,
  ) => Promise<void>;
  restoreSaleInventoryBatches: (
    trx: Kysely<Database> | Transaction<Database>,
    saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string },
    removeAllocations: boolean,
  ) => Promise<void>;
  recordImportLotShortfalls: (
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleLineId: number,
    allocation: {
      items: Array<{
        productId: number;
        requestedQty: number;
        allocatedQty: number;
        shortfallQty: number;
        fullyCovered: boolean;
        reason: string;
      }>;
    },
    auth: AuthContext,
  ) => Promise<void>;
  getAllowNegativeStockSales: (trx: Kysely<Database> | Transaction<Database>, tenantId: string) => Promise<boolean>;
  buildInsufficientStockError: (
    trx: Kysely<Database> | Transaction<Database>,
    params: {
      productId: number;
      productName: string;
      currentLocationId?: number | string | null;
      currentLocationName?: string;
      excludedLocationIds?: number[];
      currentAvailableQty: number;
      requiredQty: number;
      tenantId: string;
    },
  ) => Promise<AppError>;
  lockProductRow: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    scope: { tenantId: string; accountId: string },
  ) => Promise<void>;
  lockSaleStockRows: (
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ) => Promise<void>;
  getCurrentProductOffers: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    tenantId: string,
  ) => Promise<any[]>;
};
