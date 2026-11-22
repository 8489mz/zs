import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import { productsApi } from '@/features/products/api/products.api';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { useInventoryActionCatalog } from '@/features/inventory';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import type { Category, Product, Supplier, Location } from '@/types/domain';
import {
  applySequentialVariantBarcodes,
  buildGroupSaveRows,
  buildPayload,
  countLegacyHyphenVariantBarcodes,
  deriveBaseName,
  duplicateSummary,
  rowsFingerprint,
  toCommonDraft,
  toVariantRows,
  variantLabel,
  type CommonDraft,
  type VariantDraft
} from '@/features/products/components/workspace-sections/FashionGroupEditorCard.helpers';
import { splitFashionTokens } from '@/features/products/components/fashion-variants.utils';
import { type VariantTemplateType, FASHION_COLOR_PRESETS, SCENT_FLAVOR_PRESETS, SIZE_CAPACITY_PRESETS } from './fashion-group-editor/fashion-group-data';
import { MasterProductCard } from './fashion-group-editor/master-product-card';
import { VariantGeneratorCard } from './fashion-group-editor/variant-generator-card';
import { VariantsMatrixCard } from './fashion-group-editor/variants-matrix-card';
import { NoticesAlerts } from './fashion-group-editor/notices-alerts';
import { StickyFooterBar } from './fashion-group-editor/sticky-footer-bar';
import { StockAdjustmentDialog } from './fashion-group-editor/stock-adjustment-dialog';


interface FashionGroupEditorCardProps {
  product: Product;
  categories: Category[];
  suppliers: Supplier[];
  locations: Location[];
  onSaved?: (product: Product) => void;
}

export function FashionGroupEditorCard({ product, categories, suppliers, locations, onSaved }: FashionGroupEditorCardProps) {
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

  async function generateSequentialBarcodes() {
    const prefix = (barcodePrefix || commonDraft.styleCode).trim();
    if (!prefix) return;
    const legacyHyphenCount = countLegacyHyphenVariantBarcodes(variantRows);
    let replaceLegacyHyphens = false;
    if (legacyHyphenCount > 0) {
      replaceLegacyHyphens = await systemConfirm({
        title: 'تحديث الباركودات القديمة',
        message: `يوجد ${legacyHyphenCount} باركود قديم به شرطة (-).\nاستبدالهم بأرقام مدمجة بدون شرطة؟`,
        confirmText: 'استبدال الكل',
        cancelText: 'للفارغ فقط',
      });
    }
    setVariantRows((current) => applySequentialVariantBarcodes(current, prefix, { replaceLegacyHyphens }));
    if (replaceLegacyHyphens) {
      toast.success(`تم تحديث ${legacyHyphenCount} باركود — اضغط حفظ المجموعة للاعتماد`);
    }
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
      <MasterProductCard variantRows={variantRows} commonDraft={commonDraft} setCommonDraft={setCommonDraft} mutation={mutation} setBarcodePrefix={setBarcodePrefix} handleGenerateStyleCode={handleGenerateStyleCode} setVariantRows={setVariantRows} categories={categories} suppliers={suppliers} locations={locations} />

      {/* 2. Quick Variant Presets & Generator Card */}
      <VariantGeneratorCard templateConfig={templateConfig} setActiveTemplate={setActiveTemplate} mutation={mutation} activeTemplate={activeTemplate} customPrimaryLabel={customPrimaryLabel} setCustomPrimaryLabel={setCustomPrimaryLabel} customSecondaryLabel={customSecondaryLabel} setCustomSecondaryLabel={setCustomSecondaryLabel} colorsValue={colorsValue} setColorsValue={setColorsValue} sizesValue={sizesValue} setSizesValue={setSizesValue} smartSyncFromTokens={smartSyncFromTokens} generateFromTokens={generateFromTokens} />

      {/* 3. Child Variants Matrix Card */}
      <VariantsMatrixCard addVariantRow={addVariantRow} mutation={mutation} pruneZeroStockRows={pruneZeroStockRows} variantRows={variantRows} handleZeroAllStocks={handleZeroAllStocks} generateSequentialBarcodes={generateSequentialBarcodes} commonDraft={commonDraft} generateSequentialSkus={generateSequentialSkus} clearAllBarcodes={clearAllBarcodes} groupProducts={groupProducts} hasDraftChanges={hasDraftChanges} resetDraft={resetDraft} totalStock={totalStock} primaryLabel={primaryLabel} secondaryLabel={secondaryLabel} updateRow={updateRow} handleOpenQuickAdjustment={handleOpenQuickAdjustment} toggleVariantPricing={toggleVariantPricing} removeDraftRow={removeDraftRow} disableVariantPricing={disableVariantPricing} />

      {/* Notices & Alerts */}
      <NoticesAlerts hasDraftChanges={hasDraftChanges} mutation={mutation} incompleteRows={incompleteRows} duplicates={duplicates} />

      {/* Sticky Bottom Footer Action Bar */}
      <StickyFooterBar variantRows={variantRows} totalStock={totalStock} resetDraft={resetDraft} mutation={mutation} hasDraftChanges={hasDraftChanges} groupProducts={groupProducts} duplicates={duplicates} />

      {selectedProductForAdjustment && (
        <StockAdjustmentDialog selectedProductForAdjustment={selectedProductForAdjustment} handleCloseStockAdjustment={handleCloseStockAdjustment} inventoryCatalog={inventoryCatalog} locations={locations} />
      )}
    </div>
  );
}
