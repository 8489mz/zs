import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { invalidateTreasuryDomain } from '@/app/query-invalidation';
import { cashDrawerApi } from '@/features/cash-drawer/api/cash-drawer.api';
import {
  acquireCashDrawerMovementRequestAttempt,
  mayReleaseCashDrawerMovementRequestAttempt,
  normalizeCashDrawerMovementRequestPayload,
  type CashDrawerMovementRequestAttempt,
} from '@/features/cash-drawer/lib/cash-drawer-movement-request-key';

interface OpenShiftValues {
  openingCash: number;
  note: string;
  branchId: string;
  locationId: string;
  password?: string;
}

interface MovementValues {
  shiftId: string;
  type: 'cash_in' | 'cash_out' | 'safe_drop' | 'safe_replenishment';
  amount: number;
  note: string;
  counterpartAccountId?: string | number;
  managerPin?: string;
}

interface CloseShiftValues {
  shiftId: string;
  countedCash: number;
  cardDeclaredTotal?: number;
  cardOperationCount?: number;
  walletDeclaredTotal?: number;
  walletOperationCount?: number;
  instapayDeclaredTotal?: number;
  instapayOperationCount?: number;
  cardDetails?: Array<{ amount?: number; reference?: string }>;
  walletDetails?: Array<{ amount?: number; reference?: string }>;
  instapayDetails?: Array<{ amount?: number; reference?: string }>;
  note: string;
  managerPin?: string;
}

interface ReviewShiftValues {
  shiftId: string;
  note?: string;
}

export function useCashDrawerMutations(actions?: {
  onOpenSuccess?: () => void;
  onMovementSuccess?: () => void;
  onCloseSuccess?: () => void;
  onReviewSuccess?: () => void;
}) {
  const queryClient = useQueryClient();

  const refreshAll = async () => {
    await invalidateTreasuryDomain(queryClient);
  };

  const openMutation = useMutation({
    mutationFn: (values: OpenShiftValues) =>
      cashDrawerApi.open({
        openingCash: Number(values.openingCash || 0),
        note: values.note || '',
        branchId: values.branchId || '',
        locationId: values.locationId || '',
        password: values.password || undefined,
      }),
    onSuccess: async () => {
      await refreshAll();
      actions?.onOpenSuccess?.();
    }
  });

  // One stable requestKey per movement submission: retries of the
  // identical payload reuse it so the backend returns the current
  // listing instead of posting a second movement
  // (INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY). The attempt is released
  // only on success or a known client rejection; an unknown outcome
  // keeps it, and a changed payload then throws in the mutation
  // function before any HTTP call.
  const movementAttemptRef = useRef<CashDrawerMovementRequestAttempt | null>(null);
  const movementMutation = useMutation({
    mutationFn: (values: MovementValues) => {
      const normalized = normalizeCashDrawerMovementRequestPayload(values);
      const attempt = acquireCashDrawerMovementRequestAttempt(movementAttemptRef.current, normalized);
      movementAttemptRef.current = attempt;
      return cashDrawerApi.movement(values.shiftId, {
        type: normalized.type,
        amount: normalized.amount,
        note: normalized.note,
        counterpartAccountId: normalized.counterpartAccountId || undefined,
        managerPin: values.managerPin || '',
        requestKey: attempt.requestKey,
      });
    },
    onSuccess: async () => {
      movementAttemptRef.current = null;
      await refreshAll();
      actions?.onMovementSuccess?.();
    },
    onError: (error: unknown) => {
      if (mayReleaseCashDrawerMovementRequestAttempt(error)) {
        movementAttemptRef.current = null;
      }
    },
  });

  const closeMutation = useMutation({
    mutationFn: (values: CloseShiftValues) =>
      cashDrawerApi.close(values.shiftId, {
        countedCash: Number(values.countedCash || 0),
        cardDeclaredTotal: Number(values.cardDeclaredTotal || 0),
        cardOperationCount: Number(values.cardOperationCount || 0),
        walletDeclaredTotal: Number(values.walletDeclaredTotal || 0),
        walletOperationCount: Number(values.walletOperationCount || 0),
        instapayDeclaredTotal: Number(values.instapayDeclaredTotal || 0),
        instapayOperationCount: Number(values.instapayOperationCount || 0),
        cardDetails: Array.isArray(values.cardDetails)
          ? values.cardDetails.map((d) => ({ amount: Number(d.amount || 0), reference: d.reference }))
          : [],
        walletDetails: Array.isArray(values.walletDetails)
          ? values.walletDetails.map((d) => ({ amount: Number(d.amount || 0), reference: d.reference }))
          : [],
        instapayDetails: Array.isArray(values.instapayDetails)
          ? values.instapayDetails.map((d) => ({ amount: Number(d.amount || 0), reference: d.reference }))
          : [],
        note: values.note || '',
        managerPin: values.managerPin || ''
      }),
    onSuccess: async (_data, variables) => {
      queryClient.setQueryData(queryKeys.cashierShiftsPage('open:pos'), (old: any) => {
        if (!old?.rows) return { rows: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } };
        return {
          ...old,
          rows: old.rows.filter((s: any) => String(s.id) !== String(variables.shiftId)),
        };
      });
      await refreshAll();
      actions?.onCloseSuccess?.();
    }
  });

  const reviewMutation = useMutation({
    mutationFn: (values: ReviewShiftValues) =>
      cashDrawerApi.reviewClose(values.shiftId, {
        note: String(values.note || '').trim(),
      }),
    onSuccess: async () => {
      await refreshAll();
      actions?.onReviewSuccess?.();
    }
  });

  return { openMutation, movementMutation, closeMutation, reviewMutation };
}
