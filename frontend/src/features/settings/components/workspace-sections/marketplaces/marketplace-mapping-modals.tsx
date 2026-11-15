// Marketplace mapping modals M1/M2/M3/M5 — pure move from
// SettingsMarketplacesSection.tsx (slice S5). The hook owns the mapping modal
// state + the 4 mapping mutations; the modal components render the M1/M2/M3/M5
// DialogShells. The facade calls useMarketplaceMappingModals() once (with
// mappingsQuery, for the 4 mutations' onSuccess refetch) and passes hook
// values as props. Modal open/form state lives here; the S4 inventory tab
// opens the modals through the setters the facade destructures from the hook.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  BulkMappingImportRow,
  BulkMappingImportResult,
} from '@/features/storefront/api/marketplace-sync.api';
import type { Product } from '@/types/domain';
import {
  XIcon,
  DownloadIcon,
  UploadIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';

export interface UseMarketplaceMappingModalsParams {
  mappingsQuery: { refetch: () => Promise<unknown> };
}

export function useMarketplaceMappingModals({ mappingsQuery }: UseMarketplaceMappingModalsParams) {
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Competitor Price Modal
  const [editPriceModal, setEditPriceModal] = useState<MarketplaceSkuMapping | null>(null);
  const [editCompetitorPrice, setEditCompetitorPrice] = useState<string>('');
  const [editBuyBoxPrice, setEditBuyBoxPrice] = useState<string>('');

  // New mapping form
  const [newMapping, setNewMapping] = useState<{
    productId: number;
    marketplace: SupportedMarketplace;
    marketplaceSku: string;
    marketplaceTitle: string;
    customPrice: string;
    competitorPrice: string;
    buyBoxPrice: string;
    syncStock: boolean;
  }>({
    productId: 0,
    marketplace: 'amazon',
    marketplaceSku: '',
    marketplaceTitle: '',
    customPrice: '',
    competitorPrice: '',
    buyBoxPrice: '',
    syncStock: true,
  });

  // Bulk Import State
  const [showBulkImportModal, setShowBulkImportModal] = useState<boolean>(false);
  // bulkImportMarketplace removed (unused)
  const [bulkImportText, setBulkImportText] = useState<string>('');
  const [bulkImportResult, setBulkImportResult] = useState<BulkMappingImportResult | null>(null);

  // Repricing Settings Modal State
  const [editRepricingModal, setEditRepricingModal] = useState<MarketplaceSkuMapping | null>(null);
  const [repricingForm, setRepricingForm] = useState<{
    repricingEnabled: boolean;
    minPrice: string;
    maxPrice: string;
    repricingRule: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
    repricingDelta: string;
  }>({
    repricingEnabled: true,
    minPrice: '',
    maxPrice: '',
    repricingRule: 'undercut_buy_box',
    repricingDelta: '1',
  });

  const addMappingMutation = useMutation({
    mutationFn: (payload: any) => marketplaceSyncApi.addMapping(payload),
    onSuccess: () => {
      setShowAddModal(false);
      setNewMapping({
        productId: 0,
        marketplace: 'amazon',
        marketplaceSku: '',
        marketplaceTitle: '',
        customPrice: '',
        competitorPrice: '',
        buyBoxPrice: '',
        syncStock: true,
      });
      mappingsQuery.refetch();
      toast.success('تم ربط الصنف مع المنصة بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ الربط'),
  });

  const updateCompetitorPriceMutation = useMutation({
    mutationFn: (data: { id: string; competitorPrice?: number; buyBoxPrice?: number }) =>
      marketplaceSyncApi.updateCompetitorPrice(data.id, { competitorPrice: data.competitorPrice, buyBoxPrice: data.buyBoxPrice }),
    onSuccess: () => {
      setEditPriceModal(null);
      mappingsQuery.refetch();
      toast.success('تم تحديث سعر المنافس وصندوق الشراء بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تحديث أسعار المنافسة'),
  });

  const bulkImportMutation = useMutation({
    mutationFn: (rows: BulkMappingImportRow[]) => marketplaceSyncApi.importMappings(rows),
    onSuccess: (res) => {
      setBulkImportResult(res);
      toast.success(`تم استيراد ${res.importedCount} صنفاً جديداً وتحديث ${res.updatedCount} صنفاً`);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل استيراد الشيت'),
  });

  const saveRepricingMutation = useMutation({
    mutationFn: (data: { id: string; payload: any }) =>
      marketplaceSyncApi.saveRepricingSettings(data.id, data.payload),
    onSuccess: () => {
      setEditRepricingModal(null);
      mappingsQuery.refetch();
      toast.success('تم حفظ إعدادات وقواعد التسعير الذكي بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ إعدادات التسعير'),
  });

  return {
    showAddModal,
    setShowAddModal,
    newMapping,
    setNewMapping,
    addMappingMutation,
    editPriceModal,
    setEditPriceModal,
    editCompetitorPrice,
    setEditCompetitorPrice,
    editBuyBoxPrice,
    setEditBuyBoxPrice,
    updateCompetitorPriceMutation,
    showBulkImportModal,
    setShowBulkImportModal,
    bulkImportText,
    setBulkImportText,
    bulkImportResult,
    setBulkImportResult,
    bulkImportMutation,
    editRepricingModal,
    setEditRepricingModal,
    repricingForm,
    setRepricingForm,
    saveRepricingMutation,
  };
}

export interface AddSkuMappingModalProps {
  mappingModals: ReturnType<typeof useMarketplaceMappingModals>;
  availableProducts: Product[];
}

export const AddSkuMappingModal: React.FC<AddSkuMappingModalProps> = ({ mappingModals, availableProducts }) => {
  const { t } = useTranslation();
  const {
    showAddModal,
    setShowAddModal,
    newMapping,
    setNewMapping,
    addMappingMutation,
  } = mappingModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 1: ADD SKU MAPPING */}
      {/* ========================================================================= */}
      <DialogShell open={showAddModal} onClose={() => setShowAddModal(false)} width="min(560px, 95vw)" ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s464', "ربط صنف بالمنصات")}>
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s465', "ربط صنف مع منصات الماركت بليس (Add Marketplace SKU)")}
            </h4>
            <button type="button" onClick={() => setShowAddModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
              <XIcon size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s466', "اختيار الصنف من الـ ERP *")}
              </label>
              <select
                value={newMapping.productId}
                onChange={(e) => setNewMapping({ ...newMapping, productId: parseInt(e.target.value, 10) || 0 })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s467', "-- اختر صنفاً --")}</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.barcode ? `(${p.barcode})` : ''} {t('settings.workspace_sections.settings_marketplaces_section.s468', "- سعر:")} {(p as any).retailPrice ?? (p as any).retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s469', "ج.م")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s470', "المنصة المستهدفة *")}
              </label>
              <select
                value={newMapping.marketplace}
                onChange={(e) => setNewMapping({ ...newMapping, marketplace: e.target.value as any })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s471', "أمازون (Amazon ASIN)")}</option>
                <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s472', "نون (Noon Partner SKU)")}</option>
                <option value="jumia">{t('settings.workspace_sections.settings_marketplaces_section.s473', "جوميا (Jumia Seller SKU)")}</option>
                <option value="trendyol">{t('settings.workspace_sections.settings_marketplaces_section.s474', "ترينديول (Trendyol Barcode/SKU)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s475', "كود الصنف على المنصة (ASIN / Partner SKU) *")}
              </label>
              <input
                type="text"
                value={newMapping.marketplaceSku}
                onChange={(e) => setNewMapping({ ...newMapping, marketplaceSku: e.target.value })}
                placeholder={newMapping.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s476', "مثال: B08N5WRWNW") : t('settings.workspace_sections.settings_marketplaces_section.s477', "مثال: NOON-SKU-9921")}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s478', "سعر مخصص على المنصة (اختياري)")}
                </label>
                <input
                  type="number"
                  value={newMapping.customPrice}
                  onChange={(e) => setNewMapping({ ...newMapping, customPrice: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s479', "سعر البيع الافتراضي بالـ ERP")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s480', "سعر صندوق الشراء (Buy Box Price)")}
                </label>
                <input
                  type="number"
                  value={newMapping.buyBoxPrice}
                  onChange={(e) => setNewMapping({ ...newMapping, buyBoxPrice: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s481', "سعر الـ Buy Box الحالي")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s482', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!newMapping.productId || !newMapping.marketplaceSku) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s483', "يرجى اختيار الصنف وإدخال كود المنصة"));
                  return;
                }
                addMappingMutation.mutate({
                  productId: newMapping.productId,
                  marketplace: newMapping.marketplace,
                  marketplaceSku: newMapping.marketplaceSku,
                  customPrice: newMapping.customPrice ? parseFloat(newMapping.customPrice) : undefined,
                  buyBoxPrice: newMapping.buyBoxPrice ? parseFloat(newMapping.buyBoxPrice) : undefined,
                  competitorPrice: newMapping.competitorPrice ? parseFloat(newMapping.competitorPrice) : undefined,
                  syncStock: newMapping.syncStock,
                  status: 'synced',
                });
              }}
              disabled={addMappingMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {addMappingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s484', "جاري الحفظ...") : t('settings.workspace_sections.settings_marketplaces_section.s485', "حفظ وتفعيل الربط")}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
};

export interface EditCompetitorPriceModalProps {
  mappingModals: ReturnType<typeof useMarketplaceMappingModals>;
}

export const EditCompetitorPriceModal: React.FC<EditCompetitorPriceModalProps> = ({ mappingModals }) => {
  const { t } = useTranslation();
  const {
    editPriceModal,
    setEditPriceModal,
    editCompetitorPrice,
    setEditCompetitorPrice,
    editBuyBoxPrice,
    setEditBuyBoxPrice,
    updateCompetitorPriceMutation,
  } = mappingModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 2: EDIT COMPETITOR & BUY BOX PRICE (تحديث أسعار المنافسين وصندوق الشراء) */}
      {/* ========================================================================= */}
      <DialogShell open={Boolean(editPriceModal)} onClose={() => setEditPriceModal(null)} width="min(460px, 95vw)" ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s486', "تعديل أسعار المنافسة")}>
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s487', "تحديث أسعار المنافسين وصندوق الشراء (Buy Box & Competitor Pricing)")}
            </h4>
            <button type="button" onClick={() => setEditPriceModal(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
              <XIcon size={18} />
            </button>
          </div>

          {editPriceModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{editPriceModal.productName}</div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s488', "كود المنصة:")} <strong style={{ color: '#170e5e' }}>{editPriceModal.marketplaceSku}</strong> ({editPriceModal.marketplace.toUpperCase()})
                </div>
                <div style={{ color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s489', "سعرنا الحالي:")} <strong>{editPriceModal.customPrice || editPriceModal.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s490', "ج.م")}</strong>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s491', "سعر صندوق الشراء الحائز على المبيعات (Buy Box Price)")}
                </label>
                <input
                  type="number"
                  value={editBuyBoxPrice}
                  onChange={(e) => setEditBuyBoxPrice(e.target.value)}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s492', "مثال: 340")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s493', "سعر أدنى منافس (Lowest Competitor Price)")}
                </label>
                <input
                  type="number"
                  value={editCompetitorPrice}
                  onChange={(e) => setEditCompetitorPrice(e.target.value)}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s494', "مثال: 335")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="secondary" onClick={() => setEditPriceModal(null)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s495', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!editPriceModal) return;
                updateCompetitorPriceMutation.mutate({
                  id: editPriceModal.id,
                  competitorPrice: editCompetitorPrice ? parseFloat(editCompetitorPrice) : undefined,
                  buyBoxPrice: editBuyBoxPrice ? parseFloat(editBuyBoxPrice) : undefined,
                });
              }}
              disabled={updateCompetitorPriceMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {updateCompetitorPriceMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s496', "جاري التحديث...") : t('settings.workspace_sections.settings_marketplaces_section.s497', "تحديث أسعار المنافسة")}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
};

export interface BulkMappingImportModalProps {
  mappingModals: ReturnType<typeof useMarketplaceMappingModals>;
  handleDownloadSampleMappingTemplate: () => void;
}

export const BulkMappingImportModal: React.FC<BulkMappingImportModalProps> = ({ mappingModals, handleDownloadSampleMappingTemplate }) => {
  const { t } = useTranslation();
  const {
    showBulkImportModal,
    setShowBulkImportModal,
    bulkImportText,
    setBulkImportText,
    bulkImportResult,
    setBulkImportResult,
    bulkImportMutation,
  } = mappingModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 3: BULK SKU MAPPING IMPORT (CSV / EXCEL) */}
      {/* ========================================================================= */}
      <DialogShell
        open={showBulkImportModal}
        onClose={() => {
          setShowBulkImportModal(false);
          setBulkImportResult(null);
        }}
        width="min(820px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s498', "استيراد شيت الأكواد")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s499', "استيراد شيت مطابقة الأكواد الجماعي (Bulk SKU Mapping Import)")}
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s500', "رفع ملف CSV أو لصق محتوى جدول الإكسيل لربط وتحديث مئات الأصناف دفعة واحدة.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowBulkImportModal(false);
                setBulkImportResult(null);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* Instructions & Template Download Bar */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s501', "الأعمدة المدعومة:")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s502', "الباركود (barcode)")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s503', "أو")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s504', "كود الصنف (sku)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s505', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s506', "المنصة (marketplace)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s507', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s508', "كود الصنف بالمنصة (marketplace_sku)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s509', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s510', "سعر البيع (custom_price)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s511', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s512', "سعر المنافس (competitor_price)")}</strong>.
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                const sample = `barcode,marketplace,marketplace_sku,marketplace_title,custom_price,competitor_price\n622123456789,amazon,B08N5WRWNW,كابل شحن فائق السرعة,299,285\n622987654321,noon,N45678901A,سماعة بلوتوث لاسلكية,450,420\n622555666777,jumia,JM-99120,ساعة يد رياضية,380,360`;
                const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'marketplace_sku_mapping_template.csv';
                link.click();
                URL.revokeObjectURL(url);
              }}
              style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <DownloadIcon size={14} />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s513', "تحميل نموذج CSV تجريبي")}</span>
            </Button>
          </div>

          {/* File Picker or Paste Area */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s514', "لصق بيانات الشيت أو رفع ملف CSV:")}
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleDownloadSampleMappingTemplate}
                  style={{
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '11.5px',
                    color: '#334155',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 10px',
                    borderRadius: '6px',
                  }}
                >
                  <DownloadIcon size={12} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s515', "تحميل نموذج الشيت (.CSV)")}</span>
                </button>

                <label
                  style={{
                    fontSize: '11.5px',
                    color: '#170e5e',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#f1f5f9',
                    padding: '3px 10px',
                    borderRadius: '6px',
                  }}
                >
                  <UploadIcon size={12} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s516', "اختر ملف من جهازك")}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const content = String(ev.target?.result || '');
                        setBulkImportText(content);
                        setBulkImportResult(null);
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <textarea
              rows={8}
              value={bulkImportText}
              onChange={(e) => {
                setBulkImportText(e.target.value);
                setBulkImportResult(null);
              }}
              placeholder={`انسخ والصق الأعمدة هنا من الإكسيل مباشرة، أو بصيغة CSV:\n622123456789,amazon,B08N5WRWNW,كابل شحن,299,285\n622987654321,noon,N45678901A,سماعة بلوتوث,450,420`}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                fontFamily: 'monospace',
                direction: 'ltr',
                textAlign: 'left',
              }}
            />
          </div>

          {/* Bulk Import Result Banner */}
          {bulkImportResult ? (
            <div
              style={{
                background: bulkImportResult.importedCount > 0 || bulkImportResult.updatedCount > 0 ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${bulkImportResult.importedCount > 0 || bulkImportResult.updatedCount > 0 ? '#86efac' : '#fde68a'}`,
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '12.5px',
              }}
            >
              <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s517', "نتيجة المعالجة:")}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#334155' }}>
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s518', "إجمالي الصفوف:")} <strong>{bulkImportResult.totalRows}</strong></span>
                <span style={{ color: '#15803d' }}>{t('settings.workspace_sections.settings_marketplaces_section.s519', "تم استيراد جديد:")} <strong>{bulkImportResult.importedCount}</strong></span>
                <span style={{ color: '#0369a1' }}>{t('settings.workspace_sections.settings_marketplaces_section.s520', "تم تحديث قائم:")} <strong>{bulkImportResult.updatedCount}</strong></span>
                <span style={{ color: '#b45309' }}>{t('settings.workspace_sections.settings_marketplaces_section.s521', "تم التخطي / أخطاء:")} <strong>{bulkImportResult.skippedCount}</strong></span>
              </div>
              {bulkImportResult.errors && bulkImportResult.errors.length > 0 ? (
                <div style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto', background: '#ffffff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '11.5px', color: '#b91c1c' }}>
                  {bulkImportResult.errors.map((err, idx) => (
                    <div key={idx}>{t('settings.workspace_sections.settings_marketplaces_section.s522', "صف")} {err.row}: {err.reason}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              variant="secondary"
              onClick={() => {
                setShowBulkImportModal(false);
                setBulkImportResult(null);
              }}
            >
              {t('settings.workspace_sections.settings_marketplaces_section.s523', "إغلاق")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!bulkImportText.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s524', "برجاء إدخال أو لصق بيانات الشيت أولاً"));
                  return;
                }
                const lines = bulkImportText.trim().split('\n');
                const parsedRows: BulkMappingImportRow[] = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;
                  const parts = line.includes('\t') ? line.split('\t') : line.split(',');
                  if (i === 0 && (parts[0].toLowerCase().includes('barcode') || parts[0].toLowerCase().includes('sku') || parts[1]?.toLowerCase().includes('market'))) {
                    continue;
                  }
                  if (parts.length < 3) continue;

                  const col0 = parts[0]?.replace(/"/g, '').trim();
                  const col1 = parts[1]?.replace(/"/g, '').trim().toLowerCase() as SupportedMarketplace;
                  const col2 = parts[2]?.replace(/"/g, '').trim();
                  const col3 = parts[3]?.replace(/"/g, '').trim();
                  const col4 = parts[4]?.replace(/"/g, '').trim();
                  const col5 = parts[5]?.replace(/"/g, '').trim();

                  parsedRows.push({
                    barcode: col0,
                    sku: col0,
                    marketplace: (col1 as any) || 'amazon',
                    marketplaceSku: col2,
                    marketplaceTitle: isNaN(Number(col3)) && col3 ? col3 : undefined,
                    customPrice: !isNaN(Number(col3)) ? parseFloat(col3) : (!isNaN(Number(col4)) ? parseFloat(col4) : undefined),
                    competitorPrice: !isNaN(Number(col4)) && isNaN(Number(col3)) ? parseFloat(col4) : (!isNaN(Number(col5)) ? parseFloat(col5) : undefined),
                    syncStock: true,
                  });
                }

                if (!parsedRows.length) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s525', "لم يتم التعرف على أي صفوف صالحة من البيانات المدخلة"));
                  return;
                }

                bulkImportMutation.mutate(parsedRows);
              }}
              disabled={bulkImportMutation.isPending || !bulkImportText.trim()}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {bulkImportMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s526', "جاري الاستيراد والمعالجة...") : t('settings.workspace_sections.settings_marketplaces_section.s527', "بدء معالجة واستيراد الشيت")}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
};

export interface RepricingSettingsModalProps {
  mappingModals: ReturnType<typeof useMarketplaceMappingModals>;
}

export const RepricingSettingsModal: React.FC<RepricingSettingsModalProps> = ({ mappingModals }) => {
  const { t } = useTranslation();
  const {
    editRepricingModal,
    setEditRepricingModal,
    repricingForm,
    setRepricingForm,
    saveRepricingMutation,
  } = mappingModals;
  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 5: REPRICING BOT SETTINGS MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={Boolean(editRepricingModal)}
        onClose={() => setEditRepricingModal(null)}
        width="min(560px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s564', "إعداد روبوت إعادة التسعير الآلي")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SlidersIcon size={18} color="#170e5e" />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s565', "إعداد روبوت إعادة التسعير الآلي (Buy Box Repricer)")}</span>
            </h4>
            <button
              type="button"
              onClick={() => setEditRepricingModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {editRepricingModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Product Info Card */}
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>{editRepricingModal.productName}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '8px', color: '#475569' }}>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s566', "المنصة:")} <strong style={{ color: '#170e5e' }}>{editRepricingModal.marketplace.toUpperCase()}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s567', "كود SKU:")} <strong style={{ fontFamily: 'monospace' }}>{editRepricingModal.marketplaceSku}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s568', "سعر البيع:")} <strong>{editRepricingModal.customPrice || editRepricingModal.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s569', "ج.م")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s570', "سعر التكلفة:")} <strong style={{ color: '#059669' }}>{editRepricingModal.costPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s571', "ج.م")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s572', "سعر المنافس:")} <strong>{editRepricingModal.competitorPrice ? `${editRepricingModal.competitorPrice} ج.م` : t('settings.workspace_sections.settings_marketplaces_section.s573', "غير مسجل")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s574', "سعر Buy Box:")} <strong>{editRepricingModal.buyBoxPrice ? `${editRepricingModal.buyBoxPrice} ج.م` : t('settings.workspace_sections.settings_marketplaces_section.s575', "غير مسجل")}</strong>
                  </div>
                </div>
              </div>

              {/* Bot Toggle Switch */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: repricingForm.repricingEnabled ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${repricingForm.repricingEnabled ? '#86efac' : '#cbd5e1'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={repricingForm.repricingEnabled}
                  onChange={(e) => setRepricingForm({ ...repricingForm, repricingEnabled: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontWeight: 800, color: repricingForm.repricingEnabled ? '#15803d' : '#334155', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s576', "تفعيل روبوت إعادة التسعير الآلي التلقائي")}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s577', "يقوم النظام برصد أسعار المنافسين وإعادة تعديل سعر الصنف تلقائياً للفوز بصندوق الشراء.")}
                  </div>
                </div>
              </label>

              {/* Repricing Rule */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s578', "استراتيجية وقاعدة التسعير (Repricing Strategy)")}
                </label>
                <select
                  value={repricingForm.repricingRule}
                  onChange={(e) => setRepricingForm({ ...repricingForm, repricingRule: e.target.value as any })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="undercut_buy_box">{t('settings.workspace_sections.settings_marketplaces_section.s579', "النزول عن سعر صندوق الشراء (Buy Box) بقيمة فارق — للفوز الفوري")}</option>
                  <option value="match_buy_box">{t('settings.workspace_sections.settings_marketplaces_section.s580', "مطابقة سعر صندوق الشراء (Buy Box) بدقة")}</option>
                  <option value="undercut_lowest">{t('settings.workspace_sections.settings_marketplaces_section.s581', "النزول عن أقل منافس في السوق بقيمة فارق")}</option>
                  <option value="match_lowest">{t('settings.workspace_sections.settings_marketplaces_section.s582', "مطابقة أقل سعر منافس في السوق")}</option>
                </select>
              </div>

              {/* Delta & Floor/Ceiling Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s583', "الفارق السعري (Delta - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.5"
                    value={repricingForm.repricingDelta}
                    onChange={(e) => setRepricingForm({ ...repricingForm, repricingDelta: e.target.value })}
                    placeholder="1"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s584', "الحد الأدنى (Floor - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={repricingForm.minPrice}
                    onChange={(e) => setRepricingForm({ ...repricingForm, minPrice: e.target.value })}
                    placeholder={String(Math.ceil((editRepricingModal.costPrice || 0) * 1.05))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s585', "الحد الأقصى (Ceiling - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={repricingForm.maxPrice}
                    onChange={(e) => setRepricingForm({ ...repricingForm, maxPrice: e.target.value })}
                    placeholder={String(Math.ceil((editRepricingModal.retailPrice || 100) * 1.5))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              </div>

              {/* Safety Margin Alert */}
              {Number(repricingForm.minPrice) > 0 && Number(repricingForm.minPrice) < (editRepricingModal.costPrice || 0) ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#b91c1c' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s586', "تنبيه: الحد الأدنى الذي أدخلته (")}{repricingForm.minPrice} {t('settings.workspace_sections.settings_marketplaces_section.s587', "ج.م) أقل من سعر التكلفة (")}{editRepricingModal.costPrice} {t('settings.workspace_sections.settings_marketplaces_section.s588', "ج.م). سيمنع النظام الروبوت من البيع بخسارة!")}
                </div>
              ) : (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s589', "قاعدة الأمان: لن يقوم الروبوت بتخفيض السعر إطلاقاً تحت الحد الأدنى، وسيرفع السعر تلقائياً إلى الحد الأقصى إذا نفد مخزون المنافسين.")}
                </div>
              )}
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <Button variant="secondary" onClick={() => setEditRepricingModal(null)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s590', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!editRepricingModal) return;
                const min = Number(repricingForm.minPrice) || undefined;
                const max = Number(repricingForm.maxPrice) || undefined;
                const delta = Number(repricingForm.repricingDelta) || 1;

                if (min && max && min >= max) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s591', "الحد الأدنى يجب أن يكون أقل من الحد الأقصى للسعر"));
                  return;
                }

                saveRepricingMutation.mutate({
                  id: editRepricingModal.id,
                  payload: {
                    repricingEnabled: repricingForm.repricingEnabled,
                    minPrice: min,
                    maxPrice: max,
                    repricingRule: repricingForm.repricingRule,
                    repricingDelta: delta,
                  },
                });
              }}
              disabled={saveRepricingMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {saveRepricingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s592', "جاري الحفظ...") : t('settings.workspace_sections.settings_marketplaces_section.s593', "حفظ إعدادات الروبوت")}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );
};
