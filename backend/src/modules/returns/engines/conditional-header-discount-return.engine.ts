import { AppError } from '../../../common/errors/app-error';
import { roundMoney as roundBookMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/*
 * INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: a header (invoice) discount
 * is a deal on the whole basket — in the client's own words, "I priced
 * 3 pieces at 800 instead of 900 because she took 3". When the customer
 * returns part of the basket the deal breaks, so the discount is
 * forfeited ENTIRELY and the pieces the customer keeps reprice at
 * their original price. It is never spread pro-rata over the returned
 * pieces (the 267 computation) and the refund is never the returned
 * pieces' gross price (300): both keep the discount alive on pieces
 * whose condition no longer holds.
 *
 * The refund is anchored at the INVOICE level, never per line:
 *   computed refund = invoice total − prior goods refunded
 *                     − remaining net at original price
 * The anchor keeps sequential returns exact even when an earlier
 * return was priced under the old pro-rata rule: a prior refund of
 * 266.67 followed by a second return still totals 500 for two
 * returned pieces of the 3×300/−100/800 sale, because the second
 * return only pays the difference to the anchored entitlement.
 *
 * Per-line discount (sale_items.line_discount, INV-POS-LINE-DISCOUNT)
 * behaves differently and is untouched: it belongs to its own piece,
 * so it survives on kept pieces and is not refunded on returned ones.
 * Stock is untouched by this engine — restock still uses the frozen
 * line cost in the service, never a repriced value.
 *
 * Book digits are REQUIRED (INV-RETURN-HELPER-DIGITS-REQUIRED): every
 * rounding here feeds a stored return line, a document total, or a
 * ledger balance, so a caller that forgets the tenant's digits must
 * fail closed instead of silently falling back to 2 decimals.
 */

export type ForfeitSaleLine = {
  saleItemId: number;
  soldQty: number;
  unitPrice: number;
  /** Stored line_total: gross − per-line discount. */
  lineTotal: number;
  /** Stored per-line discount (INV-POS-LINE-DISCOUNT). */
  lineDiscount: number;
  /** Stored header-discount share from allocateInvoiceDiscount. */
  allocatedDiscount: number;
  /** Stored tax share from allocateInvoiceDiscount. */
  allocatedTax: number;
};

export type ForfeitReturnRequest = {
  saleItemId: number;
  qty: number;
};

export type ForfeitLineResult = {
  saleItemId: number;
  qty: number;
  /** Tax-inclusive refund value of this returned line, at book digits. */
  lineTotal: number;
  allocatedTax: number;
  unitTotal: number;
};

export type ConditionalDiscountForfeitResult = {
  /** True when the header discount is forfeited on this return:
   *  header discount > 0 and the return is partial (pieces remain kept). */
  applies: boolean;
  /** The invoice total the customer was charged (sale.total). */
  invoiceTotal: number;
  /** Goods value already refunded by earlier returns of this sale. */
  priorGoodsRefunded: number;
  /** Kept pieces repriced at original price (line discount survives). */
  remainingNetAtOriginal: number;
  /** Goods refund the forfeit rule computes, before any goodwill. */
  computedGoodsRefund: number;
  /** Header discount forfeited by this return (0 when not applicable). */
  forfeitedHeaderDiscount: number;
  /** Repriced tax-inclusive value of the returned pieces. */
  repricedReturnedTotal: number;
  /** Highest goods refund the merchant may grant (gross price of the
   *  returned pieces, capped at what is still unrefunded). */
  goodwillCap: number;
  /** Goodwill extra above the computed refund (0 when none requested). */
  goodwillAmount: number;
  /** Per-line refund values; they sum exactly to computed + goodwill. */
  lines: ForfeitLineResult[];
};

/** The forfeit breakdown the return dialog displays (no per-line detail). */
export type ConditionalDiscountForfeitBreakdown = Omit<ConditionalDiscountForfeitResult, 'lines'>;

function fail(message: string, code: string): never {
  throw new AppError(message, code, 400);
}

function toCents(value: number, digits: MoneyDigits): number {
  const scale = 10 ** digits;
  const cents = Math.round(Number(value) * scale);
  if (!Number.isSafeInteger(cents)) fail('قيمة المرتجع تتجاوز حد الأرقام الآمن', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
  return cents;
}

/** Split a target total across weights pro-rata; the last line absorbs rounding.
 *  Exported for the service's original-mode goodwill split, which allocates
 *  a merchant-raised refund across the pro-rata return lines the same way. */
export function allocateProRata(weights: number[], target: number, digits: MoneyDigits): number[] {
  const scale = 10 ** digits;
  const targetCents = toCents(target, digits);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0) return [];
  if (!(totalWeight > 0)) {
    if (targetCents !== 0) fail('تعذر توزيع مبلغ المرتجع على البنود', 'CONDITIONAL_DISCOUNT_FORFEIT_ALLOCATION_INVALID');
    return weights.map(() => 0);
  }
  const result: number[] = [];
  let remaining = targetCents;
  // The remainder lands on the last line that actually carries value,
  // never on a free (zero-weight) line.
  let lastPositive = -1;
  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index] > 0) { lastPositive = index; break; }
  }
  for (let index = 0; index < weights.length; index += 1) {
    if (index === lastPositive) {
      result.push(remaining / scale);
      continue;
    }
    const share = Math.min(remaining, Math.round((targetCents * weights[index]) / totalWeight));
    result.push(share / scale);
    remaining -= share;
  }
  return result;
}

export function computeConditionalDiscountForfeit(input: {
  lines: ForfeitSaleLine[];
  returns: ForfeitReturnRequest[];
  priorReturnedQtyByLine: Record<number, number> | Map<number, number>;
  headerDiscount: number;
  invoiceTotal: number;
  priorGoodsRefunded: number;
  pricesIncludeTax: boolean;
  /** Final goods refund the merchant asks for (computed + goodwill).
   *  When present it must sit inside [computed, goodwillCap]. */
  requestedGoodsRefund?: number;
  digits: MoneyDigits;
}): ConditionalDiscountForfeitResult {
  const { lines, returns, headerDiscount, invoiceTotal, priorGoodsRefunded, pricesIncludeTax } = input;
  const digits = input.digits;
  if (digits !== 2 && digits !== 3) {
    fail('حساب إلغاء خصم الفاتورة يتطلب دقة دفاتر المنشأة', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
  }
  const money = (value: number) => roundBookMoney(Number(value || 0), digits);
  const num = (value: unknown, name: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      fail(`قيمة غير صالحة في حساب إلغاء خصم الفاتورة: ${name}`, 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
    }
    return parsed;
  };
  if (!Array.isArray(lines) || lines.length === 0) {
    fail('فاتورة بلا بنود لا يمكن حساب إلغاء خصمها', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
  }
  if (!Array.isArray(returns) || returns.length === 0) {
    fail('مرتجع بلا بنود لا يمكن حساب إلغاء خصمه', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
  }
  const header = num(headerDiscount, 'headerDiscount');
  const total = num(invoiceTotal, 'invoiceTotal');
  const priorRefunded = num(priorGoodsRefunded, 'priorGoodsRefunded');
  const priorQty = (saleItemId: number): number => {
    const raw = input.priorReturnedQtyByLine instanceof Map
      ? input.priorReturnedQtyByLine.get(saleItemId)
      : (input.priorReturnedQtyByLine as Record<number, number>)[saleItemId];
    return num(raw ?? 0, 'priorReturnedQty');
  };
  const requestedQtyByLine = new Map<number, number>();
  for (const request of returns) {
    const qty = num(request.qty, 'returnQty');
    if (!(qty > 0)) fail('كمية المرتجع يجب أن تكون موجبة', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
    requestedQtyByLine.set(Number(request.saleItemId), (requestedQtyByLine.get(Number(request.saleItemId)) || 0) + qty);
  }

  let keptQtyTotal = 0;
  let returnedQtyTotal = 0;
  let remainingNetAtOriginal = 0;
  let repricedReturnedTotal = 0;
  let repricedReturnedTax = 0;
  let goodwillCapBase = 0;
  const returned: Array<{ saleItemId: number; qty: number; repricedValue: number; repricedTax: number }> = [];

  for (const line of lines) {
    const saleItemId = Number(line.saleItemId);
    const soldQty = num(line.soldQty, 'soldQty');
    const unitPrice = num(line.unitPrice, 'unitPrice');
    const lineTotal = num(line.lineTotal, 'lineTotal');
    const lineDiscount = num(line.lineDiscount, 'lineDiscount');
    const allocatedDiscount = num(line.allocatedDiscount, 'allocatedDiscount');
    const allocatedTax = num(line.allocatedTax, 'allocatedTax');
    if (!(soldQty > 0)) fail('كمية بند الفاتورة يجب أن تكون موجبة', 'CONDITIONAL_DISCOUNT_FORFEIT_INVALID_INPUT');
    const priorQtyForLine = priorQty(saleItemId);
    const requestedQty = requestedQtyByLine.get(saleItemId) || 0;
    if (priorQtyForLine + requestedQty > soldQty + 0.000001) {
      throw new AppError('كمية المرتجع تتجاوز الكمية المباعة', 'RETURN_QUANTITY_EXCEEDED', 400);
    }
    const keptQty = soldQty - priorQtyForLine - requestedQty;
    keptQtyTotal += keptQty;
    returnedQtyTotal += requestedQty;
    // Tax per unit of discounted base: the same ratio
    // allocateInvoiceDiscount used for this line. Zero when the line
    // was fully discounted (no base left to carry tax).
    const discountedBase = lineTotal - allocatedDiscount;
    const taxFactor = discountedBase > 0 ? allocatedTax / discountedBase : 0;
    const keptLineDiscount = money((lineDiscount * keptQty) / soldQty);
    const keptBase = money(keptQty * unitPrice - keptLineDiscount);
    const keptTax = money(keptBase * taxFactor);
    const keptValue = pricesIncludeTax ? keptBase : money(keptBase + keptTax);
    remainingNetAtOriginal = money(remainingNetAtOriginal + keptValue);
    if (requestedQty > 0) {
      const returnedLineDiscount = money((lineDiscount * requestedQty) / soldQty);
      const returnedBase = money(requestedQty * unitPrice - returnedLineDiscount);
      const returnedTax = money(returnedBase * taxFactor);
      const returnedValue = pricesIncludeTax ? returnedBase : money(returnedBase + returnedTax);
      const returnedGross = pricesIncludeTax
        ? money(requestedQty * unitPrice)
        : money(requestedQty * unitPrice + money(requestedQty * unitPrice * taxFactor));
      repricedReturnedTotal = money(repricedReturnedTotal + returnedValue);
      repricedReturnedTax = money(repricedReturnedTax + returnedTax);
      goodwillCapBase = money(goodwillCapBase + returnedGross);
      returned.push({ saleItemId, qty: requestedQty, repricedValue: returnedValue, repricedTax: returnedTax });
    }
  }

  const partial = keptQtyTotal > 0 && returnedQtyTotal > 0;
  const applies = header > 0 && partial;
  const computedGoodsRefund = Math.max(0, money(total - priorRefunded - remainingNetAtOriginal));
  const forfeitedHeaderDiscount = applies ? header : 0;
  const goodwillCap = applies
    ? Math.max(0, Math.min(goodwillCapBase, money(total - priorRefunded)))
    : 0;

  let finalGoodsRefund = computedGoodsRefund;
  let goodwillAmount = 0;
  if (input.requestedGoodsRefund !== undefined && input.requestedGoodsRefund !== null) {
    if (!applies) {
      fail('التسوية الودية تتطلب إلغاء خصم فاتورة سارياً على هذا المرتجع', 'CONDITIONAL_DISCOUNT_GOODWILL_REQUIRES_FORFEIT');
    }
    const requested = num(input.requestedGoodsRefund, 'requestedGoodsRefund');
    if (requested < computedGoodsRefund - 0.000001) {
      fail('المبلغ المسترد المطلوب أقل من المبلغ المحسوب لإلغاء الخصم', 'GOODWILL_REFUND_BELOW_COMPUTED');
    }
    if (requested > goodwillCap + 0.000001) {
      fail('المبلغ المسترد المطلوب يتجاوز سقف سعر القطع المرتجعة', 'GOODWILL_REFUND_ABOVE_CAP');
    }
    if (goodwillCap < computedGoodsRefund - 0.000001) {
      fail('سقف التسوية الودية أقل من المبلغ المحسوب؛ راجع مرتجعات الفاتورة السابقة', 'CONDITIONAL_DISCOUNT_FORFEIT_CAP_INVALID');
    }
    finalGoodsRefund = money(requested);
    goodwillAmount = money(finalGoodsRefund - computedGoodsRefund);
  } else if (applies && goodwillCap < computedGoodsRefund - 0.000001) {
    fail('سقف التسوية الودية أقل من المبلغ المحسوب؛ راجع مرتجعات الفاتورة السابقة', 'CONDITIONAL_DISCOUNT_FORFEIT_CAP_INVALID');
  }

  let resultLines: ForfeitLineResult[] = [];
  if (applies) {
    const allocatedTotals = allocateProRata(
      returned.map((entry) => entry.repricedValue),
      finalGoodsRefund,
      digits,
    );
    const totalTax = repricedReturnedTotal > 0
      ? money(finalGoodsRefund * (repricedReturnedTax / repricedReturnedTotal))
      : 0;
    const allocatedTaxes = allocateProRata(allocatedTotals, totalTax, digits);
    resultLines = returned.map((entry, index) => ({
      saleItemId: entry.saleItemId,
      qty: entry.qty,
      lineTotal: allocatedTotals[index],
      allocatedTax: allocatedTaxes[index],
      unitTotal: entry.qty > 0 ? money(allocatedTotals[index] / entry.qty) : 0,
    }));
  }

  return {
    applies,
    invoiceTotal: total,
    priorGoodsRefunded: priorRefunded,
    remainingNetAtOriginal,
    computedGoodsRefund,
    forfeitedHeaderDiscount,
    repricedReturnedTotal,
    goodwillCap,
    goodwillAmount,
    lines: resultLines,
  };
}
