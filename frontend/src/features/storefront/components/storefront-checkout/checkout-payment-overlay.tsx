import type { Dispatch, SetStateAction } from 'react';
import type { CreateOnlineOrderResponse, StorefrontPaymentSessionResponse } from '../../types/storefront.types';
import { StorefrontOnlinePaymentModal } from '../StorefrontOnlinePaymentModal';

/**
 * Checkout payment overlay (file #42 S12) — pure move of the online-payment
 * gateway overlay from StorefrontCheckoutModal.tsx (pristine L2406–2422).
 * Props restore the pristine typing exactly (file #39 lesson): no `any[]`.
 * No hooks are used in this span — no `t`/`isEn`/`dir` (prep §3's generic
 * "S3–S12 use useTranslation + useStorefrontLang" is WRONG for S12: 0 uses
 * of either, grep/AST-verified). No icons are used in this span either.
 * Deviations from prep (AST/grep evidence, #41 S1 precedent):
 * - Prep §2's span "L2406–2425 (20L)" is WRONG: L2423 `</div>` closes the
 *   S2 backdrop and L2424 `);` closes `checkoutModalContent`; both stay in
 *   the facade (same boundary class as S3/S7/S8/S11). True span L2406–2422
 *   (17L); L2405 blank stays per the trailing-blank rule.
 * - Prep §4's S12 prop list is CORRECT on AST evidence (all 7 props used,
 *   no more, no fewer): paymentSession, createdOrderForPayment, tenantSlug,
 *   handleOnlinePaymentSuccess, onOrderSuccess, setPaymentSession,
 *   setCreatedOrderForPayment.
 * Placement (S2's verified note, confirmed by AST here): the overlay is a
 * child of the BACKDROP div, not the container — in the merged tree it sits
 * inside the shell mount's {children} (S2 removed the container close L2404
 * and the backdrop close L2423, replacing the latter with
 * </StorefrontCheckoutShell>). It renders via createPortal(..., document.body)
 * in the facade's return, so DOM output is identical; React-tree click
 * bubbling is equivalent (container stopPropagation vs backdrop
 * target === currentTarget check — both no-ops for portal clicks). The portal
 * call itself stays in the facade and is preserved byte-identical.
 * The span is a section comment + one JSX expression, i.e. two top-level
 * nodes, so it is wrapped in <>...</> (the S4/S8 fragment pattern); the span
 * itself is untouched, zero re-indentation.
 */
export interface CheckoutPaymentOverlayProps {
  paymentSession: StorefrontPaymentSessionResponse | null;
  createdOrderForPayment: CreateOnlineOrderResponse | null;
  tenantSlug?: string;
  handleOnlinePaymentSuccess: (paymentInfo: { orderNumber: string; transactionId: string }) => void;
  onOrderSuccess?: (orderData: CreateOnlineOrderResponse) => void;
  setPaymentSession: Dispatch<SetStateAction<StorefrontPaymentSessionResponse | null>>;
  setCreatedOrderForPayment: Dispatch<SetStateAction<CreateOnlineOrderResponse | null>>;
}

export function CheckoutPaymentOverlay({
  paymentSession,
  createdOrderForPayment,
  tenantSlug,
  handleOnlinePaymentSuccess,
  onOrderSuccess,
  setPaymentSession,
  setCreatedOrderForPayment,
}: CheckoutPaymentOverlayProps) {
  return (
    <>
    {/* Online Payment Gateway Overlay */}
    {paymentSession && createdOrderForPayment && tenantSlug && (
      <StorefrontOnlinePaymentModal
        isOpen={Boolean(paymentSession)}
        session={paymentSession}
        orderData={createdOrderForPayment}
        tenantSlug={tenantSlug}
        onSuccess={handleOnlinePaymentSuccess}
        onClose={() => {
          if (createdOrderForPayment && onOrderSuccess) {
            onOrderSuccess(createdOrderForPayment);
          }
          setPaymentSession(null);
          setCreatedOrderForPayment(null);
        }}
      />
    )}
    </>
  );
}
