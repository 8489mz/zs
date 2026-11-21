import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { VanFraudRadarService, RecordVanSuspicionParams } from '../van-fraud-radar.service';

export type VanCollectionsAndSwapsDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  generateDailySequenceNumber: (trxOrDb: any, tableName: string, columnName: string, prefix: string, tenantId: string, date?: Date) => Promise<string>;
  recordSuspicionEvent: (params: RecordVanSuspicionParams) => Promise<void>;
  resolveSystemAuthContext: (tenantId: string, accountId: string, repId?: number | null) => Promise<AuthContext>;
  verifySupervisorPin: (tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null) => Promise<{ approved: boolean; supervisorId?: number; supervisorName?: string; supervisorRole?: string; approvalMode?: 'pin' | 'account' }>;
  moveVanStock: (trx: Kysely<Database>, params: { productId: number; delta: number; locationId: number; branchId?: number | null; tenantId: string; accountId: string; userId?: number | null; movementType: string; note: string; referenceType: string; referenceId: number; skipGlobalUpdate: boolean; unitCost?: number }) => Promise<{ scopeBefore: number; scopeAfter: number }>;
};
