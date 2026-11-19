import type { Dispatch, SetStateAction } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { PlusCircleIcon, RefreshCwIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import { LoadingState } from '@/shared/ui/loading-state';
import { getImportProjectStatusLabel } from '../utils/import-display-formatters';

export interface ImportProjectsTableProps {
  projects: any[];
  approvalRequests: any[];
  isProjectsLoading: boolean;
  refetch: () => void;
  commRate: number;
  setIsNewProjectOpen: Dispatch<SetStateAction<boolean>>;
  setIsFeasibilityOpen: Dispatch<SetStateAction<boolean>>;
  handleOpenProjectFeasibility: (p: any) => void;
  setClosingProject: Dispatch<SetStateAction<any>>;
  setSelectedApprovalId: Dispatch<SetStateAction<string>>;
  setClosingNotes: Dispatch<SetStateAction<string>>;
}

export function ImportProjectsTable({
  projects,
  approvalRequests,
  isProjectsLoading,
  refetch,
  commRate,
  setIsNewProjectOpen,
  setIsFeasibilityOpen,
  handleOpenProjectFeasibility,
  setClosingProject,
  setSelectedApprovalId,
  setClosingNotes,
}: ImportProjectsTableProps) {
  return (
    <>
        <PageHeader
          title="مشاريع الاستيراد ودراسات الجدوى"
          description="إدارة فرص الصفقات التجارية من لحظة دراسة الجدوى ونقطة التعادل حتى التعاقد والشحن والإقفال."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsNewProjectOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>إنشاء مشروع استيراد جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsFeasibilityOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#170e5e',
                }}
              >
                <SlidersIcon size={14} />
                <span>محرك دراسة الجدوى والسيناريوهات</span>
              </Button>
            </div>
          }
        />

      {/* 2. Projects Table Card */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            قائمة مشاريع وصفقات الاستيراد ({isProjectsLoading ? '…' : projects.length})
          </h2>
          <button
            onClick={() => refetch()}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
          >
            <RefreshCwIcon size={13} />
            تحديث
          </button>
        </div>

        {isProjectsLoading ? (
          <LoadingState title="جاري تحميل مشاريع الاستيراد..." />
        ) : projects.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
              لا توجد مشاريع استيراد مسجلة
            </div>
            <div style={{ fontSize: '12px' }}>
              ابدأ بإنشاء دراسة جدوى مبدئية أو مشروع استيراد جديد لتنظيم التعاقد والشحن
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>رقم المشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>اسم الصفقة والمشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>بلد الشراء والوجهة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الميزانية المرصودة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>العائد المستهدف (ROI)</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الحاويات المرتبطة</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>حالة المشروع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#170e5e' }}>
                      {p.project_no}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      {p.title}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                      {p.country_origin} &larr; {p.country_destination}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                      {p.budget_currency === 'EGP' ? (
                        <div>
                          <span>{Number(p.allocated_capital || 0).toLocaleString()} ج.م</span>
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                            (~${Math.round(Number(p.allocated_capital || 0) / (commRate || 50)).toLocaleString()})
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span>${Number(p.allocated_capital || 0).toLocaleString()}</span>
                          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>
                            (~{(Number(p.allocated_capital || 0) * (commRate || 50)).toLocaleString()} ج.م)
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#059669' }}>
                      {p.target_roi_percentage}%
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                      {p.shipmentCount || 0} حاوية
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor:
                            p.status === 'closed'
                              ? '#f1f5f9'
                              : p.status === 'warehousing' || p.status === 'selling'
                              ? '#dcfce7'
                              : '#e0e7ff',
                          color:
                            p.status === 'closed'
                              ? '#64748b'
                              : p.status === 'warehousing' || p.status === 'selling'
                              ? '#166534'
                              : '#3730a3',
                        }}
                      >
                        {getImportProjectStatusLabel(p.status)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenProjectFeasibility(p)}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 6,
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#166534',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="عرض وتحرير دراسة الجدوى والسيناريوهات لهذا المشروع"
                        >
                          <SlidersIcon size={12} />
                          <span>دراسة الجدوى</span>
                        </button>
                        {p.status !== 'closed' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setClosingProject(p);
                              const matchingApproved = approvalRequests.find(
                                (r: any) =>
                                  (r.action_type === 'project_closure' || r.request_type === 'project_closure') &&
                                  r.reference_id === p.id &&
                                  r.status === 'approved'
                              );
                              setSelectedApprovalId(matchingApproved?.id || '');
                              setClosingNotes('');
                            }}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#170e5e',
                              cursor: 'pointer',
                            }}
                          >
                            إقفال وتصفية الأرباح
                          </button>
                        ) : (
                          <span style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: 700 }}>مقفل وموزع</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
