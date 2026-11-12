import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { TruckIcon } from '@/shared/components/icons/AppIcons';
import { driverPortalApi, DriverPortalUser } from '../api/delivery-reps.api';

function BuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M8 10h.01" />
      <path d="M16 10h.01" />
      <path d="M8 14h.01" />
      <path d="M16 14h.01" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

interface DriverPortalLoginProps {
  onLoginSuccess: (user: DriverPortalUser, mustChangePin: boolean) => void;
}

export const DriverPortalLogin: React.FC<DriverPortalLoginProps> = ({ onLoginSuccess }) => {
  const { t: __t } = useTranslation();
  const [phoneInput, setPhoneInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [disambiguationTenants, setDisambiguationTenants] = useState<Array<{ id: string; name: string; slug: string }> | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setDisambiguationTenants(null);
    const cleanPhone = phoneInput.trim();
    const cleanPin = pinInput.trim();
    if (!cleanPhone || !cleanPin) {
      setLoginError('يرجى إدخال رقم الهاتف ورمز الـ PIN');
      return;
    }

    setIsLoggingIn(true);
    try {
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const companyCode = urlParams?.get('c') || urlParams?.get('tenant') || (typeof localStorage !== 'undefined' ? localStorage.getItem('zs_driver_last_company_code') : null) || undefined;
      const res = await driverPortalApi.login(cleanPhone, cleanPin, companyCode);
      if (companyCode) {
        localStorage.setItem('zs_driver_last_company_code', companyCode);
      }
      onLoginSuccess(res.rep, res.mustChangePin === true);
    } catch (err: any) {
      const details = err?.details || err?.error?.details || err?.response?.data?.details || err?.response?.data || err;
      const tenants = details?.tenants || details?.error?.tenants || err?.tenants;
      const code = err?.code || details?.code || details?.error?.code || err?.response?.data?.code;

      if ((code === 'MULTIPLE_TENANTS' || code === 'AMBIGUOUS_DRIVER_TENANT') && Array.isArray(tenants) && tenants.length > 0) {
        setDisambiguationTenants(tenants);
        return;
      }
      setLoginError(err.message || 'بيانات الدخول غير صحيحة، تأكد من رقم الهاتف والرمز السري');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSelectTenant = async (tenantId: string) => {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const cleanPhone = phoneInput.trim();
      const cleanPin = pinInput.trim();
      const res = await driverPortalApi.login(cleanPhone, cleanPin, tenantId);
      localStorage.setItem('zs_driver_last_company_code', tenantId);
      setDisambiguationTenants(null);
      onLoginSuccess(res.rep, res.mustChangePin === true);
    } catch (err: any) {
      setLoginError(err.message || 'تعذر تسجيل الدخول للمنشأة المحددة');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div 
      dir="rtl"
      style={{ 
        minHeight: '100vh', 
        background: '#f8fafc', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '20px 16px',
        boxSizing: 'border-box'
      }}
    >
      <div 
        style={{ 
          width: '100%', 
          maxWidth: '420px', 
          background: '#ffffff', 
          borderRadius: '16px', 
          border: '1px solid #e2e8f0', 
          padding: '32px 24px', 
          boxShadow: '0 8px 30px rgba(15, 23, 42, 0.06)',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div 
            style={{ 
              width: '64px', 
              height: '64px', 
              borderRadius: '16px', 
              background: '#eff6ff', 
              border: '1px solid #bfdbfe', 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              marginBottom: '12px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.12)'
            }}
          >
            <TruckIcon size={32} color="#2563eb" />
          </div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0f172a' }}>
            {__t('delivery_reps.driver_portal_login.s0', __t('delivery_reps.driver_portal_login.s0', "بوابة مندوب التوصيل"))}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
            {__t('delivery_reps.driver_portal_login.s1', __t('delivery_reps.driver_portal_login.s1', "أدخل رقم الهاتف والرمز السري (PIN) لمتابعة شحناتك"))}
          </p>
        </div>

        {loginError && (
          <div 
            style={{ 
              background: '#fef2f2', 
              border: '1px solid #fecaca', 
              borderRadius: '8px', 
              padding: '10px 12px', 
              marginBottom: '16px', 
              fontSize: '12.5px', 
              color: '#dc2626',
              fontWeight: 600,
              textAlign: 'center'
            }}
          >
            {loginError}
          </div>
        )}

        <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.driver_portal_login.s2', __t('delivery_reps.driver_portal_login.s2', "رقم هاتف المندوب"))}
            </label>
            <input
              type="text"
              placeholder={__t('delivery_reps.driver_portal_login.s3', __t('delivery_reps.driver_portal_login.s3', "مثال: 01012345678"))}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
                background: '#ffffff',
                direction: 'ltr',
                textAlign: 'right',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.driver_portal_login.s4', __t('delivery_reps.driver_portal_login.s4', "كلمة المرور أو الرمز السري (Password / PIN)"))}
            </label>
            <input
              type="password"
              maxLength={64}
              placeholder={__t('delivery_reps.driver_portal_login.s5', __t('delivery_reps.driver_portal_login.s5', "كلمة المرور أو الرمز السري"))}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '16px',
                boxSizing: 'border-box',
                background: '#ffffff',
                direction: 'ltr',
                textAlign: 'left',
                letterSpacing: '4px',
                outline: 'none',
              }}
            />
            <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              {__t('delivery_reps.driver_portal_login.s6', __t('delivery_reps.driver_portal_login.s6', "* كلمة المرور أو الرمز السري المسجل لك من قبل إدارة الفرع"))}
            </span>
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            style={{
              width: '100%',
              padding: '13px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(23, 14, 94, 0.25)',
              marginTop: '6px',
              opacity: isLoggingIn ? 0.7 : 1,
            }}
          >
            {isLoggingIn ? __t('delivery_reps.driver_portal_login.s7', __t('delivery_reps.driver_portal_login.s7', "جاري التحقق...")) : __t('delivery_reps.driver_portal_login.s8', __t('delivery_reps.driver_portal_login.s8', "تسجيل الدخول واستلام الشحنات"))}
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
          <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
            {__t('delivery_reps.driver_portal_login.s9', __t('delivery_reps.driver_portal_login.s9', "منظومة Z-Systems اللوجستية لإدارة أساطيل الدليفري"))}
          </span>
        </div>

        <div style={{ marginTop: '14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Link
            to="/van-sales"
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#0284c7',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>{__t('delivery_reps.driver_portal_login.s10', __t('delivery_reps.driver_portal_login.s10', "الانتقال لبوابة مبيعات سيارات الفان (فان كاشير) ←"))}</span>
          </Link>
          <Link
            to="/hub"
            style={{
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#170e5e',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>{__t('delivery_reps.driver_portal_login.s11', __t('delivery_reps.driver_portal_login.s11', "← العودة لمركز البوابات"))}</span>
          </Link>
        </div>
      </div>

      {disambiguationTenants && disambiguationTenants.length > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          dir="rtl"
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              width: '100%',
              maxWidth: '460px',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    backgroundColor: '#ede9fe',
                    color: '#170e5e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BuildingIcon />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                    {__t('delivery_reps.driver_portal_login.s12', __t('delivery_reps.driver_portal_login.s12', "اختر المنشأة لبدء التوصيل"))}
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                    {__t('delivery_reps.driver_portal_login.s13', __t('delivery_reps.driver_portal_login.s13', "رقمك مسجل كمندوب لدى أكثر من منشأة"))}
                  </p>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: '#475569', margin: '8px 0 0', lineHeight: 1.5 }}>
                {__t('delivery_reps.driver_portal_login.s14', __t('delivery_reps.driver_portal_login.s14', "يرجى تحديد المنشأة التي ترغب في توصيل طلباتها ومتابعة عهدتها الآن:"))}
              </p>
            </div>

            <div style={{ padding: '16px 24px', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {disambiguationTenants.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={isLoggingIn}
                  onClick={() => handleSelectTenant(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease-in-out',
                    textAlign: 'right',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.borderColor = '#170e5e';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        backgroundColor: '#f1f5f9',
                        color: '#170e5e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <BuildingIcon />
                    </div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{t.name}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{__t('delivery_reps.driver_portal_login.s15', __t('delivery_reps.driver_portal_login.s15', "كود المنشأة:"))} {t.slug || t.id}</div>
                    </div>
                  </div>
                  <div style={{ color: '#94a3b8' }}>
                    <ChevronLeftIcon />
                  </div>
                </button>
              ))}
            </div>

            <div style={{ padding: '12px 24px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={isLoggingIn}
                onClick={() => setDisambiguationTenants(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {__t('delivery_reps.driver_portal_login.s16', __t('delivery_reps.driver_portal_login.s16', "إلغاء"))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
