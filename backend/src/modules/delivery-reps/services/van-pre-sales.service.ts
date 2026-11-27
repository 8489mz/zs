import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { SalesService } from '../../sales/sales.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type {
  CreatePreSalesOrderDto,
  ListWarehouseCatalogQuery,
  ListPreSalesOrdersFilters,
  ConsolidatePreSalesOrdersPayload,
  ConvertPreSalesOrderPayload,
  ListWarehouseCatalogResult,
  CreatePreSalesOrderResult,
  ApprovePreSalesOrderResult,
  RejectPreSalesOrderResult,
  ConsolidatePreSalesOrdersResult,
  ConvertPreSalesOrderResult,
} from './van-pre-sales/van-pre-sales-types';
import { WarehouseCatalogSlice } from './van-pre-sales/warehouse-catalog';
import { CreatePreSalesOrderSlice } from './van-pre-sales/create-pre-sales-order';
import { PreSalesOrderReadsSlice } from './van-pre-sales/pre-sales-order-reads';
import { PreSalesOrderLifecycleSlice } from './van-pre-sales/pre-sales-order-lifecycle';
import { ConsolidatePreSalesOrdersSlice } from './van-pre-sales/consolidate-pre-sales-orders';
import { ConvertPreSalesOrderSlice } from './van-pre-sales/convert-pre-sales-order';

export type { PreSalesCatalogItem, CreatePreSalesOrderDto } from './van-pre-sales/van-pre-sales-types';

@Injectable()
export class VanPreSalesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly salesService?: SalesService,
  ) {}

  private get anyDb(): any {
    return this.db;
  }

  private s1Instance?: WarehouseCatalogSlice;
  private get s1(): WarehouseCatalogSlice {
    if (!this.s1Instance) {
      this.s1Instance = new WarehouseCatalogSlice(this.db);
    }
    return this.s1Instance;
  }

  private s2Instance?: CreatePreSalesOrderSlice;
  private get s2(): CreatePreSalesOrderSlice {
    if (!this.s2Instance) {
      // Call-time-resolved forwarding arrow to the FACADE delegate (the #50
      // pattern adapted to this slice's direct-function ctor type): s1 and
      // the facade method are resolved at CALL time, so a spec mocking the
      // facade method after construction still intercepts.
      this.s2Instance = new CreatePreSalesOrderSlice(this.db, (tenantId, preferredLocationId, productIds) =>
        this.resolveDefaultWarehouseLocationId(tenantId, preferredLocationId, productIds),
      );
    }
    return this.s2Instance;
  }

  private s3Instance?: PreSalesOrderReadsSlice;
  private get s3(): PreSalesOrderReadsSlice {
    if (!this.s3Instance) {
      this.s3Instance = new PreSalesOrderReadsSlice(this.db);
    }
    return this.s3Instance;
  }

  private s4Instance?: PreSalesOrderLifecycleSlice;
  private get s4(): PreSalesOrderLifecycleSlice {
    if (!this.s4Instance) {
      this.s4Instance = new PreSalesOrderLifecycleSlice(this.db);
    }
    return this.s4Instance;
  }

  private s5Instance?: ConsolidatePreSalesOrdersSlice;
  private get s5(): ConsolidatePreSalesOrdersSlice {
    if (!this.s5Instance) {
      // Same call-time-resolved forwarding arrow as S2 (see above).
      this.s5Instance = new ConsolidatePreSalesOrdersSlice(this.db, (tenantId, preferredLocationId, productIds) =>
        this.resolveDefaultWarehouseLocationId(tenantId, preferredLocationId, productIds),
      );
    }
    return this.s5Instance;
  }

  private s6Instance?: ConvertPreSalesOrderSlice;
  private get s6(): ConvertPreSalesOrderSlice {
    if (!this.s6Instance) {
      this.s6Instance = new ConvertPreSalesOrderSlice(this.db, this.salesService);
    }
    return this.s6Instance;
  }

  async resolveDefaultWarehouseLocationId(
    tenantId: string,
    preferredLocationId?: number,
    productIds?: number[],
  ): Promise<number | null> {
    return this.s1.resolveDefaultWarehouseLocationId(tenantId, preferredLocationId, productIds);
  }

  async listWarehouseCatalog(
    tenantId: string,
    warehouseLocationId?: number,
    query?: ListWarehouseCatalogQuery,
    repId?: number,
  ): Promise<ListWarehouseCatalogResult> {
    return this.s1.listWarehouseCatalog(tenantId, warehouseLocationId, query, repId);
  }

  async createPreSalesOrder(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: CreatePreSalesOrderDto,
  ): Promise<CreatePreSalesOrderResult> {
    return this.s2.createPreSalesOrder(repId, tenantId, accountId, payload);
  }

  async listPreSalesOrders(tenantId: string, filters?: ListPreSalesOrdersFilters) {
    return this.s3.listPreSalesOrders(tenantId, filters);
  }

  async getPreSalesOrderDetails(orderId: number, tenantId: string, repId?: number) {
    return this.s3.getPreSalesOrderDetails(orderId, tenantId, repId);
  }

  async approvePreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
  ): Promise<ApprovePreSalesOrderResult> {
    return this.s4.approvePreSalesOrder(orderId, supervisorUserId, tenantId, accountId);
  }

  async rejectPreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
    reason?: string,
  ): Promise<RejectPreSalesOrderResult> {
    return this.s4.rejectPreSalesOrder(orderId, supervisorUserId, tenantId, accountId, reason);
  }

  async consolidatePreSalesOrdersToRequisition(
    tenantId: string,
    accountId: string,
    supervisorUserId: number,
    payload: ConsolidatePreSalesOrdersPayload,
  ): Promise<ConsolidatePreSalesOrdersResult> {
    return this.s5.consolidatePreSalesOrdersToRequisition(tenantId, accountId, supervisorUserId, payload);
  }

  async convertPreSalesOrderToInvoice(
    orderId: number,
    auth: AuthContext,
    payload?: ConvertPreSalesOrderPayload,
  ): Promise<ConvertPreSalesOrderResult> {
    return this.s6.convertPreSalesOrderToInvoice(orderId, auth, payload);
  }
}
