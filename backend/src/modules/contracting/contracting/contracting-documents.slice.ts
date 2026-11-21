import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingDocumentsService } from '../services/contracting-documents.service';
import {
  CreateEquipmentFuelLogDto,
  CreateContractingDocumentDto,
  CreateContractingDocumentRevisionDto,
  UpdateContractingDocumentRevisionStatusDto,
  DistributeContractingDocumentDto,
  CreateMeetingMinuteDto,
  CreateMeetingActionItemDto,
} from '../dto/contracting.dto';
import { ContractingEquipmentFuelLog } from '../contracting.types';

export class ContractingDocumentsSlice {
  private readonly documentsService: ContractingDocumentsService;

  constructor(private readonly db: Kysely<Database>) {
    this.documentsService = new ContractingDocumentsService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 15. Equipment Fuel & Operating Meter Logs
  // ==========================================================================

    async getEquipmentFuelLogs(auth: AuthContext, projectId: string): Promise<ContractingEquipmentFuelLog[]> {
    return this.documentsService.getEquipmentFuelLogs(auth, projectId);
  }

    async createEquipmentFuelLog(auth: AuthContext, projectId: string, dto: CreateEquipmentFuelLogDto): Promise<ContractingEquipmentFuelLog> {
    return this.documentsService.createEquipmentFuelLog(auth, projectId, dto);
  }

  // ==========================================================================
  // 41. Document Register (Drawing/Document Control — Procore/Autodesk Build Benchmark)
  // ==========================================================================

  async listDocuments(auth: AuthContext, projectId: string) {
    return this.documentsService.listDocuments(auth, projectId);
  }

  async getDocumentDetail(auth: AuthContext, documentId: string) {
    return this.documentsService.getDocumentDetail(auth, documentId);
  }

  async createDocument(auth: AuthContext, projectId: string, dto: CreateContractingDocumentDto) {
    return this.documentsService.createDocument(auth, projectId, dto);
  }

  async addDocumentRevision(auth: AuthContext, documentId: string, dto: CreateContractingDocumentRevisionDto) {
    return this.documentsService.addDocumentRevision(auth, documentId, dto);
  }

  async updateDocumentRevisionStatus(auth: AuthContext, revisionId: string, dto: UpdateContractingDocumentRevisionStatusDto) {
    return this.documentsService.updateDocumentRevisionStatus(auth, revisionId, dto);
  }

  async distributeDocument(auth: AuthContext, revisionId: string, dto: DistributeContractingDocumentDto) {
    return this.documentsService.distributeDocument(auth, revisionId, dto);
  }

  // ==========================================================================
  // 42. Meeting Minutes & Action Items
  // ==========================================================================

  async listMeetingMinutes(auth: AuthContext, projectId: string) {
    return this.documentsService.listMeetingMinutes(auth, projectId);
  }

  async getMeetingMinuteDetail(auth: AuthContext, minuteId: string) {
    return this.documentsService.getMeetingMinuteDetail(auth, minuteId);
  }

  async createMeetingMinute(auth: AuthContext, projectId: string, dto: CreateMeetingMinuteDto) {
    return this.documentsService.createMeetingMinute(auth, projectId, dto);
  }

  async addMeetingActionItem(auth: AuthContext, minuteId: string, dto: CreateMeetingActionItemDto) {
    return this.documentsService.addMeetingActionItem(auth, minuteId, dto);
  }

  async updateMeetingActionItemStatus(auth: AuthContext, actionItemId: string, status: 'open' | 'closed') {
    return this.documentsService.updateMeetingActionItemStatus(auth, actionItemId, status);
  }
}
