/*
 * toISOString date-key sweep, package 3 (remainder) — INV-TOISO-DATE-SWEEP-REMAINDER.
 *
 * Fixes the last 8 (c) other-class sites (bank-statement date cells, the two
 * contracting addDays helpers, the POS offer date normaliser, the Hijri
 * formatter fallback) and ratchets the WHOLE frontend tree: after this
 * package the only remaining UTC-slice date keys in non-spec production
 * code are the 15 deliberately kept lines listed below (14 display-only
 * export-filename / prose-note sites + the bank-statement Excel-serial
 * site, which builds a UTC-midnight Date by construction so the UTC slice
 * returns exactly the serial's day on every host).
 *
 * Kept-site reasons (also in the INV-TOISO-DATE-SWEEP-REMAINDER entry):
 * export filenames can only mislabel a file by one day in the 00:00-02:00
 * window, never a record, filter or posting; the delay note is free text
 * inside a record, not a date the system reads; the serial site keys a
 * Date that is UTC midnight by construction.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { todayLocalDateKey } from './format';
import { addPosItem, repriceCartLine, todayLocalIsoDate } from '@/features/pos/lib/pos.domain';
import { formatHijriDate } from './hijri';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');
const PATTERNS = [
  /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g,
  /toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g,
  /toISOString\(\)\s*\.slice\(\s*2\s*,\s*10\s*\)/g,
  /toISOString\(\)\s*\.slice\(\s*0\s*,\s*7\s*\)/g,
];

/* The ONLY UTC-slice date keys allowed to remain in non-spec production
 * code, as relative path -> count. Everything else must be zero. */
const KEPT: Record<string, number> = {
  'frontend/src/features/accounting/utils/bankStatementParser.ts': 1,
  'frontend/src/features/contracting/components/ImportMasterBoqExcelModal.tsx': 1,
  'frontend/src/features/contracting/components/TaskDelayModal.tsx': 1,
  'frontend/src/features/contracting/pages/ContractingMasterBoqPage.tsx': 1,
  'frontend/src/features/maritime-freight/components/MaritimeContainersTab.tsx': 1,
  'frontend/src/features/maritime-freight/components/MaritimeMasterDataTab.tsx': 6,
  'frontend/src/features/products/components/ScalePluExportModal.tsx': 2,
  'frontend/src/features/reports/components/sections/CustomerRfmReportSection.tsx': 1,
  'frontend/src/features/settings/pages/settings-page.helpers.tsx': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.spec.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function countPatterns(text: string): number {
  return PATTERNS.reduce((n, re) => n + (text.match(re) || []).length, 0);
}

describe('package-3 arbitrary-date conversions', () => {
  it('a Date at 01:00 local keys its own local day, not the previous UTC day', () => {
    const d = new Date(2026, 10, 9, 1, 0, 0);
    expect(todayLocalDateKey(d)).toBe('2026-11-09');
    // The old UTC-slice expression keys this instant to the previous UTC
    // day in any zone east of UTC; the Cairo edge itself is pinned by
    // todayTenantDateKey in toiso-sweep-core.spec.ts.
  });

  it('an addDays helper keeps the intended calendar day after setDate arithmetic', () => {
    const d = new Date(2026, 10, 9, 12, 0, 0);
    d.setDate(d.getDate() + 1);
    expect(todayLocalDateKey(d)).toBe('2026-11-10');
    const back = new Date(2026, 10, 9, 12, 0, 0);
    back.setDate(back.getDate() - 1);
    expect(todayLocalDateKey(back)).toBe('2026-11-08');
  });

  it('a POS offer whose end date is a 01:00 local datetime still applies today', () => {
    // The discriminating input is a non-ISO datetime string: ISO strings
    // and Date objects take earlier branches in normalizeDateOnly and never
    // reach the converted line. With the old UTC slice, the 01:00 end
    // keyed yesterday in any zone east of UTC and the offer was wrongly
    // excluded; with local parts it keys today and applies. (In a UTC
    // runner both shapes agree — the ratchet below is the hard guard.)
    vi.useFakeTimers();
    vi.setSystemTime(new Date());
    try {
      const todayKey = todayLocalIsoDate();
      const [y, m, d] = todayKey.split('-').map(Number);
      const prev = new Date(y, m - 1, d);
      prev.setDate(prev.getDate() - 1);
      const prevKey = todayLocalDateKey(prev);
      const slash = (key: string) => key.replaceAll('-', '/');
      const product: any = {
        retailPrice: 100,
        stock: 20,
        offers: [
          {
            id: 'p3-1',
            type: 'percent',
            value: 10,
            from: `${slash(prevKey)} 01:00`,
            to: `${slash(todayKey)} 01:00`,
          },
        ],
      };
      const cart = addPosItem([], product, { priceType: 'retail', digits: 2 });
      const repriced = repriceCartLine(cart[0], product, 1, 2);
      expect(repriced.offerDiscount).toBe(10);
      expect(repriced.price).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Hijri formatter still loads and formats after the fallback change', () => {
    const out = formatHijriDate(new Date(2026, 10, 9, 12, 0, 0));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('package-3 conversions in place', () => {
  it('the converted (c) sites now use the local-parts key', () => {
    const bank = fs.readFileSync(
      path.join(FRONTEND_SRC, 'features/accounting/utils/bankStatementParser.ts'),
      'utf8',
    );
    expect(bank).toContain('todayLocalDateKey(val)');
    expect(bank).toContain('todayLocalDateKey(parsed)');
    expect(bank).toContain('todayLocalDateKey()');
    for (const rel of [
      'features/contracting/components/schedule-generator/schedule-generator-data.ts',
      'features/contracting/components/TaskDelayModal.tsx',
    ]) {
      const text = fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8');
      expect(text).toContain('return todayLocalDateKey(d);');
    }
    const pos = fs.readFileSync(
      path.join(FRONTEND_SRC, 'features/pos/lib/pos-domain/pos-domain-helpers.ts'),
      'utf8',
    );
    expect(pos).toContain('todayLocalDateKey(parsed)');
    const hijri = fs.readFileSync(path.join(FRONTEND_SRC, 'lib/hijri.ts'), 'utf8');
    expect(hijri).toContain('return todayLocalDateKey(d);');
  });

  it('the Excel-serial branch is untouched: it still keys the serial day', () => {
    const bank = fs.readFileSync(
      path.join(FRONTEND_SRC, 'features/accounting/utils/bankStatementParser.ts'),
      'utf8',
    );
    expect(bank).toContain('Math.round((Number(str) - 25569) * 86400 * 1000)');
    expect(bank).toContain('return date.toISOString().split(\'T\')[0];');
  });
});

describe('package-3 whole-tree ratchet', () => {
  it('only the 15 recorded kept lines remain in non-spec production code', () => {
    const offenders: string[] = [];
    let keptTotal = 0;
    for (const full of walk(FRONTEND_SRC)) {
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      const text = fs.readFileSync(full, 'utf8');
      const found = countPatterns(text);
      const want = KEPT[rel] || 0;
      keptTotal += want;
      if (found !== want) {
        offenders.push(`${rel}: ${found} patterns, want ${want}`);
      }
    }
    expect(keptTotal).toBe(15);
    expect(offenders).toEqual([]);
  });

  it('the spec-file keeps: compliance contrast still exists, VAT old-value lines are gone (eval P1 TZ fix)', () => {
    const compliance = fs.readFileSync(
      path.join(FRONTEND_SRC, 'features/import-sales/import-compliance-hs-aci.spec.tsx'),
      'utf8',
    );
    expect(countPatterns(compliance)).toBe(1);
    const vat = fs.readFileSync(
      path.join(FRONTEND_SRC, 'features/sales/pages/VatDeclarationPage.spec.tsx'),
      'utf8',
    );
    // The VAT spec's 2 old-value lines are gone by design: eval P1 converted
    // its currentMonthRange() to todayLocalDateKey, because the UTC slice
    // keyed Nov 1 as Oct 31 in Cairo (a real TZ bug, not a contrast fixture
    // any more). Pinning 0 here guards against the old spelling coming back
    // into the VAT spec.
    expect(countPatterns(vat)).toBe(0);
  });
});
