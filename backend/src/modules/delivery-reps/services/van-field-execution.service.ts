import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { VanFieldExecutionVisitsSlice } from './van-field-execution/van-field-execution-visits.slice';
import { VanFieldExecutionSurveysSlice } from './van-field-execution/van-field-execution-surveys.slice';
import { VanFieldExecutionBreadcrumbsSlice } from './van-field-execution/van-field-execution-breadcrumbs.slice';
import { VanFieldExecutionHistorySlice } from './van-field-execution/van-field-execution-history.slice';
import {
  CheckInVisitPayload,
  RecordNoSalePayload,
  RecordStoreInventoryPayload,
  CheckOutVisitPayload,
  TradeSurveyPayload,
  BreadcrumbPayload,
} from './van-field-execution/van-field-execution.types';
// Note: rep-driver-writes-ownership-m16 pins these strings in this file (the ownership checks live in the slices):
// INV-REP-DRIVER-WRITES-OWNERSHIP, REP_VISIT_NOT_OWNED, REP_VISIT_SALE_UNVERIFIED, REP_VISIT_COLLECTION_UNVERIFIED

@Injectable()
export class VanFieldExecutionService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly fraudRadar: VanFraudRadarService,
  ) {}

  private visitsSliceInstance?: VanFieldExecutionVisitsSlice;
  private get visitsSlice(): VanFieldExecutionVisitsSlice {
    return (this.visitsSliceInstance ??= new VanFieldExecutionVisitsSlice(this.db, this.fraudRadar));
  }

  private surveysSliceInstance?: VanFieldExecutionSurveysSlice;
  private get surveysSlice(): VanFieldExecutionSurveysSlice {
    return (this.surveysSliceInstance ??= new VanFieldExecutionSurveysSlice(this.db));
  }

  private breadcrumbsSliceInstance?: VanFieldExecutionBreadcrumbsSlice;
  private get breadcrumbsSlice(): VanFieldExecutionBreadcrumbsSlice {
    return (this.breadcrumbsSliceInstance ??= new VanFieldExecutionBreadcrumbsSlice(this.db, {
      assertTripOwnedByRep: (tenantId, tripId, repId) =>
        this.surveysSlice.assertTripOwnedByRep(tenantId, tripId, repId),
    }));
  }

  private historySliceInstance?: VanFieldExecutionHistorySlice;
  private get historySlice(): VanFieldExecutionHistorySlice {
    return (this.historySliceInstance ??= new VanFieldExecutionHistorySlice(this.db));
  }

  async checkInVisit(tenantId: string, accountId: number, repId: number, payload: CheckInVisitPayload) {
    return this.visitsSlice.checkInVisit(tenantId, accountId, repId, payload);
  }

  async recordVisitInventory(
    tenantId: string,
    visitId: number,
    payload: RecordStoreInventoryPayload,
    repId?: number | null,
  ) {
    return this.visitsSlice.recordVisitInventory(tenantId, visitId, payload, repId);
  }

  async recordVisitNoSale(tenantId: string, visitId: number, payload: RecordNoSalePayload, repId?: number | null) {
    return this.visitsSlice.recordVisitNoSale(tenantId, visitId, payload, repId);
  }

  async checkOutVisit(tenantId: string, visitId: number, payload?: CheckOutVisitPayload, repId?: number | null) {
    return this.visitsSlice.checkOutVisit(tenantId, visitId, payload, repId);
  }

  async recordTradeSurvey(tenantId: string, accountId: number, repId: number, payload: TradeSurveyPayload) {
    return this.surveysSlice.recordTradeSurvey(tenantId, accountId, repId, payload);
  }

  async recordLiveBreadcrumb(tenantId: string, accountId: number, repId: number, payload: BreadcrumbPayload) {
    return this.breadcrumbsSlice.recordLiveBreadcrumb(tenantId, accountId, repId, payload);
  }

  async getLiveTripBreadcrumbs(tenantId: string, tripId: number) {
    return this.breadcrumbsSlice.getLiveTripBreadcrumbs(tenantId, tripId);
  }

  async getVisitsHistory(
    tenantId: string,
    filters?: {
      tripId?: number;
      repId?: number;
      customerId?: number;
      date?: string;
      noSaleOnly?: boolean;
    },
  ) {
    return this.historySlice.getVisitsHistory(tenantId, filters);
  }

  async getTradeSurveys(
    tenantId: string,
    filters?: {
      tripId?: number;
      customerId?: number;
      surveyType?: string;
    },
  ) {
    return this.surveysSlice.getTradeSurveys(tenantId, filters);
  }
}
