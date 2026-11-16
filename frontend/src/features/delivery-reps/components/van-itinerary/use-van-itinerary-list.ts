// List hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-list).
// Owns the filtered list, district grouping, pagination, KPIs, and the reorder movers (D1:
// moveDistrict/moveCustomer move with H-list, NOT H-order — both read allDistrictGroups, and a
// no-params H-order hook cannot contain them (genuine cycle: H-list takes order state as params).
// customerMatchesDay is imported from the shared day slice (same as H-filters) — MERGE-OWNED:
// the shared slice must export it (it is a plain function there as generated); H-filters needs it too.

import { useMemo } from 'react';
import { toast } from '@/shared/components/system-alert';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';
import { customerMatchesDay } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';

interface UseVanItineraryListParams {
  itinerary: VanCustomerItineraryItem[];
  filters: {
    dayFilter: string;
    routeFilter: string;
    searchTerm: string;
    statusFilter: 'all' | 'pending' | 'positive' | 'negative';
    currentPage: number;
    pageSize: number;
    todayArabicName: string;
  };
  customDistrictOrder: string[];
  customCustomerOrder: Record<string, number[]>;
  saveDistrictOrder: (newOrder: string[]) => void;
  saveCustomerOrder: (district: string, customerIds: number[]) => void;
}

export function useVanItineraryList({ itinerary, filters, customDistrictOrder, customCustomerOrder, saveDistrictOrder, saveCustomerOrder }: UseVanItineraryListParams) {
  const { dayFilter, routeFilter, searchTerm, statusFilter, currentPage, pageSize, todayArabicName } = filters;

  const filtered = useMemo(() => {
    const rawSearch = searchTerm.trim().toLowerCase();
    const cleanSearch = rawSearch.replace(/^[c#]-?/, '');
    const isPureNumeric = cleanSearch.length > 0 && /^\d+$/.test(cleanSearch);
    const isExplicitCodeSearch = rawSearch.startsWith('c') || rawSearch.startsWith('#');

    const matched = itinerary.filter((item) => {
      // Day / schedule filter
      if (!customerMatchesDay(item, dayFilter, todayArabicName)) {
        return false;
      }

      if (statusFilter !== 'all' && item.visitStatus !== statusFilter) return false;
      if (routeFilter !== 'all' && item.route !== routeFilter) return false;
      if (!rawSearch) return true;

      const codeDigits = (item.customerCode || '').replace(/\D/g, '');

      // Explicit code prefix search (e.g. "c1", "c-1", "#1", "c-0001")
      if (isExplicitCodeSearch && isPureNumeric) {
        return codeDigits === cleanSearch || Number(codeDigits) === Number(cleanSearch);
      }

      // Normal multi-field search:
      const matchesCode =
        (item.customerCode || '').toLowerCase().includes(rawSearch) ||
        (isPureNumeric && (codeDigits === cleanSearch || Number(codeDigits) === Number(cleanSearch)));

      return (
        matchesCode ||
        item.customerName.toLowerCase().includes(rawSearch) ||
        item.customerPhone.includes(rawSearch) ||
        item.route.toLowerCase().includes(rawSearch) ||
        (item.district && item.district.toLowerCase().includes(rawSearch))
      );
    });

    // If searching by number (e.g. "1"), prioritize exact customer code matches to the very top!
    if (isPureNumeric) {
      return matched.sort((a, b) => {
        const aDigits = (a.customerCode || '').replace(/\D/g, '');
        const bDigits = (b.customerCode || '').replace(/\D/g, '');
        const aExact = aDigits === cleanSearch || Number(aDigits) === Number(cleanSearch);
        const bExact = bDigits === cleanSearch || Number(bDigits) === Number(cleanSearch);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return 0;
      });
    }

    return matched;
  }, [itinerary, dayFilter, todayArabicName, statusFilter, routeFilter, searchTerm]);

  // 1. Group ALL filtered items by District to establish canonical itinerary ordering
  const allDistrictGroups = useMemo(() => {
    const groupsMap = new Map<string, VanCustomerItineraryItem[]>();

    for (const item of filtered) {
      const dName = (item.district || item.route || 'حي عام / بدون تحديد').trim();
      if (!groupsMap.has(dName)) {
        groupsMap.set(dName, []);
      }
      groupsMap.get(dName)!.push(item);
    }

    const sortedDistrictNames = Array.from(groupsMap.keys()).sort((a, b) => {
      const idxA = customDistrictOrder.indexOf(a);
      const idxB = customDistrictOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b, 'ar');
    });

    return sortedDistrictNames.map((name) => {
      const items = groupsMap.get(name)!;
      const orderList = customCustomerOrder[name] || [];
      const sortedItems = [...items].sort((a, b) => {
        const idxA = orderList.indexOf(a.customerId);
        const idxB = orderList.indexOf(b.customerId);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.customerName.localeCompare(b.customerName, 'ar');
      });

      return {
        name,
        items: sortedItems,
        totalCount: sortedItems.length,
        visitedCount: sortedItems.filter((i) => i.visitStatus !== 'pending').length,
      };
    });
  }, [filtered, customDistrictOrder, customCustomerOrder]);

  // 2. Flatten ordered customers with their permanent global sequence number (1, 2, ... N)
  const allSortedCustomers = useMemo(() => {
    const list: Array<VanCustomerItineraryItem & { globalSeq: number }> = [];
    let seq = 1;
    for (const group of allDistrictGroups) {
      for (const item of group.items) {
        list.push({ ...item, globalSeq: seq++ });
      }
    }
    return list;
  }, [allDistrictGroups]);

  const totalPages = Math.ceil(allSortedCustomers.length / pageSize) || 1;
  const startIdx = (currentPage - 1) * pageSize;
  const paginatedItems = useMemo(() => {
    return allSortedCustomers.slice(startIdx, startIdx + pageSize);
  }, [allSortedCustomers, startIdx, pageSize]);

  // 3. Group ONLY the items of the current page (10 items) by District for lightning-fast mobile rendering
  const districtGroups = useMemo(() => {
    const groupsMap = new Map<string, Array<VanCustomerItineraryItem & { globalSeq: number }>>();

    for (const item of paginatedItems) {
      const dName = (item.district || item.route || 'حي عام / بدون تحديد').trim();
      if (!groupsMap.has(dName)) {
        groupsMap.set(dName, []);
      }
      groupsMap.get(dName)!.push(item);
    }

    const result: Array<{
      name: string;
      items: Array<VanCustomerItineraryItem & { globalSeq: number }>;
      totalCount: number;
      visitedCount: number;
    }> = [];

    for (const group of allDistrictGroups) {
      const pageItems = groupsMap.get(group.name);
      if (pageItems && pageItems.length > 0) {
        result.push({
          name: group.name,
          items: pageItems,
          totalCount: group.totalCount,
          visitedCount: group.visitedCount,
        });
      }
    }

    return result;
  }, [paginatedItems, allDistrictGroups]);

  const moveDistrict = (districtName: string, dir: 'up' | 'down') => {
    const currentOrder = allDistrictGroups.map((g) => g.name);
    const idx = currentOrder.indexOf(districtName);
    if (idx === -1) return;
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentOrder.length) return;
    const newOrder = [...currentOrder];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;
    saveDistrictOrder(newOrder);
    toast.success(`تم ${dir === 'up' ? 'تقديم' : 'تأخير'} ${districtName}`);
  };

  const moveCustomer = (districtName: string, customerId: number, dir: 'up' | 'down') => {
    const grp = allDistrictGroups.find((g) => g.name === districtName);
    if (!grp) return;
    const currentIds = grp.items.map((i) => i.customerId);
    const idx = currentIds.indexOf(customerId);
    if (idx === -1) return;
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentIds.length) return;
    const newIds = [...currentIds];
    const temp = newIds[idx];
    newIds[idx] = newIds[targetIdx];
    newIds[targetIdx] = temp;
    saveCustomerOrder(districtName, newIds);
  };

  // KPIs
  const total = itinerary.length;
  const positiveCount = itinerary.filter((i) => i.visitStatus === 'positive').length;
  const negativeCount = itinerary.filter((i) => i.visitStatus === 'negative').length;
  const pendingCount = total - positiveCount - negativeCount;

  return {
    filtered,
    allSortedCustomers,
    totalPages,
    startIdx,
    districtGroups,
    total,
    positiveCount,
    negativeCount,
    pendingCount,
    moveDistrict,
    moveCustomer,
  };
}
