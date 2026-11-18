import { getGlobalSystemCurrency, getSystemCountryCode, isKuwait, isSaudi } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useState, useEffect, useMemo, type FormEvent, type RefObject } from 'react';
import { posApi } from '@/features/pos/api/pos.api';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CreditCardIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
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
      setPercentStr(pos.discount > 0 && pos.totals.subTotal > 0 ? ((pos.discount / pos.totals.subTotal) * 100).toFixed(2).replace(/\.00$/, '') : '');
    }
  }, [pos.discount, pos.totals.subTotal, isPercentFocused]);

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
            value={isPercentFocused ? percentStr : (pos.discount > 0 && pos.totals.subTotal > 0 ? ((pos.discount / pos.totals.subTotal) * 100).toFixed(2).replace(/\.00$/, '') : '')}
            onWheel={(e) => e.currentTarget.blur()}
            onFocus={(e) => { setIsPercentFocused(true); e.currentTarget.select(); }}
            onBlur={() => setIsPercentFocused(false)}
            onChange={(event) => {
              setPercentStr(event.target.value);
              const p = Number(event.target.value || 0);
              pos.setDiscount(roundMoneyValue((p / 100) * pos.totals.subTotal, bookDigits));
            }}
            disabled={isDiscountLocked || isTerminalApproved || pos.totals.subTotal === 0}
            placeholder="0"
            style={{ boxSizing: 'border-box', width: '100%', height: '34px', borderRadius: '6px', fontSize: '13.5px', fontWeight: 700, border: '1px solid #cbd5e1', background: (isDiscountLocked || isTerminalApproved || pos.totals.subTotal === 0) ? '#f1f5f9' : '#ffffff', textAlign: 'center' }}
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

      {/* EDC / Sunmi POS Terminal Direct Dispatch Banner (Active for Card payments when terminal exists) */}
      {(isCardLegOrPresetActive || pos.cardAmount > 0) && (pos.settingsQuery?.data?.posTerminalEnabled === true) && activeTerminals.length > 0 && (
        <div style={{
          padding: '8px 12px',
          background: '#f8fafc',
          borderRadius: '6px',
          border: '1px dashed #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {/* Active Terminal Selector if multiple terminals exist */}
          {activeTerminals.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>ماكينة الدفع:</span>
              {activeTerminals.map((term) => {
                const isSelected = (selectedTerminalId || activeTerminals[0].id) === term.id;
                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setSelectedTerminalId(term.id)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: isSelected ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: isSelected ? '#ede9fe' : '#ffffff',
                      color: isSelected ? '#170e5e' : '#475569',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {term.name || term.provider}
                    {term.isDefault && <span style={{ fontSize: '9px', opacity: 0.8 }}>(افتراضية)</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCardIcon size={18} color="#170e5e" />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                  {activeTerminals.find((t) => t.id === selectedTerminalId)?.name || pos.settingsQuery?.data?.posTerminalName || 'ماكينة الدفع (Sunmi / EDC)'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  إرسال {formatCurrency(pos.cardAmount > 0 ? pos.cardAmount : pos.totals.total)} إلى شاشة جهاز الدفع آلياً
                </div>
              </div>
            </div>
            {terminalSession.status === 'idle' || terminalSession.status === 'declined' || terminalSession.status === 'cancelled' ? (
              <Button
                type="button"
                variant="primary"
                onClick={handleDispatchTerminal}
                style={{ minHeight: '32px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                إرسال للماكينة
              </Button>
            ) : terminalSession.status === 'approved' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckIcon size={14} color="#16a34a" />
                  <span>معتمد ({terminalSession.approvalCode})</span>
                </span>
                {pos.terminalPaymentDetails?.cardScheme ? (
                  <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    {pos.terminalPaymentDetails.cardScheme === 'knet' ? 'KNET كي نت' : pos.terminalPaymentDetails.cardScheme === 'mada' ? 'مدى mada' : pos.terminalPaymentDetails.cardScheme}
                  </span>
                ) : null}
                {onConfirmSale ? (
                  <Button
                    type="button"
                    variant="success"
                    onClick={() => onConfirmSale()}
                    style={{ minHeight: '30px', padding: '0 10px', fontSize: '11.5px', fontWeight: 800 }}
                  >
                    تأكيد الفاتورة (F2)
                  </Button>
                ) : null}
              </div>
            ) : terminalSession.status === 'recovery_required' ? (
              <span role="alert" style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 700 }}>
                {terminalSession.message}
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancelTerminal}
                style={{ minHeight: '30px', fontSize: '11px', color: '#dc2626' }}
              >
                إلغاء
              </Button>
            )}
          </div>

          {(terminalSession.status === 'initiating' || terminalSession.status === 'waiting') && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 10px',
              background: '#eff6ff',
              borderRadius: '4px',
              border: '1px solid #bfdbfe',
              fontSize: '12px',
              color: '#1d4ed8'
            }}>
              <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
              <span>{terminalSession.message}</span>
            </div>
          )}

          {terminalSession.status === 'declined' && (
            <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca', fontSize: '12px', color: '#b91c1c' }}>
              {terminalSession.message}
            </div>
          )}
        </div>
      )}



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
    </div>
  );
}
