// ==========================================
// الشاشة 4: تأكيد الطلب والطباعة الحرارية
// ==========================================

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon, ClockIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import {
  kioskConfirmationCopy,
  type KioskConfirmationItem,
  type KioskPaymentStatus,
} from '@/features/pos/hooks/useSelfOrderingKiosk';

export interface KioskConfirmationScreenProps {
  confirmation: {
    orderNumber: string;
    total: number;
    diningMode: string;
    tableNumber?: string;
    items?: KioskConfirmationItem[];
    placedAt?: string;
    paymentStatus: KioskPaymentStatus;
    paymentMethodLabel: string;
    authCode?: string;
    rrn?: string;
  };
  resetCountdown: number;
  storeDisplayName: string;
  onReset: () => void;
}

export function KioskConfirmationScreen({ confirmation, resetCountdown, storeDisplayName, onReset }: KioskConfirmationScreenProps) {
  const { t: __t } = useTranslation();

  // INV-REST-KIOSK-NO-FICTION: the ticket's words come from one helper so
  // a 'pending' QR transfer can never render as PAID — or as "pay at the
  // counter" either.
  const confirmationCopy = kioskConfirmationCopy(
    confirmation.paymentStatus,
    {
      totalText: formatCurrency(confirmation.total),
      paymentMethodLabel: confirmation.paymentMethodLabel,
    },
    (key, fallback) => __t(key, __t(key, fallback)),
  );
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          maxWidth: '540px',
          width: '100%',
          backgroundColor: '#ffffff',
          borderRadius: '28px',
          border: '1px solid #e2e8f0',
          padding: '40px 32px',
          textAlign: 'center',
          boxShadow: '0 16px 40px rgba(0,0,0,0.07)',
        }}
      >
        {confirmationCopy.tone !== 'paid' ? (
          <>
            <div
              style={{
                width: '84px',
                height: '84px',
                borderRadius: '50%',
                backgroundColor: '#fef3c7',
                margin: '0 auto 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ClockIcon size={46} color="#d97706" />
            </div>

            <h2 style={{ fontSize: '25px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
              {confirmationCopy.heroTitle}
            </h2>
            <div
              style={{
                backgroundColor: '#fffbeb',
                border: '1.5px solid #fde68a',
                borderRadius: '14px',
                padding: '12px 16px',
                margin: '0 auto 22px',
                fontSize: '13.5px',
                fontWeight: 800,
                color: '#92400e',
                lineHeight: 1.5,
              }}
            >
              {confirmationCopy.heroNote}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                width: '84px',
                height: '84px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                margin: '0 auto 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircleIcon size={48} color="#16a34a" />
            </div>

            <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
              {confirmationCopy.heroTitle}
            </h2>
            <p style={{ fontSize: '14.5px', color: '#64748b', margin: '0 0 24px' }}>
              {confirmationCopy.heroNote}
            </p>
          </>
        )}

        <div
          style={{
            backgroundColor: '#f1f5f9',
            borderRadius: '22px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>
            {__t('pos.self_ordering_kiosk_page.s12', __t('pos.self_ordering_kiosk_page.s12', "رقم تذكرتك في شاشة المناداة:"))}
          </div>
          <div style={{ fontSize: '48px', fontWeight: 900, color: '#170e5e', letterSpacing: '2px' }}>
            #{confirmation.orderNumber}
          </div>

          <div style={{ marginTop: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor:
                  confirmationCopy.tone === 'unpaid'
                    ? '#fee2e2'
                    : confirmationCopy.tone === 'pending'
                      ? '#fef3c7'
                      : '#dcfce7',
                color:
                  confirmationCopy.tone === 'unpaid'
                    ? '#b91c1c'
                    : confirmationCopy.tone === 'pending'
                      ? '#92400e'
                      : '#15803d',
                border:
                  confirmationCopy.tone === 'unpaid'
                    ? '1px solid #fecaca'
                    : confirmationCopy.tone === 'pending'
                      ? '1px solid #fde68a'
                      : 'none',
                borderRadius: '8px',
                padding: '4px 12px',
                fontSize: '12.5px',
                fontWeight: 900,
              }}
            >
              {confirmationCopy.badgeText}
            </span>
          </div>

          {confirmation.tableNumber && (
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '10px' }}>
              {__t('pos.self_ordering_kiosk_page.s15', __t('pos.self_ordering_kiosk_page.s15', "طاولة رقم:"))} {confirmation.tableNumber}
            </div>
          )}
          <div style={{ fontSize: '13.5px', color: '#475569', marginTop: '10px' }}>
            {__t('pos.self_ordering_kiosk_page.s16', __t('pos.self_ordering_kiosk_page.s16', "المبلغ الإجمالي:"))} <strong>{formatCurrency(confirmation.total)}</strong> ({confirmation.diningMode})
          </div>
        </div>

        <p style={{ fontSize: '12.5px', color: '#94a3b8', marginBottom: '20px' }}>
          {__t('pos.self_ordering_kiosk_page.s17', __t('pos.self_ordering_kiosk_page.s17', "ستعود الشاشة للرئيسية تلقائياً خلال"))} {resetCountdown} {__t('pos.self_ordering_kiosk_page.s18', __t('pos.self_ordering_kiosk_page.s18', "ثانية..."))}
        </p>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.print()}
            style={{
              width: '100%',
              height: '48px',
              fontSize: '14px',
              fontWeight: 800,
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              backgroundColor: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              color: '#0f172a',
              cursor: 'pointer',
            }}
          >
            <PrinterIcon size={20} color="#170e5e" />
            <span>
              {confirmationCopy.printLabel}
            </span>
          </Button>
        </div>

        <Button
          variant="primary"
          onClick={onReset}
          style={{
            width: '100%',
            height: '48px',
            backgroundColor: '#170e5e',
            fontSize: '14.5px',
            fontWeight: 800,
            borderRadius: '14px',
          }}
        >
          {__t('pos.self_ordering_kiosk_page.s21', __t('pos.self_ordering_kiosk_page.s21', "طلب جديد الآن"))}
        </Button>

        {/* Hidden Thermal Printable Receipt */}
        <div className="kiosk-print-receipt" style={{ display: 'none' }}>
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .kiosk-print-receipt, .kiosk-print-receipt * { visibility: visible !important; }
              .kiosk-print-receipt {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 80mm !important;
                padding: 8px !important;
                display: block !important;
                font-family: monospace, sans-serif !important;
                direction: rtl !important;
                color: #000 !important;
              }
            }
          `}</style>
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px', marginBottom: '8px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 900 }}>{storeDisplayName}</h3>
            <div style={{ fontSize: '12px' }}>{__t('pos.self_ordering_kiosk_page.s22', __t('pos.self_ordering_kiosk_page.s22', "طلب خدمة ذاتية - كشك ذكي"))}</div>
            <div style={{ fontSize: '11px', marginTop: '2px' }}>{confirmation.placedAt || ''}</div>
          </div>

          <div style={{ textAlign: 'center', margin: '12px 0', borderBottom: '1px dashed #000', paddingBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>{__t('pos.self_ordering_kiosk_page.s23', __t('pos.self_ordering_kiosk_page.s23', "رقم التذكرة والاستلام:"))}</div>
            <div style={{ fontSize: '38px', fontWeight: 900, margin: '4px 0' }}>#{confirmation.orderNumber}</div>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>{confirmation.diningMode}</div>
            {confirmation.tableNumber && (
              <div style={{ fontSize: '14px', fontWeight: 900, marginTop: '4px' }}>{__t('pos.self_ordering_kiosk_page.s24', __t('pos.self_ordering_kiosk_page.s24', "طاولة:"))} {confirmation.tableNumber}</div>
            )}

            {/* تحذير صريح على الورقة المطبوعة: غير مدفوع أو بانتظار تأكيد التحويل — لا تظهر أبداً كمدفوع */}
            {confirmationCopy.tone === 'paid' ? (
              <div style={{ fontSize: '12px', fontWeight: 800, marginTop: '6px' }}>
                {confirmationCopy.receiptTitle}
                <div>{confirmationCopy.receiptBody}</div>
                {confirmation.authCode && <div>{__t('pos.self_ordering_kiosk_page.s30', __t('pos.self_ordering_kiosk_page.s30', "رقم التفويض:"))} {confirmation.authCode}</div>}
                {confirmation.rrn && <div>{__t('pos.self_ordering_kiosk_page.s31', __t('pos.self_ordering_kiosk_page.s31', "رقم المرجع:"))} {confirmation.rrn}</div>}
              </div>
            ) : (
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 900,
                  margin: '8px 0 4px',
                  border: '2px solid #000',
                  padding: '6px',
                  lineHeight: 1.4,
                }}
              >
                {confirmationCopy.receiptTitle}
                <br />
                {confirmationCopy.receiptBody}
              </div>
            )}
          </div>

          {confirmation.items && confirmation.items.length > 0 && (
            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '8px', marginBottom: '8px' }}>
              {confirmation.items.map((item, idx) => (
                <div key={idx} style={{ margin: '3px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>{item.qty}x {item.name}</span>
                    <span>{formatCurrency(calcCartLineTotal(item as any))}</span>
                  </div>
                  {/* INV-REST-KIOSK-MODIFIER-UI (R7-B2): the receipt shows
                      the chosen extras under their line, so the ticket
                      the customer prints matches what the kitchen sees. */}
                  {(item.modifiers || []).map((mod, modIdx) => (
                    <div key={modIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', paddingRight: '12px', color: '#334155' }}>
                      <span>+ {mod.name}{Number(mod.qty || 1) > 1 ? ` ×${mod.qty}` : ''}</span>
                      <span>{formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1) * item.qty)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 900, marginBottom: '12px' }}>
            <span>{__t('pos.self_ordering_kiosk_page.s32', __t('pos.self_ordering_kiosk_page.s32', "الإجمالي:"))}</span>
            <span>{formatCurrency(confirmation.total)}</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: '11px' }}>
            {confirmationCopy.receiptFooter}
          </div>
        </div>
      </div>
    </div>
  );
}
