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
import { TenderModals } from './tender/TenderModals';
import { TenderTotalsBar } from './tender/TenderTotalsBar';
import { TenderItemsTable } from './tender/TenderItemsTable';
import { TenderCadCalculator } from './tender/TenderCadCalculator';
import { TenderToolbar } from './tender/TenderToolbar';
import { TenderFormGrid } from './tender/TenderFormGrid';
import { TenderLifecycleStrip } from './tender/TenderLifecycleStrip';
import { TenderHeaderTop } from './tender/TenderHeaderTop';
import type { TenderItem, TenderItemComponent } from './tender/tender-page-types';

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
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <TenderHeaderTop items={items} tendersUnderStudyCount={tendersUnderStudyCount} handleStartNewTender={handleStartNewTender} handleExportPricedExcel={handleExportPricedExcel} setIsTenderSwitcherOpen={setIsTenderSwitcherOpen} setIsWorkflowMapOpen={setIsWorkflowMapOpen} setIsAutoPricingOpen={setIsAutoPricingOpen} setIsQuotationOpen={setIsQuotationOpen} />

        <TenderLifecycleStrip projectIdParam={projectIdParam} currentProject={currentProject} tendersUnderStudyCount={tendersUnderStudyCount} handleStartNewTender={handleStartNewTender} handleSubmitBid={handleSubmitBid} handleCreateRevision={handleCreateRevision} setIsTenderSwitcherOpen={setIsTenderSwitcherOpen} setIsAwardModalOpen={setIsAwardModalOpen} setIsLostModalOpen={setIsLostModalOpen} setIsWorkflowMapOpen={setIsWorkflowMapOpen} />

        <TenderFormGrid projectName={projectName} setProjectName={setProjectName} clientName={clientName} setClientName={setClientName} globalProfitMargin={globalProfitMargin} setGlobalProfitMargin={setGlobalProfitMargin} globalOverhead={globalOverhead} setGlobalOverhead={setGlobalOverhead} globalWaste={globalWaste} setGlobalWaste={setGlobalWaste} handleApplyGlobalMargins={handleApplyGlobalMargins} />
      </div>

      <TenderToolbar setIsImportBoqOpen={setIsImportBoqOpen} setIsImportMasterOpen={setIsImportMasterOpen} setIsCadTakeoffFormOpen={setIsCadTakeoffFormOpen} isCadTakeoffFormOpen={isCadTakeoffFormOpen} items={items} projectName={projectName} handleResetDraft={handleResetDraft} />

      <TenderCadCalculator isCadTakeoffFormOpen={isCadTakeoffFormOpen} setIsCadTakeoffFormOpen={setIsCadTakeoffFormOpen} engineeringConstants={engineeringConstants} cadItemCode={cadItemCode} setCadItemCode={setCadItemCode} cadLength={cadLength} setCadLength={setCadLength} cadHeight={cadHeight} setCadHeight={setCadHeight} cadCount={cadCount} setCadCount={setCadCount} cadDeductions={cadDeductions} setCadDeductions={setCadDeductions} cadBrickPreset={cadBrickPreset} setCadBrickPreset={setCadBrickPreset} handleAddFromCadTakeoff={handleAddFromCadTakeoff} />

      <TenderItemsTable items={items} setItems={setItems} expandedItemId={expandedItemId} setExpandedItemId={setExpandedItemId} selectedTradeFilter={selectedTradeFilter} setSelectedTradeFilter={setSelectedTradeFilter} availableTrades={availableTrades} availableSourceFiles={availableSourceFiles} displayedItems={displayedItems} tradeSubtotal={tradeSubtotal} activeScopeLabel={activeScopeLabel} TRADE_LABELS={TRADE_LABELS} calculateItemRates={calculateItemRates} formatCurrency={formatCurrency} handleAddComponent={handleAddComponent} handleRemoveComponent={handleRemoveComponent} setIsImportBoqOpen={setIsImportBoqOpen} setIsImportMasterOpen={setIsImportMasterOpen} />

      <TenderTotalsBar consolidatedMaterials={consolidatedMaterials} grandTotals={grandTotals} items={items} isSubmitting={isSubmitting} formatCurrency={formatCurrency} handleExportPricedClientExcel={handleExportPricedClientExcel} setIsQuotationOpen={setIsQuotationOpen} handleSaveTender={handleSaveTender} />

      <TenderModals
        isImportBoqOpen={isImportBoqOpen}
        setIsImportBoqOpen={setIsImportBoqOpen}
        projectName={projectName}
        items={items}
        setItems={setItems}
        engineeringConstants={engineeringConstants}
        globalProfitMargin={globalProfitMargin}
        globalOverhead={globalOverhead}
        globalWaste={globalWaste}
        bookDigits={bookDigits}
        isImportMasterOpen={isImportMasterOpen}
        setIsImportMasterOpen={setIsImportMasterOpen}
        isAutoPricingOpen={isAutoPricingOpen}
        setIsAutoPricingOpen={setIsAutoPricingOpen}
        isQuotationOpen={isQuotationOpen}
        setIsQuotationOpen={setIsQuotationOpen}
        clientName={clientName}
        calculateItemRates={calculateItemRates}
        isLostModalOpen={isLostModalOpen}
        setIsLostModalOpen={setIsLostModalOpen}
        projectIdParam={projectIdParam}
        currentProject={currentProject}
        setCurrentProject={setCurrentProject}
        reloadProjects={reloadProjects}
        isAwardModalOpen={isAwardModalOpen}
        setIsAwardModalOpen={setIsAwardModalOpen}
        grandTotals={grandTotals}
        navigate={navigate}
        isTenderSwitcherOpen={isTenderSwitcherOpen}
        setIsTenderSwitcherOpen={setIsTenderSwitcherOpen}
        handleSelectProjectFromSwitcher={handleSelectProjectFromSwitcher}
        handleStartNewTender={handleStartNewTender}
        isWorkflowMapOpen={isWorkflowMapOpen}
        setIsWorkflowMapOpen={setIsWorkflowMapOpen}
      />
    </div>
  );
}
