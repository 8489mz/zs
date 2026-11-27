import { useTranslation } from 'react-i18next';
import React, { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { settingsApi } from '@/shared/api/settings.api';
import {
  storefrontApi,
  loadOnlineOrderIntoPosCart,
  type OnlineOrderRecord,
} from '@/features/storefront';
import { kdsApi, type KdsTicket } from '@/features/pos/api/kds.api';
import { tableReservationsApi, type TableReservation } from '@/features/pos/api/table-reservations.api';
import { tableCallsApi, type TableServiceCall } from '@/features/pos/api/table-calls.api';
import { PosTableReservationsModal } from './PosTableReservationsModal';
import { TableQrPrintDialog } from './TableQrPrintDialog';
import { PosKitchenPrintersModal } from './PosKitchenPrintersModal';
import { PosTransferItemModal, type TransferableCartItem } from './PosTransferItemModal';
import { PosVisualFloorCanvas } from './PosVisualFloorCanvas';
import { buildFloorState } from '@/features/pos/lib/pos-floor-state';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import type { AppSettings } from '@/types/domain';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';
import { PosTablesDialogHeader } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosTablesDialogHeader';
import { PosTablesTabBar } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosTablesTabBar';
import { PosFloorStatsBar } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosFloorStatsBar';
import { PosFloorZoneBar } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosFloorZoneBar';
import { PosTablesGrid } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosTablesGrid';
import { PosTablesListView } from '@/features/pos/components/pos-workspace/pos-tables-floor-plan/PosTablesListView';

interface PosTablesFloorPlanDialogProps {
  open: boolean;
  onClose: () => void;
  currentTableNumber: string;
  currentCartItemsCount?: number;
  currentCartTotal?: number;
  heldDrafts: HeldPosDraftSummary[];
  rawHeldDrafts?: any[];
  currentCartItems?: any[];
  settings?: AppSettings | null;
  onSelectTable: (tableNumber: string) => Promise<void> | void;
  onRecallDraft: (draftId: string) => Promise<void>;
  onDeleteDraft?: (draftId: string) => Promise<void>;
  onClearAllDrafts?: () => Promise<void>;
  onTransferTable?: (fromTable: string, toTable: string) => void | Promise<void>;
  onMergeTable?: (fromTable: string, toTable: string) => void;
  onTransferItems?: (sourceTable: string, targetTable: string, items: TransferableCartItem[]) => Promise<void> | void;
  initialTab?: 'floor' | 'list';
  isCurrentCheckPrinted?: boolean;
  onPrintGuestCheck?: (tableNumber: string, draftId?: string) => Promise<void> | void;
  onSeatReservation?: (tableNumber: string, guestCount: number, guestName?: string) => Promise<void> | void;
}

export function PosTablesFloorPlanDialog({
  open,
  onClose,
  currentTableNumber,
  currentCartItemsCount = 0,
  currentCartTotal = 0,
  heldDrafts,
  rawHeldDrafts = [],
  currentCartItems = [],
  settings,
  onSelectTable,
  onRecallDraft,
  onDeleteDraft,
  onClearAllDrafts,
  onTransferTable,
  onMergeTable,
  onTransferItems,
  initialTab = 'floor',
  isCurrentCheckPrinted = false,
  onPrintGuestCheck,
  onSeatReservation,
}: PosTablesFloorPlanDialogProps) {
  const { t: __t } = useTranslation();
  const queryClient = useQueryClient();
  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I37): design mode is manager-only
  // — same manager definition R3-E used (admin role OR pos_manager /
  // manage_restaurant permission). The server save enforces it too.
  const currentUser = useAuthStore((state: any) => state.user);
  const isManager = isAdminUser(currentUser) || currentUser?.permissions?.includes('pos_manager') || currentUser?.permissions?.includes('manage_restaurant');
  const [activeTab, setActiveTab] = useState<'floor' | 'list'>(initialTab);
  const [floorViewMode, setFloorViewMode] = useState<'canvas' | 'grid'>('canvas');
  const [customInput, setCustomInput] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [pendingRecallId, setPendingRecallId] = useState('');
  const [isSubmittingTable, setIsSubmittingTable] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isQrPrintOpen, setIsQrPrintOpen] = useState(false);
  const [isReservationsModalOpen, setIsReservationsModalOpen] = useState(false);
  const [isPrintersModalOpen, setIsPrintersModalOpen] = useState(false);

  // Item-level Transfer States
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferSourceTable, setTransferSourceTable] = useState('');
  const [transferSourceItems, setTransferSourceItems] = useState<TransferableCartItem[]>([]);

  const handleOpenItemTransfer = (tableNum: string) => {
    // R-I34: pass the cart / draft items through UNCHANGED — the old code
    // re-mapped them field by field and dropped lineKey / unitId /
    // seatNumber / course / serials / originalPrice at the source, so the
    // transfer target received lines with no identity.
    let itemsToTransfer: TransferableCartItem[] = [];
    if (tableNum === currentTableNumber && currentCartItems && currentCartItems.length > 0) {
      itemsToTransfer = currentCartItems.map((item: any) => ({ ...item }));
    } else if (rawHeldDrafts && rawHeldDrafts.length > 0) {
      const draft = rawHeldDrafts.find((d: any) => String(d.tableNumber).trim() === String(tableNum).trim());
      if (draft && draft.cart) {
        itemsToTransfer = draft.cart.map((item: any) => ({ ...item }));
      }
    }
    setTransferSourceTable(tableNum);
    setTransferSourceItems(itemsToTransfer);
    setTransferModalOpen(true);
  };

  // Dynamic tables count from settings
  const configuredTablesCount = Math.max(1, Number(settings?.restaurantTablesCount || 12));
  const [tablesCount, setTablesCount] = useState(configuredTablesCount);
  const [isEditingCount, setIsEditingCount] = useState(false);
  const [newTablesCount, setNewTablesCount] = useState(configuredTablesCount);
  const [isSavingCount, setIsSavingCount] = useState(false);

  // Multi-Zone Floor Plan (Dining Sections: Main, Patio, Family, VIP)
  const activeBranch = (settings as any)?.activeBranchId || (settings as any)?.branchId;
  const { data: zones = [] } = useQuery({
    queryKey: ['restaurant-floor-zones', activeBranch],
    queryFn: () => restaurantAdvancedFnbApi.getZones(activeBranch ? Number(activeBranch) : undefined),
    enabled: open,
  });
  const [selectedZone, setSelectedZone] = useState<string>('all');

  // Today's Table Reservations — INV-REST-FLOOR-STATE-TRUTH (R5-D,
  // R-I38): the tenant-local date, never the UTC slice. toISOString()
  // between 00:00-02:00 EET returns the previous day, so the floor
  // fetched yesterday's reservations. Same local-parts pattern as
  // todayLocalIsoDate() in pos.domain.ts.
  const todayStr = (() => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  })();
  const { data: todayReservations = [] } = useQuery({
    queryKey: ['table-reservations-floor', todayStr],
    queryFn: () => tableReservationsApi.listReservations({ date: todayStr }),
    enabled: open,
    refetchInterval: 15_000,
  });

  const confirmedReservationsMap = new Map<string, TableReservation>();
  for (const r of todayReservations) {
    if (r.status === 'confirmed' && r.table_number) {
      confirmedReservationsMap.set(String(r.table_number).trim(), r);
    }
  }

  // Real-time pending storefront / QR dine-in orders
  const { data: onlineOrdersData } = useQuery({
    queryKey: ['pos-floor-qr-orders'],
    queryFn: () => storefrontApi.listOrders('pending'),
    enabled: open,
    refetchInterval: 8_000,
  });
  const onlineOrders = onlineOrdersData?.orders || [];


  // Real-time KDS tickets to show active course badges and enable Course Firing
  const { data: kdsData, refetch: refetchKds } = useQuery({
    queryKey: ['pos-floor-kds-tickets'],
    queryFn: () => kdsApi.getTickets({ orderType: 'dine_in' }),
    enabled: open,
    refetchInterval: 8_000,
  });
  const kdsTickets = kdsData?.tickets || [];
  const kdsTableMap = new Map<string, KdsTicket>();
  for (const t of kdsTickets) {
    if (t.tableNumber && String(t.tableNumber).trim()) {
      kdsTableMap.set(String(t.tableNumber).trim(), t);
    }
  }

  const [firingTable, setFiringTable] = useState<string | null>(null);

  const handleFireNextCourse = async (e: React.MouseEvent, tableNum: string, ticket: KdsTicket) => {
    e.stopPropagation();
    setFiringTable(tableNum);
    try {
      const nextCourse = ticket.course === 'appetizer' ? 'main' : 'dessert';
      await kdsApi.fireCourse(ticket.id, nextCourse);
      const courseLabel = nextCourse === 'main' ? 'الأطباق الرئيسية' : 'الحلويات والمشروبات';
      toast.success(`تم إطلاق مسار [${courseLabel}] للمطبخ للطاولة ${tableNum}`);
      await refetchKds();
    } catch {
      toast.error('تعذر إطلاق المسار للمطبخ');
    } finally {
      setFiringTable(null);
    }
  };

  // Real-time pending table service calls (Waiters & Bill requests)
  const { data: pendingCalls = [], refetch: refetchCalls } = useQuery({
    queryKey: ['pos-floor-table-calls'],
    queryFn: () => tableCallsApi.listPendingCalls(),
    enabled: open,
    refetchInterval: 6_000,
  });

  const pendingCallsByTable = new Map<string, TableServiceCall[]>();
  for (const call of pendingCalls) {
    const tNum = String(call.table_number).trim();
    if (!pendingCallsByTable.has(tNum)) {
      pendingCallsByTable.set(tNum, []);
    }
    pendingCallsByTable.get(tNum)!.push(call);
  }

  const handleResolveTableCalls = async (e: React.MouseEvent, tableNum: string) => {
    e.stopPropagation();
    try {
      await tableCallsApi.resolveCallsForTable(tableNum);
      toast.success(`تم تأكيد تلبية نداء الطاولة ${tableNum}`);
      await refetchCalls();
    } catch {
      toast.error('تعذر تحديث حالة النداء');
    }
  };

  useEffect(() => {
    setTablesCount(configuredTablesCount);
    setNewTablesCount(configuredTablesCount);
  }, [configuredTablesCount]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setIsTransferring(false);
      setIsSubmittingTable(false);
      setIsEditingCount(false);
      setCustomInput('');
      setSelectedIndex((curr) => {
        if (!heldDrafts.length) return 0;
        return Math.min(curr, heldDrafts.length - 1);
      });
    }
  }, [open, initialTab, heldDrafts.length]);

  // Dynamic table array based on configured count
  const defaultTables = Array.from({ length: tablesCount }, (_, i) => String(i + 1));

  const getZoneDisplayName = (z: { zone_code?: string; name: string }) => {
    const code = (z.zone_code || '').toLowerCase().trim();
    const rawName = (z.name || '').trim();
    if (code === 'main' || rawName === 'الصالة الرئيسية') {
      return __t('pos.zones.main', 'الصالة الرئيسية');
    }
    if (code === 'patio' || rawName === 'التراس الخارجي') {
      return __t('pos.zones.patio', 'التراس الخارجي');
    }
    if (code === 'family' || rawName === 'قسم العائلات') {
      return __t('pos.zones.family', 'قسم العائلات');
    }
    if (code === 'vip' || rawName === 'جناح الـ VIP' || rawName === 'جناح VIP') {
      return __t('pos.zones.vip', 'جناح الـ VIP');
    }
    return z.name;
  };

  const activeZone = zones.find((z) => z.zone_code === selectedZone);
  const zoneTableSet: Set<string> | null = activeZone && activeZone.table_numbers
    ? new Set(
        (Array.isArray(activeZone.table_numbers)
          ? activeZone.table_numbers
          : typeof activeZone.table_numbers === 'string'
          ? (() => {
              try { return JSON.parse(activeZone.table_numbers); } catch { return []; }
            })()
          : []
        ).map((n: any) => String(n).trim())
      )
    : null;

  const displayedTables = defaultTables.filter((t) => {
    if (selectedZone === 'all' || !zoneTableSet || zoneTableSet.size === 0) return true;
    return zoneTableSet.has(String(t).trim());
  });


  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I36): occupiedMap keeps ALL
  // drafts per table (a list, never silently overwritten — a second
  // draft on one table used to vanish from the floor). The single
  // floor-state derivation below is what the grid, the canvas and the
  // stats all render from: one source, so no view can disagree with
  // another about money, counts or occupancy.
  const occupiedMap = new Map<string, HeldPosDraftSummary[]>();
  const nonTableDrafts: HeldPosDraftSummary[] = [];

  for (const draft of heldDrafts) {
    if (draft.tableNumber && String(draft.tableNumber).trim()) {
      const key = String(draft.tableNumber).trim();
      const existing = occupiedMap.get(key);
      if (existing) existing.push(draft);
      else occupiedMap.set(key, [draft]);
    } else {
      nonTableDrafts.push(draft);
    }
  }

  // Map pending QR orders by table number (excluding tables already in occupiedMap)
  const qrOrdersMap = new Map<string, OnlineOrderRecord>();
  for (const order of onlineOrders) {
    if (order.tableNumber && String(order.tableNumber).trim()) {
      const tNum = String(order.tableNumber).trim();
      if (!qrOrdersMap.has(tNum)) {
        qrOrdersMap.set(tNum, order);
      }
    }
  }

  // Single floor-state derivation (R-I36): the grid, the canvas and the
  // stats below all read this. QR money on a draft table is counted
  // once (never lost, never doubled); a KDS ticket alone is a display
  // badge, not occupancy; a reservation alone is reserved, not occupied.
  const floorState = buildFloorState({
    drafts: heldDrafts,
    qrOrders: onlineOrders.map((order) => ({
      ...order,
      tableNumber: order.tableNumber == null ? undefined : String(order.tableNumber),
    })),
    kdsTickets,
    liveCart:
      currentTableNumber && currentCartItemsCount > 0
        ? { tableNumber: currentTableNumber, total: Number(currentCartTotal || 0), itemsCount: currentCartItemsCount }
        : null,
    reservations: todayReservations,
    tablesCount,
  });
  const occupiedCount = floorState.occupiedCount;
  const totalOccupiedMoney = floorState.totalOccupiedMoney;
  const availableCount = floorState.availableCount;
  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I38): custom tables (a draft
  // whose number is not in 1..N, e.g. "VIP 2") render as extra tiles on
  // the floor — zero schema change. They show under "all" zones, or
  // under a zone that lists them by name.
  const customTableTiles = floorState.customTables
    .map((t) => t.tableNumber)
    .filter((t) => !displayedTables.includes(t))
    .filter((t) => selectedZone === 'all' || !zoneTableSet || zoneTableSet.size === 0 || zoneTableSet.has(String(t).trim()));
  const gridTables = [...displayedTables, ...customTableTiles];

  const handleRecall = useCallback(async (draftId: string) => {
    setPendingRecallId(draftId);
    try {
      await onRecallDraft(draftId);
      onClose();
    } finally {
      setPendingRecallId('');
    }
  }, [onRecallDraft, onClose]);

  const handleTableClick = async (tableNum: string) => {
    if (isTransferring) {
      if (currentTableNumber && currentTableNumber !== tableNum) {
        // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): a target with only a
        // pending QR order is occupied too — renaming the live cart onto
        // it would put two orders on one table. Refuse with a named
        // message and stay in transfer mode; never merge silently.
        const qrTarget = qrOrdersMap.get(tableNum);
        if (qrTarget) {
          toast.error(`الطاولة ${tableNum} لديها طلب QR بقيمة ${formatCurrency(qrTarget.totalAmount || 0)} — لا يمكن نقل الطلب إليها. اختر طاولة أخرى.`);
          return;
        }
        const targetDrafts = occupiedMap.get(tableNum);
        const isTargetOccupied = Boolean(targetDrafts && targetDrafts.length > 0);
        if (isTargetOccupied && onMergeTable) {
          const firstDraft = targetDrafts![0];
          const confirmMerge = await systemConfirm({
            title: 'دمج طلب طاولة',
            message: `الطاولة ${tableNum} مشغولة بالفعل بطلب قيمته ${formatCurrency(firstDraft.total || 0)}${targetDrafts!.length > 1 ? ` (وهناك ${targetDrafts!.length} طلبات محفوظة على هذه الطاولة)` : ''}.\n\nهل ترغب في دمج طلب الطاولة ${currentTableNumber} مع هذه الطاولة؟`,
            confirmText: 'دمج الطلب',
            cancelText: 'إلغاء',
          });
          if (confirmMerge) {
            onMergeTable(currentTableNumber, tableNum);
            setIsTransferring(false);
            onClose();
            return;
          }
        } else if (onTransferTable) {
          /* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the transfer
           * handler invalidates the held-drafts query and awaits the
           * refetch — wait for it before closing, so the floor shows
           * the draft on its new table immediately instead of the
           * pre-transfer snapshot. */
          await onTransferTable(currentTableNumber, tableNum);
          setIsTransferring(false);
          onClose();
          return;
        }
      }
      setIsTransferring(false);
      return;
    }

    // If clicking the currently selected table that already has active cart items
    if (tableNum === currentTableNumber && currentCartItemsCount > 0) {
      onClose();
      return;
    }

    const occupiedDrafts = occupiedMap.get(tableNum);
    const occupiedDraft = occupiedDrafts?.[0];
    if (occupiedDraft) {
      await handleRecall(occupiedDraft.id);
      return;
    }

    const qrOrder = qrOrdersMap.get(tableNum);
    if (qrOrder) {
      setIsSubmittingTable(true);
      try {
        await loadOnlineOrderIntoPosCart(qrOrder.id);
        toast.success(`تم استدعاء طلب الـ QR للطاولة ${tableNum} بنجاح`);
        onClose();
      } catch (err: any) {
        toast.error(err?.message || 'تعذر استدعاء طلب الـ QR');
      } finally {
        setIsSubmittingTable(false);
      }
      return;
    }

    setIsSubmittingTable(true);
    try {
      await onSelectTable(tableNum);
      onClose();
    } finally {
      setIsSubmittingTable(false);
    }
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customInput.trim();
    if (!trimmed) return;

    if (trimmed === currentTableNumber && currentCartItemsCount > 0) {
      onClose();
      return;
    }

    // INV-REST-PAID-GATES-2 (R4-D, I42): a custom table number that
    // already has a held draft is refused — typing it used to bypass
    // the occupied check the floor map enforces, creating a second
    // draft on the same table. Tap the occupied table on the map to
    // recall its draft instead.
    const occupiedDrafts = occupiedMap.get(trimmed);
    const occupiedDraft = occupiedDrafts?.[0];
    if (occupiedDraft) {
      toast.error(`الطاولة ${trimmed} مشغولة بالفعل بطلب قيمته ${formatCurrency(occupiedDraft.total || 0)}. استدعِ الطلب المحفوظ من الخريطة أولًا.`);
      return;
    }

    // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I38): the same refusal for a
    // QR-occupied custom name — the old check consulted held drafts
    // only, so a second order could start on a QR table.
    const qrOccupied = qrOrdersMap.get(trimmed);
    if (qrOccupied) {
      toast.error(`الطاولة ${trimmed} لديها طلب QR بقيمة ${formatCurrency(qrOccupied.totalAmount || 0)} — استدعِ طلب الـ QR من الخريطة أولًا.`);
      return;
    }

    setIsSubmittingTable(true);
    try {
      await onSelectTable(trimmed);
      setCustomInput('');
      onClose();
    } finally {
      setIsSubmittingTable(false);
    }
  };

  const handleSaveTablesCount = async (e: React.FormEvent) => {
    e.preventDefault();
    const count = Math.min(200, Math.max(1, Math.round(Number(newTablesCount) || 24)));
    setIsSavingCount(true);
    try {
      await settingsApi.update({ restaurantTablesCount: count });
      setTablesCount(count);
      setIsEditingCount(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['posSettings'] }),
      ]);
      toast.success(`تم تحديث عدد طاولات الصالة إلى ${count} طاولة بنجاح`);
    } catch {
      toast.error('تعذر حفظ عدد الطاولات الجديد، يرجى المحاولة مرة أخرى');
    } finally {
      setIsSavingCount(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
      if (isTypingTarget) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (activeTab === 'list' && heldDrafts.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelectedIndex((curr) => Math.min(curr + 1, heldDrafts.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedIndex((curr) => Math.max(curr - 1, 0));
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const draft = heldDrafts[selectedIndex];
          if (draft) void handleRecall(draft.id);
          return;
        }
        if (event.key === 'Delete' && onDeleteDraft) {
          event.preventDefault();
          const draft = heldDrafts[selectedIndex];
          if (draft) void onDeleteDraft(draft.id);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, activeTab, heldDrafts, selectedIndex, handleRecall, onDeleteDraft, onClose]);

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      ariaLabel={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s0', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s0', "خريطة الصالة وإدارة الطاولات والطلبات المعلقة"))}
      width="880px"
      zIndex={87}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '18px 22px' }} dir="rtl">
        {/* Header Bar */}
        <PosTablesDialogHeader
          currentTableNumber={currentTableNumber}
          currentCartItemsCount={currentCartItemsCount}
          currentCartTotal={currentCartTotal}
          onClose={onClose}
        />

        {/* View Tabs Switcher */}
        <PosTablesTabBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          heldDrafts={heldDrafts}
        />

        {activeTab === 'floor' ? (
          <>
            {/* Stats and Quick Info Bar */}
            <PosFloorStatsBar
              availableCount={availableCount}
              occupiedCount={occupiedCount}
              totalOccupiedMoney={totalOccupiedMoney}
              qrOrdersMap={qrOrdersMap}
              pendingCalls={pendingCalls}
              nonTableDrafts={nonTableDrafts}
              setIsQrPrintOpen={setIsQrPrintOpen}
              isEditingCount={isEditingCount}
              handleSaveTablesCount={handleSaveTablesCount}
              newTablesCount={newTablesCount}
              setNewTablesCount={setNewTablesCount}
              isSavingCount={isSavingCount}
              setIsEditingCount={setIsEditingCount}
              tablesCount={tablesCount}
              setIsReservationsModalOpen={setIsReservationsModalOpen}
              confirmedReservationsMap={confirmedReservationsMap}
              setIsPrintersModalOpen={setIsPrintersModalOpen}
              currentTableNumber={currentTableNumber}
              currentCartItemsCount={currentCartItemsCount}
              heldDrafts={heldDrafts}
              setIsTransferring={setIsTransferring}
              isTransferring={isTransferring}
              handleOpenItemTransfer={handleOpenItemTransfer}
              pendingRecallId={pendingRecallId}
              handleRecall={handleRecall}
            />

            {/* Multi-Zone Dining Tabs & View Mode Switcher */}
            <PosFloorZoneBar
              setSelectedZone={setSelectedZone}
              selectedZone={selectedZone}
              defaultTables={defaultTables}
              zones={zones}
              getZoneDisplayName={getZoneDisplayName}
              setFloorViewMode={setFloorViewMode}
              floorViewMode={floorViewMode}
            />

            {floorViewMode === 'canvas' ? (
              <PosVisualFloorCanvas
                branchId={activeBranch ? Number(activeBranch) : undefined}
                tablesCount={tablesCount}
                zones={zones}
                selectedZone={selectedZone}
                zoneTableSet={zoneTableSet}
                occupiedMap={occupiedMap}
                floorState={floorState.byTable}
                isManager={isManager}
                currentTableNumber={currentTableNumber}
                confirmedReservationsMap={confirmedReservationsMap}
                pendingCallsByTable={pendingCallsByTable}
                kdsTableMap={kdsTableMap}
                onSelectTable={(tNum) => void handleTableClick(tNum)}
                onRecallDraft={handleRecall}
                onResolveCalls={handleResolveTableCalls}
              />
            ) : (
              /* Tables Grid */
              <PosTablesGrid
                gridTables={gridTables}
                occupiedMap={occupiedMap}
                qrOrdersMap={qrOrdersMap}
                kdsTableMap={kdsTableMap}
                pendingCallsByTable={pendingCallsByTable}
                currentTableNumber={currentTableNumber}
                currentCartItemsCount={currentCartItemsCount}
                pendingRecallId={pendingRecallId}
                isSubmittingTable={isSubmittingTable}
                handleTableClick={handleTableClick}
                confirmedReservationsMap={confirmedReservationsMap}
                currentCartTotal={currentCartTotal}
                handleOpenItemTransfer={handleOpenItemTransfer}
                handleResolveTableCalls={handleResolveTableCalls}
                firingTable={firingTable}
                handleFireNextCourse={handleFireNextCourse}
                isCurrentCheckPrinted={isCurrentCheckPrinted}
                onPrintGuestCheck={onPrintGuestCheck}
              />
            )}

            {/* Footer: Custom table number input */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px', flexWrap: 'wrap', gap: '10px' }}>
              <form onSubmit={handleCustomSubmit} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#475569', fontWeight: 700 }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s76', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s76', "رقم طاولة أو مكان إضافي:"))}</span>
                <input
                  type="text"
                  placeholder={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s77', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s77', "مثال: VIP 2 أو ركن 5"))}
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  style={{ width: '130px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                />
                <Button variant="secondary" type="submit" style={{ padding: '6px 10px', fontSize: '12px' }}>
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s78', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s78', "اختيار"))}
                </Button>
              </form>

              <Button variant="secondary" onClick={onClose} style={{ padding: '6px 16px', fontSize: '12.5px' }}>
                {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s79', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s79', "إغلاق"))}
              </Button>
            </div>
          </>
        ) : (
          /* List View Tab */
          <PosTablesListView
            heldDrafts={heldDrafts}
            selectedIndex={selectedIndex}
            pendingRecallId={pendingRecallId}
            setSelectedIndex={setSelectedIndex}
            handleRecall={handleRecall}
            onDeleteDraft={onDeleteDraft}
            onClearAllDrafts={onClearAllDrafts}
            onClose={onClose}
          />
        )}

      </div>

      <TableQrPrintDialog
        open={isQrPrintOpen}
        onClose={() => setIsQrPrintOpen(false)}
        defaultTablesCount={tablesCount}
      />

      <PosTableReservationsModal
        open={isReservationsModalOpen}
        onClose={() => setIsReservationsModalOpen(false)}
        tablesCount={tablesCount}
        onSeatGuest={async (res) => {
          setIsReservationsModalOpen(false);
          if (onSeatReservation) {
            await onSeatReservation(res.table_number, res.guest_count, res.guest_name);
          } else {
            await onSelectTable(res.table_number);
          }
        }}
      />

      <PosKitchenPrintersModal
        open={isPrintersModalOpen}
        onClose={() => setIsPrintersModalOpen(false)}
      />

      <PosTransferItemModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        sourceTable={transferSourceTable}
        sourceItems={transferSourceItems}
        allTables={defaultTables}
        occupiedTables={Array.from(occupiedMap.keys())}
        onConfirmTransfer={async (targetTable, transferredItems) => {
          if (onTransferItems) {
            await onTransferItems(transferSourceTable, targetTable, transferredItems);
            setTransferModalOpen(false);
          }
        }}
      />
    </DialogShell>
  );
}

