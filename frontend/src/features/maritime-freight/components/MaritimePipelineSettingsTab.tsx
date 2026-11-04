import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import {
  maritimeApi,
  MaritimePipelineConfig,
} from '../api/maritime-freight.api';
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
  TrendingUpIcon,
  SendIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UsersIcon,
  MessageSquareIcon,
  MailIcon,
  CheckIcon,
  AppIcons,
} from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Field } from '@/shared/ui/field';
import { toast } from '@/shared/components/system-alert';

const DEFAULT_CONFIG: MaritimePipelineConfig = {
  enableSeaFreight: true,
  enableAirFreight: true,
  enableRoadFreight: true,
  automationMode: 'hybrid',
  defaultMarginType: 'fixed',
  defaultMarginValue: 200,
  marginFloor: 150,
  rfqCutOffHoursStandard: 24,
  rfqCutOffHoursUrgent: 6,
  earlyAwardingEnabled: true,
  earlyAwardingMinFreeDays: 14,
  requireManualRfqDispatch: false,
  requireManualAwardAndMargin: true,
  requireManualQuoteDispatch: false,
  autoSendWhatsAppQuote: true,
  autoSendEmailQuote: true,
};

export function MaritimePipelineSettingsTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<MaritimePipelineConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningTrigger, setRunningTrigger] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await maritimeApi.getPipelineSettings();
      if (data) {
        setConfig(data);
      }
    } catch (err: any) {
      console.error('Failed to load pipeline settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setFeedback(null);
      const updated = await maritimeApi.savePipelineSettings(config);
      setConfig(updated);
      setFeedback({
        type: 'success',
        message: 'تم حفظ وتفعيل إعدادات وسياسات الشحن بنجاح.',
      });
      toast.success('تم حفظ إعدادات وسياسات الشحن بنجاح', undefined, 2500);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'فشل حفظ إعدادات وسياسات الشحن',
      });
      toast.error('فشل حفظ إعدادات وسياسات الشحن');
    } finally {
      setSaving(false);
    }
  };

  const handleRunPipelineNow = async () => {
    try {
      setRunningTrigger(true);
      const res = await maritimeApi.triggerPipeline();
      const summaryMsg = `تم فحص ${res.processedRfqs} طلب: تمت ترسية ${res.awardedCount} وإصدار ${res.quotesGenerated} عرض سعر بنجاح.`;
      toast.success(summaryMsg, 'تشغيل مسار الأتمتة اللوجستية');
      if (res.details && res.details.length > 0) {
        setFeedback({
          type: 'success',
          message: summaryMsg + ' ' + res.details.join(' | '),
        });
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل تشغيل فحص الأتمتة');
    } finally {
      setRunningTrigger(false);
    }
  };

  if (loading) {
    return (
      <div style={{ background: '#ffffff', padding: '40px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', color: '#64748b' }}>
        {t('maritime_freight.maritime_pipeline_settings_tab.s0', "جاري تحميل إعدادات وسياسات الشحن...")}
      </div>
    );
  }

  return (
    <div className="pipeline-settings-tab" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`
        .pipeline-settings-tab input[type="number"]::-webkit-outer-spin-button,
        .pipeline-settings-tab input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        .pipeline-settings-tab input[type="number"] {
          -moz-appearance: textfield !important;
        }
        @media (max-width: 768px) {
          .pipeline-settings-card {
            padding: 14px !important;
            border-radius: 10px !important;
          }
          .pipeline-header-actions {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
            margin-top: 10px !important;
          }
          .pipeline-header-actions button {
            height: 36px !important;
            padding: 0 8px !important;
            font-size: 0.78rem !important;
            justify-content: center !important;
            white-space: nowrap !important;
          }
          .pipeline-checkpoint-label {
            padding: 10px 12px !important;
            gap: 10px !important;
          }
          .pipeline-channel-card {
            padding: 12px !important;
            gap: 10px !important;
          }
        }
      `}</style>

      {/* هيدر البطاقة والأزرار الإجرائية */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#170e5e', margin: 0 }}>
              {t('maritime_freight.maritime_pipeline_settings_tab.s1', "إعدادات وسياسات تشغيل الشحن")}
              <span className="desktop-only-inline"> (Freight Settings & Policies)</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 0 0' }}>
              {t('maritime_freight.maritime_pipeline_settings_tab.s2', "تحديد وسائط الشحن المعتمدة للمنشأة، درجة الأتمتة، ضبط هوامش الربح الافتراضية، مؤقت مهل عروض الأسعار، وخوادم المراسلات.")}
            </p>
          </div>

          <div className="pipeline-header-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              disabled={runningTrigger}
              onClick={handleRunPipelineNow}
              style={{
                height: '38px',
                padding: '0 16px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#f8fafc',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
                cursor: runningTrigger ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.8rem',
              }}
              title={t('maritime_freight.maritime_pipeline_settings_tab.s3', "فحص فوري لجميع طلبات التسعير المفتوحة وترسية المكتمل منها حالاً")}
            >
              <RefreshCwIcon size={15} style={{ animation: runningTrigger ? 'spin 1s linear infinite' : 'none', flexShrink: 0 }} />
              <span>
                {runningTrigger ? (
                  t('maritime_freight.maritime_pipeline_settings_tab.s4', "جاري الفحص...")
                ) : (
                  <>
                    <span className="desktop-only-inline">{t('maritime_freight.maritime_pipeline_settings_tab.s5', "تشغيل فحص الأتمتة الآن (Run Pipeline)")}</span>
                    <span className="mobile-only-inline">{t('maritime_freight.maritime_pipeline_settings_tab.s6', "فحص الأتمتة")}</span>
                  </>
                )}
              </span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              style={{
                height: '38px',
                padding: '0 20px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.8125rem',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
              }}
            >
              <CheckIcon size={16} style={{ flexShrink: 0 }} />
              <span>
                {saving ? (
                  t('maritime_freight.maritime_pipeline_settings_tab.s7', "جاري الحفظ...")
                ) : (
                  <>
                    <span className="desktop-only-inline">{t('maritime_freight.maritime_pipeline_settings_tab.s8', "حفظ إعدادات وسياسات الشحن")}</span>
                    <span className="mobile-only-inline">{t('maritime_freight.maritime_pipeline_settings_tab.s9', "حفظ الإعدادات")}</span>
                  </>
                )}
              </span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              color: feedback.type === 'success' ? '#166534' : '#991b1b',
            }}
          >
            {feedback.type === 'success' ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
            <span>{feedback.message}</span>
          </div>
        )}
      </div>

      {/* بطاقة 0: أنماط ووسائل الشحن المعتمدة للمنشأة */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <AppIcons.Sliders size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s10', "أنماط ووسائل الشحن المعتمدة للمنشأة")}
            <span className="desktop-only-inline"> (Active Transport Modes)</span>
          </span>
        </div>
        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 16px 0' }}>
          {t('maritime_freight.maritime_pipeline_settings_tab.s11', "تحديد خدمات وأنماط الشحن التي تقدمها منشأتكم؛ إيقاف أي نمط يُخفيه تلقائياً من نماذج طلبات الشحن وعروض الأسعار والدليل القياسي لتفادي أي تشتيت لموظفيكم.")}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          {/* 1. بحري */}
          <div
            onClick={() => {
              if (config.enableSeaFreight !== false && !config.enableAirFreight && !config.enableRoadFreight) {
                toast.warning(t('maritime_freight.maritime_pipeline_settings_tab.s12', "يجب الإبقاء على نمط شحن واحد على الأقل مفعلاً"));
                return;
              }
              setConfig({ ...config, enableSeaFreight: config.enableSeaFreight === false });
            }}
            style={{
              border: config.enableSeaFreight !== false ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '16px',
              background: config.enableSeaFreight !== false ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: config.enableSeaFreight !== false ? '#eff6ff' : '#f1f5f9', color: config.enableSeaFreight !== false ? '#170e5e' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcons.Ship size={16} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s13', "الشحن البحري")}
                  <span className="desktop-only-inline"> (Ocean Freight)</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.enableSeaFreight !== false}
                onChange={() => {}}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
              {t('maritime_freight.maritime_pipeline_settings_tab.s14', "خطوط الملاحة البحرية، تتبع الحاويات (FCL / LCL)، الموانئ البحرية، وشروط الـ Incoterms البحرية.")}
            </div>
          </div>

          {/* 2. جوي */}
          <div
            onClick={() => {
              if (!config.enableSeaFreight && config.enableAirFreight && !config.enableRoadFreight) {
                toast.warning(t('maritime_freight.maritime_pipeline_settings_tab.s15', "يجب الإبقاء على نمط شحن واحد على الأقل مفعلاً"));
                return;
              }
              setConfig({ ...config, enableAirFreight: !config.enableAirFreight });
            }}
            style={{
              border: config.enableAirFreight ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '16px',
              background: config.enableAirFreight ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: config.enableAirFreight ? '#eff6ff' : '#f1f5f9', color: config.enableAirFreight ? '#170e5e' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcons.Plane size={16} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s16', "الشحن الجوي")}
                  <span className="desktop-only-inline"> (Air Freight)</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={!!config.enableAirFreight}
                onChange={() => {}}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
              {t('maritime_freight.maritime_pipeline_settings_tab.s17', "مطارات الشحن الدولية، شركات الطيران، بوالص الشحن الجوي AWB، وحساب الوزن الحجمي IATA.")}
            </div>
          </div>

          {/* 3. بري */}
          <div
            onClick={() => {
              if (!config.enableSeaFreight && !config.enableAirFreight && config.enableRoadFreight) {
                toast.warning(t('maritime_freight.maritime_pipeline_settings_tab.s18', "يجب الإبقاء على نمط شحن واحد على الأقل مفعلاً"));
                return;
              }
              setConfig({ ...config, enableRoadFreight: !config.enableRoadFreight });
            }}
            style={{
              border: config.enableRoadFreight ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '16px',
              background: config.enableRoadFreight ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: config.enableRoadFreight ? '#eff6ff' : '#f1f5f9', color: config.enableRoadFreight ? '#170e5e' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcons.Truck size={16} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s19', "الشحن البري")}
                  <span className="desktop-only-inline"> (Road Freight)</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={!!config.enableRoadFreight}
                onChange={() => {}}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
              />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
              {t('maritime_freight.maritime_pipeline_settings_tab.s20', "شاحنات النقل البري (FTL / LTL)، المنافذ والمحطات البرية، وبوالص النقل الداخلي والدولي.")}
            </div>
          </div>
        </div>
      </div>

      {/* بطاقة 1: النمط التشغيلي العام للمنظومة */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <ShieldCheckIcon size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s21', "1. النمط التشغيلي العام للمنشأة")}
            <span className="desktop-only-inline"> (Master Automation Mode)</span>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          {[
            {
              id: 'full_autonomous',
              title: (
                <span>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s22', "أتمتة كاملة ذاتية")}
                  <span className="desktop-only-inline"> (Full Zero-Touch)</span>
                </span>
              ),
              desc: t('maritime_freight.maritime_pipeline_settings_tab.s23', "الدورة تدور ذاتياً بنسبة 100%: جمع العروض، فرز أفضل قيمة، تطبيق الهامش الافتراضي، وإصدار وإرسال العرض للعميل دون أي تدخل يدوي."),
              badge: t('maritime_freight.maritime_pipeline_settings_tab.s24', "أقصى سرعة"),
              badgeBg: '#f1f5f9',
              badgeColor: '#334155',
            },
            {
              id: 'hybrid',
              title: (
                <span>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s25', "هجين ذكي")}
                  <span className="desktop-only-inline"> (Smart Hybrid)</span>
                </span>
              ),
              desc: t('maritime_freight.maritime_pipeline_settings_tab.s26', "السستم يجمع العروض ويرتبها آلياً، لكنه يقف عند محطة اعتماد الهامش أو مراجعة العرض النهائي لإعطاء الموظف القرار الأخير."),
              badge: t('maritime_freight.maritime_pipeline_settings_tab.s27', "الموصى به"),
              badgeBg: '#eff6ff',
              badgeColor: '#170e5e',
            },
            {
              id: 'manual',
              title: (
                <span>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s28', "تحكم يدوي كلاسيكي")}
                  <span className="desktop-only-inline"> (Manual Control)</span>
                </span>
              ),
              desc: t('maritime_freight.maritime_pipeline_settings_tab.s29', "إيقاف الأتمتة الذاتية بالكامل، وتتطلب كل خطوة ضغطات يدوية منفصلة من موظف العمليات والمبيعات."),
              badge: t('maritime_freight.maritime_pipeline_settings_tab.s30', "تقليدي"),
              badgeBg: '#f1f5f9',
              badgeColor: '#64748b',
            },
          ].map((mode) => {
            const isSelected = config.automationMode === mode.id;
            return (
              <div
                key={mode.id}
                onClick={() => {
                  if (mode.id === 'full_autonomous') {
                    setConfig({
                      ...config,
                      automationMode: 'full_autonomous',
                      requireManualAwardAndMargin: false,
                      requireManualQuoteDispatch: false,
                    });
                  } else if (mode.id === 'hybrid') {
                    setConfig({
                      ...config,
                      automationMode: 'hybrid',
                      requireManualAwardAndMargin: true,
                    });
                  } else {
                    setConfig({
                      ...config,
                      automationMode: 'manual',
                      requireManualAwardAndMargin: true,
                      requireManualQuoteDispatch: true,
                    });
                  }
                }}
                style={{
                  border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '16px',
                  background: isSelected ? '#f8fafc' : '#ffffff',
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: isSelected ? '#170e5e' : '#1e293b' }}>
                    {mode.title}
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: isSelected ? '#170e5e' : mode.badgeBg, color: isSelected ? '#ffffff' : mode.badgeColor }}>
                    {mode.badge}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                  {mode.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* بطاقة 2: قواعد هامش الربح الآلي */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <TrendingUpIcon size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s31', "2. قواعد هامش الربح الآلي")}
            <span className="desktop-only-inline"> (Autonomous Margin & Markup Engine)</span>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <Field label={t('maritime_freight.maritime_pipeline_settings_tab.s32', "نوع الهامش الافتراضي المطبق آلياً *")}>
            <CustomSelect
              value={config.defaultMarginType}
              onChange={(val) => setConfig({ ...config, defaultMarginType: (val || 'fixed') as any })}
              options={[
                { value: 'fixed', label: t('maritime_freight.maritime_pipeline_settings_tab.s33', "مبلغ مقطوع ثابت لكل حاوية ($ Fixed per Container)") },
                { value: 'percentage', label: t('maritime_freight.maritime_pipeline_settings_tab.s34', "نسبة مئوية مضافة من النولون (% Markup Rate)") },
              ]}
            />
          </Field>

          <Field label={config.defaultMarginType === 'fixed' ? t('maritime_freight.maritime_pipeline_settings_tab.s35', "قيمة الربح الثابت للحاوية ($ USD) *") : t('maritime_freight.maritime_pipeline_settings_tab.s36', "نسبة الربح المئوية المضافة (%) *")}>
            <input
              type="number"
              min={1}
              value={config.defaultMarginValue}
              onChange={(e) => setConfig({ ...config, defaultMarginValue: parseFloat(e.target.value) || 0 })}
              style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '0.85rem' }}
            />
          </Field>

          <Field label={(
            <span>
              {t('maritime_freight.maritime_pipeline_settings_tab.s37', "الحد الأدنى للأمان الربحي للحاوية")}
              <span className="desktop-only-inline"> ($ Margin Floor)</span> *
            </span>
          )}>
            <input
              type="number"
              min={0}
              value={config.marginFloor}
              onChange={(e) => setConfig({ ...config, marginFloor: parseFloat(e.target.value) || 0 })}
              style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '0.85rem' }}
            />
          </Field>

          <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#475569', alignSelf: 'end' }}>
            <strong>{t('maritime_freight.maritime_pipeline_settings_tab.exchange_rate_note_title', "سعر الصرف للعروض الآلية:")}</strong>{' '}
            {t('maritime_freight.maritime_pipeline_settings_tab.exchange_rate_note', "يُحلّ تلقائياً من سعر الصرف الحي المسجل في النظام عبر المحلل المشترك؛ لا يوجد سعر افتراضي ثابت، وإذا لم يكن السعر مسجلاً لا يصدر عرض آلي لذلك الطلب.")}
          </div>
        </div>

        <div style={{ marginTop: '12px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#475569' }}>
          <strong>{t('maritime_freight.maritime_pipeline_settings_tab.s39', "معادلة التسعير الآلية:")}</strong> {t('maritime_freight.maritime_pipeline_settings_tab.s40', "إذا جاء أفضل عرض نولون بحري بـ")} <strong>$1,800</strong>{t('maritime_freight.maritime_pipeline_settings_tab.s41', "، سيتم تطبيق هامش")} {config.defaultMarginType === 'fixed' ? `$${config.defaultMarginValue}` : `${config.defaultMarginValue}%`} {t('maritime_freight.maritime_pipeline_settings_tab.s42', "ليصبح السعر النهائي المعروض للعميل هو")} <strong>${config.defaultMarginType === 'fixed' ? (1800 + config.defaultMarginValue).toLocaleString() : (1800 * (1 + config.defaultMarginValue / 100)).toLocaleString()}</strong> {t('maritime_freight.maritime_pipeline_settings_tab.s43', "(مع ضمان ألا يقل صافي ربحكم عن $")}{config.marginFloor}$).
        </div>
      </div>

      {/* بطاقة 3: مؤقت مهل عروض الأسعار والترسية المبكرة */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <ClockIcon size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s44', "3. مؤقت مهل عروض الأسعار وقواعد الترسية المبكرة")}
            <span className="desktop-only-inline"> (Cut-off & Early Awarding)</span>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          <Field label={t('maritime_freight.maritime_pipeline_settings_tab.s45', "مهلة انتظار عروض الشحنات العادية (بالساعات) *")}>
            <input
              type="number"
              min={1}
              max={168}
              value={config.rfqCutOffHoursStandard}
              onChange={(e) => setConfig({ ...config, rfqCutOffHoursStandard: parseInt(e.target.value, 10) || 24 })}
              style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '0.85rem' }}
            />
          </Field>

          <Field label={t('maritime_freight.maritime_pipeline_settings_tab.s46', "مهلة انتظار عروض الشحنات العاجلة Spot (بالساعات) *")}>
            <input
              type="number"
              min={1}
              max={48}
              value={config.rfqCutOffHoursUrgent}
              onChange={(e) => setConfig({ ...config, rfqCutOffHoursUrgent: parseInt(e.target.value, 10) || 6 })}
              style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '0.85rem' }}
            />
          </Field>

          <Field label={t('maritime_freight.maritime_pipeline_settings_tab.s47', "الحد الأدنى لأيام السماح للترسية المبكرة (أيام)")}>
            <input
              type="number"
              min={7}
              max={45}
              value={config.earlyAwardingMinFreeDays}
              onChange={(e) => setConfig({ ...config, earlyAwardingMinFreeDays: parseInt(e.target.value, 10) || 14 })}
              style={{ width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '0.85rem' }}
            />
          </Field>
        </div>

        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <input
            type="checkbox"
            id="earlyAwardingToggle"
            checked={config.earlyAwardingEnabled}
            onChange={(e) => setConfig({ ...config, earlyAwardingEnabled: e.target.checked })}
            style={{ width: '18px', height: '18px', flexShrink: 0, marginTop: '2px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          <label htmlFor="earlyAwardingToggle" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', cursor: 'pointer', flex: 1, minWidth: 0, lineHeight: 1.5 }}>
            {t('maritime_freight.maritime_pipeline_settings_tab.s48', "تفعيل ميزة الترسية الفورية المبكرة")}
            <span className="desktop-only-inline"> (Early Awarding)</span>{t('maritime_freight.maritime_pipeline_settings_tab.s49', ": في حال ورد عرض سعر من خط ملاحي يحقق سقف السعر المستهدف للعميل مع أيام سماح لا تقل عن")} {config.earlyAwardingMinFreeDays} {t('maritime_freight.maritime_pipeline_settings_tab.s50', "يوماً، تتم الترسية فوراً دون انتظار انقضاء ساعات التايمر.")}
          </label>
        </div>
      </div>

      {/* بطاقة 4: محطات التوقف والمراجعة البشرية */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <UsersIcon size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s51', "4. محطات التوقف والمراجعة البشرية")}
            <span className="desktop-only-inline"> (Human-in-the-Loop Checkpoints)</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label
            className="pipeline-checkpoint-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: config.requireManualRfqDispatch ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              background: config.requireManualRfqDispatch ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b' }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s52', "المحطة 1: مراجعة طلب الـ RFQ يدوياً قبل الإرسال للخطوط الملاحية")}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', lineHeight: 1.45 }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s53', "عند التفعيل: يحفظ طلب التسعير كـ مسودة (Draft) ولا يرسل للخطوط الملاحية إلا بعد مراجعة الموظف والضغط على زر الإرسال.")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.requireManualRfqDispatch}
              onChange={(e) => setConfig({ ...config, requireManualRfqDispatch: e.target.checked })}
              style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: '#170e5e', cursor: 'pointer' }}
            />
          </label>

          <label
            className="pipeline-checkpoint-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: config.requireManualAwardAndMargin ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              background: config.requireManualAwardAndMargin ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b' }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s54', "المحطة 2: التوقف لمراجعة أفضل عرض واعتماد الهامش يدوياً")}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', lineHeight: 1.45 }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s55', "عند التفعيل: عند اكتمال العروض أو انتهاء المهلة، لا يتم إصدار العرض آلياً، بل يُرسل إشعار للموظف ليفتح تبويب المصفوفة ويضغط \"اعتماد السعر وتحديد الهامش\".")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.requireManualAwardAndMargin}
              onChange={(e) => setConfig({ ...config, requireManualAwardAndMargin: e.target.checked })}
              style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: '#170e5e', cursor: 'pointer' }}
            />
          </label>

          <label
            className="pipeline-checkpoint-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: config.requireManualQuoteDispatch ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              background: config.requireManualQuoteDispatch ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b' }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s56', "المحطة 3: مراجعة عرض السعر النهائي قبل إرساله للعميل")}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', lineHeight: 1.45 }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s57', "عند التفعيل: يصدر العرض بحالة \"مسودة (Draft Quote)\" ولا يتم إرساله لواتساب أو إيميل العميل إلا بعد موافقة مدير المبيعات.")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.requireManualQuoteDispatch}
              onChange={(e) => setConfig({ ...config, requireManualQuoteDispatch: e.target.checked })}
              style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: '#170e5e', cursor: 'pointer' }}
            />
          </label>
        </div>
      </div>

      {/* بطاقة 5: قنوات الإرسال المباشر للعميل */}
      <div className="pipeline-settings-card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#170e5e', fontWeight: 700, fontSize: '0.92rem' }}>
          <SendIcon size={18} />
          <span>
            {t('maritime_freight.maritime_pipeline_settings_tab.s58', "5. قنوات الإرسال التلقائي للعميل")}
            <span className="desktop-only-inline"> (Instant Client Quotation Dispatch)</span>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          <label
            className="pipeline-channel-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              borderRadius: '8px',
              border: config.autoSendWhatsAppQuote ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              background: config.autoSendWhatsAppQuote ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={config.autoSendWhatsAppQuote}
              onChange={(e) => setConfig({ ...config, autoSendWhatsAppQuote: e.target.checked })}
              style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: '#170e5e', cursor: 'pointer' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <MessageSquareIcon size={16} style={{ color: '#170e5e', flexShrink: 0 }} />
                <span>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s59', "إرسال العرض فورياً بالواتساب")}
                  <span className="desktop-only-inline"> (WhatsApp Gateway)</span>
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px', lineHeight: 1.45 }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s60', "إرسال ملخص تفاصيل الشحنة والسعر الإجمالي وفترة السماح لرقم هاتف العميل فور توليد العرض.")}
              </div>
            </div>
          </label>

          <label
            className="pipeline-channel-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              borderRadius: '8px',
              border: config.autoSendEmailQuote ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              background: config.autoSendEmailQuote ? '#f8fafc' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={config.autoSendEmailQuote}
              onChange={(e) => setConfig({ ...config, autoSendEmailQuote: e.target.checked })}
              style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: '#170e5e', cursor: 'pointer' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <MailIcon size={16} style={{ color: '#170e5e', flexShrink: 0 }} />
                <span>
                  {t('maritime_freight.maritime_pipeline_settings_tab.s61', "إرسال العرض فورياً بالبريد الإلكتروني")}
                  <span className="desktop-only-inline"> (Email Quote Dispatch)</span>
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px', lineHeight: 1.45 }}>
                {t('maritime_freight.maritime_pipeline_settings_tab.s62', "إرسال ملف PDF رسمي لعرض السعر إلى إيميل العميل المسجل.")}
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
