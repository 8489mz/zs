import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import {
  vanSalesApi,
  VanCustomerItineraryItem,
  RepTargetMetrics,
  VanStockItem,
} from '../api/van-sales.api';
import {
  MapPinIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  SearchIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  PlusIcon,
  RotateCcwIcon,
} from '@/shared/components/icons/AppIcons';
import { VanCustomerStatementModal } from './VanCustomerStatementModal';
import { VanStoreInventoryModal } from './VanStoreInventoryModal';
import { VanTradeSurveyModal } from './VanTradeSurveyModal';
import { VanDamagedSwapModal } from './VanDamagedSwapModal';
import { VanItineraryToolbar } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-toolbar';
import { VanItineraryCustomerList } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-customer-list';
import { VanItineraryAddDialog } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-add-dialog';
export { normalizeDayKey, DAY_KEY_TO_ARABIC, ALL_WEEK_DAYS } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';
import { VanItineraryPagination } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-pagination';
import { useVanItineraryFilters } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-filters';
import { useVanItineraryOrder } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-order';
import { useVanItineraryVisit } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-visit';
import { useVanItineraryAddCustomer } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-add-customer';
import { useVanItineraryNegativeVisit } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-negative-visit';
import { useVanItineraryList } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-list';
import { useVanItineraryOptimize } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-optimize';
import { VanItineraryHubTop } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-hub-top';
import { VanItineraryHubActions } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-hub-actions';

interface VanItineraryTabProps {
  itinerary: VanCustomerItineraryItem[];
  tripId?: number;
  onSelectCustomerForSale: (customerId: number) => void;
  onSelectCustomerForReturn?: (customerId: number) => void;
  onSelectCustomerForCollection?: (customerId: number) => void;
  onRefreshItinerary: () => void;
  isLoading?: boolean;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  onStartVisit?: (customerId: number, customerName: string, onSuccess?: () => void) => void;
  onEndVisit?: () => void;
  targetMetrics?: RepTargetMetrics;
  inventory?: VanStockItem[];
  allAvailableCustomers?: Array<{ id: number; name: string; phone?: string }>;
}
export const VanItineraryTab: React.FC<VanItineraryTabProps> = ({
  itinerary,
  tripId,
  onSelectCustomerForSale,
  onSelectCustomerForReturn,
  onSelectCustomerForCollection,
  onRefreshItinerary,
  isLoading,
  activeVisit,
  onStartVisit,
  onEndVisit,
  targetMetrics,
  inventory,
  allAvailableCustomers,
}) => {
  const { t } = useTranslation();
  const filters = useVanItineraryFilters({ itinerary });
  const visit = useVanItineraryVisit({ activeVisit });
  const [inventoryCustomer, setInventoryCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const [surveyCustomer, setSurveyCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const [swapCustomer, setSwapCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const order = useVanItineraryOrder();
  const add = useVanItineraryAddCustomer({ todayArabicName: filters.todayArabicName, savedDistrictsList: filters.savedDistrictsList, routes: filters.routes, onRefreshItinerary });
  const negative = useVanItineraryNegativeVisit({ tripId, activeVisit, onEndVisit, onRefreshItinerary });
  const [statementModalCust, setStatementModalCust] = useState<VanCustomerItineraryItem | null>(null);


  const list = useVanItineraryList({
    itinerary,
    filters,
    customDistrictOrder: order.customDistrictOrder,
    customCustomerOrder: order.customCustomerOrder,
    saveDistrictOrder: order.saveDistrictOrder,
    saveCustomerOrder: order.saveCustomerOrder,
  });
  const optimize = useVanItineraryOptimize({ filtered: list.filtered, setCustomCustomerOrder: order.setCustomCustomerOrder, onRefreshItinerary });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: visit.selectedCustomerForHub ? '6px' : '10px', paddingBottom: visit.selectedCustomerForHub ? '85px' : '24px' }}>
      {visit.selectedCustomerForHub ? (
        /* Z-SYSTEMS OFFICIAL MOBILE VISUAL IDENTITY: ZERO-SCROLL CUSTOMER VISIT HUB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <VanItineraryHubTop
            selectedCustomerForHub={visit.selectedCustomerForHub}
            setSelectedCustomerForHub={visit.setSelectedCustomerForHub}
            elapsedVisitSeconds={visit.elapsedVisitSeconds}
            formatElapsed={visit.formatElapsed}
            activeVisit={activeVisit}
            onStartVisit={onStartVisit}
            onEndVisit={onEndVisit}
          />
          <VanItineraryHubActions
            selectedCustomerForHub={visit.selectedCustomerForHub}
            setSelectedCustomerForHub={visit.setSelectedCustomerForHub}
            setInventoryCustomer={setInventoryCustomer}
            setSurveyCustomer={setSurveyCustomer}
            setSwapCustomer={setSwapCustomer}
            setStatementModalCust={setStatementModalCust}
            openNegativeVisitModal={negative.openNegativeVisitModal}
            onSelectCustomerForSale={onSelectCustomerForSale}
            onSelectCustomerForReturn={onSelectCustomerForReturn}
            onSelectCustomerForCollection={onSelectCustomerForCollection}
            activeVisit={activeVisit}
            onStartVisit={onStartVisit}
            getReasonLabel={negative.getReasonLabel}
          />
        </div>
      ) : (
        <>
          <VanItineraryToolbar
            targetMetrics={targetMetrics}
            searchTerm={filters.searchTerm}
            setSearchTerm={filters.setSearchTerm}
            routeFilter={filters.routeFilter}
            setRouteFilter={filters.setRouteFilter}
            statusFilter={filters.statusFilter}
            setStatusFilter={filters.setStatusFilter}
            dayFilter={filters.dayFilter}
            setDayFilter={filters.setDayFilter}
            isReorderingMode={order.isReorderingMode}
            setIsReorderingMode={order.setIsReorderingMode}
            setAddCustomerModalOpen={add.setAddCustomerModalOpen}
            arabicDayNames={filters.arabicDayNames}
            todayArabicName={filters.todayArabicName}
            todayCount={filters.todayCount}
            dayDropdownOpen={filters.dayDropdownOpen}
            setDayDropdownOpen={filters.setDayDropdownOpen}
            dayDropdownRef={filters.dayDropdownRef}
            routes={filters.routes}
            isOptimizingRoute={optimize.isOptimizingRoute}
            handleRunRouteOptimization={optimize.handleRunRouteOptimization}
            total={list.total}
            positiveCount={list.positiveCount}
            negativeCount={list.negativeCount}
            pendingCount={list.pendingCount}
            resetOrderToDefault={order.resetOrderToDefault}
            filtered={list.filtered}
          />
      <VanItineraryCustomerList
        currentPage={filters.currentPage}
        setCurrentPage={filters.setCurrentPage}
        pageSize={filters.pageSize}
        handlePageSizeChange={filters.handlePageSizeChange}
        setSelectedCustomerForHub={visit.setSelectedCustomerForHub}
        isReorderingMode={order.isReorderingMode}
        elapsedVisitSeconds={visit.elapsedVisitSeconds}
        formatElapsed={visit.formatElapsed}
        filtered={list.filtered}
        allSortedCustomers={list.allSortedCustomers}
        totalPages={list.totalPages}
        startIdx={list.startIdx}
        districtGroups={list.districtGroups}
        moveDistrict={list.moveDistrict}
        moveCustomer={list.moveCustomer}
        getReasonLabel={negative.getReasonLabel}
        isLoading={isLoading}
        activeVisit={activeVisit}
      />
      <VanItineraryAddDialog
        addCustomerModalOpen={add.addCustomerModalOpen}
        setAddCustomerModalOpen={add.setAddCustomerModalOpen}
        newCustName={add.newCustName}
        setNewCustName={add.setNewCustName}
        newCustPhone={add.newCustPhone}
        setNewCustPhone={add.setNewCustPhone}
        newCustDistrict={add.newCustDistrict}
        setNewCustDistrict={add.setNewCustDistrict}
        newCustRoute={add.newCustRoute}
        setNewCustRoute={add.setNewCustRoute}
        newCustAddress={add.newCustAddress}
        setNewCustAddress={add.setNewCustAddress}
        newCustGps={add.newCustGps}
        isLocatingGps={add.isLocatingGps}
        isCreatingCustomer={add.isCreatingCustomer}
        districtDropdownOpen={add.districtDropdownOpen}
        setDistrictDropdownOpen={add.setDistrictDropdownOpen}
        routeDropdownOpen={add.routeDropdownOpen}
        setRouteDropdownOpen={add.setRouteDropdownOpen}
        newCustVisitDays={add.newCustVisitDays}
        setNewCustVisitDays={add.setNewCustVisitDays}
        districtContainerRef={add.districtContainerRef}
        routeContainerRef={add.routeContainerRef}
        handleCaptureGps={add.handleCaptureGps}
        handleCreateCustomer={add.handleCreateCustomer}
        filteredDistricts={add.filteredDistricts}
        filteredRoutes={add.filteredRoutes}
        savedDistrictsList={filters.savedDistrictsList}
        todayArabicName={filters.todayArabicName}
        routes={filters.routes}
      />
      {/* Bottom Pagination Bar */}
      <VanItineraryPagination
        startIdx={list.startIdx}
        pageSize={filters.pageSize}
        totalCount={list.allSortedCustomers.length}
        currentPage={filters.currentPage}
        totalPages={list.totalPages}
        onPageChange={filters.setCurrentPage}
        onPageSizeChange={filters.handlePageSizeChange}
      />
      </>
      )}

      {/* Negative Visit Dialog */}
      {negative.negativeModalOpen && negative.activeCustomer && (
        <StandardDialog
          open={true}
          onClose={() => negative.setNegativeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s117', "تسجيل زيارة غير موفقة")}
          subtitle={`${negative.activeCustomer.customerName} [${negative.activeCustomer.customerCode.replace(/^#/, '')}]`}
          badge={t('delivery_reps.van_itinerary_tab.s118', "خط السير الميداني")}
          width="min(460px, 95vw)"
          compact={true}
          footerActions={
            <StandardDialogFooter
              onClose={() => negative.setNegativeModalOpen(false)}
              cancelText={t('delivery_reps.van_itinerary_tab.s119', "إلغاء")}
              extraActions={
                <Button
                  variant="primary"
                  onClick={negative.handleSubmitNegativeVisit}
                  disabled={negative.isSubmitting}
                  style={{ backgroundColor: '#dc2626', color: '#ffffff', fontSize: '12px', fontWeight: 800, padding: '6px 14px' }}
                >
                  {negative.isSubmitting ? t('delivery_reps.van_itinerary_tab.s120', "جاري الحفظ...") : t('delivery_reps.van_itinerary_tab.s121', "تأكيد وحفظ الزيارة السلبية")}
                </Button>
              }
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_itinerary_tab.s122', "حدد سبب عدم إتمام البيع (لمسة واحدة):")}
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px',
                }}
              >
                {[
                  { value: 'shop_closed', label: t('delivery_reps.van_itinerary_tab.s123', "المحل مغلق") },
                  { value: 'no_cash', label: t('delivery_reps.van_itinerary_tab.s124', "مفيش نقدية / رفض الدفع") },
                  { value: 'sufficient_stock', label: t('delivery_reps.van_itinerary_tab.s125', "لديه بضاعة كافية") },
                  { value: 'item_unavailable', label: t('delivery_reps.van_itinerary_tab.s126', "الصنف غير متوفر بالسيارة") },
                  { value: 'postponed', label: t('delivery_reps.van_itinerary_tab.s127', "تأجيل الزيارة لموعد لاحق") },
                  { value: 'other', label: t('delivery_reps.van_itinerary_tab.s128', "أسباب أخرى") },
                ].map((item) => {
                  const isSelected = negative.negativeReason === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => negative.setNegativeReason(item.value as any)}
                      style={{
                        padding: '7px 8px',
                        borderRadius: '7px',
                        border: isSelected ? '1.5px solid #dc2626' : '1px solid #cbd5e1',
                        backgroundColor: isSelected ? '#fef2f2' : '#ffffff',
                        color: isSelected ? '#991b1b' : '#334155',
                        fontSize: '11.5px',
                        fontWeight: isSelected ? 800 : 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        textAlign: 'center',
                        lineHeight: 1.3,
                        minHeight: '36px',
                      }}
                    >
                      {isSelected && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#dc2626', display: 'inline-block' }} />
                      )}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {negative.negativeReason === 'postponed' && (
              <div style={{ backgroundColor: '#eff6ff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#1e40af', marginBottom: '4px' }}>
                  {t('delivery_reps.van_itinerary_tab.s129', "تاريخ التأجيل المقترح:")}
                </label>
                <input
                  type="date"
                  value={negative.postponedDate}
                  onChange={(e) => negative.setPostponedDate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1.5px solid #93c5fd',
                    backgroundColor: '#ffffff',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('delivery_reps.van_itinerary_tab.s130', "ملاحظات المندوب الميدانية (اختياري):")}
              </label>
              <textarea
                value={negative.negativeNotes}
                onChange={(e) => negative.setNegativeNotes(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s131', "أية ملاحظات إضافية حول سبب الزيارة...")}
                rows={2}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '11.5px',
                  boxSizing: 'border-box',
                  resize: 'none',
                }}
              />
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '10.5px',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <MapPinIcon size={13} color="#0284c7" />
              <span>{t('delivery_reps.van_itinerary_tab.s132', "سيتم التقاط إحداثيات الموقع الجغرافي (GPS) تلقائياً لتوثيق وصول المندوب للمحل.")}</span>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Field Customer Statement Modal */}
      {statementModalCust && (
        <VanCustomerStatementModal
          open={Boolean(statementModalCust)}
          onClose={() => setStatementModalCust(null)}
          customerId={statementModalCust.customerId}
          customerName={statementModalCust.customerName}
        />
      )}

      {/* Dynamic Route Optimization (TSP) Modal */}
      {optimize.isOptimizeModalOpen && optimize.routeOptimizationResult && (
        <StandardDialog
          open={optimize.isOptimizeModalOpen}
          onClose={() => optimize.setIsOptimizeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s133', "تحسين المسار الجغرافي بأقصر طريق (TSP Route Optimization)")}
          subtitle={t('delivery_reps.van_itinerary_tab.s134', "محرك الذكاء المكاني لحساب أقصر مسار بين المحلات وتوفير استهلاك الوقود وزمن الرحلة")}
          width="680px"
          minHeight="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* KPI Stats Ribbon */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s135', "المسافة قبل التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#64748b' }}>
                  {optimize.routeOptimizationResult.stats.originalDistanceKm} {t('delivery_reps.van_itinerary_tab.s136', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s137', "المسافة بعد التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>
                  {optimize.routeOptimizationResult.stats.optimizedDistanceKm} {t('delivery_reps.van_itinerary_tab.s138', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s139', "التوفير في استهلاك الوقود")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1d4ed8' }}>
                  {optimize.routeOptimizationResult.stats.savedDistanceKm} {t('delivery_reps.van_itinerary_tab.s140', "كم (")}{optimize.routeOptimizationResult.stats.savingsPercent}%)
                </div>
              </div>
            </div>

            {/* Stops Preview List */}
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
              {t('delivery_reps.van_itinerary_tab.s141', "تسلسل المحطات المقترح (")}{optimize.routeOptimizationResult.orderedStops.length} {t('delivery_reps.van_itinerary_tab.s142', "محطة):")}
            </div>

            <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px' }}>
              {optimize.routeOptimizationResult.orderedStops.map((stop, sIdx) => (
                <div
                  key={stop.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: sIdx < optimize.routeOptimizationResult.orderedStops.length - 1 ? '1px solid #f1f5f9' : 'none',
                    backgroundColor: stop.isUnmappedGps ? '#fffbeb' : '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {stop.sequenceIndex}
                    </span>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{stop.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {stop.district ? `${stop.district} - ` : ''}{stop.address || t('delivery_reps.van_itinerary_tab.s143', "بدون عنوان تفصيلي")}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left', fontSize: '11.5px' }}>
                    {stop.isUnmappedGps ? (
                      <span style={{ color: '#d97706', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s144', "بدون GPS (في النهاية)")}</span>
                    ) : (
                      <span style={{ color: '#475569', fontWeight: 600 }}>
                        {sIdx === 0 ? t('delivery_reps.van_itinerary_tab.s145', "نقطة الانطلاق") : `+${(stop.legDistanceMeters / 1000).toFixed(1)} كم`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <StandardDialogFooter>
              <Button type="button" variant="secondary" onClick={() => optimize.setIsOptimizeModalOpen(false)}>
                {t('delivery_reps.van_itinerary_tab.s146', "إلغاء")}
              </Button>
              <Button
                type="button"
                onClick={optimize.handleApplyOptimalRoute}
                disabled={optimize.isOptimizingRoute}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '13px',
                }}
              >
                {optimize.isOptimizingRoute ? t('delivery_reps.van_itinerary_tab.s147', "جاري الاعتماد...") : t('delivery_reps.van_itinerary_tab.s148', "اعتماد وحفظ المسار الأمثل")}
              </Button>
            </StandardDialogFooter>
          </div>
        </StandardDialog>
      )}

      {/* Store Shelf Inventory Modal (Optional) */}
      {inventoryCustomer && (
        <VanStoreInventoryModal
          customer={inventoryCustomer}
          tripId={tripId}
          onClose={() => setInventoryCustomer(null)}
          onSuccess={onRefreshItinerary}
        />
      )}

      {/* Trade Merchandising & Competitor Survey Modal */}
      {surveyCustomer && (
        <VanTradeSurveyModal
          customer={surveyCustomer}
          tripId={tripId}
          onClose={() => setSurveyCustomer(null)}
          onSuccess={onRefreshItinerary}
        />
      )}

      {/* Field Damaged / Broken Goods Instant Swap Modal */}
      {swapCustomer && (
        <VanDamagedSwapModal
          open={Boolean(swapCustomer)}
          onClose={() => setSwapCustomer(null)}
          tripId={tripId || 0}
          inventory={inventory || []}
          customers={
            allAvailableCustomers && allAvailableCustomers.length > 0
              ? allAvailableCustomers
              : itinerary.map((it) => ({ id: it.customerId, name: it.customerName, phone: it.customerPhone }))
          }
          defaultCustomerId={swapCustomer.customerId}
          onSwapSuccess={() => {
            setSwapCustomer(null);
            onRefreshItinerary();
          }}
        />
      )}
    </div>
  );
};

