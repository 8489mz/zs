import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { formatCurrency } from '@/lib/format';
import { matchesArabic } from '@/lib/arabic-normalization';
import { PlusIcon, SlidersIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { QuotationFormItem } from './quotation-form-item';
import type { Product } from '@/types/domain';

export interface CreateQuotationPageItemsProps {
  t: ReturnType<typeof useTranslation>['t'];
  handleAddItem: (type?: 'product' | 'service') => void;
  activeQuickAction: 'tax' | 'discount' | null;
  setActiveQuickAction: React.Dispatch<React.SetStateAction<'tax' | 'discount' | null>>;
  setTaxRate: React.Dispatch<React.SetStateAction<number>>;
  taxRate: number;
  setDiscountMode: React.Dispatch<React.SetStateAction<'percent' | 'value'>>;
  discountMode: 'percent' | 'value';
  discountValue: number;
  setDiscountValue: React.Dispatch<React.SetStateAction<number>>;
  currency: string;
  items: QuotationFormItem[];
  handleUpdateItem: (id: number, updates: Partial<QuotationFormItem>) => void;
  schedulePickerAvailabilityRefresh: (query: string) => void;
  productOptions: {
    id: string;
    rawId: number;
    name: string;
    barcode: string;
    sku: string;
    price: number;
    costPrice: number;
    unit: string;
    stock: number;
    raw: Product;
  }[];
  availabilityByProduct: Record<number, number>;
  handleProductSelect: (itemId: number, option: any) => void;
  handleRemoveItem: (id: number) => void;
}

export function CreateQuotationPageItems(props: CreateQuotationPageItemsProps) {
  const { t, handleAddItem, activeQuickAction, setActiveQuickAction, setTaxRate, taxRate, setDiscountMode, discountMode, discountValue, setDiscountValue, currency, items, handleUpdateItem, schedulePickerAvailabilityRefresh, productOptions, availabilityByProduct, handleProductSelect, handleRemoveItem } = props;
  return (
    <>
    {/* Section 2: Quick Action Toolbar */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <div className="section-header-compact-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="document-prototype-section-title" style={{ margin: 0 }}>
          <SlidersIcon size={16} color="#170e5e" />
          <span>{t('sales.create_quotation_page.s26', "بنود عرض السعر (Line Items)")}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleAddItem('product')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <PlusIcon size={14} />
            {t('sales.create_quotation_page.s27', "+ صنف")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleAddItem('service')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <PlusIcon size={14} />
            {t('sales.create_quotation_page.s28', "+ خدمة")}
          </Button>
          <Button
            variant={activeQuickAction === 'tax' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveQuickAction(activeQuickAction === 'tax' ? null : 'tax')}
          >
            {t('sales.create_quotation_page.s29', "% ضريبة")}
          </Button>
          <Button
            variant={activeQuickAction === 'discount' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveQuickAction(activeQuickAction === 'discount' ? null : 'discount')}
          >
            {t('sales.create_quotation_page.s30', "خصم إجمالي")}
          </Button>
        </div>
      </div>

      {/* Quick Action Flyouts */}
      {activeQuickAction === 'tax' && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px 16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('sales.create_quotation_page.s31', "تطبيق ضريبة قيمة مضافة إجمالية:")}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[0, 5, 14, 15].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setTaxRate(rate)}
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: taxRate === rate ? '1px solid #170e5e' : '1px solid #cbd5e1',
                  background: taxRate === rate ? '#170e5e' : '#ffffff',
                  color: taxRate === rate ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {rate}%
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0"
            max="100"
            value={taxRate}
            onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
            onFocus={(e) => e.target.select()}
            style={{ width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
          <span style={{ fontSize: '12px', color: '#64748b' }}>%</span>
        </div>
      )}

      {activeQuickAction === 'discount' && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px 16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{t('sales.create_quotation_page.s32', "تطبيق خصم إجمالي:")}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setDiscountMode('value')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                border: discountMode === 'value' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                background: discountMode === 'value' ? '#170e5e' : '#ffffff',
                color: discountMode === 'value' ? '#ffffff' : '#475569',
                cursor: 'pointer',
              }}
            >
              {t('sales.create_quotation_page.s33', "مبلغ ثابت")}
            </button>
            <button
              type="button"
              onClick={() => setDiscountMode('percent')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                border: discountMode === 'percent' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                background: discountMode === 'percent' ? '#170e5e' : '#ffffff',
                color: discountMode === 'percent' ? '#ffffff' : '#475569',
                cursor: 'pointer',
              }}
            >
              {t('sales.create_quotation_page.s34', "نسبة مئوية %")}
            </button>
          </div>
          <input
            type="number"
            min="0"
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
            onFocus={(e) => e.target.select()}
            style={{ width: '100px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {discountMode === 'percent' ? '%' : currency}
          </span>
        </div>
      )}

      {/* Line Items Table */}
      <div className="document-line-items-table-wrap" style={{ marginTop: '14px' }}>
        <table className="document-line-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              <th style={{ textAlign: 'right', minWidth: '220px' }}>{t('sales.create_quotation_page.s35', "الصنف / الوصف")}</th>
              <th style={{ width: '110px', textAlign: 'center' }}>{t('sales.create_quotation_page.s36', "الوحدة")}</th>
              <th style={{ width: '100px', textAlign: 'center' }}>{t('sales.create_quotation_page.s37', "الكمية")}</th>
              <th style={{ width: '120px', textAlign: 'center' }}>{t('sales.create_quotation_page.s38', "سعر الوحدة")}</th>
              <th style={{ width: '100px', textAlign: 'center' }}>{t('sales.create_quotation_page.s39', "الخصم")}</th>
              <th style={{ width: '90px', textAlign: 'center' }}>{t('sales.create_quotation_page.s40', "الضريبة %")}</th>
              <th style={{ width: '130px', textAlign: 'center' }}>{t('sales.create_quotation_page.s41', "الإجمالي")}</th>
              <th style={{ width: '50px', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id}>
                <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px' }}>{idx + 1}</td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <SearchableCombobox
                      inline
                      className="purchase-prototype-inline-combobox"
                      inputClassName="purchase-prototype-field-input purchase-prototype-combobox-input purchase-prototype-combobox-input-inline"
                      placeholder={t('sales.create_quotation_page.s42', "ابحث عن صنف بالاسم أو الباركود...")}
                      value={item.productName || item.product_name || ''}
                      onChange={(value) => {
                        handleUpdateItem(item.id, { productName: value, product_name: value });
                        schedulePickerAvailabilityRefresh(value);
                      }}
                      options={productOptions}
                      getLabel={(p) => p.name}
                      getMeta={(p) => {
                        // INV-QUOTATION-RESERVED-STOCK-DISPLAY: the
                        // suggestion shows ONLY the reserved-aware
                        // availability. The catalog stock (p.stock)
                        // ignores reservations — it showed
                        // "رصيد: 10" for a product whose 10 units
                        // were already reserved. Unknown until the
                        // read returns: no stock segment at all,
                        // never a number from another source.
                        const avail = availabilityByProduct[p.rawId];
                        return [p.barcode, p.price > 0 ? `${formatCurrency(p.price)}` : undefined, avail === undefined ? undefined : `رصيد: ${avail}`].filter(Boolean).join(' · ');
                      }}
                      search={(p, query) =>
                        matchesArabic(p.name, query) ||
                        (p.barcode ? p.barcode.includes(query) : false) ||
                        (p.sku ? p.sku.toLowerCase().includes(query.toLowerCase()) : false)
                      }
                      onSelect={(option) => handleProductSelect(item.id, option)}
                      onOpenChange={(open) => {
                        if (open) schedulePickerAvailabilityRefresh(item.productName ?? '');
                      }}
                      showDropdownOnEmpty={true}
                      maxResults={20}
                      emptyLabel={t('sales.create_quotation_page.s43', "صنف جديد (يمكنك المتابعة بالاسم المدخل)")}
                    />
                    <input
                      type="text"
                      placeholder={t('sales.create_quotation_page.s44', "أو اكتب وصف البند / الصنف يدوياً...")}
                      value={item.productName || item.product_name || ''}
                      onChange={(e) => handleUpdateItem(item.id, { productName: e.target.value })}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        background: '#f8fafc',
                      }}
                    />
                  </div>
                </td>
                <td>
                  <CustomSelect
                    value={item.unitName || t('sales.create_quotation_page.s45', "قطعة")}
                    onChange={(val) => handleUpdateItem(item.id, { unitName: val })}
                    options={[
                      { value: t('sales.create_quotation_page.s46', "قطعة"), label: t('sales.create_quotation_page.s47', "قطعة") },
                      { value: t('sales.create_quotation_page.s48', "كرتونة"), label: t('sales.create_quotation_page.s49', "كرتونة") },
                      { value: t('sales.create_quotation_page.s50', "كيلو"), label: t('sales.create_quotation_page.s51', "كيلو") },
                      { value: t('sales.create_quotation_page.s52', "متر"), label: t('sales.create_quotation_page.s53', "متر") },
                      { value: t('sales.create_quotation_page.s54', "خدمة"), label: t('sales.create_quotation_page.s55', "خدمة") },
                      { value: t('sales.create_quotation_page.s56', "طقم"), label: t('sales.create_quotation_page.s57', "طقم") },
                    ]}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => handleUpdateItem(item.id, { quantity: Number(e.target.value) || 1 })}
                    onFocus={(e) => e.target.select()}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      textAlign: 'center',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice ?? item.unit_price ?? 0}
                    onChange={(e) => handleUpdateItem(item.id, { unitPrice: Number(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      textAlign: 'center',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount || 0}
                    onChange={(e) => handleUpdateItem(item.id, { discount: Number(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      textAlign: 'center',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={item.tax_rate || 0}
                    onChange={(e) => handleUpdateItem(item.id, { tax_rate: Number(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      textAlign: 'center',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: '#170e5e', fontSize: '13px' }}>
                  {formatCurrency(item.total || 0)}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    disabled={items.length <= 1}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: items.length <= 1 ? 'not-allowed' : 'pointer',
                      color: items.length <= 1 ? '#cbd5e1' : '#ef4444',
                      padding: '4px',
                    }}
                    title={t('sales.create_quotation_page.s58', "حذف البند")}
                  >
                    <Trash2Icon size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Bottom Dashed Actions */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            padding: '12px',
            background: '#f8fafc',
            borderTop: '1px dashed #cbd5e1',
          }}
        >
          <button
            type="button"
            onClick={() => handleAddItem('product')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px dashed #94a3b8',
              background: '#ffffff',
              color: '#170e5e',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlusIcon size={14} />
            {t('sales.create_quotation_page.s59', "+ إضافة بند صنف جديد")}
          </button>
          <button
            type="button"
            onClick={() => handleAddItem('service')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px dashed #94a3b8',
              background: '#ffffff',
              color: '#475569',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlusIcon size={14} />
            {t('sales.create_quotation_page.s60', "+ إضافة بند خدمة")}
          </button>
        </div>
      </div>
    </section>
    </>
  );
}
