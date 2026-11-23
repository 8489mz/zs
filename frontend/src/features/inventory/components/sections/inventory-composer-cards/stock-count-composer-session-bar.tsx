import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import type { useTranslation } from 'react-i18next';
import type { StockCountType } from './inventory-composer-cards-shared';
import type { Location, StockCountItem } from '@/types/domain';

export interface StockCountComposerSessionBarProps {
  selectedCountType: { key: StockCountType; label: string; description: string } | undefined;
  selectedLocation: Location | undefined;
  t: ReturnType<typeof useTranslation>['t'];
  selectedCategoryId: string;
  categoryOptions: Array<{ id: string; label: string; count: number }>;
  selectedSupplierId: string;
  supplierOptions: Array<{ id: string; label: string; count: number }>;
  items: StockCountItem[];
  countedCount: number;
  totalCounted: number;
  totalVariance: number;
  canShowExpectedCount: boolean;
  financialSummary: { deficitCost: number; surplusCost: number; netCost: number };
  handleBackToSetup: () => void;
  isPending: boolean;
  onSubmit: (options?: { noteOverride?: string }) => void;
  buildSessionNoteWithType: (baseNote: string) => string;
  form: { branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string };
}

export function StockCountComposerSessionBar({ selectedCountType, selectedLocation, t, selectedCategoryId, categoryOptions, selectedSupplierId, supplierOptions, items, countedCount, totalCounted, totalVariance, canShowExpectedCount, financialSummary, handleBackToSetup, isPending, onSubmit, buildSessionNoteWithType, form }: StockCountComposerSessionBarProps) {
  return (
    <div className="stock-count-session-bar">
      <div className="stock-count-session-meta">
        <div className="session-title-group">
          <span className="stock-count-badge">{selectedCountType.label}</span>
          <strong>{selectedLocation?.name ? `المخزن: ${selectedLocation.name}` : t('inventory.sections.inventory_composer_cards.s44', "المخزن")}</strong>
          {selectedCategoryId ? <span className="meta-tag">{t('inventory.sections.inventory_composer_cards.s45', "القسم:")} {categoryOptions.find((c) => c.id === selectedCategoryId)?.label || selectedCategoryId}</span> : null}
          {selectedSupplierId ? <span className="meta-tag">{t('inventory.sections.inventory_composer_cards.s46', "المورد:")} {supplierOptions.find((s) => s.id === selectedSupplierId)?.label || selectedSupplierId}</span> : null}
        </div>

        <div className="stock-count-stat-pills">
          <span className="stat-pill">{t('inventory.sections.inventory_composer_cards.s47', "الأصناف:")} <strong>{items.length}</strong></span>
          <span className="stat-pill" style={{ color: countedCount > 0 ? '#15803d' : undefined, background: countedCount > 0 ? '#f0fdf4' : undefined, border: countedCount > 0 ? '1px solid #bbf7d0' : undefined }}>
            تم عدها: <strong>{countedCount}</strong> من {items.length}
          </span>
          <span className="stat-pill">{t('inventory.sections.inventory_composer_cards.s48', "إجمالي المعدود:")} <strong>{totalCounted}</strong></span>
          <span className="stat-pill">{t('inventory.sections.inventory_composer_cards.s49', "الفروقات:")} <strong>{totalVariance}</strong></span>
          {canShowExpectedCount && financialSummary.deficitCost > 0 ? (
            <span className="stat-pill stat-pill--deficit">{t('inventory.sections.inventory_composer_cards.s50', "قيمة العجز:")} <strong>{financialSummary.deficitCost.toLocaleString('ar-EG')} {getGlobalCurrencySymbol()}</strong></span>
          ) : null}
        </div>
      </div>

      <div className="actions compact-actions">
        <Button type="button" variant="secondary" onClick={handleBackToSetup} disabled={isPending}>{t('inventory.sections.inventory_composer_cards.s51', "تعديل الإعدادات")}</Button>
        <SubmitButton
          type="button"
          onClick={() => onSubmit({ noteOverride: buildSessionNoteWithType(form.note) })}
          disabled={isPending || !countedCount || !form.locationId}
          idleText={`إنشاء وحفظ الجلسة (${countedCount} صنف)`}
          pendingText={t('inventory.sections.inventory_composer_cards.s53', "جارٍ الإنشاء...")}
        />
      </div>
    </div>
  );
}
