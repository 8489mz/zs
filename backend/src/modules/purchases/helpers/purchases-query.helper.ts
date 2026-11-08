import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

type PurchaseRow = Record<string, unknown>;

export function mapPurchaseRows(
  purchases: Array<Record<string, unknown>>,
  items: Array<Record<string, unknown>>,
  attachments: Array<Record<string, unknown>> = [],
): PurchaseRow[] {
  const byPurchase = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const key = String(item.purchase_id);
    if (!byPurchase.has(key)) byPurchase.set(key, []);
    byPurchase.get(key)!.push({
      id: String(item.id),
      productId: item.product_id ? String(item.product_id) : '',
      name: item.product_name || '',
      qty: Number(item.qty || 0),
      receivedQty: Number(item.received_qty || 0),
      cost: Number(item.unit_cost || 0),
      total: Number(item.line_total || 0),
      unitName: item.unit_name || 'قطعة',
      unitMultiplier: Number(item.unit_multiplier || 1),
    });
  }

  const attachmentsByPurchase = new Map<string, Array<Record<string, unknown>>>();
  for (const att of attachments) {
    const key = String(att.purchase_id);
    if (!attachmentsByPurchase.has(key)) attachmentsByPurchase.set(key, []);
    attachmentsByPurchase.get(key)!.push({
      id: String(att.id),
      fileName: att.file_name,
      fileUrl: `/api/purchases/${att.purchase_id}/attachments/${att.id}/download`,
      fileSize: att.file_size,
      fileType: att.file_type
    });
  }

  return purchases.map((entry) => ({
    id: String(entry.id),
    docNo: entry.doc_no || `ZP-${entry.id}`,
    supplierId: entry.supplier_id ? String(entry.supplier_id) : '',
    supplierName: entry.supplier_name || '',
    paymentType: entry.payment_type || 'cash',
    subTotal: Number(entry.subtotal || 0),
    discount: Number(entry.discount || 0),
    taxRate: Number(entry.tax_rate || 0),
    taxAmount: Number(entry.tax_amount || 0),
    pricesIncludeTax: Boolean(entry.prices_include_tax),
    total: Number(entry.total || 0),
    note: entry.note || '',
    status: entry.status || 'posted',
    lifecycleStatus: entry.lifecycle_status || '',
    matchedStatus: entry.matched_status || '',
    createdBy: entry.created_by_name || '',
    date: entry.created_at,
    branchId: entry.branch_id ? String(entry.branch_id) : '',
    locationId: entry.location_id ? String(entry.location_id) : '',
    branchName: entry.branch_name || '',
    locationName: entry.location_name || '',
    requiredDate: entry.required_date || null,
    currency: entry.currency || '',
    companyName: entry.company_name || '',
    contactId: entry.contact_id ? String(entry.contact_id) : '',
    shippingAddressId: entry.shipping_address_id ? String(entry.shipping_address_id) : '',
    costCenterId: entry.cost_center_id ? String(entry.cost_center_id) : '',
    projectId: entry.project_id ? String(entry.project_id) : '',
    importProjectId: (entry as any).import_project_id ? String((entry as any).import_project_id) : '',
    termsTemplate: entry.terms_template || '',
    items: byPurchase.get(String(entry.id)) || [],
    attachments: attachmentsByPurchase.get(String(entry.id)) || [],
  }));
}

export function filterPurchases(rows: PurchaseRow[], query: Record<string, unknown>): PurchaseRow[] {
  const q = String(query.search || query.q || '').trim().toLowerCase();
  const filter = String(query.filter || query.view || 'all').trim();
  return rows.filter((row) => {
    if (filter === 'cash' && row.paymentType !== 'cash') return false;
    if (filter === 'credit' && row.paymentType !== 'credit') return false;
    if (filter === 'cancelled' && row.status !== 'cancelled') return false;
    if (!q) return true;
    return [row.docNo, row.supplierName, row.status, row.paymentType, row.branchName, row.locationName, row.note]
      .some((value) => String(value || '').toLowerCase().includes(q));
  });
}

export function paginatePurchases(rows: PurchaseRow[], query: Record<string, unknown>, defaultSize = 25) {
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

export function summarizePurchases(rows: PurchaseRow[], digits: MoneyDigits = 2) {
  const topBySupplier = new Map<string, { name: string; total: number; count: number }>();
  for (const row of rows) {
    const key = String(row.supplierId || row.supplierName || 'unknown');
    const current = topBySupplier.get(key) || { name: String(row.supplierName || 'بدون مورد'), total: 0, count: 0 };
    current.total += Number(row.total || 0);
    current.count += 1;
    topBySupplier.set(key, current);
  }

  return {
    totalItems: rows.length,
    totalAmount: roundMoney(rows.reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    creditTotal: roundMoney(rows.filter((row) => row.paymentType === 'credit').reduce((sum, row) => sum + Number(row.total || 0), 0), digits),
    cancelledCount: rows.filter((row) => row.status === 'cancelled').length,
    posted: rows.filter((row) => row.status === 'posted').length,
    draft: rows.filter((row) => row.status !== 'posted').length,
    topSuppliers: [...topBySupplier.values()].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}
