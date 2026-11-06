import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import type { SupplierOption, ContactOption, CostCenterOption, ProjectOption } from './newPurchaseOrder.types';

export const formatMoney = (value: number, lang?: string, currency?: string) => {
  const code = currency || getGlobalSystemCurrency();
  const symbol = lang === 'en' ? code : getGlobalCurrencySymbol();
  return `${Number(value || 0).toFixed(2)} ${symbol}`;
};

export const normalizeSearchText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[٠-٩۰-۹]/g, (digit) => {
      const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
      const latin = '01234567890123456789';
      const index = digits.indexOf(digit);
      return index >= 0 ? latin[index] : digit;
    })
    .replace(/[ً-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const includesNormalized = (source: string, query: string) => normalizeSearchText(source).includes(normalizeSearchText(query));

export const normalizeNumericText = (value: string) =>
  value
    .replace(/[٠-٩۰-۹]/g, (digit) => {
      const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
      const latin = '01234567890123456789';
      const index = digits.indexOf(digit);
      return index >= 0 ? latin[index] : digit;
    })
    .replace(/[٫،,]/g, '.')
    .replace(/٬/g, '')
    .trim();

export const parseLocalizedNumber = (value: string) => {
  const normalized = normalizeNumericText(value).replace(/,/g, '');
  if (!normalized) {
    return NaN;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const searchSupplier = (supplier: SupplierOption, query: string) => {
  if (!normalizeSearchText(query)) {
    return true;
  }

  return [supplier.name, supplier.code, supplier.phone, supplier.taxNumber, supplier.company ?? '', supplier.contactName ?? '', supplier.shippingAddress ?? ''].some((value) => includesNormalized(value, query));
};

export const searchContact = (contact: ContactOption, query: string) => {
  if (!normalizeSearchText(query)) {
    return true;
  }

  return [contact.name, contact.phone, contact.supplierName ?? ''].some((value) => includesNormalized(value, query));
};

export const searchWarehouse = (warehouse: any, query: string) => {
  if (!normalizeSearchText(query)) {
    return true;
  }

  return [warehouse.name, warehouse.code].some((value) => includesNormalized(value, query));
};

export const searchCostCenter = (costCenter: CostCenterOption, query: string) => {
  if (!normalizeSearchText(query)) {
    return true;
  }

  return [costCenter.name, costCenter.code].some((value) => includesNormalized(value, query));
};

export const searchProject = (project: ProjectOption, query: string) => {
  if (!normalizeSearchText(query)) {
    return true;
  }

  return [project.name, project.code].some((value) => includesNormalized(value, query));
};

export const createEntityId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Map a catalog product to the purchase-order line kind
 * (INV-SERVICE-ITEM-QUICK-CREATE). The service axis is `itemType`
 * ('product' | 'raw_material' | 'service') as returned by the catalog
 * API — NOT `itemKind`, which is the fashion axis ('standard' |
 * 'fashion') and is never 'service'. Reading the wrong axis made every
 * service item load as a stocked product, so a service line always
 * demanded a warehouse and quick-created services came back as stock.
 * `productType` is accepted as a legacy alias; unknown/missing reads
 * as stock, the previous behaviour for stocked products.
 */
export const mapPurchaseProductType = (product: {
  itemType?: string | null;
  productType?: string | null;
  itemKind?: string | null;
}): 'stock' | 'service' =>
  product.itemType === 'service' || product.productType === 'service' ? 'service' : 'stock';
