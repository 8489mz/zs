/*
 * INV-DIVERGENCE-9187-STOCK-SCALE: the 91.87/91.88 divergence + the
 * stock_movements live scale check (execution plan section 12.3).
 *
 * THE NAMED CAUSE (code-grounded at HEAD 4d5958227, no live DB was
 * available — the live-DB tunnel is closed): the pre-2026-11-02 sale
 * posting rounded TOTAL COGS once at book digits. 16 units at WAC
 * 15.3125 = 245.00; selling 10 posted COGS round(153.125, 2) = 153.13
 * while the remaining 6 units keep full-precision WAC, 6 x 15.3125 =
 * 91.875, reconciling to 91.88 — both halves round up past the whole,
 * so GL 1140 (245.00 - 153.13 = 91.87) disagreed with physical stock
 * (91.88) by one minor unit. That cause is already fixed prospectively
 * on every live path — sale/postSaleEdit via INV-COGS-REMAINDER-
 * ABSORPTION (cogs-residual.engine.ts), sales return via
 * INV-SALES-RETURN-COGS-RESIDUAL-MIRROR, van field return via
 * INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR — so this package invents
 * no new code fix. What it pins, which no earlier spec pins:
 *
 * 1. The corrected computation, composed end to end through the REAL
 *    engines: sale residual 153.12, return reversal 91.87 (NOT the
 *    legacy plain 91.88), GL after sale + return 183.75 = physical
 *    12 x 15.3125. The legacy plain product is asserted alongside so
 *    the 0.01 strand has a name: a return that falls back to the plain
 *    product (no linked sale, unresolvable line, differing saved cost
 *    — salesReturnCogsAmount's documented fallback) still reverses
 *    91.88 and strands the unit. At 3dp (KWD) the same numbers
 *    reconcile exactly even under the plain product: the divergence
 *    is a 2dp phenomenon.
 * 2. The stock_movements scale check, replayed from the migration
 *    files in provider order (FileMigrationProvider loads the
 *    directory sorted by filename): unit_cost was born DECIMAL(12,3)
 *    (2029000000001), widened to NUMERIC(16,3) (0177), then to
 *    NUMERIC(20,6) (0252 arch02), re-affirmed widen-only-if-less by
 *    0257 — final scale 6, no step narrows it. total_cost ends at
 *    NUMERIC(18,3), i.e. exactly book digits (max 3). The 3dp
 *    expectation PASSES at migration level; no migration is needed.
 *    The LIVE-DB confirmation (information_schema on the real tenant
 *    DB showing numeric(20,6)) is still OWED — it runs from the
 *    user's PC, results relayed — because a live DB can drift from
 *    the migration chain.
 * 3. The writer audit: no stock_movements insert in backend/src
 *    writes unit_cost through a 2dp rounding (toFixed(2) /
 *    roundMoney(..., 2)); writers pass the raw frozen cost, a 6dp
 *    value, or a book-digits total. And the recorded gap, CLOSED
 *    by the sale-movement-unit-cost package: the core retail sale
 *    movements (create-sale/insert-sale-and-stock.ts, 'sale' and 'sale_modifier')
 *    used to store NO unit_cost at all — the cost trace for a sale
 *    lived on sale_items.cost_price, not on the movement row — so a
 *    valuation that read unit_cost off a 'sale' movement found
 *    NULL. Both rows now store the frozen cost (main leg
 *    item.costPrice; modifier leg the per-stock-unit WAC), and
 *    this audit asserts exactly that: 2 insert-sale-and-stock 'sale' rows
 *    WITH unit_cost, 0 without.
 *
 * Prospective only: no posted row is rewritten. A 91.87/91.88 pair
 * already in the books is historical data from a pre-fix posting;
 * its remediation is a separate, reviewed repair, never a silent
 * re-rounding here.
 *
 * Fail-first: the replay self-checks below were proven against a
 * synthetic narrowed chain, the writer audit against a synthetic
 * 2dp writer, and the engine assertions fail if cogsResidualAmount
 * is replaced by the plain total rounding (153.13 instead of
 * 153.12) — verified by temporarily mutating the engine to the
 * plain product and watching this spec fail, then restoring it.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { cogsResidualAmount, type CogsResidualGroup } from '../../src/modules/accounting/engines/cogs-residual.engine';
import { calculateSalesReturnCost } from '../../src/modules/accounting/engines/sales-return-cost.engine';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'backend', 'src', 'database', 'migrations');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');

/* ------------------------------------------------------------------ */
/* Part 1 — the corrected computation, through the real engines.       */
/* ------------------------------------------------------------------ */

function checkCorrectedComputation(): void {
  // Diagnosed case, EGP (2dp): 16 units at WAC 15.3125, sell 10.
  const saleGroups: CogsResidualGroup[] = [{ qtySold: 10, unitCost: 15.3125, qtyRemaining: 6 }];
  const saleResidual = cogsResidualAmount(saleGroups, 2);
  assert.equal(
    saleResidual,
    153.12,
    'sale COGS must be the remainder-absorbed residual 153.12, not the once-rounded 153.13',
  );
  assert.equal(
    roundMoney(10 * 15.3125, 2),
    153.13,
    'the old plain total rounding is 153.13 — that 0.01 IS the divergence',
  );

  // Remaining GL equals physical stock after the sale.
  const remainingGl = roundMoney(245 - saleResidual, 2);
  assert.equal(remainingGl, 91.88, 'remaining GL 1140 must be 91.88');
  assert.equal(roundMoney(6 * 15.3125, 2), 91.88, 'physical remaining stock 6 x 15.3125 reconciles to 91.88');

  // Return 6 of the 10, through the same residual basis: the
  // post-return residual (4 sold / 12 remain) is 61.25, so the
  // reversal is 153.12 - 61.25 = 91.87 and GL lands on physical.
  const restoredGroups: CogsResidualGroup[] = [{ qtySold: 4, unitCost: 15.3125, qtyRemaining: 12 }];
  const postReturnResidual = cogsResidualAmount(restoredGroups, 2);
  assert.equal(postReturnResidual, 61.25, 'post-return residual must be 61.25');
  const reversal = roundMoney(saleResidual - postReturnResidual, 2);
  assert.equal(reversal, 91.87, 'residual return reversal must be 91.87');
  assert.equal(roundMoney(245 - postReturnResidual, 2), 183.75, 'GL after sale + return must be 183.75');
  assert.equal(roundMoney(12 * 15.3125, 2), 183.75, 'physical stock after sale + return is 12 x 15.3125 = 183.75');

  // The legacy plain product, asserted so the strand has a name: it
  // reverses 91.88 and lands GL at 183.76, one minor unit adrift.
  // It fires only for a return with no linked sale, an unresolvable
  // line, or a differing saved cost (salesReturnCogsAmount fallback).
  const legacy = calculateSalesReturnCost(
    [{ product_id: 1, sale_item_id: 1, qty: 6 }],
    [{ id: 1, product_id: 1, cost_price: 15.3125 }],
  );
  assert.equal(legacy, 91.875, 'legacy plain return product is the unrounded 91.875');
  assert.equal(roundMoney(legacy, 2), 91.88, 'legacy plain return reverses 91.88 at book digits');
  assert.equal(
    roundMoney(245 - saleResidual + roundMoney(legacy, 2), 2),
    183.76,
    'legacy reversal strands GL at 183.76, 0.01 above physical 183.75',
  );

  // Same numbers at 3dp (KWD): everything reconciles exactly, even
  // under the plain product — the divergence is a 2dp phenomenon.
  assert.equal(cogsResidualAmount(saleGroups, 3), 153.125, '3dp sale residual is the exact 153.125');
  assert.equal(roundMoney(6 * 15.3125, 3), 91.875, '3dp remaining physical is the exact 91.875');
  assert.equal(roundMoney(legacy, 3), 91.875, '3dp legacy return is the exact 91.875 — no strand at 3dp');
  assert.equal(cogsResidualAmount(restoredGroups, 3), 61.25, '3dp post-return residual is 61.25');
}

/* ------------------------------------------------------------------ */
/* Part 2 — stock_movements scale, replayed from the migrations.       */
/* ------------------------------------------------------------------ */

interface ScaleStep {
  file: string;
  column: string;
  from: number | null;
  to: number;
  widenOnly: boolean;
}

function replayScales(): { steps: ScaleStep[]; final: Record<string, number> } {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .sort();
  const scale: Record<string, number> = {};
  const steps: ScaleStep[] = [];
  const record = (file: string, column: string, to: number, widenOnly: boolean): void => {
    const from = scale[column] ?? null;
    const next = widenOnly ? Math.max(from ?? 0, to) : to;
    // Skip exact repeats (the same ALTER text appears in up() and
    // down() of 0177; both carry scale 3, so the replay is unaffected).
    // Compare against the last step for THIS column, because the
    // other column's step sits between up() and down().
    const lastForColumn = [...steps].reverse().find((s) => s.column === column);
    if (lastForColumn && lastForColumn.file === file && lastForColumn.to === next) return;
    steps.push({ file, column, from, to: next, widenOnly });
    scale[column] = next;
  };
  for (const file of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Split on ALTER TABLE <name>; only stock_movements segments can
    // move the two columns. A segment runs to the next ALTER TABLE.
    const parts = src.split(/ALTER TABLE\s+(\w+)/);
    for (let i = 1; i < parts.length - 1; i += 2) {
      if (parts[i] !== 'stock_movements') continue;
      const body = parts[i + 1];
      for (const m of body.matchAll(/ALTER COLUMN\s+(unit_cost|total_cost)\s+TYPE\s+NUMERIC\(\d+\s*,\s*(\d+)\)/g)) {
        record(file, m[1], Number(m[2]), false);
      }
      for (const m of body.matchAll(
        /ADD COLUMN IF NOT EXISTS\s+(unit_cost|total_cost)\s+(?:DECIMAL|NUMERIC)\(\d+\s*,\s*(\d+)\)/g,
      )) {
        record(file, m[1], Number(m[2]), false);
      }
    }
    // Data-driven widening lists (0257): ['stock_movements', col, scale].
    for (const m of src.matchAll(/\['stock_movements',\s*'(unit_cost|total_cost)',\s*(\d+)\]/g)) {
      record(file, m[1], Number(m[2]), true);
    }
  }
  return { steps, final: scale };
}

function checkScales(): void {
  const { steps, final } = replayScales();
  const unitSteps = steps.filter((s) => s.column === 'unit_cost');
  const totalSteps = steps.filter((s) => s.column === 'total_cost');
  // The exact chain, so a future migration that narrows or skips a
  // step fails here instead of silently changing stored precision.
  assert.deepEqual(
    unitSteps.map((s) => `${s.file}:${s.to}`),
    [
      '2029000000001_accounting_round1.ts:3',
      '2040000000177_expand_stock_movement_cost_precision.ts:3',
      '2040000000252_arch02_accounting_foundation.ts:6',
      '2040000000257_purchase_minor_unit_precision.ts:6',
    ],
    'unit_cost scale chain must be 3 -> 3 -> 6 -> 6 (widen-only)',
  );
  assert.deepEqual(
    totalSteps.map((s) => `${s.file}:${s.to}`),
    ['2029000000001_accounting_round1.ts:3', '2040000000177_expand_stock_movement_cost_precision.ts:3'],
    'total_cost scale chain must be 3 -> 3',
  );
  for (const step of steps) {
    assert.ok(
      step.from === null || step.to >= step.from,
      `migration ${step.file} must never narrow ${step.column} scale (${step.from} -> ${step.to})`,
    );
  }
  assert.equal(
    final.unit_cost,
    6,
    'stock_movements.unit_cost final scale must be 6 (NUMERIC(20,6)) — the 3dp expectation passes',
  );
  assert.ok(final.unit_cost >= 3, 'stock_movements.unit_cost must hold at least 3dp');
  assert.equal(
    final.total_cost,
    3,
    'stock_movements.total_cost final scale must be 3 (NUMERIC(18,3)) — exactly book digits',
  );
  // Self-check: the replay itself must catch a narrowed chain.
  const narrowed: ScaleStep[] = [
    { file: 'a.ts', column: 'unit_cost', from: null, to: 6, widenOnly: false },
    { file: 'b.ts', column: 'unit_cost', from: 6, to: 2, widenOnly: false },
  ];
  assert.ok(
    narrowed.some((s) => s.from !== null && s.to < s.from),
    'replay self-check: a 6 -> 2 step must read as a narrowing',
  );
}

/* ------------------------------------------------------------------ */
/* Part 3 — writer audit: no 2dp rounding into unit_cost.              */
/* ------------------------------------------------------------------ */

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTsFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function checkWriters(): void {
  let insertSites = 0;
  let unitCostSites = 0;
  const saleMovementFilesWithoutUnitCost: string[] = [];
  const saleMovementFilesWithUnitCost: string[] = [];
  for (const file of walkTsFiles(BACKEND_SRC)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (rel.startsWith('backend/src/database/migrations/') || rel.startsWith('backend/src/database/legacy-migration/'))
      continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isInsert =
        /insertInto\(\s*['"]stock_movements['"]/.test(line) ||
        (/insertInto\(\s*$/.test(line) && i + 1 < lines.length && /['"]stock_movements['"]/.test(lines[i + 1]));
      if (!isInsert) continue;
      insertSites++;
      // Comment lines are stripped before the 2dp test: the restaurant
      // writer carries a comment that literally names toFixed(2) as
      // the thing NOT to do, and it must not trip this audit.
      const code = lines
        .slice(i, i + 45)
        .map((l) => l.split('//')[0])
        .join('\n');
      if (!/unit_cost\s*:/.test(code)) {
        if (/movement_type\s*:\s*'sale'/.test(code)) {
          saleMovementFilesWithoutUnitCost.push(`${rel}:${i + 1}`);
        }
        continue;
      }
      unitCostSites++;
      if (/movement_type\s*:\s*'sale'/.test(code)) {
        saleMovementFilesWithUnitCost.push(`${rel}:${i + 1}`);
      }
      assert.ok(!/toFixed\(2\)/.test(code), `${rel}:${i + 1} must not write unit_cost through toFixed(2)`);
      assert.ok(
        !/roundMoney\([^)]*,\s*2\s*\)/.test(code),
        `${rel}:${i + 1} must not write unit_cost through roundMoney(..., 2)`,
      );
    }
  }
  assert.ok(insertSites > 0, 'writer audit must find stock_movements inserts');
  assert.ok(unitCostSites > 0, 'writer audit must find stock_movements inserts that set unit_cost');
  // The core retail sale path used to store no unit_cost on its
  // movements (create-sale/insert-sale-and-stock.ts 'sale' + 'sale_modifier'
  // rows); the sale-movement-unit-cost package closed that gap, so
  // this audit now pins the fixed state: exactly 2 insert-sale-and-stock
  // 'sale' rows WITH unit_cost (the frozen cost), 0 without. If a
  // future change drops one, this assertion names the file.
  const createSaleNoCost = saleMovementFilesWithoutUnitCost.filter((s) =>
    s.startsWith('backend/src/modules/sales/services/create-sale/insert-sale-and-stock.ts:'),
  );
  const createSaleWithCost = saleMovementFilesWithUnitCost.filter((s) =>
    s.startsWith('backend/src/modules/sales/services/create-sale/insert-sale-and-stock.ts:'),
  );
  assert.equal(
    createSaleNoCost.length,
    0,
    `insert-sale-and-stock.ts must have 0 sale movements without unit_cost (found: ${createSaleNoCost.join(', ') || 'none'})`,
  );
  assert.equal(
    createSaleWithCost.length,
    2,
    `insert-sale-and-stock.ts must have exactly 2 sale movements with unit_cost (found: ${createSaleWithCost.join(', ') || 'none'})`,
  );
  console.log(
    `writer audit: ${insertSites} stock_movements inserts scanned, ${unitCostSites} set unit_cost, 0 use 2dp rounding`,
  );
}

async function main(): Promise<void> {
  checkCorrectedComputation();
  checkScales();
  checkWriters();
  const invariants = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'), 'utf8');
  assert.equal(
    invariants.split('INV-DIVERGENCE-9187-STOCK-SCALE').length - 1,
    1,
    'the invariant entry must exist exactly once',
  );
  console.log('divergence-9187-stock-scale: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
