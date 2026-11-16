// KioskTerminalDialog — ECR card-terminal dialog for the self-ordering kiosk.
// Presentational slice of SelfOrderingKioskPage: all state and handlers live in the
// page; this component receives them as props. Pure move of the terminal DialogShell
// (connecting / waiting_card / approved / declined / offline_error steps).

import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  QrCodeIcon,
  RefreshCwIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import type { KioskPaymentStatus } from '@/features/pos/hooks/useSelfOrderingKiosk';

export interface KioskFinalizeOpts {
  paymentMethod: 'card' | 'qr_mobile' | 'cash';
  paymentStatus: KioskPaymentStatus;
  paymentLabel: string;
  authCode?: string;
  rrn?: string;
}

export interface KioskTerminalDialogProps {
  open: boolean;
  onClose: () => void;
  terminalStep: 'connecting' | 'waiting_card' | 'approved' | 'declined' | 'offline_error';
  terminalMessage: string;
  terminalCountdown: number;
  activeTransactionId: string;
  orderError: string | null;
  lastFinalizeOpts: KioskFinalizeOpts | null;
  totalCartAmount: number;
  hasRealInstapayPayee: boolean;
  onRetryFinalize: (opts: KioskFinalizeOpts) => Promise<void>;
  onRetryCheckout: () => Promise<void>;
  onSwitchPayment: (choice: 'card_terminal' | 'qr_mobile' | 'cash_counter') => void;
  onSwitchToQr: () => void;
}

export function KioskTerminalDialog(props: KioskTerminalDialogProps) {
  const { t: __t } = useTranslation();
  const {
    open,
    onClose,
    terminalStep,
    terminalMessage,
    terminalCountdown,
    activeTransactionId,
    orderError,
    lastFinalizeOpts,
    totalCartAmount,
    hasRealInstapayPayee,
    onRetryFinalize,
    onRetryCheckout,
    onSwitchPayment,
    onSwitchToQr,
  } = props;
  return (
    <>
    {/* ========================================================= */}
    {/* نافذة ماكينة الدفع بالبطاقة بالكشك (Terminal Modal)         */}
    {/* ========================================================= */}
    <DialogShell
      open={open}
      onClose={() => {
        if (terminalStep !== 'approved') onClose();
      }}
      ariaLabel={__t('pos.self_ordering_kiosk_page.s90', __t('pos.self_ordering_kiosk_page.s90', "جهاز الدفع بالبطاقة بالكشك"))}
      width="min(460px, 94vw)"
      zIndex={95}
    >
      <div style={{ padding: '28px 24px', textAlign: 'center', direction: 'rtl', fontFamily: 'inherit' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b' }}>
            {__t('pos.self_ordering_kiosk_page.s91', __t('pos.self_ordering_kiosk_page.s91', "معاملة #"))}{activeTransactionId || 'ECR-001'}
          </span>
          <button
            type="button"
            onClick={() => onClose()}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '6px', color: '#64748b' }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* INV-REST-KIOSK-NO-FICTION: a failed finalize stays visible in every terminal step. */}
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

        {/* الخطوة 1: جاري الاتصال بالماكينة */}
        {terminalStep === 'connecting' && (
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                backgroundColor: '#eef2ff',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RefreshCwIcon size={28} color="#170e5e" className="animate-spin" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
              {__t('pos.self_ordering_kiosk_page.s92', __t('pos.self_ordering_kiosk_page.s92', "جاري الاتصال بماكينة الدفع"))}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              {terminalMessage || __t('pos.self_ordering_kiosk_page.s93', __t('pos.self_ordering_kiosk_page.s93', "جاري إرسال قيمة الفاتورة للماكينة..."))}
            </p>
          </div>
        )}

        {/* الخطوة 2: في انتظار تمرير البطاقة */}
        {terminalStep === 'waiting_card' && (
          <div style={{ padding: '10px 0' }}>
            <div
              style={{
                width: '74px',
                height: '74px',
                borderRadius: '22px',
                backgroundColor: '#f5f3ff',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #ddd6fe',
              }}
            >
              <CreditCardIcon size={36} color="#170e5e" />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
              {__t('pos.self_ordering_kiosk_page.s94', __t('pos.self_ordering_kiosk_page.s94', "مرر أو أدخل البطاقة البنكية"))}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>
              {__t('pos.self_ordering_kiosk_page.s95', __t('pos.self_ordering_kiosk_page.s95', "في جهاز الدفع بالأسفل (يدعم فيزا، ماستركارد، ميزا، ومدى، وApple Pay)"))}
            </p>

            {/* Amount Box */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '16px',
                padding: '14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '12px', color: '#64748b' }}>{__t('pos.self_ordering_kiosk_page.s96', __t('pos.self_ordering_kiosk_page.s96', "المبلغ المطلوب سحبه:"))}</div>
              <div style={{ fontSize: '26px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
                {formatCurrency(totalCartAmount)}
              </div>
            </div>

            {/* Countdown badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#f1f5f9',
                padding: '5px 14px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 800,
                color: '#475569',
                marginBottom: '18px',
              }}
            >
              <ClockIcon size={14} color="#64748b" />
              <span>{__t('pos.self_ordering_kiosk_page.s97', __t('pos.self_ordering_kiosk_page.s97', "متبقي"))} {terminalCountdown} {__t('pos.self_ordering_kiosk_page.s98', __t('pos.self_ordering_kiosk_page.s98', "ثانية"))}</span>
            </div>

            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onClose()}
                style={{
                  width: '100%',
                  height: '42px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s99', __t('pos.self_ordering_kiosk_page.s99', "إلغاء والعودة"))}
              </Button>
            </div>
          </div>
        )}

        {/* الخطوة 3: تمت الموافقة بنجاح */}
        {terminalStep === 'approved' && (
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircleIcon size={36} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#15803d', margin: '0 0 6px' }}>
              {__t('pos.self_ordering_kiosk_page.s100', __t('pos.self_ordering_kiosk_page.s100', "تمت الموافقة وخصم المبلغ بنجاح!"))}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              {terminalMessage || __t('pos.self_ordering_kiosk_page.s101', __t('pos.self_ordering_kiosk_page.s101', "تم تأكيد التفويض البنكي، جاري إصدار تذكرتك..."))}
            </p>
            {/* INV-REST-KIOSK-NO-FICTION: the card is already charged, so
                the retry re-sends the order only — it never re-charges. */}
            {orderError && lastFinalizeOpts && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '18px' }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    void onRetryFinalize(lastFinalizeOpts);
                  }}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#170e5e',
                    fontSize: '13.5px',
                    fontWeight: 800,
                  }}
                >
                  {__t('pos.self_ordering_kiosk_page.s137', __t('pos.self_ordering_kiosk_page.s137', "إعادة إرسال الطلب"))}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* الخطوة 4: تم رفض العملية */}
        {terminalStep === 'declined' && (
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: '#fee2e2',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertCircleIcon size={36} color="#dc2626" />
            </div>
            <h3 style={{ fontSize: '19px', fontWeight: 900, color: '#b91c1c', margin: '0 0 6px' }}>
              {__t('pos.self_ordering_kiosk_page.s102', __t('pos.self_ordering_kiosk_page.s102', "تعذر إتمام الدفع بالبطاقة"))}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>
              {terminalMessage || __t('pos.self_ordering_kiosk_page.s103', __t('pos.self_ordering_kiosk_page.s103', "تم رفض العملية من البنك أو تم إلغاؤها."))}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void onRetryCheckout();
                }}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: '#170e5e',
                  fontSize: '13.5px',
                  fontWeight: 800,
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s104', __t('pos.self_ordering_kiosk_page.s104', "إعادة المحاولة ببطاقة أخرى"))}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onClose();
                  onSwitchPayment('cash_counter');
                  void onRetryFinalize({
                    paymentMethod: 'cash',
                    paymentStatus: 'unpaid',
                    paymentLabel: __t('pos.self_ordering_kiosk_page.s105', __t('pos.self_ordering_kiosk_page.s105', "غير مدفوع - محاسبة عند الكاونتر")),
                  });
                }}
                style={{
                  width: '100%',
                  height: '42px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s106', __t('pos.self_ordering_kiosk_page.s106', "التحويل للدفع نقداً عند الكاشير"))}
              </Button>
            </div>
          </div>
        )}

        {/* الخطوة 5: الجهاز غير متصل (تنبيه حقيقي دون تخطي وهمي) */}
        {terminalStep === 'offline_error' && (
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                backgroundColor: '#fef3c7',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangleIcon size={32} color="#d97706" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
              {__t('pos.self_ordering_kiosk_page.s107', __t('pos.self_ordering_kiosk_page.s107', "ماكينة الدفع غير متصلة بهذا الكشك"))}
            </h3>
            <p style={{ fontSize: '12.5px', color: '#64748b', lineHeight: 1.5, margin: '0 0 20px' }}>
              {terminalMessage}
              <br />
              {__t('pos.self_ordering_kiosk_page.s108', __t('pos.self_ordering_kiosk_page.s108', "يمكنك مسح رمز QR والدفع بهاتفك فوراً، أو طباعة تذكرة والتوجه لكاونتر الكاشير للمحاسبة بالفيزا أو نقداً."))}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {hasRealInstapayPayee && (
              <Button
                type="button"
                variant="primary"
                onClick={() => onSwitchToQr()}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: '#170e5e',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <QrCodeIcon size={16} color="#ffffff" />
                <span>{__t('pos.self_ordering_kiosk_page.s109', __t('pos.self_ordering_kiosk_page.s109', "الدفع بمسح رمز QR بالهاتف"))}</span>
              </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onClose();
                  onSwitchPayment('cash_counter');
                  void onRetryFinalize({
                    paymentMethod: 'cash',
                    paymentStatus: 'unpaid',
                    paymentLabel: __t('pos.self_ordering_kiosk_page.s110', __t('pos.self_ordering_kiosk_page.s110', "غير مدفوع - محاسبة عند الكاونتر")),
                  });
                }}
                style={{
                  width: '100%',
                  height: '42px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                {__t('pos.self_ordering_kiosk_page.s111', __t('pos.self_ordering_kiosk_page.s111', "طباعة تذكرة والسداد لدى الكاشير"))}
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogShell>
    </>
  );
}
