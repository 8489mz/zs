/**
 * Pure calculation engine for Enterprise Loss Prevention:
 * 1. Cashier Peer Benchmarking (Sweethearting / Unscanned-Item Anomaly Detection)
 * 2. Structured Cart Snapshot formatting & parsing for audit / CCTV review
 */

export interface AuditSnapshotItem {
  productId?: number;
  productName: string;
  qty: number;
  previousQty?: number;
  unitName?: string;
  unitPrice: number;
  lineTotal: number;
  discount?: number;
}

export interface CashierSalesMetricInput {
  cashierId: number;
  cashierName: string;
  salesCount: number;
  totalRevenue: number;
  totalLineItems: number;
  suspiciousEventsCount: number;
  returnsCount: number;
}

export interface CashierPeerBenchmarkResult {
  cashierId: number;
  cashierName: string;
  salesCount: number;
  avgTicket: number;
  peerAvgTicket: number;
  avgTicketDeltaPercent: number;
  avgItemsPerSale: number;
  peerAvgItemsPerSale: number;
  avgItemsDeltaPercent: number;
  suspiciousPer100Sales: number;
  anomalyFlags: string[];
  anomalyLevel: 'normal' | 'watch' | 'alert';
}

export interface PeerBenchmarkSummary {
  peerAvgTicket: number;
  peerAvgItemsPerSale: number;
  eligibleCashiersCount: number;
  flaggedCashiersCount: number;
  cashiers: CashierPeerBenchmarkResult[];
}

const SNAPSHOT_MARKER = '::ITEMS_JSON::';

export function roundMetric(val: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round((Number(val) || 0) * factor) / factor;
}

export function normalizeSnapshotItems(rawItems: unknown): AuditSnapshotItem[] {
  if (!Array.isArray(rawItems)) return [];
  const normalized: AuditSnapshotItem[] = [];
  for (const raw of rawItems.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const productName = String(entry.productName ?? entry.name ?? '').trim();
    if (!productName) continue;
    const qty = Number(entry.qty ?? 0);
    const unitPrice = Number(entry.unitPrice ?? entry.price ?? 0);
    const lineTotal =
      entry.lineTotal !== undefined && Number.isFinite(Number(entry.lineTotal))
        ? Number(entry.lineTotal)
        : roundMetric(qty * unitPrice, 3);
    normalized.push({
      ...(Number(entry.productId || 0) > 0 ? { productId: Number(entry.productId) } : {}),
      productName,
      qty: Number.isFinite(qty) ? roundMetric(qty, 3) : 0,
      ...(entry.previousQty !== undefined && Number.isFinite(Number(entry.previousQty))
        ? { previousQty: roundMetric(Number(entry.previousQty), 3) }
        : {}),
      ...(entry.unitName ? { unitName: String(entry.unitName).trim() } : {}),
      unitPrice: Number.isFinite(unitPrice) ? roundMetric(unitPrice, 3) : 0,
      lineTotal: Number.isFinite(lineTotal) ? roundMetric(lineTotal, 3) : 0,
      ...(entry.discount !== undefined && Number(entry.discount) > 0
        ? { discount: roundMetric(Number(entry.discount), 3) }
        : {}),
    });
  }
  return normalized;
}

/**
 * Formats a concise human-readable Arabic line summary of cart items
 * AND appends a compact machine-readable JSON marker for tabular UI expansion.
 */
export function buildSnapshotAuditText(
  headerParts: string[],
  items: AuditSnapshotItem[],
  moneyDigits = 2,
): string {
  const cleanHeader = headerParts.filter(Boolean).join(' | ');
  if (!items.length) return cleanHeader;

  const previewItems = items.slice(0, 8).map((it) => {
    const unitSuffix = it.unitName ? ` ${it.unitName}` : '';
    const qtyPart =
      it.previousQty !== undefined
        ? `(${it.previousQty} ← ${it.qty}${unitSuffix})`
        : `× ${it.qty}${unitSuffix}`;
    return `${it.productName} ${qtyPart} بسعر ${roundMetric(it.unitPrice, moneyDigits)} = ${roundMetric(it.lineTotal, moneyDigits)}`;
  });
  const overflowNote = items.length > 8 ? ` (+${items.length - 8} أصناف أخرى)` : '';
  const readableItems = `الأصناف: ${previewItems.join(' ، ')}${overflowNote}`;
  const serialized = JSON.stringify(items);
  return `${cleanHeader} | ${readableItems} ${SNAPSHOT_MARKER}${serialized}`;
}

export function extractSnapshotFromDetails(rawDetails: string | null | undefined): {
  cleanText: string;
  items: AuditSnapshotItem[];
} {
  const text = String(rawDetails || '');
  const idx = text.indexOf(SNAPSHOT_MARKER);
  if (idx < 0) {
    return { cleanText: text, items: [] };
  }
  const cleanText = text.slice(0, idx).trim();
  const jsonPart = text.slice(idx + SNAPSHOT_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    return { cleanText, items: normalizeSnapshotItems(parsed) };
  } catch {
    return { cleanText, items: [] };
  }
}

/**
 * Evaluates cashier peer benchmarks to surface statistical sweethearting
 * (passing items around the scanner or scanning 2 out of 5 items).
 * Requires at least 2 active cashiers with >= minSalesForBenchmark sales each
 * to establish a fair peer average without false positives on quiet days.
 */
export function evaluateCashierPeerBenchmarks(
  inputs: CashierSalesMetricInput[],
  options: { minSalesForBenchmark?: number; dropAlertThresholdPercent?: number; dropWatchThresholdPercent?: number } = {},
): PeerBenchmarkSummary {
  const minSales = Math.max(5, options.minSalesForBenchmark ?? 15);
  const alertDrop = options.dropAlertThresholdPercent ?? -25;
  const watchDrop = options.dropWatchThresholdPercent ?? -15;

  const eligible = inputs.filter((c) => c.salesCount >= minSales);
  const totalSalesAll = eligible.reduce((s, c) => s + c.salesCount, 0);
  const totalRevenueAll = eligible.reduce((s, c) => s + c.totalRevenue, 0);
  const totalLinesAll = eligible.reduce((s, c) => s + c.totalLineItems, 0);

  const peerAvgTicket = totalSalesAll > 0 ? roundMetric(totalRevenueAll / totalSalesAll, 2) : 0;
  const peerAvgItemsPerSale = totalSalesAll > 0 ? roundMetric(totalLinesAll / totalSalesAll, 2) : 0;
  const hasMultiCashierPeerBaseline = eligible.length >= 2 && peerAvgTicket > 0;

  let flaggedCashiersCount = 0;

  const cashiers: CashierPeerBenchmarkResult[] = inputs
    .filter((c) => c.salesCount > 0 || c.suspiciousEventsCount > 0)
    .map((c) => {
      const avgTicket = c.salesCount > 0 ? roundMetric(c.totalRevenue / c.salesCount, 2) : 0;
      const avgItemsPerSale = c.salesCount > 0 ? roundMetric(c.totalLineItems / c.salesCount, 2) : 0;
      const suspiciousPer100Sales =
        c.salesCount > 0 ? roundMetric((c.suspiciousEventsCount / c.salesCount) * 100, 1) : 0;

      // Leave-one-out peer average when >= 2 eligible cashiers so a suspect cashier doesn't skew their own baseline
      let ownPeerTicket = peerAvgTicket;
      let ownPeerItems = peerAvgItemsPerSale;
      if (hasMultiCashierPeerBaseline && c.salesCount >= minSales) {
        const othersSales = totalSalesAll - c.salesCount;
        if (othersSales > 0) {
          ownPeerTicket = roundMetric((totalRevenueAll - c.totalRevenue) / othersSales, 2);
          ownPeerItems = roundMetric((totalLinesAll - c.totalLineItems) / othersSales, 2);
        }
      }

      const avgTicketDeltaPercent =
        ownPeerTicket > 0 && c.salesCount >= minSales
          ? roundMetric(((avgTicket - ownPeerTicket) / ownPeerTicket) * 100, 1)
          : 0;
      const avgItemsDeltaPercent =
        ownPeerItems > 0 && c.salesCount >= minSales
          ? roundMetric(((avgItemsPerSale - ownPeerItems) / ownPeerItems) * 100, 1)
          : 0;

      const anomalyFlags: string[] = [];
      let anomalyLevel: 'normal' | 'watch' | 'alert' = 'normal';

      if (hasMultiCashierPeerBaseline && c.salesCount >= minSales) {
        if (avgTicketDeltaPercent <= alertDrop) {
          anomalyFlags.push(`متوسط الفاتورة أقل من الزملاء بنسبة ${Math.abs(avgTicketDeltaPercent)}%`);
          anomalyLevel = 'alert';
        } else if (avgTicketDeltaPercent <= watchDrop) {
          anomalyFlags.push(`انخفاض متوسط الفاتورة بنسبة ${Math.abs(avgTicketDeltaPercent)}% عن المتوسط`);
          anomalyLevel = 'watch';
        }

        if (avgItemsDeltaPercent <= alertDrop) {
          anomalyFlags.push(`متوسط عدد الأصناف بالفاتورة أقل بنسبة ${Math.abs(avgItemsDeltaPercent)}% (احتمال تمرير دون مسح)`);
          anomalyLevel = 'alert';
        } else if (avgItemsDeltaPercent <= watchDrop) {
          anomalyFlags.push(`انخفاض عدد الأصناف بالفاتورة بنسبة ${Math.abs(avgItemsDeltaPercent)}%`);
          if (anomalyLevel === 'normal') anomalyLevel = 'watch';
        }
      }

      if (c.salesCount >= 10 && suspiciousPer100Sales >= 15) {
        anomalyFlags.push(`معدل شبهات مرتفع (${suspiciousPer100Sales} لكل 100 فاتورة)`);
        anomalyLevel = 'alert';
      } else if (c.salesCount >= 10 && suspiciousPer100Sales >= 8) {
        anomalyFlags.push(`معدل شبهات ملحوظ (${suspiciousPer100Sales} لكل 100 فاتورة)`);
        if (anomalyLevel === 'normal') anomalyLevel = 'watch';
      }

      if (anomalyLevel === 'alert') flaggedCashiersCount++;

      return {
        cashierId: c.cashierId,
        cashierName: c.cashierName,
        salesCount: c.salesCount,
        avgTicket,
        peerAvgTicket: ownPeerTicket,
        avgTicketDeltaPercent,
        avgItemsPerSale,
        peerAvgItemsPerSale: ownPeerItems,
        avgItemsDeltaPercent,
        suspiciousPer100Sales,
        anomalyFlags,
        anomalyLevel,
      };
    })
    .sort((a, b) => {
      const rank = { alert: 0, watch: 1, normal: 2 };
      if (rank[a.anomalyLevel] !== rank[b.anomalyLevel]) return rank[a.anomalyLevel] - rank[b.anomalyLevel];
      return a.avgTicketDeltaPercent - b.avgTicketDeltaPercent;
    });

  return {
    peerAvgTicket,
    peerAvgItemsPerSale,
    eligibleCashiersCount: eligible.length,
    flaggedCashiersCount,
    cashiers,
  };
}
