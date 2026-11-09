import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { posApi } from '@/features/pos/api/pos.api';
import { applyComboToCart, buildComboLineKey, isNegativeStockSalesAllowed } from '@/features/pos/lib/pos.domain';
import { storefrontApi } from '@/features/storefront/api/storefront.api';
import { PosOnlineOrdersModal } from './PosOnlineOrdersModal';
import { PosTablesFloorPlanDialog } from './PosTablesFloorPlanDialog';
import { PosOnlineOrderFloatingAlert } from './PosOnlineOrderFloatingAlert';
import { PosOfflineQueueModal } from './PosOfflineQueueModal';
import { PosInstantExchangeDialog } from './PosInstantExchangeDialog';
import { PosDeliveryAggregatorsModal } from './PosDeliveryAggregatorsModal';
import { PosFoodWasteModal } from './PosFoodWasteModal';
import { RestaurantDeliveryDispatcherModal } from './RestaurantDeliveryDispatcherModal';
import { Pos86ItemsModal } from './Pos86ItemsModal';
import { PosTipPoolModal } from './PosTipPoolModal';
import { KitchenDailyPrepSheetModal } from './KitchenDailyPrepSheetModal';
import { PosPlateCostRadarModal } from './PosPlateCostRadarModal';
import { PosCustomerPunchCardModal } from './PosCustomerPunchCardModal';
import { PosDriveThruModal } from './PosDriveThruModal';
import { PosSmartUpsellModal } from './PosSmartUpsellModal';
import { PosRestaurantOperationsModal } from './PosRestaurantOperationsModal';
import { PosDisplaysModal } from './PosDisplaysModal';
import { PosManagerCompModal } from './PosManagerCompModal';
import { PosComboMealModal } from './PosComboMealModal';
import { PosCustomizationDialog } from './PosCustomizationDialog';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { playNotificationChime } from '@/lib/audio-chime';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { toast } from '@/shared/components/system-alert';
import { printXReport } from '@/features/cash-drawer';
import { cashDrawerApi } from '@/lib/api/cash-drawer';

import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { dispatchPosChromeToggle, dispatchPosFullscreenToggle } from '@/features/pos/lib/pos-shell';
import { ZErpIcon } from '@/shared/components/z-erp-brand';
import { usePosOfflineSync } from '@/features/pos/hooks/usePosOfflineSync';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import {
  UtensilsIcon,
  MonitorIcon,
  MaximizeIcon,
  MenuIcon,
  PhoneCallIcon,
  PrinterIcon,
  ChevronDownIcon,
  SlidersIcon,
  LockIcon,
} from '@/shared/components/icons/AppIcons';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { formatCurrency } from '@/lib/format';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';

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
  const { t, i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));
  const { data: settings } = useSettingsQuery();
  const isRestaurantActive = settings?.restaurantModuleEnabled === true;
  const isPhoneOrdersActive = settings?.phoneOrdersModuleEnabled === true || (settings?.phoneOrdersModuleEnabled === undefined && (isRestaurantActive || ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(settings?.businessIndustry || '')));
  const isStorefrontActive = settings?.storefrontModuleEnabled !== false;
  const isServicesActive = settings?.servicesModuleEnabled === true || Boolean(settings?.enableMobileStoreFeatures);

  const { offlineQueue, queueError, isSyncing, hasFailedSales, syncOfflineSales } = usePosOfflineSync();
  const [isOfflineQueueModalOpen, setIsOfflineQueueModalOpen] = useState(false);
  const [isNoSaleOpen, setIsNoSaleOpen] = useState(false);
  const [isExchangeOpen, setIsExchangeOpen] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState('');
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
    setIsNoSalePending(true);
    try {
      await posApi.logSecurityEvent({ eventType: 'no_sale', branchId, note: noSaleReason.trim() });
      setIsNoSaleOpen(false);
      setNoSaleReason('');
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
            await HardwareBridgeClient.kickDrawer({ ip: (settings as any)?.posNetworkPrinterIp || '127.0.0.1' });
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
  }, [isNoSalePending, noSaleReason, pos.branchId, pos.ownOpenShift, settings?.posElectronCashierPrinter]);



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
      badge={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', direction: 'ltr', color: '#0f172a' }} aria-label="Z ERP">
          <span className="pos-header-brand-mark" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ZErpIcon size={26} />
            <strong style={{ fontSize: '13px', fontWeight: 900, letterSpacing: '0.02em', lineHeight: 1 }}>ERP</strong>
          </span>
          {queueError ? (
            <span role="alert" style={{ color: '#991b1b', border: '1px solid #fca5a5', background: '#fee2e2', padding: '3px 8px', marginRight: 8, fontSize: 12, borderRadius: 6 }}>
              {queueError}
            </span>
          ) : null}
          {offlineQueue.length > 0 && (
            <button
              type="button"
              onClick={() => setIsOfflineQueueModalOpen(true)}
              title={t('pos.pos_workspace.pos_workspace_header.s1', "انقر لعرض وإدارة الفواتير المعلقة بدون إنترنت")}
              style={{
                background: hasFailedSales ? '#fee2e2' : '#ffedd5',
                color: hasFailedSales ? '#991b1b' : '#9a3412',
                border: hasFailedSales ? '1px solid #fca5a5' : '1px solid #fed7aa',
                padding: '3px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 700,
                marginRight: '8px',
                direction: 'rtl',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'transform 0.1s ease',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: hasFailedSales ? '#dc2626' : '#d97706', display: 'inline-block' }} />
              <span>{isSyncing ? t('pos.pos_workspace.pos_workspace_header.s2', "جاري المزامنة...") : `${offlineQueue.length} فواتير معلقة`}</span>
            </button>
          )}
        </span>
      )}
      className="page-header--dense pos-page-header pos-page-header-streamlined"
      actions={(
        <div className="actions compact-actions pos-header-actions-row pos-header-toolbar-single" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', overflow: 'visible' }}>
          {/* 1. Mode Toggle (Retail only - Restaurants use Touch exclusively) */}
          {!isRestaurantActive && (
            <div className="pos-mode-toggle" role="group" aria-label="POS mode">
              <Button type="button" variant={posMode === 'scanner' ? 'primary' : 'secondary'} onClick={() => onModeChange('scanner')}>{t('pos.pos_workspace.pos_workspace_header.s3', "سكانر")}</Button>
              <Button type="button" variant={posMode === 'touch' ? 'primary' : 'secondary'} onClick={() => onModeChange('touch')}>{t('pos.pos_workspace.pos_workspace_header.s4', "تاتش")}</Button>
            </div>
          )}

          {/* 2. Branch Info */}
          {pos.currentBranch?.name && (
            <div className="pos-header-branch-info" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: '8px', fontWeight: 700, color: '#334155' }}>
              <span>{pos.currentBranch.name}</span>
              <span style={{ opacity: 0.4 }}>|</span>
              <span>{(pos.currentBranch as any).salesStockMode === 'all_operational_locations' ? t('pos.pos_workspace.pos_workspace_header.s5', "كل المخازن") : t('pos.pos_workspace.pos_workspace_header.s6', "مخزن أساسي")}</span>
            </div>
          )}

          {/* 3. Fast Actions */}
          <Button type="button" variant="secondary" onClick={onFocusSearch} title={t('pos.pos_workspace.pos_workspace_header.s7', "البحث في الأصناف (F6)")}>
            {t('pos.pos_workspace.pos_workspace_header.s8', "البحث F6")}
          </Button>
          {isServicesActive && onOpenQuickService && (
            <Button type="button" variant="secondary" onClick={onOpenQuickService} title={t('pos.pos_workspace.pos_workspace_header.s9', "قائمة الخدمات السريعة (F8)")}>
              {t('pos.pos_workspace.pos_workspace_header.s10', "خدمة سريعة F8")}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onOpenReprintModal || pos.reprintLastSale} title={t('pos.pos_workspace.pos_workspace_header.s11', "إعادة طباعة الفواتير (F9)")}>
            {t('pos.pos_workspace.pos_workspace_header.s12', "F9 إعادة طباعة")}
          </Button>
          {!isRestaurantActive && (
            <Button type="button" variant="secondary" onClick={() => setIsExchangeOpen(true)} disabled={!pos.ownOpenShift || !pos.cart.length} title={t('pos.pos_workspace.pos_workspace_header.s13', "استبدال بضاعة بالفاتورة الأصلية")}>
              {t('pos.pos_workspace.pos_workspace_header.s14', "استبدال فوري")}
            </Button>
          )}

          {/* Quick UI Customization Button */}
          <Button
            type="button"
            variant="secondary"
            className="pos-customize-btn"
            onClick={() => setIsCustomizationOpen(true)}
            title={t('pos.customize_ui_title', "تخصيص واجهة الكاشير والشاشات المتنقلة")}
            aria-label={t('pos.customize_short', "تخصيص الواجهة")}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}
          >
            <SlidersIcon size={16} color="#170e5e" />
          </Button>

          {/* Phone & Delivery Order Desk (F7) */}
          {isPhoneOrdersActive && onOpenPhoneOrder && (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenPhoneOrder}
              style={{
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                color: pos.orderType === 'delivery' ? '#ffffff' : '#334155',
                background: pos.orderType === 'delivery' ? '#170e5e' : undefined,
                border: pos.orderType === 'delivery' ? '1px solid #170e5e' : undefined,
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s15', "مكتب طلبات الهاتف والتوصيل السريع وكاشف المتصل (F7 أو Alt + P)")}
            >
              <PhoneCallIcon size={14} color={pos.orderType === 'delivery' ? '#ffffff' : '#170e5e'} />
              <span>{t('pos.pos_workspace.pos_workspace_header.s16', "طلب هاتفي F7")}</span>
            </Button>
          )}

          {/* 4. Restaurant Tables (Only when Restaurant Module is active) */}
          {isRestaurantActive && (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenTables || onOpenHeldDrafts || (() => setIsTablesOpen(true))}
              style={{
                fontWeight: 700,
                color: pos.tableNumber ? '#170e5e' : undefined,
                background: pos.tableNumber ? '#f1f5f9' : undefined,
                border: pos.tableNumber ? '1px solid #cbd5e1' : undefined,
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s17', "إدارة طاولات الصالة وجلسات الطعام والطلبات المعلقة (F3)")}
            >
              {pos.tableNumber ? `طاولة: ${pos.tableNumber}` : t('pos.pos_workspace.pos_workspace_header.s18', "الطاولات F3")}
            </Button>
          )}

          {/* Dining Course Selector for Active Table */}
          {pos.tableNumber && (
            <div
              className="pos-header-table-controls"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                padding: '2px',
                gap: '2px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s19', "تحديد مسار تقديم الوجبة للمطبخ (Courser)")}
            >
              {[
                { key: 'appetizer', label: t('pos.pos_workspace.pos_workspace_header.s20', "مقبلات") },
                { key: 'main', label: t('pos.pos_workspace.pos_workspace_header.s21', "رئيسي") },
                { key: 'dessert', label: t('pos.pos_workspace.pos_workspace_header.s22', "حلوى") },
              ].map((c) => {
                const active = (pos as any).diningCourse === c.key || (!pos.diningCourse && c.key === 'main');
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => (pos as any).setDiningCourse?.(c.key)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      border: 'none',
                      background: active ? '#170e5e' : 'transparent',
                      color: active ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Guest Count (Covers) Stepper & Spend per guest - Strict RTL Stepper: [+] (العدد) [-] */}
          {(pos.tableNumber || pos.orderType === 'dine_in') && (
            <div
              className="pos-header-table-controls"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                padding: '2px 4px',
                gap: '3px',
                height: '30px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s23', "عدد الضيوف على الطاولة ومؤشر متوسط إنفاق الفرد")}
            >
              <button
                type="button"
                onClick={() => (pos as any).setGuestCount?.((prev: number) => Math.min(99, (prev || 1) + 1))}
                style={{
                  width: '22px',
                  height: '22px',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('pos.pos_workspace.pos_workspace_header.s24', "زيادة عدد الضيوف")}
              >
                +
              </button>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#170e5e', minWidth: '46px', textAlign: 'center' }}>
                {(pos as any).guestCount || 1} {t('pos.pos_workspace.pos_workspace_header.s25', "ضيوف")}
              </span>
              <button
                type="button"
                onClick={() => (pos as any).setGuestCount?.((prev: number) => Math.max(1, (prev || 1) - 1))}
                style={{
                  width: '22px',
                  height: '22px',
                  border: 'none',
                  background: '#f1f5f9',
                  color: '#0f172a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('pos.pos_workspace.pos_workspace_header.s26', "إنقاص عدد الضيوف")}
              >
                -
              </button>
              {pos.cart.length > 0 && (
                <span
                  style={{
                    marginRight: '4px',
                    paddingRight: '6px',
                    borderRight: '1px solid #e2e8f0',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: '#475569',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('pos.pos_workspace.pos_workspace_header.s27', "متوسط الفرد:")} <strong style={{ color: '#047857' }}>{formatCurrency((pos.totals?.total || 0) / ((pos as any).guestCount || 1))}</strong>
                </span>
              )}
              {activeZoneMinSpend > 0 && (
                <span
                  style={{
                    marginRight: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    background: currentCartTotal >= activeZoneMinSpend ? '#ecfdf5' : '#fef2f2',
                    color: currentCartTotal >= activeZoneMinSpend ? '#047857' : '#b91c1c',
                    border: `1px solid ${currentCartTotal >= activeZoneMinSpend ? '#a7f3d0' : '#fecaca'}`,
                  }}
                  title={`الحد الأدنى لإنفاق الطاولة في هذه المنطقة: ${formatCurrency(activeZoneMinSpend)}`}
                >
                  {t('pos.pos_workspace.pos_workspace_header.s28', "الحد الأدنى:")} {formatCurrency(activeZoneMinSpend)} {currentCartTotal < activeZoneMinSpend && `(عجز: ${formatCurrency(activeZoneMinSpend - currentCartTotal)})`}
                </span>
              )}
            </div>
          )}

          {/* 1-Click Print Guest Check Button for Active Table/Cart (Restaurant Mode Only) */}
          {isRestaurantActive && (pos.tableNumber || pos.orderType === 'dine_in') && pos.cart.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => (pos as any).printGuestCheckNow?.()}
              style={{
                fontWeight: 700,
                fontSize: '11.5px',
                height: '30px',
                padding: '0 10px',
                color: '#170e5e',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s29', "طباعة شيك حساب الطاولة غير المسدد للزبون للمعاينة")}
            >
              <PrinterIcon size={14} color="#170e5e" />
              <span>{(pos as any).guestCheckPrintedAt ? t('pos.pos_workspace.pos_workspace_header.s30', "تم تسليم الشيك (إعادة طباعة)") : t('pos.pos_workspace.pos_workspace_header.s31', "طباعة الشيك المبدئي")}</span>
            </Button>
          )}

          {/* 5. Online Orders Smart Notification Badge (Only when Storefront is active and pending orders exist) */}
          {isStorefrontActive && pendingCount > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOnlineOrdersOpen(true)}
              style={{
                fontWeight: 700,
                background: '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s32', "طلبات متجر إلكتروني جديدة معلقة بانتظار الاعتماد")}
            >
              <span>{t('pos.pos_workspace.pos_workspace_header.s33', "طلبات أونلاين")}</span>
              <span
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 900,
                  borderRadius: '999px',
                  padding: '1px 7px',
                  lineHeight: '1.2',
                }}
              >
                {pendingCount}
              </span>
            </Button>
          )}

          {/* 6. Screens Hub Trigger Button */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsDisplaysModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              background: isDisplaysModalOpen ? '#f1f5f9' : '#ffffff',
              color: '#1e293b',
              border: '1px solid #cbd5e1',
            }}
            title={t('pos.pos_workspace.pos_workspace_header.s34', "مركز شاشات العرض الخارجية والمحطات التفاعلية")}
          >
            <MonitorIcon size={16} color="#170e5e" />
            <span>{t('pos.pos_workspace.pos_workspace_header.s35', "شاشات العرض")}</span>
          </Button>

          {/* 7. Restaurant Operations Modal Trigger Button */}
          {isRestaurantActive && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOpsModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                background: isOpsModalOpen ? '#f1f5f9' : '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
              }}
              title={t('pos.pos_workspace.pos_workspace_header.s36', "مركز عمليات وأدوات المطعم المتقدمة")}
            >
              <UtensilsIcon size={16} color="#170e5e" />
              <span>{t('pos.pos_workspace.pos_workspace_header.s37', "عمليات المطعم")}</span>
              {count86 > 0 && (
                <span
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: '999px',
                    lineHeight: '1.2',
                  }}
                >
                  {count86}
                </span>
              )}
            </Button>
          )}

          {/* 8. Shift Controls: Split-button with dropdown (Close Shift, X-Report, Emergency Drawer Kick) */}
          {pos.ownOpenShift ? (
            <div
              ref={shiftMenuRef}
              className="pos-shift-actions-group"
            >
              <Link
                to={`/cash-drawer?action=close${pos.ownOpenShift?.id ? `&shiftId=${pos.ownOpenShift.id}` : ''}`}
                style={{ textDecoration: 'none', display: 'inline-flex' }}
              >
                <Button
                  type="button"
                  variant="secondary"
                  className="pos-close-shift-btn"
                  title={t('pos.pos_workspace.pos_workspace_header.s38', "تقفيل الوردية الحالية وترحيل النقدية")}
                >
                  <span className="pos-close-shift-text-full">{t('pos.pos_workspace.pos_workspace_header.s39', "تقفيل الوردية")}</span>
                  <span className="pos-close-shift-text-short">{t('pos.pos_workspace.pos_workspace_header.s40', "تقفيل")}</span>
                </Button>
              </Link>
              <button
                type="button"
                onClick={() => setIsShiftMenuOpen((prev) => !prev)}
                className={`btn btn-secondary pos-shift-dropdown-trigger ${isShiftMenuOpen ? 'is-active' : ''}`}
                title={t('pos.pos_workspace.pos_workspace_header.s41', "خيارات الوردية (تقرير X، فتح الدرج، إقفال Z)")}
                aria-label={t('pos.pos_workspace.pos_workspace_header.s42', "خيارات الوردية")}
                aria-expanded={isShiftMenuOpen}
              >
                <ChevronDownIcon size={14} />
              </button>

              {isShiftMenuOpen && (
                <div
                  className="pos-shift-dropdown-menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: isEn ? 'auto' : 0,
                    right: isEn ? 0 : 'auto',
                    zIndex: 1050,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '12px',
                    boxShadow: '0 12px 28px -4px rgba(15, 23, 42, 0.15), 0 4px 8px -2px rgba(15, 23, 42, 0.06)',
                    minWidth: '245px',
                    maxWidth: 'calc(100vw - 20px)',
                    boxSizing: 'border-box',
                    padding: '8px 8px 12px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    direction: isEn ? 'ltr' : 'rtl',
                    textAlign: isEn ? 'left' : 'right',
                  }}
                >
                  {/* Option 1: X-Report */}
                  <button
                    type="button"
                    onClick={async () => {
                      setIsShiftMenuOpen(false);
                      if (!pos.ownOpenShift?.id) return;
                      try {
                        const res = await cashDrawerApi.listPage({ page: 1, pageSize: 50, filter: 'open' });
                        const fresh = res.rows.find((s) => String(s.id) === String(pos.ownOpenShift?.id));
                        printXReport((fresh || pos.ownOpenShift) as any, settings?.storeName);
                      } catch {
                        printXReport(pos.ownOpenShift as any, settings?.storeName);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#eef2ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <PrinterIcon size={16} color="#170e5e" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.pos_workspace.pos_workspace_header.s43', "تقرير الوردية اللحظي (X)")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_workspace_header.s44', "طباعة مبيعات ونقدية الدرج الحالية دون إغلاق")}</span>
                    </div>
                  </button>

                  {/* Option 2: Emergency / Audit No-Sale Drawer Kick (Desktop only - hidden on mobile) */}
                  <button
                    type="button"
                    className="pos-shift-drawer-item"
                    onClick={() => {
                      setIsShiftMenuOpen(false);
                      setIsNoSaleOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <SlidersIcon size={15} color="#334155" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.pos_workspace.pos_workspace_header.s45', "فتح الدرج يدوياً (No-Sale)")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_workspace_header.s46', "فتح الدرج للجرد أو الصرف مع تسجيل السبب")}</span>
                    </div>
                  </button>

                  {/* Option 2.8: Customize Cashier Interface (Desktop only - mobile already has dedicated header button) */}
                  <button
                    type="button"
                    className="pos-shift-customize-item"
                    onClick={() => {
                      setIsShiftMenuOpen(false);
                      setIsCustomizationOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      color: '#0f172a',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: '#f3e8ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <SlidersIcon size={15} color="#7c3aed" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.customize_ui', "تخصيص واجهة الكاشير")}</span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('pos.customize_ui_desc', "إظهار/إخفاء الأقسام وتنسيق الموبايل المتنقل")}</span>
                    </div>
                  </button>

                  <div style={{ height: '1px', background: '#f1f5f9', margin: '2px 0' }} />

                  {/* Option 3: Close Shift (Z-Report) */}
                  <Link
                    to={`/cash-drawer?action=close${pos.ownOpenShift?.id ? `&shiftId=${pos.ownOpenShift.id}` : ''}`}
                    onClick={() => setIsShiftMenuOpen(false)}
                    style={{ textDecoration: 'none' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '9px 10px',
                        width: '100%',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        textAlign: isEn ? 'left' : 'right',
                        color: '#b91c1c',
                        background: 'transparent',
                        transition: 'background 0.12s',
                        boxSizing: 'border-box',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: '#fee2e2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <LockIcon size={15} color="#dc2626" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#991b1b' }}>{t('pos.pos_workspace.pos_workspace_header.s47', "إغلاق وتصفير الوردية (Z)")}</span>
                        <span style={{ fontSize: '10.5px', color: '#b91c1c' }}>{t('pos.pos_workspace.pos_workspace_header.s48', "جرد العهدة النقدية وإقفال الجلسة")}</span>
                      </div>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <Button type="button" variant="primary" className="pos-close-shift-btn" onClick={onRequestOpenShift}>
              <span className="pos-close-shift-text-full">{t('pos.pos_workspace.pos_workspace_header.s49', "فتح وردية")}</span>
              <span className="pos-close-shift-text-short">{t('pos.pos_workspace.pos_workspace_header.s50', "فتح")}</span>
            </Button>
          )}

          {/* 8. Compact Window Controls */}
          <div className="desktop-only-toolbar-item pos-window-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginInlineStart: 'auto' }}>
            <button
              type="button"
              onClick={() => dispatchPosChromeToggle()}
              title={t('pos.pos_workspace.pos_workspace_header.s51', "إظهار / إخفاء القائمة الجانبية (F10)")}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#475569'; }}
            >
              <MenuIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => dispatchPosFullscreenToggle()}
              title={t('pos.pos_workspace.pos_workspace_header.s52', "ملء الشاشة الكاملة (F11)")}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#475569'; }}
            >
              <MaximizeIcon size={15} />
            </button>
          </div>
        </div>
      )}
    />
    <PosOnlineOrdersModal
      isOpen={isOnlineOrdersOpen}
      onClose={() => setIsOnlineOrdersOpen(false)}
    />
    {!onOpenTables && isTablesOpen && (
      <PosTablesFloorPlanDialog
        open={isTablesOpen}
        onClose={() => setIsTablesOpen(false)}
        currentTableNumber={pos.tableNumber}
        currentCartItemsCount={pos.cart.length}
        currentCartTotal={Number(pos.totals?.total || 0)}
        heldDrafts={pos.heldDraftSummaries || []}
        onSelectTable={async (tableNum) => {
          if (pos.cart.length > 0) {
            await pos.holdDraft();
          }
          pos.setOrderType('dine_in');
          pos.setTableNumber(tableNum);
          pos.setCustomerId('');
          pos.setQuickCustomerName('');
          pos.setQuickCustomerPhone('');
          pos.setQuickCustomerAddress('');
        }}
        onRecallDraft={async (draftId) => {
          if (pos.cart.length > 0) {
            await pos.holdDraft();
          }
          await pos.recallDraft(draftId);
        }}
        onTransferTable={(from, to) => {
          pos.setTableNumber(to);
          toast.success(`تم نقل الطلب بنجاح من طاولة ${from} إلى طاولة ${to}`);
        }}
      />
    )}
    {showFloatingAlert && (
      <PosOnlineOrderFloatingAlert
        orderCount={pendingCount}
        onOpenOrders={() => {
          setShowFloatingAlert(false);
          setIsOnlineOrdersOpen(true);
        }}
        onDismiss={() => setShowFloatingAlert(false)}
      />
    )}
    <PosOfflineQueueModal
      open={isOfflineQueueModalOpen}
      onClose={() => setIsOfflineQueueModalOpen(false)}
      offlineQueue={offlineQueue}
      isSyncing={isSyncing}
      onRetrySync={syncOfflineSales}
    />
    <DialogShell open={isNoSaleOpen} onClose={() => { if (!isNoSalePending) setIsNoSaleOpen(false); }} width="min(480px, 100%)">
      <div dir="rtl" style={{ padding: 24, background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>{t('pos.pos_workspace.pos_workspace_header.s53', "فتح الدرج بدون بيع")}</h2>
        <p>{t('pos.pos_workspace.pos_workspace_header.s54', "سيُحفظ اسم المستخدم والوردية والسبب في سجل التدقيق قبل إرسال أمر فتح الدرج.")}</p>
        <label htmlFor="pos-no-sale-reason">{t('pos.pos_workspace.pos_workspace_header.s55', "سبب فتح الدرج")}</label>
        <textarea id="pos-no-sale-reason" value={noSaleReason} onChange={(event) => setNoSaleReason(event.target.value)} maxLength={500} rows={3} style={{ width: '100%', marginBottom: 12 }} disabled={isNoSalePending} />
        <Button type="button" variant="primary" onClick={() => { void handleNoSaleDrawerKick(); }} disabled={isNoSalePending || !noSaleReason.trim()}>
          {isNoSalePending ? t('pos.pos_workspace.pos_workspace_header.s57', "جاري فتح الدرج...") : t('pos.pos_workspace.pos_workspace_header.s58', "فتح الدرج")}
        </Button>
      </div>
    </DialogShell>
    <PosInstantExchangeDialog open={isExchangeOpen} onClose={() => setIsExchangeOpen(false)} pos={pos} />
    <PosDeliveryAggregatorsModal
      open={isAggregatorsOpen}
      onClose={() => setIsAggregatorsOpen(false)}
      onBack={() => { setIsAggregatorsOpen(false); setIsOpsModalOpen(true); }}
    />
    <RestaurantDeliveryDispatcherModal
      open={isDriverDispatchOpen}
      onClose={() => setIsDriverDispatchOpen(false)}
      onBack={() => { setIsDriverDispatchOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosFoodWasteModal
      open={isFoodWasteOpen}
      onClose={() => setIsFoodWasteOpen(false)}
      branchId={Number(pos.branchId) || 1}
      onBack={() => { setIsFoodWasteOpen(false); setIsOpsModalOpen(true); }}
    />
    <Pos86ItemsModal
      open={is86ModalOpen}
      onClose={() => setIs86ModalOpen(false)}
      products={(pos as any).productsQuery?.data || []}
      branchId={Number(pos.branchId) || undefined}
      onBack={() => { setIs86ModalOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosTipPoolModal
      open={isTipPoolOpen}
      onClose={() => setIsTipPoolOpen(false)}
      branchId={Number(pos.branchId) || undefined}
      currency={(pos as any).currency || t('pos.pos_workspace.pos_workspace_header.s59', "ج.م")}
      onBack={() => { setIsTipPoolOpen(false); setIsOpsModalOpen(true); }}
    />
    <KitchenDailyPrepSheetModal
      open={isPrepSheetOpen}
      onClose={() => setIsPrepSheetOpen(false)}
      branchId={Number(pos.branchId) || undefined}
      onBack={() => { setIsPrepSheetOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosPlateCostRadarModal
      open={isPlateRadarOpen}
      onClose={() => setIsPlateRadarOpen(false)}
      currency={(pos as any).currency || t('pos.pos_workspace.pos_workspace_header.s60', "ج.م")}
      onBack={() => { setIsPlateRadarOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosCustomerPunchCardModal
      open={isStampCardOpen}
      onClose={() => setIsStampCardOpen(false)}
      customerId={Number(pos.customerId) || 1}
      customerName={(pos as any).customerName || t('pos.pos_workspace.pos_workspace_header.s61', "العميل الحالي")}
      onBack={() => { setIsStampCardOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosDriveThruModal
      open={isDriveThruOpen}
      onClose={() => setIsDriveThruOpen(false)}
      branchId={Number(pos.branchId) || undefined}
      onBack={() => { setIsDriveThruOpen(false); setIsOpsModalOpen(true); }}
    />
    <PosSmartUpsellModal
      open={isUpsellModalOpen}
      onClose={() => setIsUpsellModalOpen(false)}
      recommendations={upsellRules}
      onBack={() => { setIsUpsellModalOpen(false); setIsOpsModalOpen(true); }}
      onAcceptUpsell={(product: any) => {
        if ((pos as any).addProduct) {
          (pos as any).addProduct(product);
        }
      }}
    />
    <PosRestaurantOperationsModal
      open={isOpsModalOpen}
      onClose={() => setIsOpsModalOpen(false)}
      isManager={isManager}
      count86={count86}
      cartLength={pos.cart.length}
      isPhoneOrdersActive={Boolean(isPhoneOrdersActive)}
      isRestaurantActive={Boolean(isRestaurantActive)}
      isStorefrontActive={Boolean(isStorefrontActive)}
      onOpenCombo={onOpenComboModal || (() => setIsComboMealModalOpen(true))}
      onOpenCupLabels={onPrintCupLabels}
      onOpenStampCard={() => setIsStampCardOpen(true)}
      onOpenDriveThru={() => setIsDriveThruOpen(true)}
      onOpenUpsell={async () => {
        try {
          const firstProductId = Number(pos.cart[0]?.productId) || undefined;
          const rules = await restaurantAdvancedFnbApi.getUpsellRecommendations(firstProductId);
          setUpsellRules(rules || []);
          setIsUpsellModalOpen(true);
        } catch {
          setIsUpsellModalOpen(true);
        }
      }}
      onOpen86={() => setIs86ModalOpen(true)}
      onOpenManagerComp={onOpenManagerComp || (() => setIsManagerCompOpen(true))}
      onOpenPlateRadar={() => setIsPlateRadarOpen(true)}
      onOpenPrepSheet={() => setIsPrepSheetOpen(true)}
      onOpenFoodWaste={() => setIsFoodWasteOpen(true)}
      onOpenTipPool={() => setIsTipPoolOpen(true)}
      onOpenAggregators={() => setIsAggregatorsOpen(true)}
      onOpenDriverDispatch={() => setIsDriverDispatchOpen(true)}
    />
    <PosDisplaysModal
      open={isDisplaysModalOpen}
      onClose={() => setIsDisplaysModalOpen(false)}
      isRestaurantActive={Boolean(isRestaurantActive)}
    />
    <PosManagerCompModal
      open={isManagerCompOpen}
      onClose={() => setIsManagerCompOpen(false)}
      onBack={() => {
        setIsManagerCompOpen(false);
        setIsOpsModalOpen(true);
      }}
      currentCartTotal={Number(pos.totals?.total || 0)}
      currentTableNumber={pos.tableNumber || undefined}
      cartSummary={pos.cart.map((i) => `${i.qty}× ${i.name}`).join(t('pos.pos_workspace.pos_workspace_header.s62', "، "))}
      onApplyComp={async (comp) => {
        pos.setDiscount(comp.amount);
        pos.setNote(`ضيافة إدارة [${comp.compType}] - معتمد: ${comp.managerName}${comp.notes ? ` - ${comp.notes}` : ''}`);
        setIsManagerCompOpen(false);
      }}
    />
    <PosComboMealModal
      open={isComboMealModalOpen}
      onClose={() => setIsComboMealModalOpen(false)}
      onBack={() => {
        setIsComboMealModalOpen(false);
        setIsOpsModalOpen(true);
      }}
      products={(pos as any).productsQuery?.data || []}
      onAddComboToCart={(combo) => {
        const product = ((pos as any).productsQuery?.data || []).find((p: any) => p.id === combo.productId);
        if (!product) return;
        const comboLineId = `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const comboOptions = {
          priceType: pos.priceType,
          digits: currencyMoneyDigits(settings?.currency || getGlobalSystemCurrency()),
          allowNegativeStockSales: isNegativeStockSalesAllowed(settings) || Boolean((product as any).hasBom),
          comboLineId,
        };
        // Synchronous pre-flight on the current cart: a failed add (out of
        // stock) surfaces here and leaves the cart untouched, instead of
        // stamping the combo onto whatever line happens to be last.
        try {
          applyComboToCart(pos.cart, product, combo, comboOptions);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'تعذّر إضافة الوجبة إلى السلة.');
          return;
        }
        const comboLineKey = buildComboLineKey(product, pos.priceType, comboLineId);
        pos.setCart((prevCart) => {
          try {
            return applyComboToCart(prevCart, product, combo, comboOptions).cart;
          } catch {
            return prevCart;
          }
        });
        pos.setSelectedLineKey(comboLineKey);
        pos.setLastAddedLineKey(comboLineKey);
        toast.success(`تمت إضافة ${combo.productName} إلى السلة بنجاح`);
      }}
    />
    <PosCustomizationDialog
      isOpen={isCustomizationOpen}
      onClose={() => setIsCustomizationOpen(false)}
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
    && prev.posMode === next.posMode
    && prev.onFocusSearch === next.onFocusSearch
    && prev.onOpenNewProduct === next.onOpenNewProduct
    && prev.onOpenQuickService === next.onOpenQuickService
    && prev.onOpenHeldDrafts === next.onOpenHeldDrafts
    && prev.onModeChange === next.onModeChange
    && prev.onPrintDraft === next.onPrintDraft;
}

export const PosWorkspaceHeader = memo(PosWorkspaceHeaderComponent, areEqual);
