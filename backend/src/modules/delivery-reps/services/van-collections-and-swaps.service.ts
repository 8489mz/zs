/*
 * Collections + damaged swaps (van-sales split-3 out of VanSalesService).
 * Pure move: the 9 field-collection / damaged-swap / rep-scope methods,
 * unchanged, behind the VanSalesService delegating facade. The facade owns
 * the injected services; this service receives them bound via
 * VanCollectionsAndSwapsDeps, so the moved bodies are byte-identical to
 * the originals. recordFieldCollection itself STAYS in the facade: specs
 * monkey-patch recordFieldCollectionInternal on the facade instance and
 * read the static dedup maps off VanSalesService, so the outer wrapper
 * and its statics are the seam and must not move.
 */
import { Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { RecordFieldCollectionSlice } from './van-collections-and-swaps/record-field-collection.slice';
import { ExecuteDamagedSwapSlice } from './van-collections-and-swaps/execute-damaged-swap.slice';
import { RepScopedReadsSlice } from './van-collections-and-swaps/rep-scoped-reads.slice';
import type { VanCollectionsAndSwapsDeps } from './van-collections-and-swaps/van-collections-and-swaps.types';

export class VanCollectionsAndSwapsService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private readonly generateDailySequenceNumber: VanCollectionsAndSwapsDeps['generateDailySequenceNumber'];
  private readonly recordSuspicionEvent: VanCollectionsAndSwapsDeps['recordSuspicionEvent'];
  private readonly resolveSystemAuthContext: VanCollectionsAndSwapsDeps['resolveSystemAuthContext'];
  private readonly verifySupervisorPin: VanCollectionsAndSwapsDeps['verifySupervisorPin'];
  private readonly moveVanStock: VanCollectionsAndSwapsDeps['moveVanStock'];

  constructor(deps: VanCollectionsAndSwapsDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.generateDailySequenceNumber = deps.generateDailySequenceNumber;
    this.recordSuspicionEvent = deps.recordSuspicionEvent;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.verifySupervisorPin = deps.verifySupervisorPin;
    this.moveVanStock = deps.moveVanStock;
  }

  private get anyDb(): any {
    return this.db;
  }

  private get collectionsDeps(): VanCollectionsAndSwapsDeps {
    return {
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      vanFraudRadarService: this.vanFraudRadarService,
      generateDailySequenceNumber: this.generateDailySequenceNumber,
      recordSuspicionEvent: this.recordSuspicionEvent,
      resolveSystemAuthContext: this.resolveSystemAuthContext,
      verifySupervisorPin: this.verifySupervisorPin,
      moveVanStock: this.moveVanStock,
    };
  }

  private recordFieldCollectionSliceInstance?: RecordFieldCollectionSlice;
  private get recordFieldCollectionSlice(): RecordFieldCollectionSlice {
    return (this.recordFieldCollectionSliceInstance ??= new RecordFieldCollectionSlice(this.collectionsDeps));
  }

  private executeDamagedSwapSliceInstance?: ExecuteDamagedSwapSlice;
  private get executeDamagedSwapSlice(): ExecuteDamagedSwapSlice {
    return (this.executeDamagedSwapSliceInstance ??= new ExecuteDamagedSwapSlice(this.collectionsDeps));
  }

  private repScopedReadsSliceInstance?: RepScopedReadsSlice;
  private get repScopedReadsSlice(): RepScopedReadsSlice {
    return (this.repScopedReadsSliceInstance ??= new RepScopedReadsSlice(this.collectionsDeps));
  }

  async recordFieldCollectionInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
      offlineCreatedAt?: string;
    },
  ) {
    return this.recordFieldCollectionSlice.recordFieldCollectionInternal(repId, tenantId, accountId, payload);
  }

  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    return this.executeDamagedSwapSlice.executeDamagedSwap(repId, tenantId, accountId, payload);
  }

  async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    return this.repScopedReadsSlice.assertTripOwnedByRep(tenantId, tripId, repId);
  }

  async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    return this.repScopedReadsSlice.listRepServedCustomerIds(tenantId, repId);
  }

  async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.repScopedReadsSlice.assertRepServedCustomer(tenantId, repId, customerId);
  }

  async listCustomerServingRepIds(tenantId: string, customerId: number): Promise<Set<number>> {
    return this.repScopedReadsSlice.listCustomerServingRepIds(tenantId, customerId);
  }

  async assertRepRouteForSale(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.repScopedReadsSlice.assertRepRouteForSale(tenantId, repId, customerId);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    return this.repScopedReadsSlice.listTripDamagedSwaps(tenantId, tripId, repId);
  }
}
