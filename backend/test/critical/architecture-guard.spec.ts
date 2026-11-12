/*
 * INV-ENGINE-MAP-GUARD: architecture guard spec.
 *
 * This spec guards the engine map (docs/ENGINE_MAP.md). It pins only
 * rules that are already closed, so it is green on the current HEAD
 * and fails on any regression or any NEW violation of the same kind.
 * The former marketplace-simulation pool-handle exception is CLOSED
 * (INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC): the simulation now
 * deducts inside this.db.transaction() on the transaction handle, so
 * zero pool-handle stock calls are allowed anywhere, and this spec
 * asserts zero (§4).
 *
 * G7 (U7) added the permanent-guard sections: the map rows are pinned
 * as the single source of truth (§12 — each row's status word must
 * match the verified state), new money-rounding code must go through
 * the canonical rounder (§7 repo-wide money-math scan, §10 private
 * rounders take digits), and the tax / FX / costing / payroll wiring
 * pins (§11) fail if a canonical call site is removed.
 *
 * Style follows the other critical specs: plain node:assert checks
 * run by ts-node, no test runner. File scanning reads the repository
 * on disk (the same technique as deploy-pipeline.spec.ts pinning the
 * CI workflow). The spec reads backend/src only, so its own pattern
 * strings cannot self-match.
 *
 * Fail-first: the matchers are self-checked against violating and clean
 * samples below, and the VAT rule was proven by temporarily inserting
 * `const vatRate = 15;` into the ZATCA builder copy and watching this
 * spec fail, then restoring the file.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_SRC = path.resolve(__dirname, '../../src');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const VAT_LITERAL = /(?:vatRate|taxRate)\s*=\s*(?:15|14|0\.15|0\.14)\b|<cbc:Percent>(?:15|14)<\/cbc:Percent>/;

async function main(): Promise<void> {
  // 1. Engine map exists, lists the canonical engines, files exist.
  const mapPath = path.join(REPO_ROOT, 'docs/ENGINE_MAP.md');
  assert.ok(fs.existsSync(mapPath), 'docs/ENGINE_MAP.md must exist');
  const map = fs.readFileSync(mapPath, 'utf8');
  const canonical = [
    'money-minor-units.engine.ts',
    'invoice-totals.ts',
    'invoice-discount.engine.ts',
    'sale-tax-rate.engine.ts',
    'fx-conversion.engine.ts',
    'fx-rate-resolution.ts',
    'pdc-currency.ts',
    'inventory-valuation.engine.ts',
    'location-stock-ledger.ts',
    'installment-interest.engine.ts',
    'gateway-amount.engine.ts',
    'van-common.util.ts',
    'users.service.ts',
  ];
  for (const file of canonical) {
    assert.ok(map.includes(file), `engine map must list ${file}`);
  }
  const srcFiles = walkTsFiles(BACKEND_SRC);
  assert.ok(srcFiles.some((f) => f.endsWith('money-minor-units.engine.ts')));
  assert.ok(srcFiles.some((f) => f.endsWith('location-stock-ledger.ts')));

  // 2. Canonical engines export the functions the map promises.
  const money = await import('../../src/modules/accounting/engines/money-minor-units.engine');
  assert.equal(typeof money.roundMoney, 'function');
  assert.equal(typeof money.currencyMoneyDigits, 'function');
  const valuation = await import('../../src/modules/accounting/engines/inventory-valuation.engine');
  assert.equal(typeof valuation.weightedReceiptCost, 'function');
  assert.equal(typeof valuation.recoverWacBeforeQty, 'function');
  const stockReceipt = await import('../../src/modules/accounting/inventory-valuation');
  assert.equal(typeof stockReceipt.valueStockReceipt, 'function');
  const discount = await import('../../src/modules/sales/engines/invoice-discount.engine');
  assert.equal(typeof discount.allocateInvoiceDiscount, 'function');
  const taxRate = await import('../../src/modules/sales/engines/sale-tax-rate.engine');
  assert.equal(typeof taxRate.resolveSaleTaxRate, 'function');
  const fx = await import('../../src/modules/accounting/engines/fx-conversion.engine');
  assert.equal(typeof fx.convertFxAmount, 'function');
  const resolveFx = await import('../../src/modules/accounting/fx-rate-resolution');
  assert.equal(typeof resolveFx.resolveFxRate, 'function');
  const interest = await import('../../src/modules/accounting/engines/installment-interest.engine');
  assert.equal(typeof interest.allocateInstallmentInterest, 'function');
  const totals = await import('../../src/common/utils/invoice-totals');
  assert.equal(typeof totals.computeInvoiceTotals, 'function');
  const vanCommon = await import('../../src/modules/delivery-reps/services/van-common.util');
  assert.equal(typeof vanCommon.generateDailySequenceNumber, 'function');

  // 3. Tax document builders never hardcode a VAT rate.
  const builders = [
    'backend/src/modules/tax-integration/services/zatca/zatca-phase2.service.ts',
    'backend/src/modules/tax-integration/services/eta-serializer/eta-serializer.service.ts',
  ];
  for (const builder of builders) {
    const stripped = stripComments(readFile(builder));
    assert.ok(!VAT_LITERAL.test(stripped), `${builder} must not hardcode a VAT rate`);
  }
  // Matcher self-checks: a violating line matches, clean code and a
  // comment mentioning a rate do not.
  assert.ok(VAT_LITERAL.test('const vatRate = 15;'));
  assert.ok(VAT_LITERAL.test('vatRate = 0.14'));
  assert.ok(!VAT_LITERAL.test('const vatRate = sale.tax_rate;'));
  assert.ok(!VAT_LITERAL.test(stripComments('// e.g. 15% VAT rate')));

  // 4. No stock-ledger call on the pool handle, anywhere. The former
  // marketplace-simulation exception is closed
  // (INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC): the simulation now
  // deducts inside this.db.transaction() on the transaction handle, so
  // the allowlist is zero, not one. A single new pool-handle call
  // anywhere is a regression.
  const poolCall = /(?:releaseLocationStock|reserveLocationStock|applyStockDelta)\s*\(\s*this\.db\b/;
  const matches: string[] = [];
  for (const file of srcFiles) {
    const stripped = stripComments(fs.readFileSync(file, 'utf8'));
    if (poolCall.test(stripped)) {
      // Windows returns backslash separators from path.relative; the
      // expected list uses forward slashes, so normalize on every OS.
      matches.push(path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
    }
  }
  assert.equal(
    matches.length,
    0,
    `no pool-handle stock call is allowed anywhere (found: ${matches.join(', ') || 'none'})`,
  );

  // 5. Sales order conversion: no swallowed re-reserve, no pool-handle release.
  const salesOrders = stripComments(readFile('backend/src/modules/sales/services/sales-orders.service.ts'));
  assert.ok(!salesOrders.includes('catch(() => undefined)'), 'no swallowed compensating write');
  assert.ok(!salesOrders.includes('releaseLocationStock(this.db'), 'no pool-handle release');
  assert.ok(salesOrders.includes('conversionRelease'), 'conversion release must stay wired into createSale');

  // 6. User privilege guards stay wired in UsersService.
  const usersService = readFile('backend/src/modules/users/users.service.ts');
  const grantCount = (usersService.match(/assertGrantWithinActorScope/g) || []).length;
  assert.ok(grantCount >= 3, 'grant-subset guard: definition + create + update call sites');
  const peerCount = (usersService.match(/assertPeerAdminActionAllowed/g) || []).length;
  assert.ok(peerCount >= 2, 'peer-admin guard: definition + call site');
  assert.ok(usersService.includes('SELF_PROMOTION_FORBIDDEN'));
  assert.ok(usersService.includes('GRANT_STAR_FORBIDDEN'));
  assert.ok(usersService.includes('GRANT_ROLE_ABOVE_ACTOR'));
  assert.ok(usersService.includes('PASSWORD_RESET_TARGET_RANK_FORBIDDEN'));
  assert.ok(usersService.includes('STATUS_CHANGE_TARGET_RANK_FORBIDDEN'));

  // 7. Repo-wide money-math scan (INV-GUARD-REPO-WIDE-MONEY-SCAN).
  // NO file under backend/src may format money with toFixed(2) or
  // round it with inline Math.round(x*100)/100 (or the *1000/1000
  // form): all money math goes through roundMoney at book digits (or
  // a digits-parameterised toFixed(digits) in the two rounder
  // helpers). This used to be a 30-file allowlist; the scan now
  // covers every file, so a brand-new money-engine file can no
  // longer slip past CI with a differently-named helper (e.g.
  // private calcTotal) or inline math — the F2 gap from the 2026-11-08
  // live re-check. Files with a live, dispositioned use are on the
  // allowlist below with the EXACT count of each pattern: a NEW
  // occurrence in an allowlisted file fails the count pin and must be
  // re-dispositioned (or routed through roundMoney) in the same
  // change. Percentages (Math.round(ratio*100) with no scale-down)
  // and minor-unit conversions (Math.round(amount*100) with no
  // scale-down) are NOT matches — only scale-down rounding counts.
  const TOFIXED_2 = /\.toFixed\(\s*2\s*\)/g;
  function countInlineMoneyRounding(source: string): number {
    // A match is Math.(round|floor|ceil)( <arg containing *100 or
    // *1000> ) / 100|1000, with balanced parens so nested calls such
    // as Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 count.
    let count = 0;
    const head = /Math\.(round|floor|ceil)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = head.exec(source)) !== null) {
      let depth = 0;
      let j = m.index + m[0].length - 1;
      for (; j < source.length; j++) {
        if (source[j] === '(') depth += 1;
        else if (source[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) continue;
      const arg = source.slice(m.index + m[0].length, j);
      const scale = /\*\s*1000\b/.test(arg) ? 1000 : /\*\s*100\b/.test(arg) ? 100 : 0;
      if (scale === 0) continue;
      if (new RegExp(`^\\s*/\\s*${scale}\\b`).test(source.slice(j + 1, j + 12))) count += 1;
    }
    return count;
  }
  const moneyMathAllowlist: Array<{ file: string; reason: string; toFixed2: number; inlineRound: number }> = [
    { file: 'backend/src/common/utils/financial-integrity.ts', reason: 'legacy safety rounders roundCurrency2dp/roundCurrency3dp — deliberately kept duplicate (unification scope decision); canonical rounder is roundMoney, this file is the fail-closed legacy guard, not a posting path', toFixed2: 0, inlineRound: 2 },
    { file: 'backend/src/core/health/health.controller.ts', reason: 'health metrics: uptime hours + memory MB, not money', toFixed2: 5, inlineRound: 0 },
    { file: 'backend/src/modules/accounting/engines/fixed-asset-depreciation.engine.ts', reason: 'fixed-asset depreciation schedule (pure computation engine, no digits context; schedule rounds at 2dp, bounded 0.005/line; postings read the schedule)', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/contracting/contracting.service.ts', reason: 'contracting module, set aside from retail unification (estimates, quantities, EVM indices, actuals; no retail journal posting reads these values)', toFixed2: 3, inlineRound: 24 },
    { file: 'backend/src/modules/contracting/field-indirect-allocation.engine.ts', reason: 'contracting module, set aside (indirect-cost allocation at 3dp; no retail posting)', toFixed2: 0, inlineRound: 18 },
    { file: 'backend/src/modules/contracting/guarantee-gateway.engine.ts', reason: 'contracting module, set aside (cumulative guarantee exposure; no retail posting)', toFixed2: 0, inlineRound: 2 },
    { file: 'backend/src/modules/contracting/ipc-calculation.engine.ts', reason: 'contracting module, set aside (IPC amounts: work done, advance recovery, retention; no retail posting)', toFixed2: 0, inlineRound: 6 },
    { file: 'backend/src/modules/delivery-reps/route-optimization.engine.ts', reason: 'route distances in km, not money', toFixed2: 5, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/services/van-fleet.service.ts', reason: 'fuel consumption rate km/litre, not money', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/services/van-fraud-radar.service.ts', reason: 'message text (amount formatted into a fraud alert), display only', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/services/van-routes.service.ts', reason: 'fuel efficiency km/litre, not money', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/services/van-transfers.service.ts', reason: 'van transfer retail value adjusting the sender trip loaded_amount (operational; transfers post no journal — stock movement only)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/van-sales.service.ts', reason: 'message text (invoice notes / settlement details / discount percentage in refusal messages), display only', toFixed2: 9, inlineRound: 0 },
    { file: 'backend/src/modules/delivery-reps/van-trip-reconciliation.engine.ts', reason: 'message text (credit-block / expense / daily-summary messages) + trip distance, display only', toFixed2: 22, inlineRound: 0 },
    { file: 'backend/src/modules/hr/engines/leave-balance.engine.ts', reason: 'leave-day balance, not money', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/hr/hr.service.ts', reason: 'leave-day counts + HR loan ledger listing (amounts read as stored; loan postings are payroll-engine values)', toFixed2: 11, inlineRound: 0 },
    { file: 'backend/src/modules/import-sales/engines/import-feasibility.engine.ts', reason: 'feasibility analysis: weights, volumes, ROI/margin percentages — not postings', toFixed2: 11, inlineRound: 0 },
    { file: 'backend/src/modules/import-sales/engines/import-landed-cost.engine.ts', reason: 'landed-cost shipment summary (USD total for display; per-item landed costs already route through roundMoney at book digits)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/import-sales/import-sales.service.ts', reason: 'import-sales non-posting math (report/summary/message values; postings route through the canonical landed-cost/WAC engines per the engine map money row)', toFixed2: 109, inlineRound: 0 },
    { file: 'backend/src/modules/inventory/engines/package-barcode.engine.ts', reason: 'package weight in kg at 3dp, not money', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/inventory/engines/quality-control.engine.ts', reason: 'inspected/accepted/rejected quantities, not money', toFixed2: 0, inlineRound: 3 },
    { file: 'backend/src/modules/inventory/helpers/stock-transfer-trace.helper.ts', reason: 'quantity rounding at 3dp (roundQty), not money', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/inventory/helpers/tracked-stock-increase.helper.ts', reason: 'quantity rounding at 3dp (roundQty), not money', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/manager-actions/helpers/manager-actions.helper.ts', reason: 'manager-action alert metrics (loss/margin/revenue/cost/balance values in alerts) + percentages, display only — no posting reads them', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/manager-actions/manager-dashboard.service.ts', reason: 'manager dashboard display aggregates + percentages (read-only cached overview, no posting)', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/maritime-freight/engines/air-freight.engine.ts', reason: 'maritime freight, set aside (volumetric weight kg + freight charges; not retail posting)', toFixed2: 0, inlineRound: 8 },
    { file: 'backend/src/modules/maritime-freight/engines/road-freight.engine.ts', reason: 'maritime freight, set aside (freight/detention/fees; not retail posting)', toFixed2: 0, inlineRound: 11 },
    { file: 'backend/src/modules/maritime-freight/maritime-freight.service.ts', reason: 'maritime freight, set aside (round3 3dp helper; not retail posting)', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/partners/partners.service.ts', reason: 'loyalty-points balance, not money', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/pricing/pricing.service.ts', reason: 'pricing preview (inventory/margin summary, display) + user-selected price rounding (commercial price endings, not book-digits postings)', toFixed2: 7, inlineRound: 0 },
    { file: 'backend/src/modules/purchases/engines/duplicate-bill-detector.engine.ts', reason: 'duplicate-bill comparison normalization (equality check only; no value is stored or posted from it)', toFixed2: 0, inlineRound: 2 },
    { file: 'backend/src/modules/purchases/three-way-match.engine.ts', reason: 'price-delta percentage, not money', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/reports/engines/pivot-aggregation.engine.ts', reason: 'non-money metric display (money metrics already route through roundMoney)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/reports/helpers/reports-menu-engineering.helper.ts', reason: 'menu-engineering report aggregates (read-only report; no posting)', toFixed2: 0, inlineRound: 13 },
    { file: 'backend/src/modules/reports/services/reports-summary.service.ts', reason: 'daily burn rate (qty/day) + dead-stock quantity, not money', toFixed2: 2, inlineRound: 0 },
    { file: 'backend/src/modules/returns/returns.service.ts', reason: 'loyalty-points balances, not money', toFixed2: 2, inlineRound: 0 },
    { file: 'backend/src/modules/sales/services/restaurant-advanced-fnb.service.ts', reason: 'table minimum-spend deficit (pure calculation returned to the caller; any charge posts through the sale engines)', toFixed2: 0, inlineRound: 1 },
    { file: 'backend/src/modules/sales/services/sales-write.service.ts', reason: 'loyalty-points balances, not money', toFixed2: 6, inlineRound: 0 },
    { file: 'backend/src/modules/settings/services/whatsapp-gateway.service.ts', reason: 'message text (amount formatted into a WhatsApp message), display only', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/storefront/services/marketplace-sync.service.ts', reason: 'marketplace fee/payout estimator (commercial fee tables; estimate for display/decision — order postings route through the canonical sale engines)', toFixed2: 0, inlineRound: 7 },
    { file: 'backend/src/modules/storefront/storefront-payment.service.ts', reason: 'payment-gateway signature string (gateway requires the 2dp format in the hash input; not a posting value)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/storefront/storefront.service.ts', reason: 'storefront display formatter (digits-aware: 3dp when book digits are 3, else 2dp/whole-EGP; display only)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/tax-integration/services/eta-serializer/eta-serializer.service.ts', reason: 'ETA e-invoice document serialization (amounts already computed by canonical engines; document format)', toFixed2: 1, inlineRound: 0 },
    { file: 'backend/src/modules/tax-integration/services/zatca/zatca-phase2.service.ts', reason: 'ZATCA e-invoice document XML (SAR amounts at the spec 2dp; amounts already computed by canonical engines)', toFixed2: 21, inlineRound: 0 },
  ];
  for (const file of srcFiles) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const stripped = stripComments(fs.readFileSync(file, 'utf8'));
    const toFixed2 = (stripped.match(TOFIXED_2) || []).length;
    const inlineRound = countInlineMoneyRounding(stripped);
    const entry = moneyMathAllowlist.find((e) => e.file === rel);
    if (entry) {
      assert.equal(
        toFixed2,
        entry.toFixed2,
        `${rel}: toFixed(2) count changed (${toFixed2} vs dispositioned ${entry.toFixed2}) — re-disposition the new site or route it through roundMoney`,
      );
      assert.equal(
        inlineRound,
        entry.inlineRound,
        `${rel}: inline Math.round(x*100)/100 count changed (${inlineRound} vs dispositioned ${entry.inlineRound}) — re-disposition the new site or route it through roundMoney`,
      );
    } else {
      assert.equal(
        toFixed2,
        0,
        `${rel} must not format money with toFixed(2) — route through roundMoney at book digits or add a dispositioned allowlist entry`,
      );
      assert.equal(
        inlineRound,
        0,
        `${rel} must not round money with inline Math.round(x*100)/100 — route through roundMoney at book digits or add a dispositioned allowlist entry`,
      );
    }
  }
  // Matcher self-checks: violating samples match, clean code and
  // lookalikes (percentages, minor-unit conversions, calls) do not.
  assert.equal(countInlineMoneyRounding('const x = Math.round(total * 100) / 100;'), 1);
  assert.equal(countInlineMoneyRounding('const x = Math.round((Math.abs(n) + Number.EPSILON) * 1000) / 1000;'), 1);
  assert.equal(countInlineMoneyRounding('const x = Math.floor(value * 100) / 100;'), 1);
  assert.equal(countInlineMoneyRounding('const pct = Math.round(ratio * 100);'), 0);
  assert.equal(countInlineMoneyRounding('const cents = Math.round(amount * 100);'), 0);
  assert.equal(countInlineMoneyRounding('const q = Math.round(qty);'), 0);
  assert.equal(countInlineMoneyRounding('const x = roundMoney(total, digits);'), 0);
  assert.equal(countInlineMoneyRounding('const x = Math.round(a) + Math.round(b * 100) / 100;'), 1);
  assert.ok('const s = value.toFixed(2);'.match(TOFIXED_2));
  assert.ok(!'const s = value.toFixed(digits);'.match(TOFIXED_2));
  assert.ok(!'const s = value.toFixed(3);'.match(TOFIXED_2));

  // 8. Closed invariants stay recorded.
  const invariants = readFile('ARCHITECTURE_INVARIANTS.md');
  for (const id of [
    'INV-USER-SELF-PROMOTION-FORBIDDEN',
    'INV-USER-GRANT-SUBSET',
    'INV-USER-PEER-ADMIN-ACTIONS',
    'INV-SALES-ORDER-CONVERSION-STOCK-LEGS',
    'INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY',
    'INV-SEQUENCE-NUMBER-FAIL-CLOSED',
    'INV-TREASURY-EXPENSE-IDEMPOTENCY',
    'INV-ENGINE-MAP-GUARD',
    'INV-SUBSCRIPTION-TAX-RATE-SOURCE',
    'INV-MARITIME-FREIGHT-TAX',
    'INV-FX-RATE-HISTORY-CONSUMER',
    'INV-IMPORT-LANDED-COST-CANONICAL',
    'INV-IMPORT-RECEIPT-BOOK-DIGITS',
    'INV-IMPORT-BROKER-LOT-EGP-DIGITS',
    'INV-VALUE-STOCK-RECEIPT-ALREADY-CANONICAL',
    'INV-PAYROLL-EOS-DEDUP',
    'INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC',
  ]) {
    assert.ok(invariants.includes(id), `invariant ${id} must stay recorded`);
  }

  // 10. Private money rounders take digits and delegate to the
  // canonical rounder. A private toMoney/money/roundMoney/
  // roundCurrency without a digits parameter is a silent-2dp default
  // waiting to happen; a rounder that never calls roundMoney (or a
  // digits-parameterised toFixed(digits)) is a second implementation.
  // The default `= 2` on three of the known rounders (trial-balance,
  // reports-math, purchases-write) is an accepted D1/D3 decision: the
  // parameter exists and every live caller passes book digits.
  const ROUNDER_DEF =
    /(?:private\s+(?:toMoney|money|roundMoney|roundCurrency)|(?:export\s+)?function\s+toMoney)\s*\([^)]*\)/g;
  let rounderFiles = 0;
  for (const file of srcFiles) {
    const stripped = stripComments(fs.readFileSync(file, 'utf8'));
    const defs = stripped.match(ROUNDER_DEF) || [];
    if (defs.length > 0) rounderFiles += 1;
    for (const def of defs) {
      assert.ok(
        def.includes('digits'),
        `${file}: private money rounder must take a digits parameter (found: ${def})`,
      );
    }
    if (defs.length > 0) {
      assert.ok(
        stripped.includes('roundMoney(') || stripped.includes('toFixed(digits)'),
        `${file}: private money rounder must delegate to roundMoney or toFixed(digits)`,
      );
    }
  }
  assert.ok(rounderFiles > 0, 'the rounder scan must find the known private rounders');
  // Matcher self-checks: a digits-less definition is caught, a
  // digits-aware one is not, and a call site is not a definition.
  assert.ok(
    ('private toMoney(value: unknown): number {'.match(ROUNDER_DEF) || []).some((d) => !d.includes('digits')),
    'digits-less rounder definition must be caught',
  );
  assert.ok(
    ('private toMoney(value: unknown, digits: MoneyDigits): number {'.match(ROUNDER_DEF) || []).every((d) =>
      d.includes('digits'),
    ),
    'digits-aware rounder definition must pass',
  );
  assert.ok(!'const x = roundMoney(amount, digits);'.match(ROUNDER_DEF), 'a roundMoney call is not a definition');
  assert.ok(
    !'return this.toMoney(total, digits);'.match(ROUNDER_DEF),
    'a toMoney call is not a definition',
  );

  // 11. Canonical wiring pins: the U1–U4 unifications stay wired.
  // Tax rates resolve through resolveSaleTaxRate (one call site in
  // subscription creation, three in maritime charges); FX as-of reads
  // through exchangeRateAsOf; landed cost allocates through
  // allocateLandedCosts and blends through weightedReceiptCost; payroll
  // delay + EOS absorption route through their engines (R1). The
  // maritime FX threshold is >= 5, not >= 7: it pins the wiring
  // without pinning the two small resolver helpers' structure.
  function countOccurrences(source: string, needle: string): number {
    return source.split(needle).length - 1;
  }
  const subscription = stripComments(
    readFile('backend/src/modules/sales/services/commercial-subscription.service.ts'),
  );
  assert.ok(
    countOccurrences(subscription, 'resolveSaleTaxRate(') >= 1,
    'subscription billing must resolve its tax rate through resolveSaleTaxRate',
  );
  const maritime = stripComments(readFile('backend/src/modules/maritime-freight/maritime-freight.service.ts'));
  assert.ok(
    countOccurrences(maritime, 'resolveSaleTaxRate(') >= 3,
    'maritime charge tax must resolve through resolveSaleTaxRate at all three sites',
  );
  assert.ok(
    countOccurrences(maritime, 'resolveFxRate(') >= 5,
    'maritime FX must resolve through resolveFxRate',
  );
  const fxResolution = readFile('backend/src/modules/accounting/fx-rate-resolution.ts');
  assert.ok(fxResolution.includes('exchangeRateAsOf'), 'fx-rate-resolution must read the as-of rate history');
  const accountingService = stripComments(readFile('backend/src/modules/accounting/accounting.service.ts'));
  assert.ok(
    accountingService.includes('resolveFxRate(this.db, scope.tenantId, fromCode, { asOf })'),
    'convertCurrency must pass asOf through resolveFxRate',
  );
  const importSales = stripComments(readFile('backend/src/modules/import-sales/import-sales.service.ts'));
  assert.ok(
    countOccurrences(importSales, 'resolveFxRate(') >= 1,
    'import-sales must resolve FX through resolveFxRate',
  );
  const landed = readFile('backend/src/modules/import-sales/engines/import-landed-cost.engine.ts');
  assert.ok(
    landed.includes('allocateLandedCosts'),
    'import landed-cost engine must allocate through allocateLandedCosts',
  );
  const importInventory = readFile('backend/src/modules/import-sales/import-inventory-cost.engine.ts');
  assert.ok(
    importInventory.includes('weightedReceiptCost('),
    'import inventory cost must blend through weightedReceiptCost',
  );
  const inventoryValuation = readFile('backend/src/modules/accounting/inventory-valuation.ts');
  assert.ok(
    inventoryValuation.includes('weightedReceiptCost('),
    'valueStockReceipt must blend through weightedReceiptCost',
  );
  const hrService = stripComments(readFile('backend/src/modules/hr/hr.service.ts'));
  assert.ok(
    hrService.includes('calculateProgressiveDelayDeduction('),
    'payroll review must route delay deduction through the canonical engine',
  );
  const postingService = stripComments(readFile('backend/src/modules/accounting/accounting-posting.service.ts'));
  assert.ok(
    postingService.includes('calculateSettlementAbsorption('),
    'EOS settlement must route absorption through the canonical engine',
  );
  // Matcher self-checks.
  assert.equal(countOccurrences('a resolveSaleTaxRate( b resolveSaleTaxRate( c', 'resolveSaleTaxRate('), 2);
  assert.equal(countOccurrences('no calls here', 'resolveSaleTaxRate('), 0);

  // 12. The engine map is the single source of truth: each row's
  // status word must match the verified state below. A row may only
  // change status together with the code change that closes or opens
  // it — and this section is updated in the same package.
  const mapLines = map.split('\n');
  function mapRow(anchor: string): string {
    const row = mapLines.find((line) => line.startsWith('|') && line.includes(anchor));
    assert.ok(row, `engine map must contain a row for ${anchor}`);
    return row as string;
  }
  function mapStatus(anchor: string): string {
    const cells = mapRow(anchor)
      .split('|')
      .map((c) => c.trim());
    return cells[3] ?? '';
  }
  const expectedStatuses: Array<[string, string]> = [
    ['Money precision / rounding', 'PARTIAL'],
    ['Invoice totals + discount allocation', 'UNIFIED'],
    ['Sale tax-rate sourcing', 'UNIFIED'],
    ['FX conversion + rate resolution', 'PARTIAL'],
    ['Costing / WAC', 'UNIFIED'],
    ['Stock ledger', 'UNIFIED'],
    ['Installment interest', 'UNIFIED'],
    ['Payroll / EOS engines', 'UNIFIED'],
    ['Gateway amounts', 'UNIFIED'],
    ['Document sequence numbers', 'PARTIAL'],
    ['User privilege guards', 'UNIFIED'],
    ['Idempotency (money writes)', 'PARTIAL'],
    ['Outbox (inbound webhooks)', 'PARTIAL'],
    ['Business date', 'PARTIAL'],
  ];
  for (const [anchor, expected] of expectedStatuses) {
    assert.ok(
      mapStatus(anchor).startsWith(expected),
      `engine map row "${anchor}" must be ${expected} (found: ${mapStatus(anchor)})`,
    );
  }
  // The refreshed rows cite the invariant that closed them.
  assert.ok(mapRow('Sale tax-rate sourcing').includes('INV-SUBSCRIPTION-TAX-RATE-SOURCE'));
  assert.ok(mapRow('Sale tax-rate sourcing').includes('INV-MARITIME-FREIGHT-TAX'));
  assert.ok(mapRow('FX conversion + rate resolution').includes('INV-FX-RATE-HISTORY-CONSUMER'));
  assert.ok(mapRow('Costing / WAC').includes('INV-IMPORT-LANDED-COST-CANONICAL'));
  assert.ok(mapRow('Payroll / EOS engines').includes('INV-PAYROLL-EOS-DEDUP'));
  assert.ok(mapRow('Stock ledger').includes('INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC'));
  // Matcher self-checks: the parser reads the status cell of a sample row.
  const sampleRow = '| Sale tax-rate sourcing | `engine` | UNIFIED for sales |';
  assert.equal(
    sampleRow
      .split('|')
      .map((c) => c.trim())[3],
    'UNIFIED for sales',
  );
  assert.ok(
    !sampleRow
      .split('|')
      .map((c) => c.trim())[3]
      .startsWith('PARTIAL'),
  );

  // 9. Invariant file order (INV-GUARD-PRESENCE-PINS): THIS spec is
  // the single owner of the order assertion. Every other guard spec
  // pins its own entry by presence exactly once, never by last
  // line, so a later append cannot turn every earlier guard red
  // (GAP-5: red-by-construction masked real failures). Order is
  // append-only: every `- INV-` id is unique, and the newest entry
  // is the file's last `- INV-` line. A package that appends a new
  // entry updates the expected tail id below, in that same package.
  const invariantIds = invariants.split('\n')
    .filter((line) => line.startsWith('- INV-'))
    .map((line) => line.split(' ')[1]);
  assert.ok(invariantIds.length > 0, 'the invariants file must list INV- entries');
  assert.equal(new Set(invariantIds).size, invariantIds.length, 'invariant ids must be unique: no duplicated entry');
  assert.equal(invariantIds[invariantIds.length - 1], 'INV-POS-SCANNER-BUFFER-NO-CLOBBER', 'the newest invariant entry must be the last INV- line');

  console.log('architecture guard checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
