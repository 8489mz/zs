import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { normalizeArabicSearch } from '../../common/utils/arabic-search.util';
import { getTenantTimezone, normalizePgDateOnly, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import {
  PricingBulkSetProfileDto,
  PricingPreviewPayload,
  PricingPreviewRow,
  PricingRuleListQueryDto,
  PricingRuleMatchDto,
  PricingRuleUpsertDto,
} from './dto/pricing-preview.dto';

type ProductSourceRow = {
  id: number;
  name: string;
  barcode: string | null;
  item_kind: 'standard' | 'fashion' | null;
  style_code: string | null;
  category_id: number | null;
  supplier_id: number | null;
  cost_price: string | number;
  retail_price: string | number;
  wholesale_price: string | number;
  stock_qty: string | number;
  is_active: boolean;
};

type OfferRow = { product_id: number; is_active: boolean; start_date: string | null; end_date: string | null };
type CustomerPriceRow = { product_id: number };
type PricingProfileRow = { product_id: number; pricing_group_key: string | null; pricing_mode: 'standard' | 'inherit' | 'manual' };
type RunRow = { id: number; filters_json: string; operation_json: string; options_json: string; summary_json: string; status: string; created_at: Date | string; created_by: number | null; undone_at: Date | string | null; undone_by: number | null; affected_count: number; display_name: string | null; username: string | null };
type RunItemRow = { product_id: number; old_retail_price: string | number; old_wholesale_price: string | number };
type PricingRuleRow = { id: number; name: string; supplier_id: number | null; category_id: number | null; item_kind: 'standard' | 'fashion' | null; style_code: string | null; operation_type: PricingPreviewPayload['operation']['type']; operation_value: string | number; targets_json: string; rounding_mode: PricingPreviewPayload['rounding']['mode']; rounding_nearest_step: string | number | null; rounding_ending: number | null; options_json: string; notes: string; is_active: boolean; created_at: Date | string; updated_at: Date | string; created_by: number | null; updated_by: number | null; display_name: string | null; username: string | null };

@Injectable()
export class PricingService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>, private readonly audit: AuditService) {}

  private tenantScope(actor: AuthContext) { return requireTenantScope(actor); }
  private tenantPredicate(actor: AuthContext, alias?: string) { const scope = this.tenantScope(actor); return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}` : sql<boolean>`tenant_id = ${scope.tenantId}`; }
  private tenantFields(actor: AuthContext) { const scope = this.tenantScope(actor); return { tenant_id: scope.tenantId, account_id: scope.accountId }; }

  async preview(payload: PricingPreviewPayload, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.buildPreview(payload, { paginate: true }, actor);
  }

  async apply(payload: PricingPreviewPayload, actor: AuthContext): Promise<Record<string, unknown>> {
    const fullPreview = await this.buildPreview(payload, { paginate: false }, actor);
    const changedRows = fullPreview.rows.filter((row) => !row.skipped && row.changed);
    if (!changedRows.length) throw new AppError('لا توجد تغييرات قابلة للتطبيق بعد المعاينة.', 'PRICING_NO_EFFECTIVE_CHANGES', 400);
    const preview = this.paginatePreviewRows(fullPreview.rows, payload.paging, fullPreview.summary);
    // Canonical lock order: Sort ascending by productId (Invariant #13)
    const sortedChangedRows = [...changedRows].sort((a, b) => a.productId - b.productId);
    const runId = await this.db.transaction().execute(async (trx) => {
      const insertedRun = await trx.insertInto('price_change_runs').values({
        filters_json: JSON.stringify(payload.filters || {}),
        operation_json: JSON.stringify({ operation: payload.operation, targets: payload.targets, rounding: payload.rounding }),
        options_json: JSON.stringify(payload.options || {}),
        summary_json: JSON.stringify(fullPreview.summary || {}),
        affected_count: sortedChangedRows.length,
        status: 'applied',
        created_by: actor.userId,
        ...this.tenantFields(actor),
      }).returning('id').executeTakeFirstOrThrow();
      const runIdValue = Number(insertedRun.id);
      await trx.insertInto('price_change_items').values(sortedChangedRows.map((row) => ({
        run_id: runIdValue,
        product_id: row.productId,
        old_retail_price: row.retailPriceBefore,
        new_retail_price: row.retailPriceAfter,
        old_wholesale_price: row.wholesalePriceBefore,
        new_wholesale_price: row.wholesalePriceAfter,
        has_active_offer: row.hasActiveOffer,
        has_customer_price: row.hasCustomerPrice,
        ...this.tenantFields(actor),
      }))).execute();
      for (const row of sortedChangedRows) {
        await trx.updateTable('products').set({ retail_price: row.retailPriceAfter, wholesale_price: row.wholesalePriceAfter, updated_at: sql`NOW()` }).where('id', '=', row.productId).where(this.tenantPredicate(actor)).execute();
      }
      return runIdValue;
    });
    await this.audit.log('موجة تسعير', `تم تنفيذ موجة تسعير رقم #${runId} على ${sortedChangedRows.length} صنف بواسطة ${actor.username}`, actor);
    return { ok: true, runId, preview };
  }

  async listRuns(actor: AuthContext): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('price_change_runs as runs').leftJoin('users as users', 'users.id', 'runs.created_by').select(['runs.id', 'runs.filters_json', 'runs.operation_json', 'runs.options_json', 'runs.summary_json', 'runs.status', 'runs.created_at', 'runs.created_by', 'runs.undone_at', 'runs.undone_by', 'runs.affected_count', 'users.display_name', 'users.username']).where(this.tenantPredicate(actor, 'runs')).orderBy('runs.id', 'desc').limit(50).execute() as RunRow[];
    const latestAppliedId = rows.find((row) => row.status === 'applied')?.id ?? null;
    return { runs: rows.map((row) => ({ id: Number(row.id), createdAt: row.created_at, createdBy: row.display_name || row.username || 'مستخدم', status: row.status, affectedCount: Number(row.affected_count || 0), filters: this.safeJsonParse(row.filters_json), operation: this.safeJsonParse(row.operation_json), options: this.safeJsonParse(row.options_json), summary: this.safeJsonParse(row.summary_json), undoneAt: row.undone_at, canUndo: row.status === 'applied' && Number(row.id) === Number(latestAppliedId || 0) })) };
  }

  async undo(runId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    await this.db.transaction().execute(async (trx) => {
      const run = await trx.selectFrom('price_change_runs').select(['id', 'status']).where('id', '=', runId).where(this.tenantPredicate(actor)).forUpdate().executeTakeFirst();
      if (!run) throw new AppError('موجة التسعير غير موجودة.', 'PRICING_RUN_NOT_FOUND', 404);
      if (run.status !== 'applied') throw new AppError('لا يمكن التراجع عن هذه الموجة.', 'PRICING_RUN_UNDO_FORBIDDEN', 400);

      const latestApplied = await trx.selectFrom('price_change_runs').select(['id']).where('status', '=', 'applied').where(this.tenantPredicate(actor)).orderBy('id', 'desc').forUpdate().executeTakeFirst();
      if (!latestApplied || Number(latestApplied.id) !== runId) throw new AppError('التراجع متاح فقط لآخر موجة تسعير مطبقة.', 'PRICING_RUN_NOT_LATEST', 400);

      const items = await trx.selectFrom('price_change_items').select(['product_id', 'old_retail_price', 'old_wholesale_price']).where('run_id', '=', runId).where(this.tenantPredicate(actor)).execute() as RunItemRow[];
      const sortedItems = [...items].sort((a, b) => Number(a.product_id) - Number(b.product_id));

      for (const item of sortedItems) {
        await trx.updateTable('products').set({ retail_price: Number(item.old_retail_price || 0), wholesale_price: Number(item.old_wholesale_price || 0), updated_at: sql`NOW()` }).where('id', '=', Number(item.product_id)).where(this.tenantPredicate(actor)).execute();
      }
      await trx.updateTable('price_change_runs').set({ status: 'undone', undone_at: sql`NOW()`, undone_by: actor.userId }).where('id', '=', runId).where(this.tenantPredicate(actor)).execute();
    });
    await this.audit.log('تراجع موجة تسعير', `تم التراجع عن موجة التسعير رقم #${runId} بواسطة ${actor.username}`, actor);
    return { ok: true, runId };
  }


  async bulkSetProfiles(payload: PricingBulkSetProfileDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const productIds = Array.from(new Set((payload.productIds || []).map((id) => Number(id)).filter((id) => id > 0)));
    if (!productIds.length) throw new AppError('اختر صنفًا واحدًا على الأقل لتحديث ملف التوريث أو الاستثناء.', 'PRICING_PROFILE_EMPTY_SCOPE', 400);
    const requestedMode = payload.profile.pricingMode;
    const requestedGroupKey = this.normalizeGroupKey(payload.profile.pricingGroupKey);
    const preserveExistingGroupKey = Boolean(payload.profile.preserveExistingGroupKey);
    const existingProducts = await this.db.selectFrom('products').select(['id']).where('id', 'in', productIds).where(this.tenantPredicate(actor)).execute();
    if (existingProducts.length !== productIds.length) throw new AppError('بعض الأصناف المحددة غير موجودة أو تم حذفها.', 'PRICING_PROFILE_PRODUCT_NOT_FOUND', 404);
    const existingProfiles = await this.db.selectFrom('product_pricing_profiles').select(['product_id', 'pricing_group_key', 'pricing_mode']).where('product_id', 'in', productIds).where(this.tenantPredicate(actor)).execute() as PricingProfileRow[];
    const existingMap = new Map(existingProfiles.map((row) => [Number(row.product_id), row]));
    await this.db.transaction().execute(async (trx) => {
      for (const productId of productIds) {
        const current = existingMap.get(productId);
        let nextGroupKey = requestedGroupKey;
        if (!nextGroupKey && preserveExistingGroupKey) nextGroupKey = this.normalizeGroupKey(current?.pricing_group_key || '');
        if (requestedMode === 'inherit' && !nextGroupKey) throw new AppError('وضع التوريث يحتاج مفتاح مجموعة تسعير حتى يمكن توسيع الموجات على بقية الأصناف.', 'PRICING_PROFILE_GROUP_REQUIRED', 400);
        if (requestedMode === 'standard' && !preserveExistingGroupKey && payload.profile.pricingGroupKey === undefined) nextGroupKey = null;
        if (current) {
          await trx.updateTable('product_pricing_profiles').set({ pricing_mode: requestedMode, pricing_group_key: nextGroupKey, updated_by: actor.userId, updated_at: sql`NOW()` }).where('product_id', '=', productId).where(this.tenantPredicate(actor)).execute();
        } else {
          await trx.insertInto('product_pricing_profiles').values({ product_id: productId, pricing_mode: requestedMode, pricing_group_key: nextGroupKey, created_by: actor.userId, updated_by: actor.userId, ...this.tenantFields(actor) }).execute();
        }
      }
    });
    await this.audit.log('ملفات تسعير', `تم تحديث ملفات التوريث/الاستثناء لعدد ${productIds.length} صنف إلى الوضع ${requestedMode} بواسطة ${actor.username}`, actor);
    return { ok: true, updatedCount: productIds.length, pricingMode: requestedMode, pricingGroupKey: requestedGroupKey, preserveExistingGroupKey };
  }

  async listRules(query: PricingRuleListQueryDto, actor: AuthContext): Promise<Record<string, unknown>> {
    let qb = this.db.selectFrom('pricing_rules as rules').leftJoin('users as users', 'users.id', 'rules.created_by').select(['rules.id', 'rules.name', 'rules.supplier_id', 'rules.category_id', 'rules.item_kind', 'rules.style_code', 'rules.operation_type', 'rules.operation_value', 'rules.targets_json', 'rules.rounding_mode', 'rules.rounding_nearest_step', 'rules.rounding_ending', 'rules.options_json', 'rules.notes', 'rules.is_active', 'rules.created_at', 'rules.updated_at', 'rules.created_by', 'rules.updated_by', 'users.display_name', 'users.username']).where(this.tenantPredicate(actor, 'rules'));
    if (query.activeOnly) qb = qb.where('rules.is_active', '=', true);
    if (query.supplierId) qb = qb.where('rules.supplier_id', '=', Number(query.supplierId));
    if (query.categoryId) qb = qb.where('rules.category_id', '=', Number(query.categoryId));
    if (query.itemKind) qb = qb.where('rules.item_kind', '=', query.itemKind);
    if (query.styleCode) qb = qb.where('rules.style_code', 'ilike', `%${String(query.styleCode).trim()}%`);
    const rows = await qb.orderBy('rules.is_active', 'desc').orderBy('rules.id', 'desc').limit(100).execute() as PricingRuleRow[];
    return { rules: rows.map((row) => this.mapRuleRow(row)) };
  }

  async upsertRule(payload: PricingRuleUpsertDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const normalized = this.normalizeRulePayload(payload);
    const values = { name: normalized.name, supplier_id: normalized.filters.supplierId || null, category_id: normalized.filters.categoryId || null, item_kind: normalized.filters.itemKind || null, style_code: this.normalizeGroupKey(normalized.filters.styleCode), operation_type: normalized.operation.type, operation_value: normalized.operation.value, targets_json: JSON.stringify(normalized.targets), rounding_mode: normalized.rounding.mode, rounding_nearest_step: normalized.rounding.mode === 'nearest' ? Number(normalized.rounding.nearestStep || 0.5) : null, rounding_ending: normalized.rounding.mode === 'ending' ? Number(normalized.rounding.ending || 95) : null, options_json: JSON.stringify(normalized.options), notes: String(payload.notes || '').trim(), is_active: payload.isActive !== false, updated_by: actor.userId, updated_at: new Date().toISOString() };
    let ruleId = Number(payload.id || 0);
    if (ruleId > 0) {
      const existing = await this.db.selectFrom('pricing_rules').select(['id']).where('id', '=', ruleId).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (!existing) throw new AppError('قاعدة التسعير غير موجودة.', 'PRICING_RULE_NOT_FOUND', 404);
      await this.db.updateTable('pricing_rules').set(values).where('id', '=', ruleId).where(this.tenantPredicate(actor)).execute();
    } else {
      const inserted = await this.db.insertInto('pricing_rules').values({ ...values, created_by: actor.userId, ...this.tenantFields(actor) }).returning('id').executeTakeFirstOrThrow();
      ruleId = Number(inserted.id);
    }
    const rule = await this.getRuleById(ruleId, actor);
    await this.audit.log('قواعد التسعير', `تم حفظ قاعدة التسعير ${normalized.name} (#${ruleId}) بواسطة ${actor.username}`, actor);
    return { ok: true, rule };
  }

  async matchRule(payload: PricingRuleMatchDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const activeRules = await this.db.selectFrom('pricing_rules as rules').leftJoin('users as users', 'users.id', 'rules.created_by').select(['rules.id', 'rules.name', 'rules.supplier_id', 'rules.category_id', 'rules.item_kind', 'rules.style_code', 'rules.operation_type', 'rules.operation_value', 'rules.targets_json', 'rules.rounding_mode', 'rules.rounding_nearest_step', 'rules.rounding_ending', 'rules.options_json', 'rules.notes', 'rules.is_active', 'rules.created_at', 'rules.updated_at', 'rules.created_by', 'rules.updated_by', 'users.display_name', 'users.username']).where('rules.is_active', '=', true).where(this.tenantPredicate(actor, 'rules')).orderBy('rules.id', 'desc').execute() as PricingRuleRow[];
    const matched = this.findBestRule(activeRules, payload);
    if (!matched) return { rule: null };
    return { rule: this.mapRuleRow(matched) };
  }

  private normalizeRulePayload(payload: PricingRuleUpsertDto): PricingPreviewPayload & { name: string } {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('اسم القاعدة مطلوب.', 'PRICING_RULE_NAME_REQUIRED', 400);
    const options = { applyToWholeStyleCode: Boolean(payload.options?.applyToWholeStyleCode), applyToPricingGroup: Boolean(payload.options?.applyToPricingGroup), skipActiveOffers: Boolean(payload.options?.skipActiveOffers), skipCustomerPrices: Boolean(payload.options?.skipCustomerPrices), skipManualExceptions: Boolean(payload.options?.skipManualExceptions) };
    const targets = Array.from(new Set((payload.targets || []).filter((entry): entry is 'retail' | 'wholesale' => entry === 'retail' || entry === 'wholesale')));
    if (!targets.length) throw new AppError('اختر على الأقل قطاعي أو جملة داخل القاعدة.', 'PRICING_RULE_TARGET_REQUIRED', 400);
    return { name, filters: { supplierId: payload.filters?.supplierId, categoryId: payload.filters?.categoryId, itemKind: payload.filters?.itemKind, styleCode: String(payload.filters?.styleCode || '').trim() || undefined, q: '', productIds: undefined, activeOnly: payload.filters?.activeOnly !== false, inStockOnly: Boolean(payload.filters?.inStockOnly) }, operation: { type: payload.operation.type, value: Number(payload.operation.value || 0) }, targets, rounding: { mode: payload.rounding.mode, nearestStep: payload.rounding.mode === 'nearest' ? Number(payload.rounding.nearestStep || 0.5) : undefined, ending: payload.rounding.mode === 'ending' ? Number(payload.rounding.ending || 95) : undefined }, options };
  }

  private async getRuleById(ruleId: number, actor: AuthContext) {
    const row = await this.db.selectFrom('pricing_rules as rules').leftJoin('users as users', 'users.id', 'rules.created_by').select(['rules.id', 'rules.name', 'rules.supplier_id', 'rules.category_id', 'rules.item_kind', 'rules.style_code', 'rules.operation_type', 'rules.operation_value', 'rules.targets_json', 'rules.rounding_mode', 'rules.rounding_nearest_step', 'rules.rounding_ending', 'rules.options_json', 'rules.notes', 'rules.is_active', 'rules.created_at', 'rules.updated_at', 'rules.created_by', 'rules.updated_by', 'users.display_name', 'users.username']).where('rules.id', '=', ruleId).where(this.tenantPredicate(actor, 'rules')).executeTakeFirst() as PricingRuleRow | undefined;
    if (!row) throw new AppError('قاعدة التسعير غير موجودة.', 'PRICING_RULE_NOT_FOUND', 404);
    return this.mapRuleRow(row);
  }

  private mapRuleRow(row: PricingRuleRow) {
    const payload = this.buildPayloadFromRule(row);
    return { id: Number(row.id), name: row.name, isActive: Boolean(row.is_active), notes: String(row.notes || ''), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.display_name || row.username || 'مستخدم', filters: payload.filters, operation: payload.operation, targets: payload.targets, rounding: payload.rounding, options: payload.options, payload };
  }

  private buildPayloadFromRule(row: PricingRuleRow): PricingPreviewPayload {
    const targetsRaw = this.safeJsonParse(row.targets_json);
    const optionsRaw = this.safeJsonParse(row.options_json) as Partial<PricingPreviewPayload['options']> | null;
    const targets: Array<'retail' | 'wholesale'> = Array.isArray(targetsRaw) ? targetsRaw.filter((entry): entry is 'retail' | 'wholesale' => entry === 'retail' || entry === 'wholesale') : ['retail'];
    return { filters: { supplierId: row.supplier_id ? Number(row.supplier_id) : undefined, categoryId: row.category_id ? Number(row.category_id) : undefined, itemKind: row.item_kind === 'fashion' ? 'fashion' : row.item_kind === 'standard' ? 'standard' : undefined, styleCode: this.normalizeGroupKey(row.style_code) || '', q: '', productIds: undefined, activeOnly: true, inStockOnly: false }, operation: { type: row.operation_type, value: Number(row.operation_value || 0) }, targets: targets.length ? targets : ['retail'], rounding: { mode: row.rounding_mode, nearestStep: row.rounding_mode === 'nearest' ? Number(row.rounding_nearest_step || 0.5) : undefined, ending: row.rounding_mode === 'ending' ? Number(row.rounding_ending || 95) : undefined }, options: { applyToWholeStyleCode: Boolean(optionsRaw?.applyToWholeStyleCode), applyToPricingGroup: Boolean(optionsRaw?.applyToPricingGroup), skipActiveOffers: Boolean(optionsRaw?.skipActiveOffers), skipCustomerPrices: Boolean(optionsRaw?.skipCustomerPrices), skipManualExceptions: Boolean(optionsRaw?.skipManualExceptions) } };
  }

  private findBestRule(rows: PricingRuleRow[], payload: PricingRuleMatchDto): PricingRuleRow | null {
    const scored = rows.map((row) => { const styleCode = this.normalizeGroupKey(row.style_code); const hasSupplier = Number(row.supplier_id || 0) > 0; const hasCategory = Number(row.category_id || 0) > 0; const hasItemKind = Boolean(row.item_kind); const hasStyleCode = Boolean(styleCode); if (hasSupplier && Number(payload.supplierId || 0) !== Number(row.supplier_id || 0)) return null; if (hasCategory && Number(payload.categoryId || 0) !== Number(row.category_id || 0)) return null; if (hasItemKind && payload.itemKind !== row.item_kind) return null; if (hasStyleCode && this.normalizeGroupKey(payload.styleCode) !== styleCode) return null; const specificity = [hasSupplier, hasCategory, hasItemKind, hasStyleCode].filter(Boolean).length; const score = (hasStyleCode ? 50 : 0) + (hasSupplier ? 20 : 0) + (hasCategory ? 15 : 0) + (hasItemKind ? 10 : 0); return { row, score, specificity }; }).filter((entry): entry is { row: PricingRuleRow; score: number; specificity: number } => Boolean(entry)).sort((a, b) => b.score - a.score || b.specificity - a.specificity || Number(b.row.id) - Number(a.row.id));
    return scored[0]?.row || null;
  }

  private safeJsonParse(value: string | null | undefined): unknown { if (!value) return null; try { return JSON.parse(value); } catch { return null; } }
  private normalizeGroupKey(value: string | null | undefined): string | null { const normalized = String(value || '').trim(); return normalized || null; }

  private async buildPreview(payload: PricingPreviewPayload, options: { paginate: boolean }, actor: AuthContext): Promise<{ rows: PricingPreviewRow[]; paging: { page: number; pageSize: number; totalItems: number; totalPages: number }; summary: Record<string, unknown> }> {
    const filters = payload.filters || {};
    const paging = this.normalizePaging(payload.paging);
    const previewOptions = this.normalizePreviewOptions(payload);
    const targets = this.normalizePreviewTargets(payload);
    const normalizedSearch = normalizeArabicSearch(filters.q);
    const baseMatched = await this.fetchBaseMatchedProducts(filters, normalizedSearch, actor);
    const expandedRows = await this.expandPreviewProducts(baseMatched, filters, previewOptions, actor);
    const productIds = expandedRows.map((row) => Number(row.id));
    if (!productIds.length) return this.createEmptyPreviewResult(paging.pageSize);
    const profileMap = await this.fetchProfileMap(productIds, actor);
    const { activeOfferProductIds, customerPriceProductIds } = await this.fetchPreviewFlags(productIds, actor);
    const allRows = this.buildPreviewRows({ rows: expandedRows, payload, targets, previewOptions, profileMap, activeOfferProductIds, customerPriceProductIds });
    const summary = this.buildPreviewSummary(allRows);
    if (!options.paginate) return { rows: allRows, paging: { page: 1, pageSize: allRows.length || paging.pageSize, totalItems: allRows.length, totalPages: 1 }, summary };
    const paginated = this.paginatePreviewRows(allRows, paging, summary);
    return { rows: paginated.rows, paging: paginated.paging, summary };
  }

  private normalizePreviewOptions(payload: PricingPreviewPayload) {
    return {
      applyToWholeStyleCode: Boolean(payload.options?.applyToWholeStyleCode),
      applyToPricingGroup: Boolean(payload.options?.applyToPricingGroup),
      skipActiveOffers: Boolean(payload.options?.skipActiveOffers ?? payload.safeguards?.skipActiveOffers),
      skipCustomerPrices: Boolean(payload.options?.skipCustomerPrices),
      skipManualExceptions: Boolean(payload.options?.skipManualExceptions ?? payload.safeguards?.skipManualExceptions),
      preventBelowCost: Boolean(payload.safeguards?.preventBelowCost),
    };
  }
  private normalizePreviewTargets(payload: PricingPreviewPayload): Array<'retail' | 'wholesale'> { const targets = Array.from(new Set((payload.targets || []).filter((entry): entry is 'retail' | 'wholesale' => entry === 'retail' || entry === 'wholesale'))); if (!targets.length) throw new AppError('يجب اختيار سعر واحد على الأقل للتعديل.', 'PRICING_TARGET_REQUIRED', 400); return targets; }

  private async expandPreviewProducts(baseMatched: ProductSourceRow[], filters: PricingPreviewPayload['filters'], previewOptions: ReturnType<PricingService['normalizePreviewOptions']>, actor: AuthContext): Promise<ProductSourceRow[]> {
    let expandedRows = [...baseMatched];
    let profileMap = await this.fetchProfileMap(expandedRows.map((row) => Number(row.id)), actor);
    if (previewOptions.applyToWholeStyleCode) {
      const styleCodes = Array.from(new Set(baseMatched.filter((row) => row.item_kind === 'fashion' && String(row.style_code || '').trim()).map((row) => String(row.style_code || '').trim())));
      if (styleCodes.length) expandedRows = this.mergeProducts(expandedRows, await this.fetchProductsByStyleCodes(styleCodes, filters, actor));
    }
    if (previewOptions.applyToPricingGroup) {
      profileMap = await this.fetchProfileMap(expandedRows.map((row) => Number(row.id)), actor);
      const groupKeys = Array.from(new Set(expandedRows.map((row) => this.normalizeGroupKey(profileMap.get(Number(row.id))?.pricing_group_key || '')).filter((entry): entry is string => Boolean(entry))));
      if (groupKeys.length) {
        const groupProfiles = await this.fetchProfilesByGroupKeys(groupKeys, actor);
        const groupedProductIds = Array.from(new Set(groupProfiles.map((row) => Number(row.product_id)).filter((id) => id > 0)));
        if (groupedProductIds.length) expandedRows = this.mergeProducts(expandedRows, await this.fetchProductsByIds(groupedProductIds, filters, actor));
      }
    }
    return expandedRows;
  }

  private createEmptyPreviewResult(pageSize: number) { return { rows: [], paging: { page: 1, pageSize, totalItems: 0, totalPages: 1 }, summary: { matchedCount: 0, affectedCount: 0, skippedOfferCount: 0, skippedCustomerPriceCount: 0, skippedManualExceptionCount: 0, inheritedProfileCount: 0, belowCostCount: 0, inventoryValueBefore: 0, inventoryValueAfter: 0, stockMarginBefore: 0, stockMarginAfter: 0 } }; }
  private async fetchPreviewFlags(productIds: number[], actor: AuthContext) { const [offers, customerPrices, tenantTimezone] = await Promise.all([this.db.selectFrom('product_offers').select(['product_id', 'is_active', 'start_date', 'end_date']).where('product_id', 'in', productIds).where(this.tenantPredicate(actor)).execute() as Promise<OfferRow[]>, this.db.selectFrom('product_customer_prices').select(['product_id']).where('product_id', 'in', productIds).where(this.tenantPredicate(actor)).execute() as Promise<CustomerPriceRow[]>, getTenantTimezone(this.db, this.tenantScope(actor).tenantId)]); const todayKey = todayTenantDate(tenantTimezone); return { activeOfferProductIds: new Set(offers.filter((offer) => this.isOfferActive(offer, todayKey)).map((offer) => Number(offer.product_id))), customerPriceProductIds: new Set(customerPrices.map((row) => Number(row.product_id))) }; }

  private buildPreviewRows(params: { rows: ProductSourceRow[]; payload: PricingPreviewPayload; targets: Array<'retail' | 'wholesale'>; previewOptions: ReturnType<PricingService['normalizePreviewOptions']>; profileMap: Map<number, PricingProfileRow>; activeOfferProductIds: Set<number>; customerPriceProductIds: Set<number> }): PricingPreviewRow[] {
    const { rows, payload, targets, previewOptions, profileMap, activeOfferProductIds, customerPriceProductIds } = params;
    return rows.map((row) => this.buildPreviewRow({ row, payload, targets, previewOptions, profileMap, activeOfferProductIds, customerPriceProductIds })).sort((a, b) => { if (a.skipped !== b.skipped) return Number(a.skipped) - Number(b.skipped); if (a.changed !== b.changed) return Number(b.changed) - Number(a.changed); return a.name.localeCompare(b.name, 'ar'); });
  }

  private buildPreviewRow(params: { row: ProductSourceRow; payload: PricingPreviewPayload; targets: Array<'retail' | 'wholesale'>; previewOptions: ReturnType<PricingService['normalizePreviewOptions']>; profileMap: Map<number, PricingProfileRow>; activeOfferProductIds: Set<number>; customerPriceProductIds: Set<number> }): PricingPreviewRow {
    const { row, payload, targets, previewOptions, profileMap, activeOfferProductIds, customerPriceProductIds } = params;
    const profile = profileMap.get(Number(row.id));
    const pricingMode = profile?.pricing_mode || 'standard';
    const pricingGroupKey = this.normalizeGroupKey(profile?.pricing_group_key || '') || '';
    const hasActiveOffer = activeOfferProductIds.has(Number(row.id));
    const hasCustomerPrice = customerPriceProductIds.has(Number(row.id));
    const retailBefore = Number(row.retail_price || 0);
    const wholesaleBefore = Number(row.wholesale_price || 0);
    const costPrice = Number(row.cost_price || 0);
    const retailAfter = targets.includes('retail') ? this.computeNextPrice(retailBefore, costPrice, payload) : retailBefore;
    const wholesaleAfter = targets.includes('wholesale') ? this.computeNextPrice(wholesaleBefore, costPrice, payload) : wholesaleBefore;
    const belowCostAfter = (targets.includes('retail') && retailAfter + 0.0001 < costPrice) || (targets.includes('wholesale') && wholesaleAfter + 0.0001 < costPrice);
    const skipReasons = this.buildPreviewSkipReasons({ previewOptions, hasActiveOffer, hasCustomerPrice, pricingMode, belowCostAfter });
    const skipped = skipReasons.length > 0;
    const changed = Math.abs(retailAfter - retailBefore) > 0.0001 || Math.abs(wholesaleAfter - wholesaleBefore) > 0.0001;
    return { productId: Number(row.id), name: String(row.name || ''), barcode: String(row.barcode || ''), itemKind: row.item_kind === 'fashion' ? 'fashion' : 'standard', styleCode: String(row.style_code || ''), pricingMode, pricingGroupKey, stockQty: Number(row.stock_qty || 0), costPrice, retailPriceBefore: retailBefore, retailPriceAfter: retailAfter, wholesalePriceBefore: wholesaleBefore, wholesalePriceAfter: wholesaleAfter, hasActiveOffer, hasCustomerPrice, skipped, skipReasons, changed, belowCostAfter } satisfies PricingPreviewRow;
  }

  private buildPreviewSkipReasons(params: { previewOptions: ReturnType<PricingService['normalizePreviewOptions']>; hasActiveOffer: boolean; hasCustomerPrice: boolean; pricingMode: 'standard' | 'inherit' | 'manual'; belowCostAfter?: boolean }): string[] { const reasons: string[] = []; if (params.previewOptions.skipActiveOffers && params.hasActiveOffer) reasons.push('offer'); if (params.previewOptions.skipCustomerPrices && params.hasCustomerPrice) reasons.push('customer_price'); if (params.previewOptions.skipManualExceptions && params.pricingMode === 'manual') reasons.push('manual_exception'); if (params.previewOptions.preventBelowCost && params.belowCostAfter) reasons.push('below_cost'); return reasons; }
  private buildPreviewSummary(allRows: PricingPreviewRow[]) { const effectiveRows = allRows.filter((row) => !row.skipped && row.changed); return { matchedCount: allRows.length, affectedCount: effectiveRows.length, skippedOfferCount: allRows.filter((row) => row.skipReasons.includes('offer')).length, skippedCustomerPriceCount: allRows.filter((row) => row.skipReasons.includes('customer_price')).length, skippedManualExceptionCount: allRows.filter((row) => row.skipReasons.includes('manual_exception')).length, inheritedProfileCount: allRows.filter((row) => row.pricingMode === 'inherit').length, belowCostCount: allRows.filter((row) => row.belowCostAfter && !row.skipped).length, inventoryValueBefore: Number(effectiveRows.reduce((sum, row) => sum + (row.stockQty * row.retailPriceBefore), 0).toFixed(2)), inventoryValueAfter: Number(effectiveRows.reduce((sum, row) => sum + (row.stockQty * row.retailPriceAfter), 0).toFixed(2)), stockMarginBefore: Number(effectiveRows.reduce((sum, row) => sum + (row.stockQty * (row.retailPriceBefore - row.costPrice)), 0).toFixed(2)), stockMarginAfter: Number(effectiveRows.reduce((sum, row) => sum + (row.stockQty * (row.retailPriceAfter - row.costPrice)), 0).toFixed(2)) }; }
  private paginatePreviewRows(rows: PricingPreviewRow[], pagingInput: PricingPreviewPayload['paging'] | { page?: number; pageSize?: number } | undefined, summary: Record<string, unknown>) { const paging = this.normalizePaging(pagingInput); const totalItems = rows.length; const totalPages = Math.max(1, Math.ceil(totalItems / paging.pageSize)); const page = Math.min(paging.page, totalPages); const start = (page - 1) * paging.pageSize; return { rows: rows.slice(start, start + paging.pageSize), paging: { page, pageSize: paging.pageSize, totalItems, totalPages }, summary }; }

  private async fetchBaseMatchedProducts(filters: PricingPreviewPayload['filters'], normalizedSearch: string, actor: AuthContext): Promise<ProductSourceRow[]> {
    let qb = this.db.selectFrom('products').select(['id', 'name', 'barcode', 'item_kind', 'style_code', 'category_id', 'supplier_id', 'cost_price', 'retail_price', 'wholesale_price', 'stock_qty', 'is_active']).where(this.tenantPredicate(actor));
    qb = this.applyExpansionEligibility(qb, filters);
    if (filters.supplierId) qb = qb.where('supplier_id', '=', Number(filters.supplierId));
    if (filters.categoryId) qb = qb.where('category_id', '=', Number(filters.categoryId));
    if (Array.isArray(filters.productIds) && filters.productIds.length) { const productIds = Array.from(new Set(filters.productIds.map((entry) => Number(entry)).filter((entry) => entry > 0))); if (!productIds.length) return []; qb = qb.where('id', 'in', productIds); }
    if (filters.itemKind) qb = qb.where('item_kind', '=', filters.itemKind);
    if (filters.styleCode) qb = qb.where('style_code', 'ilike', `%${String(filters.styleCode).trim()}%`);
    if (normalizedSearch) { const rawSearch = `%${String(filters.q || '').trim()}%`; qb = qb.where(sql<boolean>`(coalesce(name, '') ilike ${rawSearch} or coalesce(barcode, '') ilike ${rawSearch} or coalesce(style_code, '') ilike ${rawSearch})`); }
    const rows = await qb.execute() as ProductSourceRow[];
    if (!normalizedSearch) return rows;
    return rows.filter((row) => this.matchesNormalizedSearch(row, normalizedSearch));
  }

  private async fetchProductsByStyleCodes(styleCodes: string[], filters: PricingPreviewPayload['filters'], actor: AuthContext): Promise<ProductSourceRow[]> { if (!styleCodes.length) return []; let qb = this.db.selectFrom('products').select(['id', 'name', 'barcode', 'item_kind', 'style_code', 'category_id', 'supplier_id', 'cost_price', 'retail_price', 'wholesale_price', 'stock_qty', 'is_active']).where('style_code', 'in', styleCodes).where(this.tenantPredicate(actor)); qb = this.applyExpansionEligibility(qb, filters); return await qb.execute() as ProductSourceRow[]; }
  private async fetchProductsByIds(productIds: number[], filters: PricingPreviewPayload['filters'], actor: AuthContext): Promise<ProductSourceRow[]> { if (!productIds.length) return []; let qb = this.db.selectFrom('products').select(['id', 'name', 'barcode', 'item_kind', 'style_code', 'category_id', 'supplier_id', 'cost_price', 'retail_price', 'wholesale_price', 'stock_qty', 'is_active']).where('id', 'in', productIds).where(this.tenantPredicate(actor)); qb = this.applyExpansionEligibility(qb, filters); return await qb.execute() as ProductSourceRow[]; }
  private async fetchProfilesByGroupKeys(groupKeys: string[], actor: AuthContext): Promise<PricingProfileRow[]> { if (!groupKeys.length) return []; return await this.db.selectFrom('product_pricing_profiles').select(['product_id', 'pricing_group_key', 'pricing_mode']).where('pricing_group_key', 'in', groupKeys).where(this.tenantPredicate(actor)).execute() as PricingProfileRow[]; }
  private async fetchProfileMap(productIds: number[], actor: AuthContext): Promise<Map<number, PricingProfileRow>> { if (!productIds.length) return new Map(); const rows = await this.db.selectFrom('product_pricing_profiles').select(['product_id', 'pricing_group_key', 'pricing_mode']).where('product_id', 'in', productIds).where(this.tenantPredicate(actor)).execute() as PricingProfileRow[]; return new Map(rows.map((row) => [Number(row.product_id), row])); }
  private applyExpansionEligibility(qb: any, filters: PricingPreviewPayload['filters']) { let next = qb; if (filters.activeOnly !== false) next = next.where('is_active', '=', true); if (filters.inStockOnly) next = next.where('stock_qty', '>', 0); return next; }
  private normalizePaging(paging: PricingPreviewPayload['paging']) { const page = Math.max(1, Number(paging?.page || 1)); const requestedPageSize = Math.max(1, Number(paging?.pageSize || 50)); const pageSize = Math.min(requestedPageSize, 200); return { page, pageSize }; }
  private mergeProducts(currentRows: ProductSourceRow[], nextRows: ProductSourceRow[]) { const merged = new Map<number, ProductSourceRow>(); [...currentRows, ...nextRows].forEach((row) => merged.set(Number(row.id), row)); return Array.from(merged.values()); }
  private matchesNormalizedSearch(row: ProductSourceRow, normalizedSearch: string) { if (!normalizedSearch) return true; const haystack = normalizeArabicSearch([row.name, row.barcode || '', row.style_code || ''].join(' ')); return haystack.includes(normalizedSearch); }
  // Offer bounds are STORED pg DATEs (node-postgres local-midnight
  // Dates) -- they key through normalizePgDateOnly against the tenant
  // day, never through an instant comparison: an offer ending today
  // must stay active today (an instant end is midnight at the START
  // of the end day, so Date.now() > end for the whole last day).
  private isOfferActive(offer: OfferRow, todayKey: string): boolean { const isActiveFlag = offer.is_active ?? true; if (!isActiveFlag) return false; const start = normalizePgDateOnly(offer.start_date); const end = normalizePgDateOnly(offer.end_date); if (start && start > todayKey) return false; if (end && end < todayKey) return false; return true; }
  private computeNextPrice(currentPrice: number, costPrice: number, payload: PricingPreviewPayload): number { const op = payload.operation; let nextValue = Number(currentPrice || 0); const raw = Number(op.value || 0); if (op.type === 'percent_increase') nextValue = currentPrice * (1 + raw / 100); if (op.type === 'percent_decrease') nextValue = currentPrice * (1 - raw / 100); if (op.type === 'fixed_increase') nextValue = currentPrice + raw; if (op.type === 'fixed_decrease') nextValue = currentPrice - raw; if (op.type === 'set_price') nextValue = raw; if (op.type === 'margin_from_cost') nextValue = costPrice * (1 + raw / 100); nextValue = Math.max(0, nextValue); return this.applyRounding(nextValue, payload.rounding); }
  private applyRounding(value: number, rounding: PricingPreviewPayload['rounding']): number { if (rounding.mode === 'nearest') { const step = Math.max(0.01, Number(rounding.nearestStep || 0.5)); return Number((Math.round(value / step) * step).toFixed(2)); } if (rounding.mode === 'ending') { const ending = Math.max(0, Number(rounding.ending || 95)); const base = Math.floor(value); let candidate = base + ending / 100; if (candidate + 0.0001 < value) candidate += 1; return Number(candidate.toFixed(2)); } return Number(value.toFixed(2)); }
}
