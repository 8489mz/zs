// Negative-visit hook for the van itinerary tab — pure move from VanItineraryTab.tsx (slice H-negative).
// Owns the negative-visit modal state, openNegativeVisitModal, handleSubmitNegativeVisit and getReasonLabel.

import { useState } from 'react';
import {vanSalesApi, type VanCustomerItineraryItem} from '@/features/delivery-reps/api/van-sales.api';
import { toast } from '@/shared/components/system-alert';

interface UseVanItineraryNegativeVisitParams {
  tripId?: number;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  onEndVisit?: () => void;
  onRefreshItinerary: () => void;
}

export function useVanItineraryNegativeVisit({ tripId, activeVisit, onEndVisit, onRefreshItinerary }: UseVanItineraryNegativeVisitParams) {
  // Negative visit modal state
  const [negativeModalOpen, setNegativeModalOpen] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const [negativeReason, setNegativeReason] = useState<
    'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other'
  >('shop_closed');
  const [postponedDate, setPostponedDate] = useState('');
  const [negativeNotes, setNegativeNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openNegativeVisitModal = (customer: VanCustomerItineraryItem) => {
    setActiveCustomer(customer);
    setNegativeReason('shop_closed');
    setPostponedDate('');
    setNegativeNotes('');
    setNegativeModalOpen(true);
  };

  const handleSubmitNegativeVisit = async () => {
    if (!activeCustomer) return;
    if (!tripId) {
      toast.warning('يرجى بدء رحلة التوزيع أولاً لتسجيل الزيارات الميدانية');
      return;
    }

    if (negativeReason === 'postponed' && !postponedDate) {
      toast.warning('يرجى تحديد تاريخ تأجيل الزيارة');
      return;
    }

    setIsSubmitting(true);
    let lat: number | undefined;
    let lng: number | undefined;

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // GPS optional if timed out or rejected
      }
    }

    try {
      const res = await vanSalesApi.recordFieldVisit({
        tripId,
        customerId: activeCustomer.customerId,
        visitType: 'negative',
        negativeReason,
        postponedToDate: negativeReason === 'postponed' ? postponedDate : undefined,
        gpsLat: lat,
        gpsLng: lng,
        notes: negativeNotes.trim() || undefined,
      });

      if (res.consecutiveNegativeAlert) {
        toast.warning(
          `تنبيه: تكررت الزيارة السلبية للمرة الثالثة على التوالي للمحل (${activeCustomer.customerName}) - تم إشعار الإدارة تلقائياً`,
        );
      } else {
        toast.success(`تم تسجيل الزيارة السلبية للمحل: ${activeCustomer.customerName}`);
      }

      setNegativeModalOpen(false);
      if (activeVisit && activeVisit.customerId === activeCustomer.customerId) {
        onEndVisit?.();
      }
      onRefreshItinerary();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسجيل الزيارة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getReasonLabel = (reason?: string) => {
    switch (reason) {
      case 'no_cash':
        return 'مفيش نقدية / رفض الدفع';
      case 'shop_closed':
        return 'المحل مغلق';
      case 'sufficient_stock':
        return 'لديه بضاعة كافية';
      case 'item_unavailable':
        return 'الصنف المطلوب غير متوفر بالسيارة';
      case 'postponed':
        return 'تأجيل الزيارة';
      default:
        return 'أسباب أخرى';
    }
  };

  return {
    negativeModalOpen,
    setNegativeModalOpen,
    activeCustomer,
    negativeReason,
    setNegativeReason,
    postponedDate,
    setPostponedDate,
    negativeNotes,
    setNegativeNotes,
    isSubmitting,
    openNegativeVisitModal,
    handleSubmitNegativeVisit,
    getReasonLabel,
  };
}
