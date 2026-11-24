import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface CreateSalesOrderPageTermsProps {
  t: ReturnType<typeof useTranslation>['t'];
  termsConditions: string;
  setTermsConditions: Dispatch<SetStateAction<string>>;
}
export function CreateSalesOrderPageTerms({ t, termsConditions, setTermsConditions }: CreateSalesOrderPageTermsProps) {
  return (
    <>
    {/* Section 4: Terms & Conditions */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s70', "الشروط والأحكام")}</h3>
      <textarea
        className="purchase-prototype-notes-textarea"
        rows={3}
        value={termsConditions}
        onChange={(e) => setTermsConditions(e.target.value)}
        placeholder={t('sales.create_sales_order_page.s71', "الشروط والأحكام الخاصة بحجز البضاعة وسداد القيمة...")}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </section>
    </>
  );
}
