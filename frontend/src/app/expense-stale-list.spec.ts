/* Expenses stale list (INV-EXPENSES-STALE-LIST): after creating an expense
 * the list must refetch immediately — invalidateTreasuryDomain must
 * invalidate the expenses key with refetchType 'active', never 'none'
 * (with 'none' the invalidated list keeps showing stale data until a
 * manual refresh). Pins the invalidation by source read.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Expenses stale list invalidation', () => {
  it('invalidates the expenses key with an active refetch', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './query-invalidation.ts'), 'utf8');
    const start = src.indexOf('export async function invalidateTreasuryDomain');
    const end = src.indexOf('export async function invalidateAccountsDomain');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    expect(fn).toContain("queryKey: queryKeys.expenses, refetchType: 'active'");
    expect(fn).not.toContain("queryKey: queryKeys.expenses, refetchType: 'none'");
  });
});
