import { useTranslation } from 'react-i18next';
import { useState, useEffect, type FC, type FormEvent } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { productsApi } from '@/shared/api/products.api';
import { qualityAssuranceApi, type CreateNCRPayload } from '../../api/quality-assurance.api';

interface CreateNCRModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateNCRModal: FC<CreateNCRModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [productId, setProductId] = useState<string>('');
  const [defectDescription, setDefectDescription] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('major');
  const [rootCause, setRootCause] = useState('');
  const [dispositionAction, setDispositionAction] = useState<'quarantine_scrap' | 'return_to_vendor' | 'rework' | 'concession_accept'>('quarantine_scrap');
  const [products, setProducts] = useState<Array<{ id: number; name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      productsApi.listAll().then((res) => {
        setProducts((res as any)?.products || res || []);
      }).catch((err) => console.error('Failed to load products', err));
    }
  }, [open]);

  const productOptions = products.map((p) => ({
    value: String(p.id),
    label: p.name,
  }));

  const severityOptions = [
    { value: 'minor', label: 'بسيط / ثانوي (Minor Defect)' },
    { value: 'major', label: 'جوهري / هام (Major Defect)' },
    { value: 'critical', label: 'حرج / خطير (Critical Defect - إيقاف فوري)' },
  ];

  const actionOptions = [
    { value: 'quarantine_scrap', label: 'حجر صحي وإتلاف (Quarantine & Scrap)' },
    { value: 'return_to_vendor', label: 'إرجاع فوري للمورد (Return to Vendor)' },
    { value: 'rework', label: 'إعادة تشغيل وإصلاح داخلي (Internal Rework)' },
    { value: 'concession_accept', label: 'قبول مشروط باستثناء إداري (Concession Accept)' },
  ];

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!productId) {
      toast.warning('يرجى اختيار الصنف المعيب');
      return;
    }
    if (!defectDescription.trim()) {
      toast.warning('يرجى كتابة وصف العيب وعدم المطابقة');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreateNCRPayload = {
        productId: Number(productId),
        defectDescription: defectDescription.trim(),
        severity,
        rootCause: rootCause.trim() || undefined,
        dispositionAction,
      };

      const res = await qualityAssuranceApi.createNCR(payload);
      toast.success(`تم فتح تقرير عدم المطابقة رقم: ${res.ncrNumber}`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل فتح تقرير عدم المطابقة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('inventory.quality.create_n_c_r_modal.s0', "فتح تقرير عدم مطابقة (Create Non-Conformance Report - NCR)")}
      subtitle={t('inventory.quality.create_n_c_r_modal.s1', "توثيق العيوب الفنية، تحليل الأسباب الجذرية، وتحديد الإجراء التصحيحي")}
      size="md"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_n_c_r_modal.s2', "الصنف المعيب *")}
          </label>
          <CustomSelect
            value={productId}
            onChange={setProductId}
            options={productOptions}
            placeholder={t('inventory.quality.create_n_c_r_modal.s3', "اختر الصنف...")}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.create_n_c_r_modal.s4', "درجة خطورة العيب *")}
            </label>
            <CustomSelect
              value={severity}
              onChange={(val) => setSeverity(val as any)}
              options={severityOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.create_n_c_r_modal.s5', "الإجراء التصحيحي المقترح *")}
            </label>
            <CustomSelect
              value={dispositionAction}
              onChange={(val) => setDispositionAction(val as any)}
              options={actionOptions}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_n_c_r_modal.s6', "بيان ووصف العيب وعدم المطابقة *")}
          </label>
          <textarea
            required
            value={defectDescription}
            onChange={(e) => setDefectDescription(e.target.value)}
            rows={3}
            placeholder={t('inventory.quality.create_n_c_r_modal.s7', "شرح العيب المرصود، الأضرار، أو بنود المواصفة المخالفة...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_n_c_r_modal.s8', "تحليل السبب الجذري (Root Cause Analysis - RCA)")}
          </label>
          <textarea
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            rows={2}
            placeholder={t('inventory.quality.create_n_c_r_modal.s9', "سبب حدوث الخلل: سوء تخزين، عيب تصنيع من المورد، اهتزاز أثناء النقل...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <StandardDialogFooter
          onClose={onClose}
          primaryButton={{
            label: isSubmitting ? t('inventory.quality.create_n_c_r_modal.s10', "جاري الفتح والتوثيق...") : t('inventory.quality.create_n_c_r_modal.s11', "فتح وتعميم الـ NCR"),
            disabled: isSubmitting,
            onClick: () => handleSubmit(),
          }}
        />
      </form>
    </StandardDialog>
  );
};
