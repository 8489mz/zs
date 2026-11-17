import type { Product, ProductUnit } from '@/types/domain';

export type BarcodePrintFamily = 'sheet' | 'thermal';
export type BarcodeRotationDeg = 0 | 90 | 180 | 270;
export type BarcodeCurrencyFormat = 'symbol' | 'code' | 'none';

export interface BarcodeCustomDimensions {
  widthMm?: number;
  heightMm?: number;
}

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
  isCustom?: boolean;
}

export interface BarcodePrintCustomization {
  showStoreName?: boolean;
  storeName?: string;
  showProductName?: boolean;
  showPrice?: boolean;
  currencyFormat?: BarcodeCurrencyFormat;
  showUnit?: boolean;
  showBarcodeText?: boolean;
  showSku?: boolean;
  showVariant?: boolean;
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
  customDimensions?: BarcodeCustomDimensions;
  rotate90?: boolean;
  rotateDeg?: BarcodeRotationDeg;
}

// All A4 presets are verified to fit strictly within 210mm x 297mm including margins and gaps.
export const SHEET_PRESETS: BarcodePrintPreset[] = [
  { id: 'a4-24', family: 'sheet', label: 'A4 / 24 ملصق (63.5×33.9 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 63.5, labelHeightMm: 33.9, columns: 3, rows: 8, gapMm: 1.5, marginMm: 6, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 24 },
  { id: 'a4-40', family: 'sheet', label: 'A4 / 40 ملصق (48×25.4 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 48, labelHeightMm: 25.4, columns: 4, rows: 10, gapMm: 2, marginMm: 5, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 40 },
  { id: 'a4-48', family: 'sheet', label: 'A4 / 48 ملصق (45.7×21.2 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 45.7, labelHeightMm: 21.2, columns: 4, rows: 12, gapMm: 2, marginMm: 6, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 48 },
  { id: 'a4-65', family: 'sheet', label: 'A4 / 65 ملصق (38.1×21.2 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 38.1, labelHeightMm: 21.2, columns: 5, rows: 13, gapMm: 0.8, marginMm: 5, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 65 },
  { id: 'a4-100', family: 'sheet', label: 'A4 / 100 ملصق (38.1×13.5 مم)', pageLabel: 'ورق A4 لاصق', labelWidthMm: 38.1, labelHeightMm: 13.5, columns: 5, rows: 20, gapMm: 0.8, marginMm: 5, pageWidthMm: 210, pageHeightMm: 297, maxLabelsPerPage: 100 },
];

export const THERMAL_PRESETS: BarcodePrintPreset[] = [
  { id: 'thermal-35x22', family: 'thermal', label: '35×22 مم (باركود صغير / صيدليات)', pageLabel: 'رول حراري', labelWidthMm: 35, labelHeightMm: 22, columns: 1, rows: 1, gapMm: 2, marginMm: 1, pageWidthMm: 35, maxLabelsPerPage: 1 },
  { id: 'thermal-38x25', family: 'thermal', label: '38×25 مم (Xprinter / Zebra)', pageLabel: 'رول حراري', labelWidthMm: 38, labelHeightMm: 25, columns: 1, rows: 1, gapMm: 2, marginMm: 1, pageWidthMm: 38, maxLabelsPerPage: 1 },
  { id: 'thermal-40x25', family: 'thermal', label: '40×25 مم (شائع للمحلات والسوبرماركت)', pageLabel: 'رول حراري', labelWidthMm: 40, labelHeightMm: 25, columns: 1, rows: 1, gapMm: 2, marginMm: 1, pageWidthMm: 40, maxLabelsPerPage: 1 },
  { id: 'thermal-40x30', family: 'thermal', label: '40×30 مم (سوبرماركت قياسي)', pageLabel: 'رول حراري', labelWidthMm: 40, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 1.2, pageWidthMm: 40, maxLabelsPerPage: 1 },
  { id: 'thermal-50x25', family: 'thermal', label: '50×25 مم (مقاس عريض)', pageLabel: 'رول حراري', labelWidthMm: 50, labelHeightMm: 25, columns: 1, rows: 1, gapMm: 2, marginMm: 1.2, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-50x30', family: 'thermal', label: '50×30 مم (ملابس وتجزئة)', pageLabel: 'رول حراري', labelWidthMm: 50, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 1.5, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-food-50x40', family: 'thermal', label: '50×40 مم (بطاقة بيان تعبئة وتموين)', pageLabel: 'رول تعبئة وتموين', labelWidthMm: 50, labelHeightMm: 40, columns: 1, rows: 1, gapMm: 2, marginMm: 1.5, pageWidthMm: 50, maxLabelsPerPage: 1 },
  { id: 'thermal-shelf-60x30', family: 'thermal', label: '60×30 مم (استيكر الرف التمويني - قرار 330)', pageLabel: 'استيكر الرف التمويني', labelWidthMm: 60, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 1.5, pageWidthMm: 60, maxLabelsPerPage: 1, isShelfLabel: true },
  { id: 'thermal-shelf-70x35', family: 'thermal', label: '70×35 مم (استيكر رف سوبرماركت كبير)', pageLabel: 'استيكر الرف التمويني', labelWidthMm: 70, labelHeightMm: 35, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 70, maxLabelsPerPage: 1, isShelfLabel: true },
  { id: 'thermal-60x40', family: 'thermal', label: '60×40 مم (شحن ومستودعات)', pageLabel: 'رول حراري', labelWidthMm: 60, labelHeightMm: 40, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 60, maxLabelsPerPage: 1 },
  { id: 'thermal-58-roll', family: 'thermal', label: '58×35 مم (رول مستمر 58 مم)', pageLabel: 'رول مستمر', labelWidthMm: 58, labelHeightMm: 35, columns: 1, rows: 1, gapMm: 2, marginMm: 1.5, pageWidthMm: 58, maxLabelsPerPage: 1 },
  { id: 'thermal-80-roll', family: 'thermal', label: '80×45 مم (رول مستمر 80 مم)', pageLabel: 'رول مستمر', labelWidthMm: 80, labelHeightMm: 45, columns: 1, rows: 1, gapMm: 2, marginMm: 2, pageWidthMm: 80, maxLabelsPerPage: 1 },
  { id: 'thermal-custom', family: 'thermal', label: 'مقاس مخصص (العرض × الارتفاع مم)', pageLabel: 'مقاس مخصص', labelWidthMm: 40, labelHeightMm: 30, columns: 1, rows: 1, gapMm: 2, marginMm: 1.2, pageWidthMm: 40, maxLabelsPerPage: 1, isCustom: true },
];

export const BARCODE_PRINT_PRESETS = [...SHEET_PRESETS, ...THERMAL_PRESETS];
export const DEFAULT_BARCODE_PRINT_PRESET_ID = 'thermal-40x30';
export const DEFAULT_THERMAL_ROTATE_DEG: BarcodeRotationDeg = 180;
export const PX_PER_MM = 96 / 25.4;

export function sanitizeCustomDimensions(dims?: BarcodeCustomDimensions): { widthMm: number; heightMm: number } {
  const rawW = Number(dims?.widthMm);
  const rawH = Number(dims?.heightMm);
  const widthMm = Number.isFinite(rawW) && rawW > 0 ? Math.round(Math.min(120, Math.max(20, rawW)) * 10) / 10 : 40;
  const heightMm = Number.isFinite(rawH) && rawH > 0 ? Math.round(Math.min(150, Math.max(15, rawH)) * 10) / 10 : 30;
  return { widthMm, heightMm };
}

export function normalizeRotationDeg(config?: { rotateDeg?: number; rotate90?: boolean }): BarcodeRotationDeg {
  if (config?.rotateDeg === 90 || config?.rotateDeg === 180 || config?.rotateDeg === 270) {
    return config.rotateDeg;
  }
  if (config?.rotate90) return 90;
  return 0;
}

export function getBarcodePrintPreset(presetId: string, customDimensions?: BarcodeCustomDimensions): BarcodePrintPreset {
  const found = BARCODE_PRINT_PRESETS.find((preset) => preset.id === presetId) || BARCODE_PRINT_PRESETS[0];
  if (found.id === 'thermal-custom') {
    const dims = sanitizeCustomDimensions(customDimensions);
    return {
      ...found,
      labelWidthMm: dims.widthMm,
      labelHeightMm: dims.heightMm,
      pageWidthMm: dims.widthMm,
      marginMm: dims.heightMm <= 25 ? 1 : 1.3,
      label: `${dims.widthMm}×${dims.heightMm} مم (مقاس مخصص)`,
    };
  }
  return found;
}

export function getBarcodePrintPresetsByFamily(family: BarcodePrintFamily) {
  return BARCODE_PRINT_PRESETS.filter((preset) => preset.family === family);
}

export function getLabelSizingMetrics(preset: BarcodePrintPreset) {
  const w = preset.labelWidthMm;
  const h = preset.labelHeightMm;
  const isThermal = preset.family === 'thermal';
  const isUltraCompact = h <= 16;
  const isCompact = h <= 26 || w <= 38;
  // Thermal die-cut labels: compact outer padding since Code128 SVG embeds its own 10X white quiet zones on both sides.
  const padYmm = isUltraCompact ? 0.5 : isThermal ? (h <= 23 ? 1.2 : h <= 26 ? 1.4 : 1.9) : (isCompact ? 1.1 : 1.5);
  const padXmm = isUltraCompact ? 0.8 : isThermal ? (w <= 36 ? 1.0 : w <= 42 ? 1.2 : 1.6) : (isCompact ? 1.3 : 1.8);
  const storePt = isUltraCompact ? 0 : h <= 23 ? 4.6 : h <= 26 ? 5.0 : h <= 31 ? 5.6 : 6.4;
  const nameBasePt = isUltraCompact ? 5.2 : h <= 23 ? 6.2 : h <= 26 ? 7.0 : h <= 31 ? 8.0 : h <= 36 ? 9.2 : 10.2;
  const barcodeTextPt = isUltraCompact ? 4.6 : h <= 23 ? 5.3 : h <= 26 ? 5.8 : h <= 31 ? 6.5 : 7.5;
  const unitBadgePt = isUltraCompact ? 4.5 : h <= 23 ? 5.0 : h <= 26 ? 5.6 : 6.2;
  const variantPt = isUltraCompact ? 4.8 : h <= 23 ? 5.4 : h <= 26 ? 6.0 : h <= 31 ? 6.6 : 7.6;
  const skuPt = isUltraCompact ? 4.3 : h <= 23 ? 4.6 : h <= 26 ? 5.0 : 5.8;
  const pricePt = isUltraCompact ? 5.8 : h <= 23 ? 6.8 : h <= 26 ? 7.6 : h <= 31 ? 8.4 : 10.0;
  const foodDatesPt = isUltraCompact ? 3.8 : h <= 26 ? 4.2 : h <= 31 ? 4.8 : 5.8;
  const storageNotePt = isUltraCompact ? 3.8 : h <= 26 ? 4.2 : h <= 31 ? 4.6 : 5.4;
  const svgMinMm = isUltraCompact ? 4.2 : h <= 23 ? 5.2 : h <= 26 ? 6.2 : 7.0;
  const svgMaxMm = isUltraCompact ? 6.5 : h <= 23 ? 8.6 : h <= 26 ? 11.2 : h <= 31 ? 12.6 : 16.0;
  const shelfPricePt = w >= 70 ? 15.0 : w >= 60 ? 12.5 : 10.5;
  const shelfNamePt = h >= 35 ? 9.5 : 8.5;

  return {
    w,
    h,
    isUltraCompact,
    isCompact,
    padYmm,
    padXmm,
    storePt,
    nameBasePt,
    barcodeTextPt,
    unitBadgePt,
    variantPt,
    skuPt,
    pricePt,
    foodDatesPt,
    storageNotePt,
    svgMinMm,
    svgMaxMm,
    shelfPricePt,
    shelfNamePt,
  };
}

export function getBarcodeLabelNameFontPt(productName: string, preset: BarcodePrintPreset) {
  const m = getLabelSizingMetrics(preset);
  const length = Array.from(String(productName || '')).length;
  const threshold = Math.max(10, Math.floor(preset.labelWidthMm / 2.4));
  const penalty = Math.max(0, length - threshold) * 0.14;
  return Math.max(m.isUltraCompact ? 4.6 : 5.4, Math.min(m.nameBasePt, m.nameBasePt - penalty));
}

export function getBarcodeSharedLabelCss(preset: BarcodePrintPreset, scopeSelector = '', isPreview = false) {
  const s = scopeSelector ? `${scopeSelector} ` : '';
  const m = getLabelSizingMetrics(preset);
  const allowTwoLineName = m.h >= 34 && !m.isUltraCompact;
  const isThermal = preset.family === 'thermal';
  const cardWidthMm = isThermal && !isPreview ? Math.max(10, m.w - 0.4) : m.w;
  const cardHeightMm = isThermal && !isPreview ? Math.max(10, m.h - 0.4) : m.h;
  const inkSecondary = isThermal && !isPreview ? '#000000' : '#1e293b';
  const dividerColor = isThermal && !isPreview ? '#000000' : '#64748b';
  const svgBleedMm = isThermal && !m.isUltraCompact ? Math.max(0, Number((m.padXmm - 0.3).toFixed(2))) : 0;

  return `
    ${s}.barcode-label-card{
      width:${cardWidthMm.toFixed(1)}mm;
      height:${cardHeightMm.toFixed(1)}mm;
      max-width:${cardWidthMm.toFixed(1)}mm;
      max-height:${cardHeightMm.toFixed(1)}mm;
      padding:${m.padYmm}mm ${m.padXmm}mm;
      border:${isPreview ? '1px solid #cbd5e1' : (preset.family === 'sheet' ? '0.25mm dashed #94a3b8' : 'none')};
      border-radius:${isPreview ? '1.2mm' : '0'};
      background:#ffffff;
      color:#000000;
      text-align:center;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      align-items:stretch;
      overflow:hidden;
      box-sizing:border-box;
      direction:rtl;
      font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;
    }
    ${s}.barcode-label-card.barcode-label-card-empty{
      ${isPreview ? 'border:1px dashed #cbd5e1;background:#f8fafc;opacity:0.65;align-items:center;justify-content:center;font-size:7pt;color:#94a3b8;' : 'visibility:hidden!important;border:none!important;background:transparent!important;'}
    }
    ${s}.barcode-label-header{
      width:100%;
      flex:0 0 auto;
      margin-bottom:${m.isUltraCompact ? '0.1mm' : '0.3mm'};
    }
    ${s}.barcode-label-store{
      ${m.storePt === 0 ? 'display:none;' : `font-size:${m.storePt}pt;`}
      font-weight:600;
      color:${inkSecondary};
      line-height:1.1;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      direction:rtl;
      margin-bottom:0.15mm;
    }
    ${s}.barcode-label-name{
      font-weight:700;
      line-height:1.15;
      color:#000000;
      max-width:100%;
      direction:rtl;
      ${allowTwoLineName
        ? 'white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;'
        : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}
    }
    ${s}.barcode-label-variant-row{
      display:flex;
      align-items:center;
      justify-content:center;
      max-width:100%;
      margin-top:${m.isUltraCompact ? '0.05mm' : '0.15mm'};
    }
    ${s}.barcode-label-variant-badge{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:0.8mm;
      font-size:${m.variantPt}pt;
      font-weight:700;
      color:#000000;
      background:transparent;
      border:none;
      padding:0;
      line-height:1.15;
      max-width:100%;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      direction:rtl;
    }
    ${s}.barcode-label-body{
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      width:100%;
      flex:1 1 0;
      min-height:0;
      overflow:${svgBleedMm > 0 ? 'visible' : 'hidden'};
      margin:${m.isUltraCompact ? '0.1mm' : '0.25mm'} 0;
    }
    ${s}.barcode-label-svg{
      display:flex;
      align-items:center;
      justify-content:center;
      width:${svgBleedMm > 0 ? `calc(100% + ${(svgBleedMm * 2).toFixed(1)}mm)` : '100%'};
      ${svgBleedMm > 0 ? `max-width:calc(100% + ${(svgBleedMm * 2).toFixed(1)}mm);` : ''}
      flex:1 1 0;
      min-height:${m.svgMinMm}mm;
      max-height:${m.svgMaxMm}mm;
      overflow:hidden;
    }
    ${s}.barcode-label-svg svg{
      width:100%;
      height:100%;
      max-width:100%;
      max-height:100%;
      display:block;
    }
    ${s}.barcode-label-text{
      flex:0 0 auto;
      font-size:${m.barcodeTextPt}pt;
      font-weight:700;
      direction:ltr;
      letter-spacing:0.25mm;
      line-height:1.05;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:clip;
      margin-top:${m.isUltraCompact ? '0.1mm' : '0.2mm'};
      color:#000000;
    }
    ${s}.barcode-label-bottom-row{
      flex:0 0 auto;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:1mm;
      width:100%;
      margin-top:${m.isUltraCompact ? '0.1mm' : '0.25mm'};
      padding-top:${m.isUltraCompact ? '0.1mm' : '0.25mm'};
      border-top:0.18mm solid ${dividerColor};
    }
    ${s}.barcode-label-meta-tags{
      display:flex;
      align-items:center;
      gap:1mm;
      min-width:0;
      overflow:hidden;
    }
    ${s}.barcode-label-unit-badge{
      font-size:${m.unitBadgePt}pt;
      font-weight:600;
      color:#000000;
      background:transparent;
      border:none;
      padding:0;
      line-height:1.15;
      white-space:nowrap;
    }
    ${s}.barcode-label-sku{
      font-size:${m.skuPt}pt;
      color:${inkSecondary};
      font-weight:600;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    ${s}.barcode-label-price{
      font-size:${m.pricePt}pt;
      font-weight:800;
      color:#000000;
      line-height:1.05;
      white-space:nowrap;
      margin-right:auto;
      margin-left:0;
      text-align:left;
      direction:ltr;
      unicode-bidi:isolate;
    }
    ${s}.barcode-label-missing{
      font-size:6.5pt;
      color:#b91c1c;
      display:flex;
      align-items:center;
      justify-content:center;
      height:100%;
    }
    ${s}.barcode-label-food-statement{
      flex:0 0 auto;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:0.1mm;
      font-size:${m.foodDatesPt}pt;
      font-weight:600;
      color:#000000;
      background:transparent;
      border:none;
      border-top:0.15mm solid ${dividerColor};
      border-radius:0;
      padding:0.2mm 0 0;
      margin:0.1mm 0;
      line-height:1.12;
      direction:rtl;
      width:100%;
      box-sizing:border-box;
    }
    ${s}.barcode-label-food-dates{
      display:flex;
      align-items:center;
      justify-content:center;
      flex-wrap:wrap;
      gap:0.1mm 0.8mm;
      width:100%;
      color:#000000;
      font-size:${m.foodDatesPt}pt;
      line-height:1.12;
    }
    ${s}.barcode-label-food-dates span{color:#000000;white-space:nowrap;}
    ${s}.barcode-label-food-dates span strong{font-weight:700;color:#000000;}
    ${s}.barcode-label-storage-note{
      font-size:${m.storageNotePt}pt;
      font-weight:600;
      color:#000000;
      line-height:1.12;
      text-align:center;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width:100%;
    }
    ${s}.barcode-label-card.has-food-statement{
      padding:${Math.max(0.8, m.padYmm - 0.5).toFixed(1)}mm ${Math.max(1.6, m.padXmm - 0.3).toFixed(1)}mm;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-header{
      margin-bottom:0.15mm;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-store{
      ${m.storePt === 0 ? 'display:none;' : `font-size:${Math.max(3.8, m.storePt - 0.8).toFixed(1)}pt;margin-bottom:0.05mm;`}
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-body{
      margin:0.1mm 0;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-svg{
      min-height:${m.isUltraCompact ? 3.8 : m.h <= 26 ? 5.2 : 6.4}mm;
      max-height:${m.isUltraCompact ? 5.2 : m.h <= 26 ? 7.6 : 9.8}mm;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-text{
      font-size:${Math.max(4.4, m.barcodeTextPt - 0.8).toFixed(1)}pt;
      margin-top:0.1mm;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-bottom-row{
      margin-top:0.15mm;
      padding-top:0.15mm;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-price{
      font-size:${Math.max(5.8, m.pricePt - 1.1).toFixed(1)}pt;
    }
    ${s}.barcode-label-card.has-food-statement .barcode-label-unit-badge{
      font-size:${Math.max(4.4, m.unitBadgePt - 0.6).toFixed(1)}pt;
    }
    ${s}.barcode-label-card.barcode-label-shelf{
      text-align:start;
    }
    ${s}.barcode-label-card.barcode-label-shelf .barcode-label-variant-row{
      justify-content:flex-start;
    }
    ${s}.barcode-label-card .barcode-shelf-product-name{
      font-size:${m.shelfNamePt}pt!important;
      font-weight:900!important;
      color:#000000!important;
      white-space:normal!important;
      line-height:1.2!important;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      overflow:hidden;
    }
    ${s}.barcode-label-card .barcode-shelf-main-content{
      display:grid;
      grid-template-columns:1.15fr 1fr;
      gap:1.5mm;
      align-items:center;
      flex:1 1 0;
      min-height:0;
      margin:0.5mm 0;
    }
    ${s}.barcode-label-card .barcode-shelf-price-column{
      display:flex;
      flex-direction:column;
      align-items:flex-start;
      justify-content:center;
    }
    ${s}.barcode-label-card .barcode-shelf-price-badge{
      display:flex;
      flex-direction:column;
      align-items:flex-start;
    }
    ${s}.barcode-label-card .barcode-shelf-price-amount{
      font-size:${m.shelfPricePt}pt;
      font-weight:900;
      color:#000000;
      line-height:1;
      white-space:nowrap;
      direction:ltr;
    }
    ${s}.barcode-label-card .barcode-shelf-tax-note{
      font-size:5.4pt;
      font-weight:700;
      color:${inkSecondary};
      margin-top:0.3mm;
    }
    ${s}.barcode-label-card .barcode-shelf-unit-line{
      font-size:6pt;
      font-weight:700;
      color:${inkSecondary};
      margin-top:0.4mm;
    }
    ${s}.barcode-label-card .barcode-shelf-code-column{
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      min-width:0;
      height:100%;
    }
    ${s}.barcode-label-card .barcode-shelf-code-column .barcode-label-svg{
      min-height:6mm;
      max-height:${Math.max(8, m.h * 0.36).toFixed(1)}mm;
    }
  `;
}
