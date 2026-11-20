import type { Dispatch, SetStateAction } from 'react';
import type { useTranslation } from '../../../utils/i18n-purchase-prototype';
import { parseLocalizedNumber } from '../newPurchaseOrder.helpers';
import type {
  ProductOption,
  PrototypeLine,
  SupplierOption,
  ValidationErrors,
  ValidationRowErrors,
} from '../newPurchaseOrder.types';

type ConfirmFocusTarget =
  | { kind: 'field'; field: 'supplier' | 'date' | 'requiredDate' | 'currency' }
  | { kind: 'line'; lineId: number; field: 'product' | 'qty' | 'price' | 'warehouse' };

export interface UsePurchaseOrderValidationArgs {
  markDocumentDirty: () => void;
  setTaxRate: Dispatch<SetStateAction<number>>;
  setCustomTaxRate: Dispatch<SetStateAction<string>>;
  setActiveQuickAction: Dispatch<SetStateAction<'tax' | 'discount' | null>>;
  customTaxRate: string;
  supplierInputRef: { current: HTMLInputElement | null };
  dateInputRef: { current: HTMLInputElement | null };
  requiredDateInputRef: { current: HTMLInputElement | null };
  currencyInputRef: { current: HTMLInputElement | null };
  suppliers: SupplierOption[];
  supplier: string;
  t: ReturnType<typeof useTranslation>['t'];
  date: string;
  requiredDate: string;
  currency: string;
  lines: PrototypeLine[];
  products: ProductOption[];
}

export function usePurchaseOrderValidation({
  markDocumentDirty,
  setTaxRate,
  setCustomTaxRate,
  setActiveQuickAction,
  customTaxRate,
  supplierInputRef,
  dateInputRef,
  requiredDateInputRef,
  currencyInputRef,
  suppliers,
  supplier,
  t,
  date,
  requiredDate,
  currency,
  lines,
  products,
}: UsePurchaseOrderValidationArgs) {
  const applyTaxPreset = (rate: number) => {
    markDocumentDirty();
    setTaxRate(rate);
    setCustomTaxRate(String(rate));
    setActiveQuickAction(null);
  };

  const applyCustomTaxRate = () => {
    markDocumentDirty();
    const normalized = parseLocalizedNumber(customTaxRate);
    setTaxRate(Number.isFinite(normalized) ? normalized : 0);
    setActiveQuickAction(null);
  };

  const applyDiscount = () => {
    markDocumentDirty();
    setActiveQuickAction(null);
  };

  const focusFieldBySelector = (selector: string) => {
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (target as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | null)?.focus?.();
    });
  };

  const focusFirstInvalidField = (target: ConfirmFocusTarget | null) => {
    if (!target) {
      return;
    }

    if (target.kind === 'field') {
      if (target.field === 'supplier') {
        supplierInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        supplierInputRef.current?.focus();
        return;
      }

      if (target.field === 'date') {
        dateInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dateInputRef.current?.focus();
        return;
      }

      if (target.field === 'requiredDate') {
        requiredDateInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        requiredDateInputRef.current?.focus();
        return;
      }

      if (target.field === 'currency') {
        currencyInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        currencyInputRef.current?.focus();
      }
      return;
    }

    const selectorMap: Record<typeof target.field, string> = {
      product: `#product-input-${target.lineId}`,
      qty: `#quantity-input-${target.lineId}`,
      price: `.document-line-items-table tr[data-line-id="${target.lineId}"] .purchase-prototype-table-cell-price input`,
      warehouse: `#warehouse-input-${target.lineId}`
    };

    focusFieldBySelector(selectorMap[target.field]);
  };

  const validateBeforeConfirm = () => {
    const nextErrors: ValidationErrors = { rows: {} };
    let firstInvalidTarget: ConfirmFocusTarget | null = null;
    const addFirstTarget = (target: ConfirmFocusTarget) => {
      if (!firstInvalidTarget) {
        firstInvalidTarget = target;
      }
    };

    const selectedSupplierObj = suppliers.find(s => s.name === supplier);
    if (!supplier.trim() || !selectedSupplierObj) {
      nextErrors.supplier = t('select_supplier_error');
      addFirstTarget({ kind: 'field', field: 'supplier' });
    }

    if (!date.trim()) {
      nextErrors.date = t('select_date_error');
      addFirstTarget({ kind: 'field', field: 'date' });
    }

    if (!requiredDate.trim()) {
      nextErrors.requiredDate = t('select_required_date_error');
      addFirstTarget({ kind: 'field', field: 'requiredDate' });
    }

    if (!currency.trim()) {
      nextErrors.currency = t('select_currency_error');
      addFirstTarget({ kind: 'field', field: 'currency' });
    }

    const checkIsBlankRow = (line: PrototypeLine) => {
      const hasProduct = Boolean(line.productId || line.itemName.trim());
      const hasQty = Number.isFinite(line.qty) && line.qty > 0 && line.qty !== 1;
      const hasPrice = Number.isFinite(line.unitPrice) && line.unitPrice > 0;
      const hasWarehouse = Boolean(line.warehouse && line.warehouse.trim());
      return !hasProduct && !hasQty && !hasPrice && !hasWarehouse;
    };

    const validRows = lines.filter((line) => !checkIsBlankRow(line));

    if (!validRows.length) {
      if (!firstInvalidTarget) {
        firstInvalidTarget = { kind: 'line', lineId: lines[0]?.id ?? Date.now(), field: 'product' };
      }
      if (lines[0]) {
        nextErrors.rows[lines[0].id] = { product: t('add_one_item_error') };
      }
      return { valid: false, errors: nextErrors, firstInvalidTarget };
    }

    const seenProducts = new Map<string, string>();
    lines.forEach((line) => {
      if (checkIsBlankRow(line)) {
        return;
      }

      const rowErrors: ValidationRowErrors = {};

      if (!line.productId) {
        rowErrors.product = t('select_item_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'product' });
      } else {
        if (seenProducts.has(line.productId)) {
          rowErrors.product = `الصنف "${line.itemName}" مكرر. يرجى دمجه أو حذفه.`;
          addFirstTarget({ kind: 'line', lineId: line.id, field: 'product' });
        } else {
          seenProducts.set(line.productId, String(line.id));
        }
      }

      const qtyValue = Number.isFinite(line.qty) ? line.qty : parseLocalizedNumber(String(line.qty));
      if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
        rowErrors.qty = t('qty_greater_than_zero_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'qty' });
      }

      const rawPrice = line.unitPrice;
      const parsedPrice = typeof rawPrice === 'number' && Number.isFinite(rawPrice)
        ? rawPrice
        : parseLocalizedNumber(String(rawPrice ?? ''));
      const priceValue = Number.isFinite(parsedPrice) ? parsedPrice : 0;
      if (priceValue < 0) {
        rowErrors.price = t('price_not_negative_error');
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'price' });
      }

      const product = line.productId ? products.find((item) => item.id === line.productId) : undefined;
      const requiresWarehouse = product ? product.type === 'stock' : !line.isService;
      if (requiresWarehouse && (!line.warehouse.trim() || !line.warehouseId || line.warehouseId === 'undefined' || line.warehouseId === 'null')) {
        rowErrors.warehouse = `اختر مكان المخزون للصنف "${line.itemName}" من القائمة.`;
        addFirstTarget({ kind: 'line', lineId: line.id, field: 'warehouse' });
      }

      if (Object.keys(rowErrors).length) {
        nextErrors.rows[line.id] = rowErrors;
      }
    });

    const hasAnyValidLine = lines.some((line) => {
      if (checkIsBlankRow(line) || !line.productId) {
        return false;
      }
      return true;
    });

    if (!hasAnyValidLine) {
      const fallbackTarget: ConfirmFocusTarget = firstInvalidTarget ?? { kind: 'line', lineId: lines[0]?.id ?? Date.now(), field: 'product' };
      return { valid: false, errors: nextErrors, firstInvalidTarget: fallbackTarget };
    }

    return {
      valid: !nextErrors.supplier && !nextErrors.date && !nextErrors.requiredDate && !nextErrors.currency && Object.keys(nextErrors.rows).length === 0,
      errors: nextErrors,
      firstInvalidTarget
    };
  };
  return {
    applyTaxPreset,
    applyCustomTaxRate,
    applyDiscount,
    focusFirstInvalidField,
    validateBeforeConfirm,
  };
}
