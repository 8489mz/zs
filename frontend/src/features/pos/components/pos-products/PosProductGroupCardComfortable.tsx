/**
 * Comfortable variant of the product-grid card.
 *
 * Pure move of one JSX return from the panel file. The variant keeps its
 * own translation hook; every value it reads arrives as a prop. No
 * behavior change.
 */

import { StarIcon } from '@/shared/components/icons/AppIcons';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { useCachedT } from '@/features/pos/lib/cached-t';
import type { PosProductGroupCardProps } from '@/features/pos/components/PosProductsPanel';

export function PosProductGroupCardComfortable({
  groupKey,
  index,
  title,
  hasVariants,
  variantCount,
  imageUrl,
  iconName,
  metaLabel,
  isSelected,
  isFavorite,
  isOutOfStock,
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
      style={isOutOfStock ? {
        opacity: 0.55,
        filter: 'grayscale(0.65)',
        border: '1px dashed #cbd5e1',
        background: '#f8fafc',
      } : undefined}
    >
      <div className="pos-group-card-top">
        <span
          className={`pos-group-kind ${hasVariants ? 'has-choices' : 'is-direct'}`}
          style={isOutOfStock ? { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' } : undefined}
        >
          {isOutOfStock
            ? t('pos.out_of_stock', 'نفد')
            : hasVariants
            ? `${variantCount} فرع`
            : t('pos.pos_products_panel.s24', "مباشر")}
        </span>
        <button
          type="button"
          className={`pos-favorite-star ${isFavorite ? 'is-active' : ''}`}
          onClick={() => onToggleFavorite(groupKey)}
          aria-label={isFavorite ? t('pos.pos_products_panel.s25', "إزالة من المفضلة") : t('pos.pos_products_panel.s26', "إضافة إلى المفضلة")}
        >
          <StarIcon size={14} filled={isFavorite} color={isFavorite ? '#f59e0b' : '#94a3b8'} />
        </button>
      </div>

      <button
        ref={(node) => { cardRefs.current[index] = node; }}
        type="button"
        dir="rtl"
        className="pos-group-card-action"
        onClick={() => onActivate(groupKey)}
        style={{ direction: 'rtl', textAlign: 'right', cursor: isOutOfStock ? 'not-allowed' : 'pointer', outline: 'none', WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '4px', width: '100%', direction: 'rtl', minHeight: '36px' }}>
          {imageUrl ? (
            <div className="pos-card-product-img" style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
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
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: '#f8fafc',
              color: 'var(--product-icon-color, #2563eb)',
              border: '1px solid #e2e8f0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <ProductIcon name={iconName || 'box-package'} size={16} />
            </div>
          ) : null}
          <strong
            style={{
              flex: 1,
              textAlign: 'right',
              minWidth: 0,
              fontSize: '13px',
              lineHeight: '1.38',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: '36px',
            }}
          >
            {title}
          </strong>
        </div>
        <div
          className="muted small pos-group-card-meta"
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            direction: 'rtl',
            textAlign: 'right',
            fontSize: '11px',
            color: '#64748b',
            height: '18px',
            minHeight: '18px',
            maxHeight: '18px',
            lineHeight: '18px',
            margin: '2px 0 6px',
          }}
          title={metaLabel}
        >
          {metaLabel}
        </div>
        <div className="pick-meta-row pos-pick-meta-row" style={{ direction: 'rtl', width: '100%' }}>
          <span>{priceLabel}</span>
          <span className="small muted">
            {isOutOfStock
              ? t('pos.out_of_stock', 'نفد')
              : hasVariants
              ? t('pos.pos_products_panel.s27', "افتح الاختيارات")
              : t('pos.pos_products_panel.s28', "أضف الآن")}
          </span>
        </div>
      </button>
    </article>
  );
}
