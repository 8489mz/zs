/* SettingsMarketplacesSection slice S10 — assistants (GTIN exemption + photo optimizer).
   Pure move from SettingsMarketplacesSection.tsx (HEAD 6886dc599): hook + 2 modal components,
   byte-identical except import lines, the local `t`, and props. */

import { useTranslation } from 'react-i18next';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  GtinExemptionApplication,
} from '@/features/storefront/api/marketplace-sync.api';
import type { Product } from '@/types/domain';
import {
  XIcon,
  CopyIcon,
  DownloadIcon,
  CameraIcon,
} from '@/shared/components/icons/AppIcons';

export function useMarketplaceAssistants() {

  // GTIN / Barcode Exemption State
  const [showGtinModal, setShowGtinModal] = useState<boolean>(false);
  const [gtinForm, setGtinForm] = useState<{
    productId?: number;
    brandName: string;
    category: string;
    marketplace: SupportedMarketplace;
    reason: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
  }>({
    brandName: '',
    category: 'Home & Kitchen / الأدوات المنزلية',
    marketplace: 'amazon',
    reason: 'unbranded',
  });
  const [gtinResult, setGtinResult] = useState<GtinExemptionApplication | null>(null);
  const [gtinLanguage, setGtinLanguage] = useState<'en' | 'ar'>('en');

  // Marketplace Photo Optimizer State
  const [showPhotoOptimizerModal, setShowPhotoOptimizerModal] = useState<boolean>(false);
  const [optimizerImageSrc, setOptimizerImageSrc] = useState<string | null>(null);
  const [optimizedImageResult, setOptimizedImageResult] = useState<string | null>(null);
  const [imageMetrics, setImageMetrics] = useState<{
    width: number;
    height: number;
    isSquare: boolean;
    isZoomable: boolean;
  } | null>(null);

  const gtinMutation = useMutation({
    mutationFn: (data: any) => marketplaceSyncApi.generateGtinExemption(data),
    onSuccess: (res) => {
      setGtinResult(res);
      toast.success('تم توليد ملف وخطاب طلب إعفاء الباركود الدولي بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل توليد طلب الإعفاء'),
  });

  const handleOptimizeProductImage = (dataUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const isSquare = Math.abs(img.naturalWidth - img.naturalHeight) < 5;
      const isZoomable = img.naturalWidth >= 1000 && img.naturalHeight >= 1000;
      setImageMetrics({
        width: img.naturalWidth,
        height: img.naturalHeight,
        isSquare,
        isZoomable,
      });

      const targetSize = 1500;
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fill pure white background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetSize, targetSize);

      // Scale to fit 85% of canvas (~1275px)
      const maxDim = targetSize * 0.85;
      const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight);
      const scaledW = img.naturalWidth * scale;
      const scaledH = img.naturalHeight * scale;
      const posX = (targetSize - scaledW) / 2;
      const posY = (targetSize - scaledH) / 2;

      ctx.drawImage(img, posX, posY, scaledW, scaledH);

      try {
        const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 235 && g > 235 && b > 235) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Fallback without pixel manipulation if tainted
      }

      const resultUrl = canvas.toDataURL('image/jpeg', 0.94);
      setOptimizedImageResult(resultUrl);
    };
    img.src = dataUrl;
  };

  return {
    showGtinModal,
    setShowGtinModal,
    gtinForm,
    setGtinForm,
    gtinResult,
    setGtinResult,
    gtinLanguage,
    setGtinLanguage,
    gtinMutation,
    showPhotoOptimizerModal,
    setShowPhotoOptimizerModal,
    optimizerImageSrc,
    setOptimizerImageSrc,
    optimizedImageResult,
    setOptimizedImageResult,
    imageMetrics,
    setImageMetrics,
    handleOptimizeProductImage,
  };
}

{/* ========================================================================= */}
{/* MODAL 12: GTIN / BARCODE EXEMPTION ASSISTANT */}
{/* ========================================================================= */}
export interface GtinExemptionModalProps {
  showGtinModal: boolean;
  setShowGtinModal: Dispatch<SetStateAction<boolean>>;
  gtinForm: ReturnType<typeof useMarketplaceAssistants>['gtinForm'];
  setGtinForm: ReturnType<typeof useMarketplaceAssistants>['setGtinForm'];
  gtinResult: GtinExemptionApplication | null;
  setGtinResult: Dispatch<SetStateAction<GtinExemptionApplication | null>>;
  gtinLanguage: 'en' | 'ar';
  setGtinLanguage: Dispatch<SetStateAction<'en' | 'ar'>>;
  gtinMutation: ReturnType<typeof useMarketplaceAssistants>['gtinMutation'];
  availableProducts: Product[];
}

export function GtinExemptionModal({ showGtinModal, setShowGtinModal, gtinForm, setGtinForm, gtinResult, setGtinResult, gtinLanguage, setGtinLanguage, gtinMutation, availableProducts }: GtinExemptionModalProps) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={showGtinModal}
      onClose={() => { setShowGtinModal(false); setGtinResult(null); }}
      width="min(760px, 95vw)"
      ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s706', "طلب إعفاء الباركود الدولي")}
    >
      <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s707', "طلب إعفاء رسمي من الباركود الدولي (GTIN / EAN Exemption Assistant)")}
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s708', "توليد ملف طلب رسمي موجه لأمازون أو نون لإدراج منتجاتك المحلية أو الخاصة دون شراء باركود دولي GS1.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowGtinModal(false); setGtinResult(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
          >
            <XIcon size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s709', "اختيار الصنف من الـ ERP")}
            </label>
            <select
              value={gtinForm.productId || 0}
              onChange={(e) => setGtinForm({ ...gtinForm, productId: parseInt(e.target.value, 10) || undefined })}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
            >
              <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s710', "-- طلب إعفاء عام / صنف محدد --")}</option>
              {availableProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s711', "اسم البراند / العلامة التجارية *")}
            </label>
            <input
              type="text"
              value={gtinForm.brandName}
              onChange={(e) => setGtinForm({ ...gtinForm, brandName: e.target.value })}
              placeholder={t('settings.workspace_sections.settings_marketplaces_section.s712', "مثال: Generic أو اسم علامتك")}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s713', "فئة المنتج (Category) *")}
            </label>
            <input
              type="text"
              value={gtinForm.category}
              onChange={(e) => setGtinForm({ ...gtinForm, category: e.target.value })}
              placeholder={t('settings.workspace_sections.settings_marketplaces_section.s714', "مثال: Fashion, Home & Kitchen")}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s715', "المنصة المستهدفة")}
            </label>
            <select
              value={gtinForm.marketplace}
              onChange={(e) => setGtinForm({ ...gtinForm, marketplace: e.target.value as any })}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
            >
              <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s716', "أمازون (Amazon SP-API)")}</option>
              <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s717', "نون (Noon Marketplace)")}</option>
            </select>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s718', "سبب طلب الإعفاء (Exemption Reason)")}
            </label>
            <select
              value={gtinForm.reason}
              onChange={(e) => setGtinForm({ ...gtinForm, reason: e.target.value as any })}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
            >
              <option value="unbranded">{t('settings.workspace_sections.settings_marketplaces_section.s719', "منتج عام بدون علامة تجارية (Generic / Unbranded item)")}</option>
              <option value="private_label">{t('settings.workspace_sections.settings_marketplaces_section.s720', "منتج علامة خاصة مصنع خصيصاً لنا (Private Label Product)")}</option>
              <option value="custom_manufacturing">{t('settings.workspace_sections.settings_marketplaces_section.s721', "منتجات يدوية أو تفصيلية لا تخضع للترقيم الدولي (Handmade / Custom)")}</option>
              <option value="parts_accessories">{t('settings.workspace_sections.settings_marketplaces_section.s722', "قطع غيار أو إكسسوارات تكميلية غير معبأة بباركود (Parts & Accessories)")}</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button
            variant="primary"
            onClick={() => {
              if (!gtinForm.brandName.trim()) {
                toast.error(t('settings.workspace_sections.settings_marketplaces_section.s723', "يرجى كتابة اسم البراند أو كتابة Generic"));
                return;
              }
              gtinMutation.mutate(gtinForm);
            }}
            disabled={gtinMutation.isPending}
            style={{ background: '#170e5e', color: '#ffffff' }}
          >
            {gtinMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s724', "جاري توليد ملف الإعفاء...") : t('settings.workspace_sections.settings_marketplaces_section.s725', "توليد خطاب وطلب الإعفاء الرسمي")}
          </Button>
        </div>

        {gtinResult ? (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setGtinLanguage('en')}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    background: gtinLanguage === 'en' ? '#ffffff' : 'transparent',
                    color: gtinLanguage === 'en' ? '#170e5e' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  English (Amazon / Noon Support)
                </button>
                <button
                  type="button"
                  onClick={() => setGtinLanguage('ar')}
                  style={{
                    padding: '4px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    background: gtinLanguage === 'ar' ? '#ffffff' : 'transparent',
                    color: gtinLanguage === 'ar' ? '#170e5e' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s726', "العربية")}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const text = gtinLanguage === 'en' ? gtinResult.letterEn : gtinResult.letterAr;
                  navigator.clipboard.writeText(text);
                  toast.success(t('settings.workspace_sections.settings_marketplaces_section.s727', "تم نسخ خطاب الإعفاء بنجاح"));
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <CopyIcon size={13} />
                {t('settings.workspace_sections.settings_marketplaces_section.s728', "نسخ نص الخطاب")}
              </Button>
            </div>

            <div
              dir={gtinLanguage === 'en' ? 'ltr' : 'rtl'}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '14px',
                maxHeight: '220px',
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '11.5px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                color: '#1e293b',
              }}
            >
              {gtinLanguage === 'en' ? gtinResult.letterEn : gtinResult.letterAr}
            </div>

            {/* Instructions */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#166534', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s729', "خطوات تقديم الطلب لدى المنصة للحصول على الموافقة الفورية:")}
              </div>
              <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#15803d', lineHeight: '1.6' }}>
                {gtinResult.submissionInstructions.map((ins, i) => (
                  <li key={i}>{ins}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}

{/* ========================================================================= */}
{/* MODAL 13: MARKETPLACE PHOTO READINESS & OPTIMIZER */}
{/* ========================================================================= */}
export interface PhotoOptimizerModalProps {
  showPhotoOptimizerModal: boolean;
  setShowPhotoOptimizerModal: Dispatch<SetStateAction<boolean>>;
  optimizerImageSrc: string | null;
  setOptimizerImageSrc: Dispatch<SetStateAction<string | null>>;
  optimizedImageResult: string | null;
  setOptimizedImageResult: Dispatch<SetStateAction<string | null>>;
  imageMetrics: ReturnType<typeof useMarketplaceAssistants>['imageMetrics'];
  setImageMetrics: ReturnType<typeof useMarketplaceAssistants>['setImageMetrics'];
  handleOptimizeProductImage: ReturnType<typeof useMarketplaceAssistants>['handleOptimizeProductImage'];
}

export function PhotoOptimizerModal({ showPhotoOptimizerModal, setShowPhotoOptimizerModal, optimizerImageSrc, setOptimizerImageSrc, optimizedImageResult, setOptimizedImageResult, imageMetrics, setImageMetrics, handleOptimizeProductImage }: PhotoOptimizerModalProps) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={showPhotoOptimizerModal}
      onClose={() => { setShowPhotoOptimizerModal(false); setOptimizerImageSrc(null); setOptimizedImageResult(null); setImageMetrics(null); }}
      width="min(760px, 95vw)"
      ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s730', "فاحص ومحسن صور المنتجات")}
    >
      <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s731', "فاحص ومحسن صور المنتجات للمنصات (Marketplace Photo Studio)")}
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s732', "فحص وضبط صور المنتجات تلقائياً لتوافق معايير أمازون ونون (خلفية بيضاء نقية 100%، مقاس 1500x1500px، ومطابقة التكبير Zoom).")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowPhotoOptimizerModal(false); setOptimizerImageSrc(null); setOptimizedImageResult(null); setImageMetrics(null); }}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Upload Area */}
        <div
          style={{
            border: '2px dashed #cbd5e1',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
            background: '#f8fafc',
            cursor: 'pointer',
          }}
          onClick={() => {
            const fileInput = document.getElementById('marketplace-photo-file-input') as HTMLInputElement;
            fileInput?.click();
          }}
        >
          <input
            id="marketplace-photo-file-input"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (event) => {
                const url = event.target?.result as string;
                setOptimizerImageSrc(url);
                handleOptimizeProductImage(url);
              };
              reader.readAsDataURL(file);
            }}
          />
          <div style={{ color: '#170e5e', marginBottom: '8px' }}>
            <CameraIcon size={32} />
          </div>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s733', "انقر لاختيار صورة المنتج من جهازك أو اسحبها هنا")}
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s734', "يدعم صور الهاتف والكاميرا بصيغ (JPEG, PNG, WebP)")}
          </div>
        </div>

        {/* Analysis & Split Comparison View */}
        {optimizerImageSrc && imageMetrics ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Metrics Pills */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', background: '#f1f5f9', color: '#334155' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s735', "الأبعاد الأصلية:")} <strong>{imageMetrics.width} × {imageMetrics.height} px</strong>
              </span>
              <span
                style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: imageMetrics.isZoomable ? '#dcfce7' : '#fee2e2',
                  color: imageMetrics.isZoomable ? '#166534' : '#991b1b',
                  fontWeight: 700,
                }}
              >
                {imageMetrics.isZoomable ? t('settings.workspace_sections.settings_marketplaces_section.s736', "✓ دقة فائقة تفعل التكبير (Zoom Ready)") : t('settings.workspace_sections.settings_marketplaces_section.s737', "⚠ أقل من 1000px (ستتم مضاعفة الدقة)")}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#e0e7ff',
                  color: '#3730a3',
                  fontWeight: 700,
                }}
              >
                {t('settings.workspace_sections.settings_marketplaces_section.s738', "الناتج المحسن: 1500 × 1500 px (مربع 1:1)")}
              </span>
            </div>

            {/* Split Preview */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {/* Original */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', textAlign: 'center', background: '#f8fafc' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s739', "الصورة الأصلية المرفوعة")}</div>
                <div style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <img src={optimizerImageSrc} alt="Original" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>
              </div>

              {/* Optimized */}
              <div style={{ border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px', textAlign: 'center', background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#16a34a', marginBottom: '8px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s740', "النتيجة المحسنة بخلفية بيضاء 100%")}</div>
                <div style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#ffffff', border: '1px solid #00000010' }}>
                  {optimizedImageResult ? (
                    <img src={optimizedImageResult} alt="Optimized" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : null}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" onClick={() => { setOptimizerImageSrc(null); setOptimizedImageResult(null); }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s741', "إعادة اختيار صورة أخرى")}
              </Button>
              {optimizedImageResult ? (
                <a
                  href={optimizedImageResult}
                  download="marketplace-optimized-product.jpg"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#170e5e',
                    color: '#ffffff',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  <DownloadIcon size={14} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s742', "تحميل الصورة المجهزة (1500x1500px JPEG)")}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}
