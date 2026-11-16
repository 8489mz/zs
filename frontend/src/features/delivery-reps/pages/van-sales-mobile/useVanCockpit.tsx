// Cockpit and fleet tabs for the van sales mobile page — pure move of the
// showFleetInCockpit state, the cockpit tab, and the fleet tab. The facade
// calls the hook once and passes hook values and trip data as props.
import React, { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueryObserverResult, UseMutationResult } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { TruckIcon, PackageIcon, MapPinIcon, CheckCircleIcon, AlertTriangleIcon, ShoppingBagIcon } from '@/shared/components/icons/AppIcons';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { VanFleetTab } from '@/features/delivery-reps/components/VanFleetTab';
import type { VanActiveTripResponse, VanLoadRequisitionRecord, FleetFuelLogRecord, FleetMaintenanceAlert, VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

export interface CockpitVehicle {
  id?: number;
  plate?: string;
  model?: string;
  startOdometer?: number;
  endOdometer?: number;
  fuelType?: string;
  licenseExpiresAt?: string;
  status?: string;
}

export function useVanCockpit() {
  const [showFleetInCockpit, setShowFleetInCockpit] = useState<boolean>(false);

  return {
    showFleetInCockpit,
    setShowFleetInCockpit,
  };
}

export interface CockpitTabProps {
  showFleetInCockpit: boolean;
  setShowFleetInCockpit: Dispatch<SetStateAction<boolean>>;
  data: VanActiveTripResponse | undefined;
  fuelLogs: FleetFuelLogRecord[];
  itinerary: VanCustomerItineraryItem[];
  maintenanceAlerts: FleetMaintenanceAlert[];
  myRequisitions: VanLoadRequisitionRecord[];
  refetch: () => Promise<QueryObserverResult<VanActiveTripResponse, Error>>;
  refetchFuelLogs: () => Promise<QueryObserverResult<FleetFuelLogRecord[], Error>>;
  startTripMutation: UseMutationResult<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }, Error, string | void, unknown>;
  totalInventoryValue: number;
  vehicle: CockpitVehicle | undefined;
  setViewMode: Dispatch<SetStateAction<'dashboard' | 'new-requisition'>>;
  setActiveTab: Dispatch<SetStateAction<'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions'>>;
  setInventorySubMode: Dispatch<SetStateAction<'stock' | 'requisitions'>>;
}

export const CockpitTab: React.FC<CockpitTabProps> = ({
  showFleetInCockpit,
  setShowFleetInCockpit,
  data,
  fuelLogs,
  itinerary,
  maintenanceAlerts,
  myRequisitions,
  refetch,
  refetchFuelLogs,
  startTripMutation,
  totalInventoryValue,
  vehicle,
  setViewMode,
  setActiveTab,
  setInventorySubMode,
}) => {
  const { t: __t } = useTranslation();
  return (
    <>
            {/* TAB CONTENT: COCKPIT (Idle / Standby Morning Hub) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Quick Actions Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '-4px' }}>
                  <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                  <h2 style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s72', __t('delivery_reps.van_sales_mobile_page.s72', "الإجراءات الميدانية السريعة"))}
                  </h2>
                </div>

                {/* 2-Column Quick Action Grid (دستور شبكة الإجراءات المتوازنة ثنائية الأعمدة) */}
                <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                  {/* Tile 1: إذن تحميل بضاعة */}
                  <button
                    type="button"
                    onClick={() => setViewMode('new-requisition')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <PackageIcon size={16} color="#7e22ce" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s73', __t('delivery_reps.van_sales_mobile_page.s73', "إذن تحميل بضاعة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s74', __t('delivery_reps.van_sales_mobile_page.s74', "طلب شحن من المستودع"))}</span>
                  </button>

                  {/* Tile 2: خط سير اليوم */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <MapPinIcon size={16} color="#15803d" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s75', __t('delivery_reps.van_sales_mobile_page.s75', "خط سير اليوم"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s76', __t('delivery_reps.van_sales_mobile_page.s76', "متاجر مجدولة"))}</span>
                  </button>

                  {/* Tile 3: تسجيل وقود وصيانة */}
                  <button
                    type="button"
                    onClick={() => setShowFleetInCockpit((prev) => !prev)}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <TruckIcon size={16} color="#b45309" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s77', __t('delivery_reps.van_sales_mobile_page.s77', "تفويل وصيانة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s78', __t('delivery_reps.van_sales_mobile_page.s78', "سجل الوقود والعداد"))}</span>
                  </button>

                  {/* Tile 4: بضاعة ومخزون السيارة */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <ShoppingBagIcon size={16} color="#0369a1" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s79', __t('delivery_reps.van_sales_mobile_page.s79', "مخزون السيارة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{data?.inventory?.length || 0} {__t('delivery_reps.van_sales_mobile_page.s80', __t('delivery_reps.van_sales_mobile_page.s80', "أصناف متوفرة"))}</span>
                  </button>
                </div>

                {/* 1. Vehicle Fleet Status & Health Cockpit */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TruckIcon size={15} color="#170e5e" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{__t('delivery_reps.van_sales_mobile_page.s81', __t('delivery_reps.van_sales_mobile_page.s81', "مركبة التوزيع والأسطول الميداني"))}</h3>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s82', __t('delivery_reps.van_sales_mobile_page.s82', "حالة السيارة وقراءة العداد وتنبيهات الصيانة"))}</span>
                    </div>
                  </div>

                  {/* Vehicle Specs Grid: 4 Balanced Elegant Tiles */}
                  <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginBottom: '8px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s83', __t('delivery_reps.van_sales_mobile_page.s83', "رقم لوحة السيارة"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>{vehicle?.plate || __t('delivery_reps.van_sales_mobile_page.s84', __t('delivery_reps.van_sales_mobile_page.s84', "سيارة التوزيع"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s85', __t('delivery_reps.van_sales_mobile_page.s85', "الموديل والنوع"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{vehicle?.model || __t('delivery_reps.van_sales_mobile_page.s86', __t('delivery_reps.van_sales_mobile_page.s86', "فان توزيع بضاعة"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s87', __t('delivery_reps.van_sales_mobile_page.s87', "عداد الكيلومتر الحالي"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{vehicle?.startOdometer ? `${vehicle.startOdometer.toLocaleString()} كم` : __t('delivery_reps.van_sales_mobile_page.s88', __t('delivery_reps.van_sales_mobile_page.s88', "0 كم"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s89', __t('delivery_reps.van_sales_mobile_page.s89', "نوع الوقود"))}</span>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#166534', backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: '5px', display: 'inline-block' }}>
                        {vehicle?.fuelType === 'diesel' ? __t('delivery_reps.van_sales_mobile_page.s90', __t('delivery_reps.van_sales_mobile_page.s90', "سولار")) : __t('delivery_reps.van_sales_mobile_page.s91', __t('delivery_reps.van_sales_mobile_page.s91', "بنزين 92"))}
                      </span>
                    </div>
                  </div>

                  {/* Maintenance & Oil Alerts Strip */}
                  {maintenanceAlerts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' }}>
                      {maintenanceAlerts.map((al) => (
                        <div
                          key={al.id}
                          style={{
                            backgroundColor: al.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                            border: `1px solid ${al.severity === 'critical' ? '#fecaca' : '#fde68a'}`,
                            borderRadius: '8px',
                            padding: '6px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertTriangleIcon size={14} color={al.severity === 'critical' ? '#dc2626' : '#d97706'} />
                            <span style={{ fontSize: '11px', fontWeight: 700, color: al.severity === 'critical' ? '#991b1b' : '#92400e' }}>
                              {al.description || al.title}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowFleetInCockpit(true)}
                            style={{
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              color: '#0f172a',
                              borderRadius: '5px',
                              padding: '2px 7px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {__t('delivery_reps.van_sales_mobile_page.s92', __t('delivery_reps.van_sales_mobile_page.s92', "تسجيل الصيانة"))}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <CheckCircleIcon size={14} color="#16a34a" />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#166534' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s93', __t('delivery_reps.van_sales_mobile_page.s93', "حالة المركبة ممتازة ولا توجد تنبيهات صيانة أو غيارات زيت متأخرة"))}
                      </span>
                    </div>
                  )}

                  {/* Quick Fleet Toggles */}
                  <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                    <button
                      type="button"
                      onClick={() => setShowFleetInCockpit((prev) => !prev)}
                      style={{
                        backgroundColor: showFleetInCockpit ? '#170e5e' : '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: showFleetInCockpit ? '#ffffff' : '#170e5e',
                        borderRadius: '7px',
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      {showFleetInCockpit ? __t('delivery_reps.van_sales_mobile_page.s94', __t('delivery_reps.van_sales_mobile_page.s94', "إخفاء سجل المركبة")) : __t('delivery_reps.van_sales_mobile_page.s95', __t('delivery_reps.van_sales_mobile_page.s95', "+ تسجيل تفويلة وقود"))}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFleetInCockpit((prev) => !prev)}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#0f172a',
                        borderRadius: '7px',
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      {showFleetInCockpit ? __t('delivery_reps.van_sales_mobile_page.s96', __t('delivery_reps.van_sales_mobile_page.s96', "إغلاق السجل")) : __t('delivery_reps.van_sales_mobile_page.s97', __t('delivery_reps.van_sales_mobile_page.s97', "سجل الوقود والصيانة"))}
                    </button>
                  </div>

                  {/* Embedded Fleet & Fuel Logs Tab inside Vehicle Card */}
                  {showFleetInCockpit && (
                    <div style={{ marginTop: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
                      <VanFleetTab
                        vehicle={vehicle}
                        tripId={data?.trip?.id}
                        maintenanceAlerts={maintenanceAlerts}
                        fuelLogs={fuelLogs}
                        onRefreshFuel={() => {
                          refetchFuelLogs();
                          refetch();
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Morning Operations & Trip Launch Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PackageIcon size={15} color="#170e5e" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{__t('delivery_reps.van_sales_mobile_page.s98', __t('delivery_reps.van_sales_mobile_page.s98', "بدء رحلة التوزيع والعمليات الميدانية"))}</h3>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s99', __t('delivery_reps.van_sales_mobile_page.s99', "إعداد بضاعة السيارة والانطلاق للميدان"))}</span>
                    </div>
                  </div>

                  {/* Existing Stock Banner */}
                  {data?.inventory && data.inventory.length > 0 ? (
                    <div
                      style={{
                        backgroundColor: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        marginBottom: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#1e40af', display: 'block' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s100', __t('delivery_reps.van_sales_mobile_page.s100', "يوجد بضاعة متوفرة بالسيارة حالياً ("))}{data.inventory.length} {__t('delivery_reps.van_sales_mobile_page.s101', __t('delivery_reps.van_sales_mobile_page.s101', "أصناف)"))}
                        </span>
                        <span style={{ fontSize: '10px', color: '#3b82f6' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s102', __t('delivery_reps.van_sales_mobile_page.s102', "إجمالي القيمة:"))} {totalInventoryValue.toFixed(2)} {getGlobalCurrencySymbol()} {__t('delivery_reps.van_sales_mobile_page.s103', __t('delivery_reps.van_sales_mobile_page.s103', "جاهزة للبيع الفوري"))}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => startTripMutation.mutate()}
                        disabled={startTripMutation.isPending}
                        style={{
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11.5px',
                          fontWeight: 800,
                          width: '100%',
                          height: '34px',
                          borderRadius: '7px',
                          justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(23, 14, 94, 0.15)',
                        }}
                      >
                        {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s104', __t('delivery_reps.van_sales_mobile_page.s104', "جاري بدء الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s105', __t('delivery_reps.van_sales_mobile_page.s105', "بدء رحلة التوزيع بالبضاعة الحالية"))}
                      </Button>
                    </div>
                  ) : (
                    <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 8px', lineHeight: 1.45 }}>
                      {__t('delivery_reps.van_sales_mobile_page.s106', __t('delivery_reps.van_sales_mobile_page.s106', "سيارتك جاهزة لبدء العمل! يمكنك إرسال طلب شحن بضاعة لمشرف المستودع للمراجعة وصرف البضاعة، أو بدء الرحلة مباشرة للتحصيل وزيارة المتاجر."))}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                    <Button
                      variant="primary"
                      onClick={() => setViewMode('new-requisition')}
                      style={{
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        width: '100%',
                        height: '35px',
                        borderRadius: '7px',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(23, 14, 94, 0.15)',
                      }}
                    >
                      {__t('delivery_reps.van_sales_mobile_page.s107', __t('delivery_reps.van_sales_mobile_page.s107', "+ إنشاء طلب شحن بضاعة (إذن تحميل)"))}
                    </Button>
                    <div
                      className="keep-grid-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: (!data?.inventory || data.inventory.length === 0) ? '1fr 1fr' : '1fr',
                        gap: '6px',
                        width: '100%',
                      }}
                    >
                      {(!data?.inventory || data.inventory.length === 0) && (
                        <Button
                          variant="secondary"
                          onClick={() => startTripMutation.mutate()}
                          disabled={startTripMutation.isPending}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            width: '100%',
                            height: '33px',
                            borderRadius: '7px',
                            justifyContent: 'center',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            color: '#0f172a',
                          }}
                        >
                          {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s108', __t('delivery_reps.van_sales_mobile_page.s108', "جاري فتح الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s109', __t('delivery_reps.van_sales_mobile_page.s109', "بدء الرحلة مباشرة"))}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => refetch()}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          width: '100%',
                          height: '33px',
                          borderRadius: '7px',
                          justifyContent: 'center',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          color: '#0f172a',
                        }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s110', __t('delivery_reps.van_sales_mobile_page.s110', "تحديث حالة الرحلة"))}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 3. Today's Scheduled Route Strip */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MapPinIcon size={15} color="#15803d" />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s111', __t('delivery_reps.van_sales_mobile_page.s111', "خط سير اليوم:"))} {itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s112', __t('delivery_reps.van_sales_mobile_page.s112', "متاجر مجدولة"))}
                      </h4>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s113', __t('delivery_reps.van_sales_mobile_page.s113', "استعرض قائمة المحلات ومواقعها وأرقام الهواتف للاستعداد الميداني"))}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      width: '100%',
                      height: '33px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#170e5e',
                      borderRadius: '7px',
                      padding: '0 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'none',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s114', __t('delivery_reps.van_sales_mobile_page.s114', "استعراض خط السير ("))}{itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s115', __t('delivery_reps.van_sales_mobile_page.s115', "متجر مجدول)"))}
                  </button>
                </div>

                {/* 4. Recent Requisitions List */}
                {myRequisitions.length > 0 && (
                  <div
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      border: '1px solid #e2e8f0',
                      padding: '16px 18px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s116', __t('delivery_reps.van_sales_mobile_page.s116', "أحدث طلبات شحن وتحميل السيارة:"))}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('inventory');
                          setInventorySubMode('requisitions');
                        }}
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#4338ca', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s117', __t('delivery_reps.van_sales_mobile_page.s117', "عرض الكل ("))}{myRequisitions.length})
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {myRequisitions.slice(0, 3).map((req) => (
                        <div
                          key={req.id}
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: '8px',
                            padding: '10px 12px',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', display: 'block' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s118', __t('delivery_reps.van_sales_mobile_page.s118', "طلب شحن #"))}{req.docNo}
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s119', __t('delivery_reps.van_sales_mobile_page.s119', "المستودع:"))} {req.sourceWarehouseName} • {req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s120', __t('delivery_reps.van_sales_mobile_page.s120', "أصناف"))}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 800,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                              backgroundColor:
                                req.status === 'dispatched'
                                  ? '#dcfce7'
                                  : req.status === 'rejected'
                                  ? '#fee2e2'
                                  : '#fef3c7',
                              color:
                                req.status === 'dispatched'
                                  ? '#15803d'
                                  : req.status === 'rejected'
                                  ? '#b91c1c'
                                  : '#b45309',
                            }}
                          >
                            {req.status === 'dispatched'
                              ? __t('delivery_reps.van_sales_mobile_page.s121', __t('delivery_reps.van_sales_mobile_page.s121', "تم الصرف"))
                              : req.status === 'rejected'
                              ? __t('delivery_reps.van_sales_mobile_page.s122', __t('delivery_reps.van_sales_mobile_page.s122', "مرفوض"))
                              : __t('delivery_reps.van_sales_mobile_page.s123', __t('delivery_reps.van_sales_mobile_page.s123', "قيد المراجعة"))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
    </>
  );
};

export interface FleetTabProps {
  vehicle: CockpitVehicle | undefined;
  data: VanActiveTripResponse | undefined;
  maintenanceAlerts: FleetMaintenanceAlert[];
  fuelLogs: FleetFuelLogRecord[];
  refetch: () => Promise<QueryObserverResult<VanActiveTripResponse, Error>>;
  refetchFuelLogs: () => Promise<QueryObserverResult<FleetFuelLogRecord[], Error>>;
  setActiveTab: Dispatch<SetStateAction<'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions'>>;
}

export const FleetTab: React.FC<FleetTabProps> = ({
  vehicle,
  data,
  maintenanceAlerts,
  fuelLogs,
  refetch,
  refetchFuelLogs,
  setActiveTab,
}) => {
  const { t: __t } = useTranslation();
  return (
    <>
            {/* TAB CONTENT: FLEET & FUEL (Works before & during active trip) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('cockpit')}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  {__t('delivery_reps.van_sales_mobile_page.s148', __t('delivery_reps.van_sales_mobile_page.s148', "← عودة لمركز القيادة (الرئيسية)"))}
                </button>
                <VanFleetTab
                  vehicle={vehicle}
                  tripId={data?.trip?.id}
                  maintenanceAlerts={maintenanceAlerts}
                  fuelLogs={fuelLogs}
                  onRefreshFuel={() => {
                    refetchFuelLogs();
                    refetch();
                  }}
                />
              </div>
    </>
  );
};
