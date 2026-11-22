import { getGlobalSystemCurrency, getSystemCountryCode, isKuwait, isSaudi } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { calcInvoiceDiscountPercent } from '@/features/pos/lib/pos-cart-totals';
import { useState, useEffect, useMemo, type FormEvent, type RefObject } from 'react';
import { posApi } from '@/features/pos/api/pos.api';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { shouldTryAlternateTerminalCharge, canChangePaymentAfterTerminalApproval, isTerminalApprovalLive, terminalAuthorizationLabel } from './pos-terminal-charge-safety';
import { toast } from '@/shared/components/system-alert';
import { getBalanceState } from '@/features/pos/lib/pos-balance-state';
import { useAuthStore } from '@/stores/auth-store';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import {
  getCheckoutPaymentActions,
  getCheckoutPaymentRegion,
  resolvePresetForCheckoutAction,
  type CheckoutPaymentButtonAction,
} from './pos-checkout-shortcuts';
import { PosCheckoutPaymentMethods } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutPaymentMethods';
import { PosCheckoutPaymentLegs } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutPaymentLegs';
import { PosCheckoutDiscountStrip } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutDiscountStrip';
import { PosCheckoutTerminalBanner } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutTerminalBanner';
import { PosCheckoutApprovalChargesTip } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutApprovalChargesTip';
import { PosCheckoutPaymentSummary } from '@/features/pos/components/pos-workspace/pos-checkout-payment/PosCheckoutPaymentSummary';
import type { PaymentPreset } from '@/features/pos/types/pos.types';
export { PosCheckoutCustomerSection, type PosCheckoutCustomerSectionProps } from './PosCheckoutCustomerSection';
export { PosCheckoutOrderTypeSection, PosCheckoutDeliverySection } from './PosCheckoutFulfillmentSections';

/* R5-A (INV-REST-TOTALS-TRUTH-2, M24): this used to return NEGATIVE
 * remaining (-remainingDebt / -amountDue) while the cart panel showed
 * positive remaining — the same screen showed two different remaining
 * figures. It now delegates to the one shared helper (remaining
 * positive, change positive, one 0.009 threshold). */
function getBalancePreview(pos: Pick<PosWorkspaceState, 'paymentType' | 'amountDue' | 'changeAmount' | 'totals' | 'paidAmount' | 'customerId'>) {
  return getBalanceState({
    paymentType: pos.paymentType,
    customerId: pos.customerId,
    paidAmount: Number(pos.paidAmount || 0),
    amountDue: Number(pos.amountDue || 0),
    changeAmount: Number(pos.changeAmount || 0),
    total: Number(pos.totals?.total || 0),
  });
}

interface PosCheckoutPaymentSectionProps {
  pos: PosWorkspaceState;
  cashAmountInputRef: RefObject<HTMLInputElement | null>;
  cardAmountInputRef?: RefObject<HTMLInputElement | null>;
  transferAmountInputRef?: RefObject<HTMLInputElement | null>;
  managerPinInputRef: RefObject<HTMLInputElement | null>;
  customerPickerOpen: boolean;
  managerApprovalOpen: boolean;
  managerPinDraft: string;
  managerPinError: string;
  isDiscountLocked: boolean;
  approvedManagerPinRef: RefObject<string>;
  onManagerApprovalOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onManagerPinDraftChange: (value: string) => void;
  onManagerPinErrorChange: (value: string) => void;
  onInlineManagerApproval: (event?: FormEvent<HTMLFormElement>) => void;
  isPaymentActive: (preset: PaymentPreset) => boolean;
  onSelectPaymentPreset: (preset: PaymentPreset) => void;
  onSelectPaymentAction?: (action: CheckoutPaymentButtonAction) => void;
  onConfirmSale?: () => void;
  isMobile?: boolean;
}

export function PosCheckoutPaymentSection({
  pos,
  cashAmountInputRef,
  cardAmountInputRef,
  transferAmountInputRef,
  managerPinInputRef,
  customerPickerOpen,
  managerApprovalOpen,
  managerPinDraft,
  managerPinError,
  isDiscountLocked,
  approvedManagerPinRef,
  onManagerApprovalOpenChange,
  onManagerPinDraftChange,
  onManagerPinErrorChange,
  onInlineManagerApproval,
  isPaymentActive,
  onSelectPaymentPreset,
  onSelectPaymentAction,
  onConfirmSale,
  isMobile: isMobileProp,
}: PosCheckoutPaymentSectionProps) {
  // INV-FE1-FRONTEND-BOOK-DIGITS: discount money values round at the
  // tenant's book digits (settings currency, global fallback).
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const isMobileHook = useIsMobile(860);
  const isMobile = isMobileProp ?? isMobileHook;
  const balance = getBalancePreview(pos);
  const paidAmount = Number(pos.paidAmount || 0);
  const totalAmount = Number(pos.totals?.total || 0);
  const isCreditSale = pos.paymentType === 'credit';
  const cashVal = Number(pos.cashAmount || 0);
  const cardVal = Number(pos.cardAmount || 0);
  const transferVal = Number(pos.transferAmount || 0);
  const activeLegsCount = (cashVal > 0 ? 1 : 0) + (cardVal > 0 ? 1 : 0) + (transferVal > 0 ? 1 : 0);
  const isSplitActive = !isCreditSale && activeLegsCount > 1;
  const isCodUnpaid = pos.orderType === 'delivery' && (pos.collectionStatus === 'cod' || !pos.collectionStatus) && activeLegsCount === 0;
  const transferSelected = !isCreditSale && (
    transferVal > 0 ||
    (activeLegsCount === 0 && !isCodUnpaid && (pos.paymentChannel === 'wallet' || pos.paymentChannel === 'instapay'))
  );
  const remainingUnpaid = roundMoneyValue(Math.max(0, totalAmount - paidAmount), bookDigits);
  // INV-REST-PAID-GATES-2 (R4-D, I40): while a terminal approval is
  // live the total-changing inputs are frozen — discount, tip,
  // delivery fee, order type — because any of them would move the
  // amount the terminal approved. Same condition as the payment lock.
  const isTerminalApproved = isTerminalApprovalLive(pos.terminalPaymentDetails);

  const [percentStr, setPercentStr] = useState('');
  const [isPercentFocused, setIsPercentFocused] = useState(false);

  useEffect(() => {
    if (!isPercentFocused) {
      /* F1b (van trial problem 20): the "%" display divides by the NET
       * subtotal, same base as the strip input — the gross base showed
       * 4.00% for a 3.84 discount on a 96.00 net base. */
      const discountBase = pos.totals.netSubTotal ?? pos.totals.subTotal;
      setPercentStr(pos.discount > 0 && discountBase > 0 ? calcInvoiceDiscountPercent(pos.discount, discountBase).toFixed(2).replace(/\.00$/, '') : '');
    }
  }, [pos.discount, pos.totals.netSubTotal, pos.totals.subTotal, isPercentFocused]);

  const currentSettings = pos.settings || pos.settingsQuery?.data;
  const isRestaurant = currentSettings?.restaurantModuleEnabled === true;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);
  const countryCode = getSystemCountryCode(currentSettings);

  const quickCashDenominations = useMemo(() => {
    if (totalAmount <= 0) return [];
    const baseList = isKwdStore
      ? [1, 5, 10, 20]
      : isKsaStore
      ? [10, 20, 50, 100, 200, 500]
      : [20, 50, 100, 200, 500];
    let candidates = baseList.filter((b) => b > totalAmount);
    if (candidates.length < 3) {
      const step = isKwdStore ? 5 : isKsaStore ? 100 : 100;
      const nextRound = Math.ceil((totalAmount + 0.01) / step) * step;
      candidates = Array.from(new Set([...candidates, nextRound, nextRound + step, nextRound + step * 2])).filter((b) => b > totalAmount);
    }
    return candidates.slice(0, 4);
  }, [totalAmount, isKwdStore, isKsaStore]);

  const activeTerminals = useMemo(() => {
    const list = pos.settingsQuery?.data?.posTerminals;
    if (Array.isArray(list) && list.length > 0) {
      const filtered = list.filter((t) => {
        if (!t || t.enabled === false) return false;
        const prov = String(t.provider || '').toLowerCase();
        // Strict country isolation:
        // In Egypt: do NOT show knet_pos (Kuwait) or geidea (Saudi)
        if (countryCode === 'EG' && (prov === 'knet_pos' || prov === 'knet' || prov === 'geidea')) return false;
        // In Kuwait: do NOT show fawry or paymob (Egypt)
        if (countryCode === 'KW' && (prov === 'fawry' || prov === 'paymob')) return false;
        // In Saudi: do NOT show fawry, paymob, or knet_pos
        if (countryCode === 'SA' && (prov === 'fawry' || prov === 'paymob' || prov === 'knet_pos')) return false;
        return true;
      });
      if (filtered.length > 0) return filtered;
    }

    // Direct fallback to single configured terminal in settings
    const singleIp = pos.settingsQuery?.data?.posTerminalIp || (currentSettings as any)?.posTerminalIp;
    if (singleIp && (pos.settingsQuery?.data?.posTerminalEnabled === true)) {
      return [{
        id: 'default-terminal',
        name: pos.settingsQuery?.data?.posTerminalName || (currentSettings as any)?.posTerminalName || 'ماكينة الدفع (Sunmi / EDC)',
        ip: String(singleIp).trim(),
        port: Number(pos.settingsQuery?.data?.posTerminalPort || (currentSettings as any)?.posTerminalPort || 8080),
        provider: pos.settingsQuery?.data?.posTerminalProvider || (currentSettings as any)?.posTerminalProvider || 'fawry',
        isDefault: true,
        enabled: true,
      }];
    }
    return [];
  }, [
    pos.settingsQuery?.data?.posTerminals,
    pos.settingsQuery?.data?.posTerminalIp,
    pos.settingsQuery?.data?.posTerminalPort,
    pos.settingsQuery?.data?.posTerminalName,
    pos.settingsQuery?.data?.posTerminalProvider,
    pos.settingsQuery?.data?.posTerminalEnabled,
    currentSettings,
    countryCode,
  ]);

  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');


  useEffect(() => {
    if (activeTerminals.length > 0 && !selectedTerminalId) {
      const defaultTerm = activeTerminals.find((t) => t.isDefault) || activeTerminals[0];
      if (defaultTerm) setSelectedTerminalId(defaultTerm.id);
    }
  }, [activeTerminals, selectedTerminalId]);

  useEffect(() => {
    try {
      const activeTenantId = String(useAuthStore.getState().user?.tenantId || useAuthStore.getState().tenant?.id || '').trim();
      if (activeTenantId) {
        HardwareBridgeClient.syncTenant(activeTenantId).catch(() => {});
      }
    } catch {}
  }, []);

  const [terminalSession, setTerminalSession] = useState<{
    status: 'idle' | 'initiating' | 'waiting' | 'approved' | 'declined' | 'cancelled' | 'recovery_required';
    transactionId?: string;
    message?: string;
    approvalCode?: string;
  }>({ status: 'idle' });

  useEffect(() => {
    let timer: any;
    if (terminalSession.status === 'waiting' && terminalSession.transactionId) {
      timer = setInterval(async () => {
        try {
          const res = await posApi.checkTerminalStatus(terminalSession.transactionId!);
          if (res.data?.status === 'approved') {
            const authCode = String(res.data.approvalCode || '').trim();
            const rrn = res.data.rrn || terminalSession.transactionId || '';
            const cardScheme = res.data.cardScheme || 'mada';
            const cardLastFour = res.data.cardLastFour || '';
            const terminalId = res.data.terminalId || 'term-main-01';

            setTerminalSession({
              status: 'approved',
              transactionId: terminalSession.transactionId,
              message: terminalAuthorizationLabel(authCode, rrn),
              approvalCode: authCode || 'غير متاح'
            });
            const approvedAmount = Number(res.data.amount || (pos.cardAmount > 0 ? pos.cardAmount : (pos.totals.total || 0)));
            pos.setPaymentChannel('card');
            pos.setCardAmount(approvedAmount);
            if (!pos.cashAmount || pos.cashAmount <= 0) {
              pos.setCashAmount(0);
              pos.setTransferAmount(0);
            }

            pos.setTerminalPaymentDetails?.({
              terminalId,
              authCode,
              approvedAmount,
              rrn,
              cardScheme,
              cardLastFour,
              provider: res.data.provider
            });

            if (pos.settingsQuery?.data?.posTerminalAutoFinalize && onConfirmSale) {
              setTimeout(() => {
                onConfirmSale();
              }, 700);
            }
          } else if (res.data?.status === 'declined' || res.data?.status === 'cancelled') {
            setTerminalSession({
              status: res.data.status,
              message: res.data.message || 'تم إلغاء أو رفض العملية من الجهاز'
            });
          } else if (res.data?.message && res.data.message !== terminalSession.message) {
            setTerminalSession((prev) => ({
              ...prev,
              message: res.data.message,
            }));
          }
        } catch {
          // ignore network poll jitter
        }
      }, 1500);
    }
    return () => clearInterval(timer);
  }, [terminalSession.status, terminalSession.transactionId, onConfirmSale]);

  const handleDispatchTerminal = async () => {
    if (terminalSession.status === 'recovery_required' ||
        !canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
      toast.warning('راجع حالة الخصم السابق على الماكينة قبل إرسال طلب جديد؛ لا يجوز تكرار خصم غير محسوم.');
      return;
    }
    const amount = Number(pos.cardAmount > 0 ? pos.cardAmount : (pos.totals.total || 0));
    if (amount <= 0) return;

    const currentCurrency = getGlobalSystemCurrency() || pos.settings?.currency || (pos.settingsQuery?.data as any)?.currency || 'EGP';
    const targetTerminal = (activeTerminals.find((t) => t.id === selectedTerminalId) || activeTerminals[0]) as any;
    const rawIp = String(targetTerminal?.ip || targetTerminal?.ipAddress || '').trim();
    const cleanIp = rawIp ? (rawIp.includes(':') ? rawIp.split(':')[0] : rawIp) : '192.168.1.3';
    const cleanPort = targetTerminal?.port || (rawIp && rawIp.includes(':') ? Number(rawIp.split(':')[1]) : 8080);
    const prov = targetTerminal?.provider || 'fawry';

    setTerminalSession({ status: 'initiating', message: 'جاري الاتصال بماكينة الدفع...' });

    // 0. Direct Handheld Smart POS Bridge (window.AndroidBridge / Sunmi / Pax / Localhost Daemon)
    try {
      const { MobileTerminalBridge } = await import('@/features/pos/lib/mobile-terminal-bridge');
      const caps = await MobileTerminalBridge.getCapabilities();
      if (caps.hasNativeBridge || caps.hasLocalDaemon) {
        setTerminalSession({
          status: 'waiting',
          transactionId: `MOB-${Date.now()}`,
          message: 'في انتظار تمرير أو إدخال البطاقة أو الهاتف على ماكينة الدفع الذكية...',
        });

        const mobRes = await MobileTerminalBridge.requestPayment({
          amount,
          currency: currentCurrency,
          config: {
            provider: (prov as any) || 'auto_detect',
          },
        });

        if (mobRes.success && mobRes.status === 'approved') {
          const authCode = String(mobRes.authCode || 'APPROVED').trim();
          const rrn = mobRes.rrn || `MOB-${Date.now()}`;
          const cardScheme = mobRes.cardScheme || 'card';
          const cardLastFour = mobRes.cardLastFour || '';

          setTerminalSession({
            status: 'approved',
            transactionId: rrn,
            message: terminalAuthorizationLabel(authCode, rrn),
            approvalCode: authCode,
          });
          pos.setPaymentChannel('card');
          pos.setCardAmount(amount);
          if (!pos.cashAmount || pos.cashAmount <= 0) {
            pos.setCashAmount(0);
            pos.setTransferAmount(0);
          }
          pos.setTerminalPaymentDetails?.({
            authCode,
            approvedAmount: amount,
            rrn,
            cardScheme,
            cardLastFour,
            provider: prov,
          });

          if (pos.settingsQuery?.data?.posTerminalAutoFinalize && onConfirmSale) {
            setTimeout(() => onConfirmSale(), 700);
          }
          return;
        } else if (mobRes.status === 'declined' || mobRes.status === 'cancelled') {
          setTerminalSession({
            status: mobRes.status === 'cancelled' ? 'cancelled' : 'declined',
            message: mobRes.message || 'تم إلغاء أو رفض العملية من الماكينة',
          });
          return;
        }
      }
    } catch {
      // Continue to HardwareBridgeClient / Cloud Backend
    }

    // 1. Direct Local Hardware Bridge dispatch (if bridge is active on 127.0.0.1:18181)
    let bridgeChargeIssued = false;
    try {
      const isBridge = await HardwareBridgeClient.isAvailable();
      if (isBridge && cleanIp) {
        const refId = `ECR-${Date.now()}`;
        setTerminalSession({
          status: 'waiting',
          transactionId: refId,
          message: 'في انتظار تمرير أو إدخال البطاقة على جهاز الدفع (عبر جسر Z-Systems)...',
        });

        bridgeChargeIssued = true;
        const bridgeRes = await HardwareBridgeClient.chargeTerminal({
          ip: cleanIp,
          port: cleanPort,
          provider: prov,
          amount,
          currency: currentCurrency,
          referenceId: refId,
          pairingKey: targetTerminal?.pairingKey,
          terminalTid: targetTerminal?.terminalTid,
        });

        if (bridgeRes.status === 'approved') {
          const authCode = String(bridgeRes.authCode || '').trim();
          const rrn = bridgeRes.rrn || refId;
          const cardScheme = bridgeRes.cardScheme || 'visa';
          const cardLastFour = bridgeRes.cardLastFour || '';

          setTerminalSession({
            status: 'approved',
            transactionId: refId,
            message: terminalAuthorizationLabel(authCode, rrn),
            approvalCode: authCode || 'غير متاح',
          });
          pos.setPaymentChannel('card');
          pos.setCardAmount(amount);
          if (!pos.cashAmount || pos.cashAmount <= 0) {
            pos.setCashAmount(0);
            pos.setTransferAmount(0);
          }
          pos.setTerminalPaymentDetails?.({
            authCode,
            approvedAmount: amount,
            rrn,
            cardScheme,
            cardLastFour,
            provider: targetTerminal?.provider,
          });

          if (pos.settingsQuery?.data?.posTerminalAutoFinalize && onConfirmSale) {
            setTimeout(() => onConfirmSale(), 700);
          }
          return;
        } else {
          setTerminalSession({
            status: bridgeRes.status === 'cancelled' ? 'cancelled' : 'declined',
            message: bridgeRes.message || 'تم إلغاء أو رفض العملية من الماكينة',
          });
          return;
        }
      }
    } catch {
      if (!shouldTryAlternateTerminalCharge(bridgeChargeIssued)) {
        // The terminal may have approved the payment before the ECR response
        // was lost. A second request via backend would double-charge the card.
        setTerminalSession({
          status: 'recovery_required',
          message: 'نتيجة عملية دفع الماكينة غير معروفة. راجع شاشة الماكينة وكشف المعاملة قبل أي خصم جديد. لا ترسل طلب دفع تلقائياً.',
        });
        return;
      }
      // Only a connection/availability failure BEFORE dispatch may fall back.
    }

    // 2. Standard Backend Route fallback
    try {
      const res = await posApi.initiateTerminalCharge({
        amount,
        currency: currentCurrency,
        terminalId: selectedTerminalId || undefined,
      });
      setTerminalSession({
        status: 'waiting',
        transactionId: res.data.transactionId,
        message: 'في انتظار تمرير أو إدخال البطاقة على جهاز الدفع (POS Terminal)...',
      });
    } catch (err: any) {
      setTerminalSession({ status: 'declined', message: err?.message || 'تعذر الاتصال بجهاز نقاط البيع' });
    }
  };

  const handleCancelTerminal = async () => {
    if (terminalSession.status === 'approved' || terminalSession.status === 'recovery_required' ||
        !canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
      toast.warning('لا يمكن اعتبار الخصم المعتمد أو غير المحسوم ملغى دون إثبات الإلغاء من مزود الدفع');
      return;
    }
    const targetTerminal = (activeTerminals.find((t) => t.id === selectedTerminalId) || activeTerminals[0]) as any;
    const rawIp = String(targetTerminal?.ip || targetTerminal?.ipAddress || '').trim();
    const cleanIp = rawIp ? (rawIp.includes(':') ? rawIp.split(':')[0] : rawIp) : '192.168.1.3';
    const cleanPort = targetTerminal?.port || (rawIp && rawIp.includes(':') ? Number(rawIp.split(':')[1]) : 8080);
    const prov = targetTerminal?.provider || 'fawry';

    HardwareBridgeClient.cancelTerminal({
      ip: cleanIp,
      port: cleanPort,
      provider: prov,
      referenceId: terminalSession.transactionId,
    }).catch(() => {});

    if (terminalSession.transactionId) {
      try {
        await posApi.cancelTerminalCharge(terminalSession.transactionId);
      } catch {}
    }
    pos.setTerminalPaymentDetails?.(null);
    setTerminalSession({ status: 'idle' });
  };

  const splitLegStyle = (activeInSplit: boolean) => (
    activeInSplit
      ? { background: '#eef2ff', border: '1.5px solid #170e5e', color: '#170e5e', fontWeight: 800 }
      : undefined
  );
  const isCardSplitActive = isSplitActive && cardVal > 0;
  const isCardLegOrPresetActive = isPaymentActive('card') || isCardSplitActive;
  const paymentRegion = getCheckoutPaymentRegion(isKwdStore, isKsaStore);

  const handlePaymentPresetButtonClick = (action: CheckoutPaymentButtonAction) => {
    if (onSelectPaymentAction) {
      onSelectPaymentAction(action);
      return;
    }
    if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
      toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
      return;
    }
    const targetPreset = resolvePresetForCheckoutAction(action, pos.paymentChannel, paymentRegion);
    onSelectPaymentPreset(targetPreset);
    if (action.kind === 'card') {
      pos.setTerminalPaymentDetails?.({
        ...(pos.terminalPaymentDetails || {}),
        ...(action.cardScheme ? { cardScheme: action.cardScheme } : {}),
        ...(action.provider ? { provider: action.provider } : {}),
      });
    } else {
      pos.setTerminalPaymentDetails?.(null);
    }
  };

  const paymentPresetButtons = getCheckoutPaymentActions(paymentRegion).map((action) => {
    if (action.kind === 'cash') {
      return {
        action,
        label: 'نقدي',
        active: !isSplitActive && isPaymentActive('cash'),
        splitStyle: isSplitActive ? splitLegStyle(cashVal > 0) : undefined,
        fontSize: paymentRegion === 'universal' ? '12.5px' : '12px',
      };
    }
    if (action.kind === 'credit') {
      return {
        action,
        label: 'آجل',
        active: isPaymentActive('credit'),
        splitStyle: undefined,
        fontSize: paymentRegion === 'universal' ? '12.5px' : '12px',
      };
    }
    if (action.kind === 'transfer') {
      return {
        action,
        label: paymentRegion === 'kuwait'
          ? 'روابط دفع / تحويل'
          : paymentRegion === 'ksa'
          ? 'دفع إلكتروني / محافظ'
          : 'تحويلات / محافظ',
        active: !isSplitActive && transferSelected,
        splitStyle: isSplitActive ? splitLegStyle(transferVal > 0) : undefined,
        fontSize: paymentRegion === 'universal' ? '11.5px' : '11px',
      };
    }
    if (action.cardScheme === 'knet') {
      const knetSelected = pos.terminalPaymentDetails?.cardScheme === 'knet' || !pos.terminalPaymentDetails?.cardScheme;
      return {
        action,
        label: 'كي نت K-NET',
        active: !isSplitActive && isPaymentActive('card') && knetSelected,
        splitStyle: isCardSplitActive && knetSelected ? splitLegStyle(true) : undefined,
        fontSize: '11px',
      };
    }
    if (action.cardScheme === 'mada') {
      const madaSelected = pos.terminalPaymentDetails?.cardScheme === 'mada' || !pos.terminalPaymentDetails?.cardScheme;
      return {
        action,
        label: 'مدى mada',
        active: !isSplitActive && isPaymentActive('card') && madaSelected,
        splitStyle: isCardSplitActive && madaSelected ? splitLegStyle(true) : undefined,
        fontSize: '11px',
      };
    }
    if (paymentRegion !== 'universal') {
      const secondaryScheme = paymentRegion === 'kuwait' ? 'knet' : 'mada';
      const visaSelected = Boolean(pos.terminalPaymentDetails?.cardScheme && pos.terminalPaymentDetails?.cardScheme !== secondaryScheme);
      return {
        action,
        label: 'فيزا / ماستر',
        active: !isSplitActive && isPaymentActive('card') && visaSelected,
        splitStyle: isCardSplitActive && visaSelected ? splitLegStyle(true) : undefined,
        fontSize: '11.5px',
      };
    }
    return {
      action,
      label: 'فيزا / كارت',
      active: !isSplitActive && isPaymentActive('card'),
      splitStyle: isSplitActive ? splitLegStyle(cardVal > 0) : undefined,
      fontSize: '12px',
    };
  });

  return (
    <div
      className="pos-checkout-payment-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        flex: isMobile ? undefined : '1 1 auto',
        height: isMobile ? 'auto' : '100%',
        background: '#ffffff',
        padding: isMobile ? '10px 12px' : '11px 14px',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        boxSizing: 'border-box',
      }}
    >
      <PosCheckoutPaymentMethods
        pos={pos}
        isMobile={isMobile}
        paymentPresetButtons={paymentPresetButtons}
        paymentRegion={paymentRegion}
        handlePaymentPresetButtonClick={handlePaymentPresetButtonClick}
        onSelectPaymentPreset={onSelectPaymentPreset}
        isSplitActive={isSplitActive}
        activeLegsCount={activeLegsCount}
        isCodUnpaid={isCodUnpaid}
        transferSelected={transferSelected}
        isKwdStore={isKwdStore}
        isKsaStore={isKsaStore}
        isCreditSale={isCreditSale}
        cardVal={cardVal}
        transferVal={transferVal}
        totalAmount={totalAmount}
        cashVal={cashVal}
        quickCashDenominations={quickCashDenominations}
      />

      <PosCheckoutPaymentLegs
        isMobile={isMobile}
        cashVal={cashVal}
        isCreditSale={isCreditSale}
        remainingUnpaid={remainingUnpaid}
        pos={pos}
        cashAmountInputRef={cashAmountInputRef}
        customerPickerOpen={customerPickerOpen}
        cardVal={cardVal}
        isKwdStore={isKwdStore}
        isKsaStore={isKsaStore}
        isTerminalApproved={isTerminalApproved}
        cardAmountInputRef={cardAmountInputRef}
        transferVal={transferVal}
        transferAmountInputRef={transferAmountInputRef}
      />

      <PosCheckoutDiscountStrip
        isDiscountLocked={isDiscountLocked}
        isMobile={isMobile}
        pos={pos}
        isTerminalApproved={isTerminalApproved}
        isPercentFocused={isPercentFocused}
        percentStr={percentStr}
        setIsPercentFocused={setIsPercentFocused}
        setPercentStr={setPercentStr}
        bookDigits={bookDigits}
        onManagerPinErrorChange={onManagerPinErrorChange}
        onManagerPinDraftChange={onManagerPinDraftChange}
        onManagerApprovalOpenChange={onManagerApprovalOpenChange}
      />

      <PosCheckoutTerminalBanner
        isCardLegOrPresetActive={isCardLegOrPresetActive}
        pos={pos}
        activeTerminals={activeTerminals}
        selectedTerminalId={selectedTerminalId}
        setSelectedTerminalId={setSelectedTerminalId}
        terminalSession={terminalSession}
        handleDispatchTerminal={handleDispatchTerminal}
        onConfirmSale={onConfirmSale}
        handleCancelTerminal={handleCancelTerminal}
      />



      <PosCheckoutApprovalChargesTip
        managerApprovalOpen={managerApprovalOpen}
        isDiscountLocked={isDiscountLocked}
        pos={pos}
        onInlineManagerApproval={onInlineManagerApproval}
        managerPinInputRef={managerPinInputRef}
        managerPinDraft={managerPinDraft}
        onManagerPinDraftChange={onManagerPinDraftChange}
        managerPinError={managerPinError}
        onManagerPinErrorChange={onManagerPinErrorChange}
        onManagerApprovalOpenChange={onManagerApprovalOpenChange}
        approvedManagerPinRef={approvedManagerPinRef}
        isRestaurant={isRestaurant}
        isMobile={isMobile}
        isKwdStore={isKwdStore}
        isKsaStore={isKsaStore}
        isTerminalApproved={isTerminalApproved}
        bookDigits={bookDigits}
      />

      <PosCheckoutPaymentSummary
        isMobile={isMobile}
        pos={pos}
        paidAmount={paidAmount}
        balance={balance}
      />
    </div>
  );
}
