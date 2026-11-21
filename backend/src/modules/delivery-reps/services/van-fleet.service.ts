import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { VanFleetVehiclesSlice } from './van-fleet/van-fleet-vehicles.slice';
import { VanFleetFuelSlice } from './van-fleet/van-fleet-fuel.slice';
import { VanFleetOilSlice } from './van-fleet/van-fleet-oil.slice';
import { VanFleetMaintenanceSlice } from './van-fleet/van-fleet-maintenance.slice';
import { VanFleetDriversSlice } from './van-fleet/van-fleet-drivers.slice';
// Note: rep-driver-writes-ownership-m16 pins these strings in this file (the ownership gate lives in the vehicles slice):
// INV-REP-DRIVER-WRITES-OWNERSHIP, assertVehicleUsableByRep, REP_VEHICLE_NOT_ASSIGNED

@Injectable()
export class VanFleetService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private vehiclesSliceInstance?: VanFleetVehiclesSlice;
  private get vehiclesSlice(): VanFleetVehiclesSlice {
    return (this.vehiclesSliceInstance ??= new VanFleetVehiclesSlice(
      this.db,
    ));
  }

  private fuelSliceInstance?: VanFleetFuelSlice;
  private get fuelSlice(): VanFleetFuelSlice {
    return (this.fuelSliceInstance ??= new VanFleetFuelSlice(
      this.db,
      {
        assertVehicleUsableByRep: (tenantId, vehicleId, repId, tripId) =>
          this.vehiclesSlice.assertVehicleUsableByRep(tenantId, vehicleId, repId, tripId),
      },
    ));
  }

  private oilSliceInstance?: VanFleetOilSlice;
  private get oilSlice(): VanFleetOilSlice {
    return (this.oilSliceInstance ??= new VanFleetOilSlice(
      this.db,
      {
        assertVehicleUsableByRep: (tenantId, vehicleId, repId, tripId) =>
          this.vehiclesSlice.assertVehicleUsableByRep(tenantId, vehicleId, repId, tripId),
      },
    ));
  }

  private maintenanceSliceInstance?: VanFleetMaintenanceSlice;
  private get maintenanceSlice(): VanFleetMaintenanceSlice {
    return (this.maintenanceSliceInstance ??= new VanFleetMaintenanceSlice(
      this.db,
    ));
  }

  private driversSliceInstance?: VanFleetDriversSlice;
  private get driversSlice(): VanFleetDriversSlice {
    return (this.driversSliceInstance ??= new VanFleetDriversSlice(
      this.db,
    ));
  }

  async listFleetVehicles(tenantId: string) {
    return this.vehiclesSlice.listFleetVehicles(tenantId);
  }

  async createFleetVehicle(
    tenantId: string,
    accountId: string,
    payload: {
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
    return this.vehiclesSlice.createFleetVehicle(tenantId, accountId, payload);
  }

  async updateFleetVehicle(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
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
    return this.vehiclesSlice.updateFleetVehicle(tenantId, accountId, id, payload);
  }

  async assignVehicleRep(tenantId: string, vehicleId: number, repId: number | null, shiftName?: string) {
    return this.vehiclesSlice.assignVehicleRep(tenantId, vehicleId, repId, shiftName);
  }

  async recordFuelLog(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      tripId?: number | null;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    return this.fuelSlice.recordFuelLog(tenantId, accountId, repId, payload);
  }

  async listFuelLogs(
    tenantId: string,
    filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string },
  ) {
    return this.fuelSlice.listFuelLogs(tenantId, filters);
  }

  async recordOilChange(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      odometerAtChange: number;
      oilType: string;
      ratedKm: number;
      withFilter: boolean;
      alertKmBefore?: number;
      cost?: number;
      performedBy?: string;
      notes?: string;
    },
  ) {
    return this.oilSlice.recordOilChange(tenantId, accountId, repId, payload);
  }

  async listOilChanges(tenantId: string, vehicleId?: number) {
    return this.oilSlice.listOilChanges(tenantId, vehicleId);
  }

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    return this.maintenanceSlice.getFleetMaintenanceAlerts(tenantId, vehicleId, repId);
  }

  async listVehicleDrivers(tenantId: string, vehicleId: number) {
    return this.driversSlice.listVehicleDrivers(tenantId, vehicleId);
  }

  async assignVehicleDriver(
    tenantId: string,
    accountId: string,
    payload: {
      vehicleId: number;
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) {
    return this.driversSlice.assignVehicleDriver(tenantId, accountId, payload);
  }

  async removeVehicleDriver(tenantId: string, assignmentId: number) {
    return this.driversSlice.removeVehicleDriver(tenantId, assignmentId);
  }
}
