import { InventoryProductPicker } from '@/features/inventory/components/InventoryProductPicker';
import { Button } from '@/shared/ui/button';
import { PlusIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { Product } from '@/types/domain';

export interface StockCountComposerQuickEntryProps {
  t: ReturnType<typeof useTranslation>['t'];
  scopeProducts: Product[];
  products: Product[];
  form: { branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string };
  onFormChange: (patch: Partial<{ branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string }>) => void;
  onAddItem: () => void;
}

export function StockCountComposerQuickEntry({ t, scopeProducts, products, form, onFormChange, onAddItem }: StockCountComposerQuickEntryProps) {
  return (
    <div className="stock-count-quick-entry-row">
      <span className="entry-row-title">{t('inventory.sections.inventory_composer_cards.s64', "إدراج صنف في الجرد:")}</span>
      <div className="entry-row-picker">
        <InventoryProductPicker products={scopeProducts.length > 0 ? scopeProducts : products} value={form.productId} onChange={(productId) => onFormChange({ productId })} showStock showPrice={false} hideHint={true} />
      </div>
      <input
        type="number"
        min="0"
        step="0.001"
        className="entry-row-qty"
        value={form.countedQty}
        onChange={(e) => onFormChange({ countedQty: e.target.value })}
        placeholder={t('inventory.sections.inventory_composer_cards.s65', "الكمية")}
      />
      <input
        type="text"
        className="entry-row-reason"
        value={form.reason}
        onChange={(e) => onFormChange({ reason: e.target.value })}
        placeholder={t('inventory.sections.inventory_composer_cards.s66', "سبب الفرق (مثال: عجز / كسر)")}
      />
      <Button type="button" variant="secondary" onClick={onAddItem}>
        <PlusIcon size={15} />
        <span>{t('inventory.sections.inventory_composer_cards.s67', "إدراج في الجرد")}</span>
      </Button>
    </div>
  );
}
