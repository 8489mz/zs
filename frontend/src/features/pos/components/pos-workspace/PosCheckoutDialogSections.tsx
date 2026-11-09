import { createPortal } from 'react-dom';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency, getSystemCountryCode, isKuwait, isSaudi } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useState, useEffect, useMemo, useRef, useCallback, type FormEvent, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '@/shared/api/customers.api';
import { posApi } from '@/features/pos/api/pos.api';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CreditCardIcon, StarIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { shouldTryAlternateTerminalCharge, canChangePaymentAfterTerminalApproval, isTerminalApprovalLive, terminalAuthorizationLabel } from './pos-terminal-charge-safety';
import { toast } from '@/shared/components/system-alert';
import { getBalanceState } from '@/features/pos/lib/pos-balance-state';
import { useAuthStore } from '@/stores/auth-store';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

export type PaymentPreset = 'cash' | 'card' | 'wallet' | 'instapay' | 'credit';

type CustomerOption = { id: string | number; name: string; phone?: string | null; address?: string | null };

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

export interface PosCheckoutCustomerSectionProps {
  pos: PosWorkspaceState;
  selectedCustomerName: string;
  selectedCustomer: CustomerOption | null;
  filteredCustomers: CustomerOption[];
  customerPickerOpen: boolean;
  customerQuery: string;
  onCustomerPickerOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onCustomerQueryChange: (value: string) => void;
  onQuickCustomerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  needsCustomer?: boolean;
  isManualOpen?: boolean;
  onManualOpen?: () => void;
  isMobile?: boolean;
}

export function PosCheckoutCustomerSection({
  pos,
  selectedCustomerName,
  selectedCustomer,
  filteredCustomers,
  customerQuery,
  onCustomerPickerOpenChange,
  onCustomerQueryChange,
  onQuickCustomerSubmit,
  needsCustomer,
  isManualOpen,
  onManualOpen,
  isMobile: isMobileProp,
}: PosCheckoutCustomerSectionProps) {
  // INV-FE1-FRONTEND-BOOK-DIGITS: loyalty money values round at the
  // tenant's book digits (settings currency, global fallback).
  const bookDigits = currencyMoneyDigits(pos.settings?.currency || pos.settingsQuery?.data?.currency || getGlobalSystemCurrency());
  const isMobileHook = useIsMobile(860);
  const isMobile = isMobileProp ?? isMobileHook;
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressesQuery = useQuery({
    queryKey: ['customerAddresses', pos.customerId],
    queryFn: () => pos.customerId ? customersApi.addresses(pos.customerId) : Promise.resolve([]),
    enabled: !!pos.customerId,
  });

  const addresses = Array.from(new Set([
    ...(selectedCustomer?.address ? [selectedCustomer.address] : []),
    ...(addressesQuery.data || [])
  ])).filter(Boolean);

  const customerPosSummaryQuery = useQuery({
    queryKey: ['posCustomerSummaryCheckout', pos.customerId],
    queryFn: () => pos.customerId ? posApi.customerPosSummary(String(pos.customerId)) : Promise.resolve(null),
    enabled: !!pos.customerId,
    staleTime: 30_000,
  });
  const loyaltyPoints = Number(customerPosSummaryQuery.data?.loyaltyPoints || 0);

  const [isAddingCustomer, setIsAddingCustomer] = useState(false);

  const handleSelectCustomer = (id: string, phone: string, address: string) => {
    pos.setCustomerId(id);
    pos.setQuickCustomerPhone(phone);
    pos.setQuickCustomerAddress(address);
    pos.setLoyaltyPointsRedeemed?.(0);
    setIsAddingCustomer(false);
    onCustomerQueryChange('');
    onCustomerPickerOpenChange(false);
  };

  const isHidden = !needsCustomer && !isManualOpen && !pos.customerId;

  if (isHidden) {
    return (
      <section className="pos-checkout-dialog-section pos-checkout-customer-section" style={{ padding: 0, marginBottom: '6px' }}>
        <Button type="button" variant="secondary" onClick={onManualOpen} style={{ width: '100%', borderStyle: 'dashed', minHeight: '34px', fontSize: '13px' }}>
          + ربط الفاتورة ببيانات عميل (اختياري)
        </Button>
      </section>
    );
  }

  return (
    <section className="pos-checkout-dialog-section pos-checkout-customer-section" style={{ padding: 0, marginBottom: '6px' }}>
      {!pos.customerId ? (
        isAddingCustomer ? (
          <form onSubmit={onQuickCustomerSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
            <input
              autoFocus
              value={pos.quickCustomerName}
              onChange={(event) => pos.setQuickCustomerName(event.target.value)}
              placeholder="اسم العميل *"
              disabled={pos.quickCustomerMutation.isPending}
              style={{ flex: 1.5, padding: '6px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', height: '38px' }}
            />
            <input
              value={pos.quickCustomerPhone}
              onChange={(event) => pos.setQuickCustomerPhone(event.target.value)}
              placeholder="الهاتف"
              disabled={pos.quickCustomerMutation.isPending}
              style={{ flex: 1.2, padding: '6px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', height: '38px' }}
            />
            <input
              value={pos.quickCustomerAddress}
              onChange={(event) => pos.setQuickCustomerAddress(event.target.value)}
              placeholder="العنوان (اختياري)"
              disabled={pos.quickCustomerMutation.isPending}
              style={{ flex: 2, padding: '6px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', height: '38px' }}
            />
            <Button type="submit" variant="primary" style={{ flex: '0 0 auto', height: '38px', whiteSpace: 'nowrap', fontSize: '13px', borderRadius: '6px', padding: '0 12px' }} disabled={pos.quickCustomerMutation.isPending || !pos.quickCustomerName.trim()}>
              {pos.quickCustomerMutation.isPending ? 'جاري...' : 'حفظ'}
            </Button>
            <Button type="button" variant="secondary" style={{ flex: '0 0 auto', height: '38px', whiteSpace: 'nowrap', fontSize: '13px', borderRadius: '6px', padding: '0 10px' }} onClick={() => setIsAddingCustomer(false)}>
              إلغاء
            </Button>
          </form>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', position: 'relative' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                autoFocus
                value={customerQuery}
                onChange={(event) => onCustomerQueryChange(event.target.value)}
                placeholder="ابحث عن عميل بالاسم أو رقم الهاتف..."
                style={{ width: '100%', padding: '8px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', height: '38px' }}
              />
              {customerQuery.trim() && (
                <div className="pos-checkout-customer-results" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: '4px', background: '#fff', borderRadius: '8px', padding: '6px', border: '1px solid #cbd5e1', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: '200px', overflowY: 'auto' }}>
                  {filteredCustomers.length ? filteredCustomers.map((customer) => {
                    const isSelected = String(customer.id) === String(pos.customerId);
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        className={`pos-checkout-customer-result ${isSelected ? 'is-selected' : ''}`.trim()}
                        onClick={() => handleSelectCustomer(String(customer.id), customer.phone || '', customer.address || '')}
                        style={{ width: '100%', textAlign: 'right', display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '4px', border: 'none', background: isSelected ? '#eff6ff' : 'transparent', cursor: 'pointer' }}
                      >
                        <strong>{customer.name}</strong>
                        <span className="muted small">{customer.phone || 'بدون هاتف'}</span>
                      </button>
                    );
                  }) : (
                    <div className="surface-note" style={{ padding: '8px', fontSize: '13px' }}>
                      لا توجد نتائج لـ "{customerQuery}".
                      <Button type="button" variant="secondary" style={{ marginTop: '8px', width: '100%', height: '34px' }} onClick={() => {
                        pos.setQuickCustomerName(customerQuery);
                        setIsAddingCustomer(true);
                      }}>
                        إضافة "{customerQuery}" كعميل جديد
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                pos.setQuickCustomerName(customerQuery);
                setIsAddingCustomer(true);
              }}
              style={{ flex: '0 0 auto', height: '38px', whiteSpace: 'nowrap', fontSize: '13px', borderRadius: '6px', padding: '0 12px' }}
            >
              + عميل جديد
            </Button>
          </div>
        )
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr auto' : 'minmax(140px, 1.2fr) minmax(110px, 1fr) minmax(160px, 2fr) auto',
          gap: '8px',
          alignItems: 'center',
          background: '#fff',
          padding: '8px 10px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          width: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, flexShrink: 0 }}>العميل:</span>
            <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedCustomer?.name || pos.quickCustomerName || (selectedCustomerName !== 'عميل نقدي' ? selectedCustomerName : '') || 'عميل نقدي'}
            </strong>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleSelectCustomer('', '', '')}
            style={{ flexShrink: 0, height: '32px', padding: '0 12px', fontSize: '12px', borderRadius: '6px' }}
          >
            تغيير
          </Button>
          <div style={{ minWidth: 0, gridColumn: isMobile ? '1 / -1' : undefined }}>
            <input
              value={pos.quickCustomerPhone || selectedCustomer?.phone || ''}
              onChange={(event) => pos.setQuickCustomerPhone(event.target.value)}
              placeholder="رقم الهاتف"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '13px', height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
            />
          </div>
          <div style={{ minWidth: 0, position: 'relative', gridColumn: isMobile ? '1 / -1' : undefined }}>
            <input
              value={pos.quickCustomerAddress || selectedCustomer?.address || ''}
              onChange={(event) => pos.setQuickCustomerAddress(event.target.value)}
              onFocus={() => setAddressDropdownOpen(true)}
              onBlur={() => setTimeout(() => setAddressDropdownOpen(false), 200)}
              placeholder="العنوان أو المكان"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '13px', height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
            />
            {addressDropdownOpen && addresses.length > 0 && (
              <div className="pos-checkout-customer-results" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: '2px', background: '#fff', borderRadius: '6px', padding: '4px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                {addresses.map((addr, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="pos-checkout-customer-result"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pos.setQuickCustomerAddress(addr);
                      setAddressDropdownOpen(false);
                    }}
                    style={{ width: '100%', textAlign: 'right', padding: '6px 10px', fontSize: '12px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                  >
                    <strong>{addr}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {pos.customerId && (pos.settings?.loyaltyEnabled === true) && (loyaltyPoints > 0 || (pos.loyaltyPointsRedeemed || 0) > 0) ? (() => {
        const pointValue = Number(pos.settings?.loyaltyPointRedeemValue ?? 0.1);
        const minPoints = Number(pos.settings?.loyaltyMinRedeemPoints ?? 50);
        const maxPct = Number(pos.settings?.loyaltyMaxDiscountPercentage ?? 100);
        const discountInCurrency = roundMoneyValue((pos.loyaltyPointsRedeemed || 0) * pointValue, bookDigits);
        const totalValueInCurrency = roundMoneyValue(loyaltyPoints * pointValue, bookDigits);
        const subTotal = Number(pos.totals?.subTotal || 0);

        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            marginTop: '6px',
            background: (pos.loyaltyPointsRedeemed || 0) > 0 ? '#ecfdf5' : 'linear-gradient(135deg, #fef3c7, #fde68a)',
            border: (pos.loyaltyPointsRedeemed || 0) > 0 ? '1px solid #a7f3d0' : '1px solid #fcd34d',
            borderRadius: '6px',
            fontSize: '12px',
            color: (pos.loyaltyPointsRedeemed || 0) > 0 ? '#065f46' : '#92400e'
          }}>
            {(pos.loyaltyPointsRedeemed || 0) > 0 ? (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <StarIcon size={14} color="#059669" />
                  <span>تم استبدال <strong>{(pos.loyaltyPointsRedeemed || 0).toLocaleString()} نقطة</strong> بخصم <strong>{discountInCurrency.toLocaleString()} <CurrencySymbol /></strong></span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => pos.setLoyaltyPointsRedeemed?.(0)}
                  style={{
                    height: '28px',
                    padding: '0 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: '#fef2f2',
                    color: '#991b1b',
                    border: '1px solid #fecaca',
                    borderRadius: '4px'
                  }}
                >
                  إلغاء الاستبدال
                </Button>
              </>
            ) : (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <StarIcon size={14} color="#b45309" />
                  <span>رصيد نقاط الولاء: <strong>{loyaltyPoints.toLocaleString()} نقطة</strong> (تساوي {totalValueInCurrency.toLocaleString()} {getGlobalCurrencySymbol()} خصم)</span>
                </span>
                {loyaltyPoints < minPoints ? (
                  <span style={{ fontSize: '11px', color: '#92400e', fontWeight: 600 }}>
                    (الحد الأدنى للاستبدال: {minPoints} نقطة)
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const maxAllowedDiscount = (subTotal * maxPct) / 100;
                      const maxPointsAllowedByCap = Math.floor(maxAllowedDiscount / pointValue);
                      const pointsToRedeem = Math.min(loyaltyPoints, maxPointsAllowedByCap);
                      if (pointsToRedeem > 0) {
                        pos.setLoyaltyPointsRedeemed?.(pointsToRedeem);
                      }
                    }}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: '#b45309',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px'
                    }}
                  >
                    استبدال النقاط بخصم
                  </Button>
                )}
              </>
            )}
          </div>
        );
      })() : null}
    </section>
  );
}

interface PosCheckoutPaymentSectionProps {
  pos: PosWorkspaceState;
  cashAmountInputRef: RefObject<HTMLInputElement | null>;
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
  onConfirmSale?: () => void;
  isMobile?: boolean;
}

export function PosCheckoutPaymentSection({
  pos,
  cashAmountInputRef,
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
  const isCreditSale = pos.paymentType === 'credit';
  const needsCreditCustomer = isCreditSale && !String(pos.customerId || '').trim();
  const transferSelected = !isCreditSale && (pos.paymentChannel === 'wallet' || pos.paymentChannel === 'instapay');
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

  return (
    <div style={{
      display: 'grid',
      gap: '8px',
      background: '#fff',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
    }}>
      {/* Single Unified Row: Cash, Card/Transfer, Discount (Amount), Discount (%) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'repeat(2, minmax(0, 1fr))'
            : (isDiscountLocked ? 'repeat(auto-fit, minmax(130px, 1fr))' : 'repeat(4, minmax(0, 1fr))'),
          gap: '8px',
          alignItems: 'end',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>نقدي</span>
          <input
            ref={cashAmountInputRef}
            data-autofocus={!customerPickerOpen ? true : undefined}
            type="number"
            step="0.01"
            value={pos.cashAmount}
            onChange={(event) => pos.setCashAmount(Number(event.target.value || 0))}
            style={{ boxSizing: 'border-box', width: '100%', height: '38px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, border: '1px solid #cbd5e1', textAlign: 'center' }}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>
            {transferSelected
              ? (pos.paymentChannel === 'instapay'
                  ? (isKwdStore ? 'رابط دفع' : 'InstaPay')
                  : (isKwdStore ? 'محفظة رقمية' : 'محافظ إلكترونية'))
              : (isKwdStore && pos.terminalPaymentDetails?.cardScheme === 'knet'
                  ? 'كي نت K-NET'
                  : isKsaStore && pos.terminalPaymentDetails?.cardScheme === 'mada'
                  ? 'مدى mada'
                  : 'فيزا / كارت')}
          </span>
          <input
            type="number"
            step="0.01"
            value={transferSelected ? pos.transferAmount : pos.cardAmount}
            onChange={(event) => {
              const val = Number(event.target.value || 0);
              if (transferSelected) pos.setTransferAmount(val);
              else pos.setCardAmount(val);
            }}
            style={{ boxSizing: 'border-box', width: '100%', height: '38px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, border: '1px solid #cbd5e1', textAlign: 'center' }}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>الخصم (مبلغ)</span>
          <input
            type="number"
            step="0.01"
            value={pos.discount === 0 ? '' : pos.discount}
            onChange={(event) => pos.setDiscount(Number(event.target.value || 0))}
            disabled={isDiscountLocked || isTerminalApproved}
            placeholder="0"
            style={{ boxSizing: 'border-box', width: '100%', height: '38px', borderRadius: '6px', fontSize: '14px', border: '1px solid #cbd5e1', textAlign: 'center' }}
          />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center' }}>الخصم (%)</span>
          <input
            type="number"
            step="0.01"
            value={isPercentFocused ? percentStr : (pos.discount > 0 && pos.totals.subTotal > 0 ? ((pos.discount / pos.totals.subTotal) * 100).toFixed(2).replace(/\.00$/, '') : '')}
            onFocus={() => setIsPercentFocused(true)}
            onBlur={() => setIsPercentFocused(false)}
            onChange={(event) => {
              setPercentStr(event.target.value);
              const p = Number(event.target.value || 0);
              pos.setDiscount(roundMoneyValue((p / 100) * pos.totals.subTotal, bookDigits));
            }}
            disabled={isDiscountLocked || isTerminalApproved || pos.totals.subTotal === 0}
            placeholder="0"
            style={{ boxSizing: 'border-box', width: '100%', height: '38px', borderRadius: '6px', fontSize: '14px', border: '1px solid #cbd5e1', textAlign: 'center' }}
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
            style={{ height: '38px', alignSelf: 'end', fontSize: '12px', gridColumn: isMobile ? '1 / -1' : undefined }}
          >
            {pos.discountAuthorizationMutation.isPending ? 'جاري...' : (pos.discountApprovalGranted ? 'معتمد' : 'اعتماد المدير')}
          </Button>
        ) : null}
      </div>

      {/* Row 2: Payment method buttons (Strict Country Isolation) */}
      {isKwdStore ? (
        /* Kuwait Mode: Cash, K-NET, Visa/Master, Credit, Payment Links / Transfers */
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
          <Button
            type="button"
            variant={isPaymentActive('cash') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('cash');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            نقدي
          </Button>
          <Button
            type="button"
            variant={
              isPaymentActive('card') && pos.terminalPaymentDetails?.cardScheme === 'knet'
                ? 'primary'
                : (isPaymentActive('card') && !pos.terminalPaymentDetails?.cardScheme)
                ? 'primary'
                : 'secondary'
            }
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('card');
              pos.setTerminalPaymentDetails?.({
                ...(pos.terminalPaymentDetails || {}),
                cardScheme: 'knet',
                provider: 'knet_pos',
              });
            }}
            style={{ minHeight: '38px', fontSize: '11.5px', fontWeight: 800 }}
          >
            كي نت K-NET
          </Button>
          <Button
            type="button"
            variant={
              isPaymentActive('card') && pos.terminalPaymentDetails?.cardScheme && pos.terminalPaymentDetails?.cardScheme !== 'knet'
                ? 'primary'
                : 'secondary'
            }
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('card');
              pos.setTerminalPaymentDetails?.({
                ...(pos.terminalPaymentDetails || {}),
                cardScheme: 'visa',
              });
            }}
            style={{ minHeight: '38px', fontSize: '12px', fontWeight: 700 }}
          >
            فيزا / ماستر
          </Button>
          <Button
            type="button"
            variant={isPaymentActive('credit') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('credit');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            آجل
          </Button>
          <Button
            type="button"
            variant={transferSelected ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset(pos.paymentChannel === 'instapay' ? 'instapay' : 'wallet');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '11.5px', fontWeight: 700 }}
          >
            روابط دفع / تحويل
          </Button>
        </div>
      ) : isKsaStore ? (
        /* Saudi Mode: Cash, Mada, Visa/Master, Credit, Bank Transfer / Wallets */
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
          <Button
            type="button"
            variant={isPaymentActive('cash') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('cash');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            نقدي
          </Button>
          <Button
            type="button"
            variant={
              isPaymentActive('card') && pos.terminalPaymentDetails?.cardScheme === 'mada'
                ? 'primary'
                : (isPaymentActive('card') && !pos.terminalPaymentDetails?.cardScheme)
                ? 'primary'
                : 'secondary'
            }
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('card');
              pos.setTerminalPaymentDetails?.({
                ...(pos.terminalPaymentDetails || {}),
                cardScheme: 'mada',
                provider: 'geidea',
              });
            }}
            style={{ minHeight: '38px', fontSize: '11.5px', fontWeight: 800 }}
          >
            مدى mada
          </Button>
          <Button
            type="button"
            variant={
              isPaymentActive('card') && pos.terminalPaymentDetails?.cardScheme && pos.terminalPaymentDetails?.cardScheme !== 'mada'
                ? 'primary'
                : 'secondary'
            }
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('card');
              pos.setTerminalPaymentDetails?.({
                ...(pos.terminalPaymentDetails || {}),
                cardScheme: 'visa',
              });
            }}
            style={{ minHeight: '38px', fontSize: '12px', fontWeight: 700 }}
          >
            فيزا / ماستر
          </Button>
          <Button
            type="button"
            variant={isPaymentActive('credit') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('credit');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            آجل
          </Button>
          <Button
            type="button"
            variant={transferSelected ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset(pos.paymentChannel === 'wallet' ? 'wallet' : 'instapay');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '11.5px', fontWeight: 700 }}
          >
            دفع إلكتروني / محافظ
          </Button>
        </div>
      ) : (
        /* Universal 4 Main Presets: Cash, Card, Transfers/Wallets, Credit */
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
          <Button
            type="button"
            variant={isPaymentActive('cash') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('cash');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            نقدي
          </Button>
          <Button
            type="button"
            variant={isPaymentActive('card') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('card');
              pos.setTerminalPaymentDetails?.({
                ...(pos.terminalPaymentDetails || {}),
                cardScheme: isKwdStore ? 'knet' : isKsaStore ? 'mada' : 'visa',
              });
            }}
            style={{ minHeight: '38px', fontSize: '12px', fontWeight: 700 }}
          >
            {isKwdStore ? 'KNET كي نت' : isKsaStore ? 'شبكة / مدى' : 'فيزا / كارت'}
          </Button>
          <Button
            type="button"
            variant={transferSelected ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset(pos.paymentChannel === 'wallet' ? 'wallet' : 'instapay');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '11.5px', fontWeight: 700 }}
          >
            تحويلات / محافظ
          </Button>
          <Button
            type="button"
            variant={isPaymentActive('credit') ? 'primary' : 'secondary'}
            onClick={() => {
              if (!canChangePaymentAfterTerminalApproval(pos.terminalPaymentDetails?.authCode, pos.terminalPaymentDetails?.rrn)) {
                toast.warning('تم اعتماد دفع إلكتروني؛ لا تغيّر طريقة الدفع قبل إتمام الفاتورة أو التسوية.');
                return;
              }
              onSelectPaymentPreset('credit');
              pos.setTerminalPaymentDetails?.(null);
            }}
            style={{ minHeight: '38px', fontSize: '12.5px', fontWeight: 700 }}
          >
            آجل
          </Button>
        </div>
      )}

      {/* Sub-presets row for Transfers / Digital Wallets */}
      {transferSelected ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', padding: '6px', background: '#f1f0fa', borderRadius: '6px' }}>
          {isKwdStore ? (
            <>
              <Button type="button" variant={pos.paymentChannel === 'instapay' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ minHeight: '34px', fontSize: '11.5px', fontWeight: 700 }}>
                رابط دفع K-NET
              </Button>
              <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ minHeight: '34px', fontSize: '11.5px', fontWeight: 700 }}>
                Apple Pay / محفظة
              </Button>
            </>
          ) : isKsaStore ? (
            <>
              <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ minHeight: '34px', fontSize: '11.5px', fontWeight: 700 }}>
                STC Pay / محفظة
              </Button>
              <Button type="button" variant={pos.paymentChannel === 'instapay' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ minHeight: '34px', fontSize: '11.5px', fontWeight: 700 }}>
                Apple Pay / سداد
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant={pos.paymentChannel === 'instapay' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('instapay')} style={{ minHeight: '34px', fontSize: '12px', fontWeight: 800 }}>
                InstaPay
              </Button>
              <Button type="button" variant={pos.paymentChannel === 'wallet' ? 'primary' : 'secondary'} onClick={() => onSelectPaymentPreset('wallet')} style={{ minHeight: '34px', fontSize: '12px', fontWeight: 700 }}>
                محافظ إلكترونية
              </Button>
            </>
          )}
        </div>
      ) : null}

      {/* EDC / Sunmi POS Terminal Direct Dispatch Banner (Active for Card payments when terminal exists) */}
      {(isPaymentActive('card') || pos.cardAmount > 0) && (pos.settingsQuery?.data?.posTerminalEnabled === true) && activeTerminals.length > 0 && (
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          padding: '6px 10px',
          gap: '8px',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
              إكرامية / بقشيش (Tip):
            </span>
            {Number(pos.tipAmount || 0) > 0 ? (
              <span style={{ background: '#eef2ff', color: '#170e5e', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                +{formatCurrency(pos.tipAmount)} مضاف للمطلوب
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
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                {tipPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyTipChange(preset)}
                    disabled={isTerminalApproved}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: (pos.tipAmount || 0) === preset ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: (pos.tipAmount || 0) === preset ? '#170e5e' : '#ffffff',
                      color: (pos.tipAmount || 0) === preset ? '#ffffff' : '#334155',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
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
                  type="number"
                  min="0"
                  step={tipStep}
                  value={pos.tipAmount || ''}
                  onChange={(e) => applyTipChange(Math.max(0, Number(e.target.value || 0)))}
                  disabled={isTerminalApproved}
                  placeholder="مخصص"
                  style={{
                    width: isKwdStore ? '68px' : '55px',
                    height: '24px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    textAlign: 'center',
                    fontSize: '11.5px',
                    fontWeight: 700,
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}

      {/* Summary 3-Column Chips: Centered and Balanced */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? '4px' : '8px', width: '100%', boxSizing: 'border-box' }}>
        <div className="pos-checkout-dialog-chip" style={{ minHeight: isMobile ? '44px' : '48px', padding: isMobile ? '4px 6px' : '6px 8px', borderRadius: '6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? '10.5px' : '11.5px', whiteSpace: 'nowrap', textAlign: 'center' }}>المطلوب دفعه</span>
          <strong className="is-primary" style={{ fontSize: isMobile ? '13px' : '15px', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(pos.totals.total)}</strong>
        </div>
        <div className="pos-checkout-dialog-chip" style={{ minHeight: isMobile ? '44px' : '48px', padding: isMobile ? '4px 6px' : '6px 8px', borderRadius: '6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? '10.5px' : '11.5px', whiteSpace: 'nowrap', textAlign: 'center' }}>المدفوع</span>
          <strong className="is-success" style={{ fontSize: isMobile ? '13px' : '15px', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(paidAmount)}</strong>
        </div>
        <div className="pos-checkout-dialog-chip" style={{ minHeight: isMobile ? '44px' : '48px', padding: isMobile ? '4px 6px' : '6px 8px', borderRadius: '6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? '10.5px' : '11.5px', whiteSpace: 'nowrap', textAlign: 'center' }}>{balance.label}</span>
          <strong className={balance.tone === 'danger' ? 'is-danger' : 'is-primary'} style={{ fontSize: isMobile ? '13px' : '15px', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatCurrency(balance.value)}</strong>
        </div>
      </div>

      {needsCreditCustomer ? <div className="error-box" style={{ margin: 0, textAlign: 'center' }}>البيع الآجل يحتاج اختيار عميل.</div> : null}
      {!pos.canApplyDiscount ? <div className="pos-payment-strip-notes" style={{ margin: 0 }}><span className="pos-payment-strip-note">{pos.discountApprovalGranted ? 'تم اعتماد الخصم لهذه الفاتورة فقط.' : 'لا تملك صلاحية تعديل الخصم. استخدم اعتماد المدير لهذه الفاتورة.'}</span></div> : null}
      {pos.hasDiscountPermissionViolation ? <div className="error-box" style={{ margin: 0, textAlign: 'center' }}>تم اكتشاف خصم غير مسموح به في هذه الفاتورة.</div> : null}
    </div>
  );
}

export function PosCheckoutOrderTypeSection({
  pos,
  onDeliverySelected
}: {
  pos: PosWorkspaceState;
  onDeliverySelected?: () => void;
}) {
  const currentSettings = pos.settingsQuery?.data;
  const isRestaurant = currentSettings?.restaurantModuleEnabled === true;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);

  // The pager field is strictly for restaurants in Kuwait/Saudi, or if explicitly enabled by the restaurant
  const showPager = isRestaurant && pos.orderType !== 'delivery' && (isKwdStore || isKsaStore || Boolean(currentSettings?.enableGuestPagers));
  // INV-REST-PAID-GATES-2 (R4-D, I40): the order type drives the
  // service charge, so it is a total-changing input — frozen while a
  // terminal approval is live.
  const isTerminalApproved = isTerminalApprovalLive(pos.terminalPaymentDetails);

  return (
    <div style={{ display: 'flex', gap: '8px', width: '100%', marginBottom: '6px', alignItems: 'center' }}>
      <Button
        type="button"
        variant={pos.orderType === 'takeaway' || !pos.orderType ? 'primary' : 'secondary'}
        onClick={() => pos.setOrderType('takeaway')}
        disabled={isTerminalApproved}
        style={{ flex: 1, minHeight: '38px', fontSize: '13px', fontWeight: 700 }}
      >
        {isRestaurant ? 'تيك أواي' : 'بيع مباشر (استلام)'}
      </Button>
      <Button 
        type="button" 
        variant={pos.orderType === 'delivery' ? 'primary' : 'secondary'} 
        onClick={() => {
          pos.setOrderType('delivery');
          if (pos.orderType !== 'delivery') {
            onDeliverySelected?.();
          }
        }}
        disabled={isTerminalApproved}
        style={{ flex: 1, minHeight: '38px', fontSize: '13px', fontWeight: 700 }}
      >
        دليفري (توصيل)
      </Button>
      {isRestaurant && (
        <Button
          type="button"
          variant={pos.orderType === 'dine_in' ? 'primary' : 'secondary'}
          onClick={() => pos.setOrderType('dine_in')}
          disabled={isTerminalApproved}
          style={{ flex: 1, minHeight: '38px', fontSize: '13px', fontWeight: 700 }}
        >
          صالة (طاولات)
        </Button>
      )}
      {showPager && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '2px 8px',
            height: '38px',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>البيجر:</span>
          <input
            type="text"
            value={(pos as any).pagerNumber || ''}
            onChange={(e) => (pos as any).setPagerNumber?.(e.target.value)}
            placeholder="رقم البيجر..."
            style={{
              width: '90px',
              height: '28px',
              padding: '0 6px',
              fontSize: '12px',
              fontWeight: 800,
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              textAlign: 'center',
              background: '#f8fafc',
            }}
          />
        </div>
      )}
    </div>
  );
}

export function PosCheckoutDeliverySection({ pos, deliveryReps, isMobile: isMobileProp }: { pos: PosWorkspaceState, deliveryReps: DeliveryRep[], isMobile?: boolean }) {
  const isMobileHook = useIsMobile(860);
  const isMobile = isMobileProp ?? isMobileHook;
  const currentSettings = pos.settings || pos.settingsQuery?.data;
  const isKwdStore = isKuwait(currentSettings);
  const isKsaStore = isSaudi(currentSettings);
  // INV-REST-PAID-GATES-2 (R4-D, I40): the delivery fee is a
  // total-changing input — frozen while a terminal approval is live.
  const isTerminalApproved = isTerminalApprovalLive(pos.terminalPaymentDetails);

  const deliveryChannels = isKwdStore
    ? [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'talabat', label: 'طلبات Talabat' },
        { id: 'deliveroo', label: 'دليفرو Deliveroo' },
        { id: 'jahez', label: 'جاهز Jahez' },
        { id: 'cari', label: 'كاري Cari' },
      ]
    : isKsaStore
    ? [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'jahez', label: 'جاهز Jahez' },
        { id: 'hungerstation', label: 'هنقرستيشن Hungerstation' },
        { id: 'toyou', label: 'تويو ToYou' },
        { id: 'mrsool', label: 'مرسول Mrsool' },
      ]
    : [
        { id: 'direct', label: 'مباشر (المحل)' },
        { id: 'talabat', label: 'طلبات Talabat' },
      ];

  const [repSearchOpen, setRepSearchOpen] = useState(false);
  const [repSearchQuery, setRepSearchQuery] = useState('');
  const inputContainerRef = useRef<HTMLDivElement | null>(null);
  const dropdownPortalRef = useRef<HTMLDivElement | null>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const activeReps = deliveryReps.filter((r) => r.is_active);
  const selectedRep = activeReps.find((r) => String(r.id) === String(pos.deliveryRepId));
  const filteredReps = activeReps.filter(r => r.name.toLowerCase().includes(repSearchQuery.toLowerCase()) || r.phone?.includes(repSearchQuery));

  const updateDropdownCoords = useCallback(() => {
    if (!inputContainerRef.current) return;
    const rect = inputContainerRef.current.getBoundingClientRect();
    setDropdownCoords({
      top: Math.round(rect.bottom + 4),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
    });
  }, []);

  useEffect(() => {
    if (!repSearchOpen) {
      setDropdownCoords(null);
      return;
    }
    updateDropdownCoords();
    const handleViewportChange = () => {
      updateDropdownCoords();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [repSearchOpen, updateDropdownCoords]);

  useEffect(() => {
    if (!repSearchOpen) return;
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputContainerRef.current && !inputContainerRef.current.contains(target) &&
        dropdownPortalRef.current && !dropdownPortalRef.current.contains(target)
      ) {
        setRepSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [repSearchOpen]);

  const handleClearRep = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    pos.setDeliveryRepId('');
    pos.setDeliveryFeeMode('store_fleet');
    setRepSearchQuery('');
    setRepSearchOpen(false);
  };

  const handleSelectRep = (repId: string, repType?: string) => {
    pos.setDeliveryRepId(repId);
    if (repType === 'store_fleet') {
      pos.setDeliveryFeeMode('store_fleet');
    } else if (repType === 'freelance') {
      pos.setDeliveryFeeMode('freelance_courier');
    }
    setRepSearchQuery('');
    setRepSearchOpen(false);
  };

  if (pos.orderType !== 'delivery') return null;

  const isRepRequired = pos.collectionStatus === 'cod';
  const isRepMissing = isRepRequired && !selectedRep;

  return (
    <div style={{
      display: 'grid',
      gap: '8px',
      background: '#fff',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid #e2e8f0',
      marginBottom: '6px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      boxSizing: 'border-box',
      width: '100%'
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'minmax(0, 1fr) 110px' : 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: '8px',
        alignItems: 'end',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{ position: 'relative', minWidth: 0 }}>
          <label className="field" style={{ margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: isRepMissing ? '#dc2626' : '#64748b', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', whiteSpace: 'nowrap' }}>
              <span>مندوب التوصيل {isRepRequired ? <span style={{ color: '#dc2626' }}>*</span> : <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '11px' }}>(اختياري)</span>}</span>
              {selectedRep && (
                <button
                  type="button"
                  onMouseDown={handleClearRep}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '0 4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}
                  title="مسح المندوب"
                >
                  ✕ إلغاء المندوب
                </button>
              )}
            </span>
            <div ref={inputContainerRef} style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
              <input
                placeholder={selectedRep?.name || (isRepRequired ? "-- اختر مندوب التوصيل --" : "-- مندوب التوصيل (اختياري) --")}
                value={repSearchOpen ? repSearchQuery : (selectedRep?.name || '')}
                onFocus={() => {
                  setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                onClick={() => {
                  setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                onChange={(e) => {
                  setRepSearchQuery(e.target.value);
                  if (!repSearchOpen) setRepSearchOpen(true);
                  updateDropdownCoords();
                }}
                style={{
                  boxSizing: 'border-box',
                  padding: selectedRep ? '6px 36px 6px 32px' : '6px 32px 6px 10px',
                  height: '38px',
                  width: '100%',
                  minWidth: 0,
                  borderRadius: '6px',
                  border: isRepMissing ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                  background: isRepMissing ? '#fff5f5' : 'white',
                  fontSize: '13px',
                  fontWeight: selectedRep && !repSearchOpen ? 800 : 500,
                  color: selectedRep && !repSearchOpen ? '#0f172a' : 'inherit',
                  cursor: 'pointer'
                }}
              />
              {selectedRep && (
                <button
                  type="button"
                  onMouseDown={handleClearRep}
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#fee2e2',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 900,
                    zIndex: 2
                  }}
                  title="مسح المندوب"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setRepSearchOpen(prev => {
                    const next = !prev;
                    if (next) updateDropdownCoords();
                    return next;
                  });
                }}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                  zIndex: 2
                }}
                title={repSearchOpen ? 'إغلاق القائمة' : 'فتح قائمة المناديب'}
              >
                {repSearchOpen ? '▲' : '▼'}
              </button>
            </div>
          </label>

          {repSearchOpen && dropdownCoords && typeof document !== 'undefined' && createPortal(
            <div 
              ref={dropdownPortalRef}
              style={{ 
                position: 'fixed',
                top: `${dropdownCoords.top}px`,
                left: `${dropdownCoords.left}px`,
                width: `${dropdownCoords.width}px`,
                background: '#ffffff',
                border: '1.5px solid #cbd5e1', 
                borderRadius: '8px',
                zIndex: 100000,
                maxHeight: '230px', 
                overflowY: 'auto',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25), 0 4px 12px rgba(0, 0, 0, 0.1)',
                boxSizing: 'border-box',
              }}
              dir="rtl"
            >
              {selectedRep && (
                <div
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1.5px dashed #fecaca',
                    background: '#fff5f5',
                    color: '#dc2626',
                    fontSize: '12px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseDown={handleClearRep}
                >
                  <span>✕ إلغاء تحديد المندوب (حذف)</span>
                  <span style={{ fontSize: '11px', color: '#991b1b', fontWeight: 500 }}>مسح المندوب الحالي</span>
                </div>
              )}

              {filteredReps.length === 0 && (
                <div style={{ padding: '10px 12px', color: '#dc2626', fontSize: '12px', fontWeight: 600 }}>
                  {activeReps.length === 0 ? 'لا يوجد مناديب مسجلين بالنظام' : 'لا توجد نتائج مطابقة'}
                </div>
              )}
              {filteredReps.map(rep => (
                <div 
                  key={rep.id}
                  style={{ 
                    padding: '8px 12px', cursor: 'pointer', 
                    borderBottom: '1px solid #f1f5f9',
                    background: String(rep.id) === String(pos.deliveryRepId) ? '#eff6ff' : '#ffffff',
                    color: String(rep.id) === String(pos.deliveryRepId) ? '#170c5c' : '#334155',
                    fontSize: '13px',
                    fontWeight: String(rep.id) === String(pos.deliveryRepId) ? 800 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectRep(String(rep.id), (rep as any).rep_type);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => {
                    if (String(rep.id) !== String(pos.deliveryRepId)) e.currentTarget.style.background = '#ffffff';
                    else e.currentTarget.style.background = '#eff6ff';
                  }}
                >
                  <div>
                    <span>{rep.name}</span>
                    {rep.phone ? <span style={{ color: '#94a3b8', fontSize: '11px', marginRight: '6px' }}>({rep.phone})</span> : null}
                    {(rep as any).rep_type === 'store_fleet' ? <span style={{ color: '#059669', fontSize: '10px', marginRight: '6px', background: '#ecfdf5', padding: '1px 6px', borderRadius: '4px' }}>أسطول المحل</span> : null}
                  </div>
                  {String(rep.id) === String(pos.deliveryRepId) && (
                    <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 900 }}>✓ محدد</span>
                  )}
                </div>
              ))}
            </div>,
            document.body
          )}
        </div>

        <div className="field" style={{ margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '2px', display: 'block', textAlign: 'center', whiteSpace: 'nowrap' }}>رسوم التوصيل ({getGlobalCurrencySymbol()})</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={pos.deliveryFee === 0 ? '' : pos.deliveryFee}
            onChange={(event) => pos.setDeliveryFee(Number(event.target.value || 0))}
            disabled={isTerminalApproved}
            placeholder="0"
            style={{ boxSizing: 'border-box', padding: '6px 10px', height: '38px', width: '100%', minWidth: 0, borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '14px', textAlign: 'center' }}
          />
        </div>
      </div>

      {/* Aggregator / Channel Source Tag Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', minWidth: 0 }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>
          مصدر طلب التوصيل (قناة الاستلام):
        </span>
        <div
          className="pos-checkout-channels-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingBottom: '2px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {deliveryChannels.map((channel) => {
            const isSelected = channel.id === 'direct'
              ? !deliveryChannels.filter(c => c.id !== 'direct').some(c => (pos.note || '').includes(c.label.split(' ')[0]))
              : (pos.note || '').includes(channel.label.split(' ')[0]);

            return (
              <button
                key={channel.id}
                type="button"
                className="pos-checkout-channel-btn"
                onClick={() => {
                  let nextNote = (pos.note || '').replace(/\[(مصدر|منصة|قناة):[^\]]+\]/g, '').trim();
                  deliveryChannels.filter(c => c.id !== 'direct').forEach(c => {
                    nextNote = nextNote.replace(new RegExp(`\\[?منصة:?\\s*${c.label.split(' ')[0]}[^\\]]*\\]?`, 'gi'), '').trim();
                  });
                  if (channel.id !== 'direct') {
                    nextNote = `[منصة: ${channel.label}] ${nextNote}`.trim();
                    // Auto-set collection to prepaid_online because customers pay through the aggregator app
                    pos.setCollectionStatus('prepaid_online');
                    pos.setPaymentChannel('wallet');
                    pos.setTransferAmount(Number(pos.totals.total || 0));
                    pos.setCashAmount(0);
                    pos.setCardAmount(0);
                  }
                  pos.setNote(nextNote);
                }}
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  padding: isMobile ? '3px 8px' : '4px 10px',
                  borderRadius: '6px',
                  fontSize: isMobile ? '11px' : '12px',
                  fontWeight: isSelected ? 800 : 600,
                  border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  background: isSelected ? '#170e5e' : '#f8fafc',
                  color: isSelected ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  transition: 'none',
                }}
              >
                {channel.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? '4px' : '8px', width: '100%', boxSizing: 'border-box' }}>
        {(['cod', 'prepaid_by_rep', 'prepaid_online'] as const).map((status) => (
          <Button
            key={status}
            type="button"
            variant={pos.collectionStatus === status ? 'primary' : 'secondary'}
            onClick={() => {
              pos.setCollectionStatus(status);
              if (status === 'cod') {
                pos.setPaymentChannel('cash');
                pos.setCashAmount(0);
                pos.setCardAmount(0);
                pos.setTransferAmount(0);
              } else if (status === 'prepaid_by_rep') {
                pos.setPaymentChannel('cash');
                pos.setCashAmount(Number(pos.totals.total || 0));
                pos.setCardAmount(0);
                pos.setTransferAmount(0);
              } else if (status === 'prepaid_online') {
                pos.setPaymentChannel('wallet');
                pos.setTransferAmount(Number(pos.totals.total || 0));
                pos.setCashAmount(0);
                pos.setCardAmount(0);
              }
            }}
            style={{
              fontSize: isMobile ? '11px' : '13px',
              padding: isMobile ? '6px 2px' : '6px 4px',
              minHeight: '38px',
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.25,
            }}
          >
            {status === 'cod' ? 'تحصيل من العميل' : status === 'prepaid_by_rep' ? 'خالص من المندوب' : 'خالص أونلاين'}
          </Button>
        ))}
      </div>
    </div>
  );
}
