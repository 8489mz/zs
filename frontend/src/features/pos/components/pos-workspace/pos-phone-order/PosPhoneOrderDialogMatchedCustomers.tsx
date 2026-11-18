// Matched customers — the candidate cards grid shown when the phone
// lookup finds several customers, with a create-new shortcut and one
// pick button per card. Pure move; the dialog keeps all state and
// mounts this component with the matched list and the pick callbacks.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import { ArrowLeftIcon, MapPinIcon, PhoneIcon, PlusIcon, UserIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogMatchedCustomers({
  matchedCustomers,
  setIsForceNewCustomer,
  setNewPhone,
  phoneQuery,
  setSelectedCustomerId,
  setSelectedAddress,
}: {
  matchedCustomers: NonNullable<PosCustomerDeliveryProfile['matchedCustomers']>;
  setIsForceNewCustomer: Dispatch<SetStateAction<boolean>>;
  setNewPhone: Dispatch<SetStateAction<string>>;
  phoneQuery: string;
  setSelectedCustomerId: Dispatch<SetStateAction<string | null>>;
  setSelectedAddress: Dispatch<SetStateAction<string>>;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f8fafc',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s95', "نتائج البحث المتطابقة")}
          </span>
          <span
            style={{
              background: '#170e5e',
              color: '#ffffff',
              fontSize: '0.6875rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: '10px',
            }}
          >
            {matchedCustomers.length} {t('pos.pos_workspace.pos_phone_order_dialog.s96', "عميل")}
          </span>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setIsForceNewCustomer(true);
            setNewPhone(phoneQuery || '');
          }}
          style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px' }}
        >
          <PlusIcon size={12} style={{ marginLeft: '4px' }} />
          {t('pos.pos_workspace.pos_phone_order_dialog.s97', "تسجيل عميل جديد برقم (")}{phoneQuery})
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '8px',
          maxHeight: '290px',
          overflowY: 'auto',
          padding: '2px',
        }}
      >
        {matchedCustomers.map((c) => (
          <div
            key={c.id}
            style={{
              background: '#ffffff',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      background: '#f1f5f9',
                      color: '#170e5e',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UserIcon size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <PhoneIcon size={11} color="#64748b" />
                      <span>{c.phone || t('pos.pos_workspace.pos_phone_order_dialog.s98', "بدون رقم")}</span>
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: c.customerType === 'vip' ? '#fef3c7' : '#f1f5f9',
                    color: c.customerType === 'vip' ? '#92400e' : '#475569',
                  }}
                >
                  {c.customerType === 'vip' ? 'VIP' : t('pos.pos_workspace.pos_phone_order_dialog.s99', "نقدي")}
                </span>
              </div>

              {c.address && (
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: '#475569',
                    background: '#f8fafc',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    marginTop: '2px',
                  }}
                >
                  <MapPinIcon size={11} color="#64748b" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.address}
                  </span>
                </div>
              )}
            </div>

            <Button
              size="sm"
              style={{
                width: '100%',
                background: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '5px 8px',
              }}
              onClick={() => {
                setSelectedCustomerId(c.id);
                setSelectedAddress('');
              }}
            >
              <ArrowLeftIcon size={13} style={{ marginLeft: '4px' }} />
              {t('pos.pos_workspace.pos_phone_order_dialog.s100', "اختيار العميل وتجهيز الطلب")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
