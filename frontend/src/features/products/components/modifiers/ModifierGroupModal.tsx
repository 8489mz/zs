import { useTranslation } from 'react-i18next';
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { productsApi } from '@/features/products/api/products.api';
import type { ModifierGroup, ModifierOption } from '@/shared/api/addons.api';

interface ModifierGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingGroup: ModifierGroup | null;
  formName: string;
  setFormName: (v: string) => void;
  formNameEn: string;
  setFormNameEn: (v: string) => void;
  formSelectionType: 'single' | 'multiple';
  setFormSelectionType: (v: 'single' | 'multiple') => void;
  formIsMandatory: boolean;
  setFormIsMandatory: (v: boolean) => void;
  formMinSelections: number;
  setFormMinSelections: (v: number) => void;
  formMaxSelections: number;
  setFormMaxSelections: (v: number) => void;
  formDisplayOrder: number;
  setFormDisplayOrder: (v: number) => void;
  formIsActive: boolean;
  setFormIsActive: (v: boolean) => void;
  formIsSplittableInHalf: boolean;
  setFormIsSplittableInHalf: (v: boolean) => void;
  formOptions: ModifierOption[];
  onAddOptionRow: () => void;
  onRemoveOptionRow: (index: number) => void;
  onOptionChange: (index: number, field: keyof ModifierOption, value: any) => void;
  saving: boolean;
  modalFeedback: { text: string; error?: boolean } | null;
  onSave: () => void;
}

const SELECTION_TYPE_OPTIONS = [
  { value: 'single', label: 'اختيار أحادي (Radio - خيار واحد فقط)' },
  { value: 'multiple', label: 'اختيار متعدد (Checkbox - أكثر من خيار)' },
];

export const ModifierGroupModal: React.FC<ModifierGroupModalProps> = ({
  isOpen,
  onClose,
  editingGroup,
  formName,
  setFormName,
  formNameEn,
  setFormNameEn,
  formSelectionType,
  setFormSelectionType,
  formIsMandatory,
  setFormIsMandatory,
  formMinSelections,
  setFormMinSelections,
  formMaxSelections,
  setFormMaxSelections,
  formDisplayOrder,
  setFormDisplayOrder,
  formIsActive,
  setFormIsActive,
  formIsSplittableInHalf,
  setFormIsSplittableInHalf,
  formOptions,
  onAddOptionRow,
  onRemoveOptionRow,
  onOptionChange,
  saving,
  modalFeedback,
  onSave,
}) => {
  const { t } = useTranslation();
  const { data: rawProducts = [] } = useQuery({
    queryKey: ['products-for-modifiers'],
    queryFn: () => productsApi.list(),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const productOptions = useMemo(() => [
    { value: '', label: '— بدون خصم مخزني مباشر —' },
    ...rawProducts.map((p) => ({
      value: String(p.id),
      label: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
    })),
  ], [rawProducts]);

  return (
    <StandardDialog
      open={isOpen}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={editingGroup ? t('products.modifiers.modifier_group_modal.s0', "تعديل مجموعة الإضافات والخيارات") : t('products.modifiers.modifier_group_modal.s1', "إضافة مجموعة خيارات جديدة")}
      subtitle={t('products.modifiers.modifier_group_modal.s2', "تحديد نوع الاختيار، قواعد الإلزام، وربط الخيارات بالمواد الخام للاستنزاف التلقائي للمخزون")}
      maxWidth="780px"
      footerActions={
        <StandardDialogFooter
          cancelText={t('products.modifiers.modifier_group_modal.s3', "إلغاء")}
          onCancel={onClose}
          submitText={editingGroup ? t('products.modifiers.modifier_group_modal.s4', "حفظ التعديلات") : t('products.modifiers.modifier_group_modal.s5', "حفظ المجموعة والخيارات")}
          onSubmit={onSave}
          isSubmitting={saving}
          submitDisabled={saving || !formName.trim()}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        {modalFeedback && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              backgroundColor: modalFeedback.error ? '#fef2f2' : '#f0fdf4',
              color: modalFeedback.error ? '#991b1b' : '#166534',
              border: `1px solid ${modalFeedback.error ? '#fecaca' : '#bbf7d0'}`,
            }}
          >
            {modalFeedback.text}
          </div>
        )}

        {/* 1. بيانات المجموعة وقواعد الاختيار */}
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Layers size={15} />
            <span>{t('products.modifiers.modifier_group_modal.s6', "1. بيانات المجموعة والقواعد (Group Rules & Details)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <Field label={t('products.modifiers.modifier_group_modal.s7', "اسم المجموعة بالعربية *")}>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('products.modifiers.modifier_group_modal.s8', "مثال: درجة الطهي، الصوصات، إضافات إكسترا...")}
              />
            </Field>

            <Field label={t('products.modifiers.modifier_group_modal.s9', "الاسم بالإنجليزية (اختياري)")}>
              <input
                type="text"
                value={formNameEn}
                onChange={(e) => setFormNameEn(e.target.value)}
                placeholder="e.g. Cooking Level, Sauces..."
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px', alignItems: 'flex-end' }}>
            <Field label={t('products.modifiers.modifier_group_modal.s10', "نوع الاختيار *")}>
              <CustomSelect
                value={formSelectionType}
                options={SELECTION_TYPE_OPTIONS}
                onChange={(val) => setFormSelectionType(val as 'single' | 'multiple')}
              />
            </Field>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '8px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
                <input
                  type="checkbox"
                  checked={formIsMandatory}
                  onChange={(e) => setFormIsMandatory(e.target.checked)}
                />
                <span>{t('products.modifiers.modifier_group_modal.s11', "اختيار إلزامي قبل إضافة الصنف للسلة")}</span>
              </label>
            </div>
          </div>

          {/* R4-C I49: min/max, display order, active and splittable were
              state on the page but had no inputs here, so they round-
              tripped invisibly — and editing a name silently reset
              display_order to 0, reactivated the group and cleared
              splittable on the backend. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}>
            <Field label={t('products.modifiers.modifier_group_modal.s24', "الحد الأدنى للاختيار")}>
              <input
                type="number"
                min="0"
                step="1"
                value={formMinSelections}
                onChange={(e) => setFormMinSelections(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </Field>
            <Field label={t('products.modifiers.modifier_group_modal.s25', "الحد الأقصى للاختيار")}>
              <input
                type="number"
                min="1"
                step="1"
                value={formMaxSelections}
                onChange={(e) => setFormMaxSelections(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </Field>
            <Field label={t('products.modifiers.modifier_group_modal.s26', "ترتيب العرض")}>
              <input
                type="number"
                step="1"
                value={formDisplayOrder}
                onChange={(e) => setFormDisplayOrder(parseInt(e.target.value, 10) || 0)}
              />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '10px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
              <input
                type="checkbox"
                checked={formIsActive}
                onChange={(e) => setFormIsActive(e.target.checked)}
              />
              <span>{t('products.modifiers.modifier_group_modal.s27', "المجموعة مفعّلة")}</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: '#334155' }}>
              <input
                type="checkbox"
                checked={formIsSplittableInHalf}
                onChange={(e) => setFormIsSplittableInHalf(e.target.checked)}
              />
              <span>{t('products.modifiers.modifier_group_modal.s28', "قابلة للقسمة نصفين")}</span>
            </label>
          </div>
        </div>

        {/* 2. قائمة الخيارات والإضافات وربط المكونات */}
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Package size={15} />
                <span>{t('products.modifiers.modifier_group_modal.s12', "2. قائمة الخيارات والإضافات وربط استهلاك المواد الخام")}</span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>
                {t('products.modifiers.modifier_group_modal.s13', "يمكنك ربط كل إضافة بمادة خام من المخزن لتُخصم كميتها تلقائياً وتُحسب تكلفتها عند اختيار العميل لها")}
              </p>
            </div>
            <button
              type="button"
              onClick={onAddOptionRow}
              style={{
                padding: '4px 12px',
                borderRadius: '6px',
                border: '1px solid #170e5e',
                backgroundColor: '#ffffff',
                color: '#170e5e',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('products.modifiers.modifier_group_modal.s14', "+ إضافة خيار")}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '280px', overflowY: 'auto' }}>
            {formOptions.map((opt, idx) => (
              <div
                key={idx}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {/* السطر الأول: الاسم والسعر والتكلفة وحالة الافتراضي والحذف */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr auto auto', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={opt.name}
                    onChange={(e) => onOptionChange(idx, 'name', e.target.value)}
                    placeholder={t('products.modifiers.modifier_group_modal.s15', "اسم الخيار (مثل: شريحة جبنة شيدر)...")}
                    style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={opt.price}
                    onChange={(e) => onOptionChange(idx, 'price', parseFloat(e.target.value) || 0)}
                    placeholder={t('products.modifiers.modifier_group_modal.s16', "السعر الإضافي...")}
                    style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={opt.costPrice ?? 0}
                    onChange={(e) => onOptionChange(idx, 'costPrice', parseFloat(e.target.value) || 0)}
                    placeholder={t('products.modifiers.modifier_group_modal.s29', "التكلفة...")}
                    title={t('products.modifiers.modifier_group_modal.s30', "تكلفة الخيار (للعرض فقط — التكلفة الفعلية من مخزون المادة الخام)")}
                    style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                  />
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', color: '#64748b' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(opt.isDefault)}
                      onChange={(e) => onOptionChange(idx, 'isDefault', e.target.checked)}
                    />
                    <span>{t('products.modifiers.modifier_group_modal.s17', "افتراضي")}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onRemoveOptionRow(idx)}
                    disabled={formOptions.length <= 1}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#fef2f2',
                      color: '#dc2626',
                      cursor: formOptions.length > 1 ? 'pointer' : 'not-allowed',
                      opacity: formOptions.length > 1 ? 1 : 0.4,
                    }}
                    title={t('products.modifiers.modifier_group_modal.s18', "حذف الخيار")}
                  >
                    <AppIcons.Trash size={14} />
                  </button>
                </div>

                {/* السطر الثاني: استنزاف المخزون والمادة الخام */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', alignItems: 'center', backgroundColor: '#f8fafc', padding: '6px 8px', borderRadius: '6px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '2px' }}>
                      {t('products.modifiers.modifier_group_modal.s19', "المادة الخام المستنزفة (مخزون)")}
                    </label>
                    <CustomSelect
                      value={opt.componentProductId ? String(opt.componentProductId) : ''}
                      options={productOptions}
                      onChange={(val) => onOptionChange(idx, 'componentProductId', val ? Number(val) : null)}
                      placeholder={t('products.modifiers.modifier_group_modal.s20', "— بدون خصم مخزني —")}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '2px' }}>
                      {t('products.modifiers.modifier_group_modal.s21', "كمية الخصم")}
                    </label>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={opt.consumptionQty ?? ''}
                      onChange={(e) => onOptionChange(idx, 'consumptionQty', e.target.value === '' ? null : parseFloat(e.target.value) || 0)}
                      placeholder="1"
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '2px' }}>
                      {t('products.modifiers.modifier_group_modal.s22', "الوحدة")}
                    </label>
                    <input
                      type="text"
                      value={opt.unitName || ''}
                      onChange={(e) => onOptionChange(idx, 'unitName', e.target.value)}
                      placeholder={t('products.modifiers.modifier_group_modal.s23', "حبة / جرام / مل...")}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StandardDialog>
  );
};
