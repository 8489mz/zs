import { useTranslation } from 'react-i18next';
import { useState, useEffect, type FC, type FormEvent } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { productsApi } from '@/shared/api/products.api';
import {
  qualityAssuranceApi,
  type QCPointRecord,
  type RecordInspectionPayload,
} from '../../api/quality-assurance.api';

interface RecordInspectionModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  qcPoints: QCPointRecord[];
}

export const RecordInspectionModal: FC<RecordInspectionModalProps> = ({
  open,
  onClose,
  onSuccess,
  qcPoints,
}) => {
  const { t } = useTranslation();
  const [pointId, setPointId] = useState<string>('');
  const [referenceDocType, setReferenceDocType] = useState<'goods_receipt' | 'work_order' | 'delivery' | 'adhoc'>('goods_receipt');
  const [referenceDocId, setReferenceDocId] = useState('');
  const [productId, setProductId] = useState<string>('');
  const [inspectedQty, setInspectedQty] = useState('1');
  const [acceptedQty, setAcceptedQty] = useState('1');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [measuredValue, setMeasuredValue] = useState('');
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState('');
  const [autoCreateNcrOnFail, setAutoCreateNcrOnFail] = useState(true);
  const [products, setProducts] = useState<Array<{ id: number; name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      productsApi.listAll().then((res) => {
        const prods = (res as any)?.products || res || [];
        setProducts(prods);
        if (prods.length > 0 && !productId) {
          setProductId(String(prods[0].id));
        }
      }).catch((err) => console.error('Failed to load products', err));
    }
  }, [open]);

  // When point changes, adapt defaults
  const selectedPoint = qcPoints.find((p) => p.id === pointId);

  const qcPointOptions = [
    { value: '', label: 'فحص حر ومباشر (بدون نقطة مقيدة مسبقاً)' },
    ...qcPoints.map((p) => ({
      value: p.id,
      label: `${p.name} (${p.trigger_stage})`,
    })),
  ];

  const docTypeOptions = [
    { value: 'goods_receipt', label: 'إذن استلام مشتريات (Goods Receipt PO)' },
    { value: 'work_order', label: 'أمر إنتاج وتشغيل (Work Order WO)' },
    { value: 'delivery', label: 'إذن تسليم مبيعات (Delivery Note)' },
    { value: 'adhoc', label: 'فحص دوري / استثنائي (Ad-hoc)' },
  ];

  const productOptions = products.map((p) => ({
    value: String(p.id),
    label: p.name,
  }));

  const handleInspectedQtyChange = (val: string) => {
    setInspectedQty(val);
    const num = Number(val) || 0;
    const rej = Number(rejectedQty) || 0;
    setAcceptedQty(String(Math.max(0, num - rej)));
  };

  const handleRejectedQtyChange = (val: string) => {
    setRejectedQty(val);
    const rej = Number(val) || 0;
    const insp = Number(inspectedQty) || 0;
    setAcceptedQty(String(Math.max(0, insp - rej)));
    if (rej > 0) setPassed(false);
    else setPassed(true);
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!productId) {
      toast.warning('يرجى اختيار الصنف المفحوص');
      return;
    }
    if (!referenceDocId.trim()) {
      toast.warning('يرجى إدخال رقم المستند المرجعي');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: RecordInspectionPayload = {
        pointId: pointId || undefined,
        referenceDocType,
        referenceDocId: referenceDocId.trim(),
        productId: Number(productId),
        inspectedQty: Number(inspectedQty),
        acceptedQty: Number(acceptedQty),
        rejectedQty: Number(rejectedQty),
        measuredValue: measuredValue !== '' ? Number(measuredValue) : undefined,
        passed,
        notes: notes.trim() || undefined,
        autoCreateNcrOnFail,
      };

      const res = await qualityAssuranceApi.recordInspection(payload);
      if (res.status === 'passed') {
        toast.success('تم اجتياز فحص الجودة بنجاح (Passed)');
      } else {
        toast.warning(
          `فحص الجودة: ${res.status === 'conditional' ? 'قبول مشروط' : 'غير مطابق ومرفوض'}${
            res.autoNcrNumber ? ` - تم فتح تقرير عدم مطابقة رقم: ${res.autoNcrNumber}` : ''
          }`,
        );
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل فحص الجودة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('inventory.quality.record_inspection_modal.s0', "تسجيل فحص ومعاينة جودة (Record Quality Inspection)")}
      subtitle={t('inventory.quality.record_inspection_modal.s1', "إثبات نتائج فحص العينات، الكميات المقبولة والمرفوضة، وتوثيق عدم المطابقة")}
      size="lg"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s2', "معيار / نقطة فحص الجودة")}
            </label>
            <CustomSelect
              value={pointId}
              onChange={setPointId}
              options={qcPointOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s3', "نوع المستند المرجعي *")}
            </label>
            <CustomSelect
              value={referenceDocType}
              onChange={(val) => setReferenceDocType(val as any)}
              options={docTypeOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s4', "رقم المستند / أمر الشغل *")}
            </label>
            <input
              type="text"
              required
              value={referenceDocId}
              onChange={(e) => setReferenceDocId(e.target.value)}
              placeholder={t('inventory.quality.record_inspection_modal.s5', "مثال: PO-260930-0001 أو WO-...")}
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s6', "الصنف الخاضع للفحص *")}
            </label>
            <CustomSelect
              value={productId}
              onChange={setProductId}
              options={productOptions}
              placeholder={t('inventory.quality.record_inspection_modal.s7', "اختر الصنف...")}
            />
          </div>
        </div>

        {/* Quantities Row */}
        <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s8', "إجمالي الكمية المفحوصة")}
            </label>
            <input
              type="number"
              min="0.01"
              step="1"
              required
              value={inspectedQty}
              onChange={(e) => handleInspectedQtyChange(e.target.value)}
              style={{ width: '100%', height: '34px', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12.5px', fontWeight: 600, color: '#166534' }}>
              {t('inventory.quality.record_inspection_modal.s9', "الكمية السليمة المقبولة")}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={acceptedQty}
              onChange={(e) => setAcceptedQty(e.target.value)}
              style={{ width: '100%', height: '34px', padding: '6px', borderRadius: '6px', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', fontWeight: 700 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12.5px', fontWeight: 600, color: '#991b1b' }}>
              {t('inventory.quality.record_inspection_modal.s10', "الكمية المعيبة المرفوضة")}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={rejectedQty}
              onChange={(e) => handleRejectedQtyChange(e.target.value)}
              style={{ width: '100%', height: '34px', padding: '6px', borderRadius: '6px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', fontWeight: 700 }}
            />
          </div>
        </div>

        {/* Measure or Pass/Fail Controls */}
        {selectedPoint?.test_type === 'measure' ? (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.quality.record_inspection_modal.s11', "القيمة المقاسة فعلياً (")}{selectedPoint.measure_unit || t('inventory.quality.record_inspection_modal.s12', "وحدة القياس")}{t('inventory.quality.record_inspection_modal.s13', ") [الحدود:")} {selectedPoint.norm_measure_min ?? '—'} {t('inventory.quality.record_inspection_modal.s14', "إلى")} {selectedPoint.norm_measure_max ?? '—'}] *
            </label>
            <input
              type="number"
              step="0.001"
              required
              value={measuredValue}
              onChange={(e) => setMeasuredValue(e.target.value)}
              placeholder={t('inventory.quality.record_inspection_modal.s15', "أدخل القيمة المقاسة...")}
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="qcPassed"
              checked={passed}
              onChange={(e) => setPassed(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <label htmlFor="qcPassed" style={{ fontSize: '13px', fontWeight: 700, color: passed ? '#15803d' : '#b91c1c', cursor: 'pointer' }}>
              {passed ? t('inventory.quality.record_inspection_modal.s16', "العينة مطابقة للمواصفات الفنية والبصرية (Pass)") : t('inventory.quality.record_inspection_modal.s17', "العينة غير مطابقة للمواصفات الفنية (Fail)")}
            </label>
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.quality.record_inspection_modal.s18', "ملاحظات الفحص والعيوب المرصودة")}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t('inventory.quality.record_inspection_modal.s19', "وصف المشكلة، أسباب الرفض الجزئي أو الكلي...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="autoNCR"
            checked={autoCreateNcrOnFail}
            onChange={(e) => setAutoCreateNcrOnFail(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="autoNCR" style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
            {t('inventory.quality.record_inspection_modal.s20', "فتح تقرير عدم مطابقة (NCR) تلقائياً في حال وجود كميات مرفوضة")}
          </label>
        </div>

        <StandardDialogFooter
          onClose={onClose}
          primaryButton={{
            label: isSubmitting ? t('inventory.quality.record_inspection_modal.s21', "جاري التقييم والتسجيل...") : t('inventory.quality.record_inspection_modal.s22', "اعتماد وتسجيل الفحص"),
            disabled: isSubmitting,
            onClick: () => handleSubmit(),
          }}
        />
      </form>
    </StandardDialog>
  );
};
