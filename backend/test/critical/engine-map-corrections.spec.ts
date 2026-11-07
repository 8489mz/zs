/*
 * M0 engine-map corrections (Phase 0 plan §3): docs/ENGINE_MAP.md must
 * carry the six corrections grounded live at HEAD 7f41e53, and the
 * stale statements they replace must be gone.
 *
 * 1. FX: the rate-history table exists (migration 0270) with an as-of
 *    reader (exchangeRateAsOf); no production consumer is wired yet.
 * 2. Idempotency: the interceptor covers 4 controllers, not 5.
 * 3. Tax: the named live sites replace the stale "5+ places" count —
 *    subscription billing takes its rate from the client DTO, and
 *    maritime charge tax is inline at three named line numbers.
 * 4. Cost: the four landed-cost paths are named, not just counted.
 * 5. Document numbers: the remaining gap is the missing unique index
 *    on numbered columns (migration 0155 has none on doc_no).
 * 6. Business date: the row links to the §1.8 inventory in the
 *    phase-0 grounding plan, with the live file count (53, not 51).
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

  // 1. FX — rate-history table + as-of reader exist.
  present('migration 0270', 'FX rate-history migration 0270');
  present('exchangeRateAsOf', 'FX as-of reader exchangeRateAsOf');
  present('currency_exchange_rate_history', 'FX rate-history table name');
  present('no production consumer is wired yet', 'FX: no production consumer wired yet');
  absent('no rate-history table', 'stale FX claim "no rate-history table"');

  // 2. Idempotency — 4 controllers, not 5.
  present('covers 4 controllers', 'idempotency interceptor covers 4 controllers');
  present('sales, returns, services, inventory', 'the four covered controllers by name');
  present('NOT covered by the interceptor', 'purchases is not interceptor-covered');
  absent('covers 5 controllers', 'stale idempotency claim "covers 5 controllers"');

  // 3. Tax — named live sites, not a stale count.
  present('commercial-subscription.service.ts', 'subscription billing rate source file');
  present('line.taxRate', 'subscription rate comes from the DTO line.taxRate');
  present('maritime-freight.service.ts', 'maritime freight tax file');
  present(':1855', 'maritime tax site :1855');
  present(':2143', 'maritime tax site :2143');
  present(':6088', 'maritime tax site :6088');
  absent(
    'subscription billing and maritime charge tax still compute inline',
    'stale unnamed tax summary',
  );

  // 4. Cost — the four landed-cost paths by name.
  present('purchase-landed-costs.service.ts', 'cost path (1) purchases official');
  present('import-landed-cost.engine.ts', 'cost path (2) import landed cost');
  present('import-inventory-cost.engine.ts', 'cost path (3) import inventory cost');
  present('import-broker-capitalization.engine.ts', 'cost path (4) broker capitalization');
  present('classification only, not allocation', 'broker engine is classification only');
  present('import-lot-allocation.helper.ts', 'landed-cost consumer import-lot-allocation');
  present('returns-write.helper.ts', 'related returns-write landed-cost note');

  // 5. Document numbers — remaining unique-index gap.
  present('migration 0155', 'document-number migration 0155');
  present('no unique index on numbered columns', 'remaining unique-index gap');
  present('uq_rep_target_month', 'migration 0155 only unique constraint');

  // 6. Business date — link to the §1.8 inventory with the live count.
  present('phase-0-grounding-inventory.md', 'business-date link to the phase-0 inventory');
  present('§1.8', 'business-date link to §1.8');
  present('53 files', 'live UTC-slice file count at HEAD 7f41e53');
  absent('51 files', 'stale business-date count "51 files"');

  console.log('engine map corrections checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
