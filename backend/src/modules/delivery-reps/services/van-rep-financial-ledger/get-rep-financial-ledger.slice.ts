import { sql } from '../../../../database/kysely';
import { normalizePgDateOnly } from '../../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export class GetRepFinancialLedgerSlice {
  constructor(private readonly deps: VanRepFinancialLedgerDeps) {}

  private get anyDb(): any {
    return this.deps.db;
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
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: filter by the settlement's
      // tenant-local business day (YYYY-MM-DD).
      businessDay?: string;
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
        'fs.business_day as businessDay',
        'fs.created_at as createdAt',
        'fs.updated_at as updatedAt',
      ])
      .where('fs.tenant_id', '=', tenantId);

    if (filters.repId) {
      query = query.where('fs.rep_id', '=', Number(filters.repId));
    }
    if (filters.businessDay) {
      query = query.where('fs.business_day', '=', filters.businessDay);
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
      employeeId:
        r.employeeId || r.employee_id || r.employeeid ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
      employeeName: r.employeeName || r.employee_name || r.employeename || null,
      employeeNo: r.employeeNo || r.employee_no || r.employeeno || null,
      tripId: r.tripId || r.trip_id || r.tripid ? Number(r.tripId || r.trip_id || r.tripid) : null,
      shiftName: r.shiftName || r.shift_name || r.shiftname || null,
      vehiclePlate: r.vehiclePlate || r.vehicle_plate || r.vehicleplate || null,
      entryType: String(r.entryType || r.entry_type || r.entrytype || ''),
      amount: Number(r.amount || 0),
      status: String(r.status || 'pending'),
      settledAt: r.settledAt || r.settled_at || r.settledat || null,
      settledById:
        r.settledById || r.settled_by || r.settledby ? Number(r.settledById || r.settled_by || r.settledby) : null,
      settledByName: r.settledByName || r.settled_by_name || r.settledbyname || null,
      settlementMethod: r.settlementMethod || r.settlement_method || r.settlementmethod || null,
      notes: r.notes || null,
      receiptVoucherNo: r.receiptVoucherNo || r.receipt_voucher_no || r.receiptvoucherno || null,
      payrollRunId:
        r.payrollRunId || r.payroll_run_id || r.payrollrunid
          ? Number(r.payrollRunId || r.payroll_run_id || r.payrollrunid)
          : null,
      businessDay: normalizePgDateOnly(r.businessDay || r.business_day || r.businessday || null) || null,
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

    const repMap = new Map<
      number,
      {
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
      }
    >();

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
}
