/*
New file: backend/test/critical/import-feasibility-demurrage-cbm.spec.ts
Pins the I2-P9 feasibility-engine fixes (trial problem 9, 2026-11-09).

THE DEFECTS, driving the REAL calculateImportFeasibility directly:
(a) CBM: a feasibility entry of unitCbm 0.01 was silently kept as 1.
    Grounding (probe 2026-11-09) proved the ENGINE is innocent — it
    returns unitCbm 0.01 and totalVolumeCbm 0.1 for 10 x 0.01 — the
    loss was the frontend grid's controlled number input
    (value={it.unitCbm || ''} + Number(e.target.value) collapses the
    "0." keystrokes, so typing 0.01 landed as 1). The engine half below
    is therefore a REGRESSION GUARD (it passes on base too, by design):
    the failing-on-base proof for the 0.01 loss is the frontend
    Vitest spec on parseFeasibilityNumberInput, which drives the fixed
    input parser. If this guard ever fails, the loss moved into the
    engine and the frontend fix alone no longer suffices.
(b) Demurrage: the worst scenario added a FIXED 15,000 EGP reserve
    regardless of shipment size — for the trial's 1,107.60 EGP study
    the reserve was 13.5x the whole investment. The reserve is now
    derived from the shipment's own values: containerCountNeeded x
    6 overdue days x $50/day (the same daily rate calculateDemurrageRisk
    assumes) x the study's own commercial rate. The 6 days decode the
    old flat 15,000 at the trial's rate (15,000 / ($50 x 50) = 6), so
    a one-container study at FX 50 still reserves exactly 15,000;
    the reserve now scales with containers and FX instead.

WHAT THIS PINS:
- CBM guard: unitCbm 0.01 survives the engine as 0.01 per unit and
  0.1 total for 10 units.
- Trial numbers unchanged: worst reserve 15,000, worst investment
  16,198.74, worst profit -14,952.69 at FX 50 / 1 container.
- Scaling (fail on base, where the reserve is always 15,000):
  FX 100 / 1 container -> 30,000; 2 containers at FX 50 -> 30,000;
  FX 48.5 / 1 container -> 14,550.
- Base/best scenarios carry a zero demurrage reserve.
*/

import { strict as assert } from 'node:assert';
import { calculateImportFeasibility } from '../../src/modules/import-sales/engines/import-feasibility.engine';

function trialInput(rate: number, qty = 10, unitWeightKg = 1) {
  return {
    items: [
      {
        name: 'test item',
        qty,
        factoryPriceUsd: 1,
        unitWeightKg,
        unitCbm: 0.01,
        expectedLocalMarketPriceEgp: 60,
      },
    ],
    exchangeRateCommercial: rate,
    internationalShippingUsd: 5,
    insuranceUsd: 1,
    customsDutyRatePercent: 5,
    vatRatePercent: 14,
    clearanceAndPortFeesEgp: 100,
    internalTransportEgp: 50,
  };
}

async function main(): Promise<void> {
  // Trial study (10 x $1, freight $5, FX 50): the live-proven numbers.
  const trial = calculateImportFeasibility(trialInput(50));
  assert.equal(trial.items[0].unitCbm, 0.01, 'unitCbm 0.01 must survive the engine as 0.01, never 1');
  assert.equal(trial.containerMetrics.totalVolumeCbm, 0.1, 'total volume is 10 x 0.01 = 0.1 CBM');
  assert.equal(trial.containerMetrics.containerCountNeeded, 1);
  assert.equal(trial.scenarios.worst.demurrageReserveEgp, 15000, 'one container at FX 50 still reserves 15,000');
  assert.equal(trial.scenarios.worst.totalInvestmentEgp, 16198.74, 'worst investment = 1107.60 + 607.60 x 15% + 15000');
  assert.equal(trial.scenarios.worst.expectedNetProfitEgp, -14952.69);
  assert.equal(trial.scenarios.base.demurrageReserveEgp, 0);
  assert.equal(trial.scenarios.best.demurrageReserveEgp, 0);

  // Same study priced at FX 100: the reserve follows the rate.
  const fx100 = calculateImportFeasibility(trialInput(100));
  assert.equal(fx100.scenarios.worst.demurrageReserveEgp, 30000, 'reserve doubles when the rate doubles (base: fixed 15000)');

  // Same study at FX 48.5: 6 days x $50/day x 48.5 = 14,550.
  const fx485 = calculateImportFeasibility(trialInput(48.5));
  assert.equal(fx485.scenarios.worst.demurrageReserveEgp, 14550, 'reserve follows the study rate, not a fixed lump sum');

  // Two containers (1,000 x 30 kg = 30,000 kg) at FX 50: twice the reserve.
  const twoContainers = calculateImportFeasibility(trialInput(50, 1000, 30));
  assert.equal(twoContainers.containerMetrics.containerCountNeeded, 2);
  assert.equal(
    twoContainers.scenarios.worst.demurrageReserveEgp,
    30000,
    'detention accrues per container: two containers reserve twice the one-container amount (base: fixed 15000)',
  );

  console.log('import feasibility demurrage + CBM checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
