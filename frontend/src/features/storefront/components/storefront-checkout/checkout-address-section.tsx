import React from 'react';
import { useTranslation } from 'react-i18next';
import { PackageIcon, UtensilsIcon } from '@/shared/components/icons/AppIcons';
import { CheckoutKuwaitAddress } from './checkout-kuwait-address';

export interface CheckoutAddressSectionProps {
  isDineIn: boolean;
  isPickup: boolean;
  canExpress: boolean;
  isKuwait: boolean;
  useKwStructured: boolean;
  setUseKwStructured: React.Dispatch<React.SetStateAction<boolean>>;
  tableNumber?: string | null;
  customerAddress: string;
  setCustomerAddress: React.Dispatch<React.SetStateAction<string>>;
  addressStatus: { isValid: boolean; message: string };
  recordAbandonedCartSilent: () => void;
  kwArea: string;
  kwBlock: string;
  kwStreet: string;
  kwAvenue: string;
  kwHouse: string;
  kwApartment: string;
  kwExtra: string;
  showKwAreaDropdown: boolean;
  setShowKwAreaDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  kwAreaContainerRef: React.RefObject<HTMLDivElement | null>;
  filteredKwAreas: string[];
  handleKwFieldChange: (
    field: 'area' | 'block' | 'street' | 'avenue' | 'house' | 'apartment' | 'extra',
    value: string,
  ) => void;
  brandColor: string;
}

/**
 * Address section of the storefront checkout modal (file #42 S5).
 * Owns the address ternary: dine-in table badge / pickup badge /
 * canExpress null / Kuwait structured branch / freeform textarea.
 * The Kuwait branch is rendered by CheckoutKuwaitAddress (S6), mounted
 * here — NOT by the facade. The KW values, dropdown state, filtered
 * areas, field-change handler and brandColor are pass-through props
 * from the facade (S1 hook return); only setUseKwStructured and
 * recordAbandonedCartSilent are used by this section itself as well.
 * 't' is hook-local (useTranslation), like the other JSX slices.
 */
export function CheckoutAddressSection({
  isDineIn,
  isPickup,
  canExpress,
  isKuwait,
  useKwStructured,
  setUseKwStructured,
  tableNumber,
  customerAddress,
  setCustomerAddress,
  addressStatus,
  recordAbandonedCartSilent,
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
  brandColor,
}: CheckoutAddressSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {isDineIn ? (
        <div
          style={{
            background: '#f0fdf4',
            border: '1.5px solid #86efac',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <UtensilsIcon size={15} color="#166534" strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: '#166534', fontSize: '11.5px' }}>
              {t('storefront.storefront_checkout_modal.s21', "طلب مباشر من الصالة / الكافيه")}
            </div>
            <div style={{ color: '#15803d', fontSize: '10.5px' }}>
              {t('storefront.storefront_checkout_modal.s22', "طاولة رقم:")} <strong>{tableNumber || t('storefront.storefront_checkout_modal.s23', "غير محدد")}</strong>
            </div>
          </div>
        </div>
      ) : isPickup ? (
        <div
          style={{
            background: '#eff6ff',
            border: '1.5px solid #93c5fd',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PackageIcon size={15} color="#1e40af" strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: '#1e40af', fontSize: '11.5px' }}>
              {t('storefront.storefront_checkout_modal.s24', "استلام ذاتي من الفرع (Click & Collect)")}
            </div>
            <div style={{ color: '#2563eb', fontSize: '10.5px' }}>
              {t('storefront.storefront_checkout_modal.s25', "تجهيز الطلب للاستلام المباشر بدون رسوم شحن.")}
            </div>
          </div>
        </div>
      ) : canExpress ? null : isKuwait && useKwStructured ? (
        <CheckoutKuwaitAddress
          kwArea={kwArea}
          kwBlock={kwBlock}
          kwStreet={kwStreet}
          kwAvenue={kwAvenue}
          kwHouse={kwHouse}
          kwApartment={kwApartment}
          kwExtra={kwExtra}
          showKwAreaDropdown={showKwAreaDropdown}
          setShowKwAreaDropdown={setShowKwAreaDropdown}
          kwAreaContainerRef={kwAreaContainerRef}
          filteredKwAreas={filteredKwAreas}
          handleKwFieldChange={handleKwFieldChange}
          setUseKwStructured={setUseKwStructured}
          recordAbandonedCartSilent={recordAbandonedCartSilent}
          brandColor={brandColor}
        />
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
              {t('storefront.storefront_checkout_modal.s26', "عنوان التوصيل بالتفصيل")} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            {isKuwait && !useKwStructured && (
              <button
                type="button"
                onClick={() => setUseKwStructured(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '10.5px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                {t('storefront.storefront_checkout_modal.switch_to_kw_structured', "العودة للعنوان الكويتي المقسم")}
              </button>
            )}
          </div>
          <textarea
            required
            rows={1}
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            onBlur={recordAbandonedCartSilent}
            placeholder={t('storefront.storefront_checkout_modal.s27', "اسم الشارع، رقم العمارة، الطابق، الشقة، وعلامة مميزة...")}
            style={{
              width: '100%',
              padding: '4px 10px',
              borderRadius: '8px',
              border:
                customerAddress.length > 0
                  ? addressStatus.isValid
                    ? '1.5px solid #22c55e'
                    : '1.5px solid #f87171'
                  : '1.5px solid #cbd5e1',
              outline: 'none',
              background: '#f8fafc',
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: '44px',
              height: '44px',
              boxSizing: 'border-box',
              lineHeight: '1.45',
              fontSize: '12.5px',
              transition: 'border-color 0.2s ease',
            }}
          />
        </div>
      )}
    </>
  );
}
