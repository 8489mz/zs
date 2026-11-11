import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CreditCardIcon, UserIcon, ChevronDownIcon, ChevronUpIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { isStandalonePosTerminal } from '@/features/pos/lib/pos-shell';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { isTerminalApprovalLive } from '@/features/pos/components/pos-workspace/pos-terminal-charge-safety';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PaymentPreset } from '@/features/pos/components/pos-workspace/PosCheckoutDialogSections';

interface PosCheckoutExpressSectionProps {
  pos: PosWorkspaceState;
  isKwdStore: boolean;
  isKsaStore: boolean;
  isPaymentActive: (preset: PaymentPreset) => boolean;
  onSelectPaymentPreset: (preset: PaymentPreset) => void;
  onConfirmSale: (tenderedAmount?: number) => void;
  onSwitchToDetailed: () => void;
  selectedCustomerName: string;
  onOpenCustomerPicker: () => void;
  onOpenNotes: () => void;
  isNotesOpen: boolean;
  cartQtySummaries: string[];
}

export function PosCheckoutExpressSection({
  pos,
  isKwdStore,
  isKsaStore,
  isPaymentActive,
  onSelectPaymentPreset,
  onConfirmSale,
  onSwitchToDetailed,
  selectedCustomerName,
  onOpenCustomerPicker,
  onOpenNotes: _onOpenNotes,
  isNotesOpen: _isNotesOpen,
  cartQtySummaries,
}: PosCheckoutExpressSectionProps) {
  const { t } = useTranslation();
  // INV-FE1-FRONTEND-BOOK-DIGITS: change/underpaid amounts round at the
  // tenant's book digits (settings currency, global fallback).
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const total = Number(pos.totals.total || 0);
  const [customCashInput, setCustomCashInput] = useState<string>('');
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [terminalDispatchStatus, setTerminalDispatchStatus] = useState<'idle' | 'waiting' | 'approved' | 'declined' | 'manual'>('idle');
  const [terminalMsg, setTerminalMsg] = useState<string>('');
  const [manualAuthCode, setManualAuthCode] = useState<string>('');
  const [isManualCardConfirmed, setIsManualCardConfirmed] = useState<boolean>(false);

  const parsedCash = Number(customCashInput.trim());
  const hasCustomCash = customCashInput.trim() !== '' && !isNaN(parsedCash) && parsedCash >= 0;
  const effectiveReceivedCash = hasCustomCash ? parsedCash : total;
  const changeDue = effectiveReceivedCash >= total ? roundMoneyValue(effectiveReceivedCash - total, bookDigits) : 0;
  const underpaidAmount = effectiveReceivedCash < total ? roundMoneyValue(total - effectiveReceivedCash, bookDigits) : 0;

  const isTerminalHardwareManaged = useMemo(() => Boolean(
    isStandalonePosTerminal() ||
    (typeof window !== 'undefined' && Boolean((window as any).AndroidBridge?.requestPayment || (window as any).SmartPos?.requestPayment || (window as any).SunmiPay?.sale)) ||
    pos.settings?.posTerminalEnabled ||
    (pos.settingsQuery?.data as any)?.posTerminalEnabled
  ), [pos.settings?.posTerminalEnabled, pos.settingsQuery?.data]);

  // INV-REST-EXPRESS-AMOUNT-SYNC: the typed received amount must be in
  // workspace state BEFORE confirm runs. handleSubmit reads the legs from
  // render-captured params, so the setCashAmount/setCardAmount calls in the
  // confirm handler itself arrive one render too late — and the F2 path
  // never sets them at all. Sync the legs here, on every change of the
  // received amount or the active preset, from the same source of truth the
  // tendered amount already follows. When neither cash nor card is active
  // the legs are left untouched: credit legs are zeroed by the workspace
  // itself, and a detailed-view split belongs to the detailed view until
  // express confirm overwrites it, exactly as today.
  useEffect(() => {
    if (isPaymentActive('cash')) {
      pos.setCashAmount?.(effectiveReceivedCash);
      pos.setCardAmount?.(0);
      pos.setTransferAmount?.(0);
      pos.setTenderedAmount?.(effectiveReceivedCash);
    } else if (isPaymentActive('card')) {
      // INV-REST-PAID-GATES-2 (R4-D, I40): never overwrite the card
      // leg with the current total while a terminal approval is live —
      // the approved amount is the leg, and the submit gate pins it.
      if (!isTerminalApprovalLive(pos.terminalPaymentDetails)) {
        pos.setCardAmount?.(total);
      }
      pos.setCashAmount?.(0);
      pos.setTransferAmount?.(0);
      pos.setTenderedAmount?.(0);
    } else {
      pos.setTenderedAmount?.(0);
    }
  }, [effectiveReceivedCash, isPaymentActive, pos, total]);

  const handleConfirmManualPayment = () => {
    const code = manualAuthCode.trim() || 'MANUAL-OK';
    const defaultProvider = isKwdStore ? 'knet' : isKsaStore ? 'mada' : 'manual_terminal';
    pos.setTerminalPaymentDetails?.({
      ...(pos.terminalPaymentDetails || {}),
      authCode: code,
      // INV-REST-PAID-GATES-2 (R4-D, I40): the manual confirm is an
      // approval site too — record the approved amount so the submit
      // gate pins the card leg to it.
      approvedAmount: total,
      rrn: code,
      cardScheme: isKwdStore ? 'knet' : isKsaStore ? 'mada' : 'visa',
      provider: defaultProvider,
    });
    onSelectPaymentPreset('card');
    pos.setCardAmount?.(total);
    pos.setCashAmount?.(0);
    pos.setTransferAmount?.(0);
    pos.setPaymentChannel?.('card');
    setIsManualCardConfirmed(true);
    setTerminalDispatchStatus('approved');
    setTerminalMsg(isKwdStore ? `تم اعتماد إيصال كي نت اليدوي (مرجع: ${code})` : `تم اعتماد إيصال الدفع اليدوي (مرجع: ${code})`);
    toast.success(isKwdStore ? `تم تسجيل مرجع إيصال كي نت (${code}) وتفعيل إتمام البيع` : `تم تسجيل مرجع الدفع اليدوي (${code})`);
  };

  const handleSelectCard = async () => {
    onSelectPaymentPreset('card');
    pos.setCardAmount?.(total);
    pos.setCashAmount?.(0);
    pos.setTransferAmount?.(0);
    pos.setPaymentChannel?.('card');
    setCustomCashInput('');

    const currency = isKwdStore ? 'KWD' : isKsaStore ? 'SAR' : (pos.settings?.currency || (pos.settingsQuery?.data as any)?.currency || 'EGP');
    const defaultProvider = isKwdStore ? 'knet' : isKsaStore ? 'geidea' : 'fawry';

    pos.setTerminalPaymentDetails?.({
      ...(pos.terminalPaymentDetails || {}),
      cardScheme: isKwdStore ? 'knet' : isKsaStore ? 'mada' : 'visa',
      provider: defaultProvider,
    });

    const { MobileTerminalBridge } = await import('@/features/pos/lib/mobile-terminal-bridge');
    const caps = await MobileTerminalBridge.getCapabilities();
    const isTerminalEnabled = Boolean(pos.settings?.posTerminalEnabled || (pos.settingsQuery?.data as any)?.posTerminalEnabled);

    // If handheld Smart POS or terminal bridge is available, dispatch payment pulse
    if (caps.canDirectPay || isTerminalEnabled) {
      setTerminalDispatchStatus('waiting');
      setTerminalMsg(t('pos.terminal_waiting_pulse', 'جاري إرسال نبضة الدفع للماكينة...'));

      try {
        const result = await MobileTerminalBridge.requestPayment({
          amount: total,
          currency,
          config: {
            provider: defaultProvider as any,
          },
        });

        if (result.success && result.status === 'approved') {
          const authCode = result.authCode || 'APPROVED';
          const rrn = result.rrn || `TX-${Date.now()}`;
          const scheme = result.cardScheme || (isKwdStore ? 'knet' : isKsaStore ? 'mada' : 'visa');
          const lastFour = result.cardLastFour || '';

          setTerminalDispatchStatus('approved');
          setTerminalMsg(`تمت الموافقة بنجاح (تفويض: ${authCode})`);

          pos.setTerminalPaymentDetails?.({
            authCode,
            rrn,
            cardScheme: scheme,
            cardLastFour: lastFour,
            provider: defaultProvider,
          });

          toast.success(t('pos.terminal_payment_approved', 'تمت الموافقة على الدفع من الماكينة بنجاح'));

          const autoFinalize = Boolean(pos.settings?.posTerminalAutoFinalize || (pos.settingsQuery?.data as any)?.posTerminalAutoFinalize);
          if (autoFinalize) {
            setTimeout(() => {
              onConfirmSale();
            }, 800);
          }
        } else {
          setTerminalDispatchStatus('declined');
          setTerminalMsg(result.message || t('pos.terminal_payment_declined', 'تم إلغاء أو رفض العملية من الماكينة'));
        }
      } catch (err: any) {
        setTerminalDispatchStatus('declined');
        setTerminalMsg(err?.message || t('pos.terminal_connection_error', 'تعذر الاتصال بماكينة الدفع'));
      }
    } else {
      // Standard desktop PC / laptop POS without integrated terminal hardware:
      // Keep idle so confirm button is immediately ready while allowing optional reference
      setTerminalDispatchStatus('idle');
    }
  };

  // Compute smart cash banknote denomination shortcuts >= total
  const cashDenominations = useMemo(() => {
    if (total <= 0) return [];
    if (isKwdStore) {
      const bases = [1, 5, 10, 20];
      const valid = bases.filter((b) => b >= total);
      if (valid.length === 0) valid.push(Math.ceil(total));
      return Array.from(new Set(valid)).slice(0, 4);
    }

    if (isKsaStore) {
      const saBanknotes = [5, 10, 20, 50, 100, 200, 500];
      const valid = saBanknotes.filter((b) => b >= total);
      if (valid.length === 0) {
        valid.push(Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500);
      }
      return Array.from(new Set(valid)).slice(0, 4);
    }

    // Egypt & General currency real banknotes: 20, 50, 100, 200 (and 500 / 1000 for large totals)
    const egBanknotes = [20, 50, 100, 200];
    let presets = egBanknotes.filter((b) => b >= total);
    if (presets.length < 4) {
      if (total > 200) {
        const nextFifty = Math.ceil(total / 50) * 50;
        const nextHundred = Math.ceil(total / 100) * 100;
        presets = [nextFifty, nextHundred, nextHundred + 100, nextHundred + 200];
      } else {
        presets = Array.from(new Set([Math.ceil(total), ...presets, 200, 500]));
      }
    }
    return Array.from(new Set(presets.filter((p) => p >= total))).slice(0, 4);
  }, [total, isKwdStore, isKsaStore]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
      {/* 1. Big Hero Total Display */}
      <div
        style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: '1.5px solid #cbd5e1',
          borderRadius: '12px',
          padding: '12px 16px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b' }}>
          {t('pos.total_amount_due', 'المطلوب سداده')}
        </span>
        <div
          style={{
            fontSize: '28px',
            fontWeight: 900,
            color: '#170e5e',
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            margin: '2px 0 4px',
          }}
        >
          {formatCurrency(total)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
          <span style={{ background: '#e2e8f0', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>
            {pos.cart.length} {t('pos.items', 'أصناف')}
          </span>
          <span>•</span>
          <span style={{ background: '#e2e8f0', padding: '1px 7px', borderRadius: '4px', fontWeight: 700 }}>
            {cartQtySummaries.length ? cartQtySummaries.join(' + ') : '0'} {t('pos.pieces', 'قطعة')}
          </span>
          {selectedCustomerName && (
            <>
              <span>•</span>
              <span style={{ color: '#170e5e', fontWeight: 800 }}>
                {selectedCustomerName}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 2. Large 1-Tap Touch Payment Tiles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Tile A: Electronic Card / K-NET */}
        <button
          type="button"
          onClick={handleSelectCard}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '10px',
            border: isPaymentActive('card') ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: isPaymentActive('card') ? '#170e5e' : '#ffffff',
            color: isPaymentActive('card') ? '#ffffff' : '#0f172a',
            cursor: 'pointer',
            transition: 'all 0.12s ease',
            boxShadow: isPaymentActive('card') ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: isPaymentActive('card') ? 'rgba(255,255,255,0.18)' : '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CreditCardIcon size={20} color={isPaymentActive('card') ? '#ffffff' : '#170e5e'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'right' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 800 }}>
                {isKwdStore ? 'كي نت K-NET' : isKsaStore ? 'شبكة / مدى mada' : 'فيزا / كارت / Apple Pay'}
              </span>
              <span style={{ fontSize: '10.5px', opacity: 0.8, color: isPaymentActive('card') ? '#e2e8f0' : '#64748b' }}>
                {isKwdStore ? 'بطاقات البنوك الكويتية والدفع الإلكتروني' : isKsaStore ? 'بطاقات مدى والائتمان' : 'دفع إلكتروني معتمد بالماكينة'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isPaymentActive('card') && (
              <span
                style={{
                  background: '#10b981',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <CheckIcon size={12} />
                <span>{formatCurrency(total)}</span>
              </span>
            )}
          </div>
        </button>

        {/* Live Feedback for Handheld Smart POS & Terminal Dispatch */}
        {isPaymentActive('card') && isTerminalHardwareManaged && terminalDispatchStatus === 'idle' && !isManualCardConfirmed && !pos.terminalPaymentDetails?.authCode && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
              {isKwdStore ? 'في انتظار تمرير البطاقة بالماكينة أو إتمام البيع يدوياً' : 'في انتظار تأكيد عملية الدفع بالبطاقة'}
            </span>
            <button
              type="button"
              onClick={() => setTerminalDispatchStatus('manual')}
              style={{
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                color: '#170e5e',
                fontSize: '11px',
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: '5px',
                cursor: 'pointer',
              }}
            >
              إتمام يدوي (ماكينة خارجية)
            </button>
          </div>
        )}

        {/* Optional Manual Reference for Desktop PC */}
        {isPaymentActive('card') && !isTerminalHardwareManaged && terminalDispatchStatus === 'idle' && !isManualCardConfirmed && !pos.terminalPaymentDetails?.authCode && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-4px' }}>
            <button
              type="button"
              onClick={() => setTerminalDispatchStatus('manual')}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '11px',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontFamily: 'inherit',
              }}
            >
              {isKwdStore ? 'تسجيل رقم إيصال كي نت (اختياري)' : 'تسجيل رقم مرجع الإيصال (اختياري)'}
            </button>
          </div>
        )}

        {isPaymentActive('card') && terminalDispatchStatus === 'waiting' && (
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#1e40af', fontWeight: 700 }}>
                {t('pos.terminal_waiting_card', 'في انتظار تمرير أو إدخال البطاقة أو الهاتف على الماكينة...')}
              </span>
              <button
                type="button"
                onClick={() => {
                  import('@/features/pos/lib/mobile-terminal-bridge').then(m => m.MobileTerminalBridge.cancelPayment()).catch(() => {});
                  setTerminalDispatchStatus('idle');
                  setTerminalMsg('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel', 'إلغاء')}
              </button>
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b' }}>
              {t('pos.terminal_waiting_hint', 'يتم التواصل مع الماكينة تلقائياً. يمكنك الضغط على إلغاء للإتمام اليدوي.')}
            </div>
          </div>
        )}

        {isPaymentActive('card') && terminalDispatchStatus === 'approved' && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckIcon size={14} color="#16a34a" />
              <span style={{ fontSize: '12px', color: '#166534', fontWeight: 800 }}>
                {terminalMsg || t('pos.terminal_approved_badge', 'تمت الموافقة بنجاح من الماكينة')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsManualCardConfirmed(false);
                setTerminalDispatchStatus('idle');
                setTerminalMsg('');
                pos.setTerminalPaymentDetails?.(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '11px',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              تغيير
            </button>
          </div>
        )}

        {isPaymentActive('card') && terminalDispatchStatus === 'declined' && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: 700, lineHeight: 1.5, flex: 1, textAlign: 'right' }}>
                {terminalMsg || t('pos.terminal_declined_badge', 'تعذر إتمام الدفع بالماكينة')}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', flexShrink: 0, minWidth: '95px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setTerminalDispatchStatus('manual');
                    setTerminalMsg('');
                  }}
                  style={{
                    background: '#170e5e',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    padding: '5px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('pos.manual_override', 'إتمام يدوي')}
                </button>
                <button
                  type="button"
                  onClick={handleSelectCard}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('common.retry', 'إعادة المحاولة')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Terminal Fallback Card (Standalone Bank POS in Kuwait / Retail) */}
        {isPaymentActive('card') && terminalDispatchStatus === 'manual' && (
          <div
            style={{
              background: '#f8fafc',
              border: '1.5px solid #170e5e',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CreditCardIcon size={16} color="#170e5e" />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
                  {isKwdStore ? 'إتمام يدوي عبر ماكينة كي نت (الوضع المستقل)' : 'إتمام يدوي عبر ماكينة الدفع الخارجية'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTerminalDispatchStatus('idle');
                  setTerminalMsg('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel', 'إلغاء')}
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {isKwdStore
                ? 'مرر البطاقة على ماكينة البنك وسجل رقم الموافقة (Auth Code / Ref) من الإيصال الورقي لتفعيل زر البيع.'
                : 'أدخل رقم مرجع الإيصال من ماكينة البنك المستقلة لتأكيد البيع.'}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={manualAuthCode}
                onChange={(e) => setManualAuthCode(e.target.value)}
                placeholder="مثال: 392616 (رقم مرجع الإيصال)"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
              />
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmManualPayment}
                style={{
                  minHeight: '32px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  fontWeight: 800,
                  background: '#170e5e',
                  color: '#ffffff',
                }}
              >
                اعتماد وتفعيل البيع
              </Button>
            </div>
          </div>
        )}

        {/* Tile B: Cash */}
        <button
          type="button"
          onClick={() => {
            onSelectPaymentPreset('cash');
            pos.setCashAmount?.(effectiveReceivedCash);
            pos.setCardAmount?.(0);
            pos.setTransferAmount?.(0);
            pos.setPaymentChannel?.('cash');
            setTerminalDispatchStatus('idle');
            setTerminalMsg('');
            setIsManualCardConfirmed(false);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '10px',
            border: isPaymentActive('cash') ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: isPaymentActive('cash') ? '#170e5e' : '#ffffff',
            color: isPaymentActive('cash') ? '#ffffff' : '#0f172a',
            cursor: 'pointer',
            transition: 'all 0.12s ease',
            boxShadow: isPaymentActive('cash') ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: isPaymentActive('cash') ? 'rgba(255,255,255,0.18)' : '#f0fdf4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: isPaymentActive('cash') ? '#ffffff' : '#16a34a',
                fontSize: '18px',
                fontWeight: 900,
              }}
            >
              $
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'right' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 800 }}>
                {t('pos.cash_payment', 'نقدي / كاش Cash')}
              </span>
              <span style={{ fontSize: '10.5px', opacity: 0.8, color: isPaymentActive('cash') ? '#e2e8f0' : '#64748b' }}>
                {t('pos.cash_payment_desc', 'الدفع بالعملة الورقية وحساب المتبقي')}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isPaymentActive('cash') && (
              <span
                style={{
                  background: '#10b981',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <CheckIcon size={12} />
                <span>{formatCurrency(total)}</span>
              </span>
            )}
          </div>
        </button>

        {/* Quick Cash Denomination & Change Calculator (Shown when Cash is active) */}
        {isPaymentActive('cash') && (
          <div
            style={{
              background: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: '#334155', fontWeight: 800 }}>
              <span>{t('pos.received_cash_hint', 'المبلغ المستلم من العميل (لحساب الباقي):')}</span>
              {hasCustomCash && (
                <button
                  type="button"
                  onClick={() => setCustomCashInput('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    padding: '2px 4px',
                  }}
                >
                  {t('common.clear_reset_default', 'مسح (استعادة التلقائي)')}
                </button>
              )}
            </div>

            {/* Input Row: Custom Cash Amount Input + Exact Cash Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder={String(total)}
                  value={customCashInput}
                  onChange={(e) => setCustomCashInput(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    width: '100%',
                    height: '40px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: hasCustomCash ? '2px solid #170e5e' : '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '16px',
                    fontWeight: 800,
                    color: '#0f172a',
                    textAlign: 'center',
                    outline: 'none',
                    boxShadow: hasCustomCash ? '0 0 0 2px rgba(23, 14, 94, 0.1)' : 'none',
                  }}
                />
              </div>

              {/* Exact cash shortcut / indicator */}
              <button
                type="button"
                onClick={() => setCustomCashInput('')}
                title={t('pos.exact_amount_hint', 'العميل دفع المبلغ المطلوب بالضبط')}
                style={{
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: !hasCustomCash ? '1.5px solid #10b981' : '1px solid #cbd5e1',
                  background: !hasCustomCash ? '#ecfdf5' : '#ffffff',
                  color: !hasCustomCash ? '#065f46' : '#64748b',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.12s ease',
                  flexShrink: 0,
                }}
              >
                {!hasCustomCash && <CheckIcon size={13} color="#10b981" />}
                <span>{t('pos.exact_cash', 'المبلغ بالضبط')}</span>
              </button>
            </div>

            {/* Quick Banknote Shortcuts */}
            {cashDenominations.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {cashDenominations.map((denom) => {
                  const isSelected = hasCustomCash ? parsedCash === denom : denom === total;
                  return (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => setCustomCashInput(String(denom))}
                      style={{
                        flex: '1 1 0',
                        minWidth: '52px',
                        padding: '6px 4px',
                        borderRadius: '6px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                        background: isSelected ? '#170e5e' : '#ffffff',
                        color: isSelected ? '#ffffff' : '#0f172a',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.1s ease',
                      }}
                    >
                      {denom}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Real-time Calculation Banner */}
            {changeDue > 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#ecfdf5',
                  border: '1.5px solid #10b981',
                  color: '#065f46',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{t('pos.change_due', 'الباقي للعميل:')}</span>
                  <span style={{ fontSize: '11px', color: '#047857', fontWeight: 600 }}>
                    ({t('pos.received', 'المستلم')}: {formatCurrency(effectiveReceivedCash)})
                  </span>
                </div>
                <span style={{ fontSize: '16px', color: '#047857', fontWeight: 900 }}>
                  {formatCurrency(changeDue)}
                </span>
              </div>
            ) : underpaidAmount > 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#b45309',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: 800,
                }}
              >
                <span>{t('pos.underpaid_warning', 'المبلغ أقل من المطلوب بمقدار:')}</span>
                <span style={{ fontSize: '14px', color: '#dc2626', fontWeight: 900 }}>
                  {formatCurrency(underpaidAmount)}
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  color: '#64748b',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                }}
              >
                <span>{t('pos.change_due', 'الباقي للعميل:')}</span>
                <span style={{ fontSize: '12.5px', color: '#10b981', fontWeight: 800 }}>
                  {formatCurrency(0)} ({t('pos.exact_paid', 'مسدد بالكامل')})
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tile C: Wallets / Electronic Links - مخفي مؤقتاً في ماكينة الدفع المتنقلة للتركيز على الكاش وكي نت المباشر */}
      </div>

      {/* 3. Collapsible Additional Options (+ خيارات إضافية) */}
      <div style={{ marginTop: '2px' }}>
        <button
          type="button"
          onClick={() => setShowMoreOptions((prev) => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '7px 10px',
            borderRadius: '8px',
            background: showMoreOptions ? '#f1f5f9' : '#f8fafc',
            border: '1px solid #e2e8f0',
            color: '#475569',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span>{showMoreOptions ? t('pos.hide_extra_options', 'إخفاء الخيارات الإضافية') : t('pos.show_extra_options', '+ خيارات إضافية (ربط عميل، ملاحظات، بيع آجل)')}</span>
          {showMoreOptions ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
        </button>

        {showMoreOptions && (
          <div
            style={{
              marginTop: '6px',
              padding: '10px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {/* Customer Link Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={onOpenCustomerPicker}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  minHeight: '32px',
                }}
              >
                <UserIcon size={14} />
                <span>{selectedCustomerName ? `العميل: ${selectedCustomerName}` : t('pos.link_customer_opt', 'ربط الفاتورة بعميل')}</span>
              </Button>

              {/* Credit Sale Button */}
              <Button
                type="button"
                variant={pos.paymentType === 'credit' ? 'primary' : 'secondary'}
                onClick={() => {
                  onSelectPaymentPreset('credit');
                  if (!pos.customerId) onOpenCustomerPicker();
                }}
                style={{ fontSize: '11.5px', minHeight: '32px' }}
              >
                {t('pos.credit_sale', 'بيع آجل')}
              </Button>
            </div>

            {/* Note input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                value={pos.note}
                onChange={(e) => pos.setNote(e.target.value)}
                placeholder={t('pos.optional_order_notes', 'ملاحظات اختيارية على الفاتورة...')}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: '11.5px',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                }}
              />
            </div>

            {/* Switch to Full Detailed View link */}
            <div style={{ textAlign: 'center', marginTop: '2px' }}>
              <button
                type="button"
                onClick={onSwitchToDetailed}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t('pos.switch_to_detailed_view', 'الانتقال إلى شاشة الدفع التفصيلية الكاملة ⚙')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Action Buttons */}
      {(() => {
        const isCardPayment = isPaymentActive('card');
        const isCardReady = !isCardPayment || !isTerminalHardwareManaged || terminalDispatchStatus === 'approved' || isManualCardConfirmed || Boolean(pos.terminalPaymentDetails?.authCode || pos.terminalPaymentDetails?.rrn);
        const isCardBlocked = isCardPayment && isTerminalHardwareManaged && !isCardReady;
        const canConfirmNow = !pos.createSale.isPending && !isCardBlocked && pos.canSubmitSale;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
            <Button
              type="button"
              variant={canConfirmNow ? 'success' : 'secondary'}
              onClick={() => {
                if (pos.createSale.isPending) return;
                if (isCardBlocked) {
                  toast.warning(t('pos.card_payment_required_notice', 'يرجى إتمام عملية الدفع بالماكينة أو اعتماد الإيصال اليدوي أولاً'));
                  return;
                }
                if (isPaymentActive('cash')) {
                  pos.setCashAmount?.(effectiveReceivedCash);
                  pos.setCardAmount?.(0);
                  pos.setPaymentChannel?.('cash');
                  onConfirmSale(effectiveReceivedCash);
                } else {
                  // INV-REST-PAID-GATES-2 (R4-D, I40): never overwrite
                  // the card leg with the current total while a
                  // terminal approval is live — the approved amount
                  // is the leg, and the submit gate pins it.
                  if (!isTerminalApprovalLive(pos.terminalPaymentDetails)) {
                    pos.setCardAmount?.(total);
                  }
                  pos.setCashAmount?.(0);
                  pos.setPaymentChannel?.('card');
                  onConfirmSale();
                }
              }}
              disabled={!canConfirmNow}
              style={{
                height: '46px',
                fontSize: '14.5px',
                fontWeight: 800,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: canConfirmNow ? '#10b981' : '#f1f5f9',
                color: canConfirmNow ? '#ffffff' : '#64748b',
                border: canConfirmNow ? 'none' : '1.5px solid #cbd5e1',
                boxShadow: canConfirmNow ? '0 2px 4px rgba(16, 185, 129, 0.25)' : 'none',
                cursor: canConfirmNow ? 'pointer' : 'not-allowed',
              }}
            >
              {canConfirmNow && <CheckIcon size={18} />}
              <span>
                {pos.createSale.isPending
                  ? t('common.saving', 'جاري الحفظ...')
                  : isCardBlocked
                  ? (terminalDispatchStatus === 'waiting'
                      ? t('pos.terminal_waiting_button', 'في انتظار استجابة الماكينة...')
                      : terminalDispatchStatus === 'declined'
                      ? t('pos.terminal_declined_button', 'تعذر الاتصال (اضغط إتمام يدوي أو كاش)')
                      : terminalDispatchStatus === 'manual'
                      ? t('pos.terminal_manual_button', 'سجل رقم إيصال K-NET واضغط اعتماد')
                      : t('pos.terminal_idle_button', 'في انتظار دفع كي نت بالماكينة'))
                  : t('pos.confirm_sale_f2', 'تأكيد البيع والطباعة (F2)')}
              </span>
            </Button>
            {pos.adminDiscountWarning && (
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
                }}
              >
                {pos.adminDiscountWarning}
              </div>
            )}
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
                }}
              >
                {pos.canSubmitHint}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
