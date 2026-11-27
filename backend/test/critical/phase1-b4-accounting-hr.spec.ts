import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { allocatePayrollAccrual } from '../../src/common/utils/payroll-accrual-allocation.engine';
import { calculateSettlementAbsorption } from '../../src/common/utils/eos-calculation.engine';

/*
 * Phase 1 B4 — accounting|hr circular pair broken (INV-PHASE1-B4-ACCOUNTING-HR-DECOUPLED).
 *
 * The pair was accounting->hr 2 + hr->accounting 29 (grounding Pair 1):
 * - accounting->hr: the accounting payroll-posting service imported two
 *   HR-domain pure engines — `allocatePayrollAccrual` (payroll accrual
 *   allocation) and `calculateSettlementAbsorption` (EOS absorption) —
 *   from hr/engines.
 * - hr->accounting: the mirror hr payroll-posting service imports
 *   AccountingPostingService; 20x money-minor-units.engine across
 *   hr/engines + hr/services; hr.module imports AccountingModule;
 *   hr.service imports AccountingPostingService; end-of-service imports
 *   AccountingService + the accounting date engine. That direction is
 *   the load-bearing money spine and is NOT touched.
 *
 * The break moves the WHOLE two engine files to the shared layer
 * (backend/src/common/utils/payroll-accrual-allocation.engine.ts and
 * backend/src/common/utils/eos-calculation.engine.ts). Each engine has
 * exactly one import (roundMoney / MoneyDigits / toMinorUnits /
 * fromMinorUnits from accounting's money-minor-units.engine), re-pointed
 * from `../../accounting/...` to `../../modules/accounting/...`; every
 * export, signature and body is otherwise byte-identical — the money
 * math does not change at all. MOVE, never duplicate: each engine exists
 * in exactly one place after this package.
 *
 * Why the move and not the caller inversion: the brief's first option
 * (have the HR caller compute allocation/absorption and pass the results
 * in) does not cover every caller — accounting-recovery.service.ts
 * replays both postings from the accounting side and would also have to
 * supply the allocation, but it cannot import the hr engines without
 * re-creating the edge, and there is no posted journal to read the
 * numbers back from (recovery exists precisely because the posting never
 * happened). The shared port is the only break that covers all callers.
 * Precedent for common->accounting imports already exists in the tree:
 * stock-movement-writer.ts imports roundMoney from
 * ../../modules/accounting/engines/money-minor-units.engine. The
 * module-boundary method states it explicitly: "`src/common`,
 * `src/shared` and intra-module imports are not edges" — so the moved
 * engines' own accounting imports create NO new edge.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: accounting->hr 2 -> 0 (edge gone),
 *   hr->accounting stays 29; backend total 758 -> 756; backend edges
 *   69 -> 68; the accounting|hr pair leaves the bidirectional list.
 * - module-doors: both engine door rows are RETIRED — the files no
 *   longer live in a module: docs/MODULE_DOORS.md drops their lines
 *   (hr door table 2 -> 0 files; intended door is the Nest module file
 *   only). The doors SPEC needs no change (it asserts headings, the
 *   missing-index list, the pinned P0-1 prose, no REVIEW flag, and the
 *   7 resolved §4 doors — neither engine is one of those).
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   the F5a spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_ALLOC = path.join(BACKEND, 'src', 'common', 'utils', 'payroll-accrual-allocation.engine.ts');
const SHARED_EOS = path.join(BACKEND, 'src', 'common', 'utils', 'eos-calculation.engine.ts');
const OLD_ALLOC = path.join(BACKEND, 'src', 'modules', 'hr', 'engines', 'payroll-accrual-allocation.engine.ts');
const OLD_EOS = path.join(BACKEND, 'src', 'modules', 'hr', 'engines', 'eos-calculation.engine.ts');
const POSTING_SERVICE = path.join(BACKEND, 'src', 'modules', 'accounting', 'services', 'hr-payroll-posting.service.ts');
const EOS_SERVICE = path.join(BACKEND, 'src', 'modules', 'hr', 'services', 'end-of-service.service.ts');
const HR_SERVICE = path.join(BACKEND, 'src', 'modules', 'hr', 'hr.service.ts');
const HR_POSTING_SERVICE = path.join(BACKEND, 'src', 'modules', 'hr', 'services', 'hr-payroll-posting.service.ts');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const DOORS_DOC = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  while (i < n) {
    const c = source[i];
    const nxt = i + 1 < n ? source[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && nxt === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && nxt === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = "'";
      else if (c === '"') state = '"';
      else if (c === '`') state = '`';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && nxt === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c;
      if (i + 1 < n) out += source[i + 1];
      i += 2;
      continue;
    }
    if ((state === "'" && c === "'") || (state === '"' && c === '"') || (state === '`' && c === '`')) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

async function main(): Promise<void> {
  // 1. The shared engines exist; the old hr homes are gone.
  assert.ok(fs.existsSync(SHARED_ALLOC), 'shared payroll-accrual-allocation engine must exist');
  assert.ok(fs.existsSync(SHARED_EOS), 'shared eos-calculation engine must exist');
  assert.ok(!fs.existsSync(OLD_ALLOC), 'the old hr payroll-accrual-allocation engine must be gone');
  assert.ok(!fs.existsSync(OLD_EOS), 'the old hr eos-calculation engine must be gone');

  // 2. The accounting posting service imports both engines from shared, never from hr.
  const posting = stripComments(fs.readFileSync(POSTING_SERVICE, 'utf8'));
  assert.ok(
    posting.includes("'../../../common/utils/payroll-accrual-allocation.engine'"),
    'accounting posting service must import allocatePayrollAccrual from shared',
  );
  assert.ok(
    posting.includes("'../../../common/utils/eos-calculation.engine'"),
    'accounting posting service must import calculateSettlementAbsorption from shared',
  );
  assert.ok(
    !posting.includes("'../../hr/engines/payroll-accrual-allocation.engine'"),
    'accounting posting service must no longer import the allocation engine from hr',
  );
  assert.ok(
    !posting.includes("'../../hr/engines/eos-calculation.engine'"),
    'accounting posting service must no longer import the EOS engine from hr',
  );
  const eosService = stripComments(fs.readFileSync(EOS_SERVICE, 'utf8'));
  assert.ok(
    eosService.includes("'../../../common/utils/eos-calculation.engine'"),
    'hr end-of-service service must import the EOS engine from shared',
  );
  assert.ok(
    !eosService.includes("'../engines/eos-calculation.engine'"),
    'hr end-of-service service must no longer import the EOS engine from hr/engines',
  );

  // 3. The engines compute identically from the new home (exact numbers, run
  // from the real engines before the move — money is strict, no leniency).
  const allocation = allocatePayrollAccrual(
    {
      grossPay: 10000,
      netPay: 8700,
      loanDeductions: 500,
      assetRecoveryDeductions: 100,
      operationalDeductions: 700,
      employeeInsurance: 300,
      employerInsurance: 200,
      incomeTax: 100,
    },
    2,
  );
  assert.deepEqual(
    [allocation.salaryExpense, allocation.wageReduction, allocation.assetRecoveryCredit],
    [9700, 300, 100],
  );
  assert.deepEqual([allocation.totalDebit, allocation.totalCredit], [9900, 9900]);
  assert.equal(allocation.netPayable, 8700);
  assert.throws(
    () =>
      allocatePayrollAccrual(
        {
          grossPay: 100,
          netPay: 99,
          loanDeductions: 5,
          assetRecoveryDeductions: 0,
          operationalDeductions: 0,
          employeeInsurance: 0,
          employerInsurance: 0,
          incomeTax: 0,
        },
        2,
      ),
    RangeError,
    'the moved allocation engine must still refuse unreconciled totals',
  );
  const absorption = calculateSettlementAbsorption({
    gratuityAmount: 5000,
    leaveEncashmentAmount: 1000,
    pendingSalaryAmount: 2000,
    noticePeriodAmount: 0,
    otherEntitlementsAmount: 500,
    unpaidLoansDeduction: 1500,
    assetsDeduction: 800,
    otherDeductions: 200,
    minorUnits: 2,
  });
  assert.deepEqual(
    [absorption.totalEntitlements, absorption.appliedAssets, absorption.appliedOther, absorption.appliedLoans],
    [8500, 800, 200, 1500],
  );
  assert.deepEqual([absorption.unabsorbedLoans, absorption.unabsorbedAssets, absorption.unabsorbedOther], [0, 0, 0]);
  assert.deepEqual([absorption.totalDeductions, absorption.netPayable], [2500, 6000]);

  // 4. The accounting posting service still routes through both engines.
  assert.ok(posting.includes('allocatePayrollAccrual('), 'payroll accrual must route through the engine');
  assert.ok(
    posting.includes('calculateSettlementAbsorption('),
    'EOS settlement must route absorption through the canonical engine',
  );

  // 5. The hr->accounting spine is intact — the load-bearing direction is untouched.
  const hrService = stripComments(fs.readFileSync(HR_SERVICE, 'utf8'));
  assert.ok(hrService.includes('AccountingPostingService'), 'hr.service must still use AccountingPostingService');
  const hrPosting = stripComments(fs.readFileSync(HR_POSTING_SERVICE, 'utf8'));
  assert.ok(
    hrPosting.includes("'../../accounting/accounting-posting.service'"),
    'hr payroll-posting service must still import AccountingPostingService',
  );
  assert.ok(
    eosService.includes("'../../accounting/engines/money-minor-units.engine'"),
    'hr end-of-service service must still import the accounting money engine',
  );
  assert.ok(
    eosService.includes("'../../accounting/engines/accounting-date.engine'"),
    'hr end-of-service service must still import the accounting date engine',
  );
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes("'hr->accounting': 29,"),
    'module-boundary must keep hr->accounting pinned at 29 (the staying leg)',
  );

  // 6. The boundary pins record the break. (Pin-table forms only, scoped
  // to the BACKEND table.)
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  assert.ok(!backendTable.includes("'accounting->hr':"), 'module-boundary must no longer pin an accounting->hr edge');
  assert.ok(!backendPairs.includes("'accounting|hr',"), 'module-boundary must no longer list the accounting|hr pair');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary backend total is now 746 (B4 pinned 756; B5 re-pins 756 -> 752; B6 re-pins 752 -> 750; B7 re-pins 750 -> 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 64 (B4 pinned 68; B5 re-pins 68 -> 66; B6 re-pins 66 -> 65; B7 re-pins 65 -> 64; B8 re-pins 64 -> 63)',
  );

  // 7. The doors doc retires both engine door rows.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  assert.ok(!doors.includes('eos-calculation.engine'), 'MODULE_DOORS.md must no longer list the eos-calculation door');
  assert.ok(
    !doors.includes('payroll-accrual-allocation.engine'),
    'MODULE_DOORS.md must no longer list the payroll-accrual-allocation door',
  );
  assert.ok(
    doors.includes('Intended door: the Nest module file only (`hr.module.ts`).'),
    'MODULE_DOORS.md hr door must now be the Nest module file only',
  );

  // 8. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B4-ACCOUNTING-HR-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B4 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F5G-CUSTOMERS-SALES-DECOUPLED/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the B7 INV exactly once');

  // 9. The B1/B2/B3 specs re-pin their boundary assertions to the B4 numbers.
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('const PINNED_BACKEND_TOTAL = 738;'),
      `${label} spec must re-pin the backend total 746 -> 738`,
    );
    assert.ok(
      src.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      `${label} spec must re-pin the backend edge table 64 -> 63 edges`,
    );
  }

  // 10. Wiring: both critical lists carry 375 specs in identical order, the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 387);
  assert.equal(chain.length, 387);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 375 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5g-customers-sales.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f5g-customers-sales.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 387);') && src.includes('assert.equal(chain.length, 387);'),
      `${label} spec wiring must re-pin to 375`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f5g-customers-sales.spec.ts'"),
      `${label} spec last-entry must re-pin to the B7 spec`,
    );
  }

  // 11. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the B4 spec. (The B3
  // brief named only the B1/B2/B3 specs; the live tree had 43 files
  // asserting the old count — the #264-fix / D12 lesson. The B4
  // filename is built by concatenation so this block's own source never
  // contains the literals it scans for.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b4Name = 'phase1-b4' + '-accounting-hr.spec.ts';
  const staleSpecs = 'specs.length, 37' + '3';
  const staleChain = 'chain.length, 37' + '3';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b4Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B4 spec');

  console.log('phase1 B4 accounting|hr decoupling checks passed (375 specs wired, pair gone, engines identical)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
