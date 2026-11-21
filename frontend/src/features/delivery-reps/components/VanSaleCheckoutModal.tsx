import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import { VanSignaturePadModal, RecipientSignatureData } from './VanSignaturePadModal';
import { VanCheckoutCustomerHeader } from './van-sale-checkout/VanCheckoutCustomerHeader';
import { VanCheckoutItemsPreview } from './van-sale-checkout/VanCheckoutItemsPreview';
import { VanCheckoutValidationBanner } from './van-sale-checkout/VanCheckoutValidationBanner';
import { VanCheckoutPaymentSelector } from './van-sale-checkout/VanCheckoutPaymentSelector';
import { VanCheckoutWalletCard } from './van-sale-checkout/VanCheckoutWalletCard';
import { VanCheckoutPaymentBody } from './van-sale-checkout/VanCheckoutPaymentBody';
import { VanCheckoutPinAlert } from './van-sale-checkout/VanCheckoutPinAlert';
import { VanCheckoutOperationalCard } from './van-sale-checkout/VanCheckoutOperationalCard';
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
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the invoice discount is
  // a per-rep permission (can_give_invoice_discount, set at rep
  // creation) — a per-line-only rep never sees this section — and
  // the tenant cap % (default 5): the section hides at cap 0 and
  // the quick chips never offer a % above the cap.
  canGiveInvoiceDiscount?: boolean;
  discountCapPercent?: number;
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
  canGiveInvoiceDiscount,
  discountCapPercent,
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
  // INV-VAN-WHATSAPP-SHARE-OPT-IN: opt-in only — the receipt is shared
  // only when the rep ticks the box for this sale. It used to default ON
  // whenever the customer had a phone, opening an unprompted WhatsApp
  // tab per issued invoice.
  const [autoShareWhatsApp, setAutoShareWhatsApp] = useState<boolean>(false);

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
      // INV-VAN-WHATSAPP-SHARE-OPT-IN: the modal stays mounted across
      // opens, so the opt-in must be reset per sale — otherwise a rep
      // who ticks it once keeps auto-sharing for every later sale.
      setAutoShareWhatsApp(false);

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
        <VanCheckoutCustomerHeader
          t={t}
          customerDisplayName={customerDisplayName}
          customer={customer}
          cartTotal={cartTotal}
          />

        <VanCheckoutItemsPreview
          cart={cart}
          setShowItemsPreview={setShowItemsPreview}
          t={t}
          cartItemsCount={cartItemsCount}
          cartTotalPieces={cartTotalPieces}
          showItemsPreview={showItemsPreview}
          />

        <VanCheckoutValidationBanner
          validationError={validationError}
          />

        <VanCheckoutPaymentSelector
          setPaymentMethod={setPaymentMethod}
          setCashInput={setCashInput}
          cartTotal={cartTotal}
          setValidationError={setValidationError}
          paymentMethod={paymentMethod}
          t={t}
          walletType={walletType}
          />

        <VanCheckoutWalletCard
          paymentMethod={paymentMethod}
          t={t}
          cartTotal={cartTotal}
          setPaymentMethod={setPaymentMethod}
          setWalletType={setWalletType}
          transferReference={transferReference}
          setTransferReference={setTransferReference}
          setValidationError={setValidationError}
          />

        <VanCheckoutPaymentBody
          paymentMethod={paymentMethod}
          t={t}
          cashInput={cashInput}
          setCashInput={setCashInput}
          netCashDue={netCashDue}
          isActuallySplit={isActuallySplit}
          splitCreditDebt={splitCreditDebt}
          changeDue={changeDue}
          canGiveDiscount={canGiveDiscount}
          canGiveInvoiceDiscount={canGiveInvoiceDiscount}
          discountCapPercent={discountCapPercent}
          showCashDiscount={showCashDiscount}
          cashDiscountAmount={cashDiscountAmount}
          setShowCashDiscount={setShowCashDiscount}
          cartTotal={cartTotal}
          setCashDiscountAmount={setCashDiscountAmount}
          hasCustomer={hasCustomer}
          customer={customer}
          customerBalanceAfter={customerBalanceAfter}
          />

        <VanCheckoutPinAlert
          isCreditExceeded={isCreditExceeded}
          isCashOnlyCustomerCredit={isCashOnlyCustomerCredit}
          isNewCustomerCredit={isNewCustomerCredit}
          isCardPayment={isCardPayment}
          hasBonusItems={hasBonusItems}
          isGeofenceBlocked={isGeofenceBlocked}
          geofenceDistance={geofenceDistance}
          newCustomerName={newCustomerName}
          t={t}
          supervisorPin={supervisorPin}
          setSupervisorPin={setSupervisorPin}
          supervisorReason={supervisorReason}
          setSupervisorReason={setSupervisorReason}
          />

        <VanCheckoutOperationalCard
          t={t}
          cartonsCount={cartonsCount}
          onCartonsCountChange={onCartonsCountChange}
          deliveryProofPhoto={deliveryProofPhoto}
          onDeliveryProofPhotoChange={onDeliveryProofPhotoChange}
          clearCanvasSignature={clearCanvasSignature}
          handlePhotoUpload={handlePhotoUpload}
          recipientSignatureData={recipientSignatureData}
          setShowSignatureModal={setShowSignatureModal}
          isCreditOrSplitDebt={isCreditOrSplitDebt}
          localNotes={localNotes}
          setLocalNotes={setLocalNotes}
          onNotesChange={onNotesChange}
          autoShareWhatsApp={autoShareWhatsApp}
          setAutoShareWhatsApp={setAutoShareWhatsApp}
          showSignaturePad={showSignaturePad}
          canvasRef={canvasRef}
          handleStartDraw={handleStartDraw}
          handleDraw={handleDraw}
          handleEndDraw={handleEndDraw}
          />
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
