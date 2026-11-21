import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  CreateMasterBoqLibraryItemDto,
  UpdateMasterBoqLibraryItemDto,
  BatchImportMasterBoqDto,
  ImportMasterBoqToProjectDto,
  SaveBoqTakeoffsDto,
} from '../dto/contracting.dto';
import { ContractingProjectSummary } from '../contracting.types';
import { ContractingMasterBoqService } from '../services/contracting-master-boq.service';

export interface ContractingMasterBoqSliceBoundDeps {
  // getProjectById lives in the projects slice (ContractingProjectsSlice);
  // called by the master-boq sub-service inside importMasterBoqItemsToProject.
  getProjectById: (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>;
}

export class ContractingMasterBoqSlice {
  private readonly masterBoqService: ContractingMasterBoqService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingMasterBoqSliceBoundDeps,
  ) {
    this.masterBoqService = new ContractingMasterBoqService({
      db: this.db,
      getProjectById: this.bound.getProjectById,
    });
  }

  // ==========================================================================
  // 24. Multi-Trade Master BOQ Library (بنك بنود المقاولات المرجعي وسحب التخصصات)
  // ==========================================================================

  async getMasterBoqTrades(auth: AuthContext) {
    return this.masterBoqService.getMasterBoqTrades(auth);
  }

  async getMasterBoqLibrary(auth: AuthContext, query?: { tradeCategory?: string; search?: string; status?: string }) {
    return this.masterBoqService.getMasterBoqLibrary(auth, query);
  }

  async createMasterBoqItem(auth: AuthContext, dto: CreateMasterBoqLibraryItemDto) {
    return this.masterBoqService.createMasterBoqItem(auth, dto);
  }

  async bulkImportMasterBoqItems(auth: AuthContext, dto: BatchImportMasterBoqDto) {
    return this.masterBoqService.bulkImportMasterBoqItems(auth, dto);
  }

  async updateMasterBoqItem(auth: AuthContext, id: string, dto: UpdateMasterBoqLibraryItemDto) {
    return this.masterBoqService.updateMasterBoqItem(auth, id, dto);
  }

  async toggleMasterBoqItemStatus(auth: AuthContext, id: string, targetActive?: boolean) {
    return this.masterBoqService.toggleMasterBoqItemStatus(auth, id, targetActive);
  }

  async deleteMasterBoqItem(auth: AuthContext, id: string) {
    return this.masterBoqService.deleteMasterBoqItem(auth, id);
  }

  async importMasterBoqItemsToProject(auth: AuthContext, projectId: string, dto: ImportMasterBoqToProjectDto) {
    return this.masterBoqService.importMasterBoqItemsToProject(auth, projectId, dto);
  }

  // ==========================================================================
  // 25. BOQ CAD Quantity Takeoffs (شيت حصر الكميات الهندسي باللوحات والأبعاد)
  // ==========================================================================

  async getTakeoffsByBoqItem(auth: AuthContext, boqItemId: string) {
    return this.masterBoqService.getTakeoffsByBoqItem(auth, boqItemId);
  }

  async saveTakeoffs(auth: AuthContext, boqItemId: string, dto: SaveBoqTakeoffsDto) {
    return this.masterBoqService.saveTakeoffs(auth, boqItemId, dto);
  }
}
