import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { posApi } from '@/features/pos/api/pos.api';
import { storefrontApi } from '@/features/storefront/api/storefront.api';
import { PosWorkspaceHeaderModals } from './PosWorkspaceHeaderModals';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { playNotificationChime } from '@/lib/audio-chime';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useHasFeature } from '@/shared/hooks/use-permission';
import { toast } from '@/shared/components/system-alert';

import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { usePosOfflineSync } from '@/features/pos/hooks/usePosOfflineSync';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { PosWorkspaceHeaderBadge } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderBadge';
import { PosWorkspaceHeaderCoreActions } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderCoreActions';
import { PosWorkspaceHeaderTableControls } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderTableControls';
import { PosWorkspaceHeaderHubButtons } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderHubButtons';
import { PosWorkspaceHeaderShiftControls } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderShiftControls';
import { PosWorkspaceHeaderWindowControls } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderWindowControls';

interface PosWorkspaceHeaderProps {
  pos: PosWorkspaceState;
  posMode: PosSaleMode;
  onModeChange: (mode: PosSaleMode) => void;
  onFocusSearch: () => void;
  onOpenNewProduct?: () => void;
  onOpenQuickService?: () => void;
  onOpenHeldDrafts?: () => void;
  onOpenTables?: () => void;
  onOpenPhoneOrder?: () => void;
  onPrintDraft: () => void;
  onRequestOpenShift?: () => void;
  onOpenSerialLookup?: () => void;
  onOpenReprintModal?: () => void;
  onOpenComboModal?: () => void;
  onOpenManagerComp?: () => void;
  onPrintCupLabels?: () => void;
}

function PosWorkspaceHeaderComponent({
  pos,
  posMode,
  onModeChange,
  onFocusSearch,
  onOpenQuickService,
  onOpenHeldDrafts,
  onOpenTables,
  onOpenPhoneOrder,
  onRequestOpenShift,
  onOpenReprintModal,
  onOpenComboModal,
  onOpenManagerComp,
  onPrintCupLabels,
}: PosWorkspaceHeaderProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  const hasStorefrontFeature = useHasFeature('storefront');
  const isRestaurantActive = settings?.restaurantModuleEnabled === true;
  const isPhoneOrdersActive = settings?.phoneOrdersModuleEnabled === true || (settings?.phoneOrdersModuleEnabled === undefined && (isRestaurantActive || ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(settings?.businessIndustry || '')));
  const isStorefrontActive = Boolean(settings && hasStorefrontFeature && settings.storefrontModuleEnabled !== false);
  const isServicesActive = settings?.servicesModuleEnabled === true || Boolean(settings?.enableMobileStoreFeatures);

  const { offlineQueue, queueError, isSyncing, hasFailedSales, syncOfflineSales } = usePosOfflineSync();
  const [isOfflineQueueModalOpen, setIsOfflineQueueModalOpen] = useState(false);
  const [isNoSaleOpen, setIsNoSaleOpen] = useState(false);
  const [isExchangeOpen, setIsExchangeOpen] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState('');
  const [noSaleManagerPin, setNoSaleManagerPin] = useState('');
  const [isNoSalePending, setIsNoSalePending] = useState(false);
  const [isOnlineOrdersOpen, setIsOnlineOrdersOpen] = useState(false);
  const [isTablesOpen, setIsTablesOpen] = useState(false);
  const [isAggregatorsOpen, setIsAggregatorsOpen] = useState(false);
  const [isDriverDispatchOpen, setIsDriverDispatchOpen] = useState(false);
  const [isFoodWasteOpen, setIsFoodWasteOpen] = useState(false);
  const [is86ModalOpen, setIs86ModalOpen] = useState(false);
  const [isTipPoolOpen, setIsTipPoolOpen] = useState(false);
  const [isPrepSheetOpen, setIsPrepSheetOpen] = useState(false);
  const [isPlateRadarOpen, setIsPlateRadarOpen] = useState(false);
  const [isStampCardOpen, setIsStampCardOpen] = useState(false);
  const [isDriveThruOpen, setIsDriveThruOpen] = useState(false);
  const [isUpsellModalOpen, setIsUpsellModalOpen] = useState(false);
  const [upsellRules, setUpsellRules] = useState<any[]>([]);

  const { data: headerZones = [] } = useQuery({
    queryKey: ['restaurant-floor-zones', pos.branchId],
    queryFn: () => restaurantAdvancedFnbApi.getZones(pos.branchId ? Number(pos.branchId) : undefined),
    enabled: isRestaurantActive,
    staleTime: 60_000,
  });

  const activeTableZone = headerZones.find((z) => {
    if (!pos.tableNumber) return false;
    const nums = Array.isArray(z.table_numbers) ? z.table_numbers : [];
    return nums.map(String).includes(String(pos.tableNumber).trim());
  });
  const activeZoneMinSpend = Number(activeTableZone?.minimum_spend || 0);
  const currentCartTotal = Number(pos.totals?.total || 0);

  const { data: items86 = [] } = useQuery({
    queryKey: ['pos-86-items-header', pos.branchId],
    queryFn: () => restaurantAdvancedFnbApi.get86Items(pos.branchId ? Number(pos.branchId) : undefined),
    enabled: isRestaurantActive,
    refetchInterval: 15_000,
  });
  const count86 = items86.length;
  const currentUser = useAuthStore((s: any) => s.user);
  const isManager = isAdminUser(currentUser) || currentUser?.permissions?.includes('pos_manager') || currentUser?.permissions?.includes('manage_restaurant');

  const [isDisplaysModalOpen, setIsDisplaysModalOpen] = useState(false);
  const [isOpsModalOpen, setIsOpsModalOpen] = useState(false);
  const [isManagerCompOpen, setIsManagerCompOpen] = useState(false);
  const [isComboMealModalOpen, setIsComboMealModalOpen] = useState(false);
  const [isCustomizationOpen, setIsCustomizationOpen] = useState(false);
  const [isShiftMenuOpen, setIsShiftMenuOpen] = useState(false);
  const shiftMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isShiftMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (shiftMenuRef.current && !shiftMenuRef.current.contains(e.target as Node)) {
        setIsShiftMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isShiftMenuOpen]);

  useEffect(() => {
    if (isRestaurantActive && posMode !== 'touch') {
      onModeChange('touch');
    }
  }, [isRestaurantActive, posMode, onModeChange]);

  const requiresNoSalePin = Boolean(settings?.antiTheftRequirePinForNoSale) && !isAdminUser(currentUser);

  const handleNoSaleDrawerKick = useCallback(async () => {
    if (isNoSalePending) return;
    const branchId = Number(pos.branchId);
    if (!pos.ownOpenShift || !Number.isInteger(branchId) || branchId <= 0) {
      toast.error('افتح وردية على الفرع الحالي أولاً');
      return;
    }
    if (!noSaleReason.trim()) {
      toast.error('أدخل سبب فتح الدرج');
      return;
    }
    if (requiresNoSalePin && !noSaleManagerPin.trim()) {
      toast.error('أدخل رمز أو كلمة مرور المدير لاعتماد فتح الدرج');
      return;
    }
    setIsNoSalePending(true);
    try {
      await posApi.logSecurityEvent({
        eventType: 'no_sale',
        branchId,
        note: noSaleReason.trim(),
        ...(noSaleManagerPin.trim() ? { managerPin: noSaleManagerPin.trim() } : {}),
      });
      setIsNoSaleOpen(false);
      setNoSaleReason('');
      setNoSaleManagerPin('');
      const printer = (window as Window & { electronPrinter?: { kickCashDrawer: (device?: string) => Promise<unknown> } }).electronPrinter;
      if (printer?.kickCashDrawer) {
        try {
          await printer.kickCashDrawer(settings?.posElectronCashierPrinter);
          toast.success('تم تسجيل فتح الدرج وإرسال أمر الفتح');
        } catch {
          toast.warning('تم تسجيل الحدث، لكن تعذر الاتصال بدرج النقدية');
        }
      } else {
        const bridgeAvailable = await HardwareBridgeClient.isAvailable().catch(() => false);
        if (bridgeAvailable) {
          try {
            await HardwareBridgeClient.kickDrawer({
              ip: (settings as { posNetworkPrinterIp?: string } | null)?.posNetworkPrinterIp || '127.0.0.1',
            });
            toast.success('تم تسجيل فتح الدرج وإرسال أمر الفتح عبر جسر العتاد');
          } catch {
            toast.warning('تم تسجيل الحدث، لكن تعذر الاتصال بجسر العتاد');
          }
        } else {
          toast.warning('تم تسجيل الحدث، لكن فتح الدرج المباشر متاح من تطبيق سطح المكتب أو جسر العتاد فقط');
        }
      }
    } catch {
      toast.error('تعذر اعتماد فتح الدرج؛ لم يُرسل أمر الفتح');
    } finally {
      setIsNoSalePending(false);
    }
  }, [isNoSalePending, noSaleReason, noSaleManagerPin, requiresNoSalePin, pos.branchId, pos.ownOpenShift, settings?.posElectronCashierPrinter]);



  const [showFloatingAlert, setShowFloatingAlert] = useState(false);
  const previousPendingCountRef = useRef<number | null>(null);

  const pendingOrdersQuery = useQuery({
    queryKey: ['pos-pending-orders-count'],
    queryFn: async () => {
      try {
        const res = await storefrontApi.getOrderCounts();
        return res.counts?.pending || 0;
      } catch {
        return 0;
      }
    },
    enabled: isStorefrontActive,
    refetchInterval: 20 * 1000,
    staleTime: 15 * 1000,
  });

  const pendingCount = isStorefrontActive ? (pendingOrdersQuery.data || 0) : 0;

  useEffect(() => {
    if (previousPendingCountRef.current !== null && pendingCount > previousPendingCountRef.current) {
      playNotificationChime();
      setShowFloatingAlert(true);
    }
    previousPendingCountRef.current = pendingCount;
  }, [pendingCount]);

  return (
    <>
      <PageHeader
      title={t('pos.pos_workspace.pos_workspace_header.s0', "نقطة البيع")}
      badge={
        <PosWorkspaceHeaderBadge
          queueError={queueError}
          offlineQueue={offlineQueue}
          hasFailedSales={hasFailedSales}
          isSyncing={isSyncing}
          setIsOfflineQueueModalOpen={setIsOfflineQueueModalOpen}
        />
      }
      className="page-header--dense pos-page-header pos-page-header-streamlined"
      actions={(
        <div className="actions compact-actions pos-header-actions-row pos-header-toolbar-single" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', overflow: 'visible' }}>
          <PosWorkspaceHeaderCoreActions
            isRestaurantActive={isRestaurantActive}
            posMode={posMode}
            onModeChange={onModeChange}
            pos={pos}
            onFocusSearch={onFocusSearch}
            isServicesActive={isServicesActive}
            onOpenQuickService={onOpenQuickService}
            onOpenReprintModal={onOpenReprintModal}
            setIsExchangeOpen={setIsExchangeOpen}
            setIsCustomizationOpen={setIsCustomizationOpen}
            isPhoneOrdersActive={isPhoneOrdersActive}
            onOpenPhoneOrder={onOpenPhoneOrder}
          />

          <PosWorkspaceHeaderTableControls
            isRestaurantActive={isRestaurantActive}
            onOpenTables={onOpenTables}
            onOpenHeldDrafts={onOpenHeldDrafts}
            setIsTablesOpen={setIsTablesOpen}
            pos={pos}
            activeZoneMinSpend={activeZoneMinSpend}
            currentCartTotal={currentCartTotal}
          />

          <PosWorkspaceHeaderHubButtons
            isStorefrontActive={isStorefrontActive}
            pendingCount={pendingCount}
            setIsOnlineOrdersOpen={setIsOnlineOrdersOpen}
            setIsDisplaysModalOpen={setIsDisplaysModalOpen}
            isDisplaysModalOpen={isDisplaysModalOpen}
            isRestaurantActive={isRestaurantActive}
            setIsOpsModalOpen={setIsOpsModalOpen}
            isOpsModalOpen={isOpsModalOpen}
            count86={count86}
          />

          <PosWorkspaceHeaderShiftControls
            pos={pos}
            shiftMenuRef={shiftMenuRef}
            setIsShiftMenuOpen={setIsShiftMenuOpen}
            isShiftMenuOpen={isShiftMenuOpen}
            settings={settings}
            setIsNoSaleOpen={setIsNoSaleOpen}
            setIsCustomizationOpen={setIsCustomizationOpen}
            onRequestOpenShift={onRequestOpenShift}
          />

          <PosWorkspaceHeaderWindowControls />
        </div>
      )}
    />
    <PosWorkspaceHeaderModals
      pos={pos}
      settings={settings}
      isRestaurantActive={Boolean(isRestaurantActive)}
      isPhoneOrdersActive={Boolean(isPhoneOrdersActive)}
      isStorefrontActive={Boolean(isStorefrontActive)}
      isManager={Boolean(isManager)}
      count86={count86}
      offlineQueue={offlineQueue}
      isSyncing={isSyncing}
      syncOfflineSales={syncOfflineSales}
      pendingCount={pendingCount}
      showFloatingAlert={showFloatingAlert}
      setShowFloatingAlert={setShowFloatingAlert}
      noSaleReason={noSaleReason}
      setNoSaleReason={setNoSaleReason}
      noSaleManagerPin={noSaleManagerPin}
      setNoSaleManagerPin={setNoSaleManagerPin}
      requiresNoSalePin={requiresNoSalePin}
      isNoSalePending={isNoSalePending}
      handleNoSaleDrawerKick={handleNoSaleDrawerKick}
      upsellRules={upsellRules}
      setUpsellRules={setUpsellRules}
      onOpenTables={onOpenTables}
      onOpenComboModal={onOpenComboModal}
      onPrintCupLabels={onPrintCupLabels}
      onOpenManagerComp={onOpenManagerComp}
      isOnlineOrdersOpen={isOnlineOrdersOpen}
      setIsOnlineOrdersOpen={setIsOnlineOrdersOpen}
      isTablesOpen={isTablesOpen}
      setIsTablesOpen={setIsTablesOpen}
      isOfflineQueueModalOpen={isOfflineQueueModalOpen}
      setIsOfflineQueueModalOpen={setIsOfflineQueueModalOpen}
      isNoSaleOpen={isNoSaleOpen}
      setIsNoSaleOpen={setIsNoSaleOpen}
      isExchangeOpen={isExchangeOpen}
      setIsExchangeOpen={setIsExchangeOpen}
      isAggregatorsOpen={isAggregatorsOpen}
      setIsAggregatorsOpen={setIsAggregatorsOpen}
      isDriverDispatchOpen={isDriverDispatchOpen}
      setIsDriverDispatchOpen={setIsDriverDispatchOpen}
      isFoodWasteOpen={isFoodWasteOpen}
      setIsFoodWasteOpen={setIsFoodWasteOpen}
      is86ModalOpen={is86ModalOpen}
      setIs86ModalOpen={setIs86ModalOpen}
      isTipPoolOpen={isTipPoolOpen}
      setIsTipPoolOpen={setIsTipPoolOpen}
      isPrepSheetOpen={isPrepSheetOpen}
      setIsPrepSheetOpen={setIsPrepSheetOpen}
      isPlateRadarOpen={isPlateRadarOpen}
      setIsPlateRadarOpen={setIsPlateRadarOpen}
      isStampCardOpen={isStampCardOpen}
      setIsStampCardOpen={setIsStampCardOpen}
      isDriveThruOpen={isDriveThruOpen}
      setIsDriveThruOpen={setIsDriveThruOpen}
      isUpsellModalOpen={isUpsellModalOpen}
      setIsUpsellModalOpen={setIsUpsellModalOpen}
      isOpsModalOpen={isOpsModalOpen}
      setIsOpsModalOpen={setIsOpsModalOpen}
      isDisplaysModalOpen={isDisplaysModalOpen}
      setIsDisplaysModalOpen={setIsDisplaysModalOpen}
      isManagerCompOpen={isManagerCompOpen}
      setIsManagerCompOpen={setIsManagerCompOpen}
      isComboMealModalOpen={isComboMealModalOpen}
      setIsComboMealModalOpen={setIsComboMealModalOpen}
      isCustomizationOpen={isCustomizationOpen}
      setIsCustomizationOpen={setIsCustomizationOpen}
    />
    </>
  );
}

function areEqual(prev: PosWorkspaceHeaderProps, next: PosWorkspaceHeaderProps) {
  return prev.pos.isLoading === next.pos.isLoading
    && prev.pos.paymentType === next.pos.paymentType
    && prev.pos.paymentChannel === next.pos.paymentChannel
    && prev.pos.ownOpenShift === next.pos.ownOpenShift
    && prev.pos.branchId === next.pos.branchId
    && prev.pos.hasOperationalSetup === next.pos.hasOperationalSetup
    && prev.pos.hasCatalogReady === next.pos.hasCatalogReady
    && prev.pos.requiresCashierShift === next.pos.requiresCashierShift
    && prev.pos.cart === next.pos.cart
    && prev.pos.lastSale === next.pos.lastSale
    && prev.pos.canSubmitSale === next.pos.canSubmitSale
    && prev.pos.canSubmitHint === next.pos.canSubmitHint
    && prev.pos.heldDraftSummaries === next.pos.heldDraftSummaries
    && prev.pos.settingsQuery.data?.enableMobileStoreFeatures === next.pos.settingsQuery.data?.enableMobileStoreFeatures
    && prev.pos.settingsQuery.data?.antiTheftRequirePinForNoSale === next.pos.settingsQuery.data?.antiTheftRequirePinForNoSale
    && prev.posMode === next.posMode
    && prev.onFocusSearch === next.onFocusSearch
    && prev.onOpenNewProduct === next.onOpenNewProduct
    && prev.onOpenQuickService === next.onOpenQuickService
    && prev.onOpenHeldDrafts === next.onOpenHeldDrafts
    && prev.onModeChange === next.onModeChange
    && prev.onPrintDraft === next.onPrintDraft;
}

export const PosWorkspaceHeader = memo(PosWorkspaceHeaderComponent, areEqual);
