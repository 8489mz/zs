import { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatCurrencyWithCode } from '@/lib/format';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { FileTextIcon, TagIcon, SmartphoneIcon } from '@/shared/components/icons/AppIcons';
import { PosItemNotesDialog } from './PosItemNotesDialog';
import { PosLineSerialEntry } from './PosLineSerialEntry';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import type { Product } from '@/types/domain';
import type { PosCartPanelProps } from './posCartPanel.types';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';

const PosCartItemRow = memo(function PosCartItemRow({
  item,
  product,
  index,
  isSelected,
  isRecent,
  allowItemNotes,
  allowItemModifiers,
  isRestaurant,
  isMobile,
  onSelectLine,
  onEditProduct,
  _onItemNoteChange: _unusedNoteChange,
  onOpenItemNotes,

  onItemSeatChange,
  onItemModifiersClick,
  onQtyChange,
  onChangeLineQtyByDelta,
  onAddLineSerial,
  onRemoveLineSerial,
  onRemoveItem
}: any) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const lineTotal = calcCartLineTotal(item);
  const itemCode = String(item.itemCode || '').trim();
  const isWeightedLine = item.isWeighted === true;
  const minQty = isWeightedLine ? 0.001 : 1;
  const inputStep = isWeightedLine ? 0.001 : 1;
  const qtyLength = String(item.qty ?? 1).length;
  const dynamicInputWidth = `${Math.max(30, qtyLength * 11 + 16)}px`;
  const itemImage = item.imageUrl || product?.imageUrl || (product as any)?.metadata?.imageUrl;
  const rawIcon = item.icon || product?.icon || 'box-package';
  const thumbSize = isMobile ? '44px' : '52px';

  return (
    <div
      className={`list-row stacked-row pos-cart-row pos-cart-row-upgraded pos-cart-grid-row ${index % 2 === 0 ? 'pos-cart-row-odd' : 'pos-cart-row-even'} ${isSelected ? 'pos-cart-row-selected' : ''} ${isRecent ? 'pos-cart-row-highlight' : ''}`.trim()}
      key={item.lineKey}
      onClick={() => onSelectLine(item.lineKey)}
      style={{ transition: 'none', animation: 'none' }}
    >
      <div className="pos-cart-col pos-cart-col-index" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span className="pos-cart-index-badge">{index + 1}</span>
      </div>

      <div className="pos-cart-col pos-cart-col-thumb">
        {itemImage ? (
          <div
            className="pos-cart-product-thumb"
            style={{
              width: thumbSize,
              height: thumbSize,
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <img
              src={itemImage}
              alt={item.name}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              loading="lazy"
            />
          </div>
        ) : (
          <div
            className="pos-cart-product-thumb pos-cart-product-thumb-placeholder"
            style={{
              width: thumbSize,
              height: thumbSize,
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#94a3b8',
            }}
          >
            <ProductIcon name={rawIcon as any} size={22} />
          </div>
        )}
      </div>
      <div
        className="pos-cart-col pos-cart-col-product"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEditProduct?.(item.productId);
        }}
        style={{ cursor: 'pointer' }}
        title={itemCode ? `${item.name} - #${itemCode} (${t('pos.double_click_edit', 'انقر مرتين للتعديل')})` : `${item.name} (${t('pos.double_click_edit', 'انقر مرتين للتعديل')})`}
      >
        <div className="pos-cart-product-inline" style={{ minWidth: 0, overflow: 'hidden' }}>
          <strong
            className="pos-cart-product-name"
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
              display: 'inline-block',
              maxWidth: '100%',
            }}
          >
            {item.name}
          </strong>
          {itemCode ? <span className="pos-cart-product-code">#{itemCode}</span> : null}
          {allowItemNotes && (
            <button
              type="button"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center', color: item.notes ? (isRestaurant ? '#dc2626' : '#170e5e') : '#6b7280' }}
              title={item.notes ? (isRestaurant ? t('pos.edit_kitchen_note', 'تعديل ملاحظة المطبخ') : t('pos.edit_item_note', 'تعديل ملاحظة الصنف')) : (isRestaurant ? t('pos.add_kitchen_note', 'إضافة ملاحظة وتجهيز للمطبخ') : t('pos.add_item_note', 'إضافة ملاحظة على الصنف'))}
              onClick={(e) => {
                e.stopPropagation();
                onOpenItemNotes?.(item);
              }}
            >
              <FileTextIcon size={14} color={item.notes ? (isRestaurant ? '#dc2626' : '#170e5e') : '#6b7280'} />
            </button>
          )}
        </div>
        {item.nameEn && item.nameEn !== item.name && (
          <div dir="ltr" style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textAlign: 'right', marginTop: '1px', fontFamily: 'system-ui, sans-serif' }}>
            {item.nameEn}
          </div>
        )}
        {item.notes && allowItemNotes && (
          <div
            style={{
              fontSize: '0.75rem',
              color: isRestaurant ? '#dc2626' : '#170e5e',
              background: isRestaurant ? '#fef2f2' : '#f1f5f9',
              border: isRestaurant ? '1px solid #fecaca' : '1px solid #cbd5e1',
              padding: '1px 6px',
              borderRadius: '4px',
              marginTop: '2px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              fontWeight: 600,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenItemNotes?.(item);
            }}
            title={t('pos.click_to_edit_note', 'انقر لتعديل الملاحظة')}
          >
            <span>{item.notes}</span>
          </div>
        )}
        {item.modifiers && item.modifiers.length > 0 && (
          <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '2px' }}>
            {item.modifiers.map((mod: any, i: number) => (
              <div key={i}>+ {mod.name} {mod.qty > 1 ? `(x${mod.qty})` : ''}</div>
            ))}
          </div>
        )}
        {item.offerName && (
          <div style={{ fontSize: '0.74rem', color: '#047857', background: '#ecfdf5', padding: '2px 6px', borderRadius: '4px', border: '1px solid #a7f3d0', marginTop: '2px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <TagIcon size={12} color="#059669" /> {item.offerName}
            {item.offerDiscount && item.offerDiscount > 0 ? (
              <span style={{ color: '#065f46', fontWeight: 700 }}> ({t('pos.saved', 'وفرت')} {formatCurrency(item.offerDiscount * item.qty)})</span>
            ) : null}
          </div>
        )}
        {item.trackSerials ? (
          <PosLineSerialEntry
            item={item}
            onAddSerial={(lineKey, serial) => onAddLineSerial?.(lineKey, serial)}
            onRemoveSerial={(lineKey, serial) => onRemoveLineSerial?.(lineKey, serial)}
          />
        ) : item.serials && item.serials.length > 0 ? (
          <div style={{ fontSize: '0.72rem', color: '#7e22ce', background: '#faf5ff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e9d5ff', marginTop: '3px', direction: 'ltr', textAlign: 'right', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
            <strong>{item.serials.join(', ')}</strong> :IMEI <SmartphoneIcon size={12} color="#7e22ce" />
          </div>
        ) : null}
        {allowItemModifiers && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
            {onItemModifiersClick && (
              <button
                type="button"
                style={{ fontSize: '0.72rem', color: '#170c5c', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', padding: '1px 6px', cursor: 'pointer', opacity: isSelected ? 1 : 0.8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onItemModifiersClick(item.lineKey);
                }}
              >
                + {t('pos.modifiers', 'إضافات')}
              </button>
            )}
            {item.seatNumber ? (
              <button
                type="button"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#1e40af',
                  background: '#dbeafe',
                  border: '1px solid #93c5fd',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  cursor: 'pointer',
                }}
                title={__t('pos.pos_cart_panel.pos_cart_items_list.s0', __t('pos.pos_cart_panel.pos_cart_items_list.s0', "انقر لتغيير مقعد الضيف على الطاولة"))}
                onClick={(e) => {
                  e.stopPropagation();
                  const nextSeat = ((item.seatNumber || 1) % 6) + 1;
                  onItemSeatChange?.(item.lineKey, nextSeat);
                }}
              >
                {t('pos.seat', 'مقعد')} {item.seatNumber}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="pos-cart-col pos-cart-col-qty" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="pos-cart-qty-shell" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px', width: 'auto' }}>
          <button
            type="button"
            className="pos-cart-qty-btn"
            style={{ height: '26px', minHeight: '26px', width: '26px', minWidth: '26px', fontSize: '1.05rem', padding: 0 }}
            aria-label={`زيادة كمية ${item.name}`}
            onFocus={() => onSelectLine(item.lineKey)}
            onClick={(event) => {
              event.stopPropagation();
              if (onChangeLineQtyByDelta) {
                onChangeLineQtyByDelta(item.lineKey, 1);
              } else {
                onQtyChange(item.lineKey, Math.min(Number(item.stockLimit || item.qty + 1), Number(item.qty || minQty) + 1));
              }
            }}
          >
            +
          </button>
          <input
            type="number"
            inputMode="decimal"
            aria-label={__t('pos.pos_cart_panel.pos_cart_items_list.s1', __t('pos.pos_cart_panel.pos_cart_items_list.s1', "الكمية"))}
            dir="ltr"
            style={{
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              width: dynamicInputWidth,
              minWidth: '30px',
              maxWidth: '85px',
              height: '26px',
              minHeight: '26px',
              fontSize: '0.92rem',
              padding: '0 4px',
              boxSizing: 'border-box',
              borderRadius: '6px',
            } as any}
            min={minQty}
            step={inputStep}
            max={item.stockLimit}
            value={item.qty}
            onFocus={() => onSelectLine(item.lineKey)}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onQtyChange(item.lineKey, Number(event.target.value || minQty))}
          />
          <button
            type="button"
            className="pos-cart-qty-btn"
            style={{ height: '26px', minHeight: '26px', width: '26px', minWidth: '26px', fontSize: '1.05rem', padding: 0 }}
            aria-label={`تقليل كمية ${item.name}`}
            onFocus={() => onSelectLine(item.lineKey)}
            onClick={(event) => {
              event.stopPropagation();
              if (onChangeLineQtyByDelta) {
                onChangeLineQtyByDelta(item.lineKey, -1);
              } else {
                onQtyChange(item.lineKey, Math.max(minQty, Number(item.qty || minQty) - 1));
              }
            }}
          >
            −
          </button>
        </div>
      </div>

      <div className="pos-cart-col pos-cart-col-price" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', width: '100%' }}>
        {item.originalPrice && item.originalPrice > item.price ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1 }}>
              {formatCurrency(item.originalPrice)}
            </span>
            <strong className="pos-cart-number" style={{ color: '#15803d', textAlign: 'center' }}>{formatCurrency(item.price)}</strong>
          </div>
        ) : (
          <strong className="pos-cart-number" style={{ textAlign: 'center' }}>{formatCurrency(item.price)}</strong>
        )}
      </div>

      <div className="pos-cart-col pos-cart-col-total" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', width: '100%' }}>
        <strong
          className="pos-cart-number pos-cart-number-total"
          dir="ltr"
          style={{
            direction: 'ltr',
            display: 'inline-block',
            textAlign: 'left',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {formatCurrencyWithCode(lineTotal)}
        </strong>
        {item.qty > 1 && (
          <span
            className="pos-cart-unit-price-mobile-hint"
            dir="ltr"
            style={{
              fontSize: '10.5px',
              color: '#64748b',
              fontWeight: 600,
              direction: 'ltr',
              display: 'inline-block',
              marginTop: '1px',
              whiteSpace: 'nowrap',
            }}
          >
            ({formatCurrencyWithCode(item.price)} / للوحدة)
          </span>
        )}
      </div>

      <div className="pos-cart-col pos-cart-col-remove" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
        <button
          type="button"
          className="pos-cart-remove-button"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '26px', minHeight: '26px', width: '26px', minWidth: '26px', padding: 0, borderRadius: '6px' }}
          onFocus={() => onSelectLine(item.lineKey)}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveItem(item.lineKey);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  );
});

export function PosCartItemsList({ cart, products, onNavigateToProducts, lastAddedLineKey, selectedLineKey, onQtyChange, onItemNoteChange, onItemModifiersClick, onItemSeatChange, onEditProduct, onRemoveItem, onSelectLine, onChangeLineQtyByDelta, onAddLineSerial, onRemoveLineSerial }: Pick<PosCartPanelProps, 'cart' | 'products' | 'onNavigateToProducts' | 'lastAddedLineKey' | 'selectedLineKey' | 'onQtyChange' | 'onItemNoteChange' | 'onItemModifiersClick' | 'onItemSeatChange' | 'onEditProduct' | 'onRemoveItem' | 'onSelectLine' | 'onChangeLineQtyByDelta' | 'onAddLineSerial' | 'onRemoveLineSerial'>) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const isMobile = useIsMobile(900);
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    (products || []).forEach((p) => {
      map.set(String(p.id), p);
    });
    return map;
  }, [products]);
  const isRestaurant = settingsQuery.data?.restaurantModuleEnabled === true;
  const allowItemNotes =
    isRestaurant ||
    settingsQuery.data?.manufacturingModuleEnabled === true;
  const allowItemModifiers = isRestaurant;

  const [notesDialogItem, setNotesDialogItem] = useState<{ lineKey: string; name: string; nameEn?: string; notes: string } | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => {
    if (typeof window === 'undefined') return 380;
    return window.innerWidth <= 900 ? 380 : 0;
  });

  const hasCartItems = cart.length > 0;
  useEffect(() => {
    if (isMobile || !containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 0) {
        setContainerWidth((prev) => (Math.abs(prev - w) > 4 ? w : prev));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isMobile, hasCartItems]); // Re-attach only if cart toggles between empty/list

  const handleSelectLine = useCallback((lineKey: string) => onSelectLine(lineKey), [onSelectLine]);
  const handleEditProduct = useCallback((productId: string) => onEditProduct?.(productId), [onEditProduct]);
  const handleItemNoteChange = useCallback((lineKey: string, note: string) => onItemNoteChange(lineKey, note), [onItemNoteChange]);
  const handleItemModifiersClick = useCallback((lineKey: string) => onItemModifiersClick?.(lineKey), [onItemModifiersClick]);
  const handleItemSeatChange = useCallback((lineKey: string, seat?: number) => onItemSeatChange?.(lineKey, seat), [onItemSeatChange]);
  const handleQtyChange = useCallback((lineKey: string, qty: number) => onQtyChange(lineKey, qty), [onQtyChange]);
  const handleChangeLineQtyByDelta = useCallback((lineKey: string, delta: number) => onChangeLineQtyByDelta?.(lineKey, delta), [onChangeLineQtyByDelta]);
  const handleAddLineSerial = useCallback((lineKey: string, serial: string) => onAddLineSerial?.(lineKey, serial), [onAddLineSerial]);
  const handleRemoveLineSerial = useCallback((lineKey: string, serial: string) => onRemoveLineSerial?.(lineKey, serial), [onRemoveLineSerial]);
  const handleRemoveItem = useCallback((lineKey: string) => onRemoveItem(lineKey), [onRemoveItem]);
  const handleOpenItemNotes = useCallback((it: any) => {
    setNotesDialogItem({
      lineKey: it.lineKey,
      name: it.name,
      nameEn: it.nameEn,
      notes: it.notes || '',
    });
  }, []);

  if (!cart.length) {
    return (
      <div
        className="pos-cart-empty-state"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '42px 20px',
          textAlign: 'center',
          minHeight: '280px',
          flex: 1,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            marginBottom: '14px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
          }}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
        </div>
        <strong style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
          {t('pos.cart_empty_title', 'السلة جاهزة لأول صنف')}
        </strong>
        <p
          style={{
            fontSize: '12.5px',
            color: '#64748b',
            maxWidth: '100%',
            lineHeight: 1.5,
            margin: isMobile && onNavigateToProducts ? '0 0 18px' : '0',
            whiteSpace: isMobile ? 'normal' : 'nowrap',
          }}
        >
          {t('pos.cart_empty_subtitle', 'اختر صنفاً من الكتالوج أو امسح الباركود لبدء الفاتورة')}
        </p>
        {isMobile && onNavigateToProducts ? (
          <button
            type="button"
            onClick={onNavigateToProducts}
            style={{
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              padding: '10px 22px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(23, 14, 94, 0.22)',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8l-9-5-9 5 9 5 9-5V8M12 13v8" />
            </svg>
            <span>{t('pos.cart_browse_products', 'استعراض الأصناف والبدء بالبيع')}</span>
          </button>
        ) : null}
      </div>
    );
  }

  let responsiveClass = '';
  if (isMobile) {
    responsiveClass = 'pos-cart-w440 pos-cart-mobile';
  } else if (containerWidth > 0) {
    if (containerWidth < 440) responsiveClass = 'pos-cart-w440';
    else if (containerWidth < 490) responsiveClass = 'pos-cart-w490';
    else if (containerWidth < 530) responsiveClass = 'pos-cart-w530';
    else if (containerWidth < 580) responsiveClass = 'pos-cart-w580';
  }

  return (
    <section ref={containerRef} className={`pos-cart-table ${responsiveClass}`.trim()} aria-label={__t('pos.pos_cart_panel.pos_cart_items_list.s3', __t('pos.pos_cart_panel.pos_cart_items_list.s3', "عناصر السلة"))}>
      <div className="pos-cart-table-head" aria-hidden="true">
        <div className="pos-cart-col pos-cart-col-index" style={{ textAlign: 'center' }}>{t('pos.table_index', 'م')}</div>
        <div className="pos-cart-col pos-cart-col-product">{t('pos.table_item', 'الصنف')}</div>
        <div className="pos-cart-col pos-cart-col-qty" style={{ textAlign: 'center' }}>{t('pos.table_qty', 'الكمية')}</div>
        <div className="pos-cart-col pos-cart-col-price" style={{ textAlign: 'center' }}>{t('pos.table_price', 'السعر')}</div>
        <div className="pos-cart-col pos-cart-col-total" style={{ textAlign: 'center' }}>{t('pos.table_total', 'الإجمالي')}</div>
        <div className="pos-cart-col pos-cart-col-remove" style={{ textAlign: 'center' }}>{t('pos.table_remove', 'حذف')}</div>
      </div>

      <div className="list-stack pos-cart-list pos-cart-list-premium pos-cart-list-upgraded pos-cart-table-body">
        {cart.map((item, index) => {
          const isSelected = selectedLineKey === item.lineKey;
          const isRecent = lastAddedLineKey === item.lineKey;

          const matchedProduct = productMap.get(String(item.productId));
          return (
            <PosCartItemRow
              key={item.lineKey}
              item={item}
              product={matchedProduct}
              index={index}
              isSelected={isSelected}
              isRecent={isRecent}
              allowItemNotes={allowItemNotes}
              allowItemModifiers={allowItemModifiers}
              isRestaurant={isRestaurant}
              isMobile={isMobile}
              onSelectLine={handleSelectLine}
              onEditProduct={handleEditProduct}
              onItemNoteChange={handleItemNoteChange}
              onOpenItemNotes={handleOpenItemNotes}
              onItemModifiersClick={handleItemModifiersClick}
              onItemSeatChange={handleItemSeatChange}
              onQtyChange={handleQtyChange}
              onChangeLineQtyByDelta={handleChangeLineQtyByDelta}
              onAddLineSerial={handleAddLineSerial}
              onRemoveLineSerial={handleRemoveLineSerial}
              onRemoveItem={handleRemoveItem}
            />
          );
        })}
        <div
          className="pos-cart-mobile-bottom-spacer"
          aria-hidden="true"
          style={{ width: '100%', flexShrink: 0, pointerEvents: 'none' }}
        />
      </div>

      {notesDialogItem && (
        <PosItemNotesDialog
          open={Boolean(notesDialogItem)}
          onClose={() => setNotesDialogItem(null)}
          itemName={notesDialogItem.name}
          itemEnName={notesDialogItem.nameEn}
          initialNotes={notesDialogItem.notes}
          isRestaurant={isRestaurant}
          onSave={(newNotes) => {
            onItemNoteChange(notesDialogItem.lineKey, newNotes);
            setNotesDialogItem(null);
          }}
        />
      )}
    </section>
  );
}
