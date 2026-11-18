import { buildCode128Svg, normalizeCode128Value, productUnitsWithFallback } from '@/lib/barcode';
import { escapeHtml, printHtmlDocument, resolvePrintSettings } from '@/lib/browser';
import { formatCurrency, formatCurrencyWithCode, formatCurrencyWithSymbol, todayLocalDateKey } from '@/lib/format';
import type { AppSettings, Product, ProductUnit } from '@/types/domain';
import {
  BARCODE_PRINT_PRESETS,
  DEFAULT_BARCODE_PRINT_PRESET_ID,
  DEFAULT_THERMAL_ROTATE_DEG,
  PX_PER_MM,
  SHEET_PRESETS,
  THERMAL_PRESETS,
  getBarcodeLabelNameFontPt,
  getBarcodePrintPreset,
  getBarcodePrintPresetsByFamily,
  getBarcodeSharedLabelCss,
  normalizeRotationDeg,
  sanitizeCustomDimensions,
  type BarcodeCurrencyFormat,
  type BarcodeCustomDimensions,
  type BarcodePrintConfig,
  type BarcodePrintCustomization,
  type BarcodePrintFamily,
  type BarcodePrintItem,
  type BarcodePrintPreset,
  type BarcodeRotationDeg,
} from '@/lib/barcode-labels-presets';

export {
  BARCODE_PRINT_PRESETS,
  DEFAULT_BARCODE_PRINT_PRESET_ID,
  DEFAULT_THERMAL_ROTATE_DEG,
  SHEET_PRESETS,
  THERMAL_PRESETS,
  getBarcodePrintPreset,
  getBarcodePrintPresetsByFamily,
  normalizeRotationDeg,
  sanitizeCustomDimensions,
  type BarcodeCurrencyFormat,
  type BarcodeCustomDimensions,
  type BarcodePrintConfig,
  type BarcodePrintCustomization,
  type BarcodePrintFamily,
  type BarcodePrintItem,
  type BarcodePrintPreset,
  type BarcodeRotationDeg,
};

export function resolveBarcodeUnit(product: Product, requestedUnit?: ProductUnit | null) {
  const units = productUnitsWithFallback(product);
  return requestedUnit || units.find((unit) => unit.isBaseUnit) || units[0];
}

export function formatLabelPriceText(amount: number, currencyFormat: BarcodeCurrencyFormat = 'code'): string {
  if (currencyFormat === 'none') return formatCurrency(amount);
  if (currencyFormat === 'symbol') return formatCurrencyWithSymbol(amount);
  return formatCurrencyWithCode(amount);
}

export function getBarcodeCardData(
  product: Product,
  unit?: ProductUnit | null,
  currencyFormat: BarcodeCurrencyFormat = 'code'
) {
  const effectiveUnit = resolveBarcodeUnit(product, unit);
  const barcode = normalizeCode128Value(effectiveUnit?.barcode || product.barcode);
  const svg = barcode ? buildCode128Svg(barcode) : '';
  const unitFactor = Math.max(1, Number(effectiveUnit?.multiplier || 1));
  return {
    unit: effectiveUnit,
    barcode,
    barcodeSvg: svg,
    unitFactor,
    priceText: formatLabelPriceText(Number(product.retailPrice || 0) * unitFactor, currencyFormat),
  };
}

function resolveLabelProductName(product: Product): string {
  return (
    String(product.name || '').trim() ||
    String(product.nameEn || product.name_en || '').trim() ||
    '-'
  );
}

function formatVariantBadgeText(product: Product): string {
  const color = String(product.color || '').trim();
  const size = String(product.size || '').trim();
  if (color && size) return `${color} / ${size}`;
  return color || size;
}

function stripTrailingVariantSuffix(name: string, product: Product): string {
  const color = String(product.color || '').trim();
  const size = String(product.size || '').trim();
  const candidates = [
    color && size ? `${color} / ${size}` : '',
    color && size ? `${color}/${size}` : '',
    color && size ? `${color} - ${size}` : '',
    color,
    size,
  ].filter(Boolean);
  for (const candidate of candidates) {
    for (const sep of [' - ', ' – ', ' | ', '-']) {
      const suffix = `${sep}${candidate}`;
      if (name.endsWith(suffix) && name.length > suffix.length + 1) {
        return name.slice(0, name.length - suffix.length).trim();
      }
    }
  }
  return name;
}

export function buildSingleLabelHtml(
  product: Product,
  unit: ProductUnit | null | undefined,
  preset: BarcodePrintPreset,
  compact = false,
  customization?: BarcodePrintCustomization
) {
  const currencyFormat = customization?.currencyFormat || 'code';
  const card = getBarcodeCardData(product, unit, currencyFormat);
  const rawProductName = resolveLabelProductName(product);
  const variantText = formatVariantBadgeText(product);
  const showVariant = customization?.showVariant ?? true;
  const productName = showVariant && variantText
    ? stripTrailingVariantSuffix(rawProductName, product)
    : rawProductName;
  const nameFontPt = getBarcodeLabelNameFontPt(productName, preset);
  const showStoreName = customization?.showStoreName ?? true;
  const storeName = (customization?.storeName || '').trim();
  const showProductName = customization?.showProductName ?? true;
  const showPrice = customization?.showPrice ?? true;
  const showUnit = customization?.showUnit ?? true;
  const showBarcodeText = customization?.showBarcodeText ?? true;
  const showSku = customization?.showSku ?? false;
  const skuText = String(product.sku || product.styleCode || '').trim();
  const variantColor = String(product.color || '').trim();
  const variantSize = String(product.size || '').trim();
  const variantParts: string[] = [];
  if (variantColor) variantParts.push(`<span>${escapeHtml(variantColor)}</span>`);
  if (variantSize) variantParts.push(`<span dir="ltr">${escapeHtml(variantSize)}</span>`);
  const variantRowHtml = showVariant && variantParts.length > 0
    ? `<div class="barcode-label-variant-row"><span class="barcode-label-variant-badge">${variantParts.join('<span style="opacity:0.45;">·</span>')}</span></div>`
    : '';

  const showFoodStatement = customization?.showFoodStatement ?? false;

  // Food statement & dates (بطاقة بيان السلع الغذائية والمعبأة وفق القرارات التموينية)
  const showProductionDate = customization?.showProductionDate ?? false;
  const productionDate = (customization?.productionDate || '').trim();
  const packagingDate = (customization?.packagingDate || '').trim() || todayLocalDateKey();
  const expiryText = customization?.expiryType === 'date' && customization?.expiryDate
    ? `انتهاء: ${customization.expiryDate}`
    : `صلاحية: ${customization?.expiryPeriodMonths || 6} شهر`;

  const dateItems: string[] = [];
  if (showProductionDate && productionDate) {
    dateItems.push(`<span>إنتاج: <strong>${escapeHtml(productionDate)}</strong></span>`);
  }
  if (packagingDate) {
    dateItems.push(`<span>تعبئة: <strong>${escapeHtml(packagingDate)}</strong></span>`);
  }
  if (expiryText) {
    dateItems.push(`<span>${escapeHtml(expiryText)}</span>`);
  }
  const foodDatesHtml = dateItems.join(' · ');
  const storageNote = (customization?.foodStatementNote || '').trim();
  const foodInlineHtml = [
    ...dateItems,
    ...(storageNote ? [`<span class="barcode-label-storage-note">${escapeHtml(storageNote)}</span>`] : []),
  ].join(' · ');
  const effectiveNameFontPt = showFoodStatement && preset.labelHeightMm <= 32
    ? Math.max(5.0, nameFontPt - 1.2)
    : nameFontPt;

  // Net Weight calculation (الوزن الصافي الرسمي)
  const showNetWeight = customization?.showNetWeight ?? false;
  const unitBadgeText = showNetWeight
    ? (customization?.netWeightText ? `صافي: ${escapeHtml(customization.netWeightText)}` : `صافي: ${escapeHtml(card.unit?.name || '1 كجم')}`)
    : escapeHtml(card.unit?.name || '');

  // Layout 1: Regulatory Shelf Edge Label (استيكر الرف التمويني بأسعار بارزة وواضحة جداً)
  if (preset.isShelfLabel) {
    return `
      <div class="barcode-label-card barcode-label-shelf ${compact ? 'compact' : ''} ${showFoodStatement ? 'has-food-statement' : ''}">
        <div class="barcode-label-header">
          ${showStoreName && storeName ? `<div class="barcode-label-store">${escapeHtml(storeName)}</div>` : ''}
          ${showProductName ? `<div class="barcode-label-name barcode-shelf-product-name" title="${escapeHtml(productName)}">${escapeHtml(productName)}</div>` : ''}
          ${variantRowHtml}
        </div>

        <div class="barcode-shelf-main-content">
          <div class="barcode-shelf-price-column">
            ${showPrice ? `
              <div class="barcode-shelf-price-badge">
                <span class="barcode-shelf-price-amount">${escapeHtml(card.priceText)}</span>
                <span class="barcode-shelf-tax-note">شامل الضريبة المضافة</span>
              </div>
            ` : ''}
            ${showUnit && card.unit?.name ? `<div class="barcode-shelf-unit-line">لكل ${escapeHtml(card.unit.name)}</div>` : ''}
          </div>

          <div class="barcode-shelf-code-column">
            <div class="barcode-label-svg">
              ${card.barcodeSvg || '<div class="barcode-label-missing">بدون باركود</div>'}
            </div>
            ${showBarcodeText ? `<div class="barcode-label-text">${escapeHtml(card.barcode || '—')}</div>` : ''}
            ${showSku && skuText ? `<div class="barcode-label-sku">${escapeHtml(skuText)}</div>` : ''}
          </div>
        </div>

        ${showFoodStatement ? `
          <div class="barcode-label-food-statement">
            <div class="barcode-label-food-dates">${foodInlineHtml || foodDatesHtml}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Layout 2: Standard Barcode / Packaging Sticker
  return `
    <div class="barcode-label-card ${compact ? 'compact' : ''} ${showFoodStatement ? 'has-food-statement' : ''}">
      <div class="barcode-label-header">
        ${showStoreName && storeName ? `<div class="barcode-label-store">${escapeHtml(storeName)}</div>` : ''}
        ${showProductName ? `<div class="barcode-label-name" style="font-size:${effectiveNameFontPt.toFixed(2)}pt" title="${escapeHtml(productName)}">${escapeHtml(productName)}</div>` : ''}
        ${variantRowHtml}
      </div>

      <div class="barcode-label-body">
        <div class="barcode-label-svg">
          ${card.barcodeSvg || '<div class="barcode-label-missing">بدون باركود</div>'}
        </div>
        ${showBarcodeText ? `<div class="barcode-label-text">${escapeHtml(card.barcode || '—')}</div>` : ''}
      </div>

      ${showFoodStatement ? `
        <div class="barcode-label-food-statement">
          <div class="barcode-label-food-dates">${foodInlineHtml || foodDatesHtml}</div>
        </div>
      ` : ''}

      ${(showPrice || (showUnit && card.unit?.name) || (showSku && skuText)) ? `
        <div class="barcode-label-bottom-row">
          <div class="barcode-label-meta-tags">
            ${showUnit && card.unit?.name ? `<span class="barcode-label-unit-badge">${unitBadgeText}</span>` : ''}
            ${showSku && skuText ? `<span class="barcode-label-sku">${escapeHtml(skuText)}</span>` : ''}
          </div>
          ${showPrice ? `<div class="barcode-label-price">${escapeHtml(card.priceText)}</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function wrapScaledLabelForPreview(labelHtml: string, preset: BarcodePrintPreset, targetWidthPx: number) {
  const naturalW = preset.labelWidthMm * PX_PER_MM;
  const naturalH = preset.labelHeightMm * PX_PER_MM;
  const scale = Math.min(2.4, Math.max(0.9, targetWidthPx / naturalW));
  const scaledW = Math.round(naturalW * scale);
  const scaledH = Math.round(naturalH * scale);

  return `
    <div style="position:relative;width:${scaledW}px;height:${scaledH}px;flex-shrink:0;overflow:hidden;border-radius:6px;box-shadow:0 4px 14px rgba(15,23,42,0.08);background:#ffffff;direction:ltr;">
      <div style="position:absolute;top:0;left:0;transform:scale(${scale.toFixed(4)});transform-origin:top left;">
        ${labelHtml}
      </div>
    </div>
  `;
}

export function buildBarcodePreviewHtml(options: {
  product: Product;
  unit?: ProductUnit | null;
  presetId: string;
  labelsPerPage?: number;
  customization?: BarcodePrintCustomization;
  startOffset?: number;
  previewMode?: 'single' | 'sheet';
  items?: BarcodePrintItem[];
  customDimensions?: BarcodeCustomDimensions;
  rotate90?: boolean;
  rotateDeg?: BarcodeRotationDeg;
}) {
  const preset = getBarcodePrintPreset(options.presetId, options.customDimensions);
  const isThermal = preset.family === 'thermal';
  const startOffset = Math.max(1, options.startOffset || 1);
  const customization = options.customization;
  const activeProduct = options.product;
  const activeUnit = options.unit;
  const rotateDeg = normalizeRotationDeg(options);

  const sharedCss = `<style>${getBarcodeSharedLabelCss(preset, '.barcode-preview-scope', true)}</style>`;
  const rotationBadge = rotateDeg !== 0
    ? `<div class="barcode-preview-badge-item"><span class="barcode-preview-badge-label">اتجاه الطباعة</span><span class="barcode-preview-badge-value">مدوّر ${rotateDeg}°</span></div>`
    : '';

  if (isThermal && options.previewMode === 'single') {
    const labelHtml = buildSingleLabelHtml(activeProduct, activeUnit, preset, false, customization);
    return `
      <div class="barcode-preview-scope barcode-preview-single-wrapper">
        ${sharedCss}
        ${wrapScaledLabelForPreview(labelHtml, preset, 290)}
        <div class="barcode-preview-single-badge">
          <div class="barcode-preview-badge-item">
            <span class="barcode-preview-badge-label">أبعاد الملصق الفعلي</span>
            <span class="barcode-preview-badge-value">${preset.labelWidthMm} × ${preset.labelHeightMm} مم</span>
          </div>
          <div class="barcode-preview-badge-item">
            <span class="barcode-preview-badge-label">نوع الورق</span>
            <span class="barcode-preview-badge-value">${preset.isShelfLabel ? 'استيكر رف تمويني' : 'رول حراري (مطابق 1:1)'}</span>
          </div>
          ${rotationBadge}
        </div>
      </div>
    `;
  }

  // Multi-item / sheet preview (or thermal roll reel)
  const perPage = preset.family === 'sheet'
    ? Math.max(1, Math.min(Number(options.labelsPerPage || preset.maxLabelsPerPage), preset.maxLabelsPerPage))
    : Math.min(5, Math.max(3, Number(options.labelsPerPage || 5)));

  const emptyCount = preset.family === 'sheet' && startOffset > 1 ? Math.min(startOffset - 1, perPage - 1) : 0;
  const labelsToRender = Math.max(1, perPage - emptyCount);

  const emptyItems = Array.from({ length: emptyCount }, (_, i) => `
    <div class="barcode-label-card barcode-label-card-empty">
      <span>مفرغ ${i + 1}</span>
    </div>
  `).join('');

  let labelEntries: Array<{ product: Product; unit?: ProductUnit | null }> = [];
  if (options.items && options.items.length > 1) {
    const activeBatchItems = options.items.filter((it) => Math.max(0, Number(it.copies ?? 1)) > 0);
    const previewSource = activeBatchItems.length > 0 ? activeBatchItems : [options.items[0]];
    for (const it of previewSource) {
      const itCopies = Math.max(1, Number(it.copies ?? 1));
      for (let c = 0; c < itCopies && labelEntries.length < labelsToRender; c++) {
        labelEntries.push({ product: it.product, unit: it.unit });
      }
      if (labelEntries.length >= labelsToRender) break;
    }
    while (labelEntries.length < labelsToRender) {
      labelEntries.push({ product: activeProduct, unit: activeUnit });
    }
    labelEntries = labelEntries.slice(0, labelsToRender);
  } else {
    labelEntries = Array.from({ length: labelsToRender }, () => ({ product: activeProduct, unit: activeUnit }));
  }

  if (isThermal) {
    const reelItemsHtml = labelEntries
      .map((entry) => wrapScaledLabelForPreview(buildSingleLabelHtml(entry.product, entry.unit, preset, false, customization), preset, 250))
      .join('');
    return `
      <div class="barcode-preview-scope" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;">
        ${sharedCss}
        <div class="barcode-preview-sheet barcode-preview-sheet-thermal">
          ${reelItemsHtml}
        </div>
      </div>
    `;
  }

  // A4 Sheet WYSIWYG Preview scaled proportionally to fit preview container (~436px wide)
  const labelItemsHtml = labelEntries
    .map((entry) => buildSingleLabelHtml(entry.product, entry.unit, preset, false, customization))
    .join('');

  const sheetNaturalW = 210 * PX_PER_MM;
  const sheetNaturalH = 297 * PX_PER_MM;
  const sheetScale = 436 / sheetNaturalW;
  const sheetScaledW = Math.round(sheetNaturalW * sheetScale);
  const sheetScaledH = Math.round(sheetNaturalH * sheetScale);

  return `
    <div class="barcode-preview-scope" style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;">
      ${sharedCss}
      <div style="position:relative;width:${sheetScaledW}px;height:${sheetScaledH}px;overflow:hidden;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;box-shadow:0 4px 14px rgba(15,23,42,0.06);direction:ltr;">
        <div style="position:absolute;top:0;left:0;width:210mm;height:297mm;padding:${preset.marginMm}mm;box-sizing:border-box;transform:scale(${sheetScale.toFixed(4)});transform-origin:top left;direction:rtl;">
          <div style="display:grid;grid-template-columns:repeat(${preset.columns},${preset.labelWidthMm}mm);grid-auto-rows:${preset.labelHeightMm}mm;gap:${preset.gapMm}mm;justify-content:center;align-content:start;">
            ${emptyItems}
            ${labelItemsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

export interface BarcodePrintDispatchOptions {
  settings?: Partial<AppSettings> | null;
  deviceName?: string;
}

export function printBatchBarcodeLabels(
  items: BarcodePrintItem[],
  config: BarcodePrintConfig,
  customization?: BarcodePrintCustomization,
  dispatchOptions?: BarcodePrintDispatchOptions
) {
  const printableItems = items
    .map((item) => ({
      ...item,
      copies: item.copies === undefined || item.copies === null ? 1 : Math.max(0, Number(item.copies || 0)),
    }))
    .filter((item) => item.copies > 0);
  if (!printableItems.length) return;
  const preset = getBarcodePrintPreset(config.presetId || DEFAULT_BARCODE_PRINT_PRESET_ID, config.customDimensions);
  const isThermal = preset.family === 'thermal';
  const startOffset = Math.max(1, Number(config.startOffset || 1));
  const rotateDeg = isThermal ? normalizeRotationDeg(config) : 0;
  const swapsAxes = rotateDeg === 90 || rotateDeg === 270;

  const rawPageW = preset.pageWidthMm || preset.labelWidthMm;
  const rawPageH = preset.labelHeightMm;
  const effectivePageW = swapsAxes ? rawPageH : rawPageW;
  const effectivePageH = swapsAxes ? rawPageW : rawPageH;

  let pageHtml = '';

  if (isThermal) {
    // Thermal roll printing: Each copy is an independent label page sized strictly to prevent extra blank feeds
    const pages: string[] = [];
    printableItems.forEach((item) => {
      for (let i = 0; i < item.copies; i++) {
        pages.push(`
          <section class="barcode-print-page barcode-print-page-thermal">
            <div class="barcode-print-thermal-stage ${rotateDeg ? `is-rotated-${rotateDeg}` : ''}">
              ${buildSingleLabelHtml(item.product, item.unit, preset, true, customization)}
            </div>
          </section>
        `);
      }
    });
    pageHtml = pages.join('');
  } else {
    // A4 sticker sheet printing: Slot offset applies to the first sheet
    const perPage = Math.max(1, Math.min(Number(config.labelsPerPage || preset.maxLabelsPerPage), preset.maxLabelsPerPage));
    const emptyCountFirstPage = Math.min(startOffset - 1, perPage - 1);
    const capacityFirstPage = perPage - emptyCountFirstPage;

    const flattened: Array<{ product: Product; unit?: ProductUnit | null }> = [];
    printableItems.forEach((item) => {
      for (let i = 0; i < item.copies; i++) {
        flattened.push({ product: item.product, unit: item.unit });
      }
    });

    const pages: string[] = [];
    let currentIndex = 0;

    // Page 1
    const countOnFirstPage = Math.min(flattened.length, capacityFirstPage);
    const emptySlots = Array.from({ length: emptyCountFirstPage }, () =>
      '<div class="barcode-label-card barcode-label-card-empty"></div>'
    ).join('');
    const labelsFirstPage = flattened.slice(0, countOnFirstPage).map((it) =>
      buildSingleLabelHtml(it.product, it.unit, preset, false, customization)
    ).join('');

    pages.push(`
      <section class="barcode-print-page barcode-print-page-sheet">
        <div class="barcode-print-grid barcode-print-grid-sheet">
          ${emptySlots}
          ${labelsFirstPage}
        </div>
      </section>
    `);
    currentIndex += countOnFirstPage;

    // Subsequent pages
    while (currentIndex < flattened.length) {
      const nextBatch = flattened.slice(currentIndex, currentIndex + perPage);
      const labels = nextBatch.map((it) =>
        buildSingleLabelHtml(it.product, it.unit, preset, false, customization)
      ).join('');
      pages.push(`
        <section class="barcode-print-page barcode-print-page-sheet">
          <div class="barcode-print-grid barcode-print-grid-sheet">
            ${labels}
          </div>
        </section>
      `);
      currentIndex += perPage;
    }

    pageHtml = pages.join('');
  }

  const resolvedPrint = resolvePrintSettings();
  const barcodePrinterName = String(
    dispatchOptions?.deviceName ||
    resolvedPrint.electronBarcodePrinter ||
    dispatchOptions?.settings?.posElectronBarcodePrinter ||
    ''
  ).trim();
  const barcodeBridgePrinter = String(
    resolvedPrint.windowsBarcodePrinter ||
    dispatchOptions?.settings?.posWindowsBarcodePrinterName ||
    ''
  ).trim();

  printHtmlDocument('ملصقات الباركود والرف', pageHtml, {
    subtitle: `${preset.pageLabel} · ${preset.label}`,
    pageSize: isThermal ? 'auto' : 'A4',
    pageSizeMm: isThermal
      ? { widthMm: effectivePageW, heightMm: effectivePageH }
      : undefined,
    pageMarginMm: 0,
    orientation: 'portrait',
    deviceName: barcodePrinterName || undefined,
    windowsPrinterName: barcodeBridgePrinter || undefined,
    disableWindowsBridge: !barcodeBridgePrinter,
    hideHeader: true,
    extraStyles: `
      .print-header{display:none!important;}
      .print-shell{padding:0!important;margin:0!important;max-width:100%!important;width:100%!important;}
      .print-content{gap:0!important;margin:0!important;padding:0!important;display:block!important;}
      .barcode-print-page{box-sizing:border-box;margin:0;padding:0;}
      .barcode-print-page-thermal{
        position:relative;
        display:block;
        width:calc(${effectivePageW}mm - 0.25mm);
        height:calc(${effectivePageH}mm - 0.25mm);
        max-width:${effectivePageW}mm;
        max-height:${effectivePageH}mm;
        margin:0;
        padding:0;
        overflow:hidden;
        page-break-after:always;
        break-after:page;
        page-break-inside:avoid;
        break-inside:avoid;
      }
      .barcode-print-page-thermal:last-child{
        page-break-after:avoid!important;
        break-after:avoid!important;
      }
      .barcode-print-thermal-stage{
        position:relative;
        display:block;
        width:${Math.max(10, rawPageW - 0.4).toFixed(1)}mm;
        height:${Math.max(10, rawPageH - 0.4).toFixed(1)}mm;
        margin:0.075mm auto 0;
        page-break-inside:avoid;
        break-inside:avoid;
      }
      .barcode-print-thermal-stage.is-rotated-180{
        transform:rotate(180deg);
        transform-origin:center center;
      }
      .barcode-print-thermal-stage.is-rotated-90,
      .barcode-print-thermal-stage.is-rotated-270{
        width:100%;
        height:100%;
        margin:0;
      }
      .barcode-print-thermal-stage.is-rotated-90 .barcode-label-card,
      .barcode-print-thermal-stage.is-rotated-270 .barcode-label-card{
        position:absolute;
        top:50%;
        left:50%;
        transform-origin:center center;
      }
      .barcode-print-thermal-stage.is-rotated-90 .barcode-label-card{transform:translate(-50%,-50%) rotate(90deg);}
      .barcode-print-thermal-stage.is-rotated-270 .barcode-label-card{transform:translate(-50%,-50%) rotate(270deg);}
      .barcode-print-page-sheet{
        width:210mm;
        height:296mm;
        padding:${preset.marginMm}mm;
        overflow:hidden;
        page-break-after:always;
        break-after:page;
      }
      .barcode-print-page-sheet:last-child{
        page-break-after:avoid!important;
        break-after:avoid!important;
      }
      .barcode-print-grid-sheet{
        display:grid;
        grid-template-columns:repeat(${preset.columns},${preset.labelWidthMm}mm);
        grid-auto-rows:${preset.labelHeightMm}mm;
        gap:${preset.gapMm}mm;
        justify-content:center;
        align-content:start;
        width:100%;
        box-sizing:border-box;
      }
      ${getBarcodeSharedLabelCss(preset, '', false)}
      @media print {
        .barcode-label-card{border:none!important;}
      }
    `,
  });
}

export function printProductBarcodeLabels(
  product: Product,
  unit: ProductUnit | null | undefined,
  config: BarcodePrintConfig,
  customization?: BarcodePrintCustomization,
  dispatchOptions?: BarcodePrintDispatchOptions
) {
  return printBatchBarcodeLabels(
    [{ product, unit, copies: Math.max(1, Number(config.copies || 1)) }],
    config,
    customization,
    dispatchOptions
  );
}
