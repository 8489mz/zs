import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import {
  CreditCardIcon,
  CheckCircleIcon,
  CameraIcon,
  PackageIcon,
  AlertTriangleIcon,
  SlidersIcon,
  EditIcon,
  SmartphoneIcon,
  SendIcon,
} from '@/shared/components/icons/AppIcons';
import { VanSignaturePadModal, RecipientSignatureData } from './VanSignaturePadModal';
import { roundMoney } from '../utils/van-money.utils';

export type VanPaymentMethod = 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';

export interface VanSaleCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  cartTotal: number;
  cartSubtotal?: number;
  cartDiscount?: number;
  cartItemsCount: number;
  cartTotalPieces: number;
  cart?: Array<{
    productId: number;
    name: string;
    qty: number;
    unitPrice: number;
    unitName?: string;
    isBonus?: boolean;
    bonusReason?: string;
    originalPrice?: number;
  }>;
  customer?: {
    id: number;
    name: string;
    phone?: string;
    balance: number;
    creditLimit?: number;
    customerCode?: string;
    route?: string;
  } | null;
  newCustomerName?: string;
  cartonsCount: string;
  onCartonsCountChange: (count: string) => void;
  deliveryProofPhoto: string;
  onDeliveryProofPhotoChange: (photo: string) => void;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  isSubmitting: boolean;
  // INV-VAN-CHECKOUT-DISCOUNT-PERMISSION: the discount section renders
  // only when the rep's can_give_discount flag is on; absent/false hides
  // it (fail closed, matching the server gate).
  canGiveDiscount?: boolean;
  onConfirmCheckout: (data: {
    paymentMethod: VanPaymentMethod;
    paidAmount?: number;
    cashDiscountAmount?: number;
    notes?: string;
    cartonsCount?: number;
    deliveryProofPhoto?: string;
    supervisorOverridePin?: string;
    supervisorOverrideReason?: string;
    transferReference?: string;
    transferReceiptUrl?: string;
    recipientName?: string;
    recipientPhone?: string;
    recipientRole?: string;
    recipientSignature?: string;
    autoShareWhatsApp?: boolean;
  }) => void;
}

function calculateHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseCustomerCoords(c: any): { lat: number; lng: number } | null {
  if (!c) return null;
  if (c.lat && c.lng && Number.isFinite(Number(c.lat))) {
    return { lat: Number(c.lat), lng: Number(c.lng) };
  }
  let meta: any = c.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch {}
  }
  if (meta) {
    const lat = Number(meta.gps_lat ?? meta.lat ?? meta.latitude);
    const lng = Number(meta.gps_lng ?? meta.lng ?? meta.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001)) {
      return { lat, lng };
    }
  }
  const url = String(c.locationUrl || meta?.location_url || meta?.locationUrl || meta?.google_maps_url || '').trim();
  if (url) {
    const atMatch = url.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (atMatch) return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };
    const qMatch = url.match(/(?:[?&](?:q|query|ll|center|daddr)=)(-?\d+(?:\.\d+)?)\s*(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
    if (qMatch) return { lat: Number(qMatch[1]), lng: Number(qMatch[2]) };
    const bangMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (bangMatch) return { lat: Number(bangMatch[1]), lng: Number(bangMatch[2]) };
  }
  return null;
}

export const VanSaleCheckoutModal: React.FC<VanSaleCheckoutModalProps> = ({
  open,
  onClose,
  cartTotal,
  cartSubtotal: _cartSubtotal,
  cartDiscount: _cartDiscount,
  cartItemsCount,
  cartTotalPieces,
  cart,
  customer,
  newCustomerName,
  cartonsCount,
  onCartonsCountChange,
  deliveryProofPhoto,
  onDeliveryProofPhotoChange,
  notes: propNotes = '',
  onNotesChange,
  isSubmitting,
  canGiveDiscount,
  onConfirmCheckout,
}) => {
  const { t } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash'>('cash');
  const [cashInput, setCashInput] = useState<string>(cartTotal.toFixed(2));
  const [cashDiscountAmount, setCashDiscountAmount] = useState<number>(0);
  const [showCashDiscount, setShowCashDiscount] = useState<boolean>(false);
  const [showItemsPreview, setShowItemsPreview] = useState<boolean>(false);
  const [localNotes, setLocalNotes] = useState<string>(propNotes);
  const [validationError, setValidationError] = useState<string>('');
  const [supervisorPin, setSupervisorPin] = useState<string>('');
  const [supervisorReason, setSupervisorReason] = useState<string>('');
  const [showSignaturePad, setShowSignaturePad] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isGeofenceViolation, setIsGeofenceViolation] = useState<boolean>(false);
  const [geofenceDistance, setGeofenceDistance] = useState<number | null>(null);
  const [transferReference, setTransferReference] = useState<string>('');
  const [transferReceiptUrl, setTransferReceiptUrl] = useState<string>('');
  const [walletType, setWalletType] = useState<'instapay' | 'vodafone_cash'>('instapay');
  const [recipientSignatureData, setRecipientSignatureData] = useState<RecipientSignatureData | null>(null);
  const [showSignatureModal, setShowSignatureModal] = useState<boolean>(false);
  const [autoShareWhatsApp, setAutoShareWhatsApp] = useState<boolean>(
    Boolean(customer?.phone || (customer as any)?.metadata?.phone || (customer as any)?.metadata?.whatsapp)
  );

  useEffect(() => {
    if (open) {
      setCashInput(cartTotal.toFixed(2));
      setCashDiscountAmount(0);
      setShowCashDiscount(false);
      setShowItemsPreview(false);
      setPaymentMethod('cash');
      setValidationError('');
      setLocalNotes(propNotes);
      setSupervisorPin('');
      setSupervisorReason('');
      setShowSignaturePad(false);
      setIsDrawing(false);
      setIsGeofenceViolation(false);
      setGeofenceDistance(null);
      setTransferReference('');
      setTransferReceiptUrl('');
      setWalletType('instapay');
      setRecipientSignatureData(null);
      setShowSignatureModal(false);

      const custCoords = parseCustomerCoords(customer);
      if (custCoords && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const dLat = pos.coords.latitude;
            const dLng = pos.coords.longitude;
            const dist = calculateHaversineDistanceMeters(dLat, dLng, custCoords.lat, custCoords.lng);
            setGeofenceDistance(Math.round(dist));
            if (dist > 200) {
              setIsGeofenceViolation(true);
            }
          },
          () => {},
          { timeout: 3500, enableHighAccuracy: true },
        );
      }
    }
  }, [open, cartTotal, propNotes, customer]);

  const handleStartDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.beginPath();
    ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    setIsDrawing(true);
  };

  const handleDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    ctx.stroke();
  };

  const handleEndDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      onDeliveryProofPhotoChange(dataUrl);
    } catch {}
  };

  const clearCanvasSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onDeliveryProofPhotoChange('');
  };

  const hasCustomer = Boolean(customer?.id || (newCustomerName && newCustomerName.trim()));
  const customerDisplayName = customer?.name || newCustomerName || 'عميل نقدي عام';

  const cashPaid = useMemo(() => {
    const val = parseFloat(cashInput);
    return isNaN(val) || val < 0 ? 0 : val;
  }, [cashInput]);

  const netCashDue = useMemo(() => {
    return Math.max(0, roundMoney(cartTotal - cashDiscountAmount));
  }, [cartTotal, cashDiscountAmount]);

  const changeDue = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    return Math.max(0, roundMoney(cashPaid - netCashDue));
  }, [paymentMethod, cashPaid, netCashDue]);

  const splitCreditDebt = useMemo(() => {
    if (paymentMethod === 'credit') return cartTotal;
    if (paymentMethod === 'cash' && cashPaid < netCashDue) {
      return Math.max(0, roundMoney(netCashDue - cashPaid));
    }
    return 0;
  }, [paymentMethod, cashPaid, netCashDue, cartTotal]);

  const isActuallySplit = useMemo(() => {
    return paymentMethod === 'cash' && cashPaid > 0 && cashPaid < netCashDue;
  }, [paymentMethod, cashPaid, netCashDue]);

  const customerBalanceAfter = useMemo(() => {
    const curBal = Number(customer?.balance || 0);
    if (paymentMethod === 'credit') {
      return curBal + cartTotal;
    }
    if (paymentMethod === 'cash' && cashPaid < netCashDue) {
      return curBal + splitCreditDebt;
    }
    return curBal;
  }, [customer?.balance, paymentMethod, cartTotal, cashPaid, netCashDue, splitCreditDebt]);

  const isCreditOrSplitDebt = useMemo(() => {
    return paymentMethod === 'credit' || isActuallySplit;
  }, [paymentMethod, isActuallySplit]);

  const isCreditExceeded = useMemo(() => {
    if (!isCreditOrSplitDebt) return false;
    if (!customer?.creditLimit || customer.creditLimit <= 0) return false;
    return customerBalanceAfter > customer.creditLimit;
  }, [isCreditOrSplitDebt, customer?.creditLimit, customerBalanceAfter]);

  const isCashOnlyCustomerCredit = useMemo(() => {
    return isCreditOrSplitDebt && Boolean(customer?.id) && (!customer?.creditLimit || Number(customer.creditLimit) <= 0);
  }, [isCreditOrSplitDebt, customer?.id, customer?.creditLimit]);

  const isNewCustomerCredit = useMemo(() => {
    return isCreditOrSplitDebt && !customer?.id && Boolean(newCustomerName && newCustomerName.trim());
  }, [isCreditOrSplitDebt, customer?.id, newCustomerName]);

  const isCardPayment = paymentMethod === 'card';

  const isGeofenceBlocked = useMemo(() => {
    return isGeofenceViolation && isCreditOrSplitDebt;
  }, [isGeofenceViolation, isCreditOrSplitDebt]);

  const hasBonusItems = useMemo(() => {
    return Boolean(cart && cart.some((c) => c.isBonus));
  }, [cart]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onDeliveryProofPhotoChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    if (isSubmitting) return;
    setValidationError('');

    const finalMethod: VanPaymentMethod = isActuallySplit ? 'split' : paymentMethod;

    if (finalMethod === 'credit' && !hasCustomer) {
      setValidationError('البيع الآجل يتطلب تحديد العميل لتسجيل المديونية على حسابه.');
      return;
    }

    if (finalMethod === 'split' && !hasCustomer) {
      setValidationError('المبلغ المدفوع أقل من إجمالي الفاتورة، ويتطلب ترحيل المتبقي آجل تحديد العميل.');
      return;
    }

    if (paymentMethod === 'cash' && cashPaid <= 0) {
      setValidationError('المبلغ المدفوع 0.00 ج.م. يرجى إدخال المبلغ المستلم، أو اختيار "آجل بالكامل" إن لم يسدد العميل.');
      return;
    }

    if (isGeofenceBlocked && !supervisorPin.trim()) {
      setValidationError(`أنت خارج النطاق الجغرافي لدكان العميل (المسافة: ${geofenceDistance} متر، المسموح 200م). البيع الآجل خارج الموقع يتطلب إدخال الرمز السري للمشرف (PIN).`);
      return;
    }

    if (isCreditExceeded && !supervisorPin.trim()) {
      setValidationError('سقف الائتمان متجاوز. يتطلب إدخال الرمز السري للمشرف (PIN) للمتابعة بالبيع الآجل استثنائياً.');
      return;
    }

    if (isCashOnlyCustomerCredit && !supervisorPin.trim()) {
      setValidationError('هذا العميل مصنف كعميل نقدي (سقف الائتمان = 0.00). البيع الآجل له يتطلب إدخال الرمز السري للمشرف (PIN).');
      return;
    }

    if (isNewCustomerCredit && !supervisorPin.trim()) {
      setValidationError('البيع الآجل لعميل جديد غير مسجل مسبقاً يتطلب إدخال الرمز السري للمشرف (PIN) لمنع المديونيات الوهمية.');
      return;
    }

    if (isCardPayment) {
      if (!supervisorPin.trim()) {
        setValidationError('الدفع بالشبكة أو التحويل البنكي في الميدان يتطلب إدخال الرمز السري للمشرف (PIN) لتأكيد وصول الإشعار.');
        return;
      }
      if (supervisorReason.trim().length < 3) {
        setValidationError('يرجى تدوين رقم مرجع إيصال الشبكة أو الحوالة البنكية (3 أحرف/أرقام على الأقل).');
        return;
      }
    }

    if ((paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') && !transferReference.trim()) {
      setValidationError('يرجى إدخال رقم العملية أو المرجع البنكي للتحقق من وصول التحويل الإلكتروني.');
      return;
    }

    if (hasBonusItems && !supervisorPin.trim()) {
      setValidationError('الفاتورة تحتوي على أصناف بونص عيني مجاني. يتطلب إدخال الرمز السري للمشرف (PIN) لتوثيق المصادقة الرقابية.');
      return;
    }

    const resolvedMethod = (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash')
      ? paymentMethod
      : finalMethod;

    onConfirmCheckout({
      paymentMethod: resolvedMethod,
      paidAmount: (resolvedMethod === 'instapay' || resolvedMethod === 'vodafone_cash')
        ? cartTotal
        : (finalMethod === 'cash'
          ? netCashDue
          : (finalMethod === 'split' ? cashPaid : (finalMethod === 'card' ? cartTotal : 0))),
      cashDiscountAmount: paymentMethod === 'cash' && cashDiscountAmount > 0 ? cashDiscountAmount : undefined,
      notes: localNotes,
      cartonsCount: Number(cartonsCount) || undefined,
      deliveryProofPhoto: deliveryProofPhoto || undefined,
      supervisorOverridePin: supervisorPin.trim() ? supervisorPin.trim() : undefined,
      supervisorOverrideReason: supervisorReason.trim()
        ? supervisorReason.trim()
        : isNewCustomerCredit
        ? 'اعتماد بيع آجل لعميل جديد'
        : isCashOnlyCustomerCredit
        ? 'اعتماد بيع آجل لعميل نقدي'
        : (hasBonusItems ? 'اعتماد صرف بونص عيني مجاني' : undefined),
      transferReference: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? transferReference.trim() : undefined,
      transferReceiptUrl: transferReceiptUrl.trim() || undefined,
      recipientName: recipientSignatureData?.recipientName || undefined,
      recipientPhone: recipientSignatureData?.recipientPhone || undefined,
      recipientRole: recipientSignatureData?.recipientRole || undefined,
      recipientSignature: recipientSignatureData?.recipientSignature || undefined,
      autoShareWhatsApp,
    });
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('delivery_reps.van_sale_checkout_modal.s0', "إتمام الفاتورة والسداد الميداني")}
      subtitle={t('delivery_reps.van_sale_checkout_modal.s1', "تأكيد طريقة الدفع وإصدار الفاتورة فورياً")}
      badge={t('delivery_reps.van_sale_checkout_modal.s2', "نقطة توزيع الفان")}
      compact={true}
      width="min(500px, 95vw)"
      bodyStyle={{ padding: '10px 14px' }}
      footer={
        <div
          dir="rtl"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            gap: '10px',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              height: '40px',
              fontSize: '12.5px',
              fontWeight: 700,
              padding: '0 16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              whiteSpace: 'nowrap',
              borderRadius: '8px',
            }}
          >
            <SlidersIcon size={15} color="#475569" />
            <span>{t('delivery_reps.van_sale_checkout_modal.s3', "تعديل السلة")}</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={isSubmitting}
            style={{
              flex: 1,
              height: '42px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: '13.5px',
              fontWeight: 800,
              padding: '0 18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(23, 14, 94, 0.25)',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            <CheckCircleIcon size={16} color="#ffffff" />
            <span>{isSubmitting ? t('delivery_reps.van_sale_checkout_modal.s4', "جاري الإصدار...") : t('delivery_reps.van_sale_checkout_modal.s5', "تأكيد وإصدار الفاتورة")}</span>
          </Button>
        </div>
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {/* Customer Header Info Strip - Breathable & Balanced */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '9px',
            padding: '9px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s6', "العميل:")}</span>
              <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>
                {customerDisplayName}
              </strong>
              {customer?.customerCode && (
                <span style={{ fontSize: '10px', backgroundColor: '#e2e8f0', color: '#334155', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                  [{customer.customerCode.replace(/^#/, '')}]
                </span>
              )}
            </div>
            {customer && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px', fontSize: '11px', color: '#475569' }}>
                <span>
                  {t('delivery_reps.van_sale_checkout_modal.s7', "المديونية:")} <strong style={{ color: customer.balance > 0 ? '#b91c1c' : '#15803d' }}>{customer.balance.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s8', "ج.م")}</strong>
                </span>
                {customer.creditLimit ? (
                  <span>{t('delivery_reps.van_sale_checkout_modal.s9', "سقف الائتمان:")} <strong>{customer.creditLimit.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s10', "ج.م")}</strong></span>
                ) : null}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'left' }}>
            <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.van_sale_checkout_modal.s11', "المطلوب سداده")}</span>
            <span style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>
              {cartTotal.toFixed(2)} <CurrencySymbol />
            </span>
          </div>
        </div>

        {/* Compact Collapsible Items Preview */}
        {cart && cart.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setShowItemsPreview((prev) => !prev)}
              style={{
                width: '100%',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#334155',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <PackageIcon size={14} color="#170e5e" />
                <span>
                  {t('delivery_reps.van_sale_checkout_modal.s12', "معاينة الفاتورة:")} <strong>{cartItemsCount} {t('delivery_reps.van_sale_checkout_modal.s13', "أصناف")}</strong> ({cartTotalPieces} {t('delivery_reps.van_sale_checkout_modal.s14', "قطعة)")}
                </span>
              </span>
              <span style={{ color: '#170e5e', fontSize: '11px', fontWeight: 800 }}>
                {showItemsPreview ? t('delivery_reps.van_sale_checkout_modal.s15', "إخفاء ▲") : t('delivery_reps.van_sale_checkout_modal.s16', "عرض الأصناف ▼")}
              </span>
            </button>

            {showItemsPreview && (
              <div style={{ maxHeight: '110px', overflowY: 'auto', borderTop: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'right' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s17', "الصنف")}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sale_checkout_modal.s18', "الكمية")}</th>
                      <th style={{ padding: '4px 6px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_sale_checkout_modal.s19', "السعر")}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 700, textAlign: 'left' }}>{t('delivery_reps.van_sale_checkout_modal.s20', "الإجمالي")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item, idx) => (
                      <tr
                        key={`${item.productId}-${idx}`}
                        style={{
                          borderBottom: idx === cart.length - 1 ? 'none' : '1px solid #f1f5f9',
                          backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff',
                        }}
                      >
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{ fontWeight: 800, color: '#0f172a' }}>{item.name}</span>
                          {item.isBonus && (
                            <span
                              style={{
                                marginRight: '4px',
                                fontSize: '9px',
                                backgroundColor: '#dcfce7',
                                color: '#15803d',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                fontWeight: 800,
                              }}
                            >
                              {t('delivery_reps.van_sale_checkout_modal.s21', "هدية")}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 800, color: '#170e5e' }}>
                          {item.qty} {item.unitName || t('delivery_reps.van_sale_checkout_modal.s22', "قطعة")}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'center', color: '#334155' }}>
                          {item.unitPrice.toFixed(2)}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 900, color: '#0f172a' }}>
                          {(item.qty * item.unitPrice).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Validation Error Banner */}
        {validationError && (
          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangleIcon size={14} color="#dc2626" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Payment Method Selector: 3 Main Tabs (نقدي - إنستاباي - آجل) */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', width: '100%' }}>
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('cash');
                setCashInput(cartTotal.toFixed(2));
                setValidationError('');
              }}
              style={{
                flex: '1 1 0%',
                minWidth: 0,
                height: '40px',
                borderRadius: '8px',
                border: paymentMethod === 'cash' ? '2px solid #059669' : '1px solid #cbd5e1',
                backgroundColor: paymentMethod === 'cash' ? '#ecfdf5' : '#ffffff',
                color: paymentMethod === 'cash' ? '#065f46' : '#334155',
                fontWeight: 800,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: paymentMethod === 'cash' ? '0 1px 3px rgba(5, 150, 105, 0.15)' : 'none',
              }}
            >
              <span>{t('delivery_reps.van_sale_checkout_modal.s23', "نقدي (كاش)")}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPaymentMethod(walletType);
                setValidationError('');
              }}
              style={{
                flex: '1 1 0%',
                minWidth: 0,
                height: '40px',
                borderRadius: '8px',
                border: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                backgroundColor: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#f5f3ff' : '#ffffff',
                color: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#6d28d9' : '#334155',
                fontWeight: 800,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                boxShadow: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '0 1px 3px rgba(124, 58, 237, 0.15)' : 'none',
              }}
            >
              <SmartphoneIcon size={13} color={(paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#6d28d9' : '#64748b'} />
              <span>{t('delivery_reps.van_sale_checkout_modal.s24', "إنستاباي / محفظة")}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPaymentMethod('credit');
                setValidationError('');
              }}
              style={{
                flex: '1 1 0%',
                minWidth: 0,
                height: '40px',
                borderRadius: '8px',
                border: paymentMethod === 'credit' ? '2px solid #d97706' : '1px solid #cbd5e1',
                backgroundColor: paymentMethod === 'credit' ? '#fffbeb' : '#ffffff',
                color: paymentMethod === 'credit' ? '#92400e' : '#334155',
                fontWeight: 800,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: paymentMethod === 'credit' ? '0 1px 3px rgba(217, 119, 6, 0.15)' : 'none',
              }}
            >
              <span>{t('delivery_reps.van_sale_checkout_modal.s25', "آجل (بالكامل)")}</span>
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '3px' }}>
            {paymentMethod === 'card' ? (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('cash');
                  setCashInput(cartTotal.toFixed(2));
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s26', "إلغاء الشبكة والعودة للنقدي")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('card');
                  setValidationError('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s27', "سداد عبر بطاقة بنكية / شبكة POS")}
              </button>
            )}
          </div>
        </div>

        {/* InstaPay / Mobile Wallet Details Card */}
        {(paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') && (
          <div
            style={{
              backgroundColor: '#f5f3ff',
              border: '1px solid #ddd6fe',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <SmartphoneIcon size={14} color="#7c3aed" />
                <span>{t('delivery_reps.van_sale_checkout_modal.s28', "تحويل إلكتروني مباشر لحساب الشركة:")}</span>
              </span>
              <span style={{ fontSize: '14px', fontWeight: 900, color: '#5b21b6' }}>
                {cartTotal.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s29', "ج.م")}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('instapay');
                  setWalletType('instapay');
                }}
                style={{
                  height: '32px',
                  borderRadius: '6px',
                  border: paymentMethod === 'instapay' ? '2px solid #7c3aed' : '1px solid #c4b5fd',
                  backgroundColor: paymentMethod === 'instapay' ? '#ffffff' : '#f5f3ff',
                  color: paymentMethod === 'instapay' ? '#6d28d9' : '#6b21a8',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s30', "إنستاباي (InstaPay)")}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('vodafone_cash');
                  setWalletType('vodafone_cash');
                }}
                style={{
                  height: '32px',
                  borderRadius: '6px',
                  border: paymentMethod === 'vodafone_cash' ? '2px solid #e11d48' : '1px solid #c4b5fd',
                  backgroundColor: paymentMethod === 'vodafone_cash' ? '#ffffff' : '#f5f3ff',
                  color: paymentMethod === 'vodafone_cash' ? '#be123c' : '#6b21a8',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {t('delivery_reps.van_sale_checkout_modal.s31', "فودافون كاش / محفظة")}
              </button>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#4c1d95', display: 'block', marginBottom: '2px' }}>
                {t('delivery_reps.van_sale_checkout_modal.s32', "رقم العملية / المرجع البنكي (Reference No) *")}
              </label>
              <input
                type="text"
                value={transferReference}
                onChange={(e) => {
                  setTransferReference(e.target.value);
                  setValidationError('');
                }}
                placeholder={t('delivery_reps.van_sale_checkout_modal.s33', "رقم مرجع التحويل أو آخر 6 أرقام من الإشعار")}
                style={{
                  width: '100%',
                  height: '32px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: '1px solid #c4b5fd',
                  fontSize: '12px',
                  backgroundColor: '#ffffff',
                  boxSizing: 'border-box',
                  direction: 'ltr',
                  textAlign: 'right',
                }}
              />
            </div>

            <div
              style={{
                fontSize: '10.5px',
                color: '#5b21b6',
                backgroundColor: '#ede9fe',
                padding: '4px 8px',
                borderRadius: '5px',
                fontWeight: 600,
              }}
            >
              {t('delivery_reps.van_sale_checkout_modal.s34', "فصل مالي تلقائي: المبلغ محول مباشرة لحساب الشركة/المحفظة، ولا يُطالب به المندوب ككاش في تصفية اليوم.")}
            </div>
          </div>
        )}

        {/* Dynamic Payment Body Section */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* 1. CASH / SMART SPLIT PAYMENT MODE */}
          {paymentMethod === 'cash' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#334155', whiteSpace: 'nowrap' }}>
                  {t('delivery_reps.van_sale_checkout_modal.s35', "المستلم كاش:")}
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '38px',
                    borderRadius: '7px',
                    border: '1px solid #cbd5e1',
                    fontSize: '16px',
                    fontWeight: 800,
                    textAlign: 'center',
                    backgroundColor: '#f8fafc',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setCashInput(netCashDue.toFixed(2))}
                  style={{
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '7px',
                    border: '1px solid #a7f3d0',
                    backgroundColor: '#ecfdf5',
                    color: '#065f46',
                    fontSize: '12px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('delivery_reps.van_sale_checkout_modal.s36', "المبلغ بالضبط")}
                </button>
              </div>

              {/* Automatic Split Badge if partial cash paid */}
              {isActuallySplit && (
                <div
                  style={{
                    backgroundColor: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '11.5px',
                    color: '#5b21b6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{t('delivery_reps.van_sale_checkout_modal.s37', "سداد جزئي (المتبقي آجل على الحساب):")}</span>
                  <strong style={{ color: '#b91c1c', fontSize: '12.5px' }}>
                    {splitCreditDebt.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s38', "ج.م")}
                  </strong>
                </div>
              )}

              {/* Automatic Change Badge if cash paid is greater than total */}
              {changeDue > 0 && (
                <div
                  style={{
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '11.5px',
                    color: '#1d4ed8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{t('delivery_reps.van_sale_checkout_modal.s39', "الباقي للعميل:")}</span>
                  <strong style={{ color: '#1d4ed8', fontSize: '12.5px' }}>
                    {changeDue.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s40', "ج.م")}
                  </strong>
                </div>
              )}

              {/* Optional Cash Discount Toggle */}
              {/* INV-VAN-CHECKOUT-DISCOUNT-PERMISSION: hidden unless the rep may give discounts */}
              {canGiveDiscount === true && (
              <div>
                {!showCashDiscount && cashDiscountAmount === 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowCashDiscount(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {t('delivery_reps.van_sale_checkout_modal.s41', "+ إضافة خصم تسوية نقدي (اختياري)")}
                  </button>
                ) : (
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '5px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>{t('delivery_reps.van_sale_checkout_modal.s42', "خصم نقدي:")}</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={cartTotal}
                      value={cashDiscountAmount || ''}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(cartTotal, Number(e.target.value) || 0));
                        setCashDiscountAmount(val);
                        setCashInput((Math.max(0, cartTotal - val)).toFixed(2));
                      }}
                      placeholder="0.00"
                      style={{
                        width: '70px',
                        height: '26px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: '11px',
                        fontWeight: 700,
                        textAlign: 'center',
                        backgroundColor: '#ffffff',
                      }}
                    />
                    {[0.02, 0.05].map((pct) => {
                      const discountVal = roundMoney(cartTotal * pct);
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            setCashDiscountAmount(discountVal);
                            setCashInput((Math.max(0, cartTotal - discountVal)).toFixed(2));
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: Math.abs(cashDiscountAmount - discountVal) < 0.01 ? '#ecfdf5' : '#ffffff',
                            color: Math.abs(cashDiscountAmount - discountVal) < 0.01 ? '#065f46' : '#475569',
                            fontSize: '10px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {pct * 100}% ({discountVal} {t('delivery_reps.van_sale_checkout_modal.s43', "ج)")}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setCashDiscountAmount(0);
                        setShowCashDiscount(false);
                        setCashInput(cartTotal.toFixed(2));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        marginRight: 'auto',
                      }}
                    >
                      {t('delivery_reps.van_sale_checkout_modal.s44', "إلغاء")}
                    </button>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          {/* 2. FULL CREDIT PAYMENT MODE */}
          {paymentMethod === 'credit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {!hasCustomer ? (
                <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 10px', fontSize: '11.5px', color: '#92400e' }}>
                  <strong>{t('delivery_reps.van_sale_checkout_modal.s45', "تنبيه:")}</strong> {t('delivery_reps.van_sale_checkout_modal.s46', "لم يتم تحديد عميل. البيع الآجل يتطلب تحديد العميل لتسجيل المديونية.")}
                </div>
              ) : (
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#166534' }}>{t('delivery_reps.van_sale_checkout_modal.s47', "المديونية السابقة:")}</span>
                    <strong>{(customer?.balance || 0).toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s48', "ج.م")}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #86efac', paddingTop: '3px' }}>
                    <span style={{ color: '#166534', fontWeight: 800 }}>{t('delivery_reps.van_sale_checkout_modal.s49', "الرصيد بعد إضافة الفاتورة:")}</span>
                    <strong style={{ color: '#b91c1c', fontSize: '12.5px' }}>{customerBalanceAfter.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s50', "ج.م")}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. CARD PAYMENT MODE */}
          {paymentMethod === 'card' && (
            <div style={{ padding: '8px 10px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px dashed #bae6fd', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCardIcon size={20} color="#0284c7" />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0369a1' }}>
                  {t('delivery_reps.van_sale_checkout_modal.s51', "الدفع عبر البطاقة البنكية / ماكينة الدفع")}
                </div>
                <div style={{ fontSize: '10.5px', color: '#0284c7' }}>
                  {t('delivery_reps.van_sale_checkout_modal.s52', "تسجيل الفاتورة كدفع إلكتروني بقيمة")} {cartTotal.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s53', "ج.م")}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Supervisor PIN Alert Box if Authorization Needed */}
        {(isCreditExceeded || isCashOnlyCustomerCredit || isNewCustomerCredit || isCardPayment || hasBonusItems || isGeofenceBlocked) && (
          <div
            style={{
              backgroundColor: '#fff7ed',
              border: '1px solid #fdba74',
              borderRadius: '7px',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#c2410c', fontWeight: 800, fontSize: '11.5px' }}>
              <AlertTriangleIcon size={14} color="#ea580c" />
              <span>
                {isGeofenceBlocked
                  ? `قفل جغرافي: موقعك يبعد (${geofenceDistance}م) عن دكان العميل`
                  : isCreditExceeded
                  ? `تنبيه: رصيد العميل بعد الفاتورة سيتجاوز الحد المسموح`
                  : isCashOnlyCustomerCredit
                  ? `اعتماد المشرف مطلوب: العميل مصنف نقدي فقط`
                  : isNewCustomerCredit
                  ? `اعتماد المشرف مطلوب: بيع آجل لعميل جديد ("${newCustomerName}")`
                  : isCardPayment
                  ? t('delivery_reps.van_sale_checkout_modal.s54', "اعتماد المشرف ورقم إيصال الشبكة مطلوبان")
                  : t('delivery_reps.van_sale_checkout_modal.s55', "اعتماد المشرف مطلوب لصرف البونص العيني")}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px' }}>
              <input
                type="password"
                maxLength={6}
                value={supervisorPin}
                onChange={(e) => setSupervisorPin(e.target.value)}
                placeholder={t('delivery_reps.van_sale_checkout_modal.s56', "PIN المشرف")}
                style={{
                  height: '32px',
                  borderRadius: '5px',
                  border: '1px solid #f97316',
                  fontSize: '12px',
                  fontWeight: 800,
                  textAlign: 'center',
                  backgroundColor: '#ffffff',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="text"
                value={supervisorReason}
                onChange={(e) => setSupervisorReason(e.target.value)}
                placeholder={isCardPayment ? t('delivery_reps.van_sale_checkout_modal.s57', "رقم إيصال الشبكة") : t('delivery_reps.van_sale_checkout_modal.s58', "سبب الاعتماد")}
                style={{
                  height: '32px',
                  borderRadius: '5px',
                  border: '1px solid #fed7aa',
                  fontSize: '11.5px',
                  padding: '0 8px',
                  backgroundColor: '#ffffff',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Operational Card: Cartons, Proof Photo, Signature, Notes */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Row 1: Cartons on Right, Photo & Signature on Left */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <PackageIcon size={14} color="#170e5e" />
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>{t('delivery_reps.van_sale_checkout_modal.s59', "عدد الطرود:")}</span>
              <input
                type="number"
                min="0"
                value={cartonsCount}
                onChange={(e) => onCartonsCountChange(e.target.value)}
                placeholder="0"
                style={{
                  width: '46px',
                  height: '30px',
                  borderRadius: '5px',
                  border: '1px solid #cbd5e1',
                  textAlign: 'center',
                  fontSize: '12px',
                  fontWeight: 800,
                  backgroundColor: '#ffffff',
                }}
              />
            </div>

            {/* Proof Photo & Touch Signature Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {deliveryProofPhoto ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <img
                    src={deliveryProofPhoto}
                    alt="Proof"
                    style={{ width: '28px', height: '22px', borderRadius: '4px', objectFit: 'contain', border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
                  />
                  <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s60', "تم التوثيق")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onDeliveryProofPhotoChange('');
                      clearCanvasSignature();
                    }}
                    style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                  >
                    {t('delivery_reps.van_sale_checkout_modal.s61', "حذف")}
                  </button>
                </div>
              ) : (
                <label
                  style={{
                    height: '30px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '5px',
                    padding: '0 9px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <CameraIcon size={12} color="#170e5e" />
                  <span>{t('delivery_reps.van_sale_checkout_modal.s62', "+ صورة")}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              )}

              {recipientSignatureData ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '5px',
                    padding: '2px 6px',
                  }}
                >
                  <CheckCircleIcon size={12} color="#15803d" />
                  <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#15803d' }}>
                    {t('delivery_reps.van_sale_checkout_modal.s63', "مستلم:")} {recipientSignatureData.recipientName} ({recipientSignatureData.recipientRole})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSignatureModal(true)}
                    style={{ color: '#15803d', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                  >
                    {t('delivery_reps.van_sale_checkout_modal.s64', "تعديل")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSignatureModal(true)}
                  style={{
                    height: '30px',
                    backgroundColor: isCreditOrSplitDebt ? '#fffbeb' : '#ffffff',
                    border: isCreditOrSplitDebt ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                    borderRadius: '5px',
                    padding: '0 8px',
                    fontSize: '11px',
                    fontWeight: 800,
                    color: isCreditOrSplitDebt ? '#92400e' : '#170e5e',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <EditIcon size={12} color={isCreditOrSplitDebt ? '#92400e' : '#170e5e'} />
                  <span>{t('delivery_reps.van_sale_checkout_modal.s65', "+ هوية وتوقيع المستلم")}</span>
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Full Width Notes Input */}
          <input
            type="text"
            value={localNotes}
            onChange={(e) => {
              setLocalNotes(e.target.value);
              onNotesChange?.(e.target.value);
            }}
            placeholder={t('delivery_reps.van_sale_checkout_modal.s66', "ملاحظات على الفاتورة أو التسليم (اختياري)...")}
            style={{
              width: '100%',
              height: '30px',
              padding: '0 9px',
              borderRadius: '5px',
              border: '1px solid #cbd5e1',
              fontSize: '11.5px',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          />

          {/* Quick WhatsApp Share Switch */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              fontWeight: 700,
              color: autoShareWhatsApp ? '#15803d' : '#64748b',
              backgroundColor: autoShareWhatsApp ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${autoShareWhatsApp ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer',
              userSelect: 'none',
              boxSizing: 'border-box',
              transition: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={autoShareWhatsApp}
              onChange={(e) => setAutoShareWhatsApp(e.target.checked)}
              style={{ width: '15px', height: '15px', accentColor: '#16a34a', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <SendIcon size={13} color={autoShareWhatsApp ? '#16a34a' : '#64748b'} />
              <span>{t('delivery_reps.van_sale_checkout_modal.s67', "مشاركة الفاتورة مع العميل عبر واتساب فور الإصدار")}</span>
            </div>
          </label>

          {/* Interactive Signature Pad if opened */}
          {showSignaturePad && !deliveryProofPhoto && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '6px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_sale_checkout_modal.s68', "توقيع العميل / المستلم على الشاشة:")}
                </span>
                <button
                  type="button"
                  onClick={clearCanvasSignature}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('delivery_reps.van_sale_checkout_modal.s69', "مسح")}
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={400}
                height={70}
                onPointerDown={handleStartDraw}
                onPointerMove={handleDraw}
                onPointerUp={handleEndDraw}
                style={{
                  width: '100%',
                  height: '70px',
                  backgroundColor: '#f8fafc',
                  border: '1px dashed #94a3b8',
                  borderRadius: '4px',
                  touchAction: 'none',
                  cursor: 'crosshair',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {showSignatureModal && (
        <VanSignaturePadModal
          open={showSignatureModal}
          onClose={() => setShowSignatureModal(false)}
          customerName={customerDisplayName}
          totalAmount={cartTotal}
          initialData={recipientSignatureData || undefined}
          onConfirm={(sigData) => {
            setRecipientSignatureData(sigData);
            onDeliveryProofPhotoChange(sigData.recipientSignature);
            setShowSignatureModal(false);
          }}
        />
      )}
    </StandardDialog>
  );
};
