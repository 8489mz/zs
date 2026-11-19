import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { COUNTRY_OPTIONS } from './storefront-checkout-helpers';

export interface CheckoutCustomerSectionProps {
  canExpress: boolean;
  selectedCountry: string;
  setSelectedCountry: Dispatch<SetStateAction<string>>;
  customerPhone: string;
  setCustomerPhone: Dispatch<SetStateAction<string>>;
  handlePhoneChange: (rawVal: string) => void;
  recordAbandonedCartSilent: () => void;
  customerName: string;
  setCustomerName: Dispatch<SetStateAction<string>>;
  setCustomerAddress: Dispatch<SetStateAction<string>>;
  isDeviceMatched: boolean;
  setIsDeviceMatched: Dispatch<SetStateAction<boolean>>;
  phoneStatus: { isValid: boolean; message: string; isComplete: boolean };
  nameStatus: { isValid: boolean; message: string };
}

export function CheckoutCustomerSection({
  canExpress,
  selectedCountry,
  setSelectedCountry,
  customerPhone,
  setCustomerPhone,
  handlePhoneChange,
  recordAbandonedCartSilent,
  customerName,
  setCustomerName,
  setCustomerAddress,
  isDeviceMatched,
  setIsDeviceMatched,
  phoneStatus,
  nameStatus,
}: CheckoutCustomerSectionProps) {
  const { t } = useTranslation();
  const { isEn } = useStorefrontLang();

  return (
    <>
                {!canExpress && (
                  <>
                    {/* Customer Phone & Country Selector */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
                          {t('storefront.storefront_checkout_modal.s12', "رقم الهاتف (للتواصل وتأكيد الطلب)")} <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        {customerPhone.length > 0 && (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: phoneStatus.isValid ? '#16a34a' : '#e11d48',
                            }}
                          >
                            {phoneStatus.message}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <select
                          value={selectedCountry}
                          onChange={(e) => {
                            setSelectedCountry(e.target.value);
                            setCustomerPhone('');
                          }}
                          style={{
                            width: '120px',
                            padding: '4px 6px',
                            height: '36px',
                            borderRadius: '8px',
                            border: '1.5px solid #cbd5e1',
                            fontSize: '12px',
                            background: '#f8fafc',
                            fontFamily: 'inherit',
                            fontWeight: 600,
                            color: '#1e293b',
                            cursor: 'pointer',
                            outline: 'none',
                            flexShrink: 0,
                          }}
                        >
                          {COUNTRY_OPTIONS.map((c) => (
                            <option key={c.code} value={c.code}>
                              {isEn ? c.nameEn : c.name} ({c.dialCode})
                            </option>
                          ))}
                        </select>
                        <input
                          type="tel"
                          required
                          maxLength={selectedCountry === 'EG' ? 11 : selectedCountry === 'SA' || selectedCountry === 'AE' ? 10 : 15}
                          autoFocus
                          value={customerPhone}
                          onChange={(e) => handlePhoneChange(e.target.value)}
                          onBlur={recordAbandonedCartSilent}
                          placeholder={
                            (isEn
                              ? COUNTRY_OPTIONS.find((c) => c.code === selectedCountry)?.placeholderEn
                              : COUNTRY_OPTIONS.find((c) => c.code === selectedCountry)?.placeholder) ||
                            t('storefront.storefront_checkout_modal.s13', "رقم الهاتف")
                          }
                          style={{
                            flex: 1,
                            padding: '6px 12px',
                            height: '36px',
                            boxSizing: 'border-box',
                            borderRadius: '8px',
                            border:
                              customerPhone.length > 0
                                ? phoneStatus.isValid
                                  ? '1.5px solid #22c55e'
                                  : '1.5px solid #f87171'
                                : '1.5px solid #cbd5e1',
                            fontSize: '13.5px',
                            outline: 'none',
                            background: '#f8fafc',
                            fontFamily: 'inherit',
                            direction: 'ltr',
                            textAlign: isEn ? 'left' : 'right',
                            transition: 'border-color 0.2s ease',
                          }}
                        />
                      </div>

                      {isDeviceMatched && (
                        <div
                          style={{
                            background: '#f0fdf4',
                            border: '1px solid #86efac',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '10px',
                            color: '#166534',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: '3px',
                          }}
                        >
                          <span>
                            <strong>{t('storefront.storefront_checkout_modal.s14', "تم استرجاع بياناتك تلقائياً:")}</strong> {t('storefront.storefront_checkout_modal.s15', "لأنك طلبت مسبقاً.")}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerName('');
                              setCustomerAddress('');
                              setIsDeviceMatched(false);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#15803d',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              whiteSpace: 'nowrap',
                              marginRight: '6px',
                            }}
                          >
                            {t('storefront.storefront_checkout_modal.s16', "تغيير")}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Customer Name */}
                    <div>
                      <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '3px' }}>
                        {t('storefront.storefront_checkout_modal.s17', "الاسم بالكامل")} <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        onBlur={recordAbandonedCartSilent}
                        placeholder={t('storefront.storefront_checkout_modal.s18', "مثال: علي محمد / مازن أحمد")}
                        style={{
                          width: '100%',
                          padding: '6px 12px',
                          height: '36px',
                          boxSizing: 'border-box',
                          borderRadius: '8px',
                          border:
                            customerName.length > 0
                              ? nameStatus.isValid
                                ? '1.5px solid #22c55e'
                                : '1.5px solid #f87171'
                              : '1.5px solid #cbd5e1',
                          fontSize: '13px',
                          outline: 'none',
                          background: '#f8fafc',
                          fontFamily: 'inherit',
                          transition: 'border-color 0.2s ease',
                        }}
                      />
                    </div>
                  </>
                )}
    </>
  );
}
