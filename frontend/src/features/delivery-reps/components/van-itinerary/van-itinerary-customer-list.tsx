// Van-itinerary customer list (C-list) — pure move from VanItineraryTab.tsx (slice C-list).
// Empty-state + district groups + customer cards + top pagination (own useTranslation).
// The facade renders it inside the list fragment and passes filter/list/order/visit values as props.

import React, {type Dispatch, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { VanItineraryPagination } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-pagination';
import {
  MapPinIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  AlertTriangleIcon,
} from '@/shared/components/icons/AppIcons';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

interface VanItineraryCustomerListProps {
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  pageSize: number;
  handlePageSizeChange: (size: number) => void;
  setSelectedCustomerForHub: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  isReorderingMode: boolean;
  elapsedVisitSeconds: number;
  formatElapsed: (seconds: number) => string;
  filtered: VanCustomerItineraryItem[];
  allSortedCustomers: Array<VanCustomerItineraryItem & { globalSeq: number }>;
  totalPages: number;
  startIdx: number;
  districtGroups: Array<{
    name: string;
    items: Array<VanCustomerItineraryItem & { globalSeq: number }>;
    totalCount: number;
    visitedCount: number;
  }>;
  moveDistrict: (districtName: string, dir: 'up' | 'down') => void;
  moveCustomer: (districtName: string, customerId: number, dir: 'up' | 'down') => void;
  getReasonLabel: (reason?: string) => string;
  isLoading?: boolean;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
}

export const VanItineraryCustomerList: React.FC<VanItineraryCustomerListProps> = ({
  currentPage,
  setCurrentPage,
  pageSize,
  handlePageSizeChange,
  setSelectedCustomerForHub,
  isReorderingMode,
  elapsedVisitSeconds,
  formatElapsed,
  filtered,
  allSortedCustomers,
  totalPages,
  startIdx,
  districtGroups,
  moveDistrict,
  moveCustomer,
  getReasonLabel,
  isLoading,
  activeVisit,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Customers List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '13px' }}>
          {t('delivery_reps.van_itinerary_tab.s70', "جاري تحميل خط السير...")}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '30px 16px',
            textAlign: 'center',
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          {t('delivery_reps.van_itinerary_tab.s71', "لا توجد محلات مسجلة تطابق معايير البحث")}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Top Compact Pagination Bar - only shown if more than 1 page */}
          {totalPages > 1 && (
            <VanItineraryPagination
              startIdx={startIdx}
              pageSize={pageSize}
              totalCount={allSortedCustomers.length}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}

          {districtGroups.map((group, groupIdx) => {
            return (
              <div
                key={group.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '10px 12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                {/* District Group Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #f1f5f9',
                    paddingBottom: '8px',
                    marginBottom: '4px',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '6px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MapPinIcon size={14} color="#170e5e" />
                    </div>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                        {group.name}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          backgroundColor: group.visitedCount === group.totalCount && group.totalCount > 0 ? '#eef2ff' : '#f1f5f9',
                          color: group.visitedCount === group.totalCount && group.totalCount > 0 ? '#170e5e' : '#475569',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          marginInlineStart: '6px',
                        }}
                      >
                        {group.visitedCount} {t('delivery_reps.van_itinerary_tab.s72', "من")} {group.totalCount} {t('delivery_reps.van_itinerary_tab.s73', "تمت زيارتهم")}
                      </span>
                    </div>
                  </div>

                  {/* Reordering controls for District */}
                  {isReorderingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => moveDistrict(group.name, 'up')}
                        disabled={groupIdx === 0}
                        style={{
                          width: '26px',
                          height: '24px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          cursor: groupIdx === 0 ? 'not-allowed' : 'pointer',
                          opacity: groupIdx === 0 ? 0.35 : 1,
                          color: '#1e293b',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        }}
                        title={t('delivery_reps.van_itinerary_tab.s74', "تقديم الحي في خط السير")}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDistrict(group.name, 'down')}
                        disabled={groupIdx === districtGroups.length - 1}
                        style={{
                          width: '26px',
                          height: '24px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          cursor: groupIdx === districtGroups.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: groupIdx === districtGroups.length - 1 ? 0.35 : 1,
                          color: '#1e293b',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        }}
                        title={t('delivery_reps.van_itinerary_tab.s75', "تأخير الحي في خط السير")}
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </div>

                {/* Stores Cards inside this District */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {group.items.map((item, itemIdx) => {
                    const isPositive = item.visitStatus === 'positive';
                    const isNegative = item.visitStatus === 'negative';
                    const isPending = item.visitStatus === 'pending';
                    const isActiveVisiting = activeVisit?.customerId === item.customerId;

                    return (
                      <div
                        key={item.customerId}
                        onClick={() => setSelectedCustomerForHub(item)}
                        style={{
                          backgroundColor: isActiveVisiting ? '#f8faff' : '#ffffff',
                          borderRadius: '8px',
                          border: isActiveVisiting
                            ? '1.5px solid #2563eb'
                            : isPositive
                            ? '1px solid #bbf7d0'
                            : isNegative
                            ? '1px solid #fecaca'
                            : '1px solid #e2e8f0',
                          padding: '8px 10px',
                          boxShadow: isActiveVisiting ? '0 2px 8px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.1s ease',
                        }}
                      >
                        {/* Header: Sequence, Code, Name, Status Badge & Reorder Arrows */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            <span
                              style={{
                                backgroundColor: isActiveVisiting ? '#2563eb' : '#170e5e',
                                color: '#ffffff',
                                fontSize: '10px',
                                fontWeight: 800,
                                width: '20px',
                                height: '20px',
                                borderRadius: '5px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {item.globalSeq}
                            </span>
                            <span style={{ fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 800, color: '#475569', flexShrink: 0 }}>
                              [{item.customerCode.replace(/^#/, '')}]
                            </span>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: '13px',
                                fontWeight: 800,
                                color: '#0f172a',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                lineHeight: 1.4,
                              }}
                              title={item.customerName}
                            >
                              {item.customerName}
                            </h4>
                          </div>

                          {/* Status Badge & Actions */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                            {isActiveVisiting && (
                              <span
                                style={{
                                  backgroundColor: '#eff6ff',
                                  color: '#1d4ed8',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #bfdbfe',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2563eb', animation: 'pulse 1.5s infinite' }} />
                                <span>{t('delivery_reps.van_itinerary_tab.s76', "الزيارة جارية (")}{formatElapsed(elapsedVisitSeconds)})</span>
                              </span>
                            )}
                            {isPositive && (
                              <span
                                style={{
                                  backgroundColor: '#ecfdf5',
                                  color: '#047857',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #a7f3d0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <CheckCircleIcon size={11} color="#047857" />
                                <span>{t('delivery_reps.van_itinerary_tab.s77', "تم البيع")}</span>
                              </span>
                            )}
                            {isNegative && (
                              <span
                                style={{
                                  backgroundColor: '#fef2f2',
                                  color: '#b91c1c',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #fecaca',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <XCircleIcon size={11} color="#b91c1c" />
                                <span>{t('delivery_reps.van_itinerary_tab.s78', "سلبية")}</span>
                              </span>
                            )}
                            {isPending && !isActiveVisiting && (
                              <span
                                style={{
                                  backgroundColor: '#f8fafc',
                                  color: '#64748b',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #e2e8f0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <ClockIcon size={11} color="#64748b" />
                                <span>{t('delivery_reps.van_itinerary_tab.s79', "بالانتظار")}</span>
                              </span>
                            )}

                            {/* Up/Down buttons if in reorder mode */}
                            {isReorderingMode && (
                              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => moveCustomer(group.name, item.customerId, 'up')}
                                  disabled={itemIdx === 0}
                                  style={{
                                    width: '24px',
                                    height: '24px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '9.5px',
                                    fontWeight: 800,
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '5px',
                                    cursor: itemIdx === 0 ? 'not-allowed' : 'pointer',
                                    opacity: itemIdx === 0 ? 0.3 : 1,
                                    color: '#1e293b',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                  }}
                                  title={t('delivery_reps.van_itinerary_tab.s80', "تقديم المحل")}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveCustomer(group.name, item.customerId, 'down')}
                                  disabled={itemIdx === group.items.length - 1}
                                  style={{
                                    width: '24px',
                                    height: '24px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '9.5px',
                                    fontWeight: 800,
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '5px',
                                    cursor: itemIdx === group.items.length - 1 ? 'not-allowed' : 'pointer',
                                    opacity: itemIdx === group.items.length - 1 ? 0.3 : 1,
                                    color: '#1e293b',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                  }}
                                  title={t('delivery_reps.van_itinerary_tab.s81', "تأخير المحل")}
                                >
                                  ▼
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Repeated Negative Alert Badge */}
                        {item.hasRepeatedNegativeAlert && (
                          <div
                            style={{
                              backgroundColor: '#fffbeb',
                              border: '1px solid #fde68a',
                              borderRadius: '6px',
                              padding: '3px 8px',
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#b45309',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <AlertTriangleIcon size={12} color="#b45309" />
                            <span>{t('delivery_reps.van_itinerary_tab.s82', "تنبيه:")} {item.repeatedNegativesCount} {t('delivery_reps.van_itinerary_tab.s83', "زيارات سابقة بدون بيع")}</span>
                          </div>
                        )}

                        {/* Sub-info: Phone, Route, Debt */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#475569' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {item.customerPhone && (
                              <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }} dir="ltr">
                                {item.customerPhone}
                              </span>
                            )}
                            <span style={{ fontSize: '10.5px', color: '#64748b' }}>{item.route}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '10.5px' }}>{t('delivery_reps.van_itinerary_tab.s84', "المديونية:")} </span>
                            <strong style={{ color: item.balance > 0 ? '#b91c1c' : item.balance < 0 ? '#0284c7' : '#475569', fontSize: '11.5px' }}>
                              {item.balance === 0
                                ? t('delivery_reps.van_itinerary_tab.s85', "خالص (0)")
                                : item.balance < 0
                                ? `دائن (${Math.abs(item.balance).toFixed(0)})`
                                : item.balance.toFixed(0)}{' '}
                              <CurrencySymbol />
                            </strong>
                          </div>
                        </div>

                        {/* If already visited: show visit outcome details */}
                        {item.todayVisit && (
                          <div style={{ backgroundColor: '#f8fafc', padding: '3px 8px', borderRadius: '4px', fontSize: '10.5px', color: '#475569', border: '1px solid #e2e8f0' }}>
                            {item.todayVisit.visitType === 'positive' ? (
                              <span>
                                {t('delivery_reps.van_itinerary_tab.s86', "فاتورة #")}{item.todayVisit.saleDocNo} {t('delivery_reps.van_itinerary_tab.s87', "بمبلغ")} <strong>{item.todayVisit.saleTotal} <CurrencySymbol /></strong>
                              </span>
                            ) : (
                              <span>
                                {t('delivery_reps.van_itinerary_tab.s88', "السبب:")} <strong>{getReasonLabel(item.todayVisit.negativeReason)}</strong>
                                {item.todayVisit.postponedToDate && ` (تم التأجيل إلى: ${item.todayVisit.postponedToDate})`}
                                {item.todayVisit.notes && ` — "${item.todayVisit.notes}"`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
