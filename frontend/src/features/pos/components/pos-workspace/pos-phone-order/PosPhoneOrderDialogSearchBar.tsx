// Phone search bar — the desk tab top row: a phone/name input with a
// clear button, plus a fetching indicator while the delivery lookup
// is running. Pure move; the dialog keeps all state and mounts this
// component with the query state and its setters.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import { RefreshCwIcon, SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogSearchBar({
  searchInputRef,
  phoneQuery,
  setPhoneQuery,
  setSelectedCustomerId,
  setSelectedAddress,
  setIsForceNewCustomer,
  setNewPhone,
  isKwd,
  isKsa,
  deliveryLookupQuery,
}: {
  searchInputRef: RefObject<HTMLInputElement | null>;
  phoneQuery: string;
  setPhoneQuery: Dispatch<SetStateAction<string>>;
  setSelectedCustomerId: Dispatch<SetStateAction<string | null>>;
  setSelectedAddress: Dispatch<SetStateAction<string>>;
  setIsForceNewCustomer: Dispatch<SetStateAction<boolean>>;
  setNewPhone: Dispatch<SetStateAction<string>>;
  isKwd: boolean;
  isKsa: boolean;
  deliveryLookupQuery: UseQueryResult<PosCustomerDeliveryProfile, Error>;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#f8fafc',
        padding: '6px 12px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          ref={searchInputRef}
          type="text"
          value={phoneQuery}
          onChange={(e) => {
            setPhoneQuery(e.target.value);
            setSelectedCustomerId(null);
            setSelectedAddress('');
            setIsForceNewCustomer(false);
            setNewPhone(e.target.value);
          }}
          placeholder={
            isKwd
              ? t('pos.pos_workspace.pos_phone_order_dialog.s37', "أدخل رقم هاتف العميل بالكويت (8 أرقام مثال: 91234567) أو اسم العميل...")
              : isKsa
              ? t('pos.pos_workspace.pos_phone_order_dialog.s38', "أدخل رقم هاتف العميل بالسعودية (مثال: 0501234567) أو اسم العميل...")
              : t('pos.pos_workspace.pos_phone_order_dialog.s39', "أدخل رقم هاتف العميل (مثال: 01012345678) أو اسم العميل...")
          }
          style={{
            width: '100%',
            padding: '6px 32px 6px 10px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#0f172a',
            background: '#ffffff',
            outline: 'none',
          }}
        />
        <SearchIcon
          size={16}
          color="#94a3b8"
          style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}
        />
        {phoneQuery && (
          <button
            type="button"
            onClick={() => {
              setPhoneQuery('');
              setSelectedCustomerId(null);
              setSelectedAddress('');
              setIsForceNewCustomer(false);
              searchInputRef.current?.focus();
            }}
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <XIcon size={13} />
          </button>
        )}
      </div>

      {deliveryLookupQuery.isFetching && (
        <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <RefreshCwIcon size={13} className="spin" />
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s40', "جاري البحث...")}</span>
        </div>
      )}
    </div>
  );
}
