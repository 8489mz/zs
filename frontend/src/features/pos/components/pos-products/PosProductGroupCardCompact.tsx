/**
 * Compact variant of the product-grid card.
 *
 * Pure move of one JSX return from the panel file. The variant keeps its
 * own translation hook; every value it reads arrives as a prop. No
 * behavior change.
 */

import { StarIcon, PlusIcon, ChevronDownIcon } from '@/shared/components/icons/AppIcons';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { useCachedT } from '@/features/pos/lib/cached-t';
import type { PosProductGroupCardProps } from '@/features/pos/components/PosProductsPanel';

export function PosProductGroupCardCompact({
  groupKey,
  index,
  title,
  hasVariants,
  variantCount,
  imageUrl,
  iconName,
  isSelected,
  isFavorite,
  isOutOfStock,
  isMobile,
  mobileGridColumns,
  showCardIcon,
  cardRefs,
  onActivate,
  onToggleFavorite,
  priceLabel,
}: PosProductGroupCardProps & { priceLabel: string }) {
  const t = useCachedT();
  return (
    <article
      className={`pos-group-card ${isSelected ? 'is-selected' : ''} ${isOutOfStock ? 'is-out-of-stock' : ''}`}
      style={{
        background: isOutOfStock ? '#f8fafc' : 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        border: isSelected
          ? '1px solid #0f172a'
          : isOutOfStock
          ? '1px dashed #cbd5e1'
          : '1px solid rgba(148, 163, 184, 0.28)',
        borderRadius: '8px',
        padding: isMobile ? (mobileGridColumns === '3' ? '5px 5px' : '6px 8px') : '8px 10px',
        boxShadow: isSelected ? '0 0 0 1px #0f172a' : '0 1px 3px rgba(15, 23, 42, 0.03)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: isMobile ? (mobileGridColumns === '3' ? '106px' : '112px') : '114px',
        minHeight: isMobile ? (mobileGridColumns === '3' ? '106px' : '112px') : '114px',
        maxHeight: isMobile ? (mobileGridColumns === '3' ? '106px' : '112px') : '114px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
        opacity: isOutOfStock ? 0.55 : 1,
        filter: isOutOfStock ? 'grayscale(0.65)' : undefined,
        outline: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        ref={(node) => { cardRefs.current[index] = node; }}
        role="button"
        tabIndex={0}
        dir="rtl"
        className="pos-group-card-action"
        onClick={() => onActivate(groupKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(groupKey);
          }
        }}
        style={{
          border: 'none',
          background: 'transparent',
          textAlign: 'right',
          direction: 'rtl',
          padding: 0,
          width: '100%',
          cursor: isOutOfStock ? 'not-allowed' : 'pointer',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          height: '100%',
          justifyContent: 'space-between',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', width: '100%', marginBottom: '6px', direction: 'rtl' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, direction: 'rtl' }}>
            {imageUrl ? (
              <div className="pos-card-product-img" style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}>
                <img
                  src={imageUrl}
                  alt={title}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  loading="lazy"
                />
              </div>
            ) : showCardIcon ? (
              <div className="pos-card-product-icon" style={{
                width: '26px',
                height: '26px',
                borderRadius: '5px',
                background: '#f8fafc',
                color: 'var(--product-icon-color, #2563eb)',
                border: '1px solid #e2e8f0',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <ProductIcon name={iconName || 'box-package'} size={15} />
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong
                style={{
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: 1.3,
                }}
              >
                {title}
              </strong>
              {hasVariants ? (
                <div style={{ marginTop: '3px' }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #dbeafe' }}>
                    {variantCount} {t('pos.options', 'خيارات')}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className={`pos-favorite-star ${isFavorite ? 'is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(groupKey);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            aria-label={isFavorite ? t('pos.pos_products_panel.s30', "إزالة من المفضلة") : t('pos.pos_products_panel.s31', "إضافة إلى المفضلة")}
            style={{
              border: 'none',
              background: 'transparent',
              color: isFavorite ? '#f59e0b' : '#cbd5e1',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            <StarIcon size={14} filled={isFavorite} color={isFavorite ? '#f59e0b' : '#cbd5e1'} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '4px',
            borderTop: '1px solid rgba(148, 163, 184, 0.16)',
            paddingTop: '4px',
            marginTop: 'auto',
            width: '100%',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: isMobile ? '0.82rem' : '0.92rem',
              fontWeight: 800,
              color: '#0f172a',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              flexShrink: 1,
            }}
            title={priceLabel}
          >
            {priceLabel}
          </span>

          <span
            className="pos-card-add-pill"
            style={{
              fontSize: isMobile ? '0.66rem' : '0.7rem',
              fontWeight: 700,
              padding: isMobile ? '2px 5px' : '2px 7px',
              borderRadius: '5px',
              background: isOutOfStock ? '#fee2e2' : hasVariants ? '#eff6ff' : '#ecfdf5',
              color: isOutOfStock ? '#b91c1c' : hasVariants ? '#1d4ed8' : '#047857',
              border: isOutOfStock ? '1px solid #fecaca' : hasVariants ? '1px solid #dbeafe' : '1px solid #a7f3d0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {isOutOfStock ? (
              t('pos.out_of_stock', 'نفد')
            ) : hasVariants ? (
              <>
                <span>{t('pos.options_short', 'خيارات')}</span>
                <ChevronDownIcon size={10} strokeWidth={2.5} style={{ flexShrink: 0 }} />
              </>
            ) : (
              <>
                <PlusIcon size={10} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                <span>{t('pos.add_short', 'أضف')}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
