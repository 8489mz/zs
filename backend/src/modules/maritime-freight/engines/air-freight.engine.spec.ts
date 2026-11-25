import { strict as assert } from 'node:assert';
import {
  calculateAirChargeableWeight,
  calculateAirFreightCost,
  validateIataAwbNumber,
  IATA_CARGO_IQ_MILESTONES,
} from './air-freight.engine';

// 1. Weight-dominant cargo (Gross weight > Volumetric weight)
{
  const res = calculateAirChargeableWeight({
    grossWeightKg: 500,
    cbm: 1.5, // 1.5 CBM * 166.667 = 250 kg volumetric
  });

  assert.equal(res.grossWeightKg, 500);
  assert.equal(Math.round(res.volumetricWeightKg), 250);
  assert.equal(res.chargeableWeightKg, 500);
  assert.equal(res.dominantFactor, 'weight');
}

// 2. Volume-dominant cargo (Volumetric weight > Gross weight)
{
  const res = calculateAirChargeableWeight({
    grossWeightKg: 100,
    cbm: 2.0, // 2.0 CBM * 166.667 = 333.334 kg
  });

  assert.equal(res.grossWeightKg, 100);
  assert.equal(Math.round(res.volumetricWeightKg), 333);
  assert.equal(Math.round(res.chargeableWeightKg), 333);
  assert.equal(res.dominantFactor, 'volume');
}

// 3. Package dimensions calculation: 10 boxes (60 x 50 x 40 cm), gross weight 80 kg
// Cubic cm = 60 * 50 * 40 * 10 = 1,200,000 cm3
// Volumetric = 1,200,000 / 6000 = 200 kg
{
  const res = calculateAirChargeableWeight({
    grossWeightKg: 80,
    dimensions: [{ lengthCm: 60, widthCm: 50, heightCm: 40, quantity: 10 }],
  });

  assert.equal(res.grossWeightKg, 80);
  assert.equal(res.volumetricWeightKg, 200);
  assert.equal(res.chargeableWeightKg, 200);
  assert.equal(res.totalCbm, 1.2);
  assert.equal(res.dominantFactor, 'volume');
}

// 4. Air Freight Cost calculation: 200 kg @ $3.50/kg, FSC $0.80/kg, SSC $0.15/kg, AWB $50
{
  const cost = calculateAirFreightCost({
    chargeableWeightKg: 200,
    ratePerKg: 3.5,
    minCharge: 100,
    fuelSurchargePerKg: 0.8,
    securitySurchargePerKg: 0.15,
    awbDocumentationFee: 50,
  });

  // Base = 200 * 3.50 = 700
  // FSC = 200 * 0.80 = 160
  // SSC = 200 * 0.15 = 30
  // AWB = 50
  // Total = 700 + 160 + 30 + 50 = 940
  assert.equal(cost.baseWeightCharge, 700);
  assert.equal(cost.isMinimumChargeApplied, false);
  assert.equal(cost.fuelSurcharge, 160);
  assert.equal(cost.securitySurcharge, 30);
  assert.equal(cost.awbFee, 50);
  assert.equal(cost.totalCost, 940);
}

// 5. Minimum charge rule applied
{
  const cost = calculateAirFreightCost({
    chargeableWeightKg: 10, // 10 kg @ $3.00/kg = $30 < min $75
    ratePerKg: 3.0,
    minCharge: 75,
    fuelSurchargePerKg: 0.5,
    securitySurchargePerKg: 0.1,
    awbDocumentationFee: 25,
  });

  assert.equal(cost.baseWeightCharge, 75);
  assert.equal(cost.isMinimumChargeApplied, true);
  assert.equal(cost.fuelSurcharge, 5); // 10 * 0.5
  assert.equal(cost.securitySurcharge, 1); // 10 * 0.1
  assert.equal(cost.totalCost, 106); // 75 + 5 + 1 + 25
}

// 6. Valid IATA AWB with Modulo-7 check digit:
// Airline: 077 (EgyptAir), Serial: 1234567, 1234567 % 7 = 5 -> AWB: 077-12345675
{
  const valid = validateIataAwbNumber('077-12345675');
  assert.equal(valid.valid, true);
  assert.equal(valid.airlinePrefix, '077');
  assert.equal(valid.serialNumber, '1234567');
  assert.equal(valid.checkDigit, 5);
}

// 7. Invalid IATA AWB (Check digit mismatch)
// 1234567 % 7 = 5, but check digit is 9
{
  const invalid = validateIataAwbNumber('077-12345679');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.error?.includes('Modulo-7'));
}

// 8. Invalid length
{
  const invalid = validateIataAwbNumber('077-123');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.error?.includes('11'));
}

// 9. Milestone definitions count
{
  assert.equal(IATA_CARGO_IQ_MILESTONES.length, 9);
  assert.equal(IATA_CARGO_IQ_MILESTONES[0].key, 'RCS');
  assert.equal(IATA_CARGO_IQ_MILESTONES[8].key, 'DLV');
}

console.log('air-freight.engine.spec: all 9 assertions passed successfully.');
