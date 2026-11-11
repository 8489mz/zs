import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

type SaleRow = Record<string, unknown>;

type SaleListSummary = {
  totalItems: number;
  totalSales: number;
  todaySalesCount: number;
  todaySalesTotal: number;
  cashTotal: number;
  creditTotal: number;
  cancelledCount: number;
  cashiers: string[];
  topCustomers: Array<{ name: string; total: number; count: number }>;
};

export function mapSaleRows(
  sales: Array<Record<string, unknown>>,
  items: Array<Record<string, unknown>>,
  payments: Array<Record<string, unknown>>,
  canViewCostPrice: boolean = false,
  linkedReturns: Array<Record<string, unknown>> = [],
): SaleRow[] {
  const itemsBySale = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const key = String(item.sale_id);
    if (!itemsBySale.has(key)) itemsBySale.set(key, []);
    const rawModifiers = typeof item.modifiers === 'string' ? JSON.parse(item.modifiers || '[]') : (item.modifiers || []);
    const isOfferEnvelope = rawModifiers && !Array.isArray(rawModifiers) && rawModifiers.offer;
    const itemModifiers = isOfferEnvelope ? (rawModifiers.mods || []) : (Array.isArray(rawModifiers) ? rawModifiers : []);
    const offerMeta = isOfferEnvelope ? rawModifiers.offer : null;

    itemsBySale.get(key)!.push({
      id: String(item.id),
      productId: item.product_id ? String(item.product_id) : '',
      name: item.product_name || '',
      nameEn: item.product_name_en ? String(item.product_name_en) : undefined,
      name_en: item.product_name_en ? String(item.product_name_en) : undefined,
      qty: Number(item.qty || 0),
      price: Number(item.unit_price || 0),
      originalPrice: offerMeta?.originalPrice ? Number(offerMeta.originalPrice) : undefined,
      offerDiscount: offerMeta?.offerDiscount ? Number(offerMeta.offerDiscount) : undefined,
      offerName: offerMeta?.offerName || undefined,
      total: Number(item.line_total || 0),
      /* INV-POS-LINE-DISCOUNT: the line's own discount, stored by
       * createSale / updateSale in sale_items.line_discount (NULL on
       * pre-migration rows reads as zero). netLineTotal is already net
       * of it; the detail card and the receipt show it per line. */
      lineDiscount: Number(item.line_discount || 0),
      netLineTotal: item.net_line_total == null ? null : Number(item.net_line_total),
      allocatedTax: item.allocated_tax == null ? null : Number(item.allocated_tax),
      unitName: item.unit_name || 'قطعة',
      unitMultiplier: Number(item.unit_multiplier || 1),
      ...(canViewCostPrice ? { cost: Number(item.cost_price || 0) } : {}),
      priceType: item.price_type || 'retail',
      modifiers: itemModifiers,
      serials: typeof item.serials === 'string' ? JSON.parse(item.serials || '[]') : (item.serials || []),
    });
  }

  const paymentsBySale = new Map<string, Array<Record<string, unknown>>>();
  for (const payment of payments) {
    const key = String(payment.sale_id);
    if (!paymentsBySale.has(key)) paymentsBySale.set(key, []);
    paymentsBySale.get(key)!.push({
      id: String(payment.id),
      paymentChannel: payment.payment_channel || 'cash',
      amount: Number(payment.amount || 0),
    });
  }

  const returnsBySale = new Map<string, Array<Record<string, unknown>>>();
  for (const ret of linkedReturns) {
    const key = String(ret.invoice_id);
    if (!returnsBySale.has(key)) returnsBySale.set(key, []);
    returnsBySale.get(key)!.push({
      id: String(ret.id),
      docNo: ret.doc_no || '',
      createdAt: ret.created_at || null,
      total: Number(ret.total || 0),
      settlementMode: ret.settlement_mode || null,
      refundMethod: ret.refund_method || null,
    });
  }

  return sales.map((sale) => ({
    id: String(sale.id),
    docNo: sale.doc_no || sale.docNo || `Z-${sale.id}`,
    createdById: sale.created_by_id || sale.createdById ? String(sale.created_by_id || sale.createdById) : '',
    customerId: sale.customer_id || sale.customerId ? String(sale.customer_id || sale.customerId) : '',
    customerName: sale.customer_name_ref || sale.customerName || sale.customer_name || 'عميل نقدي',
    customerPhone: sale.customer_phone || sale.customerPhone || sale.customer_phone_ref || '',
    customerAddress: sale.customer_address || sale.customerAddress || sale.customer_address_ref || '',
    paymentType: sale.payment_type || sale.paymentType || 'cash',
    paymentChannel: sale.payment_channel || sale.paymentChannel || 'cash',
    subTotal: Number(sale.subtotal || sale.subTotal || 0),
    discount: Number(sale.discount || 0),
    deliveryFee: Number(sale.delivery_fee || sale.deliveryFee || 0),
    taxRate: Number(sale.tax_rate || sale.taxRate || 0),
    taxAmount: Number(sale.tax_amount || sale.taxAmount || 0),
    pricesIncludeTax: Boolean(sale.prices_include_tax ?? sale.pricesIncludeTax),
    total: Number(sale.total || 0),
    paidAmount: Number(sale.paid_amount || sale.paidAmount || 0),
    tenderedAmount: Number(sale.tendered_amount || sale.tenderedAmount || 0),
    changeAmount: Number(sale.change_amount || sale.changeAmount || 0),
    storeCreditUsed: Number(sale.store_credit_used || sale.storeCreditUsed || 0),
    status: sale.status || 'posted',
    note: sale.note || '',
    tableNumber: sale.table_number || sale.tableNumber || '',
    orderType: sale.order_type || sale.orderType || 'takeaway',
    deliveryRepId: sale.delivery_rep_id || sale.deliveryRepId || null,
    deliveryRepName: sale.delivery_rep_name || sale.deliveryRepName || null,
    delivery_rep_name: sale.delivery_rep_name || sale.deliveryRepName || null,
    deliveryStatus: sale.delivery_status || sale.deliveryStatus || null,
    collectionStatus: sale.collection_status || sale.collectionStatus || null,
    deliveryFeeMode: sale.delivery_fee_mode || sale.deliveryFeeMode || null,
    createdBy: sale.created_by_name || sale.createdBy || '',
    createdByUsername: sale.created_by_username || sale.createdByUsername || '',
    date: sale.created_at || sale.date,
    branchId: sale.branch_id || sale.branchId ? String(sale.branch_id || sale.branchId) : '',
    locationId: sale.location_id || sale.locationId ? String(sale.location_id || sale.locationId) : '',
    branchName: sale.branch_name || sale.branchName || '',
    locationName: sale.location_name || sale.locationName || '',
    items: itemsBySale.get(String(sale.id)) || [],
    payments: paymentsBySale.get(String(sale.id)) || [],
    linkedReturns: returnsBySale.get(String(sale.id)) || [],
  }));
}

function normalizeSearchKey(str: string): string {
  return String(str || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\/\-_.\s]/g, '')
    .trim()
    .toLowerCase();
}

export function filterSales(rows: SaleRow[], query: Record<string, unknown>): SaleRow[] {
  const q = String(query.search || query.q || '').toLowerCase();
  const filter = String(query.paymentChannel || query.filter || query.view || 'all');
  const cashier = String(query.cashier || query.createdBy || 'all').trim();
  const cashierLower = cashier.toLowerCase();

  const paymentChannelMatches = (row: SaleRow) => {
    const channel = String(row.paymentChannel || '').toLowerCase();
    const paymentType = String(row.paymentType || '').toLowerCase();

    switch (filter) {
      case 'cash':
        return channel === 'cash' || (paymentType === 'cash' && !channel);
      case 'card':
        return channel === 'card';
      case 'credit':
        return paymentType === 'credit' || channel === 'credit';
      case 'wallet':
        return channel === 'wallet';
      case 'instapay':
        return channel === 'instapay';
      case 'mixed':
        return channel === 'mixed';
      case 'cancelled':
        return String(row.status || '') === 'cancelled';
      default:
        return true;
    }
  };

  const normQ = normalizeSearchKey(q);

  return rows.filter((row) => {
    if (!paymentChannelMatches(row)) return false;
    if (cashierLower !== 'all') {
      const createdById = String(row.createdById || '').trim();
      const createdByName = String(row.createdBy || '').trim().toLowerCase();
      const createdByUsername = String(row.createdByUsername || '').trim().toLowerCase();
      if (createdById !== cashier && createdByName !== cashierLower && createdByUsername !== cashierLower) return false;
    }
    if (!q) return true;
    return [row.docNo, row.customerName, row.note, row.status, row.id].some((x) => {
      const val = String(x || '').toLowerCase();
      if (val.includes(q)) return true;
      if (normQ && normalizeSearchKey(val).includes(normQ)) return true;
      return false;
    });
  });
}

export function paginateRows(rows: SaleRow[], query: Record<string, unknown>, defaultSize = 30) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || defaultSize)));
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: { page: safePage, pageSize, totalItems, totalPages },
  };
}

export function summarizeSales(rows: SaleRow[], digits: MoneyDigits = 2, todayKey?: string): SaleListSummary {
  const today = todayKey ?? new Date().toISOString().slice(0, 10);
  const todayRows = rows.filter((row) => String(row.date || '').slice(0, 10) === today);
  const cashiers = [...new Set(
    rows
      .map((row) => String(row.createdBy || '').trim())
      .filter((name) => Boolean(name)),
  )].sort((a, b) => a.localeCompare(b, 'ar'));
  const topCustomersMap = new Map<string, { name: string; total: number; count: number }>();
  for (const row of rows) {
    const key = String(row.customerId || row.customerName || 'cash');
    const current = topCustomersMap.get(key) || { name: String(row.customerName || 'عميل نقدي'), total: 0, count: 0 };
    current.total += Number(row.total || 0);
    current.count += 1;
    topCustomersMap.set(key, current);
  }

  return {
    totalItems: rows.length,
    totalSales: roundMoney(rows.reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    todaySalesCount: todayRows.length,
    todaySalesTotal: roundMoney(todayRows.reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    cashTotal: roundMoney(rows.filter((row) => row.paymentType === 'cash').reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    creditTotal: roundMoney(rows.filter((row) => row.paymentType === 'credit').reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    cancelledCount: rows.filter((row) => row.status === 'cancelled').length,
    cashiers,
    topCustomers: [...topCustomersMap.values()].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

export function mapHeldSalesRows(
  rows: Array<Record<string, unknown>>,
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const itemsByDraft = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const key = String(item.held_sale_id);
    if (!itemsByDraft.has(key)) itemsByDraft.set(key, []);
    const rawModifiers = typeof item.modifiers === 'string' ? JSON.parse(item.modifiers || '[]') : (item.modifiers || []);
    const isEnvelope = rawModifiers && !Array.isArray(rawModifiers) && Array.isArray(rawModifiers.mods);
    const itemModifiers = isEnvelope ? rawModifiers.mods : (Array.isArray(rawModifiers) ? rawModifiers : []);
    const itemSeat = isEnvelope && rawModifiers.seatNumber != null ? Number(rawModifiers.seatNumber) : ((item as any).seat_number ? Number((item as any).seat_number) : undefined);
    const itemCourse = isEnvelope && rawModifiers.course ? String(rawModifiers.course) : ((item as any).course || undefined);
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the held line fields ride in the
     * modifiers envelope under `held`. The stored lineKey is preferred
     * over rebuilding it (the rebuild drops the combo/recall suffix and
     * collapses two identical lines to one key); old drafts without a
     * `held` block fall back to the rebuild. */
    const held = isEnvelope && rawModifiers.held && typeof rawModifiers.held === 'object' ? rawModifiers.held : null;

    itemsByDraft.get(key)!.push({
      productId: item.product_id ? String(item.product_id) : '',
      name: item.product_name || '',
      qty: Number(item.qty || 0),
      price: Number(item.unit_price || 0),
      unitName: item.unit_name || 'قطعة',
      unitMultiplier: Number(item.unit_multiplier || 1),
      priceType: item.price_type || 'retail',
      lineKey: held?.lineKey ? String(held.lineKey) : `${item.product_id || ''}::${item.unit_name || 'قطعة'}::${item.price_type || 'retail'}`,
      modifiers: itemModifiers,
      ...(typeof item.notes === 'string' && item.notes.trim() ? { notes: item.notes } : {}),
      ...(itemSeat != null ? { seatNumber: itemSeat } : {}),
      ...(itemCourse != null ? { course: itemCourse } : {}),
      ...(held?.unitId ? { unitId: String(held.unitId) } : {}),
      ...(Array.isArray(held?.serials) ? { serials: held.serials.map((entry: unknown) => String(entry)) } : {}),
      ...(held?.originalPrice != null ? { originalPrice: Number(held.originalPrice) } : {}),
      ...(held?.offerDiscount != null ? { offerDiscount: Number(held.offerDiscount) } : {}),
      ...(held?.lineDiscount != null ? { lineDiscount: Number(held.lineDiscount) } : {}),
      ...(held?.offerName ? { offerName: String(held.offerName) } : {}),
      ...(held?.isWeighted != null ? { isWeighted: Boolean(held.isWeighted) } : {}),
      ...(Array.isArray(held?.quantityChunks) ? { quantityChunks: held.quantityChunks.map((entry: unknown) => Number(entry)) } : {}),
    });
  }

  return rows.map((row) => ({
    id: String(row.id),
    savedAt: row.created_at,
    customerId: row.customer_id ? String(row.customer_id) : '',
    customerName: row.customer_name || '',
    paymentType: row.payment_type === 'credit' ? 'credit' : 'cash',
    paymentChannel: row.payment_type === 'credit' ? 'credit' : (row.payment_channel || 'cash'),
    paidAmount: Number(row.paid_amount || 0),
    cashAmount: Number(row.cash_amount || 0),
    cardAmount: Number(row.card_amount || 0),
    discount: Number(row.discount || 0),
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the header fields recall
     * restores. deliveryFee was never returned before (the select never
     * fetched it), so a recalled delivery order came back with fee 0. */
    deliveryFee: Number(row.delivery_fee || 0),
    deliveryRepId: row.delivery_rep_id ? String(row.delivery_rep_id) : '',
    collectionStatus: row.collection_status ? String(row.collection_status) : '',
    tipAmount: Number(row.tip_amount || 0),
    loyaltyPointsRedeemed: Number(row.loyalty_points_redeemed || 0),
    pagerNumber: row.pager_number ? String(row.pager_number) : '',
    deliveryFeeMode: row.delivery_fee_mode ? String(row.delivery_fee_mode) : '',
    onlineOrderId: row.online_order_id ? Number(row.online_order_id) : undefined,
    diningCourse: row.dining_course ? String(row.dining_course) : '',
    guestCount: row.guest_count != null ? Number(row.guest_count) : undefined,
    /* timestamptz comes back as a Date from the driver — normalise to
     * ISO so recall restores the same string the hold sent. */
    guestCheckPrintedAt: row.guest_check_printed_at instanceof Date
      ? row.guest_check_printed_at.toISOString()
      : (row.guest_check_printed_at ? String(row.guest_check_printed_at) : null),
    note: row.note || '',
    search: row.search || '',
    tableNumber: row.table_number || '',
    orderType: row.order_type || 'takeaway',
    priceType: row.price_type || 'retail',
    branchId: row.branch_id ? String(row.branch_id) : '',
    locationId: row.location_id ? String(row.location_id) : '',
    cart: itemsByDraft.get(String(row.id)) || [],
  }));
}
