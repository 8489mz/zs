import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatLocalCalendarDay } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { CreateIpcInvoiceDto } from '../dto/contracting.dto';
import { computeIpc } from '../ipc-calculation.engine';
import { type BankGuarantee, checkIpcGuaranteeInterlocking } from '../guarantee-gateway.engine';

/**
 * ContractingIpcInvoicesService — slice C3 of the contracting split.
 * Pure move of 4 methods from ContractingService (§9 IPC invoice list &
 * detail (2) + §10 IPC invoice create & approve (2)). No behavior change:
 * the bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures for all 4 public methods. Deps: db + bound
 * getGuaranteesRaw from the facade (C13, 2 call sites — createInvoice,
 * approveInvoice; S8 precedent: same-name field, so the moved bodies stay
 * byte-identical). getInvoiceById is internal to this slice (3 call sites
 * from createInvoice/approveInvoice). The IPC journal-posting method
 * (postInvoiceJournalEntry, 469L) is C4, NOT here — the file's only 2
 * posting methods are C4, so no accountingPosting dep, no fallback. The
 * IPC amounts (VAT, retention, advance recovery) are computed by the
 * already-extracted computeIpc engine (imported helper, not moved).
 * Other slices never import this slice. No inline rounding sites travel
 * with the slice (toFixed2 0, inlineRound 0 — no allowlist entry). Date
 * handling travels verbatim: resolveBusinessDateKey 2x + formatLocalCalendarDay
 * 1x (tenant day); the 8 new Date() sites are created_at/updated_at server
 * stamps. No clock pin follows these methods (zero C3 names in all 5 clock
 * specs, ground-proven). No driving spec exists for any C3 method in the
 * critical chain (gap recorded for the merge coordinator — the e2e
 * simulation file holds real createInvoice/approveInvoice calls but nothing
 * wires it on this base; same class as C6/C9/C10); proof comes from the
 * critical chain + RED control + byte-identity.
 */

export interface ContractingIpcInvoicesDeps {
  db: Kysely<Database>;
  // Bound facade member (same name as the facade member, so the moved
  // bodies are byte-identical). getGuaranteesRaw lives in the C13
  // guarantees slice and is reached through the facade delegate.
  // Facade signature (L7340-7343): async getGuaranteesRaw(tenantId:
  // string, filters: { projectId?: string; subcontractId?: string;
  // status?: string } = {}): Promise<BankGuarantee[]>
  getGuaranteesRaw: (
    tenantId: string,
    filters?: { projectId?: string; subcontractId?: string; status?: string },
  ) => Promise<BankGuarantee[]>;
}

@Injectable()
export class ContractingIpcInvoicesService {
  private readonly db: Kysely<Database>;
  private readonly getGuaranteesRaw: (
    tenantId: string,
    filters?: { projectId?: string; subcontractId?: string; status?: string },
  ) => Promise<BankGuarantee[]>;

  constructor(deps: ContractingIpcInvoicesDeps) {
    this.db = deps.db;
    this.getGuaranteesRaw = deps.getGuaranteesRaw;
  }

  async getInvoices(auth: AuthContext, projectId: string, type: 'client' | 'subcontractor' = 'client') {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('ipc_type', '=', type)
      .orderBy('sequence_order', 'asc')
      .execute();
  }

  async getInvoiceById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const invoice = await this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!invoice) {
      throw new NotFoundException(`المستخلص برقم ${id} غير موجود`);
    }

    const items = await this.db
      .selectFrom('contracting_invoice_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('invoice_id', '=', id as any)
      .execute();

    const project = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', invoice.project_id)
      .executeTakeFirst();

    return {
      ...invoice,
      project,
      items,
    };
  }

  async createInvoice(auth: AuthContext, projectId: string, dto: CreateIpcInvoiceDto) {
    const { tenantId } = requireTenantScope(auth);

    const project = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId as any)
      .executeTakeFirst();

    if (!project) {
      throw new NotFoundException(`المشروع برقم ${projectId} غير موجود`);
    }

    // Determine sequence order & IPC number
    const ipcType = dto.ipcType || 'client';
    const countRes = await this.db
      .selectFrom('contracting_invoices')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('ipc_type', '=', ipcType)
      .executeTakeFirst();

    const seq = dto.sequenceOrder || (countRes?.count || 0) + 1;
    const prefix = ipcType === 'client' ? 'IPC' : 'SUB-IPC';
    const ipcNumber = `${prefix}-${project.code}-${String(seq).padStart(2, '0')}`;

    // Calculate totals across items
    let currentTotal = 0;
    let storedMaterialsTotal = 0;
    let previousTotal = 0;

    const processedItems = dto.items.map((item) => {
      const prevQty = Number(item.previousQty || 0);
      const currQty = Number(item.currentQty || 0);
      const storedQty = Number(item.storedMaterialsQty || 0);
      const cumQty = prevQty + currQty;
      const unitPrice = Number(item.unitPrice || 0);

      const currAmount = currQty * unitPrice;
      const prevAmount = prevQty * unitPrice;
      const storedAmount = storedQty * unitPrice;

      currentTotal += currAmount;
      storedMaterialsTotal += storedAmount;
      previousTotal += prevAmount;

      return {
        boq_item_id: item.boqItemId ? (item.boqItemId as any) : null,
        wir_id: item.wirId ? (item.wirId as any) : null,
        description: item.description.trim(),
        unit: item.unit || 'm3',
        unit_price: unitPrice,
        previous_qty: prevQty,
        current_qty: currQty,
        claimed_qty: item.claimedQty !== undefined ? Number(item.claimedQty) : currQty,
        certified_qty: item.certifiedQty !== undefined ? Number(item.certifiedQty) : currQty,
        stored_materials_qty: storedQty,
        cumulative_qty: cumQty,
        completion_percent: 0,
        current_total: currAmount,
        cumulative_total: prevAmount + currAmount + storedAmount,
        variance_reason: item.varianceReason || null,
        progress_stage: item.progressStage || null,
        stage_weight_pct: item.stageWeightPct !== undefined ? Number(item.stageWeightPct) : null,
        change_order_id: item.changeOrderId ? (item.changeOrderId as any) : null,
        notes: item.notes || null,
      };
    });

    const cumulativeAmount = previousTotal + currentTotal + storedMaterialsTotal;

    // Resolve Subcontract & Subcontractor details first
    let subId = dto.subcontractorId ? Number(dto.subcontractorId) : null;
    let subName = dto.subcontractorName || '';
    const subcontractId = dto.subcontractId ? Number(dto.subcontractId) : null;

    let subcontract: any = null;
    if (subcontractId) {
      subcontract = await this.db
        .selectFrom('contracting_subcontracts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', subcontractId as any)
        .executeTakeFirst();
      if (subcontract && !subId) {
        subId = Number(subcontract.subcontractor_id);
      }
    }

    if (subId && !subName) {
      const subc = await (this.db as any)
        .selectFrom('contracting_subcontractors')
        .select('name')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', subId)
        .executeTakeFirst();
      if (subc) {
        subName = subc.name;
      }
    }

    // Cumulative history from previous invoices
    let prevInvoicesQuery = this.db
      .selectFrom('contracting_invoices')
      .select([
        sql<number>`coalesce(sum(gross_work_done_amount), 0)::float`.as('total_gross_work_done'),
        sql<number>`coalesce(sum(advance_recovery_amount), 0)::float`.as('total_advance_recovered'),
        sql<number>`coalesce(sum(retention_held_amount), 0)::float`.as('total_retention_held'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', projectId as any)
      .where('ipc_type', '=', ipcType);

    if (subcontractId) {
      prevInvoicesQuery = prevInvoicesQuery.where('subcontract_id', '=', subcontractId as any);
    } else if (subId) {
      prevInvoicesQuery = prevInvoicesQuery.where('subcontractor_id', '=', subId);
    }

    const prevAgg = await prevInvoicesQuery.executeTakeFirst();
    const previousGrossWorkDoneFromDb = Number(prevAgg?.total_gross_work_done || 0);
    const previousAdvanceRecovered = Number(prevAgg?.total_advance_recovered || 0);
    const previousRetentionHeld = Number(prevAgg?.total_retention_held || 0);

    // Auto carry-forward negative debit balance from preceding invoice if not explicitly passed
    let carriedForwardDebitIn = Number(dto.carriedForwardDebitIn || 0);
    if (carriedForwardDebitIn === 0) {
      let lastInvoiceQuery = this.db
        .selectFrom('contracting_invoices')
        .select(['carried_forward_debit_out'])
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', projectId as any)
        .where('ipc_type', '=', ipcType)
        .orderBy('created_at', 'desc')
        .limit(1);

      if (subcontractId) {
        lastInvoiceQuery = lastInvoiceQuery.where('subcontract_id', '=', subcontractId as any);
      } else if (subId) {
        lastInvoiceQuery = lastInvoiceQuery.where('subcontractor_id', '=', subId);
      }
      const lastInv = await lastInvoiceQuery.executeTakeFirst();
      if (lastInv && Number(lastInv.carried_forward_debit_out) > 0) {
        carriedForwardDebitIn = Number(lastInv.carried_forward_debit_out);
      }
    }

    // =========================================================================
    // Standard 4-Layer IPC Calculation Engine (FIDIC / MRICS Compliant)
    // =========================================================================

    // Layer 1: Gross Certified Work Inputs
    const grossWorkDone = currentTotal; // GWD
    const escalationAmount = Number(dto.escalationAmount || 0);
    const mosAdded = Number(dto.mosAddedAmount || (storedMaterialsTotal > 0 ? storedMaterialsTotal : 0));
    const mosReleased = Number(dto.mosReleasedAmount || 0);

    // Layer 2: Contractual Holdbacks Parameters
    let contractValue = 0;
    let advanceTotal = 0;
    let recoveryStartPct = 10;
    let recoveryEndPct = 80;
    let retentionRate = 0.05;
    let retentionCap = 0;

    if (ipcType === 'subcontractor' && subcontract) {
      contractValue = Number(subcontract.total_amount || 0);
      advanceTotal = Number(subcontract.advance_amount || contractValue * (Number(subcontract.advance_pct || 0) / 100));
      recoveryStartPct = Number(subcontract.advance_recovery_start_pct ?? 10);
      recoveryEndPct = Number(subcontract.advance_recovery_end_pct ?? 80);
      retentionRate =
        dto.retentionPercent !== undefined
          ? Number(dto.retentionPercent) / 100
          : Number(subcontract.retention_percent ?? 5) / 100;
      if (Number(subcontract.retention_limit_pct) > 0) {
        retentionCap = (contractValue * Number(subcontract.retention_limit_pct)) / 100;
      } else {
        retentionCap = contractValue * retentionRate;
      }
    } else {
      contractValue = Number(project.contract_value || 0);
      advanceTotal = Number(project.down_payment_amount || 0);
      recoveryStartPct = 10;
      recoveryEndPct = 80;
      retentionRate =
        dto.retentionPercent !== undefined
          ? Number(dto.retentionPercent) / 100
          : Number(project.retention_percent ?? 5) / 100;
      retentionCap = Number((project as any).retention_limit || contractValue * retentionRate);
    }

    // Execute Central FIDIC 4-Layer IPC Calculation Engine (Single Source of Truth)
    const ipcResult = computeIpc(
      {
        contractValue,
        advanceTotal,
        advanceRecoveryStartPct: recoveryStartPct,
        advanceRecoveryEndPct: recoveryEndPct,
        retentionRate,
        retentionCap,
        ldCapPct: subcontract ? Number(subcontract.ld_cap_pct || 10) : 10,
      },
      {
        previousGrossWorkDone: previousGrossWorkDoneFromDb,
        previousAdvanceRecovered,
        previousRetentionHeld,
        carriedForwardDebitIn,
      },
      {
        grossWorkDone,
        escalationAmount,
        mosAdded,
        mosReleased,
        vatAmount: Number(dto.vatAmount || 0),
      },
      {
        advanceRecoveryOverride: dto.advanceRecoveryOverride,
        advanceRecoveryPercent:
          dto.advanceRecoveryPercent !== undefined ? Number(dto.advanceRecoveryPercent) : undefined,
        backchargeAmount: dto.backchargeAmount !== undefined ? Number(dto.backchargeAmount) : undefined,
        ldAmount: dto.ldAmount !== undefined ? Number(dto.ldAmount) : undefined,
        materialExcessAmount: dto.materialExcessAmount !== undefined ? Number(dto.materialExcessAmount) : undefined,
        sharedResourceAmount: dto.sharedResourceAmount !== undefined ? Number(dto.sharedResourceAmount) : undefined,
        directPaymentAmount: dto.directPaymentAmount !== undefined ? Number(dto.directPaymentAmount) : undefined,
        socialInsuranceAmount: dto.socialInsuranceAmount !== undefined ? Number(dto.socialInsuranceAmount) : undefined,
        whtAmount: dto.whtAmount !== undefined ? Number(dto.whtAmount) : undefined,
        otherDeductions: dto.otherDeductions !== undefined ? Number(dto.otherDeductions) : undefined,
        itemizedDeductions: dto.itemizedDeductions,
      },
    );

    // IPC GUARANTEE INTERLOCKING ENFORCEMENT:
    // If unrecovered advance balance exists on this contract/project, check guarantee validity
    const unrecoveredAdvanceBefore = Math.max(0, advanceTotal - previousAdvanceRecovered);
    if (unrecoveredAdvanceBefore > 0) {
      const activeGuarantees = await this.getGuaranteesRaw(tenantId, {
        projectId: projectId ? String(projectId) : undefined,
        subcontractId: subcontractId ? String(subcontractId) : undefined,
      });
      const interlocking = checkIpcGuaranteeInterlocking({
        subcontractId: subcontractId ? String(subcontractId) : undefined,
        projectId: String(projectId),
        unrecoveredAdvanceBalance: unrecoveredAdvanceBefore,
        invoiceDate: dto.periodEnd || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
        activeGuarantees,
      });
      if (interlocking.isBlocked) {
        throw new BadRequestException(interlocking.blockReason);
      }
    }

    // Insert Invoice Header with Phase 0 decomposed fields
    const [invoice] = await this.db
      .insertInto('contracting_invoices')
      .values({
        tenant_id: tenantId,
        project_id: projectId as any,
        ipc_number: ipcNumber,
        ipc_type: ipcType,
        subcontractor_id: subId,
        subcontractor_name: subName,
        subcontract_id: subcontractId as any,
        sequence_order: seq,
        period_start: dto.periodStart || null,
        period_end: dto.periodEnd || null,
        previous_amount: previousTotal,
        current_amount: currentTotal,
        stored_materials_amount: storedMaterialsTotal,
        cumulative_amount: cumulativeAmount,
        advance_recovery_amount: ipcResult.advanceRecoveryAmount,
        retention_held_amount: ipcResult.retentionHeldAmount,
        other_deductions: ipcResult.otherDeductions,
        gross_work_done_amount: grossWorkDone,
        escalation_amount: escalationAmount,
        mos_added_amount: mosAdded,
        mos_released_amount: mosReleased,
        mos_balance_amount: ipcResult.mosBalance,
        backcharge_amount: ipcResult.backchargeAmount,
        ld_amount: ipcResult.ldAmount,
        material_excess_amount: ipcResult.materialExcessAmount,
        shared_resource_amount: ipcResult.sharedResourceAmount,
        direct_payment_amount: ipcResult.directPaymentAmount,
        carried_forward_debit_in: carriedForwardDebitIn,
        carried_forward_debit_out: ipcResult.carriedForwardDebitOut,
        taxable_base_amount: ipcResult.taxableBaseAmount,
        vat_amount: ipcResult.vatAmount,
        wht_amount: ipcResult.whtAmount,
        social_insurance_amount: ipcResult.socialInsuranceAmount,
        claimed_amount: Number(dto.claimedAmount || currentTotal),
        certified_amount: currentTotal,
        certification_due_date: dto.certificationDueDate || null,
        payment_due_date: dto.paymentDueDate || null,
        calc_engine_version: 'v2_phased_4layer',
        calc_inputs_snapshot: {
          ...ipcResult.calcInputsSnapshot,
          calculatedAt: new Date().toISOString(),
          engineVersion: 'v2_phased_4layer',
        },
        net_payable: ipcResult.netPayable,
        status: 'draft',
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    // Insert Invoice Line Items with WIR and stage tracking
    if (processedItems.length > 0) {
      await this.db
        .insertInto('contracting_invoice_items')
        .values(
          processedItems.map((pi) => ({
            ...pi,
            tenant_id: tenantId,
            invoice_id: invoice.id,
          })),
        )
        .execute();
    }

    // Insert Itemized Deductions if provided
    if (dto.itemizedDeductions && dto.itemizedDeductions.length > 0) {
      await (this.db as any)
        .insertInto('contracting_ipc_deductions')
        .values(
          dto.itemizedDeductions.map((ded) => ({
            tenant_id: tenantId,
            invoice_id: invoice.id,
            deduction_type: ded.deductionType,
            source_table: ded.sourceTable || null,
            source_id: ded.sourceId || null,
            amount: Number(ded.amount || 0),
            vat_treatment: ded.vatTreatment || 'none',
            debit_note_ref: ded.debitNoteRef || null,
            notice_ref: ded.noticeRef || null,
            approved_by: auth.userId ? String(auth.userId) : null,
            approved_at: new Date(),
            description: ded.description || '',
          })),
        )
        .execute();
    }

    return this.getInvoiceById(auth, invoice.id);
  }

  async approveInvoice(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const invoice = await this.db
      .selectFrom('contracting_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!invoice) {
      throw new NotFoundException(`المستخلص برقم ${id} غير موجود`);
    }

    if (invoice.status === 'approved' || invoice.status === 'paid') {
      return this.getInvoiceById(auth, id);
    }

    // IPC GUARANTEE INTERLOCKING ENFORCEMENT:
    if (invoice.ipc_type === 'subcontractor' && invoice.subcontract_id) {
      const subcontract = await (this.db as any)
        .selectFrom('contracting_subcontracts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', invoice.subcontract_id as any)
        .executeTakeFirst();

      if (subcontract) {
        const advTotal = Number(subcontract.advance_amount || 0);
        const priorRecoveredRow = await (this.db as any)
          .selectFrom('contracting_invoices')
          .select(sql<number>`COALESCE(SUM(advance_recovery_amount), 0)::numeric`.as('recovered'))
          .where('tenant_id', '=', tenantId)
          .where('subcontract_id', '=', invoice.subcontract_id as any)
          .where('status', 'in', ['approved', 'paid'])
          .where('id', '!=', invoice.id as any)
          .executeTakeFirst();
        const priorRecovered = Number(priorRecoveredRow?.recovered || 0);
        const unrecBalance = Math.max(0, advTotal - priorRecovered);
        if (unrecBalance > 0) {
          const activeGuarantees = await this.getGuaranteesRaw(tenantId, {
            subcontractId: String(invoice.subcontract_id),
            projectId: String(invoice.project_id),
          });
          const interlocking = checkIpcGuaranteeInterlocking({
            subcontractId: String(invoice.subcontract_id),
            projectId: String(invoice.project_id),
            unrecoveredAdvanceBalance: unrecBalance,
            invoiceDate: invoice.period_end
              ? typeof invoice.period_end === 'string'
                ? invoice.period_end
                : formatLocalCalendarDay(new Date(invoice.period_end))
              : await resolveBusinessDateKey(this.db, tenantId, new Date()),
            activeGuarantees,
          });
          if (interlocking.isBlocked) {
            throw new BadRequestException(interlocking.blockReason);
          }
        }
      }
    }

    // 1. Mark as approved
    const [approved] = await this.db
      .updateTable('contracting_invoices')
      .set({
        status: 'approved',
        approved_by: auth.username || 'المعتمد',
        approved_at: new Date(),
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    // 2. Update BOQ items executed_qty
    const items = await this.db
      .selectFrom('contracting_invoice_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('invoice_id', '=', id as any)
      .execute();

    for (const item of items) {
      if (item.boq_item_id) {
        await this.db
          .updateTable('contracting_boq_items')
          .set({
            executed_qty: item.cumulative_qty,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', item.boq_item_id as any)
          .execute();
      }
    }

    // 3. Update Project cumulative retentions and recovered down payments
    const project = await this.db
      .selectFrom('contracting_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', invoice.project_id)
      .executeTakeFirst();

    if (project && invoice.ipc_type === 'client') {
      const totalRetention = Number(project.retention_total_held) + Number(invoice.retention_held_amount);
      const totalRecovered = Number(project.down_payment_recovered) + Number(invoice.advance_recovery_amount);

      await this.db
        .updateTable('contracting_projects')
        .set({
          retention_total_held: totalRetention,
          down_payment_recovered: totalRecovered,
          status: project.status === 'planning' ? 'active' : project.status,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', invoice.project_id)
        .execute();
    }

    return this.getInvoiceById(auth, id);
  }
}
