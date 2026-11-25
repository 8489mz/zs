import type { VanRoutesService } from '../services/van-routes.service';
import type {
  BulkAssignCustomerRoutesPayload,
  GetSupervisorCustomerRoutesFilters,
  RecordFieldVisitPayload,
  SetCustomerRouteSchedulePayload,
} from './van-sales-types';

export class RoutesService {
  constructor(private readonly vanRoutesService: VanRoutesService) {}
  // =========================================================================
  // ROUTES, VISITS & SUPERVISOR (Delegated to VanRoutesService)
  // =========================================================================

  async getDriverTodayItinerary(tenantId: string, repId: number, tripId?: number) {
    return this.vanRoutesService.getDriverTodayItinerary(tenantId, repId, tripId);
  }

  async recordFieldVisit(arg1: string | number, arg2: string, arg3: string | number, payload: RecordFieldVisitPayload) {
    return this.vanRoutesService.recordFieldVisit(arg1, arg2, arg3, payload);
  }

  async listFieldVisits(
    tenantId: string,
    filters?: { repId?: number; customerId?: number; visitType?: string; dateFrom?: string; dateTo?: string },
  ) {
    return this.vanRoutesService.listFieldVisits(tenantId, filters);
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    return this.vanRoutesService.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
  }

  async setCustomerRouteSchedule(tenantId: string, customerId: number, payload: SetCustomerRouteSchedulePayload) {
    return this.vanRoutesService.setCustomerRouteSchedule(tenantId, customerId, payload);
  }

  async bulkAssignCustomerRoutes(tenantId: string, payload: BulkAssignCustomerRoutesPayload) {
    return this.vanRoutesService.bulkAssignCustomerRoutes(tenantId, payload);
  }

  async getSupervisorCustomerRoutes(tenantId: string, filters?: GetSupervisorCustomerRoutesFilters) {
    return this.vanRoutesService.getSupervisorCustomerRoutes(tenantId, filters);
  }
}
