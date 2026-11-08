import React, { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
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
import {
  PlusCircleIcon,
  RefreshCwIcon,
  XIcon,
  SlidersIcon,
  CheckCircleIcon,
  SearchIcon,
  CheckShieldIcon,
  TruckIcon,
  DollarSignIcon,
  TrendingUpIcon,
  UsersIcon,
  Trash2Icon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { LoadingState } from '@/shared/ui/loading-state';
import { useProductsQuery } from '@/shared/hooks/use-catalog-queries';
import { SearchableCombobox } from '@/shared/ui/searchable-combobox';
import {
  formatMarketProfitEgp,
  formatMarketRoiBadge,
  getImportProjectStatusLabel,
  normalizeFeasibilityNumber,
  parseFeasibilityNumberInput,
} from './utils/import-display-formatters';
import {
  buildTruckPartsPreset,
  EMPTY_FEASIBILITY_COSTS,
  TRUCK_PARTS_PRESET_COSTS,
} from './feasibility-preset';

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
    // I1-P1: link to the real inventory item. The feasibility engine
    // rebuilds its output items without this field, so handleRunFeasibility
    // re-attaches it by index before storing the result.
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
      // I1-P1: the feasibility engine rebuilds its output items
      // without productId, so re-attach the link the user picked,
      // by index (the engine maps items in input order). Without
      // this, feasibility_data loses the link and the PI pull copies
      // only name/qty/price, leaving the PO chain dead. The engine
      // itself (import-feasibility.engine.ts) is out of scope for
      // this package; carrying productId through it is the follow-up.
      const resWithLinks = {
        ...res,
        items: Array.isArray(res.items)
          ? res.items.map((ri: any, i: number) => ({ ...ri, productId: normalizedItems[i]?.productId || undefined }))
          : res.items,
      };
      setFeasibilityResult(resWithLinks);
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
        <PageHeader
          title="مشاريع الاستيراد ودراسات الجدوى"
          description="إدارة فرص الصفقات التجارية من لحظة دراسة الجدوى ونقطة التعادل حتى التعاقد والشحن والإقفال."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsNewProjectOpen(true)}
                style={{
                  height: '38px',
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
                }}
              >
                <PlusCircleIcon size={15} />
                <span>إنشاء مشروع استيراد جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsFeasibilityOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#170e5e',
                }}
              >
                <SlidersIcon size={14} />
                <span>محرك دراسة الجدوى والسيناريوهات</span>
              </Button>
            </div>
          }
        />

      {/* 2. Projects Table Card */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            قائمة مشاريع وصفقات الاستيراد ({isProjectsLoading ? '…' : projects.length})
          </h2>
          <button
            onClick={() => refetch()}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
          >
            <RefreshCwIcon size={13} />
            تحديث
          </button>
        </div>

        {isProjectsLoading ? (
          <LoadingState title="جاري تحميل مشاريع الاستيراد..." />
        ) : projects.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
              لا توجد مشاريع استيراد مسجلة
            </div>
            <div style={{ fontSize: '12px' }}>
              ابدأ بإنشاء دراسة جدوى مبدئية أو مشروع استيراد جديد لتنظيم التعاقد والشحن
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>رقم المشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>اسم الصفقة والمشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>بلد الشراء والوجهة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الميزانية المرصودة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>العائد المستهدف (ROI)</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الحاويات المرتبطة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>حالة المشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#170e5e' }}>
                      {p.project_no}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      {p.title}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                      {p.country_origin} &larr; {p.country_destination}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                      {p.budget_currency === 'EGP' ? (
                        <div>
                          <span>{Number(p.allocated_capital || 0).toLocaleString()} ج.م</span>
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                            (~${Math.round(Number(p.allocated_capital || 0) / (commRate || 50)).toLocaleString()})
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span>${Number(p.allocated_capital || 0).toLocaleString()}</span>
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                            (~{(Number(p.allocated_capital || 0) * (commRate || 50)).toLocaleString()} ج.م)
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#059669' }}>
                      {p.target_roi_percentage}%
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                      {p.shipmentCount || 0} حاوية
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor:
                            p.status === 'closed'
                              ? '#f1f5f9'
                              : p.status === 'warehousing' || p.status === 'selling'
                              ? '#dcfce7'
                              : '#e0e7ff',
                          color:
                            p.status === 'closed'
                              ? '#64748b'
                              : p.status === 'warehousing' || p.status === 'selling'
                              ? '#166534'
                              : '#3730a3',
                        }}
                      >
                        {getImportProjectStatusLabel(p.status)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenProjectFeasibility(p)}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 6,
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#166534',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="عرض وتحرير دراسة الجدوى والسيناريوهات لهذا المشروع"
                        >
                          <SlidersIcon size={12} />
                          <span>دراسة الجدوى</span>
                        </button>
                        {p.status !== 'closed' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setClosingProject(p);
                              const matchingApproved = approvalRequests.find(
                                (r: any) =>
                                  (r.action_type === 'project_closure' || r.request_type === 'project_closure') &&
                                  r.reference_id === p.id &&
                                  r.status === 'approved'
                              );
                              setSelectedApprovalId(matchingApproved?.id || '');
                              setClosingNotes('');
                            }}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#170e5e',
                              cursor: 'pointer',
                            }}
                          >
                            إقفال وتصفية الأرباح
                          </button>
                        ) : (
                          <span style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: 700 }}>مقفل وموزع</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
          {/* I2-P8: preset picker for a fresh study — the truck-parts
              bundle is offered, never forced; the manual start keeps
              the grid empty and the costs at zero. */}
          {!hasChosenFeasibilityPreset && (
            <div
              style={{
                border: '1px solid #c7d2fe',
                backgroundColor: '#eef2ff',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: 4 }}>
                ابدأ دراسة الجدوى — اختر قالباً أو ابدأ فارغاً
              </div>
              <div style={{ fontSize: '12px', color: '#475569', marginBottom: 10 }}>
                لا يتم تحميل أي أصناف تلقائياً. اختر قالب قطع غيار النقل والتريلات الجاهز، أو ابدأ بجدول فارغ وأضف أصنافك بنفسك.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={applyTruckPartsPreset}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <TruckIcon size={14} />
                  <span>قالب قطع غيار النقل والتريلات (5 أصناف)</span>
                </button>
                <button
                  type="button"
                  onClick={startManualFeasibility}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    backgroundColor: '#ffffff',
                    color: '#170e5e',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <PlusCircleIcon size={14} />
                  <span>بدء يدوي فارغ</span>
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 8 }}>
                القالب يحمّل: شحن ${TRUCK_PARTS_PRESET_COSTS.shippingUsd.toLocaleString()} — تخليص{' '}
                {TRUCK_PARTS_PRESET_COSTS.clearanceEgp.toLocaleString()} ج.م — سفر ومعاينات{' '}
                {TRUCK_PARTS_PRESET_COSTS.travelEgp.toLocaleString()} ج.م
              </div>
            </div>
          )}

          {/* Global Parameters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, backgroundColor: '#f8fafc', padding: 12, borderRadius: 10 }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سعر صرف الدولار التجاري (ج.م)</label>
              <input
                type="number"
                value={commRate}
                onChange={(e) => setCommRate(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سعر الدولار الجمركي (ج.م)</label>
              <input
                type="number"
                value={custRate}
                onChange={(e) => setCustRate(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>الشحن الدولي ($)</label>
              <input
                type="number"
                aria-label="الشحن الدولي ($)"
                value={shippingUsd}
                onChange={(e) => setShippingUsd(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>التأمين البحري ($)</label>
              <input
                type="number"
                aria-label="التأمين البحري ($)"
                value={insuranceUsd}
                onChange={(e) => setInsuranceUsd(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>الرسوم الجمركية (%)</label>
              <input
                type="number"
                value={customsDutyPercent}
                onChange={(e) => setCustomsDutyPercent(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>ضريبة القيمة المضافة (%)</label>
              <input
                type="number"
                value={vatPercent}
                onChange={(e) => setVatPercent(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }} title="يشمل التخليص، رسوم التسجيل المسبق ACI و CargoX، وسحب عينات معامل الرقابة">
                تخليص، نافذة، وفحص رقابي (ج.م)
              </label>
              <input
                type="number"
                aria-label="تخليص، نافذة، وفحص رقابي (ج.م)"
                value={clearanceEgp}
                onChange={(e) => setClearanceEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>نقل داخلي للمخزن (ج.م)</label>
              <input
                type="number"
                aria-label="نقل داخلي للمخزن (ج.م)"
                value={transportEgp}
                onChange={(e) => setTransportEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>مصاريف سفر ومعاينات (ج.م)</label>
              <input
                type="number"
                aria-label="مصاريف سفر ومعاينات (ج.م)"
                value={travelEgp}
                onChange={(e) => setTravelEgp(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>هامش الربح المطلوب (%)</label>
              <input
                type="number"
                value={targetMarkup}
                onChange={(e) => setTargetMarkup(Number(e.target.value))}
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Items Table Header & Quick Action Buttons */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 10,
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>أصناف الشحنة المستهدفة</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#170e5e',
                    backgroundColor: '#eef2ff',
                    padding: '2px 8px',
                    borderRadius: 12,
                    border: '1px solid #c7d2fe',
                  }}
                >
                  {items.length} صنف
                </span>
              </div>

              {/* Action Buttons: Truck Spare Parts Library, All Sectors Library, and Manual Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setPickerSector('commercial_vehicles_spare_parts');
                    setPickerSearch('');
                    setIsTariffPickerOpen(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
                  }}
                >
                  <CheckShieldIcon size={14} />
                  <span>مكتبة قطع غيار النقل والتريلات (جمارك 5%)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPickerSector('all');
                    setPickerSearch('');
                    setIsTariffPickerOpen(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    color: '#170e5e',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <span>كافة القطاعات</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddItem}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    background: 'none',
                    border: '1px dashed #94a3b8',
                    color: '#475569',
                    borderRadius: 6,
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <PlusCircleIcon size={13} />
                  <span>+ إضافة صنف يدوياً</span>
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', minWidth: 840 }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>اسم الصنف</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 125 }}>رقم القطعة (OEM)</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 110 }}>البند HS Code</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 80 }}>الكمية</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>المصنع ($)</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>الوزن (كجم)</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 95 }}>الحجم (CBM)</th>
                    <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#334155', width: 115 }}>سعر السوق (ج.م)</th>
                    <th style={{ padding: '8px 10px', width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <SearchableCombobox
                          inline
                          placeholder="ابحث عن صنف حقيقي..."
                          value={it.name}
                          onChange={(value) => handleFeasibilityNameChange(idx, value)}
                          options={products || []}
                          search={(p: any, q: string) =>
                            (p.name || '').toLowerCase().includes(q.toLowerCase()) ||
                            (p.barcode || '').toLowerCase().includes(q.toLowerCase()) ||
                            (p.styleCode || '').toLowerCase().includes(q.toLowerCase())
                          }
                          getLabel={(p: any) => p.name}
                          getMeta={(p: any) => (p.barcode ? `كود: ${p.barcode}` : p.styleCode ? `Code: ${p.styleCode}` : '')}
                          onSelect={(p: any) => handleLinkFeasibilityItem(idx, p)}
                          showIdleHelper={false}
                        />
                        {it.productId ? (
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginTop: 2 }}>
                            مربوط بصنف حقيقي (#{it.productId})
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', marginTop: 2 }}>
                            غير مربوط — اختر الصنف من القائمة
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="text"
                          value={it.partNumber || it.oemNumber || ''}
                          onChange={(e) => handleUpdateItem(idx, 'partNumber' as any, e.target.value)}
                          placeholder="WG9100440030"
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontFamily: 'monospace' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="text"
                          value={it.hsCode}
                          onChange={(e) => handleUpdateItem(idx, 'hsCode', e.target.value)}
                          placeholder="8708.30"
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontFamily: 'monospace' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number"
                          value={it.qty ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'qty', parseFeasibilityNumberInput(e.target.value))}
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number"
                          step="0.01"
                          value={it.factoryPriceUsd ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'factoryPriceUsd', parseFeasibilityNumberInput(e.target.value))}
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="مثال: 5"
                          value={it.unitWeightKg ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'unitWeightKg', parseFeasibilityNumberInput(e.target.value))}
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number"
                          step="0.001"
                          placeholder="0.01"
                          value={it.unitCbm ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'unitCbm', parseFeasibilityNumberInput(e.target.value))}
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="number"
                          placeholder="سعر المحل..."
                          value={it.expectedLocalMarketPriceEgp ?? ''}
                          onChange={(e) => handleUpdateItem(idx, 'expectedLocalMarketPriceEgp', parseFeasibilityNumberInput(e.target.value))}
                          style={{ width: '100%', height: 30, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '12px', fontWeight: 600, color: '#166534' }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        {/* I2-P8: the delete control is rendered for EVERY
                            row, including the last one. The old
                            `items.length > 1` guard hid it on the sole
                            remaining row, so the grid could never be
                            emptied and the last row had to be overwritten
                            in place (trial problem 8). */}
                        <button
                          type="button"
                          aria-label="حذف الصنف"
                          title="حذف الصنف"
                          onClick={() => handleRemoveItem(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                        >
                          <XIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: '18px 12px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                        لا توجد أصناف بعد — اختر قالباً من الأعلى أو أضف صنفاً من المكتبة أو يدوياً
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Live Container & Cargo Metric Summary Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 8,
                padding: '8px 14px',
                backgroundColor: '#f1f5f9',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: '11.5px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <TruckIcon size={16} color="#170e5e" />
                <span style={{ fontWeight: 800, color: '#0f172a' }}>مؤشر حمولة الحاوية اللحظي:</span>
                <span style={{ color: '#334155' }}>
                  الوزن الإجمالي:{' '}
                  <strong>
                    {(items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitWeightKg) || 0), 0) / 1000).toFixed(2)} طن
                  </strong>
                </span>
                <span style={{ color: '#94a3b8' }}>|</span>
                <span style={{ color: '#334155' }}>
                  الحجم المكعب:{' '}
                  <strong>
                    {items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCbm) || 0), 0).toFixed(2)} CBM
                  </strong>
                </span>
                <span style={{ color: '#94a3b8' }}>|</span>
                <span style={{ color: '#334155' }}>
                  قيمة بضاعة المصنع:{' '}
                  <strong>
                    ${items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.factoryPriceUsd) || 0), 0).toLocaleString()}
                  </strong>
                </span>
              </div>

              {(() => {
                const totalTons = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitWeightKg) || 0), 0) / 1000;
                const totalCbm = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitCbm) || 0), 0);
                const isOverweight = totalTons > 25.0;

                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 4,
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: isOverweight ? '#fee2e2' : totalTons >= 22 ? '#dcfce7' : '#e0e7ff',
                        color: isOverweight ? '#b91c1c' : totalTons >= 22 ? '#166534' : '#1e1b4b',
                        border: isOverweight ? '1px solid #fca5a5' : '1px solid transparent',
                      }}
                    >
                      {isOverweight
                        ? `تحذير حمولة زائدة (${totalTons.toFixed(1)} طن - تتجاوز 25 طن المسموح بموانئ مصر)`
                        : totalTons >= 22
                        ? `حمولة قانونية مثالية (${totalTons.toFixed(1)} طن - استغلال كامل للحاوية 40FT)`
                        : totalCbm > 30 || totalTons > 14
                        ? 'الحاوية الموصى بها: 40FT Standard'
                        : 'الحاوية الموصى بها: 20FT Standard'}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleAutoBalanceContainerLoad(24.5)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        backgroundColor: isOverweight ? '#170e5e' : '#f8fafc',
                        color: isOverweight ? '#ffffff' : '#170e5e',
                        border: '1px solid #cbd5e1',
                        borderRadius: 5,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: isOverweight ? '0 1px 3px rgba(23, 14, 94, 0.25)' : 'none',
                      }}
                      title="موازنة كميات الأصناف تلقائياً بنسبة وتناسب للوصول للحمولة القانونية المسموحة (24.5 طن) وتفادي غرامات الميزان"
                    >
                      <SlidersIcon size={12} />
                      <span>موازنة الحمولة للحد القانوني (24.5 طن)</span>
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ textAlign: 'left' }}>
            <button
              type="button"
              onClick={handleRunFeasibility}
              disabled={calculateFeasibilityMutation.isPending}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 22px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
              }}
            >
              {calculateFeasibilityMutation.isPending ? 'جاري الحساب والتدقيق...' : 'حساب الجدوى والسيناريوهات الثلاثة'}
            </button>
          </div>

          {/* Results View */}
          {feasibilityResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              {/* 1. Maritime Container Logistics & Utilization Card */}
              {feasibilityResult.containerMetrics && (
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    padding: '12px 16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          backgroundColor: '#e0e7ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#170e5e',
                        }}
                      >
                        <TruckIcon size={16} />
                      </div>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                        التقييم اللوجستي للشحن واستيعاب الحاويات البحرية (لشركة الشحن الملاحي)
                      </span>
                    </div>

                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 6,
                        fontSize: '11.5px',
                        fontWeight: 700,
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                      }}
                    >
                      نوع الحاوية: {feasibilityResult.containerMetrics.recommendedContainerType.toUpperCase()} (
                      {feasibilityResult.containerMetrics.containerCountNeeded} حاوية)
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
                    {/* Weight Metric */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي الوزن القائم</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                        {feasibilityResult.containerMetrics.totalGrossWeightTons} طن
                      </div>
                      <div style={{ width: '100%', height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, feasibilityResult.containerMetrics.weightCapacityUtilizationPercent)}%`,
                            height: '100%',
                            backgroundColor:
                              feasibilityResult.containerMetrics.weightCapacityUtilizationPercent > 90 ? '#ef4444' : '#15803d',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                        {feasibilityResult.containerMetrics.weightCapacityUtilizationPercent}% من حمولة الطريق المسموحة (26 طن)
                      </div>
                    </div>

                    {/* Volume Metric */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي الحجم المكعب</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                        {feasibilityResult.containerMetrics.totalVolumeCbm} CBM
                      </div>
                      <div style={{ width: '100%', height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, feasibilityResult.containerMetrics.volumeCapacityUtilizationPercent)}%`,
                            height: '100%',
                            backgroundColor: '#2563eb',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                        {feasibilityResult.containerMetrics.volumeCapacityUtilizationPercent}% استيعاب الحجم للحاوية
                      </div>
                    </div>

                    {/* Cargo Nature */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>طبيعة الشحنة اللوجستية</div>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 800,
                          color: feasibilityResult.containerMetrics.isHeavyCargo ? '#b45309' : '#1e293b',
                          marginTop: 4,
                        }}
                      >
                        {feasibilityResult.containerMetrics.isHeavyCargo
                          ? 'بضائع فائقة الوزن (مغلقة وزناً)'
                          : feasibilityResult.containerMetrics.isBulkyCargo
                          ? 'بضائع حجمية خفيفة'
                          : 'حمولة متوازنة وزناً وحجماً'}
                      </div>
                    </div>

                    {/* Demurrage & Detention Buffer */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>مخاطر تأخير الموانئ والأرضيات</div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: '#059669', marginTop: 4 }}>
                        فترة سماح معتادة: 14 - 21 يوم
                      </div>
                      <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: 2 }}>
                        محسوب احتياطي 15,000 ج.م بالسيناريو المتحفظ
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#f1f5f9',
                      borderRadius: 6,
                      fontSize: '11px',
                      color: '#334155',
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>التقرير الملاحي:</strong> {feasibilityResult.containerMetrics.loadSummaryAr}
                  </div>
                </div>
              )}

              {/* 2. Local Market Arbitrage & Shop Profitability Card */}
              {feasibilityResult.totalProfitVsMarketEgp !== undefined && (
                <div
                  style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 10,
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          backgroundColor: '#dcfce7',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#15803d',
                        }}
                      >
                        <TrendingUpIcon size={16} />
                      </div>
                      <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#166534' }}>
                        مؤشرات ربحية السوق المصري والمحل التجاري (لتاجر ومستورد قطع الغيار)
                      </span>
                    </div>

                    {(() => {
                      // I2-P9: hide the badge when the engine reported no
                      // market ROI (zero/negative market profit) — never
                      // an empty "% ROI" with no number.
                      const badge = formatMarketRoiBadge(feasibilityResult.overallRoiVsMarketPercent);
                      return badge ? (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontSize: '12px',
                            fontWeight: 800,
                            backgroundColor: '#15803d',
                            color: '#ffffff',
                          }}
                        >
                          {badge}
                        </span>
                      ) : null;
                    })()}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي صافي أرباح الشحنة بأسعار السوق</div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#15803d', marginTop: 2 }}>
                        {feasibilityResult.totalProfitVsMarketEgp.toLocaleString()} ج.م
                      </div>
                    </div>

                    <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>إجمالي التكلفة الواصلة للمخزن / المحل</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                        {feasibilityResult.totalAccountingCostEgp.toLocaleString()} ج.م
                      </div>
                    </div>

                    <div style={{ backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>السيولة النقدية المطلوبة للتمويل</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginTop: 2 }}>
                        {feasibilityResult.totalProjectInvestmentEgp.toLocaleString()} ج.م
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Three Decision Scenarios */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {/* Base Scenario */}
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e', marginBottom: 6 }}>
                    1. السيناريو الأساسي (Base Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e293b' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.base.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#64748b', marginBottom: 4 }}>
                    شاملة سعر المصنع، النولون، والجمارك المحسوبة
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المستهدفة: {feasibilityResult.scenarios.base.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#059669', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.base.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.base.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: 4 }}>
                    نقطة التعادل: بيع {feasibilityResult.scenarios.base.breakEvenUnits} قطعة من أصل{' '}
                    {feasibilityResult.totalUnitsCount} لاسترداد التكلفة الاستثمارية بالكامل.
                  </div>
                </div>

                {/* Best Scenario */}
                <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#047857', marginBottom: 6 }}>
                    2. السيناريو المتفائل (Best Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#047857' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.best.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#047857', fontWeight: 700, marginBottom: 4 }}>
                    وفر{' '}
                    {(
                      feasibilityResult.scenarios.base.totalInvestmentEgp -
                      feasibilityResult.scenarios.best.totalInvestmentEgp
                    ).toLocaleString()}{' '}
                    ج.م في الكاش بفضل خصم الشحن
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المتوقعة: {feasibilityResult.scenarios.best.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#047857', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.best.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.best.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#047857', marginTop: 4 }}>
                    وفر 5% في نولون الشحن مع سرعة تصريف البضاعة بسعر ممتاز.
                  </div>
                </div>

                {/* Worst Scenario */}
                <div style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#be123c', marginBottom: 6 }}>
                    3. السيناريو المتحفظ (Worst Scenario)
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#be123c' }}>
                    السيولة المطلوبة للتمويل: {feasibilityResult.scenarios.worst.totalInvestmentEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '9.5px', color: '#be123c', fontWeight: 700, marginBottom: 4 }}>
                    زيادة{' '}
                    {(
                      feasibilityResult.scenarios.worst.totalInvestmentEgp -
                      feasibilityResult.scenarios.base.totalInvestmentEgp
                    ).toLocaleString()}{' '}
                    ج.م كاش تحوطاً للأرضيات والتأخير
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    المبيعات المتحفظة: {feasibilityResult.scenarios.worst.expectedRevenueEgp.toLocaleString()} ج.م
                  </div>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#be123c', marginTop: 4 }}>
                    صافي الربح: {feasibilityResult.scenarios.worst.expectedNetProfitEgp.toLocaleString()} ج.م (
                    {feasibilityResult.scenarios.worst.roiPercentage}%)
                  </div>
                  <div style={{ fontSize: '10px', color: '#be123c', marginTop: 4 }}>
                    تحوط ضد انخفاض السعر 10% واحتساب 15,000 ج.م غرامات أرضيات تأخير.
                  </div>
                </div>
              </div>

              {/* 4. Detailed Landed Cost & Market Arbitrage Table */}
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
                  تحليل تكلفة القطعة الواصلة وهوامش الربح مقارنة بأسعار السوق المصري
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>الصنف</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>الكمية</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر المصنع ($)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>تكلفة القطعة الواصلة (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر الجملة المقترح ({targetMarkup}%)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>سعر السوق المحلي (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>صافي ربح القطعة (ج.م)</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }} title="هامش الربح الفعلي المحقق بناءً على سعر البيع في السوق المصري مقارنة بالتكلفة الواصلة">هامش ربح السوق %</th>
                        <th style={{ padding: '6px 8px', fontSize: '11px', color: '#475569' }}>إجمالي ربح الصنف (ج.م)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feasibilityResult.items.map((it: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700 }}>{it.name}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px' }}>{it.qty}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontFamily: 'monospace' }}>${it.factoryPriceUsd}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 800, color: '#170e5e' }}>
                            {it.unitLandedCostEgp} ج.م
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#0284c7' }}>
                            {it.suggestedWholesalePriceEgp} ج.م
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                            {it.expectedLocalMarketPriceEgp ? `${it.expectedLocalMarketPriceEgp.toLocaleString()} ج.م` : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: (it.unitNetProfitVsMarketEgp || 0) >= 0 ? '#15803d' : '#b91c1c',
                            }}
                          >
                            {formatMarketProfitEgp(it.unitNetProfitVsMarketEgp)}
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '11.5px', fontWeight: 700, color: '#15803d' }}>
                            {it.marginVsMarketPercent !== undefined ? `${it.marginVsMarketPercent}%` : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: '#15803d',
                              backgroundColor: '#f0fdf4',
                            }}
                          >
                            {it.totalProfitVsMarketEgp !== undefined
                              ? `${it.totalProfitVsMarketEgp.toLocaleString()} ج.م`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Conversion Button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingTop: 8 }}>
                {!feasibilityProjectId && (
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#b45309' }}>
                    الاعتماد متاح فقط عند فتح دراسة الجدوى من صف مشروع قائم — لن يتم إنشاء مشروع جديد من هنا.
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleConvertFeasibilityToProject}
                  disabled={convertFeasibilityMutation.isPending || updateProjectMutation.isPending || !feasibilityProjectId}
                  title={feasibilityProjectId ? 'اعتماد دراسة الجدوى على المشروع الحالي' : 'افتح دراسة الجدوى من صف المشروع لاعتمادها عليه'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 18px',
                    backgroundColor: '#15803d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircleIcon size={16} />
                  <span>
                    {convertFeasibilityMutation.isPending
                      ? 'جاري التحويل...'
                      : 'اعتماد دراسة الجدوى وتحويلها لمشروع استيراد معتمد'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </StandardDialog>

      {/* 4. New Project Dialog */}
      <StandardDialog
        open={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        title="إنشاء مشروع استيراد جديد (New Import Project)"
        subtitle="تسجيل تفاصيل المشروع، الميزانية، مواصفات الحاوية والميناء، وتوزيع نسب الشركاء"
        width="min(880px, 96vw)"
        compact
      >
        <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Section 1: Basic Project Info & Sector */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.2fr)', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  اسم المشروع والصفقة المستهدفة *
                </label>
                <button
                  type="button"
                  onClick={handleGenerateSuggestedTitle}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#170e5e',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                  title="توليد اسم مقترح للصفقة تلقائياً بناءً على مواصفات الحاوية والقطاع"
                >
                  <RefreshCwIcon size={11} />
                  <span>توليد اسم مقترح</span>
                </button>
              </div>
              <input
                type="text"
                required
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="أدخل اسم المشروع أو الصفقة (مثال: استيراد حاوية قطع غيار نقل ثقيل - كوانزو 2026)"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                القطاع التجاري المستهدف
              </label>
              <select
                value={targetSector}
                onChange={(e) => {
                  setTargetSector(e.target.value);
                  setPickerSector(e.target.value);
                }}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', backgroundColor: '#ffffff' }}
              >
                {availableSectors.map((sec: any) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                قالب القطاع لأصناف الاستيراد
              </label>
              <select
                value={sectorPreset}
                onChange={(e) => setSectorPreset(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', backgroundColor: '#ffffff' }}
              >
                <option value="">عام — بدون قالب (بدون فئة أو باركود أو هامش تلقائي)</option>
                {sectorPresets.map((preset: any) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.nameAr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 2: Logistics & Container Specifications */}
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TruckIcon size={14} />
              <span>مواصفات الشحن البحري وميناء الوصول والتعاقد</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                  نوع وحجم الحاوية
                </label>
                <select
                  value={containerType}
                  onChange={(e) => setContainerType(e.target.value)}
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
                >
                  <option value="40FT">40 قدم عادية (24 طن / 60 CBM - الأنسب للنقل)</option>
                  <option value="40HC">40 قدم مرتفعة (High Cube - 70 CBM)</option>
                  <option value="20FT">20 قدم قياسية (21 طن / 28 CBM)</option>
                  <option value="LCL">شحنة جزئية مجزأة (LCL)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                  عدد الحاويات التقديري
                </label>
                <input
                  type="number"
                  min={1}
                  value={containerCount}
                  onChange={(e) => setContainerCount(Math.max(1, Number(e.target.value)))}
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                  ميناء الوصول المصري
                </label>
                <select
                  value={portOfDischarge}
                  onChange={(e) => setPortOfDischarge(e.target.value)}
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
                >
                  <option value="العين السخنة">العين السخنة (Sokhna Port)</option>
                  <option value="الإسكندرية والدخيلة">الإسكندرية والدخيلة (Alexandria)</option>
                  <option value="شرق بورسعيد">شرق بورسعيد (Port Said)</option>
                  <option value="دمياط">دمياط (Damietta)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                  شرط التعاقد (Incoterms)
                </label>
                <select
                  value={incoterms}
                  onChange={(e) => setIncoterms(e.target.value)}
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', backgroundColor: '#ffffff' }}
                >
                  <option value="FOB">FOB (استلام ظهر السفينة بالصين)</option>
                  <option value="CIF">CIF (شامل النولون والتأمين)</option>
                  <option value="EXW">EXW (أرض المصنع بالصين)</option>
                  <option value="CFR">CFR (شامل النولون فقط)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 2 }}>
                  بلد ومنشأ الشراء
                </label>
                <input
                  type="text"
                  value={countryOrigin}
                  onChange={(e) => setCountryOrigin(e.target.value)}
                  style={{ width: '100%', height: 32, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '11.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 2 }}>
                  سوق الوصول والتوزيع
                </label>
                <input
                  type="text"
                  value={targetMarket}
                  onChange={(e) => setTargetMarket(e.target.value)}
                  style={{ width: '100%', height: 32, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '11.5px' }}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Capital, Currency Converter & Target ROI */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <DollarSignIcon size={14} color="#15803d" />
                <span>رأس المال المرصود ومحول العملة اللحظي</span>
              </div>
              {/* Currency Capsule Selector */}
              <div style={{ display: 'flex', backgroundColor: '#f1f5f9', padding: '2px', borderRadius: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (budgetCurrency !== 'EGP') {
                      setBudgetCurrency('EGP');
                      setAllocatedCapital(Math.round(allocatedCapital * (commRate || 50)));
                    }
                  }}
                  style={{
                    padding: '3px 12px',
                    border: 'none',
                    borderRadius: 5,
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: budgetCurrency === 'EGP' ? '#170e5e' : 'transparent',
                    color: budgetCurrency === 'EGP' ? '#ffffff' : '#64748b',
                  }}
                >
                  جنيه مصري (EGP)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (budgetCurrency !== 'USD') {
                      setBudgetCurrency('USD');
                      setAllocatedCapital(Math.round(allocatedCapital / (commRate || 50)));
                    }
                  }}
                  style={{
                    padding: '3px 12px',
                    border: 'none',
                    borderRadius: 5,
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: budgetCurrency === 'USD' ? '#170e5e' : 'transparent',
                    color: budgetCurrency === 'USD' ? '#ffffff' : '#64748b',
                  }}
                >
                  دولار أمريكي (USD)
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 3 }}>
                  مبلغ رأس المال المرصود ({budgetCurrency === 'EGP' ? 'جنيه مصري' : 'دولار أمريكي'})
                </label>
                <input
                  type="number"
                  value={allocatedCapital}
                  onChange={(e) => setAllocatedCapital(Number(e.target.value))}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '13px', fontWeight: 700 }}
                />
                <div style={{ marginTop: 4, fontSize: '11px', color: '#0369a1', fontWeight: 600 }}>
                  {budgetCurrency === 'EGP' ? (
                    <span>
                      ما يعادل: <strong>${Math.round(allocatedCapital / (commRate || 50)).toLocaleString()} دولار أمريكي</strong> تقريباً (بسعر صرف تجاري {commRate || 50} ج.م/$)
                    </span>
                  ) : (
                    <span>
                      ما يعادل: <strong>{(allocatedCapital * (commRate || 50)).toLocaleString()} جنيه مصري</strong> تقريباً (بسعر صرف تجاري {commRate || 50} ج.م/$)
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 3 }}>
                  العائد المستهدف على الاستثمار ROI (%)
                </label>
                <input
                  type="number"
                  value={targetRoi}
                  onChange={(e) => setTargetRoi(Number(e.target.value))}
                  style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '13px', fontWeight: 700 }}
                />
                <div style={{ marginTop: 4, fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
                  صافي الربح المستهدف: {budgetCurrency === 'EGP'
                    ? `${Math.round(allocatedCapital * (targetRoi / 100)).toLocaleString()} ج.م`
                    : `$${Math.round(allocatedCapital * (targetRoi / 100)).toLocaleString()}`}
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Partners & Equity Allocation (Dynamic & Non-hardcoded) */}
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <UsersIcon size={14} color="#170e5e" />
                <span>هيكل الشركاء وتوزيع نسب الأرباح وحصص رأس المال</span>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                  ({selectedPartners.filter((p) => p.isSelected).length} شركاء نشطين)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={handleAddPartner}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 5,
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#15803d',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="إضافة شريك جديد لهيكل الصفقة"
                >
                  <PlusCircleIcon size={12} />
                  <span>إضافة شريك</span>
                </button>
                <button
                  type="button"
                  onClick={handleDistributeEqualPercentages}
                  title="توزيع نسب الأرباح وحصص رأس المال بالتساوي على الشركاء النشطين"
                  style={{
                    padding: '3px 8px',
                    backgroundColor: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    borderRadius: 5,
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#3730a3',
                    cursor: 'pointer',
                  }}
                >
                  توزيع بالتساوي
                </button>
                <button
                  type="button"
                  onClick={handleDistributeByCapital}
                  title="احتساب نسب الأرباح تلقائياً وفقاً لنسبة رأس مال كل شريك"
                  style={{
                    padding: '3px 8px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  توزيع حسب رأس المال
                </button>
              </div>
            </div>

            {/* Datalist for registered partners autocompletion */}
            <datalist id="registered-partners-list">
              {partnersData.map((p: any) => (
                <option key={p.id} value={p.name}>
                  {p.name} (مسجل - نسبة معتمدة: {p.profit_share_percentage}%)
                </option>
              ))}
            </datalist>

            {/* Column Headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '24px minmax(0, 1.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr) 30px',
                gap: 8,
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                borderBottom: '1px solid #f1f5f9',
                marginBottom: 4,
              }}
            >
              <span title="تفعيل / استبعاد">نشط</span>
              <span>اسم الشريك / صفته ودوره في الصفقة</span>
              <span>حصة رأس المال ({budgetCurrency})</span>
              <span style={{ textAlign: 'center' }}>نسبة الربح %</span>
              <span style={{ textAlign: 'center' }}>حذف</span>
            </div>

            {/* Partner Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '220px', overflowY: 'auto' }}>
              {selectedPartners.map((partner, idx) => (
                <div
                  key={partner.id || idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px minmax(0, 1.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr) 30px',
                    gap: 8,
                    alignItems: 'center',
                    backgroundColor: partner.isSelected ? '#f8fafc' : '#ffffff',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    opacity: partner.isSelected ? 1 : 0.6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={partner.isSelected}
                    title={partner.isSelected ? 'شريك نشط' : 'شريك مستبعد من هذه الصفقة'}
                    onChange={(e) => {
                      const updated = [...selectedPartners];
                      updated[idx].isSelected = e.target.checked;
                      setSelectedPartners(updated);
                    }}
                    style={{ cursor: 'pointer', width: 15, height: 15 }}
                  />

                  {/* Editable Partner Name Input with Datalist Autocomplete */}
                  <div>
                    <input
                      type="text"
                      list="registered-partners-list"
                      placeholder={`اسم الشريك أو دوره (مثال: شريك ${idx + 1})`}
                      value={partner.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matching = partnersData.find((p: any) => p.name === val);
                        const updated = [...selectedPartners];
                        updated[idx].name = val;
                        if (matching) {
                          updated[idx].partnerId = matching.id;
                          if (matching.capital_amount) updated[idx].capitalShare = Number(matching.capital_amount);
                          if (matching.profit_share_percentage) updated[idx].profitPercentage = Number(matching.profit_share_percentage);
                        } else {
                          updated[idx].partnerId = '';
                        }
                        setSelectedPartners(updated);
                      }}
                      style={{
                        width: '100%',
                        height: 30,
                        padding: '2px 8px',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#0f172a',
                      }}
                    />
                  </div>

                  {/* Capital Share Input */}
                  <div>
                    <input
                      type="number"
                      placeholder={`حصة رأس المال (${budgetCurrency})`}
                      value={partner.capitalShare || ''}
                      onChange={(e) => {
                        const updated = [...selectedPartners];
                        updated[idx].capitalShare = Number(e.target.value);
                        setSelectedPartners(updated);
                      }}
                      style={{
                        width: '100%',
                        height: 30,
                        padding: '2px 8px',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        fontSize: '11.5px',
                      }}
                    />
                  </div>

                  {/* Profit Percentage Input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="%"
                      value={partner.profitPercentage || ''}
                      onChange={(e) => {
                        const updated = [...selectedPartners];
                        updated[idx].profitPercentage = Number(e.target.value);
                        setSelectedPartners(updated);
                      }}
                      style={{
                        width: '100%',
                        height: 30,
                        padding: '2px 4px',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        fontSize: '11.5px',
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#64748b' }}>%</span>
                  </div>

                  {/* Delete Partner Button */}
                  <button
                    type="button"
                    onClick={() => handleRemovePartner(idx)}
                    title="حذف هذا الشريك من الصفقة"
                    disabled={selectedPartners.length <= 1}
                    style={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid #fecdd3',
                      borderRadius: 4,
                      backgroundColor: '#fff1f2',
                      color: '#e11d48',
                      cursor: selectedPartners.length <= 1 ? 'not-allowed' : 'pointer',
                      opacity: selectedPartners.length <= 1 ? 0.35 : 1,
                      padding: 0,
                    }}
                  >
                    <Trash2Icon size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Total Balance Status Bar */}
            {(() => {
              const active = selectedPartners.filter((p) => p.isSelected);
              const totalCap = active.reduce((sum, p) => sum + Number(p.capitalShare || 0), 0);
              const totalPct = active.reduce((sum, p) => sum + Number(p.profitPercentage || 0), 0);
              const isPctBalanced = Math.abs(totalPct - 100) < 0.5;
              const isCapBalanced = totalCap === allocatedCapital;

              return (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                    padding: '6px 10px',
                    borderRadius: 6,
                    backgroundColor: '#f1f5f9',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>مجموع حصص رأس المال:</span>
                    <strong style={{ color: isCapBalanced ? '#15803d' : '#b45309' }}>
                      {totalCap.toLocaleString()} {budgetCurrency}
                    </strong>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>
                      (من المرصود: {allocatedCapital.toLocaleString()} {budgetCurrency})
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#475569' }}>إجمالي نسب الأرباح:</span>
                    <span
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 800,
                        color: isPctBalanced ? '#15803d' : '#b45309',
                      }}
                    >
                      {totalPct.toFixed(1)}% {isPctBalanced ? '(متزن تماماً)' : '(غير متزن)'}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Section 5: Project Notes */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              ملاحظات وشروط المشروع الإضافية
            </label>
            <textarea
              rows={2}
              value={projectNotes}
              onChange={(e) => setProjectNotes(e.target.value)}
              placeholder="مثال: شروط فحص GOEIC، مهلة سماح أرضيات الحاويات (Free Demurrage 14 يوم)، مواعيد الدفع للمصنع..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>

          {/* Actions Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={() => setIsNewProjectOpen(false)}
              style={{ padding: '8px 18px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={createProjectMutation.isPending}
              style={{ padding: '8px 24px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {createProjectMutation.isPending ? 'جاري الحفظ...' : 'إنشاء المشروع واعتماد الشركاء'}
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* 5. Close Project & Distribute Profit Dialog */}
      {closingProject && (
        <StandardDialog
          open={!!closingProject}
          onClose={() => setClosingProject(null)}
          title={`إقفال حسابات مشروع الاستيراد: ${closingProject.project_no}`}
          subtitle="احتساب صافي الأرباح المحققة فعلياً من بيع دفعات المشروع وتوزيع أنصبة الشركاء"
          width="580px"
          compact
        >
          <form onSubmit={handleCloseProject} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', fontSize: '12.5px' }}>
              <div><strong>اسم المشروع:</strong> {closingProject.title}</div>
              <div style={{ marginTop: 4, color: '#475569' }}>
                يتطلب إقفال المشروع موافقة رقابية ثنائية معتمدة (Maker-Checker) وعدم وجود شحنات معلقة أو عهد مخلصين غير مصفاة أو تأمينات حاويات غير مستردة.
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  طلب الاعتماد الرقابي المعتمد (Maker-Checker) *
                </label>
                <button
                  type="button"
                  onClick={handleRequestClosureApproval}
                  disabled={createApprovalMutation.isPending}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  + رفع طلب اعتماد إقفال للمدير الآن
                </button>
              </div>
              <select
                value={selectedApprovalId}
                onChange={(e) => setSelectedApprovalId(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', marginBottom: 6 }}
              >
                <option value="">-- اختر موافقة معتمدة أو أدخل المعرف بالأسفل --</option>
                {approvalRequests
                  .filter(
                    (r: any) =>
                      (r.action_type === 'project_closure' || r.request_type === 'project_closure') &&
                      r.reference_id === closingProject.id
                  )
                  .map((r: any) => (
                    <option key={r.id} value={r.id}>
                      #{String(r.id).slice(0, 8)} - الحالة: {r.status === 'approved' ? 'معتمد' : r.status === 'pending' ? 'قيد المراجعة' : 'مرفوض'}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                required
                value={selectedApprovalId}
                onChange={(e) => setSelectedApprovalId(e.target.value)}
                placeholder="معرف طلب الموافقة المعتمد (UUID)"
                style={{ width: '100%', height: 34, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                ملاحظات الإقفال والتسوية الختامية
              </label>
              <textarea
                rows={2}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="مثال: تمت مطابقة كافة الفواتير وإيصالات التخليص واسترداد تأمينات الحاويات بالكامل..."
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setClosingProject(null)}
                style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={closeProjectMutation.isPending}
                style={{ padding: '8px 18px', backgroundColor: '#170e5e', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
              >
                {closeProjectMutation.isPending ? 'جاري الإقفال...' : 'تأكيد إقفال المشروع وتوزيع الأرباح'}
              </button>
            </div>
          </form>
        </StandardDialog>
      )}

      {/* Official Egypt Customs Tariffs & Truck Spare Parts Picker Dialog */}
      {isTariffPickerOpen && (
        <StandardDialog
          isOpen={isTariffPickerOpen}
          onClose={() => setIsTariffPickerOpen(false)}
          title="مكتبة التعريفة الجمركية المصرية المعتمدة (القرار 218 لسنة 2022 وتعديلاته)"
          subtitle="اختر البند الجمركي لاستيراد قطع غيار الشاحنات أو البضائع لإدراجه فوراً في دراسة الجدوى وتطبيق نسب الرسوم الدقيقة"
          width="min(1240px, 96vw)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Quick Sector Selector Tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setPickerSector('commercial_vehicles_spare_parts')}
                style={{
                  padding: '7px 14px',
                  borderRadius: 20,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: pickerSector === 'commercial_vehicles_spare_parts' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: pickerSector === 'commercial_vehicles_spare_parts' ? '#170e5e' : '#ffffff',
                  color: pickerSector === 'commercial_vehicles_spare_parts' ? '#ffffff' : '#334155',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckShieldIcon size={14} />
                <span>قطع غيار سيارات النقل والتريلات (5%)</span>
              </button>

              <button
                type="button"
                onClick={() => setPickerSector('all')}
                style={{
                  padding: '7px 14px',
                  borderRadius: 20,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: pickerSector === 'all' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: pickerSector === 'all' ? '#170e5e' : '#ffffff',
                  color: pickerSector === 'all' ? '#ffffff' : '#334155',
                }}
              >
                <span>كافة القطاعات</span>
              </button>

              {availableSectors
                .filter((sec: any) => sec.id !== 'commercial_vehicles_spare_parts')
                .map((sec: any) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setPickerSector(sec.id)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 20,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: pickerSector === sec.id ? '2px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: pickerSector === sec.id ? '#170e5e' : '#ffffff',
                      color: pickerSector === sec.id ? '#ffffff' : '#334155',
                    }}
                  >
                    <span>{sec.name_ar}</span>
                  </button>
                ))}
            </div>

            {/* Search Input Bar */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="ابحث برقم البند HS Code أو اسم القطعة أو التصنيف (مثال: فرامل، محرك، تروس، 8708.30، تيل، مساعدين...)"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '6px 40px 6px 14px',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: 8,
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ position: 'absolute', right: 12, top: 11, color: '#94a3b8' }}>
                <SearchIcon size={18} />
              </span>
              {pickerSearch && (
                <button
                  type="button"
                  onClick={() => setPickerSearch('')}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 10,
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Sector Context Alert */}
            {pickerSector === 'commercial_vehicles_spare_parts' && (
              <div
                style={{
                  padding: '8px 14px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  fontSize: '11.5px',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckShieldIcon size={15} />
                <span>
                  <strong>ميزة تشغيلية لقطاع النقل التجاري:</strong> تخضع قطع غيار سيارات النقل والتريلات لتعريفة جمركية مخفضة وموحدة بنسبة <strong>5%</strong> معفاة من ضريبة الجدول، مع ضريبة قيمة مضافة <strong>14%</strong> ورسوم فحص رقابي (صادرات وواردات) <strong>1%</strong>.
                </span>
              </div>
            )}

            {/* Tariffs Fixed-Layout Table with Zero Horizontal Scrolling */}
            <div
              style={{
                height: '380px',
                maxHeight: '380px',
                minHeight: '280px',
                overflowY: 'scroll',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                backgroundColor: '#ffffff',
              }}
              onWheel={(e) => {
                e.stopPropagation();
              }}
            >
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right' }}>
                <colgroup>
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '140px' }} />
                </colgroup>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 2 }}>
                  <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>HS Code</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>الوصف وتوصيف البند المعتمد</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>التصنيف / الجهة الرقابية</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>الجمارك</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>قيمة مضافة</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {isTariffsLoading ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                        جاري تحميل بنود التعريفة الجمركية...
                      </td>
                    </tr>
                  ) : displayedTariffs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                        لا توجد بنود مطابقة لبحثك في هذا القطاع.
                      </td>
                    </tr>
                  ) : (
                    displayedTariffs.map((t: any) => (
                      <tr
                        key={t.id || t.hs_code}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.1s',
                        }}
                      >
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              fontSize: '12px',
                              color: '#170e5e',
                              backgroundColor: '#eef2ff',
                              padding: '2px 6px',
                              borderRadius: 4,
                              display: 'inline-block',
                              direction: 'ltr',
                            }}
                          >
                            {t.hs_code}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#0f172a',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.45,
                              textJustify: 'inter-word',
                            }}
                          >
                            {t.description_ar}
                          </div>
                          {t.description_en && (
                            <div
                              style={{
                                fontSize: '10.5px',
                                color: '#64748b',
                                whiteSpace: 'normal',
                                wordBreak: 'break-word',
                                direction: 'ltr',
                                textAlign: 'left',
                                marginTop: 2,
                              }}
                            >
                              {t.description_en}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                            {t.category_ar || 'قطع غيار ومكونات'}
                          </div>
                          <span
                            style={{
                              display: 'inline-block',
                              marginTop: 2,
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#475569',
                              backgroundColor: '#f1f5f9',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {t.regulatory_body || 'GOEIC رقابة صادرات'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 800,
                              color: Number(t.duty_rate_percent) <= 5 ? '#15803d' : '#0f172a',
                              backgroundColor: Number(t.duty_rate_percent) <= 5 ? '#dcfce7' : '#f8fafc',
                              padding: '2px 8px',
                              borderRadius: 6,
                              display: 'inline-block',
                            }}
                          >
                            {t.duty_rate_percent}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>
                            {t.vat_rate_percent}%
                          </span>
                          <span style={{ display: 'block', fontSize: '9.5px', color: '#94a3b8' }}>
                            + {t.inspection_fees_percent || 1}% فحص
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          {items.some((it) => it.hsCode === t.hs_code || it.name === t.description_ar) ? (
                            <button
                              type="button"
                              onClick={() => {
                                toast.warning(`البند الجمركي (${t.hs_code}) "${t.description_ar.slice(0, 30)}..." مضاف بالفعل في دراسة الجدوى.`);
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                backgroundColor: '#f0fdf4',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                                borderRadius: 6,
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'default',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <CheckCircleIcon size={13} color="#16a34a" />
                              <span>مضاف بالدراسة</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSelectTariffItem(t)}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 6,
                                fontSize: '11.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <PlusCircleIcon size={13} />
                              <span>+ إدراج في الجدوى</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Dialog Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                تم إدراج {items.length} صنف في دراسة الجدوى الحالية. يمكنك إدراج أكثر من بند متتالي دون إغلاق النافذة.
              </span>
              <button
                type="button"
                onClick={() => setIsTariffPickerOpen(false)}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                تم والعودة لدراسة الجدوى
              </button>
            </div>
          </div>
        </StandardDialog>
      )}
      </main>
    </div>
  );
}
