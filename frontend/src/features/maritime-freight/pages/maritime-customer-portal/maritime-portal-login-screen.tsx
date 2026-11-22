import { useTranslation } from 'react-i18next';
import { ShipIcon, AlertCircleIcon, ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction, FormEvent } from 'react';

export function MaritimePortalLoginScreen({ loginError, handleLoginSubmit, loginPhone, setLoginPhone, loginPin, setLoginPin, loginCompany, setLoginCompany, loginLoading }: { loginError: string | null; handleLoginSubmit: (e: FormEvent) => Promise<void>; loginPhone: string; setLoginPhone: Dispatch<SetStateAction<string>>; loginPin: string; setLoginPin: Dispatch<SetStateAction<string>>; loginCompany: string; setLoginCompany: Dispatch<SetStateAction<string>>; loginLoading: boolean }) {
  const { t } = useTranslation();
  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)', padding: '28px 24px' }}>
        {/* Logo & Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '54px', height: '54px', borderRadius: '14px', background: '#170e5e', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
            <ShipIcon size={30} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: '19px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{t('maritime_freight.maritime_customer_portal_page.s2', "بوابة الخدمة الذاتية لعملاء الشحن")}</h1>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
            {t('maritime_freight.maritime_customer_portal_page.s3', "متابعة الشحنات والأحداث التقديرية المجدولة، طلبات التسعير، واعتماد العروض والمستندات إلكترونياً")}
          </p>
        </div>

        {loginError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#991b1b', fontSize: '12.5px' }}>
            <AlertCircleIcon size={16} color="#991b1b" />
            <span>{loginError}</span>
          </div>
        )}

        <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s4', "رقم الهاتف المسجل لدى الشحن")} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="tel"
              value={loginPhone}
              onChange={(e) => setLoginPhone(e.target.value)}
              placeholder={t('maritime_freight.maritime_customer_portal_page.s5', "مثال: 01012345678")}
              dir="ltr"
              required
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s6', "رمز الدخول السري (PIN)")} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="password"
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value)}
              placeholder={t('maritime_freight.maritime_customer_portal_page.s7', "الرمز السري الخاص بك")}
              dir="ltr"
              required
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s8', "كود المنشأة / الشركة (اختياري)")}
            </label>
            <input
              type="text"
              value={loginCompany}
              onChange={(e) => setLoginCompany(e.target.value)}
              placeholder={t('maritime_freight.maritime_customer_portal_page.s9', "اتركه فارغاً إن كنت مسجلاً لدى شركة واحدة")}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <button
            type="submit"
            disabled={loginLoading}
            style={{
              marginTop: '8px',
              padding: '12px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: loginLoading ? 'not-allowed' : 'pointer',
              opacity: loginLoading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {loginLoading ? t('maritime_freight.maritime_customer_portal_page.s10', "جاري التحقق...") : t('maritime_freight.maritime_customer_portal_page.s11', "دخول البوابة")}
            {!loginLoading && <ArrowRightIcon size={16} color="#fff" />}
          </button>
        </form>

        {/* Quick Help Card */}
        <div style={{ marginTop: '20px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('maritime_freight.maritime_customer_portal_page.s12', "عميل جديد أو نسيت الرمز السري؟")}</div>
          {t('maritime_freight.maritime_customer_portal_page.s13', "تواصل مباشرة مع مدير الحساب أو قسم العمليات اللوجستية للحصول على رمز PIN خاص أو رابط الدخول المباشر لشحناتك.")}
        </div>
      </div>
    </div>
  );
}
