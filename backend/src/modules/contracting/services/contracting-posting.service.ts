import { randomUUID } from 'node:crypto';
import { lockAccountingPeriod } from '../../accounting/accounting-period-lock';
import { ensureDomainSupplier } from '../../accounting/partner-subledger';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { CreateSubcontractorPaymentDto } from '../dto/contracting.dto';
import { assertAdvancePaymentGate, type BankGuarantee } from '../guarantee-gateway.engine';

/**
 * ContractingPostingService — slice C4 of the contracting split.
 * Pure move of 2 methods from ContractingService (the file's ONLY 2
 * journal methods: postInvoiceJournalEntry 469L + createSubcontractorPayment
 * 159L). No behavior change: the bodies are byte-identical; the facade
 * keeps thin delegates with the same names and signatures for both public
 * methods. This slice takes db + accountingPosting (REQUIRED — prep §3.1;
 * C4 is the ONLY slice that takes it, because the postings live here; it
 * is passed through as received, no fallback is invented) + 1 bound dep
 * (import-sales S3 pattern, precise type): getGuaranteesRaw (C13, x1 —
 * createSubcontractorPayment's active-guarantee check). It has no FX sites
 * (resolveFxRate 0 in the whole file) and moves toFixed2 0 + inlineRound 0
 * (no guard-file change; facade stays 3/24). Clock: no pin follows C4
 * methods (zero C4 names in all 5 clock specs); date sites travel
 * verbatim (getTenantTimezone 1, resolveBusinessDateKey 3, the L1477
 * UTC-slice site, new Date() 6 server stamps; §8 holds — 18
 * getTenantTimezone hits remain in the facade after C4). The e2e
 * simulation drives postInvoiceJournalEntry (:406/:475); the controller
 * drives both (:254, :329-333). lockAccountingPeriod +
 * ensureDomainSupplier travel with C4 only (prep §7.5).
 */

export interface ContractingPostingDeps {
  db: Kysely<Database>;
  // accountingPosting is a REQUIRED constructor dep of the facade (no
  // @Optional, no fallback expression anywhere in the file — prep §3.1).
  // C4 is the ONLY slice that takes it, because the file's only 2 journal
  // methods live here. It is passed through as received; no fallback is
  // invented. Both methods call resolveSystemAccountByCode +
  // postDomainJournal on it (6 call sites in the moved text).
  accountingPosting: AccountingPostingService;
  // Bound facade member (same name as the facade member, so the moved
  // body stays byte-identical): getGuaranteesRaw lives in the C13 slice
  // (ContractingGuaranteesService). Called here by
  // createSubcontractorPayment (active-guarantee check before the advance
  // payment gate). Signature: getGuaranteesRaw(tenantId: string, filters?:
  // { projectId?: string; subcontractId?: string; status?: string }) =>
  // Promise<BankGuarantee[]>.
  getGuaranteesRaw: (tenantId: string, filters?: { projectId?: string; subcontractId?: string; status?: string }) => Promise<BankGuarantee[]>;
}

@Injectable()
export class ContractingPostingService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly getGuaranteesRaw: (tenantId: string, filters?: { projectId?: string; subcontractId?: string; status?: string }) => Promise<BankGuarantee[]>;

  constructor(deps: ContractingPostingDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.getGuaranteesRaw = deps.getGuaranteesRaw;
  }

  async postInvoiceJournalEntry(auth: AuthContext, invoiceId: string) {
    const { tenantId, accountId } = requireTenantScope(auth);
    // Retention release falls due one calendar year after the tenant-local business day (not a UTC-sliced instant + 365d).
    const releaseBaseDay = await resolveBusinessDateKey(this.db, tenantId, new Date());
    const releaseDueDate = new Date(`${releaseBaseDay}T00:00:00.000Z`);
    releaseDueDate.setUTCDate(releaseDueDate.getUTCDate() + 365);
    const releaseDueKey = releaseDueDate.toISOString().slice(0, 10);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const invoice = await trx
        .selectFrom('contracting_invoices')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', invoiceId as any)
        .forUpdate().executeTakeFirst();

      if (!invoice) {
        throw new NotFoundException(`المستخلص برقم ${invoiceId} غير موجود`);
      }

      if (invoice.journal_entry_id) {
        const existingJe = await (trx as any)
          .selectFrom('journal_entries')
          .select(['id', 'entry_no'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', invoice.journal_entry_id)
          .executeTakeFirst();
        if (existingJe) {
          return {
            success: true,
            journalEntryId: Number(existingJe.id),
            entryNo: existingJe.entry_no,
            message: 'تم ترحيل هذا المستخلص مسبقاً',
          };
        }
      }

      const project = await trx
        .selectFrom('contracting_projects')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', invoice.project_id)
        .executeTakeFirst();

      if (!project) {
        throw new NotFoundException('المشروع التابع له المستخلص غير موجود');
      }

      // Contractual retention rate for the ledger row written below. Taken from the same
      // source the IPC calculation uses (the subcontract for a subcontractor IPC, the
      // project for a client one) rather than letting the column default to 5% and quietly
      // describe a holding that was taken at a different rate.
      let ledgerRetentionPercent = Number(project.retention_percent ?? 5);
      if (invoice.subcontract_id) {
        const subcontractForRetention = await (trx as any)
          .selectFrom('contracting_subcontracts')
          .select('retention_percent')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', invoice.subcontract_id)
          .executeTakeFirst();
        if (subcontractForRetention?.retention_percent != null) {
          ledgerRetentionPercent = Number(subcontractForRetention.retention_percent);
        }
      }

      // Amounts
      const currentWorkAndStored = Number(invoice.current_amount || 0) + Number(invoice.stored_materials_amount || 0);
      const advanceRecovery = Number(invoice.advance_recovery_amount || 0);
      const retentionHeld = Number(invoice.retention_held_amount || 0);
      const otherDeductions =
        Number(invoice.other_deductions || 0) +
        Number(invoice.ld_amount || 0) +
        Number(invoice.backcharge_amount || 0) +
        Number(invoice.material_excess_amount || 0) +
        Number(invoice.shared_resource_amount || 0) +
        Number(invoice.direct_payment_amount || 0);
      const netPayable = Number(invoice.net_payable || 0);

      if (currentWorkAndStored <= 0 && netPayable <= 0) {
        throw new BadRequestException('لا يمكن إنشاء قيد محاسبي لمستخلص بقيمة صفرية');
      }

      const isSubcontractor = invoice.ipc_type === 'subcontractor';
      const supplierPartnerId = isSubcontractor && invoice.subcontractor_id
        ? await ensureDomainSupplier(trx, tenantId, 'subcontractor', invoice.subcontractor_id, invoice.subcontractor_name || 'مقاول باطن') : null;

      // Resolve accounts based on invoice type
      let primaryAccountId: number | null = null;
      let contraAccountId: number | null = null;
      let advanceAccountId: number | null = null;
      let retentionAccountId: number | null = null;

      if (isSubcontractor) {
        // 1. Subcontracting Cost / Work in Progress (Expense)
        let expAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', 'in', ['5100', '5200', '5000', '5120'])
          .where('is_active', '=', true)
          .orderBy('code', 'asc')
          .executeTakeFirst();
        if (!expAccount) {
          expAccount = await (trx as any)
            .selectFrom('accounting_accounts')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('account_type', '=', 'expense')
            .where('is_active', '=', true)
            .executeTakeFirst();
        }

        // 2. Accounts Payable (Suppliers / Subcontractors)
        let apAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', '=', '2110')
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!apAccount) {
          apAccount = await (trx as any)
            .selectFrom('accounting_accounts')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('account_type', '=', 'liability')
            .where('is_payable', '=', true)
            .where('is_active', '=', true)
            .executeTakeFirst();
        }

        const subRetAccount = { id: await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '2160') };
        const subAdvAccount = { id: await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '1165') };

        primaryAccountId = expAccount?.id ? Number(expAccount.id) : null;
        contraAccountId = apAccount?.id ? Number(apAccount.id) : null;
        retentionAccountId = subRetAccount?.id ? Number(subRetAccount.id) : contraAccountId;
        advanceAccountId = subAdvAccount?.id ? Number(subAdvAccount.id) : contraAccountId;

        if (!primaryAccountId || !contraAccountId) {
          throw new BadRequestException('تعذر تحديد حسابات المصروفات أو مقاولي الباطن في شجرة الحسابات');
        }
      } else {
        // 1. Accounts Receivable (Clients)
        let arAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', '=', '1130')
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!arAccount) {
          arAccount = await (trx as any)
            .selectFrom('accounting_accounts')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('account_type', '=', 'asset')
            .where('is_receivable', '=', true)
            .where('is_active', '=', true)
            .executeTakeFirst();
        }

        // 2. Contracting Revenue
        const revAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', 'in', ['4200', '4100', '4000'])
          .where('is_active', '=', true)
          .orderBy('code', 'asc')
          .executeTakeFirst();

        // 3. Advances from customers
        let advanceAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', '=', '2150')
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!advanceAccount) {
          advanceAccount = await (trx as any)
            .selectFrom('accounting_accounts')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('code', '=', '2100')
            .where('is_active', '=', true)
            .executeTakeFirst();
        }

        // 4. Retentions Receivable
        const retentionAccount = await (trx as any)
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', 'in', ['1135', '1180', '1160'])
          .where('is_active', '=', true)
          .executeTakeFirst();

        primaryAccountId = revAccount?.id ? Number(revAccount.id) : null;
        contraAccountId = arAccount?.id ? Number(arAccount.id) : null;
        advanceAccountId = advanceAccount?.id ? Number(advanceAccount.id) : contraAccountId;
        retentionAccountId = retentionAccount?.id ? Number(retentionAccount.id) : contraAccountId;

        if (!primaryAccountId || !contraAccountId) {
          throw new BadRequestException('تعذر تحديد الحسابات المحاسبية الأساسية (العملاء أو الإيرادات) في شجرة الحسابات');
        }
      }

      const inserted = await (async () => {
        const description = isSubcontractor
          ? `إثبات مستخلص مقاول باطن رقم ${invoice.ipc_number} - ${invoice.subcontractor_name || 'مقاول باطن'} - مشروع ${project.name}`
          : `إثبات استحقاق مستخلص أعمال رقم ${invoice.ipc_number} - مشروع ${project.name}`;

        const lines: any[] = [];

        if (isSubcontractor) {
          // Subcontractor Journal Entry:
          // Line 1: Debit Subcontracting Expense (WIP)
          lines.push({
            accountId: primaryAccountId,
            costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
            branchId: null,
            locationId: null,
            description: `أعمال وتشوينات مستخلص مقاول باطن ${invoice.ipc_number}`,
            debit: currentWorkAndStored,
            credit: 0,
            partnerType: 'supplier',
            partnerId: supplierPartnerId,
          });

          // Line 2: Credit Advance Recovery
          if (advanceRecovery > 0) {
            lines.push({
              accountId: advanceAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `استرداد دفعة مقدمة مقاول باطن ${invoice.ipc_number}`,
              debit: 0,
              credit: advanceRecovery,
              partnerType: 'supplier',
              partnerId: supplierPartnerId,
            });
          }

          // Line 3: Credit Retention Held (Liability to subcontractor)
          if (retentionHeld > 0) {
            lines.push({
              accountId: retentionAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `تأمين أعمال محتجز (حسن تنفيذ) لمقاول الباطن ${invoice.ipc_number}`,
              debit: 0,
              credit: retentionHeld,
              partnerType: 'supplier',
              partnerId: supplierPartnerId,
            });

            // Auto-insert into retention ledger.
            // Column names here must match contracting_retention_records exactly — the
            // enclosing transaction runs as `trx: any`, so nothing type-checks this insert
            // (O16). It previously wrote guarantee_type / reference_number / due_date, none
            // of which exist on that table, so Postgres rejected it with 42703 and the whole
            // posting transaction rolled back. See createRetentionRecord for the real shape.
            await trx.insertInto('contracting_retention_records').values({
              tenant_id: tenantId,
              project_id: invoice.project_id,
              subcontract_id: invoice.subcontract_id || null,
              party_type: 'subcontractor',
              party_id: invoice.subcontractor_id || null,
              party_name: invoice.subcontractor_name || 'مقاول باطن',
              held_amount: retentionHeld,
              released_amount: 0,
              retention_percent: ledgerRetentionPercent,
              ipc_invoice_id: invoice.id,
              guarantee_certificate_ref: invoice.ipc_number,
              release_due_date: releaseDueKey,
              status: 'held',
              notes: `استقطاع ضمان حسن تنفيذ لمقاول الباطن من مستخلص ${invoice.ipc_number}`,
            }).execute();
          }

          // Line 4: Credit Other Deductions
          if (otherDeductions > 0) {
            lines.push({
              accountId: primaryAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `استقطاعات وجزاءات مستخلص مقاول باطن ${invoice.ipc_number}`,
              debit: 0,
              credit: otherDeductions,
              partnerType: 'supplier',
              partnerId: supplierPartnerId,
            });
          }

          // Line 5: Credit Accounts Payable (Net Payable to Subcontractor)
          if (netPayable > 0) {
            lines.push({
              accountId: contraAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `صافي المستحق لمقاول الباطن مستخلص ${invoice.ipc_number}`,
              debit: 0,
              credit: netPayable,
              partnerType: 'supplier',
              partnerId: supplierPartnerId,
            });
          }
        } else {
          // Client Journal Entry:
          // Line 1: Credit Contracting Revenue
          lines.push({
            accountId: primaryAccountId,
            costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
            branchId: null,
            locationId: null,
            description: `إيرادات أعمال وتشوينات مستخلص ${invoice.ipc_number}`,
            debit: 0,
            credit: currentWorkAndStored,
            partnerType: 'customer',
            partnerId: project.client_id ? Number(project.client_id) : null,
          });

          // Line 2: Debit Customer Advances (Recovery)
          if (advanceRecovery > 0) {
            lines.push({
              accountId: advanceAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `استرداد دفعة مقدمة مستخلص ${invoice.ipc_number}`,
              debit: advanceRecovery,
              credit: 0,
              partnerType: 'customer',
              partnerId: project.client_id ? Number(project.client_id) : null,
            });
          }

          // Line 3: Debit Retentions Held (Asset)
          if (retentionHeld > 0) {
            lines.push({
              accountId: retentionAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `تأمين أعمال محتجز (حسن تنفيذ) مستخلص ${invoice.ipc_number}`,
              debit: retentionHeld,
              credit: 0,
              partnerType: 'customer',
              partnerId: project.client_id ? Number(project.client_id) : null,
            });

            // Auto-insert into retention ledger for client — same schema mismatch as the
            // subcontractor branch above, and the same consequence: every client IPC that
            // held retention failed to post.
            await trx.insertInto('contracting_retention_records').values({
              tenant_id: tenantId,
              project_id: invoice.project_id,
              subcontract_id: null,
              party_type: 'client',
              party_id: project.client_id || null,
              party_name: project.client_name || 'المالك',
              held_amount: retentionHeld,
              released_amount: 0,
              retention_percent: Number(project.retention_percent ?? 5),
              ipc_invoice_id: invoice.id,
              guarantee_certificate_ref: invoice.ipc_number,
              release_due_date: releaseDueKey,
              status: 'held',
              notes: `استقطاع ضمان حسن تنفيذ على المالك من مستخلص ${invoice.ipc_number}`,
            }).execute();
          }

          // Line 4: Debit Other Deductions
          if (otherDeductions > 0) {
            let deductionAccId = contraAccountId;
            const expAccount = await (trx as any)
              .selectFrom('accounting_accounts')
              .select('id')
              .where('tenant_id', '=', tenantId)
              .where('code', 'in', ['5290', '5200', '5100', '5000'])
              .where('is_active', '=', true)
              .orderBy('code', 'desc')
              .executeTakeFirst();
            if (expAccount?.id) {
              deductionAccId = Number(expAccount.id);
            }

            lines.push({
              accountId: deductionAccId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `استقطاعات وجزاءات وغرامات تأخير مستخلص ${invoice.ipc_number}`,
              debit: otherDeductions,
              credit: 0,
              partnerType: 'customer',
              partnerId: project.client_id ? Number(project.client_id) : null,
            });
          }

          // Line 5: Debit Accounts Receivable (Net Payable)
          if (netPayable > 0) {
            lines.push({
              accountId: contraAccountId,
              costCenterId: project.cost_center_id ? Number(project.cost_center_id) : null,
              branchId: null,
              locationId: null,
              description: `صافي المستحق على العميل مستخلص ${invoice.ipc_number}`,
              debit: netPayable,
              credit: 0,
              partnerType: 'customer',
              partnerId: project.client_id ? Number(project.client_id) : null,
            });
          }
        }

        // Posted through the accounting engine, not by hand. This path used to insert the
        // header and lines itself with a COUNT(*)+1 entry number, which skipped all three
        // things section 2.2 says only this engine provides: the balance guard, the
        // period-lock check, and collision-free numbering.
        const journalEntryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: isSubcontractor ? 'contracting_subcontract_ipc' : 'contracting_ipc',
          sourceId: Number(invoice.id),
          tenantId,
          accountId,
          entryDate: invoice.period_end ? new Date(invoice.period_end) : new Date(),
          description,
          createdBy: auth.userId ?? null,
          lines,
        });

        // Update invoice with journal_entry_id and ensure status is approved
        await trx
          .updateTable('contracting_invoices')
          .set({
            journal_entry_id: journalEntryId,
            status: 'approved',
            approved_by: invoice.approved_by || auth.username || 'المعتمد',
            approved_at: invoice.approved_at || new Date(),
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', invoice.id)
          .execute();

        return journalEntryId;
      })();

      const postedEntry = await (trx as any)
        .selectFrom('journal_entries')
        .select(['id', 'entry_no'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', inserted)
        .executeTakeFirst();

      return {
        success: true,
        journalEntryId: Number(inserted),
        entryNo: postedEntry?.entry_no ?? null,
        message: 'تم ترحيل القيد المحاسبي بنجاح',
      };
    });
  }

  async createSubcontractorPayment(auth: AuthContext, dto: CreateSubcontractorPaymentDto) {
    const { tenantId } = requireTenantScope(auth);
    const businessTz = await getTenantTimezone(this.db, tenantId);
    return this.db.transaction().execute(async trx => {
      await lockAccountingPeriod(trx, tenantId);
      if (!dto.requestKey || !/^[A-Za-z0-9_-]{16,128}$/.test(dto.requestKey)) throw new BadRequestException('يلزم مفتاح طلب ثابت لمنع تكرار الدفعة.');
      const fingerprint = JSON.stringify([dto.subcontractorId, dto.projectId || null, dto.subcontractId || null, dto.invoiceId || null,
        Number(dto.amount), dto.paymentDate || null, dto.paymentMethod || 'bank_transfer', dto.paymentCategory || null,
        Boolean(dto.isAdvancePayment), dto.referenceNumber?.trim() || null, dto.notes?.trim() || null]);
      const presentPayment = (payment: any) => ({ id: Number(payment.id), paymentNumber: payment.payment_number,
        paymentDate: payment.payment_date, amount: Number(payment.amount), paymentMethod: payment.payment_method,
        paymentCategory: payment.payment_category, referenceNumber: payment.reference_number });
      const priorPayment = await (trx as any).selectFrom('contracting_subcontractor_payments').selectAll()
        .where('tenant_id', '=', tenantId).where('request_key', '=', dto.requestKey).executeTakeFirst();
      if (priorPayment) {
        if (priorPayment.request_fingerprint !== fingerprint) throw new ConflictException('مفتاح الدفعة استُخدم ببيانات مختلفة.');
        return presentPayment(priorPayment);
      }
      if (dto.paymentMethod === 'check') throw new BadRequestException('تسجل أوراق الدفع من محفظة الشيكات؛ لا يجوز خصم البنك قبل صرفها.');
      const userId = (auth as any).userId || (auth as any).user?.id || null;
      if (!dto.subcontractorId) {
        throw new BadRequestException('يجب تحديد مقاول الباطن');
      }
      const amount = Number(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
        throw new BadRequestException('مبلغ الدفعة يجب أن يكون أكبر من الصفر');
      }

      const party = await trx.selectFrom('contracting_subcontractors').select(['id', 'name']).where('tenant_id', '=', tenantId).where('id', '=', dto.subcontractorId).forUpdate().executeTakeFirstOrThrow();
      const supplierId = await ensureDomainSupplier(trx, tenantId, 'subcontractor', party.id, party.name);

      // Fetch subcontract details if subcontractId is specified
      let subcontract: any = null;
      if (dto.subcontractId) {
        subcontract = await (trx as any)
          .selectFrom('contracting_subcontracts')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', String(dto.subcontractId))
          .executeTakeFirst();
      }

      if (dto.subcontractId && (!subcontract || Number(subcontract.subcontractor_id) !== Number(dto.subcontractorId) ||
        (dto.projectId && String(subcontract.project_id) !== String(dto.projectId)))) throw new BadRequestException('العقد لا يطابق المقاول أو المشروع.');
      const projectId = dto.projectId || subcontract?.project_id;
      if (projectId && !await trx.selectFrom('contracting_projects').select('id').where('tenant_id', '=', tenantId).where('id', '=', String(projectId)).executeTakeFirst()) throw new BadRequestException('المشروع غير موجود في المنشأة.');
      if (dto.invoiceId) {
        const invoice = await (trx as any).selectFrom('contracting_invoices').selectAll().where('tenant_id', '=', tenantId).where('id', '=', String(dto.invoiceId)).executeTakeFirst();
        if (!invoice || invoice.ipc_type !== 'subcontractor' || !invoice.journal_entry_id || Number(invoice.subcontractor_id) !== Number(dto.subcontractorId) || (projectId && String(invoice.project_id) !== String(projectId))) throw new BadRequestException('المستخلص لا يطابق المقاول أو المشروع.');
      }

      // Calculate prior advance disbursements against this subcontract or project (Invariant G1-C)
      let priorAdvanceDisbursed = 0;
      if (dto.subcontractId) {
        const priorRes = await (trx as any)
          .selectFrom('contracting_subcontractor_payments')
          .select(sql<number>`COALESCE(SUM(amount), 0)::numeric`.as('total'))
          .where('tenant_id', '=', tenantId)
          .where('subcontract_id', '=', String(dto.subcontractId))
          .where('payment_category', '=', 'advance')
          .where('status', '!=', 'cancelled')
          .executeTakeFirst();
        priorAdvanceDisbursed = Number(priorRes?.total || 0);
      } else if (dto.projectId) {
        const priorRes = await (trx as any)
          .selectFrom('contracting_subcontractor_payments')
          .select(sql<number>`COALESCE(SUM(amount), 0)::numeric`.as('total'))
          .where('tenant_id', '=', tenantId)
          .where('project_id', '=', String(dto.projectId))
          .where('payment_category', '=', 'advance')
          .where('status', '!=', 'cancelled')
          .executeTakeFirst();
        priorAdvanceDisbursed = Number(priorRes?.total || 0);
      }

      // Objective Server-Side Substantive Inference:
      // A payment not linked to an invoice, on a contract with an unspent contractual advance,
      // is substantively an advance payment regardless of user dropdown silence (unless explicitly declared operational_advance or retention)
      const userDeclaredAdvance = dto.isAdvancePayment === true || dto.paymentCategory === 'advance';
      const isOperationalAdvance = dto.paymentCategory === 'operational_advance';
      const isSubstantivelyAdvance =
        userDeclaredAdvance ||
        (!dto.invoiceId &&
         !isOperationalAdvance &&
         dto.paymentCategory !== 'retention' &&
         subcontract &&
         Number(subcontract.advance_pct) > 0 &&
         priorAdvanceDisbursed < Number(subcontract.advance_amount));

      // GATEWAY G1 ENFORCEMENT (With Cumulative Invariant G1-C Protection):
      if (isSubstantivelyAdvance) {
        const activeGuarantees = await this.getGuaranteesRaw(tenantId, {
          projectId: dto.projectId ? String(dto.projectId) : (subcontract?.project_id ? String(subcontract.project_id) : undefined),
          subcontractId: dto.subcontractId ? String(dto.subcontractId) : undefined,
          status: 'active',
        });
        assertAdvancePaymentGate({
          subcontractId: dto.subcontractId,
          projectId: dto.projectId ? String(dto.projectId) : (subcontract?.project_id ? String(subcontract.project_id) : ''),
          requestedDisbursementAmount: amount,
          priorAdvanceDisbursedAgainstGuarantee: priorAdvanceDisbursed,
          disbursementDate: dto.paymentDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
          activeGuarantees,
        });
      }

      const finalPaymentCategory = isSubstantivelyAdvance
        ? 'advance'
        : (dto.paymentCategory || (dto.invoiceId ? 'progress' : 'progress'));

      const [payment] = await (trx as any)
        .insertInto('contracting_subcontractor_payments')
        .values({
          tenant_id: tenantId,
          request_key: dto.requestKey,
          request_fingerprint: fingerprint,
          project_id: dto.projectId ? String(dto.projectId) : (subcontract?.project_id ? String(subcontract.project_id) : null),
          subcontractor_id: dto.subcontractorId,
          subcontract_id: dto.subcontractId ? String(dto.subcontractId) : null,
          invoice_id: dto.invoiceId ? String(dto.invoiceId) : null,
          payment_number: `SPAY-TMP-${randomUUID()}`,
          payment_date: dto.paymentDate || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
          amount,
          payment_method: dto.paymentMethod || 'bank_transfer',
          payment_category: finalPaymentCategory,
          status: 'completed',
          reference_number: dto.referenceNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          created_by: userId ? Number(userId) : null,
        })
        .returningAll()
        .execute();

      const officialNumber = formatDailyDocumentNumber('SPAY', Number(payment.id), new Date(payment.payment_date), 4, businessTz);
      await trx.updateTable('contracting_subcontractor_payments').set({ payment_number: officialNumber }).where('tenant_id', '=', tenantId).where('id', '=', payment.id).execute();
      payment.payment_number = officialNumber;
      const advance = ['advance', 'operational_advance'].includes(finalPaymentCategory);
      const retention = finalPaymentCategory === 'retention';
      const debitCode = advance ? '1165' : retention ? '2160' : '2110';
      const debitAccount = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, debitCode);
      const bankAccount = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, (dto.paymentMethod || 'bank_transfer') === 'cash' ? '1110' : '1120');
      if (!advance) {
        const balance = await trx.selectFrom('journal_entry_lines as l').innerJoin('journal_entries as j', join => join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'))
          .select(sql<number>`coalesce(sum(l.credit - l.debit), 0)`.as('amount')).where('l.tenant_id', '=', tenantId).where('l.account_id', '=', debitAccount)
          .where('l.partner_type', '=', 'supplier').where('l.partner_id', '=', supplierId).where('j.status', '=', 'posted').executeTakeFirstOrThrow();
        if (amount > Number(balance.amount) + 0.001) throw new BadRequestException('الدفعة تتجاوز الاستحقاق المرحل؛ يجب مطابقة المستخلصات القديمة أولاً.');
      }
      const description = `سداد مقاول الباطن ${party.name} - ${officialNumber}`;
      await this.accountingPosting.postDomainJournal(trx, { tenantId, accountId: tenantId, sourceType: 'contracting_subcontractor_payment', sourceId: Number(payment.id), entryDate: new Date(payment.payment_date), description, createdBy: userId,
        lines: [
          { accountId: debitAccount, description, debit: amount, credit: 0, partnerType: 'supplier', partnerId: supplierId },
          { accountId: bankAccount, description, debit: 0, credit: amount, partnerType: 'none', partnerId: null },
        ],
      });
      await trx.insertInto('treasury_transactions').values({ tenant_id: tenantId, account_id: tenantId, txn_type: 'supplier_payment', amount: -amount, note: description, reference_type: 'contracting_subcontractor_payment', reference_id: Number(payment.id), created_by: userId, payment_channel: (dto.paymentMethod || 'bank_transfer') === 'cash' ? 'cash' : 'bank_transfer' } as any).execute();

      return presentPayment(payment);
    });
  }
}
