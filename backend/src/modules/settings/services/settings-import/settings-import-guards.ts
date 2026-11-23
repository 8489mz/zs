import { ForbiddenException } from '@nestjs/common';
import { sql } from '../../../../database/kysely';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { formatBranchStockLocationName } from '../../../../common/utils/branch-stock.util';
import { normalizeImportKey, cleanString, normalizeArabicDigits } from './settings-import-shared';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope, DbExecutor } from './settings-import-shared';

export class SettingsImportGuards {
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

  scope(actor: AuthContext): TenantScope {
    return requireTenantScope(actor);
  }

  tenantFields(actor: AuthContext): Record<string, string> {
    const scope = this.scope(actor);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  buildRowLookup(row: Record<string, unknown>): Record<string, string> {
    const lookup: Record<string, string> = {};
    for (const [key, value] of Object.entries(row || {})) {
      lookup[normalizeImportKey(key)] = String(value ?? '').trim();
    }
    return lookup;
  }

  pickCell(lookup: Record<string, string>, aliases: string[]): string {
    for (const alias of aliases) {
      const value = lookup[normalizeImportKey(alias)];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  normalizeEmployeeStatus(value: unknown): 'active' | 'inactive' | 'deactivated' | 'terminated' {
    const normalized = cleanString(value).toLowerCase();
    if (['inactive', 'غير نشط'].includes(normalized)) return 'inactive';
    if (['deactivated', 'موقوف'].includes(normalized)) return 'deactivated';
    if (['terminated', 'منتهي الخدمة'].includes(normalized)) return 'terminated';
    return 'active';
  }

  normalizeCompensationType(value: unknown): 'monthly' | 'hourly' {
    const normalized = cleanString(value).toLowerCase();
    if (['hourly', 'بالساعة', 'أجر بالساعة'].includes(normalized)) return 'hourly';
    return 'monthly';
  }

  normalizeOvertimePolicy(value: unknown): 'review_only' | 'disabled' | 'auto_approved' {
    const normalized = cleanString(value).toLowerCase();
    if (['disabled', 'غير محتسب'].includes(normalized)) return 'disabled';
    if (['auto_approved', 'محتسب تلقائيًا'].includes(normalized)) return 'auto_approved';
    return 'review_only';
  }

  normalizeTimeOnly(value: unknown): string | null {
    const text = normalizeArabicDigits(value).trim();
    if (!text) return null;
    const matched = text.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!matched) return null;
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  async ensureHrMasterName(db: DbExecutor, table: 'hr_departments' | 'hr_job_titles' | 'hr_positions', name: string, actor: AuthContext): Promise<number | null> {
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

  async nextAvailableEmployeeNo(db: DbExecutor, actor: AuthContext): Promise<string> {
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

  async upsertEmployeeContact(db: DbExecutor, employeeId: number, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<void> {
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

  async findEmployeeByContact(db: DbExecutor, contactType: 'phone' | 'email', value: string, actor: AuthContext): Promise<number[]> {
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

  async ensureCategory(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    const normalized = cleanString(name);
    if (!normalized) return null;
    const scope = this.scope(actor);
    const existing = await db.selectFrom('product_categories').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', normalized.toLowerCase()).executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await db.insertInto('product_categories').values({ name: normalized, is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
    return Number(inserted.id);
  }

  async ensureSupplier(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    const normalized = cleanString(name);
    if (!normalized) return null;
    const scope = this.scope(actor);
    const existing = await db.selectFrom('suppliers').select(['id']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where(sql`LOWER(name)`, '=', normalized.toLowerCase()).executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await db.insertInto('suppliers').values({ name: normalized, phone: '', address: '', balance: 0, notes: '', is_active: true, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
    return Number(inserted.id);
  }

  async ensureLocation(
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
}
