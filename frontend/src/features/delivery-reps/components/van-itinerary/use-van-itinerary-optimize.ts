// Route-optimization hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-optimize).
// Owns the TSP optimization state, handleRunRouteOptimization and handleApplyOptimalRoute.

import { useState } from 'react';
import {
  vanSalesApi,
  type VanCustomerItineraryItem,
  type RouteOptimizationResult,
} from '@/features/delivery-reps/api/van-sales.api';
import { toast } from '@/shared/components/system-alert';

interface UseVanItineraryOptimizeParams {
  filtered: VanCustomerItineraryItem[];
  setCustomCustomerOrder: (order: Record<string, number[]>) => void;
  onRefreshItinerary: () => void;
}

export function useVanItineraryOptimize({ filtered, setCustomCustomerOrder, onRefreshItinerary }: UseVanItineraryOptimizeParams) {
  // Dynamic Route Optimization (TSP)
  const [isOptimizeModalOpen, setIsOptimizeModalOpen] = useState(false);
  const [isOptimizingRoute, setIsOptimizingRoute] = useState(false);
  const [routeOptimizationResult, setRouteOptimizationResult] = useState<RouteOptimizationResult | null>(null);

  const handleRunRouteOptimization = async () => {
    const targetCustomers = filtered.filter((c) => c.visitStatus === 'pending');
    const custsToOptimize = targetCustomers.length > 0 ? targetCustomers : filtered;

    if (custsToOptimize.length <= 1) {
      toast.info('يجب وجود عميلين على الأقل لتحسين خط السير');
      return;
    }

    setIsOptimizingRoute(true);

    const executeOpt = async (startCoords?: { lat: number; lng: number }) => {
      try {
        const res = await vanSalesApi.optimizeDriverRoute({
          customerIds: custsToOptimize.map((c) => c.customerId),
          startLat: startCoords?.lat,
          startLng: startCoords?.lng,
          persistSequence: false,
        });

        if (res && res.stats) {
          setRouteOptimizationResult(res);
          setIsOptimizeModalOpen(true);
        } else {
          toast.error('لم يتمكن محرك المسارات من احتساب الترتيب الأمثل');
        }
      } catch (err: any) {
        toast.error(err?.message || 'حدث خطأ أثناء تحسين المسار');
      } finally {
        setIsOptimizingRoute(false);
      }
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          executeOpt({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          executeOpt();
        },
        { timeout: 3500 },
      );
    } else {
      executeOpt();
    }
  };

  const handleApplyOptimalRoute = async () => {
    if (!routeOptimizationResult) return;
    try {
      setIsOptimizingRoute(true);
      const custIds = routeOptimizationResult.orderedStops.map((s) => s.id);
      await vanSalesApi.optimizeDriverRoute({
        customerIds: custIds,
        persistSequence: true,
      });

      const newCustOrderMap: Record<string, number[]> = {};
      for (const stop of routeOptimizationResult.orderedStops) {
        const dName = (stop.district || (stop as any).route || 'المنطقة العامة').trim();
        if (!newCustOrderMap[dName]) newCustOrderMap[dName] = [];
        newCustOrderMap[dName].push(stop.id);
      }

      setCustomCustomerOrder(newCustOrderMap);
      try {
        localStorage.setItem('zs_van_customer_order', JSON.stringify(newCustOrderMap));
      } catch {}

      toast.success(
        `تم اعتماد المسار الأمثل! توفير ${routeOptimizationResult.stats.savedDistanceKm} كم (${routeOptimizationResult.stats.savingsPercent}%)`,
      );
      setIsOptimizeModalOpen(false);
      onRefreshItinerary();
    } catch (err: any) {
      toast.error(err?.message || 'فشل حفظ الترتيب الأمثل');
    } finally {
      setIsOptimizingRoute(false);
    }
  };

  return {
    isOptimizeModalOpen,
    setIsOptimizeModalOpen,
    isOptimizingRoute,
    routeOptimizationResult,
    handleRunRouteOptimization,
    handleApplyOptimalRoute,
  };
}
