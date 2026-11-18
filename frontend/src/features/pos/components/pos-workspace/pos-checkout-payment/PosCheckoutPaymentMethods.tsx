// Step 1 payment method buttons — header, preset button grid and the
// fixed-height sub-slot (quick-cash / transfer presets / status line).
// Pure move from PosCheckoutDialogSections; the dialog keeps all state.

import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { CheckoutPaymentButtonAction, CheckoutPaymentRegion } from '@/features/pos/components/pos-workspace/pos-checkout-shortcuts';
import type { PaymentPreset } from '@/features/pos/types/pos.types';
import { Button } from '@/shared/ui/button';

export function PosCheckoutPaymentMethods({
  pos,
  isMobile,
  paymentPresetButtons,
  paymentRegion,
  handlePaymentPresetButtonClick,
  onSelectPaymentPreset,
  isSplitActive,
  activeLegsCount,
  isCodUnpaid,
  transferSelected,
  isKwdStore,
  isKsaStore,
  isCreditSale,
  cardVal,
  transferVal,
  totalAmount,
  cashVal,
  quickCashDenominations,
}: {
  pos: PosWorkspaceState;
  isMobile: boolean;
  paymentPresetButtons: Array<{
    action: CheckoutPaymentButtonAction;
    label: string;
    active: boolean;
    splitStyle: { background: string; border: string; color: string; fontWeight: number } | undefined;
    fontSize: string;
  }>
  paymentRegion: CheckoutPaymentRegion;
  handlePaymentPresetButtonClick: (action: CheckoutPaymentButtonAction) => void;
  onSelectPaymentPreset: (preset: PaymentPreset) => void;
  isSplitActive: boolean;
  activeLegsCount: number;
  isCodUnpaid: boolean;
  transferSelected: boolean;
  isKwdStore: boolean;
  isKsaStore: boolean;
  isCreditSale: boolean;
  cardVal: number;
  transferVal: number;
  totalAmount: number;
  cashVal: number;
  quickCashDenominations: number[];
}) {
  return (
    <>
      {/* Step 1: Payment method buttons (Strict Country Isolation) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
        <div
          className="pos-checkout-payment-card-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            height: '26px',
            minHeight: '26px',
            maxHeight: '26px',
            overflow: 'hidden',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <span style={{ width: '3px', height: '13px', background: '#170e5e', borderRadius: '1px', display: 'inline-block' }} />
            طريقة الدفع والتحصيل
          </span>
          {isSplitActive ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: '22px', lineHeight: 1, fontSize: '11px', fontWeight: 700, color: '#170e5e', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '0 8px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0, boxSizing: 'border-box' }}>
              دفع مقسّم ({activeLegsCount} طرق)
            </span>
          ) : isCodUnpaid ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: '22px', lineHeight: 1, fontSize: '11px', fontWeight: 700, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '0 8px', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0, boxSizing: 'border-box' }}>
              تحصيل عند التسليم
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : `repeat(${paymentPresetButtons.length}, minmax(0, 1fr))`,
            gap: '6px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {paymentPresetButtons.map(({ action, label, active, splitStyle, fontSize }) => (
            <Button
              key={`${paymentRegion}-${action.slot}`}
              type="button"
              variant={active ? 'primary' : 'secondary'}
              aria-keyshortcuts={action.shortcutLabel}
              title={`${label} (${action.shortcutLabel})`}
              onClick={() => handlePaymentPresetButtonClick(action)}
              style={{
                height: '36px',
                minHeight: '36px',
                maxHeight: '36px',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                padding: '0 6px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontSize,
                fontWeight: 700,
                ...(splitStyle || undefined),
              }}
            >
              {label}
              {!isMobile && (
                <kbd
                  aria-hidden="true"
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    lineHeight: 1.15,
                    padding: '1px 4px',
                    borderRadius: '4px',
                    fontFamily: 'inherit',
                    flexShrink: 0,
                    border: active ? '1px solid rgba(255,255,255,0.38)' : '1px solid #cbd5e1',
                    background: active ? 'rgba(255,255,255,0.16)' : '#f8fafc',
                    color: active ? '#ffffff' : '#64748b',
                  }}
                >
                  {action.shortcutLabel}
                </kbd>
              )}
            </Button>
          ))}
        </div>

        {/* Fixed-height Sub-Slot: prevents any vertical layout jump when switching payment methods */}
        <div
          className="pos-checkout-payment-subslot"
          style={{
            height: '38px',
            minHeight: '38px',
            maxHeight: '38px',
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            overflow: 'hidden',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          {transferSelected ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', width: '100%', height: '36px', boxSizing: 'border-box' }}>
              {isKwdStore ? (
                <>
                  <Button type="button" variant={pos.paymentChannel !== 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '11.5px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    رابط دفع K-NET
                  </Button>
                  <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '11.5px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    Apple Pay / محفظة
                  </Button>
                </>
              ) : isKsaStore ? (
                <>
                  <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '11.5px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    STC Pay / محفظة
                  </Button>
                  <Button type="button" variant={pos.paymentChannel !== 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '11.5px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    Apple Pay / سداد
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant={pos.paymentChannel !== 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '12px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    InstaPay
                  </Button>
                  <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ height: '36px', minHeight: '36px', maxHeight: '36px', fontSize: '12px', fontWeight: 700, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
                    محافظ إلكترونية
                  </Button>
                </>
              )}
            </div>
          ) : !isCreditSale && cardVal === 0 && transferVal === 0 && totalAmount > 0 && !isCodUnpaid ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                width: '100%',
                height: '36px',
                minHeight: '36px',
                maxHeight: '36px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '0 8px',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
                المستلم:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', justifyContent: 'flex-end', minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => pos.setCashAmount(totalAmount)}
                  style={{
                    height: '26px',
                    lineHeight: 1,
                    padding: '0 8px',
                    borderRadius: '5px',
                    border: Math.abs(cashVal - totalAmount) < 0.001 ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                    background: Math.abs(cashVal - totalAmount) < 0.001 ? '#eef2ff' : '#ffffff',
                    color: Math.abs(cashVal - totalAmount) < 0.001 ? '#170e5e' : '#334155',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  بالضبط ({totalAmount})
                </button>
                {quickCashDenominations.map((denom) => {
                  const isSelected = Math.abs(cashVal - denom) < 0.001;
                  return (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => pos.setCashAmount(denom)}
                      style={{
                        height: '26px',
                        lineHeight: 1,
                        padding: '0 9px',
                        borderRadius: '5px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                        background: isSelected ? '#eef2ff' : '#ffffff',
                        color: isSelected ? '#170e5e' : '#0f172a',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        boxSizing: 'border-box',
                      }}
                    >
                      {denom}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                width: '100%',
                height: '36px',
                minHeight: '36px',
                maxHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '0 10px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#475569',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ display: 'block', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isSplitActive
                  ? `دفع مقسّم (${activeLegsCount} طرق): عدّل المبالغ أدناه أو اختر طريقة للتحويل الكامل.`
                  : isCreditSale
                  ? 'البيع الآجل: يُسجّل كامل الإجمالي على حساب العميل.'
                  : isCodUnpaid
                  ? 'تحصيل عند التسليم: لا يُسجّل نقد الآن ويحصّل المندوب عند التوصيل.'
                  : 'الدفع بالبطاقة: المبلغ محدد في خانة البطاقة.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
