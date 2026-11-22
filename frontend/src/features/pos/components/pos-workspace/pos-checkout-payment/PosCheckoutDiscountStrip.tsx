// Step 3 discount strip — amount + percent inputs and the manager-approval
// button. Pure move; the dialog keeps all state and mounts this component
// with the discount values and callbacks.

import type { Dispatch, SetStateAction } from 'react';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import { type MoneyDigits } from '@/shared/utils/money';
import { calcInvoiceDiscountAmountFromPercent, calcInvoiceDiscountPercent } from '@/features/pos/lib/pos-cart-totals';
import { Button } from '@/shared/ui/button';

interface PosCheckoutDiscountStripProps {
  isDiscountLocked: boolean;
  isMobile: boolean;
  pos: PosWorkspaceState;
  isTerminalApproved: boolean;
  isPercentFocused: boolean;
  percentStr: string;
  setIsPercentFocused: Dispatch<SetStateAction<boolean>>;
  setPercentStr: Dispatch<SetStateAction<string>>;
  bookDigits: MoneyDigits;
  onManagerPinErrorChange: (value: string) => void;
  onManagerPinDraftChange: (value: string) => void;
  onManagerApprovalOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
}

export function PosCheckoutDiscountStrip({
  isDiscountLocked,
  isMobile,
  pos,
  isTerminalApproved,
  isPercentFocused,
  percentStr,
  setIsPercentFocused,
  setPercentStr,
  bookDigits,
  onManagerPinErrorChange,
  onManagerPinDraftChange,
  onManagerApprovalOpenChange,
}: PosCheckoutDiscountStripProps) {
  /* F1b (van trial problem 20): the "%" input is a percent of the NET
   * subtotal (gross minus line discounts) — the backend's stored
   * subtotal — never of the gross. 4% on gross 100.00 with a 4.00 line
   * discount is 3.84, not 4.00. */
  const discountBase = pos.totals.netSubTotal ?? pos.totals.subTotal;
  return (
    <>
      {/* Step 3: Dedicated Discount Strip (Cleanly separated from payment legs) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isDiscountLocked
            ? (isMobile ? 'repeat(2, minmax(0, 1fr))' : '1fr 1fr auto')
            : 'repeat(2, minmax(0, 1fr))',
          gap: '8px',
          alignItems: 'end',
          paddingTop: '6px',
          borderTop: '1px solid #e2e8f0',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>الخصم (مبلغ)</span>
          <input
            className="no-spin-arrows"
            type="number"
            step="0.01"
            min="0"
            value={pos.discount === 0 ? '' : pos.discount}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => pos.setDiscount(Number(event.target.value || 0))}
            disabled={isDiscountLocked || isTerminalApproved}
            placeholder="0"
            style={{ boxSizing: 'border-box', width: '100%', height: '34px', borderRadius: '6px', fontSize: '13.5px', fontWeight: 700, border: '1px solid #cbd5e1', background: (isDiscountLocked || isTerminalApproved) ? '#f1f5f9' : '#ffffff', textAlign: 'center' }}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>الخصم (%)</span>
          <input
            className="no-spin-arrows"
            type="number"
            step="0.01"
            min="0"
            value={isPercentFocused ? percentStr : (pos.discount > 0 && discountBase > 0 ? calcInvoiceDiscountPercent(pos.discount, discountBase).toFixed(2).replace(/\.00$/, '') : '')}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => { setIsPercentFocused(true); e.currentTarget.select(); }}
            onBlur={() => setIsPercentFocused(false)}
            onChange={(event) => {
              setPercentStr(event.target.value);
              const p = Number(event.target.value || 0);
              pos.setDiscount(calcInvoiceDiscountAmountFromPercent(p, discountBase, bookDigits));
            }}
            disabled={isDiscountLocked || isTerminalApproved || discountBase === 0}
            placeholder="0"
            style={{ boxSizing: 'border-box', width: '100%', height: '34px', borderRadius: '6px', fontSize: '13.5px', fontWeight: 700, border: '1px solid #cbd5e1', background: (isDiscountLocked || isTerminalApproved || discountBase === 0) ? '#f1f5f9' : '#ffffff', textAlign: 'center' }}
          />
        </label>
        {isDiscountLocked ? (
          <Button
            type="button"
            variant={pos.discountApprovalGranted ? 'success' : 'secondary'}
            onClick={() => {
              if (pos.discountApprovalGranted) return;
              onManagerPinErrorChange('');
              onManagerPinDraftChange('');
              onManagerApprovalOpenChange((current) => !current);
            }}
            disabled={pos.discountAuthorizationMutation.isPending}
            style={{ height: '34px', alignSelf: 'end', fontSize: '12px', gridColumn: isMobile ? '1 / -1' : undefined }}
          >
            {pos.discountAuthorizationMutation.isPending ? 'جاري...' : (pos.discountApprovalGranted ? 'معتمد' : 'اعتماد المدير')}
          </Button>
        ) : null}
      </div>
    </>
  );
}
