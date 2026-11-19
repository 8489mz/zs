import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';

export interface CloseProjectDialogProps {
  closingProject: any | null;
  closingNotes: string;
  selectedApprovalId: string;
  approvalRequests: any[];
  setClosingProject: Dispatch<SetStateAction<any | null>>;
  setSelectedApprovalId: Dispatch<SetStateAction<string>>;
  setClosingNotes: Dispatch<SetStateAction<string>>;
  handleCloseProject: (e: FormEvent) => void;
  handleRequestClosureApproval: () => void;
  createApprovalMutation: { isPending: boolean };
  closeProjectMutation: { isPending: boolean };
}

export function CloseProjectDialog(props: CloseProjectDialogProps) {
  const {
    closingProject,
    closingNotes,
    selectedApprovalId,
    approvalRequests,
    setClosingProject,
    setSelectedApprovalId,
    setClosingNotes,
    handleCloseProject,
    handleRequestClosureApproval,
    createApprovalMutation,
    closeProjectMutation,
  } = props;

  return (
    <>
      {closingProject && (
        <StandardDialog
          open={!!closingProject}
          onClose={() => setClosingProject(null)}
          title={`إقفال حسابات مشروع الاستيراد: ${closingProject.project_no}`}
          subtitle="احتساب صافي الأرباح المحققة فعلياً من بيع دفعات المشروع وتوزيع أنصبة الشركاء"
          width="580px"
          compact
        >
          <form onSubmit={handleCloseProject} dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', fontSize: '12.5px' }}>
              <div><strong>اسم المشروع:</strong> {closingProject.title}</div>
              <div style={{ marginTop: 4, color: '#475569' }}>
                يتطلب إقفال المشروع موافقة رقابية ثنائية معتمدة (Maker-Checker) وعدم وجود شحنات معلقة أو عهد مخلصين غير مصفاة أو تأمينات حاويات غير مستردة.
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  طلب الاعتماد الرقابي المعتمد (Maker-Checker) *
                </label>
                <button
                  type="button"
                  onClick={handleRequestClosureApproval}
                  disabled={createApprovalMutation.isPending}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  + رفع طلب اعتماد إقفال للمدير الآن
                </button>
              </div>
              <select
                value={selectedApprovalId}
                onChange={(e) => setSelectedApprovalId(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', marginBottom: 6 }}
              >
                <option value="">-- اختر موافقة معتمدة أو أدخل المعرف بالأسفل --</option>
                {approvalRequests
                  .filter(
                    (r: any) =>
                      (r.action_type === 'project_closure' || r.request_type === 'project_closure') &&
                      r.reference_id === closingProject.id
                  )
                  .map((r: any) => (
                    <option key={r.id} value={r.id}>
                      #{String(r.id).slice(0, 8)} - الحالة: {r.status === 'approved' ? 'معتمد' : r.status === 'pending' ? 'قيد المراجعة' : 'مرفوض'}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                required
                value={selectedApprovalId}
                onChange={(e) => setSelectedApprovalId(e.target.value)}
                placeholder="معرف طلب الموافقة المعتمد (UUID)"
                style={{ width: '100%', height: 34, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px', fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                ملاحظات الإقفال والتسوية الختامية
              </label>
              <textarea
                rows={2}
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="مثال: تمت مطابقة كافة الفواتير وإيصالات التخليص واسترداد تأمينات الحاويات بالكامل..."
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setClosingProject(null)}
                style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={closeProjectMutation.isPending}
                style={{ padding: '8px 18px', backgroundColor: '#170e5e', color: '#ffffff', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
              >
                {closeProjectMutation.isPending ? 'جاري الإقفال...' : 'تأكيد إقفال المشروع وتوزيع الأرباح'}
              </button>
            </div>
          </form>
        </StandardDialog>
      )}
    </>
  );
}
