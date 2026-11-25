import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingSubcontractorsService } from '../services/contracting-subcontractors.service';
import { CreateSubcontractDto, CreateSubcontractorDto, UpdateSubcontractorDto } from '../dto/contracting.dto';

export class ContractingSubcontractorsSlice {
  private readonly subcontractorsService: ContractingSubcontractorsService;

  constructor(private readonly db: Kysely<Database>) {
    this.subcontractorsService = new ContractingSubcontractorsService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 5. Subcontractors Management (Commitments)
  // ==========================================================================

  async getSubcontracts(auth: AuthContext, projectId: string) {
    return this.subcontractorsService.getSubcontracts(auth, projectId);
  }

  async createSubcontract(auth: AuthContext, projectId: string, dto: CreateSubcontractDto) {
    return this.subcontractorsService.createSubcontract(auth, projectId, dto);
  }

  async getSubcontractById(auth: AuthContext, id: string) {
    return this.subcontractorsService.getSubcontractById(auth, id);
  }

  // ==========================================================================
  // 12. Subcontractors Directory & Financial Ledger (إدارة ودليل مقاولي الباطن وكشف الحساب)
  // ==========================================================================

  async getSubcontractors(auth: AuthContext, query?: { search?: string; tradeSpecialty?: string; status?: string }) {
    return this.subcontractorsService.getSubcontractors(auth, query);
  }

  async getSubcontractorById(auth: AuthContext, id: number) {
    return this.subcontractorsService.getSubcontractorById(auth, id);
  }

  async createSubcontractor(auth: AuthContext, dto: CreateSubcontractorDto) {
    return this.subcontractorsService.createSubcontractor(auth, dto);
  }

  async updateSubcontractor(auth: AuthContext, id: number, dto: UpdateSubcontractorDto) {
    return this.subcontractorsService.updateSubcontractor(auth, id, dto);
  }

  async deleteSubcontractor(auth: AuthContext, id: number) {
    return this.subcontractorsService.deleteSubcontractor(auth, id);
  }

  async getSubcontractorLedger(
    auth: AuthContext,
    subcontractorId: number,
    query?: { projectId?: string; fromDate?: string; toDate?: string },
  ) {
    return this.subcontractorsService.getSubcontractorLedger(auth, subcontractorId, query);
  }
}
