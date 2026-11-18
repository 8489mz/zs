import { StarIcon } from '@/shared/components/icons/AppIcons';
import type { PosProductGroupCardProps } from '@/features/pos/types/pos.types';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { useCachedT } from '@/features/pos/lib/cached-t';

/**
 * Gallery card variant, extracted from the product panel.
 * Pure move of one card variant's markup. No behavior change: the
 * markup is byte-identical; the panel keeps the variant dispatch
 * and passes every value the markup reads as a prop. The card
 * interface and the density type live in the shared types file.
 */

export function PosProductGroupCardGallery({
  groupKey,
  index,
  title,
  hasVariants,
  variantCount,
  totalStock,
  itemKind,
  imageUrl,
  iconName,
  isSelected,
  isFavorite,
  isOutOfStock,
  isMobile,
  mobileGridColumns,
  cardRefs,
  onActivate,
  onToggleFavorite,
  priceLabel,
}: PosProductGroupCardProps & { priceLabel: string }) {
  const t = useCachedT();
  return (
    <article
      className={`pos-group-card pos-group-card-gallery ${isSelected ? 'is-selected' : ''} ${isOutOfStock ? 'is-out-of-stock' : ''}`}
      style={{
        background: isOutOfStock ? '#f8fafc' : '#ffffff',
        border: isSelected
          ? '1px solid #170e5e'
          : isOutOfStock
          ? '1px dashed #cbd5e1'
          : '1px solid #e2e8f0',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: isSelected ? '0 0 0 1px #170e5e' : '0 1px 4px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxSizing: 'border-box',
        padding: 0,
        height: '100%',
        maxWidth: isMobile ? '100%' : '190px',
        width: '100%',
        opacity: isOutOfStock ? 0.55 : 1,
        filter: isOutOfStock ? 'grayscale(0.65)' : undefined,
        transition: 'opacity 0.2s ease, border-color 0.2s ease',
      }}
    >
      {/* Top Right Floating Pill: Variants Count OR Available Stock Badge */}
      <div
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          zIndex: 2,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
        }}
      >
        {hasVariants ? (
          <span
            style={{
              fontSize: '9.5px',
              fontWeight: 800,
              padding: '2px 6px',
              borderRadius: '5px',
              background: 'rgba(239, 246, 255, 0.95)',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            {variantCount} {t('pos.options', 'خيارات')}
          </span>
        ) : (itemKind as string) !== 'service' && typeof totalStock === 'number' ? (
          isOutOfStock ? (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 800,
                padding: '2px 5px',
                borderRadius: '5px',
                background: 'rgba(254, 242, 242, 0.95)',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              {t('pos.out_of_stock', 'نفد')}
            </span>
          ) : totalStock > 0 && totalStock <= 5 ? (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 800,
                padding: '2px 5px',
                borderRadius: '5px',
                background: 'rgba(255, 251, 235, 0.95)',
                color: '#b45309',
                border: '1px solid #fde68a',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              {totalStock} {t('pos.left', 'متبقي')}
            </span>
          ) : (
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '5px',
                background: 'rgba(248, 250, 252, 0.92)',
                color: '#64748b',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              {totalStock}
            </span>
          )
        ) : null}
      </div>

      {/* Favorite Star Button (Ergonomic Touch Separation) */}
      <button
        type="button"
        className={`pos-favorite-star ${isFavorite ? 'is-active' : ''}`}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(groupKey);
        }}
        aria-label={isFavorite ? t('pos.pos_products_panel.s25', 'إزالة من المفضلة') : t('pos.pos_products_panel.s26', 'إضافة إلى المفضلة')}
        style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          zIndex: 3,
          background: isFavorite ? '#ffffff' : 'rgba(255, 255, 255, 0.92)',
          border: isFavorite ? '1px solid #fde68a' : '1px solid #e2e8f0',
          borderRadius: '50%',
          width: '26px',
          height: '26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          boxShadow: isFavorite ? '0 2px 6px rgba(245, 158, 11, 0.22)' : '0 1px 3px rgba(0, 0, 0, 0.08)',
          transition: 'transform 0.1s ease, background 0.15s ease',
        }}
      >
        <StarIcon size={12.5} filled={isFavorite} color={isFavorite ? '#f59e0b' : '#94a3b8'} />
      </button>

      {/* Card Action Button */}
      <button
        ref={(node) => { cardRefs.current[index] = node; }}
        type="button"
        className="pos-group-card-action"
        onClick={() => onActivate(groupKey)}
        style={{
          border: 'none',
          background: 'transparent',
          textAlign: 'center',
          padding: 0,
          width: '100%',
          cursor: isOutOfStock ? 'not-allowed' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flex: 1,
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
      >
        {/* Dominant Hero Image (Natural Square Proportion) */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            padding: isMobile && mobileGridColumns === '3' ? '4px' : isMobile ? '5px' : '8px',
            boxSizing: 'border-box',
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
              loading="lazy"
            />
          ) : (
            <div
              style={{
                width: isMobile ? '36px' : '48px',
                height: isMobile ? '36px' : '48px',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              <ProductIcon name={iconName || 'box-package'} size={isMobile ? 18 : 24} />
            </div>
          )}
        </div>

        {/* Clean Bottom Text Bar: Title + Price Directly Underneath */}
        <div
          style={{
            width: '100%',
            padding: isMobile && mobileGridColumns === '3' ? '4px 3px 5px' : isMobile ? '5px 5px 6px' : '8px 6px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            boxSizing: 'border-box',
            borderTop: '1px solid #f1f5f9',
            background: '#ffffff',
            minHeight: isMobile && mobileGridColumns === '3' ? '48px' : isMobile ? '52px' : '66px',
          }}
        >
          <strong
            style={{
              fontSize: isMobile && mobileGridColumns === '3' ? '10.5px' : isMobile ? '11.5px' : '12px',
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: '1.25',
              textAlign: 'center',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              wordBreak: 'break-word',
              width: '100%',
              minHeight: isMobile ? '24px' : '28px',
              boxSizing: 'border-box',
              padding: '0 2px',
            }}
            title={title}
          >
            {title}
          </strong>

          {/* Price Pill Capsule */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isMobile && mobileGridColumns === '3' ? '1.5px 5px' : isMobile ? '2px 6px' : '2px 8px',
              borderRadius: '5px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              maxWidth: '100%',
            }}
          >
            <span
              style={{
                fontSize: isMobile && mobileGridColumns === '3' ? '10.5px' : '11px',
                fontWeight: 800,
                color: '#170e5e',
                letterSpacing: '0.2px',
                direction: 'ltr',
                display: 'inline-block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {priceLabel}
            </span>
          </div>
        </div>
      </button>
    </article>
  );
}
