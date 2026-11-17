import { buildCode128Svg, normalizeCode128Value, productUnitsWithFallback } from '@/lib/barcode';
import { escapeHtml, printHtmlDocument, resolvePrintSettings } from '@/lib/browser';
import { formatCurrency } from '@/lib/format';
import type { AppSettings, Product, ProductUnit } from '@/types/domain';

export type BarcodePrintFamily = 'sheet' | 'thermal';

export interface BarcodePrintPreset {
  id: string;
  family: BarcodePrintFamily;
  label: string;
  pageLabel: string;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  gapMm: number;
  marginMm: number;
  pageWidthMm?: number;
  pageHeightMm?: number;
  maxLabelsPerPage: number;
  isShelfLabel?: boolean;
}

export interface BarcodePrintCustomization {
  showStoreName?: boolean;
  storeName?: string;
  showProductName?: boolean;
  showPrice?: boolean;
  showUnit?: boolean;
  showBarcodeText?: boolean;
  showSku?: boolean;
  // متطلبات التموين وحماية المستهلك (بطاقة بيان السلع الغذائية والمعبأة)
  showFoodStatement?: boolean;
  showProductionDate?: boolean;
  productionDate?: string;
  packagingDate?: string;
  expiryType?: 'period' | 'date';
  expiryPeriodMonths?: number;
  expiryDate?: string;
  foodStatementNote?: string;
  showNetWeight?: boolean;
  netWeightText?: string;
}

export interface BarcodePrintItem {
  product: Product;
  unit?: ProductUnit | null;
  copies: number;
}

export interface BarcodePrintConfig {
  presetId: string;
  copies: number;
  labelsPerPage: number;
  startOffset?: number;
}

const SHEET_PRESETS: BarcodePrintPreset[] = [
  { id: 'a4-24', family: 'sheet', label: 'A4 / 24 ملصق (63.5×33.9 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 63.5, labelHeightMm: 33.9, columns: 3, rows: 8, gapMm: 2.5, marginMm: 8, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 24 },
  { id: 'a4-40', family: 'sheet', label: 'A4 / 40 ملصق (48×25.4 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 48, labelHeightMm: 25.4, columns: 4, rows: 10, gapMm: 2, marginMm: 7, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 40 },
  { id: 'a4-48', family: 'sheet', label: 'A4 / 48 ملصق (45.7×21.2 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 45.7, labelHeightMm: 21.2, columns: 4, rows: 12, gapMm: 2, marginMm: 7, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 48 },
  { id: 'a4-65', family: 'sheet', label: 'A4 / 65 ملصق (38.1×21.2 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 38.1, labelHeightMm: 21.2, columns: 5, rows: 13, gapMm: 2, marginMm: 6, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 65 },
  { id: 'a4-100', family: 'sheet', label: 'A4 / 100 ملصق (38.1×19.1 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 38.1, labelHeightMm: 19.1, columns: 5, rows: 20, gapMm: 1.5, marginMm: 6, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 100 },
];

const THERMAL_PRESETS: BarcodePrintPreset[] = [
  { id: 'thermal-38x25', family: 'thermal', label: '38×25 مم (Xprinter / Zebra)', pageLabel: 'رول حراري', labelWidthMm: 38, labelHeightMm: 25, columns: 1, rows: 1, gapMm: 2, marginMm: 1.5, pageWidthMm: 38, maxLabelsPerPage: 1 },
  { id: 'thermal-40x30', family: 'thermal', label: '40×30 مم (سوبرماركت قياسي)', pageLabel: 'رول حراري', labelWidthMm: 40, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 40, maxLabelsPerPage: 1 },
  { id: 'thermal-50x25', family: 'thermal', label: '50×25 مم (مقاس عريض)', pageLabel: 'رول حراري', labelWidthMm: 50, labelHeightMm: 25, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-50x30', family: 'thermal', label: '50×30 مم (ملابس وتجزئة)', pageLabel: 'رول حراري', labelWidthMm: 50, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-food-50x40', family: 'thermal', label: '50×40 مم (بطاقة بيان تعبئة وتموين)', pageLabel: 'رول تعبئة وتموين', labelWidthMm: 50, labelHeightMm: 40, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-shelf-60x30', family: 'thermal', label: '60×30 مم (استيكر الرف التمويني - قرار 330)', pageLabel: 'استيكر الرف التمويني', labelWidthMm: 60, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 60, maxLabelsPerPage: 1, isShelfLabel: true },
  { id: 'thermal-shelf-70x35', family: 'thermal', label: '70×35 مم (استيكر رف سوبرماركت كبير)', pageLabel: 'استيكر الرف التمويني', labelWidthMm: 70, labelHeightMm: 35, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 70, maxLabelsPerPage: 1, isShelfLabel: true },
  { id: 'thermal-60x40', family: 'thermal', label: '60×40 مم (شحن ومستودعات)', pageLabel: 'رول حراري', labelWidthMm: 60, labelHeightMm: 40, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 60, maxLabelsPerPage: 1 },
  { id: 'thermal-58-roll', family: 'thermal', label: '58 مم (رول مستمر)', pageLabel: 'رول مستمر', labelWidthMm: 54, labelHeightMm: 35, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 58, maxLabelsPerPage: 1 },
  { id: 'thermal-80-roll', family: 'thermal', label: '80 مم (رول مستمر)', pageLabel: 'رول مستمر', labelWidthMm: 76, labelHeightMm: 45, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 80, maxLabelsPerPage: 1 },
];

export const BARCODE_PRINT_PRESETS = [...SHEET_PRESETS, ...THERMAL_PRESETS];
export const DEFAULT_BARCODE_PRINT_PRESET_ID = 'thermal-40x30';

export function getBarcodePrintPreset(presetId: string) {
  return BARCODE_PRINT_PRESETS.find((preset) => preset.id === presetId) || BARCODE_PRINT_PRESETS[0];
}

export function getBarcodePrintPresetsByFamily(family: BarcodePrintFamily) {
  return BARCODE_PRINT_PRESETS.filter((preset) => preset.family === family);
}

export function resolveBarcodeUnit(product: Product, requestedUnit?: ProductUnit | null) {
  const units = productUnitsWithFallback(product);
  return requestedUnit || units.find((unit) => unit.isBaseUnit) || units[0];
}

function getBarcodeLabelNameFontSize(productName: string, preset: BarcodePrintPreset, compact = false) {
  const length = Array.from(String(productName || '')).length;
  const isThermal = preset.family === 'thermal';
  const base = isThermal
    ? (compact ? (preset.labelHeightMm <= 25 ? 9.5 : preset.labelWidthMm <= 40 ? 10.5 : 11.5) : 13)
    : (compact || preset.maxLabelsPerPage >= 65 ? 8.2 : preset.maxLabelsPerPage >= 48 ? 9 : 10.5);
  const widthPenalty = Math.max(0, length - Math.floor(preset.labelWidthMm / 2.6)) * 0.18;
  const heightPenalty = preset.labelHeightMm <= 25 ? 1.2 : preset.labelHeightMm <= 30 ? 0.6 : 0;
  return Math.max(7, Math.min(base, base - widthPenalty - heightPenalty));
}

export function getBarcodeCardData(product: Product, unit?: ProductUnit | null) {
  const effectiveUnit = resolveBarcodeUnit(product, unit);
  const barcode = normalizeCode128Value(effectiveUnit?.barcode || product.barcode);
  const svg = barcode ? buildCode128Svg(barcode) : '';
  const unitFactor = Math.max(1, Number(effectiveUnit?.multiplier || 1));
  return {
    unit: effectiveUnit,
    barcode,
    barcodeSvg: svg,
    unitFactor,
    priceText: formatCurrency(Number(product.retailPrice || 0) * unitFactor),
  };
}

export function buildSingleLabelHtml(
  product: Product,
  unit: ProductUnit | null | undefined,
  preset: BarcodePrintPreset,
  compact = false,
  customization?: BarcodePrintCustomization
) {
  const card = getBarcodeCardData(product, unit);
  const productName = String(product.name || '-').trim() || '-';
  const nameFontSize = getBarcodeLabelNameFontSize(productName, preset, compact);
  const showStoreName = customization?.showStoreName ?? true;
  const storeName = (customization?.storeName || '').trim();
  const showProductName = customization?.showProductName ?? true;
  const showPrice = customization?.showPrice ?? true;
  const showUnit = customization?.showUnit ?? true;
  const showBarcodeText = customization?.showBarcodeText ?? true;
  const showSku = customization?.showSku ?? false;
  const skuText = String(product.sku || product.styleCode || '').trim();

  // Barcode height scaled proportionally (~35-44% of label height to leave ample room for text while maximizing scan accuracy)
  const isShelf = preset.isShelfLabel;
  const showFoodStatement = customization?.showFoodStatement ?? false;
  const isSmallHeight = preset.labelHeightMm <= 25;
  const isMediumHeight = preset.labelHeightMm <= 30;

  const svgHeightMm = isShelf
    ? Math.max(7, Math.min(13, preset.labelHeightMm * 0.32))
    : showFoodStatement
    ? Math.max(6.5, Math.min(11, preset.labelHeightMm * 0.32))
    : isSmallHeight
    ? Math.max(7.5, Math.min(9.5, preset.labelHeightMm * 0.36))
    : isMediumHeight
    ? Math.max(9, Math.min(12, preset.labelHeightMm * 0.40))
    : Math.max(10, Math.min(15, preset.labelHeightMm * 0.44));

  // Food statement & dates (بطاقة بيان السلع الغذائية والمعبأة وفق القرارات التموينية)
  const showProductionDate = customization?.showProductionDate ?? false;
  const productionDate = (customization?.productionDate || '').trim();
  const packagingDate = (customization?.packagingDate || '').trim() || new Date().toISOString().slice(0, 10);
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
          ${showProductName ? `<div class="barcode-label-name barcode-shelf-product-name" style="font-size:${(nameFontSize + 1.2).toFixed(1)}px" title="${escapeHtml(productName)}">${escapeHtml(productName)}</div>` : ''}
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
            <div class="barcode-label-svg" style="height:${svgHeightMm.toFixed(1)}mm;">
              ${card.barcodeSvg || '<div class="barcode-label-missing">بدون باركود</div>'}
            </div>
            ${showBarcodeText ? `<div class="barcode-label-text">${escapeHtml(card.barcode || '—')}</div>` : ''}
            ${showSku && skuText ? `<div class="barcode-label-sku">${escapeHtml(skuText)}</div>` : ''}
          </div>
        </div>

        ${showFoodStatement ? `
          <div class="barcode-label-food-statement">
            <div class="barcode-label-food-dates">${foodDatesHtml}</div>
            ${storageNote ? `<div class="barcode-label-storage-note">${escapeHtml(storageNote)}</div>` : ''}
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
        ${showProductName ? `<div class="barcode-label-name" style="font-size:${nameFontSize.toFixed(1)}px" title="${escapeHtml(productName)}">${escapeHtml(productName)}</div>` : ''}
      </div>

      <div class="barcode-label-body">
        <div class="barcode-label-svg" style="height:${svgHeightMm.toFixed(1)}mm;">
          ${card.barcodeSvg || '<div class="barcode-label-missing">بدون باركود</div>'}
        </div>
        ${showBarcodeText ? `<div class="barcode-label-text">${escapeHtml(card.barcode || '—')}</div>` : ''}
      </div>

      ${showFoodStatement ? `
        <div class="barcode-label-food-statement">
          <div class="barcode-label-food-dates">${foodDatesHtml}</div>
          ${storageNote ? `<div class="barcode-label-storage-note">${escapeHtml(storageNote)}</div>` : ''}
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

export function buildBarcodePreviewHtml(options: {
  product: Product;
  unit?: ProductUnit | null;
  presetId: string;
  labelsPerPage?: number;
  customization?: BarcodePrintCustomization;
  startOffset?: number;
  previewMode?: 'single' | 'sheet';
  items?: BarcodePrintItem[];
}) {
  const preset = getBarcodePrintPreset(options.presetId);
  const isThermal = preset.family === 'thermal';
  const startOffset = Math.max(1, options.startOffset || 1);
  const customization = options.customization;
  const activeProduct = options.product;
  const activeUnit = options.unit;

  const previewWidth = 290;
  const aspectRatio = preset.labelHeightMm / preset.labelWidthMm;
  const previewHeight = Math.max(140, Math.min(240, Math.round(previewWidth * aspectRatio)));

  if (isThermal && options.previewMode === 'single') {
    return `
      <div class="barcode-preview-single-wrapper">
        <div class="barcode-preview-single-card" style="width:${previewWidth}px;min-height:${previewHeight}px;height:${previewHeight}px;">
          ${buildSingleLabelHtml(activeProduct, activeUnit, preset, false, customization)}
        </div>
        <div class="barcode-preview-single-badge">
          <span>أبعاد الملصق الفعلي: <strong>${preset.labelWidthMm} × ${preset.labelHeightMm} مم</strong></span>
          <span style="opacity:0.4;">|</span>
          <span>${preset.isShelfLabel ? 'استيكر رف تمويني' : 'ورق رول حراري مستمر (Die-cut)'}</span>
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

  // If multiple items provided, sequence them in the preview
  let labelItems = '';
  if (options.items && options.items.length > 1) {
    const flattened: Array<{ product: Product; unit?: ProductUnit | null }> = [];
    for (const it of options.items) {
      const itCopies = Math.max(1, Number(it.copies || 1));
      for (let c = 0; c < itCopies && flattened.length < labelsToRender; c++) {
        flattened.push({ product: it.product, unit: it.unit });
      }
      if (flattened.length >= labelsToRender) break;
    }
    while (flattened.length < labelsToRender) {
      flattened.push({ product: activeProduct, unit: activeUnit });
    }
    labelItems = flattened
      .slice(0, labelsToRender)
      .map((it) => isThermal
        ? `<div class="barcode-preview-thermal-item" style="width:${previewWidth}px;height:${previewHeight}px;min-height:${previewHeight}px;">${buildSingleLabelHtml(it.product, it.unit, preset, false, customization)}</div>`
        : buildSingleLabelHtml(it.product, it.unit, preset, false, customization)
      )
      .join('');
  } else {
    labelItems = Array.from({ length: labelsToRender }, () =>
      isThermal
        ? `<div class="barcode-preview-thermal-item" style="width:${previewWidth}px;height:${previewHeight}px;min-height:${previewHeight}px;">${buildSingleLabelHtml(activeProduct, activeUnit, preset, false, customization)}</div>`
        : buildSingleLabelHtml(activeProduct, activeUnit, preset, false, customization)
    ).join('');
  }

  if (isThermal) {
    return `
      <div class="barcode-preview-sheet barcode-preview-sheet-thermal">
        ${labelItems}
      </div>
    `;
  }

  return `
    <div class="barcode-preview-sheet barcode-preview-sheet-${preset.family}" style="padding:${preset.marginMm}mm;gap:${preset.gapMm}mm;grid-template-columns:repeat(${preset.columns}, minmax(0, 1fr));">
      ${emptyItems}
      ${labelItems}
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
  if (!items.length) return;
  const preset = getBarcodePrintPreset(config.presetId || DEFAULT_BARCODE_PRINT_PRESET_ID);
  const isThermal = preset.family === 'thermal';
  const startOffset = Math.max(1, Number(config.startOffset || 1));

  let pageHtml = '';

  if (isThermal) {
    // Thermal roll printing: Each copy of each item is an independent page
    const pages: string[] = [];
    items.forEach((item) => {
      const copies = Math.max(1, Number(item.copies || 1));
      for (let i = 0; i < copies; i++) {
        pages.push(`
          <section class="barcode-print-page barcode-print-page-thermal page-break">
            <div class="barcode-print-grid barcode-print-grid-thermal" style="padding:${preset.marginMm}mm;">
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

    // Flatten all items by copies
    const flattened: Array<{ product: Product; unit?: ProductUnit | null }> = [];
    items.forEach((item) => {
      const copies = Math.max(1, Number(item.copies || 1));
      for (let i = 0; i < copies; i++) {
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
      <section class="barcode-print-page">
        <div class="barcode-print-grid barcode-print-grid-sheet" style="padding:${preset.marginMm}mm;gap:${preset.gapMm}mm;grid-template-columns:repeat(${preset.columns}, minmax(0, 1fr));">
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
        <section class="barcode-print-page">
          <div class="barcode-print-grid barcode-print-grid-sheet" style="padding:${preset.marginMm}mm;gap:${preset.gapMm}mm;grid-template-columns:repeat(${preset.columns}, minmax(0, 1fr));">
            ${labels}
          </div>
        </section>
      `);
      currentIndex += perPage;
    }

    pageHtml = pages.join('');
  }

  const thermalPageRule = isThermal
    ? `@page { size: ${preset.pageWidthMm || preset.labelWidthMm}mm ${preset.labelHeightMm}mm; margin: 0; }`
    : `@page { size: A4 portrait; margin: 0; }`;

  const barcodePrinterName = String(
    dispatchOptions?.deviceName ||
    dispatchOptions?.settings?.posElectronBarcodePrinter ||
    resolvePrintSettings().electronBarcodePrinter ||
    ''
  ).trim();

  printHtmlDocument('ملصقات الباركود والرف', pageHtml, {
    subtitle: `${preset.pageLabel} · ${preset.label}`,
    pageSize: isThermal ? 'auto' : 'A4',
    pageSizeMm: isThermal
      ? { widthMm: preset.pageWidthMm || preset.labelWidthMm, heightMm: preset.labelHeightMm }
      : undefined,
    orientation: 'portrait',
    deviceName: barcodePrinterName || undefined,
    hideHeader: true,
    extraStyles: `
      ${thermalPageRule}
      .print-header{display:none!important;}
      .print-shell{padding:0!important;margin:0!important;max-width:100%!important;}
      .print-content{gap:0!important;margin:0!important;padding:0!important;}
      .barcode-print-page{width:100%;box-sizing:border-box;}
      .barcode-print-page.page-break{page-break-after:always;break-after:page;}
      .barcode-print-page-thermal{width:${preset.labelWidthMm}mm;height:${preset.labelHeightMm}mm;max-width:${preset.labelWidthMm}mm;max-height:${preset.labelHeightMm}mm;overflow:hidden;page-break-after:always;break-after:page;margin:0;padding:0;box-sizing:border-box;}
      .barcode-print-page-thermal:last-child{page-break-after:avoid;break-after:avoid;}
      .barcode-print-grid{display:grid;align-items:stretch;width:100%;box-sizing:border-box;}
      .barcode-print-grid-thermal{height:100%!important;max-height:100%!important;width:100%!important;display:flex;flex-direction:column;box-sizing:border-box;}
      .barcode-print-grid-thermal .barcode-label-card{height:100%!important;min-height:0!important;max-height:100%!important;width:100%!important;border:none!important;border-radius:0!important;padding:0.3mm 0.6mm!important;box-sizing:border-box!important;}
      .barcode-label-card{border:1px dashed #94a3b8;border-radius:6px;padding:1.4mm 2mm;text-align:center;display:flex;flex-direction:column;justify-content:space-between;min-height:${preset.labelHeightMm}mm;height:${preset.labelHeightMm}mm;background:#fff;overflow:hidden;box-sizing:border-box;}
      .barcode-label-card.compact{padding:1.2mm 1.6mm;}
      .barcode-label-card.barcode-label-card-empty{visibility:hidden!important;border:none!important;background:transparent!important;}
      .barcode-label-header{width:100%;margin-bottom:0.4mm;}
      .barcode-label-store{font-size:7.5px;font-weight:700;color:#334155;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;margin-bottom:0.2mm;}
      .barcode-label-name{font-weight:900;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;direction:rtl;color:#000;}
      .barcode-label-body{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;flex:0 0 auto;margin:0.2mm 0;}
      .barcode-label-svg{display:flex;align-items:center;justify-content:center;width:100%;max-width:100%;overflow:hidden;}
      .barcode-label-svg svg{width:100%;height:100%;max-width:100%;max-height:100%;display:block;}
      .barcode-label-text{font-size:${isThermal ? (preset.labelHeightMm <= 25 ? '8.2px' : '9px') : (preset.maxLabelsPerPage >= 65 ? 8.2 : preset.maxLabelsPerPage >= 48 ? 8.8 : 9.5)}px;font-weight:800;direction:ltr;letter-spacing:.3px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:clip;margin-top:0.2mm;color:#000;}
      .barcode-label-bottom-row{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:0.3mm;padding-top:0.3mm;border-top:0.5px dotted #94a3b8;}
      .barcode-label-meta-tags{display:flex;align-items:center;gap:1.5mm;}
      .barcode-label-unit-badge{font-size:7.8px;font-weight:800;color:#000;background:#fff;border:0.5px solid #000;border-radius:2px;padding:0.2mm 1mm;line-height:1.1;}
      .barcode-label-sku{font-size:7px;color:#334155;font-weight:600;}
      .barcode-label-price{font-size:${isThermal ? (preset.labelHeightMm <= 25 ? '10.5px' : '12px') : (preset.maxLabelsPerPage >= 65 ? 8.6 : preset.maxLabelsPerPage >= 48 ? 9.2 : 10.5)}px;font-weight:900;color:#000;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-inline-start:auto;}
      .barcode-label-missing{font-size:9px;color:#b91c1c;display:flex;align-items:center;justify-content:center;height:100%;}
      
      /* Food Statement - بطاقة بيان التموين: خلفية بيضاء نقية بنسبة 100% بدون أي رمادي وإطار أسود ناصع للطباعة الحرارية */
      .barcode-label-food-statement{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.3mm;font-size:${isThermal ? '8.6px' : '7.8px'};font-weight:700;color:#000;background:#fff;border:0.6px solid #000;border-radius:2px;padding:0.4mm 1mm;margin:0.4mm 0;line-height:1.15;direction:rtl;}
      .barcode-label-food-dates{display:flex;align-items:center;justify-content:center;gap:1.5mm;width:100%;color:#000;font-size:${isThermal ? '8.8px' : '7.8px'};}
      .barcode-label-food-dates span{color:#000;}
      .barcode-label-food-dates span strong{font-weight:900;color:#000;}
      .barcode-label-storage-note{font-size:${isThermal ? '7.5px' : '6.8px'};font-weight:800;color:#000;line-height:1.1;text-align:center;}
      
      /* Regulatory Shelf Label Styling - استيكر الرف التمويني */
      .barcode-label-shelf{display:flex;flex-direction:column;justify-content:space-between;text-align:start;}
      .barcode-shelf-product-name{font-size:11px!important;font-weight:900!important;color:#000!important;white-space:normal!important;line-height:1.2!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
      .barcode-shelf-main-content{display:grid;grid-template-columns:1.2fr 1fr;gap:2mm;align-items:center;flex:1;min-height:0;margin:1mm 0;}
      .barcode-shelf-price-column{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;}
      .barcode-shelf-price-badge{display:flex;flex-direction:column;align-items:flex-start;}
      .barcode-shelf-price-amount{font-size:16px;font-weight:900;color:#000;line-height:1;}
      .barcode-shelf-tax-note{font-size:7px;font-weight:700;color:#334155;margin-top:0.4mm;}
      .barcode-shelf-unit-line{font-size:7.5px;font-weight:700;color:#475569;margin-top:0.5mm;}
      .barcode-shelf-code-column{display:flex;flex-direction:column;align-items:center;justify-content:center;}

      @media print {
        .barcode-label-card{border:none;}
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
