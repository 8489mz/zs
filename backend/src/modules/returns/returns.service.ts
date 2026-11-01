import { revalueStockReturn, valueStockReceipt } from '../accounting/inventory-valuation';
import { exchangeStoreCreditAmount, hasUnpaidExchangeBalance } from './engines/exchange-store-credit.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { paginateRows } from '../../common/utils/pagination';
import { ensureReturnQtyWithinLimit } from '../../common/utils/financial-integrity';
import { applyStockDelta, lockStockProducts, previewConsumableStockQty } from '../../common/utils/location-stock-ledger';
import { normalizeReturnItems } from './helpers/return-payload.helper';
import { filterReturnRows, mapReturnRows, summarizeReturnRows } from './helpers/returns-listing.helper';
import { buildPurchaseReturnLine, buildSaleReturnLine, calculateNextLedgerBalance, calculateReturnDocumentTotal, originalPurchaseReturnUnitCost } from './helpers/returns-write.helper';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { IdempotencyService } from '../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../core/idempotency/idempotency.context';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { allocateRefundTenders, type RefundTender } from './engines/refund-tender.engine';
import { allocateInvoiceDiscount } from '../sales/engines/invoice-discount.engine';
import { settlePosExchange } from '../sales/engines/pos-exchange.engine';
import { selectPurchaseReturnSerials, selectPurchaseReturnBatch } from './helpers/purchase-return-traceability.helper';
import { restoreImportLotsFromSalesReturn } from '../import-sales/helpers/import-lot-allocation.helper';
import { buildInvoiceReturnedQuantities } from './helpers/return-invoice-quantities.helper';

export interface ExchangeReturnContext {
  returnId: number;
  total: number;
  customerId: number;
  branchId: number | null;
  locationId: number | null;
  refundBase: Omit<Parameters<typeof allocateRefundTenders>[0], 'amount' | 'requested'>;
}

type ReturnInputItem = { productId: number; productName: string; qty: number; saleItemId?: number; purchaseItemId?: number; batchId?: number; serials?: string[] };
type ReturnDocumentInput = { returnType: 'sale' | 'purchase'; invoiceId: number; settlementMode: string; refundMethod: string; total: number; note: string; branchId: number | null; locationId: number | null; refundAllocations?: Array<{ tender: RefundTender | 'payable'; amount: number }> };

@Injectable()
export class ReturnsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private scope(auth: AuthContext) { return requireTenantScope(auth); }
  private tenantPredicate(auth: AuthContext, alias?: string) { const tenantId = this.scope(auth).tenantId; return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`; }
  private tenantFields(auth: AuthContext) { const scope = this.scope(auth); return { tenant_id: scope.tenantId, account_id: scope.accountId }; }

  private async findOwnOpenShift(trx: Kysely<Database>, auth: AuthContext, branchId: number | null): Promise<{ id: number; docNo: string } | null> {
    let query = trx.selectFrom('cashier_shifts').select(['id', 'doc_no'])
      .where('opened_by', '=', auth.userId).where('status', '=', 'open').where(this.tenantPredicate(auth));
    query = branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', branchId);
    const shift = await query.orderBy('id', 'desc').forUpdate().executeTakeFirst();
    return shift?.id ? { id: Number(shift.id), docNo: shift.doc_no || `SHIFT-${shift.id}` } : null;
  }

  private async addTreasuryTransaction(trx: Kysely<Database>, txnType: string, amount: number, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null, cashRefund = false): Promise<void> {
    const currentShift = cashRefund ? await this.findOwnOpenShift(trx, auth, branchId) : null;
    const isPrivileged = ['admin', 'super_admin'].includes(auth.role);
    if (cashRefund && !currentShift && !isPrivileged) throw new AppError('يجب فتح وردية على فرع الفاتورة قبل صرف مرتجع نقدي', 'OPEN_SHIFT_REQUIRED', 400);
    await trx.insertInto('treasury_transactions').values({ txn_type: txnType, amount, note: currentShift ? `${note} - ${currentShift.docNo}` : note, reference_type: currentShift ? 'cashier_shift' : 'return_document', reference_id: currentShift ? currentShift.id : returnDocumentId, return_document_id: returnDocumentId, branch_id: branchId, location_id: locationId, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
    if (currentShift) {
      await sql`update cashier_shifts set expected_cash = coalesce(expected_cash, 0) + ${amount}, updated_at = now()
        where id = ${currentShift.id} and tenant_id = ${this.scope(auth).tenantId} and status = 'open'`.execute(trx);
    }
  }

  private async addCustomerLedgerEntry(trx: Kysely<Database>, customerId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null): Promise<void> {
    const customer = await trx.selectFrom('customers').select(['balance']).where('id', '=', customerId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirstOrThrow();
    const balanceAfter = calculateNextLedgerBalance(customer.balance, amount, currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)));
    await trx.insertInto('customer_ledger').values({ customer_id: customerId, entry_type: entryType, amount, balance_after: balanceAfter, note, reference_type: 'return_document', reference_id: returnDocumentId, return_document_id: returnDocumentId, branch_id: branchId, location_id: locationId, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
    await trx.updateTable('customers').set({ balance: balanceAfter, updated_at: sql`NOW()` }).where('id', '=', customerId).where(this.tenantPredicate(auth)).execute();
  }

  private async addSupplierLedgerEntry(trx: Kysely<Database>, supplierId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null): Promise<void> {
    // Lock supplier ledger balance against concurrent payments and returns.
    const supplier = await trx.selectFrom('suppliers').select(['balance']).where('id', '=', supplierId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirstOrThrow();
    const balanceAfter = calculateNextLedgerBalance(supplier.balance, amount, currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)));
    await trx.insertInto('supplier_ledger').values({ supplier_id: supplierId, entry_type: entryType, amount, balance_after: balanceAfter, note, reference_type: 'return_document', reference_id: returnDocumentId, return_document_id: returnDocumentId, branch_id: branchId, location_id: locationId, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
    await trx.updateTable('suppliers').set({ balance: balanceAfter, updated_at: sql`NOW()` }).where('id', '=', supplierId).where(this.tenantPredicate(auth)).execute();
  }

  private async addStoreCredit(trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext): Promise<void> {
    const customer = await trx.selectFrom('customers').select(['store_credit_balance']).where('id', '=', customerId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirstOrThrow();
    const nextBalance = calculateNextLedgerBalance(customer.store_credit_balance, amount, currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)));
    await trx.updateTable('customers').set({ store_credit_balance: nextBalance, updated_at: sql`NOW()` }).where('id', '=', customerId).where(this.tenantPredicate(auth)).execute();
  }

  private async restoreReturnedPharmacyBatches(
    trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number,
    previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext,
  ): Promise<void> {
    const scope = this.scope(auth);
    const allocations = await trx.selectFrom('sale_pharmacy_batch_allocations').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId)
      .where('sale_item_id', '=', saleItemId).where('product_id', '=', productId)
      .orderBy('id', 'desc').forUpdate().execute();
    if (!allocations.length) {
      const drug = await trx.selectFrom('pharmacy_drugs').select('id')
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId)
        .executeTakeFirst();
      const anyBatch = await trx.selectFrom('pharmacy_batches').select('id')
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId)
        .limit(1).executeTakeFirst();
      if (drug || anyBatch) {
        throw new AppError('الفاتورة بلا تخصيص تشغيلة رغم وجود سجل تشغيلات للصنف؛ يلزم مصالحة قبل المرتجع',
          'PHARMACY_BATCH_RECONCILIATION_REQUIRED', 422);
      }
      return;
    }
    let skip = Number(previousReturnedBaseQty.toFixed(3));
    let remaining = Number(returnBaseQty.toFixed(3));
    const today = new Date().toISOString().slice(0, 10);
    for (const allocation of allocations) {
      const sold = Number(allocation.quantity);
      const previouslyRestored = Math.min(sold, skip);
      skip = Number((skip - previouslyRestored).toFixed(3));
      const restore = Math.min(Number((sold - previouslyRestored).toFixed(3)), remaining);
      if (restore <= 0) continue;
      const batch = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'expiry_date'])
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(allocation.pharmacy_batch_id))
        .forUpdate().executeTakeFirstOrThrow();
      const expiry = String(batch.expiry_date || '').slice(0, 10);
      const expired = !expiry || (expiry.length === 7 ? expiry < today.slice(0, 7) : expiry < today);
      await trx.updateTable('pharmacy_batches').set({
        quantity: Number((Number(batch.quantity) + restore).toFixed(3)),
        status: expired ? 'expired' : 'active', updated_at: sql`NOW()`,
      }).where('tenant_id', '=', scope.tenantId).where('id', '=', Number(batch.id)).execute();
      remaining = Number((remaining - restore).toFixed(3));
      if (remaining <= 0) break;
    }
    if (remaining > 0) throw new AppError('كمية المرتجع تتجاوز التشغيلة المباعة', 'PHARMACY_BATCH_RETURN_EXCEEDED', 422);
  }

  private async generateReturnDocNo(trx: Kysely<Database>, returnDocId: number, returnType: 'sale' | 'purchase', auth: AuthContext): Promise<string> {
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

    const prefix = returnType === 'purchase' ? 'ZPR' : 'ZR';

    if (scheme === 'sequential') {
      return `${prefix}-${returnDocId}`;
    }

    // Daily date-based numbering: ZR-YYMMDD-0001 or ZPR-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(returnDocId).padStart(4, '0');
    return `${prefix}-${datePrefix}-${seq}`;
  }

  private async insertReturnDocument(trx: Kysely<Database>, row: ReturnDocumentInput, auth: AuthContext): Promise<{ id: number; docNo: string }> {
    const scope = this.scope(auth);
    const insert = await trx.insertInto('return_documents').values({
      doc_no: 'TMP',
      return_type: row.returnType,
      invoice_id: row.invoiceId,
      settlement_mode: row.settlementMode,
      refund_method: row.refundMethod,
      refund_allocations: row.refundAllocations ? JSON.stringify(row.refundAllocations) : null,
      total: row.total,
      note: row.note,
      branch_id: row.branchId,
      location_id: row.locationId,
      created_by: auth.userId,
      ...this.tenantFields(auth),
    }).returning('id').executeTakeFirstOrThrow();

    const id = Number(insert.id);
    const docNo = await this.generateReturnDocNo(trx, id, row.returnType, auth);
    await trx.updateTable('return_documents').set({ doc_no: docNo }).where('id', '=', id).where(this.tenantPredicate(auth)).execute();
    return { id, docNo };
  }

  private async insertReturnItem(trx: Kysely<Database>, row: { returnDocumentId: number; productId: number | null; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax?: number | null; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }, auth: AuthContext): Promise<void> {
    await trx.insertInto('return_items').values({ return_document_id: row.returnDocumentId, product_id: row.productId, product_name: row.productName, qty: row.qty, unit_total: row.unitTotal, line_total: row.lineTotal, allocated_tax: row.allocatedTax ?? null, cost_price: row.costPrice ?? null, sale_item_id: row.saleItemId, purchase_item_id: row.purchaseItemId, ...this.tenantFields(auth) }).execute();
  }

  private async getReturnedQty(trx: Kysely<Database>, returnType: 'sale' | 'purchase', invoiceId: number, productId: number, auth: AuthContext, lineItemId?: number): Promise<number> {
    let query = trx.selectFrom('return_items as ri').innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id')).select((eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty')).where('rd.return_type', '=', returnType).where('rd.invoice_id', '=', invoiceId).where(this.tenantPredicate(auth, 'rd')).where(this.tenantPredicate(auth, 'ri'));
    
    if (lineItemId) {
      query = returnType === 'sale' 
        ? query.where((eb) => eb.or([eb('ri.sale_item_id', '=', lineItemId), eb('ri.sale_item_id', 'is', null).and('ri.product_id', '=', productId)]))
        : query.where((eb) => eb.or([eb('ri.purchase_item_id', '=', lineItemId), eb('ri.purchase_item_id', 'is', null).and('ri.product_id', '=', productId)]));
    } else {
      query = query.where('ri.product_id', '=', productId);
    }
    
    const result = await query.executeTakeFirst();
    return Number(result?.total_qty || 0);
  }

  async listReturns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .leftJoin('users as u', (join) => join.onRef('u.id', '=', 'rd.created_by').onRef('u.tenant_id', '=', 'rd.tenant_id'))
      .leftJoin('sales as s', (join) => join.on('rd.return_type', '=', 'sale').onRef('s.id', '=', 'rd.invoice_id').onRef('s.tenant_id', '=', 'rd.tenant_id'))
      .leftJoin('customers as c', (join) => join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 'rd.tenant_id'))
      .leftJoin('purchases as p', (join) => join.on('rd.return_type', '=', 'purchase').onRef('p.id', '=', 'rd.invoice_id').onRef('p.tenant_id', '=', 'rd.tenant_id'))
      .leftJoin('suppliers as sup', (join) => join.onRef('sup.id', '=', 'p.supplier_id').onRef('sup.tenant_id', '=', 'rd.tenant_id'))
      .select([
        'ri.id',
        'rd.id as return_document_id',
        'rd.doc_no',
        'rd.return_type',
        'rd.invoice_id',
        'ri.product_id',
        'ri.product_name',
        'ri.qty',
        'ri.line_total',
        'rd.note',
        'rd.settlement_mode',
        'rd.refund_method',
        'rd.created_at',
        'rd.created_by',
        'u.username as created_by_name',
        sql<string>`coalesce(s.doc_no, p.doc_no, '')`.as('invoice_doc_no'),
        sql<string>`coalesce(c.name, sup.name, case when rd.return_type = 'sale' then 'عميل نقدي' else 'مورد' end)`.as('party_name'),
        sql<string>`coalesce(s.order_type, '')`.as('order_type'),
      ])
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .orderBy('rd.id', 'desc')
      .orderBy('ri.id', 'asc')
      .execute();
    const today = new Date().toISOString().slice(0, 10);
    const mapped = filterReturnRows(mapReturnRows(rows as Array<Record<string, unknown>>), query, today);
    const paged = paginateRows(mapped, query, { defaultSize: 20 });
    return { returns: paged.rows, pagination: paged.pagination, summary: summarizeReturnRows(mapped, today), scope: this.scope(auth) };
  }

  /** Unpaginated invoice-return history, used only to guide the UI.
   * Transactional posting independently checks quantities with invoice locks.
   */
  async getInvoiceReturnedQuantities(type: string, invoiceId: number, auth: AuthContext):
    Promise<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }> {
    if (!['sale', 'purchase'].includes(type)) {
      throw new AppError('Invalid return type', 'RETURN_TYPE_INVALID', 400);
    }
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new AppError('Invalid invoice', 'INVOICE_NOT_FOUND', 404);
    const tenantId = this.scope(auth).tenantId;
    const returnType = type as 'sale' | 'purchase';
    const parent = returnType === 'sale'
      ? await this.db.selectFrom('sales').select('id').where('id', '=', invoiceId).where('tenant_id', '=', tenantId).where('status', '=', 'posted').executeTakeFirst()
      : await this.db.selectFrom('purchases').select('id').where('id', '=', invoiceId).where('tenant_id', '=', tenantId).where('status', '=', 'posted').executeTakeFirst();
    if (!parent) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    const rows = await this.db.selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select(['ri.product_id', 'ri.sale_item_id', 'ri.purchase_item_id',
        (eb) => eb.fn.sum<number>('ri.qty').as('returned_qty')])
      .where('rd.return_type', '=', returnType).where('rd.invoice_id', '=', invoiceId)
      .where('rd.tenant_id', '=', tenantId).where('ri.tenant_id', '=', tenantId)
      .groupBy(['ri.product_id', 'ri.sale_item_id', 'ri.purchase_item_id']).execute();
    return buildInvoiceReturnedQuantities(returnType, rows);
  }

  private async getManagerPin(trx: Kysely<Database>, auth: AuthContext): Promise<string> {
    const { tenantId } = requireTenantScope(auth);
    const result = await sql<{ key?: string; value?: string }>`
      select key, value from settings
      where key in ('managerPin', 'managerApprovalPin', 'manager_pin')
        and tenant_id = ${tenantId}
    `.execute(trx);

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

  private async verifyManagerAuthorization(trx: Kysely<Database>, secret: string, auth: AuthContext): Promise<string> {
    const { tenantId } = requireTenantScope(auth);
    const normalizedSecret = String(secret || '').trim();
    if (!normalizedSecret) {
      throw new AppError('أدخل رمز المشرف أو كلمة المرور لاعتماد المرتجع', 'MANAGER_AUTH_REQUIRED', 403);
    }

    const managerPin = await this.getManagerPin(trx, auth);
    if (managerPin && normalizedSecret === managerPin) {
      return 'رمز المشرف';
    }

    const managerUsers = await trx
      .selectFrom('users')
      .select(['id', 'username', 'role', 'password_hash', 'password_salt'])
      .where('is_active', '=', true)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where((eb) => eb.or([eb('role', '=', 'admin'), eb('role', '=', 'super_admin')]))
      .execute();

    for (const managerUser of managerUsers) {
      const passwordCheck = await verifyPassword(
        normalizedSecret,
        String(managerUser.password_hash || ''),
        String(managerUser.password_salt || ''),
      );
      if (passwordCheck.valid) {
        return String(managerUser.username || 'المدير');
      }
    }

    throw new AppError('رمز المشرف أو كلمة المرور غير صحيحة', 'MANAGER_AUTH_INVALID', 403);
  }

  async createReturn(payload: CreateReturnDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const idemCtx = idempotencyStorage.getStore();

    // Verify manager permission if cashier doesn't have direct return privileges
    const isPrivileged = auth.role === 'super_admin' || auth.role === 'admin' || (auth.permissions && auth.permissions.includes('canDirectReturn'));
    let approvedByName: string | undefined;

    if (!isPrivileged || (payload.refundOverrideReason && !['admin', 'super_admin'].includes(auth.role))) {
      approvedByName = await this.verifyManagerAuthorization(this.db, payload.managerPin || '', auth);
    }

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      const normalizedItems = normalizeReturnItems(payload);
      const returnIds = payload.type === 'sale'
        ? await this.createSaleReturn(trx, payload, normalizedItems, auth, approvedByName)
        : await this.createPurchaseReturn(trx, payload, normalizedItems, auth);

      const res = { ok: true, createdIds: returnIds, id: returnIds[0], returnDocumentId: returnIds[0] };

      // Idempotency: commit inside the EXACT SAME business transaction (CORE-004)
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: idemCtx.accountId || scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          res,
          String(returnIds[0])
        );
      }

      return res;
    });

    const returnIds = result.createdIds;
    const label = payload.type === 'purchase' ? 'purchase return' : 'sale return';
    const auditText = approvedByName
      ? `Created ${label} by ${auth.username} (Approved by: ${approvedByName})`
      : `Created ${label} by ${auth.username}`;
    await this.audit.log('إنشاء مرتجع', auditText, auth);

    // WhatsApp refund notification to owner (post-commit reliable notification)
    if (payload.type === 'sale' && this.whatsappService && returnIds[0]) {
      void (async () => {
        try {
          const doc = await this.db
            .selectFrom('return_documents')
            .select(['doc_no', 'total'])
            .where('id', '=', returnIds[0])
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst();
          if (doc) {
            void this.whatsappService?.sendRefundNotification(
              doc.doc_no || String(returnIds[0]),
              Number(doc.total || 0),
              payload.note || '',
              scope.tenantId,
              auth.username
            ).catch(() => undefined);
          }
        } catch {}
      })();
    }

    return result;
  }

  async prepareExchangeReturn(trx: Transaction<Database>, payload: CreateReturnDto, auth: AuthContext): Promise<ExchangeReturnContext> {
    const approved = await this.verifyManagerAuthorization(trx, payload.managerPin || '', auth);
    let context: ExchangeReturnContext | undefined;
    await this.createSaleReturn(trx, { ...payload, settlementMode: 'store_credit' }, normalizeReturnItems(payload), auth, approved,
      (result) => { context = result; });
    if (!context) throw new AppError('تعذر تجهيز المرتجع الذري', 'EXCHANGE_RETURN_MISSING', 500);
    return context;
  }

  async settleExchangeReturn(trx: Transaction<Database>, context: ExchangeReturnContext, saleTotal: number,
    requested: 'cash' | 'card' | 'store_credit', auth: AuthContext): Promise<ReturnType<typeof settlePosExchange>> {
    const exchangeDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId));
    const settlement = settlePosExchange(context.total, saleTotal, exchangeDigits);
    const remainder = settlement.refundAmount > 0
      ? allocateRefundTenders({ ...context.refundBase, amount: settlement.refundAmount, requested, digits: exchangeDigits }) : [];
    const allocations: Array<{ tender: RefundTender; amount: number }> = [];
    const retainedCredit = settlement.appliedCredit + remainder.filter((line) => line.tender === 'store_credit')
      .reduce((sum, line) => sum + line.amount, 0);
    if (retainedCredit > 0) allocations.push({ tender: 'store_credit', amount: exchangeStoreCreditAmount(retainedCredit, exchangeDigits) });
    for (const line of remainder) {
      if (line.tender === 'store_credit') continue;
      if (line.tender === 'receivable') throw new AppError('يجب تسوية مديونية الفاتورة قبل الاستبدال', 'EXCHANGE_UNPAID_SOURCE', 422);
      allocations.push(line);
      await this.addStoreCredit(trx, context.customerId, -line.amount, auth);
      if (line.tender === 'cash') {
        await this.addTreasuryTransaction(trx, 'sale_return_refund', -line.amount,
          `صافي استرداد استبدال ${context.returnId}`, context.returnId, auth, context.branchId, context.locationId, true);
      }
    }
    await trx.updateTable('return_documents').set({
      settlement_mode: requested === 'store_credit' ? 'store_credit' : 'refund',
      refund_method: allocations.length === 1 ? allocations[0].tender : 'mixed',
      refund_allocations: JSON.stringify(allocations),
    }).where('tenant_id', '=', this.scope(auth).tenantId).where('id', '=', context.returnId).execute();
    return settlement;
  }

  private async createSaleReturn(trx: Transaction<Database>, payload: CreateReturnDto, items: ReturnInputItem[], auth: AuthContext, approvedByName?: string,
    exchangePrepared?: (context: ExchangeReturnContext) => void): Promise<number[]> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const sale = await trx.selectFrom('sales').selectAll().where('id', '=', Number(payload.invoiceId)).where('status', '=', 'posted').where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
    if (!sale) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (exchangePrepared && (!sale.customer_id || hasUnpaidExchangeBalance(Number(sale.total), Number(sale.paid_amount), Number(sale.store_credit_used || 0), moneyDigits))) {
      throw new AppError('الاستبدال يتطلب فاتورة مسددة وعميلها مسجلاً؛ سوِّ المديونية أولاً', 'EXCHANGE_UNPAID_SOURCE', 422);
    }
    if (payload.settlementMode === 'store_credit' && !sale.customer_id) {
      throw new AppError('رصيد المتجر يتطلب عميلاً مرتبطاً بالفاتورة', 'RETURN_STORE_CREDIT_CUSTOMER_REQUIRED', 400);
    }
    await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });
    if (sale.customer_id) {
      await trx.selectFrom('customers').select('id').where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(sale.customer_id)).forUpdate().executeTakeFirstOrThrow();
    }
    const saleItems = await trx.selectFrom('sale_items').selectAll().where('sale_id', '=', Number(payload.invoiceId)).where(this.tenantPredicate(auth)).orderBy('id', 'asc').forUpdate().execute();
    const settlementMode = payload.settlementMode === 'store_credit' ? 'store_credit' : 'refund';
    const refundMethod = payload.refundMethod === 'card' ? 'card' : 'cash';
    const originalPayments = await trx.selectFrom('sale_payments').select(['payment_channel', 'amount'])
      .where('sale_id', '=', Number(sale.id)).where('tenant_id', '=', scope.tenantId).execute();
    const previousRefundRows = await trx.selectFrom('return_documents')
      .select(['refund_method', 'settlement_mode', 'refund_allocations', 'total'])
      .where('return_type', '=', 'sale').where('invoice_id', '=', Number(sale.id))
      .where('tenant_id', '=', scope.tenantId).execute();
    const originalPaid = originalPayments.length
      ? originalPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0) : Number(sale.paid_amount || 0);
    const originalCashPaid = originalPayments.length
      ? originalPayments.filter((row) => row.payment_channel === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0)
      : sale.payment_channel === 'cash' ? originalPaid : 0;
    const originalNonCashPaid = Math.max(0, originalPaid - originalCashPaid);
    const priorAllocations: Array<{ tender: RefundTender; amount: number }> = [];
    for (const previous of previousRefundRows) {
      if (previous.refund_allocations != null) {
        const parsed: unknown = typeof previous.refund_allocations === 'string'
          ? JSON.parse(previous.refund_allocations) : previous.refund_allocations;
        if (!Array.isArray(parsed) || parsed.some((entry) => !entry ||
          !['cash', 'card', 'store_credit', 'receivable'].includes(entry.tender) ||
          !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0)) {
          throw new AppError('توزيع استرداد سابق غير صالح', 'REFUND_HISTORY_INVALID', 409);
        }
        priorAllocations.push(...parsed as Array<{ tender: RefundTender; amount: number }>);
      } else {
        const tender: RefundTender = previous.settlement_mode === 'store_credit' ? 'store_credit'
          : sale.payment_type === 'credit' ? 'receivable'
            : previous.refund_method === 'cash' ? 'cash' : 'card';
        priorAllocations.push({ tender, amount: Number(previous.total || 0) });
      }
    }
    const priorTotal = (tender: RefundTender) => priorAllocations
      .filter((entry) => entry.tender === tender).reduce((sum, entry) => sum + entry.amount, 0);
    const previousCashRefunded = priorTotal('cash');
    const previousNonCashRefunded = priorTotal('card');
    const previousDebtReversed = priorTotal('receivable');
    const normalizedLines: Array<{ productId: number; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax: number; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }> = [];

    const pendingQtyByProduct = new Map<number, number>();
    const pendingQtyByLine = new Map<number, number>();

    const returnedRows = await trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select([
        'ri.product_id',
        'ri.sale_item_id',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.line_total'), sql<number>`0`).as('total_amount'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.allocated_tax'), sql<number>`0`).as('total_tax'),
        sql<number>`sum(case when ri.allocated_tax is null then 1 else 0 end)`.as('unpriced_count'),
      ])
      .where('rd.return_type', '=', 'sale')
      .where('rd.invoice_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .groupBy(['ri.product_id', 'ri.sale_item_id'])
      .execute();

    const returnedQtyByLine = new Map<number, number>();
    const returnedAmountByLine = new Map<number, number>();
    const returnedTaxByLine = new Map<number, number>();
    const returnedQtyByProduct = new Map<number, number>();
    const legacyReturnedProducts = new Set<number>();
    const unreconciledReturnLines = new Set<number>();
    for (const r of returnedRows) {
      const q = Number(r.total_qty || 0);
      if (r.sale_item_id) {
        returnedQtyByLine.set(Number(r.sale_item_id), q);
        returnedAmountByLine.set(Number(r.sale_item_id), Number(r.total_amount || 0));
        returnedTaxByLine.set(Number(r.sale_item_id), Number(r.total_tax || 0));
        if (Number(r.unpriced_count || 0) > 0) unreconciledReturnLines.add(Number(r.sale_item_id));
      }
      const pId = Number(r.product_id || 0);
      if (!r.sale_item_id && q > 0) legacyReturnedProducts.add(pId);
      returnedQtyByProduct.set(pId, (returnedQtyByProduct.get(pId) || 0) + q);
    }

    const legacyPricedLineIds = new Set(saleItems.filter((line) => line.net_line_total == null).map((line) => Number(line.id)));
    if (legacyPricedLineIds.size > 0) {
      const allocations = allocateInvoiceDiscount({
        lines: saleItems.map((line) => ({ lineTotal: Number(line.line_total || 0), qty: Number(line.qty || 0) })),
        invoiceDiscount: Number(sale.discount || 0), invoiceTax: Number(sale.tax_amount || 0),
        pricesIncludeTax: Boolean(sale.prices_include_tax), digits: moneyDigits,
      });
      for (let index = 0; index < saleItems.length; index += 1) {
        const line = saleItems[index];
        if (line.net_line_total != null) continue;
        const allocation = allocations[index];
        await trx.updateTable('sale_items').set({
          net_unit_price: allocation.netUnitPrice, net_line_total: allocation.netLineTotal,
          allocated_discount: allocation.allocatedDiscount, allocated_tax: allocation.allocatedTax,
        }).where('id', '=', Number(line.id)).where('tenant_id', '=', scope.tenantId).execute();
        Object.assign(line, {
          net_unit_price: allocation.netUnitPrice, net_line_total: allocation.netLineTotal,
          allocated_discount: allocation.allocatedDiscount, allocated_tax: allocation.allocatedTax,
        });
      }
    }

    for (const requestItem of [...items].sort((a, b) => a.productId - b.productId)) {
      const matchingLines = saleItems.filter((entry) => Number(entry.product_id) === requestItem.productId);
      if (!requestItem.saleItemId && matchingLines.length > 1) {
        throw new AppError('حدد سطر الفاتورة الأصلي للصنف المتكرر', 'SALE_ITEM_ID_REQUIRED', 400);
      }
      const saleItem = requestItem.saleItemId
        ? matchingLines.find((entry) => Number(entry.id) === requestItem.saleItemId)
        : matchingLines[0];
      if (!saleItem) throw new AppError('Return item not found', 'NOT_FOUND', 404);
      const saleLineId = Number(saleItem.id);
      // A prepared restaurant dish consumes both its parent stock and separate
      // ingredients. A refund is financial only: none of those consumed units
      // physically return to inventory, and their historical COGS must stay
      // expensed. The immutable return line records zero *restocked* cost so
      // postSalesReturn reverses revenue/tender without inventing inventory GL.
      const consumedComponent = await trx.selectFrom('sale_line_stock_allocations')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('sale_line_id', '=', saleLineId)
        .where('product_id', '!=', Number(saleItem.product_id))
        .executeTakeFirst();
      const isPreparedComposite = Boolean(consumedComponent);
      if (unreconciledReturnLines.has(saleLineId) || (legacyPricedLineIds.has(saleLineId) && (returnedQtyByLine.get(saleLineId) || 0) > 0)) {
        throw new AppError('مرتجع سابق يحتاج تسوية الضريبة والخصم قبل مرتجع جديد', 'RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      if (legacyReturnedProducts.has(requestItem.productId)) {
        throw new AppError('مرتجع سابق بلا ربط بسطر الفاتورة يحتاج تسوية قبل مرتجع جديد', 'RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      const soldForProduct = matchingLines.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByProduct.get(requestItem.productId) || 0),
        returnedQtyByProduct.get(requestItem.productId) || 0,
        soldForProduct,
      );
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByLine.get(saleLineId) || 0),
        returnedQtyByLine.get(saleLineId) || 0,
        Number(saleItem.qty || 0),
      );
      pendingQtyByProduct.set(requestItem.productId, (pendingQtyByProduct.get(requestItem.productId) || 0) + requestItem.qty);
      pendingQtyByLine.set(saleLineId, (pendingQtyByLine.get(saleLineId) || 0) + requestItem.qty);

      const product = await trx.selectFrom('products').select(['id', 'stock_qty', 'track_serials', 'cost_price']).where('id', '=', requestItem.productId).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const preparedLine = buildSaleReturnLine(saleItem, product, requestItem, {
        qty: returnedQtyByLine.get(saleLineId) || 0,
        amount: returnedAmountByLine.get(saleLineId) || 0,
        tax: returnedTaxByLine.get(saleLineId) || 0,
      }, moneyDigits);
      const returnedUnitCost = Number(saleItem.cost_price || 0) / Number(saleItem.unit_multiplier || 1);
      // Serialized goods must always use the traceable retail restock workflow.
      if (isPreparedComposite && (product.track_serials === true || requestItem.serials?.length)) {
        throw new AppError('Composite serialized item requires manual stock reconciliation',
          'COMPOSITE_RETURN_SERIAL_RECONCILIATION_REQUIRED', 409);
      }
      if (!isPreparedComposite) {
      const previouslyReturnedBaseQty = Number((
        (returnedQtyByLine.get(saleLineId) || 0) +
        (pendingQtyByLine.get(saleLineId) || 0) - requestItem.qty
      ) * Number(saleItem.unit_multiplier || 1));
      await this.restoreReturnedPharmacyBatches(trx, Number(sale.id), saleLineId, requestItem.productId,
        previouslyReturnedBaseQty, preparedLine.stockDelta, auth);
      await restoreImportLotsFromSalesReturn(trx as any, {
        tenantId: scope.tenantId,
        saleId: Number(sale.id),
        saleItemId: saleLineId,
        productId: requestItem.productId,
        returnQty: preparedLine.stockDelta,
      });

      const originalSerials = typeof saleItem.serials === 'string'
        ? JSON.parse(saleItem.serials || '[]') as unknown : saleItem.serials;
      const hasSerials = product.track_serials === true || (Array.isArray(originalSerials) && originalSerials.length > 0);
      if (hasSerials) {
        if (!Number.isInteger(preparedLine.stockDelta)) {
          throw new AppError('كمية المرتجع التسلسلي يجب أن تكون عدداً صحيحاً', 'RETURN_SERIAL_QUANTITY_INVALID', 400);
        }
        const soldSerials = await trx.selectFrom('product_serials')
          .select(['id', 'serial_number', 'imei_2'])
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', requestItem.productId)
          .where('sale_id', '=', Number(sale.id)).where('sale_item_id', '=', saleLineId)
          .where('status', '=', 'sold').orderBy('id', 'asc').forUpdate().execute();
        const requestedSerials = (requestItem.serials || []).map((serial) => serial.trim().toLowerCase());
        if (requestedSerials.length === 0 && soldSerials.length !== preparedLine.stockDelta) {
          throw new AppError('حدد سيريالات القطع المراد إرجاعها جزئياً', 'RETURN_SERIALS_REQUIRED', 400);
        }
        const chosen = requestedSerials.length === 0
          ? soldSerials
          : soldSerials.filter((row) => requestedSerials.includes(row.serial_number.toLowerCase()) ||
            (row.imei_2 && requestedSerials.includes(row.imei_2.toLowerCase())));
        if (chosen.length !== preparedLine.stockDelta ||
            (requestedSerials.length > 0 && (requestedSerials.length !== chosen.length || new Set(requestedSerials).size !== requestedSerials.length))) {
          throw new AppError('السيريال غير مباع في سطر الفاتورة أو تم إرجاعه سابقاً', 'RETURN_SERIAL_NOT_SOLD', 409);
        }
        await trx.updateTable('product_serials')
          .set({ status: 'in_stock', sale_id: null, sale_item_id: null, updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', chosen.map((row) => row.id)).execute();
      } else if (requestItem.serials?.length) {
        throw new AppError('سطر الفاتورة لا يحتوي على سيريالات', 'RETURN_SERIAL_NOT_SOLD', 400);
      }

      const allocations = await trx.selectFrom('sale_line_stock_allocations')
         .selectAll()
         .where('sale_line_id', '=', saleLineId)
         .where('product_id', '=', requestItem.productId)
         .where(this.tenantPredicate(auth))
         .orderBy('allocation_order', 'desc')
         .execute();

      if (allocations.length > 0) {
         let remainingToSkip = Number((((returnedQtyByLine.get(saleLineId) || 0) + (pendingQtyByLine.get(saleLineId) || 0) - requestItem.qty) * Number(saleItem.unit_multiplier || 1)).toFixed(3));
         let remainingToReturn = preparedLine.stockDelta;

         for (const alloc of allocations) {
            if (remainingToReturn <= 0) break;
            const allocQty = Number(alloc.quantity || 0);
            
            let availableInAlloc = allocQty;
            if (remainingToSkip > 0) {
               const skipFromThis = Math.min(availableInAlloc, remainingToSkip);
               remainingToSkip -= skipFromThis;
               availableInAlloc -= skipFromThis;
            }

            if (availableInAlloc > 0) {
               const returnToThis = Math.min(availableInAlloc, remainingToReturn);
               remainingToReturn = Number((remainingToReturn - returnToThis).toFixed(3));

                const locData = await trx
                  .selectFrom('stock_locations')
                  .select('branch_id')
                  .where('id', '=', alloc.location_id)
                  .where(this.tenantPredicate(auth))
                  .executeTakeFirst();
                if (!locData) {
                  throw new AppError('مخزن السطر الأصلي للمرتجع غير موجود أو خارج نطاق المنشأة', 'SALE_RETURN_ORIGINAL_LOCATION_MISSING', 409);
                }
                const branchId = locData.branch_id ?? sale.branch_id;

               const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: returnToThis, branchId: branchId, locationId: alloc.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true });
               await valueStockReceipt(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, returnToThis, returnedUnitCost * returnToThis);
               await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'sale_return', qty: returnToThis, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: returnedUnitCost, total_cost: roundBookMoney(returnedUnitCost * returnToThis, moneyDigits), reason: 'sale_return', note: 'sale return S-' + String(sale.id), reference_type: 'sale_return', reference_id: Number(payload.invoiceId), branch_id: branchId, location_id: alloc.location_id, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
            }
         }
         
         // Once original location allocations exist, a missing allocation is a
         // damaged audit trail. Never silently return goods to a default warehouse;
         // a partial refund must not create stock in the wrong location.
         if (remainingToReturn > 0.0001) {
           throw new AppError('توزيع مخزون البيع الأصلي غير مكتمل؛ يلزم تسوية المخزن قبل المرتجع', 'SALE_RETURN_STOCK_ALLOCATION_RECONCILIATION_REQUIRED', 409);
         }
      } else {
         const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: preparedLine.stockDelta, branchId: sale.branch_id, locationId: sale.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true });
         await valueStockReceipt(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, preparedLine.stockDelta, returnedUnitCost * preparedLine.stockDelta);
         await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'sale_return', qty: preparedLine.stockDelta, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: returnedUnitCost, total_cost: roundBookMoney(returnedUnitCost * preparedLine.stockDelta, moneyDigits), reason: 'sale_return', note: 'sale return S-' + String(sale.id), reference_type: 'sale_return', reference_id: Number(payload.invoiceId), branch_id: sale.branch_id, location_id: sale.location_id, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
      }

      } // End restock path. Prepared meals remain consumed and must never create stock.
      normalizedLines.push({ productId: preparedLine.productId, productName: preparedLine.productName, qty: preparedLine.qty, unitTotal: preparedLine.unitTotal, lineTotal: preparedLine.lineTotal, allocatedTax: preparedLine.allocatedTax, costPrice: isPreparedComposite ? 0 : Number(saleItem.cost_price || 0), saleItemId: saleLineId });
    }

    const total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    const overrideRequested = Boolean(String(payload.refundOverrideReason || '').trim());
    const overrideAllowed = Boolean(approvedByName) || auth.role === 'admin' || auth.role === 'super_admin';
    if (overrideRequested && !overrideAllowed) throw new AppError('تجاوز سقف وسيلة الاسترداد يتطلب اعتماد مشرف', 'REFUND_OVERRIDE_MANAGER_REQUIRED', 403);
    const refundAllocations = allocateRefundTenders({
      digits: moneyDigits,
      requested: settlementMode === 'store_credit' ? 'store_credit' : refundMethod,
      amount: total,
      originalCashPaid, originalNonCashPaid,
      originalDebt: Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0) - Math.max(originalPaid, Number(sale.paid_amount || 0))),
      previousCashRefunded, previousNonCashRefunded, previousDebtReversed,
      hasCustomer: Boolean(sale.customer_id),
      override: overrideRequested, overrideReason: payload.refundOverrideReason,
    });
    const returnNote = overrideRequested
      ? `${String(payload.note || '').trim()} | اعتماد تجاوز وسيلة الاسترداد: ${String(payload.refundOverrideReason).trim()}`.trim()
      : `${String(payload.note || '').trim()}${exchangePrepared && approvedByName ? ` | اعتماد المشرف: ${approvedByName}` : ''}`.trim();
    // The posting service reverses the returned lines using their original sale-line costs.
    const { id: returnDocumentId, docNo: returnDocNo } = await this.insertReturnDocument(trx, {
      returnType: 'sale', invoiceId: Number(payload.invoiceId), settlementMode,
      refundMethod: refundAllocations.length === 1 ? refundAllocations[0].tender : 'mixed',
      refundAllocations, total, note: returnNote, branchId: sale.branch_id, locationId: sale.location_id,
    }, auth);
    for (const line of normalizedLines) await this.insertReturnItem(trx, { returnDocumentId, productId: line.productId, productName: line.productName, qty: line.qty, unitTotal: line.unitTotal, lineTotal: line.lineTotal, allocatedTax: line.allocatedTax, costPrice: line.costPrice, saleItemId: line.saleItemId }, auth);
    const customerId = sale.customer_id ? Number(sale.customer_id) : null;
    for (const allocation of refundAllocations) {
      if (allocation.tender === 'store_credit' && customerId) await this.addStoreCredit(trx, customerId, allocation.amount, auth);
      else if (allocation.tender === 'receivable' && customerId) await this.addCustomerLedgerEntry(trx, customerId, -allocation.amount, 'sale_return', 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
      else if (allocation.tender === 'cash') await this.addTreasuryTransaction(trx, 'sale_return_refund', -allocation.amount, 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id, true);
    }

    // Reconcile Customer Loyalty Points on Return (ZS-070)
    if (customerId) {
      const originalSaleTotal = Number(sale.total) || 1;

      // Cumulative returns calculation so repeated partial returns never over-reconcile
      const previousReturns = await trx
        .selectFrom('return_documents')
        .select(sql<number>`COALESCE(SUM(total), 0)`.as('returned_sum'))
        .where('return_type', '=', 'sale')
        .where('invoice_id', '=', Number(sale.id))
        .where('id', '!=', returnDocumentId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();
      const cumulativeReturned = Number(previousReturns?.returned_sum || 0) + total;
      const cumulativeRatio = Math.min(1, Math.max(0, cumulativeReturned / originalSaleTotal));

      // 1. Clawback earned loyalty points proportionally
      const earnLog = await trx
        .selectFrom('customer_loyalty_logs')
        .select(['points_change'])
        .where('sale_id', '=', Number(sale.id))
        .where('action_type', '=', 'earn')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (earnLog && Number(earnLog.points_change) > 0) {
        const earnedPoints = Number(earnLog.points_change);
        const previousClawbacks = await trx
          .selectFrom('customer_loyalty_logs')
          .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
          .where('sale_id', '=', Number(sale.id))
          .where('action_type', '=', 'return_clawback')
          .where(this.tenantPredicate(auth))
          .executeTakeFirst();
        const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);

        const targetClawback = Math.min(earnedPoints, Math.round(earnedPoints * cumulativeRatio));
        const clawbackPoints = Math.max(0, Math.min(targetClawback - alreadyClawed, earnedPoints - alreadyClawed));

        if (clawbackPoints > 0) {
          const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(this.tenantPredicate(auth)).executeTakeFirst();
          const currentBal = Number(cust?.loyalty_points || 0);
          const balanceAfter = Math.max(0, Number((currentBal - clawbackPoints).toFixed(2)));

          await trx
            .updateTable('customers')
            .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
            .where('id', '=', customerId)
            .where(this.tenantPredicate(auth))
            .execute();

          await trx
            .insertInto('customer_loyalty_logs')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              customer_id: customerId,
              points_change: -clawbackPoints,
              balance_after: balanceAfter,
              action_type: 'return_clawback',
              sale_id: Number(sale.id),
              notes: `خصم ${clawbackPoints} نقطة ولاء مكتسبة بسبب مرتجع مبيعات ${returnDocNo} على الفاتورة S-${sale.id}`,
              created_at: sql`NOW()`,
            } as any)
            .execute();
        }
      }

      // 2. Refund redeemed loyalty points proportionally if customer had used points for discount
      const redeemLog = await trx
        .selectFrom('customer_loyalty_logs')
        .select(['points_change'])
        .where('sale_id', '=', Number(sale.id))
        .where('action_type', '=', 'redeem')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (redeemLog && Number(redeemLog.points_change) < 0) {
        const totalRedeemed = Math.abs(Number(redeemLog.points_change));
        const previousRefunds = await trx
          .selectFrom('customer_loyalty_logs')
          .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
          .where('sale_id', '=', Number(sale.id))
          .where('action_type', '=', 'return_refund')
          .where(this.tenantPredicate(auth))
          .executeTakeFirst();
        const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);

        const targetRefund = Math.min(totalRedeemed, Math.round(totalRedeemed * cumulativeRatio));
        const refundPoints = Math.max(0, Math.min(targetRefund - alreadyRefunded, totalRedeemed - alreadyRefunded));

        if (refundPoints > 0) {
          const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(this.tenantPredicate(auth)).executeTakeFirst();
          const currentBal = Number(cust?.loyalty_points || 0);
          const balanceAfter = Number((currentBal + refundPoints).toFixed(2));

          await trx
            .updateTable('customers')
            .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
            .where('id', '=', customerId)
            .where(this.tenantPredicate(auth))
            .execute();

          await trx
            .insertInto('customer_loyalty_logs')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              customer_id: customerId,
              points_change: refundPoints,
              balance_after: balanceAfter,
              action_type: 'return_refund',
              sale_id: Number(sale.id),
              notes: `رد ${refundPoints} نقطة ولاء مستبدلة سابقاً بسبب مرتجع مبيعات ${returnDocNo} على الفاتورة S-${sale.id}`,
              created_at: sql`NOW()`,
            } as any)
            .execute();
        }
      }
    }

    if (exchangePrepared) {
      exchangePrepared({ returnId: returnDocumentId, total, customerId: Number(sale.customer_id),
        branchId: sale.branch_id, locationId: sale.location_id,
        refundBase: { originalCashPaid, originalNonCashPaid, originalDebt: 0,
          previousCashRefunded, previousNonCashRefunded, previousDebtReversed, hasCustomer: true } });
      return [returnDocumentId];
    }
    try {
      const posting = await this.accountingPosting.postSalesReturn(trx, returnDocumentId, auth);
      if (!posting.journalEntryId) throw new Error(`Sales return ${returnDocumentId} has no journal entry`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error instanceof Error ? error.message : 'Failed to post accounting journal for sales return',
        'SALES_RETURN_ACCOUNTING_POST_FAILED',
        500,
      );
    }
    return [returnDocumentId];
  }

  private async createPurchaseReturn(trx: Transaction<Database>, payload: CreateReturnDto, items: ReturnInputItem[], auth: AuthContext): Promise<number[]> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const purchase = await trx.selectFrom('purchases').selectAll().where('id', '=', Number(payload.invoiceId)).where('status', '=', 'posted').where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
    if (!purchase) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });
    const purchaseItems = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', Number(payload.invoiceId)).where(this.tenantPredicate(auth)).orderBy('id', 'asc').forUpdate().execute();
    const normalizedLines: Array<{ productId: number; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax: number; costPrice: number; saleItemId?: number; purchaseItemId?: number }> = [];

    // Purchase items hold after-discount values. Distribute the invoice's actual
    // input VAT to original lines in cents, including the last-line remainder.
    // Inclusive purchase prices already contain VAT; exclusive prices do not.
    const scale = 10 ** moneyDigits;
    const originalTaxCents = Math.round(Number(purchase.tax_amount || 0) * scale);
    const weightedLines = purchaseItems.filter((line) => Number(line.line_total || 0) > 0);
    const netLinesTotal = weightedLines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const taxByLine = new Map<number, number>();
    let allocatedTaxCents = 0;
    for (let index = 0; index < weightedLines.length; index += 1) {
      const line = weightedLines[index];
      const last = index === weightedLines.length - 1;
      const cents = last ? originalTaxCents - allocatedTaxCents
        : Math.min(originalTaxCents - allocatedTaxCents, Math.round(originalTaxCents * Number(line.line_total || 0) / netLinesTotal));
      allocatedTaxCents += cents;
      taxByLine.set(Number(line.id), cents / scale);
    }

    const pendingQtyByProduct = new Map<number, number>();
    const pendingQtyByLine = new Map<number, number>();

    const returnedRows = await trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select([
        'ri.product_id',
        'ri.purchase_item_id',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.line_total'), sql<number>`0`).as('total_amount'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.allocated_tax'), sql<number>`0`).as('total_tax'),
        sql<number>`sum(case when ri.allocated_tax is null then 1 else 0 end)`.as('unallocated_tax_lines'),
      ])
      .where('rd.return_type', '=', 'purchase')
      .where('rd.invoice_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .groupBy(['ri.product_id', 'ri.purchase_item_id'])
      .execute();

    const returnedQtyByLine = new Map<number, number>();
    const returnedAmountByLine = new Map<number, number>();
    const returnedTaxByLine = new Map<number, number>();
    const unreconciledTaxLineIds = new Set<number>();
    const returnedQtyByProduct = new Map<number, number>();
    const legacyReturnedProducts = new Set<number>();
    for (const r of returnedRows) {
      const q = Number(r.total_qty || 0);
      if (r.purchase_item_id) {
        returnedQtyByLine.set(Number(r.purchase_item_id), q);
        returnedAmountByLine.set(Number(r.purchase_item_id), Number(r.total_amount || 0));
        returnedTaxByLine.set(Number(r.purchase_item_id), Number(r.total_tax || 0));
        if (Number(r.unallocated_tax_lines || 0) > 0) unreconciledTaxLineIds.add(Number(r.purchase_item_id));
      }
      const pId = Number(r.product_id || 0);
      if (!r.purchase_item_id && q > 0) legacyReturnedProducts.add(pId);
      returnedQtyByProduct.set(pId, (returnedQtyByProduct.get(pId) || 0) + q);
    }

    for (const requestItem of [...items].sort((a, b) => a.productId - b.productId)) {
      const matchingLines = purchaseItems.filter((entry) => Number(entry.product_id) === requestItem.productId);
      if (!requestItem.purchaseItemId && matchingLines.length > 1) {
        throw new AppError('حدد سطر فاتورة الشراء الأصلي للصنف المتكرر', 'PURCHASE_ITEM_ID_REQUIRED', 400);
      }
      const purchaseItem = requestItem.purchaseItemId
        ? matchingLines.find((entry) => Number(entry.id) === requestItem.purchaseItemId)
        : matchingLines[0];
      if (!purchaseItem) throw new AppError('Return item not found', 'NOT_FOUND', 404);
      const purchaseLineId = Number(purchaseItem.id);
      // Traceable supplier returns reconcile serials and batches below in the
      // SAME stock transaction. The generic quantity-only guard must not block
      // this explicitly reconciled path.
      if (originalTaxCents > 0 && unreconciledTaxLineIds.has(purchaseLineId)) {
        throw new AppError('مرتجع شراء سابق يحتاج تسوية ضريبية قبل مرتجع جديد', 'PURCHASE_RETURN_TAX_RECONCILIATION_REQUIRED', 409);
      }
      if (legacyReturnedProducts.has(requestItem.productId)) {
        throw new AppError('مرتجع شراء سابق بلا ربط بسطر الفاتورة يحتاج تسوية أولاً', 'PURCHASE_RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      const purchasedForProduct = matchingLines.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByProduct.get(requestItem.productId) || 0),
        returnedQtyByProduct.get(requestItem.productId) || 0,
        purchasedForProduct,
      );
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByLine.get(purchaseLineId) || 0),
        returnedQtyByLine.get(purchaseLineId) || 0,
        Number(purchaseItem.qty || 0),
      );
      pendingQtyByProduct.set(requestItem.productId, (pendingQtyByProduct.get(requestItem.productId) || 0) + requestItem.qty);
      pendingQtyByLine.set(purchaseLineId, (pendingQtyByLine.get(purchaseLineId) || 0) + requestItem.qty);

      const availableQty = await previewConsumableStockQty(trx, { productId: requestItem.productId, branchId: purchase.branch_id, locationId: purchaseItem.location_id ?? purchase.location_id, tenantId: scope.tenantId, accountId: scope.accountId });
      const product = await trx.selectFrom('products').select(['id', 'stock_qty', 'track_serials', 'cost_price'])
        .where('id', '=', requestItem.productId).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const sourceTax = taxByLine.get(purchaseLineId) || 0;
      const sourceGross = Number(purchaseItem.line_total || 0) + (purchase.prices_include_tax ? 0 : sourceTax);
      const preparedLine = buildPurchaseReturnLine({ ...purchaseItem, line_total: sourceGross, allocated_tax: sourceTax }, { ...product, stock_qty: availableQty }, requestItem, {
        qty: returnedQtyByLine.get(purchaseLineId) || 0,
        amount: returnedAmountByLine.get(purchaseLineId) || 0,
        tax: returnedTaxByLine.get(purchaseLineId) || 0,
      }, moneyDigits);

      // The serial ledger and general stock ledger must leave the warehouse together.
      const itemLocationId = purchaseItem.location_id ?? purchase.location_id;
      // A purchased serial moved to another warehouse is no longer returnable
      // from this line's source location, even if its status is still in_stock.
      let serialQuery = trx.selectFrom('product_serials')
        .select(['id', 'serial_number', 'imei_2', 'status'])
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', requestItem.productId)
        .where('purchase_id', '=', Number(purchase.id)).where('purchase_item_id', '=', purchaseLineId)
        .where('status', '=', 'in_stock');
      serialQuery = itemLocationId == null ? serialQuery.where('location_id', 'is', null)
        : serialQuery.where('location_id', '=', itemLocationId);
      serialQuery = purchase.branch_id == null ? serialQuery.where('branch_id', 'is', null)
        : serialQuery.where('branch_id', '=', purchase.branch_id);
      const purchaseSerials = await serialQuery.orderBy('id', 'asc').forUpdate().execute();
      // Legacy products may have existing serial rows without track_serials set.
      // Do not silently treat their remaining stock as untracked.
      const anySerial = await trx.selectFrom('product_serials').select('id')
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', requestItem.productId)
        .limit(1).executeTakeFirst();
      if (product.track_serials === true || anySerial) {
        const chosen = selectPurchaseReturnSerials(purchaseSerials, requestItem.serials, preparedLine.stockDelta);
        await trx.updateTable('product_serials')
          .set({ status: 'returned', updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', chosen.map(row => row.id)).execute();
      } else if (requestItem.serials?.length) {
        throw new AppError('لا توجد سيريالات مرتبطة بسطر فاتورة الشراء', 'PURCHASE_RETURN_SERIAL_NOT_AVAILABLE', 400);
      }

      // Drug lots are a separate quantity ledger. Never deduct product stock without
      // deducting the corresponding unexpired/held lot from the same location.
      const drug = await trx.selectFrom('pharmacy_drugs').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId).executeTakeFirst();
      const anyBatch = await trx.selectFrom('pharmacy_batches').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId).limit(1).executeTakeFirst();
      if (drug || anyBatch) {
        const sourceBatchNumber = String(purchaseItem.batch_number || '').trim();
        if (!sourceBatchNumber) {
          throw new AppError('تشغيلة بند الشراء غير محفوظة؛ لا يمكن إرجاع كمية دوائية دون مصالحة',
            'PURCHASE_RETURN_BATCH_PROVENANCE_REQUIRED', 409);
        }
        let batchQuery = trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'batch_number'])
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', requestItem.productId);
        batchQuery = itemLocationId == null ? batchQuery.where('location_id', 'is', null)
          : batchQuery.where('location_id', '=', itemLocationId);
        const batches = await batchQuery.orderBy('id', 'asc').forUpdate().execute();
        const batch = selectPurchaseReturnBatch(batches, requestItem.batchId, preparedLine.stockDelta);
        if (String(batch.batch_number || '').trim() !== sourceBatchNumber) {
          throw new AppError('تشغيلة المرتجع لا تطابق تشغيلة فاتورة الشراء الأصلية',
            'PURCHASE_RETURN_BATCH_ORIGIN_MISMATCH', 409);
        }
        await trx.updateTable('pharmacy_batches')
          .set({ quantity: Number((Number(batch.quantity) - preparedLine.stockDelta).toFixed(3)), updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', batch.id).execute();
      } else if (requestItem.batchId) {
        throw new AppError('الصنف ليس دواءً مسجلاً بتشغيلة', 'PURCHASE_RETURN_BATCH_NOT_APPLICABLE', 400);
      }

      const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: -preparedLine.stockDelta, branchId: purchase.branch_id, locationId: itemLocationId, tenantId: scope.tenantId, accountId: scope.accountId, errorCode: 'PURCHASE_RETURN_STOCK_INVALID', errorMessage: 'Invalid stock for purchase return', disableAutoDrain: true });
      // INV-PURCHASE-RETURN-ORIGINAL-COST: cost the return at the ORIGINAL
      // purchase line's net cost, not the current product WAC. The return is
      // lot-identified (purchase_item_id, plus serial/batch provenance where
      // applicable), so it reverses that purchase; costing it at a later
      // WAC would dump the whole WAC drift into the 5190 variance account.
      // The same original cost feeds both the stock movement and the
      // return_items.cost_price that postPurchaseReturn journals from, so
      // the movement and the GL inventory leg cannot diverge.
      const originalCost = originalPurchaseReturnUnitCost({
        unitCost: (purchaseItem as any).unit_cost,
        unitMultiplier: (purchaseItem as any).unit_multiplier,
        taxRate: (purchase as any).tax_rate,
        pricesIncludeTax: (purchase as any).prices_include_tax,
      });
      await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'purchase_return', qty: -preparedLine.stockDelta, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: originalCost.perBaseUnit, total_cost: roundBookMoney(preparedLine.stockDelta * originalCost.perBaseUnit, moneyDigits), reason: 'purchase_return', note: 'purchase return PUR-' + String(purchase.id), reference_type: 'purchase_return', reference_id: Number(payload.invoiceId), branch_id: purchase.branch_id, location_id: itemLocationId, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
      // INV-PURCHASE-RETURN-WAC-RECOMPUTE: the return leaves at the
      // ORIGINAL cost, so re-blend the remaining pool at that cost in
      // the SAME transaction. Without this, the GL inventory leg
      // (original cost) and the physical pool (qty * cost_price)
      // diverge by the whole WAC drift. The subtracted value is the
      // line's GL inventory credit at book digits (sold qty x original
      // per-sold-unit cost), exactly what postPurchaseReturn sums from
      // return_items — not the stock movement's per-base-unit total,
      // which can differ by rounding dust when a unit multiplier
      // applies. Never in postPurchaseReturn: recovery re-posts
      // journals for already-created documents and must never
      // reprice stock twice.
      await revalueStockReturn(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, preparedLine.stockDelta, roundBookMoney(preparedLine.qty * originalCost.perSoldUnit, moneyDigits));
      normalizedLines.push({ productId: preparedLine.productId, productName: preparedLine.productName, qty: preparedLine.qty, unitTotal: preparedLine.unitTotal, lineTotal: preparedLine.lineTotal, allocatedTax: preparedLine.allocatedTax, costPrice: originalCost.perSoldUnit, purchaseItemId: purchaseLineId });
    }

    const total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    if (!(total > 0)) throw new AppError('مرتجع الشراء يجب أن تكون قيمته موجبة', 'PURCHASE_RETURN_AMOUNT_INVALID', 400);
    const refundMethod = payload.refundMethod === 'card' ? 'card' : 'cash';
    // Supplier payments may have already settled part of an originally credit invoice.
    // Never reverse more payable than both the invoice remainder and supplier balance.
    // Only the excess is a real cash/bank refund, not a negative supplier payable.
    let payableCents = 0;
    if (purchase.payment_type === 'credit' && purchase.supplier_id) {
      const supplier = await trx.selectFrom('suppliers').select(['balance']).where('id', '=', Number(purchase.supplier_id))
        .where(this.tenantPredicate(auth)).forUpdate().executeTakeFirstOrThrow();
      const priorReturns = await trx.selectFrom('return_documents')
        .select(['total', 'refund_allocations'])
        .where('return_type', '=', 'purchase').where('invoice_id', '=', Number(purchase.id))
        .where(this.tenantPredicate(auth)).execute();
      // A previous partial return may have been settled BOTH by reducing the
      // payable and by a bank/cash refund. Only its payable leg reduces the
      // remaining invoice debt; subtracting its entire gross value understates it.
      let priorPayableCents = 0;
      for (const prior of priorReturns) {
        const rawAllocations: unknown = typeof prior.refund_allocations === 'string'
          ? JSON.parse(prior.refund_allocations) : prior.refund_allocations;
        if (Array.isArray(rawAllocations)) {
          for (const allocation of rawAllocations) {
            if (allocation?.tender === 'payable') {
              const cents = Math.round(Number(allocation.amount) * scale);
              if (!Number.isSafeInteger(cents) || cents < 0) {
                throw new AppError('تسوية مرتجع شراء سابقة غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED', 409);
              }
              priorPayableCents += cents;
            }
          }
        } else if (rawAllocations == null) {
          // The legacy credit-return flow reversed the entire document against
          // supplier payables without storing a tender breakdown.
          priorPayableCents += Math.round(Number(prior.total || 0) * scale);
        } else {
          throw new AppError('تسوية مرتجع شراء سابقة غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED', 409);
        }
      }
      const scheduledPayments = await trx.selectFrom('supplier_payment_schedules')
        .select(sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'))
        .where('purchase_id', '=', Number(purchase.id)).where(this.tenantPredicate(auth))
        .executeTakeFirst();
      const scheduledPaidCents = Math.round(Number(scheduledPayments?.paid || 0) * scale);
      const unpaidInvoiceCents = Math.max(0,
        Math.round((Number(purchase.total || 0) - Number(purchase.paid_amount || 0)) * scale) - priorPayableCents - scheduledPaidCents);
      const supplierOutstandingCents = Math.max(0, Math.round(Number(supplier.balance || 0) * scale));
      payableCents = Math.min(Math.round(total * scale), unpaidInvoiceCents, supplierOutstandingCents);
    }
    const refundCents = Math.round(total * scale) - payableCents;
    const allocations: Array<{ tender: 'payable' | 'cash' | 'card'; amount: number }> = [];
    if (payableCents > 0) allocations.push({ tender: 'payable', amount: payableCents / scale });
    if (refundCents > 0) allocations.push({ tender: refundMethod, amount: refundCents / scale });
    const { id: returnDocumentId, docNo: returnDocNo } = await this.insertReturnDocument(trx, {
      returnType: 'purchase', invoiceId: Number(payload.invoiceId), settlementMode: 'refund',
      refundMethod: allocations.length > 1 ? 'mixed' : allocations[0].tender,
      refundAllocations: allocations, total, note: String(payload.note || '').trim(),
      branchId: purchase.branch_id, locationId: purchase.location_id,
    }, auth);
    for (const line of normalizedLines) await this.insertReturnItem(trx, { returnDocumentId, productId: line.productId, productName: line.productName, qty: line.qty, unitTotal: line.unitTotal, lineTotal: line.lineTotal, allocatedTax: line.allocatedTax, costPrice: line.costPrice, purchaseItemId: line.purchaseItemId }, auth);
    if (payableCents > 0 && purchase.supplier_id) {
      await this.addSupplierLedgerEntry(trx, Number(purchase.supplier_id), -(payableCents / scale), 'purchase_return', 'purchase return ' + returnDocNo, returnDocumentId, auth, purchase.branch_id, purchase.location_id);
    }
    if (refundCents > 0) await this.addTreasuryTransaction(trx, 'purchase_return_refund', refundCents / scale, 'purchase return ' + returnDocNo, returnDocumentId, auth, purchase.branch_id, purchase.location_id, refundMethod === 'cash');

    try {
      const posting = await this.accountingPosting.postPurchaseReturn(trx, returnDocumentId, auth);
      if (!posting.journalEntryId) throw new Error(`Purchase return ${returnDocumentId} has no journal entry`);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Failed to post accounting journal for purchase return',
        'PURCHASE_RETURN_ACCOUNTING_POST_FAILED',
        500,
      );
    }

    return [returnDocumentId];
  }
}
