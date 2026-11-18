// Group option picker — the chooser shown when a product group is opened
// from the panel. Pure move; the panel keeps all state and mounts this
// component with the open group and its callbacks.

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PlusIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrencyWithCode } from '@/lib/format';
import { type PosProductGroup } from '@/features/pos/lib/pos-product-groups';
import type { Product } from '@/types/domain';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { toast } from '@/shared/components/system-alert';

function getArabicColorHex(colorName?: string): string | null {
  if (!colorName) return null;
  const name = colorName.trim().toLowerCase();
  const map: Record<string, string> = {
    'ابيض': '#ffffff',
    'أبيض': '#ffffff',
    'اسود': '#0f172a',
    'أسود': '#0f172a',
    'كحلي': '#1e3a8a',
    'احمر': '#dc2626',
    'أحمر': '#dc2626',
    'ازرق': '#2563eb',
    'أزرق': '#2563eb',
    'اخضر': '#16a34a',
    'أخضر': '#16a34a',
    'رمادي': '#64748b',
    'رصاصي': '#64748b',
    'بيج': '#d4b996',
    'بني': '#78350f',
    'بنى': '#78350f',
    'اصفر': '#eab308',
    'أصفر': '#eab308',
    'وردي': '#ec4899',
    'بينك': '#ec4899',
    'برتقالي': '#ea580c',
    'زيتي': '#556b2f',
    'زيتوني': '#556b2f',
    'نبيتي': '#800020',
    'عنابي': '#701a75',
    'سماوي': '#0ea5e9',
    'موف': '#8b5cf6',
    'بنفسجي': '#8b5cf6',
    'فضي': '#cbd5e1',
    'ذهبي': '#eab308',
    'خردلي': '#d97706',
    'هافان': '#c2410c',
    'ليموني': '#a3e635',
    'تركواز': '#06b6d4',
  };
  return map[name] || null;
}

function InlineGroupPicker({
  group,
  onClose,
  onAddProduct,
  priceType,
  searchInputRef,
  allowNegativeStockSales = false,
  isMobile: isMobileProp,
  focusSearchInput,
}: {
  group: PosProductGroup;
  onClose: () => void;
  onAddProduct: (product: Product) => void;
  priceType: PosPriceType;
  searchInputRef: RefObject<HTMLInputElement | null>;
  allowNegativeStockSales?: boolean;
  isMobile?: boolean;
  focusSearchInput: (ref: RefObject<HTMLInputElement | null>) => void;
}) {
  const { t } = useTranslation();
  const isMobileHook = useIsMobile(900);
  const isMobile = isMobileProp !== undefined ? isMobileProp : isMobileHook;
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');

  // Start with all options visible so cashier can pick immediately
  useEffect(() => {
    setSelectedColor('');
    setSelectedSize('');
  }, [group.key]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        onClose();
        if (!isMobile) focusSearchInput(searchInputRef);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, searchInputRef, isMobile]);

  const filteredProducts = useMemo(() => {
    return group.products.filter((product) => {
      if (selectedColor && String(product.color || '') !== selectedColor) return false;
      if (selectedSize && String(product.size || '') !== selectedSize) return false;
      return true;
    });
  }, [selectedColor, selectedSize, group.products]);

  // Only show filter chips when there are multi-dimensional options (colors AND sizes)
  // or a very long list of single options (>6). If items only have 3 colors, the rows themselves are the colors!
  const showColorFilter = (group.colors.length > 1 && group.sizes.length > 0) || group.colors.length > 6;
  const showSizeFilter = (group.sizes.length > 1 && group.colors.length > 0) || group.sizes.length > 6;

  const pickerContent = (
    <div className={`pos-inline-picker-overlay ${isMobile ? 'is-mobile' : 'is-desktop'}`} role="presentation">
      <button
        type="button"
        className="pos-inline-picker-backdrop"
        aria-label={t('pos.pos_inline_picker.close_picker', "إغلاق الاختيارات")}
        onClick={() => {
          onClose();
          if (!isMobile) focusSearchInput(searchInputRef);
        }}
      />
      <section className="pos-inline-picker-panel" aria-label={`اختيارات ${group.title}`} dir="rtl">
        {/* Mobile top drag handle */}
        {isMobile && (
          <div
            className="pos-sheet-drag-handle"
            style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              backgroundColor: '#cbd5e1',
              margin: '0 auto 6px auto',
              flexShrink: 0,
            }}
          />
        )}

        {/* Compact Header */}
        <div className="pos-inline-picker-head">
          <div className="pos-inline-picker-head-info">
            <span style={{ width: '3.5px', height: '16px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block', flexShrink: 0 }} />
            {group.imageUrl ? (
              <img
                src={group.imageUrl}
                alt={group.title}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '6px',
                  objectFit: 'contain',
                  border: '1px solid #e2e8f0',
                  flexShrink: 0,
                  background: '#ffffff',
                }}
              />
            ) : group.products[0]?.icon ? (
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '6px',
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  border: '1px solid #dbeafe',
                }}
              >
                <ProductIcon name={group.products[0].icon} size={15} />
              </div>
            ) : null}
            <h4 title={group.title}>{group.title}</h4>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '6px',
                background: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #dbeafe',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {filteredProducts.length} {t('pos.pos_inline_picker.options_count', 'خيار')}
            </span>
          </div>

          <button
            type="button"
            className="pos-inline-picker-close-btn"
            aria-label={t('pos.pos_inline_picker.close', 'إغلاق')}
            onClick={() => {
              onClose();
              if (!isMobile) focusSearchInput(searchInputRef);
            }}
            style={{
              width: '28px',
              height: '28px',
              minHeight: '28px',
              maxHeight: '28px',
              borderRadius: '50%',
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            <XIcon size={14} strokeWidth={2.4} color="#64748b" style={{ display: 'block', margin: 'auto' }} />
          </button>
        </div>

        {/* Color Filter Chips (shown only when relevant) */}
        {showColorFilter ? (
          <div className="pos-inline-picker-filter-block">
            <span>{t('pos.pos_inline_picker.color', "اللون")}:</span>
            <div className="pos-chip-row">
              <button
                type="button"
                className={`pos-option-chip ${!selectedColor ? 'is-active' : ''}`}
                onClick={() => setSelectedColor('')}
              >
                {t('common.all', 'الكل')}
              </button>
              {group.colors.map((color) => {
                const isActive = selectedColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    className={`pos-option-chip ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      const nextColor = isActive ? '' : color;
                      setSelectedColor(nextColor);
                      if (nextColor && selectedSize) {
                        const hasCombo = group.products.some((p) => String(p.color || '') === nextColor && String(p.size || '') === selectedSize);
                        if (!hasCombo) {
                          const availableSize = group.products.find((p) => String(p.color || '') === nextColor)?.size || '';
                          setSelectedSize(availableSize);
                        }
                      }
                    }}
                  >
                    {color}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Size Filter Chips (shown only when relevant) */}
        {showSizeFilter ? (
          <div className="pos-inline-picker-filter-block">
            <span>{group.colors.length ? t('pos.pos_inline_picker.size_unit', "المقاس") : t('pos.pos_inline_picker.option', "الاختيار")}:</span>
            <div className="pos-chip-row">
              <button
                type="button"
                className={`pos-option-chip ${!selectedSize ? 'is-active' : ''}`}
                onClick={() => setSelectedSize('')}
              >
                {t('common.all', 'الكل')}
              </button>
              {group.sizes.map((size) => {
                const isActive = selectedSize === size;
                return (
                  <button
                    key={size}
                    type="button"
                    className={`pos-option-chip ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      const nextSize = isActive ? '' : size;
                      setSelectedSize(nextSize);
                      if (nextSize && selectedColor) {
                        const hasCombo = group.products.some((p) => String(p.color || '') === selectedColor && String(p.size || '') === nextSize);
                        if (!hasCombo) {
                          const availableColor = group.products.find((p) => String(p.size || '') === nextSize)?.color || '';
                          setSelectedColor(availableColor);
                        }
                      }
                    }}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Scrollable Variants Container */}
        <div className="pos-inline-picker-body">
          {filteredProducts.length === 0 ? (
            <div
              style={{
                padding: '20px 12px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span>{t('pos.pos_inline_picker.no_matches', 'لا توجد خيارات مطابقة لهذا التحديد')}</span>
              <button
                type="button"
                className="pos-option-chip is-active"
                onClick={() => { setSelectedColor(''); setSelectedSize(''); }}
              >
                {t('pos.pos_inline_picker.reset_filters', 'عرض كافة الخيارات')}
              </button>
            </div>
          ) : (
            <div className="pos-variant-row-list">
              {filteredProducts.map((product) => {
                // INV-VAN-PRICE-LIST-WIRING: the 4-tier display price
                // (same fallback order as getProductPrice on the
                // server: half-wholesale → wholesale → retail).
                const price = priceType === 'wholesale' ? (product.wholesalePrice || product.retailPrice)
                  : priceType === 'half_wholesale' ? (product.halfWholesalePrice || product.wholesalePrice || product.retailPrice)
                  : priceType === 'credit' ? (product.creditPrice || product.retailPrice)
                  : product.retailPrice;
                const isOutOfStock = !allowNegativeStockSales && (product.itemType !== 'service') && !product.hasBom && (Number(product.stock) || 0) <= 0;
                const variantLabel = [product.color, product.size].filter(Boolean).join(' / ') || product.name;
                const colorHex = getArabicColorHex(product.color);

                return (
                  <button
                    key={product.id}
                    type="button"
                    className={`pos-variant-row ${isOutOfStock ? 'is-out-of-stock' : ''}`}
                    onClick={() => {
                      if (isOutOfStock) {
                        toast.warning(t('pos.variant_out_of_stock_warning', 'هذا الاختيار نافذ من المخزون ولا يمكن بيعه حالياً'));
                        return;
                      }
                      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
                        try { navigator.vibrate(15); } catch { /* ignore */ }
                      }
                      onAddProduct(product);
                      onClose();
                      if (!isMobile) focusSearchInput(searchInputRef);
                    }}
                  >
                    {/* Right side: Color Dot + Variant Title + Stock */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1, textAlign: 'right' }}>
                      {colorHex ? (
                        <span
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            backgroundColor: colorHex,
                            border: colorHex === '#ffffff' ? '1.5px solid #cbd5e1' : '1px solid rgba(0,0,0,0.18)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                            flexShrink: 0,
                          }}
                        />
                      ) : null}

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                        <strong
                          style={{
                            fontSize: '13px',
                            fontWeight: 800,
                            color: isOutOfStock ? '#64748b' : '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                            lineHeight: 1.3,
                          }}
                          title={variantLabel}
                        >
                          {variantLabel}
                        </strong>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 600,
                            color: isOutOfStock ? '#dc2626' : '#16a34a',
                            marginTop: '1px',
                            lineHeight: 1.2,
                          }}
                        >
                          {isOutOfStock ? t('pos.out_of_stock', 'نفد من المخزون') : `${t('pos.available_stock', 'متوفر')}: ${product.stock}`}
                        </span>
                      </div>
                    </div>

                    {/* Left side: Price + Add Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 800,
                          color: isOutOfStock ? '#94a3b8' : '#170e5e',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatCurrencyWithCode(Number(price || 0))}
                      </span>

                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '4px 10px',
                          borderRadius: '7px',
                          background: isOutOfStock ? '#f1f5f9' : '#170e5e',
                          color: isOutOfStock ? '#94a3b8' : '#ffffff',
                          border: isOutOfStock ? '1px solid #e2e8f0' : 'none',
                          lineHeight: 1,
                          flexShrink: 0,
                          boxShadow: isOutOfStock ? 'none' : '0 1px 3px rgba(23, 14, 94, 0.25)',
                        }}
                      >
                        {isOutOfStock ? (
                          t('pos.out_of_stock', 'نفد')
                        ) : (
                          <>
                            <PlusIcon size={11} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                            <span>{t('pos.add_short', 'أضف')}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  return isMobile && typeof document !== 'undefined'
    ? createPortal(pickerContent, document.body)
    : pickerContent;
}
