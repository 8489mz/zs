import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { useTreasuryPage } from '@/features/treasury/hooks/useTreasuryPage';
import { useTreasuryPageActions } from '@/features/treasury/hooks/useTreasuryPageActions';
import { useCreateExpenseMutation } from '@/features/treasury/hooks/useCreateExpenseMutation';
import { useCancelExpenseMutation } from '@/features/treasury/hooks/useCancelExpenseMutation';
import { systemConfirm } from '@/shared/components/system-alert';
import { toast } from '@/shared/components/system-alert';
import type { ExpenseRecord } from '@/types/domain';
import {
  exportExpenseCsv,
  initialExpenseForm,
  validateExpenseForm,
} from '@/features/treasury/lib/treasury-page.helpers';
import { TreasuryExpenseEntryCard } from '@/features/treasury/components/TreasuryExpenseEntryCard';
import { TreasuryExpenseSummaryCard } from '@/features/treasury/components/TreasuryExpenseSummaryCard';
import { TreasuryExpensesRegisterCard } from '@/features/treasury/components/TreasuryExpensesRegisterCard';
import { TreasuryNavTabs } from '@/features/treasury/components/TreasuryNavTabs';
import { SINGLE_STORE_MODE } from '@/config/product-scope';

export function ExpensesPage() {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const { printMatchingExpenses, exportExpenses: exportExpenseRows } = useTreasuryPageActions();
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expensePage, setExpensePage] = useState(1);
  const [expensePageSize, setExpensePageSize] = useState(20);
  const [expenseForm, setExpenseForm] = useState(initialExpenseForm);
  const [isExportingExpenses, setIsExportingExpenses] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const { expensesQuery, branches, locations, expenses, expenseSummary, expensePagination } = useTreasuryPage(
    { page: 1, pageSize: 1, search: '', filter: 'all' }, // We don't need transactions data here
    { page: expensePage, pageSize: expensePageSize, search: expenseSearch }
  );

  const expenseMutation = useCreateExpenseMutation(() => {
    setExpenseForm(initialExpenseForm());
    setExpensePage(1);
    setIsCreateOpen(false);
  });

  const cancelExpenseMutation = useCancelExpenseMutation();

  const handleCancelExpense = async (row: ExpenseRecord) => {
    const ok = await systemConfirm({
      title: t('expenses.cancel_confirm_title', "تأكيد إلغاء المصروف"),
      message: t('expenses.cancel_confirm_message', "سيتم إلغاء المصروف {{title}} بمبلغ {{amount}} وإعادة النقدية إلى الدرج بقيد عكسي. لا يمكن التراجع عن الإلغاء.", { title: row.title, amount: row.amount }),
      confirmText: t('expenses.cancel_confirm_button', "إلغاء المصروف"),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await cancelExpenseMutation.mutateAsync(row);
      toast.success(t('expenses.cancel_success', "تم إلغاء المصروف وإعادة النقدية إلى الدرج"));
    } catch {
      toast.error(t('expenses.cancel_failed', "تعذر إلغاء المصروف"));
    }
  };

  useEffect(() => setExpensePage(1), [expenseSearch]);

  const availableLocations = useMemo(() => {
    if (SINGLE_STORE_MODE || !expenseForm.branchId) return locations;
    return locations.filter((location) => !location.branchId || String(location.branchId) === String(expenseForm.branchId));
  }, [locations, expenseForm.branchId]);
  
  const expenseValidationErrors = useMemo(() => validateExpenseForm(expenseForm, locations), [expenseForm, locations]);

  const exportExpenses = async () => {
    if (!expensePagination?.totalItems) return;
    setIsExportingExpenses(true);
    try {
      exportExpenseCsv(await exportExpenseRows(expenseSearch));
    } finally {
      setIsExportingExpenses(false);
    }
  };

  return (
    <div className="page-stack page-shell treasury-workspace treasury-workspace--compact">
      <main className="document-prototype-column" style={{ paddingBottom: '32px', maxWidth: '1280px' }}>
        <PageHeader 
          title={t('expenses.title', 'المصروفات')} 
          description={t('expenses.description', 'سجل مصاريف التشغيل اليومية والرواتب والإيجارات وغيرها.')} 
          badge={<span className="nav-pill">{t('expenses.services_and_accounts', 'الخدمات والحسابات')}</span>}
          actions={
            <div className="actions compact-actions">
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>{t('expenses.new_expense', '+ مصروف جديد')}</Button>
              <Button variant="secondary" onClick={exportExpenses} disabled={!expensePagination?.totalItems || isExportingExpenses}>{t('common.export', 'تصدير')}</Button>
              <Button variant="secondary" onClick={() => printMatchingExpenses(expenseSearch)} disabled={!expensePagination?.totalItems || isExportingExpenses}>{t('common.print', 'طباعة')}</Button>
            </div>
          }
        />
        <TreasuryNavTabs currentTab="expenses" />
        <TreasuryExpenseSummaryCard
          expenseSummary={expenseSummary}
          expenses={expenses}
        />
        <TreasuryExpensesRegisterCard
          expenseSearch={expenseSearch}
          onExpenseSearchChange={setExpenseSearch}
          onReset={() => { setExpenseSearch(''); setExpensePage(1); }}
          expensesQuery={expensesQuery}
          expenses={expenses}
          expenseSummary={expenseSummary}
          expensePagination={expensePagination}
          expensePageSize={expensePageSize}
          setExpensePage={setExpensePage}
          setExpensePageSize={setExpensePageSize}
          onOpenCreate={() => setIsCreateOpen(true)}
          onCancelExpense={handleCancelExpense}
          cancellingExpenseId={cancelExpenseMutation.isPending ? cancelExpenseMutation.variables?.id : null}
        />

        {/* Modal for Recording Expense */}
        <DialogShell
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          width="min(680px, 95vw)"
          ariaLabel={__t('treasury.expenses_page.s0', "تسجيل مصروف جديد")}
          showCloseButton={true}
        >
          <div className="dialog-card">
            <TreasuryExpenseEntryCard
              expenseForm={expenseForm}
              setExpenseForm={setExpenseForm}
              branches={branches}
              locations={locations}
              availableLocations={availableLocations}
              expenseValidationErrors={expenseValidationErrors}
              expenseMutation={expenseMutation}
              onReset={() => setExpenseForm(initialExpenseForm())}
            />
          </div>
        </DialogShell>
      </main>
    </div>
  );
}
