import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compressImage } from '@/shared/utils/image-compressor';
import { toast } from '@/shared/components/system-alert';
import { UploadIcon, XIcon } from '@/shared/components/icons/AppIcons';

/**
 * Compact per-variant photo control for dense variant matrices.
 *
 * Deliberately NOT the full ProductImageUploadField: that component carries
 * AI/instant background-cut modes and a large dropzone UI, which is wrong
 * multiplied across up to 400 matrix rows. This cell produces the IDENTICAL
 * stored value — the compressed data URL from compressImage with the same
 * options ProductImageUploadField uses on its default (no-cut) path — so a
 * bulk-created variant stores its photo exactly like a single edit does,
 * and the backend normalizes it through StorefrontMediaService (SF-9).
 * No background-removal code is imported or run here.
 *
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
  const [isProcessing, setIsProcessing] = useState(false);
  const hasImage = Boolean(value && value.trim());

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
      onChange(result.dataUrl);
    } catch {
      toast.error(t('products.variant_image_cell.failed', 'فشل ضغط الصورة'));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled || isProcessing}
        onChange={handleFileChange}
      />
      {hasImage ? (
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <img
            src={value}
            alt={t('products.variant_image_cell.photo', 'صورة المتغير')}
            style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'block', cursor: disabled || isProcessing ? 'default' : 'pointer', opacity: isProcessing ? 0.5 : 1 }}
            onClick={() => { if (!disabled && !isProcessing) fileInputRef.current?.click(); }}
          />
          <button
            type="button"
            title={t('products.variant_image_cell.remove', 'إزالة الصورة')}
            aria-label={t('products.variant_image_cell.remove', 'إزالة الصورة')}
            disabled={disabled || isProcessing}
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
      ) : (
        <button
          type="button"
          title={t('products.variant_image_cell.upload', 'رفع صورة المتغير')}
          aria-label={t('products.variant_image_cell.upload', 'رفع صورة المتغير')}
          disabled={disabled || isProcessing}
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '36px', height: '36px', borderRadius: '6px',
            border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0, flexShrink: 0, opacity: isProcessing ? 0.5 : 1,
          }}
        >
          <UploadIcon size={15} />
        </button>
      )}
    </span>
  );
}
