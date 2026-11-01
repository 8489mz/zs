import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import { IconSearch } from './StorefrontIcons';
import { XIcon, TagIcon, PlusIcon, ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { storefrontApi } from '../api/storefront.api';
import type { StorefrontProduct } from '../types/storefront.types';
import { generatePremiumProductSvg } from '../lib/storefront-photo-matcher';

interface StorefrontPredictiveSearchProps {
  slug: string;
  storeName?: string;
  searchTerm: string;
  onSearchChange: (val: string) => void;
  onSelectCategory?: (categoryId: number) => void;
  onSelectProduct?: (product: StorefrontProduct) => void;
  onAddToCart?: (product: StorefrontProduct) => void;
  isScrolled?: boolean;
}

export const StorefrontPredictiveSearch = React.memo(function StorefrontPredictiveSearch({
  slug,
  storeName,
  searchTerm,
  onSearchChange,
  onSelectCategory,
  onSelectProduct,
  onAddToCart,
}: StorefrontPredictiveSearchProps) {
  const { t } = useTranslation();
  const placeholderText = storeName ? `البحث في ${storeName}` : t('storefront.storefront_predictive_search.s0', 'البحث في المتجر');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<{
    categories: Array<{ id: number; name: string }>;
    products: Array<any>;
  }>({ categories: [], products: [] });

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<any>(null);

  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSuggestions({ categories: [], products: [] });
      setIsOpen(false);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await storefrontApi.getSearchSuggestions(slug, q);
        setSuggestions({
          categories: res?.categories || [],
          products: res?.products || [],
        });
        setIsOpen(Boolean((res?.categories && res.categories.length > 0) || (res?.products && res.products.length > 0)));
      } catch {
        setSuggestions({ categories: [], products: [] });
      }
    }, 150);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchTerm, slug]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className="storefront-search-wrapper"
      style={{
        flex: '1 1 auto',
        width: '100%',
        maxWidth: '380px',
        minWidth: '120px',
        margin: '0 auto',
        justifySelf: 'center',
        position: 'relative',
      }}
    >
      <style>{`
        .sf-mobile-search-sliders {
          display: none;
        }
        .storefront-search-input,
        .storefront-search-input:focus,
        .storefront-search-input:focus-visible,
        .storefront-search-input:active {
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
          background: transparent !important;
          min-height: 0 !important;
          height: auto !important;
          border-radius: 0 !important;
        }
        @media (min-width: 769px) {
          .storefront-search-input:not(:focus)::placeholder {
            opacity: 0;
          }
        }
        @media (max-width: 768px) {
          .sf-search-idle-overlay {
            display: none !important;
          }
          .sf-search-leading-icon {
            opacity: 1 !important;
            color: var(--storefront-primary-color, #2d68c4) !important;
          }
          .storefront-search-input::placeholder {
            opacity: 1 !important;
            color: #94a3b8 !important;
            font-weight: 500 !important;
          }
          .sf-mobile-search-sliders {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--storefront-primary-color, #2d68c4);
            flex-shrink: 0;
            pointer-events: none;
            opacity: 0.9;
          }
        }
      `}</style>
      <div
        className="storefront-search-box"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '0 12px',
          border: isOpen ? '1.5px solid var(--storefront-primary-color, #2d68c4)' : '1px solid #E0E3E7',
          transition: 'border-color 0.16s ease, box-shadow 0.16s ease',
          boxShadow: isOpen ? '0 4px 16px rgba(45, 104, 196, 0.14)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
          boxSizing: 'border-box',
          height: '37px',
          position: 'relative',
        }}
      >
        {/* Centered Search Icon + "البحث في Z" exactly in the middle when idle (Desktop only) */}
        {!searchTerm && !isFocused && (
          <div
            className="sf-search-idle-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              color: '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            <IconSearch size={16} strokeWidth={2.2} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{placeholderText}</span>
          </div>
        )}

        <span
          className="sf-search-leading-icon"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: '#94a3b8',
            flexShrink: 0,
            opacity: !searchTerm && !isFocused ? 0 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          <IconSearch size={16} strokeWidth={2.2} />
        </span>
        <input
          className="storefront-search-input"
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            if (suggestions.categories.length > 0 || suggestions.products.length > 0) {
              setIsOpen(true);
            }
          }}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholderText}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '13px',
            fontWeight: 600,
            color: '#0f172a',
            background: 'transparent',
            padding: '6px 2px',
            fontFamily: 'inherit',
            boxShadow: 'none',
            minHeight: 'unset',
            minWidth: 0,
          }}
        />

        {searchTerm ? (
          <button
            type="button"
            onClick={() => {
              onSearchChange('');
              setIsOpen(false);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '4px 6px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
            }}
            title={t('storefront.storefront_predictive_search.s1', "مسح البحث")}
          >
            <XIcon size={15} />
          </button>
        ) : (
          <span className="sf-mobile-search-sliders" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="17" x2="20" y2="17" />
              <circle cx="9" cy="7" r="2.5" fill="#ffffff" />
              <circle cx="15" cy="17" r="2.5" fill="#ffffff" />
            </svg>
          </span>
        )}
      </div>

      {/* Instant Dropdown Results */}
      {isOpen && (
        <div
          className="storefront-predictive-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
            zIndex: 200,
            maxHeight: '440px',
            overflowY: 'auto',
            padding: '8px',
          }}
        >
          {/* Matched Categories */}
          {suggestions.categories.length > 0 && (
            <div style={{ marginBottom: '10px', padding: '4px 6px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#64748b',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <TagIcon size={12} />
                <span>{t('storefront.storefront_predictive_search.s3', "أقسام مطابقة:")}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {suggestions.categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onSelectCategory?.(cat.id);
                      setIsOpen(false);
                    }}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #dadce0',
                      borderRadius: '8px',
                      padding: '5px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#1f1f1f',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#e2e8f0';
                      e.currentTarget.style.color = 'var(--storefront-primary-color, #2d68c4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#f1f5f9';
                      e.currentTarget.style.color = '#1e293b';
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Matched Products */}
          {suggestions.products.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#64748b',
                  padding: '4px 6px',
                  marginBottom: '4px',
                }}
              >
                {t('storefront.storefront_predictive_search.s4', "المنتجات المقترحة:")}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {suggestions.products.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => {
                      onSelectProduct?.(prod);
                      setIsOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <img
                        src={prod.imageUrl || generatePremiumProductSvg(prod.name, prod.categoryName)}
                        alt={prod.name}
                        onError={(e) => {
                          e.currentTarget.src = generatePremiumProductSvg(prod.name, prod.categoryName);
                        }}
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '6px',
                          objectFit: 'cover',
                          background: '#f1f5f9',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 800,
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {prod.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                          {prod.categoryName || t('storefront.storefront_predictive_search.s5', "عام")}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <div style={{ textAlign: 'left' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 900, color: 'var(--storefront-primary-color, #2d68c4)' }}>
                          {Number(prod.price || 0).toLocaleString()}
                        </span>
                        <span style={{ fontSize: '10px', color: '#64748b', marginRight: '2px' }}>
                          <CurrencySymbol />
                        </span>
                      </div>

                      {prod.inStock && onAddToCart && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToCart(prod);
                          }}
                          style={{
                            background: 'var(--storefront-secondary-color, #d97706)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                          title={t('storefront.storefront_predictive_search.s6', "إضافة للسلة")}
                        >
                          <PlusIcon size={14} strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View All Matches Footer */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              marginTop: '6px',
              padding: '8px 10px',
              borderTop: '1px solid #f1f5f9',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 800,
              color: 'var(--storefront-primary-color, #2d68c4)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>{t('storefront.storefront_predictive_search.s7', "عرض نتائج البحث عن \"")}{searchTerm}"</span>
            <ArrowRightIcon size={13} style={{ transform: 'rotate(180deg)' }} />
          </div>
        </div>
      )}
    </div>
  );
});
