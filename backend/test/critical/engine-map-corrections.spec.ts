/*
 * M0 engine-map corrections (Phase 0 plan §3), refreshed by G7 (U7) to
 * the verified states at HEAD 30a84e93: docs/ENGINE_MAP.md must carry
 * the corrections below, and the stale statements they replace must
 * be gone.
 *
 * What G7 changed and why (U1–U4 closed the M0-era gaps, so the
 * original FX / tax / cost pins are superseded, not merely reworded):
 * 1. FX: the rate-history table exists (migration 0270) with an as-of
 *    reader (exchangeRateAsOf) — and a production consumer IS wired
 *    now (INV-FX-RATE-HISTORY-CONSUMER). The old "no production
 *    consumer is wired yet" pin is inverted to an absence check.
 * 2. Idempotency: the interceptor covers 4 controllers, not 5.
 *    Unchanged.
 * 3. Tax: the named live sites are closed — every rate resolves
 *    through resolveSaleTaxRate (INV-SUBSCRIPTION-TAX-RATE-SOURCE,
 *    INV-MARITIME-FREIGHT-TAX). The old DTO-source pin and the
 *    :1855/:2143/:6088 line numbers are superseded (the sites moved
 *    to :1893/:2186/:6141 by drift, and the DTO is no longer a source).
 * 4. Cost: the four landed-cost paths are named — and now route
 *    through the single allocation path (INV-IMPORT-LANDED-COST-CANONICAL).
 *    The old "still four paths" pin is inverted to an absence check.
 * 5. Document numbers: the remaining gap is the missing unique index
 *    on numbered columns (migration 0155 has none on doc_no).
 *    Unchanged (R6 in U6 owns the fix).
 * 6. Business date: the row links to the §1.8 inventory in the
 *    phase-0 grounding plan, with the live file count (53, not 51).
 *    Unchanged (R3a–R3c in U5 own the fix).
 *
 * Style follows backend/test/critical/codebase-map.spec.ts: plain
 * node:assert checks run by ts-node, no test runner. The spec reads
 * the map file on disk only; it imports no production code and needs
 * no database. Run: npx ts-node test/critical/engine-map-corrections.spec.ts
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function main(): Promise<void> {
  const mapPath = path.join(REPO_ROOT, 'docs/ENGINE_MAP.md');
  assert.ok(fs.existsSync(mapPath), 'docs/ENGINE_MAP.md must exist');
  const map = fs.readFileSync(mapPath, 'utf8');

  function present(text: string, label: string): void {
    assert.ok(map.includes(text), `engine map must state: ${label}`);
  }

  function absent(text: string, label: string): void {
    assert.ok(!map.includes(text), `engine map must not still state: ${label}`);
  }

  // 1. FX — rate-history table + as-of reader exist, and a production
  // consumer IS wired now (G7: the M0 "no consumer yet" pin is inverted).
  present('migration 0270', 'FX rate-history migration 0270');
  present('exchangeRateAsOf', 'FX as-of reader exchangeRateAsOf');
  present('currency_exchange_rate_history', 'FX rate-history table name');
  present('INV-FX-RATE-HISTORY-CONSUMER', 'FX first production consumer');
  absent('no production consumer is wired yet', 'superseded FX claim "no production consumer is wired yet"');
  absent('no rate-history table', 'stale FX claim "no rate-history table"');

  // 2. Idempotency — 4 controllers, not 5.
  present('covers 4 controllers', 'idempotency interceptor covers 4 controllers');
  present('sales, returns, services, inventory', 'the four covered controllers by name');
  present('NOT covered by the interceptor', 'purchases is not interceptor-covered');
  absent('covers 5 controllers', 'stale idempotency claim "covers 5 controllers"');

  // 3. Tax — every rate resolves through resolveSaleTaxRate (G7: the
  // M0 DTO-source pin is superseded by the U1 closures).
  present('resolveSaleTaxRate', 'tax rates resolve through resolveSaleTaxRate');
  present('commercial-subscription.service.ts', 'subscription billing rate source file');
  present('maritime-freight.service.ts', 'maritime freight tax file');
  present('INV-SUBSCRIPTION-TAX-RATE-SOURCE', 'subscription tax-rate source invariant');
  present('INV-MARITIME-FREIGHT-TAX', 'maritime freight tax invariant');
  absent(
    'takes its rate from the client DTO',
    'superseded tax claim "takes its rate from the client DTO"',
  );
  absent(
    'subscription billing and maritime charge tax still compute inline',
    'stale unnamed tax summary',
  );

  // 4. Cost — the four landed-cost paths by name, now routed through
  // the single allocation path (G7: the M0 "still four paths" pin is
  // inverted).
  present('purchase-landed-costs.service.ts', 'cost path (1) purchases official');
  present('import-landed-cost.engine.ts', 'cost path (2) import landed cost');
  present('import-inventory-cost.engine.ts', 'cost path (3) import inventory cost');
  present('import-broker-capitalization.engine.ts', 'cost path (4) broker capitalization');
  present('classification only, not allocation', 'broker engine is classification only');
  present('import-lot-allocation.helper.ts', 'landed-cost consumer import-lot-allocation');
  present('returns-write.helper.ts', 'related returns-write landed-cost note');
  present('INV-IMPORT-LANDED-COST-CANONICAL', 'single landed-cost allocation invariant');
  absent('still four paths, not one engine', 'superseded cost claim "still four paths"');

  // 5. Document numbers — remaining unique-index gap.
  present('migration 0155', 'document-number migration 0155');
  present('no unique index on numbered columns', 'remaining unique-index gap');
  present('uq_rep_target_month', 'migration 0155 only unique constraint');

  // 6. Business date — link to the §1.8 inventory with the live count.
  present('phase-0-grounding-inventory.md', 'business-date link to the phase-0 inventory');
  present('§1.8', 'business-date link to §1.8');
  present('53 files', 'live UTC-slice file count at HEAD 30a84e93');
  absent('51 files', 'stale business-date count "51 files"');

  console.log('engine map corrections checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
