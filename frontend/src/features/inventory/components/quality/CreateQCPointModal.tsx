import { useTranslation } from 'react-i18next';
import { useState, useEffect, type FC, type FormEvent } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { productsApi } from '@/shared/api/products.api';
import { qualityAssuranceApi, type CreateQCPointPayload } from '../../api/quality-assurance.api';

interface CreateQCPointModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateQCPointModal: FC<CreateQCPointModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [productId, setProductId] = useState<string>('');
  const [triggerStage, setTriggerStage] = useState<'receipt' | 'manufacturing' | 'delivery' | 'internal'>('receipt');
  const [testType, setTestType] = useState<'pass_fail' | 'measure' | 'checklist'>('pass_fail');
  const [normMeasureMin, setNormMeasureMin] = useState('');
  const [normMeasureMax, setNormMeasureMax] = useState('');
  const [measureUnit, setMeasureUnit] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isMandatory, setIsMandatory] = useState(true);
  const [products, setProducts] = useState<Array<{ id: number; name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      productsApi.listAll().then((res) => {
        setProducts((res as any)?.products || res || []);
      }).catch((err) => console.error('Failed to load products', err));
    }
  }, [open]);

  const productOptions = [
    { value: '', label: 'كافة الأصناف (فحص عام على كافة الواردات)' },
    ...products.map((p) => ({ value: String(p.id), label: p.name })),
  ];

  const stageOptions = [
    { value: 'receipt', label: 'عند استلام المشتريات (Goods Receipt)' },
    { value: 'manufacturing', label: 'عند انتهاء أمر التصنيع (Work Order Output)' },
    { value: 'delivery', label: 'قبل تسليم المبيعات للعميل (Pre-Delivery)' },
    { value: 'internal', label: 'فحص جردي داخلي دوري (Internal Audit)' },
  ];

  const testTypeOptions = [
    { value: 'pass_fail', label: 'مطابق / غير مطابق (Pass / Fail)' },
    { value: 'measure', label: 'قياس كمي وحدود تسامح (Quantitative Measurement)' },
    { value: 'checklist', label: 'قائمة مراجعة متطلبات (Checklist)' },
  ];

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!name.trim()) {
      toast.warning('يرجى إدخال اسم نقطة الفحص');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreateQCPointPayload = {
        name: name.trim(),
        productId: productId ? Number(productId) : undefined,
        triggerStage,
        testType,
        normMeasureMin: normMeasureMin !== '' ? Number(normMeasureMin) : undefined,
        normMeasureMax: normMeasureMax !== '' ? Number(normMeasureMax) : undefined,
        measureUnit: measureUnit.trim() || undefined,
        instructions: instructions.trim() || undefined,
        isMandatory,
      };

      await qualityAssuranceApi.createPoint(payload);
      toast.success('تم إنشاء نقطة ومعيار مراقبة الجودة بنجاح');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء نقطة الفحص');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('inventory.quality.create_q_c_point_modal.s0', "إنشاء نقطة فحص جودة ومعايير امتثال (Quality Control Point)")}
      subtitle={t('inventory.quality.create_q_c_point_modal.s1', "تحديد متطلبات الفحص الإلزامي، حدود التسامح، والمرحلة التشغيلية المفعلة لها")}
      size="md"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_q_c_point_modal.s2', "اسم نقطة ومعيار الفحص *")}
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('inventory.quality.create_q_c_point_modal.s3', "مثال: فحص سلامة التغليف الخارجي أو قياس أبعاد القطر")}
            style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.create_q_c_point_modal.s4', "المرحلة التشغيلية *")}
            </label>
            <CustomSelect
              value={triggerStage}
              onChange={(val) => setTriggerStage(val as any)}
              options={stageOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.create_q_c_point_modal.s5', "نوع الاختبار *")}
            </label>
            <CustomSelect
              value={testType}
              onChange={(val) => setTestType(val as any)}
              options={testTypeOptions}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_q_c_point_modal.s6', "الصنف المستهدف (اختياري)")}
          </label>
          <CustomSelect
            value={productId}
            onChange={setProductId}
            options={productOptions}
            placeholder={t('inventory.quality.create_q_c_point_modal.s7', "اختر صنفاً مخصصاً أو اتركه عاماً...")}
          />
        </div>

        {testType === 'measure' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                {t('inventory.quality.create_q_c_point_modal.s8', "الحد الأدنى المسموح")}
              </label>
              <input
                type="number"
                step="0.001"
                value={normMeasureMin}
                onChange={(e) => setNormMeasureMin(e.target.value)}
                placeholder="Min"
                style={{ width: '100%', height: '32px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                {t('inventory.quality.create_q_c_point_modal.s9', "الحد الأقصى المسموح")}
              </label>
              <input
                type="number"
                step="0.001"
                value={normMeasureMax}
                onChange={(e) => setNormMeasureMax(e.target.value)}
                placeholder="Max"
                style={{ width: '100%', height: '32px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                {t('inventory.quality.create_q_c_point_modal.s10', "وحدة القياس")}
              </label>
              <input
                type="text"
                value={measureUnit}
                onChange={(e) => setMeasureUnit(e.target.value)}
                placeholder={t('inventory.quality.create_q_c_point_modal.s11', "مم / كجم / فولت...")}
                style={{ width: '100%', height: '32px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.create_q_c_point_modal.s12', "تعليمات الفحص للمفتش")}
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder={t('inventory.quality.create_q_c_point_modal.s13', "خطوات المعاينة، أجهزة الفحص المستخدمة، وطرق سحب العينات...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="isMandatory"
            checked={isMandatory}
            onChange={(e) => setIsMandatory(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="isMandatory" style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
            {t('inventory.quality.create_q_c_point_modal.s14', "فحص إلزامي وحاكم قبل اعتماد الحركة المخزنية (Mandatory Gate)")}
          </label>
        </div>

        <StandardDialogFooter
          onClose={onClose}
          primaryButton={{
            label: isSubmitting ? t('inventory.quality.create_q_c_point_modal.s15', "جاري الحفظ...") : t('inventory.quality.create_q_c_point_modal.s16', "حفظ نقطة الفحص"),
            disabled: isSubmitting,
            onClick: () => handleSubmit(),
          }}
        />
      </form>
    </StandardDialog>
  );
};
