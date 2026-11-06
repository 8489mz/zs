/*
New file: frontend/src/features/hr/components/portal/EmployeePinChangeScreen.tsx
INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE: the screen an employee is forced onto
while their PIN is still the public default. It is the only portal screen
shown before the dashboard in that state, and the change-PIN endpoint is
the only portal call allowed until the PIN changes. The default value is
never displayed or named here.
*/

import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { employeePortalApi, type PortalEmployeeUser } from '../../api/employee-portal.api';
import { AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

export interface EmployeePinChangeScreenProps {
  user: PortalEmployeeUser | null;
  onChanged: (token: string, user: PortalEmployeeUser) => void;
  onLogout: () => void;
}

export function EmployeePinChangeScreen({ user, onChanged, onLogout }: EmployeePinChangeScreenProps) {
  const { t: __t } = useTranslation();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!currentPin.trim() || !newPin.trim() || !confirmPin.trim()) {
      setError('يرجى إدخال الرمز الحالي والرمز الجديد وتأكيده');
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setError('الرمز الجديد وتأكيده غير متطابقين');
      return;
    }
    if (newPin.trim().length < 4) {
      setError('الرمز الجديد يجب أن يكون 4 أحرف على الأقل');
      return;
    }
    if (newPin.trim() === '0000' || newPin.trim() === '1234') {
      setError('الرمز الجديد ضعيف: اختر رمزاً آخر');
      return;
    }
    if (newPin.trim() === currentPin.trim()) {
      setError('الرمز الجديد يجب أن يختلف عن الرمز الحالي');
      return;
    }

    try {
      setLoading(true);
      const res = await employeePortalApi.changePin({
        currentPin: currentPin.trim(),
        newPin: newPin.trim(),
      });
      onChanged(res.token, res.employee);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'تعذر تغيير الرمز، تأكد من الرمز الحالي وحاول مرة أخرى');
    } finally {
      setLoading(false);
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
      <div className="portal-login-card" style={{ maxWidth: '440px', width: '100%', backgroundColor: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '36px 32px', boxShadow: '0 8px 30px -4px rgba(15, 23, 42, 0.08)', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#0f172a' }}>
            {__t('hr.portal.employee_pin_change_screen.s0', "تغيير رمز الدخول")}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b', fontWeight: 600, lineHeight: 1.6 }}>
            {__t('hr.portal.employee_pin_change_screen.s1', "رمز الدخول الحالي هو الرمز الافتراضي، ويجب تغييره قبل المتابعة إلى لوحة الموظف.")}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            {user ? `${user.name} • ${user.employeeNo}` : ''}
          </p>
        </div>

        {error && (
          <div
            role="alert"
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
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('hr.portal.employee_pin_change_screen.s2', "الرمز الحالي:")}
            </label>
            <input
              type="password"
              maxLength={64}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              placeholder={__t('hr.portal.employee_pin_change_screen.s3', "أدخل الرمز الحالي")}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '16px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('hr.portal.employee_pin_change_screen.s4', "الرمز الجديد:")}
            </label>
            <input
              type="password"
              maxLength={64}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={__t('hr.portal.employee_pin_change_screen.s5', "4 أحرف على الأقل")}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '16px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('hr.portal.employee_pin_change_screen.s6', "تأكيد الرمز الجديد:")}
            </label>
            <input
              type="password"
              maxLength={64}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder={__t('hr.portal.employee_pin_change_screen.s7', "أعد إدخال الرمز الجديد")}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '16px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '8px',
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              fontSize: '15px',
              fontWeight: 800,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(23, 14, 94, 0.25)',
            }}
          >
            {loading ? __t('hr.portal.employee_pin_change_screen.s8', "جاري الحفظ...") : __t('hr.portal.employee_pin_change_screen.s9', "حفظ الرمز الجديد والمتابعة")}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={onLogout}
            style={{ background: 'none', border: 'none', fontSize: '13px', fontWeight: 700, color: '#dc2626', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {__t('hr.portal.employee_pin_change_screen.s10', "تسجيل الخروج")}
          </button>
        </div>
      </div>
    </div>
  );
}
