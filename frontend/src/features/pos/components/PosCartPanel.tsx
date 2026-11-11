import { useTranslation } from 'react-i18next';
import { memo } from 'react';
import { Card } from '@/shared/ui/card';
import { PosCartMetaForm } from '@/features/pos/components/pos-cart-panel/PosCartMetaForm';
import { PosCartPaymentSection } from '@/features/pos/components/pos-cart-panel/PosCartPaymentSection';
import { PosCartItemsList } from '@/features/pos/components/pos-cart-panel/PosCartItemsList';
import { PosCartFooter } from '@/features/pos/components/pos-cart-panel/PosCartFooter';
import { getAlertMessages } from '@/features/pos/components/pos-cart-panel/posCartPanel.helpers';
import type { HeldPosDraftSummary, PosCartPanelProps } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

export type { HeldPosDraftSummary, PosCartPanelProps };

function PosCartPanelComponent(props: PosCartPanelProps) {
  const { t } = useTranslation();
  const alertMessages = getAlertMessages(props);

  return (
    <Card
      className={`workspace-panel pos-checkout-card pos-checkout-card-compact pos-checkout-card-mode-${props.posMode}`.trim()}
    >
      <div className="pos-checkout-static">
        {props.showMetaSection !== false || props.showPaymentSection !== false ? (
          <div className="pos-checkout-top-strip">
            {props.showMetaSection === false ? null : <PosCartMetaForm {...props} />}
            {props.showPaymentSection === false ? null : <PosCartPaymentSection {...props} />}
          </div>
        ) : null}

        {alertMessages.length ? (
          <div
            className="pos-inline-alert-bar"
            role="status"
            aria-live="polite"
            title={`${t('pos.pos_cart_panel.s0', "راجع قبل الإتمام:")} ${alertMessages.join(' · ')}`}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <strong style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {t('pos.pos_cart_panel.s0', "راجع قبل الإتمام:")}
            </strong>
            <span
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {alertMessages.join(' · ')}
            </span>
          </div>
        ) : null}
      </div>

      <div className="pos-checkout-scroll">
        <div className="pos-checkout-body">
          <PosCartItemsList {...props} onNavigateToProducts={props.onNavigateToProducts} />
          <PosCartFooter {...props} />
        </div>
      </div>
    </Card>
  );
}

function arePropsEqual(prev: PosCartPanelProps, next: PosCartPanelProps) {
  return prev.cart === next.cart
    && prev.customers === next.customers
    && prev.branches === next.branches
    && prev.locations === next.locations
    && prev.customerId === next.customerId
    && prev.branchId === next.branchId
    && prev.locationId === next.locationId
    && prev.paymentType === next.paymentType
    && prev.paymentChannel === next.paymentChannel
    && prev.paidAmount === next.paidAmount
    && prev.cashAmount === next.cashAmount
    && prev.cardAmount === next.cardAmount
    && prev.transferAmount === next.transferAmount
    && prev.discount === next.discount
    && prev.note === next.note
    && prev.submitMessage === next.submitMessage
    && prev.lastSaleDocNo === next.lastSaleDocNo
    && prev.canShowLastSaleActions === next.canShowLastSaleActions
    && prev.quickCustomerName === next.quickCustomerName
    && prev.quickCustomerPhone === next.quickCustomerPhone
    && prev.isQuickCustomerPending === next.isQuickCustomerPending
    && prev.heldDrafts === next.heldDrafts
    && prev.isError === next.isError
    && prev.isPending === next.isPending
    && prev.totals === next.totals
    && prev.changeAmount === next.changeAmount
    && prev.amountDue === next.amountDue
    && prev.hasOpenShift === next.hasOpenShift
    && prev.canApplyDiscount === next.canApplyDiscount
    && prev.discountApprovalGranted === next.discountApprovalGranted
    && prev.isDiscountAuthorizationPending === next.isDiscountAuthorizationPending
    && prev.hasDiscountPermissionViolation === next.hasDiscountPermissionViolation
    && prev.adminDiscountWarning === next.adminDiscountWarning
    && prev.hasPricePermissionViolation === next.hasPricePermissionViolation
    && prev.allowNegativeStockSales === next.allowNegativeStockSales
    && prev.canSubmitSale === next.canSubmitSale
    && prev.canSubmitHint === next.canSubmitHint
    && prev.lastAddedLineKey === next.lastAddedLineKey
    && prev.selectedLineKey === next.selectedLineKey
    && prev.posMode === next.posMode
    && prev.showPaymentSection === next.showPaymentSection
    && prev.showMetaSection === next.showMetaSection
    && prev.showHeldDraftsInline === next.showHeldDraftsInline;
}

export const PosCartPanel = memo(PosCartPanelComponent, arePropsEqual);
