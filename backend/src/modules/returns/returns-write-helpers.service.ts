import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { calculateNextLedgerBalance } from './helpers/returns-write.helper';
import { Database } from '../../database/database.types';
import { resolveRequireCashierShiftForSales } from '../sales/services/sales-authorization.service';
import { type ReturnDocumentInput } from './returns.types';

/**
 * ReturnsWriteHelpersService — slice S3 of the returns split.
 * Pure move of the transaction-scoped write helpers from ReturnsService.
 * No behavior change: the bodies are byte-identical except for the forced
 * visibility change below; the facade keeps thin private delegates for
 * the helpers other slices call, with the same names and signatures.
 * This slice reaches the kernel helpers only through bound deps — it
 * never imports another slice service. Every helper takes the open
 * transaction as its first argument and writes through it, never
 * through the pool handle.
 */

export interface ReturnsWriteHelpersDeps {
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };
}

@Injectable()
export class ReturnsWriteHelpersService {
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };

  constructor(deps: ReturnsWriteHelpersDeps) {
    this.scope = deps.scope;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantFields = deps.tenantFields;
  }

  async findOwnOpenShift(
    trx: Kysely<Database>,
    auth: AuthContext,
    branchId: number | null,
  ): Promise<{ id: number; docNo: string } | null> {
    let query = trx
      .selectFrom('cashier_shifts')
      .select(['id', 'doc_no'])
      .where('opened_by', '=', auth.userId)
      .where('status', '=', 'open')
      .where(this.tenantPredicate(auth));
    query = branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', branchId);
    const shift = await query.orderBy('id', 'desc').forUpdate().executeTakeFirst();
    return shift?.id ? { id: Number(shift.id), docNo: shift.doc_no || `SHIFT-${shift.id}` } : null;
  }

  // INV-REST-RETURN-SHIFT-GATE (R7-E, I23 returns half): the cash-refund
  // gate honours requireCashierShiftForSales, read on the transaction
  // handle (never the pool handle inside an open transaction). Only an
  // explicitly-off setting lets a cash refund through without an open
  // shift; true / missing fails closed to the old unconditional rule.
  // The pure resolver is imported, not the sales service: the sales
  // module already uses ReturnsService, so injecting it would cycle.
  async requireCashierShiftForReturns(trx: Kysely<Database>, auth: AuthContext): Promise<boolean> {
    const row = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'requireCashierShiftForSales')
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!row?.value) return true;
    let parsed: unknown = row.value;
    try {
      parsed = JSON.parse(String(row.value));
    } catch {
      // Legacy unquoted value (e.g. false stored as plain text).
    }
    return resolveRequireCashierShiftForSales(new Map([['requireCashierShiftForSales', parsed]]));
  }

  async addTreasuryTransaction(
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund = false,
  ): Promise<void> {
    const currentShift = cashRefund ? await this.findOwnOpenShift(trx, auth, branchId) : null;
    const isPrivileged = ['admin', 'super_admin'].includes(auth.role);
    if (cashRefund && !currentShift && !isPrivileged && (await this.requireCashierShiftForReturns(trx, auth)))
      throw new AppError('يجب فتح وردية على فرع الفاتورة قبل صرف مرتجع نقدي', 'OPEN_SHIFT_REQUIRED', 400);
    await trx
      .insertInto('treasury_transactions')
      .values({
        txn_type: txnType,
        amount,
        note: currentShift ? `${note} - ${currentShift.docNo}` : note,
        reference_type: currentShift ? 'cashier_shift' : 'return_document',
        reference_id: currentShift ? currentShift.id : returnDocumentId,
        return_document_id: returnDocumentId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      })
      .execute();
    if (currentShift) {
      await sql`update cashier_shifts set expected_cash = coalesce(expected_cash, 0) + ${amount}, updated_at = now()
        where id = ${currentShift.id} and tenant_id = ${this.scope(auth).tenantId} and status = 'open'`.execute(trx);
    }
  }

  async addCustomerLedgerEntry(
    trx: Kysely<Database>,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    const customer = await trx
      .selectFrom('customers')
      .select(['balance'])
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .forUpdate()
      .executeTakeFirstOrThrow();
    const balanceAfter = calculateNextLedgerBalance(
      customer.balance,
      amount,
      currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)),
    );
    await trx
      .insertInto('customer_ledger')
      .values({
        customer_id: customerId,
        entry_type: entryType,
        amount,
        balance_after: balanceAfter,
        note,
        reference_type: 'return_document',
        reference_id: returnDocumentId,
        return_document_id: returnDocumentId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      })
      .execute();
    await trx
      .updateTable('customers')
      .set({ balance: balanceAfter, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .execute();
  }

  async addSupplierLedgerEntry(
    trx: Kysely<Database>,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    // Lock supplier ledger balance against concurrent payments and returns.
    const supplier = await trx
      .selectFrom('suppliers')
      .select(['balance'])
      .where('id', '=', supplierId)
      .where(this.tenantPredicate(auth))
      .forUpdate()
      .executeTakeFirstOrThrow();
    const balanceAfter = calculateNextLedgerBalance(
      supplier.balance,
      amount,
      currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)),
    );
    await trx
      .insertInto('supplier_ledger')
      .values({
        supplier_id: supplierId,
        entry_type: entryType,
        amount,
        balance_after: balanceAfter,
        note,
        reference_type: 'return_document',
        reference_id: returnDocumentId,
        return_document_id: returnDocumentId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      })
      .execute();
    await trx
      .updateTable('suppliers')
      .set({ balance: balanceAfter, updated_at: sql`NOW()` })
      .where('id', '=', supplierId)
      .where(this.tenantPredicate(auth))
      .execute();
  }

  async addStoreCredit(trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext): Promise<void> {
    const customer = await trx
      .selectFrom('customers')
      .select(['store_credit_balance'])
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .forUpdate()
      .executeTakeFirstOrThrow();
    const nextBalance = calculateNextLedgerBalance(
      customer.store_credit_balance,
      amount,
      currencyMoneyDigits(await tenantBaseCurrency(trx, this.scope(auth).tenantId)),
    );
    await trx
      .updateTable('customers')
      .set({ store_credit_balance: nextBalance, updated_at: sql`NOW()` })
      .where('id', '=', customerId)
      .where(this.tenantPredicate(auth))
      .execute();
  }

  async restoreReturnedPharmacyBatches(
    trx: Kysely<Database>,
    saleId: number,
    saleItemId: number,
    productId: number,
    previousReturnedBaseQty: number,
    returnBaseQty: number,
    auth: AuthContext,
  ): Promise<void> {
    const scope = this.scope(auth);
    const allocations = await trx
      .selectFrom('sale_pharmacy_batch_allocations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('sale_id', '=', saleId)
      .where('sale_item_id', '=', saleItemId)
      .where('product_id', '=', productId)
      .orderBy('id', 'desc')
      .forUpdate()
      .execute();
    if (!allocations.length) {
      const drug = await trx
        .selectFrom('pharmacy_drugs')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .executeTakeFirst();
      const anyBatch = await trx
        .selectFrom('pharmacy_batches')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .limit(1)
        .executeTakeFirst();
      if (drug || anyBatch) {
        throw new AppError(
          'الفاتورة بلا تخصيص تشغيلة رغم وجود سجل تشغيلات للصنف؛ يلزم مصالحة قبل المرتجع',
          'PHARMACY_BATCH_RECONCILIATION_REQUIRED',
          422,
        );
      }
      return;
    }
    let skip = Number(previousReturnedBaseQty.toFixed(3));
    let remaining = Number(returnBaseQty.toFixed(3));
    const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    for (const allocation of allocations) {
      const sold = Number(allocation.quantity);
      const previouslyRestored = Math.min(sold, skip);
      skip = Number((skip - previouslyRestored).toFixed(3));
      const restore = Math.min(Number((sold - previouslyRestored).toFixed(3)), remaining);
      if (restore <= 0) continue;
      const batch = await trx
        .selectFrom('pharmacy_batches')
        .select(['id', 'quantity', 'expiry_date'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(allocation.pharmacy_batch_id))
        .forUpdate()
        .executeTakeFirstOrThrow();
      const expiry = String(batch.expiry_date || '').slice(0, 10);
      const expired = !expiry || (expiry.length === 7 ? expiry < today.slice(0, 7) : expiry < today);
      await trx
        .updateTable('pharmacy_batches')
        .set({
          quantity: Number((Number(batch.quantity) + restore).toFixed(3)),
          status: expired ? 'expired' : 'active',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(batch.id))
        .execute();
      remaining = Number((remaining - restore).toFixed(3));
      if (remaining <= 0) break;
    }
    if (remaining > 0)
      throw new AppError('كمية المرتجع تتجاوز التشغيلة المباعة', 'PHARMACY_BATCH_RETURN_EXCEEDED', 422);
  }

  /**
   * INV-VAN-GENERIC-FEFO: mirror of restoreReturnedPharmacyBatches over
   * the generic ledger. One difference: a NULL-expiry batch is never
   * expired — it restores to 'active', never to 'expired'.
   */
  async restoreReturnedInventoryBatches(
    trx: Kysely<Database>,
    saleId: number,
    saleItemId: number,
    productId: number,
    previousReturnedBaseQty: number,
    returnBaseQty: number,
    auth: AuthContext,
  ): Promise<void> {
    const scope = this.scope(auth);
    const allocations = await trx
      .selectFrom('sale_inventory_batch_allocations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('sale_id', '=', saleId)
      .where('sale_item_id', '=', saleItemId)
      .where('product_id', '=', productId)
      .orderBy('id', 'desc')
      .forUpdate()
      .execute();
    if (!allocations.length) {
      const anyBatch = await trx
        .selectFrom('inventory_batches')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .limit(1)
        .executeTakeFirst();
      if (anyBatch) {
        throw new AppError(
          'الفاتورة بلا تخصيص تشغيلة رغم وجود سجل تشغيلات للصنف؛ يلزم مصالحة قبل المرتجع',
          'INVENTORY_BATCH_RECONCILIATION_REQUIRED',
          422,
        );
      }
      return;
    }
    let skip = Number(previousReturnedBaseQty.toFixed(3));
    let remaining = Number(returnBaseQty.toFixed(3));
    const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    for (const allocation of allocations) {
      const sold = Number(allocation.quantity);
      const previouslyRestored = Math.min(sold, skip);
      skip = Number((skip - previouslyRestored).toFixed(3));
      const restore = Math.min(Number((sold - previouslyRestored).toFixed(3)), remaining);
      if (restore <= 0) continue;
      const batch = await trx
        .selectFrom('inventory_batches')
        .select(['id', 'quantity', 'expiry_date'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(allocation.inventory_batch_id))
        .forUpdate()
        .executeTakeFirstOrThrow();
      const expiry = String(batch.expiry_date || '').slice(0, 10);
      const expired = expiry ? (expiry.length === 7 ? expiry < today.slice(0, 7) : expiry < today) : false;
      await trx
        .updateTable('inventory_batches')
        .set({
          quantity: Number((Number(batch.quantity) + restore).toFixed(3)),
          status: expired ? 'expired' : 'active',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(batch.id))
        .execute();
      remaining = Number((remaining - restore).toFixed(3));
      if (remaining <= 0) break;
    }
    if (remaining > 0)
      throw new AppError('كمية المرتجع تتجاوز التشغيلة المباعة', 'INVENTORY_BATCH_RETURN_EXCEEDED', 422);
  }

  async generateReturnDocNo(
    trx: Kysely<Database>,
    returnDocId: number,
    returnType: 'sale' | 'purchase',
    auth: AuthContext,
  ): Promise<string> {
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

  async insertReturnDocument(
    trx: Kysely<Database>,
    row: ReturnDocumentInput,
    auth: AuthContext,
  ): Promise<{ id: number; docNo: string }> {
    const scope = this.scope(auth);
    const insert = await trx
      .insertInto('return_documents')
      .values({
        doc_no: 'TMP',
        return_type: row.returnType,
        invoice_id: row.invoiceId,
        settlement_mode: row.settlementMode,
        refund_method: row.refundMethod,
        refund_allocations: row.refundAllocations ? JSON.stringify(row.refundAllocations) : null,
        tip_relief: row.tipRelief ?? null,
        courier_relief: row.courierRelief ?? null,
        forfeited_header_discount: row.forfeitedHeaderDiscount ?? null,
        goodwill_amount: row.goodwillAmount ?? null,
        goodwill_reason: row.goodwillReason ?? null,
        header_discount_mode: row.headerDiscountMode ?? null,
        total: row.total,
        note: row.note,
        branch_id: row.branchId,
        location_id: row.locationId,
        created_by: auth.userId,
        ...this.tenantFields(auth),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const id = Number(insert.id);
    const docNo = await this.generateReturnDocNo(trx, id, row.returnType, auth);
    await trx
      .updateTable('return_documents')
      .set({ doc_no: docNo })
      .where('id', '=', id)
      .where(this.tenantPredicate(auth))
      .execute();
    return { id, docNo };
  }

  async insertReturnItem(
    trx: Kysely<Database>,
    row: {
      returnDocumentId: number;
      productId: number | null;
      productName: string;
      qty: number;
      unitTotal: number;
      lineTotal: number;
      allocatedTax?: number | null;
      costPrice?: number | null;
      saleItemId?: number;
      purchaseItemId?: number;
    },
    auth: AuthContext,
  ): Promise<void> {
    await trx
      .insertInto('return_items')
      .values({
        return_document_id: row.returnDocumentId,
        product_id: row.productId,
        product_name: row.productName,
        qty: row.qty,
        unit_total: row.unitTotal,
        line_total: row.lineTotal,
        allocated_tax: row.allocatedTax ?? null,
        cost_price: row.costPrice ?? null,
        sale_item_id: row.saleItemId,
        purchase_item_id: row.purchaseItemId,
        ...this.tenantFields(auth),
      })
      .execute();
  }

  async getReturnedQty(
    trx: Kysely<Database>,
    returnType: 'sale' | 'purchase',
    invoiceId: number,
    productId: number,
    auth: AuthContext,
    lineItemId?: number,
  ): Promise<number> {
    let query = trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) =>
        join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'))
      .where('rd.return_type', '=', returnType)
      .where('rd.invoice_id', '=', invoiceId)
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'));

    if (lineItemId) {
      query =
        returnType === 'sale'
          ? query.where((eb) =>
              eb.or([
                eb('ri.sale_item_id', '=', lineItemId),
                eb('ri.sale_item_id', 'is', null).and('ri.product_id', '=', productId),
              ]),
            )
          : query.where((eb) =>
              eb.or([
                eb('ri.purchase_item_id', '=', lineItemId),
                eb('ri.purchase_item_id', 'is', null).and('ri.product_id', '=', productId),
              ]),
            );
    } else {
      query = query.where('ri.product_id', '=', productId);
    }

    const result = await query.executeTakeFirst();
    return Number(result?.total_qty || 0);
  }
}
