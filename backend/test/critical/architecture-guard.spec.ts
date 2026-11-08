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
 * the canonical rounder (§7 money-path toFixed(2) ban, §10 private
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

  // 7. Money-path files never format money with toFixed(2). All money
  // math in these files goes through roundMoney at book digits (or a
  // digits-parameterised toFixed(digits) in the two rounder helpers).
  // Files with a live, dispositioned toFixed(2) are NOT on this list:
  // loyalty-points balances (sales-write, returns, partners — points,
  // not money), report aggregates (import-sales command center, HR loan
  // reports), message formatting, document XML, and the remaining
  // import-sales.service.ts non-posting math named in the map's money
  // row. Adding a file to this list is how a cleaned file is locked.
  const moneyPathFiles = [
    'backend/src/modules/accounting/accounting-posting.service.ts',
    'backend/src/modules/accounting/accounting.service.ts',
    'backend/src/modules/accounting/services/balance-sheet.service.ts',
    'backend/src/modules/accounting/services/cash-flow.service.ts',
    'backend/src/modules/accounting/services/fiscal-year.service.ts',
    'backend/src/modules/accounting/services/ar-collections.service.ts',
    'backend/src/modules/accounting/services/withholding-tax.service.ts',
    'backend/src/modules/accounting/services/aged-debts.service.ts',
    'backend/src/modules/accounting/engines/trial-balance.engine.ts',
    'backend/src/modules/cash-drawer/cash-drawer.service.ts',
    'backend/src/modules/reports/services/daily-commercial-rollup.service.ts',
    'backend/src/modules/purchases/services/margin-protection.service.ts',
    'backend/src/modules/tax-integration/services/vat-declaration/vat-declaration.service.ts',
    'backend/src/modules/reports/helpers/reports-math.helper.ts',
    'backend/src/modules/purchases/engines/landed-cost-allocation.engine.ts',
    'backend/src/modules/purchases/engines/landed-cost-wac.engine.ts',
    'backend/src/modules/purchases/services/purchase-landed-costs.service.ts',
    'backend/src/modules/purchases/services/purchases-write.service.ts',
    'backend/src/modules/import-sales/import-inventory-cost.engine.ts',
    'backend/src/modules/accounting/engines/inventory-valuation.engine.ts',
    'backend/src/modules/accounting/inventory-valuation.ts',
    'backend/src/modules/sales/engines/subscription-billing.engine.ts',
    'backend/src/modules/sales/services/commercial-subscription.service.ts',
    'backend/src/modules/maritime-freight/maritime-freight.service.ts',
    'backend/src/modules/accounting/fx-rate-resolution.ts',
    'backend/src/modules/accounting/exchange-rate-history.ts',
    'backend/src/modules/accounting/engines/fx-conversion.engine.ts',
    'backend/src/modules/accounting/engines/forex-difference.engine.ts',
    'backend/src/modules/hr/engines/payroll-calculation.engine.ts',
    'backend/src/modules/hr/engines/eos-calculation.engine.ts',
  ];
  for (const file of moneyPathFiles) {
    const stripped = stripComments(readFile(file));
    assert.ok(!stripped.includes('toFixed(2)'), `${file} must not format money with toFixed(2)`);
  }

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
  assert.equal(invariantIds[invariantIds.length - 1], 'INV-MAINT-STATUS-VALIDATION', 'the newest invariant entry must be the last INV- line');

  console.log('architecture guard checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
