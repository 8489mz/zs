import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { useHrWorkspace } from '@/features/hr/hooks/useHr';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import {
  endOfServiceApi,
  SettlementRecord,
  SettlementPreview,
} from '@/features/hr/api/end-of-service.api';
import { PlusIcon, SearchIcon } from '@/shared/components/icons/AppIcons';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { EndOfServiceKpiCards } from '../components/end-of-service/EndOfServiceKpiCards';
import { SettlementsTable } from '../components/end-of-service/SettlementsTable';
import { CreateSettlementModal } from '../components/end-of-service/CreateSettlementModal';
import { PrintSettlementModal } from '../components/end-of-service/PrintSettlementModal';
import { todayLocalDateKey } from '@/lib/format';

export function HrEndOfServicePage() {
  const { t } = useTranslation();
  const { employees } = useHrWorkspace({ pageSize: 150 });
  const canCreateSettlement = useHasAnyPermission('hrSalaryManage');
  const canPostSettlement = useHasAnyPermission('hrPayrollApprove');
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // New Settlement Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | ''>('');
  const [terminationDate, setTerminationDate] = useState(() => todayLocalDateKey());
  const [terminationReason, setTerminationReason] = useState('resignation');
  const [lawType, setLawType] = useState<'saudi' | 'egyptian' | 'custom' | ''>('');
  const [customDaysPerYear, setCustomDaysPerYear] = useState(0);
  const [pendingSalaryAmount, setPendingSalaryAmount] = useState<number | ''>('');
  const [noticePeriodAmount, setNoticePeriodAmount] = useState(0);
  const [customEntitlements, setCustomEntitlements] = useState(0);
  const [assetsDeduction, setAssetsDeduction] = useState(0);
  const [otherDeductions, setOtherDeductions] = useState(0);
  const [custodyCleared, setCustodyCleared] = useState(false);
  const [clearanceNotes, setClearanceNotes] = useState('');
  const [confirmTermination, setConfirmTermination] = useState(true);

  // Calculation state
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  // Print Modal state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printingSettlement, setPrintingSettlement] = useState<SettlementRecord | null>(null);

  // Post Accounting state
  const [postingId, setPostingId] = useState<number | null>(null);

  useEffect(() => {
    loadSettlements();
  }, []);

  const loadSettlements = async () => {
    setLoading(true);
    try {
      const list = await endOfServiceApi.list();
      setSettlements(list || []);
    } catch {
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculatePreview = async () => {
    if (!selectedEmployeeId || !lawType || pendingSalaryAmount === '') {
      setFeedback({ text: 'اختر الموظف ونظام العمل وحدد المرتب المتبقي بعد مراجعة ما تم صرفه.', error: true });
      return;
    }
    setCalculating(true);
    setFeedback(null);
    try {
      const res = await endOfServiceApi.calculatePreview({
        employeeId: Number(selectedEmployeeId),
        terminationDate,
        terminationReason,
        lawType,
        customGratuityDaysPerYear: customDaysPerYear,
        pendingSalaryAmount: Number(pendingSalaryAmount),
        noticePeriodAmount,
        customEntitlements,
        assetsDeduction,
        otherDeductions,
      });
      setPreview(res);
    } catch (err: any) {
      setFeedback({ text: err?.message || 'تعذر احتساب مستحقات نهاية الخدمة', error: true });
    } finally {
      setCalculating(false);
    }
  };

  const handleSaveSettlement = async () => {
    if (!selectedEmployeeId || !preview || !lawType || pendingSalaryAmount === '') {
      setFeedback({ text: 'يرجى احتساب المستحقات واستكمال نظام العمل والمرتب المتبقي أولاً', error: true });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await endOfServiceApi.create({
        employeeId: Number(selectedEmployeeId),
        terminationDate,
        terminationReason,
        lawType,
        customGratuityDaysPerYear: customDaysPerYear,
        pendingSalaryAmount: Number(pendingSalaryAmount),
        noticePeriodAmount,
        customEntitlements,
        assetsDeduction,
        otherDeductions,
        custodyCleared,
        clearanceNotes,
        confirmTermination,
      });
      setIsCreateOpen(false);
      resetForm();
      await loadSettlements();
    } catch (err: any) {
      setFeedback({ text: err?.message || 'تعذر حفظ المخالصة', error: true });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSelectedEmployeeId('');
    setPreview(null);
    setLawType('');
    setCustomDaysPerYear(0);
    setPendingSalaryAmount('');
    setNoticePeriodAmount(0);
    setCustomEntitlements(0);
    setAssetsDeduction(0);
    setOtherDeductions(0);
    setCustodyCleared(false);
    setClearanceNotes('');
    setConfirmTermination(true);
    setFeedback(null);
  };

  const handlePostAccounting = async (settlement: SettlementRecord) => {
    const confirmed = await systemConfirm({
      title: 'ترحيل القيد المحاسبي',
      message: `هل أنت متأكد من ترحيل القيد المحاسبي للمخالصة رقم ${settlement.settlementNo}؟`,
      confirmText: 'نعم، ترحيل',
      cancelText: 'إلغاء',
      variant: 'primary',
    });
    if (!confirmed) return;
    setPostingId(settlement.id);
    try {
      const res = await endOfServiceApi.postAccounting(settlement.id, {});
      toast.success(`تم ترحيل القيد المحاسبي بنجاح برقم قيد #${res.entryNo || res.journalEntryId}`);
      await loadSettlements();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ترحيل القيد المحاسبي');
    } finally {
      setPostingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    const confirmed = await systemConfirm({
      title: 'حذف مسودة المخالصة',
      message: 'هل أنت متأكد من حذف مسودة هذه المخالصة نهائياً؟',
      confirmText: 'نعم، حذف',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await endOfServiceApi.remove(id);
      toast.success('تم حذف مسودة المخالصة بنجاح');
      await loadSettlements();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حذف المخالصة');
    }
  };

  const handlePrint = (settlement: SettlementRecord) => {
    setPrintingSettlement(settlement);
    setPrintModalOpen(true);
  };

  // KPI Calculations
  const totalCount = settlements.length;
  const pendingAccounting = settlements.filter((s) => s.status !== 'posted').length;
  const totalGratuitySum = settlements.reduce((sum, s) => sum + (s.gratuityAmount || 0), 0);
  const clearedCustodies = settlements.filter((s) => s.custodyCleared).length;

  const filteredSettlements = useMemo(() => {
    return settlements.filter((s) => {
      const matchSearch =
        !searchQuery ||
        s.settlementNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.employeeNo && s.employeeNo.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [settlements, searchQuery, statusFilter]);

  const activeEmployeesList = useMemo(() => {
    const list = (employees.data as any)?.rows || (employees.data as any)?.employees || [];
    return Array.isArray(list) ? list : [];
  }, [employees.data]);

  return (
    <div className="page-stack page-shell hr-end-of-service-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={t('hr.hr_end_of_service_page.s0', "مخالصات ومكافأة نهاية الخدمة (End of Service Settlements)")}
          description={t('hr.hr_end_of_service_page.s1', "احتساب مكافأة نهاية الخدمة وتصفية مستحقات وعهد الموظفين وفق أنظمة العمل وإصدار قيود المحاسبة ونماذج المخالصة الرسمية")}
          badge={<span className="nav-pill">{t('hr.hr_end_of_service_page.s2', "الموارد البشرية")}</span>}
          actions={canCreateSettlement ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                resetForm();
                setIsCreateOpen(true);
              }}
              style={{
                background: '#170e5e',
                borderColor: '#170e5e',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                fontWeight: 700,
              }}
            >
              <PlusIcon size={16} />
              <span>{t('hr.hr_end_of_service_page.s3', "إنشاء مخالصة جديدة")}</span>
            </Button>
          ) : undefined}
        />

        {/* KPI Cards */}
        <EndOfServiceKpiCards
          totalCount={totalCount}
          pendingAccounting={pendingAccounting}
          totalGratuitySum={totalGratuitySum}
          clearedCustodies={clearedCustodies}
        />

        {/* Main Table Card */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {/* Filter bar */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', background: '#ffffff' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                <SearchIcon size={16} />
              </span>
              <input
                type="text"
                placeholder={t('hr.hr_end_of_service_page.s4', "بحث برقم المخالصة، اسم الموظف، أو الرقم الوظيفي...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 36px 9px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>{t('hr.hr_end_of_service_page.s5', "الحالة:")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              >
                <option value="all">{t('hr.hr_end_of_service_page.s6', "كل الحالات")}</option>
                <option value="draft">{t('hr.hr_end_of_service_page.s7', "مسودة")}</option>
                <option value="posted">{t('hr.hr_end_of_service_page.s8', "مرحل محاسبياً")}</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <SettlementsTable
            settlements={filteredSettlements}
            loading={loading}
            postingId={postingId}
            canPostAccounting={canPostSettlement}
            canDelete={canCreateSettlement}
            onPostAccounting={handlePostAccounting}
            onPrint={handlePrint}
            onDelete={handleDelete}
          />
        </div>
      </main>

      {/* Create Modal */}
      <CreateSettlementModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        employeesList={activeEmployeesList}
        selectedEmployeeId={selectedEmployeeId}
        onEmployeeChange={setSelectedEmployeeId}
        terminationDate={terminationDate}
        onTerminationDateChange={setTerminationDate}
        terminationReason={terminationReason}
        onTerminationReasonChange={setTerminationReason}
        lawType={lawType}
        onLawTypeChange={setLawType}
        customDaysPerYear={customDaysPerYear}
        pendingSalaryAmount={pendingSalaryAmount}
        onPendingSalaryChange={setPendingSalaryAmount}
        onCustomDaysChange={setCustomDaysPerYear}
        noticePeriodAmount={noticePeriodAmount}
        onNoticePeriodChange={setNoticePeriodAmount}
        customEntitlements={customEntitlements}
        onCustomEntitlementsChange={setCustomEntitlements}
        assetsDeduction={assetsDeduction}
        onAssetsDeductionChange={setAssetsDeduction}
        otherDeductions={otherDeductions}
        onOtherDeductionsChange={setOtherDeductions}
        custodyCleared={custodyCleared}
        onCustodyClearedChange={setCustodyCleared}
        clearanceNotes={clearanceNotes}
        onClearanceNotesChange={setClearanceNotes}
        confirmTermination={confirmTermination}
        onConfirmTerminationChange={setConfirmTermination}
        preview={preview}
        calculating={calculating}
        saving={saving}
        feedback={feedback}
        onCalculate={handleCalculatePreview}
        onSave={handleSaveSettlement}
      />

      {/* Print Modal */}
      {printModalOpen && printingSettlement && (
        <PrintSettlementModal
          settlement={printingSettlement}
          onClose={() => {
            setPrintModalOpen(false);
            setPrintingSettlement(null);
          }}
        />
      )}
    </div>
  );
}
