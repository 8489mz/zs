import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { normalizeArabicSearch } from '../../common/utils/arabic-search.util';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { validateDistributorInvoiceLines } from './engines/distributor-invoice-validation.engine';
import { buildDistributorPurchaseItem } from './engines/distributor-purchase.engine';
import { PurchasesService } from '../purchases/purchases.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { postPharmacyCashReceipt } from './pharmacy-accounting';
import { AppError } from '../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits, fromMinorUnits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { UpsertDrugDto } from './dto/upsert-drug.dto';
import { UpsertBatchDto } from './dto/upsert-batch.dto';
import { UpsertPrescriptionDto } from './dto/upsert-prescription.dto';
import { UpsertShortageDto } from './dto/upsert-shortage.dto';
import { UpsertClinicalServiceDto } from './dto/upsert-clinical-service.dto';
import { EGYPTIAN_MASTER_DRUGS } from './data/egyptian-master-drugs.data';

/*
INV-PHARMACY-BATCH-FROZEN: batch identity helpers. An expiry is a
real calendar date (YYYY-MM-DD) or a real month (YYYY-MM, the form
the acceptance suite already creates with). The past check mirrors
the FEFO sale gate's boundary exactly (month form against the
current month, full date against the tenant-local today), so a batch the
gate would skip can never be (re-)activated as saleable here.
*/
function pharmacyExpiryText(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function isValidPharmacyExpiry(value: string): boolean {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(value);
  if (!match) return false;
  const day = Number(match[3]);
  return day >= 1 && day <= new Date(Number(match[1]), Number(match[2]), 0).getDate();
}

function isPastPharmacyExpiry(normalized: string, todayIso: string): boolean {
  return normalized.length === 7 ? normalized < todayIso.slice(0, 7) : normalized < todayIso;
}

const PHARMACY_BATCH_STATUSES = ['active', 'expired', 'depleted'];

@Injectable()
export class PharmacyService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly purchases: PurchasesService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

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

  // -------------------------------------------------------------
  // 2. DISTRIBUTOR INVOICE IMPORTER (مستورد فواتير المتحدة، ابن سينا، فارما أوفرسيز)
  // -------------------------------------------------------------
  async importDistributorInvoice(
    auth: AuthContext,
    dto: {
      distributor: string; supplierId?: number; locationId?: number;
      invoiceNumber?: string; invoiceDate?: string;
      paymentType?: 'credit' | 'cash';
      lines: Array<{
        productName: string; barcode?: string;
        quantity: number; bonusQuantity?: number;
        publicPrice: number; costPrice: number;
        expiryDate: string; batchNumber?: string;
      }>;
    },
  ) {
    const scope = requireTenantScope(auth);
    validateDistributorInvoiceLines(dto.lines);
    const distributor = String(dto.distributor || '').trim();
    const invoiceNo = String(dto.invoiceNumber || '').trim();
    if (!distributor || !invoiceNo || invoiceNo.length > 100) {
      throw new AppError('A named supplier and unique distributor invoice number are required',
        'PHARMACY_SUPPLIER_INVOICE_REQUIRED', 422);
    }
    // This endpoint is an adapter to the existing purchase/GRN engine; it MUST
    // NOT create independent inventory, cash, or batch rows.
    let supplierQuery = this.db.selectFrom('suppliers')
      .select(['id', 'name']).where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);
    if (dto.supplierId) {
      supplierQuery = supplierQuery.where('id', '=', Number(dto.supplierId));
    } else {
      supplierQuery = supplierQuery.where(sql<boolean>`lower(trim(name)) = lower(${distributor})`);
    }
    const suppliers = await supplierQuery.limit(2).execute();
    if (suppliers.length !== 1) {
      throw new AppError('Distributor must match exactly one active tenant supplier',
        'PHARMACY_SUPPLIER_NOT_LINKED', 422);
    }
    const supplierId = Number(suppliers[0].id);
    let locationQuery = this.db.selectFrom('stock_locations')
      .select(['id', 'branch_id']).where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);
    if (dto.locationId) locationQuery = locationQuery.where('id', '=', Number(dto.locationId));
    const locations = await locationQuery.limit(2).execute();
    if (locations.length !== 1 || !locations[0].branch_id) {
      throw new AppError('Select a single active tenant receiving location',
        'PHARMACY_RECEIPT_LOCATION_REQUIRED', 422);
    }
    const locationId = Number(locations[0].id);
    const branchId = Number(locations[0].branch_id);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    const items: ReturnType<typeof buildDistributorPurchaseItem>[] = [];
    let totalQuantity = 0;
    let totalCostMinor = 0;
    let totalPublicSum = 0;
    for (const line of dto.lines) {
      let query = this.db.selectFrom('pharmacy_drugs').select(['id', 'product_id'])
        .where('tenant_id', '=', scope.tenantId);
      if (line.barcode?.trim()) {
        const barcode = line.barcode.trim();
        query = query.where((eb) => eb.or([
          eb('barcode', '=', barcode), eb('trade_name', '=', line.productName.trim()),
        ]));
      } else {
        query = query.where('trade_name', '=', line.productName.trim());
      }
      let productId: number;
      let isDrug = false;
      const matches = await query.limit(2).execute();
      if (matches.length === 1 && matches[0].product_id) {
        productId = Number(matches[0].product_id);
        isDrug = true;
      } else {
        let prodQuery = this.db.selectFrom('products').select('id')
          .where('tenant_id', '=', scope.tenantId).where('is_active', '=', true);
        if (line.barcode?.trim()) {
          const barcode = line.barcode.trim();
          prodQuery = prodQuery.where((eb) => eb.or([
            eb('barcode', '=', barcode), eb('name', '=', line.productName.trim()),
          ]));
        } else {
          prodQuery = prodQuery.where('name', '=', line.productName.trim());
        }
        const prodMatches = await prodQuery.limit(2).execute();
        if (prodMatches.length !== 1) {
          throw new AppError('Link the imported drug to exactly one inventory product before purchasing',
            'PHARMACY_PRODUCT_NOT_LINKED', 422);
        }
        productId = Number(prodMatches[0].id);
      }
      const product = await this.db.selectFrom('products').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', productId)
        .where('is_active', '=', true).executeTakeFirst();
      if (!product) {
        throw new AppError('Linked inventory product is missing or inactive',
          'PHARMACY_PRODUCT_NOT_LINKED', 422);
      }
      let item: ReturnType<typeof buildDistributorPurchaseItem>;
      try {
        item = buildDistributorPurchaseItem(line, productId, locationId, moneyDigits, isDrug);
        const payableMinor = toMinorUnits(Number(line.quantity) * Number(line.costPrice), moneyDigits);
        const roundedPurchaseMinor = toMinorUnits(roundMoney(item.qty * item.cost, moneyDigits), moneyDigits);
        const varianceMinor = Math.abs(payableMinor - roundedPurchaseMinor);
        if (varianceMinor > 0) {
          // If bonus units diluted the cost, allow fractional cent/fil rounding tolerance
          const maxAllowedVariance = Math.max(2, Math.ceil(item.qty));
          if (varianceMinor > maxAllowedVariance) {
            throw new Error('Drug bonus unit dilution exceeds permitted vendor invoice precision');
          }
        }
        totalCostMinor += payableMinor;
      } catch (error) {
        throw new AppError((error as Error).message, 'PHARMACY_INVOICE_LINE_INVALID', 422);
      }
      if (!Number.isSafeInteger(totalCostMinor)) {
        throw new AppError('Distributor invoice monetary total exceeds safe range',
          'PHARMACY_INVOICE_TOTAL_INVALID', 422);
      }
      totalQuantity += item.qty;
      totalPublicSum += item.qty * Number(line.publicPrice);
      items.push(item);
    }
    // The canonical purchasing path now persists the same 2/3-digit tenant
    // invoice amount in supplier AP, inventory and journal entries.

    const recorded = await this.purchases.createPurchase({
      supplierId, supplierInvoiceNo: invoiceNo,
      paymentType: dto.paymentType === 'cash' ? 'cash' : 'credit',
      branchId, locationId, items, taxRate: 0, pricesIncludeTax: false,
      note: `Imported pharmacy distributor invoice ${distributor} / ${invoiceNo}`,
    }, auth, `pharmacy:${supplierId}:${invoiceNo}`);
    const purchaseId = Number(recorded.purchaseId);
    if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
      throw new AppError('Purchase creation did not return a valid source document',
        'PHARMACY_PURCHASE_RECOVERY_REQUIRED', 422);
    }
    return {
      success: true, distributor, invoiceNumber: invoiceNo, purchaseId,
      importedLinesCount: items.length, totalQuantity,
      totalCostSum: fromMinorUnits(totalCostMinor, moneyDigits), totalPublicSum,
      message: 'Distributor invoice was posted through canonical purchasing, supplier, inventory and GL',
    };
  }

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

  // -------------------------------------------------------------
  // 4. BATCHES & EXPIRY DATES
  // -------------------------------------------------------------
  async listBatches(
    auth: AuthContext,
    filters?: {
      status?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_batches as pb')
      .leftJoin('products as p', (join) => join.onRef('p.id', '=', 'pb.product_id').onRef('p.tenant_id', '=', 'pb.tenant_id'))
      .where(sql<boolean>`pb.tenant_id = ${scope.tenantId}`);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('pb.status', '=', filters.status);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(pb.batch_number) like ${term}
        OR lower(coalesce(pb.supplier_name, '')) like ${term}
        OR lower(coalesce(pb.notes, '')) like ${term}
        OR lower(coalesce(p.name, '')) like ${term}
        OR lower(coalesce(p.barcode, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('pb.id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const batches = await query
      .select([
        'pb.id',
        'pb.tenant_id',
        'pb.account_id',
        'pb.product_id',
        'pb.drug_id',
        'pb.batch_number',
        'pb.expiry_date',
        'pb.quantity',
        'pb.unit_cost',
        'pb.location_id',
        'pb.supplier_name',
        'pb.status',
        'pb.notes',
        'pb.created_at',
        'pb.updated_at',
        'p.name as product_name',
        'p.barcode as product_barcode',
      ])
      .orderBy('pb.id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      batches,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async upsertBatch(auth: AuthContext, dto: UpsertBatchDto) {
    const scope = requireTenantScope(auth);
    const todayKey = await resolveBusinessDateKey(this.db, scope.tenantId, new Date());
    // Batch quantities and WAC are physical and monetary ledgers, NOT metadata.
    // Stock intake must go through the canonical purchase/GRN transaction.
    return this.db.transaction().execute(async (trx) => {
      const quantity = Number(dto.quantity ?? 0);
      const unitCost = Number(dto.unitCost ?? 0);
      if (![quantity, unitCost].every(Number.isFinite) || quantity < 0 || unitCost < 0) {
        throw new AppError('Invalid pharmacy batch balance', 'PHARMACY_BATCH_BALANCE_INVALID', 422);
      }
      if (dto.id) {
        const old = await trx.selectFrom('pharmacy_batches').selectAll()
          .where('tenant_id', '=', scope.tenantId).where('id', '=', dto.id)
          .forUpdate().executeTakeFirst();
        if (!old) throw new AppError('Batch not found', 'PHARMACY_BATCH_NOT_FOUND', 404);
        // INV-PHARMACY-BATCH-FROZEN: expiry is identity, frozen at
        // creation. Repeating the stored value (or omitting it) is a
        // no-op and stays allowed; any change is rejected outright,
        // so an expired batch can never be re-admitted by moving
        // its expiry forward.
        if (dto.expiryDate !== undefined) {
          const newExpiry = pharmacyExpiryText(dto.expiryDate);
          if (newExpiry !== pharmacyExpiryText(old.expiry_date)) {
            throw new AppError('Batch expiry date cannot be changed after creation', 'PHARMACY_BATCH_EXPIRY_FROZEN', 409);
          }
        }
        // Status comes from a closed list, and 'expired' is terminal:
        // neither a batch already marked expired nor one whose
        // expiry has passed may be flipped back to 'active'. Only
        // an explicit activation is gated -- a notes-only update on
        // a batch whose expiry passed with time is not blocked.
        if (dto.status !== undefined && dto.status !== old.status) {
          if (!PHARMACY_BATCH_STATUSES.includes(dto.status)) {
            throw new AppError('Invalid pharmacy batch status', 'PHARMACY_BATCH_STATUS_INVALID', 422);
          }
          const oldExpiry = pharmacyExpiryText(old.expiry_date);
          if (dto.status === 'active' && (old.status === 'expired' || (oldExpiry != null && isPastPharmacyExpiry(oldExpiry, todayKey)))) {
            throw new AppError('An expired batch cannot be returned to active status', 'PHARMACY_BATCH_REACTIVATION_FORBIDDEN', 409);
          }
        }
        if ((dto.quantity !== undefined && quantity !== Number(old.quantity)) ||
            (dto.unitCost !== undefined && unitCost !== Number(old.unit_cost)) ||
            (dto.productId !== undefined && dto.productId !== old.product_id) ||
            (dto.drugId !== undefined && dto.drugId !== old.drug_id) ||
            (dto.locationId !== undefined && dto.locationId !== old.location_id) ||
            dto.batchNumber !== old.batch_number) {
          throw new AppError('Stock and valuation may only change through purchase/GRN/return documents',
            'PHARMACY_BATCH_FINANCIAL_EDIT_FORBIDDEN', 409);
        }
        return trx.updateTable('pharmacy_batches')
          .set({
            expiry_date: dto.expiryDate,
            supplier_name: dto.supplierName ?? old.supplier_name,
            status: dto.status ?? old.status,
            notes: dto.notes ?? old.notes,
            updated_at: sql`now()`,
          })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', dto.id)
          .returningAll().executeTakeFirstOrThrow();
      }
      if (quantity !== 0 || unitCost !== 0) {
        throw new AppError('Create stock via a supplier purchase, not direct batch entry',
          'PHARMACY_BATCH_PURCHASE_REQUIRED', 422);
      }
      // INV-PHARMACY-BATCH-FROZEN: a batch is born with a real expiry
      // and a listed status. An already-expired batch cannot be born
      // 'active' -- it must be recorded 'expired'.
      const createStatus = dto.status ?? 'active';
      if (!PHARMACY_BATCH_STATUSES.includes(createStatus)) {
        throw new AppError('Invalid pharmacy batch status', 'PHARMACY_BATCH_STATUS_INVALID', 422);
      }
      const createExpiry = (dto.expiryDate as unknown) instanceof Date
        ? (dto.expiryDate as unknown as Date).toISOString().slice(0, 10)
        : String(dto.expiryDate ?? '').trim();
      if (!isValidPharmacyExpiry(createExpiry)) {
        throw new AppError('Batch expiry date must be a real calendar date (YYYY-MM-DD) or month (YYYY-MM)', 'PHARMACY_BATCH_EXPIRY_INVALID', 422);
      }
      if (createStatus === 'active' && isPastPharmacyExpiry(createExpiry, todayKey)) {
        throw new AppError('An expired batch cannot be created with active status', 'PHARMACY_BATCH_EXPIRY_INVALID', 422);
      }
      return trx.insertInto('pharmacy_batches').values({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        product_id: dto.productId ?? null, drug_id: dto.drugId ?? null,
        batch_number: dto.batchNumber, expiry_date: dto.expiryDate,
        quantity: 0, unit_cost: 0, location_id: dto.locationId ?? null,
        supplier_name: dto.supplierName ?? null, status: createStatus,
        notes: dto.notes ?? null,
      }).returningAll().executeTakeFirstOrThrow();
    });
  }

  /**
   * FEFO (First Expired, First Out) Batch Allocation Engine
   * Retrieves batches ordered by ascending expiry date (earliest expiry first)
   * to ensure perishable pharmaceuticals are dispensed before shelf life expires.
   */
  async getBatchesFEFO(
    auth: AuthContext,
    params: {
      drugId?: number;
      productId?: number;
      excludeExpired?: boolean;
      minQuantity?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_batches')
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'active');

    if (params.drugId) {
      query = query.where('drug_id', '=', params.drugId);
    }
    if (params.productId) {
      query = query.where('product_id', '=', params.productId);
    }
    if (params.minQuantity !== undefined) {
      query = query.where('quantity', '>=', params.minQuantity);
    } else {
      query = query.where('quantity', '>', 0);
    }

    if (params.excludeExpired) {
      const todayYm = (await resolveBusinessDateKey(this.db, scope.tenantId, new Date())).slice(0, 7); // YYYY-MM, tenant-local
      query = query.where('expiry_date', '>=', todayYm);
    }

    return await query
      .selectAll()
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

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
    let query = this.db
      .selectFrom('pharmacy_prescriptions')
      .where('tenant_id', '=', scope.tenantId);

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

    const prescriptions = await query
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

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
      throw new AppError('Prescription amount exceeds tenant currency precision', 'PHARMACY_CURRENCY_PRECISION_INVALID', 422);
    }
    if (totalMinor < 0 || cashMinor < 0 || insuranceMinor < 0 || cashMinor + insuranceMinor !== totalMinor) {
      throw new AppError('Prescription total must equal patient and insurance allocations', 'PHARMACY_PRESCRIPTION_SETTLEMENT_MISMATCH', 422);
    }
    // Insurance settlement needs an insurer receivable/subledger, not fabricated cash.
    if (status === 'dispensed' && insuranceMinor > 0) {
      throw new AppError('Insurer receivable requires a dedicated settlement document', 'PHARMACY_INSURANCE_SETTLEMENT_REQUIRED', 422);
    }
    if (status === 'dispensed' && totalMinor > 0 && (dto.items?.length ?? 0) > 0) {
      // A prescription log has no product/lot IDs or stock COGS provenance.
      // Charging for medicines here would invent revenue without the matching
      // canonical sale, inventory movement and cost-of-goods journal.
      throw new AppError('Dispensed medicines must be billed through the linked inventory sale',
        'PHARMACY_PRESCRIPTION_SALE_REQUIRED', 422);
    }
    const initialRxNo = String(dto.prescriptionNo || '').trim() || 'PENDING_RX';
    const itemsJsonStr = JSON.stringify(dto.items ?? []);
    return this.db.transaction().execute(async (trx) => {
      let rx: any;
      if (dto.id) {
        const previous = await trx.selectFrom('pharmacy_prescriptions')
          .selectAll().where('tenant_id', '=', scope.tenantId).where('id', '=', dto.id)
          .forUpdate().executeTakeFirst();
        if (!previous) throw new AppError('Prescription not found', 'PHARMACY_PRESCRIPTION_NOT_FOUND', 404);
        const historicalCash = await trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('reference_type', '=', 'pharmacy_prescription')
          .where('reference_id', '=', dto.id).executeTakeFirst();
        if (historicalCash || previous.status === 'dispensed') {
          throw new AppError('Dispensed prescription requires formal reversal before editing', 'PHARMACY_PRESCRIPTION_REVERSAL_REQUIRED', 409);
        }
        rx = await trx.updateTable('pharmacy_prescriptions')
          .set({
            customer_name: dto.customerName,
            customer_phone: dto.customerPhone ?? null, doctor_name: dto.doctorName ?? null,
            doctor_specialty: dto.doctorSpecialty ?? null, diagnosis: dto.diagnosis ?? null,
            insurance_provider: dto.insuranceProvider ?? null, insurance_card_no: dto.insuranceCardNo ?? null,
            approval_code: dto.approvalCode ?? null, patient_copay_percent: dto.patientCopayPercent ?? 0,
            total_amount: total, patient_amount: patientCash, insurance_amount: insurance,
            items_json: itemsJsonStr, dispensed_by: dto.dispensedBy ?? null,
            status, notes: dto.notes ?? null, updated_at: sql`now()`,
          })
          .where('id', '=', dto.id).where('tenant_id', '=', scope.tenantId)
          .returningAll().executeTakeFirstOrThrow();
      } else {
        if (dto.prescriptionNo?.trim()) {
          // Serialize same-tenant duplicate numbers before their insert. A
          // lost-response retry must not collect the patient copay twice.
          await sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId}), hashtext(${initialRxNo}))`.execute(trx);
          const prior = await trx.selectFrom('pharmacy_prescriptions').select('id')
            .where('tenant_id', '=', scope.tenantId)
            .where('prescription_no', '=', initialRxNo).executeTakeFirst();
          if (prior) throw new AppError('Prescription number already exists', 'PHARMACY_DUPLICATE_PRESCRIPTION', 409);
        }
        rx = await trx.insertInto('pharmacy_prescriptions').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, prescription_no: initialRxNo,
          customer_name: dto.customerName,
          customer_phone: dto.customerPhone ?? null, doctor_name: dto.doctorName ?? null,
          doctor_specialty: dto.doctorSpecialty ?? null, diagnosis: dto.diagnosis ?? null,
          insurance_provider: dto.insuranceProvider ?? null, insurance_card_no: dto.insuranceCardNo ?? null,
          approval_code: dto.approvalCode ?? null, patient_copay_percent: dto.patientCopayPercent ?? 0,
          total_amount: total, patient_amount: patientCash, insurance_amount: insurance,
          items_json: itemsJsonStr, dispensed_by: dto.dispensedBy ?? null,
          status, notes: dto.notes ?? null,
        }).returningAll().executeTakeFirstOrThrow();
        if (!dto.prescriptionNo?.trim()) {
          const rxNo = formatDailyDocumentNumber('RX', Number(rx.id));
          await trx.updateTable('pharmacy_prescriptions').set({ prescription_no: rxNo })
            .where('id', '=', rx.id).where('tenant_id', '=', scope.tenantId).execute();
          rx.prescription_no = rxNo;
        }
      }
      if (status === 'dispensed' && cashMinor > 0) {
        await trx.insertInto('treasury_transactions').values({
          tenant_id: scope.tenantId, account_id: scope.accountId,
          txn_type: 'revenue', amount: patientCash,
          note: `صرف روشتة ${rx.prescription_no} — نقدي: ${patientCash.toFixed(digits)}`,
          reference_type: 'pharmacy_prescription', reference_id: Number(rx.id),
          created_by: auth.userId ? Number(auth.userId) : null,
        }).execute();
        await postPharmacyCashReceipt(trx, this.accountingFoundation, this.accountingPosting,
          auth, 'pharmacy_prescription_cash', Number(rx.id), patientCash);
      }
      return rx;
    });
  }

  // -------------------------------------------------------------
  // 6. SHORTAGES BOOK (كشكول النواقص الرقمي)
  // -------------------------------------------------------------
  async listShortages(
    auth: AuthContext,
    filters?: {
      status?: string;
      priority?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let query = this.db
      .selectFrom('pharmacy_shortages')
      .where('tenant_id', '=', scope.tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status);
    }

    if (filters?.priority && filters.priority !== 'all') {
      query = query.where('priority', '=', filters.priority);
    }

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      query = query.where(sql<boolean>`(
        lower(product_name) like ${term}
        OR lower(coalesce(active_ingredient, '')) like ${term}
        OR lower(coalesce(customer_name, '')) like ${term}
        OR lower(coalesce(suggested_distributor, '')) like ${term}
      )`);
    }

    const totalRes = await query.select((eb) => eb.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const shortages = await query
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      shortages,
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async upsertShortage(auth: AuthContext, dto: UpsertShortageDto) {
    const scope = requireTenantScope(auth);

    if (dto.id) {
      return await this.db
        .updateTable('pharmacy_shortages')
        .set({
          product_name: dto.productName,
          active_ingredient: dto.activeIngredient ?? null,
          suggested_distributor: dto.suggestedDistributor ?? null,
          requested_quantity: dto.requestedQuantity || 1,
          priority: dto.priority || 'normal',
          customer_name: dto.customerName ?? null,
          customer_phone: dto.customerPhone ?? null,
          status: dto.status || 'needed',
          notes: dto.notes ?? null,
          updated_at: sql`now()`,
        })
        .where('id', '=', dto.id)
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return await this.db
      .insertInto('pharmacy_shortages')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        product_name: dto.productName,
        active_ingredient: dto.activeIngredient ?? null,
        suggested_distributor: dto.suggestedDistributor ?? null,
        requested_quantity: dto.requestedQuantity || 1,
        priority: dto.priority || 'normal',
        customer_name: dto.customerName ?? null,
        customer_phone: dto.customerPhone ?? null,
        status: dto.status || 'needed',
        notes: dto.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateShortageStatus(auth: AuthContext, id: number, status: string) {
    const scope = requireTenantScope(auth);
    return await this.db
      .updateTable('pharmacy_shortages')
      .set({ status, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

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
      const service = await trx.insertInto('pharmacy_clinical_services').values({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        service_type: dto.serviceType, customer_name: dto.customerName,
        customer_phone: dto.customerPhone ?? null,
        metric_value_1: dto.metricValue1 ?? null, metric_value_2: dto.metricValue2 ?? null,
        pharmacist_notes: dto.pharmacistNotes ?? null, fee,
      }).returningAll().executeTakeFirstOrThrow();
      if (fee > 0) {
        await trx.insertInto('treasury_transactions').values({
          tenant_id: scope.tenantId, account_id: scope.accountId,
          txn_type: 'revenue', amount: fee,
          note: `خدمة صيدلانية: ${dto.serviceType} — رسوم: ${fee.toFixed(digits)}`,
          reference_type: 'pharmacy_clinical_service',
          reference_id: Number(service.id),
          created_by: auth.userId ? Number(auth.userId) : null,
        }).execute();
        await postPharmacyCashReceipt(trx, this.accountingFoundation, this.accountingPosting,
          auth, 'pharmacy_clinical_service', Number(service.id), fee);
      }
      return service;
    });
  }

  // -------------------------------------------------------------
  // 8. PHARMACY DASHBOARD STATS
  // -------------------------------------------------------------
  async getDashboardStats(auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const [drugsCountRes, shortagesCountRes, activeRxCountRes, batchesRes] = await Promise.all([
      this.db
        .selectFrom('pharmacy_drugs')
        .where('tenant_id', '=', scope.tenantId)
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_shortages')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'needed')
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_prescriptions')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'dispensed')
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_batches')
        .where('tenant_id', '=', scope.tenantId)
        .select((eb) => [eb.fn.count('id').as('total')])
        .executeTakeFirst(),
    ]);

    return {
      totalDrugs: Number(drugsCountRes?.count || 0),
      neededShortages: Number(shortagesCountRes?.count || 0),
      dispensedPrescriptions: Number(activeRxCountRes?.count || 0),
      totalBatches: Number(batchesRes?.total || 0),
      masterDrugsCatalogSize: EGYPTIAN_MASTER_DRUGS.length,
    };
  }
}
