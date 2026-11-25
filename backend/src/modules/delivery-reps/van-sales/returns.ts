import type { VanReturnsService } from '../services/van-returns.service';
import type { SubmitFieldReturnPayload } from './van-sales-types';

export class ReturnsService {
  constructor(private readonly vanReturnsService: VanReturnsService) {}

  // =========================================================================
  // FIELD RETURNS (Delegated to VanReturnsService)
  // =========================================================================

  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
    return this.vanReturnsService.getCustomerEligibleSales(tenantId, customerId, repId);
  }

  async submitFieldReturn(repId: number, tenantId: string, accountId: string, payload: SubmitFieldReturnPayload) {
    return this.vanReturnsService.submitFieldReturn(repId, tenantId, accountId, payload);
  }

  async listFieldReturns(
    tenantId: string,
    filters: { status?: string; repId?: number; tripId?: number; customerId?: number } = {},
  ) {
    return this.vanReturnsService.listFieldReturns(tenantId, filters);
  }

  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.vanReturnsService.approveFieldReturn(tenantId, accountId, returnId, approvedByUserId);
  }

  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    return this.vanReturnsService.rejectFieldReturn(tenantId, returnId, rejectionReason, rejectedByUserId);
  }
}
