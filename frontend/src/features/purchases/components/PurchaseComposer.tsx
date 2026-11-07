import { useTranslation } from 'react-i18next';
import { useRef, useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { FormSection } from '@/shared/components/form-section';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import type { Product, Supplier, Branch, Location, AppSettings, Category } from '@/types/domain';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { usePurchaseComposerController } from '@/features/purchases/components/purchase-composer/usePurchaseComposerController';
import { PurchaseLineComposer } from '@/features/purchases/components/purchase-composer/PurchaseLineComposer';
import { PurchaseItemsList } from '@/features/purchases/components/purchase-composer/PurchaseItemsList';
import { PurchaseTotals } from '@/features/purchases/components/purchase-composer/PurchaseTotals';
import { MarginProtectionModal } from '@/features/purchases/components/MarginProtectionModal';
import { PurchaseQuickCreateDialog } from '@/features/purchases/components/purchase-composer/PurchaseQuickCreateDialog';
import { VendorDuplicateBillAlert } from '@/features/purchases/components/VendorDuplicateBillAlert';
import { useAuthStore, isAdminUser } from '@/stores/auth-store';

const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'نقدي' },
  { value: 'credit', label: 'آجل' },
];

interface PurchaseComposerProps {
  products: Product[];
  suppliers: Supplier[];
  categories: Category[];
  branches: Branch[];
  locations: Location[];
  settings?: AppSettings;
  isCatalogLoading: boolean;
  isCatalogError: boolean;
  catalogError?: unknown;
}

export function PurchaseComposer({ products, suppliers, categories, branches, locations, settings, isCatalogLoading, isCatalogError, catalogError }: PurchaseComposerProps) {
  const { t } = useTranslation();
  // Key starts null. Generated lazily on first Submit. Reused for retries of the same attempt.
  // Must be reset when user explicitly starts a new invoice or after confirmed committed/failed.
  const idempotencyKeyRef = useRef<string | null>(null);
  const controller = usePurchaseComposerController({ products, suppliers, categories, branches, locations, settings });
  const { headerForm, items, lineDraft, mutation, repricingInsights, hasDraftChanges, totals, duplicateCheck, quickCreate, actions } = controller;
  const user = useAuthStore((s) => s.user);
  const isAdmin = isAdminUser(user);
  const isBlockedByDuplicate = Boolean(
    duplicateCheck.result?.hasBlockingDuplicates &&
      (!duplicateCheck.allowOverride || !duplicateCheck.overrideReason.trim()),
  );

  const supplierOptions = useMemo(() => [
    { value: '', label: 'اختر المورد' },
    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
  ], [suppliers]);

  const branchOptions = useMemo(() => [
    { value: '', label: 'الفرع الافتراضي' },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ], [branches]);

  const locationOptions = useMemo(() => [
    { value: '', label: 'الموقع الافتراضي' },
    ...locations.map((l) => ({ value: l.id, label: l.name })),
  ], [locations]);

  return (
    <FormSection title={t('purchases.purchase_composer.s0', "إنشاء فاتورة شراء")} actions={<span className="nav-pill">{t('purchases.purchase_composer.s1', "إنشاء مباشر")}</span>} className="purchase-composer-card">
      <QueryFeedback
        isLoading={isCatalogLoading}
        isError={isCatalogError}
        error={catalogError}
        loadingText={t('purchases.purchase_composer.s2', "جاري تجهيز بيانات الموردين والأصناف...")}
        errorTitle={t('purchases.purchase_composer.s3', "تعذر تحميل بيانات تكوين فاتورة الشراء")}
        isEmpty={!products.length || !suppliers.length}
        emptyTitle={t('purchases.purchase_composer.s4', "لا يمكن إنشاء فاتورة شراء الآن")}
        emptyHint={t('purchases.purchase_composer.s5', "تأكد من وجود مورد واحد وصنف واحد على الأقل قبل إنشاء الفاتورة.")}
      >
        <form className="form-grid purchase-composer-form" onSubmit={headerForm.handleSubmit((values) => {
          // Generate key lazily on first submit attempt, then reuse for retries.
          if (!idempotencyKeyRef.current) {
            idempotencyKeyRef.current = crypto.randomUUID();
          }
          mutation.mutate({
            values: {
              ...values,
              confirmedDuplicateWarning: duplicateCheck.confirmedWarning,
              allowDuplicateOverride: duplicateCheck.allowOverride,
              duplicateOverrideReason: duplicateCheck.overrideReason,
            },
            items,
            taxRate: totals.taxRate,
            pricesIncludeTax: totals.pricesIncludeTax,
            idempotencyKey: idempotencyKeyRef.current,
          });
        })}>
          <DraftStateNotice visible={hasDraftChanges && !mutation.isPending} title={t('purchases.purchase_composer.s6', "فاتورة الشراء الحالية تحتوي على مسودة غير محفوظة")} hint={t('purchases.purchase_composer.s7', "احفظ الفاتورة أو أعد ضبطها قبل مغادرة الصفحة حتى لا تفقد البنود أو بيانات التوريد.")} />

          <VendorDuplicateBillAlert
            checkResult={duplicateCheck.result}
            confirmedWarning={duplicateCheck.confirmedWarning}
            onToggleConfirmWarning={duplicateCheck.setConfirmedWarning}
            allowOverride={duplicateCheck.allowOverride}
            onToggleAllowOverride={duplicateCheck.setAllowOverride}
            overrideReason={duplicateCheck.overrideReason}
            onChangeOverrideReason={duplicateCheck.setOverrideReason}
            isAdmin={isAdmin}
          />

          <Field label={t('purchases.purchase_composer.s8', "المورد")} error={headerForm.formState.errors.supplierId?.message}>
            <Controller
              name="supplierId"
              control={headerForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value || ''}
                  onChange={(val) => field.onChange(val)}
                  options={supplierOptions}
                  disabled={mutation.isPending}
                  searchable
                />
              )}
            />
          </Field>
          <Field label={t('purchases.purchase_composer.s9', "رقم فاتورة المورد الدفترية")}>
            <input
              type="text"
              placeholder={t('purchases.purchase_composer.s10', "رقم الفاتورة الورقية من المورد (اختياري)")}
              {...headerForm.register('supplierInvoiceNo')}
              disabled={mutation.isPending}
            />
          </Field>
          <Field label={t('purchases.purchase_composer.s11', "نوع السداد")}>
            <Controller
              name="paymentType"
              control={headerForm.control}
              render={({ field }) => (
                <CustomSelect
                  value={field.value || 'cash'}
                  onChange={(val) => field.onChange(val)}
                  options={PAYMENT_OPTIONS}
                  disabled={mutation.isPending}
                  searchable={false}
                />
              )}
            />
          </Field>
          {SINGLE_STORE_MODE ? (
            <Field label={t('purchases.purchase_composer.s12', "المخزن المستلم")}>
              <input value={locations[0]?.name || t('purchases.purchase_composer.s13', "سيتم الربط تلقائيًا بالمخزن الأساسي")} disabled readOnly />
            </Field>
          ) : (
            <>
              <Field label={t('purchases.purchase_composer.s14', "الفرع")}>
                <Controller
                  name="branchId"
                  control={headerForm.control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value || ''}
                      onChange={(val) => field.onChange(val)}
                      options={branchOptions}
                      disabled={mutation.isPending}
                      searchable
                    />
                  )}
                />
              </Field>
              <Field label={t('purchases.purchase_composer.s15', "الموقع")}>
                <Controller
                  name="locationId"
                  control={headerForm.control}
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value || ''}
                      onChange={(val) => field.onChange(val)}
                      options={locationOptions}
                      disabled={mutation.isPending}
                      searchable
                    />
                  )}
                />
              </Field>
            </>
          )}
          <Field label={t('purchases.purchase_composer.s16', "خصم الفاتورة")} error={headerForm.formState.errors.discount?.message}><input type="number" step="0.01" {...headerForm.register('discount')} disabled={mutation.isPending} /></Field>
          <Field label={t('purchases.purchase_composer.s23', "الشحن (يُوزَّع على تكلفة الأصناف)")} error={headerForm.formState.errors.freight?.message}><input type="number" step="0.01" min="0" {...headerForm.register('freight')} disabled={mutation.isPending} /></Field>
          <Field label={t('purchases.purchase_composer.s17', "ملاحظات")}><textarea rows={3} {...headerForm.register('note')} disabled={mutation.isPending} /></Field>

          <div className="divider" style={{ gridColumn: '1 / -1' }} />

          <PurchaseLineComposer
            products={lineDraft.filteredProducts}
            lineProductId={lineDraft.lineProductId}
            lineQty={lineDraft.lineQty}
            lineCost={lineDraft.lineCost}
            lineError={lineDraft.lineError}
            productSearch={lineDraft.productSearch}
            selectedProductName={lineDraft.selectedProductName}
            isPending={mutation.isPending}
            onProductSearchChange={actions.handleProductSearchChange}
            onProductSelect={actions.handleProductSelect}
            onQtyChange={actions.setLineQty}
            onCostChange={actions.setLineCost}
            onAddItem={actions.handleAddItem}
            onOpenQuickCreate={actions.openQuickCreateDialog}
          />
          <PurchaseItemsList items={items} isPending={mutation.isPending} onRemoveItem={actions.handleRemoveItem} />
          <PurchaseTotals subTotal={totals.subTotal} discount={totals.discount} freight={totals.freight} taxAmount={totals.taxAmount} total={totals.total} />

          <MutationFeedback
            isError={mutation.isError}
            isSuccess={mutation.isSuccess}
            error={mutation.error}
            errorFallback={t('purchases.purchase_composer.s18', "تعذر حفظ فاتورة الشراء. راجع السطور والبيانات ثم أعد المحاولة.")}
            successText={t('purchases.purchase_composer.s19', "تم حفظ فاتورة الشراء وتحديث المخزون بنجاح.")}
          />
          <div className="actions sticky-form-actions" style={{ gridColumn: '1 / -1' }}>
            <SubmitButton
              type="submit"
              variant="success"
              isPending={mutation.isPending}
              disabled={isBlockedByDuplicate}
              idleText={t('purchases.purchase_composer.s20', "حفظ فاتورة الشراء")}
              pendingText={t('purchases.purchase_composer.s21', "جارٍ حفظ الفاتورة...")}
            />
            <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => actions.handleReset()}>{t('purchases.purchase_composer.s22', "إعادة ضبط")}</Button>
          </div>
        </form>
      </QueryFeedback>

      <MarginProtectionModal
        open={Boolean(repricingInsights?.purchaseId)}
        purchaseId={repricingInsights?.purchaseId || 0}
        onClose={() => actions.setRepricingInsights(null)}
      />

      <PurchaseQuickCreateDialog
        open={quickCreate.open}
        draft={quickCreate.draft}
        categories={quickCreate.categories}
        suppliers={quickCreate.suppliers}
        isPending={quickCreate.mutation.isPending}
        error={quickCreate.mutation.error}
        onClose={actions.closeQuickCreateDialog}
        onDraftChange={actions.setQuickCreateDraft}
        onSubmit={() => {
          void actions.handleQuickCreateSubmit();
        }}
      />
    </FormSection>
  );
}
