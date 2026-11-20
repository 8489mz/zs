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
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.updateSaleService.updateSale(saleId, payload, auth);
  }

  /**
   * INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the ONLY writer of
   * sale_payments after posting, besides the original sale insert.
   *
   * updateSale never touches the legs anymore, so a money correction
   * comes here: the caller sends the COMPLETE new leg set, a reason,
   * and a manager PIN (non-admins). The method replaces the legs, moves
   * the sale row's money fields to match, mirrors updateSale's
   * customer-ledger / treasury / trip-counter deltas, and reuses
   * postSaleEdit — the same reversal helper updateSale uses — so the
   * old journal is reversed and one new sale_edit journal is posted
   * in the same transaction. No second journal path exists.
   *
   * Validation: the new legs must not overpay the collectible total
   * (an overpaid journal would not balance); underpayment is allowed
   * and stays a receivable, exactly as in updateSale. Same-channel
   * legs are merged into one row, like the tender allocation does.
   *
   * Interaction (recorded): the posted journal is a sale_edit journal,
   * so this consumes the sale's single-edit allowance — a later
   * updateSale is refused with SALE_EDIT_ALREADY_APPLIED. Item edits
   * must come BEFORE the payment adjustment, or the sale must be
   * re-created. Multiple adjustments in a row work (each reverses the
   * latest active journal).
   */
  async adjustSalePayments(saleId: number, payload: AdjustSalePaymentsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const reason = String((payload as any)?.reason || '').trim();
    const managerPin = String((payload as any)?.managerPin || '').trim();
    if (!reason) throw new AppError('سبب تعديل الدفعات مطلوب.', 'PAYMENT_ADJUSTMENT_REASON_REQUIRED', 400);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل دفعات الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);

    const validChannels = ['cash', 'card', 'wallet', 'instapay'] as const;
    const mergedLegs = new Map<string, number>();
    for (const leg of payload.payments || []) {
      const channel = String((leg as any)?.paymentChannel || '').trim();
      const amount = Number((leg as any)?.amount || 0);
      if (!validChannels.includes(channel as (typeof validChannels)[number])) {
        throw new AppError(`قناة دفع غير صالحة (${channel || 'غير مسجلة'})`, 'INVALID_PAYMENT_CHANNEL', 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError('مبلغ الدفعة يجب أن يكون أكبر من صفر', 'INVALID_PAYMENT_AMOUNT', 400);
      }
      mergedLegs.set(channel, (mergedLegs.get(channel) || 0) + amount);
    }
    const newLegs = [...mergedLegs.entries()].map(([paymentChannel, amount]) => ({ paymentChannel: paymentChannel as 'cash' | 'card' | 'wallet' | 'instapay', amount }));

    let postCloseEdit = false;
    let postCloseShiftId: number | null = null;
    let remainingReceivable = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!sale) throw new AppError('الفاتورة غير موجودة.', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id) throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من تعديلها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status !== 'posted') throw new AppError('لا يمكن تعديل دفعات فاتورة غير مرحّلة أو ملغاة.', 'SALE_EDIT_STATUS_FORBIDDEN', 400);
      assertSaleNotZatcaSigned((sale as any).zatca_status);
      // One-edit allowance: this posts a sale_edit journal, exactly
      // like updateSale — a second money edit of the same sale is
      // refused here too, not silently stacked.
      const existingEditedJournal = await trx
        .selectFrom('journal_entries')
        .select(['id'])
        .where('source_type', '=', 'sale_edit')
        .where('source_id', '=', saleId)
        .where('status', 'in', ['draft', 'posted'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (existingEditedJournal) {
        throw new AppError('تم تعديل هذه الفاتورة سابقًا. أنشئ فاتورة جديدة بدلًا من إعادة التعديل.', 'SALE_EDIT_ALREADY_APPLIED', 400);
      }
      // A later receipt stays attached to the original debt (same guard
      // as updateSale): changing the legs under it would orphan it.
      const laterAllocation = await trx.selectFrom('payment_allocations')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('invoice_type', '=', 'sale').where('invoice_id', '=', saleId)
        .limit(1).executeTakeFirst();
      if (laterAllocation) {
        throw new AppError('الفاتورة عليها سند قبض مخصص؛ يلزم مستند تصحيح بدلاً من تعديلها', 'SALE_EDIT_HAS_LATER_PAYMENTS', 422);
      }
      const currentPayments = await trx
        .selectFrom('sale_payments')
        .select(['amount', 'payment_channel'])
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      if (currentPayments.length > 0 &&
          paidAmountExceedsRecordedPayments(currentPayments, sale.paid_amount, moneyDigits)) {
        throw new AppError('الفاتورة عليها تحصيلات إضافية لا يمكن عكسها بتعديل الدفعات', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      if (currentPayments.length === 0 && Number(sale.paid_amount || 0) > 0 && sale.payment_channel === 'mixed') {
        throw new AppError('لا يمكن تعديل دفعات فاتورة قديمة ذات سداد مختلط دون تفاصيل وسائل الدفع', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }

      // Post-close shift handling, same as updateSale: an OPEN shift
      // belonging to another cashier still blocks the change; a closed
      // original shift is refreshed below (never restated).
      const shiftBase = trx.selectFrom('cashier_shifts')
        .select(['id', 'opened_by', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where((eb) => eb.or([eb('closed_at', 'is', null), eb('closed_at', '>=', sale.created_at)]));
      const originalShift = await (sale.branch_id == null
        ? shiftBase.where('branch_id', 'is', null)
        : shiftBase.where('branch_id', '=', sale.branch_id))
        .orderBy('id', 'desc').forUpdate().executeTakeFirst();
      postCloseEdit = originalShift ? String(originalShift.status || '') !== 'open' : false;
      postCloseShiftId = postCloseEdit && originalShift ? Number(originalShift.id) : null;
      if (originalShift && !postCloseEdit && Number(originalShift.opened_by) !== auth.userId) {
        throw new AppError(
          'لا يمكن تعديل دفعات فاتورة تخص وردية مقفولة أو وردية كاشير آخر؛ استخدم مستند مرتجع أو تسوية',
          'SALE_EDIT_ORIGINAL_SHIFT_LOCKED',
          422,
        );
      }

      const tripId = Number((sale as any).van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;

      const collectibleTotal = calculateCollectibleTotal(Number(sale.total || 0), Number(sale.store_credit_used || 0), moneyDigits);
      const newPaid = roundMoney(newLegs.reduce((sum, leg) => sum + leg.amount, 0), moneyDigits);
      const paymentTolerance = 1 / 10 ** moneyDigits;
      if (newPaid > collectibleTotal + paymentTolerance) {
        throw new AppError(
          `مجموع الدفعات الجديدة (${newPaid}) يتجاوز إجمالي الفاتورة المستحق (${collectibleTotal}) — لا يمكن تسجيل دفعة أكبر من الفاتورة`,
          'SALE_PAYMENT_ADJUSTMENT_OVERPAID',
          400,
        );
      }
      remainingReceivable = roundMoney(Math.max(0, collectibleTotal - newPaid), moneyDigits);

      const customer = (sale as any).customer_id
        ? await trx.selectFrom('customers').select(['id', 'name', 'balance', 'credit_limit', 'is_credit_blocked']).where('id', '=', Number((sale as any).customer_id)).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst()
        : null;
      if (remainingReceivable > 0 && customer) {
        if (Number(customer.balance || 0) + remainingReceivable > Number(customer.credit_limit || 0) + 0.001
          && Number(customer.credit_limit || 0) > 0) {
          throw new AppError(
            formatCreditLimitExceededMessage({
              creditLimit: Number(customer.credit_limit || 0),
              currentBalance: Number(customer.balance || 0),
              requestedAmount: remainingReceivable,
              digits: moneyDigits,
            }),
            'CUSTOMER_CREDIT_LIMIT',
            400,
          );
        }
        if (customer.is_credit_blocked) throw new AppError('Customer credit is blocked', 'CUSTOMER_CREDIT_BLOCKED', 400);
      }

      // Reverse the OLD money side, exactly like updateSale: the old
      // receivable (if any) and the old cash treasury legs.
      const oldPaid = currentPayments.length
        ? currentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const oldDebt = calculateRemainingDebt(collectibleTotal, oldPaid, moneyDigits);
      if (sale.customer_id && oldDebt > 0) {
        await this.finance.createCustomerLedgerEntry(trx, sale.customer_id, -oldDebt, `عكس تعديل دفعات فاتورة بيع S-${saleId}`, saleId, auth);
      }
      for (const payment of currentPayments) {
        if (payment.payment_channel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, -Number(payment.amount || 0), `عكس تعديل دفعات فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id);
      }

      // Replace the legs: the only deleteFrom/insert of sale_payments
      // outside the original sale insert in the whole codebase.
      await trx.deleteFrom('sale_payments').where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      for (const leg of newLegs) {
        await trx.insertInto('sale_payments').values({
          sale_id: saleId,
          payment_channel: leg.paymentChannel,
          amount: roundMoney(leg.amount, moneyDigits),
          applied_amount: roundMoney(leg.amount, moneyDigits),
          tendered_amount: roundMoney(leg.amount, moneyDigits),
          change_amount: 0,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      // The sale row follows the new legs: the type flips to 'credit'
      // only when a receivable remains (mirroring updateSale's partial-
      // credit flip); otherwise the stored type stays. The channel is
      // re-derived from the new legs only when the channel mix actually
      // changed — otherwise the stored channel stays (a 'mixed' or
      // split-sale channel must not collapse to a single leg's channel
      // just because the amounts moved).
      const newPaymentType = remainingReceivable > paymentTolerance ? 'credit' : String((sale as any).payment_type || 'cash');
      const oldChannels = new Set(currentPayments.map((p) => String(p.payment_channel || '')));
      const newChannels = new Set(newLegs.map((l) => l.paymentChannel));
      const channelsChanged = oldChannels.size !== newChannels.size || [...newChannels].some((c) => !oldChannels.has(c));
      const newPaymentChannel = remainingReceivable > paymentTolerance || channelsChanged
        ? resolvePostedSalePaymentChannel(newPaymentType === 'credit' ? 'credit' : 'cash',
            newLegs.map((leg) => ({ paymentChannel: leg.paymentChannel as 'cash' | 'card' | 'wallet' | 'instapay' })))
        : String((sale as any).payment_channel || 'cash');
      await trx.updateTable('sales').set({
        payment_type: newPaymentType,
        payment_channel: newPaymentChannel,
        paid_amount: newPaid,
        applied_amount: newPaid,
        tendered_amount: newPaid,
        change_amount: 0,
        updated_at: sql`NOW()`,
      } as any).where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      // Post the NEW money side, mirroring updateSale.
      if (customer && remainingReceivable > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          customer.id,
          remainingReceivable,
          `تعديل دفعات فاتورة بيع S-${saleId} (متبقي آجل)`,
          saleId,
          auth,
        );
      } else if (customer && remainingReceivable === 0) {
        const settled = roundMoney(collectibleTotal - remainingReceivable, moneyDigits);
        if (settled > 0) {
          await this.finance.addCustomerLedgerLeg(trx, customer.id, settled, 'sale_paid', `تعديل دفعات فاتورة بيع S-${saleId}`, 'sale', saleId, auth);
          await this.finance.addCustomerPaymentLedgerEntry(trx, customer.id, -settled, `سداد تعديل دفعات فاتورة بيع S-${saleId}`, 'sale', saleId, auth, (sale as any).branch_id, (sale as any).location_id);
        }
      }
      for (const leg of newLegs) {
        if (leg.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, leg.amount, `تعديل دفعات فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id);
      }

      // The trip counters move with the legs, same delta as updateSale.
      if (tripOpen && tripId) {
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
          payments: currentPayments as any,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        const newContribution = tripSaleContribution({
          total: (sale as any).total,
          paidAmount: newPaid,
          paymentChannel: newPaymentChannel,
          payments: newLegs.map((leg) => ({ amount: leg.amount, payment_channel: leg.paymentChannel })),
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, diffContributions(newContribution, oldContribution));
      }

      if (postCloseEdit) {
        await trx.insertInto('pos_audit_events').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, event_type: 'sale_payment_adjustment_post_close',
          user_id: auth.userId, sale_id: saleId, product_id: null, amount: Number(sale.total || 0),
          reason, metadata: { postClose: true, originalShiftId: postCloseShiftId, managerApproved: true },
        }).execute();
      }

      // Reuse the existing reversal helper — no second journal path.
      await this.accountingPosting.postSaleEdit(trx, saleId, auth, reason);

      if (postCloseEdit && postCloseShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseShiftId, saleId, 'edit', reason, auth);
      }
    });

    await this.audit.log('تعديل دفعات فاتورة بيع', `تم تعديل دفعات الفاتورة S-${saleId} بواسطة ${auth.username} | السبب: ${reason}${postCloseEdit ? ` | تعديل بعد إغلاق الوردية الأصلية #${postCloseShiftId}` : ''}`, auth);
    const sale = await this.query.getSaleById(saleId, auth);
    return { ok: true, sale: sale.sale, remainingReceivable };
  }

  /**
   * Shared prepared-waste detection for cancelSale and updateSale:
   * a dine-in/takeaway/delivery sale is prepared waste when it has a
   * consumed-ingredient allocation or a recipe meal AND the kitchen
   * state shows the food was consumed (KDS cooking/ready/served, or a
   * non-pending stage on a sale older than 14h / with an unreadable
   * date). The predicate is cancelSale's original logic, unchanged;
   * both paths call it so the two treatments can never drift apart.
   */
  private async detectPreparedWasteSale(
    trx: Kysely<Database>,
    sale: { id: number; order_type?: string | null; created_at?: Date | string | null },
    tenantId: string,
  ): Promise<boolean> {
    let isPreparedWaste = false;
    const saleId = Number(sale.id);
    if (['dine_in', 'takeaway', 'delivery'].includes(String(sale.order_type || ''))) {
      const consumedIngredient = await trx.selectFrom('sale_line_stock_allocations as a')
        .innerJoin('sale_items as i', (join) => join
          .onRef('i.id', '=', 'a.sale_line_id')
          .onRef('i.tenant_id', '=', 'a.tenant_id'))
        .select('a.id')
        .where('a.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .whereRef('a.product_id', '!=', 'i.product_id')
        .limit(1).executeTakeFirst();
      const recipeMeal = await trx.selectFrom('sale_items as i')
        .innerJoin('manufacturing_boms as b', (join) => join
          .onRef('b.product_id', '=', 'i.product_id')
          .onRef('b.tenant_id', '=', 'i.tenant_id'))
        .select('i.id')
        .where('i.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .where('b.is_active', '=', true)
        .limit(1).executeTakeFirst();
      if (consumedIngredient || recipeMeal) {
        const kitchenRecord = await trx.selectFrom('settings').select('value')
          .where('tenant_id', '=', tenantId)
          .where('key', '=', 'kds_tickets_runtime_state').executeTakeFirst();
        let stage: string | undefined;
        try {
          const parsed = kitchenRecord?.value ? JSON.parse(String(kitchenRecord.value)) : null;
          stage = parsed?.tickets?.[String(saleId)]?.status;
        } catch {
          stage = 'pending';
        }
        const createdMs = sale.created_at ? new Date(sale.created_at).getTime() : NaN;
        if (stage === 'cooking' || stage === 'ready' || stage === 'served' ||
            (stage !== 'pending' && (!Number.isFinite(createdMs) ||
              Date.now() - createdMs > 14 * 60 * 60 * 1000))) {
          isPreparedWaste = true;
        }
      }
    }
    return isPreparedWaste;
  }

  /**
   * INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: after a post-close edit or
   * cancel has written the sale's final state in this transaction,
   * refresh the original closed shift's stored figures through the
   * drawer service (recompute + stamp; a no-op when the figures are
   * unchanged). Must run inside the caller's transaction so a failed
   * refresh rolls the sale change back. Refuses loudly when the drawer
   * service was not wired: a post-close change must never silently
   * leave the closed shift stale.
   */
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I26): after a backdated offline
   * sale has been written in this transaction, refresh every
   * closed / pending_review shift whose [created_at, closed_at]
   * window contains the sale's ORIGINAL timestamp. The sale was
   * already counted by the open shift on read; only already-closed
   * shifts need their stored figures corrected, with a stamp.
   */
  async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError('تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.', 'SHIFT_REFRESH_UNAVAILABLE', 500);
    }
    // A null sale branch/location matches any shift scope (the
    // same null-means-any rule as the attribution predicate); a
    // set one matches only its own scope or an unscoped shift.
    let shiftsQuery = trx
      .selectFrom('cashier_shifts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['closed', 'pending_review'])
      .where('created_at', '<=', offlineCreatedAt)
      .where((eb) => eb.or([
        eb('closed_at', '>=', offlineCreatedAt),
        eb('closed_at', 'is', null),
      ]));
    if (branchId != null) {
      shiftsQuery = shiftsQuery.where((eb) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', branchId)]));
    }
    if (locationId != null) {
      shiftsQuery = shiftsQuery.where((eb) => eb.or([eb('location_id', 'is', null), eb('location_id', '=', locationId)]));
    }
    const shifts = await shiftsQuery.execute();
    for (const shift of shifts) {
      await this.refreshClosedShiftForPostCloseChange(
        trx, Number(shift.id), saleId, 'offline_sync', 'مزامنة فاتورة أوفلاين بتاريخها الأصلي', auth,
      );
    }
  }

  private async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError('تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.', 'SHIFT_REFRESH_UNAVAILABLE', 500);
    }
    await this.cashDrawerService.refreshClosedShiftSummary(trx as Kysely<Database>, shiftId, {
      saleId,
      kind,
      reason,
      auth,
    });
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
