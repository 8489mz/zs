import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { VanFraudRadarService } from '../van-fraud-radar.service';
import { authorizeManagerSecret } from '../../../../common/utils/manager-approval';

@Injectable()
export class VanTripPinGatesService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly vanFraudRadarService: VanFraudRadarService,
  ) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Verifies a supervisor approval secret via the ONE shared
   * manager-approval rule (INV-SPIRIT-MANAGER-APPROVAL-SHARED /
   * INV-VAN-SUPERVISOR-PIN-AUTHORIZED): the shared manager PIN from
   * settings (bcrypt via authorizeManagerSecret; a legacy plaintext
   * stored value verifies once then hashes in place) or the login
   * password of an ACTIVE admin / super_admin. Plaintext
   * users.pin / pin_hash and delivery_representatives.pin_hash are
   * NEVER compared here: a bcrypt hash can never match a plaintext
   * comparison, so hashed PINs could never verify under the old code.
   * Maker-checker still enforced where the secret is attributable:
   * account mode carries the approver id, so the rep's own login
   * password approving his own operation is refused; PIN mode
   * carries no id — the shared PIN belongs to no single user, so no
   * attribution is invented (same honest limit as cash-drawer).
   * A shared-PIN approval therefore records no individual
   * (settled_by / supervisor_id / journal created_by stay null);
   * the old "first supervisor by id" attribution was false and is gone.
   */
  async verifySupervisorPin(
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ): Promise<{
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    supervisorRole?: string;
    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): HOW the approval
    // was given. 'pin' carries no user id (the shared PIN belongs to
    // no single user) — callers must record supervisor_id NULL plus
    // this mode, never fabricate an id; 'account' carries the
    // approving login's id in supervisorId.
    approvalMode?: 'pin' | 'account';
  }> {
    const cleanPin = String(pinInput || '').trim();
    if (!cleanPin) {
      return { approved: false };
    }

    const dbConn = queryable || this.anyDb;
    // Maker-checker needs the rep's linked login id only. The rep's
    // stored PIN values are never read for comparison here.
    let repUserId: number | null = null;
    if (repId && Number(repId) > 0) {
      const repRow = await dbConn
        .selectFrom('delivery_representatives')
        .select(['phone'])
        .where('id', '=', Number(repId))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (repRow?.phone) {
        const repUser = await dbConn
          .selectFrom('users')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`(phone = ${String(repRow.phone)} or username = ${String(repRow.phone)})`)
          .executeTakeFirst();
        if (repUser) {
          repUserId = Number(repUser.id);
        }
      }
    }

    // The shared rule needs tenant + account scope. Every production
    // caller passes its accountId; a direct caller that does not gets
    // the tenant's earliest user account as a best effort, and a
    // tenant with no users at all fails closed in requireTenantScope.
    let scopeAccountId = String(accountId || '').trim();
    if (!scopeAccountId) {
      try {
        const scopeUser = await dbConn
          .selectFrom('users')
          .select(['account_id'])
          .where('tenant_id', '=', tenantId)
          .orderBy('id', 'asc')
          .executeTakeFirst();
        scopeAccountId = String(scopeUser?.account_id || '').trim();
      } catch {
        scopeAccountId = '';
      }
    }
    const approvalAuth: AuthContext = {
      userId: 0,
      sessionId: 'van-supervisor-pin',
      username: 'supervisor-pin',
      role: 'supervisor',
      permissions: [],
      tenantId,
      accountId: scopeAccountId,
    };

    let approval: { mode: 'pin' | 'account'; authorizedByName: string; authorizedById?: number };
    try {
      approval = await authorizeManagerSecret(dbConn, approvalAuth, cleanPin);
    } catch (err) {
      const code = (err as AppError)?.code;
      if (code === 'MANAGER_AUTH_INVALID' || code === 'MANAGER_AUTH_REQUIRED') {
        await this.vanFraudRadarService.recordSuspicionEvent({
          tenantId,
          repId: repId ? Number(repId) : null,
          eventCode: 'VAN_SUSPICION_INVALID_PIN',
          severity: 'high',
          titleAr: 'إدخال رمز اعتماد مشرف (PIN) خاطئ أو غير مصرح',
          detailsAr: 'حاول المندوب إدخال رمز اعتماد مشرف غير صحيح لتمرير عملية استثنائية في الميدان.',
          // M18: the actor is the rep entering the PIN.
          actorUserId: repUserId,
        });
        throw new AppError(
          'رمز اعتماد المشرف (PIN) غير صحيح أو غير مصرح له بالاعتماد الاستثنائي',
          'INVALID_SUPERVISOR_PIN',
          403,
        );
      }
      throw err;
    }

    // Account mode carries attribution, so the rep approving his own
    // operation with his own login password is refused here. PIN mode
    // carries no id and is never attributed to any user.
    if (
      approval.mode === 'account' &&
      approval.authorizedById &&
      repUserId &&
      Number(approval.authorizedById) === repUserId
    ) {
      await this.vanFraudRadarService.recordSuspicionEvent({
        tenantId,
        repId: repId ? Number(repId) : null,
        eventCode: 'VAN_SUSPICION_SELF_APPROVAL',
        severity: 'critical',
        titleAr: 'محاولة اعتماد ذاتي من المندوب لنفسه (خرق فصل المهام Maker-Checker)',
        detailsAr: 'حاول المندوب إدخال رمزه السري الشخصي لاعتماد عملية استثنائية لنفسه في الميدان بدلاً من المشرف.',
        // M18: the actor is the rep attempting the self-approval.
        actorUserId: repUserId,
      });
      throw new AppError(
        'لا يجوز لمندوب المبيعات استخدام رمزه الشخصي لاعتماد عملياته الميدانية طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)',
        'MAKER_CHECKER_SELF_APPROVAL',
        403,
      );
    }

    if (approval.mode === 'account') {
      if (approval.authorizedById) {
        const supervisorUser = await dbConn
          .selectFrom('users')
          .select(['role', sql<string>`coalesce(display_name, username)`.as('name')])
          .where('id', '=', Number(approval.authorizedById))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        return {
          approved: true,
          supervisorId: Number(approval.authorizedById),
          supervisorName: String(supervisorUser?.name || approval.authorizedByName || 'مشرف معتمد'),
          supervisorRole: String(supervisorUser?.role || 'admin'),
          approvalMode: 'account',
        };
      }
      return {
        approved: true,
        supervisorName: String(approval.authorizedByName || 'مشرف معتمد'),
        supervisorRole: 'admin',
        approvalMode: 'account',
      };
    }

    return {
      approved: true,
      supervisorName: String(approval.authorizedByName || 'اعتماد المدير'),
      supervisorRole: 'supervisor',
      approvalMode: 'pin',
    };
  }

  /**
   * Checks whether the tenant requires supervisor PIN authorization for settling van trips.
   * Configurable via system settings (vanSettlementRequireSupervisorPin).
   * INV-VAN-SELF-SETTLE-PIN-REQUIRED: the PIN is required by DEFAULT
   * (fail closed). Only an explicit false setting disables it — a
   * missing row or an unparseable value never silently turns the PIN
   * off, because the driver settle endpoint must never let a rep
   * self-settle his own trip.
   */
  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('key', '=', 'vanSettlementRequireSupervisorPin'),
          eb('key', '=', 'van_settlement_require_supervisor_pin'),
        ]),
      )
      .executeTakeFirst();
    if (!row?.value) return true;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (parsed === false || parsed === 'false' || parsed === 0 || parsed === '0') return false;
      return true;
    } catch {
      return row.value === 'false' || row.value === '0' ? false : true;
    }
  }

  /**
   * Checks whether the tenant enforces blind cash settlement for van trips.
   * In blind settlement mode, expected cash target and breakdown are hidden from the representative,
   * requiring physical cash counting without target confirmation.
   * Configurable via system settings (vanSettlementBlindMode).
   */
  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([eb('key', '=', 'vanSettlementBlindMode'), eb('key', '=', 'van_settlement_blind_mode')]),
      )
      .executeTakeFirst();
    if (!row?.value) return false;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return Boolean(parsed === true || parsed === 'true' || parsed === 1 || parsed === '1');
    } catch {
      return row.value === 'true' || row.value === '1';
    }
  }
}
