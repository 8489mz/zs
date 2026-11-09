import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  restaurantAdvancedFnbApi,
  type TableLayout,
} from '@/features/pos/api/restaurant-advanced-fnb.api';
import { formatCurrency } from '@/lib/format';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import type { FloorTableState } from '@/features/pos/lib/pos-floor-state';
import {
  EditIcon,
  SaveIcon,
  PlusIcon,
  TrashIcon,
  RotateCcwIcon,
  BellIcon,
} from '@/shared/components/icons/AppIcons';
import type { TableReservation } from '@/features/pos/api/table-reservations.api';
import type { TableServiceCall } from '@/features/pos/api/table-calls.api';
import type { KdsTicket } from '@/features/pos/api/kds.api';

interface PosVisualFloorCanvasProps {
  branchId?: number;
  tablesCount: number;
  zones: any[];
  selectedZone: string;
  /** The dialog's zone.table_numbers set is the zone authority (R-I37). */
  zoneTableSet?: Set<string> | null;
  occupiedMap: Map<string, any>;
  /** The single floor-state derivation (R-I36) — grid and canvas render from it. */
  floorState?: Map<string, FloorTableState>;
  /** Design mode is manager-only (R-I37); the server save enforces it too. */
  isManager?: boolean;
  currentTableNumber: string;
  confirmedReservationsMap: Map<string, TableReservation>;
  pendingCallsByTable: Map<string, TableServiceCall[]>;
  kdsTableMap: Map<string, KdsTicket>;
  onSelectTable: (tableNumber: string) => void;
  onRecallDraft: (draftId: string) => void;
  onResolveCalls?: (e: React.MouseEvent, tableNumber: string) => void;
}

export function PosVisualFloorCanvas({
  branchId,
  tablesCount,
  zones: _zones,
  selectedZone,
  zoneTableSet,
  occupiedMap,
  floorState,
  isManager = false,
  currentTableNumber,
  confirmedReservationsMap,
  pendingCallsByTable,
  kdsTableMap: _kdsTableMap,
  onSelectTable,
  onRecallDraft,
  onResolveCalls,
}: PosVisualFloorCanvasProps) {
  const { t: __t } = useTranslation();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);

  // Designer Mode State
  const [isDesignMode, setIsDesignMode] = useState(false);
  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I37): snapshot of the server
  // layouts taken on entering design mode, so Cancel restores it.
  const [designSnapshot, setDesignSnapshot] = useState<TableLayout[] | null>(null);
  const isDesignModeRef = useRef(false);
  useEffect(() => {
    isDesignModeRef.current = isDesignMode;
  }, [isDesignMode]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Fetch table layouts from server
  const { data: serverLayouts } = useQuery({
    queryKey: ['restaurant-table-layouts', branchId],
    queryFn: () => restaurantAdvancedFnbApi.getTableLayouts(branchId),
    staleTime: 30_000,
  });

  // Local working copy of table layouts
  const [layouts, setLayouts] = useState<TableLayout[]>([]);

  // Initialize or generate default grid layout when server layouts arrive or count changes
  useEffect(() => {
    // R-I37: while in design mode the layout effect must not regenerate
    // over unsaved work (it used to overwrite deletes/moves on remount).
    if (isDesignModeRef.current) return;
    // R5-D: wait for the query to resolve. The old `= []` default was a
    // fresh array on every render, so this effect re-ran — and re-set
    // layouts — forever while the data was still undefined.
    if (!serverLayouts) return;
    if (serverLayouts.length > 0) {
      setLayouts(serverLayouts);
    } else {
      // Auto-generate harmonious 2D initial layout for configured tables
      const initial: TableLayout[] = [];
      const cols = Math.min(Math.ceil(Math.sqrt(tablesCount)), 6);
      const cellW = 85 / cols;
      const cellH = 18;

      for (let i = 1; i <= tablesCount; i++) {
        const colIdx = (i - 1) % cols;
        const rowIdx = Math.floor((i - 1) / cols);
        const shape = i % 5 === 0 ? 'round' : i % 7 === 0 ? 'booth' : i % 3 === 0 ? 'rectangle' : 'square';
        const seats = shape === 'rectangle' ? 6 : shape === 'round' ? 4 : shape === 'booth' ? 4 : 4;

        initial.push({
          table_number: String(i),
          zone_code: 'main',
          shape,
          x_pos: 8 + colIdx * cellW,
          y_pos: 8 + rowIdx * cellH,
          width: shape === 'rectangle' ? 100 : 78,
          height: 78,
          seats,
          rotation: 0,
        });
      }
      setLayouts(initial);
    }
  }, [serverLayouts, tablesCount]);

  // Mutation to persist floor plan to server
  const saveMutation = useMutation({
    mutationFn: (newLayouts: TableLayout[]) =>
      restaurantAdvancedFnbApi.saveTableLayouts(newLayouts, branchId),
    onSuccess: () => {
      toast.success('تم حفظ تصميم وتوزيع طاولات الصالة بنجاح!');
      queryClient.invalidateQueries({ queryKey: ['restaurant-table-layouts', branchId] });
      setDesignSnapshot(null);
      setIsDesignMode(false);
    },
    onError: () => {
      toast.error('تعذر حفظ تصميم الصالة');
    },
  });

  // Filter layouts by selected zone — reconciled with the dialog
  // (R-I37): the dialog's zone.table_numbers set is the authority and
  // the canvas maps each layout's table_number through it; layouts keep
  // zone_code for storage only. An empty/absent set means "all".
  const visibleLayouts = layouts.filter((tbl) => {
    if (selectedZone === 'all') return true;
    if (!zoneTableSet || zoneTableSet.size === 0) return true;
    return zoneTableSet.has(String(tbl.table_number).trim());
  });

  // Custom tables (R-I38): drafts outside 1..N have no stored layout,
  // so they render as extra tiles along the bottom of the canvas.
  const customLayouts: TableLayout[] = [];
  if (floorState) {
    let customIdx = 0;
    for (const entry of floorState.values()) {
      if (!entry.isCustom) continue;
      if (layouts.some((l) => String(l.table_number).trim() === entry.tableNumber)) continue;
      if (selectedZone !== 'all' && zoneTableSet && zoneTableSet.size > 0 && !zoneTableSet.has(entry.tableNumber)) continue;
      customLayouts.push({
        table_number: entry.tableNumber,
        zone_code: 'main',
        shape: 'square',
        x_pos: 8 + customIdx * 14,
        y_pos: 80,
        width: 78,
        height: 78,
        seats: 4,
        rotation: 0,
      });
      customIdx += 1;
    }
  }
  const renderLayouts = [...visibleLayouts, ...customLayouts];

  // Handle Drag Start
  const handlePointerDown = (e: React.PointerEvent, tbl: TableLayout) => {
    if (!isDesignMode) return;
    e.stopPropagation();
    setActiveTableId(tbl.table_number);
    setIsDragging(true);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickXPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const clickYPercent = ((e.clientY - rect.top) / rect.height) * 100;
      setDragOffset({
        x: clickXPercent - Number(tbl.x_pos),
        y: clickYPercent - Number(tbl.y_pos),
      });
    }
  };

  // Handle Drag Move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDesignMode || !isDragging || !activeTableId || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const pointerXPercent = ((e.clientX - rect.left) / rect.width) * 100;
      const pointerYPercent = ((e.clientY - rect.top) / rect.height) * 100;

      const rawX = pointerXPercent - dragOffset.x;
      const rawY = pointerYPercent - dragOffset.y;

      // Clamp within 0% to 90%
      const newX = Math.max(1, Math.min(88, Number(rawX.toFixed(1))));
      const newY = Math.max(1, Math.min(88, Number(rawY.toFixed(1))));

      setLayouts((prev) =>
        prev.map((t) => (t.table_number === activeTableId ? { ...t, x_pos: newX, y_pos: newY } : t))
      );
    },
    [isDesignMode, isDragging, activeTableId, dragOffset]
  );

  // Handle Drag End
  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false);
    }
  };

  // Add a new Table in Designer Mode
  const handleAddTable = () => {
    const existingNums = new Set(layouts.map((l) => l.table_number));
    let nextNum = layouts.length + 1;
    while (existingNums.has(String(nextNum))) {
      nextNum++;
    }

    const newTable: TableLayout = {
      table_number: String(nextNum),
      zone_code: selectedZone === 'all' ? 'main' : selectedZone,
      shape: 'square',
      x_pos: 40,
      y_pos: 40,
      width: 78,
      height: 78,
      seats: 4,
      rotation: 0,
    };

    setLayouts((prev) => [...prev, newTable]);
    setActiveTableId(newTable.table_number);
    toast.success(`تمت إضافة طاولة ${nextNum} في وسط الصالة. يمكنك سحبها لمكانها المناسب.`);
  };

  // Change Table Shape
  const handleChangeShape = (tableNum: string, shape: 'square' | 'round' | 'rectangle' | 'booth') => {
    setLayouts((prev) =>
      prev.map((t) => {
        if (t.table_number !== tableNum) return t;
        const seats = shape === 'rectangle' ? 6 : shape === 'round' ? 4 : shape === 'booth' ? 4 : 4;
        const width = shape === 'rectangle' ? 100 : 78;
        return { ...t, shape, seats, width };
      })
    );
  };

  // Change Table Seats
  const handleChangeSeats = (tableNum: string, delta: number) => {
    setLayouts((prev) =>
      prev.map((t) => {
        if (t.table_number !== tableNum) return t;
        const nextSeats = Math.max(1, Math.min(16, (t.seats || 4) + delta));
        return { ...t, seats: nextSeats };
      })
    );
  };

  // Rotate Table 90 degrees
  const handleRotate = (tableNum: string) => {
    setLayouts((prev) =>
      prev.map((t) => {
        if (t.table_number !== tableNum) return t;
        const nextRotation = ((t.rotation || 0) + 90) % 360;
        return { ...t, rotation: nextRotation };
      })
    );
  };

  // R-I37: entering design mode snapshots the server layouts; Cancel
  // restores the snapshot (it used to only close the mode, leaving
  // deletes/moves in the local state until remount).
  const enterDesignMode = () => {
    setDesignSnapshot(layouts.map((l) => ({ ...l })));
    setIsDesignMode(true);
  };

  const cancelDesignMode = () => {
    if (designSnapshot) setLayouts(designSnapshot.map((l) => ({ ...l })));
    setDesignSnapshot(null);
    setActiveTableId(null);
    setIsDesignMode(false);
  };

  // Delete Table from Layout — R-I37: asks for confirm and REFUSES
  // when the table is occupied / reserved / has a KDS ticket. Deleting
  // an occupied table used to hide a live order from the floor.
  const handleDeleteTable = async (tableNum: string) => {
    const entry = floorState?.get(tableNum);
    const hasDraft = Boolean(entry?.drafts?.length) || Boolean(occupiedMap.get(tableNum));
    if (hasDraft || entry?.status === 'occupied') {
      toast.error(`لا يمكن حذف طاولة ${tableNum} — مشغولة بطلب قائم. استدعِ الطلب أو انقله أولًا.`);
      return;
    }
    if (confirmedReservationsMap.get(tableNum)) {
      toast.error(`لا يمكن حذف طاولة ${tableNum} — لديها حجز مؤكد اليوم.`);
      return;
    }
    const kdsTicket = entry?.kdsTicket ?? _kdsTableMap.get(tableNum);
    if (kdsTicket) {
      toast.error(`لا يمكن حذف طاولة ${tableNum} — لديها طلب قيد التحضير في المطبخ.`);
      return;
    }
    const confirmed = await systemConfirm({
      title: 'حذف طاولة من المخطط',
      message: `سيتم حذف طاولة ${tableNum} من مخطط الصالة. هل أنت متأكد؟`,
      confirmText: 'حذف الطاولة',
      cancelText: 'إلغاء',
    });
    if (!confirmed) return;
    setLayouts((prev) => prev.filter((t) => t.table_number !== tableNum));
    if (activeTableId === tableNum) setActiveTableId(null);
    toast.info(`تم حذف طاولة ${tableNum} من المخطط.`);
  };

  // Reset to auto-arranged layout
  const handleAutoArrange = () => {
    const cols = Math.min(Math.ceil(Math.sqrt(layouts.length)), 6);
    const cellW = 86 / cols;
    const cellH = 18;

    setLayouts((prev) =>
      prev.map((t, idx) => {
        const colIdx = idx % cols;
        const rowIdx = Math.floor(idx / cols);
        return {
          ...t,
          x_pos: Number((6 + colIdx * cellW).toFixed(1)),
          y_pos: Number((6 + rowIdx * cellH).toFixed(1)),
        };
      })
    );
    toast.info('تمت إعادة التوزيع المتناسق للطاولات تلقائياً.');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: '460px',
        background: '#f8fafc',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        userSelect: isDesignMode ? 'none' : 'auto',
      }}
    >
      {/* Top Designer / Canvas Toolbar */}
      <div
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
            {__t('pos.pos_workspace.pos_visual_floor_canvas.s0', __t('pos.pos_workspace.pos_visual_floor_canvas.s0', "المخطط البصري التفاعلي للصالة (Visual Floor Canvas)"))}
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {visibleLayouts.length} {__t('pos.pos_workspace.pos_visual_floor_canvas.s1', __t('pos.pos_workspace.pos_visual_floor_canvas.s1', "طاولة بالمخطط"))}
          </span>
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isDesignMode ? (
            <>
              <button
                type="button"
                onClick={handleAddTable}
                style={{
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <PlusIcon size={13} color="#166534" />
                <span>{__t('pos.pos_workspace.pos_visual_floor_canvas.s2', __t('pos.pos_workspace.pos_visual_floor_canvas.s2', "إضافة طاولة"))}</span>
              </button>

              <button
                type="button"
                onClick={handleAutoArrange}
                style={{
                  background: '#f8fafc',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title={__t('pos.pos_workspace.pos_visual_floor_canvas.s3', __t('pos.pos_workspace.pos_visual_floor_canvas.s3', "إعادة التوزيع المتناسق للطاولات تلقائياً"))}
              >
                {__t('pos.pos_workspace.pos_visual_floor_canvas.s4', __t('pos.pos_workspace.pos_visual_floor_canvas.s4', "توزيع تلقائي"))}
              </button>

              <button
                type="button"
                onClick={() => saveMutation.mutate(layouts)}
                disabled={saveMutation.isPending}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <SaveIcon size={13} color="#ffffff" />
                <span>{saveMutation.isPending ? __t('pos.pos_workspace.pos_visual_floor_canvas.s5', __t('pos.pos_workspace.pos_visual_floor_canvas.s5', "جاري الحفظ...")) : __t('pos.pos_workspace.pos_visual_floor_canvas.s6', __t('pos.pos_workspace.pos_visual_floor_canvas.s6', "حفظ التصميم"))}</span>
              </button>

              <button
                type="button"
                onClick={cancelDesignMode}
                style={{
                  background: '#f1f5f9',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.pos_workspace.pos_visual_floor_canvas.s7', __t('pos.pos_workspace.pos_visual_floor_canvas.s7', "إلغاء"))}
              </button>
            </>
          ) : isManager ? (
            <button
              type="button"
              onClick={enterDesignMode}
              style={{
                background: '#ffffff',
                color: '#170e5e',
                border: '1px solid #c7d2fe',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
              title={__t('pos.pos_workspace.pos_visual_floor_canvas.s8', __t('pos.pos_workspace.pos_visual_floor_canvas.s8', "تفعيل وضع السحب والإفلات وتغيير مواقع وأشكال الطاولات"))}
            >
              <EditIcon size={13} color="#170e5e" />
              <span>{__t('pos.pos_workspace.pos_visual_floor_canvas.s9', __t('pos.pos_workspace.pos_visual_floor_canvas.s9', "تعديل وتصميم المخطط"))}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Selected Table Property Bar (Visible only when in Design Mode and a table is selected) */}
      {isDesignMode && activeTableId && (
        <div
          style={{
            background: '#eff6ff',
            borderBottom: '1px solid #bfdbfe',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '11.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 800, color: '#1e40af' }}>
              {__t('pos.pos_workspace.pos_visual_floor_canvas.s10', __t('pos.pos_workspace.pos_visual_floor_canvas.s10', "طاولة #"))}{activeTableId}:
            </span>

            {/* Shape Selector */}
            <div style={{ display: 'flex', gap: '3px' }}>
              {(['square', 'round', 'rectangle', 'booth'] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => handleChangeShape(activeTableId, sh)}
                  style={{
                    background:
                      layouts.find((l) => l.table_number === activeTableId)?.shape === sh
                        ? '#170e5e'
                        : '#ffffff',
                    color:
                      layouts.find((l) => l.table_number === activeTableId)?.shape === sh
                        ? '#ffffff'
                        : '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {sh === 'square'
                    ? __t('pos.pos_workspace.pos_visual_floor_canvas.s11', __t('pos.pos_workspace.pos_visual_floor_canvas.s11', "مربعة"))
                    : sh === 'round'
                    ? __t('pos.pos_workspace.pos_visual_floor_canvas.s12', __t('pos.pos_workspace.pos_visual_floor_canvas.s12', "دائرية"))
                    : sh === 'rectangle'
                    ? __t('pos.pos_workspace.pos_visual_floor_canvas.s13', __t('pos.pos_workspace.pos_visual_floor_canvas.s13', "مستطيلة"))
                    : __t('pos.pos_workspace.pos_visual_floor_canvas.s14', __t('pos.pos_workspace.pos_visual_floor_canvas.s14', "كنب"))}
                </button>
              ))}
            </div>

            {/* Seats Controls: Strict RTL Stepper [+] on Right, [-] on Left */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginInlineStart: '6px' }}>
              <span style={{ color: '#475569', fontSize: '11px' }}>{__t('pos.pos_workspace.pos_visual_floor_canvas.s15', __t('pos.pos_workspace.pos_visual_floor_canvas.s15', "المقاعد:"))}</span>
              <button
                type="button"
                onClick={() => handleChangeSeats(activeTableId, 1)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '3px',
                  width: '20px',
                  height: '20px',
                  cursor: 'pointer',
                  fontWeight: 900,
                  fontSize: '11px',
                }}
              >
                +
              </button>
              <span style={{ fontWeight: 800, color: '#0f172a', minWidth: '16px', textAlign: 'center' }}>
                {layouts.find((l) => l.table_number === activeTableId)?.seats || 4}
              </span>
              <button
                type="button"
                onClick={() => handleChangeSeats(activeTableId, -1)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '3px',
                  width: '20px',
                  height: '20px',
                  cursor: 'pointer',
                  fontWeight: 900,
                  fontSize: '11px',
                }}
              >
                -
              </button>
            </div>

            {/* Rotate */}
            <button
              type="button"
              onClick={() => handleRotate(activeTableId)}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10.5px',
                fontWeight: 700,
                color: '#334155',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <RotateCcwIcon size={11} />
              <span>{__t('pos.pos_workspace.pos_visual_floor_canvas.s16', __t('pos.pos_workspace.pos_visual_floor_canvas.s16', "تدوير 90°"))}</span>
            </button>
          </div>

          {/* Delete Table */}
          <button
            type="button"
            onClick={() => handleDeleteTable(activeTableId)}
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <TrashIcon size={12} color="#991b1b" />
            <span>{__t('pos.pos_workspace.pos_visual_floor_canvas.s17', __t('pos.pos_workspace.pos_visual_floor_canvas.s17', "حذف الطاولة"))}</span>
          </button>
        </div>
      )}

      {/* Main Floor Plan 2D Canvas */}
      <div
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          minHeight: '390px',
          background: isDesignMode
            ? 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)'
            : 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: isDesignMode ? '#f1f5f9' : '#f8fafc',
          overflow: 'hidden',
          cursor: isDesignMode ? (isDragging ? 'grabbing' : 'crosshair') : 'default',
        }}
      >
        {renderLayouts.map((tbl) => {
          const tNum = String(tbl.table_number).trim();
          // INV-REST-FLOOR-STATE-TRUTH (R-I36): the tile renders from the
          // single floor-state record, like the grid. occupiedMap values
          // are draft LISTS now (and the old canvas read draft.cartTotal
          // / draft.cart / draft.itemCount — fields a held draft does not
          // have — so every tile showed 0 and 1 item).
          const floorEntry = floorState?.get(tNum);
          const occupiedList = occupiedMap.get(tNum);
          const legacyDraft = Array.isArray(occupiedList) ? occupiedList[0] : occupiedList;
          const draft = floorEntry?.drafts?.[0] ?? legacyDraft;
          const qrOrder = floorEntry?.qrOrder;
          const kdsTicket = floorEntry?.kdsTicket ?? _kdsTableMap.get(tNum);
          const isOccupied = floorEntry ? floorEntry.status === 'occupied' : Boolean(draft);
          const tileTotal = floorEntry ? floorEntry.total : Number(draft?.total || 0);
          const tileItemsCount = floorEntry ? floorEntry.itemsCount : Number(draft?.itemsCount || 0);
          const isCurrent = currentTableNumber === tNum;
          const reservation = confirmedReservationsMap.get(tNum);
          const calls = pendingCallsByTable.get(tNum) || [];
          const hasCalls = calls.length > 0;
          const isPaidOnline = calls.some((c) => c.call_type === 'bill_paid');
          const isSelectedInDesigner = isDesignMode && activeTableId === tNum;

          // Dimensions & Shape styling — R-I37: render the STORED
          // width/height; the shape constants are only the fallback.
          const shape = tbl.shape || 'square';
          const borderRadius =
            shape === 'round'
              ? '999px'
              : shape === 'booth'
              ? '16px 16px 6px 6px'
              : '10px';
          const widthPx = Number(tbl.width || (shape === 'rectangle' ? 110 : 80));
          const heightPx = Number(tbl.height || (shape === 'rectangle' ? 66 : 80));

          // Status Theme Colors
          let bgColor = '#ffffff';
          let borderColor = '#cbd5e1';

          if (isCurrent) {
            borderColor = '#170e5e';
            bgColor = '#eef2ff';
          } else if (isPaidOnline) {
            bgColor = '#ecfdf5';
            borderColor = '#10b981';
          } else if (hasCalls) {
            bgColor = '#fffbeb';
            borderColor = '#f59e0b';
          } else if (isOccupied) {
            bgColor = '#f0fdf4';
            borderColor = '#86efac';
          } else if (qrOrder) {
            bgColor = '#faf5ff';
            borderColor = '#c084fc';
          } else if (reservation) {
            bgColor = '#eff6ff';
            borderColor = '#93c5fd';
          }

          if (isSelectedInDesigner) {
            borderColor = '#2563eb';
            bgColor = '#dbeafe';
          }

          return (
            <div
              key={tbl.table_number}
              onPointerDown={(e) => handlePointerDown(e, tbl)}
              onClick={() => {
                if (isDesignMode) {
                  setActiveTableId(tNum);
                } else {
                  if (draft?.id) {
                    onRecallDraft(draft.id);
                  } else {
                    onSelectTable(tNum);
                  }
                }
              }}
              style={{
                position: 'absolute',
                left: `${tbl.x_pos}%`,
                top: `${tbl.y_pos}%`,
                width: `${widthPx}px`,
                height: `${heightPx}px`,
                borderRadius,
                background: bgColor,
                border: isSelectedInDesigner ? '2.5px solid #2563eb' : `1.5px solid ${borderColor}`,
                boxShadow: isOccupied
                  ? '0 3px 8px rgba(22, 163, 74, 0.15)'
                  : hasCalls
                  ? '0 0 10px rgba(245, 158, 11, 0.35)'
                  : '0 2px 5px rgba(0,0,0,0.04)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
                cursor: isDesignMode ? 'grab' : 'pointer',
                transform: tbl.rotation ? `rotate(${tbl.rotation}deg)` : undefined,
                transition: isDragging && activeTableId === tNum ? 'none' : 'transform 0.1s ease, box-shadow 0.15s ease',
                zIndex: isSelectedInDesigner ? 20 : isOccupied ? 10 : 5,
              }}
              title={
                isDesignMode
                  ? `اسحب لتعديل موقع طاولة ${tNum}`
                  : isOccupied
                  ? `طاولة ${tNum} (مشغولة) - انقر لفتح الطلب`
                  : `طاولة ${tNum} (متاحة) - انقر لفتحها في الكاشير`
              }
            >
              {/* Table Top Header: Number & Seats */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 900,
                    color: isOccupied ? '#15803d' : '#0f172a',
                  }}
                >
                  T-{tNum}
                </span>
                <span
                  style={{
                    fontSize: '9.5px',
                    color: '#64748b',
                    fontWeight: 600,
                  }}
                >
                  ({tbl.seats || 4}{__t('pos.pos_workspace.pos_visual_floor_canvas.s18', "م")})
                </span>
              </div>

              {/* KDS badge (R-I36, decided): a KDS ticket alone is a
                  display badge, never occupancy — the sale already posted
                  and is cooking. */}
              {kdsTicket && (
                <div
                  style={{
                    fontSize: '8.5px',
                    fontWeight: 800,
                    color: '#6b21a8',
                    background: '#f3e8ff',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    marginTop: '2px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_visual_floor_canvas.s25', __t('pos.pos_workspace.pos_visual_floor_canvas.s25', "بالمطبخ"))}
                </div>
              )}

              {/* Status Indicator */}
              {isPaidOnline ? (
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    color: '#065f46',
                    background: '#d1fae5',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    marginTop: '2px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_visual_floor_canvas.s19', __t('pos.pos_workspace.pos_visual_floor_canvas.s19', "مسدد"))}
                </div>
              ) : hasCalls ? (
                <div
                  onClick={(e) => onResolveCalls && onResolveCalls(e, tNum)}
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    color: '#92400e',
                    background: '#fef3c7',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <BellIcon size={10} color="#b45309" />
                  <span>{__t('pos.pos_workspace.pos_visual_floor_canvas.s20', __t('pos.pos_workspace.pos_visual_floor_canvas.s20', "نداء"))}</span>
                </div>
              ) : isOccupied ? (
                <div style={{ textAlign: 'center', marginTop: '2px' }}>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      color: qrOrder && !draft ? '#7e22ce' : '#166534',
                      lineHeight: 1.1,
                    }}
                  >
                    {formatCurrency(tileTotal)}
                  </div>
                  <div style={{ fontSize: '8.5px', color: '#64748b' }}>
                    {tileItemsCount} {__t('pos.pos_workspace.pos_visual_floor_canvas.s21', __t('pos.pos_workspace.pos_visual_floor_canvas.s21', "صنف"))}
                  </div>
                  {qrOrder && !draft && (
                    <div style={{ fontSize: '8.5px', fontWeight: 800, color: '#9333ea' }}>
                      {__t('pos.pos_workspace.pos_visual_floor_canvas.s24', __t('pos.pos_workspace.pos_visual_floor_canvas.s24', "طلب QR"))}
                    </div>
                  )}
                </div>
              ) : qrOrder ? (
                <div style={{ textAlign: 'center', marginTop: '2px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#7e22ce', lineHeight: 1.1 }}>
                    {formatCurrency(tileTotal)}
                  </div>
                  <div style={{ fontSize: '8.5px', color: '#7e22ce' }}>
                    {tileItemsCount} {__t('pos.pos_workspace.pos_visual_floor_canvas.s21', __t('pos.pos_workspace.pos_visual_floor_canvas.s21', "صنف"))} • {__t('pos.pos_workspace.pos_visual_floor_canvas.s24', __t('pos.pos_workspace.pos_visual_floor_canvas.s24', "طلب QR"))}
                  </div>
                </div>
              ) : reservation ? (
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    color: '#1e40af',
                    background: '#dbeafe',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    marginTop: '2px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_visual_floor_canvas.s22', __t('pos.pos_workspace.pos_visual_floor_canvas.s22', "حجز"))}
                </div>
              ) : (
                <span
                  style={{
                    fontSize: '9.5px',
                    color: '#94a3b8',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {__t('pos.pos_workspace.pos_visual_floor_canvas.s23', __t('pos.pos_workspace.pos_visual_floor_canvas.s23', "متاحة"))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
