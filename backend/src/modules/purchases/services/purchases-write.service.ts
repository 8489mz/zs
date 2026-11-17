import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { assertUntrackedStockMutation } from '../../inventory/helpers/inventory-tracked-stock.helper';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { purchaseReceiptBaseUnitCost } from '../engines/purchase-receipt-cost.engine';
import { advancePurchaseOrderReceipt } from '../engines/purchase-order-receipt.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { checkClientBusinessDay, CLIENT_BUSINESS_DATE_FUTURE_DAYS } from '../../../common/utils/client-date-bounds.util';
import { ensureNonNegativeStock } from '../../../common/utils/financial-integrity';
import { applyStockDelta, lockStockProducts, previewConsumableStockQty } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { ApplySupplierAdvanceDto, CreateCustomerPaymentDto, CreateSupplierPaymentDto } from '../dto/create-party-payment.dto';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import { allocatePurchaseInvoiceDiscount, buildHistoricCostMap, buildNormalizedPurchaseItem, buildPurchaseReferenceNote, calculatePurchaseStockDecrease, calculatePurchaseStockIncrease, assertNonCashTransferReference, normalizeInstapayAddress, normalizeOptionalNote, normalizePurchaseScope, normalizeTransferReference } from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { PurchasesQueryService } from './purchases-query.service';
import { PurchasesWriteSupplierPaymentsService } from './purchases-write-supplier-payments.service';
import { PurchasesWriteCancelService } from './purchases-write-cancel.service';
import { PurchasesWriteUpdateService } from './purchases-write-update.service';
import { PurchasesWriteCreateService } from './purchases-write-create.service';
import { PurchasesWriteSharedHelpersService } from './purchases-write-shared-helpers.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { PurchasesWriteRepricingService } from './purchases-write-repricing.service';
import { detectDuplicateBills, normalizeBillNumber, type HistoricalPurchaseRecord } from '../engines/duplicate-bill-detector.engine';
import { assertCustomerPaymentJobOwnership } from '../helpers/customer-payment-job-ownership';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export type {
  PurchaseRepricingCandidate,
  PurchaseRepricingProduct,
  PurchaseRepricingInsights,
} from './purchases-write.types';

@Injectable()
export class PurchasesWriteService {
  private readonly supplierPaymentsService: PurchasesWriteSupplierPaymentsService;

  private readonly cancelService: PurchasesWriteCancelService;

  private readonly updateService: PurchasesWriteUpdateService;

  private readonly createService: PurchasesWriteCreateService;

  private readonly sharedHelpersService: PurchasesWriteSharedHelpersService;

  private readonly repricing: PurchasesWriteRepricingService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly financeService: PurchasesFinanceService,
    private readonly queryService: PurchasesQueryService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
  ) {
    this.repricing = new PurchasesWriteRepricingService();
    this.sharedHelpersService = new PurchasesWriteSharedHelpersService({
      db: this.db,
      queryService: this.queryService,
    });
    this.createService = new PurchasesWriteCreateService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
      idempotency: this.idempotency,
      buildPurchaseRepricingCandidate: this.buildPurchaseRepricingCandidate.bind(this),
      buildPurchaseRepricingInsights: this.buildPurchaseRepricingInsights.bind(this),
      hasPermission: this.hasPermission.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.updateService = new PurchasesWriteUpdateService({
      db: this.db,
      tx: this.tx,
      financeService: this.financeService,
      audit: this.audit,
      buildPurchaseRepricingCandidate: this.buildPurchaseRepricingCandidate.bind(this),
      buildPurchaseRepricingInsights: this.buildPurchaseRepricingInsights.bind(this),
      assertManagerApprovalForPurchaseChange: this.assertManagerApprovalForPurchaseChange.bind(this),
      hasPermission: this.hasPermission.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.cancelService = new PurchasesWriteCancelService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      accountingPosting: this.accountingPosting,
      assertManagerApprovalForPurchaseChange: this.assertManagerApprovalForPurchaseChange.bind(this),
      buildPurchaseMutationResponse: this.buildPurchaseMutationResponse.bind(this),
    });
    this.supplierPaymentsService = new PurchasesWriteSupplierPaymentsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      financeService: this.financeService,
      queryService: this.queryService,
      accountingPosting: this.accountingPosting,
      idempotency: this.idempotency,
    });
  }

  private hasPermission(auth: AuthContext, permission: string): boolean {
    return this.sharedHelpersService.hasPermission(auth, permission);
  }

  private async assertManagerApprovalForPurchaseChange(secret: string, auth: AuthContext): Promise<void> {
    return this.sharedHelpersService.assertManagerApprovalForPurchaseChange(secret, auth);
  }

  private buildPurchaseRepricingCandidate(product: PurchaseRepricingProduct, newCost: number): PurchaseRepricingCandidate {
    return this.repricing.buildPurchaseRepricingCandidate(product, newCost);
  }

  private buildPurchaseRepricingInsights(
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits: 2 | 3 = 2,
  ): PurchaseRepricingInsights | null {
    return this.repricing.buildPurchaseRepricingInsights(purchaseId, supplier, candidates, moneyDigits);
  }

  private async buildPurchaseMutationResponse(
    purchaseId: number,
    auth: AuthContext,
    extras: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.sharedHelpersService.buildPurchaseMutationResponse(purchaseId, auth, extras);
  }

  async createPurchase(payload: UpsertPurchaseDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.createService.createPurchase(payload, auth, idempotencyKey);
  }

  async updatePurchase(purchaseId: number, payload: UpsertPurchaseDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.updateService.updatePurchase(purchaseId, payload, auth);
  }

  async cancelPurchase(purchaseId: number, reason: string, auth: AuthContext, managerPin?: string): Promise<Record<string, unknown>> {
    return this.cancelService.cancelPurchase(purchaseId, reason, auth, managerPin);
  }

  async createSupplierPayment(payload: CreateSupplierPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.supplierPaymentsService.createSupplierPayment(payload, auth, idempotencyKey);
  }

  async applySupplierAdvance(advancePaymentId: number, payload: ApplySupplierAdvanceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.supplierPaymentsService.applySupplierAdvance(advancePaymentId, payload, auth);
  }

  async createCustomerPayment(payload: CreateCustomerPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const amount = Number(payload.amount);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
      throw new AppError('Customer payment must be positive and have at most tenant currency minor-unit precision', 'INVALID_PAYMENT_AMOUNT', 400);
    }
    // INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: the gate
    // runs AFTER reserveOperation and INSIDE the try. Refusing before
    // the reservation left no operation_executions row, so the
    // frontend could never learn the attempt had failed (server
    // status 'not_found') and its stored attempt deadlocked the form
    // forever. A 4xx rejection now writes a 'failed' row via the
    // catch below, and the frontend 'failed' branch releases the
    // stored attempt so the cashier can correct and resend. Cash
    // receipts are untouched; the gate itself is unchanged.
    const operationType = 'customer_payment_create';
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        const recorded = existing.responsePayload as Record<string, unknown> | undefined;
        if (recorded?.id) return { ok: true, ...recorded };
        throw new AppError('Customer payment result requires reconciliation', 'PAYMENT_RECOVERY_REQUIRED', 422);
      }
      if (existing?.status === 'processing') throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed') throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required') throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
    assertNonCashTransferReference(payload.paymentChannel, payload.transferReference);
    const paymentResult = await this.tx.runInTransaction(this.db, async (trx) => {
      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'balance'])
        .where('id', '=', payload.customerId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

      const currentBalance = Number(customer.balance || 0);
      const { branchId, locationId } = normalizePurchaseScope(payload);

      let targetJobId: number | null = payload.jobId ? Number(payload.jobId) : null;

      // Explicit payment-to-job linkage must be verified before the receipt or ledger is posted.
      // Auto-match jobs are also checked under the same lock, so concurrent receipts cannot
      // overwrite client_paid_total using a stale snapshot.
      let verifiedJob: { job_number: string | null; client_invoiced_total: number | string | null; client_paid_total: number | string | null } | null = null;

      // Smart Auto-Match: If no explicit job specified, check if customer has exactly ONE active maritime job needing payment
      if (!targetJobId) {
        try {
          const activeJobs = await trx
            .selectFrom('maritime_jobs')
            .select(['id', 'job_number', 'client_invoiced_total', 'client_paid_total', 'payment_status'])
            .where('tenant_id', '=', scope.tenantId)
            .where('customer_id', '=', customer.id)
            .where('status', '=', 'active')
            .where('payment_status', '!=', 'paid')
            .execute();

          if (activeJobs.length === 1) {
            targetJobId = Number(activeJobs[0].id);
          }
        } catch {
          // Ignore if table not ready
        }
      }

      if (targetJobId) {
        const job = await trx
          .selectFrom('maritime_jobs')
          .select(['id', 'job_number', 'customer_id', 'client_invoiced_total', 'client_paid_total'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', String(targetJobId))
          .forUpdate()
          .executeTakeFirst();
        if (!job) throw new AppError('Maritime job not found', 'MARITIME_JOB_NOT_FOUND', 404);
        assertCustomerPaymentJobOwnership(Number(customer.id), job.customer_id);
        verifiedJob = job;
      }

      const insert = await trx
        .insertInto('customer_payments')
        .values({
          customer_id: customer.id,
          amount,
          payment_channel: payload.paymentChannel || 'cash',
          instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress),
          transfer_reference: normalizeTransferReference(payload.paymentChannel, payload.transferReference),
          note: normalizeOptionalNote(payload.note),
          branch_id: branchId,
          location_id: locationId,
          job_id: targetJobId || null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const paymentId = Number(insert.id);
      const paymentNote = normalizeOptionalNote(payload.note);
      const isAdvance = currentBalance <= 0;
      const isOverpayment = currentBalance > 0 && amount > currentBalance;
      const descPrefix = isAdvance
        ? `دفعة مقدمة / عربون من العميل ${customer.name}`
        : isOverpayment
          ? `تحصيل وسداد مع دفعة مقدمة من العميل ${customer.name}`
          : `تحصيل من العميل ${customer.name}`;

      const fullDesc = `${descPrefix}${paymentNote ? ` - ${paymentNote}` : ''}`;
      await this.financeService.addCustomerLedgerEntry(trx, customer.id, -amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId);
      await this.financeService.addTreasuryTransaction(trx, 'customer_payment', amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId, payload.paymentChannel || 'cash');
      const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth);
      if (!posting.journalEntryId) throw new AppError(`Customer payment ${paymentId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);

      const docNo = await this.generateCustomerPaymentDocNo(trx, scope.tenantId, paymentId);

      let allocatedJobNumber: string | null = null;
      if (verifiedJob && targetJobId) {
        allocatedJobNumber = verifiedJob.job_number;
        const currentPaid = Number(verifiedJob.client_paid_total || 0);
        const newPaid = currentPaid + amount;
        const invoiced = Number(verifiedJob.client_invoiced_total || 0);
        const newPaymentStatus = (invoiced > 0 && newPaid >= invoiced) ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'unpaid');

        await trx
          .updateTable('maritime_jobs')
          .set({
            client_paid_total: newPaid,
            payment_status: newPaymentStatus,
            paid_at: newPaymentStatus === 'paid' ? sql`NOW()` : null,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', String(targetJobId))
          .where('tenant_id', '=', scope.tenantId)
          .where('customer_id', '=', customer.id)
          .execute();

        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: scope.tenantId,
            job_id: String(targetJobId),
            milestone_key: 'PAYMENT',
            milestone_title: `سداد مالي: سند قبض #${docNo} (${newPaymentStatus === 'paid' ? 'مسدد بالكامل' : 'سداد جزئي'})`,
            location: 'الخزينة والحسابات',
            notes: `تم ربط وتخصيص دفعة نقدية بقيمة ${amount} ج.م من سند القبض ${docNo} للشحنة ${verifiedJob.job_number}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          } as any)
          .execute();
      }

      const receipt = {
        id: paymentId,
        docNo,
        customerId: customer.id,
        customerName: customer.name,
        amount,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance - amount,
        note: paymentNote,
        jobId: targetJobId,
        jobNumber: allocatedJobNumber,
        createdAt: new Date().toISOString(),
      };
      // The audit record is part of the same atomic voucher transaction; an
      // audit failure cannot turn an already-posted payment into an HTTP failure.
      await this.audit.logWithExecutor(trx, 'سند قبض / تحصيل عميل',
        `تم تسجيل سند قبض ${docNo} للعميل ${customer.name} بمبلغ ${amount} بواسطة ${auth.username}`, auth);
      // Commit the operation and the financial voucher in the SAME DB transaction.
      if (idempotencyKey) {
        await this.idempotency.commitOperation(trx, {
          tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        }, receipt, String(paymentId));
      }
      return receipt;
    });

    return { ok: true, ...paymentResult };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency.recordFailure({
            tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
          }, error.code).catch(() => undefined);
        } else {
          await this.db.updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId).where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey).where('operation_type', '=', operationType)
            .where('status', '=', 'processing').where('document_id', 'is', null).execute().catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async generateCustomerPaymentDocNo(trx: Kysely<Database>, tenantId: string, paymentId: number): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `REC-${datePrefix}-${seq}`;
  }

  async receivePurchaseGoods(
    purchaseId: number,
    receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[],
    auth: AuthContext,
  ): Promise<{ purchaseId: number; lifecycleStatus: string; matchedStatus: string }> {
    const scope = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const purchase = await trx
        .selectFrom('purchases')
        .selectAll()
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();

      if (!purchase) {
        throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      }

      if (purchase.status === 'cancelled') {
        throw new AppError('Cannot receive goods for a cancelled purchase', 'PURCHASE_CANCELLED', 400);
      }
      if (purchase.grn_id || purchase.po_id) {
        if (purchase.po_id) {
          await trx.selectFrom('purchase_orders').select('id')
            .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(purchase.po_id))
            .forUpdate().executeTakeFirstOrThrow();
        }
        const postedReceipt = purchase.grn_id
          ? await trx.selectFrom('goods_receipt_notes').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(purchase.grn_id))
            .forUpdate().executeTakeFirst()
          : await trx.selectFrom('goods_receipt_notes').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId).where('purchase_order_id', '=', Number(purchase.po_id))
            .where('status', '=', 'posted').limit(1).executeTakeFirst();
        if (postedReceipt?.status === 'posted') {
          throw new AppError('The linked GRN already posted stock; receiving this bill would post it twice', 'PURCHASE_STOCK_ALREADY_RECEIVED', 409);
        }
      }

      const existingItems = await trx
        .selectFrom('purchase_items')
        .selectAll()
        .where('purchase_id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      const itemsMap = new Map<number, any>();
      for (const it of existingItems) {
        itemsMap.set(Number(it.id), it);
      }

      if (!receivedItems.length) throw new AppError('Receipt must contain at least one line', 'PURCHASE_RECEIPT_EMPTY', 400);
      const seenItemIds = new Set<number>();
      let receiptQty = 0;
      for (const rec of receivedItems) {
        const itemId = Number(rec.itemId);
        const item = itemsMap.get(itemId);
        if (!item) throw new AppError(`Purchase item ${itemId} not found`, 'ITEM_NOT_FOUND', 404);
        if (seenItemIds.has(itemId)) throw new AppError('Duplicate purchase receipt line', 'PURCHASE_RECEIPT_DUPLICATE_LINE', 400);
        seenItemIds.add(itemId);
        const qty = Number(rec.receivedQty);
        const alreadyReceived = Number(item.received_qty || 0);
        const ordered = Number(item.qty || 0);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(ordered) ||
            alreadyReceived + qty > ordered + 0.0001) {
          throw new AppError('Received quantity must be positive and cannot exceed ordered quantity', 'PURCHASE_RECEIPT_QTY_INVALID', 400);
        }
        receiptQty += qty;
      }
      const totalRemaining = existingItems.reduce((sum, item) =>
        sum + Math.max(0, Number(item.qty || 0) - Number(item.received_qty || 0)), 0);
      if (purchase.status === 'draft' && receiptQty + 0.0001 < totalRemaining) {
        throw new AppError('Partial receipts require a GRN so each stock movement has its own accrual journal', 'PURCHASE_PARTIAL_RECEIPT_REQUIRES_GRN', 422);
      }

      await lockStockProducts(trx, {
        ...scope,
        productIds: receivedItems.map((rec) => Number(itemsMap.get(rec.itemId)?.product_id)),
      });

      for (const rec of [...receivedItems].sort((a, b) => Number(itemsMap.get(a.itemId)?.product_id || 0) - Number(itemsMap.get(b.itemId)?.product_id || 0))) {
        const item = itemsMap.get(rec.itemId);
        if (!item) {
          throw new AppError(`Purchase item ${rec.itemId} not found`, 'ITEM_NOT_FOUND', 404);
        }

        const qtyToReceive = Number(rec.receivedQty || 0);
        const currentReceived = Number(item.received_qty || 0);
        const newReceivedQty = currentReceived + qtyToReceive;
        const unitMultiplier = Number(item.unit_multiplier ?? 1);
        const effectiveUnitCost = purchaseReceiptBaseUnitCost(
          Number(item.unit_cost), unitMultiplier, Number(purchase.tax_rate || 0), Boolean(purchase.prices_include_tax),
        );

        await trx
          .updateTable('purchase_items')
          .set({ received_qty: newReceivedQty } as any)
          .where('id', '=', item.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        item.received_qty = newReceivedQty;

        const itemSerials = Array.isArray(rec.serials) ? rec.serials : [];
        if (itemSerials.length > 0) {
          const serialRows = itemSerials.map((s: any) => {
            const serialNumber = typeof s === 'string' ? s.trim() : (s?.serialNumber || s?.serial || '').trim();
            const imei2 = typeof s === 'object' ? s?.imei2 || null : null;
            return {
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              product_id: item.product_id,
              serial_number: serialNumber,
              imei_2: imei2,
              branch_id: purchase.branch_id ?? null,
              location_id: item.location_id ?? purchase.location_id,
              status: 'in_stock' as const,
              cost_price: Number(effectiveUnitCost.toFixed(6)),
              purchase_id: purchaseId,
              purchase_item_id: item.id,
              warranty_end_date: null,
              notes: null,
            };
          }).filter((r) => r.serial_number);

          if (serialRows.length > 0) {
            await trx.insertInto('product_serials').values(serialRows as any).execute();
          }
        }

        const { increasedQty } = calculatePurchaseStockIncrease(qtyToReceive, unitMultiplier, 0);
        const itemLocationId = item.location_id ?? purchase.location_id;
        const branchId = purchase.branch_id;

        const stockChange = await applyStockDelta(trx, {
          productId: Number(item.product_id),
          delta: increasedQty,
          branchId: branchId ? Number(branchId) : undefined,
          locationId: itemLocationId ? Number(itemLocationId) : undefined,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });

        // INV-WAC-SINGLE-WRITER: every receipt blends through the one
        // writer (quantity recovery + algebraic blend + write). A
        // zero-quantity line writes nothing: no receipt to blend and
        // the stored cost is unchanged. The product row is locked by
        // the stock delta above, so the writer's read cannot miss it.
        if (increasedQty > 0) {
          await valueStockReceipt(trx, scope.tenantId, item.product_id, stockChange.globalAfter, increasedQty, increasedQty * effectiveUnitCost);
        }

        await trx.insertInto('stock_movements').values({
          product_id: item.product_id,
          movement_type: 'purchase_receipt',
          qty: increasedQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          unit_cost: Number(effectiveUnitCost.toFixed(6)),
          total_cost: roundMoney(effectiveUnitCost * increasedQty, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId))),
          reason: 'purchase_receipt',
          note: `استلام بضاعة لأمر شراء PUR-${purchaseId}`,
          reference_type: 'purchase',
          reference_id: purchaseId,
          branch_id: branchId ? Number(branchId) : undefined,
          location_id: itemLocationId ? Number(itemLocationId) : undefined,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any).execute();
      }

      // INV-PO-RECEIVED-QUANTITY-ADVANCE: reflect this receipt on its
      // purchase order in the same transaction, after every stock write
      // above succeeded, so a failed receipt advances nothing. The advance
      // is in purchase-item units (qtyToReceive), not base stock units:
      // the PO item quantity and the bill item quantity share those units.
      const receivedByPoItem = new Map<number, number>();
      let hasLinkedItem = false;
      for (const rec of receivedItems) {
        const item = itemsMap.get(Number(rec.itemId));
        const poItemId = item?.po_item_id ? Number(item.po_item_id) : 0;
        if (poItemId > 0) {
          hasLinkedItem = true;
          receivedByPoItem.set(poItemId, Number(((receivedByPoItem.get(poItemId) || 0) + Number(rec.receivedQty || 0)).toFixed(3)));
        }
      }
      if (hasLinkedItem && !purchase.po_id) {
        throw new AppError(
          'بند فاتورة مرتبط بأمر شراء دون ارتباط الفاتورة نفسها بأمر الشراء؛ تعذر تحديث الكمية المستلمة',
          'PO_RECEIPT_LINKAGE_INVALID',
          409,
        );
      }
      if (purchase.po_id && receivedByPoItem.size > 0) {
        await advancePurchaseOrderReceipt(
          trx,
          scope.tenantId,
          Number(purchase.po_id),
          [...receivedByPoItem.entries()].map(([poItemId, quantity]) => ({ poItemId, quantity })),
        );
      }

      let totalOrdered = 0;
      let totalReceived = 0;
      for (const it of existingItems) {
        totalOrdered += Number(it.qty || 0);
        totalReceived += Number(it.received_qty || 0);
      }

      const isFullyReceived = totalReceived >= totalOrdered;
      const lifecycleStatus = isFullyReceived ? 'posted' : 'grn_received';
      const matchedStatus = isFullyReceived ? 'matched' : (totalReceived > 0 ? 'partial' : 'pending');

      await trx
        .updateTable('purchases')
        .set({
          lifecycle_status: lifecycleStatus,
          matched_status: matchedStatus,
          status: 'posted',
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      if (purchase.status === 'draft') {
        const total = Number(purchase.total || 0);
        const supplierId = Number(purchase.supplier_id);
        const branchId = purchase.branch_id ? Number(purchase.branch_id) : null;
        const locationId = purchase.location_id ? Number(purchase.location_id) : null;

        if (purchase.payment_type === 'credit') {
          await this.financeService.addSupplierLedgerEntry(
            trx,
            supplierId,
            total,
            'purchase_credit',
            `فاتورة شراء PUR-${purchaseId}`,
            'purchase',
            purchaseId,
            auth,
            branchId,
            locationId,
          );
        } else {
          await this.financeService.addTreasuryTransaction(
            trx,
            'purchase',
            -total,
            `فاتورة شراء PUR-${purchaseId}`,
            'purchase',
            purchaseId,
            auth,
            branchId,
            locationId,
          );
        }

        await this.accountingPosting.postPurchase(trx, purchaseId, auth);
      }

      return { purchaseId, lifecycleStatus, matchedStatus };
    });
  }
}
