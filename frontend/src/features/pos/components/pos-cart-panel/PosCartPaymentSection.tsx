import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { getBalanceState } from '@/features/pos/lib/pos-balance-state';
import { writeCheckoutIntent } from '@/features/pos/lib/pos-checkout-integrity';
import type { PosCartPanelProps } from './posCartPanel.types';

type PaymentPreset = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit';

function isPresetActive(
  paymentType: PosCartPanelProps['paymentType'],
  paymentChannel: PosCartPanelProps['paymentChannel'],
  cashAmount: number,
  cardAmount: number,
  transferAmount: number,
  preset: PaymentPreset,
) {
  if (preset === 'credit') return paymentType === 'credit';
  if (paymentType === 'credit') return false;
  const cash = Number(cashAmount || 0);
  const card = Number(cardAmount || 0);
  const transfer = Number(transferAmount || 0);
  const activeLegs = (cash > 0 ? 1 : 0) + (card > 0 ? 1 : 0) + (transfer > 0 ? 1 : 0);
  if (activeLegs === 0) {
    if (preset === 'wallet' || preset === 'instapay') return paymentChannel === preset;
    if (preset === 'card') return paymentChannel === 'card';
    return paymentChannel === 'cash';
  }
  if (activeLegs > 1) return false;
  if (preset === 'cash') return cash > 0;
  if (preset === 'card') return card > 0;
  if (preset === 'wallet') return transfer > 0 && paymentChannel === 'wallet';
  if (preset === 'instapay') return transfer > 0 && paymentChannel !== 'wallet';
  return false;
}

function isTransferPreset(
  paymentType: PosCartPanelProps['paymentType'],
  paymentChannel: PosCartPanelProps['paymentChannel'],
  cashAmount: number,
  cardAmount: number,
  transferAmount: number,
) {
  if (paymentType === 'credit') return false;
  const transfer = Number(transferAmount || 0);
  if (transfer > 0) return true;
  const hasOtherLeg = Number(cashAmount || 0) > 0 || Number(cardAmount || 0) > 0;
  return !hasOtherLeg && (paymentChannel === 'wallet' || paymentChannel === 'instapay');
}

/* R5-A (INV-REST-TOTALS-TRUTH-2, M24): the local getBalanceState used to
 * treat only paymentType === 'credit' as credit and returned the raw
 * amountDue; the checkout dialog's getBalancePreview treated any
 * partial payment with a customer as credit-remaining and returned a
 * NEGATIVE value. Both now delegate to the one shared helper in
 * pos-balance-state.ts (paidAmount/totals join the Pick below; the
 * parent spreads the full panel props, so no call-site change). */

export function PosCartPaymentSection(props: Pick<PosCartPanelProps,
  'paymentType' | 'paymentChannel' | 'cashAmount' | 'cardAmount' | 'transferAmount' | 'discount' | 'deliveryFee' | 'amountDue' | 'changeAmount' |
  'customerId' | 'paidAmount' | 'totals' |
  'canApplyDiscount' | 'discountApprovalGranted' | 'isDiscountAuthorizationPending' | 'hasDiscountPermissionViolation' |
  'onPaymentPresetChange' | 'onCashAmountChange' | 'onCardAmountChange' | 'onTransferAmountChange' | 'onDiscountChange' | 'onDeliveryFeeChange' | 'onFillPaidAmount' | 'onRequestDiscountAuthorization'
>) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const balance = getBalanceState({
    paymentType: props.paymentType,
    customerId: props.customerId,
    paidAmount: props.paidAmount,
    amountDue: props.amountDue,
    changeAmount: props.changeAmount,
    total: props.totals?.total ?? 0,
  });
  const isCreditSale = props.paymentType === 'credit';
  const isDiscountLocked = !props.canApplyDiscount;
  const transferSelected = isTransferPreset(props.paymentType, props.paymentChannel, props.cashAmount, props.cardAmount, props.transferAmount);

  function selectPaymentPreset(preset: PaymentPreset) {
    writeCheckoutIntent({
      customerId: props.customerId || '',
      paymentType: preset === 'credit' ? 'credit' : 'cash',
      paymentChannel: preset,
    });
    flushSync(() => {
      props.onPaymentPresetChange(preset);
    });
  }

  return (
    <div className="pos-payment-shell pos-payment-shell-compact pos-payment-shell-inline">
      <div className="pos-payment-strip" aria-label={t('pos.payment_method', 'طريقة الدفع والمدفوع')}>
        <div className="pos-strip-field pos-strip-field-inline pos-strip-presets">
          <div className="actions compact-actions pos-payment-preset-row pos-payment-preset-row-inline" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px' }}>
            <Button type="button" variant={isPresetActive(props.paymentType, props.paymentChannel, props.cashAmount, props.cardAmount, props.transferAmount, 'cash') ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset('cash')}>{t('pos.cash', 'نقدي')}</Button>
            <Button type="button" variant={isPresetActive(props.paymentType, props.paymentChannel, props.cashAmount, props.cardAmount, props.transferAmount, 'card') ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset('card')}>{t('pos.card', 'فيزا')}</Button>
            <Button type="button" variant={transferSelected ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset(props.paymentChannel === 'wallet' ? 'wallet' : 'instapay')}>{t('pos.transfers', 'تحويلات / محافظ')}</Button>
            <Button type="button" variant={isPresetActive(props.paymentType, props.paymentChannel, props.cashAmount, props.cardAmount, props.transferAmount, 'credit') ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset('credit')}>{t('pos.credit', 'آجل')}</Button>
          </div>
          {transferSelected ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px' }}>
              <Button type="button" variant={props.paymentChannel !== 'wallet' ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset('instapay')} style={{ minHeight: '28px', fontSize: '11.5px', fontWeight: 800 }}>InstaPay</Button>
              <Button type="button" variant={props.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => selectPaymentPreset('wallet')} style={{ minHeight: '28px', fontSize: '11px', fontWeight: 700 }}>{__t('pos.pos_cart_panel.pos_cart_payment_section.s0', __t('pos.pos_cart_panel.pos_cart_payment_section.s0', "محافظ إلكترونية"))}</Button>
            </div>
          ) : null}
        </div>

        <label className="pos-strip-field pos-strip-field-inline pos-strip-field-input pos-strip-field-cash">
          <span>{t('pos.cash', 'نقدي')}</span>
          <div className="pos-strip-input-shell">
            <input
              className="no-spin-arrows"
              type="number"
              step="0.01"
              value={props.cashAmount}
              onWheel={(e) => e.currentTarget.blur()}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(event) => props.onCashAmountChange(Number(event.target.value || 0))}
            />
            <Button
              type="button"
              variant="secondary"
              className="pos-payment-fill-inline"
              onClick={props.onFillPaidAmount}
            >
              {t('pos.fill_full', 'كامل')}
            </Button>
          </div>
        </label>

        <label className="pos-strip-field pos-strip-field-inline pos-strip-field-input pos-strip-field-card">
          <span>{t('pos.card', 'فيزا')}</span>
          <input
            className="no-spin-arrows"
            type="number"
            step="0.01"
            value={props.cardAmount}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => props.onCardAmountChange(Number(event.target.value || 0))}
          />
        </label>

        {transferSelected ? (
          <label className="pos-strip-field pos-strip-field-inline pos-strip-field-input pos-strip-field-card">
            <span>{props.paymentChannel === 'instapay' ? t('pos.paid_instapay', 'مدفوع InstaPay') : t('pos.paid_wallet', 'مدفوع محفظة')}</span>
            <input
              className="no-spin-arrows"
              type="number"
              step="0.01"
              value={props.transferAmount}
              onWheel={(e) => e.currentTarget.blur()}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(event) => props.onTransferAmountChange(Number(event.target.value || 0))}
              disabled={isCreditSale}
            />
          </label>
        ) : null}

        <label className="pos-strip-field pos-strip-field-inline pos-strip-field-input pos-strip-field-discount">
          <span>{t('pos.discount', 'الخصم')}</span>
          <div className="pos-strip-input-shell">
            <input
              className="no-spin-arrows"
              type="number"
              step="0.01"
              value={props.discount}
              onWheel={(e) => e.currentTarget.blur()}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(event) => props.onDiscountChange(Number(event.target.value || 0))}
              disabled={isDiscountLocked}
            />
            {isDiscountLocked ? (
              <Button
                type="button"
                variant={props.discountApprovalGranted ? 'success' : 'secondary'}
                className="pos-payment-fill-inline"
                onClick={props.onRequestDiscountAuthorization}
                disabled={props.isDiscountAuthorizationPending}
              >
                {props.isDiscountAuthorizationPending ? t('pos.approving', 'جاري التحقق...') : (props.discountApprovalGranted ? t('pos.approved', 'معتمد') : t('pos.manager_approval', 'اعتماد المدير'))}
              </Button>
            ) : null}
          </div>
        </label>

        <label className="pos-strip-field pos-strip-field-inline pos-strip-field-input pos-strip-field-discount">
          <span>{t('pos.delivery_fee', 'التوصيل')}</span>
          <div className="pos-strip-input-shell">
            <input
              className="no-spin-arrows"
              type="number"
              step="0.01"
              value={props.deliveryFee}
              onWheel={(e) => e.currentTarget.blur()}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(event) => props.onDeliveryFeeChange(Number(event.target.value || 0))}
            />
          </div>
        </label>

        <div className="pos-strip-field pos-strip-field-inline pos-strip-balance">
          <span>{balance.label}</span>
          <strong>{formatCurrency(balance.value)}</strong>
        </div>
      </div>

      {!props.canApplyDiscount || props.hasDiscountPermissionViolation ? (
        <div className="pos-payment-strip-notes">
          {!props.canApplyDiscount ? (
            <span className="pos-payment-strip-note">
              {props.discountApprovalGranted ? t('pos.discount_approved_note', 'تم اعتماد الخصم لهذه الفاتورة فقط.') : t('pos.no_discount_permission', 'لا تملك صلاحية تعديل الخصم. استخدم اعتماد المدير لهذه الفاتورة.')}
            </span>
          ) : null}
          {props.hasDiscountPermissionViolation ? <span className="pos-payment-strip-note is-warning">{t('pos.discount_exceeds_limit', 'الخصم يتجاوز الحد المسموح به أو يتطلب اعتماد المدير (PIN).')}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
