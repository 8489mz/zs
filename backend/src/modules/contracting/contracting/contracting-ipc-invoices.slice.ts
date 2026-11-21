import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingIpcInvoicesService } from '../services/contracting-ipc-invoices.service';
import { CreateIpcInvoiceDto } from '../dto/contracting.dto';

export interface ContractingIpcInvoicesSliceBoundDeps {
  getGuaranteesRaw: (...args: any[]) => any;
}

export class ContractingIpcInvoicesSlice {
  private readonly ipcInvoicesService: ContractingIpcInvoicesService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ContractingIpcInvoicesSliceBoundDeps,
  ) {
    this.ipcInvoicesService = new ContractingIpcInvoicesService({
      db: this.db,
      getGuaranteesRaw: this.bound.getGuaranteesRaw,
    });
  }

  // ==========================================================================
  // 4. Progress Billing / IPC Invoices (المستخلصات التراكمية AIA G702 / G703)
  // ==========================================================================

  async getInvoices(auth: AuthContext, projectId: string, type: 'client' | 'subcontractor' = 'client') {
    return this.ipcInvoicesService.getInvoices(auth, projectId, type);
  }

  async getInvoiceById(auth: AuthContext, id: string) {
    return this.ipcInvoicesService.getInvoiceById(auth, id);
  }

  async createInvoice(auth: AuthContext, projectId: string, dto: CreateIpcInvoiceDto) {
    return this.ipcInvoicesService.createInvoice(auth, projectId, dto);
  }

  async approveInvoice(auth: AuthContext, id: string) {
    return this.ipcInvoicesService.approveInvoice(auth, id);
  }
}
