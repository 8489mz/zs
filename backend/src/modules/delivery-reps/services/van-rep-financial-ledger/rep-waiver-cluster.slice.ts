import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { isSoloAdminOverride } from '../../../../common/utils/manager-approval';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { resolveRepLinkedUserId } from '../van-common.util';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export class RepWaiverClusterSlice {
  private readonly verifySupervisorPin: VanRepFinancialLedgerDeps['verifySupervisorPin'];

  constructor(deps: VanRepFinancialLedgerDeps) {
    this.verifySupervisorPin = deps.verifySupervisorPin;
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the waiver approval threshold,
   * in tenant base-currency units. Settings-backed, defaulting to 500
   * — the Q6 (spirit review, large cash refunds only) equivalent:
   * Q6's threshold is default 500 via `posLargeCashRefundThreshold`;
   * the waiver threshold is a separate key so the two limits stay
   * independently settable. 0 means every waiver needs a supervisor
   * PIN (any positive amount exceeds 0). A missing, unparseable or
   * negative value falls back to the 500 default — a corrupt setting
   * never silently turns the PIN off. Mirrors the settings read in
   * returns.service.ts (getLargeCashRefundThreshold).
   */
  async getRepWaiverApprovalThreshold(trx: any, tenantId: string): Promise<number> {
    const row = await sql<{
      value?: string;
    }>`select value from settings where key = 'repWaiverApprovalThreshold' and tenant_id = ${tenantId}`.execute(trx);
    const raw = String(row.rows?.[0]?.value || '').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
      } catch {
        /* fall through to the plain-number parse */
      }
      const plain = Number(raw);
      if (Number.isFinite(plain) && plain >= 0) return plain;
    }
    return 500;
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the rep's linked login user id,
   * resolved exactly as verifySupervisorPin resolves it
   * (delivery_representatives.phone matched against users.phone or
   * users.username). Null when the rep has no linked login — the rep
   * can then never be the actor or the approver, so there is nothing
   * to refuse on this leg. Canonical implementation lives in
   * van-common.util (shared with the M18 audit attribution).
   */
  async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return resolveRepLinkedUserId(dbConn, tenantId, repId);
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the waiver approval gate.
   * Check order (deliberate): (1) reason — a waiver with no recorded
   * reason is refused before any other work; (2) maker-checker on the
   * ACTOR — the user waiving must differ from whoever settled the
   * trip (van_sales_trips.settled_by: the supervisor who decided the
   * shortage is charged to the rep) and from the rep himself; this
   * runs before the PIN check so a self-approval attempt fails without
   * consuming a PIN verification; (3) threshold + supervisor PIN —
   * above the threshold a supervisor PIN is verified via the shared
   * authorizeManagerSecret through verifySupervisorPin (never a
   * plaintext compare, never the rep's own PIN: account-mode
   * self-approval is already refused inside verifySupervisorPin);
   * (4) maker-checker on the APPROVER — an attributed (account-mode)
   * supervisor must also differ from the trip settler. The M4 custody
   * guard runs AFTER this gate: authorization is decided before
   * posting validity, so an unauthorized request is refused as
   * unauthorized, not as a custody problem.
   *
   * INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: legs (2) and (4) are excused
   * for the SAME person when he is an admin — the
   * shared isSoloAdminOverride helper (manager-approval.ts, created
   * by P5; no second copy here) returns true when the actor is
   * an admin/super_admin: no second-manager approval is ever
   * required (INV-SECOND-MANAGER-PASSWORD-REMOVED), whether or not another
   * admin exists in the tenant. The actor leg is excused when the actor is
   * the settler; the approver leg only when the attributed approver
   * is the actor himself (supervisorId === actorUserId) — a different
   * approver who happens to be the settler is still refused. The rep
   * leg is never excused. The gate reports whether the override bit
   * (soloOverrideUsed) plus the rounded waiver amount, so the caller
   * can stamp the waiver with a logged override instead of acting
   * silently; a waiver that passes without either leg biting reports
   * false and is stamped with nothing.
   *
   * Who "decided the load": the trip row records no loader
   * (van_sales_trips has no created_by; the load insert records no
   * actor and its stock movements carry userId null), so no
   * maker-checker against the original loader is enforceable from the
   * data. The enforceable decision-maker is the trip settler
   * (settled_by / supervisor_id), who decided at settleTrip whether
   * the shortage is charged to the rep or waived to warehouse losses
   * — that is the load decision this waiver would undo. When the trip
   * row is missing or settled_by is null the settler leg is skipped
   * (nothing recorded to compare against); the rep leg still applies.
   * A shared-PIN approval carries no identity, so the approver leg
   * cannot be checked in PIN mode — the actor leg is then the only
   * enforceable maker-checker check (the same honest limit
   * verifySupervisorPin documents).
   */
  async assertRepWaiverApproval(
    trxAny: any,
    tenantId: string,
    accountId: string,
    item: { rep_id?: number | null; trip_id?: number | null; amount?: number | string | null },
    payload: { reason?: string; notes?: string; supervisorPin?: string },
    actorUserId: number | null,
    auth: AuthContext,
  ): Promise<{ soloOverrideUsed: boolean; waiverAmount: number }> {
    const reason = String(payload.reason ?? payload.notes ?? '').trim();
    if (!reason) {
      throw new AppError(
        'سبب الإعفاء إلزامي — اكتب سبب الاعتماد الإداري قبل إعفاء البند',
        'REP_WAIVER_REASON_REQUIRED',
        400,
      );
    }
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
    const waiverAmount = roundMoney(Number(item.amount || 0), bookDigits);
    const repUserId = await this.resolveRepLinkedUserId(trxAny, tenantId, item.rep_id ? Number(item.rep_id) : null);
    let tripSettledBy: number | null = null;
    if (item.trip_id) {
      const tripRow = await trxAny
        .selectFrom('van_sales_trips')
        .select(['settled_by'])
        .where('id', '=', Number(item.trip_id))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      tripSettledBy = tripRow?.settled_by ? Number(tripRow.settled_by) : null;
    }
    let soloOverrideUsed = false;
    if (actorUserId && tripSettledBy && actorUserId === tripSettledBy) {
      // INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: an admin settled the
      // trip himself — he may waive alone with a logged override;
      // no second approval is required (INV-SECOND-MANAGER-PASSWORD-REMOVED).
      if (await isSoloAdminOverride(trxAny, tenantId, auth)) {
        soloOverrideUsed = true;
      } else {
        throw new AppError(
          'لا يجوز لمن اعتمد تصفية الرحلة أن يعفي عجزها بنفسه — يعتمد الإعفاء مشرف آخر (فصل المهام)',
          'REP_WAIVER_MAKER_CHECKER',
          403,
        );
      }
    }
    if (actorUserId && repUserId && actorUserId === repUserId) {
      throw new AppError(
        'لا يجوز للمندوب أن يعفي عجزه بنفسه — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
    }
    const threshold = await this.getRepWaiverApprovalThreshold(trxAny, tenantId);
    let supervisorId: number | null = null;
    if (waiverAmount > threshold) {
      const pin = String(payload.supervisorPin || '').trim();
      if (!pin) {
        throw new AppError(
          'الإعفاء فوق حد الاعتماد يتطلب رمز اعتماد المشرف (PIN)',
          'REP_WAIVER_SUPERVISOR_PIN_REQUIRED',
          403,
        );
      }
      const approval = await this.verifySupervisorPin(
        tenantId,
        pin,
        item.rep_id ? Number(item.rep_id) : null,
        trxAny,
        accountId,
      );
      if (!approval.approved) {
        throw new AppError(
          'رمز اعتماد المشرف (PIN) غير صحيح أو غير مصرح له بالاعتماد الاستثنائي',
          'INVALID_SUPERVISOR_PIN',
          403,
        );
      }
      supervisorId = approval.supervisorId ? Number(approval.supervisorId) : null;
    }
    if (supervisorId && tripSettledBy && supervisorId === tripSettledBy) {
      // INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: the attributed approver
      // is the solo admin actor himself (his own password as the PIN)
      // — excused only for that same person, never for a different
      // approver who happens to be the settler.
      if (supervisorId === actorUserId && (await isSoloAdminOverride(trxAny, tenantId, auth))) {
        soloOverrideUsed = true;
      } else {
        throw new AppError(
          'لا يجوز لمن اعتمد تصفية الرحلة أن يعتمد إعفاء عجزها — يعتمد الإعفاء مشرف آخر (فصل المهام)',
          'REP_WAIVER_MAKER_CHECKER',
          403,
        );
      }
    }
    return { soloOverrideUsed, waiverAmount };
  }
}
