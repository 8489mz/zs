// Van-itinerary add-customer dialog (C-add-dialog) — pure move from VanItineraryTab.tsx (slice C-add-dialog).
// Add-customer StandardDialog (own useTranslation). The facade renders it among the root
// modal renders and passes the add-customer form state + GPS handler + create handler as props.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  MapPinIcon,
  PlusIcon,
} from '@/shared/components/icons/AppIcons';
import { ALL_WEEK_DAYS, normalizeDayKey } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';

interface VanItineraryAddDialogProps {
  addCustomerModalOpen: boolean;
  setAddCustomerModalOpen: Dispatch<SetStateAction<boolean>>;
  newCustName: string;
  setNewCustName: Dispatch<SetStateAction<string>>;
  newCustPhone: string;
  setNewCustPhone: Dispatch<SetStateAction<string>>;
  newCustDistrict: string;
  setNewCustDistrict: Dispatch<SetStateAction<string>>;
  newCustRoute: string;
  setNewCustRoute: Dispatch<SetStateAction<string>>;
  newCustAddress: string;
  setNewCustAddress: Dispatch<SetStateAction<string>>;
  newCustGps: { lat: number; lng: number } | null;
  isLocatingGps: boolean;
  isCreatingCustomer: boolean;
  districtDropdownOpen: boolean;
  setDistrictDropdownOpen: Dispatch<SetStateAction<boolean>>;
  routeDropdownOpen: boolean;
  setRouteDropdownOpen: Dispatch<SetStateAction<boolean>>;
  newCustVisitDays: string[];
  setNewCustVisitDays: Dispatch<SetStateAction<string[]>>;
  districtContainerRef: RefObject<HTMLDivElement | null>;
  routeContainerRef: RefObject<HTMLDivElement | null>;
  handleCaptureGps: () => void;
  handleCreateCustomer: () => Promise<void>;
  filteredDistricts: string[];
  filteredRoutes: string[];
  savedDistrictsList: string[];
  todayArabicName: string;
  routes: string[];
}

export function VanItineraryAddDialog(props: VanItineraryAddDialogProps) {
  const { t } = useTranslation();
  const {
    addCustomerModalOpen,
    setAddCustomerModalOpen,
    newCustName,
    setNewCustName,
    newCustPhone,
    setNewCustPhone,
    newCustDistrict,
    setNewCustDistrict,
    newCustRoute,
    setNewCustRoute,
    newCustAddress,
    setNewCustAddress,
    newCustGps,
    isLocatingGps,
    isCreatingCustomer,
    districtDropdownOpen,
    setDistrictDropdownOpen,
    routeDropdownOpen,
    setRouteDropdownOpen,
    newCustVisitDays,
    setNewCustVisitDays,
    districtContainerRef,
    routeContainerRef,
    handleCaptureGps,
    handleCreateCustomer,
    filteredDistricts,
    filteredRoutes,
    savedDistrictsList,
    todayArabicName,
    routes,
  } = props;
  return (
    <>
      {/* Add New Customer / Store to Route Modal */}
      {addCustomerModalOpen && (
        <StandardDialog
          open={addCustomerModalOpen}
          onClose={() => setAddCustomerModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s89', "إضافة محل جديد لخط السير")}
          subtitle={t('delivery_reps.van_itinerary_tab.s90', "تسجيل بيانات المحل وإدراجه بخط سير اليوم")}
          minHeight="490px"
          footerActions={
            <StandardDialogFooter
              onClose={() => setAddCustomerModalOpen(false)}
              cancelText={t('delivery_reps.van_itinerary_tab.s91', "إلغاء")}
              extraActions={
                <Button
                  variant="primary"
                  onClick={handleCreateCustomer}
                  disabled={isCreatingCustomer || !newCustName.trim()}
                  style={{ backgroundColor: '#170e5e', color: '#ffffff', fontWeight: 800 }}
                >
                  {isCreatingCustomer ? t('delivery_reps.van_itinerary_tab.s92', "جاري الحفظ...") : t('delivery_reps.van_itinerary_tab.s93', "حفظ وإدراج في خط السير")}
                </Button>
              }
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 1. Store Name */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                {t('delivery_reps.van_itinerary_tab.s94', "اسم المحل / العميل *")}
              </label>
              <input
                type="text"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s95', "مثال: سوبرماركت البركة")}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
              />
            </div>

            {/* 2. Phone + District (2 Columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_itinerary_tab.s96', "رقم الهاتف / الموبايل")}
                </label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  dir="ltr"
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box', textAlign: 'right' }}
                />
              </div>

              {/* District Custom Combobox */}
              <div ref={districtContainerRef} style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_itinerary_tab.s97', "الحي / المربع السكني")}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={newCustDistrict}
                    onChange={(e) => {
                      setNewCustDistrict(e.target.value);
                      if (!districtDropdownOpen) setDistrictDropdownOpen(true);
                    }}
                    onFocus={() => setDistrictDropdownOpen(true)}
                    placeholder={t('delivery_reps.van_itinerary_tab.s98', "اختر أو اكتب الحي...")}
                    style={{
                      width: '100%',
                      height: '36px',
                      padding: '0 26px 0 10px',
                      borderRadius: '6px',
                      border: districtDropdownOpen ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      fontSize: '12.5px',
                      boxSizing: 'border-box',
                      backgroundColor: '#ffffff',
                    }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setDistrictDropdownOpen((prev) => !prev)}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ChevronDownIcon
                      size={14}
                      style={{
                        transition: 'transform 0.15s ease',
                        transform: districtDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                </div>

                {/* Dropdown Card */}
                {districtDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      left: 0,
                      maxHeight: '190px',
                      overflowY: 'auto',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                      zIndex: 100,
                    }}
                  >
                    <div style={{ padding: '6px 10px', fontSize: '10.5px', fontWeight: 700, color: '#64748b', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      {t('delivery_reps.van_itinerary_tab.s99', "الأحياء المحفوظة (")}{savedDistrictsList.length}):
                    </div>
                    {filteredDistricts.length === 0 && !newCustDistrict.trim() && (
                      <div style={{ padding: '10px 12px', fontSize: '11.5px', color: '#94a3b8', textAlign: 'center' }}>
                        {t('delivery_reps.van_itinerary_tab.s100', "لا توجد أحياء مسجلة سابقاً")}
                      </div>
                    )}
                    {filteredDistricts.map((d) => (
                      <div
                        key={d}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setNewCustDistrict(d);
                          setDistrictDropdownOpen(false);
                        }}
                        style={{
                          padding: '7px 10px',
                          fontSize: '12px',
                          fontWeight: newCustDistrict.trim() === d ? 700 : 500,
                          color: newCustDistrict.trim() === d ? '#170e5e' : '#0f172a',
                          backgroundColor: newCustDistrict.trim() === d ? '#eef2ff' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f8fafc',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <MapPinIcon size={13} color={newCustDistrict.trim() === d ? '#170e5e' : '#94a3b8'} />
                          <span>{d}</span>
                        </div>
                        {newCustDistrict.trim() === d && <CheckCircleIcon size={13} color="#170e5e" />}
                      </div>
                    ))}
                    {newCustDistrict.trim() && !savedDistrictsList.some((d) => d.toLowerCase() === newCustDistrict.trim().toLowerCase()) && (
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setDistrictDropdownOpen(false);
                        }}
                        style={{
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color: '#2563eb',
                          backgroundColor: '#eff6ff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <PlusIcon size={12} color="#2563eb" />
                        <span>{t('delivery_reps.van_itinerary_tab.s101', "إضافة حي جديد: \"")}{newCustDistrict.trim()}&quot;</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Detailed Address / Landmark with GPS button */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s102', "العنوان التفصيلي / علامة مميزة")}
                </label>
                <button
                  type="button"
                  onClick={handleCaptureGps}
                  disabled={isLocatingGps}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '5px',
                    border: newCustGps ? '1px solid #86efac' : '1px solid #cbd5e1',
                    backgroundColor: newCustGps ? '#f0fdf4' : '#f8fafc',
                    color: newCustGps ? '#15803d' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <MapPinIcon size={12} color={newCustGps ? '#15803d' : '#64748b'} />
                  <span>
                    {isLocatingGps
                      ? t('delivery_reps.van_itinerary_tab.s103', "جاري التحديد...")
                      : newCustGps
                        ? t('delivery_reps.van_itinerary_tab.s104', "تم تثبيت GPS")
                        : t('delivery_reps.van_itinerary_tab.s105', "التقاط موقع المحل (GPS)")}
                  </span>
                </button>
              </div>
              <input
                type="text"
                value={newCustAddress}
                onChange={(e) => setNewCustAddress(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s106', "مثال: شارع الجمهورية - بجوار مسجد النور")}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
              />
            </div>

            {/* 4. Scheduled Visit Days */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s107', "أيام الزيارة الأسبوعية المجدولة")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setNewCustVisitDays([...ALL_WEEK_DAYS])}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '11px',
                      fontWeight: 700,
                      color: newCustVisitDays.length === 7 ? '#170e5e' : '#2563eb',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {t('delivery_reps.van_itinerary_tab.s108', "كل الأيام")}
                  </button>
                  <span style={{ fontSize: '10px', color: '#cbd5e1' }}>•</span>
                  <button
                    type="button"
                    onClick={() => setNewCustVisitDays([todayArabicName])}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('delivery_reps.van_itinerary_tab.s109', "اليوم فقط")}
                  </button>
                </div>
              </div>

              {/* 7 Day Touch Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {ALL_WEEK_DAYS.map((day) => {
                  const isSelected = newCustVisitDays.some(
                    (d) => normalizeDayKey(d) === normalizeDayKey(day)
                  );
                  const isToday = normalizeDayKey(day) === normalizeDayKey(todayArabicName);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          if (newCustVisitDays.length > 1) {
                            setNewCustVisitDays((prev) =>
                              prev.filter((d) => normalizeDayKey(d) !== normalizeDayKey(day))
                            );
                          } else {
                            toast.warning(t('delivery_reps.van_itinerary_tab.s110', "يجب تحديد يوم واحد على الأقل لزيارة العميل"));
                          }
                        } else {
                          setNewCustVisitDays((prev) => [...prev, day]);
                        }
                      }}
                      style={{
                        flex: '1 0 calc(25% - 5px)',
                        minWidth: '46px',
                        height: '28px',
                        padding: '0 4px',
                        borderRadius: '6px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#170e5e' : '#f8fafc',
                        color: isSelected ? '#ffffff' : '#475569',
                        fontSize: '11px',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        transition: 'none',
                      }}
                    >
                      {isToday && (
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            backgroundColor: isSelected ? '#38bdf8' : '#170e5e',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      <span>{day}</span>
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: '10px', color: '#64748b', marginTop: '3px', display: 'block' }}>
                {t('delivery_reps.van_itinerary_tab.s111', "يظهر المحل في خط سير المندوب تلقائياً في الأيام المختارة فقط.")}
              </span>
            </div>

            {/* 5. Main Route Combobox */}
            <div ref={routeContainerRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s112', "خط السير الرئيسي (Route)")}
                </label>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {t('delivery_reps.van_itinerary_tab.s113', "مسار الرحلة الجغرافي")}
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={newCustRoute}
                  onChange={(e) => {
                    setNewCustRoute(e.target.value);
                    if (!routeDropdownOpen) setRouteDropdownOpen(true);
                  }}
                  onFocus={() => setRouteDropdownOpen(true)}
                  placeholder={routes[0] || t('delivery_reps.van_itinerary_tab.s114', "مثال: خط فيصل الرئيسي")}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 26px 0 10px',
                    borderRadius: '6px',
                    border: routeDropdownOpen ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                    backgroundColor: '#ffffff',
                  }}
                />
                {routes.length > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setRouteDropdownOpen((prev) => !prev)}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ChevronDownIcon
                      size={14}
                      style={{
                        transition: 'transform 0.15s ease',
                        transform: routeDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                )}
              </div>

              {/* Route Dropdown Card */}
              {routeDropdownOpen && routes.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    left: 0,
                    maxHeight: '160px',
                    overflowY: 'auto',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                    zIndex: 100,
                  }}
                >
                  <div style={{ padding: '6px 10px', fontSize: '10.5px', fontWeight: 700, color: '#64748b', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    {t('delivery_reps.van_itinerary_tab.s115', "خطوط سير الرحلة الحالية:")}
                  </div>
                  {filteredRoutes.map((r) => (
                    <div
                      key={r}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setNewCustRoute(r);
                        setRouteDropdownOpen(false);
                      }}
                      style={{
                        padding: '7px 10px',
                        fontSize: '12px',
                        fontWeight: newCustRoute.trim() === r ? 700 : 500,
                        color: newCustRoute.trim() === r ? '#170e5e' : '#0f172a',
                        backgroundColor: newCustRoute.trim() === r ? '#eef2ff' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #f8fafc',
                      }}
                    >
                      <span>{r}</span>
                      {newCustRoute.trim() === r && <CheckCircleIcon size={13} color="#170e5e" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hint Notice */}
            <div style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircleIcon size={13} color="#15803d" />
              <span>{t('delivery_reps.van_itinerary_tab.s116', "المحل يُسجل بنظام (سداد نقدي) ويُدرج في خط سير اليوم لتبدأ زيارته فوراً، ويتكرر أسبوعياً في الأيام المحددة.")}</span>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
