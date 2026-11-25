import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanTripLifecycleService, VanTripSummary } from '../services/van-trip-lifecycle.service';
import type { VanFieldSalesService } from '../services/van-field-sales.service';
import type {
  GetActiveTripResult,
  ListDriverSalesFilters,
  LoadSupplementaryStockToActiveTripPayload,
  OpenTripAndLoadPayload,
  SettleTripPayload,
  SettleTripResult,
  SubmitTripSettlementPayload,
  SubmitTripSettlementResult,
} from './van-sales-types';

export class TripDelegatesService {
  constructor(
    private readonly getTripLifecycle: () => VanTripLifecycleService,
    private readonly getFieldSales: () => VanFieldSalesService,
  ) {}
  async getActiveTrip(repId: number, tenantId: string, accountId: string): Promise<GetActiveTripResult> {
    return this.getTripLifecycle().getActiveTrip(repId, tenantId, accountId);
  }

  async openTripAndLoad(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: OpenTripAndLoadPayload,
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.getTripLifecycle().openTripAndLoad(repId, tenantId, accountId, payload);
  }

  async loadSupplementaryStockToActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    tripId: number,
    payload: LoadSupplementaryStockToActiveTripPayload,
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.getTripLifecycle().loadSupplementaryStockToActiveTrip(repId, tenantId, accountId, tripId, payload);
  }

  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SubmitTripSettlementPayload,
  ): Promise<SubmitTripSettlementResult> {
    return this.getTripLifecycle().submitTripSettlement(repId, tenantId, accountId, payload);
  }

  async settleTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SettleTripPayload,
    authContext?: AuthContext,
  ): Promise<SettleTripResult> {
    return this.getTripLifecycle().settleTrip(repId, tenantId, accountId, payload, authContext);
  }

  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day cash due for one trip
  // (same buckets the settle step settles from).
  async getTripDueByDay(repId: number, tenantId: string, tripId: number) {
    return this.getTripLifecycle().getTripDueByDay(repId, tenantId, tripId);
  }

  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    return this.getTripLifecycle().listTripsForAdmin(tenantId, filters);
  }

  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    return this.getTripLifecycle().getTripDetailsForAdmin(tenantId, tripId, pagination);
  }

  async listDriverSales(tenantId: string, repId: number, filters?: ListDriverSalesFilters) {
    return this.getFieldSales().listDriverSales(tenantId, repId, filters);
  }
}
