import { useState } from 'react';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';

export function ProductThumbnail({
  imageUrl,
  icon,
  name,
  size = 28,
  onClick,
}: {
  imageUrl?: string | null;
  icon?: string | null;
  name: string;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = Boolean(imageUrl && !imgFailed);

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '6px',
        background: hasImage ? '#ffffff' : '#f8fafc',
        color: 'var(--product-icon-color, #2563eb)',
        border: '1px solid #e2e8f0',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        cursor: hasImage && onClick ? 'zoom-in' : 'inherit',
      }}
      onClick={hasImage && onClick ? onClick : undefined}
      title={hasImage ? `معاينة صورة ${name}` : undefined}
    >
      {hasImage ? (
        <img
          src={imageUrl!}
          alt={name}
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <ProductIcon name={icon || 'box-package'} size={size >= 28 ? 16 : 14} />
      )}
    </div>
  );
}
