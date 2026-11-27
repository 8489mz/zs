// Van-itinerary root modals (C-modals) — pure move from VanItineraryTab.tsx (slice C-modals).
// Negative-visit + route-optimization StandardDialogs (own useTranslation each). The facade
// renders both inside the root div and passes the hook returns as props.

import React, {type Dispatch, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { MapPinIcon } from '@/shared/components/icons/AppIcons';
import type { RouteOptimizationResult, VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

type NegativeVisitReason = 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';

interface VanItineraryNegativeModalProps {
  negativeModalOpen: boolean;
  setNegativeModalOpen: Dispatch<SetStateAction<boolean>>;
  activeCustomer: VanCustomerItineraryItem | null;
  negativeReason: NegativeVisitReason;
  setNegativeReason: Dispatch<SetStateAction<NegativeVisitReason>>;
  postponedDate: string;
  setPostponedDate: Dispatch<SetStateAction<string>>;
  negativeNotes: string;
  setNegativeNotes: Dispatch<SetStateAction<string>>;
  isSubmitting: boolean;
  handleSubmitNegativeVisit: () => Promise<void>;
}

interface VanItineraryOptimizeModalProps {
  isOptimizeModalOpen: boolean;
  setIsOptimizeModalOpen: Dispatch<SetStateAction<boolean>>;
  isOptimizingRoute: boolean;
  routeOptimizationResult: RouteOptimizationResult | null;
  handleApplyOptimalRoute: () => Promise<void>;
}

export const VanItineraryNegativeModal: React.FC<VanItineraryNegativeModalProps> = ({
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
  handleSubmitNegativeVisit,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Negative Visit Dialog */}
      {negativeModalOpen && activeCustomer && (
        <StandardDialog
          open={true}
          onClose={() => setNegativeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s117', "تسجيل زيارة غير موفقة")}
          subtitle={`${activeCustomer.customerName} [${activeCustomer.customerCode.replace(/^#/, '')}]`}
          badge={t('delivery_reps.van_itinerary_tab.s118', "خط السير الميداني")}
          width="min(460px, 95vw)"
          compact={true}
          footerActions={
            <StandardDialogFooter
              onClose={() => setNegativeModalOpen(false)}
              cancelText={t('delivery_reps.van_itinerary_tab.s119', "إلغاء")}
              extraActions={
                <Button
                  variant="primary"
                  onClick={handleSubmitNegativeVisit}
                  disabled={isSubmitting}
                  style={{ backgroundColor: '#dc2626', color: '#ffffff', fontSize: '12px', fontWeight: 800, padding: '6px 14px' }}
                >
                  {isSubmitting ? t('delivery_reps.van_itinerary_tab.s120', "جاري الحفظ...") : t('delivery_reps.van_itinerary_tab.s121', "تأكيد وحفظ الزيارة السلبية")}
                </Button>
              }
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_itinerary_tab.s122', "حدد سبب عدم إتمام البيع (لمسة واحدة):")}
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px',
                }}
              >
                {[
                  { value: 'shop_closed', label: t('delivery_reps.van_itinerary_tab.s123', "المحل مغلق") },
                  { value: 'no_cash', label: t('delivery_reps.van_itinerary_tab.s124', "مفيش نقدية / رفض الدفع") },
                  { value: 'sufficient_stock', label: t('delivery_reps.van_itinerary_tab.s125', "لديه بضاعة كافية") },
                  { value: 'item_unavailable', label: t('delivery_reps.van_itinerary_tab.s126', "الصنف غير متوفر بالسيارة") },
                  { value: 'postponed', label: t('delivery_reps.van_itinerary_tab.s127', "تأجيل الزيارة لموعد لاحق") },
                  { value: 'other', label: t('delivery_reps.van_itinerary_tab.s128', "أسباب أخرى") },
                ].map((item) => {
                  const isSelected = negativeReason === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setNegativeReason(item.value as any)}
                      style={{
                        padding: '7px 8px',
                        borderRadius: '7px',
                        border: isSelected ? '1.5px solid #dc2626' : '1px solid #cbd5e1',
                        backgroundColor: isSelected ? '#fef2f2' : '#ffffff',
                        color: isSelected ? '#991b1b' : '#334155',
                        fontSize: '11.5px',
                        fontWeight: isSelected ? 800 : 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        textAlign: 'center',
                        lineHeight: 1.3,
                        minHeight: '36px',
                      }}
                    >
                      {isSelected && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#dc2626', display: 'inline-block' }} />
                      )}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {negativeReason === 'postponed' && (
              <div style={{ backgroundColor: '#eff6ff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#1e40af', marginBottom: '4px' }}>
                  {t('delivery_reps.van_itinerary_tab.s129', "تاريخ التأجيل المقترح:")}
                </label>
                <input
                  type="date"
                  value={postponedDate}
                  onChange={(e) => setPostponedDate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1.5px solid #93c5fd',
                    backgroundColor: '#ffffff',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('delivery_reps.van_itinerary_tab.s130', "ملاحظات المندوب الميدانية (اختياري):")}
              </label>
              <textarea
                value={negativeNotes}
                onChange={(e) => setNegativeNotes(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s131', "أية ملاحظات إضافية حول سبب الزيارة...")}
                rows={2}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '11.5px',
                  boxSizing: 'border-box',
                  resize: 'none',
                }}
              />
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '10.5px',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <MapPinIcon size={13} color="#0284c7" />
              <span>{t('delivery_reps.van_itinerary_tab.s132', "سيتم التقاط إحداثيات الموقع الجغرافي (GPS) تلقائياً لتوثيق وصول المندوب للمحل.")}</span>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
};

export const VanItineraryOptimizeModal: React.FC<VanItineraryOptimizeModalProps> = ({
  isOptimizeModalOpen,
  setIsOptimizeModalOpen,
  isOptimizingRoute,
  routeOptimizationResult,
  handleApplyOptimalRoute,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Dynamic Route Optimization (TSP) Modal */}
      {isOptimizeModalOpen && routeOptimizationResult && (
        <StandardDialog
          open={isOptimizeModalOpen}
          onClose={() => setIsOptimizeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s133', "تحسين المسار الجغرافي بأقصر طريق (TSP Route Optimization)")}
          subtitle={t('delivery_reps.van_itinerary_tab.s134', "محرك الذكاء المكاني لحساب أقصر مسار بين المحلات وتوفير استهلاك الوقود وزمن الرحلة")}
          width="680px"
          minHeight="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* KPI Stats Ribbon */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s135', "المسافة قبل التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#64748b' }}>
                  {routeOptimizationResult.stats.originalDistanceKm} {t('delivery_reps.van_itinerary_tab.s136', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s137', "المسافة بعد التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>
                  {routeOptimizationResult.stats.optimizedDistanceKm} {t('delivery_reps.van_itinerary_tab.s138', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s139', "التوفير في استهلاك الوقود")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1d4ed8' }}>
                  {routeOptimizationResult.stats.savedDistanceKm} {t('delivery_reps.van_itinerary_tab.s140', "كم (")}{routeOptimizationResult.stats.savingsPercent}%)
                </div>
              </div>
            </div>

            {/* Stops Preview List */}
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
              {t('delivery_reps.van_itinerary_tab.s141', "تسلسل المحطات المقترح (")}{routeOptimizationResult.orderedStops.length} {t('delivery_reps.van_itinerary_tab.s142', "محطة):")}
            </div>

            <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px' }}>
              {routeOptimizationResult.orderedStops.map((stop, sIdx) => (
                <div
                  key={stop.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: sIdx < routeOptimizationResult.orderedStops.length - 1 ? '1px solid #f1f5f9' : 'none',
                    backgroundColor: stop.isUnmappedGps ? '#fffbeb' : '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {stop.sequenceIndex}
                    </span>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{stop.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {stop.district ? `${stop.district} - ` : ''}{stop.address || t('delivery_reps.van_itinerary_tab.s143', "بدون عنوان تفصيلي")}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left', fontSize: '11.5px' }}>
                    {stop.isUnmappedGps ? (
                      <span style={{ color: '#d97706', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s144', "بدون GPS (في النهاية)")}</span>
                    ) : (
                      <span style={{ color: '#475569', fontWeight: 600 }}>
                        {sIdx === 0 ? t('delivery_reps.van_itinerary_tab.s145', "نقطة الانطلاق") : `+${(stop.legDistanceMeters / 1000).toFixed(1)} كم`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <StandardDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setIsOptimizeModalOpen(false)}>
                {t('delivery_reps.van_itinerary_tab.s146', "إلغاء")}
              </Button>
              <Button
                type="button"
                onClick={handleApplyOptimalRoute}
                disabled={isOptimizingRoute}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '13px',
                }}
              >
                {isOptimizingRoute ? t('delivery_reps.van_itinerary_tab.s147', "جاري الاعتماد...") : t('delivery_reps.van_itinerary_tab.s148', "اعتماد وحفظ المسار الأمثل")}
              </Button>
            </StandardDialogFooter>
          </div>
        </StandardDialog>
      )}
    </>
  );
};
