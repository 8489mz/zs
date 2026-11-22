import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '@/shared/api/customers.api';
import { posApi } from '@/features/pos/api/pos.api';
import { calcMaxLoyaltyPointsToRedeem } from '@/features/pos/lib/pos-cart-totals';
import { Button } from '@/shared/ui/button';
import { StarIcon } from '@/shared/components/icons/AppIcons';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

type CustomerOption = { id: string | number; name: string; phone?: string | null; address?: string | null };

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
      <section className="pos-checkout-dialog-section pos-checkout-customer-section" style={{ padding: 0, marginBottom: 0, border: 'none', background: 'transparent', flexShrink: 0 }}>
        <Button type="button" variant="secondary" onClick={onManualOpen} style={{ width: '100%', borderStyle: 'dashed', height: '34px', minHeight: '34px', maxHeight: '34px', fontSize: '12px', boxSizing: 'border-box' }}>
          + ربط الفاتورة ببيانات عميل (اختياري)
        </Button>
      </section>
    );
  }

  return (
    <section className="pos-checkout-dialog-section pos-checkout-customer-section" style={{ padding: 0, marginBottom: 0, border: 'none', background: 'transparent' }}>
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
        <div
          className="pos-checkout-selected-customer-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            background: '#ffffff',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0, height: '24px', minHeight: '24px', maxHeight: '24px', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, flexShrink: 0 }}>العميل:</span>
              <strong style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedCustomer?.name || pos.quickCustomerName || (selectedCustomerName !== 'عميل نقدي' ? selectedCustomerName : '') || 'عميل نقدي'}
              </strong>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleSelectCustomer('', '', '')}
              style={{ flexShrink: 0, height: '24px', minHeight: '24px', maxHeight: '24px', padding: '0 10px', fontSize: '11.5px', borderRadius: '5px', boxSizing: 'border-box' }}
            >
              تغيير
            </Button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.9fr) minmax(0, 1.3fr)',
              gap: '6px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <input
              value={pos.quickCustomerPhone || selectedCustomer?.phone || ''}
              onChange={(event) => pos.setQuickCustomerPhone(event.target.value)}
              placeholder="رقم الهاتف"
              style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '3px 8px', fontSize: '12.5px', height: '28px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
            />
            <div style={{ minWidth: 0, position: 'relative' }}>
              <input
                value={pos.quickCustomerAddress || selectedCustomer?.address || ''}
                onChange={(event) => pos.setQuickCustomerAddress(event.target.value)}
                onFocus={() => setAddressDropdownOpen(true)}
                onBlur={() => setTimeout(() => setAddressDropdownOpen(false), 200)}
                placeholder="العنوان أو المكان"
                style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '3px 8px', fontSize: '12.5px', height: '28px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
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
        </div>
      )}

      {pos.customerId && (pos.settings?.loyaltyEnabled === true) && (loyaltyPoints > 0 || (pos.loyaltyPointsRedeemed || 0) > 0) ? (() => {
        const pointValue = Number(pos.settings?.loyaltyPointRedeemValue ?? 0.1);
        const minPoints = Number(pos.settings?.loyaltyMinRedeemPoints ?? 0);
        const maxPct = Number(pos.settings?.loyaltyMaxDiscountPercentage ?? 100);
        /* INV-REST-LOYALTY-TRUTH (R6-C, I10): the banner used to show the
         * UNCAPPED product (points x pointValue) while the totals line
         * next to it uses the capped loyaltyDiscount — with a tenant cap
         * below 100% the banner overstated the discount actually given.
         * Display the already-capped totals value instead; the cap math
         * itself stays in the derived hook. The minimum gate below used
         * to default to 50 while the backend defaults to 0 — the display
         * gate now uses the backend's default. */
        const discountInCurrency = Number(pos.totals?.loyaltyDiscount || 0);
        const totalValueInCurrency = roundMoneyValue(loyaltyPoints * pointValue, bookDigits);
        /* F14 (van trial, F1b loyalty item): the redeem-all cap divides
         * the NET subtotal (gross minus line discounts) — the same base
         * the backend and the totals engine cap the loyalty discount
         * at. The gross base redeemed points the backend then capped
         * in money but still deducted in full. */
        const netSubTotal = Number((pos.totals?.netSubTotal ?? pos.totals?.subTotal) || 0);

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
                      const pointsToRedeem = calcMaxLoyaltyPointsToRedeem(loyaltyPoints, pointValue, netSubTotal, maxPct, bookDigits);
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
