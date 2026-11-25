import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { VanFleetService } from './van-fleet.service';
import { VanFraudRadarService } from './van-fraud-radar.service';
import type { RouteOptimizationResult } from '../route-optimization.engine';
import { VanRoutesVisitsSlice } from './van-routes/van-routes-visits.slice';
import { VanRoutesSupervisorSlice } from './van-routes/van-routes-supervisor.slice';
import { VanRoutesOptimizeSlice } from './van-routes/van-routes-optimize.slice';
// Note: clock-b5 §E pins this string in this file (the tenant-day filter lives in the visits slice):
// DATE(vfv.visited_at AT TIME ZONE ${tenantTimezone})

@Injectable()
export class VanRoutesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly vanFleetService: VanFleetService,
    private readonly fraudRadar?: VanFraudRadarService,
  ) {}

  private visitsSliceInstance?: VanRoutesVisitsSlice;
  private get visitsSlice(): VanRoutesVisitsSlice {
    return (this.visitsSliceInstance ??= new VanRoutesVisitsSlice(this.db, this.fraudRadar));
  }

  private supervisorSliceInstance?: VanRoutesSupervisorSlice;
  private get supervisorSlice(): VanRoutesSupervisorSlice {
    return (this.supervisorSliceInstance ??= new VanRoutesSupervisorSlice(this.db, this.vanFleetService));
  }

  private optimizeSliceInstance?: VanRoutesOptimizeSlice;
  private get optimizeSlice(): VanRoutesOptimizeSlice {
    return (this.optimizeSliceInstance ??= new VanRoutesOptimizeSlice(this.db, {
      listRepServedCustomerIds: (tenantId, repId) => this.visitsSlice.listRepServedCustomerIds(tenantId, repId),
    }));
  }

  async getDriverTodayItinerary(tenantId: string, repId: number, tripId?: number) {
    return this.visitsSlice.getDriverTodayItinerary(tenantId, repId, tripId);
  }

  async recordFieldVisit(
    arg1: string | number,
    arg2: string,
    arg3: string | number,
    payload: {
      tripId: number;
      customerId: number;
      visitType: 'positive' | 'negative';
      saleId?: number | null;
      negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
      postponedToDate?: string | null;
      gpsLat?: number | null;
      gpsLng?: number | null;
      notes?: string;
    },
  ) {
    return this.visitsSlice.recordFieldVisit(arg1, arg2, arg3, payload);
  }

  async listFieldVisits(
    tenantId: string,
    filters?: { repId?: number; customerId?: number; visitType?: string; dateFrom?: string; dateTo?: string },
  ) {
    return this.visitsSlice.listFieldVisits(tenantId, filters);
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    return this.supervisorSlice.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
  }

  async setCustomerRouteSchedule(
    tenantId: string,
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string | null;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    return this.supervisorSlice.setCustomerRouteSchedule(tenantId, customerId, payload);
  }

  async bulkAssignCustomerRoutes(
    tenantId: string,
    payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string | null;
      route?: string;
      visitDays?: string[];
    },
  ) {
    return this.supervisorSlice.bulkAssignCustomerRoutes(tenantId, payload);
  }

  async getSupervisorCustomerRoutes(
    tenantId: string,
    filters?: {
      search?: string;
      repId?: number | string;
      route?: string;
      unassignedOnly?: boolean;
    },
  ) {
    return this.supervisorSlice.getSupervisorCustomerRoutes(tenantId, filters);
  }

  async optimizeCustomerRoute(
    tenantId: string,
    payload: {
      customerIds?: number[];
      route?: string;
      repId?: number;
      startLat?: number | null;
      startLng?: number | null;
      persistSequence?: boolean;
      // H9 (D4): the rep acting on his own behalf. Only the driver
      // endpoint passes this; the supervisor endpoint does not, so a
      // supervisor editing routes is never gated by a rep's flag.
      actingRepId?: number;
    },
  ): Promise<RouteOptimizationResult & { persistedCount?: number }> {
    return this.optimizeSlice.optimizeCustomerRoute(tenantId, payload);
  }
}
