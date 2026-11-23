import { MailIcon, SendIcon } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { useTranslation } from 'react-i18next';
import type { MaritimeMailConfig } from '../../api/maritime-freight.api';

export interface MaritimeSettingsTabServerCardsProps {
  __t: ReturnType<typeof useTranslation>['t'];
  smtpCardLocked: boolean;
  setSmtpCardLocked: React.Dispatch<React.SetStateAction<boolean>>;
  config: MaritimeMailConfig;
  setConfig: React.Dispatch<React.SetStateAction<MaritimeMailConfig>>;
  isCredLocked: (field: string, savedValue?: string | null) => boolean;
  unlockField: (field: string) => void;
  imapCardLocked: boolean;
  setImapCardLocked: React.Dispatch<React.SetStateAction<boolean>>;
}

export function MaritimeSettingsTabServerCards({ __t, smtpCardLocked, setSmtpCardLocked, config, setConfig, isCredLocked, unlockField, imapCardLocked, setImapCardLocked }: MaritimeSettingsTabServerCardsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
      {/* كارت الإرسال SMTP */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SendIcon size={18} color="#170e5e" />
            <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
              {__t('maritime_freight.maritime_settings_tab.s14', "خادم البريد الصادر (SMTP Outgoing)")}
            </h4>
            {smtpCardLocked && (
              <span style={{ fontSize: '0.7rem', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                {__t('maritime_freight.maritime_settings_tab.s15', "محمي")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSmtpCardLocked((prev) => !prev)}
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: smtpCardLocked ? '#170e5e' : '#047857',
              background: smtpCardLocked ? '#eff6ff' : '#ecfdf5',
              border: `1px solid ${smtpCardLocked ? '#bfdbfe' : '#a7f3d0'}`,
              borderRadius: '5px',
              padding: '3px 11px',
              cursor: 'pointer',
            }}
          >
            {smtpCardLocked ? __t('maritime_freight.maritime_settings_tab.s16', "تغيير") : __t('maritime_freight.maritime_settings_tab.s17', "قفل الحماية")}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {__t('maritime_freight.maritime_settings_tab.s18', "عنوان خادم الإرسال (SMTP Host) *")}
            </label>
            {smtpCardLocked ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                {config.smtpHost || 'mail.yourcompany.com'}
              </div>
            ) : (
              <input
                type="text"
                value={config.smtpHost}
                onChange={(e) => setConfig({ ...config, smtpHost: e.target.value })}
                placeholder={__t('maritime_freight.maritime_settings_tab.s19', "مثال: mail.yourcompany.com")}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {__t('maritime_freight.maritime_settings_tab.s20', "المنفذ (Port) *")}
              </label>
              {smtpCardLocked ? (
                <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                  {config.smtpPort}
                </div>
              ) : (
                <input
                  type="number"
                  value={config.smtpPort}
                  onChange={(e) => setConfig({ ...config, smtpPort: parseInt(e.target.value, 10) || 465 })}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {__t('maritime_freight.maritime_settings_tab.s21', "نوع التشفير")}
              </label>
              {smtpCardLocked ? (
                <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569' }}>
                  {config.smtpSecure ? 'SSL / TLS (Port 465)' : 'STARTTLS (Port 587)'}
                </div>
              ) : (
                <CustomSelect
                  value={config.smtpSecure ? 'ssl' : 'starttls'}
                  onChange={(val) => setConfig({ ...config, smtpSecure: val === 'ssl' })}
                  options={[
                    { value: 'ssl', label: 'SSL / TLS (Port 465)' },
                    { value: 'starttls', label: 'STARTTLS (Port 587)' },
                  ]}
                />
              )}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {__t('maritime_freight.maritime_settings_tab.s22', "اسم المرسل المعروض (From Name)")}
            </label>
            {smtpCardLocked ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569' }}>
                {config.fromName || '—'}
              </div>
            ) : (
              <input
                type="text"
                value={config.fromName}
                onChange={(e) => setConfig({ ...config, fromName: e.target.value })}
                placeholder={__t('maritime_freight.maritime_settings_tab.s23', "مثال: شركة النجم للشحن الدولي")}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                {__t('maritime_freight.maritime_settings_tab.s24', "عنوان البريد الإلكتروني للمرسل (From Email / Username) *")}
              </label>
              {isCredLocked('smtpUser', config.smtpUser) && (
                <button type="button" onClick={() => unlockField('smtpUser')} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#170e5e', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '2px 9px', cursor: 'pointer' }}>
                  {__t('maritime_freight.maritime_settings_tab.s25', "تغيير")}
                </button>
              )}
            </div>
            {isCredLocked('smtpUser', config.smtpUser) ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                {config.smtpUser}
              </div>
            ) : (
              <input
                type="email"
                value={config.smtpUser}
                onChange={(e) => {
                  const val = e.target.value;
                  setConfig({
                    ...config,
                    smtpUser: val,
                    fromEmail: val,
                    imapUser: config.imapUser && config.imapUser !== config.smtpUser ? config.imapUser : val,
                  });
                }}
                placeholder="freight@yourcompany.com"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                {__t('maritime_freight.maritime_settings_tab.s26', "كلمة المرور / رمز التطبيق (App Password)")}
              </label>
              {isCredLocked('smtpPassword', config.smtpPassword) && (
                <button type="button" onClick={() => unlockField('smtpPassword')} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#170e5e', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '2px 9px', cursor: 'pointer' }}>
                  {__t('maritime_freight.maritime_settings_tab.s27', "تغيير")}
                </button>
              )}
            </div>
            {isCredLocked('smtpPassword', config.smtpPassword) ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#94a3b8', letterSpacing: '3px' }}>
                ••••••••••••
              </div>
            ) : (
              <input
                type="password"
                value={config.smtpPassword || ''}
                onChange={(e) => setConfig({ ...config, smtpPassword: e.target.value })}
                placeholder={__t('maritime_freight.maritime_settings_tab.s28', "أدخل كلمة المرور أو رمز التطبيق")}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}

            <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
              {__t('maritime_freight.maritime_settings_tab.s29', "ملاحظة: إذا كان حساب Outlook أو Gmail مفعلاً عليه التحقق بخطوتين (2FA)، يرجى استخدام \"رمز تطبيق\" (App Password).")}
            </span>
          </div>
        </div>
      </div>

      {/* كارت الاستقبال IMAP */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MailIcon size={18} color="#170e5e" />
            <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
              {__t('maritime_freight.maritime_settings_tab.s30', "خادم البريد الوارد للقراءة الآلية (IMAP Inbound)")}
            </h4>
            {imapCardLocked && (
              <span style={{ fontSize: '0.7rem', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                {__t('maritime_freight.maritime_settings_tab.s31', "محمي")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setImapCardLocked((prev) => !prev)}
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: imapCardLocked ? '#170e5e' : '#047857',
              background: imapCardLocked ? '#eff6ff' : '#ecfdf5',
              border: `1px solid ${imapCardLocked ? '#bfdbfe' : '#a7f3d0'}`,
              borderRadius: '5px',
              padding: '3px 11px',
              cursor: 'pointer',
            }}
          >
            {imapCardLocked ? __t('maritime_freight.maritime_settings_tab.s32', "تغيير") : __t('maritime_freight.maritime_settings_tab.s33', "قفل الحماية")}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {__t('maritime_freight.maritime_settings_tab.s34', "عنوان خادم الاستقبال (IMAP Host) *")}
            </label>
            {imapCardLocked ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                {config.imapHost || 'mail.yourcompany.com'}
              </div>
            ) : (
              <input
                type="text"
                value={config.imapHost}
                onChange={(e) => setConfig({ ...config, imapHost: e.target.value })}
                placeholder={__t('maritime_freight.maritime_settings_tab.s35', "مثال: mail.yourcompany.com")}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {__t('maritime_freight.maritime_settings_tab.s36', "المنفذ (Port) *")}
              </label>
              {imapCardLocked ? (
                <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                  {config.imapPort}
                </div>
              ) : (
                <input
                  type="number"
                  value={config.imapPort}
                  onChange={(e) => setConfig({ ...config, imapPort: parseInt(e.target.value, 10) || 993 })}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {__t('maritime_freight.maritime_settings_tab.s37', "تشفير الاتصال")}
              </label>
              {imapCardLocked ? (
                <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569' }}>
                  {config.imapSecure ? __t('maritime_freight.maritime_settings_tab.s38', "SSL / TLS (الافتراضي المنفذ 993)") : __t('maritime_freight.maritime_settings_tab.s39', "غير مشفر (منفذ 143)")}
                </div>
              ) : (
                <CustomSelect
                  value={config.imapSecure ? 'ssl' : 'plain'}
                  onChange={(val) => setConfig({ ...config, imapSecure: val === 'ssl' })}
                  options={[
                    { value: 'ssl', label: __t('maritime_freight.maritime_settings_tab.s40', "SSL / TLS (الافتراضي المنفذ 993)") },
                    { value: 'plain', label: __t('maritime_freight.maritime_settings_tab.s41', "غير مشفر (منفذ 143)") },
                  ]}
                />
              )}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                {__t('maritime_freight.maritime_settings_tab.s42', "اسم المستخدم للبريد الوارد (IMAP User) *")}
              </label>
              {isCredLocked('imapUser', config.imapUser) && (
                <button type="button" onClick={() => unlockField('imapUser')} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#170e5e', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '2px 9px', cursor: 'pointer' }}>
                  {__t('maritime_freight.maritime_settings_tab.s43', "تغيير")}
                </button>
              )}
            </div>
            {isCredLocked('imapUser', config.imapUser) ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#475569', direction: 'ltr', textAlign: 'left' }}>
                {config.imapUser}
              </div>
            ) : (
              <input
                type="text"
                value={config.imapUser}
                onChange={(e) => setConfig({ ...config, imapUser: e.target.value })}
                placeholder="freight@yourcompany.com"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                {__t('maritime_freight.maritime_settings_tab.s44', "كلمة المرور للبريد الوارد (IMAP Password)")}
              </label>
              {isCredLocked('imapPassword', config.imapPassword) && (
                <button type="button" onClick={() => unlockField('imapPassword')} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#170e5e', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '2px 9px', cursor: 'pointer' }}>
                  {__t('maritime_freight.maritime_settings_tab.s45', "تغيير")}
                </button>
              )}
            </div>
            {isCredLocked('imapPassword', config.imapPassword) ? (
              <div style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.8125rem', background: '#f8fafc', color: '#94a3b8', letterSpacing: '3px' }}>
                ••••••••••••
              </div>
            ) : (
              <input
                type="password"
                value={config.imapPassword || ''}
                onChange={(e) => setConfig({ ...config, imapPassword: e.target.value })}
                placeholder={__t('maritime_freight.maritime_settings_tab.s46', "نفس كلمة مرور البريد أو رمز التطبيق")}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '0.8125rem' }}
              />
            )}
          </div>

          <div style={{ marginTop: '6px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: imapCardLocked ? 0.8 : 1 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: imapCardLocked ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                disabled={imapCardLocked}
                checked={config.autoReadInboundBids}
                onChange={(e) => setConfig({ ...config, autoReadInboundBids: e.target.checked })}
                style={{ width: '16px', height: '16px', cursor: imapCardLocked ? 'not-allowed' : 'pointer' }}
              />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>
                {__t('maritime_freight.maritime_settings_tab.s47', "تفعيل القراءة الذاتية لرسائل عروض الأسعار الواردة من الناقلين والخطوط")}
              </span>
            </label>
            <p style={{ margin: '4px 0 0 24px', fontSize: '0.72rem', color: '#64748b' }}>
              {__t('maritime_freight.maritime_settings_tab.s48', "يقوم النظام بالبحث التلقائي عن الرسائل التي تحتوي على أكواد طلبات التسعير (مثل RFQ-) واستخراج الأسعار وإدراجها فورياً في مصفوفة المقارنة")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
