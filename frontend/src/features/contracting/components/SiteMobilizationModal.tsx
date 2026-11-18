import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import {
  ContractingMobilizationSummary,
  MobilizationExpenseCategory,
} from '../contracting.types';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { todayLocalDateKey } from '@/lib/format';

interface SiteMobilizationModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const CATEGORY_LABELS: Record<MobilizationExpenseCategory, { label: string; hint: string }> = {
  worker_housing: { label: 'سكن العمال والموظفين', hint: 'إيجارات الشقق، الفواتير، والأثاث المؤقت' },
  site_preparation: { label: 'تمهيد وتشوين الموقع', hint: 'تسوية الأرض، الحفر الأولي، وتجهيز أماكن البضاعة' },
  temporary_utilities: { label: 'المرافق والكهرباء والمياه', hint: 'توصيل وتأمين عدادات المياه والكهرباء المؤقتة' },
  site_cabins: { label: 'كرفانات وسور الموقع', hint: 'توريد كرفان الإدارة، غرفة الخفير، والأسوار المعدنية' },
  permits_legal: { label: 'التراخيص والرسوم الميدانية', hint: 'تصاريح الإشغال، الحفر، والموافقات الأمنية' },
  transport_logistics: { label: 'النقل والإعاشة والمصروفات', hint: 'سيارات نقل العمال، وجبات، ومصروفات نثرية' },
  other: { label: 'مصاريف تأسيسية أخرى', hint: 'أي تكاليف استثنائية لتجهيز العملية' },
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, item]) => ({
  value,
  label: item.label,
  hint: item.hint,
}));

const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقداً (كاش عهدة)' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'check', label: 'شيك مصرفي' },
  { value: 'custody', label: 'من عهدة المهندس' },
];

export function SiteMobilizationModal({
  open,
  projectId,
  projectName = '',
  onClose,
  onSuccess,
}: SiteMobilizationModalProps) {
  const { t } = useTranslation();
  const { currencySymbol, formatCurrency } = useSystemCurrency();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContractingMobilizationSummary | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New expense form state
  const [category, setCategory] = useState<MobilizationExpenseCategory>('worker_housing');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [expenseDate, setExpenseDate] = useState(todayLocalDateKey());
  const [paidTo, setPaidTo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [referenceReceipt, setReferenceReceipt] = useState('');
  const [notes, setNotes] = useState('');

  const loadExpenses = async () => {
    if (!projectId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await contractingApi.getSiteMobilizationExpenses(projectId);
      setSummary(data);
    } catch (err: any) {
      console.error('Failed to load mobilization expenses:', err);
      setErrorMsg(err?.message || 'فشل تحميل بيانات تجهيز الموقع');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && projectId) {
      loadExpenses();
      setShowAddForm(false);
    }
  }, [open, projectId]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('يرجى كتابة بيان المصروف');
      return;
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await contractingApi.createSiteMobilizationExpense(projectId, {
        expenseCategory: category,
        title: title.trim(),
        amount: numAmount,
        expenseDate,
        paidTo: paidTo.trim() || 'غير محدد',
        paymentMethod,
        referenceReceipt: referenceReceipt.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      // Reset form
      setTitle('');
      setAmount('');
      setPaidTo('');
      setReferenceReceipt('');
      setNotes('');
      setShowAddForm(false);
      await loadExpenses();
      onSuccess?.();
    } catch (err: any) {
      console.error('Failed to create mobilization expense:', err);
      setErrorMsg(err?.message || 'حدث خطأ أثناء حفظ المصروف');
    } finally {
      setSaving(false);
    }
  };

  const safeExpenses = Array.isArray(summary?.expenses) ? summary!.expenses : [];
  const totalHousing = safeExpenses
    .filter((e) => e.expenseCategory === 'worker_housing')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalSitePrep = safeExpenses
    .filter((e) => e.expenseCategory === 'site_preparation' || e.expenseCategory === 'site_cabins')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalUtilities = safeExpenses
    .filter((e) => e.expenseCategory === 'temporary_utilities')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.site_mobilization_modal.s0', "تجهيز الموقع وسكن العمال والمصاريف التأسيسية")}
      subtitle={projectName ? `المشروع: ${projectName}` : t('contracting.site_mobilization_modal.s1', "تسجيل وتتبع مصاريف تمهيد الموقع وسكن العمال وكرفانات الإدارة")}
      width="min(1050px, 95vw)"
      minHeight="min(600px, 85vh)"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
            {t('contracting.site_mobilization_modal.s2', "تُحمّل هذه المصاريف مباشرة على مركز تكلفة المشروع لضمان دقة صافي الأرباح.")}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 22px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontSize: 'var(--font-body)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('contracting.site_mobilization_modal.s3', "إغلاق النافذة")}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }} dir="rtl">
        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 'var(--font-body)', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {/* KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.site_mobilization_modal.s4', "إجمالي مصاريف التجهيز")}</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#170e5e', marginTop: '3px' }}>
              {loading ? '—' : formatCurrency(summary?.totalAmount)}
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.site_mobilization_modal.s5', "سكن العمال والموظفين")}</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0369a1', marginTop: '3px' }}>
              {loading ? '—' : formatCurrency(totalHousing)}
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.site_mobilization_modal.s6', "تمهيد الأرض والكرفانات")}</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f766e', marginTop: '3px' }}>
              {loading ? '—' : formatCurrency(totalSitePrep)}
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.site_mobilization_modal.s7', "المرافق والكهرباء والمياه")}</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#b45309', marginTop: '3px' }}>
              {loading ? '—' : formatCurrency(totalUtilities)}
            </div>
          </div>
        </div>

        {/* Action button to toggle form */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {t('contracting.site_mobilization_modal.s8', "سجل المصروفات التأسيسية للموقع (")}{summary?.itemsCount || 0} {t('contracting.site_mobilization_modal.s9', "حركة)")}
          </h3>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: showAddForm ? '#f1f5f9' : '#170e5e',
              color: showAddForm ? '#334155' : '#ffffff',
              fontSize: 'var(--font-body)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {showAddForm ? <AppIcons.X size={15} /> : <AppIcons.Plus size={15} />}
            <span>{showAddForm ? t('contracting.site_mobilization_modal.s10', "إلغاء الإضافة") : t('contracting.site_mobilization_modal.s11', "إضافة مصروف تجهيز جديد")}</span>
          </button>
        </div>

        {/* Add Expense Form Card */}
        {showAddForm && (
          <form
            onSubmit={handleCreateExpense}
            style={{
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontWeight: 700, color: '#170e5e', fontSize: 'var(--font-body)' }}>
              {t('contracting.site_mobilization_modal.s12', "تسجيل مصروف تجهيز أو سكن جديد")}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s13', "تصنيف المصروف *")}
                </label>
                <CustomSelect
                  value={category}
                  options={CATEGORY_OPTIONS}
                  onChange={(val) => setCategory(val as MobilizationExpenseCategory)}
                  placeholder={t('contracting.site_mobilization_modal.s14', "اختر التصنيف...")}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s15', "بيان وتفاصيل المصروف *")}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('contracting.site_mobilization_modal.s16', "مثال: إيجار شقة عمال شهر مارس، أو تمهيد لودر...")}
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s17', "المبلغ المنصرف (")}{currencySymbol}) *
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="0.00"
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s18', "تاريخ الصرف *")}
                </label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s19', "صُرف إلى (المستلم)")}
                </label>
                <input
                  type="text"
                  value={paidTo}
                  onChange={(e) => setPaidTo(e.target.value)}
                  placeholder={t('contracting.site_mobilization_modal.s20', "مالك الشقة / سائق اللودر / المقاول...")}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s21', "طريقة السداد")}
                </label>
                <CustomSelect
                  value={paymentMethod}
                  options={PAYMENT_METHODS}
                  onChange={(val) => setPaymentMethod(val)}
                  placeholder={t('contracting.site_mobilization_modal.s22', "طريقة الدفع...")}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {t('contracting.site_mobilization_modal.s23', "رقم الإيصال / السند")}
                </label>
                <input
                  type="text"
                  value={referenceReceipt}
                  onChange={(e) => setReferenceReceipt(e.target.value)}
                  placeholder={t('contracting.site_mobilization_modal.s24', "سند قبض / إيصال...")}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                {t('contracting.site_mobilization_modal.s25', "ملاحظات وتفاصيل إضافية")}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('contracting.site_mobilization_modal.s26', "أي شروط أو تفاصيل تعاقدية تخص السكن أو التجهيز...")}
                style={{
                  width: '100%',
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: 'var(--font-body)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('contracting.site_mobilization_modal.s27', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '7px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: 'var(--font-body)',
                  fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? t('contracting.site_mobilization_modal.s28', "جارٍ الحفظ...") : t('contracting.site_mobilization_modal.s29', "حفظ المصروف وترحيله")}
              </button>
            </div>
          </form>
        )}

        {/* Expenses Table */}
        <div
          style={{
            minHeight: '280px',
            maxHeight: '380px',
            overflowY: 'auto',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '280px', gap: '12px', backgroundColor: '#f8fafc', color: '#64748b' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #cbd5e1', borderTopColor: '#170e5e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 600 }}>
                {t('contracting.site_mobilization_modal.s30', "جارٍ تحميل مصروفات تجهيز الموقع وسكن العمال...")}
              </span>
            </div>
          ) : safeExpenses.length === 0 ? (
            <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '36px', textAlign: 'center', color: '#64748b' }}>
              <AppIcons.Building size={32} style={{ color: '#94a3b8' }} />
              <div style={{ fontWeight: 600 }}>{t('contracting.site_mobilization_modal.s31', "لا توجد مصروفات تجهيز أو سكن مسجلة لهذا المشروع بعد.")}</div>
              <div style={{ fontSize: 'var(--font-micro)', color: '#94a3b8' }}>
                {t('contracting.site_mobilization_modal.s32', "اضغط على \"إضافة مصروف تجهيز جديد\" لتسجيل إيجارات العمال أو تمهيد الأرض.")}
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s33', "التصنيف")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s34', "بيان المصروف")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s35', "المبلغ")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s36', "التاريخ")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s37', "صُرف إلى")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s38', "طريقة الدفع")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.site_mobilization_modal.s39', "سند القبض")}</th>
                  </tr>
                </thead>
                <tbody>
                  {safeExpenses.map((expense) => {
                    const catInfo = CATEGORY_LABELS[expense.expenseCategory] || { label: expense.expenseCategory };
                    return (
                      <tr key={expense.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: 'var(--font-badge)',
                              fontWeight: 600,
                              backgroundColor: '#eef2ff',
                              color: '#170e5e',
                            }}
                          >
                            {catInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}>
                          {expense.title}
                          {expense.notes && (
                            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                              {expense.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                          {formatCurrency(expense.amount)}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#64748b' }}>
                          {expense.expenseDate}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#334155' }}>
                          {expense.paidTo}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#64748b' }}>
                          {PAYMENT_METHODS.find((m) => m.value === expense.paymentMethod)?.label || expense.paymentMethod}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#64748b' }}>
                          {expense.referenceReceipt || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          )}
        </div>
      </div>
    </StandardDialog>
  );
}
