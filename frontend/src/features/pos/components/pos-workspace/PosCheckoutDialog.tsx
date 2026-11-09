import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import {
  PosCheckoutCustomerSection,
  PosCheckoutOrderTypeSection,
  PosCheckoutPaymentSection,
  PosCheckoutDeliverySection,
  type PaymentPreset,
} from '@/features/pos/components/pos-workspace/PosCheckoutDialogSections';
import { PosCheckoutExpressSection } from './PosCheckoutExpressSection';
import { PosCreditLimitNotice } from './PosCreditLimitNotice';
import { PosTotalsBreakdown } from '@/features/pos/components/pos-cart-panel/PosTotalsBreakdown';
import { summarizeCartQuantities } from '@/features/pos/lib/pos.domain';
import { toast } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';
import { usePosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';
import { isKuwait, isSaudi } from '@/lib/currencies';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { isStandalonePosTerminal } from '@/features/pos/lib/pos-shell';

interface PosCheckoutDialogProps {
  open: boolean;
  pos: PosWorkspaceState;
  selectedCustomerName: string;
  onClose: () => void;
  onConfirmSale: (managerPin?: string, tenderedAmount?: number) => void;
  onOpenSplitBill?: () => void;
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
  const managerPinInputRef = useRef<HTMLInputElement | null>(null);
  const approvedManagerPinRef = useRef('');
  const openedOnceRef = useRef(false);
  const autoFilledOnOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const createSalePendingRef = useRef(Boolean(pos.createSale.isPending));
  
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isDiscountLocked = !pos.canApplyDiscount && !isAdmin;
  const isRestaurant = pos.settingsQuery?.data?.restaurantModuleEnabled === true;

  const { customization } = usePosUiCustomization();
  const currentSettings = pos.settings || pos.settingsQuery?.data;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);

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
      const pref = customization.defaultPaymentChannel;
      const shouldUseCard = pref === 'card' || (pref === 'auto' && (isKwdStore || isKsaStore));
      const shouldUseWallet = pref === 'wallet';

      if (shouldUseCard) {
        pos.setPaymentPreset('card');
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
      } else if (shouldUseWallet) {
        pos.setPaymentPreset(isKwdStore ? 'instapay' : 'wallet');
      } else {
        pos.setPaymentPreset('cash');
      }
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
      clearInlineManagerApproval();
      return;
    }
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    const frameId = window.requestAnimationFrame(() => {
      if (customerPickerOpen || managerApprovalOpen) return;
      cashAmountInputRef.current?.focus();
      cashAmountInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [clearInlineManagerApproval, customerPickerOpen, managerApprovalOpen, open]);

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

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F2') return;
      event.preventDefault();
      event.stopPropagation();
      if (pos.createSale.isPending) return;
      if (managerApprovalOpen && !pos.discountApprovalGranted) {
        void handleInlineManagerApproval();
        return;
      }
      if (isPaymentActive('card') && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn) {
        toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
        return;
      }
      handleConfirmSale();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleConfirmSale, handleInlineManagerApproval, isPaymentActive, isTerminalHardwareManaged, managerApprovalOpen, open, pos.createSale.isPending, pos.discountApprovalGranted, pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn, t]);

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
  function isPaymentActive(preset: PaymentPreset) {
    if (preset === 'credit') return pos.paymentType === 'credit';
    if (pos.paymentType === 'credit') return false;
    if (pos.paymentChannel === preset) return true;
    if (preset === 'card' && pos.cardAmount > 0 && pos.cashAmount === 0 && pos.transferAmount === 0) return true;
    if (preset === 'cash' && pos.cashAmount > 0 && pos.cardAmount === 0 && pos.transferAmount === 0) return true;
    return false;
  }

  if (!open) return null;

  return (
    <DialogShell
      open={open}
      onClose={handleDialogClose}
      width={isMobile ? 'calc(100vw - 12px)' : (checkoutViewMode === 'express' ? 'min(490px, calc(100vw - 20px))' : 'min(1080px, calc(100vw - 32px))')}
      maxHeight={isMobile ? 'calc(100dvh - 16px)' : 'calc(100vh - 24px)'}
      zIndex={86}
      ariaLabel={t('pos.review_and_checkout', 'مراجعة وإتمام البيع')}
      overlayClassName="pos-checkout-dialog-overlay"
      shellClassName={`pos-checkout-dialog-shell ${checkoutViewMode === 'express' ? 'is-express' : 'is-detailed'}`}
    >
      <Card
        title={(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px' }}>
            <span style={{ fontSize: isMobile ? '13.5px' : '15px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.review_and_checkout', 'مراجعة وإتمام البيع')}
            </span>
            {pos.orderType !== 'delivery' && (
              <div
                style={{
                  display: 'inline-flex',
                  background: '#f1f5f9',
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
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: 'none',
                    background: checkoutViewMode === 'express' ? '#170e5e' : 'transparent',
                    color: checkoutViewMode === 'express' ? '#ffffff' : '#64748b',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '11px',
                    transition: 'background 0.1s ease',
                  }}
                >
                  {t('pos.express_touch_mode', 'دفع سريع')}
                </button>
                <button
                  type="button"
                  onClick={() => setCheckoutViewMode('detailed')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: 'none',
                    background: checkoutViewMode === 'detailed' ? '#170e5e' : 'transparent',
                    color: checkoutViewMode === 'detailed' ? '#ffffff' : '#64748b',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '11px',
                    transition: 'background 0.1s ease',
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
          height: isMobile ? 'calc(100dvh - 16px)' : 'auto',
          maxHeight: isMobile ? 'calc(100dvh - 16px)' : 'calc(100vh - 24px)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
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
              <section className="pos-checkout-dialog-section pos-checkout-summary-section" style={{ padding: 0, border: 'none', background: 'transparent', marginBottom: '2px' }}>
                <div style={{
                  display: 'flex',
                  gap: isMobile ? '6px' : '12px',
                  background: '#f8fafc',
                  padding: isMobile ? '4px 8px' : '4px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: isMobile ? '11px' : '12px',
                  minHeight: '30px',
                  lineHeight: 1
                }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>{t('pos.items_count', 'العناصر:')}</span>
                    <strong style={{ fontSize: isMobile ? '12px' : '13px', fontWeight: 800, color: '#0f172a' }}>{itemsCount}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>{t('pos.quantities_count', 'الكميات:')}</span>
                    <strong style={{ fontSize: isMobile ? '12px' : '13px', fontWeight: 800, color: '#0f172a' }}>{cartQtySummaries.length ? cartQtySummaries.join(' + ') : '0'}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontWeight: 700 }}>{t('pos.due_amount', 'المطلوب:')}</span>
                    <strong className="is-primary" style={{ fontSize: isMobile ? '14px' : '15px', fontWeight: 900, color: '#170c5c' }}>{formatCurrency(pos.totals.total)}</strong>
                  </div>
                </div>
                {/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I46): the breakdown
                 * behind the single total — subtotal, discount, service
                 * charge, delivery, tax, tip — fed by pos.totals, the
                 * same rows the cart panel shows. */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 12px', marginTop: '6px' }}>
                  <PosTotalsBreakdown totals={pos.totals} />
                </div>
              </section>

              <PosCheckoutOrderTypeSection
                pos={pos}
                onDeliverySelected={() => setCustomerPickerOpen(true)}
              />

              <div
                className="pos-checkout-main-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile
                    ? 'minmax(0, 1fr)'
                    : 'minmax(0, 1.15fr) minmax(0, 1fr)',
                  gap: isMobile ? '8px' : '12px',
                  alignItems: 'start',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {/* Right Column: Customer, Delivery & Notes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
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

                  <section className="pos-checkout-dialog-section" style={{ padding: 0, marginTop: '2px', width: '100%', boxSizing: 'border-box' }}>
                    {!isNotesOpen && !pos.note ? (
                      <Button type="button" variant="secondary" onClick={() => setIsNotesOpen(true)} style={{ width: '100%', minHeight: '32px', fontSize: '12px' }}>+ {t('pos.add_order_note', 'إضافة ملاحظة للفاتورة')}</Button>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                        <input autoFocus={isNotesOpen && !pos.note} value={pos.note} onChange={(event) => pos.setNote(event.target.value)} placeholder={t('pos.optional_order_notes', 'ملاحظات اختيارية على الفاتورة...')} disabled={pos.createSale.isPending} style={{ flex: 1, padding: '4px 8px', fontSize: '12px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                        <Button type="button" variant="secondary" onClick={() => { setIsNotesOpen(false); pos.setNote(''); }} style={{ flexShrink: 0, height: '32px', padding: '0 8px', fontSize: '11px', borderRadius: '4px' }}>{t('common.clear', 'مسح')}</Button>
                      </div>
                    )}
                  </section>

                  {pos.orderType === 'delivery' && pos.collectionStatus === 'cod' && (!pos.deliveryRepId || Number(pos.deliveryRepId) <= 0) && (
                    <div className="error-box" style={{ margin: '4px 0 0', background: '#fef2f2', border: '1.5px solid #f87171', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontWeight: 700, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', boxSizing: 'border-box', width: '100%' }}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <span>يجب اختيار مندوب التوصيل لتسجيل عهدة التحصيل عليه (في حالة تحصيل من العميل).</span>
                    </div>
                  )}
                </div>

                {/* Left Column: Payment Section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
                  <PosCheckoutPaymentSection
                    pos={pos}
                    cashAmountInputRef={cashAmountInputRef}
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
                    onConfirmSale={handleConfirmSale}
                    isMobile={isMobile}
                  />
                </div>
              </div>
            </div>

            <PosCreditLimitNotice customerId={pos.customerId} total={pos.totals.total} paidAmount={pos.paidAmount} />
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
                  marginTop: '8px',
                }}
              >
                {pos.canSubmitHint}
              </div>
            )}
            <div className="actions compact-actions pos-checkout-dialog-actions" style={{ marginTop: '8px' }}>
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
                    onOpenSplitBill();
                  }}
                  disabled={pos.createSale.isPending}
                  style={{ borderColor: '#170e5e', color: '#170e5e', fontWeight: 800 }}
                >
                  {t('pos.split_bill', 'تجزئة / تقسيم الشيك')}
                </Button>
              )}
              <Button
                type="button"
                variant="success"
                onClick={() => {
                  if (isPaymentActive('card') && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn) {
                    toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
                    return;
                  }
                  handleConfirmSale();
                }}
                disabled={pos.createSale.isPending || !pos.canSubmitSale || (isPaymentActive('card') && isTerminalHardwareManaged && !pos.terminalPaymentDetails?.authCode && !pos.terminalPaymentDetails?.rrn)}
              >
                {pos.createSale.isPending ? t('common.saving', 'جاري الحفظ...') : t('pos.confirm_sale_f2', 'تأكيد البيع (F2)')}
              </Button>
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
