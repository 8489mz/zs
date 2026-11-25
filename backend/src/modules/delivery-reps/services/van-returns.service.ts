import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { AuditService } from '../../../core/audit/audit.service';
import { ComputeAlreadyReturnedQtyBySaleItemSlice } from './van-returns/compute-already-returned-qty.slice';
import { RefundLegsClusterSlice } from './van-returns/refund-legs-cluster.slice';
import { GetCustomerEligibleSalesSlice } from './van-returns/get-customer-eligible-sales.slice';
import { SubmitFieldReturnSlice } from './van-returns/submit-field-return.slice';
import { ListFieldReturnsSlice } from './van-returns/list-field-returns.slice';
import { ApproveFieldReturnSlice } from './van-returns/approve-field-return.slice';
import { RejectFieldReturnSlice } from './van-returns/reject-field-return.slice';

@Injectable()
export class VanReturnsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly fraudRadar?: VanFraudRadarService,
    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): optional so direct
    // `new` callers (specs, VanSalesService's default construction)
    // keep working; VanSalesService passes its AuditService, and Nest
    // resolves it from the imported AuditModule.
    @Optional() private readonly audit?: AuditService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  private computeAlreadyReturnedQtyBySaleItemInstance?: ComputeAlreadyReturnedQtyBySaleItemSlice;
  private get computeAlreadyReturnedQtyBySaleItemSlice(): ComputeAlreadyReturnedQtyBySaleItemSlice {
    return (this.computeAlreadyReturnedQtyBySaleItemInstance ??= new ComputeAlreadyReturnedQtyBySaleItemSlice(this.db));
  }

  private refundLegsClusterInstance?: RefundLegsClusterSlice;
  private get refundLegsClusterSlice(): RefundLegsClusterSlice {
    return (this.refundLegsClusterInstance ??= new RefundLegsClusterSlice());
  }

  private getCustomerEligibleSalesInstance?: GetCustomerEligibleSalesSlice;
  private get getCustomerEligibleSalesSlice(): GetCustomerEligibleSalesSlice {
    return (this.getCustomerEligibleSalesInstance ??= new GetCustomerEligibleSalesSlice(this.db, {
      computeAlreadyReturnedQtyBySaleItem: (tenantId, saleIds) =>
        this.computeAlreadyReturnedQtyBySaleItemSlice.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds),
    }));
  }

  private submitFieldReturnInstance?: SubmitFieldReturnSlice;
  private get submitFieldReturnSlice(): SubmitFieldReturnSlice {
    return (this.submitFieldReturnInstance ??= new SubmitFieldReturnSlice(
      this.db,
      {
        computeAlreadyReturnedQtyBySaleItem: (tenantId, saleIds) =>
          this.computeAlreadyReturnedQtyBySaleItemSlice.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds),
        resolveSaleRefundLegs: (q, tenantId, sale, moneyDigits, opts) =>
          this.refundLegsClusterSlice.resolveSaleRefundLegs(q, tenantId, sale, moneyDigits, opts),
        assertRefundMethodCoveredByLegs: (legs, refundMethod, totalAmount, moneyDigits) =>
          this.refundLegsClusterSlice.assertRefundMethodCoveredByLegs(legs, refundMethod, totalAmount, moneyDigits),
      },
      this.fraudRadar,
      this.audit,
    ));
  }

  private listFieldReturnsInstance?: ListFieldReturnsSlice;
  private get listFieldReturnsSlice(): ListFieldReturnsSlice {
    return (this.listFieldReturnsInstance ??= new ListFieldReturnsSlice(this.db));
  }

  private approveFieldReturnInstance?: ApproveFieldReturnSlice;
  private get approveFieldReturnSlice(): ApproveFieldReturnSlice {
    return (this.approveFieldReturnInstance ??= new ApproveFieldReturnSlice(this.db, this.accountingPosting, {
      resolveSaleRefundLegs: (q, tenantId, sale, moneyDigits, opts) =>
        this.refundLegsClusterSlice.resolveSaleRefundLegs(q, tenantId, sale, moneyDigits, opts),
      assertRefundMethodCoveredByLegs: (legs, refundMethod, totalAmount, moneyDigits) =>
        this.refundLegsClusterSlice.assertRefundMethodCoveredByLegs(legs, refundMethod, totalAmount, moneyDigits),
    }));
  }

  private rejectFieldReturnInstance?: RejectFieldReturnSlice;
  private get rejectFieldReturnSlice(): RejectFieldReturnSlice {
    return (this.rejectFieldReturnInstance ??= new RejectFieldReturnSlice(this.db));
  }

  async computeAlreadyReturnedQtyBySaleItem(tenantId: string, saleIds: number[]): Promise<Map<number, number>> {
    return this.computeAlreadyReturnedQtyBySaleItemSlice.computeAlreadyReturnedQtyBySaleItem(tenantId, saleIds);
  }

  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
    return this.getCustomerEligibleSalesSlice.getCustomerEligibleSales(tenantId, customerId, repId);
  }

  async submitFieldReturn(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      saleId?: number | null;
      returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
      refundMethod?: 'credit' | 'cash';
      items: {
        productId: number;
        qty: number;
        unitPrice: number;
        saleItemId?: number;
        unitMultiplier?: number;
        unitName?: string;
      }[];
      notes?: string;
      offlineCreatedAt?: string;
    },
  ) {
    return this.submitFieldReturnSlice.submitFieldReturn(repId, tenantId, accountId, payload);
  }

  async listFieldReturns(
    tenantId: string,
    filters: { status?: string; repId?: number; tripId?: number; customerId?: number } = {},
  ) {
    return this.listFieldReturnsSlice.listFieldReturns(tenantId, filters);
  }

  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.approveFieldReturnSlice.approveFieldReturn(tenantId, accountId, returnId, approvedByUserId);
  }

  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    return this.rejectFieldReturnSlice.rejectFieldReturn(tenantId, returnId, rejectionReason, rejectedByUserId);
  }
}
