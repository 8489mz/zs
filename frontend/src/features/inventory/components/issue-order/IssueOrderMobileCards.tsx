import { useTranslation } from 'react-i18next';
import React from 'react';
import { LineItem, IssueOrderProductOption } from './types';
import { Field } from '@/shared/ui/field';
import { AsyncSearchableCombobox } from '@/shared/ui/async-searchable-combobox';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';

interface IssueOrderMobileCardsProps {
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
  onOpenScanner: (lineId: number) => void;
}

export const IssueOrderMobileCards: React.FC<IssueOrderMobileCardsProps> = ({
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
  onOpenScanner,
}) => {
  const { t } = useTranslation();
  return (
    <div className="purchase-prototype-mobile-cards">
      {lines.map((line, index) => {
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
          <div key={line.id} className="purchase-prototype-item-card">
            <div className="item-card-header">
              <div className="item-card-badge">
                <span className="item-card-num">{t('inventory.issue_order.issue_order_mobile_cards.s0', "بند #")}{index + 1}</span>
                {line.productId && (
                  <span className={`item-card-stock-pill ${availableStock === '0' ? 'stock-zero' : 'stock-ok'}`}>
                    {t('inventory.issue_order.issue_order_mobile_cards.s1', "الرصيد المتاح:")} {availableStock}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="item-card-delete-btn"
                onClick={() => onRemoveLine(line.id)}
                disabled={lines.length === 1 && !line.productId}
                title={t('inventory.issue_order.issue_order_mobile_cards.s2', "حذف البند")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>

            <div className="item-card-field">
              <Field label={t('inventory.issue_order.issue_order_mobile_cards.s3', "الصنف (بحث بالاسم أو الباركود)")}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AsyncSearchableCombobox
                      inputId={`product-input-mobile-${line.id}`}
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
                      placeholder={t('inventory.issue_order.issue_order_mobile_cards.s4', "ابحث عن صنف أو امسح باركود...")}
                      inline={true}
                      inputClassName="purchase-prototype-field-input"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenScanner(line.id)}
                    title={t('inventory.issue_order.issue_order_mobile_cards.s5', "مسح باركود بالكاميرا")}
                    style={{
                      height: '38px',
                      width: '38px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#2563eb',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                  </button>
                </div>
              </Field>
            </div>

            <div className="item-card-row">
              {fromLocationId === 'all' && (
                <div className="item-card-field">
                  <Field label={t('inventory.issue_order.issue_order_mobile_cards.s6', "مخزن الصرف")}>
                    <SearchableCombobox
                      options={locationOptions.filter(l => l.id !== 'all')}
                      value={line.fromLocationName || ''}
                      onChange={(v) => onUpdateLine(line.id, 'fromLocationName', v)}
                      onSelect={(l) => onUpdateLine(line.id, 'fromLocationId', l.id)}
                      getLabel={(l) => l.name}
                      search={(l, q) => l.searchTerms.includes(q.toLowerCase())}
                      createLabel={(q) => `إضافة "${q}"`}
                      placeholder={t('inventory.issue_order.issue_order_mobile_cards.s7', "اختر المخزن...")}
                      inline={true}
                      inputClassName="purchase-prototype-field-input"
                    />
                  </Field>
                </div>
              )}

              <div className="item-card-field">
                <Field label={t('inventory.issue_order.issue_order_mobile_cards.s8', "الكمية المصروفة")}>
                  <input
                    id={`quantity-input-mobile-${line.id}`}
                    type="number"
                    className="purchase-prototype-field-input"
                    min="0.001"
                    step="any"
                    value={line.qty}
                    onChange={(e) => onUpdateLine(line.id, 'qty', e.target.value ? Number(e.target.value) : '')}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => onQtyKeyDown(e, line.id)}
                    style={{ height: '38px', minHeight: '38px', fontSize: '15px', fontWeight: 700, textAlign: 'center', boxSizing: 'border-box' }}
                  />
                </Field>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
