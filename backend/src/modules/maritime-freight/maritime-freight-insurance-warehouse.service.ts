import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateCargoInsuranceDto, UpdateCargoInsuranceDto, ClaimCargoInsuranceDto } from './dto/cargo-insurance.dto';
import { CreateWarehouseReceiptDto, ReleaseWarehouseReceiptDto } from './dto/warehouse-receipt.dto';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { checkInsuranceClaim } from './engines/cargo-insurance.engine';

/**
 * MaritimeFreightInsuranceWarehouseService — slice S6 of the maritime-freight split.
 * Pure move of 9 methods from MaritimeFreightService (cargo insurance:
 * create / update / claim / reads, and warehouse intake / receipts:
 * create / release / reads). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures for the 8 public methods. assertJobBelongsToTenant
 * stays private in the slice (its only callers are in-slice) and gets
 * NO facade delegate. Deps are db only; no cross-slice deps, no mail/
 * WhatsApp/posting, no Logger (the moved text never logs). Both
 * section banners travel with their sections ("CARGO INSURANCE
 * METHODS" before assertJobBelongsToTenant, "WAREHOUSE INTAKE /
 * RECEIPTS METHODS" before createWarehouseReceipt — prep §2, file #8
 * S9 precedent). Date handling travels verbatim: createCargoInsurance
 * carries resolveBusinessDateKey(trx, tenantId, new Date()) (the
 * clock-b4 §A pin — merge-owned repoint to this slice file) and
 * createWarehouseReceipt carries getTenantTimezone + new Date(); no
 * instant comparison, no UTC-slice normalizer. The 4 transaction
 * sites (createCargoInsurance, claimCargoInsurance,
 * createWarehouseReceipt, releaseWarehouseReceipt) are PGlite-safe:
 * their only in-tx callee is assertJobBelongsToTenant, which reads
 * no db handle (prep §9). All 9 methods are unpinned (controller-
 * only) — pure move, recorded, not a blocker. No spec repoint
 * travels in this patch — merge-owned (clock-b4 §A repoint).
 */

export interface MaritimeFreightInsuranceWarehouseDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MaritimeFreightInsuranceWarehouseService {
  private readonly db: Kysely<Database>;

  constructor(deps: MaritimeFreightInsuranceWarehouseDeps) {
    this.db = deps.db;
  }

  // ==========================================
  // CARGO INSURANCE METHODS
  // ==========================================
  /**
   * يتحقق أن الشحنة المرجعية تخص نفس المستأجر قبل تعليق سجل ابن عليها.
   *
   * المفتاح الأجنبي في الهجرة 126 أحادي العمود (`job_id REFERENCES maritime_jobs(id)`)
   * لا مركّب `(tenant_id, id)` كما في هجرة 101 للمقاولات — فهو يضمن أن الشحنة
   * **موجودة** لا أنها **تخصّك**. بدون هذا الفحص يعلّق مستأجر وثيقة تأمين أو إيصال
   * مستودع على شحنة مستأجر آخر (السجل نفسه يبقى معزولاً بـ`tenant_id`، لكن المرجع
   * يصبح معلّقاً عبر المستأجرين). نفس الفحص موجود أصلاً في `createCustomsDeclaration`.
   */
  private async assertJobBelongsToTenant(trx: any, tenantId: string, jobId: string | number): Promise<void> {
    const job = await trx
      .selectFrom('maritime_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobId)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('عملية الشحن غير موجودة');
  }

  async createCargoInsurance(auth: AuthContext, dto: CreateCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      await this.assertJobBelongsToTenant(trx, tenantId, dto.jobId);

      const [record] = await trx
        .insertInto('maritime_cargo_insurances')
        .values({
          tenant_id: tenantId,
          job_id: dto.jobId,
          policy_number: dto.policyNumber,
          insurance_company: dto.insuranceCompany,
          insured_value: Number(dto.insuredValue || 0),
          premium_amount: Number(dto.premiumAmount || 0),
          currency: dto.currency || 'USD',
          coverage_type: dto.coverageType || 'all_risks',
          issue_date: dto.issueDate || (await resolveBusinessDateKey(trx, tenantId, new Date())),
          expiry_date: dto.expiryDate || null,
          status: 'active',
          claim_amount: 0,
          claim_status: null,
          claim_notes: null,
          certificate_url: null,
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      return record;
    });
  }

  async updateCargoInsurance(auth: AuthContext, id: string | number, dto: UpdateCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    const updatePayload: any = {
      updated_at: sql`NOW()`,
    };
    if (dto.policyNumber !== undefined) updatePayload.policy_number = dto.policyNumber;
    if (dto.insuranceCompany !== undefined) updatePayload.insurance_company = dto.insuranceCompany;
    if (dto.insuredValue !== undefined) updatePayload.insured_value = Number(dto.insuredValue);
    if (dto.premiumAmount !== undefined) updatePayload.premium_amount = Number(dto.premiumAmount);
    if (dto.currency !== undefined) updatePayload.currency = dto.currency;
    if (dto.coverageType !== undefined) updatePayload.coverage_type = dto.coverageType;
    if (dto.expiryDate !== undefined) updatePayload.expiry_date = dto.expiryDate;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const [updated] = await this.db
      .updateTable('maritime_cargo_insurances')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) throw new NotFoundException('Cargo Insurance policy not found');
    return updated;
  }

  async claimCargoInsurance(auth: AuthContext, id: string | number, dto: ClaimCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('maritime_cargo_insurances')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Cargo Insurance policy not found');

      const claimAmount = Number(dto.claimAmount);

      // البوابة في محرك نقي يستورده الاختبار من الإنتاج (AGENTS.md Rule 13):
      // تمنع تجاوز القيمة المؤمَّن عليها (كانت تُخزَّن ولا تُقرأ — F10) وتمنع
      // استبدال مطالبة مسجَّلة بصمت.
      const claimCheck = checkInsuranceClaim(
        { insuredValue: existing.insured_value, status: existing.status, claimAmount: existing.claim_amount },
        claimAmount,
      );
      if (!claimCheck.ok) {
        throw new BadRequestException(claimCheck.message);
      }

      const [updated] = await trx
        .updateTable('maritime_cargo_insurances')
        .set({
          status: 'claimed',
          claim_amount: claimAmount,
          claim_status: dto.claimStatus,
          claim_notes: dto.claimNotes || null,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async getJobInsurances(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_cargo_insurances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId)
      .orderBy('id', 'desc')
      .execute();
  }

  // ==========================================
  // WAREHOUSE INTAKE / RECEIPTS METHODS
  // ==========================================
  async createWarehouseReceipt(auth: AuthContext, dto: CreateWarehouseReceiptDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      await this.assertJobBelongsToTenant(trx, tenantId, dto.jobId);

      const tempNumber = `MWR-TMP-${crypto.randomUUID()}`;
      const [receipt] = await trx
        .insertInto('maritime_warehouse_receipts')
        .values({
          tenant_id: tenantId,
          receipt_number: tempNumber,
          job_id: dto.jobId,
          location_id: dto.locationId ? dto.locationId : null,
          received_date: dto.receivedDate ? new Date(dto.receivedDate) : sql`NOW()`,
          package_count: Number(dto.packageCount || 1),
          gross_weight_kg: Number(dto.grossWeightKg || 0),
          cbm: Number(dto.cbm || 0),
          bay_rack_bin: dto.bayRackBin || null,
          warehouse_status: 'in_storage',
          released_at: null,
          released_by: null,
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber(
        'MWR',
        Number(receipt.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );
      const [updated] = await trx
        .updateTable('maritime_warehouse_receipts')
        .set({ receipt_number: finalNumber })
        .where('id', '=', receipt.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async releaseWarehouseReceipt(auth: AuthContext, id: string | number, dto: ReleaseWarehouseReceiptDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('maritime_warehouse_receipts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Warehouse Receipt not found');

      // الإفراج حدث يقع مرة واحدة ويحمل أثراً رقابياً (مَن أفرج ومتى). بلا هذا
      // الحارس، استدعاء ثانٍ يستبدل `released_at`/`released_by` فيمحو أثر
      // الإفراج الأصلي بصمت.
      if (existing.warehouse_status === 'released') {
        throw new BadRequestException('سبق الإفراج عن إيصال المستودع هذا؛ لا يمكن الإفراج عنه مرتين');
      }

      const [updated] = await trx
        .updateTable('maritime_warehouse_receipts')
        .set({
          warehouse_status: 'released',
          released_at: sql`NOW()`,
          released_by: auth.userId ? Number(auth.userId) : null,
          notes: dto.notes ? `${existing.notes ? existing.notes + ' | ' : ''}${dto.notes}` : existing.notes,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async getJobWarehouseReceipts(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_warehouse_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId)
      .orderBy('id', 'desc')
      .execute();
  }

  async getWarehouseReceipts(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_warehouse_receipts').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('warehouse_status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([eb('receipt_number', 'ilike', term), eb('bay_rack_bin', 'ilike', term)]));
    }

    return await query.orderBy('id', 'desc').execute();
  }
}
