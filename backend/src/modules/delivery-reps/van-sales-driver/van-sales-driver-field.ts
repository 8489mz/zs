import { Injectable } from '@nestjs/common';
import type { VanSalesService } from '../van-sales.service';
import type { VanPromotionsService } from '../services/van-promotions.service';
import type { VanRoutesService } from '../services/van-routes.service';
import type { VanFieldExecutionService } from '../services/van-field-execution.service';

/**
 * Driver field slice of the van-sales controller split (file #30, S5).
 * Pure move of the driver field handlers out of VanSalesController:
 * bodies byte-identical, signatures minus NestJS decorators only.
 * The facade keeps thin delegates with the same names and signatures.
 * Bound deps only: the services plus the facade kernel helper,
 * passed bound so the moved bodies stay byte-identical.
 */
export interface VanSalesDriverFieldDeps {
  vanSalesService: VanSalesService;
  vanPromotionsService: VanPromotionsService;
  vanRoutesService: VanRoutesService;
  vanFieldExecutionService: VanFieldExecutionService;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  verifyDriver: (
    authHeader: string,
  ) => Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }>;
}

@Injectable()
export class VanSalesDriverFieldSlice {
  private readonly vanSalesService: VanSalesService;
  private readonly vanPromotionsService: VanPromotionsService;
  private readonly vanRoutesService: VanRoutesService;
  private readonly vanFieldExecutionService: VanFieldExecutionService;
  private readonly verifyDriver: VanSalesDriverFieldDeps['verifyDriver'];

  constructor(deps: VanSalesDriverFieldDeps) {
    this.vanSalesService = deps.vanSalesService;
    this.vanPromotionsService = deps.vanPromotionsService;
    this.vanRoutesService = deps.vanRoutesService;
    this.vanFieldExecutionService = deps.vanFieldExecutionService;
    this.verifyDriver = deps.verifyDriver;
  }

  async recordTripExpense(
    authHeader: string,
    tripId: number,
    body: {
      expenseType: string;
      amount: number;
      notes?: string;
      receiptPhotoUrl?: string;
      supervisorOverridePin?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordTripExpense(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      tripId,
    });
  }

  async getTripExpenses(authHeader: string, tripId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getTripExpenses(tripId, driver.tenantId, driver.repId);
  }

  // =========================================================================
  // RETURNABLE PACKAGING & EMPTIES LEDGER
  // =========================================================================

  async recordPackagingMovement(
    authHeader: string,
    tripId: number,
    body: { customerId?: number; packageType: string; deliveredQty: number; returnedQty: number; notes?: string },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordPackagingMovement(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      tripId,
    });
  }

  async getTripPackagingMovements(authHeader: string, tripId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getTripPackagingMovements(tripId, driver.tenantId, driver.repId);
  }

  async getCustomerPackagingBalance(authHeader: string, customerId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getCustomerPackagingBalance(customerId, driver.tenantId, driver.repId);
  }

  async getCustomerSuggestedOrder(authHeader: string, customerId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getCustomerSuggestedOrder(driver.tenantId, driver.accountId, driver.repId, customerId);
  }

  async getCustomerLastSoldPrices(authHeader: string, customerId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getCustomerLastSoldPrices(driver.tenantId, customerId, driver.repId);
  }

  async getCustomerFieldStatement(authHeader: string, customerId: number) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.getCustomerFieldStatement(driver.tenantId, customerId, driver.repId);
  }

  async listActivePromotions(authHeader: string) {
    const driver = await this.verifyDriver(authHeader);
    const promotions = await this.vanPromotionsService.listPromotions(driver.tenantId, { isActive: true });
    return { ok: true, promotions };
  }

  async evaluateCartPromotions(
    authHeader: string,
    body: { cartItems: any[]; invoiceSubtotal?: number; customerType?: string },
  ) {
    const driver = await this.verifyDriver(authHeader);
    const result = await this.vanPromotionsService.evaluateCart(driver.tenantId, body);
    return { ok: true, ...result };
  }

  async optimizeDriverRoute(
    authHeader: string,
    body: { customerIds?: number[]; startLat?: number; startLng?: number; persistSequence?: boolean; route?: string },
  ) {
    const driver = await this.verifyDriver(authHeader);
    const result = await this.vanRoutesService.optimizeCustomerRoute(driver.tenantId, {
      ...body,
      repId: driver.repId,
      // H9 (D4): the driver acts for himself here, so a persist is
      // gated on his own can_edit_routes flag (the supervisor
      // endpoint passes no actingRepId and is never gated by it).
      actingRepId: driver.repId,
    });
    return { ok: true, ...result };
  }

  // =========================================================================
  // FMCG STRUCTURED STORE VISITS & MERCHANDISING (DRIVER)
  // =========================================================================

  async checkInStoreVisit(
    authHeader: string,
    body: { tripId?: number; customerId: number; customerName?: string; latitude?: number; longitude?: number },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.checkInVisit(
      driver.tenantId,
      Number(driver.accountId || 0),
      driver.repId,
      body,
    );
  }

  async recordVisitInventory(authHeader: string, id: number, body: { items: any[] }) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.recordVisitInventory(driver.tenantId, id, body, driver.repId);
  }

  async recordVisitNoSale(authHeader: string, id: number, body: { noSaleReason: string; noSaleNotes?: string }) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.recordVisitNoSale(driver.tenantId, id, body, driver.repId);
  }

  async checkOutStoreVisit(
    authHeader: string,
    id: number,
    body: {
      hasSale?: boolean;
      saleId?: number;
      saleAmount?: number;
      hasCollection?: boolean;
      collectionAmount?: number;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.checkOutVisit(driver.tenantId, id, body, driver.repId);
  }

  async recordTradeSurvey(authHeader: string, body: any) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.recordTradeSurvey(
      driver.tenantId,
      Number(driver.accountId || 0),
      driver.repId,
      body,
    );
  }

  async recordBreadcrumb(
    authHeader: string,
    body: { tripId: number; latitude: number; longitude: number; speedKmh?: number; batteryLevel?: number },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanFieldExecutionService.recordLiveBreadcrumb(
      driver.tenantId,
      Number(driver.accountId || 0),
      driver.repId,
      body,
    );
  }
}
