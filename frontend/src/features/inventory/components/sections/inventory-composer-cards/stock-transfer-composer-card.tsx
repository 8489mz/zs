import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { InventoryProductPicker } from '@/features/inventory/components/InventoryProductPicker';
import type { Location, Product, StockTransferItem } from '@/types/domain';

export interface StockTransferComposerCardProps {
  products: Product[];
  warehouses?: Location[];
  locations?: Location[];
  form: { fromLocationId: string; toLocationId: string; note: string; recipientName: string; productId: string; qty: string; serials: string; batchAllocations: string };
  items: StockTransferItem[];
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  onFormChange: (patch: Partial<{ fromLocationId: string; toLocationId: string; note: string; recipientName: string; productId: string; qty: string; serials: string; batchAllocations: string }>) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onSubmit: () => void;
}

export function StockTransferComposerCard({
  products,
  warehouses,
  locations,
  form,
  items,
  isPending,
  isError,
  isSuccess,
  error,
  onFormChange,
  onAddItem,
  onRemoveItem,
  onSubmit
}: StockTransferComposerCardProps) {
  const { t } = useTranslation();
  const warehouseList = warehouses || locations || [];
  const warehouseOptions = useMemo(
    () => [
      { value: '', label: 'اختر المخزن' },
      ...warehouseList.map((location) => ({ value: String(location.id), label: location.name })),
    ],
    [warehouseList],
  );

  return (
    <FormSection title={t('inventory.sections.inventory_composer_cards.s0', "إذن صرف / نقل مخزون")} description={t('inventory.sections.inventory_composer_cards.s1', "تجميع الأصناف أولًا ثم اعتماد إذن الصرف مع إبقاء المراجعة السريعة للعناصر قبل الإرسال.")} actions={<span className="nav-pill">{t('inventory.sections.inventory_composer_cards.s2', "أذونات الصرف")}</span>}>
      <div className="form-grid">
        <Field label={t('inventory.sections.inventory_composer_cards.s3', "من مخزن")}>
          <CustomSelect
            value={form.fromLocationId}
            onChange={(val) => onFormChange({ fromLocationId: val })}
            options={warehouseOptions}
            placeholder={t('inventory.sections.inventory_composer_cards.s4', "اختر المصدر")}
          />
        </Field>
        <Field label={t('inventory.sections.inventory_composer_cards.s5', "إلى مخزن / فرع")}>
          <CustomSelect
            value={form.toLocationId}
            onChange={(val) => onFormChange({ toLocationId: val })}
            options={warehouseOptions}
            placeholder={t('inventory.sections.inventory_composer_cards.s6', "اختر الوجهة")}
          />
        </Field>
        <Field label={t('inventory.sections.inventory_composer_cards.s7', "مستلم البضاعة / السائق")}>
          <input type="text" placeholder={t('inventory.sections.inventory_composer_cards.s8', "اسم المستلم (اختياري)")} value={form.recipientName || ''} onChange={(e) => onFormChange({ recipientName: e.target.value })} />
        </Field>
        <Field label={t('inventory.sections.inventory_composer_cards.s9', "الصنف")}>
          <InventoryProductPicker
            products={products}
            value={form.productId}
            onChange={(productId) => onFormChange({ productId })}
            showStock
            showPrice={false}
          />
        </Field>
        <Field label={t('inventory.sections.inventory_composer_cards.s10', "الكمية")}>
          <input type="number" min="0.001" step="0.001" value={form.qty} onChange={(e) => onFormChange({ qty: e.target.value })} />
        </Field>
        <Field label="سيريالات القطع المنقولة (رقم لكل سطر)">
          <textarea rows={2} value={form.serials || ''} placeholder="IMEI / Serial" onChange={(e) => onFormChange({ serials: e.target.value })} />
        </Field>
        <Field label="توزيع التشغيلات (رقم التشغيلة في النظام:الكمية لكل سطر)">
          <textarea rows={2} value={form.batchAllocations || ''} placeholder="123:2\n124:3" onChange={(e) => onFormChange({ batchAllocations: e.target.value })} />
        </Field>
        <Field label={t('inventory.sections.inventory_composer_cards.s11', "ملاحظات")}>
          <textarea rows={3} value={form.note} onChange={(e) => onFormChange({ note: e.target.value })} />
        </Field>
        <div className="field">
          <span>{t('inventory.sections.inventory_composer_cards.s12', "العناصر")}</span>
          <div className="actions compact-actions">
            <Button type="button" variant="secondary" onClick={onAddItem}>{t('inventory.sections.inventory_composer_cards.s13', "إضافة إلى إذن الصرف")}</Button>
            <SubmitButton type="button" onClick={onSubmit} isPending={isPending} disabled={!items.length} idleText={t('inventory.sections.inventory_composer_cards.s14', "حفظ إذن الصرف")} pendingText={t('inventory.sections.inventory_composer_cards.s15', "جارٍ الحفظ...")} />
          </div>
        </div>
      </div>
      <MutationFeedback isError={isError} isSuccess={isSuccess} error={error} errorFallback={t('inventory.sections.inventory_composer_cards.s16', "تعذر إنشاء إذن الصرف")} successText={t('inventory.sections.inventory_composer_cards.s17', "تم إنشاء إذن الصرف بنجاح.")} />
      <div className="list-stack" style={{ marginTop: 12 }}>
        {items.length ? items.map((item, index) => (
          <div className="list-row stacked-row" key={item.id}>
            <div>
              <strong>{item.productName}</strong>
              <div className="muted small">{t('inventory.sections.inventory_composer_cards.s18', "الكمية:")} {item.qty}{item.serials?.length ? ` — ${item.serials.length} سيريال` : ''}{item.batchAllocations?.length ? ` — ${item.batchAllocations.length} تشغيلة` : ''}</div>
            </div>
            <Button type="button" variant="danger" onClick={() => onRemoveItem(index)}>{t('inventory.sections.inventory_composer_cards.s19', "حذف")}</Button>
          </div>
        )) : <EmptyState title={t('inventory.sections.inventory_composer_cards.s20', "لا توجد عناصر مضافة لإذن الصرف")} hint={t('inventory.sections.inventory_composer_cards.s21', "أضف صنفًا واحدًا على الأقل ثم احفظ.")} />}
      </div>
    </FormSection>
  );
}
