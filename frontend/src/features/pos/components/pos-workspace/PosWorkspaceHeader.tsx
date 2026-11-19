import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { PosWorkspaceHeaderCoreActions } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderCoreActions';
import { posApi } from '@/features/pos/api/pos.api';
import { storefrontApi } from '@/features/storefront/api/storefront.api';
import { PosWorkspaceHeaderModals } from './PosWorkspaceHeaderModals';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { playNotificationChime } from '@/lib/audio-chime';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useHasFeature } from '@/shared/hooks/use-permission';
import { toast } from '@/shared/components/system-alert';
import { printXReport } from '@/features/cash-drawer';
import { cashDrawerApi } from '@/lib/api/cash-drawer';

import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosSaleMode } from '@/features/pos/lib/pos-sale-mode';
import { dispatchPosChromeToggle, dispatchPosFullscreenToggle } from '@/features/pos/lib/pos-shell';
import { usePosOfflineSync } from '@/features/pos/hooks/usePosOfflineSync';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import {
  MaximizeIcon,
  MenuIcon,
  PrinterIcon,
  ChevronDownIcon,
  SlidersIcon,
  LockIcon,
} from '@/shared/components/icons/AppIcons';
import { HardwareBridgeClient } from '@/features/pos/lib/hardware-bridge-client';
import { PosWorkspaceHeaderBadge } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderBadge';
import { PosWorkspaceHeaderTableControls } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderTableControls';
import { PosWorkspaceHeaderHubButtons } from '@/features/pos/components/pos-workspace/pos-workspace-header/PosWorkspaceHeaderHubButtons';

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
    && prev.posMode === next.posMode
    && prev.onFocusSearch === next.onFocusSearch
    && prev.onOpenNewProduct === next.onOpenNewProduct
    && prev.onOpenQuickService === next.onOpenQuickService
    && prev.onOpenHeldDrafts === next.onOpenHeldDrafts
    && prev.onModeChange === next.onModeChange
    && prev.onPrintDraft === next.onPrintDraft;
}

export const PosWorkspaceHeader = memo(PosWorkspaceHeaderComponent, areEqual);
