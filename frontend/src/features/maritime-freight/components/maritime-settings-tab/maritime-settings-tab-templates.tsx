import { MailIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MaritimeMailConfig } from '../../api/maritime-freight.api';

export interface MaritimeSettingsTabTemplatesProps {
  __t: ReturnType<typeof useTranslation>['t'];
  handleResetTemplates: () => void;
  activeField: 'subject' | 'intro' | 'signature';
  handleInsertTag: (tag: string) => void;
  config: MaritimeMailConfig;
  setActiveField: React.Dispatch<React.SetStateAction<'subject' | 'intro' | 'signature'>>;
  setConfig: React.Dispatch<React.SetStateAction<MaritimeMailConfig>>;
  companyProfile: { name: string; email: string; phone: string };
  renderLivePreview: (templateStr: string) => string;
}

export function MaritimeSettingsTabTemplates({ __t, handleResetTemplates, activeField, handleInsertTag, config, setActiveField, setConfig, companyProfile, renderLivePreview }: MaritimeSettingsTabTemplatesProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MailIcon size={18} color="#170e5e" />
          <div>
            <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
              {__t('maritime_freight.maritime_settings_tab.s77', "نص الرسالة والتوقيع المعتمد لطلبات الأسعار (RFQ Email Template & Signature)")}
            </h4>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              {__t('maritime_freight.maritime_settings_tab.s78', "الرسالة الفعلية باللغة الإنجليزية التي يستلمها الناقل أو الخط الملاحي في بريده مع المعاينة الحية المباشرة")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetTemplates}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#170e5e',
            fontSize: '0.76rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {__t('maritime_freight.maritime_settings_tab.s79', "استعادة النص النموذجي المعتمد")}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* شريط الأزرار الذكية لإدراج المتغيرات بنقرة واحدة */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e' }}>
              {__t('maritime_freight.maritime_settings_tab.s80', "إدراج بيانات الشحنة بنقرة واحدة في الحقل النشط (")}{activeField === 'subject' ? __t('maritime_freight.maritime_settings_tab.s81', "الموضوع") : activeField === 'intro' ? __t('maritime_freight.maritime_settings_tab.s82', "المقدمة") : __t('maritime_freight.maritime_settings_tab.s83', "التوقيع")}):
            </span>
            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
              {__t('maritime_freight.maritime_settings_tab.s84', "يقوم النظام بالتعويض عن هذه العناصر تلقائياً ببيانات كل شحنة فعلية")}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {[
              { tag: '{{rfq_number}}', label: __t('maritime_freight.maritime_settings_tab.s85', "رقم طلب التسعير") },
              { tag: '{{carrier_name}}', label: __t('maritime_freight.maritime_settings_tab.s86', "اسم الناقل / الخط") },
              { tag: '{{pol_name}}', label: __t('maritime_freight.maritime_settings_tab.s87', "ميناء / مطار الشحن") },
              { tag: '{{pod_name}}', label: __t('maritime_freight.maritime_settings_tab.s88', "ميناء / مطار الوصول") },
              { tag: '{{container_count}}', label: __t('maritime_freight.maritime_settings_tab.s89', "عدد الحاويات / الطرود") },
              { tag: '{{container_type}}', label: __t('maritime_freight.maritime_settings_tab.s90', "نوع الحاوية / الشحنة") },
              { tag: '{{commodity}}', label: __t('maritime_freight.maritime_settings_tab.s91', "نوع البضاعة") },
              { tag: '{{target_free_days}}', label: __t('maritime_freight.maritime_settings_tab.s92', "فترة السماح") },
              { tag: '{{incoterm}}', label: __t('maritime_freight.maritime_settings_tab.s93', "شرط الشحن (Incoterm)") },
              { tag: '{{company_name}}', label: __t('maritime_freight.maritime_settings_tab.s94', "اسم شركتك") },
              { tag: '{{company_email}}', label: __t('maritime_freight.maritime_settings_tab.s95', "بريد شركتك") },
              { tag: '{{company_phone}}', label: __t('maritime_freight.maritime_settings_tab.s96', "هاتف شركتك") },
            ].map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => handleInsertTag(t.tag)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#ffffff',
                  border: '1px solid #c7d2fe',
                  color: '#3730a3',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title={`إدراج ${t.label} في الحقل المحدد`}
              >
                <span style={{ color: '#4338ca' }}>+</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 1. عنوان وموضوع الرسالة */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
              {__t('maritime_freight.maritime_settings_tab.s97', "عنوان وموضوع الرسالة (Email Subject)")}
            </label>
            <span style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 600 }}>
              {__t('maritime_freight.maritime_settings_tab.s98', "تأكد دائماً من بقاء [")}{'{'}{'{'}rfq_number{'}'}{'}'}{__t('maritime_freight.maritime_settings_tab.s99', "] ليتعرف النظام على الردود الواردة آلياً")}
            </span>
          </div>
          <input
            type="text"
            dir="ltr"
            value={config.emailSubjectTemplate || ''}
            onFocus={() => setActiveField('subject')}
            onChange={(e) => setConfig({ ...config, emailSubjectTemplate: e.target.value })}
            style={{
              width: '100%',
              padding: '9px 12px',
              border: activeField === 'subject' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '0.84rem',
              textAlign: 'left',
              direction: 'ltr',
              fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
              fontWeight: 600,
              color: '#0f172a',
              background: '#ffffff',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* 2. المقدمة والتوقيع في شبكة متناسقة */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {__t('maritime_freight.maritime_settings_tab.s100', "الافتتاحية والطلب الموجه للناقل (Intro & Opening Greeting)")}
            </label>
            <textarea
              rows={4}
              dir="ltr"
              value={config.emailIntroTemplate || ''}
              onFocus={() => setActiveField('intro')}
              onChange={(e) => setConfig({ ...config, emailIntroTemplate: e.target.value })}
              style={{
                width: '100%',
                padding: '9px 12px',
                border: activeField === 'intro' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '0.84rem',
                textAlign: 'left',
                direction: 'ltr',
                fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
                lineHeight: 1.6,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
            <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
              {__t('maritime_freight.maritime_settings_tab.s101', "النص الترحيبي أعلى جدول بيانات الشحنة مباشرة.")}
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {__t('maritime_freight.maritime_settings_tab.s102', "التوقيع المذيل للرسالة (Email Signature)")}
            </label>
            <textarea
              rows={4}
              dir="ltr"
              value={config.emailSignatureTemplate || ''}
              onFocus={() => setActiveField('signature')}
              onChange={(e) => setConfig({ ...config, emailSignatureTemplate: e.target.value })}
              style={{
                width: '100%',
                padding: '9px 12px',
                border: activeField === 'signature' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '0.84rem',
                textAlign: 'left',
                direction: 'ltr',
                fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
                lineHeight: 1.6,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
            <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
              {__t('maritime_freight.maritime_settings_tab.s103', "بيانات التواصل الرسمية أسفل الرسالة ورابط تقديم العرض.")}
            </span>
          </div>
        </div>

        {/* 3. نافذة المعاينة الحية المباشرة للإيميل (Live Real-Time Email Preview) */}
        <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', overflow: 'hidden', background: '#f8fafc', marginTop: '4px' }}>
          <div style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#cbd5e1' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#cbd5e1' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#cbd5e1' }} />
              <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginInlineStart: '6px' }}>
                {__t('maritime_freight.maritime_settings_tab.s104', "معاينة حية للإيميل الفعلي كما يستلمه الناقل في بريده")}
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: '10px' }}>
              {__t('maritime_freight.maritime_settings_tab.s105', "يتحدث في الوقت الفعلي مع كتابتك")}
            </span>
          </div>

          <div style={{ padding: '16px 20px', background: '#ffffff', direction: 'ltr', textAlign: 'left', fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#1e293b', lineHeight: 1.6 }}>
            {/* هيدر الإيميل */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', marginBottom: '14px', fontSize: '12px' }}>
              <div style={{ color: '#64748b' }}><strong>From:</strong> {config.fromName?.trim() || companyProfile.name} &lt;{config.fromEmail?.trim() || config.smtpUser?.trim() || companyProfile.email || 'operations@yourcompany.com'}&gt;</div>
              <div style={{ color: '#64748b', marginTop: '2px' }}><strong>To:</strong> Maersk Line Egypt Pricing Desk &lt;pricing.egypt@maersk.com&gt;</div>
              <div style={{ color: '#0f172a', fontWeight: 700, marginTop: '6px', fontSize: '13px' }}>
                <strong>Subject:</strong> {renderLivePreview(config.emailSubjectTemplate || '')}
              </div>
            </div>

            {/* جسم الإيميل */}
            <div style={{ whiteSpace: 'pre-line', color: '#1e293b' }}>
              {renderLivePreview(config.emailIntroTemplate || '')}
            </div>

            {/* جدول مواصفات الشحنة القياسي */}
            <table style={{ borderCollapse: 'collapse', width: '100%', margin: '14px 0', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
              <tbody>
                <tr style={{ background: '#f8fafc' }}><td style={{ padding: '7px 10px', fontWeight: 'bold', width: '35%', borderBottom: '1px solid #e2e8f0' }}>Reference</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0', color: '#170e5e', fontWeight: 'bold' }}>RFQ-260914-0045</td></tr>
                <tr><td style={{ padding: '7px 10px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>Port / Airport of Loading (POL)</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>Alexandria Port (EGALY)</td></tr>
                <tr style={{ background: '#f8fafc' }}><td style={{ padding: '7px 10px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>Port / Airport of Discharge (POD)</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>Shanghai Port (CNSHA)</td></tr>
                <tr><td style={{ padding: '7px 10px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>Equipment / Packages</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>2 x 40' High Cube (FCL)</td></tr>
                <tr style={{ background: '#f8fafc' }}><td style={{ padding: '7px 10px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>Commodity</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>General Commercial Cargo</td></tr>
                <tr><td style={{ padding: '7px 10px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>Target Free Days</td><td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>14 Days at Destination</td></tr>
                <tr style={{ background: '#f8fafc' }}><td style={{ padding: '7px 10px', fontWeight: 'bold' }}>Incoterm</td><td style={{ padding: '7px 10px' }}>FOB (Freight Prepaid)</td></tr>
              </tbody>
            </table>

            {/* زر تقديم السعر التفاعلي */}
            <div style={{ margin: '14px 0' }}>
              <span style={{ display: 'inline-block', background: '#170e5e', color: '#ffffff', padding: '8px 18px', borderRadius: '6px', fontWeight: 'bold', fontSize: '12px' }}>
                {__t('maritime_freight.maritime_settings_tab.s106', "Submit Your Rate Online / تقديم عرض السعر إلكترونياً")}
              </span>
              <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                {__t('maritime_freight.maritime_settings_tab.s107', "* رابط إلكتروني مشفر وآمن مخصص للتوكيل لتقديم السعر ومصاريف DTHC والتفريغ مباشرة بنقرة واحدة")}
              </span>
            </div>

            {/* التوقيع المذيل */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '16px', color: '#475569', whiteSpace: 'pre-line', fontSize: '12px' }}>
              {renderLivePreview(config.emailSignatureTemplate || '')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
