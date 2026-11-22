import { useQuery } from '@tanstack/react-query';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { vanSalesApi } from '../api/van-sales.api';

// F12 (trial problem 15): the admin console's queries hit
// supervisor-only endpoints. A denied caller must fire none of
// them — not even the 15s badge refetches — so the page passes
// enabled=false and renders its denied state instead.
export function useVanSalesAdmin(enabled = true) {
  const repsQuery = useQuery<DeliveryRep[]>({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
    enabled,
  });

  const pendingReturnsQuery = useQuery({
    queryKey: ['van-admin-pending-returns-badge'],
    queryFn: () => vanSalesApi.listAdminReturns({ status: 'pending_approval' }),
    refetchInterval: 15000,
    enabled,
  });

  const pendingRequisitionsQuery = useQuery({
    queryKey: ['van-admin-pending-requisitions-badge'],
    queryFn: () => vanSalesApi.listAdminRequisitions({ status: 'pending' }),
    refetchInterval: 15000,
    enabled,
  });

  const fraudRadarSummaryQuery = useQuery({
    queryKey: ['van-fraud-radar-summary', '30', 'all'],
    queryFn: () => vanSalesApi.getFraudRadarSummary({ days: 30 }),
    refetchInterval: 15000,
    enabled,
  });

  return {
    reps: repsQuery.data || [],
    isRepsLoading: repsQuery.isLoading,
    pendingReturns: pendingReturnsQuery.data || [],
    pendingRequisitions: pendingRequisitionsQuery.data || [],
    suspicionEventsCount: fraudRadarSummaryQuery.data?.kpis?.totalSuspicionEvents || 0,
  };
}

export type { DeliveryRep };
