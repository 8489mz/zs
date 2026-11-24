import { useTranslation } from 'react-i18next';
import React from 'react';
import { LineItem, IssueOrderProductOption } from './types';
import { AsyncSearchableCombobox } from '@/shared/ui/async-searchable-combobox';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';

interface IssueOrderItemsTableProps {
  lines: LineItem[];
  fromLocationId: string;
  products: any[];
  locationOptions: { id: string; name: string; searchTerms: string }[];
  productOptions: IssueOrderProductOption[];
  productSearchRefreshKey?: string;
  fetchProductOptions: (query: string) => Promise<IssueOrderProductOption[]>;
  stocks: any[];
  onSelectProduct: (lineId: number, product: IssueOrderProductOption) => void;
  onUpdateLine: (lineId: number, field: keyof LineItem, value: any) => void;
  onRemoveLine: (lineId: number) => void;
  onQtyKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, lineId: number) => void;
  summary?: { itemsCount: number; totalPieces: number };
}

export const IssueOrderItemsTable: React.FC<IssueOrderItemsTableProps> = ({
  lines,
  fromLocationId,
  locationOptions,
  productOptions,
  productSearchRefreshKey,
  fetchProductOptions,
  stocks,
  onSelectProduct,
  onUpdateLine,
  onRemoveLine,
  onQtyKeyDown,
  summary,
}) => {
  const { t } = useTranslation();
  return (
    <div className="purchase-prototype-desktop-table">
      <div className="purchase-prototype-items-table-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
        <table className="purchase-prototype-items-table" style={{ width: '100%', minWidth: '780px', borderCollapse: 'collapse', textAlign: 'right' }}>
          <thead style={{ backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}>
            <tr>
              <th style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 600, width: '280px' }}>{t('inventory.issue_order.issue_order_items_table.s0', "الصنف (بحث بالاسم أو الباركود)")}</th>
              {fromLocationId === 'all' && (
                <th style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 600, width: '180px' }}>{t('inventory.issue_order.issue_order_items_table.s1', "مخزن الصرف")}</th>
              )}
              <th style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 600, width: '130px' }}>{t('inventory.issue_order.issue_order_items_table.s2', "الكمية المتاحة (بالمخزن)")}</th>
              <th style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontWeight: 600, width: '120px' }}>{t('inventory.issue_order.issue_order_items_table.s3', "الكمية المصروفة")}</th>
              <th style={{ padding: '10px 14px', width: '50px' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              let availableStock = '-';

              if (line.productId) {
                const locId = fromLocationId === 'all' ? line.fromLocationId : fromLocationId;

                if (locId && locId !== 'all') {
                  const locStock = stocks.find(s => String(s.productId) === String(line.productId) && String(s.locationId) === String(locId));
                  if (locStock) {
                    const baseAvail = typeof locStock.availableQty === 'number' ? locStock.availableQty : locStock.qty;
                    const remaining = Math.max(0, Number((baseAvail - (line.qty || 0)).toFixed(3)));
                    availableStock = String(remaining);
                  } else {
                    availableStock = '0';
                  }
                } else {
                  const totalStock = stocks
                    .filter(s => String(s.productId) === String(line.productId))
                    .reduce((acc, s) => acc + (typeof s.availableQty === 'number' ? s.availableQty : s.qty), 0);
                  availableStock = String(Math.max(0, Number((totalStock - (line.qty || 0)).toFixed(3))));
                }
              }

              return (
                <tr key={line.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px 16px' }}>
                    <AsyncSearchableCombobox
                      inputId={`product-input-${line.id}`}
                      defaultOptions={productOptions}
                      refreshKey={productSearchRefreshKey}
                      value={line.productName || ''}
                      onChange={(v) => onUpdateLine(line.id, 'productName', v)}
                      onSelect={(p) => onSelectProduct(line.id, p)}
                      getLabel={(p) => p.name}
                      getMeta={(p) => p.meta}
                      isOptionMuted={(p) => p.isOutOfStock}
                      maxResults={50}
                      fetchOptions={fetchProductOptions}
                      createLabel={(q) => `إضافة "${q}"`}
                      placeholder={t('inventory.issue_order.issue_order_items_table.s4', "بحث عن صنف...")}
                      inline={true}
                      inputClassName="purchase-prototype-field-input"
                    />
                  </td>
                  {fromLocationId === 'all' && (
                    <td style={{ padding: '8px 16px' }}>
                      <SearchableCombobox
                        options={locationOptions.filter(l => l.id !== 'all')}
                        value={line.fromLocationName || ''}
                        onChange={(v) => onUpdateLine(line.id, 'fromLocationName', v)}
                        onSelect={(l) => onUpdateLine(line.id, 'fromLocationId', l.id)}
                        getLabel={(l) => l.name}
                        search={(l, q) => l.searchTerms.includes(q.toLowerCase())}
                        createLabel={(q) => `إضافة "${q}"`}
                        placeholder={t('inventory.issue_order.issue_order_items_table.s5', "اختر المخزن...")}
                        inline={true}
                        inputClassName="purchase-prototype-field-input"
                      />
                    </td>
                  )}
                  <td style={{ padding: '8px 16px', color: 'var(--text-secondary)' }}>
                    {availableStock}
                  </td>
                  <td style={{ padding: '8px 16px' }}>
                    <input
                      id={`quantity-input-${line.id}`}
                      type="number"
                      className="purchase-prototype-field-input"
                      min="0.001"
                      step="any"
                      value={line.qty}
                      onChange={(e) => onUpdateLine(line.id, 'qty', e.target.value ? Number(e.target.value) : '')}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => onQtyKeyDown(e, line.id)}
                      style={{ height: '36px' }}
                    />
                  </td>
                  <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => onRemoveLine(line.id)}
                      disabled={lines.length === 1 && !line.productId}
                      style={{
                        color: 'var(--danger-color)',
                        background: 'none',
                        border: 'none',
                        cursor: (lines.length === 1 && !line.productId) ? 'not-allowed' : 'pointer',
                        padding: '8px',
                        opacity: (lines.length === 1 && !line.productId) ? 0.5 : 1,
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {summary && (
            <tfoot style={{ backgroundColor: 'var(--surface-color, #f8fafc)', borderTop: '2px solid var(--border-color, #e2e8f0)', fontWeight: 700 }}>
              <tr>
                <td style={{ padding: '10px 16px', color: 'var(--text-secondary, #64748b)' }}>
                  {t('inventory.issue_order.issue_order_items_table.s6', "عدد الأصناف:")}{' '}
                  <strong style={{ color: 'var(--text-primary, #0f172a)', fontSize: '0.95rem' }}>
                    {summary.itemsCount}
                  </strong>
                </td>
                {fromLocationId === 'all' && <td />}
                <td style={{ padding: '10px 16px', color: 'var(--text-secondary, #64748b)', textAlign: 'left' }}>
                  {t('inventory.issue_order.issue_order_items_table.s7', "عدد القطع:")}
                </td>
                <td style={{ padding: '10px 16px', color: '#170e5e', fontWeight: 800, fontSize: '1rem' }}>
                  {summary.totalPieces}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
