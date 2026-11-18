// Delivery setup — zone and fee, driver assignment, payment at the door
// (cash, card on delivery, or wallet) with the customer-paid note, plus
// the delivery-notes line. Pure move; the dialog keeps all state and
// mounts this component with the delivery values and their callbacks.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import type { DoorstepPaymentMethod } from '@/features/pos/types/pos.types';
import { CreditCardIcon, DollarSignIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDelivery({
  selectedZoneId,
  handleZoneChange,
  deliveryZones,
  currencySym,
  selectedDriverId,
  setSelectedDriverId,
  deliveryReps,
  isKwd,
  customDeliveryFee,
  setCustomDeliveryFee,
  setPaymentMethodAtDoor,
  paymentMethodAtDoor,
  isKsa,
  customerPaidNote,
  setCustomerPaidNote,
  deliveryNotes,
  setDeliveryNotes,
}: {
  selectedZoneId: string;
  handleZoneChange: (zoneId: string) => void;
  deliveryZones: { id: string; name: string; fee: number; eta: number }[];
  currencySym: string;
  selectedDriverId: string;
  setSelectedDriverId: Dispatch<SetStateAction<string>>;
  deliveryReps: DeliveryRep[];
  isKwd: boolean;
  customDeliveryFee: number;
  setCustomDeliveryFee: Dispatch<SetStateAction<number>>;
  setPaymentMethodAtDoor: Dispatch<SetStateAction<DoorstepPaymentMethod>>;
  paymentMethodAtDoor: DoorstepPaymentMethod;
  isKsa: boolean;
  customerPaidNote: string;
  setCustomerPaidNote: Dispatch<SetStateAction<string>>;
  deliveryNotes: string;
  setDeliveryNotes: Dispatch<SetStateAction<string>>;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '6px' }}>
        <div>
          <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s71', "منطقة التوصيل والرسوم")}
          </label>
          <select
            value={selectedZoneId}
            onChange={(e) => handleZoneChange(e.target.value)}
            style={{
              width: '100%',
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              fontSize: '0.72rem',
              background: '#ffffff',
            }}
          >
            {deliveryZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({z.fee} {currencySym})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s72', "تعيين الطيار (اختياري)")}
          </label>
          <select
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            style={{
              width: '100%',
              padding: '4px 6px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              fontSize: '0.72rem',
              background: '#ffffff',
            }}
          >
            <option value="">{t('pos.pos_workspace.pos_phone_order_dialog.s73', "توزيع تلقائي لاحقاً")}</option>
            {deliveryReps.map((dr: DeliveryRep) => (
              <option key={dr.id} value={dr.id}>
                {dr.name} {dr.phone ? `(${dr.phone})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedZoneId === 'zone_custom' && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('pos.pos_workspace.pos_phone_order_dialog.s74', "رسوم التوصيل:")}</span>
          <input
            type="number"
            min="0"
            step={isKwd ? "0.050" : "1"}
            value={customDeliveryFee}
            onChange={(e) => setCustomDeliveryFee(Number(e.target.value) || 0)}
            style={{ width: '65px', padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}
          />
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{currencySym}</span>
        </div>
      )}

      {/* Payment at Doorstep Selector */}
      <div style={{ paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>
          {t('pos.pos_workspace.pos_phone_order_dialog.s75', "طريقة الدفع عند الاستلام")}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
          <button
            type="button"
            onClick={() => setPaymentMethodAtDoor('cash')}
            style={{
              background: paymentMethodAtDoor === 'cash' ? '#170e5e' : '#f8fafc',
              color: paymentMethodAtDoor === 'cash' ? '#ffffff' : '#334155',
              border: '1px solid',
              borderColor: paymentMethodAtDoor === 'cash' ? '#170e5e' : '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 2px',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
            }}
          >
            <DollarSignIcon size={11} />
            {t('pos.pos_workspace.pos_phone_order_dialog.s76', "كاش")}
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethodAtDoor('card_pos')}
            style={{
              background: paymentMethodAtDoor === 'card_pos' ? '#170e5e' : '#f8fafc',
              color: paymentMethodAtDoor === 'card_pos' ? '#ffffff' : '#334155',
              border: '1px solid',
              borderColor: paymentMethodAtDoor === 'card_pos' ? '#170e5e' : '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 2px',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
            }}
          >
            <CreditCardIcon size={11} />
            {isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s77', "كي نت مع المندوب") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s78', "مدى مع المندوب") : t('pos.pos_workspace.pos_phone_order_dialog.s79', "فيزا مع الطيار")}
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethodAtDoor('instapay_wallet')}
            style={{
              background: paymentMethodAtDoor === 'instapay_wallet' ? '#170e5e' : '#f8fafc',
              color: paymentMethodAtDoor === 'instapay_wallet' ? '#ffffff' : '#334155',
              border: '1px solid',
              borderColor: paymentMethodAtDoor === 'instapay_wallet' ? '#170e5e' : '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 2px',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
            }}
          >
            {isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s80', "رابط دفع أونلاين") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s81', "تحويل / STC Pay") : t('pos.pos_workspace.pos_phone_order_dialog.s82', "إنستاباي / محفظة")}
          </button>
        </div>

        {paymentMethodAtDoor === 'cash' && (
          <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.65rem', color: '#64748b', whiteSpace: 'nowrap' }}>{t('pos.pos_workspace.pos_phone_order_dialog.s83', "العميل يدفع:")}</span>
            <input
              type="text"
              value={customerPaidNote}
              onChange={(e) => setCustomerPaidNote(e.target.value)}
              placeholder={isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s84', "مثال: 10 د.ك...") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s85', "مثال: 100 ر.س...") : t('pos.pos_workspace.pos_phone_order_dialog.s86', "مثال: 200 ج...")}
              style={{
                flex: 1,
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '0.7rem',
              }}
            />
            <div style={{ display: 'flex', gap: '2px' }}>
              {(isKwd ? ['5', '10', '20'] : isKsa ? ['50', '100', '200'] : ['100', '200', '500']).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCustomerPaidNote(val)}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '3px',
                    padding: '1px 4px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delivery Note input */}
      <div>
        <input
          type="text"
          value={deliveryNotes}
          onChange={(e) => setDeliveryNotes(e.target.value)}
          placeholder={t('pos.pos_workspace.pos_phone_order_dialog.s87', "توجيهات للطيار (مثال: رن الجرس مرتين، بجوار صيدلية العزبي)...")}
          style={{
            width: '100%',
            padding: '3px 6px',
            borderRadius: '4px',
            border: '1px solid #cbd5e1',
            fontSize: '0.72rem',
          }}
        />
      </div>
    </div>
  );
}
