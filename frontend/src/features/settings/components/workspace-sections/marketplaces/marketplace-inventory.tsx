// Marketplace inventory tab (SKU mappings, Buy Box tracking, repricing) —
// pure move from SettingsMarketplacesSection.tsx (slice S4). The hook owns
// the inventory state/queries/mutations/handlers; the tab component renders
// the tab JSX. The facade calls useMarketplaceInventory() once and passes
// hook values as props. Modal setters (S5/S7) arrive as props — the modal
// state lives with its modal's slice, never duplicated here.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceSkuMapping,
} from '@/features/storefront/api/marketplace-sync.api';
import {
  CheckIcon,
  RefreshCwIcon,
  LinkIcon,
  PlusIcon,
  DownloadIcon,
  UploadIcon,
  SlidersIcon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';

export function useMarketplaceInventory() {
  const [selectedInventoryPlatform, setSelectedInventoryPlatform] = useState<'all' | SupportedMarketplace>('all');

  const mappingsQuery = useQuery({
    queryKey: ['marketplace-mappings'],
    queryFn: () => marketplaceSyncApi.listMappings(),
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (id: number | string) => marketplaceSyncApi.deleteMapping(id),
    onSuccess: () => {
      mappingsQuery.refetch();
      toast.success('تم إلغاء ربط الصنف');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل الحذف'),
  });

  const liveSyncMutation = useMutation({
    mutationFn: (productId?: number) => marketplaceSyncApi.syncStockLive(productId),
    onSuccess: (res) => {
      toast.success(res.message);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل البث اللحظي للمخزون'),
  });

  const runRepricingMutation = useMutation({
    mutationFn: (marketplace?: SupportedMarketplace) => marketplaceSyncApi.runRepricingBot(marketplace),
    onSuccess: (res) => {
      toast.success(`قام الروبوت بفحص ${res.totalEvaluated} صنفاً وتعديل أسعار ${res.totalRepriced} صنفاً بنجاح`);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تشغيل روبوت إعادة التسعير'),
  });

  const handleExportFlatFile = async (marketplace: SupportedMarketplace) => {
    try {
      const res = await marketplaceSyncApi.exportFlatFile(marketplace);
      const blob = new Blob([res.data], { type: res.contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`تم تحميل شيت الرفع ${res.filename} (${res.rowCount} صنفاً)`);
    } catch (err: any) {
      toast.error(err?.message || 'فشل تصدير ملف الإدراج');
    }
  };

  const handleDownloadSampleMappingTemplate = () => {
    const headers = 'barcode,marketplace,marketplaceSku,marketplaceTitle,customPrice,competitorPrice';
    const sampleRows = [
      '622123456789,amazon,B08N5WRWNW,كابل شحن سريع أصلي تايب سي,199,189',
      '622987654321,noon,N45678901A,سماعة رأس بلوتوث محيطية,450,420',
      '622112233445,jumia,JM987654,ماوس ألعاب لاسلكي مريح,290,275',
    ].join('\n');
    const csvContent = '\uFEFF' + [headers, sampleRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Marketplace_SKU_Mapping_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('تم تحميل نموذج شيت الربط التجريبي بنجاح');
  };

  const mappings: MarketplaceSkuMapping[] = mappingsQuery.data || [];
  const winningCount = mappings.filter((m) => m.buyBoxStatus === 'winning').length;
  const atRiskCount = mappings.filter((m) => m.buyBoxStatus === 'at_risk').length;
  const losingCount = mappings.filter((m) => m.buyBoxStatus === 'losing').length;

  const filteredMappings = selectedInventoryPlatform === 'all'
    ? mappings
    : mappings.filter((m) => m.marketplace === selectedInventoryPlatform);

  return {
    mappingsQuery,
    mappings,
    winningCount,
    atRiskCount,
    losingCount,
    filteredMappings,
    selectedInventoryPlatform,
    setSelectedInventoryPlatform,
    deleteMappingMutation,
    liveSyncMutation,
    runRepricingMutation,
    handleExportFlatFile,
    handleDownloadSampleMappingTemplate,
  };
}

export interface MarketplaceInventoryTabProps {
  inventory: ReturnType<typeof useMarketplaceInventory>;
  setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBulkImportModal: React.Dispatch<React.SetStateAction<boolean>>;
  setEditPriceModal: React.Dispatch<React.SetStateAction<MarketplaceSkuMapping | null>>;
  setEditCompetitorPrice: React.Dispatch<React.SetStateAction<string>>;
  setEditBuyBoxPrice: React.Dispatch<React.SetStateAction<string>>;
  setEditRepricingModal: React.Dispatch<React.SetStateAction<MarketplaceSkuMapping | null>>;
  setRepricingForm: React.Dispatch<
    React.SetStateAction<{
      repricingEnabled: boolean;
      minPrice: string;
      maxPrice: string;
      repricingRule: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
      repricingDelta: string;
    }>
  >;
  setPrintFnskuModal: React.Dispatch<
    React.SetStateAction<{
      productName: string;
      marketplaceSku: string;
      barcode?: string;
      condition: string;
      marketplace: string;
      format: 'thermal_50x30' | 'thermal_40x25' | 'a4_44up';
      copies: number;
    } | null>
  >;
}

export const MarketplaceInventoryTab: React.FC<MarketplaceInventoryTabProps> = ({
  inventory,
  setShowAddModal,
  setShowBulkImportModal,
  setEditPriceModal,
  setEditCompetitorPrice,
  setEditBuyBoxPrice,
  setEditRepricingModal,
  setRepricingForm,
  setPrintFnskuModal,
}) => {
  const { t } = useTranslation();
  const {
    mappingsQuery,
    mappings,
    winningCount,
    atRiskCount,
    losingCount,
    filteredMappings,
    selectedInventoryPlatform,
    setSelectedInventoryPlatform,
    deleteMappingMutation,
    liveSyncMutation,
    runRepricingMutation,
    handleExportFlatFile,
    handleDownloadSampleMappingTemplate,
  } = inventory;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 3: INVENTORY SYNC, SKU MAPPING & REPRICER (مطابقة الأكواد وروبوت الأسعار) */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s190', "إجمالي الأصناف المربوطة")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {mappings.length}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s191', "رابح لصندوق الشراء (Buy Box)")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                {winningCount}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s192', "في خطر فقدان المبيعات")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#b45309', marginTop: '4px' }}>
                {atRiskCount}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s193', "خاسر لصندوق الشراء")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#b91c1c', marginTop: '4px' }}>
                {losingCount}
              </div>
            </div>
          </div>

          {/* Table Card */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s194', "جدول مطابقة الأكواد (SKU Mapping) وتتبع أسعار المنافسين والـ Buy Box")}
                </h4>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s195', "مزامنة الأرصدة الحية، مراقبة أسعار المنافسين لنفس الـ ASIN، وتصدير شيتات الإكسيل الرسمية للرفع المباشر.")}
                </p>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => setShowBulkImportModal(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <UploadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s196', "استيراد شيت (CSV / Excel)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleExportFlatFile('amazon')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <DownloadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s197', "تصدير أمازون (TSV)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleExportFlatFile('noon')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <DownloadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s198', "تصدير نون (CSV)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => liveSyncMutation.mutate(undefined)}
                  disabled={liveSyncMutation.isPending || !mappings.length}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <RefreshCwIcon size={14} />
                  <span>{liveSyncMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s199', "جاري البث...") : t('settings.workspace_sections.settings_marketplaces_section.s200', "بث لحظي للمخزون")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => runRepricingMutation.mutate(selectedInventoryPlatform === 'all' ? undefined : selectedInventoryPlatform)}
                  disabled={runRepricingMutation.isPending || !mappings.length}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', borderColor: '#cbd5e1' }}
                  title={t('settings.workspace_sections.settings_marketplaces_section.s201', "تشغيل روبوت إعادة التسعير الآلي لمطابقة أو النزول عن الـ Buy Box")}
                >
                  <SlidersIcon size={14} />
                  <span>{runRepricingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s202', "جاري الرصد والتسعير...") : t('settings.workspace_sections.settings_marketplaces_section.s203', "تشغيل روبوت التسعير")}</span>
                </Button>

                <Button
                  variant="primary"
                  onClick={() => setShowAddModal(true)}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                >
                  <PlusIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s204', "ربط صنف جديد")}</span>
                </Button>
              </div>
            </div>

            {/* Platform Filter Filter Pills */}
            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              {(['all', 'amazon', 'noon', 'jumia', 'trendyol'] as const).map((plt) => (
                <button
                  key={plt}
                  type="button"
                  onClick={() => setSelectedInventoryPlatform(plt)}
                  style={{
                    border: 'none',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: selectedInventoryPlatform === plt ? '#170e5e' : '#f1f5f9',
                    color: selectedInventoryPlatform === plt ? '#ffffff' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {plt === 'all'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s205', "الكل")
                    : plt === 'amazon'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s206', "أمازون")
                    : plt === 'noon'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s207', "نون")
                    : plt === 'jumia'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s208', "جوميا")
                    : t('settings.workspace_sections.settings_marketplaces_section.s209', "ترينديول")}
                </button>
              ))}
            </div>

            {mappingsQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s210', "جاري تحميل جدول مطابقة الأكواد...")}
              </div>
            ) : !filteredMappings.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                    <LinkIcon size={32} color="#94a3b8" />
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s211', "لا توجد أصناف مربوطة حالياً في قسم")} {selectedInventoryPlatform === 'all' ? t('settings.workspace_sections.settings_marketplaces_section.s212', "المنصات") : selectedInventoryPlatform === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s213', "أمازون") : selectedInventoryPlatform === 'noon' ? t('settings.workspace_sections.settings_marketplaces_section.s214', "نون") : selectedInventoryPlatform === 'jumia' ? t('settings.workspace_sections.settings_marketplaces_section.s215', "جوميا") : t('settings.workspace_sections.settings_marketplaces_section.s216', "ترينديول")}
                  </div>
                  <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: '520px', margin: '6px auto 16px', lineHeight: 1.5 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s217', "ابدأ بربط أصناف الـ ERP مع أكواد ASIN أو Partner SKU لمزامنة الأرصدة وتفعيل روبوت تتبع أسعار المنافسين والـ Buy Box تلقائياً.")}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <Button
                      variant="primary"
                      onClick={() => setShowAddModal(true)}
                      style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <PlusIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s218', "ربط صنف جديد الآن")}</span>
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={() => setShowBulkImportModal(true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <UploadIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s219', "استيراد شيت مجمع (CSV / Excel)")}</span>
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={handleDownloadSampleMappingTemplate}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <DownloadIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s220', "تحميل نموذج الشيت التجريبي (.CSV)")}</span>
                    </Button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s221', "1. مزامنة الأرصدة الحية")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s222', "تحديث المخزون على المنصات فور حدوث أي بيع محلي في الكاشير أو المناديب لتجنب غرامات إلغاء الطلبات (Cancellation Rate).")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s223', "2. روبوت تتبع الـ Buy Box")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s224', "مراقبة عروض المنافسين لحظياً وإعادة التسعير الذكي بإنقاص جنيه أو نسبة محددة مع الالتزام بالحد الأدنى لحماية أرباحك.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0369a1', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s225', "3. تصدير ملفات الرفع الرسمية")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s226', "تصدير شيتات Inventory Loader لأمازون (TSV) ونون (CSV) معدة مسبقاً بالأعمدة الرسمية لرفع آلاف الأصناف بضغطة زر.")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s227', "اسم الصنف والتكلفة بالـ ERP")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s228', "المنصة")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s229', "كود المنصة (ASIN / SKU)")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s230', "رصيد المخزن")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s231', "سعرنا على المنصة")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s232', "سعر المنافس / Buy Box")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s233', "حالة صندوق الشراء")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s234', "إجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.map((m) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{m.productName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s235', "تكلفة:")} {m.costPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s236', "ج.م | بيع محلي:")} {m.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s237', "ج.م")}
                          </div>
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              background:
                                m.marketplace === 'amazon'
                                  ? '#fef3c7'
                                  : m.marketplace === 'noon'
                                  ? '#fef9c3'
                                  : m.marketplace === 'jumia'
                                  ? '#ffedd5'
                                  : '#e0e7ff',
                              color:
                                m.marketplace === 'amazon'
                                  ? '#92400e'
                                  : m.marketplace === 'noon'
                                  ? '#854d0e'
                                  : m.marketplace === 'jumia'
                                  ? '#9a3412'
                                  : '#3730a3',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '11px',
                            }}
                          >
                            {m.marketplace.toUpperCase()}
                          </span>
                        </td>

                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 700, color: '#170e5e' }}>
                          {m.marketplaceSku}
                        </td>

                        <td style={{ padding: '12px', fontWeight: 800, color: '#0f172a' }}>
                          {m.currentLocalStock ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s238', "قطعة")}
                        </td>

                        <td style={{ padding: '12px', fontWeight: 800, color: '#170e5e' }}>
                          {m.customPrice ? `${m.customPrice} ج.م (مخصص)` : `${m.retailPrice || 0} ج.م`}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {m.buyBoxPrice ? (
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>
                              {m.buyBoxPrice} {t('settings.workspace_sections.settings_marketplaces_section.s239', "ج.م")}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s240', "غير مسجل")}</span>
                          )}
                          {m.competitorPrice ? (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s241', "المنافس:")} {m.competitorPrice} {t('settings.workspace_sections.settings_marketplaces_section.s242', "ج.م")}
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {m.buyBoxStatus === 'winning' ? (
                            <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <CheckIcon size={11} color="#15803d" strokeWidth={2.5} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s243', "رابح للـ Buy Box")}</span>
                            </span>
                          ) : m.buyBoxStatus === 'at_risk' ? (
                            <span style={{ background: '#fefce8', color: '#a16207', border: '1px solid #fef08a', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s244', "في خطر (+5%)")}
                            </span>
                          ) : m.buyBoxStatus === 'losing' ? (
                            <span style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s245', "خاسر لصندوق الشراء")}
                            </span>
                          ) : (
                            <span style={{ background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s246', "متزامن")}
                            </span>
                          )}
                          {m.repricingEnabled ? (
                            <div style={{ marginTop: '4px' }}>
                              <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '1px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <span>{t('settings.workspace_sections.settings_marketplaces_section.s247', "روبوت:")} {m.minPrice ? `${m.minPrice}` : '0'}-{m.maxPrice ? `${m.maxPrice}` : '∞'} {t('settings.workspace_sections.settings_marketplaces_section.s248', "ج.م")}</span>
                              </span>
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEditPriceModal(m);
                                setEditCompetitorPrice(m.competitorPrice ? String(m.competitorPrice) : '');
                                setEditBuyBoxPrice(m.buyBoxPrice ? String(m.buyBoxPrice) : '');
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s249', "تعديل المنافسة")}
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEditRepricingModal(m);
                                setRepricingForm({
                                  repricingEnabled: m.repricingEnabled ?? false,
                                  minPrice: m.minPrice ? String(m.minPrice) : '',
                                  maxPrice: m.maxPrice ? String(m.maxPrice) : '',
                                  repricingRule: (m.repricingRule as any) ?? 'undercut_buy_box',
                                  repricingDelta: m.repricingDelta ? String(m.repricingDelta) : '1',
                                });
                              }}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: m.repricingEnabled ? '#f0fdf4' : undefined,
                                borderColor: m.repricingEnabled ? '#86efac' : undefined,
                                color: m.repricingEnabled ? '#15803d' : undefined,
                              }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s250', "إعدادات وقواعد روبوت إعادة التسعير الآلي للـ Buy Box")}
                            >
                              <SlidersIcon size={12} />
                              <span>{m.repricingEnabled ? t('settings.workspace_sections.settings_marketplaces_section.s251', "الروبوت نشط") : t('settings.workspace_sections.settings_marketplaces_section.s252', "قواعد الروبوت")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                setPrintFnskuModal({
                                  productName: m.productName || t('settings.workspace_sections.settings_marketplaces_section.s253', "صنف ماركت بليس"),
                                  marketplaceSku: m.marketplaceSku,
                                  barcode: m.barcode,
                                  condition: 'NEW',
                                  marketplace: m.marketplace,
                                  format: 'thermal_50x30',
                                  copies: 1,
                                });
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s254', "طباعة ملصق وباركود FNSKU الحراري للصنف")}
                            >
                              <PrinterIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s255', "طباعة FNSKU")}</span>
                            </Button>

                            <Button
                              variant="danger"
                              onClick={() => deleteMappingMutation.mutate(m.id)}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s256', "إلغاء الربط")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
    </>
  );
};
