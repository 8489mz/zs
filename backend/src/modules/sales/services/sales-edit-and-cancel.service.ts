import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { UpsertSaleDto } from '../dto/upsert-sale.dto';
import { AdjustSalePaymentsDto } from '../dto/adjust-sale-payments.dto';
import { calculateCollectibleTotal, calculateRemainingDebt, calculateStoreCreditBalance, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, roundSaleResidual } from '../helpers/sales-write.helper';
import { assertSaleNotZatcaSigned } from '../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, tripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { formatCreditLimitExceededMessage } from './credit-limit-message';
import { SalesQueryService } from './sales-query.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { restoreImportLotsFromCancelledSale } from '../../import-sales/helpers/import-lot-allocation.helper';
import { CancelSaleService } from './sales-edit-and-cancel/cancel-sale.service';
import { PreparedWasteAndShiftRefreshService } from './sales-edit-and-cancel/prepared-waste-and-shift-refresh.service';
import { AdjustSalePaymentsService } from './sales-edit-and-cancel/adjust-sale-payments.service';
import { UpdateSaleService } from './sales-edit-and-cancel/update-sale.service';
import {
  applyTripCounterDelta,
  lockOpenTripRow,
  type SalesEditAndCancelDeps,
} from './sales-edit-and-cancel/sales-edit-and-cancel-types';




export class SalesEditAndCancelService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly authz: SalesAuthorizationService;
  private readonly finance: SalesFinanceService;
  private readonly query: SalesQueryService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly planFeatureService: PlanFeatureService;
  private readonly cashDrawerService?: CashDrawerService;
  private readonly logger: Logger;
  private readonly assertDiscountChangeAllowed: SalesEditAndCancelDeps['assertDiscountChangeAllowed'];
  private readonly assertUnitPriceChangeAllowed: SalesEditAndCancelDeps['assertUnitPriceChangeAllowed'];
  private readonly getTenantSettingsMap: SalesEditAndCancelDeps['getTenantSettingsMap'];
  private readonly claimSaleSerials: SalesEditAndCancelDeps['claimSaleSerials'];
  private readonly releaseSaleSerials: SalesEditAndCancelDeps['releaseSaleSerials'];
  private readonly resolveSaleModifierCosts: SalesEditAndCancelDeps['resolveSaleModifierCosts'];
  private readonly loadFlatAddonCosts: SalesEditAndCancelDeps['loadFlatAddonCosts'];
  private readonly enforceRestaurantModifierContract: SalesEditAndCancelDeps['enforceRestaurantModifierContract'];
  private readonly autoProduceShortfall: SalesEditAndCancelDeps['autoProduceShortfall'];
  private readonly deductPharmacyBatchesFefo: SalesEditAndCancelDeps['deductPharmacyBatchesFefo'];
  private readonly deductInventoryBatchesFefo: SalesEditAndCancelDeps['deductInventoryBatchesFefo'];
  private readonly restoreSalePharmacyBatches: SalesEditAndCancelDeps['restoreSalePharmacyBatches'];
  private readonly restoreSaleInventoryBatches: SalesEditAndCancelDeps['restoreSaleInventoryBatches'];
  private readonly recordImportLotShortfalls: SalesEditAndCancelDeps['recordImportLotShortfalls'];
  private readonly getAllowNegativeStockSales: SalesEditAndCancelDeps['getAllowNegativeStockSales'];
  private readonly buildInsufficientStockError: SalesEditAndCancelDeps['buildInsufficientStockError'];
  private readonly lockProductRow: SalesEditAndCancelDeps['lockProductRow'];
  private readonly lockSaleStockRows: SalesEditAndCancelDeps['lockSaleStockRows'];
  private readonly getCurrentProductOffers: SalesEditAndCancelDeps['getCurrentProductOffers'];
  private readonly updateSaleService: UpdateSaleService;
  private readonly adjustSalePaymentsService: AdjustSalePaymentsService;
  private readonly preparedWasteAndShiftRefreshService: PreparedWasteAndShiftRefreshService;
  private readonly cancelSaleService: CancelSaleService;

  constructor(deps: SalesEditAndCancelDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.authz = deps.authz;
    this.finance = deps.finance;
    this.query = deps.query;
    this.accountingPosting = deps.accountingPosting;
    this.planFeatureService = deps.planFeatureService;
    this.cashDrawerService = deps.cashDrawerService;
    this.logger = deps.logger;
    this.assertDiscountChangeAllowed = deps.assertDiscountChangeAllowed;
    this.assertUnitPriceChangeAllowed = deps.assertUnitPriceChangeAllowed;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.claimSaleSerials = deps.claimSaleSerials;
    this.releaseSaleSerials = deps.releaseSaleSerials;
    this.resolveSaleModifierCosts = deps.resolveSaleModifierCosts;
    this.loadFlatAddonCosts = deps.loadFlatAddonCosts;
    this.enforceRestaurantModifierContract = deps.enforceRestaurantModifierContract;
    this.autoProduceShortfall = deps.autoProduceShortfall;
    this.deductPharmacyBatchesFefo = deps.deductPharmacyBatchesFefo;
    this.deductInventoryBatchesFefo = deps.deductInventoryBatchesFefo;
    this.restoreSalePharmacyBatches = deps.restoreSalePharmacyBatches;
    this.restoreSaleInventoryBatches = deps.restoreSaleInventoryBatches;
    this.recordImportLotShortfalls = deps.recordImportLotShortfalls;
    this.getAllowNegativeStockSales = deps.getAllowNegativeStockSales;
    this.buildInsufficientStockError = deps.buildInsufficientStockError;
    this.lockProductRow = deps.lockProductRow;
    this.lockSaleStockRows = deps.lockSaleStockRows;
    this.getCurrentProductOffers = deps.getCurrentProductOffers;
    this.updateSaleService = new UpdateSaleService(
      deps.db,
      deps.tx,
      deps.audit,
      deps.authz,
      deps.finance,
      deps.query,
      deps.accountingPosting,
      deps.planFeatureService,
      deps.assertDiscountChangeAllowed,
      deps.assertUnitPriceChangeAllowed,
      deps.getTenantSettingsMap,
      deps.claimSaleSerials,
      deps.releaseSaleSerials,
      deps.resolveSaleModifierCosts,
      deps.loadFlatAddonCosts,
      deps.enforceRestaurantModifierContract,
      deps.autoProduceShortfall,
      deps.deductPharmacyBatchesFefo,
      deps.deductInventoryBatchesFefo,
      deps.restoreSalePharmacyBatches,
      deps.restoreSaleInventoryBatches,
      deps.recordImportLotShortfalls,
      deps.getAllowNegativeStockSales,
      deps.buildInsufficientStockError,
      deps.lockProductRow,
      deps.lockSaleStockRows,
      deps.getCurrentProductOffers,
      this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
    this.adjustSalePaymentsService = new AdjustSalePaymentsService(deps.db, deps.tx, deps.audit, deps.authz, deps.finance, deps.query, deps.accountingPosting, this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(this.preparedWasteAndShiftRefreshService));
    this.preparedWasteAndShiftRefreshService = new PreparedWasteAndShiftRefreshService(deps.cashDrawerService);
    this.cancelSaleService = new CancelSaleService(
      deps.db,
      deps.tx,
      deps.audit,
      deps.authz,
      deps.finance,
      deps.query,
      deps.accountingPosting,
      deps.logger,
      deps.releaseSaleSerials,
      deps.restoreSalePharmacyBatches,
      deps.restoreSaleInventoryBatches,
      deps.lockSaleStockRows,
      this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.updateSaleService.updateSale(saleId, payload, auth);
  }

  async adjustSalePayments(saleId: number, payload: AdjustSalePaymentsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.adjustSalePaymentsService.adjustSalePayments(saleId, payload, auth);
  }

  private async detectPreparedWasteSale(
    trx: Kysely<Database>,
    sale: { id: number; order_type?: string | null; created_at?: Date | string | null },
    tenantId: string,
  ): Promise<boolean> {
    return this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale(trx, sale, tenantId);
  }

  async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftsForBackdatedOfflineSale(trx, offlineCreatedAt, saleId, branchId, locationId, auth, tenantId);
  }

  private async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange(trx, shiftId, saleId, kind, reason, auth);
  }

  async cancelSale(saleId: number, reason: string, managerPin: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.cancelSaleService.cancelSale(saleId, reason, managerPin, auth);
  }
}
