import type { BlindCloseReconciliation } from './helpers/cash-drawer.helper';
import type { ShiftCustomerCollectionsByChannel } from './helpers/shift-customer-collections.helper';

export type ShiftRow = {
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
  // INV-SHIFT-CLOSE-DISCOUNT-SUMMARY: hydrated by hydrateShiftRow
  // from computeShiftDiscountSummary; 0 on rows the query cannot
  // reach (computed live, never stored).
  shiftDiscountTotal?: number | string | null;
  shiftDiscountGrossTotal?: number | string | null;
  shiftDiscountPercent?: number | string | null;
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
  terminal_code?: string | null;
  customerCollectionsTotal?: number | string | null;
  customerCollectionsByChannel?: ShiftCustomerCollectionsByChannel | null;
  cancelledSaleCashTotal?: number | string | null;
  expected_cash?: number | string | null;
  counted_cash?: number | string | null;
  variance?: number | string | null;
  close_note?: string | null;
  closed_by?: number | string | null;
  closed_at?: Date | string | null;
  created_at?: Date | string | null;
  branch_name?: string | null;
  location_name?: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  movement_items?: Array<{
    id: string;
    kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
    kindLabel: string;
    amount: number;
    note: string;
    createdAt: string;
  }>;
};

export type SettingsRow = { key?: string; value?: string | null };
export type UserPasswordRow = {
  id?: number | string;
  is_active?: boolean | number | string | null;
  password_hash?: string | null;
  password_salt?: string | null;
};
export type CashDrawerMovementRow = { cash_drawer_movement_total?: number | string | null };
export type ShiftServiceBreakdown = { serviceCashTotal: number; serviceCardTotal: number; serviceTotal: number };
export type ShiftSalesBreakdown = {
  cashSalesTotal: number;
  cardSalesTotal: number;
  walletSalesTotal: number;
  instapaySalesTotal: number;
  creditSalesTotal: number;
  deliverySalesTotal: number;
  shiftSalesTotal: number;
  tipSalesTotal: number;
  deliveryFeeTotal: number;
  freelanceDeliveryFeeTotal: number;
  storeDeliveryFeeTotal: number;
  netStoreSalesTotal: number;
  saleCount: number;
  mixedSalesCount: number;
  cardOperationCount: number;
  walletOperationCount: number;
  instapayOperationCount: number;
};
export type ShiftSaleReturnTotals = {
  saleReturnCashRefundTotal: number;
  saleReturnCardRefundTotal: number;
  saleReturnTotal: number;
};
export type CloseOperationDetailInput = { amount?: number; reference?: string };
export type BlindCloseMetadata = {
  blindClose: true;
  declared: {
    cash: number;
    cardTotal: number;
    cardCount: number;
    walletTotal: number;
    walletCount: number;
    instapayTotal: number;
    instapayCount: number;
  };
  detailTotals: { card: number; wallet: number; instapay: number };
  details: {
    card: Array<{ amount: number; reference?: string }>;
    wallet: Array<{ amount: number; reference?: string }>;
    instapay: Array<{ amount: number; reference?: string }>;
  };
  managerReview?: { note: string; reviewedById: number; reviewedByName: string; reviewedAt: string };
  rejection?: { note: string; rejectedById: number; rejectedByName: string; rejectedAt: string };
  reconciliation?: BlindCloseReconciliation;
  postCloseCorrections?: Array<PostCloseCorrectionStamp>;
  note: string;
};

/**
 * One stamped post-close correction (INV-CLOSED-SHIFT-POST-CLOSE-REFRESH):
 * the recomputed summary for a closed shift after a sale edit/cancel,
 * with the original figures preserved so the close record is never
 * silently overwritten. Stored inside the blind-close JSON for blind
 * closes; rendered as a text line for ordinary close notes.
 */
export type PostCloseCorrectionStamp = {
  at: string;
  saleId: number;
  kind: 'edit' | 'cancel' | 'offline_sync';
  previousExpectedCash: number;
  correctedExpectedCash: number;
  previousVariance: number;
  correctedVariance: number;
  reason: string;
  byUserId: number | null;
  byUsername: string;
};
