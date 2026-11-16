// KioskQrDialog — the QR payment dialog extracted from SelfOrderingKioskPage.
// Presentational only: all state and handlers live in the page; this component
// receives everything as props. The QR renders locally from the tenant's real
// InstaPay payee, and the confirm button finalizes as pending — only the
// cashier's verification can mark the order paid.
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { AlertCircleIcon, ClockIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { InstaPayQrResult } from '@/lib/payment-qr';
import type { KioskPaymentStatus } from '@/features/pos/hooks/useSelfOrderingKiosk';

export interface KioskQrDialogProps {
  open: boolean;
  onClose: () => void;
  qr: InstaPayQrResult | null;
  qrRef: string;
  qrCountdown: number;
  orderError: string | null;
  totalCartAmount: number;
  instapayPayee: string | null;
  onFinalize: (opts: {
    paymentMethod: 'card' | 'qr_mobile' | 'cash';
    paymentStatus: KioskPaymentStatus;
    paymentLabel: string;
    authCode?: string;
    rrn?: string;
  }) => Promise<void>;
  onSwitchPayment: (choice: 'card_terminal' | 'qr_mobile' | 'cash_counter') => void;
}

export function KioskQrDialog({
  open,
  onClose,
  qr,
  qrRef,
  qrCountdown,
  orderError,
  totalCartAmount,
  instapayPayee,
  onFinalize,
  onSwitchPayment,
}: KioskQrDialogProps) {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* ========================================================= */}
      {/* نافذة الدفع السريع برمز QR بالهاتف (Dynamic QR Modal)       */}
      {/* ========================================================= */}
      <DialogShell
        open={open}
        onClose={onClose}
        ariaLabel={__t('pos.self_ordering_kiosk_page.s112', __t('pos.self_ordering_kiosk_page.s112', "الدفع الإلكتروني برمز QR"))}
        width="min(460px, 94vw)"
        zIndex={95}
      >
        <div style={{ padding: '24px 22px', textAlign: 'center', direction: 'rtl', fontFamily: 'inherit' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b' }}>
              {__t('pos.self_ordering_kiosk_page.s113', __t('pos.self_ordering_kiosk_page.s113', "معاملة #"))}{qrRef || 'QR-100'}
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '6px', color: '#64748b' }}
            >
              <XIcon size={16} />
            </button>
          </div>

          <h3 style={{ fontSize: '19px', fontWeight: 900, color: '#0f172a', margin: '0 0 4px' }}>
            {__t('pos.self_ordering_kiosk_page.s114', __t('pos.self_ordering_kiosk_page.s114', "امسح الرمز بهاتفك لإتمام الدفع"))}
          </h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>
            {__t('pos.self_ordering_kiosk_page.s115', __t('pos.self_ordering_kiosk_page.s115', "يدعم تطبيق إنستاباي، المحافظ الإلكترونية الذكية (فودافون/أورانج/اتصالات كاش)، أو تطبيق بنكك"))}
          </p>

          {/* Dynamic QR Code Box */}
          <div
            style={{
              width: '210px',
              height: '210px',
              margin: '0 auto 16px',
              padding: '10px',
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              border: '2px solid #e2e8f0',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* INV-REST-KIOSK-OWN-CATALOG-TRUTH (T14-B): the QR is
                rendered locally (buildInstaPayQrPayload -> buildQrSvg)
                and pays the tenant's real InstaPay address — no
                external QR host, no slug as payee. The option is
                hidden entirely when no real payee is configured, so
                this box only ever renders with one. */}
            {qr && (
              <div
                dangerouslySetInnerHTML={{ __html: qr.qrSvg }}
                role="img"
                aria-label={__t('pos.self_ordering_kiosk_page.s116', __t('pos.self_ordering_kiosk_page.s116', "رمز QR للدفع"))}
                style={{ width: '190px', height: '190px', borderRadius: '10px', display: 'block' }}
              />
            )}
          </div>

          {instapayPayee && (
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569', marginBottom: '16px' }}>
              {__t('pos.self_ordering_kiosk_page.s116_payee', __t('pos.self_ordering_kiosk_page.s116_payee', "التحويل إلى:"))} <span dir="ltr">{instapayPayee}</span>
            </div>
          )}

          {/* Amount Box */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: '14px',
              padding: '12px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s117', __t('pos.self_ordering_kiosk_page.s117', "إجمالي الفاتورة المطلوب سداده:"))}</div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
              {formatCurrency(totalCartAmount)}
            </div>
          </div>

          {/* Timer */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#f1f5f9',
              padding: '4px 14px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 800,
              color: '#475569',
              marginBottom: '18px',
            }}
          >
            <ClockIcon size={14} color="#64748b" />
            <span>
              {__t('pos.self_ordering_kiosk_page.s118', __t('pos.self_ordering_kiosk_page.s118', "متبقي"))} {Math.floor(qrCountdown / 60)}:{(qrCountdown % 60).toString().padStart(2, '0')} {__t('pos.self_ordering_kiosk_page.s119', __t('pos.self_ordering_kiosk_page.s119', "دقيقة"))}
            </span>
          </div>

          {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible here; the green button below retries it. */}
          {orderError && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                backgroundColor: '#fef2f2',
                border: '1.5px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '14px',
                textAlign: 'right',
              }}
            >
              <AlertCircleIcon size={20} color="#dc2626" />
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c', lineHeight: 1.5 }}>{orderError}</div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                // INV-REST-KIOSK-NO-FICTION: tapping "I sent it" creates
                // the order as PENDING — the server still holds
                // payment_status 'pending' and only the cashier's
                // verification can mark it paid. Never 'paid' on the
                // customer's word.
                void onFinalize({
                  paymentMethod: 'qr_mobile',
                  paymentStatus: 'pending',
                  paymentLabel: __t('pos.self_ordering_kiosk_page.s133', __t('pos.self_ordering_kiosk_page.s133', "تحويل QR — بانتظار تأكيد الكاشير")),
                  rrn: qrRef,
                });
              }}
              style={{
                width: '100%',
                height: '48px',
                backgroundColor: '#15803d',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 900,
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(22, 128, 61, 0.25)',
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s132', __t('pos.self_ordering_kiosk_page.s132', "أرسلت التحويل • استلام التذكرة"))}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onClose();
                onSwitchPayment('cash_counter');
                void onFinalize({
                  paymentMethod: 'cash',
                  paymentStatus: 'unpaid',
                  paymentLabel: __t('pos.self_ordering_kiosk_page.s122', __t('pos.self_ordering_kiosk_page.s122', "غير مدفوع - محاسبة عند الكاونتر")),
                });
              }}
              style={{
                width: '100%',
                height: '40px',
                borderRadius: '10px',
                fontSize: '12.5px',
                fontWeight: 800,
              }}
            >
              {__t('pos.self_ordering_kiosk_page.s123', __t('pos.self_ordering_kiosk_page.s123', "تعذر التحويل؟ سداد نقداً عند الكاشير"))}
            </Button>
          </div>

          <p style={{ fontSize: '11.5px', color: '#64748b', marginTop: '12px', lineHeight: 1.5 }}>
            {__t('pos.self_ordering_kiosk_page.s134', __t('pos.self_ordering_kiosk_page.s134', "سيتم تأكيد التحويل لدى الكاشير قبل بدء تحضير طلبك — احتفظ بالتذكرة."))}
          </p>
        </div>
      </DialogShell>
    </>
  );
}
