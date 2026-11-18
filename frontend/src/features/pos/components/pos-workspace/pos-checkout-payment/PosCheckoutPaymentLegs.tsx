// Step 2 payment legs — the three dedicated scalar inputs (cash, card,
// transfer), each bound only to its own state setter. Pure move; the
// dialog keeps all state and mounts this component with the leg values
// and their refs.

import type { RefObject } from 'react';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

export function PosCheckoutPaymentLegs({
  isMobile,
  cashVal,
  isCreditSale,
  remainingUnpaid,
  pos,
  cashAmountInputRef,
  customerPickerOpen,
  cardVal,
  isKwdStore,
  isKsaStore,
  isTerminalApproved,
  cardAmountInputRef,
  transferVal,
  transferAmountInputRef,
}: {
  isMobile: boolean;
  cashVal: number;
  isCreditSale: boolean;
  remainingUnpaid: number;
  pos: PosWorkspaceState;
  cashAmountInputRef: RefObject<HTMLInputElement | null>;
  customerPickerOpen: boolean;
  cardVal: number;
  isKwdStore: boolean;
  isKsaStore: boolean;
  isTerminalApproved: boolean;
  cardAmountInputRef: RefObject<HTMLInputElement | null> | undefined;
  transferVal: number;
  transferAmountInputRef: RefObject<HTMLInputElement | null> | undefined;
}) {
  return (
    <>
      {/* Step 2: Three Clean ERP Payment Inputs (No double boxes, No Spinners)
       * SPICE-PKG8 (INV-THREE-WAY-PAYMENT-SPLIT): each leg has its own
       * dedicated scalar input bound only to its own state setter. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Cash Leg */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', height: '20px', minHeight: '20px', maxHeight: '20px', overflow: 'hidden', boxSizing: 'border-box' }}>
            <label
              htmlFor="pos-checkout-cash-input"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: cashVal > 0 && !isCreditSale ? '#170e5e' : '#475569',
                margin: 0,
                cursor: isCreditSale ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              نقدي
            </label>
            {!isCreditSale && remainingUnpaid > 0 && cashVal === 0 && (
              <button
                type="button"
                onClick={() => pos.setCashAmount(remainingUnpaid)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#170e5e',
                  borderRadius: '4px',
                  height: '18px',
                  lineHeight: 1,
                  padding: '0 6px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                + {remainingUnpaid}
              </button>
            )}
          </div>
          <input
            id="pos-checkout-cash-input"
            ref={cashAmountInputRef}
            data-autofocus={!customerPickerOpen && !isCreditSale ? true : undefined}
            className="no-spin-arrows"
            type="number"
            step="0.01"
            min="0"
            value={pos.cashAmount}
            disabled={isCreditSale}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => pos.setCashAmount(Number(event.target.value || 0))}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: '36px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 800,
              border: cashVal > 0 && !isCreditSale ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: isCreditSale ? '#f1f5f9' : '#ffffff',
              color: isCreditSale ? '#94a3b8' : '#0f172a',
              textAlign: 'center',
            }}
          />
        </div>

        {/* Card Leg */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', height: '20px', minHeight: '20px', maxHeight: '20px', overflow: 'hidden', boxSizing: 'border-box' }}>
            <label
              htmlFor="pos-checkout-card-input"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: cardVal > 0 && !isCreditSale ? '#170e5e' : '#475569',
                margin: 0,
                cursor: isCreditSale ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {(isKwdStore && pos.terminalPaymentDetails?.cardScheme === 'knet'
                ? 'كي نت K-NET'
                : isKsaStore && pos.terminalPaymentDetails?.cardScheme === 'mada'
                ? 'مدى mada'
                : 'فيزا / كارت')}
            </label>
            {!isCreditSale && !isTerminalApproved && remainingUnpaid > 0 && cardVal === 0 && (
              <button
                type="button"
                onClick={() => pos.setCardAmount(remainingUnpaid)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#170e5e',
                  borderRadius: '4px',
                  height: '18px',
                  lineHeight: 1,
                  padding: '0 6px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                + {remainingUnpaid}
              </button>
            )}
          </div>
          <input
            id="pos-checkout-card-input"
            ref={cardAmountInputRef}
            className="no-spin-arrows"
            type="number"
            step="0.01"
            min="0"
            value={pos.cardAmount}
            disabled={isCreditSale || isTerminalApproved}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => pos.setCardAmount(Number(event.target.value || 0))}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: '36px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 800,
              border: cardVal > 0 && !isCreditSale ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: isCreditSale || isTerminalApproved ? '#f1f5f9' : '#ffffff',
              color: isCreditSale ? '#94a3b8' : '#0f172a',
              textAlign: 'center',
            }}
          />
        </div>

        {/* Transfer / Wallet Leg */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', height: '20px', minHeight: '20px', maxHeight: '20px', overflow: 'hidden', boxSizing: 'border-box' }}>
            <label
              htmlFor="pos-checkout-transfer-input"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: transferVal > 0 && !isCreditSale ? '#170e5e' : '#475569',
                margin: 0,
                cursor: isCreditSale ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {pos.paymentChannel === 'instapay'
                ? (isKwdStore ? 'رابط دفع' : 'InstaPay')
                : pos.paymentChannel === 'wallet'
                ? (isKwdStore ? 'محفظة رقمية' : 'محافظ إلكترونية')
                : (isKwdStore ? 'محفظة رقمية' : 'محافظ / InstaPay')}
            </label>
            {!isCreditSale && remainingUnpaid > 0 && transferVal === 0 && (
              <button
                type="button"
                onClick={() => pos.setTransferAmount(remainingUnpaid)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#170e5e',
                  borderRadius: '4px',
                  height: '18px',
                  lineHeight: 1,
                  padding: '0 6px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                + {remainingUnpaid}
              </button>
            )}
          </div>
          <input
            id="pos-checkout-transfer-input"
            ref={transferAmountInputRef}
            className="no-spin-arrows"
            type="number"
            step="0.01"
            min="0"
            value={pos.transferAmount}
            disabled={isCreditSale}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(event) => pos.setTransferAmount(Number(event.target.value || 0))}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              height: '36px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 800,
              border: transferVal > 0 && !isCreditSale ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: isCreditSale ? '#f1f5f9' : '#ffffff',
              color: isCreditSale ? '#94a3b8' : '#0f172a',
              textAlign: 'center',
            }}
          />
        </div>
      </div>
    </>
  );
}
