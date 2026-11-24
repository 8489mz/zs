import { Button } from '@/shared/ui/button';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardBulkToolbarProps {
  selectedIds: string[];
  t: ReturnType<typeof useTranslation>['t'];
  onBulkPrintBarcodes?: () => void;
  __t: ReturnType<typeof useTranslation>['t'];
  onClearSelection: () => void;
  onBulkDelete: () => void;
  canDelete: boolean;
}

export function ProductsTableCardBulkToolbar({ selectedIds, t, onBulkPrintBarcodes, __t, onClearSelection, onBulkDelete, canDelete }: ProductsTableCardBulkToolbarProps) {
  return (
    <>
    {selectedIds.length ? (
      <div className="bulk-toolbar">
        <div className="bulk-toolbar-meta">
          <strong>{t('products.selected_active', 'تحديد نشط:')} {selectedIds.length}</strong>
          <span className="muted small">{t('products.selected_hint', 'يمكنك حذف الأصناف المحددة دفعة واحدة أو مسح التحديد الحالي.')}</span>
        </div>
        <div className="actions compact-actions">
          {onBulkPrintBarcodes && (
            <Button
              variant="secondary"
              onClick={onBulkPrintBarcodes}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
              title={__t('products.products_table_card.s8', "طباعة ملصقات الباركود واستيكرات الرفوف التموينية للأصناف المحددة")}
            >
              <PrinterIcon size={14} />
              <span>{t('products.print_barcodes_shelf', 'طباعة الباركود والرف')} ({selectedIds.length})</span>
            </Button>
          )}
          <Button variant="secondary" onClick={onClearSelection}>{t('products.clear_selection', 'مسح التحديد')}</Button>
          <Button variant="danger" onClick={onBulkDelete} disabled={!canDelete}>{t('products.delete_selected', 'حذف المحدد')}</Button>
        </div>
      </div>
    ) : null}
    </>
  );
}
