import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { WhatsAppAlertPort } from '../../../common/utils/whatsapp-alert.port';
import {
  assertTransferMakerChecker,
  generateStockTransferDocNo,
  groupTransferItemsByTransfer,
  loadCategoryStockItemsForTwoStep,
  resolveTransferAntiTheftContext,
  sendTransferShortageWhatsAppAlert,
} from '../helpers/inventory-loss-prevention.helper';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { ensureNonNegativeStock, ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { applyStockDelta, lockStockProducts, previewAssignedLocationStockQty } from '../../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { KYSELY_DB } from '../../../database/database.constants';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { Database } from '../../../database/database.types';
import { CreateStockTransferDto } from '../dto/create-stock-transfer.dto';
import { CreateCategoryTransferDto } from '../dto/create-category-transfer.dto';
import { InventoryScopeService } from './inventory-scope.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { assertUntrackedStockMutation } from '../helpers/inventory-tracked-stock.helper';
import { syncImportLotsOnLocationTransfer, syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { authorizeManagerSecret, isSoloAdminOverride } from '../../../common/utils/manager-approval';
import { dispatchTrackedStock, receiveTrackedStock, cancelTrackedStock, type TransferReceiptTraceRequest } from '../helpers/stock-transfer-trace.helper';
import { moveDirectTrackedStock } from '../helpers/direct-tracked-stock-move.helper';

@Injectable()
export class InventoryTransferService {
  private readonly logger = new Logger(InventoryTransferService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly scope: InventoryScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppAlertPort,
  ) {}

  private tenantScope(auth: AuthContext) { return requireTenantScope(auth); }
  private tenantPredicate(auth: AuthContext, alias?: string) { const tenantId = this.tenantScope(auth).tenantId; return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`; }
  private tenantFields(auth: AuthContext) { const scope = this.tenantScope(auth); return { tenant_id: scope.tenantId, account_id: scope.accountId }; }

  private async getOrCreateInTransitLocation(trx: Kysely<Database>, scope: { tenantId: string; accountId: string }): Promise<number> {
    await sql`select pg_advisory_xact_lock(731234, hashtext(${scope.tenantId}))`.execute(trx);
    const existing = await trx.selectFrom('stock_locations').select(['id']).where('location_type', '=', 'in_transit').where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (existing) return existing.id;
    const inserted = await trx.insertInto('stock_locations').values({ name: 'بضاعة بالطريق', code: 'IN_TRANSIT', location_type: 'in_transit', is_active: true, tenant_id: scope.tenantId, account_id: scope.accountId }).returning('id').executeTakeFirstOrThrow();
    return inserted.id;
  }

  async listStockTransfers(query: Record<string, unknown>, auth: AuthContext, executor: Kysely<Database> = this.db): Promise<Record<string, unknown>> {
    if (!auth.permissions.includes('inventory') && !auth.permissions.includes('canAdjustInventory')) throw new ForbiddenException('Missing required permissions');
    // INV-INV-COUNT-TRANSFER-SQL-PAGINATION: a paged request never loads
    // the whole tenant set — the page is fetched from SQL below.
    if (query.page || query.pageSize || query.search || query.q || query.filter || query.view) return this.listStockTransfersPage(query, auth, executor);
    let transfersQuery = executor
      .selectFrom('stock_transfers as t')
      .leftJoin('stock_locations as fl', (join) => join.onRef('fl.id', '=', 't.from_location_id').onRef('fl.tenant_id', '=', 't.tenant_id'))
      .leftJoin('stock_locations as tl', (join) => join.onRef('tl.id', '=', 't.to_location_id').onRef('tl.tenant_id', '=', 't.tenant_id'))
      .leftJoin('branches as fb', (join) => join.onRef('fb.id', '=', 't.from_branch_id').onRef('fb.tenant_id', '=', 't.tenant_id'))
      .leftJoin('branches as tb', (join) => join.onRef('tb.id', '=', 't.to_branch_id').onRef('tb.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as cu', (join) => join.onRef('cu.id', '=', 't.created_by').onRef('cu.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as ru', (join) => join.onRef('ru.id', '=', 't.received_by').onRef('ru.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as xu', (join) => join.onRef('xu.id', '=', 't.cancelled_by').onRef('xu.tenant_id', '=', 't.tenant_id'))
      .select(['t.id', 't.doc_no', 't.from_location_id', 't.to_location_id', 't.from_branch_id', 't.to_branch_id', 't.status', 't.note', 't.recipient_name', sql<number | null>`NULLIF(to_jsonb(t)->>'carrier_employee_id', '')::integer`.as('carrier_employee_id'), sql<string | null>`to_jsonb(t)->>'carrier_name'`.as('carrier_name'), sql<string | null>`to_jsonb(t)->>'in_transit_alerted_at'`.as('in_transit_alerted_at'), 't.received_at', 't.cancelled_at', 't.created_at', 'fl.name as from_location_name', 'tl.name as to_location_name', 'fb.name as from_branch_name', 'tb.name as to_branch_name', 'cu.username as created_by_name', 'ru.username as received_by_name', 'xu.username as cancelled_by_name'])
      .where(this.tenantPredicate(auth, 't'));

    if (query.locationId) {
      const locId = Number(query.locationId);
      transfersQuery = transfersQuery.where((eb) => eb.or([eb('t.from_location_id', '=', locId), eb('t.to_location_id', '=', locId)]));
    }

    const transfers = await transfersQuery.orderBy('t.id', 'desc').execute();

    const transferIds = transfers.map((t) => Number(t.id || 0)).filter((id) => id > 0);
    const items = transferIds.length ? await executor
      .selectFrom('stock_transfer_items')
      .select(['id', 'transfer_id', 'product_id', 'product_name', 'qty', 'serial_tracking', 'batch_tracking'])
      .where('transfer_id', 'in', transferIds)
      .where(this.tenantPredicate(auth))
      .orderBy('transfer_id', 'asc')
      .execute() : [];

    const byTransfer = groupTransferItemsByTransfer(items);

    let rows = transfers.map((t) => ({ id: String(t.id), docNo: t.doc_no || `TR-${t.id}`, fromLocationId: String(t.from_location_id), toLocationId: t.to_location_id ? String(t.to_location_id) : '', fromBranchId: t.from_branch_id ? String(t.from_branch_id) : '', toBranchId: t.to_branch_id ? String(t.to_branch_id) : '', fromLocationName: t.from_location_name || '', toLocationName: t.to_location_name || '', fromBranchName: t.from_branch_name || '', toBranchName: t.to_branch_name || '', status: t.status || 'sent', note: t.note || '', recipientName: t.recipient_name || '', carrierEmployeeId: t.carrier_employee_id ? String(t.carrier_employee_id) : '', carrierName: t.carrier_name || '', inTransitAlertedAt: t.in_transit_alerted_at || '', receivedAt: t.received_at || '', cancelledAt: t.cancelled_at || '', createdBy: t.created_by_name || '', receivedBy: t.received_by_name || '', cancelledBy: t.cancelled_by_name || '', date: t.created_at, items: byTransfer.get(String(t.id)) || [] }));
    rows = await this.scope.filterByScope(rows, auth, executor);
    const search = String(query.search || query.q || '').toLowerCase();
    const filter = String(query.filter || query.view || 'all').toLowerCase();
    const filtered = rows.filter((row) => (filter === 'all' || String(row.status).toLowerCase() === filter) && (!search || [row.docNo, row.note, row.fromLocationName, row.toLocationName].some((val) => String(val).toLowerCase().includes(search))));
    return { stockTransfers: filtered, scope: this.tenantScope(auth) };
  }

  private async listStockTransfersPage(query: Record<string, unknown>, auth: AuthContext, executor: Kysely<Database> = this.db): Promise<Record<string, unknown>> {
    // INV-INV-COUNT-TRANSFER-SQL-PAGINATION: the page is fetched from
    // SQL — the old in-memory pagination semantics are preserved
    // (defaultSize 10, page clamped to [1, totalPages], cap 200), and the
    // summary stays exact over the FULL filtered set. The search is the
    // PLAIN lowercase substring (no Arabic normalization, NO trim) over
    // docNo (fallback 'TR-' + id), note, fromLocationName,
    // toLocationName; the filter is the lowercased status compare, no
    // posting quirk; locationId filters from OR to location. The
    // unpaginated path above is untouched, and the executor (transaction
    // handle) is threaded through every query.
    const search = String(query.search || query.q || '').toLowerCase();
    const filter = String(query.filter || query.view || 'all').toLowerCase();
    const locId = query.locationId ? Number(query.locationId) : null;
    const scopeIds = await this.scope.branchScope(auth, executor);
    const unrestricted = this.scope.isUnrestrictedBranchScope(auth);
    const scopePredicate = unrestricted
      ? sql<boolean>`true`
      : scopeIds.length === 0
        ? sql<boolean>`false`
        : sql<boolean>`(t.from_branch_id IS NULL OR t.from_branch_id = ANY(${scopeIds})) AND (t.to_branch_id IS NULL OR t.to_branch_id = ANY(${scopeIds}))`;
    const locationPredicate = locId === null
      ? null
      : Number.isFinite(locId)
        ? sql<boolean>`(t.from_location_id = ${locId} OR t.to_location_id = ${locId})`
        : sql<boolean>`false`;
    const filterPredicate = filter === 'all'
      ? null
      : sql<boolean>`lower(coalesce(nullif(t.status, ''), 'sent')) = ${filter}`;
    const searchPredicate = search
      ? sql<boolean>`(
        strpos(lower(coalesce(nullif(t.doc_no, ''), 'TR-' || t.id)), ${search}) > 0
        OR strpos(lower(coalesce(t.note, '')), ${search}) > 0
        OR strpos(lower(coalesce(fl.name, '')), ${search}) > 0
        OR strpos(lower(coalesce(tl.name, '')), ${search}) > 0
      )`
      : null;
    const where = sql<boolean>`${this.tenantPredicate(auth, 't')} AND ${scopePredicate}${locationPredicate ? sql` AND ${locationPredicate}` : sql``}${filterPredicate ? sql` AND ${filterPredicate}` : sql``}${searchPredicate ? sql` AND ${searchPredicate}` : sql``}`;
    const counts = await sql<{ total_items: string; sent_count: string; received_count: string; cancelled_count: string; total_qty: string }>`
      SELECT COUNT(DISTINCT t.id) AS total_items,
        COUNT(DISTINCT t.id) FILTER (WHERE coalesce(nullif(t.status, ''), 'sent') = 'sent') AS sent_count,
        COUNT(DISTINCT t.id) FILTER (WHERE coalesce(nullif(t.status, ''), 'sent') = 'received') AS received_count,
        COUNT(DISTINCT t.id) FILTER (WHERE coalesce(nullif(t.status, ''), 'sent') = 'cancelled') AS cancelled_count,
        coalesce(SUM(it.qty), 0) AS total_qty
      FROM stock_transfers t
      LEFT JOIN stock_locations fl ON fl.id = t.from_location_id AND fl.tenant_id = t.tenant_id
      LEFT JOIN stock_locations tl ON tl.id = t.to_location_id AND tl.tenant_id = t.tenant_id
      LEFT JOIN stock_transfer_items it ON it.transfer_id = t.id AND it.tenant_id = t.tenant_id
      WHERE ${where}
    `.execute(executor);
    const totalItems = Number(counts.rows[0]?.total_items || 0);
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 10);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT t.id, t.doc_no, t.from_location_id, t.to_location_id, t.from_branch_id, t.to_branch_id, t.status, t.note, t.recipient_name, NULLIF(to_jsonb(t)->>'carrier_employee_id', '')::integer AS carrier_employee_id, to_jsonb(t)->>'carrier_name' AS carrier_name, to_jsonb(t)->>'in_transit_alerted_at' AS in_transit_alerted_at, t.received_at, t.cancelled_at, t.created_at,
        fl.name AS from_location_name, tl.name AS to_location_name,
        fb.name AS from_branch_name, tb.name AS to_branch_name,
        cu.username AS created_by_name, ru.username AS received_by_name, xu.username AS cancelled_by_name
      FROM stock_transfers t
      LEFT JOIN stock_locations fl ON fl.id = t.from_location_id AND fl.tenant_id = t.tenant_id
      LEFT JOIN stock_locations tl ON tl.id = t.to_location_id AND tl.tenant_id = t.tenant_id
      LEFT JOIN branches fb ON fb.id = t.from_branch_id AND fb.tenant_id = t.tenant_id
      LEFT JOIN branches tb ON tb.id = t.to_branch_id AND tb.tenant_id = t.tenant_id
      LEFT JOIN users cu ON cu.id = t.created_by AND cu.tenant_id = t.tenant_id
      LEFT JOIN users ru ON ru.id = t.received_by AND ru.tenant_id = t.tenant_id
      LEFT JOIN users xu ON xu.id = t.cancelled_by AND xu.tenant_id = t.tenant_id
      WHERE ${where}
      ORDER BY t.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(executor);
    const pageIds = result.rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);
    const pageItems = pageIds.length
      ? await executor.selectFrom('stock_transfer_items').select(['id', 'transfer_id', 'product_id', 'product_name', 'qty', 'serial_tracking', 'batch_tracking']).where('transfer_id', 'in', pageIds).where(this.tenantPredicate(auth)).orderBy('transfer_id', 'asc').execute()
      : [];
    const byTransfer = groupTransferItemsByTransfer(pageItems);
    const mapped = result.rows.map((t) => ({ id: String(t.id), docNo: t.doc_no || `TR-${t.id}`, fromLocationId: String(t.from_location_id), toLocationId: t.to_location_id ? String(t.to_location_id) : '', fromBranchId: t.from_branch_id ? String(t.from_branch_id) : '', toBranchId: t.to_branch_id ? String(t.to_branch_id) : '', fromLocationName: t.from_location_name || '', toLocationName: t.to_location_name || '', fromBranchName: t.from_branch_name || '', toBranchName: t.to_branch_name || '', status: t.status || 'sent', note: t.note || '', recipientName: t.recipient_name || '', carrierEmployeeId: t.carrier_employee_id ? String(t.carrier_employee_id) : '', carrierName: t.carrier_name || '', inTransitAlertedAt: t.in_transit_alerted_at || '', receivedAt: t.received_at || '', cancelledAt: t.cancelled_at || '', createdBy: t.created_by_name || '', receivedBy: t.received_by_name || '', cancelledBy: t.cancelled_by_name || '', date: t.created_at, items: byTransfer.get(String(t.id)) || [] }));
    // The summary is exact over the FULL filtered set, never page-scoped.
    const summary = {
      totalItems,
      sent: Number(counts.rows[0]?.sent_count || 0),
      received: Number(counts.rows[0]?.received_count || 0),
      cancelled: Number(counts.rows[0]?.cancelled_count || 0),
      totalQty: Number(Number(counts.rows[0]?.total_qty || 0).toFixed(3)),
    };
    return { stockTransfers: mapped, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary, scope: this.tenantScope(auth) };
  }

  async createStockTransfer(payload: CreateStockTransferDto, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId && payload.toLocationId != null) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    ensureUniqueFlowItems(payload.items || [], 'TRANSFER_DUPLICATE_PRODUCT', 'Transfer must not contain duplicate product rows with the same unit');
    const scope = this.tenantScope(auth);
    const from = await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = payload.toLocationId ? await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write') : null;

    if (!to && !payload.toBranchId) {
      throw new AppError('Destination location or branch is required', 'INVALID_TRANSFER', 400);
    }
    if (!to && payload.toBranchId) {
      const branch = await this.db.selectFrom('branches').select('id')
        .where('id', '=', payload.toBranchId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
      if (!branch) throw new AppError('Destination branch not found', 'DESTINATION_BRANCH_NOT_FOUND', 404);
    }
    // F19: final issue to a van_stock location is never a consumption — vans load via requisition/dispatch; refuse before anything is written.
    const issueMode = payload.issueMode || 'transfer_to_branch_stock';
    if (issueMode === 'final_issue' && to && to.locationType === 'van_stock') {
      throw new AppError('الصرف النهائي إلى مخزن سيارة غير مسموح؛ تحميل السيارة يتم عبر إذن التحميل فقط', 'FINAL_ISSUE_TO_VAN_NOT_ALLOWED', 400);
    }
    if (!(payload.items || []).length || payload.items.some((item) =>
      !Number.isSafeInteger(Number(item.productId)) || Number(item.productId) <= 0 ||
      !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 ||
      Math.abs(Number(item.qty) * 1000 - Math.round(Number(item.qty) * 1000)) > 0.000001)) {
      throw new AppError('Transfer items require valid product IDs and positive quantities with at most three decimal places', 'INVALID_TRANSFER_QUANTITY', 400);
    }

    const transferId = await this.tx.runInTransaction(this.db, async (trx) => {
      // INV-TRANSFER-RECEIPT-PINNED: the dispatch cost is frozen on the
      // transfer_send movement at the tenant's book digits, so a later
      // receipt values any shrinkage at this cost, never at the
      // receive-time cost_price.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const { effectiveIssueMode, carrierEmployeeId, carrierName } = await resolveTransferAntiTheftContext(trx, scope.tenantId, payload, Boolean(to), issueMode, auth);
      const initialStatus = effectiveIssueMode === 'final_issue' ? 'received' : 'sent';

      const result = await trx.insertInto('stock_transfers').values({
        from_location_id: from.id,
        to_location_id: to ? to.id : null,
        from_branch_id: from.branchId,
        to_branch_id: to ? to.branchId : (payload.toBranchId || null),
        status: initialStatus,
        note: String(payload.note || '').trim(),
        recipient_name: payload.recipientName || null,
        ...(carrierEmployeeId != null ? { carrier_employee_id: carrierEmployeeId } : {}),
        ...(carrierName ? { carrier_name: carrierName } : {}),
        created_by: auth.userId,
        ...(initialStatus === 'received' ? { received_by: auth.userId, received_at: sql`NOW()` } : {}),
        ...this.tenantFields(auth)
      }).returning('id').executeTakeFirstOrThrow();
      const id = Number(result.id);
      const docNo = await this.generateTransferDocNo(trx, id, auth);
      await trx.updateTable('stock_transfers').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', id).where(this.tenantPredicate(auth)).execute();

      let inTransitLocationId: number | null = null;
      if (initialStatus === 'sent') {
        inTransitLocationId = await this.getOrCreateInTransitLocation(trx, scope);
      }

      await lockStockProducts(trx, { ...scope, productIds: payload.items.map((item) => item.productId) });
      // F19: a final issue to a stock-holding location is a MOVE, not a
      // consumption. `to` can only be one here (in_transit refused by
      // assertLocationScope, van_stock refused above); null `to` stays the sink.
      const finalIssueDest = effectiveIssueMode === 'final_issue' ? to : null;
      for (const item of [...payload.items].sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const product = await trx.selectFrom('products').select(['id', 'name', 'cost_price']).where('id', '=', item.productId).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: from.branchId, locationId: from.id };

        // Ensure quantity is available in this specific location ONLY
        const availableAtSource = await previewAssignedLocationStockQty(trx, stockScope);
        ensureNonNegativeStock(Number(availableAtSource || 0) - Number(item.qty || 0), 'INSUFFICIENT_LOCATION_STOCK', `الكمية غير كافية في مخزن ${from.name} للصنف ${product.name}. المتاح: ${availableAtSource || 0}`);

        const isFinalIssue = effectiveIssueMode === 'final_issue';
        const isFinalIssueToLocation = finalIssueDest !== null;
        const trace = await dispatchTrackedStock(trx, scope, item, from.id, from.branchId, finalIssueDest ? finalIssueDest.id : inTransitLocationId, id);
        await trx.insertInto('stock_transfer_items').values({
          transfer_id: id, product_id: item.productId, product_name: product.name || '', qty: item.qty,
          // PostgreSQL NUMERIC values are returned as strings. A default
          // "0.000" is truthy, so a later receiver cannot infer dispatch
          // quantity using ||. Persist the actual dispatch at source.
          dispatched_qty: Number(item.qty),
          received_qty: isFinalIssue ? Number(item.qty) : 0,
          variance_qty: 0,
          serial_tracking: JSON.stringify(trace.serialTracking), batch_tracking: JSON.stringify(trace.batchTracking),
          ...this.tenantFields(auth),
        }).execute();

        // Deduct from source. Only reduce global stock if final_issue to a
        // consumption sink (inTransitLocationId is null and there is no
        // destination location). A final issue to a warehouse keeps the
        // global counter: the paired IN leg below credits the same qty.
        const originalUnitCost = Number(product.cost_price || 0);
        const unitCost = Number.isFinite(originalUnitCost) && originalUnitCost > 0 ? originalUnitCost : 0;
        const movement = await recordStockMovement(trx, {
          ...stockScope,
          delta: -Number(item.qty || 0),
          skipGlobalUpdate: inTransitLocationId !== null || isFinalIssueToLocation,
          disableAutoDrain: true,
          errorCode: 'INSUFFICIENT_LOCATION_STOCK',
          errorMessage: `Insufficient stock at ${from.name} for ${product.name}`,
          movementType: (isFinalIssue && !isFinalIssueToLocation) ? 'transfer_final_issue' : 'transfer_send',
          referenceType: 'transfer',
          referenceId: id,
          reason: (isFinalIssue && !isFinalIssueToLocation) ? 'final_issue' : 'transfer_send',
          note: (isFinalIssue && !isFinalIssueToLocation) ? `صرف نهائي TR-${id}` : (isFinalIssueToLocation ? `صرف نهائي إلى ${finalIssueDest.name} TR-${id}` : `Sent transfer TR-${id}`),
          // The dispatch cost is frozen on every send movement, not only
          // on final issues: the receipt reads it back to value shrinkage.
          unitCost,
          createdBy: auth.userId,
          moneyDigits,
        });
        if (isFinalIssue && !isFinalIssueToLocation) {
          // Unlike a transfer-in-transit this immediately removes a company
          // asset, so it needs an expense journal in the SAME transaction.
          // A final issue to a warehouse posts no journal: the goods still
          // exist, in another warehouse (F19).
          const posting = await this.accountingPosting.postInventoryAdjustment(trx, Number(movement.movementId), auth);
          if (posting.hasFinancialImpact && !posting.journalEntryId) {
            throw new AppError('صرف المخزون النهائي يحتاج قيداً محاسبياً متوازناً', 'FINAL_ISSUE_JOURNAL_MISSING', 500);
          }
        }

        if (inTransitLocationId) {
          const transitScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, locationId: inTransitLocationId, branchId: null };
          await recordStockMovement(trx, {
            ...transitScope,
            delta: Number(item.qty || 0),
            skipGlobalUpdate: true,
            disableAutoDrain: true,
            errorCode: 'TRANSIT_STOCK_ERROR',
            errorMessage: 'Transit error',
            movementType: 'transfer_transit_in',
            referenceType: 'transfer',
            referenceId: id,
            reason: 'transfer_send',
            note: `In-transit for TR-${id}`,
            createdBy: auth.userId,
            moneyDigits,
          });
          await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.productId), fromLocationId: from.id, toLocationId: inTransitLocationId, qty: Number(item.qty || 0) });
        } else if (finalIssueDest) {
          // F19 paired IN leg: credit the destination with exactly what the
          // source lost, at the same frozen cost, so the stock is never
          // lost. No expense journal (see above): the goods still exist.
          const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: finalIssueDest.branchId, locationId: finalIssueDest.id };
          await recordStockMovement(trx, {
            ...toScope,
            delta: Number(item.qty || 0),
            skipGlobalUpdate: true,
            disableAutoDrain: true,
            errorCode: 'TRANSFER_RECEIVE_ERROR',
            errorMessage: `Error receiving final issue at ${finalIssueDest.name}`,
            movementType: 'transfer_receive',
            referenceType: 'transfer',
            referenceId: id,
            reason: 'final_issue',
            note: `Received final issue TR-${id} at ${finalIssueDest.name}`,
            unitCost,
            createdBy: auth.userId,
            moneyDigits,
          });
          // Tracked stock was dispatched "via" the destination: serials
          // already sit there in_stock but with a null branch, and
          // batches were created there as in_transit. Settle both to the
          // destination's real state so the units stay dispatchable.
          if (trace.serialTracking.length && finalIssueDest.branchId != null) {
            await trx.updateTable('product_serials').set({ branch_id: finalIssueDest.branchId, updated_at: sql`NOW()` })
              .where('tenant_id', '=', scope.tenantId)
              .where('id', 'in', trace.serialTracking.map((entry) => entry.id)).execute();
          }
          const destBatchIds = trace.batchTracking.map((entry) => entry.transitBatchId).filter((entryId): entryId is number => entryId != null);
          if (destBatchIds.length) {
            await trx.updateTable('pharmacy_batches').set({ status: 'active', updated_at: sql`NOW()` })
              .where('tenant_id', '=', scope.tenantId).where('id', 'in', destBatchIds).execute();
          }
          await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.productId), fromLocationId: from.id, toLocationId: finalIssueDest.id, qty: Number(item.qty || 0) });
        } else if (isFinalIssue) {
          await syncImportLotsOnStockDeduction(trx, { tenantId: scope.tenantId, productId: Number(item.productId), locationId: from.id, qty: Number(item.qty || 0), reason: 'transfer_final_issue' });
        }
      }

      const destinationName = to ? to.name : (payload.toBranchId ? 'الفرع' : 'غير معروف');
      await this.audit.logWithExecutor(trx, 'إنشاء تحويل مخزون', `تم إنشاء تحويل TR-${id} من ${from.name} إلى ${destinationName}`, auth);

      const responsePayload = { ok: true, transferId: String(id), stockTransfers: (await this.listStockTransfers({}, auth, trx)).stockTransfers };

      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload,
          String(id)
        );
      }

      return responsePayload;
    });

    return transferId as Record<string, unknown>;
  }

  async receiveStockTransfer(transferId: number, auth: AuthContext, receiptPayload?: { items?: TransferReceiptTraceRequest[]; varianceReason?: string; approvalSecret?: string }): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const transfer = await trx.selectFrom('stock_transfers').selectAll().where('id', '=', transferId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!transfer) throw new AppError('Transfer not found', 'TRANSFER_NOT_FOUND', 404);
      if ((transfer.status || 'sent') !== 'sent') throw new AppError('Only sent transfers can be received', 'TRANSFER_STATUS_INVALID', 400);
      await assertTransferMakerChecker(trx, scope.tenantId, transfer.created_by, auth);
      const items = await trx.selectFrom('stock_transfer_items').select(['id', 'product_id', 'qty', 'dispatched_qty', 'serial_tracking', 'batch_tracking']).where('transfer_id', '=', transferId).where(this.tenantPredicate(auth)).orderBy('product_id', 'asc').execute();
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => Number(item.product_id)) });
      // Old transfers without trace snapshots may only be quantity-only goods.
      for (const item of items) {
        const hasTrace = (Array.isArray(item.serial_tracking) && item.serial_tracking.length > 0) ||
          (Array.isArray(item.batch_tracking) && item.batch_tracking.length > 0);
        if (!hasTrace) await assertUntrackedStockMutation(trx, scope, Number(item.product_id));
      }

      // Transit loss: the destination may receive less than was dispatched. Anything short is
      // written off from the in-transit location instead of being stranded there forever, which is
      // what happened when the item carried a single `qty` and receiving had to match it exactly.
      const receivedByItemId = new Map<number, number>();
      const receiptDetails = new Map<number, TransferReceiptTraceRequest>(
        (receiptPayload?.items || []).map(row => [Number(row.itemId), row]),
      );
      // Legacy pending transfers were written with default dispatched_qty="0.000".
      // Convert PostgreSQL numeric TEXT before applying the fallback, otherwise
      // a valid receipt can be marked received with no physical movement/GL.
      const dispatchedQty = (item: (typeof items)[number]): number => {
        const persisted = Number(item.dispatched_qty || 0);
        return persisted > 0 ? persisted : Number(item.qty || 0);
      };
      const dispatchedByItemId = new Map(items.map((item) => [Number(item.id), dispatchedQty(item)]));
      for (const r of receiptPayload?.items || []) {
        const itemId = Number(r?.itemId);
        const receivedQty = Number(r?.receivedQty);
        if (!dispatchedByItemId.has(itemId) || receivedByItemId.has(itemId) || !Number.isFinite(receivedQty)
          || receivedQty < 0 || receivedQty > dispatchedByItemId.get(itemId)! + 0.0000001
          || Math.abs(receivedQty * 1000 - Math.round(receivedQty * 1000)) > 0.000001) {
          throw new AppError('كمية أو بند استلام التحويل غير صالح', 'TRANSFER_RECEIPT_INVALID', 400);
        }
        receivedByItemId.set(itemId, receivedQty);
      }

      // INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL: a receipt names the
      // quantities that actually arrived; an item the receiver does not
      // name defaults to 0 received and its full dispatched quantity is
      // a planned shortage. That shortage is only written off when the
      // receipt also carries a written variance reason (at least 8
      // characters) approved by a different user (see the gate below);
      // otherwise the whole receipt is rejected fail-closed. Only a
      // receipt with no items at all is still rejected here: it carries
      // no evidence that anything was checked.
      if (!receiptPayload?.items?.length) {
        throw new AppError('يجب تحديد كمية مستلمة واحدة على الأقل قبل الاستلام', 'TRANSFER_RECEIPT_INVALID', 400);
      }
      // Plan the whole receipt before any write, so an invalid row fails
      // closed with nothing half-moved.
      const receiptPlan = items.map((item) => {
        const dispatched = dispatchedQty(item);
        const received = receivedByItemId.get(Number(item.id)) ?? 0;
        return { item, dispatched, received, shortfall: Number((dispatched - received).toFixed(3)) };
      });
      // INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL: a shortfall is a real
      // write-off, never an automatic one. Any receipt whose planned
      // shortfall exceeds 0.0001 needs BOTH a written variance reason
      // (at least 8 characters) AND approval by a different user than
      // the receiver, verified here before any write through the one
      // shared authorizeManagerSecret. The approval credential must
      // resolve to an admin user id different from the receiver: a
      // shared manager PIN identifies no approver, so it cannot
      // satisfy segregation of duties. Full receipts are unchanged.
      // INV-SOLO-ADMIN-TRANSFER-SHORTAGE-OVERRIDE: a solo admin/super_admin receiver may accept alone with no secret — see ARCHITECTURE_INVARIANTS.md.
      const varianceReason = String(receiptPayload?.varianceReason || '').trim();
      const hasShortfall = receiptPlan.some((row) => row.shortfall > 0.0001);
      let soloOverride = false;
      if (hasShortfall) {
        if (varianceReason.length < 8) {
          throw new AppError('A transfer shortfall needs a written variance reason of at least 8 characters', 'TRANSFER_SHORTAGE_REASON_REQUIRED', 400);
        }
        const approvalSecret = String(receiptPayload?.approvalSecret || '').trim();
        if (!approvalSecret) {
          soloOverride = await isSoloAdminOverride(trx, scope.tenantId, auth);
          if (!soloOverride) throw new AppError('A transfer shortfall needs approval by a different user than the receiver', 'TRANSFER_SHORTAGE_APPROVAL_REQUIRED', 400);
        } else {
          const approval = await authorizeManagerSecret(trx, auth, approvalSecret);
          if (approval.mode !== 'account' || !approval.authorizedById) throw new AppError('A transfer shortfall must be approved with the password of a different admin user; the shared manager PIN does not identify who approved', 'TRANSFER_SHORTAGE_APPROVAL_REQUIRED', 400);
          if (Number(approval.authorizedById) === Number(auth.userId)) throw new AppError('The receiver cannot approve their own transfer shortfall', 'TRANSFER_SHORTAGE_SELF_APPROVAL', 403);
        }
      }

      let inTransitLocationId: number | null = null;
      const inTransitRow = await trx.selectFrom('stock_locations').select('id').where('location_type', '=', 'in_transit').where('tenant_id', '=', scope.tenantId).executeTakeFirst();
      if (inTransitRow) inTransitLocationId = inTransitRow.id;
      if (items.length && !inTransitLocationId) throw new AppError('موقع البضاعة بالطريق غير موجود', 'TRANSIT_LOCATION_MISSING', 409);

      let effectiveToLocationId = transfer.to_location_id;
      if (!effectiveToLocationId && transfer.to_branch_id) {
        const branchStockRow = await trx.selectFrom('stock_locations').select('id').where('branch_id', '=', transfer.to_branch_id).where('location_type', '=', 'branch_stock').where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (branchStockRow) effectiveToLocationId = branchStockRow.id;
        else throw new AppError('No branch stock location found for destination branch', 'DESTINATION_LOCATION_NOT_FOUND', 400);
      }

      if (!effectiveToLocationId) throw new AppError('مخزن الاستلام غير محدد', 'TRANSFER_DESTINATION_MISSING', 409);
      const verifiedDestination = await this.scope.assertLocationScope(Number(effectiveToLocationId), auth, false, 'write', trx);
      if (transfer.to_branch_id != null && Number(verifiedDestination.branchId) !== Number(transfer.to_branch_id)) {
        throw new AppError('فرع وجهة التحويل لا يطابق موقع الاستلام', 'TRANSFER_DESTINATION_BRANCH_MISMATCH', 409);
      }
      let anyVariance = false;
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const shrinkageJournalIds: number[] = [];

      if (effectiveToLocationId) {
        for (const { item, dispatched, received, shortfall } of receiptPlan) {
          if (shortfall > 0.0001) anyVariance = true;
          const traceReceipt = receiptDetails.get(Number(item.id)) || { itemId: Number(item.id), receivedQty: received };
          const reconciledBatches = await receiveTrackedStock(
            trx, scope, item, traceReceipt, Number(inTransitLocationId),
            Number(effectiveToLocationId), verifiedDestination.branchId, transferId,
          );

          if (inTransitLocationId && received > 0) {
            // Move only what actually arrived from transit to the destination.
            // Any missing units remain in transit until the write-off below,
            // where the stock helper can deduct them without a negative balance.
            const transitScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), locationId: inTransitLocationId, branchId: null };
            await recordStockMovement(trx, {
              ...transitScope,
              delta: -received,
              skipGlobalUpdate: true,
              disableAutoDrain: true,
              errorCode: 'TRANSIT_STOCK_ERROR',
              errorMessage: 'Transit error',
              movementType: 'transfer_transit_out',
              referenceType: 'transfer',
              referenceId: transferId,
              reason: 'transfer_receive',
              note: `Out of transit for TR-${transferId}`,
              createdBy: auth.userId,
              moneyDigits,
            });
          }

          if (received > 0.0001) {
            const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), branchId: transfer.to_branch_id, locationId: effectiveToLocationId };
            await recordStockMovement(trx, {
              ...toScope,
              delta: received,
              skipGlobalUpdate: true,
              disableAutoDrain: true,
              errorCode: 'TRANSFER_RECEIVE_ERROR',
              errorMessage: `Error receiving`,
              movementType: 'transfer_receive',
              referenceType: 'transfer',
              referenceId: transferId,
              reason: 'transfer_receive',
              note: `Received transfer TR-${transferId}`,
              createdBy: auth.userId,
              moneyDigits,
            });
            if (inTransitLocationId) {
              await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.product_id), fromLocationId: inTransitLocationId, toLocationId: effectiveToLocationId, qty: received });
            }
          }

          if (shortfall > 0.0001) {
            // Shrinkage: the goods left the source and never arrived, so company-wide stock really
            // does fall. This is the one leg of a transfer that touches the global counter.
            // Transit goods are still inventory assets until receipt. A shortfall
            // is a real company-wide write-off, not merely a location transfer.
            // INV-TRANSFER-RECEIPT-PINNED: value the loss at the cost frozen
            // on the dispatch (transfer_send) movement. Only transfers sent
            // before that stamp existed fall back to the current cost_price.
            const dispatchMovement = await trx.selectFrom('stock_movements')
              .select(['unit_cost'])
              .where('reference_type', '=', 'transfer').where('reference_id', '=', transferId)
              .where('product_id', '=', Number(item.product_id)).where('movement_type', '=', 'transfer_send')
              .where('tenant_id', '=', scope.tenantId).executeTakeFirst();
            const frozenCost = dispatchMovement?.unit_cost;
            let unitCost: number;
            if (frozenCost != null && Number.isFinite(Number(frozenCost))) {
              unitCost = Number(frozenCost);
            } else {
              const productCost = await trx.selectFrom('products').select('cost_price')
                .where('id', '=', Number(item.product_id))
                .where('tenant_id', '=', scope.tenantId).executeTakeFirstOrThrow();
              const rawUnitCost = Number(productCost.cost_price || 0);
              unitCost = Number.isFinite(rawUnitCost) && rawUnitCost > 0 ? rawUnitCost : 0;
            }
            const movement = await recordStockMovement(trx, {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              productId: Number(item.product_id),
              locationId: inTransitLocationId,
              branchId: null,
              delta: -shortfall,
              // The one leg that touches the global counter: a shortfall is
              // a real company-wide write-off, not a location move.
              skipGlobalUpdate: false,
              disableAutoDrain: true,
              errorCode: 'TRANSIT_SHRINKAGE_ERROR',
              errorMessage: 'Transit shrinkage error',
              movementType: 'transfer_transit_loss',
              referenceType: 'transfer',
              referenceId: transferId,
              reason: 'transit_shrinkage',
              note: `فاقد نقل للتحويل TR-${transferId}: أُرسل ${dispatched} واستُلم ${received}` + (soloOverride ? ` — اعتماد منفرد بقرار إداري — المستلم ${auth.username} قبل الفاقد` : ''),
              unitCost,
              createdBy: auth.userId,
              moneyDigits,
            });
            await syncImportLotsOnStockDeduction(trx, { tenantId: scope.tenantId, productId: Number(item.product_id), locationId: inTransitLocationId, qty: shortfall, reason: 'transit_shrinkage' });
            // Reuse the immutable stock-adjustment posting (Dr shrinkage loss,
            // Cr inventory). The movement itself still references the transfer.
            const posting = await this.accountingPosting.postInventoryAdjustment(trx, Number(movement.movementId), auth);
            if (posting.hasFinancialImpact && !posting.journalEntryId) {
              throw new AppError('فاقد التحويل لم ينتج عنه قيد تسوية مخزون', 'TRANSFER_SHRINKAGE_JOURNAL_MISSING', 500);
            }
            if (posting.journalEntryId) shrinkageJournalIds.push(Number(posting.journalEntryId));
          }

          await trx
            .updateTable('stock_transfer_items')
            .set({ dispatched_qty: dispatched, received_qty: received, variance_qty: shortfall, variance_reason: shortfall > 0.0001 ? (varianceReason || null) : null, batch_tracking: JSON.stringify(reconciledBatches) })
            .where('id', '=', Number(item.id))
            .where(this.tenantPredicate(auth))
            .execute();
        }
      }
      // INV-TRANSFER-RECEIPT-PINNED: the first shrinkage journal id is
      // stamped on the header; the dead column now records the write-off.
      // INV-TRANSFER-SAME-BRANCH-RECEIPT: a branch -> same-branch transfer
      // resolves its destination to the source location itself. Stamping
      // that equal value into to_location_id would violate the
      // stock_transfers_location_diff CHECK (from_location_id <>
      // to_location_id) and fail the whole receipt with a generic error
      // after every named check passed. Leave the header's
      // to_location_id as stored (NULL) in that case; the stock legs
      // and the status still post normally.
      const headerUpdate: Record<string, unknown> = { status: 'received', received_by: auth.userId, received_at: sql`NOW()`, has_transit_variance: anyVariance, transit_variance_journal_entry_id: shrinkageJournalIds[0] ?? null, updated_at: sql`NOW()` };
      if (Number(effectiveToLocationId) !== Number(transfer.from_location_id)) headerUpdate.to_location_id = effectiveToLocationId;
      await trx.updateTable('stock_transfers').set(headerUpdate).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      const totalShortfallQty = Number(receiptPlan.reduce((sum, row) => sum + (row.shortfall > 0.0001 ? row.shortfall : 0), 0).toFixed(3));
      await this.audit.logWithExecutor(
        trx,
        'استلام تحويل مخزون',
        `تم استلام التحويل ${transfer.doc_no || `TR-${transferId}`}${transfer.carrier_name ? ` | الناقل: ${transfer.carrier_name}` : ''}` +
          (soloOverride
            ? ` — اعتماد فاقد منفرد بقرار إداري — استلم ${auth.username} التحويل بفاقد ${totalShortfallQty} — ${varianceReason}`
            : anyVariance
              ? ` | بفاقد ${totalShortfallQty} | السبب: ${varianceReason}`
              : ''),
        auth,
        anyVariance ? { eventCode: AUDIT_EVENT_CODES.INVENTORY_TRANSFER_SHORTAGE } : undefined,
      );

      const responsePayload = {
        ok: true,
        stockTransfers: (await this.listStockTransfers({}, auth, trx)).stockTransfers,
        _shortageAlert: anyVariance ? { docNo: transfer.doc_no || `TR-${transferId}`, carrierName: transfer.carrier_name || '', totalShortfallQty, varianceReason, receiverName: auth.username } : null,
      };

      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(trx, { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType }, responsePayload, String(transferId));
      }
      return responsePayload;
    });
    const resultRecord = result as Record<string, unknown> & {
      _shortageAlert?: { docNo: string; carrierName: string; totalShortfallQty: number; varianceReason: string; receiverName: string } | null;
    };
    const alertMeta = resultRecord?._shortageAlert;
    if (resultRecord && '_shortageAlert' in resultRecord) delete resultRecord._shortageAlert;
    if (alertMeta && this.whatsappService) {
      await sendTransferShortageWhatsAppAlert(this.db, this.whatsappService, scope.tenantId, alertMeta).catch((err) => this.logger.warn(`Transfer shortage WhatsApp alert failed: ${err?.message}`));
    }
    return result as Record<string, unknown>;
  }

  async cancelStockTransfer(transferId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const transfer = await trx.selectFrom('stock_transfers').selectAll().where('id', '=', transferId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!transfer) throw new AppError('Transfer not found', 'TRANSFER_NOT_FOUND', 404);
      if (!['sent'].includes(transfer.status || 'sent')) throw new AppError('Only sent transfers can be cancelled', 'TRANSFER_STATUS_INVALID', 400);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      await this.scope.assertLocationScope(Number(transfer.from_location_id), auth, true, 'write', trx);
      const items = await trx.selectFrom('stock_transfer_items').select(['product_id', 'qty', 'serial_tracking', 'batch_tracking']).where('transfer_id', '=', transferId).where(this.tenantPredicate(auth)).orderBy('product_id', 'asc').execute();
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => Number(item.product_id)) });
      for (const item of items) {
        const hasTrace = (Array.isArray(item.serial_tracking) && item.serial_tracking.length > 0) ||
          (Array.isArray(item.batch_tracking) && item.batch_tracking.length > 0);
        if (!hasTrace) await assertUntrackedStockMutation(trx, scope, Number(item.product_id));
      }

      let inTransitLocationId: number | null = null;
      if (transfer.status === 'sent') {
        const inTransitRow = await trx.selectFrom('stock_locations').select('id').where('location_type', '=', 'in_transit').where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (inTransitRow) inTransitLocationId = inTransitRow.id;
        if (items.length && !inTransitLocationId) throw new AppError('موقع البضاعة بالطريق غير موجود', 'TRANSIT_LOCATION_MISSING', 409);
      }

      for (const item of items) {
        if (inTransitLocationId) {
          await cancelTrackedStock(trx, scope, item, Number(transfer.from_location_id), transfer.from_branch_id, inTransitLocationId, transferId);
          const transitScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), locationId: inTransitLocationId, branchId: null };
          await recordStockMovement(trx, {
            ...transitScope,
            delta: -Number(item.qty || 0),
            skipGlobalUpdate: true,
            disableAutoDrain: true,
            errorCode: 'TRANSIT_STOCK_ERROR',
            errorMessage: 'Transit error',
            movementType: 'transfer_transit_cancel',
            referenceType: 'transfer',
            referenceId: transferId,
            reason: 'transfer_cancel',
            note: `Cancel transit for TR-${transferId}`,
            createdBy: auth.userId,
            moneyDigits,
          });
        }

        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), branchId: transfer.from_branch_id, locationId: transfer.from_location_id };
        await recordStockMovement(trx, {
          ...stockScope,
          delta: Number(item.qty || 0),
          skipGlobalUpdate: inTransitLocationId !== null,
          disableAutoDrain: true,
          errorCode: 'TRANSFER_CANCEL_ERROR',
          errorMessage: `Transfer TR-${transferId} cannot be cancelled`,
          movementType: 'transfer_cancel',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'transfer_cancel',
          note: `Cancelled transfer TR-${transferId}`,
          createdBy: auth.userId,
          moneyDigits,
        });
        if (inTransitLocationId && transfer.from_location_id) {
          await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.product_id), fromLocationId: inTransitLocationId, toLocationId: transfer.from_location_id, qty: Number(item.qty || 0) });
        }
      }
      await trx.updateTable('stock_transfers').set({ status: 'cancelled', cancelled_by: auth.userId, cancelled_at: sql`NOW()`, updated_at: sql`NOW()` }).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      await this.audit.logWithExecutor(trx, 'إلغاء تحويل مخزون', `تم إلغاء التحويل TR-${transferId}`, auth);

      const responsePayload = { ok: true, stockTransfers: (await this.listStockTransfers({}, auth, trx)).stockTransfers };

      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload,
          String(transferId)
        );
      }
      return responsePayload;
    });
    return result as Record<string, unknown>;
  }

  // F19: reverse a RECEIVED final issue prospectively (correction path for
  // e.g. ZTR-261121-2620): credit the source back at the frozen OUT cost and
  // post a correcting journal flipping the original lines (Dr 1140 / Cr 6900,
  // reversal_of_entry_id). Original rows are never edited. Transfer closes as
  // 'cancelled'; second reversal refused. NOTE: serial/batch ledgers are NOT
  // restored (follow-up); quantity + GL are restored exactly.
  async reverseFinalIssue(transferId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const transfer = await trx.selectFrom('stock_transfers').selectAll().where('id', '=', transferId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!transfer) throw new AppError('Transfer not found', 'TRANSFER_NOT_FOUND', 404);
      // 'cancelled' is let through so a second reversal hits the already-reversed check, not the status gate.
      if (!['received', 'cancelled'].includes(transfer.status || 'sent')) throw new AppError('Only a received final issue can be reversed', 'FINAL_ISSUE_REVERSAL_STATUS_INVALID', 400);
      const outMovements = await trx.selectFrom('stock_movements')
        .select(['id', 'product_id', 'qty', 'unit_cost', 'total_cost'])
        .where('reference_type', '=', 'transfer').where('reference_id', '=', transferId)
        .where('movement_type', '=', 'transfer_final_issue').where('tenant_id', '=', scope.tenantId)
        .orderBy('product_id', 'asc').execute();
      if (!outMovements.length) throw new AppError('Only a final issue can be reversed with this endpoint', 'FINAL_ISSUE_NOT_FOUND', 400);
      const alreadyReversed = await trx.selectFrom('stock_movements').select('id')
        .where('reference_type', '=', 'transfer').where('reference_id', '=', transferId)
        .where('movement_type', '=', 'transfer_final_issue_reversal').where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (alreadyReversed) throw new AppError('This final issue was already reversed', 'FINAL_ISSUE_ALREADY_REVERSED', 409);
      await this.scope.assertLocationScope(Number(transfer.from_location_id), auth, true, 'write', trx);
      const items = await trx.selectFrom('stock_transfer_items').select(['product_id', 'qty']).where('transfer_id', '=', transferId).where(this.tenantPredicate(auth)).orderBy('product_id', 'asc').execute();
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => Number(item.product_id)) });
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const reversalJournalIds: number[] = [];

      for (const item of items) {
        const out = outMovements.find((entry) => Number(entry.product_id) === Number(item.product_id));
        if (!out) throw new AppError(`Final issue movement missing for product #${item.product_id}`, 'FINAL_ISSUE_MOVEMENT_MISSING', 409);
        const qty = Math.abs(Number(out.qty || 0));
        if (!(qty > 0)) continue;
        const unitCost = Number(out.unit_cost || 0);

        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), branchId: transfer.from_branch_id, locationId: transfer.from_location_id };
        const reversalMovement = await recordStockMovement(trx, {
          ...stockScope,
          delta: qty,
          disableAutoDrain: true,
          errorCode: 'FINAL_ISSUE_REVERSAL_ERROR',
          errorMessage: `Final issue TR-${transferId} cannot be reversed`,
          movementType: 'transfer_final_issue_reversal',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'final_issue_reversal',
          note: `عكس صرف نهائي TR-${transferId}`,
          unitCost,
          createdBy: auth.userId,
          moneyDigits,
        });

        const originalJournal = await trx.selectFrom('journal_entries').select('id')
          .where('source_type', '=', 'inventory_adjustment').where('source_id', '=', Number(out.id))
          .where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (originalJournal) {
          const originalLines = await trx.selectFrom('journal_entry_lines')
            .select(['account_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id', 'cost_center_id'])
            .where('journal_entry_id', '=', Number(originalJournal.id)).where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'asc').execute();
          if (originalLines.length) {
            const reversedLines = originalLines.map((line) => ({
              accountId: Number(line.account_id),
              description: `عكس: ${line.description || ''}`,
              debit: Number(line.credit || 0),
              credit: Number(line.debit || 0),
              partnerType: (line.partner_type || 'none') as 'none' | 'customer' | 'supplier' | 'employee' | 'rep',
              partnerId: line.partner_id ? Number(line.partner_id) : null,
              branchId: line.branch_id ? Number(line.branch_id) : null,
              locationId: line.location_id ? Number(line.location_id) : null,
              costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
            }));
            const entryId = await this.accountingPosting.postDomainJournal(trx, {
              sourceType: 'inventory_adjustment',
              sourceId: Number(reversalMovement.movementId),
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              entryDate: new Date(),
              description: `قيد عكس صرف نهائي TR-${transferId} - حركة #${reversalMovement.movementId}`,
              branchId: transfer.from_branch_id ? Number(transfer.from_branch_id) : null,
              locationId: transfer.from_location_id ? Number(transfer.from_location_id) : null,
              createdBy: auth.userId,
              postedBy: auth.userId,
              reversalOfEntryId: Number(originalJournal.id),
              lines: reversedLines,
            });
            reversalJournalIds.push(entryId);
          }
        }
      }

      await trx.updateTable('stock_transfers').set({ status: 'cancelled', cancelled_by: auth.userId, cancelled_at: sql`NOW()`, updated_at: sql`NOW()` }).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      await this.audit.logWithExecutor(trx, 'عكس صرف نهائي', `تم عكس الصرف النهائي TR-${transferId}`, auth);

      const responsePayload = { ok: true, transferId: String(transferId), reversalJournalIds, stockTransfers: (await this.listStockTransfers({}, auth, trx)).stockTransfers };

      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload,
          String(transferId)
        );
      }
      return responsePayload;
    });
    return result as Record<string, unknown>;
  }

  async transferCategory(payload: { categoryId: number; fromLocationId: number; toLocationId: number; notes?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    const scope = this.tenantScope(auth);
    const twoStepItems = await loadCategoryStockItemsForTwoStep(this.db, scope.tenantId, payload.categoryId, payload.fromLocationId);
    if (twoStepItems.length) {
      return this.createStockTransfer({ fromLocationId: payload.fromLocationId, toLocationId: payload.toLocationId, items: twoStepItems, note: payload.notes || 'نقل قسم بالكامل (بمرحلتين - درع منع السرقة)', issueMode: 'transfer_to_branch_stock' }, auth);
    }
    const from = await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // Find all products in this category that have stock > 0 in the fromLocation
      const stocks = await trx.selectFrom('product_location_stock as pls')
        .innerJoin('products as p', (join) => join.onRef('p.id', '=', 'pls.product_id').onRef('p.tenant_id', '=', 'pls.tenant_id'))
        .select(['pls.product_id', 'pls.qty', 'p.name'])
        .where('p.category_id', '=', payload.categoryId)
        .where('pls.location_id', '=', from.id)
        .where('pls.qty', '>', 0)
        .where(this.tenantPredicate(auth, 'p'))
        .execute();

      if (stocks.length === 0) {
        throw new AppError('No stock found for this category in the source location', 'NO_STOCK', 400);
      }

      await lockStockProducts(trx, { ...scope, productIds: stocks.map((stock) => Number(stock.product_id)) });
      stocks.sort((a, b) => Number(a.product_id) - Number(b.product_id));

      // Create a transfer document
      const result = await trx.insertInto('stock_transfers').values({
        from_location_id: from.id,
        to_location_id: to.id,
        from_branch_id: from.branchId,
        to_branch_id: to.branchId,
        status: 'received', // Auto-receive for category transfers
        note: payload.notes || `نقل قسم بالكامل`,
        created_by: auth.userId,
        received_by: auth.userId,
        received_at: sql`NOW()`,
        ...this.tenantFields(auth)
      }).returning('id').executeTakeFirstOrThrow();

      const transferId = Number(result.id);
      const docNo = await this.generateTransferDocNo(trx, transferId, auth);
      await trx.updateTable('stock_transfers').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      for (const stock of stocks) {
        const qty = Number(stock.qty);
        const trace = await moveDirectTrackedStock(trx, scope, Number(stock.product_id), qty,
          { id: from.id, branchId: from.branchId }, { id: to.id, branchId: to.branchId }, transferId);
        await trx.insertInto('stock_transfer_items').values({
          transfer_id: transferId, product_id: stock.product_id, product_name: stock.name || '', qty,
          serial_tracking: JSON.stringify(trace.serialTracking), batch_tracking: JSON.stringify(trace.batchTracking),
          ...this.tenantFields(auth),
        }).execute();

        // Deduct from source
        const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: from.branchId, locationId: from.id };
        await recordStockMovement(trx, {
          ...fromScope,
          delta: -qty,
          disableAutoDrain: true,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: `Insufficient stock`,
          movementType: 'transfer_send',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'transfer_send',
          note: `Sent category transfer TR-${transferId}`,
          createdBy: auth.userId,
          moneyDigits,
        });

        // Add to destination
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: to.branchId, locationId: to.id };
        await recordStockMovement(trx, {
          ...toScope,
          delta: qty,
          disableAutoDrain: true,
          errorCode: 'TRANSFER_RECEIVE_ERROR',
          errorMessage: `Error receiving`,
          movementType: 'transfer_receive',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'transfer_receive',
          note: `Received category transfer TR-${transferId}`,
          createdBy: auth.userId,
          moneyDigits,
        });
        await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(stock.product_id), fromLocationId: from.id, toLocationId: to.id, qty });
      }
    });

    await this.audit.log('نقل قسم', `تم نقل أرصدة القسم بنجاح من ${from.name} إلى ${to.name}`, auth);
    return { ok: true };
  }
  async internalTransferProducts(payload: { items: { productId: number; qty: number }[]; fromLocationId: number; toLocationId: number; note?: string; carrierEmployeeId?: number; carrierName?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    const isUnassignedLink = payload.fromLocationId === -1;
    if (!isUnassignedLink && (await loadAntiTheftSettings(this.db, this.tenantScope(auth).tenantId)).strictTwoStepTransfers) {
      return this.createStockTransfer({ fromLocationId: payload.fromLocationId, toLocationId: payload.toLocationId, items: payload.items, note: payload.note || 'تحويل مخزني (بمرحلتين - درع منع السرقة)', issueMode: 'transfer_to_branch_stock', carrierEmployeeId: payload.carrierEmployeeId, carrierName: payload.carrierName }, auth);
    }
    ensureUniqueFlowItems(payload.items || [], 'TRANSFER_DUPLICATE_PRODUCT', 'Transfer must not contain duplicate product rows');
    if (!(payload.items || []).length || payload.items.some((item) =>
      !Number.isSafeInteger(Number(item.productId)) || Number(item.productId) <= 0 ||
      !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 ||
      Math.abs(Number(item.qty) * 1000 - Math.round(Number(item.qty) * 1000)) > 0.000001)) {
      throw new AppError('Internal transfer quantities must use at most three decimal places', 'INVALID_TRANSFER_QUANTITY', 400);
    }
    const scope = this.tenantScope(auth);
    const from = isUnassignedLink
      ? { id: null, branchId: null, name: 'رصيد غير مربوط' }
      : await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      let transferId: number | null = null;

      if (!isUnassignedLink) {
        // 1. Create stock_transfer record only for real location-to-location transfers
        const transferRecord = await trx.insertInto('stock_transfers').values({
          status: 'received',
          from_branch_id: from.branchId,
          to_branch_id: to.branchId,
          from_location_id: from.id as number,
          to_location_id: to.id as number,
          doc_no: 'TMP',
          note: payload.note || `نقل داخلي سريع`,
          created_by: auth.userId,
          received_by: auth.userId,
          received_at: sql`NOW()`,
          ...this.tenantFields(auth)
        }).returning('id').executeTakeFirstOrThrow();
        
        transferId = Number(transferRecord.id);
        const docNo = await this.generateTransferDocNo(trx, transferId, auth);
        await trx.updateTable('stock_transfers').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();
      }

      await lockStockProducts(trx, { ...scope, productIds: payload.items.map((item) => item.productId) });
      for (const item of [...payload.items].sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const product = await trx.selectFrom('products').select(['id', 'name', 'cost_price']).where('id', '=', item.productId).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        const qty = Number(item.qty || 0);
        let trace: { serialTracking: Array<{ id: number; serial: string }>; batchTracking: Array<{ sourceBatchId: number; transitBatchId: null; qty: number; receivedQty: number }> } = { serialTracking: [], batchTracking: [] };
        if (isUnassignedLink) {
          await assertUntrackedStockMutation(trx, scope, Number(item.productId));
        } else {
          trace = await moveDirectTrackedStock(trx, scope, Number(item.productId), qty,
            { id: Number(from.id), branchId: from.branchId },
            { id: to.id, branchId: to.branchId }, Number(transferId));
        }

        if (transferId != null) {
          await trx.insertInto('stock_transfer_items').values({
            transfer_id: transferId, product_id: item.productId, product_name: product.name || '', qty,
            serial_tracking: JSON.stringify(trace.serialTracking), batch_tracking: JSON.stringify(trace.batchTracking),
            ...this.tenantFields(auth),
          }).execute();

          // Deduct from source
          const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: from.branchId, locationId: from.id };
          await recordStockMovement(trx, {
            ...fromScope,
            delta: -qty,
            disableAutoDrain: true,
            errorCode: 'INSUFFICIENT_STOCK',
            errorMessage: `الرصيد غير كافٍ للصنف ${product.name}`,
            movementType: 'transfer_send',
            referenceType: 'transfer',
            referenceId: transferId,
            reason: 'internal_transfer',
            note: payload.note || `نقل داخلي إلى ${to.name}`,
            createdBy: auth.userId,
            moneyDigits,
          });
        } else {
          // Deduct from unassigned explicitly
          const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: null, locationId: null };
          await applyStockDelta(trx, { ...fromScope, delta: -qty, skipGlobalUpdate: true, errorCode: 'INSUFFICIENT_STOCK', errorMessage: `الرصيد غير كافٍ للصنف ${product.name}` });
        }

        // Add to destination location
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: to.branchId, locationId: to.id, skipGlobalUpdate: isUnassignedLink };
        await recordStockMovement(trx, {
          ...toScope,
          delta: qty,
          errorCode: 'TRANSFER_RECEIVE_ERROR',
          errorMessage: `Error receiving`,
          disableAutoDrain: true,
          movementType: isUnassignedLink ? 'stock_assign' : 'transfer_receive',
          referenceType: isUnassignedLink ? 'location_assign' : 'transfer',
          referenceId: transferId ?? to.id,
          reason: isUnassignedLink ? 'unassigned_stock_link' : 'internal_transfer',
          note: payload.note || (isUnassignedLink ? `ربط الرصيد العائم بمخزن ${to.name}` : `نقل داخلي من ${from.name}`),
          createdBy: auth.userId,
          moneyDigits,
        });
        if (from.id && to.id) {
          await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.productId), fromLocationId: from.id, toLocationId: to.id, qty });
        }
      }

      const responsePayload = { ok: true, transferId: transferId ? String(transferId) : 'assigned' };
      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload,
          transferId ? String(transferId) : 'assigned'
        );
      }
      return responsePayload;
    });

    await this.audit.log(isUnassignedLink ? 'ربط رصيد عائم بمخزن' : 'نقل داخلي لأصناف', isUnassignedLink ? `تم ربط رصيد الأصناف غير المربوط بمخزن ${to.name}` : `تم نقل أصناف داخلياً من ${from.name} إلى ${to.name}`, auth);
    return result;
  }

  async internalTransferCategory(payload: { categoryId: number; fromLocationId: number; toLocationId: number; note?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    const scope = this.tenantScope(auth);
    const twoStepItems = await loadCategoryStockItemsForTwoStep(this.db, scope.tenantId, payload.categoryId, payload.fromLocationId);
    if (twoStepItems.length) {
      return this.createStockTransfer({ fromLocationId: payload.fromLocationId, toLocationId: payload.toLocationId, items: twoStepItems, note: payload.note || 'نقل قسم داخلي (بمرحلتين - درع منع السرقة)', issueMode: 'transfer_to_branch_stock' }, auth);
    }
    const from = await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // Find all products in this category that have stock > 0 in the fromLocation
      const stocks = await trx.selectFrom('product_location_stock as pls')
        .innerJoin('products as p', (join) => join.onRef('p.id', '=', 'pls.product_id').onRef('p.tenant_id', '=', 'pls.tenant_id'))
        .select(['pls.product_id', 'pls.qty', 'p.name'])
        .where('p.category_id', '=', payload.categoryId)
        .where('pls.location_id', '=', from.id)
        .where('pls.qty', '>', 0)
        .where(this.tenantPredicate(auth, 'p'))
        .execute();

      if (stocks.length === 0) {
        throw new AppError('No stock found for this category in the source location', 'NO_STOCK', 400);
      }

      await lockStockProducts(trx, { ...scope, productIds: stocks.map((stock) => Number(stock.product_id)) });
      stocks.sort((a, b) => Number(a.product_id) - Number(b.product_id));

      const transferRecord = await trx.insertInto('stock_transfers').values({
        status: 'received',
        from_branch_id: from.branchId,
        to_branch_id: to.branchId,
        from_location_id: from.id as number,
        to_location_id: to.id as number,
        doc_no: 'TMP',
        note: payload.note || `نقل قسم داخلي`,
        created_by: auth.userId,
        received_by: auth.userId,
        received_at: sql`NOW()`,
        ...this.tenantFields(auth)
      }).returning('id').executeTakeFirstOrThrow();
      
      const transferId = Number(transferRecord.id);
      const docNo = await this.generateTransferDocNo(trx, transferId, auth);
      await trx.updateTable('stock_transfers').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      for (const stock of stocks) {
        const qty = Number(stock.qty);
        const trace = await moveDirectTrackedStock(trx, scope, Number(stock.product_id), qty,
          { id: from.id, branchId: from.branchId }, { id: to.id, branchId: to.branchId }, transferId);

        await trx.insertInto('stock_transfer_items').values({
          transfer_id: transferId, product_id: stock.product_id, product_name: stock.name || '', qty,
          serial_tracking: JSON.stringify(trace.serialTracking), batch_tracking: JSON.stringify(trace.batchTracking),
          ...this.tenantFields(auth),
        }).execute();

        // Deduct from source
        const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: from.branchId, locationId: from.id };
        await recordStockMovement(trx, {
          ...fromScope,
          delta: -qty,
          disableAutoDrain: true,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: `Insufficient stock`,
          movementType: 'transfer_send',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'internal_transfer',
          note: payload.note || `نقل قسم داخلي إلى ${to.name}`,
          createdBy: auth.userId,
          moneyDigits,
        });

        // Add to destination
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: to.branchId, locationId: to.id };
        await recordStockMovement(trx, {
          ...toScope,
          delta: qty,
          disableAutoDrain: true,
          errorCode: 'TRANSFER_RECEIVE_ERROR',
          errorMessage: `Error receiving`,
          movementType: 'transfer_receive',
          referenceType: 'transfer',
          referenceId: transferId,
          reason: 'internal_transfer',
          note: payload.note || `نقل قسم داخلي من ${from.name}`,
          createdBy: auth.userId,
          moneyDigits,
        });
        await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(stock.product_id), fromLocationId: from.id, toLocationId: to.id, qty });
      }

      const responsePayload = { ok: true, transferId: String(transferId) };
      const idemCtx = idempotencyStorage.getStore();
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload,
          String(transferId)
        );
      }
      return responsePayload;
    });

    await this.audit.log('نقل قسم داخلياً', `تم نقل أرصدة القسم داخلياً من ${from.name} إلى ${to.name}`, auth);
    return result;
  }

  private async generateTransferDocNo(trx: Kysely<Database>, transferId: number, auth: AuthContext): Promise<string> {
    const docNo = await generateStockTransferDocNo(trx, transferId, this.tenantScope(auth).tenantId);
    return docNo === `ZTR-${transferId}` ? `ZTR-${transferId}` : docNo;
  }
}
