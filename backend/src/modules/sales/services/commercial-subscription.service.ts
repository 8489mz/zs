import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import {
  CreateCommercialSubscriptionDto,
  UpdateSubscriptionStatusDto,
} from '../dto/commercial-subscription.dto';
import {
  calculateNextBillingDate,
  calculateSubscriptionTotals,
  calculateSubscriptionLineTotals,
  evaluateSubscriptionBillingStatus,
} from '../engines/subscription-billing.engine';
import { resolveSaleTaxRate } from '../engines/sale-tax-rate.engine';

@Injectable()
export class CommercialSubscriptionService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private assertAccess(auth: AuthContext): void {
    if (
      auth.role === 'super_admin' ||
      auth.role === 'admin' ||
      auth.permissions.includes('sales') ||
      auth.permissions.includes('accounting')
    ) {
      return;
    }
    throw new ForbiddenException('Missing required permissions for subscription management');
  }

  /**
   * Reads the tenant's configured tax rate from settings, mirroring the
   * sales-write read (`taxRate` with the legacy `tax_rate` spelling as
   * fallback). Values are JSON-parsed like the sales settings map, so a
   * stored `14` and a stored `"14"` resolve identically. Returns
   * undefined when the tenant configured no rate; resolveSaleTaxRate
   * then treats the configured rate as 0 (exempt-only) per its contract.
   */
  private async resolveConfiguredTaxRate(tenantId: string): Promise<unknown> {
    const rows = await (this.db as any)
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['taxRate', 'tax_rate'])
      .execute();
    const map = new Map<string, any>();
    for (const row of rows as Array<{ key: string; value: unknown }>) {
      try {
        map.set(row.key, JSON.parse(String(row.value)));
      } catch {
        map.set(row.key, row.value);
      }
    }
    return map.get('taxRate') ?? map.get('tax_rate');
  }

  /**
   * Creates a new B2B commercial subscription contract
   */
  async createSubscription(
    auth: AuthContext,
    dto: CreateCommercialSubscriptionDto,
  ): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    // Verify customer exists
    const customer = await (this.db as any)
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', dto.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Generate contract number if omitted
    let contractNumber = dto.contractNumber;
    if (!contractNumber) {
      const countRes = await (this.db as any)
        .selectFrom('commercial_subscriptions')
        .select(sql<number>`COUNT(*)`.as('count'))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const seq = Number(countRes?.count || 0) + 1;
      contractNumber = formatDailyDocumentNumber('SUB', seq);
    }

    // Calculate totals at the tenant's book precision (INV-SUBSCRIPTION-BILLING-DIGITS)
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    // Tax F1 (same rule as createSale): a subscription line's tax rate is
    // the tenant's configured rate or 0 (exempt) — never whatever the
    // client sent. resolveSaleTaxRate throws SALE_TAX_RATE_MISMATCH
    // before any totals or rows are written, and the resolved rate is
    // what is stored and totalled, so the stored tax_rate and the
    // computed totals agree exactly. Applied per line: each line's
    // payload rate must equal the configured rate or 0.
    const configuredTaxRate = await this.resolveConfiguredTaxRate(tenantId);
    const resolvedLines = dto.lines.map((line) => ({
      ...line,
      taxRate: resolveSaleTaxRate(line.taxRate, configuredTaxRate),
    }));
    const totals = calculateSubscriptionTotals(resolvedLines, digits);
    const subscriptionId = `sub_${randomUUID()}`;

    // Execute in transaction
    await (this.db as any).transaction().execute(async (trx: any) => {
      await trx
        .insertInto('commercial_subscriptions')
        .values({
          id: subscriptionId,
          tenant_id: tenantId,
          contract_number: contractNumber,
          customer_id: dto.customerId,
          billing_period: dto.billingPeriod,
          next_billing_date: dto.startDate, // First invoice on start date
          auto_renew: dto.autoRenew !== false,
          recurring_amount: totals.grandTotal,
          status: 'active',
          payment_method: dto.paymentMethod || 'bank_transfer',
          start_date: dto.startDate,
          end_date: dto.endDate || null,
          notes: dto.notes || null,
          invoices_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      for (const line of resolvedLines) {
        const lineTotals = calculateSubscriptionLineTotals(line.quantity, line.unitPrice, line.taxRate || 0, digits);
        await trx
          .insertInto('commercial_subscription_lines')
          .values({
            id: `subl_${randomUUID()}`,
            tenant_id: tenantId,
            subscription_id: subscriptionId,
            product_id: line.productId || null,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            tax_rate: line.taxRate || 0,
            total_price: lineTotals.totalAmount,
            created_at: new Date(),
          })
          .execute();
      }
    });

    return { success: true, subscriptionId, contractNumber };
  }

  /**
   * Retrieves subscriptions list with customer info
   */
  async getSubscriptions(
    auth: AuthContext,
    params?: { status?: string; search?: string },
  ): Promise<any[]> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    let query = (this.db as any)
      .selectFrom('commercial_subscriptions as s')
      .innerJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        's.contract_number',
        's.customer_id',
        'c.name as customer_name',
        'c.phone as customer_phone',
        's.billing_period',
        's.next_billing_date',
        's.auto_renew',
        's.recurring_amount',
        's.status',
        's.payment_method',
        's.start_date',
        's.end_date',
        's.notes',
        's.last_generated_at',
        's.invoices_count',
        's.created_at',
      ])
      .where('s.tenant_id', '=', tenantId);

    if (params?.status && params.status !== 'all') {
      query = query.where('s.status', '=', params.status);
    }
    if (params?.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('s.contract_number', 'ilike', term),
          eb('c.name', 'ilike', term),
          eb('c.phone', 'ilike', term),
        ]),
      );
    }

    return query.orderBy('s.created_at', 'desc').execute();
  }

  /**
   * Retrieves single subscription details including item lines
   */
  async getSubscriptionDetails(auth: AuthContext, id: string): Promise<any> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    const sub = await (this.db as any)
      .selectFrom('commercial_subscriptions as s')
      .innerJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        's.contract_number',
        's.customer_id',
        'c.name as customer_name',
        'c.phone as customer_phone',
        'c.address as customer_address',
        's.billing_period',
        's.next_billing_date',
        's.auto_renew',
        's.recurring_amount',
        's.status',
        's.payment_method',
        's.start_date',
        's.end_date',
        's.notes',
        's.last_generated_invoice_id',
        's.last_generated_at',
        's.invoices_count',
        's.created_at',
      ])
      .where('s.id', '=', id)
      .where('s.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!sub) {
      throw new NotFoundException('Subscription contract not found');
    }

    const lines = await (this.db as any)
      .selectFrom('commercial_subscription_lines as sl')
      .leftJoin('products as p', 'p.id', 'sl.product_id')
      .select([
        'sl.id',
        'sl.product_id',
        'p.name as product_name',
        'sl.description',
        'sl.quantity',
        'sl.unit_price',
        'sl.tax_rate',
        'sl.total_price',
      ])
      .where('sl.subscription_id', '=', id)
      .where('sl.tenant_id', '=', tenantId)
      .execute();

    return { subscription: sub, lines };
  }

  /**
   * Updates subscription contract status
   */
  async updateStatus(
    auth: AuthContext,
    id: string,
    dto: UpdateSubscriptionStatusDto,
  ): Promise<{ success: boolean }> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);

    await (this.db as any)
      .updateTable('commercial_subscriptions')
      .set({
        status: dto.status,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { success: true };
  }

  /**
   * Scheduled or manual engine run: Generates sales invoices for all due subscriptions
   */
  async generateDueInvoices(auth: AuthContext): Promise<{
    processedCount: number;
    generatedInvoices: string[];
  }> {
    this.assertAccess(auth);
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const now = new Date();

    // 1. Fetch active subscriptions where next_billing_date <= today
    const dueSubscriptions = await (this.db as any)
      .selectFrom('commercial_subscriptions as s')
      .selectAll()
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '=', 'active')
      .where('s.next_billing_date', '<=', now.toISOString().slice(0, 10))
      .execute();

    const generatedInvoices: string[] = [];

    for (const sub of dueSubscriptions) {
      const evalStatus = evaluateSubscriptionBillingStatus(
        {
          status: sub.status,
          nextBillingDate: sub.next_billing_date,
          startDate: sub.start_date,
          endDate: sub.end_date,
          autoRenew: sub.auto_renew,
        },
        now,
      );

      if (!evalStatus.isDueForBilling) {
        if (evalStatus.isExpired) {
          await (this.db as any)
            .updateTable('commercial_subscriptions')
            .set({ status: 'expired', updated_at: now })
            .where('id', '=', sub.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
        continue;
      }

      // Fetch subscription lines
      const lines = await (this.db as any)
        .selectFrom('commercial_subscription_lines')
        .selectAll()
        .where('subscription_id', '=', sub.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
      // Stored rows carry snake_case columns; the engine takes
      // camelCase inputs. Passing rows through unmapped silently
      // zeroed every recurring invoice (unitPrice/taxRate undefined).
      const totals = calculateSubscriptionTotals(
        lines.map((line: any) => ({
          quantity: line.quantity,
          unitPrice: line.unit_price,
          taxRate: line.tax_rate || 0,
        })),
        digits,
      );

      // Create Sale Record
      const invNumber = formatDailyDocumentNumber('SUB-INV', (sub.invoices_count || 0) + 1);

      await (this.db as any).transaction().execute(async (trx: any) => {
        const saleInsert = await trx
          .insertInto('sales')
          .values({
            tenant_id: tenantId,
            customer_id: sub.customer_id,
            total: totals.grandTotal,
            subtotal: totals.subtotal,
            tax_amount: totals.taxTotal,
            paid_amount: 0,
            payment_type: 'credit',
            status: 'completed',
            doc_no: invNumber,
            invoice_number: invNumber,
            order_type: 'retail',
            notes: `فاتورة دورية آلية لعقد اشتراك رقم: ${sub.contract_number}`,
            created_at: now,
            updated_at: now,
          })
          .returning('id')
          .executeTakeFirst();

        const saleId = saleInsert?.id;

        // Advance next billing date
        const nextDate = calculateNextBillingDate(sub.next_billing_date, sub.billing_period);

        await trx
          .updateTable('commercial_subscriptions')
          .set({
            next_billing_date: nextDate,
            last_generated_invoice_id: saleId,
            last_generated_at: now,
            invoices_count: Number(sub.invoices_count || 0) + 1,
            updated_at: now,
          })
          .where('id', '=', sub.id)
          .where('tenant_id', '=', tenantId)
          .execute();

        generatedInvoices.push(invNumber);
      });
    }

    return {
      processedCount: dueSubscriptions.length,
      generatedInvoices,
    };
  }
}
