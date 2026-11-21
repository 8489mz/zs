import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingQualityService } from '../services/contracting-quality.service';
import {
  CreateInspectionRequestDto,
  UpdateInspectionRequestStatusDto,
  CreateSnagItemDto,
  UpdateSnagItemStatusDto,
  CreateProjectHandoverDto,
  ApproveProjectHandoverDto,
  CreateSubmittalDto,
  UpdateSubmittalStatusDto,
  CreateMaterialEscalationDto,
  UpdateMaterialEscalationStatusDto,
  CreateSubcontractorBackchargeDto,
  UpdateBackchargeStatusDto,
} from '../dto/contracting.dto';
import {
  ContractingInspectionRequest,
  ContractingSnagItem,
  ContractingProjectHandover,
  ContractingSubmittal,
  ContractingMaterialEscalation,
  ContractingSubcontractorBackcharge,
} from '../contracting.types';

export class ContractingQualitySlice {
  private readonly qualityService: ContractingQualityService;

  constructor(private readonly db: Kysely<Database>) {
    this.qualityService = new ContractingQualityService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 33. Work Inspection Requests (WIR - طلبات فحص واستلام الأعمال الإنشائية)
  // ==========================================================================

  async getInspectionRequests(auth: AuthContext, projectId: string, status?: string): Promise<ContractingInspectionRequest[]> {
    return this.qualityService.getInspectionRequests(auth, projectId, status);
  }

  async createInspectionRequest(auth: AuthContext, projectId: string, dto: CreateInspectionRequestDto): Promise<ContractingInspectionRequest> {
    return this.qualityService.createInspectionRequest(auth, projectId, dto);
  }

  async updateInspectionRequestStatus(auth: AuthContext, id: string, dto: UpdateInspectionRequestStatusDto) {
    return this.qualityService.updateInspectionRequestStatus(auth, id, dto);
  }

  async deleteInspectionRequest(auth: AuthContext, id: string) {
    return this.qualityService.deleteInspectionRequest(auth, id);
  }

  // ==========================================================================
  // 34. Snag Items & Punch List (قائمة الملاحظات وعيوب المصنعية والتسليم)
  // ==========================================================================

  async getSnagItems(auth: AuthContext, projectId: string, status?: string, severity?: string): Promise<ContractingSnagItem[]> {
    return this.qualityService.getSnagItems(auth, projectId, status, severity);
  }

  async createSnagItem(auth: AuthContext, projectId: string, dto: CreateSnagItemDto): Promise<ContractingSnagItem> {
    return this.qualityService.createSnagItem(auth, projectId, dto);
  }

  async updateSnagItemStatus(auth: AuthContext, id: string, dto: UpdateSnagItemStatusDto) {
    return this.qualityService.updateSnagItemStatus(auth, id, dto);
  }

  async deleteSnagItem(auth: AuthContext, id: string) {
    return this.qualityService.deleteSnagItem(auth, id);
  }

  // ==========================================================================
  // 35. Project Handovers & Releases (محاضر التسليم الابتدائي والنهائي)
  // ==========================================================================

  async getProjectHandovers(auth: AuthContext, projectId: string): Promise<ContractingProjectHandover[]> {
    return this.qualityService.getProjectHandovers(auth, projectId);
  }

  async createProjectHandover(auth: AuthContext, projectId: string, dto: CreateProjectHandoverDto): Promise<ContractingProjectHandover> {
    return this.qualityService.createProjectHandover(auth, projectId, dto);
  }

  async approveProjectHandover(auth: AuthContext, id: string, dto: ApproveProjectHandoverDto) {
    return this.qualityService.approveProjectHandover(auth, id, dto);
  }

  // ==========================================================================
  // 12. Material & Shop Drawing Submittals (MAR / MAS)
  // ==========================================================================

  async getSubmittals(auth: AuthContext, projectId: string): Promise<ContractingSubmittal[]> {
    return this.qualityService.getSubmittals(auth, projectId);
  }

  async createSubmittal(auth: AuthContext, projectId: string, dto: CreateSubmittalDto): Promise<ContractingSubmittal> {
    return this.qualityService.createSubmittal(auth, projectId, dto);
  }

  async updateSubmittalStatus(auth: AuthContext, id: string, dto: UpdateSubmittalStatusDto) {
    return this.qualityService.updateSubmittalStatus(auth, id, dto);
  }

  // ==========================================================================
  // 13. Material Price Escalation Claims
  // ==========================================================================

  async getMaterialEscalations(auth: AuthContext, projectId: string): Promise<ContractingMaterialEscalation[]> {
    return this.qualityService.getMaterialEscalations(auth, projectId);
  }

  async createMaterialEscalation(auth: AuthContext, projectId: string, dto: CreateMaterialEscalationDto): Promise<ContractingMaterialEscalation> {
    return this.qualityService.createMaterialEscalation(auth, projectId, dto);
  }

  async updateMaterialEscalationStatus(auth: AuthContext, id: string, dto: UpdateMaterialEscalationStatusDto) {
    return this.qualityService.updateMaterialEscalationStatus(auth, id, dto);
  }

  // ==========================================================================
  // 14. Subcontractor Back-Charges & Deductions
  // ==========================================================================

  async getSubcontractorBackcharges(auth: AuthContext, projectId: string): Promise<ContractingSubcontractorBackcharge[]> {
    return this.qualityService.getSubcontractorBackcharges(auth, projectId);
  }

  async createSubcontractorBackcharge(auth: AuthContext, projectId: string, dto: CreateSubcontractorBackchargeDto): Promise<ContractingSubcontractorBackcharge> {
    return this.qualityService.createSubcontractorBackcharge(auth, projectId, dto);
  }

  async updateBackchargeStatus(auth: AuthContext, id: string, dto: UpdateBackchargeStatusDto) {
    return this.qualityService.updateBackchargeStatus(auth, id, dto);
  }
}
