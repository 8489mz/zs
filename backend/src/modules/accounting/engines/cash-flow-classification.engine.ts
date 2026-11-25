/** Direct cash-flow classification. Non-cash journal legs never create cash flows. */
export function classifyCashFlow(
  cash: number,
  operating: number,
  investing: number,
  financing: number,
  explicitCategory?: 'operating' | 'investing' | 'financing' | null,
) {
  const cents = (amount: number) => Math.round(amount * 100);
  const net = cents(cash);
  const result = { operating: 0, investing: 0, financing: 0, unclassified: 0 };
  if (net === 0) return result;
  if (explicitCategory) {
    result[explicitCategory] = net / 100;
    return result;
  }
  // An asset disposal's gain and the disposal proceeds share a journal. Without
  // explicit attribution, treating the gain as an operating receipt is false.
  if (cents(investing) !== 0 && cents(operating) !== 0) {
    result.unclassified = net / 100;
    return result;
  }
  // A single journal can encode either a cash loan + cash asset purchase or a
  // non-cash financed purchase with only a cash deposit. Netting these produces
  // different gross flows; account balances alone cannot decide which occurred.
  if ([operating, investing, financing].some((amount) => cents(amount) * net < 0)) {
    result.unclassified = net / 100;
    return result;
  }
  const candidates = (
    [
      ['operating', operating],
      ['investing', investing],
      ['financing', financing],
    ] as const
  )
    .map(([key, amount]) => ({ key, amount: cents(amount) }))
    .filter((row) => row.amount * net > 0);
  if (candidates.length === 1) result[candidates[0].key] = net / 100;
  else if (candidates.reduce((sum, row) => sum + row.amount, 0) === net) {
    for (const row of candidates) result[row.key] = row.amount / 100;
  } else result.unclassified = net / 100; // Mixed non-cash financing needs document-level attribution.
  return result;
}
