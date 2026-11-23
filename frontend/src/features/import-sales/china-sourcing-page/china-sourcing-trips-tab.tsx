import { PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import { LoadingState } from '@/shared/ui/loading-state';

export interface ChinaSourcingTripsTabProps {
  activeTab: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips';
  isTripsLoading: boolean;
  sourcingTrips: any[];
  setIsTripModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ChinaSourcingTripsTab({ activeTab, isTripsLoading, sourcingTrips, setIsTripModalOpen }: ChinaSourcingTripsTabProps) {
  return (
    <>
    {activeTab === 'trips' && (
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            سجل رحلات وزيارات المصانع بالصين ({isTripsLoading ? '…' : sourcingTrips.length})
          </h2>
          <button
            onClick={() => setIsTripModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 8,
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <PlusCircleIcon size={15} />
            تسجيل رحلة مصانع جديدة
          </button>
        </div>

        {isTripsLoading ? (
          <LoadingState title="جاري تحميل رحلات المصانع..." />
        ) : sourcingTrips.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b', fontSize: '13px' }}>
            لا توجد رحلات مصانع مسجلة حالياً. قم بتسجيل زيارات المعارض والمصانع لتوثيق المصاريف والنتائج.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>عنوان الرحلة / المعرض</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الوجهة والمدن</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>تاريخ البدء والانتهاء</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الميزانية المقدرة</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>المصروف الفعلي</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>حالة الترحيل</th>
                  <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الملاحظات والأهداف</th>
                </tr>
              </thead>
              <tbody>
                {sourcingTrips.map((t: any) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{t.trip_title || t.title}</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569' }}>{t.destination_city || t.destination}</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
                      {t.start_date ? String(t.start_date).slice(0, 10) : '—'} إلى {t.end_date ? String(t.end_date).slice(0, 10) : 'مستمر'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{Number(t.budget_egp || 0).toLocaleString()} ج.م</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{Number(t.actual_cost_egp ?? t.actual_expenses_egp ?? 0).toLocaleString()} ج.م</td>
                    <td style={{ padding: '10px 12px', fontSize: '11.5px' }}>
                      {t.journal_entry_id ? (
                        <span style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>مرحل بقيد محاسبي</span>
                      ) : (
                        <span style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>تقدير غير مرحل — مستبعد من التقارير المالية</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569' }}>
                      {t.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
    </>
  );
}
