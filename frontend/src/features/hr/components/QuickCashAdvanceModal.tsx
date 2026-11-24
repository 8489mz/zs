import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, FormEvent } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/errors';
import { http } from '@/lib/http';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/shared/components/system-alert';
import { money, type WithdrawalBalanceResponse } from './quick-cash-advance-modal/quick-cash-advance-shared';
import { QuickCashAdvanceHeader } from './quick-cash-advance-modal/quick-cash-advance-header';
import { QuickCashAdvanceTabs } from './quick-cash-advance-modal/quick-cash-advance-tabs';
import { QuickCashAdvanceEmployee } from './quick-cash-advance-modal/quick-cash-advance-employee';
import { QuickCashAdvanceBalance } from './quick-cash-advance-modal/quick-cash-advance-balance';
import { QuickCashAdvanceAmount } from './quick-cash-advance-modal/quick-cash-advance-amount';
import { QuickCashAdvanceNotes } from './quick-cash-advance-modal/quick-cash-advance-notes';
import { QuickCashAdvanceManagerAuth } from './quick-cash-advance-modal/quick-cash-advance-manager-auth';
import { QuickCashAdvanceShifts } from './quick-cash-advance-modal/quick-cash-advance-shifts';
import { QuickCashAdvanceFormError } from './quick-cash-advance-modal/quick-cash-advance-form-error';
import { QuickCashAdvanceFooter } from './quick-cash-advance-modal/quick-cash-advance-footer';


export function QuickCashAdvanceModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'advance' | 'payout'>('advance');
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [formError, setFormError] = useState('');

  const queryClient = useQueryClient();
  const canManageLoans = useHasAnyPermission('hrLoans');
  const canAccessCashDrawer = useHasAnyPermission(['cashDrawer', 'sales']);
  const currentUser = useAuthStore((state) => state.user);
  const isAdminOrOwner = ['admin', 'super_admin'].includes(String(currentUser?.role || '').trim());
  const canAccess = canManageLoans || canAccessCashDrawer || isAdminOrOwner;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + Alt + X (supports English and Arabic layout: KeyX / 'x' / 'X' / 'ء')
      if (e.ctrlKey && e.altKey && (e.key === 'x' || e.key === 'X' || e.code === 'KeyX' || e.key === 'ء')) {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    const handleCustomOpen = () => setIsOpen(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-quick-cash-advance', handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-quick-cash-advance', handleCustomOpen);
    };
  }, []);

  // Fetch active employees for dropdown
  const { data: employeesData } = useQuery({
    queryKey: ['hr.employees', { pageSize: 1000 }],
    queryFn: () => http<any>('/api/hr/employees?pageSize=1000&status=active'),
    enabled: isOpen && canAccess,
    staleTime: 60000,
  });

  // Fetch open cashier shifts
  const { data: shiftData } = useQuery({
    queryKey: ['pos.shifts.current'],
    queryFn: () => http<{ cashierShifts?: Array<Record<string, unknown>> }>('/api/cashier-shifts?filter=open&status=open&pageSize=100'),
    enabled: isOpen && canAccess,
    staleTime: 10000,
  });

  // Fetch real-time employee withdrawal balance with instant cache and placeholder retention
  const {
    data: balanceData,
    isLoading: _isLoadingBalance,
    isFetching: _isFetchingBalance,
    isError: isBalanceError,
    error: balanceError,
  } = useQuery<WithdrawalBalanceResponse>({
    queryKey: ['hr.employee.withdrawal-balance', employeeId],
    queryFn: () => http<WithdrawalBalanceResponse>(`/api/hr/employees/${employeeId}/withdrawal-balance`),
    enabled: isOpen && Boolean(employeeId) && Number(employeeId) > 0,
    staleTime: 10000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const employees = employeesData?.employees || [];
  const shifts = useMemo(() => {
    const raw = (shiftData?.cashierShifts || []).filter(
      (s: any) => String(s.status || '').toLowerCase() === 'open'
    );
    return [...raw].sort((a: any, b: any) => {
      const cashA = Number(a.expectedCash ?? a.expected_cash ?? 0);
      const cashB = Number(b.expectedCash ?? b.expected_cash ?? 0);
      return cashB - cashA;
    });
  }, [shiftData?.cashierShifts]);

  const selectedEmployee = useMemo(() => {
    return employees.find((e: any) => String(e.id) === String(employeeId)) || null;
  }, [employees, employeeId]);

  const employeeOptions = useMemo(() => [
    { value: '', label: t('hr.quick_cash_advance_modal.choose_emp', 'اختر الموظف لعرض كشف حسابه اللحظي...') },
    ...employees.map((emp: any) => ({
      value: String(emp.id),
      label: emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.name || `موظف #${emp.id}`,
      hint: emp.employeeNo ? `#${emp.employeeNo}` : (emp.compensationType === 'hourly' ? 'بالساعة' : 'شهري'),
      code: String(emp.employeeNo || emp.id),
    })),
  ], [employees, t]);

  // Lock shift: cashier is locked to their own shift; admin/owner can choose from open shifts
  const userOpenShift = useMemo(() => {
    return shifts.find(
      (shift: Record<string, unknown>) =>
        String(shift.openedById || shift.opened_by) === String(currentUser?.id) &&
        String(shift.status || 'open') === 'open'
    );
  }, [shifts, currentUser?.id]);

  const activeShift = useMemo(() => {
    if (!shifts.length) return null;
    if (isAdminOrOwner && selectedShiftId) {
      const match = shifts.find((s: any) => String(s.id) === String(selectedShiftId));
      if (match) return match;
    }
    return userOpenShift || (isAdminOrOwner ? shifts[0] : null);
  }, [shifts, selectedShiftId, userOpenShift, isAdminOrOwner]);

  useEffect(() => {
    if (activeShift?.id && String(activeShift.id) !== selectedShiftId) {
      setSelectedShiftId(String(activeShift.id));
    } else if (!shifts.length && selectedShiftId) {
      setSelectedShiftId('');
    }
  }, [activeShift?.id, shifts.length]);


  // Derived financial & authorization states
  const parsedAmount = Number(amount) || 0;
  const netAvailable = balanceData?.netAvailableBalance ?? 0;
  const maxDirectAdvance = balanceData?.maxDirectAdvance ?? 0;
  const hasCredit = netAvailable > 0.009;
  const isPayoutDue = balanceData?.schedule?.isPayoutDue ?? true;
  const isEarlyWagePayout = activeTab === 'payout' && !isPayoutDue;
  const isAdvanceOverDirectCap = activeTab === 'advance' && parsedAmount > maxDirectAdvance;
  const isOverdraft = parsedAmount > netAvailable;

  // Direct allowed logic:
  // For advance: amount <= maxDirectAdvance
  // For payout: isPayoutDue && amount <= netAvailable
  const isDirectAllowed = activeTab === 'payout'
    ? (isPayoutDue && hasCredit && parsedAmount > 0 && parsedAmount <= netAvailable)
    : (hasCredit && parsedAmount > 0 && parsedAmount <= maxDirectAdvance);

  const requiresManagerAuth = !isDirectAllowed;

  const currentMonthLabel = useMemo(() => {
    try {
      const now = new Date();
      return now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    } catch {
      return 'الشهر الحالي';
    }
  }, []);

  const payFrequencyLabel = useMemo(() => {
    const freq = balanceData?.employee.payFrequency;
    if (freq === 'daily') return 'يومي';
    if (freq === 'weekly') return 'أسبوعي';
    if (freq === 'biweekly') return 'نصف شهري';
    return 'شهري';
  }, [balanceData?.employee.payFrequency]);

  const accrualSubtitle = useMemo(() => {
    if (!employeeId || !balanceData) return 'اختر الموظف لعرض الاستحقاق';
    const compType = balanceData.employee.compensationType;
    const freq = balanceData.employee.payFrequency;
    const hours = balanceData.accrual.workedHours;
    const days = balanceData.accrual.completedDays;
    const totalDays = balanceData.cycle?.totalDays || 30;

    if (compType === 'hourly') {
      return `أجر بالساعة (عن ${hours > 0 ? `${hours} س عمل` : 'ساعات العمل'})`;
    }
    if (freq === 'daily') {
      return `أجر يومي (عن ${days > 0 ? `${days} يوم استحقاق` : 'أيام العمل حتى اليوم'})`;
    }
    if (freq === 'weekly') {
      return `أجر أسبوعي (عن ${days > 0 ? `${days} من ${totalDays} يوم` : 'الأسبوع الحالي'})`;
    }
    if (balanceData.accrual.isProrated) {
      return `أجر نسبي حتى اليوم (${days} من ${totalDays} يوم شهر ${currentMonthLabel})`;
    }
    return `راتب شهري (استحقاق شهر ${currentMonthLabel})`;
  }, [employeeId, balanceData, currentMonthLabel]);

  const deductionsSubtitle = useMemo(() => {
    if (!employeeId || !balanceData) return 'لا توجد سلف محددة';
    const debt = balanceData.deductions.totalDebt;
    const count = balanceData.deductions.activeLoanCount;
    if (debt > 0) {
      return `${count || 1} سلفة قائمة بذمته`;
    }
    return 'لا توجد مسحوبات سابقة';
  }, [employeeId, balanceData]);

  const availableSubtitle = useMemo(() => {
    if (!employeeId || !balanceData) return 'بانتظار اختيار الموظف';
    if (activeTab === 'payout') {
      if (!isPayoutDue) {
        return `متبقي ${balanceData.schedule?.daysUntilPayout ?? 0} يوم على الراتب (اعتماد مدير)`;
      }
      return hasCredit ? 'مستحق للصرف والتسوية اليوم' : 'لا يوجد رصيد مستحق للصرف';
    }
    // Tab 1: Advance
    if (maxDirectAdvance > 0) {
      return `سقف الكاشير المباشر: ${money(maxDirectAdvance)} ج.م (50%)`;
    }
    return hasCredit ? 'يتطلب اعتماد المدير (سلفة استثنائية)' : 'سلفة على المكشوف (اعتماد مدير)';
  }, [employeeId, balanceData, hasCredit, activeTab, isPayoutDue, maxDirectAdvance]);

  useEffect(() => {
    if (activeTab === 'payout' && balanceData && employeeId) {
      const avail = balanceData.netAvailableBalance;
      if (avail > 0) {
        setAmount(String(avail));
      }
      const empName = balanceData.employee.displayName || selectedEmployee?.displayName || 'الموظف';
      setNotes(`صرف وتصفية مستحقات أجر الفترة (${empName})`);
    }
  }, [activeTab, balanceData, employeeId, selectedEmployee?.displayName]);

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      return http('/api/hr/advances/quick-cash', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr.loans'] });
      queryClient.invalidateQueries({ queryKey: ['pos.shifts'] });
      queryClient.invalidateQueries({ queryKey: ['hr.payrollRuns'] });
      queryClient.invalidateQueries({ queryKey: ['hr.financialStatement'] });
      if (employeeId) {
        queryClient.invalidateQueries({ queryKey: ['hr.employee.withdrawal-balance', employeeId] });
      }

      const empName = selectedEmployee?.displayName || 'الموظف';
      if (activeTab === 'payout') {
        toast.success(`تم صرف راتب ومستحقات ${empName} بقيمة ${money(parsedAmount)} ج.م وتصفير رصيد الفترة بنجاح`);
      } else {
        toast.success(`تم صرف سلفة / مسحوب بقيمة ${money(parsedAmount)} ج.م للموظف ${empName} بنجاح`);
      }

      setIsOpen(false);
      setEmployeeId('');
      setAmount('');
      setNotes('');
      setManagerPassword('');
      setSelectedShiftId('');
      setFormError('');
    },
    onError: (error) => {
      setFormError(getErrorMessage(error, 'تعذر تسجيل العملية.'));
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!employeeId) {
      setFormError('يرجى اختيار الموظف أولاً.');
      return;
    }
    if (!amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('يرجى إدخال مبلغ صحيح أكبر من صفر.');
      return;
    }
    if (Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 0.000001) {
      setFormError('المبلغ يجب أن يحتوي على خانتين عشريتين كحد أقصى.');
      return;
    }
    if (!notes.trim()) {
      setFormError('يجب كتابة سبب وتفاصيل الصرف.');
      return;
    }
    if (!activeShift) {
      setFormError('لا توجد وردية كاشير مفتوحة باسمك للصرف منها.');
      return;
    }

    if (requiresManagerAuth && !isAdminOrOwner && !managerPassword.trim()) {
      if (isEarlyWagePayout) {
        setFormError(`موعد استحقاق الراتب لم يحن بعد (القادم: ${balanceData?.schedule?.nextPayoutDate || 'نهاية الدورة'})؛ يلزم إدخال كلمة مرور المدير للاعتماد كـ تسوية مبكرة.`);
      } else {
        setFormError('المبلغ يتجاوز الرصيد المستحق؛ يلزم إدخال كلمة مرور المدير أو مالك المنشأة للاعتماد.');
      }
      return;
    }

    mutation.mutate({
      employeeId: Number(employeeId),
      amount: parsedAmount,
      notes: notes.trim(),
      shiftId: Number(activeShift.id),
      managerPassword: managerPassword.trim() || undefined,
      actionType: activeTab === 'payout' ? 'wage_payout' : 'advance',
    });
  };

  if (!isOpen) return null;

  return (
    <DialogShell
      open={isOpen}
      onClose={() => setIsOpen(false)}
      width="min(740px, 96vw)"
      minHeight="590px"
    >
      <div style={{ padding: '16px 22px', minHeight: '590px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }} dir="rtl">
        <QuickCashAdvanceHeader
          activeTab={activeTab}
        />

        {!canAccess ? (
          <div style={{ padding: 14, backgroundColor: '#fef2f2', borderRadius: 8, color: '#991b1b', fontSize: '0.85rem' }}>
            {t('hr.quick_cash_advance_modal.no_perm', 'لا تملك صلاحية صرف المسحوبات أو الوصول للوردية.')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <QuickCashAdvanceTabs
              setActiveTab={setActiveTab}
              setAmount={setAmount}
              setNotes={setNotes}
              setFormError={setFormError}
              activeTab={activeTab}
              netAvailable={netAvailable}
              selectedEmployee={selectedEmployee}
            />

            <QuickCashAdvanceEmployee
              t={t}
              employeeId={employeeId}
              setEmployeeId={setEmployeeId}
              setAmount={setAmount}
              setManagerPassword={setManagerPassword}
              setFormError={setFormError}
              employeeOptions={employeeOptions}
            />

            <QuickCashAdvanceBalance
              isBalanceError={isBalanceError}
              balanceData={balanceData}
              balanceError={balanceError}
              employeeId={employeeId}
              selectedEmployee={selectedEmployee}
              payFrequencyLabel={payFrequencyLabel}
              accrualSubtitle={accrualSubtitle}
              deductionsSubtitle={deductionsSubtitle}
              hasCredit={hasCredit}
              netAvailable={netAvailable}
              availableSubtitle={availableSubtitle}
            />

            <QuickCashAdvanceAmount
              activeTab={activeTab}
              hasCredit={hasCredit}
              netAvailable={netAvailable}
              setAmount={setAmount}
              maxDirectAdvance={maxDirectAdvance}
              setActiveTab={setActiveTab}
              balanceData={balanceData}
              selectedEmployee={selectedEmployee}
              setNotes={setNotes}
              isPayoutDue={isPayoutDue}
              amount={amount}
              requiresManagerAuth={requiresManagerAuth}
              parsedAmount={parsedAmount}
              isDirectAllowed={isDirectAllowed}
              isAdvanceOverDirectCap={isAdvanceOverDirectCap}
              isOverdraft={isOverdraft}
            />

            <QuickCashAdvanceNotes
              activeTab={activeTab}
              notes={notes}
              setNotes={setNotes}
            />

            <QuickCashAdvanceManagerAuth
              requiresManagerAuth={requiresManagerAuth}
              parsedAmount={parsedAmount}
              isEarlyWagePayout={isEarlyWagePayout}
              isAdvanceOverDirectCap={isAdvanceOverDirectCap}
              isOverdraft={isOverdraft}
              maxDirectAdvance={maxDirectAdvance}
              isAdminOrOwner={isAdminOrOwner}
              currentUser={currentUser}
              managerPassword={managerPassword}
              setManagerPassword={setManagerPassword}
            />

            <QuickCashAdvanceShifts
              isAdminOrOwner={isAdminOrOwner}
              shifts={shifts}
              t={t}
              activeShift={activeShift}
              parsedAmount={parsedAmount}
              currentUser={currentUser}
              setSelectedShiftId={setSelectedShiftId}
            />

            <QuickCashAdvanceFormError
              formError={formError}
            />

            <QuickCashAdvanceFooter
              setIsOpen={setIsOpen}
              t={t}
              mutation={mutation}
              activeShift={activeShift}
              employeeId={employeeId}
              parsedAmount={parsedAmount}
              requiresManagerAuth={requiresManagerAuth}
              activeTab={activeTab}
              isEarlyWagePayout={isEarlyWagePayout}
            />
          </form>
        )}
      </div>
    </DialogShell>
  );
}
