/* SettingsMarketplacesSection slice S1 — platform configs (Amazon / Noon / Jumia / Trendyol).
   Pure move from SettingsMarketplacesSection.tsx (HEAD 6886dc599): hook + 4 tab components,
   byte-identical except import lines, the local `t`, and props. */

import { useTranslation } from 'react-i18next';
import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  AmazonConfig,
  NoonConfig,
  JumiaConfig,
  TrendyolConfig,
  SupportedMarketplace,
} from '@/features/storefront/api/marketplace-sync.api';

export function useMarketplaceConfigs() {

  // Config States
  const [amazonCfg, setAmazonCfg] = useState<AmazonConfig>({
    enabled: false,
    sellerId: '',
    refreshToken: '',
    clientId: '',
    clientSecret: '',
    marketplaceId: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'fbm',
  });

  const [noonCfg, setNoonCfg] = useState<NoonConfig>({
    enabled: false,
    merchantId: '',
    apiKey: '',
    appSecret: '',
    marketplace: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'direct',
  });

  const [jumiaCfg, setJumiaCfg] = useState<JumiaConfig>({
    enabled: false,
    sellerEmail: '',
    apiKey: '',
    marketplace: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'dropshipping',
  });

  const [trendyolCfg, setTrendyolCfg] = useState<TrendyolConfig>({
    enabled: false,
    supplierId: '',
    apiKey: '',
    apiSecret: '',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'merchant_cargo',
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string; pingMs?: number; accountName?: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Queries
  const configQuery = useQuery({
    queryKey: ['marketplace-all-config'],
    queryFn: marketplaceSyncApi.getConfig,
  });

  useEffect(() => {
    if (configQuery.data) {
      if (configQuery.data.amazon) setAmazonCfg(configQuery.data.amazon);
      if (configQuery.data.noon) setNoonCfg(configQuery.data.noon);
      if (configQuery.data.jumia) setJumiaCfg(configQuery.data.jumia);
      if (configQuery.data.trendyol) setTrendyolCfg(configQuery.data.trendyol);
    }
  }, [configQuery.data]);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: (data: {
      amazon?: Partial<AmazonConfig>;
      noon?: Partial<NoonConfig>;
      jumia?: Partial<JumiaConfig>;
      trendyol?: Partial<TrendyolConfig>;
    }) => marketplaceSyncApi.saveConfig(data),
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      configQuery.refetch();
      toast.success('تم حفظ إعدادات منصات الماركت بليس بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ الإعدادات'),
  });

  const testMutation = useMutation({
    mutationFn: (marketplace: SupportedMarketplace) => marketplaceSyncApi.testConnection(marketplace),
    onSuccess: (res) => setTestResult(res),
    onError: (err: any) => setTestResult({ success: false, message: err?.message || 'تعذر الاتصال بالمنصة' }),
  });

  return {
    amazonCfg,
    setAmazonCfg,
    noonCfg,
    setNoonCfg,
    jumiaCfg,
    setJumiaCfg,
    trendyolCfg,
    setTrendyolCfg,
    testResult,
    setTestResult,
    saveSuccess,
    saveMutation,
    testMutation,
  };
}

{/* ========================================================================= */}
{/* TAB 5: AMAZON CONFIG */}
{/* ========================================================================= */}
export interface AmazonConfigTabProps {
  amazonCfg: AmazonConfig;
  setAmazonCfg: Dispatch<SetStateAction<AmazonConfig>>;
  saveMutation: ReturnType<typeof useMarketplaceConfigs>['saveMutation'];
  testMutation: ReturnType<typeof useMarketplaceConfigs>['testMutation'];
  saveSuccess: boolean;
}

export function AmazonConfigTab({ amazonCfg, setAmazonCfg, saveMutation, testMutation, saveSuccess }: AmazonConfigTabProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s352', "إعدادات الربط مع متجر أمازون (Amazon Selling Partner API)")}
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s353', "اربط حساب البائع الخاص بك على أمازون لمزامنة الكميات وسحب الطلبات تلقائياً.")}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
          <input
            type="checkbox"
            checked={amazonCfg.enabled}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, enabled: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s354', "تفعيل قناة أمازون")}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s355', "معرّف البائع (Seller ID / Merchant ID) *")}
          </label>
          <input
            type="text"
            value={amazonCfg.sellerId}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, sellerId: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s356', "مثال: A2XXXXXX5678")}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s357', "سوق أمازون المستهدف")}
          </label>
          <select
            value={amazonCfg.marketplaceId}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, marketplaceId: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s358', "أمازون مصر (Amazon.eg - EGP)")}</option>
            <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s359', "أمازون السعودية (Amazon.sa - SAR)")}</option>
            <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s360', "أمازون الإمارات (Amazon.ae - AED)")}</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s361', "رمز التحديث السحابي (LWA Refresh Token)")}
          </label>
          <input
            type="password"
            value={amazonCfg.refreshToken}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, refreshToken: e.target.value })}
            placeholder="Atzr|IQEBLz4k6..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s362', "نمط الشحن والتجهيز")}
          </label>
          <select
            value={amazonCfg.fulfillmentType}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, fulfillmentType: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="fbm">{t('settings.workspace_sections.settings_marketplaces_section.s363', "FBM (شحن وتجهيز من مخزن التاجر الخاص)")}</option>
            <option value="fba">{t('settings.workspace_sections.settings_marketplaces_section.s364', "FBA (الشحن عبر مستودعات أمازون الرسمية)")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', background: '#f8fafc', padding: '14px', borderRadius: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={amazonCfg.autoSyncStock}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, autoSyncStock: e.target.checked })}
            style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s365', "تحديث المخزون فورياً على أمازون عند حدوث بيع محلي")}
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={amazonCfg.autoPullOrders}
            onChange={(e) => setAmazonCfg({ ...amazonCfg, autoPullOrders: e.target.checked })}
            style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s366', "سحب الطلبات تلقائياً وحجز الأصناف من المخزن")}
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button variant="secondary" onClick={() => testMutation.mutate('amazon')} disabled={testMutation.isPending}>
          {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s367', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s368', "فحص واختبار الاتصال")}
        </Button>
        <SubmitButton
          type="button"
          onClick={() => saveMutation.mutate({ amazon: amazonCfg })}
          isPending={saveMutation.isPending}
          isSuccess={saveSuccess}
          idleText={t('settings.workspace_sections.settings_marketplaces_section.s370', "حفظ إعدادات أمازون")}
          pendingText={t('settings.workspace_sections.settings_marketplaces_section.s369', "جاري الحفظ...")}
          successText="تم حفظ إعدادات أمازون بنجاح!"
          style={{ background: '#170e5e', color: '#ffffff' }}
        />
      </div>
    </div>
  );
}

{/* ========================================================================= */}
{/* TAB 6: NOON CONFIG */}
{/* ========================================================================= */}
export interface NoonConfigTabProps {
  noonCfg: NoonConfig;
  setNoonCfg: Dispatch<SetStateAction<NoonConfig>>;
  saveMutation: ReturnType<typeof useMarketplaceConfigs>['saveMutation'];
  testMutation: ReturnType<typeof useMarketplaceConfigs>['testMutation'];
  saveSuccess: boolean;
}

export function NoonConfigTab({ noonCfg, setNoonCfg, saveMutation, testMutation, saveSuccess }: NoonConfigTabProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s371', "إعدادات الربط مع متجر نون (Noon Marketplace API)")}
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s372', "اربط حساب شريك نون (Noon Partner) لمزامنة الكميات والأسعار وسحب طلبيات نون ديركت.")}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
          <input
            type="checkbox"
            checked={noonCfg.enabled}
            onChange={(e) => setNoonCfg({ ...noonCfg, enabled: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s373', "تفعيل قناة نون")}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s374', "معرّف التاجر (Noon Partner Identifier) *")}
          </label>
          <input
            type="text"
            value={noonCfg.merchantId}
            onChange={(e) => setNoonCfg({ ...noonCfg, merchantId: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s375', "مثال: noon_partner_1234")}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s376', "دولة متجر نون")}
          </label>
          <select
            value={noonCfg.marketplace}
            onChange={(e) => setNoonCfg({ ...noonCfg, marketplace: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s377', "نون مصر (Noon Egypt - EGP)")}</option>
            <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s378', "نون السعودية (Noon KSA - SAR)")}</option>
            <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s379', "نون الإمارات (Noon UAE - AED)")}</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s380', "مفتاح الواجهة (API Key)")}
          </label>
          <input
            type="password"
            value={noonCfg.apiKey}
            onChange={(e) => setNoonCfg({ ...noonCfg, apiKey: e.target.value })}
            placeholder="key_live_noon_..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s381', "نمط البيع (Fulfillment Model)")}
          </label>
          <select
            value={noonCfg.fulfillmentType}
            onChange={(e) => setNoonCfg({ ...noonCfg, fulfillmentType: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="direct">{t('settings.workspace_sections.settings_marketplaces_section.s382', "Noon Direct / Cross-dock (الشحن من مستودعك الخاص)")}</option>
            <option value="fbn">{t('settings.workspace_sections.settings_marketplaces_section.s383', "FBN (الشحن عبر مستودعات Fulfilled by Noon)")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', background: '#f8fafc', padding: '14px', borderRadius: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={noonCfg.autoSyncStock}
            onChange={(e) => setNoonCfg({ ...noonCfg, autoSyncStock: e.target.checked })}
            style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s384', "تحديث المخزون فورياً على نون عند أي حركة بيع")}
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={noonCfg.autoPullOrders}
            onChange={(e) => setNoonCfg({ ...noonCfg, autoPullOrders: e.target.checked })}
            style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s385', "سحب وتأكيد طلبيات نون وحجزها في النظام آلياً")}
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button variant="secondary" onClick={() => testMutation.mutate('noon')} disabled={testMutation.isPending}>
          {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s386', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s387', "فحص واختبار الاتصال")}
        </Button>
        <SubmitButton
          type="button"
          onClick={() => saveMutation.mutate({ noon: noonCfg })}
          isPending={saveMutation.isPending}
          isSuccess={saveSuccess}
          idleText={t('settings.workspace_sections.settings_marketplaces_section.s389', "حفظ إعدادات نون")}
          pendingText={t('settings.workspace_sections.settings_marketplaces_section.s388', "جاري الحفظ...")}
          successText="تم حفظ إعدادات نون بنجاح!"
          style={{ background: '#170e5e', color: '#ffffff' }}
        />
      </div>
    </div>
  );
}

{/* ========================================================================= */}
{/* TAB 7: JUMIA CONFIG */}
{/* ========================================================================= */}
export interface JumiaConfigTabProps {
  jumiaCfg: JumiaConfig;
  setJumiaCfg: Dispatch<SetStateAction<JumiaConfig>>;
  saveMutation: ReturnType<typeof useMarketplaceConfigs>['saveMutation'];
  testMutation: ReturnType<typeof useMarketplaceConfigs>['testMutation'];
  saveSuccess: boolean;
}

export function JumiaConfigTab({ jumiaCfg, setJumiaCfg, saveMutation, testMutation, saveSuccess }: JumiaConfigTabProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s390', "إعدادات الربط مع متجر جوميا (Jumia Seller Center API)")}
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s391', "ربط حساب البائع في جوميا لمزامنة كميات المستودع وتأكيد الشحنات وسحب الطلبات.")}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
          <input
            type="checkbox"
            checked={jumiaCfg.enabled}
            onChange={(e) => setJumiaCfg({ ...jumiaCfg, enabled: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s392', "تفعيل قناة جوميا")}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s393', "البريد الإلكتروني لحساب البائع (Seller Email) *")}
          </label>
          <input
            type="email"
            value={jumiaCfg.sellerEmail}
            onChange={(e) => setJumiaCfg({ ...jumiaCfg, sellerEmail: e.target.value })}
            placeholder="vendor@company.com"
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s394', "سوق جوميا")}
          </label>
          <select
            value={jumiaCfg.marketplace}
            onChange={(e) => setJumiaCfg({ ...jumiaCfg, marketplace: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s395', "جوميا مصر (Jumia Egypt - EGP)")}</option>
            <option value="ng">{t('settings.workspace_sections.settings_marketplaces_section.s396', "جوميا نيجيريا (Jumia Nigeria - NGN)")}</option>
            <option value="ke">{t('settings.workspace_sections.settings_marketplaces_section.s397', "جوميا كينيا (Jumia Kenya - KES)")}</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s398', "مفتاح API الخاص بجوميا")}
          </label>
          <input
            type="password"
            value={jumiaCfg.apiKey}
            onChange={(e) => setJumiaCfg({ ...jumiaCfg, apiKey: e.target.value })}
            placeholder="jumia_api_key_..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s399', "نمط الشحن")}
          </label>
          <select
            value={jumiaCfg.fulfillmentType}
            onChange={(e) => setJumiaCfg({ ...jumiaCfg, fulfillmentType: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="dropshipping">{t('settings.workspace_sections.settings_marketplaces_section.s400', "Drop-shipping (الشحن من مستودعك الخاص)")}</option>
            <option value="express">{t('settings.workspace_sections.settings_marketplaces_section.s401', "Jumia Express (مستودعات جوميا الرسمية)")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button variant="secondary" onClick={() => testMutation.mutate('jumia')} disabled={testMutation.isPending}>
          {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s402', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s403', "فحص واختبار الاتصال")}
        </Button>
        <SubmitButton
          type="button"
          onClick={() => saveMutation.mutate({ jumia: jumiaCfg })}
          isPending={saveMutation.isPending}
          isSuccess={saveSuccess}
          idleText={t('settings.workspace_sections.settings_marketplaces_section.s405', "حفظ إعدادات جوميا")}
          pendingText={t('settings.workspace_sections.settings_marketplaces_section.s404', "جاري الحفظ...")}
          successText="تم حفظ إعدادات جوميا بنجاح!"
          style={{ background: '#170e5e', color: '#ffffff' }}
        />
      </div>
    </div>
  );
}

{/* ========================================================================= */}
{/* TAB 8: TRENDYOL CONFIG */}
{/* ========================================================================= */}
export interface TrendyolConfigTabProps {
  trendyolCfg: TrendyolConfig;
  setTrendyolCfg: Dispatch<SetStateAction<TrendyolConfig>>;
  saveMutation: ReturnType<typeof useMarketplaceConfigs>['saveMutation'];
  testMutation: ReturnType<typeof useMarketplaceConfigs>['testMutation'];
  saveSuccess: boolean;
}

export function TrendyolConfigTab({ trendyolCfg, setTrendyolCfg, saveMutation, testMutation, saveSuccess }: TrendyolConfigTabProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s406', "إعدادات الربط مع ترينديول (Trendyol Marketplace API)")}
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s407', "ربط حساب المورّد الخاص بك على ترينديول لمزامنة الأسعار والأرصدة والتوسع في الأسواق الإقليمية.")}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
          <input
            type="checkbox"
            checked={trendyolCfg.enabled}
            onChange={(e) => setTrendyolCfg({ ...trendyolCfg, enabled: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          {t('settings.workspace_sections.settings_marketplaces_section.s408', "تفعيل قناة ترينديول")}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s409', "معرّف المورّد (Supplier ID) *")}
          </label>
          <input
            type="text"
            value={trendyolCfg.supplierId}
            onChange={(e) => setTrendyolCfg({ ...trendyolCfg, supplierId: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s410', "مثال: 123456")}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s411', "مفتاح الواجهة (API Key)")}
          </label>
          <input
            type="password"
            value={trendyolCfg.apiKey}
            onChange={(e) => setTrendyolCfg({ ...trendyolCfg, apiKey: e.target.value })}
            placeholder="trendyol_api_key_..."
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s412', "سر الواجهة (API Secret)")}
          </label>
          <input
            type="password"
            value={trendyolCfg.apiSecret}
            onChange={(e) => setTrendyolCfg({ ...trendyolCfg, apiSecret: e.target.value })}
            placeholder="••••••••"
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s413', "خدمة الشحن (Cargo Provider)")}
          </label>
          <select
            value={trendyolCfg.fulfillmentType}
            onChange={(e) => setTrendyolCfg({ ...trendyolCfg, fulfillmentType: e.target.value as any })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
          >
            <option value="merchant_cargo">{t('settings.workspace_sections.settings_marketplaces_section.s414', "شحن التاجر المباشر (Merchant Cargo)")}</option>
            <option value="trendyol_cargo">{t('settings.workspace_sections.settings_marketplaces_section.s415', "شحن ترينديول الرسمي (Trendyol Cargo)")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button variant="secondary" onClick={() => testMutation.mutate('trendyol')} disabled={testMutation.isPending}>
          {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s416', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s417', "فحص واختبار الاتصال")}
        </Button>
        <SubmitButton
          type="button"
          onClick={() => saveMutation.mutate({ trendyol: trendyolCfg })}
          isPending={saveMutation.isPending}
          isSuccess={saveSuccess}
          idleText={t('settings.workspace_sections.settings_marketplaces_section.s419', "حفظ إعدادات ترينديول")}
          pendingText={t('settings.workspace_sections.settings_marketplaces_section.s418', "جاري الحفظ...")}
          successText="تم حفظ إعدادات ترينديول بنجاح!"
          style={{ background: '#170e5e', color: '#ffffff' }}
        />
      </div>
    </div>
  );
}
