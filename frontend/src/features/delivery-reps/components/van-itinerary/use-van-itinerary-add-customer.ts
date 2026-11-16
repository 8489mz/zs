// Add-customer hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-add).
// Owns the add-customer form state, the GPS capture handler, the add-modal-init effect,
// handleCreateCustomer, and (Option A) the filteredDistricts + filteredRoutes memos, which ref
// H-add form state while H-add refs H-filters returns — a mutual dep, TDZ either way, so they move here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi } from '@/features/delivery-reps/api/van-sales.api';
import { catalogApi } from '@/lib/api/catalog';

interface UseVanItineraryAddCustomerParams {
  todayArabicName: string;
  savedDistrictsList: string[];
  routes: string[];
  onRefreshItinerary: () => void;
}

export function useVanItineraryAddCustomer({ todayArabicName, savedDistrictsList, routes, onRefreshItinerary }: UseVanItineraryAddCustomerParams) {
  // Add Customer Modal State
  const [addCustomerModalOpen, setAddCustomerModalOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustDistrict, setNewCustDistrict] = useState('');
  const [newCustRoute, setNewCustRoute] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustGps, setNewCustGps] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [districtDropdownOpen, setDistrictDropdownOpen] = useState(false);
  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false);
  const [newCustVisitDays, setNewCustVisitDays] = useState<string[]>([]);
  const districtContainerRef = useRef<HTMLDivElement | null>(null);
  const routeContainerRef = useRef<HTMLDivElement | null>(null);

  // Close combobox dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (districtContainerRef.current && !districtContainerRef.current.contains(e.target as Node)) {
        setDistrictDropdownOpen(false);
      }
      if (routeContainerRef.current && !routeContainerRef.current.contains(e.target as Node)) {
        setRouteDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const filteredDistricts = useMemo(() => {
    if (!newCustDistrict.trim()) return savedDistrictsList;
    const q = newCustDistrict.trim().toLowerCase();
    return savedDistrictsList.filter((d) => d.toLowerCase().includes(q));
  }, [savedDistrictsList, newCustDistrict]);

  const handleCaptureGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.warning('خدمة تحديد المواقع (GPS) غير مدعومة في جهازك');
      return;
    }
    setIsLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocatingGps(false);
        setNewCustGps({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        toast.success('تم التقاط إحداثيات موقع المحل عبر GPS بنجاح');
      },
      () => {
        setIsLocatingGps(false);
        toast.warning('تعذر تحديد الموقع، يرجى تفعيل الـ GPS في الهاتف');
      },
      { timeout: 5000, enableHighAccuracy: true }
    );
  };

  const filteredRoutes = useMemo(() => {
    if (!newCustRoute.trim()) return routes;
    const q = newCustRoute.trim().toLowerCase();
    return routes.filter((r) => r.toLowerCase().includes(q));
  }, [routes, newCustRoute]);

  // Default to today's visit day and current trip route when opening the modal
  useEffect(() => {
    if (addCustomerModalOpen) {
      if (newCustVisitDays.length === 0) {
        setNewCustVisitDays([todayArabicName]);
      }
      if (!newCustRoute.trim() && routes.length > 0) {
        setNewCustRoute(routes[0]);
      }
    }
  }, [addCustomerModalOpen, todayArabicName, newCustVisitDays.length, newCustRoute, routes]);

  const handleCreateCustomer = async () => {
    if (!newCustName.trim()) {
      toast.warning('يرجى كتابة اسم المحل / العميل');
      return;
    }
    setIsCreatingCustomer(true);
    try {
      const districtVal = newCustDistrict.trim() || undefined;
      const routeVal = newCustRoute.trim() || undefined;
      const addressVal = newCustAddress.trim() || districtVal;
      const locationUrl = newCustGps
        ? `https://maps.google.com/?q=${newCustGps.lat},${newCustGps.lng}`
        : undefined;

      const visitDaysVal = newCustVisitDays.length > 0 ? newCustVisitDays : [todayArabicName];
      const customerPayload = {
        name: newCustName.trim(),
        phone: newCustPhone.trim() || undefined,
        district: districtVal,
        route: routeVal,
        address: addressVal,
        visitDays: visitDaysVal,
        metadata: {
          district: districtVal,
          route: routeVal,
          visit_days: visitDaysVal,
          visit_day: visitDaysVal[0] || '',
          gpsLat: newCustGps?.lat,
          gpsLng: newCustGps?.lng,
          locationUrl,
        },
      };

      let createRes: any = null;
      try {
        createRes = await vanSalesApi.createCustomer(customerPayload);
      } catch (vanErr: any) {
        // Fallback to standard catalog API if in web session
        await catalogApi.createCustomer({
          name: newCustName.trim(),
          phone: newCustPhone.trim() || undefined,
          type: 'cash',
          creditLimit: 0,
          balance: 0,
          address: addressVal,
          metadata: customerPayload.metadata,
        });
      }

      if (districtVal && typeof window !== 'undefined') {
        try {
          const saved: string[] = JSON.parse(localStorage.getItem('zs_van_saved_districts') || '[]');
          if (!saved.includes(districtVal)) {
            localStorage.setItem('zs_van_saved_districts', JSON.stringify([...saved, districtVal].slice(-50)));
          }
        } catch {}
      }

      if (createRes?.alreadyExisted) {
        toast.info(createRes.message || `المحل مسجل مسبقاً وتم ربطه بخط سيرك بنجاح`);
      } else {
        toast.success(`تم إضافة المحل (${newCustName.trim()}) لخط السير بنجاح`);
      }
      setAddCustomerModalOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustDistrict('');
      setNewCustRoute('');
      setNewCustAddress('');
      setNewCustGps(null);
      setNewCustVisitDays([todayArabicName]);
      setDistrictDropdownOpen(false);
      setRouteDropdownOpen(false);
      onRefreshItinerary();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إضافة العميل');
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  return {
    addCustomerModalOpen,
    setAddCustomerModalOpen,
    newCustName,
    setNewCustName,
    newCustPhone,
    setNewCustPhone,
    newCustDistrict,
    setNewCustDistrict,
    newCustRoute,
    setNewCustRoute,
    newCustAddress,
    setNewCustAddress,
    newCustGps,
    isLocatingGps,
    isCreatingCustomer,
    districtDropdownOpen,
    setDistrictDropdownOpen,
    routeDropdownOpen,
    setRouteDropdownOpen,
    newCustVisitDays,
    setNewCustVisitDays,
    districtContainerRef,
    routeContainerRef,
    handleCaptureGps,
    handleCreateCustomer,
    filteredDistricts,
    filteredRoutes,
  };
}
