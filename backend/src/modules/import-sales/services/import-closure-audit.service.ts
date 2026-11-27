import { Injectable, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { ResolveExceptionDto } from '../dto/import-sales.dto';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';

/**
 * ImportClosureAuditService — slice S8 of the import-sales split.
 * Pure move of 7 methods from ImportSalesService (project partners
 * (2) + closeProject + flow-events traceability (1) + reconciliation
 * (3)). No behavior change: the bodies are byte-identical; the facade
 * keeps thin delegates with the same names and signatures. This slice
 * calls two other slices through the facade delegates only:
 * generatePeriodProfitReport (S6 profit-report slice) and
 * listApprovalRequests (S7 commercial slice) are bound from the
 * facade — the slice never imports another slice service. No posting
 * methods live here, so there is no posting-service dep and no
 * fallback expression. Date handling travels verbatim:
 * setProjectPartners' todayKey resolves through
 * resolveBusinessDateKey (tenant day); closeProject's profit-report
 * end bound, closedAt and closure_date are server-instants-as-evidence;
 * runImportReconciliationScan's todayStr resolves through
 * resolveBusinessDateKey (tenant day) while its age arithmetic runs on
 * server instants — never pg DATE keys. All 7 methods are public in
 * the facade, so no visibility change was needed (no TS2341 forced
 * change, S10 precedent).
 */

export interface ImportClosureAuditDeps {
  db: Kysely<any>;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). verifyAndConsumeApprovalRequest
  // is the shared kernel helper (stays in the facade forever);
  // generatePeriodProfitReport is the S6 profit-report slice and
  // listApprovalRequests is the S7 commercial slice, both reached
  // through the facade delegates.
  generatePeriodProfitReport: (...args: any[]) => any;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  listApprovalRequests: (...args: any[]) => any;
}

@Injectable()
export class ImportClosureAuditService {
  private readonly db: Kysely<any>;
  private readonly generatePeriodProfitReport: (...args: any[]) => any;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  private readonly listApprovalRequests: (...args: any[]) => any;

  constructor(deps: ImportClosureAuditDeps) {
    this.db = deps.db;
    this.generatePeriodProfitReport = deps.generatePeriodProfitReport;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
    this.listApprovalRequests = deps.listApprovalRequests;
  }

  async getProjectPartners(tenantId: string, projectId: string) {
    return await this.db
      .selectFrom('import_project_partners')
      .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
      .select([
        'import_project_partners.id as allocation_id',
        'import_project_partners.partner_id',
        'import_partners.name as partner_name',
        'import_project_partners.capital_share_amount',
        'import_project_partners.profit_percentage',
        'import_project_partners.effective_from',
        'import_project_partners.is_active',
      ])
      .where('import_project_partners.tenant_id', '=', tenantId)
      .where('import_project_partners.project_id', '=', projectId)
      .where('import_project_partners.is_active', '=', true)
      .execute();
  }

  async setProjectPartners(
    tenantId: string,
    projectId: string,
    partners: Array<{ partnerId: string; capitalShare?: number; profitPercentage: number }>,
  ) {
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!project) throw new NotFoundException('مشروع الاستيراد غير موجود.');
      if (project.status === 'closed') {
        throw new BadRequestException('لا يمكن تعديل نسب الشركاء لمشروع مقفل ومسوى مالياً.');
      }

      // Existing single-row partner allocations are not effective-dated history.
      // Freeze edits when financial execution has started to protect prior earnings.
      const postedReceipt = await trx
        .selectFrom('import_shipments as shipment')
        .innerJoin('import_inventory_receipts as receipt', 'receipt.shipment_id', 'shipment.id')
        .select('shipment.id')
        .where('shipment.project_id', '=', projectId)
        .where('shipment.tenant_id', '=', tenantId)
        .where('receipt.tenant_id', '=', tenantId)
        .where('receipt.state', '=', 'posted')
        .executeTakeFirst();
      const paidProforma = await trx
        .selectFrom('import_proforma_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('paid_amount_foreign', '>', 0)
        .executeTakeFirst();
      if (postedReceipt || paidProforma) {
        throw new BadRequestException(
          'لا يجوز تعديل نسب المشروع بعد بدء السداد أو الاستلام دون سجل تاريخي لنسب الشراكة.',
        );
      }

      const totalPercentage = partners.reduce((sum, p) => sum + Number(p.profitPercentage || 0), 0);
      if (totalPercentage > 100.001) {
        throw new BadRequestException(`مجموع نسب الشركاء للمشروع (${totalPercentage}%) يتجاوز 100%.`);
      }

      const partnerIds = partners.map((p) => p.partnerId);
      if (partnerIds.length > 0) {
        const validPartners = await trx
          .selectFrom('import_partners')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', partnerIds)
          .execute();

        if (validPartners.length !== partnerIds.length) {
          throw new BadRequestException('أحد الشركاء المحددين غير مسجل أو ينتمي لمنشأة أخرى.');
        }
      }

      // Delete partners no longer in the project to maintain clean foreign keys
      if (partnerIds.length > 0) {
        await trx
          .deleteFrom('import_project_partners')
          .where('project_id', '=', projectId)
          .where('tenant_id', '=', tenantId)
          .where('partner_id', 'not in', partnerIds)
          .execute();
      } else {
        await trx
          .deleteFrom('import_project_partners')
          .where('project_id', '=', projectId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Upsert each partner cleanly to prevent duplicate key collision on (tenant_id, project_id, partner_id)
      // New partner rows start on the tenant-local business day.
      const todayKey = await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date());
      for (const p of partners) {
        await trx
          .insertInto('import_project_partners')
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            partner_id: p.partnerId,
            capital_share_amount: Number(p.capitalShare || 0),
            profit_percentage: Number(p.profitPercentage || 0),
            is_active: true,
            effective_from: todayKey,
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'project_id', 'partner_id']).doUpdateSet({
              capital_share_amount: Number(p.capitalShare || 0),
              profit_percentage: Number(p.profitPercentage || 0),
              is_active: true,
              effective_from: todayKey,
            }),
          )
          .execute();
      }

      return { success: true, count: partners.length };
    });
  }

  async closeProject(tenantId: string, userId: number, projectId: string, approvalRequestId?: string) {
    if (!approvalRequestId) throw new BadRequestException('إقفال مشروع الاستيراد يتطلب موافقة Maker-Checker معتمدة.');
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (project.status === 'closed') {
        throw new BadRequestException('المشروع مقفل بالفعل.');
      }
      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'project_closure', projectId, approvalRequestId);

      const shipments = await trx
        .selectFrom('import_shipments')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const s of shipments) {
        if (s.status !== 'Arrived') {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: الحاوية ${s.container_number} ما زالت بالحالة (${s.status}) ولم تصل بعد.`,
          );
        }
        const receipt = await trx
          .selectFrom('import_inventory_receipts')
          .select('state')
          .where('shipment_id', '=', s.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (!receipt || receipt.state !== 'posted') {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: الحاوية ${s.container_number} لم يتم ترحيل استلامها المخزني بالكامل.`,
          );
        }
      }

      const proformas = await trx
        .selectFrom('import_proforma_invoices')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const pi of proformas) {
        const isPaid =
          pi.payment_status === 'paid' && Number(pi.paid_amount_foreign || 0) >= Number(pi.total_amount_foreign || 0);
        if (!isPaid) {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: الفاتورة المبدئية رقم ${pi.pi_number} للمورد غير مسددة بالكامل (الحالة: ${pi.payment_status}، المسدد: ${pi.paid_amount_foreign || 0} من ${pi.total_amount_foreign || 0}).`,
          );
        }
      }

      // Ensure no unsettled purchase invoices linked to this project architecturally
      const projectPurchases = await trx
        .selectFrom('purchases')
        .select(['id', 'doc_no', 'total', 'paid_amount', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('import_project_id', '=', projectId)
        .where('status', '!=', 'cancelled')
        .execute();

      for (const pur of projectPurchases) {
        const paid = Number(pur.paid_amount || 0);
        const total = Number(pur.total || 0);
        if (paid < total - 0.001) {
          throw new BadRequestException(
            `لا يمكن إقفال المشروع: فاتورة الشراء رقم ${pur.doc_no || pur.id} غير مسددة بالكامل للمورد (المتبقي: ${(total - paid).toFixed(2)} ج.م).`,
          );
        }
      }

      // Guard: No unliquidated customs broker advances
      const activeAdvances = await trx
        .selectFrom('import_broker_advances')
        .select(['advance_no', 'remaining_amount_egp'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId)
        .where('remaining_amount_egp', '>', 0)
        .execute();

      if (activeAdvances.length > 0) {
        const first = activeAdvances[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: توجد عهدة مخلص معلقة (إذن رقم ${first.advance_no}) بمبلغ متبقٍ ${Number(first.remaining_amount_egp).toFixed(2)} ج.م يلزم تسويتها أولاً.`,
        );
      }

      // Guard: No pending container security deposits
      const pendingDeposits = await trx
        .selectFrom('import_container_deposits')
        .select(['container_no', 'refund_status'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0
              ? eb(
                  'shipment_id',
                  'in',
                  shipments.map((s) => s.id),
                )
              : sql`1=0`,
          ]),
        )
        .where('refund_status', 'in', ['pending', 'partially_refunded'])
        .execute();

      if (pendingDeposits.length > 0) {
        const first = pendingDeposits[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد تأمين حاوية معلق (#${first.container_no}) بحالة (${first.refund_status}) يلزم استرداده وتسويته أولاً.`,
        );
      }

      // Guard: No unverified broker expenses (INV-IMPORT-BROKER-
      // CAPITALISATION). A project cannot close while a
      // liquidated broker expense still awaits its maker-checker
      // verification: the capitalisation underneath it is
      // attested by one person only.
      const unverifiedExpenses = await trx
        .selectFrom('import_broker_expenses')
        .select(['receipt_no', 'amount_egp'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0
              ? eb(
                  'shipment_id',
                  'in',
                  shipments.map((s) => s.id),
                )
              : sql`1=0`,
          ]),
        )
        .where('is_verified', '=', false)
        .execute();

      if (unverifiedExpenses.length > 0) {
        const first = unverifiedExpenses[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد مصروف مخلص غير متحقق منه (إيصال #${first.receipt_no}، ${Number(first.amount_egp).toFixed(2)} ج.م) يلزم التحقق منه بموافقة معتمدة أولاً.`,
        );
      }

      const startDate = project.created_at || new Date('2020-01-01');
      const profitReport = await this.generatePeriodProfitReport(tenantId, startDate, new Date(), projectId, trx);

      if (!profitReport.data.profitAttributionVerified) {
        // An unverified report may show zero sales precisely because allocation is missing.
        // Never treat that synthetic zero as safe to close.
        throw new UnprocessableEntityException(
          'لا يمكن إقفال المشروع قبل اعتماد تتبع مصدر المبيعات وكميات المخزون بالكامل.',
        );
      }

      // Guard: No unsold remaining inventory in lots
      const remainingLots = await trx
        .selectFrom('import_inventory_lots')
        .select(['lot_number', 'remaining_quantity'])
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            shipments.length > 0
              ? eb(
                  'shipment_id',
                  'in',
                  shipments.map((s) => s.id),
                )
              : sql`1=0`,
          ]),
        )
        .where('remaining_quantity', '>', 0)
        .execute();

      if (remainingLots.length > 0) {
        const first = remainingLots[0];
        throw new BadRequestException(
          `لا يمكن إقفال المشروع: يوجد رصيد مخزني غير مباع بالباتش (${first.lot_number}) متبقٍ به ${first.remaining_quantity} وحدة يلزم بيعه أو تسويته مخزنيًا قبل الإقفال النهائي.`,
        );
      }

      const projectItems =
        shipments.length > 0
          ? await trx
              .selectFrom('import_shipment_items')
              .select(['product_id', 'quantity', 'received_quantity'])
              .where('tenant_id', '=', tenantId)
              .where(
                'shipment_id',
                'in',
                shipments.map((s) => s.id),
              )
              .execute()
          : [];

      let totalReceived = 0;
      for (const it of projectItems) {
        totalReceived += Number(it.received_quantity ?? it.quantity);
      }

      const closureData = {
        closedAt: new Date().toISOString(),
        closedBy: userId,
        shipmentsCount: shipments.length,
        totalReceivedUnits: totalReceived,
        financialReconciliation: profitReport.data,
        reconciliationStatus: profitReport.data.profitAttributionVerified ? 'verified' : 'pending_source_attribution',
      };

      await trx
        .updateTable('import_projects')
        .set({
          status: 'closed',
          closure_data: closureData,
          closure_date: new Date(),
          closed_by: userId,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        message: `تمت تسوية وإقفال مشروع الاستيراد #${project.project_no} بنجاح وحفظ السجل المالي النهائي.`,
        closureData,
      };
    });
  }

  async listImportFlowEvents(tenantId: string, projectId?: string) {
    const events: Array<{
      kind: string;
      ref: string;
      label: string;
      state: string;
      projectId: string | null;
      shipmentId: string | null;
      amountEgp: number | null;
      amountForeign: number | null;
      currency: string | null;
      journalEntryNo: string | null;
      journalMatched: boolean | null;
      createdAt: any;
    }> = [];
    const num = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    let projectsQ = this.db.selectFrom('import_projects').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) projectsQ = projectsQ.where('id', '=', projectId);
    const projects = await projectsQ.orderBy('created_at', 'asc').execute();
    for (const p of projects) {
      events.push({
        kind: 'project',
        ref: String(p.project_no || p.id),
        label: String(p.title || ''),
        state: String(p.status || ''),
        projectId: String(p.id),
        shipmentId: null,
        amountEgp: num(p.allocated_capital),
        amountForeign: null,
        currency: String(p.budget_currency || '') || null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: p.created_at,
      });
    }

    let piQ = this.db.selectFrom('import_proforma_invoices').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) piQ = piQ.where('project_id', '=', projectId);
    const pis = await piQ.orderBy('created_at', 'asc').execute();
    for (const pi of pis) {
      events.push({
        kind: 'proforma_invoice',
        ref: String(pi.pi_number || pi.id),
        label: '',
        state: String(pi.status || ''),
        projectId: pi.project_id ? String(pi.project_id) : null,
        shipmentId: null,
        amountEgp: null,
        amountForeign: num(pi.total_amount_foreign),
        currency: String(pi.currency || '') || null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: pi.created_at,
      });
    }

    let shipQ = this.db.selectFrom('import_shipments').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) shipQ = shipQ.where('project_id', '=', projectId);
    const shipments = await shipQ.orderBy('created_at', 'asc').execute();
    const shipmentIds = shipments.map((s) => String(s.id));
    for (const s of shipments) {
      events.push({
        kind: 'shipment',
        ref: String(s.container_number || s.id),
        label: String(s.bill_of_lading || ''),
        state: String(s.status || ''),
        projectId: s.project_id ? String(s.project_id) : null,
        shipmentId: String(s.id),
        amountEgp: null,
        amountForeign: null,
        currency: null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: s.created_at,
      });
    }

    // Receipt tie-out: the receipt row carries its journal; the
    // journal row carries the posted state. A receipt is "matched"
    // only when BOTH are posted — a posted receipt with no journal,
    // or a journal that is not posted, is an open tie-out, never a
    // silent 100% match.
    let receiptQ = this.db
      .selectFrom('import_inventory_receipts as r')
      .leftJoin('journal_entries as je', 'je.id', 'r.journal_entry_id')
      .leftJoin('import_shipments as s', 's.id', 'r.shipment_id')
      .select([
        'r.id as receipt_id',
        'r.shipment_id as shipment_id',
        'r.state as state',
        'r.journal_entry_id as journal_entry_id',
        'r.created_at as created_at',
        'je.entry_no as entry_no',
        'je.status as journal_status',
        's.project_id as project_id',
        's.container_number as container_number',
      ])
      .where('r.tenant_id', '=', tenantId);
    if (projectId) receiptQ = receiptQ.where('s.project_id', '=', projectId);
    else if (shipmentIds.length > 0) receiptQ = receiptQ.where('r.shipment_id', 'in', shipmentIds);
    const receipts = await receiptQ.orderBy('r.created_at', 'asc').execute();
    for (const r of receipts as any[]) {
      const matched = r.state === 'posted' && r.journal_entry_id != null && r.journal_status === 'posted';
      events.push({
        kind: 'receipt',
        ref: `#${r.receipt_id}`,
        label: String(r.container_number || ''),
        state: String(r.state || ''),
        projectId: r.project_id ? String(r.project_id) : null,
        shipmentId: r.shipment_id ? String(r.shipment_id) : null,
        amountEgp: null,
        amountForeign: null,
        currency: null,
        journalEntryNo: r.entry_no ? String(r.entry_no) : null,
        journalMatched: matched,
        createdAt: r.created_at,
      });
    }

    // Supplier payments are linked to the import flow only through
    // their proforma invoice (the same join recordForeignTransfer
    // uses to prove payment coverage). supplier_payments carries no
    // project_id: inventing one would attribute a payment to the
    // wrong project, so unlinked payments are not traced here.
    const payments = await this.db
      .selectFrom('supplier_payments as sp')
      .innerJoin('import_proforma_invoices as pi', 'pi.id', 'sp.proforma_invoice_id')
      .select([
        'sp.id as payment_id',
        'sp.doc_no as doc_no',
        'sp.amount as amount',
        'sp.amount_foreign as amount_foreign',
        'sp.currency as currency',
        'sp.created_at as created_at',
        'pi.project_id as project_id',
        'pi.pi_number as pi_number',
      ])
      .where('sp.tenant_id', '=', tenantId)
      .$if(!!projectId, (eb) => eb.where('pi.project_id', '=', projectId as string))
      .orderBy('sp.created_at', 'asc')
      .execute();
    for (const pay of payments as any[]) {
      events.push({
        kind: 'supplier_payment',
        ref: String(pay.doc_no || `#${pay.payment_id}`),
        label: String(pay.pi_number || ''),
        state: 'paid',
        projectId: pay.project_id ? String(pay.project_id) : null,
        shipmentId: null,
        amountEgp: num(pay.amount),
        amountForeign: num(pay.amount_foreign),
        currency: String(pay.currency || '') || null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: pay.created_at,
      });
    }

    let payoutQ = this.db.selectFrom('import_partner_project_payouts').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) payoutQ = payoutQ.where('project_id', '=', projectId);
    const payouts = await payoutQ.orderBy('created_at', 'asc').execute();
    for (const po of payouts) {
      events.push({
        kind: 'partner_payout',
        ref: `#${po.id}`,
        label: '',
        state: 'paid',
        projectId: String(po.project_id),
        shipmentId: null,
        amountEgp: num(po.amount_egp),
        amountForeign: null,
        currency: null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: po.created_at,
      });
    }

    const approvals = await this.listApprovalRequests(tenantId);
    for (const a of approvals as any[]) {
      if (projectId) {
        let payload: any = {};
        try {
          payload =
            typeof a.request_payload === 'string' ? JSON.parse(a.request_payload || '{}') : a.request_payload || {};
        } catch {
          payload = {};
        }
        // The project binding is the payload's projectId when the
        // approval carries one (partner_distribution, project_closure,
        // large_transfer); otherwise the approval has no project and
        // does not belong to one project's trace.
        const boundProject = payload.projectId ? String(payload.projectId) : null;
        if (boundProject !== String(projectId)) continue;
      }
      events.push({
        kind: 'approval_request',
        ref: `#${String(a.id).slice(0, 8)}`,
        label: String(a.action_type || ''),
        state: String(a.status || ''),
        projectId: null,
        shipmentId: null,
        amountEgp: null,
        amountForeign: null,
        currency: null,
        journalEntryNo: null,
        journalMatched: null,
        createdAt: a.created_at,
      });
    }

    events.sort((x, y) => {
      const tx = x.createdAt ? new Date(x.createdAt).getTime() : 0;
      const ty = y.createdAt ? new Date(y.createdAt).getTime() : 0;
      return tx - ty;
    });

    const byKind = (kind: string) => events.filter((e) => e.kind === kind);
    const counts = {
      projects: byKind('project').length,
      proformaInvoices: byKind('proforma_invoice').length,
      proformaInvoicesApproved: byKind('proforma_invoice').filter((e) => e.state === 'approved').length,
      shipments: byKind('shipment').length,
      shipmentsArrived: byKind('shipment').filter((e) => e.state === 'Arrived').length,
      receipts: byKind('receipt').length,
      receiptsPosted: byKind('receipt').filter((e) => e.state === 'posted').length,
      receiptsMatched: byKind('receipt').filter((e) => e.journalMatched === true).length,
      supplierPayments: byKind('supplier_payment').length,
      partnerPayouts: byKind('partner_payout').length,
      approvalsPending: byKind('approval_request').filter((e) => e.state === 'pending').length,
      approvalsApproved: byKind('approval_request').filter((e) => e.state === 'approved').length,
      approvalsRejected: byKind('approval_request').filter((e) => e.state === 'rejected').length,
      approvalsExecuted: byKind('approval_request').filter((e) => e.state === 'executed').length,
    };
    return { events, counts };
  }

  async runImportReconciliationScan(tenantId: string) {
    const exceptions: any[] = [];

    const staleAdvances = await this.db
      .selectFrom('import_broker_advances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .execute();

    const today = new Date();
    for (const adv of staleAdvances) {
      // A fresh, not-yet-liquidated broker advance is a normal operation, not an exception.
      const disbursedOn = new Date(String(adv.disbursement_date));
      const ageDays = Number.isFinite(disbursedOn.getTime())
        ? (today.getTime() - disbursedOn.getTime()) / (24 * 60 * 60 * 1000)
        : 0;
      if (Number(adv.remaining_amount_egp) > 0 && ageDays > 30) {
        exceptions.push({
          tenant_id: tenantId,
          exception_type: 'broker_advance_mismatch',
          severity: 'high',
          project_id: adv.project_id,
          shipment_id: adv.shipment_id,
          discrepancy_amount_egp: adv.remaining_amount_egp,
          details: JSON.stringify({
            advanceNo: adv.advance_no,
            brokerId: adv.broker_id,
            remaining: adv.remaining_amount_egp,
          }),
          status: 'open',
        });
      }
    }

    const pendingDeposits = await this.db
      .selectFrom('import_container_deposits')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('refund_status', '=', 'pending')
      .execute();

    const todayStr = await resolveBusinessDateKey(this.db, tenantId, new Date());
    for (const dep of pendingDeposits) {
      if (dep.expected_return_date && dep.expected_return_date < todayStr) {
        exceptions.push({
          tenant_id: tenantId,
          exception_type: 'container_deposit_overdue',
          severity: 'critical',
          project_id: dep.project_id,
          shipment_id: dep.shipment_id,
          discrepancy_amount_egp: dep.deposit_amount_egp,
          details: JSON.stringify({
            containerNo: dep.container_no,
            shippingLine: dep.shipping_line,
            expectedDate: dep.expected_return_date,
          }),
          status: 'open',
        });
      }
    }

    const existingOpen = await this.db
      .selectFrom('import_reconciliation_exceptions')
      .select(['exception_type', 'shipment_id', 'project_id', 'details'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'open')
      .execute();
    let insertedCount = 0;
    for (const ex of exceptions) {
      const duplicate = existingOpen.some(
        (row: any) =>
          row.exception_type === ex.exception_type &&
          row.shipment_id === ex.shipment_id &&
          row.project_id === ex.project_id &&
          JSON.stringify(row.details) ===
            JSON.stringify(typeof ex.details === 'string' ? JSON.parse(ex.details) : ex.details),
      );
      if (duplicate) continue;
      await this.db.insertInto('import_reconciliation_exceptions').values(ex).execute();
      existingOpen.push({
        exception_type: ex.exception_type,
        shipment_id: ex.shipment_id,
        project_id: ex.project_id,
        details: JSON.parse(ex.details),
      });
      insertedCount++;
    }

    return {
      scannedAt: new Date(),
      exceptionsFoundCount: insertedCount,
      exceptions,
    };
  }

  async listReconciliationExceptions(tenantId: string, status?: string) {
    let q = this.db.selectFrom('import_reconciliation_exceptions').selectAll().where('tenant_id', '=', tenantId);
    if (status) q = q.where('status', '=', status);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async resolveReconciliationException(
    tenantId: string,
    userId: number,
    exceptionId: string,
    dto: ResolveExceptionDto,
  ) {
    return await this.db
      .updateTable('import_reconciliation_exceptions')
      .set({
        status: 'resolved',
        resolved_by: userId,
        resolution_notes: dto.resolutionNotes,
        resolved_at: new Date(),
      })
      .where('id', '=', exceptionId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
