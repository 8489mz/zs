/*
 * Rep financial ledger (van-sales split-5 out of VanSalesService).
 * Pure move: the 4 controller-called ledger methods
 * (getRepFinancialLedger, settleRepFinancialItem,
 * pushRepShortagesToPayroll, addRepBonusOrCommission) plus the 6
 * private helpers they alone use (waiver-approval gate, custody-leg
 * guard, shortage receiving-shift + cash-row, waiver threshold,
 * linked-user resolution), unchanged, behind the VanSalesService
 * delegating facade. The facade owns the injected services; this
 * service receives them bound via VanRepFinancialLedgerDeps, so the
 * moved bodies are byte-identical to the originals. The Category 1-a
 * date line inside pushRepShortagesToPayroll
 * (`new Date().toISOString().slice(0, 7)`) moves byte-identical —
 * the date fix itself is NOT in slice scope.
 * resolveRepLinkedUserId keeps a facade delegate: S4's
 * recordTripExpense calls it and S1's getTripLifecycle binds it.
 */
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { resolveRepLinkedUserId } from './van-common.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type VanRepFinancialLedgerDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  verifySupervisorPin: (tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null) => Promise<{ approved: boolean; supervisorId?: number; supervisorName?: string; supervisorRole?: string; approvalMode?: 'pin' | 'account' }>;
};

export class VanRepFinancialLedgerService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly verifySupervisorPin: VanRepFinancialLedgerDeps['verifySupervisorPin'];

  constructor(deps: VanRepFinancialLedgerDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.verifySupervisorPin = deps.verifySupervisorPin;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Get centralized financial ledger movements and summary for delivery representatives.
   */
  async getRepFinancialLedger(
    tenantId: string,
    filters: {
      repId?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    // Book digits resolved once (D4): the ledger summary totals
    // below round at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    let query = this.anyDb
      .selectFrom('van_rep_financial_settlements as fs')
      .innerJoin('delivery_representatives as dr', 'dr.id', 'fs.rep_id')
      .leftJoin('van_sales_trips as vt', 'vt.id', 'fs.trip_id')
      .leftJoin('users as u', 'u.id', 'fs.settled_by')
      .leftJoin('hr_employees as emp', 'emp.id', 'dr.employee_id')
      .select([
        'fs.id',
        'fs.tenant_id as tenantId',
        'fs.rep_id as repId',
        'dr.name as repName',
        'dr.phone as repPhone',
        'dr.employee_id as employeeId',
        'emp.display_name as employeeName',
        'emp.employee_no as employeeNo',
        'fs.trip_id as tripId',
        'vt.shift_name as shiftName',
        'dr.vehicle_plate as vehiclePlate',
        'fs.entry_type as entryType',
        sql<number>`cast(fs.amount as numeric)`.as('amount'),
        'fs.status',
        'fs.settled_at as settledAt',
        'fs.settled_by as settledById',
        'u.username as settledByName',
        'fs.settlement_method as settlementMethod',
        'fs.notes',
        'fs.receipt_voucher_no as receiptVoucherNo',
        'fs.payroll_run_id as payrollRunId',
        'fs.created_at as createdAt',
        'fs.updated_at as updatedAt',
      ])
      .where('fs.tenant_id', '=', tenantId);

    if (filters.repId) {
      query = query.where('fs.rep_id', '=', Number(filters.repId));
    }
    if (filters.status && filters.status !== 'all') {
      query = query.where('fs.status', '=', filters.status);
    }
    if (filters.dateFrom) {
      query = query.where('fs.created_at', '>=', new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.where('fs.created_at', '<=', end);
    }

    const rawItems = await query.orderBy('fs.created_at', 'desc').execute();

    const items = rawItems.map((r: any) => ({
      id: Number(r.id),
      tenantId: String(r.tenantId || r.tenant_id || r.tenantid || ''),
      repId: Number(r.repId || r.rep_id || r.repid || 0),
      repName: String(r.repName || r.rep_name || r.repname || ''),
      repPhone: r.repPhone || r.rep_phone || r.repphone || undefined,
      employeeId: (r.employeeId || r.employee_id || r.employeeid) ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
      employeeName: r.employeeName || r.employee_name || r.employeename || null,
      employeeNo: r.employeeNo || r.employee_no || r.employeeno || null,
      tripId: (r.tripId || r.trip_id || r.tripid) ? Number(r.tripId || r.trip_id || r.tripid) : null,
      shiftName: r.shiftName || r.shift_name || r.shiftname || null,
      vehiclePlate: r.vehiclePlate || r.vehicle_plate || r.vehicleplate || null,
      entryType: String(r.entryType || r.entry_type || r.entrytype || ''),
      amount: Number(r.amount || 0),
      status: String(r.status || 'pending'),
      settledAt: r.settledAt || r.settled_at || r.settledat || null,
      settledById: (r.settledById || r.settled_by || r.settledby) ? Number(r.settledById || r.settled_by || r.settledby) : null,
      settledByName: r.settledByName || r.settled_by_name || r.settledbyname || null,
      settlementMethod: r.settlementMethod || r.settlement_method || r.settlementmethod || null,
      notes: r.notes || null,
      receiptVoucherNo: r.receiptVoucherNo || r.receipt_voucher_no || r.receiptvoucherno || null,
      payrollRunId: (r.payrollRunId || r.payroll_run_id || r.payrollrunid) ? Number(r.payrollRunId || r.payroll_run_id || r.payrollrunid) : null,
      createdAt: r.createdAt || r.created_at || r.createdat,
      updatedAt: r.updatedAt || r.updated_at || r.updatedat,
    }));

    // INV-REP-LEDGER-SUMMARY-BALANCE (M7, A8): the summary is a
    // statement of what was charged vs earned over the FILTERED items
    // (the rep/status/date filters above already scope the query), so
    // the net balance counts every NON-WAIVED item on both sides:
    //   netBalance = commissionsDue - shortagesOwed, where
    //   commissionsDue = commission/bonus with status != 'waived',
    //   shortagesOwed = cash/stock shortage with status != 'waived'
    //     (pending + settled + pushed_to_payroll).
    // Grounded status meanings (read from the writers, not assumed):
    // - 'waived' is the ONLY extinguishing status. A waived stock
    //   shortage reverses its trip custody debit (Dr 7200 / Cr 1160,
    //   postRepShortageWaiver) and a waived bonus/commission posts
    //   nothing — a waived item never was / no longer is money
    //   between company and rep, so it leaves both totals.
    // - 'settled' shortage = cash actually collected from the rep
    //   (settleRepFinancialItem cash branch: Dr 1110 / Cr 7200 or
    //   Cr 1160 + treasury + drawer row, one transaction). The old
    //   formula dropped it from the subtraction, so the headline net
    //   understated what was charged in the window; the settled
    //   bucket is displayed alongside, so what is already collected
    //   stays visible and is never collected twice off this number
    //   (push-to-payroll takes explicit ids, the per-rep card shows
    //   pending only).
    // - 'pushed_to_payroll' = an hr_employee_adjustments deduction /
    //   allowance was WRITTEN (status 'pending') but the money leaves
    //   the rep's pay only when the targeted payroll run is built
    //   (pickup is `date <= range.to`, M2) — not actually deducted
    //   yet, so it stays in the balance. LIMIT (honest, display-only):
    //   no status ever records "the payroll run applied it" (nothing
    //   flips pushed_to_payroll afterwards and this summary never
    //   reads hr_employee_adjustments), so a pushed shortage remains
    //   in the net even after the run deducts it; the pushed bucket
    //   is the admin's view of that amount. Same for a cash-settled
    //   shortage, which remains in the gross position with the
    //   settled bucket showing it as collected.
    // - 'settled' bonus/commission cannot occur today (the cash branch
    //   rejects non-shortages with SETTLEMENT_CASH_UNSUPPORTED; push
    //   flips to pushed_to_payroll), but the != 'waived' rule covers
    //   it as earned if a future path ever settles one by payment.
    // - Overages (cash_overage / stock_overage, born 'settled' at
    //   settleTrip, INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE) are company
    //   gains (Cr 7100), never a claim on the rep, so they are shown
    //   as totalOverages / per-rep overages and NEVER folded into the
    //   net balance. Display-only: no journal, no status flip, no
    //   migration.
    let totalPendingShortages = 0;
    let totalSettledShortages = 0;
    let totalWaivedShortages = 0;
    let totalPushedToPayroll = 0;
    let totalCommissions = 0;
    let totalOverages = 0;

    const repMap = new Map<number, {
      repId: number;
      repName: string;
      repPhone?: string;
      employeeId?: number | null;
      employeeName?: string | null;
      pendingShortages: number;
      settledShortages: number;
      waivedShortages: number;
      pushedToPayroll: number;
      commissions: number;
      overages: number;
      netBalance: number;
      itemsCount: number;
    }>();

    for (const it of items) {
      const amt = Number(it.amount || 0);
      const isShortage = ['cash_shortage', 'stock_shortage'].includes(it.entryType);
      const isBonus = ['commission', 'bonus'].includes(it.entryType);
      const isOverage = ['cash_overage', 'stock_overage'].includes(it.entryType);
      const isWaived = it.status === 'waived';

      if (isShortage) {
        if (it.status === 'pending') totalPendingShortages += amt;
        else if (it.status === 'settled') totalSettledShortages += amt;
        else if (it.status === 'waived') totalWaivedShortages += amt;
        else if (it.status === 'pushed_to_payroll') totalPushedToPayroll += amt;
      } else if (isBonus) {
        // INV-REP-LEDGER-SUMMARY-BALANCE: a waived bonus/commission
        // was forgiven, never earned — it leaves the commission total.
        if (!isWaived) totalCommissions += amt;
      } else if (isOverage) {
        // INV-REP-LEDGER-SUMMARY-BALANCE: overages are shown, never
        // netted (company gain, Cr 7100 — not rep money).
        if (!isWaived) totalOverages += amt;
      }

      if (!repMap.has(it.repId)) {
        repMap.set(it.repId, {
          repId: it.repId,
          repName: it.repName,
          repPhone: it.repPhone || undefined,
          employeeId: it.employeeId ? Number(it.employeeId) : null,
          employeeName: it.employeeName || null,
          pendingShortages: 0,
          settledShortages: 0,
          waivedShortages: 0,
          pushedToPayroll: 0,
          commissions: 0,
          overages: 0,
          netBalance: 0,
          itemsCount: 0,
        });
      }

      const repEntry = repMap.get(it.repId)!;
      repEntry.itemsCount++;
      if (isShortage) {
        if (it.status === 'pending') repEntry.pendingShortages += amt;
        else if (it.status === 'settled') repEntry.settledShortages += amt;
        else if (it.status === 'waived') repEntry.waivedShortages += amt;
        else if (it.status === 'pushed_to_payroll') repEntry.pushedToPayroll += amt;
      } else if (isBonus) {
        if (!isWaived) repEntry.commissions += amt;
      } else if (isOverage) {
        if (!isWaived) repEntry.overages += amt;
      }
      // INV-REP-LEDGER-SUMMARY-BALANCE: commissions due (non-waived)
      // minus shortages owed (pending + settled + pushed_to_payroll);
      // waived leaves both sides, overages never enter the net.
      repEntry.netBalance = roundMoney(
        repEntry.commissions - (repEntry.pendingShortages + repEntry.settledShortages + repEntry.pushedToPayroll),
        moneyDigits,
      );
    }

    return {
      items,
      summary: {
        totalPendingShortages: roundMoney(totalPendingShortages, moneyDigits),
        totalSettledShortages: roundMoney(totalSettledShortages, moneyDigits),
        totalWaivedShortages: roundMoney(totalWaivedShortages, moneyDigits),
        totalPushedToPayroll: roundMoney(totalPushedToPayroll, moneyDigits),
        totalCommissions: roundMoney(totalCommissions, moneyDigits),
        totalOverages: roundMoney(totalOverages, moneyDigits),
        netRepBalance: roundMoney(
          totalCommissions - (totalPendingShortages + totalSettledShortages + totalPushedToPayroll),
          moneyDigits,
        ),
        repsBreakdown: Array.from(repMap.values()),
      },
    };
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
   * (maker-checker). The cash branch is untouched: PD3 is
   * waiver-only.
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
        await this.assertRepWaiverApproval(trxAny, tenantId, accountId, item, payload, actorUserId);
        const waiverReason = String(payload.reason ?? payload.notes ?? '').trim();
        const waiverNotes = `${item.notes ? item.notes + ' | ' : ''}${waiverReason}`;
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
      // The day part keeps the host-local behaviour this endpoint always
      // had; tenant-timezone day resolution is recorded remaining work.
      const receiptVoucherNo = formatDailyDocumentNumber('REC', id);

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
  private async getRepWaiverApprovalThreshold(trx: any, tenantId: string): Promise<number> {
    const row = await sql<{ value?: string }>`select value from settings where key = 'repWaiverApprovalThreshold' and tenant_id = ${tenantId}`.execute(trx);
    const raw = String(row.rows?.[0]?.value || '').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
      } catch { /* fall through to the plain-number parse */ }
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
  private async assertRepWaiverApproval(
    trxAny: any,
    tenantId: string,
    accountId: string,
    item: { rep_id?: number | null; trip_id?: number | null; amount?: number | string | null },
    payload: { reason?: string; notes?: string; supervisorPin?: string },
    actorUserId: number | null,
  ): Promise<void> {
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
    if (actorUserId && tripSettledBy && actorUserId === tripSettledBy) {
      throw new AppError(
        'لا يجوز لمن اعتمد تصفية الرحلة أن يعفي عجزها بنفسه — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
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
      throw new AppError(
        'لا يجوز لمن اعتمد تصفية الرحلة أن يعتمد إعفاء عجزها — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
    }
  }

  /**
   * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): verify that a Dr 1160
   * custody leg actually stands for a pending stock_shortage item
   * before its waiver or cash settlement posts a Cr 1160 reversal.
   *
   * What "stands" means, grounded in postVanTripSettlement: a
   * CHARGED stock shortage books Dr 1160 / Cr 1140 on the trip's
   * van_trip_settlement journal (source_type van_trip_settlement,
   * source_id = trip id, status posted); an UNCHARGED one books
   * Dr 7200 / Cr 1140 instead, so no 1160 leg exists. Migration
   * 0225 backfilled every settled trip with stock variance > 0.01
   * into a PENDING stock_shortage row without recording which leg
   * was booked, so only the trip journal can tell them apart — the
   * linkage that survives is the item's trip_id.
   *
   * The check sums the Dr 1160 legs of the trip's posted settlement
   * journal(s) and subtracts the Cr 1160 legs of any prior waiver /
   * cash-collection reversals for stock_shortage items of the same
   * trip, then requires the net standing custody to cover the item
   * amount within one book-digit unit (10^-bookDigits, the same
   * tolerance the posting service allows between journal sides).
   * A missing trip, a missing journal, an uncharged (Dr 7200) leg,
   * or a leg smaller than the item all fail closed with
   * REP_SHORTAGE_NO_CUSTODY_LEG (422): no journal is posted and no
   * status flips — the row stays pending for manual review. A
   * legitimately charged shortage proceeds exactly as before.
   * Runs inside the caller's transaction, under the item's FOR
   * UPDATE lock, so the journal read sees the same snapshot as the
   * status flip that follows it.
   */
  private async assertRepStockShortageCustodyLeg(
    trx: any,
    tenantId: string,
    item: { trip_id?: number | null },
    amount: number,
    bookDigits: MoneyDigits,
  ): Promise<void> {
    const tolerance = 10 ** -bookDigits;
    let standingCustody = 0;
    const tripId = item.trip_id ? Number(item.trip_id) : null;
    if (tripId) {
      const custodyAccountId = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '1160');
      const chargedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .select('l.debit as debit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'van_trip_settlement')
        .where('je.source_id', '=', tripId)
        .where('je.status', '=', 'posted')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const charged = chargedRows.reduce((sum: number, row: any) => sum + Number(row?.debit || 0), 0);
      // Prior reversals for stock_shortage items of the same trip
      // (each reversal journal's source_id is its settlement item,
      // so the join back to the item recovers the trip): a second
      // pending row for the same trip must not reverse custody that
      // an earlier settle already cleared.
      const reversedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .innerJoin('van_rep_financial_settlements as s', 's.id', 'je.source_id')
        .select('l.credit as credit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', 'in', ['rep_shortage_waiver', 'rep_shortage_cash_collection'])
        .where('je.status', '=', 'posted')
        .where('s.trip_id', '=', tripId)
        .where('s.entry_type', '=', 'stock_shortage')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const reversed = reversedRows.reduce((sum: number, row: any) => sum + Number(row?.credit || 0), 0);
      standingCustody = charged - reversed;
    }
    if (standingCustody + tolerance < amount) {
      throw new AppError(
        'العجز المخزني غير محمّل على عهدة المندوب — لا يوجد قيد مدين 1160 قائم لهذا البند، راجع تصفية الرحلة قبل التسوية',
        'REP_SHORTAGE_NO_CUSTODY_LEG',
        422,
      );
    }
  }

  /**
   * Receiving shift for a rep shortage cash collection, in the order the
   * drawer truth requires: the settler's own open shift first — the
   * cashier who took the cash is the one whose drawer must grow — then,
   * when the settler holds no shift, the latest open shift on the branch
   * of the trip's van location (the same branch-only fallback granularity
   * the trip-remittance row uses). No open shift anywhere fails closed:
   * cash with no drawer must not settle.
   */
  private async resolveRepShortageReceivingShift(
    trx: any,
    params: {
      tenantId: string;
      actorUserId: number | null;
      tripId: number | null;
    },
  ): Promise<{ id: number; branch_id: number | null; location_id: number | null }> {
    if (params.actorUserId && params.actorUserId > 0) {
      const own = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', params.tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (own) return own;
    }
    if (params.tripId) {
      const trip = await trx
        .selectFrom('van_sales_trips')
        .select(['van_location_id'])
        .where('id', '=', params.tripId)
        .where('tenant_id', '=', params.tenantId)
        .executeTakeFirst();
      const vanLocationId = trip?.van_location_id ? Number(trip.van_location_id) : 0;
      if (vanLocationId > 0) {
        const location = await trx
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLocationId)
          .where('tenant_id', '=', params.tenantId)
          .executeTakeFirst();
        const branchId = location?.branch_id ? Number(location.branch_id) : null;
        const branchMatch = (eb: any) =>
          branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
        const branchShift = await trx
          .selectFrom('cashier_shifts')
          .select(['id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', params.tenantId)
          .where('status', '=', 'open')
          .where(branchMatch)
          .orderBy('id', 'desc')
          .forUpdate()
          .executeTakeFirst();
        if (branchShift) return branchShift;
      }
    }
    throw new AppError('يجب فتح وردية قبل تحصيل نقدية عجز المندوب', 'OPEN_SHIFT_REQUIRED', 400);
  }

  /**
   * The drawer row for a rep shortage cash collection. It reuses the
   * trip-remittance txn_type on purpose — drawer math keys off the signed
   * amount and the 'مندوب' note, so the row lands in delivery cash-in
   * exactly like every other rep handover — with its own deterministic
   * request key, one per settlement item, under the same partial unique
   * index, so a retried collection collides instead of doubling the
   * shift's expected cash.
   */
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
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: params.tenantId,
        account_id: params.accountId,
        txn_type: 'rep_cash_remittance',
        amount: params.amount,
        note: `توريد نقدية مندوب ${params.repName} - تسوية عجز #${params.settlementItemId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(params.shift.id),
        branch_id: params.shift.branch_id ? Number(params.shift.branch_id) : null,
        location_id: params.shift.location_id ? Number(params.shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: `rep-shortage-cash:${params.settlementItemId}`,
      } as any)
      .execute();
  }

  /**
   * Bridge representative shortages directly into HR Payroll deductions.
   */
  async pushRepShortagesToPayroll(
    tenantId: string,
    accountId: string,
    payload: {
      settlementIds: number[];
      targetMonth?: string;
    },
    authContext: AuthContext,
  ) {
    if (!payload.settlementIds || payload.settlementIds.length === 0) {
      throw new AppError('يجب تحديد بنود للتسوية والترحيل للرواتب', 'NO_ITEMS_SELECTED', 400);
    }

    const rawItems = await this.anyDb
      .selectFrom('van_rep_financial_settlements as fs')
      .innerJoin('delivery_representatives as dr', 'dr.id', 'fs.rep_id')
      .leftJoin('hr_employees as emp', 'emp.id', 'dr.employee_id')
      .select([
        'fs.id',
        'fs.rep_id as repId',
        'dr.name as repName',
        'dr.phone as repPhone',
        'dr.national_id as repNationalId',
        'dr.employee_id as employeeId',
        'emp.id as linkedEmpId',
        'emp.display_name as employeeName',
        'fs.entry_type as entryType',
        'fs.amount',
        'fs.notes',
        'fs.status',
      ])
      .where('fs.id', 'in', payload.settlementIds)
      .where('fs.tenant_id', '=', tenantId)
      .execute();

    const items = rawItems.map((r: any) => ({
      id: Number(r.id),
      repId: Number(r.repId || r.rep_id || r.repid || 0),
      repName: String(r.repName || r.rep_name || r.repname || ''),
      repPhone: r.repPhone || r.rep_phone || r.repphone || null,
      repNationalId: r.repNationalId || r.rep_national_id || r.repnationalid || null,
      employeeId: (r.employeeId || r.employee_id || r.employeeid) ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
      employeeName: r.employeeName || r.employee_name || r.employeename || null,
      entryType: String(r.entryType || r.entry_type || r.entrytype || ''),
      amount: Number(r.amount || 0),
      notes: r.notes || '',
      status: String(r.status || 'pending'),
    }));

    if (items.length === 0) {
      throw new AppError('لم يتم العثور على أي بنود صالحة للترحيل', 'NO_ITEMS_FOUND', 404);
    }

    const actorUserId = authContext.userId ? Number(authContext.userId) : null;
    const targetMonth = payload.targetMonth || new Date().toISOString().slice(0, 7);
    const results: Array<{ id: number; repName: string; amount: number; success: boolean; message: string }> = [];
    // INV-REP-PAYROLL-TARGET-MONTH (M2, PD2): resolved inside the
    // transaction below — the run the deduction is targeted at.
    let effectiveMonth = targetMonth;
    let effectiveRunId: number | null = null;
    let rolledForward = false;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-REP-PAYROLL-TARGET-MONTH (M2, PD2): targetMonth is the
      // FIRST payroll run whose period is the target month. The old
      // code dated the adjustment CURRENT_DATE, so payroll ignored
      // the month entirely and the deduction landed in whatever run
      // was built next — the wrong month's wage, or never for a rep
      // who left before the target month. The adjustment is now
      // dated inside the effective run's period, so only that run's
      // rebuild picks it up (pickup is `date <= range.to`). When the
      // target run's period already passed, the deduction rolls
      // forward to the nearest following run and the roll-forward is
      // recorded on the settlement row.
      const targetRunRow = await trxAny
        .selectFrom('hr_payroll_runs')
        .select([
          'id',
          sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate'),
          sql<boolean>`end_date < CURRENT_DATE`.as('periodPassed'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('period_month', '=', targetMonth)
        .orderBy('start_date', 'asc')
        .executeTakeFirst();
      let effectiveDate = `${targetMonth}-01`;
      if (targetRunRow) {
        const periodPassed = (targetRunRow as any).periodPassed === true;
        if (!periodPassed) {
          effectiveRunId = Number((targetRunRow as any).id);
          effectiveDate = String((targetRunRow as any).startDate || `${targetMonth}-01`);
        } else {
          const followingRunRow = await trxAny
            .selectFrom('hr_payroll_runs')
            .select([
              'id',
              'period_month',
              sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate'),
            ])
            .where('tenant_id', '=', tenantId)
            .where('period_month', '>', targetMonth)
            .orderBy('period_month', 'asc')
            .orderBy('start_date', 'asc')
            .executeTakeFirst();
          if (followingRunRow) {
            effectiveRunId = Number((followingRunRow as any).id);
            effectiveMonth = String((followingRunRow as any).period_month || (followingRunRow as any).periodMonth || targetMonth);
            effectiveDate = String((followingRunRow as any).startDate || `${effectiveMonth}-01`);
            rolledForward = true;
          } else {
            // No following run exists yet: keep the target run, so
            // the deduction stays dated inside the target month and
            // the next run built picks it up (date <= range.to).
            effectiveRunId = Number((targetRunRow as any).id);
            effectiveDate = String((targetRunRow as any).startDate || `${targetMonth}-01`);
          }
        }
      }
      const rollForwardNote = rolledForward
        ? ` — تم الترحيل لشهر ${effectiveMonth} بدلاً من ${targetMonth} لأن فترة مسير ${targetMonth} انتهت`
        : '';
      // Migration 0225 declares payroll_run_id on the settlement
      // rows; older harnesses model the table without it. The link
      // is traceability only — a missing column must never fail the
      // push itself, so the write is skipped when the column is absent.
      const linkColumn = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'van_rep_financial_settlements'
            AND column_name = 'payroll_run_id'
        ) AS exists
      `.execute(trx);
      const canWriteRunLink = linkColumn.rows[0]?.exists === true;

      for (const item of items) {
        // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the status above comes
        // from a snapshot read before the transaction, so two
        // concurrent pushes both see 'pending' and both insert a
        // payroll adjustment for the same shortage. Re-read the row
        // under lock and flip it with a status predicate, checking
        // the affected row — the loser sees 'pushed_to_payroll' here
        // and records a failure instead of a second deduction.
        const lockedItem = await trxAny
          .selectFrom('van_rep_financial_settlements')
          .select(['id', 'status', 'amount', 'notes'])
          .where('id', '=', item.id)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedItem) {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: 'البند تمت تسويته مسبقاً',
          });
          continue;
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: a row already flipped to
        // pushed_to_payroll is retryable ONLY when no payroll
        // adjustment was ever written for it. The pre-fix code flipped
        // the row and then skipped the insert when no employee was
        // linked, so the shortage vanished with no deduction and no
        // retry. A flipped row WITH an adjustment is genuinely pushed
        // and stays refused, so a re-push can never double-deduct.
        let isRepush = false;
        if (lockedItem.status === 'pushed_to_payroll') {
          const existingAdjustment = await trxAny
            .selectFrom('hr_employee_adjustments')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('source_type', '=', 'van_sales_settlement')
            .where('source_id', '=', String(item.id))
            .executeTakeFirst();
          if (existingAdjustment) {
            results.push({
              id: Number(item.id),
              repName: item.repName,
              amount: Number(item.amount),
              success: false,
              message: 'البند تمت تسويته مسبقاً',
            });
            continue;
          }
          isRepush = true;
        } else if (lockedItem.status !== 'pending') {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: 'البند تمت تسويته مسبقاً',
          });
          continue;
        }

        // Try to resolve HR employee if not already linked
        let resolvedEmployeeId = item.employeeId ? Number(item.employeeId) : null;
        if (!resolvedEmployeeId) {
          // INV-REP-EMPLOYEE-MATCH-DETERMINISTIC (M3, A4): the old
          // match was one unordered OR query — `display_name ILIKE
          // %repName%` OR `national_id = …` with executeTakeFirst()
          // and no ORDER BY — so with several matching employees the
          // linked employee was whichever row the planner returned
          // first, and a % or _ in the rep name matched spuriously
          // as a LIKE wildcard. The match is now deterministic in
          // two ordered steps: (1) an exact national_id match wins
          // over any name match; (2) the name match escapes LIKE
          // wildcards (% _ and backslash) and orders by id, so the
          // same input always links the same employee. The link is
          // still permanent (written to delivery_representatives
          // below), so determinism here is what keeps a rep's
          // shortage off the wrong employee's pay.
          let candidateEmp: { id: number; display_name: string } | undefined;
          if (item.repNationalId) {
            candidateEmp = await trxAny
              .selectFrom('hr_employees')
              .select(['id', 'display_name'])
              .where('tenant_id', '=', tenantId)
              .where('national_id', '=', item.repNationalId)
              .orderBy('id', 'asc')
              .executeTakeFirst();
          }
          if (!candidateEmp) {
            const escapedName = String(item.repName || '')
              .replace(/\\/g, '\\\\')
              .replace(/%/g, '\\%')
              .replace(/_/g, '\\_');
            candidateEmp = await trxAny
              .selectFrom('hr_employees')
              .select(['id', 'display_name'])
              .where('tenant_id', '=', tenantId)
              .where(sql<boolean>`display_name ILIKE ${`%${escapedName}%`} ESCAPE '\\'`)
              .orderBy('id', 'asc')
              .executeTakeFirst();
          }

          if (candidateEmp?.id) {
            resolvedEmployeeId = Number(candidateEmp.id);
            await trxAny
              .updateTable('delivery_representatives')
              .set({ employee_id: resolvedEmployeeId, updated_at: sql`NOW()` })
              .where('id', '=', item.repId)
              .where('tenant_id', '=', tenantId)
              .execute();
          }
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: fail closed — a push with no
        // linked employee is REFUSED and the row stays pending, so it
        // can be pushed after the rep is linked. The old code flipped
        // the row and reported success with no deduction written.
        if (!resolvedEmployeeId) {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: `لم يتم الترحيل: المندوب ${item.repName} غير مرتبط بموظف في الموارد البشرية — اربط المندوب بموظف ثم أعد الترحيل`,
          });
          continue;
        }

        if (!isRepush) {
          const flipped = await trxAny
            .updateTable('van_rep_financial_settlements')
            .set({
              status: 'pushed_to_payroll',
              settlement_method: 'payroll',
              settled_at: sql`NOW()`,
              settled_by: actorUserId,
              ...(canWriteRunLink && effectiveRunId !== null ? { payroll_run_id: effectiveRunId } : {}),
              notes: `${item.notes ? item.notes + ' | ' : ''}تم ترحيل العجز لمسير رواتب شهر ${effectiveMonth} (موظف #${resolvedEmployeeId})${rollForwardNote}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', item.id)
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'pending')
            .returning('id')
            .execute();
          if (flipped.length !== 1) {
            results.push({
              id: Number(item.id),
              repName: item.repName,
              amount: Number(item.amount),
              success: false,
              message: 'البند تمت تسويته مسبقاً',
            });
            continue;
          }
        } else {
          // The row was already flipped by the failed pre-fix push;
          // record the retry in the notes instead of flipping again.
          await trxAny
            .updateTable('van_rep_financial_settlements')
            .set({
              ...(canWriteRunLink && effectiveRunId !== null ? { payroll_run_id: effectiveRunId } : {}),
              notes: `${lockedItem.notes ? lockedItem.notes + ' | ' : ''}أعيد ترحيل العجز لمسير رواتب شهر ${effectiveMonth} (موظف #${resolvedEmployeeId})${rollForwardNote}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', item.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: the adjustment is always
        // written now — the no-employee case is refused above, so
        // reaching here without a deduction is impossible. amount_type
        // is 'money': 'fixed' is not a legal unit ('money' | 'days' |
        // 'hours') and made the whole payroll run build fail with
        // HR_PAYROLL_DATED_ADJUSTMENT_INVALID.
        const isShortage = ['cash_shortage', 'stock_shortage'].includes(item.entryType);
        const adjType = isShortage ? 'deduction' : 'allowance';
        const adjReason = isShortage
          ? `استقطاع عجز سيارة فان (حركة #${item.id} - ${item.notes || 'عجز مبيعات'})`
          : `صرف بونص/عمولة سيارة فان (حركة #${item.id} - ${item.notes || 'حافز مبيعات'})`;

        await trxAny
          .insertInto('hr_employee_adjustments')
          .values({
            tenant_id: tenantId,
            employee_id: Number(resolvedEmployeeId),
            adjustment_type: adjType,
            amount_type: 'money',
            amount: Number(lockedItem.amount),
            // INV-REP-PAYROLL-TARGET-MONTH: dated inside the
            // effective run's period, never CURRENT_DATE — the run
            // rebuild picks up adjustments by `date <= range.to`,
            // so this date is what puts the deduction in the
            // targeted month's run.
            date: effectiveDate,
            reason: adjReason,
            status: 'pending',
            source_type: 'van_sales_settlement',
            source_id: String(item.id),
            created_by: actorUserId,
            updated_by: actorUserId,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();

        results.push({
          id: Number(item.id),
          repName: item.repName,
          amount: Number(item.amount),
          success: true,
          message: isRepush
            ? `أعيد الترحيل بنجاح لملف الموظف في مسير شهر ${effectiveMonth}`
            : `تم الترحيل بنجاح لملف الموظف في مسير شهر ${effectiveMonth}`,
        });
      }
    });

    return {
      ok: true,
      targetMonth,
      effectiveMonth,
      effectiveRunId,
      rolledForward,
      processedCount: results.filter((r) => r.success).length,
      results,
    };
  }

  /**
   * Add manual bonus or commission to representative financial ledger.
   */
  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    },
    authContext: AuthContext,
  ) {
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', payload.repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep) throw new AppError('مندوب التوزيع غير موجود', 'REP_NOT_FOUND', 404);

    // Book digits resolved once (D4): the bonus/commission amount
    // below rounds at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const amount = roundMoney(Number(payload.amount || 0), moneyDigits);
    if (amount <= 0) throw new AppError('يجب أن يكون المبلغ أكبر من صفر', 'INVALID_AMOUNT', 400);

    const inserted = await this.anyDb
      .insertInto('van_rep_financial_settlements')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        rep_id: payload.repId,
        trip_id: null,
        entry_type: payload.entryType,
        amount,
        status: 'pending',
        notes: payload.notes || (payload.entryType === 'bonus' ? 'مكافأة تميز ميداني' : 'عمولة مبيعات'),
        created_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .returning(['id', 'amount', 'entry_type as entryType', 'status'])
      .executeTakeFirst();

    return {
      ok: true,
      settlement: inserted,
      repName: rep.name,
    };
  }
}
