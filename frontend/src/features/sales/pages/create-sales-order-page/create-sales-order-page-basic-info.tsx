import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import { matchesArabic } from '@/lib/arabic-normalization';
import { useTranslation } from 'react-i18next';
import type { Customer } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';

export interface CreateSalesOrderPageBasicInfoProps {
  t: ReturnType<typeof useTranslation>['t'];
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  attachments: File[];
  customerName: string;
  setCustomerName: Dispatch<SetStateAction<string>>;
  customers: Customer[];
  setSelectedCustomerId: Dispatch<SetStateAction<number | null>>;
  setCustomerPhone: Dispatch<SetStateAction<string>>;
  setCustomerAddress: Dispatch<SetStateAction<string>>;
  customerOptions: { id: string; rawId: number; name: any; phone: any; address: any; code: any; }[];
  customerPhone: string;
  paymentType: 'cash' | 'credit';
  setPaymentType: Dispatch<SetStateAction<'cash' | 'credit'>>;
  orderDate: string;
  setOrderDate: Dispatch<SetStateAction<string>>;
  deliveryDate: string;
  setDeliveryDate: Dispatch<SetStateAction<string>>;
  currency: string;
  setCurrency: Dispatch<SetStateAction<string>>;
}
export function CreateSalesOrderPageBasicInfo({ t, handleFileUpload, attachments, customerName, setCustomerName, customers, setSelectedCustomerId, setCustomerPhone, setCustomerAddress, customerOptions, customerPhone, paymentType, setPaymentType, orderDate, setOrderDate, deliveryDate, setDeliveryDate, currency, setCurrency }: CreateSalesOrderPageBasicInfoProps) {
  return (
    <>
    {/* Section 1: Basic Info */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <div className="section-header-compact-row" style={{ marginBottom: '0.6rem' }}>
        <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s8', "المعلومات الأساسية")}</h3>
        <div className="section-header-actions-group" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <label className="section-header-action-btn purchase-camera-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
            <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} style={{ display: 'none' }} />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>{t('sales.create_sales_order_page.s9', "كاميرا")}</span>
          </label>
          <label className="section-header-action-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0 }}>
            <input type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <path d="M21 12.5 12.8 20.7a5 5 0 0 1-7.1-7.1L14.2 5.1a3.5 3.5 0 0 1 4.9 4.9L9.9 19.2" />
            </svg>
            <span>{t('sales.create_sales_order_page.s10', "إرفاق")}</span>
            {attachments.length > 0 && <span className="nav-pill" style={{ fontSize: '0.65rem', padding: '1px 4px', marginInlineStart: '2px' }}>{attachments.length}</span>}
          </label>
        </div>
      </div>

      <div className="purchase-prototype-form-grid">
        {/* Customer Name */}
        <SearchableCombobox
          label={t('sales.create_sales_order_page.s11', "العميل *")}
          placeholder={t('sales.create_sales_order_page.s12', "ابحث عن عميل بالاسم أو الهاتف...")}
          value={customerName}
          onChange={(value) => {
            setCustomerName(value);
            const found = customers.find((c: any) => c.name === value);
            if (found) {
              setSelectedCustomerId(Number(found.id));
              setCustomerPhone(found.phone || '');
              setCustomerAddress(found.address || '');
            } else {
              setSelectedCustomerId(null);
            }
          }}
          options={customerOptions}
          search={(c, query) => matchesArabic(c.name, query) || (c.phone ? c.phone.includes(query) : false)}
          getLabel={(c) => c.name}
          getMeta={(c) => [c.code, c.phone].filter(Boolean).join(' · ')}
          onSelect={(c) => {
            setSelectedCustomerId(c.rawId);
            setCustomerName(c.name);
            setCustomerPhone(c.phone || '');
            setCustomerAddress(c.address || '');
          }}
          inputClassName="purchase-prototype-field-input"
          emptyLabel={t('sales.create_sales_order_page.s13', "عميل جديد غير مسجل (يمكنك المتابعة بالاسم المدخل)")}
        />

        {/* Customer Phone */}
        <Field label={t('sales.create_sales_order_page.s14', "رقم الهاتف")}>
          <input
            className="purchase-prototype-field-input"
            type="text"
            placeholder={t('sales.create_sales_order_page.s15', "ابحث عن رقم تليفون أو أدخله...")}
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </Field>

        {/* Payment Type */}
        <Field label={t('sales.create_sales_order_page.s16', "طريقة الدفع / المعاملة")}>
          <CustomSelect
            value={paymentType}
            onChange={(val) => setPaymentType(val as 'cash' | 'credit')}
            options={[
              { value: 'credit', label: t('sales.create_sales_order_page.s17', "آجل (حساب المديونية للعميل)") },
              { value: 'cash', label: t('sales.create_sales_order_page.s18', "نقدي (سداد فوري عند الاستلام)") },
            ]}
            placeholder={t('sales.create_sales_order_page.s19', "اختر طريقة الدفع...")}
          />
        </Field>

        {/* Order Date */}
        <Field label={t('sales.create_sales_order_page.s20', "تاريخ أمر البيع")}>
          <input
            className="purchase-prototype-field-input"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </Field>

        {/* Expected Delivery Date */}
        <Field label={t('sales.create_sales_order_page.s21', "تاريخ التسليم المتوقع")}>
          <input
            className="purchase-prototype-field-input"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </Field>

        {/* Currency */}
        <Field label={t('sales.create_sales_order_page.s22', "العملة")}>
          <CustomSelect
            value={currency}
            onChange={(val) => setCurrency(val)}
            options={[
              { value: 'EGP', label: t('sales.create_sales_order_page.s23', "EGP - جنيه مصري") },
              { value: 'USD', label: t('sales.create_sales_order_page.s24', "USD - دولار أمريكي") },
              { value: 'SAR', label: t('sales.create_sales_order_page.s25', "SAR - ريال سعودي") },
              { value: 'AED', label: t('sales.create_sales_order_page.s26', "AED - درهم إماراتي") },
            ]}
            placeholder={t('sales.create_sales_order_page.s27', "اختر العملة...")}
          />
        </Field>
      </div>
    </section>
    </>
  );
}
