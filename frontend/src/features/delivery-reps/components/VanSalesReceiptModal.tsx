import { useTranslation } from 'react-i18next';
import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CheckIcon, PrinterIcon, SendIcon, CopyIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { cleanWhatsAppPhone } from '@/lib/whatsapp';
import {
  VanSaleReceiptData,
  printVanSaleThermalReceipt,
  formatVanSaleShareMessage,
} from '../utils/van-sales-receipt.utils';
import { EscPosPrinterUtil } from '../utils/escpos-printer.util';

interface VanSalesReceiptModalProps {
  receipt: VanSaleReceiptData | null;
  onClose: () => void;
  storeName?: string;
}

export const VanSalesReceiptModal: React.FC<VanSalesReceiptModalProps> = ({
  receipt,
  onClose,
  storeName,
}) => {
  const { t } = useTranslation();
  const [targetPhone, setTargetPhone] = React.useState(receipt?.customerPhone || '');
  const [isBluetoothPrinting, setIsBluetoothPrinting] = React.useState(false);

  React.useEffect(() => {
    if (!receipt) return;
    if (receipt.autoShareWhatsApp && targetPhone.trim()) {
      const timer = setTimeout(() => {
        handleWhatsAppShare();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!receipt) return null;

  const handleBluetoothEscPosPrint = async () => {
    setIsBluetoothPrinting(true);
    try {
      const receiptData = {
        companyName: storeName || 'مبيعات التوزيع',
        invoiceNo: receipt.docNo || '—',
        repName: receipt.repName || 'مندوب التوزيع',
        customerName: receipt.customerName || 'عميل نقدي',
        customerPhone: receipt.customerPhone,
        dateStr: receipt.date ? new Date(receipt.date).toLocaleString('ar-EG') : new Date().toLocaleString('ar-EG'),
        items: (receipt.items || []).map((it: any) => ({
          name: it.name || it.productName || 'صنف',
          qty: Number(it.qty || 1),
          unitPrice: Number(it.unitPrice || 0),
          lineTotal: Number(it.lineTotal || (it.qty * it.unitPrice) || 0),
          unitName: it.unitName,
          isBonus: Boolean(it.isBonus),
        })),
        subtotal: Number(receipt.subtotal || receipt.total || 0),
        discount: Number(receipt.discount || 0),
        total: Number(receipt.total || 0),
        paymentMethod: receipt.paymentMethod || 'cash',
        paidAmount: receipt.paidAmount,
        remainingBalance: receipt.remainingCredit,
      };

      const bytes = EscPosPrinterUtil.generateReceiptBytes(receiptData, '58mm');
      const res = await EscPosPrinterUtil.printViaBluetooth(bytes);
      if (res.ok) {
        toast.success(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر الاتصال بطابعة البلوتوث المحمولة. يمكنك استخدام زر الطباعة العادي.');
    } finally {
      setIsBluetoothPrinting(false);
    }
  };

  const handlePrint = () => {
    try {
      printVanSaleThermalReceipt(receipt, { storeName, widthMm: 80 });
      toast.success('تم تجهيز وإرسال الإيصال الحراري لطابعة الـ 80 مم');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر فتح نافذة الطباعة الحرارية');
    }
  };

  const handleCopyReceiptText = () => {
    try {
      const message = formatVanSaleShareMessage(receipt, { storeName: storeName || receipt.storeName });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(message);
        toast.success('تم نسخ نص الفاتورة بنجاح للحافظة');
      } else {
        const ta = document.createElement('textarea');
        ta.value = message;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast.success('تم نسخ نص الفاتورة بنجاح للحافظة');
      }
    } catch {
      toast.error('تعذر نسخ النص تلقائياً');
    }
  };

  const handleWhatsAppShare = () => {
    const phoneToUse = targetPhone.trim();
    if (!phoneToUse) {
      toast.warning('يرجى إدخال رقم هاتف العميل للمشاركة');
      return;
    }
    const message = formatVanSaleShareMessage(receipt, { storeName: storeName || receipt.storeName });
    const target = cleanWhatsAppPhone(phoneToUse);
    if (!target) {
      toast.warning('رقم هاتف العميل غير صالح لإرسال واتساب');
      return;
    }
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(message)}`, '_blank');
    toast.info('تم فتح تطبيق الواتساب لمشاركة الإيصال');
  };

  return (
    <StandardDialog
      open={true}
      onClose={onClose}
      title={t('delivery_reps.van_sales_receipt_modal.s0', "إيصال الفاتورة الميدانية")}
      subtitle={`رقم الفاتورة: #${receipt.docNo || '—'}`}
      badge={t('delivery_reps.van_sales_receipt_modal.s1', "مبيعات الفان")}
      width="min(500px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={onClose}
          cancelText={t('delivery_reps.van_sales_receipt_modal.s2', "إغلاق")}
          extraActions={
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Button
                variant="secondary"
                onClick={handleWhatsAppShare}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderColor: '#16a34a',
                  color: '#16a34a',
                  backgroundColor: '#f0fdf4',
                  fontSize: '12px',
                  fontWeight: 700,
                  height: '38px',
                }}
              >
                <SendIcon size={14} color="#16a34a" />
                <span>{t('delivery_reps.van_sales_receipt_modal.s3', "مشاركة واتساب")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={handleBluetoothEscPosPrint}
                disabled={isBluetoothPrinting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderColor: '#0284c7',
                  color: '#0369a1',
                  backgroundColor: '#f0f9ff',
                  fontSize: '12px',
                  fontWeight: 700,
                  height: '38px',
                }}
                title={t('delivery_reps.van_sales_receipt_modal.s4', "طباعة مباشرة لطابعة البلوتوث المحمولة على الحزام (ESC/POS)")}
              >
                <PrinterIcon size={14} color="#0369a1" />
                <span>{isBluetoothPrinting ? t('delivery_reps.van_sales_receipt_modal.s5', "جاري الإرسال...") : t('delivery_reps.van_sales_receipt_modal.s6', "بلوتوث ESC/POS (58mm)")}</span>
              </Button>
              <Button
                variant="primary"
                onClick={handlePrint}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  height: '38px',
                }}
              >
                <PrinterIcon size={15} />
                <span>{t('delivery_reps.van_sales_receipt_modal.s7', "طباعة حرارية (80mm)")}</span>
              </Button>
            </div>
          }
        />
      }
    >
      <div dir="rtl" style={{ textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
        {/* Anti-fullscreen-print shield */}
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .standard-dialog-overlay, .standard-dialog-shell { display: none !important; }
          }
        `}</style>

        <div
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '23px',
            backgroundColor: '#dcfce7',
            color: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 10px',
          }}
        >
          <CheckIcon size={24} color="#059669" strokeWidth={2.5} />
        </div>
        <h3 style={{ fontSize: '15.5px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          {t('delivery_reps.van_sales_receipt_modal.s8', "تم إصدار الفاتورة الميدانية بنجاح")}
        </h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 14px' }}>
          {t('delivery_reps.van_sales_receipt_modal.s9', "تم تسجيل الفاتورة بالسجل الميداني وإرسالها للحسابات ويمكن طباعتها فورياً")}
        </p>

        {/* RECEIPT SUMMARY CARD */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            padding: '14px',
            borderRadius: '12px',
            fontSize: '12px',
            textAlign: 'right',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s10', "رقم الفاتورة:")}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#170e5e', fontSize: '13px' }}>
              #{receipt.docNo}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s11', "العميل:")}</span>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>
              {receipt.customerName}
              {receipt.customerCode ? ` [${receipt.customerCode.replace(/^#/, '')}]` : ''}
            </span>
          </div>

          {receipt.customerPhone && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s12', "هاتف العميل:")}</span>
              <span style={{ fontWeight: 700, color: '#0f172a', direction: 'ltr' }}>
                {receipt.customerPhone}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s13', "المندوب / السيارة:")}</span>
            <span style={{ fontWeight: 600, color: '#334155' }}>
              {receipt.repName || t('delivery_reps.van_sales_receipt_modal.s14', "مندوب التوزيع")}
              {receipt.vehiclePlate ? ` (${receipt.vehiclePlate})` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s15', "طريقة الدفع:")}</span>
            <span
              style={{
                fontWeight: 700,
                color: receipt.paymentMethod === 'cash' ? '#166534' : (receipt.paymentMethod === 'card' ? '#0369a1' : (receipt.paymentMethod === 'split' ? '#5b21b6' : '#1e40af')),
                backgroundColor: receipt.paymentMethod === 'cash' ? '#dcfce7' : (receipt.paymentMethod === 'card' ? '#e0f2fe' : (receipt.paymentMethod === 'split' ? '#f5f3ff' : '#dbeafe')),
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '11px',
              }}
            >
              {receipt.paymentMethod === 'cash'
                ? t('delivery_reps.van_sales_receipt_modal.s16', "نقدي (مسلم للمندوب)")
                : receipt.paymentMethod === 'card'
                ? t('delivery_reps.van_sales_receipt_modal.s17', "شبكة / فيزا")
                : receipt.paymentMethod === 'split'
                ? t('delivery_reps.van_sales_receipt_modal.s18', "دفع مركب (نقدي + آجل)")
                : t('delivery_reps.van_sales_receipt_modal.s19', "آجل (على حساب العميل)")}
            </span>
          </div>

          {receipt.paymentMethod === 'split' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#faf5ff',
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px dashed #d8b4fe',
                fontSize: '11.5px',
              }}
            >
              <span>
                {t('delivery_reps.van_sales_receipt_modal.s20', "المسدد نقداً:")} <strong style={{ color: '#059669' }}>{Number(receipt.paidAmount ?? receipt.cashPaid ?? 0).toFixed(2)} <CurrencySymbol /></strong>
              </span>
              <span>
                {t('delivery_reps.van_sales_receipt_modal.s21', "المتبقي آجل:")} <strong style={{ color: '#b91c1c' }}>{Number(receipt.remainingCredit ?? receipt.creditOwed ?? Math.max(0, Number(receipt.total) - Number(receipt.paidAmount ?? receipt.cashPaid ?? 0))).toFixed(2)} <CurrencySymbol /></strong>
              </span>
            </div>
          )}

          {receipt.packagingBreakdown && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#eef2ff',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '11.5px',
                color: '#170e5e',
                fontWeight: 700,
              }}
            >
              <span>{t('delivery_reps.van_sales_receipt_modal.s22', "تفقيط الطرود:")}</span>
              <span>
                {receipt.packagingBreakdown.cartonsCount ? `${receipt.packagingBreakdown.cartonsCount} كرتونة | ` : ''}
                {receipt.packagingBreakdown.piecesCount ? `${receipt.packagingBreakdown.piecesCount} قطعة | ` : ''}
                {receipt.packagingBreakdown.itemsCount || receipt.items?.length || 1} {t('delivery_reps.van_sales_receipt_modal.s23', "بنود")}
              </span>
            </div>
          )}

          {/* ITEM LIST PREVIEW */}
          {receipt.items && receipt.items.length > 0 && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginTop: '2px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                {t('delivery_reps.van_sales_receipt_modal.s24', "بيان الأصناف المباعة (")}{receipt.items.length}):
              </div>
              <div
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  paddingLeft: '2px',
                }}
                className="thin-scrollbar"
              >
                {receipt.items.map((it, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: '#ffffff',
                      border: '1px solid #f1f5f9',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>
                        {it.name}{' '}
                        <span style={{ color: '#64748b', fontSize: '10px' }}>
                          × {it.qty} {it.unitName || ''}
                        </span>
                      </span>
                      {it.consumerPrice != null && Number(it.consumerPrice) > 0 ? (
                        <span style={{ fontSize: '9.5px', color: '#1d4ed8', fontWeight: 600 }}>
                          {t('delivery_reps.van_sales_receipt_modal.s25', "سعر المستهلك:")} {Number(it.consumerPrice).toFixed(2)} <CurrencySymbol />
                          {Number(it.consumerPrice) > Number(it.unitPrice) ? ` (هامش المحل: ${(Number(it.consumerPrice) - Number(it.unitPrice)).toFixed(2)})` : ''}
                        </span>
                      ) : null}
                      {it.unitOfferSavings != null && Number(it.unitOfferSavings) > 0 ? (
                        <span style={{ fontSize: '9.5px', color: '#15803d', fontWeight: 600 }}>
                          {t('delivery_reps.van_sales_receipt_modal.s26', "وفر العرض:")} {Number(it.unitOfferSavings).toFixed(2)} <CurrencySymbol />
                        </span>
                      ) : null}
                    </div>
                    <span style={{ fontWeight: 700, color: '#170e5e' }}>
                      {(it.lineTotal != null ? it.lineTotal : it.qty * it.unitPrice).toFixed(2)}{' '}
                      <CurrencySymbol />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {receipt.deliveryProofPhoto && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '6px',
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_sales_receipt_modal.s27', "صورة إثبات التسليم:")}</span>
              <img
                src={receipt.deliveryProofPhoto}
                alt="Proof"
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '6px',
                  objectFit: 'cover',
                  border: '1px solid #cbd5e1',
                }}
              />
            </div>
          )}

          {receipt.subtotal != null && (receipt.discount ?? 0) > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#64748b',
                fontSize: '11.5px',
                paddingTop: '4px',
              }}
            >
              <span>{t('delivery_reps.van_sales_receipt_modal.s28', "المجموع الفرعي (قبل الخصم):")}</span>
              <span style={{ fontWeight: 700 }}>
                {Number(receipt.subtotal).toFixed(2)} <CurrencySymbol />
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: (receipt.discount ?? 0) > 0 ? '#fef2f2' : '#f8fafc',
              border: `1px solid ${(receipt.discount ?? 0) > 0 ? '#fecaca' : '#e2e8f0'}`,
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              color: (receipt.discount ?? 0) > 0 ? '#b91c1c' : '#475569',
              fontWeight: 700,
            }}
          >
            <span>{t('delivery_reps.van_sales_receipt_modal.s29', "إجمالي الخصومات والعروض:")}</span>
            <span style={{ fontWeight: 800 }}>
              {Number(receipt.discount || 0).toFixed(2)} <CurrencySymbol />
            </span>
          </div>

          {/* INV-VAN-PRICE-LIST-WIRING: the system cash-discount
              portion of the combined discount above, shown as a
              separate "of which" line (rep discount is the
              remainder). Shown only when the setting applied. */}
          {(receipt.systemCashDiscountAmount ?? 0) > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#64748b',
                fontSize: '11.5px',
                paddingTop: '4px',
              }}
            >
              <span>{t('delivery_reps.van_sales_receipt_modal.s37', "منها: خصم الدفع النقدي:")}</span>
              <span style={{ fontWeight: 700 }}>
                {Number(receipt.systemCashDiscountAmount || 0).toFixed(2)} <CurrencySymbol />
              </span>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: '#0f172a',
              fontWeight: 800,
              paddingTop: '8px',
              borderTop: '1.5px solid #cbd5e1',
              fontSize: '14px',
            }}
          >
            <span>{t('delivery_reps.van_sales_receipt_modal.s30', "الإجمالي المستحق:")}</span>
            <span style={{ color: '#166534', fontSize: '15px' }}>
              {Number(receipt.total).toFixed(2)} <CurrencySymbol />
            </span>
          </div>
        </div>

        {/* INSTANT WHATSAPP DIRECT SHARE CARD */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1.5px solid #86efac',
            borderRadius: '12px',
            padding: '12px 14px',
            marginTop: '12px',
            textAlign: 'right',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <SendIcon size={16} color="#15803d" />
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#166534' }}>
                {t('delivery_reps.van_sales_receipt_modal.s31', "مشاركة الفاتورة للعميل عبر واتساب")}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyReceiptText}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#15803d',
                backgroundColor: '#ffffff',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              title={t('delivery_reps.van_sales_receipt_modal.s32', "نسخ نص الفاتورة للحافظة لمشاركتها بأي وسيلة")}
            >
              <CopyIcon size={12} color="#15803d" />
              <span>{t('delivery_reps.van_sales_receipt_modal.s33', "نسخ النص")}</span>
            </button>
          </div>

          <p style={{ fontSize: '11px', color: '#166534', margin: '0 0 10px', lineHeight: 1.4 }}>
            {t('delivery_reps.van_sales_receipt_modal.s34', "أدخل أو راجع رقم هاتف العميل واضغط إرسال لفتح محادثة واتساب بنص منسق يشمل رقم الفاتورة والأصناف والإجمالي:")}
          </p>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="tel"
              inputMode="tel"
              placeholder={t('delivery_reps.van_sales_receipt_modal.s35', "رقم هاتف العميل (مثال: 01012345678)...")}
              value={targetPhone}
              onChange={(e) => setTargetPhone(e.target.value)}
              style={{
                flex: 1,
                height: '38px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid #86efac',
                backgroundColor: '#ffffff',
                fontSize: '13px',
                fontWeight: 700,
                color: '#0f172a',
                direction: 'ltr',
                textAlign: 'right',
                boxSizing: 'border-box',
              }}
            />
            <Button
              type="button"
              variant="primary"
              onClick={handleWhatsAppShare}
              style={{
                height: '38px',
                backgroundColor: '#16a34a',
                borderColor: '#15803d',
                color: '#ffffff',
                fontSize: '12.5px',
                fontWeight: 800,
                padding: '0 14px',
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
              }}
            >
              <SendIcon size={14} color="#ffffff" />
              <span>{t('delivery_reps.van_sales_receipt_modal.s36', "إرسال واتساب")}</span>
            </Button>
          </div>
        </div>
      </div>
    </StandardDialog>
  );
};
