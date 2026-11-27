/**
 * PurchasesWriteSupplierPaymentsService — slice S6 of the purchases-write split.
 * Pure move of the supplier-payment methods from PurchasesWriteService. No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures for the two public methods.
 * The private doc-number helper travels with the slice and stays private.
 * Deps are db + tx + audit + financeService + queryService + accountingPosting
 * + idempotency, all required and bound from the facade constructor.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { ApplySupplierAdvanceDto, CreateSupplierPaymentDto } from '../dto/create-party-payment.dto';
import {
  normalizeInstapayAddress,
  normalizeOptionalNote,
  normalizePurchaseScope,
} from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { PurchasesQueryService } from './purchases-query.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface PurchasesWriteSupplierPaymentsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  financeService: PurchasesFinanceService;
  queryService: PurchasesQueryService;
  accountingPosting: AccountingPostingService;
  idempotency: IdempotencyService;
}

@Injectable()
export class PurchasesWriteSupplierPaymentsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly financeService: PurchasesFinanceService;
  private readonly queryService: PurchasesQueryService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly idempotency: IdempotencyService;

  constructor(deps: PurchasesWriteSupplierPaymentsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.financeService = deps.financeService;
    this.queryService = deps.queryService;
    this.accountingPosting = deps.accountingPosting;
    this.idempotency = deps.idempotency;
  }

  async createSupplierPayment(
    payload: CreateSupplierPaymentDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const operationType = 'supplier_payment_create';
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey,
        operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        return { ok: true, supplierPayments: (await this.queryService.listSupplierPayments(auth)).supplierPayments };
      }
      if (existing?.status === 'processing')
        throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed')
        throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required')
        throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
      const paymentResult = await this.tx.runInTransaction(this.db, async (trx) => {
        const supplier = await trx
          .selectFrom('suppliers')
          .select(['id', 'name', 'balance', 'overdraft_limit'])
          .where('id', '=', payload.supplierId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
        const amount = Number(payload.amount || 0);
        if (
          !Number.isFinite(amount) ||
          amount <= 0 ||
          Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001
        ) {
          throw new AppError(
            'Supplier payment must be positive and have at most tenant currency minor-unit precision',
            'INVALID_AMOUNT',
            400,
          );
        }
        const currentBalance = Number(supplier.balance || 0);
        /* INV-SUPPLIER-ADVANCE-UI-WIRING: an advance is money out BEFORE
         * any bill exists, so the payable guards do not apply to it — a
         * true advance needs no outstanding balance, cannot "overpay" a
         * payable it does not settle, and settles nothing. The flag says
         * so, but a payment against a zero balance IS an advance by
         * definition — derived from the data, like the customer flow. */
        const isAdvance = payload.isAdvance === true || currentBalance <= 0;
        /* INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT: an advance is capped by the
         * owner-set overdraft limit — cumulative, not per withdrawal. The
         * cap sums outstanding advances (amount - applied_amount) under the
         * same supplier lock, so concurrent withdrawals cannot overshoot
         * it. NULL means uncapped: the legacy behaviour for every ordinary
         * supplier (a default of 0 would have blocked the already-live
         * advance flow for all of them). */
        if (isAdvance) {
          const limit = supplier.overdraft_limit == null ? null : Number(supplier.overdraft_limit);
          if (limit != null) {
            const outstandingRow = await trx
              .selectFrom('supplier_payments')
              .select(sql<number>`coalesce(sum(amount - applied_amount), 0)`.as('outstanding'))
              .where('tenant_id', '=', scope.tenantId)
              .where('account_id', '=', scope.accountId)
              .where('supplier_id', '=', supplier.id)
              .where('is_advance', '=', true)
              .executeTakeFirst();
            const afterThis = Math.round((Number(outstandingRow?.outstanding || 0) + amount) * scale) / scale;
            if (afterThis > limit + 0.0001) {
              throw new AppError('Supplier advance exceeds the overdraft limit', 'SUPPLIER_ADVANCE_OVER_LIMIT', 400);
            }
          }
        }
        if (!isAdvance) {
          if (!(currentBalance > 0))
            throw new AppError('Supplier has no outstanding balance', 'SUPPLIER_NO_BALANCE', 400);
          if (amount > currentBalance + 0.0001)
            throw new AppError('Supplier payment cannot exceed outstanding balance', 'SUPPLIER_OVERPAYMENT', 400);
        }
        // Amounts reserved by active installment schedules are not free supplier
        // debt. Otherwise an ordinary payment can settle the same payable while
        // its installment remains outstanding, leaving duplicate obligations.
        // An advance settles nothing, so the reserved-debt guard does not
        // apply to it either (INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT).
        if (!isAdvance) {
          const reservedSchedules = await trx
            .selectFrom('supplier_payment_schedules')
            .select(sql<number>`coalesce(sum(greatest(amount - paid_amount, 0)), 0)`.as('reserved'))
            .where('tenant_id', '=', scope.tenantId)
            .where('account_id', '=', scope.accountId)
            .where('supplier_id', '=', supplier.id)
            .where('status', '!=', 'cancelled')
            .executeTakeFirst();
          const unrestrictedBalance = Math.max(
            0,
            Math.round((currentBalance - Number(reservedSchedules?.reserved || 0)) * scale) / scale,
          );
          if (amount > unrestrictedBalance + 0.0001) {
            throw new AppError(
              'جزء من رصيد المورد محجوز في أقساط؛ سددها من جدول الأقساط أو استخدم الرصيد غير المجدول',
              'SUPPLIER_PAYMENT_SCHEDULE_RESERVED',
              409,
            );
          }
        }

        // Gateway: three-way match must not be blocking.
        // The match previously only wrote a status label on the invoice; nothing consulted it, so an
        // invoice flagged quantity_mismatch (billed more than was received) was paid without friction.
        await this.financeService.assertNoBlockingThreeWayMatch(trx, supplier.id, scope.tenantId);

        const { branchId, locationId } = normalizePurchaseScope(payload);

        const insert = await trx
          .insertInto('supplier_payments')
          .values({
            supplier_id: supplier.id,
            amount,
            is_advance: isAdvance,
            applied_amount: 0,
            payment_channel: payload.paymentChannel || 'cash',
            instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress),
            note: normalizeOptionalNote(payload.note),
            branch_id: branchId,
            location_id: locationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const id = Number(insert.id);
        const docNo = await this.generateSupplierPaymentDocNo(trx, id, scope.tenantId);
        await trx
          .updateTable('supplier_payments')
          .set({ doc_no: docNo })
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        const paymentNote = normalizeOptionalNote(payload.note);
        /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: an advance is an asset,
         * not a settlement — it must NOT write a -amount supplier
         * ledger entry (that is what netted the D08 payable 300 ->
         * 100). The payable balance stays exactly as it was; only the
         * cash leaves (treasury -amount, counted in the drawer) and
         * the journal posts Dr 1185 / Cr cash. */
        if (!isAdvance) {
          await this.financeService.addSupplierLedgerEntry(
            trx,
            supplier.id,
            -amount,
            'supplier_payment',
            `دفع إلى ${supplier.name}${paymentNote ? ` - ${paymentNote}` : ''}`,
            'supplier_payment',
            id,
            auth,
            branchId,
            locationId,
          );
        } else {
          /* INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT: the advance is invisible
           * in the supplier statement unless it leaves a trace — a
           * zero-amount marker row (entry_type 'supplier_advance') whose
           * balance_after is the untouched payable. Amount 0 keeps
           * sum(amount) over the ledger equal to suppliers.balance and
           * contributes nothing to the statement totals; the statement
           * joins the payment to expose the advance amount. */
          await this.financeService.addSupplierLedgerEntry(
            trx,
            supplier.id,
            0,
            'supplier_advance',
            `دفعة مقدمة إلى ${supplier.name}${paymentNote ? ` - ${paymentNote}` : ''}`,
            'supplier_payment',
            id,
            auth,
            branchId,
            locationId,
          );
        }
        await this.financeService.addTreasuryTransaction(
          trx,
          'supplier_payment',
          -amount,
          `${isAdvance ? 'دفعة مقدمة إلى' : 'دفع إلى'} ${supplier.name}${paymentNote ? ` - ${paymentNote}` : ''}`,
          'supplier_payment',
          id,
          auth,
          branchId,
          locationId,
          payload.paymentChannel || 'cash',
        );
        const posting = await this.accountingPosting.postSupplierPayment(trx, id, auth);
        if (!posting.journalEntryId)
          throw new AppError(`Supplier payment ${id} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
        await this.audit.logWithExecutor(
          trx,
          isAdvance ? 'دفعة مقدمة لمورد' : 'دفع لمورد',
          `تم تسجيل ${isAdvance ? 'دفعة مقدمة لمورد' : 'دفع لمورد'} ${docNo} بواسطة ${auth.username}`,
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
            { id, docNo },
            String(id),
          );
        }
        return { id, docNo };
      });

      return { ok: true, supplierPayments: (await this.queryService.listSupplierPayments(auth)).supplierPayments };
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

  /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: apply part or all of a
   * supplier advance against a later bill. One transaction:
   * (1) the posting posts Dr 2110 / Cr 1185 and advances the
   * applied_amount counter (capped at the outstanding advance and
   * at the payable balance, both re-checked inside the posting);
   * (2) a supplier-ledger entry of -amount relieves the payable
   * balance and leaves the audit trail in the supplier statement.
   * The journal sync never runs for source type
   * 'supplier_advance_application', so the balance moves exactly
   * once, here — never twice. No cash moves: the cash left when the
   * advance was paid, so there is no treasury row and no drawer
   * effect at apply time. */
  async applySupplierAdvance(
    advancePaymentId: number,
    payload: ApplySupplierAdvanceDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    const amount = Number(payload.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
      throw new AppError(
        'Advance application must be positive and have at most tenant currency minor-unit precision',
        'INVALID_AMOUNT',
        400,
      );
    }
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const payment = await trx
        .selectFrom('supplier_payments')
        .select(['id', 'doc_no', 'supplier_id', 'amount', 'is_advance', 'applied_amount', 'branch_id', 'location_id'])
        .where('id', '=', advancePaymentId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!payment) throw new AppError('Supplier advance payment not found', 'SUPPLIER_ADVANCE_NOT_FOUND', 404);
      if (payment.is_advance !== true)
        throw new AppError('Payment is not a supplier advance', 'SUPPLIER_ADVANCE_NOT_ADVANCE', 400);
      const supplier = await trx
        .selectFrom('suppliers')
        .select(['id', 'name', 'balance'])
        .where('id', '=', Number(payment.supplier_id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
      const outstanding =
        Math.round((Number(payment.amount || 0) - Number(payment.applied_amount || 0)) * scale) / scale;
      if (amount > outstanding + 0.0001) {
        throw new AppError(
          `Advance application ${amount} exceeds the outstanding advance ${outstanding}`,
          'SUPPLIER_ADVANCE_OVERAPPLY',
          400,
        );
      }
      if (amount > Number(supplier.balance || 0) + 0.0001) {
        throw new AppError(
          `Advance application ${amount} exceeds the supplier payable balance ${Number(supplier.balance || 0)}`,
          'SUPPLIER_ADVANCE_EXCEEDS_PAYABLE',
          400,
        );
      }
      let purchaseId: number | null = null;
      if (payload.purchaseId != null) {
        const purchase = await trx
          .selectFrom('purchases')
          .select(['id', 'supplier_id', 'status'])
          .where('id', '=', Number(payload.purchaseId))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();
        if (
          !purchase ||
          Number(purchase.supplier_id) !== Number(payment.supplier_id) ||
          purchase.status === 'cancelled'
        ) {
          throw new AppError(
            'Advance can only be applied to an open bill of the same supplier',
            'SUPPLIER_ADVANCE_PURCHASE_MISMATCH',
            400,
          );
        }
        purchaseId = Number(purchase.id);
      }
      const posting = await this.accountingPosting.postSupplierAdvanceApplication(
        trx,
        advancePaymentId,
        amount,
        purchaseId,
        auth,
      );
      if (!posting.journalEntryId)
        throw new AppError(
          `Supplier advance application ${advancePaymentId} has no journal entry`,
          'LEDGER_POSTING_MISSING',
          500,
        );
      const branchId = payment.branch_id ? Number(payment.branch_id) : null;
      const locationId = payment.location_id ? Number(payment.location_id) : null;
      await this.financeService.addSupplierLedgerEntry(
        trx,
        Number(supplier.id),
        -amount,
        'supplier_advance_application',
        `تطبيق دفعة مقدمة ${String(payment.doc_no || `ZPV-${advancePaymentId}`)} على مستحقات ${supplier.name}${purchaseId ? ` — فاتورة شراء #${purchaseId}` : ''}`,
        'supplier_payment',
        advancePaymentId,
        auth,
        branchId,
        locationId,
      );
      await this.audit.logWithExecutor(
        trx,
        'تطبيق دفعة مقدمة لمورد',
        `تم تطبيق ${amount} من الدفعة المقدمة ${String(payment.doc_no || `ZPV-${advancePaymentId}`)} على مستحقات ${supplier.name} بواسطة ${auth.username}`,
        auth,
      );
      return {
        appliedAmount: posting.appliedAmount,
        remainingAdvance: posting.remainingAdvance,
        journalEntryId: posting.journalEntryId,
      };
    });
    return { ok: true, ...result };
  }

  private async generateSupplierPaymentDocNo(
    trx: Kysely<Database>,
    paymentId: number,
    tenantId: string,
  ): Promise<string> {
    const settingRow = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'invoiceNumberingScheme')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    let scheme = 'daily';
    if (settingRow?.value) {
      try {
        scheme = JSON.parse(settingRow.value);
      } catch {
        scheme = String(settingRow.value);
      }
    }

    if (scheme === 'sequential') {
      return `ZPV-${paymentId}`;
    }

    // Daily date-based numbering: ZPV-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `ZPV-${datePrefix}-${seq}`;
  }
}
