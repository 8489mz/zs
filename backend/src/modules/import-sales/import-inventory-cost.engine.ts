import { BadRequestException } from '@nestjs/common';
import { weightedReceiptCost } from '../accounting/engines/inventory-valuation.engine';
import { roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

export interface ImportCostLine {
  id: string;
  productId: number;
  quantity: number;
  receivedQuantity: number;
  factoryUnitPriceUsd: number;
  shortageHandlingMethod: string;
}

export function requireImportNumber(value: unknown, label: string, min = 0): number {
  if (value === null || value === undefined || value === '' ||
      !Number.isFinite(Number(value)) || Number(value) < min) {
    throw new BadRequestException(`قيمة غير صالحة: ${label}`);
  }
  return Number(value);
}

export function validateImportLine(line: ImportCostLine): void {
  if (!Number.isSafeInteger(line.productId) || line.productId <= 0) {
    throw new BadRequestException('معرف الصنف غير صالح');
  }
  requireImportNumber(line.quantity, 'الكمية', 1);
  if (!Number.isInteger(line.quantity)) throw new BadRequestException('كمية البوليصة يجب أن تكون عددًا صحيحًا');
  requireImportNumber(line.receivedQuantity, 'الكمية المستلمة');
  if (line.receivedQuantity > line.quantity ||
      Math.abs(line.receivedQuantity - Number(line.receivedQuantity.toFixed(3))) > 1e-9) {
    throw new BadRequestException('الكمية المستلمة تتجاوز البوليصة أو دقة المخزون (3 منازل)');
  }
  requireImportNumber(line.factoryUnitPriceUsd, 'سعر المصنع');
  if (!['capitalize', 'expense'].includes(line.shortageHandlingMethod)) {
    throw new BadRequestException('طريقة معالجة النقص غير صالحة');
  }
}

/**
 * Group receipt lines by product, rounding each group's money ONCE at
 * the tenant's book digits (INV-IMPORT-RECEIPT-BOOK-DIGITS): the
 * rounded group value is the single number the WAC blend
 * (valueStockReceipt), the stock-movement total and the receipt
 * journal all share, so cost_price x qty reconciles with the 1140
 * leg exactly. Before this the groups carried raw float products
 * (receivedQty * landedCost) while the service cut only the journal
 * totals to 2dp: on a 3dp tenant the journal said 42.88 for a receipt
 * the pool blended at 42.875, and the shortage expense was cut to
 * 2dp in the expenses row. The digits are caller-supplied (the live
 * caller resolves them from tenantBaseCurrency on the trx handle);
 * the engine fails closed on anything but 2 or 3 rather than
 * silently defaulting. Quantities stay at the ledger's 3dp.
 */
export function groupImportReceipts(lines: Array<ImportCostLine & { landedCost: number }>, moneyDigits: MoneyDigits) {
  if (moneyDigits !== 2 && moneyDigits !== 3) {
    throw new BadRequestException('دقة العملة غير صالحة');
  }
  const products = new Map<number, { productId: number; quantity: number; value: number; shortageExpense: number }>();
  for (const line of lines) {
    validateImportLine(line);
    requireImportNumber(line.landedCost, 'التكلفة المحملة');
    const group = products.get(line.productId) ?? {
      productId: line.productId, quantity: 0, value: 0, shortageExpense: 0,
    };
    group.quantity = Number((group.quantity + line.receivedQuantity).toFixed(3));
    group.value += line.receivedQuantity * line.landedCost;
    if (line.shortageHandlingMethod === 'expense') {
      group.shortageExpense += (line.quantity - line.receivedQuantity) * line.landedCost;
    }
    requireImportNumber(group.value, 'قيمة الاستلام');
    products.set(line.productId, group);
  }
  return [...products.values()]
    .map((group) => ({
      ...group,
      value: roundMoney(group.value, moneyDigits),
      shortageExpense: roundMoney(group.shortageExpense, moneyDigits),
    }))
    .sort((a, b) => a.productId - b.productId);
}

/**
 * One WAC policy for every receipt path (INV-WAC-UNIFIED-BLEND): the import
 * receipt blends exactly like a purchase receipt, through the canonical
 * weightedReceiptCost — including its negative-stock policy (algebraic
 * blend with a non-negative guard, INV-NEGATIVE-STOCK-WAC). The old
 * formula took the incoming cost whenever the prior stock was zero or
 * negative, erasing the booked shortfall value and valuing the same
 * receipt differently from a purchase receipt of the same goods.
 *
 * Only the blend is delegated. The import-side validation and the
 * BadRequestException contract are preserved: a corrupt stored cost or
 * value still fails closed with the same Arabic 400 the import flow
 * has always raised. A zero-quantity group keeps the old cost
 * (weightedReceiptCost rejects zero receipts; the caller guards
 * quantity > 0, but an empty group still reaches this function).
 */
export function importWeightedAverageCost(oldQty: number, oldCost: number, quantity: number, value: number): number {
  if (!Number.isFinite(oldQty)) throw new BadRequestException('رصيد المخزون غير صالح');
  requireImportNumber(oldCost, 'التكلفة السابقة');
  requireImportNumber(quantity, 'الكمية المستلمة');
  requireImportNumber(value, 'قيمة الاستلام');
  if (quantity === 0) return oldCost;
  return weightedReceiptCost(oldQty, oldCost, quantity, value);
}
