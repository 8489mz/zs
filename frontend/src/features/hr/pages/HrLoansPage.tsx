import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { DataTable } from '@/shared/ui/data-table';
import type { HrEmployee, HrLoan, HrLoanInstallment } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';
import { useHrMutations, useHrWorkspace } from '@/features/hr/hooks/useHr';
import { HrLoanCreateForm } from '@/features/hr/pages/loans/HrLoanCreateForm';
import { HrLoanRepaymentForm } from '@/features/hr/pages/loans/HrLoanRepaymentForm';
import {
  addMonths,
  buildCreateLoanPayload,
  createInitialLoanDraft,
  fallbackText,
  installmentStatusLabel,
  loanTypeLabel,
  monthLabel,
  monthNames,
  money,
  normalizeArabicDigits,
  parsePositiveNumber,
  repaymentModeLabel,
  statusLabel,
  type LoanDraft,
} from '@/features/hr/pages/loans/hr-loans.helpers';

interface RepaymentDraft {
  amount: string;
  method: string;
  notes: string;
}

type LoanQuickFilter = 'active' | 'due' | 'pending' | 'closed' | 'all';

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function hasDueInstallment(row: HrLoan) {
  return Number(row.dueInstallmentsAmount || 0) > 0 || Number(row.dueInstallmentsCount || 0) > 0;
}

function isActiveLoan(row: HrLoan) {
  const status = normalize(row.status);
  return Number(row.remainingAmount || 0) > 0 && status !== 'cancelled' && status !== 'repaid' && status !== 'rejected' && status !== 'draft' && status !== 'pending' && status !== 'approved';
}

function matchesQuickFilter(row: HrLoan, filter: LoanQuickFilter) {
  const status = normalize(row.status);
  if (filter === 'all') return true;
  if (filter === 'active') return isActiveLoan(row);
  if (filter === 'due') return hasDueInstallment(row);
  if (filter === 'pending') return status === 'pending' || status === 'draft' || status === 'new' || status === 'approved';
  if (filter === 'closed') return status === 'repaid' || status === 'cancelled' || status === 'rejected' || (Number(row.remainingAmount || 0) <= 0 && status !== 'draft');
  return true;
}


function formatLedgerNote(note?: string, entryType?: string): string {
  if (!note || !note.trim()) {
    return entryType === 'loan_disbursement' ? 'صرف السلفة للموظف' : 'سداد دفعة من السلفة';
  }
  const text = note.trim();
  const lower = text.toLowerCase();
  if (lower.includes('employee loan repayment') || lower.includes('loan repayment')) return 'سداد دفعة من السلفة';
  if (lower.includes('employee advance/loan disbursed') || lower.includes('loan disbursement') || lower.includes('loan disbursed')) return 'صرف السلفة للموظف';
  if (lower.includes('payroll salary deduction') || lower.includes('salary deduction')) return 'استقطاع من مسير الرواتب';
  return text;
}

function formatRepaymentMethodLabel(method?: string, entryType?: string): string {
  if (entryType === 'loan_disbursement') return 'صرف سلفة';
  if (method === 'salary_deduction') return 'خصم مسير الرواتب';
  if (method === 'manual_cash') return 'سداد نقدي (خزينة)';
  return method || 'سداد نقدي';
}

export function HrLoansPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useHrMutations();
  const canViewLoans = useHasAnyPermission('hrLoans');
  const canManageLoans = useHasAnyPermission('hrLoans');
  const canViewSalaryAmounts = useHasAnyPermission(['hrLoans', 'hrSalaryView', 'hrSalaryManage', 'hrPayrollManage', 'hrPayrollApprove']);

  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<LoanQuickFilter>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loanDraft, setLoanDraft] = useState<LoanDraft>(createInitialLoanDraft);
  const [formError, setFormError] = useState('');
  const [selectedLoanForPlan, setSelectedLoanForPlan] = useState<HrLoan | null>(null);
  const [repaymentDraft, setRepaymentDraft] = useState<RepaymentDraft>({ amount: '', method: 'manual_cash', notes: '' });
  const [repaymentError, setRepaymentError] = useState('');

  const [periodMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);

  const workspace = useHrWorkspace({ search, page, pageSize, periodMonth });
  const employees = useMemo(() => workspace.employees.data?.employees || [], [workspace.employees.data?.employees]);
  const loans = useMemo(() => (workspace.loans.data?.loans || []) as HrLoan[], [workspace.loans.data?.loans]);
  const visibleLoans = useMemo(() => loans.filter((row) => matchesQuickFilter(row, quickFilter)), [loans, quickFilter]);
  const totalItems = quickFilter === 'all' ? Number(workspace.loans.data?.summary?.totalItems || loans.length || 0) : visibleLoans.length;

  const summary = useMemo(() => {
    const active = loans.filter(isActiveLoan).length;
    const due = loans.filter(hasDueInstallment).length;
    const pending = loans.filter((row) => matchesQuickFilter(row, 'pending')).length;
    const closed = loans.filter((row) => matchesQuickFilter(row, 'closed')).length;
    const dueAmount = loans.reduce((sum, row) => sum + Number(row.dueInstallmentsAmount || 0), 0);
    const remainingAmount = loans.reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0);
    return { total: loans.length, active, due, pending, closed, dueAmount, remainingAmount, visible: visibleLoans.length };
  }, [loans, visibleLoans.length]);

  const planPreview = useMemo(() => {
    const principalAmount = parsePositiveNumber(loanDraft.principalAmount);
    const isInstallments = loanDraft.repaymentMethod === 'installments';
    const installmentCount = isInstallments
      ? Math.max(1, Math.min(60, Math.floor(parsePositiveNumber(loanDraft.installmentCount) || 1)))
      : 1;

    if (!(principalAmount > 0)) {
      return { principalAmount: 0, installmentCount, installmentAmount: 0, totalInstallments: 0, startMonthLabel: '—', endMonthLabel: '—', firstDueDate: '' };
    }

    const baseInstallment = Math.round(principalAmount / installmentCount);
    const totalBeforeLast = baseInstallment * Math.max(0, installmentCount - 1);
    const lastInstallment = principalAmount - totalBeforeLast;
    const totalInstallments = totalBeforeLast + lastInstallment;
    const deductionMonth = Math.max(1, Math.min(12, Number(normalizeArabicDigits(loanDraft.firstDeductionMonth || '0')) || 1));
    const deductionYear = Math.max(2000, Number(normalizeArabicDigits(loanDraft.firstDeductionYear || '0')) || new Date().getFullYear());
    const firstDueDate = `${deductionYear}-${String(deductionMonth).padStart(2, '0')}-01`;
    const endMonth = addMonths(deductionYear, deductionMonth, installmentCount - 1);

    return {
      principalAmount,
      installmentCount,
      installmentAmount: baseInstallment,
      totalInstallments,
      startMonthLabel: monthLabel(firstDueDate),
      endMonthLabel: `${monthNames[endMonth.month - 1] || String(endMonth.month).padStart(2, '0')} ${endMonth.year}`,
      firstDueDate,
    };
  }, [loanDraft]);

  async function handleCreateLoan() {
    setFormError('');
    const employeeId = String(loanDraft.employeeId || '').trim();
    const principalAmount = parsePositiveNumber(loanDraft.principalAmount);
    const issueDate = String(loanDraft.issueDate || '').trim();
    const isInstallments = loanDraft.repaymentMethod === 'installments';
    const rawInstallmentCount = Math.floor(parsePositiveNumber(loanDraft.installmentCount) || 0);
    const installmentCount = isInstallments ? planPreview.installmentCount : 1;

    if (!employeeId) { setFormError('اختيار الموظف مطلوب.'); return; }
    if (!(principalAmount > 0)) { setFormError('قيمة السلفة مطلوبة ويجب أن تكون أكبر من صفر.'); return; }
    if (!issueDate) { setFormError('تاريخ السلفة مطلوب.'); return; }
    if (isInstallments && rawInstallmentCount <= 0) { setFormError('عدد الدفعات مطلوب ويجب أن يكون أكبر من صفر.'); return; }
    if (isInstallments && installmentCount > 60) { setFormError('عدد الدفعات يجب ألا يتجاوز 60 دفعة.'); return; }

    try {
      await mutations.saveLoan.mutateAsync({
        // INV-LOAN-INSTANT-DISBURSE: the payload is built by the shared
        // helper so the instant-disburse checkbox reaches the backend.
        payload: buildCreateLoanPayload(loanDraft, planPreview),
      });
      setLoanDraft(createInitialLoanDraft());
      setShowCreate(false);
      setQuickFilter('active');
    } catch (error) {
      setFormError(getErrorMessage(error, 'تعذر حفظ السلفة.'));
    }
  }

  async function handleRepay() {
    setRepaymentError('');
    if (!selectedLoanForPlan?.id) return;
    const amount = parsePositiveNumber(repaymentDraft.amount);
    const remainingAmount = Number(selectedLoanForPlan.remainingAmount || 0);
    if (!(amount > 0)) { setRepaymentError('قيمة السداد مطلوبة.'); return; }
    if (!(remainingAmount > 0)) { setRepaymentError('لا يوجد مبلغ متبقٍ على هذه السلفة.'); return; }
    if (amount > remainingAmount) { setRepaymentError(`قيمة السداد لا يمكن أن تكون أكبر من المتبقي (${money(remainingAmount)}).`); return; }
    const repaymentMethod = String(repaymentDraft.method || 'manual_cash').trim();
    try {
      await mutations.repayLoan.mutateAsync({ id: String(selectedLoanForPlan.id), payload: { amount, repaymentMethod: repaymentMethod === 'salary_deduction' ? 'salary_deduction' : 'manual_cash', note: String(repaymentDraft.notes || '').trim() || undefined } });
      setRepaymentDraft({ amount: '', method: 'manual_cash', notes: '' });
      setSelectedLoanForPlan(null);
    } catch (error) {
      setRepaymentError(getErrorMessage(error, 'تعذر تسجيل السداد.'));
    }
  }

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_loans_page.s0', "السلف والخصومات")}
          description={t('hr.hr_loans_page.s1', "إدارة سلف الموظفين، خطط الأقساط الشهرية، والمتابعة المباشرة قبل مسير الرواتب.")}
          actions={
            <div className="actions compact-actions">
              <Button type="button" onClick={() => setShowCreate((current) => !current)}>
                {showCreate ? t('hr.hr_loans_page.s2', "إغلاق النموذج") : t('hr.hr_loans_page.s3', "+ سلفة جديدة")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('open-quick-cash-advance'))}>
                {t('hr.hr_loans_page.quick_advance_btn', "صرف سلفة سريعة (كاشير)")}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/hr/payroll')}>{t('hr.hr_loans_page.s4', "المرتبات")}</Button>
              <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_loans_page.s5', "الموظفون")}</Button>
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

          {!canViewLoans ? (
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '10px', textAlign: 'center', color: '#64748b' }}>
              <p style={{ margin: 0 }}>{t('hr.hr_loans_page.s6', "ليس لديك صلاحية للوصول إلى بيانات السلف والخصومات.")}</p>
            </div>
          ) : (
            <>
              {showCreate ? (
                <div style={{ marginBottom: '16px' }}>
                  <HrLoanCreateForm loanDraft={loanDraft} employees={employees as HrEmployee[]} canManageLoans={canManageLoans} formError={formError} planPreview={planPreview} isPending={mutations.saveLoan.isPending} onChange={(patch) => setLoanDraft((current) => ({ ...current, ...patch }))} onSubmit={() => { void handleCreateLoan(); }} onCancel={() => setShowCreate(false)} />
                </div>
              ) : null}

              {/* Compact Single-Row KPI Summary Bar */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a' }}>{t('hr.hr_loans_page.s7', "ملخص السلف والخصومات")}</span>
                  <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{t('hr.hr_loans_page.s8', "اضغط على أي مؤشر لتصفية القائمة فوراً")}</span>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: '8px' }}>
                  {[
                    { label: t('hr.hr_loans_page.s9', "إجمالي السلف"), value: summary.total, onClick: () => { setQuickFilter('all'); setPage(1); }, isAlert: false, active: quickFilter === 'all' },
                    { label: t('hr.hr_loans_page.s10', "سلف نشطة"), value: summary.active, onClick: () => { setQuickFilter('active'); setPage(1); }, isAlert: false, active: quickFilter === 'active' },
                    { label: t('hr.hr_loans_page.s11', "أقساط مستحقة"), value: summary.due, onClick: () => { setQuickFilter('due'); setPage(1); }, isAlert: summary.due > 0, active: quickFilter === 'due' },
                    { label: t('hr.hr_loans_page.s12', "تحتاج اعتماد/صرف"), value: summary.pending, onClick: () => { setQuickFilter('pending'); setPage(1); }, isAlert: summary.pending > 0, active: quickFilter === 'pending' },
                    { label: t('hr.hr_loans_page.s13', "مغلقة/مسددة"), value: summary.closed, onClick: () => { setQuickFilter('closed'); setPage(1); }, isAlert: false, active: quickFilter === 'closed' },
                    { label: t('hr.hr_loans_page.s14', "مستحق الشهر"), value: canViewSalaryAmounts ? money(summary.dueAmount) : '—', onClick: () => {}, isAlert: false, active: false },
                    { label: t('hr.hr_loans_page.s15', "إجمالي المتبقي"), value: canViewSalaryAmounts ? money(summary.remainingAmount) : '—', onClick: () => {}, isAlert: false, active: false },
                    { label: "المعروض حالياً", value: summary.visible, onClick: () => {}, isAlert: false, active: false },
                  ].map((stat, idx) => (
                    <div
                      key={idx}
                      onClick={stat.onClick}
                      style={{
                        background: stat.active ? '#eff6ff' : '#ffffff',
                        border: `1px solid ${stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'}`,
                        borderRadius: '6px',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        transition: 'all 0.15s ease',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        minWidth: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = stat.active ? '#3b82f6' : stat.isAlert ? '#fca5a5' : '#e2e8f0'; }}
                    >
                      <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stat.label}>
                        {stat.label}
                      </span>
                      <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: stat.isAlert ? '#dc2626' : stat.active ? '#1d4ed8' : '#0f172a', lineHeight: 1.2 }}>
                        {stat.value}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Integrated Toolbar - Single Row */}
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder={t('hr.hr_loans_page.s17', "بحث باسم الموظف أو رقم السلفة...")}
                  style={{ width: '220px', minWidth: '170px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.825rem', background: '#fff', boxSizing: 'border-box' }}
                />

                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button type="button" variant={quickFilter === 'active' ? 'primary' : 'secondary'} onClick={() => { setQuickFilter('active'); setPage(1); }} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>{t('hr.hr_loans_page.s18', "نشطة")}</Button>
                  <Button type="button" variant={quickFilter === 'due' ? 'primary' : 'secondary'} onClick={() => { setQuickFilter('due'); setPage(1); }} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>{t('hr.hr_loans_page.s19', "أقساط مستحقة")}</Button>
                  <Button type="button" variant={quickFilter === 'pending' ? 'primary' : 'secondary'} onClick={() => { setQuickFilter('pending'); setPage(1); }} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>{t('hr.hr_loans_page.s20', "تحتاج اعتماد/صرف")}</Button>
                  <Button type="button" variant={quickFilter === 'closed' ? 'primary' : 'secondary'} onClick={() => { setQuickFilter('closed'); setPage(1); }} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>{t('hr.hr_loans_page.s21', "مغلقة/مسددة")}</Button>
                  <Button type="button" variant={quickFilter === 'all' ? 'primary' : 'secondary'} onClick={() => { setQuickFilter('all'); setPage(1); }} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>{t('hr.hr_loans_page.s22', "كل السلف")}</Button>
                </div>
              </div>

              <QueryFeedback isLoading={workspace.loans.isLoading} isError={workspace.loans.isError} error={workspace.loans.error} isEmpty={!visibleLoans.length} loadingText={t('hr.hr_loans_page.s23', "جاري تحميل السلف...")} errorTitle={t('hr.hr_loans_page.s24', "تعذر تحميل بيانات السلف")} emptyTitle={loans.length === 0 ? "لا توجد سلف أو قروض مسجلة حتى الآن." : (search || quickFilter !== 'all' ? t('hr.hr_loans_page.s25', "لا توجد سلف مطابقة للفلاتر الحالية.") : t('hr.hr_loans_page.s26', "لا توجد سلف مسجلة حتى الآن."))} emptyHint={loans.length === 0 ? "ابدأ بتسجيل أول سلفة لموظف من زر أعلى الصفحة." : (search || quickFilter !== 'all' ? t('hr.hr_loans_page.s27', "جرّب تغيير الفلتر أو البحث.") : t('hr.hr_loans_page.s28', "ابدأ بتسجيل سلفة جديدة من زر أعلى الصفحة."))}>
                <DataTable
                  rows={visibleLoans}
                  rowKey={(row) => String(row.id)}
                  density="compact"
                  pagination={{ page, pageSize, totalItems, onPageChange: setPage, onPageSizeChange: (next) => { setPageSize(next); setPage(1); }, itemLabel: t('hr.hr_loans_page.s29', "سلفة") }}
                  columns={[
                    { key: 'loanNo', header: t('hr.hr_loans_page.s30', "رقم السلفة"), cell: (row) => fallbackText(row.loanNo || row.id) },
                    { key: 'employee', header: t('hr.hr_loans_page.s31', "الموظف"), cell: (row) => fallbackText(row.employeeName) },
                    { key: 'loanType', header: t('hr.hr_loans_page.s32', "النوع"), cell: (row) => loanTypeLabel(row.loanType) },
                    { key: 'principalAmount', header: t('hr.hr_loans_page.s33', "قيمة السلفة"), cell: (row) => canViewSalaryAmounts ? money(row.principalAmount) : '—' },
                    { key: 'remainingAmount', header: t('hr.hr_loans_page.s34', "المتبقي"), cell: (row) => canViewSalaryAmounts ? money(row.remainingAmount) : '—' },
                    { key: 'dueInstallmentsAmount', header: t('hr.hr_loans_page.s35', "مستحق الشهر"), cell: (row) => canViewSalaryAmounts ? money(row.dueInstallmentsAmount || 0) : '—' },
                    { key: 'repaymentMode', header: t('hr.hr_loans_page.s36', "طريقة السداد"), cell: (row) => repaymentModeLabel(row.repaymentMode) },
                    { key: 'status', header: t('hr.hr_loans_page.s37', "الحالة"), cell: (row) => statusLabel(row.status) },
                    { key: 'issueDate', header: t('hr.hr_loans_page.s38', "تاريخ السلفة"), cell: (row) => fallbackText(row.issueDate) },
                    {
                      key: 'plan',
                      header: t('hr.hr_loans_page.s39', "خطة السداد"),
                      cell: (row) => {
                        return <Button variant="secondary" onClick={() => setSelectedLoanForPlan(row)} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_loans_page.s40', "التفاصيل والسداد")}</Button>;
                      },
                    },
                    {
                      key: 'actions',
                      header: t('hr.hr_loans_page.s41', "إجراءات"),
                      cell: (row) => {
                        const status = normalize(row.status);
                        const canApprove = canManageLoans && (!status || status === 'pending' || status === 'draft' || status === 'new');
                        const canDisburse = canManageLoans && status === 'approved';
                        return <div className="actions compact-actions">{canApprove ? <Button variant="secondary" onClick={() => { void mutations.approveLoan.mutateAsync(String(row.id)); }} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_loans_page.s42', "اعتماد")}</Button> : null}{canDisburse ? <Button variant="secondary" onClick={() => { void mutations.disburseLoan.mutateAsync(String(row.id)); }} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>{t('hr.hr_loans_page.s43', "صرف")}</Button> : null}</div>;
                      },
                    },
                  ]}
                />

                {selectedLoanForPlan ? (() => {
                  const activeLoan = (loans.find((r) => String(r.id) === String(selectedLoanForPlan.id)) || selectedLoanForPlan) as HrLoan;
                  return (
                    <DialogShell open={true} onClose={() => setSelectedLoanForPlan(null)} width="920px">
                      <div style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                              {t('hr.hr_loans_page.s44', "السلفة رقم")} {fallbackText(activeLoan.loanNo || activeLoan.id)} - {fallbackText(activeLoan.employeeName)}
                            </h3>
                            <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#64748b' }}>
                              {t('hr.hr_loans_page.s38', "تاريخ السلفة")}: {fallbackText(activeLoan.issueDate)} • {repaymentModeLabel(activeLoan.repaymentMode)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, backgroundColor: '#f1f5f9', color: '#334155' }}>
                              {loanTypeLabel(activeLoan.loanType)}
                            </span>
                            <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, backgroundColor: Number(activeLoan.remainingAmount || 0) === 0 ? '#dcfce7' : '#e0e7ff', color: Number(activeLoan.remainingAmount || 0) === 0 ? '#15803d' : '#1e40af' }}>
                              {statusLabel(activeLoan.status)}
                            </span>
                          </div>
                        </div>

                        {/* Quick Financial Overview Bar */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
                          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{t('hr.hr_loans_page.s33', "قيمة السلفة")}</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{canViewSalaryAmounts ? money(activeLoan.principalAmount) : '—'}</div>
                          </div>
                          <div style={{ backgroundColor: '#ffffff', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600 }}>إجمالي المسدد</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>{canViewSalaryAmounts ? money(activeLoan.paidAmount || 0) : '—'}</div>
                          </div>
                          <div style={{ backgroundColor: '#ffffff', border: '1px solid #fed7aa', borderRadius: '10px', padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#9a3412', fontWeight: 600 }}>{t('hr.hr_loans_page.s34', "المتبقي")}</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#c2410c', marginTop: '4px' }}>{canViewSalaryAmounts ? money(activeLoan.remainingAmount || 0) : '—'}</div>
                          </div>
                        </div>

                        {/* Section 1: Repayment Form (if applicable) */}
                        {(canManageLoans && Number(activeLoan.remainingAmount || 0) > 0) ? (
                          <div style={{ marginBottom: '24px', backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            <h4 style={{ marginBottom: '8px', fontSize: '0.95rem' }}>{t('hr.hr_loans_page.s45', "تسجيل سداد يدوي")}</h4>
                            <HrLoanRepaymentForm selectedLoanLabel={fallbackText(activeLoan.loanNo || activeLoan.id)} remainingAmountText={canViewSalaryAmounts ? money(activeLoan.remainingAmount) : '—'} repaymentDraft={repaymentDraft} repaymentError={repaymentError} isPending={mutations.repayLoan.isPending} onChange={(patch) => setRepaymentDraft((current) => ({ ...current, ...patch }))} onSubmit={() => { void handleRepay(); }} onCancel={() => { setRepaymentDraft({ amount: '', method: 'manual_cash', notes: '' }); setSelectedLoanForPlan(null); }} />
                          </div>
                        ) : null}

                        {/* Section 2: Installments Table */}
                        <div style={{ marginBottom: '20px' }}>
                          <h4 style={{ marginBottom: '10px', fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>{t('hr.hr_loans_page.s46', "جدول الأقساط")}</h4>
                          {Array.isArray(activeLoan.installments) && activeLoan.installments.length ? (
                            <div className="table-wrap" style={{ overflowX: 'hidden' }}>
                              <table className="data-table" style={{ width: '100%', tableLayout: 'fixed', fontSize: '0.8rem' }}>
                                <colgroup>
                                  <col style={{ width: '10%' }} />
                                  <col style={{ width: '16%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '15%' }} />
                                  <col style={{ width: '14%' }} />
                                  <col style={{ width: '15%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{t('hr.hr_loans_page.s47', "القسط")}</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{t('hr.hr_loans_page.s48', "الاستحقاق")}</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{t('hr.hr_loans_page.s49', "القيمة")}</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>المسدد</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>المتبقي</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{t('hr.hr_loans_page.s50', "الحالة")}</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>تاريخ السداد</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(activeLoan.installments as HrLoanInstallment[]).map((item) => (
                                    <tr key={String(item.id)}>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{item.installmentNumber || '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem' }}>{monthLabel(item.dueDate)}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontWeight: 600 }}>{canViewSalaryAmounts ? money(item.amount) : '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', color: Number(item.paidAmount || 0) > 0 ? '#15803d' : undefined, fontWeight: 700 }}>{canViewSalaryAmounts ? money(item.paidAmount || 0) : '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', color: '#c2410c', fontWeight: 700 }}>{canViewSalaryAmounts ? money(item.remainingAmount !== undefined ? item.remainingAmount : Math.max(0, (item.amount || 0) - (item.paidAmount || 0))) : '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.75rem' }}>{installmentStatusLabel(item.status)}</td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.75rem' }}>{fallbackText(item.paidAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>{t('hr.hr_loans_page.s52', "طريقة السداد لهذه السلفة:")} {repaymentModeLabel(activeLoan.repaymentMode)} {t('hr.hr_loans_page.s53', "(لا توجد خطة أقساط)")}</p>
                          )}
                        </div>

                        {/* Section 3: Repayments & Payment Transactions History */}
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                              سجل الدفعات وحركات السداد المستلمة
                            </h4>
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {activeLoan.repayments?.length || 0} حركة مسجلة
                            </span>
                          </div>
                          {Array.isArray(activeLoan.repayments) && activeLoan.repayments.length ? (
                            <div className="table-wrap" style={{ overflowX: 'hidden' }}>
                              <table className="data-table" style={{ width: '100%', tableLayout: 'fixed', fontSize: '0.8rem' }}>
                                <colgroup>
                                  <col style={{ width: '19%' }} />
                                  <col style={{ width: '14%' }} />
                                  <col style={{ width: '18%' }} />
                                  <col style={{ width: '16%' }} />
                                  <col style={{ width: '14%' }} />
                                  <col style={{ width: '19%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>تاريخ السداد</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>المبلغ</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>طريقة السداد</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>المستلم</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>المتبقي</th>
                                    <th style={{ padding: '6px 8px', fontSize: '0.78rem' }}>البيان</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeLoan.repayments.map((rep) => (
                                    <tr key={String(rep.id)}>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                        {fallbackText(rep.createdAt)}
                                      </td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.82rem', fontWeight: 800, color: rep.entryType === 'loan_repayment' ? '#15803d' : '#0f172a', whiteSpace: 'nowrap' }}>
                                        {canViewSalaryAmounts ? money(rep.amount) : '—'}
                                      </td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                        <span style={{ padding: '2px 6px', borderRadius: '4px', fontWeight: 600, backgroundColor: rep.repaymentMethod === 'salary_deduction' ? '#eff6ff' : '#f0fdf4', color: rep.repaymentMethod === 'salary_deduction' ? '#1d4ed8' : '#15803d' }}>
                                          {formatRepaymentMethodLabel(rep.repaymentMethod, rep.entryType)}
                                        </span>
                                      </td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rep.receivedByName || rep.receivedByUsername}>
                                        {fallbackText(rep.receivedByName || rep.receivedByUsername)}
                                      </td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                        {canViewSalaryAmounts ? money(rep.balanceAfter) : '—'}
                                      </td>
                                      <td style={{ padding: '6px 8px', fontSize: '0.75rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={formatLedgerNote(rep.note, rep.entryType)}>
                                        {formatLedgerNote(rep.note, rep.entryType)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div style={{ padding: '14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>
                              لا توجد أي حركات سداد مسجلة حتى الآن على هذه السلفة.
                            </div>
                          )}
                        </div>

                        <div className="actions" style={{ marginTop: '16px', justifyContent: 'flex-end' }}>
                          <Button variant="secondary" onClick={() => setSelectedLoanForPlan(null)}>{t('hr.hr_loans_page.s54', "إغلاق")}</Button>
                        </div>
                      </div>
                    </DialogShell>
                  );
                })() : null}
              </QueryFeedback>
            </>
          )}
        </div>
      </main>
    </div>
  );
}


