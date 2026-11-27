import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { boundedPage } from '../../common/utils/bounded-page';

/**
 * MaritimeFreightInvoicingService — slice S14 of the maritime-freight split.
 * Pure move of 6 methods from MaritimeFreightService (job invoicing:
 * the customer ledger helper, the sales invoice + expense voucher
 * postings, the job financial ledger, the customer-balance settlement,
 * and the customer active-jobs read). No behavior change: the bodies
 * are byte-identical; the facade keeps thin delegates with the same
 * names and signatures for the 5 public methods.
 * Deps are db + the REQUIRED accountingPosting + the BOUND getJobById
 * (S12 — the jobs-core slice owns it; the facade binds its own method
 * on the generation tree, S10 form, and the merge repoints it to the
 * S12 slice instance when S12 lands) + the 3 BOUND kernel methods
 * (resolveFreightExchangeRate, resolveAccountId,
 * assertMaritimeJournalPeriodOpen — they stay in the facade forever,
 * so the facade binds its own methods; no merge repoint for kernel
 * deps). No mail/WhatsApp, no Logger (S14 is not one of the 6 logger
 * slices). maintainCustomerLedgerForInvoice is PRIVATE with exactly
 * one in-slice caller (issueJobSalesInvoice) — it stays private in the
 * slice and gets NO facade delegate (S6/S9 precedent). The section
 * banner opens the slice body before maintainCustomerLedgerForInvoice's
 * JSDoc (prep §2 assigns it to S14; S9's report: "S14 takes it, before
 * the kernel resolveAccountId"). Date handling travels verbatim:
 * new Date() x4 (issue 1 + record 1 + settle 2), tenant base currency
 * x3, one period-lock call (settle) — pure moves, no UTC-slice
 * normalizer, no instant comparison. Guard: no toFixed/inlineRound;
 * roundMoney x3, currencyMoneyDigits x3, two domain-journal postings
 * (issue + record), three transactions — all PGlite-safe: every
 * database-reading callee runs BEFORE its transaction opens, and each
 * transaction body holds only transaction-threaded callees. The three
 * pinned invoicing methods are the merge RED anchors (PGlite-safe
 * pinned set). The customer-ledger, settle-digits and tenant-join
 * pins live entirely in this slice's range (merge-owned repoints).
 */

export interface MaritimeFreightInvoicingDeps {
  db: Kysely<Database>;
  // REQUIRED (prep §1: accountingPosting is NOT @Optional in this file).
  accountingPosting: AccountingPostingService;
  // Bound S12 method (same name as the facade member, so the moved body
  // is byte-identical). getJobById has NO explicit return type in the
  // pristine file, so the bound type uses Promise<any>. The S12 slice
  // owns it forever; the facade binds its own method on the generation
  // tree (S10 form) and the merge repoints it to the S12 slice instance.
  getJobById: (auth: AuthContext, id: string) => Promise<any>;
  // Bound kernel methods (same names as the facade members, so the moved
  // bodies are byte-identical). They stay in the facade forever.
  resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
    asOf?: Date | string,
  ) => Promise<number>;
  resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;
}

@Injectable()
export class MaritimeFreightInvoicingService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly getJobById: (auth: AuthContext, id: string) => Promise<any>;
  private readonly resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
    asOf?: Date | string,
  ) => Promise<number>;
  private readonly resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  private readonly assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;

  constructor(deps: MaritimeFreightInvoicingDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.getJobById = deps.getJobById;
    this.resolveFreightExchangeRate = deps.resolveFreightExchangeRate;
    this.resolveAccountId = deps.resolveAccountId;
    this.assertMaritimeJournalPeriodOpen = deps.assertMaritimeJournalPeriodOpen;
  }

  // --------------------------------------------------------------------------
  // 10. Financial Accounting & Cost Center Posting
  // --------------------------------------------------------------------------
  /**
   * INV-MARITIME-CUSTOMER-LEDGER-ON-INVOICE: a job sales invoice
   * maintains the customer subledger in the same transaction as its
   * journal, on the sales pattern (customers.balance plus one
   * customer_ledger row, entry_type 'sale_credit', the posted
   * base-currency amount at book digits). Without this the settle
   * guard's GL-vs-balance equality could never hold after a
   * maritime invoice, so settle-from-balance could never succeed.
   * Deliberately no credit-limit/block gating: the sales helper's
   * gating is a further behavioural choice that was not decided
   * here, so issuing an invoice never newly blocks on it. A job
   * with no linked customer writes nothing (settle requires a
   * customer anyway); a linked customer that does not exist fails
   * closed and rolls the journal back with it. Supplier-ledger
   * writes are NOT added here: they were not decided.
   */
  private async maintainCustomerLedgerForInvoice(
    trx: any,
    tenantId: string,
    accountId: string,
    job: { id: number | string; customer_id?: number | string | null; job_number?: string | null },
    baseInvoiceAmount: number,
    digits: MoneyDigits,
    auth: AuthContext,
  ): Promise<void> {
    if (!job.customer_id) return;
    const customerId = Number(job.customer_id);
    const [updated] = await trx
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${baseInvoiceAmount}`, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', customerId)
      .returning(['balance'])
      .execute();
    if (!updated) {
      throw new BadRequestException('تعذر إصدار فاتورة المبيعات: العميل المرتبط بالشحنة غير موجود.');
    }
    const balanceAfter = roundMoney(Number(updated.balance), digits);
    await trx
      .insertInto('customer_ledger')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        customer_id: customerId,
        entry_type: 'sale_credit',
        amount: baseInvoiceAmount,
        balance_after: balanceAfter,
        note: `فاتورة مبيعات ملاحية - العملية #${job.job_number || job.id}`,
        reference_type: 'maritime_job',
        reference_id: Number(job.id),
        created_by: auth.userId ? Number(auth.userId) : null,
      })
      .execute();
  }

  async issueJobSalesInvoice(
    auth: AuthContext,
    jobId: string,
    dto?: { amount?: number; notes?: string; exchangeRate?: number; currency?: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(auth);
    let job = await this.getJobById(auth, jobId);

    // 1. Ensure cost center exists
    let costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    if (!costCenterId) {
      try {
        const [newCc] = await this.db
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: job.job_number,
            name: `شحنة بحرية: ${job.job_number} - ${job.customer_name}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية الملاحية ${job.job_number}`,
          })
          .returning('id')
          .execute();
        if (newCc) {
          costCenterId = Number(newCc.id);
          await this.db
            .updateTable('maritime_jobs')
            .set({ cost_center_id: String(costCenterId) })
            .where('id', '=', job.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      } catch {
        // ignore
      }
    }

    const invoiceAmount = Number(dto?.amount ?? (Number(job.client_invoiced_total) || 0));
    if (invoiceAmount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ صالح للفاتورة أكبر من صفر');
    }

    const entryDate = new Date();
    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, dto?.currency, dto?.exchangeRate, entryDate);
    // INV-MARITIME-JOB-JOURNAL-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const baseInvoiceAmount = convertFxAmount(invoiceAmount, exchangeRate, digits);

    // Resolve accounts: Customer Receivable (1130), Service Revenue (4200 or 4100).
    // Previously "if (customerAccId && revenueAccId)" silently skipped the journal when either
    // account was missing, while client_invoiced_total was still updated unconditionally below --
    // recognising revenue on the job record with nothing behind it in the general ledger, and the
    // return message still claimed the invoice was issued AND posted. Now this throws, and the
    // whole operation is one transaction so a failure here touches nothing.
    const customerAccId = await this.resolveAccountId(tenantId, '1130');
    const revenueAccId = await this.resolveAccountId(tenantId, '4200', '4100');
    if (!customerAccId || !revenueAccId) {
      throw new BadRequestException(
        'تعذر إصدار فاتورة المبيعات: حساب ذمم العملاء (1130) أو حساب إيراد الخدمات (4200/4100) غير متاح في شجرة الحسابات.',
      );
    }

    const fxSuffix = exchangeRate !== 1 ? ` (${invoiceAmount} ${dto?.currency || 'USD'} @ ${exchangeRate})` : '';
    const desc =
      (dto?.notes || `فاتورة مبيعات خدمات ملاحية - العملية #${job.job_number} (${job.customer_name})`) + fxSuffix;

    const { updatedJob, entryId, entryNo } = await this.db.transaction().execute(async (trx: any) => {
      await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
      job = {
        ...job,
        ...(await trx
          .selectFrom('maritime_jobs')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', job.id)
          .forUpdate()
          .executeTakeFirstOrThrow()),
      };

      const newEntryId = await this.accountingPosting.postDomainJournal(trx, {
        tenantId,
        accountId: tenantId,
        entryDate,
        description: desc,
        sourceType: 'maritime_job',
        sourceId: Number(job.id),
        createdBy: auth.userId || null,
        lines: [
          {
            accountId: customerAccId,
            costCenterId,
            description: desc,
            debit: baseInvoiceAmount,
            credit: 0,
            partnerType: 'customer',
            partnerId: job.customer_id ? Number(job.customer_id) : null,
          },
          {
            accountId: revenueAccId,
            costCenterId,
            description: desc,
            debit: 0,
            credit: baseInvoiceAmount,
            partnerType: 'none',
            partnerId: null,
          },
        ],
      });
      const posted = await trx
        .selectFrom('journal_entries')
        .select('entry_no')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', newEntryId)
        .executeTakeFirstOrThrow();
      const newEntryNo = posted.entry_no;

      const postedRevenue = await trx
        .selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) =>
          join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'),
        )
        .select(sql<number>`COALESCE(SUM(jl.credit), 0)`.as('amount'))
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'maritime_job')
        .where('je.source_id', '=', Number(job.id))
        .where('je.status', '=', 'posted')
        .executeTakeFirst();
      const billedTotal = Number(postedRevenue?.amount || 0);
      const carrierCost = Number(job.carrier_cost_total || 0);
      const otherCosts = Number(job.other_costs_total || 0);
      const netProfit = billedTotal - (carrierCost + otherCosts);

      const [updated] = await trx
        .updateTable('maritime_jobs')
        .set({
          client_invoiced_total: billedTotal,
          net_profit: netProfit,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.id)
        .returningAll()
        .execute();

      // INV-MARITIME-CUSTOMER-LEDGER-ON-INVOICE: the same
      // transaction maintains the customer subledger, so the
      // posted GL partner sum and customers.balance can never
      // diverge on an issued invoice.
      await this.maintainCustomerLedgerForInvoice(trx, tenantId, accountId, job, baseInvoiceAmount, digits, auth);

      return { updatedJob: updated, entryId: newEntryId, entryNo: newEntryNo };
    });

    return {
      success: true,
      job: updatedJob,
      journalEntryId: entryId,
      entryNo,
      amount: invoiceAmount,
      message: `تم إصدار وترحيل فاتورة المبيعات للعملية #${job.job_number} بقيمة ${invoiceAmount} بنجاح`,
    };
  }

  async recordJobExpenseVoucher(
    auth: AuthContext,
    jobId: string,
    dto: {
      amount: number;
      expenseType?: 'carrier' | 'port' | 'other';
      paymentMethod?: 'payable' | 'cash' | 'bank';
      supplierId?: number;
      supplierName?: string;
      description?: string;
      currency?: string;
      exchangeRate?: number;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    let job = await this.getJobById(auth, jobId);

    const amount = Number(dto.amount || 0);
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل إضافة مصروفات جديدة حتى لا تتسرب من الفوترة');
    }
    if (amount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ صالح للمصروف أكبر من صفر');
    }

    const entryDate = new Date();
    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, dto.currency, dto.exchangeRate, entryDate);
    // INV-MARITIME-JOB-JOURNAL-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const baseExpenseAmount = convertFxAmount(amount, exchangeRate, digits);

    // 1. Ensure cost center exists
    let costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    if (!costCenterId) {
      try {
        const [newCc] = await this.db
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: job.job_number,
            name: `شحنة بحرية: ${job.job_number} - ${job.customer_name}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية الملاحية ${job.job_number}`,
          })
          .returning('id')
          .execute();
        if (newCc) {
          costCenterId = Number(newCc.id);
          await this.db
            .updateTable('maritime_jobs')
            .set({ cost_center_id: String(costCenterId) })
            .where('id', '=', job.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      } catch {
        // ignore
      }
    }

    // 2. Resolve accounts.
    // Same fix as issueJobSalesInvoice: previously "if (expenseAccId && creditAccId)" silently
    // skipped the journal while carrier_cost_total / other_costs_total were still bumped
    // unconditionally below -- a cost recognised on the job with no journal entry behind it.
    const expenseAccId = await this.resolveAccountId(tenantId, '6400', '5100');

    let creditAccCode = '2110';
    let partnerType: 'supplier' | 'none' = 'supplier';
    if (dto.paymentMethod === 'cash') {
      creditAccCode = '1110';
      partnerType = 'none';
    } else if (dto.paymentMethod === 'bank') {
      creditAccCode = '1120';
      partnerType = 'none';
    }
    const creditAccId = await this.resolveAccountId(tenantId, creditAccCode);

    if (!expenseAccId || !creditAccId) {
      throw new BadRequestException(
        `تعذر تسجيل سند المصروفات: حساب المصروف (6400/5100) أو حساب السداد (${creditAccCode}) غير متاح في شجرة الحسابات.`,
      );
    }

    const fxSuffix = exchangeRate !== 1 ? ` (${amount} ${dto?.currency || 'USD'} @ ${exchangeRate})` : '';
    const desc =
      (dto.description ||
        `سند مصروفات ملاحية (${dto.expenseType === 'carrier' ? 'نولون الخط الملاحي' : 'مصروفات موانئ وتخليص'}) - العملية #${job.job_number}`) +
      fxSuffix;

    const { updatedJob, entryId, entryNo } = await this.db.transaction().execute(async (trx: any) => {
      await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
      job = {
        ...job,
        ...(await trx
          .selectFrom('maritime_jobs')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', job.id)
          .forUpdate()
          .executeTakeFirstOrThrow()),
      };

      const newEntryId = await this.accountingPosting.postDomainJournal(trx, {
        tenantId,
        accountId: tenantId,
        entryDate,
        description: desc,
        sourceType: 'maritime_job_expense',
        sourceId: Number(job.id),
        createdBy: auth.userId || null,
        lines: [
          {
            accountId: expenseAccId,
            costCenterId,
            description: desc,
            debit: baseExpenseAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
          },
          {
            accountId: creditAccId,
            costCenterId,
            description: desc,
            debit: 0,
            credit: baseExpenseAmount,
            partnerType,
            partnerId: dto.supplierId ? Number(dto.supplierId) : null,
          },
        ],
      });
      const posted = await trx
        .selectFrom('journal_entries')
        .select('entry_no')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', newEntryId)
        .executeTakeFirstOrThrow();
      const newEntryNo = posted.entry_no;

      let carrierCost = Number(job.carrier_cost_total || 0);
      let otherCosts = Number(job.other_costs_total || 0);

      if (dto.expenseType === 'carrier') {
        carrierCost += baseExpenseAmount;
      } else {
        otherCosts += baseExpenseAmount;
      }

      const revenue = Number(job.client_invoiced_total || 0);
      const netProfit = revenue - (carrierCost + otherCosts);

      const [updated] = await trx
        .updateTable('maritime_jobs')
        .set({
          carrier_cost_total: carrierCost,
          other_costs_total: otherCosts,
          net_profit: netProfit,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.id)
        .returningAll()
        .execute();

      return { updatedJob: updated, entryId: newEntryId, entryNo: newEntryNo };
    });

    return {
      success: true,
      job: updatedJob,
      journalEntryId: entryId,
      entryNo,
      amount,
      message: `تم تسجيل سند المصروفات الملاحية للعملية #${job.job_number} بقيمة ${amount} بنجاح`,
    };
  }

  async getJobFinancialLedger(auth: AuthContext, jobId: string, pagination?: { page?: number; pageSize?: number }) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);

    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;

    let query = this.db
      .selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as jel', (join) =>
        join.onRef('jel.journal_entry_id', '=', 'je.id').onRef('jel.tenant_id', '=', 'je.tenant_id'),
      )
      .innerJoin('accounting_accounts as acc', (join) =>
        join.onRef('acc.id', '=', 'jel.account_id').onRef('acc.tenant_id', '=', 'je.tenant_id'),
      )
      .select([
        'je.id as entry_id',
        'je.entry_no',
        'je.entry_date',
        'je.description as entry_description',
        'je.source_type',
        'jel.id as line_id',
        'jel.description as line_description',
        'jel.debit',
        'jel.credit',
        'jel.partner_type',
        'jel.cost_center_id',
        'acc.code as account_code',
        'acc.name_ar as account_name',
      ])
      .where('je.tenant_id', '=', tenantId);

    if (costCenterId) {
      query = query.where((eb) =>
        eb.or([
          eb('jel.cost_center_id', '=', costCenterId),
          eb.and([
            eb('je.source_type', 'in', ['maritime_job', 'maritime_job_expense']),
            eb('je.source_id', '=', Number(jobId)),
          ]),
        ]),
      );
    } else {
      query = query
        .where('je.source_type', 'in', ['maritime_job', 'maritime_job_expense'])
        .where('je.source_id', '=', Number(jobId));
    }

    const { page, pageSize, offset } = boundedPage(pagination?.page, pagination?.pageSize);
    const pageRows = await query
      .orderBy('je.id', 'desc')
      .orderBy('jel.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      costCenterId: job.cost_center_id,
      entries: pageRows.slice(0, pageSize),
      pagination: { page, pageSize, hasMore: pageRows.length > pageSize },
    };
  }

  async settleJobFromCustomerBalance(
    auth: AuthContext,
    jobId: string,
    dto?: { amount?: number; exchangeRate?: number },
  ) {
    const { tenantId } = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const job = await trx
        .selectFrom('maritime_jobs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', jobId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!job.customer_id || Number(job.client_invoiced_total || 0) <= 0)
        throw new BadRequestException('يجب ربط العميل وإصدار فاتورة الشحنة أولاً.');
      if (dto?.exchangeRate != null && Number(dto.exchangeRate) !== 1)
        throw new BadRequestException('أرصدة الشحنة والعميل مثبتة بعملة الأساس؛ لا يعاد تحويلها عند المطابقة.');
      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'balance'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.customer_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const ledger = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as j', (join) =>
          join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'),
        )
        .innerJoin('accounting_accounts as a', (join) =>
          join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'),
        )
        .select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('balance'))
        .where('l.tenant_id', '=', tenantId)
        .where('l.partner_type', '=', 'customer')
        .where('l.partner_id', '=', customer.id)
        .where('j.status', '=', 'posted')
        .where((eb) => eb.or([eb('a.is_receivable', '=', true), eb('a.code', '=', '1130')]))
        .executeTakeFirstOrThrow();
      if (Math.abs(Number(ledger.balance) - Number(customer.balance)) > 0.01)
        throw new BadRequestException(
          'الأستاذ العام ودفتر العميل غير متطابقين؛ يلزم تصحيح البيانات التاريخية قبل تسوية الشحنة.',
        );
      if (Number(customer.balance) > 0.01)
        throw new BadRequestException(
          'الرصيد الإجمالي للعميل مدين؛ يلزم تحصيل أو تخصيص سند سداد قبل المطابقة من الرصيد.',
        );
      const invoiced = Number(job.client_invoiced_total);
      const paid = Number(job.client_paid_total || 0);
      // Settle math at the tenant's book digits, resolved on the
      // transaction handle with the pattern this file already uses: the
      // invoiced total is book-precision, so a hardcoded 2dp settle
      // stored 100.01 against an invoiced 100.005.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const remaining = roundMoney(Math.max(0, invoiced - paid), digits);
      const amount = dto?.amount == null ? remaining : Number(dto.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > remaining + 0.001)
        throw new BadRequestException('مبلغ المطابقة يتجاوز المتبقي على الشحنة.');
      const newPaid = roundMoney(paid + amount, digits);
      const full = newPaid >= invoiced - 0.01;
      const updated = await trx
        .updateTable('maritime_jobs')
        .set({
          client_paid_total: newPaid,
          payment_status: full ? 'paid' : 'partially_paid',
          paid_at: full ? new Date() : job.paid_at,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (amount > 0)
        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: tenantId,
            job_id: String(job.id),
            milestone_key: 'PAYMENT',
            milestone_title: 'مطابقة الفاتورة مع رصيد العميل المغطى',
            location: 'الحسابات',
            notes: `مطابقة ${amount} بعملة الأساس؛ لا توجد حركة نقدية جديدة`,
            recorded_by: auth.userId || null,
          })
          .execute();
      // Invoice and receipt already changed AR and the shared ledger. Applying their
      // offset a second time here would consume the customer's credit twice.
      return {
        success: true,
        job: updated,
        settledAmount: amount,
        remainingUnpaid: Math.max(0, invoiced - newPaid),
        customerBalanceAfter: Number(customer.balance),
        customerAvailableCreditAfter: Math.max(0, -Number(customer.balance)),
        message: 'تمت مطابقة سداد الشحنة دون تكرار حركة رصيد العميل.',
      };
    });
  }

  async getCustomerActiveJobs(auth: AuthContext, customerId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    const jobs = await this.db
      .selectFrom('maritime_jobs')
      .select([
        'id',
        'job_number',
        'pol_name',
        'pod_name',
        'vessel_name',
        'milestone_status',
        'client_invoiced_total',
        'client_paid_total',
        'payment_status',
        'status',
        'created_at',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', Number(customerId))
      .where('status', '=', 'active')
      .orderBy('id', 'desc')
      .execute();

    return jobs.map((j) => {
      const invoiced = Number(j.client_invoiced_total || 0);
      const paid = Number(j.client_paid_total || 0);
      const unpaid = Math.max(0, invoiced - paid);
      return {
        ...j,
        invoiced,
        paid,
        unpaid,
      };
    });
  }
}
