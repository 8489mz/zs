import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VanPreSalesService } from '../services/van-pre-sales.service';
import { VanSalesService } from '../van-sales.service';

export class VanSalesAdminPreSalesTripsSlice {
  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly vanPreSalesService: VanPreSalesService,
  ) {}

  async listPreSalesOrders(
    req: RequestWithAuth,
    repId?: string,
    customerId?: string,
    status?: string,
    dateFrom?: string,
    dateTo?: string,
    search?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.listPreSalesOrders(tenantId, {
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      status,
      dateFrom,
      dateTo,
      search,
    });
  }

  async getPreSalesOrderDetails(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.getPreSalesOrderDetails(id, tenantId);
  }

  async approvePreSalesOrder(req: RequestWithAuth, id: number) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.approvePreSalesOrder(id, Number(req.authContext!.userId), tenantId, accountId);
  }

  async rejectPreSalesOrder(req: RequestWithAuth, id: number, reason?: string) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.rejectPreSalesOrder(
      id,
      Number(req.authContext!.userId),
      tenantId,
      accountId,
      reason,
    );
  }

  async consolidatePreSalesOrdersToRequisition(
    req: RequestWithAuth,

    body: {
      orderIds: number[];
      // F18 (trial problem 30): FE sends `deliveryRepId`; `targetRepId`
      // is the older name. Either is accepted downstream.
      targetRepId?: number;
      deliveryRepId?: number;
      sourceWarehouseId?: number;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.consolidatePreSalesOrdersToRequisition(
      tenantId,
      accountId,
      Number(req.authContext!.userId),
      body,
    );
  }

  async convertPreSalesOrderToInvoice(
    req: RequestWithAuth,
    id: number,

    body?: {
      paymentType?: 'cash' | 'credit';
      paidAmount?: number;
      notes?: string;
    },
  ) {
    requireTenantScope(req.authContext!);
    return this.vanPreSalesService.convertPreSalesOrderToInvoice(id, req.authContext!, body);
  }

  async listTrips(req: RequestWithAuth, repId?: string, status?: string, dateFrom?: string, dateTo?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const trips = await this.vanSalesService.listTripsForAdmin(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
      dateFrom,
      dateTo,
    });
    return { ok: true, trips };
  }

  async getTripDetails(req: RequestWithAuth, id: number, page: string, pageSize: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const details = await this.vanSalesService.getTripDetailsForAdmin(tenantId, id, {
      page: Number(page),
      pageSize: Number(pageSize),
    });
    return { ok: true, ...details };
  }

  async settleTripAdmin(
    req: RequestWithAuth,
    id: number,

    body: {
      repId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash.
      perDayCash?: { businessDay: string; countedCash: number }[];
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleTrip(
      body.repId,
      tenantId,
      accountId,
      {
        tripId: id,
        countedCash: body.countedCash,
        perDayCash: body.perDayCash,
        unloadRemainingToWarehouse: body.unloadRemainingToWarehouse,
        countedStock: body.countedStock,
        nightStockApproved: body.nightStockApproved,
        nightStockNotes: body.nightStockNotes,
        endOdometer: body.endOdometer,
        // INV-VAN-SELF-SETTLE-PIN-REQUIRED: this endpoint runs under a
        // supervisor/admin session, so the flag IS the supervisor's
        // charge/waive decision at settle time and is honored as-is.
        chargeStockVarianceToRep: body.chargeStockVarianceToRep,
        chargeStockVarianceDecidedBySupervisor: true,
        // M18: the admin console settles under a named session, so
        // the approval is account-mode with this user as supervisor.
        supervisorApprovalMethod: 'account',
        supervisorId: req.authContext!.userId,
        notes: body.notes,
      },
      req.authContext,
    );
  }
}
