import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import type { ContractingSubcontract, ContractingSubcontractor, GuaranteeType } from '../contracting.types';
import { toast } from '@/shared/components/system-alert';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';

interface CreateGuaranteeModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  subcontractId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const GUARANTEE_TYPES = [
  { value: 'advance_payment', label: 'ضمان دفعة مقدمة (Advance Payment)' },
  { value: 'performance', label: 'ضمان حسن تنفيذ (Performance Bond)' },
  { value: 'retention', label: 'ضمان محتجز الضمان (Retention Bond)' },
  { value: 'maintenance', label: 'ضمان صيانة وأعمال نهائية (Maintenance Bond)' },
  { value: 'bid_bond', label: 'ضمان ابتدائي / عطاء (Bid Bond)' },
];

export function CreateGuaranteeModal({
  open,
  projectId,
  projectName,
  subcontractId: initialSubcontractId,
  onClose,
  onSuccess,
}: CreateGuaranteeModalProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useSystemCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [subcontracts, setSubcontracts] = useState<ContractingSubcontract[]>([]);
  const [subcontractors, setSubcontractors] = useState<ContractingSubcontractor[]>([]);

  const todayStr = todayLocalDateKey();
  const nextYearStr = addDaysLocalDateKey(365);

  const [formData, setFormData] = useState({
    subcontractId: initialSubcontractId || '',
    subcontractorId: '',
    guaranteeNumber: '',
    guaranteeType: 'advance_payment' as GuaranteeType,
    issuingBank: '',
    amount: '',
    currency: 'EGP',
    issueDate: todayStr,
    expiryDate: nextYearStr,
    claimExpiryDate: '',
    documentUrl: '',
    notes: '',
  });

  useEffect(() => {
    if (open) {
      if (projectId) {
        contractingApi.getSubcontracts(projectId)
          .then((data) => setSubcontracts(data || []))
          .catch(() => setSubcontracts([]));
      }

      contractingApi.getSubcontractors()
        .then((data) => setSubcontractors(data || []))
        .catch(() => setSubcontractors([]));

      setFormData({
        subcontractId: initialSubcontractId || '',
        subcontractorId: '',
        guaranteeNumber: '',
        guaranteeType: 'advance_payment',
        issuingBank: '',
        amount: '',
        currency: 'EGP',
        issueDate: todayStr,
        expiryDate: nextYearStr,
        claimExpiryDate: '',
        documentUrl: '',
        notes: '',
      });
      setErrorMsg(null);
    }
  }, [open, projectId, initialSubcontractId]);

  const handleSubcontractChange = (subId: string) => {
    const selected = subcontracts.find((s) => s.id === subId);
    setFormData((prev) => ({
      ...prev,
      subcontractId: subId,
      subcontractorId: selected?.subcontractorId ? String(selected.subcontractorId) : prev.subcontractorId,
      amount: prev.amount || (selected?.advanceAmount ? String(selected.advanceAmount) : prev.amount),
    }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!formData.guaranteeNumber.trim()) {
      setErrorMsg('يرجى إدخال رقم خطاب الضمان البنكي');
      return;
    }
    if (!formData.issuingBank.trim()) {
      setErrorMsg('يرجى إدخال اسم البنك المصدر للخطاب');
      return;
    }
    const val = Number(formData.amount);
    if (isNaN(val) || val <= 0) {
      setErrorMsg('يرجى إدخال قيمة صحيحة لخطاب الضمان أكبر من الصفر');
      return;
    }
    if (!formData.issueDate || !formData.expiryDate) {
      setErrorMsg('يرجى تحديد تاريخ الإصدار وتاريخ انتهاء الصلاحية');
      return;
    }
    if (formData.issueDate > formData.expiryDate) {
      setErrorMsg('تاريخ انتهاء سريان الضمان يجب أن يكون بعد تاريخ الإصدار');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await contractingApi.createGuarantee({
        projectId,
        subcontractId: formData.subcontractId || undefined,
        subcontractorId: formData.subcontractorId ? Number(formData.subcontractorId) : undefined,
        guaranteeNumber: formData.guaranteeNumber.trim(),
        guaranteeType: formData.guaranteeType,
        issuingBank: formData.issuingBank.trim(),
        amount: val,
        currency: formData.currency || 'EGP',
        issueDate: formData.issueDate,
        expiryDate: formData.expiryDate,
        claimExpiryDate: formData.claimExpiryDate || undefined,
        documentUrl: formData.documentUrl.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      });

      toast.success('تم تسجيل خطاب الضمان البنكي وتفعيله بنجاح');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء تسجيل خطاب الضمان');
    } finally {
      setIsSubmitting(false);
    }
  };

  const subcontractOptions = [
    { value: '', label: 'بدون ربط بعقد محدد (ضمان على مستوى المشروع)' },
    ...subcontracts.map((sc) => ({
      value: sc.id,
      label: `${sc.contractNumber} - ${sc.subcontractorName || 'مقاول'} (${Number(sc.totalAmount || 0).toLocaleString()} ${currencySymbol})`,
    })),
  ];

  const subcontractorOptions = [
    { value: '', label: 'بدون مقاول محدد' },
    ...subcontractors.map((sub) => ({
      value: String(sub.id),
      label: `${sub.name} (${(sub as any).tradeSpecialty || (sub as any).specialty || 'مقاول عام'})`,
    })),
  ];

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.create_guarantee_modal.s0', "تسجيل خطاب ضمان بنكي جديد (Bank Guarantee)")}
      subtitle={`المشروع: ${projectName || projectId} | تفعيل البوابة الرقابية والحماية المالية`}
      maxWidth="780px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              fontSize: 'var(--font-body)',
              fontWeight: 500,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* معلومات الضمان والنوع */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Field label={t('contracting.create_guarantee_modal.s1', "نوع خطاب الضمان *")}>
            <CustomSelect
              options={GUARANTEE_TYPES}
              value={formData.guaranteeType}
              onChange={(val) => setFormData((prev) => ({ ...prev, guaranteeType: val as GuaranteeType }))}
            />
          </Field>

          <Field label={t('contracting.create_guarantee_modal.s2', "رقم خطاب الضمان لدى البنك *")}>
            <input
              type="text"
              value={formData.guaranteeNumber}
              onChange={(e) => setFormData((prev) => ({ ...prev, guaranteeNumber: e.target.value }))}
              placeholder={t('contracting.create_guarantee_modal.s3', "مثال: LG-2026-NBE-0091")}
              required
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>
        </div>

        {/* البنك والمبلغ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Field label={t('contracting.create_guarantee_modal.s4', "البنك المصدر للخطاب *")}>
            <input
              type="text"
              value={formData.issuingBank}
              onChange={(e) => setFormData((prev) => ({ ...prev, issuingBank: e.target.value }))}
              placeholder={t('contracting.create_guarantee_modal.s5', "مثال: البنك الأهلي المصري - فرع المهندسين")}
              required
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>

          <Field label={`قيمة الضمان (${formData.currency}) *`}>
            <input
              type="number"
              min="0.01"
              step="any"
              value={formData.amount}
              onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="0.00"
              required
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                fontWeight: 600,
                boxSizing: 'border-box',
              }}
            />
          </Field>
        </div>

        {/* التواريخ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <Field label={t('contracting.create_guarantee_modal.s6', "تاريخ الإصدار *")}>
            <input
              type="date"
              value={formData.issueDate}
              onChange={(e) => setFormData((prev) => ({ ...prev, issueDate: e.target.value }))}
              required
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>

          <Field label={t('contracting.create_guarantee_modal.s7', "تاريخ انتهاء السريان *")}>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData((prev) => ({ ...prev, expiryDate: e.target.value }))}
              required
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                fontWeight: 600,
                boxSizing: 'border-box',
              }}
            />
          </Field>

          <Field label={t('contracting.create_guarantee_modal.s8', "فترة المطالبة اللاحقة (اختياري)")}>
            <input
              type="date"
              value={formData.claimExpiryDate}
              onChange={(e) => setFormData((prev) => ({ ...prev, claimExpiryDate: e.target.value }))}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>
        </div>

        {/* الربط بالعقد والمقاول */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Field label={t('contracting.create_guarantee_modal.s9', "الربط بعقد مقاول باطن")}>
            <CustomSelect
              options={subcontractOptions}
              value={formData.subcontractId}
              onChange={handleSubcontractChange}
            />
          </Field>

          <Field label={t('contracting.create_guarantee_modal.s10', "مقاول الباطن المعني")}>
            <CustomSelect
              options={subcontractorOptions}
              value={formData.subcontractorId}
              onChange={(val) => setFormData((prev) => ({ ...prev, subcontractorId: val }))}
            />
          </Field>
        </div>

        {/* الملاحظات ورابط الوثيقة */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Field label={t('contracting.create_guarantee_modal.s11', "رابط الوثيقة / صورة الخطاب")}>
            <input
              type="text"
              value={formData.documentUrl}
              onChange={(e) => setFormData((prev) => ({ ...prev, documentUrl: e.target.value }))}
              placeholder={t('contracting.create_guarantee_modal.s12', "https://... أو مسار الملف")}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>

          <Field label={t('contracting.create_guarantee_modal.s13', "ملاحظات وشروط خاصة")}>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder={t('contracting.create_guarantee_modal.s14', "أي شروط تمديد أو تخفيض أو تفاصيل بنكية")}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>
        </div>

        <StandardDialogFooter
          onClose={onClose}
          isSubmitting={isSubmitting}
          submitText={t('contracting.create_guarantee_modal.s15', "تسجيل وتفعيل خطاب الضمان")}
          cancelText={t('contracting.create_guarantee_modal.s16', "إلغاء")}
        />
      </form>
    </StandardDialog>
  );
}
