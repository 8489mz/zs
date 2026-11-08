import { AppError } from '../../../common/errors/app-error';
import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';

type CashDrawerQuery = Record<string, unknown>;
type CashDrawerMappedRow = Record<string, unknown>;

type CashDrawerShiftSource = {
  id?: number | string;
  doc_no?: string | null;
  branch_id?: number | string | null;
  location_id?: number | string | null;
  opened_by?: number | string | null;
  cash_sales_total?: number | string | null;
  card_sales_total?: number | string | null;
  wallet_sales_total?: number | string | null;
  instapay_sales_total?: number | string | null;
  credit_sales_total?: number | string | null;
  delivery_sales_total?: number | string | null;
  delivery_fee_total?: number | string | null;
  freelance_delivery_fee_total?: number | string | null;
  store_delivery_fee_total?: number | string | null;
  net_store_sales_total?: number | string | null;
  shift_sales_total?: number | string | null;
  tip_sales_total?: number | string | null;
  sale_count?: number | string | null;
  mixed_sale_count?: number | string | null;
  card_operation_count?: number | string | null;
  wallet_operation_count?: number | string | null;
  instapay_operation_count?: number | string | null;
  cash_drawer_movement_total?: number | string | null;
  cash_drawer_cash_in_total?: number | string | null;
  cash_drawer_delivery_cash_in_total?: number | string | null;
  cash_drawer_manual_cash_in_total?: number | string | null;
  cash_drawer_cash_out_total?: number | string | null;
  sale_cash_total?: number | string | null;
  supplier_payments_total?: number | string | null;
  expenses_total?: number | string | null;
  service_cash_total?: number | string | null;
  service_card_total?: number | string | null;
  service_total?: number | string | null;
  sale_return_cash_refund_total?: number | string | null;
  sale_return_card_refund_total?: number | string | null;
  sale_return_total?: number | string | null;
  opening_cash?: number | string | null;
  opening_note?: string | null;
  status?: string | null;
  expected_cash?: number | string | null;
  counted_cash?: number | string | null;
  variance?: number | string | null;
  close_note?: string | null;
  closed_by?: number | string | null;
  closed_by_name?: string | null;
  closed_at?: Date | string | null;
  created_at?: Date | string | null;
  branch_name?: string | null;
  location_name?: string | null;
  opened_by_name?: string | null;
  movement_items?: Array<{ id: string; kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return'; kindLabel: string; amount: number; note: string; createdAt: string }>;
};

const BLIND_CLOSE_PREFIX = 'BLIND_CLOSE::';

type BlindCloseOperationDetail = {
  amount: number;
  reference?: string;
};

type BlindClosePayload = {
  blindClose: true;
  declared?: {
    cash?: number;
    cardTotal?: number;
    cardCount?: number;
    walletTotal?: number;
    walletCount?: number;
    instapayTotal?: number;
    instapayCount?: number;
  };
  detailTotals?: {
    card?: number;
    wallet?: number;
    instapay?: number;
  };
  details?: {
    card?: BlindCloseOperationDetail[];
    wallet?: BlindCloseOperationDetail[];
    instapay?: BlindCloseOperationDetail[];
  };
  managerReview?: {
    note?: string;
    reviewedById?: number;
    reviewedByName?: string;
    reviewedAt?: string;
  };
  /**
   * INV-BLIND-CLOSE-DECLARED-RECONCILIATION: the authoritative
   * declared-vs-computed reconciliation, written by manager review
   * at book digits. The review dialog's client-side diff is
   * transient and 2dp; this record is durable and survives the
   * review. Absent on shifts closed before the package, and on
   * non-blind closes.
   */
  reconciliation?: BlindCloseReconciliation;
  note?: string;
};

export type BlindCloseChannelReconciliation = {
  declared: number;
  computed: number;
  delta: number;
  declaredCount: number;
  computedCount: number;
  countDelta: number;
};

export type BlindCloseReconciliation = {
  card: BlindCloseChannelReconciliation;
  wallet: BlindCloseChannelReconciliation;
  instapay: BlindCloseChannelReconciliation;
};

type ParsedCloseNote = {
  raw: string;
  hasBlindPrefix: boolean;
  isBlindMetadataValid: boolean;
  note: string;
  blindClose: BlindClosePayload | null;
};

export function paginateCashDrawerRows<T>(rows: T[], query: CashDrawerQuery): { rows: T[]; pagination: Record<string, number> } {
  const rawPage = Number(query.page || 1);
  const rawPageSize = Number(query.pageSize || 20);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(100, Math.max(1, Math.floor(rawPageSize))) : 20;
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const sliced = rows.slice(start, start + pageSize);
  return {
    rows: sliced,
    pagination: {
      page: safePage,
      pageSize,
      totalItems,
      totalPages,
      rangeStart: totalItems ? start + 1 : 0,
      rangeEnd: totalItems ? start + sliced.length : 0,
    },
  };
}

function cashDrawerDateKey(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
  return String(value || '').slice(0, 10);
}

export function filterCashDrawerRows(rows: CashDrawerMappedRow[], query: CashDrawerQuery): CashDrawerMappedRow[] {
  const search = String(query.search || '').trim().toLowerCase();
  const filter = String(query.filter || (query as any).status || 'all').trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter((row) => {
    const status = String(row.status || '');
    const variance = Number(row.variance || 0);
    if (filter === 'open' && status !== 'open') return false;
    if (filter === 'closed' && status !== 'closed') return false;
    if (filter === 'pending_review' && status !== 'pending_review') return false;
    if (filter === 'variance' && Math.abs(variance) <= 0) return false;
    if (filter === 'today' && cashDrawerDateKey(row.openedAt || row.createdAt) !== today) return false;
    if (!search) return true;
    return [row.docNo, row.status, row.branchName, row.locationName, row.openedByName, row.openingNote, row.closeNote].some((value) => String(value || '').toLowerCase().includes(search));
  });
}

function parseBlindCloseNote(rawNote: unknown): ParsedCloseNote {
  const text = String(rawNote || '');
  if (!text.startsWith(BLIND_CLOSE_PREFIX)) {
    return { raw: text, hasBlindPrefix: false, isBlindMetadataValid: false, note: text, blindClose: null };
  }

  const rawJson = text.slice(BLIND_CLOSE_PREFIX.length).trim();
  if (!rawJson) {
    return { raw: text, hasBlindPrefix: true, isBlindMetadataValid: false, note: '', blindClose: null };
  }

  try {
    const parsed = JSON.parse(rawJson) as BlindClosePayload;
    if (!parsed || typeof parsed !== 'object') {
      return { raw: text, hasBlindPrefix: true, isBlindMetadataValid: false, note: '', blindClose: null };
    }
    return {
      raw: text,
      hasBlindPrefix: true,
      isBlindMetadataValid: true,
      note: String(parsed.note || ''),
      blindClose: parsed,
    };
  } catch {
    return { raw: text, hasBlindPrefix: true, isBlindMetadataValid: false, note: '', blindClose: null };
  }
}

function normalizeBlindOperationList(value: unknown): BlindCloseOperationDetail[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const amount = Number((entry as { amount?: unknown })?.amount || 0);
    const reference = String((entry as { reference?: unknown })?.reference || '').trim();
    return {
      // INV-BLIND-CLOSE-DECLARED-RECONCILIATION: the stored amount is
      // kept whole. The old toFixed(2) re-truncated 3-decimal declared
      // detail amounts on every read; values stored at 2dp before the
      // package parse back identically.
      amount: Number.isFinite(amount) ? amount : 0,
      ...(reference ? { reference } : {}),
    };
  });
}

export function summarizeCashDrawerRows(rows: CashDrawerMappedRow[], moneyDigits: MoneyDigits = 2): Record<string, unknown> {
  const openRows = rows.filter((row) => String(row.status || '') === 'open');
  const pendingReviewRows = rows.filter((row) => String(row.status || '') === 'pending_review');
  return {
    totalItems: rows.length,
    openShiftCount: openRows.length,
    pendingReviewCount: pendingReviewRows.length,
    openShiftDocNo: openRows[0] ? String(openRows[0].docNo || openRows[0].id || '') : '',
    totalVariance: roundMoney(rows.reduce((sum, row) => sum + Number(row.variance || 0), 0), moneyDigits),
  };
}

export function mapCashDrawerShiftRow(row: CashDrawerShiftSource): CashDrawerMappedRow {
  const parsedClose = parseBlindCloseNote(row.close_note);
  const blindDeclared = parsedClose.blindClose?.declared || {};
  const blindDetailTotals = parsedClose.blindClose?.detailTotals || {};
  const blindDetails = parsedClose.blindClose?.details || {};
  const managerReview = parsedClose.blindClose?.managerReview || {};
  const blindCloseMetadataStatus = parsedClose.isBlindMetadataValid ? 'valid' : (parsedClose.hasBlindPrefix ? 'invalid' : 'missing');

  return {
    id: String(row.id || ''),
    docNo: row.doc_no || (row.id ? `SHIFT-${row.id}` : ''),
    branchId: row.branch_id ? String(row.branch_id) : '',
    branchName: row.branch_name || '',
    locationId: row.location_id ? String(row.location_id) : '',
    locationName: row.location_name || '',
    openedById: row.opened_by ? String(row.opened_by) : '',
    openedByName: row.opened_by_name || '',
    cashSalesTotal: Number(row.cash_sales_total || 0),
    cardSalesTotal: Number(row.card_sales_total || 0),
    walletSalesTotal: Number(row.wallet_sales_total || 0),
    instapaySalesTotal: Number(row.instapay_sales_total || 0),
    creditSalesTotal: Number(row.credit_sales_total || 0),
    deliverySalesTotal: Number(row.delivery_sales_total || 0),
    deliveryFeeTotal: Number(row.delivery_fee_total || 0),
    freelanceDeliveryFeeTotal: Number(row.freelance_delivery_fee_total || 0),
    storeDeliveryFeeTotal: Number(row.store_delivery_fee_total || 0),
    netStoreSalesTotal: Number(row.net_store_sales_total || 0),
    shiftSalesTotal: Number(row.shift_sales_total || 0),
    tipSalesTotal: Number(row.tip_sales_total || 0),
    saleCount: Number(row.sale_count || 0),
    mixedSalesCount: Number(row.mixed_sale_count || 0),
    cardOperationCount: Number(row.card_operation_count || 0),
    walletOperationCount: Number(row.wallet_operation_count || 0),
    instapayOperationCount: Number(row.instapay_operation_count || 0),
    cashDrawerMovementTotal: Number(row.cash_drawer_movement_total || 0),
    cashDrawerCashInTotal: Number(row.cash_drawer_cash_in_total || 0),
    cashDrawerDeliveryCashInTotal: Number(row.cash_drawer_delivery_cash_in_total || 0),
    cashDrawerManualCashInTotal: Number(row.cash_drawer_manual_cash_in_total || 0),
    cashDrawerCashOutTotal: Number(row.cash_drawer_cash_out_total || 0),
    saleCashTotal: Number(row.sale_cash_total || 0),
    supplierPaymentsTotal: Number(row.supplier_payments_total || 0),
    expensesTotal: Number(row.expenses_total || 0),
    serviceCashTotal: Number(row.service_cash_total || 0),
    serviceCardTotal: Number(row.service_card_total || 0),
    serviceTotal: Number(row.service_total || 0),
    saleReturnCashRefundTotal: Number(row.sale_return_cash_refund_total || 0),
    saleReturnCardRefundTotal: Number(row.sale_return_card_refund_total || 0),
    saleReturnTotal: Number(row.sale_return_total || 0),
    openingCash: Number(row.opening_cash || 0),
    openingNote: row.opening_note || '',
    status: row.status || 'open',
    expectedCash: Number(row.expected_cash || 0),
    countedCash: row.counted_cash == null ? null : Number(row.counted_cash || 0),
    variance: row.variance == null ? 0 : Number(row.variance || 0),
    closeNote: parsedClose.note,
    closeNoteRaw: parsedClose.raw,
    blindCloseMode: Boolean(parsedClose.blindClose?.blindClose),
    blindCloseMetadataStatus,
    declaredCash: blindDeclared.cash == null ? null : Number(blindDeclared.cash || 0),
    declaredCardTotal: blindDeclared.cardTotal == null ? null : Number(blindDeclared.cardTotal || 0),
    declaredCardCount: blindDeclared.cardCount == null ? null : Number(blindDeclared.cardCount || 0),
    declaredWalletTotal: blindDeclared.walletTotal == null ? null : Number(blindDeclared.walletTotal || 0),
    declaredWalletCount: blindDeclared.walletCount == null ? null : Number(blindDeclared.walletCount || 0),
    declaredInstapayTotal: blindDeclared.instapayTotal == null ? null : Number(blindDeclared.instapayTotal || 0),
    declaredInstapayCount: blindDeclared.instapayCount == null ? null : Number(blindDeclared.instapayCount || 0),
    cardDetailsTotal: blindDetailTotals.card == null ? 0 : Number(blindDetailTotals.card || 0),
    walletDetailsTotal: blindDetailTotals.wallet == null ? 0 : Number(blindDetailTotals.wallet || 0),
    instapayDetailsTotal: blindDetailTotals.instapay == null ? 0 : Number(blindDetailTotals.instapay || 0),
    cardDetails: normalizeBlindOperationList(blindDetails.card),
    walletDetails: normalizeBlindOperationList(blindDetails.wallet),
    instapayDetails: normalizeBlindOperationList(blindDetails.instapay),
    managerReviewNote: String(managerReview.note || ''),
    managerReviewedById: managerReview.reviewedById == null ? null : Number(managerReview.reviewedById || 0),
    managerReviewedByName: String(managerReview.reviewedByName || ''),
    managerReviewedAt: String(managerReview.reviewedAt || ''),
    reconciliation: parsedClose.blindClose?.reconciliation || null,
    closedBy: row.closed_by_name || '',
    closedByName: row.closed_by_name || '',
    closedById: row.closed_by ? String(row.closed_by) : '',
    closedAt: row.closed_at || '',
    openedAt: row.created_at || '',
    createdAt: row.created_at || '',
    transactionCount: 0,
    movementItems: row.movement_items || [],
  };
}

export function buildCashDrawerShiftDocNo(shiftId: number, date: Date = new Date()): string {
  return formatDailyDocumentNumber('SHIFT', shiftId, date);
}

export function normalizeShiftOpenPayload(payload: { openingCash?: number; note?: string; branchId?: number | string | null; locationId?: number | string | null; password?: string; managerPin?: string }): { openingCash: number; note: string; branchId: number | null; locationId: number | null; password?: string } {
  const rawPassword = payload.password || payload.managerPin;
  return { openingCash: Number(payload.openingCash || 0), note: String(payload.note || '').trim(), branchId: payload.branchId ? Number(payload.branchId) : null, locationId: payload.locationId ? Number(payload.locationId) : null, password: rawPassword ? String(rawPassword).trim() : undefined };
}

export function assertCashDrawerAmount(amount: number): void { if (!(amount > 0)) throw new AppError('المبلغ يجب أن يكون أكبر من صفر', 'AMOUNT_INVALID', 400); }
export function assertCashDrawerCountedCash(countedCash: number): void { if (!(countedCash >= 0)) throw new AppError('المبلغ المعدود لا يمكن أن يكون سالبًا', 'COUNTED_CASH_INVALID', 400); }
export function assertCashDrawerNote(note: string, code = 'NOTE_REQUIRED', minLength = 1): void {
  if (String(note || '').trim().length < minLength) {
    throw new AppError('اكتب سبب العملية', code, 400);
  }
}
export type CashDrawerMovementType = 'cash_in' | 'cash_out' | 'safe_drop' | 'safe_replenishment';
export function normalizeCashDrawerMovementType(type?: string): CashDrawerMovementType {
  const raw = String(type || '').trim();
  if (raw === '') return 'cash_in';
  if (raw === 'cash_in' || raw === 'cash_out' || raw === 'safe_drop' || raw === 'safe_replenishment') return raw;
  throw new AppError('نوع حركة الدرج غير معروف', 'DRAWER_MOVEMENT_TYPE_UNKNOWN', 400);
}
export function isCashDrawerTransferType(type: CashDrawerMovementType): boolean { return type === 'safe_drop' || type === 'safe_replenishment'; }
export function toSignedCashDrawerAmount(type: CashDrawerMovementType, amount: number): number { return type === 'cash_out' || type === 'safe_drop' ? -Math.abs(amount) : Math.abs(amount); }
/**
 * Shift variance at the tenant's minor unit. digits is required: the old
 * toFixed(2) turned a KWD 0.005 variance into 0.01 (overstating the GL
 * charge) or 0.00 (dropping it entirely), and the stored variance then
 * disagreed with both the GL gate and the note gate.
 */
export function computeCashDrawerVariance(countedCash: number, expectedCash: number, digits: MoneyDigits): number { return roundMoney(countedCash - expectedCash, digits); }


/** Cash drawer movement amount is the posted cash tender leg, never the gross return. */
export function buildShiftCashReturnItem(row: {
  id: number; doc_no?: string | null; cash_refund?: number | string | null;
  note?: string | null; created_at?: string | Date | null;
}, moneyDigits: MoneyDigits = 2): { id: string; kind: 'return'; kindLabel: string; amount: number; note: string; createdAt: string } | null {
  const amount = Number(row.cash_refund || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    id: `ret-${row.id}`,
    kind: 'return',
    kindLabel: 'مرتجع مبيعات (رد نقدي فعلي)',
    amount: roundMoney(amount, moneyDigits),
    note: ['مرتجع نقدي', row.doc_no ? `#${row.doc_no}` : '', row.note].filter(Boolean).join(' - '),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
  };
}


/** Mirror shift cash total's coalesced tender rule for itemized supplier payouts. */
export function isDrawerCashTender(channel: string | null | undefined): boolean {
  return channel == null || channel === '' || channel === 'cash';
}
