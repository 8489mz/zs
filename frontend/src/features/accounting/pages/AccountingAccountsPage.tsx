import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { DataTable } from '@/shared/components/data-table';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { FormSection } from '@/shared/components/form-section';
import { accountingApi, type AccountingAccount } from '@/features/accounting/api/accounting.api';
import { AccountingAccountForm } from '../components/AccountingAccountForm';
import { translateUiText } from '@/lib/auto-translator';
import { formatCurrency } from '@/lib/format';

const typeLabel: Record<string, string> = {
  asset: 'أصل',
  contra_asset: 'أصل عكسي',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  contra_revenue: 'إيراد عكسي',
  expense: 'مصروف',
};

const typeLabelEn: Record<string, string> = {
  asset: 'Asset',
  contra_asset: 'Contra Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  contra_revenue: 'Contra Revenue',
  expense: 'Expense',
};

const balanceLabel: Record<string, string> = {
  debit: 'مدين',
  credit: 'دائن',
};

const balanceLabelEn: Record<string, string> = {
  debit: 'Debit',
  credit: 'Credit',
};

const groupLabel: Record<string, string> = {
  assets: 'أصول',
  current_assets: 'أصول متداولة',
  fixed_assets: 'أصول ثابتة',
  liabilities: 'خصوم',
  current_liabilities: 'خصوم متداولة',
  equity: 'حقوق ملكية',
  income: 'إيرادات',
  cogs: 'تكلفة البضاعة',
  operating_expenses: 'مصروفات تشغيلية',
  tax: 'ضريبة',
  cash_bank: 'نقدية وبنك',
  receivable: 'عملاء',
  payable: 'موردون',
  inventory: 'مخزون',
  legacy: 'حسابات قديمة',
};

const groupLabelEn: Record<string, string> = {
  assets: 'Assets',
  current_assets: 'Current Assets',
  fixed_assets: 'Fixed Assets',
  liabilities: 'Liabilities',
  current_liabilities: 'Current Liabilities',
  equity: 'Equity',
  income: 'Revenues',
  cogs: 'Cost of Goods Sold',
  operating_expenses: 'Operating Expenses',
  tax: 'Tax',
  cash_bank: 'Cash & Bank',
  receivable: 'Receivables',
  payable: 'Payables',
  inventory: 'Inventory',
  legacy: 'Legacy Accounts',
};

function renderFlags(account: AccountingAccount, isEn?: boolean): string[] {
  const labels: string[] = [];
  if (account.flags.isCashBank) labels.push(isEn ? 'Cash/Bank' : 'نقدية/بنك');
  if (account.flags.isReceivable) labels.push(isEn ? 'Customers' : 'عملاء');
  if (account.flags.isPayable) labels.push(isEn ? 'Suppliers' : 'موردون');
  if (account.flags.isInventory) labels.push(isEn ? 'Inventory' : 'مخزون');
  if (account.flags.isTax) labels.push(isEn ? 'Tax' : 'ضريبة');
  if (account.isControlAccount) labels.push(isEn ? 'Control Account' : 'حساب رقابي');
  if (account.isSystem) labels.push(isEn ? 'System' : 'نظامي');
  return labels;
}

export function AccountingAccountsPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formParentAccount, setFormParentAccount] = useState<AccountingAccount | undefined>();
  const [formEditAccount, setFormEditAccount] = useState<AccountingAccount | undefined>();

  const query = useQuery({
    queryKey: ['accounting', 'accounts'],
    queryFn: () => accountingApi.accounts(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountingApi.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'accounts'] });
    },
    onError: (err: Error) => {
      alert(`تعذر الحذف: ${err.message}`);
    },
  });

  const rows = query.data?.accounts || [];
  const visibleRows = useMemo(() => {
    if (showInactive) return rows;
    return rows.filter((row) => row.isActive);
  }, [rows, showInactive]);

  const handleAddChild = (parent: AccountingAccount) => {
    setFormMode('create');
    setFormParentAccount(parent);
    setFormEditAccount(undefined);
    setFormOpen(true);
  };

  const handleEdit = (account: AccountingAccount) => {
    setFormMode('edit');
    setFormParentAccount(undefined);
    setFormEditAccount(account);
    setFormOpen(true);
  };

  const handleDelete = (account: AccountingAccount) => {
    if (confirm(`هل أنت متأكد من حذف الحساب "${account.nameAr}"؟`)) {
      deleteMutation.mutate(account.id);
    }
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader title={t('accounting.accounting_accounts_page.s0', "شجرة الحسابات")} badge={<span className="nav-pill">{t('accounting.accounting_accounts_page.s1', "الأرصدة والبنود المالية")}</span>} />

        {/* Quick Shortcuts to Big Financial Statements */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/balance-sheet')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s2', "الميزانية العمومية")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/cash-flow')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s3', "قائمة التدفقات النقدية")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/aged-debts')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s4', "أعمار الديون")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/cheques')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s5', "حافظة الشيكات (PDC)")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/withholding-tax')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s6', "الخصم والإضافة (ن41)")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/cost-centers')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s7', "مراكز التكلفة")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => navigate('/accounting/journal-entries')}
            style={{ fontWeight: 700, fontSize: '0.78rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            {t('accounting.accounting_accounts_page.s8', "القيود اليومية")}
          </button>
        </div>
        
        <FormSection 
          title={t('accounting.accounting_accounts_page.s9', "شجرة الحسابات")} 
          actions={
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#170e5e', cursor: 'pointer' }}
                />
                <span>{t('accounting.accounting_accounts_page.s10', "عرض الحسابات غير النشطة")}</span>
              </label>
              <button 
                type="button" 
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setFormMode('create');
                  setFormParentAccount(undefined);
                  setFormEditAccount(undefined);
                  setFormOpen(true);
                }}
                style={{ background: '#170e5e', border: 'none', fontWeight: 700, padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem' }}
              >
                {t('accounting.accounting_accounts_page.s11', "+ إضافة حساب رئيسي")}
              </button>
            </div>
          }
        >
        <QueryFeedback
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={!visibleRows.length}
          loadingText={t('accounting.accounting_accounts_page.s12', "جاري تحميل شجرة الحسابات...")}
          errorTitle={t('accounting.accounting_accounts_page.s13', "تعذر تحميل شجرة الحسابات")}
          emptyTitle={t('accounting.accounting_accounts_page.s14', "لا توجد حسابات حتى الآن. سيتم إنشاء شجرة الحسابات الافتراضية من إعدادات النظام.")}
        >
          <DataTable<AccountingAccount>
            data={visibleRows}
            getRowKey={(row) => row.id}
            compact={true}
            density="compact"
            rowClassName={(row) => [!row.isActive ? 'table-row-inactive' : '', Number(row.depth || 0) === 0 ? 'table-row-root-account' : ''].filter(Boolean).join(' ')}
            defaultSort={{ columnId: 'code', direction: 'asc' }}
            columns={[
              {
                id: 'code',
                header: t('accounting.accounting_accounts_page.s15', "كود الحساب"),
                render: (row) => (
                  <span style={{ fontWeight: 800, color: '#170e5e', fontFamily: 'monospace', fontSize: '0.84rem' }}>
                    {row.code}
                  </span>
                ),
                sortable: true,
                sortValue: (row) => Number(row.code || 0),
                width: 95,
              },
              {
                id: 'nameAr',
                header: t('accounting.accounting_accounts_page.s16', "اسم الحساب"),
                render: (row) => {
                  const depth = Math.max(0, Number(row.depth || 0));
                  const displayedName = isEn && row.nameEn
                    ? row.nameEn
                    : isEn
                      ? translateUiText(row.nameAr) || row.nameAr
                      : row.nameAr;
                  return (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        paddingInlineStart: `${depth * 16}px`,
                        fontWeight: depth === 0 ? 800 : depth === 1 ? 700 : 500,
                        color: depth === 0 ? '#0f172a' : '#1e293b',
                        fontSize: '0.82rem',
                      }}
                    >
                      {depth > 0 ? (
                        <span
                          aria-hidden
                          style={{
                            width: 10,
                            height: 1.5,
                            background: '#94a3b8',
                            display: 'inline-block',
                          }}
                        />
                      ) : null}
                      <span>{displayedName}</span>
                    </span>
                  );
                },
                sortable: true,
                sortValue: (row) => (isEn && row.nameEn ? row.nameEn : row.nameAr || ''),
              },
              {
                id: 'group',
                header: t('accounting.accounting_accounts_page.s17', "المجموعة"),
                render: (row) => (
                  <span style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
                    {(isEn ? groupLabelEn[row.accountGroup] : groupLabel[row.accountGroup]) || row.accountGroup || '-'}
                  </span>
                ),
                sortable: true,
                sortValue: (row) => (isEn ? groupLabelEn[row.accountGroup] : groupLabel[row.accountGroup]) || row.accountGroup || '',
                width: 120,
              },
              {
                id: 'type',
                header: t('accounting.accounting_accounts_page.s18', "النوع"),
                render: (row) => (
                  <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#334155', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                    {(isEn ? typeLabelEn[row.accountType] : typeLabel[row.accountType]) || row.accountType}
                  </span>
                ),
                sortable: true,
                sortValue: (row) => (isEn ? typeLabelEn[row.accountType] : typeLabel[row.accountType]) || row.accountType || '',
                width: 85,
              },
              {
                id: 'normalBalance',
                header: t('accounting.accounting_accounts_page.s19', "الرصيد الطبيعي"),
                render: (row) => {
                  const bLabel = (isEn ? balanceLabelEn[row.normalBalance] : balanceLabel[row.normalBalance]) || row.normalBalance;
                  return (
                    <span
                      style={{
                        fontSize: '0.72rem',
                        background: row.normalBalance === 'debit' ? '#eff6ff' : '#f0fdf4',
                        color: row.normalBalance === 'debit' ? '#1d4ed8' : '#15803d',
                        border: `1px solid ${row.normalBalance === 'debit' ? '#bfdbfe' : '#bbf7d0'}`,
                        padding: '1px 7px',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                    >
                      {bLabel}
                    </span>
                  );
                },
                sortable: true,
                sortValue: (row) => (isEn ? balanceLabelEn[row.normalBalance] : balanceLabel[row.normalBalance]) || row.normalBalance || '',
                width: 90,
              },
              {
                id: 'balance',
                header: t('accounting.accounting_accounts_page.s27', "الرصيد"),
                render: (row) => (
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                    {formatCurrency(Number(row.balance || 0))}
                  </span>
                ),
                sortable: true,
                sortValue: (row) => Number(row.balance || 0),
                width: 130,
              },
              {
                id: 'flags',
                header: t('accounting.accounting_accounts_page.s20', "الخصائص"),
                render: (row) => {
                  const flags = renderFlags(row, isEn);
                  return flags.length ? (
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                      {flags.join(' • ')}
                    </span>
                  ) : (
                    <span style={{ color: '#cbd5e1' }}>-</span>
                  );
                },
              },
              {
                id: 'status',
                header: t('accounting.accounting_accounts_page.s21', "الحالة"),
                render: (row) =>
                  row.isActive ? (
                    <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                      {t('accounting.accounting_accounts_page.s22', "نشط")}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#94a3b8', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                      {t('accounting.accounting_accounts_page.s23', "معطل")}
                    </span>
                  ),
                sortable: true,
                sortValue: (row) => (row.isActive ? 1 : 0),
                width: 75,
              },
              {
                id: 'actions',
                header: '',
                render: (row) => (
                  <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => handleAddChild(row)}
                      style={{ padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, borderRadius: '6px', height: '26px' }}
                    >
                      {t('accounting.accounting_accounts_page.s24', "تفريع")}
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => handleEdit(row)}
                      style={{ padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, borderRadius: '6px', height: '26px' }}
                    >
                      {t('accounting.accounting_accounts_page.s25', "تعديل")}
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-danger" 
                      onClick={() => handleDelete(row)}
                      disabled={row.isSystem}
                      style={{ padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, borderRadius: '6px', height: '26px' }}
                    >
                      {t('accounting.accounting_accounts_page.s26', "حذف")}
                    </button>
                  </div>
                ),
                sortable: false,
                width: 150,
              },
            ]}
          />
        </QueryFeedback>
        </FormSection>
      </main>
      
      {formOpen && (
        <AccountingAccountForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          mode={formMode}
          parentAccount={formParentAccount}
          editAccount={formEditAccount}
        />
      )}
    </div>
  );
}
