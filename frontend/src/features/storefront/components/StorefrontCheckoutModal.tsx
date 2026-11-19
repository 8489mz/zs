import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol, getCurrencySymbol, isThreeDecimalCurrency, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CreateOnlineOrderResponse, ValidateCouponResponse, StorefrontPaymentSessionResponse, QuoteCartResponse } from '../types/storefront.types';
import { storefrontApi } from '../api/storefront.api';
import { StorefrontOnlinePaymentModal } from './StorefrontOnlinePaymentModal';
import { StorefrontCheckoutShell } from './storefront-checkout/storefront-checkout-shell';
import { CheckoutFulfillmentSection } from './storefront-checkout/checkout-fulfillment-section';
import { CheckoutAddressSection } from './storefront-checkout/checkout-address-section';
import { CheckIcon, TagIcon, TruckIcon, PackageIcon } from '@/shared/components/icons/AppIcons';
import { trackStorefrontEvent } from '../lib/storefront-pixel-tracker';
import { getCustomerOrderToken, saveCustomerOrderRef } from '../lib/customer-order-refs';
import { saveLocalOrderRecord } from './StorefrontMyOrdersModal';
import { calculateCartSubtotal } from '../lib/storefront-cart-pricing';
import { getContrastTextColor } from '../lib/storefront-theme-contrast';
import { useBodyScrollLock } from '@/shared/components/dialog-shell';
import { CheckoutNotesPromoBar } from './storefront-checkout/checkout-notes-promo-bar';
import { CheckoutCustomerSection } from './storefront-checkout/checkout-customer-section';
import { useKuwaitAddress } from './storefront-checkout/use-kuwait-address';
import {
  STOREFRONT_SAVED_CUSTOMER_KEY,
  getCustomerAddressValidation,
  getCustomerNameValidation,
  getDynamicPhoneValidation,
  parseKuwaitAddress,
} from './storefront-checkout/storefront-checkout-helpers';
import type { StorefrontCheckoutModalProps } from './storefront-checkout/storefront-checkout-helpers';
export {
  COUNTRY_OPTIONS,
  KUWAIT_POPULAR_AREAS,
  assembleKuwaitAddress,
  getCustomerAddressValidation,
  getCustomerNameValidation,
  getDynamicPhoneValidation,
  getEgyptianPhoneValidation,
  parseKuwaitAddress,
} from './storefront-checkout/storefront-checkout-helpers';
export type { CountryOption } from './storefront-checkout/storefront-checkout-helpers';


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
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const {
    useKwStructured,
    setUseKwStructured,
    kwArea,
    setKwArea,
    showKwAreaDropdown,
    setShowKwAreaDropdown,
    kwAreaContainerRef,
    filteredKwAreas,
    kwBlock,
    setKwBlock,
    kwStreet,
    setKwStreet,
    kwAvenue,
    setKwAvenue,
    kwHouse,
    setKwHouse,
    kwApartment,
    setKwApartment,
    kwExtra,
    setKwExtra,
    handleKwFieldChange,
  } = useKuwaitAddress(setCustomerAddress);
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
      .catch(() => {
        // INV-REST-QUOTECART-NO-DEMO (R6-A): a failed quote must clear the
        // stale serverQuote, never leave it in place — the modal prices
        // from serverQuote when present, else from real local totals.
        // The old empty catch kept a stale (possibly demo-priced) quote
        // displayed after a failure.
        if (!cancelled) setServerQuote(null);
      })
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
      // INV-FE2-FRONTEND-BOOK-DIGITS: the offline fallback coupon
      // discount rounds at the store currency's digits. NOTE: pass
      // info?.currency (the CODE) — never storeCurrency below, which
      // may hold a symbol (e.g. 'ج.م') that the helper would reject.
      const res = await storefrontApi.validateCoupon(tenantSlug, cleanCode, subtotal, currencyMoneyDigits(info?.currency || getGlobalSystemCurrency()));
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

  // INV-FE2-FRONTEND-BOOK-DIGITS: the local subtotal rounds at the
  // store currency's digits (the server quote, when present, wins).
  const localTotals = calculateCartSubtotal(cartItems, info?.currency);
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
    <StorefrontCheckoutShell
      onClose={onClose}
      onBackdropClose={handleModalClose}
      editingOrderNumber={editingOrderNumber}
    >

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
                <CheckoutFulfillmentSection
                  fulfillmentType={fulfillmentType}
                  setFulfillmentType={setFulfillmentType}
                  isDineIn={isDineIn}
                  isPickup={isPickup}
                  info={info}
                  brandColor={brandColor}
                  canExpress={canExpress}
                  customerName={customerName}
                  customerPhone={customerPhone}
                  customerAddress={customerAddress}
                  setExpressMode={setExpressMode}
                />

                <CheckoutCustomerSection
                  canExpress={canExpress}
                  selectedCountry={selectedCountry}
                  setSelectedCountry={setSelectedCountry}
                  customerPhone={customerPhone}
                  setCustomerPhone={setCustomerPhone}
                  handlePhoneChange={handlePhoneChange}
                  recordAbandonedCartSilent={recordAbandonedCartSilent}
                  customerName={customerName}
                  setCustomerName={setCustomerName}
                  setCustomerAddress={setCustomerAddress}
                  isDeviceMatched={isDeviceMatched}
                  setIsDeviceMatched={setIsDeviceMatched}
                  phoneStatus={phoneStatus}
                  nameStatus={nameStatus}
                />

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
                <CheckoutAddressSection
                  isDineIn={isDineIn}
                  isPickup={isPickup}
                  canExpress={canExpress}
                  isKuwait={isKuwait}
                  useKwStructured={useKwStructured}
                  setUseKwStructured={setUseKwStructured}
                  tableNumber={tableNumber}
                  customerAddress={customerAddress}
                  setCustomerAddress={setCustomerAddress}
                  addressStatus={addressStatus}
                  recordAbandonedCartSilent={recordAbandonedCartSilent}
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
                  brandColor={brandColor}
                />

                <CheckoutNotesPromoBar
                  showNotes={showNotes}
                  setShowNotes={setShowNotes}
                  customerNotes={customerNotes}
                  setCustomerNotes={setCustomerNotes}
                  showCouponInput={showCouponInput}
                  setShowCouponInput={setShowCouponInput}
                  appliedCoupon={appliedCoupon}
                  brandColor={brandColor}
                />
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
    </StorefrontCheckoutShell>
);

  if (typeof document === 'undefined') return null;
  return createPortal(checkoutModalContent, document.body);
}
