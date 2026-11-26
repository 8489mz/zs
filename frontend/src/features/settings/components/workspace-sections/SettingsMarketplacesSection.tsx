import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useMarketplaceProductsQuery } from '@/shared/hooks/use-catalog-queries';
import {
  CheckIcon,
  AlertTriangleIcon,
  PackageIcon,
  ShoppingCartIcon,
  RefreshCwIcon,
  ReceiptIcon,
  CalculatorIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  SlidersIcon,
  TruckIcon,
  CheckShieldIcon,
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
import { MarketplaceAnalyticsTab, useMarketplaceAnalytics } from '@/features/settings/components/workspace-sections/marketplaces/marketplace-analytics';

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
  const analytics = useMarketplaceAnalytics(activeTab);

  const {
    amazonCfg, setAmazonCfg, noonCfg, setNoonCfg,
    jumiaCfg, setJumiaCfg, trendyolCfg, setTrendyolCfg,
    testResult, setTestResult, saveSuccess, saveMutation, testMutation,
  } = useMarketplaceConfigs();

  const productsQuery = useMarketplaceProductsQuery();
  const inboundModals = useMarketplaceInboundModals({ inboundShipmentsQuery });
  const { setShowInboundModal, setPrintFnskuModal } = inboundModals;


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
      {activeTab === 'analytics' ? (
      <MarketplaceAnalyticsTab analytics={analytics} />
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
