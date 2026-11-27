// Tables grid — table cards with occupied/QR/KDS/call states, recall,
// transfer, fire-course, resolve-calls and guest-check printing.
// Pure move; the dialog keeps all state and mounts this component
// with the grid values and callbacks.

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { AlertTriangleIcon, BellIcon } from '@/shared/components/icons/AppIcons';
import type { OnlineOrderRecord } from '@/features/storefront';
import type { KdsTicket } from '@/features/pos/api/kds.api';
import type { TableReservation } from '@/features/pos/api/table-reservations.api';
import type { TableServiceCall } from '@/features/pos/api/table-calls.api';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

interface PosTablesGridProps {
  gridTables: string[];
  occupiedMap: Map<string, HeldPosDraftSummary[]>;
  qrOrdersMap: Map<string, OnlineOrderRecord>;
  kdsTableMap: Map<string, KdsTicket>;
  pendingCallsByTable: Map<string, TableServiceCall[]>;
  currentTableNumber: string;
  currentCartItemsCount: number;
  pendingRecallId: string;
  isSubmittingTable: boolean;
  handleTableClick: (tableNum: string) => Promise<void>;
  confirmedReservationsMap: Map<string, TableReservation>;
  currentCartTotal: number;
  handleOpenItemTransfer: (tableNum: string) => void;
  handleResolveTableCalls: (e: React.MouseEvent, tableNum: string) => Promise<void>;
  firingTable: string | null;
  handleFireNextCourse: (e: React.MouseEvent, tableNum: string, ticket: KdsTicket) => Promise<void>;
  isCurrentCheckPrinted?: boolean;
  onPrintGuestCheck?: (tableNumber: string, draftId?: string) => Promise<void> | void;
}

export function PosTablesGrid({
  gridTables,
  occupiedMap,
  qrOrdersMap,
  kdsTableMap,
  pendingCallsByTable,
  currentTableNumber,
  currentCartItemsCount,
  pendingRecallId,
  isSubmittingTable,
  handleTableClick,
  confirmedReservationsMap,
  currentCartTotal,
  handleOpenItemTransfer,
  handleResolveTableCalls,
  firingTable,
  handleFireNextCourse,
  isCurrentCheckPrinted,
  onPrintGuestCheck,
}: PosTablesGridProps) {
  const { t: __t } = useTranslation();
  return (
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
                              backgroundColor: occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted) ? '#fff7ed' : '#f1f5f9',
                              color: occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted) ? '#c2410c' : '#170e5e',
                              border: occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted) ? '1px solid #fed7aa' : '1px solid #cbd5e1',
                              cursor: 'pointer',
                            }}
                            title={__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s67', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s67', "طباعة شيك حساب الطاولة غير المسدد للزبون"))}
                          >
                            {occupied?.guestCheckPrintedAt || (hasLiveCart && isCurrentCheckPrinted) ? __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s68', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s68', "إعادة طباعة الشيك")) : __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s69', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s69', "طباعة شيك"))}
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
  );
}
