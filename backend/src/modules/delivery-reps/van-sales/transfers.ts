import type { VanTransfersService } from '../services/van-transfers.service';
import type { CreateInterVanTransferPayload } from './van-sales-types';

export class TransfersService {
  constructor(private readonly vanTransfersService: VanTransfersService) {}

  // =========================================================================
  // INTER-VAN TRANSFERS (Delegated to VanTransfersService)
  // =========================================================================

  async createInterVanTransfer(
    tenantId: string,
    accountId: string,
    fromRepId: number,
    payload: CreateInterVanTransferPayload,
  ) {
    return this.vanTransfersService.createInterVanTransfer(tenantId, accountId, fromRepId, payload);
  }

  async acceptInterVanTransfer(tenantId: string, accountId: string, toRepId: number, transferId: number) {
    return this.vanTransfersService.acceptInterVanTransfer(tenantId, accountId, toRepId, transferId);
  }

  async rejectInterVanTransfer(tenantId: string, toRepId: number, transferId: number, reason?: string) {
    return this.vanTransfersService.rejectInterVanTransfer(tenantId, toRepId, transferId, reason);
  }

  async listInterVanTransfers(tenantId: string, filters?: { repId?: number; status?: string }) {
    return this.vanTransfersService.listInterVanTransfers(tenantId, filters);
  }

  async getPeerReps(tenantId: string, currentRepId: number) {
    return this.vanTransfersService.getPeerReps(tenantId, currentRepId);
  }
}
