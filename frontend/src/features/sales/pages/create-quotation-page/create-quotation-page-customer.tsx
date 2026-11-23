import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { UsersIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { Customer } from '@/types/domain';

export interface CreateQuotationPageCustomerProps {
  t: ReturnType<typeof useTranslation>['t'];
  selectedCustomerId: string | null;
  handleCustomerSelect: (customerIdStr: string) => void;
  customers: Customer[];
  customerName: string;
  setCustomerName: React.Dispatch<React.SetStateAction<string>>;
  setSelectedCustomerId: React.Dispatch<React.SetStateAction<string | null>>;
  customerPhone: string;
  setCustomerPhone: React.Dispatch<React.SetStateAction<string>>;
  customerAddress: string;
  setCustomerAddress: React.Dispatch<React.SetStateAction<string>>;
  quotationDate: string;
  setQuotationDate: React.Dispatch<React.SetStateAction<string>>;
  validUntil: string;
  setValidUntil: React.Dispatch<React.SetStateAction<string>>;
  currency: string;
  setCurrency: React.Dispatch<React.SetStateAction<string>>;
}

export function CreateQuotationPageCustomer(props: CreateQuotationPageCustomerProps) {
  const { t, selectedCustomerId, handleCustomerSelect, customers, customerName, setCustomerName, setSelectedCustomerId, customerPhone, setCustomerPhone, customerAddress, setCustomerAddress, quotationDate, setQuotationDate, validUntil, setValidUntil, currency, setCurrency } = props;
  return (
    <>
    {/* Section 1: Customer & Quotation Info */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <div className="document-prototype-section-title">
        <UsersIcon size={16} color="#170e5e" />
        <span>{t('sales.create_quotation_page.s10', "بيانات العميل وفترة الصلاحية")}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
        <Field label={t('sales.create_quotation_page.s11', "اسم العميل *")}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <CustomSelect
                value={selectedCustomerId ? String(selectedCustomerId) : ''}
                onChange={(val) => handleCustomerSelect(val)}
                options={[
                  { value: '', label: t('sales.create_quotation_page.s12', "عميل نقدي / اختيار من القائمة...") },
                  ...customers.map((c: any) => ({
                    value: String(c.id),
                    label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
                    hint: c.taxNumber || c.code,
                  })),
                ]}
                placeholder={t('sales.create_quotation_page.s13', "اختر عميل مسجل...")}
              />
            </div>
            <input
              type="text"
              placeholder={t('sales.create_quotation_page.s14', "أو اكتب اسم العميل مباشرة")}
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                if (selectedCustomerId) setSelectedCustomerId(null);
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
              }}
            />
          </div>
        </Field>

        <Field label={t('sales.create_quotation_page.s15', "رقم هاتف العميل")}>
          <input
            type="tel"
            placeholder="010XXXXXXXX"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
            }}
          />
        </Field>

        <Field label={t('sales.create_quotation_page.s16', "عنوان العميل")}>
          <input
            type="text"
            placeholder={t('sales.create_quotation_page.s17', "المدينة، الحي، اسم الشارع...")}
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
            }}
          />
        </Field>

        <Field label={t('sales.create_quotation_page.s18', "تاريخ عرض السعر")}>
          <input
            type="date"
            value={quotationDate}
            onChange={(e) => setQuotationDate(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
            }}
          />
        </Field>

        <Field label={t('sales.create_quotation_page.s19', "ساري حتى تاريخ (Validity Period)")}>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
            }}
          />
        </Field>

        <Field label={t('sales.create_quotation_page.s20', "العملة")}>
          <CustomSelect
            value={currency}
            onChange={(val) => setCurrency(val)}
            options={[
              { value: 'EGP', label: t('sales.create_quotation_page.s21', "جنيه مصري (EGP)") },
              { value: 'SAR', label: t('sales.create_quotation_page.s22', "ريال سعودي (SAR)") },
              { value: 'AED', label: t('sales.create_quotation_page.s23', "درهم إماراتي (AED)") },
              { value: 'USD', label: t('sales.create_quotation_page.s24', "دولار أمريكي (USD)") },
              { value: 'EUR', label: t('sales.create_quotation_page.s25', "يورو أوروبي (EUR)") },
            ]}
          />
        </Field>
      </div>
    </section>
    </>
  );
}
