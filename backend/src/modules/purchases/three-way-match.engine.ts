import { roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

/**
 * Three-Way Match Engine (AIA / IFRS / ISO 9001 Procurement Integrity Standard)
 * 
 * Invariants Enforced:
 * MATCH-1: Cumulative Invoiced Qty <= Cumulative Accepted GRN Qty (No over-billing or double-billing).
 * MATCH-2: Unit Price Variance vs PO must not exceed contractual tolerance percentage.
 *          Tolerated variance is posted to Purchase Price Variance (PPV - Account 5190).
 * MATCH-3: Service items (non-physical) exempt from GRN strictly with a signed Service Completion Certificate.
 * GRNI-1:  Goods Received Not Invoiced (GRNI - Account 2125) accrual upon GRN, cleared upon Invoice.
 *          Debit GRNI + Debit PPV + Debit VAT = Credit AP (Strict penny reconciliation).
 */

export type MatchStatus =
  | 'matched'
  | 'quantity_mismatch'
  | 'price_mismatch'
  | 'tolerance_exceeded'
  | 'unmatched_grn'
  | 'service_approved'
  | 'service_rejected'
  | 'override_approved';

export interface PurchaseOrderItem {
  id: number;
  productId: number;
  qty: number;
  unitCost: number;
  isService?: boolean;
}

export interface GoodsReceiptLine {
  id: number;
  grnId: number;
  poItemId?: number;
  productId: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unitCost: number;
}

export interface InvoiceItemToMatch {
  id?: number;
  poItemId?: number;
  grnLineId?: number;
  productId: number;
  qty: number;
  unitCost: number;
}

export interface HistoricalInvoicedLine {
  poItemId?: number;
  productId: number;
  qty: number;
}

/** Machine-readable blocking reasons. Status is derived from these, never from message prose. */
export type BlockingCode =
  | 'NO_GRN'
  | 'QTY_EXCEEDS_RECEIPT'
  | 'PRICE_TOLERANCE_EXCEEDED'
  | 'SERVICE_CERT_MISSING'
  | 'RECONCILIATION_DISCREPANCY'
  | 'INVALID_PO_LINE'
  | 'INVALID_GRN_LINE';

export interface BlockingIssue {
  code: BlockingCode;
  productId: number;
  message: string;
}

/**
 * How far an override may reach.
 * 'price_only' relaxes price tolerance alone — a commercial judgement call.
 * 'full' also relaxes quantity/GRN blocks, i.e. paying for goods never received. That is the exact
 * fraud MATCH-1 exists to stop, so it is deliberately a separate, higher authority.
 */
export type OverrideScope = 'price_only' | 'full';

const PRICE_ONLY_CODES: ReadonlySet<BlockingCode> = new Set<BlockingCode>(['PRICE_TOLERANCE_EXCEEDED']);

export interface ThreeWayMatchInput {
  poItems: PurchaseOrderItem[];
  grnLines: GoodsReceiptLine[];
  invoiceItems: InvoiceItemToMatch[];
  historicalInvoicedLines?: HistoricalInvoicedLine[];
  isServiceItem?: boolean;
  serviceCompletionRef?: string;
  tolerancePercentage?: number; // e.g. 2 for 2%
  /** Tenant book precision (2 or 3). Required, not defaulted: the final
   *  reconciliation rounds to it, so a silent 2 default would reintroduce
   *  the GRNI rounding loss inside the gate meant to catch it. */
  minorUnits: MoneyDigits;
  /** Per-line VAT rates keyed by productId; falls back to vatRate. Mixed-rate invoices are common. */
  vatRateByProduct?: Record<number, number>;
  /**
   * The invoice's own VAT rate as a fraction (e.g. 0.14 for 14%).
   * REQUIRED — no default: the old 0.14 default silently verified
   * every bill at 14%, so an exempt or 15% bill's VAT and payable
   * totals were misreported by the gate meant to catch exactly that.
   * The caller passes the bill's stored tax_rate.
   */
  vatRate: number;
  /**
   * When true, invoice line totals already include VAT, so the VAT leg
   * extracts it (lineTotal - lineTotal / (1 + rate)) instead of adding
   * it. The GRNI/PPV legs are basis-consistent either way and are
   * untouched. Defaults to false (exclusive prices).
   */
  pricesIncludeTax?: boolean;
  allowOverride?: boolean;
  overrideReason?: string;
  overrideScope?: OverrideScope;
}

export interface MatchedLineResult {
  productId: number;
  poItemId?: number;
  grnLineId?: number;
  invoicedQty: number;
  acceptedGrnQty: number;
  priorInvoicedQty: number;
  cumulativeInvoicedQty: number;
  poUnitCost: number;
  invoicedUnitCost: number;
  priceDelta: number;
  priceDeltaPct: number;
  linePpv: number;
  lineGrniClearing: number;
  lineTotal: number;
  status: MatchStatus;
  notes?: string;
}

export interface ThreeWayMatchResult {
  overallStatus: MatchStatus;
  isValidForPosting: boolean;
  totalInvoicedAmount: number;
  totalGrniClearing: number;
  totalPpv: number; // Positive = Unfavorable (Debit Expense), Negative = Favorable (Credit Gain)
  totalVat: number;
  totalAccountsPayable: number;
  reconciliationDiscrepancy: number;
  tolerancePercentage: number;
  lines: MatchedLineResult[];
  blockingReasons: string[];
  /** Structured counterpart of blockingReasons; this is what callers must branch on. */
  blockingIssues: BlockingIssue[];
  blockingCodes: BlockingCode[];
}

export function computeThreeWayMatch(input: ThreeWayMatchInput): ThreeWayMatchResult {
  const tolerance = Number(input.tolerancePercentage ?? 2); // Default 2% tolerance
  const minorUnits = input.minorUnits;
  if (minorUnits !== 2 && minorUnits !== 3) throw new Error('Three-way match requires tenant minor units (2 or 3)');
  const vatRate = Number(input.vatRate);
  if (!Number.isFinite(vatRate) || vatRate < 0) {
    throw new Error('Three-way match requires the invoice VAT rate as a finite fraction (0 or greater)');
  }
  const isService = Boolean(input.isServiceItem);
  const serviceRef = String(input.serviceCompletionRef || '').trim();

  const blockingIssues: BlockingIssue[] = [];
  const lines: MatchedLineResult[] = [];
  const block = (code: BlockingCode, productId: number, message: string) => {
    blockingIssues.push({ code, productId, message });
  };

  // Index PO items by id and by productId
  const poItemById = new Map<number, PurchaseOrderItem>();
  const poItemsByProduct = new Map<number, PurchaseOrderItem[]>();
  for (const poItem of input.poItems) {
    poItemById.set(poItem.id, poItem);
    const existing = poItemsByProduct.get(poItem.productId) || [];
    existing.push(poItem);
    poItemsByProduct.set(poItem.productId, existing);
  }
  // Deterministic fallback order when a PO repeats a product at different prices: cheapest first,
  // then by id. Picking [0] (insertion order) silently valued everything at an arbitrary line.
  for (const [, items] of poItemsByProduct) {
    items.sort((a, b) => (Number(a.unitCost) - Number(b.unitCost)) || (Number(a.id) - Number(b.id)));
  }

  // Aggregate accepted GRN quantities by (poItemId / productId)
  const grnAcceptedByPoItem = new Map<number, number>();
  const grnAcceptedByProduct = new Map<number, number>();
  const grnLineById = new Map(input.grnLines.map((line) => [line.id, line]));
  for (const grnLine of input.grnLines) {
    const accepted = Number(grnLine.acceptedQty || 0);
    if (grnLine.poItemId) {
      grnAcceptedByPoItem.set(grnLine.poItemId, (grnAcceptedByPoItem.get(grnLine.poItemId) || 0) + accepted);
    }
    grnAcceptedByProduct.set(grnLine.productId, (grnAcceptedByProduct.get(grnLine.productId) || 0) + accepted);
  }

  // Aggregate historical invoiced quantities
  const priorInvoicedByPoItem = new Map<number, number>();
  const priorInvoicedByProduct = new Map<number, number>();
  const priorUnlinkedByProduct = new Map<number, number>();
  if (input.historicalInvoicedLines) {
    for (const hLine of input.historicalInvoicedLines) {
      const q = Number(hLine.qty || 0);
      if (hLine.poItemId) {
        priorInvoicedByPoItem.set(hLine.poItemId, (priorInvoicedByPoItem.get(hLine.poItemId) || 0) + q);
      } else {
        priorUnlinkedByProduct.set(hLine.productId, (priorUnlinkedByProduct.get(hLine.productId) || 0) + q);
      }
      priorInvoicedByProduct.set(hLine.productId, (priorInvoicedByProduct.get(hLine.productId) || 0) + q);
    }
  }

  let totalGrniClearing = 0;
  let totalPpv = 0;
  let totalInvoicedAmount = 0;
  let totalVat = 0;

  // Consumption ledger for THIS invoice. Without it, two lines of the same product in one invoice
  // each saw the full GRN quantity, so splitting a line defeated MATCH-1 entirely.
  const consumedByPoItem = new Map<number, number>();
  const consumedByProduct = new Map<number, number>();

  // Process each invoice item
  for (const invItem of input.invoiceItems) {
    const invQty = Number(invItem.qty || 0);
    const invCost = Number(invItem.unitCost || 0);

    // Resolve matching PO item
    let matchedPoItem: PurchaseOrderItem | undefined;
    if (invItem.poItemId) {
      matchedPoItem = poItemById.get(invItem.poItemId);
      if (!matchedPoItem || matchedPoItem.productId !== invItem.productId) {
        block('INVALID_PO_LINE', invItem.productId, `بند أمر الشراء ${invItem.poItemId} لا يطابق صنف الفاتورة ${invItem.productId}.`);
        matchedPoItem = undefined;
      }
    }
    if (!invItem.poItemId && poItemsByProduct.has(invItem.productId)) {
      const matching = poItemsByProduct.get(invItem.productId)!;
      if (matching.length === 1) matchedPoItem = matching[0];
      else block('INVALID_PO_LINE', invItem.productId, `الصنف ${invItem.productId} مكرر في أمر الشراء؛ حدد بند الأمر في الفاتورة.`);
    }
    if (input.poItems.length && !matchedPoItem) {
      block('INVALID_PO_LINE', invItem.productId, `لا يوجد بند مطابق للصنف ${invItem.productId} في أمر الشراء.`);
    }
    if (invItem.grnLineId) {
      const referenced = grnLineById.get(invItem.grnLineId);
      if (!referenced || referenced.productId !== invItem.productId ||
          (matchedPoItem && referenced.poItemId !== matchedPoItem.id)) {
        block('INVALID_GRN_LINE', invItem.productId, `بند الاستلام ${invItem.grnLineId} لا يطابق بند الفاتورة وأمر الشراء.`);
      }
    }

    const poUnitCost = matchedPoItem ? Number(matchedPoItem.unitCost) : invCost;
    const itemIsService = isService || Boolean(matchedPoItem?.isService);

    // Prior invoiced (other invoices) + already consumed by earlier lines of THIS invoice.
    const priorFromHistory = matchedPoItem
      ? (priorInvoicedByPoItem.get(matchedPoItem.id) || 0) + (priorUnlinkedByProduct.get(invItem.productId) || 0)
      : (priorInvoicedByProduct.get(invItem.productId) || 0);
    const priorFromThisInvoice = matchedPoItem
      ? (consumedByPoItem.get(matchedPoItem.id) || 0)
      : (consumedByProduct.get(invItem.productId) || 0);

    const priorQty = Number((priorFromHistory + priorFromThisInvoice).toFixed(4));
    const cumulativeInvoicedQty = Number((priorQty + invQty).toFixed(4));

    if (matchedPoItem) {
      consumedByPoItem.set(matchedPoItem.id, priorFromThisInvoice + invQty);
    } else {
      consumedByProduct.set(invItem.productId, priorFromThisInvoice + invQty);
    }

    // Only count receipts that belong to the matched PO line. Falling back to product-wide receipts
    // let an invoice match against a DIFFERENT purchase order's delivery of the same product.
    const acceptedGrnQty = matchedPoItem
      ? (grnAcceptedByPoItem.get(matchedPoItem.id) || 0)
      : (grnAcceptedByProduct.get(invItem.productId) || 0);

    let lineStatus: MatchStatus = 'matched';
    let note = '';

    // MATCH-3: Service Exception Check
    if (itemIsService) {
      if (!serviceRef) {
        lineStatus = 'service_rejected';
        block('SERVICE_CERT_MISSING', invItem.productId, `البند الخدمي (كود ${invItem.productId}) يفتقر لشهادة إنجاز خدمة معتمدة.`);
      } else {
        lineStatus = 'service_approved';
        note = `تم الاعتماد كبند خدمي بموجب شهادة إنجاز: ${serviceRef}`;
      }
    } else {
      // MATCH-1: Cumulative Received vs Invoiced
      if (acceptedGrnQty === 0 && invQty > 0) {
        lineStatus = 'unmatched_grn';
        block('NO_GRN', invItem.productId, `البند (كود ${invItem.productId}) لا يوجد له أي محضر استلام مخزني (GRN) معتمد.`);
      } else if (cumulativeInvoicedQty > acceptedGrnQty + 0.0001) {
        lineStatus = 'quantity_mismatch';
        const excess = Number((cumulativeInvoicedQty - acceptedGrnQty).toFixed(4));
        block(
          'QTY_EXCEEDS_RECEIPT',
          invItem.productId,
          `تجاوز كمية الاستلام: الكمية المفوترة التراكمية (${cumulativeInvoicedQty}) تتجاوز الكمية المستلمة المقبولة (${acceptedGrnQty}) بمقدار ${excess}.`,
        );
      }
    }

    // MATCH-2: Price Delta & Tolerance.
    // Only OVERCHARGING is blocked. A supplier invoicing below the agreed price is a favourable
    // variance in the buyer's favour; blocking it (as Math.abs did) just stalls valid payments.
    const priceDelta = Number((invCost - poUnitCost).toFixed(4));
    const priceDeltaPct = poUnitCost > 0 ? Number((priceDelta / poUnitCost * 100).toFixed(2)) : 0;

    if (lineStatus === 'matched' || lineStatus === 'service_approved') {
      if (priceDeltaPct > tolerance) {
        lineStatus = 'tolerance_exceeded';
        block(
          'PRICE_TOLERANCE_EXCEEDED',
          invItem.productId,
          `تجاوز حد التسامح السعري للبند (كود ${invItem.productId}): الفرق ${priceDeltaPct}% يتجاوز الحد المسموح ${tolerance}%.`,
        );
      } else if (Math.abs(priceDelta) > 0.0001) {
        note = note ? `${note} | فرق سعر مسموح (${priceDeltaPct}%)` : `فرق سعر مسموح (${priceDeltaPct}%)`;
      }
    }

    // Financial lines calculation
    const lineGrni = Number((invQty * poUnitCost).toFixed(4));
    const linePpv = Number((invQty * priceDelta).toFixed(4));
    const lineTotal = Number((invQty * invCost).toFixed(4));

    // Per-line VAT: a single flat rate on the invoice total mis-taxes mixed-rate invoices
    // (standard / zero-rated / exempt all coexist under both Egyptian and Saudi VAT law).
    const lineVatRate = Number(input.vatRateByProduct?.[invItem.productId] ?? vatRate);
    // Tax-inclusive lines already carry the VAT inside lineTotal: extract
    // it instead of adding a second VAT on top of the tax.
    totalVat += input.pricesIncludeTax
      ? lineTotal - lineTotal / (1 + lineVatRate)
      : lineTotal * lineVatRate;

    totalGrniClearing += lineGrni;
    totalPpv += linePpv;
    totalInvoicedAmount += lineTotal;

    lines.push({
      productId: invItem.productId,
      poItemId: matchedPoItem?.id,
      grnLineId: invItem.grnLineId,
      invoicedQty: invQty,
      acceptedGrnQty,
      priorInvoicedQty: priorQty,
      cumulativeInvoicedQty,
      poUnitCost,
      invoicedUnitCost: invCost,
      priceDelta,
      priceDeltaPct,
      linePpv,
      lineGrniClearing: lineGrni,
      lineTotal,
      status: lineStatus,
      notes: note || undefined,
    });
  }

  // Strict Double-Entry Reconciliation
  const roundedTotalInvoiced = roundMoney(totalInvoicedAmount, minorUnits);
  const roundedGrniClearing = roundMoney(totalGrniClearing, minorUnits);
  const roundedPpv = roundMoney(totalPpv, minorUnits);
  const roundedVat = roundMoney(totalVat, minorUnits);
  // Payable is what the supplier is owed: the invoiced total already
  // carries the VAT when prices include tax, so adding the extracted
  // VAT again would double-count the payable.
  const totalAccountsPayable = input.pricesIncludeTax
    ? roundedTotalInvoiced
    : roundMoney(roundedTotalInvoiced + roundedVat, minorUnits);

  // Reconciliation: Invoiced Subtotal MUST equal GRNI Clearing + PPV.
  // This was previously computed, returned, and then ignored — "strict penny reconciliation"
  // that blocked nothing. An unreconciled invoice must not post.
  const discrepancy = roundMoney(roundedTotalInvoiced - (roundedGrniClearing + roundedPpv), minorUnits);
  // Same tolerance as before, expressed in minor units: at most one minor
  // unit of rounding residue is tolerated (0.01 at 2dp, 0.001 at 3dp).
  if (Math.abs(discrepancy) > 10 ** -minorUnits) {
    block(
      'RECONCILIATION_DISCREPANCY',
      0,
      `عدم تطابق محاسبي: إجمالي الفاتورة (${roundedTotalInvoiced}) لا يساوي تصفية GRNI (${roundedGrniClearing}) مضافاً إليها فرق السعر (${roundedPpv}). الفارق: ${discrepancy}.`,
    );
  }

  // Determine overall status from structured codes, never from message text.
  const codes = blockingIssues.map((i) => i.code);
  const hasCode = (c: BlockingCode) => codes.includes(c);

  let overallStatus: MatchStatus = 'matched';
  if (hasCode('INVALID_PO_LINE') || hasCode('INVALID_GRN_LINE') || hasCode('QTY_EXCEEDS_RECEIPT') || hasCode('NO_GRN')) {
    overallStatus = 'quantity_mismatch';
  } else if (hasCode('PRICE_TOLERANCE_EXCEEDED')) {
    overallStatus = 'tolerance_exceeded';
  } else if (hasCode('SERVICE_CERT_MISSING')) {
    overallStatus = 'service_rejected';
  } else if (hasCode('RECONCILIATION_DISCREPANCY')) {
    overallStatus = 'price_mismatch';
  } else if (lines.length > 0 && lines.every((l) => l.status === 'service_approved')) {
    overallStatus = 'service_approved';
  }

  // Override, scoped by authority.
  // A 'price_only' override can never clear a quantity/GRN block: paying for goods that were never
  // received is a different decision from accepting a price variance, and must not share a switch.
  // A reconciliation discrepancy is an arithmetic failure and is never overridable.
  let isValidForPosting = blockingIssues.length === 0;
  if (!isValidForPosting && input.allowOverride && String(input.overrideReason || '').trim()) {
    const scope: OverrideScope = input.overrideScope === 'full' ? 'full' : 'price_only';
    const overridable = codes.every((c) =>
      c === 'RECONCILIATION_DISCREPANCY' || c === 'INVALID_PO_LINE' || c === 'INVALID_GRN_LINE'
        ? false : scope === 'full' ? true : PRICE_ONLY_CODES.has(c),
    );
    if (overridable) {
      overallStatus = 'override_approved';
      isValidForPosting = true;
    }
  }

  return {
    overallStatus,
    isValidForPosting,
    totalInvoicedAmount: roundedTotalInvoiced,
    totalGrniClearing: roundedGrniClearing,
    totalPpv: roundedPpv,
    totalVat: roundedVat,
    totalAccountsPayable,
    reconciliationDiscrepancy: Math.abs(discrepancy),
    tolerancePercentage: tolerance,
    lines,
    blockingReasons: blockingIssues.map((i) => i.message),
    blockingIssues,
    blockingCodes: Array.from(new Set(codes)),
  };
}
