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
    return this.db;
  }

  /**
   * Van-sales endpoints are reached via the driver's portal token, not a staff session, so there is
   * no AuthContext to post the journal under. When the acting rep is
   * named, the posting identity is his linked login — or honestly
   * NOBODY (userId 0): the sale path maps 0 to a NULL created_by
   * and the journal boundary (insertPostedJournal) maps
   * createdBy/postedBy <= 0 to NULL, so no journal ever names user
   * 0 or borrows the tenant's first active user for a sale he never
   * made. When NO rep is named the fallback below stays: those
   * callers are system actions (trip load journals) with no acting
   * rep, and the journal needs a real FK'd user.
   */
  /**
   * M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting identity
   * for a driver-originated journal. When the caller names the acting
   * rep, his linked login is the poster — the tenant's first active
   * user never sold or collected anything, so naming him as
   * created_by on the sale/collection/settlement journal was false
   * attribution. F20 (trial problem 38) closes the M18 follow-up:
   * when the rep has no linked login the identity is honestly 0
   * (NULL downstream), not the first active user — the posting
   * layer is 0-safe (sale.created_by maps 0 to null, and
   * insertPostedJournal maps createdBy/postedBy <= 0 to NULL).
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
      // F20 (trial problem 38): the rep is named but has no linked
      // login — return the honest "no user" (0), never the tenant's
      // first active user. The role/permissions stay 'admin' /
      // ['accounting'] (the posting identity, not a session), and
      // the sale + journal boundaries map 0 to NULL.
      return {
        userId: 0,
        sessionId: 'van-sales-system',
        username: 'van-sales-system',
        role: 'admin',
        permissions: ['accounting'],
        tenantId,
        accountId,
      };
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

  async verifySupervisorPin(
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ): Promise<VerifySupervisorPinResult> {
    return this.getTripLifecycle().verifySupervisorPin(tenantId, pinInput, repId, queryable, accountId);
  }

  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isSupervisorPinRequiredForSettlement(tenantId);
  }

  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isBlindSettlementEnabled(tenantId);
  }
}
