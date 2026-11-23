import { useState, useEffect } from 'react';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useUpdateShipmentItemMutation, type ShipmentItem } from '../api/shipments.api';

export function ItemRowInputs({ item, shipmentId, arrivalRate, pricingRate, isArrived }: { item: ShipmentItem, shipmentId: string, arrivalRate: number, pricingRate: number, isArrived?: boolean }) {
  const updateMutation = useUpdateShipmentItemMutation(shipmentId);
  const [receivedQty, setReceivedQty] = useState(item.received_quantity || '');
  const [retailMargin, setRetailMargin] = useState(item.target_retail_margin || '');
  const [wholesaleMargin, setWholesaleMargin] = useState(item.target_wholesale_margin || '');

  useEffect(() => {
    setReceivedQty(item.received_quantity || '');
    setRetailMargin(item.target_retail_margin || '');
    setWholesaleMargin(item.target_wholesale_margin || '');
  }, [item.received_quantity, item.target_retail_margin, item.target_wholesale_margin]);

  const handleBlur = (field: 'receivedQuantity' | 'targetRetailMargin' | 'targetWholesaleMargin' | 'shortageHandlingMethod', value: string) => {
    updateMutation.mutate({
      itemId: item.id,
      dto: { [field]: field === 'shortageHandlingMethod' ? value : (value ? Number(value) : undefined) }
    });
  };

  const unitUsd = Number(item.factory_unit_price_usd) || 0;
  const landedCost = Number(item.landed_cost_egp) || 0;
  const pricingCostEgp = landedCost + (unitUsd * (pricingRate - arrivalRate));

  // INV-FE2-FRONTEND-BOOK-DIGITS: the margin-suggested prices are
  // EGP-denominated (pricingCostEgp) previews shown to the merchant —
  // they round at EGP digits (2), the denomination of the amount.
  const suggestedWholesale = roundMoneyValue(pricingCostEgp * (1 + (Number(wholesaleMargin) || 0) / 100), currencyMoneyDigits('EGP'));
  const suggestedRetail = roundMoneyValue(pricingCostEgp * (1 + (Number(retailMargin) || 0) / 100), currencyMoneyDigits('EGP'));

  return (
    <>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input
          type="number"
          className="input no-spin-arrows"
          style={{ width: '100%', maxWidth: '68px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 700, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }}
          value={receivedQty}
          placeholder={String(item.quantity)}
          disabled={isArrived}
          title={isArrived ? 'تم استلام الحاوية وترحيل المخزون نهائياً - مقفلة' : ''}
          onChange={e => setReceivedQty(e.target.value)}
          onBlur={e => handleBlur('receivedQuantity', e.target.value)}
        />
        {Number(receivedQty) > 0 && Number(receivedQty) < item.quantity && (
          <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
            <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#dc2626', lineHeight: 1 }}>
              عجز: {item.quantity - Number(receivedQty)}
            </div>
            <div
              style={{
                display: 'inline-flex',
                borderRadius: '5px',
                padding: '2px',
                background: '#e2e8f0',
                gap: '2px'
              }}
            >
              <button
                type="button"
                disabled={isArrived}
                onClick={() => handleBlur('shortageHandlingMethod', 'capitalize')}
                title="رسملة النواقص: توزيع تكلفة القطع الناقصة على باقي القطع السليمة المتبقية لرفع تكلفتها تلقائياً، فلا تُسجل كخسارة منفصلة في قائمة الدخل"
                style={{
                  border: 'none',
                  cursor: isArrived ? 'not-allowed' : 'pointer',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: (item.shortage_handling_method || 'capitalize') === 'capitalize' ? '#170e5e' : 'transparent',
                  color: (item.shortage_handling_method || 'capitalize') === 'capitalize' ? '#ffffff' : '#475569',
                }}
              >
                رسملة
              </button>
              <button
                type="button"
                disabled={isArrived}
                onClick={() => handleBlur('shortageHandlingMethod', 'expense')}
                title="إثبات كخسارة: تسجيل قيمة القطع الناقصة كبند خسائر عجز بضاعة مستقل في قائمة الدخل مع إبقاء تكلفة القطع المستلمة عند سعرها الأصلي"
                style={{
                  border: 'none',
                  cursor: isArrived ? 'not-allowed' : 'pointer',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: item.shortage_handling_method === 'expense' ? '#dc2626' : 'transparent',
                  color: item.shortage_handling_method === 'expense' ? '#ffffff' : '#475569',
                }}
              >
                خسارة
              </button>
            </div>
          </div>
        )}
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input
          type="number"
          className="input no-spin-arrows"
          style={{ width: '100%', maxWidth: '58px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 600, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }}
          value={wholesaleMargin}
          placeholder="%"
          onChange={e => setWholesaleMargin(e.target.value)}
          onBlur={e => handleBlur('targetWholesaleMargin', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <input
          type="number"
          className="input no-spin-arrows"
          style={{ width: '100%', maxWidth: '58px', height: '28px', padding: '2px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 600, margin: '0 auto', display: 'block', MozAppearance: 'textfield' }}
          value={retailMargin}
          placeholder="%"
          onChange={e => setRetailMargin(e.target.value)}
          onBlur={e => handleBlur('targetRetailMargin', e.target.value)}
        />
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontWeight: 800, fontSize: '12px', color: '#1e3a8a' }}>
          {suggestedWholesale > 0 ? suggestedWholesale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontWeight: 800, fontSize: '12px', color: '#15803d' }}>
          {suggestedRetail > 0 ? suggestedRetail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </div>
        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>ج.م</div>
      </td>
    </>
  );
}
