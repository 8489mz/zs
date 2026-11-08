import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { formatDate } from '@/lib/format';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import {
  EyeIcon,
  SearchIcon,
  PrinterIcon,
  CopyIcon,
  CheckShieldIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  TrashIcon,
} from '@/shared/components/icons/AppIcons';
import type { DamagedStockRecord, Product, StockCountSession } from '@/types/domain';
import { getSessionStatusLabel, summarizeSessionVariance } from '@/features/inventory/components/sections/stockCountMonitor.helpers';

interface StockCountMonitorCardProps {
  canReviewStock: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  stockCountSessions: StockCountSession[];
  damagedRecords: DamagedStockRecord[];
  sessionTotalItems: number;
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  selectedSession: StockCountSession | null;
  selectedSessionTotals: { itemsCount: number; expectedQty: number; countedQty: number; varianceQty: number };
  sessionFilter: 'all' | 'draft' | 'posted';
  postingPin: string;
  postPending: boolean;
  postError?: unknown;
  postSuccess: boolean;
  transferSuccess: boolean;
  transferError?: unknown;
  onSessionFilterChange: (value: 'all' | 'draft' | 'posted') => void;
  onPostingPinChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
  onPostSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string, docNo?: string) => void;
  deletePending?: boolean;
  onCopySessionDetails: () => void;
  onPrintCountSessions: () => void;
  onPrintDamagedRecords: () => void;
  onExportDamagedCsv: () => void;
  onPrintSession: (session: StockCountSession) => void;
  selectedSessionIds?: string[];
  onSelectedSessionIdsChange?: (ids: string[]) => void;
  onPostSelectedSessions?: () => void;
  onStartNewCount?: () => void;
  products?: Product[];
}

export function StockCountMonitorCard({
  canReviewStock,
  isLoading,
  isError,
  error,
  stockCountSessions,
  damagedRecords: _damagedRecords,
  sessionTotalItems,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  selectedSession,
  selectedSessionTotals: _selectedSessionTotals,
  sessionFilter,
  postingPin: _postingPin,
  postPending,
  postError,
  postSuccess,
  transferSuccess,
  transferError,
  onSessionFilterChange,
  onPostingPinChange: _onPostingPinChange,
  onSelectSession,
  onPostSession,
  onDeleteSession,
  deletePending = false,
  onCopySessionDetails,
  onPrintCountSessions,
  onPrintDamagedRecords: _onPrintDamagedRecords,
  onExportDamagedCsv: _onExportDamagedCsv,
  onPrintSession,
  selectedSessionIds = [],
  onSelectedSessionIdsChange,
  onPostSelectedSessions,
  onStartNewCount,
  products = [],
}: StockCountMonitorCardProps) {
  const { t } = useTranslation();
  const currencySymbol = getGlobalCurrencySymbol();
  // INV-FE2-FRONTEND-BOOK-DIGITS: the session money summary rounds at
  // the tenant's book digits (global system currency, synced from
  // tenant settings at boot).
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());

  const [itemSearch, setItemSearch] = useState('');
  const [itemFilter, setItemFilter] = useState<'all' | 'variance' | 'matched'>('all');
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsPageSize, setItemsPageSize] = useState(25);

  const [activeView, setActiveView] = useState<'list' | 'audit'>('list');

  const handleSelectSession = (id: string) => {
    onSelectSession(id);
    setItemSearch('');
    setItemFilter('all');
    setItemsPage(1);
    setActiveView('audit');
  };

  const selectedSummary = useMemo(
    () => (selectedSession ? summarizeSessionVariance(selectedSession, products, bookDigits) : null),
    [selectedSession, products, bookDigits],
  );

  const overallStats = useMemo(() => {
    let total = stockCountSessions.length;
    let draft = 0;
    let posted = 0;
    for (const session of stockCountSessions) {
      if (session.status === 'draft' || session.status === 'posting') draft++;
      if (session.status === 'posted') posted++;
    }
    return { total, draft, posted };
  }, [stockCountSessions]);

  const filteredSessionItems = useMemo(() => {
    if (!selectedSession || !Array.isArray(selectedSession.items)) return [];
    let list = selectedSession.items;
    const query = itemSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => {
        const prod = products.find((p) => String(p.id) === String(item.productId));
        const name = String(item.productName || '').toLowerCase();
        const barcode = String(prod?.barcode || '').toLowerCase();
        const styleCode = String(prod?.styleCode || '').toLowerCase();
        return name.includes(query) || barcode.includes(query) || styleCode.includes(query);
      });
    }
    if (itemFilter === 'variance') {
      list = list.filter((item) => Number(item.varianceQty || 0) !== 0);
    } else if (itemFilter === 'matched') {
      list = list.filter((item) => Number(item.varianceQty || 0) === 0);
    }
    return list;
  }, [selectedSession, itemSearch, itemFilter, products]);

  const totalFilteredItems = filteredSessionItems.length;
  const pagedSessionItems = useMemo(() => {
    const start = (itemsPage - 1) * itemsPageSize;
    return filteredSessionItems.slice(start, start + itemsPageSize);
  }, [filteredSessionItems, itemsPage, itemsPageSize]);

  const tableSelection = canReviewStock
    ? {
      selectedKeys: selectedSessionIds,
      onChange: onSelectedSessionIdsChange || (() => {}),
      checkboxLabel: (session: StockCountSession) => `تحديد جلسة ${session.docNo || session.id}`,
    }
    : undefined;

  if (activeView === 'audit' && selectedSession) {
    return (
      <>
        <FormSection
          title={(
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setActiveView('list');
                  onSelectSession('');
                }}
                style={{ fontWeight: 700, gap: '6px' }}
              >
                <ArrowRightIcon size={15} />
                <span>العودة لقائمة كافة الجلسات</span>
              </Button>
              <div style={{ width: '1px', height: '22px', backgroundColor: '#e2e8f0' }} />
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <CheckShieldIcon size={20} color="#170e5e" />
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  تدقيق ومطابقة الجلسة: {selectedSession.docNo || selectedSession.id}
                </span>
                <span
                  className="nav-pill"
                  style={{
                    background: selectedSession.status === 'posted' ? '#f0fdf4' : '#fffbeb',
                    color: selectedSession.status === 'posted' ? '#16a34a' : '#b45309',
                    border: `1px solid ${selectedSession.status === 'posted' ? '#bbf7d0' : '#fde68a'}`,
                    fontWeight: 700,
                  }}
                >
                  {getSessionStatusLabel(selectedSession.status)}
                </span>
              </div>
            </div>
          )}
          description="مطابقة الأرصدة الدفترية مع الجرد الفعلي، فحص الفروقات تفصيلياً، واعتماد التسوية المخزنية والمحاسبية."
          actions={(
            <div className="actions compact-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap' }}>
              {canReviewStock && (selectedSession.status === 'draft' || selectedSession.status === 'posting') && onPostSession ? (
                <SubmitButton
                  type="button"
                  onClick={() => onPostSession(selectedSession.id)}
                  disabled={postPending || deletePending}
                  idleText={selectedSession.status === 'posting' ? "استئناف الاعتماد" : "اعتماد الجلسة"}
                  pendingText="جارٍ الاعتماد..."
                />
              ) : null}
              {canReviewStock && (selectedSession.status === 'draft' || selectedSession.status === 'posting') && onDeleteSession ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deletePending || postPending}
                  onClick={() => {
                    onDeleteSession(selectedSession.id, selectedSession.docNo);
                    setActiveView('list');
                    onSelectSession('');
                  }}
                  style={{ color: '#b91c1c', borderColor: '#fecaca', background: '#fff5f5', fontWeight: 700, gap: '6px' }}
                  title="إلغاء وحذف مسودة الجلسة نهائياً"
                >
                  <TrashIcon size={14} color="#b91c1c" />
                  <span>إلغاء المسودة</span>
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onPrintSession(selectedSession)}>
                <PrinterIcon size={14} />
                <span>طباعة المحضر</span>
              </Button>
              <Button variant="secondary" onClick={onCopySessionDetails}>
                <CopyIcon size={14} />
                <span>نسخ التفاصيل</span>
              </Button>
            </div>
          )}
        >
          <div className="stock-count-audit-workspace" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Meta details row */}
            <div className="stock-count-audit-meta-row">
              <div className="stock-count-audit-meta-item">المخزن: <strong>{selectedSession.locationName || 'المخزن الرئيسي'}</strong></div>
              <div className="stock-count-audit-meta-item">الفرع: <strong>{selectedSession.branchName || 'الفرع الرئيسي'}</strong></div>
              <div className="stock-count-audit-meta-item">مسؤول العد: <strong>{selectedSession.countedBy || '—'}</strong></div>
              <div className="stock-count-audit-meta-item">تاريخ الجلسة: <strong>{formatDate(selectedSession.createdAt)}</strong></div>
              {selectedSession.approvedBy ? (
                <div className="stock-count-audit-meta-item">الاعتماد: <strong>{selectedSession.approvedBy}</strong> {selectedSession.postedAt ? `في ${formatDate(selectedSession.postedAt)}` : ''}</div>
              ) : null}
              {selectedSession.note ? (
                <div className="stock-count-audit-meta-item" style={{ flexBasis: '100%' }}>ملاحظات: <strong>{selectedSession.note}</strong></div>
              ) : null}
            </div>

            {/* Audit Financial KPIs (4 Cards Grid) */}
            <div className="stock-count-audit-kpis">
              <div className="stock-count-audit-kpi-card">
                <span className="stock-count-audit-kpi-title">أصناف الجلسة</span>
                <span className="stock-count-audit-kpi-val">{selectedSummary?.itemsCount || 0} صنف</span>
                <span className="stock-count-audit-kpi-desc">
                  {selectedSummary?.varianceItemsCount ? `${selectedSummary.varianceItemsCount} صنف به فارق` : 'كافة الأصناف مطابقة'}
                </span>
              </div>

              <div className="stock-count-audit-kpi-card">
                <span className="stock-count-audit-kpi-title">قيمة المخزون الدفتري</span>
                <span className="stock-count-audit-kpi-val">
                  {(selectedSummary?.expectedValue || 0).toLocaleString('ar-EG')} {currencySymbol}
                </span>
                <span className="stock-count-audit-kpi-desc">رصيد النظام المسجل قبل الجرد</span>
              </div>

              <div className="stock-count-audit-kpi-card">
                <span className="stock-count-audit-kpi-title">قيمة المخزون الفعلي المجرود</span>
                <span className="stock-count-audit-kpi-val">
                  {(selectedSummary?.countedValue || 0).toLocaleString('ar-EG')} {currencySymbol}
                </span>
                <span className="stock-count-audit-kpi-desc">إجمالي قيمة ما تم عده في المخزن</span>
              </div>

              <div className="stock-count-audit-kpi-card">
                <span className="stock-count-audit-kpi-title">الأثر المالي للتسوية</span>
                <span
                  className="stock-count-audit-kpi-val"
                  style={{
                    color:
                      (selectedSummary?.netFinancialVariance || 0) === 0
                        ? '#0f172a'
                        : (selectedSummary?.netFinancialVariance || 0) < 0
                        ? '#b91c1c'
                        : '#15803d',
                  }}
                >
                  {(selectedSummary?.netFinancialVariance || 0) === 0
                    ? `0.00 ${currencySymbol}`
                    : (selectedSummary?.netFinancialVariance || 0) < 0
                    ? `${Math.abs(selectedSummary?.netFinancialVariance || 0).toLocaleString('ar-EG')} ${currencySymbol} (عجز)`
                    : `${(selectedSummary?.netFinancialVariance || 0).toLocaleString('ar-EG')} ${currencySymbol} (فائض)`}
                </span>
                <span className="stock-count-audit-kpi-desc">
                  {(selectedSummary?.netFinancialVariance || 0) === 0
                    ? 'لا توجد فروقات مالية'
                    : (selectedSummary?.netFinancialVariance || 0) < 0
                    ? 'خسارة تسوية مخزنية تُرحل لحساب عجز الجرد'
                    : 'أرباح تسوية مخزنية تُرحل لحساب فائض الجرد'}
                </span>
              </div>
            </div>

            {/* Items Search & Filter Toolbar */}
            <div className="stock-count-audit-toolbar">
              <div className="stock-count-audit-search-box">
                <SearchIcon size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو الكود أو الباركود داخل الجلسة..."
                  value={itemSearch}
                  onChange={(e) => { setItemSearch(e.target.value); setItemsPage(1); }}
                />
              </div>

              <div className="stock-count-audit-filter-pills">
                <button
                  type="button"
                  className={`stock-count-audit-pill ${itemFilter === 'all' ? 'stock-count-audit-pill--active' : ''}`}
                  onClick={() => { setItemFilter('all'); setItemsPage(1); }}
                >
                  كل البنود ({selectedSummary?.itemsCount || 0})
                </button>
                <button
                  type="button"
                  className={`stock-count-audit-pill ${itemFilter === 'variance' ? 'stock-count-audit-pill--active' : ''}`}
                  onClick={() => { setItemFilter('variance'); setItemsPage(1); }}
                >
                  فروقات فقط ({selectedSummary?.varianceItemsCount || 0})
                </button>
                <button
                  type="button"
                  className={`stock-count-audit-pill ${itemFilter === 'matched' ? 'stock-count-audit-pill--active' : ''}`}
                  onClick={() => { setItemFilter('matched'); setItemsPage(1); }}
                >
                  مطابقة ({(selectedSummary?.itemsCount || 0) - (selectedSummary?.varianceItemsCount || 0)})
                </button>
              </div>

              {/* Page Size Switcher */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>عرض:</span>
                {[25, 50, 100].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className={`stock-count-audit-pill ${itemsPageSize === sz ? 'stock-count-audit-pill--active' : ''}`}
                    style={{ padding: '3px 8px', fontSize: '11.5px' }}
                    onClick={() => { setItemsPageSize(sz); setItemsPage(1); }}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Direct Clean Full-Width Items Table */}
            <div className="stock-count-audit-table-wrap">
              <table className="stock-count-audit-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                    <th>الصنف والرمز</th>
                    <th style={{ width: '110px' }}>الرصيد الدفتري</th>
                    <th style={{ width: '110px' }}>الرصيد الفعلي</th>
                    <th style={{ width: '100px' }}>فارق الكمية</th>
                    <th style={{ width: '100px' }}>سعر التكلفة</th>
                    <th style={{ width: '120px' }}>الأثر المالي</th>
                    <th>سبب الفارق والملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSessionItems.length ? (
                    pagedSessionItems.map((item, idx) => {
                      const prod = products.find((p) => String(p.id) === String(item.productId));
                      const cost = Number(prod?.costPrice ?? (item as { unitCost?: number }).unitCost ?? 0);
                      const variance = Number(item.varianceQty || 0);
                      const finImpact = variance * cost;
                      const isDeficit = variance < 0;
                      const rowNum = (itemsPage - 1) * itemsPageSize + idx + 1;

                      return (
                        <tr key={item.id || `${selectedSession.id}-${item.productId}`}>
                          <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11.5px' }}>{rowNum}</td>
                          <td>
                            <strong style={{ display: 'block', color: '#0f172a' }}>{item.productName || '—'}</strong>
                            <div className="muted" style={{ fontSize: '11px', display: 'flex', gap: '8px' }}>
                              {prod?.styleCode ? <span>كود: {prod.styleCode}</span> : null}
                              {prod?.barcode ? <span>باركود: {prod.barcode}</span> : null}
                            </div>
                          </td>
                          <td><strong style={{ color: '#334155' }}>{item.expectedQty}</strong></td>
                          <td><strong style={{ color: '#0f172a' }}>{item.countedQty}</strong></td>
                          <td>
                            {variance === 0 ? (
                              <span style={{ color: '#64748b', fontWeight: 600 }}>0</span>
                            ) : isDeficit ? (
                              <span style={{ color: '#b91c1c', fontWeight: 700 }}>-{Math.abs(variance).toLocaleString('ar-EG')}</span>
                            ) : (
                              <span style={{ color: '#15803d', fontWeight: 700 }}>+{variance.toLocaleString('ar-EG')}</span>
                            )}
                          </td>
                          <td style={{ color: '#475569' }}>
                            {cost > 0 ? `${cost.toFixed(2)} ${currencySymbol}` : '—'}
                          </td>
                          <td>
                            {variance !== 0 && cost > 0 ? (
                              <span style={{ color: isDeficit ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                                {isDeficit ? '-' : '+'}{Math.abs(finImpact).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencySymbol}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                          <td style={{ color: item.reason || item.note ? '#334155' : '#94a3b8', fontSize: '12px' }}>
                            {item.reason || item.note || '—'}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                        لا توجد بنود تطابق معايير الفلترة الحالية.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Items Pager */}
            {totalFilteredItems > itemsPageSize ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b', marginTop: '10px' }}>
                <div>
                  عرض {Math.min(totalFilteredItems, (itemsPage - 1) * itemsPageSize + 1)} إلى {Math.min(totalFilteredItems, itemsPage * itemsPageSize)} من أصل {totalFilteredItems} بند
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={itemsPage <= 1}
                    onClick={() => setItemsPage((p) => Math.max(1, p - 1))}
                    style={{ padding: '3px 10px', fontSize: '12px' }}
                  >
                    السابق
                  </Button>
                  <span style={{ padding: '4px 8px', fontWeight: 700, color: '#0f172a' }}>
                    {itemsPage} / {Math.ceil(totalFilteredItems / itemsPageSize)}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={itemsPage >= Math.ceil(totalFilteredItems / itemsPageSize)}
                    onClick={() => setItemsPage((p) => p + 1)}
                    style={{ padding: '3px 10px', fontSize: '12px' }}
                  >
                    التالي
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Footer Assurance & Decision Bar */}
            <div className="stock-count-audit-footer">
              <div
                className={`stock-count-audit-assurance-note ${
                  selectedSession.status === 'posted' ? 'stock-count-audit-assurance-note--posted' : ''
                }`}
              >
                <CheckCircleIcon size={18} color={selectedSession.status === 'posted' ? '#15803d' : '#2563eb'} />
                <span>
                  {selectedSession.status === 'posted'
                    ? `تم اعتماد وترحيل هذه الجلسة نهائياً إلى المخازن والحسابات العامة بواسطة (${selectedSession.approvedBy || 'المشرف'}) في ${formatDate(selectedSession.postedAt)}.`
                    : canReviewStock
                    ? "تنبيه رقابي ومحاسبي: عند اعتماد هذه الجلسة، سيتم تسجيل تسوية مخزنية تلقائية لجميع الفروقات وتوليد قيد محاسبي مزدوج بالأثر المالي في الحسابات العامة."
                    : "هذه الجلسة بانتظار مراجعة واعتماد مستخدم لديه صلاحية تسوية المخزون."}
                </span>
              </div>

              <div className="actions compact-actions">
                <Button variant="secondary" onClick={() => onPrintSession(selectedSession)}>
                  <PrinterIcon size={15} />
                  <span>طباعة المحضر</span>
                </Button>
                {canReviewStock && (selectedSession.status === 'draft' || selectedSession.status === 'posting') && onPostSession ? (
                  <SubmitButton
                    type="button"
                    onClick={() => onPostSession(selectedSession.id)}
                    disabled={postPending || deletePending}
                    idleText={selectedSession.status === 'posting' ? "استئناف الاعتماد" : "اعتماد الجلسة"}
                    pendingText="جارٍ الاعتماد..."
                  />
                ) : null}
                {canReviewStock && (selectedSession.status === 'draft' || selectedSession.status === 'posting') && onDeleteSession ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={deletePending || postPending}
                    onClick={() => {
                      onDeleteSession(selectedSession.id, selectedSession.docNo);
                      setActiveView('list');
                    }}
                    style={{ color: '#b91c1c', borderColor: '#fecaca', background: '#fff5f5', fontWeight: 700, gap: '6px' }}
                    title="إلغاء وحذف مسودة الجلسة نهائياً"
                  >
                    <TrashIcon size={15} color="#b91c1c" />
                    <span>إلغاء المسودة</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </FormSection>

        <MutationFeedback isError={Boolean(transferError) || Boolean(postError)} isSuccess={transferSuccess || postSuccess} error={transferError || postError} showErrorCode errorFallback={t('inventory.sections.stock_count_monitor_card.s62', "تعذر تنفيذ العملية")} successText={t('inventory.sections.stock_count_monitor_card.s63', "تم تنفيذ العملية بنجاح.")} />
      </>
    );
  }

  return (
    <FormSection
      title={t('inventory.sections.stock_count_monitor_card.s0', "سجل ومراجعة جلسات الجرد")}
      description={t('inventory.sections.stock_count_monitor_card.s1', "مراجعة وتدقيق جلسات الجرد المسجلة، فحص الفروقات، واعتماد التسويات المخزنية والمحاسبية.")}
      actions={(
        <div className="actions compact-actions">
          {onStartNewCount ? <Button variant="primary" onClick={onStartNewCount}>{t('inventory.sections.stock_count_monitor_card.s2', "بدء جلسة جديدة")}</Button> : null}
          <Button variant="secondary" onClick={onPrintCountSessions} disabled={!stockCountSessions.length}>{t('inventory.sections.stock_count_monitor_card.s3', "طباعة الجلسات")}</Button>
          <span className="nav-pill">{sessionTotalItems} {t('inventory.sections.stock_count_monitor_card.s4', "جلسة")}</span>
        </div>
      )}
    >
      <div className="stock-count-monitor-fullwidth">
        {/* Calm Filter Toolbar */}
        <div className="stock-count-filter-toolbar" style={{ marginBottom: '8px' }}>
          <div className="filter-chip-row">
            <Button type="button" variant={sessionFilter === 'all' ? 'primary' : 'secondary'} onClick={() => onSessionFilterChange('all')}>
              {t('inventory.sections.stock_count_monitor_card.s5', "الكل")} ({overallStats.total})
            </Button>
            <Button type="button" variant={sessionFilter === 'draft' ? 'primary' : 'secondary'} onClick={() => onSessionFilterChange('draft')}>
              {t('inventory.sections.stock_count_monitor_card.s6', "مسودة")} ({overallStats.draft})
            </Button>
            <Button type="button" variant={sessionFilter === 'posted' ? 'primary' : 'secondary'} onClick={() => onSessionFilterChange('posted')}>
              {t('inventory.sections.stock_count_monitor_card.s7', "معتمد")} ({overallStats.posted})
            </Button>
          </div>
        </div>

        <QueryFeedback
          isLoading={isLoading}
          isError={isError}
          error={error}
          isEmpty={!stockCountSessions.length}
          loadingText={t('inventory.sections.stock_count_monitor_card.s8', "جاري تحميل جلسات الجرد...")}
          emptyTitle={t('inventory.sections.stock_count_monitor_card.s9', "لا توجد جلسات جرد مسجلة حتى الآن")}
          emptyHint={t('inventory.sections.stock_count_monitor_card.s10', "اضغط على زر (بدء جلسة جرد جديدة) لاختيار المخزن والأصناف وبدء العد.")}
        >
          {/* 1. Full-Width Sessions Master Table */}
          <div className="stock-count-sessions-master">
            {canReviewStock && selectedSessionIds.length ? (
              <div className="bulk-toolbar" style={{ marginBottom: 12 }}>
                <strong>{t('inventory.sections.stock_count_monitor_card.s11', "تم تحديد")} {selectedSessionIds.length} {t('inventory.sections.stock_count_monitor_card.s12', "جلسة")}</strong>
                <div className="actions compact-actions">
                  {onPostSelectedSessions ? <Button type="button" variant="primary" onClick={onPostSelectedSessions} disabled={postPending}>{t('inventory.sections.stock_count_monitor_card.s13', "اعتماد المحدد")}</Button> : null}
                  <Button type="button" variant="secondary" onClick={() => onSelectedSessionIdsChange?.([])}>{t('inventory.sections.stock_count_monitor_card.s14', "إلغاء التحديد")}</Button>
                </div>
              </div>
            ) : null}

            <DataTable
              rows={stockCountSessions}
              rowKey={(session) => String(session.id)}
              onRowClick={(session) => handleSelectSession(String(session.id))}
              rowClassName={(session) => String(selectedSession?.id || '') === String(session.id) ? 'table-row-selected' : undefined}
              rowTitle={(session) => `فحص وتدقيق جلسة الجرد ${session.docNo || session.id}`}
              density="compact"
              selection={tableSelection}
              pagination={{ page, pageSize, onPageChange, onPageSizeChange, totalItems, itemLabel: t('inventory.sections.stock_count_monitor_card.s15', "جلسة") }}
              columns={[
                {
                  key: 'doc',
                  header: "الجلسة والجهة",
                  className: 'text-center',
                  cell: (session) => {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '3px' }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            fontSize: '12.5px',
                            color: '#170e5e',
                            background: '#f1f5f9',
                            padding: '2px 10px',
                            borderRadius: '5px',
                            border: '1px solid #e2e8f0',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {session.docNo || session.id}
                        </span>
                        <div style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>
                          {session.locationName || 'المخزن الرئيسي'} · {session.branchName || 'الفرع الرئيسي'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span>العد: <strong style={{ color: '#0f172a' }}>{session.countedBy || '—'}</strong></span>
                          <span>·</span>
                          <span dir="ltr" style={{ fontWeight: 500 }}>{formatDate(session.createdAt)}</span>
                        </div>
                      </div>
                    );
                  },
                },
                {
                  key: 'status',
                  header: t('inventory.sections.stock_count_monitor_card.s18', "الحالة"),
                  className: 'text-center',
                  cell: (session) => {
                    const isPosted = session.status === 'posted';
                    return (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: isPosted ? '#15803d' : '#475569' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: isPosted ? '#16a34a' : '#f59e0b', display: 'inline-block' }} />
                          <span>{getSessionStatusLabel(session.status)}</span>
                        </div>
                      </div>
                    );
                  },
                },
                {
                  key: 'summary',
                  header: "محتوى الجلسة",
                  className: 'text-center',
                  cell: (session) => {
                    const summary = summarizeSessionVariance(session, products, bookDigits);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{summary.itemsCount} صنفاً</strong>
                        {summary.hasVariance ? (
                          <div style={{ color: '#b91c1c', fontSize: '11px', fontWeight: 600 }}>
                            {summary.varianceItemsCount} صنف به فارق
                          </div>
                        ) : (
                          <div style={{ color: '#16a34a', fontSize: '11px', fontWeight: 600 }}>
                            مطابقة بالكامل
                          </div>
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: 'variance',
                  header: "الأثر الكمي والمالي",
                  className: 'text-center',
                  cell: (session) => {
                    const summary = summarizeSessionVariance(session, products, bookDigits);
                    const isNegative = summary.totalVariance < 0;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 700, color: summary.totalVariance === 0 ? '#64748b' : isNegative ? '#b91c1c' : '#15803d' }}>
                          {summary.totalVariance === 0
                            ? 'مطابق (0)'
                            : isNegative
                            ? `-${Math.abs(summary.totalVariance).toLocaleString('ar-EG')} قطعة`
                            : `+${summary.totalVariance.toLocaleString('ar-EG')} قطعة`}
                        </div>
                        {summary.netFinancialVariance !== 0 ? (
                          <div style={{ fontSize: '11px', marginTop: '2px', fontWeight: 600, color: summary.netFinancialVariance < 0 ? '#b91c1c' : '#15803d' }}>
                            {summary.netFinancialVariance < 0
                              ? `عجز: ${Math.abs(summary.netFinancialVariance).toLocaleString('ar-EG')} ${currencySymbol}`
                              : `فائض: ${summary.netFinancialVariance.toLocaleString('ar-EG')} ${currencySymbol}`}
                          </div>
                        ) : null}
                      </div>
                    );
                  },
                },
                {
                  key: 'actions',
                  header: t('inventory.sections.stock_count_monitor_card.s23', "إجراءات"),
                  className: 'text-center',
                  cell: (session) => {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '140px 32px 32px',
                            gap: '8px',
                            alignItems: 'center',
                            justifyItems: 'center',
                          }}
                        >
                          <Button
                            type="button"
                            variant="primary"
                            style={{
                              width: '140px',
                              minWidth: '140px',
                              maxWidth: '140px',
                              justifyContent: 'center',
                              background: '#170e5e',
                              color: '#ffffff',
                              gap: '6px',
                              height: '32px',
                              fontSize: '12px',
                              fontWeight: 700,
                              padding: '0 8px',
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectSession(String(session.id));
                            }}
                            title="عرض تفاصيل الجلسة وتدقيقها"
                          >
                            <EyeIcon size={14} />
                            <span>فحص وتدقيق الجلسة</span>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            style={{
                              width: '32px',
                              height: '32px',
                              minWidth: '32px',
                              maxWidth: '32px',
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              onPrintSession(session);
                            }}
                            title="طباعة محضر الجلسة"
                          >
                            <PrinterIcon size={14} />
                          </Button>
                          {canReviewStock && (session.status === 'draft' || session.status === 'posting') && onDeleteSession ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={deletePending}
                              style={{
                                width: '32px',
                                height: '32px',
                                minWidth: '32px',
                                maxWidth: '32px',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#b91c1c',
                                borderColor: '#fecaca',
                                background: '#fff5f5',
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteSession(session.id, session.docNo);
                              }}
                              title="إلغاء وحذف مسودة الجلسة"
                            >
                              <TrashIcon size={14} color="#b91c1c" />
                            </Button>
                          ) : (
                            <span style={{ width: '32px', height: '32px', display: 'inline-block' }} />
                          )}
                        </div>
                      </div>
                    );
                  },
                },
              ]}
            />
          </div>
        </QueryFeedback>

        <MutationFeedback isError={Boolean(transferError) || Boolean(postError)} isSuccess={transferSuccess || postSuccess} error={transferError || postError} showErrorCode errorFallback={t('inventory.sections.stock_count_monitor_card.s62', "تعذر تنفيذ العملية")} successText={t('inventory.sections.stock_count_monitor_card.s63', "تم تنفيذ العملية بنجاح.")} />
      </div>
    </FormSection>
  );
}
