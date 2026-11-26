/**
 * A field sale's contribution to its trip's counters.
 *
 * Mirrors, exactly, the five increment branches in
 * executeFieldSaleInternal (van-sales.service.ts) so that an edit or
 * a cancellation can reverse the contribution the sale made at
 * creation time:
 *   cash     -> sales_amount += total, cash_collected += total
 *   instapay -> sales_amount += total, total_instapay_sales += total
 *   card     -> sales_amount += total
 *   credit   -> sales_amount += total, credit_sales += total
 *   split    -> sales_amount += total, cash_collected += cashPaid,
 *               credit_sales += creditOwed
 *
 * The stored sale row alone determines the contribution in every
 * single-channel shape: field sales store payment_type =
 * payload.paymentMethod and payment_channel per the branch taken
 * ('cash' | 'card' | 'vodafone_cash' | 'bank_transfer' | 'credit' |
 * 'mixed'), paid_amount is the total only for card/instapay and 0
 * otherwise, and creation writes sale_payments rows only for
 * card/instapay. The one shape the row cannot determine is 'mixed'
 * (split): its cash/credit split lives in the tender rows when the
 * generic writer wrote them, in the sale_credit ledger row
 * (reference_type 'sale', entry_type 'sale_credit') when the field
 * flow wrote it, and in paid_amount only as a last resort.
 */

export interface TripSaleContribution {
  salesAmount: number;
  cashCollected: number;
  creditSales: number;
  instapaySales: number;
}

export interface TripCounterPaymentRow {
  amount: unknown;
  payment_channel: unknown;
}

const INSTAPAY_CHANNELS = ['instapay', 'vodafone_cash', 'bank_transfer'];

function num(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumChannel(rows: TripCounterPaymentRow[], channels: string[]): number {
  return rows.reduce(
    (sum, row) => (channels.includes(String(row.payment_channel || '').toLowerCase()) ? sum + num(row.amount) : sum),
    0,
  );
}

export function tripSaleContribution(input: {
  total: unknown;
  paidAmount: unknown;
  paymentChannel: unknown;
  payments?: TripCounterPaymentRow[];
  ledgerCreditAmount?: unknown;
}): TripSaleContribution {
  const total = num(input.total);
  const paid = num(input.paidAmount);
  const channel = String(input.paymentChannel || '')
    .trim()
    .toLowerCase();
  const rows = Array.isArray(input.payments) ? input.payments : [];

  if (channel === 'mixed') {
    if (rows.length > 0) {
      const cash = sumChannel(rows, ['cash']);
      const instapay = sumChannel(rows, INSTAPAY_CHANNELS);
      const card = sumChannel(rows, ['card']);
      const wallet = sumChannel(rows, ['wallet']);
      return {
        salesAmount: total,
        cashCollected: cash,
        creditSales: Math.max(0, total - cash - instapay - card - wallet),
        instapaySales: instapay,
      };
    }
    if (input.ledgerCreditAmount !== undefined && input.ledgerCreditAmount !== null) {
      const credit = Math.max(0, Math.min(total, num(input.ledgerCreditAmount)));
      return { salesAmount: total, cashCollected: total - credit, creditSales: credit, instapaySales: 0 };
    }
    const cash = Math.max(0, Math.min(total, paid));
    return { salesAmount: total, cashCollected: cash, creditSales: Math.max(0, total - cash), instapaySales: 0 };
  }

  // Field rows store paid_amount = 0 for cash sales (the whole total
  // sits with the rep) and paid_amount = total for card/instapay, while
  // the generic writer stores the tendered amount. A positive paid
  // amount is therefore the collected leg; a zero paid amount on a
  // cash/instapay channel means the whole total.
  const cash = channel === 'cash' ? (paid > 0 ? paid : total) : 0;
  const instapay = INSTAPAY_CHANNELS.includes(channel) ? (paid > 0 ? paid : total) : 0;
  const cardTender = channel === 'card' ? paid : 0;
  const walletTender = channel === 'wallet' ? paid : 0;
  const knownChannel =
    channel === 'cash' ||
    channel === 'credit' ||
    channel === 'card' ||
    channel === 'wallet' ||
    INSTAPAY_CHANNELS.includes(channel);
  const credit = knownChannel
    ? Math.max(0, total - cash - instapay - cardTender - walletTender)
    : Math.max(0, total - paid);
  return {
    salesAmount: total,
    cashCollected: cash,
    creditSales: credit,
    instapaySales: instapay,
  };
}

// Negating a zero leg must stay 0, not -0 (deep equality and the
// SQL arithmetic both treat -0 as a distinct, confusing value).
function normZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function negateContribution(contribution: TripSaleContribution): TripSaleContribution {
  return {
    salesAmount: normZero(-contribution.salesAmount),
    cashCollected: normZero(-contribution.cashCollected),
    creditSales: normZero(-contribution.creditSales),
    instapaySales: normZero(-contribution.instapaySales),
  };
}

export function diffContributions(next: TripSaleContribution, previous: TripSaleContribution): TripSaleContribution {
  return {
    salesAmount: normZero(next.salesAmount - previous.salesAmount),
    cashCollected: normZero(next.cashCollected - previous.cashCollected),
    creditSales: normZero(next.creditSales - previous.creditSales),
    instapaySales: normZero(next.instapaySales - previous.instapaySales),
  };
}
