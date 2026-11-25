/*
 * INV-BACKEND-LINT-PRETTIER-TOOLING: the backend lint + Prettier tooling
 * must exist and stay wired. This spec asserts the two config files and
 * the four npm scripts exist, and that the scripts invoke the right
 * tools (eslint for lint, prettier for format).
 *
 * WHY THIS SHAPE: before L1 there was no backend eslint config, no
 * Prettier config, and no lint/format script anywhere in backend/ —
 * the tooling simply did not exist. This spec is the living proof the
 * tooling is present. It does NOT assert a clean lint or a clean
 * format:check — those are L2/L8's guards; after L1 the lint still
 * reports ~228 errors and format:check still fails ~1939 files by
 * design.
 *
 * Fail-first: on the pre-L1 tree this spec exits 1 (no config files,
 * no scripts); after L1 it exits 0.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');

function main(): void {
  const prettierrc = path.join(BACKEND, '.prettierrc');
  const eslintConfig = path.join(BACKEND, 'eslint.config.mjs');
  assert.ok(fs.existsSync(prettierrc), `backend/.prettierrc must exist at ${prettierrc}`);
  assert.ok(fs.existsSync(eslintConfig), `backend/eslint.config.mjs must exist at ${eslintConfig}`);
  const prettierConfig = JSON.parse(fs.readFileSync(prettierrc, 'utf8')) as Record<string, unknown>;
  assert.equal(prettierConfig.singleQuote, true, 'backend/.prettierrc must set singleQuote: true');
  assert.equal(prettierConfig.printWidth, 120, 'backend/.prettierrc must set printWidth: 120');

  const pkgPath = path.join(BACKEND, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const expected: Record<string, string> = {
    lint: 'eslint',
    'lint:fix': 'eslint',
    format: 'prettier',
    'format:check': 'prettier',
  };
  for (const [name, tool] of Object.entries(expected)) {
    const cmd = scripts[name];
    assert.ok(typeof cmd === 'string' && cmd.length > 0, `backend/package.json must define a "${name}" script`);
    assert.ok(cmd.includes(tool), `backend/package.json "${name}" script must invoke ${tool} (got: ${cmd})`);
  }
  console.log('backend lint + prettier tooling check passed');
}

main();
