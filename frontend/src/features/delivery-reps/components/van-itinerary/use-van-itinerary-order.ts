import { useState } from 'react';
import { toast } from '@/shared/components/system-alert';

export function useVanItineraryOrder() {
  // Route Reordering Mode
  const [isReorderingMode, setIsReorderingMode] = useState(false);

  // Load saved itinerary ordering from localStorage
  const [customDistrictOrder, setCustomDistrictOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('zs_van_district_order');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [customCustomerOrder, setCustomCustomerOrder] = useState<Record<string, number[]>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('zs_van_customer_order');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const saveDistrictOrder = (newOrder: string[]) => {
    setCustomDistrictOrder(newOrder);
    try {
      localStorage.setItem('zs_van_district_order', JSON.stringify(newOrder));
    } catch {}
  };

  const saveCustomerOrder = (district: string, customerIds: number[]) => {
    const updated = { ...customCustomerOrder, [district]: customerIds };
    setCustomCustomerOrder(updated);
    try {
      localStorage.setItem('zs_van_customer_order', JSON.stringify(updated));
    } catch {}
  };

  const resetOrderToDefault = () => {
    setCustomDistrictOrder([]);
    setCustomCustomerOrder({});
    try {
      localStorage.removeItem('zs_van_district_order');
      localStorage.removeItem('zs_van_customer_order');
    } catch {}
    toast.info('تم استعادة الترتيب التلقائي لخط السير');
  };

  return {
    isReorderingMode,
    setIsReorderingMode,
    customDistrictOrder,
    customCustomerOrder,
    setCustomCustomerOrder,
    saveDistrictOrder,
    saveCustomerOrder,
    resetOrderToDefault,
  };
}
