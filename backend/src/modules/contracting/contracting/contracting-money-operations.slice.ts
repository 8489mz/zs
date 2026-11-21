import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingMoneyOperationsService } from '../services/contracting-money-operations.service';
import {
  CreateRetentionRecordDto,
  ReleaseRetentionDto,
  CreatePaymentHoldDto,
  ReleasePaymentHoldDto,
  CreateSupplierReturnDto,
  CreateLaborAttendanceDto,
  CreatePettyCashDto,
  SettlePettyCashDto,
  CreateGovernmentLicenseDto,
} from '../dto/contracting.dto';

export class ContractingMoneyOperationsSlice {
  private readonly moneyOperationsService: ContractingMoneyOperationsService;

  constructor(private readonly db: Kysely<Database>) {
    this.moneyOperationsService = new ContractingMoneyOperationsService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 15. Retention & Guarantees Records
  // ==========================================================================

  async getRetentionRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getRetentionRecords(auth, query);
  }

  async createRetentionRecord(auth: AuthContext, projectId: string, dto: CreateRetentionRecordDto) {
    return this.moneyOperationsService.createRetentionRecord(auth, projectId, dto);
  }

  async releaseRetentionRecord(auth: AuthContext, id: string, dto: ReleaseRetentionDto) {
    return this.moneyOperationsService.releaseRetentionRecord(auth, id, dto);
  }

  // ==========================================================================
  // 16. Payment Holds (حجز دفعات لعيوب جودة أو تأخير)
  // ==========================================================================

  async getPaymentHolds(auth: AuthContext, query?: { projectId?: string; isReleased?: boolean }) {
    return this.moneyOperationsService.getPaymentHolds(auth, query);
  }

  async createPaymentHold(auth: AuthContext, projectId: string, dto: CreatePaymentHoldDto) {
    return this.moneyOperationsService.createPaymentHold(auth, projectId, dto);
  }

  async releasePaymentHold(auth: AuthContext, id: string, dto: ReleasePaymentHoldDto) {
    return this.moneyOperationsService.releasePaymentHold(auth, id, dto);
  }

  // ==========================================================================
  // 17. Supplier Returns & Credit Notes (أذون مرتجع الخامات)
  // ==========================================================================

  async getSupplierReturns(auth: AuthContext, query?: { projectId?: string }) {
    return this.moneyOperationsService.getSupplierReturns(auth, query);
  }

  async createSupplierReturn(auth: AuthContext, projectId: string, dto: CreateSupplierReturnDto) {
    return this.moneyOperationsService.createSupplierReturn(auth, projectId, dto);
  }

  // ==========================================================================
  // 18. Site Labor Attendance & Split Allocation
  // ==========================================================================

  async getLaborAttendance(auth: AuthContext, query?: { projectId?: string; workDate?: string }) {
    return this.moneyOperationsService.getLaborAttendance(auth, query);
  }

  async createLaborAttendance(auth: AuthContext, projectId: string, dto: CreateLaborAttendanceDto) {
    return this.moneyOperationsService.createLaborAttendance(auth, projectId, dto);
  }

  // ==========================================================================
  // 19. Petty Cash & Site Custody (العهد النقدية مع منع التكرار قبل الإغلاق)
  // ==========================================================================

  async getPettyCashRecords(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getPettyCashRecords(auth, query);
  }

  async createPettyCash(auth: AuthContext, projectId: string, dto: CreatePettyCashDto) {
    return this.moneyOperationsService.createPettyCash(auth, projectId, dto);
  }

  async settlePettyCash(auth: AuthContext, id: string, dto: SettlePettyCashDto) {
    return this.moneyOperationsService.settlePettyCash(auth, id, dto);
  }

  // ==========================================================================
  // 20. Government Licenses & Site Compliance
  // ==========================================================================

  async getGovernmentLicenses(auth: AuthContext, query?: { projectId?: string; status?: string }) {
    return this.moneyOperationsService.getGovernmentLicenses(auth, query);
  }

  async createGovernmentLicense(auth: AuthContext, projectId: string, dto: CreateGovernmentLicenseDto) {
    return this.moneyOperationsService.createGovernmentLicense(auth, projectId, dto);
  }
}
