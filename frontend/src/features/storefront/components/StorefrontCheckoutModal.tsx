import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol, getCurrencySymbol, isThreeDecimalCurrency } from '@/lib/currencies';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CartItem, CreateOnlineOrderResponse, StorefrontInfo, ValidateCouponResponse, StorefrontPaymentSessionResponse, QuoteCartResponse } from '../types/storefront.types';
import { storefrontApi } from '../api/storefront.api';
import { StorefrontOnlinePaymentModal } from './StorefrontOnlinePaymentModal';
import { UtensilsIcon, XIcon, CheckIcon, TagIcon, TruckIcon, PackageIcon, ChevronDownIcon } from '@/shared/components/icons/AppIcons';
import { trackStorefrontEvent } from '../lib/storefront-pixel-tracker';
import { getCustomerOrderToken, saveCustomerOrderRef } from '../lib/customer-order-refs';
import { saveLocalOrderRecord } from './StorefrontMyOrdersModal';
import { calculateCartSubtotal } from '../lib/storefront-cart-pricing';
import { getContrastTextColor } from '../lib/storefront-theme-contrast';
import { useBodyScrollLock } from '@/shared/components/dialog-shell';

const STOREFRONT_SAVED_CUSTOMER_KEY = 'zsystems.storefront.saved_customer';

interface StorefrontCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  info?: StorefrontInfo;
  deliveryFee?: number;
  tenantSlug?: string;
  tableNumber?: string | null;
  orderType?: 'delivery' | 'dine_in';
  editingOrderNumber?: string;
  onEditSuccess?: (orderNumber: string) => void;
  onOrderSuccess?: (orderData: CreateOnlineOrderResponse) => void;
  onSubmitOrder?: (formData: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    customerNotes: string;
    paymentMethod?: string;
    couponCode?: string;
    deliveryZoneId?: number;
    deliveryZoneName?: string;
    orderType?: 'delivery' | 'dine_in';
    tableNumber?: string;
    fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';
    countryCode?: string;
  }) => Promise<void>;
}

export interface CountryOption {
  code: string;
  name: string;
  nameEn: string;
  dialCode: string;
  placeholder: string;
  placeholderEn: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'EG', name: 'مصر', nameEn: 'Egypt', dialCode: '+20', placeholder: '01012345678 (11 رقم)', placeholderEn: '01012345678 (11 digits)' },
  { code: 'SA', name: 'السعودية', nameEn: 'Saudi Arabia', dialCode: '+966', placeholder: '501234567 (9 أرقام)', placeholderEn: '501234567 (9 digits)' },
  { code: 'AE', name: 'الإمارات', nameEn: 'UAE', dialCode: '+971', placeholder: '501234567 (9 أرقام)', placeholderEn: '501234567 (9 digits)' },
  { code: 'KW', name: 'الكويت', nameEn: 'Kuwait', dialCode: '+965', placeholder: '91234567 (8 أرقام)', placeholderEn: '91234567 (8 digits)' },
  { code: 'OM', name: 'عمان', nameEn: 'Oman', dialCode: '+968', placeholder: '91234567 (8 أرقام)', placeholderEn: '91234567 (8 digits)' },
  { code: 'QA', name: 'قطر', nameEn: 'Qatar', dialCode: '+974', placeholder: '51234567 (8 أرقام)', placeholderEn: '51234567 (8 digits)' },
  { code: 'BH', name: 'البحرين', nameEn: 'Bahrain', dialCode: '+973', placeholder: '31234567 (8 أرقام)', placeholderEn: '31234567 (8 digits)' },
  { code: 'OTHER', name: 'دولي / أخرى', nameEn: 'International / Other', dialCode: '+', placeholder: 'رقم الهاتف', placeholderEn: 'Phone number' },
];

export function getDynamicPhoneValidation(phone: string, countryCode: string = 'EG', isEn = false): { isValid: boolean; message: string; isComplete: boolean } {
  const clean = phone.replace(/[^0-9+]/g, '');
  if (!clean) return { isValid: false, message: '', isComplete: false };

  if (countryCode === 'EG') {
    const digits = clean.replace(/\D/g, '');
    if (!digits.startsWith('01')) {
      return { isValid: false, message: isEn ? 'Must start with 01' : 'يجب أن يبدأ بـ 01', isComplete: false };
    }
    if (digits.length >= 3 && !['010', '011', '012', '015'].includes(digits.slice(0, 3))) {
      return { isValid: false, message: isEn ? 'Invalid carrier prefix (010, 011, 012, 015)' : 'كود شبكة غير صحيح (010, 011, 012, 015)', isComplete: false };
    }
    if (digits.length === 11) {
      return { isValid: true, message: isEn ? 'Valid phone number (11 digits)' : 'رقم هاتف صحيح (11 رقم)', isComplete: true };
    }
    return { isValid: false, message: isEn ? `${11 - digits.length} digits remaining` : `متبقي ${11 - digits.length} أرقام`, isComplete: false };
  }

  if (countryCode === 'SA') {
    const digits = clean.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
    if (digits.length === 9 && digits.startsWith('5')) {
      return { isValid: true, message: isEn ? 'Valid Saudi phone number' : 'رقم هاتف سعودي صحيح', isComplete: true };
    }
    if (digits.length < 9) {
      return { isValid: false, message: isEn ? `${9 - digits.length} digits remaining` : `متبقي ${9 - digits.length} أرقام`, isComplete: false };
    }
    return { isValid: true, message: isEn ? 'Complete phone number' : 'رقم هاتف مكتمل', isComplete: true };
  }

  if (countryCode === 'KW') {
    const digits = clean.replace(/\D/g, '').replace(/^965/, '').replace(/^00965/, '').replace(/^0/, '');
    if (digits.length > 0 && !['2', '5', '6', '9'].includes(digits[0])) {
      return { isValid: false, message: isEn ? 'Must start with 2, 5, 6, or 9' : 'يجب أن يبدأ بـ 2, 5, 6, أو 9', isComplete: false };
    }
    if (digits.length === 8) {
      return { isValid: true, message: isEn ? 'Valid Kuwait phone number (8 digits)' : 'رقم هاتف كويتي صحيح (8 أرقام)', isComplete: true };
    }
    if (digits.length < 8) {
      return { isValid: false, message: isEn ? `${8 - digits.length} digits remaining` : `متبقي ${8 - digits.length} أرقام`, isComplete: false };
    }
    return { isValid: false, message: isEn ? 'Kuwait phone number is 8 digits' : 'رقم الهاتف الكويتي يتكون من 8 أرقام', isComplete: false };
  }

  const generalDigits = clean.replace(/\D/g, '');
  if (generalDigits.length >= 7 && generalDigits.length <= 15) {
    return { isValid: true, message: isEn ? 'Valid phone number' : 'رقم الهاتف صحيح', isComplete: true };
  }
  return { isValid: false, message: isEn ? 'Incomplete phone number' : 'رقم الهاتف غير مكتمل', isComplete: false };
}

export function getEgyptianPhoneValidation(phone: string): { isValid: boolean; message: string; isComplete: boolean } {
  return getDynamicPhoneValidation(phone, 'EG');
}

export function getCustomerNameValidation(name: string, isEn = false): { isValid: boolean; message: string } {
  const trimmed = name.trim();
  if (!trimmed) return { isValid: false, message: '' };
  const lettersCount = (trimmed.match(/[\p{L}\p{M}]/gu) || []).length;
  if (lettersCount < 2) {
    return { isValid: false, message: isEn ? 'Name must be at least 2 letters' : 'الاسم يجب ألا يقل عن حرفين' };
  }
  return { isValid: true, message: isEn ? 'Name complete' : 'الاسم مكتمل' };
}

export function getCustomerAddressValidation(address: string, isEn = false): { isValid: boolean; message: string } {
  const trimmed = address.trim();
  if (!trimmed) return { isValid: false, message: '' };
  return { isValid: true, message: isEn ? 'Address complete' : 'العنوان مكتمل' };
}

function cleanArabicText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .trim();
}

export const KUWAIT_POPULAR_AREAS = [
  // العاصمة
  'مدينة الكويت', 'الشرق', 'المرقاب', 'القبلة', 'الصالحية', 'بنيد القار', 'الدسمة', 'الدعية', 'المنصورية', 'ضاحية عبد الله السالم', 'النزهة', 'الفيحاء', 'الشامية', 'الروضة', 'العديلية', 'الخالدية', 'كيفان', 'القادسية', 'قرطبة', 'السرة', 'اليرموك', 'الشويخ', 'غرناطة', 'الصليبيخات', 'الدوحة', 'مدينة جابر الأحمد',
  // حولي
  'حولي', 'السالمية', 'الرميثية', 'الجابرية', 'مشرف', 'بيان', 'سلوى', 'البدع', 'الشعب', 'ميدان حولي', 'السلام', 'حطين', 'الصديق', 'الزهراء', 'الشهداء',
  // الفروانية
  'الفروانية', 'خيطان', 'الأندلس', 'إشبيلية', 'جليب الشيوخ', 'العمرية', 'الرابية', 'الرحاب', 'صباح الناصر', 'الفردوس', 'العارضية', 'الرقعي', 'عبد الله المبارك', 'غرب عبد الله المبارك',
  // الأحمدي
  'الأحمدي', 'الفحيحيل', 'المنقف', 'الصباحية', 'الرقة', 'هدية', 'أبو حليفة', 'المهبولة', 'العقيلة', 'الظهر', 'جابر العلي', 'مدينة صباح الأحمد', 'الوفرة', 'الخيران', 'بنيدر', 'الجليعة',
  // مبارك الكبير
  'العدان', 'القصور', 'القرين', 'مبارك الكبير', 'صباح السالم', 'المسيلة', 'أبو فطيرة', 'الفنيطيس', 'صبحان',
  // الجهراء
  'الجهراء', 'الواحة', 'العيون', 'القصر', 'النسيم', 'تيماء', 'النعيم', 'مدينة سعد العبد الله', 'الصليبية', 'كبد', 'المطلاع',
];

export function assembleKuwaitAddress(parts: {
  area?: string;
  block?: string;
  street?: string;
  avenue?: string;
  house?: string;
  apartment?: string;
  extra?: string;
}): string {
  const chunks: string[] = [];
  if (parts.area?.trim()) chunks.push(`المنطقة: ${parts.area.trim()}`);
  if (parts.block?.trim()) chunks.push(`قطعة: ${parts.block.trim()}`);
  if (parts.street?.trim()) chunks.push(`شارع: ${parts.street.trim()}`);
  if (parts.avenue?.trim()) chunks.push(`جادة: ${parts.avenue.trim()}`);
  if (parts.house?.trim()) chunks.push(`منزل/مبنى: ${parts.house.trim()}`);
  if (parts.apartment?.trim()) chunks.push(`دور/شقة: ${parts.apartment.trim()}`);
  if (parts.extra?.trim()) chunks.push(`علامة مميزة: ${parts.extra.trim()}`);
  return chunks.join('، ');
}

export function parseKuwaitAddress(addr: string): {
  area: string;
  block: string;
  street: string;
  avenue: string;
  house: string;
  apartment: string;
  extra: string;
} {
  const res = { area: '', block: '', street: '', avenue: '', house: '', apartment: '', extra: '' };
  if (!addr) return res;
  const matchArea = addr.match(/المنطقة:\s*([^،,]+)/);
  if (matchArea) res.area = matchArea[1].trim();
  const matchBlock = addr.match(/قطعة:\s*([^،,]+)/);
  if (matchBlock) res.block = matchBlock[1].trim();
  const matchStreet = addr.match(/شارع:\s*([^،,]+)/);
  if (matchStreet) res.street = matchStreet[1].trim();
  const matchAvenue = addr.match(/جادة:\s*([^،,]+)/);
  if (matchAvenue) res.avenue = matchAvenue[1].trim();
  const matchHouse = addr.match(/منزل\/مبنى:\s*([^،,]+)/);
  if (matchHouse) res.house = matchHouse[1].trim();
  const matchApt = addr.match(/دور\/شقة:\s*([^،,]+)/);
  if (matchApt) res.apartment = matchApt[1].trim();
  const matchExtra = addr.match(/علامة مميزة:\s*([^،,]+)/);
  if (matchExtra) res.extra = matchExtra[1].trim();
  return res;
}

export function StorefrontCheckoutModal({
  isOpen,
  onClose,
  cartItems,
  info,
  deliveryFee: deliveryFeeProp,
  tenantSlug,
  tableNumber,
  orderType,
  editingOrderNumber,
  onEditSuccess,
  onOrderSuccess,
  onSubmitOrder,
}: StorefrontCheckoutModalProps) {
  const { t } = useTranslation();
  const { isEn, dir } = useStorefrontLang();
  const isDineIn = Boolean(tableNumber) || orderType === 'dine_in';
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [selectedCountry, setSelectedCountry] = useState<string>(() => {
    if (info?.countryCode) return info.countryCode;
    if (info?.currency === 'SAR') return 'SA';
    if (info?.currency === 'AED') return 'AE';
    if (info?.currency === 'KWD') return 'KW';
    if (info?.currency === 'OMR') return 'OM';
    if (info?.currency === 'QAR') return 'QA';
    if (info?.currency === 'BHD') return 'BH';
    return 'EG';
  });
  const isKuwait = selectedCountry === 'KW' || info?.currency === 'KWD';
  const [useKwStructured, setUseKwStructured] = useState(true);
  const [kwArea, setKwArea] = useState('');
  const [showKwAreaDropdown, setShowKwAreaDropdown] = useState(false);
  const kwAreaContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showKwAreaDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (kwAreaContainerRef.current && !kwAreaContainerRef.current.contains(e.target as Node)) {
        setShowKwAreaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showKwAreaDropdown]);

  const filteredKwAreas = React.useMemo(() => {
    const q = cleanArabicText(kwArea);
    if (!q) return KUWAIT_POPULAR_AREAS;
    return KUWAIT_POPULAR_AREAS.filter((a) => cleanArabicText(a).includes(q));
  }, [kwArea]);
  const [kwBlock, setKwBlock] = useState('');
  const [kwStreet, setKwStreet] = useState('');
  const [kwAvenue, setKwAvenue] = useState('');
  const [kwHouse, setKwHouse] = useState('');
  const [kwApartment, setKwApartment] = useState('');
  const [kwExtra, setKwExtra] = useState('');

  const handleKwFieldChange = (
    field: 'area' | 'block' | 'street' | 'avenue' | 'house' | 'apartment' | 'extra',
    value: string
  ) => {
    const nextArea = field === 'area' ? value : kwArea;
    const nextBlock = field === 'block' ? value : kwBlock;
    const nextStreet = field === 'street' ? value : kwStreet;
    const nextAvenue = field === 'avenue' ? value : kwAvenue;
    const nextHouse = field === 'house' ? value : kwHouse;
    const nextApt = field === 'apartment' ? value : kwApartment;
    const nextExtra = field === 'extra' ? value : kwExtra;

    if (field === 'area') setKwArea(value);
    if (field === 'block') setKwBlock(value);
    if (field === 'street') setKwStreet(value);
    if (field === 'avenue') setKwAvenue(value);
    if (field === 'house') setKwHouse(value);
    if (field === 'apartment') setKwApartment(value);
    if (field === 'extra') setKwExtra(value);

    const fullAddr = assembleKuwaitAddress({
      area: nextArea,
      block: nextBlock,
      street: nextStreet,
      avenue: nextAvenue,
      house: nextHouse,
      apartment: nextApt,
      extra: nextExtra,
    });
    setCustomerAddress(fullAddr);
  };
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'instapay_wallet' | 'credit_card'>('cod');
  const [paymentSession, setPaymentSession] = useState<StorefrontPaymentSessionResponse | null>(null);
  const [createdOrderForPayment, setCreatedOrderForPayment] = useState<CreateOnlineOrderResponse | null>(null);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [isDeviceMatched, setIsDeviceMatched] = useState(false);
  // Returning shopper: their saved details collapse into one summary line and the order is one tap
  // away. "تعديل البيانات" brings the full form back.
  const [expressMode, setExpressMode] = useState(false);
  const brandColor = info?.brandColor || 'var(--storefront-primary-color, #170e5e)';
  const brandColorContrast = getContrastTextColor(info?.brandColor);
  const [serverQuote, setServerQuote] = useState<QuoteCartResponse | null>(null);
  const [, setIsQuoting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<ValidateCouponResponse | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>('');
  const scrollBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !tenantSlug || cartItems.length === 0) {
      setServerQuote(null);
      return;
    }
    let cancelled = false;
    setIsQuoting(true);

    const quotePayload = {
      items: cartItems.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        variantName: item.product.variantName || undefined,
      })),
      couponCode: appliedCoupon?.ok ? appliedCoupon.code : undefined,
      deliveryZoneId: selectedZoneId || undefined,
      fulfillmentType,
      orderType: isDineIn ? ('dine_in' as const) : ('delivery' as const),
      tableNumber: tableNumber ? String(tableNumber) : undefined,
    };

    storefrontApi
      .quoteCart(tenantSlug, quotePayload)
      .then((res) => {
        if (!cancelled && res?.ok) {
          setServerQuote(res);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsQuoting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, tenantSlug, cartItems, appliedCoupon, selectedZoneId, fulfillmentType, isDineIn, tableNumber]);

  // Trigger initiate checkout event for marketing pixels
  useEffect(() => {
    if (isOpen) {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = globalThis.crypto.randomUUID();
      }
      trackStorefrontEvent('InitiateCheckout', {
        value: subtotal,
        currency: info?.currency || 'EGP',
        numItems: cartItems.length,
      });
    }
  }, [isOpen]);

  // Silent abandoned cart capture
  const recordAbandonedCartSilent = () => {
    if (!tenantSlug || !customerPhone || isDineIn) return;
    const phoneValid = getDynamicPhoneValidation(customerPhone, selectedCountry);
    if (!phoneValid.isValid) return;
    try {
      storefrontApi.recordAbandonedCart(tenantSlug, {
        customerPhone: customerPhone.trim(),
        customerName: customerName.trim() || undefined,
        countryCode: selectedCountry,
        items: cartItems.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: item.product.price,
          total: item.product.price * item.quantity,
        })),
        subtotal,
      });
    } catch {}
  };

  const activeDeliveryZones = (info?.deliveryZones || []).filter((z) => z.isActive !== false);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const savedZone = localStorage.getItem('zsystems.storefront.saved_zone_id');
      if (savedZone && activeDeliveryZones.some((z) => z.id === Number(savedZone))) {
        setSelectedZoneId(Number(savedZone));
      } else if (activeDeliveryZones.length > 0) {
        setSelectedZoneId((prev) => (prev !== null && activeDeliveryZones.some((z) => z.id === prev) ? prev : activeDeliveryZones[0].id));
      }
    } catch {
      if (activeDeliveryZones.length > 0) {
        setSelectedZoneId((prev) => (prev !== null && activeDeliveryZones.some((z) => z.id === prev) ? prev : activeDeliveryZones[0].id));
      }
    }
  }, [isOpen, activeDeliveryZones.length]);

  const handleZoneSelect = (zoneId: number) => {
    setSelectedZoneId(zoneId);
    try {
      localStorage.setItem('zsystems.storefront.saved_zone_id', String(zoneId));
    } catch {}
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useBodyScrollLock(isOpen);

  useEffect(() => {
    // Always reset loading and error states whenever modal open state toggles
    setLoading(false);
    setErrorMsg('');
    setCouponError('');
    isSubmittingRef.current = false;

    if (!isOpen) return;

    try {
      const saved = localStorage.getItem(STOREFRONT_SAVED_CUSTOMER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.phone) {
          setCustomerPhone(parsed.phone);
          if (parsed?.name) setCustomerName(parsed.name);
          if (parsed?.address) {
            setCustomerAddress(parsed.address);
            const parsedKw = parseKuwaitAddress(parsed.address);
            if (parsedKw.area || parsedKw.block || parsedKw.street || parsedKw.house) {
              setKwArea(parsedKw.area);
              setKwBlock(parsedKw.block);
              setKwStreet(parsedKw.street);
              setKwAvenue(parsedKw.avenue);
              setKwHouse(parsedKw.house);
              setKwApartment(parsedKw.apartment);
              setKwExtra(parsedKw.extra);
            }
          }
          setIsDeviceMatched(true);
          setExpressMode(!editingOrderNumber);
        }
      }
    } catch {}
  }, [isOpen]);

  const handlePhoneChange = (rawVal: string) => {
    const maxLen = selectedCountry === 'EG' ? 11 : selectedCountry === 'SA' || selectedCountry === 'AE' ? 10 : 15;
    const val = rawVal.replace(/\D/g, '').slice(0, maxLen);
    setCustomerPhone(val);

    const phoneVal = getDynamicPhoneValidation(val, selectedCountry);
    if (phoneVal.isValid) {
      try {
        const saved = localStorage.getItem(STOREFRONT_SAVED_CUSTOMER_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const savedClean = (parsed?.phone || '').replace(/\D/g, '');
          if (savedClean === val) {
            if (parsed?.name) setCustomerName(parsed.name);
            if (parsed?.address) {
              setCustomerAddress(parsed.address);
              const parsedKw = parseKuwaitAddress(parsed.address);
              if (parsedKw.area || parsedKw.block || parsedKw.street || parsedKw.house) {
                setKwArea(parsedKw.area);
                setKwBlock(parsedKw.block);
                setKwStreet(parsedKw.street);
                setKwAvenue(parsedKw.avenue);
                setKwHouse(parsedKw.house);
                setKwApartment(parsedKw.apartment);
                setKwExtra(parsedKw.extra);
              }
            }
            setIsDeviceMatched(true);
            return;
          }
        }
      } catch {}
    }
    setIsDeviceMatched(false);
  };

  const handleModalClose = () => {
    setLoading(false);
    setErrorMsg('');
    setCouponCodeInput('');
    setAppliedCoupon(null);
    setCouponError('');
    isSubmittingRef.current = false;
    onClose();
  };

  const handleApplyCoupon = async () => {
    const cleanCode = couponCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setCouponError(isEn ? 'Please enter a coupon code first' : 'يرجى كتابة كود الكوبون أولاً');
      return;
    }
    if (!tenantSlug) return;

    setCouponLoading(true);
    setCouponError('');

    try {
      const res = await storefrontApi.validateCoupon(tenantSlug, cleanCode, subtotal);
      if (res.ok) {
        setAppliedCoupon(res);
        setCouponError('');
      } else {
        setAppliedCoupon(null);
        setCouponError(res.message || (isEn ? 'Invalid coupon code' : 'كود الكوبون غير صالح'));
      }
    } catch (err: any) {
      setAppliedCoupon(null);
      setCouponError(err.message || (isEn ? 'Could not verify coupon code' : 'تعذر التحقق من كود الكوبون'));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCodeInput('');
    setCouponError('');
  };

  if (!isOpen) return null;

  const localTotals = calculateCartSubtotal(cartItems);
  const subtotal = serverQuote ? serverQuote.subtotal : localTotals.subtotal;
  const bogoSavings = serverQuote ? serverQuote.bogoSavings : localTotals.totalSavings;

  const selectedZone = activeDeliveryZones.find((z) => z.id === selectedZoneId) || (activeDeliveryZones.length > 0 ? activeDeliveryZones[0] : null);
  const rawDeliveryFee = serverQuote
    ? serverQuote.deliveryFee
    : (selectedZone ? selectedZone.deliveryFee : (deliveryFeeProp ?? info?.deliveryFee ?? 0));

  // Automatic Free Shipping Rule
  const isAutoFreeShipping = Boolean(info?.freeShippingEnabled && subtotal >= (info?.freeShippingMinOrder || 500));
  const freeShippingThreshold = info?.freeShippingMinOrder || 500;
  const freeShippingRemaining = (info?.freeShippingEnabled && !isAutoFreeShipping)
    ? Math.max(0, freeShippingThreshold - subtotal)
    : 0;

  // Coupon Free Shipping & Discount
  const isPickup = fulfillmentType === 'pickup';
  const isCouponFreeShipping = Boolean(appliedCoupon?.ok && appliedCoupon?.isFreeShipping);
  const effectiveDeliveryFee = (isDineIn || isPickup || isAutoFreeShipping || isCouponFreeShipping) ? 0 : rawDeliveryFee;

  let discountAmount = 0;
  if (serverQuote) {
    discountAmount = serverQuote.discountAmount;
  } else if (appliedCoupon?.ok && appliedCoupon.discountAmount) {
    discountAmount = Math.min(subtotal, appliedCoupon.discountAmount);
  }

  const total = serverQuote
    ? serverQuote.totalAmount
    : (Math.max(0, subtotal - discountAmount) + effectiveDeliveryFee);

  const storeCurrency = info?.currency || getGlobalCurrencySymbol();
  const isThreeDec = isThreeDecimalCurrency(storeCurrency);
  const activeCurrencySymbol = getCurrencySymbol(storeCurrency);

  const formatMoney = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) {
      return num.toFixed(3);
    }
    if (storeCurrency === 'EGP') {
      return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    }
    return num.toFixed(2);
  };

  const phoneStatus = getDynamicPhoneValidation(customerPhone, selectedCountry, isEn);
  const nameStatus = getCustomerNameValidation(customerName, isEn);
  const addressStatus = getCustomerAddressValidation(customerAddress, isEn);
  // Only collapse when every saved field would pass validation — otherwise show the form so the
  // shopper can see what needs fixing.
  const canExpress = expressMode && phoneStatus.isValid && nameStatus.isValid && (isDineIn || isPickup || addressStatus.isValid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    if (!editingOrderNumber && cartItems.length === 0) {
      showError(isEn ? 'Your cart is empty. Please add items first.' : 'سلة المشتريات فارغة، يرجى إضافة أصناف إلى السلة أولاً.');
      return;
    }

    const phoneValid = getDynamicPhoneValidation(customerPhone, selectedCountry, isEn);
    if (!phoneValid.isValid) {
      showError(phoneValid.message || (isEn ? 'Please enter a valid phone number' : 'يرجى إدخال رقم هاتف صحيح'));
      return;
    }

    const trimmedName = customerName.trim();
    const nameLetters = (trimmedName.match(/[\p{L}\p{M}]/gu) || []).length;
    if (nameLetters < 2) {
      showError(isEn ? 'Please enter a valid recipient name (at least 2 letters)' : 'يرجى إدخال اسم مستلم صحيح لا يقل عن حرفين');
      return;
    }

    const trimmedAddress = isDineIn
      ? (isEn ? `Table #${tableNumber}` : `طاولة رقم ${tableNumber}`)
      : isPickup
      ? (isEn ? 'Store Pickup' : 'استلام ذاتي من الفرع')
      : customerAddress.trim();

    if (!isDineIn && !isPickup) {
      if (isKuwait && useKwStructured) {
        if (!kwArea.trim() || !kwBlock.trim() || !kwStreet.trim() || !kwHouse.trim()) {
          showError(isEn ? 'Please complete Kuwait address details: Area, Block, Street, and House number' : 'يرجى استكمال بيانات العنوان الكويتي: المنطقة، القطعة، الشارع، ورقم المنزل');
          return;
        }
      }
      if (!trimmedAddress) {
        showError(isEn ? 'Please enter a delivery address' : 'يرجى إدخال عنوان توصيل');
        return;
      }
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setErrorMsg('');

    try {
      // Persist customer details on this device if requested
      if (rememberDevice) {
        try {
          localStorage.setItem(
            STOREFRONT_SAVED_CUSTOMER_KEY,
            JSON.stringify({
              name: customerName.trim(),
              phone: customerPhone.trim(),
              address: customerAddress.trim(),
              savedAt: new Date().toISOString(),
            })
          );
        } catch {}
      } else {
        try {
          localStorage.removeItem(STOREFRONT_SAVED_CUSTOMER_KEY);
        } catch {}
      }

      if (editingOrderNumber && tenantSlug) {
        const payload = {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: customerAddress.trim(),
          customerNotes: customerNotes.trim(),
          paymentMethod,
          couponCode: appliedCoupon?.ok ? appliedCoupon.code : undefined,
          deliveryZoneId: selectedZone ? selectedZone.id : undefined,
          deliveryZoneName: selectedZone ? selectedZone.name : undefined,
          items: cartItems.map((item) => ({
            productId: Number(item.product.id),
            quantity: Number(item.quantity) || 1,
            variantName: item.product.variantName || undefined,
          })),
        };
        const editToken = getCustomerOrderToken(tenantSlug, editingOrderNumber);
        if (!editToken) {
          throw new Error('تعذر التحقق من ملكية الطلب على هذا الجهاز، يرجى التواصل مع المتجر لتعديله');
        }
        await storefrontApi.updateCustomerOrder(tenantSlug, editingOrderNumber, editToken, payload);
        if (onEditSuccess) {
          onEditSuccess(editingOrderNumber);
        } else {
          handleModalClose();
        }
      } else if (onSubmitOrder) {
        await onSubmitOrder({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: trimmedAddress,
          customerNotes: customerNotes.trim(),
          paymentMethod,
          couponCode: appliedCoupon?.ok ? appliedCoupon.code : undefined,
          deliveryZoneId: selectedZone ? selectedZone.id : undefined,
          deliveryZoneName: selectedZone ? selectedZone.name : undefined,
          orderType: isDineIn ? 'dine_in' : 'delivery',
          tableNumber: tableNumber || undefined,
          fulfillmentType: isDineIn ? 'dine_in' : (isPickup ? 'pickup' : 'delivery'),
          countryCode: selectedCountry,
        });
      } else if (tenantSlug && onOrderSuccess) {
        const payload = {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: trimmedAddress,
          customerNotes: customerNotes.trim(),
          paymentMethod,
          couponCode: appliedCoupon?.ok ? appliedCoupon.code : undefined,
          deliveryZoneId: selectedZone ? selectedZone.id : undefined,
          deliveryZoneName: selectedZone ? selectedZone.name : undefined,
          orderType: isDineIn ? ('dine_in' as const) : ('delivery' as const),
          tableNumber: tableNumber || undefined,
          fulfillmentType: isDineIn ? ('dine_in' as const) : (isPickup ? ('pickup' as const) : ('delivery' as const)),
          countryCode: selectedCountry,
          idempotencyKey: idempotencyKeyRef.current || undefined,
          items: cartItems.map((item) => ({
            productId: Number(item.product.id),
            quantity: Number(item.quantity) || 1,
            variantName: item.product.variantName || undefined,
          })),
        };
        const res = await storefrontApi.createOrder(tenantSlug, payload);
        idempotencyKeyRef.current = '';

        trackStorefrontEvent('Purchase', {
          orderNumber: res.orderNumber,
          value: res.totalAmount,
          currency: info?.currency || 'EGP',
          numItems: cartItems.length,
        });

        saveCustomerOrderRef(tenantSlug, res.orderNumber, res.accessToken);
        saveLocalOrderRecord(tenantSlug, {
          id: res.orderId || Date.now(),
          orderNumber: res.orderNumber,
          orderType: res.orderType || (isDineIn ? 'dine_in' : 'delivery'),
          tableNumber: res.tableNumber || tableNumber || null,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: trimmedAddress,
          customerNotes: customerNotes.trim() || null,
          deliveryZoneId: res.deliveryZoneId ?? (selectedZone ? selectedZone.id : null),
          deliveryZoneName: res.deliveryZoneName ?? (selectedZone ? selectedZone.name : null),
          subtotal: res.subtotal ?? subtotal,
          deliveryFee: res.deliveryFee ?? effectiveDeliveryFee,
          totalAmount: res.totalAmount ?? total,
          discountAmount: res.discountAmount ?? discountAmount,
          couponCode: res.couponCode ?? (appliedCoupon?.ok ? appliedCoupon.code : null),
          status: 'pending',
          paymentMethod,
          paymentStatus: 'pending',
          saleId: null,
          createdAt: new Date().toISOString(),
          items: res.items || cartItems.map((item) => ({
            productId: Number(item.product.id),
            name: item.product.name,
            quantity: Number(item.quantity) || 1,
            unitPrice: item.product.price,
            total: item.product.price * (Number(item.quantity) || 1),
          })),
        });

        if (paymentMethod === 'credit_card') {
          try {
            const session = await storefrontApi.createPaymentSession(tenantSlug, res.orderNumber, res.accessToken || '');
            setCreatedOrderForPayment(res);
            setPaymentSession(session);
            setLoading(false);
            isSubmittingRef.current = false;
            return;
          } catch (sessionErr: any) {
            console.error('Failed to initiate online payment session:', sessionErr);
            onOrderSuccess(res);
            return;
          }
        }

        onOrderSuccess(res);
      } else {
        throw new Error('تعذر إرسال الطلب لعدم اكتمال بيانات المتجر، يرجى تحديث الصفحة والمحاولة مجدداً.');
      }
    } catch (err: any) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErrorMsg('تعذر إرسال الطلب نظراً لعدم وجود اتصال بالإنترنت. يرجى التحقق من اتصالك بالشبكة ثم إعادة المحاولة.');
      } else {
        setErrorMsg(err.message || 'حدث خطأ أثناء تأكيد الطلب، يرجى المحاولة مرة أخرى');
      }
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const handleOnlinePaymentSuccess = (paymentInfo: { orderNumber: string; transactionId: string }) => {
    if (createdOrderForPayment && onOrderSuccess) {
      const updatedOrder = {
        ...createdOrderForPayment,
        paymentStatus: 'paid',
        gatewayTransactionId: paymentInfo.transactionId,
      };
      setPaymentSession(null);
      setCreatedOrderForPayment(null);
      onOrderSuccess(updatedOrder as any);
    }
  };

  if (!isOpen) return null;

  const checkoutModalContent = (
    <div
      className="storefront-checkout-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.48)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        animation: 'sfAppleBackdropIn 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          handleModalClose();
        }
      }}
    >
      <div
        dir={dir}
        className="storefront-checkout-modal-container"
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: 'min(92vh, calc(100dvh - 24px))',
          background: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          margin: 'auto',
          border: '1px solid #e2e8f0',
          direction: dir,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
          animation: 'sfAppleSpringOpen 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          .storefront-checkout-modal-container {
            width: 100%;
            max-width: 960px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
          }
          .storefront-checkout-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            align-items: start;
          }
          .storefront-checkout-col {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .storefront-checkout-header {
            padding: 12px 18px;
          }
          .storefront-checkout-body {
            padding: 12px 18px;
          }
          .storefront-checkout-footer {
            padding: 10px 18px;
          }
          @media (max-width: 768px) {
            .storefront-checkout-modal-container {
              max-width: 480px !important;
              max-height: calc(100dvh - 12px) !important;
            }
            .storefront-checkout-grid {
              grid-template-columns: 1fr !important;
              gap: 6px !important;
            }
            .storefront-checkout-col {
              gap: 6px !important;
            }
            .storefront-checkout-header {
              padding: 7px 12px !important;
            }
            .storefront-checkout-body {
              padding: 6px 10px !important;
            }
            .storefront-checkout-footer {
              padding: 6px 10px !important;
            }
          }
        `}</style>
        {/* Header */}
        <div
          className="storefront-checkout-header"
          style={{
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                background: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e0e7ff',
                flexShrink: 0,
              }}
            >
              <PackageIcon size={16} color="#170e5e" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                <h2 style={{ margin: 0, fontSize: '15.5px', fontWeight: 800, color: '#0f172a' }}>
                  {editingOrderNumber
                    ? (isEn ? `Edit Order #${editingOrderNumber}` : `تعديل الطلب #${editingOrderNumber}`)
                    : t('storefront.storefront_checkout_modal.s0', "إتمام وتأكيد الطلب")}
                </h2>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {editingOrderNumber ? t('storefront.storefront_checkout_modal.s1', "تعديل بيانات وأصناف طلبك قبل اعتماده من المتجر") : t('storefront.storefront_checkout_modal.s2', "الدفع نقداً عند استلام الطلب")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f0f4f9',
              border: '1px solid #dadce0',
              borderRadius: '12px',
              width: '30px',
              height: '30px',
              aspectRatio: '1 / 1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#1f1f1f',
              padding: 0,
              boxSizing: 'border-box',
              flexShrink: 0,
              transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#e3e8ee')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f4f9')}
            title={t('storefront.storefront_checkout_modal.s3', "إغلاق (Esc)")}
          >
            <XIcon size={14} color="#1f1f1f" strokeWidth={2.2} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Scrollable Fields Body */}
          <div
            ref={scrollBodyRef}
            className="storefront-checkout-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {errorMsg && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  color: '#991b1b',
                  marginBottom: '16px',
                }}
              >
                {errorMsg}
              </div>
            )}

            <div className="storefront-checkout-grid">
              {/* Column 1: Fulfillment, Customer Details & Address */}
              <div className="storefront-checkout-col">
                {/* Fulfillment Type Toggle (Delivery vs Pickup) - Hidden for Dine-in */}
                {!isDineIn && info?.pickupEnabled !== false && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('delivery')}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '0 8px',
                        height: '36px',
                        borderRadius: '8px',
                        border: fulfillmentType === 'delivery' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
                        background: fulfillmentType === 'delivery' ? 'rgba(23, 14, 94, 0.05)' : '#ffffff',
                        color: fulfillmentType === 'delivery' ? brandColor : '#475569',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <TruckIcon size={14} color={fulfillmentType === 'delivery' ? brandColor : '#64748b'} />
                      <span style={{ whiteSpace: 'nowrap' }}>{t('storefront.storefront_checkout_modal.s4', "توصيل للمنزل")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('pickup')}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '0 8px',
                        height: '36px',
                        borderRadius: '8px',
                        border: fulfillmentType === 'pickup' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
                        background: fulfillmentType === 'pickup' ? 'rgba(23, 14, 94, 0.05)' : '#ffffff',
                        color: fulfillmentType === 'pickup' ? brandColor : '#475569',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <PackageIcon size={14} color={fulfillmentType === 'pickup' ? brandColor : '#64748b'} />
                      <span style={{ whiteSpace: 'nowrap' }}>{t('storefront.storefront_checkout_modal.s5', "استلام من الفرع")}</span>
                      <span style={{ fontSize: '10.5px', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '1px 3px', borderRadius: '4px', flexShrink: 0 }}>{t('storefront.storefront_checkout_modal.s6', "مجاني")}</span>
                    </button>
                  </div>
                )}

                {canExpress && (
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '10px',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>
                          {isDineIn ? t('storefront.storefront_checkout_modal.s7', "الطلب باسم") : isPickup ? t('storefront.storefront_checkout_modal.s8', "الاستلام باسم") : t('storefront.storefront_checkout_modal.s9', "بيانات التوصيل")}
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            background: '#dcfce7',
                            color: '#15803d',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '8px',
                          }}
                        >
                          <CheckIcon size={10} color="#15803d" strokeWidth={3} />
                          {t('storefront.storefront_checkout_modal.s10', "بيانات محفوظة")}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{customerName}</div>
                      <div style={{ fontSize: '11.5px', color: '#334155', direction: 'ltr', textAlign: 'right', marginTop: '1px', fontWeight: 600 }}>
                        {customerPhone}
                      </div>
                      {!isDineIn && !isPickup && (
                        <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {customerAddress}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpressMode(false)}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        color: brandColor,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontFamily: 'inherit',
                        padding: '4px 8px',
                      }}
                    >
                      {t('storefront.storefront_checkout_modal.s11', "تعديل")}
                    </button>
                  </div>
                )}

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

                {/* Delivery Zone Matrix Selector (Hidden for Dine-In and Pickup) */}
                {!isDineIn && !isPickup && activeDeliveryZones.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <label style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
                        {t('storefront.storefront_checkout_modal.s19', "منطقة / حي التوصيل")} <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      {selectedZone?.estimatedTime && (
                        <span style={{ fontSize: '10px', color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          {selectedZone.estimatedTime}
                        </span>
                      )}
                    </div>

                    <select
                      value={selectedZone?.id ?? ''}
                      onChange={(e) => handleZoneSelect(Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        height: '36px',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '12.5px',
                        outline: 'none',
                        background: '#f8fafc',
                        fontFamily: 'inherit',
                        fontWeight: 600,
                        color: '#0f172a',
                        cursor: 'pointer',
                      }}
                    >
                      {activeDeliveryZones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} — {z.deliveryFee === 0 ? t('storefront.storefront_checkout_modal.s20', "توصيل مجاني (0 ج)") : `${z.deliveryFee} ${getGlobalCurrencySymbol()}`} {z.estimatedTime ? `(${z.estimatedTime})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Customer Address, Pickup Notice, or Dine-In Table Badge */}
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

                {/* Optional Notes & Promo Link Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '1px 2px' }}>
                  {!showNotes && !customerNotes.trim() ? (
                    <button
                      type="button"
                      onClick={() => setShowNotes(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: brandColor,
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '2px 0',
                        fontFamily: 'inherit',
                      }}
                    >
                      {t('storefront.storefront_checkout_modal.s28', "+ إضافة ملاحظات للطلب (اختياري)")}
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('storefront.storefront_checkout_modal.s29', "ملاحظات الطلب")}</span>
                  )}

                  {!showCouponInput && !appliedCoupon?.ok ? (
                    <button
                      type="button"
                      onClick={() => setShowCouponInput(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#b45309',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '2px 0',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <TagIcon size={13} color="#b45309" />
                      <span>{t('storefront.storefront_checkout_modal.s30', "لديك كوبون خصم؟")}</span>
                    </button>
                  ) : null}
                </div>

                {/* Collapsed Notes Field (visible when clicked or has content) */}
                {(showNotes || customerNotes.trim()) && (
                  <div>
                    <textarea
                      rows={1}
                      autoFocus={showNotes && !customerNotes}
                      value={customerNotes}
                      onChange={(e) => setCustomerNotes(e.target.value)}
                      placeholder={t('storefront.storefront_checkout_modal.s31', "اكتب أي تعليمات لتحضير طلبك أو للتوصيل (اختياري)...")}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        outline: 'none',
                        background: '#f8fafc',
                        fontFamily: 'inherit',
                        resize: 'none',
                        minHeight: '40px',
                        height: '40px',
                        boxSizing: 'border-box',
                        lineHeight: '1.45',
                        fontSize: '12.5px',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Column 2: Payment, Promo, Summary */}
              <div className="storefront-checkout-col">
                {/* Payment Method Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '3px' }}>
                    {t('storefront.storefront_checkout_modal.s32', "طريقة الدفع")}
                  </label>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      gap: '6px',
                      width: '100%',
                    }}
                  >
                    {/* COD Option */}
                    <div
                      onClick={() => setPaymentMethod('cod')}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: paymentMethod === 'cod' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
                        background: paymentMethod === 'cod' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
                        borderRadius: '8px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        height: '36px',
                        boxSizing: 'border-box',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          border: paymentMethod === 'cod' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
                          background: '#ffffff',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: paymentMethod === 'cod' ? brandColor : '#0f172a',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isDineIn ? t('storefront.storefront_checkout_modal.s33', "في الصالة") : isEn ? "Cash on Delivery" : "عند الاستلام"}
                      </span>
                    </div>

                    {/* Pre-payment Option */}
                    <div
                      onClick={() => setPaymentMethod('instapay_wallet')}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: paymentMethod === 'instapay_wallet' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
                        background: paymentMethod === 'instapay_wallet' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
                        borderRadius: '8px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        height: '36px',
                        boxSizing: 'border-box',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          border: paymentMethod === 'instapay_wallet' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
                          background: '#ffffff',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: paymentMethod === 'instapay_wallet' ? brandColor : '#0f172a',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isKuwait ? (isEn ? "Bank Transfer" : "تحويل بنكي") : t('storefront.storefront_checkout_modal.s37', "إنستاباي / محفظة")}
                      </span>
                    </div>

                    {/* Credit Card Online Payment Option */}
                    {info?.onlinePaymentEnabled && (
                      <div
                        onClick={() => setPaymentMethod('credit_card')}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: paymentMethod === 'credit_card' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
                          background: paymentMethod === 'credit_card' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
                          borderRadius: '8px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          height: '36px',
                          boxSizing: 'border-box',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div
                          style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            border: paymentMethod === 'credit_card' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
                            background: '#ffffff',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: paymentMethod === 'credit_card' ? brandColor : '#0f172a',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isKuwait ? (isEn ? "K-NET / Card" : "كي نت / بطاقة") : t('storefront.storefront_checkout_modal.s39', "بطاقة بنكية")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Notice if credit_card is selected */}
                  {paymentMethod === 'credit_card' && (
                    <div
                      style={{
                        marginTop: '6px',
                        background: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '11.5px',
                        color: '#0369a1',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>
                        {isKuwait ? t('storefront.storefront_checkout_modal.s40', "دفع إلكتروني فوري وآمن (كي نت / بطاقات بنكية):") : t('storefront.storefront_checkout_modal.s41', "دفع إلكتروني فوري وآمن:")}
                      </div>
                      <div style={{ color: '#0c4a6e', fontSize: '11px', lineHeight: '1.4' }}>
                        {isKuwait
                          ? `سيتم فتح بوابة الدفع الآمنة لسداد مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) فور الضغط على إرسال الطلب.`
                          : `سيتم فتح بوابة الدفع الآمنة لسداد مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) ببطاقتك البنكية فور الضغط على إرسال الطلب.`}
                      </div>
                    </div>
                  )}

                  {/* Notice if instapay/wallet is selected */}
                  {paymentMethod === 'instapay_wallet' && (
                    <div
                      style={{
                        marginTop: '6px',
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '11.5px',
                        color: '#166534',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>
                        {isKuwait ? t('storefront.storefront_checkout_modal.s42', "بيانات التحويل البنكي / الرابط:") : t('storefront.storefront_checkout_modal.s43', "رقم التحويل (إنستاباي / كاش):")}{' '}
                        <span style={{ direction: 'ltr', display: 'inline-block', color: brandColor, fontWeight: 900 }}>
                          {info?.whatsappPhone || t('storefront.storefront_checkout_modal.s44', "يرجى التواصل عبر الواتساب")}
                        </span>
                      </div>
                      <div style={{ color: '#15803d', fontSize: '11px', lineHeight: '1.4' }}>
                        {isKuwait
                          ? `يرجى تحويل مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) وإرسال إشعار التحويل عبر الواتساب لتأكيد الطلب فوراً.`
                          : `يرجى تحويل مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) وإرسال إشعار التحويل عبر الواتساب لتأكيد الشحن فوراً.`}
                      </div>
                    </div>
                  )}
                </div>

                {/* Automatic Free Shipping Callout (Hidden for Dine-In) */}
                {!isDineIn && info?.freeShippingEnabled && (
                  <div>
                    {isAutoFreeShipping ? (
                      <div
                        style={{
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#065f46',
                          fontSize: '11.5px',
                          fontWeight: 700,
                        }}
                      >
                        <span>
                          {t('storefront.storefront_checkout_modal.s45', "مبروك! مشترياتك تجاوزت")} {formatMoney(freeShippingThreshold)} <CurrencySymbol currency={storeCurrency} /> {t('storefront.storefront_checkout_modal.s46', "وحصلت على شحن مجاني")}{rawDeliveryFee > 0 ? <> {t('storefront.storefront_checkout_modal.s47', "(توفير")} {formatMoney(rawDeliveryFee)} <CurrencySymbol currency={storeCurrency} />)</> : ''}.
                        </span>
                      </div>
                    ) : freeShippingRemaining > 0 ? (
                      <div
                        style={{
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          color: '#0369a1',
                          fontSize: '10.5px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <TruckIcon size={12} color="#0284c7" />
                          <span>
                            {t('storefront.storefront_checkout_modal.s48', "أضف بـ")} <strong style={{ color: '#0284c7' }}>{formatMoney(freeShippingRemaining)} <CurrencySymbol currency={storeCurrency} /></strong> {t('storefront.storefront_checkout_modal.s49', "لشحن مجاني!")}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '9.5px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 700,
                          }}
                        >
                          {t('storefront.storefront_checkout_modal.s50', "عرض الشحن")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Promo Code Input Box (Visible when toggled or applied) */}
                {(showCouponInput || appliedCoupon?.ok) && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>
                        {t('storefront.storefront_checkout_modal.s51', "كود الخصم أو الكوبون:")}
                      </label>
                      {appliedCoupon?.ok && (
                        <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckIcon size={11} color="#16a34a" strokeWidth={2.5} />
                          <span>{t('storefront.storefront_checkout_modal.s52', "تم التطبيق")}</span>
                        </span>
                      )}
                    </div>

                    {appliedCoupon?.ok ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#ecfdf5',
                          border: '1px solid #86efac',
                          borderRadius: '6px',
                          padding: '4px 8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <TagIcon size={12} color="#166534" strokeWidth={2} />
                          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#166534', fontSize: '11.5px' }}>
                            {appliedCoupon.code}
                          </span>
                          <span style={{ fontSize: '10px', color: '#15803d', marginRight: '4px' }}>
                            {appliedCoupon.isFreeShipping ? t('storefront.storefront_checkout_modal.s53', "(شحن مجاني)") : `(خصم ${formatMoney(discountAmount)} ${activeCurrencySymbol})`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#dc2626',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: '1px 3px',
                          }}
                        >
                          {t('storefront.storefront_checkout_modal.s54', "إلغاء")}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="text"
                            value={couponCodeInput}
                            onChange={(e) => {
                              setCouponCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''));
                              setCouponError('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleApplyCoupon();
                              }
                            }}
                            placeholder={t('storefront.storefront_checkout_modal.s55', "أدخل كود الكوبون هنا...")}
                            style={{
                              flex: 1,
                              padding: '4px 8px',
                              height: '30px',
                              boxSizing: 'border-box',
                              borderRadius: '6px',
                              border: couponError ? '1.5px solid #f87171' : '1px solid #cbd5e1',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              direction: 'ltr',
                              textAlign: 'right',
                              background: '#ffffff',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleApplyCoupon}
                            disabled={couponLoading || !couponCodeInput.trim()}
                            style={{
                              padding: '4px 10px',
                              height: '30px',
                              borderRadius: '6px',
                              background: brandColor,
                              color: brandColorContrast || 'var(--storefront-primary-contrast, #ffffff)',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              border: 'none',
                              cursor: couponLoading || !couponCodeInput.trim() ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {couponLoading ? t('storefront.storefront_checkout_modal.s56', "جاري...") : t('storefront.storefront_checkout_modal.s57', "تطبيق")}
                          </button>
                        </div>
                        {couponError && (
                          <span style={{ display: 'block', fontSize: '10px', color: '#dc2626', marginTop: '2px', fontWeight: 600 }}>
                            {couponError}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Order Total Summary */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                    <span>{t('storefront.storefront_checkout_modal.s58', "مجموع الأصناف:")}</span>
                    <span style={{ fontWeight: 600, color: '#334155' }}>{formatMoney(subtotal)} <CurrencySymbol currency={storeCurrency} /></span>
                  </div>

                  {bogoSavings > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#059669', background: '#ecfdf5', padding: '3px 6px', borderRadius: '4px' }}>
                      <span style={{ fontWeight: 700 }}>{t('storefront.storefront_checkout_modal.s59', "وفرت من عروض المتجر (BOGO):")}</span>
                      <strong style={{ fontWeight: 800 }}>- {formatMoney(bogoSavings)} <CurrencySymbol currency={storeCurrency} /></strong>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                    <span>
                      {isDineIn
                        ? t('storefront.storefront_checkout_modal.s60', "خدمة الصالة / الطاولة:")
                        : isEn
                        ? `Delivery Fee ${selectedZone ? `(${selectedZone.name})` : ''}:`
                        : `خدمة التوصيل ${selectedZone ? `(${selectedZone.name})` : ''}:`}
                    </span>
                    {isDineIn ? (
                      <strong style={{ color: '#166534' }}>{t('storefront.storefront_checkout_modal.s61', "مجاناً (طلب صالة)")}</strong>
                    ) : effectiveDeliveryFee === 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {rawDeliveryFee > 0 && (
                          <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>{formatMoney(rawDeliveryFee)} {activeCurrencySymbol}</span>
                        )}
                        <strong style={{ color: '#166534' }}>{t('storefront.storefront_checkout_modal.s62', "توصيل مجاني")}</strong>
                      </div>
                    ) : (
                      <span style={{ fontWeight: 600, color: '#334155' }}>{formatMoney(effectiveDeliveryFee)} <CurrencySymbol currency={storeCurrency} /></span>
                    )}
                  </div>

                  {discountAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#16a34a' }}>
                      <span>{t('storefront.storefront_checkout_modal.s63', "خصم الكوبون (")}{appliedCoupon?.code}):</span>
                      <strong style={{ fontWeight: 800 }}>- {formatMoney(discountAmount)} <CurrencySymbol currency={storeCurrency} /></strong>
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: '3px',
                      marginTop: '1px',
                      borderTop: '1px dashed #cbd5e1',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                      {t('storefront.storefront_checkout_modal.s64', "المبلغ الإجمالي للدفع:")}
                    </span>
                    <span style={{ fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
                      {formatMoney(total)} <CurrencySymbol currency={storeCurrency} />
                    </span>
                  </div>
                </div>

                {/* Remember details checkbox (default checked) */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    color: '#475569',
                    userSelect: 'none',
                    margin: '2px 2px', gap: '6px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    style={{
                      width: '14px',
                      height: '14px',
                      accentColor: brandColor,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                    {t('storefront.storefront_checkout_modal.s65', "تذكر بياناتي على هذا الجهاز لتسريع الطلب في المرات القادمة")}
                  </span>
                </label>
              </div>
            </div>
        </div>

        {/* Sticky Bottom Actions Bar (Always visible & accessible on all screens) */}
        <div
          className="storefront-checkout-footer"
          style={{
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
            boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.04)',
            zIndex: 10,
          }}
        >
          <button
            type="submit"
            disabled={loading}
            style={{
              flex: 1,
              height: '40px',
              padding: '0 20px',
              borderRadius: '12px',
              background: brandColor,
              color: brandColorContrast || 'var(--storefront-primary-contrast, #ffffff)',
              fontSize: '13px',
              fontWeight: 700,
              border: `1px solid ${brandColor}`,
              cursor: loading ? 'wait' : 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            {loading
              ? t('storefront.storefront_checkout_modal.s66', "جاري الحفظ...")
              : editingOrderNumber
              ? t('storefront.storefront_checkout_modal.s67', "حفظ تعديلات الطلب")
              : isDineIn
              ? (isEn ? `Send to Kitchen (Table ${tableNumber || ''})` : `إرسال للمطبخ (طاولة ${tableNumber || ''})`)
              : t('storefront.storefront_checkout_modal.s68', "إرسال وتأكيد الطلب الآن")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              height: '40px',
              padding: '0 18px',
              borderRadius: '12px',
              border: '1px solid #dadce0',
              background: '#ffffff',
              color: '#1f1f1f',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            {t('storefront.storefront_checkout_modal.s69', "إلغاء")}
          </button>
        </div>
      </form>
    </div>

    {/* Online Payment Gateway Overlay */}
    {paymentSession && createdOrderForPayment && tenantSlug && (
      <StorefrontOnlinePaymentModal
        isOpen={Boolean(paymentSession)}
        session={paymentSession}
        orderData={createdOrderForPayment}
        tenantSlug={tenantSlug}
        onSuccess={handleOnlinePaymentSuccess}
        onClose={() => {
          if (createdOrderForPayment && onOrderSuccess) {
            onOrderSuccess(createdOrderForPayment);
          }
          setPaymentSession(null);
          setCreatedOrderForPayment(null);
        }}
      />
    )}
  </div>
);

  if (typeof document === 'undefined') return null;
  return createPortal(checkoutModalContent, document.body);
}
