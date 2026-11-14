import { useTranslation } from 'react-i18next';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { PaginationControls } from '@/shared/components/pagination-controls';
import { formatCurrency, formatDate } from '@/lib/format';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import type { ExpenseRecord } from '@/types/domain';
import { formatScopeLabel } from '@/features/treasury/lib/treasury-page.helpers';

export function TreasuryExpensesRegisterCard({ expenseSearch, onExpenseSearchChange, onReset, expensesQuery, expenses, expenseSummary, expensePagination, expensePageSize, setExpensePage, setExpensePageSize, onOpenCreate, onCancelExpense, cancellingExpenseId }: {
  expenseSearch: string;
  onExpenseSearchChange: (value: string) => void;
  onReset: () => void;
  expensesQuery: { isLoading: boolean; isError: boolean; error?: unknown };
  expenses: ExpenseRecord[];
  expenseSummary: { totalItems: number };
  expensePagination?: { page: number; totalPages: number; pageSize: number; totalItems: number; rangeStart: number; rangeEnd: number };
  expensePageSize: number;
  setExpensePage: (page: number) => void;
  setExpensePageSize: (pageSize: number) => void;
  onOpenCreate?: () => void;
  onCancelExpense?: (row: ExpenseRecord) => void;
  cancellingExpenseId?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <section className="document-prototype-section expenses-register-section">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{t('treasury.treasury_expenses_register_card.s0', "سجل المصروفات")}</h3>
        <div className="section-header-actions-group">
          {onOpenCreate && (
            <Button variant="primary" onClick={onOpenCreate} className="section-header-action-btn">
              {t('treasury.treasury_expenses_register_card.s1', "+ مصروف جديد")}
            </Button>
          )}
          <Button variant="secondary" onClick={onReset} className="section-header-action-btn" style={{ marginInlineStart: '6px' }}>
            {t('treasury.treasury_expenses_register_card.s2', "إلغاء الفلاتر")}
          </Button>
        </div>
      </div>
      <SearchToolbar
        title={t('treasury.treasury_expenses_register_card.s3', "بحث وتصفية")}
        actions={<span className="nav-pill">{t('treasury.treasury_expenses_register_card.s4', "العدد:")} {expenseSummary.totalItems}</span>}
        search={expenseSearch}
        onSearchChange={onExpenseSearchChange}
        searchPlaceholder={SINGLE_STORE_MODE ? t('treasury.treasury_expenses_register_card.s5', "ابحث باسم المصروف أو الملاحظات أو المخزن") : t('treasury.treasury_expenses_register_card.s6', "ابحث باسم المصروف أو الملاحظات أو الفرع")}
        onReset={onReset}
        resetLabel={t('treasury.treasury_expenses_register_card.s7', "تفريغ")}
      />
      <QueryFeedback isLoading={expensesQuery.isLoading} isError={expensesQuery.isError} error={expensesQuery.error} isEmpty={!expenseSummary.totalItems} loadingText={t('treasury.treasury_expenses_register_card.s8', "جاري تحميل المصروفات...")} errorTitle={t('treasury.treasury_expenses_register_card.s9', "تعذر تحميل المصروفات")} emptyTitle={t('treasury.treasury_expenses_register_card.s10', "لا توجد مصروفات مسجلة حاليًا")} emptyHint={t('treasury.treasury_expenses_register_card.s11', "سجل أول مصروف من النموذج أعلاه وسيظهر هنا مباشرة.")}>
          <DataTable 
            rows={expenses} 
            columns={[
              { 
                key: 'title', 
                header: t('treasury.treasury_expenses_register_card.s12', "المصروف"), 
                cell: (row: ExpenseRecord) => (
                  <strong style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.86rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>
                    {row.title}
                  </strong>
                ) 
              },
              { 
                key: 'amount', 
                header: t('treasury.treasury_expenses_register_card.s13', "المبلغ"), 
                cell: (row: ExpenseRecord) => (
                  <span style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.88rem', direction: 'ltr', display: 'inline-block' }}>
                    {formatCurrency(row.amount)}
                  </span>
                ) 
              },
              { 
                key: 'note', 
                header: t('treasury.treasury_expenses_register_card.s14', "ملاحظات"), 
                cell: (row: ExpenseRecord) => (
                  <div 
                    title={row.note || ''}
                    style={{
                      fontSize: '0.8rem',
                      color: '#475569',
                      lineHeight: 1.35,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      wordBreak: 'break-word',
                      whiteSpace: 'normal',
                      maxHeight: '2.7em',
                    }}
                  >
                    {row.note || '—'}
                  </div>
                ) 
              },
              { 
                key: 'scope', 
                header: SINGLE_STORE_MODE ? t('treasury.treasury_expenses_register_card.s15', "المخزن") : t('treasury.treasury_expenses_register_card.s16', "الفرع/المخزن"), 
                cell: (row: ExpenseRecord) => (
                  <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={formatScopeLabel(row)}>
                    {formatScopeLabel(row)}
                  </span>
                ) 
              },
              { 
                key: 'user', 
                header: t('treasury.treasury_expenses_register_card.s17', "المنفذ"), 
                cell: (row: ExpenseRecord) => (
                  <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600, background: '#f1f5f9', padding: '2px 7px', borderRadius: '4px', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.createdBy || ''}>
                    {row.createdBy || '—'}
                  </span>
                ) 
              },
              { 
                key: 'date', 
                header: t('treasury.treasury_expenses_register_card.s18', "التاريخ والوقت"), 
                cell: (row: ExpenseRecord) => (
                  <span style={{ fontSize: '0.82rem', color: '#64748b', whiteSpace: 'nowrap', display: 'inline-block', minWidth: '150px', paddingInlineEnd: '12px' }}>
                    {formatDate(row.date)}
                  </span>
                ) 
              },
              {
                key: 'status',
                header: t('treasury.treasury_expenses_register_card.s20', "الحالة"),
                cell: (row: ExpenseRecord) => (
                  row.cancelledAt ? (
                    <span style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 700, background: '#fee2e2', padding: '2px 7px', borderRadius: '4px', display: 'inline-block', whiteSpace: 'nowrap' }} title={row.cancelReason || ''}>
                      {t('treasury.treasury_expenses_register_card.s21', "ملغي")}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700, background: '#dcfce7', padding: '2px 7px', borderRadius: '4px', display: 'inline-block', whiteSpace: 'nowrap' }}>
                      {t('treasury.treasury_expenses_register_card.s22', "مسجل")}
                    </span>
                  )
                )
              },
              {
                key: 'actions',
                header: t('treasury.treasury_expenses_register_card.s23', "إجراءات"),
                cell: (row: ExpenseRecord) => (
                  row.cancelledAt || !onCancelExpense ? (
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>—</span>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={cancellingExpenseId === row.id}
                      onClick={() => onCancelExpense(row)}
                    >
                      {t('treasury.treasury_expenses_register_card.s24', "إلغاء")}
                    </Button>
                  )
                )
              }
            ]} 
          />
          <PaginationControls page={expensePagination?.page || 1} totalPages={expensePagination?.totalPages || 1} pageSize={expensePagination?.pageSize || expensePageSize} pageSizeOptions={[10,20,50,100]} totalItems={expensePagination?.totalItems || 0} rangeStart={expensePagination?.rangeStart || 0} rangeEnd={expensePagination?.rangeEnd || 0} onPageChange={setExpensePage} onPageSizeChange={(value) => { setExpensePageSize(value); setExpensePage(1); }} itemLabel={t('treasury.treasury_expenses_register_card.s19', "مصروف")} />
        </QueryFeedback>
    </section>
  );
}
