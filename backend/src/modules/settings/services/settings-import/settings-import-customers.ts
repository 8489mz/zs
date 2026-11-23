import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { MAX_IMPORT_ROWS_PER_REQUEST, cleanString, normalizePhoneText, toNumber, normalizeNumberText } from './settings-import-shared';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { DbExecutor, TenantScope } from './settings-import-shared';

export class SettingsImportCustomers {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => TenantScope;
      tenantFields: (actor: AuthContext) => Record<string, string>;
      addCustomerOpeningBalance: (db: DbExecutor, customerId: number, amount: number, actor: AuthContext) => Promise<void>;
    },
  ) {}

  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantFields(actor: AuthContext): Record<string, string> {
    return this.bound.tenantFields(actor);
  }
  private async addCustomerOpeningBalance(db: DbExecutor, customerId: number, amount: number, actor: AuthContext): Promise<void> {
    return this.bound.addCustomerOpeningBalance(db, customerId, amount, actor);
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
}
