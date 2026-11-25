/**
 * Pure Calculation Engine: Road Freight & Inland Trucking Operations
 *
 * Implements Rule #13 (Financial & Operational Audit Protocol):
 * - Pure functions with zero external side effects or database calls.
 * - Single Source of Truth for Road Freight capacity, truck requirements, and cost calculations.
 * - Multi-factor constraint solver: solves required trucks by weight, volume, and pallet footprint.
 * - CMR / Overland Waybill validation and formatting.
 * - Standard operational milestones for domestic & cross-border inland transport.
 */

export type TruckTypeCode =
  | 'flatbed' // تريلا فرش / مسطحة (28T, 33 pallets)
  | 'curtainsider' // تريلا ستارة / طربال (26T, 86 CBM, 34 pallets)
  | 'box' // شاحنة مقفلة / صندوق مغلق (25T, 82 CBM, 33 pallets)
  | 'reefer' // شاحنة مبردة / ثلاجة (22T, 76 CBM, 32 pallets)
  | 'lowbed' // سطحة منخفضة / لوبد للحمولات الشاذة والثقيلة (50T)
  | 'jumbo' // سيارة جامبو شاسيه طويل (6.5T, 38 CBM, 12 pallets)
  | 'pickup'; // سيارة بيك أب / ربع نقل (1.8T, 10 CBM, 4 pallets)

export interface TruckSpecification {
  code: TruckTypeCode;
  name_ar: string;
  name_en: string;
  maxPayloadKg: number;
  maxCbm: number;
  maxStandardPallets: number; // 120 x 80 cm Euro standard
  idealCargoDescription: string;
}

export const STANDARD_TRUCK_SPECIFICATIONS: Record<TruckTypeCode, TruckSpecification> = {
  flatbed: {
    code: 'flatbed',
    name_ar: 'تريلا مسطحة / فرش (Flatbed Trailer)',
    name_en: 'Flatbed Trailer (28T / 13.6m)',
    maxPayloadKg: 28000,
    maxCbm: 75,
    maxStandardPallets: 33,
    idealCargoDescription: 'حديد وصلب، بضائع عامة، مواد بناء، ألواح رخام، حاويات بحرية',
  },
  curtainsider: {
    code: 'curtainsider',
    name_ar: 'تريلا ستارة / طربال جامبو (Curtainsider / Tautliner)',
    name_en: 'Curtainsider / Tautliner Trailer (26T / 86 CBM)',
    maxPayloadKg: 26000,
    maxCbm: 86,
    maxStandardPallets: 34,
    idealCargoDescription: 'بضائع معبأة، سلع استهلاكية سريعة FMCG، كراتين على طبليات، شحن جانبي سريع',
  },
  box: {
    code: 'box',
    name_ar: 'شاحنة مقفلة / صندوق مغلق (Box / Dry Van)',
    name_en: 'Box / Dry Van Trailer (25T / 82 CBM)',
    maxPayloadKg: 25000,
    maxCbm: 82,
    maxStandardPallets: 33,
    idealCargoDescription: 'أجهزة كهربائية وإلكترونيات، بضائع عالية القيمة ومؤمنة، منسوجات',
  },
  reefer: {
    code: 'reefer',
    name_ar: 'شاحنة مبردة / ثلاجة (Reefer / Temperature Controlled)',
    name_en: 'Reefer Truck (-25C to +25C / 22T)',
    maxPayloadKg: 22000,
    maxCbm: 76,
    maxStandardPallets: 32,
    idealCargoDescription: 'أغذية مبردة ومجمدة، لحوم ودواجن، خضروات وفواكه طازجة، أدوية ولقاحات',
  },
  lowbed: {
    code: 'lowbed',
    name_ar: 'سطحة منخفضة / لوبد للحمولات الثقيلة (Lowbed Heavy Haulage)',
    name_en: 'Lowbed Multi-Axle Heavy Hauler (50T)',
    maxPayloadKg: 50000,
    maxCbm: 100,
    maxStandardPallets: 20,
    idealCargoDescription: 'معدات إنشائية وحفارات، محولات كهرباء، ماكينات صناعية، حمولات استثنائية وشاذة',
  },
  jumbo: {
    code: 'jumbo',
    name_ar: 'سيارة جامبو شاسيه طويل (Jumbo 6.5T)',
    name_en: 'Jumbo Medium Truck (6.5T / 38 CBM)',
    maxPayloadKg: 6500,
    maxCbm: 38,
    maxStandardPallets: 12,
    idealCargoDescription: 'حمولات متوسطة الحجم، توزيع بين المدن الصناعية والمحافظات',
  },
  pickup: {
    code: 'pickup',
    name_ar: 'سيارة ربع نقل / بيك أب (Pickup / Small Van)',
    name_en: 'Pickup / Light Commercial Van (1.8T)',
    maxPayloadKg: 1800,
    maxCbm: 10,
    maxStandardPallets: 4,
    idealCargoDescription: 'توزيع محلي سريع، توصيل الميل الأخير، طرود وعينات عاجلة',
  },
};

export interface TruckRequirementInput {
  grossWeightKg: number;
  totalCbm?: number;
  palletCount?: number;
  preferredTruckType?: TruckTypeCode;
  assignedTrucks?: number;
  axleLoadsKg?: number[];
  maxAxleLoadKg?: number;
}

export interface TruckRequirementResult {
  truckType: TruckTypeCode;
  truckSpec: TruckSpecification;
  requiredTrucks: number;
  limitingFactor: 'weight' | 'volume' | 'pallets' | 'none';
  trucksByWeight: number;
  trucksByVolume: number;
  trucksByPallets: number;
  weightUtilizationPercent: number;
  volumeUtilizationPercent: number;
  palletUtilizationPercent: number;
}

/**
 * Solves the minimum number of trucks required to transport a shipment based on
 * weight, volume, and pallet footprint constraints simultaneously.
 */
export function calculateTrucksRequired(input: TruckRequirementInput): TruckRequirementResult {
  const typeCode =
    input.preferredTruckType && STANDARD_TRUCK_SPECIFICATIONS[input.preferredTruckType]
      ? input.preferredTruckType
      : 'flatbed';
  const spec = STANDARD_TRUCK_SPECIFICATIONS[typeCode];

  const grossWeightKg = Number(input.grossWeightKg ?? 0);
  const totalCbm = Number(input.totalCbm ?? 0);
  const palletCount = Number(input.palletCount ?? 0);
  if (![grossWeightKg, totalCbm, palletCount].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('Invalid road freight weight, volume or pallet count');
  }
  if (input.axleLoadsKg) {
    const axleLimit = Number(input.maxAxleLoadKg);
    if (
      !Number.isFinite(axleLimit) ||
      axleLimit <= 0 ||
      input.axleLoadsKg.length === 0 ||
      input.axleLoadsKg.some((load) => !Number.isFinite(load) || load < 0 || load > axleLimit) ||
      input.axleLoadsKg.reduce((sum, load) => sum + load, 0) < grossWeightKg
    ) {
      throw new Error('Truck axle load exceeds the permitted limit or lacks a valid limit');
    }
  }

  if (grossWeightKg === 0 && totalCbm === 0 && palletCount === 0) {
    return {
      truckType: typeCode,
      truckSpec: spec,
      requiredTrucks: 0,
      limitingFactor: 'none',
      trucksByWeight: 0,
      trucksByVolume: 0,
      trucksByPallets: 0,
      weightUtilizationPercent: 0,
      volumeUtilizationPercent: 0,
      palletUtilizationPercent: 0,
    };
  }

  const trucksByWeight = grossWeightKg > 0 ? Math.ceil(grossWeightKg / spec.maxPayloadKg) : 0;
  const trucksByVolume = totalCbm > 0 ? Math.ceil(totalCbm / spec.maxCbm) : 0;
  const trucksByPallets = palletCount > 0 ? Math.ceil(palletCount / spec.maxStandardPallets) : 0;

  const requiredTrucks = Math.max(1, trucksByWeight, trucksByVolume, trucksByPallets);
  if (
    input.assignedTrucks !== undefined &&
    (!Number.isInteger(input.assignedTrucks) || input.assignedTrucks < requiredTrucks)
  ) {
    throw new Error(`Shipment requires at least ${requiredTrucks} trucks for its weight and volume`);
  }

  let limitingFactor: 'weight' | 'volume' | 'pallets' | 'none' = 'weight';
  if (requiredTrucks === trucksByPallets && trucksByPallets > trucksByWeight && trucksByPallets >= trucksByVolume) {
    limitingFactor = 'pallets';
  } else if (requiredTrucks === trucksByVolume && trucksByVolume > trucksByWeight) {
    limitingFactor = 'volume';
  } else {
    limitingFactor = 'weight';
  }

  const totalCapacityKg = requiredTrucks * spec.maxPayloadKg;
  const totalCapacityCbm = requiredTrucks * spec.maxCbm;
  const totalCapacityPallets = requiredTrucks * spec.maxStandardPallets;

  const weightUtilizationPercent =
    totalCapacityKg > 0 ? Math.round((grossWeightKg / totalCapacityKg) * 10000) / 100 : 0;

  const volumeUtilizationPercent =
    totalCapacityCbm > 0 && totalCbm > 0 ? Math.round((totalCbm / totalCapacityCbm) * 10000) / 100 : 0;

  const palletUtilizationPercent =
    totalCapacityPallets > 0 && palletCount > 0 ? Math.round((palletCount / totalCapacityPallets) * 10000) / 100 : 0;

  return {
    truckType: typeCode,
    truckSpec: spec,
    requiredTrucks,
    limitingFactor,
    trucksByWeight,
    trucksByVolume,
    trucksByPallets,
    weightUtilizationPercent,
    volumeUtilizationPercent,
    palletUtilizationPercent,
  };
}

export interface RoadFreightCostInput {
  pricingMode: 'per_trip' | 'per_ton' | 'per_km';
  rate: number;
  truckCount?: number;
  grossWeightTons?: number;
  distanceKm?: number;
  emptyReturnFee?: number;
  roadTollsFee?: number;
  fuelSurcharge?: number;
  detentionDays?: number;
  detentionDailyRate?: number;
  loadingWaitHours?: number;
  unloadingWaitHours?: number;
  borderWaitHours?: number;
  freeWaitingHours?: number;
  detentionHourlyRate?: number;
  overnightDays?: number;
  customsBorderFee?: number;
  escortOverweightFee?: number;
  otherCharges?: number;
}

export interface RoadFreightCostResult {
  pricingMode: 'per_trip' | 'per_ton' | 'per_km';
  baseFreightCost: number;
  truckCount: number;
  detentionCost: number;
  emptyReturnFee: number;
  roadTollsFee: number;
  fuelSurcharge: number;
  customsBorderFee: number;
  escortOverweightFee: number;
  otherCharges: number;
  totalCost: number;
}

/**
 * Calculates complete Road Freight Cost including trip base rates, distance/ton rates,
 * empty return penalties, weighbridge/tolls (كارتات), detention/demurrage (يوميات مبيت),
 * and cross-border customs/escort charges.
 */
export function calculateRoadFreightCost(input: RoadFreightCostInput): RoadFreightCostResult {
  const mode = input.pricingMode || 'per_trip';
  const trucks = Number(input.truckCount ?? 1);
  const rate = Number(input.rate ?? 0);
  if (!Number.isInteger(trucks) || trucks <= 0 || !Number.isFinite(rate) || rate < 0) {
    throw new Error('Invalid truck count or freight rate');
  }

  let baseFreightCost = 0;
  if (mode === 'per_trip') {
    baseFreightCost = Math.round(trucks * rate * 100) / 100;
  } else if (mode === 'per_ton') {
    const tons = Math.max(0, Number(input.grossWeightTons || 0));
    baseFreightCost = Math.round(tons * rate * 100) / 100;
  } else if (mode === 'per_km') {
    const km = Math.max(0, Number(input.distanceKm || 0));
    baseFreightCost = Math.round(km * rate * trucks * 100) / 100;
  }

  const detentionDays = Number(input.detentionDays ?? 0);
  const detentionRate = Number(input.detentionDailyRate ?? 0);
  const waits = [input.loadingWaitHours, input.unloadingWaitHours, input.borderWaitHours].map((value) =>
    Number(value ?? 0),
  );
  const waitingHours = waits.reduce((sum, value) => sum + value, 0);
  const freeHours = Number(input.freeWaitingHours ?? 0);
  const overnightDays = Number(input.overnightDays ?? detentionDays);
  const hourlyRate = Number(input.detentionHourlyRate ?? 0);
  if (
    ![...waits, freeHours, overnightDays, hourlyRate, detentionDays, detentionRate].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  ) {
    throw new Error('Invalid truck detention duration or rate');
  }
  const detentionCost =
    Math.round((Math.max(0, waitingHours - freeHours) * hourlyRate + overnightDays * detentionRate) * trucks * 100) /
    100;

  const emptyReturnFee = Math.round(Math.max(0, Number(input.emptyReturnFee || 0)) * 100) / 100;
  const roadTollsFee = Math.round(Math.max(0, Number(input.roadTollsFee || 0)) * 100) / 100;
  const fuelSurcharge = Math.round(Math.max(0, Number(input.fuelSurcharge || 0)) * 100) / 100;
  const customsBorderFee = Math.round(Math.max(0, Number(input.customsBorderFee || 0)) * 100) / 100;
  const escortOverweightFee = Math.round(Math.max(0, Number(input.escortOverweightFee || 0)) * 100) / 100;
  const otherCharges = Math.round(Math.max(0, Number(input.otherCharges || 0)) * 100) / 100;

  const totalCost =
    Math.round(
      (baseFreightCost +
        detentionCost +
        emptyReturnFee +
        roadTollsFee +
        fuelSurcharge +
        customsBorderFee +
        escortOverweightFee +
        otherCharges) *
        100,
    ) / 100;

  return {
    pricingMode: mode,
    baseFreightCost,
    truckCount: trucks,
    detentionCost,
    emptyReturnFee,
    roadTollsFee,
    fuelSurcharge,
    customsBorderFee,
    escortOverweightFee,
    otherCharges,
    totalCost,
  };
}

export interface WaybillValidationResult {
  valid: boolean;
  cleanNumber?: string;
  formattedWaybill?: string;
  isInternationalCmr?: boolean;
  error?: string;
}

/**
 * Validates Road Waybill / Consignment Note / CMR number.
 * Formats standard domestic and international road waybills (e.g. CMR-EG-260914-001 or WB-1029384).
 */
export function validateCmrWaybillNumber(waybillNo: string): WaybillValidationResult {
  if (!waybillNo || typeof waybillNo !== 'string') {
    return { valid: false, error: 'رقم بوليصة الشحن البري / تذكرة النقل مطلوب' };
  }

  const clean = waybillNo.trim().toUpperCase();
  if (clean.length < 4 || clean.length > 30) {
    return {
      valid: false,
      error: 'طول رقم بوليصة الشحن البري يجب أن يكون بين 4 إلى 30 حرفاً ورقماً',
    };
  }

  // Check valid characters (alphanumeric, hyphens, slashes)
  if (!/^[A-Z0-9\-\/]+$/.test(clean)) {
    return {
      valid: false,
      error: 'رقم بوليصة الشحن البري يحتوي على رموز غير مقبولة (يسمح بالحروف الإنجليزية والأرقام والشرطات فقط)',
    };
  }
  if (!/\d/.test(clean) || /[-\/]{2}|^[-\/]|[-\/]$/.test(clean)) {
    return { valid: false, error: 'رقم بوليصة الشحن البري غير مكتمل' };
  }

  const isInternationalCmr = clean.startsWith('CMR') || clean.includes('/CMR/') || clean.startsWith('TIR');
  if (isInternationalCmr && (!/(?:^|\/)(?:CMR|TIR)[-/]/.test(clean) || (clean.match(/\d/g) || []).length < 3)) {
    return { valid: false, error: 'رقم بوليصة CMR/TIR غير مكتمل؛ يلزم مرجع متسلسل واضح' };
  }
  const formattedWaybill = clean;

  return {
    valid: true,
    cleanNumber: clean,
    formattedWaybill,
    isInternationalCmr,
  };
}

export const ROAD_FREIGHT_MILESTONES = [
  { key: 'TRK_ASSIGN', title_ar: 'تعيين الشاحنة والسائق', title_en: 'Truck & Driver Assigned', category: 'origin' },
  {
    key: 'TRK_GATE_IN',
    title_ar: 'وصول الشاحنة لموقع التحميل',
    title_en: 'Arrived at Origin / Gate In',
    category: 'origin',
  },
  {
    key: 'TRK_LOADED',
    title_ar: 'إتمام التحميل وتربيط البضاعة',
    title_en: 'Cargo Loaded & Lashed',
    category: 'origin',
  },
  {
    key: 'TRK_DISPATCH',
    title_ar: 'انطلاق الشاحنة على الطريق (En Route)',
    title_en: 'Truck Dispatched / En Route',
    category: 'transit',
  },
  {
    key: 'TRK_BORDER',
    title_ar: 'الوصول للمنفذ الجمركي / معبر الحدود',
    title_en: 'Border Clearance / Waypoint',
    category: 'transit',
  },
  {
    key: 'TRK_ARRIVED',
    title_ar: 'وصول الشاحنة لموقع العميل المستلم',
    title_en: 'Arrived at Destination',
    category: 'destination',
  },
  {
    key: 'TRK_UNLOADED',
    title_ar: 'إتمام تفريغ البضاعة ومطابقة الطرود',
    title_en: 'Cargo Unloaded',
    category: 'destination',
  },
  {
    key: 'TRK_POD',
    title_ar: 'توقيع بوليصة الشحن وإثبات التسليم (POD)',
    title_en: 'Proof of Delivery / Signed CMR',
    category: 'destination',
  },
] as const;
