import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useProfitReportQuery,
  useProjectProfitAttributionQuery,
  usePartnerPayoutMutation,
  useApprovalRequestsQuery,
  useCreateApprovalRequestMutation,
  useCloseProjectMutation,
  useImportProjectsQuery,
  Partner,
} from './api/shipments.api';
import { formatCurrency } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { ManagePartnersDialog } from './ManagePartnersDialog';
import { PartnerLedgerDialog } from './PartnerLedgerComponents';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { UsersIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { toast } from '@/shared/components/system-alert';

function PartnerPayoutModal({ 
  partner, 
  open, 
  onClose 
}: { 
  partner: { partnerId: string; name: string; shareAmount: number; withdrawnProfit: number; currentBalance: number; percentage: number; capital_amount?: number } | null;
  open: boolean; 
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [approvalRequestId, setApprovalRequestId] = useState('');
  // INV-IMPORT-TRACEABILITY-APPROVALS-POOL: the approval a distribution
  // consumes must be a REAL approved one. The old code stuffed the
  // just-created PENDING id into the consumable field, but
  // verifyAndConsumeApprovalRequest rejects any non-approved status —
  // so the fresh id could never pay, and the trial saw a UUID field
  // with no approval behind it. A raised request is now tracked
  // separately as "awaiting manager approval" and is never placed in
  // the consumable field; the select offers APPROVED approvals only,
  // and picking one locks the project to the approval's project so
  // the payout can never bind to a different project than shown.
  const [raisedApprovalId, setRaisedApprovalId] = useState('');
  const payoutMutation = usePartnerPayoutMutation();
  const { data: projectsData } = useImportProjectsQuery();
  const projects = Array.isArray(projectsData) ? projectsData : (projectsData as any)?.rows || (projectsData as any)?.items || [];
  const { data: approvalRequests = [], refetch: refetchApprovals } = useApprovalRequestsQuery();
  const createApprovalMutation = useCreateApprovalRequestMutation();

  if (!partner) return null;

  const partnerApprovals = approvalRequests.filter(
    (r: any) =>
      (r.action_type === 'partner_distribution' || r.request_type === 'partner_distribution') &&
      String(r.reference_id) === String(partner.partnerId) &&
      r.status === 'approved'
  );

  const approvalProjectId = (r: any): string => {
    try {
      const p = typeof r.request_payload === 'string' ? JSON.parse(r.request_payload || '{}') : (r.request_payload || {});
      return String(p.projectId || '');
    } catch {
      return '';
    }
  };

  const handleSelectApproval = (id: string) => {
    setApprovalRequestId(id);
    if (id) {
      const chosen = partnerApprovals.find((r: any) => String(r.id) === String(id));
      const pid = chosen ? approvalProjectId(chosen) : '';
      if (pid) setSelectedProjectId(pid);
      setRaisedApprovalId('');
    }
  };

  const handleRequestApproval = async () => {
    const val = Number(amount) || Number(partner.currentBalance) || 0;
    if (val <= 0) {
      toast.error('يرجى تحديد قيمة الدفعة المطلوب اعتمادها أولاً');
      return;
    }
    const projId = selectedProjectId || projects[0]?.id || '';
    if (!projId) {
      toast.error('يرجى اختيار مشروع الاستيراد المرتبط بتوزيع الأرباح');
      return;
    }
    try {
      const created = await createApprovalMutation.mutateAsync({
        actionType: 'partner_distribution',
        referenceId: String(partner.partnerId),
        requestPayload: {
          amount: val,
          partnerId: String(partner.partnerId),
          projectId: projId,
          justification: `طلب اعتماد صرف دفعة أرباح للشريك ${partner.name}`,
        },
      });
      // Pending, not consumable: record it as awaiting approval and
      // leave the payout field empty until a manager approves it.
      if (created?.id) setRaisedApprovalId(String(created.id));
      setSelectedProjectId(projId);
      toast.success('تم رفع طلب اعتماد صرف الأرباح للرقابة الثنائية (Maker-Checker) — بانتظار اعتماد المدير قبل الصرف');
      refetchApprovals();
    } catch (err: any) {
      toast.error('فشل رفع طلب الاعتماد: ' + (err.message || 'خطأ'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(amount);
    if (!val || val <= 0) return;
    if (!approvalRequestId.trim()) return;
    await payoutMutation.mutateAsync({
      partnerId: partner.partnerId,
      amount: val,
      approvalRequestId: approvalRequestId.trim(),
      projectId: selectedProjectId || undefined,
    });
    setAmount('');
    setApprovalRequestId('');
    setRaisedApprovalId('');
    onClose();
  };

  const handleFillMax = () => {
    if (partner.currentBalance > 0) {
      setAmount(String(partner.currentBalance));
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`صرف دفعة أرباح: ${partner.name}`}
      subtitle={t('import_sales.profit_pool.s0', "تسجيل صرف دفعة نقدية من صافي الأرباح المستحقة للشريك وخصمها من رصيده المتبقي.")}
      width="min(520px, 95vw)"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        {/* Partner Info Box */}
        <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.8rem' }}>
            <div>
              <span style={{ color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('import_sales.profit_pool.s1', "إجمالي الربح المستحق")}</span>
              <strong style={{ color: '#0f172a', fontSize: '0.88rem' }}>
                {formatCurrency(partner.shareAmount)} <CurrencySymbol />
              </strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('import_sales.profit_pool.s2', "المنصرف سابقاً")}</span>
              <strong style={{ color: '#64748b', fontSize: '0.88rem' }}>
                {formatCurrency(partner.withdrawnProfit)} <CurrencySymbol />
              </strong>
            </div>
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.82rem' }}>{t('import_sales.profit_pool.s3', "الرصيد المتبقي المتاح:")}</span>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: partner.currentBalance > 0 ? '#170e5e' : '#64748b' }}>
              {formatCurrency(partner.currentBalance)} <CurrencySymbol />
            </span>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
              {t('import_sales.profit_pool.s4', "قيمة الدفعة المنصرفة")} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            {partner.currentBalance > 0 && (
              <button
                type="button"
                onClick={handleFillMax}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#170e5e',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                {t('import_sales.profit_pool.s5', "صرف كامل المتبقي (")}{Number(partner.currentBalance).toLocaleString()} <CurrencySymbol />)
              </button>
            )}
          </div>
          <input 
            type="number" 
            min="0.01" 
            step="0.01" 
            value={amount} 
            onChange={e => setAmount(e.target.value)} 
            required 
            placeholder="0.00"
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '0 12px',
              fontSize: '0.88rem',
              fontWeight: 700,
              background: '#ffffff',
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '6px' }}>
            مشروع الاستيراد المرتبط بالتوزيع
          </label>
          <select
            value={selectedProjectId || projects[0]?.id || ''}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={!!approvalRequestId}
            title={approvalRequestId ? 'المشروع مقفل على مشروع الموافقة المعتمدة المختارة' : undefined}
            style={{
              width: '100%',
              height: '36px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '0 10px',
              fontSize: '0.82rem',
              background: '#ffffff',
              color: '#0f172a',
            }}
          >
            <option value="">-- اختر المشروع --</option>
            {Array.isArray(projects) && projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.project_no} - {p.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
              رقم طلب الموافقة المعتمد (Maker-Checker) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <button
              type="button"
              onClick={handleRequestApproval}
              disabled={createApprovalMutation.isPending}
              style={{
                background: 'none',
                border: 'none',
                color: '#0284c7',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              + رفع طلب اعتماد للمدير الآن
            </button>
          </div>
          {partnerApprovals.length > 0 ? (
            <select
              value={approvalRequestId}
              onChange={(e) => handleSelectApproval(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                padding: '0 10px',
                fontSize: '0.8rem',
                marginBottom: '6px',
                background: '#f8fafc',
              }}
            >
              <option value="">-- اختر موافقة معتمدة لهذا الشريك --</option>
              {partnerApprovals.map((r: any) => (
                <option key={r.id} value={r.id}>
                  #{String(r.id).slice(0, 8)} - معتمد للصرف
                </option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
              لا توجد موافقة معتمدة لهذا الشريك بعد — ارفع طلب اعتماد من الزر أعلاه وانتظر اعتماد المدير؛ لا يمكن الصرف بمعرّف غير معتمد.
            </div>
          )}
          {raisedApprovalId && !approvalRequestId && (
            <div style={{ fontSize: '0.78rem', color: '#0369a1', background: '#f0f9ff', border: '1px solid #7dd3fc', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' }}>
              طلب الاعتماد #{raisedApprovalId.slice(0, 8)} قيد المراجعة لدى المدير — سيظهر هنا للاختيار فور اعتماده، ولا يمكن الصرف قبله.
            </div>
          )}
          <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '4px' }}>
            الصرف يقبل موافقة معتمدة فقط من مدير آخر (Maker-Checker) ومخصصة لهذا الشريك والمشروع المختار.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
          <Button 
            type="button" 
            variant="secondary" 
            onClick={onClose}
            style={{ height: '36px', padding: '0 16px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '6px' }}
          >
            {t('import_sales.profit_pool.s6', "إلغاء")}
          </Button>
          <Button 
            type="submit" 
            disabled={payoutMutation.isPending || !approvalRequestId.trim()}
            style={{
              height: '36px',
              padding: '0 20px',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '6px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
            }}
          >
            {payoutMutation.isPending ? t('import_sales.profit_pool.s7', "جاري التسجيل...") : t('import_sales.profit_pool.s8', "تأكيد وصرف الدفعة")}
          </Button>
        </div>
        <MutationFeedback isError={payoutMutation.isError} isSuccess={payoutMutation.isSuccess} error={payoutMutation.error} />
      </form>
    </StandardDialog>
  );
}

function ProjectCloseModal({
  project,
  open,
  onClose,
}: {
  project: { projectId: string; projectNo: string; title: string; status: string; netProfitPool: number } | null;
  open: boolean;
  onClose: () => void;
}) {
  const [approvalRequestId, setApprovalRequestId] = useState('');
  const [raisedApprovalId, setRaisedApprovalId] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const closeProjectMutation = useCloseProjectMutation();
  const { data: approvalRequests = [], refetch: refetchApprovals } = useApprovalRequestsQuery();
  const createApprovalMutation = useCreateApprovalRequestMutation();

  if (!project) return null;

  const closureApprovals = approvalRequests.filter((r: any) => {
    if ((r.action_type !== 'project_closure' && r.request_type !== 'project_closure') || r.status !== 'approved') return false;
    try {
      const p = typeof r.request_payload === 'string' ? JSON.parse(r.request_payload || '{}') : (r.request_payload || {});
      return String(p.projectId || r.reference_id || '') === String(project.projectId);
    } catch {
      return String(r.reference_id || '') === String(project.projectId);
    }
  });

  const handleRequestApproval = async () => {
    try {
      const created = await createApprovalMutation.mutateAsync({
        actionType: 'project_closure',
        referenceId: project.projectId,
        requestPayload: {
          amount: Number(project.netProfitPool || 0),
          projectId: project.projectId,
          justification: closingNotes || `طلب اعتماد إقفال حسابات مشروع الاستيراد ${project.projectNo}`,
        },
      });
      if (created?.id) setRaisedApprovalId(String(created.id));
      toast.success('تم رفع طلب اعتماد إقفال المشروع للرقابة الثنائية (Maker-Checker) — بانتظار اعتماد المدير');
      refetchApprovals();
    } catch (err: any) {
      toast.error('فشل رفع طلب الاعتماد: ' + (err.message || 'خطأ'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalRequestId.trim()) return;
    try {
      await closeProjectMutation.mutateAsync({
        projectId: project.projectId,
        approvalRequestId: approvalRequestId.trim(),
        closingNotes: closingNotes || undefined,
      });
      toast.success('تم إقفال مشروع الاستيراد وحفظ السجل المالي النهائي بنجاح');
      setApprovalRequestId('');
      setRaisedApprovalId('');
      setClosingNotes('');
      onClose();
    } catch (err: any) {
      toast.error('فشل إقفال المشروع: ' + (err.message || 'خطأ'));
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={`إقفال مشروع الاستيراد: ${project.projectNo}`}
      subtitle="إقفال نهائي بعد التحقق من وصول كل الحاويات وترحيل الاستلامات وسداد الفواتير — يتطلب موافقة معتمدة من مدير آخر."
      width="min(520px, 95vw)"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
        <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.82rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>المشروع</span>
            <strong style={{ color: '#0f172a' }}>{project.projectNo} — {project.title}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ color: '#64748b' }}>صافي الربح المحقق</span>
            <strong style={{ color: '#0f172a' }}>{formatCurrency(project.netProfitPool)} <CurrencySymbol /></strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ color: '#64748b' }}>الحالة الحالية</span>
            <strong style={{ color: '#0f172a' }}>{project.status}</strong>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
              موافقة الإقفال المعتمدة (Maker-Checker) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <button
              type="button"
              onClick={handleRequestApproval}
              disabled={createApprovalMutation.isPending}
              style={{ background: 'none', border: 'none', color: '#0284c7', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              + رفع طلب اعتماد إقفال للمدير الآن
            </button>
          </div>
          {closureApprovals.length > 0 ? (
            <select
              value={approvalRequestId}
              onChange={(e) => setApprovalRequestId(e.target.value)}
              style={{ width: '100%', height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8rem', background: '#f8fafc' }}
            >
              <option value="">-- اختر موافقة إقفال معتمدة لهذا المشروع --</option>
              {closureApprovals.map((r: any) => (
                <option key={r.id} value={r.id}>#{String(r.id).slice(0, 8)} - معتمد للإقفال</option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 10px' }}>
              لا توجد موافقة إقفال معتمدة لهذا المشروع بعد — ارفع طلب اعتماد أولاً وانتظر اعتماد المدير.
            </div>
          )}
          {raisedApprovalId && !approvalRequestId && (
            <div style={{ fontSize: '0.78rem', color: '#0369a1', background: '#f0f9ff', border: '1px solid #7dd3fc', borderRadius: '6px', padding: '8px 10px', marginTop: '6px' }}>
              طلب الاعتماد #{raisedApprovalId.slice(0, 8)} قيد المراجعة لدى المدير — سيظهر هنا للاختيار فور اعتماده.
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '6px' }}>ملاحظات الإقفال</label>
          <textarea
            rows={2}
            value={closingNotes}
            onChange={(e) => setClosingNotes(e.target.value)}
            placeholder="بيان مختصر عن الإقفال (اختياري)"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.82rem' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
          <Button type="button" variant="secondary" onClick={onClose} style={{ height: '36px', padding: '0 16px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '6px' }}>
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={closeProjectMutation.isPending || !approvalRequestId.trim()}
            style={{ height: '36px', padding: '0 20px', fontSize: '0.82rem', fontWeight: 700, borderRadius: '6px', background: '#170e5e', color: '#ffffff', border: 'none' }}
          >
            {closeProjectMutation.isPending ? 'جاري الإقفال...' : 'تأكيد إقفال المشروع'}
          </Button>
        </div>
        <MutationFeedback isError={closeProjectMutation.isError} isSuccess={closeProjectMutation.isSuccess} error={closeProjectMutation.error} />
      </form>
    </StandardDialog>
  );
}

export default function ProfitPool() {
  const { t } = useTranslation();
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  // INV-IMPORT-TRACEABILITY-APPROVALS-POOL: the pool used to render
  // only the company-wide aggregate — the report service supports a
  // projectId, but the page never passed one. The filter below scopes
  // the KPIs + partner shares to one project; the attribution table
  // underneath always shows every project and every shipment.
  const [projectFilter, setProjectFilter] = useState('');
  const [closingProject, setClosingProject] = useState<{ projectId: string; projectNo: string; title: string; status: string; netProfitPool: number } | null>(null);
  const [isManagePartnersOpen, setIsManagePartnersOpen] = useState(false);
  const [payoutPartner, setPayoutPartner] = useState<{ partnerId: string; name: string; shareAmount: number; withdrawnProfit: number; currentBalance: number; percentage: number; capital_amount?: number } | null>(null);
  const [ledgerPartner, setLedgerPartner] = useState<Partner | null>(null);

  const { data, isLoading, isFetching, refetch } = useProfitReportQuery(startDate, endDate, projectFilter || undefined);
  const { data: attribution } = useProjectProfitAttributionQuery(startDate, endDate);
  const { data: filterProjectsData } = useImportProjectsQuery();
  const filterProjects = Array.isArray(filterProjectsData) ? filterProjectsData : (filterProjectsData as any)?.rows || (filterProjectsData as any)?.items || [];

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader 
          title={t('import_sales.profit_pool.s9', "مجمع أرباح الشركاء وتصفية الحسابات")} 
          description={t('import_sales.profit_pool.s10', "حساب صافي الأرباح عن فترة محددة وتوزيعها بناءً على المبيعات والتكلفة الفعلية والمصاريف التشغيلية.")}
          actions={
            <Button 
              variant="primary" 
              onClick={() => setIsManagePartnersOpen(true)}
              style={{
                height: '38px',
                padding: '0 18px',
                fontSize: '0.82rem',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <UsersIcon size={16} />
              <span>{t('import_sales.profit_pool.s11', "إدارة الشركاء ورأس المال")}</span>
            </Button>
          }
        />

        {data && !data.profitAttributionVerified && (
          <div role="alert" style={{ padding: '12px 16px', marginBottom: '16px', border: '1px solid #f59e0b', borderRadius: '8px', color: '#92400e', background: '#fffbeb', fontSize: '0.8125rem' }}>
            تنبيه محاسبي: تقرير أرباح الاستيراد الحالي تقديري لعدم وجود ربط بين المبيعات والشحنات في الفترة المحددة.
            يتم تفعيل صرف أرباح الشركاء آلياً عند بيع كميات مخصصة من باتشات المشروع.
          </div>
        )}

        {/* Date Filter Card */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>{t('import_sales.profit_pool.s12', "من تاريخ")}</label>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
                style={{
                  height: '38px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 12px',
                  fontSize: '0.825rem',
                  background: '#ffffff',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>{t('import_sales.profit_pool.s13', "إلى تاريخ")}</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
                style={{
                  height: '38px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 12px',
                  fontSize: '0.825rem',
                  background: '#ffffff',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '220px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>مشروع الاستيراد (للتفصيل حسب المشروع)</label>
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                style={{
                  height: '38px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 12px',
                  fontSize: '0.825rem',
                  background: '#ffffff',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              >
                <option value="">كل المشاريع (الإجمالي العام)</option>
                {Array.isArray(filterProjects) && filterProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.project_no} - {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Button 
                variant="primary" 
                onClick={() => refetch()} 
                disabled={isFetching}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  fontSize: '0.825rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCwIcon size={14} className={isFetching ? 'animate-spin' : ''} />
                <span>{isFetching ? t('import_sales.profit_pool.s14', "جاري الحساب...") : t('import_sales.profit_pool.s15', "تحديث التقرير")}</span>
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCwIcon size={24} style={{ margin: '0 auto 12px auto', display: 'block', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>{t('import_sales.profit_pool.s16', "جاري احتساب أرباح الشراكة للفترة المحددة...")}</div>
          </div>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 3 Calm & Premium KPI Metric Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {/* Revenue Card */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px' }}>
                  {t('import_sales.profit_pool.s17', "إجمالي الإيرادات (المبيعات)")}
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
                  {formatCurrency(data.totalRevenue)} <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8' }}><CurrencySymbol /></span>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '6px' }}>
                  {t('import_sales.profit_pool.s18', "إجمالي المبيعات المحققة بالفترة")}
                </div>
              </div>

              {/* Total Costs Card */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px' }}>
                  {t('import_sales.profit_pool.s19', "إجمالي التكلفة والمصاريف")}
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
                  {formatCurrency(data.totalCost + data.totalExpenses)} <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8' }}><CurrencySymbol /></span>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '6px' }}>
                  {t('import_sales.profit_pool.s20', "بضاعة:")} {formatCurrency(data.totalCost)} <CurrencySymbol /> {t('import_sales.profit_pool.s21', "• مصاريف:")} {formatCurrency(data.totalExpenses)} <CurrencySymbol />
                </div>
              </div>

              {/* Net Profit Distributable Card */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px' }}>
                  {t('import_sales.profit_pool.s22', "صافي الربح المتاح للتوزيع")}
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
                  {formatCurrency(data.netProfitPool)} <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8' }}><CurrencySymbol /></span>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '6px' }}>
                  {t('import_sales.profit_pool.s23', "صافي الوعاء القابل للتوزيع على الشركاء")}
                </div>
              </div>
            </div>

            {/* Partner Distribution Table Card */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                    {t('import_sales.profit_pool.s24', "جدول توزيع الأرباح على الشركاء")}
                  </h4>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {t('import_sales.profit_pool.s25', "توزيع صافي الأرباح وفق نسب الشراكة مع تتبع المسحوبات والرصيد المتبقي")}
                  </span>
                </div>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '3px 9px', borderRadius: '12px' }}>
                  {data.partnerShares.length} {t('import_sales.profit_pool.s26', "شركاء")}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.825rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                      <th style={{ padding: '10px 14px' }}>{t('import_sales.profit_pool.s27', "اسم الشريك")}</th>
                      <th style={{ padding: '10px 14px', width: '120px' }}>{t('import_sales.profit_pool.s28', "نسبة الشراكة")}</th>
                      <th style={{ padding: '10px 14px' }}>{t('import_sales.profit_pool.s29', "إجمالي الربح المستحق")}</th>
                      <th style={{ padding: '10px 14px' }}>{t('import_sales.profit_pool.s30', "ما تم سحبه مسبقاً")}</th>
                      <th style={{ padding: '10px 14px' }}>{t('import_sales.profit_pool.s31', "الرصيد المتبقي (الحالي)")}</th>
                      <th style={{ padding: '10px 14px', width: '190px', textAlign: 'center' }}>{t('import_sales.profit_pool.s32', "إجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.partnerShares.map((partner: any, idx: number) => (
                      <tr key={partner.partnerId} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                          {partner.name}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#334155', fontWeight: 600, fontSize: '0.76rem' }}>
                            {partner.percentage}%
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                          {formatCurrency(partner.shareAmount)} <span style={{ fontSize: '0.72rem', color: '#64748b' }}><CurrencySymbol /></span>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#64748b' }}>
                          {formatCurrency(partner.withdrawnProfit)} <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}><CurrencySymbol /></span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ 
                            fontWeight: 800, 
                            color: partner.currentBalance > 0 ? '#170e5e' : (partner.currentBalance < 0 ? '#dc2626' : '#64748b') 
                          }}>
                            {formatCurrency(partner.currentBalance)} <span style={{ fontSize: '0.72rem', fontWeight: 600 }}><CurrencySymbol /></span>
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <Button 
                              variant="secondary" 
                              onClick={() => setPayoutPartner(partner)}
                              disabled={!data?.profitAttributionVerified}
                              style={{ height: '28px', padding: '0 10px', fontSize: '0.74rem', fontWeight: 700, borderRadius: '4px' }}
                            >
                              {t('import_sales.profit_pool.s33', "تسجيل دفعة")}
                            </Button>
                            <Button 
                              variant="secondary" 
                              onClick={() => setLedgerPartner({ id: partner.partnerId, name: partner.name, profit_share_percentage: partner.percentage, capital_amount: partner.capital_amount || 0 })}
                              style={{ height: '28px', padding: '0 8px', fontSize: '0.74rem', fontWeight: 600, borderRadius: '4px' }}
                            >
                              {t('import_sales.profit_pool.s34', "كشف حساب")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.partnerShares.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px auto', color: '#94a3b8' }}>
                            <UsersIcon size={22} />
                          </div>
                          <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.86rem' }}>{t('import_sales.profit_pool.s35', "لا يوجد شركاء مسجلين في النظام")}</div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>{t('import_sales.profit_pool.s36', "انقر على زر \"إدارة الشركاء ورأس المال\" بالأعلى لإضافة الشركاء وتحديد نسب الأرباح.")}</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-project / per-shipment attribution
                (INV-IMPORT-TRACEABILITY-APPROVALS-POOL): the pool is
                no longer one aggregate — every project traces its own
                revenue, cost and net pool with its shipments, plus the
                closing action the trial found missing. */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>تفصيل الأرباح حسب المشروع والشحنة</h4>
                <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                  كل مشروع بأساس دفتري مرحّل فقط، وكل شحنة بتكلفتها المستلمة ومبيعاتها — لا تجميع بلا نسبة لمشروع.
                </span>
              </div>
              {!attribution ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>جاري تحميل التفصيل حسب المشروع...</div>
              ) : attribution.projects.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>لا توجد مشاريع استيراد مسجلة بعد</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.825rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                        <th style={{ padding: '10px 14px' }}>المشروع</th>
                        <th style={{ padding: '10px 14px' }}>الحالة</th>
                        <th style={{ padding: '10px 14px' }}>الإيرادات</th>
                        <th style={{ padding: '10px 14px' }}>التكلفة</th>
                        <th style={{ padding: '10px 14px' }}>صافي الربح</th>
                        <th style={{ padding: '10px 14px' }}>التتبع</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center' }}>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.projects.map((p: any) => (
                        <tr key={p.projectId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                            {p.projectNo} — {p.title}
                            {p.shipments.map((s: any) => (
                              <div key={s.shipmentId} style={{ fontWeight: 400, fontSize: '0.74rem', color: '#64748b', marginTop: '4px' }}>
                                {s.containerNumber} ({s.status}) — مستلم {s.receivedQuantity} • تكلفة {formatCurrency(s.landedCostEgp)} • مبيعات {formatCurrency(s.salesRevenueEgp)} / تكلفة {formatCurrency(s.salesCostEgp)}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '10px 14px' }}>{p.status}</td>
                          <td style={{ padding: '10px 14px' }}>{formatCurrency(p.totalRevenue)} <CurrencySymbol /></td>
                          <td style={{ padding: '10px 14px' }}>{formatCurrency(p.totalCost + p.totalExpenses)} <CurrencySymbol /></td>
                          <td style={{ padding: '10px 14px', fontWeight: 800, color: '#0f172a' }}>{formatCurrency(p.netProfitPool)} <CurrencySymbol /></td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', background: p.profitAttributionVerified ? '#dcfce7' : '#fef3c7', color: p.profitAttributionVerified ? '#166534' : '#92400e', fontWeight: 700, fontSize: '0.74rem' }}>
                              {p.profitAttributionVerified ? 'متتبع' : 'تقديري'}
                            </span>
                            <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>{p.attributionStatus || ''}</span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            {p.status !== 'closed' && (
                              <Button
                                variant="secondary"
                                onClick={() => setClosingProject({ projectId: p.projectId, projectNo: p.projectNo, title: p.title, status: p.status, netProfitPool: p.netProfitPool })}
                                style={{ height: '28px', padding: '0 10px', fontSize: '0.74rem', fontWeight: 700, borderRadius: '4px' }}
                              >
                                إقفال المشروع
                              </Button>
                            )}
                            {p.status === 'closed' && (
                              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>مقفل</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {isManagePartnersOpen && (
        <ManagePartnersDialog 
          open={isManagePartnersOpen} 
          onClose={() => setIsManagePartnersOpen(false)} 
        />
      )}

      {payoutPartner && (
        <PartnerPayoutModal 
          open={!!payoutPartner} 
          partner={payoutPartner} 
          onClose={() => setPayoutPartner(null)} 
        />
      )}

      {closingProject && (
        <ProjectCloseModal
          open={!!closingProject}
          project={closingProject}
          onClose={() => { setClosingProject(null); refetch(); }}
        />
      )}

      {ledgerPartner && (
        <PartnerLedgerDialog 
          open={!!ledgerPartner} 
          partner={ledgerPartner} 
          onClose={() => setLedgerPartner(null)} 
        />
      )}
    </div>
  );
}
