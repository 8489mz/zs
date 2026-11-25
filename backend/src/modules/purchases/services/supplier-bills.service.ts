import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { getTenantTimezone, todayTenantDate, formatLocalCalendarDay } from '../../../common/utils/tenant-timezone.util';
import { checkClientBusinessDay } from '../../../common/utils/client-date-bounds.util';
import { generateDailySequenceNumber } from '../../delivery-reps/services/van-common.util';
import { normalizeOptionalNote } from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { CreateSupplierBillDto } from '../dto/supplier-bill.dto';
import { buildBillTotal, validateBillLineAccount } from '../engines/supplier-bill.engine';
import { PurchasesFinanceService } from './purchases-finance.service';

/*
 * SupplierBillsService — INV-SUPPLIER-NONSTOCK-BILL.
 *
 * A non-stock supplier bill records a debt to a supplier for things that
 * never touch inventory (a program, a carton of paper, cables, a service).
 * One bill: supplier + business day + free-text lines, each line carrying
 * the chart account its amount belongs to. The bill raises
 * suppliers.balance, posts Dr each line account / Cr 2110, and writes one
 * supplier-ledger row — and nothing else. No product, no stock movement,
 * no GRN, no landed cost, no three-way match: this document must never
 * be able to move inventory, and no code path here calls any stock API.
 *
 * The bill date is the server tenant day by default; an explicit date is
 * validated against the clock-P6 client-date window ([today-7d, today]).
 * Doc numbers come from the canonical daily-sequence engine (SPB-YYMMDD).
 */
@Injectable()
export class SupplierBillsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly financeService: PurchasesFinanceService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async createSupplierBill(
    payload: CreateSupplierBillDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const operationType = 'supplier_bill_create';
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey,
        operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        const billId = Number(
          existing.documentId || (existing.responsePayload as { id?: number } | undefined)?.id || 0,
        );
        if (billId > 0) return { ok: true, bill: await this.readBill(billId, auth) };
        return { ok: true, bill: existing.responsePayload };
      }
      if (existing?.status === 'processing')
        throw new AppError('Supplier bill is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed')
        throw new AppError(existing.errorCode || 'Supplier bill previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required')
        throw new AppError('Supplier bill requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
      const result = await this.tx.runInTransaction(this.db, async (trx) => {
        const supplier = await trx
          .selectFrom('suppliers')
          .select(['id', 'name', 'balance'])
          .where('id', '=', payload.supplierId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
        const lines = Array.isArray((payload as { lines?: unknown }).lines)
          ? (payload.lines as Array<{ description?: unknown; accountId?: unknown; amount?: unknown }>)
          : [];
        if (lines.length === 0)
          throw new AppError('Supplier bill needs at least one line', 'SUPPLIER_BILL_NO_LINES', 400);
        for (const line of lines) {
          if (!String(line.description || '').trim()) {
            throw new AppError('Supplier bill line description is required', 'SUPPLIER_BILL_INVALID_LINE', 400);
          }
        }
        const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const total = buildBillTotal(lines as Array<{ amount: number }>, digits);

        const accountIds = [...new Set(lines.map((line) => Number(line.accountId)))];
        if (accountIds.some((id) => !Number.isFinite(id) || !(id > 0))) {
          throw new AppError('Supplier bill line account is required', 'SUPPLIER_BILL_INVALID_ACCOUNT', 400);
        }
        const accountRows = await trx
          .selectFrom('accounting_accounts')
          .select(['id', 'code', 'account_type', 'normal_balance', 'is_active', 'is_control_account'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', accountIds)
          .execute();
        const accountById = new Map<number, (typeof accountRows)[number]>(
          accountRows.map((row) => [Number(row.id), row]),
        );
        for (const line of lines) {
          validateBillLineAccount(accountById.get(Number(line.accountId)) as any, String(line.description || ''));
        }

        const tz = await getTenantTimezone(trx, scope.tenantId);
        let billDayKey: string;
        if (payload.billDate) {
          const checked = checkClientBusinessDay(payload.billDate, tz, { minDayOffset: -7, maxDayOffset: 0 });
          if (!checked.ok) {
            throw new AppError(
              'Supplier bill date is outside the allowed business-day window',
              'SUPPLIER_BILL_DATE_OUT_OF_RANGE',
              400,
            );
          }
          billDayKey = checked.dayKey;
        } else {
          billDayKey = todayTenantDate(tz);
        }
        const docNo = await generateDailySequenceNumber(
          trx,
          this.db,
          'supplier_bills',
          'doc_no',
          'SPB',
          scope.tenantId,
        );

        const note = normalizeOptionalNote(payload.note);
        const inserted = await trx
          .insertInto('supplier_bills')
          .values({
            supplier_id: supplier.id,
            doc_no: docNo,
            bill_date: billDayKey,
            total,
            note,
            status: 'posted',
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const billId = Number(inserted.id);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          await trx
            .insertInto('supplier_bill_lines')
            .values({
              bill_id: billId,
              description: String(line.description || '').trim(),
              chart_account_id: Number(line.accountId),
              amount: Number(line.amount),
              sort_order: index + 1,
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
            })
            .execute();
        }
        await this.financeService.addSupplierLedgerEntry(
          trx,
          supplier.id,
          total,
          'supplier_bill',
          `فاتورة مورد بدون مخزون ${docNo} — ${supplier.name}${note ? ` - ${note}` : ''}`,
          'supplier_bill',
          billId,
          auth,
          null,
          null,
        );
        const posting = await this.accountingPosting.postSupplierBill(trx, billId, auth);
        if (!posting.journalEntryId)
          throw new AppError(`Supplier bill ${billId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
        /* INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT: a new bill settles the
         * supplier's outstanding advances automatically, oldest first,
         * up to the bill total — the payable must not stay overstated
         * between the bill and a manual apply. postSupplierAdvanceApplication
         * re-checks the outstanding-advance and payable caps and advances
         * the applied_amount counter; the ledger entry mirrors
         * applySupplierAdvance so the statement shows the application.
         * Auto-apply runs ONLY for supplier bills, never purchase
         * invoices. It runs inside this same transaction (calling the
         * public applySupplierAdvance here would open a second
         * transaction on the same single PGlite connection and hang). */
        const appliedAdvances: Array<{ paymentId: number; amount: number }> = [];
        let remainingBill = total;
        if (remainingBill > 0) {
          const scale = 10 ** digits;
          const advances = await trx
            .selectFrom('supplier_payments')
            .select(['id', 'doc_no', 'amount', 'applied_amount', 'branch_id', 'location_id'])
            .where('tenant_id', '=', scope.tenantId)
            .where('account_id', '=', scope.accountId)
            .where('supplier_id', '=', supplier.id)
            .where('is_advance', '=', true)
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .execute();
          for (const advanceRow of advances) {
            if (remainingBill <= 0) break;
            const outstanding =
              Math.round(
                (Number((advanceRow as any).amount || 0) - Number((advanceRow as any).applied_amount || 0)) * scale,
              ) / scale;
            if (!(outstanding > 0)) continue;
            const applyAmount = Math.min(outstanding, remainingBill);
            const application = await this.accountingPosting.postSupplierAdvanceApplication(
              trx,
              Number((advanceRow as any).id),
              applyAmount,
              null,
              auth,
            );
            if (!application.journalEntryId)
              throw new AppError(
                `Supplier advance application ${Number((advanceRow as any).id)} has no journal entry`,
                'LEDGER_POSTING_MISSING',
                500,
              );
            await this.financeService.addSupplierLedgerEntry(
              trx,
              supplier.id,
              -applyAmount,
              'supplier_advance_application',
              `تطبيق دفعة مقدمة ${String((advanceRow as any).doc_no || `ZPV-${advanceRow.id}`)} على مستحقات ${supplier.name}`,
              'supplier_payment',
              Number((advanceRow as any).id),
              auth,
              (advanceRow as any).branch_id ? Number((advanceRow as any).branch_id) : null,
              (advanceRow as any).location_id ? Number((advanceRow as any).location_id) : null,
            );
            appliedAdvances.push({ paymentId: Number((advanceRow as any).id), amount: applyAmount });
            remainingBill = Math.round((remainingBill - applyAmount) * scale) / scale;
          }
        }
        await this.audit.logWithExecutor(
          trx,
          'فاتورة مورد بدون مخزون',
          `تم تسجيل فاتورة مورد بدون مخزون ${docNo} للمورد ${supplier.name} بواسطة ${auth.username}`,
          auth,
        );
        if (idempotencyKey) {
          await this.idempotency.commitOperation(
            trx,
            {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              idempotencyKey,
              operationType,
            },
            { id: billId, docNo, total },
            String(billId),
          );
        }
        return { id: billId, docNo, total, appliedAdvances };
      });
      return {
        ok: true,
        bill: await this.readBill(Number((result as { id: number }).id), auth),
        appliedAdvances:
          (result as { appliedAdvances?: Array<{ paymentId: number; amount: number }> }).appliedAdvances || [],
      };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency
            .recordFailure(
              { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType },
              error.code,
            )
            .catch(() => undefined);
        } else {
          await this.db
            .updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId)
            .where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey)
            .where('operation_type', '=', operationType)
            .where('status', '=', 'processing')
            .where('document_id', 'is', null)
            .execute()
            .catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async listSupplierBills(supplierId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const bills = await this.db
      .selectFrom('supplier_bills')
      .select(['id', 'supplier_id', 'doc_no', 'bill_date', 'total', 'note', 'status', 'created_at'])
      .where('tenant_id', '=', scope.tenantId)
      .where('supplier_id', '=', supplierId)
      .orderBy('bill_date', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const billIds = bills.map((row) => Number(row.id));
    const billLines =
      billIds.length > 0
        ? await this.db
            .selectFrom('supplier_bill_lines')
            .select(['bill_id', 'description', 'chart_account_id', 'amount', 'sort_order'])
            .where('tenant_id', '=', scope.tenantId)
            .where('bill_id', 'in', billIds)
            .orderBy('bill_id', 'asc')
            .orderBy('sort_order', 'asc')
            .execute()
        : [];
    const linesByBill = new Map<number, Array<Record<string, unknown>>>();
    for (const row of billLines) {
      const key = Number(row.bill_id);
      const list = linesByBill.get(key) || [];
      list.push({ description: row.description, accountId: Number(row.chart_account_id), amount: Number(row.amount) });
      linesByBill.set(key, list);
    }
    return {
      ok: true,
      bills: bills.map((row) => ({
        id: String(row.id),
        supplierId: String(row.supplier_id),
        docNo: row.doc_no,
        billDate: row.bill_date instanceof Date ? formatLocalCalendarDay(row.bill_date) : String(row.bill_date),
        total: Number(row.total),
        note: row.note || '',
        status: row.status,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
        lines: linesByBill.get(Number(row.id)) || [],
      })),
    };
  }

  private async readBill(billId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const bill = await this.db
      .selectFrom('supplier_bills')
      .select(['id', 'supplier_id', 'doc_no', 'bill_date', 'total', 'note', 'status', 'created_at'])
      .where('id', '=', billId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirstOrThrow();
    const billLines = await this.db
      .selectFrom('supplier_bill_lines')
      .select(['description', 'chart_account_id', 'amount', 'sort_order'])
      .where('bill_id', '=', billId)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('sort_order', 'asc')
      .execute();
    return {
      id: String(bill.id),
      supplierId: String(bill.supplier_id),
      docNo: bill.doc_no,
      billDate: bill.bill_date instanceof Date ? formatLocalCalendarDay(bill.bill_date) : String(bill.bill_date),
      total: Number(bill.total),
      note: bill.note || '',
      status: bill.status,
      createdAt: bill.created_at instanceof Date ? bill.created_at.toISOString() : String(bill.created_at || ''),
      lines: billLines.map((row) => ({
        description: row.description,
        accountId: Number(row.chart_account_id),
        amount: Number(row.amount),
      })),
    };
  }
}
