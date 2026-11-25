/**
 * Pure Calculation Engine: Air Freight & Multimodal Logistics
 *
 * Implements Rule #13 (Financial & Operational Audit Protocol):
 * - Pure functions with zero external side effects or database calls.
 * - Single Source of Truth for IATA Volumetric & Chargeable Weight calculations.
 * - IATA Modulo-7 Air Waybill (AWB) validation and formatting.
 * - Air Freight surcharge and weight-break cost calculations.
 */

export interface CargoDimension {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  quantity: number;
}

export interface AirWeightCalculationInput {
  grossWeightKg: number;
  cbm?: number;
  dimensions?: CargoDimension[];
  divisor?: 6000 | 5000 | number; // 6000 for standard IATA air freight, 5000 for express courier (DHL/FedEx/UPS)
  roundToHalfKg?: boolean; // IATA Resolution 502: round up to next 0.5 kg (defaults to true)
}

export interface AirWeightCalculationResult {
  grossWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  rawChargeableWeightKg: number;
  totalCbm: number;
  dominantFactor: 'weight' | 'volume';
  volumeRatio: number; // volumetric / gross
  divisorUsed: number;
}

/**
 * Calculates Volumetric Weight and Chargeable Weight according to IATA Air Cargo Standard:
 * 1 CBM = 166.67 kg (Ratio 1:6000 cm3/kg) or 200 kg (Ratio 1:5000 cm3/kg for courier).
 * Chargeable Weight = Max(Gross Weight, Volumetric Weight) rounded up to nearest 0.5 kg.
 */
export function calculateAirChargeableWeight(input: AirWeightCalculationInput): AirWeightCalculationResult {
  const grossWeightKg = Number(input.grossWeightKg ?? 0);
  const divisor = Number(input.divisor ?? 6000);
  if (!Number.isFinite(grossWeightKg) || grossWeightKg < 0 || !Number.isFinite(divisor) || divisor <= 0) {
    throw new Error('Invalid air cargo weight or volumetric divisor');
  }
  const roundToHalfKg = input.roundToHalfKg !== false; // defaults to true per IATA
  let totalCbm = 0;
  let volumetricWeightKg = 0;

  if (input.dimensions && input.dimensions.length > 0) {
    let totalCubicCm = 0;
    for (const d of input.dimensions) {
      const l = Number(d.lengthCm);
      const w = Number(d.widthCm);
      const h = Number(d.heightCm);
      const q = Number(d.quantity);
      if (![l, w, h, q].every(Number.isFinite) || l <= 0 || w <= 0 || h <= 0 || !Number.isInteger(q) || q <= 0) {
        throw new Error('Invalid air cargo dimensions or package quantity');
      }
      totalCubicCm += l * w * h * q;
    }
    // Divisor: 6000 cm3 = 1 kg (IATA standard) or 5000 cm3 = 1 kg (Express courier)
    volumetricWeightKg = totalCubicCm / divisor;
    totalCbm = Math.round((totalCubicCm / 1000000) * 1000) / 1000;
  } else if (input.cbm !== undefined) {
    if (!Number.isFinite(Number(input.cbm)) || Number(input.cbm) < 0) {
      throw new Error('Invalid air cargo volume');
    }
    totalCbm = Number(input.cbm);
    // 1 CBM in kg = 1,000,000 / divisor (166.667 for 6000, 200 for 5000)
    const factor = 1000000 / divisor;
    volumetricWeightKg = totalCbm * factor;
  }

  const rawChargeableWeightKg = Math.max(grossWeightKg, volumetricWeightKg);
  // IATA standard: Round up to the next 0.5 kg
  const chargeableWeightKg = roundToHalfKg ? Math.ceil(rawChargeableWeightKg * 2) / 2 : rawChargeableWeightKg;

  const dominantFactor = volumetricWeightKg > grossWeightKg ? 'volume' : 'weight';
  const volumeRatio = grossWeightKg > 0 ? Math.round((volumetricWeightKg / grossWeightKg) * 100) / 100 : 0;

  return {
    grossWeightKg,
    volumetricWeightKg,
    chargeableWeightKg,
    rawChargeableWeightKg,
    totalCbm,
    dominantFactor,
    volumeRatio,
    divisorUsed: divisor,
  };
}

export interface AirFreightCostInput {
  chargeableWeightKg: number;
  ratePerKg: number;
  minCharge?: number;
  fuelSurchargePerKg?: number;
  securitySurchargePerKg?: number;
  awbDocumentationFee?: number;
  otherCharges?: number;
}

export interface AirFreightCostResult {
  chargeableWeightKg: number;
  baseWeightCharge: number;
  isMinimumChargeApplied: boolean;
  fuelSurcharge: number;
  securitySurcharge: number;
  awbFee: number;
  otherCharges: number;
  totalCost: number;
}

/**
 * Calculates Air Freight Cost with standard surcharges (FSC, SSC) and Minimum Charge rules.
 */
export function calculateAirFreightCost(input: AirFreightCostInput): AirFreightCostResult {
  const cw = Math.max(0, Number(input.chargeableWeightKg || 0));
  const rate = Math.max(0, Number(input.ratePerKg || 0));
  const minCharge = Math.max(0, Number(input.minCharge || 0));

  const rawWeightCharge = Math.round(cw * rate * 100) / 100;
  const isMinimumChargeApplied = minCharge > 0 && rawWeightCharge < minCharge;
  const baseWeightCharge = isMinimumChargeApplied ? minCharge : rawWeightCharge;

  const fuelSurcharge = Math.round(cw * Math.max(0, Number(input.fuelSurchargePerKg || 0)) * 100) / 100;
  const securitySurcharge = Math.round(cw * Math.max(0, Number(input.securitySurchargePerKg || 0)) * 100) / 100;
  const awbFee = Math.round(Math.max(0, Number(input.awbDocumentationFee || 0)) * 100) / 100;
  const otherCharges = Math.round(Math.max(0, Number(input.otherCharges || 0)) * 100) / 100;

  const totalCost =
    Math.round((baseWeightCharge + fuelSurcharge + securitySurcharge + awbFee + otherCharges) * 100) / 100;

  return {
    chargeableWeightKg: cw,
    baseWeightCharge,
    isMinimumChargeApplied,
    fuelSurcharge,
    securitySurcharge,
    awbFee,
    otherCharges,
    totalCost,
  };
}

export interface AwbValidationResult {
  valid: boolean;
  airlinePrefix?: string;
  serialNumber?: string;
  checkDigit?: number;
  formattedAwb?: string;
  error?: string;
}

/**
 * Validates an Air Waybill (AWB) number according to the IATA Modulo-7 check digit standard.
 * Standard format: PPP-SSSSSSSC (3-digit airline prefix + 7-digit serial + 1-digit check digit).
 * The check digit is equal to: (7-digit serial) mod 7.
 */
export function validateIataAwbNumber(awb: string): AwbValidationResult {
  if (!awb || typeof awb !== 'string') {
    return { valid: false, error: 'رقم بوليصة الشحن الجوي AWB مطلوب' };
  }

  // Remove spaces, hyphens, slashes
  const normalized = awb.trim();
  if (!/^(?:\d{11}|\d{3}-\d{8}|\d{3}-\d{4} \d{4})$/.test(normalized)) {
    return { valid: false, error: 'صيغة بوليصة الشحن الجوي غير صحيحة' };
  }
  const clean = normalized.replace(/[\s-]/g, '');

  // Must be exactly 11 digits
  if (!/^\d{11}$/.test(clean)) {
    return {
      valid: false,
      error: 'رقم بوليصة الشحن الجوي يجب أن يتكون من 11 رقماً (3 أرقام كود شركة الطيران + 8 أرقام متسلسلة)',
    };
  }

  const airlinePrefix = clean.slice(0, 3);
  const serial7 = clean.slice(3, 10);
  const checkDigit = Number(clean.slice(10, 11));

  const expectedCheckDigit = Number(serial7) % 7;
  const isCheckDigitValid = expectedCheckDigit === checkDigit;

  const formattedAwb = `${airlinePrefix}-${serial7.slice(0, 4)} ${serial7.slice(4)}${checkDigit}`;

  if (!isCheckDigitValid) {
    return {
      valid: false,
      airlinePrefix,
      serialNumber: serial7,
      checkDigit,
      formattedAwb,
      error: `رقم التحقق (Check Digit) غير صحيح: المتوقع ${expectedCheckDigit} لكن المسجل ${checkDigit} (IATA Modulo-7 Rule)`,
    };
  }

  return {
    valid: true,
    airlinePrefix,
    serialNumber: serial7,
    checkDigit,
    formattedAwb,
  };
}

export const IATA_CARGO_IQ_MILESTONES = [
  { key: 'BKD', title_ar: 'تأكيد حجز الشحنة الجوية', title_en: 'Air Cargo Booking Confirmed', category: 'booking' },
  {
    key: 'RCS',
    title_ar: 'استلام الشحنة بمستودع المطار (GTI)',
    title_en: 'Cargo Received from Shipper',
    category: 'origin',
  },
  { key: 'MAN', title_ar: 'إدراج الشحنة على مانيفست الرحلة', title_en: 'Manifested on Flight', category: 'origin' },
  { key: 'DEP', title_ar: 'إقلاع رحلة الشحن الجوي (ATD)', title_en: 'Flight Departed', category: 'flight' },
  { key: 'ARR', title_ar: 'هبوط ووصول الرحلة بمطار المقصد (ATA)', title_en: 'Flight Arrived', category: 'flight' },
  {
    key: 'RCF',
    title_ar: 'تفريغ ودخول الشحنة مستودع المطار',
    title_en: 'Cargo Received from Flight',
    category: 'destination',
  },
  {
    key: 'CUST',
    title_ar: 'إنهاء الإفراج والتخليص الجمركي بالمطار',
    title_en: 'Customs Cleared',
    category: 'destination',
  },
  { key: 'NFD', title_ar: 'إشعار العميل المستلم بالوصول', title_en: 'Consignee Notified', category: 'destination' },
  { key: 'AWD', title_ar: 'تسليم إذن التسليم والمستندات', title_en: 'Documents Delivered', category: 'delivery' },
  {
    key: 'DLV',
    title_ar: 'تسليم الشحنة للعميل نهائياً (POD)',
    title_en: 'Cargo Delivered (Proof of Delivery)',
    category: 'delivery',
  },
] as const;
