import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanTargetsService } from '../services/van-targets.service';
import type {
  SaveCommissionConfigPayload,
  SetRepTargetCommissionRates,
  SettleRepCommissionPayload,
} from './van-sales-types';

export class TargetsService {
  constructor(private readonly vanTargetsService: VanTargetsService) {}

  // =========================================================================
  // REP TARGETS & PERFORMANCE (Delegated to VanTargetsService)
  // =========================================================================

  async setRepTarget(
    tenantId: string,
    accountId: string,
    repId: number,
    periodMonth: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: SetRepTargetCommissionRates,
  ) {
    return this.vanTargetsService.setRepTarget(
      tenantId,
      accountId,
      repId,
      periodMonth,
      targetAmount,
      collectionTarget,
      visitsTarget,
      commissionRates,
    );
  }

  async getRepTarget(tenantId: string, repId: number, periodMonth?: string) {
    return this.vanTargetsService.getRepTarget(tenantId, repId, periodMonth);
  }

  async listAllRepTargets(tenantId: string, periodMonth?: string) {
    return this.vanTargetsService.listAllRepTargets(tenantId, periodMonth);
  }

  async getCommissionConfig(tenantId: string) {
    return this.vanTargetsService.getCommissionConfig(tenantId);
  }

  async saveCommissionConfig(tenantId: string, accountId: string, payload: SaveCommissionConfigPayload) {
    return this.vanTargetsService.saveCommissionConfig(tenantId, accountId, payload);
  }

  async settleRepCommission(
    tenantId: string,
    accountId: string,
    auth: AuthContext,
    payload: SettleRepCommissionPayload,
  ) {
    return this.vanTargetsService.settleRepCommission(tenantId, accountId, auth, payload);
  }
}
