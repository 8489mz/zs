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
import { getPosTerminalCode } from '@/features/pos';

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
  openTablesOverrideReason?: string;
}

interface ReviewShiftValues {
  shiftId: string;
  decision: 'approve' | 'reject';
  note?: string;
}

// A blank declared total is ABSENT, never 0.00: the close gate
// refuses a missing total when the method has operations, while an
// explicitly entered 0.00 stays acceptable — so the mutation must
// not coerce a blank/NaN field into 0, or the server gate could
// never fire from the UI and a blank would silently become a 0.00
// declaration. JSON.stringify drops undefined keys, so the server
// sees the field as absent. Counted cash follows the same rule:
// the DTO already requires it, and a blank cash box must not
// silently become a 0.00 count either.
const declaredTotalOrUndefined = (value: number | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

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
        // INV-REST-SHIFT-CLOSE-CONTROL (I24): the station code is
        // stamped on the open, so the shift — and later its sales —
        // are attributable to this terminal.
        terminalCode: getPosTerminalCode(),
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
        countedCash: declaredTotalOrUndefined(values.countedCash),
        cardDeclaredTotal: declaredTotalOrUndefined(values.cardDeclaredTotal),
        cardOperationCount: Number(values.cardOperationCount || 0),
        walletDeclaredTotal: declaredTotalOrUndefined(values.walletDeclaredTotal),
        walletOperationCount: Number(values.walletOperationCount || 0),
        instapayDeclaredTotal: declaredTotalOrUndefined(values.instapayDeclaredTotal),
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
        managerPin: values.managerPin || '',
        // INV-SECOND-MANAGER-PASSWORD-REMOVED: no second-manager
        // password travels any more — the open-tables override
        // reason travels only when the cashier filled it; the
        // server decides whether it is required.
        openTablesOverrideReason: values.openTablesOverrideReason || undefined,
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
        // INV-REST-SHIFT-CLOSE-CONTROL (I22): the review is a
        // decision — approve closes and posts, reject reopens.
        decision: values.decision,
        note: String(values.note || '').trim(),
      }),
    onSuccess: async () => {
      await refreshAll();
      actions?.onReviewSuccess?.();
    }
  });

  return { openMutation, movementMutation, closeMutation, reviewMutation };
}
