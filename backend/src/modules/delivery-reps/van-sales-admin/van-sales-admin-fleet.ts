import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VanSalesService } from '../van-sales.service';

export class VanSalesAdminFleetSlice {
  constructor(private readonly vanSalesService: VanSalesService) {}

  async listVehicles(req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.listFleetVehicles(tenantId);
    return { ok: true, vehicles };
  }

  async createVehicle(
    req: RequestWithAuth,

    body: {
      plateNumber: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      assignedRepId?: number;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.createFleetVehicle(tenantId, accountId, body);
    return { ok: true, vehicles };
  }

  async updateVehicle(
    req: RequestWithAuth,
    id: number,

    body: {
      plateNumber?: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      status?: string;
      assignedRepId?: number | null;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.updateFleetVehicle(tenantId, accountId, id, body);
    return { ok: true, vehicles };
  }

  async assignRep(req: RequestWithAuth, id: number, body: { repId: number | null; shiftName?: string }) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.assignVehicleRep(tenantId, id, body.repId, body.shiftName);
    return { ok: true, vehicles };
  }

  // Returns Management Endpoints
  async listReturns(req: RequestWithAuth, status?: string, repId?: string, tripId?: string, customerId?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const returns = await this.vanSalesService.listFieldReturns(tenantId, {
      status,
      repId: repId ? Number(repId) : undefined,
      tripId: tripId ? Number(tripId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
    });
    return { ok: true, returns };
  }

  async approveReturn(req: RequestWithAuth, id: number) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.approveFieldReturn(tenantId, accountId, id, userId);
    return res;
  }

  async rejectReturn(req: RequestWithAuth, id: number, body: { reason?: string }) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.rejectFieldReturn(tenantId, id, body.reason || '', userId);
    return res;
  }

  async getAdminAvailableProducts(req: RequestWithAuth, warehouseId?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const parsedWhId = warehouseId && warehouseId !== 'all' ? Number(warehouseId) : undefined;
    const products = await this.vanSalesService.getDriverAvailableProducts(tenantId, parsedWhId);
    return { ok: true, products };
  }

  // Requisitions Management Endpoints
  async listAdminRequisitions(req: RequestWithAuth, status?: string, repId?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const requisitions = await this.vanSalesService.listLoadRequisitions(tenantId, {
      status,
      repId: repId ? Number(repId) : undefined,
    });
    return { ok: true, requisitions };
  }

  async listAdminWarehouses(req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const warehouses = await this.vanSalesService.getDriverWarehouses(tenantId);
    return { ok: true, warehouses };
  }

  async createAdminRequisition(
    req: RequestWithAuth,

    body: {
      repId: number;
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      dispatchImmediately?: boolean;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.createLoadRequisitionByAdmin(tenantId, accountId, userId, body);
    return res;
  }

  async reviewRequisition(
    req: RequestWithAuth,
    id: number,
    body: { approvedItems: { productId: number; qty: number }[]; notes?: string; sourceWarehouseId?: number },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.reviewLoadRequisition(
      tenantId,
      id,
      body.approvedItems,
      body.notes,
      body.sourceWarehouseId,
    );
    return res;
  }

  async dispatchRequisition(req: RequestWithAuth, id: number) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.approveAndDispatchRequisition(tenantId, accountId, id, userId);
    return res;
  }

  async rejectRequisition(req: RequestWithAuth, id: number, body: { reason?: string }) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.rejectLoadRequisition(tenantId, id, body.reason || '', userId);
    return res;
  }

  async deleteRequisition(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.deleteLoadRequisition(tenantId, id);
    return res;
  }
}
