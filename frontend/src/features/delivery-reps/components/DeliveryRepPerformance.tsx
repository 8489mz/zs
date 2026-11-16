import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { StarIcon } from '@/shared/components/icons/AppIcons';
import { deliveryRepsApi } from '../api/delivery-reps.api';

function formatDuration(totalMins: number) {
  if (totalMins <= 0) return 'فوري (أقل من دقيقة)';
  if (totalMins < 60) return `${totalMins} دقيقة`;
  const hrs = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;
  if (remainingMins === 0) return `${hrs} ساعة`;
  return `${hrs} ساعة و ${remainingMins} دقيقة`;
}

export function DeliveryRepPerformance({ repId }: { repId: number | null }) {
  const { t } = useTranslation();
  const kpiQuery = useQuery({
    queryKey: ['delivery-rep-kpis', repId],
    queryFn: () => deliveryRepsApi.getKPIs(repId!),
    enabled: !!repId,
  });

  // INV-VAN-PROFIT-REP-REPORTING: unified lifetime report — today's
  // sales, the current target and the lifetime totals in one response.
  const lifetimeQuery = useQuery({
    queryKey: ['delivery-rep-lifetime', repId],
    queryFn: () => deliveryRepsApi.getLifetimeReport(repId!),
    enabled: !!repId,
  });

  const repsQuery = useQuery({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
  });
  const currentRep = repsQuery.data?.find(r => r.id === repId);

  if (!repId) return null;

  if (kpiQuery.isLoading) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>{t('delivery_reps.delivery_rep_performance.s0', "جاري تحميل لوحة الأداء...")}</div>;
  }

  const kpis = kpiQuery.data;
  if (!kpis) return null;

  const renderStars = (rating: number) => {
    if (kpis.successfulOrders === 0 && kpis.returnedOrders === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', height: '36px' }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#94a3b8', background: '#f1f5f9', padding: '4px 12px', borderRadius: '16px' }}>{t('delivery_reps.delivery_rep_performance.s1', "لم يُقيّم بعد")}</span>
        </div>
      );
    }

    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return (
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {[...Array(fullStars)].map((_, i) => (
          <StarIcon key={`f-${i}`} size={22} color="#eab308" fill="#eab308" />
        ))}
        {hasHalfStar && (
          <span style={{ position: 'relative', display: 'inline-block', width: 22, height: 22 }}>
            <StarIcon size={22} color="#cbd5e1" fill="#cbd5e1" />
            <span style={{ position: 'absolute', top: 0, right: 0, width: '50%', overflow: 'hidden', height: '100%' }}>
              <StarIcon size={22} color="#eab308" fill="#eab308" />
            </span>
          </span>
        )}
        {[...Array(emptyStars)].map((_, i) => (
          <StarIcon key={`e-${i}`} size={22} color="#cbd5e1" fill="#cbd5e1" />
        ))}
        <span style={{ marginInlineStart: '8px', fontWeight: 'bold', fontSize: '18px', color: '#334155' }}>{rating}/5</span>
      </div>
    );
  };

  const totalMinutes = kpis.averageDelayMins !== undefined ? kpis.averageDelayMins : Math.round((kpis.averageDelayHours || 0) * 60);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div 
        style={{ 
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)', 
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #cbd5e1', 
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: '8px' 
        }}
      >
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '15px', fontWeight: 800 }}>{t('delivery_reps.delivery_rep_performance.s2', "التقييم العام للمندوب")}</h3>
        {renderStars(kpis.rating)}
        <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>
          {t('delivery_reps.delivery_rep_performance.s3', "يتم احتساب التقييم بناءً على سرعة التوريد المالي ومعدلات المرتجعات تلقائياً.")}
        </p>
      </div>

      {/* Rep Identity & Guarantee Card */}
      {(currentRep?.full_name || currentRep?.national_id || currentRep?.address || currentRep?.vehicle_plate) && (
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)' }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.delivery_rep_performance.s4', "بيانات التوثيق والضمان الرسمية للمندوب")}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '12px' }}>
            {currentRep.full_name && (
              <div>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s5', "الاسم بالكامل (من البطاقة):")}</span>
                <strong style={{ color: '#0f172a' }}>{currentRep.full_name}</strong>
              </div>
            )}
            {currentRep.national_id && (
              <div>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s6', "الرقم القومي:")}</span>
                <strong style={{ color: '#0f172a', direction: 'ltr', display: 'inline-block' }}>{currentRep.national_id}</strong>
              </div>
            )}
            {currentRep.vehicle_plate && (
              <div>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s7', "لوحة المركبة / المكنة:")}</span>
                <strong style={{ color: '#0f172a' }}>{currentRep.vehicle_plate}</strong>
              </div>
            )}
            {currentRep.address && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s8', "محل الإقامة / العنوان:")}</span>
                <span style={{ color: '#334155', fontWeight: 600 }}>{currentRep.address}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className="delivery-rep-kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
        }}
      >
        {/* Card 1: Total Orders */}
        <div className="delivery-rep-kpi-card" style={{ padding: '16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 700 }}>{t('delivery_reps.delivery_rep_performance.s9', "إجمالي الطلبات المسندة")}</span>
          <span style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>{kpis.totalOrders}</span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.delivery_rep_performance.s10', "إجمالي رحلات التوصيل")}</span>
        </div>
        
        {/* Card 2: Success Rate */}
        <div className="delivery-rep-kpi-card" style={{ padding: '16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 700 }}>{t('delivery_reps.delivery_rep_performance.s11', "معدل التوصيل الناجح")}</span>
          <span style={{ fontSize: '24px', fontWeight: 800, color: kpis.successRate >= 90 ? '#15803d' : kpis.successRate >= 75 ? '#d97706' : '#dc2626' }}>
            {kpis.successRate}%
          </span>
          <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600, background: '#f0fdf4', padding: '1px 6px', borderRadius: '4px', alignSelf: 'flex-start', border: '1px solid #bbf7d0' }}>
            {kpis.successfulOrders} {t('delivery_reps.delivery_rep_performance.s12', "طلب ناجح")}
          </span>
        </div>

        {/* Card 3: Returns */}
        <div className="delivery-rep-kpi-card" style={{ padding: '16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 700 }}>{t('delivery_reps.delivery_rep_performance.s13', "معدل المرتجعات")}</span>
          <span style={{ fontSize: '24px', fontWeight: 800, color: kpis.returnedOrders === 0 ? '#15803d' : '#dc2626' }}>
            {kpis.returnedOrders} <span style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>{t('delivery_reps.delivery_rep_performance.s14', "طلب")}</span>
          </span>
          <span style={{ fontSize: '11px', color: kpis.returnedOrders === 0 ? '#15803d' : '#dc2626' }}>
            {kpis.returnedOrders === 0 ? t('delivery_reps.delivery_rep_performance.s15', "سجل نظيف بدون مرتجعات") : t('delivery_reps.delivery_rep_performance.s16', "يحتاج مراجعة مع المندوب")}
          </span>
        </div>

        {/* Card 4: Average Delay */}
        <div className="delivery-rep-kpi-card" style={{ padding: '16px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 700 }}>{t('delivery_reps.delivery_rep_performance.s17', "متوسط سرعة التوريد")}</span>
          <span style={{ fontSize: '20px', fontWeight: 800, color: (kpis.averageDelayHours || 0) < 1 ? '#15803d' : (kpis.averageDelayHours || 0) < 24 ? '#ea580c' : '#dc2626' }}>
            {formatDuration(totalMinutes)}
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.delivery_rep_performance.s18', "متوسط وقت التوريد لكل طلب")}</span>
        </div>
      </div>

      {/* INV-VAN-PROFIT-REP-REPORTING: lifetime report — today, target, lifetime totals */}
      {lifetimeQuery.data && (
        <div style={{ background: '#ffffff', padding: '16px', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.delivery_rep_performance.s19', "تقرير المندوب الشامل (من أول يوم)")}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', fontSize: '12px' }}>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s20', "مبيعات اليوم")}</span>
              <strong style={{ color: '#0f172a', fontSize: '16px' }}>{Number(lifetimeQuery.data.today.salesTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{lifetimeQuery.data.today.salesCount} {t('delivery_reps.delivery_rep_performance.s21', "فاتورة")}</span>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s22', "إجمالي المبيعات (من أول يوم)")}</span>
              <strong style={{ color: '#0f172a', fontSize: '16px' }}>{Number(lifetimeQuery.data.lifetime.salesTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{lifetimeQuery.data.lifetime.salesCount} {t('delivery_reps.delivery_rep_performance.s21', "فاتورة")}</span>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s23', "إجمالي التحصيلات")}</span>
              <strong style={{ color: '#0f172a', fontSize: '16px' }}>{Number(lifetimeQuery.data.lifetime.collectionsTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s24', "إجمالي الخصومات")}</span>
              <strong style={{ color: '#0f172a', fontSize: '16px' }}>{Number(lifetimeQuery.data.lifetime.discountsTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{lifetimeQuery.data.lifetime.discountedInvoicesCount} {t('delivery_reps.delivery_rep_performance.s25', "فاتورة مخصومة")}</span>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('delivery_reps.delivery_rep_performance.s26', "المستحق حسب اليوم (من أول يوم)")}</span>
              <strong style={{ color: lifetimeQuery.data.totalDue > 0 ? '#dc2626' : '#15803d', fontSize: '16px' }}>{Number(lifetimeQuery.data.totalDue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
          </div>
          {lifetimeQuery.data.currentTarget && (
            <div>
              <span style={{ color: '#64748b', fontSize: '11px' }}>
                {t('delivery_reps.delivery_rep_performance.s27', "هدف الشهر الحالي:")} {Number(lifetimeQuery.data.currentTarget.actualSalesMtd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} / {Number(lifetimeQuery.data.currentTarget.targetAmount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
              <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden', marginTop: '4px' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${lifetimeQuery.data.currentTarget.targetAmount > 0 ? Math.min(100, (Number(lifetimeQuery.data.currentTarget.actualSalesMtd || 0) / Number(lifetimeQuery.data.currentTarget.targetAmount)) * 100) : 0}%`,
                    background: '#170e5e',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
