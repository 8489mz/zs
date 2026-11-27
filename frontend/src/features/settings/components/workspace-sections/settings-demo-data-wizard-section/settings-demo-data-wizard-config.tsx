import { Button } from '@/shared/ui/button';
import { ShieldCheckIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type {type DemoDataStatusResponse, type DemoActivitySummary} from '@/features/settings/api/demo-data.api';

export interface SettingsDemoDataWizardConfigProps {
  t: ReturnType<typeof useTranslation>['t'];
  isPlatform: boolean;
  wipeExisting: boolean;
  setWipeExisting: React.Dispatch<React.SetStateAction<boolean>>;
  seedSales: boolean;
  setSeedSales: React.Dispatch<React.SetStateAction<boolean>>;
  seedOnlineOrders: boolean;
  setSeedOnlineOrders: React.Dispatch<React.SetStateAction<boolean>>;
  status: DemoDataStatusResponse | undefined;
  selectedActivity: DemoActivitySummary;
  selectedActivityKey: string;
  seedMutation: { isPending: boolean };
  handleStartSeed: () => void;
  errorMessage: string | null;
}

export function SettingsDemoDataWizardConfig(props: SettingsDemoDataWizardConfigProps) {
  const { t, isPlatform, wipeExisting, setWipeExisting, seedSales, setSeedSales, seedOnlineOrders, setSeedOnlineOrders, status, selectedActivity, selectedActivityKey, seedMutation, handleStartSeed, errorMessage } = props;
  return (
    <>
    {/* ─── Configuration Options & Start Action ───────────────────────────────── */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '22px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
        {t('settings.workspace_sections.settings_demo_data_wizard_section.s15', "2. خيارات التجهيز السريع:")}
      </h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '14px',
        }}
      >
        {/* Option: Wipe Existing (Super Admin only) */}
        {isPlatform && (
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              background: wipeExisting ? '#fef2f2' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={wipeExisting}
              onChange={(e) => setWipeExisting(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#dc2626', width: '16px', height: '16px' }}
            />
            <div>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#991b1b' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s16', "تصفير البيانات السابقة واستبدالها بنظافة (صلاحية السوبر أدمن)")}
              </span>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s17', "يتطلب إدخال كلمة مرور السوبر أدمن لتأكيد تفريغ كافة البيانات القديمة للنسخة.")}
              </p>
            </div>
          </label>
        )}

        {/* Option: Historical Sales */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            background: seedSales ? '#f8fafc' : '#ffffff',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={seedSales}
            onChange={(e) => setSeedSales(e.target.checked)}
            style={{ marginTop: '3px', accentColor: '#170e5e', width: '16px', height: '16px' }}
          />
          <div>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s18', "توليد فواتير مبيعات سابقة (موزعة على 6 أشهر)")}
            </span>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s19', "يملأ الداشبورد والرسوم البيانية وحركات الكاشير بحوالي 100 فاتورة واقعية مع هوامش ربح متزنة.")}
            </p>
          </div>
        </label>

        {/* Option: Online Orders */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            background: seedOnlineOrders ? '#f8fafc' : '#ffffff',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={seedOnlineOrders}
            onChange={(e) => setSeedOnlineOrders(e.target.checked)}
            style={{ marginTop: '3px', accentColor: '#170e5e', width: '16px', height: '16px' }}
          />
          <div>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s20', "توليد طلبات متجر إلكتروني سحابية")}
            </span>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s21', "يضيف 4-5 طلبات متجر بحالات مختلفة (قيد التجهيز، شحن، تسليم) لتجربة بوابة الشحن والطلبات.")}
            </p>
          </div>
        </label>
      </div>

      {/* Primary Action Button or Active Store Notice */}
      {!isPlatform && status && !status.isEmpty ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            marginTop: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#eff6ff', color: '#170e5e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheckIcon size={20} />
            </div>
            <div>
              <strong style={{ fontSize: '0.92rem', color: '#0f172a', display: 'block' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s22', "المتجر قيد التشغيل الفعلي ويحتوي على بيانات مسجلة (")}{status.productCount} {t('settings.workspace_sections.settings_demo_data_wizard_section.s23', "صنف و")} {status.saleCount} {t('settings.workspace_sections.settings_demo_data_wizard_section.s24', "فاتورة)")}
              </strong>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s25', "لحماية بيانات متجرك من التداخل، تم قفل استيراد البيانات التجريبية. لتصفير المتجر وإعادته فارغاً للبدء الفعلي، يرجى التواصل مع إدارة المنصة (السوبر أدمن).")}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px',
            borderTop: '1px solid #f1f5f9',
            paddingTop: '18px',
          }}
        >
          <div style={{ fontSize: '0.86rem', color: '#475569' }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s26', "النشاط المحدد:")} <strong style={{ color: '#170e5e' }}>{selectedActivity?.name || selectedActivityKey}</strong> ({(selectedActivity?.productCount ?? selectedActivity?.productsCount ?? 0)} {t('settings.workspace_sections.settings_demo_data_wizard_section.s27', "صنفاً)")}
          </div>

          <Button
            type="button"
            disabled={seedMutation.isPending}
            onClick={handleStartSeed}
            style={{
              background: '#170e5e',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.96rem',
              padding: '12px 28px',
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 4px 14px rgba(23, 14, 94, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            {seedMutation.isPending ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCwIcon size={16} className="animate-spin" />
                <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s28', "جاري ملء النظام بالبيانات (5 ثوانٍ)...")}</span>
              </span>
            ) : (
              <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s29', "استيراد بيانات النشاط فورياً بنقرة واحدة")}</span>
            )}
          </Button>
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            background: '#fff1f2',
            color: '#be123c',
            border: '1px solid #fecdd3',
            borderRadius: '10px',
            padding: '10px 16px',
            fontSize: '0.85rem',
            fontWeight: 700,
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
    </>
  );
}
