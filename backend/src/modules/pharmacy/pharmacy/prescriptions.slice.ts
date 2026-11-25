import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { postPharmacyCashReceipt } from '../pharmacy-accounting';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { UpsertPrescriptionDto } from '../dto/upsert-prescription.dto';

export class PrescriptionsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingFoundation: AccountingTenantFoundationService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  // -------------------------------------------------------------
  // 5. PRESCRIPTIONS & MEDICAL INSURANCE
  // -------------------------------------------------------------
  async listPrescriptions(
    auth: AuthContext,
    filters?: {
      status?: string;
      insuranceProvider?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db.selectFrom('pharmacy_prescriptions').where('tenant_id', '=', scope.tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status);
    }

    if (filters?.insuranceProvider && filters.insuranceProvider !== 'all') {
      query = query.where('insurance_provider', '=', filters.insuranceProvider);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(prescription_no) like ${term}
        OR lower(customer_name) like ${term}
        OR lower(coalesce(customer_phone, '')) like ${term}
        OR lower(coalesce(doctor_name, '')) like ${term}
        OR lower(coalesce(insurance_card_no, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const prescriptions = await query.selectAll().orderBy('id', 'desc').limit(pageSize).offset(offset).execute();

    return {
      prescriptions,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async upsertPrescription(auth: AuthContext, dto: UpsertPrescriptionDto) {
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    // A zero patient copay is deliberate; never replace it with total invoice value.
    const total = Number(dto.totalAmount ?? 0);
    const insurance = Number(dto.insuranceAmount ?? 0);
    const patientCash = Number(dto.patientAmount ?? (dto.insuranceAmount == null ? total : 0));
    const status = dto.status || 'dispensed';
    let totalMinor: number;
    let cashMinor: number;
    let insuranceMinor: number;
    try {
      totalMinor = toMinorUnits(total, digits);
      cashMinor = toMinorUnits(patientCash, digits);
      insuranceMinor = toMinorUnits(insurance, digits);
    } catch {
      throw new AppError(
        'Prescription amount exceeds tenant currency precision',
        'PHARMACY_CURRENCY_PRECISION_INVALID',
        422,
      );
    }
    if (totalMinor < 0 || cashMinor < 0 || insuranceMinor < 0 || cashMinor + insuranceMinor !== totalMinor) {
      throw new AppError(
        'Prescription total must equal patient and insurance allocations',
        'PHARMACY_PRESCRIPTION_SETTLEMENT_MISMATCH',
        422,
      );
    }
    // Insurance settlement needs an insurer receivable/subledger, not fabricated cash.
    if (status === 'dispensed' && insuranceMinor > 0) {
      throw new AppError(
        'Insurer receivable requires a dedicated settlement document',
        'PHARMACY_INSURANCE_SETTLEMENT_REQUIRED',
        422,
      );
    }
    if (status === 'dispensed' && totalMinor > 0 && (dto.items?.length ?? 0) > 0) {
      // A prescription log has no product/lot IDs or stock COGS provenance.
      // Charging for medicines here would invent revenue without the matching
      // canonical sale, inventory movement and cost-of-goods journal.
      throw new AppError(
        'Dispensed medicines must be billed through the linked inventory sale',
        'PHARMACY_PRESCRIPTION_SALE_REQUIRED',
        422,
      );
    }
    const initialRxNo = String(dto.prescriptionNo || '').trim() || 'PENDING_RX';
    const itemsJsonStr = JSON.stringify(dto.items ?? []);
    return this.db.transaction().execute(async (trx) => {
      let rx: any;
      if (dto.id) {
        const previous = await trx
          .selectFrom('pharmacy_prescriptions')
          .selectAll()
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', dto.id)
          .forUpdate()
          .executeTakeFirst();
        if (!previous) throw new AppError('Prescription not found', 'PHARMACY_PRESCRIPTION_NOT_FOUND', 404);
        const historicalCash = await trx
          .selectFrom('treasury_transactions')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'pharmacy_prescription')
          .where('reference_id', '=', dto.id)
          .executeTakeFirst();
        if (historicalCash || previous.status === 'dispensed') {
          throw new AppError(
            'Dispensed prescription requires formal reversal before editing',
            'PHARMACY_PRESCRIPTION_REVERSAL_REQUIRED',
            409,
          );
        }
        rx = await trx
          .updateTable('pharmacy_prescriptions')
          .set({
            customer_name: dto.customerName,
            customer_phone: dto.customerPhone ?? null,
            doctor_name: dto.doctorName ?? null,
            doctor_specialty: dto.doctorSpecialty ?? null,
            diagnosis: dto.diagnosis ?? null,
            insurance_provider: dto.insuranceProvider ?? null,
            insurance_card_no: dto.insuranceCardNo ?? null,
            approval_code: dto.approvalCode ?? null,
            patient_copay_percent: dto.patientCopayPercent ?? 0,
            total_amount: total,
            patient_amount: patientCash,
            insurance_amount: insurance,
            items_json: itemsJsonStr,
            dispensed_by: dto.dispensedBy ?? null,
            status,
            notes: dto.notes ?? null,
            updated_at: sql`now()`,
          })
          .where('id', '=', dto.id)
          .where('tenant_id', '=', scope.tenantId)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        if (dto.prescriptionNo?.trim()) {
          // Serialize same-tenant duplicate numbers before their insert. A
          // lost-response retry must not collect the patient copay twice.
          await sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId}), hashtext(${initialRxNo}))`.execute(trx);
          const prior = await trx
            .selectFrom('pharmacy_prescriptions')
            .select('id')
            .where('tenant_id', '=', scope.tenantId)
            .where('prescription_no', '=', initialRxNo)
            .executeTakeFirst();
          if (prior) throw new AppError('Prescription number already exists', 'PHARMACY_DUPLICATE_PRESCRIPTION', 409);
        }
        rx = await trx
          .insertInto('pharmacy_prescriptions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            prescription_no: initialRxNo,
            customer_name: dto.customerName,
            customer_phone: dto.customerPhone ?? null,
            doctor_name: dto.doctorName ?? null,
            doctor_specialty: dto.doctorSpecialty ?? null,
            diagnosis: dto.diagnosis ?? null,
            insurance_provider: dto.insuranceProvider ?? null,
            insurance_card_no: dto.insuranceCardNo ?? null,
            approval_code: dto.approvalCode ?? null,
            patient_copay_percent: dto.patientCopayPercent ?? 0,
            total_amount: total,
            patient_amount: patientCash,
            insurance_amount: insurance,
            items_json: itemsJsonStr,
            dispensed_by: dto.dispensedBy ?? null,
            status,
            notes: dto.notes ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        if (!dto.prescriptionNo?.trim()) {
          const rxNo = formatDailyDocumentNumber(
            'RX',
            Number(rx.id),
            new Date(),
            4,
            await getTenantTimezone(trx, scope.tenantId),
          );
          await trx
            .updateTable('pharmacy_prescriptions')
            .set({ prescription_no: rxNo })
            .where('id', '=', rx.id)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
          rx.prescription_no = rxNo;
        }
      }
      if (status === 'dispensed' && cashMinor > 0) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            txn_type: 'revenue',
            amount: patientCash,
            note: `صرف روشتة ${rx.prescription_no} — نقدي: ${patientCash.toFixed(digits)}`,
            reference_type: 'pharmacy_prescription',
            reference_id: Number(rx.id),
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();
        await postPharmacyCashReceipt(
          trx,
          this.accountingFoundation,
          this.accountingPosting,
          auth,
          'pharmacy_prescription_cash',
          Number(rx.id),
          patientCash,
        );
      }
      return rx;
    });
  }
}
