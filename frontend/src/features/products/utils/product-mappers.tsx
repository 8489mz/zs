import i18n from '@/lib/i18n';
import { formatCurrency } from '@/lib/format';
import type { Product } from '@/types/domain';
import { getProductLocationDisplayName } from './product-location.utils';
import { FileTextIcon } from '@/shared/components/icons/AppIcons';
import { normalizeUnitName } from '@/shared/utils/unit-name';

export function matchProductSearch(product: Product, search: string, categoryName = '', supplierName = '') {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const unitValues = Array.isArray(product.units) ? product.units.flatMap((unit) => [unit.name, unit.barcode]) : [];
  return [product.name, product.barcode, categoryName, supplierName, product.notes, ...unitValues]
    .some((value) => String(value || '').toLowerCase().includes(q));
}

export function getProductMetrics(products: Product[]) {
  const lowStock = products.filter((product) => product.stock <= product.minStock);
  const outOfStock = products.filter((product) => product.stock <= 0);
  return {
    total: products.length,
    lowStockCount: lowStock.length,
    outOfStockCount: outOfStock.length
  };
}

export function getProductColumns(categoryNames: Record<string, string>, supplierNames: Record<string, string>, locationNames: Record<string, string> = {}) {
  const isEn = i18n.language === 'en';
  return [
    {
      key: 'name',
      header: isEn ? 'Product' : 'الصنف',
      cell: (product: Product) => (
        <div>
          <strong>{product.name}</strong>
          <div className="muted small">
            {isEn ? 'Units: ' : 'وحدات: '}
            {product.units.map((unit) => normalizeUnitName(unit.name)).join(' / ') || (isEn ? 'Piece' : 'قطعة')}
          </div>
        </div>
      )
    },
    { key: 'barcode', header: isEn ? 'Barcode' : 'الباركود', cell: (product: Product) => product.barcode || '—' },
    { 
      key: 'classification', 
      header: isEn ? 'Category / Supplier / Store' : 'القسم / المورد / المخزن', 
      cell: (product: Product) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div>{categoryNames[product.categoryId] || '—'}</div>
          <div className="muted small" title={isEn ? 'Supplier' : 'المورد'}>{supplierNames[product.supplierId] || '—'}</div>
          <div className="muted small text-primary" title={isEn ? 'Default Location' : 'المخزن الافتراضي'}>{getProductLocationDisplayName(product, locationNames)}</div>
        </div>
      )
    },
    { key: 'cost', header: isEn ? 'Cost' : 'الشراء', cell: (product: Product) => formatCurrency(product.costPrice) },
    { key: 'retail', header: isEn ? 'Retail' : 'القطاعي', cell: (product: Product) => formatCurrency(product.retailPrice) },
    { key: 'wholesale', header: isEn ? 'Wholesale' : 'الجملة', cell: (product: Product) => formatCurrency(product.wholesalePrice) },
    {
      key: 'stock',
      header: isEn ? 'Stock' : 'المخزون',
      cell: (product: Product) => <span className={product.stock <= product.minStock ? 'low-stock-badge' : 'status-badge status-posted'}>{product.stock}</span>
    },
    {
      key: 'notes',
      header: isEn ? 'Notes' : 'ملاحظات',
      cell: (product: Product) => (
        product.notes ? (
          <span title={product.notes} style={{ color: '#1d4ed8', fontWeight: 700, fontSize: '0.75rem', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <FileTextIcon size={12} color="#1d4ed8" /> {isEn ? 'Note' : 'ملاحظة'}
          </span>
        ) : '—'
      )
    }
  ];
}

export function getProductItemCode(product: Product, unit?: { barcode?: string }) {
  return String(product.styleCode || unit?.barcode || product.barcode || product.id || '').trim();
}

export function getSaleUnit(product: Product) {
  const units = Array.isArray(product.units) ? product.units : [];
  return units.find((u) => u.isSaleUnit) || units.find((u) => u.isBaseUnit) || units[0] || { id: 'default', name: 'قطعة', multiplier: 1 };
}
