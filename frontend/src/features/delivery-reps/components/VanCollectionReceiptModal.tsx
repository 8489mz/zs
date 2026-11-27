import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CheckIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import {
  VanCollectionReceiptData,
  printVanCollectionThermalReceipt,
  formatVanCollectionShareMessage,
} from '../utils/van-collection-receipt.utils';

interface VanCollectionReceiptModalProps {
  receipt: VanCollectionReceiptData | null;
  onClose: () => void;
  storeName?: string;
}

export const VanCollectionReceiptModal: React.FC<VanCollectionReceiptModalProps> = ({
  receipt,
  onClose,
  storeName,
}) => {
  const { t } = useTranslation();
  const [targetPhone, setTargetPhone] = useState(receipt?.customerPhone || '');

  if (!receipt) return null;

  const handlePrint = () => {
    try {
      printVanCollectionThermalReceipt(receipt, { storeName, widthMm: 80 });
      toast.success('تم إرسال سند القبض لطابعة الإيصالات الحرارية (80 مم)');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر فتح نافذة الطباعة الحرارية');
    }
  };

  const handleWhatsAppShare = () => {
    const phoneToUse = targetPhone.trim();
    if (!phoneToUse) {
      toast.warning('يرجى إدخال رقم هاتف العميل لمشاركة السند');
      return;
    }
    const message = formatVanCollectionShareMessage(receipt);
    const cleanPhone = phoneToUse.replace(/[^0-9]/g, '');
    const target = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(message)}`, '_blank');
    toast.info('تم فتح تطبيق الواتساب لمشاركة سند القبض');
  };

  return (
    <StandardDialog
      open={true}
      onClose={onClose}
      title={t('delivery_reps.van_collection_receipt_modal.s0', "سند قبض نقدي ميداني")}
      subtitle={`رقم السند: #${receipt.receiptNo || '—'}`}
      badge={t('delivery_reps.van_collection_receipt_modal.s1', "تحصيل نقدية")}
      width="min(460px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={onClose}
          cancelText={t('delivery_reps.van_collection_receipt_modal.s2', "إغلاق")}
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
                  fontSize: '12px',
                  fontWeight: 700,
                  height: '38px',
                }}
              >
                <span>{t('delivery_reps.van_collection_receipt_modal.s3', "مشاركة واتساب")}</span>
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
                <span>{t('delivery_reps.van_collection_receipt_modal.s4', "طباعة السند (80mm)")}</span>
              </Button>
            </div>
          }
        />
      }
    >
      <div dir="rtl" style={{ textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .standard-dialog-overlay, .standard-dialog-shell { display: none !important; }
          }
        `}</style>

        {/* Top Check Icon */}
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
          {t('delivery_reps.van_collection_receipt_modal.s5', "تم تسجيل وقيد التحصيل الميداني بنجاح")}
        </h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 14px' }}>
          {t('delivery_reps.van_collection_receipt_modal.s6', "تم ترحيل السند للدفاتر المحاسبية وتحديث رصيد العميل المتبقي فورياً")}
        </p>

        {/* FINANCIAL SUMMARY CARD */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            padding: '14px',
            borderRadius: '12px',
            fontSize: '12px',
            textAlign: 'right',
            marginBottom: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Customer & Document Meta */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              borderBottom: '1px solid #e2e8f0',
              paddingBottom: '10px',
              marginBottom: '10px',
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                {receipt.customerName}
              </div>
              <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                {receipt.customerAddress ? receipt.customerAddress : t('delivery_reps.van_collection_receipt_modal.s7', "عميل معتمد")}
                {receipt.customerCode ? ` • كود: ${receipt.customerCode}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <span
                style={{
                  display: 'inline-block',
                  backgroundColor: '#eef2ff',
                  color: '#170e5e',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  fontSize: '11px',
                  fontFamily: 'monospace',
                }}
              >
                #{receipt.receiptNo}
              </span>
              {receipt.isOffline && (
                <div style={{ fontSize: '10px', color: '#b45309', fontWeight: 700, marginTop: '2px' }}>
                  {t('delivery_reps.van_collection_receipt_modal.s8', "سجل محلي (أوفلاين)")}
                </div>
              )}
            </div>
          </div>

          {/* Large Paid Amount Banner */}
          <div
            style={{
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '8px',
              padding: '10px 12px',
              textAlign: 'center',
              marginBottom: '10px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#065f46', fontWeight: 700 }}>
              {t('delivery_reps.van_collection_receipt_modal.s9', "المبلغ المقبوض نقداً بواسطة المندوب")}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#047857', marginTop: '2px' }}>
              {Number(receipt.amount).toFixed(2)} <CurrencySymbol />
            </div>
          </div>

          {/* Balance Comparison Chips */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '8px 10px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 700 }}>{t('delivery_reps.van_collection_receipt_modal.s10', "الرصيد السابق")}</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                {Number(receipt.previousBalance).toFixed(2)} <CurrencySymbol />
              </div>
            </div>

            <div
              style={{
                backgroundColor: Number(receipt.newBalance) > 0 ? '#fff1f2' : '#f0fdf4',
                border: Number(receipt.newBalance) > 0 ? '1px solid #fecdd3' : '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '8px 10px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '10.5px',
                  color: Number(receipt.newBalance) > 0 ? '#9f1239' : '#166534',
                  fontWeight: 700,
                }}
              >
                {t('delivery_reps.van_collection_receipt_modal.s11', "الرصيد المتبقي بذمة العميل")}
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 900,
                  color: Number(receipt.newBalance) > 0 ? '#be123c' : '#15803d',
                  marginTop: '2px',
                }}
              >
                {Number(receipt.newBalance).toFixed(2)} <CurrencySymbol />
              </div>
            </div>
          </div>

          {/* Rep and Timestamp */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: '#475569',
              paddingTop: '6px',
              borderTop: '1px dashed #cbd5e1',
            }}
          >
            <span>{t('delivery_reps.van_collection_receipt_modal.s12', "المندوب:")} <b>{receipt.repName || t('delivery_reps.van_collection_receipt_modal.s13', "مندوب التوزيع")}</b></span>
            <span>{t('delivery_reps.van_collection_receipt_modal.s14', "التاريخ:")} {receipt.date ? new Date(receipt.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) : t('delivery_reps.van_collection_receipt_modal.s15', "الآن")}</span>
          </div>
        </div>

        {/* WhatsApp Target Phone Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '4px 8px',
            marginBottom: '10px',
          }}
        >
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {t('delivery_reps.van_collection_receipt_modal.s16', "رقم واتساب العميل:")}
          </span>
          <input
            type="tel"
            dir="ltr"
            value={targetPhone}
            onChange={(e) => setTargetPhone(e.target.value)}
            placeholder="010XXXXXXXX"
            style={{
              flex: 1,
              height: '30px',
              border: 'none',
              outline: 'none',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#0f172a',
            }}
          />
        </div>
      </div>
    </StandardDialog>
  );
};
