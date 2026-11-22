import { useTranslation } from 'react-i18next';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { MutationFeedback } from '@/shared/components/mutation-feedback';

export function NoticesAlerts({ hasDraftChanges, mutation, incompleteRows, duplicates }: { hasDraftChanges: boolean; mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown }; incompleteRows: number; duplicates: { duplicateCombos: number; duplicateBarcodes: number; duplicateSkus: number } }) {
  const { t } = useTranslation();
  return (
    <>
    <DraftStateNotice
      visible={hasDraftChanges && !mutation.isPending}
      title={t('products.workspace_sections.fashion_group_editor_card.s54', "توجد تعديلات غير محفوظة على هذا الموديل")}
      hint={t('products.workspace_sections.fashion_group_editor_card.s55', "عند الضغط على حفظ، سيتم تحديث وتطبيق البيانات على جميع الأصناف الفرعية التابعة له في المخازن ونقطة البيع.")}
    />

    {incompleteRows ? (
      <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fffbeb', border: '1px solid #fef3c7', color: '#b45309', fontSize: '0.8rem', fontWeight: 600 }}>
        {t('products.workspace_sections.fashion_group_editor_card.s56', "يوجد")} {incompleteRows} {t('products.workspace_sections.fashion_group_editor_card.s57', "سطر فرعي غير مكتمل. يرجى ملء الخاصية لتجنب تجاهل السطر.")}
      </div>
    ) : null}

    {duplicates.duplicateCombos ? (
      <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 700 }}>
        {t('products.workspace_sections.fashion_group_editor_card.s58', "يوجد صنف فرعي مكرر بنفس الخاصية داخل نفس المجموعة.")}
      </div>
    ) : null}

    {duplicates.duplicateSkus ? (
      <div role="alert" style={{ padding: '8px 12px', color: '#b91c1c', fontWeight: 700 }}>
        يوجد كود SKU مكرر داخل المجموعة؛ صححه قبل الحفظ.
      </div>
    ) : null}

    {duplicates.duplicateBarcodes ? (
      <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 700 }}>
        {t('products.workspace_sections.fashion_group_editor_card.s59', "يوجد باركود مكرر مسند لأكثر من صنف فرعي داخل المجموعة.")}
      </div>
    ) : null}

    <MutationFeedback
      isError={mutation.isError}
      isSuccess={mutation.isSuccess}
      error={mutation.error}
      errorFallback={t('products.workspace_sections.fashion_group_editor_card.s60', "تعذر حفظ تعديلات المجموعة")}
      successText={t('products.workspace_sections.fashion_group_editor_card.s61', "تم حفظ وتحديث الصنف الرئيسي وجميع الأصناف الفرعية بنجاح!")}
    />
    </>
  );
}
