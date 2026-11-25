import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { getTenantTimezone, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { resolveBusinessDateKey } from '../../../accounting/engines/accounting-date.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export class PushRepShortagesToPayrollSlice {
  constructor(private readonly deps: VanRepFinancialLedgerDeps) {}

  private get anyDb(): any {
    return this.deps.db as any;
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
      employeeId:
        r.employeeId || r.employee_id || r.employeeid ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
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
    // The default target month is a business-month decision
    // (INV-BUSINESS-DATE-TENANT-LOCAL): on the 1st of a month around
    // local midnight the UTC month is still the previous month, so the
    // shortage would be pushed to the wrong payroll run.
    const targetMonth =
      payload.targetMonth || (await resolveBusinessDateKey(this.deps.db, tenantId, new Date())).slice(0, 7);
    const results: Array<{ id: number; repName: string; amount: number; success: boolean; message: string }> = [];
    // INV-REP-PAYROLL-TARGET-MONTH (M2, PD2): resolved inside the
    // transaction below — the run the deduction is targeted at.
    let effectiveMonth = targetMonth;
    let effectiveRunId: number | null = null;
    let rolledForward = false;

    await this.deps.db.transaction().execute(async (trx) => {
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
      // "Period passed" is judged against the TENANT's day, not the DB
      // host's day: CURRENT_DATE is the database server's day, which
      // differs from the tenant's around the tenant midnight — a run
      // ending today must not roll forward early.
      const todayKey = todayTenantDate(await getTenantTimezone(trx, tenantId), new Date());
      const targetRunRow = await trxAny
        .selectFrom('hr_payroll_runs')
        .select([
          'id',
          sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate'),
          sql<boolean>`end_date < ${todayKey}`.as('periodPassed'),
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
            .select(['id', 'period_month', sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate')])
            .where('tenant_id', '=', tenantId)
            .where('period_month', '>', targetMonth)
            .orderBy('period_month', 'asc')
            .orderBy('start_date', 'asc')
            .executeTakeFirst();
          if (followingRunRow) {
            effectiveRunId = Number((followingRunRow as any).id);
            effectiveMonth = String(
              (followingRunRow as any).period_month || (followingRunRow as any).periodMonth || targetMonth,
            );
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
}
