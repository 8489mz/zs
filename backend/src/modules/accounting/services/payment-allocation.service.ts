import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../accounting-currency';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';

export interface OpenInvoiceItem {
  id: number;
  docNo: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  date: string;
  status: string;
}

export interface UnallocatedPaymentItem {
  id: number;
  docNo?: string | null;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  date: string;
  note: string;
}

export interface AllocateItemInput {
  invoiceId: number;
  amount: number;
}

export interface AllocatePaymentDto {
  partnerType: 'customer' | 'supplier';
  partnerId: number;
  paymentType: 'customer_payment' | 'supplier_payment' | 'direct';
  paymentId?: number | null;
  allocations: AllocateItemInput[];
  notes?: string;
}

/** The API must not create an apparent invoice settlement without a funded voucher. */
export function validatePaymentAllocationRequest(dto: AllocatePaymentDto, digits: MoneyDigits): { totalAllocating: number; allocations: AllocateItemInput[] } {
  if (!dto || !['customer', 'supplier'].includes(dto.partnerType) || !Number.isSafeInteger(dto.partnerId) || dto.partnerId <= 0) {
    throw new BadRequestException('Invalid payment partner');
  }
  const expectedType = dto.partnerType === 'customer' ? 'customer_payment' : 'supplier_payment';
  if (dto.paymentType !== expectedType || typeof dto.paymentId !== 'number' || !Number.isSafeInteger(dto.paymentId) || dto.paymentId <= 0) {
    throw new BadRequestException('Allocation requires a real customer/supplier payment voucher; unfunded direct allocation is forbidden');
  }
  if (!Array.isArray(dto.allocations) || dto.allocations.length === 0) {
    throw new BadRequestException('At least one invoice allocation is required');
  }
  const seen = new Set<number>();
  let minor = 0;
  for (const row of dto.allocations) {
    if (!row || !Number.isSafeInteger(row.invoiceId) || row.invoiceId <= 0 || seen.has(row.invoiceId)) {
      throw new BadRequestException('Invalid or repeated invoice ID');
    }
    seen.add(row.invoiceId);
    if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0 ||
        Math.abs(row.amount * 10 ** digits - Math.round(row.amount * 10 ** digits)) > 1e-7) {
      throw new BadRequestException('Every allocated amount must be positive, finite and accurate to the tenant currency minor unit');
    }
    minor += Math.round(row.amount * 10 ** digits);
    if (!Number.isSafeInteger(minor)) throw new BadRequestException('Allocation total is too large');
  }
  return { totalAllocating: minor / 10 ** digits, allocations: [...dto.allocations].sort((a, b) => a.invoiceId - b.invoiceId) };
}

@Injectable()
export class PaymentAllocationService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private assertAccountingAccess(auth: AuthContext): void {
    if (auth.role === 'super_admin' || auth.role === 'admin' || auth.permissions.includes('accounting') || auth.permissions.includes('treasury')) {
      return;
    }
    throw new ForbiddenException('Missing required permissions for payment allocation');
  }

  private sumReversedLiabilities(
    rows: Array<{ invoice_id: number | null; total: number; refund_allocations?: unknown | null }>,
    tender: 'payable' | 'receivable',
    creditInvoiceIds: Set<number>,
    digits: MoneyDigits,
  ): Map<number, number> {
    const minor = new Map<number, number>();
    for (const row of rows) {
      const id = Number(row.invoice_id || 0);
      if (!id) continue;
      const allocations: unknown = typeof row.refund_allocations === 'string'
        ? JSON.parse(row.refund_allocations) : row.refund_allocations;
      const amountMinor = Array.isArray(allocations)
        ? allocations.filter((a) => a?.tender === tender).reduce((sum, a) => sum + Math.round(Number(a.amount || 0) * 10 ** digits), 0)
        : creditInvoiceIds.has(id) ? Math.round(Number(row.total || 0) * 10 ** digits) : 0;
      minor.set(id, (minor.get(id) || 0) + amountMinor);
    }
    const reductions = new Map<number, number>();
    for (const [id, value] of minor) reductions.set(id, value / 10 ** digits);
    return reductions;
  }

  async getOpenInvoices(partnerType: 'customer' | 'supplier', partnerId: number, auth: AuthContext): Promise<OpenInvoiceItem[]> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    // Row dates are the tenant-local business day of each recorded instant,
    // never its UTC day (same formatter the business-date gateway uses).
    const timeZone = await getTenantTimezone(this.db, scope.tenantId);

    if (partnerType === 'customer') {
      const sales = await this.db
        .selectFrom('sales')
        .select(['id', 'doc_no', 'total', 'paid_amount', 'store_credit_used', 'payment_type', 'status', 'created_at'])
        .where('tenant_id', '=', scope.tenantId)
        .where('customer_id', '=', partnerId)
        .where('status', '=', 'posted')
        .orderBy('id', 'asc')
        .execute();

      const saleReturns = sales.length ? await this.db.selectFrom('return_documents')
        .select(['invoice_id', 'total', 'refund_allocations'])
        .where('tenant_id', '=', scope.tenantId).where('return_type', '=', 'sale')
        .where('invoice_id', 'in', sales.map((row) => Number(row.id))).execute() : [];
      const reversedSales = this.sumReversedLiabilities(
        saleReturns, 'receivable', new Set(sales.filter((row) => row.payment_type === 'credit').map((row) => Number(row.id))), digits,
      );
      return sales
        .map((s) => {
          const total = Number(s.total || 0);
          const paid = Number(s.paid_amount || 0);
          const remaining = roundMoney(Math.max(0, total - paid - Number(s.store_credit_used || 0) - (reversedSales.get(Number(s.id)) || 0)), digits);
          return {
            id: Number(s.id),
            docNo: s.doc_no || `INV-${s.id}`,
            total,
            paidAmount: paid,
            remainingAmount: remaining,
            date: s.created_at ? todayTenantDate(timeZone, new Date(s.created_at)) : '',
            status: s.status,
          };
        })
        .filter((inv) => inv.remainingAmount > 0);
    } else {
      const purchases = await this.db
        .selectFrom('purchases')
        .select(['id', 'doc_no', 'total', 'paid_amount', 'payment_type', 'status', 'created_at'])
        .where('tenant_id', '=', scope.tenantId)
        .where('supplier_id', '=', partnerId)
        .where('status', '=', 'posted')
        .orderBy('id', 'asc')
        .execute();

      const purchaseReturns = purchases.length ? await this.db.selectFrom('return_documents')
        .select(['invoice_id', 'total', 'refund_allocations'])
        .where('tenant_id', '=', scope.tenantId).where('return_type', '=', 'purchase')
        .where('invoice_id', 'in', purchases.map((row) => Number(row.id))).execute() : [];
      const reversedPurchases = this.sumReversedLiabilities(
        purchaseReturns, 'payable', new Set(purchases.filter((row) => row.payment_type === 'credit').map((row) => Number(row.id))), digits,
      );
      const scheduleRows = purchases.length ? await this.db.selectFrom('supplier_payment_schedules')
        .select(['purchase_id', sql<number>`coalesce(sum(paid_amount), 0)`.as('paid')])
        .where('tenant_id', '=', scope.tenantId)
        .where('purchase_id', 'in', purchases.map((p) => Number(p.id)))
        .groupBy('purchase_id').execute() : [];
      const scheduledPaid = new Map(scheduleRows.map((row) => [Number(row.purchase_id), Number(row.paid || 0)]));
      return purchases
        .map((p) => {
          const total = Number(p.total || 0);
          const paid = Number(p.paid_amount || 0);
          const remaining = roundMoney(Math.max(0, total - paid - (scheduledPaid.get(Number(p.id)) || 0) - (reversedPurchases.get(Number(p.id)) || 0)), digits);
          return {
            id: Number(p.id),
            docNo: p.doc_no || `BILL-${p.id}`,
            total,
            paidAmount: roundMoney(paid + (scheduledPaid.get(Number(p.id)) || 0), digits),
            remainingAmount: remaining,
            date: p.created_at ? todayTenantDate(timeZone, new Date(p.created_at)) : '',
            status: p.status,
          };
        })
        .filter((bill) => bill.remainingAmount > 0);
    }
  }

  async getUnallocatedPayments(partnerType: 'customer' | 'supplier', partnerId: number, auth: AuthContext): Promise<UnallocatedPaymentItem[]> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    // Row dates are the tenant-local business day of each recorded instant,
    // never its UTC day (same formatter the business-date gateway uses).
    const timeZone = await getTenantTimezone(this.db, scope.tenantId);

    if (partnerType === 'customer') {
      const payments = await this.db
        .selectFrom('customer_payments as cp')
        .leftJoin('payment_allocations as pa', (join) =>
          join
            .onRef('pa.payment_id', '=', 'cp.id')
            .on('pa.payment_type', '=', 'customer_payment')
            .on('pa.tenant_id', '=', scope.tenantId)
        )
        .select([
          'cp.id',
          'cp.amount',
          'cp.note',
          'cp.created_at',
          sql<string>`COALESCE(SUM(pa.allocated_amount), 0)`.as('total_allocated'),
        ])
        .where('cp.tenant_id', '=', scope.tenantId)
        .where('cp.customer_id', '=', partnerId)
        .groupBy(['cp.id', 'cp.amount', 'cp.note', 'cp.created_at'])
        .orderBy('cp.id', 'desc')
        .execute();

      return payments
        .map((p) => {
          const amount = Number(p.amount || 0);
          const allocated = Number(p.total_allocated || 0);
          const unallocated = roundMoney(amount - allocated, digits);
          return {
            id: Number(p.id),
            docNo: `CP-${p.id}`,
            amount,
            allocatedAmount: allocated,
            unallocatedAmount: unallocated,
            date: p.created_at ? todayTenantDate(timeZone, new Date(p.created_at)) : '',
            note: p.note || '',
          };
        })
        .filter((p) => p.unallocatedAmount > 0);
    } else {
      const payments = await this.db
        .selectFrom('supplier_payments as sp')
        .leftJoin('payment_allocations as pa', (join) =>
          join
            .onRef('pa.payment_id', '=', 'sp.id')
            .on('pa.payment_type', '=', 'supplier_payment')
            .on('pa.tenant_id', '=', scope.tenantId)
        )
        .select([
          'sp.id',
          'sp.doc_no',
          'sp.amount',
          'sp.note',
          'sp.created_at',
          sql<string>`COALESCE(SUM(pa.allocated_amount), 0)`.as('total_allocated'),
        ])
        .where('sp.tenant_id', '=', scope.tenantId)
        .where('sp.supplier_id', '=', partnerId)
        .groupBy(['sp.id', 'sp.doc_no', 'sp.amount', 'sp.note', 'sp.created_at'])
        .orderBy('sp.id', 'desc')
        .execute();

      return payments
        .map((p) => {
          const amount = Number(p.amount || 0);
          const allocated = Number(p.total_allocated || 0);
          const unallocated = roundMoney(amount - allocated, digits);
          return {
            id: Number(p.id),
            docNo: p.doc_no || `SP-${p.id}`,
            amount,
            allocatedAmount: allocated,
            unallocatedAmount: unallocated,
            date: p.created_at ? todayTenantDate(timeZone, new Date(p.created_at)) : '',
            note: p.note || '',
          };
        })
        .filter((p) => p.unallocatedAmount > 0);
    }
  }

  async allocatePayment(dto: AllocatePaymentDto, auth: AuthContext): Promise<{ success: boolean; totalAllocated: number; count: number }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const userId = Number(auth.userId || 0) || null;

    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const { totalAllocating, allocations } = validatePaymentAllocationRequest(dto, digits);

    return await this.db.transaction().execute(async (trx) => {
      // 1. If paymentId is specified, verify available unallocated amount
      if (dto.paymentId) {
        if (dto.paymentType === 'customer_payment') {
          const payment = await trx
            .selectFrom('customer_payments')
            .select(['id', 'amount', 'customer_id'])
            .where('id', '=', dto.paymentId)
            .where('tenant_id', '=', scope.tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!payment) throw new NotFoundException('سند التحصيل غير موجود');
          if (Number(payment.customer_id) !== dto.partnerId) throw new BadRequestException('Payment voucher customer mismatch');

          const existingAlloc = await trx
            .selectFrom('payment_allocations')
            .select(sql<string>`COALESCE(SUM(allocated_amount), 0)`.as('allocated'))
            .where('payment_id', '=', dto.paymentId)
            .where('payment_type', '=', 'customer_payment')
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst();

          const unallocated = Number(payment.amount) - Number(existingAlloc?.allocated || 0);
          if (totalAllocating > roundMoney(unallocated, digits)) {
            throw new BadRequestException(
              `المبلغ المطلوب تخصيصه (${totalAllocating}) يتجاوز الرصيد المتبقي غير المخصص من السند (${roundMoney(unallocated, digits)})`
            );
          }
        } else if (dto.paymentType === 'supplier_payment') {
          const payment = await trx
            .selectFrom('supplier_payments')
            .select(['id', 'amount', 'supplier_id'])
            .where('id', '=', dto.paymentId)
            .where('tenant_id', '=', scope.tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!payment) throw new NotFoundException('سند السداد غير موجود');
          if (Number(payment.supplier_id) !== dto.partnerId) throw new BadRequestException('Payment voucher supplier mismatch');

          const existingAlloc = await trx
            .selectFrom('payment_allocations')
            .select(sql<string>`COALESCE(SUM(allocated_amount), 0)`.as('allocated'))
            .where('payment_id', '=', dto.paymentId)
            .where('payment_type', '=', 'supplier_payment')
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst();

          const unallocated = Number(payment.amount) - Number(existingAlloc?.allocated || 0);
          if (totalAllocating > roundMoney(unallocated, digits)) {
            throw new BadRequestException(
              `المبلغ المطلوب تخصيصه (${totalAllocating}) يتجاوز الرصيد المتبقي غير المخصص من السند (${roundMoney(unallocated, digits)})`
            );
          }
        }
      }

      // 2. Validate and apply allocations to each invoice
      const invoiceType = dto.partnerType === 'customer' ? 'sale' : 'purchase';

      for (const item of allocations) {
        const allocAmount = item.amount;

        if (invoiceType === 'sale') {
          const sale = await trx
            .selectFrom('sales')
            .select(['id', 'total', 'paid_amount', 'store_credit_used', 'payment_type', 'customer_id', 'status'])
            .where('id', '=', item.invoiceId)
            .where('tenant_id', '=', scope.tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!sale) throw new NotFoundException(`فاتورة المبيعات ${item.invoiceId} غير موجودة`);
          if (Number(sale.customer_id) !== dto.partnerId || sale.status !== 'posted') throw new BadRequestException('Invoice does not belong to customer or is cancelled');

          const currentPaid = Number(sale.paid_amount || 0);
          const total = Number(sale.total || 0);
          const returnedRows = await trx.selectFrom('return_documents')
            .select(['invoice_id', 'total', 'refund_allocations'])
            .where('tenant_id', '=', scope.tenantId).where('return_type', '=', 'sale')
            .where('invoice_id', '=', Number(sale.id)).execute();
          const reversed = this.sumReversedLiabilities(
            returnedRows, 'receivable', new Set(sale.payment_type === 'credit' ? [Number(sale.id)] : []), digits,
          ).get(Number(sale.id)) || 0;
          const remaining = Math.max(0, total - currentPaid - Number(sale.store_credit_used || 0) - reversed);

          if (allocAmount > roundMoney(remaining, digits)) {
            throw new BadRequestException(
              `المبلغ المخصص (${allocAmount}) أكبر من الرصيد المتبقي على الفاتورة (${roundMoney(remaining, digits)})`
            );
          }

          const newPaid = roundMoney(currentPaid + allocAmount, digits);
          await trx
            .updateTable('sales')
            .set({ paid_amount: newPaid, updated_at: sql`NOW()` } as any)
            .where('id', '=', item.invoiceId)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        } else {
          const purchase = await trx
            .selectFrom('purchases')
            .select(['id', 'total', 'paid_amount', 'payment_type', 'supplier_id', 'status'])
            .where('id', '=', item.invoiceId)
            .where('tenant_id', '=', scope.tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!purchase) throw new NotFoundException(`فاتورة المشتريات ${item.invoiceId} غير موجودة`);
          if (Number(purchase.supplier_id) !== dto.partnerId || purchase.status !== 'posted') throw new BadRequestException('Invoice does not belong to supplier or is cancelled');

          const currentPaid = Number(purchase.paid_amount || 0);
          const total = Number(purchase.total || 0);
          const returnedRows = await trx.selectFrom('return_documents')
            .select(['invoice_id', 'total', 'refund_allocations'])
            .where('tenant_id', '=', scope.tenantId).where('return_type', '=', 'purchase')
            .where('invoice_id', '=', Number(purchase.id)).execute();
          const reversed = this.sumReversedLiabilities(
            returnedRows, 'payable', new Set(purchase.payment_type === 'credit' ? [Number(purchase.id)] : []), digits,
          ).get(Number(purchase.id)) || 0;
          const scheduledRow = await trx.selectFrom('supplier_payment_schedules')
            .select(sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'))
            .where('tenant_id', '=', scope.tenantId)
            .where('purchase_id', '=', Number(purchase.id)).executeTakeFirst();
          const remaining = Math.max(0, total - currentPaid - Number(scheduledRow?.paid || 0) - reversed);

          if (allocAmount > roundMoney(remaining, digits)) {
            throw new BadRequestException(
              `المبلغ المخصص (${allocAmount}) أكبر من الرصيد المتبقي على فاتورة الشراء (${roundMoney(remaining, digits)})`
            );
          }

          const newPaid = roundMoney(currentPaid + allocAmount, digits);
          await trx
            .updateTable('purchases')
            .set({ paid_amount: newPaid, updated_at: sql`NOW()` } as any)
            .where('id', '=', item.invoiceId)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }

        // Insert allocation record
        await trx
          .insertInto('payment_allocations')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            partner_type: dto.partnerType,
            partner_id: dto.partnerId,
            payment_type: dto.paymentType,
            payment_id: dto.paymentId || null,
            invoice_type: invoiceType,
            invoice_id: item.invoiceId,
            allocated_amount: allocAmount,
            allocation_date: sql`CURRENT_DATE`,
            notes: dto.notes || '',
            created_by: userId,
          } as any)
          .execute();
      }

      return {
        success: true,
        totalAllocated: totalAllocating,
        count: allocations.length,
      };
    });
  }

  async getInvoiceAllocations(invoiceType: 'sale' | 'purchase', invoiceId: number, auth: AuthContext): Promise<any[]> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const rows = await this.db
      .selectFrom('payment_allocations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('invoice_type', '=', invoiceType)
      .where('invoice_id', '=', invoiceId)
      .orderBy('id', 'desc')
      .execute();

    return rows.map((r) => ({
      id: Number(r.id),
      paymentType: r.payment_type,
      paymentId: r.payment_id ? Number(r.payment_id) : null,
      allocatedAmount: Number(r.allocated_amount),
      allocationDate: r.allocation_date,
      notes: r.notes || '',
      createdAt: r.created_at,
    }));
  }

  async autoAllocateFIFO(
    partnerType: 'customer' | 'supplier',
    partnerId: number,
    paymentId: number,
    auth: AuthContext
  ): Promise<{ success: boolean; totalAllocated: number; count: number }> {
    this.assertAccountingAccess(auth);

    // Get unallocated amount for this payment
    const unallocatedPayments = await this.getUnallocatedPayments(partnerType, partnerId, auth);
    const targetPayment = unallocatedPayments.find((p) => p.id === paymentId);

    if (!targetPayment || targetPayment.unallocatedAmount <= 0) {
      throw new BadRequestException('لا يوجد رصيد غير مخصص متاح في هذا السند');
    }

    let remainingPayment = targetPayment.unallocatedAmount;
    const openInvoices = await this.getOpenInvoices(partnerType, partnerId, auth);

    if (!openInvoices.length) {
      throw new BadRequestException('لا توجد فواتير مفتوحة أو غير مدفوعة لهذا الشريك');
    }

    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    const allocations: AllocateItemInput[] = [];

    for (const inv of openInvoices) {
      // Any positive remainder is real money at book precision: the old
      // 0.009 cutoff stranded up to 9 fils per invoice, permanently.
      if (remainingPayment <= 0) break;

      const toAlloc = Math.min(remainingPayment, inv.remainingAmount);
      allocations.push({
        invoiceId: inv.id,
        amount: roundMoney(toAlloc, digits),
      });
      remainingPayment = roundMoney(remainingPayment - toAlloc, digits);
    }

    return await this.allocatePayment(
      {
        partnerType,
        partnerId,
        paymentType: partnerType === 'customer' ? 'customer_payment' : 'supplier_payment',
        paymentId,
        allocations,
        notes: 'تسوية آلية وفق أسبقية الاستحقاق (FIFO)',
      },
      auth
    );
  }
}
