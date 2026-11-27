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
import {
  assertNonCashTransferReference,
  normalizeInstapayAddress,
  normalizeOptionalNote,
  normalizePurchaseScope,
  normalizeTransferReference,
} from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { assertCustomerPaymentJobOwnership } from '../helpers/customer-payment-job-ownership';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import {
  resolvePosTripAttribution,
  type PosTripAttribution,
} from '../../sales/services/create-sale/resolve-pos-trip-attribution';

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

  async createCustomerPayment(
    payload: CreateCustomerPaymentDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const amount = Number(payload.amount);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
      throw new AppError(
        'Customer payment must be positive and have at most tenant currency minor-unit precision',
        'INVALID_PAYMENT_AMOUNT',
        400,
      );
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
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey,
        operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        const recorded = existing.responsePayload as Record<string, unknown> | undefined;
        if (recorded?.id) return { ok: true, ...recorded };
        throw new AppError('Customer payment result requires reconciliation', 'PAYMENT_RECOVERY_REQUIRED', 422);
      }
      if (existing?.status === 'processing')
        throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed')
        throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required')
        throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
      assertNonCashTransferReference(payload.paymentChannel, payload.transferReference);
      // F7c (POS-to-trip attribution for collections, trial problem 9):
      // resolve the acting rep + active trip BEFORE the transaction
      // opens, reusing the F7 resolver (one attribution, two POS
      // paths: sales + collections). A lookup that fails inside the
      // transaction would abort the whole receipt (25P02), so any
      // failure here leaves the payment unattributed instead of
      // unposted. The DTO carries no explicit rep, so the link is
      // always the acting user's phone/username rep row.
      let vanTripAttribution: PosTripAttribution | null = null;
      try {
        vanTripAttribution = await resolvePosTripAttribution(this.db, {
          tenantId: scope.tenantId,
          auth,
          explicitRepId: null,
        });
      } catch {
        vanTripAttribution = null;
      }
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

        // Job linkage is resolved BEFORE the balance gate: a job-linked
        // payment is governed by the job's own invoiced/paid totals, not
        // by the customer balance (see the gate below). The block is
        // unchanged, only moved up.
        let targetJobId: number | null = payload.jobId ? Number(payload.jobId) : null;

        // Explicit payment-to-job linkage must be verified before the receipt or ledger is posted.
        // Auto-match jobs are also checked under the same lock, so concurrent receipts cannot
        // overwrite client_paid_total using a stale snapshot.
        let verifiedJob: {
          job_number: string | null;
          client_invoiced_total: number | string | null;
          client_paid_total: number | string | null;
        } | null = null;

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

        // INV-REP-COLLECTION-TOTAL-BALANCE-CAP (F2, POS path): a customer
        // receipt may not exceed the customer's outstanding balance. The
        // portal/field path refuses this under
        // REP_COLLECTION_EXCEEDS_TOTAL_BALANCE 422 (validateIsolatedRepCollection
        // + the defence-in-depth floor in record-field-collection.slice.ts);
        // this path used to book the excess silently as an "advance"
        // (the old advance/overpayment flags only chose a description
        // prefix), which drove C-1057 to -50.00 in the van trial
        // (REC-000019 collected an already-paid 50.00 invoice a second
        // time). The comparison mirrors the portal engine (raw amount >
        // balance); the refusal happens inside the transaction, before
        // any write, so the whole receipt rolls back. There is no advance concept on this path —
        // CreateCustomerPaymentDto carries no advance flag (unlike the
        // supplier side, INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT) — so refusal
        // is the behaviour; an explicitly-approved advance needs a
        // separate flow and is out of scope here.
        // JOB-LINKED CARVE-OUT (coordinator repair, 2026-11-22): a payment
        // linked to a maritime job is NOT governed by the customer
        // balance — a pre-invoice job deposit legitimately posts while
        // the customer balance is 0 (the job's client_paid_total tracks
        // it and a milestone is recorded below; the old code posted it
        // the same way). For a job-linked payment the cap is the job's
        // own remaining invoiced amount: when the job is invoiced
        // (invoiced > 0) the payment may not exceed invoiced − paid; when
        // it is uninvoiced (invoiced = 0) the payment is a deposit and is
        // allowed. The defence-in-depth floor below is skipped for the
        // same reason (a job deposit legitimately takes the customer
        // balance negative as an advance against the job).
        if (verifiedJob) {
          const jobInvoiced = Number(verifiedJob.client_invoiced_total || 0);
          const jobPaid = Number(verifiedJob.client_paid_total || 0);
          const jobRemaining = jobInvoiced - jobPaid;
          if (jobInvoiced > 0 && amount > jobRemaining) {
            throw new AppError(
              `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من المتبقي على الشحنة "${verifiedJob.job_number}" (${jobRemaining} ج.م من أصل ${jobInvoiced} ج.م، والمسدد ${jobPaid} ج.م).`,
              'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
              422,
            );
          }
        } else if (amount > currentBalance) {
          throw new AppError(
            currentBalance <= 0
              ? `لا توجد مديونية مستحقة على العميل "${customer.name}" لتحصيل مبلغ (${amount} ج.م) — الرصيد ${currentBalance} ج.م. الدفعة المقدمة تتم عبر مسار اعتماد منفصل، ولا تُقيد تلقائياً.`
              : `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من إجمالي مديونية العميل "${customer.name}" (${currentBalance} ج.م). لا توجد سلفة مسجلة على هذا العميل تسمح بالتحصيل الزائد.`,
            'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
            422,
          );
        }

        // F7c: the pre-transaction candidate is re-checked inside
        // this transaction — the trip row is locked and only a
        // still-OPEN trip accepts the stamp and its counters (the same
        // predicate lockOpenTripRow uses: any status except 'settled').
        // A trip settled between resolution and insert receives
        // neither; the payment still posts. The gate above already
        // ran, so a refused collection stamps and moves nothing.
        let vanTripId: number | null = null;
        let attributedRepId: number | null = null;
        if (vanTripAttribution) {
          const tripRow = await trx
            .selectFrom('van_sales_trips')
            .select(['id', 'status'])
            .where('id', '=', vanTripAttribution.tripId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst();
          if (tripRow && String(tripRow.status || '') !== 'settled') {
            vanTripId = vanTripAttribution.tripId;
            attributedRepId = vanTripAttribution.repId;
          }
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
            van_trip_id: vanTripId,
            rep_id: attributedRepId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const paymentId = Number(insert.id);
        // F7c: the trip counter moves EXACTLY ONCE, in this same
        // transaction, by channel — mirroring the field-collection
        // slice (record-field-collection.slice.ts), the only other
        // writer of a customer_payments row's trip counters. Cash
        // sits with the rep, so cash_collected += amount; instapay
        // and bank are electronic (the stored 'bank' value IS the
        // field path's bank_transfer — resolveFieldCollectionChannel),
        // so total_instapay_collections += amount, feeding
        // settle-trip's expectedBankTransfers; card / wallet money
        // never sits with the rep, so no counter moves — the same
        // zero leg tripSaleContribution gives a card sale. The row
        // is stamped in all three cases. No other path moves a POS
        // collection's counters (the field path writes its own rows;
        // settlement only reads the counters), so this is the single
        // move; a refused collection never reaches here.
        if (vanTripId) {
          const channel = String(payload.paymentChannel || 'cash')
            .trim()
            .toLowerCase();
          if (channel === 'cash') {
            await trx
              .updateTable('van_sales_trips')
              .set({
                cash_collected: sql`cash_collected + ${amount}`,
                updated_at: sql`NOW()`,
              })
              .where('id', '=', vanTripId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();
          } else if (channel === 'instapay' || channel === 'bank') {
            await trx
              .updateTable('van_sales_trips')
              .set({
                total_instapay_collections: sql`total_instapay_collections + ${amount}`,
                updated_at: sql`NOW()`,
              })
              .where('id', '=', vanTripId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();
          }
        }
        // The receipt number is generated here, before the ledger /
        // treasury / journal writes, so it can be part of every
        // narration (problem 28). The value is unchanged: it derives
        // only from the payment id and the current date.
        const docNo = await this.generateCustomerPaymentDocNo(trx, scope.tenantId, paymentId);
        const paymentNote = normalizeOptionalNote(payload.note);
        const fullDesc = `تحصيل من العميل ${customer.name} — سند قبض ${docNo}${paymentNote ? ` - ${paymentNote}` : ''}`;
        await this.financeService.addCustomerLedgerEntry(
          trx,
          customer.id,
          -amount,
          fullDesc,
          'customer_payment',
          paymentId,
          auth,
          branchId,
          locationId,
        );
        // INV-REP-COLLECTION-TOTAL-BALANCE-CAP (defence in depth): the
        // gate above refuses any collection above the customer's total
        // debt, so this must never fire — but the write itself must
        // never commit a negative customer balance even if a future
        // caller reaches it without the gate. Throwing here rolls the
        // whole receipt transaction back. The comparison is at book
        // digits so a sub-minor-unit residue in a legacy balance cannot
        // refuse a collection the gate allowed. Skipped for job-linked
        // payments: a pre-invoice job deposit legitimately takes the
        // customer balance negative (advance against the job; the job's
        // client_paid_total tracks it).
        const balanceAfterRow = await trx
          .selectFrom('customers')
          .select('balance')
          .where('id', '=', customer.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();
        if (!verifiedJob && balanceAfterRow && roundMoney(Number(balanceAfterRow.balance || 0), digits) < 0) {
          throw new AppError(
            `لا يمكن تحصيل مبلغ (${amount} ج.م) من العميل "${customer.name}" أكبر من مديونية العميل — الرصيد بعد التحصيل سالب (${Number(balanceAfterRow.balance)} ج.م)`,
            'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
            422,
          );
        }
        await this.financeService.addTreasuryTransaction(
          trx,
          'customer_payment',
          amount,
          fullDesc,
          'customer_payment',
          paymentId,
          auth,
          branchId,
          locationId,
          payload.paymentChannel || 'cash',
        );
        const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth, docNo);
        if (!posting.journalEntryId)
          throw new AppError(`Customer payment ${paymentId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);

        let allocatedJobNumber: string | null = null;
        if (verifiedJob && targetJobId) {
          allocatedJobNumber = verifiedJob.job_number;
          const currentPaid = Number(verifiedJob.client_paid_total || 0);
          const newPaid = currentPaid + amount;
          const invoiced = Number(verifiedJob.client_invoiced_total || 0);
          const newPaymentStatus =
            invoiced > 0 && newPaid >= invoiced ? 'paid' : newPaid > 0 ? 'partially_paid' : 'unpaid';

          await trx
            .updateTable('maritime_jobs')
            .set({
              client_paid_total: newPaid,
              payment_status: newPaymentStatus,
              paid_at: newPaymentStatus === 'paid' ? sql`NOW()` : null,
              updated_at: sql`NOW()`,
            })
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
            })
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
        await this.audit.logWithExecutor(
          trx,
          'سند قبض / تحصيل عميل',
          `تم تسجيل سند قبض ${docNo} للعميل ${customer.name} بمبلغ ${amount} بواسطة ${auth.username}`,
          auth,
        );
        // Commit the operation and the financial voucher in the SAME DB transaction.
        if (idempotencyKey) {
          await this.idempotency.commitOperation(
            trx,
            {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              idempotencyKey,
              operationType,
            },
            receipt,
            String(paymentId),
          );
        }
        return receipt;
      });

      return { ok: true, ...paymentResult };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency
            .recordFailure(
              {
                tenantId: scope.tenantId,
                accountId: scope.accountId,
                idempotencyKey,
                operationType,
              },
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

  private async generateCustomerPaymentDocNo(
    trx: Kysely<Database>,
    tenantId: string,
    paymentId: number,
  ): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `REC-${datePrefix}-${seq}`;
  }
}
