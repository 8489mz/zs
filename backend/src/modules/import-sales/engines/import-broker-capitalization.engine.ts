/**
 * Import Broker Capitalisation Engine (محرك رسملة مصروفات المخلص).
 * Pure mapping: broker-expense category -> shipment cost bucket.
 * The bucket is the ONLY place a pre-receipt broker cost may enter
 * landed cost; an expense already folded into a bucket can never
 * capitalise a second time (the link table + the bucket floor in
 * updateShipmentCosts enforce it). A null bucket means the
 * category has no pre-receipt bucket: refundable VAT is a tax
 * asset (never capitalised), non-refundable VAT and 'other' have
 * no bucket and fail closed before receipt, and may only
 * capitalise through post-receipt revaluation, which spreads the
 * amount directly without a bucket.
 */

export type BrokerCostBucket = 'customs_cost_egp' | 'actual_demurrage_fees' | 'internal_transport_cost_egp';

export const BROKER_CAPITALIZATION_BUCKETS: Record<string, BrokerCostBucket | null> = {
  customs_duty: 'customs_cost_egp',
  port_fees: 'customs_cost_egp',
  inspection: 'customs_cost_egp',
  broker_fee: 'customs_cost_egp',
  demurrage: 'actual_demurrage_fees',
  transport: 'internal_transport_cost_egp',
  vat: null,
  other: null,
};

export function resolveBrokerCapitalizationBucket(
  category: string,
  isRefundableVat: boolean,
): { bucket: BrokerCostBucket | null; reason: 'vat_asset' | 'no_bucket' | 'ok' } {
  if (category === 'vat' && isRefundableVat) return { bucket: null, reason: 'vat_asset' };
  const bucket = BROKER_CAPITALIZATION_BUCKETS[category] ?? null;
  if (!bucket) return { bucket: null, reason: 'no_bucket' };
  return { bucket, reason: 'ok' };
}
