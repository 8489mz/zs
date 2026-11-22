import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { ActiveTab } from './maritime-portal-types';

export type QuoteForm = {
  transportMode: 'sea' | 'air' | 'road';
  direction: 'import' | 'export' | 'cross_trade';
  polCode: string;
  polName: string;
  podCode: string;
  podName: string;
  cargoMode: string;
  containerType: string;
  containerCount: number;
  commodityDescription: string;
  grossWeightKg: number;
  totalCbm: number;
  incoterm: string;
  cargoReadyDate: string;
  notes: string;
};

export function MaritimePortalQuoteTab({ submittedQuoteResult, setSubmittedQuoteResult, setActiveTab, handleQuoteSubmit, setQuoteForm, quoteForm, submittingQuote }: { submittedQuoteResult: { inquiryNumber: string } | null; setSubmittedQuoteResult: Dispatch<SetStateAction<{ inquiryNumber: string } | null>>; setActiveTab: Dispatch<SetStateAction<ActiveTab>>; handleQuoteSubmit: (e: FormEvent) => Promise<void>; setQuoteForm: Dispatch<SetStateAction<QuoteForm>>; quoteForm: QuoteForm; submittingQuote: boolean }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          {t('maritime_freight.maritime_customer_portal_page.s67', "طلب تسعير شحنة جديدة إلكترونياً (Request Freight Quote)")}
        </h2>
        <p style={{ fontSize: '12.5px', color: '#64748b', margin: 0 }}>
          {t('maritime_freight.maritime_customer_portal_page.s68', "أدخل مواصفات شحنتك وموانئ التحميل والوصول، وسيقوم فريق التسعير بإعداد عرض سعر رسمي متكامل وموافاتكم به")}
        </p>
      </div>

      {submittedQuoteResult ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#22c55e', color: '#fff', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircleIcon size={28} color="#fff" />
          </div>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#166534', margin: '0 0 6px' }}>{t('maritime_freight.maritime_customer_portal_page.s69', "تم استلام طلب التسعير بنجاح!")}</h3>
          <div style={{ fontSize: '13px', color: '#166534', marginBottom: '12px' }}>
            {t('maritime_freight.maritime_customer_portal_page.s70', "كود الطلب المرجعي:")} <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '15px' }}>{submittedQuoteResult.inquiryNumber}</span>
          </div>
          <p style={{ fontSize: '12px', color: '#15803d', maxWidth: '480px', margin: '0 auto 18px' }}>
            {t('maritime_freight.maritime_customer_portal_page.s71', "تم تحويل الطلب لفريق العمليات والتسعير، وستظهر عروض الأسعار المقترحة فور اعتمادها في تبويب \"عروض الأسعار والتعميد\".")}
          </p>
          <button
            onClick={() => {
              setSubmittedQuoteResult(null);
              setActiveTab('quotes');
            }}
            style={{
              padding: '8px 18px',
              background: '#166534',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('maritime_freight.maritime_customer_portal_page.s72', "الانتقال لعروض الأسعار")}
          </button>
        </div>
      ) : (
        <form onSubmit={handleQuoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Transport Mode & Direction */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s73', "وسيلة الشحن")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { id: 'sea', label: t('maritime_freight.maritime_customer_portal_page.s74', "بحري (Sea Freight)") },
                  { id: 'air', label: t('maritime_freight.maritime_customer_portal_page.s75', "جوي (Air Freight)") },
                  { id: 'road', label: t('maritime_freight.maritime_customer_portal_page.s76', "بري (Trucking)") },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setQuoteForm({ ...quoteForm, transportMode: m.id as any })}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: quoteForm.transportMode === m.id ? '#170e5e' : '#cbd5e1',
                      background: quoteForm.transportMode === m.id ? '#170e5e' : '#ffffff',
                      color: quoteForm.transportMode === m.id ? '#ffffff' : '#334155',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s77', "مسار الشحنة")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { id: 'import', label: t('maritime_freight.maritime_customer_portal_page.s78', "استيراد") },
                  { id: 'export', label: t('maritime_freight.maritime_customer_portal_page.s79', "تصدير") },
                  { id: 'cross_trade', label: t('maritime_freight.maritime_customer_portal_page.s80', "ترانزيت") },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setQuoteForm({ ...quoteForm, direction: d.id as any })}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: quoteForm.direction === d.id ? '#170e5e' : '#cbd5e1',
                      background: quoteForm.direction === d.id ? '#170e5e' : '#ffffff',
                      color: quoteForm.direction === d.id ? '#ffffff' : '#334155',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Ports (POL & POD) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s81', "ميناء التحميل / بلد المنشأ (POL)")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={quoteForm.polName}
                onChange={(e) => setQuoteForm({ ...quoteForm, polName: e.target.value })}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s82', "مثال: شنغهاي / نينغبو / جبل علي / هامبورغ")}
                required
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s83', "ميناء الوصول / جهة التفريغ (POD)")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={quoteForm.podName}
                onChange={(e) => setQuoteForm({ ...quoteForm, podName: e.target.value })}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s84', "مثال: الإسكندرية / دمياط / السخنة / مطار القاهرة")}
                required
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Container Type & RTL Stepper standard ([+] right, [-] left) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s85', "نوع الحاوية / الشحن")}
              </label>
              <select
                value={quoteForm.containerType}
                onChange={(e) => setQuoteForm({ ...quoteForm, containerType: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
              >
                <option value="40HC">40' High Cube (40HC)</option>
                <option value="20GP">20' General Purpose (20GP)</option>
                <option value="40GP">40' Standard Box (40GP)</option>
                <option value="40RF">{t('maritime_freight.maritime_customer_portal_page.s86', "40' Reefer مبرد (40RF)")}</option>
                <option value="LCL">{t('maritime_freight.maritime_customer_portal_page.s87', "شحنة جزئية (LCL - Groupage)")}</option>
              </select>
            </div>

            {/* Quantity Stepper: (+) on right, (-) on left */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s88', "عدد الحاويات")}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setQuoteForm({ ...quoteForm, containerCount: quoteForm.containerCount + 1 })}
                  style={{ width: '38px', height: '38px', background: '#f1f5f9', border: 'none', borderLeft: '1px solid #cbd5e1', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}
                >
                  +
                </button>
                <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                  {quoteForm.containerCount}
                </div>
                <button
                  type="button"
                  onClick={() => setQuoteForm({ ...quoteForm, containerCount: Math.max(1, quoteForm.containerCount - 1) })}
                  style={{ width: '38px', height: '38px', background: '#f1f5f9', border: 'none', borderRight: '1px solid #cbd5e1', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}
                >
                  -
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s89', "الشرط التجاري (Incoterm)")}
              </label>
              <select
                value={quoteForm.incoterm}
                onChange={(e) => setQuoteForm({ ...quoteForm, incoterm: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
              >
                <option value="FOB">FOB - Free on Board</option>
                <option value="CIF">CIF - Cost, Insurance, Freight</option>
                <option value="CFR">CFR - Cost and Freight</option>
                <option value="EXW">{t('maritime_freight.maritime_customer_portal_page.s90', "EXW - Ex Works (من المصنع)")}</option>
                <option value="DAP">DAP - Delivered at Place</option>
              </select>
            </div>
          </div>

          {/* Commodity & Weight */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s91', "بيان البضاعة ونوعها")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={quoteForm.commodityDescription}
                onChange={(e) => setQuoteForm({ ...quoteForm, commodityDescription: e.target.value })}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s92', "مثال: قطع غيار سيارات، أقمشة ومنسوجات، ألواح شمسية...")}
                required
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s93', "الوزن الإجمالي (كجم)")}
              </label>
              <input
                type="number"
                value={quoteForm.grossWeightKg}
                onChange={(e) => setQuoteForm({ ...quoteForm, grossWeightKg: Number(e.target.value) })}
                dir="ltr"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s94', "الحجم (CBM)")}
              </label>
              <input
                type="number"
                value={quoteForm.totalCbm}
                onChange={(e) => setQuoteForm({ ...quoteForm, totalCbm: Number(e.target.value) })}
                dir="ltr"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Notes & Special Requests */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s95', "متطلبات خاصة أو ملاحظات (تخليص جمركي، نقل حتى الباب، بضائع خطرة)")}
            </label>
            <textarea
              rows={3}
              value={quoteForm.notes}
              onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
              placeholder={t('maritime_freight.maritime_customer_portal_page.s96', "أدخل أي مواصفات أو متطلبات خاصة لتضمينها في العرض...")}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submittingQuote}
            style={{
              padding: '12px 24px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: submittingQuote ? 'not-allowed' : 'pointer',
              opacity: submittingQuote ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '8px',
            }}
          >
            {submittingQuote ? t('maritime_freight.maritime_customer_portal_page.s97', "جاري إرسال الطلب...") : t('maritime_freight.maritime_customer_portal_page.s98', "إرسال طلب التسعير الرسمي")}
            {!submittingQuote && <ArrowRightIcon size={16} color="#fff" />}
          </button>
        </form>
      )}
    </div>
  );
}
