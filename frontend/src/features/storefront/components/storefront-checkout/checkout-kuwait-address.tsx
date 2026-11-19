import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, ChevronDownIcon } from '@/shared/components/icons/AppIcons';

/**
 * Kuwait structured-address branch (S6) of StorefrontCheckoutModal.
 *
 * Mounted by CheckoutAddressSection (S5), NOT by the facade: S5's address
 * ternary renders this component for the `isKuwait && useKwStructured`
 * branch. Only setShowKwAreaDropdown + setUseKwStructured are used directly
 * here; the other KW setters are written by the facade's reset effect +
 * handlePhoneChange via the S1 hook return (AST-verified, 0 uses in span).
 * 't' is hook-local (useTranslation); the span uses 0x isEn/dir, so no
 * useStorefrontLang (same as S3).
 */
export interface CheckoutKuwaitAddressProps {
  kwArea: string;
  kwBlock: string;
  kwStreet: string;
  kwAvenue: string;
  kwHouse: string;
  kwApartment: string;
  kwExtra: string;
  showKwAreaDropdown: boolean;
  setShowKwAreaDropdown: Dispatch<SetStateAction<boolean>>;
  kwAreaContainerRef: RefObject<HTMLDivElement | null>;
  filteredKwAreas: string[];
  handleKwFieldChange: (
    field: 'area' | 'block' | 'street' | 'avenue' | 'house' | 'apartment' | 'extra',
    value: string,
  ) => void;
  setUseKwStructured: Dispatch<SetStateAction<boolean>>;
  recordAbandonedCartSilent: () => void;
  brandColor: string;
}

export function CheckoutKuwaitAddress({
  kwArea,
  kwBlock,
  kwStreet,
  kwAvenue,
  kwHouse,
  kwApartment,
  kwExtra,
  showKwAreaDropdown,
  setShowKwAreaDropdown,
  kwAreaContainerRef,
  filteredKwAreas,
  handleKwFieldChange,
  setUseKwStructured,
  recordAbandonedCartSilent,
  brandColor,
}: CheckoutKuwaitAddressProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#1e293b' }}>
          {t('storefront.storefront_checkout_modal.kw_address_title', "عنوان التوصيل في الكويت")} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <button
          type="button"
          onClick={() => setUseKwStructured(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '10.5px',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          {t('storefront.storefront_checkout_modal.switch_to_freeform', "كتابة عنوان حر")}
        </button>
      </div>

      {/* Row 1: Area (المنطقة / المحافظة) - Custom Autocomplete Combobox */}
      <div ref={kwAreaContainerRef} style={{ position: 'relative' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            required
            value={kwArea}
            onFocus={() => setShowKwAreaDropdown(true)}
            onChange={(e) => {
              handleKwFieldChange('area', e.target.value);
              setShowKwAreaDropdown(true);
            }}
            onBlur={recordAbandonedCartSilent}
            placeholder={t('storefront.storefront_checkout_modal.kw_area_placeholder', "المنطقة (اختر أو اكتب: الفروانية، حولي، السالمية...) *")}
            style={{
              width: '100%',
              padding: '6px 12px',
              paddingLeft: '32px',
              borderRadius: '8px',
              border: kwArea.trim().length >= 2 ? '1.5px solid #22c55e' : '1.5px solid #cbd5e1',
              outline: 'none',
              background: '#f8fafc',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              height: '36px',
              lineHeight: '1.45',
              fontSize: '12.5px',
              transition: 'border-color 0.2s ease',
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowKwAreaDropdown((prev) => !prev)}
            style={{
              position: 'absolute',
              left: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
            }}
          >
            <ChevronDownIcon
              size={16}
              style={{
                transform: showKwAreaDropdown ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>
        </div>

        {showKwAreaDropdown && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              boxShadow: '0 12px 28px -4px rgba(15, 23, 42, 0.16)',
              maxHeight: '190px',
              overflowY: 'auto',
              zIndex: 100,
              padding: '4px',
              direction: 'rtl',
            }}
          >
            {filteredKwAreas.length > 0 ? (
              filteredKwAreas.map((area) => {
                const isSelected = kwArea.trim() === area;
                return (
                  <div
                    key={area}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleKwFieldChange('area', area);
                      setShowKwAreaDropdown(false);
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: '6px',
                      fontSize: '12.5px',
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? brandColor : '#1e293b',
                      background: isSelected ? 'rgba(23, 14, 94, 0.05)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f1f5f9';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span>{area}</span>
                    {isSelected && <CheckIcon size={14} color={brandColor} strokeWidth={2.5} />}
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '8px 12px', fontSize: '11.5px', color: '#64748b', textAlign: 'center' }}>
                {t('storefront.storefront_checkout_modal.kw_custom_area_hint', "منطقة مخصصة (يمكنك إكمال الكتابة يدوياً)")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Block & Street (القطعة والشارع) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <input
          type="text"
          required
          value={kwBlock}
          onChange={(e) => handleKwFieldChange('block', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_block_placeholder', "القطعة (مثال: قطعة 4) *")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: kwBlock.trim() ? '1.5px solid #22c55e' : '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
        <input
          type="text"
          required
          value={kwStreet}
          onChange={(e) => handleKwFieldChange('street', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_street_placeholder', "الشارع (مثال: شارع 12) *")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: kwStreet.trim() ? '1.5px solid #22c55e' : '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
      </div>

      {/* Row 3: Avenue & House (الجادة ورقم المنزل/المبنى) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <input
          type="text"
          value={kwAvenue}
          onChange={(e) => handleKwFieldChange('avenue', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_avenue_placeholder', "الجادة (اختياري)")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
        <input
          type="text"
          required
          value={kwHouse}
          onChange={(e) => handleKwFieldChange('house', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_house_placeholder', "المنزل/العمارة (رقم 15) *")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: kwHouse.trim() ? '1.5px solid #22c55e' : '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
      </div>

      {/* Row 4: Floor/Flat & Extra Details (الدور/الشقة وعلامة مميزة) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <input
          type="text"
          value={kwApartment}
          onChange={(e) => handleKwFieldChange('apartment', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_apt_placeholder', "الدور / الشقة (اختياري)")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
        <input
          type="text"
          value={kwExtra}
          onChange={(e) => handleKwFieldChange('extra', e.target.value)}
          onBlur={recordAbandonedCartSilent}
          placeholder={t('storefront.storefront_checkout_modal.kw_extra_placeholder', "علامة مميزة (اختياري)")}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1.5px solid #cbd5e1',
            outline: 'none',
            background: '#f8fafc',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            height: '35px',
            lineHeight: '1.45',
            fontSize: '12px',
          }}
        />
      </div>
    </div>
  );
}
