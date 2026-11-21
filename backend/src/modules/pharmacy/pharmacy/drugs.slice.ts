import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { AppError } from '../../../common/errors/app-error';
import { UpsertDrugDto } from '../dto/upsert-drug.dto';

export class DrugsSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // -------------------------------------------------------------
  // 3. ACTIVE STORE DRUGS & GENERIC SUBSTITUTES
  // -------------------------------------------------------------
  async listDrugs(
    auth: AuthContext,
    filters?: {
      q?: string;
      activeIngredient?: string;
      dosageForm?: string;
      controlledLevel?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_drugs')
      .where('tenant_id', '=', scope.tenantId);

    if (filters?.dosageForm && filters.dosageForm !== 'all') {
      query = query.where('dosage_form', '=', filters.dosageForm);
    }

    if (filters?.controlledLevel && filters.controlledLevel !== 'all') {
      query = query.where('controlled_level', '=', filters.controlledLevel);
    }

    if (filters?.activeIngredient) {
      const term = `%${normalizeArabicSearch(filters.activeIngredient)}%`;
      query = query.where(sql<boolean>`(
        lower(active_ingredient) like ${term}
        OR TRANSLATE(LOWER(COALESCE(active_ingredient_ar, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
      )`);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(trade_name) like ${term}
        OR TRANSLATE(LOWER(COALESCE(trade_name_ar, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
        OR lower(active_ingredient) like ${term}
        OR TRANSLATE(LOWER(COALESCE(active_ingredient_ar, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
        OR lower(coalesce(barcode, '')) like ${term}
        OR lower(coalesce(manufacturer, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const drugs = await query
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      drugs,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findSubstitutes(auth: AuthContext, activeIngredient: string, strength?: string) {
    const scope = requireTenantScope(auth);
    if (!activeIngredient || !activeIngredient.trim()) return [];

    const term = `%${normalizeArabicSearch(activeIngredient.trim())}%`;
    let query = this.db
      .selectFrom('pharmacy_drugs')
      .where('tenant_id', '=', scope.tenantId)
      .where(sql<boolean>`(
        lower(active_ingredient) like ${term}
        OR TRANSLATE(LOWER(COALESCE(active_ingredient_ar, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
      )`);

    if (strength && strength.trim()) {
      const strTerm = `%${strength.trim().toLowerCase()}%`;
      query = query.where(sql<boolean>`lower(coalesce(strength, '')) like ${strTerm}`);
    }

    return await query.selectAll().orderBy('box_price', 'asc').limit(30).execute();
  }

  async upsertDrug(auth: AuthContext, dto: UpsertDrugDto) {
    const scope = requireTenantScope(auth);

    // A drug-to-stock link is an economic reference for batch WAC and sales.
    // Verify ownership and prevent retargeting historic stock to a different product.
    return this.db.transaction().execute(async (trx) => {
    if (dto.productId != null) {
      const linked = await trx.selectFrom('products').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', dto.productId).executeTakeFirst();
      if (!linked) throw new AppError('Drug stock product must belong to tenant',
        'PHARMACY_PRODUCT_NOT_LINKED', 422);
    }
    if (dto.id) {
      const existing = await trx.selectFrom('pharmacy_drugs').select(['id', 'product_id'])
        .where('id', '=', dto.id).where('tenant_id', '=', scope.tenantId)
        .forUpdate().executeTakeFirst();
      if (!existing) throw new AppError('Drug not found', 'PHARMACY_DRUG_NOT_FOUND', 404);
      if ((dto.productId ?? null) !== existing.product_id) {
        const historical = await trx.selectFrom('pharmacy_batches').select('id')
          .where('tenant_id', '=', scope.tenantId).where('drug_id', '=', dto.id).executeTakeFirst();
        if (historical) throw new AppError('Drug stock linkage cannot be changed after batch receipts',
          'PHARMACY_PRODUCT_LINK_IMMUTABLE', 409);
      }
      return await trx
        .updateTable('pharmacy_drugs')
        .set({
          product_id: dto.productId ?? null,
          trade_name: dto.tradeName,
          trade_name_ar: dto.tradeNameAr ?? null,
          active_ingredient: dto.activeIngredient,
          active_ingredient_ar: dto.activeIngredientAr ?? null,
          dosage_form: dto.dosageForm,
          strength: dto.strength ?? null,
          manufacturer: dto.manufacturer ?? null,
          drug_class: dto.drugClass ?? null,
          prescription_required: dto.prescriptionRequired ?? false,
          controlled_level: dto.controlledLevel ?? 'none',
          units_per_box: dto.unitsPerBox || 1,
          unit_name: dto.unitName || 'شريط',
          strip_price: dto.stripPrice || 0,
          box_price: dto.boxPrice || 0,
          pregnancy_safety: dto.pregnancySafety ?? null,
          storage_condition: dto.storageCondition ?? null,
          barcode: dto.barcode ?? null,
          indications: dto.indications ?? null,
          side_effects: dto.sideEffects ?? null,
          updated_at: sql`now()`,
        })
        .where('id', '=', dto.id)
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return await trx
      .insertInto('pharmacy_drugs')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        product_id: dto.productId ?? null,
        trade_name: dto.tradeName,
        trade_name_ar: dto.tradeNameAr ?? null,
        active_ingredient: dto.activeIngredient,
        active_ingredient_ar: dto.activeIngredientAr ?? null,
        dosage_form: dto.dosageForm,
        strength: dto.strength ?? null,
        manufacturer: dto.manufacturer ?? null,
        drug_class: dto.drugClass ?? null,
        prescription_required: dto.prescriptionRequired ?? false,
        controlled_level: dto.controlledLevel ?? 'none',
        units_per_box: dto.unitsPerBox || 1,
        unit_name: dto.unitName || 'شريط',
        strip_price: dto.stripPrice || 0,
        box_price: dto.boxPrice || 0,
        pregnancy_safety: dto.pregnancySafety ?? null,
        storage_condition: dto.storageCondition ?? null,
        barcode: dto.barcode ?? null,
        indications: dto.indications ?? null,
        side_effects: dto.sideEffects ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    });
  }

  async deleteDrug(auth: AuthContext, id: number) {
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      const drug = await trx.selectFrom('pharmacy_drugs').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', id)
        .forUpdate().executeTakeFirst();
      if (!drug) return { numDeletedRows: 0n };
      const referenced = await trx.selectFrom('pharmacy_batches').select('id')
        .where('tenant_id', '=', scope.tenantId).where('drug_id', '=', id).executeTakeFirst();
      if (referenced) {
        throw new AppError('Cannot delete drug with batch history', 'PHARMACY_DRUG_BATCH_HISTORY', 409);
      }
      return trx.deleteFrom('pharmacy_drugs')
        .where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    });
  }
}
