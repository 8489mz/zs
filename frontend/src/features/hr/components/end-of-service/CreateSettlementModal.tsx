import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { XIcon, AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import type { SettlementPreview } from '../../api/end-of-service.api';

interface CreateSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeesList: any[];
  selectedEmployeeId: number | '';
  onEmployeeChange: (id: number | '') => void;
  terminationDate: string;
  onTerminationDateChange: (val: string) => void;
  terminationReason: string;
  onTerminationReasonChange: (val: string) => void;
  lawType: 'saudi' | 'egyptian' | 'custom' | '';
  onLawTypeChange: (val: 'saudi' | 'egyptian' | 'custom' | '') => void;
  customDaysPerYear: number;
  onCustomDaysChange: (val: number) => void;
  pendingSalaryAmount: number | '';
  onPendingSalaryChange: (val: number | '') => void;
  noticePeriodAmount: number;
  onNoticePeriodChange: (val: number) => void;
  customEntitlements: number;
  onCustomEntitlementsChange: (val: number) => void;
  assetsDeduction: number;
  onAssetsDeductionChange: (val: number) => void;
  otherDeductions: number;
  onOtherDeductionsChange: (val: number) => void;
  custodyCleared: boolean;
  onCustodyClearedChange: (val: boolean) => void;
  clearanceNotes: string;
  onClearanceNotesChange: (val: string) => void;
  confirmTermination: boolean;
  onConfirmTerminationChange: (val: boolean) => void;
  preview: SettlementPreview | null;
  calculating: boolean;
  saving: boolean;
  feedback: { text: string; error?: boolean } | null;
  onCalculate: () => void;
  onSave: () => void;
}

export function CreateSettlementModal({
  isOpen,
  onClose,
  employeesList,
  selectedEmployeeId,
  onEmployeeChange,
  terminationDate,
  onTerminationDateChange,
  terminationReason,
  onTerminationReasonChange,
  lawType,
  onLawTypeChange,
  customDaysPerYear,
  onCustomDaysChange,
  pendingSalaryAmount,
  onPendingSalaryChange,
  noticePeriodAmount,
  onNoticePeriodChange,
  customEntitlements,
  onCustomEntitlementsChange,
  assetsDeduction,
  onAssetsDeductionChange,
  otherDeductions,
  onOtherDeductionsChange,
  custodyCleared,
  onCustodyClearedChange,
  confirmTermination,
  onConfirmTerminationChange,
  preview,
  calculating,
  saving,
  feedback,
  onCalculate,
  onSave,
}: CreateSettlementModalProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <DialogShell open={true} onClose={onClose} width="min(820px, 96vw)">
      <div dir="rtl" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 14, marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
              {t('hr.end_of_service.create_settlement_modal.s0', "إنشاء مخالصة واحتساب مكافأة نهاية الخدمة")}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              {t('hr.end_of_service.create_settlement_modal.s1', "تصفية مستحقات الموظف المنتهية خدماته واستخراج الحسبة النظامية الآلية")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}
          >
            <XIcon size={20} />
          </button>
        </div>

        {feedback && (
          <div style={{ background: feedback.error ? '#fef2f2' : '#f0fdf4', color: feedback.error ? '#991b1b' : '#166534', border: `1px solid ${feedback.error ? '#fecdd3' : '#bbf7d0'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircleIcon size={16} />
            <span>{feedback.text}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              {t('hr.end_of_service.create_settlement_modal.s2', "الموظف *")}
            </label>
            <select
              value={selectedEmployeeId}
              onChange={e => onEmployeeChange(e.target.value ? Number(e.target.value) : '')}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="">{t('hr.end_of_service.create_settlement_modal.s3', "-- اختر الموظف --")}</option>
              {employeesList.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name || emp.displayName || emp.employeeName} ({emp.employeeNo || emp.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              {t('hr.end_of_service.create_settlement_modal.s4', "تاريخ نهاية الخدمة *")}
            </label>
            <input
              type="date"
              value={terminationDate}
              onChange={e => onTerminationDateChange(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              {t('hr.end_of_service.create_settlement_modal.s5', "سبب انتهاء الخدمة *")}
            </label>
            <select
              value={terminationReason}
              onChange={e => onTerminationReasonChange(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="resignation">{t('hr.end_of_service.create_settlement_modal.s6', "استقالة الموظف")}</option>
              <option value="termination">{t('hr.end_of_service.create_settlement_modal.s7', "إنهاء خدمة / فصل من صاحب العمل")}</option>
              <option value="contract_end">{t('hr.end_of_service.create_settlement_modal.s8', "انتهاء مدة العقد المحدد")}</option>
              <option value="other">{t('hr.end_of_service.create_settlement_modal.s9', "أسباب أخرى / اتفاق ودي")}</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
              {t('hr.end_of_service.create_settlement_modal.s10', "نظام العمل المطبق *")}
            </label>
            <select
              value={lawType}
              onChange={e => onLawTypeChange(e.target.value as any)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="">-- اختر نظام العمل --</option>
              <option value="saudi">{t('hr.end_of_service.create_settlement_modal.s11', "نظام العمل السعودي (مكافأة تدرجية)")}</option>
              <option value="egyptian" disabled>قانون العمل المصري (تحتاج الحسبة القانونية إلى اعتماد)</option>
              <option value="custom">{t('hr.end_of_service.create_settlement_modal.s13', "مخصص (حسب اللائحة الداخلية)")}</option>
            </select>
          </div>

          {lawType === 'custom' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                أيام الأجر لكل سنة حسب لائحة مُعتمدة (أدخلها صراحة)
              </label>
              <input
                type="number"
                value={customDaysPerYear}
                onChange={e => onCustomDaysChange(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: 6 }}>
            المرتب المتبقي المستحق بعد مراجعة كشوف المرتبات *
          </label>
          <input type="number" min={0} step="0.01" value={pendingSalaryAmount}
            onChange={(event) => onPendingSalaryChange(event.target.value === '' ? '' : Number(event.target.value))}
            placeholder="أدخل صفر إذا تم صرف الراتب بالكامل"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.76rem' }}>
            لا يتم إضافة أجر الأيام تلقائيًا لمنع صرف الراتب مرتين.
          </p>
        </div>

        {/* Adjustments & Custodies */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 18 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 700, color: '#334155' }}>
            {t('hr.end_of_service.create_settlement_modal.s15', "التسويات الإضافية والعهد")}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>{t('hr.end_of_service.create_settlement_modal.s16', "بدل إنذار مستحق")}</label>
              <input
                type="number"
                value={noticePeriodAmount}
                onChange={e => onNoticePeriodChange(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>{t('hr.end_of_service.create_settlement_modal.s17', "مستحقات إضافية (مكافآت)")}</label>
              <input
                type="number"
                value={customEntitlements}
                onChange={e => onCustomEntitlementsChange(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#b91c1c', marginBottom: 4 }}>{t('hr.end_of_service.create_settlement_modal.s18', "خصم قيمة عهد تالفة/مفقودة")}</label>
              <input
                type="number"
                value={assetsDeduction}
                onChange={e => onAssetsDeductionChange(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#b91c1c', marginBottom: 4 }}>{t('hr.end_of_service.create_settlement_modal.s19', "خصومات أخرى")}</label>
              <input
                type="number"
                value={otherDeductions}
                onChange={e => onOtherDeductionsChange(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={custodyCleared}
                onChange={e => onCustodyClearedChange(e.target.checked)}
              />
              <span>{t('hr.end_of_service.create_settlement_modal.s20', "تم استلام كافة العهد العينية والأجهزة وإخلاء الطرف")}</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmTermination}
                disabled
                onChange={e => onConfirmTerminationChange(e.target.checked)}
              />
              <span>تحديث حالة الموظف عند ترحيل المخالصة محاسبياً، وليس عند حفظ المسودة</span>
            </label>
          </div>
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <Button
            type="button"
            variant="secondary"
            disabled={calculating || !selectedEmployeeId}
            onClick={onCalculate}
            style={{ padding: '8px 24px', fontWeight: 700, fontSize: '0.85rem' }}
          >
            {calculating ? t('hr.end_of_service.create_settlement_modal.s22', "جارٍ احتساب الحسبة النظامية...") : t('hr.end_of_service.create_settlement_modal.s23', "احتساب الحسبة والمستحقات الآلية")}
          </Button>
        </div>

        {/* Preview Results Card */}
        {preview && (
          <div style={{ border: '2px solid #bbf7d0', borderRadius: 12, padding: 18, background: '#f0fdf4', marginBottom: 20 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 800, color: '#166534' }}>
              {t('hr.end_of_service.create_settlement_modal.s24', "نتائج الاحتساب النظامي لمستحقات الموظف:")} {preview.employee.name}
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s25', "تاريخ التعيين")}</span>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{preview.employee.hireDate ? formatDateOnly(preview.employee.hireDate) : t('hr.end_of_service.create_settlement_modal.s26', "غير مسجل")}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s27', "مدة الخدمة الفعلية")}</span>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{preview.servicePeriod.years} {t('hr.end_of_service.create_settlement_modal.s28', "سنة و")} {preview.servicePeriod.months} {t('hr.end_of_service.create_settlement_modal.s29', "شهر")}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s30', "الراتب الأساسي المعتمد")}</span>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{formatCurrency(preview.salaries.basicSalary)}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s31', "رصيد الإجازات المتبقي")}</span>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>{preview.leaveEncashment.remainingLeaveDays} {t('hr.end_of_service.create_settlement_modal.s32', "يوم (")}{formatCurrency(preview.leaveEncashment.leaveEncashmentAmount)})</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, borderTop: '1px solid #bbf7d0', paddingTop: 12 }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s33', "مكافأة نهاية الخدمة")}</span>
                <strong style={{ fontSize: '1.1rem', color: '#15803d' }}>{formatCurrency(preview.gratuity.gratuityAmount)}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s34', "متبقي السلف المخصومة")}</span>
                <strong style={{ fontSize: '1.1rem', color: '#dc2626' }}>{formatCurrency(preview.unpaidLoansDeduction)}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>{t('hr.end_of_service.create_settlement_modal.s35', "صافي المستحق النهائي للموظف")}</span>
                <strong style={{ fontSize: '1.3rem', color: '#170e5e' }}>{formatCurrency(preview.netSettlementAmount)}</strong>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('hr.end_of_service.create_settlement_modal.s36', "إلغاء")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || !preview}
            onClick={onSave}
            style={{ background: '#170e5e', borderColor: '#170e5e', fontWeight: 700 }}
          >
            {saving ? t('hr.end_of_service.create_settlement_modal.s37', "جارٍ الحفظ...") : t('hr.end_of_service.create_settlement_modal.s38', "حفظ واعتماد المخالصة")}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
