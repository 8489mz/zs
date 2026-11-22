import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { todayLocalDateKey } from '@/lib/format';

// ==========================================
// MAKER-CHECKER APPROVALS
// ==========================================
export const useApprovalRequestsQuery = (status?: string) => {
  return useQuery({
    queryKey: ['import-approvals', status],
    queryFn: async () => {
      const url = status ? `/api/import-sales/approvals?status=${encodeURIComponent(status)}` : '/api/import-sales/approvals';
      return await http<any[]>(url);
    },
  });
};

export const useCreateApprovalRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        actionType: dto.actionType || dto.action_type,
        referenceId: String(dto.referenceId ?? dto.reference_id ?? dto.entityId ?? ''),
        requestPayload:
          dto.requestPayload ??
          dto.request_payload ?? {
            entityType: dto.entityType,
            amountEgp: dto.amountEgp,
            reason: dto.reason,
            ...(dto.payload || {}),
          },
      };
      return await http<any>('/api/import-sales/approvals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-approvals'] });
    },
  });
};

export const useDecideApprovalRequestMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      rejectionReason,
      decisionNotes,
      comments,
    }: {
      id: string;
      decision: 'approved' | 'rejected';
      rejectionReason?: string;
      decisionNotes?: string;
      comments?: string;
    }) => {
      return await http<any>(`/api/import-sales/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          rejectionReason: rejectionReason || decisionNotes || comments,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-approvals'] });
    },
  });
};

// ==========================================
// FX TREASURY & CURRENCY PORTFOLIO
// ==========================================
export const usePostSourcingTripExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { tripId: string; approvalRequestId: string; supplierId: number; expenseAccountId: number }) => {
      return await http<any>(`/api/import-sales/sourcing-trips/${dto.tripId}/post-expense`, {
        method: 'POST',
        body: JSON.stringify({
          approvalRequestId: dto.approvalRequestId,
          supplierId: dto.supplierId,
          expenseAccountId: dto.expenseAccountId,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sourcing-trips'] });
    },
  });
};

export const useFxPortfolioQuery = () => {
  return useQuery({
    queryKey: ['import-fx-portfolio'],
    queryFn: async () => {
      return await http<any>('/api/import-sales/fx-portfolio');
    },
  });
};

/**
 * INV-IMPORT-ESTIMATES-HONEST + INV-IMPORT-FX-TREASURY-LIVE-RATE
 * (I4-D7): builds the FX-acquisition POST payload. The EGP cost is
 * NEVER invented: when the caller supplies neither an explicit EGP
 * cost nor an explicit exchange rate, this throws before any request
 * is sent instead of silently pricing the acquisition at an assumed
 * rate of 50. The backend re-resolves the live rate server-side and
 * derives (or validates) the EGP cost from it, so a cost computed
 * here from a live rate is an echo, never the source of the rate.
 */
export function buildFxAcquisitionPayload(dto: any): Record<string, unknown> {
  const foreignAmount = Number(dto.foreignAmount ?? dto.foreign_amount ?? 0);
  const explicitEgp = dto.egpCost ?? dto.egp_cost;
  const explicitRate = dto.exchangeRate ?? dto.exchange_rate;
  const hasEgp = explicitEgp !== undefined && explicitEgp !== null && explicitEgp !== '';
  const hasRate = explicitRate !== undefined && explicitRate !== null && explicitRate !== '' && Number(explicitRate) > 0;
  if (!hasEgp && !hasRate) {
    throw new Error(
      'لا يمكن تسجيل تدبير عملة بلا تكلفة بالجنيه ولا سعر صرف؛ حدد أحدهما صراحة. [IMPORT_FX_RATE_REQUIRED]',
    );
  }
  const egpCost = hasEgp ? Number(explicitEgp) : foreignAmount * Number(explicitRate);
  return {
    currency: dto.currency || 'USD',
    foreignAmount,
    egpCost,
    exchangeRate: dto.exchangeRate ?? dto.exchange_rate ?? undefined,
    acquisitionDate: dto.acquisitionDate || dto.acquisition_date || todayLocalDateKey(),
    source: dto.source || dto.sourceType || 'bank',
    bankAccountId: dto.bankAccountId || (dto.treasuryAccountId ? String(dto.treasuryAccountId) : undefined),
    sourceAccountId: dto.sourceAccountId || (dto.sourceTreasuryAccountId ? String(dto.sourceTreasuryAccountId) : undefined),
    transferId: dto.transferId ?? dto.supplierPaymentId ?? undefined,
    notes: dto.notes || undefined,
  };
}

export const useRecordFxAcquisitionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = buildFxAcquisitionPayload(dto);
      return await http<any>('/api/import-sales/fx-acquisitions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-fx-portfolio'] });
    },
  });
};

// ==========================================
// RECONCILIATION & EXCEPTIONS SCANNER
// ==========================================
export const useReconciliationExceptionsQuery = (status?: string) => {
  return useQuery({
    queryKey: ['import-reconciliation-exceptions', status],
    queryFn: async () => {
      const url = status ? `/api/import-sales/reconciliation/exceptions?status=${encodeURIComponent(status)}` : '/api/import-sales/reconciliation/exceptions';
      return await http<any[]>(url);
    },
  });
};

export const useRunReconciliationScanMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await http<any>('/api/import-sales/reconciliation/scan', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-reconciliation-exceptions'] });
    },
  });
};

export const useResolveReconciliationExceptionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, resolutionNotes }: { id: string; resolutionNotes?: string; status?: string }) => {
      return await http<any>(`/api/import-sales/reconciliation/exceptions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNotes: resolutionNotes || 'تمت المعالجة والمطابقة المحاسبية' }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-reconciliation-exceptions'] });
    },
  });
};

// ==========================================
// SOURCING TRIPS
// ==========================================
export const useSourcingTripsQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['import-sourcing-trips', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/sourcing-trips?projectId=${encodeURIComponent(projectId)}` : '/api/import-sales/sourcing-trips';
      return await http<any[]>(url);
    },
  });
};

export const useCreateSourcingTripMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        projectId: dto.projectId || dto.project_id || undefined,
        tripTitle: dto.tripTitle || dto.trip_title || dto.trip_name || dto.title,
        destinationCity: dto.destinationCity || dto.destination_city || dto.cities_visited || dto.destination || 'Guangzhou / Yiwu',
        startDate: dto.startDate || dto.start_date || todayLocalDateKey(),
        endDate: dto.endDate || dto.end_date || undefined,
        budgetEgp: Number(dto.budgetEgp ?? dto.budget_egp ?? (dto.travel_cost_usd ? Number(dto.travel_cost_usd) * 50 : 0)),
        actualCostEgp: Number(dto.actualCostEgp ?? dto.actual_cost_egp ?? (dto.travel_cost_usd ? Number(dto.travel_cost_usd) * 50 : 0)),
        notes: dto.notes || dto.objectives || dto.outcomes_summary || undefined,
      };
      return await http<any>('/api/import-sales/sourcing-trips', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sourcing-trips'] });
    },
  });
};
