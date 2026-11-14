import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/shared/ui/data-table';
import { formatCurrency, formatDate } from '@/lib/format';
import { queryKeys } from '@/app/query-keys';
import { suppliersApi } from '@/features/suppliers/api/suppliers.api';
import { mapSupplierStatementRow } from '@/features/suppliers/api/supplier-statement.utils';
import type { Supplier } from '@/types/domain';

export function SupplierStatementTab({ supplier }: { supplier: Supplier }) {
  const { t } = useTranslation();
  const ledgerQuery = useQuery({
    queryKey: queryKeys.supplierLedger(String(supplier.id)),
    queryFn: () => suppliersApi.ledger(String(supplier.id)),
  });

  const rows = useMemo(
    () => (ledgerQuery.data?.entries || []).map((entry) => mapSupplierStatementRow(entry)),
    [ledgerQuery.data],
  );

  /* The API summary orients the totals for suppliers (see
   * buildSupplierLedgerPayload): totalDebits is what was paid /
   * withdrawn, totalCredits is what was brought. closingBalance is
   * opening + brought - withdrawn — the remaining balance. */
  const summary = (ledgerQuery.data?.summary || {}) as Record<string, unknown>;
  const openingBalance = Number(summary.openingBalance ?? 0);
  const broughtTotal = Number(summary.totalCredits ?? 0);
  const withdrawnTotal = Number(summary.totalDebits ?? 0);
  const remaining = Number(summary.closingBalance ?? supplier.balance ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        <div className="stat-card"><span>{t('suppliers.supplier_statement_tab.s0', 'رصيد افتتاحي')}</span><strong>{formatCurrency(openingBalance)}</strong></div>
        <div className="stat-card"><span>{t('suppliers.supplier_statement_tab.s1', 'إجمالي ما تم توريده')}</span><strong>{formatCurrency(broughtTotal)}</strong></div>
        <div className="stat-card"><span>{t('suppliers.supplier_statement_tab.s2', 'إجمالي المسدد / المسحوب')}</span><strong>{formatCurrency(withdrawnTotal)}</strong></div>
        <div className="stat-card"><span>{t('suppliers.supplier_statement_tab.s3', 'الرصيد المتبقي')}</span><strong>{formatCurrency(remaining)}</strong></div>
      </div>
      {ledgerQuery.isError ? (
        <div className="muted small">{t('suppliers.supplier_statement_tab.s4', 'تعذر تحميل كشف حساب المورد.')}</div>
      ) : null}
      <DataTable
        ariaLabel={t('suppliers.supplier_statement_tab.s5', 'كشف حساب المورد')}
        density="compact"
        rows={rows}
        empty={<div className="muted small">{ledgerQuery.isPending ? t('suppliers.supplier_statement_tab.s6', 'جارٍ التحميل...') : t('suppliers.supplier_statement_tab.s7', 'لا توجد قيود لهذا المورد بعد.')}</div>}
        columns={[
          { key: 'type', header: t('suppliers.supplier_statement_tab.s8', 'النوع'), cell: (row) => row.typeLabel },
          { key: 'note', header: t('suppliers.supplier_statement_tab.s9', 'الملاحظة'), cell: (row) => row.note || '—' },
          { key: 'date', header: t('suppliers.supplier_statement_tab.s10', 'التاريخ'), cell: (row) => (row.date ? formatDate(row.date) : '—') },
          { key: 'debit', header: t('suppliers.supplier_statement_tab.s11', 'مسحوب / مدين'), className: 'numeric-cell', cell: (row) => formatCurrency(row.debitShown) },
          { key: 'credit', header: t('suppliers.supplier_statement_tab.s12', 'مورَّد / دائن'), className: 'numeric-cell', cell: (row) => formatCurrency(row.creditShown) },
          { key: 'balance', header: t('suppliers.supplier_statement_tab.s13', 'الرصيد'), className: 'numeric-cell', cell: (row) => formatCurrency(row.balance) },
        ]}
        rowKey={(row, index) => `${row.id || 'row'}-${index}`}
      />
    </div>
  );
}
