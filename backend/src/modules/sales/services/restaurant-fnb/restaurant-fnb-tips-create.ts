import { Database } from '../../../../database/database.types';
import { Kysely, sql, type Transaction } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../../../accounting/engines/accounting-date.engine';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { TenantScope, CalculateTipPoolDto } from './restaurant-fnb-types';

export class RestaurantFnbTipsCreateSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly assertManagerCaller: (scope: TenantScope) => void,
  ) {}

  async calculateAndSaveTipPool(scope: TenantScope, dto: CalculateTipPoolDto) {
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may create a pool.
    this.assertManagerCaller(scope);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const shiftDate = dto.shiftDate || (await resolveBusinessDateKey(this.db, scope.tenantId, new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      throw new AppError('تاريخ الوردية يجب أن يكون بصيغة YYYY-MM-DD', 'INVALID_SHIFT_DATE', 400);
    }
    const cashTips = roundMoney(Number(dto.totalCashTips || 0), moneyDigits);
    const cardTips = roundMoney(Number(dto.totalCardTips || 0), moneyDigits);
    const totalTips = roundMoney(cashTips + cardTips, moneyDigits);

    if (totalTips <= 0) {
      throw new AppError('إجمالي مجمع الإكراميات يجب أن يكون أكبر من الصفر', 'INVALID_TIP_AMOUNT', 400);
    }

    if (!dto.staff || dto.staff.length === 0) {
      throw new AppError('يجب تحديد موظف واحد على الأقل لتوزيع الإكراميات', 'NO_STAFF_SELECTED', 400);
    }

    // INV-REST-FNB-CLAIMS-POST: one pool per branch + shift date. A second
    // pool for the same shift would distribute the same tips twice. A
    // cancelled pool does not block a fresh one.
    const branchId = scope.branchId || null;
    let duplicateQuery = this.db
      .selectFrom('restaurant_tip_pools')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('shift_date', '=', shiftDate)
      .where('status', 'in', ['draft', 'distributed']);
    duplicateQuery = branchId
      ? duplicateQuery.where('branch_id', '=', branchId)
      : duplicateQuery.where('branch_id', 'is', null);
    const duplicate = await duplicateQuery.executeTakeFirst();
    if (duplicate) {
      throw new AppError('يوجد مجمع إكراميات بالفعل لنفس الفرع وتاريخ الوردية', 'TIP_POOL_EXISTS', 409);
    }

    // INV-REST-FNB-CLAIMS-POST: every recipient must be a real, active
    // employee of this tenant — a hardcoded id or a Date.now() id is not a
    // person. The id is the validated identity; the name/role travel with
    // the shift roster as submitted.
    const employeeIds = dto.staff.map((m) => Number(m.employeeId || 0));
    if (employeeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AppError('كل موظف في التوزيع يجب أن يكون له معرف موظف صحيح', 'UNKNOWN_EMPLOYEE', 422);
    }
    if (new Set(employeeIds).size !== employeeIds.length) {
      throw new AppError('لا يمكن تكرار نفس الموظف في توزيع واحد', 'DUPLICATE_EMPLOYEE', 400);
    }
    const employees = await this.db
      .selectFrom('hr_employees')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', employeeIds)
      .where('status', '=', 'active')
      .execute();
    if (employees.length !== employeeIds.length) {
      const found = new Set(employees.map((e) => Number(e.id)));
      const missing = employeeIds.find((id) => !found.has(id));
      throw new AppError(`الموظف رقم ${missing} غير موجود أو غير نشط لدى هذه المنشأة`, 'UNKNOWN_EMPLOYEE', 422);
    }

    // INV-REST-FNB-CLAIMS-POST: the pool distributes ONLY the tips the
    // branch actually collected on that business day — posted, non-credit
    // sales whose tenant-local business date is the shift date. A credit
    // sale's tip is a receivable, not collected money, so it is excluded.
    // The cash/card split is recorded as stated; the reconciled figure is
    // the TOTAL, within one minor unit. An invented total fails here and
    // no pool row is created.
    const actualTips = await this.sumCollectedTips(this.db, scope, shiftDate);
    const tolerance = Math.pow(10, -moneyDigits);
    if (Math.abs(totalTips - actualTips) > tolerance) {
      throw new AppError(
        `إجمالي الإكراميات المُدخل (${totalTips}) لا يطابق الإكراميات المحصّلة فعلياً لذلك الفرع والوردية (${actualTips})`,
        'TIP_TOTAL_MISMATCH',
        422,
      );
    }

    // Role default weights if method is 'roles'
    const roleWeights: Record<string, number> = {
      waiter: 1.2,
      captain: 1.5,
      barista: 1.0,
      kitchen: 0.8,
      cashier: 0.8,
      runner: 0.6,
    };

    // Calculate distribution allocations
    let totalScore = 0;
    const computedStaff = dto.staff.map((member) => {
      let weight = member.pointWeight && member.pointWeight > 0 ? member.pointWeight : 1;
      if (dto.distributionMethod === 'roles') {
        weight = roleWeights[member.roleName.toLowerCase()] || 1;
      } else if (dto.distributionMethod === 'equal') {
        weight = 1;
      }

      const hours = member.hoursWorked && member.hoursWorked > 0 ? member.hoursWorked : 8;
      const score = dto.distributionMethod === 'equal' ? 1 : weight * (dto.distributionMethod === 'hours' ? hours : 1);
      totalScore += score;

      return {
        ...member,
        hoursWorked: hours,
        weight,
        score,
      };
    });

    if (totalScore <= 0) totalScore = 1;

    let allocatedSum = 0;
    const distributions = computedStaff.map((member, idx) => {
      // Last person gets the remainder to avoid 0.01 currency rounding discrepancies
      let amount = roundMoney((member.score / totalScore) * totalTips, moneyDigits);
      allocatedSum += amount;
      if (idx === computedStaff.length - 1) {
        const delta = roundMoney(totalTips - allocatedSum, moneyDigits);
        amount = roundMoney(amount + delta, moneyDigits);
      }
      return {
        ...member,
        allocatedAmount: Math.max(0, amount),
      };
    });

    // Save pool header
    const [insertedPool] = await this.db
      .insertInto('restaurant_tip_pools')
      .values({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId || null,
        shift_date: shiftDate,
        shift_name: dto.shiftName || 'وردية العمل',
        total_cash_tips: cashTips,
        total_card_tips: cardTips,
        total_tips: totalTips,
        distribution_method: dto.distributionMethod,
        status: 'draft',
        notes: dto.notes || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .execute();

    // Insert distribution lines
    for (const dist of distributions) {
      await this.db
        .insertInto('restaurant_tip_pool_distributions')
        .values({
          tenant_id: scope.tenantId,
          pool_id: insertedPool.id,
          employee_id: dist.employeeId,
          employee_name: dist.employeeName,
          role_name: dist.roleName,
          hours_worked: dist.hoursWorked,
          point_weight: dist.weight,
          allocated_amount: dist.allocatedAmount,
          is_paid: false,
          created_at: new Date(),
        })
        .execute();
    }

    return {
      pool: insertedPool,
      distributions,
      totalTips,
      actualTips,
    };
  }

  /**
   * INV-REST-FNB-CLAIMS-POST: the tips a branch actually collected on one
   * tenant-local business day — the sum of tip_amount over posted,
   * non-credit sales whose created_at falls on that day in the tenant's
   * timezone (settings key 'timezone', default Africa/Cairo). Drafts never
   * collected anything and cancelled sales collected nothing, so both are
   * excluded; a credit sale's tip is a receivable, not collected money.
   */
  private async sumCollectedTips(
    queryable: Kysely<Database> | Transaction<Database>,
    scope: TenantScope,
    shiftDate: string,
  ): Promise<number> {
    const timeZone = await getTenantTimezone(queryable as Kysely<Database>, scope.tenantId);
    const branchId = scope.branchId || null;
    const row = await sql<{ actual: string }>`
      SELECT COALESCE(SUM(tip_amount), 0) AS actual FROM sales
      WHERE tenant_id = ${scope.tenantId}
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      AND status = 'posted'
      AND payment_type <> 'credit'
      AND to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') = ${shiftDate}
    `.execute(queryable);
    return Number(row.rows?.[0]?.actual || 0);
  }
}
