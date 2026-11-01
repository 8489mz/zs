import { useStorefrontLang } from '@/i18n';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import React from 'react';
import { StorefrontProduct } from '../types/storefront.types';
import { getAutoProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconArrowUpRight, IconShoppingCart } from './StorefrontIcons';

interface StorefrontAmazonQuadCardProps {
  categoryId: number;
  categoryName: string;
  totalCount: number;
  products: StorefrontProduct[];
  onSelectCategory: (id: number) => void;
  onAddToCart: (product: StorefrontProduct) => void;
  cartMap: Map<number, number>;
}

export const StorefrontAmazonQuadCard = React.memo(function StorefrontAmazonQuadCard({
  categoryId,
  categoryName,
  totalCount,
  products,
  onSelectCategory,
  onAddToCart,
  cartMap,
}: StorefrontAmazonQuadCardProps) {
  const { isEn, dir } = useStorefrontLang();
  const displayProducts = products.slice(0, 4);

  return (
    <div
      dir={dir}
      style={{
        background: '#ffffff',
        borderRadius: '22px',
        border: '1px solid #e2e8f0',
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        direction: dir,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 20px -4px rgba(15, 23, 42, 0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.03)';
      }}
    >
      <div>
        {/* Header: Amazon Style Title + Link */}
        <div
          onClick={() => onSelectCategory(categoryId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            marginBottom: '14px',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 800,
              color: '#0f172a',
              lineHeight: 1.3,
            }}
          >
            {isEn ? `Top Deals in ${categoryName}` : `أفضل العروض في ${categoryName}`}
          </h3>
          <span style={{ color: '#170e5e', display: 'flex', alignItems: 'center' }}>
            <IconArrowUpRight size={16} strokeWidth={2.2} />
          </span>
        </div>

        {/* 2x2 Grid (Amazon 4-Quad Products) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
          }}
        >
          {displayProducts.map((p) => {
            const photoUrl = p.imageUrl || getAutoProductPhoto(p.name, p.categoryName);
            const qty = cartMap.get(p.id) || 0;

            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  borderRadius: '14px',
                  background: '#f8fafc',
                  padding: '8px',
                  border: '1px solid #f1f5f9',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Product Thumbnail Container */}
                <div
                  style={{
                    width: '100%',
                    height: '115px',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    background: '#ffffff',
                    position: 'relative',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px',
                    boxSizing: 'border-box',
                  }}
                >
                  <img
                    src={photoUrl}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.src = generatePremiumProductSvg(p.name, p.categoryName);
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />

                  {/* Quick Add Button Overlay */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToCart(p);
                    }}
                    title={isEn ? 'Add to Cart' : 'إضافة للسلة'}
                    style={{
                      position: 'absolute',
                      bottom: '5px',
                      left: '5px',
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: qty > 0 ? '#10b981' : '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                      transition: 'transform 0.1s ease',
                    }}
                  >
                    {qty > 0 ? (
                      <span style={{ fontSize: '11.5px', fontWeight: 800 }}>{qty}</span>
                    ) : (
                      <IconShoppingCart size={14} strokeWidth={2.2} />
                    )}
                  </button>
                </div>

                {/* Price & Name */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', textAlign: 'left', gap: '4px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                    {p.price > 0 ? `${p.price} ${getGlobalCurrencySymbol()}` : isEn ? 'Inquire' : 'تواصل'}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '11.5px',
                    color: '#334155',
                    fontWeight: 500,
                    lineHeight: '1.35',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                  title={p.name}
                >
                  {p.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Link: Amazon Style "See more" */}
      <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
        <button
          type="button"
          onClick={() => onSelectCategory(categoryId)}
          style={{
            background: 'none',
            border: 'none',
            color: '#007185',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: 'pointer',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            flexWrap: 'wrap',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
        >
          <span>
            {isEn ? `Browse all ${categoryName}` : `تصفح كل أصناف ${categoryName}`}{' '}
            <span style={{ whiteSpace: 'nowrap' }}>({totalCount} {isEn ? 'items)' : 'صنف)'}</span>
          </span>
          <span>{isEn ? '→' : '←'}</span>
        </button>
      </div>
    </div>
  );
});
