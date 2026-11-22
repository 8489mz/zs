import { useTranslation } from 'react-i18next';
import { systemConfirm } from '@/shared/components/system-alert';
import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { type VariantDraft } from '@/features/products/components/workspace-sections/FashionGroupEditorCard.helpers';
import type { Product } from '@/types/domain';

export function StickyFooterBar({ variantRows, totalStock, resetDraft, mutation, hasDraftChanges, groupProducts, duplicates }: { variantRows: VariantDraft[]; totalStock: number; resetDraft: () => void; mutation: { isPending: boolean; mutate: () => void }; hasDraftChanges: boolean; groupProducts: Product[]; duplicates: { duplicateCombos: number; duplicateBarcodes: number; duplicateSkus: number } }) {
  const { t } = useTranslation();
  return (
    <div style={{
      position: 'sticky',
      bottom: 0,
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: '10px 16px',
      boxShadow: '0 -2px 12px rgba(15, 23, 42, 0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '10px',
      zIndex: 10,
    }}>
      <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
        {t('products.workspace_sections.fashion_group_editor_card.s62', "إجمالي الأصناف الفرعية:")} <strong style={{ color: '#0f172a' }}>{variantRows.length} {t('products.workspace_sections.fashion_group_editor_card.s63', "صنف")}</strong> {t('products.workspace_sections.fashion_group_editor_card.s64', "| إجمالي المخزون:")} <strong style={{ color: '#15803d' }}>{totalStock}</strong>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Button
          type="button"
          variant="secondary"
          onClick={resetDraft}
          disabled={mutation.isPending || !hasDraftChanges}
          style={{ fontSize: '0.82rem', padding: '6px 14px' }}
        >
          {t('products.workspace_sections.fashion_group_editor_card.s65', "إلغاء التعديلات")}
        </Button>

        <SubmitButton
          type="button"
          onClick={async () => {
            const keptIds = new Set(variantRows.filter((row) => row.id).map((row) => String(row.id)));
            const removedCount = groupProducts.filter((item) => !keptIds.has(String(item.id))).length;
            if (removedCount > 0) {
              const confirmed = await systemConfirm(`سيتم أرشفة ${removedCount} مقاس أو لون محذوف من المجموعة. متابعة الحفظ؟`);
              if (!confirmed) return;
            }
            mutation.mutate();
          }}
          disabled={mutation.isPending || duplicates.duplicateCombos > 0 || duplicates.duplicateBarcodes > 0 || duplicates.duplicateSkus > 0 || !variantRows.length}
          idleText={t('products.workspace_sections.fashion_group_editor_card.s66', "حفظ كل التعديلات مرة واحدة")}
          pendingText={t('products.workspace_sections.fashion_group_editor_card.s67', "جارٍ الحفظ...")}
          style={{ fontSize: '0.84rem', padding: '6px 20px', fontWeight: 800 }}
        />
      </div>
    </div>
  );
}
