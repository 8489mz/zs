// Search field and price-tier toggle — the toolbar shown above the product
// grid. Pure move; the panel keeps all state and mounts this component with
// the search state and its callbacks.

import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import type { useScannerBuffer } from '@/features/pos/hooks/useScannerBuffer';
import type { PosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';

export function PosProductsToolbar({
  customization,
  search,
  scannerBuffer,
  handleSearchKeyDown,
  isMobile,
  isMobileKeyboardActive,
  setIsMobileKeyboardActive,
  searchInputRef,
  priceType,
  onPriceTypeChange,
  isPriceTypeLocked,
  toggleMobileKeyboard,
  isRtl,
  setIsCustomizationOpen,
  setIsCameraScannerOpen,
}: {
  customization: PosUiCustomization;
  search: string;
  scannerBuffer: ReturnType<typeof useScannerBuffer>;
  handleSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  isMobile: boolean;
  isMobileKeyboardActive: boolean;
  setIsMobileKeyboardActive: Dispatch<SetStateAction<boolean>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  priceType: PosPriceType;
  onPriceTypeChange: (value: PosPriceType) => void;
  isPriceTypeLocked?: boolean;
  toggleMobileKeyboard: () => void;
  isRtl: boolean;
  setIsCustomizationOpen: Dispatch<SetStateAction<boolean>>;
  setIsCameraScannerOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  return (
    <div className="pos-toolbar-shell pos-toolbar-shell-compact">
      <div className="pos-products-toolbar-stack" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {customization.showSearchBar && (
          <div className="pos-products-unified-search-field">
            <div className="field" style={{ margin: 0, position: 'relative' }}>
              <input
                ref={searchInputRef}
                autoFocus={!isMobile}
                inputMode={isMobile ? (isMobileKeyboardActive ? 'text' : 'none') : undefined}
                defaultValue={search}
                onChange={scannerBuffer.handleChange}
                onKeyDown={handleSearchKeyDown}
                onBlur={(event) => {
                  if (!isMobile) return;
                  // INV-POS-CATEGORY-TILE-FILTER (keyboard-toggle race fix):
                  // tapping the toggle button blurs this input first; the
                  // blur must NOT reset the keyboard state, or the toggle
                  // that follows flips the already-reset value back to
                  // true and the keyboard can never be dismissed. Skip the
                  // reset only when focus moves to the toggle itself.
                  const nextTarget =
                    (event.relatedTarget as HTMLElement | null) ??
                    (document.activeElement as HTMLElement | null);
                  if (nextTarget?.classList?.contains('pos-keyboard-toggle-btn')) return;
                  setIsMobileKeyboardActive(false);
                }}
                placeholder={t('pos.search_placeholder', 'امسح باركود أو اكتب الاسم...')}
                style={{
                  borderRadius: '8px',
                  width: '100%',
                  height: '36px',
                  paddingTop: '6px',
                  paddingBottom: '6px',
                  paddingRight: isRtl ? '12px' : (isMobile ? '104px' : '72px'),
                  paddingLeft: isRtl ? (isMobile ? '104px' : '72px') : '12px',
                  textAlign: isRtl ? 'right' : 'left',
                  direction: isRtl ? 'rtl' : 'ltr',
                  fontSize: '13px',
                  border: '1px solid #cbd5e1',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: isRtl ? '6px' : 'auto',
                  right: isRtl ? 'auto' : '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {isMobile && (
                  <button
                    type="button"
                    className="pos-keyboard-toggle-btn"
                    onClick={toggleMobileKeyboard}
                    title={isMobileKeyboardActive ? t('pos.hide_keyboard', 'كتم لوحة المفاتيح الافتراضية') : t('pos.show_keyboard', 'فتح لوحة المفاتيح للكتابة بالاسم')}
                    style={{
                      background: isMobileKeyboardActive ? '#170e5e' : '#f8fafc',
                      border: isMobileKeyboardActive ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      color: isMobileKeyboardActive ? '#ffffff' : '#475569',
                      borderRadius: '6px',
                      height: '26px',
                      padding: '0 6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <KeyboardIcon size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="pos-customize-trigger-btn"
                  onClick={() => setIsCustomizationOpen(true)}
                  title={t('pos.customize_ui_title', 'تخصيص واجهة الكاشير والشاشات المتنقلة')}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#475569',
                    borderRadius: '6px',
                    height: '26px',
                    padding: '0 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <SlidersIcon size={14} />
                </button>
                <button
                  type="button"
                  className="pos-camera-scan-btn"
                  onClick={() => setIsCameraScannerOpen(true)}
                  title={t('pos.scan_camera', 'مسح باركود بالكاميرا')}
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#2563eb',
                    borderRadius: '6px',
                    height: '26px',
                    padding: '0 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {customization.showPriceTierToggle && (
          <div className="pos-price-toggle-container" style={{ width: '100%' }}>
            {isPriceTypeLocked ? (
              // INV-VAN-PRICE-LIST-WIRING: a selected customer
              // fixes the tier — the toggle is display-only
              // (the server re-derives the same tier).
              <div style={{ display: 'flex', background: '#f1f5f9', padding: isMobile ? '2.5px' : '4px', borderRadius: '8px', border: '1px solid #e2e8f0', gap: isMobile ? '3px' : '4px', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ flex: 1, padding: isMobile ? '5px 10px' : '7px 16px', fontSize: isMobile ? '12px' : '13px', fontWeight: '700', borderRadius: '6px', background: '#0f172a', color: '#ffffff', textAlign: 'center' }}>
                  {priceType === 'wholesale' ? t('pos.wholesale_price', 'سعر الجملة')
                    : priceType === 'half_wholesale' ? t('pos.half_wholesale_price', 'سعر نصف الجملة')
                    : priceType === 'credit' ? t('pos.credit_price', 'سعر الآجل')
                    : t('pos.retail_price', 'سعر القطاعي')}
                </span>
              </div>
            ) : (
            <div className="pos-price-toggle-buttons" style={{ display: 'flex', background: '#f1f5f9', padding: isMobile ? '2.5px' : '4px', borderRadius: '8px', border: '1px solid #e2e8f0', gap: isMobile ? '3px' : '4px' }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: isMobile ? '5px 10px' : '7px 16px',
                  fontSize: isMobile ? '12px' : '13px',
                  fontWeight: '700',
                  borderRadius: '6px',
                  border: 'none',
                  background: priceType === 'retail' ? '#0f172a' : 'transparent',
                  color: priceType === 'retail' ? '#ffffff' : '#475569',
                  boxShadow: priceType === 'retail' ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                  cursor: 'pointer',
                  transition: 'none',
                }}
                onClick={() => onPriceTypeChange('retail')}
              >
                {t('pos.retail_price', 'سعر القطاعي')}
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: isMobile ? '5px 10px' : '7px 16px',
                  fontSize: isMobile ? '12px' : '13px',
                  fontWeight: '700',
                  borderRadius: '6px',
                  border: 'none',
                  background: priceType === 'wholesale' ? '#dc2626' : 'transparent',
                  color: priceType === 'wholesale' ? '#ffffff' : '#475569',
                  boxShadow: priceType === 'wholesale' ? '0 1px 2px rgba(220,38,38,0.2)' : 'none',
                  cursor: 'pointer',
                  transition: 'none',
                }}
                onClick={() => onPriceTypeChange('wholesale')}
              >
                {t('pos.wholesale_price', 'سعر الجملة')}
              </button>
            </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
