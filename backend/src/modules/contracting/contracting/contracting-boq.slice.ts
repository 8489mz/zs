import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  CreateBoqItemDto,
  UpdateBoqItemDto,
  CreateChangeOrderDto,
  UpdateChangeOrderStatusDto,
  CreateCostSnapshotDto,
} from '../dto/contracting.dto';
import { ContractingProjectSummary } from '../contracting.types';
import { ContractingBoqService } from '../services/contracting-boq.service';

export interface ContractingBoqSliceBoundDeps {
  // getProjectById lives in the projects slice (ContractingProjectsSlice);
  // called by the boq sub-service inside createCostSnapshot.
  getProjectById: (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>;
}

export class ContractingBoqSlice {
  private readonly boqService: ContractingBoqService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingBoqSliceBoundDeps,
  ) {
    this.boqService = new ContractingBoqService({
      db: this.db,
      getProjectById: this.bound.getProjectById,
    });
  }

  // ==========================================================================
  // 2. BOQ (Bill of Quantities / Schedule of Values - SOV)
  // ==========================================================================

  async getBoqItems(auth: AuthContext, projectId: string) {
    return this.boqService.getBoqItems(auth, projectId);
  }

  async createBoqItem(auth: AuthContext, projectId: string, dto: CreateBoqItemDto) {
    return this.boqService.createBoqItem(auth, projectId, dto);
  }

  async batchCreateBoqItems(auth: AuthContext, projectId: string, items: CreateBoqItemDto[]) {
    return this.boqService.batchCreateBoqItems(auth, projectId, items);
  }

  async updateBoqItem(auth: AuthContext, id: string, dto: UpdateBoqItemDto) {
    return this.boqService.updateBoqItem(auth, id, dto);
  }

  async deleteBoqItem(auth: AuthContext, id: string) {
    return this.boqService.deleteBoqItem(auth, id);
  }

  // ==========================================================================
  // 3. Change Orders (أوامر التغيير والملحقات)
  // ==========================================================================

  async getChangeOrders(auth: AuthContext, projectId: string) {
    return this.boqService.getChangeOrders(auth, projectId);
  }

  async createChangeOrder(auth: AuthContext, projectId: string, dto: CreateChangeOrderDto) {
    return this.boqService.createChangeOrder(auth, projectId, dto);
  }

  async updateChangeOrderStatus(auth: AuthContext, id: string, dto: UpdateChangeOrderStatusDto) {
    return this.boqService.updateChangeOrderStatus(auth, id, dto);
  }

  // ==========================================================================
  // 14. Cost Baseline Snapshots (تجميد تكلفة وميزانية المشروع)
  // ==========================================================================

  async getCostSnapshots(auth: AuthContext, projectId: string) {
    return this.boqService.getCostSnapshots(auth, projectId);
  }

  async createCostSnapshot(auth: AuthContext, projectId: string, dto: CreateCostSnapshotDto) {
    return this.boqService.createCostSnapshot(auth, projectId, dto);
  }
}
