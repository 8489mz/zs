export function validateFixedAssetTerms(cost: number, salvage: number, usefulLifeMonths: number): void {
  if (
    !Number.isFinite(cost) ||
    cost <= 0 ||
    !Number.isFinite(salvage) ||
    salvage < 0 ||
    salvage > cost ||
    !Number.isSafeInteger(usefulLifeMonths) ||
    usefulLifeMonths <= 0
  ) {
    throw new Error('Asset cost, salvage value, or useful life is invalid');
  }
}

export function calculateAssetDepreciation(input: {
  cost: number;
  salvage: number;
  usefulLifeMonths: number;
  accumulated: number;
  purchaseDate: Date;
  postingDate: Date;
  months: number;
  method: string;
}): number {
  const { cost, salvage, usefulLifeMonths, accumulated, purchaseDate, postingDate, months, method } = input;
  validateFixedAssetTerms(cost, salvage, usefulLifeMonths);
  if (
    !Number.isSafeInteger(months) ||
    months <= 0 ||
    !Number.isFinite(accumulated) ||
    accumulated < 0 ||
    Number.isNaN(purchaseDate.getTime()) ||
    Number.isNaN(postingDate.getTime())
  ) {
    throw new Error('Depreciation period or accumulated amount is invalid');
  }
  const elapsedMonths =
    (postingDate.getUTCFullYear() - purchaseDate.getUTCFullYear()) * 12 +
    postingDate.getUTCMonth() -
    purchaseDate.getUTCMonth() +
    1;
  if (elapsedMonths <= 0 || purchaseDate > postingDate)
    throw new Error('Asset purchase date is after the posting date');
  if (months > elapsedMonths) throw new Error('Requested depreciation months exceed elapsed asset life');

  const base = cost - salvage;
  const remaining = Math.max(0, base - accumulated);
  let candidate: number;
  let scheduledCumulative: number;
  if (method === 'declining_balance') {
    const rate = Math.min(1, 2 / usefulLifeMonths);
    candidate = (cost - accumulated) * (1 - Math.pow(1 - rate, months));
    scheduledCumulative =
      elapsedMonths >= usefulLifeMonths ? base : Math.min(base, cost * (1 - Math.pow(1 - rate, elapsedMonths)));
    if (elapsedMonths >= usefulLifeMonths) candidate = remaining;
  } else {
    candidate = (base * months) / usefulLifeMonths;
    scheduledCumulative = Math.min(base, (base * elapsedMonths) / usefulLifeMonths);
  }
  return Math.max(
    0,
    Math.round(Math.min(candidate, remaining, Math.max(0, scheduledCumulative - accumulated)) * 100) / 100,
  );
}
