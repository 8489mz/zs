import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardOverview, invalidateTreasuryDomain } from '@/app/query-invalidation';
import { treasuryApi } from '@/features/treasury/api/treasury.api';
import {
  acquireExpenseRequestAttempt,
  mayReleaseExpenseRequestAttempt,
  normalizeExpenseRequestPayload,
  type ExpenseRequestAttempt,
} from '@/features/treasury/lib/expense-request-key';

interface ExpensePayload {
  title: string;
  amount: string | number;
  note: string;
  date: string;
  branchId: string;
  locationId: string;
  costCenterId?: string;
}

export function useCreateExpenseMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  // One stable requestKey per submission: retries of the identical
  // payload reuse it so the backend returns the original expense
  // instead of posting a second one (INV-TREASURY-EXPENSE-IDEMPOTENCY).
  // The attempt is released only on success or a known client
  // rejection; an unknown outcome keeps it, and a changed payload
  // then throws in the mutation function before any HTTP call.
  const attemptRef = useRef<ExpenseRequestAttempt | null>(null);
  return useMutation({
    mutationFn: (payload: ExpensePayload) => {
      const normalized = normalizeExpenseRequestPayload(payload);
      const attempt = acquireExpenseRequestAttempt(attemptRef.current, normalized);
      attemptRef.current = attempt;
      return treasuryApi.createExpense({ ...normalized, requestKey: attempt.requestKey });
    },
    onSuccess: async () => {
      attemptRef.current = null;
      await Promise.all([
        invalidateTreasuryDomain(queryClient),
        invalidateDashboardOverview(queryClient),
      ]);
      onSuccess?.();
    },
    onError: (error: unknown) => {
      if (mayReleaseExpenseRequestAttempt(error)) {
        attemptRef.current = null;
      }
    },
  });
}
