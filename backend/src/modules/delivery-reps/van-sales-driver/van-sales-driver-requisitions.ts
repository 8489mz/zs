import { Injectable } from '@nestjs/common';
import type { VanSalesService } from '../van-sales.service';
import { SubmitLoadRequisitionDto } from '../dto/submit-load-requisition.dto';

/**
 * Driver requisitions slice of the van-sales controller split (file #30, S4).
 * Pure move of the driver requisition and operations handlers out of
 * VanSalesController: bodies byte-identical, signatures minus NestJS
 * decorators only. The facade keeps thin delegates with the same names
 * and signatures. Bound deps only: the sales service plus the facade
 * kernel helper, passed bound so the moved bodies stay byte-identical.
 */
export interface VanSalesDriverRequisitionsDeps {
  vanSalesService: VanSalesService;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  verifyDriver: (
    authHeader: string,
  ) => Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }>;
}

@Injectable()
export class VanSalesDriverRequisitionsSlice {
  private readonly vanSalesService: VanSalesService;
  private readonly verifyDriver: VanSalesDriverRequisitionsDeps['verifyDriver'];

  constructor(deps: VanSalesDriverRequisitionsDeps) {
    this.vanSalesService = deps.vanSalesService;
    this.verifyDriver = deps.verifyDriver;
  }

  async submitLoadRequisition(authHeader: string, body: SubmitLoadRequisitionDto) {
    const driver = await this.verifyDriver(authHeader);
    // INV-DRIVER-REQUISITION-DTO-WHITELIST: the driver route never
    // forwards allowMultiplePending. The DTO rejects it at the
    // boundary and the controller forces false here, so a driver can
    // never bypass the single-pending-requisition rule. The admin
    // funnel (createLoadRequisitionByAdmin) is the only path that
    // sets the flag, from dispatchImmediately.
    return this.vanSalesService.submitLoadRequisition(driver.repId, driver.tenantId, driver.accountId, {
      sourceWarehouseId: body.sourceWarehouseId,
      items: body.items,
      notes: body.notes,
      allowMultiplePending: false,
    });
  }

  async listMyRequisitions(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const requisitions = await this.vanSalesService.listLoadRequisitions(driver.tenantId, { repId: driver.repId });
    return { ok: true, requisitions };
  }

  async cancelMyRequisition(authHeader: string, id: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.cancelLoadRequisitionByDriver(driver.tenantId, driver.repId, id);
  }

  async cancelMyRequisitionPost(authHeader: string, id: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.cancelLoadRequisitionByDriver(driver.tenantId, driver.repId, id);
  }

  async getDriverWarehouses(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const warehouses = await this.vanSalesService.getDriverWarehouses(driver.tenantId, driver.repId);
    return { ok: true, warehouses };
  }

  async getDriverAvailableProducts(authHeader: string, warehouseId?: string) {
    const driver = await this.verifyDriver(authHeader);
    const parsedWhId = warehouseId && warehouseId !== 'all' ? Number(warehouseId) : undefined;
    const products = await this.vanSalesService.getDriverAvailableProducts(driver.tenantId, parsedWhId, driver.repId);
    return { ok: true, products };
  }

  async getMyTarget(authHeader: string, month?: string) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getRepTarget(driver.tenantId, driver.repId, month);
  }

  async getMyItinerary(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const itinerary = await this.vanSalesService.getDriverTodayItinerary(driver.tenantId, driver.repId);
    return { ok: true, itinerary };
  }

  async createDriverCustomer(authHeader: string, body: any) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.createDriverCustomer(driver.repId, driver.tenantId, driver.accountId, body);
  }

  async recordFieldVisit(
    authHeader: string,
    body: {
      tripId: number;
      customerId: number;
      visitType: 'positive' | 'negative';
      saleId?: number;
      negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
      postponedToDate?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordFieldVisit(driver.tenantId, driver.accountId, driver.repId, body);
  }

  async recordFuelLog(
    authHeader: string,
    body: {
      vehicleId: number;
      tripId?: number;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordFuelLog(driver.tenantId, driver.accountId, driver.repId, body);
  }

  async listMyFuelLogs(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const logs = await this.vanSalesService.listFuelLogs(driver.tenantId, { repId: driver.repId });
    return { ok: true, logs };
  }

  async recordOilChange(
    authHeader: string,
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
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordOilChange(driver.tenantId, driver.accountId, driver.repId, body);
  }

  async getMyMaintenanceAlerts(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getFleetMaintenanceAlerts(driver.tenantId, undefined, driver.repId);
  }

  async createTransfer(
    authHeader: string,
    body: {
      toRepId: number;
      fromTripId?: number;
      toTripId?: number;
      items: { productId: number; qty: number }[];
      notes?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.createInterVanTransfer(driver.tenantId, driver.accountId, driver.repId, body);
  }

  async listMyTransfers(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const transfers = await this.vanSalesService.listInterVanTransfers(driver.tenantId, { repId: driver.repId });
    return { ok: true, transfers };
  }

  async acceptTransfer(authHeader: string, id: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.acceptInterVanTransfer(driver.tenantId, driver.accountId, driver.repId, id);
  }

  async rejectTransfer(authHeader: string, id: number, body: { reason?: string }) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.rejectInterVanTransfer(driver.tenantId, driver.repId, id, body?.reason);
  }

  async getPeerReps(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const reps = await this.vanSalesService.getPeerReps(driver.tenantId, driver.repId);
    return { ok: true, reps };
  }
}
