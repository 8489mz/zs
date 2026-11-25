import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql, Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import {
  CalculateFeasibilityDto,
  CreateChinaSupplierDto,
  UpsertSupplierMetaDto,
  CreateQcInspectionDto,
  UpsertAciComplianceDto,
  CreateSourcingTripDto,
  PostSourcingTripExpenseDto,
} from '../dto/import-sales.dto';
import { formatLocalCalendarDay } from '../../../common/utils/tenant-timezone.util';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { calculateImportFeasibility, FeasibilityCalculationResult } from '../engines/import-feasibility.engine';
import { EGYPT_CUSTOMS_TARIFFS, TARIFF_DATA_VERSION, TARIFF_SECTORS } from '../data/egypt-customs-tariffs.data';
import { SECTOR_PRESETS } from '../data/sector-presets.data';

export interface ImportSourcingDeps {
  db: Kysely<any>;
  accountingPosting?: AccountingPostingService;
  // Bound facade kernel methods (same names as the facade members, so the
  // moved bodies are byte-identical). All three stay in the facade forever:
  // resolveTenantAccount + verifyAndConsumeApprovalRequest are shared kernel,
  // assertForm4GrnGate is the QC gate that stays with the facade.
  resolveTenantAccount: (...args: any[]) => any;
  verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  assertForm4GrnGate: (...args: any[]) => any;
}

/**
 * ImportSourcingService — slice S2 of the import-sales split.
 * Pure move of 18 methods from ImportSalesService (feasibility wrapper,
 * China suppliers, sourcing trips, QC inspections, ACI compliance,
 * tariffs incl. calculateCustomsTax). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures. The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * postSourcingTripExpense.
 */
@Injectable()
export class ImportSourcingService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly verifyAndConsumeApprovalRequest: (...args: any[]) => any;
  private readonly assertForm4GrnGate: (...args: any[]) => any;

  constructor(deps: ImportSourcingDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.verifyAndConsumeApprovalRequest = deps.verifyAndConsumeApprovalRequest;
    this.assertForm4GrnGate = deps.assertForm4GrnGate;
  }

  calculateFeasibility(dto: CalculateFeasibilityDto): FeasibilityCalculationResult {
    return calculateImportFeasibility(dto);
  }

  async createChinaSupplier(tenantId: string, userId: string | number, dto: CreateChinaSupplierDto) {
    const name = String(dto.name || '').trim();
    if (!name) {
      throw new BadRequestException('اسم المصنع أو المورد الدولي مطلوب');
    }

    return await this.db.transaction().execute(async (trx) => {
      // Check if supplier name exists in this tenant
      const existing = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql`LOWER(name)`, '=', name.toLowerCase())
        .executeTakeFirst();

      let supplierId: number;
      if (existing) {
        supplierId = Number(existing.id);
      } else {
        const address = String(dto.address || (dto.city ? `${dto.city}, ${dto.province || 'China'}` : 'China')).trim();
        const inserted = await trx
          .insertInto('suppliers')
          .values({
            name,
            phone: String(dto.phone || '').trim(),
            address,
            balance: 0,
            notes: String(dto.notes || '').trim(),
            metadata: JSON.stringify({ is_international: true, country: 'China' }),
            is_active: true,
            tenant_id: tenantId,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
        supplierId = Number(inserted.id);
      }

      // Check existing meta
      const existingMeta = await trx
        .selectFrom('import_suppliers_meta')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('supplier_id', '=', supplierId)
        .executeTakeFirst();

      const bankDetails = {
        beneficiaryName: dto.bankBeneficiary || '',
        bankName: dto.bankName || '',
        swiftCode: dto.bankSwift || '',
        ibanOrAccount: dto.bankAccount || '',
      };

      const hasBank = Boolean(dto.bankName && dto.bankSwift);

      if (existingMeta) {
        await trx
          .updateTable('import_suppliers_meta')
          .set({
            chinese_name: dto.chineseName || null,
            city: dto.city || null,
            province: dto.province || null,
            moq_description: dto.moqDescription || null,
            production_lead_time_days: dto.productionLeadTimeDays ?? 30,
            verified_bank_details: JSON.stringify(bankDetails),
            incoterms_accepted: JSON.stringify(dto.incotermsAccepted || ['FOB', 'EXW', 'CIF']),
            qc_rating: 5.0,
            audit_status: hasBank ? 'verified' : 'unverified',
            verified_at: hasBank ? new Date() : null,
            verified_by: hasBank ? Number(userId) : null,
            verification_notes: hasBank ? 'تم توثيق الحساب البنكي رسمياً أثناء تسجيل المصنع' : null,
            notes: dto.notes || null,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', existingMeta.id)
          .execute();
      } else {
        await trx
          .insertInto('import_suppliers_meta')
          .values({
            tenant_id: tenantId,
            supplier_id: supplierId,
            chinese_name: dto.chineseName || null,
            city: dto.city || null,
            province: dto.province || null,
            moq_description: dto.moqDescription || null,
            production_lead_time_days: dto.productionLeadTimeDays ?? 30,
            verified_bank_details: JSON.stringify(bankDetails),
            incoterms_accepted: JSON.stringify(dto.incotermsAccepted || ['FOB', 'EXW', 'CIF']),
            qc_rating: 5.0,
            quality_certifications: JSON.stringify([]),
            audit_status: hasBank ? 'verified' : 'unverified',
            verified_at: hasBank ? new Date() : null,
            verified_by: hasBank ? Number(userId) : null,
            verification_notes: hasBank ? 'تم توثيق الحساب البنكي رسمياً أثناء تسجيل المصنع' : null,
            notes: dto.notes || null,
          } as any)
          .execute();
      }

      return {
        ok: true,
        supplierId,
        name,
        chineseName: dto.chineseName,
        city: dto.city,
      };
    });
  }

  async listChinaSuppliers(tenantId: string) {
    return await this.db
      .selectFrom('suppliers')
      .leftJoin('import_suppliers_meta', (join) =>
        join
          .onRef('import_suppliers_meta.supplier_id', '=', 'suppliers.id')
          .onRef('import_suppliers_meta.tenant_id', '=', 'suppliers.tenant_id'),
      )
      .select([
        'suppliers.id',
        'suppliers.name',
        'suppliers.phone',
        'suppliers.balance',
        'import_suppliers_meta.chinese_name',
        'import_suppliers_meta.city',
        'import_suppliers_meta.province',
        'import_suppliers_meta.moq_description',
        'import_suppliers_meta.production_lead_time_days',
        'import_suppliers_meta.verified_bank_details',
        'import_suppliers_meta.incoterms_accepted',
        'import_suppliers_meta.qc_rating',
        'import_suppliers_meta.quality_certifications',
        'import_suppliers_meta.audit_status',
        'import_suppliers_meta.verified_at',
        'import_suppliers_meta.verified_by',
        'import_suppliers_meta.verification_notes',
        'import_suppliers_meta.notes as import_notes',
      ])
      .where('suppliers.tenant_id', '=', tenantId)
      .orderBy('suppliers.name', 'asc')
      .execute();
  }

  async upsertSupplierImportMeta(tenantId: string, supplierId: string, dto: UpsertSupplierMetaDto) {
    const sId = Number(supplierId);
    return await this.db.transaction().execute(async (trx) => {
      const supplier = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!supplier) {
        throw new NotFoundException('المورد غير موجود بالمنشأة.');
      }

      const existing = await trx
        .selectFrom('import_suppliers_meta')
        .select(['id', 'audit_status'])
        .where('tenant_id', '=', tenantId)
        .where('supplier_id', '=', sId)
        .executeTakeFirst();

      // Newly added bank accounts must be 'unverified' by default until formally audited
      const auditStatus = dto.auditStatus && existing?.audit_status === 'verified' ? dto.auditStatus : 'unverified';

      const payload: any = {
        chinese_name: dto.chineseName,
        city: dto.city,
        province: dto.province,
        moq_description: dto.moqDescription,
        production_lead_time_days: dto.productionLeadTimeDays ?? 30,
        verified_bank_details: dto.verifiedBankDetails ? JSON.stringify(dto.verifiedBankDetails) : '{}',
        incoterms_accepted: dto.incotermsAccepted
          ? JSON.stringify(dto.incotermsAccepted)
          : JSON.stringify(['FOB', 'EXW', 'CIF']),
        qc_rating: dto.qcRating ?? 5.0,
        quality_certifications: dto.qualityCertifications ? JSON.stringify(dto.qualityCertifications) : '[]',
        audit_status: auditStatus,
        notes: dto.notes,
        updated_at: sql`NOW()`,
      };

      if (existing) {
        return await trx
          .updateTable('import_suppliers_meta')
          .set(payload)
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        return await trx
          .insertInto('import_suppliers_meta')
          .values({
            tenant_id: tenantId,
            supplier_id: sId,
            ...payload,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
    });
  }

  async verifySupplierBankDetails(tenantId: string, userId: number, supplierId: string, verificationNotes?: string) {
    const sId = Number(supplierId);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('import_suppliers_meta')
        .selectAll()
        .where('supplier_id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('بيانات المورد غير مسجلة.');
      }

      await trx
        .updateTable('import_suppliers_meta')
        .set({
          audit_status: 'verified',
          verified_at: new Date(),
          verified_by: userId,
          verification_notes: verificationNotes || 'تم التحقق والاعتماد رسمياً للحساب البنكي للمورد.',
          updated_at: sql`NOW()`,
        })
        .where('supplier_id', '=', sId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return { success: true, message: 'تم اعتماد وتوثيق الحساب البنكي للمورد بنجاح.' };
    });
  }

  async listSourcingTrips(tenantId: string, projectId?: string) {
    let query = this.db
      .selectFrom('import_sourcing_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('start_date', 'desc');

    if (projectId) {
      query = query.where('project_id', '=', projectId);
    }

    return await query.execute();
  }

  async createSourcingTrip(tenantId: string, dto: CreateSourcingTripDto) {
    return await this.db
      .insertInto('import_sourcing_trips')
      .values({
        tenant_id: tenantId,
        project_id: dto.projectId,
        trip_title: dto.tripTitle.trim(),
        destination_city: dto.destinationCity.trim(),
        start_date: dto.startDate,
        end_date: dto.endDate,
        budget_egp: dto.budgetEgp || 0,
        actual_cost_egp: dto.actualCostEgp || 0,
        notes: dto.notes,
        findings: dto.findings ? JSON.stringify(dto.findings) : '{}',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Posts a sourcing trip's actual cost as a project expense
   * (INV-IMPORT-FX-TRIPS-POSTING). Approval-gated and
   * single-posting: the trip row is locked, the token must be
   * bound to this trip with an amount ceiling covering the
   * actual cost, and a trip that already posted conflicts.
   * The payable leg needs a real tenant supplier as its
   * partner — a partner-less payable would be invisible in the
   * supplier subledger. The expense account must be an
   * expense-type account, validated here, never defaulted.
   * The profit report reads exactly this posted expense (it
   * filters on journal_entry_id), so an unposted trip stays a
   * memo estimate and can never double-count.
   */
  async postSourcingTripExpense(tenantId: string, userId: number, tripId: string, dto: PostSourcingTripExpenseDto) {
    if (!dto.approvalRequestId) {
      throw new BadRequestException('ترحيل مصروف رحلة توريد يتطلب موافقة Maker-Checker معتمدة.');
    }
    return await this.db.transaction().execute(async (trx) => {
      const trip: any = await trx
        .selectFrom('import_sourcing_trips')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', tripId)
        .forUpdate()
        .executeTakeFirst();
      if (!trip) throw new BadRequestException('رحلة التوريد غير تابعة للمنشأة.');
      if (trip.journal_entry_id !== null && trip.journal_entry_id !== undefined) {
        throw new ConflictException('تم ترحيل مصروف هذه الرحلة مسبقاً بقيد محاسبي.');
      }
      const actualCost = Number(trip.actual_cost_egp || 0);
      if (!Number.isFinite(actualCost) || actualCost <= 0) {
        throw new BadRequestException('لا يمكن ترحيل رحلة بلا تكلفة فعلية موجبة؛ حدد التكلفة الفعلية أولاً.');
      }
      const supplier: any = await trx
        .selectFrom('suppliers')
        .select(['id', 'account_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(dto.supplierId))
        .executeTakeFirst();
      if (!supplier) throw new BadRequestException('المورد المستحق لمصروف الرحلة غير تابع للمنشأة.');
      const expenseAccount: any = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'account_type', 'is_active'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(dto.expenseAccountId))
        .executeTakeFirst();
      if (!expenseAccount || !expenseAccount.is_active || expenseAccount.account_type !== 'expense') {
        throw new BadRequestException('حساب مصروف الرحلة يجب أن يكون حساب مصروف نشطاً في دليل حسابات المنشأة.');
      }
      await this.verifyAndConsumeApprovalRequest(
        trx,
        tenantId,
        'sourcing_trip_expense',
        tripId,
        dto.approvalRequestId,
        {
          tripId,
          amount: actualCost,
          supplierId: String(dto.supplierId),
          // No projectId binding: the project is implied by the
          // locked trip row (trips have no update path, so the
          // project cannot drift between minting and execution),
          // and the minter knows the trip id, not its project.
        },
      );
      const payableAccountId = await this.resolveTenantAccount(trx, tenantId, 'payable');
      // start_date is a stored DATE (a Date object from pg): String()
      // on it yields 'Wed Jan 15', not a calendar day. Normalize it
      // with formatLocalCalendarDay: node-postgres returns a DATE as a
      // host-local-midnight Date, so the UTC slice renders the previous
      // day on any host east of UTC. The fallback is the tenant-local
      // business day.
      const expenseDate = trip.start_date
        ? trip.start_date instanceof Date
          ? formatLocalCalendarDay(trip.start_date)
          : String(trip.start_date).slice(0, 10)
        : await resolveBusinessDateKey(trx as Transaction<Database>, tenantId, new Date());
      await trx
        .insertInto('expenses')
        .values({
          tenant_id: tenantId,
          account_id: String(dto.expenseAccountId),
          title: `مصروف رحلة توريد - ${trip.trip_title}`,
          amount: actualCost,
          expense_date: expenseDate,
          created_by: userId,
          note: `رحلة ${trip.trip_title} إلى ${trip.destination_city} - ترحيل معتمد`,
          branch_id: null,
          location_id: null,
        })
        .execute();
      const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const tripSerialId = Number(trip.serial_id);
      if (!Number.isSafeInteger(tripSerialId)) {
        throw new BadRequestException(
          'ترحيل مصروف الرحلة يتطلب تشغيل الترحيل 0287 أولاً (الرقم المسلسل لربط القيد). [IMPORT_TRIP_SERIAL_MISSING]',
        );
      }
      const journalEntryId = await posting.postDomainJournal(trx, {
        sourceType: 'import_sourcing_trip_expense',
        sourceId: tripSerialId,
        tenantId,
        accountId: tenantId,
        entryDate: new Date(expenseDate),
        description: `ترحيل مصروف رحلة توريد - ${trip.trip_title} (${actualCost} ج.م)`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: Number(dto.expenseAccountId),
            debit: actualCost,
            credit: 0,
            description: `مصروف رحلة توريد - ${trip.trip_title}`,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: payableAccountId,
            debit: 0,
            credit: actualCost,
            description: `استحقاق مورد عن رحلة توريد - ${trip.trip_title}`,
            partnerType: 'supplier',
            partnerId: Number(dto.supplierId),
            branchId: null,
            locationId: null,
          },
        ],
      });
      await trx
        .updateTable('import_sourcing_trips')
        .set({ journal_entry_id: journalEntryId })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', tripId)
        .execute();
      return { ...trip, journal_entry_id: journalEntryId };
    });
  }

  async listQcInspections(tenantId: string, projectId?: string, shipmentId?: string) {
    let query = this.db
      .selectFrom('import_qc_inspections')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('inspection_date', 'desc');

    if (projectId) query = query.where('project_id', '=', projectId);
    if (shipmentId) query = query.where('shipment_id', '=', shipmentId);

    return await query.execute();
  }

  async createQcInspection(tenantId: string, dto: CreateQcInspectionDto) {
    // GRN (receiving) inspections are the approval of a shipment's
    // receipt: once the receipt is posted the approval must never be
    // offered again and must never record a second time (fail-closed).
    // The receipt state is read from the stored receipt, never from a
    // caller-supplied flag. Other QC stages (e.g. pre-shipment checks
    // in China) are not receipt approvals and are unaffected.
    if (dto.shipmentId && dto.stage === 'receiving') {
      const receipt = await this.db
        .selectFrom('import_inventory_receipts')
        .select(['id', 'state'])
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', dto.shipmentId)
        .executeTakeFirst();
      if (receipt?.state === 'posted') {
        throw new BadRequestException(
          'سند استلام هذه الشحنة مرحّل بالفعل؛ لا يمكن اعتماد محضر فحص واستلام ثانٍ. [IMPORT_GRN_RECEIPT_ALREADY_POSTED]',
        );
      }
      const existing = await this.db
        .selectFrom('import_qc_inspections')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', dto.shipmentId)
        .where('stage', '=', 'receiving')
        .executeTakeFirst();
      if (existing) {
        throw new BadRequestException(
          'تم اعتماد محضر الفحص والاستلام لهذه الشحنة بالفعل؛ لا يمكن اعتماده مرة ثانية. [IMPORT_GRN_ALREADY_RECORDED]',
        );
      }
      // INV-IMPORT-FORM4-GRN-GATE: a receiving (GRN) inspection IS
      // the receipt approval — the dialog toasts "approved" and the
      // operator treats the container as received — so the same
      // Form 4 gate that blocks the clearance/receipt transitions
      // must block this row too. Runs after the posted/duplicate
      // guards above so the most specific refusal wins.
      await this.assertForm4GrnGate(tenantId, dto.shipmentId);
    }
    // I6-E: the pre-check above is a read-then-write — two concurrent
    // submits can both pass it. The partial unique index from
    // migration 0306 (tenant, shipment) WHERE stage = 'receiving'
    // decides the race: the loser gets a 23505, mapped here to the
    // SAME named error as the pre-check, never a raw violation.
    try {
      return await this.db
        .insertInto('import_qc_inspections')
        .values({
          tenant_id: tenantId,
          project_id: dto.projectId,
          shipment_id: dto.shipmentId,
          stage: dto.stage,
          inspection_date: dto.inspectionDate,
          inspector_name: dto.inspectorName,
          sample_size: dto.sampleSize || 0,
          passed_quantity: dto.passedQuantity || 0,
          failed_quantity: dto.failedQuantity || 0,
          defect_notes: dto.defectNotes,
          status: dto.status || 'passed',
          report_file_url: dto.reportFileUrl,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err: any) {
      if (
        err?.code === '23505' ||
        String(err?.message || '').includes('uq_import_qc_inspections_receiving_per_shipment')
      ) {
        throw new BadRequestException(
          'تم اعتماد محضر الفحص والاستلام لهذه الشحنة بالفعل؛ لا يمكن اعتماده مرة ثانية. [IMPORT_GRN_ALREADY_RECORDED]',
        );
      }
      throw err;
    }
  }

  async updateQcInspection(tenantId: string, id: string, dto: Partial<CreateQcInspectionDto>) {
    // INV-IMPORT-FORM4-GRN-GATE: flipping an existing QC row into
    // the receiving stage is a GRN approval by another verb, so it
    // is gated the same way. Only a flip INTO 'receiving' is
    // gated: editing an already-receiving row (inspector, notes)
    // is not a new approval, and a row with no shipment has
    // nothing to gate.
    if (dto.stage === 'receiving') {
      const existing = await this.db
        .selectFrom('import_qc_inspections')
        .select(['shipment_id', 'stage'])
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (existing && existing.stage !== 'receiving' && existing.shipment_id) {
        await this.assertForm4GrnGate(tenantId, String(existing.shipment_id));
      }
    }
    const payload: any = {};
    if (dto.stage !== undefined) payload.stage = dto.stage;
    if (dto.inspectionDate !== undefined) payload.inspection_date = dto.inspectionDate;
    if (dto.inspectorName !== undefined) payload.inspector_name = dto.inspectorName;
    if (dto.sampleSize !== undefined) payload.sample_size = dto.sampleSize;
    if (dto.passedQuantity !== undefined) payload.passed_quantity = dto.passedQuantity;
    if (dto.failedQuantity !== undefined) payload.failed_quantity = dto.failedQuantity;
    if (dto.defectNotes !== undefined) payload.defect_notes = dto.defectNotes;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.reportFileUrl !== undefined) payload.report_file_url = dto.reportFileUrl;

    return await this.db
      .updateTable('import_qc_inspections')
      .set(payload)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getAciCompliance(tenantId: string, targetId: string) {
    return await this.db
      .selectFrom('import_aci_compliance')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where((eb) =>
        eb.or([eb('id', '=', targetId), eb('shipment_id', '=', targetId), eb('project_id', '=', targetId)]),
      )
      .executeTakeFirst();
  }

  async upsertAciCompliance(tenantId: string, dto: UpsertAciComplianceDto) {
    // INV-IMPORT-COMPLIANCE-HS-ACI-DATES: a linked shipment/project is
    // trusted only when it belongs to this tenant. The DTO used to pass
    // shipmentId/projectId straight into the row, so a foreign UUID
    // either failed opaquely on the FK or linked another tenant's
    // shipment. Fail closed with a named error instead, and fill the
    // project from the linked shipment when the caller sends only the
    // container — the dialog sends both, the API stays usable with one.
    const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let linkedProjectId: string | undefined = dto.projectId;
    if (dto.shipmentId) {
      if (!uuidShape.test(dto.shipmentId)) {
        throw new BadRequestException('معرف الشحنة المرتبطة غير صالح');
      }
      const shipment = await this.db
        .selectFrom('import_shipments')
        .select(['id', 'project_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.shipmentId)
        .executeTakeFirst();
      if (!shipment) {
        throw new BadRequestException('الشحنة المرتبطة غير موجودة في هذه المنشأة');
      }
      if (!linkedProjectId && (shipment as any).project_id) {
        linkedProjectId = String((shipment as any).project_id);
      }
    }
    if (dto.projectId) {
      if (!uuidShape.test(dto.projectId)) {
        throw new BadRequestException('معرف المشروع المرتبط غير صالح');
      }
      const project = await this.db
        .selectFrom('import_projects')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.projectId)
        .executeTakeFirst();
      if (!project) {
        throw new BadRequestException('المشروع المرتبط غير موجود في هذه المنشأة');
      }
    }
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('import_aci_compliance')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('acid_number', '=', dto.acidNumber),
            ...(dto.shipmentId ? [eb('shipment_id', '=', dto.shipmentId)] : []),
          ]),
        )
        .executeTakeFirst();

      const payload: any = {
        project_id: linkedProjectId,
        shipment_id: dto.shipmentId,
        acid_number: dto.acidNumber.trim(),
        acid_issue_date: dto.acidIssueDate,
        acid_expiry_date: dto.acidExpiryDate,
        cargox_document_id: dto.cargoxDocumentId,
        importer_tax_number: dto.importerTaxNumber,
        exporter_id: dto.exporterId,
        status: dto.status || 'pending',
        compliance_checklist: dto.complianceChecklist ? JSON.stringify(dto.complianceChecklist) : '{}',
        notes: dto.notes,
      };

      if (existing) {
        return await trx
          .updateTable('import_aci_compliance')
          .set(payload)
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        return await trx
          .insertInto('import_aci_compliance')
          .values({
            tenant_id: tenantId,
            ...payload,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
    });
  }

  listTariffSectors() {
    return TARIFF_SECTORS;
  }

  /** Selectable sector presets for the project form (data, never code branches). */
  listSectorPresets() {
    return SECTOR_PRESETS.map((p) => ({
      key: p.key,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      categoryName: p.categoryName,
    }));
  }

  /**
   * Explicit manual refresh of the bundled official tariffs
   * (INV-IMPORT-TARIFF-VERSIONING). Insert-only: a row the tenant
   * already has — including a tenant-edited rate — is NEVER
   * overwritten, and the refresh stamps every row it inserts
   * with TARIFF_DATA_VERSION so reads can name their snapshot.
   * No background job, cron or read path calls this; the only
   * entry point is the explicit POST customs-tariffs/sync-official
   * route. The counts returned are the refresh log.
   */
  async syncOfficialTariffs(tenantId: string) {
    let inserted = 0;
    for (const item of EGYPT_CUSTOMS_TARIFFS) {
      const rows = await this.db
        .insertInto('import_customs_tariffs')
        .values({
          tenant_id: tenantId,
          hs_code: item.hs_code,
          description_ar: item.description_ar,
          description_en: item.description_en || null,
          duty_rate_percent: item.duty_rate_percent,
          vat_rate_percent: item.vat_rate_percent,
          inspection_fees_percent: item.inspection_fees_percent,
          regulatory_body: item.regulatory_body || 'GOEIC',
          sector: item.sector,
          category_ar: item.category_ar,
          official_source: item.official_source,
          is_official: true,
          data_version: TARIFF_DATA_VERSION,
          effective_date: await resolveBusinessDateKey(this.db, tenantId, new Date()),
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'hs_code']).doNothing())
        .returning('hs_code')
        .execute();
      inserted += rows.length;
    }
    const total = EGYPT_CUSTOMS_TARIFFS.length;
    return {
      success: true,
      count: total,
      inserted,
      skipped: total - inserted,
      total,
      dataVersion: TARIFF_DATA_VERSION,
    };
  }

  /**
   * Reads return exactly what the tenant stored — the last
   * explicit version. The former auto-sync (seeding the bundled
   * snapshot whenever fewer than 15 rows existed, overwriting
   * tenant edits on every read) is removed: a tenant with no
   * tariff rows gets an empty list, and the calculator path
   * labels an unknown HS code instead of silently using zeros.
   */
  async listCustomsTariffs(tenantId: string, search?: string, sector?: string) {
    let query = this.db.selectFrom('import_customs_tariffs').selectAll().where('tenant_id', '=', tenantId);

    if (sector && sector !== 'all') {
      query = query.where('sector', '=', sector);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('hs_code', 'like', s),
          eb('description_ar', 'like', s),
          eb('description_en', 'like', s),
          eb('category_ar', 'like', s),
        ]),
      );
    }

    return await query.orderBy('hs_code', 'asc').execute();
  }

  async calculateCustomsTax(
    tenantId: string,
    hsCode: string,
    cifValueEgp: number,
    overrides?: { overrideDutyRatePercent?: number; overrideVatRatePercent?: number },
  ) {
    const tariff = await this.db
      .selectFrom('import_customs_tariffs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('hs_code', '=', hsCode)
      .executeTakeFirst();

    const isOfficial = Boolean(tariff && (tariff as any).is_official);
    const isDocumented = isOfficial;
    let dutyRate = 0;
    let vatRate = 0;
    let inspRate = 0;
    let source = '';

    if (tariff && isOfficial) {
      dutyRate = Number(tariff.duty_rate_percent) / 100;
      vatRate = Number(tariff.vat_rate_percent) / 100;
      inspRate = Number(tariff.inspection_fees_percent || 0) / 100;
      source = (tariff as any).official_source || 'مصلحة الجمارك المصرية (بند رسمي موثق)';
    } else if (tariff && !isOfficial) {
      dutyRate = Number(tariff.duty_rate_percent) / 100;
      vatRate = Number(tariff.vat_rate_percent) / 100;
      inspRate = Number(tariff.inspection_fees_percent || 0) / 100;
      source = 'تعريفة تقديرية غير رسمية (تتطلب مراجعة مستخلص جمركي)';
    } else if (
      overrides &&
      (overrides.overrideDutyRatePercent !== undefined || overrides.overrideVatRatePercent !== undefined)
    ) {
      dutyRate = Math.max(0, Number(overrides.overrideDutyRatePercent || 0)) / 100;
      vatRate = Math.max(0, Number(overrides.overrideVatRatePercent || 0)) / 100;
      inspRate = 0;
      source = 'تقدير يدوي مؤقت من المستخدم (غير رسمي)';
    } else {
      return {
        hsCode,
        isDocumentedTariff: false,
        isOfficialTariff: false,
        message: 'البند الجمركي غير مسجل بالتعريفة الرسمية المعتمدة. يلزم إدخال النسبة المعتمدة يدوياً.',
        cifValueEgp: Number(cifValueEgp || 0),
        customsDuty: 0,
        inspectionFees: 0,
        vatAmount: 0,
        totalCustomsDues: 0,
        dutyRatePercent: 0,
        vatRatePercent: 0,
      };
    }

    const cif = Math.max(0, Number(cifValueEgp) || 0);
    const customsDuty = cif * dutyRate;
    const inspectionFees = cif * inspRate;
    const vatBase = cif + customsDuty + inspectionFees;
    const vatAmount = vatBase * vatRate;
    const totalCustomsDues = customsDuty + inspectionFees + vatAmount;

    return {
      hsCode,
      isDocumentedTariff: isDocumented,
      isOfficialTariff: isOfficial,
      source,
      description: tariff?.description_ar || 'بند جمركي غير مسجل بالتعريفة الرسمية',
      regulatoryBody: tariff?.regulatory_body || 'غير محدد',
      cifValueEgp: Number(cif.toFixed(2)),
      customsDuty: Number(customsDuty.toFixed(2)),
      inspectionFees: Number(inspectionFees.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      totalCustomsDues: Number(totalCustomsDues.toFixed(2)),
      dutyRatePercent: Number((dutyRate * 100).toFixed(2)),
      vatRatePercent: Number((vatRate * 100).toFixed(2)),
    };
  }
}
