import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { formatDate } from '@/lib/format';
import { SaasTenantRow } from '../api/saas-admin.api';
import { resolveFrontendPlanDisplayName } from '@/shared/verticals/plan-tiers';

interface TenantWelcomeShareModalProps {
  tenant: SaasTenantRow;
  temporaryPassword?: string;
  username?: string;
  onClose: () => void;
}

export function TenantWelcomeShareModal({
  tenant,
  temporaryPassword,
  username,
  onClose,
}: TenantWelcomeShareModalProps) {
  const { t: __t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.zsystemai.com';
  const loginUrl = `${originUrl}/login?tenant=${tenant.slug}`;

  const resolvedUsername = (username || tenant.ownerUsername || '').trim() || 'admin';

  const resolvePlanName = (t: SaasTenantRow): string => {
    if (t.planName && t.planName !== 'الافتراضية') return t.planName;
    if (t.planId === 'plan_omnichannel') return 'باقة التجارة الشاملة';
    if (t.planId === 'plan_starter' || t.planId === 'plan_basic') return 'الأساسية';
    if (t.planId === 'plan_pro') return 'المتقدمة';
    if (t.planId === 'plan_ultimate' || !t.planId) return 'المتكاملة';
    return resolveFrontendPlanDisplayName(t.planId) || 'المتقدمة';
  };
  const planDisplayName = resolvePlanName(tenant);

  const isTrial = tenant.status !== 'active';
  const expiryDate = isTrial 
    ? (tenant.trialEndsAt || tenant.subscriptionEndDate) 
    : (tenant.subscriptionEndDate || tenant.trialEndsAt);
  const remainingDays = tenant.trialDaysRemaining ?? (isTrial ? 14 : undefined);

  const messageText = `مرحباً بك في منظومة Z-Systems السحابية لإدارة الأعمال

يسعدنا انضمام نشاطكم الموقر:
*${tenant.businessName || tenant.slug}*

بيانات الدخول لحسابكم:
- رابط تسجيل الدخول المباشر:
${loginUrl}

- المعرف السحابي (Slug): *${tenant.slug}*
- اسم المستخدم: *${resolvedUsername}*
${temporaryPassword ? `- كلمة المرور المؤقتة: *${temporaryPassword}*` : `- كلمة المرور: تم تعيينها لحسابكم`}

تفاصيل الاشتراك:
- الباقة: *${planDisplayName}*
- حالة النسخة: *${isTrial ? 'نسخة تجريبية' : 'نسخة مفعلة (اشتراك رسمي)'}*
${expiryDate ? `- ${isTrial ? 'تاريخ انتهاء التجربة' : 'تاريخ انتهاء الاشتراك'}: *${formatDate(expiryDate)}*` : ''}
${isTrial && remainingDays !== undefined ? `- الأيام المتبقية في التجربة: *${remainingDays} يوم*` : ''}

لأي استفسارات أو دعم فني، يسعدنا تواصلكم معنا دائماً:
- الدعم الفني: *Z-Systems*
- هاتف / واتساب: *01018017523*`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleOpenWhatsApp = () => {
    const phone = (tenant.ownerPhone || '').replace(/\D/g, '');
    const cleanPhone = phone.startsWith('0') ? `20${phone.slice(1)}` : phone;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
    window.open(url, '_blank');
  };

  return (
    <DialogShell
      open={true}
      onClose={onClose}
      width="640px"
      ariaLabel={__t('saas_admin.tenant_welcome_share_modal.s0', "مشاركة بيانات الاشتراك والترحيب")}
    >
      <div className="dialog-card" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              {__t('saas_admin.tenant_welcome_share_modal.s1', "مشاركة بيانات الاشتراك والدخول للعميل")}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {__t('saas_admin.tenant_welcome_share_modal.s2', "إرسال رسالة ترحيب وبيانات الدخول للعميل مباشرة عبر واتساب أو نسخها.")}
            </p>
          </div>
        </div>

        <div style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
          padding: '14px',
          maxHeight: '280px',
          overflowY: 'auto',
          fontSize: '12.5px',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.7',
          color: '#1e293b',
          fontFamily: 'inherit',
        }}>
          {messageText}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            className="btn-whatsapp-share button"
            onClick={handleOpenWhatsApp}
            style={{
              flex: 1,
              background: '#059669',
              color: '#ffffff',
              border: 'none',
              fontWeight: 800,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#047857')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#059669')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
            </svg>
            <span>{__t('saas_admin.tenant_welcome_share_modal.s3', "إرسال عبر واتساب للمالك")}</span>
          </button>

          <Button
            variant="secondary"
            onClick={handleCopy}
            style={{
              padding: '10px 16px',
              fontWeight: 700,
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {copied ? (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span style={{ color: '#16a34a' }}>{__t('saas_admin.tenant_welcome_share_modal.s4', "تم النسخ بنجاح")}</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span>{__t('saas_admin.tenant_welcome_share_modal.s5', "نسخ نص الرسالة")}</span>
              </>
            )}
          </Button>

          <Button variant="secondary" onClick={onClose} style={{ padding: '10px 16px' }}>
            {__t('saas_admin.tenant_welcome_share_modal.s6', "إغلاق")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
