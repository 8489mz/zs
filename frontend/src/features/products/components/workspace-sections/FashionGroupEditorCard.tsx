import { useTranslation } from 'react-i18next';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import { productsApi } from '@/features/products/api/products.api';
import { normalizeArabicInput, normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { formatCurrency } from '@/lib/format';
import { Trash2Icon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import { QuickStockAdjustmentDialog, useInventoryActionCatalog } from '@/features/inventory';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import type { Category, Product, Supplier, Location } from '@/types/domain';
import {
  buildGroupSaveRows,
  buildPayload,
  deriveBaseName,
  duplicateSummary,
  rowsFingerprint,
  toCommonDraft,
  toVariantRows,
  variantLabel,
  type CommonDraft,
  type VariantDraft
} from '@/features/products/components/workspace-sections/FashionGroupEditorCard.helpers';
import { splitFashionTokens, mergeFashionTokens } from '@/features/products/components/fashion-variants.utils';
import { VariantImageCell } from '@/features/products/components/VariantImageCell';

export type VariantTemplateType = 'fashion' | 'scents' | 'sizes' | 'custom';

function ScentDropletIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function FashionShirtIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
    </svg>
  );
}

function PackageBoxIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function SlidersConfigIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="21" y2="21" />
      <line x1="4" x2="20" y1="14" y2="14" />
      <line x1="4" x2="20" y1="7" y2="7" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="14" r="2" />
      <circle cx="8" cy="21" r="2" />
    </svg>
  );
}

const FASHION_COLOR_PRESETS = ['اسود', 'ابيض', 'كحلي', 'رمادي', 'بيج', 'احمر', 'ازرق', 'زيتي', 'وردي', 'اوف وايت', 'بني', 'عنابي'];
const SCENT_FLAVOR_PRESETS = ['لافندر', 'عود', 'مسك', 'ياسمين', 'ورد', 'توت', 'خوخ', 'ليمون', 'نعناع', 'فانيليا', 'شوكولاتة', 'جوز هند', 'صندل', 'عنبر'];
const SIZE_CAPACITY_PRESETS = ['250 مل', '500 مل', '1 لتر', '2 لتر', '5 لتر', '250 جم', '500 جم', '1 كجم', 'صغير', 'وسط', 'كبير'];

const PACKAGING_PRESETS = ['علبة', 'كيس', 'زجاج', 'بلاستيك', 'بخاخ', 'ضاغط', 'جركن'];
const SCENT_SIZE_PRESETS = ['صغير', 'وسط', 'كبير', '50 مل', '100 مل', '150 مل', '250 مل', '500 مل'];

const FASHION_SIZE_PRESETS: Array<{ label: string; values: string[] }> = [
  { label: 'أساسي (S..2XL)', values: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'موسع (XS..3XL)', values: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: 'حريمي (36..46)', values: ['36', '38', '40', '42', '44', '46'] },
  { label: 'أطفال (2..14)', values: ['2', '4', '6', '8', '10', '12', '14'] },
  { label: 'شوز (37..45)', values: ['37', '38', '39', '40', '41', '42', '43', '44', '45'] },
];

interface FashionGroupEditorCardProps {
  product: Product;
  categories: Category[];
  suppliers: Supplier[];
  locations: Location[];
  onSaved?: (product: Product) => void;
}

export function FashionGroupEditorCard({ product, categories, suppliers, locations, onSaved }: FashionGroupEditorCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const styleCode = String(product.styleCode || '').trim();

  const groupQuery = useQuery({
    queryKey: queryKeys.productsPage(`variant-group:${styleCode || product.id}`),
    queryFn: async () => {
      const payload = styleCode ? await productsApi.listAll({ q: styleCode }) : { products: [product] };
      const rows = (payload.products || []).filter((entry) => (styleCode ? String(entry.styleCode || '').trim() === styleCode : String(entry.id) === String(product.id)));
      return rows.length ? rows : [product];
    },
    staleTime: 30_000,
  });

  const groupProducts = useMemo(() => {
    const rows = groupQuery.data || [];
    const byId = new Map(rows.map((entry) => [String(entry.id), entry]));
    if (!byId.has(String(product.id))) byId.set(String(product.id), product);
    return Array.from(byId.values()).sort((a, b) => variantLabel({ color: a.color || '', size: a.size || '' }).localeCompare(variantLabel({ color: b.color || '', size: b.size || '' }), 'ar'));
  }, [groupQuery.data, product]);

  const seedProduct = useMemo(() => (groupProducts[0] || product), [groupProducts, product]);
  const [commonDraft, setCommonDraft] = useState<CommonDraft>(() => ({ ...toCommonDraft(seedProduct, groupProducts), name: deriveBaseName(seedProduct) }));
  const [variantRows, setVariantRows] = useState<VariantDraft[]>(() => toVariantRows(groupProducts));

  // Quick builder tokens state
  const [activeTemplate, setActiveTemplate] = useState<VariantTemplateType>(seedProduct.itemKind === 'fashion' ? 'fashion' : 'scents');
  const [customPrimaryLabel, setCustomPrimaryLabel] = useState('الخاصية الأولى');
  const [customSecondaryLabel, setCustomSecondaryLabel] = useState('الخاصية الثانية');
  const [colorsValue, setColorsValue] = useState('');
  const [sizesValue, setSizesValue] = useState('');
  const [barcodePrefix, setBarcodePrefix] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [consolidateStockOnSave, setConsolidateStockOnSave] = useState(false);
  const [zeroRemovedStockOnSave, setZeroRemovedStockOnSave] = useState(false);
  const [selectedProductForAdjustment, setSelectedProductForAdjustment] = useState<Product | null>(null);
  const inventoryCatalog = useInventoryActionCatalog();

  // Query refresh must not overwrite an unsaved model/variant matrix.
  const lastHydratedRef = useRef<{
    id: string; common: string; rows: string; colors: string; sizes: string; prefix: string;
  } | null>(null);
  useEffect(() => {
    const previous = lastHydratedRef.current;
    const sameProduct = previous?.id === String(product.id);
    const draftIsUnchanged = previous
      && previous.common === JSON.stringify(commonDraft)
      && previous.rows === rowsFingerprint(variantRows)
      && previous.colors === colorsValue && previous.sizes === sizesValue
      && previous.prefix === barcodePrefix;
    if (sameProduct && !draftIsUnchanged) return;
    const nextCommon = { ...toCommonDraft(seedProduct, groupProducts), name: deriveBaseName(seedProduct) };
    const nextRows = toVariantRows(groupProducts);
    const nextColors = Array.from(new Set(nextRows.map((r) => r.color).filter(Boolean))).join('، ');
    const nextSizes = Array.from(new Set(nextRows.map((r) => r.size).filter(Boolean))).join('، ');
    const prefix = seedProduct.styleCode || '';
    setCommonDraft(nextCommon);
    setVariantRows(nextRows);
    setColorsValue(nextColors);
    setSizesValue(nextSizes);
    setBarcodePrefix(prefix);
    lastHydratedRef.current = {
      id: String(product.id), common: JSON.stringify(nextCommon), rows: rowsFingerprint(nextRows),
      colors: nextColors, sizes: nextSizes, prefix,
    };
  }, [product.id, seedProduct, groupProducts]);

  const baselineCommon = useMemo(() => JSON.stringify({ ...toCommonDraft(seedProduct, groupProducts), name: deriveBaseName(seedProduct) }), [seedProduct]);
  const baselineRows = useMemo(() => rowsFingerprint(toVariantRows(groupProducts)), [groupProducts]);
  const hasDraftChanges = JSON.stringify(commonDraft) !== baselineCommon || rowsFingerprint(variantRows) !== baselineRows;
  const duplicates = useMemo(() => duplicateSummary(variantRows), [variantRows]);
  const incompleteRows = useMemo(() => variantRows.filter((row) => !variantLabel(row)).length, [variantRows]);
  const canNavigateAway = useUnsavedChangesGuard(hasDraftChanges);

  const templateConfig = useMemo(() => {
    switch (activeTemplate) {
      case 'fashion':
        return {
          title: 'موديل ملابس وأحذية',
          hint: 'أضف الألوان والمقاسات من المجموعات الجاهزة لتوليد وتوسيع فروع الموديل تلقائياً.',
          primaryLabel: 'الألوان',
          secondaryLabel: 'المقاسات (اختياري)',
          primarySingleLabel: 'اللون',
          secondarySingleLabel: 'المقاس',
          primaryPlaceholder: 'اسود، ابيض، كحلي...',
          secondaryPlaceholder: 'S، M، L، XL...',
          primaryPresets: FASHION_COLOR_PRESETS,
        };
      case 'scents':
        return {
          title: 'روائح ونكهات وعطور',
          hint: 'أدخل الروائح أو النكهات والأحجام لتجهيز الأصناف الفرعية.',
          primaryLabel: 'الروائح والنكهات',
          secondaryLabel: 'الأحجام / السعات (اختياري)',
          primarySingleLabel: 'الرائحة/النكهة',
          secondarySingleLabel: 'الحجم',
          primaryPlaceholder: 'لافندر، عود، ليمون، توت...',
          secondaryPlaceholder: '100 مل، 250 مل، كبير...',
          primaryPresets: SCENT_FLAVOR_PRESETS,
        };
      case 'sizes':
        return {
          title: 'أحجام وسعات وعبوات',
          hint: 'أدخل الأحجام والتغليف كخاصية ثانية (علبة، كيس، بخاخ).',
          primaryLabel: 'الأحجام / السعات',
          secondaryLabel: 'النوع / التغليف (اختياري)',
          primarySingleLabel: 'الحجم/السعة',
          secondarySingleLabel: 'النوع',
          primaryPlaceholder: '250 مل، 500 مل، 1 لتر...',
          secondaryPlaceholder: 'علبة، كيس، بخاخ، زجاج...',
          primaryPresets: SIZE_CAPACITY_PRESETS,
        };
      case 'custom':
      default:
        return {
          title: 'تخصيص حر للمتغيرات',
          hint: 'حدد المسميات واكتب قيم كل خاصية لتجهيز الأصناف الفرعية.',
          primaryLabel: customPrimaryLabel || 'الخاصية الأولى',
          secondaryLabel: `${customSecondaryLabel || 'الخاصية الثانية'} (اختياري)`,
          primarySingleLabel: customPrimaryLabel || 'الخاصية الأولى',
          secondarySingleLabel: customSecondaryLabel || 'الخاصية الثانية',
          primaryPlaceholder: 'اكتب القيم مفصولة بفواصل...',
          secondaryPlaceholder: 'اختياري: اكتب القيم مفصولة بفواصل...',
          primaryPresets: [],
        };
    }
  }, [activeTemplate, customPrimaryLabel, customSecondaryLabel]);

  const primaryLabel = templateConfig.primarySingleLabel;
  const secondaryLabel = templateConfig.secondarySingleLabel;
  const totalStock = useMemo(() => variantRows.reduce((sum, row) => sum + Number(row.stock || 0), 0), [variantRows]);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedName = commonDraft.name.trim();
      const trimmedStyleCode = commonDraft.styleCode.trim();
      const cleanRows = buildGroupSaveRows(variantRows, commonDraft.minStock);

      if (!trimmedName) throw new Error('اسم الصنف الأساسي مطلوب');
      if (!trimmedStyleCode) throw new Error('كود المجموعة / الموديل مطلوب');
      if (!cleanRows.length) throw new Error('أضف صنفًا فرعيًا واحدًا على الأقل');
      if (duplicates.duplicateCombos) throw new Error('يوجد صنف فرعي مكرر داخل نفس المجموعة');
      if (duplicates.duplicateBarcodes) throw new Error('يوجد باركود مكرر داخل نفس المجموعة');
      if (duplicates.duplicateSkus) throw new Error('يوجد كود SKU مكرر داخل نفس المجموعة');

      const sourceById = new Map(groupProducts.map((entry) => [String(entry.id), entry]));
      const payloadRows = cleanRows.map((row) => {
        const source = row.id ? sourceById.get(String(row.id)) : undefined;
        if (row.id && !source) throw new Error('صنف فرعي غير موجود في المجموعة');
        return { ...buildPayload({ ...commonDraft, name: trimmedName, styleCode: trimmedStyleCode }, row, source, toCommonDraft(seedProduct, groupProducts).defaultLocationId), id: source ? Number(source.id) : undefined };
      });
      await productsApi.saveFashionGroup(styleCode, {
        rows: payloadRows,
        consolidateStock: Boolean(consolidateStockOnSave),
        zeroRemovedStock: Boolean(zeroRemovedStockOnSave),
      });
      return cleanRows;
    },
    onSuccess: async () => {
      setConsolidateStockOnSave(false);
      setZeroRemovedStockOnSave(false);
      lastHydratedRef.current = null;
      await invalidateCatalogDomain(queryClient, { includeProducts: true });
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsPage(`variant-group:${styleCode || product.id}`) });
      // Do not download the entire retailer catalog after editing one model.
      const refreshed = await productsApi.listAll({ q: commonDraft.styleCode.trim() });
      const selected = refreshed.products.find((entry) => String(entry.id) === String(product.id))
        || refreshed.products.find((entry) => String(entry.styleCode || '').trim() === commonDraft.styleCode.trim()) || null;
      if (selected) onSaved?.(selected);
    },
  });

  async function handleGenerateStyleCode() {
    try {
      const { styleCode: nextCode } = await productsApi.allocateStyleCode();
      setGenerationError('');
      setCommonDraft((current) => ({ ...current, styleCode: nextCode }));
      setBarcodePrefix(nextCode);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'تعذر توليد كود الموديل');
    }
  }

  function updateRow(index: number, patch: Partial<VariantDraft>) {
    setVariantRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addVariantRow() {
    setVariantRows((current) => [...current, {
      color: '',
      size: '',
      sku: '',
      barcode: '',
      useCustomPricing: false,
      pricingEditorOpen: false,
      costPrice: Number(commonDraft.costPrice || 0),
      retailPrice: Number(commonDraft.retailPrice || 0),
      wholesalePrice: Number(commonDraft.wholesalePrice || 0),
      stock: 0,
      minStock: Number(commonDraft.minStock || 0),
    }]);
  }

  async function smartSyncFromTokens() {
    const colors = splitFashionTokens(colorsValue);
    const sizes = splitFashionTokens(sizesValue);
    if (!colors.length && !sizes.length) {
      toast.warning('يرجى كتابة أو تحديد لون أو مقاس واحد على الأقل في الحقول أعلاه');
      return;
    }

    const normColors = colors.length ? colors : [''];
    const normSizes = sizes.length ? sizes : [''];

    type TargetCombo = { color: string; size: string; key: string };
    const targetCombos: TargetCombo[] = [];
    for (const c of normColors) {
      for (const s of normSizes) {
        if (!c.trim() && !s.trim()) continue;
        targetCombos.push({
          color: c.trim(),
          size: s.trim(),
          key: `${normalizeArabicSearchKey(c)}::${normalizeArabicSearchKey(s)}`,
        });
      }
    }

    if (!targetCombos.length) return;

    const consumedRowIndices = new Set<number>();
    const nextRows: VariantDraft[] = [];

    // 1. First pass: Exact matches (both color and size match)
    for (const target of targetCombos) {
      const exactIndex = variantRows.findIndex(
        (row, idx) => !consumedRowIndices.has(idx) && `${normalizeArabicSearchKey(row.color)}::${normalizeArabicSearchKey(row.size)}` === target.key,
      );
      if (exactIndex !== -1) {
        consumedRowIndices.add(exactIndex);
        nextRows.push({
          ...variantRows[exactIndex],
          color: target.color,
          size: target.size,
        });
      }
    }

    // 2. Second pass: Fuzzy / Transition matches
    // (e.g. user cleared sizes so target is { color: 'ابيض', size: '' }, or modified sizes)
    for (const target of targetCombos) {
      const alreadyMatched = nextRows.some(
        (r) => `${normalizeArabicSearchKey(r.color)}::${normalizeArabicSearchKey(r.size)}` === target.key,
      );
      if (alreadyMatched) continue;

      // Find an existing unconsumed row that shares the same color (or same size)
      // Prioritize rows with stock > 0 first, then rows with database ID
      let bestCandidateIndex = -1;
      let bestScore = -1;

      variantRows.forEach((row, idx) => {
        if (consumedRowIndices.has(idx)) return;
        const sameColor = Boolean(target.color && normalizeArabicSearchKey(row.color) === normalizeArabicSearchKey(target.color));
        const sameSize = Boolean(target.size && normalizeArabicSearchKey(row.size) === normalizeArabicSearchKey(target.size));
        if (sameColor || sameSize) {
          const stock = Number(row.stock || 0);
          const hasId = row.id ? 1000 : 0;
          const score = hasId + stock * 10;
          if (score > bestScore) {
            bestScore = score;
            bestCandidateIndex = idx;
          }
        }
      });

      if (bestCandidateIndex !== -1) {
        consumedRowIndices.add(bestCandidateIndex);
        const matchedRow = variantRows[bestCandidateIndex];
        nextRows.push({
          ...matchedRow,
          color: target.color,
          size: target.size,
        });
      } else {
        nextRows.push({
          color: target.color,
          size: target.size,
          sku: '',
          barcode: '',
          useCustomPricing: false,
          pricingEditorOpen: false,
          costPrice: Number(commonDraft.costPrice || 0),
          retailPrice: Number(commonDraft.retailPrice || 0),
          wholesalePrice: Number(commonDraft.wholesalePrice || 0),
          stock: 0,
          minStock: Number(commonDraft.minStock || 0),
        });
      }
    }

    // 3. Third pass: Check any unconsumed rows that have actual stock > 0
    const unconsumedWithStock: VariantDraft[] = [];
    variantRows.forEach((row, idx) => {
      if (!consumedRowIndices.has(idx) && Number(row.stock || 0) > 0) {
        unconsumedWithStock.push(row);
      }
    });

    if (unconsumedWithStock.length > 0) {
      const sameColorConsolidatable: VariantDraft[] = [];
      const orphanColorRows: VariantDraft[] = [];

      unconsumedWithStock.forEach((row) => {
        const hasMatchingColor = nextRows.some((r) => 
          normalizeArabicSearchKey(r.color) === normalizeArabicSearchKey(row.color)
        );
        if (hasMatchingColor) {
          sameColorConsolidatable.push(row);
        } else {
          orphanColorRows.push(row);
        }
      });

      if (sameColorConsolidatable.length > 0) {
        const totalStockToConsolidate = sameColorConsolidatable.reduce((sum, r) => sum + Number(r.stock || 0), 0);
        const confirmConsolidate = await systemConfirm({
          title: 'دمج رصيد المقاسات لنفس الألوان',
          message: `يوجد ${sameColorConsolidatable.length} مقاساً تم إلغاؤها تحتوي على رصيد مخزني (إجمالي ${totalStockToConsolidate} قطعة).\n\nالنظام يتيح لك دمج كميات هذه المقاسات وإضافتها لرصيد نفس اللون المقابل حصرياً (مثل دمج مقاسات الأبيض في صنف الأبيض المتبقي).\n\n- تأكيد ودمج الرصيد: سيقوم بدمج الكميات في نفس ألوانها فقط.\n- إلغاء: سيبقي عليها في الجدول للمراجعة اليدوية.`,
          confirmText: 'تأكيد ودمج الرصيد لنفس اللون',
          cancelText: 'إلغاء ومراجعة يدوية',
        });

        if (confirmConsolidate) {
          sameColorConsolidatable.forEach((unconsumed) => {
            const matchingTarget = nextRows.find((r) => normalizeArabicSearchKey(r.color) === normalizeArabicSearchKey(unconsumed.color));
            if (matchingTarget) {
              matchingTarget.stock = Number(matchingTarget.stock || 0) + Number(unconsumed.stock || 0);
            }
          });
          setConsolidateStockOnSave(true);
        } else {
          sameColorConsolidatable.forEach((r) => nextRows.push(r));
        }
      }

      if (orphanColorRows.length > 0) {
        // Keep orphan colors with stock in nextRows - NEVER merge across different colors!
        orphanColorRows.forEach((r) => nextRows.push(r));
        const orphanColorsList = orphanColorRows.map((r) => r.color || 'صنف فرعي').join('، ');
        const orphanStock = orphanColorRows.reduce((sum, r) => sum + Number(r.stock || 0), 0);
        toast.warning(`تم الإبقاء على أصناف الألوان المحذوفة (${orphanColorsList}) في الجدول لوجود رصيد مخزني لها (${orphanStock} قطعة). يُمنع منعاً باتاً نقل رصيد صنف إلى لون آخر.`);
      } else if (sameColorConsolidatable.length > 0) {
        toast.info(`تم تجهيز دمج المقاسات (${nextRows.length} صنف متبقي). اضغط حفظ المجموعة لاعتماد الحركة المخزنية`);
      }

      setVariantRows(nextRows);
      return;
    }

    setVariantRows(nextRows);
    toast.success('تم تحديث شبكة الفروع وتطهير المقاسات غير المحددة بنجاح');
  }

  function pruneZeroStockRows() {
    const zeroRows = variantRows.filter((r) => Number(r.stock || 0) === 0);
    if (!zeroRows.length) {
      toast.info('لا توجد أصناف فرعية برصيد صفري في الجدول');
      return;
    }
    if (variantRows.length - zeroRows.length < 1) {
      toast.warning('يجب أن يتبقى صنف فرعي واحد على الأقل في المجموعة');
      return;
    }
    setVariantRows((current) => current.filter((r) => Number(r.stock || 0) > 0));
    toast.success(`تم حذف ${zeroRows.length} صنف فرعي برصيد صفري بنجاح`);
  }

  function generateFromTokens() {
    const colors = splitFashionTokens(colorsValue);
    const sizes = splitFashionTokens(sizesValue);
    if (!colors.length && !sizes.length) return;

    const existingMap = new Map(variantRows.map((row) => [`${normalizeArabicSearchKey(row.color)}::${normalizeArabicSearchKey(row.size)}`, row]));
    // Generate additions only. Dropping existing rows here used to archive valid sizes on save.
    const nextRows: VariantDraft[] = [...variantRows];

    const normColors = colors.length ? colors : [''];
    const normSizes = sizes.length ? sizes : [''];

    let addedCount = 0;
    for (const c of normColors) {
      for (const s of normSizes) {
        if (!c.trim() && !s.trim()) continue;
        const key = `${normalizeArabicSearchKey(c)}::${normalizeArabicSearchKey(s)}`;
        const existing = existingMap.get(key);
        if (!existing) {
          nextRows.push({
            color: c,
            size: s,
            sku: '',
            barcode: '',
            useCustomPricing: false,
            pricingEditorOpen: false,
            costPrice: Number(commonDraft.costPrice || 0),
            retailPrice: Number(commonDraft.retailPrice || 0),
            wholesalePrice: Number(commonDraft.wholesalePrice || 0),
            stock: 0,
            minStock: Number(commonDraft.minStock || 0),
          });
          addedCount++;
        }
      }
    }

    setVariantRows(nextRows);
    if (addedCount > 0) {
      toast.success(`تمت إضافة ${addedCount} صنف فرعي جديد بنجاح`);
    } else {
      toast.info('كافة الفروع المدخلة موجودة بالفعل في الجدول');
    }
  }

  function generateSequentialBarcodes() {
    const prefix = (barcodePrefix || commonDraft.styleCode).trim();
    if (!prefix) return;
    setVariantRows((current) => {
      const used = new Set(current.map((row) => row.barcode.trim().toLowerCase()).filter(Boolean));
      return current.map((row, index) => {
        if (row.barcode.trim()) return row;
        let sequence = index + 1;
        let candidate = `${prefix}-${String(sequence).padStart(3, '0')}`;
        while (used.has(candidate.toLowerCase())) {
          sequence++;
          candidate = `${prefix}-${String(sequence).padStart(3, '0')}`;
        }
        used.add(candidate.toLowerCase());
        return { ...row, barcode: candidate };
      });
    });
  }

  function generateSequentialSkus() {
    const prefix = (barcodePrefix || commonDraft.styleCode || 'VAR').trim();
    setVariantRows((current) => {
      const used = new Set(current.map((row) => (row.sku || '').trim().toLowerCase()).filter(Boolean));
      return current.map((row, index) => {
        if (row.sku?.trim()) return row;
        const colorPart = (row.color || '').trim().replace(/\s+/g, '-');
        const sizePart = (row.size || '').trim().replace(/\s+/g, '-');
        const base = [prefix, colorPart, sizePart].filter(Boolean).join('-') || `${prefix}-${String(index + 1).padStart(3, '0')}`;
        let candidate = base;
        let seq = index + 1;
        while (used.has(candidate.toLowerCase())) {
          candidate = `${base}-${String(seq).padStart(2, '0')}`;
          seq++;
        }
        used.add(candidate.toLowerCase());
        return { ...row, sku: candidate };
      });
    });
  }

  function clearAllBarcodes() {
    setVariantRows((current) => current.map((row) => ({ ...row, barcode: '' })));
  }

  function toggleVariantPricing(index: number) {
    setVariantRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) {
        return { ...row, pricingEditorOpen: false };
      }
      if (!row.useCustomPricing) {
        return {
          ...row,
          useCustomPricing: true,
          pricingEditorOpen: true,
          costPrice: Number(row.costPrice || commonDraft.costPrice || 0),
          retailPrice: Number(row.retailPrice || commonDraft.retailPrice || 0),
          wholesalePrice: Number(row.wholesalePrice || commonDraft.wholesalePrice || 0),
        };
      }
      return {
        ...row,
        pricingEditorOpen: !row.pricingEditorOpen,
      };
    }));
  }

  function disableVariantPricing(index: number) {
    setVariantRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return {
        ...row,
        useCustomPricing: false,
        pricingEditorOpen: false,
        costPrice: Number(commonDraft.costPrice || 0),
        retailPrice: Number(commonDraft.retailPrice || 0),
        wholesalePrice: Number(commonDraft.wholesalePrice || 0),
      };
    }));
  }

  async function removeDraftRow(index: number) {
    const row = variantRows[index];
    if (row?.id && Number(row.stock || 0) > 0) {
      const confirmed = await systemConfirm({
        title: 'تصفير رصيد المقاس وحذفه',
        message: `الصنف الفرعي (${variantLabel(row)}) لديه رصيد حالي (${row.stock} قطعة).\n\nهل ترغب في تصفير رصيده تلقائياً بحركة تسوية مخزنية رسمية عند حفظ المجموعة واعتماد حذفه؟`,
        confirmText: 'نعم، صفّر الرصيد واحذف المقاس',
        cancelText: 'إلغاء',
        variant: 'danger',
      });
      if (!confirmed) return;
      setZeroRemovedStockOnSave(true);
    }
    setVariantRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function handleOpenQuickAdjustment(row: VariantDraft) {
    if (!row.id) return;
    const found = groupProducts.find((p) => String(p.id) === String(row.id));
    if (found) {
      setSelectedProductForAdjustment(found);
    } else {
      const fallbackProd: Product = {
        ...seedProduct,
        id: row.id,
        name: commonDraft.name ? `${commonDraft.name} - ${variantLabel(row)}` : row.color || 'صنف فرعي',
        barcode: row.barcode,
        sku: row.sku,
        color: row.color,
        size: row.size,
        stock: Number(row.stock || 0),
        costPrice: row.costPrice,
        retailPrice: row.retailPrice,
      };
      setSelectedProductForAdjustment(fallbackProd);
    }
  }

  function handleCloseStockAdjustment() {
    const adjustedProductId = selectedProductForAdjustment?.id;
    setSelectedProductForAdjustment(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.productsPage(`variant-group:${styleCode || product.id}`) });
    if (adjustedProductId) {
      queryClient.invalidateQueries({ queryKey: ['product', adjustedProductId] });
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.products });
    queryClient.invalidateQueries({ queryKey: ['location-stocks'] });
    inventoryCatalog.locationStocksQuery.refetch();
    groupQuery.refetch().then((res) => {
      const refreshed = res.data || [];
      if (refreshed.length && adjustedProductId) {
        const found = refreshed.find((p) => String(p.id) === String(adjustedProductId));
        if (found) {
          setVariantRows((current) => current.map((r) => String(r.id) === String(adjustedProductId) ? {
            ...r,
            stock: Number(found.stock || 0),
            originalStock: Number(found.stock || 0),
          } : r));
        }
      }
    });
  }

  async function handleZeroAllStocks() {
    const hasStock = variantRows.some((r) => Number(r.stock || 0) > 0);
    if (!hasStock) return;
    const confirmed = await systemConfirm({
      title: 'تصفير أرصدة كافة المقاسات',
      message: 'هل أنت متأكد من تصفير أرصدة كافة الأصناف الفرعية المعروضة في الجدول إلى (0)؟\n\nسيتم تسجيل حركات تسوية مخزنية رسمية عند الضغط على "حفظ المجموعة".',
      confirmText: 'نعم، صفّر الأرصدة',
      cancelText: 'تراجع',
      variant: 'warning',
    });
    if (!confirmed) return;
    setVariantRows((current) => current.map((r) => ({ ...r, stock: 0 })));
    toast.success('تم تصفير الأرصدة في الجدول، اضغط على "حفظ المجموعة" لاعتماد التسوية');
  }

  function resetDraft() {
    if (!canNavigateAway()) return;
    setCommonDraft({ ...toCommonDraft(seedProduct), name: deriveBaseName(seedProduct) });
    const initialRows = toVariantRows(groupProducts);
    setVariantRows(initialRows);
    const existingColors = Array.from(new Set(initialRows.map(r => r.color).filter(Boolean)));
    const existingSizes = Array.from(new Set(initialRows.map(r => r.size).filter(Boolean)));
    setColorsValue(existingColors.join('، '));
    setSizesValue(existingSizes.join('، '));
    setBarcodePrefix(seedProduct.styleCode || '');
  }

  return (
    <div className="page-stack" style={{ gap: '0.9rem' }} dir="rtl">
      {generationError && <div role="alert" style={{ color: '#b91c1c' }}>{generationError}</div>}
      {/* 1. Master Product Card */}
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

      {/* 2. Quick Variant Presets & Generator Card */}
      <div className="product-compact-card" style={{ background: '#ffffff', borderColor: '#cbd5e1' }}>
        <div className="page-stack" style={{ gap: 12 }}>
          {/* Header with Template Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
                {t('products.workspace_sections.fashion_group_editor_card.s19', "مُنشئ ومولد المتغيرات السريع")}
              </h4>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{templateConfig.hint}</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={() => setActiveTemplate('scents')}
                disabled={mutation.isPending}
                style={{
                  background: activeTemplate === 'scents' ? '#ffffff' : 'transparent',
                  color: activeTemplate === 'scents' ? '#1e1b4b' : '#475569',
                  fontWeight: 700,
                  border: activeTemplate === 'scents' ? '1px solid #cbd5e1' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  boxShadow: activeTemplate === 'scents' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <ScentDropletIcon size={14} />
                <span>{t('products.workspace_sections.fashion_group_editor_card.s20', "روائح ونكهات")}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('fashion')}
                disabled={mutation.isPending}
                style={{
                  background: activeTemplate === 'fashion' ? '#ffffff' : 'transparent',
                  color: activeTemplate === 'fashion' ? '#1e1b4b' : '#475569',
                  fontWeight: 700,
                  border: activeTemplate === 'fashion' ? '1px solid #cbd5e1' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  boxShadow: activeTemplate === 'fashion' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <FashionShirtIcon size={14} />
                <span>{t('products.workspace_sections.fashion_group_editor_card.s21', "ملابس وأحذية")}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('sizes')}
                disabled={mutation.isPending}
                style={{
                  background: activeTemplate === 'sizes' ? '#ffffff' : 'transparent',
                  color: activeTemplate === 'sizes' ? '#1e1b4b' : '#475569',
                  fontWeight: 700,
                  border: activeTemplate === 'sizes' ? '1px solid #cbd5e1' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  boxShadow: activeTemplate === 'sizes' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <PackageBoxIcon size={14} />
                <span>{t('products.workspace_sections.fashion_group_editor_card.s22', "أحجام وعبوات")}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTemplate('custom')}
                disabled={mutation.isPending}
                style={{
                  background: activeTemplate === 'custom' ? '#ffffff' : 'transparent',
                  color: activeTemplate === 'custom' ? '#1e1b4b' : '#475569',
                  fontWeight: 700,
                  border: activeTemplate === 'custom' ? '1px solid #cbd5e1' : '1px solid transparent',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  boxShadow: activeTemplate === 'custom' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <SlidersConfigIcon size={14} />
                <span>{t('products.workspace_sections.fashion_group_editor_card.s23', "مخصص")}</span>
              </button>
            </div>
          </div>

          {/* Custom Labels Inputs */}
          {activeTemplate === 'custom' && (
            <div className="product-form-grid-2" style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <Field label={t('products.workspace_sections.fashion_group_editor_card.s24', "تسمية الخاصية الأولى (مثال: النوع، اللون، الخامة)")}>
                <input
                  className="purchase-prototype-field-input"
                  value={customPrimaryLabel}
                  onChange={(e) => setCustomPrimaryLabel(normalizeArabicInput(e.target.value))}
                  disabled={mutation.isPending}
                  placeholder={t('products.workspace_sections.fashion_group_editor_card.s25', "الخاصية الأولى")}
                />
              </Field>
              <Field label={t('products.workspace_sections.fashion_group_editor_card.s26', "تسمية الخاصية الثانية (مثال: المقاس، السعة، التغليف)")}>
                <input
                  className="purchase-prototype-field-input"
                  value={customSecondaryLabel}
                  onChange={(e) => setCustomSecondaryLabel(normalizeArabicInput(e.target.value))}
                  disabled={mutation.isPending}
                  placeholder={t('products.workspace_sections.fashion_group_editor_card.s27', "الخاصية الثانية")}
                />
              </Field>
            </div>
          )}

          {/* Generator Inputs: Primary & Secondary Tokens in 2 Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', alignItems: 'start' }}>
            {/* Primary Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <Field label={templateConfig.primaryLabel}>
                <input
                  type="text"
                  className="purchase-prototype-field-input"
                  value={colorsValue}
                  onChange={(event) => setColorsValue(normalizeArabicInput(event.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const trimmed = colorsValue.trim();
                      if (trimmed && !trimmed.endsWith('-') && !trimmed.endsWith('،') && !trimmed.endsWith(',')) {
                        setColorsValue(`${trimmed} - `);
                      }
                    }
                  }}
                  disabled={mutation.isPending}
                  placeholder={templateConfig.primaryPlaceholder}
                  style={{ height: '34px', minHeight: '34px', fontSize: '0.84rem' }}
                />
              </Field>
              {Boolean(templateConfig.primaryPresets.length) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                  {templateConfig.primaryPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setColorsValue(mergeFashionTokens(colorsValue, [preset]))}
                      disabled={mutation.isPending}
                      style={{
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#334155',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        lineHeight: 1.3,
                      }}
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Secondary Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <Field label={templateConfig.secondaryLabel}>
                <input
                  type="text"
                  className="purchase-prototype-field-input"
                  value={sizesValue}
                  onChange={(event) => setSizesValue(normalizeArabicInput(event.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const trimmed = sizesValue.trim();
                      if (trimmed && !trimmed.endsWith('-') && !trimmed.endsWith('،') && !trimmed.endsWith(',')) {
                        setSizesValue(`${trimmed} - `);
                      }
                    }
                  }}
                  disabled={mutation.isPending}
                  placeholder={templateConfig.secondaryPlaceholder}
                  style={{ height: '34px', minHeight: '34px', fontSize: '0.84rem' }}
                />
              </Field>

              {activeTemplate === 'fashion' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                  {FASHION_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSizesValue(mergeFashionTokens(sizesValue, preset.values))}
                      disabled={mutation.isPending}
                      style={{
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#1e1b4b',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        lineHeight: 1.3,
                      }}
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              )}

              {activeTemplate === 'scents' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                  {SCENT_SIZE_PRESETS.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSizesValue(mergeFashionTokens(sizesValue, [val]))}
                      disabled={mutation.isPending}
                      style={{
                        border: '1px solid #bbf7d0',
                        background: '#f0fdf4',
                        color: '#166534',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        lineHeight: 1.3,
                      }}
                    >
                      + {val}
                    </button>
                  ))}
                </div>
              )}

              {activeTemplate === 'sizes' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                  {PACKAGING_PRESETS.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSizesValue(mergeFashionTokens(sizesValue, [val]))}
                      disabled={mutation.isPending}
                      style={{
                        border: '1px solid #fde047',
                        background: '#fefce8',
                        color: '#854d0e',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        lineHeight: 1.3,
                      }}
                    >
                      + {val}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sync Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: '4px', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              type="button"
              variant="primary"
              onClick={smartSyncFromTokens}
              disabled={mutation.isPending || (!colorsValue.trim() && !sizesValue.trim())}
              style={{ fontSize: '0.8rem', padding: '5px 16px', fontWeight: 800, height: '32px' }}
              title={t('products.workspace_sections.fashion_group_editor_card.s28_sync_tip', "تحديث شبكة الأصناف الفرعية بناءً على المدخلات، وتطهير المقاسات غير المحددة، مع نقل وحماية أي صنف له رصيد")}
            >
              {t('products.workspace_sections.fashion_group_editor_card.s28', "توليد وتحديث شبكة الفروع بناءً على القيم أعلاه")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={generateFromTokens}
              disabled={mutation.isPending || (!colorsValue.trim() && !sizesValue.trim())}
              style={{ fontSize: '0.78rem', padding: '5px 12px', fontWeight: 600, height: '32px' }}
              title={t('products.workspace_sections.fashion_group_editor_card.s28_append_tip', "إضافة أي قيم جديدة تم إدخالها مع الإبقاء على كافة الفروع الحالية كما هي دون أي حذف")}
            >
              {t('products.workspace_sections.fashion_group_editor_card.s28_append', "إضافة الفروع الجديدة فقط (دون حذف الحالية)")}
            </Button>
          </div>
        </div>
      </div>

      {/* 3. Child Variants Matrix Card */}
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
              onClick={generateSequentialBarcodes}
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
            <Button
              type="button"
              variant="secondary"
              onClick={clearAllBarcodes}
              disabled={mutation.isPending || !variantRows.length}
              style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
              title={t('products.workspace_sections.fashion_group_editor_card.s33', "مسح كل الباركودات")}
            >
              مسح الباركودات
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={resetDraft}
              disabled={mutation.isPending || !hasDraftChanges}
              style={{ fontSize: '0.74rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
              title={t('products.workspace_sections.fashion_group_editor_card.s34', "إعادة القيم الأصلية")}
            >
              إعادة الأصل
            </Button>
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

      {/* Notices & Alerts */}
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

      {/* Sticky Bottom Footer Action Bar */}
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

      {selectedProductForAdjustment && (
        <QuickStockAdjustmentDialog
          open={Boolean(selectedProductForAdjustment)}
          onClose={handleCloseStockAdjustment}
          product={selectedProductForAdjustment}
          branches={inventoryCatalog.branchesQuery.data || []}
          locations={locations || []}
          locationStocks={Array.isArray(inventoryCatalog.locationStocksQuery.data) ? inventoryCatalog.locationStocksQuery.data : []}
          canManageInventory={true}
        />
      )}
    </div>
  );
}
