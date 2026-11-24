import { Kysely, sql } from '../../../../database/kysely';
import { AuditService } from '../../../../core/audit/audit.service';
import { AppError } from '../../../../common/errors/app-error';
import { formatDailyDocumentNumber } from '../../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { Database } from '../../../../database/database.types';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export type SettleRepFinancialItemBoundDeps = {
  assertRepWaiverApproval(
    trxAny: any,
    tenantId: string,
    accountId: string,
    item: { rep_id?: number | null; trip_id?: number | null; amount?: number | string | null },
    payload: { reason?: string; notes?: string; supervisorPin?: string },
    actorUserId: number | null,
    auth: AuthContext,
  ): Promise<{ soloOverrideUsed: boolean; waiverAmount: number }>;
  assertRepStockShortageCustodyLeg(
    trx: any,
    tenantId: string,
    item: { trip_id?: number | null },
    amount: number,
    bookDigits: MoneyDigits,
  ): Promise<void>;
  resolveRepShortageReceivingShift(
    trx: any,
    params: {
      tenantId: string;
      actorUserId: number | null;
      tripId: number | null;
    },
  ): Promise<{ id: number; branch_id: number | null; location_id: number | null }>;
  insertRepShortageCashRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      settlementItemId: number;
      repName: string;
      amount: number;
      shift: { id: number; branch_id: number | null; location_id: number | null };
      createdBy: number | null;
    },
  ): Promise<void>;
};

export class SettleRepFinancialItemSlice {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly bound: SettleRepFinancialItemBoundDeps;

  constructor(deps: VanRepFinancialLedgerDeps, bound: SettleRepFinancialItemBoundDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.bound = bound;
  }

  private async assertRepWaiverApproval(
    trxAny: any,
    tenantId: string,
    accountId: string,
    item: { rep_id?: number | null; trip_id?: number | null; amount?: number | string | null },
    payload: { reason?: string; notes?: string; supervisorPin?: string },
    actorUserId: number | null,
    auth: AuthContext,
  ): Promise<{ soloOverrideUsed: boolean; waiverAmount: number }> {
    return this.bound.assertRepWaiverApproval(trxAny, tenantId, accountId, item, payload, actorUserId, auth);
  }

  private async assertRepStockShortageCustodyLeg(
    trx: any,
    tenantId: string,
    item: { trip_id?: number | null },
    amount: number,
    bookDigits: MoneyDigits,
  ): Promise<void> {
    return this.bound.assertRepStockShortageCustodyLeg(trx, tenantId, item, amount, bookDigits);
  }

  private async resolveRepShortageReceivingShift(
    trx: any,
    params: {
      tenantId: string;
      actorUserId: number | null;
      tripId: number | null;
    },
  ): Promise<{ id: number; branch_id: number | null; location_id: number | null }> {
    return this.bound.resolveRepShortageReceivingShift(trx, params);
  }

  private async insertRepShortageCashRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      settlementItemId: number;
      repName: string;
      amount: number;
      shift: { id: number; branch_id: number | null; location_id: number | null };
      createdBy: number | null;
    },
  ): Promise<void> {
    return this.bound.insertRepShortageCashRow(trx, params);
  }

  /**
   * Settle a specific representative financial shortage/variance via cash receipt or administrative waiver.
   *
   * INV-REP-SHORTAGE-CASH-SETTLE: a cash settle is a real cash receipt, so
   * the journal, the drawer row and the status flip commit or roll back in
   * ONE transaction. The item is re-read under lock inside the transaction
   * and the status flip carries a status predicate, so a concurrent second
   * settle waits, then fails closed instead of collecting the same cash
   * twice. Cash is available only for shortage items: bonuses and
   * commissions leave through payroll, never through this cash receipt.
   * A waiver of a cash shortage (or a bonus/commission item) stays
   * record-only, exactly as before. A waiver of a pending stock
   * shortage charged to the rep reverses the trip-settlement custody
   * debit (INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: Dr 7200 / Cr 1160)
   * in the same transaction, before the status flip, so a posting
   * failure leaves the row pending instead of stranding Dr 1160.
   * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): both branches first verify
   * that a Dr 1160 custody leg actually stands for this item's trip
   * (see assertRepStockShortageCustodyLeg). Migration 0225 backfilled
   * pending stock_shortage rows without recording whether the rep was
   * charged, so a backfilled row may have no Dr 1160 at all — its
   * trip journal booked Dr 7200 / Cr 1140 instead. Waiving or
   * cash-settling such a row would post a Cr 1160 reversal against
   * nothing, so the guard fails closed with
   * REP_SHORTAGE_NO_CUSTODY_LEG, posts no journal, flips no status,
   * and the blocked attempt is written to audit_logs after the
   * transaction rolls back. The row stays pending for manual review.
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): every waiver also passes the
   * approval gate (assertRepWaiverApproval) BEFORE the M4 guard —
   * a reason is mandatory for every waiver, a waiver above the
   * threshold (settings key repWaiverApprovalThreshold, default 500
   * in tenant base-currency units, the Q6 equivalent; 0 = every
   * waiver needs a PIN) requires a supervisor PIN verified via the
   * shared authorizeManagerSecret, and neither the acting user nor
   * an attributed approver may be the user who settled the trip
   * (maker-checker). INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: when the
   * actor is the tenant's only admin and he settled the trip
   * himself, the maker-checker legs are excused for that same person
   * with a logged override — the waived item's notes carry a stamp
   * naming who settled, who approved, the amount, and that no second
   * admin was available, plus one audit_logs row in this same
   * transaction. The cash branch is untouched: PD3 is waiver-only.
   */
  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      method: 'cash' | 'waiver';
      notes?: string;
      reason?: string;
      supervisorPin?: string;
    },
    authContext: AuthContext,
  ) {
    if (payload.method !== 'cash' && payload.method !== 'waiver') {
      throw new AppError('طريقة التسوية غير معروفة', 'SETTLEMENT_METHOD_INVALID', 400);
    }
    const actorUserId = authContext.userId ? Number(authContext.userId) : null;
    return this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const item = await trxAny
        .selectFrom('van_rep_financial_settlements')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!item) {
        throw new AppError('بند التسوية غير موجود', 'SETTLEMENT_NOT_FOUND', 404);
      }

      if (item.status !== 'pending') {
        throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
      }

      const notes = payload.notes
        ? `${item.notes ? item.notes + ' | ' : ''}${payload.notes}`
        : item.notes;

      if (payload.method === 'waiver') {
        // M5 (INV-REP-WAIVER-APPROVAL-RULE): reason is mandatory for
        // every waiver, a waiver above the threshold needs a
        // supervisor PIN, and neither the actor nor an attributed
        // approver may be the user who settled the trip
        // (maker-checker). This gate runs BEFORE the M4 custody guard
        // below: authorization is decided before posting validity.
        // INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: the gate reports
        // whether the solo-admin override bit; the stamp (who settled,
        // who approved, the amount, no second admin available) is
        // appended to the waived item's notes only then.
        const waiverGate = await this.assertRepWaiverApproval(trxAny, tenantId, accountId, item, payload, actorUserId, authContext);
        const waiverReason = String(payload.reason ?? payload.notes ?? '').trim();
        const waiverNotes = `${item.notes ? item.notes + ' | ' : ''}${waiverReason}` + (waiverGate.soloOverrideUsed ? ` — اعتماد منفرد بقرار إداري — سوّى ${authContext.username} الرحلة واعتمد إعفاء عجز ${waiverGate.waiverAmount} بنفسه — لا يوجد مدير ثانٍ متاح` : '');
        // INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: a pending stock
        // shortage was charged to the rep at trip settlement
        // (Dr 1160 / Cr 1140). Waiving it must reverse that custody
        // debit (Dr 7200 / Cr 1160) in this same transaction, BEFORE
        // the status flip, so a posting throw leaves the row
        // pending. Cash-shortage waivers need no reversal (Dr 7200
        // already stands) and bonus/commission waivers post nothing.
        // A zero (or negative) stock shortage has nothing to reverse.
        let journalEntryId: number | null = null;
        const waiverEntryType = String(item.entry_type || '');
        if (waiverEntryType === 'stock_shortage') {
          const waiverBookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
          const waiverAmount = roundMoney(Number(item.amount || 0), waiverBookDigits);
          if (waiverAmount > 0) {
            // M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): only a shortage
            // trip settlement actually charged to the rep (Dr 1160)
            // may be waived into Dr 7200 / Cr 1160. A backfilled
            // row with no Dr 1160 leg fails closed here, before any
            // journal is posted or status flipped.
            await this.assertRepStockShortageCustodyLeg(trxAny, tenantId, item, waiverAmount, waiverBookDigits);
            // Branch/location mirror settleTrip: the trip's van
            // location, branch from that location's row; null when
            // the trip or the location row is missing.
            let waiverLocationId: number | null = null;
            let waiverBranchId: number | null = null;
            if (item.trip_id) {
              const waiverTrip = await trxAny
                .selectFrom('van_sales_trips')
                .select(['van_location_id'])
                .where('id', '=', Number(item.trip_id))
                .where('tenant_id', '=', tenantId)
                .executeTakeFirst();
              waiverLocationId = waiverTrip?.van_location_id ? Number(waiverTrip.van_location_id) : null;
              if (waiverLocationId) {
                const waiverVanLocRow = await trxAny
                  .selectFrom('stock_locations')
                  .select(['branch_id'])
                  .where('id', '=', waiverLocationId)
                  .where('tenant_id', '=', tenantId)
                  .executeTakeFirst();
                waiverBranchId = waiverVanLocRow?.branch_id ? Number(waiverVanLocRow.branch_id) : null;
              }
            }
            journalEntryId = await this.accountingPosting.postRepShortageWaiver(
              trx,
              id,
              { amount: waiverAmount, branchId: waiverBranchId, locationId: waiverLocationId },
              authContext,
            );
          }
        }
        const waived = await trxAny
          .updateTable('van_rep_financial_settlements')
          .set({
            status: 'waived',
            settlement_method: 'waiver',
            settled_at: sql`NOW()`,
            settled_by: actorUserId,
            receipt_voucher_no: null,
            notes: waiverNotes,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', id)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'pending')
          .returning('id')
          .execute();
        if (waived.length !== 1) {
          throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
        }
        if (waiverGate.soloOverrideUsed) {
          // INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE: the override audit row
          // commits in this same transaction, so a rolled-back waiver
          // leaves no override record behind.
          await this.audit.logWithExecutor(
            trxAny,
            'إعفاء عجز مندوب باعتماد منفرد',
            `اعتمد ${authContext.username} إعفاء عجز ${waiverGate.waiverAmount} للمندوب بعد أن سوّى الرحلة بنفسه (المسوّي ${actorUserId} / المعتمد ${actorUserId}) — لا يوجد مدير ثانٍ متاح`,
            authContext,
            { eventCode: 'REP_WAIVER_SOLO_ADMIN_OVERRIDE' },
          );
        }
        return {
          ok: true,
          id,
          status: 'waived',
          receiptVoucherNo: null,
          journalEntryId,
        };
      }

      const entryType = String(item.entry_type || '');
      if (entryType !== 'cash_shortage' && entryType !== 'stock_shortage') {
        throw new AppError(
          'السداد النقدي متاح لبنود العجز فقط؛ المكافآت والعمولات تُرحَّل للرواتب أو تُعفى إدارياً',
          'SETTLEMENT_CASH_UNSUPPORTED',
          422,
        );
      }

      const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const amount = roundMoney(Number(item.amount || 0), bookDigits);
      if (!(amount > 0)) {
        throw new AppError('مبلغ بند التسوية يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
      }

      // M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): a stock shortage may
      // only be collected in cash against a Dr 1160 custody leg trip
      // settlement actually charged to the rep. A backfilled row with
      // no such leg fails closed here, before the shift is resolved
      // or any journal is posted, so the operator sees the root cause
      // instead of an incidental missing-shift error. Cash shortages
      // need no custody leg — Dr 7200 already stands for them.
      if (entryType === 'stock_shortage') {
        await this.assertRepStockShortageCustodyLeg(trxAny, tenantId, item, amount, bookDigits);
      }

      const shift = await this.resolveRepShortageReceivingShift(trxAny, {
        tenantId,
        actorUserId,
        tripId: item.trip_id ? Number(item.trip_id) : null,
      });

      const journalEntryId = await this.accountingPosting.postRepShortageCashCollection(
        trx,
        id,
        {
          amount,
          entryType,
          branchId: shift.branch_id ? Number(shift.branch_id) : null,
          locationId: shift.location_id ? Number(shift.location_id) : null,
        },
        authContext,
      );

      const rep = item.rep_id
        ? await trxAny
          .selectFrom('delivery_representatives')
          .select(['name'])
          .where('id', '=', Number(item.rep_id))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
        : null;
      await this.insertRepShortageCashRow(trxAny, {
        tenantId,
        accountId,
        settlementItemId: id,
        repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
        amount,
        shift,
        createdBy: actorUserId,
      });

      // Deterministic voucher: the settlement item id is the sequence, so a
      // retried settle can never mint a second voucher number for one item.
      // The day part is the tenant business day (Clock P3).
      const receiptVoucherNo = formatDailyDocumentNumber('REC', id, new Date(), 4, await getTenantTimezone(trx, tenantId));

      const settled = await trxAny
        .updateTable('van_rep_financial_settlements')
        .set({
          status: 'settled',
          settlement_method: 'cash',
          settled_at: sql`NOW()`,
          settled_by: actorUserId,
          receipt_voucher_no: receiptVoucherNo,
          notes,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'pending')
        .returning('id')
        .execute();
      if (settled.length !== 1) {
        throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
      }

      return {
        ok: true,
        id,
        status: 'settled',
        receiptVoucherNo,
        journalEntryId,
      };
    }).catch(async (error: any) => {
      if (error?.code === 'REP_SHORTAGE_NO_CUSTODY_LEG') {
        // M4: the failing transaction already rolled back, so an
        // audit row written inside it would have vanished with it.
        // Record the blocked attempt AFTER the rollback, on a
        // separate committed write, so an admin can find it in the
        // audit log (event_code REP_SHORTAGE_NO_CUSTODY_LEG) while
        // the row stays pending in the ledger for manual review.
        // Best-effort only: a logging failure (a stub audit service
        // in a harness, a missing table) must never mask the
        // fail-closed error.
        try {
          await this.audit.log(
            'محاولة تسوية عجز مخزني بلا قيد عهدة',
            `تم إيقاف تسوية بند عجز مخزني #${id} بطريقة ${payload.method}: لا يوجد قيد مدين 1160 قائم لهذا البند — البند باقٍ معلق للمراجعة اليدوية`,
            authContext,
            { eventCode: 'REP_SHORTAGE_NO_CUSTODY_LEG' },
          );
        } catch {
          // The audit trail is best-effort; the fail-closed error stands.
        }
      }
      throw error;
    });
  }
}
