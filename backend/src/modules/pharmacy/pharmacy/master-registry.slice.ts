import { sql } from 'kysely';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { EGYPTIAN_MASTER_DRUGS } from '../data/egyptian-master-drugs.data';

export class MasterRegistrySlice {
  constructor(private readonly db: Kysely<Database>) {}

  // -------------------------------------------------------------
  // 1. EGYPTIAN MASTER DRUG REGISTRY & CATALOG (المرجع الدوائي المصري الشامل)
  // -------------------------------------------------------------
  getMasterCatalog(filters?: { q?: string; drugClass?: string; page?: number; pageSize?: number }) {
    let items = [...EGYPTIAN_MASTER_DRUGS];

    if (filters?.drugClass && filters.drugClass !== 'all') {
      items = items.filter((d) => d.drug_class === filters.drugClass);
    }

    if (filters?.q && filters.q.trim()) {
      const q = normalizeArabicSearch(filters.q.trim().toLowerCase());
      items = items.filter((d) => {
        const tEn = d.trade_name.toLowerCase();
        const tAr = normalizeArabicSearch((d.trade_name_ar || '').toLowerCase());
        const aEn = d.active_ingredient.toLowerCase();
        const aAr = normalizeArabicSearch((d.active_ingredient_ar || '').toLowerCase());
        const bar = (d.barcode || '').toLowerCase();
        const man = (d.manufacturer || '').toLowerCase();
        return (
          tEn.includes(q) ||
          tAr.includes(q) ||
          aEn.includes(q) ||
          aAr.includes(q) ||
          bar.includes(q) ||
          man.includes(q)
        );
      });
    }

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(filters?.pageSize || 25)));
    const totalItems = items.length;
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return {
      drugs: paginatedItems,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  async seedAllMasterDrugs(auth: AuthContext) {
    const scope = requireTenantScope(auth);
    let insertedCount = 0;
    let updatedCount = 0;

    for (const drug of EGYPTIAN_MASTER_DRUGS) {
      const existing = await this.db
        .selectFrom('pharmacy_drugs')
        .where('tenant_id', '=', scope.tenantId)
        .where((eb) =>
          eb.or([
            eb('trade_name', '=', drug.trade_name),
            eb('barcode', '=', drug.barcode),
          ])
        )
        .select(['id'])
        .executeTakeFirst();

      if (existing) {
        await this.db
          .updateTable('pharmacy_drugs')
          .set({
            trade_name_ar: drug.trade_name_ar,
            active_ingredient: drug.active_ingredient,
            active_ingredient_ar: drug.active_ingredient_ar,
            dosage_form: drug.dosage_form,
            strength: drug.strength,
            manufacturer: drug.manufacturer,
            drug_class: drug.drug_class,
            prescription_required: drug.prescription_required,
            controlled_level: drug.controlled_level,
            units_per_box: drug.units_per_box,
            unit_name: drug.unit_name,
            box_price: drug.box_price,
            strip_price: drug.strip_price,
            barcode: drug.barcode,
            indications: drug.indications,
            updated_at: sql`now()`,
          })
          .where('id', '=', existing.id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
        updatedCount++;
      } else {
        await this.db
          .insertInto('pharmacy_drugs')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            trade_name: drug.trade_name,
            trade_name_ar: drug.trade_name_ar,
            active_ingredient: drug.active_ingredient,
            active_ingredient_ar: drug.active_ingredient_ar,
            dosage_form: drug.dosage_form,
            strength: drug.strength,
            manufacturer: drug.manufacturer,
            drug_class: drug.drug_class,
            prescription_required: drug.prescription_required,
            controlled_level: drug.controlled_level,
            units_per_box: drug.units_per_box,
            unit_name: drug.unit_name,
            box_price: drug.box_price,
            strip_price: drug.strip_price,
            barcode: drug.barcode,
            indications: drug.indications,
          })
          .execute();
        insertedCount++;
      }
    }

    return {
      success: true,
      totalMasterDrugs: EGYPTIAN_MASTER_DRUGS.length,
      insertedCount,
      updatedCount,
      message: `تمت تغذية الصيدلية بـ ${insertedCount} صنف جديد وتحديث ${updatedCount} صنف بنجاح`,
    };
  }

  async importSelectedMasterDrugs(auth: AuthContext, masterIds: string[]) {
    const scope = requireTenantScope(auth);
    const selected = EGYPTIAN_MASTER_DRUGS.filter((d) => masterIds.includes(d.id));
    let imported = 0;

    for (const drug of selected) {
      const existing = await this.db
        .selectFrom('pharmacy_drugs')
        .where('tenant_id', '=', scope.tenantId)
        .where('trade_name', '=', drug.trade_name)
        .select(['id'])
        .executeTakeFirst();

      if (!existing) {
        await this.db
          .insertInto('pharmacy_drugs')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            trade_name: drug.trade_name,
            trade_name_ar: drug.trade_name_ar,
            active_ingredient: drug.active_ingredient,
            active_ingredient_ar: drug.active_ingredient_ar,
            dosage_form: drug.dosage_form,
            strength: drug.strength,
            manufacturer: drug.manufacturer,
            drug_class: drug.drug_class,
            prescription_required: drug.prescription_required,
            controlled_level: drug.controlled_level,
            units_per_box: drug.units_per_box,
            unit_name: drug.unit_name,
            box_price: drug.box_price,
            strip_price: drug.strip_price,
            barcode: drug.barcode,
            indications: drug.indications,
          })
          .execute();
        imported++;
      }
    }

    return { success: true, importedCount: imported };
  }

  async lookupBarcode(auth: AuthContext, barcode: string) {
    const scope = requireTenantScope(auth);
    const cleanBar = barcode.trim();
    if (!cleanBar) return null;

    // 1. Check local pharmacy inventory
    const local = await this.db
      .selectFrom('pharmacy_drugs')
      .where('tenant_id', '=', scope.tenantId)
      .where('barcode', '=', cleanBar)
      .selectAll()
      .executeTakeFirst();

    if (local) {
      return { foundIn: 'local', drug: local };
    }

    // 2. Check Egyptian Master Drugs Index
    const master = EGYPTIAN_MASTER_DRUGS.find((d) => d.barcode === cleanBar);
    if (master) {
      return { foundIn: 'master', drug: master };
    }

    return null;
  }
}
