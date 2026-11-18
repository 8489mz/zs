import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import type { ContractingBoqItem } from '../contracting.types';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { todayLocalDateKey } from '@/lib/format';

interface CreateMaterialRequisitionModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  boqItems?: ContractingBoqItem[];
  onClose: () => void;
  onCreated?: () => void;
  onSuccess?: () => void;
}

const MATERIAL_UNIT_OPTIONS = [
  { value: 'طن', label: 'طن (Ton)' },
  { value: 'م3', label: 'متر مكعب (م³)' },
  { value: 'م2', label: 'متر مربع (م²)' },
  { value: 'م.ط', label: 'متر طولي (م.ط)' },
  { value: 'شكارة', label: 'شكارة / كيس' },
  { value: 'قطعة', label: 'قطعة / عدد' },
  { value: 'لتر', label: 'لتر / جالون' },
];

export function CreateMaterialRequisitionModal({
  open,
  projectId,
  projectName,
  boqItems = [],
  onClose,
  onCreated,
}: CreateMaterialRequisitionModalProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { currencySymbol, formatCurrency } = useSystemCurrency();

  const [formData, setFormData] = useState({
    requisitionNumber: '',
    boqItemId: '',
    itemName: '',
    unit: 'طن',
    quantity: '',
    unitCost: '',
    issueDate: todayLocalDateKey(),
    recipientName: '',
    notes: '',
  });

  const boqItemOptions = useMemo(() => {
    const list = [{ value: '', label: '-- تحميل عام على مركز تكلفة المشروع --' }];
    boqItems.forEach((b) => {
      list.push({
        value: String(b.id),
        label: `${b.itemCode} - ${b.description.substring(0, 32)}`,
      });
    });
    return list;
  }, [boqItems]);

  const qty = Number(formData.quantity || 0);
  const unitCost = Number(formData.unitCost || 0);
  const totalCost = qty * unitCost;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.itemName.trim()) {
      setErrorMsg('يرجى كتابة اسم وتوصيف المادة أو الخامة المصروفة');
      return;
    }
    if (qty <= 0 || unitCost < 0) {
      setErrorMsg('يرجى إدخال كمية وسعر تكلفة صحيحين');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await contractingApi.createMaterialRequisition(projectId, {
        requisitionNumber: formData.requisitionNumber.trim() || undefined,
        boqItemId: formData.boqItemId || undefined,
        itemName: formData.itemName.trim(),
        unit: formData.unit,
        quantity: qty,
        unitCost: unitCost,
        issueDate: formData.issueDate,
        recipientName: formData.recipientName.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء تسجيل إذن صرف المواد');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('contracting.create_material_requisition_modal.s0', "إذن صرف وتخصيص مواد وخامات للموقع (Material Requisition)")}
      subtitle={projectName ? `المشروع: ${projectName}` : t('contracting.create_material_requisition_modal.s1', "صرف خامات للمشروع وتحميل قيمتها مباشرة على بنود المقايسة ومراكز التكلفة")}
      width="min(920px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={() => handleSubmit()}
          submitText={t('contracting.create_material_requisition_modal.s2', "توثيق إذن صرف المواد")}
          isSubmitting={isSubmitting}
        />
      )}
    >
      <style>{`
        .mr-compact-modal .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .mr-compact-modal .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .mr-compact-modal input,
        .mr-compact-modal textarea {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
          transition: border-color 0.15s, box-shadow 0.15s !important;
        }
        .mr-compact-modal input:focus,
        .mr-compact-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
        .mr-compact-modal .custom-select-trigger {
          min-height: 33px !important;
          height: 33px !important;
          font-size: 0.8125rem !important;
          padding: 0 10px !important;
          border-radius: 6px !important;
          border: 1px solid #cbd5e1 !important;
        }
      `}</style>

      <form onSubmit={handleSubmit} className="mr-compact-modal" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }} dir="rtl">
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 1. بيانات إذن الصرف وبند المقايسة */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Layers size={15} />
            <span>{t('contracting.create_material_requisition_modal.s3', "1. بيانات إذن الصرف وبند المقايسة (Requisition & BOQ Allocation)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '10px', alignItems: 'start' }}>
            <Field label={t('contracting.create_material_requisition_modal.s4', "رقم إذن الصرف")}>
              <input
                type="text"
                value={formData.requisitionNumber}
                onChange={(e) => setFormData({ ...formData, requisitionNumber: e.target.value })}
                placeholder={t('contracting.create_material_requisition_modal.s5', "تلقائي: MR-260914-0001")}
                style={{ fontFamily: 'monospace', fontWeight: 600 }}
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s6', "تاريخ الصرف *")}>
              <input
                type="date"
                value={formData.issueDate}
                onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                required
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s7', "تحميل على بند المقايسة (BOQ)")}>
              <CustomSelect
                value={formData.boqItemId}
                options={boqItemOptions}
                onChange={(val) => setFormData({ ...formData, boqItemId: val })}
              />
            </Field>
          </div>
        </div>

        {/* 2. مواصفات الخامة والكميات والتكلفة */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Calculator size={15} />
            <span>{t('contracting.create_material_requisition_modal.s8', "2. مواصفات الخامة والكميات والتكلفة (Material & Cost Specs)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.2fr', gap: '10px', alignItems: 'start' }}>
            <Field label={t('contracting.create_material_requisition_modal.s9', "بيان واسم المادة / الخامة *")}>
              <input
                type="text"
                value={formData.itemName}
                onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                placeholder={t('contracting.create_material_requisition_modal.s10', "مثال: حديد تسليح مشرشر 16 مم - عز الدخيلة")}
                required
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s11', "الوحدة")}>
              <CustomSelect
                value={formData.unit}
                options={MATERIAL_UNIT_OPTIONS}
                onChange={(val) => setFormData({ ...formData, unit: val })}
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s12', "الكمية المصروفة *")}>
              <input
                type="number"
                step="any"
                min="0.001"
                dir="ltr"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                placeholder="0.00"
                style={{ fontWeight: 700, color: '#0f172a' }}
                required
              />
            </Field>

            <Field label={`تكلفة الوحدة (${currencySymbol}) *`}>
              <input
                type="number"
                step="any"
                min="0"
                dir="ltr"
                value={formData.unitCost}
                onChange={(e) => setFormData({ ...formData, unitCost: e.target.value })}
                placeholder="0.00"
                style={{ fontWeight: 700, color: '#170e5e' }}
                required
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s13', "إجمالي تكلفة الصرف")}>
              <div
                style={{
                  height: '33px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontWeight: 800,
                  color: '#170e5e',
                  fontSize: '0.84rem',
                  boxSizing: 'border-box',
                }}
              >
                {formatCurrency(totalCost)}
              </div>
            </Field>
          </div>
        </div>

        {/* 3. جهة الاستلام والتوثيق المخزني */}
        <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Tag size={14} />
            <span>{t('contracting.create_material_requisition_modal.s14', "3. جهة الاستلام والتوثيق المخزني (Recipient & Warehouse Notes)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '10px', alignItems: 'start' }}>
            <Field label={t('contracting.create_material_requisition_modal.s15', "المستلم بالموقع")}>
              <input
                type="text"
                value={formData.recipientName}
                onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
                placeholder={t('contracting.create_material_requisition_modal.s16', "اسم المهندس / المشرف المستلم...")}
              />
            </Field>

            <Field label={t('contracting.create_material_requisition_modal.s17', "إذن المخزن الورقي / ملاحظات (اختياري)")}>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t('contracting.create_material_requisition_modal.s18', "مثال: مستودع العاشر، إذن تسليم W-449...")}
              />
            </Field>
          </div>
        </div>
      </form>
    </StandardDialog>
  );
}
