import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { http } from '@/lib/http';
import { Button } from '@/shared/ui/button';
import { systemAlert } from '@/shared/components/system-alert';
import { TwoFactorCard } from '@/features/auth/components/TwoFactorCard';
import { passwordMinLengthForRole, passwordMinLengthHint } from '@/config/security';

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const inputControlStyle: React.CSSProperties = {
  width: '100%',
  height: '38px',
  minHeight: '38px',
  padding: '0 12px',
  fontSize: '0.86rem',
  fontWeight: 600,
  color: '#0f172a',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  boxSizing: 'border-box',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#334155',
  marginBottom: '5px',
};

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
};

const roleLabelMap: Record<string, string> = {
  super_admin: 'سوبر أدمن (صلاحيات كاملة)',
  admin: 'مدير نظام (مشرف)',
  cashier: 'كاشير (مستخدم عادي)',
};

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [name, setName] = useState(user?.displayName || '');
  const username = user?.username || '';
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState('');
  const [passwordErrorMsg, setPasswordErrorMsg] = useState('');

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileSuccessMsg('');
    try {
      const res = await http<any>('/api/users/me', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      if (res.user) {
        updateUser(res.user);
      }
      setProfileSuccessMsg('تم تحديث بيانات الحساب بنجاح.');
      setTimeout(() => setProfileSuccessMsg(''), 3000);
    } catch (err: any) {
      systemAlert(err.message || 'حدث خطأ أثناء حفظ البيانات');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrorMsg('');
    setPasswordSuccessMsg('');

    if (!oldPassword.trim() || !newPassword.trim()) {
      setPasswordErrorMsg('يرجى إدخال كلمة المرور الحالية والجديدة.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordErrorMsg('تأكيد كلمة المرور الجديدة غير متطابق.');
      return;
    }

    if (newPassword === oldPassword) {
      setPasswordErrorMsg('كلمة المرور الجديدة يجب أن تختلف عن الحالية.');
      return;
    }

    // Role-aware minimum (12 for admin/super_admin, 8 otherwise): reject
    // here with the number that actually applies, instead of letting the
    // server answer with a different one.
    if (newPassword.trim().length < passwordMinLengthForRole(user?.role)) {
      setPasswordErrorMsg(passwordMinLengthHint(user?.role));
      return;
    }

    setIsSavingPassword(true);
    try {
      await http('/api/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setPasswordSuccessMsg('تم تغيير كلمة المرور بنجاح.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccessMsg(''), 3500);
    } catch (err: any) {
      setPasswordErrorMsg(err.message || 'حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const userInitial = (name || username || 'U')[0].toUpperCase();
  const userRoleDisplay = roleLabelMap[user?.role || ''] || user?.role || 'مستخدم';

  return (
    <div className="page-stack page-shell profile-page" dir="rtl" style={{ maxWidth: '1080px', margin: '0 auto', width: '100%' }}>
      {/* Top Hero Banner */}
      <div style={{
        ...cardStyle,
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            background: '#0f172a',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.4rem',
            fontWeight: 900,
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.15)',
          }}>
            {userInitial}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                {name || username}
              </h2>
              <span style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '12px',
                background: '#ede9fe',
                color: '#6b21a8',
                border: '1px solid #ddd6fe',
              }}>
                {userRoleDisplay}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>{t('auth.profile_page.s0', "اسم الدخول:")} <strong>@{username}</strong></span>
              {tenant?.slug && (
                <>
                  <span>•</span>
                  <span>{t('auth.profile_page.s1', "معرّف النسخة (Slug):")} <strong style={{ color: '#170e5e', fontFamily: 'monospace' }}>{tenant.slug}</strong></span>
                </>
              )}
              <span>•</span>
              <span style={{ color: '#166534', fontWeight: 700 }}>{t('auth.profile_page.s2', "● الحساب نشط ومتصل")}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            fontSize: '0.78rem',
            color: '#475569',
            fontWeight: 700,
          }}>
            <ShieldCheckIcon />
            <span>{t('auth.profile_page.s3', "جلسة دخول مؤمنة ومحمية")}</span>
          </div>
        </div>
      </div>

      {/* 2-Column Responsive Workspace Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', alignItems: 'start' }}>
        {/* Card 1: User Profile Info */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0f172a',
            }}>
              <UserIcon />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                {t('auth.profile_page.s4', "البيانات الشخصية")}
              </h3>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('auth.profile_page.s5', "تعديل الاسم المعروض والبيانات العامة")}</span>
            </div>
          </div>

          <form onSubmit={handleProfileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="profileDisplayName" style={labelStyle}>{t('auth.profile_page.s6', "الاسم المعروض (Display Name)")}</label>
              <input
                id="profileDisplayName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputControlStyle}
                placeholder={t('auth.profile_page.s7', "أدخل اسمك المعروض")}
                required
              />
            </div>

            <div>
              <label htmlFor="profileUsername" style={labelStyle}>{t('auth.profile_page.s8', "اسم المستخدم (Login ID)")}</label>
              <input
                id="profileUsername"
                type="text"
                value={username}
                disabled
                style={{ ...inputControlStyle, background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }}
                title={t('auth.profile_page.s9', "لا يمكن تغيير اسم المستخدم لأسباب أمنية")}
                dir="ltr"
              />
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                {t('auth.profile_page.s10', "اسم المستخدم ثابت ومربوط بسجل العمليات ولا يمكن تعديله.")}
              </span>
            </div>

            <div>
              <label style={labelStyle}>{t('auth.profile_page.s11', "المستوى الوظيفي (Role)")}</label>
              <div style={{
                height: '38px',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '0.84rem',
                color: '#334155',
                fontWeight: 600,
              }}>
                {userRoleDisplay}
              </div>
            </div>

            {profileSuccessMsg ? (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#dcfce7', color: '#166534', fontSize: '0.8rem', border: '1px solid #bbf7d0', fontWeight: 600 }}>
                {profileSuccessMsg}
              </div>
            ) : null}

            <div style={{ marginTop: '6px' }}>
              <Button
                type="submit"
                disabled={isSavingProfile}
                style={{
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 20px',
                }}
              >
                {isSavingProfile ? t('auth.profile_page.s12', "جاري الحفظ...") : t('auth.profile_page.s13', "حفظ التعديلات")}
              </Button>
            </div>
          </form>
        </div>

        {/* Card 2: Password Rotation */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0f172a',
            }}>
              <LockIcon />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                {t('auth.profile_page.s14', "أمان الحساب وكلمة المرور")}
              </h3>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{t('auth.profile_page.s15', "تحديث كلمة المرور لحماية حسابك")}</span>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="profileCurrentPassword" style={labelStyle}>{t('auth.profile_page.s16', "كلمة المرور الحالية")}</label>
              <input
                id="profileCurrentPassword"
                type="text"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="secure-password-field"
                style={inputControlStyle}
                required
                dir="ltr"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label htmlFor="profileNewPassword" style={labelStyle}>{t('auth.profile_page.s17', "كلمة المرور الجديدة")}</label>
              <input
                id="profileNewPassword"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="secure-password-field"
                style={inputControlStyle}
                required
                dir="ltr"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••"
              />
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '3px', display: 'block' }}>
                {passwordMinLengthHint(user?.role)}
              </span>
            </div>

            <div>
              <label htmlFor="profileConfirmPassword" style={labelStyle}>{t('auth.profile_page.s18', "تأكيد كلمة المرور الجديدة")}</label>
              <input
                id="profileConfirmPassword"
                type="text"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="secure-password-field"
                style={inputControlStyle}
                required
                dir="ltr"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••"
              />
            </div>

            {passwordErrorMsg ? (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b', fontSize: '0.8rem', border: '1px solid #fecaca', fontWeight: 600 }}>
                {passwordErrorMsg}
              </div>
            ) : null}

            {passwordSuccessMsg ? (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#dcfce7', color: '#166534', fontSize: '0.8rem', border: '1px solid #bbf7d0', fontWeight: 600 }}>
                {passwordSuccessMsg}
              </div>
            ) : null}

            <div style={{ marginTop: '6px' }}>
              <Button
                type="submit"
                disabled={isSavingPassword}
                style={{
                  height: '38px',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0 20px',
                }}
              >
                {isSavingPassword ? t('auth.profile_page.s19', "جاري التحديث...") : t('auth.profile_page.s20', "تحديث كلمة المرور")}
              </Button>
            </div>
          </form>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <ShieldCheckIcon />
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>{t('auth.profile_page.s21', "التحقق بخطوتين")}</h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                {t('auth.profile_page.s22', "طبقة حماية ثانية بعد كلمة المرور")}
              </p>
            </div>
          </div>
          <TwoFactorCard />
        </div>
      </div>
    </div>
  );
}

