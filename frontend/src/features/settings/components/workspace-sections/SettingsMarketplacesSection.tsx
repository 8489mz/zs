import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import { formatDateTimeArabic } from '@/lib/format';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  MarketplaceOnboardingCheck,
} from '@/features/storefront/api/marketplace-sync.api';
import { productsApi } from '@/features/products';
import {
  CheckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  PackageIcon,
  ShoppingCartIcon,
  RefreshCwIcon,
  ReceiptIcon,
  XIcon,
  PlusIcon,
  CalculatorIcon,
  FileTextIcon,
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  LayersIcon,
  UploadIcon,
  SlidersIcon,
  TruckIcon,
  PrinterIcon,
  CheckShieldIcon,
  CameraIcon,
} from '@/shared/components/icons/AppIcons';
import { EditOnboardingProfileModal } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-onboarding-profile-modal';
import {
  useMarketplaceConfigs,
  AmazonConfigTab,
  NoonConfigTab,
  JumiaConfigTab,
  TrendyolConfigTab,
} from '@/features/settings/components/workspace-sections/marketplaces/marketplace-configs';
import { MarketplaceInventoryTab, useMarketplaceInventory } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-inventory';
import { MarketplaceInboundTab, useMarketplaceInbound } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-inbound';
import { MarketplaceSettlementsTab, ReconcileSettlementModal, useMarketplaceSettlements } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-settlements';
import {
  useMarketplaceAssistants,
  GtinExemptionModal,
  PhotoOptimizerModal,
} from '@/features/settings/components/workspace-sections/marketplaces/marketplace-assistants';
import { MarketplaceOnboardingTab, MarketplaceLoaModal, useMarketplaceOnboarding } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-onboarding';
import { MarketplaceCalculatorTab, MarketplaceOrdersTab, MarketplaceStudioTab, useMarketplaceTools } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-tools';
import { AddSkuMappingModal, BulkMappingImportModal, EditCompetitorPriceModal, RepricingSettingsModal, useMarketplaceMappingModals } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-mapping-modals';
import { CreateInboundShipmentModal, FnskuBarcodeModal, useMarketplaceInboundModals } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-inbound-modals';
import { ReceiveShipmentModal, DiscrepancyClaimReportModal, useMarketplaceInboundReceiving } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-inbound-receiving';

type TabKey = 'onboarding' | 'calculator' | 'studio' | 'inventory' | 'inbound' | 'settlements' | 'orders' | 'analytics' | 'amazon' | 'noon' | 'jumia' | 'trendyol';

export const SettingsMarketplacesSection: React.FC = () => {
  const { t } = useTranslation();
  const settlements = useMarketplaceSettlements();
  const { settlementsQuery } = settlements;
  const inbound = useMarketplaceInbound();
  const { inboundShipmentsQuery } = inbound;
  const receiving = useMarketplaceInboundReceiving(inboundShipmentsQuery);
  const { setReceiveShipmentModal, setReceiveFormItems, loadClaimReportMutation } = receiving;
  const inventory = useMarketplaceInventory();
  const { mappingsQuery, mappings, handleDownloadSampleMappingTemplate } = inventory;
  const tools = useMarketplaceTools({ mappingsQuery });
  const mappingModals = useMarketplaceMappingModals({ mappingsQuery });
  const {
    setShowAddModal,
    setEditPriceModal,
    setEditCompetitorPrice,
    setEditBuyBoxPrice,
    setShowBulkImportModal,
    setEditRepricingModal,
    setRepricingForm,
  } = mappingModals;
  const [activeTab, setActiveTab] = useState<TabKey>('onboarding');
  const onboarding = useMarketplaceOnboarding(activeTab);
  const {
    onboardingQuery,
    showEditOnboardingModal,
    setShowEditOnboardingModal,
    onboardingTargetSection,
    saveOnboardingMutation,
  } = onboarding;

  const {
    amazonCfg, setAmazonCfg, noonCfg, setNoonCfg,
    jumiaCfg, setJumiaCfg, trendyolCfg, setTrendyolCfg,
    testResult, setTestResult, saveSuccess, saveMutation, testMutation,
  } = useMarketplaceConfigs();

  const productsQuery = useQuery({
    queryKey: ['marketplace-products-selector'],
    queryFn: () => productsApi.listPage({ pageSize: 150 }),
  });
  const inboundModals = useMarketplaceInboundModals({ inboundShipmentsQuery });
  const { setShowInboundModal, setPrintFnskuModal } = inboundModals;

  // Analytics State & Query
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'30d' | '7d' | 'all'>('30d');
  const analyticsQuery = useQuery({
    queryKey: ['marketplace-analytics', analyticsPeriod],
    queryFn: () => marketplaceSyncApi.getMarketplaceAnalytics(analyticsPeriod),
    enabled: activeTab === 'analytics',
  });


  const assistants = useMarketplaceAssistants();

  const availableProducts = productsQuery.data?.products || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto' }} dir="rtl">
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s49', "بوابة إدارة ومزامنة التجارة الإلكترونية والماركت بليس (Marketplaces Suite)")}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s50', "الربط السحابي ومزامنة المخزون، وحساب هوامش الأرباح ورسوم المنصات، واستوديو السيو وتتبع الـ Buy Box.")}
          </p>
        </div>

        {saveSuccess ? (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: '#f0fdf4',
              color: '#15803d',
              border: '1px solid #bbf7d0',
              fontSize: '13px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CheckIcon size={14} color="#15803d" strokeWidth={2.5} />
            <span>{t('settings.workspace_sections.settings_marketplaces_section.s51', "تم حفظ الإعدادات بنجاح!")}</span>
          </span>
        ) : null}
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '10px',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => { setActiveTab('onboarding'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'onboarding' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'onboarding' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <CheckShieldIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s52', "معالج فتح وتفعيل الحساب (Onboarding)")}</span>
          {onboardingQuery.data ? (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '9999px',
                background: onboardingQuery.data.overallReadinessScore >= 80 ? '#16a34a' : '#ea580c',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {onboardingQuery.data.overallReadinessScore}%
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('calculator'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'calculator' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'calculator' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <CalculatorIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s53', "حاسبة وهوامش الأرباح والرسوم")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('studio'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'studio' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'studio' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <FileTextIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s54', "استوديو الكتالوج والمحتوى والسيو")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('inventory'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'inventory' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'inventory' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <RefreshCwIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s55', "مطابقة الأكواد وروبوت الأسعار")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'inventory' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'inventory' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {mappings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('inbound'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'inbound' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'inbound' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <TruckIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s56', "توريد مستودعات FBA/FBN")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'inbound' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'inbound' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {inboundShipmentsQuery.data?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('settlements'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'settlements' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'settlements' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ReceiptIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s57', "تسوية كشوف الحسابات والقيود")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'settlements' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'settlements' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {settlementsQuery.data?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('orders'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'orders' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'orders' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ReceiptIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s58', "سحب وحجز الطلبات")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('analytics'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'analytics' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'analytics' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <SlidersIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s59', "تحليلات ومؤشرات الأداء")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('amazon'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'amazon' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'amazon' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <PackageIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s60', "أمازون (SP-API)")}</span>
          {amazonCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('noon'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'noon' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'noon' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ShoppingCartIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s61', "نون (Noon)")}</span>
          {noonCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('jumia'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'jumia' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'jumia' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <GlobeIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s62', "جوميا (Jumia)")}</span>
          {jumiaCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('trendyol'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'trendyol' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'trendyol' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <LayersIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s63', "ترينديول (Trendyol)")}</span>
          {trendyolCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>
      </div>

      {/* Test Result Banner */}
      {testResult ? (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            background: testResult.success ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${testResult.success ? '#bbf7d0' : '#fecaca'}`,
            color: testResult.success ? '#15803d' : '#b91c1c',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13.5px',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {testResult.success ? <CheckIcon size={16} color="#15803d" strokeWidth={2.5} /> : <AlertTriangleIcon size={16} color="#b91c1c" />}
            <span>{testResult.message}</span>
            {testResult.accountName ? <span style={{ marginRight: '8px', opacity: 0.85 }}>({testResult.accountName})</span> : null}
          </div>
          {testResult.pingMs ? <span style={{ fontSize: '11.5px', opacity: 0.8 }}>{t('settings.workspace_sections.settings_marketplaces_section.s64', "زمن الاستجابة:")} {testResult.pingMs}ms</span> : null}
        </div>
      ) : null}

      {activeTab === 'onboarding' ? (
      <MarketplaceOnboardingTab
        onboarding={onboarding}
        setShowGtinModal={assistants.setShowGtinModal}
        setShowPhotoOptimizerModal={assistants.setShowPhotoOptimizerModal}
      />
      ) : null}

      {activeTab === 'calculator' ? (
      <MarketplaceCalculatorTab tools={tools} availableProducts={availableProducts} />
      ) : null}

      {activeTab === 'studio' ? (
      <MarketplaceStudioTab tools={tools} availableProducts={availableProducts} setGtinForm={assistants.setGtinForm} setShowGtinModal={assistants.setShowGtinModal} setShowPhotoOptimizerModal={assistants.setShowPhotoOptimizerModal} />
      ) : null}
      {activeTab === 'inventory' ? (
      <MarketplaceInventoryTab
        inventory={inventory}
        setShowAddModal={setShowAddModal}
        setShowBulkImportModal={setShowBulkImportModal}
        setEditPriceModal={setEditPriceModal}
        setEditCompetitorPrice={setEditCompetitorPrice}
        setEditBuyBoxPrice={setEditBuyBoxPrice}
        setEditRepricingModal={setEditRepricingModal}
        setRepricingForm={setRepricingForm}
        setPrintFnskuModal={setPrintFnskuModal}
      />
      ) : null}
      {activeTab === 'inbound' ? (
      <MarketplaceInboundTab
        inbound={inbound}
        setShowInboundModal={setShowInboundModal}
        setPrintFnskuModal={setPrintFnskuModal}
        setReceiveShipmentModal={setReceiveShipmentModal}
        setReceiveFormItems={setReceiveFormItems}
        loadClaimReportMutation={loadClaimReportMutation}
      />
      ) : null}

      {activeTab === 'settlements' ? (
      <MarketplaceSettlementsTab settlements={settlements} />
      ) : null}

      {activeTab === 'orders' ? (
      <MarketplaceOrdersTab tools={tools} />
      ) : null}

      {activeTab === 'amazon' ? (
        <AmazonConfigTab
          amazonCfg={amazonCfg}
          setAmazonCfg={setAmazonCfg}
          saveMutation={saveMutation}
          testMutation={testMutation}
          saveSuccess={saveSuccess}
        />
      ) : null}

      {activeTab === 'noon' ? (
        <NoonConfigTab
          noonCfg={noonCfg}
          setNoonCfg={setNoonCfg}
          saveMutation={saveMutation}
          testMutation={testMutation}
          saveSuccess={saveSuccess}
        />
      ) : null}

      {activeTab === 'jumia' ? (
        <JumiaConfigTab
          jumiaCfg={jumiaCfg}
          setJumiaCfg={setJumiaCfg}
          saveMutation={saveMutation}
          testMutation={testMutation}
          saveSuccess={saveSuccess}
        />
      ) : null}

      {activeTab === 'trendyol' ? (
        <TrendyolConfigTab
          trendyolCfg={trendyolCfg}
          setTrendyolCfg={setTrendyolCfg}
          saveMutation={saveMutation}
          testMutation={testMutation}
          saveSuccess={saveSuccess}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 9: MARKETPLACE BI & ANALYTICS */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header & Period Selectors */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s420', "تحليلات ومؤشرات أداء الماركت بليس (Marketplace BI & Performance Analytics)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s421', "لوحة ذكاء أعمال حية تقارن حجم المبيعات، العمولات، صافي التحصيلات، ونسب المرتجعات عبر كافة المنصات.")}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('7d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '7d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '7d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '7d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s422', "آخر 7 أيام")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('30d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '30d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '30d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '30d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s423', "آخر 30 يوماً")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('all')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === 'all' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === 'all' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s424', "كامل الفترة")}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => analyticsQuery.refetch()}
                disabled={analyticsQuery.isFetching}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCwIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s425', "تحديث")}
              </Button>
            </div>
          </div>

          {analyticsQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s426', "جاري تجميع مؤشرات الأداء من قنوات البيع وقواعد البيانات...")}
            </div>
          ) : analyticsQuery.data ? (
            <>
              {/* Summary 4-KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s427', "إجمالي المبيعات الإجمالية (Gross Sales)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
                    {analyticsQuery.data.totalGrossSales.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s428', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#10b981', marginTop: '6px', fontWeight: 600 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s429', "عبر")} {analyticsQuery.data.totalOrders} {t('settings.workspace_sections.settings_marketplaces_section.s430', "طلباً مكتمل")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s431', "صافي التحصيلات البنكية (Net Payout)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>
                    {analyticsQuery.data.totalNetPayout.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s432', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s433', "المبالغ المستحقة للتحويل إلى الحسابات البنكية")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s434', "رسوم وعمولات المنصات (Fees & Comm.)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#ea580c' }}>
                    {analyticsQuery.data.totalFees.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s435', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s436', "تمثل")} {analyticsQuery.data.totalGrossSales > 0 ? ((analyticsQuery.data.totalFees / analyticsQuery.data.totalGrossSales) * 100).toFixed(1) : 0}{t('settings.workspace_sections.settings_marketplaces_section.s437', "% من إجمالي المبيعات")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s438', "معدل المرتجعات العام (Blended RTO %)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: (analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0) > 15 ? '#dc2626' : '#2563eb' }}>
                    {(analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s439', "متوسط نسبة الطلبات الملغاة أو المرتجعة")}
                  </div>
                </div>
              </div>

              {/* Channels Breakdown Section */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s440', "مقارنة الأداء والحصص السوقية بين المنصات (Marketplace Share & P&L)")}
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                  {analyticsQuery.data.marketplaceBreakdown.map((m: any) => {
                    const brandColor =
                      m.marketplace === 'amazon' ? '#f97316' :
                      m.marketplace === 'noon' ? '#eab308' :
                      m.marketplace === 'jumia' ? '#0d9488' : '#8b5cf6';
                    const brandBg =
                      m.marketplace === 'amazon' ? '#fff7ed' :
                      m.marketplace === 'noon' ? '#fefce8' :
                      m.marketplace === 'jumia' ? '#f0fdfa' : '#f5f3ff';
                    const brandName =
                      m.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s441', "أمازون (Amazon)") :
                      m.marketplace === 'noon' ? t('settings.workspace_sections.settings_marketplaces_section.s442', "نون (Noon)") :
                      m.marketplace === 'jumia' ? t('settings.workspace_sections.settings_marketplaces_section.s443', "جوميا (Jumia)") : t('settings.workspace_sections.settings_marketplaces_section.s444', "ترينديول (Trendyol)");

                    return (
                      <div
                        key={m.marketplace}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                            {brandName}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '12px',
                              background: brandBg,
                              color: brandColor,
                              border: `1px solid ${brandColor}40`,
                            }}
                          >
                            {t('settings.workspace_sections.settings_marketplaces_section.s445', "حصة")} {m.sharePercentage.toFixed(1)}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(100, m.sharePercentage)}%`,
                              height: '100%',
                              background: brandColor,
                              borderRadius: '3px',
                            }}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', marginTop: '4px' }}>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s446', "المبيعات الإجمالية")}</span>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.grossSales.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s447', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s448', "صافي المستحق")}</span>
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>{m.netPayout.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s449', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s450', "رسوم المنصة")}</span>
                            <span style={{ fontWeight: 700, color: '#ea580c' }}>{m.marketplaceFees.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s451', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s452', "نسبة المرتجع (RTO)")}</span>
                            <span style={{ fontWeight: 700, color: m.returnRate > 15 ? '#dc2626' : '#2563eb' }}>
                              {m.returnRate.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{t('settings.workspace_sections.settings_marketplaces_section.s453', "عدد الطلبات:")}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.ordersCount} {t('settings.workspace_sections.settings_marketplaces_section.s454', "طلب")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Selling Products */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s455', "الأصناف الأكثر طلباً ومبيعاً عبر المنصات (Top Velocity Products)")}
                </h4>

                {analyticsQuery.data.topSellingProducts.length > 0 ? (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s456', "الصنف / المنتج")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s457', "كود المنصة (SKU)")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s458', "المنصة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s459', "الوحدات المباعة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s460', "إجمالي الإيراد")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsQuery.data.topSellingProducts.map((p, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>{p.productName}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#64748b' }}>{p.sku}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', fontWeight: 700, textTransform: 'uppercase' }}>
                                {p.marketplace}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>
                              {p.unitsSold} {t('settings.workspace_sections.settings_marketplaces_section.s461', "قطعة")}
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                              {p.totalRevenue.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s462', "ج.م")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s463', "لم يتم تسجيل طلبات بيع عبر المنصات خلال هذه الفترة حتى الآن.")}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <AddSkuMappingModal mappingModals={mappingModals} availableProducts={availableProducts} />

      <EditCompetitorPriceModal mappingModals={mappingModals} />

      <BulkMappingImportModal mappingModals={mappingModals} handleDownloadSampleMappingTemplate={handleDownloadSampleMappingTemplate} />

      <ReconcileSettlementModal settlements={settlements} />

      <RepricingSettingsModal mappingModals={mappingModals} />

      <CreateInboundShipmentModal inboundModals={inboundModals} availableProducts={availableProducts} mappings={mappings} />

      <FnskuBarcodeModal inboundModals={inboundModals} />

      <ReceiveShipmentModal receiving={receiving} />

      <DiscrepancyClaimReportModal receiving={receiving} />

      {/* ========================================================================= */}
      {/* MODAL 10: EDIT ONBOARDING PROFILE */}
      <EditOnboardingProfileModal
        open={showEditOnboardingModal}
        initialData={onboardingQuery.data || {}}
        targetSection={onboardingTargetSection}
        onClose={() => setShowEditOnboardingModal(false)}
        onSave={(data) => saveOnboardingMutation.mutate(data)}
        isSaving={saveOnboardingMutation.isPending}
      />

      {/* ========================================================================= */}
      <MarketplaceLoaModal onboarding={onboarding} />

      <GtinExemptionModal
        showGtinModal={assistants.showGtinModal}
        setShowGtinModal={assistants.setShowGtinModal}
        gtinForm={assistants.gtinForm}
        setGtinForm={assistants.setGtinForm}
        gtinResult={assistants.gtinResult}
        setGtinResult={assistants.setGtinResult}
        gtinLanguage={assistants.gtinLanguage}
        setGtinLanguage={assistants.setGtinLanguage}
        gtinMutation={assistants.gtinMutation}
        availableProducts={availableProducts}
      />

      <PhotoOptimizerModal
        showPhotoOptimizerModal={assistants.showPhotoOptimizerModal}
        setShowPhotoOptimizerModal={assistants.setShowPhotoOptimizerModal}
        optimizerImageSrc={assistants.optimizerImageSrc}
        setOptimizerImageSrc={assistants.setOptimizerImageSrc}
        optimizedImageResult={assistants.optimizedImageResult}
        setOptimizedImageResult={assistants.setOptimizedImageResult}
        imageMetrics={assistants.imageMetrics}
        setImageMetrics={assistants.setImageMetrics}
        handleOptimizeProductImage={assistants.handleOptimizeProductImage}
      />
    </div>
  );
};
