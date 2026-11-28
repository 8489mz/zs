export type StockMovementRow = {
  id: unknown;
  product_id?: unknown;
  movement_type?: unknown;
  qty?: unknown;
  before_qty?: unknown;
  after_qty?: unknown;
  reason?: unknown;
  note?: unknown;
  reference_type?: unknown;
  reference_id?: unknown;
  branch_id?: unknown;
  location_id?: unknown;
  created_at?: unknown;
  product_name?: unknown;
  branch_name?: unknown;
  location_name?: unknown;
  created_by_name?: unknown;
};

export type DamagedStockRow = {
  id: unknown;
  product_id?: unknown;
  branch_id?: unknown;
  location_id?: unknown;
  qty?: unknown;
  unit_cost?: unknown;
  total_cost?: unknown;
  reason?: unknown;
  note?: unknown;
  evidence_image_url?: unknown;
  created_at?: unknown;
  product_name?: unknown;
  branch_name?: unknown;
  location_name?: unknown;
  created_by_name?: unknown;
  approved_by_name?: unknown;
};

export type StockCountItemRow = {
  id: unknown;
  session_id: unknown;
  product_id: unknown;
  product_name?: unknown;
  expected_qty?: unknown;
  counted_qty?: unknown;
  variance_qty?: unknown;
  counted_serials?: unknown;
  batch_counts?: unknown;
  reason?: unknown;
  note?: unknown;
};

export type StockCountSessionRow = {
  id: unknown;
  doc_no?: unknown;
  branch_id?: unknown;
  location_id?: unknown;
  status?: unknown;
  is_blind?: unknown;
  count_scope?: unknown;
  note?: unknown;
  posted_at?: unknown;
  created_at?: unknown;
  branch_name?: unknown;
  location_name?: unknown;
  counted_by_name?: unknown;
  approved_by_name?: unknown;
};

export function mapStockMovementRow(row: StockMovementRow) {
  return {
    id: String(row.id),
    productId: row.product_id ? String(row.product_id) : '',
    productName: String(row.product_name || ''),
    type: String(row.movement_type || ''),
    qty: Number(row.qty || 0),
    beforeQty: Number(row.before_qty || 0),
    afterQty: Number(row.after_qty || 0),
    reason: String(row.reason || ''),
    note: String(row.note || ''),
    referenceType: String(row.reference_type || ''),
    referenceId: row.reference_id ? String(row.reference_id) : '',
    branchId: row.branch_id ? String(row.branch_id) : '',
    branchName: String(row.branch_name || ''),
    locationId: row.location_id ? String(row.location_id) : '',
    locationName: String(row.location_name || ''),
    createdBy: String(row.created_by_name || ''),
    date: row.created_at,
  };
}

export function buildStockMovementSummary(rows: Array<{ qty: number }>) {
  return rows.reduce(
    (acc, row) => {
      const qty = Number(row.qty || 0);
      if (qty >= 0) acc.positive += qty;
      else acc.negative += Math.abs(qty);
      acc.totalItems += 1;
      return acc;
    },
    { positive: 0, negative: 0, totalItems: 0 },
  );
}

export function mapDamagedStockRow(row: DamagedStockRow) {
  return {
    id: String(row.id),
    productId: String(row.product_id || ''),
    productName: String(row.product_name || ''),
    branchId: row.branch_id ? String(row.branch_id) : '',
    branchName: String(row.branch_name || ''),
    locationId: row.location_id ? String(row.location_id) : '',
    locationName: String(row.location_name || ''),
    qty: Number(row.qty || 0),
    unitCost: Number(row.unit_cost || 0),
    totalCost: Number(row.total_cost || 0),
    reason: String(row.reason || 'damage'),
    note: String(row.note || ''),
    evidenceImageUrl: row.evidence_image_url ? String(row.evidence_image_url) : '',
    createdBy: String(row.created_by_name || ''),
    approvedBy: String(row.approved_by_name || ''),
    date: row.created_at,
  };
}

export function buildDamagedStockSummary(rows: Array<{ qty: number }>) {
  return {
    totalItems: rows.length,
    totalQty: Number(rows.reduce((sum, row) => sum + Number(row.qty || 0), 0).toFixed(3)),
  };
}

export function groupStockCountItemsBySession(items: StockCountItemRow[]) {
  const bySession = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = String(item.session_id);
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push({
      id: String(item.id),
      productId: String(item.product_id),
      productName: String(item.product_name || ''),
      expectedQty: Number(item.expected_qty || 0),
      countedQty: Number(item.counted_qty || 0),
      varianceQty: Number(item.variance_qty || 0),
      countedSerials: Array.isArray(item.counted_serials)
        ? item.counted_serials
        : typeof item.counted_serials === 'string'
          ? JSON.parse(item.counted_serials)
          : [],
      batchCounts: Array.isArray(item.batch_counts)
        ? item.batch_counts
        : typeof item.batch_counts === 'string'
          ? JSON.parse(item.batch_counts)
          : [],
      reason: String(item.reason || ''),
      note: String(item.note || ''),
    });
  }
  return bySession;
}

export function mapStockCountSessionRow(
  row: StockCountSessionRow,
  itemsBySession: Map<string, Record<string, unknown>[]>,
  hideBlindExpected = false,
) {
  const isBlind = Boolean(row.is_blind);
  const status = String(row.status || 'draft');
  const shouldMask = hideBlindExpected && isBlind && status !== 'posted';
  const rawItems = itemsBySession.get(String(row.id)) || [];
  const items = shouldMask
    ? rawItems.map((item) => ({
        ...item,
        expectedQty: null,
        varianceQty: null,
      }))
    : rawItems;

  return {
    id: String(row.id),
    docNo: row.doc_no ? String(row.doc_no) : `COUNT-${row.id}`,
    branchId: row.branch_id ? String(row.branch_id) : '',
    branchName: String(row.branch_name || ''),
    locationId: row.location_id ? String(row.location_id) : '',
    locationName: String(row.location_name || ''),
    status,
    isBlind,
    countScope: String(row.count_scope || 'standard'),
    note: String(row.note || ''),
    countedBy: String(row.counted_by_name || ''),
    approvedBy: String(row.approved_by_name || ''),
    postedAt: row.posted_at || '',
    createdAt: row.created_at,
    items,
  };
}

export function buildStockCountSummary(rows: Array<{ status: string; items: Array<{ varianceQty: number }> }>) {
  return {
    totalItems: rows.length,
    draft: rows.filter((row) => row.status === 'draft').length,
    posted: rows.filter((row) => row.status === 'posted').length,
    totalVariance: Number(
      rows
        .reduce((sum, row) => sum + row.items.reduce((itemSum, item) => itemSum + Number(item.varianceQty || 0), 0), 0)
        .toFixed(3),
    ),
  };
}
