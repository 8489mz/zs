import { useState } from 'react';
import { formatCurrency, formatDateTimeArabic } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  CheckCircleIcon,
  EyeIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@/shared/components/icons/AppIcons';
import type {
  CashierRiskProfile,
  FraudRadarEventItem,
  FraudRadarSummaryResponse,
  RadarEventKind,
} from '../../api/cashier-fraud-radar.api';

interface Props {
  summary: FraudRadarSummaryResponse | undefined;
  events: FraudRadarEventItem[];
  selectedCashierId: number | null;
  onSelectCashier: (id: number | null) => void;
}

const EVENT_BADGE_MAP: Record<RadarEventKind, { label: string; bg: string; color: string }> = {
  cart_remove: { label: 'حذف من السلة', bg: '#fee2e2', color: '#991b1b' },
  qty_decrease: { label: 'تنقيص كمية', bg: '#ffedd5', color: '#9a3412' },
  draft_cancel: { label: 'مسح سلة كاملة', bg: '#fef2f2', color: '#b91c1c' },
  no_sale: { label: 'فتح درج بلا بيع', bg: '#fef3c7', color: '#92400e' },
  receipt_reprint: { label: 'إعادة طباعة', bg: '#e0f2fe', color: '#075985' },
  held_sale_delete: { label: 'حذف فاتورة معلقة', bg: '#fce7f3', color: '#9d174d' },
  weighted_barcode_replay: { label: 'تكرار باركود ميزان', bg: '#f3e8ff', color: '#6b21a8' },
  sale_cancelled: { label: 'إلغاء فاتورة', bg: '#fce7f3', color: '#9d174d' },
  discount_override: { label: 'تجاوز خصم', bg: '#ede9fe', color: '#5b21b6' },
  sale_return: { label: 'مرتجع مبيعات', bg: '#fef9c3', color: '#854d0e' },
};

function renderRiskBadge(level: CashierRiskProfile['riskLevel'], score: number) {
  if (level === 'high') {
    return (
      <span style={{ ...pillStyle, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
        عالي الخطورة ({score}%)
      </span>
    );
  }
  if (level === 'medium') {
    return (
      <span style={{ ...pillStyle, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
        تحت الملاحظة ({score}%)
      </span>
    );
  }
  return (
    <span style={{ ...pillStyle, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
      طبيعي ({score}%)
    </span>
  );
}

export function PosRadarAndBenchmarksTab({
  summary,
  events,
  selectedCashierId,
  onSelectCashier,
}: Props) {
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const [eventFilter, setEventFilter] = useState<string>('all');

  const filteredEvents = events.filter((ev) => {
    if (selectedCashierId && ev.cashierId !== selectedCashierId) return false;
    if (eventFilter !== 'all' && ev.eventType !== eventFilter) return false;
    return true;
  });

  const peerBenchmarks = summary?.peerBenchmarks;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Cashier Risk Table */}
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={sectionTitleStyle}>تقييم مخاطر الكاشيرات ونقاط البيع</h3>
              <div style={sectionSubStyle}>
                اضغط على أي كاشير لتصفية سجل الأحداث المباشر أدناه ومطابقته مع توقيت الكاميرا
              </div>
            </div>
          </div>
          {selectedCashierId !== null && (
            <button
              type="button"
              onClick={() => onSelectCashier(null)}
              style={clearFilterBtnStyle}
            >
              إلغاء التصفية (عرض الجميع)
            </button>
          )}
        </div>

        {!summary?.cashiers?.length ? (
          <div style={emptyBoxStyle}>
            <CheckCircleIcon size={28} color="#16a34a" />
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
              لا توجد مخالفات أو أحداث مريبة مسجلة خلال هذه الفترة
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>الكاشير</th>
                  <th style={thStyle}>مسح سلة</th>
                  <th style={thStyle}>حذف/تنقيص</th>
                  <th style={thStyle}>فتح درج</th>
                  <th style={thStyle}>إعادة طباعة</th>
                  <th style={thStyle}>مرتجع/إلغاء</th>
                  <th style={thStyle}>فواتيره</th>
                  <th style={thStyle}>التقييم</th>
                </tr>
              </thead>
              <tbody>
                {summary.cashiers.map((c) => {
                  const isSelected = selectedCashierId === c.cashierId;
                  return (
                    <tr
                      key={c.cashierId}
                      onClick={() => onSelectCashier(isSelected ? null : c.cashierId)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#0f172a' }}>{c.cashierName}</td>
                      <td style={tdStyle}>{c.draftCancelsCount}</td>
                      <td style={tdStyle}>
                        {c.cartVoidsCount + Number(c.qtyDecreasesCount || 0)}
                      </td>
                      <td style={tdStyle}>{Number(c.noSaleOpensCount || 0)}</td>
                      <td style={tdStyle}>{Number(c.receiptReprintsCount || 0)}</td>
                      <td style={tdStyle}>{c.saleReturnsCount + c.cancelledSalesCount}</td>
                      <td style={tdStyle}>{c.totalSalesCount}</td>
                      <td style={tdStyle}>{renderRiskBadge(c.riskLevel, c.riskScore)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Peer Benchmark (Sweethearting / Unscanned Items Detector) */}
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={sectionTitleStyle}>
                مقارنة أداء الكاشيرات ببعضهم (كشف تمرير البضاعة دون مسح الباركود)
              </h3>
              <div style={sectionSubStyle}>
                يقارن متوسط قيمة الفاتورة وعدد الأصناف لكل كاشير بمتوسط زملائه في نفس المنشأة لرصد تمرير الأصناف دون ضربها
              </div>
            </div>
          </div>
          {peerBenchmarks && peerBenchmarks.eligibleCashiersCount >= 2 && (
            <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#475569' }}>
              <span>
                متوسط فاتورة المتجر: <strong>{formatCurrency(peerBenchmarks.peerAvgTicket)}</strong> <CurrencySymbol />
              </span>
              <span>
                متوسط الأصناف/فاتورة: <strong>{peerBenchmarks.peerAvgItemsPerSale}</strong>
              </span>
            </div>
          )}
        </div>

        {!peerBenchmarks || peerBenchmarks.cashiers.length === 0 ? (
          <div style={emptyBoxStyle}>
            <UsersIcon size={24} color="#64748b" />
            <div style={{ color: '#475569', fontSize: '13px', marginTop: '6px' }}>
              تظهر المقارنة الإحصائية تلقائياً بمجرد وجود كاشيرين نشطين على الأقل بفواتير كافية خلال الفترة
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>الكاشير</th>
                  <th style={thStyle}>عدد الفواتير</th>
                  <th style={thStyle}>متوسط الفاتورة</th>
                  <th style={thStyle}>الفارق عن الزملاء</th>
                  <th style={thStyle}>متوسط الأصناف</th>
                  <th style={thStyle}>الشبهات / 100 فاتورة</th>
                  <th style={thStyle}>ملاحظات الكاشف</th>
                </tr>
              </thead>
              <tbody>
                {peerBenchmarks.cashiers.map((row) => (
                  <tr key={row.cashierId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{row.cashierName}</td>
                    <td style={tdStyle}>{row.salesCount}</td>
                    <td style={tdStyle}>
                      {formatCurrency(row.avgTicket)} <CurrencySymbol />
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontWeight: 700,
                        color: row.avgTicketDeltaPercent <= -20 ? '#b91c1c' : '#334155',
                      }}
                    >
                      {row.avgTicketDeltaPercent > 0 ? `+${row.avgTicketDeltaPercent}%` : `${row.avgTicketDeltaPercent}%`}
                    </td>
                    <td style={tdStyle}>
                      {row.avgItemsPerSale} (الزملاء: {row.peerAvgItemsPerSale})
                    </td>
                    <td style={tdStyle}>{row.suspiciousPer100Sales}</td>
                    <td style={tdStyle}>
                      {row.anomalyFlags.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {row.anomalyFlags.map((flag, i) => (
                            <span
                              key={i}
                              style={{
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: row.anomalyLevel === 'alert' ? '#fef2f2' : '#fffbeb',
                                color: row.anomalyLevel === 'alert' ? '#b91c1c' : '#b45309',
                                border: `1px solid ${row.anomalyLevel === 'alert' ? '#fecaca' : '#fde68a'}`,
                              }}
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: '#15803d', fontSize: '12px', fontWeight: 600 }}>ضمن النطاق الطبيعي</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Live Events Stream with CCTV Camera Timestamp & Expandable Cart Items Snapshot */}
      <div style={cardStyle}>
        <div style={sectionHeaderRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={sectionTitleStyle}>السجل الزمني المفصل لمراجعة الكاميرات وتفاصيل السلال المحذوفة</h3>
              <div style={sectionSubStyle}>
                يعرض التوقيت الدقيق بالثانية (توقيت الكاميرا) وكامل الأصناف والكميات والأسعار التي كانت في السلة لحظة المسح أو التعديل
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'draft_cancel', label: 'مسح سلة' },
              { id: 'cart_remove', label: 'حذف صنف' },
              { id: 'qty_decrease', label: 'تنقيص كمية' },
              { id: 'no_sale', label: 'فتح درج' },
              { id: 'receipt_reprint', label: 'إعادة طباعة' },
              { id: 'weighted_barcode_replay', label: 'باركود ميزان' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setEventFilter(f.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: eventFilter === f.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  backgroundColor: eventFilter === f.id ? '#170e5e' : '#f8fafc',
                  color: eventFilter === f.id ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div style={emptyBoxStyle}>
            <ShieldCheckIcon size={26} color="#15803d" />
            <div style={{ color: '#475569', fontSize: '13px', marginTop: '6px' }}>
              لا توجد أحداث مطابقة لهذا الفلتر خلال الفترة المحددة
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredEvents.map((ev) => {
              const badge = EVENT_BADGE_MAP[ev.eventType] || {
                label: ev.eventTitle || 'حدث أمني',
                bg: '#f1f5f9',
                color: '#475569',
              };
              const items = Array.isArray(ev.items) ? ev.items : [];
              const isExpanded = expandedEventId === ev.id;

              return (
                <div
                  key={`${ev.eventType}-${ev.id}`}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          backgroundColor: '#0f172a',
                          color: '#ffffff',
                          fontFamily: 'monospace',
                        }}
                        title="توقيت مراجعة الكاميرا (ساعة:دقيقة:ثانية)"
                      >
                        كاميرا {ev.cameraTime || new Date(ev.createdAt).toTimeString().slice(0, 8)}
                      </span>
                      <span
                        style={{
                          padding: '3px 9px',
                          borderRadius: '6px',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          backgroundColor: badge.bg,
                          color: badge.color,
                        }}
                      >
                        {badge.label}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{ev.cashierName}</span>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{formatDateTimeArabic(ev.createdAt)}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {ev.amount !== undefined && ev.amount > 0 && (
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#b91c1c' }}>
                          {formatCurrency(ev.amount)} <CurrencySymbol />
                        </span>
                      )}
                      {items.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: isExpanded ? '#eef2ff' : '#f8fafc',
                            color: '#170e5e',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <EyeIcon size={14} />
                          {isExpanded ? 'إخفاء الأصناف' : `عرض الأصناف (${items.length})`}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                    {ev.details}
                  </div>

                  {isExpanded && items.length > 0 && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '10px',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        overflowX: 'auto',
                      }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: '6px' }}>
                        محتويات السلة المسجلة لحظة الحدث:
                      </div>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={subThStyle}>الصنف</th>
                            <th style={subThStyle}>الكمية</th>
                            <th style={subThStyle}>سعر الوحدة</th>
                            <th style={subThStyle}>الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={subTdStyle}>
                                {it.productName}
                                {it.unitName ? ` (${it.unitName})` : ''}
                              </td>
                              <td style={subTdStyle}>
                                {it.previousQty !== undefined ? `${it.previousQty} ← ${it.qty}` : it.qty}
                              </td>
                              <td style={subTdStyle}>
                                {formatCurrency(it.unitPrice)} <CurrencySymbol />
                              </td>
                              <td style={{ ...subTdStyle, fontWeight: 700, color: '#b91c1c' }}>
                                {formatCurrency(it.lineTotal)} <CurrencySymbol />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
};

const sectionHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginBottom: '12px',
};

const navyBarStyle: React.CSSProperties = {
  width: '3px',
  height: '20px',
  borderRadius: '2px',
  backgroundColor: '#170e5e',
  display: 'inline-block',
  flexShrink: 0,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  fontWeight: 700,
  color: '#0f172a',
};

const sectionSubStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  marginTop: '2px',
};

const clearFilterBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  backgroundColor: '#f8fafc',
  color: '#170e5e',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '28px 16px',
  textAlign: 'center',
  color: '#64748b',
};

const pillStyle: React.CSSProperties = {
  padding: '3px 9px',
  borderRadius: '9999px',
  fontSize: '11.5px',
  fontWeight: 700,
  display: 'inline-block',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '9px 12px',
  backgroundColor: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#1e293b',
  verticalAlign: 'middle',
};

const subThStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '6px 10px',
  color: '#475569',
  fontSize: '11.5px',
  fontWeight: 600,
  borderBottom: '1px solid #cbd5e1',
};

const subTdStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '12.5px',
  color: '#0f172a',
};
