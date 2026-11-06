import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { employeePortalApi, type PortalEmployeeUser } from '../../api/employee-portal.api';
import {
  UsersIcon,
  AlertTriangleIcon,
  SmartphoneIcon,
} from '@/shared/components/icons/AppIcons';

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



export interface EmployeePortalLoginProps {
  onLoginSuccess: (token: string, user: PortalEmployeeUser, mustChangePin: boolean) => void;
}

export function EmployeePortalLogin({ onLoginSuccess }: EmployeePortalLoginProps) {
  const { t: __t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [disambiguationTenants, setDisambiguationTenants] = useState<Array<{ id: string; name: string; slug: string }> | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    setDisambiguationTenants(null);
    if (!identifier.trim() || !pinCode.trim()) {
      setLoginError('يرجى إدخال رقم الهاتف المحمول ورمز الدخول السري (PIN)');
      return;
    }

    try {
      setLoginLoading(true);
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const companyCode = urlParams?.get('c') || urlParams?.get('tenant') || (typeof localStorage !== 'undefined' ? localStorage.getItem('zs_last_company_code') : null) || undefined;
      const res = await employeePortalApi.login({
        identifier: identifier.trim(),
        pinCode: pinCode.trim(),
        ...(companyCode ? { companyCode } : {}),
      });
      if (companyCode) {
        localStorage.setItem('zs_last_company_code', companyCode);
      }
      onLoginSuccess(res.token, res.employee, res.mustChangePin === true);
    } catch (err: any) {
      const details = err?.details || err?.response?.data?.details || err?.response?.data || err;
      const tenants = details?.tenants || details?.error?.tenants || err?.tenants;
      const code = err?.code || details?.code || err?.response?.data?.code;

      if ((code === 'MULTIPLE_TENANTS' || code === 'AMBIGUOUS_EMPLOYEE_CREDENTIALS') && Array.isArray(tenants) && tenants.length > 0) {
        setDisambiguationTenants(tenants);
        return;
      }
      setLoginError(err?.response?.data?.message || err?.message || 'فشل تسجيل الدخول، تأكد من صحة البيانات');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSelectTenant(tenantId: string) {
    try {
      setLoginLoading(true);
      setLoginError('');
      const res = await employeePortalApi.login({
        identifier: identifier.trim(),
        pinCode: pinCode.trim(),
        companyCode: tenantId,
      });
      localStorage.setItem('zs_last_company_code', tenantId);
      setDisambiguationTenants(null);
      onLoginSuccess(res.token, res.employee, res.mustChangePin === true);
    } catch (err: any) {
      setLoginError(err?.response?.data?.message || err?.message || 'تعذر تسجيل الدخول للمنشأة المحددة');
    } finally {
      setLoginLoading(false);
    }
  }

    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          backgroundColor: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
      >
        <style>{`
          .portal-login-card {
            max-width: 440px;
            width: 100%;
            background-color: #ffffff;
            border-radius: 20px;
            border: 1px solid #e2e8f0;
            padding: 36px 32px;
            box-shadow: 0 8px 30px -4px rgba(15, 23, 42, 0.08);
            box-sizing: border-box;
          }
          @media (max-width: 480px) {
            .portal-login-card {
              padding: 24px 18px;
              border-radius: 16px;
            }
          }
        `}</style>
        <div className="portal-login-card">
          {/* Logo & Brand Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                background: 'linear-gradient(135deg, #170e5e 0%, #2563eb 100%)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 18px rgba(23, 14, 94, 0.25)',
                marginBottom: '16px',
              }}
            >
              <UsersIcon size={30} color="#ffffff" strokeWidth={2} />
            </div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0f172a' }}>
              {__t('hr.portal.employee_portal_login.s0', "بوابة الموظف الذاتية")}
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
              Z-Systems Employee Self-Service (ESS)
            </p>
          </div>

          {loginError && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '10px',
                padding: '12px 16px',
                color: '#991b1b',
                fontSize: '13px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '20px',
              }}
            >
              <AlertTriangleIcon size={16} color="#991b1b" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {__t('hr.portal.employee_portal_login.s1', "رقم الهاتف المحمول:")}
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={__t('hr.portal.employee_portal_login.s2', "مثال: 01012345678")}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {__t('hr.portal.employee_portal_login.s3', "كلمة المرور أو رمز الدخول السري (Password / PIN):")}
              </label>
              <input
                type="password"
                maxLength={64}
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                placeholder={__t('hr.portal.employee_portal_login.s4', "كلمة المرور أو الرمز السري الخاص بك")}
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#f8fafc',
                  fontSize: '16px',

                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                marginTop: '8px',
                padding: '14px',
                borderRadius: '10px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '15px',
                fontWeight: 800,
                cursor: loginLoading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(23, 14, 94, 0.25)',
                transition: 'all 0.15s ease',
              }}
            >
              {loginLoading ? __t('hr.portal.employee_portal_login.s5', "جاري التحقق...") : __t('hr.portal.employee_portal_login.s6', "تسجيل الدخول إلى حسابي")}
            </button>
          </form>

          <div
            style={{
              marginTop: '24px',
              padding: '14px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#64748b',
              lineHeight: 1.6,
              textAlign: 'center',
            }}
          >
            {__t('hr.portal.employee_portal_login.s15', "لأول تسجيل دخول: تواصل مع الموارد البشرية.")}
          </div>

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <a
              href="/punch"
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#170e5e',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <SmartphoneIcon size={16} color="#170e5e" />
              <span>{__t('hr.portal.employee_portal_login.s9', "تسجيل بصمة الحضور بالـ GPS والسيلفي")}</span>
            </a>
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
                      {__t('hr.portal.employee_portal_login.s10', "اختر المنشأة للمتابعة")}
                    </h3>
                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                      {__t('hr.portal.employee_portal_login.s11', "رقم هاتفك مسجل كموظف لدى أكثر من منشأة")}
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: '13px', color: '#475569', margin: '8px 0 0', lineHeight: 1.5 }}>
                  {__t('hr.portal.employee_portal_login.s12', "يرجى تحديد المنشأة التي ترغب في تسجيل الدخول لبوابتها الذاتية:")}
                </p>
              </div>

              <div style={{ padding: '16px 24px', maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {disambiguationTenants.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={loginLoading}
                    onClick={() => handleSelectTenant(t.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#ffffff',
                      cursor: loginLoading ? 'not-allowed' : 'pointer',
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
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{__t('hr.portal.employee_portal_login.s13', "كود المنشأة:")} {t.slug || t.id}</div>
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
                  disabled={loginLoading}
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
                  {__t('hr.portal.employee_portal_login.s14', "إلغاء")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
}
