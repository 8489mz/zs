// Top and bottom navigation for the van sales mobile page — pure move of the
// desktop top tab bar and the mobile fixed bottom navigation bar. The facade
// renders both components with trip data and cart state as props.
import React, { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { PackageIcon, MapPinIcon, ClockIcon, ReceiptIcon, CreditCardIcon, HomeIcon, ShoppingBagIcon } from '@/shared/components/icons/AppIcons';
import type { VanActiveTripResponse, VanCustomerItineraryItem, FleetMaintenanceAlert } from '@/features/delivery-reps/api/van-sales.api';
import type { CartItem } from '@/features/delivery-reps/components/VanSaleTab';

export interface VanMobileNavProps {
  currentTab: 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';
  setActiveTab: Dispatch<SetStateAction<'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions'>>;
  data: VanActiveTripResponse | undefined;
  itinerary: VanCustomerItineraryItem[];
  maintenanceAlerts: FleetMaintenanceAlert[];
  cart: CartItem[];
}

export const TopNav: React.FC<VanMobileNavProps> = ({
  currentTab,
  setActiveTab,
  data,
  itinerary,
  maintenanceAlerts,
  cart,
}) => {
  const { t: __t } = useTranslation();
  return (
    <>
            {/* Navigation Tabs Bar - Visible only on Desktop/Tablet, hidden on Mobile where Bottom Navigation is used */}
            <div className="van-top-nav-tabs" style={{ display: 'flex', backgroundColor: '#e2e8f0', padding: '4px', borderRadius: '10px', marginBottom: '14px', fontSize: '11.5px', fontWeight: 600, overflowX: 'auto', gap: '3px' }}>
              {data?.hasActiveTrip ? (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'itinerary' ? '#170e5e' : 'transparent',
                      color: currentTab === 'itinerary' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s58', __t('delivery_reps.van_sales_mobile_page.s58', "خط السير"))} {itinerary.length > 0 && `(${itinerary.filter((i) => i.visitStatus !== 'pending').length}/${itinerary.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'inventory' ? '#170e5e' : 'transparent',
                      color: currentTab === 'inventory' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s59', __t('delivery_reps.van_sales_mobile_page.s59', "بضاعة السيارة ("))}{data.inventory.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sale')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sale' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sale' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s60', __t('delivery_reps.van_sales_mobile_page.s60', "فاتورة بيع"))} {cart.length > 0 && `(${cart.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pre-sales')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'pre-sales' ? '#170e5e' : 'transparent',
                      color: currentTab === 'pre-sales' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s61', __t('delivery_reps.van_sales_mobile_page.s61', "حجز من المخزن"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sales-history')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sales-history' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sales-history' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s62', __t('delivery_reps.van_sales_mobile_page.s62', "سجل الفواتير"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('collection')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'collection' ? '#170e5e' : 'transparent',
                      color: currentTab === 'collection' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s63', __t('delivery_reps.van_sales_mobile_page.s63', "تحصيل / مرتجع"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('fleet')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'fleet' ? '#170e5e' : 'transparent',
                      color: currentTab === 'fleet' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      position: 'relative',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s64', __t('delivery_reps.van_sales_mobile_page.s64', "السيارة والوقود"))}
                    {maintenanceAlerts.some((a) => a.severity === 'critical') && (
                      <span
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: '#ef4444',
                          marginRight: '4px',
                        }}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settle')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'settle' ? '#170e5e' : 'transparent',
                      color: currentTab === 'settle' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s65', __t('delivery_reps.van_sales_mobile_page.s65', "تصفية اليومية"))}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('cockpit')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'cockpit' ? '#170e5e' : 'transparent',
                      color: currentTab === 'cockpit' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s66', __t('delivery_reps.van_sales_mobile_page.s66', "مركز القيادة"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'itinerary' ? '#170e5e' : 'transparent',
                      color: currentTab === 'itinerary' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s67', __t('delivery_reps.van_sales_mobile_page.s67', "خط السير"))} {itinerary.length > 0 && `(${itinerary.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'inventory' ? '#170e5e' : 'transparent',
                      color: currentTab === 'inventory' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s68', __t('delivery_reps.van_sales_mobile_page.s68', "المخزون والشحن"))} {data?.inventory?.length ? `(${data.inventory.length})` : '(0)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sale')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sale' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sale' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s69', __t('delivery_reps.van_sales_mobile_page.s69', "فاتورة بيع"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pre-sales')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'pre-sales' ? '#170e5e' : 'transparent',
                      color: currentTab === 'pre-sales' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s70', __t('delivery_reps.van_sales_mobile_page.s70', "حجز من المخزن"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sales-history')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sales-history' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sales-history' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s71', __t('delivery_reps.van_sales_mobile_page.s71', "سجل الفواتير"))}
                  </button>
                </>
              )}
            </div>
    </>
  );
};

export const BottomNav: React.FC<VanMobileNavProps> = ({
  currentTab,
  setActiveTab,
  data,
  cart,
}) => {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* Mobile Fixed Bottom Navigation Bar - Pinned Docked Standard with Curved Top Corners */}
      <nav
        dir="rtl"
        aria-label={__t('delivery_reps.van_sales_mobile_page.s186', __t('delivery_reps.van_sales_mobile_page.s186', "شريط الملاحة الميداني السريع للمندوب"))}
        className="van-bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          backgroundColor: '#ffffff',
          borderTopLeftRadius: '14px',
          borderTopRightRadius: '14px',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          border: '1px solid #e2e8f0',
          borderBottom: 'none',
          boxShadow: '0 -2px 10px rgba(15, 23, 42, 0.05)',
          zIndex: 90,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '520px',
            margin: '0 auto',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingTop: '5px',
            paddingBottom: 'calc(3px + env(safe-area-inset-bottom, 0px) * 0.4)',
            paddingLeft: '4px',
            paddingRight: '4px',
            boxSizing: 'border-box',
          }}
        >
        {data?.hasActiveTrip ? (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('itinerary')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'itinerary' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'itinerary' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <MapPinIcon size={14} color={currentTab === 'itinerary' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s187', __t('delivery_reps.van_sales_mobile_page.s187', "خط السير"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sale')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: (currentTab === 'sale' || currentTab === 'sales-history') ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: (currentTab === 'sale' || currentTab === 'sales-history') ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  transition: 'none',
                }}
              >
                <ReceiptIcon size={14} color={(currentTab === 'sale' || currentTab === 'sales-history') ? '#170e5e' : '#64748b'} />
                {cart.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-4px',
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      fontSize: '9px',
                      fontWeight: 900,
                      borderRadius: '6px',
                      padding: '0 3px',
                      lineHeight: '12px',
                      minWidth: '12px',
                      textAlign: 'center',
                    }}
                  >
                    {cart.length}
                  </span>
                )}
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s188', __t('delivery_reps.van_sales_mobile_page.s188', "فاتورة بيع"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pre-sales')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'pre-sales' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'pre-sales' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ShoppingBagIcon size={14} color={currentTab === 'pre-sales' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s189', __t('delivery_reps.van_sales_mobile_page.s189', "طلبيات"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'inventory' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'inventory' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <PackageIcon size={14} color={currentTab === 'inventory' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s190', __t('delivery_reps.van_sales_mobile_page.s190', "المخزون"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('collection')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'collection' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'collection' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <CreditCardIcon size={14} color={currentTab === 'collection' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s191', __t('delivery_reps.van_sales_mobile_page.s191', "التحصيل"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settle')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: (currentTab === 'settle' || currentTab === 'fleet') ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: (currentTab === 'settle' || currentTab === 'fleet') ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ClockIcon size={14} color={(currentTab === 'settle' || currentTab === 'fleet') ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s192', __t('delivery_reps.van_sales_mobile_page.s192', "اليومية"))}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('cockpit')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'cockpit' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'cockpit' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <HomeIcon size={14} color={currentTab === 'cockpit' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s193', __t('delivery_reps.van_sales_mobile_page.s193', "الرئيسية"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('itinerary')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'itinerary' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'itinerary' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <MapPinIcon size={14} color={currentTab === 'itinerary' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s194', __t('delivery_reps.van_sales_mobile_page.s194', "خط السير"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pre-sales')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'pre-sales' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'pre-sales' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ShoppingBagIcon size={14} color={currentTab === 'pre-sales' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s195', __t('delivery_reps.van_sales_mobile_page.s195', "طلبيات"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'inventory' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'inventory' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <PackageIcon size={14} color={currentTab === 'inventory' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s196', __t('delivery_reps.van_sales_mobile_page.s196', "المخزون"))}</span>
            </button>
          </>
        )}
        </div>
      </nav>
    </>
  );
};
