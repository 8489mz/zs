import { describe, expect, it, vi } from 'vitest';
import {
  buildCode128Svg,
  createGeneratedBarcode,
  createSequentialVariantBarcode,
  encodeCode128Auto,
} from '@/lib/barcode';
import {
  DEFAULT_THERMAL_ROTATE_DEG,
  SHEET_PRESETS,
  THERMAL_PRESETS,
  buildBarcodePreviewHtml,
  buildSingleLabelHtml,
  getBarcodePrintPreset,
  printBatchBarcodeLabels,
  type BarcodePrintItem,
} from '@/lib/barcode-labels';
import type { Product } from '@/types/domain';

const mockProduct: Product = {
  id: 'prod-1',
  name: 'أرز بسمتي درجة أولى 1 كجم',
  barcode: '6221234567890',
  costPrice: 65,
  retailPrice: 85,
  wholesalePrice: 78,
  stock: 120,
  minStock: 10,
  categoryId: 'cat-food',
  supplierId: 'sup-1',
  styleCode: 'RICE-01',
  itemKind: 'standard',
  notes: '',
  units: [
    {
      id: 'unit-1',
      name: 'كيلو',
      multiplier: 1,
      isBaseUnit: true,
      isSaleUnit: true,
      isPurchaseUnit: true,
      barcode: '6221234567890',
    },
  ],
};

describe('barcode-labels library', () => {

  it('prints the actual size-and-color SKU instead of a shared model code', () => {
    const product: Product = { ...mockProduct, name: 'حذاء أسود 42.5', sku: 'SKU-BLACK-42-5', styleCode: '900100' };
    const html = buildSingleLabelHtml(product, product.units![0], getBarcodePrintPreset('thermal-40x30'), false, { showSku: true });
    expect(html).toContain('SKU-BLACK-42-5');
    expect(html).not.toContain('barcode-label-sku">900100');
  });

  it('contains regulatory shelf label presets', () => {
    const shelfPreset = getBarcodePrintPreset('thermal-shelf-60x30');
    expect(shelfPreset).toBeDefined();
    expect(shelfPreset.isShelfLabel).toBe(true);
    expect(shelfPreset.labelWidthMm).toBe(60);
    expect(shelfPreset.labelHeightMm).toBe(30);

    const foodPreset = getBarcodePrintPreset('thermal-food-50x40');
    expect(foodPreset).toBeDefined();
    expect(foodPreset.labelWidthMm).toBe(50);
    expect(foodPreset.labelHeightMm).toBe(40);
  });

  it('renders standard label with food packaging statement', () => {
    const preset = getBarcodePrintPreset('thermal-40x30');
    const html = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showFoodStatement: true,
      packagingDate: '2026-09-17',
      expiryType: 'period',
      expiryPeriodMonths: 6,
    });

    expect(html).toContain('أرز بسمتي');
    expect(html).toContain('barcode-label-food-statement');
    expect(html).toContain('2026-09-17');
    expect(html).toContain('صلاحية: 6 شهر');
    expect(html).toContain('85');
  });

  it('renders complete regulatory statement with production date, net weight, and storage instructions', () => {
    const preset = getBarcodePrintPreset('thermal-food-50x40');
    const html = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showFoodStatement: true,
      showProductionDate: true,
      productionDate: '2026-09-01',
      packagingDate: '2026-09-17',
      expiryType: 'date',
      expiryDate: '2027-03-01',
      showNetWeight: true,
      netWeightText: '1 كجم',
      foodStatementNote: 'يحفظ في مكان جاف وبارد',
      showUnit: true,
    });

    expect(html).toContain('إنتاج: <strong>2026-09-01</strong>');
    expect(html).toContain('تعبئة: <strong>2026-09-17</strong>');
    expect(html).toContain('انتهاء: 2027-03-01');
    expect(html).toContain('صافي: 1 كجم');
    expect(html).toContain('يحفظ في مكان جاف وبارد');
    expect(html).toContain('barcode-label-storage-note');
  });

  it('renders shelf edge talker layout with prominent price and tax note', () => {
    const preset = getBarcodePrintPreset('thermal-shelf-60x30');
    const html = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showPrice: true,
      showUnit: true,
    });

    expect(html).toContain('barcode-label-shelf');
    expect(html).toContain('barcode-shelf-product-name');
    expect(html).toContain('شامل الضريبة المضافة');
    expect(html).toContain('لكل كيلو');
    expect(html).toContain('85');
  });

  it('generates multi-item preview for batch printing', () => {
    const items: BarcodePrintItem[] = [
      { product: mockProduct, unit: mockProduct.units![0], copies: 2 },
      {
        product: { ...mockProduct, id: 'prod-2', name: 'سكر أبيض ناعم 1 كجم', barcode: '6229999999999' },
        copies: 2,
      },
    ];

    const preview = buildBarcodePreviewHtml({
      product: mockProduct,
      unit: mockProduct.units![0],
      presetId: 'thermal-40x30',
      items,
      previewMode: 'sheet',
    });

    expect(preview).toContain('أرز بسمتي');
    expect(preview).toContain('سكر أبيض ناعم');
    expect(preview).toContain('barcode-preview-scope');
  });

  it('keeps every A4 sheet preset strictly within 210mm x 297mm boundaries', () => {
    for (const preset of SHEET_PRESETS) {
      const totalWidth = preset.marginMm * 2 + preset.columns * preset.labelWidthMm + (preset.columns - 1) * preset.gapMm;
      const totalHeight = preset.marginMm * 2 + preset.rows * preset.labelHeightMm + (preset.rows - 1) * preset.gapMm;
      expect(totalWidth).toBeLessThanOrEqual(210);
      expect(totalHeight).toBeLessThanOrEqual(297);
    }
  });

  it('supports thermal custom dimensions and market presets like 35x22 and 40x25', () => {
    expect(THERMAL_PRESETS.some((p) => p.id === 'thermal-35x22')).toBe(true);
    expect(THERMAL_PRESETS.some((p) => p.id === 'thermal-40x25')).toBe(true);

    const custom = getBarcodePrintPreset('thermal-custom', { widthMm: 55, heightMm: 28 });
    expect(custom.labelWidthMm).toBe(55);
    expect(custom.labelHeightMm).toBe(28);
    expect(custom.pageWidthMm).toBe(55);

    const clamped = getBarcodePrintPreset('thermal-custom', { widthMm: 5, heightMm: 500 });
    expect(clamped.labelWidthMm).toBe(20);
    expect(clamped.labelHeightMm).toBe(150);
  });

  it('renders price with currency code (EGP) by default and supports symbol or number-only', () => {
    const preset = getBarcodePrintPreset('thermal-40x30');
    const htmlDefault = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showPrice: true,
    });
    const htmlSymbol = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showPrice: true,
      currencyFormat: 'symbol',
    });
    const htmlNone = buildSingleLabelHtml(mockProduct, mockProduct.units![0], preset, false, {
      showPrice: true,
      currencyFormat: 'none',
    });

    expect(htmlDefault).toContain('85.00 EGP');
    expect(htmlSymbol).toContain('85.00 ج.م');
    expect(htmlNone).toContain('85.00');
    expect(htmlNone).not.toContain('EGP');
  });

  it('pins barcode label price to the far left in RTL preview without shifting next to unit badge', () => {
    const preview = buildBarcodePreviewHtml({
      product: mockProduct,
      unit: mockProduct.units![0],
      presetId: 'thermal-40x30',
      previewMode: 'single',
    });
    expect(preview).toContain('margin-right:auto');
    expect(preview).not.toContain('margin-inline-start:auto');
  });

  it('encodes single-digit numeric barcode cleanly without dangling CODE_C and uses full-width thermal bar compensation', () => {
    const codes = encodeCode128Auto('1');
    expect(codes).toEqual([104, 17]);
    const svg = buildCode128Svg('1');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
    // 40-unit module grid with 5-unit inset (-25% bar width reduction -> 30 black : 50 white) eliminates bold ink bleed against thermal dot gain
    expect(svg).toContain('x="285" y="0" width="70"');
  });

  it('emits single clean @page size rule and rotation stage for thermal labels', () => {
    const htmlWrites: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: any[]) => {
      if (tag === 'iframe') {
        const frame = origCreate('iframe');
        Object.defineProperty(frame, 'contentWindow', { value: { focus: vi.fn(), print: vi.fn() }, configurable: true });
        Object.defineProperty(frame, 'contentDocument', {
          value: {
            open: vi.fn(),
            write: (html: string) => htmlWrites.push(html),
            close: vi.fn(),
            readyState: 'complete',
          },
          configurable: true,
        });
        return frame;
      }
      return (origCreate as any)(tag, ...args);
    }) as any);

    printBatchBarcodeLabels(
      [{ product: mockProduct, unit: mockProduct.units![0], copies: 2 }],
      { presetId: 'thermal-40x30', copies: 2, labelsPerPage: 1, rotateDeg: 180 },
      { showPrice: true, currencyFormat: 'code' },
    );

    expect(htmlWrites.length).toBe(1);
    const printedHtml = htmlWrites[0];
    expect(printedHtml).toContain('@page { size: 40mm 30mm; margin: 0mm; }');
    expect(printedHtml).not.toContain('margin: 8mm');
    expect(printedHtml).toContain('is-rotated-180');
    expect(printedHtml).toContain('85.00 EGP');

    vi.restoreAllMocks();
  });

  it('uses 180 degrees as default thermal rotation and keeps safe insets on 38x25mm thermal labels', () => {
    expect(DEFAULT_THERMAL_ROTATE_DEG).toBe(180);

    const preview = buildBarcodePreviewHtml({
      product: mockProduct,
      unit: mockProduct.units![0],
      presetId: 'thermal-38x25',
      previewMode: 'single',
      rotateDeg: DEFAULT_THERMAL_ROTATE_DEG,
    });
    expect(preview).toContain('padding:1.4mm 1.2mm');
    expect(preview).toContain('180°');
  });

  it('renders fashion color/size variant badge cleanly without duplicating suffix and falls back to nameEn', () => {
    const fashionProduct: Product = {
      ...mockProduct,
      id: 'fashion-1',
      itemKind: 'fashion',
      styleCode: 'POLO-100',
      sku: 'POLO-BLK-XL',
      color: 'أسود',
      size: 'XL',
      name: 'تيشيرت بولو قطن فاخر - أسود / XL',
    };
    const preset = getBarcodePrintPreset('thermal-38x25');

    const withVariantHtml = buildSingleLabelHtml(fashionProduct, fashionProduct.units![0], preset);
    expect(withVariantHtml).toContain('barcode-label-variant-badge');
    expect(withVariantHtml).toContain('<span>أسود</span>');
    expect(withVariantHtml).toContain('<span dir="ltr">XL</span>');
    expect(withVariantHtml).toContain('تيشيرت بولو قطن فاخر</div');

    const hiddenVariantHtml = buildSingleLabelHtml(fashionProduct, fashionProduct.units![0], preset, false, {
      showVariant: false,
    });
    expect(hiddenVariantHtml).not.toContain('barcode-label-variant-badge');
    expect(hiddenVariantHtml).toContain('تيشيرت بولو قطن فاخر - أسود / XL');

    const englishProduct: Product = {
      ...mockProduct,
      name: '',
      nameEn: 'Classic Cotton Tee',
      color: 'Navy',
      size: 'L',
    };
    const englishHtml = buildSingleLabelHtml(englishProduct, englishProduct.units![0], preset);
    expect(englishHtml).toContain('Classic Cotton Tee');
    expect(englishHtml).toContain('<span>Navy</span>');
    expect(englishHtml).toContain('<span dir="ltr">L</span>');
  });

  it('expands short numeric barcodes horizontally, removes heavy unit/food borders, and prioritizes barcode height on compact food labels', () => {
    const shortSvg = buildCode128Svg('34');
    const viewBoxMatch = shortSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(viewBoxMatch).not.toBeNull();
    const vbW = Number(viewBoxMatch![1]);
    const vbH = Number(viewBoxMatch![2]);
    expect(vbW / vbH).toBeGreaterThan(2.5);

    const preview = buildBarcodePreviewHtml({
      product: { ...mockProduct, name: 'ترمس مستورد حلو', barcode: '34', retailPrice: 90 },
      unit: mockProduct.units![0],
      presetId: 'thermal-38x25',
      previewMode: 'single',
      customization: {
        showFoodStatement: true,
        showProductionDate: true,
        productionDate: '2026-11-17',
        packagingDate: '2026-11-17',
        expiryType: 'period',
        expiryPeriodMonths: 6,
        showNetWeight: true,
        netWeightText: 'kg',
        foodStatementNote: 'يحفظ في مكان جاف وبارد',
      },
    });
    expect(preview).toContain('overflow:hidden');
    expect(preview).toContain('border:none;');
    expect(preview).toContain('border-top:0.15mm solid');
    expect(preview).toContain('has-food-statement .barcode-label-svg{');
    expect(preview).toMatch(/barcode-label-food-dates[\s\S]*صلاحية: 6 شهر[\s\S]*يحفظ في مكان جاف وبارد/);
  });

  it('skips batch variants with copies=0 so a store can reprint a single damaged variant sticker alone', () => {
    const htmlWrites: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: any[]) => {
      if (tag === 'iframe') {
        const frame = origCreate('iframe');
        Object.defineProperty(frame, 'contentWindow', { value: { focus: vi.fn(), print: vi.fn() }, configurable: true });
        Object.defineProperty(frame, 'contentDocument', {
          value: {
            open: vi.fn(),
            write: (html: string) => htmlWrites.push(html),
            close: vi.fn(),
            readyState: 'complete',
          },
          configurable: true,
        });
        return frame;
      }
      return (origCreate as any)(tag, ...args);
    }) as any);

    const blackVariant: Product = { ...mockProduct, id: 'v-blk', name: 'تيشيرت', color: 'أسود', size: 'XL', barcode: '1110001', units: [] };
    const whiteVariant: Product = { ...mockProduct, id: 'v-wht', name: 'تيشيرت', color: 'أبيض', size: 'M', barcode: '1110002', units: [] };

    const preview = buildBarcodePreviewHtml({
      product: blackVariant,
      presetId: 'thermal-38x25',
      previewMode: 'sheet',
      items: [
        { product: whiteVariant, copies: 0 },
        { product: blackVariant, copies: 1 },
      ],
    });
    expect(preview).toContain('1110001');
    expect(preview).not.toContain('1110002');

    printBatchBarcodeLabels(
      [
        { product: whiteVariant, copies: 0 },
        { product: blackVariant, copies: 1 },
      ],
      { presetId: 'thermal-38x25', copies: 1, labelsPerPage: 1, rotateDeg: 180 },
    );

    expect(htmlWrites.length).toBe(1);
    expect(htmlWrites[0]).toContain('1110001');
    expect(htmlWrites[0]).not.toContain('1110002');

    htmlWrites.length = 0;
    printBatchBarcodeLabels(
      [
        { product: whiteVariant, copies: 0 },
        { product: blackVariant, copies: 0 },
      ],
      { presetId: 'thermal-38x25', copies: 0, labelsPerPage: 1 },
    );
    expect(htmlWrites.length).toBe(0);

    vi.restoreAllMocks();
  });

  it('generates compact even-digit Code 128C barcodes for products and fashion variants for effortless scanning', () => {
    const generated = createGeneratedBarcode(['20000001'], 'ZS');
    expect(generated).toMatch(/^[2-9]\d{7}$/);
    const generatedSvg = buildCode128Svg(generated);
    const legacyHyphenSvg = buildCode128Svg('321321-004');
    const genMatch = generatedSvg.match(/viewBox="0 0 (\d+) \d+"/);
    const legacyMatch = legacyHyphenSvg.match(/viewBox="0 0 (\d+) \d+"/);
    // 40-unit grid with 7X quiet zones: pure 8-digit Code 128C uses 93 modules (3720 units) vs 148 modules (5920 units) for hyphenated '321321-004'
    expect(Number(genMatch![1])).toBe(3720);
    expect(Number(legacyMatch![1])).toBe(5920);

    const preview = buildBarcodePreviewHtml({
      product: { ...mockProduct, barcode: '321321-001' },
      unit: mockProduct.units![0],
      presetId: 'thermal-38x25',
      previewMode: 'single',
    });
    expect(preview).toContain('width:calc(100% + 1.8mm)');

    const used = new Set<string>(['32132101']);
    const seq1 = createSequentialVariantBarcode('321321', 1, used);
    const seq2 = createSequentialVariantBarcode('321321', 2, used);
    expect(seq1).toBe('32132102');
    expect(seq2).toBe('32132103');
    expect(seq1).toMatch(/^\d{8}$/);

    const oddUsed = new Set<string>();
    expect(createSequentialVariantBarcode('901', 4, oddUsed)).toBe('901004');

    const alphaUsed = new Set<string>();
    expect(createSequentialVariantBarcode('POLO', 1, alphaUsed)).toBe('POLO01');
  });
});
