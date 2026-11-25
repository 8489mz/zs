export type ManagerActionDomain =
  | 'products'
  | 'sales'
  | 'customers'
  | 'inventory'
  | 'purchases'
  | 'accounts'
  | 'pharmacy_expiry'
  | 'installments'
  | 'online_orders'
  | 'van_suspicion'
  | 'manager_actions';

export type ManagerActionSeverity = 'info' | 'warning' | 'danger';

export type ManagerActionInsight = {
  id: string;
  domain: ManagerActionDomain;
  severity: ManagerActionSeverity;
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
  metrics?: Record<string, unknown>;
};

export type ManagerActionProductRow = {
  id: number | string;
  name?: string | null;
  retail_price?: number | string | null;
  cost_price?: number | string | null;
  stock_qty?: number | string | null;
  min_stock_qty?: number | string | null;
  created_at?: Date | string | null;
  metadata?: unknown;
};

export type ManagerActionLastSaleRow = {
  product_id?: number | string | null;
  last_sold_at?: Date | string | null;
};

export type ManagerActionSaleRow = {
  id: number | string;
  doc_no?: string | null;
  subtotal?: number | string | null;
  discount?: number | string | null;
  total?: number | string | null;
  created_at?: Date | string | null;
};

export type ManagerActionSaleMarginRow = {
  sale_id?: number | string | null;
  doc_no?: string | null;
  revenue?: number | string | null;
  cost?: number | string | null;
  below_cost_lines?: number | string | null;
};

export type ManagerActionCustomerRow = {
  id: number | string;
  name?: string | null;
  balance?: number | string | null;
  credit_limit?: number | string | null;
};

export type ManagerActionCustomerBalanceRow = {
  customer_id?: number | string | null;
  balance_total?: number | string | null;
};

export type ManagerActionPharmacyBatchRow = {
  id: number | string;
  product_name?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  quantity?: number | string | null;
};

export type ManagerActionInstallmentRow = {
  id: number | string;
  customer_name?: string | null;
  customer_id?: number | string | null;
  amount?: number | string | null;
  due_date?: Date | string | null;
  installment_number?: number | null;
};

export type ManagerActionOnlineOrderRow = {
  id: number | string;
  order_number?: string | null;
  customer_name?: string | null;
  total?: number | string | null;
  created_at?: Date | string | null;
};

export type ManagerActionVanSuspicionRow = {
  id: number | string;
  event_code?: string | null;
  details?: string | null;
  created_at?: Date | string | null;
};

export type BuildManagerActionInsightsInput = {
  products: ManagerActionProductRow[];
  productLastSales: ManagerActionLastSaleRow[];
  sales: ManagerActionSaleRow[];
  saleMargins: ManagerActionSaleMarginRow[];
  customers: ManagerActionCustomerRow[];
  customerBalances: ManagerActionCustomerBalanceRow[];
  pharmacyBatches?: ManagerActionPharmacyBatchRow[];
  installments?: ManagerActionInstallmentRow[];
  onlineOrders?: ManagerActionOnlineOrderRow[];
  vanSuspicionAlerts?: ManagerActionVanSuspicionRow[];
  stagnantThresholdDays?: number;
  expiryAlertDays?: number;
  now?: Date;
  limit?: number;
};

type RankedInsight = ManagerActionInsight & {
  rank: number;
};

const severityRank: Record<ManagerActionSeverity, number> = {
  danger: 3,
  warning: 2,
  info: 1,
};

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function productName(row: ManagerActionProductRow): string {
  return row.name?.trim() || `#${row.id}`;
}

function saleName(row: {
  doc_no?: string | null;
  sale_id?: number | string | null;
  id?: number | string | null;
}): string {
  return row.doc_no?.trim() || `#${row.sale_id ?? row.id ?? ''}`;
}

function buildInsight(input: ManagerActionInsight & { rank?: number }): RankedInsight {
  return {
    ...input,
    rank: input.rank ?? severityRank[input.severity],
  };
}

export function buildManagerActionInsights({
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
  stagnantThresholdDays = 60,
  expiryAlertDays = 60,
  now = new Date(),
  limit = 8,
}: BuildManagerActionInsightsInput): ManagerActionInsight[] {
  const insights: RankedInsight[] = [];
  const lastSaleByProduct = new Map(
    productLastSales
      .filter((row) => row.product_id != null)
      .map((row) => [String(row.product_id), toDate(row.last_sold_at)]),
  );
  const hasSaleHistory = productLastSales.length > 0 || saleMargins.length > 0 || sales.length > 0;
  const customerBalanceById = new Map(
    customerBalances
      .filter((row) => row.customer_id != null)
      .map((row) => [String(row.customer_id), toNumber(row.balance_total)]),
  );

  for (const product of products) {
    const id = String(product.id);
    const name = productName(product);
    const retailPrice = toNumber(product.retail_price);
    const costPrice = toNumber(product.cost_price);
    const stockQty = toNumber(product.stock_qty);
    const minStockQty = toNumber(product.min_stock_qty);
    const inventoryValue = stockQty * costPrice;

    if (costPrice > 0 && retailPrice > 0 && retailPrice < costPrice) {
      insights.push(
        buildInsight({
          id: `product-below-cost-${id}`,
          domain: 'products',
          severity: 'danger',
          title: 'صنف يُباع بخسارة',
          message: `${name}: سعر البيع أقل من التكلفة.`,
          actionLabel: 'راجع التسعير',
          actionHref: `/products/${id}/edit`,
          metrics: { productId: id, retailPrice, costPrice, lossPerUnit: round(costPrice - retailPrice) },
          rank: 92 + (costPrice - retailPrice),
        }),
      );
    } else if (costPrice > 0 && retailPrice > 0) {
      const marginRate = (retailPrice - costPrice) / retailPrice;
      if (marginRate < 0.15) {
        insights.push(
          buildInsight({
            id: `product-weak-margin-${id}`,
            domain: 'products',
            severity: 'warning',
            title: 'هامش ربح ضعيف',
            message: `${name}: هامش الربح أقل من 15%.`,
            actionLabel: 'راجع التسعير',
            actionHref: `/products/${id}/edit`,
            metrics: { productId: id, marginRate: round(marginRate * 100), retailPrice, costPrice },
            rank: 65 + (0.15 - marginRate) * 100,
          }),
        );
      }
    }

    if (stockQty <= 0) {
      insights.push(
        buildInsight({
          id: `product-out-of-stock-${id}`,
          domain: 'inventory',
          severity: 'danger',
          title: 'نفد المخزون',
          message: `${name}: الكمية الحالية صفر أو أقل.`,
          actionLabel: 'راجع المخزون',
          actionHref: `/inventory?productId=${id}`,
          metrics: { productId: id, stockQty, minStockQty },
          rank: 88 + Math.abs(stockQty),
        }),
      );
    } else if (minStockQty > 0 && stockQty <= minStockQty) {
      insights.push(
        buildInsight({
          id: `product-low-stock-${id}`,
          domain: 'inventory',
          severity: 'warning',
          title: 'مخزون منخفض',
          message: `${name}: الكمية ${stockQty} والحد الأدنى ${minStockQty}.`,
          actionLabel: 'راجع المخزون',
          actionHref: `/inventory?productId=${id}`,
          metrics: { productId: id, stockQty, minStockQty },
          rank: 62 + Math.max(0, minStockQty - stockQty),
        }),
      );
    }

    if (inventoryValue >= 1000) {
      insights.push(
        buildInsight({
          id: `product-high-inventory-value-${id}`,
          domain: 'inventory',
          severity: 'info',
          title: 'قيمة مخزون مرتفعة',
          message: `${name}: قيمة المخزون بالتكلفة مرتفعة وتحتاج متابعة حركة البيع.`,
          actionLabel: 'افتح الأصناف',
          actionHref: '/products',
          metrics: { productId: id, stockQty, costPrice, inventoryValue: round(inventoryValue) },
          rank: 30 + Math.min(30, inventoryValue / 1000),
        }),
      );
    }

    const metadata =
      product.metadata && typeof product.metadata === 'object'
        ? (product.metadata as Record<string, any>)
        : typeof product.metadata === 'string'
          ? (() => {
              try {
                return JSON.parse(product.metadata as string);
              } catch {
                return {};
              }
            })()
          : {};

    const expiryDateStr = metadata?.expiryDate ? String(metadata.expiryDate).trim().slice(0, 10) : '';
    if (expiryDateStr && stockQty > 0) {
      const expDate = new Date(`${expiryDateStr}T00:00:00`);
      if (!Number.isNaN(expDate.getTime())) {
        const daysRemaining = daysBetween(now, expDate);
        const configuredExpiryDays = Number(expiryAlertDays) > 0 ? Number(expiryAlertDays) : 60;
        if (daysRemaining <= 0) {
          insights.push(
            buildInsight({
              id: `product-expired-${id}`,
              domain: 'inventory',
              severity: 'danger',
              title: 'صنف منتهي الصلاحية',
              message: `${name}: انتهت صلاحيته بتاريخ ${expiryDateStr} (يوجد رصيد: ${stockQty}).`,
              actionLabel: 'راجع المخزون',
              actionHref: `/inventory?productId=${id}`,
              metrics: { productId: id, expiryDate: expiryDateStr, daysRemaining, stockQty },
              rank: 98 + Math.abs(daysRemaining),
            }),
          );
        } else if (daysRemaining <= configuredExpiryDays) {
          insights.push(
            buildInsight({
              id: `product-near-expiry-${id}`,
              domain: 'inventory',
              severity: daysRemaining <= 7 ? 'danger' : 'warning',
              title: 'صنف وشيك الانتهاء',
              message: `${name}: تنتهي صلاحيته خلال ${daysRemaining} يوم (${expiryDateStr}).`,
              actionLabel: 'راجع المخزون',
              actionHref: `/inventory?productId=${id}`,
              metrics: { productId: id, expiryDate: expiryDateStr, daysRemaining, stockQty },
              rank: 75 + Math.max(0, configuredExpiryDays - daysRemaining),
            }),
          );
        }
      }
    }

    if (hasSaleHistory) {
      const lastSoldAt = lastSaleByProduct.get(id);
      const referenceDate = lastSoldAt ?? toDate(product.created_at);
      if (referenceDate) {
        const daysWithoutSales = daysBetween(referenceDate, now);
        const stagnantDays = Number(stagnantThresholdDays) > 0 ? Number(stagnantThresholdDays) : 60;
        const stagnantDangerDays = Math.max(90, stagnantDays * 2);

        if (daysWithoutSales >= stagnantDangerDays) {
          insights.push(
            buildInsight({
              id: `product-stagnant-danger-${id}`,
              domain: 'products',
              severity: 'danger',
              title: 'صنف شديد الركود',
              message: `${name}: لا توجد مبيعات منذ ${daysWithoutSales} يوم (الحد: ${stagnantDays} يوم).`,
              actionLabel: 'افتح الأصناف',
              actionHref: '/products',
              metrics: { productId: id, daysWithoutSales, thresholdDays: stagnantDays },
              rank: 82 + Math.min(30, daysWithoutSales / 10),
            }),
          );
        } else if (daysWithoutSales >= stagnantDays) {
          insights.push(
            buildInsight({
              id: `product-stagnant-warning-${id}`,
              domain: 'products',
              severity: 'warning',
              title: 'صنف راكد',
              message: `${name}: لا توجد مبيعات منذ ${daysWithoutSales} يوم.`,
              actionLabel: 'افتح الأصناف',
              actionHref: '/products',
              metrics: { productId: id, daysWithoutSales, thresholdDays: stagnantDays },
              rank: 58 + Math.min(20, daysWithoutSales / 10),
            }),
          );
        }
      }
    }
  }

  for (const sale of sales) {
    const subtotal = toNumber(sale.subtotal);
    const discount = toNumber(sale.discount);
    const discountRate = subtotal > 0 ? discount / subtotal : 0;
    if (discountRate >= 0.2) {
      insights.push(
        buildInsight({
          id: `sale-high-discount-${sale.id}`,
          domain: 'sales',
          severity: 'warning',
          title: 'فاتورة بخصم مرتفع',
          message: `${saleName(sale)}: الخصم ${round(discountRate * 100)}% من قيمة الفاتورة.`,
          actionLabel: 'راجع الفواتير',
          actionHref: '/sales',
          metrics: { saleId: String(sale.id), subtotal, discount, discountRate: round(discountRate * 100) },
          rank: 64 + discountRate * 100,
        }),
      );
    }
  }

  for (const sale of saleMargins) {
    const saleId = String(sale.sale_id ?? '');
    const revenue = toNumber(sale.revenue);
    const cost = toNumber(sale.cost);
    const belowCostLines = toNumber(sale.below_cost_lines);
    const marginRate = revenue > 0 ? (revenue - cost) / revenue : 0;

    if (belowCostLines > 0) {
      insights.push(
        buildInsight({
          id: `sale-below-cost-lines-${saleId}`,
          domain: 'sales',
          severity: 'danger',
          title: 'فاتورة بها بيع بخسارة',
          message: `${saleName(sale)}: تحتوي على ${belowCostLines} سطر أقل من التكلفة.`,
          actionLabel: 'راجع الفواتير',
          actionHref: '/sales',
          metrics: { saleId, belowCostLines, revenue: round(revenue), cost: round(cost) },
          rank: 86 + belowCostLines,
        }),
      );
    } else if (revenue > 0 && cost > 0 && marginRate < 0.15) {
      insights.push(
        buildInsight({
          id: `sale-weak-margin-${saleId}`,
          domain: 'sales',
          severity: 'warning',
          title: 'هامش فاتورة ضعيف',
          message: `${saleName(sale)}: هامش الربح أقل من 15%.`,
          actionLabel: 'راجع الفواتير',
          actionHref: '/sales',
          metrics: { saleId, marginRate: round(marginRate * 100), revenue: round(revenue), cost: round(cost) },
          rank: 66 + (0.15 - marginRate) * 100,
        }),
      );
    }
  }

  for (const customer of customers) {
    const id = String(customer.id);
    const name = customer.name?.trim() || `#${id}`;
    const balance = customerBalanceById.get(id) ?? toNumber(customer.balance);
    const creditLimit = toNumber(customer.credit_limit);
    if (creditLimit > 0 && balance > creditLimit) {
      insights.push(
        buildInsight({
          id: `customer-over-credit-${id}`,
          domain: 'customers',
          severity: 'danger',
          title: 'عميل متجاوز حد الائتمان',
          message: `${name}: الرصيد تجاوز حد الائتمان.`,
          actionLabel: 'افتح الحسابات',
          actionHref: `/accounts?customerId=${id}`,
          metrics: { customerId: id, balance: round(balance), creditLimit: round(creditLimit) },
          rank: 90 + Math.min(30, ((balance - creditLimit) / Math.max(1, creditLimit)) * 100),
        }),
      );
    } else if (creditLimit > 0 && balance >= creditLimit * 0.8) {
      insights.push(
        buildInsight({
          id: `customer-near-credit-${id}`,
          domain: 'customers',
          severity: 'warning',
          title: 'عميل قريب من حد الائتمان',
          message: `${name}: استخدم ${round((balance / creditLimit) * 100)}% من حد الائتمان.`,
          actionLabel: 'افتح الحسابات',
          actionHref: `/accounts?customerId=${id}`,
          metrics: { customerId: id, balance: round(balance), creditLimit: round(creditLimit) },
          rank: 68 + (balance / creditLimit) * 10,
        }),
      );
    }
  }

  const topDebtCustomer = customers
    .map((customer) => ({
      id: String(customer.id),
      name: customer.name?.trim() || `#${customer.id}`,
      balance: customerBalanceById.get(String(customer.id)) ?? toNumber(customer.balance),
    }))
    .filter((customer) => customer.balance > 0)
    .sort((a, b) => b.balance - a.balance)[0];

  if (topDebtCustomer) {
    insights.push(
      buildInsight({
        id: `customer-top-debt-${topDebtCustomer.id}`,
        domain: 'accounts',
        severity: 'info',
        title: 'أعلى مديونية عميل',
        message: `${topDebtCustomer.name}: أعلى رصيد مستحق على العملاء.`,
        actionLabel: 'افتح الحسابات',
        actionHref: `/accounts?customerId=${topDebtCustomer.id}`,
        metrics: { customerId: topDebtCustomer.id, balance: round(topDebtCustomer.balance) },
        rank: 42 + Math.min(25, topDebtCustomer.balance / 1000),
      }),
    );
  }

  if (pharmacyBatches && pharmacyBatches.length > 0) {
    const configuredExpiryDays = Number(expiryAlertDays) > 0 ? Number(expiryAlertDays) : 60;
    for (const batch of pharmacyBatches) {
      const id = String(batch.id);
      const prodName = batch.product_name?.trim() || 'دواء غير مسمى';
      const batchNo = batch.batch_number?.trim() || id;
      const expDate = toDate(batch.expiry_date);
      const qty = toNumber(batch.quantity);
      if (expDate && qty > 0) {
        const daysRemaining = daysBetween(now, expDate);
        if (daysRemaining <= 0) {
          insights.push(
            buildInsight({
              id: `pharmacy-batch-expired-${id}`,
              domain: 'pharmacy_expiry',
              severity: 'danger',
              title: 'تشغيلة دواء منتهية الصلاحية',
              message: `${prodName} (تشغيلة: ${batchNo}): انتهت بتاريخ ${batch.expiry_date} (متبقي: ${qty} عبوة).`,
              actionLabel: 'دليل الصيدلية',
              actionHref: '/pharmacy/batches-expiry',
              metrics: { batchId: id, batchNo, expiryDate: batch.expiry_date, daysRemaining, qty },
              rank: 99 + Math.abs(daysRemaining),
            }),
          );
        } else if (daysRemaining <= configuredExpiryDays) {
          insights.push(
            buildInsight({
              id: `pharmacy-batch-near-expiry-${id}`,
              domain: 'pharmacy_expiry',
              severity: daysRemaining <= 15 ? 'danger' : 'warning',
              title: 'تشغيلة دواء وشيكة الانتهاء',
              message: `${prodName} (تشغيلة: ${batchNo}): تنتهي خلال ${daysRemaining} يوم (${batch.expiry_date}).`,
              actionLabel: 'دليل الصيدلية',
              actionHref: '/pharmacy/batches-expiry',
              metrics: { batchId: id, batchNo, expiryDate: batch.expiry_date, daysRemaining, qty },
              rank: 78 + Math.max(0, configuredExpiryDays - daysRemaining),
            }),
          );
        }
      }
    }
  }

  if (installments && installments.length > 0) {
    for (const inst of installments) {
      const id = String(inst.id);
      const custName = inst.customer_name?.trim() || 'عميل';
      const amount = toNumber(inst.amount);
      const dueDate = toDate(inst.due_date);
      const instNo = inst.installment_number ?? 1;
      if (dueDate && amount > 0) {
        const daysDiff = daysBetween(dueDate, now);
        if (daysDiff >= 0) {
          const isOverdue = daysDiff > 0;
          insights.push(
            buildInsight({
              id: `installment-due-${id}`,
              domain: 'installments',
              severity: isOverdue ? 'danger' : 'warning',
              title: isOverdue ? 'قسط عميل متأخر' : 'قسط عميل مستحق اليوم',
              message: `${custName}: قسط #${instNo} بقيمة ${round(amount)} ج.م ${isOverdue ? `متأخر منذ ${daysDiff} يوم` : 'مستحق اليوم'}.`,
              actionLabel: 'تحصيل / تذكير واتساب',
              actionHref: '/sales/installments',
              metrics: {
                installmentId: id,
                customerId: inst.customer_id,
                amount: round(amount),
                daysOverdue: Math.max(0, daysDiff),
              },
              rank: 85 + Math.min(20, daysDiff * 2),
            }),
          );
        }
      }
    }
  }

  if (onlineOrders && onlineOrders.length > 0) {
    for (const order of onlineOrders) {
      const id = String(order.id);
      const orderNo = order.order_number?.trim() || id;
      const custName = order.customer_name?.trim() || 'عميل المتجر';
      const total = toNumber(order.total);
      insights.push(
        buildInsight({
          id: `online-order-pending-${id}`,
          domain: 'online_orders',
          severity: 'warning',
          title: 'طلب متجر إلكتروني جديد',
          message: `طلب #${orderNo} من ${custName} بإجمالي ${round(total)} ج.م بانتظار التأكيد والتحضير.`,
          actionLabel: 'مراجعة الطلبات',
          actionHref: '/sales/online-orders',
          metrics: { orderId: id, total: round(total) },
          rank: 95,
        }),
      );
    }
  }

  if (vanSuspicionAlerts && vanSuspicionAlerts.length > 0) {
    for (const alert of vanSuspicionAlerts) {
      const id = String(alert.id);
      let parsed: Record<string, any> = {};
      try {
        parsed = typeof alert.details === 'string' ? JSON.parse(alert.details) : alert.details || {};
      } catch {
        parsed = {};
      }
      const repName = String(parsed.repName || `مندوب #${parsed.repId || ''}`).trim();
      const titleAr = String(parsed.titleAr || 'محاولة تلاعب ميداني مرصودة').trim();
      const detailsAr = String(parsed.detailsAr || titleAr).trim();
      const rawSeverity = String(parsed.severity || 'high');
      const severity: ManagerActionSeverity = rawSeverity === 'medium' ? 'warning' : 'danger';
      const createdAtDate = toDate(alert.created_at);
      const timeStr = createdAtDate
        ? createdAtDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        : '';

      insights.push(
        buildInsight({
          id: `van-suspicion-${id}`,
          domain: 'van_suspicion',
          severity,
          title: `شبهة تلاعب مندوب: ${repName}`,
          message: `المندوب ${repName}${timeStr ? ` (${timeStr})` : ''}: ${titleAr}`,
          actionLabel: 'فتح رادار الشبهات',
          actionHref: '/van-sales/management?tab=radar',
          metrics: {
            auditLogId: id,
            repId: parsed.repId,
            repName,
            eventCode: alert.event_code,
            detailsAr,
            amountInvolved: parsed.amountInvolved,
          },
          rank: 120,
        }),
      );
    }
  }

  return insights
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.rank - a.rank || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(25, limit)))
    .map(({ rank: _rank, ...insight }) => insight);
}
