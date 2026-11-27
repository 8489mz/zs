import { randomUUID } from 'crypto';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import {
  CreateQuotationDto,
  SelectQuotationDto,
  CreateSampleOrderDto,
  UpdateSampleOrderInspectionDto,
  ConvertFeasibilityToProjectDto,
  CreateProformaInvoiceDto,
  CreateImportDocumentDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
} from '../dto/import-sales.dto';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveFxRate } from '../../accounting/fx-rate-resolution';
import { isPaymentMethod } from '../engines/import-payment-method.engine';
import { isSoloAdminOverride } from '../../../common/utils/manager-approval';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

/**
 * ImportCommercialService — slice S7 of the import-sales split.
 * Pure move of 19 methods from ImportSalesService (quotations 3,
 * samples 3, conversion/proforma/PO 7, documents 2, approvals 3,
 * listProjectProfitAttribution). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. All 19 methods are public — no visibility change.
 * Cross-slice dep: listProjectProfitAttribution calls
 * generatePeriodProfitReport, bound from the facade delegate into
 * S6's profit-report slice (never a direct slice import).
 * FX: createQuotation holds the live-or-supplied-rate site
 * (resolveFxRate, 2 occurrences — the only FX sites S7 moves; no
 * hardcoded rates anywhere). The guard's FX pin stays a lower bound
 * (>= 1) on the facade, so no guard FX change is needed.
 * Clock: expiry/date sites travel verbatim (resolveBusinessDateKey
 * tenant day; server instants as evidence). The clock-b4 §D
 * quotation-expiry pin follows selectQuotation into this file — the
 * spec repoint travels with this patch (same S2 §C precedent).
 * INV comment ids travel with the bodies (behavior specs only).
 * No posting methods in this slice — no posting-service dep, no
 * fallback expression. listApprovalRequests is S7's own method; S8
 * binds it later via the facade delegate.
 */

export interface ImportCommercialDeps {
  db: Kysely<any>;
  // Bound facade delegate into S6's profit-report slice (used only by
  // listProjectProfitAttribution).
  generatePeriodProfitReport: (...args: any[]) => any;
}

@Injectable()
export class ImportCommercialService {
  private readonly db: Kysely<any>;
  private readonly generatePeriodProfitReport: (...args: any[]) => any;

  constructor(deps: ImportCommercialDeps) {
    this.db = deps.db;
    this.generatePeriodProfitReport = deps.generatePeriodProfitReport;
  }

  async createQuotation(tenantId: string, dto: CreateQuotationDto) {
    // INV-IMPORT-ESTIMATES-HONEST + INV-IMPORT-FX-RESOLVER (F1): the
    // estimate basis is recorded, never silent — and the rate itself
    // is never invented. When the caller supplies no exchange rate,
    // the rate resolves live through resolveFxRate for the quotation
    // currency and fails closed when no rate is registered (no
    // hardcoded 50). The row still carries the exact basis it was
    // computed from (exchange_rate_used, exchange_rate_assumed) so
    // every consumer can label the estimate with what was assumed.
    const rateAssumed = dto.exchangeRate === undefined || dto.exchangeRate === null || Number(dto.exchangeRate) <= 0;
    const customsAssumed = dto.estimatedCustomsRatePercent === undefined || dto.estimatedCustomsRatePercent === null;
    const currency =
      String(dto.currency || 'USD')
        .trim()
        .toUpperCase() || 'USD';
    const commRate = rateAssumed
      ? await resolveFxRate(this.db, tenantId, currency)
      : await resolveFxRate(this.db, tenantId, currency, { suppliedRate: Number(dto.exchangeRate) });
    const estLanded =
      Number(dto.unitPriceForeign) * commRate +
      Number(dto.estimatedFreightUsd || 0) * commRate +
      Number(dto.unitPriceForeign) * commRate * (Number(dto.estimatedCustomsRatePercent || 5) / 100);

    return await this.db
      .insertInto('import_quotations')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        quotation_no: dto.quotationNo,
        inquiry_date: dto.inquiryDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        expiry_date: dto.expiryDate || null,
        incoterm: dto.incoterm || 'FOB',
        currency: dto.currency || 'USD',
        item_name: dto.itemName,
        product_id: dto.productId ? Number(dto.productId) : null,
        unit_price_foreign: dto.unitPriceForeign,
        moq: dto.moq || 1,
        production_lead_days: dto.productionLeadDays || 30,
        port_of_loading: dto.portOfLoading || null,
        estimated_freight_usd: dto.estimatedFreightUsd || 0,
        estimated_customs_rate_percent: dto.estimatedCustomsRatePercent || 5,
        estimated_landed_cost_egp: Number(estLanded.toFixed(4)),
        exchange_rate_used: commRate,
        exchange_rate_assumed: rateAssumed,
        customs_rate_assumed: customsAssumed,
        status: 'pending',
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listQuotations(tenantId: string, projectId?: string, supplierId?: string) {
    let q = this.db
      .selectFrom('import_quotations as q')
      .leftJoin('suppliers as s', 's.id', 'q.supplier_id')
      .selectAll('q')
      .select(['s.name as supplier_name'])
      .where('q.tenant_id', '=', tenantId);
    if (projectId) q = q.where('q.project_id', '=', projectId);
    if (supplierId) q = q.where('q.supplier_id', '=', Number(supplierId));
    return await q.orderBy('q.created_at', 'desc').execute();
  }

  async selectQuotation(tenantId: string, quotationId: string, dto: SelectQuotationDto) {
    return await this.db.transaction().execute(async (trx) => {
      // INV-IMPORT-QUOTATION-LOCK: the candidate row is locked
      // for the transaction, so two concurrent selections of the
      // same quotation serialise instead of racing.
      const quote = await trx
        .selectFrom('import_quotations')
        .selectAll()
        .where('id', '=', quotationId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Re-selecting the same already-selected quotation is an
      // idempotent no-op: it succeeds unchanged and never
      // re-rejects siblings (a new round's candidates stay).
      if (quote.status === 'selected') {
        return quote;
      }
      if (quote.status !== 'pending') {
        throw new BadRequestException(
          `لا يمكن اعتماد عرض سعر غير معلق (الحالة الحالية: ${quote.status})؛ الاعتماد متاح فقط للعروض المعلقة. [IMPORT_QUOTATION_NOT_SELECTABLE]`,
        );
      }

      // An expired quotation can never be selected.
      const toDateOnly = (v: any): string | null => {
        if (v === null || v === undefined || v === '') return null;
        if (v instanceof Date) return formatLocalCalendarDay(v);
        return String(v).slice(0, 10);
      };
      const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
      const expiry = toDateOnly(quote.expiry_date);
      if (expiry && expiry < today) {
        throw new BadRequestException(
          `انتهت صلاحية عرض السعر هذا (تاريخ الانتهاء: ${expiry}) ولا يمكن اعتماده؛ اطلب عرض سعر جديداً. [IMPORT_QUOTATION_EXPIRED]`,
        );
      }

      if (quote.project_id) {
        // Lock the whole (project, item) sibling group before
        // deciding: concurrent selections for the same item
        // serialise on these rows, so exactly one winner emerges
        // and a stale sibling can never flip a locked selection.
        const siblings = await trx
          .selectFrom('import_quotations')
          .select(['id', 'status', 'created_at', 'updated_at'])
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', quote.project_id)
          .where('item_name', '=', quote.item_name)
          .forUpdate()
          .execute();
        const winner = siblings.find((s: any) => s.status === 'selected' && String(s.id) !== String(quotationId));
        if (winner) {
          // Stale-round rule: a quotation created at or before
          // the existing selection belongs to the locked round
          // and cannot supersede it; a quotation created after
          // the selection is a new round and may supersede.
          const toMs = (v: any): number => {
            if (v instanceof Date) return v.getTime();
            const t = Date.parse(String(v));
            return Number.isFinite(t) ? t : 0;
          };
          if (toMs(quote.created_at) <= toMs(winner.updated_at)) {
            throw new BadRequestException(
              'تم اعتماد عرض سعر أحدث لنفس الصنف في هذا المشروع؛ لا يمكن لعرض أقدم أن يلغي الاعتماد المقفل. أنشئ عرض سعر جديداً لجولة تفاوض جديدة. [IMPORT_QUOTATION_SELECTION_LOCKED]',
            );
          }
        }

        await trx
          .updateTable('import_quotations')
          .set({ status: 'rejected' })
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', quote.project_id)
          .where('item_name', '=', quote.item_name)
          .where('id', '!=', quotationId)
          .execute();
      }

      return await trx
        .updateTable('import_quotations')
        .set({
          status: 'selected',
          selection_reason: dto?.selectionReason || 'اعتماد عرض السعر الأفضل فنياً ومالياً',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', quotationId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async createSampleOrder(tenantId: string, dto: CreateSampleOrderDto) {
    return await this.db
      .insertInto('import_sample_orders')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        sample_code: dto.sampleCode,
        item_name: dto.itemName,
        sample_cost_foreign: dto.sampleCostForeign || 0,
        freight_cost_foreign: dto.freightCostForeign || 0,
        currency: dto.currency || 'USD',
        request_date: dto.requestDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        courier_tracking_no: dto.courierTrackingNo || null,
        decision: 'pending',
        reference_sample_approved: false,
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listSampleOrders(tenantId: string, projectId?: string) {
    let q = this.db
      .selectFrom('import_sample_orders as s')
      .leftJoin('suppliers as sup', 'sup.id', 's.supplier_id')
      .selectAll('s')
      .select(['sup.name as supplier_name'])
      .where('s.tenant_id', '=', tenantId);
    if (projectId) q = q.where('s.project_id', '=', projectId);
    return await q.orderBy('s.created_at', 'desc').execute();
  }

  async updateSampleOrderInspection(tenantId: string, sampleId: string, dto: UpdateSampleOrderInspectionDto) {
    const updates: any = { updated_at: sql`NOW()` };
    if (dto.qualityScore !== undefined) updates.quality_score = dto.qualityScore;
    if (dto.decision) updates.decision = dto.decision;
    if (dto.referenceSampleApproved !== undefined) updates.reference_sample_approved = dto.referenceSampleApproved;
    if (dto.defectAnalysis !== undefined) updates.defect_analysis = dto.defectAnalysis;
    if (dto.photoUrls) updates.photo_urls = JSON.stringify(dto.photoUrls);
    if (dto.receivedDate) updates.received_date = dto.receivedDate;

    return await this.db
      .updateTable('import_sample_orders')
      .set(updates)
      .where('id', '=', sampleId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async convertFeasibilityToProject(tenantId: string, projectId: string, dto: ConvertFeasibilityToProjectDto) {
    return await this.db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom('import_projects')
        .selectAll()
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // I1-P2: approving a feasibility study transitions the existing
      // project only, once. A second approval must fail closed instead
      // of re-running the conversion — re-running would rebuild the
      // cash-flow schedule and mint a second proforma for the same study.
      if (project.feasibility_converted_at) {
        throw new BadRequestException(
          `دراسة الجدوى للمشروع ${project.project_no} معتمدة بالفعل؛ لا يمكن اعتمادها مرة ثانية. [IMPORT_FEASIBILITY_ALREADY_CONVERTED]`,
        );
      }

      const feas = project.feasibility_data;
      if (!feas || !feas.items || !feas.items.length) {
        throw new BadRequestException('دراسة الجدوى لا تحتوي على أصناف صالحة للتحويل.');
      }

      // INV-FEASIBILITY-CONTRACT-RATE-REQUIRED: no invented rate.
      // The old fallback of 50 lived only here, then was stored as
      // the proforma's exchange_rate_contract, so the invented rate
      // became the authoritative contract rate downstream. A
      // non-EGP project without a usable commercial rate must not
      // convert: the merchant sets the rate on the feasibility
      // study and converts again. Mirrors the proforma gate
      // (INV-IMPORT-PROFORMA-EXCHANGE-RATE): EGP budgets convert
      // at rate 1. Checked before any write.
      const budgetCurrency = (project.budget_currency || 'USD').toUpperCase();
      const commRate = budgetCurrency === 'EGP' ? 1 : Number(feas.exchangeRateCommercial);
      if (!Number.isFinite(commRate) || commRate <= 0) {
        throw new BadRequestException(
          `لا يمكن تحويل دراسة الجدوى ${project.project_no} بلا سعر صرف تجاري صالح؛ حدد سعر الصرف التجاري (${budgetCurrency}) على دراسة الجدوى قبل التحويل. [IMPORT_EXCHANGE_RATE_REQUIRED]`,
        );
      }
      const totalFactoryUsd = Number(feas.totalFactoryCostUsd || 0);
      // INV-IMPORT-ESTIMATES-HONEST: the 30% advance default is recorded,
      // and the milestone text states the ACTUAL percentages used — the
      // previous hardcoded "(30%)" / "(70%)" text lied whenever the caller
      // supplied a different split. Each schedule entry carries its basis
      // (estimate flag, whether the advance split was assumed, the rate).
      const advanceAssumed = dto.advancePaymentPercentage === undefined || dto.advancePaymentPercentage === null;
      const advPercent = advanceAssumed ? 30 : Number(dto.advancePaymentPercentage);
      const balPercent = 100 - advPercent;
      const advanceUsd = (totalFactoryUsd * advPercent) / 100;
      const balanceUsd = (totalFactoryUsd * balPercent) / 100;

      const cashFlowSchedule = [
        {
          stage: 'T0_Contract_Advance',
          milestone: `دفعة مقدمة للمصنع عند توقيع العقد (${advPercent}%)`,
          amountUsd: advanceUsd,
          amountEgp: advanceUsd * commRate,
          dueDaysFromStart: 0,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T1_Pre_Shipment_Balance',
          milestone: `سداد رصيد المصنع بعد فحص الجودة وقبل الشحن (${balPercent}%)`,
          amountUsd: balanceUsd,
          amountEgp: balanceUsd * commRate,
          dueDaysFromStart: 30,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T2_Freight_And_Insurance',
          milestone: 'سداد نولون الشحن البحري والتأمين عند إصدار البوليصة',
          amountUsd: Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0),
          amountEgp: (Number(feas.internationalShippingUsd || 0) + Number(feas.insuranceUsd || 0)) * commRate,
          dueDaysFromStart: 40,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T3_Customs_And_Clearance',
          milestone: 'رسوم الجمارك والضريبة والتخليص بميناء الوصول',
          amountUsd: 0,
          amountEgp:
            Number(feas.customsDutyEgp || 0) +
            Number(feas.clearanceAndPortFeesEgp || 0) +
            (feas.vatIsRefundable ? 0 : Number(feas.customsVatEgp || 0)),
          dueDaysFromStart: 55,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
        {
          stage: 'T4_Inland_Transport',
          milestone: 'النولون البري ونقل الحاويات إلى المخازن',
          amountUsd: 0,
          amountEgp: Number(feas.internalTransportEgp || 0),
          dueDaysFromStart: 60,
          is_estimate: true,
          assumed_advance_percentage: advanceAssumed,
          exchange_rate_used: commRate,
        },
      ];

      let proformaId = null;
      if (dto.supplierId) {
        const piNumber = `PI-${project.project_no}-${Date.now().toString().slice(-4)}`;
        const pi = await trx
          .insertInto('import_proforma_invoices')
          .values({
            tenant_id: tenantId,
            project_id: projectId,
            supplier_id: Number(dto.supplierId),
            pi_number: piNumber,
            pi_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
            currency: project.budget_currency || 'USD',
            total_amount_foreign: totalFactoryUsd,
            incoterm: 'FOB',
            delivery_port: dto.targetPort || project.country_destination || 'Alexandria',
            payment_terms: `${advPercent}% advance, ${balPercent}% against shipping documents`,
            exchange_rate_contract: commRate,
            status: 'draft',
            advance_percentage: advPercent,
            balance_percentage: balPercent,
            items: JSON.stringify(feas.items),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        proformaId = pi.id;
      }

      await trx
        .updateTable('import_projects')
        .set({
          status: 'sourcing',
          feasibility_converted_at: sql`NOW()`,
          cash_flow_schedule: JSON.stringify(cashFlowSchedule),
          initial_po_id: proformaId,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        projectId,
        proformaId,
        cashFlowSchedule,
      };
    });
  }

  async getProformaInvoices(tenantId: string, projectId?: string, supplierId?: string) {
    let q = this.db
      .selectFrom('import_proforma_invoices as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('import_projects as pr', 'pr.id', 'p.project_id')
      .selectAll('p')
      .select(['s.name as supplier_name', 'pr.title as project_title', 'pr.project_no'])
      .where('p.tenant_id', '=', tenantId);
    if (projectId) q = q.where('p.project_id', '=', projectId);
    if (supplierId) q = q.where('p.supplier_id', '=', Number(supplierId));
    return await q.orderBy('p.created_at', 'desc').execute();
  }

  async getProformaById(tenantId: string, id: string) {
    return await this.db
      .selectFrom('import_proforma_invoices as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .selectAll('p')
      .select(['s.name as supplier_name'])
      .where('p.id', '=', id)
      .where('p.tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
  }

  async createProformaInvoice(tenantId: string, dto: CreateProformaInvoiceDto) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: the supplier must exist in
    // this tenant (the FK alone allows any tenant's supplier), and
    // pi_number must be unique per tenant. The duplicate check is a
    // service check only — no unique index exists, so concurrent
    // creates can still race; that residual is recorded, not hidden.
    const supplier = await this.db
      .selectFrom('suppliers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(dto.supplierId))
      .executeTakeFirst();
    if (!supplier) {
      throw new BadRequestException(
        'المورد المحدد للفاتورة المبدئية غير موجود في هذه المنشأة. [IMPORT_PROFORMA_SUPPLIER_REQUIRED]',
      );
    }
    const duplicate = await this.db
      .selectFrom('import_proforma_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('pi_number', '=', dto.piNumber)
      .executeTakeFirst();
    if (duplicate) {
      throw new BadRequestException(
        `رقم الفاتورة المبدئية ${dto.piNumber} مستخدم بالفعل في هذه المنشأة. [IMPORT_PROFORMA_DUPLICATE_NUMBER]`,
      );
    }
    // Advance+balance structure (INV-IMPORT-PAYMENT-METHODS): no
    // silent 30/70 split. Either both percentages are explicit and
    // sum to 100, or neither is recorded (NULL = no advance
    // structure agreed). A one-sided percentage fails closed.
    const advPct = dto.advancePercentage;
    const balPct = dto.balancePercentage;
    if ((advPct !== undefined) !== (balPct !== undefined)) {
      throw new BadRequestException('نسبة الدفعة المقدمة ونسبة الرصيد يجب تحديدهما معًا صراحة أو تركهما معًا.');
    }
    if (advPct !== undefined && balPct !== undefined) {
      if (
        !Number.isFinite(advPct) ||
        !Number.isFinite(balPct) ||
        advPct <= 0 ||
        advPct >= 100 ||
        Math.abs(advPct + balPct - 100) > 0.001
      ) {
        throw new BadRequestException('نسبة الدفعة المقدمة والرصيد يجب أن تكونا موجبتين ومجموعهما 100.');
      }
    }
    return await this.db
      .insertInto('import_proforma_invoices')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        supplier_id: Number(dto.supplierId),
        pi_number: dto.piNumber,
        pi_date: dto.piDate,
        currency: dto.currency || 'USD',
        total_amount_foreign: dto.totalAmountForeign,
        incoterm: dto.incoterm || 'FOB',
        delivery_port: dto.deliveryPort || null,
        payment_terms: dto.paymentTerms || null,
        exchange_rate_contract: dto.exchangeRateContract || null,
        advance_percentage: advPct ?? null,
        balance_percentage: balPct ?? null,
        status: 'draft',
        payment_status: 'unpaid',
        paid_amount_foreign: 0,
        items: dto.items ? JSON.stringify(dto.items) : '[]',
        notes: dto.notes || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateProformaInvoice(tenantId: string, id: string, dto: Partial<CreateProformaInvoiceDto>) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: a proforma freezes once
    // money moved (any payment) or its PO was issued. Post-approval
    // edits stay allowed while unpaid and PO-less: the established
    // workflow approves first, then links catalog products into the
    // items, then generates the PO.
    const current = await this.db
      .selectFrom('import_proforma_invoices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    const paid =
      Number(current.paid_amount_foreign || 0) > 0 || (current.payment_status && current.payment_status !== 'unpaid');
    const poIssued = current.po_status === 'issued' || !!current.po_number;
    if (poIssued) {
      throw new BadRequestException(
        'لا يمكن تعديل فاتورة مبدئية بعد إصدار أمر الشراء الخاص بها. [IMPORT_PROFORMA_FROZEN]',
      );
    }
    if (paid) {
      // The established workflow pays the proforma BEFORE its items
      // are linked to catalog products (the e2e simulation settles
      // the balance, then links items, then generates the PO), so an
      // items-only update stays allowed after payment. Every money
      // or identity field is frozen: changing the total after money
      // moved would silently diverge the payment record. The PO
      // generation re-validates the header total against the items,
      // so an items edit cannot corrupt the PO either.
      const moneyFieldsTouched =
        dto.piNumber !== undefined ||
        dto.piDate !== undefined ||
        dto.currency !== undefined ||
        dto.totalAmountForeign !== undefined ||
        dto.incoterm !== undefined ||
        dto.deliveryPort !== undefined ||
        dto.paymentTerms !== undefined ||
        dto.exchangeRateContract !== undefined ||
        dto.advancePercentage !== undefined ||
        dto.balancePercentage !== undefined;
      if (moneyFieldsTouched) {
        throw new BadRequestException(
          'لا يمكن تعديل مبالغ أو بيانات فاتورة مبدئية بعد سداد أي دفعة؛ يُسمح فقط بربط الأصناف بالمنتجات. [IMPORT_PROFORMA_FROZEN]',
        );
      }
    }
    if (dto.piNumber && dto.piNumber !== current.pi_number) {
      const duplicate = await this.db
        .selectFrom('import_proforma_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('pi_number', '=', dto.piNumber)
        .executeTakeFirst();
      if (duplicate) {
        throw new BadRequestException(
          `رقم الفاتورة المبدئية ${dto.piNumber} مستخدم بالفعل في هذه المنشأة. [IMPORT_PROFORMA_DUPLICATE_NUMBER]`,
        );
      }
    }
    const updates: any = {};
    if (dto.piNumber) updates.pi_number = dto.piNumber;
    if (dto.piDate) updates.pi_date = dto.piDate;
    if (dto.currency) updates.currency = dto.currency;
    if (dto.totalAmountForeign !== undefined) updates.total_amount_foreign = dto.totalAmountForeign;
    if (dto.incoterm) updates.incoterm = dto.incoterm;
    if (dto.deliveryPort) updates.delivery_port = dto.deliveryPort;
    if (dto.paymentTerms) updates.payment_terms = dto.paymentTerms;
    if (dto.exchangeRateContract !== undefined) updates.exchange_rate_contract = dto.exchangeRateContract;
    if (dto.advancePercentage !== undefined) updates.advance_percentage = dto.advancePercentage;
    if (dto.balancePercentage !== undefined) updates.balance_percentage = dto.balancePercentage;
    if (dto.items) updates.items = JSON.stringify(dto.items);
    if (dto.notes !== undefined) updates.notes = dto.notes;

    return await this.db
      .updateTable('import_proforma_invoices')
      .set(updates)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async approveProformaInvoice(tenantId: string, userId: number, id: string) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: approve only a draft with
    // at least one validated item. Feasibility-style items (name +
    // qty, no catalog productId yet) are valid — the catalog link
    // happens after approval. Maker-checker (approver != creator)
    // cannot be enforced: import_proforma_invoices has no
    // created_by column, so the creator is unknowable here; that
    // residual needs a migration and is recorded in the invariant.
    const current = await this.db
      .selectFrom('import_proforma_invoices')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    if (current.status !== 'draft') {
      throw new BadRequestException('لا يمكن اعتماد فاتورة مبدئية ليست في حالة مسودة. [IMPORT_PROFORMA_NOT_DRAFT]');
    }
    const rawItems = typeof current.items === 'string' ? JSON.parse(current.items || '[]') : current.items || [];
    const hasValidItem =
      Array.isArray(rawItems) &&
      rawItems.some((item: any) => {
        const qty = Number(item?.quantity ?? item?.qty);
        const name = String(item?.name ?? item?.productName ?? '').trim();
        return (Number.isFinite(qty) && qty > 0) || name.length > 0;
      });
    if (!hasValidItem) {
      throw new BadRequestException('لا يمكن اعتماد فاتورة مبدئية بلا أصناف صالحة. [IMPORT_PROFORMA_NO_VALID_ITEMS]');
    }
    return await this.db
      .updateTable('import_proforma_invoices')
      .set({
        status: 'approved',
        approved_by: userId,
        approved_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async generatePoFromProforma(tenantId: string, userId: number, id: string) {
    // A Proforma is not an order: create the REAL purchasing PO and its stock lines atomically.
    return this.db.transaction().execute(async (trx) => {
      const pi = await trx
        .selectFrom('import_proforma_invoices')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (pi.po_status === 'issued' && pi.po_number) return pi;
      if (pi.status !== 'approved') throw new BadRequestException('يجب اعتماد الفاتورة المبدئية قبل إصدار أمر شراء.');
      const raw = typeof pi.items === 'string' ? JSON.parse(pi.items) : pi.items;

      // No auto-recovery: a proforma without usable items must fail
      // closed here. The old fallback first tried the linked project's
      // feasibility, then the tenant's most recently created project,
      // so a PO could be built from a different project's goods; and
      // its item mapping dropped productId, so the recovered lines
      // always failed validation and the transaction rolled back
      // anyway. Items are linked explicitly (updateProformaInvoice)
      // before conversion; nothing is borrowed.
      if (!Array.isArray(raw) || !raw.length)
        throw new BadRequestException('الفاتورة المبدئية لا تحتوي على أصناف قابلة للشراء.');
      // No invented rate: a foreign-currency proforma without a usable
      // contract rate must not be costed at a silent default (the old
      // fallback of 50 lived only in the draft PO's free-text notes, so
      // approving the draft posted costs nobody chose). The merchant
      // sets the contract rate on the proforma and converts again.
      const exchangeRate = (pi.currency || 'USD').toUpperCase() === 'EGP' ? 1 : Number(pi.exchange_rate_contract);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        throw new BadRequestException(
          `لا يمكن إصدار أمر شراء من الفاتورة المبدئية ${pi.pi_number} بلا سعر صرف تعاقدي صالح؛ حدد سعر الصرف التعاقدي (${pi.currency || 'USD'}) على الفاتورة المبدئية قبل التحويل. [IMPORT_EXCHANGE_RATE_REQUIRED]`,
        );
      }
      const supplier = await trx
        .selectFrom('suppliers')
        .select(['id', 'name', 'account_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', pi.supplier_id)
        .executeTakeFirstOrThrow();
      const scopeAccountId = String(supplier.account_id ?? '').trim() || tenantId;
      const lines: Array<{ productId: number; name: string; quantity: number; unitCost: number; total: number }> = [];
      let foreignTotal = 0;
      for (let lineIdx = 0; lineIdx < raw.length; lineIdx++) {
        const item = raw[lineIdx];
        const lineLabel = String(item.productName ?? item.name ?? '').trim() || 'بلا اسم';
        const productId = Number(item.productId ?? item.product_id);
        const qty = Number(item.quantity ?? item.qty);
        const foreignUnitCost = Number(item.unitPriceForeign ?? item.factoryPriceUsd ?? item.unitPriceUsd);
        if (
          !Number.isSafeInteger(productId) ||
          productId <= 0 ||
          !Number.isFinite(qty) ||
          qty <= 0 ||
          !Number.isFinite(foreignUnitCost) ||
          foreignUnitCost < 0
        ) {
          // I1-P1: the fail-closed error names the offending line
          // (index + name) so the merchant knows exactly which PI
          // line still needs a real inventory item linked. Never
          // silently skip the line or auto-match by name.
          throw new BadRequestException(
            `يجب ربط البند رقم ${lineIdx + 1} (${lineLabel}) من الـ Proforma بصنف حقيقي وتحديد الكمية وسعر الوحدة الأجنبي.`,
          );
        }
        const product = await trx
          .selectFrom('products')
          .select(['id', 'name'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', productId)
          .executeTakeFirst();
        if (!product)
          throw new BadRequestException(
            `البند رقم ${lineIdx + 1} (${lineLabel}) يشير إلى صنف غير موجود ضمن أصناف المنشأة.`,
          );

        const unitCost = Number((foreignUnitCost * exchangeRate).toFixed(3));
        const total = Number((qty * unitCost).toFixed(3));
        lines.push({ productId, name: product.name, quantity: qty, unitCost, total });
        foreignTotal += qty * foreignUnitCost;
      }
      foreignTotal = Number(foreignTotal.toFixed(2));
      if (Math.abs(foreignTotal - Number(pi.total_amount_foreign)) > 0.02) {
        // Fail closed: a supplier-document discrepancy must be fixed on
        // the proforma itself, never silently overwritten. The header
        // total feeds the later paid-amount checks; overwriting it here
        // would launder the discrepancy into the payment chain.
        throw new BadRequestException(
          `إجمالي بنود الفاتورة المبدئية ${pi.pi_number} (${foreignTotal}) لا يطابق إجمالي الفاتورة (${pi.total_amount_foreign})؛ صحح الفاتورة المبدئية قبل إصدار أمر الشراء. [IMPORT_PROFORMA_TOTAL_MISMATCH]`,
        );
      }
      const subtotal = Number(lines.reduce((sum, item) => sum + item.total, 0).toFixed(3));
      const inserted = await trx
        .insertInto('purchase_orders')
        .values({
          tenant_id: tenantId,
          account_id: scopeAccountId,
          order_number: `PO-TMP-${randomUUID()}`,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          subtotal,
          tax_amount: 0,
          discount_amount: 0,
          total_amount: subtotal,
          status: 'draft',
          notes: `أمر شراء وارد من Proforma ${pi.pi_number} - ${pi.currency} بسعر صرف ${exchangeRate}`,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const orderNumber = formatDailyDocumentNumber(
        'PO',
        inserted.id,
        new Date(),
        4,
        await getTenantTimezone(this.db, tenantId),
      );
      await trx
        .updateTable('purchase_orders')
        .set({ order_number: orderNumber })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', inserted.id)
        .execute();
      for (const item of lines) {
        await trx
          .insertInto('purchase_order_items')
          .values({
            tenant_id: tenantId,
            account_id: scopeAccountId,
            purchase_order_id: inserted.id,
            product_id: item.productId,
            product_name: item.name,
            quantity: item.quantity,
            received_quantity: 0,
            unit_cost: item.unitCost,
            tax_rate: 0,
            discount: 0,
            total: item.total,
          })
          .execute();
      }
      return trx
        .updateTable('import_proforma_invoices')
        .set({
          po_number: orderNumber,
          po_date: await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date()),
          po_status: 'issued',
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async createImportDocument(tenantId: string, userId: number, dto: CreateImportDocumentDto) {
    return await this.db
      .insertInto('import_documents')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId ?? null,
        shipment_id: dto.shipmentId ?? null,
        document_type: dto.documentType,
        file_name: dto.fileName,
        file_url: dto.fileUrl,
        file_size_bytes: dto.fileSizeBytes || 0,
        mime_type: dto.mimeType || 'application/pdf',
        issue_date: dto.issueDate || null,
        expiry_date: dto.expiryDate || null,
        is_verified: false,
        notes: dto.notes || null,
        created_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listImportDocuments(tenantId: string, projectId?: string, shipmentId?: string) {
    let q = this.db.selectFrom('import_documents').selectAll().where('tenant_id', '=', tenantId);
    if (projectId) q = q.where('project_id', '=', projectId);
    if (shipmentId) q = q.where('shipment_id', '=', shipmentId);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async createApprovalRequest(tenantId: string, userId: number, dto: CreateApprovalRequestDto) {
    if (dto.actionType === 'partner_distribution') {
      const payload = dto.requestPayload;
      if (
        !payload ||
        payload.partnerId !== dto.referenceId ||
        !payload.projectId ||
        !Number.isFinite(Number(payload.amount)) ||
        Number(payload.amount) <= 0
      ) {
        throw new BadRequestException('اعتماد صرف الأرباح يتطلب الشريك والمشروع وسقف مبلغ موجب ومطابقة المرجع.');
      }
    }
    if (dto.actionType === 'large_transfer') {
      const payload = dto.requestPayload;
      const payloadCurrency = String(payload?.currency || '')
        .trim()
        .toUpperCase();
      if (
        !payload ||
        !Number.isFinite(Number(payload.amount)) ||
        Number(payload.amount) <= 0 ||
        !/^[A-Z]{3}$/.test(payloadCurrency)
      ) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب سقف مبلغ موجباً وعملة صالحة من ثلاثة أحرف.');
      }
      if (payload.supplierId !== undefined && String(payload.supplierId) !== String(dto.referenceId)) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب مطابقة المورد للمرجع.');
      }
      if (payload.proformaInvoiceId !== undefined && !String(payload.proformaInvoiceId).trim()) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب معرف فاتورة مبدئية غير فارغ عند تحديده.');
      }
      if (payload.projectId !== undefined && !String(payload.projectId).trim()) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب معرف مشروع غير فارغ عند تحديده.');
      }
      if (payload.paymentMethod !== undefined && !isPaymentMethod(payload.paymentMethod)) {
        throw new BadRequestException('اعتماد الحوالة الكبيرة يتطلب طريقة دفع صالحة عند تحديدها.');
      }
    }
    if (dto.actionType === 'import_receipt_reversal' || dto.actionType === 'import_legacy_receipt_review') {
      const payload = dto.requestPayload;
      if (!payload || payload.shipmentId !== dto.referenceId || !String(payload.receiptId || '').trim()) {
        throw new BadRequestException('اعتماد عكس/مراجعة الاستلام يتطلب ربط الشحنة وسند الاستلام بالمرجع نفسه.');
      }
    }
    if (dto.actionType === 'broker_expense_verification') {
      const payload = dto.requestPayload;
      if (
        !payload ||
        String(payload.brokerExpenseId || '') !== String(dto.referenceId) ||
        !Number.isFinite(Number(payload.amount)) ||
        Number(payload.amount) <= 0
      ) {
        throw new BadRequestException('اعتماد التحقق من مصروف مخلص يتطلب ربط المصروف بالمرجع نفسه وسقف مبلغ موجب.');
      }
    }
    if (dto.actionType === 'sourcing_trip_expense') {
      const payload = dto.requestPayload;
      if (
        !payload ||
        String(payload.tripId || '') !== String(dto.referenceId) ||
        !Number.isFinite(Number(payload.amount)) ||
        Number(payload.amount) <= 0 ||
        !Number.isFinite(Number(payload.supplierId)) ||
        Number(payload.supplierId) <= 0
      ) {
        throw new BadRequestException(
          'اعتماد ترحيل مصروف رحلة يتطلب ربط الرحلة بالمرجع نفسه وسقف مبلغ موجباً ومورداً مستحقاً.',
        );
      }
    }
    return await this.db
      .insertInto('import_approval_requests')
      .values({
        tenant_id: tenantId,
        module: 'import',
        action_type: dto.actionType,
        reference_id: dto.referenceId,
        requested_by: userId,
        status: 'pending',
        request_payload: dto.requestPayload ? JSON.stringify(dto.requestPayload) : '{}',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listApprovalRequests(tenantId: string, status?: string) {
    let q = this.db.selectFrom('import_approval_requests').selectAll().where('tenant_id', '=', tenantId);
    if (status) q = q.where('status', '=', status);
    return await q.orderBy('created_at', 'desc').execute();
  }

  async decideApprovalRequest(tenantId: string, userId: number, requestId: string, dto: DecideApprovalRequestDto) {
    return await this.db.transaction().execute(async (trx) => {
      const req = await trx
        .selectFrom('import_approval_requests')
        .selectAll()
        .where('id', '=', requestId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // INV-SOLO-ADMIN-IMPORT-APPROVAL-OVERRIDE: a shop with only
      // ONE admin could never decide an import approval request they
      // created — the old ban refused the requester outright, so the
      // gated action (shipment, broker, trip-expense, payment
      // method, partner payout, project close) sat blocked forever
      // with no second admin to decide it. When the decider is an
      // admin/super_admin, the requester may decide alone — but
      // never silently: the override is stamped into the approval
      // row's rejection_reason (the row's only free-text audit
      // field, already the carrier for decision notes on both
      // decisions) with requester == decider, the decision, and
      // that no second approval is required
      // (INV-SECOND-MANAGER-PASSWORD-REMOVED); any supplied reason or
      // notes are preserved in front of the stamp. The decider's
      // role is read from the `users` row in this same transaction
      // — the decide path carries only userId, no auth context —
      // and the shared isSoloAdminOverride helper (created by P5,
      // reused by P6; no third copy) is consulted lazily, only
      // when a self-decision would otherwise be refused, so a
      // decision by a different admin costs no extra query and
      // behaves byte-identically. No second-manager approval is
      // ever required; a non-admin requester is still refused. The gate (verifyAndConsumeApprovalRequest) reads
      // only status / action_type / reference_id / request_payload,
      // never rejection_reason, so the stamp cannot change
      // consumption, and it survives it (the consume update
      // touches only status + decided_at).
      let soloOverride = false;
      if (req.requested_by === userId) {
        const decider = await trx
          .selectFrom('users')
          .select('role')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', userId)
          .where('is_active', '=', true)
          .executeTakeFirst();
        soloOverride = await isSoloAdminOverride(trx, tenantId, {
          userId,
          role: decider?.role,
        } as AuthContext);
        if (!soloOverride) {
          throw new BadRequestException(
            'مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز للمستخدم الذي أنشأ الطلب اعتماده بنفسه.',
          );
        }
      }

      if (req.status !== 'pending') {
        throw new BadRequestException('تم البت في هذا الطلب مسبقاً.');
      }

      const decisionNotes = dto.rejectionReason || dto.decisionNotes || dto.comments || null;
      return await trx
        .updateTable('import_approval_requests')
        .set({
          status: dto.decision,
          approved_by: userId,
          decided_at: new Date(),
          rejection_reason: soloOverride
            ? (decisionNotes ? `${decisionNotes} — ` : '') +
              `اعتماد منفرد بقرار إداري — صاحب الطلب ${userId} قرر طلبه بنفسه (${dto.decision})`
            : decisionNotes,
        })
        .where('id', '=', requestId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async listProjectProfitAttribution(tenantId: string, startDate: string | Date, endDate: string | Date) {
    // Attribution rows are report/display values: round them through
    // the canonical rounder at the tenant's book digits (never a
    // hardcoded toFixed(2) — the architecture guard dispositions
    // every toFixed(2) site in this file).
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const projects = await this.db
      .selectFrom('import_projects')
      .select(['id', 'project_no', 'title', 'status'])
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
    const start = typeof startDate === 'string' ? startDate : startDate.toISOString().slice(0, 10);
    const end = typeof endDate === 'string' ? endDate : endDate.toISOString().slice(0, 10);
    const rows: any[] = [];
    for (const p of projects) {
      const report = await this.generatePeriodProfitReport(tenantId, start, end, String(p.id));
      const shipments = await this.db
        .selectFrom('import_shipments')
        .select(['id', 'container_number', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', String(p.id))
        .orderBy('created_at', 'asc')
        .execute();
      const shipmentRows: any[] = [];
      for (const s of shipments) {
        const items = await this.db
          .selectFrom('import_shipment_items')
          .select(['received_quantity', 'quantity', 'landed_cost_egp'])
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', String(s.id))
          .execute();
        let receivedQuantity = 0;
        let landedCostEgp = 0;
        for (const it of items) {
          const qty = Number(it.received_quantity ?? it.quantity ?? 0);
          receivedQuantity += qty;
          landedCostEgp += qty * Number(it.landed_cost_egp || 0);
        }
        const allocs = await this.db
          .selectFrom('import_sale_allocations')
          .select(['quantity', 'unit_sale_price_egp', 'unit_cost_egp', 'allocation_type'])
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', String(s.id))
          .execute();
        let salesRevenueEgp = 0;
        let salesCostEgp = 0;
        for (const al of allocs) {
          const qty = Number(al.quantity || 0);
          const sign =
            al.allocation_type === 'return' ||
            al.allocation_type === 'cancellation' ||
            al.allocation_type === 'reversal'
              ? -1
              : 1;
          salesRevenueEgp += sign * qty * Number(al.unit_sale_price_egp || 0);
          salesCostEgp += sign * qty * Number(al.unit_cost_egp || 0);
        }
        shipmentRows.push({
          shipmentId: String(s.id),
          containerNumber: String(s.container_number || ''),
          status: String(s.status || ''),
          receivedQuantity: Number(receivedQuantity.toFixed(4)),
          landedCostEgp: roundMoney(landedCostEgp, digits),
          salesRevenueEgp: roundMoney(salesRevenueEgp, digits),
          salesCostEgp: roundMoney(salesCostEgp, digits),
        });
      }
      rows.push({
        ...report.data,
        projectId: String(p.id),
        projectNo: String(p.project_no || ''),
        title: String(p.title || ''),
        status: String(p.status || ''),
        shipments: shipmentRows,
      });
    }
    const total = await this.generatePeriodProfitReport(tenantId, start, end);
    return { startDate: start, endDate: end, projects: rows, total: total.data };
  }
}
