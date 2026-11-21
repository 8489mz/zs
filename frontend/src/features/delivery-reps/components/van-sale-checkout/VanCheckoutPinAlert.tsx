import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

export interface VanCheckoutPinAlertProps {
  isCreditExceeded: boolean;
  isCashOnlyCustomerCredit: boolean;
  isNewCustomerCredit: boolean;
  isCardPayment: boolean;
  hasBonusItems: boolean;
  isGeofenceBlocked: boolean;
  geofenceDistance: number | null;
  newCustomerName?: string;
  t: TFunction;
  supervisorPin: string;
  setSupervisorPin: Dispatch<SetStateAction<string>>;
  supervisorReason: string;
  setSupervisorReason: Dispatch<SetStateAction<string>>;
}

export function VanCheckoutPinAlert({
  isCreditExceeded,
  isCashOnlyCustomerCredit,
  isNewCustomerCredit,
  isCardPayment,
  hasBonusItems,
  isGeofenceBlocked,
  geofenceDistance,
  newCustomerName,
  t,
  supervisorPin,
  setSupervisorPin,
  supervisorReason,
  setSupervisorReason,
}: VanCheckoutPinAlertProps) {
  return (
    <>
      {/* Supervisor PIN Alert Box if Authorization Needed */}
      {(isCreditExceeded || isCashOnlyCustomerCredit || isNewCustomerCredit || isCardPayment || hasBonusItems || isGeofenceBlocked) && (
        <div
          style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fdba74',
            borderRadius: '7px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#c2410c', fontWeight: 800, fontSize: '11.5px' }}>
            <AlertTriangleIcon size={14} color="#ea580c" />
            <span>
              {isGeofenceBlocked
                ? `قفل جغرافي: موقعك يبعد (${geofenceDistance}م) عن دكان العميل`
                : isCreditExceeded
                ? `تنبيه: رصيد العميل بعد الفاتورة سيتجاوز الحد المسموح`
                : isCashOnlyCustomerCredit
                ? `اعتماد المشرف مطلوب: العميل مصنف نقدي فقط`
                : isNewCustomerCredit
                ? `اعتماد المشرف مطلوب: بيع آجل لعميل جديد ("${newCustomerName}")`
                : isCardPayment
                ? t('delivery_reps.van_sale_checkout_modal.s54', "اعتماد المشرف ورقم إيصال الشبكة مطلوبان")
                : t('delivery_reps.van_sale_checkout_modal.s55', "اعتماد المشرف مطلوب لصرف البونص العيني")}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px' }}>
            <input
              type="password"
              maxLength={6}
              value={supervisorPin}
              onChange={(e) => setSupervisorPin(e.target.value)}
              placeholder={t('delivery_reps.van_sale_checkout_modal.s56', "PIN المشرف")}
              style={{
                height: '32px',
                borderRadius: '5px',
                border: '1px solid #f97316',
                fontSize: '12px',
                fontWeight: 800,
                textAlign: 'center',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
            <input
              type="text"
              value={supervisorReason}
              onChange={(e) => setSupervisorReason(e.target.value)}
              placeholder={isCardPayment ? t('delivery_reps.van_sale_checkout_modal.s57', "رقم إيصال الشبكة") : t('delivery_reps.van_sale_checkout_modal.s58', "سبب الاعتماد")}
              style={{
                height: '32px',
                borderRadius: '5px',
                border: '1px solid #fed7aa',
                fontSize: '11.5px',
                padding: '0 8px',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
