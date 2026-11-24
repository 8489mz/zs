import { Button } from '@/shared/ui/button';
import { SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  __t: ReturnType<typeof useTranslation>['t'];
  selectedCategoryId: string;
  setSelectedCategoryId: (val: string) => void;
  categoryNames: Record<string, string>;
  viewFilter: 'all' | 'low' | 'out' | 'offers' | 'special' | 'archived';
  onViewFilterChange: (value: 'all' | 'low' | 'out' | 'offers' | 'special' | 'archived') => void;
  t: ReturnType<typeof useTranslation>['t'];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (field: string) => void;
}

export function ProductsTableCardToolbar({ search, onSearchChange, __t, selectedCategoryId, setSelectedCategoryId, categoryNames, viewFilter, onViewFilterChange, t, sortField, sortDirection, onSortChange }: ProductsTableCardToolbarProps) {
  return (
    <>
    <div className="products-table-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 320px' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={__t('products.products_table_card.s3', "ابحث بالاسم أو الباركود أو القسم أو المورد أو الخاصية الفرعية...")}
            className="purchase-prototype-field-input"
            style={{
              width: '100%',
              height: '38px',
              paddingInlineStart: '36px',
              paddingInlineEnd: search ? '32px' : '12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '10px', color: '#94a3b8', display: 'flex', pointerEvents: 'none' }}>
            <SearchIcon size={16} />
          </div>
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              style={{
                position: 'absolute',
                top: '50%',
                transform: 'translateY(-50%)',
                insetInlineEnd: '10px',
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
              }}
              title={__t('products.products_table_card.s4', "مسح البحث")}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>

        <div className="products-category-select-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="purchase-prototype-field-input"
            style={{
              height: '38px',
              minWidth: '180px',
              padding: '0 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontWeight: 600,
              fontSize: '12.5px',
              color: '#1e293b',
              boxSizing: 'border-box',
            }}
          >
            <option value="">{__t('products.products_table_card.s5', "كل الأقسام (")}{Object.keys(categoryNames).length})</option>
            {Object.entries(categoryNames).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          {selectedCategoryId && (
            <Button
              variant="secondary"
              onClick={() => setSelectedCategoryId('')}
              style={{ height: '38px', padding: '0 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              title={__t('products.products_table_card.s6', "إلغاء تصفية القسم")}
            >
              <XIcon size={13} />
              <span>{__t('products.products_table_card.s7', "إلغاء")}</span>
            </Button>
          )}
        </div>
      </div>

      <div
        className="filter-chip-row toolbar-chip-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          maxWidth: '100%',
          paddingBottom: '4px',
        }}
      >
        <Button variant={viewFilter === 'all' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('all')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('common.all', 'الكل')}</Button>
        <Button variant={viewFilter === 'low' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('low')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.low_stock', 'منخفضة')}</Button>
        <Button variant={viewFilter === 'out' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('out')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.out_of_stock', 'نافدة')}</Button>
        <Button variant={viewFilter === 'offers' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('offers')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.with_offers', 'بعروض')}</Button>
        <Button variant={viewFilter === 'special' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('special')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.special_prices', 'أسعار خاصة')}</Button>
        <Button variant={viewFilter === 'archived' ? 'primary' : 'secondary'} onClick={() => onViewFilterChange('archived')} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('products.archived', 'المؤرشفة')}</Button>
        {sortField ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11.5px',
              background: '#eef2ff',
              color: '#170e5e',
              border: '1px solid #c7d2fe',
              padding: '2px 10px',
              borderRadius: '16px',
              fontWeight: 600,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              marginInlineStart: 'auto',
            }}
          >
            <span>
              {__t('products.sorted_by', 'مرتب حسب:')}{' '}
              {sortField === 'name'
                ? t('products.product_col', 'الصنف')
                : sortField === 'stock'
                ? t('products.stock_col', 'المخزون')
                : sortField === 'price'
                ? t('products.prices_col', 'الأسعار')
                : sortField === 'barcode'
                ? t('products.barcode_col', 'الباركود')
                : sortField === 'category'
                ? t('products.category_supplier_store_col', 'القسم')
                : sortField}{' '}
              ({sortDirection === 'desc' ? 'تنازلي' : 'تصاعدي'})
            </span>
            <button
              type="button"
              onClick={() => onSortChange?.('')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#170e5e',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
              }}
              title={__t('products.reset_sort_hint', 'إلغاء الفرز والعودة للترتيب الافتراضي')}
            >
              <XIcon size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
    </>
  );
}
