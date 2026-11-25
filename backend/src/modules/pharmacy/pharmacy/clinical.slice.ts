import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { postPharmacyCashReceipt } from '../pharmacy-accounting';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { UpsertClinicalServiceDto } from '../dto/upsert-clinical-service.dto';

export class ClinicalSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountingFoundation: AccountingTenantFoundationService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  // -------------------------------------------------------------
  // 7. CLINICAL SERVICES (الخدمات والفحوصات الصيدلانية)
  // -------------------------------------------------------------
  async listClinicalServices(auth: AuthContext, limit = 50) {
    const scope = requireTenantScope(auth);
    return await this.db
      .selectFrom('pharmacy_clinical_services')
      .where('tenant_id', '=', scope.tenantId)
      .selectAll()
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }

  async createClinicalService(auth: AuthContext, dto: UpsertClinicalServiceDto) {
    const scope = requireTenantScope(auth);
    const fee = Number(dto.fee ?? 0);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    try {
      toMinorUnits(fee, digits);
    } catch {
      throw new AppError('Clinical service fee exceeds currency precision', 'PHARMACY_CURRENCY_PRECISION_INVALID', 422);
    }
    if (fee < 0) throw new AppError('Clinical service fee cannot be negative', 'PHARMACY_CASH_AMOUNT_INVALID', 422);

    // Persist the source, collected cash and its immutable GL as one economic event.
    return this.db.transaction().execute(async (trx) => {
      const service = await trx
        .insertInto('pharmacy_clinical_services')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          service_type: dto.serviceType,
          customer_name: dto.customerName,
          customer_phone: dto.customerPhone ?? null,
          metric_value_1: dto.metricValue1 ?? null,
          metric_value_2: dto.metricValue2 ?? null,
          pharmacist_notes: dto.pharmacistNotes ?? null,
          fee,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (fee > 0) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            txn_type: 'revenue',
            amount: fee,
            note: `خدمة صيدلانية: ${dto.serviceType} — رسوم: ${fee.toFixed(digits)}`,
            reference_type: 'pharmacy_clinical_service',
            reference_id: Number(service.id),
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();
        await postPharmacyCashReceipt(
          trx,
          this.accountingFoundation,
          this.accountingPosting,
          auth,
          'pharmacy_clinical_service',
          Number(service.id),
          fee,
        );
      }
      return service;
    });
  }
}
