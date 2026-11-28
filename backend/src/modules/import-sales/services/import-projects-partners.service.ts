import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { CreateImportProjectDto, UpdateImportProjectDto } from '../dto/import-sales.dto';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { generateDailySequenceNumber } from '../../delivery-reps/services/van-common.util';
import { resolveSectorPreset } from '../data/sector-presets.data';
import { resolveImportProjectDisplayStatus } from '../engines/import-project-status.engine';

/**
 * ImportProjectsPartnersService — slice S1 of the import-sales split.
 * Pure move of 12 methods from ImportSalesService (projects (4) +
 * partners CRUD (4) + partner finance (3) + postPartnerCapitalMovement).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures. This slice calls
 * one other slice through the facade delegate only:
 * generatePeriodProfitReport (S6 profit-report slice) is bound from
 * the facade — the slice never imports another slice service.
 * The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * postPartnerCapitalMovement + recordPartnerPayout — accountingPosting
 * arrives as an OPTIONAL bound dep, so specs constructing
 * new ImportSalesService(db, undefined) keep working. Date handling
 * travels verbatim: createProject's todayKey resolves through
 * resolveBusinessDateKey (tenant day); transaction_date / entryDate
 * are server-instants-as-evidence, never pg DATE keys.
 * postPartnerCapitalMovement is public here (private in the facade
 * delegate) — the facade, a different class, cannot call a private
 * slice method (tsc TS2341); the facade delegate stays private, so
 * the facade public surface is unchanged. Its only callers
 * (createPartner, recordCapitalTransaction) move with it.
 */

export interface ImportProjectsPartnersDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // postPartnerCapitalMovement / recordPartnerPayout build their own
  // AccountingPostingService when this is undefined — specs constructing
  // new ImportSalesService(db, undefined) depend on that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveTenantAccount +
  // verifyAndConsumeApprovalRequest are the shared kernel helpers
  // (stay in the facade forever); generatePeriodProfitReport is the
  // S6 profit-report slice, reached through the facade delegate.
  resolveTenantAccount: (...args: any[]) => any;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  generatePeriodProfitReport: (...args: any[]) => any;
}

@Injectable()
export class ImportProjectsPartnersService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  private readonly generatePeriodProfitReport: (...args: any[]) => any;

  constructor(deps: ImportProjectsPartnersDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
    this.generatePeriodProfitReport = deps.generatePeriodProfitReport;
  }

  async postPartnerCapitalMovement(
    trx: any,
    tenantId: string,
    userId: number,
    partnerName: string,
    partnerId: string,
    type: 'DEPOSIT' | 'WITHDRAWAL',
    amount: number,
    movementDate: Date,
    requestedCashAccountId: string,
    note: string,
  ): Promise<number> {
    const cashAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', Number(requestedCashAccountId));
    const cashAccount = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'account_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', cashAccountId)
      .executeTakeFirstOrThrow();

    const equityAccountId = await this.resolveTenantAccount(trx, tenantId, 'equity');
    const cashIsDebit = type === 'DEPOSIT';

    const posted = await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: tenantId,
        account_id: cashAccount.account_id,
        txn_type: cashIsDebit ? 'partner_capital_deposit' : 'partner_capital_withdrawal',
        amount: cashIsDebit ? amount : -amount,
        note: `${cashIsDebit ? 'إيداع' : 'سحب'} رأس مال الشريك: ${partnerName}${note ? ' - ' + note : ''} (سجل ${partnerId})`,
        reference_type: 'partner_capital',
        reference_id: null,
        return_document_id: null,
        branch_id: null,
        location_id: null,
        created_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const postingService =
      this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
    await postingService.postDomainJournal(trx, {
      sourceType: 'import_partner_capital',
      sourceId: Number(posted.id),
      tenantId,
      accountId: cashAccount.account_id,
      entryDate: movementDate,
      description: `${cashIsDebit ? 'مساهمة' : 'رد'} رأس مال الشريك ${partnerName} (حركة خزينة #${posted.id})`,
      branchId: null,
      locationId: null,
      createdBy: userId,
      postedBy: userId,
      lines: [
        {
          accountId: cashAccountId,
          description: `${cashIsDebit ? 'إيداع نقدي' : 'سحب نقدي'} - رأس مال الشريك ${partnerName}`,
          debit: cashIsDebit ? amount : 0,
          credit: cashIsDebit ? 0 : amount,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        {
          accountId: equityAccountId,
          description: `حساب حقوق الملكية / رأس مال الشريك ${partnerName}`,
          debit: cashIsDebit ? 0 : amount,
          credit: cashIsDebit ? amount : 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
      ],
    });

    return Number(posted.id);
  }

  async getPartners(tenantId: string) {
    return await this.db
      .selectFrom('import_partners')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name', 'asc')
      .execute();
  }

  async createPartner(
    tenantId: string,
    userId: number,
    name: string,
    percentage: number,
    capitalAmount: number = 0,
    accountId?: string,
  ) {
    if (!name?.trim()) throw new BadRequestException('اسم الشريك مطلوب.');
    const cleanPercentage = Number(percentage);
    const cleanCapital = Number(capitalAmount);
    if (!Number.isFinite(cleanPercentage) || cleanPercentage < 0 || cleanPercentage > 100) {
      throw new BadRequestException('نسبة الشراكة يجب أن تكون بين 0% و100%.');
    }
    if (!Number.isFinite(cleanCapital) || cleanCapital < 0) {
      throw new BadRequestException('رأس المال يجب أن يكون مبلغًا موجبًا أو صفرًا.');
    }
    if (cleanCapital > 0 && !accountId) {
      throw new BadRequestException('يلزم تحديد حساب بنك أو خزينة معتمد لإثبات إيداع رأس مال الشريك.');
    }

    // The global profit_share_percentage on import_partners is a
    // legacy field: distribution reads the per-project pool in
    // import_project_partners, which enforces its own <= 100.001
    // ceiling per project. No global sum is enforced here.
    return await this.db.transaction().execute(async (trx) => {
      const partner = await trx
        .insertInto('import_partners')
        .values({
          tenant_id: tenantId,
          name: name.trim(),
          profit_share_percentage: cleanPercentage,
          capital_amount: cleanCapital,
          withdrawn_profit: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (cleanCapital > 0) {
        const ledger = await trx
          .insertInto('import_partner_ledger')
          .values({
            tenant_id: tenantId,
            partner_id: partner.id,
            type: 'DEPOSIT',
            amount: cleanCapital,
            transaction_date: new Date(),
            note: 'إيداع رأس مال افتتاحي',
            created_by: userId,
            idempotency_key: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await this.postPartnerCapitalMovement(
          trx,
          tenantId,
          userId,
          partner.name,
          partner.id,
          'DEPOSIT',
          cleanCapital,
          new Date(),
          accountId!,
          String(ledger.id),
        );
      }

      return partner;
    });
  }

  async updatePartner(tenantId: string, id: string, name?: string, percentage?: number, capitalAmount?: number) {
    if (capitalAmount !== undefined) {
      throw new BadRequestException('لا يمكن تعديل رأس مال الشريك مباشرة بدون حركة إيداع أو سحب دفترية مسجلة.');
    }

    if (percentage !== undefined) {
      const cleanPercentage = Number(percentage);
      if (!Number.isFinite(cleanPercentage) || cleanPercentage < 0 || cleanPercentage > 100) {
        throw new BadRequestException('نسبة الشراكة يجب أن تكون بين 0% و 100%.');
      }
    }

    return await this.db.transaction().execute(async (trx) => {
      if (percentage !== undefined) {
        await trx.selectFrom('tenants').select('id').where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();
        const payout = await trx
          .selectFrom('import_partner_ledger')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', id)
          .where('type', '=', 'PROFIT_PAYOUT')
          .executeTakeFirst();
        if (payout) {
          throw new BadRequestException('لا يمكن تعديل نسبة شريك بعد توزيع أرباح فعلية دون نظام نسب تاريخية معتمد.');
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (percentage !== undefined) updateData.profit_share_percentage = Number(percentage);

      if (Object.keys(updateData).length === 0) return null;

      return await trx
        .updateTable('import_partners')
        .set(updateData)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async deletePartner(tenantId: string, id: string) {
    return await this.db.transaction().execute(async (trx) => {
      // The ledger and project associations are ON DELETE CASCADE in the schema.
      // Relying on an FK violation would silently ERASE financial history.
      const partner = await trx
        .selectFrom('import_partners')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!partner) throw new NotFoundException('الشريك غير موجود.');

      const [ledger, projectLink] = await Promise.all([
        trx
          .selectFrom('import_partner_ledger')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', id)
          .executeTakeFirst(),
        trx
          .selectFrom('import_project_partners')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', id)
          .executeTakeFirst(),
      ]);
      if (ledger || projectLink) {
        throw new BadRequestException(
          'لا يمكن حذف شريك له سجل رأس مال أو أرباح أو ارتباط بمشروع؛ احتفظ بالتاريخ واستخدم حالة عدم النشاط عند إتاحتها.',
        );
      }
      await trx.deleteFrom('import_partners').where('tenant_id', '=', tenantId).where('id', '=', id).execute();
      return { success: true };
    });
  }

  async listProjects(tenantId: string, status?: string) {
    // INV-IMPORT-PROJECT-STATUS-APPROVED: the list never trusts the
    // stored import_projects.status — it is a stale single-writer
    // field (create 'feasibility', convert 'sourcing', close
    // 'closed'; nothing else ever advances it), so projects that
    // ran the real cycle without converting read 'feasibility'
    // forever. The displayed status is derived per project from the
    // authoritative lifecycle evidence (see the engine), and the
    // ?status= filter applies to that DERIVED status, so filtering
    // for 'sourcing' finds an approved-but-unconverted project.
    const projects = await this.db
      .selectFrom('import_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    const shipmentCounts = await this.db
      .selectFrom('import_shipments')
      .select(['project_id', sql<number>`count(*)`.as('shipment_count')])
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .groupBy('project_id')
      .execute();

    const countByProject = new Map<string, number>(
      shipmentCounts.map((sc) => [String(sc.project_id), Number(sc.shipment_count)]),
    );

    const arrivedShipments = await this.db
      .selectFrom('import_shipments')
      .select('project_id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .where('status', '=', 'Arrived')
      .groupBy('project_id')
      .execute();

    const arrivedByProject = new Set(arrivedShipments.map((s) => String(s.project_id)));

    const approvedProformas = await this.db
      .selectFrom('import_proforma_invoices')
      .select('project_id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', 'is not', null)
      .where('status', '=', 'approved')
      .groupBy('project_id')
      .execute();

    const approvedProformaByProject = new Set(approvedProformas.map((pi) => String(pi.project_id)));

    const wanted = (status || '').trim().toLowerCase();
    return projects
      .map((p) => ({
        ...p,
        status: resolveImportProjectDisplayStatus(p.status, {
          feasibilityConvertedAt: p.feasibility_converted_at,
          hasApprovedProforma: approvedProformaByProject.has(String(p.id)),
          hasShipment: (countByProject.get(String(p.id)) || 0) > 0,
          hasArrivedShipment: arrivedByProject.has(String(p.id)),
        }),
        shipmentCount: countByProject.get(String(p.id)) || 0,
      }))
      .filter((p) => !wanted || p.status.toLowerCase() === wanted);
  }

  async getProjectById(tenantId: string, id: string) {
    const project = await this.db
      .selectFrom('import_projects')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!project) throw new NotFoundException('مشروع الاستيراد غير موجود.');

    const shipments = await this.db
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();

    const qcInspections = await this.db
      .selectFrom('import_qc_inspections')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('inspection_date', 'desc')
      .execute();

    const sourcingTrips = await this.db
      .selectFrom('import_sourcing_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .orderBy('start_date', 'desc')
      .execute();

    const aciRecords = await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .execute();

    const partners = await this.db
      .selectFrom('import_project_partners')
      .innerJoin('import_partners', 'import_partners.id', 'import_project_partners.partner_id')
      .select([
        'import_project_partners.id',
        'import_project_partners.partner_id',
        'import_project_partners.capital_share_amount',
        'import_project_partners.profit_percentage',
        'import_partners.name as partner_name',
      ])
      .where('import_project_partners.tenant_id', '=', tenantId)
      .where('import_project_partners.project_id', '=', id)
      .execute();

    // INV-IMPORT-PROJECT-STATUS-APPROVED: the detail view derives
    // the same display status as the list (same engine, same
    // evidence), so a project never reads 'feasibility' here while
    // the list shows 'sourcing' for it.
    const approvedProforma = await this.db
      .selectFrom('import_proforma_invoices')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('project_id', '=', id)
      .where('status', '=', 'approved')
      .limit(1)
      .executeTakeFirst();

    return {
      ...project,
      status: resolveImportProjectDisplayStatus(project.status, {
        feasibilityConvertedAt: project.feasibility_converted_at,
        hasApprovedProforma: !!approvedProforma,
        hasShipment: shipments.length > 0,
        hasArrivedShipment: shipments.some((s: any) => s.status === 'Arrived'),
      }),
      shipments,
      qcInspections,
      sourcingTrips,
      aciRecords,
      partners,
    };
  }

  async createProject(tenantId: string, dto: CreateImportProjectDto) {
    return await this.db.transaction().execute(async (trx) => {
      // Collision-proof numbering: an advisory-locked MAX+1 over
      // today's tenant-local numbers, never COUNT(*) + 1, which
      // duplicates under concurrency. An explicitly supplied number
      // is kept (trimmed) and guarded by the unique index on
      // (tenant_id, project_no) added by migration 0279.
      const suppliedNo = dto.projectNo?.trim();
      const projectNo = suppliedNo
        ? suppliedNo
        : await generateDailySequenceNumber(trx, this.db, 'import_projects', 'project_no', 'IMP', tenantId);

      // INV-IMPORT-SECTOR-PRESET: the preset is a validated data
      // choice. An unknown key fails closed before any write; a
      // project with no preset stores NULL (generic behaviour).
      const sectorPresetKey = dto.sectorPreset?.trim() || null;
      if (sectorPresetKey && !resolveSectorPreset(sectorPresetKey)) {
        throw new BadRequestException(
          `قطاع الاستيراد المحدد (${sectorPresetKey}) غير معروف؛ اختر قطاعاً من القائمة المعتمدة أو اتركه فارغاً للسلوك العام. [IMPORT_UNKNOWN_SECTOR_PRESET]`,
        );
      }

      let project;
      try {
        project = await trx
          .insertInto('import_projects')
          .values({
            tenant_id: tenantId,
            project_no: projectNo,
            title: dto.title.trim(),
            target_market: dto.targetMarket || 'Egypt',
            country_origin: dto.countryOrigin || 'China',
            country_destination: dto.countryDestination || 'Egypt',
            budget_currency: dto.budgetCurrency || 'USD',
            allocated_capital: dto.allocatedCapital || 0,
            target_roi_percentage: dto.targetRoiPercentage || 25,
            status: dto.status || 'feasibility',
            feasibility_data: dto.feasibilityData ? JSON.stringify(dto.feasibilityData) : '{}',
            notes: dto.notes,
            sector_preset: sectorPresetKey,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException(
            `رقم المشروع (${projectNo}) مستخدم بالفعل لهذه المنشأة؛ اختر رقماً آخر أو اترك الترقيم التلقائي.`,
          );
        }
        throw err;
      }

      if (dto.partners && Array.isArray(dto.partners) && dto.partners.length > 0) {
        // The per-project pool is authoritative: its percentages
        // must each lie in 0..100 and sum to <= 100.001, the same
        // ceiling setProjectPartners enforces.
        let projectPercentageTotal = 0;
        for (const p of dto.partners) {
          const pct = Number(p.profitPercentage || 0);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            throw new BadRequestException('نسبة ربح الشريك في المشروع يجب أن تكون بين 0% و 100%.');
          }
          projectPercentageTotal += pct;
        }
        if (projectPercentageTotal > 100.001) {
          throw new BadRequestException(`مجموع نسب شركاء المشروع (${projectPercentageTotal}%) يتجاوز 100%.`);
        }
        for (const p of dto.partners) {
          let partnerId = p.partnerId;
          const partnerName = p.name?.trim();

          if (!partnerId && partnerName) {
            const existing = await trx
              .selectFrom('import_partners')
              .select(['id'])
              .where('tenant_id', '=', tenantId)
              .where('name', '=', partnerName)
              .executeTakeFirst();
            if (existing) {
              partnerId = existing.id;
            } else {
              const created = await trx
                .insertInto('import_partners')
                .values({
                  tenant_id: tenantId,
                  name: partnerName,
                  capital_amount: Number(p.capitalShare || 0),
                  profit_share_percentage: Number(p.profitPercentage || 0),
                  withdrawn_profit: 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
              partnerId = created.id;
            }
          }

          if (partnerId) {
            // New partner rows start on the tenant-local business day.
            const todayKey = await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date());
            await trx
              .insertInto('import_project_partners')
              .values({
                tenant_id: tenantId,
                project_id: project.id,
                partner_id: partnerId,
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
        }
      }

      return project;
    });
  }

  async updateProject(tenantId: string, projectId: string, dto: UpdateImportProjectDto) {
    // INV-IMPORT-PROJECT-PROFORMA-GUARDS: status never moves through
    // the plain PATCH. Lifecycle transitions (close) run only through
    // closeProject with its maker-checker approval and settlement
    // checks; a PATCH-supplied status would bypass all of them.
    if (dto.status !== undefined) {
      throw new BadRequestException(
        'لا يمكن تغيير حالة المشروع من هنا: إغلاق المشروع يتم فقط عبر مسار الإغلاق المعتمد. [IMPORT_PROJECT_STATUS_VIA_CLOSE_ONLY]',
      );
    }
    if (dto.feasibilityData !== undefined) {
      const current = await this.db
        .selectFrom('import_projects')
        .select('status')
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (current?.status === 'closed') {
        throw new BadRequestException(
          'لا يمكن تعديل دراسة جدوى مشروع مغلق: بيانات الدراسة مجمدة بعد الإغلاق. [IMPORT_PROJECT_CLOSED_FEASIBILITY_FROZEN]',
        );
      }
    }
    const payload: any = { updated_at: sql`NOW()` };
    if (dto.title !== undefined) payload.title = dto.title.trim();
    if (dto.targetMarket !== undefined) payload.target_market = dto.targetMarket;
    if (dto.countryOrigin !== undefined) payload.country_origin = dto.countryOrigin;
    if (dto.countryDestination !== undefined) payload.country_destination = dto.countryDestination;
    if (dto.budgetCurrency !== undefined) payload.budget_currency = dto.budgetCurrency;
    if (dto.allocatedCapital !== undefined) payload.allocated_capital = dto.allocatedCapital;
    if (dto.targetRoiPercentage !== undefined) payload.target_roi_percentage = dto.targetRoiPercentage;
    if (dto.feasibilityData !== undefined) payload.feasibility_data = JSON.stringify(dto.feasibilityData);
    if (dto.notes !== undefined) payload.notes = dto.notes;
    if (dto.sectorPreset !== undefined) {
      // INV-IMPORT-SECTOR-PRESET: the preset may change only
      // before any shipment items exist for the project — after
      // that, catalog rows were already created under the old
      // preset's conventions and mixing them would corrupt the
      // catalog. Clearing the preset (null/empty) follows the
      // same guard.
      const nextPresetKey = dto.sectorPreset?.trim() || null;
      if (nextPresetKey && !resolveSectorPreset(nextPresetKey)) {
        throw new BadRequestException(
          `قطاع الاستيراد المحدد (${nextPresetKey}) غير معروف؛ اختر قطاعاً من القائمة المعتمدة أو اتركه فارغاً للسلوك العام. [IMPORT_UNKNOWN_SECTOR_PRESET]`,
        );
      }
      const current = await this.db
        .selectFrom('import_projects')
        .select('sector_preset')
        .where('id', '=', projectId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const currentKey = current?.sector_preset || null;
      if (currentKey !== nextPresetKey) {
        const hasItems = await this.db
          .selectFrom('import_shipment_items')
          .innerJoin('import_shipments', 'import_shipments.id', 'import_shipment_items.shipment_id')
          .select('import_shipment_items.id')
          .where('import_shipments.tenant_id', '=', tenantId)
          .where('import_shipments.project_id', '=', projectId)
          .limit(1)
          .executeTakeFirst();
        if (hasItems) {
          throw new BadRequestException(
            'لا يمكن تغيير قطاع المشروع بعد استيراد أصنافه إلى الحاويات: الأصناف أُنشئت وفق قواعد القطاع السابق. أنشئ مشروعاً جديداً بالقطاع المطلوب. [IMPORT_SECTOR_PRESET_LOCKED]',
          );
        }
      }
      payload.sector_preset = nextPresetKey;
    }

    return await this.db
      .updateTable('import_projects')
      .set(payload)
      .where('id', '=', projectId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recordPartnerPayout(
    tenantId: string,
    userId: number,
    partnerId: string,
    amount: number,
    approvalRequestId?: string,
    projectId?: string,
    treasuryAccountId?: string,
    idempotencyKey?: string,
  ) {
    const cleanAmount = Number(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new BadRequestException('مبلغ صرف الأرباح يجب أن يكون أكبر من الصفر.');
    }

    if (!approvalRequestId) {
      throw new BadRequestException(
        'صرف أرباح الشركاء يخضع لحوكمة Maker-Checker الإلزامية ويتطلب معرّف موافقة معتمد (approvalRequestId).',
      );
    }

    // A caller-supplied idempotency key owns the retry identity
    // (S6): the same key replays the original payout instead of
    // failing at the consumed approval. The key is OPTIONAL —
    // without it the call behaves exactly as before.
    const effectiveKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (idempotencyKey !== undefined && (!effectiveKey || effectiveKey.length > 128)) {
      throw new BadRequestException('مفتاح عدم تكرار صرف أرباح الشركاء غير صالح. [IMPORT_PARTNER_PAYOUT_KEY_INVALID]');
    }

    // The transaction starts here; the catch below replays the
    // committed row when a concurrent retry raced this one.
    const booked = this.db.transaction().execute(async (trx) => {
      const partner = await trx
        .selectFrom('import_partners')
        .selectAll()
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Bind payout to its approved project; never silently choose the first project linked to a partner.
      // INV-IMPORT-TRACEABILITY-APPROVALS-POOL: a UUID that does not
      // exist must fail with the named maker-checker error, not a raw
      // NoResultError — the trial's distribution step demanded an
      // approval UUID with no approval behind it, and the generic
      // failure hid which field was wrong.
      const approved = await trx
        .selectFrom('import_approval_requests')
        .select('request_payload')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', approvalRequestId)
        .executeTakeFirst();
      if (!approved) {
        throw new BadRequestException('طلب الاعتماد (Maker-Checker) المحدد غير موجود.');
      }
      let approvalDetails: any;
      try {
        approvalDetails =
          typeof approved.request_payload === 'string'
            ? JSON.parse(approved.request_payload || '{}')
            : approved.request_payload;
      } catch {
        throw new BadRequestException('تفاصيل الموافقة غير صالحة.');
      }
      const targetProjectId = projectId || String(approvalDetails?.projectId || '');
      if (!targetProjectId) throw new BadRequestException('يجب تحديد مشروع أرباح معتمد.');
      const projectPartner = await trx
        .selectFrom('import_project_partners')
        .select('project_id')
        .where('tenant_id', '=', tenantId)
        .where('project_id', '=', targetProjectId)
        .where('partner_id', '=', partnerId)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!projectPartner) throw new BadRequestException('الشريك غير مرتبط بمشروع الأرباح المعتمد.');

      // A supplied key replays the original payout instead of
      // consuming the approval a second time (S6). The pre-check
      // runs after the approval read resolves the target project
      // and before the approval is consumed.
      if (effectiveKey) {
        const replayed = await this.replayPayout(trx, tenantId, partnerId, effectiveKey, cleanAmount, targetProjectId);
        if (replayed) return replayed;
      }

      await this.verifyAndConsumeApprovalRequest(trx, tenantId, 'partner_distribution', partnerId, approvalRequestId, {
        amount: cleanAmount,
        projectId: targetProjectId,
        partnerId,
      });

      const profitReport = await this.generatePeriodProfitReport(
        tenantId,
        new Date('2020-01-01'),
        new Date(),
        targetProjectId,
        trx,
      );
      if (!profitReport.data.profitAttributionVerified) {
        throw new UnprocessableEntityException(
          'صرف الأرباح موقوف لحين إتمام تتبع مصدر البضاعة واعتماد أرباح كل مشروع؛ التقرير الحالي تقديري وغير صالح للتوزيع.',
        );
      }
      const partnerShare = profitReport.data.partnerShares.find((p: any) => p.partnerId === partnerId);
      const totalEntitled = Number(partnerShare?.shareAmount || 0);
      const allAttributed = await trx
        .selectFrom('import_partner_project_payouts')
        .select(sql<number>`coalesce(sum(amount_egp), 0)`.as('total'))
        .where('tenant_id', '=', tenantId)
        .where('partner_id', '=', partnerId)
        .executeTakeFirst();
      if (Number(partner.withdrawn_profit || 0) > Number(allAttributed?.total || 0) + 0.01) {
        throw new UnprocessableEntityException(
          'توجد توزيعات تاريخية غير مرتبطة بمشروع؛ يجب تسويتها قبل صرف أرباح إضافية.',
        );
      }
      const withdrawn = Number(partnerShare?.withdrawnProfit || 0);
      const maxAvailable = Math.max(0, totalEntitled - withdrawn);

      if (cleanAmount > maxAvailable) {
        throw new BadRequestException(
          `لا يمكن صرف أرباح تتجاوز المستحق المعتمد للشريك. المتاح للصرف حالياً: ${maxAvailable.toFixed(2)} ج.م (المطلوب: ${cleanAmount.toFixed(2)} ج.م).`,
        );
      }

      const bankAccountId = await this.resolveTenantAccount(
        trx,
        tenantId,
        'bank',
        treasuryAccountId ? Number(treasuryAccountId) : null,
      );
      const bankScope = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_id', 'code'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bankAccountId)
        .executeTakeFirst();
      const scopeAccountId = bankScope?.account_id || tenantId;

      const equityAccountId = await this.resolveTenantAccount(trx, tenantId, 'equity');

      const postedTreasury = await trx
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: scopeAccountId,
          txn_type: 'partner_payout',
          amount: -cleanAmount,
          note: `صرف أرباح الشريك: ${partner.name}`,
          reference_type: 'partner_payout',
          reference_id: null,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('import_partner_project_payouts')
        .values({
          tenant_id: tenantId,
          partner_id: partnerId,
          project_id: targetProjectId,
          treasury_transaction_id: postedTreasury.id,
          amount_egp: cleanAmount,
          created_by: userId,
          idempotency_key: effectiveKey || null,
        })
        .execute();
      await trx
        .updateTable('import_partners')
        .set((eb) => ({
          withdrawn_profit: sql`${eb.ref('withdrawn_profit')} + ${cleanAmount}`,
        }))
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const ledgerInsert = await trx
        .insertInto('import_partner_ledger')
        .values({
          tenant_id: tenantId,
          partner_id: partnerId,
          type: 'PROFIT_PAYOUT',
          amount: cleanAmount,
          transaction_date: new Date(),
          note: `صرف أرباح الشريك: ${partner.name} (طلب موافقة: ${approvalRequestId})`,
          created_by: userId,
          idempotency_key: effectiveKey || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const postingService =
        this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalEntryId = await postingService.postDomainJournal(trx, {
        sourceType: 'import_partner_payout',
        sourceId: Number(postedTreasury.id),
        tenantId,
        accountId: scopeAccountId,
        entryDate: new Date(),
        description: `صرف أرباح الشريك ${partner.name} - مشروع ${targetProjectId || 'عام'} (حركة خزينة #${postedTreasury.id})`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: equityAccountId,
            description: `توزيعات أرباح الشريك ${partner.name} - تخفيض حقوق الملكية/الأرباح المستحقة`,
            debit: cleanAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: bankAccountId,
            description: `صرف بنكي/نقدي لأرباح الشريك ${partner.name}`,
            debit: 0,
            credit: cleanAmount,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });

      return {
        success: true,
        ledgerId: ledgerInsert.id,
        journalEntryId,
        treasuryTransactionId: postedTreasury.id,
      };
    });
    try {
      return await booked;
    } catch (err: any) {
      if (!effectiveKey) throw err;
      const replayed = await this.replayPayout(this.db, tenantId, partnerId, effectiveKey, cleanAmount, projectId);
      if (replayed) return replayed;
      throw err;
    }
  }

  // Replay-by-key (S6): rebuilds the original payout response
  // from the committed rows. Retry identity is the
  // caller-supplied business payload only — amount, partner, and
  // the project when the caller supplied one (the approval payload
  // resolved it otherwise). Server-resolved values (the journal,
  // the treasury leg) are RESULTS, rebuilt from the stored rows.
  private async replayPayout(
    executor: any,
    tenantId: string,
    partnerId: string,
    key: string,
    amount: number,
    projectId?: string,
  ): Promise<{ success: boolean; ledgerId: any; journalEntryId: number; treasuryTransactionId: number } | null> {
    const existing: any = await executor
      .selectFrom('import_partner_project_payouts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    if (!existing) return null;
    if (
      Number(existing.amount_egp) !== Number(amount) ||
      String(existing.partner_id) !== String(partnerId) ||
      (projectId !== undefined && String(existing.project_id) !== String(projectId))
    ) {
      throw new ConflictException(
        'تم تسجيل صرف أرباح بهذا المفتاح مسبقاً بمبالغ مختلفة. [IMPORT_PARTNER_PAYOUT_DUPLICATE_KEY]',
      );
    }
    const ledger: any = await executor
      .selectFrom('import_partner_ledger')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('partner_id', '=', partnerId)
      .where('type', '=', 'PROFIT_PAYOUT')
      .where('idempotency_key', '=', key)
      .executeTakeFirstOrThrow();
    const journal: any = await executor
      .selectFrom('journal_entries')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('source_type', '=', 'import_partner_payout')
      .where('source_id', '=', Number(existing.treasury_transaction_id))
      .executeTakeFirstOrThrow();
    return {
      success: true,
      ledgerId: ledger.id,
      journalEntryId: Number(journal.id),
      treasuryTransactionId: Number(existing.treasury_transaction_id),
    };
  }

  async getPartnerLedger(tenantId: string, partnerId: string) {
    return await this.db
      .selectFrom('import_partner_ledger')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('partner_id', '=', partnerId)
      .orderBy('transaction_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
  }

  async recordCapitalTransaction(
    tenantId: string,
    userId: number,
    partnerId: string,
    dto: {
      type: 'DEPOSIT' | 'WITHDRAWAL';
      amount: number;
      date: string;
      note?: string;
      accountId?: string;
      idempotencyKey?: string;
    },
  ) {
    const cleanAmount = Number(dto.amount);
    const movementDate = new Date(dto.date);
    if (dto.type !== 'DEPOSIT' && dto.type !== 'WITHDRAWAL') {
      throw new BadRequestException('نوع حركة رأس المال غير صالح.');
    }
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new BadRequestException('مبلغ حركة رأس المال يجب أن يكون أكبر من الصفر.');
    }
    const requiredCashAccountId = dto.accountId;
    if (!requiredCashAccountId) {
      throw new BadRequestException('تحديد حساب البنك أو الخزينة إلزامي لكل حركة رأس مال فعلية.');
    }
    if (Number.isNaN(movementDate.getTime())) {
      throw new BadRequestException('تاريخ حركة رأس المال غير صالح.');
    }

    return await this.db.transaction().execute(async (trx) => {
      const partner = await trx
        .selectFrom('import_partners')
        .selectAll()
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (dto.type === 'WITHDRAWAL' && Number(partner.capital_amount || 0) < cleanAmount) {
        throw new BadRequestException(
          `رصيد رأس المال الحالي (${partner.capital_amount}) لا يكفي لسحب مبلغ ${cleanAmount}.`,
        );
      }

      // Optional idempotency key (same pattern as the deposit /
      // preorder refund paths): a supplied key is checked before
      // the insert, and the partial unique index serialises
      // concurrent retries. Without a key the call behaves exactly
      // as before.
      const capitalKey = dto.idempotencyKey ? String(dto.idempotencyKey).trim() : '';
      if (capitalKey.length > 128) {
        throw new BadRequestException('مفتاح عدم التكرار لحركة رأس المال يجب ألا يتجاوز 128 حرفاً.');
      }
      if (capitalKey) {
        const previousMovement = await trx
          .selectFrom('import_partner_ledger')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('partner_id', '=', partnerId)
          .where('idempotency_key', '=', capitalKey)
          .executeTakeFirst();
        if (previousMovement) {
          throw new ConflictException('تم تسجيل حركة رأس المال هذه مسبقاً بنفس مفتاح عدم التكرار.');
        }
      }

      let ledgerInsert;
      try {
        ledgerInsert = await trx
          .insertInto('import_partner_ledger')
          .values({
            tenant_id: tenantId,
            partner_id: partnerId,
            type: dto.type,
            amount: cleanAmount,
            transaction_date: dto.date,
            note: dto.note || '',
            created_by: userId,
            idempotency_key: capitalKey || null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException('تم تسجيل حركة رأس المال هذه مسبقاً بنفس مفتاح عدم التكرار.');
        }
        throw err;
      }

      const sign = dto.type === 'DEPOSIT' ? '+' : '-';
      await trx
        .updateTable('import_partners')
        .set((eb) => ({
          capital_amount: sql`${eb.ref('capital_amount')} ${sql.raw(sign)} ${cleanAmount}`,
        }))
        .where('id', '=', partnerId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const treasuryTransactionId = await this.postPartnerCapitalMovement(
        trx,
        tenantId,
        userId,
        partner.name,
        partner.id,
        dto.type,
        cleanAmount,
        movementDate,
        requiredCashAccountId,
        dto.note || '',
      );

      return { success: true, ledgerId: ledgerInsert.id, treasuryTransactionId };
    });
  }
}
