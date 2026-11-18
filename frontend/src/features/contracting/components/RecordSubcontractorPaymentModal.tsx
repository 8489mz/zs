import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import type { ContractingSubcontractor } from '../contracting.types';
import { toast } from '@/shared/components/system-alert';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { useContracting } from '../context/ContractingContext';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { todayLocalDateKey } from '@/lib/format';

interface RecordSubcontractorPaymentModalProps {
  open: boolean;
  subcontractor?: ContractingSubcontractor | null;
  initialSubcontractorId?: number;
  projectId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RecordSubcontractorPaymentModal({
  open,
  subcontractor,
  initialSubcontractorId,
  projectId,
  onClose,
  onSuccess,
}: RecordSubcontractorPaymentModalProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useSystemCurrency();
  const { projects } = useContracting();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subcontractors, setSubcontractors] = useState<ContractingSubcontractor[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string>('');

  const [formData, setFormData] = useState({
    projectId: projectId || '',
    amount: '',
    paymentDate: todayLocalDateKey(),
    paymentMethod: 'bank_transfer' as 'cash' | 'bank_transfer' | 'check',
    paymentCategory: 'progress' as 'progress' | 'advance' | 'operational_advance',
    referenceNumber: '',
    notes: '',
  });

  useEffect(() => {
    if (open) {
      if (subcontractor) {
        setSelectedSubId(String(subcontractor.id));
      } else if (initialSubcontractorId) {
        setSelectedSubId(String(initialSubcontractorId));
      }

      contractingApi.getSubcontractors()
        .then((data) => {
          setSubcontractors(data || []);
          if (data && data.length > 0 && !subcontractor && !initialSubcontractorId && !selectedSubId) {
            setSelectedSubId(String(data[0].id));
          }
        })
        .catch(() => setSubcontractors([]));

      setFormData({
        projectId: projectId || (projects.length > 0 ? projects[0].id : ''),
        amount: '',
        paymentDate: todayLocalDateKey(),
        paymentMethod: 'bank_transfer',
        paymentCategory: 'progress',
        referenceNumber: '',
        notes: '',
      });
      setErrorMsg(null);
    }
  }, [open, subcontractor, projectId, projects]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const subId = subcontractor ? subcontractor.id : Number(selectedSubId);
    if (!subId) {
      setErrorMsg('يرجى اختيار مقاول الباطن');
      return;
    }
    const val = Number(formData.amount);
    if (isNaN(val) || val <= 0) {
      setErrorMsg('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await contractingApi.createSubcontractorPayment({
        subcontractorId: subId,
        projectId: formData.projectId || undefined,
        amount: val,
        paymentDate: formData.paymentDate || undefined,
        paymentMethod: formData.paymentMethod,
        referenceNumber: formData.referenceNumber.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        isAdvancePayment: formData.paymentCategory === 'advance',
        paymentCategory: formData.paymentCategory,
      } as any);
      toast.success('تم تسجيل سند الصرف وخصم الدفعة من حساب المقاول بنجاح');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء تسجيل الدفعة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSubcontractor = subcontractor || subcontractors.find((s) => String(s.id) === selectedSubId);

  const subOptions = subcontractors.map((s) => ({
    value: String(s.id),
    label: `${s.name} (${s.tradeSpecialty || 'مقاولات عامة'})`,
    hint: s.phone ? `هاتف: ${s.phone}` : undefined,
  }));

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: `${p.code} - ${p.name}`,
  }));

  const paymentMethodOptions = [
    { value: 'bank_transfer', label: 'تحويل بنكي / إيداع' },
    { value: 'cash', label: 'نقدي (من عهدة / خزينة الموقع)' },
  ];

  const paymentCategoryOptions = [
    { value: 'progress', label: 'دفعة جارية تحت الحساب (Progress Payment)' },
    { value: 'advance', label: 'دفعة مقدمة تعاقدية (Advance Payment - خاضعة لضمان بنكي G1)' },
    { value: 'operational_advance', label: 'سلفة تشغيلية نقدية للموقع (Operational Advance - معفاة من G1)' },
  ];

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.record_subcontractor_payment_modal.s0', "تسجيل دفعة وسند صرف لمقاول باطن (Subcontractor Disbursement)")}
      subtitle={t('contracting.record_subcontractor_payment_modal.s1', "إثبات صرف دفعة مالية وقيدها في كشف حساب مقاول الباطن لتسوية مستحقاته")}
      maxWidth="680px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#fee2e2',
              color: '#991b1b',
              fontSize: 'var(--font-body)',
              border: '1px solid #fecaca',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* بطاقة معلومات المقاول الحالي */}
        {currentSubcontractor && (
          <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 'var(--font-body)' }}>{currentSubcontractor.name}</div>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                {t('contracting.record_subcontractor_payment_modal.s2', "التخصص:")} {currentSubcontractor.tradeSpecialty || t('contracting.record_subcontractor_payment_modal.s3', "مقاولات عامة")} {currentSubcontractor.phone && `• هاتف: ${currentSubcontractor.phone}`}
              </div>
            </div>
            {currentSubcontractor.netBalance !== undefined && (
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{t('contracting.record_subcontractor_payment_modal.s4', "الرصيد المستحق الحالي")}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: currentSubcontractor.netBalance > 0 ? '#15803d' : '#475569' }}>
                  {currentSubcontractor.netBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currencySymbol}
                </div>
              </div>
            )}
          </div>
        )}

        {!subcontractor && (
          <Field label={t('contracting.record_subcontractor_payment_modal.s5', "مقاول الباطن المستفيد *")}>
            <CustomSelect
              value={selectedSubId}
              onChange={(val) => setSelectedSubId(val)}
              options={subOptions}
              placeholder={t('contracting.record_subcontractor_payment_modal.s6', "اختر مقاول الباطن...")}
            />
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label={t('contracting.record_subcontractor_payment_modal.s7', "طبيعة وسياق الدفعة *")}>
            <CustomSelect
              value={formData.paymentCategory}
              onChange={(val) => setFormData({ ...formData, paymentCategory: val as any })}
              options={paymentCategoryOptions}
            />
          </Field>

          <Field label={t('contracting.record_subcontractor_payment_modal.s8', "المشروع الإنشائي")}>
            <CustomSelect
              value={formData.projectId}
              onChange={(val) => setFormData({ ...formData, projectId: val })}
              options={projectOptions}
              placeholder={t('contracting.record_subcontractor_payment_modal.s9', "اختر المشروع (اختياري)...")}
            />
          </Field>
        </div>

        {formData.paymentCategory === 'advance' && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe',
              fontSize: 'var(--font-subtitle)',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AppIcons.ShieldCheck size={18} />
            <span>
              <strong>{t('contracting.record_subcontractor_payment_modal.s10', "بوابة الاعتماد الرقابية G1 مفعلة:")}</strong> {t('contracting.record_subcontractor_payment_modal.s11', "سيتم التحقق الفوري من وجود وسريان خطاب ضمان الدفعة المقدمة البنكي للمقاول وتغطية كامل المبلغ قبل الموافقة على الصرف.")}
            </span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>

          <Field label={`مبلغ الدفعة (${currencySymbol}) *`}>
            <input
              type="number"
              step="any"
              min="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              placeholder="0.00"
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '0 12px',
                fontSize: 'var(--font-body)',
                fontWeight: 700,
                color: '#170e5e',
                boxSizing: 'border-box',
              }}
              required
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <Field label={t('contracting.record_subcontractor_payment_modal.s12', "تاريخ الصرف *")}>
            <input
              type="date"
              value={formData.paymentDate}
              onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '0 12px',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
              required
            />
          </Field>

          <Field label={t('contracting.record_subcontractor_payment_modal.s13', "طريقة السداد *")}>
            <CustomSelect
              value={formData.paymentMethod}
              onChange={(val) => setFormData({ ...formData, paymentMethod: val as any })}
              options={paymentMethodOptions}
              placeholder={t('contracting.record_subcontractor_payment_modal.s14', "طريقة السداد...")}
            />
          </Field>

          <Field label={t('contracting.record_subcontractor_payment_modal.s15', "رقم السند أو الشيك المرجعي")}>
            <input
              type="text"
              value={formData.referenceNumber}
              onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
              placeholder={t('contracting.record_subcontractor_payment_modal.s16', "رقم التحويل / الشيك")}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '0 12px',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
              }}
            />
          </Field>
        </div>

        <div>
          <Field label={t('contracting.record_subcontractor_payment_modal.s17', "البيان وملاحظات الصرف")}>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder={t('contracting.record_subcontractor_payment_modal.s18', "مثال: دفعة تحت حساب مستخلص أعمال الخرسانة المسلحة للدور الأرضي...")}
              style={{
                width: '100%',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '8px 12px',
                fontSize: 'var(--font-body)',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </Field>
        </div>

        <StandardDialogFooter
          onClose={onClose}
          submitText={isSubmitting ? t('contracting.record_subcontractor_payment_modal.s19', "جاري الصرف والتسجيل...") : t('contracting.record_subcontractor_payment_modal.s20', "تأكيد تسجيل سند الصرف")}
          isSubmitting={isSubmitting}
        />
      </form>
    </StandardDialog>
  );
}
