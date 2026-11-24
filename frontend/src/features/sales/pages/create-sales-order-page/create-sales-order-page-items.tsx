import { Button } from '@/shared/ui/button';
import { PackageIcon } from '@/shared/components/icons/AppIcons';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { formatCurrency, formatCurrencyWithSymbol } from '@/lib/format';
import { matchesArabic } from '@/lib/arabic-normalization';
import { useTranslation } from 'react-i18next';
import type { SalesOrderFormItem } from './create-sales-order-page-shared';
import type { Dispatch, SetStateAction } from 'react';
import type { Product } from '@/types/domain';

export interface CreateSalesOrderPageItemsProps {
  t: ReturnType<typeof useTranslation>['t'];
  items: SalesOrderFormItem[];
  handleAddItem: () => void;
  handleAddServiceLine: () => void;
  setActiveQuickAction: Dispatch<SetStateAction<'tax' | 'discount' | null>>;
  taxRate: number;
  discountValue: number;
  discountMode: 'percent' | 'value';
  activeQuickAction: 'tax' | 'discount' | null;
  setTaxRate: Dispatch<SetStateAction<number>>;
  setDiscountMode: Dispatch<SetStateAction<'percent' | 'value'>>;
  setDiscountValue: Dispatch<SetStateAction<number>>;
  handleUpdateLine: (id: number, field: keyof SalesOrderFormItem, value: any) => void;
  schedulePickerAvailabilityRefresh: (query: string) => void;
  productOptions: { id: string; rawId: number; name: string; barcode: string; sku: string; price: number; costPrice: number; unit: any; stock: number; raw: Product; }[];
  availabilityByProduct: Record<number, number>;
  handleProductSelect: (id: number, option: any) => void;
  currency: string;
  handleRemoveItem: (id: number) => void;
  handleBarcodeScan: () => void;
  setItems: Dispatch<SetStateAction<SalesOrderFormItem[]>>;
}
export function CreateSalesOrderPageItems({ t, items, handleAddItem, handleAddServiceLine, setActiveQuickAction, taxRate, discountValue, discountMode, activeQuickAction, setTaxRate, setDiscountMode, setDiscountValue, handleUpdateLine, schedulePickerAvailabilityRefresh, productOptions, availabilityByProduct, handleProductSelect, currency, handleRemoveItem, handleBarcodeScan, setItems }: CreateSalesOrderPageItemsProps) {
  return (
    <>
    {/* Section 3: Items Table */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PackageIcon size={16} color="#170e5e" />
          <h3 className="document-prototype-section-title" style={{ margin: 0 }}>{t('sales.create_sales_order_page.s34', "الأصناف والكميات")}</h3>
          <span className="nav-pill" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>({items.length} {t('sales.create_sales_order_page.s35', "صنف)")}</span>
        </div>
        <div className="purchase-prototype-quick-actions" aria-label={t('sales.create_sales_order_page.s36', "إجراءات سريعة")}>
          <button
            type="button"
            className="purchase-prototype-quick-action"
            title={t('sales.create_sales_order_page.s37', "إضافة صنف جديد")}
            onClick={handleAddItem}
            style={{ fontWeight: 700, color: '#1e40af' }}
          >
            <span aria-hidden="true">+</span>
            <span>{t('sales.create_sales_order_page.s38', "صنف")}</span>
          </button>
          <button
            type="button"
            className="purchase-prototype-quick-action"
            title={t('sales.create_sales_order_page.s39', "إضافة بند خدمة أو شحن")}
            onClick={handleAddServiceLine}
            style={{ fontWeight: 700, color: '#0284c7' }}
          >
            <span aria-hidden="true">+</span>
            <span>{t('sales.create_sales_order_page.s40', "خدمة")}</span>
          </button>
          <button
            type="button"
            className="purchase-prototype-quick-action"
            title={t('sales.create_sales_order_page.s41', "تطبيق ضريبة")}
            onClick={() => setActiveQuickAction((curr) => (curr === 'tax' ? null : 'tax'))}
            style={
              taxRate > 0
                ? { borderColor: '#2563eb', color: '#1d4ed8', backgroundColor: '#eff6ff', fontWeight: 700 }
                : undefined
            }
          >
            <span aria-hidden="true">%</span>
            <span>{t('sales.create_sales_order_page.s42', "ضريبة")}{taxRate > 0 ? ` ${taxRate}%` : ''}</span>
          </button>
          <button
            type="button"
            className="purchase-prototype-quick-action"
            title={t('sales.create_sales_order_page.s43', "إضافة خصم")}
            onClick={() => setActiveQuickAction((curr) => (curr === 'discount' ? null : 'discount'))}
            style={
              discountValue > 0
                ? { borderColor: '#16a34a', color: '#15803d', backgroundColor: '#f0fdf4', fontWeight: 700 }
                : undefined
            }
          >
            <span>{t('sales.create_sales_order_page.s44', "خصم")}{discountValue > 0 ? (discountMode === 'percent' ? ` ${discountValue}%` : ` ${discountValue}`) : ''}</span>
          </button>
        </div>
      </div>

      {/* Quick Action Popovers */}
      {activeQuickAction === 'tax' && (
        <div className="purchase-prototype-popover" role="dialog" style={{ marginBottom: '12px' }}>
          <div className="purchase-prototype-popover-row">
            <button
              type="button"
              className={`purchase-prototype-popover-option ${taxRate === 0 ? 'active' : ''}`}
              onClick={() => {
                setTaxRate(0);
                setActiveQuickAction(null);
              }}
              style={taxRate === 0 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
            >
              {t('sales.create_sales_order_page.s45', "بدون ضريبة")}
            </button>
            <button
              type="button"
              className={`purchase-prototype-popover-option ${taxRate === 14 ? 'active' : ''}`}
              onClick={() => {
                setTaxRate(14);
                setActiveQuickAction(null);
              }}
              style={taxRate === 14 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
            >
              {t('sales.create_sales_order_page.s46', "14% (قيمة مضافة قياسية)")}
            </button>
            <button
              type="button"
              className={`purchase-prototype-popover-option ${taxRate === 15 ? 'active' : ''}`}
              onClick={() => {
                setTaxRate(15);
                setActiveQuickAction(null);
              }}
              style={taxRate === 15 ? { backgroundColor: '#e0e7ff', borderColor: '#4338ca', color: '#3730a3', fontWeight: 700 } : undefined}
            >
              {t('sales.create_sales_order_page.s47', "15% (الضريبة الخليجية)")}
            </button>
          </div>
        </div>
      )}

      {activeQuickAction === 'discount' && (
        <div className="purchase-prototype-popover" role="dialog" style={{ marginBottom: '12px' }}>
          <div className="purchase-prototype-popover-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={discountMode}
              onChange={(e) => setDiscountMode(e.target.value as 'percent' | 'value')}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            >
              <option value="value">{t('sales.create_sales_order_page.s48', "مبلغ ثابت (ج.م)")}</option>
              <option value="percent">{t('sales.create_sales_order_page.s49', "نسبة مئوية (%)")}</option>
            </select>
            <input
              type="number"
              min="0"
              value={discountValue}
              onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
              placeholder={t('sales.create_sales_order_page.s50', "قيمة الخصم...")}
              style={{ width: '120px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', textAlign: 'center' }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setActiveQuickAction(null)}
              style={{ height: '32px', fontSize: '12px' }}
            >
              {t('sales.create_sales_order_page.s51', "تطبيق")}
            </Button>
          </div>
        </div>
      )}

      {/* Desktop Items Table with Shaded Header */}
      <div className="document-line-items-table-wrap">
        <table className="document-line-items-table">
          <thead>
            <tr>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-product" style={{ width: '32%', textAlign: 'right' }}>{t('sales.create_sales_order_page.s52', "الصنف")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-category" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s53', "الوحدة")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-warehouse" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s54', "رصيد المخزن")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-qty" style={{ width: '10%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s55', "الكمية")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s56', "السعر")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-price" style={{ width: '10%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s57', "الخصم")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-amount" style={{ width: '12%', textAlign: 'center' }}>{t('sales.create_sales_order_page.s58', "المبلغ")}</th>
              <th className="purchase-prototype-table-head purchase-prototype-table-head-actions" style={{ width: '5%', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((line) => (
              <tr key={line.id}>
                {/* Item Name */}
                <td className="purchase-prototype-table-cell purchase-prototype-table-cell-item">
                  <SearchableCombobox
                    inline
                    className="purchase-prototype-inline-combobox"
                    inputClassName="purchase-prototype-field-input purchase-prototype-combobox-input purchase-prototype-combobox-input-inline"
                    placeholder={t('sales.create_sales_order_page.s59', "ابحث عن صنف بالاسم أو الباركود...")}
                    value={line.productName}
                    onChange={(value) => {
                      handleUpdateLine(line.id, 'productName', value);
                      schedulePickerAvailabilityRefresh(value);
                    }}
                    options={productOptions}
                    getLabel={(p) => p.name}
                    getMeta={(p) => {
                      // INV-SALES-ORDER-RESERVED-STOCK-DISPLAY: the
                      // suggestion shows ONLY the reserved-aware
                      // availability in the selected warehouse.
                      // The catalog stock (p.stock) ignores
                      // reservations — it showed "رصيد: 10" for a
                      // product whose 10 units were already
                      // reserved. Unknown until the read returns:
                      // no stock segment at all, never a number
                      // from another source.
                      const avail = availabilityByProduct[p.rawId];
                      return [p.barcode, p.price > 0 ? `${formatCurrency(p.price)}` : undefined, avail === undefined ? undefined : `رصيد: ${avail}`].filter(Boolean).join(' · ');
                    }}
                    search={(p, query) =>
                      matchesArabic(p.name, query) ||
                      (p.barcode ? p.barcode.includes(query) : false) ||
                      (p.sku ? p.sku.toLowerCase().includes(query.toLowerCase()) : false)
                    }
                    onSelect={(option) => handleProductSelect(line.id, option)}
                    onOpenChange={(open) => {
                      if (open) schedulePickerAvailabilityRefresh(line.productName);
                    }}
                    showDropdownOnEmpty={true}
                    emptyLabel={t('sales.create_sales_order_page.s60', "صنف جديد (يمكنك المتابعة بالاسم المدخل)")}
                  />
                </td>

                {/* Unit */}
                <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                  <input
                    className="purchase-prototype-table-input"
                    type="text"
                    placeholder={t('sales.create_sales_order_page.s61', "الوحدة...")}
                    value={line.unitName || ''}
                    onChange={(e) => handleUpdateLine(line.id, 'unitName', e.target.value)}
                    style={{ textAlign: 'center' }}
                  />
                </td>

                {/* Stock on hand */}
                <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                  <span
                    className="nav-pill"
                    style={{
                      fontSize: '0.72rem',
                      padding: '2px 8px',
                      fontWeight: 700,
                      backgroundColor: (line.stockOnHand ?? 0) > 0 ? '#f0fdf4' : '#fef2f2',
                      color: (line.stockOnHand ?? 0) > 0 ? '#15803d' : '#b91c1c',
                      borderColor: (line.stockOnHand ?? 0) > 0 ? '#bbf7d0' : '#fecaca',
                    }}
                  >
                    {line.stockOnHand ?? 0} {t('sales.create_sales_order_page.s62', "متاح")}
                  </span>
                </td>

                {/* Quantity */}
                <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                  <input
                    className="purchase-prototype-table-input"
                    type="number"
                    min="1"
                    step="1"
                    value={line.quantity}
                    onChange={(e) => handleUpdateLine(line.id, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                    style={{ textAlign: 'center', fontWeight: 600 }}
                  />
                </td>

                {/* Price */}
                <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                  <input
                    className="purchase-prototype-table-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => handleUpdateLine(line.id, 'unitPrice', Math.max(0, Number(e.target.value) || 0))}
                    style={{ textAlign: 'center', fontWeight: 600 }}
                  />
                </td>

                {/* Line Discount */}
                <td className="purchase-prototype-table-cell" style={{ textAlign: 'center' }}>
                  <input
                    className="purchase-prototype-table-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.discount || 0}
                    onChange={(e) => handleUpdateLine(line.id, 'discount', Math.max(0, Number(e.target.value) || 0))}
                    style={{ textAlign: 'center', color: '#dc2626' }}
                  />
                </td>

                {/* Line Total */}
                <td className="line-total" style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e' }}>
                  {formatCurrencyWithSymbol(line.total || 0, currency)}
                </td>

                {/* Delete Action */}
                <td className="purchase-prototype-table-cell purchase-prototype-table-cell-actions" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="document-row-delete purchase-prototype-row-delete"
                    onClick={() => handleRemoveItem(line.id)}
                    disabled={items.length === 1}
                    title={t('sales.create_sales_order_page.s63', "حذف هذا الصنف")}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom Dashed Actions */}
      <div className="document-line-items-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <Button type="button" variant="dashedAction" onClick={handleAddItem}>
          <span aria-hidden="true">+</span>
          <span>{t('sales.create_sales_order_page.s64', "إضافة صنف")}</span>
        </Button>
        <Button type="button" variant="dashedAction" onClick={handleBarcodeScan}>
          <span aria-hidden="true" className="purchase-prototype-scan-icon">
            <svg viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true" width="14" height="14">
              <path d="M3 4.2V3.1A.6.6 0 0 1 3.6 2.5h1.1M11.3 2.5h1.1a.6.6 0 0 1 .6.6v1.1M13 11.8v1.1a.6.6 0 0 1-.6.6h-1.1M4.7 13.5H3.6a.6.6 0 0 1-.6-.6v-1.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.1 5.2v5.6M7 5.2v5.6M9 5.2v5.6M10.9 5.2v5.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span>{t('sales.create_sales_order_page.s65', "مسح باركود")}</span>
        </Button>
        <Button
          type="button"
          variant="dashedAction"
          onClick={() => {
            const name = window.prompt(t('sales.create_sales_order_page.s66', "أدخل اسم المنتج الجديد:"));
            if (name && name.trim()) {
              setItems((prev) => [
                ...prev,
                {
                  id: Date.now() + Math.random(),
                  productId: 0,
                  productName: name.trim(),
                  unitName: t('sales.create_sales_order_page.s67', "قطعة"),
                  quantity: 1,
                  unitPrice: 0,
                  total: 0,
                  discount: 0,
                  stockOnHand: 0,
                  warehouse: t('sales.create_sales_order_page.s68', "المستودع الرئيسي"),
                },
              ]);
            }
          }}
        >
          <span aria-hidden="true">+</span>
          <span>{t('sales.create_sales_order_page.s69', "منتج جديد")}</span>
        </Button>
      </div>
    </section>
    </>
  );
}
