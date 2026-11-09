import { useTranslation } from 'react-i18next';
import React from 'react';
import { CheckShieldIcon, UtensilsIcon, CheckIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

export const KdsStandbyState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        maxWidth: '850px',
        margin: '20px auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Standby Command Center Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '36px',
          textAlign: 'center',
          boxShadow: '0 4px 18px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <CheckShieldIcon size={28} color="#170e5e" />
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#f8fafc',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            fontSize: '12px',
            fontWeight: 800,
            padding: '4px 14px',
            borderRadius: '20px',
            marginBottom: '12px',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              display: 'inline-block',
            }}
          />
          <span>{t('pos.kds.kds_standby_state.s0', "جميع محطات المطبخ متصلة وبوضع الجاهزية التامة")}</span>
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 900, color: '#0f172a' }}>
          {t('pos.kds.kds_standby_state.s1', "لا توجد طلبات معلقة بالمطبخ في الوقت الراهن")}
        </h2>
        <p
          style={{
            margin: '0 auto',
            fontSize: '13px',
            color: '#64748b',
            maxWidth: '520px',
            lineHeight: 1.6,
          }}
        >
          {t('pos.kds.kds_standby_state.s2', "بمجرد تأكيد فواتير البيع من الكاشير أو إرسال الزبائن لطلبات الطاولات عبر رمز الـ QR، ستظهر تذاكر الوجبات هنا فورياً بالصوت والصورة لتوزيعها على المحطات.")}
        </p>
      </div>

      {/* Live Stations Monitor Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {[
          { name: t('pos.kds.kds_standby_state.s3', "المطبخ الساخن"), status: t('pos.kds.kds_standby_state.s4', "جاهز ونشط"), icon: <UtensilsIcon size={16} color="#170e5e" /> },
          { name: t('pos.kds.kds_standby_state.s5', "المشويات والشواية"), status: t('pos.kds.kds_standby_state.s6', "جاهز ونشط"), icon: <UtensilsIcon size={16} color="#170e5e" /> },
          { name: t('pos.kds.kds_standby_state.s7', "المشروبات والبار"), status: t('pos.kds.kds_standby_state.s8', "جاهز ونشط"), icon: <UtensilsIcon size={16} color="#170e5e" /> },
          { name: t('pos.kds.kds_standby_state.s9', "المخبوزات والحلويات"), status: t('pos.kds.kds_standby_state.s10', "جاهز ونشط"), icon: <CheckIcon size={16} color="#170e5e" strokeWidth={2.5} /> },
        ].map((st, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 6px rgba(15, 23, 42, 0.02)',
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{st.name}</div>
              <div style={{ fontSize: '11px', color: '#475569', fontWeight: 700, marginTop: '2px' }}>
                {st.status}
              </div>
            </div>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e2e8f0',
              }}
            >
              {st.icon}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


/*
 * INV-REST-KDS-LOUD-FAILURE (R-B6): the loud disconnected state. Rendered
 * instead of the calm standby whenever the tickets query has failed — never
 * beside it, never as a small hint. The 'full' variant is the whole main
 * area when there is nothing to show; the 'banner' variant sits above
 * stale tickets that are still on screen and says they may be out of date.
 * The query already refetches every few seconds, so the retry button is a
 * manual shortcut, not the only recovery path.
 */
export function KdsDisconnectedState({ variant = 'full', onRetry }: { variant?: 'full' | 'banner'; onRetry: () => void }) {
  const { t } = useTranslation();
  const retryLabel = t('pos.kds.kds_disconnected_state.s2', 'إعادة المحاولة الآن');

  if (variant === 'banner') {
    return (
      <div
        style={{
          backgroundColor: '#dc2626',
          color: '#ffffff',
          borderRadius: '12px',
          padding: '12px 18px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          boxShadow: '0 3px 8px rgba(220, 38, 38, 0.25)',
        }}
      >
        <AlertTriangleIcon size={22} color="#ffffff" />
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '14px', fontWeight: 900 }}>
            {t('pos.kds.kds_disconnected_state.s0', 'انقطع الاتصال بخادم المطبخ')}
          </div>
          <div style={{ fontSize: '12px', color: '#fecaca', marginTop: '2px' }}>
            {t('pos.kds.kds_disconnected_state.s3', 'البيانات المعروضة قديمة — قد تكون هناك طلبات جديدة لم تصل بعد.')}
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: '#ffffff',
            color: '#dc2626',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {retryLabel}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '850px',
        margin: '20px auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#fef2f2',
          borderRadius: '16px',
          border: '2px solid #dc2626',
          padding: '36px',
          textAlign: 'center',
          boxShadow: '0 4px 18px rgba(220, 38, 38, 0.12)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#fee2e2',
            border: '1px solid #fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <AlertTriangleIcon size={28} color="#dc2626" />
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#dc2626',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: 800,
            padding: '4px 14px',
            borderRadius: '20px',
            marginBottom: '12px',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              display: 'inline-block',
            }}
          />
          <span>{t('pos.kds.kds_disconnected_state.s0', 'انقطع الاتصال بخادم المطبخ')}</span>
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 900, color: '#991b1b' }}>
          {t('pos.kds.kds_disconnected_state.s1', 'تعذّر الوصول إلى تذاكر المطبخ — لا تظهر طلبات جديدة هنا حتى يعود الاتصال')}
        </h2>
        <p
          style={{
            margin: '0 auto 20px',
            fontSize: '13px',
            color: '#7f1d1d',
            maxWidth: '520px',
            lineHeight: 1.6,
          }}
        >
          {t('pos.kds.kds_disconnected_state.s4', 'تحقق من الشبكة أو من الخادم، أو أعد المحاولة الآن. الطلبات التي أُرسلت أثناء الانقطاع لن تظهر إلا بعد عودة الاتصال.')}
        </p>
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: '#dc2626',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 22px',
            fontSize: '14px',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(220, 38, 38, 0.35)',
          }}
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
};
