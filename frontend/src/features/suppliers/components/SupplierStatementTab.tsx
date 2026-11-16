import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { suppliersApi } from '@/features/suppliers/api/suppliers.api';
import { mapSupplierStatementRow } from '@/features/suppliers/api/supplier-statement.utils';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { toast } from '@/shared/components/system-alert';
import {
  DownloadIcon,
  InfoIcon,
  PrinterIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
} from '@/shared/components/icons/AppIcons';
import {
  exportSupplierStatementPdf,
  printSupplierStatementA4,
  printSupplierStatementReceipt,
  resolveEffectiveSupplierPosition,
} from '@/features/suppliers/lib/supplier-statement-print';
import type { Supplier } from '@/types/domain';

type StatementPeriodPreset = 'all' | '30d' | 'month' | 'custom';

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalBoundaryIso(dateInput: string, endOfDay: boolean): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateInput || '').trim());
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = endOfDay
    ? new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the third tab on the supplier card.
 * Loads ALL entries for the selected period (all history by default, or
 * 30d / current month / custom range) via paginated collection so no
 * movement is ever truncated, preserves full opening/credits/debits/
 * closing reconciliation, and exports cleanly to PDF download, A4 print,
 * or 80mm/58mm thermal receipt. */
export function SupplierStatementTab({
  supplier,
  onOpenAdvanceLoaded,
}: {
  supplier: Supplier;
  onOpenAdvanceLoaded?: (openAdvance: number) => void;
}) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const [periodPreset, setPeriodPreset] = useState<StatementPeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState(() => {
    const now = new Date();
    return toLocalDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [customTo, setCustomTo] = useState(() => toLocalDateInputValue(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const dateFilter = useMemo<{ from?: string; to?: string; label: string }>(() => {
    const now = new Date();
    if (periodPreset === 'all') {
      return { from: '2000-01-01T00:00:00.000Z', label: 'منذ البداية (كل الحركات)' };
    }
    if (periodPreset === '30d') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
      return { from: start.toISOString(), label: 'آخر 30 يوم' };
    }
    if (periodPreset === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { from: start.toISOString(), label: 'الشهر الحالي' };
    }
    const fromIso = parseLocalBoundaryIso(customFrom, false);
    const toIso = parseLocalBoundaryIso(customTo, true);
    return {
      from: fromIso,
      to: toIso,
      label: `${customFrom || '—'} إلى ${customTo || 'اليوم'}`,
    };
  }, [periodPreset, customFrom, customTo]);

  const ledgerQuery = useQuery({
    queryKey: [...queryKeys.supplierLedger(String(supplier.id)), periodPreset, dateFilter.from || '', dateFilter.to || ''],
    queryFn: () =>
      suppliersApi.listAllLedger(String(supplier.id), {
        from: dateFilter.from,
        to: dateFilter.to,
      }),
    enabled: Boolean(supplier.id),
  });

  const rows = useMemo(
    () => (ledgerQuery.data?.entries || []).map(mapSupplierStatementRow),
    [ledgerQuery.data?.entries],
  );

  const filteredRows = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      row.typeLabel.toLowerCase().includes(term)
      || row.note.toLowerCase().includes(term)
      || formatDate(row.date).toLowerCase().includes(term),
    );
  }, [rows, searchQuery]);

  const rawSummary = (ledgerQuery.data?.summary || {}) as Record<string, unknown>;
  const liveSupplierBalance = Number(ledgerQuery.data?.supplier?.balance ?? supplier.balance ?? 0);
  const openingBalance = Number(rawSummary.openingBalance ?? 0);
  const totalCredits = Number(rawSummary.totalCredits ?? 0);
  const totalDebits = Number(rawSummary.totalDebits ?? 0);
  const closingBalance = rawSummary.closingBalance != null
    ? Number(rawSummary.closingBalance)
    : openingBalance + totalCredits - totalDebits;
  const openAdvanceBalance = Number(rawSummary.openAdvanceBalance ?? 0);

  useEffect(() => {
    onOpenAdvanceLoaded?.(openAdvanceBalance);
  }, [openAdvanceBalance, onOpenAdvanceLoaded]);

  const totalAdvances = useMemo(
    () => rows
      .filter((row) => row.type === 'supplier_advance')
      .reduce((sum, row) => sum + Number(row.debitShown || 0), 0),
    [rows],
  );

  const effectivePosition = resolveEffectiveSupplierPosition(closingBalance, openAdvanceBalance);

  const buildPrintPayload = () => ({
    supplier: {
      ...supplier,
      balance: liveSupplierBalance,
    },
    rows: filteredRows,
    summary: {
      openingBalance,
      totalCredits,
      totalDebits,
      closingBalance,
      totalAdvances,
      openAdvanceBalance,
      liveSupplierBalance,
    },
    periodLabel: dateFilter.label,
    searchQuery: searchQuery.trim() || undefined,
    settings: settingsQuery.data || null,
  });

  async function handleExportPdf() {
    setIsExportingPdf(true);
    try {
      const fileName = await exportSupplierStatementPdf(buildPrintPayload());
      toast.success(`تم تجهيز وحفظ كشف الحساب بصيغة PDF (${fileName})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تصدير ملف PDF');
    } finally {
      setIsExportingPdf(false);
    }
  }

  function handlePrintA4() {
    try {
      printSupplierStatementA4(buildPrintPayload());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر فتح نافذة الطباعة A4');
    }
  }

  function handlePrintReceipt() {
    try {
      printSupplierStatementReceipt(buildPrintPayload());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر طباعة الريسيت الحراري');
    }
  }

  const presetButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    borderRadius: '7px',
    border: active ? '1px solid #170e5e' : '1px solid #cbd5e1',
    background: active ? '#170e5e' : '#ffffff',
    color: active ? '#ffffff' : '#334155',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'none',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
      {/* 4 Balanced KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '8px',
        }}
      >
        <div style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
            {t('suppliers.supplier_statement_tab.s0', 'ما قبل الفترة')}
          </span>
          <strong style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(openingBalance)}
          </strong>
        </div>

        <div style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
            {t('suppliers.supplier_statement_tab.s1', 'إجمالي المورّد (دائن)')}
          </span>
          <strong style={{ fontSize: '14px', fontWeight: 800, color: '#170e5e', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(totalCredits)}
          </strong>
        </div>

        <div style={{ padding: '8px 10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
          <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
            {t('suppliers.supplier_statement_tab.s2', 'إجمالي المسدد (مدين)')}
          </span>
          <strong style={{ fontSize: '14px', fontWeight: 800, color: '#0f766e', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(totalDebits)}
          </strong>
        </div>

        <div
          style={{
            padding: '8px 10px',
            borderRadius: '10px',
            border: `1px solid ${effectivePosition.border}`,
            background: effectivePosition.bg,
          }}
        >
          <span style={{ display: 'block', fontSize: '11px', color: '#475569', marginBottom: '2px' }}>
            {effectivePosition.label}
          </span>
          <strong style={{ fontSize: '14px', fontWeight: 800, color: effectivePosition.color, fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(effectivePosition.absAmount)}
          </strong>
        </div>
      </div>

      {/* Period, Search & Export Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '8px 10px',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button type="button" style={presetButtonStyle(periodPreset === 'all')} onClick={() => setPeriodPreset('all')}>
            منذ البداية
          </button>
          <button type="button" style={presetButtonStyle(periodPreset === '30d')} onClick={() => setPeriodPreset('30d')}>
            آخر 30 يوم
          </button>
          <button type="button" style={presetButtonStyle(periodPreset === 'month')} onClick={() => setPeriodPreset('month')}>
            الشهر الحالي
          </button>
          <button type="button" style={presetButtonStyle(periodPreset === 'custom')} onClick={() => setPeriodPreset('custom')}>
            فترة مخصصة
          </button>
          {periodPreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="date"
                aria-label="من تاريخ"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                style={{ height: '30px', fontSize: '11.5px', padding: '0 6px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b' }}>إلى</span>
              <input
                type="date"
                aria-label="إلى تاريخ"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                style={{ height: '30px', fontSize: '11.5px', padding: '0 6px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginInlineStart: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '30px',
              width: '175px',
              padding: '0 9px',
              borderRadius: '7px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              boxSizing: 'border-box',
            }}
          >
            <SearchIcon size={13} color="#64748b" style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="بحث في الحركات..."
              aria-label="بحث في حركات كشف الحساب"
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                padding: 0,
                margin: 0,
                height: '100%',
                minHeight: 0,
                width: '100%',
                fontSize: '12px',
                color: '#0f172a',
              }}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => void ledgerQuery.refetch()}
            disabled={ledgerQuery.isFetching}
            title="تحديث كشف الحساب"
            style={{ minHeight: '30px', height: '30px', padding: '0 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <RefreshCwIcon size={13} />
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleExportPdf()}
            disabled={ledgerQuery.isLoading || isExportingPdf}
            style={{ minHeight: '30px', height: '30px', padding: '0 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
          >
            <DownloadIcon size={13} />
            <span>{isExportingPdf ? 'جاري التصدير...' : 'تحميل PDF'}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handlePrintA4}
            disabled={ledgerQuery.isLoading}
            style={{ minHeight: '30px', height: '30px', padding: '0 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
          >
            <PrinterIcon size={13} />
            <span>طباعة A4</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={handlePrintReceipt}
            disabled={ledgerQuery.isLoading}
            style={{ minHeight: '30px', height: '30px', padding: '0 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
          >
            <ReceiptIcon size={13} />
            <span>طباعة ريسيت</span>
          </Button>
        </div>
      </div>

      {totalAdvances > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '8px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            color: '#0c4a6e',
            fontSize: '11.5px',
          }}
        >
          <InfoIcon size={14} />
          <span>
            تشمل الفترة حركات <strong>سحبة / دفعة مقدمة</strong> بإجمالي <strong>{formatCurrency(totalAdvances)}</strong> (تظهر في جدول الحركات وتُسوى تلقائياً مع الفواتير اللاحقة دون تضخيم المديونية).
          </span>
        </div>
      )}

      {ledgerQuery.error && (
        <div className="error-box" style={{ fontSize: '12px', padding: '8px 10px' }}>
          تعذر تحميل كشف الحساب: {ledgerQuery.error instanceof Error ? ledgerQuery.error.message : 'حدث خطأ في الاتصال'}
        </div>
      )}

      {/* Statement Ledger Table */}
      <div
        className="thin-scrollbar"
        style={{
          flex: 1,
          minHeight: '240px',
          maxHeight: '285px',
          overflowY: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          background: '#ffffff',
        }}
      >
        <DataTable
          ariaLabel={t('suppliers.supplier_statement_tab.s4', 'كشف حساب المورد')}
          density="compact"
          rows={filteredRows}
          empty={
            <div style={{ textAlign: 'center', padding: '28px 12px', color: '#64748b', fontSize: '12.5px' }}>
              {ledgerQuery.isLoading
                ? t('suppliers.supplier_statement_tab.s5', 'جاري تحميل كشف الحساب...')
                : t('suppliers.supplier_statement_tab.s6', 'لا توجد حركات مسجلة لهذا المورد في الفترة المختارة.')}
            </div>
          }
          columns={[
            {
              key: 'type',
              header: t('suppliers.supplier_statement_tab.s7', 'الحركة'),
              cell: (row) => (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 7px',
                    borderRadius: '999px',
                    background: '#f1f5f9',
                    color: '#1e293b',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.typeLabel}
                </span>
              ),
            },
            {
              key: 'note',
              header: t('suppliers.supplier_statement_tab.s8', 'الملاحظة / المرجع'),
              cell: (row) => <span style={{ fontSize: '12px', color: '#334155' }}>{row.note || '—'}</span>,
            },
            {
              key: 'date',
              header: t('suppliers.supplier_statement_tab.s9', 'التاريخ والوقت'),
              cell: (row) => <span style={{ fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap' }}>{formatDate(row.date)}</span>,
            },
            {
              key: 'debit',
              header: t('suppliers.supplier_statement_tab.s10', 'مسحوب / مدين'),
              className: 'numeric-cell',
              cell: (row) => (
                <span style={{ color: row.debitShown > 0 ? '#0f766e' : '#94a3b8', fontWeight: row.debitShown > 0 ? 700 : 500 }}>
                  {formatCurrency(row.debitShown)}
                </span>
              ),
            },
            {
              key: 'credit',
              header: t('suppliers.supplier_statement_tab.s11', 'مورّد / دائن'),
              className: 'numeric-cell',
              cell: (row) => (
                <span style={{ color: row.creditShown > 0 ? '#170e5e' : '#94a3b8', fontWeight: row.creditShown > 0 ? 700 : 500 }}>
                  {formatCurrency(row.creditShown)}
                </span>
              ),
            },
            {
              key: 'balance',
              header: t('suppliers.supplier_statement_tab.s12', 'الرصيد بعد الحركة'),
              className: 'numeric-cell',
              cell: (row) => (
                <strong
                  style={{
                    color: row.balance > 0.0001 ? '#b45309' : row.balance < -0.0001 ? '#0369a1' : '#15803d',
                  }}
                >
                  {formatCurrency(row.balance)}
                </strong>
              ),
            },
          ]}
          rowKey={(row, index) => `${row.id || 'row'}-${row.date}-${index}`}
        />
      </div>
    </div>
  );
}
