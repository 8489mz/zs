import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { VanSalesService } from '../van-sales.service';
import { VanPromotionsService } from '../services/van-promotions.service';
import { VanRoutesService } from '../services/van-routes.service';
import { VanFieldExecutionService } from '../services/van-field-execution.service';

export class VanSalesAdminPromotionsLedgerSlice {
  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly vanPromotionsService: VanPromotionsService,
    private readonly vanRoutesService: VanRoutesService,
    private readonly vanFieldExecutionService: VanFieldExecutionService,
  ) {}

  async listAdminPromotions(req: RequestWithAuth, isActive?: string, promoType?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promotions = await this.vanPromotionsService.listPromotions(tenantId, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      promoType,
    });
    return { ok: true, promotions };
  }

  async createPromotion(req: RequestWithAuth, body: any) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.createPromotion(tenantId, body);
    return { ok: true, promotion: promo };
  }

  async updatePromotion(req: RequestWithAuth, id: number, body: any) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.updatePromotion(tenantId, id, body);
    return { ok: true, promotion: promo };
  }

  async deletePromotion(req: RequestWithAuth, id: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanPromotionsService.deletePromotion(tenantId, id);
    return res;
  }

  async togglePromotionActive(req: RequestWithAuth, id: number, body: { isActive: boolean }) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.toggleActive(tenantId, id, Boolean(body.isActive));
    return { ok: true, promotion: promo };
  }

  // =========================================================================
  // DYNAMIC ROUTE OPTIMIZATION (TSP)
  // =========================================================================

  async optimizeSupervisorRoute(
    req: RequestWithAuth,
    body: {
      customerIds?: number[];
      route?: string;
      repId?: number;
      startLat?: number;
      startLng?: number;
      persistSequence?: boolean;
    },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const result = await this.vanRoutesService.optimizeCustomerRoute(tenantId, body);
    return { ok: true, ...result };
  }

  // =========================================================================
  // FMCG VISITS, STRIKE RATE, TRADE SURVEYS & LIVE GPS BREADCRUMBS (SUPERVISOR)
  // =========================================================================

  async listVisitsHistory(
    req: RequestWithAuth,
    tripId?: string,
    repId?: string,
    customerId?: string,
    date?: string,
    noSaleOnly?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getVisitsHistory(tenantId, {
      tripId: tripId ? Number(tripId) : undefined,
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      date,
      noSaleOnly: noSaleOnly === 'true',
    });
  }

  async listTradeSurveys(req: RequestWithAuth, tripId?: string, customerId?: string, surveyType?: string) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getTradeSurveys(tenantId, {
      tripId: tripId ? Number(tripId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      surveyType,
    });
  }

  async getLiveTripBreadcrumbs(req: RequestWithAuth, tripId: number) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getLiveTripBreadcrumbs(tenantId, tripId);
  }

  async getRepFinancialLedger(
    req: RequestWithAuth,
    repId?: string,
    status?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getRepFinancialLedger(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
      dateFrom,
      dateTo,
    });
  }

  async settleRepFinancialItem(
    req: RequestWithAuth,
    id: number,
    body: { method: 'cash' | 'waiver'; notes?: string; reason?: string; supervisorPin?: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleRepFinancialItem(tenantId, accountId, id, body, req.authContext!);
  }

  async pushRepShortagesToPayroll(req: RequestWithAuth, body: { settlementIds: number[]; targetMonth?: string }) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.pushRepShortagesToPayroll(tenantId, accountId, body, req.authContext!);
  }

  async addRepBonusOrCommission(
    req: RequestWithAuth,
    body: { repId: number; entryType: 'bonus' | 'commission'; amount: number; notes: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.addRepBonusOrCommission(tenantId, accountId, body, req.authContext!);
  }

  async linkRepToEmployee(req: RequestWithAuth, body: { repId: number; employeeId: number | null }) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.linkRepToEmployee(tenantId, body.repId, body.employeeId);
  }

  async listCandidateEmployees(req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.listCandidateEmployees(tenantId);
  }

  async autoCreateEmployee(req: RequestWithAuth, body: { repId: number }) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.autoCreateEmployeeForRep(tenantId, accountId, body.repId, req.authContext!);
  }
}
