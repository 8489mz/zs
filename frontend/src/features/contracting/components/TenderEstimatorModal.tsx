import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { contractingApi } from '../api/contracting.api';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { ImportBoqModal } from './LazyImportBoqModal';
import { ImportMasterBoqModal } from './ImportMasterBoqModal';
import type { TenderItem, BrickPreset } from './tender-estimator/tender-estimator.types';
import { TenderGeneralSettings } from './tender-estimator/TenderGeneralSettings';
import { TenderItemsToolbar } from './tender-estimator/TenderItemsToolbar';
import { TenderCadTakeoffPopup } from './tender-estimator/TenderCadTakeoffPopup';
import { TenderItemsTable } from './tender-estimator/TenderItemsTable';
import { TenderMrpSummary } from './tender-estimator/TenderMrpSummary';

interface TenderEstimatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated?: (projectId: string) => void;
  initialProjectId?: string;
}

export const BRICK_SIZE_PRESETS: BrickPreset[] = [
  {
    id: 'BRK_25_12_6',
    name: 'طوب أحمر طفلي نمطي (25 × 12 × 6 سم) - مصري قياسي',
    lengthCm: 25,
    widthCm: 12,
    heightCm: 6,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 55,
    sandPerUnit: 0.02,
    cementPerUnit: 0.01,
    description: 'قاطع نصف طوبة 12 سم (الكود المصري N=55 طوبة/م²)',
  },
  {
    id: 'BRK_24_11_6',
    name: 'طوب أحمر طفلي سوقي/اقتصادي (24 × 11 × 6 سم)',
    lengthCm: 24,
    widthCm: 11,
    heightCm: 6,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 57.5,
    sandPerUnit: 0.022,
    cementPerUnit: 0.011,
    description: 'قاطع نصف طوبة مقاس سوقي (N=58 طوبة/م²)',
  },
  {
    id: 'BRK_25_12_13',
    name: 'طوب أحمر طفلي مضاعف دوبل (25 × 12 × 13 سم)',
    lengthCm: 25,
    widthCm: 12,
    heightCm: 13,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 27.5,
    sandPerUnit: 0.018,
    cementPerUnit: 0.009,
    description: 'طوب دوبل خفيف وسريع البناء (N=28 طوبة/م²)',
  },
  {
    id: 'BRK_SOL_25',
    name: 'طوب أسمنتي مصمت (25 × 12 × 6 سم) - حوائط حاملة وتكحيل',
    lengthCm: 25,
    widthCm: 12,
    heightCm: 6,
    tradeType: 'masonry_m3',
    unit: 'm3',
    ratePerM2OrM3: 450,
    sandPerUnit: 0.2,
    cementPerUnit: 0.065,
    description: 'مباني طوب أسمنتي مصمت بالمتر المكعب (450 طوبة/م³)',
  },
  {
    id: 'BLK_40_20_20',
    name: 'بلوك أسمنتي مفرغ (40 × 20 × 20 سم) - خليجي / واجهات',
    lengthCm: 40,
    widthCm: 20,
    heightCm: 20,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 12.5,
    sandPerUnit: 0.035,
    cementPerUnit: 0.015,
    description: 'بلوك خرساني معتمد للبناء الخارجي والعزل (N=12.5 بلوكة/م²)',
  },
  {
    id: 'BLK_40_20_15',
    name: 'بلوك أسمنتي مفرغ (40 × 15 × 20 سم) - حوائط 15 سم',
    lengthCm: 40,
    widthCm: 15,
    heightCm: 20,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 12.5,
    sandPerUnit: 0.03,
    cementPerUnit: 0.013,
    description: 'بلوك أسمنتي للقواطع المتوسطة (N=12.5 بلوكة/م²)',
  },
  {
    id: 'BLK_40_20_10',
    name: 'بلوك أسمنتي قواطع (40 × 10 × 20 سم) - قواطع داخلية',
    lengthCm: 40,
    widthCm: 10,
    heightCm: 20,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 12.5,
    sandPerUnit: 0.025,
    cementPerUnit: 0.01,
    description: 'بلوك أسمنتي قواطع داخلية خفيفة (N=12.5 بلوكة/م²)',
  },
  {
    id: 'AAC_60_20_20',
    name: 'طوب خرساني خفيف عازل سيبوريكس / AAC (60 × 20 × 20 سم)',
    lengthCm: 60,
    widthCm: 20,
    heightCm: 20,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 8.33,
    sandPerUnit: 0.005,
    cementPerUnit: 0.006,
    description: 'طوب أوتوكلاف خفيف عازل للحرارة (N=8.33 بلوكة/م²)',
  },
  {
    id: 'CUSTOM',
    name: 'مقاس مخصص يدوي (Custom Dimensions)...',
    lengthCm: 25,
    widthCm: 12,
    heightCm: 6,
    tradeType: 'masonry_m2',
    unit: 'm2',
    ratePerM2OrM3: 55,
    sandPerUnit: 0.02,
    cementPerUnit: 0.01,
    description: 'إدخال أبعاد الطوبة يدوياً وحساب المعدلات آلياً بالمعادلة الهندسية',
  },
];

export function TenderEstimatorModal({
  isOpen,
  onClose,
  onProjectCreated,
}: TenderEstimatorModalProps) {
  const { t } = useTranslation();
  const { formatCurrency, currencyCode } = useSystemCurrency();
  // INV-FE3-FRONTEND-BOOK-DIGITS: every money rate/total in this
  // estimator rounds at the tenant's book digits, not hardcoded 2dp.
  // (Quantities — totalQtyForTender, sand/cement per m² — are not money
  // and keep their own precision.)
  const bookDigits = currencyMoneyDigits(currencyCode);

  // Basic Tender Information
  const [projectName, setProjectName] = useState('عطاء: مشروع إنشاء وتشطيب متكامل');
  const [clientName, setClientName] = useState('شركة الأفق للتطوير والاستثمار العقاري');
  const [globalProfitMargin, setGlobalProfitMargin] = useState(15);
  const [globalOverhead, setGlobalOverhead] = useState(7);
  const [globalWaste, setGlobalWaste] = useState(5);

  // Constants & Loading State
  const [, setLoadingConstants] = useState(false);
  const [engineeringConstants, setEngineeringConstants] = useState<any[]>([]);
  const [items, setItems] = useState<TenderItem[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Sub-modals & CAD Form State
  const [isImportBoqOpen, setIsImportBoqOpen] = useState(false);
  const [isImportMasterOpen, setIsImportMasterOpen] = useState(false);
  const [isCadTakeoffFormOpen, setIsCadTakeoffFormOpen] = useState(false);
  const [cadItemCode, setCadItemCode] = useState('BRK-RED-12');
  const [cadLength, setCadLength] = useState(25);
  const [cadWidth, setCadWidth] = useState(1);
  const [cadHeight, setCadHeight] = useState(3.2);
  const [cadCount, setCadCount] = useState(4);
  const [cadDeductions, setCadDeductions] = useState(12);

  // Brick Dimensions & Dynamic Rate States
  const [cadBrickPreset, setCadBrickPreset] = useState('BRK_25_12_6');
  const [customBrickLength, setCustomBrickLength] = useState(25);
  const [customBrickWidth, setCustomBrickWidth] = useState(12);
  const [customBrickHeight, setCustomBrickHeight] = useState(6);
  const [mortarJoint, setMortarJoint] = useState(1.0);

  // Dynamic Calculated Brick Rate
  const calculatedBrickRate = useMemo(() => {
    const preset = BRICK_SIZE_PRESETS.find((p) => p.id === cadBrickPreset);
    if (preset && preset.id !== 'CUSTOM') {
      return {
        ratePerM2: preset.ratePerM2OrM3,
        sandPerM2: preset.sandPerUnit,
        cementPerM2: preset.cementPerUnit,
        unit: preset.unit,
        name: preset.name,
        dimensions: `${preset.lengthCm}×${preset.widthCm}×${preset.heightCm} سم`,
        isCustom: false,
      };
    }
    // CUSTOM Calculation (Taking into account joint mortar thickness)
    const L = Math.max(0.05, (customBrickLength + mortarJoint) / 100);
    const H = Math.max(0.03, (customBrickHeight + mortarJoint) / 100);
    const ratePerM2 = Math.round((1 / (L * H)) * 10) / 10;
    const wallVol = 1.0 * (customBrickWidth / 100);
    const actualBrkVol = ratePerM2 * (customBrickLength / 100) * (customBrickWidth / 100) * (customBrickHeight / 100);
    const mortarVol = Math.max(0.008, wallVol - actualBrkVol);
    const sandPerM2 = Math.round(mortarVol * 1.1 * 1000) / 1000;
    const cementPerM2 = Math.round(mortarVol * 0.35 * 1000) / 1000;

    return {
      ratePerM2,
      sandPerM2,
      cementPerM2,
      unit: 'm2',
      name: `مقاس مخصص (${customBrickLength}×${customBrickWidth}×${customBrickHeight} سم)`,
      dimensions: `${customBrickLength}×${customBrickWidth}×${customBrickHeight} سم`,
      isCustom: true,
    };
  }, [cadBrickPreset, customBrickLength, customBrickWidth, customBrickHeight, mortarJoint]);

  // Saving / Awarding State
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load Engineering Constants
  useEffect(() => {
    if (!isOpen) return;
    setLoadingConstants(true);
    contractingApi
      .getEngineeringConstants()
      .then((data) => {
        setEngineeringConstants(data || []);
        // If items are empty, seed with initial realistic items for testing
        if (items.length === 0 && data && data.length > 0) {
          const defaultCodes = ['BRK-RED-12', 'CONC-FTG-C30', 'CONC-COL-C35', 'CONC-SLB-C30', 'PLAS-INT-01', 'TILE-FLR-CER', 'PAINT-INT-03'];
          const initialTenderItems: TenderItem[] = [];

          defaultCodes.forEach((code) => {
            const found = data.find((c: any) => c.itemCode === code);
            if (found) {
              let defQty = 500;
              if (code === 'BRK-RED-12') defQty = 1200; // 1200 m2
              if (code === 'CONC-FTG-C30') defQty = 180; // 180 m3
              if (code === 'CONC-COL-C35') defQty = 95;  // 95 m3
              if (code === 'CONC-SLB-C30') defQty = 320; // 320 m3
              if (code === 'PLAS-INT-01') defQty = 2400; // 2400 m2
              if (code === 'TILE-FLR-CER') defQty = 850; // 850 m2
              if (code === 'PAINT-INT-03') defQty = 2400; // 2400 m2

              initialTenderItems.push({
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode: found.itemCode,
                description: found.itemName,
                unit: found.unit,
                estimatedQty: defQty,
                trade: found.itemCode.startsWith('BRK') ? 'masonry' : found.itemCode.startsWith('CONC') ? 'concrete' : found.itemCode.startsWith('PLAS') ? 'plastering' : found.itemCode.startsWith('TILE') ? 'flooring' : 'finishes',
                components: found.components || [],
                wastePercent: found.wastePercent || 5,
                overheadPercent: found.overheadPercent || 7,
                profitMarkupPercent: found.profitMarkupPercent || 15,
                notes: found.notes,
              });
            }
          });

          if (initialTenderItems.length > 0) {
            setItems(initialTenderItems);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load engineering constants:', err);
      })
      .finally(() => setLoadingConstants(false));
  }, [isOpen]);

  // Apply Global Margins to All Items
  const handleApplyGlobalMargins = () => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        profitMarkupPercent: globalProfitMargin,
        overheadPercent: globalOverhead,
        wastePercent: globalWaste,
      }))
    );
    toast.success('تم تعميم نسب الأرباح والمصاريف والهالك على كافة البنود بنجاح');
  };

  // Add Item From Quick CAD Takeoff
  const handleAddFromCadTakeoff = () => {
    const constant = engineeringConstants.find((c) => c.itemCode === cadItemCode);
    if (!constant) {
      toast.warning('يرجى اختيار نوع البند أولاً');
      return;
    }

    const baseProduct = cadLength * cadWidth * cadHeight * cadCount;
    const netQty = Math.max(1, Math.round((baseProduct - cadDeductions) * 100) / 100);

    // Dynamic components for masonry or custom materials
    let itemComponents = constant.components ? [...constant.components] : [];
    let customDesc = `${constant.itemName} (حصر لوحات: ${cadLength}×${cadHeight}م)`;

    if (constant.itemCode.startsWith('BRK') || constant.itemCode.startsWith('BLK') || constant.itemCode.startsWith('AAC')) {
      const brkPrice = itemComponents.find((c: any) => c.componentType === 'material' && (c.componentCode.includes('BRK') || c.componentCode.includes('BLK') || c.componentCode.includes('AAC')))?.unitRate || (cadBrickPreset.startsWith('AAC') ? 22 : cadBrickPreset.startsWith('BLK') ? 14 : 2.2);
      const sandPrice = itemComponents.find((c: any) => c.componentType === 'material' && c.componentCode.includes('SND'))?.unitRate || 180;
      const cmtPrice = itemComponents.find((c: any) => c.componentType === 'material' && c.componentCode.includes('CMT'))?.unitRate || 2800;
      const labPrice = itemComponents.find((c: any) => c.componentType === 'labor')?.unitRate || 70;

      itemComponents = [
        {
          componentCode: `MAT-${cadBrickPreset}`,
          componentName: `طوب/بلوك بناء (${calculatedBrickRate.dimensions})`,
          unit: 'pcs',
          qtyPerUnit: calculatedBrickRate.ratePerM2,
          unitRate: brkPrice,
          componentType: 'material',
        },
        {
          componentCode: `MAT-SND-01`,
          componentName: `رمل بناء حرش نظيف للمونة`,
          unit: 'm3',
          qtyPerUnit: calculatedBrickRate.sandPerM2,
          unitRate: sandPrice,
          componentType: 'material',
        },
        {
          componentCode: `MAT-CMT-42`,
          componentName: `أسمنت بورتلاندي 42.5 للمونة`,
          unit: 'ton',
          qtyPerUnit: calculatedBrickRate.cementPerM2,
          unitRate: cmtPrice,
          componentType: 'material',
        },
        {
          componentCode: `LAB-MAS-01`,
          componentName: `مصنعية بنا ومساعد ونقل داخلي`,
          unit: constant.unit || 'm2',
          qtyPerUnit: 1,
          unitRate: labPrice,
          componentType: 'labor',
        },
      ];

      customDesc = `${constant.itemName} [مقاس ${calculatedBrickRate.dimensions} - معدل ${calculatedBrickRate.ratePerM2} طوبة/م²] (حصر: ${cadLength}×${cadHeight}م)`;
    }

    const newItem: TenderItem = {
      id: `TND-${Math.random().toString(36).slice(2, 9)}`,
      itemCode: constant.itemCode,
      description: customDesc,
      unit: constant.unit,
      estimatedQty: netQty,
      trade: constant.itemCode.startsWith('BRK') ? 'masonry' : 'concrete',
      components: itemComponents,
      wastePercent: globalWaste,
      overheadPercent: globalOverhead,
      profitMarkupPercent: globalProfitMargin,
      drawingLength: cadLength,
      drawingWidth: cadWidth,
      drawingHeight: cadHeight,
      drawingCount: cadCount,
    };

    setItems((prev) => [newItem, ...prev]);
    setIsCadTakeoffFormOpen(false);
    toast.success(`تم استنتاج الكمية وحصر ${netQty} ${constant.unit} وتفكيك الكود بالمقاس المحدد`);
  };

  // Add Items From Master BOQ Library Selection
  const handleImportMasterItems = async (selectedIds: (string | number)[]) => {
    try {
      const masterItems = await contractingApi.getMasterBoqLibrary();
      const selectedMaster = masterItems.filter((m: any) => selectedIds.includes(m.id));

      const newTenderItems: TenderItem[] = selectedMaster.map((m: any) => {
        const matchingConstant = engineeringConstants.find(
          (c) => c.itemCode === m.itemCode || m.itemCode.includes(c.itemCode)
        );

        return {
          id: `TND-${Math.random().toString(36).slice(2, 9)}`,
          itemCode: m.itemCode,
          description: m.description,
          unit: m.unit,
          estimatedQty: 100, // default quantity
          trade: m.trade,
          components: matchingConstant ? matchingConstant.components : [
            { componentCode: `MAT-${m.itemCode}`, componentName: `خامات ${m.description}`, unit: m.unit, qtyPerUnit: 1, unitRate: Number(m.estimatedCost || 0) * 0.7, componentType: 'material' },
            { componentCode: `LAB-${m.itemCode}`, componentName: `مصنعية وعمالة تنفيذ`, unit: m.unit, qtyPerUnit: 1, unitRate: Number(m.estimatedCost || 0) * 0.3, componentType: 'labor' },
          ],
          wastePercent: matchingConstant?.wastePercent || globalWaste,
          overheadPercent: matchingConstant?.overheadPercent || globalOverhead,
          profitMarkupPercent: matchingConstant?.profitMarkupPercent || globalProfitMargin,
        };
      });

      setItems((prev) => [...prev, ...newTenderItems]);
      setIsImportMasterOpen(false);
      toast.success(`تم سحب ${newTenderItems.length} بند من المقايسة المرجعية بنجاح`);
    } catch (err: any) {
      toast.error('تعذر سحب بنود المقايسة المرجعية');
    }
  };

  // Calculations for an individual item
  const calculateItemRates = (item: TenderItem) => {
    let directCostPerUnit = 0;
    const componentsDetail = (item.components || []).map((c) => {
      const compCost = Number(c.qtyPerUnit || 0) * Number(c.unitRate || 0);
      directCostPerUnit += compCost;
      const totalComponentQty = (Number(c.qtyPerUnit || 0) * item.estimatedQty * (1 + item.wastePercent / 100));
      const totalComponentCost = totalComponentQty * Number(c.unitRate || 0);

      return {
        ...c,
        unitDirectCost: compCost,
        totalQtyForTender: Math.round(totalComponentQty * 100) / 100,
        totalCostForTender: roundMoneyValue(totalComponentCost, bookDigits),
      };
    });

    const wasteAmount = directCostPerUnit * (item.wastePercent / 100);
    const costWithWaste = directCostPerUnit + wasteAmount;
    const overheadAmount = costWithWaste * (item.overheadPercent / 100);
    const totalCostPerUnit = costWithWaste + overheadAmount;
    const profitAmountPerUnit = totalCostPerUnit * (item.profitMarkupPercent / 100);
    const sellingPricePerUnit = totalCostPerUnit + profitAmountPerUnit;

    const totalDirectCost = directCostPerUnit * item.estimatedQty;
    const totalTenderCost = totalCostPerUnit * item.estimatedQty;
    const totalSellingPrice = sellingPricePerUnit * item.estimatedQty;
    const totalProfit = totalSellingPrice - totalTenderCost;

    return {
      directCostPerUnit: roundMoneyValue(directCostPerUnit, bookDigits),
      costWithWaste: roundMoneyValue(costWithWaste, bookDigits),
      totalCostPerUnit: roundMoneyValue(totalCostPerUnit, bookDigits),
      profitAmountPerUnit: roundMoneyValue(profitAmountPerUnit, bookDigits),
      sellingPricePerUnit: roundMoneyValue(sellingPricePerUnit, bookDigits),
      totalDirectCost: roundMoneyValue(totalDirectCost, bookDigits),
      totalTenderCost: roundMoneyValue(totalTenderCost, bookDigits),
      totalSellingPrice: roundMoneyValue(totalSellingPrice, bookDigits),
      totalProfit: roundMoneyValue(totalProfit, bookDigits),
      componentsDetail,
    };
  };

  // Rollup Calculations for the Whole Tender
  const tenderSummary = useMemo(() => {
    let totalSellingPrice = 0;
    let totalDirectCost = 0;
    let totalTenderCost = 0;
    let totalProfit = 0;

    // Rollup Materials / Resources
    const resourceRollup = new Map<string, { name: string; unit: string; type: string; totalQty: number; totalCost: number }>();

    items.forEach((item) => {
      const calc = calculateItemRates(item);
      totalSellingPrice += calc.totalSellingPrice;
      totalDirectCost += calc.totalDirectCost;
      totalTenderCost += calc.totalTenderCost;
      totalProfit += calc.totalProfit;

      calc.componentsDetail.forEach((c) => {
        const key = c.componentCode || c.componentName;
        const existing = resourceRollup.get(key) || {
          name: c.componentName,
          unit: c.unit,
          type: c.componentType,
          totalQty: 0,
          totalCost: 0,
        };
        existing.totalQty += c.totalQtyForTender;
        existing.totalCost += c.totalCostForTender;
        resourceRollup.set(key, existing);
      });
    });

    const resources = Array.from(resourceRollup.values());
    const overallMargin = totalSellingPrice > 0 ? (totalProfit / totalSellingPrice) * 100 : 0;

    return {
      totalSellingPrice: Math.round(totalSellingPrice),
      totalDirectCost: Math.round(totalDirectCost),
      totalTenderCost: Math.round(totalTenderCost),
      totalProfit: Math.round(totalProfit),
      overallMargin: Math.round(overallMargin * 10) / 10,
      resources,
    };
  }, [items]);

  // Award Tender & Convert to Active Project
  const handleAwardAndCreateProject = async () => {
    if (items.length === 0) {
      toast.warning('يرجى إضافة بنود المقايسة للعطاء أولاً');
      return;
    }

    const confirmed = await systemConfirm({
      title: 'اعتماد وترسية العطاء وتحويله لمشروع تنفيذي',
      message: `هل أنت متأكد من اعتماد العطاء بقيمة إجمالية ${formatCurrency(tenderSummary.totalSellingPrice)} وتوليد المشروع الإنشائي والمقايسة وخطة الاحتياجات آلياً؟`,
      confirmText: 'نعم، اعتمد وأنشئ المشروع',
      variant: 'primary',
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      // 1. Create Project
      const project = await contractingApi.createProject({
        name: projectName.trim(),
        clientName: clientName.trim(),
        contractValue: tenderSummary.totalSellingPrice,
        downPaymentAmount: Math.round(tenderSummary.totalSellingPrice * 0.1), // 10% advance
        retentionPercent: 5.0,
      });

      const newProjectId = String(project.id);

      // 2. Insert BOQ Items
      const usedItemCodes = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const calc = calculateItemRates(item);

        let code = (item.itemCode || `ITEM-${String(i + 1).padStart(3, '0')}`).trim();
        if (usedItemCodes.has(code.toUpperCase())) {
          let c = 2;
          while (usedItemCodes.has(`${code}-${c}`.toUpperCase())) {
            c++;
          }
          code = `${code}-${c}`;
        }
        usedItemCodes.add(code.toUpperCase());

        const boqItem = await contractingApi.createBoqItem(newProjectId, {
          itemCode: code,
          description: item.description,
          unit: item.unit,
          contractQty: item.estimatedQty,
          unitPrice: calc.sellingPricePerUnit,
          estimatedUnitCost: calc.totalCostPerUnit,
        });

        // If CAD takeoff dimensions were provided, save takeoff sheet automatically
        if (item.drawingLength && item.drawingHeight && boqItem?.id) {
          const l = item.drawingLength || 1;
          const w = item.drawingWidth || 1;
          const h = item.drawingHeight || 1;
          const count = item.drawingCount || 1;
          const net = l * w * h * count;
          const waste = item.wastePercent || 0;
          const totalWithWaste = net * (1 + waste / 100);

          await contractingApi.saveBoqTakeoffs(String(boqItem.id), {
            takeoffs: [
              {
                drawingRef: 'DWG-TND-01',
                axisRef: 'العطاء الأولي',
                description: item.description,
                length: l,
                width: w,
                height: h,
                countMultiplier: count,
                voidDeduction: 0,
                netQty: net,
                wastePercent: waste,
                totalWithWaste: totalWithWaste,
              },
            ],
            syncToBoqQuantity: true,
          });
        }
      }

      toast.success(`تم بنجاح اعتماد وترسية العطاء وتوليد مشروع [${projectName}] والمقايسة وخطة التوريدات!`);
      if (onProjectCreated) onProjectCreated(newProjectId);
      onClose();
    } catch (err: any) {
      console.error('Failed to create project from tender:', err);
      toast.error(err?.message || 'تعذر اعتماد وترسية المشروع');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('contracting.tender_estimator_modal.s0', "دراسة وتسعير العطاءات والمشروعات المحتملة (Tender & Bid Estimator)")}
      subtitle={t('contracting.tender_estimator_modal.s1', "حساب الكميات وتفكيك الكود الهندسي القياسي (BOM)، تسعير الخامات والمصنعيات، وهوامش الربح وإصدار عروض الأسعار")}
      width="min(1240px, 98vw)"
      minHeight="min(720px, 94vh)"
      compact={true}
      bodyStyle={{ overflowY: 'auto', padding: '12px 16px' }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>{t('contracting.tender_estimator_modal.s2', "إجمالي قيمة العطاء (المقترح للعميل):")}</span>
              <strong style={{ fontSize: '1.2rem', color: '#170e5e', fontWeight: 800 }}>
                {formatCurrency(tenderSummary.totalSellingPrice)}
              </strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', background: '#dcfce7', padding: '3px 8px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
              <span style={{ fontSize: 'var(--font-micro)', color: '#166534', fontWeight: 700 }}>{t('contracting.tender_estimator_modal.s3', "صافي الربح المتوقع:")}</span>
              <strong style={{ fontSize: 'var(--font-body)', color: '#15803d', fontWeight: 800 }}>
                {formatCurrency(tenderSummary.totalProfit)} ({tenderSummary.overallMargin}%)
              </strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: '34px',
                padding: '0 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
              }}
            >
              {t('contracting.tender_estimator_modal.s4', "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleAwardAndCreateProject}
              disabled={isSubmitting || items.length === 0}
              style={{
                height: '34px',
                padding: '0 18px',
                borderRadius: '6px',
                border: 'none',
                background: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                cursor: isSubmitting || items.length === 0 ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || items.length === 0 ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.2)',
                fontSize: 'var(--font-body)',
              }}
            >
              <AppIcons.CheckShield size={15} />
              <span>{isSubmitting ? t('contracting.tender_estimator_modal.s5', "جاري الاعتماد والإنشاء...") : t('contracting.tender_estimator_modal.s6', "اعتماد وترسية العطاء كمشروع رسمي")}</span>
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
        {/* إعدادات العطاء العامة والتسعيرية */}
        <TenderGeneralSettings
          t={t}
          projectName={projectName}
          setProjectName={setProjectName}
          clientName={clientName}
          setClientName={setClientName}
          globalProfitMargin={globalProfitMargin}
          setGlobalProfitMargin={setGlobalProfitMargin}
          globalOverhead={globalOverhead}
          setGlobalOverhead={setGlobalOverhead}
          globalWaste={globalWaste}
          setGlobalWaste={setGlobalWaste}
          handleApplyGlobalMargins={handleApplyGlobalMargins}
        />

        {/* شريط أدوات إضافة البنود والحصر */}
        <TenderItemsToolbar
          t={t}
          items={items}
          setIsImportBoqOpen={setIsImportBoqOpen}
          setIsImportMasterOpen={setIsImportMasterOpen}
          setIsCadTakeoffFormOpen={setIsCadTakeoffFormOpen}
          isCadTakeoffFormOpen={isCadTakeoffFormOpen}
        />

        {/* حاسبة الحصر السريع المنبثقة من الرسومات */}
        <TenderCadTakeoffPopup
          isCadTakeoffFormOpen={isCadTakeoffFormOpen}
          t={t}
          cadItemCode={cadItemCode}
          setCadItemCode={setCadItemCode}
          engineeringConstants={engineeringConstants}
          cadLength={cadLength}
          setCadLength={setCadLength}
          cadWidth={cadWidth}
          setCadWidth={setCadWidth}
          cadHeight={cadHeight}
          setCadHeight={setCadHeight}
          cadCount={cadCount}
          setCadCount={setCadCount}
          cadDeductions={cadDeductions}
          setCadDeductions={setCadDeductions}
          calculatedBrickRate={calculatedBrickRate}
          cadBrickPreset={cadBrickPreset}
          setCadBrickPreset={setCadBrickPreset}
          customBrickLength={customBrickLength}
          setCustomBrickLength={setCustomBrickLength}
          customBrickWidth={customBrickWidth}
          setCustomBrickWidth={setCustomBrickWidth}
          customBrickHeight={customBrickHeight}
          setCustomBrickHeight={setCustomBrickHeight}
          mortarJoint={mortarJoint}
          setMortarJoint={setMortarJoint}
          setIsCadTakeoffFormOpen={setIsCadTakeoffFormOpen}
          handleAddFromCadTakeoff={handleAddFromCadTakeoff}
          brickPresets={BRICK_SIZE_PRESETS}
        />

        {/* جدول بنود العطاء والتفكيك الهندسي */}
        <TenderItemsTable
          items={items}
          t={t}
          calculateItemRates={calculateItemRates}
          expandedItemId={expandedItemId}
          setItems={setItems}
          formatCurrency={formatCurrency}
          setExpandedItemId={setExpandedItemId}
        />

        {/* ملخص إجمالي الموارد والمواد المطلوبة للعطاء (Rollup Materials MRP) */}
        <TenderMrpSummary
          tenderSummary={tenderSummary}
          t={t}
          formatCurrency={formatCurrency}
        />
      </div>

      {/* نافذة استيراد مقايسة العطاء من Excel */}
      {isImportBoqOpen && (
        <ImportBoqModal
          open={isImportBoqOpen}
          projectName={projectName}
          onClose={() => setIsImportBoqOpen(false)}
          onImportItems={(parsedRows) => {
            const newTenderItems: TenderItem[] = parsedRows.map((r, idx) => {
              const fallbackCode = `BOQ-${String(items.length + idx + 1).padStart(3, '0')}`;
              const itemCode = r.itemCode && r.itemCode.trim() ? r.itemCode.trim() : fallbackCode;
              const unit = r.unit || 'm3';
              const estimatedQty = r.contractQty > 0 ? r.contractQty : 1;
              const unitCost = r.estimatedUnitCost > 0
                ? r.estimatedUnitCost
                : (r.unitPrice > 0 ? roundMoneyValue(r.unitPrice / (1 + (globalProfitMargin + globalOverhead + globalWaste) / 100), bookDigits) : 0);

              return {
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode,
                description: r.description,
                unit,
                estimatedQty,
                trade: r.category || 'general',
                components: [
                  {
                    componentCode: `MAT-${itemCode}`,
                    componentName: `خامات ومواد: ${r.description.slice(0, 35)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(unitCost * 0.7, bookDigits),
                    componentType: 'material',
                  },
                  {
                    componentCode: `LAB-${itemCode}`,
                    componentName: `مصنعية وتنفيذ: ${r.description.slice(0, 35)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(unitCost * 0.3, bookDigits),
                    componentType: 'labor',
                  },
                ],
                wastePercent: globalWaste,
                overheadPercent: globalOverhead,
                profitMarkupPercent: globalProfitMargin,
                notes: r.notes,
              };
            });

            setItems((prev) => [...prev, ...newTenderItems]);
            setIsImportBoqOpen(false);
            toast.success(`تم استيراد ${newTenderItems.length} بند من ملف المقايسة بنجاح`);
          }}
        />
      )}

      {/* نافذة سحب بنود المقايسة المرجعية */}
      {isImportMasterOpen && (
        <ImportMasterBoqModal
          open={isImportMasterOpen}
          onClose={() => setIsImportMasterOpen(false)}
          onImportSelected={handleImportMasterItems}
        />
      )}
    </StandardDialog>
  );
}
