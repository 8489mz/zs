import type { VanRequisitionDispatchService } from '../services/van-requisition-dispatch.service';
import type { VanRequisitionsService } from '../services/van-requisitions.service';
import type { CreateLoadRequisitionByAdminPayload, SubmitLoadRequisitionPayload } from './van-sales-types';

export class RequisitionsService {
  constructor(
    private readonly getRequisitionDispatch: () => VanRequisitionDispatchService,
    private readonly vanRequisitionsService: VanRequisitionsService,
  ) {}

  // =========================================================================
  // LOAD REQUISITIONS (Delegated to VanRequisitionsService)
  // =========================================================================

  async submitLoadRequisition(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: SubmitLoadRequisitionPayload,
  ) {
    return this.vanRequisitionsService.submitLoadRequisition(repId, tenantId, accountId, payload);
  }

  async createLoadRequisitionByAdmin(
    tenantId: string,
    accountId: string,
    userId: number,
    payload: CreateLoadRequisitionByAdminPayload,
  ) {
    return this.getRequisitionDispatch().createLoadRequisitionByAdmin(tenantId, accountId, userId, payload);
  }

  async listLoadRequisitions(tenantId: string, filters: { status?: string; repId?: number } = {}) {
    return this.vanRequisitionsService.listLoadRequisitions(tenantId, filters);
  }

  async reviewLoadRequisition(
    tenantId: string,
    requisitionId: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) {
    return this.vanRequisitionsService.reviewLoadRequisition(
      tenantId,
      requisitionId,
      approvedItems,
      notes,
      sourceWarehouseId,
    );
  }

  async approveAndDispatchRequisition(
    tenantId: string,
    accountId: string,
    requisitionId: number,
    reviewedByUserId: number,
  ) {
    return this.getRequisitionDispatch().approveAndDispatchRequisition(
      tenantId,
      accountId,
      requisitionId,
      reviewedByUserId,
    );
  }

  async rejectLoadRequisition(
    tenantId: string,
    requisitionId: number,
    rejectionReason: string,
    reviewedByUserId: number,
  ) {
    return this.vanRequisitionsService.rejectLoadRequisition(
      tenantId,
      requisitionId,
      rejectionReason,
      reviewedByUserId,
    );
  }

  async deleteLoadRequisition(tenantId: string, requisitionId: number) {
    return this.vanRequisitionsService.deleteLoadRequisition(tenantId, requisitionId);
  }

  async cancelLoadRequisitionByDriver(tenantId: string, repId: number, requisitionId: number) {
    return this.vanRequisitionsService.cancelLoadRequisitionByDriver(tenantId, repId, requisitionId);
  }

  async getDriverWarehouses(tenantId: string, repId?: number) {
    return this.vanRequisitionsService.getDriverWarehouses(tenantId, repId);
  }

  async getDriverAvailableProducts(tenantId: string, warehouseId?: number, repId?: number) {
    return this.vanRequisitionsService.getDriverAvailableProducts(tenantId, warehouseId, repId);
  }
}
