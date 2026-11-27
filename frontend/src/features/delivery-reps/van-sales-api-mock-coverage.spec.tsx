/* INV-VAN-SALES-MOCK-IMPORT-ORIGINAL — the vanSalesApi mocks rotted
 * because they were hand-written lists: five of the six delivery-reps
 * specs lacked evaluateCartPromotions (113 real functions, 20 listed
 * at most), and no test failed until a test drove the missing call.
 * Every spec that mocks the API must now use the automatic pattern —
 * importOriginal + spread of the real API, overriding only what the
 * test needs to control — so a new real function can never be missing
 * from a mock again. This spec pins that pattern three ways:
 *
 * (1) runtime: this file's own mock spreads the real API with zero
 *     overrides, and its key set must equal the real key set exactly;
 * (2) static: every guarded spec file must contain the importOriginal
 *     mock with a `...actual.vanSalesApi` spread;
 * (3) static: every key overridden in a guarded mock must be a real
 *     API key (no stale/typo'd override that silently does nothing).
 *
 * Override keys are parsed as the 6-space-indented `name:` lines
 * inside the `vanSalesApi: { ... }` block of each mock — the mocks
 * keep one override per line at that indent, and nested stub objects
 * stay inline, so no nested key can false-positive.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { vanSalesApi } from './api/van-sales.api';

const holder = vi.hoisted(() => ({ real: null as any }));

vi.mock('./api/van-sales.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/van-sales.api')>();
  holder.real = actual.vanSalesApi;
  return {
    ...actual,
    vanSalesApi: {
      ...actual.vanSalesApi,
    },
  };
});

// Every spec that mocks the van-sales API. Paths are relative to this file.
const GUARDED_SPECS = [
  'components/VanSaleTab.spec.tsx',
  'components/VanSaleTab.promo-guard.spec.tsx',
  'components/VanCollectionTab.spec.tsx',
  'components/VanFieldReturnsAdminTab.spec.tsx',
  'components/VanFleetTab.spec.tsx',
  'components/VanLoadRequisitionsAdminTab.spec.tsx',
  'components/VanSalesHistoryTab.spec.tsx',
  'pages/VanSalesMobilePage.spec.tsx',
];

function readSpec(relativePath: string): string {
  // Vitest runs with cwd=frontend; import.meta.url is undefined under
  // its transform, so resolve from the working directory.
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/features/delivery-reps', relativePath),
    'utf8',
  );
}

function overrideKeys(source: string): string[] {
  const mockAt = source.indexOf("vi.mock('../api/van-sales.api'");
  expect(mockAt).toBeGreaterThanOrEqual(0);
  const block = source.slice(mockAt);
  const openAt = block.indexOf('vanSalesApi: {');
  expect(openAt).toBeGreaterThanOrEqual(0);
  const body = block.slice(openAt);
  const closeAt = body.search(/\n {4}\},/);
  expect(closeAt).toBeGreaterThanOrEqual(0);
  const keys: string[] = [];
  for (const line of body.slice(0, closeAt).split('\n')) {
    const match = /^ {6}([A-Za-z_$][\w$]*)\s*:/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

describe('van-sales API mock coverage', () => {
  it('the real API is all functions (113 keys on 2026-11-22)', () => {
    const keys = Object.keys(vanSalesApi);
    expect(keys.length).toBeGreaterThanOrEqual(100);
    for (const key of keys) {
      expect(typeof (vanSalesApi as Record<string, unknown>)[key]).toBe('function');
    }
    expect(keys).toContain('evaluateCartPromotions');
  });

  it('a pure-spread mock covers every real API key exactly', () => {
    const realKeys = Object.keys(holder.real).sort();
    const mockedKeys = Object.keys(vanSalesApi).sort();
    expect(mockedKeys).toEqual(realKeys);
  });

  it('every guarded spec uses importOriginal + spread, and overrides only real keys', () => {
    const realKeys = new Set(Object.keys(holder.real));
    for (const relativePath of GUARDED_SPECS) {
      const source = readSpec(relativePath);
      expect(
        source.includes("vi.mock('../api/van-sales.api'"),
        `${relativePath} must mock ../api/van-sales.api`,
      ).toBe(true);
      expect(
        source.includes('importOriginal'),
        `${relativePath} must use the importOriginal pattern`,
      ).toBe(true);
      expect(
        source.includes('...actual.vanSalesApi'),
        `${relativePath} must spread the real API`,
      ).toBe(true);
      for (const key of overrideKeys(source)) {
        expect(
          realKeys.has(key),
          `${relativePath} overrides ${key}, which is not a real vanSalesApi key`,
        ).toBe(true);
      }
    }
  });
});
