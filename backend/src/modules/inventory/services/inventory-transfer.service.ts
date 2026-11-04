import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { paginateRows } from '../../../common/utils/pagination';
import { ensureNonNegativeStock, ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { applyStockDelta, lockStockProducts, previewAssignedLocationStockQty } from '../../../common/utils/location-stock-ledger';
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
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { assertUntrackedStockMutation } from '../helpers/inventory-tracked-stock.helper';
import { syncImportLotsOnLocationTransfer, syncImportLotsOnStockDeduction } from '../../import-sales/helpers/import-lot-allocation.helper';
import { dispatchTrackedStock, receiveTrackedStock, cancelTrackedStock, type TransferReceiptTraceRequest } from '../helpers/stock-transfer-trace.helper';
import { moveDirectTrackedStock } from '../helpers/direct-tracked-stock-move.helper';

@Injectable()
export class InventoryTransferService {
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

  private async getOrCreateInTransitLocation(trx: Kysely<Database>, scope: { tenantId: string; accountId: string }): Promise<number> {
    await sql`select pg_advisory_xact_lock(731234, hashtext(${scope.tenantId}))`.execute(trx);
    const existing = await trx.selectFrom('stock_locations').select(['id']).where('location_type', '=', 'in_transit').where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (existing) return existing.id;
    const inserted = await trx.insertInto('stock_locations').values({ name: 'بضاعة بالطريق', code: 'IN_TRANSIT', location_type: 'in_transit' as any, is_active: true, tenant_id: scope.tenantId, account_id: scope.accountId }).returning('id').executeTakeFirstOrThrow();
    return inserted.id;
  }

  async listStockTransfers(query: Record<string, unknown>, auth: AuthContext, executor: Kysely<Database> = this.db): Promise<Record<string, unknown>> {
    if (!auth.permissions.includes('inventory') && !auth.permissions.includes('canAdjustInventory')) throw new ForbiddenException('Missing required permissions');
    let transfersQuery = executor
      .selectFrom('stock_transfers as t')
      .leftJoin('stock_locations as fl', (join) => join.onRef('fl.id', '=', 't.from_location_id').onRef('fl.tenant_id', '=', 't.tenant_id'))
      .leftJoin('stock_locations as tl', (join) => join.onRef('tl.id', '=', 't.to_location_id').onRef('tl.tenant_id', '=', 't.tenant_id'))
      .leftJoin('branches as fb', (join) => join.onRef('fb.id', '=', 't.from_branch_id').onRef('fb.tenant_id', '=', 't.tenant_id'))
      .leftJoin('branches as tb', (join) => join.onRef('tb.id', '=', 't.to_branch_id').onRef('tb.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as cu', (join) => join.onRef('cu.id', '=', 't.created_by').onRef('cu.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as ru', (join) => join.onRef('ru.id', '=', 't.received_by').onRef('ru.tenant_id', '=', 't.tenant_id'))
      .leftJoin('users as xu', (join) => join.onRef('xu.id', '=', 't.cancelled_by').onRef('xu.tenant_id', '=', 't.tenant_id'))
      .select(['t.id', 't.doc_no', 't.from_location_id', 't.to_location_id', 't.from_branch_id', 't.to_branch_id', 't.status', 't.note', 't.recipient_name', 't.received_at', 't.cancelled_at', 't.created_at', 'fl.name as from_location_name', 'tl.name as to_location_name', 'fb.name as from_branch_name', 'tb.name as to_branch_name', 'cu.username as created_by_name', 'ru.username as received_by_name', 'xu.username as cancelled_by_name'])
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

    const byTransfer = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const key = String(item.transfer_id);
      if (!byTransfer.has(key)) byTransfer.set(key, []);
      const serialTracking: unknown = typeof item.serial_tracking === 'string' ? JSON.parse(item.serial_tracking) : item.serial_tracking;
      const batchTracking: unknown = typeof item.batch_tracking === 'string' ? JSON.parse(item.batch_tracking) : item.batch_tracking;
      byTransfer.get(key)!.push({
        id: String(item.id), productId: String(item.product_id),
        productName: item.product_name || '', qty: Number(item.qty || 0),
        serialTracking: Array.isArray(serialTracking) ? serialTracking : [],
        batchTracking: Array.isArray(batchTracking) ? batchTracking : [],
      });
    }

    let rows = transfers.map((t) => ({ id: String(t.id), docNo: t.doc_no || `TR-${t.id}`, fromLocationId: String(t.from_location_id), toLocationId: t.to_location_id ? String(t.to_location_id) : '', fromBranchId: t.from_branch_id ? String(t.from_branch_id) : '', toBranchId: t.to_branch_id ? String(t.to_branch_id) : '', fromLocationName: t.from_location_name || '', toLocationName: t.to_location_name || '', fromBranchName: t.from_branch_name || '', toBranchName: t.to_branch_name || '', status: t.status || 'sent', note: t.note || '', recipientName: t.recipient_name || '', receivedAt: t.received_at || '', cancelledAt: t.cancelled_at || '', createdBy: t.created_by_name || '', receivedBy: t.received_by_name || '', cancelledBy: t.cancelled_by_name || '', date: t.created_at, items: byTransfer.get(String(t.id)) || [] }));
    rows = await this.scope.filterByScope(rows, auth, executor);
    const search = String(query.search || query.q || '').toLowerCase();
    const filter = String(query.filter || query.view || 'all').toLowerCase();
    const filtered = rows.filter((row) => (filter === 'all' || String(row.status).toLowerCase() === filter) && (!search || [row.docNo, row.note, row.fromLocationName, row.toLocationName].some((val) => String(val).toLowerCase().includes(search))));
    if (!query.page && !query.pageSize && !query.search && !query.q && !query.filter && !query.view) return { stockTransfers: filtered, scope: this.tenantScope(auth) };
    const paged = paginateRows(filtered, query, { defaultSize: 10 });
    return { stockTransfers: paged.rows, pagination: paged.pagination, summary: { totalItems: filtered.length, sent: filtered.filter((r) => r.status === 'sent').length, received: filtered.filter((r) => r.status === 'received').length, cancelled: filtered.filter((r) => r.status === 'cancelled').length, totalQty: Number(filtered.reduce((sum, row) => sum + Number((row.items as Array<{ qty: number }>).reduce((x, i) => x + Number(i.qty || 0), 0)), 0).toFixed(3)) }, scope: this.tenantScope(auth) };
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
    if (!(payload.items || []).length || payload.items.some((item) =>
      !Number.isSafeInteger(Number(item.productId)) || Number(item.productId) <= 0 ||
      !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 ||
      Math.abs(Number(item.qty) * 1000 - Math.round(Number(item.qty) * 1000)) > 0.000001)) {
      throw new AppError('Transfer items require valid product IDs and positive quantities with at most three decimal places', 'INVALID_TRANSFER_QUANTITY', 400);
    }

    const transferId = await this.tx.runInTransaction(this.db, async (trx) => {
      const issueMode = payload.issueMode || 'transfer_to_branch_stock';
      // INV-TRANSFER-RECEIPT-PINNED: the dispatch cost is frozen on the
      // transfer_send movement at the tenant's book digits, so a later
      // receipt values any shrinkage at this cost, never at the
      // receive-time cost_price.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const initialStatus = issueMode === 'final_issue' ? 'received' : 'sent';

      const result = await trx.insertInto('stock_transfers').values({
        from_location_id: from.id,
        to_location_id: to ? to.id : null,
        from_branch_id: from.branchId,
        to_branch_id: to ? to.branchId : (payload.toBranchId || null),
        status: initialStatus,
        note: String(payload.note || '').trim(),
        recipient_name: payload.recipientName || null,
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
      for (const item of [...payload.items].sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const product = await trx.selectFrom('products').select(['id', 'name', 'cost_price']).where('id', '=', item.productId).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: from.branchId, locationId: from.id };

        // Ensure quantity is available in this specific location ONLY
        const availableAtSource = await previewAssignedLocationStockQty(trx, stockScope);
        ensureNonNegativeStock(Number(availableAtSource || 0) - Number(item.qty || 0), 'INSUFFICIENT_LOCATION_STOCK', `الكمية غير كافية في مخزن ${from.name} للصنف ${product.name}. المتاح: ${availableAtSource || 0}`);

        const isFinalIssue = issueMode === 'final_issue';
        const trace = await dispatchTrackedStock(trx, scope, item, from.id, from.branchId, inTransitLocationId, id);
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
        } as any).execute();

        // Deduct from source. Only reduce global stock if final_issue (inTransitLocationId is null)
        const stockChange = await applyStockDelta(trx, { ...stockScope, delta: -Number(item.qty || 0), skipGlobalUpdate: inTransitLocationId !== null, disableAutoDrain: true, errorCode: 'INSUFFICIENT_LOCATION_STOCK', errorMessage: `Insufficient stock at ${from.name} for ${product.name}` });
        const originalUnitCost = Number(product.cost_price || 0);
        const unitCost = Number.isFinite(originalUnitCost) && originalUnitCost > 0 ? originalUnitCost : 0;
        const movement = await trx.insertInto('stock_movements').values({
          product_id: item.productId,
          movement_type: isFinalIssue ? 'transfer_final_issue' : 'transfer_send',
          qty: -Number(item.qty || 0),
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: isFinalIssue ? 'final_issue' : 'transfer_send',
          note: isFinalIssue ? `صرف نهائي TR-${id}` : `Sent transfer TR-${id}`,
          reference_type: 'transfer', reference_id: id, created_by: auth.userId,
          branch_id: from.branchId, location_id: from.id,
          // The dispatch cost is frozen on every send movement, not only
          // on final issues: the receipt reads it back to value shrinkage.
          unit_cost: unitCost,
          total_cost: roundMoney(Number(item.qty || 0) * unitCost, moneyDigits),
          ...this.tenantFields(auth),
        }).returning('id').executeTakeFirstOrThrow();
        if (isFinalIssue) {
          // Unlike a transfer-in-transit this immediately removes a company
          // asset, so it needs an expense journal in the SAME transaction.
          const posting = await this.accountingPosting.postInventoryAdjustment(trx, Number(movement.id), auth);
          if (posting.hasFinancialImpact && !posting.journalEntryId) {
            throw new AppError('صرف المخزون النهائي يحتاج قيداً محاسبياً متوازناً', 'FINAL_ISSUE_JOURNAL_MISSING', 500);
          }
        }

        if (inTransitLocationId) {
          const transitScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, locationId: inTransitLocationId, branchId: null };
          const transitChange = await applyStockDelta(trx, { ...transitScope, delta: Number(item.qty || 0), skipGlobalUpdate: true, disableAutoDrain: true, errorCode: 'TRANSIT_STOCK_ERROR', errorMessage: 'Transit error' });
          await trx.insertInto('stock_movements').values({ product_id: item.productId, movement_type: 'transfer_transit_in', qty: Number(item.qty || 0), before_qty: transitChange.scopeBefore, after_qty: transitChange.scopeAfter, reason: 'transfer_send', note: `In-transit for TR-${id}`, reference_type: 'transfer', reference_id: id, created_by: auth.userId, location_id: inTransitLocationId, ...this.tenantFields(auth) }).execute();
          await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.productId), fromLocationId: from.id, toLocationId: inTransitLocationId, qty: Number(item.qty || 0) });
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

  async receiveStockTransfer(transferId: number, auth: AuthContext, receiptPayload?: { items?: TransferReceiptTraceRequest[]; varianceReason?: string }): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const transfer = await trx.selectFrom('stock_transfers').selectAll().where('id', '=', transferId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!transfer) throw new AppError('Transfer not found', 'TRANSFER_NOT_FOUND', 404);
      if ((transfer.status || 'sent') !== 'sent') throw new AppError('Only sent transfers can be received', 'TRANSFER_STATUS_INVALID', 400);
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

      // INV-SPIRIT-TRANSFER-RECEIPT-PARTIAL: a receipt names the
      // quantities that actually arrived; an item the receiver does not
      // name defaults to 0 received and its full dispatched quantity is
      // recorded as a shortage pending a reason (variance_reason null),
      // so the receipt never waits for every item to be named. Only a
      // receipt with no items at all is still rejected: it carries no
      // evidence that anything was checked.
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
      // A shortfall no longer waits for a written variance reason: the
      // reason, when supplied, is stored as-is on each shortfall item,
      // and a missing reason stays null (pending) on the item row.
      const varianceReason = String(receiptPayload?.varianceReason || '').trim();

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
            const transitChange = await applyStockDelta(trx, { ...transitScope, delta: -received, skipGlobalUpdate: true, disableAutoDrain: true, errorCode: 'TRANSIT_STOCK_ERROR', errorMessage: 'Transit error' });
            await trx.insertInto('stock_movements').values({ product_id: Number(item.product_id), movement_type: 'transfer_transit_out', qty: -received, before_qty: transitChange.scopeBefore, after_qty: transitChange.scopeAfter, reason: 'transfer_receive', note: `Out of transit for TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, location_id: inTransitLocationId, ...this.tenantFields(auth) }).execute();
          }

          if (received > 0.0001) {
            const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), branchId: transfer.to_branch_id, locationId: effectiveToLocationId };
            const toChange = await applyStockDelta(trx, { ...toScope, delta: received, skipGlobalUpdate: true, disableAutoDrain: true, errorCode: 'TRANSFER_RECEIVE_ERROR', errorMessage: `Error receiving` });
            await trx.insertInto('stock_movements').values({ product_id: Number(item.product_id), movement_type: 'transfer_receive', qty: received, before_qty: toChange.scopeBefore, after_qty: toChange.scopeAfter, reason: 'transfer_receive', note: `Received transfer TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: transfer.to_branch_id, location_id: effectiveToLocationId, ...this.tenantFields(auth) }).execute();
            if (inTransitLocationId) {
              await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(item.product_id), fromLocationId: inTransitLocationId, toLocationId: effectiveToLocationId, qty: received });
            }
          }

          if (shortfall > 0.0001) {
            // Shrinkage: the goods left the source and never arrived, so company-wide stock really
            // does fall. This is the one leg of a transfer that touches the global counter.
            const shrinkage = await applyStockDelta(trx, {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              productId: Number(item.product_id),
              locationId: inTransitLocationId,
              branchId: null,
              delta: -shortfall,
              disableAutoDrain: true,
              errorCode: 'TRANSIT_SHRINKAGE_ERROR',
              errorMessage: 'Transit shrinkage error',
              skipGlobalUpdate: false,
            });
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
            const movement = await trx.insertInto('stock_movements').values({
              product_id: Number(item.product_id),
              movement_type: 'transfer_transit_loss',
              qty: -shortfall,
              before_qty: shrinkage.scopeBefore,
              after_qty: shrinkage.scopeAfter,
              reason: 'transit_shrinkage',
              note: `فاقد نقل للتحويل TR-${transferId}: أُرسل ${dispatched} واستُلم ${received}`,
              reference_type: 'transfer',
              reference_id: transferId,
              created_by: auth.userId,
              location_id: inTransitLocationId,
              unit_cost: unitCost,
              total_cost: roundMoney(shortfall * unitCost, moneyDigits),
              ...this.tenantFields(auth),
            }).returning('id').executeTakeFirstOrThrow();
            await syncImportLotsOnStockDeduction(trx, { tenantId: scope.tenantId, productId: Number(item.product_id), locationId: inTransitLocationId, qty: shortfall, reason: 'transit_shrinkage' });
            // Reuse the immutable stock-adjustment posting (Dr shrinkage loss,
            // Cr inventory). The movement itself still references the transfer.
            const posting = await this.accountingPosting.postInventoryAdjustment(trx, Number(movement.id), auth);
            if (posting.hasFinancialImpact && !posting.journalEntryId) {
              throw new AppError('فاقد التحويل لم ينتج عنه قيد تسوية مخزون', 'TRANSFER_SHRINKAGE_JOURNAL_MISSING', 500);
            }
            if (posting.journalEntryId) shrinkageJournalIds.push(Number(posting.journalEntryId));
          }

          await trx
            .updateTable('stock_transfer_items')
            .set({ dispatched_qty: dispatched, received_qty: received, variance_qty: shortfall, variance_reason: shortfall > 0.0001 ? (varianceReason || null) : null, batch_tracking: JSON.stringify(reconciledBatches) } as any)
            .where('id', '=', Number(item.id))
            .where(this.tenantPredicate(auth))
            .execute();
        }
      }
      // INV-TRANSFER-RECEIPT-PINNED: the first shrinkage journal id is
      // stamped on the header; the dead column now records the write-off.
      await trx.updateTable('stock_transfers').set({ status: 'received', to_location_id: effectiveToLocationId, received_by: auth.userId, received_at: sql`NOW()`, has_transit_variance: anyVariance, transit_variance_journal_entry_id: shrinkageJournalIds[0] ?? null, updated_at: sql`NOW()` } as any).where('id', '=', transferId).where(this.tenantPredicate(auth)).execute();

      await this.audit.logWithExecutor(trx, 'استلام تحويل مخزون', `تم استلام التحويل TR-${transferId}`, auth);

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

  async cancelStockTransfer(transferId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const transfer = await trx.selectFrom('stock_transfers').selectAll().where('id', '=', transferId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!transfer) throw new AppError('Transfer not found', 'TRANSFER_NOT_FOUND', 404);
      if (!['sent'].includes(transfer.status || 'sent')) throw new AppError('Only sent transfers can be cancelled', 'TRANSFER_STATUS_INVALID', 400);
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
          const transitChange = await applyStockDelta(trx, { ...transitScope, delta: -Number(item.qty || 0), skipGlobalUpdate: true, disableAutoDrain: true, errorCode: 'TRANSIT_STOCK_ERROR', errorMessage: 'Transit error' });
          await trx.insertInto('stock_movements').values({ product_id: Number(item.product_id), movement_type: 'transfer_transit_cancel', qty: -Number(item.qty || 0), before_qty: transitChange.scopeBefore, after_qty: transitChange.scopeAfter, reason: 'transfer_cancel', note: `Cancel transit for TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, location_id: inTransitLocationId, ...this.tenantFields(auth) }).execute();
        }

        const stockScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(item.product_id), branchId: transfer.from_branch_id, locationId: transfer.from_location_id };
        const stockChange = await applyStockDelta(trx, { ...stockScope, delta: Number(item.qty || 0), skipGlobalUpdate: inTransitLocationId !== null, disableAutoDrain: true, errorCode: 'TRANSFER_CANCEL_ERROR', errorMessage: `Transfer TR-${transferId} cannot be cancelled` });
        await trx.insertInto('stock_movements').values({ product_id: Number(item.product_id), movement_type: 'transfer_cancel', qty: Number(item.qty || 0), before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, reason: 'transfer_cancel', note: `Cancelled transfer TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: transfer.from_branch_id, location_id: transfer.from_location_id, ...this.tenantFields(auth) }).execute();
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

  async transferCategory(payload: { categoryId: number; fromLocationId: number; toLocationId: number; notes?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    const scope = this.tenantScope(auth);
    const from = await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    await this.tx.runInTransaction(this.db, async (trx) => {
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
        } as any).execute();

        // Deduct from source
        const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: from.branchId, locationId: from.id };
        const fromChange = await applyStockDelta(trx, { ...fromScope, delta: -qty, disableAutoDrain: true, errorCode: 'INSUFFICIENT_STOCK', errorMessage: `Insufficient stock` });
        await trx.insertInto('stock_movements').values({ product_id: stock.product_id, movement_type: 'transfer_send', qty: -qty, before_qty: fromChange.scopeBefore, after_qty: fromChange.scopeAfter, reason: 'transfer_send', note: `Sent category transfer TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: from.branchId, location_id: from.id, ...this.tenantFields(auth) }).execute();

        // Add to destination
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: to.branchId, locationId: to.id };
        const toChange = await applyStockDelta(trx, { ...toScope, delta: qty, disableAutoDrain: true, errorCode: 'TRANSFER_RECEIVE_ERROR', errorMessage: `Error receiving` });
        await trx.insertInto('stock_movements').values({ product_id: stock.product_id, movement_type: 'transfer_receive', qty: qty, before_qty: toChange.scopeBefore, after_qty: toChange.scopeAfter, reason: 'transfer_receive', note: `Received category transfer TR-${transferId}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: to.branchId, location_id: to.id, ...this.tenantFields(auth) }).execute();
        await syncImportLotsOnLocationTransfer(trx, { tenantId: scope.tenantId, productId: Number(stock.product_id), fromLocationId: from.id, toLocationId: to.id, qty });
      }
    });

    await this.audit.log('نقل قسم', `تم نقل أرصدة القسم بنجاح من ${from.name} إلى ${to.name}`, auth);
    return { ok: true };
  }
  async internalTransferProducts(payload: { items: { productId: number; qty: number }[]; fromLocationId: number; toLocationId: number; note?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    if (payload.fromLocationId === payload.toLocationId) throw new AppError('Source and destination locations must be different', 'INVALID_TRANSFER', 400);
    ensureUniqueFlowItems(payload.items || [], 'TRANSFER_DUPLICATE_PRODUCT', 'Transfer must not contain duplicate product rows');
    if (!(payload.items || []).length || payload.items.some((item) =>
      !Number.isSafeInteger(Number(item.productId)) || Number(item.productId) <= 0 ||
      !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 ||
      Math.abs(Number(item.qty) * 1000 - Math.round(Number(item.qty) * 1000)) > 0.000001)) {
      throw new AppError('Internal transfer quantities must use at most three decimal places', 'INVALID_TRANSFER_QUANTITY', 400);
    }
    const scope = this.tenantScope(auth);
    const isUnassignedLink = payload.fromLocationId === -1;
    const from = isUnassignedLink
      ? { id: null, branchId: null, name: 'رصيد غير مربوط' }
      : await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
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
          } as any).execute();

          // Deduct from source
          const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: from.branchId, locationId: from.id };
          const fromChange = await applyStockDelta(trx, { ...fromScope, delta: -qty, disableAutoDrain: true, errorCode: 'INSUFFICIENT_STOCK', errorMessage: `الرصيد غير كافٍ للصنف ${product.name}` });
          await trx.insertInto('stock_movements').values({ product_id: item.productId, movement_type: 'transfer_send', qty: -qty, before_qty: fromChange.scopeBefore, after_qty: fromChange.scopeAfter, reason: 'internal_transfer', note: payload.note || `نقل داخلي إلى ${to.name}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: from.branchId, location_id: from.id, ...this.tenantFields(auth) }).execute();
        } else {
          // Deduct from unassigned explicitly
          const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: null, locationId: null };
          await applyStockDelta(trx, { ...fromScope, delta: -qty, skipGlobalUpdate: true, errorCode: 'INSUFFICIENT_STOCK', errorMessage: `الرصيد غير كافٍ للصنف ${product.name}` });
        }

        // Add to destination location
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: item.productId, branchId: to.branchId, locationId: to.id, skipGlobalUpdate: isUnassignedLink };
        const toChange = await applyStockDelta(trx, { ...toScope, delta: qty, errorCode: 'TRANSFER_RECEIVE_ERROR', errorMessage: `Error receiving`, disableAutoDrain: true });
        await trx.insertInto('stock_movements').values({
          product_id: item.productId,
          movement_type: isUnassignedLink ? 'stock_assign' : 'transfer_receive',
          qty: qty,
          before_qty: toChange.scopeBefore,
          after_qty: toChange.scopeAfter,
          reason: isUnassignedLink ? 'unassigned_stock_link' : 'internal_transfer',
          note: payload.note || (isUnassignedLink ? `ربط الرصيد العائم بمخزن ${to.name}` : `نقل داخلي من ${from.name}`),
          reference_type: isUnassignedLink ? 'location_assign' : 'transfer',
          reference_id: transferId ?? to.id,
          created_by: auth.userId,
          branch_id: to.branchId,
          location_id: to.id,
          ...this.tenantFields(auth)
        }).execute();
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
    const from = await this.scope.assertLocationScope(payload.fromLocationId, auth, true, 'write');
    const to = await this.scope.assertLocationScope(payload.toLocationId, auth, false, 'write');

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
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
        } as any).execute();

        // Deduct from source
        const fromScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: from.branchId, locationId: from.id };
        const fromChange = await applyStockDelta(trx, { ...fromScope, delta: -qty, disableAutoDrain: true, errorCode: 'INSUFFICIENT_STOCK', errorMessage: `Insufficient stock` });
        await trx.insertInto('stock_movements').values({ product_id: stock.product_id, movement_type: 'transfer_send', qty: -qty, before_qty: fromChange.scopeBefore, after_qty: fromChange.scopeAfter, reason: 'internal_transfer', note: payload.note || `نقل قسم داخلي إلى ${to.name}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: from.branchId, location_id: from.id, ...this.tenantFields(auth) }).execute();

        // Add to destination
        const toScope = { tenantId: scope.tenantId, accountId: scope.accountId, productId: Number(stock.product_id), branchId: to.branchId, locationId: to.id };
        const toChange = await applyStockDelta(trx, { ...toScope, delta: qty, disableAutoDrain: true, errorCode: 'TRANSFER_RECEIVE_ERROR', errorMessage: `Error receiving` });
        await trx.insertInto('stock_movements').values({ product_id: stock.product_id, movement_type: 'transfer_receive', qty: qty, before_qty: toChange.scopeBefore, after_qty: toChange.scopeAfter, reason: 'internal_transfer', note: payload.note || `نقل قسم داخلي من ${from.name}`, reference_type: 'transfer', reference_id: transferId, created_by: auth.userId, branch_id: to.branchId, location_id: to.id, ...this.tenantFields(auth) }).execute();
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
    const settingRow = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'invoiceNumberingScheme')
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();

    let scheme = 'daily';
    if (settingRow?.value) {
      try {
        scheme = JSON.parse(settingRow.value);
      } catch {
        scheme = String(settingRow.value);
      }
    }

    if (scheme === 'sequential') {
      return `ZTR-${transferId}`;
    }

    // Daily date-based numbering: ZTR-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(transferId).padStart(4, '0');
    return `ZTR-${datePrefix}-${seq}`;
  }
}
