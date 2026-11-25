/*
 * Van + delivery posting (split-6 out of AccountingPostingService).
 * Pure move: the 8 van/delivery posting methods + the field-return COGS
 * helper used only by postVanFieldReturn, unchanged, behind the
 * AccountingPostingService delegating facade. The facade owns the shared
 * journal helpers; this service receives them bound via
 * VanAndDeliveryPostingDeps, so the moved bodies are byte-identical
 * to the originals.
 */
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import type { DbOrTx } from '../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting/van-and-delivery-posting.types';
import { PostVanDamagedSwapSlice } from './van-and-delivery-posting/post-van-damaged-swap.slice';
import { PostDeliveryRepSettlementSlice } from './van-and-delivery-posting/post-delivery-rep-settlement.slice';
import { PostRepShortageCashCollectionSlice } from './van-and-delivery-posting/post-rep-shortage-cash-collection.slice';
import { PostRepShortageWaiverSlice } from './van-and-delivery-posting/post-rep-shortage-waiver.slice';
import { PostVanTripSettlementSlice } from './van-and-delivery-posting/post-van-trip-settlement.slice';
import { PostVanStockTransferSlice } from './van-and-delivery-posting/post-van-stock-transfer.slice';
import { PostVanFieldCollectionSlice } from './van-and-delivery-posting/post-van-field-collection.slice';
import { PostVanFieldReturnSlice } from './van-and-delivery-posting/post-van-field-return.slice';

export class VanAndDeliveryPostingService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: VanAndDeliveryPostingDeps['toMoney'];
  private readonly maxAllowedDifference: VanAndDeliveryPostingDeps['maxAllowedDifference'];
  private readonly addLine: VanAndDeliveryPostingDeps['addLine'];
  private readonly insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
  private readonly postDomainJournal: VanAndDeliveryPostingDeps['postDomainJournal'];
  private readonly resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  private readonly resolveAccountWithFallback: VanAndDeliveryPostingDeps['resolveAccountWithFallback'];
  private readonly deliverySettlementBasis: VanAndDeliveryPostingDeps['deliverySettlementBasis'];
  private readonly hasDeliveryCustodyReclassification: VanAndDeliveryPostingDeps['hasDeliveryCustodyReclassification'];
  private readonly deliveryCustodyPartner: VanAndDeliveryPostingDeps['deliveryCustodyPartner'];
  private readonly readSaleResidualLines: VanAndDeliveryPostingDeps['readSaleResidualLines'];
  private readonly salesReturnCogsResidual: VanAndDeliveryPostingDeps['salesReturnCogsResidual'];

  constructor(deps: VanAndDeliveryPostingDeps) {
    this.accountingTenantFoundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.postDomainJournal = deps.postDomainJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
    this.resolveAccountWithFallback = deps.resolveAccountWithFallback;
    this.deliverySettlementBasis = deps.deliverySettlementBasis;
    this.hasDeliveryCustodyReclassification = deps.hasDeliveryCustodyReclassification;
    this.deliveryCustodyPartner = deps.deliveryCustodyPartner;
    this.readSaleResidualLines = deps.readSaleResidualLines;
    this.salesReturnCogsResidual = deps.salesReturnCogsResidual;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  private postVanDamagedSwapSliceInstance?: PostVanDamagedSwapSlice;
  private get postVanDamagedSwapSlice(): PostVanDamagedSwapSlice {
    return (this.postVanDamagedSwapSliceInstance ??= new PostVanDamagedSwapSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postDeliveryRepSettlementSliceInstance?: PostDeliveryRepSettlementSlice;
  private get postDeliveryRepSettlementSlice(): PostDeliveryRepSettlementSlice {
    return (this.postDeliveryRepSettlementSliceInstance ??= new PostDeliveryRepSettlementSlice({
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      maxAllowedDifference: (bookDigits) => this.maxAllowedDifference(bookDigits),
      resolveAccountWithFallback: (queryable, tenantId, configuredId, fallbackCode) =>
        this.resolveAccountWithFallback(queryable, tenantId, configuredId, fallbackCode),
      toMoney: (value, digits) => this.toMoney(value, digits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
      hasDeliveryCustodyReclassification: (queryable, saleId, auth) =>
        this.hasDeliveryCustodyReclassification(queryable, saleId, auth),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      deliverySettlementBasis: (queryable, saleId, auth) => this.deliverySettlementBasis(queryable, saleId, auth),
      deliveryCustodyPartner: (queryable, saleId) => this.deliveryCustodyPartner(queryable, saleId),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
    }));
  }

  private postRepShortageCashCollectionSliceInstance?: PostRepShortageCashCollectionSlice;
  private get postRepShortageCashCollectionSlice(): PostRepShortageCashCollectionSlice {
    return (this.postRepShortageCashCollectionSliceInstance ??= new PostRepShortageCashCollectionSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      toMoney: (value, digits) => this.toMoney(value, digits),
      postDomainJournal: (queryable, params) => this.postDomainJournal(queryable, params),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
    }));
  }

  private postRepShortageWaiverSliceInstance?: PostRepShortageWaiverSlice;
  private get postRepShortageWaiverSlice(): PostRepShortageWaiverSlice {
    return (this.postRepShortageWaiverSliceInstance ??= new PostRepShortageWaiverSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      postDomainJournal: (queryable, params) => this.postDomainJournal(queryable, params),
    }));
  }

  private postVanTripSettlementSliceInstance?: PostVanTripSettlementSlice;
  private get postVanTripSettlementSlice(): PostVanTripSettlementSlice {
    return (this.postVanTripSettlementSliceInstance ??= new PostVanTripSettlementSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      maxAllowedDifference: (bookDigits) => this.maxAllowedDifference(bookDigits),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postVanStockTransferSliceInstance?: PostVanStockTransferSlice;
  private get postVanStockTransferSlice(): PostVanStockTransferSlice {
    return (this.postVanStockTransferSliceInstance ??= new PostVanStockTransferSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postVanFieldCollectionSliceInstance?: PostVanFieldCollectionSlice;
  private get postVanFieldCollectionSlice(): PostVanFieldCollectionSlice {
    return (this.postVanFieldCollectionSliceInstance ??= new PostVanFieldCollectionSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      toMoney: (value, digits) => this.toMoney(value, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      resolveAccountWithFallback: (queryable, tenantId, configuredId, fallbackCode) =>
        this.resolveAccountWithFallback(queryable, tenantId, configuredId, fallbackCode),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  private postVanFieldReturnSliceInstance?: PostVanFieldReturnSlice;
  private get postVanFieldReturnSlice(): PostVanFieldReturnSlice {
    return (this.postVanFieldReturnSliceInstance ??= new PostVanFieldReturnSlice({
      ensureTenantFoundation: (queryable, auth) => this.ensureTenantFoundation(queryable, auth),
      readSaleResidualLines: (queryable, tenantId, saleId) => this.readSaleResidualLines(queryable, tenantId, saleId),
      salesReturnCogsResidual: (queryable, tenantId, saleId, bookDigits, returnedQtyBySaleItemId) =>
        this.salesReturnCogsResidual(queryable, tenantId, saleId, bookDigits, returnedQtyBySaleItemId),
      toMoney: (value, digits) => this.toMoney(value, digits),
      addLine: (lines, next, digits) => this.addLine(lines, next, digits),
      getTenantAccountingSettings: (queryable, tenantId) => this.getTenantAccountingSettings(queryable, tenantId),
      resolveSystemAccountByCode: (queryable, tenantId, code) =>
        this.resolveSystemAccountByCode(queryable, tenantId, code),
      insertPostedJournal: (queryable, params) => this.insertPostedJournal(queryable, params),
    }));
  }

  async postVanDamagedSwap(
    queryable: DbOrTx,
    swapId: number,
    params: {
      damagedQty: number;
      damagedUnitCost: number;
      replacementQty: number;
      replacementUnitCost: number;
      priceDifference: number;
      customerId?: number | null;
      branchId: number | null;
      locationId: number | null;
      damagedLocationId: number | null;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.postVanDamagedSwapSlice.postVanDamagedSwap(queryable, swapId, params, auth);
  }

  async postDeliveryRepSettlement(
    queryable: DbOrTx,
    saleId: number,
    amount: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    opts?: { countedCash?: number },
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postDeliveryRepSettlementSlice.postDeliveryRepSettlement(
      queryable,
      saleId,
      amount,
      branchId,
      locationId,
      auth,
      opts,
    );
  }

  async postRepShortageCashCollection(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      entryType: 'cash_shortage' | 'stock_shortage';
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<number> {
    return this.postRepShortageCashCollectionSlice.postRepShortageCashCollection(
      queryable,
      settlementItemId,
      params,
      auth,
    );
  }

  async postRepShortageWaiver(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<number> {
    return this.postRepShortageWaiverSlice.postRepShortageWaiver(queryable, settlementItemId, params, auth);
  }

  async postVanTripSettlement(
    queryable: DbOrTx,
    tripId: number,
    params: {
      expectedCash: number;
      countedCash: number;
      tripExpenses?: number;
      branchId: number | null;
      locationId: number | null;
      stockShortageAmount?: number;
      stockOverageAmount?: number;
      chargeStockVarianceToRep?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postVanTripSettlementSlice.postVanTripSettlement(queryable, tripId, params, auth);
  }

  async postVanStockTransfer(
    queryable: DbOrTx,
    tripId: number,
    params: {
      sourceLocationId: number;
      targetLocationId: number;
      totalCost: number;
      branchId?: number | null;
      type: 'load' | 'unload';
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postVanStockTransferSlice.postVanStockTransfer(queryable, tripId, params, auth);
  }

  async postVanFieldCollection(
    queryable: DbOrTx,
    collectionId: number,
    params: {
      amount: number;
      customerId: number;
      branchId: number | null;
      locationId: number | null;
      paymentMethod?: string;
      transferReference?: string;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postVanFieldCollectionSlice.postVanFieldCollection(queryable, collectionId, params, auth);
  }

  async postVanFieldReturn(
    queryable: DbOrTx,
    returnId: number,
    params: {
      customerId: number;
      totalAmount: number;
      refundMethod?: 'credit' | 'cash';
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      branchId: number | null;
      locationId: number | null;
      saleId?: number | null;
      isDamaged?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postVanFieldReturnSlice.postVanFieldReturn(queryable, returnId, params, auth);
  }
}
