import { useTranslation } from 'react-i18next';
import React, { useEffect, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { XIcon, AlertTriangleIcon, SlidersIcon, QrCodeIcon, CalendarIcon, PrinterIcon, BellIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { settingsApi } from '@/features/settings/api/settings.api';
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s1', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s1', "خريطة الصالة وإدارة الطاولات والطلبات"))}
              </h3>
              {currentTableNumber && (
                <span
                  style={{
                    fontSize: '11.5px',
                    background: currentCartItemsCount > 0 ? '#eff6ff' : '#f8fafc',
                    color: currentCartItemsCount > 0 ? '#170e5e' : '#475569',
                    border: currentCartItemsCount > 0 ? '1.5px solid #bfdbfe' : '1px solid #cbd5e1',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s2', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s2', "الطاولة الحالية بالسلة:"))} {currentTableNumber}</span>
                  {currentCartItemsCount > 0 && (
                    <span
                      style={{
                        background: '#170e5e',
                        color: '#ffffff',
                        borderRadius: '4px',
                        padding: '1px 6px',
                        fontSize: '10.5px',
                        fontWeight: 900,
                      }}
                    >
                      {formatCurrency(currentCartTotal)} ({currentCartItemsCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s3', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s3', "صنف بالسلة)"))}
                    </span>
                  )}
                </span>
              )}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s4', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s4', "إدارة شاملة لطاولات الصالة وجلسات الطعام والطلبات المعلقة والتيك أواي"))}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '6px',
              borderRadius: '6px',
            }}
            title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s5', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s5', "إغلاق"))}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* View Tabs Switcher */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('floor')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: activeTab === 'floor' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: activeTab === 'floor' ? '#170e5e' : '#ffffff',
              color: activeTab === 'floor' ? '#ffffff' : '#334155',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s6', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s6', "خريطة الصالة والطاولات"))}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: activeTab === 'list' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: activeTab === 'list' ? '#170e5e' : '#ffffff',
              color: activeTab === 'list' ? '#ffffff' : '#334155',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s7', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s7', "قائمة الطلبات المعلقة والتيك أواي"))}</span>
            <span
              style={{
                background: activeTab === 'list' ? '#ffffff' : '#f1f5f9',
                color: activeTab === 'list' ? '#170e5e' : '#475569',
                fontSize: '11px',
                padding: '1px 7px',
                borderRadius: '999px',
                fontWeight: 900,
              }}
            >
              {heldDrafts.length}
            </span>
          </button>
        </div>

        {activeTab === 'floor' ? (
          <>
            {/* Stats and Quick Info Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#166534', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s8', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s8', "طاولات شاغرة:"))} <strong>{availableCount}</strong></span>
                </div>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#991b1b', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s9', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s9', "طاولات مشغولة:"))} <strong>{occupiedCount}</strong> ({formatCurrency(totalOccupiedMoney)})</span>
                </div>
                {qrOrdersMap.size > 0 && (
                  <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#7e22ce', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9333ea', display: 'inline-block' }} />
                    <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s10', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s10', "طلبات QR نشطة:"))} <strong>{qrOrdersMap.size}</strong></span>
                  </div>
                )}
                {pendingCalls.length > 0 && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#92400e', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <BellIcon size={14} color="#b45309" />
                    <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s11', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s11', "نداءات واستدعاءات نشطة:"))} <strong>{pendingCalls.length}</strong></span>
                  </div>
                )}
                {nonTableDrafts.length > 0 && (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', color: '#1e40af', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
                    <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s12', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s12', "تيك أواي معلق:"))} <strong>{nonTableDrafts.length}</strong></span>
                  </div>
                )}
              </div>

              {/* Action Buttons: Custom Table Count, QR Print, & Transfer Table */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setIsQrPrintOpen(true)}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '5px 10px',
                    fontSize: '11.5px',
                    color: '#170e5e',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                  }}
                  title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s13', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s13', "طباعة وتجهيز ستيكرات وستاندات كروت الـ QR لطاولات الصالة"))}
                >
                  <QrCodeIcon size={14} color="#170e5e" />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s14', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s14', "طباعة كروت الـ QR"))}</span>
                </button>
                {isEditingCount ? (
                  <form onSubmit={handleSaveTablesCount} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f8fafc', border: '1.5px solid #170e5e', borderRadius: '8px', padding: '3px 8px' }}>
                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s15', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s15', "عدد الطاولات:"))}</span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      autoFocus
                      value={newTablesCount}
                      onChange={(e) => setNewTablesCount(Number(e.target.value || 1))}
                      disabled={isSavingCount}
                      style={{ width: '55px', height: '28px', textAlign: 'center', fontWeight: 800, fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                    <Button type="submit" variant="primary" style={{ minHeight: '28px', height: '28px', padding: '0 8px', fontSize: '11px', borderRadius: '4px' }} disabled={isSavingCount}>
                      {isSavingCount ? '...' : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s16', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s16', "حفظ"))}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setIsEditingCount(false)} style={{ minHeight: '28px', height: '28px', padding: '0 8px', fontSize: '11px', borderRadius: '4px' }}>
                      {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s17', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s17', "إلغاء"))}
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNewTablesCount(tablesCount); setIsEditingCount(true); }}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '5px 10px',
                      fontSize: '11.5px',
                      color: '#334155',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease',
                    }}
                    title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s18', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s18', "تعديل عدد طاولات الصالة المعروضة"))}
                  >
                    <SlidersIcon size={13} color="#170e5e" />
                    <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s19', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s19', "تخصيص الصالة:"))} <strong>{tablesCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s20', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s20', "طاولة"))}</strong></span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsReservationsModalOpen(true)}
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '5px 12px',
                    fontSize: '11.5px',
                    color: '#1d4ed8',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                  }}
                  title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s21', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s21', "إدارة وتدفق حجوزات الطاولات والضيوف لليوم"))}
                >
                  <CalendarIcon size={13} color="#1d4ed8" />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s22', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s22', "حجوزات اليوم"))} {confirmedReservationsMap.size > 0 && <strong>({confirmedReservationsMap.size})</strong>}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsPrintersModalOpen(true)}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '5px 12px',
                    fontSize: '11.5px',
                    color: '#170e5e',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                  }}
                  title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s23', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s23', "توجيه بونات التحضير وطابعات المطبخ والبار الشبكية"))}
                >
                  <PrinterIcon size={13} color="#170e5e" />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s24', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s24', "طابعات المطبخ والبار"))}</span>
                </button>

                {/* INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): the transfer
                    toggle shows only when there is a live cart OR a held
                    draft to move — merely having a table number set moved
                    nothing, the real order stayed a held draft. */}
                {Boolean(
                  currentTableNumber &&
                  (currentCartItemsCount > 0 ||
                    heldDrafts.some((d) => String(d.tableNumber || '').trim() === String(currentTableNumber).trim())),
                ) && (
                  <button
                    type="button"
                    onClick={() => setIsTransferring(!isTransferring)}
                    style={{
                      background: isTransferring ? '#ea580c' : '#ffffff',
                      color: isTransferring ? '#ffffff' : '#ea580c',
                      border: '1px solid #fdba74',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {isTransferring ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s25', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s25', "إلغاء وضع النقل")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s26', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s26', "نقل الطلب إلى طاولة أخرى"))}
                  </button>
                )}

                {Boolean(currentTableNumber && currentCartItemsCount > 0) && (
                  <button
                    type="button"
                    onClick={() => handleOpenItemTransfer(currentTableNumber)}
                    style={{
                      background: '#ffffff',
                      color: '#170e5e',
                      border: '1.5px solid #170e5e',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s27', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s27', "نقل أصناف محددة"))}
                  </button>
                )}
              </div>
            </div>

            {isTransferring && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#c2410c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangleIcon size={14} color="#c2410c" />
                <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s28', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s28', "وضع النقل نشط: اضغط الآن على الطاولة الجديدة التي ترغب في نقل طلب الطاولة ("))}{currentTableNumber}{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s29', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s29', ") إليها."))}</span>
              </div>
            )}

            {/* Non-table / Takeaway Held Orders Quick Bar */}
            {nonTableDrafts.length > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} />
                  <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s30', 'طلبات تيك أواي / معلقة بدون طاولة')} ({nonTableDrafts.length}):</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {nonTableDrafts.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      disabled={pendingRecallId === d.id}
                      onClick={() => void handleRecall(d.id)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: '#0f172a',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s',
                      }}
                      title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s31', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s31', "استرجاع هذا الطلب للسلة فوراً"))}
                    >
                      <span>{d.label || __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s32', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s32', "طلب تيك أواي"))}</span>
                      <strong style={{ color: '#16a34a' }}>{formatCurrency(d.total)}</strong>
                      <span style={{ color: '#64748b' }}>({d.itemsCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s33', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s33', "صنف)"))}</span>
                      <span style={{ color: '#170e5e', fontWeight: 800 }}>
                        {pendingRecallId === d.id ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s34', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s34', "جارٍ الفتح...")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s35', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s35', "استرجاع"))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Multi-Zone Dining Tabs & View Mode Switcher */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', marginLeft: '4px' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s36', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s36', "أجنحة الصالة:"))}</span>
                <button
                  type="button"
                  onClick={() => setSelectedZone('all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    border: selectedZone === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                    background: selectedZone === 'all' ? '#170e5e' : '#fff',
                    color: selectedZone === 'all' ? '#fff' : '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s37', 'كافة الطاولات')} ({defaultTables.length})
                </button>
                {zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => setSelectedZone(z.zone_code)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      border: selectedZone === z.zone_code ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      background: selectedZone === z.zone_code ? '#170e5e' : '#fff',
                      color: selectedZone === z.zone_code ? '#fff' : '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {getZoneDisplayName(z)}
                  </button>
                ))}
              </div>

              {/* View Switcher: 2D Visual Floor Canvas vs Quick Grid */}
              <div style={{ display: 'flex', gap: '3px', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setFloorViewMode('canvas')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: 'none',
                    background: floorViewMode === 'canvas' ? '#170e5e' : 'transparent',
                    color: floorViewMode === 'canvas' ? '#ffffff' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s38', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s38', "مخطط الصالة 2D"))}
                </button>
                <button
                  type="button"
                  onClick={() => setFloorViewMode('grid')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: 'none',
                    background: floorViewMode === 'grid' ? '#170e5e' : 'transparent',
                    color: floorViewMode === 'grid' ? '#ffffff' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s39', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s39', "شبكة الطاولات"))}
                </button>
              </div>
            </div>

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
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))',
                gap: '10px',
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '4px',
              }}
            >
              {gridTables.map((tableNum) => {
                const occupied = occupiedMap.get(tableNum)?.[0];
                const duplicateDraftCount = (occupiedMap.get(tableNum) || []).length;
                const qrOrder = qrOrdersMap.get(tableNum);
                const kdsTicket = kdsTableMap.get(tableNum);
                const tableCalls = pendingCallsByTable.get(tableNum) || [];
                const hasActiveCall = tableCalls.length > 0;
                const isBillPaidCall = tableCalls.some((c) => c.call_type === 'bill_paid');
                const isBillCall = tableCalls.some((c) => c.call_type === 'bill');
                const isRescueCall = tableCalls.some((c) => c.call_type === 'rescue');
                const isCurrent = currentTableNumber === tableNum;
                const hasLiveCart = isCurrent && currentCartItemsCount > 0;

                let borderColor = '#e2e8f0';
                let bgColor = '#ffffff';
                let dotColor = '#10b981';

                if (isRescueCall) {
                  borderColor = '#e11d48';
                  bgColor = '#fff1f2';
                  dotColor = '#e11d48';
                } else if (hasActiveCall) {
                  borderColor = isBillPaidCall ? '#86efac' : isBillCall ? '#f87171' : '#fbbf24';
                  bgColor = isBillPaidCall ? '#f0fdf4' : isBillCall ? '#fef2f2' : '#fffbeb';
                  dotColor = isBillPaidCall ? '#16a34a' : isBillCall ? '#dc2626' : '#d97706';
                } else if (hasLiveCart) {
                  borderColor = '#170e5e';
                  bgColor = '#eff6ff';
                  dotColor = '#170e5e';
                } else if (occupied) {
                  borderColor = '#fecaca';
                  bgColor = '#ffffff';
                  dotColor = '#ef4444';
                } else if (qrOrder) {
                  borderColor = '#c084fc';
                  bgColor = '#faf5ff';
                  dotColor = '#9333ea';
                } else if (isCurrent) {
                  borderColor = '#94a3b8';
                  bgColor = '#f8fafc';
                  dotColor = '#10b981';
                }

                return (
                  <button
                    key={tableNum}
                    type="button"
                    disabled={Boolean(pendingRecallId) || isSubmittingTable}
                    onClick={() => void handleTableClick(tableNum)}
                    style={{
                      minHeight: kdsTicket ? '112px' : '98px',
                      height: 'auto',
                      borderRadius: '10px',
                      border: `${hasLiveCart ? '2.5px' : isCurrent || qrOrder ? '2px' : '1.5px'} solid ${borderColor}`,
                      background: bgColor,
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      boxShadow: hasLiveCart ? '0 2px 8px rgba(23, 14, 94, 0.12)' : qrOrder ? '0 2px 8px rgba(147, 51, 234, 0.12)' : '0 1px 3px rgba(0,0,0,0.03)',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                  >
                    {/* Table Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s40', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s40', "طاولة"))} {tableNum}</strong>
                      {hasLiveCart ? (
                        <span
                          style={{
                            fontSize: '9.5px',
                            background: '#170e5e',
                            color: '#ffffff',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 800,
                          }}
                        >
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s41', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s41', "نشطة"))}
                        </span>
                      ) : qrOrder && !occupied ? (
                        <span
                          style={{
                            fontSize: '9px',
                            background: '#9333ea',
                            color: '#ffffff',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 800,
                          }}
                        >
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s42', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s42', "طلب QR"))}
                        </span>
                      ) : confirmedReservationsMap.has(tableNum) && !occupied ? (
                        <span
                          style={{
                            fontSize: '9px',
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 800,
                          }}
                        >
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s43', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s43', "حجز"))}
                        </span>
                      ) : (
                        <span
                          style={{
                            width: '9px',
                            height: '9px',
                            borderRadius: '50%',
                            background: dotColor,
                            display: 'inline-block',
                          }}
                        />
                      )}
                    </div>

                    {/* Table Status / Money */}
                    {hasLiveCart ? (
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <div style={{ fontSize: '13px', fontWeight: 900, color: '#170e5e' }}>
                          {formatCurrency(currentCartTotal)}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#475569', marginTop: '1px' }}>
                          {currentCartItemsCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s44', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s44', "أصناف • بالسلة النشطة"))}
                        </div>
                      </div>
                    ) : occupied ? (
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <div style={{ fontSize: '13px', fontWeight: 900, color: '#dc2626' }}>
                          {formatCurrency(occupied.total)}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '1px' }}>
                          {occupied.itemsCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s45', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s45', "أصناف • معلقة"))}
                        </div>
                        {duplicateDraftCount > 1 && (
                          <div style={{ fontSize: '9.5px', color: '#b45309', fontWeight: 800, marginTop: '2px', background: '#fef3c7', borderRadius: '4px', padding: '1px 5px' }}>
                            {duplicateDraftCount} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', "طلبات محفوظة على هذه الطاولة"))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenItemTransfer(tableNum);
                          }}
                          style={{
                            marginTop: '3px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            background: '#f8fafc',
                            color: '#170e5e',
                            fontSize: '9.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s46', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s46', "نقل أصناف محددة من هذه الطاولة إلى طاولة أخرى"))}
                        >
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s47', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s47', "نقل أصناف"))}
                        </button>
                      </div>
                    ) : qrOrder ? (
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <div style={{ fontSize: '13px', fontWeight: 900, color: '#9333ea' }}>
                          {formatCurrency(qrOrder.totalAmount)}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#7e22ce', marginTop: '1px' }}>
                          {qrOrder.items?.length || 1} {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s48', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s48', "أصناف • طلب QR"))}
                        </div>
                      </div>
                    ) : confirmedReservationsMap.has(tableNum) ? (
                      <div style={{ textAlign: 'center', width: '100%' }}>
                        <div style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: 800 }}>
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s49', 'محجوزة')} ({new Date(confirmedReservationsMap.get(tableNum)!.reservation_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})
                        </div>
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                          {confirmedReservationsMap.get(tableNum)!.guest_name}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: isCurrent ? '#475569' : '#16a34a', fontWeight: 700 }}>
                        {isCurrent ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s50', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s50', "شاغرة (محددة)")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s51', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s51', "شاغرة (متاحة)"))}
                      </div>
                    )}

                    {/* Active Service Call Badge (Waiter / Bill / Rescue) */}
                    {hasActiveCall && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '4px',
                          width: '100%',
                          background: isRescueCall ? '#ffe4e6' : isBillPaidCall ? '#dcfce7' : isBillCall ? '#fee2e2' : '#fef3c7',
                          border: `1.5px solid ${isRescueCall ? '#f43f5e' : isBillPaidCall ? '#86efac' : isBillCall ? '#fca5a5' : '#fde68a'}`,
                          borderRadius: '6px',
                          padding: '2px 5px',
                          margin: '2px 0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            color: isRescueCall ? '#be123c' : isBillPaidCall ? '#15803d' : isBillCall ? '#991b1b' : '#92400e',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          {isRescueCall ? (
                            <AlertTriangleIcon size={10} color="#be123c" />
                          ) : (
                            <BellIcon size={10} color={isBillPaidCall ? '#15803d' : isBillCall ? '#991b1b' : '#92400e'} />
                          )}
                          <span>{isRescueCall ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s52', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s52', "إنقاذ ضيف (Rescue)!")) : isBillPaidCall ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s53', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s53', "مسدد إلكترونياً!")) : isBillCall ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s54', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s54', "طلب الحساب!")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s55', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s55', "استدعاء ويتر!"))}</span>
                        </span>
                        <button
                          type="button"
                          onClick={(e) => void handleResolveTableCalls(e, tableNum)}
                          style={{
                            fontSize: '8.5px',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: isRescueCall ? '#e11d48' : isBillPaidCall ? '#15803d' : isBillCall ? '#dc2626' : '#b45309',
                            color: '#ffffff',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s56', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s56', "تأكيد تلبية واستجابة النداء"))}
                        >
                          {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s57', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s57', "تم"))}
                        </button>
                      </div>
                    )}

                    {/* Active KDS Course & Fire Button */}
                    {kdsTicket && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          width: '100%',
                          margin: '2px 0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: kdsTicket.course === 'appetizer' ? '#fef3c7' : kdsTicket.course === 'main' ? '#dbeafe' : '#f3e8ff',
                            color: kdsTicket.course === 'appetizer' ? '#92400e' : kdsTicket.course === 'main' ? '#1e40af' : '#6b21a8',
                          }}
                        >
                          {kdsTicket.course === 'appetizer' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s58', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s58', "مقبلات")) : kdsTicket.course === 'main' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s59', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s59', "طبق رئيسي")) : kdsTicket.course === 'dessert' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s60', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s60', "حلوى")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s61', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s61', "مشروب"))}
                        </span>
                        {kdsTicket.course !== 'dessert' && (
                          <button
                            type="button"
                            disabled={firingTable === tableNum}
                            onClick={(e) => void handleFireNextCourse(e, tableNum, kdsTicket)}
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#170e5e',
                              color: '#ffffff',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                            title={`إطلاق مسار ${kdsTicket.course === 'appetizer' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s62', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s62', "الأطباق الرئيسية")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s63', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s63', "الحلويات"))} للمطبخ فوراً`}
                          >
                            {firingTable === tableNum ? '...' : `إطلاق ${kdsTicket.course === 'appetizer' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s64', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s64', "الرئيسي")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s65', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s65', "الحلوى"))}`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Guest Check Delivered Badge & Print Button */}
                    {(hasLiveCart || occupied) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '2px 0', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {Boolean(occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted)) && (
                          <span
                            style={{
                              fontSize: '8.5px',
                              background: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 800,
                            }}
                          >
                            {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s66', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s66', "تم تسليم الشيك"))}
                          </span>
                        )}
                        {onPrintGuestCheck && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onPrintGuestCheck(tableNum, occupied?.id);
                            }}
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: Boolean(occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted)) ? '#fff7ed' : '#f1f5f9',
                              color: Boolean(occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted)) ? '#c2410c' : '#170e5e',
                              border: Boolean(occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted)) ? '1px solid #fed7aa' : '1px solid #cbd5e1',
                              cursor: 'pointer',
                            }}
                            title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s67', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s67', "طباعة شيك حساب الطاولة غير المسدد للزبون"))}
                          >
                            {Boolean(occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted)) ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s68', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s68', "إعادة طباعة الشيك")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s69', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s69', "طباعة شيك"))}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Action Hint */}
                    <div
                      style={{
                        fontSize: '10px',
                        color: hasLiveCart ? '#170e5e' : occupied ? '#b91c1c' : qrOrder ? '#7e22ce' : '#64748b',
                        fontWeight: hasLiveCart || qrOrder ? 800 : 500,
                      }}
                    >
                      {hasLiveCart
                        ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s70', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s70', "العودة للطلب ↵"))
                        : occupied
                        ? pendingRecallId === occupied.id
                          ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s71', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s71', "جاري الفتح..."))
                          : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s72', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s72', "فتح الشيك"))
                        : qrOrder
                        ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s73', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s73', "استدعاء للطلب ↵"))
                        : isSubmittingTable
                        ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s74', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s74', "جارٍ الفتح..."))
                        : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s75', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s75', "بدء طلب +"))}
                    </div>
                  </button>
                );
              })}
            </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Keyboard Hints Bar */}
            <div style={{
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              background: '#f8fafc',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '0.78rem',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              flexWrap: 'wrap',
            }}>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>↑ ↓</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s80', "للتنقل"))}</span>
              <span>•</span>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Enter</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s81', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s81', "للاسترجاع"))}</span>
              <span>•</span>
              <span><kbd style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>Del</kbd> {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s82', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s82', "للحذف"))}</span>
              <span style={{ marginInlineStart: 'auto', color: '#94a3b8' }}>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s83', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s83', "أو انقر نقراً مزدوجاً بالماوس"))}</span>
            </div>

            {/* Drafts List */}
            {heldDrafts.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto', padding: '2px' }}>
                {heldDrafts.map((draft, idx) => {
                  const isSelected = selectedIndex === idx;
                  const isPending = pendingRecallId === draft.id;

                  return (
                    <div
                      key={draft.id}
                      onClick={() => setSelectedIndex(idx)}
                      onDoubleClick={() => void handleRecall(draft.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '14px',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#f8fafc' : '#ffffff',
                        boxShadow: isSelected ? '0 2px 8px rgba(15,23,42,0.06)' : 'none',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Left: Draft Info & Badges */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isSelected ? '#170e5e' : '#94a3b8' }}>
                            #{idx + 1}
                          </span>
                          <strong style={{ fontSize: '0.92rem', color: '#0f172a', fontWeight: 700 }}>
                            {draft.label || __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s84', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s84', "عميل نقدي"))}
                          </strong>
                          <span style={{
                            background: draft.tableNumber ? '#f0fdf4' : '#eff6ff',
                            color: draft.tableNumber ? '#166534' : '#1e40af',
                            border: draft.tableNumber ? '1px solid #bbf7d0' : '1px solid #bfdbfe',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}>
                            {draft.tableNumber ? `طاولة: ${draft.tableNumber}` : draft.orderType === 'delivery' ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s85', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s85', "دليفري")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s86', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s86', "تيك أواي"))}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>{draft.itemsCount} {draft.itemsCount === 1 ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s87', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s87', "صنف")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s88', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s88', "أصناف"))}</span>
                          <span>•</span>
                          <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s89', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s89', "الإجمالي:"))} <strong style={{ color: '#0f172a', fontWeight: 800 }}>{formatCurrency(draft.total)}</strong></span>
                        </div>
                      </div>

                      {/* Right: Action Buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRecall(draft.id);
                          }}
                          style={{
                            background: '#170e5e',
                            borderColor: '#170e5e',
                            color: '#ffffff',
                            fontWeight: 700,
                            minHeight: '30px',
                            padding: '0 14px',
                            fontSize: '12px',
                          }}
                        >
                          {isPending ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s90', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s90', "جاري الاسترجاع...")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s91', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s91', "استرجاع"))}
                        </Button>
                        {onDeleteDraft && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteDraft(draft.id);
                            }}
                            style={{
                              minHeight: '30px',
                              padding: '0 10px',
                              fontSize: '12px',
                              color: '#dc2626',
                              borderColor: '#fca5a5',
                            }}
                          >
                            {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s92', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s92', "حذف"))}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #e2e8f0' }}>
                <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b', fontWeight: 600 }}>
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s93', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s93', "لا توجد طلبات معلقة حالياً."))}
                </p>
              </div>
            )}

            {/* List Tab Footer Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
              {onClearAllDrafts && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { void onClearAllDrafts(); }}
                  disabled={!heldDrafts.length}
                  style={{
                    color: heldDrafts.length ? '#dc2626' : '#94a3b8',
                    borderColor: heldDrafts.length ? '#fca5a5' : '#e2e8f0',
                    fontSize: '12px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s94', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s94', "حذف الكل"))}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} style={{ padding: '6px 16px', fontSize: '12.5px' }}>
                {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s95', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s95', "إغلاق"))}
              </Button>
            </div>
          </div>
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

