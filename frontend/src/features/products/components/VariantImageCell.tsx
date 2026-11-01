import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { compressImage } from '@/shared/utils/image-compressor';
import { knockoutWhiteStudioBackground, trimCanvasTransparentBounds } from '@/shared/utils/background-knockout';
import { toast } from '@/shared/components/system-alert';
import { UploadIcon, XIcon, SlidersIcon, LayersIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

/**
 * Compact per-variant photo control for dense variant matrices.
 *
 * Deliberately NOT the full ProductImageUploadField: that component carries
 * a large dropzone UI, which is wrong multiplied across up to 400 matrix
 * rows. This cell produces the IDENTICAL stored value — the compressed data
 * URL from compressImage with the same options ProductImageUploadField uses
 * on its default (no-cut) path — so a bulk-created variant stores its photo
 * exactly like a single edit does, and the backend normalizes it through
 * StorefrontMediaService (SF-9).
 *
 * Background cutout lives here because fashion-group products have NO
 * single-variant edit screen: EditProductForm renders only the group matrix
 * when the product has a styleCode, so the full field's cutout buttons are
 * unreachable for variants. The two small buttons below reuse the EXACT
 * utils and handler semantics of ProductImageUploadField (instant canvas
 * knockout via background-knockout, AI cutout via a dynamic import of
 * ai-background-removal), run ON DEMAND per row only when clicked — no
 * heavy machinery is mounted per row. background-knockout.ts itself is
 * never modified; its exports are imported exactly as the field does.
 *
 * Cuts always process from the pristine uploaded photo (originalRef,
 * mirroring the field's rawOriginalDataUrl): re-cutting after a cut still
 * uses the original, and a failed cut keeps the current photo untouched.
 * Removal semantics are the caller's: onChange('') means "clear". The create
 * builder maps '' to undefined (inherit the parent photo); the group editor
 * keeps '' (clear the stored photo).
 */
export interface VariantImageCellProps {
  value?: string;
  disabled?: boolean;
  onChange: (imageUrl: string) => void;
}

export function VariantImageCell({ value, disabled = false, onChange }: VariantImageCellProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cutting, setCutting] = useState<'instant' | 'ai' | null>(null);
  const hasImage = Boolean(value && value.trim());
  const busy = isProcessing || cutting !== null;

  // Mirror the full field: remember the pristine photo so cuts process from
  // the original (a stored row loads with its stored value; '' clears it).
  useEffect(() => {
    if (!value) {
      originalRef.current = null;
      return;
    }
    if (!originalRef.current) originalRef.current = value;
  }, [value]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning(t('products.variant_image_cell.invalid', 'يرجى اختيار ملف صورة صالح (JPEG, PNG, WebP)'));
      return;
    }
    try {
      setIsProcessing(true);
      const result = await compressImage(file, {
        maxWidth: 1000,
        maxHeight: 1000,
        initialQuality: 0.88,
        maxSizeKb: 100,
        knockoutStudioBackground: false,
      });
      originalRef.current = result.dataUrl;
      onChange(result.dataUrl);
    } catch {
      toast.error(t('products.variant_image_cell.failed', 'فشل ضغط الصورة'));
    } finally {
      setIsProcessing(false);
    }
  }

  // Instant Quick Knockout — same handler semantics as ProductImageUploadField.
  async function handleInstantCut() {
    const source = originalRef.current || value;
    if (!source || disabled || busy) return;
    try {
      setCutting('instant');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error('تعذر قراءة الصورة للمعالجة'));
        img.src = source;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('فشل إنشاء محرك المعالجة');
      ctx.drawImage(img, 0, 0);
      const knocked = knockoutWhiteStudioBackground(ctx, canvas.width, canvas.height);
      if (knocked) {
        const trimmed = trimCanvasTransparentBounds(canvas);
        onChange(trimmed.toDataURL('image/webp', 0.85));
        toast.success(t('products.variant_image_cell.instant_done', 'تم التفريغ السريع لخلفية الصورة بنجاح'));
      } else {
        toast.info(t('products.variant_image_cell.instant_no_background', 'لم يتم رصد خلفية استوديو واضحة لتفريغها، الصورة محتفظة ببياناتها'));
      }
    } catch (err: any) {
      toast.error(t('products.variant_image_cell.instant_failed', `تعذر التفريغ السريع: ${err?.message || 'خطأ غير متوقع'}`));
    } finally {
      setCutting(null);
    }
  }

  // Professional AI Studio Cutout — same handler semantics as ProductImageUploadField.
  // The AI engine is dynamically imported on demand only, exactly like the field.
  async function handleAiCut() {
    const source = originalRef.current || value;
    if (!source || disabled || busy) return;
    try {
      setCutting('ai');
      const { removeBackgroundWithAi } = await import('@/shared/utils/ai-background-removal');
      const resultBlob = await removeBackgroundWithAi(source, undefined, {
        onSubjectWarning: () => {
          toast.warning(t('products.variant_image_cell.ai_no_subject', 'لم يتم العثور على منتج واضح في الصورة. يرجى مراجعة النتيجة قبل الحفظ.'));
        },
      });
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) || null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(resultBlob);
      });
      if (dataUrl) {
        onChange(dataUrl);
        toast.success(t('products.variant_image_cell.ai_done', 'تم التفريغ الاحترافي بنجاح بواسطة الذكاء الاصطناعي'));
      }
    } catch (err: any) {
      console.error('AI Cutout error:', err);
      toast.error(t('products.variant_image_cell.ai_failed', `تعذر إكمال التفريغ بالذكاء الاصطناعي: ${err?.message || 'خطأ غير متوقع'}`));
    } finally {
      setCutting(null);
    }
  }

  const cutButtonStyle: CSSProperties = {
    width: '18px', height: '18px', borderRadius: '6px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', padding: 0, flexShrink: 0,
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled || busy}
        onChange={handleFileChange}
      />
      {hasImage ? (
        <>
          <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
            <img
              src={value}
              alt={t('products.variant_image_cell.photo', 'صورة المتغير')}
              style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'block', cursor: disabled || busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}
              onClick={() => { if (!disabled && !busy) fileInputRef.current?.click(); }}
            />
            <button
              type="button"
              title={t('products.variant_image_cell.remove', 'إزالة الصورة')}
              aria-label={t('products.variant_image_cell.remove', 'إزالة الصورة')}
              disabled={disabled || busy}
              onClick={() => onChange('')}
              style={{
                position: 'absolute', top: '-6px', insetInlineStart: '-6px',
                width: '16px', height: '16px', borderRadius: '50%',
                border: '1px solid #fecaca', background: '#fee2e2', color: '#b91c1c',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', padding: 0, flexShrink: 0,
              }}
            >
              <XIcon size={9} />
            </button>
          </span>
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
            <button
              type="button"
              title={t('products.variant_image_cell.instant_cut', 'تفريغ سريع لخلفية الاستوديو')}
              aria-label={t('products.variant_image_cell.instant_cut', 'تفريغ سريع لخلفية الاستوديو')}
              disabled={disabled || busy}
              onClick={handleInstantCut}
              style={{ ...cutButtonStyle, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', opacity: busy ? 0.5 : 1 }}
            >
              {cutting === 'instant' ? <RefreshCwIcon size={10} className="spin" /> : <SlidersIcon size={10} />}
            </button>
            <button
              type="button"
              title={t('products.variant_image_cell.ai_cut', 'قص احترافي بالذكاء الاصطناعي')}
              aria-label={t('products.variant_image_cell.ai_cut', 'قص احترافي بالذكاء الاصطناعي')}
              disabled={disabled || busy}
              onClick={handleAiCut}
              style={{ ...cutButtonStyle, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', opacity: busy ? 0.5 : 1 }}
            >
              {cutting === 'ai' ? <RefreshCwIcon size={10} className="spin" /> : <LayersIcon size={10} />}
            </button>
          </span>
        </>
      ) : (
        <button
          type="button"
          title={t('products.variant_image_cell.upload', 'رفع صورة المتغير')}
          aria-label={t('products.variant_image_cell.upload', 'رفع صورة المتغير')}
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '36px', height: '36px', borderRadius: '6px',
            border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0, flexShrink: 0, opacity: busy ? 0.5 : 1,
          }}
        >
          <UploadIcon size={15} />
        </button>
      )}
    </span>
  );
}
