/*
 * INV-MODULE-DOORS: module-doors completeness spec.
 *
 * This spec pins docs/MODULE_DOORS.md: a door entry must exist for
 * every backend module (37) and every frontend feature (40) that
 * exists on disk, the missing-index list must match disk exactly, and
 * the document must state the pinned P0-1 coupling counts so it
 * cannot silently drift from the ratchet baseline. Adding a module or
 * a feature without documenting its door fails this spec on purpose.
 *
 * Fail-first: the heading matcher is self-checked against a sample
 * document below (present heading found, absent heading not found).
 * INV-MODULE-DOORS-REVIEW-CLEANUP (2026-11-18): the 8 helper/util files
 * once flagged REVIEW are resolved — 7 are confirmed public doors
 * (docs/MODULE_DOORS.md section 4 records the per-door reason) and the
 * 8th (the sales discount-filter helper) was retired by Phase 1 B1,
 * which moved it to the shared layer (src/common/utils), so it is no
 * longer a cross-module door — so this spec also asserts the document
 * contains no REVIEW flag at all and names each of the 7 resolved
 * files as a confirmed public door.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const BACKEND_MODULES = path.join(REPO_ROOT, 'backend', 'src', 'modules');
const FRONTEND_FEATURES = path.join(REPO_ROOT, 'frontend', 'src', 'features');

function listDirs(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
    .sort();
}

function headings(doc: string, prefix: string): string[] {
  return doc
    .split('\n')
    .filter((line) => line.startsWith(`### ${prefix}/`))
    .map((line) => line.slice(`### ${prefix}/`.length).trim());
}

async function main(): Promise<void> {
  // 0. Matcher self-check.
  const sample = '## 1. Backend doors (37)\n\n### backend/sales\n\n- Nest module: `x`\n\n### backend/accounting\n';
  assert.deepEqual(headings(sample, 'backend'), ['sales', 'accounting'], 'heading matcher must find backend headings');
  assert.deepEqual(
    headings(sample, 'frontend'),
    [],
    'heading matcher must not find frontend headings in a backend sample',
  );

  assert.ok(fs.existsSync(DOC_PATH), 'docs/MODULE_DOORS.md must exist');
  const doc = fs.readFileSync(DOC_PATH, 'utf8');
  assert.ok(doc.length > 1000, 'docs/MODULE_DOORS.md must not be a stub');

  // 1. Every backend module on disk has exactly one door heading.
  const backendModules = listDirs(BACKEND_MODULES);
  assert.equal(
    backendModules.length,
    37,
    'backend must have 37 modules (re-pin this spec + the doc if a module is added or removed)',
  );
  const backendHeadings = headings(doc, 'backend');
  assert.equal(new Set(backendHeadings).size, backendHeadings.length, 'backend door headings must be unique');
  for (const mod of backendModules) {
    assert.ok(backendHeadings.includes(mod), `docs/MODULE_DOORS.md is missing the door for backend module ${mod}`);
    const nestModule = path.join(BACKEND_MODULES, mod, `${mod}.module.ts`);
    assert.ok(fs.existsSync(nestModule), `Nest module file must exist: backend/src/modules/${mod}/${mod}.module.ts`);
    assert.ok(
      doc.includes(`backend/src/modules/${mod}/${mod}.module.ts`),
      `docs/MODULE_DOORS.md must name the Nest module file for ${mod}`,
    );
  }

  // 2. Every frontend feature on disk has exactly one door heading.
  const frontendFeatures = listDirs(FRONTEND_FEATURES);
  assert.equal(
    frontendFeatures.length,
    40,
    'frontend must have 40 features (re-pin this spec + the doc if a feature is added or removed)',
  );
  const frontendHeadings = headings(doc, 'frontend');
  assert.equal(new Set(frontendHeadings).size, frontendHeadings.length, 'frontend door headings must be unique');
  for (const feat of frontendFeatures) {
    assert.ok(frontendHeadings.includes(feat), `docs/MODULE_DOORS.md is missing the door for frontend feature ${feat}`);
  }

  // 3. The missing-index list matches disk exactly.
  const missingOnDisk = frontendFeatures.filter(
    (feat) =>
      !fs.existsSync(path.join(FRONTEND_FEATURES, feat, 'index.ts')) &&
      !fs.existsSync(path.join(FRONTEND_FEATURES, feat, 'index.tsx')),
  );
  assert.equal(
    missingOnDisk.length,
    0,
    '0 frontend features must lack a public index.ts (re-pin if a feature gains one)',
  );
  for (const feat of missingOnDisk) {
    assert.ok(doc.includes(`- \`${feat}\``), `docs/MODULE_DOORS.md must list ${feat} as missing a public index.ts`);
  }
  for (const feat of frontendFeatures) {
    if (!missingOnDisk.includes(feat)) {
      assert.ok(
        !doc.includes(`- \`${feat}\`\n`),
        `docs/MODULE_DOORS.md must not list ${feat} as missing a public index.ts: it has one on disk`,
      );
    }
  }

  // 4. The doc states the pinned P0-1 coupling counts.
  assert.ok(
    doc.includes('71 edges / 652 statements'),
    'docs/MODULE_DOORS.md must state the pinned backend coupling (71 edges / 652 statements)',
  );
  assert.ok(
    doc.includes('57 edges / 133 statements'),
    'docs/MODULE_DOORS.md must state the pinned frontend coupling (57 edges / 133 statements)',
  );
  assert.ok(
    doc.includes('79 external imports into `accounting-posting.service`'),
    'docs/MODULE_DOORS.md must state the pinned posting-service cap',
  );
  assert.ok(
    doc.includes('15 into `accounting-tenant-foundation.service`'),
    'docs/MODULE_DOORS.md must state the pinned foundation-service cap',
  );

  // 5. No REVIEW flag remains: the 6 remaining Phase 1 doors are resolved, each
  // recorded as a confirmed public door in section 4 of the document
  // (the 8th door, the sales discount-filter helper, was retired by
  // Phase 1 B1, which moved it to src/common/utils; the 7th door, the
  // purchases write helper, was retired by Phase 1 B6, which moved its
  // one cross-module function to src/common/utils).
  assert.ok(
    !doc.includes('REVIEW'),
    'docs/MODULE_DOORS.md must not contain any REVIEW flag: all 8 Phase 1 doors are resolved',
  );
  assert.ok(
    doc.includes('## 4. Phase 1 door resolution'),
    'docs/MODULE_DOORS.md must record the Phase 1 door resolution',
  );
  const resolvedDoors = [
    'backend/src/modules/cash-drawer/helpers/cash-drawer.helper',
    'backend/src/modules/import-sales/helpers/import-lot-allocation.helper',
    'backend/src/modules/inventory/helpers/inventory-tracked-stock.helper',
    'backend/src/modules/reports/helpers/reports-range.helper',
    'backend/src/modules/sales/helpers/restaurant-modifier-contract.helper',
    'backend/src/modules/sales/helpers/sales-write.helper',
  ];
  for (const door of resolvedDoors) {
    assert.ok(doc.includes(door), `docs/MODULE_DOORS.md must list the resolved public door ${door}`);
  }

  console.log(
    `module doors checks passed (${backendModules.length} backend doors, ${frontendFeatures.length} frontend doors, ${missingOnDisk.length} features missing index.ts)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
