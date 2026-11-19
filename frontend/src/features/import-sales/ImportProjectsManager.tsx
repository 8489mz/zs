import React, { useState } from 'react';
import {
  useImportProjectsQuery,
  useCreateImportProjectMutation,
  useCalculateFeasibilityMutation,
  useConvertFeasibilityToProjectMutation,
  useUpdateImportProjectMutation,
  useCloseProjectMutation,
  useApprovalRequestsQuery,
  useCreateApprovalRequestMutation,
  useCustomsTariffsQuery,
  useCustomsTariffSectorsQuery,
  useSectorPresetsQuery,
  usePartnersQuery,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';
import {
  normalizeFeasibilityNumber,
} from './utils/import-display-formatters';
import {
  buildTruckPartsPreset,
  EMPTY_FEASIBILITY_COSTS,
} from './feasibility-preset';
import { ImportProjectsTable } from './components/ImportProjectsTable';
import { FeasibilityPresetParams } from './components/FeasibilityPresetParams';
import { FeasibilityItemsGrid } from './components/FeasibilityItemsGrid';
import { FeasibilityResultsLogistics } from './components/FeasibilityResultsLogistics';
import { FeasibilityResultsScenarios } from './components/FeasibilityResultsScenarios';
import { NewProjectDialog } from './components/NewProjectDialog';
import { CloseProjectDialog } from './components/CloseProjectDialog';
import { TariffPickerDialog } from './components/TariffPickerDialog';

export default function ImportProjectsManager() {
  const { data: projects = [], isLoading: isProjectsLoading, refetch } = useImportProjectsQuery();
  const createProjectMutation = useCreateImportProjectMutation();
  const calculateFeasibilityMutation = useCalculateFeasibilityMutation();
  const convertFeasibilityMutation = useConvertFeasibilityToProjectMutation();
  // I1-P2: the project whose feasibility study is open in the engine dialog.
  // Approval transitions THIS project; null when the engine was opened
  // standalone (header button), where approval is not available.
  const [feasibilityProjectId, setFeasibilityProjectId] = useState<string | null>(null);
  const updateProjectMutation = useUpdateImportProjectMutation(feasibilityProjectId ?? '');
  const closeProjectMutation = useCloseProjectMutation();
  const { data: approvalRequests = [], refetch: refetchApprovals } = useApprovalRequestsQuery();
  const createApprovalMutation = useCreateApprovalRequestMutation();

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isFeasibilityOpen, setIsFeasibilityOpen] = useState(false);
  const [closingProject, setClosingProject] = useState<any | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  // New Project Form State
  const [projectTitle, setProjectTitle] = useState('');
  const [targetMarket, setTargetMarket] = useState('السوق المحلي المصري');
  const [countryOrigin, setCountryOrigin] = useState('الصين');
  const [targetSector, setTargetSector] = useState('commercial_vehicles_spare_parts');
  // Sector preset for catalog creation on import: '' = generic
  // (no invented category, barcode or markup). Chosen explicitly.
  const [sectorPreset, setSectorPreset] = useState('');
  const { data: sectorPresets = [] } = useSectorPresetsQuery();
  const [budgetCurrency, setBudgetCurrency] = useState<'EGP' | 'USD'>('EGP');
  const [allocatedCapital, setAllocatedCapital] = useState<number>(6000000);
  const [targetRoi, setTargetRoi] = useState<number>(25);
  const [containerType, setContainerType] = useState('40FT');
  const [containerCount, setContainerCount] = useState<number>(1);
  const [portOfDischarge, setPortOfDischarge] = useState('العين السخنة');
  const [incoterms, setIncoterms] = useState('FOB');
  const [projectNotes, setProjectNotes] = useState('');

  // Project Partners State (Dynamic & Non-hardcoded)
  const { data: partnersData = [] } = usePartnersQuery();
  const [selectedPartners, setSelectedPartners] = useState<
    Array<{ id: string; partnerId: string; name: string; capitalShare: number; profitPercentage: number; isSelected: boolean }>
  >([]);

  // Synchronize partners when partnersData changes or initialize clean editable rows
  React.useEffect(() => {
    if (partnersData && partnersData.length > 0) {
      const defaultEqualShare = Number((100 / partnersData.length).toFixed(1));
      const defaultCapitalShare = Math.round(allocatedCapital / partnersData.length);
      setSelectedPartners(
        partnersData.map((p: any) => ({
          id: p.id,
          partnerId: p.id,
          name: p.name,
          capitalShare: Number(p.capital_amount || defaultCapitalShare),
          profitPercentage: Number(p.profit_share_percentage || defaultEqualShare),
          isSelected: true,
        }))
      );
    } else {
      setSelectedPartners([
        { id: 'p_1', partnerId: '', name: 'الشريك 1 (المستثمر الرئيسي)', capitalShare: Math.round(allocatedCapital / 2), profitPercentage: 50, isSelected: true },
        { id: 'p_2', partnerId: '', name: 'الشريك 2 (الشريك التشغيلي / التجاري)', capitalShare: Math.round(allocatedCapital / 2), profitPercentage: 50, isSelected: true },
      ]);
    }
  }, [partnersData]);

  const handleAddPartner = () => {
    const nextIdx = selectedPartners.length + 1;
    const activeCount = selectedPartners.filter((p) => p.isSelected).length + 1;
    const newPartner = {
      id: `p_${Date.now()}_${Math.random()}`,
      partnerId: '',
      name: `شريك جديد ${nextIdx}`,
      capitalShare: Math.round(allocatedCapital / Math.max(1, activeCount)),
      profitPercentage: Number((100 / Math.max(1, activeCount)).toFixed(1)),
      isSelected: true,
    };
    setSelectedPartners((prev) => [...prev, newPartner]);
    toast.success(`تمت إضافة شريك جديد (${newPartner.name})`);
  };

  const handleRemovePartner = (idx: number) => {
    if (selectedPartners.length <= 1) {
      toast.warning('يجب الإبقاء على شريك واحد على الأقل في هيكل المشروع.');
      return;
    }
    const removedName = selectedPartners[idx]?.name || 'الشريك';
    setSelectedPartners((prev) => prev.filter((_, i) => i !== idx));
    toast.info(`تم حذف ${removedName} من قائمة الشركاء`);
  };

  const handleDistributeEqualPercentages = () => {
    const active = selectedPartners.filter((p) => p.isSelected);
    if (active.length === 0) {
      toast.warning('يرجى تفعيل شريك واحد على الأقل أولاً');
      return;
    }
    const share = Number((100 / active.length).toFixed(1));
    const shareCapital = Math.round(allocatedCapital / active.length);
    setSelectedPartners((prev) =>
      prev.map((p) => {
        if (!p.isSelected) return { ...p, profitPercentage: 0, capitalShare: 0 };
        return { ...p, profitPercentage: share, capitalShare: shareCapital };
      })
    );
    toast.success(`تم توزيع نسب الأرباح (${share}%) وحصص رأس المال بالتساوي على ${active.length} شركاء`);
  };

  const handleDistributeByCapital = () => {
    const active = selectedPartners.filter((p) => p.isSelected);
    if (active.length === 0) return;
    const totalCap = active.reduce((acc, p) => acc + Number(p.capitalShare || 0), 0);
    if (totalCap <= 0) {
      toast.warning('يرجى إدخال مبالغ حصص رأس المال أولاً لحساب النسب التناسبية للأرباح');
      return;
    }
    setSelectedPartners((prev) =>
      prev.map((p) => {
        if (!p.isSelected) return { ...p, profitPercentage: 0 };
        const share = Number(((Number(p.capitalShare || 0) / totalCap) * 100).toFixed(1));
        return { ...p, profitPercentage: share };
      })
    );
    toast.success('تم احتساب وتوزيع نسب الأرباح تناسبياً طبقاً لحصة كل شريك في رأس المال');
  };

  const handleGenerateSuggestedTitle = () => {
    const sectorObj = availableSectors.find((s: any) => s.id === targetSector);
    const sectorName = sectorObj ? sectorObj.name_ar.split('(')[0].trim() : 'بضائع استيرادية';
    const containerDesc =
      containerType === '40FT'
        ? 'حاوية 40 قدم'
        : containerType === '40HC'
        ? 'حاوية 40HC مرتفعة'
        : containerType === '20FT'
        ? 'حاوية 20 قدم'
        : 'شحنة مجزأة LCL';
    const year = new Date().getFullYear();
    setProjectTitle(`مشروع استيراد ${containerCount > 1 ? `${containerCount}x ` : ''}${containerDesc} - ${sectorName} - ${year}`);
    toast.success('تم توليد وتعبئة اسم مقترح للمشروع');
  };

  // Feasibility Study State
  const [commRate, setCommRate] = useState<number>(50);
  const [custRate, setCustRate] = useState<number>(50);
  // I2-P8: a fresh study starts with NO assumed costs. The old
  // hardcoded values (freight $3,500, clearance 48,000 EGP, travel
  // 15,000 EGP) now live only in the truck-parts preset
  // (feasibility-preset.ts) and are applied when the user picks it.
  const [shippingUsd, setShippingUsd] = useState<number>(EMPTY_FEASIBILITY_COSTS.shippingUsd);
  const [insuranceUsd, setInsuranceUsd] = useState<number>(EMPTY_FEASIBILITY_COSTS.insuranceUsd);
  const [customsDutyPercent, setCustomsDutyPercent] = useState<number>(5);
  const [vatPercent, setVatPercent] = useState<number>(14);
  const [clearanceEgp, setClearanceEgp] = useState<number>(EMPTY_FEASIBILITY_COSTS.clearanceEgp);
  const [transportEgp, setTransportEgp] = useState<number>(EMPTY_FEASIBILITY_COSTS.transportEgp);
  const [travelEgp, setTravelEgp] = useState<number>(EMPTY_FEASIBILITY_COSTS.travelEgp);
  const [targetMarkup, setTargetMarkup] = useState<number>(30);

  // I2-P8: a fresh study starts with ZERO forced rows. The 5
  // truck-parts rows the form used to pre-load on every new study
  // are now the selectable preset in feasibility-preset.ts.
  const [items, setItems] = useState<Array<{
    name: string;
    // I1-P1: link to the real inventory item. I6-A: the feasibility
    // engine carries this through to its output items natively, so
    // the stored study keeps the link per line, in any order.
    productId?: number | '';
    partNumber?: string;
    oemNumber?: string;
    hsCode: string;
    // I2-P9: numeric grid fields also hold in-progress decimal text
    // ("0.", "0.0") while the user types — see
    // parseFeasibilityNumberInput. They are normalized back to numbers
    // in handleRunFeasibility before the engine call.
    qty: number | string;
    factoryPriceUsd: number | string;
    unitWeightKg?: number | string;
    unitCbm?: number | string;
    expectedLocalMarketPriceEgp?: number | string;
  }>>([]);

  // I2-P8: whether the user has chosen how this fresh study starts
  // (truck-parts preset or empty manual start). False until a choice
  // is made, or until a stored study is loaded for a project.
  const [hasChosenFeasibilityPreset, setHasChosenFeasibilityPreset] = useState(false);

  const [feasibilityResult, setFeasibilityResult] = useState<any>(null);

  // Egypt Customs Tariffs & Truck Spare Parts Picker State
  const [isTariffPickerOpen, setIsTariffPickerOpen] = useState(false);
  const [pickerSector, setPickerSector] = useState('commercial_vehicles_spare_parts');
  const [pickerSearch, setPickerSearch] = useState('');

  const { data: tariffSectors = [] } = useCustomsTariffSectorsQuery();
  const { data: tariffsData = [], isLoading: isTariffsLoading } = useCustomsTariffsQuery(pickerSearch, pickerSector);
  // I1-P1: real inventory items for the per-line picker that links a
  // feasibility item to the catalog product the PI->PO chain needs.
  const { data: products = [] } = useProductsQuery();

  const availableSectors =
    tariffSectors && tariffSectors.length > 0
      ? tariffSectors
      : [
          { id: 'commercial_vehicles_spare_parts', name_ar: 'قطع غيار سيارات النقل والتريلات (5%)' },
          { id: 'electronics_it', name_ar: 'الإلكترونيات والاتصالات' },
          { id: 'home_appliances', name_ar: 'الأجهزة الكهربائية والمنزلية' },
          { id: 'textiles_garments', name_ar: 'الملابس والمنسوجات' },
          { id: 'plastics_raw', name_ar: 'اللدائن ومستلزمات التعبئة' },
          { id: 'sanitary_building', name_ar: 'الأدوات الصحية ومواد البناء' },
        ];

  // Strictly filter items by sector to prevent cross-sector contamination
  const displayedTariffs = tariffsData.filter((t: any) => {
    if (pickerSector && pickerSector !== 'all') {
      return t.sector === pickerSector;
    }
    return true;
  });

  const getRealisticTariffDefaults = (tariff: any) => {
    const code = (tariff.hs_code || '').trim();
    const desc = (tariff.description_ar || '').toLowerCase();

    // 1. أعمدة كرانك وأعمدة كامات (Crankshafts & Camshafts)
    if (code.startsWith('8483.10') || desc.includes('كرانك') || desc.includes('كامات')) {
      return { qty: 40, factoryPriceUsd: 145, unitWeightKg: 55, unitCbm: 0.048, expectedLocalMarketPriceEgp: 15500 };
    }
    // 2. شواحن توربينية / تيربو (Turbochargers)
    if (code.startsWith('8414.80') || desc.includes('توربين') || desc.includes('تيربو')) {
      return { qty: 60, factoryPriceUsd: 95, unitWeightKg: 9.5, unitCbm: 0.018, expectedLocalMarketPriceEgp: 10500 };
    }
    // 3. ضواغط هواء فرامل / كمبروسور (Air Compressors)
    if (code.startsWith('8414.40') || desc.includes('ضواغط') || desc.includes('كمبروسور')) {
      return { qty: 80, factoryPriceUsd: 68, unitWeightKg: 14, unitCbm: 0.024, expectedLocalMarketPriceEgp: 7200 };
    }
    // 4. أطقم دبرياج كاملة / أسطوانات ودسك (Clutches)
    if (code.startsWith('8708.93') || desc.includes('دبرياج')) {
      return { qty: 80, factoryPriceUsd: 88, unitWeightKg: 28, unitCbm: 0.040, expectedLocalMarketPriceEgp: 7800 };
    }
    // 5. محاور قيادة ودفرنسيل / كرونا (Differential & Axles)
    if (code.startsWith('8708.50') || desc.includes('دفرنسيل') || desc.includes('كورونا') || desc.includes('كردان')) {
      return { qty: 30, factoryPriceUsd: 180, unitWeightKg: 65, unitCbm: 0.065, expectedLocalMarketPriceEgp: 19500 };
    }
    // 6. فتيس وتروس شاحنات (Gearbox & Transmission)
    if (code.startsWith('8708.40') || desc.includes('فتيس') || desc.includes('تروس')) {
      return { qty: 50, factoryPriceUsd: 120, unitWeightKg: 35, unitCbm: 0.042, expectedLocalMarketPriceEgp: 12800 };
    }
    // 7. بساتم وشنابر وسلندرات (Pistons & Liners)
    if (code.startsWith('8409.99') || desc.includes('بساتم') || desc.includes('شنابر') || desc.includes('صبابات')) {
      return { qty: 150, factoryPriceUsd: 45, unitWeightKg: 12, unitCbm: 0.022, expectedLocalMarketPriceEgp: 3800 };
    }
    // 8. محركات ديزل كاملة (Diesel Engines)
    if (code.startsWith('8408.20') || desc.includes('محركات ديزل كاملة')) {
      return { qty: 4, factoryPriceUsd: 2200, unitWeightKg: 680, unitCbm: 1.45, expectedLocalMarketPriceEgp: 230000 };
    }
    // 9. طلمبات حقن ديزل ورشاشات جاز (Fuel Injection)
    if (code.startsWith('8413.30.10') || desc.includes('طلمبات حقن') || desc.includes('رشاشات')) {
      return { qty: 100, factoryPriceUsd: 58, unitWeightKg: 6.5, unitCbm: 0.012, expectedLocalMarketPriceEgp: 5800 };
    }
    // 10. طلمبات مياه وزيت (Water & Oil Pumps)
    if (code.startsWith('8413.30.20') || desc.includes('طلمبات تدوير مياه') || desc.includes('طلمبات زيت')) {
      return { qty: 100, factoryPriceUsd: 24, unitWeightKg: 4.8, unitCbm: 0.009, expectedLocalMarketPriceEgp: 2400 };
    }
    // 11. رادياتيرات ومشعات تبريد (Radiators & Intercoolers)
    if (code.startsWith('8708.91') || desc.includes('مشعات') || desc.includes('رادياتير')) {
      return { qty: 60, factoryPriceUsd: 52, unitWeightKg: 12.5, unitCbm: 0.038, expectedLocalMarketPriceEgp: 5200 };
    }
    // 12. قرب ووسائد هواء ومساعدين (Air Suspension & Shock Absorbers)
    if (code.startsWith('8708.80') || desc.includes('قرب') || desc.includes('مساعدين')) {
      return { qty: 120, factoryPriceUsd: 26, unitWeightKg: 4.5, unitCbm: 0.014, expectedLocalMarketPriceEgp: 2650 };
    }
    // 13. صمامات وبلوف باكم فرامل (Brake Valves WABCO/Knorr)
    if (code.startsWith('8481.20') || desc.includes('بلوف') || desc.includes('صمامات')) {
      return { qty: 100, factoryPriceUsd: 32, unitWeightKg: 3.5, unitCbm: 0.008, expectedLocalMarketPriceEgp: 3200 };
    }
    // 14. تيل وطنابير فرامل (Brake Pads & Drums)
    if (code.startsWith('8708.30') || desc.includes('فرامل') || desc.includes('طنابير') || desc.includes('تيل')) {
      return { qty: 250, factoryPriceUsd: 16.5, unitWeightKg: 5.2, unitCbm: 0.009, expectedLocalMarketPriceEgp: 1450 };
    }
    // 15. فلاتر زيت ووقود وهواء (Filters)
    if (code.startsWith('8421') || desc.includes('فلاتر') || desc.includes('خراطيش')) {
      return { qty: 400, factoryPriceUsd: 3.8, unitWeightKg: 0.9, unitCbm: 0.003, expectedLocalMarketPriceEgp: 380 };
    }
    // 16. إطارات شاحنات (Truck Tires)
    if (code.startsWith('4011.20') || desc.includes('إطارات')) {
      return { qty: 60, factoryPriceUsd: 135, unitWeightKg: 58, unitCbm: 0.22, expectedLocalMarketPriceEgp: 14000 };
    }
    // 17. بطاريات نقل ثقيل (Batteries)
    if (code.startsWith('8507.10') || desc.includes('بطاريات')) {
      return { qty: 80, factoryPriceUsd: 65, unitWeightKg: 42, unitCbm: 0.035, expectedLocalMarketPriceEgp: 6800 };
    }
    // 18. مارش ودينامو 24V (Starters & Alternators)
    if (code.startsWith('8511') || desc.includes('مارش') || desc.includes('دينامو')) {
      return { qty: 60, factoryPriceUsd: 48, unitWeightKg: 8.5, unitCbm: 0.015, expectedLocalMarketPriceEgp: 4800 };
    }
    // 19. جنوط نقل ثقيل (Rims)
    if (code.startsWith('8708.70') || desc.includes('جنوط')) {
      return { qty: 100, factoryPriceUsd: 38, unitWeightKg: 38, unitCbm: 0.052, expectedLocalMarketPriceEgp: 3900 };
    }
    // 20. يايات وسوست ورقية (Leaf Springs)
    if (code.startsWith('7320.10') || desc.includes('سوست') || desc.includes('يايات')) {
      return { qty: 80, factoryPriceUsd: 42, unitWeightKg: 48, unitCbm: 0.028, expectedLocalMarketPriceEgp: 4200 };
    }
    // 21. أجزاء المقطورات وسحابات وبنز كينج بن وأرجل هبوط (Trailer Parts & Kingpins)
    if (code.startsWith('8716.90') || desc.includes('مقطورات') || desc.includes('سحابات') || desc.includes('أرجل') || desc.includes('king pin') || desc.includes('بنز مقطورة')) {
      return { qty: 25, factoryPriceUsd: 115, unitWeightKg: 85, unitCbm: 0.08, expectedLocalMarketPriceEgp: 13500 };
    }
    // 22. طلمبات باور ستيرنج وعلب دركسيون (Power Steering Pumps & Gearboxes)
    if (code.startsWith('8708.94') || desc.includes('دركسيون') || desc.includes('ستيرنج') || desc.includes('باور')) {
      return { qty: 50, factoryPriceUsd: 48, unitWeightKg: 8.5, unitCbm: 0.015, expectedLocalMarketPriceEgp: 4800 };
    }
    // 23. فلاتر وخراطيش تجفيف الهواء لفرامل الشاحنات (Air Dryers Desiccant)
    if (code.startsWith('8421.39') || desc.includes('تجفيف') || desc.includes('مجفف')) {
      return { qty: 250, factoryPriceUsd: 8.5, unitWeightKg: 2.2, unitCbm: 0.005, expectedLocalMarketPriceEgp: 950 };
    }
    // 24. فوانيس وكشافات إضاءة شاحنات 24V (Truck Lighting & Headlamps)
    if (code.startsWith('8512.20') || desc.includes('فوانيس') || desc.includes('كشافات') || desc.includes('إضاءة')) {
      return { qty: 80, factoryPriceUsd: 22, unitWeightKg: 2.8, unitCbm: 0.012, expectedLocalMarketPriceEgp: 2200 };
    }

    return { qty: 50, factoryPriceUsd: 25, unitWeightKg: 6.0, unitCbm: 0.012, expectedLocalMarketPriceEgp: 2500 };
  };

  const handleSelectTariffItem = (tariff: any) => {
    const isAlreadyAdded = items.some(
      (it) => it.hsCode === tariff.hs_code || it.name === tariff.description_ar
    );

    if (isAlreadyAdded) {
      toast.warning(`البند الجمركي (${tariff.hs_code}) "${tariff.description_ar.slice(0, 35)}..." مضاف بالفعل في دراسة الجدوى.`);
      return;
    }

    const defaults = getRealisticTariffDefaults(tariff);
    const newItem = {
      name: tariff.description_ar,
      hsCode: tariff.hs_code,
      qty: defaults.qty,
      factoryPriceUsd: defaults.factoryPriceUsd,
      unitWeightKg: defaults.unitWeightKg,
      unitCbm: defaults.unitCbm,
      expectedLocalMarketPriceEgp: defaults.expectedLocalMarketPriceEgp,
    };

    setItems((prev) => {
      if (prev.length === 1 && (!prev[0].name || prev[0].name.includes('نموذج'))) {
        return [newItem];
      }
      return [...prev, newItem];
    });

    if (tariff.duty_rate_percent !== undefined && tariff.duty_rate_percent !== null) {
      setCustomsDutyPercent(Number(tariff.duty_rate_percent));
    }
    if (tariff.vat_rate_percent !== undefined && tariff.vat_rate_percent !== null) {
      setVatPercent(Number(tariff.vat_rate_percent));
    }

    toast.success(`تم إدراج البند (${tariff.hs_code}) "${tariff.description_ar.slice(0, 30)}..." في دراسة الجدوى`);
  };

  // I2-P8: preset picker actions for a fresh study. The preset is
  // the exact old forced bundle (5 truck-parts rows + freight $3,500,
  // clearance 48,000 EGP, travel 15,000 EGP); the manual start keeps
  // the grid empty and the costs at zero.
  const resetFeasibilityForm = () => {
    setItems([]);
    setShippingUsd(EMPTY_FEASIBILITY_COSTS.shippingUsd);
    setInsuranceUsd(EMPTY_FEASIBILITY_COSTS.insuranceUsd);
    setClearanceEgp(EMPTY_FEASIBILITY_COSTS.clearanceEgp);
    setTransportEgp(EMPTY_FEASIBILITY_COSTS.transportEgp);
    setTravelEgp(EMPTY_FEASIBILITY_COSTS.travelEgp);
    setFeasibilityResult(null);
    setHasChosenFeasibilityPreset(false);
  };

  const applyTruckPartsPreset = () => {
    const preset = buildTruckPartsPreset();
    setItems(preset.items as any);
    setShippingUsd(preset.costs.shippingUsd);
    setInsuranceUsd(preset.costs.insuranceUsd);
    setClearanceEgp(preset.costs.clearanceEgp);
    setTransportEgp(preset.costs.transportEgp);
    setTravelEgp(preset.costs.travelEgp);
    setHasChosenFeasibilityPreset(true);
    toast.success('تم تحميل قالب قطع غيار النقل والتريلات (5 أصناف) — عدّل الكميات والأسعار حسب شحنتك');
  };

  const startManualFeasibility = () => {
    setHasChosenFeasibilityPreset(true);
    toast.info('بدء يدوي فارغ — أضف الأصناف من المكتبة أو يدوياً وأدخل التكاليف');
  };

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        name: '',
        productId: '',
        hsCode: '8708.30',
        qty: 100,
        factoryPriceUsd: 10,
        unitWeightKg: 5,
        unitCbm: 0.01,
        expectedLocalMarketPriceEgp: 850,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleUpdateItem = (index: number, field: string, value: any) => {
    const updated = [...items];
    (updated[index] as any)[field] = value;
    setItems(updated);
  };

  // I1-P1: typing a different name clears the catalog link — the
  // productId is only valid for the product that was picked.
  const handleFeasibilityNameChange = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], name: value, productId: '' };
    setItems(updated);
  };

  // I1-P1: link a feasibility line to a real inventory item. The
  // contract quantity and factory price stay as typed — the product
  // carries no foreign price to fill them from.
  const handleLinkFeasibilityItem = (index: number, product: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], productId: Number(product.id), name: product.name };
    setItems(updated);
  };

  const handleAutoBalanceContainerLoad = (targetTons: number = 24.5) => {
    const totalWeightKg = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitWeightKg) || 0), 0);
    if (totalWeightKg <= 0) return;
    const targetWeightKg = targetTons * 1000;
    const scaleFactor = targetWeightKg / totalWeightKg;

    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        qty: Math.max(1, Math.round((Number(it.qty) || 0) * scaleFactor)),
      }))
    );
    toast.success(`تمت موازنة كميات الأصناف تلقائياً بنسبة وتناسب لتطابق الحمولة القانونية للحاوية (${targetTons} طن) وتفادي غرامات الموازين`);
  };

  const handleRunFeasibility = async () => {
    // I2-P8: a fresh study starts empty — refuse to run the engine
    // on zero rows instead of pricing the old forced bundle.
    if (items.length === 0) {
      toast.error('أضف صنفاً واحداً على الأقل قبل احتساب دراسة الجدوى');
      return;
    }
    try {
      // I2-P9: grid numeric fields may hold in-progress decimal text
      // ("0.") while the user types — normalize to finite numbers here,
      // the single boundary before the engine call, so the engine (and
      // the stored feasibility) always receives numbers.
      const normalizedItems = items.map((it) => ({
        ...it,
        qty: normalizeFeasibilityNumber(it.qty),
        factoryPriceUsd: normalizeFeasibilityNumber(it.factoryPriceUsd),
        unitWeightKg: it.unitWeightKg === undefined ? undefined : normalizeFeasibilityNumber(it.unitWeightKg),
        unitCbm: it.unitCbm === undefined ? undefined : normalizeFeasibilityNumber(it.unitCbm),
        expectedLocalMarketPriceEgp:
          it.expectedLocalMarketPriceEgp === undefined ? undefined : normalizeFeasibilityNumber(it.expectedLocalMarketPriceEgp),
      }));
      const res = await calculateFeasibilityMutation.mutateAsync({
        items: normalizedItems,
        exchangeRateCommercial: Number(commRate),
        exchangeRateCustoms: Number(custRate),
        internationalShippingUsd: Number(shippingUsd),
        insuranceUsd: Number(insuranceUsd),
        customsDutyRatePercent: Number(customsDutyPercent),
        vatRatePercent: Number(vatPercent),
        clearanceAndPortFeesEgp: Number(clearanceEgp),
        internalTransportEgp: Number(transportEgp),
        travelAndSourcingCostEgp: Number(travelEgp),
        targetMarkupPercent: Number(targetMarkup),
      });
      // I6-A: the engine now carries productId natively on each
      // output item, so the result is stored as returned — no
      // index-based re-attach. The old re-attach assumed the engine
      // preserved input order; a reordered study would have linked
      // the wrong product to each line.
      setFeasibilityResult(res);
      toast.success('تم احتساب دراسة الجدوى والسيناريوهات بنجاح');
    } catch (err: any) {
      toast.error('حدث خطأ أثناء احتساب الجدوى: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleConvertFeasibilityToProject = async () => {
    if (!feasibilityResult) return;
    // I1-P2: approval transitions the EXISTING project only. The engine
    // can also be opened standalone (no project); approving there has no
    // project to transition, so it is refused instead of creating one.
    if (!feasibilityProjectId) {
      toast.error('افتح دراسة الجدوى من صف المشروع لاعتمادها على المشروع نفسه');
      return;
    }
    try {
      // The convert endpoint reads the feasibility stored on the project,
      // so persist the study on screen first — otherwise an edited study
      // would approve stale stored data (or fail on an empty study).
      await updateProjectMutation.mutateAsync({ feasibilityData: feasibilityResult });
      await convertFeasibilityMutation.mutateAsync({ projectId: feasibilityProjectId });
      toast.success('تم اعتماد دراسة الجدوى وتحويل المشروع إلى مرحلة التوريد بنجاح');
      setIsFeasibilityOpen(false);
      setFeasibilityProjectId(null);
      refetch();
    } catch (err: any) {
      toast.error('فشل اعتماد دراسة الجدوى: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleRequestClosureApproval = async () => {
    if (!closingProject) return;
    try {
      await createApprovalMutation.mutateAsync({
        actionType: 'project_closure',
        referenceId: closingProject.id,
        requestPayload: {
          amount: Number(closingProject.allocated_capital || 0),
          projectId: closingProject.id,
          justification: closingNotes || `طلب اعتماد إقفال حسابات مشروع الاستيراد ${closingProject.project_no}`,
        },
      });
      toast.success('تم رفع طلب اعتماد إقفال المشروع للرقابة الثنائية (Maker-Checker)');
      refetchApprovals();
    } catch (err: any) {
      toast.error('فشل رفع طلب الاعتماد: ' + (err.message || 'خطأ'));
    }
  };

  const handleCloseProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingProject) return;
    const approvalId = selectedApprovalId.trim();
    if (!approvalId) {
      toast.error('يرجى اختيار أو إدخال رقم موافقة إقفال المشروع (Maker-Checker)');
      return;
    }
    try {
      await closeProjectMutation.mutateAsync({
        projectId: closingProject.id,
        approvalRequestId: approvalId,
        closingNotes: closingNotes || undefined,
      });
      toast.success('تم إقفال مشروع الاستيراد وتوزيع صافي الأرباح المحققة على الشركاء بنجاح');
      setClosingProject(null);
      setSelectedApprovalId('');
      setClosingNotes('');
      refetch();
    } catch (err: any) {
      toast.error('فشل إقفال المشروع: ' + (err.message || 'خطأ'));
    }
  };

  const handleOpenProjectFeasibility = (p: any) => {
    // I1-P2: remember which existing project this study belongs to, so
    // approving it transitions THIS project instead of creating a new one.
    setFeasibilityProjectId(p.id);
    let data = p.feasibility_data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        data = null;
      }
    }

    if (data && data.items && Array.isArray(data.items) && data.items.length > 0) {
      setItems(data.items);
      if (data.rates?.commercialExchangeRate) setCommRate(data.rates.commercialExchangeRate);
      if (data.rates?.customsExchangeRate) setCustRate(data.rates.customsExchangeRate);
      // I8-B (INV-IMPORT-FEASIBILITY-FX-PERSIST): the engine result
      // now echoes the rates it was priced at as top-level fields;
      // restore them so a reopened study shows (and recalculates at)
      // its own rate instead of a stale rate left over from another
      // project. The legacy rates.* shape above stays as a fallback.
      if (data.exchangeRateCommercial) setCommRate(Number(data.exchangeRateCommercial));
      if (data.exchangeRateCustoms) setCustRate(Number(data.exchangeRateCustoms));
      if (data.costs?.shippingUsd) setShippingUsd(data.costs.shippingUsd);
      if (data.costs?.insuranceUsd) setInsuranceUsd(data.costs.insuranceUsd);
      if (data.costs?.clearanceAndPortFeesEgp) setClearanceEgp(data.costs.clearanceAndPortFeesEgp);
      if (data.costs?.internalTransportEgp) setTransportEgp(data.costs.internalTransportEgp);
      if (data.costs?.travelAndSourcingCostEgp) setTravelEgp(data.costs.travelAndSourcingCostEgp);
      setFeasibilityResult(data);
      // I2-P8: a stored study is already a made choice — no picker.
      setHasChosenFeasibilityPreset(true);
      toast.success(`تم تحميل دراسة الجدوى والسيناريوهات لمشروع "${p.title}"`);
    } else {
      // I2-P8: no stored study — open a FRESH study (empty grid,
      // zero costs) with the preset picker, never the old forced
      // 5 rows and never another project's leftovers.
      resetFeasibilityForm();
      toast.info(`المشروع "${p.title}": تم فتح المحرك لإعداد دراسة جدوى وتخصيص البنود`);
    }
    setIsFeasibilityOpen(true);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectTitle.trim()) {
      toast.error('يرجى إدخال اسم المشروع');
      return;
    }

    const activePartners = selectedPartners
      .filter((p) => p.isSelected && p.name.trim())
      .map((p) => ({
        partnerId: p.partnerId || undefined,
        name: p.name.trim(),
        capitalShare: Number(p.capitalShare || 0),
        profitPercentage: Number(p.profitPercentage || 0),
      }));

    if (activePartners.length > 0) {
      const sum = activePartners.reduce((acc, p) => acc + p.profitPercentage, 0);
      if (Math.abs(sum - 100) > 0.5) {
        toast.warning(`تنبيه: مجموع نسب الشركاء الحالي (${sum.toFixed(1)}%) لا يساوي 100%. يفضل ضبطها قبل الحفظ.`);
      }
    }

    try {
      const sectorLabel = availableSectors.find((s: any) => s.id === targetSector)?.name_ar || targetSector;
      const notesSummary = [
        `القطاع: ${sectorLabel}`,
        `مواصفات الحاوية: ${containerCount}x ${containerType}`,
        `شرط التعاقد وميناء الوصول: ${incoterms} - ${portOfDischarge}`,
        activePartners.length > 0
          ? `الشركاء: ${activePartners.map((p) => `${p.name} (${p.profitPercentage}%)`).join(' | ')}`
          : '',
        projectNotes ? `ملاحظات إضافية: ${projectNotes}` : '',
      ]
        .filter(Boolean)
        .join(' --- ');

      await createProjectMutation.mutateAsync({
        title: projectTitle.trim(),
        targetMarket,
        countryOrigin,
        countryDestination: `Egypt (${portOfDischarge})`,
        budgetCurrency,
        allocatedCapital: Number(allocatedCapital),
        targetRoiPercentage: Number(targetRoi),
        notes: notesSummary,
        sectorPreset: sectorPreset || undefined,
        feasibilityData: feasibilityResult || {},
        partners: activePartners.map((p) => ({
          partnerId: p.partnerId,
          name: p.name,
          capitalShare: p.capitalShare,
          profitPercentage: p.profitPercentage,
        })),
      });

      toast.success('تم إنشاء مشروع الاستيراد واعتماد مواصفات الصفقة والشركاء بنجاح');
      setIsNewProjectOpen(false);
      setProjectTitle('');
      setProjectNotes('');
      setSectorPreset('');
      refetch();
    } catch (err: any) {
      toast.error('حدث خطأ أثناء إنشاء المشروع: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <ImportProjectsTable
          projects={projects}
          approvalRequests={approvalRequests}
          isProjectsLoading={isProjectsLoading}
          refetch={refetch}
          commRate={commRate}
          setIsNewProjectOpen={setIsNewProjectOpen}
          setIsFeasibilityOpen={setIsFeasibilityOpen}
          handleOpenProjectFeasibility={handleOpenProjectFeasibility}
          setClosingProject={setClosingProject}
          setSelectedApprovalId={setSelectedApprovalId}
          setClosingNotes={setClosingNotes}
        />

      {/* 3. Feasibility Study Engine Dialog */}
      <StandardDialog
        open={isFeasibilityOpen}
        onClose={() => {
          setIsFeasibilityOpen(false);
          setFeasibilityProjectId(null);
        }}
        title="محرك دراسة الجدوى الاستيرادية والسيناريوهات الثلاثة (Feasibility Engine)"
        subtitle="حساب تكلفة الوحدة المتوقعة بالجنيه، الجمارك، الشحن، نقطة التعادل، ومقارنة السيناريوهات"
        width="1180px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FeasibilityPresetParams
            hasChosenFeasibilityPreset={hasChosenFeasibilityPreset}
            applyTruckPartsPreset={applyTruckPartsPreset}
            startManualFeasibility={startManualFeasibility}
            commRate={commRate}
            setCommRate={setCommRate}
            custRate={custRate}
            setCustRate={setCustRate}
            shippingUsd={shippingUsd}
            setShippingUsd={setShippingUsd}
            insuranceUsd={insuranceUsd}
            setInsuranceUsd={setInsuranceUsd}
            customsDutyPercent={customsDutyPercent}
            setCustomsDutyPercent={setCustomsDutyPercent}
            vatPercent={vatPercent}
            setVatPercent={setVatPercent}
            clearanceEgp={clearanceEgp}
            setClearanceEgp={setClearanceEgp}
            transportEgp={transportEgp}
            setTransportEgp={setTransportEgp}
            travelEgp={travelEgp}
            setTravelEgp={setTravelEgp}
            targetMarkup={targetMarkup}
            setTargetMarkup={setTargetMarkup}
          />

          <FeasibilityItemsGrid
            items={items}
            products={products}
            calculateFeasibilityMutation={calculateFeasibilityMutation}
            setPickerSector={setPickerSector}
            setPickerSearch={setPickerSearch}
            setIsTariffPickerOpen={setIsTariffPickerOpen}
            handleAddItem={handleAddItem}
            handleRemoveItem={handleRemoveItem}
            handleUpdateItem={handleUpdateItem}
            handleFeasibilityNameChange={handleFeasibilityNameChange}
            handleLinkFeasibilityItem={handleLinkFeasibilityItem}
            handleAutoBalanceContainerLoad={handleAutoBalanceContainerLoad}
            handleRunFeasibility={handleRunFeasibility}
          />

          {/* Results View */}
          {feasibilityResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <FeasibilityResultsLogistics feasibilityResult={feasibilityResult} />

              <FeasibilityResultsScenarios
                feasibilityResult={feasibilityResult}
                targetMarkup={targetMarkup}
                feasibilityProjectId={feasibilityProjectId}
                onConvertFeasibility={handleConvertFeasibilityToProject}
                convertFeasibilityMutation={convertFeasibilityMutation}
                updateProjectMutation={updateProjectMutation}
              />
            </div>
          )}
        </div>
      </StandardDialog>

      {/* 4. New Project Dialog */}
      <NewProjectDialog
        isNewProjectOpen={isNewProjectOpen}
        setIsNewProjectOpen={setIsNewProjectOpen}
        handleCreateProject={handleCreateProject}
        handleGenerateSuggestedTitle={handleGenerateSuggestedTitle}
        projectTitle={projectTitle}
        setProjectTitle={setProjectTitle}
        targetSector={targetSector}
        setTargetSector={setTargetSector}
        setPickerSector={setPickerSector}
        availableSectors={availableSectors}
        sectorPreset={sectorPreset}
        setSectorPreset={setSectorPreset}
        sectorPresets={sectorPresets}
        containerType={containerType}
        setContainerType={setContainerType}
        containerCount={containerCount}
        setContainerCount={setContainerCount}
        portOfDischarge={portOfDischarge}
        setPortOfDischarge={setPortOfDischarge}
        incoterms={incoterms}
        setIncoterms={setIncoterms}
        countryOrigin={countryOrigin}
        setCountryOrigin={setCountryOrigin}
        targetMarket={targetMarket}
        setTargetMarket={setTargetMarket}
        budgetCurrency={budgetCurrency}
        setBudgetCurrency={setBudgetCurrency}
        allocatedCapital={allocatedCapital}
        setAllocatedCapital={setAllocatedCapital}
        commRate={commRate}
        targetRoi={targetRoi}
        setTargetRoi={setTargetRoi}
        selectedPartners={selectedPartners}
        setSelectedPartners={setSelectedPartners}
        handleAddPartner={handleAddPartner}
        handleDistributeEqualPercentages={handleDistributeEqualPercentages}
        handleDistributeByCapital={handleDistributeByCapital}
        handleRemovePartner={handleRemovePartner}
        partnersData={partnersData}
        projectNotes={projectNotes}
        setProjectNotes={setProjectNotes}
        createProjectMutation={createProjectMutation}
      />

      {/* 5. Close Project & Distribute Profit Dialog */}
      <CloseProjectDialog
        closingProject={closingProject}
        closingNotes={closingNotes}
        selectedApprovalId={selectedApprovalId}
        approvalRequests={approvalRequests}
        setClosingProject={setClosingProject}
        setSelectedApprovalId={setSelectedApprovalId}
        setClosingNotes={setClosingNotes}
        handleCloseProject={handleCloseProject}
        handleRequestClosureApproval={handleRequestClosureApproval}
        createApprovalMutation={createApprovalMutation}
        closeProjectMutation={closeProjectMutation}
      />

      {/* Official Egypt Customs Tariffs & Truck Spare Parts Picker Dialog */}
      <TariffPickerDialog
        isTariffPickerOpen={isTariffPickerOpen}
        pickerSector={pickerSector}
        setPickerSector={setPickerSector}
        pickerSearch={pickerSearch}
        setPickerSearch={setPickerSearch}
        availableSectors={availableSectors}
        isTariffsLoading={isTariffsLoading}
        displayedTariffs={displayedTariffs}
        items={items}
        onSelectTariffItem={handleSelectTariffItem}
        onClose={() => setIsTariffPickerOpen(false)}
      />
      </main>
    </div>
  );
}
