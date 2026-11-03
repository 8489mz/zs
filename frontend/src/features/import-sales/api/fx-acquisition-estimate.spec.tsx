/*
New file: frontend/src/features/import-sales/api/fx-acquisition-estimate.spec.tsx
Pins the FX-acquisition honest-estimates rule (INV-IMPORT-ESTIMATES-HONEST).

WHAT WAS WRONG: the mutation built the POST payload with
`egpCost ?? foreignAmount * (rate || 50)` — when the caller supplied
neither an EGP cost nor a rate, the frontend silently priced the
acquisition at an assumed rate of 50. The backend trusts egpCost and
posts a balanced treasury journal from it, so the invented 50 flowed
straight into posted money.

WHAT THIS PINS, driving the real mutation hook with a mocked http layer:
- With neither an EGP cost nor an exchange rate, the mutation rejects
  with IMPORT_FX_RATE_REQUIRED and http is NEVER called: no invented
  number is ever posted.
- With an explicit rate, egpCost is computed from that rate and the
  payload carries it.
- With an explicit EGP cost, it passes through untouched.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-query-client';
import {
  buildFxAcquisitionPayload,
  useRecordFxAcquisitionMutation,
} from '@/features/import-sales/api/shipments.api';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

function renderMutation() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRecordFxAcquisitionMutation(), { wrapper });
}

describe('fx-acquisition honest estimates', () => {
  it('fails closed before any request when neither EGP cost nor rate is supplied', async () => {
    const { result } = renderMutation();

    await expect(
      result.current.mutateAsync({ foreignAmount: 1000, currency: 'USD' }),
    ).rejects.toThrow(/IMPORT_FX_RATE_REQUIRED/);
    expect(httpMock).not.toHaveBeenCalled();
    expect(() =>
      buildFxAcquisitionPayload({ foreignAmount: 1000, currency: 'USD' }),
    ).toThrow(/IMPORT_FX_RATE_REQUIRED/);
  });

  it('computes the EGP cost from an explicit rate', async () => {
    httpMock.mockResolvedValueOnce({ success: true });
    const { result } = renderMutation();

    await result.current.mutateAsync({ foreignAmount: 1000, currency: 'USD', exchangeRate: 55 });

    expect(httpMock).toHaveBeenCalledTimes(1);
    const [url, init] = httpMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/import-sales/fx-acquisitions');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.egpCost).toBe(55000);
    expect(body.exchangeRate).toBe(55);
  });

  it('passes an explicit EGP cost through untouched', async () => {
    httpMock.mockResolvedValueOnce({ success: true });
    const { result } = renderMutation();

    await result.current.mutateAsync({ foreignAmount: 1000, currency: 'USD', egpCost: 51250 });

    const [, init] = httpMock.mock.calls[0] as [string, { method: string; body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.egpCost).toBe(51250);
    expect(body).not.toHaveProperty('exchangeRate');
  });
});
