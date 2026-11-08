import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { getTextDirection } from '@/lib/arabic-normalization';
import { contractingApi } from '../api/contracting.api';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { ImportBoqModal } from '../components/LazyImportBoqModal';
import { ImportMasterBoqModal } from '../components/ImportMasterBoqModal';
import { AutoPricingModal } from '../components/AutoPricingModal';
import { ClientQuotationModal } from '../components/ClientQuotationModal';
import { MarkTenderLostModal } from '../components/MarkTenderLostModal';
import { AwardTenderModal } from '../components/AwardTenderModal';
import { TenderSwitcherModal } from '../components/TenderSwitcherModal';
import { ContractingWorkflowMapModal } from '../components/ContractingWorkflowMapModal';
import { BRICK_SIZE_PRESETS } from '../components/TenderEstimatorModal';
import { useContracting } from '../context/ContractingContext';
import { matchEngineeringConstant } from '../utils/engineeringMasterPricingCore';
import { exportPricedBoqWorkbook } from '../utils/originalWorkbookPricer';

const DRAFT_STORAGE_KEY = 'zs_tender_estimator_draft_v2';

const TRADE_LABELS: Record<string, string> = {
  all: 'كافة البنود والتخصصات',
  low_current: 'التيار الخفيف والأنظمة الذكية',
  fire_fighting: 'شبكات مكافحة الحريق',
  electrical_power: 'الأعمال الكهربائية',
  plumbing_sanitary: 'الأعمال الصحية والسباكة',
  hvac: 'التكييف والتهوية',
  civil_concrete: 'أعمال مدنية وخرسانات',
  architecture_finishes: 'تشطيبات ومعماري',
  masonry: 'أعمال المباني',
  concrete: 'أعمال الخرسانة',
  plastering: 'أعمال البياض والمحارة',
  flooring: 'أعمال الأرضيات',
  finishes: 'أعمال الدهانات والتشطيب',
  general: 'أعمال عامة ومتنوعة',
};



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
  sourceFileName?: string;
  sourceSheetName?: string;
  rawRowIdx?: number;
  components: TenderItemComponent[];
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  notes?: string;
  drawingLength?: number;
  drawingWidth?: number;
  drawingHeight?: number;
  drawingCount?: number;
}

const formatUnitLabel = (unit?: string, compCode?: string): string => {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'm2' || u === 'sqm') return 'م²';
  if (u === 'm3' || u === 'cbm') return 'م³';
  if (u === 'm' || u === 'lm') return 'م.ط';
  if (u === 'ton') return 'طن';
  if (u === 'kg') return 'كجم';
  if (u === 'item' || u === 'pcs' || u === 'piece') {
    if (compCode && (compCode.includes('BRK') || compCode.includes('BLK') || compCode.includes('طوب'))) return 'طوبة';
    return 'عدد';
  }
  if (u === 'ls') return 'مقطوعية';
  if (u === 'point') return 'نقطة';
  if (u === 'set') return 'طقم';
  return unit || '';
};

export function ContractingTenderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');
  const { formatCurrency, currencyCode } = useSystemCurrency();
  // INV-FE3-FRONTEND-BOOK-DIGITS: every money rate/total built on this
  // page rounds at the tenant's book digits, not hardcoded 2dp.
  // (Quantities — netQty, sand/cement per m² — are not money and keep
  // their own precision; calculateItemRates returns unrounded values and
  // its call sites round.)
  const bookDigits = currencyMoneyDigits(currencyCode);
  const { reloadProjects, setSelectedProjectId, projects } = useContracting();

  // Basic Tender Information
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [durationMonths] = useState(8);
  const [globalProfitMargin, setGlobalProfitMargin] = useState(15);
  const [globalOverhead, setGlobalOverhead] = useState(7);
  const [globalWaste, setGlobalWaste] = useState(5);

  // Constants, Items & Trade Filter State
  const [, setLoadingConstants] = useState(true);
  const [engineeringConstants, setEngineeringConstants] = useState<any[]>([]);
  const [items, setItems] = useState<TenderItem[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selectedTradeFilter, setSelectedTradeFilter] = useState<string>('all');
  const [hasDraftHydrated, setHasDraftHydrated] = useState(false);

  // Sub-modals & CAD Form State
  const [isImportBoqOpen, setIsImportBoqOpen] = useState(false);
  const [isImportMasterOpen, setIsImportMasterOpen] = useState(false);
  const [isAutoPricingOpen, setIsAutoPricingOpen] = useState(false);
  const [isQuotationOpen, setIsQuotationOpen] = useState(false);
  const [isCadTakeoffFormOpen, setIsCadTakeoffFormOpen] = useState(false);
  const [cadItemCode, setCadItemCode] = useState('BRK-RED-12');
  const [cadLength, setCadLength] = useState(25);
  const [cadWidth] = useState(1);
  const [cadHeight, setCadHeight] = useState(3.2);
  const [cadCount, setCadCount] = useState(4);
  const [cadDeductions, setCadDeductions] = useState(12);

  // Brick Dimensions & Dynamic Rate States
  const [cadBrickPreset, setCadBrickPreset] = useState('BRK_25_12_6');
  const [customBrickLength] = useState(25);
  const [customBrickWidth] = useState(12);
  const [customBrickHeight] = useState(6);
  const [mortarJoint] = useState(1.0);

  // Saving / Awarding State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentProject, setCurrentProject] = useState<any | null>(null);
  const [isAwardModalOpen, setIsAwardModalOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [isTenderSwitcherOpen, setIsTenderSwitcherOpen] = useState(false);
  const [isWorkflowMapOpen, setIsWorkflowMapOpen] = useState(false);

  const tendersUnderStudyCount = useMemo(() => {
    return (projects || []).filter(
      (p) => p.status === 'planning' || p.status === 'draft' || p.status === 'submitted' || p.status === 'negotiation'
    ).length;
  }, [projects]);

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

  // Load Engineering Constants
  useEffect(() => {
    setLoadingConstants(true);
    contractingApi
      .getEngineeringConstants()
      .then((data) => {
        setEngineeringConstants(data || []);
      })
      .catch((err) => {
        console.error('Failed to load engineering constants:', err);
      })
      .finally(() => setLoadingConstants(false));
  }, []);

  // Hydrate from backend if projectId is in query, or from localStorage draft
  useEffect(() => {
    if (projectIdParam) {
      let active = true;
      (async () => {
        try {
          const proj = await contractingApi.getProjectById(projectIdParam);
          if (!active) return;
          if (proj) {
            setCurrentProject(proj);
            setProjectName(proj.name || '');
            setClientName(proj.clientName || '');
          }
          const boqList = await contractingApi.getBoqItems(projectIdParam);
          if (!active) return;
          if (boqList && boqList.length > 0) {
            const loadedItems: TenderItem[] = boqList.map((b: any) => ({
              id: b.id,
              itemCode: b.itemCode || `BOQ-${b.id.slice(0, 4)}`,
              description: b.description || '',
              unit: b.unit || 'item',
              estimatedQty: Number(b.revisedQty || b.contractQty || 1),
              trade: b.category || 'general',
              components: [
                {
                  componentCode: `MAT-${b.itemCode}`,
                  componentName: `خامات وتوريدات: ${b.description.slice(0, 40)}`,
                  unit: b.unit || 'item',
                  qtyPerUnit: 1,
                  unitRate: roundMoneyValue((b.estimatedUnitCost || b.unitPrice * 0.7) * 0.7, bookDigits),
                  componentType: 'material',
                },
                {
                  componentCode: `LAB-${b.itemCode}`,
                  componentName: `مصنعيات وتركيب: ${b.description.slice(0, 40)}`,
                  unit: b.unit || 'item',
                  qtyPerUnit: 1,
                  unitRate: roundMoneyValue((b.estimatedUnitCost || b.unitPrice * 0.7) * 0.3, bookDigits),
                  componentType: 'labor',
                },
              ],
              wastePercent: globalWaste,
              overheadPercent: globalOverhead,
              profitMarkupPercent: globalProfitMargin,
              notes: b.notes || '',
            }));
            setItems(loadedItems);
          } else {
            setItems([]);
          }
        } catch (err) {
          console.error('Failed to load project into tender estimator:', err);
        } finally {
          if (active) setHasDraftHydrated(true);
        }
      })();
      return () => {
        active = false;
      };
    }

    // Hydrate draft from LocalStorage
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
          setItems(parsed.items);
          if (parsed.projectName) setProjectName(parsed.projectName);
          if (parsed.clientName) setClientName(parsed.clientName);
          if (parsed.globalProfitMargin !== undefined) setGlobalProfitMargin(parsed.globalProfitMargin);
          if (parsed.globalOverhead !== undefined) setGlobalOverhead(parsed.globalOverhead);
          if (parsed.globalWaste !== undefined) setGlobalWaste(parsed.globalWaste);
        }
      }
    } catch (err) {
      console.error('Failed to parse draft from localStorage:', err);
    } finally {
      setHasDraftHydrated(true);
    }
  }, [projectIdParam]);

  // Auto-Save Draft to localStorage when not editing a persisted project
  useEffect(() => {
    if (!hasDraftHydrated || projectIdParam) return;
    try {
      if (items.length > 0 || projectName.trim()) {
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            items,
            projectName,
            clientName,
            globalProfitMargin,
            globalOverhead,
            globalWaste,
            savedAt: new Date().toISOString(),
          })
        );
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch (err) {
      console.error('Failed to auto-save tender draft:', err);
    }
  }, [items, projectName, clientName, globalProfitMargin, globalOverhead, globalWaste, hasDraftHydrated, projectIdParam]);

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

  const handleAddComponent = (itemId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const newComp: TenderItemComponent = {
          componentCode: `RES-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          componentName: 'خامة / مورد إضافي',
          unit: it.unit || 'm2',
          qtyPerUnit: 1,
          unitRate: 0,
          componentType: 'material',
        };
        return { ...it, components: [...(it.components || []), newComp] };
      })
    );
  };

  const handleRemoveComponent = (itemId: string, compIdx: number) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          components: it.components.filter((_, idx) => idx !== compIdx),
        };
      })
    );
  };

  // Calculations per item
  const calculateItemRates = (item: TenderItem) => {
    let directCost = 0;
    if (item.components && item.components.length > 0) {
      directCost = item.components.reduce((sum, c) => sum + (c.qtyPerUnit * c.unitRate), 0);
    } else {
      directCost = 100;
    }

    const withWaste = directCost * (1 + (item.wastePercent || 0) / 100);
    const withOverhead = withWaste * (1 + (item.overheadPercent || 0) / 100);
    const sellingUnitPrice = withOverhead * (1 + (item.profitMarkupPercent || 0) / 100);
    const totalItemValue = sellingUnitPrice * item.estimatedQty;
    const totalItemDirectCost = directCost * item.estimatedQty;
    const totalItemProfit = (sellingUnitPrice - directCost) * item.estimatedQty;

    return {
      directCost,
      sellingUnitPrice,
      totalItemValue,
      totalItemDirectCost,
      totalItemProfit,
    };
  };

  // Grand totals across all items
  const grandTotals = useMemo(() => {
    let totalSellingPrice = 0;
    let totalDirectCost = 0;
    let totalProfit = 0;

    items.forEach((item) => {
      const { totalItemValue, totalItemDirectCost, totalItemProfit } = calculateItemRates(item);
      totalSellingPrice += totalItemValue;
      totalDirectCost += totalItemDirectCost;
      totalProfit += totalItemProfit;
    });

    const profitMargin = totalSellingPrice > 0 ? (totalProfit / totalSellingPrice) * 100 : 0;

    return {
      totalSellingPrice,
      totalDirectCost,
      totalProfit,
      profitMargin,
    };
  }, [items]);

  // Distinct Source Files / Sheets
  const availableSourceFiles = useMemo(() => {
    const fileMap = new Map<string, number>();
    items.forEach((it) => {
      const fn = it.sourceFileName || it.sourceSheetName;
      if (fn) {
        fileMap.set(fn, (fileMap.get(fn) || 0) + 1);
      }
    });
    return Array.from(fileMap.entries()).map(([fileName, count]) => ({ fileName, count }));
  }, [items]);

  // Distinct Trades in Current Tender Items
  const availableTrades = useMemo(() => {
    const tradeSet = new Set<string>();
    items.forEach((it) => {
      if (it.trade) tradeSet.add(it.trade);
    });
    return Array.from(tradeSet);
  }, [items]);

  // Filtered Items for Display by File or Trade
  const displayedItems = useMemo(() => {
    if (selectedTradeFilter === 'all') return items;
    if (selectedTradeFilter.startsWith('file:')) {
      const targetFile = selectedTradeFilter.replace('file:', '');
      return items.filter((it) => (it.sourceFileName || it.sourceSheetName) === targetFile);
    }
    return items.filter(
      (it) =>
        it.trade === selectedTradeFilter ||
        (selectedTradeFilter === 'fire_fighting' && (it.trade === 'hvac_firefighting' || it.itemCode.startsWith('FF')))
    );
  }, [items, selectedTradeFilter]);

  // Active Scope Label
  const activeScopeLabel = useMemo(() => {
    if (selectedTradeFilter === 'all') return 'كافة البنود';
    if (selectedTradeFilter.startsWith('file:')) {
      return `ملف: ${selectedTradeFilter.replace('file:', '')}`;
    }
    return TRADE_LABELS[selectedTradeFilter] || selectedTradeFilter;
  }, [selectedTradeFilter]);

  // Trade Subtotal
  const tradeSubtotal = useMemo(() => {
    return displayedItems.reduce((acc, it) => {
      const rates = calculateItemRates(it);
      return acc + rates.totalItemValue;
    }, 0);
  }, [displayedItems, globalProfitMargin, globalOverhead, globalWaste]);

  // Export Client Priced BOQ Excel (Preserving original client format or multi-file)
  const handleExportPricedClientExcel = async () => {
    if (displayedItems.length === 0 && items.length === 0) {
      toast.warning('لا توجد بنود لتصديرها');
      return;
    }

    try {
      const targetItems = displayedItems.length > 0 ? displayedItems : items;

      const distinctFiles = Array.from(
        new Set(targetItems.map((it) => it.sourceFileName).filter(Boolean))
      ) as string[];

      const exportOptions = {
        projectName,
        clientName,
        scopeLabel: activeScopeLabel,
        includeCompanyHeader: false,
      };

      if (distinctFiles.length > 1 && selectedTradeFilter === 'all') {
        let count = 0;
        for (const fileName of distinctFiles) {
          const fileItems = targetItems.filter((it) => it.sourceFileName === fileName);
          const mapped = fileItems.map((it) => {
            const rates = calculateItemRates(it);
            return {
              rawRowIdx: it.rawRowIdx,
              itemCode: it.itemCode,
              description: it.description,
              unit: it.unit,
              contractQty: it.estimatedQty,
              unitPrice: rates.sellingUnitPrice,
              totalPrice: rates.totalItemValue,
              category: it.trade,
              sourceFileName: it.sourceFileName,
              sourceSheetName: it.sourceSheetName,
              notes: it.notes,
            };
          });
          await exportPricedBoqWorkbook(fileName, mapped, exportOptions);
          count++;
        }
        toast.success(`تم تصدير ${count} ملفات إكسيل مسعرة بنفس تنسيقات وديباجة العملاء الأصلية بنجاح`);
      } else {
        let targetFileName = projectName || 'مقايسة_مسعرة';
        if (selectedTradeFilter.startsWith('file:')) {
          targetFileName = selectedTradeFilter.replace('file:', '');
        } else if (distinctFiles.length === 1) {
          targetFileName = distinctFiles[0];
        }

        const mapped = targetItems.map((it) => {
          const rates = calculateItemRates(it);
          return {
            rawRowIdx: it.rawRowIdx,
            itemCode: it.itemCode,
            description: it.description,
            unit: it.unit,
            contractQty: it.estimatedQty,
            unitPrice: rates.sellingUnitPrice,
            totalPrice: rates.totalItemValue,
            category: it.trade,
            sourceFileName: it.sourceFileName,
            sourceSheetName: it.sourceSheetName,
            notes: it.notes,
          };
        });

        await exportPricedBoqWorkbook(targetFileName, mapped, exportOptions);
        toast.success('تم تصدير شيت العميل الأصلي المسعر بكامل ألوانه وديباجته بنجاح');
      }
    } catch (err) {
      console.error('Failed to export client priced excel:', err);
      toast.error('حدث خطأ أثناء تصدير شيت العميل المسعر');
    }
  };

  const handleExportPricedExcel = handleExportPricedClientExcel;

  // Pre-Procurement Consolidated Materials Summary (Consolidated MRP)
  const consolidatedMaterials = useMemo(() => {
    const materialsMap: Record<string, { code: string; name: string; unit: string; totalQty: number; totalCost: number }> = {};

    items.forEach((item) => {
      if (item.components && item.components.length > 0) {
        item.components.forEach((c) => {
          const key = c.componentCode || c.componentName;
          const componentTotalQty = c.qtyPerUnit * item.estimatedQty;
          const componentTotalCost = componentTotalQty * c.unitRate;

          if (!materialsMap[key]) {
            materialsMap[key] = {
              code: c.componentCode,
              name: c.componentName,
              unit: c.unit,
              totalQty: componentTotalQty,
              totalCost: componentTotalCost,
            };
          } else {
            materialsMap[key].totalQty += componentTotalQty;
            materialsMap[key].totalCost += componentTotalCost;
          }
        });
      }
    });

    return Object.values(materialsMap);
  }, [items]);

  // Reset / Clear Draft
  const handleResetDraft = async () => {
    const confirmed = await systemConfirm({
      title: 'تفريغ مسودة العطاء والبدء من جديد',
      message: 'هل أنت متأكد من تفريغ كافة بنود العطاء الحالية والبدء من جديد؟ لن يتم التأثير على المشاريع المحفوظة في قاعدة البيانات.',
      confirmText: 'نعم، أفرغ وابدأ من جديد',
      variant: 'danger',
    });
    if (!confirmed) return;

    setItems([]);
    setProjectName('');
    setClientName('');
    setCurrentProject(null);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (projectIdParam) {
      searchParams.delete('projectId');
      setSearchParams(searchParams);
    }
    setSelectedProjectId(null);
    toast.success('تم تفريغ مسودة العطاء بنجاح للبدء من جديد');
  };

  // Start New Empty Tender
  const handleStartNewTender = async () => {
    if (items.length > 0) {
      const confirmed = await systemConfirm({
        title: 'تسعير عطاء / مشروع جديد',
        message: 'هل تريد فتح مسودة تسعير جديدة؟ سيتم الاحتفاظ بالمشاريع والعطاءات السابقة المحفوظة بأمان في قاعدة البيانات.',
        confirmText: 'نعم، ابدأ تسعير عطاء جديد',
        variant: 'primary',
      });
      if (!confirmed) return;
    }
    setItems([]);
    setProjectName('');
    setClientName('');
    setCurrentProject(null);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (projectIdParam) {
      searchParams.delete('projectId');
      setSearchParams(searchParams, { replace: true });
    }
    setSelectedProjectId(null);
    toast.success('تم فتح مسودة عطاء جديدة فارغة - جاهز لاستيراد كراسة المقايسة (BOQ)');
  };

  // Switch Tender from Modal
  const handleSelectProjectFromSwitcher = (targetId: string) => {
    setSelectedProjectId(targetId);
    setSearchParams({ projectId: targetId }, { replace: true });
  };

  // Submit Bid to Client
  const handleSubmitBid = async () => {
    if (!projectIdParam) {
      toast.warning('يرجى حفظ العطاء أولاً قبل تقديمه للعميل');
      return;
    }
    const confirmed = await systemConfirm({
      title: 'تقديم العرض المالي للعميل رسمياً',
      message: 'هل أنت متأكد من تغيير حالة العطاء إلى (تم تقديم العرض - بانتظار رد العميل)؟ سيتم تسجيل تاريخ تقديم العرض واعتماد النسخة للتفاوض.',
      confirmText: 'نعم، تم تقديم العرض للعميل',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      await contractingApi.updateProject(projectIdParam, {
        status: 'submitted',
        submittedAt: new Date().toISOString(),
      });
      setCurrentProject((prev: any) => (prev ? { ...prev, status: 'submitted' } : null));
      await reloadProjects();
      toast.success('تم تحديث حالة العطاء إلى (تم تقديم العرض - بانتظار رد العميل)!');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحديث حالة العطاء');
    }
  };

  // Create Negotiation Revision (Rev-1, Rev-2...)
  const handleCreateRevision = async () => {
    if (!projectIdParam) {
      toast.warning('يرجى حفظ العطاء أولاً قبل إنشاء مراجعة جديدة');
      return;
    }
    const confirmed = await systemConfirm({
      title: 'إنشاء مراجعة تفاوضية جديدة (New Revision)',
      message: 'هل أنت متأكد من إنشاء مراجعة تفاوضية جديدة؟ سيتم نسخ بنود المقايسة وتوليد كود مراجعة جديد مع تجميد النسخة الحالية كمرجع تاريخي.',
      confirmText: 'نعم، أنشئ مراجعة جديدة',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const cloned = await contractingApi.createTenderRevision(projectIdParam);
      toast.success(`تم إنشاء مراجعة العطاء [${cloned.code}] بنجاح!`);
      await reloadProjects();
      setSelectedProjectId(cloned.id);
      setSearchParams({ projectId: String(cloned.id) }, { replace: true });
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إنشاء المراجعة');
    }
  };

  // Final Award / Save Tender (Planning vs Active)
  const handleSaveTender = async (targetStatus: 'planning' | 'active') => {
    if (!projectName.trim()) {
      toast.warning('يرجى كتابة اسم العطاء أو المشروع المقترح أولاً');
      return;
    }
    if (items.length === 0) {
      toast.warning('يرجى إضافة أو استيراد بنود العطاء أولاً');
      return;
    }

    const isAward = targetStatus === 'active';
    const confirmed = await systemConfirm({
      title: isAward ? 'اعتماد وترسية العطاء كمشروع تنفيذي ساري' : 'حفظ كعطاء قيد الدراسة والتسعير (Planning)',
      message: isAward
        ? `هل أنت متأكد من اعتماد العطاء بقيمة تعاقدية إجمالية (${formatCurrency(grandTotals.totalSellingPrice)}) وترسيته كمشروع رسمي ساري؟ سيتم تحويل المقايسة إلى SOV تنفيذي لبدء التوريدات والمستخلصات.`
        : `هل أنت متأكد من حفظ العطاء بقيمة تقديرية (${formatCurrency(grandTotals.totalSellingPrice)}) تحت قائمة (عطاءات قيد الدراسة والتسعير) لمتابعة المفاوضات وعروض الأسعار مع العميل؟`,
      confirmText: isAward ? 'نعم، اعتمد ورسِّ العطاء' : 'نعم، احفظ كعطاء قيد الدراسة',
      variant: isAward ? 'primary' : 'info',
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      let targetProjectId = projectIdParam;

      if (!targetProjectId) {
        const createRes = await contractingApi.createProject({
          name: projectName.trim(),
          clientName: clientName.trim() || 'العميل الموقر',
          contractValue: grandTotals.totalSellingPrice,
          status: targetStatus,
          retentionPercent: 5,
          notes: `تم إنشاء هذا العطاء من منصة دراسة العطاءات وتفكيك الكود (BOM). الحالة: ${isAward ? 'مشروع ساري' : 'عطاء قيد الدراسة والتسعير'}. مدة التنفيذ: ${durationMonths} شهور. التكلفة المباشرة المقدرة: ${grandTotals.totalDirectCost} ج.م.`,
        });
        targetProjectId = createRes.id;
        setSearchParams({ projectId: String(createRes.id) }, { replace: true });
      } else {
        await contractingApi.updateProject(targetProjectId, {
          name: projectName.trim(),
          clientName: clientName.trim() || 'العميل الموقر',
          contractValue: grandTotals.totalSellingPrice,
          status: targetStatus,
        });
      }

      // Ensure each item has a unique itemCode within this project to prevent collisions
      const usedItemCodes = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rates = calculateItemRates(item);

        let code = (item.itemCode || `ITEM-${String(i + 1).padStart(3, '0')}`).trim();
        if (usedItemCodes.has(code.toUpperCase())) {
          let c = 2;
          while (usedItemCodes.has(`${code}-${c}`.toUpperCase())) {
            c++;
          }
          code = `${code}-${c}`;
        }
        usedItemCodes.add(code.toUpperCase());

        const boqRes = await contractingApi.createBoqItem(targetProjectId, {
          itemCode: code,
          description: item.description,
          category: item.trade || 'general',
          unit: item.unit,
          contractQty: item.estimatedQty,
          unitPrice: rates.sellingUnitPrice,
          estimatedUnitCost: rates.directCost,
          notes: item.notes,
        });

        if (item.drawingLength || item.drawingWidth || item.drawingHeight) {
          await contractingApi.saveBoqTakeoffs(boqRes.id, {
            takeoffs: [
              {
                drawingRef: 'DWG-TND-01',
                axisRef: 'AX-ALL',
                description: 'حصر أولي من دراسة العطاء والمخططات',
                length: item.drawingLength || 0,
                width: item.drawingWidth || 1,
                height: item.drawingHeight || 1,
                countMultiplier: item.drawingCount || 1,
                voidDeduction: 0,
                netQty: item.estimatedQty,
                wastePercent: item.wastePercent || 0,
                totalWithWaste: item.estimatedQty * (1 + (item.wastePercent || 0) / 100),
              },
            ],
            syncToBoqQuantity: true,
          });
        }
      }

      localStorage.removeItem(DRAFT_STORAGE_KEY);
      await reloadProjects();
      setSelectedProjectId(targetProjectId);

      if (isAward) {
        toast.success('تمت ترسية العطاء وتأسيس المشروع وتوليد مقايسة الكميات بنجاح!');
        navigate(`/contracting/boq?projectId=${targetProjectId}`);
      } else {
        toast.success('تم حفظ العطاء بنجاح تحت عطاءات قيد الدراسة والتسعير (Planning)!');
        setSearchParams({ projectId: String(targetProjectId) }, { replace: true });
      }
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ أثناء حفظ العطاء');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }} dir="rtl">
      {/* 1. Header & Bid Setup Card */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ fontSize: 'var(--font-page-title)', fontWeight: 800, color: '#170e5e', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.Sliders size={20} />
              {t('contracting.contracting_tender_page.s0', "المرحلة 1: دراسة وتسعير العطاءات والمشروعات المحتملة (Tender & Bid Estimator)")}
            </h2>
            <p style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', margin: '4px 0 0' }}>
              {t('contracting.contracting_tender_page.s1', "حصر الكميات من المخططات وتفكيك الكود الهندسي (BOM) لضبط نسب الخامات والمصنعيات وحساب الأرباح قبل توقيع العقد.")}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleStartNewTender}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{t('contracting.contracting_tender_page.s2', "تسعير عطاء جديد")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsTenderSwitcherOpen(true)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Folder size={15} />
              <span>{t('contracting.contracting_tender_page.s3', "العطاءات المحفوظة")}</span>
              <span
                style={{
                  fontSize: 'var(--font-badge)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  background: '#f1f5f9',
                  color: '#170e5e',
                  fontWeight: 700,
                  border: '1px solid #cbd5e1',
                }}
              >
                {tendersUnderStudyCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsWorkflowMapOpen(true)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Layers size={15} />
              <span>{t('contracting.contracting_tender_page.s4', "خريطة مسار المشروع")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAutoPricingOpen(true)}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Calculator size={15} />
              <span>{t('contracting.contracting_tender_page.s5', "محرك التسعير الآلي")}</span>
            </button>

            <button
              type="button"
              disabled={items.length === 0}
              onClick={handleExportPricedExcel}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: items.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 'var(--font-body)',
                opacity: items.length > 0 ? 1 : 0.6,
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.FileSpreadsheet size={15} />
              <span>{t('contracting.contracting_tender_page.s6', "تصدير إكسيل مسعر (Excel)")}</span>
            </button>

            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => setIsQuotationOpen(true)}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: items.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 'var(--font-body)',
                opacity: items.length > 0 ? 1 : 0.6,
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Printer size={15} />
              <span>{t('contracting.contracting_tender_page.s7', "عرض سعر رسمي للعميل")}</span>
            </button>
          </div>
        </div>

        {/* شريط حالة دورة حياة العطاء وإجراءات التفاوض والترسية */}
        {projectIdParam && currentProject ? (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRight: '4px solid #170e5e',
              borderRadius: '10px',
              padding: '10px 16px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: '#170e5e', background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>
                {currentProject.code || `PRJ-${currentProject.id}`}
              </span>
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                {currentProject.name}
              </span>
              {currentProject.clientName && (
                <span style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
                  {t('contracting.contracting_tender_page.s8', "(العميل:")} {currentProject.clientName})
                </span>
              )}
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: 'var(--font-badge)',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#1e293b',
                  border: '1px solid #cbd5e1',
                }}
              >
                {currentProject.status === 'submitted'
                  ? t('contracting.contracting_tender_page.s9', "تم تقديم العرض المالي (بانتظار رد العميل)")
                  : currentProject.status === 'negotiation'
                  ? `تحت التفاوض والمراجعة (Rev-${currentProject.revisionNumber || 1})`
                  : currentProject.status === 'lost'
                  ? t('contracting.contracting_tender_page.s10', "أرشيف العطاءات غير المرسّاة")
                  : t('contracting.contracting_tender_page.s11', "عطاء قيد الدراسة والتسعير (Draft)")}
              </span>
              {Number(currentProject.revisionNumber || 0) > 0 && (
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '11px', color: '#475569', background: '#ffffff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                  Rev-{currentProject.revisionNumber}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsTenderSwitcherOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Folder size={13} />
                <span>{t('contracting.contracting_tender_page.s12', "تبديل العطاء")}</span>
              </button>

              <button
                type="button"
                onClick={handleStartNewTender}
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#170e5e',
                  border: '1px solid #170e5e',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Plus size={13} />
                <span>{t('contracting.contracting_tender_page.s13', "تسعير عطاء جديد")}</span>
              </button>

              {(currentProject.status === 'draft' || currentProject.status === 'planning') && (
                <button
                  type="button"
                  onClick={handleSubmitBid}
                  style={{
                    height: '32px',
                    padding: '0 12px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <AppIcons.CheckCircle size={13} />
                  <span>{t('contracting.contracting_tender_page.s14', "تقديم العرض للعميل")}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCreateRevision}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Copy size={13} />
                <span>{t('contracting.contracting_tender_page.s15', "إنشاء مراجعة تفاوض (Rev+)")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAwardModalOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.CheckShield size={14} />
                <span>{t('contracting.contracting_tender_page.s16', "اعتماد وترسية العطاء")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsLostModalOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Archive size={13} />
                <span>{t('contracting.contracting_tender_page.s17', "أرشفة (لم يُرسَ)")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRight: '4px solid #64748b',
              borderRadius: '10px',
              padding: '10px 16px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.Sliders size={16} style={{ color: '#170e5e' }} />
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
                {t('contracting.contracting_tender_page.s18', "مسودة عطاء جديد (جاهزة لإدخال أو سحب كراسة المقايسة BOQ)")}
              </span>
              <span style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
                {t('contracting.contracting_tender_page.s19', "- يمكنك رفع ملف المقايسة وحصر المخططات، ثم حفظ العطاء قيد الدراسة والتسعير.")}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsTenderSwitcherOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#170e5e',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Folder size={13} />
                <span>{t('contracting.contracting_tender_page.s20', "فتح عطاء محفوظ سابقاً (")}{tendersUnderStudyCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setIsWorkflowMapOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Layers size={13} />
                <span>{t('contracting.contracting_tender_page.s21', "خريطة مسار وسيناريوهات المشروع")}</span>
              </button>
            </div>
          </div>
        )}

        {/* Form Inputs Grid - سطر واحد هندسي متناسق بدون التفاف */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', width: '100%', flexWrap: 'nowrap' }}>
          <div style={{ flex: '2 1 220px', minWidth: '160px' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s22', "اسم المشروع / العطاء المقترح")}
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('contracting.contracting_tender_page.s23', "مثال: عطاء إنشاء مجمع سكني وتجاري")}
              style={{ width: '100%', height: '34px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flex: '1.5 1 170px', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s24', "العميل / جهة الإسناد")}
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={t('contracting.contracting_tender_page.s25', "اسم المالك أو جهة الطرح")}
              style={{ width: '100%', height: '34px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '95px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s26', "هامش الربح %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalProfitMargin}
              onChange={(e) => setGlobalProfitMargin(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '95px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s27', "المصاريف %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalOverhead}
              onChange={(e) => setGlobalOverhead(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '85px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s28', "الهالك %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalWaste}
              onChange={(e) => setGlobalWaste(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleApplyGlobalMargins}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: '#170e5e',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.CheckCircle size={14} />
              <span>{t('contracting.contracting_tender_page.s29', "تعميم النسب على كافة البنود")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Toolbar & CAD Takeoff Trigger */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsImportBoqOpen(true)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#f8fafc',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.FileSpreadsheet size={15} />
            <span>{t('contracting.contracting_tender_page.s30', "استيراد مقايسة Excel (BOQ)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportMasterOpen(true)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Layers size={15} />
            <span>{t('contracting.contracting_tender_page.s31', "سحب من المقايسة المرجعية (124 بند)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCadTakeoffFormOpen((prev) => !prev)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: isCadTakeoffFormOpen ? '#f1f5f9' : '#ffffff',
              color: isCadTakeoffFormOpen ? '#170e5e' : '#334155',
              border: isCadTakeoffFormOpen ? '1px solid #94a3b8' : '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Sliders size={15} />
            <span>{t('contracting.contracting_tender_page.s32', "حصر سريع من أبعاد الرسومات (CAD Takeoff)")}</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {(items.length > 0 || projectName.trim()) && (
            <button
              type="button"
              onClick={handleResetDraft}
              style={{
                height: '32px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#b91c1c',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Trash2 size={13} />
              <span>{t('contracting.contracting_tender_page.s33', "تفريغ وبدء عطاء جديد")}</span>
            </button>
          )}

          <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#64748b' }}>
            {t('contracting.contracting_tender_page.s34', "إجمالي بنود العطاء الحالية:")} <strong style={{ color: '#0f172a' }}>{items.length} {t('contracting.contracting_tender_page.s35', "بند")}</strong>
          </div>
        </div>
      </div>

      {/* 3. Expandable CAD Takeoff Calculator */}
      {isCadTakeoffFormOpen && (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px 20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#170e5e' }}>
            {t('contracting.contracting_tender_page.s36', "حاسبة الحصر السريع للأبعاد وتفكيك الكود الهندسي")}
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s37', "نوع البند")}</label>
              <select
                value={cadItemCode}
                onChange={(e) => setCadItemCode(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              >
                {engineeringConstants.map((c) => (
                  <option key={c.itemCode} value={c.itemCode}>
                    [{c.itemCode}] {c.itemName} ({c.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s38', "الطول (م)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadLength}
                onChange={(e) => setCadLength(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s39', "الارتفاع / السمك (م)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadHeight}
                onChange={(e) => setCadHeight(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s40', "عدد الحوائط / التكرار")}</label>
              <input
                type="number"
                step="1"
                min="1"
                value={cadCount}
                onChange={(e) => setCadCount(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>{t('contracting.contracting_tender_page.s41', "خصومات الأبواب والشبابيك (م²)")}</label>
              <input
                type="number"
                step="0.01"
                value={cadDeductions}
                onChange={(e) => setCadDeductions(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              />
            </div>
          </div>

          {/* Brick Dimension Selector if Masonry */}
          {cadItemCode.startsWith('BRK') && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
              <div style={{ fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                {t('contracting.contracting_tender_page.s42', "مقاس الطوب والبلوك ومعادلة حساب الاستهلاك:")}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                {BRICK_SIZE_PRESETS.slice(0, 4).map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: cadBrickPreset === p.id ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                      background: cadBrickPreset === p.id ? '#f0f4ff' : '#ffffff',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="radio"
                      name="brickPreset"
                      checked={cadBrickPreset === p.id}
                      onChange={() => setCadBrickPreset(p.id)}
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name.split('-')[0]}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{t('contracting.contracting_tender_page.s43', "معدل:")} {p.ratePerM2OrM3} {t('contracting.contracting_tender_page.s44', "طوبة/")}{p.unit}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsCadTakeoffFormOpen(false)}
              style={{ padding: '7px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '12.5px', cursor: 'pointer' }}
            >
              {t('contracting.contracting_tender_page.s45', "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleAddFromCadTakeoff}
              style={{ padding: '7px 18px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#fff', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
            >
              {t('contracting.contracting_tender_page.s46', "حصر وإضافة البند فورياً")}
            </button>
          </div>
        </div>
      )}

      {/* 4. Table of Tender Items */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: '44px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ color: '#94a3b8', marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
              <AppIcons.FileSpreadsheet size={42} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>{t('contracting.contracting_tender_page.s47', "لم يتم إضافة أي بنود لدراسة هذا العطاء بعد")}</div>
            <div style={{ fontSize: '13px', marginTop: '6px', color: '#64748b', maxWidth: '500px', marginInline: 'auto' }}>
              {t('contracting.contracting_tender_page.s48', "ارفع شيت مقايسة العطاء المسلّم من المالك (Excel)، أو اسحب بنوداً نمطية من المقايسة المرجعية، أو ابدأ بحصر سريع من اللوحات الهندسية.")}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsImportBoqOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
                }}
              >
                <AppIcons.FileSpreadsheet size={15} />
                <span>{t('contracting.contracting_tender_page.s49', "استيراد مقايسة العطاء من Excel (BOQ)")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportMasterOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                <AppIcons.Layers size={15} />
                <span>{t('contracting.contracting_tender_page.s50', "سحب من المقايسة المرجعية")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Trade & File Navigation Tabs & Subtotals */}
            {(availableSourceFiles.length > 1 || availableTrades.length > 0) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '10px 16px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginInlineEnd: '4px' }}>
                    {availableSourceFiles.length > 1 ? t('contracting.contracting_tender_page.s51', "تبويب ملفات المقايسة:") : t('contracting.contracting_tender_page.s52', "تصفية حسب التخصص:")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedTradeFilter('all')}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '20px',
                      border: selectedTradeFilter === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                      background: selectedTradeFilter === 'all' ? '#170e5e' : '#ffffff',
                      color: selectedTradeFilter === 'all' ? '#ffffff' : '#334155',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {t('contracting.contracting_tender_page.s53', "كافة البنود (")}{items.length})
                  </button>
                  {availableSourceFiles.length > 1
                    ? availableSourceFiles.map(({ fileName, count }) => {
                        const isSelected = selectedTradeFilter === `file:${fileName}`;
                        return (
                          <button
                            key={fileName}
                            type="button"
                            onClick={() => setSelectedTradeFilter(`file:${fileName}`)}
                            style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                              background: isSelected ? '#170e5e' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#334155',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {t('contracting.contracting_tender_page.s54', "ملف:")} {fileName} ({count})
                          </button>
                        );
                      })
                    : availableTrades.map((tr) => {
                        const count = items.filter((it) => it.trade === tr).length;
                        const label = TRADE_LABELS[tr] || tr;
                        const isSelected = selectedTradeFilter === tr;
                        return (
                          <button
                            key={tr}
                            type="button"
                            onClick={() => setSelectedTradeFilter(tr)}
                            style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                              background: isSelected ? '#170e5e' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#334155',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {label} ({count})
                          </button>
                        );
                      })}
                </div>

                {selectedTradeFilter !== 'all' && (
                  <div style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>
                    {t('contracting.contracting_tender_page.s55', "إجمالي")} {activeScopeLabel}:{' '}
                    <strong style={{ fontSize: '13.5px' }}>{formatCurrency(tradeSubtotal)}</strong>
                  </div>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 'var(--font-body)', textAlign: 'right' }}>
                <colgroup>
                  <col style={{ width: '85px' }} />
                  <col style={{ width: 'auto', minWidth: '220px' }} />
                  <col style={{ width: '60px' }} />
                  <col style={{ width: '85px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '75px' }} />
                  <col style={{ width: '105px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '40px' }} />
                </colgroup>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s56', "كود البند")}</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s57', "بيان الأعمال والمواصفات")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s58', "الوحدة")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s59', "الكمية")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s60', "التكلفة المباشرة")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s61', "هامش الربح %")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s62', "سعر الفئة المقترح")}</th>
                    <th style={{ padding: '10px 10px', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>{t('contracting.contracting_tender_page.s63', "إجمالي القيمة")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s64', "تفكيك الكود")}</th>
                    <th style={{ padding: '10px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'center' }}>{t('contracting.contracting_tender_page.s65', "حذف")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item) => {
                    const rates = calculateItemRates(item);
                    const isExpanded = expandedItemId === item.id;
                    const textDir = getTextDirection(item.description);

                    return (
                      <Fragment key={item.id}>
                        <tr style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}>
                          <td style={{ padding: '12px 12px', fontWeight: 700, color: '#170e5e', verticalAlign: 'middle', wordBreak: 'break-word', fontSize: '13px' }}>
                            {item.itemCode}
                          </td>
                          <td
                            style={{
                              padding: '12px 12px',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.55,
                              textAlign: 'justify',
                              textJustify: 'inter-word',
                              textAlignLast: textDir === 'rtl' ? 'right' : 'left',
                              direction: textDir,
                              color: '#1e293b',
                              verticalAlign: 'middle',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '13px' }}>{item.description}</div>
                            {item.notes && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                                {item.notes}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', color: '#475569', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', fontSize: '12.5px' }}>
                            {formatUnitLabel(item.unit)}
                          </td>
                          <td style={{ padding: '12px 8px', fontWeight: 700, color: '#0f172a', verticalAlign: 'middle', textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              value={item.estimatedQty}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, estimatedQty: val } : it)));
                              }}
                              style={{
                                width: '72px',
                                height: '28px',
                                padding: '0 4px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontSize: '12.5px',
                                fontWeight: 700,
                                textAlign: 'center',
                                color: '#0f172a',
                                background: '#ffffff',
                                boxSizing: 'border-box',
                              }}
                            />
                          </td>
                          <td style={{ padding: '12px 10px', color: '#475569', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '12.5px' }}>
                            {formatCurrency(rates.directCost)}
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.profitMarkupPercent}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, profitMarkupPercent: val } : it)));
                                }}
                                style={{
                                  width: '44px',
                                  height: '28px',
                                  padding: '0 4px',
                                  textAlign: 'center',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '12.5px',
                                  fontWeight: 700,
                                  color: '#15803d',
                                  background: '#ffffff',
                                  boxSizing: 'border-box',
                                }}
                              />
                              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>%</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 10px', fontWeight: 800, color: '#170e5e', verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '13px' }}>
                            {formatCurrency(rates.sellingUnitPrice)}
                          </td>
                          <td style={{ padding: '12px 10px', fontWeight: 800, color: '#0f172a', verticalAlign: 'middle', whiteSpace: 'nowrap', fontSize: '13px' }}>
                            {formatCurrency(rates.totalItemValue)}
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <button
                              type="button"
                              onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                              title={isExpanded ? t('contracting.contracting_tender_page.s66', "إغلاق شجرة الموارد") : t('contracting.contracting_tender_page.s67', "شجرة تحليل الموارد والتكلفة (BOM)")}
                              style={{
                                height: '28px',
                                padding: '0 10px',
                                borderRadius: '6px',
                                background: isExpanded ? '#170e5e' : '#ffffff',
                                color: isExpanded ? '#ffffff' : '#170e5e',
                                border: isExpanded ? '1px solid #170e5e' : '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxSizing: 'border-box',
                                boxShadow: isExpanded ? '0 1px 3px rgba(23,14,94,0.2)' : '0 1px 2px rgba(0,0,0,0.03)',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <AppIcons.Sliders size={12} style={{ color: isExpanded ? '#ffffff' : '#170e5e', flexShrink: 0 }} />
                              <span>{isExpanded ? t('contracting.contracting_tender_page.s68', "إغلاق") : 'BOM'}</span>
                            </button>
                          </td>
                          <td style={{ padding: '12px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <button
                              type="button"
                              title={t('contracting.contracting_tender_page.s69', "حذف البند من دراسة العطاء")}
                              onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid transparent',
                                background: 'transparent',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#dc2626';
                                e.currentTarget.style.background = '#fef2f2';
                                e.currentTarget.style.borderColor = '#fecaca';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#94a3b8';
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.borderColor = 'transparent';
                              }}
                            >
                              <AppIcons.Trash2 size={15} />
                            </button>
                          </td>
                        </tr>

                        {/* Expandable BOM Exploder */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '2px solid #cbd5e1', boxSizing: 'border-box' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px', minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: '#170e5e', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '650px' }}>
                                  <AppIcons.Sliders size={16} style={{ flexShrink: 0 }} />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: textDir }}>
                                    {t('contracting.contracting_tender_page.s70', "تفكيك الكود الهندسي وتخصيص الموارد: [")}{item.itemCode}] {item.description}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', color: '#334155' }}>
                                    {t('contracting.contracting_tender_page.s71', "كمية البند:")} <strong style={{ color: '#0f172a' }}>{item.estimatedQty.toLocaleString()} {formatUnitLabel(item.unit)}</strong>
                                  </div>
                                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', color: '#334155' }}>
                                    {t('contracting.contracting_tender_page.s72', "التكلفة المباشرة للوحدة:")} <strong style={{ color: '#170e5e', fontWeight: 800 }}>{formatCurrency(rates.directCost)}</strong>
                                  </div>
                                <button
                                  type="button"
                                  onClick={() => handleAddComponent(item.id)}
                                  style={{
                                    height: '28px',
                                    padding: '0 12px',
                                    borderRadius: '6px',
                                    border: '1px solid #170e5e',
                                    background: '#eef2ff',
                                    color: '#170e5e',
                                    fontSize: '11.5px',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <AppIcons.Plus size={13} />
                                  <span>{t('contracting.contracting_tender_page.s73', "إضافة خامة / مورد")}</span>
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                              {item.components.map((comp, cIdx) => (
                                <div
                                  key={cIdx}
                                  style={{
                                    background: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '10px 12px',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <input
                                      type="text"
                                      value={comp.componentName}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setItems((prev) =>
                                          prev.map((it) => {
                                            if (it.id !== item.id) return it;
                                            const newComps = it.components.map((c, idx) =>
                                              idx === cIdx ? { ...c, componentName: val } : c
                                            );
                                            return { ...it, components: newComps };
                                          })
                                        );
                                      }}
                                      style={{
                                        flex: 1,
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        color: '#0f172a',
                                        border: '1px solid transparent',
                                        borderRadius: '4px',
                                        padding: '2px 4px',
                                        background: 'transparent',
                                      }}
                                      onFocus={(e) => (e.target.style.border = '1px solid #94a3b8')}
                                      onBlur={(e) => (e.target.style.border = '1px solid transparent')}
                                    />
                                    <button
                                      type="button"
                                      title={t('contracting.contracting_tender_page.s74', "حذف هذا المورد من البند")}
                                      onClick={() => handleRemoveComponent(item.id, cIdx)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                        padding: '2px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        borderRadius: '4px',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
                                      onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                    >
                                      <AppIcons.Trash2 size={13} />
                                    </button>
                                  </div>

                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '3px' }}>
                                        {t('contracting.contracting_tender_page.s75', "المعدل/")}{formatUnitLabel(item.unit)}:
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
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
                                                const newComps = it.components.map((c, idx) =>
                                                  idx === cIdx ? { ...c, qtyPerUnit: val } : c
                                                );
                                                return { ...it, components: newComps };
                                              })
                                            );
                                          }}
                                          style={{
                                            width: '100%',
                                            height: '28px',
                                            padding: '0 6px',
                                            border: 'none',
                                            textAlign: 'center',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            color: '#170e5e',
                                            outline: 'none',
                                            background: 'transparent',
                                          }}
                                        />
                                        <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '0 7px', height: '28px', display: 'flex', alignItems: 'center', borderInlineStart: '1px solid #e2e8f0', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                          {formatUnitLabel(comp.unit, comp.componentCode)}
                                        </span>
                                      </div>
                                    </div>

                                    <div>
                                      <label style={{ display: 'block', fontSize: '10.5px', color: '#475569', fontWeight: 600, marginBottom: '3px' }}>
                                        {t('contracting.contracting_tender_page.s76', "سعر الوحدة:")}
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
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
                                                const newComps = it.components.map((c, idx) =>
                                                  idx === cIdx ? { ...c, unitRate: val } : c
                                                );
                                                return { ...it, components: newComps };
                                              })
                                            );
                                          }}
                                          style={{
                                            width: '100%',
                                            height: '28px',
                                            padding: '0 6px',
                                            border: 'none',
                                            textAlign: 'center',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            color: '#15803d',
                                            outline: 'none',
                                            background: 'transparent',
                                          }}
                                        />
                                        <span style={{ fontSize: '10.5px', color: '#475569', background: '#f1f5f9', padding: '0 7px', height: '28px', display: 'flex', alignItems: 'center', borderInlineStart: '1px solid #e2e8f0', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                          {t('contracting.contracting_tender_page.s77', "ج.م")}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #f1f5f9', fontSize: '11px', color: '#64748b' }}>
                                    <span>{t('contracting.contracting_tender_page.s78', "إجمالي احتياج المشروع (شامل الهالك):")}</span>
                                    <strong style={{ color: '#0f172a', direction: 'ltr', display: 'inline-block' }}>
                                      {(comp.qtyPerUnit * item.estimatedQty * (1 + (item.wastePercent || 0) / 100)).toLocaleString(undefined, { maximumFractionDigits: 1 })} {formatUnitLabel(comp.unit, comp.componentCode)}
                                    </strong>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', fontSize: '11px', color: '#64748b' }}>
                                    <span>{t('contracting.contracting_tender_page.s79', "حصة")} {formatUnitLabel(item.unit)} {t('contracting.contracting_tender_page.s80', "من التكلفة المباشرة:")}</span>
                                    <strong style={{ color: '#170e5e', fontWeight: 800 }}>
                                      {formatCurrency(comp.qtyPerUnit * comp.unitRate)}
                                    </strong>
                                  </div>
                                </div>
                              ))}
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
      )}
    </div>

      {/* 5. Consolidated Pre-Procurement MRP Materials Takeoff */}
      {consolidatedMaterials.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px' }}>
          <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AppIcons.Box size={18} />
            {t('contracting.contracting_tender_page.s81', "إجمالي الموارد والخامات التقديرية لتنفيذ العطاء بالكامل (Pre-Procurement Materials Takeoff)")}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            {consolidatedMaterials.slice(0, 8).map((mat, mIdx) => (
              <div key={mIdx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{mat.name}</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: '3px 0' }}>
                  {mat.totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} {mat.unit}
                </div>
                <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600 }}>
                  {t('contracting.contracting_tender_page.s82', "التكلفة:")} {formatCurrency(mat.totalCost)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Bottom Sticky Award Bar */}
      <div
        style={{
          position: 'sticky',
          bottom: '20px',
          zIndex: 10,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          padding: '14px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_tender_page.s83', "إجمالي التكلفة المباشرة")}</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(grandTotals.totalDirectCost)}</div>
          </div>

          <div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_tender_page.s84', "صافي الربح المتوقع (")}{grandTotals.profitMargin.toFixed(1)}%)</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#15803d' }}>{formatCurrency(grandTotals.totalProfit)}</div>
          </div>

          <div>
            <div style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>{t('contracting.contracting_tender_page.s85', "إجمالي قيمة العطاء للعميل")}</div>
            <div style={{ fontSize: '19px', fontWeight: 800, color: '#170e5e' }}>{formatCurrency(grandTotals.totalSellingPrice)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={handleExportPricedClientExcel}
            title={t('contracting.contracting_tender_page.s86', "تصدير شيت العميل الأصلي بنفس ألوانه وديباجته وتنسيقاته مع كتابة الأسعار فقط")}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Download size={15} />
            <span>{t('contracting.contracting_tender_page.s87', "تصدير شيت العميل المسعر (Excel)")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => setIsQuotationOpen(true)}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Printer size={15} />
            <span>{t('contracting.contracting_tender_page.s88', "عرض السعر للعميل")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSaveTender('planning')}
            style={{
              height: '40px',
              padding: '0 18px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Save size={16} />
            <span>{isSubmitting ? t('contracting.contracting_tender_page.s89', "جاري الحفظ...") : t('contracting.contracting_tender_page.s90', "حفظ كعطاء قيد الدراسة (Planning)")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSaveTender('active')}
            style={{
              height: '40px',
              padding: '0 20px',
              borderRadius: '8px',
              fontWeight: 800,
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              boxShadow: '0 2px 6px rgba(23, 14, 94, 0.25)',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
            }}
          >
            <AppIcons.CheckShield size={17} />
            <span>{isSubmitting ? t('contracting.contracting_tender_page.s91', "جاري الترسية والتأسيس...") : t('contracting.contracting_tender_page.s92', "اعتماد وترسية العطاء كمشروع رسمي")}</span>
          </button>
        </div>
      </div>

      {/* Sub-modals */}
      {isImportBoqOpen && (
        <ImportBoqModal
          open={isImportBoqOpen}
          projectName={projectName}
          existingItemCount={items.length}
          onClose={() => setIsImportBoqOpen(false)}
          onImportItems={(parsedRows, mode = 'append') => {
            const newTenderItems: TenderItem[] = parsedRows.map((r, idx) => {
              const matchedConstant = matchEngineeringConstant(r.description, r.itemCode, engineeringConstants);

              const fallbackCode = `BOQ-${String(items.length + idx + 1).padStart(3, '0')}`;
              const itemCode = r.itemCode && r.itemCode.trim() ? r.itemCode.trim() : (matchedConstant ? matchedConstant.itemCode : fallbackCode);
              const unit = r.unit || (matchedConstant ? matchedConstant.unit : 'item');
              const estimatedQty = r.contractQty > 0 ? r.contractQty : 1;

              // Derive components (BOM)
              let components: TenderItemComponent[] = [];
              if (matchedConstant?.components && matchedConstant.components.length > 0) {
                components = matchedConstant.components.map((c: any) => ({
                  componentCode: c.componentCode || `MAT-${itemCode}`,
                  componentName: c.componentName || c.name || r.description,
                  unit: c.unit || unit,
                  qtyPerUnit: Number(c.qtyPerUnit || 1),
                  unitRate: Number(c.unitRate || 0),
                  componentType: c.componentType || 'material',
                }));
              } else {
                const calculatedCost = r.estimatedUnitCost > 0
                  ? r.estimatedUnitCost
                  : (r.unitPrice > 0 ? roundMoneyValue(r.unitPrice / (1 + (globalProfitMargin + globalOverhead + globalWaste) / 100), bookDigits) : 0);

                components = [
                  {
                    componentCode: `MAT-${itemCode}`,
                    componentName: `خامات وتوريدات: ${r.description.slice(0, 45)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(calculatedCost * 0.7, bookDigits),
                    componentType: 'material',
                  },
                  {
                    componentCode: `LAB-${itemCode}`,
                    componentName: `مصنعيات وتركيب: ${r.description.slice(0, 45)}`,
                    unit,
                    qtyPerUnit: 1,
                    unitRate: roundMoneyValue(calculatedCost * 0.3, bookDigits),
                    componentType: 'labor',
                  },
                ];
              }

              const trade = r.category && r.category !== 'general'
                ? r.category
                : (matchedConstant?.trade || 'general');

              return {
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode,
                description: r.description,
                unit,
                estimatedQty,
                trade,
                sourceFileName: r.sourceFileName,
                sourceSheetName: r.sourceSheetName,
                rawRowIdx: r.rawRowIdx,
                components,
                wastePercent: matchedConstant?.wastePercent ?? globalWaste,
                overheadPercent: matchedConstant?.overheadPercent ?? globalOverhead,
                profitMarkupPercent: matchedConstant?.profitMarkupPercent ?? globalProfitMargin,
                notes: r.notes || matchedConstant?.notes,
              };
            });

            if (mode === 'append' && items.length > 0) {
              setItems((prev) => [...prev, ...newTenderItems]);
              toast.success(`تم إلحاق وتفكيك وتسعير ${newTenderItems.length} بند جديد بالمشروع بنجاح`);
            } else {
              setItems(newTenderItems);
              toast.success(`تم استيراد وتفكيك وتسعير ${newTenderItems.length} بند من المقايسة بنجاح`);
            }
            setIsImportBoqOpen(false);
          }}
        />
      )}

      {isImportMasterOpen && (
        <ImportMasterBoqModal
          open={isImportMasterOpen}
          onClose={() => setIsImportMasterOpen(false)}
          onImportSelected={async (selectedIds) => {
            try {
              const allMaster = await contractingApi.getMasterBoqLibrary({});
              const selectedMaster = allMaster.filter((it: any) => selectedIds.includes(it.id));
              const newTenderItems: TenderItem[] = selectedMaster.map((masterItem: any) => ({
                id: `TND-${Math.random().toString(36).slice(2, 9)}`,
                itemCode: masterItem.itemCode,
                description: masterItem.description || masterItem.name,
                unit: masterItem.unit,
                estimatedQty: 100,
                trade: masterItem.tradeCategory || 'general',
                components: [
                  {
                    componentCode: `MAT-${masterItem.itemCode}`,
                    componentName: masterItem.name,
                    unit: masterItem.unit,
                    qtyPerUnit: 1,
                    unitRate: masterItem.standardCost || 50,
                    componentType: 'material',
                  },
                ],
                wastePercent: globalWaste,
                overheadPercent: globalOverhead,
                profitMarkupPercent: globalProfitMargin,
              }));
              setItems((prev) => [...prev, ...newTenderItems]);
              setIsImportMasterOpen(false);
              toast.success(`تم استيراد ${newTenderItems.length} بند من بنك المقايسات المرجعي`);
            } catch (err) {
              console.error(err);
            }
          }}
        />
      )}

      {isAutoPricingOpen && (
        <AutoPricingModal
          isOpen={isAutoPricingOpen}
          onClose={() => setIsAutoPricingOpen(false)}
          onApplyPrice={(_unitPrice, estimatedCost) => {
            setItems((prev) =>
              prev.map((item) => ({
                ...item,
                components: item.components.map((c) => ({ ...c, unitRate: estimatedCost })),
              }))
            );
            setIsAutoPricingOpen(false);
            toast.success(t('contracting.contracting_tender_page.s93', "تم تطبيق أسعار ونسب التسعير الآلي بنجاح"));
          }}
        />
      )}

      {isQuotationOpen && (
        <ClientQuotationModal
          isOpen={isQuotationOpen}
          onClose={() => setIsQuotationOpen(false)}
          projectName={projectName}
          clientName={clientName}
          items={items.map((item) => {
            const rates = calculateItemRates(item);
            return {
              id: item.id,
              projectId: '',
              itemCode: item.itemCode,
              description: item.description,
              category: item.trade,
              sourceFileName: item.sourceFileName,
              sourceSheetName: item.sourceSheetName,
              rawRowIdx: item.rawRowIdx,
              unit: item.unit,
              contractQty: item.estimatedQty,
              revisedQty: item.estimatedQty,
              unitPrice: rates.sellingUnitPrice,
              estimatedUnitCost: rates.directCost,
              totalPrice: rates.totalItemValue,
              executedQty: 0,
              createdAt: new Date().toISOString(),
            };
          })}
        />
      )}

      {/* Mark Tender Lost Modal */}
      {isLostModalOpen && projectIdParam && (
        <MarkTenderLostModal
          open={isLostModalOpen}
          projectId={projectIdParam}
          projectCode={currentProject?.code}
          projectName={projectName}
          onClose={() => setIsLostModalOpen(false)}
          onSuccess={async () => {
            await reloadProjects();
            setCurrentProject((prev: any) => (prev ? { ...prev, status: 'lost' } : null));
          }}
        />
      )}

      {/* Award Tender Modal */}
      {isAwardModalOpen && projectIdParam && (
        <AwardTenderModal
          open={isAwardModalOpen}
          projectId={projectIdParam}
          projectCode={currentProject?.code}
          projectName={projectName}
          clientName={clientName}
          contractValue={grandTotals.totalSellingPrice}
          initialDownPayment={Math.round(grandTotals.totalSellingPrice * 0.1)}
          initialRetentionPercent={5}
          onClose={() => setIsAwardModalOpen(false)}
          onSuccess={async () => {
            await reloadProjects();
            navigate(`/contracting/boq?projectId=${projectIdParam}`);
          }}
        />
      )}

      {/* Tender Switcher Modal */}
      {isTenderSwitcherOpen && (
        <TenderSwitcherModal
          open={isTenderSwitcherOpen}
          currentProjectId={projectIdParam}
          onClose={() => setIsTenderSwitcherOpen(false)}
          onSelectProject={(selectedId) => {
            handleSelectProjectFromSwitcher(selectedId);
          }}
          onNewTender={() => {
            handleStartNewTender();
          }}
        />
      )}

      {/* Contracting Lifecycle Workflow Map Modal */}
      {isWorkflowMapOpen && (
        <ContractingWorkflowMapModal
          open={isWorkflowMapOpen}
          onClose={() => setIsWorkflowMapOpen(false)}
        />
      )}
    </div>
  );
}
