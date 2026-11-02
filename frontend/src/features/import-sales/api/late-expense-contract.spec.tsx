/*
New file: frontend/src/features/import-sales/api/late-expense-contract.spec.tsx
Pins the late-expense frontend/backend contract (INV-IMPORT-LATE-EXPENSE-CONTRACT).

WHAT WAS WRONG: the mutation POSTed to the plural route
`/shipments/:id/late-expenses` with fields the backend DTO never
declares (expenseCategory, amountEgp, handlingMethod, treasuryAccountId,
idempotencyKey). The backend route is the singular
`POST shipments/:shipmentId/late-expense`, and the global validation
pipe runs with whitelist + forbidNonWhitelisted, so every dialog submit
failed before reaching the service. The dialog also read
capitalizedToInventoryEgp / expensedToCogsEgp from the response, which
the backend never returns, and offered a "charge all to COGS" treatment
the backend silently ignores (allocation is always proportional).

WHAT THIS PINS, driving the real mutation hook with a mocked http layer:
- The dialog-shaped payload is mapped to exactly the backend DTO fields
  (lateExpenseAmount, title, note) and POSTed to the singular route.
- No legacy field survives into the request body, and the treasury
  account id is never sent as the DTO accountId (the backend reads
  accountId as a COGS-account override, not a payment account).
- The response summary is read from allocation.lateCogsAdjustmentEgp /
  allocation.lateInventoryAdjustmentEgp; the old top-level fields are
  ignored.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-query-client';
import {
  buildLateExpensePayload,
  lateExpenseAllocationSummary,
  useRecordLateShipmentExpenseMutation,
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
  return renderHook(() => useRecordLateShipmentExpenseMutation(), { wrapper });
}

describe('late-expense frontend contract', () => {
  it('posts the dialog payload to the singular backend route with DTO fields only', async () => {
    httpMock.mockResolvedValueOnce({ success: true, allocation: {} });
    const { result } = renderMutation();

    await result.current.mutateAsync({
      shipmentId: 'sh-1',
      dto: {
        expenseType: 'demurrage',
        amountEgp: 1250,
        treatment: 'expense',
        treasuryAccountId: 7,
        description: 'receipt 12',
      },
    });

    expect(httpMock).toHaveBeenCalledTimes(1);
    const [url, init] = httpMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/import-sales/shipments/sh-1/late-expense');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toEqual({
      lateExpenseAmount: 1250,
      title: expect.any(String),
      note: 'receipt 12',
    });
    expect(body).not.toHaveProperty('expenseCategory');
    expect(body).not.toHaveProperty('handlingMethod');
    expect(body).not.toHaveProperty('treasuryAccountId');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body).not.toHaveProperty('accountId');
  });

  it('maps backend-shaped payloads through unchanged', () => {
    expect(
      buildLateExpensePayload({ lateExpenseAmount: 500, title: 'Customs difference', note: 'n1' }),
    ).toEqual({ lateExpenseAmount: 500, title: 'Customs difference', note: 'n1' });
  });

  it('reads the allocation from the fields the backend actually returns', () => {
    expect(
      lateExpenseAllocationSummary({
        allocation: { lateCogsAdjustmentEgp: 300, lateInventoryAdjustmentEgp: 950 },
      }),
    ).toEqual({ capitalizedToInventoryEgp: 950, expensedToCogsEgp: 300 });
    // The old top-level fields the dialog used to read do not exist on
    // the backend response; they must never leak into the toast again.
    expect(
      lateExpenseAllocationSummary({ capitalizedToInventoryEgp: 111, expensedToCogsEgp: 222 }),
    ).toEqual({ capitalizedToInventoryEgp: 0, expensedToCogsEgp: 0 });
  });
});
