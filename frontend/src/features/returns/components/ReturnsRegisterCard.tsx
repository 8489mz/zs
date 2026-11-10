import { useTranslation } from 'react-i18next';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import { formatCurrency, formatDate } from '@/lib/format';
import { actualReturnRefund, getReturnDateValue, returnTypeLabel } from '@/features/returns/lib/returns-workspace.helpers';
import type { ReturnRecord } from '@/types/domain';

type Props = {
  search: string;
  viewFilter: 'all' | 'sales' | 'purchase' | 'today';
  page: number;
  pageSize: number;
  rows: ReturnRecord[];
  totalItems: number;
  selectedReturnId: string;
  isLoading: boolean;
  onSearchChange: (value: string) => void;
  onReset: () => void;
  onFilterChange: (value: 'all' | 'sales' | 'purchase' | 'today') => void;
  employeeFilter: string;
  onEmployeeFilterChange: (value: string) => void;
  onSelectReturn: (id: string) => void;
  onPrintReturn: (row: ReturnRecord) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function ReturnsRegisterCard({
  search,
  viewFilter,
  page,
  pageSize,
  rows,
  totalItems,
  selectedReturnId,
  isLoading,
  onSearchChange,
  onReset,
  onFilterChange,
  employeeFilter,
  onEmployeeFilterChange,
  onSelectReturn,
  onPrintReturn,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const { t } = useTranslation();

  return (
    <section className="document-prototype-section workspace-panel returns-register-card">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{t('returns.register_title', 'سجل المرتجعات')}</h3>
      </div>
      <div className="filter-chip-row" style={{ marginTop: '8px' }}>
        <Button variant={viewFilter === 'all' ? 'primary' : 'secondary'} onClick={() => onFilterChange('all')}>
          {t('common.all', 'الكل')}
        </Button>
        <Button variant={viewFilter === 'sales' ? 'primary' : 'secondary'} onClick={() => onFilterChange('sales')}>
          {t('returns.filter_sales', 'مرتجع بيع')}
        </Button>
        <Button variant={viewFilter === 'purchase' ? 'primary' : 'secondary'} onClick={() => onFilterChange('purchase')}>
          {t('returns.filter_purchase', 'مرتجع شراء')}
        </Button>
        <Button variant={viewFilter === 'today' ? 'primary' : 'secondary'} onClick={() => onFilterChange('today')}>
          {t('common.today', 'اليوم')}
        </Button>
      </div>
      <SearchToolbar
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={t('returns.search_placeholder', 'ابحث برقم المستند أو الصنف أو الملاحظات')}
        title={t('common.search_and_filter', 'بحث وتصفية')}
        actions={
          <span className="nav-pill">
            {viewFilter === 'all'
              ? t('returns.filter_all_badge', 'كل المرتجعات')
              : viewFilter === 'sales'
              ? t('returns.filter_sales', 'مرتجع بيع')
              : viewFilter === 'purchase'
              ? t('returns.filter_purchase', 'مرتجع شراء')
              : t('common.today', 'اليوم')}
          </span>
        }
        onReset={onReset}
        resetLabel={t('common.clear', 'تفريغ')}
      >
        <Field label={t('returns.operator', 'منفذ المرتجع')}>
          <input
            value={employeeFilter}
            onChange={(event) => onEmployeeFilterChange(event.target.value)}
            placeholder={t('returns.operator_placeholder', 'اسم منفذ المرتجع')}
          />
        </Field>
      </SearchToolbar>
      {isLoading ? (
        <div className="loading-card">{t('returns.loading', 'جاري تحميل المرتجعات...')}</div>
      ) : rows.length ? (
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <DataTable
            rows={rows}
            rowKey={(row) => String(row.id)}
            rowClassName={(row) => (selectedReturnId === String(row.id) ? 'table-row-selected' : '')}
            onRowClick={(row) => onSelectReturn(String(row.id))}
            rowTitle={() => t('returns.row_click_hint', 'انقر لعرض تفاصيل المرتجع')}
            pagination={{
              page,
              pageSize,
              totalItems,
              onPageChange,
              onPageSizeChange: (nextPageSize) => {
                onPageSizeChange(nextPageSize);
                onPageChange(1);
              },
              itemLabel: t('returns.item_unit', 'مرتجع'),
            }}
            columns={[
              {
                key: 'docNo',
                header: t('returns.col_doc_no', 'رقم المستند'),
                cell: (row) => (
                  <div>
                    <strong>{row.docNo || '—'}</strong>
                    {row.invoiceDocNo ? (
                      <div className="muted small" style={{ fontSize: '0.78rem' }}>
                        {t('returns.original_doc', 'أصل')}: {row.invoiceDocNo}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              { key: 'type', header: t('returns.col_type', 'النوع'), cell: (row) => returnTypeLabel(row, t) },
              { key: 'party', header: t('returns.col_party', 'الجهة / العميل'), cell: (row) => row.partyName || '—' },
              { key: 'product', header: t('returns.col_product', 'الصنف'), cell: (row) => row.productName || '—' },
              { key: 'qty', header: t('returns.col_qty', 'الكمية'), cell: (row) => row.qty },
              { key: 'total', header: t('returns.col_total', 'المسترد'), cell: (row) => formatCurrency(actualReturnRefund(row)) },
              { key: 'note', header: t('returns.col_note', 'ملاحظات'), cell: (row) => row.note || '—' },
              { key: 'date', header: t('returns.col_date', 'التاريخ'), cell: (row) => formatDate(getReturnDateValue(row)) },
              { key: 'createdBy', header: t('returns.col_created_by', 'منفذ المرتجع'), cell: (row) => row.createdByName || row.createdBy || '—' },
              {
                key: 'actions',
                header: t('common.actions', 'إجراءات'),
                cell: (row) => (
                  <div className="actions compact-actions" style={{ flexWrap: 'nowrap' }}>
                    <Button
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPrintReturn(row);
                      }}
                    >
                      {t('common.print', 'طباعة')}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div className="empty-state-card">{t('returns.empty', 'لا توجد مرتجعات حاليًا')}</div>
      )}
    </section>
  );
}

