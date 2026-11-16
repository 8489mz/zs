// Filters hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-filters).
// Owns filter/search/pagination state, the saved-districts + routes memos, and the day helpers.
// NOTE: todayArabicName falls back to new Date().getDay() when the server-provided currentDayName is absent —
// device-clock dependency for a business-relevant value, recorded hole, pure move, NOT fixed (the clock package owns the fix).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';
import { customerMatchesDay } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';

interface UseVanItineraryFiltersParams {
  itinerary: VanCustomerItineraryItem[];
}

export function useVanItineraryFilters({ itinerary }: UseVanItineraryFiltersParams) {
  const [searchTerm, setSearchTerm] = useState('');
  const [routeFilter, setRouteFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'positive' | 'negative'>('all');
  const [dayFilter, setDayFilter] = useState<'today' | 'all' | string>('today');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zs_van_itinerary_page_size');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if ([10, 15, 20, 25, 50, 100].includes(parsed)) return parsed;
      }
    }
    return 15;
  });

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    if (typeof window !== 'undefined') {
      localStorage.setItem('zs_van_itinerary_page_size', String(size));
    }
  };

  // Memory list of saved districts
  const savedDistrictsList = useMemo(() => {
    const set = new Set<string>();
    // From itinerary
    itinerary.forEach((it) => {
      if (it.district) set.add(it.district.trim());
      else if (it.route) set.add(it.route.trim());
    });
    // From localStorage
    if (typeof window !== 'undefined') {
      try {
        const localDistricts: string[] = JSON.parse(localStorage.getItem('zs_van_saved_districts') || '[]');
        localDistricts.forEach((d) => set.add(d.trim()));
      } catch {}
    }
    return Array.from(set).filter(Boolean);
  }, [itinerary]);

  const arabicDayNames = useMemo(() => ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], []);
  const todayArabicName = useMemo(() => {
    return itinerary[0]?.currentDayName || arabicDayNames[new Date().getDay()];
  }, [itinerary, arabicDayNames]);

  const todayCount = useMemo(() => {
    return itinerary.filter((i) => customerMatchesDay(i, 'today', todayArabicName)).length;
  }, [itinerary, todayArabicName]);

  const [dayDropdownOpen, setDayDropdownOpen] = useState(false);
  const dayDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dayDropdownRef.current && !dayDropdownRef.current.contains(e.target as Node)) {
        setDayDropdownOpen(false);
      }
    };
    if (dayDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [dayDropdownOpen]);

  // Reset pagination to first page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, routeFilter, statusFilter, dayFilter]);

  // Extract unique routes
  const routes = useMemo(() => {
    return Array.from(new Set(itinerary.map((i) => i.route).filter(Boolean)));
  }, [itinerary]);

  return {
    searchTerm,
    setSearchTerm,
    routeFilter,
    setRouteFilter,
    statusFilter,
    setStatusFilter,
    dayFilter,
    setDayFilter,
    currentPage,
    setCurrentPage,
    pageSize,
    handlePageSizeChange,
    savedDistrictsList,
    arabicDayNames,
    todayArabicName,
    todayCount,
    dayDropdownOpen,
    setDayDropdownOpen,
    dayDropdownRef,
    routes,
  };
}
