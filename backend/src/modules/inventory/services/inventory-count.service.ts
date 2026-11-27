import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { lockStockProducts, previewAssignedLocationOnHandQty, previewAssignedLocationStockQty, previewConsumableStockQty, setScopedStockQty } from '../../../common/utils/location-stock-ledger';
import {
  recordStockMovement,
  recordStockMovementRow,
} from '../../../common/utils/stock-movement-writer';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { CreateDamagedStockDto } from '../dto/create-damaged-stock.dto';
import { CreateStockCountSessionDto, RecountStockCountItemDto } from '../dto/create-stock-count-session.dto';
import { buildDamagedStockSummary, buildStockMovementSummary, groupStockCountItemsBySession, mapDamagedStockRow, mapStockCountSessionRow, mapStockMovementRow } from '../helpers/inventory-count-listing.helper';
import { assertInventoryLocationBranchMatch, buildDamagedStockWriteModels, buildDamageRecordFromCount, buildStockCountItemValues, buildStockCountPostingMovement, buildStockCountSessionDocNo, shouldCreateDamageRecordFromCount } from '../helpers/inventory-count-write.helper';
import { InventoryScopeService } from './inventory-scope.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { assertUntrackedStockMutation } from '../helpers/inventory-tracked-stock.helper';
import { dispatchTrackedStock } from '../helpers/stock-transfer-trace.helper';
import { reconcileStockCountTrace } from '../helpers/stock-count-trace.helper';
import { verifyPassword } from '../../../core/auth/utils/password-hasher';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

// INV-INV-COUNT-TRANSFER-SQL-PAGINATION: keep-list for the SQL
// matchesArabic noise class — the exact set of characters
// normalizeArabicSearch keeps, derived empirically from the real JS
// function over the Arabic / Latin / Greek / Cyrillic / presentation
// ranges (probe: hr-pagination-p3-norm-probe.ts, 30/30). PostgreSQL
// AREs have no \p{...} classes, so the ranges are explicit. The
// ASCII letters/digits/space and the whitespace escapes come first.
const ARABIC_SEARCH_KEEP =
  'A-Za-z0-9 \\t\\n\\r\\f\\v' +
  '\u0620\u0622-\u063F\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06EE-\u06FC\u06FF' +
  '\u0750-\u077F\u08A0-\u08C9' +
  '\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF' +
  '\u0370-\u0374\u0376-\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u03FF' +
  '\u0400-\u0481\u048A-\u04FF' +
  '\uFB50-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC';

@Injectable()
export class InventoryCountService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly scope: InventoryScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private tenantScope(auth: AuthContext) { return requireTenantScope(auth); }
  private tenantPredicate(auth: AuthContext, alias?: string) { const tenantId = this.tenantScope(auth).tenantId; return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`; }
  private tenantFields(auth: AuthContext) { const scope = this.tenantScope(auth); return { tenant_id: scope.tenantId, account_id: scope.accountId }; }

  async listStockMovements(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const offset = (page - 1) * pageSize;
    const search = String(query.search || '').trim();
    const type = String(query.type || 'all').toLowerCase();
    const locationId = query.locationId && query.locationId !== 'all' ? Number(query.locationId) : null;
    const productId = query.productId ? Number(query.productId) : null;
    const branchScope = await this.scope.branchScope(auth);

    let qb = this.db
      .selectFrom('stock_movements as m')
      .leftJoin('products as p', (join) => join.onRef('p.id', '=', 'm.product_id').onRef('p.tenant_id', '=', 'm.tenant_id'))
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 'm.branch_id').onRef('b.tenant_id', '=', 'm.tenant_id'))
      .leftJoin('stock_locations as l', (join) => join.onRef('l.id', '=', 'm.location_id').onRef('l.tenant_id', '=', 'm.tenant_id'))
      .leftJoin('users as u', (join) => join.onRef('u.id', '=', 'm.created_by').onRef('u.tenant_id', '=', 'm.tenant_id'))
      .leftJoin('stock_transfers as st', (join) => join.on('m.reference_type', '=', 'transfer').onRef('m.reference_id', '=', 'st.id').onRef('m.tenant_id', '=', 'st.tenant_id'))
      .select([
        'm.id', 'm.product_id', 'm.movement_type', 'm.qty', 'm.before_qty', 'm.after_qty', 'm.reason', 'm.note', 'm.reference_type', 'm.reference_id', 'm.branch_id', 'm.location_id', 'm.created_at',
        'p.name as product_name', 'b.name as branch_name', 'l.name as location_name', 'u.username as created_by_name',
        sql<number>`COUNT(*) OVER()`.as('total_count'),
        sql<number>`COALESCE(SUM(CASE WHEN m.qty >= 0 THEN m.qty ELSE 0 END) OVER(), 0)`.as('agg_positive'),
        sql<number>`COALESCE(SUM(CASE WHEN m.qty < 0 THEN ABS(m.qty) ELSE 0 END) OVER(), 0)`.as('agg_negative'),
      ])
      .where(this.tenantPredicate(auth, 'm'))
      .where((eb) => eb.or([eb('st.status', 'is', null), eb('st.status', '!=', 'cancelled')]));

    if (branchScope.length > 0) {
      qb = qb.where((eb) => eb.or([eb('m.branch_id', 'in', branchScope), eb('m.branch_id', 'is', null)]));
    }
    if (type !== 'all') {
      qb = qb.where('m.movement_type', '=', type);
    }
    if (locationId) {
      qb = qb.where('m.location_id', '=', locationId);
    }
    if (productId && Number.isFinite(productId)) {
      qb = qb.where('m.product_id', '=', productId);
    }
    if (search) {
      const normalizedSearch = normalizeArabicSearch(search);
      const tokens = normalizedSearch.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        for (const token of tokens) {
          const term = `%${token}%`;
          qb = qb.where(sql<boolean>`(
            TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR LOWER(COALESCE(p.name_en, '')) LIKE ${term}
            OR LOWER(COALESCE(p.barcode, '')) LIKE ${term}
            OR LOWER(COALESCE(p.style_code, '')) LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(m.reason, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(m.note, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(l.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(b.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
          )`);
        }
      }
    }

    const rows = await qb.orderBy('m.id', 'desc').limit(pageSize).offset(offset).execute();
    const totalItems = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const positive = rows.length > 0 ? Number(rows[0].agg_positive) : 0;
    const negative = rows.length > 0 ? Number(rows[0].agg_negative) : 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      stockMovements: rows.map(mapStockMovementRow),
      pagination: { page, pageSize, totalItems, totalPages },
      summary: { positive, negative, totalItems },
      scope: this.tenantScope(auth),
    };
  }

  async listStockCountSessions(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    // INV-INV-COUNT-TRANSFER-SQL-PAGINATION: a paged request never loads
    // the whole tenant set — the page is fetched from SQL below.
    if (query.page || query.pageSize || query.search || query.filter || query.view) return this.listStockCountSessionsPage(query, auth);
    const sessions = await this.db
      .selectFrom('stock_count_sessions as s')
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 's.branch_id').onRef('b.tenant_id', '=', 's.tenant_id'))
      .leftJoin('stock_locations as l', (join) => join.onRef('l.id', '=', 's.location_id').onRef('l.tenant_id', '=', 's.tenant_id'))
      .leftJoin('users as cu', (join) => join.onRef('cu.id', '=', 's.counted_by').onRef('cu.tenant_id', '=', 's.tenant_id'))
      .leftJoin('users as au', (join) => join.onRef('au.id', '=', 's.approved_by').onRef('au.tenant_id', '=', 's.tenant_id'))
      .select(['s.id', 's.doc_no', 's.branch_id', 's.location_id', 's.status', 's.note', 's.posted_at', 's.created_at', 'b.name as branch_name', 'l.name as location_name', 'cu.username as counted_by_name', 'au.username as approved_by_name'])
      .where(this.tenantPredicate(auth, 's'))
      .orderBy('s.id', 'desc')
      .execute();

    const sessionIds = sessions.map((row) => Number(row.id || 0)).filter((id) => id > 0);
    const items = sessionIds.length ? await this.db.selectFrom('stock_count_items').selectAll().where('session_id', 'in', sessionIds).where(this.tenantPredicate(auth)).orderBy('session_id', 'asc').execute() : [];
    const bySession = groupStockCountItemsBySession(items as never);
    let mapped = sessions.map((row) => mapStockCountSessionRow(row as never, bySession));
    mapped = await this.scope.filterByScope(mapped, auth);

    return { stockCountSessions: mapped, damagedStockRecords: (await this.listDamagedStock({}, auth)).damagedStockRecords, scope: this.tenantScope(auth) };
  }

  // SQL equivalent of normalizeArabicSearch
  // (common/utils/arabic-search.util.ts) — proven equal on the 30-case
  // probe (hr-pagination-p3-norm-probe.ts). PostgreSQL AREs have no
  // \p{...} classes, so the noise class is the explicit ARABIC_SEARCH_KEEP
  // list above. `expr` is a SQL expression producing the raw text.
  private normalizedArabicSearch(expr: string) {
    return sql<string>`btrim(regexp_replace(regexp_replace(lower(regexp_replace(translate(translate(${sql.raw(expr)}, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), 'أإآٱٲٳؤئىةء', 'ااااااوييه'), '[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g')), '[^${sql.raw(ARABIC_SEARCH_KEEP)}]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  }

  private async listStockCountSessionsPage(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    // INV-INV-COUNT-TRANSFER-SQL-PAGINATION: the page is fetched from
    // SQL — the old in-memory pagination semantics are preserved
    // (defaultSize 8, page clamped to [1, totalPages], cap 200), and the
    // summary stays exact over the FULL filtered set. The search is the
    // Arabic-normalized whole-substring match over docNo (fallback
    // 'COUNT-' + id), note, locationName, branchName; the filter is the
    // lowercased status compare with the 'draft'-also-matches-'posting'
    // quirk. The unpaginated path above is untouched.
    const search = String(query.search || query.q || '').trim();
    const filter = String(query.filter || query.view || 'all').toLowerCase();
    const normalizedSearch = normalizeArabicSearch(search);
    const scopeIds = await this.scope.branchScope(auth);
    const unrestricted = this.scope.isUnrestrictedBranchScope(auth);
    const scopePredicate = unrestricted
      ? sql<boolean>`true`
      : scopeIds.length === 0
        ? sql<boolean>`false`
        : sql<boolean>`(s.branch_id IS NULL OR s.branch_id = ANY(${scopeIds}))`;
    const filterPredicate = filter === 'all'
      ? null
      : filter === 'draft'
        ? sql<boolean>`(lower(coalesce(nullif(s.status, ''), 'draft')) = 'draft' OR lower(coalesce(nullif(s.status, ''), 'draft')) = 'posting')`
        : sql<boolean>`lower(coalesce(nullif(s.status, ''), 'draft')) = ${filter}`;
    const searchPredicate = normalizedSearch
      ? sql<boolean>`(
        strpos(${this.normalizedArabicSearch(`coalesce(nullif(s.doc_no, ''), 'COUNT-' || s.id)`)}, ${normalizedSearch}) > 0
        OR strpos(${this.normalizedArabicSearch(`coalesce(s.note, '')`)}, ${normalizedSearch}) > 0
        OR strpos(${this.normalizedArabicSearch(`coalesce(l.name, '')`)}, ${normalizedSearch}) > 0
        OR strpos(${this.normalizedArabicSearch(`coalesce(b.name, '')`)}, ${normalizedSearch}) > 0
      )`
      : null;
    const where = sql<boolean>`${this.tenantPredicate(auth, 's')} AND ${scopePredicate}${filterPredicate ? sql` AND ${filterPredicate}` : sql``}${searchPredicate ? sql` AND ${searchPredicate}` : sql``}`;
    const counts = await sql<{ total_items: string; draft_count: string; posted_count: string; total_variance: string }>`
      SELECT COUNT(DISTINCT s.id) AS total_items,
        COUNT(DISTINCT s.id) FILTER (WHERE coalesce(nullif(s.status, ''), 'draft') = 'draft') AS draft_count,
        COUNT(DISTINCT s.id) FILTER (WHERE coalesce(nullif(s.status, ''), 'draft') = 'posted') AS posted_count,
        coalesce(SUM(i.variance_qty), 0) AS total_variance
      FROM stock_count_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
      LEFT JOIN stock_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      LEFT JOIN stock_count_items i ON i.session_id = s.id AND i.tenant_id = s.tenant_id
      WHERE ${where}
    `.execute(this.db);
    const totalItems = Number(counts.rows[0]?.total_items || 0);
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 8);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT s.id, s.doc_no, s.branch_id, s.location_id, s.status, s.note, s.posted_at, s.created_at,
        b.name AS branch_name, l.name AS location_name,
        cu.username AS counted_by_name, au.username AS approved_by_name
      FROM stock_count_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
      LEFT JOIN stock_locations l ON l.id = s.location_id AND l.tenant_id = s.tenant_id
      LEFT JOIN users cu ON cu.id = s.counted_by AND cu.tenant_id = s.tenant_id
      LEFT JOIN users au ON au.id = s.approved_by AND au.tenant_id = s.tenant_id
      WHERE ${where}
      ORDER BY s.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const pageIds = result.rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);
    const pageItems = pageIds.length
      ? await this.db.selectFrom('stock_count_items').selectAll().where('session_id', 'in', pageIds).where(this.tenantPredicate(auth)).orderBy('session_id', 'asc').execute()
      : [];
    const bySession = groupStockCountItemsBySession(pageItems as never);
    const mapped = result.rows.map((row) => mapStockCountSessionRow(row as never, bySession));
    // The summary is exact over the FULL filtered set, never page-scoped.
    const summary = {
      totalItems,
      draft: Number(counts.rows[0]?.draft_count || 0),
      posted: Number(counts.rows[0]?.posted_count || 0),
      totalVariance: Number(Number(counts.rows[0]?.total_variance || 0).toFixed(3)),
    };
    return { stockCountSessions: mapped, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary, scope: this.tenantScope(auth) };
  }

  async createStockCountSession(payload: CreateStockCountSessionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = this.tenantScope(auth);
    const location = await this.scope.assertLocationScope(payload.locationId, auth, false, 'write');
    assertInventoryLocationBranchMatch(payload.branchId, location.branchId);
    const productIds = payload.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) throw new AppError('Cannot include the same product multiple times in a count session', 'STOCK_COUNT_DUPLICATE_PRODUCT', 400);

    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope, idemCtx.operationType);
      if (cached) return cached.response;
    }

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      // Time-based suffixes collide if two cashiers create a count at once.
      // A unique provisional code is replaced inside this transaction by the
      // stable database-generated session identity.
      const result = await trx.insertInto('stock_count_sessions').values({ doc_no: `ZSC-TMP-${randomUUID()}`, branch_id: location.branchId, location_id: location.id, status: 'draft', note: String(payload.note || '').trim(), counted_by: auth.userId, ...this.tenantFields(auth) }).returning('id').executeTakeFirstOrThrow();
      const id = Number(result.id);
      await trx.updateTable('stock_count_sessions')
        .set({ doc_no: buildStockCountSessionDocNo(Date.now(), id) })
        .where('id', '=', id).where(this.tenantPredicate(auth)).execute();
      await lockStockProducts(trx, { ...tenantScope, productIds: payload.items.map((item) => item.productId) });
      for (const item of [...payload.items].sort((a, b) => a.productId - b.productId)) {
        const product = await trx.selectFrom('products').select(['id', 'name', 'stock_qty']).where('id', '=', item.productId).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirst();
        if (!product) throw new AppError('Product not found in stock count session', 'PRODUCT_NOT_FOUND', 404);
        // INV-STOCK-COUNT-ADJUSTMENT: the frozen book quantity is the
        // physical on-hand quantity at the counted location,
        // reservations included. Freezing the available basis here
        // showed every reserved unit as a phantom surplus.
        const expectedQty = await previewAssignedLocationOnHandQty(trx, { productId: item.productId, branchId: location.branchId, locationId: location.id, tenantId: tenantScope.tenantId, accountId: tenantScope.accountId });
        await trx.insertInto('stock_count_items').values({
          ...buildStockCountItemValues({ ...product, stock_qty: expectedQty }, item, id),
          counted_serials: JSON.stringify(item.countedSerials || []),
          batch_counts: JSON.stringify(item.batchCounts || []),
          ...this.tenantFields(auth),
        }).execute();
      }

      // Idempotency: commit inside the EXACT SAME business transaction (CORE-004)
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: tenantScope.tenantId, accountId: idemCtx.accountId || tenantScope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          { ok: true, sessionId: String(id) },
          String(id)
        );
      }

      return id;
    });
    // Resolved names are stored beside the ids: the general-tab formatter
    // renders human labels with real branch/location names, and a pure
    // formatter cannot resolve ids to names on its own. Ids stay in the
    // stored JSON for machines and for legacy rows that carry ids only.
    const branchName = location.branchId
      ? (await this.db.selectFrom('branches').select('name').where('id', '=', location.branchId).where(this.tenantPredicate(auth)).executeTakeFirst())?.name ?? null
      : null;
    await this.audit.log('جلسة جرد مخزون', JSON.stringify({ actorUserId: auth.userId, after: { sessionId: finalResponse, branchId: location.branchId, branchName, locationId: location.id, locationName: location.name, status: 'draft' } }), auth);
    const responsePayload = { ok: true, sessionId: String(finalResponse), stockCountSessions: (await this.listStockCountSessions({}, auth)).stockCountSessions, damagedStockRecords: (await this.listDamagedStock({}, auth)).damagedStockRecords };
    return responsePayload;
  }

  async recountPendingStockCountItem(sessionId: number, itemId: number, payload: RecountStockCountItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = this.tenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }
    const reason = String(payload.reason || '').trim();
    const countedQty = Number(payload.countedQty);
    if (!reason || !Number.isFinite(countedQty) || countedQty < 0 ||
      Math.abs(countedQty * 1000 - Math.round(countedQty * 1000)) > 0.000001) {
      throw new AppError('A valid recount quantity and reason are required', 'INVALID_STOCK_RECOUNT', 400);
    }
    return this.tx.runInTransaction(this.db, async (trx) => {
      const session = await trx.selectFrom('stock_count_sessions').selectAll()
        .where('id', '=', sessionId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!session || !['draft', 'posting'].includes(session.status)) {
        throw new AppError('Stock count session cannot be recounted', 'SESSION_STATUS_INVALID', 409);
      }
      const item = await trx.selectFrom('stock_count_items').select(['id', 'product_id'])
        .where('id', '=', itemId).where('session_id', '=', sessionId)
        .where('posted_at', 'is', null).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!item) throw new AppError('Pending stock count item not found', 'STOCK_COUNT_ITEM_NOT_FOUND', 404);
      await lockStockProducts(trx, { ...tenantScope, productIds: [Number(item.product_id)] });
      const expectedQty = await previewAssignedLocationOnHandQty(trx, {
        productId: Number(item.product_id), branchId: session.branch_id, locationId: session.location_id,
        tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
      });
      const varianceQty = Number((countedQty - expectedQty).toFixed(3));
      await trx.updateTable('stock_count_items').set({
        expected_qty: expectedQty, counted_qty: countedQty, variance_qty: varianceQty, reason,
        // Recount is a fresh physical assertion; never replay stale selections.
        counted_serials: JSON.stringify(payload.countedSerials || []),
        batch_counts: JSON.stringify(payload.batchCounts || []),
      }).where('id', '=', itemId).where('session_id', '=', sessionId)
        .where('posted_at', 'is', null).where(this.tenantPredicate(auth)).execute();
      await this.audit.logWithExecutor(trx, 'إعادة جرد بند', JSON.stringify({ sessionId, itemId, productId: item.product_id, expectedQty, countedQty, varianceQty, reason }), auth);
      const response = { ok: true, sessionId, itemId, expectedQty, countedQty, varianceQty };
      if (idemCtx?.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(trx, {
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
          idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType,
        }, response);
      }
      return response;
    });
  }

  async deleteStockCountSession(sessionId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.tx.runInTransaction(this.db, async (trx) => {
      const session = await trx.selectFrom('stock_count_sessions').selectAll()
        .where('id', '=', sessionId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!session) {
        throw new AppError('جلسة الجرد غير موجودة', 'SESSION_NOT_FOUND', 404);
      }
      // 'posting' already means some chunks have been committed to the stock and
      // general ledgers. Deleting the session would orphan those financial entries.
      if (session.status !== 'draft') {
        throw new AppError('لا يمكن حذف جلسة جرد بدأ ترحيلها؛ يجب استكمال الترحيل والتسوية', 'SESSION_ALREADY_POSTED', 409);
      }
      const postedItem = await trx.selectFrom('stock_count_items').select('id')
        .where('session_id', '=', sessionId).where(this.tenantPredicate(auth))
        .where('posted_at', 'is not', null).limit(1).executeTakeFirst();
      if (postedItem) {
        throw new AppError('جلسة الجرد تحتوي على بنود مرحلة ولا يمكن حذفها', 'SESSION_ALREADY_POSTED', 409);
      }
      // Delete associated items first
      await trx.deleteFrom('stock_count_items')
        .where('session_id', '=', sessionId)
        .where(this.tenantPredicate(auth))
        .execute();

      // Delete the session record
      await trx.deleteFrom('stock_count_sessions')
        .where('id', '=', sessionId)
        .where(this.tenantPredicate(auth))
        .execute();

      await this.audit.logWithExecutor(trx, 'حذف مسودة جلسة جرد', JSON.stringify({
        sessionId,
        docNo: session.doc_no,
        branchId: session.branch_id,
        locationId: session.location_id,
        status: session.status,
      }), auth);

      return { ok: true, deletedSessionId: sessionId };
    });
  }

  // INV-SPIRIT-COUNT-POSTING: manager approval (manager PIN or a
  // manager password) is required only when the session posts a
  // variance or a serial/batch trace; a zero-variance session posts
  // without any approval credential.
  private async getManagerPin(db: Kysely<Database>, auth: AuthContext): Promise<string> {
    const { tenantId } = requireTenantScope(auth);
    const result = await sql<{ key?: string; value?: string }>`
      select key, value from settings
      where key in ('managerPin', 'managerApprovalPin', 'manager_pin')
        and tenant_id = ${tenantId}
    `.execute(db);
    const value = result.rows?.find((row) => String(row.key || '').length > 0)?.value;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
      } catch {
        return value.trim();
      }
    }
    return '';
  }

  // INV-STOCK-COUNT-DUAL-APPROVAL: variance approval requires an
  // identified manager credential — there is no admin/super_admin
  // bypass and no credential-free posting of a variance. Only the
  // password path identifies its holder, so only a manager (admin /
  // super_admin) password can approve: the shared manager PIN cannot
  // identify who presented it and is rejected as an approval
  // credential. Returns the approver's user id, which the caller
  // records as approved_by.
  // INV-STOCK-COUNT-SELF-APPROVAL: self-approval is allowed — the
  // approver may be the counter, the poster, or both. The
  // different-person bans of INV-STOCK-COUNT-DUAL-APPROVAL
  // (STOCK_COUNT_APPROVER_SAME_AS_COUNTER /
  // STOCK_COUNT_APPROVER_SAME_AS_POSTER) are removed: a second
  // manager may be a shop owner who does not use computers, and
  // waiting for one blocks the business. The audit trail survives:
  // approved_by always records the password holder's id. A
  // zero-variance session needs no approval (see
  // INV-SPIRIT-COUNT-POSTING) and never calls this method.
  private async assertCountVarianceApproval(credential: string | undefined, auth: AuthContext): Promise<number> {
    const normalized = String(credential || '').trim();
    if (!normalized) {
      throw new AppError('اعتماد فروقات الجرد يتطلب كلمة مرور مدير محدد', 'ADMIN_PASSWORD_REQUIRED', 403);
    }
    // The shared manager PIN cannot identify its holder, so it can
    // never satisfy approval. PIN storage itself is out of scope;
    // only its use as a variance-approval credential ends here.
    const managerPin = await this.getManagerPin(this.db, auth);
    if (managerPin && normalized === managerPin) {
      throw new AppError('رمز المدير المشترك لا يحدد هوية المعتمد؛ اعتماد فروقات الجرد يتطلب كلمة مرور مدير محدد', 'STOCK_COUNT_APPROVER_NOT_IDENTIFIED', 403);
    }
    const managerUsers = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'password_hash', 'password_salt'])
      .where('is_active', '=', true)
      .where(this.tenantPredicate(auth))
      .where((eb) => eb.or([eb('role', '=', 'admin'), eb('role', '=', 'super_admin')]))
      .execute();
    for (const managerUser of managerUsers) {
      const check = await verifyPassword(
        normalized,
        String(managerUser.password_hash || ''),
        String(managerUser.password_salt || ''),
      );
      if (!check.valid) continue;
      return Number(managerUser.id);
    }
    throw new AppError('كلمة مرور المدير غير صحيحة', 'ADMIN_PASSWORD_INVALID', 403);
  }

  async postStockCountSession(sessionId: number, auth: AuthContext, adminPassword?: string): Promise<Record<string, unknown>> {
    const tenantScope = this.tenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }

    // Decide the approval need from the items that would actually
    // post: an item whose stock moved since the count started is
    // skipped (see below), so a stale variance never demands approval
    // for a posting that will not happen. The per-chunk check inside
    // the transaction stays authoritative for the skip itself.
    // INV-STOCK-COUNT-DUAL-APPROVAL: the approver id resolved here is
    // the only value ever written to approved_by (below); when no
    // approval is needed it stays null. The approver is the password
    // holder, who may be the poster themself
    // (INV-STOCK-COUNT-SELF-APPROVAL).
    let approvedBy: number | null = null;
    const approvalSession = await this.db.selectFrom('stock_count_sessions').select(['id', 'branch_id', 'location_id', 'status', 'counted_by'])
      .where('id', '=', sessionId).where(this.tenantPredicate(auth)).executeTakeFirst();
    if (approvalSession && (approvalSession.status === 'draft' || approvalSession.status === 'posting')) {
      const unposted = await this.db.selectFrom('stock_count_items')
        .select(['id', 'product_id', 'expected_qty', 'variance_qty', 'counted_serials', 'batch_counts'])
        .where('session_id', '=', sessionId).where(this.tenantPredicate(auth))
        .where('posted_at', 'is', null).execute();
      let needsApproval = false;
      for (const item of unposted) {
        const serialData = typeof item.counted_serials === 'string' ? JSON.parse(item.counted_serials) : item.counted_serials;
        const batchData = typeof item.batch_counts === 'string' ? JSON.parse(item.batch_counts) : item.batch_counts;
        const hasTrace = (Array.isArray(serialData) && serialData.length > 0) || (Array.isArray(batchData) && batchData.length > 0);
        if (Math.abs(Number(item.variance_qty || 0)) < 0.001 && !hasTrace) continue;
        // INV-STOCK-COUNT-ADJUSTMENT: staleness is judged on the
        // physical on-hand basis new sessions freeze -- a pure
        // reservation change moves no physical stock, so it neither
        // demands approval nor blocks the posting below. Frozen rows
        // predate this fix (available basis), so a row counts as
        // unchanged when it matches EITHER basis: the stored row
        // carries no basis marker, and a real physical move changes
        // both bases, so it still fails both. A recount re-freezes
        // any pre-fix row on the on-hand basis.
        const currentOnHand = await previewAssignedLocationOnHandQty(this.db, {
          productId: Number(item.product_id), branchId: approvalSession.branch_id, locationId: approvalSession.location_id,
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
        });
        const currentAvailable = await previewAssignedLocationStockQty(this.db, {
          productId: Number(item.product_id), branchId: approvalSession.branch_id, locationId: approvalSession.location_id,
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
        });
        const expectedQty = Number(item.expected_qty || 0);
        if (Math.abs(currentOnHand - expectedQty) < 0.001 || Math.abs(currentAvailable - expectedQty) < 0.001) { needsApproval = true; break; }
      }
      if (needsApproval) approvedBy = await this.assertCountVarianceApproval(adminPassword, auth);
    }

    const chunkSize = 64;
    // INV-SPIRIT-COUNT-POSTING: an item whose stock moved since the
    // count started is skipped, never blocking the session: it stays
    // unposted for a standalone recount (recountPendingStockCountItem
    // refreshes its expected quantity), while every unchanged item
    // posts. Skipped ids are carried across chunks so the loop cannot
    // re-read the same stale item forever.
    const skippedItemIds: number[] = [];
    while (true) {
      const hasMore = await this.tx.runInTransaction(this.db, async (trx) => {
        const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantScope.tenantId));
        // The session lock serializes concurrent posting and retries. Each committed chunk carries
        // its own balanced journal, so no committed stock movement can be left without a ledger leg.
        const session = await trx.selectFrom('stock_count_sessions').selectAll()
          .where('id', '=', sessionId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
        if (!session) throw new AppError('Stock count session not found', 'SESSION_NOT_FOUND', 404);
        if (session.status === 'posted') return false;
        if (session.status !== 'draft' && session.status !== 'posting') {
          throw new AppError('Stock count session cannot be posted', 'SESSION_STATUS_INVALID', 409);
        }
        let pendingQuery = trx.selectFrom('stock_count_items').selectAll()
          .where('session_id', '=', sessionId).where(this.tenantPredicate(auth))
          .where('posted_at', 'is', null).orderBy('product_id', 'asc').orderBy('id', 'asc');
        if (skippedItemIds.length) pendingQuery = pendingQuery.where('id', 'not in', skippedItemIds) as typeof pendingQuery;
        const pending = await pendingQuery.limit(chunkSize + 1).execute();
        if (!pending.length) {
          if (skippedItemIds.length) {
            await this.audit.logWithExecutor(trx, 'تأجيل بنود جرد متغيرة لإعادة جرد مستقلة', JSON.stringify({ sessionId, skippedItemIds }), auth);
            return false;
          }
          if (session.status === 'draft') throw new AppError('Stock count session has no items', 'SESSION_EMPTY', 400);
          await trx.updateTable('stock_count_sessions').set({ status: 'posted', posted_at: sql`NOW()`, updated_at: sql`NOW()` })
            .where('id', '=', sessionId).where(this.tenantPredicate(auth)).execute();
          return false;
        }
        const items = pending.slice(0, chunkSize);
        await lockStockProducts(trx, { ...tenantScope, productIds: items.map((item) => Number(item.product_id)) });
        const postableItems: typeof items = [];
        const chunkSkippedIds: number[] = [];
        for (const item of items) {
          const expectedQty = Number(item.expected_qty || 0);
          // INV-STOCK-COUNT-ADJUSTMENT: the moved-stock skip compares
          // the frozen book quantity against the current stock on
          // EITHER basis -- on-hand for rows frozen by this fix,
          // available for pre-fix rows (see the approval check above:
          // a stored row carries no basis marker, and a real physical
          // move changes both bases). Reserving or releasing a unit
          // changes only the available basis, so it must not defer an
          // item frozen on the on-hand basis.
          const currentOnHand = await previewAssignedLocationOnHandQty(trx, {
            productId: Number(item.product_id), branchId: session.branch_id, locationId: session.location_id,
            tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
          });
          const currentAvailable = await previewAssignedLocationStockQty(trx, {
            productId: Number(item.product_id), branchId: session.branch_id, locationId: session.location_id,
            tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
          });
          if (Math.abs(currentOnHand - expectedQty) >= 0.001 && Math.abs(currentAvailable - expectedQty) >= 0.001) {
            skippedItemIds.push(Number(item.id));
            chunkSkippedIds.push(Number(item.id));
            continue;
          }
          postableItems.push(item);
          const variance = Number(item.variance_qty || 0);
          const serialData = typeof item.counted_serials === 'string' ? JSON.parse(item.counted_serials) : item.counted_serials;
          const batchData = typeof item.batch_counts === 'string' ? JSON.parse(item.batch_counts) : item.batch_counts;
          const hasTrace = (Array.isArray(serialData) && serialData.length > 0) ||
            (Array.isArray(batchData) && batchData.length > 0);
          if (Math.abs(variance) >= 0.001 || hasTrace) {
            const product = await trx.selectFrom('products').select('cost_price')
              .where('id', '=', item.product_id).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow();
            const rawCost = Number(product.cost_price || 0);
            const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
            if (!(Number(session.location_id) > 0)) {
              throw new AppError('الجرد المتتبع يحتاج مخزناً محدداً', 'STOCK_COUNT_LOCATION_REQUIRED', 409);
            }
            await reconcileStockCountTrace(trx, tenantScope, {
              itemId: Number(item.id), sessionId, productId: Number(item.product_id),
              branchId: session.branch_id, locationId: Number(session.location_id),
              expectedQty, countedQty: Number(item.counted_qty || 0), unitCost,
              countedSerials: serialData, batchCounts: batchData,
            });
            // Swapping physical serial identities or lot allocations can leave
            // quantity unchanged. It still needs a durable actor/line trace even
            // though no monetary journal is appropriate for a zero-net movement.
            if (hasTrace && Math.abs(variance) < 0.001) {
              await this.audit.logWithExecutor(trx, 'مطابقة سيريالات وتشغيلات جرد بلا فرق كمي',
                JSON.stringify({ sessionId, itemId: item.id, productId: item.product_id,
                  locationId: session.location_id, quantity: item.counted_qty,
                  countedSerials: serialData, batchCounts: batchData }), auth);
            }
          }
          if (Math.abs(variance) >= 0.001) {
            const product = await trx.selectFrom('products').select('cost_price')
              .where('id', '=', item.product_id).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow();
            const rawCost = Number(product.cost_price || 0);
            const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
            const stockChange = await setScopedStockQty(trx, {
              productId: Number(item.product_id), nextQty: Number(item.counted_qty || 0),
              branchId: session.branch_id, locationId: session.location_id,
              tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
              errorCode: 'INSUFFICIENT_STOCK', errorMessage: 'Stock count posting cannot drive total stock below zero',
              disableAutoDrain: true,
            });
            // INV-STOCK-COUNT-ACTUAL-DELTA: the counted quantity is the
            // physical on-hand quantity (reservations included), so the
            // posted quantity is the ACTUAL scoped delta -- what the
            // stock write really moved -- not the frozen available-basis
            // variance_qty. The stored variance stays the as-counted
            // record; the movement, its cost, the lot deduction, the
            // damage record, and the journal all follow the actual delta.
            const actualDelta = Number((stockChange.scopeAfter - stockChange.scopeBefore).toFixed(3));
            const totalCost = roundMoney(Math.abs(actualDelta) * unitCost, moneyDigits);
            // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the row goes
            // through the row-writer in row-only mode. The movement type
            // is only known AFTER the setter (buildStockCountPostingMovement
            // decides gain/loss from the post-setter actualDelta), and the
            // set mode needs movementType upfront and always writes a row —
            // so the set mode cannot express this site (see the writer
            // header). The identity fields still come from the helper; the
            // writer stamps scopeBefore/scopeAfter, the same override the
            // old row applied. The local totalCost stays: it feeds the
            // damaged_stock_records insert below, and equals the writer's
            // roundMoney(|actualDelta| * unitCost, moneyDigits).
            const movement = buildStockCountPostingMovement(item, sessionId, auth.userId, actualDelta);
            await recordStockMovementRow(trx, {
              productId: Number(item.product_id),
              branchId: session.branch_id,
              locationId: session.location_id,
              tenantId: tenantScope.tenantId,
              accountId: tenantScope.accountId,
              movementType: movement.movement_type,
              delta: actualDelta,
              beforeQty: stockChange.scopeBefore,
              afterQty: stockChange.scopeAfter,
              referenceType: movement.reference_type,
              referenceId: movement.reference_id,
              reason: movement.reason,
              note: movement.note,
              unitCost,
              moneyDigits,
              createdBy: auth.userId,
            });
            if (actualDelta < -0.0001) {
              await syncImportLotsOnStockDeduction(trx, {
                tenantId: tenantScope.tenantId,
                productId: Number(item.product_id),
                locationId: session.location_id,
                qty: Math.abs(actualDelta),
                reason: item.reason || 'stock_count_shortage',
              });
            }
            if (shouldCreateDamageRecordFromCount({ reason: item.reason, variance_qty: actualDelta })) {
              await trx.insertInto('damaged_stock_records').values({
                ...buildDamageRecordFromCount(item, session, auth.userId, actualDelta),
                unit_cost: unitCost, total_cost: totalCost, ...this.tenantFields(auth),
              }).execute();
            }
          }
        }
        const hasMoreChunks = pending.length > chunkSize;
        if (!postableItems.length) {
          // This chunk held only moved items: nothing posts, and the
          // session stays open for their standalone recounts. The next
          // chunk (if any) is still examined.
          if (!hasMoreChunks) {
            await this.audit.logWithExecutor(trx, 'تأجيل بنود جرد متغيرة لإعادة جرد مستقلة', JSON.stringify({ sessionId, skippedItemIds }), auth);
            return false;
          }
          return true;
        }
        await trx.updateTable('stock_count_sessions').set({
          status: hasMoreChunks ? 'posting' : (skippedItemIds.length ? 'draft' : 'posted'),
          // INV-STOCK-COUNT-DUAL-APPROVAL: approved_by is the identified
          // approver resolved before the loop — the password holder,
          // who may be the poster themself
          // (INV-STOCK-COUNT-SELF-APPROVAL); null when the session
          // needed no approval (zero variance).
          approved_by: approvedBy,
          ...(hasMoreChunks || skippedItemIds.length ? {} : { posted_at: sql`NOW()` }),
          updated_at: sql`NOW()`,
        }).where('id', '=', sessionId).where(this.tenantPredicate(auth)).execute();
        const posting = await this.accountingPosting.postStockCount(trx, sessionId, auth, postableItems.map((item) => Number(item.id)));
        if (posting.hasFinancialImpact && !posting.journalEntryId) {
          throw new AppError(`Stock count ${sessionId} chunk has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
        }
        await trx.updateTable('stock_count_items').set({ posted_at: sql`NOW()` })
          .where('id', 'in', postableItems.map((item) => Number(item.id))).where(this.tenantPredicate(auth)).execute();
        await this.audit.logWithExecutor(trx, 'ترحيل دفعة جرد', JSON.stringify({
          sessionId, firstItemId: postableItems[0].id, itemCount: postableItems.length,
          journalEntryId: posting.journalEntryId, remaining: hasMoreChunks, skippedItemIds: chunkSkippedIds,
        }), auth);
        return hasMoreChunks;
      });
      if (!hasMore) break;
    }
    await this.audit.log(skippedItemIds.length ? 'اعتماد جزئي لجلسة جرد' : 'اعتماد جلسة جرد', JSON.stringify({ actorUserId: auth.userId, after: { sessionId, status: skippedItemIds.length ? 'draft' : 'posted', skippedItemIds } }), auth);
    const responsePayload = { ok: true, skippedStockCountItemIds: skippedItemIds, stockCountSessions: (await this.listStockCountSessions({}, auth)).stockCountSessions, products: (await this.db.selectFrom('products').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(auth)).execute()).map((p) => ({ id: String(p.id), name: p.name })), stockMovements: (await this.listStockMovements({}, auth)).stockMovements, damagedStockRecords: (await this.listDamagedStock({}, auth)).damagedStockRecords };
    if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
      const idKey = idemCtx.idempotencyKey;
      const opType = idemCtx.operationType;
      await this.tx.runInTransaction(this.db, async (trx) => {
        await this.idempotency.commitOperation(trx, { tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey: idKey, operationType: opType }, responsePayload);
      });
    }
    return responsePayload;
  }

  async listDamagedStock(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 10)));
    const offset = (page - 1) * pageSize;
    const search = String(query.search || query.q || '').trim();

    let baseQuery = this.db
      .selectFrom('damaged_stock_records as d')
      .leftJoin('products as p', (join) => join.onRef('p.id', '=', 'd.product_id').onRef('p.tenant_id', '=', 'd.tenant_id'))
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 'd.branch_id').onRef('b.tenant_id', '=', 'd.tenant_id'))
      .leftJoin('stock_locations as l', (join) => join.onRef('l.id', '=', 'd.location_id').onRef('l.tenant_id', '=', 'd.tenant_id'))
      .leftJoin('users as u', (join) => join.onRef('u.id', '=', 'd.created_by').onRef('u.tenant_id', '=', 'd.tenant_id'))
      .where(this.tenantPredicate(auth, 'd'));

    if (search) {
      const normalizedSearch = normalizeArabicSearch(search);
      const tokens = normalizedSearch.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        for (const token of tokens) {
          const term = `%${token}%`;
          baseQuery = baseQuery.where(sql<boolean>`(
            TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR LOWER(COALESCE(p.name_en, '') ) LIKE ${term}
            OR LOWER(COALESCE(p.barcode, '')) LIKE ${term}
            OR LOWER(COALESCE(p.style_code, '')) LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(d.reason, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(d.note, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(b.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
            OR TRANSLATE(LOWER(COALESCE(l.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
          )`);
        }
      }
    }

    const countRes = await baseQuery
      .select(({ fn }) => [fn.count('d.id').as('total'), fn.sum('d.qty').as('total_qty')])
      .executeTakeFirst();

    const totalItems = Number(countRes?.total || 0);
    const totalQty = Number(countRes?.total_qty || 0);

    const rows = await baseQuery
      .select(['d.id', 'd.product_id', 'd.branch_id', 'd.location_id', 'd.qty', 'd.reason', 'd.note', 'd.created_at', 'p.name as product_name', 'b.name as branch_name', 'l.name as location_name', 'u.username as created_by_name'])
      .orderBy('d.id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    let mapped = rows.map(mapDamagedStockRow);
    mapped = await this.scope.filterByScope(mapped, auth);
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    return {
      damagedStockRecords: mapped,
      pagination: { page, pageSize, totalItems, totalPages },
      summary: { totalItems, totalQty: Number(totalQty.toFixed(3)) },
      scope: this.tenantScope(auth),
    };
  }

  async createDamagedStock(payload: CreateDamagedStockDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = this.tenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }

    const location = await this.scope.assertLocationScope(payload.locationId, auth, false, 'write');
    const effectiveNote = String(payload.note || '').trim() || String(payload.reason || '').trim();
    if (!effectiveNote) throw new AppError('اكتب سبب التالف', 'DAMAGE_NOTE_REQUIRED', 400);
    payload.note = effectiveNote;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantScope.tenantId));
      const product = await trx.selectFrom('products').selectAll()
        .where('id', '=', payload.productId).where('is_active', '=', true)
        .where(this.tenantPredicate(auth)).where('account_id', '=', tenantScope.accountId)
        .forUpdate().executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const rawCost = Number(product.cost_price || 0);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
      const damageQty = Number(payload.qty);
      const totalCost = roundMoney(damageQty * unitCost, moneyDigits);
      if (!Number.isFinite(damageQty) || damageQty <= 0
        || Math.abs(damageQty * 1000 - Math.round(damageQty * 1000)) > 0.000001) {
        throw new AppError('Damage quantity must be positive with at most three decimal places', 'INVALID_QTY', 400);
      }
      const availableQty = await previewConsumableStockQty(trx, { productId: payload.productId, branchId: location.branchId, locationId: location.id, tenantId: tenantScope.tenantId, accountId: tenantScope.accountId });
      const writeModels = buildDamagedStockWriteModels({ ...product, stock_qty: availableQty }, payload, location, auth.userId);
      const insertedDamage = await trx.insertInto('damaged_stock_records').values({
         ...writeModels.damagedRecord,
         unit_cost: unitCost,
         total_cost: totalCost,
         ...this.tenantFields(auth)
      }).returning('id').executeTakeFirst();
      if (!insertedDamage?.id) throw new AppError('Failed to capture damaged stock ID', 'DAMAGE_INSERT_FAILED', 500);

      const trace = await dispatchTrackedStock(trx, tenantScope, {
        productId: Number(payload.productId), qty: damageQty,
        serials: payload.serials, batchAllocations: payload.batchAllocations,
      }, location.id, location.branchId, null, Number(insertedDamage.id));
      await trx.updateTable('damaged_stock_records').set({
        serial_tracking: JSON.stringify(trace.serialTracking),
        batch_tracking: JSON.stringify(trace.batchTracking),
      } as any).where('id', '=', Number(insertedDamage.id)).where(this.tenantPredicate(auth)).execute();

      // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the damaged deduct
      // goes through the row-writer; the row stamps the ledger's
      // scopeBefore/scopeAfter (the same override the old row applied
      // over the write-model's available-basis before/after), keeps the
      // write-model's identity fields (type 'damaged', reason, note,
      // reference 'damaged_stock' / the damage record id), and the
      // writer computes roundMoney(damageQty * unitCost, moneyDigits) —
      // the same totalCost the damaged record below still uses.
      await recordStockMovement(trx, {
        productId: payload.productId,
        delta: -damageQty,
        branchId: location.branchId,
        locationId: location.id,
        tenantId: tenantScope.tenantId,
        accountId: tenantScope.accountId,
        errorCode: 'INSUFFICIENT_STOCK',
        errorMessage: 'Cannot mark more damaged stock than current stock',
        disableAutoDrain: true,
        movementType: 'damaged',
        referenceType: 'damaged_stock',
        referenceId: Number(insertedDamage.id),
        reason: writeModels.stockMovement.reason,
        note: writeModels.stockMovement.note,
        unitCost,
        moneyDigits,
        createdBy: auth.userId,
      });

      await syncImportLotsOnStockDeduction(trx, {
        tenantId: tenantScope.tenantId,
        productId: Number(payload.productId),
        locationId: location.id,
        qty: damageQty,
        reason: payload.reason || 'damaged_stock',
      });

      const posting = await this.accountingPosting.postDamagedStock(trx, Number(insertedDamage.id), auth);
      if (posting.hasFinancialImpact && !posting.journalEntryId) throw new AppError(`Damaged stock ${insertedDamage.id} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
      if (idemCtx?.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(trx, {
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
          idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType,
        }, { ok: true, damageId: Number(insertedDamage.id) }, String(insertedDamage.id));
      }
    });
    await this.audit.log('تسجيل تالف', JSON.stringify({ actorUserId: auth.userId, productId: payload.productId, qty: payload.qty }), auth);
    const responsePayload = { ok: true, products: (await this.db.selectFrom('products').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(auth)).execute()).map((p) => ({ id: String(p.id), name: p.name })), damagedStockRecords: (await this.listDamagedStock({}, auth)).damagedStockRecords, stockMovements: (await this.listStockMovements({}, auth)).stockMovements };
    return responsePayload;
  }
}
