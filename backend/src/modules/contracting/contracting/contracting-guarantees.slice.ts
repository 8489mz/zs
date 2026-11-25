import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  CreateGuaranteeDto,
  UpdateGuaranteeDto,
  ExtendGuaranteeDto,
  ReleaseGuaranteeDto,
  InvokeGuaranteeDto,
  CreateCostPoolDto,
  CreateIndirectExpenseDto,
  CreateAllocationBatchDto,
} from '../dto/contracting.dto';
import { BankGuarantee } from '../guarantee-gateway.engine';
import { BatchAllocationSummary } from '../field-indirect-allocation.engine';
import { ContractingProjectSummary } from '../contracting.types';
import { ContractingGuaranteesService } from '../services/contracting-guarantees.service';

export interface ContractingGuaranteesSliceBoundDeps {
  // getProjectById lives in the projects slice (ContractingProjectsSlice);
  // getBoqItems lives in the boq slice (ContractingBoqSlice);
  // getSubcontractById + getSubcontractorById live in the subcontractors
  // slice (ContractingSubcontractorsSlice). getProjectById uses the
  // annotated form (the S-boq precedent — the facade delegate annotates
  // it); the other 3 use (...args: any[]) => any per the sub-services'
  // own precedent (boq service L40, guarantees service L60-63).
  getProjectById: (auth: AuthContext, id: string) => Promise<ContractingProjectSummary>;
  getBoqItems: (...args: any[]) => any;
  getSubcontractById: (...args: any[]) => any;
  getSubcontractorById: (...args: any[]) => any;
}

export class ContractingGuaranteesSlice {
  private readonly guaranteesService: ContractingGuaranteesService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingGuaranteesSliceBoundDeps,
  ) {
    this.guaranteesService = new ContractingGuaranteesService({
      db: this.db,
      getProjectById: this.bound.getProjectById,
      getBoqItems: this.bound.getBoqItems,
      getSubcontractById: this.bound.getSubcontractById,
      getSubcontractorById: this.bound.getSubcontractorById,
    });
  }

  // ==========================================================================
  // 38. Bank Guarantees & Gateway G1 Lifecycle Management (خطابات الضمان البنكية)
  // ==========================================================================

  async getGuaranteesRaw(
    tenantId: string,
    filters: { projectId?: string; subcontractId?: string; status?: string } = {},
  ): Promise<BankGuarantee[]> {
    return this.guaranteesService.getGuaranteesRaw(tenantId, filters);
  }

  async getGuarantees(
    auth: AuthContext,
    query: {
      projectId?: string;
      subcontractId?: string;
      subcontractorId?: number;
      status?: string;
      guaranteeType?: string;
    } = {},
  ) {
    return this.guaranteesService.getGuarantees(auth, query);
  }

  async getGuaranteeById(auth: AuthContext, id: string) {
    return this.guaranteesService.getGuaranteeById(auth, id);
  }

  async createGuarantee(auth: AuthContext, dto: CreateGuaranteeDto) {
    return this.guaranteesService.createGuarantee(auth, dto);
  }

  async updateGuarantee(auth: AuthContext, id: string, dto: UpdateGuaranteeDto) {
    return this.guaranteesService.updateGuarantee(auth, id, dto);
  }

  async extendGuarantee(auth: AuthContext, id: string, dto: ExtendGuaranteeDto) {
    return this.guaranteesService.extendGuarantee(auth, id, dto);
  }

  async releaseGuarantee(auth: AuthContext, id: string, dto: ReleaseGuaranteeDto) {
    return this.guaranteesService.releaseGuarantee(auth, id, dto);
  }

  async invokeGuarantee(auth: AuthContext, id: string, dto: InvokeGuaranteeDto) {
    return this.guaranteesService.invokeGuarantee(auth, id, dto);
  }

  async getGuaranteeExpiryAlerts(auth: AuthContext, projectId?: string) {
    return this.guaranteesService.getGuaranteeExpiryAlerts(auth, projectId);
  }

  // ==========================================================================
  // Track 1: Field Indirect Costs & Distributables Allocation (AACE RP 10S-90 / 34R-05)
  // ==========================================================================

  async initializeDefaultCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesService.initializeDefaultCostPools(auth, projectId);
  }

  async getCostPools(auth: AuthContext, projectId: string) {
    return this.guaranteesService.getCostPools(auth, projectId);
  }

  async createCostPool(auth: AuthContext, projectId: string, dto: CreateCostPoolDto) {
    return this.guaranteesService.createCostPool(auth, projectId, dto);
  }

  async getIndirectExpenses(auth: AuthContext, projectId: string, poolId?: string) {
    return this.guaranteesService.getIndirectExpenses(auth, projectId, poolId);
  }

  async createIndirectExpense(auth: AuthContext, projectId: string, dto: CreateIndirectExpenseDto) {
    return this.guaranteesService.createIndirectExpense(auth, projectId, dto);
  }

  async getAllocationBatches(auth: AuthContext, projectId: string) {
    return this.guaranteesService.getAllocationBatches(auth, projectId);
  }

  async previewBatchAllocation(
    auth: AuthContext,
    projectId: string,
    dto: CreateAllocationBatchDto,
  ): Promise<BatchAllocationSummary> {
    return this.guaranteesService.previewBatchAllocation(auth, projectId, dto);
  }

  async postBatchAllocation(auth: AuthContext, projectId: string, dto: CreateAllocationBatchDto) {
    return this.guaranteesService.postBatchAllocation(auth, projectId, dto);
  }
}
