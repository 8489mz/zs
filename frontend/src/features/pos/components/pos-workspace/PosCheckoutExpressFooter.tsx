import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { UserIcon, ChevronDownIcon, ChevronUpIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { isTerminalApprovalLive } from '@/features/pos/components/pos-workspace/pos-terminal-charge-safety';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PaymentPreset } from '@/features/pos/components/pos-workspace/PosCheckoutDialogSections';

export interface PosCheckoutExpressFooterProps {
  pos: PosWorkspaceState;
  isPaymentActive: (preset: PaymentPreset) => boolean;
  onSelectPaymentPreset: (preset: PaymentPreset) => void;
  onConfirmSale: (tenderedAmount?: number) => void;
  onSwitchToDetailed: () => void;
  selectedCustomerName: string;
  onOpenCustomerPicker: () => void;
  showMoreOptions: boolean;
  onToggleMoreOptions: () => void;
  effectiveReceivedCash: number;
  total: number;
  isTerminalHardwareManaged: boolean;
  terminalDispatchStatus: 'idle' | 'waiting' | 'approved' | 'declined' | 'manual';
  isManualCardConfirmed: boolean;
}

export function PosCheckoutExpressFooter({
  pos,
  isPaymentActive,
  onSelectPaymentPreset,
  onConfirmSale,
  onSwitchToDetailed,
  selectedCustomerName,
  onOpenCustomerPicker,
  showMoreOptions,
  onToggleMoreOptions,
  effectiveReceivedCash,
  total,
  isTerminalHardwareManaged,
  terminalDispatchStatus,
  isManualCardConfirmed,
}: PosCheckoutExpressFooterProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 3. Collapsible Additional Options (+ خيارات إضافية) */}
      <div style={{ marginTop: '2px' }}>
        <button
          type="button"
          onClick={onToggleMoreOptions}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '7px 10px',
            borderRadius: '8px',
            background: showMoreOptions ? '#f1f5f9' : '#f8fafc',
            border: '1px solid #e2e8f0',
            color: '#475569',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span>{showMoreOptions ? t('pos.hide_extra_options', 'إخفاء الخيارات الإضافية') : t('pos.show_extra_options', '+ خيارات إضافية (ربط عميل، ملاحظات، بيع آجل)')}</span>
          {showMoreOptions ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </button>

        {showMoreOptions && (
          <div
            style={{
              marginTop: '6px',
              padding: '10px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {/* Customer Link Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={onOpenCustomerPicker}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  minHeight: '32px',
                }}
              >
                <UserIcon size={14} />
                <span>{selectedCustomerName ? `العميل: ${selectedCustomerName}` : t('pos.link_customer_opt', 'ربط الفاتورة بعميل')}</span>
              </Button>

              {/* Credit Sale Button */}
              <Button
                type="button"
                variant={pos.paymentType === 'credit' ? 'primary' : 'secondary'}
                onClick={() => {
                  onSelectPaymentPreset('credit');
                  if (!pos.customerId) onOpenCustomerPicker();
                }}
                style={{ fontSize: '11.5px', minHeight: '32px' }}
              >
                {t('pos.credit_sale', 'بيع آجل')}
              </Button>
            </div>

            {/* Note input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                value={pos.note}
                onChange={(e) => pos.setNote(e.target.value)}
                placeholder={t('pos.optional_order_notes', 'ملاحظات اختيارية على الفاتورة...')}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                }}
              />
            </div>

            {/* Switch to Full Detailed View link */}
            <div style={{ textAlign: 'center', marginTop: '2px' }}>
              <button
                type="button"
                onClick={onSwitchToDetailed}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t('pos.switch_to_detailed_view', 'الانتقال إلى شاشة الدفع التفصيلية الكاملة')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Action Buttons */}
      {(() => {
        const isCardPayment = isPaymentActive('card');
        const isCardReady = !isCardPayment || !isTerminalHardwareManaged || terminalDispatchStatus === 'approved' || isManualCardConfirmed || Boolean(pos.terminalPaymentDetails?.authCode || pos.terminalPaymentDetails?.rrn);
        const isCardBlocked = isCardPayment && isTerminalHardwareManaged && !isCardReady;
        const canConfirmNow = !pos.createSale.isPending && !isCardBlocked && pos.canSubmitSale;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
            <Button
              type="button"
              variant={canConfirmNow ? 'success' : 'secondary'}
              onClick={() => {
                if (pos.createSale.isPending) return;
                if (isCardBlocked) {
                  toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
                  return;
                }
                if (isPaymentActive('cash')) {
                  pos.setCashAmount?.(effectiveReceivedCash);
                  pos.setCardAmount?.(0);
                  pos.setPaymentChannel?.('cash');
                  onConfirmSale(effectiveReceivedCash);
                } else {
                  // INV-REST-PAID-GATES-2 (R4-D, I40): never overwrite
                  // the card leg with the current total while a
                  // terminal approval is live — the approved amount
                  // is the leg, and the submit gate pins it.
                  if (!isTerminalApprovalLive(pos.terminalPaymentDetails)) {
                    pos.setCardAmount?.(total);
                  }
                  pos.setCashAmount?.(0);
                  pos.setPaymentChannel?.('card');
                  onConfirmSale();
                }
              }}
              disabled={!canConfirmNow}
              style={{
                height: '46px',
                fontSize: '14.5px',
                fontWeight: 800,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: canConfirmNow ? '#10b981' : '#f1f5f9',
                color: canConfirmNow ? '#ffffff' : '#64748b',
                border: canConfirmNow ? 'none' : '1.5px solid #cbd5e1',
                boxShadow: canConfirmNow ? '0 2px 4px rgba(16, 185, 129, 0.25)' : 'none',
                cursor: canConfirmNow ? 'pointer' : 'not-allowed',
              }}
            >
              {canConfirmNow && <CheckIcon size={18} />}
              <span>
                {pos.createSale.isPending
                  ? t('common.saving', 'جاري الحفظ...')
                  : isCardBlocked
                  ? (terminalDispatchStatus === 'waiting'
                      ? t('pos.terminal_waiting_button', 'في انتظار استجابة الماكينة...')
                      : terminalDispatchStatus === 'declined'
                      ? t('pos.terminal_declined_button', 'تعذر الاتصال (اضغط إتمام يدوي أو كاش)')
                      : terminalDispatchStatus === 'manual'
                      ? t('pos.terminal_manual_button', 'سجل رقم إيصال K-NET واضغط اعتماد')
                      : t('pos.terminal_idle_button', 'في انتظار دفع كي نت بالماكينة'))
                  : t('pos.confirm_sale_f2', 'تأكيد البيع والطباعة (F2)')}
              </span>
            </Button>
            {pos.adminDiscountWarning && (
              <div
                style={{
                  fontSize: '11.5px',
                  color: '#92400e',
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {pos.adminDiscountWarning}
              </div>
            )}
            {!pos.canSubmitSale && pos.canSubmitHint && (
              <div
                style={{
                  fontSize: '11.5px',
                  color: '#92400e',
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                {pos.canSubmitHint}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
