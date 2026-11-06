import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { paginateRows } from '../../../common/utils/pagination';
import { applyStockDelta, lockStockProducts, previewAssignedLocationStockQty, previewConsumableStockQty, setScopedStockQty } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { CreateDamagedStockDto } from '../dto/create-damaged-stock.dto';
import { CreateStockCountSessionDto, RecountStockCountItemDto } from '../dto/create-stock-count-session.dto';
import { buildDamagedStockSummary, buildStockCountSummary, buildStockMovementSummary, groupStockCountItemsBySession, mapDamagedStockRow, mapStockCountSessionRow, mapStockMovementRow } from '../helpers/inventory-count-listing.helper';
import { assertInventoryLocationBranchMatch, buildDamagedStockWriteModels, buildDamageRecordFromCount, buildStockCountItemValues, buildStockCountPostingMovement, buildStockCountSessionDocNo, shouldCreateDamageRecordFromCount } from '../helpers/inventory-count-write.helper';
import { InventoryScopeService } from './inventory-scope.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { assertUntrackedStockMutation } from '../helpers/inventory-tracked-stock.helper';
import { dispatchTrackedStock } from '../helpers/stock-transfer-trace.helper';
import { reconcileStockCountTrace } from '../helpers/stock-count-trace.helper';
import { verifyPassword } from '../../../core/auth/utils/password-hasher';
import { normalizeArabicSearch, matchesArabic } from '../../../common/utils/arabic-search.util';
import { syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

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

    if (!query.page && !query.pageSize && !query.search && !query.filter && !query.view) return { stockCountSessions: mapped, damagedStockRecords: (await this.listDamagedStock({}, auth)).damagedStockRecords, scope: this.tenantScope(auth) };
    const search = String(query.search || query.q || '').trim();
    const filter = String(query.filter || query.view || 'all').toLowerCase();
    const filtered = mapped.filter((row) => (filter === 'all' || String(row.status).toLowerCase() === filter || (filter === 'draft' && String(row.status).toLowerCase() === 'posting')) && (!search || [row.docNo, row.note, row.locationName, row.branchName].some((x) => matchesArabic(x, search))));
    const paged = paginateRows(filtered, query, { defaultSize: 8 });
    return { stockCountSessions: paged.rows, pagination: paged.pagination, summary: buildStockCountSummary(filtered as unknown as Array<{ status: string; items: Array<{ varianceQty: number }> }>), scope: this.tenantScope(auth) };
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
        const expectedQty = await previewAssignedLocationStockQty(trx, { productId: item.productId, branchId: location.branchId, locationId: location.id, tenantId: tenantScope.tenantId, accountId: tenantScope.accountId });
        await trx.insertInto('stock_count_items').values({
          ...buildStockCountItemValues({ ...product, stock_qty: expectedQty }, item, id),
          counted_serials: JSON.stringify(item.countedSerials || []),
          batch_counts: JSON.stringify(item.batchCounts || []),
          ...this.tenantFields(auth),
        } as any).execute();
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
      const expectedQty = await previewAssignedLocationStockQty(trx, {
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

  private async assertCountVarianceApproval(credential: string | undefined, auth: AuthContext): Promise<void> {
    if (auth.role === 'admin' || auth.role === 'super_admin') return;
    const normalized = String(credential || '').trim();
    if (!normalized) {
      throw new AppError('اعتماد فروقات الجرد يتطلب رمز اعتماد المدير أو كلمة مرور المدير', 'ADMIN_PASSWORD_REQUIRED', 403);
    }
    const managerPin = await this.getManagerPin(this.db, auth);
    if (managerPin && normalized === managerPin) return;
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
      if (check.valid) return;
    }
    throw new AppError('رمز اعتماد المدير أو كلمة مرور المدير غير صحيحة', 'ADMIN_PASSWORD_INVALID', 403);
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
    const approvalSession = await this.db.selectFrom('stock_count_sessions').select(['id', 'branch_id', 'location_id', 'status'])
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
        const currentQty = await previewAssignedLocationStockQty(this.db, {
          productId: Number(item.product_id), branchId: approvalSession.branch_id, locationId: approvalSession.location_id,
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
        });
        if (Math.abs(currentQty - Number(item.expected_qty || 0)) < 0.001) { needsApproval = true; break; }
      }
      if (needsApproval) await this.assertCountVarianceApproval(adminPassword, auth);
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
          const currentQty = await previewAssignedLocationStockQty(trx, {
            productId: Number(item.product_id), branchId: session.branch_id, locationId: session.location_id,
            tenantId: tenantScope.tenantId, accountId: tenantScope.accountId,
          });
          if (Math.abs(currentQty - expectedQty) >= 0.001) {
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
            await trx.insertInto('stock_movements').values({
              ...buildStockCountPostingMovement(item, sessionId, auth.userId, actualDelta),
              before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter,
              branch_id: session.branch_id, location_id: session.location_id,
              unit_cost: unitCost, total_cost: totalCost, ...this.tenantFields(auth),
            }).execute();
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
          approved_by: auth.userId,
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

      const stockChange = await applyStockDelta(trx, { productId: payload.productId, delta: -damageQty, branchId: location.branchId, locationId: location.id, tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, errorCode: 'INSUFFICIENT_STOCK', errorMessage: 'Cannot mark more damaged stock than current stock', disableAutoDrain: true });

      await trx.insertInto('stock_movements').values({
         ...writeModels.stockMovement,
         before_qty: stockChange.scopeBefore,
         after_qty: stockChange.scopeAfter,
         branch_id: location.branchId ?? null,
         location_id: location.id,
         reference_id: insertedDamage.id,
         unit_cost: unitCost,
         total_cost: totalCost,
         ...this.tenantFields(auth)
      }).execute();

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
