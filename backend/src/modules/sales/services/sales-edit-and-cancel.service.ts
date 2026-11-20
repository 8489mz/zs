import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { UpsertSaleDto } from '../dto/upsert-sale.dto';
import { AdjustSalePaymentsDto } from '../dto/adjust-sale-payments.dto';
import { calculateCollectibleTotal, calculateRemainingDebt, calculateRestoredStockQuantity, calculateStoreCreditBalance, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, roundSaleResidual } from '../helpers/sales-write.helper';
import { assertSaleNotZatcaSigned } from '../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, negateContribution, tripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { formatCreditLimitExceededMessage } from './credit-limit-message';
import { SalesQueryService } from './sales-query.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { restoreImportLotsFromCancelledSale } from '../../import-sales/helpers/import-lot-allocation.helper';
import { PreparedWasteAndShiftRefreshService } from './sales-edit-and-cancel/prepared-waste-and-shift-refresh.service';
import { AdjustSalePaymentsService } from './sales-edit-and-cancel/adjust-sale-payments.service';
import { UpdateSaleService } from './sales-edit-and-cancel/update-sale.service';
import {
  applyTripCounterDelta,
  lockOpenTripRow,
  type SalesEditAndCancelDeps,
} from './sales-edit-and-cancel/sales-edit-and-cancel-types';




export class SalesEditAndCancelService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly authz: SalesAuthorizationService;
  private readonly finance: SalesFinanceService;
  private readonly query: SalesQueryService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly planFeatureService: PlanFeatureService;
  private readonly cashDrawerService?: CashDrawerService;
  private readonly logger: Logger;
  private readonly assertDiscountChangeAllowed: SalesEditAndCancelDeps['assertDiscountChangeAllowed'];
  private readonly assertUnitPriceChangeAllowed: SalesEditAndCancelDeps['assertUnitPriceChangeAllowed'];
  private readonly getTenantSettingsMap: SalesEditAndCancelDeps['getTenantSettingsMap'];
  private readonly claimSaleSerials: SalesEditAndCancelDeps['claimSaleSerials'];
  private readonly releaseSaleSerials: SalesEditAndCancelDeps['releaseSaleSerials'];
  private readonly resolveSaleModifierCosts: SalesEditAndCancelDeps['resolveSaleModifierCosts'];
  private readonly loadFlatAddonCosts: SalesEditAndCancelDeps['loadFlatAddonCosts'];
  private readonly enforceRestaurantModifierContract: SalesEditAndCancelDeps['enforceRestaurantModifierContract'];
  private readonly autoProduceShortfall: SalesEditAndCancelDeps['autoProduceShortfall'];
  private readonly deductPharmacyBatchesFefo: SalesEditAndCancelDeps['deductPharmacyBatchesFefo'];
  private readonly deductInventoryBatchesFefo: SalesEditAndCancelDeps['deductInventoryBatchesFefo'];
  private readonly restoreSalePharmacyBatches: SalesEditAndCancelDeps['restoreSalePharmacyBatches'];
  private readonly restoreSaleInventoryBatches: SalesEditAndCancelDeps['restoreSaleInventoryBatches'];
  private readonly recordImportLotShortfalls: SalesEditAndCancelDeps['recordImportLotShortfalls'];
  private readonly getAllowNegativeStockSales: SalesEditAndCancelDeps['getAllowNegativeStockSales'];
  private readonly buildInsufficientStockError: SalesEditAndCancelDeps['buildInsufficientStockError'];
  private readonly lockProductRow: SalesEditAndCancelDeps['lockProductRow'];
  private readonly lockSaleStockRows: SalesEditAndCancelDeps['lockSaleStockRows'];
  private readonly getCurrentProductOffers: SalesEditAndCancelDeps['getCurrentProductOffers'];
  private readonly updateSaleService: UpdateSaleService;
  private readonly adjustSalePaymentsService: AdjustSalePaymentsService;
  private readonly preparedWasteAndShiftRefreshService: PreparedWasteAndShiftRefreshService;

  constructor(deps: SalesEditAndCancelDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.authz = deps.authz;
    this.finance = deps.finance;
    this.query = deps.query;
    this.accountingPosting = deps.accountingPosting;
    this.planFeatureService = deps.planFeatureService;
    this.cashDrawerService = deps.cashDrawerService;
    this.logger = deps.logger;
    this.assertDiscountChangeAllowed = deps.assertDiscountChangeAllowed;
    this.assertUnitPriceChangeAllowed = deps.assertUnitPriceChangeAllowed;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.claimSaleSerials = deps.claimSaleSerials;
    this.releaseSaleSerials = deps.releaseSaleSerials;
    this.resolveSaleModifierCosts = deps.resolveSaleModifierCosts;
    this.loadFlatAddonCosts = deps.loadFlatAddonCosts;
    this.enforceRestaurantModifierContract = deps.enforceRestaurantModifierContract;
    this.autoProduceShortfall = deps.autoProduceShortfall;
    this.deductPharmacyBatchesFefo = deps.deductPharmacyBatchesFefo;
    this.deductInventoryBatchesFefo = deps.deductInventoryBatchesFefo;
    this.restoreSalePharmacyBatches = deps.restoreSalePharmacyBatches;
    this.restoreSaleInventoryBatches = deps.restoreSaleInventoryBatches;
    this.recordImportLotShortfalls = deps.recordImportLotShortfalls;
    this.getAllowNegativeStockSales = deps.getAllowNegativeStockSales;
    this.buildInsufficientStockError = deps.buildInsufficientStockError;
    this.lockProductRow = deps.lockProductRow;
    this.lockSaleStockRows = deps.lockSaleStockRows;
    this.getCurrentProductOffers = deps.getCurrentProductOffers;
    this.updateSaleService = new UpdateSaleService(
      deps.db,
      deps.tx,
      deps.audit,
      deps.authz,
      deps.finance,
      deps.query,
      deps.accountingPosting,
      deps.planFeatureService,
      deps.assertDiscountChangeAllowed,
      deps.assertUnitPriceChangeAllowed,
      deps.getTenantSettingsMap,
      deps.claimSaleSerials,
      deps.releaseSaleSerials,
      deps.resolveSaleModifierCosts,
      deps.loadFlatAddonCosts,
      deps.enforceRestaurantModifierContract,
      deps.autoProduceShortfall,
      deps.deductPharmacyBatchesFefo,
      deps.deductInventoryBatchesFefo,
      deps.restoreSalePharmacyBatches,
      deps.restoreSaleInventoryBatches,
      deps.recordImportLotShortfalls,
      deps.getAllowNegativeStockSales,
      deps.buildInsufficientStockError,
      deps.lockProductRow,
      deps.lockSaleStockRows,
      deps.getCurrentProductOffers,
      this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
      this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(
        this.preparedWasteAndShiftRefreshService,
      ),
    );
    this.adjustSalePaymentsService = new AdjustSalePaymentsService(deps.db, deps.tx, deps.audit, deps.authz, deps.finance, deps.query, deps.accountingPosting, this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange.bind(this.preparedWasteAndShiftRefreshService));
    this.preparedWasteAndShiftRefreshService = new PreparedWasteAndShiftRefreshService(deps.cashDrawerService);
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.updateSaleService.updateSale(saleId, payload, auth);
  }

  async adjustSalePayments(saleId: number, payload: AdjustSalePaymentsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.adjustSalePaymentsService.adjustSalePayments(saleId, payload, auth);
  }

  private async detectPreparedWasteSale(
    trx: Kysely<Database>,
    sale: { id: number; order_type?: string | null; created_at?: Date | string | null },
    tenantId: string,
  ): Promise<boolean> {
    return this.preparedWasteAndShiftRefreshService.detectPreparedWasteSale(trx, sale, tenantId);
  }

  async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftsForBackdatedOfflineSale(trx, offlineCreatedAt, saleId, branchId, locationId, auth, tenantId);
  }

  private async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    return this.preparedWasteAndShiftRefreshService.refreshClosedShiftForPostCloseChange(trx, shiftId, saleId, kind, reason, auth);
  }

  async cancelSale(saleId: number, reason: string, managerPin: string, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin) throw new AppError('رمز اعتماد المدير مطلوب لإلغاء الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Cancel previously had no book-digits resolution: its reversal
      // residuals rounded with toFixed(2). Resolve the tenant's digits
      // on this transaction handle, as create/update do, before any
      // reversal amount is computed.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // forUpdate is mandatory here: without the row lock two concurrent cancel requests both read
      // status='posted', both pass the guard below, and stock is restored twice while the sale
      // journal is reversed twice. The lock serializes them so the second one hits the guard.
      const sale = await trx.selectFrom('sales').selectAll().where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
      if (!sale) throw new AppError('Sale not found', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id) throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من إلغائها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status === 'cancelled') throw new AppError('Sale already cancelled', 'SALE_ALREADY_CANCELLED', 400);
      if (sale.status !== 'posted') throw new AppError('Only posted sales can be cancelled', 'SALE_CANCEL_STATUS_FORBIDDEN', 400);
      // INV-SPIRIT-POST-CLOSE-EDIT: cancelling after the original shift
      // closed was never blocked; the post-close fact is recorded in the
      // audit event below, and the closed shift's stored figures are
      // refreshed (recompute + stamp) below — a cancel normally nets to
      // the same figures, so the refresh writes nothing. Cash attribution
      // for a closed original shift already falls back to the cancelling
      // user's open shift (see below).
      const cancelOriginalShift = await trx.selectFrom('cashier_shifts').select(['id', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where(sql<boolean>`(closed_at is null or closed_at >= ${sale.created_at})`)
        .where(sql<boolean>`(${sale.branch_id}::int is null or branch_id is null or branch_id = ${sale.branch_id})`)
        .orderBy('id', 'desc').executeTakeFirst();
      const postCloseCancel = cancelOriginalShift ? String(cancelOriginalShift.status || '') !== 'open' : false;
      const postCloseCancelShiftId = postCloseCancel && cancelOriginalShift ? Number(cancelOriginalShift.id) : null;
      // Same immutability as the edit path: cancelling a signed invoice
      // would reverse books the signed attestation still describes.
      assertSaleNotZatcaSigned((sale as any).zatca_status);
      // A field sale's trip counters were raised at creation time and
      // must be reversed with the cancellation. Lock the trip row now
      // (before any stock work, the order settleTrip uses); the
      // reversal itself runs below, after the cancellation guards. A
      // settled trip's counters are history and stay untouched.
      const tripId = Number((sale as any).van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;
      const existingReturn = await trx.selectFrom('return_documents').select('id')
        .where('return_type', '=', 'sale').where('invoice_id', '=', saleId)
        .where('tenant_id', '=', scope.tenantId).limit(1).executeTakeFirst();
      if (existingReturn) throw new AppError('لا يمكن إلغاء فاتورة لها مرتجعات؛ استخدم تسوية محاسبية.', 'SALE_CANCEL_HAS_RETURNS', 400);
      // A later customer receipt is a separate financial transaction. Cancelling
      // the entire sale would reverse the original receivable while leaving that
      // receipt's ledger entry in place, producing a fictitious customer credit.
      // These invoices must be handled via an explicit return/credit note.
      const laterAllocations = await trx.selectFrom('payment_allocations').select('id')
        .where('tenant_id', '=', scope.tenantId).where('invoice_type', '=', 'sale')
        .where('invoice_id', '=', saleId).limit(1).executeTakeFirst();
      if (laterAllocations) {
        throw new AppError('لا يمكن إلغاء فاتورة تم تحصيل سداد لاحق عليها؛ استخدم مرتجعاً أو تسوية محاسبية', 'SALE_CANCEL_HAS_LATER_PAYMENTS', 422);
      }
      const originalPaymentTotal = await trx.selectFrom('sale_payments')
        .select(sql<number>`coalesce(sum(amount), 0)`.as('amount'))
        .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId).executeTakeFirst();
      const recordedSalePayments = Number(originalPaymentTotal?.amount || 0);
      if (recordedSalePayments > 0 && Number(sale.paid_amount || 0) > recordedSalePayments + 0.009) {
        throw new AppError('الفاتورة تحتوي على تحصيلات لاحقة غير مرتبطة؛ يجب تسويتها قبل الإلغاء', 'SALE_CANCEL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }

      // Kitchen consumption is irreversible once preparation starts. Reversing the
      // original sale journal would re-credit consumed ingredient inventory and
      // reverse historical COGS. After prep, require the financial-only return path.
      if (sale.delivery_status === 'settled') {
        throw new AppError('لا يمكن إلغاء طلب دليفري تمت تسوية عهدته؛ استخدم مرتجعاً مالياً', 'DELIVERY_SETTLED_CANCEL_USE_RETURN', 409);
      }
      // Reverse the cancelled sale's trip-counter contribution while
      // the trip row is still locked by this transaction.
      if (tripOpen && tripId) {
        const paymentRows = await trx.selectFrom('sale_payments').select(['amount', 'payment_channel'])
          .where('sale_id', '=', saleId).where('tenant_id', '=', scope.tenantId).execute();
        let oldLedgerCredit: number | null = null;
        if (String((sale as any).payment_channel || '').toLowerCase() === 'mixed') {
          const ledgerRow = await trx.selectFrom('customer_ledger').select('amount')
            .where('reference_type', '=', 'sale').where('reference_id', '=', saleId)
            .where('entry_type', '=', 'sale_credit').where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc').executeTakeFirst();
          oldLedgerCredit = ledgerRow ? Number((ledgerRow as any).amount || 0) : null;
        }
        const oldContribution = tripSaleContribution({
          total: (sale as any).total,
          paidAmount: (sale as any).paid_amount,
          paymentChannel: (sale as any).payment_channel,
          payments: paymentRows as any,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, negateContribution(oldContribution));
      }
      const isPreparedWaste = await this.detectPreparedWasteSale(trx, sale, scope.tenantId);
      const items = await trx.selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      await this.lockSaleStockRows(trx, scope, items);
      await this.restoreSalePharmacyBatches(trx, saleId, items, scope, false);
      await this.restoreSaleInventoryBatches(trx, saleId, items, scope, false);
      await restoreImportLotsFromCancelledSale(trx, { tenantId: scope.tenantId, saleId });
      for (const item of [...items].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        const product = await trx.selectFrom('products').select(['stock_qty']).where('id', '=', item.product_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (!product) throw new AppError('لا يمكن إلغاء البيع: الصنف الأصلي مفقود ويحتاج تسوية مخزون', 'SALE_CANCEL_PRODUCT_RECONCILIATION_REQUIRED', 409);
        const { restoreQty } = calculateRestoredStockQuantity(product.stock_qty, item.qty, item.unit_multiplier);

        const allocations = await trx.selectFrom('sale_line_stock_allocations')
           .selectAll()
           .where('sale_line_id', '=', item.id)
           .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
           .execute();

        if (allocations.length > 0) {
           for (const alloc of allocations) {
             // If meal was already prepared in kitchen, cooked food and consumed ingredients must not be restored to physical inventory
             if (isPreparedWaste) {
               continue;
             }
             const qtyToRestore = Number(alloc.quantity || 0);

             // Find branch for this location
             const locData = await trx.selectFrom('stock_locations').select('branch_id')
               .where('id', '=', alloc.location_id).where('tenant_id', '=', scope.tenantId)
               .executeTakeFirst();
             if (!locData) throw new AppError('مخزن الفاتورة لم يعد صالحاً؛ يلزم تسوية قبل الإلغاء', 'SALE_CANCEL_LOCATION_RECONCILIATION_REQUIRED', 409);
             const branchId = locData.branch_id ?? sale.branch_id;

             const stockChange = await applyStockDelta(trx, {
               productId: alloc.product_id,
               delta: qtyToRestore,
               branchId: branchId,
               locationId: alloc.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
               allowNegative: true,
             });

             await trx
               .insertInto('stock_movements')
               .values({
                 product_id: alloc.product_id,
                 movement_type: 'sale_cancel',
                 qty: qtyToRestore,
                 before_qty: stockChange.scopeBefore,
                 after_qty: stockChange.scopeAfter,
                 reason: 'sale_cancel',
                 note: `Cancel S-${saleId}`,
                 reference_type: 'sale',
                 reference_id: saleId,
                 branch_id: branchId,
                 location_id: alloc.location_id,
                 created_by: auth.userId,
                 tenant_id: scope.tenantId,
                 account_id: scope.accountId,
               } as any)
               .execute();
           }
        } else {
           // Fallback for legacy sales without allocations
           if (isPreparedWaste) {
             continue;
           }
           const stockChange = await applyStockDelta(trx, {
             productId: Number(item.product_id),
             delta: restoreQty,
             branchId: sale.branch_id,
             locationId: sale.location_id,
             tenantId: scope.tenantId,
             accountId: scope.accountId,
           });
           await trx
             .insertInto('stock_movements')
             .values({
               product_id: item.product_id,
               movement_type: 'sale_cancel',
               qty: restoreQty,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_cancel',
               note: `Cancel S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: sale.branch_id,
               location_id: sale.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             } as any)
             .execute();
        }
      }

      await this.releaseSaleSerials(trx, saleId, scope.tenantId);
      const collectibleTotal = Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0));
      const originalPayments = await trx.selectFrom('sale_payments').select(['amount', 'payment_channel'])
        .where('sale_id', '=', saleId).where('tenant_id', '=', scope.tenantId).execute();
      const originalPaid = originalPayments.length
        ? originalPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const remainingDebt = calculateRemainingDebt(collectibleTotal, originalPaid, moneyDigits);
      if (sale.customer_id && remainingDebt > 0) {
        await this.finance.createCustomerLedgerEntry(trx, sale.customer_id, -remainingDebt, `عكس فاتورة بيع S-${saleId}`, saleId, auth);
      }
      if (originalPayments.length === 0 && originalPaid > 0 && sale.payment_channel === 'mixed') {
        throw new AppError('فاتورة قديمة بمدفوعات مختلطة دون تفاصيل تحتاج تسوية قبل الإلغاء', 'SALE_CANCEL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      const cashRefundTotal = originalPayments.length > 0
        ? originalPayments.filter((payment) => payment.payment_channel === 'cash')
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : sale.payment_channel === 'cash' ? originalPaid : 0;
      if (cashRefundTotal > 0) {
        // INV-CROSS-SHIFT-CANCEL-CASH-ATTRIBUTION: the refund belongs
        // to the shift that took the sale's cash — the opener's shift
        // whose window contains the sale, branch-scoped like the
        // fallback lookup and hasOpenCashierShift (one open shift
        // per user, so the creator's open shift on the branch is
        // the drawer that took the cash) — so that shift nets the
        // restored receipt (computeShiftCancelledSaleCashReceipts)
        // against the refund and the cancelling shift is untouched.
        // Only when that original shift is closed does the refund
        // fall back to the cancelling user's latest open shift on the
        // branch, as before; the closed shift's stored figures are
        // refreshed separately by the stamped recompute below (a
        // cancel normally nets to the same figures), and admins with
        // no open shift keep the sale-linked row.
        const originalCashShift = Number(sale.created_by || 0) > 0 && sale.created_at
          ? await trx.selectFrom('cashier_shifts').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId)
            .where('opened_by', '=', Number(sale.created_by))
            .where('created_at', '<=', sale.created_at)
            .where(sql<boolean>`(closed_at is null or closed_at >= ${sale.created_at})`)
            .where(sql<boolean>`(${sale.branch_id}::int is null or branch_id is null or branch_id = ${sale.branch_id})`)
            .orderBy('id', 'desc').forUpdate().executeTakeFirst()
          : undefined;
        const refundShiftQuery = trx.selectFrom('cashier_shifts').select('id')
          .where('opened_by', '=', auth.userId).where('status', '=', 'open')
          .where('tenant_id', '=', scope.tenantId);
        const fallbackShift = originalCashShift && String(originalCashShift.status || '') === 'open'
          ? undefined
          : await (sale.branch_id == null
            ? refundShiftQuery.where('branch_id', 'is', null)
            : refundShiftQuery.where('branch_id', '=', sale.branch_id))
            .orderBy('id', 'desc').forUpdate().executeTakeFirst();
        const refundShift = originalCashShift && String(originalCashShift.status || '') === 'open'
          ? originalCashShift
          : fallbackShift;
        if (!refundShift && !['admin', 'super_admin'].includes(auth.role)) {
          throw new AppError('يجب فتح وردية على الفرع قبل رد نقدية فاتورة ملغاة', 'OPEN_SHIFT_REQUIRED', 400);
        }
        await this.finance.addTreasuryTransaction(trx, -roundSaleResidual(cashRefundTotal, moneyDigits),
          `إلغاء فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id,
          refundShift?.id || null);
      }

      if (Number(sale.store_credit_used || 0) > 0 && sale.customer_id) {
        const customer = await trx.selectFrom('customers').select(['store_credit_balance']).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
        if (customer) {
          await trx.updateTable('customers').set({ store_credit_balance: calculateStoreCreditBalance(Number(customer.store_credit_balance || 0), Number(sale.store_credit_used || 0), moneyDigits), updated_at: sql`NOW()` }).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        }
      }

      // Reconcile Customer Loyalty Points on Cancellation (ZS-078)
      if (sale.customer_id) {
        const customerId = Number(sale.customer_id);

        // 1. Claw back earned points
        const earnLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'earn')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (earnLog && Number(earnLog.points_change) > 0) {
          const earnedPoints = Number(earnLog.points_change);
          const previousClawbacks = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_clawback', 'cancel_clawback'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);
          const clawbackDelta = Math.max(0, earnedPoints - alreadyClawed);

          if (clawbackDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Math.max(0, Number((currentBal - clawbackDelta).toFixed(2)));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: -clawbackDelta,
                balance_after: balanceAfter,
                action_type: 'cancel_clawback',
                sale_id: saleId,
                notes: `خصم ${clawbackDelta} نقطة ولاء مكتسبة بسبب إلغاء الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }

        // 2. Refund redeemed points
        const redeemLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'redeem')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (redeemLog && Number(redeemLog.points_change) < 0) {
          const totalRedeemed = Math.abs(Number(redeemLog.points_change));
          const previousRefunds = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_refund', 'cancel_refund'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);
          const refundDelta = Math.max(0, totalRedeemed - alreadyRefunded);

          if (refundDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Number((currentBal + refundDelta).toFixed(2));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: refundDelta,
                balance_after: balanceAfter,
                action_type: 'cancel_refund',
                sale_id: saleId,
                notes: `رد ${refundDelta} نقطة ولاء مستبدلة سابقاً بسبب إلغاء الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }
      }

      await trx
        .updateTable('sales')
        .set({ status: 'cancelled', cancel_reason: String(reason || '').trim(), cancelled_by: auth.userId, cancelled_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      await trx.insertInto('pos_audit_events').values({
        tenant_id: scope.tenantId, account_id: scope.accountId, event_type: 'invoice_cancel',
        user_id: auth.userId, sale_id: saleId, product_id: null, amount: Number(sale.total || 0),
        reason: String(reason || '').trim(), metadata: { managerApproved: true, ...(postCloseCancel ? { postClose: true, originalShiftId: postCloseCancelShiftId } : {}) },
      }).execute();

      try {
        await this.accountingPosting.reverseSaleJournal(trx, saleId, String(reason || '').trim(), auth, { isPreparedWaste });
      } catch (error) {
        this.logger.error(`Failed to post reversal accounting journal for cancelled sale ${saleId}`, error instanceof Error ? error.stack : String(error));
        throw error;
      }

      if (postCloseCancel && postCloseCancelShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseCancelShiftId, saleId, 'cancel', String(reason || '').trim(), auth);
      }
    });

    await this.audit.log('إلغاء فاتورة بيع', `تم إلغاء الفاتورة S-${saleId} بواسطة ${auth.username}`, auth);
    return { ok: true, sales: (await this.query.listSales({}, auth)).sales };
  }
}
