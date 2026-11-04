/*
 * INV-ENGINE-MAP-GUARD: architecture guard spec.
 *
 * This spec guards the engine map (docs/ENGINE_MAP.md). It pins only
 * rules that are already closed, so it is green on the current HEAD
 * and fails on any regression or any NEW violation of the same kind.
 * The single known open exception (marketplace simulation pool-handle
 * stock call) is allowlisted by file with a maximum count of one, so a
 * second pool-handle call anywhere fails the spec; zero matches is
 * also green, because closing that exception (F3.2) must not break
 * this guard.
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

  // 4. No stock-ledger call on the pool handle except the allowlisted one.
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
  assert.ok(
    matches.length <= 1,
    'at most one pool-handle stock call is allowed (marketplace simulation); a second one anywhere is a regression',
  );
  for (const match of matches) {
    assert.equal(
      match,
      'backend/src/modules/storefront/services/marketplace-sync.service.ts',
      'the only allowed pool-handle stock call is the marketplace simulation exception',
    );
  }

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

  // 7. Posting service never formats money with toFixed(2).
  const posting = stripComments(readFile('backend/src/modules/accounting/accounting-posting.service.ts'));
  assert.ok(!posting.includes('toFixed(2)'), 'posting math must go through roundMoney at book digits');

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
  ]) {
    assert.ok(invariants.includes(id), `invariant ${id} must stay recorded`);
  }

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
  assert.equal(invariantIds[invariantIds.length - 1], 'INV-MARITIME-PORTAL-REJECTED-QUOTE-GUARD', 'the newest invariant entry must be the last INV- line');

  console.log('architecture guard checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
