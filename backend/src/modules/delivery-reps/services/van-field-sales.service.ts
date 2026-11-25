import { Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { VanFraudRadarService } from './van-fraud-radar.service';
import type { ExecuteFieldSaleInternalPayload, ListDriverSalesFilters } from './van-field-sales/van-field-sales-types';
import { ExecuteFieldSaleInternalSlice } from './van-field-sales/execute-field-sale-internal';
import { ListDriverSalesSlice } from './van-field-sales/list-driver-sales';

export interface VanFieldSalesDeps {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  // Bound facade methods (same names as the facade members, so the moved
  // bodies are byte-identical). verifySupervisorPin belongs to slice 1's
  // range; it is bound here exactly as sales-write S3 binds S1/S2 methods —
  // the binding resolves whether the callee is still a real method or
  // already an S1 delegate at merge.
  deductVanSalePharmacyBatches: (...args: any[]) => any;
  deductVanSaleInventoryBatches: (...args: any[]) => any;
  generateDailySequenceNumber: (...args: any[]) => any;
  moveVanStock: (...args: any[]) => any;
  resolveSystemAuthContext: (...args: any[]) => any;
  sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  verifySupervisorPin: (...args: any[]) => any;
  // F3: the route gate (rep -> customer history, three-way: own /
  // other-rep / no-history). Bound from the facade like
  // verifySupervisorPin above.
  assertRepRouteForSale: (tenantId: string, repId: number, customerId: number) => Promise<void>;
}

@Injectable()
export class VanFieldSalesService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private readonly deductVanSalePharmacyBatches: (...args: any[]) => any;
  private readonly deductVanSaleInventoryBatches: (...args: any[]) => any;
  private readonly generateDailySequenceNumber: (...args: any[]) => any;
  private readonly moveVanStock: (...args: any[]) => any;
  private readonly resolveSystemAuthContext: (...args: any[]) => any;
  private readonly sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  private readonly verifySupervisorPin: (...args: any[]) => any;
  private readonly assertRepRouteForSale: (tenantId: string, repId: number, customerId: number) => Promise<void>;

  constructor(deps: VanFieldSalesDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.deductVanSalePharmacyBatches = deps.deductVanSalePharmacyBatches;
    this.deductVanSaleInventoryBatches = deps.deductVanSaleInventoryBatches;
    this.generateDailySequenceNumber = deps.generateDailySequenceNumber;
    this.moveVanStock = deps.moveVanStock;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.sortItemsByProductId = deps.sortItemsByProductId;
    this.verifySupervisorPin = deps.verifySupervisorPin;
    this.assertRepRouteForSale = deps.assertRepRouteForSale;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  private executeFieldSaleInternalInstance?: ExecuteFieldSaleInternalSlice;
  private get executeFieldSaleInternalSlice(): ExecuteFieldSaleInternalSlice {
    if (!this.executeFieldSaleInternalInstance) {
      this.executeFieldSaleInternalInstance = new ExecuteFieldSaleInternalSlice({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService,
        deductVanSalePharmacyBatches: this.deductVanSalePharmacyBatches,
        deductVanSaleInventoryBatches: this.deductVanSaleInventoryBatches,
        generateDailySequenceNumber: this.generateDailySequenceNumber,
        moveVanStock: this.moveVanStock,
        resolveSystemAuthContext: this.resolveSystemAuthContext,
        sortItemsByProductId: this.sortItemsByProductId,
        verifySupervisorPin: this.verifySupervisorPin,
        assertRepRouteForSale: this.assertRepRouteForSale,
      });
    }
    return this.executeFieldSaleInternalInstance;
  }
  private listDriverSalesInstance?: ListDriverSalesSlice;
  private get listDriverSalesSlice(): ListDriverSalesSlice {
    if (!this.listDriverSalesInstance) {
      this.listDriverSalesInstance = new ListDriverSalesSlice(this.db);
    }
    return this.listDriverSalesInstance;
  }
  async executeFieldSaleInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteFieldSaleInternalPayload,
  ) {
    return this.executeFieldSaleInternalSlice.executeFieldSaleInternal(repId, tenantId, accountId, payload);
  }

  async listDriverSales(tenantId: string, repId: number, filters?: ListDriverSalesFilters) {
    return this.listDriverSalesSlice.listDriverSales(tenantId, repId, filters);
  }
}
