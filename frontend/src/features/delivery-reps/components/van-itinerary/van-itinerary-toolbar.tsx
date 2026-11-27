// Van-itinerary toolbar (C-toolbar) — pure move from VanItineraryTab.tsx (slice C-toolbar).
// List booster + toolbar + reordering banner + filter badge (own useTranslation). The facade
// renders it inside the list fragment and passes filter/order/optimize/list values as props.

import React, {type Dispatch, type RefObject, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { VanLiveTargetBoosterWidget } from '@/features/delivery-reps/components/VanLiveTargetBoosterWidget';
import { CustomSelect } from '@/shared/ui/custom-select';
import { normalizeDayKey } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';
import {
  MapPinIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  SearchIcon,
  CalendarIcon,
  ChevronDownIcon,
  PlusIcon,
  SlidersIcon,
  RotateCcwIcon,
} from '@/shared/components/icons/AppIcons';
import type { RepTargetMetrics, VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

interface VanItineraryToolbarProps {
  targetMetrics?: RepTargetMetrics;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  routeFilter: string;
  setRouteFilter: Dispatch<SetStateAction<string>>;
  statusFilter: 'all' | 'pending' | 'positive' | 'negative';
  setStatusFilter: Dispatch<SetStateAction<'all' | 'pending' | 'positive' | 'negative'>>;
  dayFilter: 'today' | 'all' | string;
  setDayFilter: Dispatch<SetStateAction<'today' | 'all' | string>>;
  isReorderingMode: boolean;
  setIsReorderingMode: Dispatch<SetStateAction<boolean>>;
  setAddCustomerModalOpen: Dispatch<SetStateAction<boolean>>;
  arabicDayNames: string[];
  todayArabicName: string;
  todayCount: number;
  dayDropdownOpen: boolean;
  setDayDropdownOpen: Dispatch<SetStateAction<boolean>>;
  dayDropdownRef: RefObject<HTMLDivElement | null>;
  routes: string[];
  isOptimizingRoute: boolean;
  handleRunRouteOptimization: () => Promise<void>;
  total: number;
  positiveCount: number;
  negativeCount: number;
  pendingCount: number;
  resetOrderToDefault: () => void;
  filtered: VanCustomerItineraryItem[];
}

export const VanItineraryToolbar: React.FC<VanItineraryToolbarProps> = ({
  targetMetrics,
  searchTerm,
  setSearchTerm,
  routeFilter,
  setRouteFilter,
  statusFilter,
  setStatusFilter,
  dayFilter,
  setDayFilter,
  isReorderingMode,
  setIsReorderingMode,
  setAddCustomerModalOpen,
  arabicDayNames,
  todayArabicName,
  todayCount,
  dayDropdownOpen,
  setDayDropdownOpen,
  dayDropdownRef,
  routes,
  isOptimizingRoute,
  handleRunRouteOptimization,
  total,
  positiveCount,
  negativeCount,
  pendingCount,
  resetOrderToDefault,
  filtered,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* Live Commission & Target Booster Widget */}
          {targetMetrics && <VanLiveTargetBoosterWidget metrics={targetMetrics} compact={false} />}

          {/* Unified High-Density Itinerary Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '8px 10px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* Row 1: Visit Status Quick Filters (Height 28px) */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '4px', textAlign: 'center', width: '100%' }}>
          <div
            onClick={() => setStatusFilter((prev) => (prev === 'positive' ? 'all' : 'positive'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: statusFilter === 'positive' ? '#15803d' : '#f0fdf4',
              borderRadius: '6px',
              padding: '2px 4px',
              border: statusFilter === 'positive' ? '1.5px solid #15803d' : '1px solid #bbf7d0',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s38', "المحلات التي تم البيع لها")}
          >
            <CheckCircleIcon size={12} color={statusFilter === 'positive' ? '#ffffff' : '#166534'} />
            <span style={{ fontSize: '10px', color: statusFilter === 'positive' ? '#ffffff' : '#166534', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s39', "تم البيع:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: statusFilter === 'positive' ? '#ffffff' : '#15803d' }}>{positiveCount}</strong>
          </div>

          <div
            onClick={() => setStatusFilter((prev) => (prev === 'negative' ? 'all' : 'negative'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: statusFilter === 'negative' ? '#b91c1c' : '#fef2f2',
              borderRadius: '6px',
              padding: '2px 4px',
              border: statusFilter === 'negative' ? '1.5px solid #b91c1c' : '1px solid #fecaca',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s40', "الزيارات السلبية")}
          >
            <XCircleIcon size={12} color={statusFilter === 'negative' ? '#ffffff' : '#991b1b'} />
            <span style={{ fontSize: '10px', color: statusFilter === 'negative' ? '#ffffff' : '#991b1b', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s41', "سلبية:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: statusFilter === 'negative' ? '#ffffff' : '#b91c1c' }}>{negativeCount}</strong>
          </div>

          <div
            onClick={() => setStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: statusFilter === 'pending' ? '#170e5e' : '#f8fafc',
              borderRadius: '6px',
              padding: '2px 4px',
              border: statusFilter === 'pending' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s42', "المحلات المتبقية للزيارة")}
          >
            <ClockIcon size={12} color={statusFilter === 'pending' ? '#ffffff' : '#475569'} />
            <span style={{ fontSize: '10px', color: statusFilter === 'pending' ? '#ffffff' : '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s43', "متبقي:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: statusFilter === 'pending' ? '#ffffff' : '#0f172a' }}>{pendingCount}</strong>
          </div>
        </div>

        {/* Row 2: Day Filter Segment Switcher (اليوم vs الكل vs يوم آخر) */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '4px', width: '100%', alignItems: 'stretch' }}>
          <button
            type="button"
            onClick={() => setDayFilter('today')}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              padding: '0 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxSizing: 'border-box',
              border:
                dayFilter === 'today' || normalizeDayKey(dayFilter) === normalizeDayKey(todayArabicName)
                  ? '1.5px solid #170e5e'
                  : '1px solid #e2e8f0',
              backgroundColor:
                dayFilter === 'today' || normalizeDayKey(dayFilter) === normalizeDayKey(todayArabicName)
                  ? '#170e5e'
                  : '#f8fafc',
              color:
                dayFilter === 'today' || normalizeDayKey(dayFilter) === normalizeDayKey(todayArabicName)
                  ? '#ffffff'
                  : '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '30px',
            }}
          >
            <CalendarIcon size={12} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap' }}>{todayArabicName}</span>
            <span
              style={{
                backgroundColor:
                  dayFilter === 'today' || normalizeDayKey(dayFilter) === normalizeDayKey(todayArabicName)
                    ? 'rgba(255,255,255,0.25)'
                    : '#e2e8f0',
                color:
                  dayFilter === 'today' || normalizeDayKey(dayFilter) === normalizeDayKey(todayArabicName)
                    ? '#ffffff'
                    : '#475569',
                padding: '0 4px',
                borderRadius: '6px',
                fontSize: '9.5px',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {todayCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setDayFilter('all')}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              padding: '0 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxSizing: 'border-box',
              border: dayFilter === 'all' ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              backgroundColor: dayFilter === 'all' ? '#170e5e' : '#f8fafc',
              color: dayFilter === 'all' ? '#ffffff' : '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '30px',
            }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s44', "كافة المحلات")}</span>
            <span
              style={{
                backgroundColor: dayFilter === 'all' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: dayFilter === 'all' ? '#ffffff' : '#475569',
                padding: '0 4px',
                borderRadius: '6px',
                fontSize: '9.5px',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {total}
            </span>
          </button>

          {/* Day Picker Button & Dropdown */}
          <div ref={dayDropdownRef} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, height: '30px' }}>
            <button
              type="button"
              onClick={() => setDayDropdownOpen((prev) => !prev)}
              style={{
                width: '100%',
                padding: '0 6px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                boxSizing: 'border-box',
                border:
                  dayFilter !== 'today' && dayFilter !== 'all' && normalizeDayKey(dayFilter) !== normalizeDayKey(todayArabicName)
                    ? '1.5px solid #170e5e'
                    : '1px solid #e2e8f0',
                backgroundColor:
                  dayFilter !== 'today' && dayFilter !== 'all' && normalizeDayKey(dayFilter) !== normalizeDayKey(todayArabicName)
                    ? '#170e5e'
                    : '#f8fafc',
                color:
                  dayFilter !== 'today' && dayFilter !== 'all' && normalizeDayKey(dayFilter) !== normalizeDayKey(todayArabicName)
                    ? '#ffffff'
                    : '#334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                height: '30px',
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {dayFilter !== 'today' && dayFilter !== 'all' && normalizeDayKey(dayFilter) !== normalizeDayKey(todayArabicName)
                  ? dayFilter
                  : t('delivery_reps.van_itinerary_tab.s45', "يوم...")}
              </span>
              <ChevronDownIcon size={11} style={{ flexShrink: 0 }} />
            </button>

            {dayDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  width: '125px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  zIndex: 100,
                  overflow: 'hidden',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <div
                  onClick={() => {
                    setDayFilter('all');
                    setDayDropdownOpen(false);
                  }}
                  style={{
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: dayFilter === 'all' ? 800 : 600,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: dayFilter === 'all' ? '#170e5e' : '#334155',
                    backgroundColor: dayFilter === 'all' ? '#eef2ff' : 'transparent',
                  }}
                >
                  {t('delivery_reps.van_itinerary_tab.s46', "كافة الأيام")}
                </div>
                {arabicDayNames.map((d) => {
                  const isCurrent = d === todayArabicName;
                  const isSelected = dayFilter === d || (isCurrent && dayFilter === 'today');
                  return (
                    <div
                      key={d}
                      onClick={() => {
                        if (isCurrent) {
                          setDayFilter('today');
                        } else {
                          setDayFilter(d);
                        }
                        setDayDropdownOpen(false);
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: isSelected ? 800 : 600,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: isSelected ? '#170e5e' : '#334155',
                        backgroundColor: isSelected ? '#eef2ff' : 'transparent',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('delivery_reps.van_itinerary_tab.s47', "يوم")} {d}</span>
                      {isCurrent && (
                        <span style={{ fontSize: '9px', color: '#16a34a', fontWeight: 800 }}>{t('delivery_reps.van_itinerary_tab.s48', "اليوم")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Full-width Clean Search Bar */}
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('delivery_reps.van_itinerary_tab.s49', "بحث باسم المحل، الكود، الحي، أو الهاتف...")}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 12px 6px 32px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              height: '35px',
              backgroundColor: '#f8fafc',
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }}>
            <SearchIcon size={14} />
          </span>
        </div>

        {/* Row 4: Route Actions & Route Filter (Responsive 2-Row Layout to Prevent Mobile Clipping) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          {/* Sub-row 1: Add Store Button + Route Selector */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
            <button
              type="button"
              onClick={() => setAddCustomerModalOpen(true)}
              style={{
                flex: routes.length > 1 ? 1 : 'none',
                width: routes.length > 1 ? 'auto' : '100%',
                height: '32px',
                padding: '0 10px',
                borderRadius: '8px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
              }}
              title={t('delivery_reps.van_itinerary_tab.s50', "إضافة محل جديد لخط السير")}
            >
              <PlusIcon size={12} color="#ffffff" />
              <span>{t('delivery_reps.van_itinerary_tab.s51', "+ إضافة محل جديد")}</span>
            </button>

            {routes.length > 1 && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <CustomSelect
                  value={routeFilter}
                  onChange={(val) => setRouteFilter(val || 'all')}
                  dropdownAlign="left"
                  options={[
                    { value: 'all', label: t('delivery_reps.van_itinerary_tab.s52', "كافة الخطوط") },
                    ...routes.map((r) => ({ value: r, label: r })),
                  ]}
                  placeholder={t('delivery_reps.van_itinerary_tab.s53', "تصفية بالخط")}
                  style={{ height: '32px', fontSize: '11.5px' }}
                />
              </div>
            )}
          </div>

          {/* Sub-row 2: Reorder Itinerary + Smart Route Optimization (TSP) - Strictly 1 Horizontal Row Side-by-Side */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Toggle Reordering Mode Button */}
            <button
              type="button"
              onClick={() => setIsReorderingMode((prev) => !prev)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                width: '50%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '8px',
                backgroundColor: isReorderingMode ? '#1e293b' : '#ffffff',
                color: isReorderingMode ? '#ffffff' : '#334155',
                border: isReorderingMode ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
              }}
              title={t('delivery_reps.van_itinerary_tab.s54', "إعادة ترتيب خط السير يدوياً")}
            >
              <SlidersIcon size={12} color={isReorderingMode ? '#ffffff' : '#475569'} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isReorderingMode ? t('delivery_reps.van_itinerary_tab.s55', "إنهاء الترتيب") : t('delivery_reps.van_itinerary_tab.s56', "ترتيب السير")}
              </span>
            </button>

            {/* Dynamic Route Optimization Button */}
            <button
              type="button"
              onClick={handleRunRouteOptimization}
              disabled={isOptimizingRoute}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                width: '50%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '8px',
                backgroundColor: '#eef2ff',
                color: '#170e5e',
                border: '1px solid #c7d2fe',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
              }}
              title={t('delivery_reps.van_itinerary_tab.s57', "تحسين مسار السير بأقصر مسار جغرافي لتوفير استهلاك الوقود وزمن الرحلة")}
            >
              <MapPinIcon size={12} color="#170e5e" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isOptimizingRoute ? t('delivery_reps.van_itinerary_tab.s58', "جاري التحسين...") : t('delivery_reps.van_itinerary_tab.s59', "أقصر مسار (GPS)")}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Reordering Mode Banner */}
      {isReorderingMode && (
        <div
          style={{
            backgroundColor: '#f0f7ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '5px',
                backgroundColor: '#dbeafe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <SlidersIcon size={12} color="#1d4ed8" />
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#1e40af',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('delivery_reps.van_itinerary_tab.s60', "وضع إعادة الترتيب نشط: استخدم الأسهم (▲/▼) لترتيب خط السير")}
            </span>
          </div>
          <button
            type="button"
            onClick={resetOrderToDefault}
            style={{
              background: '#ffffff',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              color: '#dc2626',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
            title={t('delivery_reps.van_itinerary_tab.s61', "استعادة ترتيب خط السير الافتراضي")}
          >
            <RotateCcwIcon size={11} color="#dc2626" />
            {t('delivery_reps.van_itinerary_tab.s62', "استعادة الترتيب")}
          </button>
        </div>
      )}

      {/* Active filter badge / reset */}
      {(statusFilter !== 'all' || (dayFilter !== 'today' && dayFilter !== 'all')) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f1f5f9',
            padding: '5px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#334155',
            border: '1px solid #e2e8f0',
          }}
        >
          <span>
            {t('delivery_reps.van_itinerary_tab.s63', "تصفية نشطة:")}{' '}
            {dayFilter !== 'today' && dayFilter !== 'all' && (
              <strong style={{ color: '#170e5e', marginInlineEnd: '4px' }}>{t('delivery_reps.van_itinerary_tab.s64', "يوم")} {dayFilter}</strong>
            )}
            {statusFilter !== 'all' && (
              <strong>
                {statusFilter === 'pending'
                  ? t('delivery_reps.van_itinerary_tab.s65', "المحلات المتبقية فقط")
                  : statusFilter === 'positive'
                  ? t('delivery_reps.van_itinerary_tab.s66', "المحلات التي تم البيع لها")
                  : t('delivery_reps.van_itinerary_tab.s67', "الزيارات السلبية")}
              </strong>
            )}{' '}
            ({filtered.length} {t('delivery_reps.van_itinerary_tab.s68', "محل)")}
          </span>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setDayFilter('today');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#0284c7',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '11px',
              padding: 0,
            }}
          >
            {t('delivery_reps.van_itinerary_tab.s69', "إلغاء التصفية")}
          </button>
        </div>
      )}
    </>
  );
};
