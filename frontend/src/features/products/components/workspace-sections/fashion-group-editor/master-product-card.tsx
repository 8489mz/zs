import { useTranslation } from 'react-i18next';
import { type Dispatch, type SetStateAction } from 'react';
import { normalizeArabicInput } from '@/lib/arabic-normalization';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { type CommonDraft, type VariantDraft } from '@/features/products/components/workspace-sections/FashionGroupEditorCard.helpers';
import type { Category, Supplier, Location } from '@/types/domain';

export function MasterProductCard({ variantRows, commonDraft, setCommonDraft, mutation, setBarcodePrefix, handleGenerateStyleCode, setVariantRows, categories, suppliers, locations }: { variantRows: VariantDraft[]; commonDraft: CommonDraft; setCommonDraft: Dispatch<SetStateAction<CommonDraft>>; mutation: { isPending: boolean }; setBarcodePrefix: Dispatch<SetStateAction<string>>; handleGenerateStyleCode: () => void | Promise<void>; setVariantRows: Dispatch<SetStateAction<VariantDraft[]>>; categories: Category[]; suppliers: Supplier[]; locations: Location[] }) {
  const { t } = useTranslation();
  return (
    <div className="product-compact-card">
      <div className="product-compact-card-header">
        <h3 className="product-compact-card-title">{t('products.workspace_sections.fashion_group_editor_card.s0', "بيانات الصنف والأسعار الأساسية للمجموعة")}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="cashier-chip" style={{ fontWeight: 700, background: '#dbeafe', color: '#1e40af' }}>
            {variantRows.length} {t('products.workspace_sections.fashion_group_editor_card.s1', "صنف فرعي")}
          </span>
          {commonDraft.styleCode ? (
            <span className="cashier-chip" style={{ fontWeight: 600, background: '#f1f5f9', color: '#334155' }}>
              {t('products.workspace_sections.fashion_group_editor_card.s2', "كود الموديل:")} {commonDraft.styleCode}
            </span>
          ) : null}
        </div>
      </div>

      <div className="page-stack" style={{ gap: '0.75rem' }}>
        {/* Row 1: 6 Columns: Name, StyleCode, Cost, Retail, Wholesale, MinStock */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr)', gap: '0.65rem', alignItems: 'start' }}>
          <Field label={t('products.workspace_sections.fashion_group_editor_card.s3', "اسم الصنف الأساسي")}>
            <input
              className="purchase-prototype-field-input"
              style={{ fontWeight: 700, color: '#0f172a' }}
              value={commonDraft.name}
              onChange={(event) => setCommonDraft((current) => ({ ...current, name: normalizeArabicInput(event.target.value) }))}
              disabled={mutation.isPending}
              placeholder={t('products.workspace_sections.fashion_group_editor_card.s4', "مثال: قميص أكسفورد")}
            />
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s5', "كود الموديل / المجموعة")}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                className="purchase-prototype-field-input"
                style={{ fontWeight: 700 }}
                value={commonDraft.styleCode}
                onChange={(event) => {
                  const val = event.target.value;
                  setCommonDraft((current) => ({ ...current, styleCode: val }));
                  setBarcodePrefix(val);
                }}
                disabled={mutation.isPending}
                placeholder="106"
              />
              <Button type="button" variant="secondary" onClick={handleGenerateStyleCode} disabled={mutation.isPending} style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', padding: '0 8px' }}>
                {t('products.workspace_sections.fashion_group_editor_card.s6', "توليد")}
              </Button>
            </div>
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s7', "سعر الشراء")}>
            <input
              className="purchase-prototype-field-input"
              type="number"
              step="0.01"
              value={commonDraft.costPrice}
              onChange={(event) => setCommonDraft((current) => ({ ...current, costPrice: Number(event.target.value || 0) }))}
              disabled={mutation.isPending}
            />
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s8', "سعر البيع (قطاعي)")}>
            <input
              className="purchase-prototype-field-input"
              type="number"
              step="0.01"
              value={commonDraft.retailPrice}
              onChange={(event) => setCommonDraft((current) => ({ ...current, retailPrice: Number(event.target.value || 0) }))}
              disabled={mutation.isPending}
              style={{ fontWeight: 800, color: '#15803d' }}
            />
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s9', "سعر الجملة")}>
            <input
              className="purchase-prototype-field-input"
              type="number"
              step="0.01"
              value={commonDraft.wholesalePrice}
              onChange={(event) => setCommonDraft((current) => ({ ...current, wholesalePrice: Number(event.target.value || 0) }))}
              disabled={mutation.isPending}
              style={{ fontWeight: 700, color: '#b45309' }}
            />
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s10', "الحد الأدنى الافتراضي")}>
            <input
              className="purchase-prototype-field-input"
              type="number"
              value={commonDraft.minStock}
              onChange={(event) => setCommonDraft((current) => ({ ...current, minStock: Math.max(0, Number(event.target.value || 0)) }))}
              disabled={mutation.isPending}
            />
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => setVariantRows((current) => current.map((row) => ({ ...row, minStock: commonDraft.minStock })))}
              style={{
                marginTop: '4px',
                width: '100%',
                padding: '3px 4px',
                fontSize: '0.69rem',
                fontWeight: 600,
                color: '#1d4ed8',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '5px',
                cursor: mutation.isPending ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
                boxSizing: 'border-box',
              }}
              title={t('products.workspace_sections.fashion_group_editor_card.s10_apply_all_tip', 'تطبيق هذا الحد الأدنى على كافة المقاسات والأصناف الفرعية')}
            >
              {t('products.workspace_sections.fashion_group_editor_card.s10_apply_all', 'تطبيق على الكل')}
            </button>
          </Field>
        </div>

        {/* Row 2: 4 Columns: Category, Supplier, Location, Notes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 2fr)', gap: '0.65rem', alignItems: 'start' }}>
          <Field label={t('products.workspace_sections.fashion_group_editor_card.s11', "القسم")}>
            <select
              className="purchase-prototype-field-input"
              value={commonDraft.categoryId}
              onChange={(event) => setCommonDraft((current) => ({ ...current, categoryId: event.target.value }))}
              disabled={mutation.isPending}
            >
              <option value="">{t('products.workspace_sections.fashion_group_editor_card.s12', "بدون قسم")}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s13', "المورد")}>
            <select
              className="purchase-prototype-field-input"
              value={commonDraft.supplierId}
              onChange={(event) => setCommonDraft((current) => ({ ...current, supplierId: event.target.value }))}
              disabled={mutation.isPending}
            >
              <option value="">{t('products.workspace_sections.fashion_group_editor_card.s14', "بدون مورد")}</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s15', "المخزن الافتراضي")}>
            <select
              className="purchase-prototype-field-input"
              value={commonDraft.defaultLocationId || ''}
              onChange={(event) => setCommonDraft((current) => ({ ...current, defaultLocationId: event.target.value }))}
              disabled={mutation.isPending}
            >
              <option value="">{t('products.workspace_sections.fashion_group_editor_card.s16', "بدون مخزن افتراضي")}</option>
              {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </Field>

          <Field label={t('products.workspace_sections.fashion_group_editor_card.s17', "ملاحظات حول الموديل")}>
            <input
              className="purchase-prototype-field-input"
              value={commonDraft.notes}
              onChange={(event) => setCommonDraft((current) => ({ ...current, notes: normalizeArabicInput(event.target.value) }))}
              disabled={mutation.isPending}
              placeholder={t('products.workspace_sections.fashion_group_editor_card.s18', "ملاحظات اختيارية...")}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
