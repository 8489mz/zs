// Payment summary — the three money chips (total due / paid / remaining)
// plus the bottom discount-permission notes. Pure move; the dialog keeps
// all state and mounts this component with the computed amounts.

import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { BalanceState } from '@/features/pos/lib/pos-balance-state';
import { formatCurrency } from '@/lib/format';

interface PosCheckoutPaymentSummaryProps {
  isMobile: boolean;
  pos: PosWorkspaceState;
  paidAmount: number;
  balance: BalanceState;
}

export function PosCheckoutPaymentSummary({
  isMobile,
  pos,
  paidAmount,
  balance,
}: PosCheckoutPaymentSummaryProps) {
  return (
    <>
      {/* Summary 3-Column Chips: Centered, Enlarged, and Anchored at Bottom */}
      <div
        className="pos-checkout-money-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: isMobile ? '6px' : '10px',
          width: '100%',
          marginTop: isMobile ? '0' : 'auto',
          paddingTop: isMobile ? '0' : '4px',
          boxSizing: 'border-box',
        }}
      >
        <div
          className="pos-checkout-dialog-chip"
          style={{
            minHeight: isMobile ? '48px' : '62px',
            padding: isMobile ? '6px 8px' : '8px 12px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            boxShadow: 'none',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: isMobile ? '11px' : '12px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap', textAlign: 'center' }}>المطلوب دفعه</span>
          <strong className="is-primary" style={{ fontSize: isMobile ? '15px' : '19px', fontWeight: 900, fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(pos.totals.total)}</strong>
        </div>
        <div
          className="pos-checkout-dialog-chip"
          style={{
            minHeight: isMobile ? '48px' : '62px',
            padding: isMobile ? '6px 8px' : '8px 12px',
            borderRadius: '8px',
            border: paidAmount > 0 ? '1px solid #bbf7d0' : '1px solid #cbd5e1',
            background: paidAmount > 0 ? '#f0fdf4' : '#f8fafc',
            boxShadow: 'none',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: isMobile ? '11px' : '12px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap', textAlign: 'center' }}>المدفوع</span>
          <strong className="is-success" style={{ fontSize: isMobile ? '15px' : '19px', fontWeight: 900, fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(paidAmount)}</strong>
        </div>
        <div
          className="pos-checkout-dialog-chip"
          style={{
            minHeight: isMobile ? '48px' : '62px',
            padding: isMobile ? '6px 8px' : '8px 12px',
            borderRadius: '8px',
            border: balance.tone === 'danger' ? '1px solid #fca5a5' : Number(pos.changeAmount || 0) > 0 ? '1px solid #86efac' : '1px solid #cbd5e1',
            boxShadow: 'none',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            minWidth: 0,
            background: balance.tone === 'danger' ? '#fef2f2' : Number(pos.changeAmount || 0) > 0 ? '#f0fdf4' : '#f8fafc',
          }}
        >
          <span style={{ fontSize: isMobile ? '11px' : '12px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap', textAlign: 'center' }}>{balance.label}</span>
          <strong className={balance.tone === 'danger' ? 'is-danger' : Number(pos.changeAmount || 0) > 0 ? 'is-success' : 'is-primary'} style={{ fontSize: isMobile ? '15px' : '19px', fontWeight: 900, fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(balance.value)}</strong>
        </div>
      </div>

      {!pos.canApplyDiscount ? <div className="pos-payment-strip-notes" style={{ margin: 0 }}><span className="pos-payment-strip-note">{pos.discountApprovalGranted ? 'تم اعتماد الخصم لهذه الفاتورة فقط.' : 'لا تملك صلاحية تعديل الخصم. استخدم اعتماد المدير لهذه الفاتورة.'}</span></div> : null}
      {pos.hasDiscountPermissionViolation ? <div className="error-box" style={{ margin: 0, textAlign: 'center' }}>تم اكتشاف خصم غير مسموح به في هذه الفاتورة.</div> : null}
    </>
  );
}
