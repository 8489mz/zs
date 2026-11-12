import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { SalesFinanceService } from './sales-finance.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, toMinorUnits, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { splitInstallmentSchedule } from '../../accounting/engines/installment-interest.engine';
import {
  CreateInstallmentPlanDto,
  PayInstallmentDto,
  ListInstallmentsQueryDto,
} from '../dto/customer-installment.dto';

/*
 * INV-INSTALLMENT-PAYMENT-CHANNEL: the channel a customer_payments
 * row (and its treasury row) carries for an installment payment.
 * The DTO speaks 'bank_transfer'; the CHECK constraint on
 * customer_payments / treasury_transactions (migration 0251) allows
 * only 'cash' | 'bank' | 'card' | 'wallet' | 'instapay', so a bank
 * transfer is stored as 'bank' — writing 'bank_transfer' would
 * violate the constraint. postCustomerPayment debits 1120 for every
 * non-'cash' channel, so this mapping is what moves a bank/card/
 * InstaPay installment off the cash account 1110.
 */
const INSTALLMENT_PAYMENT_CHANNELS: Record<string, 'cash' | 'bank' | 'card' | 'instapay'> = {
  cash: 'cash',
  card: 'card',
  bank_transfer: 'bank',
  instapay: 'instapay',
};

/*
 * INV-REP-NONCASH-EVIDENCE-GATE (PD1), same rule as
 * normalizeTransferReference for general receipts: the reference
 * belongs to the payment only when it actually travels off cash.
 * Cash stores NULL so a stray reference can never be read as
 * evidence for a cash receipt. Blank input is NULL, never an empty
 * string; over-long input is rejected with the named error rather
 * than silently truncated. A free-text note alone is NOT a
 * reference — the gate below reads only this field.
 */
function normalizeInstallmentTransferReference(
  paymentChannel: string,
  rawReference: unknown,
): string | null {
  if (!paymentChannel || paymentChannel === 'cash') return null;
  const reference = String(rawReference || '').trim();
  if (!reference) return null;
  if (reference.length > 100) {
    throw new AppError('Transfer reference must be at most 100 characters', 'INVALID_TRANSFER_REFERENCE', 400);
  }
  return reference;
}

/*
 * INV-REP-NONCASH-EVIDENCE-GATE (PD1), same bar as the van card
 * gate (F2) and the general-receipt gate: a non-cash installment
 * receipt debits bank 1120, so it must carry a real transfer
 * reference of at least 3 characters. Cash is untouched.
 * postCustomerPayment re-checks the stored reference itself, so
 * any future caller reaching the posting without evidence is
 * refused before any Dr 1120 is posted.
 */
function assertInstallmentTransferReference(
  paymentChannel: string,
  reference: unknown,
): void {
  if (!paymentChannel || paymentChannel === 'cash') return;
  const trimmed = String(reference || '').trim();
  if (trimmed.length < 3) {
    throw new AppError(
      `Non-cash installment payment requires a transfer reference of at least 3 characters; a note alone is not evidence (channel: ${paymentChannel})`,
      'NONCASH_RECEIPT_REFERENCE_REQUIRED',
      400,
    );
  }
}

@Injectable()
export class CustomerInstallmentsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly salesFinance: SalesFinanceService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private tenantScope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, tableAlias?: string) {
    const scope = this.tenantScope(auth);
    return tableAlias
      ? sql<boolean>`${sql.ref(`${tableAlias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private async bookDigits(db: Kysely<Database>, auth: AuthContext): Promise<MoneyDigits> {
    const scope = this.tenantScope(auth);
    return currencyMoneyDigits(await tenantBaseCurrency(db, scope.tenantId));
  }

  private roundBook(value: number, digits: MoneyDigits): number {
    return roundMoney(Number(value) || 0, digits);
  }

  async createPlan(dto: CreateInstallmentPlanDto, auth: AuthContext) {
    const scope = this.tenantScope(auth);

    // 1. Verify customer exists
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'phone', 'balance'])
      .where('id', '=', Number(dto.customerId))
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    // INV-INSTALLMENT-FIRST-DUE-DATE: the create form labels this
    // field "first installment due date". The schedule anchor is the
    // entered first due date when the caller supplies firstDueDate;
    // without it the schedule keeps the old shape (first due one
    // month after the plan start).
    const firstDueDate = dto.firstDueDate ? new Date(dto.firstDueDate) : null;
    if (firstDueDate && Number.isNaN(firstDueDate.getTime())) {
      throw new AppError('Invalid first due date', 'INVALID_FIRST_DUE_DATE', 400);
    }

    return await this.tx.runInTransaction(this.db, async (trx: Kysely<Database>) => {
      // INV-CUSTOMER-INSTALLMENTS-MINOR-UNITS: book digits resolve on
      // the caller's own transaction handle, never the pool handle
      // inside an open transaction; plan totals round leniently at
      // book digits and the schedule splits in minor units.
      const bookDigits = await this.bookDigits(trx, auth);
      const totalAmount = this.roundBook(dto.totalAmount, bookDigits);
      if (totalAmount <= 0) {
        throw new AppError('Total amount must be greater than 0', 'INVALID_AMOUNT', 400);
      }

      const downPayment = this.roundBook(dto.downPayment || 0, bookDigits);
      const financedAmount = this.roundBook(totalAmount - downPayment, bookDigits);
      if (financedAmount <= 0) {
        throw new AppError('Financed amount must be greater than 0', 'INVALID_FINANCED_AMOUNT', 400);
      }

      const interestRatePercent = Number(dto.interestRatePercent || 0);
      if (!Number.isFinite(interestRatePercent) || interestRatePercent < 0) throw new AppError('Invalid interest rate', 'INVALID_INTEREST_RATE', 400);
      const interestAmount = this.roundBook((financedAmount * interestRatePercent) / 100, bookDigits);
      const totalWithInterest = this.roundBook(financedAmount + interestAmount, bookDigits);
      const installmentCount = Number(dto.installmentCount);
      const totalMinor = toMinorUnits(totalWithInterest, bookDigits);
      if (!Number.isSafeInteger(installmentCount) || installmentCount < 1 || installmentCount > 600
        || installmentCount > totalMinor) {
        throw new AppError('Installment count must be a positive integer with at least one minor unit per installment', 'INVALID_INSTALLMENT_COUNT', 400);
      }
      const scheduleAmounts = splitInstallmentSchedule(totalWithInterest, installmentCount, bookDigits);
      const monthlyAmount = scheduleAmounts[0];
      // 1. Insert temporary plan to obtain collision-proof identity (Invariant #10 & #13)
      const tempNumber = `INST-TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const inserted = await trx
        .insertInto('customer_installment_plans')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          plan_number: tempNumber,
          sale_id: dto.saleId ? Number(dto.saleId) : null,
          customer_id: Number(dto.customerId),
          total_amount: totalAmount,
          down_payment: downPayment,
          financed_amount: financedAmount,
          interest_rate_percent: interestRatePercent,
          interest_amount: interestAmount,
          total_with_interest: totalWithInterest,
          installment_count: installmentCount,
          monthly_amount: monthlyAmount,
          start_date: startDate,
          status: 'active',
          notes: dto.notes || '',
          branch_id: dto.branchId ? Number(dto.branchId) : null,
          created_by: auth.userId || null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      const planId = Number(inserted.id);
      const planNumber = formatDailyDocumentNumber('INST', planId, startDate);

      // Update plan with authoritative daily document number
      const plan = await trx
        .updateTable('customer_installment_plans')
        .set({ plan_number: planNumber, updated_at: sql`NOW()` })
        .where('id', '=', planId)
        .where(this.tenantPredicate(auth))
        .returningAll()
        .executeTakeFirstOrThrow();

      // Generate installments schedule: the last row absorbs the
      // remainder in minor units, so the schedule sums exactly to
      // the principal plus interest at book digits.
      const installmentsToInsert = [];
      for (let i = 1; i <= installmentCount; i++) {
        const dueDate = new Date(firstDueDate ?? startDate);
        dueDate.setMonth(dueDate.getMonth() + (firstDueDate ? i - 1 : i));

        const currentAmount = scheduleAmounts[i - 1];

        installmentsToInsert.push({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          plan_id: planId,
          sale_id: dto.saleId ? Number(dto.saleId) : null,
          customer_id: Number(dto.customerId),
          installment_number: i,
          due_date: dueDate,
          amount: currentAmount,
          paid_amount: 0,
          status: 'pending',
          payment_method: 'cash',
          notes: '',
        });
      }

      await trx
        .insertInto('customer_installments')
        .values(installmentsToInsert as any)
        .execute();

      // If there is finance interest, debit customer debt and post GL interest income
      if (interestAmount > 0) {
        const fullDesc = `فوائد تمويل خطة تقسيط #${planNumber}`;
        await this.salesFinance.addCustomerPaymentLedgerEntry(
          trx,
          Number(dto.customerId),
          interestAmount,
          fullDesc,
          'customer_installment_plan',
          planId,
          auth,
          dto.branchId ? Number(dto.branchId) : null,
          null,
        );
        await this.accountingPosting.postCustomerInstallmentInterest(trx, planId, auth);
      }

      // If there is a down payment, record in customer payments, subledger, treasury, and accounting
      if (downPayment > 0) {
        const insertedPayment = await trx
          .insertInto('customer_payments')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            customer_id: Number(dto.customerId),
            amount: downPayment,
            note: `دفعة مقدمة لخطة تقسيط #${planNumber}`,
            branch_id: dto.branchId ? Number(dto.branchId) : null,
            created_by: auth.userId || null,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();

        const paymentId = Number(insertedPayment.id);
        const branchId = dto.branchId ? Number(dto.branchId) : null;
        const fullDesc = `دفعة مقدمة لخطة تقسيط #${planNumber}`;

        // 1. Customer Subledger & Balance
        await this.salesFinance.addCustomerPaymentLedgerEntry(
          trx,
          Number(dto.customerId),
          -downPayment,
          fullDesc,
          'customer_payment',
          paymentId,
          auth,
          branchId,
          null,
        );

        // 2. Treasury Transaction
        await this.salesFinance.addTreasuryPaymentTransaction(
          trx,
          'customer_payment',
          downPayment,
          fullDesc,
          'customer_payment',
          paymentId,
          auth,
          branchId,
          null,
        );

        // 3. General Ledger Double-Entry Posting
        const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth);
        if (!posting.journalEntryId) throw new Error(`Customer payment ${paymentId} has no journal entry`);
      }

      // Return plan with generated installments
      const installments = await trx
        .selectFrom('customer_installments')
        .selectAll()
        .where('plan_id', '=', planId)
        .where(this.tenantPredicate(auth))
        .orderBy('installment_number', 'asc')
        .execute();

      return {
        plan,
        installments,
        customer,
      };
    });
  }


  async listPlans(query: { customerId?: number; status?: string; search?: string }, auth: AuthContext) {
    const bookDigits = await this.bookDigits(this.db, auth);
    let q = this.db
      .selectFrom('customer_installment_plans as p')
      .innerJoin('customers as c', 'c.id', 'p.customer_id')
      .leftJoin('sales as s', 's.id', 'p.sale_id')
      .select([
        'p.id',
        'p.plan_number',
        'p.sale_id',
        'p.customer_id',
        'c.name as customer_name',
        'c.phone as customer_phone',
        's.doc_no as sale_doc_no',
        'p.total_amount',
        'p.down_payment',
        'p.financed_amount',
        'p.interest_rate_percent',
        'p.interest_amount',
        'p.total_with_interest',
        'p.installment_count',
        'p.monthly_amount',
        'p.start_date',
        'p.status',
        'p.notes',
        'p.created_at',
      ])
      .where(this.tenantPredicate(auth, 'p'));

    if (query.customerId) {
      q = q.where('p.customer_id', '=', Number(query.customerId));
    }

    if (query.status && query.status !== 'all') {
      q = q.where('p.status', '=', query.status);
    }

    if (query.search) {
      const term = `%${query.search.trim()}%`;
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`p.plan_number ILIKE ${term}`,
          sql<boolean>`c.name ILIKE ${term}`,
          sql<boolean>`c.phone ILIKE ${term}`,
        ]),
      );
    }

    const plans = await q.orderBy('p.id', 'desc').execute();

    // Get aggregated payments per plan
    const planIds = plans.map((p) => Number(p.id));
    let progressMap = new Map<number, { paid_amount: number; paid_count: number }>();

    if (planIds.length > 0) {
      const stats = await this.db
        .selectFrom('customer_installments')
        .select([
          'plan_id',
          sql<number>`COALESCE(SUM(paid_amount), 0)`.as('total_paid'),
          sql<number>`COALESCE(COUNT(CASE WHEN status = 'paid' THEN 1 END), 0)`.as('paid_count'),
        ])
        .where('plan_id', 'in', planIds)
        .where(this.tenantPredicate(auth))
        .groupBy('plan_id')
        .execute();

      stats.forEach((row) => {
        progressMap.set(Number(row.plan_id), {
          paid_amount: Number(row.total_paid || 0),
          paid_count: Number(row.paid_count || 0),
        });
      });
    }

    const formattedPlans = plans.map((p) => {
      const prog = progressMap.get(Number(p.id)) || { paid_amount: 0, paid_count: 0 };
      const totalWithInterest = Number(p.total_with_interest || 0);
      const remainingAmount = Math.max(0, this.roundBook(totalWithInterest - prog.paid_amount, bookDigits));
      const progressPercent = totalWithInterest > 0
        ? Math.min(100, Math.round((prog.paid_amount / totalWithInterest) * 100))
        : 0;

      return {
        ...p,
        paid_amount: prog.paid_amount,
        paid_count: prog.paid_count,
        remaining_amount: remainingAmount,
        progress_percent: progressPercent,
      };
    });

    return { plans: formattedPlans };
  }

  async getPlanDetails(planId: number, auth: AuthContext) {
    const bookDigits = await this.bookDigits(this.db, auth);
    const plan = await this.db
      .selectFrom('customer_installment_plans as p')
      .innerJoin('customers as c', 'c.id', 'p.customer_id')
      .leftJoin('sales as s', 's.id', 'p.sale_id')
      .select([
        'p.id',
        'p.plan_number',
        'p.sale_id',
        'p.customer_id',
        'c.name as customer_name',
        'c.phone as customer_phone',
        'c.balance as customer_balance',
        's.doc_no as sale_doc_no',
        'p.total_amount',
        'p.down_payment',
        'p.financed_amount',
        'p.interest_rate_percent',
        'p.interest_amount',
        'p.total_with_interest',
        'p.installment_count',
        'p.monthly_amount',
        'p.start_date',
        'p.status',
        'p.notes',
        'p.created_at',
      ])
      .where('p.id', '=', Number(planId))
      .where(this.tenantPredicate(auth, 'p'))
      .executeTakeFirst();

    if (!plan) {
      throw new AppError('Installment plan not found', 'PLAN_NOT_FOUND', 404);
    }

    const installments = await this.db
      .selectFrom('customer_installments')
      .selectAll()
      .where('plan_id', '=', Number(planId))
      .where(this.tenantPredicate(auth))
      .orderBy('installment_number', 'asc')
      .execute();

    // Mark virtual overdue
    const todayStr = new Date().toISOString().split('T')[0];
    const installmentsWithStatus = installments.map((inst) => {
      const dueDateStr = new Date(inst.due_date).toISOString().split('T')[0];
      let displayStatus = inst.status;
      if (inst.status === 'pending' && dueDateStr < todayStr) {
        displayStatus = 'overdue';
      }
      return {
        ...inst,
        display_status: displayStatus,
      };
    });

    const totalPaid = installments.reduce((acc, cur) => acc + Number(cur.paid_amount || 0), 0);
    const totalWithInterest = Number(plan.total_with_interest || 0);

    return {
      plan: {
        ...plan,
        paid_amount: this.roundBook(totalPaid, bookDigits),
        remaining_amount: Math.max(0, this.roundBook(totalWithInterest - totalPaid, bookDigits)),
        progress_percent: totalWithInterest > 0
          ? Math.min(100, Math.round((totalPaid / totalWithInterest) * 100))
          : 0,
      },
      installments: installmentsWithStatus,
    };
  }

  async listInstallments(query: ListInstallmentsQueryDto, auth: AuthContext) {
    const bookDigits = await this.bookDigits(this.db, auth);
    let q = this.db
      .selectFrom('customer_installments as i')
      .innerJoin('customer_installment_plans as p', 'p.id', 'i.plan_id')
      .innerJoin('customers as c', 'c.id', 'i.customer_id')
      .select([
        'i.id',
        'i.plan_id',
        'p.plan_number',
        'i.customer_id',
        'c.name as customer_name',
        'c.phone as customer_phone',
        'i.installment_number',
        'p.installment_count',
        'i.due_date',
        'i.amount',
        'i.paid_amount',
        'i.status',
        'i.paid_at',
        'i.payment_method',
        'i.receipt_no',
        'i.notes',
      ])
      .where(this.tenantPredicate(auth, 'i'));

    if (query.planId) {
      q = q.where('i.plan_id', '=', Number(query.planId));
    }

    if (query.customerId) {
      q = q.where('i.customer_id', '=', Number(query.customerId));
    }

    if (query.dueFrom) {
      q = q.where('i.due_date', '>=', new Date(query.dueFrom));
    }

    if (query.dueTo) {
      q = q.where('i.due_date', '<=', new Date(query.dueTo));
    }

    if (query.search) {
      const term = `%${query.search.trim()}%`;
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`p.plan_number ILIKE ${term}`,
          sql<boolean>`c.name ILIKE ${term}`,
          sql<boolean>`c.phone ILIKE ${term}`,
        ]),
      );
    }

    const todayStr = new Date().toISOString().split('T')[0];

    if (query.status === 'overdue') {
      q = q.where('i.status', '=', 'pending').where('i.due_date', '<', new Date(todayStr));
    } else if (query.status === 'due_now') {
      q = q.where('i.status', '=', 'pending').where('i.due_date', '<=', new Date(todayStr));
    } else if (query.status && query.status !== 'all') {
      q = q.where('i.status', '=', query.status);
    }

    const rows = await q.orderBy('i.due_date', 'asc').limit(Number(query.pageSize) || 100).execute();

    const installments = rows.map((r) => {
      const dueDateStr = new Date(r.due_date).toISOString().split('T')[0];
      let displayStatus = r.status;
      if (r.status === 'pending' && dueDateStr < todayStr) {
        displayStatus = 'overdue';
      }
      return {
        ...r,
        display_status: displayStatus,
        remaining_installment: Math.max(0, this.roundBook(Number(r.amount) - Number(r.paid_amount || 0), bookDigits)),
      };
    });

    return { installments };
  }

  async payInstallment(installmentId: number, dto: PayInstallmentDto, auth: AuthContext) {
    const scope = this.tenantScope(auth);

    // INV-INSTALLMENT-PAYMENT-CHANNEL: the installment's payment
    // method is the channel of the money itself — it must reach the
    // customer_payments row and the treasury row, or
    // postCustomerPayment reads 'cash' and debits 1110 for a
    // bank/card/InstaPay receipt (drawer overstated, bank
    // understated, phantom cash at settlement). A missing or unknown
    // method fails closed with a named error instead of silently
    // defaulting to cash — that silent default IS the defect.
    // The only in-repo caller (InstallmentsPage) always sends a
    // method (its state defaults to 'cash'), so a missing method can
    // only come from a direct API caller. Validated before the
    // transaction opens, so a refusal writes nothing.
    const paymentMethod = dto.paymentMethod;
    if (!paymentMethod) {
      throw new AppError(
        'Installment payment requires a payment method (cash, card, bank_transfer or instapay)',
        'INSTALLMENT_PAYMENT_METHOD_REQUIRED',
        400,
      );
    }
    const paymentChannel = INSTALLMENT_PAYMENT_CHANNELS[paymentMethod];
    if (!paymentChannel) {
      throw new AppError(
        `Unknown installment payment method "${String(paymentMethod)}"; expected cash, card, bank_transfer or instapay`,
        'INSTALLMENT_PAYMENT_METHOD_INVALID',
        400,
      );
    }
    const transferReference = normalizeInstallmentTransferReference(paymentChannel, dto.transferReference);
    assertInstallmentTransferReference(paymentChannel, transferReference);

    return await this.tx.runInTransaction(this.db, async (trx: Kysely<Database>) => {
      const bookDigits = await this.bookDigits(trx, auth);
      const payAmount = this.roundBook(dto.amount, bookDigits);
      if (payAmount <= 0) {
        throw new AppError('Payment amount must be greater than 0', 'INVALID_AMOUNT', 400);
      }

      // 1. Pessimistic lock on the installment row (Invariant #13)
      const installment = await trx
        .selectFrom('customer_installments')
        .selectAll()
        .where('id', '=', Number(installmentId))
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();

      if (!installment) {
        throw new AppError('Installment not found', 'INSTALLMENT_NOT_FOUND', 404);
      }

      if (installment.status === 'paid') {
        throw new AppError('Installment is already fully paid', 'ALREADY_PAID', 400);
      }

      // 2. Pessimistic lock on the parent plan
      const plan = await trx
        .selectFrom('customer_installment_plans')
        .selectAll()
        .where('id', '=', Number(installment.plan_id))
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();
      if (!plan || Number(plan.customer_id) !== Number(installment.customer_id)
        || plan.status !== 'active') {
        throw new AppError('Installment plan is not active', 'INSTALLMENT_PLAN_NOT_ACTIVE', 400);
      }

      const currentPaid = Number(installment.paid_amount || 0);
      const totalRequired = Number(installment.amount || 0);
      const remainingOnInstallment = this.roundBook(totalRequired - currentPaid, bookDigits);

      if (payAmount > remainingOnInstallment) {
        throw new AppError(
          `المبلغ المدخل (${payAmount}) يتجاوز المتبقي من هذا القسط (${remainingOnInstallment})`,
          'AMOUNT_EXCEEDS_REMAINING',
          400,
        );
      }

      const newPaidAmount = this.roundBook(currentPaid + payAmount, bookDigits);
      const newStatus = newPaidAmount >= totalRequired ? 'paid' : 'partially_paid';

      // 3. Insert customer payment first to get identity for document numbering (Invariant #10 & #13)
      // INV-INSTALLMENT-PAYMENT-CHANNEL: the payment_channel (and the
      // transfer reference for non-cash) travels on this row, so
      // postCustomerPayment debits the right account below.
      const insertedPayment = await trx
        .insertInto('customer_payments')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          customer_id: Number(installment.customer_id),
          amount: payAmount,
          payment_channel: paymentChannel,
          transfer_reference: transferReference,
          note: `سداد قسط رقم ${installment.installment_number} لخطة ${plan?.plan_number || ''}`,
          branch_id: plan?.branch_id ? Number(plan.branch_id) : null,
          created_by: auth.userId || null,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const paymentId = Number(insertedPayment.id);
      // External references must never replace the unique identity-based system receipt number.
      const receiptNo = formatDailyDocumentNumber('REC', paymentId);
      const branchId = plan?.branch_id ? Number(plan.branch_id) : null;
      const fullDesc = `سداد قسط رقم ${installment.installment_number} (إيصال #${receiptNo})`;

      // 4. Update installment with authoritative receipt number and status
      const updatedInstallment = await trx
        .updateTable('customer_installments')
        .set({
          paid_amount: newPaidAmount,
          status: newStatus,
          paid_at: new Date(),
          payment_method: paymentMethod,
          receipt_no: receiptNo,
          notes: dto.notes || installment.notes,
          updated_at: new Date(),
        } as any)
        .where('id', '=', Number(installmentId))
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // 5. Customer Subledger & Balance update
      await this.salesFinance.addCustomerPaymentLedgerEntry(
        trx,
        Number(installment.customer_id),
        -payAmount,
        fullDesc,
        'customer_payment',
        paymentId,
        auth,
        branchId,
        null,
      );

      // 6. Treasury Transaction
      // INV-INSTALLMENT-PAYMENT-CHANNEL: the treasury row carries
      // the same channel, so the drawer never counts a bank/card/
      // InstaPay receipt as cash.
      await this.salesFinance.addTreasuryPaymentTransaction(
        trx,
        'customer_payment',
        payAmount,
        fullDesc,
        'customer_payment',
        paymentId,
        auth,
        branchId,
        null,
        paymentChannel,
      );

      // 7. General Ledger Double-Entry Posting
      const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth);
      if (!posting.journalEntryId) throw new Error(`Customer payment ${paymentId} has no journal entry`);

      // 8. Check if all installments for this plan are completed
      const remainingUnpaid = await trx
        .selectFrom('customer_installments')
        .select([sql<number>`COALESCE(COUNT(*), 0)`.as('count')])
        .where('plan_id', '=', Number(installment.plan_id))
        .where('status', '!=', 'paid')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (Number(remainingUnpaid?.count || 0) === 0) {
        await trx
          .updateTable('customer_installment_plans')
          .set({ status: 'completed', updated_at: new Date() })
          .where('id', '=', Number(installment.plan_id))
          .where(this.tenantPredicate(auth))
          .execute();
      }

      // Customer info
      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'phone'])
        .where('id', '=', Number(installment.customer_id))
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      return {
        success: true,
        installment: updatedInstallment,
        receipt: {
          receipt_no: receiptNo,
          paid_amount: payAmount,
          installment_number: installment.installment_number,
          paid_at: new Date(),
          payment_method: paymentMethod,
          customer_name: customer?.name || '',
          customer_phone: customer?.phone || '',
        },
      };
    });
  }


  async getSummaryMetrics(auth: AuthContext) {
    const bookDigits = await this.bookDigits(this.db, auth);
    const todayStr = new Date().toISOString().split('T')[0];

    const [plansSummary, installmentsSummary, overdueSummary] = await Promise.all([
      this.db
        .selectFrom('customer_installment_plans')
        .select([
          sql<number>`COALESCE(COUNT(*), 0)`.as('total_plans'),
          sql<number>`COALESCE(COUNT(CASE WHEN status = 'active' THEN 1 END), 0)`.as('active_plans'),
          sql<number>`COALESCE(SUM(CASE WHEN status = 'active' THEN total_with_interest ELSE 0 END), 0)`.as('active_total_amount'),
        ])
        .where(this.tenantPredicate(auth))
        .executeTakeFirst(),

      this.db
        .selectFrom('customer_installments')
        .select([
          sql<number>`COALESCE(SUM(paid_amount), 0)`.as('total_collected'),
          sql<number>`COALESCE(COUNT(CASE WHEN status != 'paid' THEN 1 END), 0)`.as('unpaid_installments_count'),
          sql<number>`COALESCE(SUM(CASE WHEN status != 'paid' THEN (amount - paid_amount) ELSE 0 END), 0)`.as('unpaid_installments_amount'),
        ])
        .where(this.tenantPredicate(auth))
        .executeTakeFirst(),

      this.db
        .selectFrom('customer_installments')
        .select([
          sql<number>`COALESCE(COUNT(*), 0)`.as('overdue_count'),
          sql<number>`COALESCE(SUM(amount - paid_amount), 0)`.as('overdue_amount'),
        ])
        .where(this.tenantPredicate(auth))
        .where('status', '!=', 'paid')
        .where('due_date', '<', new Date(todayStr))
        .executeTakeFirst(),
    ]);

    return {
      active_plans: Number(plansSummary?.active_plans || 0),
      total_plans: Number(plansSummary?.total_plans || 0),
      active_total_amount: this.roundBook(Number(plansSummary?.active_total_amount || 0), bookDigits),
      total_collected: this.roundBook(Number(installmentsSummary?.total_collected || 0), bookDigits),
      unpaid_amount: this.roundBook(Number(installmentsSummary?.unpaid_installments_amount || 0), bookDigits),
      overdue_count: Number(overdueSummary?.overdue_count || 0),
      overdue_amount: this.roundBook(Number(overdueSummary?.overdue_amount || 0), bookDigits),
    };
  }
}
