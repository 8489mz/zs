import { Kysely, type Transaction } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { UpsertSaleDto } from '../dto/upsert-sale.dto';
import { AdjustSalePaymentsDto } from '../dto/adjust-sale-payments.dto';
import { CancelSaleService } from './sales-edit-and-cancel/cancel-sale.service';
import { PreparedWasteAndShiftRefreshService } from './sales-edit-and-cancel/prepared-waste-and-shift-refresh.service';
import { AdjustSalePaymentsService } from './sales-edit-and-cancel/adjust-sale-payments.service';
import { UpdateSaleService } from './sales-edit-and-cancel/update-sale.service';
import { type SalesEditAndCancelDeps } from './sales-edit-and-cancel/sales-edit-and-cancel-types';

export class SalesEditAndCancelService {
  private readonly updateSaleService: UpdateSaleService;
  private readonly adjustSalePaymentsService: AdjustSalePaymentsService;
  private readonly preparedWasteAndShiftRefreshService: PreparedWasteAndShiftRefreshService;
  private readonly cancelSaleService: CancelSaleService;

  constructor(deps: SalesEditAndCancelDeps) {
    this.preparedWasteAndShiftRefreshService = new PreparedWasteAndShiftRefreshService(deps.cashDrawerService);
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
      this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale.bind(this.preparedWasteAndShiftRefreshService),
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
    this.adjustSalePaymentsService = new AdjustSalePaymentsService(
      deps.db,
      deps.tx,
      deps.audit,
      deps.authz,
      deps.finance,
      deps.query,
      deps.accountingPosting,
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
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
      this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale.bind(this.preparedWasteAndShiftRefreshService),
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.updateSaleService.updateSale(saleId, payload, auth);
  }

  async adjustSalePayments(
    saleId: number,
    payload: AdjustSalePaymentsDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
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
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftsForBackdatedOfflineSale(
      trx,
      offlineCreatedAt,
      saleId,
      branchId,
      locationId,
      auth,
      tenantId,
    );
  }

  private async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange(
      trx,
      shiftId,
      saleId,
      kind,
      reason,
      auth,
    );
  }

  async cancelSale(
    saleId: number,
    reason: string,
    managerPin: string,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.cancelSaleService.cancelSale(saleId, reason, managerPin, auth);
  }
}
