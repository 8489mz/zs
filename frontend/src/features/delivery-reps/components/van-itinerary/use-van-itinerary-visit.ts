// Visit hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-visit).
// Owns the selected customer for the hub, the live visit timer, and the elapsed-time helpers.
// NOTE: the timer ticks Date.now() once per second — elapsed-time DISPLAY, not a business timestamp (pure move).

import { useEffect, useState } from 'react';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

interface UseVanItineraryVisitParams {
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
}

export function useVanItineraryVisit({ activeVisit }: UseVanItineraryVisitParams) {
  // Selected customer for the unified hub modal
  const [selectedCustomerForHub, setSelectedCustomerForHub] = useState<VanCustomerItineraryItem | null>(null);

  // Live timer interval for active visit duration
  const [timerTick, setTimerTick] = useState(Date.now());
  useEffect(() => {
    if (!activeVisit) return;
    const interval = setInterval(() => setTimerTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeVisit]);

  const elapsedVisitSeconds = activeVisit
    ? Math.max(0, Math.floor((timerTick - activeVisit.startedAt) / 1000))
    : 0;

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return {
    selectedCustomerForHub,
    setSelectedCustomerForHub,
    elapsedVisitSeconds,
    formatElapsed,
  };
}
