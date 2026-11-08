import { describe, it, expect } from 'vitest';
import { roundMoney } from './van-money.utils';

/*
 * FE4: numeric proof for the shared van money rounder.
 *
 * The expected values below were verified against the live `toFixed(2)`
 * semantics with node before this spec was written — they pin the exact
 * behaviour, including the float-representation asymmetries (1.005 -> 1.00
 * but 10.005 -> 10.01), so a future change of rounding semantics (e.g. an
 * alignment with the backend `Math.round` half-up rounder) must update
 * these pins deliberately instead of silently changing money values.
 *
 * Runs in CI only (frontend Vitest never runs on the dev VM).
 */
describe('van money rounding (FE4)', () => {
  it('rounds plain amounts to two decimals', () => {
    expect(roundMoney(19.99 * 3)).toBe(59.97);
    expect(roundMoney(1234.5678)).toBe(1234.57);
    expect(roundMoney(2.5)).toBe(2.5);
    expect(roundMoney(0)).toBe(0);
  });

  it('pins the toFixed(2) float-boundary behaviour', () => {
    expect(roundMoney(1.005)).toBe(1);
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(2.675)).toBe(2.67);
    expect(roundMoney(1.015)).toBe(1.01);
    expect(roundMoney(100.125)).toBe(100.13);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(-2.675)).toBe(-2.67);
    expect(roundMoney(-1.005)).toBe(-1);
  });

  it('absorbs binary float dust the way the inline sites did', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(59.97 - 49.98)).toBe(9.99);
  });

  it('reproduces the pre-sales offer chain exactly', () => {
    expect(roundMoney(100 * (1 - 5 / 100))).toBe(95);
    const gross = roundMoney(3 * 19.99);
    expect(gross).toBe(59.97);
    expect(roundMoney(gross - gross * 0.05)).toBe(56.97);
  });

  it('passes NaN through exactly like the inline sites did', () => {
    expect(Number.isNaN(roundMoney(NaN))).toBe(true);
  });
});
