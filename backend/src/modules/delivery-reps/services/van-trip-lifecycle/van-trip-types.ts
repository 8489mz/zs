/*
 * Trip lifecycle for van sales (split-1 out of VanSalesService).
 * Pure move: the trip start/load/settlement lifecycle methods, unchanged,
 * behind the VanSalesService delegating facade. The facade owns the shared
 * stock/auth helpers; this service receives them bound via
 * VanTripLifecycleDeps, so the moved bodies are byte-identical to the
 * originals.
 */
import { Kysely } from '../../../../database/kysely';
import { AuditService } from '../../../../core/audit/audit.service';
import { Database } from '../../../../database/database.types';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { VanFraudRadarService, RecordVanSuspicionParams } from '../van-fraud-radar.service';

export interface VanStockItem {
  productId: number;
  productName: string;
  barcode: string;
  qty: number;
  mainWarehouseQty?: number;
  costPrice: number;
  retailPrice: number;
  unitName?: string;
  originalPrice?: number;
  discountPerUnit?: number;
  hasActiveOffer?: boolean;
  offerBadge?: string;
  packagingUnit?: { name: string; multiplier: number };
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
  earliestExpiryDate?: string | null;
  batchNumber?: string | null;
  expiryStatus?: 'valid' | 'near_expiry' | 'expired' | 'no_expiry';
  daysToExpiry?: number | null;
}

export interface VanTripSummary {
  id: number;
  repId: number;
  repName: string;
  vehicleId?: number;
  vehiclePlate?: string;
  vehicleModel?: string;
  shiftName?: string;
  startOdometer?: number;
  endOdometer?: number;
  vanLocationId: number;
  vanLocationName: string;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  status: 'open' | 'settled' | string;
  settlementStatus?: 'open' | 'submitted_by_rep' | 'settled' | string;
  openedAt: string;
  closedAt?: string;
  submittedAt?: string;
  loadedAmount: number;
  salesAmount: number;
  cashCollected: number;
  creditSales: number;
  returnsAmount: number;
  cashRefunds?: number;
  variance: number;
  distanceKm?: number;
  stockVarianceAmount?: number;
  nightStockApproved?: boolean;
  totalInstapaySales?: number;
  totalInstapayCollections?: number;
  notes?: string;
}

export type VanTripLifecycleDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  getOrCreateVanLocation: (repId: number, tenantId: string, accountId: string) => Promise<{ id: number; name: string }>;
  sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  moveVanStock: (
    trx: Kysely<Database>,
    params: {
      productId: number;
      delta: number;
      locationId: number;
      branchId?: number | null;
      tenantId: string;
      accountId: string;
      userId?: number | null;
      movementType: string;
      note: string;
      referenceType: string;
      referenceId: number;
      skipGlobalUpdate: boolean;
      unitCost?: number;
    },
  ) => Promise<{ scopeBefore: number; scopeAfter: number }>;
  moveVanPharmacyBatches: (
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ) => Promise<number>;
  moveVanInventoryBatches: (
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ) => Promise<number>;
  deductVanSalePharmacyBatches: (
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed?: boolean,
  ) => Promise<Array<{ pharmacyBatchId: number; quantity: number }>>;
  deductVanSaleInventoryBatches: (
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed?: boolean,
  ) => Promise<Array<{ inventoryBatchId: number; quantity: number }>>;
  resolveSystemAuthContext: (tenantId: string, accountId: string, repId?: number | null) => Promise<AuthContext>;
  recordSuspicionEvent: (params: RecordVanSuspicionParams) => Promise<any>;
  listRepServedCustomerIds: (tenantId: string, repId: number) => Promise<Set<number>>;
  resolveRepLinkedUserId: (dbConn: any, tenantId: string, repId: number | null) => Promise<number | null>;
};
