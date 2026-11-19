// Mobile tab switcher for the waiter station active order view.
// Pure move; the page keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { ShoppingCartIcon, UtensilsIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';

export interface WaiterStationMobileTabSwitcherProps {
  isMobile: boolean;
  setMobileActiveTab: Dispatch<SetStateAction<'menu' | 'cart'>>;
  mobileActiveTab: 'menu' | 'cart';
  filteredProducts: any[];
  cartItemsCount: number;
  cartTotal: number;
}

export function WaiterStationMobileTabSwitcher({
  isMobile,
  setMobileActiveTab,
  mobileActiveTab,
  filteredProducts,
  cartItemsCount,
  cartTotal,
}: WaiterStationMobileTabSwitcherProps) {
  const { t } = useTranslation();
  return (
    <>
      {isMobile && (
        <div
          style={{
            display: 'flex',
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            padding: '6px 12px',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setMobileActiveTab('menu')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: mobileActiveTab === 'menu' ? '1px solid #170e5e' : '1px solid #e2e8f0',
              background: mobileActiveTab === 'menu' ? '#170e5e' : '#f8fafc',
              color: mobileActiveTab === 'menu' ? '#ffffff' : '#475569',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            <UtensilsIcon size={14} color={mobileActiveTab === 'menu' ? '#ffffff' : '#475569'} />
            <span>{t('pos.waiter_station_page.s26', "قائمة الأصناف (")}{filteredProducts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileActiveTab('cart')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: mobileActiveTab === 'cart' ? '1px solid #170e5e' : '1px solid #e2e8f0',
              background: mobileActiveTab === 'cart' ? '#170e5e' : '#f8fafc',
              color: mobileActiveTab === 'cart' ? '#ffffff' : '#475569',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            <ShoppingCartIcon size={14} color={mobileActiveTab === 'cart' ? '#ffffff' : '#475569'} />
            <span>{t('pos.waiter_station_page.s27', "سلة الطلب (")}{cartItemsCount}) · {formatCurrency(cartTotal)}</span>
          </button>
        </div>
      )}
    </>
  );
}
