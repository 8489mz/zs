// Cart column for the waiter station active order view.
// Pure move; the page keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';

export interface WaiterStationCartColumnProps {
  isMobile: boolean;
  mobileActiveTab: 'menu' | 'cart';
  setMobileActiveTab: Dispatch<SetStateAction<'menu' | 'cart'>>;
  cartItemsCount: number;
  cart: WaiterCartItem[];
  handleUpdateQty: (itemId: string, delta: number) => void;
  setActiveItemNoteModal: Dispatch<SetStateAction<WaiterCartItem | null>>;
  setItemNoteText: Dispatch<SetStateAction<string>>;
  cartTotal: number;
  isSendingToKitchen: boolean;
  handleSendToKitchen: () => Promise<void>;
}

export function WaiterStationCartColumn({
  isMobile,
  mobileActiveTab,
  setMobileActiveTab,
  cartItemsCount,
  cart,
  handleUpdateQty,
  setActiveItemNoteModal,
  setItemNoteText,
  cartTotal,
  isSendingToKitchen,
  handleSendToKitchen,
}: WaiterStationCartColumnProps) {
  const { t } = useTranslation();
  return (
    <>
        {(!isMobile || mobileActiveTab === 'cart') && (
          <div
            style={{
              flex: isMobile ? 1 : undefined,
              width: isMobile ? '100%' : '340px',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              overflow: 'hidden',
            }}
          >
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.waiter_station_page.s33', "طلبات الطاولة الجديدة (")}{cartItemsCount})
            </div>
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileActiveTab('menu')}
                style={{
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  color: '#170e5e',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('pos.waiter_station_page.s34', "+ إضافة المزيد")}
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: '#64748b', fontSize: '12px' }}>
                {t('pos.waiter_station_page.s35', "اضغط على الأصناف من القائمة لإضافتها للطلب.")}
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 800,
                        color: '#0f172a',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {item.name}
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#170e5e', whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.price * item.qty)}
                    </div>
                  </div>

                  {item.notes && (
                    <div style={{ fontSize: '11px', color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                      {t('pos.waiter_station_page.s36', "ملاحظة:")} {item.notes}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    {/* RTL Stepper: [+] first, number, [-] last */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', height: '26px' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, 1)}
                        style={{ width: '26px', height: '100%', border: 'none', background: 'transparent', fontWeight: 800, color: '#170e5e', cursor: 'pointer' }}
                      >
                        +
                      </button>
                      <span style={{ minWidth: '24px', textAlign: 'center', fontSize: '12px', fontWeight: 800 }}>
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.id, -1)}
                        style={{ width: '26px', height: '100%', border: 'none', background: 'transparent', fontWeight: 800, color: '#64748b', cursor: 'pointer' }}
                      >
                        -
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveItemNoteModal(item);
                        setItemNoteText(item.notes || '');
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#170e5e',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {item.notes ? t('pos.waiter_station_page.s37', "تعديل الملاحظة") : t('pos.waiter_station_page.s38', "+ ملاحظة طبق")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cart Footer & Big Kitchen Action Button */}
          <div style={{ padding: '12px 14px', borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s39', "إجمالي الطلب:")}</span>
              <strong style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>{formatCurrency(cartTotal)}</strong>
            </div>

            <button
              type="button"
              disabled={cart.length === 0 || isSendingToKitchen}
              onClick={handleSendToKitchen}
              style={{
                width: '100%',
                background: cart.length === 0 ? '#94a3b8' : '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 900,
                cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: cart.length > 0 ? '0 4px 12px rgba(23, 14, 94, 0.25)' : 'none',
              }}
            >
              <CheckCircleIcon size={16} color="#ffffff" />
              <span>{isSendingToKitchen ? t('pos.waiter_station_page.s40', "جاري الإرسال...") : t('pos.waiter_station_page.s41', "إرسال الطلب للمطبخ (Send to Kitchen)")}</span>
            </button>
          </div>
        </div>
        )}
    </>
  );
}
