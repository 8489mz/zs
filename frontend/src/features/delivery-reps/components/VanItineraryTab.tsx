import React, { useState } from 'react';
import {
  VanCustomerItineraryItem,
  RepTargetMetrics,
  VanStockItem,
} from '../api/van-sales.api';
import { VanCustomerStatementModal } from './VanCustomerStatementModal';
import { VanStoreInventoryModal } from './VanStoreInventoryModal';
import { VanTradeSurveyModal } from './VanTradeSurveyModal';
import { VanDamagedSwapModal } from './VanDamagedSwapModal';
import { VanItineraryToolbar } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-toolbar';
import { VanItineraryCustomerList } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-customer-list';
import { VanItineraryAddDialog } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-add-dialog';
import { VanItineraryNegativeModal, VanItineraryOptimizeModal } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-modals';
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
      <VanItineraryNegativeModal
        negativeModalOpen={negative.negativeModalOpen}
        setNegativeModalOpen={negative.setNegativeModalOpen}
        activeCustomer={negative.activeCustomer}
        negativeReason={negative.negativeReason}
        setNegativeReason={negative.setNegativeReason}
        postponedDate={negative.postponedDate}
        setPostponedDate={negative.setPostponedDate}
        negativeNotes={negative.negativeNotes}
        setNegativeNotes={negative.setNegativeNotes}
        isSubmitting={negative.isSubmitting}
        handleSubmitNegativeVisit={negative.handleSubmitNegativeVisit}
      />
      {/* Field Customer Statement Modal */}
      {statementModalCust && (
        <VanCustomerStatementModal
          open={Boolean(statementModalCust)}
          onClose={() => setStatementModalCust(null)}
          customerId={statementModalCust.customerId}
          customerName={statementModalCust.customerName}
        />
      )}
      <VanItineraryOptimizeModal
        isOptimizeModalOpen={optimize.isOptimizeModalOpen}
        setIsOptimizeModalOpen={optimize.setIsOptimizeModalOpen}
        isOptimizingRoute={optimize.isOptimizingRoute}
        routeOptimizationResult={optimize.routeOptimizationResult}
        handleApplyOptimalRoute={optimize.handleApplyOptimalRoute}
      />
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

