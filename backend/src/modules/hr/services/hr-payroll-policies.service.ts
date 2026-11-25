import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../../core/audit/audit.service';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import {
  validateHrStatutoryPolicy,
  inferStatutoryCountry,
  STATUTORY_COUNTRIES,
  type HrStatutoryPolicy,
} from '../engines/hr-statutory-policy.engine';
import { clean } from '../hr-helpers';

/**
 * HrPayrollPoliciesService — slice H0 of the HR split.
 * Pure move of 3 methods from HrService (getPayrollPoliciesConfig,
 * getPayrollPolicies, updatePayrollPolicies). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures for all 3 public methods.
 * Deps: db + tx + audit (updatePayrollPolicies uses this.db +
 * this.tx.runInTransaction + this.audit.log; getPayrollPoliciesConfig
 * uses this.db). All REQUIRED, passed through as received, no fallback.
 * getPayrollPolicies keeps its (db: any, tenantId: string) signature
 * unchanged — callers pass db / trx / this.db as today; the slice keeps
 * the db parameter (NOT a ctor dep for this method). It is the ONLY
 * cross-edge out of the payroll cluster (H8/H9/H10/H5/H11/H12 call it
 * through the facade delegate), which is why H0 merges first and breaks
 * the H7<->H8 cycle. No date sites move with H0 (no new Date() in these
 * methods); the monthRange Date.UTC key travels with hr-helpers.ts.
 */

export interface HrPayrollPoliciesDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
}

@Injectable()
export class HrPayrollPoliciesService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;

  constructor(deps: HrPayrollPoliciesDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
  }

  async getPayrollPoliciesConfig(auth: any) {
    return this.getPayrollPolicies(this.db, auth.tenantId);
  }

  async getPayrollPolicies(db: any, tenantId: string) {
    const settingRows = await sql<{ key: string; value: string }>`
      SELECT key, value FROM settings WHERE tenant_id = ${tenantId} AND key IN ('currency', 'country')
    `.execute(db);
    let tenantCurrency = 'EGP';
    let tenantCountry = '';
    for (const r of settingRows.rows) {
      const val = clean(r.value).replace(/^"|"$/g, '').trim().toUpperCase();
      if (r.key === 'currency') tenantCurrency = val;
      if (r.key === 'country') tenantCountry = val;
    }
    const defaultCountry = inferStatutoryCountry(tenantCurrency, tenantCountry);

    const defaults = {
      workHoursPerDay: 8,
      latenessGracePeriodMinutes: 15,
      latenessFirstTimePenalty: 0,
      latenessRepeatPenaltyMultiplier: 1,
      overtimeMultiplier: 1.5,
      hrDelayPolicyEnabled: false,
      hrDelayPolicyFirstTimeDeduction: 0.25,
      hrDelayPolicySecondTimeDeduction: 0.5,
      hrDelayPolicyThirdTimeDeduction: 1,
      hrDelayPolicyFourthTimeDeduction: 1,
      hrCommissionType: 'none',
      hrCommissionValue: 0,
      hrCommissionTarget: 0,
      hrSocialInsuranceEnabled: false,
      hrSocialInsuranceEmployeePct: 0,
      hrSocialInsuranceEmployerPct: 0,
      hrIncomeTaxEnabled: false,
      statutoryCountry: defaultCountry,
      statutoryEffectiveFrom: '2020-01-01',
      statutoryEffectiveTo: '',
      statutoryLegalReference: 'اللائحة الداخلية للمنشأة',
      statutoryReviewed: true,
      taxPersonalExemption: 0,
      taxBrackets: [],
      insuranceConfig: null,
      maxDeductionPct: 1.0,
      hrWeekendDays: 'friday,saturday',
      insuranceProratePartialEmployment: false,
    };

    const result = await sql<{
      value: string;
    }>`SELECT value FROM hr_hr_settings WHERE tenant_id = ${tenantId} AND key = 'payroll_policies' LIMIT 1`.execute(db);
    if (result.rows.length === 0) return defaults;
    let parsed: any;
    try {
      parsed = JSON.parse(result.rows[0].value as string);
    } catch {
      throw new AppError(
        'سياسات الرواتب المحفوظة غير صالحة؛ راجع إعداداتها قبل الاحتساب',
        'HR_PAYROLL_POLICY_CORRUPT',
        409,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError('سياسات الرواتب المحفوظة ليست كائناً صالحاً', 'HR_PAYROLL_POLICY_CORRUPT', 409);
    }
    const merged = { ...defaults, ...parsed };

    // Auto-heal statutory country from tenant settings/currency if missing or unconfigured
    if (!merged.statutoryCountry || !(STATUTORY_COUNTRIES as readonly string[]).includes(merged.statutoryCountry)) {
      merged.statutoryCountry = defaultCountry;
    }
    // Auto-default statutoryEffectiveFrom if missing or blank
    if (!merged.statutoryEffectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(merged.statutoryEffectiveFrom)) {
      merged.statutoryEffectiveFrom = '2020-01-01';
    }
    // Auto-default statutoryLegalReference if missing or blank
    if (!merged.statutoryLegalReference || !String(merged.statutoryLegalReference).trim()) {
      merged.statutoryLegalReference = 'اللائحة الداخلية للمنشأة';
    }
    // If neither social insurance nor income tax is enabled, statutory deductions do not apply;
    // auto-mark statutoryReviewed as true so payroll approval is never blocked.
    if (!merged.hrSocialInsuranceEnabled && !merged.hrIncomeTaxEnabled) {
      merged.statutoryReviewed = true;
    }

    return merged;
  }

  async updatePayrollPolicies(auth: any, policies: any) {
    if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
      throw new AppError('بيانات سياسات المرتبات غير صحيحة', 'HR_PAYROLL_POLICY_INVALID', 400);
    }
    const { tenantId, accountId } = requireTenantScope(auth);
    // Resolve tenant country/currency for auto-healing missing statutory fields
    const settingRows = await sql<{ key: string; value: string }>`
      SELECT key, value FROM settings WHERE tenant_id = ${tenantId} AND key IN ('currency', 'country')
    `.execute(this.db);
    let tenantCurrency = 'EGP';
    let tenantCountry = '';
    for (const r of settingRows.rows) {
      const val = clean(r.value).replace(/^"|"$/g, '').trim().toUpperCase();
      if (r.key === 'currency') tenantCurrency = val;
      if (r.key === 'country') tenantCountry = val;
    }
    const defaultCountry = inferStatutoryCountry(tenantCurrency, tenantCountry);

    if (!policies.statutoryCountry || !(STATUTORY_COUNTRIES as readonly string[]).includes(policies.statutoryCountry)) {
      policies.statutoryCountry = defaultCountry;
    }
    if (!policies.statutoryEffectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(policies.statutoryEffectiveFrom)) {
      policies.statutoryEffectiveFrom = '2020-01-01';
    }
    if (!policies.statutoryLegalReference || !String(policies.statutoryLegalReference).trim()) {
      policies.statutoryLegalReference = 'اللائحة الداخلية للمنشأة';
    }
    if (!policies.hrSocialInsuranceEnabled && !policies.hrIncomeTaxEnabled) {
      policies.statutoryReviewed = true;
    } else if (policies.statutoryReviewed === undefined || policies.statutoryReviewed === null) {
      policies.statutoryReviewed = true;
    }

    try {
      validateHrStatutoryPolicy(policies as HrStatutoryPolicy);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'قواعد الاستقطاعات غير صحيحة',
        'HR_STATUTORY_POLICY_INVALID',
        400,
      );
    }
    const jsonStr = JSON.stringify(policies);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Approval obtains this same lock, so a new policy cannot arrive after
      // validation but before the associated immutable payroll is posted.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-policy:' + tenantId}))`.execute(trx);
      await sql`
        INSERT INTO hr_hr_settings (tenant_id, account_id, key, value, updated_by, updated_at)
        VALUES (${tenantId}, ${accountId}, 'payroll_policies', ${jsonStr}, ${auth.userId}, NOW())
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = ${jsonStr}, updated_by = ${auth.userId}, updated_at = NOW()
      `.execute(trx);
    });
    await this.audit.log(
      'Update HR payroll policies',
      `Statutory payroll settings updated for country ${clean(policies.statutoryCountry) || 'unconfigured'} by ${auth.username}`,
      auth,
    );
    return { success: true };
  }
}
