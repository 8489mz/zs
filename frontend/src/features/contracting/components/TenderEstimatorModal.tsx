import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { ImportBoqModal } from './LazyImportBoqModal';
import { ImportMasterBoqModal } from './ImportMasterBoqModal';

interface TenderItemComponent {
  componentCode: string;
  componentName: string;
  unit: string;
  qtyPerUnit: number;
  unitRate: number;
  componentType: 'material' | 'labor' | 'equipment' | 'subcontractor';
}

interface TenderItem {
  id: string;
  itemCode: string;
  description: string;
  unit: string;
  estimatedQty: number;
  trade: string;
  components: TenderItemComponent[];
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  notes?: string;
  // Dimensions for CAD takeoff mode
  drawingLength?: number;
  drawingWidth?: number;
  drawingHeight?: number;
  drawingCount?: number;
}

interface TenderEstimatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated?: (projectId: string) => void;
  initialProjectId?: string;
}

export interface BrickPreset {
  id: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  tradeType: 'masonry_m2' | 'masonry_m3';
  unit: string;
  ratePerM2OrM3: number;
  sandPerUnit: number;
  cementPerUnit: number;
  description: string;
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
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 2.2fr) minmax(170px, 1.8fr) minmax(75px, 0.75fr) minmax(75px, 0.75fr) minmax(75px, 0.75fr) auto',
            gap: '10px',
            alignItems: 'end',
          }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('contracting.tender_estimator_modal.s7', "اسم المشروع / العطاء المقترح")}
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                style={{ width: '100%', height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('contracting.tender_estimator_modal.s8', "العميل / جهة الإسناد المستهدفة")}
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                style={{ width: '100%', height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#1e293b' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('contracting.tender_estimator_modal.s9', "هامش الربح %")}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={globalProfitMargin}
                onChange={(e) => setGlobalProfitMargin(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 700, color: '#15803d' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('contracting.tender_estimator_modal.s10', "المصاريف الإدارية %")}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={globalOverhead}
                onChange={(e) => setGlobalOverhead(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#475569' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('contracting.tender_estimator_modal.s11', "الهالك العام %")}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={globalWaste}
                onChange={(e) => setGlobalWaste(Number(e.target.value))}
                style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#475569' }}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={handleApplyGlobalMargins}
                title={t('contracting.tender_estimator_modal.s12', "تعميم نسب الربح والمصاريف والهالك على كافة البنود")}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#170e5e',
                  fontSize: 'var(--font-micro)',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <AppIcons.Sliders size={13} />
                <span>{t('contracting.tender_estimator_modal.s13', "تعميم النسب للكل")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* شريط أدوات إضافة البنود والحصر */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: 'var(--font-section-title)', fontWeight: 800, color: '#1e293b' }}>
              {t('contracting.tender_estimator_modal.s14', "بنود العطاء ومقايسة المشروع (")}{items.length} {t('contracting.tender_estimator_modal.s15', "بند)")}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setIsImportBoqOpen(true)}
              style={{
                height: '32px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#170e5e',
                fontSize: 'var(--font-subtitle)',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <AppIcons.FileSpreadsheet size={14} />
              <span>{t('contracting.tender_estimator_modal.s16', "استيراد مقايسة Excel (BOQ)")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsImportMasterOpen(true)}
              style={{
                height: '32px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #170e5e',
                background: '#eef2ff',
                color: '#170e5e',
                fontSize: 'var(--font-subtitle)',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <AppIcons.Layers size={14} />
              <span>{t('contracting.tender_estimator_modal.s17', "سحب من المقايسة المرجعية (124 بند)")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCadTakeoffFormOpen(!isCadTakeoffFormOpen)}
              style={{
                height: '32px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #0284c7',
                background: '#f0f9ff',
                color: '#0369a1',
                fontSize: 'var(--font-subtitle)',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <AppIcons.PlusCircle size={14} />
              <span>{t('contracting.tender_estimator_modal.s18', "حصر سريع من أبعاد الرسومات (CAD Takeoff)")}</span>
            </button>
          </div>
        </div>

        {/* حاسبة الحصر السريع المنبثقة من الرسومات */}
        {isCadTakeoffFormOpen && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AppIcons.CheckShield size={16} />
              <span>{t('contracting.tender_estimator_modal.s19', "حاسبة الحصر الهندسي السريع من واقع اللوحات والمخططات المعمارية والإنشائية")}</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 1fr) 85px 85px 85px 75px 105px',
              gap: '8px',
              alignItems: 'end',
            }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s20', "نوع البند الهندسي")}</label>
                <CustomSelect
                  value={cadItemCode}
                  onChange={(val) => setCadItemCode(String(val))}
                  options={engineeringConstants.map((c) => ({
                    value: c.itemCode,
                    label: `${c.itemName} (${c.unit})`,
                    hint: c.itemCode,
                  }))}
                  placeholder={t('contracting.tender_estimator_modal.s21', "اختر كود البند...")}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s22', "الطول (م)")}</label>
                <input
                  type="number"
                  value={cadLength}
                  onChange={(e) => setCadLength(Number(e.target.value))}
                  style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s23', "العرض (م)")}</label>
                <input
                  type="number"
                  value={cadWidth}
                  onChange={(e) => setCadWidth(Number(e.target.value))}
                  style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s24', "الارتفاع (م)")}</label>
                <input
                  type="number"
                  value={cadHeight}
                  onChange={(e) => setCadHeight(Number(e.target.value))}
                  style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s25', "التكرار")}</label>
                <input
                  type="number"
                  value={cadCount}
                  onChange={(e) => setCadCount(Number(e.target.value))}
                  style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#0369a1', marginBottom: '2px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s26', "خصومات الفتحات")}</label>
                <input
                  type="number"
                  value={cadDeductions}
                  onChange={(e) => setCadDeductions(Number(e.target.value))}
                  style={{ width: '100%', height: '32px', padding: '0 4px', textAlign: 'center', borderRadius: '6px', border: '1px solid #7dd3fc', fontSize: 'var(--font-body)', fontWeight: 600 }}
                />
              </div>
            </div>

            {/* محدد ومحرك مقاسات الطوب والبلوك الديناميكي */}
            {(cadItemCode.startsWith('BRK') || cadItemCode.startsWith('BLK') || cadItemCode.startsWith('AAC')) && (
              <div style={{ background: '#ffffff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: 'var(--font-micro)', fontWeight: 700, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <AppIcons.Sliders size={13} />
                    <span>{t('contracting.tender_estimator_modal.s27', "مواصفات وأبعاد الطوبة / البلوك المستخدم (Brick & Block Dimensions):")}</span>
                  </span>
                  <span style={{ fontSize: '11px', color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                    {t('contracting.tender_estimator_modal.s28', "المعدل الهندسي المحسوب:")} {calculatedBrickRate.ratePerM2} {t('contracting.tender_estimator_modal.s29', "طوبة/م² | رمل:")} {calculatedBrickRate.sandPerM2} {t('contracting.tender_estimator_modal.s30', "م³ | أسمنت:")} {calculatedBrickRate.cementPerM2} {t('contracting.tender_estimator_modal.s31', "طن")}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: cadBrickPreset === 'CUSTOM' ? 'minmax(260px, 1.4fr) 85px 85px 85px 95px' : '1fr', gap: '8px', alignItems: 'end' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s32', "اختر مقاس الطوب أو البلوك الشائع:")}</label>
                    <CustomSelect
                      value={cadBrickPreset}
                      onChange={(val) => setCadBrickPreset(String(val))}
                      options={BRICK_SIZE_PRESETS.map((p) => ({
                        value: p.id,
                        label: p.name,
                        hint: `${p.ratePerM2OrM3} ${p.unit === 'm3' ? t('contracting.tender_estimator_modal.s33', "طوبة/م³") : t('contracting.tender_estimator_modal.s34', "طوبة/م²")}`,
                      }))}
                      placeholder={t('contracting.tender_estimator_modal.s35', "اختر مقاس الطوب...")}
                    />
                  </div>

                  {cadBrickPreset === 'CUSTOM' && (
                    <>
                      <div>
                        <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s36', "طول الطوبة (سم)")}</label>
                        <input
                          type="number"
                          value={customBrickLength}
                          onChange={(e) => setCustomBrickLength(Number(e.target.value))}
                          style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s37', "عرض/سمك (سم)")}</label>
                        <input
                          type="number"
                          value={customBrickWidth}
                          onChange={(e) => setCustomBrickWidth(Number(e.target.value))}
                          style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s38', "ارتفاع (سم)")}</label>
                        <input
                          type="number"
                          value={customBrickHeight}
                          onChange={(e) => setCustomBrickHeight(Number(e.target.value))}
                          style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#0369a1', textAlign: 'center', marginBottom: '2px' }}>{t('contracting.tender_estimator_modal.s39', "عرموس مونة (سم)")}</label>
                        <input
                          type="number"
                          step="0.1"
                          value={mortarJoint}
                          onChange={(e) => setMortarJoint(Number(e.target.value))}
                          style={{ width: '100%', height: '30px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #7dd3fc', fontSize: 'var(--font-micro)', fontWeight: 700 }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setIsCadTakeoffFormOpen(false)}
                style={{ height: '30px', padding: '0 12px', borderRadius: '6px', border: '1px solid #bae6fd', background: '#ffffff', color: '#0369a1', fontSize: 'var(--font-micro)', fontWeight: 600, cursor: 'pointer' }}
              >
                {t('contracting.tender_estimator_modal.s40', "إغلاق")}
              </button>
              <button
                type="button"
                onClick={handleAddFromCadTakeoff}
                style={{ height: '30px', padding: '0 16px', borderRadius: '6px', border: 'none', background: '#0284c7', color: '#ffffff', fontSize: 'var(--font-micro)', fontWeight: 700, cursor: 'pointer' }}
              >
                {t('contracting.tender_estimator_modal.s41', "إضافة البند المحصور للعطاء")}
              </button>
            </div>
          </div>
        )}

        {/* جدول بنود العطاء والتفكيك الهندسي */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {items.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
              {t('contracting.tender_estimator_modal.s42', "لا توجد بنود مضافة للعطاء حتى الآن. انقر على")} <strong>{t('contracting.tender_estimator_modal.s43', "استيراد مقايسة Excel")}</strong> {t('contracting.tender_estimator_modal.s44', "أو")} <strong>{t('contracting.tender_estimator_modal.s45', "سحب من المقايسة المرجعية")}</strong> {t('contracting.tender_estimator_modal.s46', "أو")} <strong>{t('contracting.tender_estimator_modal.s47', "حصر سريع من الرسومات")}</strong> {t('contracting.tender_estimator_modal.s48', "لبدء التسعير والتفكيك الهندسي.")}
            </div>
          ) : (
            <div
              className="thin-scrollbar"
              style={{
                maxHeight: '380px',
                overflowY: 'auto',
                overflowX: 'hidden',
                position: 'relative',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-body)', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: '55px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '105px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '105px' }} />
                  <col style={{ width: '125px' }} />
                  <col style={{ width: '95px' }} />
                  <col style={{ width: '45px' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 'var(--font-table-head)', position: 'sticky', top: 0, zIndex: 2 }}>
                    <th style={{ padding: '8px 12px', textAlign: 'start' }}>{t('contracting.tender_estimator_modal.s49', "البند والوصف الهندسي")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s50', "الوحدة")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s51', "الكمية")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s52', "ت. الوحدة (BOM)")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s53', "هامش الربح")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s54', "سعر البيع")}</th>
                    <th style={{ padding: '8px 8px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s55', "إجمالي القيمة للعميل")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s56', "تفكيك الكود")}</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center' }}>{t('contracting.tender_estimator_modal.s57', "حذف")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const calc = calculateItemRates(item);
                    const isExpanded = expandedItemId === item.id;

                    return (
                      <React.Fragment key={item.id}>
                        <tr style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                              <span style={{ padding: '2px 5px', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3', fontSize: '11px', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>
                                {item.itemCode}
                              </span>
                              <strong style={{ color: '#1e293b', fontSize: 'var(--font-body)', lineHeight: 1.35 }} title={item.description}>
                                {item.description}
                              </strong>
                            </div>
                            {item.notes && (
                              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b', lineHeight: 1.3 }}>{item.notes}</p>
                            )}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center', color: '#475569', fontWeight: 600, fontSize: 'var(--font-micro)' }}>
                            {item.unit}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              value={item.estimatedQty}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, estimatedQty: val } : it)));
                              }}
                              style={{ width: '100%', maxWidth: '75px', height: '28px', padding: '0 4px', textAlign: 'center', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}
                            />
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: 'var(--font-micro)', whiteSpace: 'nowrap' }}>
                            {formatCurrency(calc.totalCostPerUnit)}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.profitMarkupPercent}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, profitMarkupPercent: val } : it)));
                                }}
                                style={{ width: '46px', height: '28px', padding: '0 2px', textAlign: 'center', borderRadius: '5px', border: '1px solid #cbd5e1', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#15803d' }}
                              />
                              <span style={{ fontSize: '10px', color: '#64748b' }}>%</span>
                            </div>
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: '#170e5e', fontSize: 'var(--font-micro)', whiteSpace: 'nowrap' }}>
                            {formatCurrency(calc.sellingPricePerUnit)}
                          </td>
                          <td style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 800, color: '#0f172a', fontSize: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                            {formatCurrency(calc.totalSellingPrice)}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                background: isExpanded ? '#170e5e' : '#ffffff',
                                color: isExpanded ? '#ffffff' : '#170e5e',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <AppIcons.Sliders size={11} />
                              <span>{isExpanded ? t('contracting.tender_estimator_modal.s58', "إخفاء") : 'BOM'}</span>
                            </button>
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                              title={t('contracting.tender_estimator_modal.s59', "حذف البند من العطاء")}
                              style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <AppIcons.Trash2 size={15} />
                            </button>
                          </td>
                        </tr>

                        {/* لوحة تفكيك الكود الهندسي القياسي (BOM Exploder) */}
                        {isExpanded && (
                          <tr style={{ background: '#f8fafc' }}>
                            <td colSpan={9} style={{ padding: '10px 14px', borderBottom: '2px solid #cbd5e1' }}>
                              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                                  <strong style={{ fontSize: 'var(--font-subtitle)', color: '#170e5e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <AppIcons.CheckShield size={14} />
                                    <span>{t('contracting.tender_estimator_modal.s60', "مكونات واستهلاكات الكود الهندسي للبند:")} {item.description} {t('contracting.tender_estimator_modal.s61', "(إجمالي كمية البند:")} {item.estimatedQty} {item.unit})</span>
                                  </strong>
                                  <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                                    {t('contracting.tender_estimator_modal.s62', "هالك:")} {item.wastePercent}{t('contracting.tender_estimator_modal.s63', "% | إداريات:")} {item.overheadPercent}{t('contracting.tender_estimator_modal.s64', "% | ربح:")} {item.profitMarkupPercent}%
                                  </span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                                  {calc.componentsDetail.map((comp) => (
                                    <div key={comp.componentCode} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={comp.componentName}>
                                          {comp.componentName}
                                        </span>
                                        <span style={{ fontSize: '10px', color: '#64748b' }}>({comp.unit})</span>
                                      </div>

                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '4px' }}>
                                        <strong style={{ fontSize: 'var(--font-body)', color: '#1e293b' }} dir="ltr">
                                          {comp.totalQtyForTender} {comp.unit}
                                        </strong>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#170e5e' }}>
                                          {formatCurrency(comp.totalCostForTender)}
                                        </span>
                                      </div>

                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '6px', paddingTop: '4px', borderTop: '1px dashed #e2e8f0' }}>
                                        <div>
                                          <label style={{ display: 'block', fontSize: '9.5px', color: '#64748b', marginBottom: '1px' }}>{t('contracting.tender_estimator_modal.s65', "المعدل/")}{item.unit}:</label>
                                          <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={comp.qtyPerUnit}
                                            onChange={(e) => {
                                              const val = Number(e.target.value);
                                              setItems((prev) =>
                                                prev.map((it) => {
                                                  if (it.id !== item.id) return it;
                                                  const newComps = (it.components || []).map((c) =>
                                                    c.componentCode === comp.componentCode ? { ...c, qtyPerUnit: val } : c
                                                  );
                                                  return { ...it, components: newComps };
                                                })
                                              );
                                            }}
                                            style={{ width: '100%', height: '24px', padding: '0 2px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, color: '#170e5e' }}
                                          />
                                        </div>
                                        <div>
                                          <label style={{ display: 'block', fontSize: '9.5px', color: '#64748b', marginBottom: '1px' }}>{t('contracting.tender_estimator_modal.s66', "سعر الوحدة:")}</label>
                                          <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={comp.unitRate}
                                            onChange={(e) => {
                                              const val = Number(e.target.value);
                                              setItems((prev) =>
                                                prev.map((it) => {
                                                  if (it.id !== item.id) return it;
                                                  const newComps = (it.components || []).map((c) =>
                                                    c.componentCode === comp.componentCode ? { ...c, unitRate: val } : c
                                                  );
                                                  return { ...it, components: newComps };
                                                })
                                              );
                                            }}
                                            style={{ width: '100%', height: '24px', padding: '0 2px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, color: '#0369a1' }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '14px', fontSize: 'var(--font-micro)', borderTop: '1px solid #e2e8f0', paddingTop: '6px', flexWrap: 'wrap' }}>
                                  <span>{t('contracting.tender_estimator_modal.s67', "التكلفة المباشرة:")} <strong>{formatCurrency(calc.totalDirectCost)}</strong></span>
                                  <span>{t('contracting.tender_estimator_modal.s68', "التكلفة الشاملة بالإداريات:")} <strong>{formatCurrency(calc.totalTenderCost)}</strong></span>
                                  <span style={{ color: '#15803d' }}>{t('contracting.tender_estimator_modal.s69', "صافي ربح البند:")} <strong>{formatCurrency(calc.totalProfit)}</strong></span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ملخص إجمالي الموارد والمواد المطلوبة للعطاء (Rollup Materials MRP) */}
        {tenderSummary.resources.length > 0 && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AppIcons.Layers size={15} />
              <span>{t('contracting.tender_estimator_modal.s70', "إجمالي الموارد والخامات التقديرية لتنفيذ العطاء بالكامل (Pre-Procurement Materials Takeoff)")}</span>
            </h4>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                gap: '8px',
                padding: '2px',
              }}
            >
              {tenderSummary.resources.map((res) => (
                <div key={res.name} style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px' }}>
                  <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={res.name}>
                    {res.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '2px' }}>
                    <strong style={{ fontSize: 'var(--font-body)', color: '#170e5e', fontWeight: 800 }} dir="ltr">
                      {res.totalQty.toLocaleString()} <span style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#64748b' }}>{res.unit}</span>
                    </strong>
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                    {t('contracting.tender_estimator_modal.s71', "تقديري:")} <strong>{formatCurrency(res.totalCost)}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
