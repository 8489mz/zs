import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import {
  EmployeeAssetActionDto,
  UpsertEmployeeAssetDto,
  UpsertCompensationPackageDto,
  UpsertEmployeeContactDto,
  CreateEmployeeAdjustmentDto,
  UpsertEmployeeDocumentDto,
  UpsertEmploymentContractDto,
} from '../dto/hr.dto';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { requireLoanMoney } from '../payroll-loan-allocation.engine';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { requireStoredHrMoney } from '../engines/hr-payroll-run.engine';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { canViewSalary, clean, money, normalizeDateOnly, tenantBookDigits, toId } from '../hr-helpers';

/**
 * HrEmployeeRecordsService — slice H2 of the hr split.
 * Pure move of 19 methods from HrService (employee contacts, documents,
 * contracts, compensation, adjustments, assets). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures for the 17 public methods. maskSalary +
 * setEmployeeAssetStatus are PRIVATE helpers called only by this slice's
 * own methods — they stay private in the slice and have NO facade
 * delegate. Neither is a bound dep of any other slice (prep §2.5: H2
 * provides listCompensation, listContacts, listContracts, listDocuments
 * to H1 — all public already).
 * Deps: db, tx, audit + bound assertEmployeeBelongsToTenant (kernel —
 * stays private in the facade, passed bound via the S3 pattern).
 * Free helpers (clean, toId, normalizeDateOnly, money, tenantBookDigits,
 * canViewSalary) are imported from '../hr-helpers' (created with the H0
 * merge); they are NOT copied into this slice. Date handling travels
 * verbatim: upsertContract numbers contracts with formatDailyDocumentNumber
 * ('CON', new Date(), businessTz) — the tenant-tz argument travels with
 * the method; upsertEmployeeAsset / setEmployeeAssetStatus resolve tenant
 * days through getTenantTimezone / todayTenantDate. The 6x
 * String(row.xxx).slice(0, 10) sites are display truncations of pg DATE
 * reads, not generated date keys (§10 pinZero stays 0).
 * tenant-scoped-reads MT-03 (listEmployeeAssets) reads the FACADE text —
 * merge-owned repoint to a multi-file read (prep §7.3), NOT in this patch.
 */

export interface HrEmployeeRecordsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;
}

@Injectable()
export class HrEmployeeRecordsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;

  constructor(deps: HrEmployeeRecordsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.assertEmployeeBelongsToTenant = deps.assertEmployeeBelongsToTenant;
  }

  private maskSalary<T extends Record<string, unknown>>(row: T, auth: AuthContext): T {
    if (canViewSalary(auth)) return row;
    const masked = { ...row };
    delete masked.baseSalary;
    delete masked.allowanceAmount;
    delete masked.deductionAmount;
    return masked;
  }

  async listContacts(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`SELECT * FROM hr_employee_contacts WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} ORDER BY is_primary DESC, id DESC`.execute(this.db);
    return { rows: result.rows.map((row) => ({ id: String(row.id), employeeId: String(row.employee_id), contactType: clean(row.contact_type), value: clean(row.value), label: clean(row.label), isPrimary: row.is_primary === true, notes: clean(row.notes) })) };
  }

  async upsertContact(employeeId: number, id: number | null, payload: UpsertEmployeeContactDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async trx => {
      // Serialize primary contact changes on the employee row. A tenant may have
      // multiple contacts, but only one can be primary for that employee.
      const parent = await sql<{ id: number }>`
        SELECT id FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE
      `.execute(trx);
      if (!parent.rows.length) throw new AppError('الموظف غير موجود في المنشأة', 'HR_EMPLOYEE_NOT_FOUND', 404);
      if (id) {
        const existing = await sql<{ id: number }>`
          SELECT id FROM hr_employee_contacts
          WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE
        `.execute(trx);
        if (!existing.rows.length) throw new AppError('بيانات الاتصال غير موجودة', 'HR_CONTACT_NOT_FOUND', 404);
      }
      if (payload.isPrimary === true) {
        await sql`
          UPDATE hr_employee_contacts SET is_primary = FALSE, updated_at = NOW()
          WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND is_primary = TRUE
        `.execute(trx);
      }
      if (id) {
        await sql`
          UPDATE hr_employee_contacts SET contact_type = ${clean(payload.contactType) || 'phone'},
            value = ${clean(payload.value)}, label = ${clean(payload.label)},
            is_primary = ${payload.isPrimary === true}, notes = ${clean(payload.notes)},
            updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        `.execute(trx);
      } else {
        await sql`
          INSERT INTO hr_employee_contacts
            (tenant_id, account_id, employee_id, contact_type, value, label,
             is_primary, notes, created_by, updated_by)
          VALUES (${tenantId}, ${auth.accountId}, ${employeeId},
            ${clean(payload.contactType) || 'phone'}, ${clean(payload.value)},
            ${clean(payload.label)}, ${payload.isPrimary === true},
            ${clean(payload.notes)}, ${auth.userId}, ${auth.userId})
        `.execute(trx);
      }
    });
    await this.audit.log(`${id ? 'Update' : 'Create'} HR employee contact`,
      `Employee #${employeeId} contact metadata saved by ${auth.username}`, auth);
    return this.listContacts(employeeId, auth);
  }

  async listDocuments(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`SELECT d.*, u.username AS uploaded_by_name FROM hr_employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by AND u.tenant_id = d.tenant_id WHERE d.employee_id = ${employeeId} AND d.tenant_id = ${auth.tenantId} ORDER BY d.id DESC`.execute(this.db);
    return { rows: result.rows.map((row) => ({ id: String(row.id), employeeId: String(row.employee_id), title: clean(row.title), documentType: clean(row.document_type), fileUrl: clean(row.file_url), expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : '', notes: clean(row.notes), uploadedByName: clean(row.uploaded_by_name) })) };
  }

  async upsertDocument(employeeId: number, id: number | null, payload: UpsertEmployeeDocumentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    if (id) {
      await sql`UPDATE hr_employee_documents SET title = ${clean(payload.title)}, document_type = ${clean(payload.documentType)}, file_url = ${clean(payload.fileUrl)}, expiry_date = ${payload.expiryDate || null}, notes = ${clean(payload.notes)}, updated_at = NOW() WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${auth.tenantId}`.execute(this.db);
    } else {
      await sql`INSERT INTO hr_employee_documents (tenant_id, account_id, employee_id, title, document_type, file_url, expiry_date, notes, uploaded_by) VALUES (${auth.tenantId}, ${auth.accountId}, ${employeeId}, ${clean(payload.title)}, ${clean(payload.documentType)}, ${clean(payload.fileUrl)}, ${payload.expiryDate || null}, ${clean(payload.notes)}, ${auth.userId})`.execute(this.db);
    }
    await this.audit.log(`${id ? 'Update' : 'Create'} HR employee document metadata`, `Employee #${employeeId} document metadata saved by ${auth.username}`, auth);
    return this.listDocuments(employeeId, auth);
  }

  async listContracts(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`SELECT * FROM hr_employment_contracts WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} ORDER BY id DESC`.execute(this.db);
    return { rows: result.rows.map((row) => this.maskSalary({ id: String(row.id), employeeId: String(row.employee_id), contractNo: clean(row.contract_no), contractType: clean(row.contract_type), status: clean(row.status), startDate: String(row.start_date).slice(0, 10), endDate: row.end_date ? String(row.end_date).slice(0, 10) : '', baseSalary: Number(row.base_salary || 0), currency: clean(row.currency), notes: clean(row.notes) }, auth)) };
  }

  async upsertContract(employeeId: number, id: number | null, payload: UpsertEmploymentContractDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const startDate = normalizeDateOnly(payload.startDate);
    const endDate = payload.endDate ? normalizeDateOnly(payload.endDate) : null;
    const baseSalary = Number(payload.baseSalary);
    if (!startDate || (payload.endDate && !endDate) || (endDate && endDate < startDate)
      || !Number.isFinite(baseSalary) || baseSalary < 0) {
      throw new AppError('تواريخ العقد أو الأجر الأساسي غير صحيحة', 'HR_CONTRACT_PERIOD_AMOUNT_INVALID', 400);
    }
    await this.tx.runInTransaction(this.db, async (trx) => {
      // This lock serializes salary-history edits with payroll creation, reviews,
      // recalculation and approval. Historical approved lines are immutable.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const tenantCurrencySetting = await sql<{ value: string }>`
        SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
      `.execute(trx);
      const tenantCurrency = clean(tenantCurrencySetting.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
      const contractCurrency = clean(payload.currency || tenantCurrency).toUpperCase();
      if (!/^[A-Z]{3}$/.test(tenantCurrency)) {
        throw new AppError('حدد عملة منشأتك قبل تسجيل عقد العمل', 'HR_CONTRACT_TENANT_CURRENCY_REQUIRED', 400);
      }
      if (contractCurrency !== tenantCurrency) {
        throw new AppError('عملة عقد الموظف يجب أن تطابق عملة المنشأة', 'HR_CONTRACT_CURRENCY_MISMATCH', 400);
      }
      try { requireStoredHrMoney(baseSalary, currencyMoneyDigits(tenantCurrency)); } catch {
        throw new AppError('قيمة الراتب يجب أن تكون غير سالبة وبدقة دفاتر المنشأة دون تقريب', 'HR_CONTRACT_MONEY_PRECISION_INVALID', 400);
      }
      const oldContract = id ? await sql<{
        start_date: string; end_date: string | null; base_salary: string;
        currency: string; contract_no: string; contract_type: string; status: string;
      }>`
        SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date,
               to_char(end_date, 'YYYY-MM-DD') AS end_date,
               base_salary, currency, contract_no, contract_type, status
        FROM hr_employment_contracts
        WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx) : null;
      if (id && !oldContract?.rows.length) {
        throw new AppError('عقد العمل غير موجود', 'HR_CONTRACT_NOT_FOUND', 404);
      }
      // Block changes affecting *either* the old or proposed validity span.
      // A future effective-dated contract is permitted; changing a past salary
      // after the ledger has accrued it requires a separate adjustment process.
      const oldStart = oldContract?.rows[0]?.start_date || startDate;
      const oldEnd = oldContract?.rows[0]?.end_date || null;
      const booked = await sql<{ latest_end: string | null }>`
        SELECT to_char(MAX(r.end_date), 'YYYY-MM-DD') AS latest_end FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId} AND i.employee_id = ${employeeId}
          AND r.status IN ('approved', 'paid') AND i.status = 'approved'
          AND (
            (r.end_date >= ${startDate}::date AND r.start_date <= COALESCE(${endDate}::date, 'infinity'::date))
            ${id ? sql`OR (r.end_date >= ${oldStart}::date AND r.start_date <= COALESCE(${oldEnd}::date, 'infinity'::date))` : sql``}
          )
        LIMIT 1
      `.execute(trx);
      const latestBookedEnd = booked.rows[0]?.latest_end || null;
      const previous = oldContract?.rows[0];
      // An existing open-ended contract may be closed prospectively for a
      // promotion: its old posted wage and effective starting date must match.
      const safeFutureClose = Boolean(
        id && previous && !oldEnd && endDate && latestBookedEnd
        && endDate >= latestBookedEnd
        && startDate === previous.start_date
        && baseSalary === Number(previous.base_salary)
        && contractCurrency === clean(previous.currency).toUpperCase()
        && clean(payload.contractNo) === clean(previous.contract_no)
        && (clean(payload.contractType) || 'standard') === clean(previous.contract_type)
        && ['active', 'ended'].includes(clean(payload.status))
        && ['active', 'ended'].includes(clean(previous.status))
      );
      if (latestBookedEnd && !safeFutureClose) {
        throw new AppError('العقد يغيّر فترة سبق اعتماد رواتبها؛ سجّل تعديلًا أو عقدًا مستقبليًا بدل تعديل التاريخ المالي', 'HR_CONTRACT_APPROVED_PERIOD_LOCKED', 409);
      }
      // F7 (INV-CONTRACT-OVERLAP-ENTRY-TIME-CHECK): overlapping contracts
      // surface HERE, at entry — not only fail-closed at payroll time.
      // Two covering contracts for one employee risk double pay. Spans
      // are inclusive days: sharing even one day IS an overlap (the
      // payroll history check throws unless segments abut exactly).
      // The contract being updated is excluded, and cancelled siblings
      // are dead spans that never pay; every other saved span counts,
      // whatever its status — any saved span can become active through
      // this same write path.
      const overlap = await sql<{ id: number }>`
        SELECT id FROM hr_employment_contracts
        WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
          AND status <> 'cancelled'
          ${id ? sql`AND id <> ${id}` : sql``}
          AND start_date <= COALESCE(${endDate}::date, 'infinity'::date)
          AND COALESCE(end_date, 'infinity'::date) >= ${startDate}::date
        LIMIT 1
      `.execute(trx);
      if (overlap.rows.length) {
        throw new AppError('يوجد عقد آخر يتداخل مع فترة هذا العقد لنفس الموظف؛ عدّل التواريخ أو أغلق العقد السابق أولًا', 'HR_CONTRACT_OVERLAP', 409);
      }
      if (id) {
        await sql`
          UPDATE hr_employment_contracts
          SET contract_no = ${clean(payload.contractNo)}, contract_type = ${clean(payload.contractType) || 'standard'},
              status = ${clean(payload.status) || 'draft'}, start_date = ${startDate}::date,
              end_date = ${endDate}::date, base_salary = ${baseSalary}, currency = ${contractCurrency},
              notes = ${clean(payload.notes)}, updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        `.execute(trx);
      } else {
        const requestedNo = clean(payload.contractNo);
        const temporaryNo = requestedNo || `CON-TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const inserted = await sql<{ id: number }>`
          INSERT INTO hr_employment_contracts
            (tenant_id, account_id, employee_id, contract_no, contract_type,
             status, start_date, end_date, base_salary, currency, notes, created_by, updated_by)
          VALUES (${tenantId}, ${auth.accountId}, ${employeeId}, ${temporaryNo},
                  ${clean(payload.contractType) || 'standard'}, ${clean(payload.status) || 'draft'},
                  ${startDate}::date, ${endDate}::date, ${baseSalary}, ${contractCurrency},
                  ${clean(payload.notes)}, ${auth.userId}, ${auth.userId})
          RETURNING id
        `.execute(trx);
        if (!requestedNo) {
          const contractId = Number(inserted.rows[0].id);
          const businessTz = await getTenantTimezone(trx, tenantId);
          await sql`
            UPDATE hr_employment_contracts SET contract_no = ${formatDailyDocumentNumber('CON', contractId, new Date(), 4, businessTz)}
            WHERE id = ${contractId} AND tenant_id = ${tenantId}
          `.execute(trx);
        }
      }
    });
    await this.audit.log(`${id ? 'Update' : 'Create'} HR employment contract`, `Employee #${employeeId} contract saved by ${auth.username}`, auth);
    return this.listContracts(employeeId, auth);
  }

  async listEmployeeAdjustments(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`SELECT * FROM hr_employee_adjustments WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} ORDER BY date DESC, id DESC`.execute(this.db);
    return {
      rows: result.rows.map((row) => ({
        id: String(row.id),
        employeeId: String(row.employee_id),
        adjustmentType: clean(row.adjustment_type),
        amountType: clean(row.amount_type),
        amount: Number(row.amount || 0),
        date: row.date ? String(row.date).slice(0, 10) : '',
        reason: clean(row.reason),
        status: clean(row.status),
        appliedInRunId: row.applied_in_run_id ? String(row.applied_in_run_id) : null,
      })),
    };
  }

  async createEmployeeAdjustment(employeeId: number, payload: CreateEmployeeAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0
      || !normalizeDateOnly(payload.date) || !['money', 'days', 'hours'].includes(clean(payload.amountType))
      || !['allowance', 'deduction'].includes(clean(payload.adjustmentType))) {
      throw new AppError('مبلغ أو نوع أو تاريخ تسوية الموظف غير صحيح', 'HR_EMPLOYEE_ADJUSTMENT_INVALID', 400);
    }
    // Days/hours may be fractional units; monetary adjustments must be exact
    // cents to avoid silently converting an entered amount during GL posting.
    if (clean(payload.amountType) === 'money') {
      const adjustmentBookDigits = await tenantBookDigits(this.db, tenantId);
      try { requireLoanMoney(Number(payload.amount), adjustmentBookDigits); } catch {
        throw new AppError('التسوية النقدية يجب أن تكون بدقة دفاتر المنشأة دون تقريب', 'HR_EMPLOYEE_ADJUSTMENT_MONEY_PRECISION_INVALID', 400);
      }
    }
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const employee = await sql<{ id: number }>`
        SELECT id FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
      `.execute(trx);
      if (!employee.rows.length) throw new AppError('الموظف غير تابع للمنشأة', 'HR_EMPLOYEE_NOT_FOUND', 404);
      await sql`
        INSERT INTO hr_employee_adjustments
          (tenant_id, employee_id, adjustment_type, amount_type, amount, date,
           reason, status, created_by, updated_by)
        VALUES (${tenantId}, ${employeeId}, ${clean(payload.adjustmentType)}, ${clean(payload.amountType)},
                ${Number(payload.amount)}, ${payload.date}::date, ${clean(payload.reason)},
                'pending', ${auth.userId}, ${auth.userId})
      `.execute(trx);
    });
    await this.audit.log('Create HR Employee Adjustment',
      `Employee #${employeeId} ${payload.adjustmentType} added by ${auth.username}`, auth);
    return { success: true };
  }

  async deleteEmployeeAdjustment(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const result = await sql<{ status: string }>`
        SELECT status FROM hr_employee_adjustments
        WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE
      `.execute(trx);
      const adjustment = result.rows[0];
      if (!adjustment) throw new AppError('Adjustment not found', 'NOT_FOUND', 404);
      if (adjustment.status !== 'pending') {
        throw new AppError('Cannot delete applied adjustment', 'CANNOT_DELETE_APPLIED', 400);
      }
      await sql`
        DELETE FROM hr_employee_adjustments WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'
      `.execute(trx);
    });
    await this.audit.log('Delete HR Employee Adjustment', `Adjustment #${id} deleted by ${auth.username}`, auth);
    return { success: true };
  }

  async listEmployeeAssets(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const search = clean(query.search).toLowerCase();
    const employeeId = toId(query.employeeId);
    const status = clean(query.status).toLowerCase();

    // INV-HR-ASSETS-LEAVE-SQL-PAGINATION: the filters (employee / status /
    // search) and the status-count summary move to SQL with exact JS
    // semantics — the status filter matches the RAW trimmed stored value
    // against the LOWERCASED query, the search is a case-insensitive
    // substring over the same eight fields, and the summary stays exact
    // over the FULL filtered set, never page-scoped.
    const employeeFilter = employeeId ? sql<boolean>`e.id = ${employeeId}` : sql<boolean>`1=1`;
    const statusFilter = status ? sql<boolean>`btrim(a.status) = ${status}` : sql<boolean>`1=1`;
    const searchFilter = search
      ? sql<boolean>`strpos(lower(btrim(COALESCE(e.employee_no, ''))), ${search}) > 0 OR strpos(lower(btrim(e.display_name)), ${search}) > 0 OR strpos(lower(btrim(COALESCE(d.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(j.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(a.asset_type, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(a.asset_name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(a.asset_code, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(a.serial_no, ''))), ${search}) > 0`
      : sql<boolean>`1=1`;
    const totals = await sql<{ total: string; assigned: string; returned: string; lost: string; damaged: string }>`
      SELECT COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE btrim(a.status) = 'assigned')::text AS assigned,
        COUNT(*) FILTER (WHERE btrim(a.status) = 'returned')::text AS returned,
        COUNT(*) FILTER (WHERE btrim(a.status) = 'lost')::text AS lost,
        COUNT(*) FILTER (WHERE btrim(a.status) = 'damaged')::text AS damaged
      FROM hr_employee_assets a
      JOIN hr_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = a.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId}
        AND ${employeeFilter} AND ${statusFilter} AND ${searchFilter}
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total || 0);
    // paginateRows semantics preserved: defaultSize 25, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 25);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT
        a.*,
        e.employee_no,
        e.display_name AS employee_name,
        d.name AS department_name,
        j.name AS job_title_name,
        to_char(a.assigned_at, 'YYYY-MM-DD') AS assigned_at_text,
        to_char(a.returned_at, 'YYYY-MM-DD') AS returned_at_text,
        to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text
      FROM hr_employee_assets a
      JOIN hr_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = a.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = ${tenantId}
        AND ${employeeFilter} AND ${statusFilter} AND ${searchFilter}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);

    const rows = result.rows.map((row) => ({
      id: String(row.id),
      employeeId: String(row.employee_id),
      employeeNo: clean(row.employee_no),
      employeeName: clean(row.employee_name),
      departmentName: clean(row.department_name),
      jobTitleName: clean(row.job_title_name),
      assetType: clean(row.asset_type),
      assetName: clean(row.asset_name),
      assetCode: clean(row.asset_code),
      serialNo: clean(row.serial_no),
      assignedAt: clean(row.assigned_at_text),
      returnedAt: clean(row.returned_at_text),
      status: clean(row.status),
      notes: clean(row.notes),
      returnNotes: clean(row.return_notes),
      createdAt: clean(row.created_at_text),
    }));

    const summary = {
      totalItems,
      assignedCount: Number(totals.rows[0]?.assigned || 0),
      returnedCount: Number(totals.rows[0]?.returned || 0),
      lostCount: Number(totals.rows[0]?.lost || 0),
      damagedCount: Number(totals.rows[0]?.damaged || 0),
    };

    return { assets: rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary };
  }

  async upsertEmployeeAsset(id: number | null, payload: UpsertEmployeeAssetDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const employeeId = toId(payload.employeeId);
    if (!employeeId) throw new AppError('Employee is required', 'HR_ASSET_EMPLOYEE_REQUIRED', 400);
    const assetType = clean(payload.assetType);
    if (!assetType) throw new AppError('Asset type is required', 'HR_ASSET_TYPE_REQUIRED', 400);
    const assetName = clean(payload.assetName);
    if (!assetName) throw new AppError('Asset name is required', 'HR_ASSET_NAME_REQUIRED', 400);
    if (payload.assignedAt && !normalizeDateOnly(payload.assignedAt)) {
      throw new AppError('تاريخ تسليم العهدة غير صحيح', 'HR_ASSET_ASSIGNED_DATE_INVALID', 400);
    }
    const tz = await getTenantTimezone(this.db, tenantId);
    const assignedAt = normalizeDateOnly(payload.assignedAt) || todayTenantDate(tz);
    await this.tx.runInTransaction(this.db, async trx => {
      // EOS/posting and employee-custody edits share this lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const employee = await sql<{ id: number; status: string; hire_date: string | null }>`
        SELECT id, status, to_char(hire_date, 'YYYY-MM-DD') AS hire_date
        FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
      `.execute(trx);
      if (!employee.rows.length || employee.rows[0].status !== 'active') {
        throw new AppError('لا يمكن تسليم عهدة لموظف غير نشط أو خارج المنشأة', 'HR_ASSET_EMPLOYEE_NOT_ACTIVE', 409);
      }
      const hireDate = employee.rows[0].hire_date;
      if (hireDate && assignedAt < hireDate) {
        throw new AppError('تاريخ تسليم العهدة يسبق تعيين الموظف', 'HR_ASSET_PRE_HIRE_DATE', 400);
      }
      if (id) {
        const existing = await sql<{ employee_id: number; status: string }>`
          SELECT employee_id, status FROM hr_employee_assets
          WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE
        `.execute(trx);
        if (!existing.rows.length) throw new AppError('Employee asset not found', 'HR_ASSET_NOT_FOUND', 404);
        if (existing.rows[0].status !== 'assigned' || Number(existing.rows[0].employee_id) !== employeeId) {
          throw new AppError('لا يمكن تغيير صاحب عهدة أو تعديل عهدة أُقفلت أو سُجلت مفقودة/تالفة؛ استخدم إجراء تسليم جديد', 'HR_ASSET_HISTORICAL_EDIT_LOCKED', 409);
        }
        await sql`
          UPDATE hr_employee_assets
          SET asset_type = ${assetType}, asset_name = ${assetName},
              asset_code = ${clean(payload.assetCode) || null},
              serial_no = ${clean(payload.serialNo) || null},
              assigned_at = ${assignedAt}::date, notes = ${clean(payload.notes) || null},
              updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'assigned'
        `.execute(trx);
      } else {
        await sql`
          INSERT INTO hr_employee_assets
            (tenant_id, account_id, employee_id, asset_type, asset_name, asset_code,
             serial_no, assigned_at, status, notes, created_by, updated_by, created_at, updated_at)
          VALUES (${tenantId}, ${accountId}, ${employeeId}, ${assetType}, ${assetName},
                  ${clean(payload.assetCode) || null}, ${clean(payload.serialNo) || null},
                  ${assignedAt}::date, 'assigned', ${clean(payload.notes) || null},
                  ${auth.userId}, ${auth.userId}, NOW(), NOW())
        `.execute(trx);
      }
    });
    await this.audit.log(`${id ? 'Update' : 'Create'} HR employee asset`, `Asset custody ${id ? 'updated' : 'created'} by ${auth.username}`, auth);
    return this.listEmployeeAssets({}, auth);
  }

  private async setEmployeeAssetStatus(
    id: number, status: 'returned' | 'lost' | 'damaged' | 'cancelled',
    payload: EmployeeAssetActionDto, auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    if (payload.deductionAmount != null) {
      if (!['lost', 'damaged'].includes(status)) {
        throw new AppError('خصم العهدة متاح للمفقود والتالف فقط', 'HR_ASSET_DEDUCTION_STATUS_INVALID', 400);
      }
      const bookDigits = await tenantBookDigits(this.db, tenantId);
      try { requireStoredHrMoney(Number(payload.deductionAmount), bookDigits); } catch {
        throw new AppError('خصم العهدة غير صحيح أو يتضمن جزءًا أدق من دقة دفاتر المنشأة', 'HR_ASSET_DEDUCTION_AMOUNT_INVALID', 400);
      }
    }
    if (payload.returnedAt && !normalizeDateOnly(payload.returnedAt)) {
      throw new AppError('تاريخ رد العهدة غير صحيح', 'HR_ASSET_RETURNED_DATE_INVALID', 400);
    }
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const current = await sql<{ status: string; employee_id: number; asset_name: string }>`
        SELECT status, employee_id, asset_name
        FROM hr_employee_assets
        WHERE id = ${id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx);
      const asset = current.rows[0];
      if (!asset) throw new AppError('Employee asset not found', 'HR_ASSET_NOT_FOUND', 404);
      if (asset.status === status && !payload.deductionAmount) return;
      if (['returned', 'cancelled'].includes(asset.status)) {
        throw new AppError('العهدة مغلقة؛ لا يمكن إعادة تغيير حالتها', 'HR_ASSET_ALREADY_CLOSED', 409);
      }
      const linkedAdjustment = await sql<{ id: number }>`
        SELECT id FROM hr_employee_adjustments
        WHERE tenant_id = ${tenantId} AND source_type = 'hr_employee_asset'
          AND source_id = ${String(id)} AND accounting_category = 'asset_recovery'
        LIMIT 1
      `.execute(trx);
      if (linkedAdjustment.rows.length) {
        throw new AppError('عهدة عليها خصم مالي مسجل؛ لا يمكن إعادة تسجيل حالتها أو قيمة الخصم دون تسوية مستقلة', 'HR_ASSET_RECOVERY_ALREADY_RECORDED', 409);
      }
      const tz = await getTenantTimezone(trx, tenantId);
      const returnedAt = status === 'returned' ? (normalizeDateOnly(payload.returnedAt) || todayTenantDate(tz)) : null;
      await sql`
        UPDATE hr_employee_assets
        SET status = ${status},
            returned_at = CASE WHEN ${returnedAt}::text IS NULL THEN returned_at ELSE ${returnedAt}::date END,
            notes = ${clean(payload.notes) || null},
            return_notes = ${clean(payload.returnNotes) || null},
            updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `.execute(trx);
      if (['lost', 'damaged'].includes(status) && Number(payload.deductionAmount || 0) > 0) {
        const reason = `تسوية عهدة ${status === 'lost' ? 'مفقودة' : 'تالفة'}: ${asset.asset_name}. ${clean(payload.returnNotes) || ''}`.trim();
        await sql`
          INSERT INTO hr_employee_adjustments
            (tenant_id, employee_id, adjustment_type, amount_type, amount, reason,
             date, status, source_type, source_id, accounting_category,
             created_by, updated_by, created_at, updated_at)
          VALUES (${tenantId}, ${asset.employee_id}, 'deduction', 'money',
                  ${Number(payload.deductionAmount)}, ${reason}, NOW()::date, 'pending',
                  'hr_employee_asset', ${String(id)}, 'asset_recovery',
                  ${auth.userId}, ${auth.userId}, NOW(), NOW())
          ON CONFLICT (tenant_id, source_type, source_id)
            WHERE accounting_category = 'asset_recovery'
              AND source_type = 'hr_employee_asset' AND source_id IS NOT NULL
          DO NOTHING
        `.execute(trx);
      }
    });
    await this.audit.log(`Mark HR employee asset ${status}`, `Asset #${id} marked as ${status} by ${auth.username}`, auth);
    return this.listEmployeeAssets({}, auth);
  }

  async returnEmployeeAsset(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.setEmployeeAssetStatus(id, 'returned', payload, auth);
  }

  async markEmployeeAssetLost(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.setEmployeeAssetStatus(id, 'lost', payload, auth);
  }

  async markEmployeeAssetDamaged(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.setEmployeeAssetStatus(id, 'damaged', payload, auth);
  }

  async cancelEmployeeAsset(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.setEmployeeAssetStatus(id, 'cancelled', payload, auth);
  }

  async listCompensation(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`SELECT * FROM hr_compensation_packages WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} ORDER BY id DESC`.execute(this.db);
    return { rows: result.rows.map((row) => this.maskSalary({ id: String(row.id), employeeId: String(row.employee_id), contractId: row.contract_id ? String(row.contract_id) : '', packageName: clean(row.package_name), allowanceAmount: Number(row.allowance_amount || 0), deductionAmount: Number(row.deduction_amount || 0), effectiveFrom: row.effective_from ? String(row.effective_from).slice(0, 10) : '', effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : '', notes: clean(row.notes) }, auth)) };
  }

  async upsertCompensation(employeeId: number, id: number | null, payload: UpsertCompensationPackageDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const from = payload.effectiveFrom ? normalizeDateOnly(payload.effectiveFrom) : null;
    const to = payload.effectiveTo ? normalizeDateOnly(payload.effectiveTo) : null;
    const allowance = Number(payload.allowanceAmount);
    const deduction = Number(payload.deductionAmount);
    if ((payload.effectiveFrom && !from) || (payload.effectiveTo && !to)
      || (from && to && from > to)
      || !Number.isFinite(allowance) || allowance < 0
      || !Number.isFinite(deduction) || deduction < 0) {
      throw new AppError('تواريخ أو مبالغ البدلات الثابتة غير صحيحة', 'HR_COMPENSATION_INVALID', 400);
    }
    const bookDigits = await tenantBookDigits(this.db, tenantId);
    try { requireStoredHrMoney(allowance, bookDigits); requireStoredHrMoney(deduction, bookDigits); } catch {
      throw new AppError('البدلات والخصومات الثابتة يجب أن تكون بدقة دفاتر المنشأة دون تقريب', 'HR_COMPENSATION_MONEY_PRECISION_INVALID', 400);
    }
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const contractId = toId(payload.contractId);
      if (contractId) {
        const linkedContract = await sql<{ id: number }>`
          SELECT id FROM hr_employment_contracts
          WHERE id = ${contractId} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
          LIMIT 1
        `.execute(trx);
        if (!linkedContract.rows.length) {
          throw new AppError('العقد المرتبط بالبدلات غير تابع لهذا الموظف أو المنشأة', 'HR_COMPENSATION_CONTRACT_SCOPE_INVALID', 400);
        }
      }
      const previous = id ? await sql<{ start_date: string | null; end_date: string | null }>`
        SELECT to_char(effective_from, 'YYYY-MM-DD') AS start_date,
               to_char(effective_to, 'YYYY-MM-DD') AS end_date
        FROM hr_compensation_packages
        WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx) : null;
      if (id && !previous?.rows.length) {
        throw new AppError('باقة البدلات غير موجودة', 'HR_COMPENSATION_NOT_FOUND', 404);
      }
      const oldFrom = previous?.rows[0]?.start_date || null;
      const oldTo = previous?.rows[0]?.end_date || null;
      const booked = await sql<{ id: number }>`
        SELECT r.id FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId} AND i.employee_id = ${employeeId}
          AND r.status IN ('approved', 'paid') AND i.status = 'approved'
          AND (
            (r.end_date >= COALESCE(${from}::date, '-infinity'::date)
                AND r.start_date <= COALESCE(${to}::date, 'infinity'::date))
            ${id ? sql`OR (r.end_date >= COALESCE(${oldFrom}::date, '-infinity'::date)
                AND r.start_date <= COALESCE(${oldTo}::date, 'infinity'::date))` : sql``}
          )
        LIMIT 1
      `.execute(trx);
      if (booked.rows.length) {
        throw new AppError('لا يمكن تعديل بدلات فترة مرتبات معتمدة؛ استخدم تسوية مستقلة', 'HR_COMPENSATION_APPROVED_PERIOD_LOCKED', 409);
      }
      if (id) {
        await sql`
          UPDATE hr_compensation_packages
          SET contract_id = ${toId(payload.contractId)}, package_name = ${clean(payload.packageName)},
              allowance_amount = ${allowance}, deduction_amount = ${deduction},
              effective_from = ${from}::date, effective_to = ${to}::date,
              notes = ${clean(payload.notes)}, updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        `.execute(trx);
      } else {
        await sql`
          INSERT INTO hr_compensation_packages
            (tenant_id, account_id, employee_id, contract_id, package_name,
             allowance_amount, deduction_amount, effective_from, effective_to,
             notes, created_by, updated_by)
          VALUES (${tenantId}, ${auth.accountId}, ${employeeId}, ${toId(payload.contractId)},
                  ${clean(payload.packageName)}, ${allowance}, ${deduction},
                  ${from}::date, ${to}::date, ${clean(payload.notes)}, ${auth.userId}, ${auth.userId})
        `.execute(trx);
      }
    });
    await this.audit.log(`${id ? 'Update' : 'Create'} HR compensation`, `Employee #${employeeId} compensation saved by ${auth.username}`, auth);
    return this.listCompensation(employeeId, auth);
  }
}
