import type { VanFleetService } from '../services/van-fleet.service';
import type {
  AssignVehicleDriverPayload,
  CreateFleetVehiclePayload,
  RecordFuelLogPayload,
  RecordOilChangePayload,
  UpdateFleetVehiclePayload,
} from './van-sales-types';

export class FleetService {
  constructor(private readonly vanFleetService: VanFleetService) {}
  // =========================================================================
  // FLEET MANAGEMENT (Delegated to VanFleetService)
  // =========================================================================

  async listFleetVehicles(tenantId: string) {
    return this.vanFleetService.listFleetVehicles(tenantId);
  }

  async createFleetVehicle(tenantId: string, accountId: string, payload: CreateFleetVehiclePayload) {
    return this.vanFleetService.createFleetVehicle(tenantId, accountId, payload);
  }

  async updateFleetVehicle(tenantId: string, accountId: string, id: number, payload: UpdateFleetVehiclePayload) {
    return this.vanFleetService.updateFleetVehicle(tenantId, accountId, id, payload);
  }

  async assignVehicleRep(tenantId: string, vehicleId: number, repId: number | null, shiftName?: string) {
    return this.vanFleetService.assignVehicleRep(tenantId, vehicleId, repId, shiftName);
  }

  async recordFuelLog(tenantId: string, accountId: string, repId: number | null, payload: RecordFuelLogPayload) {
    return this.vanFleetService.recordFuelLog(tenantId, accountId, repId, payload);
  }

  async listFuelLogs(
    tenantId: string,
    filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string },
  ) {
    return this.vanFleetService.listFuelLogs(tenantId, filters);
  }

  async recordOilChange(tenantId: string, accountId: string, repId: number | null, payload: RecordOilChangePayload) {
    return this.vanFleetService.recordOilChange(tenantId, accountId, repId, payload);
  }

  async listOilChanges(tenantId: string, vehicleId?: number) {
    return this.vanFleetService.listOilChanges(tenantId, vehicleId);
  }

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    return this.vanFleetService.getFleetMaintenanceAlerts(tenantId, vehicleId, repId);
  }

  async listVehicleDrivers(tenantId: string, vehicleId: number) {
    return this.vanFleetService.listVehicleDrivers(tenantId, vehicleId);
  }

  async assignVehicleDriver(tenantId: string, accountId: string, payload: AssignVehicleDriverPayload) {
    return this.vanFleetService.assignVehicleDriver(tenantId, accountId, payload);
  }

  async removeVehicleDriver(tenantId: string, assignmentId: number) {
    return this.vanFleetService.removeVehicleDriver(tenantId, assignmentId);
  }
}
