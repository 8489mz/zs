// Floor top bars — stats, transferring banner, non-table quick bar.
// Pure move; the dialog keeps all state and mounts this component
// with the floor values and callbacks.

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { BellIcon, QrCodeIcon, SlidersIcon, CalendarIcon, PrinterIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import { Button } from '@/shared/ui/button';
import type { OnlineOrderRecord } from '@/features/storefront';
import type { TableServiceCall } from '@/features/pos/api/table-calls.api';
import type { TableReservation } from '@/features/pos/api/table-reservations.api';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

interface PosFloorStatsBarProps {
  availableCount: number;
  occupiedCount: number;
  totalOccupiedMoney: number;
  qrOrdersMap: Map<string, OnlineOrderRecord>;
  pendingCalls: TableServiceCall[];
  nonTableDrafts: HeldPosDraftSummary[];
  setIsQrPrintOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isEditingCount: boolean;
  handleSaveTablesCount: (e: React.FormEvent) => Promise<void>;
  newTablesCount: number;
  setNewTablesCount: React.Dispatch<React.SetStateAction<number>>;
  isSavingCount: boolean;
  setIsEditingCount: React.Dispatch<React.SetStateAction<boolean>>;
  tablesCount: number;
  setIsReservationsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  confirmedReservationsMap: Map<string, TableReservation>;
  setIsPrintersModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentTableNumber: string;
  currentCartItemsCount: number;
  heldDrafts: HeldPosDraftSummary[];
  setIsTransferring: React.Dispatch<React.SetStateAction<boolean>>;
  isTransferring: boolean;
  handleOpenItemTransfer: (tableNum: string) => void;
  pendingRecallId: string;
  handleRecall: (draftId: string) => Promise<void>;
}

export function PosFloorStatsBar({
  availableCount,
  occupiedCount,
  totalOccupiedMoney,
  qrOrdersMap,
  pendingCalls,
  nonTableDrafts,
  setIsQrPrintOpen,
  isEditingCount,
  handleSaveTablesCount,
  newTablesCount,
  setNewTablesCount,
  isSavingCount,
  setIsEditingCount,
  tablesCount,
  setIsReservationsModalOpen,
  confirmedReservationsMap,
  setIsPrintersModalOpen,
  currentTableNumber,
  currentCartItemsCount,
  heldDrafts,
  setIsTransferring,
  isTransferring,
  handleOpenItemTransfer,
  pendingRecallId,
  handleRecall,
}: PosFloorStatsBarProps) {
  const { t: __t } = useTranslation();
  return (
    <>
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
    </>
  );
}
