import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { DeliveryRepsService } from './delivery-reps.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { FLEET_VEHICLE_STATUSES } from './services/van-common.util';
import { VanFleetService } from './services/van-fleet.service';
import { VanRequisitionsService } from './services/van-requisitions.service';
import { VanReturnsService } from './services/van-returns.service';
import { VanTargetsService } from './services/van-targets.service';
import { VanTransfersService } from './services/van-transfers.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFraudRadarService, RecordVanSuspicionParams } from './services/van-fraud-radar.service';
import { VanCollectionsAndSwapsService } from './services/van-collections-and-swaps.service';
import { VanFieldSalesService } from './services/van-field-sales.service';
import { VanTripLifecycleService, type VanStockItem, type VanTripSummary } from './services/van-trip-lifecycle.service';
import { VanRepFinancialLedgerService } from './services/van-rep-financial-ledger.service';
import { VanExpensesPackagingCustomersService } from './services/van-expenses-packaging-customers.service';
import { VanRepEmployeeLinkService } from './services/van-rep-employee-link.service';
import { VanRequisitionDispatchService } from './services/van-requisition-dispatch.service';

import { StockBatchHelpersService } from './van-sales/stock-batch-helpers';
import type {
  GetFraudRadarEventsOptions,
  VerifySupervisorPinResult,
  MoveVanStockParams,
  GetActiveTripResult,
  OpenTripAndLoadPayload,
  LoadSupplementaryStockToActiveTripPayload,
  ExecuteFieldSalePayload,
  ExecuteFieldSaleResult,
  ExecuteFieldSaleInternalPayload,
  RecordFieldCollectionPayload,
  RecordFieldCollectionInternalPayload,
  ExecuteDamagedSwapPayload,
  ExecuteDamagedSwapResult,
  SubmitTripSettlementPayload,
  SubmitTripSettlementResult,
  SettleTripPayload,
  SettleTripResult,
  ListDriverSalesFilters,
  CreateFleetVehiclePayload,
  UpdateFleetVehiclePayload,
  RecordFuelLogPayload,
  RecordOilChangePayload,
  AssignVehicleDriverPayload,
  SubmitLoadRequisitionPayload,
  CreateLoadRequisitionByAdminPayload,
  SubmitFieldReturnPayload,
  SetRepTargetCommissionRates,
  SaveCommissionConfigPayload,
  SettleRepCommissionPayload,
  CreateInterVanTransferPayload,
  RecordFieldVisitPayload,
  SetCustomerRouteSchedulePayload,
  BulkAssignCustomerRoutesPayload,
  GetSupervisorCustomerRoutesFilters,
  RecordTripExpensePayload,
  RecordPackagingMovementPayload,
  CreateDriverCustomerBody,
  GetRepFinancialLedgerFilters,
  SettleRepFinancialItemPayload,
  PushRepShortagesToPayrollPayload,
  AddRepBonusOrCommissionPayload,
} from './van-sales/van-sales-types';
import { AuthAndPinService } from './van-sales/auth-and-pin';
import { FieldSaleService } from './van-sales/field-sale';
import { FieldCollectionService } from './van-sales/field-collection';
import { TripDelegatesService } from './van-sales/trip-delegates';
import { FleetService } from './van-sales/fleet';
import { RequisitionsService } from './van-sales/requisitions';
import { ReturnsService } from './van-sales/returns';
import { TargetsService } from './van-sales/targets';
import { TransfersService } from './van-sales/transfers';
import { RoutesService } from './van-sales/routes';
import { ExpensesPackagingCustomersService } from './van-sales/expenses-packaging-customers';
import { RepFinancialLedgerService } from './van-sales/rep-financial-ledger';
import { RepEmployeeLinkService } from './van-sales/rep-employee-link';
import { FraudRadarService } from './van-sales/fraud-radar';
export type { VanStockItem, VanTripSummary };

@Injectable()
export class VanSalesService {
  static readonly FLEET_VEHICLE_STATUSES = FLEET_VEHICLE_STATUSES;

  private static readonly inFlightSalePromises = new Map<string, Promise<any>>();
  private static readonly recentSalesCache = new Map<string, { result: any; timestamp: number }>();
  private static readonly inFlightCollectionPromises = new Map<string, Promise<any>>();
  private static readonly recentCollectionsCache = new Map<string, { result: any; timestamp: number }>();

  private readonly vanFleetService: VanFleetService;
  private readonly vanRequisitionsService: VanRequisitionsService;
  private readonly vanReturnsService: VanReturnsService;
  private readonly vanTargetsService: VanTargetsService;
  private readonly vanTransfersService: VanTransfersService;
  private readonly vanRoutesService: VanRoutesService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private collectionsAndSwaps: VanCollectionsAndSwapsService | undefined;
  private fieldSales: VanFieldSalesService | undefined;
  private tripLifecycle: VanTripLifecycleService | undefined;
  private repFinancialLedger: VanRepFinancialLedgerService | undefined;
  private expensesPackagingCustomers: VanExpensesPackagingCustomersService | undefined;
  private repEmployeeLink: VanRepEmployeeLinkService | undefined;
  private requisitionDispatch: VanRequisitionDispatchService | undefined;
  // Slice services are LAZY (first-call construction), like the 7 service
  // getters above: specs build this class with Object.create (no ctor),
  // so a delegate must still work when the ctor never ran. Eager ctor
  // construction broke openTripAndLoad / createLoadRequisitionByAdmin /
  // pushRepShortagesToPayroll for those specs (slice field undefined).
  private stockBatchHelpersInstance?: StockBatchHelpersService;
  private get stockBatchHelpers(): StockBatchHelpersService {
    if (!this.stockBatchHelpersInstance) {
      this.stockBatchHelpersInstance = new StockBatchHelpersService(this.db);
    }
    return this.stockBatchHelpersInstance;
  }
  private authAndPinInstance?: AuthAndPinService;
  private get authAndPin(): AuthAndPinService {
    if (!this.authAndPinInstance) {
      this.authAndPinInstance = new AuthAndPinService(this.db, this.getTripLifecycle.bind(this));
    }
    return this.authAndPinInstance;
  }
  private fieldSaleInstance?: FieldSaleService;
  private get fieldSale(): FieldSaleService {
    if (!this.fieldSaleInstance) {
      this.fieldSaleInstance = new FieldSaleService(
        this.db,
        this.getFieldSales.bind(this),
        VanSalesService.inFlightSalePromises,
        VanSalesService.recentSalesCache,
        () => this.executeFieldSaleInternal.bind(this),
      );
    }
    return this.fieldSaleInstance;
  }
  private fieldCollectionInstance?: FieldCollectionService;
  private get fieldCollection(): FieldCollectionService {
    if (!this.fieldCollectionInstance) {
      this.fieldCollectionInstance = new FieldCollectionService(
        this.db,
        this.getCollectionsAndSwaps.bind(this),
        VanSalesService.inFlightCollectionPromises,
        VanSalesService.recentCollectionsCache,
        () => this.recordFieldCollectionInternal.bind(this),
      );
    }
    return this.fieldCollectionInstance;
  }
  private tripDelegatesInstance?: TripDelegatesService;
  private get tripDelegates(): TripDelegatesService {
    if (!this.tripDelegatesInstance) {
      this.tripDelegatesInstance = new TripDelegatesService(
        this.getTripLifecycle.bind(this),
        this.getFieldSales.bind(this),
      );
    }
    return this.tripDelegatesInstance;
  }
  private fleetInstance?: FleetService;
  private get fleet(): FleetService {
    if (!this.fleetInstance) {
      this.fleetInstance = new FleetService(this.vanFleetService);
    }
    return this.fleetInstance;
  }
  private requisitionsInstance?: RequisitionsService;
  private get requisitions(): RequisitionsService {
    if (!this.requisitionsInstance) {
      this.requisitionsInstance = new RequisitionsService(
        this.getRequisitionDispatch.bind(this),
        this.vanRequisitionsService,
      );
    }
    return this.requisitionsInstance;
  }
  private returnsInstance?: ReturnsService;
  private get returns(): ReturnsService {
    if (!this.returnsInstance) {
      this.returnsInstance = new ReturnsService(this.vanReturnsService);
    }
    return this.returnsInstance;
  }
  private targetsInstance?: TargetsService;
  private get targets(): TargetsService {
    if (!this.targetsInstance) {
      this.targetsInstance = new TargetsService(this.vanTargetsService);
    }
    return this.targetsInstance;
  }
  private transfersInstance?: TransfersService;
  private get transfers(): TransfersService {
    if (!this.transfersInstance) {
      this.transfersInstance = new TransfersService(this.vanTransfersService);
    }
    return this.transfersInstance;
  }
  private routesInstance?: RoutesService;
  private get routes(): RoutesService {
    if (!this.routesInstance) {
      this.routesInstance = new RoutesService(this.vanRoutesService);
    }
    return this.routesInstance;
  }
  private expensesPackagingCustomersSliceInstance?: ExpensesPackagingCustomersService;
  private get expensesPackagingCustomersSlice(): ExpensesPackagingCustomersService {
    if (!this.expensesPackagingCustomersSliceInstance) {
      this.expensesPackagingCustomersSliceInstance = new ExpensesPackagingCustomersService(
        this.getExpensesPackagingCustomers.bind(this),
      );
    }
    return this.expensesPackagingCustomersSliceInstance;
  }
  private repFinancialLedgerSliceInstance?: RepFinancialLedgerService;
  private get repFinancialLedgerSlice(): RepFinancialLedgerService {
    if (!this.repFinancialLedgerSliceInstance) {
      this.repFinancialLedgerSliceInstance = new RepFinancialLedgerService(
        this.getRepFinancialLedgerService.bind(this),
      );
    }
    return this.repFinancialLedgerSliceInstance;
  }
  private repEmployeeLinkSliceInstance?: RepEmployeeLinkService;
  private get repEmployeeLinkSlice(): RepEmployeeLinkService {
    if (!this.repEmployeeLinkSliceInstance) {
      this.repEmployeeLinkSliceInstance = new RepEmployeeLinkService(this.getRepEmployeeLink.bind(this));
    }
    return this.repEmployeeLinkSliceInstance;
  }
  private fraudRadarInstance?: FraudRadarService;
  private get fraudRadar(): FraudRadarService {
    if (!this.fraudRadarInstance) {
      this.fraudRadarInstance = new FraudRadarService(this.vanFraudRadarService);
    }
    return this.fraudRadarInstance;
  }

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly deliveryRepsService: DeliveryRepsService,
    private readonly accountingPosting: AccountingPostingService,
    vanFleetService?: VanFleetService,
    vanRequisitionsService?: VanRequisitionsService,
    vanReturnsService?: VanReturnsService,
    vanTargetsService?: VanTargetsService,
    vanTransfersService?: VanTransfersService,
    vanRoutesService?: VanRoutesService,
    vanFraudRadarService?: VanFraudRadarService,
  ) {
    this.vanFraudRadarService = vanFraudRadarService ?? new VanFraudRadarService(db);
    this.vanFleetService = vanFleetService ?? new VanFleetService(db);
    this.vanRequisitionsService = vanRequisitionsService ?? new VanRequisitionsService(db);
    this.vanReturnsService =
      vanReturnsService ?? new VanReturnsService(db, accountingPosting, this.vanFraudRadarService, this.audit);
    this.vanTargetsService = vanTargetsService ?? new VanTargetsService(db);
    this.vanTransfersService = vanTransfersService ?? new VanTransfersService(db, this.audit);
    this.vanRoutesService =
      vanRoutesService ?? new VanRoutesService(db, this.vanFleetService, this.vanFraudRadarService);
    this.tripLifecycle = this.getTripLifecycle();
    this.getCollectionsAndSwaps();
  }

  private getCollectionsAndSwaps(): VanCollectionsAndSwapsService {
    if (!this.collectionsAndSwaps) {
      this.collectionsAndSwaps = new VanCollectionsAndSwapsService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService ?? new VanFraudRadarService(this.db),
        generateDailySequenceNumber: this.generateDailySequenceNumber.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
      });
    }
    return this.collectionsAndSwaps;
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getFieldSales() — an eager bind would freeze the
  // REAL facade methods before specs can mock them. Nine specs mock
  // resolveSystemAuthContext on the instance AFTER construction
  // (book-digits, tax-optional, wholesale-price, dedup-key,
  // noncash-evidence, fefo-batches, shared-offer, rep-permission-flags-h9,
  // van-visits-tracking-collections) and tax-optional also mocks
  // verifySupervisorPin. The accessor binds on first delegate call, after
  // any mock is assigned, so Object.create specs (no ctor) and
  // new-constructed specs (mock after ctor) both work. Production is
  // unaffected: Nest never monkey-patches, and the helper is stateless,
  // so first-call construction is behaviorally identical to ctor
  // construction.
  private getFieldSales(): VanFieldSalesService {
    if (!this.fieldSales) {
      this.fieldSales = new VanFieldSalesService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService,
        deductVanSalePharmacyBatches: this.deductVanSalePharmacyBatches.bind(this),
        deductVanSaleInventoryBatches: this.deductVanSaleInventoryBatches.bind(this),
        generateDailySequenceNumber: this.generateDailySequenceNumber.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        sortItemsByProductId: this.sortItemsByProductId.bind(this),
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
        assertRepRouteForSale: this.assertRepRouteForSale.bind(this),
      });
    }
    return this.fieldSales;
  }

  private getTripLifecycle(): VanTripLifecycleService {
    if (!this.tripLifecycle) {
      this.tripLifecycle = new VanTripLifecycleService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService ?? new VanFraudRadarService(this.db),
        getOrCreateVanLocation: this.getOrCreateVanLocation.bind(this),
        sortItemsByProductId: this.sortItemsByProductId.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
        moveVanPharmacyBatches: this.moveVanPharmacyBatches.bind(this),
        moveVanInventoryBatches: this.moveVanInventoryBatches.bind(this),
        deductVanSalePharmacyBatches: this.deductVanSalePharmacyBatches.bind(this),
        deductVanSaleInventoryBatches: this.deductVanSaleInventoryBatches.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        listRepServedCustomerIds: this.listRepServedCustomerIds.bind(this),
        resolveRepLinkedUserId: this.resolveRepLinkedUserId.bind(this),
      });
    }
    return this.tripLifecycle;
  }

  // Lazy accessor (sales-write S2 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRepFinancialLedgerService() — an eager bind
  // would freeze the REAL verifySupervisorPin before specs can mock
  // it. The waiver gate (assertRepWaiverApproval) verifies a
  // supervisor PIN above the threshold, and specs mock
  // verifySupervisorPin on the instance AFTER construction. The
  // accessor binds on first delegate call, after any mock is
  // assigned, so Object.create specs (no ctor) and new-constructed
  // specs (mock after ctor) both work. Named
  // getRepFinancialLedgerService() because getRepFinancialLedger()
  // itself is a delegate method name on this class.
  private getRepFinancialLedgerService(): VanRepFinancialLedgerService {
    if (!this.repFinancialLedger) {
      this.repFinancialLedger = new VanRepFinancialLedgerService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
      });
    }
    return this.repFinancialLedger;
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getExpensesPackagingCustomers() — an eager bind would
  // freeze the REAL verifySupervisorPin before specs can mock it
  // post-construction (van-field-sale-tax-optional mocks it). The accessor
  // binds on first delegate call, after any mock is assigned, so
  // Object.create specs (no ctor) and new-constructed specs (mock after
  // ctor) both work. Production is unaffected: Nest never monkey-patches,
  // and the helper is stateless, so first-call construction is
  // behaviorally identical to ctor construction.
  private getExpensesPackagingCustomers(): VanExpensesPackagingCustomersService {
    if (!this.expensesPackagingCustomers) {
      this.expensesPackagingCustomers = new VanExpensesPackagingCustomersService({
        db: this.db,
        audit: this.audit,
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        assertTripOwnedByRep: this.assertTripOwnedByRep.bind(this),
        assertRepServedCustomer: this.assertRepServedCustomer.bind(this),
        getOrCreateVanLocation: this.getOrCreateVanLocation.bind(this),
        resolveRepLinkedUserId: this.resolveRepLinkedUserId.bind(this),
      });
    }
    return this.expensesPackagingCustomers;
  }

  // Lazy accessor (sales-write S2 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRequisitionDispatch() — an eager bind would
  // freeze the REAL approveAndDispatchRequisition before specs can
  // mock it post-construction (driver-requisition-dto-whitelist case
  // (d) mocks it on the facade instance). The accessor binds on first
  // delegate call, after any mock is assigned, so Object.create specs
  // (no ctor) and new-constructed specs (mock after ctor) both work.
  // Production is unaffected: Nest never monkey-patches, and the
  // helper is stateless, so first-call construction is behaviorally
  // identical to ctor construction.
  private getRequisitionDispatch(): VanRequisitionDispatchService {
    if (!this.requisitionDispatch) {
      this.requisitionDispatch = new VanRequisitionDispatchService({
        db: this.db,
        vanRequisitionsService: this.vanRequisitionsService,
        submitLoadRequisition: this.submitLoadRequisition.bind(this),
        dispatchRequisition: this.approveAndDispatchRequisition.bind(this),
        loadSupplementaryStockToActiveTrip: this.loadSupplementaryStockToActiveTrip.bind(this),
        openTripAndLoad: this.openTripAndLoad.bind(this),
      });
    }
    return this.requisitionDispatch;
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRepEmployeeLink() — Object.create specs drive
  // facade methods with no constructor, and the accessor binds on first
  // delegate call, after any mock is assigned, so Object.create specs
  // (no ctor) and new-constructed specs (mock after ctor) both work.
  // The moved methods use only this.anyDb, so no facade helper is
  // bound here and no post-construction mock can be frozen.
  private getRepEmployeeLink(): VanRepEmployeeLinkService {
    if (!this.repEmployeeLink) {
      this.repEmployeeLink = new VanRepEmployeeLinkService({
        db: this.db,
      });
    }
    return this.repEmployeeLink;
  }

  async recordSuspicionEvent(params: RecordVanSuspicionParams) {
    return this.fraudRadar.recordSuspicionEvent(params);
  }

  async getFraudRadarSummary(tenantId: string, options?: { days?: number; repId?: number }) {
    return this.fraudRadar.getFraudRadarSummary(tenantId, options);
  }

  async getFraudRadarEvents(tenantId: string, options?: GetFraudRadarEventsOptions) {
    return this.fraudRadar.getFraudRadarEvents(tenantId, options);
  }

  private get anyDb(): any {
    return this.db;
  }

  private async resolveSystemAuthContext(
    tenantId: string,
    accountId: string,
    repId?: number | null,
  ): Promise<AuthContext> {
    return this.authAndPin.resolveSystemAuthContext(tenantId, accountId, repId);
  }

  async verifySupervisorPin(
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ): Promise<VerifySupervisorPinResult> {
    return this.authAndPin.verifySupervisorPin(tenantId, pinInput, repId, queryable, accountId);
  }

  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    return this.authAndPin.isSupervisorPinRequiredForSettlement(tenantId);
  }

  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    return this.authAndPin.isBlindSettlementEnabled(tenantId);
  }

  private sortItemsByProductId<T extends { productId: number }>(items: T[]): T[] {
    return this.stockBatchHelpers.sortItemsByProductId(items);
  }

  private async moveVanStock(
    trx: Kysely<Database>,
    params: MoveVanStockParams,
  ): Promise<{ scopeBefore: number; scopeAfter: number }> {
    return this.stockBatchHelpers.moveVanStock(trx, params);
  }

  private async moveVanPharmacyBatches(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ): Promise<number> {
    return this.stockBatchHelpers.moveVanPharmacyBatches(trx, scope, productId, qty, fromLocationId, toLocationId);
  }

  private async deductVanSalePharmacyBatches(
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed = true,
  ): Promise<Array<{ pharmacyBatchId: number; quantity: number }>> {
    return this.stockBatchHelpers.deductVanSalePharmacyBatches(trx, productId, qty, scope, vanLocationId, failClosed);
  }

  private async moveVanInventoryBatches(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ): Promise<number> {
    return this.stockBatchHelpers.moveVanInventoryBatches(trx, scope, productId, qty, fromLocationId, toLocationId);
  }

  private async deductVanSaleInventoryBatches(
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed = true,
  ): Promise<Array<{ inventoryBatchId: number; quantity: number }>> {
    return this.stockBatchHelpers.deductVanSaleInventoryBatches(trx, productId, qty, scope, vanLocationId, failClosed);
  }

  async getOrCreateVanLocation(
    repId: number,
    tenantId: string,
    accountId: string,
  ): Promise<{ id: number; name: string }> {
    return this.stockBatchHelpers.getOrCreateVanLocation(repId, tenantId, accountId);
  }

  private async generateDailySequenceNumber(
    trxOrDb: any,
    tableName: string,
    columnName: string,
    prefix: string,
    tenantId: string,
    date = new Date(),
  ): Promise<string> {
    return this.stockBatchHelpers.generateDailySequenceNumber(trxOrDb, tableName, columnName, prefix, tenantId, date);
  }

  async getActiveTrip(repId: number, tenantId: string, accountId: string): Promise<GetActiveTripResult> {
    return this.tripDelegates.getActiveTrip(repId, tenantId, accountId);
  }

  async openTripAndLoad(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: OpenTripAndLoadPayload,
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.tripDelegates.openTripAndLoad(repId, tenantId, accountId, payload);
  }

  async loadSupplementaryStockToActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    tripId: number,
    payload: LoadSupplementaryStockToActiveTripPayload,
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.tripDelegates.loadSupplementaryStockToActiveTrip(repId, tenantId, accountId, tripId, payload);
  }

  async executeFieldSale(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteFieldSalePayload,
  ): Promise<ExecuteFieldSaleResult> {
    return this.fieldSale.executeFieldSale(repId, tenantId, accountId, payload);
  }

  private async executeFieldSaleInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteFieldSaleInternalPayload,
  ) {
    return this.fieldSale.executeFieldSaleInternal(repId, tenantId, accountId, payload);
  }

  async recordFieldCollection(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordFieldCollectionPayload,
  ): Promise<{
    ok: boolean;
    receiptNo: string;
    amount: number;
    customerName: string;
    previousBalance: number;
    newBalance: number;
  }> {
    return this.fieldCollection.recordFieldCollection(repId, tenantId, accountId, payload);
  }

  private async recordFieldCollectionInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordFieldCollectionInternalPayload,
  ) {
    return this.fieldCollection.recordFieldCollectionInternal(repId, tenantId, accountId, payload);
  }

  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteDamagedSwapPayload,
  ): Promise<ExecuteDamagedSwapResult> {
    return this.fieldCollection.executeDamagedSwap(repId, tenantId, accountId, payload);
  }

  private async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    return this.fieldCollection.assertTripOwnedByRep(tenantId, tripId, repId);
  }

  private async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    return this.fieldCollection.listRepServedCustomerIds(tenantId, repId);
  }

  private async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.fieldCollection.assertRepServedCustomer(tenantId, repId, customerId);
  }

  private async listCustomerServingRepIds(tenantId: string, customerId: number): Promise<Set<number>> {
    return this.fieldCollection.listCustomerServingRepIds(tenantId, customerId);
  }

  private async assertRepRouteForSale(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.fieldCollection.assertRepRouteForSale(tenantId, repId, customerId);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    return this.fieldCollection.listTripDamagedSwaps(tenantId, tripId, repId);
  }

  // recordFieldReturn (the original immediate, unapproved return path) was removed: it wrote stock
  // and the customer's ledger straight away with no review step at all, while submitFieldReturn below
  // parks the same action at status='pending_approval' until a manager calls approveFieldReturn. Both
  // were reachable from the driver portal at once — POST /returns bypassed the approval gate entirely,
  // so a driver (or a stale app build) could still skip it completely. Removed rather than kept
  // alongside, since the whole point of the approval workflow is that no return posts unreviewed.

  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SubmitTripSettlementPayload,
  ): Promise<SubmitTripSettlementResult> {
    return this.tripDelegates.submitTripSettlement(repId, tenantId, accountId, payload);
  }

  async settleTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SettleTripPayload,
    authContext?: AuthContext,
  ): Promise<SettleTripResult> {
    return this.tripDelegates.settleTrip(repId, tenantId, accountId, payload, authContext);
  }

  async getTripDueByDay(repId: number, tenantId: string, tripId: number) {
    return this.tripDelegates.getTripDueByDay(repId, tenantId, tripId);
  }

  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    return this.tripDelegates.listTripsForAdmin(tenantId, filters);
  }

  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    return this.tripDelegates.getTripDetailsForAdmin(tenantId, tripId, pagination);
  }

  async listDriverSales(tenantId: string, repId: number, filters?: ListDriverSalesFilters) {
    return this.tripDelegates.listDriverSales(tenantId, repId, filters);
  }

  async listFleetVehicles(tenantId: string) {
    return this.fleet.listFleetVehicles(tenantId);
  }

  async createFleetVehicle(tenantId: string, accountId: string, payload: CreateFleetVehiclePayload) {
    return this.fleet.createFleetVehicle(tenantId, accountId, payload);
  }

  async updateFleetVehicle(tenantId: string, accountId: string, id: number, payload: UpdateFleetVehiclePayload) {
    return this.fleet.updateFleetVehicle(tenantId, accountId, id, payload);
  }

  async assignVehicleRep(tenantId: string, vehicleId: number, repId: number | null, shiftName?: string) {
    return this.fleet.assignVehicleRep(tenantId, vehicleId, repId, shiftName);
  }

  async recordFuelLog(tenantId: string, accountId: string, repId: number | null, payload: RecordFuelLogPayload) {
    return this.fleet.recordFuelLog(tenantId, accountId, repId, payload);
  }

  async listFuelLogs(
    tenantId: string,
    filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string },
  ) {
    return this.fleet.listFuelLogs(tenantId, filters);
  }

  async recordOilChange(tenantId: string, accountId: string, repId: number | null, payload: RecordOilChangePayload) {
    return this.fleet.recordOilChange(tenantId, accountId, repId, payload);
  }

  async listOilChanges(tenantId: string, vehicleId?: number) {
    return this.fleet.listOilChanges(tenantId, vehicleId);
  }

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    return this.fleet.getFleetMaintenanceAlerts(tenantId, vehicleId, repId);
  }

  async listVehicleDrivers(tenantId: string, vehicleId: number) {
    return this.fleet.listVehicleDrivers(tenantId, vehicleId);
  }

  async assignVehicleDriver(tenantId: string, accountId: string, payload: AssignVehicleDriverPayload) {
    return this.fleet.assignVehicleDriver(tenantId, accountId, payload);
  }

  async removeVehicleDriver(tenantId: string, assignmentId: number) {
    return this.fleet.removeVehicleDriver(tenantId, assignmentId);
  }

  async submitLoadRequisition(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SubmitLoadRequisitionPayload,
  ) {
    return this.requisitions.submitLoadRequisition(repId, tenantId, accountId, payload);
  }

  async createLoadRequisitionByAdmin(
    tenantId: string,
    accountId: string,
    userId: number,
    payload: CreateLoadRequisitionByAdminPayload,
  ) {
    return this.requisitions.createLoadRequisitionByAdmin(tenantId, accountId, userId, payload);
  }

  async listLoadRequisitions(tenantId: string, filters: { status?: string; repId?: number } = {}) {
    return this.requisitions.listLoadRequisitions(tenantId, filters);
  }

  async reviewLoadRequisition(
    tenantId: string,
    requisitionId: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) {
    return this.requisitions.reviewLoadRequisition(tenantId, requisitionId, approvedItems, notes, sourceWarehouseId);
  }

  async approveAndDispatchRequisition(
    tenantId: string,
    accountId: string,
    requisitionId: number,
    reviewedByUserId: number,
  ) {
    return this.requisitions.approveAndDispatchRequisition(tenantId, accountId, requisitionId, reviewedByUserId);
  }

  async rejectLoadRequisition(
    tenantId: string,
    requisitionId: number,
    rejectionReason: string,
    reviewedByUserId: number,
  ) {
    return this.requisitions.rejectLoadRequisition(tenantId, requisitionId, rejectionReason, reviewedByUserId);
  }

  async deleteLoadRequisition(tenantId: string, requisitionId: number) {
    return this.requisitions.deleteLoadRequisition(tenantId, requisitionId);
  }

  async cancelLoadRequisitionByDriver(tenantId: string, repId: number, requisitionId: number) {
    return this.requisitions.cancelLoadRequisitionByDriver(tenantId, repId, requisitionId);
  }

  async getDriverWarehouses(tenantId: string, repId?: number) {
    return this.requisitions.getDriverWarehouses(tenantId, repId);
  }

  async getDriverAvailableProducts(tenantId: string, warehouseId?: number, repId?: number) {
    return this.requisitions.getDriverAvailableProducts(tenantId, warehouseId, repId);
  }

  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
    return this.returns.getCustomerEligibleSales(tenantId, customerId, repId);
  }

  async submitFieldReturn(repId: number, tenantId: string, accountId: string, payload: SubmitFieldReturnPayload) {
    return this.returns.submitFieldReturn(repId, tenantId, accountId, payload);
  }

  async listFieldReturns(
    tenantId: string,
    filters: { status?: string; repId?: number; tripId?: number; customerId?: number } = {},
  ) {
    return this.returns.listFieldReturns(tenantId, filters);
  }

  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.returns.approveFieldReturn(tenantId, accountId, returnId, approvedByUserId);
  }

  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    return this.returns.rejectFieldReturn(tenantId, returnId, rejectionReason, rejectedByUserId);
  }

  async setRepTarget(
    tenantId: string,
    accountId: string,
    repId: number,
    periodMonth: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: SetRepTargetCommissionRates,
  ) {
    return this.targets.setRepTarget(
      tenantId,
      accountId,
      repId,
      periodMonth,
      targetAmount,
      collectionTarget,
      visitsTarget,
      commissionRates,
    );
  }

  async getRepTarget(tenantId: string, repId: number, periodMonth?: string) {
    return this.targets.getRepTarget(tenantId, repId, periodMonth);
  }

  async listAllRepTargets(tenantId: string, periodMonth?: string) {
    return this.targets.listAllRepTargets(tenantId, periodMonth);
  }

  async getCommissionConfig(tenantId: string) {
    return this.targets.getCommissionConfig(tenantId);
  }

  async saveCommissionConfig(tenantId: string, accountId: string, payload: SaveCommissionConfigPayload) {
    return this.targets.saveCommissionConfig(tenantId, accountId, payload);
  }

  async settleRepCommission(
    tenantId: string,
    accountId: string,
    auth: AuthContext,
    payload: SettleRepCommissionPayload,
  ) {
    return this.targets.settleRepCommission(tenantId, accountId, auth, payload);
  }

  async createInterVanTransfer(
    tenantId: string,
    accountId: string,
    fromRepId: number,
    payload: CreateInterVanTransferPayload,
  ) {
    return this.transfers.createInterVanTransfer(tenantId, accountId, fromRepId, payload);
  }

  async acceptInterVanTransfer(tenantId: string, accountId: string, toRepId: number, transferId: number) {
    return this.transfers.acceptInterVanTransfer(tenantId, accountId, toRepId, transferId);
  }

  async rejectInterVanTransfer(tenantId: string, toRepId: number, transferId: number, reason?: string) {
    return this.transfers.rejectInterVanTransfer(tenantId, toRepId, transferId, reason);
  }

  async listInterVanTransfers(tenantId: string, filters?: { repId?: number; status?: string }) {
    return this.transfers.listInterVanTransfers(tenantId, filters);
  }

  async getPeerReps(tenantId: string, currentRepId: number) {
    return this.transfers.getPeerReps(tenantId, currentRepId);
  }

  async getDriverTodayItinerary(tenantId: string, repId: number, tripId?: number) {
    return this.routes.getDriverTodayItinerary(tenantId, repId, tripId);
  }

  async recordFieldVisit(arg1: string | number, arg2: string, arg3: string | number, payload: RecordFieldVisitPayload) {
    return this.routes.recordFieldVisit(arg1, arg2, arg3, payload);
  }

  async listFieldVisits(
    tenantId: string,
    filters?: { repId?: number; customerId?: number; visitType?: string; dateFrom?: string; dateTo?: string },
  ) {
    return this.routes.listFieldVisits(tenantId, filters);
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    return this.routes.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
  }

  async setCustomerRouteSchedule(tenantId: string, customerId: number, payload: SetCustomerRouteSchedulePayload) {
    return this.routes.setCustomerRouteSchedule(tenantId, customerId, payload);
  }

  async bulkAssignCustomerRoutes(tenantId: string, payload: BulkAssignCustomerRoutesPayload) {
    return this.routes.bulkAssignCustomerRoutes(tenantId, payload);
  }

  async getSupervisorCustomerRoutes(tenantId: string, filters?: GetSupervisorCustomerRoutesFilters) {
    return this.routes.getSupervisorCustomerRoutes(tenantId, filters);
  }

  async recordTripExpense(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordTripExpensePayload,
    authContext?: AuthContext,
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> {
    return this.expensesPackagingCustomersSlice.recordTripExpense(repId, tenantId, accountId, payload, authContext);
  }

  async getTripExpenses(tripId: number, tenantId: string, repId?: number) {
    return this.expensesPackagingCustomersSlice.getTripExpenses(tripId, tenantId, repId);
  }

  async recordPackagingMovement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordPackagingMovementPayload,
  ): Promise<{ ok: boolean; movementId: number }> {
    return this.expensesPackagingCustomersSlice.recordPackagingMovement(repId, tenantId, accountId, payload);
  }

  async getTripPackagingMovements(tripId: number, tenantId: string, repId?: number) {
    return this.expensesPackagingCustomersSlice.getTripPackagingMovements(tripId, tenantId, repId);
  }

  async getCustomerPackagingBalance(customerId: number, tenantId: string, repId?: number) {
    return this.expensesPackagingCustomersSlice.getCustomerPackagingBalance(customerId, tenantId, repId);
  }

  async createDriverCustomer(repId: number, tenantId: string, accountId: string, body: CreateDriverCustomerBody) {
    return this.expensesPackagingCustomersSlice.createDriverCustomer(repId, tenantId, accountId, body);
  }

  async getCustomerSuggestedOrder(tenantId: string, accountId: string, repId: number, customerId: number) {
    return this.expensesPackagingCustomersSlice.getCustomerSuggestedOrder(tenantId, accountId, repId, customerId);
  }

  async getCustomerLastSoldPrices(tenantId: string, customerId: number, repId?: number) {
    return this.expensesPackagingCustomersSlice.getCustomerLastSoldPrices(tenantId, customerId, repId);
  }

  async getCustomerFieldStatement(tenantId: string, customerId: number, repId?: number) {
    return this.expensesPackagingCustomersSlice.getCustomerFieldStatement(tenantId, customerId, repId);
  }

  async getRepFinancialLedger(tenantId: string, filters: GetRepFinancialLedgerFilters) {
    return this.repFinancialLedgerSlice.getRepFinancialLedger(tenantId, filters);
  }

  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: SettleRepFinancialItemPayload,
    authContext: AuthContext,
  ) {
    return this.repFinancialLedgerSlice.settleRepFinancialItem(tenantId, accountId, id, payload, authContext);
  }

  private async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return this.repFinancialLedgerSlice.resolveRepLinkedUserId(dbConn, tenantId, repId);
  }

  async pushRepShortagesToPayroll(
    tenantId: string,
    accountId: string,
    payload: PushRepShortagesToPayrollPayload,
    authContext: AuthContext,
  ) {
    return this.repFinancialLedgerSlice.pushRepShortagesToPayroll(tenantId, accountId, payload, authContext);
  }

  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: AddRepBonusOrCommissionPayload,
    authContext: AuthContext,
  ) {
    return this.repFinancialLedgerSlice.addRepBonusOrCommission(tenantId, accountId, payload, authContext);
  }

  async linkRepToEmployee(tenantId: string, repId: number, employeeId: number | null) {
    return this.repEmployeeLinkSlice.linkRepToEmployee(tenantId, repId, employeeId);
  }

  async listCandidateEmployees(tenantId: string) {
    return this.repEmployeeLinkSlice.listCandidateEmployees(tenantId);
  }

  async autoCreateEmployeeForRep(tenantId: string, accountId: string, repId: number, authContext: AuthContext) {
    return this.repEmployeeLinkSlice.autoCreateEmployeeForRep(tenantId, accountId, repId, authContext);
  }
}
