// Approval + service charge + tip — the manager-approval PIN form, the
// restaurant service-charge line, and the tip selector with its IIFE.
// Pure move; the dialog keeps all state and mounts this component
// with the approval values and callbacks.

import type { FormEvent, RefObject } from 'react';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';

interface PosCheckoutApprovalChargesTipProps {
  managerApprovalOpen: boolean;
  isDiscountLocked: boolean;
  pos: PosWorkspaceState;
  onInlineManagerApproval: (event?: FormEvent<HTMLFormElement>) => void;
  managerPinInputRef: RefObject<HTMLInputElement | null>;
  managerPinDraft: string;
  onManagerPinDraftChange: (value: string) => void;
  managerPinError: string;
  onManagerPinErrorChange: (value: string) => void;
  onManagerApprovalOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  approvedManagerPinRef: RefObject<string>;
  isRestaurant: boolean;
  isMobile: boolean;
  isKwdStore: boolean;
  isKsaStore: boolean;
  isTerminalApproved: boolean;
  bookDigits: MoneyDigits;
}

export function PosCheckoutApprovalChargesTip({
  managerApprovalOpen,
  isDiscountLocked,
  pos,
  onInlineManagerApproval,
  managerPinInputRef,
  managerPinDraft,
  onManagerPinDraftChange,
  managerPinError,
  onManagerPinErrorChange,
  onManagerApprovalOpenChange,
  approvedManagerPinRef,
  isRestaurant,
  isMobile,
  isKwdStore,
  isKsaStore,
  isTerminalApproved,
  bookDigits,
}: PosCheckoutApprovalChargesTipProps) {
  return (
    <>
      {managerApprovalOpen && isDiscountLocked && !pos.discountApprovalGranted ? (
        <div className="pos-checkout-manager-approval" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onInlineManagerApproval(); } }}>
          <label className="field field-wide"><span>رمز اعتماد المدير أو كلمة مرور المدير</span><input ref={managerPinInputRef} type="text" className="secure-password-field" inputMode="numeric" autoComplete="off" value={managerPinDraft} onChange={(event) => { onManagerPinDraftChange(event.target.value); if (managerPinError) onManagerPinErrorChange(''); }} placeholder="أدخل رمز اعتماد المدير أو كلمة مرور المدير" disabled={pos.discountAuthorizationMutation.isPending} /></label>
          <div className="surface-note">يُستخدم PIN للتحقق فقط داخل هذه الفاتورة، ثم يتم مسحه ولا يُحفظ في المسودة.</div>
          {managerPinError ? <div className="error-box">{managerPinError}</div> : null}
          <div className="actions compact-actions">
            <Button type="button" disabled={pos.discountAuthorizationMutation.isPending} onClick={() => onInlineManagerApproval()}>{pos.discountAuthorizationMutation.isPending ? 'جاري التحقق...' : 'اعتماد الخصم'}</Button>
            <Button type="button" variant="secondary" onClick={() => { onManagerApprovalOpenChange(false); onManagerPinDraftChange(''); onManagerPinErrorChange(''); approvedManagerPinRef.current = ''; }} disabled={pos.discountAuthorizationMutation.isPending}>إلغاء</Button>
          </div>
        </div>
      ) : null}

      {isRestaurant && Number(pos.totals.serviceCharge || 0) > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '5px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
          <span>رسوم خدمة الصالة ({pos.totals.serviceChargePercent}%):</span>
          <strong style={{ color: '#170e5e' }}>{formatCurrency(pos.totals.serviceCharge)}</strong>
        </div>
      )}

      {/* Gratuity / Tip Selector (Restaurants Only) */}
      {isRestaurant && (
        <div
          className="pos-checkout-tip-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            padding: isMobile ? '5px 8px' : '0 8px',
            height: isMobile ? undefined : '36px',
            minHeight: isMobile ? undefined : '36px',
            maxHeight: isMobile ? undefined : '36px',
            gap: '4px',
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            overflow: isMobile ? 'visible' : 'hidden',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
              إكرامية:
            </span>
            {Number(pos.tipAmount || 0) > 0 ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', height: '20px', lineHeight: 1, background: '#eef2ff', color: '#170e5e', padding: '0 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>
                +{formatCurrency(pos.tipAmount)}
              </span>
            ) : null}
          </div>
          {(() => {
            const tipPresets = isKwdStore
              ? [0, 0.25, 0.5, 1, 2]
              : isKsaStore
              ? [0, 5, 10, 15, 20]
              : [0, 5, 10, 20, 50];
            const tipStep = isKwdStore ? '0.050' : '1';
            const tipUnit = isKwdStore ? 'د.ك' : isKsaStore ? 'ر.س' : 'ج.م';
            const applyTipChange = (nextTip: number) => {
              // INV-REST-PAID-GATES-2 (R4-D, I40): a tip change after
              // approval would bump the card leg past the approved
              // amount — frozen while the approval is live.
              if (isTerminalApproved) return;
              const prevTip = Number(pos.tipAmount || 0);
              const diff = nextTip - prevTip;
              pos.setTipAmount?.(nextTip);
              if (Math.abs(diff) < 0.0001) return;

              // Automatically adjust the active payment amount to keep paidAmount aligned with the new total
              if (pos.paymentChannel === 'card' || (!pos.cashAmount && pos.cardAmount > 0)) {
                pos.setCardAmount(Math.max(0, roundMoneyValue((pos.cardAmount || 0) + diff, bookDigits)));
              } else if (pos.paymentChannel === 'cash' || (pos.cashAmount > 0 && !pos.cardAmount)) {
                pos.setCashAmount(Math.max(0, roundMoneyValue((pos.cashAmount || 0) + diff, bookDigits)));
              } else if (pos.paymentChannel === 'wallet' || pos.paymentChannel === 'instapay') {
                pos.setTransferAmount(Math.max(0, roundMoneyValue((pos.transferAmount || 0) + diff, bookDigits)));
              }
            };
            return (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                {tipPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyTipChange(preset)}
                    disabled={isTerminalApproved}
                    style={{
                      height: '24px',
                      lineHeight: 1,
                      padding: '0 7px',
                      borderRadius: '4px',
                      border: (pos.tipAmount || 0) === preset ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: (pos.tipAmount || 0) === preset ? '#170e5e' : '#ffffff',
                      color: (pos.tipAmount || 0) === preset ? '#ffffff' : '#334155',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      boxSizing: 'border-box',
                    }}
                  >
                    {preset === 0
                      ? 'بدون'
                      : isKwdStore
                      ? (preset === 0.25 ? '¼ د.ك' : preset === 0.5 ? '½ د.ك' : `${preset} د.ك`)
                      : `${preset} ${tipUnit}`}
                  </button>
                ))}
                <input
                  className="no-spin-arrows pos-checkout-tip-custom-input"
                  type="number"
                  min="0"
                  step={tipStep}
                  value={pos.tipAmount || ''}
                  onWheel={(e) => e.currentTarget.blur()}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => applyTipChange(Math.max(0, Number(e.target.value || 0)))}
                  disabled={isTerminalApproved}
                  placeholder="مخصص"
                  style={{
                    width: isKwdStore ? '64px' : '54px',
                    height: '24px',
                    borderRadius: '4px',
                    border: Number(pos.tipAmount || 0) > 0 && !tipPresets.includes(Number(pos.tipAmount || 0))
                      ? '1.5px solid #170e5e'
                      : '1.5px solid #cbd5e1',
                    textAlign: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#0f172a',
                    background: Number(pos.tipAmount || 0) > 0 && !tipPresets.includes(Number(pos.tipAmount || 0))
                      ? '#eef2ff'
                      : '#ffffff',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}
