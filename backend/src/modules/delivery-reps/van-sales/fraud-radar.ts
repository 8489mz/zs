import type { VanFraudRadarService, RecordVanSuspicionParams } from '../services/van-fraud-radar.service';
import type { GetFraudRadarEventsOptions } from './van-sales-types';

export class FraudRadarService {
  constructor(private readonly vanFraudRadarService: VanFraudRadarService) {}
  async recordSuspicionEvent(params: RecordVanSuspicionParams) {
    return this.vanFraudRadarService.recordSuspicionEvent(params);
  }

  async getFraudRadarSummary(tenantId: string, options?: { days?: number; repId?: number }) {
    return this.vanFraudRadarService.getSummary(tenantId, options);
  }

  async getFraudRadarEvents(tenantId: string, options?: GetFraudRadarEventsOptions) {
    return this.vanFraudRadarService.getEvents(tenantId, options);
  }
}
