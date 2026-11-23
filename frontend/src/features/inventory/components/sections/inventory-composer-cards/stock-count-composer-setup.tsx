import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { Button } from '@/shared/ui/button';
import type { useTranslation } from 'react-i18next';
import type { StockCountType } from './inventory-composer-cards-shared';
import type { Product, StockCountItem } from '@/types/domain';

export interface StockCountComposerSetupProps {
  t: ReturnType<typeof useTranslation>['t'];
  countTypeOptions: Array<{ key: StockCountType; label: string; description: string }>;
  form: { branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string };
  scopeProducts: Product[];
  countType: StockCountType;
  setCountType: React.Dispatch<React.SetStateAction<StockCountType>>;
  SINGLE_STORE_MODE: boolean;
  onFormChange: (patch: Partial<{ branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string }>) => void;
  branchOptions: Array<{ value: string; label: string }>;
  stockCountWarehouseOptions: Array<{ value: string; label: string }>;
  selectedCategoryId: string;
  setSelectedCategoryId: React.Dispatch<React.SetStateAction<string>>;
  onItemsChange: (updater: (current: StockCountItem[]) => StockCountItem[]) => void;
  categorySelectOptions: Array<{ value: string; label: string }>;
  selectedSupplierId: string;
  setSelectedSupplierId: React.Dispatch<React.SetStateAction<string>>;
  supplierSelectOptions: Array<{ value: string; label: string }>;
  showExpectedInElectronicCount: boolean;
  setShowExpectedInElectronicCount: React.Dispatch<React.SetStateAction<boolean>>;
  canReviewStock: boolean;
  handleStartCount: () => void;
  isLoadingCatalog?: boolean;
  startCountMessage: string;
}

export function StockCountComposerSetup({ t, countTypeOptions, form, scopeProducts, countType, setCountType, SINGLE_STORE_MODE, onFormChange, branchOptions, stockCountWarehouseOptions, selectedCategoryId, setSelectedCategoryId, onItemsChange, categorySelectOptions, selectedSupplierId, setSelectedSupplierId, supplierSelectOptions, showExpectedInElectronicCount, setShowExpectedInElectronicCount, canReviewStock, handleStartCount, isLoadingCatalog, startCountMessage }: StockCountComposerSetupProps) {
  return (
    <div className="stock-count-setup-stack">
      <div className="stock-count-step-card">
        <div className="stock-count-step-heading">
          <span>1</span>
          <div>
            <strong>{t('inventory.sections.inventory_composer_cards.s27', "طريقة الجرد")}</strong>
            <small>{t('inventory.sections.inventory_composer_cards.s28', "اختر نمط الجرد المناسب للعملية الحالية")}</small>
          </div>
        </div>
        <div className="stock-count-method-grid">
          {countTypeOptions.map((entry) => {
            const countBadge = entry.key === 'full' && form.locationId && scopeProducts.length > 0
              ? ` (${scopeProducts.length} صنف)`
              : '';
            return (
              <button
                key={entry.key}
                type="button"
                className={`stock-count-method-card ${countType === entry.key ? 'stock-count-method-card--active' : ''}`}
                onClick={() => setCountType(entry.key)}
              >
                <strong>{entry.label}{countBadge}</strong>
                <span>{entry.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="stock-count-step-card">
        <div className="stock-count-step-heading">
          <span>2</span>
          <div>
            <strong>{t('inventory.sections.inventory_composer_cards.s29', "نطاق الجرد والإعدادات")}</strong>
            <small>{t('inventory.sections.inventory_composer_cards.s30', "حدد المخزن والملاحظة وخيارات العد")}</small>
          </div>
        </div>
        <div className="stock-count-inline-form">
          {!SINGLE_STORE_MODE ? (
            <Field label={t('inventory.sections.inventory_composer_cards.s31', "الفرع")}>
              <CustomSelect
                value={form.branchId}
                onChange={(val) => onFormChange({ branchId: val })}
                options={branchOptions}
                placeholder={t('inventory.sections.inventory_composer_cards.s32', "بدون فرع")}
              />
            </Field>
          ) : null}
          <Field label={t('inventory.sections.inventory_composer_cards.s33', "المخزن *")}>
            <CustomSelect
              value={form.locationId}
              onChange={(val) => onFormChange({ locationId: val })}
              options={stockCountWarehouseOptions}
              placeholder={t('inventory.sections.inventory_composer_cards.s34', "اختر المخزن")}
            />
          </Field>
          {countType === 'category' ? (
            <Field label={t('inventory.sections.inventory_composer_cards.s35', "القسم / التصنيف")}>
              <CustomSelect
                value={selectedCategoryId}
                onChange={(val) => {
                  setSelectedCategoryId(val);
                  onItemsChange(() => []);
                }}
                options={categorySelectOptions}
                placeholder={t('inventory.sections.inventory_composer_cards.s36', "اختر القسم")}
              />
            </Field>
          ) : null}
          {countType === 'supplier' ? (
            <Field label={t('inventory.sections.inventory_composer_cards.s37', "المورد / الشركة")}>
              <CustomSelect
                value={selectedSupplierId}
                onChange={(val) => {
                  setSelectedSupplierId(val);
                  onItemsChange(() => []);
                }}
                options={supplierSelectOptions}
                placeholder={t('inventory.sections.inventory_composer_cards.s38', "اختر المورد")}
              />
            </Field>
          ) : null}
          <Field label={t('inventory.sections.inventory_composer_cards.s39', "ملاحظة الجلسة")}>
            <input
              type="text"
              value={form.note}
              onChange={(e) => onFormChange({ note: e.target.value })}
              placeholder={t('inventory.sections.inventory_composer_cards.s40', "مثال: جرد أسبوعي / جرد قبل طلبية المورد")}
            />
          </Field>
        </div>

        <div className="stock-count-bottom-bar">
          <label className="stock-count-expected-toggle">
            <input type="checkbox" checked={showExpectedInElectronicCount} onChange={(event) => setShowExpectedInElectronicCount(event.target.checked)} disabled={!canReviewStock} />
            <span>{t('inventory.sections.inventory_composer_cards.s41', "إظهار كمية النظام أثناء الإدخال الإلكتروني")}</span>
          </label>
          <div className="stock-count-start-actions">
            <Button
              type="button"
              variant="primary"
              onClick={handleStartCount}
              disabled={isLoadingCatalog}
            >
              {isLoadingCatalog ? 'جارٍ تحميل بيانات المخزن...' : t('inventory.sections.inventory_composer_cards.s42', "ابدأ جلسة الجرد")}
            </Button>
          </div>
        </div>
        {!canReviewStock ? <div className="surface-note" style={{ marginTop: 8 }}>{t('inventory.sections.inventory_composer_cards.s43', "وضع العد المخفي مفعل لهذا المستخدم لضمان عد فعلي بدون التأثر برصيد النظام.")}</div> : null}
      </div>

      {startCountMessage ? <div className="warning-box">{startCountMessage}</div> : null}
    </div>
  );
}
