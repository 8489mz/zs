/*
 * Phase 1 B2 — sales|settings circular pair broken (INV-PHASE1-B2-SALES-SETTINGS-DECOUPLED).
 *
 * The pair was sales->settings 4 + settings->sales 1 (grounding Pair 7):
 * - sales->settings: sales.module.ts imports SettingsModule; cashier-fraud-radar,
 *   create-sale-types and sales-write import WhatsAppGatewayService from the
 *   settings whatsapp-gateway service (the WhatsApp send path used by 3 sale paths).
 * - settings->sales: settings-cache.ts imported SalesWriteService from the sales
 *   write service and called its static `invalidateSettingsCache(tenantId)` —
 *   settings invalidating a cache owned by sales.
 *
 * The break moves the cache STORE to the shared layer
 * (backend/src/common/utils/tenant-settings-map-cache.ts): the Map plus the one
 * `invalidateTenantSettingsMapCache(tenantId?)` function. sales-write.service.ts
 * reads the shared map in getTenantSettingsMap (unchanged otherwise) and its
 * public static `invalidateSettingsCache` becomes a one-line delegation to the
 * shared invalidator. The static method MUST stay: 50 critical specs call it as
 * their test-isolation reset for the sales settings-map cache — removing it
 * would break 50 specs; the delegation preserves the API and the behavior
 * exactly (same map, same delete/clear). settings-cache.ts drops the
 * SalesWriteService import and calls the shared invalidator directly. The
 * sales->settings leg STAYS: the dependency is one-way now, not a cycle.
 * MOVE, never duplicate: the single-store property is preserved by the move,
 * not by a second cache.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: settings->sales 1 -> 0 (edge gone), sales->settings stays 4;
 *   backend total 760 -> 759; backend edges 71 -> 70; the sales|settings pair
 *   leaves the bidirectional list.
 * - module-doors: the sales-write.service door row (1 statement, from settings)
 *   is RETIRED — the file is no longer imported by settings:
 *   docs/MODULE_DOORS.md drops its line (sales door table 13 -> 12 files).
 *   The doors SPEC needs no change (it asserts headings, the missing-index
 *   list, the pinned P0-1 prose, no REVIEW flag, and the 7 resolved §4 doors).
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   the F5a spec last.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SettingsCache } from '../../src/modules/settings/settings/settings-cache';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_CACHE = path.join(BACKEND, 'src', 'common', 'utils', 'tenant-settings-map-cache.ts');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');

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
      if (c === "'" || c === '"' || c === '`') {
        state = c;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && nxt === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (c === '\n') out += c;
      i += 1;
    } else {
      out += c;
      if (c === '\\') {
        if (i + 1 < n) {
          out += source[i + 1];
          i += 2;
          continue;
        }
      } else if (c === state) {
        state = 'code';
      }
      i += 1;
    }
  }
  return out;
}

function specifiers(source: string): string[] {
  const clean = stripComments(source);
  const found: string[] = [];
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(clean)) !== null) found.push(m[1]);
  return found;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTs(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function resolvesUnderModule(spec: string, fromFile: string, module: string): boolean {
  if (!spec.startsWith('.')) return false;
  const rel = path.relative(REPO_ROOT, fromFile).split(path.sep).join('/');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
  return target.startsWith(`backend/src/modules/${module}/`);
}

async function main(): Promise<void> {
  // 1. The shared home exists and exports the map + the invalidator.
  // The import path is a variable (not a literal) so the spec still
  // compiles on the base, where the file does not exist yet: RED-1
  // then fails on the structural blocks below (the circular import
  // still exists), not at load time.
  assert.ok(fs.existsSync(SHARED_CACHE), 'the tenant settings-map cache must live in src/common/utils');
  const cachePath = '../../src/common/utils/tenant-settings-map-cache';
  const shared = await import(cachePath);
  assert.equal(
    typeof shared.invalidateTenantSettingsMapCache,
    'function',
    'shared cache must export invalidateTenantSettingsMapCache',
  );
  assert.ok(shared.tenantSettingsMapCache instanceof Map, 'shared cache must export the tenant settings map');

  // 2. No settings source file imports from the sales module any more (the broken leg).
  const settingsFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'settings'));
  const settingsToSales: string[] = [];
  for (const file of settingsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'sales')) {
        settingsToSales.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
        break;
      }
    }
  }
  assert.deepEqual(settingsToSales, [], 'no settings source file may import from the sales module');

  // 3. The remaining leg is exactly the 4 sales->settings files (one-way, not a cycle).
  const salesFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'sales'));
  const salesToSettings: string[] = [];
  for (const file of salesFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'settings')) {
        salesToSettings.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
        break;
      }
    }
  }
  assert.deepEqual(
    salesToSettings.sort(),
    [
      'backend/src/modules/sales/sales.module.ts',
      'backend/src/modules/sales/services/cashier-fraud-radar.service.ts',
      'backend/src/modules/sales/services/create-sale/create-sale-types.ts',
      'backend/src/modules/sales/services/sales-write.service.ts',
    ].sort(),
    'the only sales->settings imports must be the module DI + the 3 WhatsApp gateway users',
  );

  // 4. The boundary pins record the break. (Pin-table forms only,
  // scoped to the BACKEND table: the frontend table still pins its own
  // sales|settings-adjacent edges, and the header prose still narrates
  // the pair and its B2 reversal.)
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  assert.ok(!backendTable.includes("'settings->sales':"), 'module-boundary must no longer pin a settings->sales edge');
  assert.ok(!backendPairs.includes("'sales|settings',"), 'module-boundary must no longer list the sales|settings pair');
  assert.ok(
    backendTable.includes("'sales->settings': 4,"),
    'module-boundary must keep sales->settings pinned at 4 (the staying leg)',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must re-pin the backend total 746 -> 738',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must re-pin the backend edge table 64 -> 63 edges',
  );

  // 5. Invalidation still works through both doors (behavioral proof:
  // the same shared map, the same delete/clear, whichever door calls it).
  const map = shared.tenantSettingsMapCache as Map<string, { map: Map<string, unknown>; expiresAt: number }>;
  const TENANT = 'b2-tenant';
  const OTHER = 'b2-other';
  const entry = (): { map: Map<string, unknown>; expiresAt: number } => ({
    map: new Map([['k', 1]]),
    expiresAt: Date.now() + 60_000,
  });
  // 5a. The settings door clears the shared map (scoped) and its own cache.
  map.set(TENANT, entry());
  map.set(OTHER, entry());
  const cache = new SettingsCache();
  cache.remember(cache._settingsCache, `${TENANT}:k`, { v: 1 });
  cache.invalidateSettingsCache(TENANT);
  assert.ok(!map.has(TENANT), 'SettingsCache.invalidateSettingsCache must clear the tenant entry from the shared map');
  assert.ok(map.has(OTHER), 'scoped invalidation must leave other tenants alone');
  assert.ok(
    ![...cache._settingsCache.keys()].some((k) => k.startsWith(`${TENANT}:`)),
    'SettingsCache.invalidateSettingsCache must also clear its own settings cache',
  );
  // 5b. The sales static door still clears the shared map (the 50-spec API).
  map.set(TENANT, entry());
  SalesWriteService.invalidateSettingsCache(TENANT);
  assert.ok(!map.has(TENANT), 'SalesWriteService.invalidateSettingsCache must clear the tenant entry');
  assert.ok(map.has(OTHER), 'the sales static door must leave other tenants alone');
  // 5c. No-arg clears everything.
  SalesWriteService.invalidateSettingsCache();
  assert.equal(map.size, 0, 'no-arg invalidation must clear the whole shared map');

  // 6. Wiring: both critical lists carry 375 specs in identical order,
  // the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(path.join(BACKEND, 'scripts', 'critical-specs.json'), 'utf8'));
  const specs: string[] = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const chain: string[] = (pkg.scripts['test:critical:serial'] as string)
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 393);
  assert.equal(chain.length, 393);
  assert.deepEqual(chain, specs, 'critical lists must agree in identical order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5k-pos-products.spec.ts');
  assert.ok(specs.includes('test/critical/phase1-b2-sales-settings.spec.ts'));

  console.log('phase1 B2 sales|settings decoupling checks passed (375 specs wired, pair gone, invalidation identical)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
