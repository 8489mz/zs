import { useMemo } from 'react';
import type { PrototypeLine } from '../newPurchaseOrder.types';

export interface UsePurchaseOrderMoneyArgs {
  lines: PrototypeLine[];
  discountMode: 'percent' | 'value';
  discount: number;
  taxRate: number;
}

export function usePurchaseOrderMoney({
  lines,
  discountMode,
  discount,
  taxRate,
}: UsePurchaseOrderMoneyArgs) {
  const subtotal = useMemo(() => lines.reduce((acc, line) => acc + line.qty * line.unitPrice, 0), [lines]);
  const discountAmount = discountMode === 'percent' ? (subtotal * discount) / 100 : discount;
  const taxableBase = Math.max(subtotal - discountAmount, 0);
  const tax = useMemo(() => (taxableBase * taxRate) / 100, [taxableBase, taxRate]);
  const total = taxableBase + tax;
  return {
    subtotal,
    tax,
    total,
  };
}
