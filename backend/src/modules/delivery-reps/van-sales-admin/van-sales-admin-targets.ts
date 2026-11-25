import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VanSalesService } from '../van-sales.service';

export class VanSalesAdminTargetsSlice {
  constructor(private readonly vanSalesService: VanSalesService) {}

  async listRepTargets(req: RequestWithAuth, month?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const [targets, commissionConfig] = await Promise.all([
      this.vanSalesService.listAllRepTargets(tenantId, month),
      this.vanSalesService.getCommissionConfig(tenantId),
    ]);
    return { ok: true, targets, commissionConfig };
  }

  async setRepTarget(
    req: RequestWithAuth,

    body: {
      repId: number;
      month: string;
      targetAmount: number;
      collectionTarget?: number | null;
      visitsTarget?: number | null;
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.setRepTarget(
      tenantId,
      accountId,
      Number(body.repId),
      body.month,
      Number(body.targetAmount),
      body.collectionTarget !== undefined && body.collectionTarget !== null ? Number(body.collectionTarget) : undefined,
      body.visitsTarget !== undefined && body.visitsTarget !== null ? Number(body.visitsTarget) : undefined,
      {
        salesCommissionRatePercent: body.salesCommissionRatePercent,
        collectionCommissionRatePercent: body.collectionCommissionRatePercent,
        targetBonusRatePercent: body.targetBonusRatePercent,
      },
    );
    return res;
  }

  async getCommissionConfig(req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const config = await this.vanSalesService.getCommissionConfig(tenantId);
    return { ok: true, config };
  }

  async saveCommissionConfig(
    req: RequestWithAuth,

    body: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
      repId?: number;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const config = await this.vanSalesService.saveCommissionConfig(tenantId, accountId, body);
    return { ok: true, config };
  }

  async settleRepCommission(
    req: RequestWithAuth,

    body: {
      repId: number;
      periodMonth: string;
      amount?: number;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleRepCommission(tenantId, accountId, req.authContext!, body);
  }

  // Route KPIs & Field Visits Endpoints
  async getRouteKpis(req: RequestWithAuth, dateFrom?: string, dateTo?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const kpis = await this.vanSalesService.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
    return { ok: true, ...kpis };
  }

  async listFieldVisits(
    req: RequestWithAuth,
    repId?: string,
    customerId?: string,
    visitType?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const visits = await this.vanSalesService.listFieldVisits(tenantId, {
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      visitType,
      dateFrom,
      dateTo,
    });
    return { ok: true, visits };
  }

  async setCustomerRouteSchedule(
    req: RequestWithAuth,
    id: number,

    body: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.setCustomerRouteSchedule(tenantId, id, body);
    return res;
  }

  async getSupervisorCustomerRoutes(
    req: RequestWithAuth,
    search?: string,
    repId?: string,
    route?: string,
    unassignedOnly?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const customers = await this.vanSalesService.getSupervisorCustomerRoutes(tenantId, {
      search,
      repId,
      route,
      unassignedOnly: unassignedOnly === 'true',
    });
    return { ok: true, customers };
  }

  async bulkAssignCustomerRoutes(
    req: RequestWithAuth,

    body: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string;
      route?: string;
      visitDays?: string[];
    },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.bulkAssignCustomerRoutes(tenantId, body);
    return res;
  }

  // Fleet Fuel Logs Endpoints
  async listFuelLogs(req: RequestWithAuth, vehicleId?: string, repId?: string, dateFrom?: string, dateTo?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const logs = await this.vanSalesService.listFuelLogs(tenantId, {
      vehicleId: vehicleId ? Number(vehicleId) : undefined,
      repId: repId ? Number(repId) : undefined,
      dateFrom,
      dateTo,
    });
    return { ok: true, logs };
  }

  async recordFuelLog(
    req: RequestWithAuth,

    body: {
      vehicleId: number;
      tripId?: number;
      repId?: number;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.recordFuelLog(tenantId, accountId, body.repId || null, body);
    return res;
  }
}
