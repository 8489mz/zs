import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VanSalesService } from '../van-sales.service';

export class VanSalesAdminOpsSlice {
  constructor(private readonly vanSalesService: VanSalesService) {}

  async listOilChanges(req: RequestWithAuth, vehicleId?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const changes = await this.vanSalesService.listOilChanges(tenantId, vehicleId ? Number(vehicleId) : undefined);
    return { ok: true, changes };
  }

  async recordOilChange(
    req: RequestWithAuth,

    body: {
      vehicleId: number;
      odometerAtChange: number;
      oilType: string;
      ratedKm: number;
      withFilter: boolean;
      alertKmBefore?: number;
      cost?: number;
      performedBy?: string;
      notes?: string;
      repId?: number;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.recordOilChange(tenantId, accountId, body.repId || null, body);
    return res;
  }

  async getMaintenanceAlerts(req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getFleetMaintenanceAlerts(tenantId);
  }

  // Multi-Driver Vehicle Shifts Endpoints
  async listVehicleDrivers(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const drivers = await this.vanSalesService.listVehicleDrivers(tenantId, id);
    return { ok: true, drivers };
  }

  async assignVehicleDriver(
    req: RequestWithAuth,
    id: number,

    body: {
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.assignVehicleDriver(tenantId, accountId, { vehicleId: id, ...body });
    return res;
  }

  async removeVehicleDriver(req: RequestWithAuth, driverId: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.removeVehicleDriver(tenantId, driverId);
    return res;
  }

  // Inter-Van Transfers Audit Endpoints
  async listAdminTransfers(req: RequestWithAuth, repId?: string, status?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const transfers = await this.vanSalesService.listInterVanTransfers(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
    });
    return { ok: true, transfers };
  }

  // Trip Operational Expenses Audit
  async getAdminTripExpenses(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getTripExpenses(id, tenantId);
  }

  // Returnable Packaging & Empties Ledger Audit
  async getAdminTripPackaging(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getTripPackagingMovements(id, tenantId);
  }

  async getAdminCustomerPackaging(req: RequestWithAuth, customerId: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getCustomerPackagingBalance(customerId, tenantId);
  }

  // Van Sales Anti-Theft & Suspicion Radar (رادار الشبهات ومكافحة التلاعب لمناديب التوزيع)
  async getFraudRadarSummary(req: RequestWithAuth, days?: string, repId?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const summary = await this.vanSalesService.getFraudRadarSummary(tenantId, {
      days: days ? Number(days) : undefined,
      repId: repId ? Number(repId) : undefined,
    });
    return { ok: true, ...summary };
  }

  async getFraudRadarEvents(req: RequestWithAuth, days?: string, repId?: string, eventCode?: string, limit?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const events = await this.vanSalesService.getFraudRadarEvents(tenantId, {
      days: days ? Number(days) : undefined,
      repId: repId ? Number(repId) : undefined,
      eventCode: eventCode || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { ok: true, events };
  }
}
