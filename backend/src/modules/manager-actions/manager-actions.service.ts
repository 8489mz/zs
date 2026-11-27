import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { Kysely, sql } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AUDIT_EVENT_CODES } from '../../core/audit/audit.service';
import {
  ManagerActionCustomerBalanceRow,
  ManagerActionCustomerRow,
  ManagerActionInsight,
  ManagerActionInstallmentRow,
  ManagerActionLastSaleRow,
  ManagerActionOnlineOrderRow,
  ManagerActionPharmacyBatchRow,
  ManagerActionProductRow,
  ManagerActionSaleMarginRow,
  ManagerActionSaleRow,
  ManagerActionVanSuspicionRow,
  buildManagerActionInsights,
} from './helpers/manager-actions.helper';

const VAN_SUSPICION_EVENT_CODES: string[] = [
  AUDIT_EVENT_CODES.VAN_SUSPICION_PRICE_MANIPULATION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_BONUS,
  AUDIT_EVENT_CODES.VAN_SUSPICION_CREDIT_BYPASS,
  AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_FAKE_CARD_PAYMENT,
  AUDIT_EVENT_CODES.VAN_SUSPICION_FRAUDULENT_RETURN,
  AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE,
  AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
  AUDIT_EVENT_CODES.VAN_SUSPICION_GEOFENCE_VIOLATION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_SELF_APPROVAL,
  AUDIT_EVENT_CODES.VAN_SUSPICION_INVALID_PIN,
  AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
  AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE,
];

@Injectable()
export class ManagerActionsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async list(
    limit = 8,
    auth: AuthContext,
  ): Promise<{ insights: ManagerActionInsight[]; scope: ReturnType<typeof requireTenantScope> }> {
    const scope = requireTenantScope(auth);
    const safeLimit = Math.max(1, Math.min(25, Math.floor(Number(limit) || 8)));
    const [
      products,
      productLastSales,
      sales,
      saleMargins,
      customers,
      customerBalances,
      pharmacyBatches,
      installments,
      onlineOrders,
      vanSuspicionAlerts,
      settingsRows,
    ] = await Promise.all([
      this.safeQuery(() => this.loadProducts(scope.tenantId)),
      this.safeQuery(() => this.loadProductLastSales(scope.tenantId)),
      this.safeQuery(() => this.loadRecentSales(scope.tenantId)),
      // Profit/under-cost alerts must not disappear silently if their SQL fails.
      this.loadSaleMargins(scope.tenantId),
      this.safeQuery(() => this.loadCustomers(scope.tenantId)),
      this.safeQuery(() => this.loadCustomerBalances(scope.tenantId)),
      this.safeQuery(() => this.loadPharmacyBatches(scope.tenantId)),
      this.safeQuery(() => this.loadOverdueInstallments(scope.tenantId)),
      this.safeQuery(() => this.loadPendingOnlineOrders(scope.tenantId)),
      this.safeQuery(() => this.loadVanSuspicionAlerts(scope.tenantId)),
      this.safeQuery(() => this.loadSettings(scope.tenantId)),
    ]);

    const settingsMap = settingsRows.reduce<Record<string, any>>((acc, row) => {
      try {
        acc[row.key] = JSON.parse(row.value);
      } catch {
        acc[row.key] = row.value;
      }
      return acc;
    }, {});

    return {
      insights: buildManagerActionInsights({
        products,
        productLastSales,
        sales,
        saleMargins,
        customers,
        customerBalances,
        pharmacyBatches,
        installments,
        onlineOrders,
        vanSuspicionAlerts,
        stagnantThresholdDays:
          Number(settingsMap.stagnantProductDays) > 0 ? Number(settingsMap.stagnantProductDays) : 60,
        expiryAlertDays: Number(settingsMap.expiryAlertDays) > 0 ? Number(settingsMap.expiryAlertDays) : 60,
        limit: safeLimit,
      }),
      scope,
    };
  }

  private async safeQuery<T>(loader: () => Promise<T[]>): Promise<T[]> {
    try {
      return await loader();
    } catch {
      return [];
    }
  }

  private loadSettings(tenantId: string): Promise<Array<{ key: string; value: string }>> {
    return this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
  }

  private loadProducts(tenantId: string): Promise<ManagerActionProductRow[]> {
    return this.db
      .selectFrom('products')
      .select(['id', 'name', 'retail_price', 'cost_price', 'stock_qty', 'min_stock_qty', 'created_at', 'metadata'])
      .where('is_active', '=', true)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
  }

  private loadProductLastSales(tenantId: string): Promise<ManagerActionLastSaleRow[]> {
    const oneYearAgo = new Date();
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    return this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select(['si.product_id', sql<Date>`max(s.created_at)`.as('last_sold_at')])
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', oneYearAgo)
      .where('si.product_id', 'is not', null)
      .where(sql<boolean>`s.tenant_id = ${tenantId}`)
      .where(sql<boolean>`si.tenant_id = ${tenantId}`)
      .groupBy('si.product_id')
      .execute();
  }

  private loadRecentSales(tenantId: string): Promise<ManagerActionSaleRow[]> {
    return this.db
      .selectFrom('sales')
      .select(['id', 'doc_no', 'subtotal', 'discount', 'total', 'created_at'])
      .where('status', '=', 'posted')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
  }

  private loadSaleMargins(tenantId: string): Promise<ManagerActionSaleMarginRow[]> {
    return this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select([
        'si.sale_id',
        's.doc_no',
        // Original sale-line cost_price is per SOLD UNIT: do not multiply by
        // unit_multiplier a second time (carton invoices showed fake losses).
        // net_line_total already excludes VAT/discounts for recent invoices.
        sql<number>`coalesce(sum(coalesce(si.net_line_total, si.line_total)), 0)`.as('revenue'),
        sql<number>`coalesce(sum(coalesce(si.cost_price, 0) * si.qty), 0)`.as('cost'),
        sql<number>`coalesce(sum(case when coalesce(si.net_line_total, si.line_total) <
          (coalesce(si.cost_price, 0) * si.qty) then 1 else 0 end), 0)`.as('below_cost_lines'),
      ])
      .where('s.status', '=', 'posted')
      .where(sql<boolean>`s.tenant_id = ${tenantId}`)
      .where(sql<boolean>`si.tenant_id = ${tenantId}`)
      .groupBy(['si.sale_id', 's.doc_no', 's.created_at'])
      .orderBy('s.created_at', 'desc')
      .limit(100)
      .execute();
  }

  private loadCustomers(tenantId: string): Promise<ManagerActionCustomerRow[]> {
    return this.db
      .selectFrom('customers')
      .select(['id', 'name', 'balance', 'credit_limit'])
      .where('is_active', '=', true)
      .where('balance', '>', 0)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
  }

  private loadCustomerBalances(tenantId: string): Promise<ManagerActionCustomerBalanceRow[]> {
    return this.db
      .selectFrom('customer_ledger')
      .select(['customer_id', sql<number>`coalesce(sum(amount), 0)`.as('balance_total')])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .groupBy('customer_id')
      .execute();
  }

  private loadPharmacyBatches(tenantId: string): Promise<ManagerActionPharmacyBatchRow[]> {
    return this.db
      .selectFrom('pharmacy_batches as pb')
      .leftJoin('products as p', 'p.id', 'pb.product_id')
      .select(['pb.id', 'p.name as product_name', 'pb.batch_number', 'pb.expiry_date', 'pb.quantity'])
      .where(sql<boolean>`pb.tenant_id = ${tenantId}`)
      .where('pb.status', '=', 'active')
      .where(sql<boolean>`cast(pb.quantity as numeric) > 0`)
      .orderBy('pb.expiry_date', 'asc')
      .limit(30)
      .execute();
  }

  private loadOverdueInstallments(tenantId: string): Promise<ManagerActionInstallmentRow[]> {
    return this.db
      .selectFrom('customer_installments as ci')
      .leftJoin('customers as c', 'c.id', 'ci.customer_id')
      .select([
        'ci.id',
        'c.name as customer_name',
        'ci.customer_id',
        'ci.amount',
        'ci.due_date',
        'ci.installment_number',
      ])
      .where(sql<boolean>`ci.tenant_id = ${tenantId}`)
      .where(sql<boolean>`ci.status in ('pending', 'partially_paid')`)
      .where(sql<boolean>`cast(ci.amount as numeric) > cast(coalesce(ci.paid_amount, 0) as numeric)`)
      .orderBy('ci.due_date', 'asc')
      .limit(30)
      .execute();
  }

  private loadPendingOnlineOrders(tenantId: string): Promise<ManagerActionOnlineOrderRow[]> {
    return this.db
      .selectFrom('online_orders')
      .select(['id', 'order_number', 'customer_name', 'total_amount as total', 'created_at'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  }

  private loadVanSuspicionAlerts(tenantId: string): Promise<ManagerActionVanSuspicionRow[]> {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
    return this.db
      .selectFrom('audit_logs')
      .select(['id', 'event_code', 'details', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .where('event_code', 'in', VAN_SUSPICION_EVENT_CODES)
      .where('created_at', '>=', cutoff)
      .orderBy('created_at', 'desc')
      .limit(15)
      .execute();
  }
}
