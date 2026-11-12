/*
New file: frontend/src/features/delivery-reps/components/DriverPinChangeScreen.tsx
INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: the screen a driver is forced onto
while their PIN is still the public default. It is the only portal screen
shown before the orders list in that state, and the change-PIN endpoint
is the only portal call made until the PIN changes. The default value is
never displayed or named here.
*/

import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { driverPortalApi, type DriverPortalUser } from '../api/delivery-reps.api';

export interface DriverPinChangeScreenProps {
  user: DriverPortalUser | null;
  onChanged: (token: string, user: DriverPortalUser) => void;
  onLogout: () => void;
}

export function DriverPinChangeScreen({ user, onChanged, onLogout }: DriverPinChangeScreenProps) {
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
    if (newPin.trim() === currentPin.trim()) {
      setError('الرمز الجديد يجب أن يختلف عن الرمز الحالي');
      return;
    }

    try {
      setLoading(true);
      const res = await driverPortalApi.changePin({
        currentPin: currentPin.trim(),
        newPin: newPin.trim(),
      });
      onChanged(res.token, res.rep);
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
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        boxSizing: 'border-box',
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
          boxSizing: 'border-box',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0f172a' }}>
            {__t('delivery_reps.driver_pin_change_screen.s0', __t('delivery_reps.driver_pin_change_screen.s0', "تغيير رمز الدخول"))}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
            {__t('delivery_reps.driver_pin_change_screen.s1', __t('delivery_reps.driver_pin_change_screen.s1', "رمز الدخول الحالي هو الرمز الافتراضي، ويجب تغييره قبل المتابعة إلى شحناتك"))}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            {user ? `${user.name} • ${user.phone || ''}` : ''}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '16px',
              fontSize: '12.5px',
              color: '#dc2626',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.driver_pin_change_screen.s2', __t('delivery_reps.driver_pin_change_screen.s2', "الرمز الحالي"))}
            </label>
            <input
              type="password"
              maxLength={64}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              placeholder={__t('delivery_reps.driver_pin_change_screen.s3', __t('delivery_reps.driver_pin_change_screen.s3', "أدخل الرمز الحالي"))}
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
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.driver_pin_change_screen.s4', __t('delivery_reps.driver_pin_change_screen.s4', "الرمز الجديد"))}
            </label>
            <input
              type="password"
              maxLength={64}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={__t('delivery_reps.driver_pin_change_screen.s5', __t('delivery_reps.driver_pin_change_screen.s5', "4 أحرف على الأقل"))}
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
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.driver_pin_change_screen.s6', __t('delivery_reps.driver_pin_change_screen.s6', "تأكيد الرمز الجديد"))}
            </label>
            <input
              type="password"
              maxLength={64}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder={__t('delivery_reps.driver_pin_change_screen.s7', __t('delivery_reps.driver_pin_change_screen.s7', "أعد إدخال الرمز الجديد"))}
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
          </div>

          <button
            type="submit"
            disabled={loading}
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
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? __t('delivery_reps.driver_pin_change_screen.s8', __t('delivery_reps.driver_pin_change_screen.s8', "جاري الحفظ...")) : __t('delivery_reps.driver_pin_change_screen.s9', __t('delivery_reps.driver_pin_change_screen.s9', "حفظ الرمز الجديد والمتابعة"))}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={onLogout}
            style={{ background: 'none', border: 'none', fontSize: '13px', fontWeight: 700, color: '#dc2626', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {__t('delivery_reps.driver_pin_change_screen.s10', __t('delivery_reps.driver_pin_change_screen.s10', "تسجيل الخروج"))}
          </button>
        </div>
      </div>
    </div>
  );
}
