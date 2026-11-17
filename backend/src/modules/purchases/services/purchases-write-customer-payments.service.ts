/**
 * PurchasesWriteCustomerPaymentsService — slice S7 of the purchases-write split.
 * Pure move of the customer-payment methods from PurchasesWriteService. No
 * behavior change: the bodies are byte-identical; the facade keeps a thin
 * delegate for the public method with the same name and signature. Deps are
 * db + tx + audit + financeService + accountingPosting + idempotency. The
 * document-number helper stays private in the slice; it has no facade
 * delegate because its only caller is in-slice. No logger.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { CreateCustomerPaymentDto } from '../dto/create-party-payment.dto';
import { assertNonCashTransferReference, normalizeInstapayAddress, normalizeOptionalNote, normalizePurchaseScope, normalizeTransferReference } from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { assertCustomerPaymentJobOwnership } from '../helpers/customer-payment-job-ownership';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface PurchasesWriteCustomerPaymentsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  financeService: PurchasesFinanceService;
  accountingPosting: AccountingPostingService;
  idempotency: IdempotencyService;
}

@Injectable()
export class PurchasesWriteCustomerPaymentsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly financeService: PurchasesFinanceService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly idempotency: IdempotencyService;

  constructor(deps: PurchasesWriteCustomerPaymentsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.financeService = deps.financeService;
    this.accountingPosting = deps.accountingPosting;
    this.idempotency = deps.idempotency;
  }

  async createCustomerPayment(payload: CreateCustomerPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const amount = Number(payload.amount);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
      throw new AppError('Customer payment must be positive and have at most tenant currency minor-unit precision', 'INVALID_PAYMENT_AMOUNT', 400);
    }
    // INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: the gate
    // runs AFTER reserveOperation and INSIDE the try. Refusing before
    // the reservation left no operation_executions row, so the
    // frontend could never learn the attempt had failed (server
    // status 'not_found') and its stored attempt deadlocked the form
    // forever. A 4xx rejection now writes a 'failed' row via the
    // catch below, and the frontend 'failed' branch releases the
    // stored attempt so the cashier can correct and resend. Cash
    // receipts are untouched; the gate itself is unchanged.
    const operationType = 'customer_payment_create';
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        const recorded = existing.responsePayload as Record<string, unknown> | undefined;
        if (recorded?.id) return { ok: true, ...recorded };
        throw new AppError('Customer payment result requires reconciliation', 'PAYMENT_RECOVERY_REQUIRED', 422);
      }
      if (existing?.status === 'processing') throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed') throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required') throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
    assertNonCashTransferReference(payload.paymentChannel, payload.transferReference);
    const paymentResult = await this.tx.runInTransaction(this.db, async (trx) => {
      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'balance'])
        .where('id', '=', payload.customerId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

      const currentBalance = Number(customer.balance || 0);
      const { branchId, locationId } = normalizePurchaseScope(payload);

      let targetJobId: number | null = payload.jobId ? Number(payload.jobId) : null;

      // Explicit payment-to-job linkage must be verified before the receipt or ledger is posted.
      // Auto-match jobs are also checked under the same lock, so concurrent receipts cannot
      // overwrite client_paid_total using a stale snapshot.
      let verifiedJob: { job_number: string | null; client_invoiced_total: number | string | null; client_paid_total: number | string | null } | null = null;

      // Smart Auto-Match: If no explicit job specified, check if customer has exactly ONE active maritime job needing payment
      if (!targetJobId) {
        try {
          const activeJobs = await trx
            .selectFrom('maritime_jobs')
            .select(['id', 'job_number', 'client_invoiced_total', 'client_paid_total', 'payment_status'])
            .where('tenant_id', '=', scope.tenantId)
            .where('customer_id', '=', customer.id)
            .where('status', '=', 'active')
            .where('payment_status', '!=', 'paid')
            .execute();

          if (activeJobs.length === 1) {
            targetJobId = Number(activeJobs[0].id);
          }
        } catch {
          // Ignore if table not ready
        }
      }

      if (targetJobId) {
        const job = await trx
          .selectFrom('maritime_jobs')
          .select(['id', 'job_number', 'customer_id', 'client_invoiced_total', 'client_paid_total'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', String(targetJobId))
          .forUpdate()
          .executeTakeFirst();
        if (!job) throw new AppError('Maritime job not found', 'MARITIME_JOB_NOT_FOUND', 404);
        assertCustomerPaymentJobOwnership(Number(customer.id), job.customer_id);
        verifiedJob = job;
      }

      const insert = await trx
        .insertInto('customer_payments')
        .values({
          customer_id: customer.id,
          amount,
          payment_channel: payload.paymentChannel || 'cash',
          instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress),
          transfer_reference: normalizeTransferReference(payload.paymentChannel, payload.transferReference),
          note: normalizeOptionalNote(payload.note),
          branch_id: branchId,
          location_id: locationId,
          job_id: targetJobId || null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const paymentId = Number(insert.id);
      const paymentNote = normalizeOptionalNote(payload.note);
      const isAdvance = currentBalance <= 0;
      const isOverpayment = currentBalance > 0 && amount > currentBalance;
      const descPrefix = isAdvance
        ? `دفعة مقدمة / عربون من العميل ${customer.name}`
        : isOverpayment
          ? `تحصيل وسداد مع دفعة مقدمة من العميل ${customer.name}`
          : `تحصيل من العميل ${customer.name}`;

      const fullDesc = `${descPrefix}${paymentNote ? ` - ${paymentNote}` : ''}`;
      await this.financeService.addCustomerLedgerEntry(trx, customer.id, -amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId);
      await this.financeService.addTreasuryTransaction(trx, 'customer_payment', amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId, payload.paymentChannel || 'cash');
      const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth);
      if (!posting.journalEntryId) throw new AppError(`Customer payment ${paymentId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);

      const docNo = await this.generateCustomerPaymentDocNo(trx, scope.tenantId, paymentId);

      let allocatedJobNumber: string | null = null;
      if (verifiedJob && targetJobId) {
        allocatedJobNumber = verifiedJob.job_number;
        const currentPaid = Number(verifiedJob.client_paid_total || 0);
        const newPaid = currentPaid + amount;
        const invoiced = Number(verifiedJob.client_invoiced_total || 0);
        const newPaymentStatus = (invoiced > 0 && newPaid >= invoiced) ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'unpaid');

        await trx
          .updateTable('maritime_jobs')
          .set({
            client_paid_total: newPaid,
            payment_status: newPaymentStatus,
            paid_at: newPaymentStatus === 'paid' ? sql`NOW()` : null,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', String(targetJobId))
          .where('tenant_id', '=', scope.tenantId)
          .where('customer_id', '=', customer.id)
          .execute();

        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: scope.tenantId,
            job_id: String(targetJobId),
            milestone_key: 'PAYMENT',
            milestone_title: `سداد مالي: سند قبض #${docNo} (${newPaymentStatus === 'paid' ? 'مسدد بالكامل' : 'سداد جزئي'})`,
            location: 'الخزينة والحسابات',
            notes: `تم ربط وتخصيص دفعة نقدية بقيمة ${amount} ج.م من سند القبض ${docNo} للشحنة ${verifiedJob.job_number}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          } as any)
          .execute();
      }

      const receipt = {
        id: paymentId,
        docNo,
        customerId: customer.id,
        customerName: customer.name,
        amount,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance - amount,
        note: paymentNote,
        jobId: targetJobId,
        jobNumber: allocatedJobNumber,
        createdAt: new Date().toISOString(),
      };
      // The audit record is part of the same atomic voucher transaction; an
      // audit failure cannot turn an already-posted payment into an HTTP failure.
      await this.audit.logWithExecutor(trx, 'سند قبض / تحصيل عميل',
        `تم تسجيل سند قبض ${docNo} للعميل ${customer.name} بمبلغ ${amount} بواسطة ${auth.username}`, auth);
      // Commit the operation and the financial voucher in the SAME DB transaction.
      if (idempotencyKey) {
        await this.idempotency.commitOperation(trx, {
          tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        }, receipt, String(paymentId));
      }
      return receipt;
    });

    return { ok: true, ...paymentResult };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency.recordFailure({
            tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
          }, error.code).catch(() => undefined);
        } else {
          await this.db.updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId).where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey).where('operation_type', '=', operationType)
            .where('status', '=', 'processing').where('document_id', 'is', null).execute().catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async generateCustomerPaymentDocNo(trx: Kysely<Database>, tenantId: string, paymentId: number): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `REC-${datePrefix}-${seq}`;
  }
}
