import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingPostingService } from '../services/contracting-posting.service';
import { CreateSubcontractorPaymentDto } from '../dto/contracting.dto';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';

export interface ContractingPostingSliceBoundDeps {
  getGuaranteesRaw: (...args: any[]) => any;
}

export class ContractingPostingSlice {
  private readonly postingService: ContractingPostingService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly bound: ContractingPostingSliceBoundDeps,
  ) {
    this.postingService = new ContractingPostingService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      getGuaranteesRaw: this.bound.getGuaranteesRaw,
    });
  }

  async postInvoiceJournalEntry(auth: AuthContext, invoiceId: string) {
    return this.postingService.postInvoiceJournalEntry(auth, invoiceId);
  }

  async createSubcontractorPayment(auth: AuthContext, dto: CreateSubcontractorPaymentDto) {
    return this.postingService.createSubcontractorPayment(auth, dto);
  }
}
