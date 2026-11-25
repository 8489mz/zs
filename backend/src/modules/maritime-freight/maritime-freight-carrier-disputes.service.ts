import { calculateCarrierCreditBaseAmount } from './engines/carrier-credit.engine';
import { type AccountingPostingService } from '../accounting/accounting-posting.service';
import { ensureDomainSupplier } from '../accounting/partner-subledger';
import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { type Kysely, sql } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';

/**
 * MaritimeFreightCarrierDisputesService — slice S20 of the maritime-freight split.
 * Pure move of 4 methods from MaritimeFreightService (carrier invoice
 * disputes: create, resolve, and the two invoice listings). No behavior
 * change: the bodies are byte-identical; the facade keeps thin delegates
 * with the same names and signatures for all 4 public methods.
 * Deps are db + the REQUIRED posting service + the BOUND getJobById
 * (S12 — the jobs-core slice owns it; the facade binds its own method
 * on the generation tree, S10 form, and the merge repoints it to the S12
 * slice instance when S12 lands). No mail, no messaging gateway, no
 * kernel, no Logger (S20 is not one of the 6 logger slices). No banner
 * travels into this slice: the cargo-insurance banner follows the last
 * method and belongs to the insurance slice. The double blank above the
 * first method is pre-existing in the pristine file and stays in the
 * facade. Date handling travels verbatim: six bare date constructions
 * and one tenant timezone lookup — pure moves, no UTC-slice normalizer,
 * no instant comparison. Guard: no rounding helpers, one posting call
 * and one account-resolution call, two transactions. The dispute
 * creation reads the job before its transaction opens, and the dispute
 * resolution only calls the posting service with the open transaction
 * handle — so no in-memory-test-database hang shape sits in this slice.
 * The resolution method is the riskiest method here (it posts a real
 * journal and is driven only by a live-Postgres spec).
 */

export interface MaritimeFreightCarrierDisputesDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  // Bound S12 method (same name as the facade member, so the moved body
  // is byte-identical). getJobById has NO explicit return type in the
  // pristine file, so the bound type uses Promise<any> (S14 precedent).
  // The S12 slice owns it forever; the facade binds its own method on
  // the generation tree (S10 form) and the merge repoints it to the S12
  // slice instance.
  getJobById: (auth: AuthContext, id: string) => Promise<any>;
}

@Injectable()
export class MaritimeFreightCarrierDisputesService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly getJobById: (auth: AuthContext, id: string) => Promise<any>;

  constructor(deps: MaritimeFreightCarrierDisputesDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.getJobById = deps.getJobById;
  }

  async createCarrierDispute(auth: AuthContext, invoiceId: string, dto: { reason: string; disputedAmount?: number }) {
    const { tenantId } = requireTenantScope(auth);

    const invoice = await this.db
      .selectFrom('maritime_carrier_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(invoiceId) as any)
      .executeTakeFirst();

    if (!invoice) throw new NotFoundException('فاتورة الناقل غير موجودة');

    const job = await this.getJobById(auth, String(invoice.job_id));
    const disputedAmount = dto.disputedAmount ? Number(dto.disputedAmount) : Number(invoice.variance_amount);

    // معاملة واحدة: إنشاء النزاع **و**حجز الفاتورة عن الصرف لا ينفصلان. كانا
    // عبارتين مستقلتين، ففشل الثانية يترك نزاعاً قائماً وفاتورة قابلة للصرف —
    // خرق صامت للثابت DISP-1 ("تعليق الفاتورة لحين التسوية").
    const { dispute, disputeNumber } = await this.db.transaction().execute(async (trx) => {
      // ترقيم آمن: رقم مؤقت فريد ثم إعادة التسمية بالمعرّف (نفس نمط MWR في هذا
      // الملف و§2.2). كان `COUNT(*) + 1` بلا فلتر يومي وبلا قيد تفرد على
      // `dispute_number` — نزاعان متزامنان يأخذان نفس الرقم **بصمت** (F6).
      const tempNumber = `DISP-TMP-${crypto.randomUUID()}`;
      const [inserted] = await trx
        .insertInto('maritime_carrier_disputes')
        .values({
          tenant_id: tenantId,
          dispute_number: tempNumber,
          invoice_id: Number(invoice.id),
          job_id: Number(job.id),
          carrier_name: invoice.carrier_name,
          disputed_amount: disputedAmount > 0 ? disputedAmount : Number(invoice.total_invoiced_amount),
          currency: invoice.currency || 'USD',
          dispute_reason: dto.reason?.trim() || 'فروق تسعير عن التعرفة المتعاقد عليها',
          dispute_status: 'submitted',
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber(
        'DISP',
        Number(inserted.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );
      const [renamed] = await trx
        .updateTable('maritime_carrier_disputes')
        .set({ dispute_number: finalNumber })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', inserted.id as any)
        .returningAll()
        .execute();

      await trx
        .updateTable('maritime_carrier_invoices')
        .set({
          audit_status: 'disputed',
          payment_status: 'held_for_dispute',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoice.id) as any)
        .execute();

      return { dispute: renamed, disputeNumber: finalNumber };
    });

    return {
      success: true,
      dispute,
      message: `تم إنشاء مذكرة النزاع المالي #${disputeNumber} وحجز الفاتورة عن الصرف بنجاح`,
    };
  }

  async resolveCarrierDispute(
    auth: AuthContext,
    disputeId: string,
    dto: {
      status: 'accepted' | 'rejected' | 'partially_accepted';
      resolutionNotes?: string;
      creditNoteNumber?: string;
      creditNoteAmount?: number;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    if (!['accepted', 'rejected', 'partially_accepted'].includes(dto.status))
      throw new BadRequestException('نتيجة النزاع غير صالحة.');
    const creditAmount = Number(dto.creditNoteAmount || 0);
    if (!Number.isFinite(creditAmount) || creditAmount < 0 || (dto.status === 'rejected' && creditAmount !== 0))
      throw new BadRequestException('قيمة الإشعار الدائن غير صالحة.');
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const dispute = await trx
        .selectFrom('maritime_carrier_disputes')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(disputeId))
        .forUpdate()
        .executeTakeFirst();
      if (!dispute) throw new NotFoundException('مذكرة النزاع غير موجودة');
      if (['accepted', 'rejected', 'partially_accepted'].includes(dispute.dispute_status)) {
        if (
          dispute.dispute_status !== dto.status ||
          Number(dispute.credit_note_amount || 0) !== creditAmount ||
          String(dispute.credit_note_number || '') !== String(dto.creditNoteNumber || '')
        )
          throw new BadRequestException('النزاع مسوى بالفعل ببيانات مختلفة.');
        return { success: true, dispute, message: 'تمت تسوية النزاع مسبقاً.' };
      }
      if (creditAmount > Number(dispute.disputed_amount))
        throw new BadRequestException('الإشعار يتجاوز المبلغ المتنازع عليه.');
      const invoice = await trx
        .selectFrom('maritime_carrier_invoices')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dispute.invoice_id))
        .forUpdate()
        .executeTakeFirstOrThrow();
      const job = await trx
        .selectFrom('maritime_jobs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dispute.job_id) as any)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (creditAmount > 0) {
        if (!invoice.journal_entry_id || !invoice.shipping_line_id)
          throw new BadRequestException('يجب ترحيل فاتورة الناقل وربط الخط الملاحي قبل إشعارها الدائن.');
        const originalExpense = await trx
          .selectFrom('journal_entry_lines')
          .select(['account_id', 'debit', 'cost_center_id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', tenantId)
          .where('journal_entry_id', '=', invoice.journal_entry_id)
          .where('debit', '>', 0)
          .executeTakeFirstOrThrow();
        const previousCredits = await trx
          .selectFrom('maritime_carrier_disputes')
          .select(sql<number>`coalesce(sum(credit_note_amount), 0)`.as('amount'))
          .where('tenant_id', '=', tenantId)
          .where('invoice_id', '=', invoice.id)
          .where('id', '!=', dispute.id)
          .where('dispute_status', 'in', ['accepted', 'partially_accepted'])
          .executeTakeFirstOrThrow();
        if (creditAmount + Number(previousCredits.amount) > Number(invoice.total_invoiced_amount) + 0.001)
          throw new BadRequestException('الإشعارات الدائنة المتراكمة تتجاوز قيمة فاتورة الناقل.');
        const ratio = creditAmount / Number(invoice.total_invoiced_amount);
        if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1)
          throw new BadRequestException('قيمة الإشعار لا تطابق الفاتورة الأصلية.');
        const baseCredit = calculateCarrierCreditBaseAmount(
          Number(invoice.total_invoiced_amount),
          Number(originalExpense.debit),
          Number(previousCredits.amount),
          creditAmount,
        );
        const supplierId = await ensureDomainSupplier(
          trx,
          tenantId,
          'shipping_line',
          invoice.shipping_line_id,
          invoice.carrier_name || 'خط ملاحي',
        );
        const payableId = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '2110');
        const originalPayable = await trx
          .selectFrom('journal_entry_lines')
          .select(['cost_center_id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', tenantId)
          .where('journal_entry_id', '=', invoice.journal_entry_id)
          .where('account_id', '=', payableId)
          .where('partner_type', '=', 'supplier')
          .where('partner_id', '=', supplierId)
          .where('credit', '>', 0)
          .executeTakeFirst();
        if (!originalPayable)
          throw new BadRequestException(
            'هوية مورد الفاتورة لا تطابق القيد الأصلي؛ يلزم مراجعة الربط قبل الإشعار الدائن.',
          );
        const description = `إشعار دائن ناقل ${dto.creditNoteNumber || ''} - النزاع ${dispute.dispute_number}`;
        await this.accountingPosting.postDomainJournal(trx, {
          tenantId,
          accountId: tenantId,
          entryDate: new Date(),
          sourceType: 'maritime_carrier_credit_note',
          sourceId: Number(dispute.id),
          description,
          createdBy: auth.userId || null,
          lines: [
            {
              accountId: payableId,
              description,
              debit: baseCredit,
              credit: 0,
              partnerType: 'supplier',
              partnerId: supplierId,
              costCenterId: originalPayable.cost_center_id,
              branchId: originalPayable.branch_id,
              locationId: originalPayable.location_id,
            },
            {
              accountId: Number(originalExpense.account_id),
              description,
              debit: 0,
              credit: baseCredit,
              partnerType: 'none',
              partnerId: null,
              costCenterId: originalExpense.cost_center_id,
              branchId: originalExpense.branch_id,
              locationId: originalExpense.location_id,
            },
          ],
        });
        const carrierCost = Number(job.carrier_cost_total || 0) - baseCredit;
        if (carrierCost < -0.01)
          throw new BadRequestException('تكلفة الشحنة لا تكفي للإشعار؛ يلزم مطابقة القيود السابقة.');
        await trx
          .updateTable('maritime_jobs')
          .set({
            carrier_cost_total: Math.max(0, carrierCost),
            net_profit:
              Number(job.client_invoiced_total || 0) - Math.max(0, carrierCost) - Number(job.other_costs_total || 0),
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', job.id)
          .execute();
      }
      const updated = await trx
        .updateTable('maritime_carrier_disputes')
        .set({
          dispute_status: dto.status,
          resolution_notes: dto.resolutionNotes || null,
          credit_note_number: dto.creditNoteNumber || null,
          credit_note_amount: creditAmount,
          resolved_by: auth.userId || null,
          resolved_at: new Date(),
          updated_at: new Date(),
        } as any)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dispute.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('maritime_carrier_invoices')
        .set({
          payment_status: 'unpaid',
          audit_status: dto.status === 'rejected' ? 'approved_override' : 'matched',
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', invoice.id)
        .execute();
      return { success: true, dispute: updated, message: 'تمت تسوية النزاع وقيده المحاسبي.' };
    });
  }

  async listJobCarrierInvoices(auth: AuthContext, jobId: string) {
    const { tenantId } = requireTenantScope(auth);

    const invoices = await this.db
      .selectFrom('maritime_carrier_invoices as mci')
      .leftJoin('maritime_carrier_disputes as mcd', 'mcd.invoice_id', 'mci.id')
      .leftJoin('maritime_rate_cards as mrc', 'mrc.id', 'mci.rate_card_id')
      .select([
        'mci.id',
        'mci.tenant_id',
        'mci.job_id',
        'mci.shipping_line_id',
        'mci.carrier_name',
        'mci.invoice_number',
        'mci.invoice_date',
        'mci.currency',
        'mci.total_invoiced_amount',
        'mci.ocean_freight',
        'mci.thc_charges',
        'mci.baf_charges',
        'mci.detention_demurrage',
        'mci.other_charges',
        'mci.rate_card_id',
        'mci.contracted_amount',
        'mci.variance_amount',
        'mci.variance_pct',
        'mci.audit_status',
        'mci.override_approved_by',
        'mci.override_approved_at',
        'mci.override_reason',
        'mci.journal_entry_id',
        'mci.payment_status',
        'mci.notes',
        'mci.created_by',
        'mci.created_at',
        'mcd.id as dispute_id',
        'mcd.dispute_number',
        'mcd.dispute_status',
        'mcd.disputed_amount',
        'mcd.credit_note_number',
        'mcd.credit_note_amount',
        'mrc.carrier_name as rate_card_carrier',
        'mrc.total_freight_cost as rate_card_unit_cost',
      ])
      .where('mci.tenant_id', '=', tenantId)
      .where('mci.job_id', '=', Number(jobId) as any)
      .orderBy('mci.id', 'desc')
      .execute();

    return invoices.map((r: any) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      shippingLineId: r.shipping_line_id ? String(r.shipping_line_id) : null,
      carrierName: r.carrier_name,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      currency: r.currency,
      totalInvoicedAmount: Number(r.total_invoiced_amount),
      oceanFreight: Number(r.ocean_freight),
      thcCharges: Number(r.thc_charges),
      bafCharges: Number(r.baf_charges),
      detentionDemurrage: Number(r.detention_demurrage),
      otherCharges: Number(r.other_charges),
      rateCardId: r.rate_card_id ? String(r.rate_card_id) : null,
      contractedAmount: Number(r.contracted_amount),
      varianceAmount: Number(r.variance_amount),
      variancePct: Number(r.variance_pct),
      auditStatus: r.audit_status,
      overrideApprovedBy: r.override_approved_by ? String(r.override_approved_by) : null,
      overrideApprovedAt: r.override_approved_at,
      overrideReason: r.override_reason,
      journalEntryId: r.journal_entry_id ? String(r.journal_entry_id) : null,
      paymentStatus: r.payment_status,
      notes: r.notes,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: r.created_at,
      dispute: r.dispute_id
        ? {
            id: String(r.dispute_id),
            disputeNumber: r.dispute_number,
            disputeStatus: r.dispute_status,
            disputedAmount: Number(r.disputed_amount),
            creditNoteNumber: r.credit_note_number,
            creditNoteAmount: Number(r.credit_note_amount),
          }
        : null,
      rateCard: r.rate_card_id
        ? {
            carrierName: r.rate_card_carrier,
            unitCost: Number(r.rate_card_unit_cost),
          }
        : null,
    }));
  }

  async listAllCarrierInvoices(
    auth: AuthContext,
    filters?: {
      auditStatus?: string;
      shippingLineId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const { tenantId } = requireTenantScope(auth);
    const page = Math.max(1, filters?.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters?.pageSize || 50));

    let query = this.db
      .selectFrom('maritime_carrier_invoices as mci')
      .leftJoin('maritime_carrier_disputes as mcd', 'mcd.invoice_id', 'mci.id')
      .leftJoin('maritime_rate_cards as mrc', 'mrc.id', 'mci.rate_card_id')
      .leftJoin('maritime_jobs as j', 'j.id', 'mci.job_id')
      .select([
        'mci.id',
        'mci.tenant_id',
        'mci.job_id',
        'mci.shipping_line_id',
        'mci.carrier_name',
        'mci.invoice_number',
        'mci.invoice_date',
        'mci.currency',
        'mci.total_invoiced_amount',
        'mci.ocean_freight',
        'mci.thc_charges',
        'mci.baf_charges',
        'mci.detention_demurrage',
        'mci.other_charges',
        'mci.rate_card_id',
        'mci.contracted_amount',
        'mci.variance_amount',
        'mci.variance_pct',
        'mci.audit_status',
        'mci.override_approved_by',
        'mci.override_approved_at',
        'mci.override_reason',
        'mci.journal_entry_id',
        'mci.payment_status',
        'mci.notes',
        'mci.created_by',
        'mci.created_at',
        'mcd.id as dispute_id',
        'mcd.dispute_number',
        'mcd.dispute_status',
        'mcd.disputed_amount',
        'mcd.credit_note_number',
        'mcd.credit_note_amount',
        'mrc.carrier_name as rate_card_carrier',
        'mrc.total_freight_cost as rate_card_unit_cost',
        'j.job_number',
        'j.customer_name',
        'j.pol_name',
        'j.pod_name',
      ])
      .where('mci.tenant_id', '=', tenantId);

    if (filters?.auditStatus && filters.auditStatus !== 'all') {
      query = query.where('mci.audit_status', '=', filters.auditStatus as any);
    }

    if (filters?.shippingLineId) {
      query = query.where('mci.shipping_line_id', '=', Number(filters.shippingLineId) as any);
    }

    if (filters?.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('mci.invoice_number', 'ilike', term),
          eb('mci.carrier_name', 'ilike', term),
          eb('j.job_number', 'ilike', term),
          eb('j.customer_name', 'ilike', term),
        ]),
      );
    }

    const rows = await query
      .orderBy('mci.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();

    // Summary aggregates for company-wide audit KPIs
    const allForTenant = await this.db
      .selectFrom('maritime_carrier_invoices')
      .select([
        sql<number>`count(*)::int`.as('total_count'),
        sql<number>`coalesce(sum(total_invoiced_amount), 0)::float`.as('total_invoiced'),
        sql<number>`count(case when audit_status = 'matched' then 1 end)::int`.as('matched_count'),
        sql<number>`count(case when audit_status = 'overcharge' then 1 end)::int`.as('overcharge_count'),
        sql<number>`count(case when audit_status = 'disputed' then 1 end)::int`.as('disputed_count'),
        sql<number>`coalesce(sum(case when audit_status = 'overcharge' then variance_amount else 0 end), 0)::float`.as(
          'overcharge_amount',
        ),
      ])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return {
      invoices: rows.map((r: any) => ({
        id: String(r.id),
        jobId: String(r.job_id),
        jobNumber: r.job_number || `JOB-${r.job_id}`,
        customerName: r.customer_name || '—',
        polName: r.pol_name || '—',
        podName: r.pod_name || '—',
        shippingLineId: r.shipping_line_id ? String(r.shipping_line_id) : null,
        carrierName: r.carrier_name,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        currency: r.currency,
        totalInvoicedAmount: Number(r.total_invoiced_amount),
        oceanFreight: Number(r.ocean_freight),
        thcCharges: Number(r.thc_charges),
        bafCharges: Number(r.baf_charges),
        detentionDemurrage: Number(r.detention_demurrage),
        otherCharges: Number(r.other_charges),
        rateCardId: r.rate_card_id ? String(r.rate_card_id) : null,
        contractedAmount: Number(r.contracted_amount || 0),
        varianceAmount: Number(r.variance_amount || 0),
        variancePct: Number(r.variance_pct || 0),
        auditStatus: r.audit_status,
        overrideApprovedBy: r.override_approved_by,
        overrideApprovedAt: r.override_approved_at,
        overrideReason: r.override_reason,
        journalEntryId: r.journal_entry_id,
        paymentStatus: r.payment_status,
        notes: r.notes,
        createdAt: r.created_at,
        dispute: r.dispute_id
          ? {
              id: String(r.dispute_id),
              disputeNumber: r.dispute_number,
              status: r.dispute_status,
              disputedAmount: Number(r.disputed_amount),
              creditNoteNumber: r.credit_note_number,
              creditNoteAmount: Number(r.credit_note_amount || 0),
            }
          : null,
        rateCard: r.rate_card_id
          ? {
              carrierName: r.rate_card_carrier,
              unitCost: Number(r.rate_card_unit_cost),
            }
          : null,
      })),
      summary: {
        totalInvoices: Number(allForTenant?.total_count || 0),
        totalInvoicedAmount: Number(allForTenant?.total_invoiced || 0),
        matchedCount: Number(allForTenant?.matched_count || 0),
        overchargeCount: Number(allForTenant?.overcharge_count || 0),
        disputedCount: Number(allForTenant?.disputed_count || 0),
        totalOverchargeAmount: Number(allForTenant?.overcharge_amount || 0),
      },
    };
  }
}
