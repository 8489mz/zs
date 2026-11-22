import { useTranslation } from 'react-i18next';
import { Fragment } from 'react';
import { formatCurrency } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { normalizeArabicInput } from '@/lib/arabic-normalization';
import { variantLabel, type CommonDraft, type VariantDraft } from '@/features/products/components/workspace-sections/FashionGroupEditorCard.helpers';
import type { Product } from '@/types/domain';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { FashionGroupBarcodePrintAction } from '@/features/products/components/workspace-sections/FashionGroupBarcodePrintAction';
import { VariantImageCell } from '@/features/products/components/VariantImageCell';
import { Trash2Icon, SlidersIcon } from '@/shared/components/icons/AppIcons';

export function VariantsMatrixCard({ addVariantRow, mutation, pruneZeroStockRows, variantRows, handleZeroAllStocks, generateSequentialBarcodes, commonDraft, generateSequentialSkus, clearAllBarcodes, groupProducts, hasDraftChanges, resetDraft, totalStock, primaryLabel, secondaryLabel, updateRow, handleOpenQuickAdjustment, toggleVariantPricing, removeDraftRow, disableVariantPricing }: { addVariantRow: () => void; mutation: { isPending: boolean }; pruneZeroStockRows: () => void; variantRows: VariantDraft[]; handleZeroAllStocks: () => void | Promise<void>; generateSequentialBarcodes: () => void | Promise<void>; commonDraft: CommonDraft; generateSequentialSkus: () => void; clearAllBarcodes: () => void; groupProducts: Product[]; hasDraftChanges: boolean; resetDraft: () => void; totalStock: number; primaryLabel: string; secondaryLabel: string; updateRow: (index: number, patch: Partial<VariantDraft>) => void; handleOpenQuickAdjustment: (row: VariantDraft) => void; toggleVariantPricing: (index: number) => void; removeDraftRow: (index: number) => void | Promise<void>; disableVariantPricing: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="product-compact-card">
      <div className="product-compact-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'nowrap' }}>
        <h3 className="product-compact-card-title" style={{ whiteSpace: 'nowrap', margin: 0, flexShrink: 0 }}>
          {t('products.workspace_sections.fashion_group_editor_card.s29', "جدول الأصناف الفرعية والباركودات")}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <Button
            type="button"
            variant="primary"
            onClick={addVariantRow}
            disabled={mutation.isPending}
            style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s30', "+ إضافة صنف فرعي يدوي")}
          >
            + إضافة صنف
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={pruneZeroStockRows}
            disabled={mutation.isPending || !variantRows.some((r) => Number(r.stock || 0) === 0)}
            style={{ fontSize: '0.74rem', padding: '3px 8px', color: '#b45309', borderColor: '#fde68a', background: '#fefce8', whiteSpace: 'nowrap' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s30_prune_tip', "حذف كافة الأصناف الفرعية التي رصيدها صفر دفعة واحدة بنقرة واحدة")}
          >
            حذف رصيد 0
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleZeroAllStocks}
            disabled={mutation.isPending || !variantRows.some((r) => Number(r.stock || 0) > 0)}
            style={{ fontSize: '0.74rem', padding: '3px 8px', color: '#64748b', whiteSpace: 'nowrap' }}
            title="تصفير أرصدة كافة المقاسات المعروضة في الجدول تمهيداً للتسوية أو الحذف"
          >
            تصفير الأرصدة
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void generateSequentialBarcodes()}
            disabled={mutation.isPending || !variantRows.length || !commonDraft.styleCode.trim()}
            style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s31', "توليد باركودات متسلسلة")}
          >
            توليد باركودات
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={generateSequentialSkus}
            disabled={mutation.isPending || !variantRows.length}
            style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
            title={t('products.workspace_sections.fashion_group_editor_card.s32', "توليد أكواد SKU")}
          >
            توليد SKU
          </Button>
          <Button type="button" variant="secondary" onClick={clearAllBarcodes} disabled={mutation.isPending || !variantRows.length} style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }} title={t('products.workspace_sections.fashion_group_editor_card.s33', "مسح كل الباركودات")}>مسح الباركودات</Button>
          <FashionGroupBarcodePrintAction groupProducts={groupProducts} hasDraftChanges={hasDraftChanges} disabled={mutation.isPending} />
          <Button type="button" variant="secondary" onClick={resetDraft} disabled={mutation.isPending || !hasDraftChanges} style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }} title={t('products.workspace_sections.fashion_group_editor_card.s34', "إعادة القيم الأصلية")}>إعادة الأصل</Button>
        </div>
      </div>

      {/* Stats Strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span className="cashier-chip" style={{ fontWeight: 800, color: '#1e40af', background: '#dbeafe' }}>
          {variantRows.length} {t('products.workspace_sections.fashion_group_editor_card.s35', "صنف فرعي")}
        </span>
        <span className="cashier-chip" style={{ color: '#166534', background: '#dcfce7' }}>
          {t('products.workspace_sections.fashion_group_editor_card.s36', "إجمالي المخزون الحالي:")} {totalStock}
        </span>
      </div>

      {/* Variants Table */}
      <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '902px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'right' }}>
              <th style={{ padding: '8px 8px', width: '32px', textAlign: 'center' }}>#</th>
              <th style={{ padding: '8px 8px', minWidth: '110px' }}>{primaryLabel}</th>
              <th style={{ padding: '8px 8px', minWidth: '100px' }}>{secondaryLabel}</th>
              <th style={{ padding: '8px 8px', width: '52px', textAlign: 'center' }}>{t('products.workspace_sections.fashion_group_editor_card.s68', "الصورة")}</th>
              <th style={{ padding: '8px 8px', minWidth: '110px' }}>{t('products.workspace_sections.fashion_group_editor_card.s37', "رمز SKU")}</th>
              <th style={{ padding: '8px 8px', minWidth: '120px' }}>{t('products.workspace_sections.fashion_group_editor_card.s38', "الباركود")}</th>
              <th style={{ padding: '8px 8px', minWidth: '95px' }}>{t('products.workspace_sections.fashion_group_editor_card.s39', "سعر البيع (")}{getGlobalCurrencySymbol()})</th>
              <th style={{ padding: '8px 8px', minWidth: '95px' }}>{t('products.workspace_sections.fashion_group_editor_card.s40', "سعر الشراء (")}{getGlobalCurrencySymbol()})</th>
              <th style={{ padding: '8px 6px', minWidth: '120px', textAlign: 'center' }}>{t('products.workspace_sections.fashion_group_editor_card.s41', "الرصيد")}</th>
              <th style={{ padding: '8px 8px', minWidth: '140px' }}>{t('products.workspace_sections.fashion_group_editor_card.s42', "الاسم النهائي للصنف")}</th>
              <th style={{ padding: '8px 8px', width: '110px', textAlign: 'center' }}>{t('products.workspace_sections.fashion_group_editor_card.s43', "التسعير المخصص")}</th>
              <th style={{ padding: '8px 6px', width: '40px', textAlign: 'center' }}>{t('products.workspace_sections.fashion_group_editor_card.s44', "حذف")}</th>
            </tr>
          </thead>
          <tbody>
            {variantRows.map((row, index) => {
              const finalLabel = variantLabel(row);
              const fullName = commonDraft.name ? `${commonDraft.name}${finalLabel ? ` - ${finalLabel}` : ''}` : '-';

              return (
                <Fragment key={`${row.id || 'draft'}-${index}`}>
                  <tr style={{ borderBottom: '1px solid #f1f5f9', background: index % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td style={{ padding: '6px 6px', textAlign: 'center', color: '#94a3b8', fontWeight: 700, fontSize: '0.74rem' }}>
                      {index + 1}
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        style={{ padding: '4px 6px', fontSize: '0.8rem' }}
                        value={row.color}
                        onChange={(event) => updateRow(index, { color: normalizeArabicInput(event.target.value) })}
                        disabled={mutation.isPending}
                        placeholder={primaryLabel}
                      />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        style={{ padding: '4px 6px', fontSize: '0.8rem' }}
                        value={row.size}
                        onChange={(event) => updateRow(index, { size: normalizeArabicInput(event.target.value) })}
                        disabled={mutation.isPending}
                        placeholder={secondaryLabel}
                      />
                    </td>
                    <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                      <VariantImageCell
                        value={row.imageUrl || ''}
                        disabled={mutation.isPending}
                        onChange={(url) => updateRow(index, { imageUrl: url })}
                      />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        style={{ padding: '4px 6px', fontSize: '0.78rem', direction: 'ltr' }}
                        value={row.sku || ''}
                        onChange={(event) => updateRow(index, { sku: event.target.value })}
                        disabled={mutation.isPending}
                        placeholder={t('products.workspace_sections.fashion_group_editor_card.s45', "اختياري SKU")}
                      />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        style={{ padding: '4px 6px', fontSize: '0.78rem', direction: 'ltr' }}
                        value={row.barcode}
                        onChange={(event) => updateRow(index, { barcode: event.target.value })}
                        disabled={mutation.isPending}
                        placeholder={t('products.workspace_sections.fashion_group_editor_card.s46', "الباركود")}
                      />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        type="number"
                        step="0.01"
                        style={{ padding: '4px 6px', fontSize: '0.8rem', fontWeight: 700, color: '#15803d' }}
                        value={row.useCustomPricing ? row.retailPrice : commonDraft.retailPrice}
                        onChange={(event) => {
                          const val = Number(event.target.value || 0);
                          updateRow(index, { retailPrice: val, useCustomPricing: true });
                        }}
                        disabled={mutation.isPending}
                      />
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        type="number"
                        step="0.01"
                        style={{ padding: '4px 6px', fontSize: '0.8rem', color: '#475569' }}
                        value={row.useCustomPricing ? row.costPrice : commonDraft.costPrice}
                        onChange={(event) => {
                          const val = Number(event.target.value || 0);
                          updateRow(index, { costPrice: val, useCustomPricing: true });
                        }}
                        disabled={mutation.isPending}
                      />
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px', direction: 'ltr' }}>
                        {row.id ? (
                          <button
                            type="button"
                            title="تسوية تفصيلية للمخزون"
                            onClick={() => handleOpenQuickAdjustment(row)}
                            disabled={mutation.isPending}
                            style={{
                              height: '26px',
                              width: '26px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '5px',
                              border: '1px solid #bfdbfe',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              cursor: 'pointer',
                              padding: 0,
                              flexShrink: 0,
                            }}
                          >
                            <SlidersIcon size={12} />
                          </button>
                        ) : null}
                        {Number(row.stock || 0) > 0 ? (
                          <button
                            type="button"
                            title="تصفير الرصيد إلى 0"
                            onClick={() => updateRow(index, { stock: 0 })}
                            disabled={mutation.isPending}
                            style={{
                              height: '26px',
                              padding: '0 5px',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              borderRadius: '5px',
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              color: '#64748b',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            0
                          </button>
                        ) : null}
                        <input
                          className="purchase-prototype-field-input"
                          style={{
                            height: '28px',
                            padding: '0 4px',
                            fontSize: '0.78rem',
                            textAlign: 'center',
                            fontWeight: 800,
                            width: '52px',
                            color: (row.stock || 0) > 0 ? '#15803d' : '#94a3b8',
                          }}
                          type="number"
                          min={0}
                          step="1"
                          value={row.stock ?? 0}
                          onChange={(event) => updateRow(index, { stock: Math.max(0, Number(event.target.value || 0)) })}
                          disabled={mutation.isPending}
                        />
                      </div>
                      {row.originalStock !== undefined && Number(row.stock || 0) !== Number(row.originalStock || 0) ? (
                        <div style={{ fontSize: '0.64rem', color: '#b45309', fontWeight: 700, marginTop: '2px' }}>
                          سابقاً: {row.originalStock}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.78rem', display: 'block', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fullName}>
                        {fullName}
                      </span>
                    </td>
                    <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => toggleVariantPricing(index)}
                        disabled={mutation.isPending}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '3px 6px',
                          borderRadius: '5px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          background: row.useCustomPricing ? '#eff6ff' : '#f1f5f9',
                          color: row.useCustomPricing ? '#1d4ed8' : '#475569',
                          border: row.useCustomPricing ? '1px solid #bfdbfe' : '1px solid #cbd5e1',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {row.useCustomPricing ? `مخصص (${formatCurrency(row.retailPrice)})` : `موحد (${formatCurrency(commonDraft.retailPrice)})`}
                      </button>
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => removeDraftRow(index)}
                        disabled={mutation.isPending || variantRows.length === 1}
                        title={variantRows.length === 1 ? t('products.workspace_sections.fashion_group_editor_card.s47', "يجب أن يتبقى صنف فرعي واحد على الأقل") : t('products.workspace_sections.fashion_group_editor_card.s48', "حذف هذا الصنف الفرعي")}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '26px',
                          height: '26px',
                          borderRadius: '5px',
                          background: '#fef2f2',
                          border: '1px solid #fee2e2',
                          color: '#dc2626',
                          cursor: variantRows.length === 1 ? 'not-allowed' : 'pointer',
                          opacity: variantRows.length === 1 ? 0.35 : 1,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <Trash2Icon size={13} />
                      </button>
                    </td>
                  </tr>

                  {/* Inline Custom Pricing Card Drawer */}
                  {row.useCustomPricing && row.pricingEditorOpen && (
                    <tr style={{ background: '#f0f9ff' }}>
                      <td colSpan={11} style={{ padding: '10px 16px', borderBottom: '1px solid #bae6fd' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0369a1' }}>
                            {t('products.workspace_sections.fashion_group_editor_card.s49', "تخصيص أسعار الفرعي:")} {fullName}
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => disableVariantPricing(index)}
                            disabled={mutation.isPending}
                            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                          >
                            {t('products.workspace_sections.fashion_group_editor_card.s50', "الرجوع للسعر الموحد")}
                          </Button>
                        </div>

                        <div className="product-form-grid-3">
                          <Field label={t('products.workspace_sections.fashion_group_editor_card.s51', "سعر الشراء للفرعي")}>
                            <input
                              className="purchase-prototype-field-input"
                              type="number"
                              step="0.01"
                              value={row.costPrice}
                              onChange={(event) => updateRow(index, { costPrice: Number(event.target.value || 0) })}
                              disabled={mutation.isPending}
                            />
                          </Field>
                          <Field label={t('products.workspace_sections.fashion_group_editor_card.s52', "سعر البيع للفرعي")}>
                            <input
                              className="purchase-prototype-field-input"
                              type="number"
                              step="0.01"
                              value={row.retailPrice}
                              onChange={(event) => updateRow(index, { retailPrice: Number(event.target.value || 0) })}
                              disabled={mutation.isPending}
                              style={{ fontWeight: 800, color: '#15803d' }}
                            />
                          </Field>
                          <Field label={t('products.workspace_sections.fashion_group_editor_card.s53', "سعر الجملة للفرعي")}>
                            <input
                              className="purchase-prototype-field-input"
                              type="number"
                              step="0.01"
                              value={row.wholesalePrice}
                              onChange={(event) => updateRow(index, { wholesalePrice: Number(event.target.value || 0) })}
                              disabled={mutation.isPending}
                              style={{ fontWeight: 700, color: '#b45309' }}
                            />
                          </Field>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
