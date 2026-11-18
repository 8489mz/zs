// Customer profile card — quick stats (orders, spend, loyalty), notes, and
// the delivery-address selector with its tag picker, custom-address form,
// and saved-address list. Pure move; the dialog keeps all state and mounts
// this component with the profile and address callbacks.

import type { Dispatch, SetStateAction } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import { MapPinIcon, PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogProfileAddresses({
  profileData,
  currentCustomer,
  setIsCustomAddressMode,
  isCustomAddressMode,
  setAddressTag,
  addressTag,
  customAddressInput,
  setCustomAddressInput,
  handleSaveCustomAddress,
  isKwd,
  addAddressMutation,
  addresses,
  selectedAddress,
  setSelectedAddress,
  deleteAddressMutation,
}: {
  profileData: PosCustomerDeliveryProfile | undefined;
  currentCustomer: NonNullable<PosCustomerDeliveryProfile['customer']>;
  setIsCustomAddressMode: Dispatch<SetStateAction<boolean>>;
  isCustomAddressMode: boolean;
  setAddressTag: Dispatch<SetStateAction<'home' | 'work' | 'other'>>;
  addressTag: 'home' | 'work' | 'other';
  customAddressInput: string;
  setCustomAddressInput: Dispatch<SetStateAction<string>>;
  handleSaveCustomAddress: () => void;
  isKwd: boolean;
  addAddressMutation: UseMutationResult<{ ok: boolean; addresses: string[] }, any, { customerId: string; address: string }, unknown>;
  addresses: PosCustomerDeliveryProfile['addresses'];
  selectedAddress: string;
  setSelectedAddress: Dispatch<SetStateAction<string>>;
  deleteAddressMutation: UseMutationResult<{ ok: boolean; addresses: string[] }, any, { customerId: string; address: string }, unknown>;
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
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
        <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s51', "إجمالي الطلبات")}</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e293b' }}>
            {profileData?.stats?.invoiceCount || 0}
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s52', "إجمالي المشتريات")}</div>
          <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#170e5e' }}>
            {formatCurrency(profileData?.stats?.totalSalesAmount || 0)}
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '6px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_phone_order_dialog.s53', "نقاط الولاء")}</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#059669' }}>
            {currentCustomer.loyaltyPoints || 0}
          </div>
        </div>
      </div>

      {/* Customer notes if any */}
      {currentCustomer.notes && (
        <div style={{ background: '#fffbeb', padding: '3px 8px', borderRadius: '4px', border: '1px solid #fef3c7', fontSize: '0.7rem', color: '#92400e' }}>
          <strong>{t('pos.pos_workspace.pos_phone_order_dialog.s54', "ملاحظات:")}</strong> {currentCustomer.notes}
        </div>
      )}

      {/* Delivery Address Selector */}
      <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <MapPinIcon size={12} color="#2563eb" />
            <span>{t('pos.pos_workspace.pos_phone_order_dialog.s55', "عنوان التوصيل")}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsCustomAddressMode(!isCustomAddressMode)}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {isCustomAddressMode ? t('pos.pos_workspace.pos_phone_order_dialog.s56', "اختيار من العناوين المحفوظة") : t('pos.pos_workspace.pos_phone_order_dialog.s57', "+ عنوان جديد")}
          </button>
        </div>

        {isCustomAddressMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {(['home', 'work', 'other'] as const).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setAddressTag(tag)}
                  style={{
                    background: addressTag === tag ? '#2563eb' : '#f1f5f9',
                    color: addressTag === tag ? '#ffffff' : '#475569',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tag === 'home' ? t('pos.pos_workspace.pos_phone_order_dialog.s58', "المنزل") : tag === 'work' ? t('pos.pos_workspace.pos_phone_order_dialog.s59', "العمل") : t('pos.pos_workspace.pos_phone_order_dialog.s60', "أخرى")}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={customAddressInput}
                onChange={(e) => setCustomAddressInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveCustomAddress();
                  }
                }}
                placeholder={isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s61', "اكتب العنوان بالتفصيل (المنطقة، قطعة، شارع، منزل، والرقم الآلي للعنوان)...") : t('pos.pos_workspace.pos_phone_order_dialog.s62', "اكتب العنوان بالتفصيل (المنطقة، الشارع، العقار، الدور)...")}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.75rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleSaveCustomAddress}
                disabled={addAddressMutation.isPending || !customAddressInput.trim()}
                style={{
                  background: '#10b981',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                  opacity: !customAddressInput.trim() ? 0.6 : 1,
                }}
                title={t('pos.pos_workspace.pos_phone_order_dialog.s63', "حفظ هذا العنوان في ملف العميل دائماً")}
              >
                <PlusIcon size={12} />
                <span>{t('pos.pos_workspace.pos_phone_order_dialog.s64', "حفظ العنوان")}</span>
              </button>
            </div>
          </div>
        ) : addresses.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
            {addresses.map((addr, idx) => {
              const isSelected = selectedAddress === addr;
              const isHome = addr.startsWith(t('pos.pos_workspace.pos_phone_order_dialog.s65', "[المنزل]"));
              const isWork = addr.startsWith(t('pos.pos_workspace.pos_phone_order_dialog.s66', "[العمل]"));
              const displayAddr = addr.replace(/^\[(المنزل|العمل|أخرى)\]\s*/, '');
              const tagLabel = isHome ? t('pos.pos_workspace.pos_phone_order_dialog.s67', "المنزل") : isWork ? t('pos.pos_workspace.pos_phone_order_dialog.s68', "العمل") : null;

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedAddress(addr)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    fontSize: '0.72rem',
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? '#1e40af' : '#334155',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                    <input
                      type="radio"
                      name="delivery_address"
                      checked={isSelected}
                      onChange={() => setSelectedAddress(addr)}
                      style={{ accentColor: '#2563eb', margin: 0 }}
                    />
                    {tagLabel && (
                      <span
                        style={{
                          background: isHome ? '#e0f2fe' : '#fef3c7',
                          color: isHome ? '#0369a1' : '#b45309',
                          fontSize: '0.625rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '3px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {tagLabel}
                      </span>
                    )}
                    <span style={{ flex: 1, wordBreak: 'break-word', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {displayAddr}
                    </span>
                  </div>
                  {currentCustomer && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAddressMutation.mutate({ customerId: String(currentCustomer.id), address: addr });
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title={t('pos.pos_workspace.pos_phone_order_dialog.s69', "حذف هذا العنوان")}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                    >
                      <TrashIcon size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '4px', textAlign: 'center', background: '#f8fafc', borderRadius: '4px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s70', "لا يوجد عناوين سابقة مسجلة لهذا العميل. اضغط على \"+ عنوان جديد\" لإضافة عنوان.")}
          </div>
        )}
      </div>
    </div>
  );
}
