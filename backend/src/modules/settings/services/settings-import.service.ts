import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta, setScopedStockQty } from '../../../common/utils/location-stock-ledger';
import { formatBranchStockLocationName } from '../../../common/utils/branch-stock.util';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { resolveImportProductNames } from './settings-import.utils';

type DbExecutor = Kysely<Database>;
type TenantScope = { tenantId: string; accountId: string };

/**
 * INV-IMPORT-CHUNKED-1000: one import request carries at most 1,000 rows.
 * A 10,000-row file sent as a single request runs one minutes-long
 * transaction and the edge answers 504 while the server keeps working, so
 * the workbench sends 1,000-row chunks (frontend ImportWorkbench) and the
 * server enforces the same cap here so no caller can re-create the 504.
 */
const MAX_IMPORT_ROWS_PER_REQUEST = 1000;

function cleanString(value: unknown): string {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeImportKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeArabicDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeNumberText(value: unknown): string {
  return normalizeArabicDigits(value).replace(/[،,]/g, '.').trim();
}

function digitsOnly(value: unknown): string {
  return normalizeArabicDigits(value).replace(/\D/g, '');
}

function normalizePhoneText(value: unknown): string {
  return normalizeArabicDigits(value).replace(/\s+/g, '').trim();
}

function normalizeBarcodeText(value: unknown): string {
  let text = cleanString(value);
  if (!text) return '';
  text = normalizeArabicDigits(text);
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num) && Math.floor(num) === num) {
      try {
        text = BigInt(Math.round(num)).toString();
      } catch {
        text = num.toLocaleString('fullwide', { useGrouping: false });
      }
    }
  }
  return text;
}

function parseDateOnly(value: unknown): string | null {
  const text = normalizeArabicDigits(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const ymdSlash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const month = Number(ymdSlash[2]);
    const day = Number(ymdSlash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${ymdSlash[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const mdYSlash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdYSlash) {
    const month = Number(mdYSlash[1]);
    const day = Number(mdYSlash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${mdYSlash[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function toNumericOrNull(value: unknown): number | null {
  const text = normalizeNumberText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class SettingsImportService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  assertAdmin(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    const canManage = auth.role === 'super_admin' || auth.permissions.includes('settings') || auth.permissions.includes('canManageSettings');
    if (!canManage) throw new ForbiddenException('Missing required permissions');
    requireTenantScope(auth);
  }

  assertEmployeeImporter(auth?: AuthContext | null): asserts auth is AuthContext {
    if (!auth) throw new ForbiddenException('Authentication required');
    const canImportEmployees = auth.role === 'super_admin'
      || auth.permissions.includes('hrEmployees')
      || auth.permissions.includes('hr');
    if (!canImportEmployees) throw new ForbiddenException('Missing required permissions');
    requireTenantScope(auth);
  }

  private scope(actor: AuthContext): TenantScope {
    return requireTenantScope(actor);
  }

  private tenantFields(actor: AuthContext): Record<string, string> {
    const scope = this.scope(actor);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  private buildRowLookup(row: Record<string, unknown>): Record<string, string> {
    const lookup: Record<string, string> = {};
    for (const [key, value] of Object.entries(row || {})) {
      lookup[normalizeImportKey(key)] = String(value ?? '').trim();
    }
    return lookup;
  }

  private pickCell(lookup: Record<string, string>, aliases: string[]): string {
    for (const alias of aliases) {
      const value = lookup[normalizeImportKey(alias)];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  private normalizeEmployeeStatus(value: unknown): 'active' | 'inactive' | 'deactivated' | 'terminated' {
    const normalized = cleanString(value).toLowerCase();
    if (['inactive', 'غير نشط'].includes(normalized)) return 'inactive';
    if (['deactivated', 'موقوف'].includes(normalized)) return 'deactivated';
    if (['terminated', 'منتهي الخدمة'].includes(normalized)) return 'terminated';
    return 'active';
  }

  private normalizeCompensationType(value: unknown): 'monthly' | 'hourly' {
    const normalized = cleanString(value).toLowerCase();
    if (['hourly', 'بالساعة', 'أجر بالساعة'].includes(normalized)) return 'hourly';
    return 'monthly';
  }

  private normalizeOvertimePolicy(value: unknown): 'review_only' | 'disabled' | 'auto_approved' {
    const normalized = cleanString(value).toLowerCase();
    if (['disabled', 'غير محتسب'].includes(normalized)) return 'disabled';
    if (['auto_approved', 'محتسب تلقائيًا'].includes(normalized)) return 'auto_approved';
    return 'review_only';
  }

  private normalizeTimeOnly(value: unknown): string | null {
    const text = normalizeArabicDigits(value).trim();
    if (!text) return null;
    const matched = text.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!matched) return null;
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private async ensureHrMasterName(db: DbExecutor, table: 'hr_departments' | 'hr_job_titles' | 'hr_positions', name: string, actor: AuthContext): Promise<number | null> {
    const normalized = cleanString(name);
    if (!normalized) return null;
    const scope = this.scope(actor);
    const existing = await sql<{ id: number }>`
      SELECT id
      FROM ${sql.table(table)}
      WHERE tenant_id = ${scope.tenantId}
        AND LOWER(name) = LOWER(${normalized})
      ORDER BY id DESC
      LIMIT 1
    `.execute(db);
    if (existing.rows[0]?.id) return Number(existing.rows[0].id);

    const inserted = await sql<{ id: number }>`
      INSERT INTO ${sql.table(table)} (name, code, description, is_active, created_by, updated_by, tenant_id, account_id)
      VALUES (${normalized}, '', '', TRUE, ${actor.userId}, ${actor.userId}, ${scope.tenantId}, ${scope.accountId})
      RETURNING id
    `.execute(db);
    return inserted.rows[0]?.id ? Number(inserted.rows[0].id) : null;
  }

  private async nextAvailableEmployeeNo(db: DbExecutor, actor: AuthContext): Promise<string> {
    const scope = this.scope(actor);
    const result = await sql<{ employee_no: string }>`
      SELECT employee_no
      FROM hr_employees
      WHERE tenant_id = ${scope.tenantId}
        AND employee_no ~ '^[0-9]+$'
      ORDER BY LENGTH(employee_no), employee_no
    `.execute(db);
    const used = new Set<number>();
    for (const row of result.rows) {
      const numeric = Number(row.employee_no);
      if (Number.isSafeInteger(numeric) && numeric > 0) used.add(numeric);
    }
    let next = 1;
    while (used.has(next)) next += 1;
    return String(next).padStart(3, '0');
  }

  private async upsertEmployeeContact(db: DbExecutor, employeeId: number, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<void> {
    const normalizedValue = cleanString(value);
    if (!normalizedValue) return;
    const scope = this.scope(actor);
    const existing = await sql<{ id: number }>`
      SELECT id
      FROM hr_employee_contacts
      WHERE tenant_id = ${scope.tenantId}
        AND employee_id = ${employeeId}
        AND LOWER(contact_type) = LOWER(${contactType})
      ORDER BY is_primary DESC, id DESC
      LIMIT 1
    `.execute(db);
    if (existing.rows[0]?.id) {
      await sql`
        UPDATE hr_employee_contacts
        SET value = ${normalizedValue},
            label = ${contactType === 'phone' ? 'الموبايل' : 'البريد الإلكتروني'},
            is_primary = ${contactType === 'phone'},
            updated_by = ${actor.userId},
            updated_at = NOW()
        WHERE tenant_id = ${scope.tenantId}
          AND id = ${existing.rows[0].id}
      `.execute(db);
      return;
    }

    await sql`
      INSERT INTO hr_employee_contacts (employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by, tenant_id, account_id)
      VALUES (${employeeId}, ${contactType}, ${normalizedValue}, ${contactType === 'phone' ? 'الموبايل' : 'البريد الإلكتروني'}, ${contactType === 'phone'}, '', ${actor.userId}, ${actor.userId}, ${scope.tenantId}, ${scope.accountId})
    `.execute(db);
  }

  private async findEmployeeByContact(db: DbExecutor, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<number[]> {
    const normalized = cleanString(value);
    if (!normalized) return [];
    const scope = this.scope(actor);
    const rows = await sql<{ employee_id: number }>`
      SELECT DISTINCT c.employee_id
      FROM hr_employee_contacts c
      WHERE c.tenant_id = ${scope.tenantId}
        AND LOWER(c.contact_type) = LOWER(${contactType})
        AND LOWER(c.value) = LOWER(${normalized})
      LIMIT 3
    `.execute(db);
    return rows.rows.map((row) => Number(row.employee_id)).filter((id) => id > 0);
  }

  private async ensureCategory(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    const normalized = cleanString(name);
    if (!normalized) return null;
    const scope = this.scope(actor);
    const existing = await db.selectFrom('product_categories').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', normalized.toLowerCase()).executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await db.insertInto('product_categories').values({ name: normalized, is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
    return Number(inserted.id);
  }

  private async ensureSupplier(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    const normalized = cleanString(name);
    if (!normalized) return null;
    const scope = this.scope(actor);
    const existing = await db.selectFrom('suppliers').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', normalized.toLowerCase()).executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await db.insertInto('suppliers').values({ name: normalized, phone: '', address: '', balance: 0, notes: '', is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
    return Number(inserted.id);
  }

  private async ensureLocation(
    db: DbExecutor,
    name: string,
    actor: AuthContext,
    cache?: Map<string, { locationId: number; branchId: number | null }>,
  ): Promise<{ locationId: number; branchId: number | null } | null> {
    const normalized = cleanString(name);
    const scope = this.scope(actor);
    const cacheKey = normalized.toLowerCase();

    if (cache && cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    const activeLocations = await db
      .selectFrom('stock_locations')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('is_active', '=', true)
      .execute();

    const branch = await db
      .selectFrom('branches')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .executeTakeFirst();
    const branchId = branch ? Number(branch.id) : null;

    // Resolve tenant primary / default branch stock location (e.g. 'رصيد الفرع الرئيسي')
    const defaultLocation = (branch?.default_stock_location_id
      ? activeLocations.find((l) => Number(l.id) === Number(branch.default_stock_location_id))
      : null)
      || activeLocations.find((l) => l.location_type === 'branch_stock')
      || activeLocations.find((l) => (l.name || '').includes('رصيد'))
      || activeLocations[0]
      || null;

    let result: { locationId: number; branchId: number | null } | null = null;

    // CASE 1: Empty warehouse name -> fallback to tenant default location
    if (!normalized) {
      if (defaultLocation) {
        result = { locationId: Number(defaultLocation.id), branchId: defaultLocation.branch_id ? Number(defaultLocation.branch_id) : branchId };
      } else {
        const locName = branch ? formatBranchStockLocationName(branch.name) : 'رصيد الفرع الرئيسي';
        const inserted = await db
          .insertInto('stock_locations')
          .values({
            name: locName,
            branch_id: branchId,
            is_active: true,
            location_type: 'branch_stock',
            ...this.tenantFields(actor),
          })
          .returning(['id', 'branch_id'])
          .executeTakeFirstOrThrow();
        result = { locationId: Number(inserted.id), branchId: inserted.branch_id ? Number(inserted.branch_id) : branchId };
      }
    } else {
      // CASE 2: Exact match (case insensitive)
      const exactMatch = activeLocations.find((l) => (l.name || '').trim().toLowerCase() === normalized.toLowerCase());
      if (exactMatch) {
        result = { locationId: Number(exactMatch.id), branchId: exactMatch.branch_id ? Number(exactMatch.branch_id) : branchId };
      } else if (activeLocations.length === 1 && defaultLocation) {
        // CASE 3: Only ONE active location exists in tenant -> map to it without fracturing stock
        result = { locationId: Number(defaultLocation.id), branchId: defaultLocation.branch_id ? Number(defaultLocation.branch_id) : branchId };
      } else {
        // CASE 4: Common aliases for the default/primary location
        const cleanNorm = normalized.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();
        const isGenericDefaultAlias = [
          'المخزن الرئيسي',
          'المخزن الاساسي',
          'مخزن رئيسي',
          'المخزن',
          'الرئيسي',
          'مخزن الفرع',
          'مخزن الفرع الرئيسي',
          'رصيد الفرع',
          'رصيد الفرع الرئيسي',
          'فرع رئيسي',
          'الفرع الرئيسي',
          'main warehouse',
          'primary',
          'main',
          'default',
          'store',
          'warehouse',
        ].some((alias) => {
          const aliasNorm = alias.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();
          return cleanNorm === aliasNorm;
        });

        if (isGenericDefaultAlias && defaultLocation) {
          result = { locationId: Number(defaultLocation.id), branchId: defaultLocation.branch_id ? Number(defaultLocation.branch_id) : branchId };
        } else {
          // CASE 5: Custom location name -> create as internal_warehouse
          const inserted = await db
            .insertInto('stock_locations')
            .values({
              name: normalized,
              branch_id: branchId,
              is_active: true,
              location_type: 'internal_warehouse' as const,
              ...this.tenantFields(actor),
            })
            .returning(['id', 'branch_id'])
            .executeTakeFirstOrThrow();
          result = { locationId: Number(inserted.id), branchId: inserted.branch_id ? Number(inserted.branch_id) : branchId };
        }
      }
    }

    if (cache && result) {
      cache.set(cacheKey, result);
    }
    return result;
  }

  private async addCustomerOpeningBalance(db: DbExecutor, customerId: number, amount: number, actor: AuthContext): Promise<void> {
    if (Math.abs(amount) <= 0.0001) return;
    const scope = this.scope(actor);
    await db.insertInto('customer_ledger').values({
      customer_id: customerId,
      entry_type: 'opening_balance',
      amount,
      balance_after: amount,
      note: 'رصيد أولي من الاستيراد',
      reference_type: 'customer',
      reference_id: customerId,
      created_by: actor.userId,
      branch_id: null,
      location_id: null,
      ...this.tenantFields(actor),
    }).execute();
    await db.updateTable('customers').set({ balance: amount, updated_at: sql`NOW()` }).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
  }

  private async addSupplierOpeningBalance(db: DbExecutor, supplierId: number, amount: number, actor: AuthContext): Promise<void> {
    if (Math.abs(amount) <= 0.0001) return;
    const scope = this.scope(actor);
    await db.insertInto('supplier_ledger').values({
      supplier_id: supplierId,
      entry_type: 'opening_balance',
      amount,
      balance_after: amount,
      note: 'رصيد أولي من الاستيراد',
      reference_type: 'supplier',
      reference_id: supplierId,
      created_by: actor.userId,
      branch_id: null,
      location_id: null,
      ...this.tenantFields(actor),
    }).execute();
    await db.updateTable('suppliers').set({ balance: amount, updated_at: sql`NOW()` }).where('id', '=', supplierId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
  }

  async importProducts(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let stockQtyIgnoredOnUpdate = 0;
      const locationsCache = new Map<string, { locationId: number; branchId: number | null }>();

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const lookup = this.buildRowLookup(row);

        const arabicName = cleanString(row.name) || this.pickCell(lookup, ['اسم الصنف (إجباري)', 'اسم الصنف', 'name', 'اسم الخدمة', 'اسم البند']);
        const englishName = cleanString(row.nameEn) || this.pickCell(lookup, ['اسم الصنف (إنجليزي)', 'الاسم الإنجليزي', 'English name', 'nameEn', 'name_en']);
        const resolvedNames = resolveImportProductNames(arabicName, englishName);
        if (!resolvedNames) { skipped += 1; continue; }
        const name = resolvedNames.name;

        const categoryName = cleanString(row.categoryName || row.category || '') || this.pickCell(lookup, ['القسم', 'التصنيف', 'category', 'categoryName']);
        const categoryId = await this.ensureCategory(trx, categoryName, actor);

        const supplierName = cleanString(row.supplierName || row.supplier || '') || this.pickCell(lookup, ['المورد', 'اسم المورد', 'supplier', 'supplierName']);
        const supplierId = await this.ensureSupplier(trx, supplierName, actor);

        const warehouseName = cleanString(row.warehouseName || row.warehouse || row.store || '') || this.pickCell(lookup, ['المخزن', 'warehouse', 'store', 'الميناء', 'موقع التشوين']);
        const locInfo = await this.ensureLocation(trx, warehouseName, actor, locationsCache);
        const locationId = locInfo?.locationId ?? null;
        const locationBranchId = locInfo?.branchId ?? null;

        const barcode = normalizeBarcodeText(row.barcode) || normalizeBarcodeText(this.pickCell(lookup, ['الباركود', 'باركود', 'barcode', 'كود', 'code'])) || null;

        const rawType = cleanString(row.itemType || row.type || row['النوع'] || this.pickCell(lookup, ['النوع', 'تصنيف', 'type', 'itemType', 'item_type'])).toLowerCase();
        const itemType = ((rawType.includes('خام') || rawType === 'raw_material') ? 'raw_material' : (rawType.includes('خدم') || rawType === 'service') ? 'service' : 'product') as 'raw_material' | 'service' | 'product';

        const costPrice = toNumber((row.costPrice ?? row.cost ?? this.pickCell(lookup, ['سعر التكلفة', 'التكلفة', 'cost', 'costPrice', 'cost_price'])) || 0);
        const retailPrice = toNumber((row.retailPrice ?? row.price ?? this.pickCell(lookup, ['سعر البيع', 'السعر', 'retailPrice', 'price', 'retail_price', 'تعريفة'])) || 0);
        const rawWholesale = row.wholesalePrice ?? this.pickCell(lookup, ['سعر الجملة', 'الجملة', 'wholesalePrice', 'wholesale_price']);
        const wholesalePrice = rawWholesale != null && String(rawWholesale).trim() !== '' ? toNumber(rawWholesale) : (retailPrice || 0);
        const minStockQty = toNumber((row.minStockQty ?? row.minQty ?? this.pickCell(lookup, ['الحد الأدنى', 'حد الطلب', 'minStockQty', 'minQty', 'min_stock'])) || 0);
        const notes = cleanString((row.notes ?? this.pickCell(lookup, ['ملاحظات', 'الوصف', 'notes', 'description'])));
        const rawImageUrl = cleanString((row.imageUrl ?? row.image ?? this.pickCell(lookup, ['رابط الصورة', 'الصورة', 'image', 'imageUrl', 'image_url'])));

        const existing = barcode
          ? await trx.selectFrom('products').select(['id', 'metadata']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('barcode', '=', barcode).where('is_active', '=', true).executeTakeFirst()
          : await trx.selectFrom('products').select(['id', 'metadata']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', name.toLowerCase()).where('is_active', '=', true).executeTakeFirst();
        
        const payload = {
          name,
          name_en: resolvedNames.nameEn,
          barcode,
          category_id: categoryId,
          supplier_id: supplierId,
          item_type: itemType,
          cost_price: costPrice,
          retail_price: retailPrice,
          wholesale_price: wholesalePrice,
          min_stock_qty: minStockQty,
          notes,
        };

        let productId: number;
        if (existing) {
          productId = Number(existing.id);
          const rawStock = row.stockQty ?? this.pickCell(lookup, ['الكمية', 'stock', 'stockQty', 'qty']);
          const requestedStockQty = toNumber(rawStock);
          if (Math.abs(requestedStockQty) > 0.0001) stockQtyIgnoredOnUpdate += 1;

          let metaObj: Record<string, any> = {};
          if (typeof existing.metadata === 'string') {
            try { metaObj = JSON.parse(existing.metadata); } catch {}
          } else if (existing.metadata && typeof existing.metadata === 'object') {
            metaObj = { ...(existing.metadata as Record<string, any>) };
          }
          if (rawImageUrl) {
            metaObj.imageUrl = rawImageUrl;
          }
          const metaPayload = rawImageUrl ? { metadata: JSON.stringify(metaObj) } : {};

          await trx.updateTable('products').set({ ...payload, ...metaPayload, updated_at: sql`NOW()` }).where('id', '=', productId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
          updated += 1;
        } else {
          const rawStock = row.stockQty ?? this.pickCell(lookup, ['الكمية', 'stock', 'stockQty', 'qty']);
          const initialStockQty = toNumber(rawStock);
          const metaInsert = rawImageUrl ? JSON.stringify({ imageUrl: rawImageUrl }) : null;
          const insertedProduct = await trx.insertInto('products').values({ ...payload, metadata: metaInsert, stock_qty: initialStockQty, is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
          productId = Number(insertedProduct.id);
          if (initialStockQty > 0 && locationId != null) {
            await trx.insertInto('product_location_stock').values({ product_id: productId, branch_id: locationBranchId, location_id: locationId, qty: initialStockQty, ...this.tenantFields(actor) }).execute();
          }
          inserted += 1;
        }

        await this.syncProductUnitsFromImport(trx, productId, row, lookup, barcode, Boolean(existing), actor);
      }

      return { inserted, updated, skipped, stockQtyIgnoredOnUpdate };
    });

    await this.audit.log('استيراد أصناف', `تم استيراد/تحديث ${result.inserted + result.updated} صنف على يد ${actor.username}`, actor);
    return { ok: true, inserted: result.inserted, updated: result.updated, skipped: result.skipped, warnings: result.stockQtyIgnoredOnUpdate > 0 ? [`تم إهمال stockQty لعدد ${result.stockQtyIgnoredOnUpdate} من الأصناف الموجودة مسبقًا. استخدم إدخال الرصيد الأولي أو تعديل المخزون بدلًا من هذا.`] : [] };
  }

  private normalizeImportUnitName(name: unknown): string {
    const text = String(name || '').trim();
    if (!text) return '';
    const lower = text.toLowerCase();
    if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه', 'قطعة'].includes(lower)) return 'قطعة';
    if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام') return 'kg';
    if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'جرام') return 'g';
    if (['box', 'boxes', 'carton', 'cartons', 'كرتونه', 'كرتونة'].includes(lower)) return 'كرتونة';
    if (['packet', 'pack', 'packs', 'باكت'].includes(lower)) return 'باكت';
    if (['bottle', 'bottles', 'زجاجه', 'زجاجة'].includes(lower)) return 'زجاجة';
    if (['can', 'cans', 'علبه', 'علبة'].includes(lower)) return 'علبة';
    if (['liter', 'liters', 'ltr', 'l', 'لتر'].includes(lower)) return 'لتر';
    if (['meter', 'meters', 'm', 'متر'].includes(lower)) return 'متر';
    if (['service', 'services', 'خدمه', 'خدمة'].includes(lower)) return 'خدمة';
    return text;
  }

  private parseMultiplier(value: unknown): number | null {
    if (value == null) return null;
    const str = normalizeNumberText(value).replace(/[^\d.]/g, '');
    if (!str) return null;
    const num = Number(str);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  private async syncProductUnitsFromImport(
    trx: DbExecutor,
    productId: number,
    row: Record<string, unknown>,
    lookup: Record<string, string>,
    productBarcode: string | null,
    isExisting: boolean,
    actor: AuthContext,
  ): Promise<void> {
    const scope = this.scope(actor);

    const rawBaseUnit = cleanString(row.unitName || this.pickCell(lookup, ['وحدة القياس الأساسية', 'وحدة القياس', 'الوحدة الأساسية', 'الوحدة', 'unit', 'unitName', 'القياس']));
    const rawSaleUnit = cleanString(row.saleUnit || this.pickCell(lookup, ['وحدة البيع', 'saleUnit', 'sale_unit']));
    const rawPurchaseUnit = cleanString(row.purchaseUnit || this.pickCell(lookup, ['وحدة الشراء', 'purchaseUnit', 'purchase_unit']));
    const rawExtraUnit = cleanString(row.extraUnitName || this.pickCell(lookup, ['اسم وحدة إضافية', 'وحدة إضافية', 'الوحدة الكبرى', 'اسم الوحدة الكبرى', 'extraUnit', 'extraUnitName', 'extra_unit']));
    const rawMultiplierStr = this.pickCell(lookup, ['معامل الوحدة الإضافية', 'معامل التحويل', 'معامل الوحدة', 'التحويل', 'المعامل', 'عدد القطع في الوحدة الكبرى', 'extraUnitMultiplier', 'multiplier', 'factor']);
    const rawMultiplier = row.extraUnitMultiplier != null && String(row.extraUnitMultiplier).trim() !== ''
      ? this.parseMultiplier(row.extraUnitMultiplier)
      : rawMultiplierStr ? this.parseMultiplier(rawMultiplierStr) : null;
    const rawExtraBarcode = normalizeBarcodeText(row.extraUnitBarcode || this.pickCell(lookup, ['باركود الوحدة الإضافية', 'باركود الوحدة', 'باركود الكرتونة', 'extraUnitBarcode', 'extra_barcode'])) || null;

    const hasAnyUnitField = Boolean(
      rawBaseUnit || rawSaleUnit || rawPurchaseUnit || rawExtraUnit || (rawMultiplier !== null && rawMultiplier > 0) || rawExtraBarcode
    );

    // If existing product and no unit columns or data provided at all in this row, preserve existing units
    if (isExisting && !hasAnyUnitField) {
      return;
    }

    const baseUnitName = this.normalizeImportUnitName(rawBaseUnit) || 'قطعة';
    let extraUnitName = this.normalizeImportUnitName(rawExtraUnit);
    const saleUnitName = this.normalizeImportUnitName(rawSaleUnit);
    const purchaseUnitName = this.normalizeImportUnitName(rawPurchaseUnit);

    // If extraUnitName was not set, but purchaseUnit differs from baseUnit and multiplier > 1, infer extraUnitName
    if (!extraUnitName && purchaseUnitName && purchaseUnitName.toLowerCase() !== baseUnitName.toLowerCase() && rawMultiplier && rawMultiplier > 1) {
      extraUnitName = purchaseUnitName;
    }
    // Or if extraUnitName was not set, but saleUnit differs from baseUnit and multiplier > 1
    if (!extraUnitName && saleUnitName && saleUnitName.toLowerCase() !== baseUnitName.toLowerCase() && rawMultiplier && rawMultiplier > 1) {
      extraUnitName = saleUnitName;
    }

    const hasValidExtraUnit = Boolean(
      extraUnitName &&
      extraUnitName.toLowerCase() !== baseUnitName.toLowerCase() &&
      rawMultiplier && rawMultiplier > 0
    );

    const extraMultiplier = hasValidExtraUnit ? (rawMultiplier || 1) : 1;

    // Determine default flags
    const isBaseSaleDefault = !hasValidExtraUnit || (saleUnitName ? saleUnitName.toLowerCase() !== extraUnitName.toLowerCase() : true);
    const isExtraSaleDefault = hasValidExtraUnit && !isBaseSaleDefault;

    // For purchase default: if purchaseUnitName matches extraUnitName, or if purchaseUnitName was not specified but extraUnit is created and purchase default wasn't explicitly set to base
    let isBasePurchaseDefault = true;
    let isExtraPurchaseDefault = false;
    if (hasValidExtraUnit) {
      if (purchaseUnitName) {
        isExtraPurchaseDefault = purchaseUnitName.toLowerCase() === extraUnitName.toLowerCase();
        isBasePurchaseDefault = !isExtraPurchaseDefault;
      } else {
        isExtraPurchaseDefault = true;
        isBasePurchaseDefault = false;
      }
    }

    // Prepare units to persist
    const unitsToInsert: Array<{
      name: string;
      multiplier: number;
      barcode: string | null;
      is_base_unit: boolean;
      is_sale_unit_default: boolean;
      is_purchase_unit_default: boolean;
    }> = [];

    // Base unit
    unitsToInsert.push({
      name: baseUnitName,
      multiplier: 1,
      barcode: productBarcode || null,
      is_base_unit: true,
      is_sale_unit_default: isBaseSaleDefault,
      is_purchase_unit_default: isBasePurchaseDefault,
    });

    // Extra unit
    if (hasValidExtraUnit) {
      let extraBarcode = rawExtraBarcode;
      // Prevent duplicate barcode on same product
      if (extraBarcode && productBarcode && extraBarcode.toLowerCase() === productBarcode.toLowerCase()) {
        extraBarcode = null;
      }
      unitsToInsert.push({
        name: extraUnitName,
        multiplier: extraMultiplier,
        barcode: extraBarcode || null,
        is_base_unit: false,
        is_sale_unit_default: isExtraSaleDefault,
        is_purchase_unit_default: isExtraPurchaseDefault,
      });
    }

    // Delete existing units for this product
    await trx.deleteFrom('product_units')
      .where('product_id', '=', productId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    // Insert new units
    for (const unit of unitsToInsert) {
      // Barcode collision safety: if barcode is already claimed by another product in this tenant, null it out
      let safeBarcode = unit.barcode;
      if (safeBarcode) {
        const existingBarcode = await trx.selectFrom('product_units')
          .select(['id', 'product_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where(sql`LOWER(barcode)`, '=', safeBarcode.toLowerCase())
          .where('product_id', '!=', productId)
          .executeTakeFirst();
        if (existingBarcode) {
          safeBarcode = null;
        }
      }

      await trx.insertInto('product_units').values({
        product_id: productId,
        name: unit.name,
        multiplier: unit.multiplier,
        barcode: safeBarcode,
        is_base_unit: unit.is_base_unit,
        is_sale_unit_default: unit.is_sale_unit_default,
        is_purchase_unit_default: unit.is_purchase_unit_default,
        ...this.tenantFields(actor),
      }).execute();
    }
  }

  async importCustomers(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const name = cleanString(row.name || row['اسم العميل'] || row['اسم العميل (إجباري)'] || row['اسم المحل'] || row['اسم العميل / المحل (إجباري)']);
        if (!name) { skipped += 1; continue; }
        const phone = normalizePhoneText(row.phone || row['رقم الموبايل'] || row['الموبايل'] || row['الهاتف']);
        const existing = phone
          ? await trx.selectFrom('customers').select(['id', 'balance', 'metadata']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('phone', '=', phone).where('is_active', '=', true).executeTakeFirst()
          : await trx.selectFrom('customers').select(['id', 'balance', 'metadata']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', name.toLowerCase()).where('is_active', '=', true).executeTakeFirst();
        const openingBalance = toNumber(normalizeNumberText(row.openingBalance || row.balance || row['رصيد افتتاحي'] || 0));
        const storeCreditBalance = toNumber(normalizeNumberText(row.storeCreditBalance || row['رصيد محفظة'] || 0));

        // Customer Type resolution
        const rawType = cleanString(row.type || row['نوع العميل'] || row['نوع العميل (نقدي / آجل)']).toLowerCase();
        let customerType: 'cash' | 'vip' | 'credit' | 'wholesale' = 'cash';
        if (rawType.includes('vip') || rawType.includes('مميز')) {
          customerType = 'vip';
        } else if (rawType.includes('credit') || rawType.includes('آجل') || rawType.includes('اجل')) {
          customerType = 'credit';
        } else if (rawType.includes('wholesale') || rawType.includes('جملة') || rawType.includes('جمله')) {
          customerType = 'wholesale';
        }

        const payload = {
          name,
          phone,
          address: cleanString(row.address || row['العنوان'] || row['العنوان التفصيلي']),
          customer_type: customerType,
          credit_limit: toNumber(normalizeNumberText(row.creditLimit || row['الحد الائتماني'] || 0)),
          company_name: cleanString(row.companyName || row['اسم الشركة'] || row['اسم المنشأة / الشركة']),
          tax_number: cleanString(row.taxNumber || row['الرقم الضريبي']),
        };

        // Van & wholesale operational fields
        const customerCode = cleanString(row.customerCode || row.customer_code || row.code || row['كود المحل / العميل'] || row['كود العميل'] || row['كود المحل']);
        const route = cleanString(row.route || row['خط السير / مسار التوزيع'] || row['خط السير / المنطقة'] || row['خط السير']);
        const district = cleanString(row.district || row.area || row['الحي / المربع السكني'] || row['الحي'] || row['المنطقة']);
        const visitDay = cleanString(row.visitDay || row.visit_day || row['يوم الزيارة الأسبوعي'] || row['يوم الزيارة']);
        const rawVisitDays = cleanString(row.visitDays || row.visit_days || row['أيام الزيارة (إن تعددت)'] || row['أيام الزيارة']);
        const routeSequence = toNumber(normalizeNumberText(row.routeSequence || row.route_sequence || row['ترتيب خط السير'] || 0));
        const assignedRepName = cleanString(row.assignedRepName || row.assigned_rep_name || row.assignedRep || row['المندوب المسؤول / المخصص'] || row['المندوب المسؤول'] || row['المندوب']);
        const locationUrl = cleanString(row.locationUrl || row.location_url || row.gps || row.maps || row['رابط الموقع / GPS'] || row['رابط الموقع']);
        const priceTier = cleanString(row.priceTier || row.price_tier || row['فئة السعر']);
        const category = cleanString(row.category || row.businessType || row['نوع النشاط / التصنيف'] || row['نوع النشاط']);
        const notes = cleanString(row.notes || row['ملاحظات']);

        // Parse visit_days array
        let visitDays: string[] = [];
        if (rawVisitDays) {
          visitDays = rawVisitDays.split(/[,،]/).map((d) => d.trim()).filter(Boolean);
        } else if (visitDay) {
          visitDays = [visitDay];
        }

        // Try to match assignedRepName with delivery_representatives
        let assignedRepId: number | null = null;
        if (assignedRepName) {
          try {
            const repRow = await trx
              .selectFrom('delivery_representatives')
              .select(['id', 'name'])
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where('is_active', '=', true)
              .where((eb) => eb.or([
                eb('name', '=', assignedRepName),
                eb(sql`LOWER(name)`, '=', assignedRepName.toLowerCase()),
                eb('id', '=', Number(assignedRepName) || -1),
              ]))
              .executeTakeFirst();
            if (repRow?.id) {
              assignedRepId = Number(repRow.id);
            }
          } catch {
            // Gracefully ignore if delivery_representatives not in current mock/context
          }
        }

        // Parse existing metadata if any
        let existingMeta: Record<string, unknown> = {};
        if (existing?.metadata) {
          if (typeof existing.metadata === 'string') {
            try { existingMeta = JSON.parse(existing.metadata); } catch { existingMeta = {}; }
          } else if (typeof existing.metadata === 'object') {
            existingMeta = { ...existing.metadata };
          }
        }

        const metaPayload: Record<string, unknown> = { ...existingMeta };
        if (customerCode) {
          metaPayload.customer_code = customerCode;
          metaPayload.code = customerCode;
        }
        if (route) metaPayload.route = route;
        if (district) {
          metaPayload.district = district;
          metaPayload.area = district;
        }
        if (visitDay) metaPayload.visit_day = visitDay;
        if (visitDays.length > 0) metaPayload.visit_days = visitDays;
        if (routeSequence > 0) metaPayload.route_sequence = routeSequence;
        if (assignedRepName) metaPayload.assigned_rep_name = assignedRepName;
        if (assignedRepId) metaPayload.assigned_rep_id = assignedRepId;
        if (locationUrl) metaPayload.location_url = locationUrl;
        if (priceTier) metaPayload.price_tier = priceTier;
        if (category) metaPayload.category = category;
        if (notes) metaPayload.notes = notes;

        if (existing) {
          if (!metaPayload.customer_code && !metaPayload.code) {
            const defaultCode = `C-${String(existing.id).padStart(4, '0')}`;
            metaPayload.customer_code = defaultCode;
            metaPayload.code = defaultCode;
          }
          await trx.updateTable('customers').set({
            ...payload,
            store_credit_balance: storeCreditBalance,
            metadata: JSON.stringify(metaPayload),
            updated_at: sql`NOW()`,
          }).where('id', '=', Number(existing.id)).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
          updated += 1;
        } else {
          const insertedRow = await trx.insertInto('customers').values({
            ...payload,
            balance: 0,
            store_credit_balance: storeCreditBalance,
            metadata: JSON.stringify(metaPayload),
            is_active: true,
            ...this.tenantFields(actor),
          }).returning('id').executeTakeFirstOrThrow();

          const newId = Number(insertedRow.id);
          const finalCode = customerCode || `C-${String(newId).padStart(4, '0')}`;
          if (!metaPayload.customer_code || metaPayload.customer_code !== finalCode) {
            metaPayload.customer_code = finalCode;
            metaPayload.code = finalCode;
            await trx.updateTable('customers')
              .set({ metadata: JSON.stringify(metaPayload) })
              .where('id', '=', newId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();
          }

          await this.addCustomerOpeningBalance(trx, newId, openingBalance, actor);
          inserted += 1;
        }
      }

      return { inserted, updated, skipped };
    });

    await this.audit.log('استيراد عملاء', `تم استيراد/تحديث ${result.inserted + result.updated} عميل على يد ${actor.username}`, actor);
    return { ok: true, inserted: result.inserted, updated: result.updated, skipped: result.skipped };
  }

  async importSuppliers(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const name = cleanString(row.name);
        if (!name) { skipped += 1; continue; }
        const phone = cleanString(row.phone);
        const existing = phone
          ? await trx.selectFrom('suppliers').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('phone', '=', phone).where('is_active', '=', true).executeTakeFirst()
          : await trx.selectFrom('suppliers').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', name.toLowerCase()).where('is_active', '=', true).executeTakeFirst();
        const openingBalance = toNumber(row.openingBalance || row.balance || 0);
        const payload = { name, phone, address: cleanString(row.address), notes: cleanString(row.notes) };

        if (existing) {
          await trx.updateTable('suppliers').set({ ...payload, updated_at: sql`NOW()` }).where('id', '=', Number(existing.id)).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
          updated += 1;
        } else {
          const insertedRow = await trx.insertInto('suppliers').values({ ...payload, balance: 0, is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
          await this.addSupplierOpeningBalance(trx, Number(insertedRow.id), openingBalance, actor);
          inserted += 1;
        }
      }

      return { inserted, updated, skipped };
    });

    await this.audit.log('استيراد موردين', `تم استيراد/تحديث ${result.inserted + result.updated} مورد على يد ${actor.username}`, actor);
    return { ok: true, inserted: result.inserted, updated: result.updated, skipped: result.skipped };
  }

  async importOpeningStock(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let updated = 0;
      const locationsCache = new Map<string, { locationId: number; branchId: number | null }>();

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const productId = toNumber(row.productId || 0);
        const productName = cleanString(row.productName || row.name);
        const qty = toNumber(row.qty || row.quantity || 0);
        if (qty < 0) continue;

        const barcode = normalizeBarcodeText(row.barcode);

        let productQuery = trx.selectFrom('products').select(['id', 'name', 'stock_qty'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true);

        if (productId > 0) {
          productQuery = productQuery.where('id', '=', productId);
        } else if (barcode) {
          productQuery = productQuery.where('barcode', '=', barcode);
        } else {
          productQuery = productQuery.where(sql`LOWER(name)`, '=', productName.toLowerCase());
        }

        const product = await productQuery.executeTakeFirst();
        if (!product) continue;

        const locInfo = await this.ensureLocation(trx, cleanString(row.warehouseName || row.warehouse || row.store || ''), actor, locationsCache);
        const branchId = toNumber(row.branchId || row.branch || 0) || locInfo?.branchId || null;
        const locationId = locInfo?.locationId || (toNumber(row.locationId || row.location || 0) || null);
        
        const stockChange = await setScopedStockQty(trx, { productId: Number(product.id), nextQty: qty, branchId, locationId, tenantId: scope.tenantId, accountId: scope.accountId });
        
        const actualDelta = stockChange.scopeAfter - stockChange.scopeBefore;
        if (actualDelta === 0) continue;

        await trx.insertInto('stock_movements').values({
          product_id: Number(product.id),
          movement_type: 'opening_stock',
          qty: Math.abs(actualDelta),
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'inventory_adjustment',
          note: 'تسوية مخزون',
          reference_type: 'product',
          reference_id: product.id,
          tenant_id: scope.tenantId,
          created_by: actor.userId,
          branch_id: branchId,
          location_id: locationId,
          ...this.tenantFields(actor),
        }).execute();
        updated += 1;
      }

      return { updated };
    });

    await this.audit.log('استيراد مخزون افتتاحي', `تم تحديث ${result.updated} سجل مخزون على يد ${actor.username}`, actor);
    return { ok: true, updated: result.updated };
  }

  async importEmployees(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST) throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);

    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      const warnings: string[] = [];

      for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2;
        const raw = rows[index];
        const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const lookup = this.buildRowLookup(row);

        const fullName = this.pickCell(lookup, ['اسم الموظف', 'اسم العامل', 'الموظف', 'الاسم', 'employee name', 'employee_name', 'employeename', 'full name', 'fullname', 'full_name', 'name', 'displayname', 'display_name']);
        const explicitFirstName = this.pickCell(lookup, ['الاسم الأول', 'first name', 'firstname', 'first_name']);
        const explicitLastName = this.pickCell(lookup, ['الاسم الأخير', 'last name', 'lastname', 'last_name']);
        const nameParts = cleanString(fullName).split(/\s+/).filter(Boolean);
        const firstName = cleanString(explicitFirstName || nameParts[0] || '');
        const lastName = cleanString(explicitLastName || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''));
        const displayName = cleanString(`${firstName} ${lastName}`);

        if (!firstName) { warnings.push(`الصف ${rowNumber}: اسم الموظف مطلوب.`); continue; }

        const employeeNoRaw = normalizeArabicDigits(this.pickCell(lookup, ['كود الموظف', 'رقم الموظف', 'employee no', 'employee_no', 'employee code', 'code']));
        const employeeNoDigits = digitsOnly(employeeNoRaw);
        if (employeeNoRaw && !employeeNoDigits) { warnings.push(`الصف ${rowNumber}: كود الموظف يجب أن يحتوي أرقامًا فقط.`); continue; }
        const employeeNo = employeeNoDigits ? employeeNoDigits.padStart(3, '0') : '';

        const nationalIdText = digitsOnly(this.pickCell(lookup, ['الرقم القومي', 'رقم قومي', 'رقم الهوية', 'national id', 'national_id', 'nationalid', 'id number']));
        if (nationalIdText && nationalIdText.length !== 14) { warnings.push(`الصف ${rowNumber}: الرقم القومي يجب أن يكون 14 رقمًا.`); continue; }

        const hireDateRaw = this.pickCell(lookup, ['تاريخ التعيين', 'hire date', 'hiredate', 'hire_date']);
        const hireDate = hireDateRaw ? parseDateOnly(hireDateRaw) : null;
        if (hireDateRaw && !hireDate) { warnings.push(`الصف ${rowNumber}: تاريخ التعيين غير صحيح.`); continue; }

        const compensationType = this.normalizeCompensationType(this.pickCell(lookup, ['نوع الأجر', 'compensation type', 'compensation_type']));
        const hourlyRateText = this.pickCell(lookup, ['أجر الساعة', 'hourly rate', 'hourly_rate']);
        const expectedDailyHoursText = this.pickCell(lookup, ['ساعات العمل اليومية', 'ساعات العمل اليومية المتوقعة', 'expected daily hours', 'expected_daily_hours']);
        const graceMinutesText = this.pickCell(lookup, ['فترة السماح', 'فترة السماح بالدقائق', 'grace minutes', 'grace_minutes']);
        const hourlyRate = toNumericOrNull(hourlyRateText);
        const expectedDailyHours = toNumericOrNull(expectedDailyHoursText);
        const graceMinutes = toNumericOrNull(graceMinutesText);
        if (hourlyRateText && hourlyRate == null) { warnings.push(`الصف ${rowNumber}: أجر الساعة غير صالح.`); continue; }
        if (expectedDailyHoursText && expectedDailyHours == null) { warnings.push(`الصف ${rowNumber}: ساعات العمل اليومية غير صالحة.`); continue; }
        if (graceMinutesText && graceMinutes == null) { warnings.push(`الصف ${rowNumber}: فترة السماح غير صالحة.`); continue; }

        const scheduledCheckInRaw = this.pickCell(lookup, ['موعد الحضور', 'scheduled check in', 'scheduled_check_in_time', 'check in']);
        const scheduledCheckOutRaw = this.pickCell(lookup, ['موعد الانصراف', 'scheduled check out', 'scheduled_check_out_time', 'check out']);
        const scheduledCheckInTime = this.normalizeTimeOnly(scheduledCheckInRaw);
        const scheduledCheckOutTime = this.normalizeTimeOnly(scheduledCheckOutRaw);
        if (scheduledCheckInRaw && !scheduledCheckInTime) { warnings.push(`الصف ${rowNumber}: موعد الحضور غير صحيح.`); continue; }
        if (scheduledCheckOutRaw && !scheduledCheckOutTime) { warnings.push(`الصف ${rowNumber}: موعد الانصراف غير صحيح.`); continue; }

        const status = this.normalizeEmployeeStatus(this.pickCell(lookup, ['الحالة', 'status']));
        const overtimePolicy = this.normalizeOvertimePolicy(this.pickCell(lookup, ['سياسة الإضافي', 'overtime policy', 'overtime_policy']));
        const phone = normalizePhoneText(this.pickCell(lookup, ['رقم الهاتف', 'الموبايل', 'mobile', 'phoneNumber', 'phone number', 'phonenumber', 'phone']));
        const email = cleanString(this.pickCell(lookup, ['البريد الإلكتروني', 'email'])).toLowerCase();
        const notes = cleanString(this.pickCell(lookup, ['ملاحظات', 'notes']));

        const departmentId = await this.ensureHrMasterName(trx, 'hr_departments', this.pickCell(lookup, ['القسم', 'الإدارة', 'department']), actor);
        const jobTitleId = await this.ensureHrMasterName(trx, 'hr_job_titles', this.pickCell(lookup, ['الوظيفة', 'المسمى الوظيفي', 'job title', 'job_title', 'jobtitle']), actor);
        const positionId = await this.ensureHrMasterName(trx, 'hr_positions', this.pickCell(lookup, ['المنصب', 'position']), actor);

        const matchedIds = new Set<number>();
        if (employeeNo) {
          const byCode = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND employee_no = ${employeeNo} LIMIT 2`.execute(trx);
          for (const rowMatch of byCode.rows) matchedIds.add(Number(rowMatch.id));
        } else {
          if (nationalIdText) {
            const byNational = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND national_id = ${nationalIdText} LIMIT 2`.execute(trx);
            for (const rowMatch of byNational.rows) matchedIds.add(Number(rowMatch.id));
          }
          if (phone) for (const id of await this.findEmployeeByContact(trx, 'phone', phone, actor)) matchedIds.add(id);
          if (email) for (const id of await this.findEmployeeByContact(trx, 'email', email, actor)) matchedIds.add(id);
          if (!matchedIds.size && displayName) {
            const byName = await sql<{ id: number }>`SELECT id FROM hr_employees WHERE tenant_id = ${scope.tenantId} AND LOWER(display_name) = LOWER(${displayName}) LIMIT 2`.execute(trx);
            for (const rowMatch of byName.rows) matchedIds.add(Number(rowMatch.id));
          }
        }

        if (matchedIds.size > 1) { warnings.push(`الصف ${rowNumber}: تعذر تحديد موظف واحد بسبب تكرار محتمل. استخدم كود موظف واضح.`); continue; }

        const existingId = matchedIds.size === 1 ? Array.from(matchedIds)[0] : null;
        if (existingId) {
          await sql`
            UPDATE hr_employees
            SET employee_no = COALESCE(NULLIF(${employeeNo}, ''), employee_no),
                first_name = ${firstName}, last_name = ${lastName}, display_name = ${displayName}, national_id = ${nationalIdText || null}, status = ${status},
                department_id = ${departmentId}, job_title_id = ${jobTitleId}, position_id = ${positionId}, hire_date = ${hireDate}, compensation_type = ${compensationType},
                hourly_rate = ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null}, expected_daily_hours = ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null},
                scheduled_check_in_time = ${scheduledCheckInTime || null}, scheduled_check_out_time = ${scheduledCheckOutTime || null}, grace_minutes = ${Math.max(0, Math.floor(Number(graceMinutes || 0)))},
                overtime_policy = ${overtimePolicy}, notes = ${notes}, updated_by = ${actor.userId}, updated_at = NOW()
            WHERE tenant_id = ${scope.tenantId} AND id = ${existingId}
          `.execute(trx);
          if (phone) await this.upsertEmployeeContact(trx, existingId, 'phone', phone, actor);
          if (email) await this.upsertEmployeeContact(trx, existingId, 'email', email, actor);
          updated += 1;
          continue;
        }

        const generatedEmployeeNo = employeeNo || await this.nextAvailableEmployeeNo(trx, actor);
        const insertedEmployee = await sql<{ id: number }>`
          INSERT INTO hr_employees (employee_no, national_id, first_name, last_name, display_name, status, department_id, job_title_id, position_id, hire_date, notes, compensation_type, hourly_rate, expected_daily_hours, scheduled_check_in_time, scheduled_check_out_time, grace_minutes, overtime_policy, created_by, updated_by, tenant_id, account_id)
          VALUES (${generatedEmployeeNo}, ${nationalIdText || null}, ${firstName}, ${lastName}, ${displayName}, ${status}, ${departmentId}, ${jobTitleId}, ${positionId}, ${hireDate}, ${notes}, ${compensationType}, ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null}, ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null}, ${scheduledCheckInTime || null}, ${scheduledCheckOutTime || null}, ${Math.max(0, Math.floor(Number(graceMinutes || 0)))}, ${overtimePolicy}, ${actor.userId}, ${actor.userId}, ${scope.tenantId}, ${scope.accountId})
          RETURNING id
        `.execute(trx);
        const employeeId = Number(insertedEmployee.rows[0]?.id || 0);
        if (employeeId <= 0) { warnings.push(`الصف ${rowNumber}: تعذر حفظ الموظف.`); continue; }
        if (phone) await this.upsertEmployeeContact(trx, employeeId, 'phone', phone, actor);
        if (email) await this.upsertEmployeeContact(trx, employeeId, 'email', email, actor);
        inserted += 1;
      }

      return { inserted, updated, warnings };
    });

    await this.audit.log('استيراد موظفين', `تم استيراد/تحديث ${result.inserted + result.updated} موظف على يد ${actor.username}`, actor);
    return { ok: true, inserted: result.inserted, updated: result.updated, warnings: result.warnings };
  }
}
