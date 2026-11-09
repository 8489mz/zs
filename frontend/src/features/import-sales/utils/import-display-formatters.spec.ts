/*
New file: frontend/src/features/import-sales/utils/import-display-formatters.spec.ts
Pins the I2-P9 display fixes (trial problem 9, 2026-11-09), driving the
REAL shared formatters ImportProjectsManager, ImportCommandCenter and
ShipmentDetailsPage render through.

WHAT WAS WRONG (each case below fails on base — the old inline code
produced the wrong string, and the new helper module does not exist
there at all, so the suite cannot even import on base):
- status: the projects table and the command center rendered the raw
  code "feasibility"; now "قيد الدراسة", through one helper.
- per-unit market profit: the cell prefixed "+" unconditionally, so a
  -50.76 loss rendered "+-50.76" (double sign); now one correct sign.
- market-ROI badge: the engine leaves overallRoiVsMarketPercent
  undefined whenever the market profit is zero or negative while the
  card still renders, so the badge read "عائد الاستثمار من السوق: %
  ROI" with no number; now the badge hides when there is no number.
- allocation hint: hardcoded "$3500" even when the freight was $5;
  now the shipment's real freight.
- CBM: typing 0.01 into the grid collapsed to 1 (the controlled input
  stored Number(e.target.value) while rendering value={it.unitCbm ||
  ''}, so the intermediate "0." keystrokes vanished); the parser now
  keeps in-progress decimal text and only returns a number once the
  text is complete.

WHAT THIS PINS:
- status labels for feasibility / warehousing / selling / closed,
  raw-value fallback for an unknown code, "—" for a missing one.
- profit: +50.76 gain, -50.76 loss with a single sign, "—" with no
  market price.
- ROI badge: null with no number, "…: 25% ROI" with one.
- hint: "$5" for a $5 freight (never "$3500"), "$3500" when the
  freight really is $3500, "$0" when there is none.
- CBM keystroke sequence "0" -> "0." -> "0.0" -> "0.01" keeps 0.01
  (the old Number() path ends at 1), plus the normalize boundary the
  engine call uses.
*/

import { describe, expect, it } from 'vitest';
import {
  formatFreightAllocationHint,
  formatMarketProfitEgp,
  formatMarketRoiBadge,
  getImportProjectStatusLabel,
  normalizeFeasibilityNumber,
  parseFeasibilityNumberInput,
} from './import-display-formatters';

describe('getImportProjectStatusLabel', () => {
  it('translates the known project statuses to Arabic', () => {
    expect(getImportProjectStatusLabel('feasibility')).toBe('قيد الدراسة');
    // INV-IMPORT-PROJECT-STATUS-APPROVED: an approved / converted
    // project reads 'sourcing', which must render an Arabic label
    // ('قيد التوريد'), never the raw English code.
    expect(getImportProjectStatusLabel('sourcing')).toBe('قيد التوريد');
    expect(getImportProjectStatusLabel('warehousing')).toBe('بالمخزن');
    expect(getImportProjectStatusLabel('selling')).toBe('قيد البيع');
    expect(getImportProjectStatusLabel('closed')).toBe('مغلق');
  });

  it('falls back to the raw code for an unknown status and never blanks', () => {
    expect(getImportProjectStatusLabel('in_transit')).toBe('in_transit');
    expect(getImportProjectStatusLabel('')).toBe('—');
    expect(getImportProjectStatusLabel(null)).toBe('—');
    expect(getImportProjectStatusLabel(undefined)).toBe('—');
  });
});

describe('formatMarketProfitEgp', () => {
  it('renders one correct sign — never "+-" on a loss', () => {
    expect(formatMarketProfitEgp(50.76)).toBe('+50.76 ج.م');
    expect(formatMarketProfitEgp(-50.76)).toBe('-50.76 ج.م');
  });

  it('renders "—" when the engine reported no market price', () => {
    expect(formatMarketProfitEgp(undefined)).toBe('—');
    expect(formatMarketProfitEgp(null)).toBe('—');
  });
});

describe('formatMarketRoiBadge', () => {
  it('returns null when the engine reported no ROI so the badge hides', () => {
    expect(formatMarketRoiBadge(undefined)).toBeNull();
    expect(formatMarketRoiBadge(null)).toBeNull();
  });

  it('renders the real number when there is one', () => {
    expect(formatMarketRoiBadge(25)).toBe('عائد الاستثمار من السوق: 25% ROI');
    expect(formatMarketRoiBadge(0)).toBe('عائد الاستثمار من السوق: 0% ROI');
  });
});

describe('formatFreightAllocationHint', () => {
  it('uses the shipment’s real freight, never a hardcoded $3500', () => {
    expect(formatFreightAllocationHint(5)).toBe(
      'تحدد كيف يقسم النظام الـ $5 والجمارك بين قطع الغيار المختلفة في الحاوية.',
    );
    expect(formatFreightAllocationHint(3500)).toContain('$3500');
  });

  it('renders $0 when there is no freight to allocate', () => {
    expect(formatFreightAllocationHint(0)).toContain('$0');
    expect(formatFreightAllocationHint(undefined)).toContain('$0');
  });
});

describe('parseFeasibilityNumberInput', () => {
  it('keeps a typed 0.01 as 0.01 through every intermediate keystroke', () => {
    // The old Number(e.target.value) path collapsed this sequence to 1:
    // "0" -> 0 -> "", "0." -> NaN -> "", "0.0" -> 0 -> "", "1" -> 1.
    expect(parseFeasibilityNumberInput('0')).toBe(0);
    expect(parseFeasibilityNumberInput('0.')).toBe('0.');
    expect(parseFeasibilityNumberInput('0.0')).toBe('0.0');
    expect(parseFeasibilityNumberInput('0.01')).toBe(0.01);
  });

  it('returns real numbers for complete input and clears on empty', () => {
    expect(parseFeasibilityNumberInput('5')).toBe(5);
    expect(parseFeasibilityNumberInput('5.')).toBe('5.');
    expect(parseFeasibilityNumberInput('0.5')).toBe(0.5);
    expect(parseFeasibilityNumberInput('')).toBeUndefined();
  });
});

describe('normalizeFeasibilityNumber', () => {
  it('normalizes in-progress text to a finite number for the engine call', () => {
    expect(normalizeFeasibilityNumber('0.')).toBe(0);
    expect(normalizeFeasibilityNumber('0.01')).toBe(0.01);
    expect(normalizeFeasibilityNumber(5)).toBe(5);
    expect(normalizeFeasibilityNumber(undefined)).toBe(0);
    expect(normalizeFeasibilityNumber('')).toBe(0);
  });
});
