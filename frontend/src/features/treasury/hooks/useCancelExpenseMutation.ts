import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardOverview, invalidateTreasuryDomain } from '@/app/query-invalidation';
import { treasuryApi } from '@/features/treasury/api/treasury.api';
import type { ExpenseRecord } from '@/types/domain';

/**
 * INV-EXPENSE-CANCEL-REVERSAL: cancelling a posted expense posts a
 * reversing journal and restores the drawer cash on the backend; the
 * register refetches through the same treasury invalidation the
 * create path uses, so the cancelled row shows its ملغي badge and
 * the close-screen disbursed total drops without a manual refresh.
 * No new permission: the endpoint requires the same 'treasury'
 * permission as the create path, and the register button is only
 * rendered for users who can already open this page.
 */
export function useCancelExpenseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (row: ExpenseRecord) =>
      treasuryApi.cancelExpense(row.id, { reason: '' }),
    onSuccess: async () => {
      await Promise.all([
        invalidateTreasuryDomain(queryClient),
        invalidateDashboardOverview(queryClient),
      ]);
    },
  });
}
