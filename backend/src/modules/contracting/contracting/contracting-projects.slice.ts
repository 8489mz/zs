import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingProjectsService } from '../services/contracting-projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  MarkTenderLostDto,
  AwardTenderDto,
} from '../dto/contracting.dto';
import { ContractingProjectSummary } from '../contracting.types';

export class ContractingProjectsSlice {
  private readonly projectsService: ContractingProjectsService;

  constructor(private readonly db: Kysely<Database>) {
    this.projectsService = new ContractingProjectsService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 1. Projects Management
  // ==========================================================================

  async getProjects(auth: AuthContext, query?: { status?: string; search?: string }) {
    return this.projectsService.getProjects(auth, query);
  }

  async getProjectById(auth: AuthContext, id: string): Promise<ContractingProjectSummary> {
    return this.projectsService.getProjectById(auth, id);
  }

  async createProject(auth: AuthContext, dto: CreateProjectDto) {
    return this.projectsService.createProject(auth, dto);
  }

  async updateProject(auth: AuthContext, id: string, dto: UpdateProjectDto) {
    return this.projectsService.updateProject(auth, id, dto);
  }

  async createTenderRevision(auth: AuthContext, id: string) {
    return this.projectsService.createTenderRevision(auth, id);
  }

  async markTenderLost(auth: AuthContext, id: string, dto: MarkTenderLostDto) {
    return this.projectsService.markTenderLost(auth, id, dto);
  }

  async awardTender(auth: AuthContext, id: string, dto: AwardTenderDto) {
    return this.projectsService.awardTender(auth, id, dto);
  }

  async deleteProject(auth: AuthContext, id: string) {
    return this.projectsService.deleteProject(auth, id);
  }
}
