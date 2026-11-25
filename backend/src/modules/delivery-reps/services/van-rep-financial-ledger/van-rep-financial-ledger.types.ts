import type { Kysely } from '../../../../database/kysely';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { Database } from '../../../../database/database.types';
import type { AccountingPostingService } from '../../../accounting/accounting-posting.service';

export type VanRepFinancialLedgerDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  verifySupervisorPin: (
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ) => Promise<{
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    supervisorRole?: string;
    approvalMode?: 'pin' | 'account';
  }>;
};
