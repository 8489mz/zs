// Selected-customer strip — the STATE 1 header: avatar, name and phone,
// the VIP/cash badge, and the change-customer button that clears the
// selection and refocuses the phone search. Pure move; the dialog keeps
// all state and mounts this component with the customer and its callbacks.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import { Button } from '@/shared/ui/button';
import { SearchIcon, UserIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderCustomerStrip({
  currentCustomer,
  setSelectedCustomerId,
  setSelectedAddress,
  setIsForceNewCustomer,
  searchInputRef,
}: {
  currentCustomer: PosCustomerDeliveryProfile['customer'] | null | undefined;
  setSelectedCustomerId: Dispatch<SetStateAction<string | null>>;
  setSelectedAddress: Dispatch<SetStateAction<string>>;
  setIsForceNewCustomer: Dispatch<SetStateAction<boolean>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#eff6ff',
        padding: '6px 12px',
        borderRadius: '8px',
        border: '1px solid #bfdbfe',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: '#1e40af',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <UserIcon size={14} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e3a8a' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s47', "العميل النشط:")} {currentCustomer.name}
          </span>
          <span style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>
            ({currentCustomer.phone || t('pos.pos_workspace.pos_phone_order_dialog.s48', "بدون رقم")})
          </span>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '4px',
              background: currentCustomer.customerType === 'vip' ? '#fef3c7' : '#e0e7ff',
              color: currentCustomer.customerType === 'vip' ? '#92400e' : '#3730a3',
            }}
          >
            {currentCustomer.customerType === 'vip' ? 'VIP' : t('pos.pos_workspace.pos_phone_order_dialog.s49', "نقدي")}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setSelectedCustomerId(null);
          setSelectedAddress('');
          setIsForceNewCustomer(false);
          searchInputRef.current?.focus();
        }}
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          padding: '3px 8px',
          background: '#ffffff',
          border: '1px solid #93c5fd',
          color: '#1e40af',
        }}
      >
        <SearchIcon size={12} style={{ marginLeft: '4px' }} />
        {t('pos.pos_workspace.pos_phone_order_dialog.s50', "تغيير العميل")}
      </Button>
    </div>
  );
}
