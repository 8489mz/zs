import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingSiteOperationsService } from '../services/contracting-site-operations.service';
import {
  CreateDailyLogDto,
  CreateRfiDto,
  AnswerRfiDto,
  CreateScheduleTaskDto,
  UpdateScheduleTaskDto,
  CreateMaterialRequisitionDto,
} from '../dto/contracting.dto';

export class ContractingSiteOperationsSlice {
  private readonly siteOperationsService: ContractingSiteOperationsService;

  constructor(private readonly db: Kysely<Database>) {
    this.siteOperationsService = new ContractingSiteOperationsService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 6. Site Daily Logs (اليومية الميدانية للموقع)
  // ==========================================================================

  async getDailyLogs(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getDailyLogs(auth, projectId);
  }

  async createDailyLog(auth: AuthContext, projectId: string, dto: CreateDailyLogDto) {
    return this.siteOperationsService.createDailyLog(auth, projectId, dto);
  }

  // ==========================================================================
  // 7. RFIs (Technical Office Requests - استفسارات المهندس والاستشاري)
  // ==========================================================================

  async getRfiList(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getRfiList(auth, projectId);
  }

  async createRfi(auth: AuthContext, projectId: string, dto: CreateRfiDto) {
    return this.siteOperationsService.createRfi(auth, projectId, dto);
  }

  async answerRfi(auth: AuthContext, id: string, dto: AnswerRfiDto) {
    return this.siteOperationsService.answerRfi(auth, id, dto);
  }

  // ==========================================================================
  // 9. Schedule Tasks & Gantt / CPM
  // ==========================================================================

  async getScheduleTasks(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getScheduleTasks(auth, projectId);
  }

  async createScheduleTask(auth: AuthContext, projectId: string, dto: CreateScheduleTaskDto) {
    return this.siteOperationsService.createScheduleTask(auth, projectId, dto);
  }

  async updateScheduleTask(auth: AuthContext, id: string, dto: UpdateScheduleTaskDto) {
    return this.siteOperationsService.updateScheduleTask(auth, id, dto);
  }

  async deleteScheduleTask(auth: AuthContext, id: string) {
    return this.siteOperationsService.deleteScheduleTask(auth, id);
  }

  async getResourceLoadingHistogram(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getResourceLoadingHistogram(auth, projectId);
  }

  // ==========================================================================
  // 10. Material Requisitions (أذون صرف الخامات المباشرة على بنود المقايسة)
  // ==========================================================================

  async getMaterialRequisitions(auth: AuthContext, projectId: string) {
    return this.siteOperationsService.getMaterialRequisitions(auth, projectId);
  }

  async createMaterialRequisition(auth: AuthContext, projectId: string, dto: CreateMaterialRequisitionDto) {
    return this.siteOperationsService.createMaterialRequisition(auth, projectId, dto);
  }

  async deleteMaterialRequisition(auth: AuthContext, id: string) {
    return this.siteOperationsService.deleteMaterialRequisition(auth, id);
  }
}
