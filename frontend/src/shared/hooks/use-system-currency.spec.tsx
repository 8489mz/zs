/*
New file: frontend/src/shared/hooks/use-system-currency.spec.tsx
Pins half of the CRM opportunity form wipe (INV-CRM-OPPORTUNITY-FORM-RESET).

THE GAP: useSystemCurrency() returned a fresh object (and fresh formatNumber /
formatCurrency closures) on every render. Any consumer that memoised or
effected on that object -- CrmDealCreateModal's initialDealForm useMemo and
its reset useEffect -- recomputed / re-ran on every render, so the modal
reset the form to empty while the user was typing and no opportunity could
ever be created. (The modal half is pinned by
CrmDealCreateModal.spec.tsx; pre-fix that spec's modal tests never settle --
the reset loop spins forever -- while this spec fails fast by assertion.)

THE RULE: the hook's return keeps a stable identity across re-renders and
changes identity only when the currency itself changes.
*/

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';

describe('useSystemCurrency', () => {
  it('returns a stable reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useSystemCurrency());
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.formatNumber).toBe(first.formatNumber);
    expect(result.current.formatCurrency).toBe(first.formatCurrency);
    expect(result.current.currencyCode).toBe('EGP');
  });

  it('changes identity when the override currency changes', () => {
    const { result, rerender } = renderHook(
      ({ currency }: { currency?: string | null }) => useSystemCurrency(currency),
      { initialProps: { currency: 'EGP' as string | null } },
    );
    const first = result.current;

    rerender({ currency: 'SAR' });

    expect(result.current).not.toBe(first);
    expect(result.current.currencyCode).toBe('SAR');
  });
});
