import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { MaritimeMailConfig, maritimeApi } from '../api/maritime-freight.api';
import { useAuthStore } from '@/stores/auth-store';
import { settingsApi } from '@/features/settings/api/settings.api';
import { toast } from '@/shared/components/system-alert';
import { DEFAULT_CONFIG, STANDARD_EMAIL_TEMPLATES } from './maritime-settings-tab/maritime-settings-tab-shared';
import { MaritimeSettingsTabHeader } from './maritime-settings-tab/maritime-settings-tab-header';
import { MaritimeSettingsTabPresets } from './maritime-settings-tab/maritime-settings-tab-presets';
import { MaritimeSettingsTabCompanyEmail } from './maritime-settings-tab/maritime-settings-tab-company-email';
import { MaritimeSettingsTabServerCards } from './maritime-settings-tab/maritime-settings-tab-server-cards';
import { MaritimeSettingsTabTestCenter } from './maritime-settings-tab/maritime-settings-tab-test-center';
import { MaritimeSettingsTabTemplates } from './maritime-settings-tab/maritime-settings-tab-templates';
export { STANDARD_EMAIL_TEMPLATES } from './maritime-settings-tab/maritime-settings-tab-shared';

export function MaritimeSettingsTab() {
  const { t: __t } = useTranslation();
  const { tenant, storeName } = useAuthStore();
  const [companyProfile, setCompanyProfile] = useState<{
    name: string;
    email: string;
    phone: string;
  }>({
    name: storeName || tenant?.businessName || 'الشركة اللوجستية',
    email: '',
    phone: '',
  });

  // Official company email (separate from SMTP credentials)
  const [companyOfficialEmail, setCompanyOfficialEmail] = useState('');

  // Locked state for sensitive credential fields (locked = saved, must click تغيير to edit)
  const [unlockedFields, setUnlockedFields] = useState<Set<string>>(new Set());
  const unlockField = (field: string) =>
    setUnlockedFields((prev) => new Set([...prev, field]));
  // A credential field is locked when it has a non-empty saved value AND hasn't been unlocked by the user
  const isCredLocked = (field: string, savedValue?: string | null) =>
    !!(savedValue && savedValue.trim() !== '' && !unlockedFields.has(field));

  // Card-level locking states for top-level protection against accidental edits or browser autofill
  const [smtpCardLocked, setSmtpCardLocked] = useState(true);
  const [imapCardLocked, setImapCardLocked] = useState(true);

  const [config, setConfig] = useState<MaritimeMailConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [testResult, setTestResult] = useState<{
    smtpSuccess?: boolean;
    imapSuccess?: boolean;
    smtpMessage?: string;
    imapMessage?: string;
  } | null>(null);

  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    syncedCount: number;
    message: string;
    details?: any[];
  } | null>(null);

  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testTargetEmail, setTestTargetEmail] = useState('');
  const [showTestEmailInput, setShowTestEmailInput] = useState(false);
  const [activeField, setActiveField] = useState<'subject' | 'intro' | 'signature'>('subject');

  const handleInsertTag = (tag: string) => {
    if (activeField === 'subject') {
      const cur = config.emailSubjectTemplate || '';
      setConfig({ ...config, emailSubjectTemplate: cur ? `${cur} ${tag}` : tag });
    } else if (activeField === 'intro') {
      const cur = config.emailIntroTemplate || '';
      setConfig({ ...config, emailIntroTemplate: cur ? `${cur} ${tag}` : tag });
    } else if (activeField === 'signature') {
      const cur = config.emailSignatureTemplate || '';
      setConfig({ ...config, emailSignatureTemplate: cur ? `${cur} ${tag}` : tag });
    }
  };

  const handleResetTemplates = () => {
    setConfig({
      ...config,
      emailSubjectTemplate: STANDARD_EMAIL_TEMPLATES.subject,
      emailIntroTemplate: STANDARD_EMAIL_TEMPLATES.intro,
      emailSignatureTemplate: STANDARD_EMAIL_TEMPLATES.signature,
    });
  };

  const renderLivePreview = (templateStr: string) => {
    if (!templateStr) return '';
    const activeCompanyName = config.fromName?.trim() || companyProfile.name || 'Your Company';
    const activeCompanyEmail = config.fromEmail?.trim() || config.smtpUser?.trim() || companyProfile.email || 'operations@yourcompany.com';
    const activeCompanyPhone = companyProfile.phone || '';

    return templateStr
      .replace(/{{rfq_number}}/g, 'RFQ-260914-0045')
      .replace(/{{carrier_name}}/g, 'Maersk Line / Carrier Pricing Desk')
      .replace(/{{pol_name}}/g, 'Alexandria Port')
      .replace(/{{pod_name}}/g, 'Shanghai Port')
      .replace(/{{pol_code}}/g, 'EGALY')
      .replace(/{{pod_code}}/g, 'CNSHA')
      .replace(/{{container_count}}/g, '2')
      .replace(/{{container_type}}/g, "40' High Cube")
      .replace(/{{cargo_mode}}/g, 'FCL')
      .replace(/{{commodity}}/g, 'General Cargo')
      .replace(/{{target_free_days}}/g, '14')
      .replace(/{{incoterm}}/g, 'FOB')
      .replace(/{{company_name}}/g, activeCompanyName)
      .replace(/{{company_email}}/g, activeCompanyEmail)
      .replace(/{{company_phone}}/g, activeCompanyPhone);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const [res, appSettings] = await Promise.all([
        maritimeApi.getMailSettings().catch(() => null),
        settingsApi.settings().catch(() => null),
      ]);

      const resolvedCompanyName = (appSettings as any)?.companyName || (appSettings as any)?.storeName || storeName || tenant?.businessName || 'الشركة اللوجستية';
      const resolvedCompanyEmail = (appSettings as any)?.email || '';
      const resolvedCompanyPhone = (appSettings as any)?.phone || '';

      setCompanyProfile({
        name: resolvedCompanyName,
        email: resolvedCompanyEmail,
        phone: resolvedCompanyPhone,
      });

      const mailConfig = res?.config || (res && (res.smtpHost || res.outgoingProvider) ? res : null);
      if (mailConfig) {
        const loaded = {
          ...DEFAULT_CONFIG,
          ...mailConfig,
          fromName: mailConfig.fromName?.trim() || resolvedCompanyName,
          fromEmail: mailConfig.fromEmail?.trim() || resolvedCompanyEmail,
          emailSubjectTemplate: mailConfig.emailSubjectTemplate || STANDARD_EMAIL_TEMPLATES.subject,
          emailIntroTemplate: mailConfig.emailIntroTemplate || STANDARD_EMAIL_TEMPLATES.intro,
          emailSignatureTemplate: mailConfig.emailSignatureTemplate || STANDARD_EMAIL_TEMPLATES.signature,
        };
        setConfig(loaded);
        // Lock all credential fields that have saved values and lock both server cards
        setUnlockedFields(new Set());
        setSmtpCardLocked(true);
        setImapCardLocked(true);
        // Set official company email from saved config
        setCompanyOfficialEmail(mailConfig.companyOfficialEmail || resolvedCompanyEmail || '');
        if (mailConfig.fromEmail || resolvedCompanyEmail) {
          setTestTargetEmail(mailConfig.fromEmail || resolvedCompanyEmail);
        }
      } else {
        setConfig((prev) => ({
          ...prev,
          fromName: resolvedCompanyName,
          fromEmail: resolvedCompanyEmail,
        }));
        setCompanyOfficialEmail(resolvedCompanyEmail);
        setSmtpCardLocked(false);
        setImapCardLocked(false);
      }
    } catch (err: any) {
      console.error('Failed to load maritime mail settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (provider: 'custom' | 'outlook' | 'gmail') => {
    // Unlock cards so user can inspect and customize preset values
    setSmtpCardLocked(false);
    setImapCardLocked(false);
    if (provider === 'custom') {
      setConfig((prev: MaritimeMailConfig) => ({
        ...prev,
        outgoingProvider: 'custom',
        incomingProvider: 'custom',
        smtpHost: prev.smtpHost && prev.smtpHost !== 'smtp.office365.com' && prev.smtpHost !== 'smtp.gmail.com' ? prev.smtpHost : 'mail.yourcompany.com',
        smtpPort: 465,
        smtpSecure: true,
        imapHost: prev.imapHost && prev.imapHost !== 'outlook.office365.com' && prev.imapHost !== 'imap.gmail.com' ? prev.imapHost : 'mail.yourcompany.com',
        imapPort: 993,
        imapSecure: true,
      }));
    } else if (provider === 'outlook') {
      setConfig((prev: MaritimeMailConfig) => ({
        ...prev,
        outgoingProvider: 'outlook',
        incomingProvider: 'outlook',
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false,
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        imapSecure: true,
      }));
    } else if (provider === 'gmail') {
      setConfig((prev: MaritimeMailConfig) => ({
        ...prev,
        outgoingProvider: 'gmail',
        incomingProvider: 'gmail',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
      }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setFeedbackMsg(null);
      const cleanConfig: MaritimeMailConfig = {
        ...config,
        smtpUser: config.smtpUser.trim(),
        fromEmail: (config.fromEmail && config.fromEmail.includes('@')) ? config.fromEmail.trim() : config.smtpUser.trim(),
        imapUser: (config.imapUser ? config.imapUser.trim() : config.smtpUser.trim()),
        ...(companyOfficialEmail.trim() ? { companyOfficialEmail: companyOfficialEmail.trim() } as any : {}),
      };
      await maritimeApi.saveMailSettings(cleanConfig);
      setConfig(cleanConfig);
      // Re-lock credential fields and both cards after successful save
      setUnlockedFields(new Set());
      setSmtpCardLocked(true);
      setImapCardLocked(true);
      setFeedbackMsg({ type: 'success', text: 'تم حفظ إعدادات البريد الإلكتروني وقوالب الرسائل بنجاح.' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'فشل حفظ الإعدادات.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setFeedbackMsg(null);
      const res = await maritimeApi.testMailConnection({
        smtp: {
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          user: config.smtpUser,
          password: config.smtpPassword || '',
        },
        imap: {
          host: config.imapHost,
          port: config.imapPort,
          secure: config.imapSecure,
          user: config.imapUser,
          password: config.imapPassword || '',
        },
      });

      setTestResult({
        smtpSuccess: res.smtpOk,
        imapSuccess: res.imapOk,
        smtpMessage: res.smtpMessage,
        imapMessage: res.imapMessage,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'فشل تنفيذ اختبار الاتصال.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testTargetEmail.trim()) {
      toast.warning('يرجى كتابة البريد الإلكتروني المستلم للتجربة.');
      return;
    }
    try {
      setSendingTest(true);
      setFeedbackMsg(null);
      // Auto-save current configuration first
      await maritimeApi.saveMailSettings(config);
      const res = await maritimeApi.sendTestEmail(testTargetEmail.trim());
      setFeedbackMsg({ type: 'success', text: `تم إرسال البريد التجريبي بنجاح إلى (${testTargetEmail.trim()}) [معرف الرسالة: ${res.messageId || 'OK'}]` });
      setShowTestEmailInput(false);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'فشل إرسال البريد التجريبي. تأكد من صحة بيانات الخادم وكلمة المرور.' });
    } finally {
      setSendingTest(false);
    }
  };

  const handleSyncInboundBids = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      setFeedbackMsg(null);
      const res = await maritimeApi.syncInboundBids();
      setSyncResult({
        success: !res.error,
        syncedCount: res.imported,
        message: res.summary || 'تم مسح صندوق الوارد بنجاح.',
      });
      await loadSettings();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'فشل مزامنة عروض الخطوط الملاحية.' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '40px', textAlign: 'center', color: '#64748b' }}>
        {__t('maritime_freight.maritime_settings_tab.s0', "جاري تحميل إعدادات بريد الشحن والربط الآلي...")}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* هيدر الكارت الموحد مع التنبيه والملاحظات */}
      <MaritimeSettingsTabHeader __t={__t} companyProfile={companyProfile} saving={saving} handleSave={handleSave} feedbackMsg={feedbackMsg} />
      {/* أزرار الضبط السريع لنوع السيرفر */}
      <MaritimeSettingsTabPresets __t={__t} applyPreset={applyPreset} config={config} />
      {/* البريد الرسمي للشركة */}
      <MaritimeSettingsTabCompanyEmail __t={__t} companyOfficialEmail={companyOfficialEmail} setCompanyOfficialEmail={setCompanyOfficialEmail} />
      {/* كارتان متناسقان وفق معيار المنظومة (2-Column Grid) */}
      <MaritimeSettingsTabServerCards __t={__t} smtpCardLocked={smtpCardLocked} setSmtpCardLocked={setSmtpCardLocked} config={config} setConfig={setConfig} isCredLocked={isCredLocked} unlockField={unlockField} imapCardLocked={imapCardLocked} setImapCardLocked={setImapCardLocked} />
      {/* مركز الفحص والاختبار والتشغيل المباشر */}
      <MaritimeSettingsTabTestCenter __t={__t} testing={testing} handleTestConnection={handleTestConnection} setShowTestEmailInput={setShowTestEmailInput} showTestEmailInput={showTestEmailInput} syncing={syncing} handleSyncInboundBids={handleSyncInboundBids} testTargetEmail={testTargetEmail} setTestTargetEmail={setTestTargetEmail} sendingTest={sendingTest} handleSendTestEmail={handleSendTestEmail} testResult={testResult} syncResult={syncResult} config={config} />
      {/* تخصيص وتأكيد قالب رسائل طلبات الأسعار للخطوط الملاحية مع المعاينة الحية */}
      <MaritimeSettingsTabTemplates __t={__t} handleResetTemplates={handleResetTemplates} activeField={activeField} handleInsertTag={handleInsertTag} config={config} setActiveField={setActiveField} setConfig={setConfig} companyProfile={companyProfile} renderLivePreview={renderLivePreview} />
    </div>
  );
}
