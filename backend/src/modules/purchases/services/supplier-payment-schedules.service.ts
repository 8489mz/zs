import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { CreateSupplierPaymentScheduleDto, PaySupplierScheduleInstallmentDto } from '../dto/supplier-payment-schedule.dto';
import { normalizeInstapayAddress, normalizeOptionalNote, normalizePurchaseScope } from '../helpers/purchases-write.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, toMinorUnits, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { PurchasesFinanceService } from './purchases-finance.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';

type ScheduleRow = {
  id: number;
  purchase_id: number | null;
  supplier_id: number;
  installment_no: number;
  due_date: string | Date;
  amount: number;
  paid_amount: number;
  status: string;
  note: string;
  paid_at: Date | null;
};

type SchedulePaymentLogRow = {
  id: number;
  schedule_id: number;
  supplier_id: number;
  amount: number;
  note: string;
  created_by: number | null;
  created_by_name: string;
  created_at: string | Date;
};

type OpenCashierShiftRow = {
  id: number;
  branch_id: number | null;
  location_id: number | null;
};

@Injectable()
export class SupplierPaymentSchedulesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly financeService: PurchasesFinanceService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private scheduleDb(db: Kysely<Database>): Kysely<any> {
    return db as unknown as Kysely<any>;
  }

  private tenantScope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = this.tenantScope(auth);
    return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}` : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private tenantFields(auth: AuthContext) {
    const scope = this.tenantScope(auth);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  private ensureCredit(paymentType: unknown): void {
    if (String(paymentType || '') !== 'credit') throw new AppError('Schedule is only available for credit purchases', 'PURCHASE_SCHEDULE_CREDIT_ONLY', 400);
  }

  private async getMoneyDigits(db: any, tenantId: string): Promise<MoneyDigits> {
    try {
      const curr = await tenantBaseCurrency(db, tenantId);
      return currencyMoneyDigits(curr);
    } catch {
      return 2;
    }
  }

  private roundCurrency(value: number, digits: MoneyDigits = 2): number {
    return roundMoney(Number(value || 0), digits);
  }

  private roundDownToStep(value: number, step: number, digits: MoneyDigits = 2): number {
    const safeStep = Number(step || 1) > 0 ? Number(step || 1) : 1;
    return this.roundCurrency(Math.floor(Number(value || 0) / safeStep) * safeStep, digits);
  }

  private addDays(date: Date, days: number): string {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
  }

  private parseDate(value: string): Date {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new AppError('Invalid due date', 'INVALID_DUE_DATE', 400);
    return date;
  }

  private async purchasePayableRemaining(
    trx: Kysely<Database>,
    purchase: { id: number; total: number; paid_amount?: number | null },
    auth: AuthContext,
    digits: MoneyDigits = 2,
  ): Promise<number> {
    const previousReturns = await trx.selectFrom('return_documents')
      .select(['total', 'refund_allocations'])
      .where('return_type', '=', 'purchase').where('invoice_id', '=', Number(purchase.id))
      .where(this.tenantPredicate(auth)).execute();
    const factor = 10 ** digits;
    let reversedMinor = 0;
    for (const doc of previousReturns) {
      const raw: unknown = typeof doc.refund_allocations === 'string'
        ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      if (Array.isArray(raw)) {
        for (const allocation of raw) {
          if (allocation?.tender !== 'payable') continue;
          const amount = Number(allocation.amount);
          if (!Number.isFinite(amount) || amount < 0) {
            throw new AppError('تسوية مرتجع المورد غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_INVALID', 409);
          }
          reversedMinor += Math.round(amount * factor);
        }
      } else if (raw == null) {
        // Historic credit purchase returns credited the full return to the supplier ledger.
        reversedMinor += Math.round(Number(doc.total || 0) * factor);
      } else {
        throw new AppError('تسوية مرتجع المورد غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_INVALID', 409);
      }
    }
    const scheduledPayments = await trx.selectFrom('supplier_payment_schedules')
      .select(sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'))
      .where('purchase_id', '=', Number(purchase.id)).where(this.tenantPredicate(auth))
      .executeTakeFirst();
    const originalMinor = Math.round(Number(purchase.total || 0) * factor);
    const directPaidMinor = Math.round(Number(purchase.paid_amount || 0) * factor);
    const scheduledPaidMinor = Math.round(Number(scheduledPayments?.paid || 0) * factor);
    return Math.max(0, originalMinor - directPaidMinor - scheduledPaidMinor - reversedMinor) / factor;
  }

  private buildAmounts(total: number, payload: CreateSupplierPaymentScheduleDto, digits: MoneyDigits): number[] {
    const safeTotal = this.roundCurrency(total, digits);
    const step = payload.roundingStep != null && Number(payload.roundingStep) > 0 ? Number(payload.roundingStep) : null;
    if (!(safeTotal > 0)) throw new AppError('Schedule total must be greater than zero', 'INVALID_SCHEDULE_TOTAL', 400);
    const factor = 10 ** digits;
    const epsilon = 10 ** -digits / 2;
    if (payload.mode === 'count') {
      const count = Number(payload.installmentCount || 0);
      if (!Number.isSafeInteger(count) || count < 1 || count > 600 || count > Math.round(safeTotal * factor)) {
        throw new AppError('يجب أن يكون عدد الأقساط بين 1 و600 وألا يتجاوز عدد القروش المستحقة', 'INSTALLMENT_COUNT_INVALID', 400);
      }
      if (count === 1) return [safeTotal];
      const base = step != null ? this.roundDownToStep(safeTotal / count, step, digits) : Math.floor((safeTotal / count) * factor) / factor;
      const safeBase = base > 0 ? base : this.roundCurrency(safeTotal / count, digits);
      const amounts = Array.from({ length: count }, (_, index) => (index < count - 1 ? safeBase : 0));
      amounts[count - 1] = this.roundCurrency(safeTotal - amounts.slice(0, -1).reduce((sum, value) => sum + value, 0), digits);
      return amounts;
    }
    const rawAmount = Number(payload.installmentAmount || 0);
    const amount = step != null ? this.roundDownToStep(rawAmount, step, digits) : this.roundCurrency(rawAmount, digits);
    if (!(amount > 0)) throw new AppError('Installment amount is required', 'INSTALLMENT_AMOUNT_REQUIRED', 400);
    const fullCount = Math.floor(safeTotal / amount);
    if (fullCount > 600) throw new AppError('الجدول لا يمكن أن يتجاوز 600 قسط', 'INSTALLMENT_COUNT_INVALID', 400);
    const amounts = Array.from({ length: fullCount }, () => amount);
    const remaining = this.roundCurrency(safeTotal - amounts.reduce((sum, value) => sum + value, 0), digits);
    if (remaining > epsilon) amounts.push(remaining);
    if (amounts.length > 600) throw new AppError('الجدول لا يمكن أن يتجاوز 600 قسط', 'INSTALLMENT_COUNT_INVALID', 400);
    return amounts.length ? amounts : [safeTotal];
  }

  private mapPaymentLog(row: SchedulePaymentLogRow): Record<string, unknown> {
    return {
      id: String(row.id),
      scheduleId: String(row.schedule_id),
      supplierId: String(row.supplier_id),
      amount: Number(row.amount || 0),
      note: row.note || '',
      createdBy: row.created_by == null ? '' : String(row.created_by),
      createdByName: row.created_by_name || '',
      createdAt: row.created_at,
    };
  }

  private formatIsoDate(dateValue: string | Date | null | undefined): string {
    if (!dateValue) return '';
    if (dateValue instanceof Date) {
      return !Number.isNaN(dateValue.getTime()) ? dateValue.toISOString().slice(0, 10) : '';
    }
    const str = String(dateValue).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }
    const parsed = new Date(str);
    return !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : str.slice(0, 10);
  }

  private map(row: ScheduleRow, paymentLogs: SchedulePaymentLogRow[] = [], digits: MoneyDigits = 2, todayKey: string): Record<string, unknown> {
    const amount = Number(row.amount || 0);
    const paidAmount = Number(row.paid_amount || 0);
    const dueDate = this.formatIsoDate(row.due_date);
    const baseStatus = String(row.status || 'pending');
    const status = baseStatus === 'pending' && dueDate < todayKey ? 'overdue' : baseStatus;
    return {
      id: String(row.id),
      purchaseId: row.purchase_id == null ? '' : String(row.purchase_id),
      supplierId: String(row.supplier_id),
      installmentNo: Number(row.installment_no || 0),
      dueDate,
      amount,
      paidAmount,
      remainingAmount: this.roundCurrency(amount - paidAmount, digits),
      status,
      note: row.note || '',
      paidAt: row.paid_at,
      payments: paymentLogs.map((log) => this.mapPaymentLog(log)),
    };
  }

  private async listWithPayments(where: { purchaseId?: number; supplierId?: number }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.tenantScope(auth);
    const digits = await this.getMoneyDigits(this.db, scope.tenantId);
    const todayKey = await resolveBusinessDateKey(this.db, scope.tenantId, new Date());
    const db = this.scheduleDb(this.db);
    let query = db.selectFrom('supplier_payment_schedules').selectAll().where(this.tenantPredicate(auth));
    if (where.purchaseId != null) query = query.where('purchase_id', '=', where.purchaseId);
    if (where.supplierId != null) query = query.where('supplier_id', '=', where.supplierId).where('purchase_id', 'is', null);
    const rows = await query.orderBy('installment_no', 'asc').execute() as ScheduleRow[];
    const ids = rows.map((row) => Number(row.id)).filter(Boolean);
    const logs = ids.length
      ? await db.selectFrom('supplier_payment_schedule_logs').selectAll().where('schedule_id', 'in', ids).where(this.tenantPredicate(auth)).orderBy('created_at', 'asc').execute() as SchedulePaymentLogRow[]
      : [] as SchedulePaymentLogRow[];
    const logsBySchedule = new Map<number, SchedulePaymentLogRow[]>();
    logs.forEach((log) => {
      const scheduleId = Number(log.schedule_id);
      logsBySchedule.set(scheduleId, [...(logsBySchedule.get(scheduleId) || []), log]);
    });
    return { schedules: rows.map((row) => this.map(row, logsBySchedule.get(Number(row.id)) || [], digits, todayKey)) };
  }

  async listForPurchase(purchaseId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.listWithPayments({ purchaseId }, auth);
  }

  async listForSupplier(supplierId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.listWithPayments({ supplierId }, auth);
  }

  async createForPurchase(purchaseId: number, payload: CreateSupplierPaymentScheduleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Purchase -> supplier -> installment is the same lock order used by
      // purchase returns. Do not invert it in payment settlement.
      const purchase = await trx.selectFrom('purchases').selectAll().where('id', '=', purchaseId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!purchase) throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      if (purchase.status !== 'posted') throw new AppError('Only posted purchases can be scheduled', 'PURCHASE_NOT_POSTED', 400);
      this.ensureCredit(purchase.payment_type);
      if (!purchase.supplier_id) throw new AppError('Supplier is required', 'SUPPLIER_REQUIRED', 400);
      const supplier = await trx.selectFrom('suppliers').select(['balance'])
        .where('id', '=', Number(purchase.supplier_id)).where(this.tenantPredicate(auth))
        .forUpdate().executeTakeFirstOrThrow();
      const db = this.scheduleDb(trx);
      const paidRow = await db.selectFrom('supplier_payment_schedules').select('id').where('purchase_id', '=', purchaseId).where('paid_amount', '>', 0).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (paidRow) throw new AppError('Cannot reschedule after payments were recorded', 'PURCHASE_SCHEDULE_HAS_PAYMENTS', 400);
      const scope = this.tenantScope(auth);
      const digits = await this.getMoneyDigits(trx, scope.tenantId);
      const invoiceRemaining = await this.purchasePayableRemaining(trx, purchase, auth, digits);
      const otherSchedules = await trx.selectFrom('supplier_payment_schedules')
        .select(['amount', 'paid_amount'])
        .where('supplier_id', '=', Number(purchase.supplier_id))
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '!=', 'cancelled')
        .where((eb) => eb.or([eb('purchase_id', 'is', null), eb('purchase_id', '!=', purchaseId)]))
        .execute();
      const otherReserved = otherSchedules.reduce((sum, schedule) => sum +
        Math.max(0, Number(schedule.amount || 0) - Number(schedule.paid_amount || 0)), 0);
      const available = this.roundCurrency(Math.min(invoiceRemaining, Math.max(0, Number(supplier.balance || 0) - otherReserved)), digits);
      const requested = payload.scheduleAmount == null ? available : this.roundCurrency(Number(payload.scheduleAmount), digits);
      const epsilon = 10 ** -digits / 2;
      if (!(available > 0) || !Number.isFinite(requested) || requested <= 0 || requested > available + epsilon) {
        throw new AppError('الجدولة تتجاوز الرصيد المستحق على الفاتورة أو رصيد المورد غير المجدول', 'PURCHASE_SCHEDULE_EXCEEDS_BALANCE', 400);
      }
      const amounts = this.buildAmounts(requested, payload, digits);
      const firstDueDate = this.parseDate(payload.firstDueDate);
      const intervalDays = Number(payload.intervalDays || 1);
      await db.deleteFrom('supplier_payment_schedules').where('purchase_id', '=', purchaseId).where(this.tenantPredicate(auth)).execute();
      for (let index = 0; index < amounts.length; index += 1) {
        await db.insertInto('supplier_payment_schedules').values({ purchase_id: purchaseId, supplier_id: Number(purchase.supplier_id), installment_no: index + 1, due_date: this.addDays(firstDueDate, index * intervalDays), amount: amounts[index], paid_amount: 0, status: 'pending', note: normalizeOptionalNote(payload.note), created_by: auth.userId, updated_by: auth.userId, ...this.tenantFields(auth) }).execute();
      }
    });
    return this.listForPurchase(purchaseId, auth);
  }

  async createForSupplier(supplierId: number, payload: CreateSupplierPaymentScheduleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      const supplier = await trx.selectFrom('suppliers').select(['id', 'balance']).where('id', '=', supplierId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
      const db = this.scheduleDb(trx);
      
      const existingRows = await db.selectFrom('supplier_payment_schedules').select(['amount', 'paid_amount']).where('supplier_id', '=', supplierId).where('status', '!=', 'cancelled').where(this.tenantPredicate(auth)).execute();
      const existingUnpaid = existingRows.reduce((sum, r) => sum + (Number(r.amount) - Number(r.paid_amount)), 0);
      
      const scope = this.tenantScope(auth);
      const digits = await this.getMoneyDigits(trx, scope.tenantId);
      const balance = this.roundCurrency(Number(supplier.balance || 0), digits);
      const availableToSchedule = this.roundCurrency(balance - existingUnpaid, digits);
      
      const total = this.roundCurrency(Number(payload.scheduleAmount || availableToSchedule), digits);
      const epsilon = 10 ** -digits / 2;
      if (!(balance > 0)) throw new AppError('Supplier has no payable balance', 'SUPPLIER_NO_PAYABLE_BALANCE', 400);
      if (!(availableToSchedule > 0)) throw new AppError('No unscheduled balance available to schedule', 'SUPPLIER_NO_UNSCHEDULED_BALANCE', 400);
      if (!(total > 0) || total > availableToSchedule + epsilon) throw new AppError('Schedule amount must be within unscheduled supplier balance', 'INVALID_SUPPLIER_SCHEDULE_AMOUNT', 400);
      
      const lastRow = await db.selectFrom('supplier_payment_schedules').select('installment_no').where('supplier_id', '=', supplierId).where('purchase_id', 'is', null).where(this.tenantPredicate(auth)).orderBy('installment_no', 'desc').executeTakeFirst();
      const startInstallmentNo = lastRow ? Number(lastRow.installment_no) : 0;
      
      const amounts = this.buildAmounts(total, payload, digits);
      const firstDueDate = this.parseDate(payload.firstDueDate);
      const intervalDays = Number(payload.intervalDays || 1);
      
      for (let index = 0; index < amounts.length; index += 1) {
        await db.insertInto('supplier_payment_schedules').values({ purchase_id: null, supplier_id: supplierId, installment_no: startInstallmentNo + index + 1, due_date: this.addDays(firstDueDate, index * intervalDays), amount: amounts[index], paid_amount: 0, status: 'pending', note: normalizeOptionalNote(payload.note), created_by: auth.userId, updated_by: auth.userId, ...this.tenantFields(auth) }).execute();
      }
    });
    return this.listForSupplier(supplierId, auth);
  }

  async payInstallment(installmentId: number, payload: PaySupplierScheduleInstallmentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const tenantScope = this.tenantScope(auth);
    const operationType = 'supplier_schedule_settlement';
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey, operationType,
        requestHash: this.idempotency.generateRequestHash({ installmentId, payload }),
      });
      if (existing?.status === 'committed') {
        const recorded = existing.responsePayload as { purchaseId?: number; supplierId?: number } | undefined;
        if (recorded?.purchaseId) return this.listForPurchase(recorded.purchaseId, auth);
        if (recorded?.supplierId) return this.listForSupplier(recorded.supplierId, auth);
        throw new AppError('Settlement result requires reconciliation', 'PAYMENT_RECOVERY_REQUIRED', 422);
      }
      if (existing?.status === 'processing') throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed') throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required') throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    let purchaseId = 0;
    let supplierId = 0;
    try {
    await this.tx.runInTransaction(this.db, async (trx) => {
      const db = this.scheduleDb(trx);
      const pendingInstallment = await db.selectFrom('supplier_payment_schedules').select(['supplier_id', 'purchase_id']).where('id', '=', installmentId).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (!pendingInstallment) throw new AppError('Installment not found', 'INSTALLMENT_NOT_FOUND', 404);
      // Purchase returns lock purchase -> products -> supplier, so keep purchase
      // before supplier here too. This invoice row lock also serializes voucher
      // allocation against installment payments to prevent the same debt being paid twice.
      const lockedPurchase = pendingInstallment.purchase_id
        ? await trx.selectFrom('purchases').selectAll()
            .where('id', '=', Number(pendingInstallment.purchase_id))
            .where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst()
        : null;
      const supplier = await trx.selectFrom('suppliers').select(['id', 'name', 'balance'])
        .where('id', '=', Number(pendingInstallment.supplier_id)).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
      const installment = await db.selectFrom('supplier_payment_schedules').selectAll()
        .where('id', '=', installmentId).where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
      if (!installment || Number(installment.supplier_id) !== Number(supplier.id)
        || Number(installment.purchase_id || 0) !== Number(pendingInstallment.purchase_id || 0)) {
        throw new AppError('Installment changed during payment', 'INSTALLMENT_CHANGED', 409);
      }
      if (installment.status === 'cancelled' || installment.status === 'paid') {
        throw new AppError('قسط المورد ملغي أو مسدد ولا يقبل دفعة جديدة', 'INSTALLMENT_NOT_PAYABLE', 409);
      }
      await this.financeService.assertNoBlockingThreeWayMatch(trx, Number(supplier.id), tenantScope.tenantId);
      const digits = await this.getMoneyDigits(trx, tenantScope.tenantId);
      let invoiceRemainingForInstallment: number | null = null;
      if (installment.purchase_id) {
        const purchase = lockedPurchase;
        if (!purchase || purchase.status !== 'posted' || Number(purchase.supplier_id) !== Number(supplier.id)) {
          throw new AppError('الفاتورة المرتبطة بالقسط غير مرحلة أو لا تتبع المورد', 'PURCHASE_SCHEDULE_INVOICE_INVALID', 409);
        }
        this.ensureCredit(purchase.payment_type);
        purchaseId = Number(installment.purchase_id);
        const invoiceRemaining = await this.purchasePayableRemaining(trx, purchase, auth, digits);
        // Payment is checked below against the invoice, not just global supplier debt.
        // An invoice with a completed return may have no payable even if the
        // supplier owes us for a completely different purchase.
        invoiceRemainingForInstallment = invoiceRemaining;
      }
      supplierId = Number(supplier.id);
      const remaining = this.roundCurrency(Number(installment.amount || 0) - Number(installment.paid_amount || 0), digits);
      const rawAmount = payload.amount == null ? remaining : Number(payload.amount);
      let isMinorExact = Number.isFinite(rawAmount) && rawAmount > 0;
      try { if (isMinorExact) toMinorUnits(rawAmount, digits); } catch { isMinorExact = false; }
      if (!isMinorExact) {
        throw new AppError('Supplier installment payment must be positive and accurate to the currency minor unit (INVALID_AMOUNT)', 'INVALID_AMOUNT', 400);
      }
      const amount = this.roundCurrency(rawAmount, digits);
      const epsilon = 10 ** -digits / 2;
      if (amount > remaining + epsilon) throw new AppError('Payment exceeds installment remaining amount', 'INSTALLMENT_OVERPAYMENT', 400);
      if (invoiceRemainingForInstallment != null && amount > invoiceRemainingForInstallment + epsilon) {
        throw new AppError('مبلغ القسط يتجاوز المتبقي المستحق على فاتورة المورد بعد المرتجعات والمدفوعات', 'PURCHASE_SCHEDULE_EXCEEDS_INVOICE', 400);
      }
      if (amount > Number(supplier.balance || 0) + epsilon) throw new AppError('Payment exceeds supplier payable balance', 'SUPPLIER_OVERPAYMENT', 400);
      const paidAmount = this.roundCurrency(Number(installment.paid_amount || 0) + amount, digits);
      const status = paidAmount >= Number(installment.amount || 0) - epsilon ? 'paid' : 'partial';
      const openShift = await db.selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('opened_by', '=', auth.userId)
        .where('status', '=', 'open')
        .where(this.tenantPredicate(auth))
        .orderBy('id', 'desc')
        .executeTakeFirst() as OpenCashierShiftRow | undefined;
      const scope = normalizePurchaseScope({ branchId: payload.branchId ?? openShift?.branch_id ?? undefined, locationId: payload.locationId ?? openShift?.location_id ?? undefined });
      const branchId = scope.branchId;
      const locationId = scope.locationId;
      const note = normalizeOptionalNote(payload.note) || `دفعة مجدولة للمورد ${supplier.name || supplierId} - دفعة ${installment.installment_no}`;
      const treasuryReferenceType = openShift?.id ? 'cashier_shift' : 'supplier_payment_schedule';
      const treasuryReferenceId = openShift?.id ? Number(openShift.id) : installmentId;
      await db.updateTable('supplier_payment_schedules').set({ paid_amount: paidAmount, status, paid_at: status === 'paid' ? sql`NOW()` : installment.paid_at, updated_by: auth.userId, updated_at: sql`NOW()` }).where('id', '=', installmentId).where(this.tenantPredicate(auth)).execute();
      const insertedLog = await db.insertInto('supplier_payment_schedule_logs').values({ schedule_id: installmentId, supplier_id: supplierId, amount, payment_channel: payload.paymentChannel || 'cash', instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress), note, created_by: auth.userId, created_by_name: auth.username || '', ...this.tenantFields(auth) }).returning('id').executeTakeFirstOrThrow();
      await this.financeService.addSupplierLedgerEntry(trx, supplierId, -amount, 'supplier_payment_schedule', `دفعة مورد مجدولة - ${note}`, 'supplier_payment_schedule', installmentId, auth, branchId, locationId);
      await this.financeService.addTreasuryTransaction(trx, 'supplier_payment_schedule', -amount, `دفعة مورد مجدولة - ${note}${openShift?.id ? ` - مرتبطة بالوردية SHIFT-${openShift.id}` : ''}`, treasuryReferenceType, treasuryReferenceId, auth, branchId, locationId, payload.paymentChannel || 'cash');
      const posting = await this.accountingPosting.postSupplierPaymentScheduleSettlement(trx, Number(insertedLog.id), auth);
      if (!posting.journalEntryId) throw new AppError(`Supplier schedule settlement ${insertedLog.id} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
      if (idempotencyKey) {
        await this.idempotency.commitOperation(trx, {
          tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey, operationType,
        }, { purchaseId, supplierId }, String(insertedLog.id));
      }
    });
    return purchaseId ? this.listForPurchase(purchaseId, auth) : this.listForSupplier(supplierId, auth);
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency.recordFailure({ tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey, operationType }, error.code).catch(() => undefined);
        } else {
          await this.db.updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', tenantScope.tenantId).where('account_id', '=', tenantScope.accountId)
            .where('idempotency_key', '=', idempotencyKey).where('operation_type', '=', operationType)
            .where('status', '=', 'processing').where('document_id', 'is', null).execute().catch(() => undefined);
        }
      }
      throw error;
    }
  }
}
