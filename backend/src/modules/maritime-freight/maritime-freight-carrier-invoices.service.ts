import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { ensureDomainSupplier } from '../accounting/partner-subledger';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { NotFoundException, BadRequestException, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { calculateFreightAudit, validateMakerCheckerOverride } from './engines/freight-audit.engine';
import { isSoloAdminOverride } from '../../common/utils/manager-approval';

/**
 * MaritimeFreightCarrierInvoicesService — slice S19 of the
 * maritime-freight split. Pure move of 4 methods from
 * MaritimeFreightService (Carrier Invoices: the journal poster, the
 * audit preview, invoice creation and the maker-checker override).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for the 3 public
 * methods. Deps are db + the REQUIRED accountingPosting + the 3 BOUND
 * kernel methods (resolveFreightExchangeRate, resolveAccountId,
 * assertMaritimeJournalPeriodOpen — they stay in the facade forever)
 * + the 2 BOUND CROSS-SLICE deps (S12 getJobById, S4 mapRateCardRow)
 * + NO Logger (S19 is not one of the 6 logger slices); no mail,
 * no WhatsApp. On the generation tree the facade binds its OWN
 * methods (this.getJobById.bind(this) etc.) — the S12/S4 slice
 * instances do not exist yet; MERGE-OWNED REPOINTS: when S12/S4 land
 * (they merge before S19), repoint the binds to
 * this.jobsCoreService.getJobById.bind(this.jobsCoreService) and to
 * this.rateCardsService.mapRateCardRow.bind(this.rateCardsService).
 * Functionally identical either way (the facade methods become thin
 * delegates after S12/S4 merge). postCarrierInvoiceJournal is PRIVATE
 * with exactly two in-slice callers (createCarrierInvoice +
 * overrideCarrierInvoice) — it stays private in the slice and gets NO
 * facade delegate (S6/S9/S14 precedent). Its 16-line JSDoc travels
 * with the method. No banner travels into this slice (the Freight
 * Audit banner stays in the facade — S5 takes it at merge). The two
 * pinned methods are postCarrierInvoiceJournal (driven via a cast
 * receiver in its spec) and createCarrierInvoice (driven via the
 * service receiver in its spec); previewCarrierInvoiceAudit +
 * overrideCarrierInvoice are unpinned — pure moves, not blockers.
 * Clock travels verbatim: 4 bare date constructions + 2 with-args +
 * 1 now-call + 2 tenant-timezone date-key calls, all pure moves, no
 * UTC-slice normalizer, no instant comparison. Guard: no toFixed /
 * inlineRound / roundMoney; currencyMoneyDigits x2, convertFxAmount
 * x1, one domain-journal posting via the REQUIRED accountingPosting.
 * PGlite hang shape IS in this slice (recorded, NOT fixed): the
 * override tx body holds a direct pool read plus the transitive
 * poster, and the create tx body holds the poster transitively —
 * the trx-threading fix is a separate package, not part of the split.
 */

export interface MaritimeFreightCarrierInvoicesDeps {
  db: Kysely<Database>;
  // REQUIRED (prep §1: accountingPosting is NOT @Optional in this file).
  accountingPosting: AccountingPostingService;
  // Bound S12 method (same name as the facade member, so the moved body
  // is byte-identical). getJobById has NO explicit return type in the
  // pristine file, so the bound type uses Promise<any> (S14 precedent).
  // The S12 slice owns it forever; the facade binds its own method on
  // the generation tree (S10 form) and the merge repoints it to the S12
  // slice instance.
  getJobById: (auth: AuthContext, id: string) => Promise<any>;
  // Bound S4 method (SYNC — mapRateCardRow(r: any) has no return type in
  // the pristine file, so the bound type is (r: any) => any). The S4 slice
  // owns it forever; the facade binds its own method on the generation
  // tree (S10 form) and the merge repoints it to the S4 slice instance.
  mapRateCardRow: (r: any) => any;
  // Bound kernel methods (same names as the facade members, so the moved
  // bodies are byte-identical). They stay in the facade forever; the
  // facade binds its own methods, so there is no merge repoint for them
  // (S14 precedent).
  resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
  ) => Promise<number>;
  resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;
}

@Injectable()
export class MaritimeFreightCarrierInvoicesService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly getJobById: (auth: AuthContext, id: string) => Promise<any>;
  private readonly mapRateCardRow: (r: any) => any;
  private readonly resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
  ) => Promise<number>;
  private readonly resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  private readonly assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;

  constructor(deps: MaritimeFreightCarrierInvoicesDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.getJobById = deps.getJobById;
    this.mapRateCardRow = deps.mapRateCardRow;
    this.resolveFreightExchangeRate = deps.resolveFreightExchangeRate;
    this.resolveAccountId = deps.resolveAccountId;
    this.assertMaritimeJournalPeriodOpen = deps.assertMaritimeJournalPeriodOpen;
  }

  /**
   * Posts the carrier-invoice journal entry and updates the job's carrier cost roll-up.
   *
   * Extracted into one place because createCarrierInvoice and overrideCarrierInvoice previously
   * duplicated this ~50-line block, which had drifted into a genuine defect:
   *  - Missing 6400/5100/2110 accounts caused a SILENT skip (`if (expenseAccId && creditAccId)`)
   *    with no error, yet the caller still reported success and (in the override path) claimed
   *    the journal was posted even though it never was. Forbidden pattern F7
   *    (see ARCHITECTURE_INVARIANTS.md §2.2) — a missing account must fail loudly.
   *  - No fiscal period lock check, unlike every posting routed through insertPostedJournal.
   *  - No transaction: the journal header, journal lines, job cost update and invoice
   *    insert/update were independent statements. A failure partway left an orphaned journal
   *    entry or a job cost bump with no invoice record behind it.
   * All three are fixed here: this method MUST be called with a transaction handle, throws
   * instead of skipping, and enforces the period lock the same way insertPostedJournal does.
   */
  private async postCarrierInvoiceJournal(
    trx: any,
    tenantId: string,
    params: {
      job: {
        id: number | string;
        cost_center_id?: number | string | null;
        job_number?: string;
        shipping_line_name?: string | null;
        carrier_cost_total?: number | string | null;
        client_invoiced_total?: number | string | null;
        other_costs_total?: number | string | null;
      };
      invoiceNumber: string;
      carrierName?: string | null;
      shippingLineId?: string | number | null;
      totalAmount: number;
      currency?: string;
      exchangeRate?: number;
      entryDate: Date;
      descriptionSuffix?: string;
      userId?: number | string | null;
    },
  ): Promise<number> {
    const { totalAmount } = params;
    let job = params.job;

    await this.assertMaritimeJournalPeriodOpen(trx, tenantId, params.entryDate);
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

    const expenseAccId = await this.resolveAccountId(tenantId, '6400', '5100');
    const creditAccId = await this.resolveAccountId(tenantId, '2110');
    if (!expenseAccId || !creditAccId) {
      throw new BadRequestException(
        'تعذر ترحيل فاتورة الناقل: حساب مصروف الشحن (6400/5100) أو حساب الذمم الدائنة (2110) غير متاح في شجرة الحسابات. يرجى تهيئتهما أولاً.',
      );
    }

    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, params.currency, params.exchangeRate);
    // INV-MARITIME-CARRIER-INVOICE-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const baseTotalAmount = convertFxAmount(totalAmount, exchangeRate, digits);
    const fxSuffix = exchangeRate !== 1 ? ` (${totalAmount} ${params.currency || 'USD'} @ ${exchangeRate})` : '';

    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    const desc = `فاتورة الخط الملاحي #${params.invoiceNumber} (${params.carrierName || job.shipping_line_name || 'Carrier'})${params.descriptionSuffix ? ' ' + params.descriptionSuffix : ''}${fxSuffix} - الشحنة #${job.job_number}`;
    const tempNo = `JRN-TMP-CARRIER-${job.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    if (!params.shippingLineId) throw new BadRequestException('يجب ربط فاتورة الناقل بخط ملاحي محدد.');
    const supplierId = await ensureDomainSupplier(
      trx,
      tenantId,
      'shipping_line',
      params.shippingLineId,
      params.carrierName || job.shipping_line_name || 'خط ملاحي',
    );
    const entryId = await this.accountingPosting.postDomainJournal(trx, {
      tenantId,
      accountId: tenantId,
      entryDate: params.entryDate,
      description: desc,
      sourceType: 'maritime_carrier_invoice',
      sourceId: Number(job.id),
      createdBy: Number(params.userId) || null,
      lines: [
        {
          accountId: expenseAccId,
          costCenterId,
          description: desc,
          debit: baseTotalAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
        },
        {
          accountId: creditAccId,
          costCenterId,
          description: desc,
          debit: 0,
          credit: baseTotalAmount,
          partnerType: 'supplier',
          partnerId: supplierId,
        },
      ],
    });

    const newCarrierCost = Number(job.carrier_cost_total || 0) + baseTotalAmount;
    const revenue = Number(job.client_invoiced_total || 0);
    const otherCosts = Number(job.other_costs_total || 0);
    const newNetProfit = revenue - (newCarrierCost + otherCosts);

    await trx
      .updateTable('maritime_jobs')
      .set({
        carrier_cost_total: newCarrierCost,
        net_profit: newNetProfit,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', job.id)
      .execute();

    return entryId;
  }

  async previewCarrierInvoiceAudit(
    auth: AuthContext,
    jobId: string,
    dto: {
      // Widened in D4 (INV-DTO-MARITIME-FREIGHT-28): the body defaults
      // a missing total with Number(dto.invoicedTotal || 0), and the
      // shipping line falls back to the job's line — both were
      // declared narrower than the body tolerates.
      invoicedTotal?: number;
      oceanFreight?: number;
      thcCharges?: number;
      bafCharges?: number;
      otherCharges?: number;
      shippingLineId?: string | number | null;
      containerType?: string;
      currency?: string;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);

    // 1. Find matching active rate card
    const shippingLineId = dto.shippingLineId || job.shipping_line_id;
    const polCode = (job.pol_code || '').toUpperCase();
    const podCode = (job.pod_code || '').toUpperCase();
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());

    let query = this.db
      .selectFrom('maritime_rate_cards')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('pol_code', '=', polCode)
      .where('pod_code', '=', podCode)
      .where('status', '=', 'active')
      .where('currency', '=', (dto.currency || 'USD').trim().toUpperCase())
      .where('valid_from', '<=', today)
      .where('valid_until', '>=', today);

    if (shippingLineId) {
      query = query.where('shipping_line_id', '=', String(shippingLineId) as any);
    }

    const containerType = dto.containerType || job.containers?.[0]?.container_type || '40HC';
    if (containerType) {
      query = query.where('container_type', '=', containerType);
    }

    const matchedCard = await query.orderBy('total_freight_cost', 'asc').executeTakeFirst();
    const containerCount = job.containers?.length || 1;

    const auditResult = calculateFreightAudit({
      invoicedTotal: Number(dto.invoicedTotal || 0),
      oceanFreight: Number(dto.oceanFreight || 0),
      thcCharges: Number(dto.thcCharges || 0),
      bafCharges: Number(dto.bafCharges || 0),
      otherCharges: Number(dto.otherCharges || 0),
      rateCard: matchedCard ? this.mapRateCardRow(matchedCard) : null,
      containerCount,
      // INV-FX-CONVERSION-SINGLE-ENGINE: the audit converts at the
      // tenant's book digits. The rate itself is not passed here:
      // the rate-card query above already filters to the invoice
      // currency, so the audit never converts across currencies.
      moneyDigits: currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)),
    });

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      shippingLineName: job.shipping_line_name,
      polCode: job.pol_code,
      podCode: job.pod_code,
      containerCount,
      containerType,
      rateCard: matchedCard ? this.mapRateCardRow(matchedCard) : null,
      audit: auditResult,
    };
  }

  async createCarrierInvoice(
    auth: AuthContext,
    jobId: string,
    dto: {
      invoiceNumber: string;
      invoiceDate?: string;
      totalInvoicedAmount: number;
      currency?: string;
      exchangeRate?: number;
      oceanFreight?: number;
      thcCharges?: number;
      bafCharges?: number;
      detentionDemurrage?: number;
      otherCharges?: number;
      // Widened in D4 (INV-DTO-MARITIME-FREIGHT-28): the caller sends
      // job.shipping_line_id, which is null when the job has no line;
      // the body falls back to the job's line or null.
      shippingLineId?: string | number | null;
      carrierName?: string;
      notes?: string;
      allowOverride?: boolean;
      overrideReason?: string;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل إضافة فاتورة ناقل جديدة');
    }

    const totalAmount = Number(dto.totalInvoicedAmount || 0);
    if (totalAmount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ إجمالي للفاتورة أكبر من صفر');
    }
    if (!dto.invoiceNumber?.trim()) {
      throw new BadRequestException('يجب إدخال رقم فاتورة الخط الملاحي');
    }
    const currency = (dto.currency || 'USD').trim().toUpperCase();
    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate);

    // 1. Audit against rate card
    const auditPreview = await this.previewCarrierInvoiceAudit(auth, jobId, {
      invoicedTotal: totalAmount,
      oceanFreight: dto.oceanFreight,
      thcCharges: dto.thcCharges,
      bafCharges: dto.bafCharges,
      otherCharges: dto.otherCharges,
      shippingLineId: dto.shippingLineId,
      currency,
    });

    const audit = auditPreview.audit;
    // Invariant L14 & Rule #14: Strict Maker-Checker Separation.
    // A user creating an invoice CANNOT self-approve financial variances at creation time.
    // An 'overcharge' invoice is saved WITHOUT posting a journal, and must be reviewed and
    // approved by a distinct authorized checker via /override, or sent to dispute.
    const auditStatus = audit.auditStatus;
    const overrideApprovedBy: number | null = null;
    const overrideApprovedAt: Date | null = null;
    const overrideReason: string | null = null;

    const entryDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const shouldPostJournal = ['matched', 'undercharge', 'no_contract'].includes(auditStatus);

    // INV-MARITIME-CARRIER-INVOICE-NUMBER-UNIQUE: there is NO unique
    // constraint on maritime_carrier_invoices.invoice_number, so the
    // duplicate check inside the transaction below is the only thing
    // stopping the same carrier invoice number from posting a second
    // journal and doubling the carrier cost. The advisory lock
    // serialises concurrent creates of the same number; the existence
    // check runs before any journal is posted, on the effective
    // shipping line (the DTO line, else the job's line) with a
    // null-safe line comparison -- two different lines may legitimately
    // reuse a number, the same line may not.
    const normalizedInvoiceNumber = dto.invoiceNumber.trim().toUpperCase();
    const effectiveShippingLineId = dto.shippingLineId
      ? Number(dto.shippingLineId)
      : job.shipping_line_id
        ? Number(job.shipping_line_id)
        : null;

    // Everything below is one atomic unit: the journal (header + lines), the job cost roll-up,
    // and the invoice record itself. Previously these were five independent statements on
    // `this.db` directly — a failure partway left an orphaned journal entry and an inflated
    // job cost with no invoice record to explain either.
    const insertedInvoice = await this.db.transaction().execute(async (trx: any) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedInvoiceNumber}))`.execute(trx);
      const duplicateQuery = trx
        .selectFrom('maritime_carrier_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql<string>`UPPER(TRIM(invoice_number))`, '=', normalizedInvoiceNumber);
      const duplicateInvoice = await (
        effectiveShippingLineId == null
          ? duplicateQuery.where('shipping_line_id', 'is', null)
          : duplicateQuery.where('shipping_line_id', '=', effectiveShippingLineId)
      ).executeTakeFirst();
      if (duplicateInvoice) {
        throw new BadRequestException('رقم فاتورة الخط الملاحي مستخدم من قبل ولا يمكن تسجيله مرتين لنفس الخط الملاحي');
      }

      let entryId: number | null = null;

      if (shouldPostJournal) {
        entryId = await this.postCarrierInvoiceJournal(trx, tenantId, {
          job,
          invoiceNumber: dto.invoiceNumber,
          carrierName: dto.carrierName,
          shippingLineId: dto.shippingLineId,
          totalAmount,
          currency,
          exchangeRate,
          entryDate,
          userId: auth.userId,
        });
      }

      // 3. Insert into maritime_carrier_invoices
      const [row] = await trx
        .insertInto('maritime_carrier_invoices')
        .values({
          tenant_id: tenantId,
          job_id: Number(job.id),
          shipping_line_id: dto.shippingLineId
            ? Number(dto.shippingLineId)
            : job.shipping_line_id
              ? Number(job.shipping_line_id)
              : null,
          carrier_name: dto.carrierName || job.shipping_line_name || 'Carrier',
          invoice_number: dto.invoiceNumber.trim(),
          invoice_date: dto.invoiceDate
            ? (dto.invoiceDate as any)
            : ((await resolveBusinessDateKey(trx, tenantId, new Date())) as any),
          currency,
          total_invoiced_amount: totalAmount,
          ocean_freight: Number(dto.oceanFreight || 0),
          thc_charges: Number(dto.thcCharges || 0),
          baf_charges: Number(dto.bafCharges || 0),
          detention_demurrage: Number(dto.detentionDemurrage || 0),
          other_charges: Number(dto.otherCharges || 0),
          rate_card_id: audit.rateCardId ? Number(audit.rateCardId) : null,
          contracted_amount: audit.contractedTotal,
          variance_amount: audit.varianceAmount,
          variance_pct: audit.variancePct,
          audit_status: auditStatus,
          override_approved_by: overrideApprovedBy,
          override_approved_at: overrideApprovedAt,
          override_reason: overrideReason,
          journal_entry_id: entryId,
          payment_status: 'unpaid',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .execute();

      return row;
    });

    const statusMessage =
      auditStatus === 'matched'
        ? 'مطابقة للتعرفة المتعاقد عليها'
        : auditStatus === 'overcharge'
          ? `زيادة غير معتمدة بمقدار +${audit.varianceAmount} (+${audit.variancePct}%) تتطلب مراجعة واعتماد مسؤول مالي آخر أو فتح نزاع`
          : auditStatus === 'undercharge'
            ? `أقل من التعرفة بمقدار -${Math.abs(audit.varianceAmount)}`
            : 'سجلت بدون تعرفة مسبقة';

    return {
      success: true,
      invoice: insertedInvoice,
      audit,
      message: `تم تسجيل فاتورة الخط الملاحي #${dto.invoiceNumber} بنجاح (${statusMessage})`,
    };
  }

  async overrideCarrierInvoice(auth: AuthContext, invoiceId: string, dto: { reason: string }) {
    const { tenantId } = requireTenantScope(auth);

    const updatedInvoice = await this.db.transaction().execute(async (trx: any) => {
      // Row lock: without it, two concurrent /override calls by two different valid checkers
      // both read journal_entry_id = NULL, both pass the "not yet posted" check below, and both
      // post a journal entry for the same invoice — a duplicated expense in the general ledger.
      const invoice = await trx
        .selectFrom('maritime_carrier_invoices')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoiceId) as any)
        .forUpdate()
        .executeTakeFirst();

      if (!invoice) throw new NotFoundException('فاتورة الناقل غير موجودة');

      // The endpoint previously had no check on the invoice's current audit_status at all: it
      // could be called on an already-matched, already-approved, or disputed invoice and would
      // unconditionally flip it to 'approved_override'. Only an invoice actually flagged
      // 'overcharge' is awaiting this decision.
      if (invoice.audit_status !== 'overcharge') {
        throw new BadRequestException(
          `لا يمكن تطبيق التجاوز المالي: حالة الفاتورة الحالية (${invoice.audit_status}) ليست في انتظار مراجعة زيادة سعرية.`,
        );
      }

      const validation = validateMakerCheckerOverride({
        userId: auth.userId || 0,
        role: auth.role || '',
        invoiceCreatedBy: invoice.created_by ? Number(invoice.created_by) : null,
        reason: dto.reason,
      });

      // INV-SOLO-ADMIN-CARRIER-INVOICE-OVERRIDE: a shop with only
      // ONE admin could never approve an overcharge override on an
      // invoice they recorded — the engine's maker-checker ban
      // refused the creator outright, so the invoice sat in
      // `overcharge` forever with no second approver to turn to.
      // When the actor IS the invoice creator, the creator may
      // approve alone — but never silently: the override is stamped
      // into the invoice row's `override_reason` (the row's
      // free-text field for the override decision) with creator ==
      // approver, the overcharge amount and that no second approval
      // is required (INV-SECOND-MANAGER-PASSWORD-REMOVED); the supplied reason is preserved in
      // front of the stamp, and override_approved_by /
      // override_approved_at already record who approved and when.
      // The shared isSoloAdminOverride helper (created by P5, reused
      // by P6–P8; no fourth copy) is consulted lazily, only when the
      // engine validation failed on the self-approval leg, so an
      // approval by a different approver costs no extra query and
      // behaves byte-identically. The helper is NOT extended with a
      // roles parameter: the engine's third eligible role,
      // finance_manager, is not a storable users role
      // (users_role_valid CHECK + UserTable.role union + session
      // role derivation all agree), so no second finance_manager
      // approver and no finance_manager creator can exist — the
      // helper already answers exactly the right question, and a
      // finance_manager creator stays fail-closed on the old ban.
      // The identity comparison is unchanged
      // (`Number(invoice.created_by)`, as the service already passes
      // it to the engine, and the engine itself compares with
      // String()): it already coerces, so unlike P7's bare `===`
      // the ban DOES fire against live Postgres (pg returns bigint
      // as string, no setTypeParser anywhere in src — Number("1")
      // === 1, String(1) === String("1")), and the override is
      // reached exactly when the ban would have fired. The reason
      // leg still applies on the solo path with the engine's exact
      // message — a solo override without a reason is still refused.
      // No second-manager approval is ever required; a
      // non-admin creator is still refused. The audit_status gate
      // above still runs first.
      let soloOverride = false;
      if (!validation.valid) {
        const createdBy = invoice.created_by ? Number(invoice.created_by) : null;
        if (createdBy !== null && Number(auth.userId) === createdBy) {
          soloOverride = await isSoloAdminOverride(trx, tenantId, auth);
          if (soloOverride && !(dto.reason || '').trim()) {
            throw new BadRequestException('يجب تقديم مبرر مالي لاعتماد التجاوز يوضح سبب قبول الزيادة عن التعرفة.');
          }
        }
        if (!soloOverride) {
          throw new BadRequestException(validation.error);
        }
      }

      const job = await this.getJobById(auth, String(invoice.job_id));

      // Post journal if not already posted. Uses the same shared helper as createCarrierInvoice:
      // throws instead of silently skipping when the required accounts are missing, and enforces
      // the fiscal period lock — neither of which the previous inline copy of this logic did.
      let entryId = invoice.journal_entry_id ? Number(invoice.journal_entry_id) : null;
      if (!entryId) {
        const invCurrency = String(invoice.currency || 'USD')
          .trim()
          .toUpperCase();
        const fxRate = await this.resolveFreightExchangeRate(tenantId, invCurrency);

        entryId = await this.postCarrierInvoiceJournal(trx, tenantId, {
          job,
          invoiceNumber: invoice.invoice_number,
          carrierName: invoice.carrier_name,
          shippingLineId: invoice.shipping_line_id,
          totalAmount: Number(invoice.total_invoiced_amount),
          currency: invCurrency,
          exchangeRate: fxRate,
          entryDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
          descriptionSuffix: '(معتمدة بتجاوز مالي)',
          userId: auth.userId,
        });
      }

      const soloStamp = `تجاوز منفرد بقرار إداري — من سجل الفاتورة ${auth.userId} اعتمد التجاوز بنفسه — الزيادة ${Number(invoice.variance_amount)}`;
      const [row] = await trx
        .updateTable('maritime_carrier_invoices')
        .set({
          audit_status: 'approved_override',
          override_approved_by: auth.userId ? Number(auth.userId) : null,
          override_approved_at: sql`NOW()`,
          override_reason: soloOverride ? `${dto.reason.trim()} — ${soloStamp}` : dto.reason.trim(),
          journal_entry_id: entryId,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoiceId) as any)
        .returningAll()
        .execute();

      return row;
    });

    return {
      success: true,
      invoice: updatedInvoice,
      message: 'تم اعتماد التجاوز المالي لفاتورة الناقل وترحيل القيد المحاسبي بنجاح',
    };
  }
}
