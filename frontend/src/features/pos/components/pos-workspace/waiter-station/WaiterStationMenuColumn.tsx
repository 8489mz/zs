// VIEW 2 menu column for the waiter station active order: categories bar
// + search + products grid + mobile floating cart bar. Pure move; the page
// keeps all state and mounts this component.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchIcon, ShoppingCartIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';

export interface WaiterStationMenuColumnProps {
  isMobile: boolean;
  mobileActiveTab: 'menu' | 'cart';
  setSelectedCategory: Dispatch<SetStateAction<string>>;
  selectedCategory: string;
  categories: string[];
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  filteredProducts: any[];
  handleAddItem: (product: any) => void;
  cart: WaiterCartItem[];
  cartItemsCount: number;
  cartTotal: number;
  setMobileActiveTab: Dispatch<SetStateAction<'menu' | 'cart'>>;
}

export function WaiterStationMenuColumn({
  isMobile,
  mobileActiveTab,
  setSelectedCategory,
  selectedCategory,
  categories,
  searchQuery,
  setSearchQuery,
  filteredProducts,
  handleAddItem,
  cart,
  cartItemsCount,
  cartTotal,
  setMobileActiveTab,
}: WaiterStationMenuColumnProps) {
  const { t } = useTranslation();
  return (
    <>
        {(!isMobile || mobileActiveTab === 'menu') && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: isMobile ? 'none' : '1px solid #cbd5e1',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
          {/* Categories Horizontal Bar */}
          <div
            style={{
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              padding: '8px 12px',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              style={{
                background: selectedCategory === 'all' ? '#170e5e' : '#f1f5f9',
                color: selectedCategory === 'all' ? '#ffffff' : '#334155',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('pos.waiter_station_page.s28', "الكل")}
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  background: selectedCategory === cat ? '#170e5e' : '#f1f5f9',
                  color: selectedCategory === cat ? '#ffffff' : '#334155',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '6px 10px' }}>
              <SearchIcon size={14} color="#64748b" />
              <input
                type="text"
                placeholder={t('pos.waiter_station_page.s29', "بحث سريع باسم الوجبة أو المشروب...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ border: 'none', outline: 'none', width: '100%', fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Product Items Grid (Adaptive Clamping & Responsive Cell Sizes) */}
          <div
            style={{
              flex: 1,
              padding: isMobile ? '10px' : '14px',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: isMobile
                ? 'repeat(auto-fill, minmax(130px, 1fr))'
                : 'repeat(auto-fill, minmax(155px, 1fr))',
              gap: isMobile ? '8px' : '12px',
              alignContent: 'start',
            }}
          >
            {filteredProducts.map((p: any) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleAddItem(p)}
                title={p.name}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '10px 10px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  height: '130px',
                  minHeight: '130px',
                  maxHeight: '130px',
                  minWidth: 0,
                  width: '100%',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#170e5e';
                  e.currentTarget.style.boxShadow = '0 3px 8px rgba(23, 14, 94, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
                }}
              >
                {(p.imageUrl || p.metadata?.imageUrl) ? (
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    marginBottom: '4px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <img
                      src={p.imageUrl || p.metadata?.imageUrl}
                      alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      loading="lazy"
                    />
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#0f172a',
                    lineHeight: '1.3',
                    textAlign: 'center',
                    width: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: (p.imageUrl || p.metadata?.imageUrl) ? 2 : 3,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    whiteSpace: 'normal',
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 900,
                    color: '#170e5e',
                    marginTop: 'auto',
                    paddingTop: '4px',
                    width: '100%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'center',
                  }}
                >
                  {formatCurrency(p.price || p.retail_price || 0)}
                </div>
              </button>
            ))}
          </div>

          {/* Mobile Bottom Floating Cart Bar */}
          {isMobile && cart.length > 0 && (
            <div
              style={{
                background: '#ffffff',
                borderTop: '2px solid #170e5e',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.08)',
                zIndex: 10,
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                  {t('pos.waiter_station_page.s30', "الطلب الحالي (")}{cartItemsCount} {t('pos.waiter_station_page.s31', "أصناف)")}
                </div>
                <div style={{ fontSize: '15px', color: '#170e5e', fontWeight: 900 }}>
                  {formatCurrency(cartTotal)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileActiveTab('cart')}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ShoppingCartIcon size={14} color="#ffffff" />
                <span>{t('pos.waiter_station_page.s32', "مراجعة السلة (")}{cartItemsCount})</span>
              </button>
            </div>
          )}
        </div>
        )}
    </>
  );
}
