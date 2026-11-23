import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { LoadingState } from '@/shared/ui/loading-state';

export interface ChinaSourcingQcTabProps {
  activeTab: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips';
  isQcLoading: boolean;
  qcInspections: any[];
  refetchQc: () => void;
}

export function ChinaSourcingQcTab({ activeTab, isQcLoading, qcInspections, refetchQc }: ChinaSourcingQcTabProps) {
  return (
    <>
    {/* 4. Tab: QC Inspections */}
    {activeTab === 'qc' && (
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            سجل فحوصات الجودة ومراحل التصنيع ({isQcLoading ? '…' : qcInspections.length})
          </h2>
          <button
            onClick={() => refetchQc()}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
          >
            <RefreshCwIcon size={13} />
            تحديث
          </button>
        </div>

        {isQcLoading ? (
          <LoadingState title="جاري تحميل تقارير الفحص..." />
        ) : qcInspections.length === 0 ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
            لا توجد تقارير فحص مسجلة حتى الآن.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>تاريخ الفحص</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>مرحلة الفحص</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المفتش / شركة الفحص</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>العينة المفحوصة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المقبول vs المرفوض</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>ملاحظات العيوب</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>القرار النهائي</th>
                </tr>
              </thead>
              <tbody>
                {qcInspections.map((q) => (
                  <tr key={q.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.inspection_date}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                      {q.stage === 'pre_shipment' ? 'قبل الشحن (Pre-Shipment)' : q.stage === 'during_production' ? 'أثناء الإنتاج (DUPRO)' : q.stage}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.inspector_name || 'مكتب فحص الصين'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.sample_size} قطعة</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px' }}>
                      <span style={{ color: '#059669', fontWeight: 700 }}>{q.passed_quantity} مطابق</span> | <span style={{ color: '#b91c1c', fontWeight: 700 }}>{q.failed_quantity} مرفوض</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748b' }}>{q.defect_notes || 'لا توجد ملاحظات حرجة'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor: q.status === 'passed' ? '#dcfce7' : q.status === 'conditional' ? '#fef3c7' : '#fee2e2',
                          color: q.status === 'passed' ? '#166534' : q.status === 'conditional' ? '#92400e' : '#991b1b',
                        }}
                      >
                        {q.status === 'passed' ? 'معتمد للشحن' : q.status === 'conditional' ? 'معتمد بشروط' : 'مرفوض'}
                      </span>
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
