/*
 * Inventory + manufacturing + cash posting (split-7 out of AccountingPostingService).
 * Pure move: the 12 inventory/manufacturing/cash posting methods + the
 * cashier-shortage-tolerance helper used only by postCashierShiftVariance,
 * unchanged, behind the AccountingPostingService delegating facade. The
 * facade owns the shared journal helpers; this service receives them bound
 * via InventoryManufacturingCashPostingDeps, so the moved bodies are
 * byte-identical to the originals.
 */
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import type { DbOrTx } from '../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting/inventory-manufacturing-cash-posting.types';
import { CashierShiftVarianceSlice } from './inventory-manufacturing-cash-posting/cashier-shift-variance.slice';
import { PostInventoryAdjustmentSlice } from './inventory-manufacturing-cash-posting/post-inventory-adjustment.slice';
import { DamagedStockFoodWasteSlice } from './inventory-manufacturing-cash-posting/damaged-stock-food-waste.slice';
import { PostStockCountSlice } from './inventory-manufacturing-cash-posting/post-stock-count.slice';
import { ServicePostingSlice } from './inventory-manufacturing-cash-posting/service-posting.slice';
import { PostManufacturingWorkOrderSlice } from './inventory-manufacturing-cash-posting/post-manufacturing-work-order.slice';
import { PostManufacturingUnbuildOrderSlice } from './inventory-manufacturing-cash-posting/post-manufacturing-unbuild-order.slice';
import { PostCashDrawerMovementSlice } from './inventory-manufacturing-cash-posting/post-cash-drawer-movement.slice';
import { InstallmentInterestSlice } from './inventory-manufacturing-cash-posting/installment-interest.slice';

export class InventoryManufacturingCashPostingService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  private readonly maxAllowedDifference: InventoryManufacturingCashPostingDeps['maxAllowedDifference'];
  private readonly addLine: InventoryManufacturingCashPostingDeps['addLine'];
  private readonly insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
  private readonly postDomainJournal: InventoryManufacturingCashPostingDeps['postDomainJournal'];
  private readonly resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];

  constructor(deps: InventoryManufacturingCashPostingDeps) {
    this.accountingTenantFoundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.postDomainJournal = deps.postDomainJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  private cashierShiftVarianceSliceInstance?: CashierShiftVarianceSlice;
  private get cashierShiftVarianceSlice(): CashierShiftVarianceSlice {
    return (this.cashierShiftVarianceSliceInstance ??= new CashierShiftVarianceSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      maxAllowedDifference: (bookDigits) => this.maxAllowedDifference(bookDigits),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postInventoryAdjustmentSliceInstance?: PostInventoryAdjustmentSlice;
  private get postInventoryAdjustmentSlice(): PostInventoryAdjustmentSlice {
    return (this.postInventoryAdjustmentSliceInstance ??= new PostInventoryAdjustmentSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      toMoney: (value, digits) => this.toMoney(value, digits),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
    }));
  }

  private damagedStockFoodWasteSliceInstance?: DamagedStockFoodWasteSlice;
  private get damagedStockFoodWasteSlice(): DamagedStockFoodWasteSlice {
    return (this.damagedStockFoodWasteSliceInstance ??= new DamagedStockFoodWasteSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postStockCountSliceInstance?: PostStockCountSlice;
  private get postStockCountSlice(): PostStockCountSlice {
    return (this.postStockCountSliceInstance ??= new PostStockCountSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private servicePostingSliceInstance?: ServicePostingSlice;
  private get servicePostingSlice(): ServicePostingSlice {
    return (this.servicePostingSliceInstance ??= new ServicePostingSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postManufacturingWorkOrderSliceInstance?: PostManufacturingWorkOrderSlice;
  private get postManufacturingWorkOrderSlice(): PostManufacturingWorkOrderSlice {
    return (this.postManufacturingWorkOrderSliceInstance ??= new PostManufacturingWorkOrderSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      maxAllowedDifference: (bookDigits) => this.maxAllowedDifference(bookDigits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postManufacturingUnbuildOrderSliceInstance?: PostManufacturingUnbuildOrderSlice;
  private get postManufacturingUnbuildOrderSlice(): PostManufacturingUnbuildOrderSlice {
    return (this.postManufacturingUnbuildOrderSliceInstance ??= new PostManufacturingUnbuildOrderSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      maxAllowedDifference: (bookDigits) => this.maxAllowedDifference(bookDigits),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postCashDrawerMovementSliceInstance?: PostCashDrawerMovementSlice;
  private get postCashDrawerMovementSlice(): PostCashDrawerMovementSlice {
    return (this.postCashDrawerMovementSliceInstance ??= new PostCashDrawerMovementSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private installmentInterestSliceInstance?: InstallmentInterestSlice;
  private get installmentInterestSlice(): InstallmentInterestSlice {
    return (this.installmentInterestSliceInstance ??= new InstallmentInterestSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
      postDomainJournal: (queryable, params) => this.postDomainJournal(queryable, params),
    }));
  }

  async postInventoryAdjustment(
    queryable: DbOrTx,
    movementId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.postInventoryAdjustmentSlice.postInventoryAdjustment(queryable, movementId, auth);
  }

  async postDamagedStock(
    queryable: DbOrTx,
    damageRecordId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.damagedStockFoodWasteSlice.postDamagedStock(queryable, damageRecordId, auth);
  }

  async postFoodWaste(
    queryable: DbOrTx,
    wasteLogId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.damagedStockFoodWasteSlice.postFoodWaste(queryable, wasteLogId, auth);
  }

  async postStockCount(
    queryable: DbOrTx,
    sessionId: number,
    auth: AuthContext,
    itemIds?: number[],
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.postStockCountSlice.postStockCount(queryable, sessionId, auth, itemIds);
  }

  async postService(
    queryable: DbOrTx,
    serviceId: number,
    revision: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.servicePostingSlice.postService(queryable, serviceId, revision, auth);
  }

  async reverseService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<void> {
    return this.servicePostingSlice.reverseService(queryable, serviceId, revision, auth);
  }

  async postCashierShiftVariance(
    queryable: DbOrTx,
    shiftId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.cashierShiftVarianceSlice.postCashierShiftVariance(queryable, shiftId, auth);
  }

  async postManufacturingWorkOrder(
    queryable: DbOrTx,
    workOrderId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postManufacturingWorkOrderSlice.postManufacturingWorkOrder(queryable, workOrderId, auth);
  }

  async postManufacturingUnbuildOrder(
    queryable: DbOrTx,
    unbuildId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postManufacturingUnbuildOrderSlice.postManufacturingUnbuildOrder(queryable, unbuildId, auth);
  }

  async postCashDrawerMovement(
    queryable: DbOrTx,
    txnId: number,
    movementType: 'cash_in' | 'cash_out' | string,
    amount: number,
    note: string,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    counterpartAccountId?: number | null,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postCashDrawerMovementSlice.postCashDrawerMovement(
      queryable,
      txnId,
      movementType,
      amount,
      note,
      branchId,
      locationId,
      auth,
      counterpartAccountId,
    );
  }

  async postCustomerInstallmentInterest(
    queryable: DbOrTx,
    planId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.installmentInterestSlice.postCustomerInstallmentInterest(queryable, planId, auth);
  }

  async recognizeInstallmentInterest(
    queryable: DbOrTx,
    tenantId: string,
    throughDate: string,
    createdBy: number | null = null,
  ): Promise<void> {
    return this.installmentInterestSlice.recognizeInstallmentInterest(queryable, tenantId, throughDate, createdBy);
  }
}
