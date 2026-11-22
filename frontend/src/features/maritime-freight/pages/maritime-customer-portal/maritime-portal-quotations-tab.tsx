import { useTranslation } from 'react-i18next';
import { FileTextIcon, RefreshCwIcon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export function MaritimePortalQuotationsTab({ loadQuotations, loadingQuotes, quotations, setApprovalModalQuote, approvalModalQuote, approvalPoNumber, setApprovalPoNumber, approvalNotes, setApprovalNotes, handleConfirmApproval, approvingQuoteId }: { loadQuotations: () => Promise<void>; loadingQuotes: boolean; quotations: any[]; setApprovalModalQuote: Dispatch<SetStateAction<any | null>>; approvalModalQuote: any | null; approvalPoNumber: string; setApprovalPoNumber: Dispatch<SetStateAction<string>>; approvalNotes: string; setApprovalNotes: Dispatch<SetStateAction<string>>; handleConfirmApproval: () => Promise<void>; approvingQuoteId: string | null }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
            {t('maritime_freight.maritime_customer_portal_page.s99', "عروض الأسعار والتعميد الإلكتروني (Quotations & Approvals)")}
          </h2>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {t('maritime_freight.maritime_customer_portal_page.s100', "استعراض عروض الأسعار المقدمة واعتماد وتعميد الشحنة فورياً بنقرة زر")}
          </div>
        </div>

        <button
          onClick={loadQuotations}
          style={{ padding: '6px 12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCwIcon size={14} color="#0f172a" />
          <span>{t('maritime_freight.maritime_customer_portal_page.s101', "تحديث العروض")}</span>
        </button>
      </div>

      {loadingQuotes ? (
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b' }}>
          {t('maritime_freight.maritime_customer_portal_page.s102', "جاري تحميل عروض الأسعار...")}
        </div>
      ) : quotations.length === 0 ? (
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <FileTextIcon size={36} color="#94a3b8" />
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginTop: '10px' }}>{t('maritime_freight.maritime_customer_portal_page.s103', "لا توجد عروض أسعار متاحة حالياً")}</div>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s104', "بإمكانكم تقديم طلب تسعير من تبويب \"طلب تسعير جديد\" وسيوافيكم الفريق بعرض فوري")}</div>
        </div>
      ) : (
        quotations.map((q) => {
          const isApproved = q.status === 'approved' || q.status === 'converted_to_job';
          const isSent = q.status === 'sent';
          return (
            <div
              key={q.id}
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                padding: '18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileTextIcon size={18} color="#170e5e" />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{q.quotation_number}</span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: isApproved ? '#dcfce7' : isSent ? '#fef3c7' : '#f1f5f9',
                          color: isApproved ? '#15803d' : isSent ? '#b45309' : '#475569',
                        }}
                      >
                        {isApproved ? t('maritime_freight.maritime_customer_portal_page.s105', "معتمد ومُعمّد") : isSent ? t('maritime_freight.maritime_customer_portal_page.s106', "بانتظار موافقتكم") : q.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s107', "تاريخ العرض:")} {new Date(q.created_at).toLocaleDateString('ar-EG')}
                      {q.valid_until && ` | صالح حتى: ${new Date(q.valid_until).toLocaleDateString('ar-EG')}`}
                    </div>
                  </div>
                </div>

                {/* Total Amount Pill */}
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s108', "إجمالي عرض السعر")}</div>
                  <div style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e' }}>
                    {Number(q.final_total || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{q.currency || 'USD'}</span>
                  </div>
                </div>
              </div>

              {/* Breakdown & Charges if available */}
              {q.charges && q.charges.length > 0 && (
                <div style={{ marginBottom: '14px', background: '#f8fafc', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>{t('maritime_freight.maritime_customer_portal_page.s109', "تفصيل البنود والرسوم:")}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', fontSize: '12px' }}>
                    {q.charges.map((c: any, cIdx: number) => (
                      <div key={cIdx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                        <span style={{ color: '#475569' }}>{c.charge_name}</span>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{Number(c.amount || 0).toLocaleString()} {c.currency || q.currency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer Actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', paddingTop: '6px' }}>
                {isSent && (
                  <button
                    onClick={() => setApprovalModalQuote(q)}
                    style={{
                      padding: '8px 18px',
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <CheckCircleIcon size={16} color="#fff" />
                    <span>{t('maritime_freight.maritime_customer_portal_page.s110', "اعتماد وتعميد العرض (Approve & Book)")}</span>
                  </button>
                )}

                {isApproved && (
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircleIcon size={16} color="#166534" />
                    <span>{t('maritime_freight.maritime_customer_portal_page.s111', "تم اعتماد وتعميد العرض وتحويله لشحنة تشغيلية")}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Approval Modal */}
      {approvalModalQuote && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s112', "تأكيد اعتماد وتعميد عرض السعر")} {approvalModalQuote.quotation_number}
            </h3>
            <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
              {t('maritime_freight.maritime_customer_portal_page.s113', "بالموافقة على هذا العرض، يتم تثبيت أسعار النولون والرسوم وفتح أمر تشغيل شحن رسمي فورياً.")}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s114', "رقم أمر الشراء للعميل (Client PO / Reference Number)")}
                </label>
                <input
                  type="text"
                  value={approvalPoNumber}
                  onChange={(e) => setApprovalPoNumber(e.target.value)}
                  placeholder={t('maritime_freight.maritime_customer_portal_page.s115', "مثال: PO-2026-991")}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s116', "ملاحظات الاعتماد والتسليم")}
                </label>
                <textarea
                  rows={2}
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder={t('maritime_freight.maritime_customer_portal_page.s117', "أي تعليمات خاصة بالاستلام أو المستندات المطلوبة...")}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setApprovalModalQuote(null)}
                style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                {t('maritime_freight.maritime_customer_portal_page.s118', "إلغاء")}
              </button>
              <button
                onClick={handleConfirmApproval}
                disabled={Boolean(approvingQuoteId)}
                style={{
                  padding: '8px 18px',
                  background: '#170e5e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: approvingQuoteId ? 'not-allowed' : 'pointer',
                }}
              >
                {approvingQuoteId ? t('maritime_freight.maritime_customer_portal_page.s119', "جاري الاعتماد...") : t('maritime_freight.maritime_customer_portal_page.s120', "تأكيد الاعتماد والتعميد")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
