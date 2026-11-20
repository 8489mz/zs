import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { resolveRepLinkedUserId } from '../services/van-common.util';
import { VanTripLifecycleService } from '../services/van-trip-lifecycle.service';
import type { VerifySupervisorPinResult } from './van-sales-types';

export class AuthAndPinService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly getTripLifecycle: () => VanTripLifecycleService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Van-sales endpoints are reached via the driver's portal token, not a staff session, so there is
   * no AuthContext to post the journal under. Falls back to the tenant's earliest active user rather
   * than a bare id — journal_entries.created_by/posted_by are FK'd to users(id), and an id that
   * doesn't exist there fails the insert.
   */
  /**
   * M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting identity
   * for a driver-originated journal. When the caller names the acting
   * rep, his linked login is the poster — the tenant's first active
   * user never sold or collected anything, so naming him as
   * created_by on the sale/collection/settlement journal was false
   * attribution. When the rep has no linked login (or no rep is
   * named) the old first-active-user fallback stays: making that
   * honestly null needs a posting-layer decision (AuthContext.userId
   * is number-typed and sale.created_by feeds postSale's fallback),
   * recorded as a follow-up, not bundled here.
   */
  async resolveSystemAuthContext(tenantId: string, accountId: string, repId?: number | null): Promise<AuthContext> {
    if (repId && Number(repId) > 0) {
      const linkedUserId = await resolveRepLinkedUserId(this.anyDb, tenantId, Number(repId));
      if (linkedUserId) {
        return {
          userId: linkedUserId,
          sessionId: 'van-sales-system',
          username: 'van-sales-system',
          role: 'admin',
          permissions: ['accounting'],
          tenantId,
          accountId,
        };
      }
    }
    const user = await this.anyDb
      .selectFrom('users')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .executeTakeFirst();

    return {
      userId: user ? Number(user.id) : 0,
      sessionId: 'van-sales-system',
      username: 'van-sales-system',
      role: 'admin',
      permissions: ['accounting'],
      tenantId,
      accountId,
    };
  }

  async verifySupervisorPin(tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null): Promise<VerifySupervisorPinResult> {
    return this.getTripLifecycle().verifySupervisorPin(tenantId, pinInput, repId, queryable, accountId);
  }

  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isSupervisorPinRequiredForSettlement(tenantId);
  }

  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isBlindSettlementEnabled(tenantId);
  }
}
