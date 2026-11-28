import { Logger } from '@nestjs/common';
import { Kysely, type Transaction } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { TransactionHelper } from '../../../../database/helpers/transaction.helper';
import { AppError } from '../../../../common/errors/app-error';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { AuditService } from '../../../../core/audit/audit.service';
import { PlanFeatureService } from '../../../../core/auth/services/plan-feature.service';
import { ExchangeReturnPort, type ExchangeReturnContext } from '../../../../common/utils/exchange-return.port';
import { SalesAuthorizationService } from '../sales-authorization.service';
import { type AllocatedInvoiceLine } from '../../engines/invoice-discount.engine';
import { type AppliedSaleTender } from '../../engines/sale-tender.engine';
import {
  type NormalizedSalePayload,
  type SalesOrderConversionRelease,
  type UpsertSaleDto,
} from '../../dto/upsert-sale.dto';
import { SalesFinanceService } from '../sales-finance.service';
import { IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { type IdempotencyContext } from '../../../../core/idempotency/idempotency.context';
import { SalesQueryService } from '../sales-query.service';
import { WhatsAppGatewayService } from '../../../settings/services/whatsapp-gateway.service';
import type { SystemApprovedSaleTerms } from '../sales-write.service';
import type { PosTripAttribution } from './resolve-pos-trip-attribution';
import type {
  OfflinePriceDriftItem,
  OfflineStockShortfallItem,
} from '../../engines/pos-offline-sale.engine';

export type CreateSaleDeps = {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  authz: SalesAuthorizationService;
  finance: SalesFinanceService;
  query: SalesQueryService;
  accountingPosting: AccountingPostingService;
  idempotency: IdempotencyService;
  planFeatureService: PlanFeatureService;
  returnsService: ExchangeReturnPort;
  whatsappService: WhatsAppGatewayService | undefined;
  logger: Logger;
  transferKdsTicketStateInTrx: (
    trx: Transaction<Database>,
    tenantId: string,
    draftSaleId: number,
    postedSaleId: number,
  ) => Promise<void>;
  loadFlatAddonCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ) => Promise<Map<number, number>>;
  resolveSaleModifierCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  enforceRestaurantModifierContract: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  claimSaleSerials: (
    trx: Kysely<Database>,
    item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number,
    saleItemId: number,
    tenantId: string,
  ) => Promise<string[]>;
  lockSaleStockRows: (
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ) => Promise<void>;
  lockProductRow: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    scope: { tenantId: string; accountId: string },
  ) => Promise<void>;
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
  shouldLogCheckoutTimings: () => boolean;
  assertDiscountChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    requestedDiscount: number,
    managerPin?: string,
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
  getCurrentProductOffers: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    tenantId: string,
  ) => Promise<any[]>;
  getAllowNegativeStockSales: (trx: Kysely<Database> | Transaction<Database>, tenantId: string) => Promise<boolean>;
  getTenantSettingsMap: (trx: Kysely<Database> | Transaction<Database>, tenantId: string) => Promise<Map<string, any>>;
  autoProduceShortfall: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    scope: TenantScope,
    auth: AuthContext,
    visitedProductIds?: Set<number>,
    depth?: number,
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
  deductPharmacyBatchesFefo: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: any[],
    scope: TenantScope,
    saleId: number,
    saleLineId: number,
  ) => Promise<void>;
  deductInventoryBatchesFefo: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: any[],
    scope: TenantScope,
    saleId: number,
    saleLineId: number,
  ) => Promise<void>;
  resolveOnlineOrderTerms: (
    onlineOrderId: number,
    tenantId: string,
    existing?: SystemApprovedSaleTerms,
  ) => Promise<SystemApprovedSaleTerms | undefined>;
  refreshClosedShiftsForBackdatedOfflineSale: (
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ) => Promise<void>;
  generateSaleDocNo: (
    trx: Kysely<Database>,
    saleId: number,
    tenantId: string,
    businessDate?: Date | null,
  ) => Promise<string>;
};

export interface CreateSaleContext {
  // Inputs — set by the orchestrator, read-only for the phases.
  trx: Transaction<Database>;
  scope: TenantScope;
  payload: UpsertSaleDto;
  normalized: NormalizedSalePayload;
  auth: AuthContext;
  approvedTerms?: SystemApprovedSaleTerms;
  conversionRelease?: SalesOrderConversionRelease;
  idemCtx: IdempotencyContext | undefined;
  effectiveTerms?: SystemApprovedSaleTerms;
  returnedItems: UpsertSaleDto['items'];
  isExchange: boolean;
  // F7 (POS-to-trip attribution): the pre-transaction rep + active
  // trip candidate resolved by the orchestrator (null when the
  // seller is no rep or has no open trip). Phase 5 re-checks the
  // trip row under lock before stamping.
  vanTripAttribution: PosTripAttribution | null;
  // Phase 1 outputs (loadSaleContext).
  moneyDigits: MoneyDigits;
  exchange?: ExchangeReturnContext;
  onlineOrderToRelease: any;
  customer: any;
  branch: any;
  eligibleLocations: Array<{ id: number | null; branchId: number | null }>;
  allowNegativeStockSales: boolean;
  // Phase 2 outputs (prepareSaleItems).
  productMap: Map<number, any>;
  offersByProductId: Map<number, any>;
  bomNamesByBomId: Map<number, string[]>;
  stockRowsByProductId: Map<number, any>;
  subtotal: number;
  preparedItems: any[];
  autoProduceItems: any[];
  // Phase 3 outputs (computeTotalsAndGates).
  settingsMap: Map<string, any>;
  loyaltyEnabled: boolean;
  pointsPer100Egp: number;
  pointRedeemValue: number;
  minRedeemPoints: number;
  maxDiscountPercentage: number;
  effectiveDiscount: number;
  loyaltyDiscount: number;
  pointsAfterRedeem: number;
  taxAmount: number;
  total: number;
  itemOnlyTaxAmount: number;
  allocatedLines: AllocatedInvoiceLine[];
  allocationByItem: Map<any, AllocatedInvoiceLine>;
  belowFloorItems: number[];
  isAdminSeller: boolean;
  floorApproval: { mode: 'pin' | 'account' | 'bypass'; authorizedByName: string; authorizedById?: number } | null;
  collectibleTotal: number;
  // INV-VAN-PRICE-LIST-WIRING (F8): the system cash discount for
  // this sale, computed in Phase 3 and stored distinctly by Phase 5.
  systemCashDiscountAmount: number;
  // Phase 4 outputs (allocateTendersAndDelivery).
  payments: AppliedSaleTender[];
  paidAmount: number;
  remainingDebt: number;
  isDelivery: boolean;
  deliveryRepId: number | null;
  deliveryStatus: string | null;
  collectionStatus: string | null;
  resolvedDeliveryFeeMode: 'freelance_courier' | 'store_fleet';
  isCodDelivery: boolean;
  effectivePaymentType: 'cash' | 'credit';
  finalTenderedAmount: number;
  changeAmount: number;
  offlineDocNo: string;
  offlineCreatedAt: Date | null;
  posTerminalCode: string | null;
  isOfflineSyncSale?: boolean;
  offlineStockShortfalls?: OfflineStockShortfallItem[];
  offlinePriceDrifts?: OfflinePriceDriftItem[];
  // Phase 5 outputs (insertSaleAndStock).
  id: number;
  docNo: string;
}
