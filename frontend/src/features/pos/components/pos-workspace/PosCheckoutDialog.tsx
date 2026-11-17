import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { getErrorMessage } from '@/lib/errors';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import {
  PosCheckoutCustomerSection,
  PosCheckoutOrderTypeSection,
  PosCheckoutPaymentSection,
  PosCheckoutDeliverySection,
  type PaymentPreset,
} from '@/features/pos/components/pos-workspace/PosCheckoutDialogSections';
import { PosCheckoutExpressSection, type PosCheckoutExpressShortcutHandlers } from './PosCheckoutExpressSection';
import {
  getCheckoutPaymentRegion,
  parseCheckoutAltDigit,
  resolveCheckoutActionForSlot,
  resolveInitialCheckoutPreset,
  resolvePresetForCheckoutAction,
  type CheckoutPaymentButtonAction,
} from './pos-checkout-shortcuts';
import { canChangePaymentAfterTerminalApproval } from './pos-terminal-charge-safety';
import { PosCreditLimitNotice } from './PosCreditLimitNotice';
import { PosTotalsBreakdown } from '@/features/pos/components/pos-cart-panel/PosTotalsBreakdown';
import { summarizeCartQuantities } from '@/features/pos/lib/pos.domain';
import { toast } from '@/shared/components/system-alert';
import { usePosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';
import { isKuwait, isSaudi } from '@/lib/currencies';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { isStandalonePosTerminal } from '@/features/pos/lib/pos-shell';
import { CheckIcon } from '@/shared/components/icons/AppIcons';

interface PosCheckoutDialogProps {
  open: boolean;
  pos: PosWorkspaceState;
  selectedCustomerName: string;
  onClose: () => void;
  onConfirmSale: (managerPin?: string, tenderedAmount?: number) => void;
  onOpenSplitBill?: (managerPin?: string) => void;
}

function PosCheckoutDialogContent({ open, pos, selectedCustomerName, onClose, onConfirmSale, onOpenSplitBill }: PosCheckoutDialogProps) {
  const { t } = useTranslation();
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [isManualCustomerOpen, setIsManualCustomerOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [managerApprovalOpen, setManagerApprovalOpen] = useState(false);
  const [managerPinDraft, setManagerPinDraft] = useState('');
  const [managerPinError, setManagerPinError] = useState('');
  const cashAmountInputRef = useRef<HTMLInputElement | null>(null);
  const cardAmountInputRef = useRef<HTMLInputElement | null>(null);
  const transferAmountInputRef = useRef<HTMLInputElement | null>(null);
  const expressCashInputRef = useRef<HTMLInputElement | null>(null);
  const expressShortcutActionsRef = useRef<PosCheckoutExpressShortcutHandlers | null>(null);
  const managerPinInputRef = useRef<HTMLInputElement | null>(null);
  const approvedManagerPinRef = useRef('');
  const openedOnceRef = useRef(false);
  const autoFilledOnOpenRef = useRef(false);
  const initialFocusPresetRef = useRef<PaymentPreset>('cash');
  const focusFrameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const createSalePendingRef = useRef(Boolean(pos.createSale.isPending));
  
  const isDiscountLocked = !pos.canApplyDiscount;
  const isRestaurant = pos.settingsQuery?.data?.restaurantModuleEnabled === true;

  const { customization } = usePosUiCustomization();
  const currentSettings = pos.settings || pos.settingsQuery?.data;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);
  const paymentRegion = getCheckoutPaymentRegion(isKwdStore, isKsaStore);

  const isMobile = useIsMobile(860);
  const isSmallScreen = typeof window !== 'undefined' ? window.innerWidth <= 640 : false;
  const defaultMode = pos.orderType === 'delivery' ? 'detailed'
    : customization.checkoutMode === 'express' ? 'express'
    : customization.checkoutMode === 'detailed' ? 'detailed'
    : isSmallScreen ? 'express' : 'detailed';

  const [checkoutViewMode, setCheckoutViewMode] = useState<'express' | 'detailed'>(defaultMode);

  useEffect(() => {
    if (open) {
      setCheckoutViewMode(pos.orderType === 'delivery' ? 'detailed' : defaultMode);
    }
  }, [open, defaultMode, pos.orderType]);

  useEffect(() => {
    if (pos.orderType === 'delivery' && checkoutViewMode === 'express') {
      setCheckoutViewMode('detailed');
    }
  }, [pos.orderType, checkoutViewMode]);

  const cancelScheduledFocus = useCallback(() => {
    if (focusFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledFocus, [cancelScheduledFocus]);

  const focusPaymentInputForPreset = useCallback((preset: PaymentPreset) => {
    if (typeof window === 'undefined') return;
    cancelScheduledFocus();
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (customerPickerOpen || managerApprovalOpen) return;
      if (preset === 'credit') return;
      const targetInput = preset === 'card'
        ? cardAmountInputRef.current
        : (preset === 'wallet' || preset === 'instapay')
          ? transferAmountInputRef.current
          : (cashAmountInputRef.current || (!isMobile ? expressCashInputRef.current : null));
      if (targetInput && !targetInput.disabled) {
        targetInput.focus({ preventScroll: true });
        targetInput.select();
      }
    });
  }, [cancelScheduledFocus, customerPickerOpen, isMobile, managerApprovalOpen]);

  // Smart Auto-fill payment on dialog open if no payment entered yet (runs once on open)
  useEffect(() => {
    if (!open) {
      autoFilledOnOpenRef.current = false;
      return;
    }
    if (autoFilledOnOpenRef.current) return;
    autoFilledOnOpenRef.current = true;

    const hasExistingPayment = (pos.cashAmount > 0 || pos.cardAmount > 0 || pos.transferAmount > 0) || pos.paymentType === 'credit';
    if (!hasExistingPayment && pos.totals.total > 0) {
      const initialPreset = resolveInitialCheckoutPreset(customization.defaultPaymentChannel, isKwdStore, isKsaStore);
      initialFocusPresetRef.current = initialPreset;
      pos.setPaymentPreset(initialPreset);
      if (initialPreset === 'card') {
        if (isKwdStore) {
          pos.setTerminalPaymentDetails?.({
            ...(pos.terminalPaymentDetails || {}),
            cardScheme: 'knet',
            provider: 'knet_pos',
          });
        } else if (isKsaStore) {
          pos.setTerminalPaymentDetails?.({
            ...(pos.terminalPaymentDetails || {}),
            cardScheme: 'mada',
            provider: 'geidea',
          });
        }
      }
    } else {
      initialFocusPresetRef.current = pos.paymentType === 'credit'
        ? 'credit'
        : pos.cardAmount > 0 && pos.cashAmount === 0 && pos.transferAmount === 0
          ? 'card'
          : pos.transferAmount > 0 && pos.cashAmount === 0 && pos.cardAmount === 0
            ? (pos.paymentChannel === 'wallet' ? 'wallet' : 'instapay')
            : 'cash';
    }
  }, [open, isKwdStore, isKsaStore, customization.defaultPaymentChannel, pos]);

  let deliveryRepsQuery: any = { data: [] };
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    deliveryRepsQuery = useQuery({ queryKey: ['delivery-reps'], queryFn: deliveryRepsApi.list, staleTime: 5 * 60 * 1000 });
  } catch {}

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { createSalePendingRef.current = Boolean(pos.createSale.isPending); }, [pos.createSale.isPending]);

  const stableOnClose = useCallback(() => { onCloseRef.current(); }, []);
  const clearInlineManagerApproval = useCallback(() => {
    setManagerApprovalOpen(false);
    setManagerPinDraft('');
    setManagerPinError('');
  }, []);
  const handleDialogClose = useCallback(async () => {
    if (createSalePendingRef.current) return;
    if (pos.terminalPaymentDetails?.authCode || pos.terminalPaymentDetails?.rrn) {
      toast.warning(`يوجد خصم معتمد من ماكينة الدفع (${pos.terminalPaymentDetails.authCode || pos.terminalPaymentDetails.rrn}). لا يمكن إلغاء الفاتورة قبل تسجيلها أو تسوية الدفع مع مزود الخدمة.`);
      return;
    }
    clearInlineManagerApproval();
    stableOnClose();
  }, [clearInlineManagerApproval, pos, stableOnClose]);
  const handleConfirmSale = useCallback((tenderedAmountOverride?: number) => {
    const isCod = pos.collectionStatus === 'cod';
    if (pos.orderType === 'delivery' && isCod && (!pos.deliveryRepId || Number(pos.deliveryRepId) <= 0)) {
      pos.setSubmitMessage('يرجى اختيار مندوب التوصيل لتسجيل عهدة التحصيل عليه (في حالة تحصيل من العميل).');
      return;
    }
    // INV-REST-PAID-GATES-2 (R4-D, I40): when the terminal approved an
    // amount, the card leg must still equal it at confirm time — a leg
    // edited after approval cannot post for a different amount.
    // handleSubmit re-checks the settled legs; this is the early,
    // user-facing stop (it also covers the F2 path, which calls here).
    const approvedAmount = Number(pos.terminalPaymentDetails?.approvedAmount || 0);
    if (pos.terminalPaymentDetails?.authCode && approvedAmount > 0 && Number(pos.cardAmount || 0) > 0
      && Math.abs(Number(pos.cardAmount || 0) - approvedAmount) > 0.0001) {
      pos.setSubmitMessage('المبلغ المعتمد من ماكينة الدفع لا يطابق مبلغ البطاقة. راجع المبلغ قبل تأكيد البيع.');
      return;
    }
    const managerPin = approvedManagerPinRef.current || undefined;
    const finalTendered = tenderedAmountOverride !== undefined && tenderedAmountOverride > 0
      ? tenderedAmountOverride
      : (pos.tenderedAmount && pos.tenderedAmount > 0 ? pos.tenderedAmount : undefined);
    onConfirmSale(managerPin, finalTendered);
  }, [onConfirmSale, pos]);

  const handleInlineManagerApproval = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const managerPin = String(managerPinDraft || '').trim();
    setManagerPinError('');
    if (!managerPin) {
      setManagerPinError('اكتب PIN المدير أولًا.');
      managerPinInputRef.current?.focus();
      return;
    }
    try {
      await pos.discountAuthorizationMutation.mutateAsync(managerPin);
      approvedManagerPinRef.current = managerPin;
      pos.setDiscountApprovalGranted(true);
      pos.setDiscountApprovalSecret('');
      setManagerPinDraft('');
      setManagerApprovalOpen(false);
      pos.setSubmitMessage('تم اعتماد الخصم لهذه الفاتورة فقط.');
    } catch (error) {
      approvedManagerPinRef.current = '';
      pos.setDiscountApprovalSecret('');
      setManagerPinDraft('');
      setManagerPinError(getErrorMessage(error, 'تعذر اعتماد الخصم.'));
      managerPinInputRef.current?.focus();
    }
  }, [managerPinDraft, pos]);

  useEffect(() => {
    if (!open) {
      openedOnceRef.current = false;
      cancelScheduledFocus();
      clearInlineManagerApproval();
      return;
    }
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    focusPaymentInputForPreset(initialFocusPresetRef.current);
  }, [cancelScheduledFocus, clearInlineManagerApproval, focusPaymentInputForPreset, open]);

  useEffect(() => {
    if (!pos.discountApprovalGranted) approvedManagerPinRef.current = '';
    if (!isDiscountLocked) clearInlineManagerApproval();
  }, [clearInlineManagerApproval, isDiscountLocked, pos.discountApprovalGranted]);

  useEffect(() => {
    if (!managerApprovalOpen || pos.discountApprovalGranted) return;
    const frameId = window.requestAnimationFrame(() => {
      managerPinInputRef.current?.focus();
      managerPinInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [managerApprovalOpen, pos.discountApprovalGranted]);

  const isTerminalHardwareManaged = useMemo(() => Boolean(
    isStandalonePosTerminal() ||
    (typeof window !== 'undefined' && Boolean((window as any).AndroidBridge?.requestPayment || (window as any).SmartPos?.requestPayment || (window as any).SunmiPay?.sale)) ||
    pos.settings?.posTerminalEnabled ||
    (pos.settingsQuery?.data as any)?.posTerminalEnabled
  ), [pos.settings?.posTerminalEnabled, pos.settingsQuery?.data]);

  const isPaymentActive = useCallback((preset: PaymentPreset) => {
    if (preset === 'credit') return pos.paymentType === 'credit';
    if (pos.paymentType === 'credit') return false;
    const cash = Number(pos.cashAmount || 0);
    const card = Number(pos.cardAmount || 0);
    const transfer = Number(pos.transferAmount || 0);
    const activeLegs = (cash > 0 ? 1 : 0) + (card > 0 ? 1 : 0) + (transfer > 0 ? 1 : 0);
    if (activeLegs === 0) {
      const isCodDelivery = pos.orderType === 'delivery' && (pos.collectionStatus === 'cod' || !pos.collectionStatus);
      if (isCodDelivery) return false;
      return pos.paymentChannel === preset;
    }
    if (activeLegs > 1) return false;
    if (preset === 'cash') return cash > 0;
    if (preset === 'card') return card > 0;
    if (preset === 'wallet') return transfer > 0 && pos.paymentChannel === 'wallet';
    if (preset === 'instapay') return transfer > 0 && pos.paymentChannel !== 'wallet';
    return false;
  }, [pos.cardAmount, pos.cashAmount, pos.collectionStatus, pos.orderType, pos.paymentChannel, pos.paymentType, pos.transferAmount]);

  const handleSelectPaymentAction = useCallback((action: CheckoutPaymentButtonAction) => {
    if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
      toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
      return;
    }

    const targetPreset = resolvePresetForCheckoutAction(action, pos.paymentChannel, paymentRegion);

    if (checkoutViewMode === 'express' && expressShortcutActionsRef.current) {
      if (action.kind === 'cash') {
        expressShortcutActionsRef.current.selectCash();
        focusPaymentInputForPreset('cash');
        return;
      }
      if (action.kind === 'card') {
        expressShortcutActionsRef.current.selectCard(action.cardScheme, action.provider);
        return;
      }
      if (action.kind === 'credit') {
        expressShortcutActionsRef.current.selectCredit();
        return;
      }
      // Transfer methods live in detailed view; switch smoothly and focus the transfer field.
      setCheckoutViewMode('detailed');
    }

    pos.setPaymentPreset(targetPreset);
    if (action.kind === 'card') {
      pos.setTerminalPaymentDetails?.({
        ...(pos.terminalPaymentDetails || {}),
        ...(action.cardScheme ? { cardScheme: action.cardScheme } : {}),
        ...(action.provider ? { provider: action.provider } : {}),
      });
    } else {
      pos.setTerminalPaymentDetails?.(null);
    }
    focusPaymentInputForPreset(targetPreset);
  }, [checkoutViewMode, focusPaymentInputForPreset, paymentRegion, pos]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const altSlot = parseCheckoutAltDigit(event);
      if (altSlot !== null) {
        const matchedAction = resolveCheckoutActionForSlot(paymentRegion, altSlot);
        if (!matchedAction) return;
        if (pos.createSale.isPending) return;
        if (managerApprovalOpen && !pos.discountApprovalGranted) return;
        event.preventDefault();
        event.stopPropagation();
        handleSelectPaymentAction(matchedAction);
        return;
      }

      if (event.key !== 'F2') return;
      event.preventDefault();
      event.stopPropagation();
      if (pos.createSale.isPending) return;
      if (managerApprovalOpen && !pos.discountApprovalGranted) {
        void handleInlineManagerApproval();
        return;
      }
      if ((isPaymentActive('card') || Number(pos.cardAmount || 0) > 0) && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn) {
        toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
        return;
      }
      handleConfirmSale();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleConfirmSale, handleInlineManagerApproval, handleSelectPaymentAction, isPaymentActive, isTerminalHardwareManaged, managerApprovalOpen, open, paymentRegion, pos.cardAmount, pos.createSale.isPending, pos.discountApprovalGranted, pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn, t]);

  const customers = useMemo(() => (Array.isArray(pos.customersQuery.data) ? pos.customersQuery.data : []), [pos.customersQuery.data]);
  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === String(pos.customerId)) || null,
    [pos.customerId, customers],
  );
  const filteredCustomers = useMemo(() => {
    const query = customerQuery.trim().toLowerCase();
    if (!query) return [];
    return customers.filter((customer) => (
      customer.name.toLowerCase().includes(query) || String(customer.phone || '').toLowerCase().includes(query)
    )).slice(0, 40);
  }, [customerQuery, customers]);
  const cartQtySummaries = useMemo(() => {
    return summarizeCartQuantities(pos.cart);
  }, [pos.cart]);
  const itemsCount = pos.cart.length;

  async function handleQuickCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await pos.handleQuickCustomerSubmit(event);
  }

  if (!open) return null;

  return (
    <DialogShell
      open={open}
      onClose={handleDialogClose}
      width={isMobile ? 'calc(100vw - 12px)' : (checkoutViewMode === 'express' ? 'min(490px, calc(100vw - 20px))' : 'min(1060px, calc(100vw - 28px))')}
      maxHeight={isMobile ? 'calc(100dvh - 16px)' : 'calc(100vh - 20px)'}
      zIndex={86}
      ariaLabel={t('pos.review_and_checkout', 'مراجعة وإتمام البيع')}
      overlayClassName="pos-checkout-dialog-overlay"
      shellClassName={`pos-checkout-dialog-shell ${checkoutViewMode === 'express' ? 'is-express' : 'is-detailed'}`}
    >
      <Card
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px', flexWrap: isMobile ? 'wrap' : 'nowrap', height: isMobile ? undefined : '34px', minHeight: '34px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: isMobile ? 'wrap' : 'nowrap', minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontSize: isMobile ? '13.5px' : '15px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                {t('pos.review_and_checkout', 'مراجعة وإتمام البيع')}
              </span>
              {checkoutViewMode === 'detailed' && (
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  ({t('pos.items_count', 'العناصر:')} {itemsCount} • {t('pos.quantities_count', 'الكميات:')} {cartQtySummaries.length ? cartQtySummaries.join(' + ') : '0'})
                </span>
              )}
            </div>
            {isMobile && pos.orderType !== 'delivery' && (
              <div
                style={{
                  display: 'inline-flex',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  padding: '2px',
                  borderRadius: '6px',
                  gap: '2px',
                  fontSize: '11px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setCheckoutViewMode('express')}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '4px',
                    border: 'none',
                    background: checkoutViewMode === 'express' ? '#170e5e' : 'transparent',
                    color: checkoutViewMode === 'express' ? '#ffffff' : '#64748b',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {t('pos.express_touch_mode', 'دفع سريع')}
                </button>
                <button
                  type="button"
                  onClick={() => setCheckoutViewMode('detailed')}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '4px',
                    border: 'none',
                    background: checkoutViewMode === 'detailed' ? '#170e5e' : 'transparent',
                    color: checkoutViewMode === 'detailed' ? '#ffffff' : '#64748b',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  {t('pos.detailed_mode', 'تفصيلي')}
                </button>
              </div>
            )}
          </div>
        )}
        className="dialog-card pos-checkout-dialog-card"
        style={{
          height: isMobile ? 'calc(100dvh - 16px)' : (checkoutViewMode === 'detailed' ? '100%' : 'auto'),
          maxHeight: isMobile ? 'calc(100dvh - 16px)' : '100%',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        {/* T11-A (INV-REST-COMBO-SUBMIT-TRUTH, follow-up A): the dialog
         * stays open on a failed submit, so the failure reason must be
         * visible INSIDE it — it previously lived only in the footer
         * banner underneath. Keep informational customer-added notes out
         * of this header slot so they don't push delivery layouts down. */}
        {pos.submitMessage && (pos.createSale?.isError || (!pos.canShowLastSaleActions && !pos.submitMessage.startsWith('تم إضافة العميل'))) ? (
          <div
            role="alert"
            className={pos.createSale?.isError ? 'error-box pos-compact-message' : 'success-box pos-compact-message'}
            style={{ marginBottom: '6px' }}
          >
            <div>{pos.submitMessage}</div>
          </div>
        ) : null}
        {checkoutViewMode === 'express' ? (
          /* Express Handheld Touch Mode */
          <div
            className="pos-checkout-dialog thin-scrollbar"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              width: '100%',
              maxHeight: isMobile ? 'calc(100dvh - 90px)' : 'calc(100vh - 120px)',
              overflowY: 'auto',
              boxSizing: 'border-box',
              paddingRight: '2px',
            }}
          >
            <PosCheckoutExpressSection
              pos={pos}
              isKwdStore={isKwdStore}
              isKsaStore={isKsaStore}
              isPaymentActive={isPaymentActive}
              onSelectPaymentPreset={(preset) => pos.setPaymentPreset(preset)}
              onConfirmSale={handleConfirmSale}
              onSwitchToDetailed={() => setCheckoutViewMode('detailed')}
              selectedCustomerName={selectedCustomerName}
              onOpenCustomerPicker={() => setCustomerPickerOpen(true)}
              onOpenNotes={() => setIsNotesOpen(true)}
              isNotesOpen={isNotesOpen}
              cartQtySummaries={cartQtySummaries}
              expressCashInputRef={expressCashInputRef}
              shortcutActionsRef={expressShortcutActionsRef}
            />
            <PosCreditLimitNotice customerId={pos.customerId} total={pos.totals.total} paidAmount={pos.paidAmount} />
            <Button
              type="button"
              variant="secondary"
              onClick={handleDialogClose}
              disabled={pos.createSale.isPending}
              style={{ width: '100%', fontSize: '12px', minHeight: '34px' }}
            >
              {t('pos.back_to_cart', 'رجوع للسلة')}
            </Button>
          </div>
        ) : (
          /* Detailed Desktop / Delivery Mode */
          <>
            <div className="pos-checkout-dialog thin-scrollbar">
              <div
                className="pos-checkout-main-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile
                    ? 'minmax(0, 1fr)'
                    : 'minmax(0, 0.9fr) minmax(0, 1.3fr)',
                  gap: isMobile ? '8px' : '12px',
                  alignItems: 'stretch',
                  flex: isMobile ? undefined : '1 1 auto',
                  minHeight: isMobile ? undefined : 0,
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {/* Right Column: Order Type, Customer, Delivery, Notes & Bottom Totals Summary */}
                <div className="pos-checkout-col-pane thin-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, minHeight: 0, width: '100%', height: isMobile ? 'auto' : '100%', boxSizing: 'border-box' }}>
                  <PosCheckoutOrderTypeSection
                    pos={pos}
                    onDeliverySelected={() => setCustomerPickerOpen(true)}
                  />

                  <PosCheckoutCustomerSection
                    pos={pos}
                    selectedCustomerName={selectedCustomerName}
                    selectedCustomer={selectedCustomer}
                    filteredCustomers={filteredCustomers}
                    customerPickerOpen={customerPickerOpen}
                    customerQuery={customerQuery}
                    onCustomerPickerOpenChange={setCustomerPickerOpen}
                    onCustomerQueryChange={setCustomerQuery}
                    onQuickCustomerSubmit={(event) => { void handleQuickCustomerSubmit(event); }}
                    needsCustomer={pos.orderType === 'delivery' || pos.paymentType === 'credit'}
                    isManualOpen={isManualCustomerOpen}
                    onManualOpen={() => setIsManualCustomerOpen(true)}
                    isMobile={isMobile}
                  />

                  <PosCheckoutDeliverySection
                    pos={pos}
                    deliveryReps={deliveryRepsQuery.data || []}
                    isMobile={isMobile}
                  />

                  <section className="pos-checkout-dialog-section" style={{ padding: 0, marginTop: '0', border: 'none', background: 'transparent', width: '100%', boxSizing: 'border-box', flexShrink: 0 }}>
                    {!isNotesOpen && !pos.note ? (
                      <Button type="button" variant="secondary" onClick={() => setIsNotesOpen(true)} style={{ width: '100%', height: '32px', minHeight: '32px', maxHeight: '32px', fontSize: '12px', boxSizing: 'border-box' }}>+ {t('pos.add_order_note', 'إضافة ملاحظة للفاتورة')}</Button>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%', boxSizing: 'border-box', height: '32px' }}>
                        <input autoFocus={isNotesOpen && !pos.note} value={pos.note} onChange={(event) => pos.setNote(event.target.value)} placeholder={t('pos.optional_order_notes', 'ملاحظات اختيارية على الفاتورة...')} disabled={pos.createSale.isPending} style={{ flex: 1, padding: '4px 10px', fontSize: '12px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                        <Button type="button" variant="secondary" onClick={() => { setIsNotesOpen(false); pos.setNote(''); }} style={{ flexShrink: 0, height: '32px', minHeight: '32px', padding: '0 10px', fontSize: '11.5px', borderRadius: '6px', boxSizing: 'border-box' }}>{t('common.clear', 'مسح')}</Button>
                      </div>
                    )}
                  </section>

                  {/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I46): flat ERP invoice breakdown anchored at column bottom */}
                  <div
                    className="pos-checkout-totals-card"
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: isMobile ? '8px 10px' : '8px 12px',
                      marginTop: isMobile ? undefined : 'auto',
                      flexShrink: 0,
                    }}
                  >
                    <PosTotalsBreakdown totals={pos.totals} emphasizeTotal />
                  </div>
                </div>

                {/* Left Column: Payment Station */}
                <div className="pos-checkout-col-pane thin-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, minHeight: 0, width: '100%', height: isMobile ? 'auto' : '100%', boxSizing: 'border-box' }}>
                  <PosCheckoutPaymentSection
                    pos={pos}
                    cashAmountInputRef={cashAmountInputRef}
                    cardAmountInputRef={cardAmountInputRef}
                    transferAmountInputRef={transferAmountInputRef}
                    managerPinInputRef={managerPinInputRef}
                    customerPickerOpen={customerPickerOpen}
                    managerApprovalOpen={managerApprovalOpen}
                    managerPinDraft={managerPinDraft}
                    managerPinError={managerPinError}
                    isDiscountLocked={isDiscountLocked}
                    approvedManagerPinRef={approvedManagerPinRef}
                    onManagerApprovalOpenChange={setManagerApprovalOpen}
                    onManagerPinDraftChange={setManagerPinDraft}
                    onManagerPinErrorChange={setManagerPinError}
                    onInlineManagerApproval={(event) => { void handleInlineManagerApproval(event); }}
                    isPaymentActive={isPaymentActive}
                    onSelectPaymentPreset={(preset) => pos.setPaymentPreset(preset)}
                    onSelectPaymentAction={handleSelectPaymentAction}
                    onConfirmSale={handleConfirmSale}
                    isMobile={isMobile}
                  />
                </div>
              </div>
              <PosCreditLimitNotice customerId={pos.customerId} total={pos.totals.total} paidAmount={pos.paidAmount} />
            </div>

            <div className="actions compact-actions pos-checkout-dialog-actions" style={{ marginTop: '8px', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', height: isMobile ? undefined : '30px' }}>
                {!pos.canSubmitSale && pos.canSubmitHint ? (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: '#92400e',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      padding: '0 10px',
                      height: isMobile ? undefined : '30px',
                      lineHeight: isMobile ? 1.35 : '28px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      whiteSpace: isMobile ? 'normal' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    {pos.canSubmitHint}
                  </div>
                ) : pos.adminDiscountWarning ? (
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: '#92400e',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      padding: '0 10px',
                      height: isMobile ? undefined : '30px',
                      lineHeight: isMobile ? 1.35 : '28px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      whiteSpace: isMobile ? 'normal' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    {pos.adminDiscountWarning}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <Button type="button" variant="secondary" onClick={handleDialogClose} disabled={pos.createSale.isPending}>{t('pos.back_to_cart', 'رجوع للسلة')}</Button>
                {isRestaurant && onOpenSplitBill && pos.cart.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (pos.terminalPaymentDetails?.authCode || pos.terminalPaymentDetails?.rrn) {
                        toast.warning('لا يمكن تقسيم الشيك بعد اعتماد خصم الماكينة. أكمل الفاتورة أو راجع تسوية الدفع أولًا.');
                        return;
                      }
                      onClose();
                      onOpenSplitBill(approvedManagerPinRef.current || undefined);
                    }}
                    disabled={pos.createSale.isPending}
                    style={{ borderColor: '#170e5e', color: '#170e5e', fontWeight: 700 }}
                  >
                    {t('pos.split_bill', 'تجزئة / تقسيم الشيك')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="success"
                  onClick={() => {
                    if ((isPaymentActive('card') || Number(pos.cardAmount || 0) > 0) && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn) {
                      toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
                      return;
                    }
                    handleConfirmSale();
                  }}
                  disabled={pos.createSale.isPending || !pos.canSubmitSale || ((isPaymentActive('card') || Number(pos.cardAmount || 0) > 0) && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn)}
                  style={{ minWidth: isMobile ? undefined : '165px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  <CheckIcon size={15} />
                  <span>{pos.createSale.isPending ? t('common.saving', 'جاري الحفظ...') : t('pos.confirm_sale_f2', 'تأكيد البيع (F2)')}</span>
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </DialogShell>
  );
}

export function PosCheckoutDialog(props: PosCheckoutDialogProps) {
  if (!props.open) return null;
  return <PosCheckoutDialogContent {...props} />;
}
