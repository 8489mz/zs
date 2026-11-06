import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid, type StatsGridItem } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import {
  useApprovalsWorkspace,
  type ApprovalRequest,
} from '../hooks/useApprovalsWorkspace';
import { ApprovalRequestsTable } from '../components/ApprovalRequestsTable';
import { ApprovalRulesManager } from '../components/ApprovalRulesManager';
import { ApprovalActionModal } from '../components/ApprovalActionModal';
import { ClockIcon, ShieldAlertIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

export const ApprovalsWorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'requests' | 'rules'>('requests');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);

  // KPIs + requests come from the feature hook (page-composition rule: pages
  // never call the api layer directly). reload() is the old loadData: the
  // refresh button, the rules manager and the action modal all call it.
  const {
    requests,
    loading,
    pendingCount,
    approvedCount,
    rejectedCount,
    rulesCount,
    reload,
  } = useApprovalsWorkspace(statusFilter, moduleFilter);

  const stats: StatsGridItem[] = [
    {
      key: 'pending',
      label: 'طلبات معلقة تتطلب الاعتماد',
      value: pendingCount,
    },
    {
      key: 'approved',
      label: 'معاملات تم اعتمادها بنجاح',
      value: approvedCount,
    },
    {
      key: 'rejected',
      label: 'معاملات تم رفضها',
      value: rejectedCount,
    },
    {
      key: 'rules',
      label: 'قواعد الرقابة الهرمية المفعلة',
      value: rulesCount,
    },
  ];

  return (
    <div
      dir="rtl"
      style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <PageHeader
        title={t('approvals.approvals_workspace_page.s0', "مركز الموافقات وسير العمل الهرمي (Approval Workflow Center)")}
        description={t('approvals.approvals_workspace_page.s1', "حوكمة المعاملات المالية والمشتريات والمصروفات وفق مصفوفة الصلاحيات وسقف المبالغ المعتمدة.")}
        actions={
          <Button variant="secondary" onClick={reload} disabled={loading}>
            <RefreshCwIcon size={16} />
            {t('approvals.approvals_workspace_page.s2', "تحديث البيانات")}
          </Button>
        }
      />

      {/* KPI Stats Grid */}
      <StatsGrid items={stats} />

      {/* Main Tab Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '10px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'requests' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'requests' ? '#ffffff' : '#334155',
            fontWeight: 700,
            fontSize: 'var(--font-body)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ClockIcon size={16} />
          <span>{t('approvals.approvals_workspace_page.s3', "طابور طلبات الاعتماد")}</span>
          {pendingCount > 0 && (
            <span
              style={{
                backgroundColor: activeTab === 'requests' ? '#ef4444' : '#fee2e2',
                color: activeTab === 'requests' ? '#ffffff' : '#991b1b',
                padding: '2px 6px',
                borderRadius: '10px',
                fontSize: 'var(--font-micro)',
                fontWeight: 700,
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'rules' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'rules' ? '#ffffff' : '#334155',
            fontWeight: 700,
            fontSize: 'var(--font-body)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShieldAlertIcon size={16} />
          <span>{t('approvals.approvals_workspace_page.s4', "مصفوفة القواعد والسياسات")}</span>
        </button>
      </div>

      {activeTab === 'requests' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Filters Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              padding: '12px 16px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#475569' }}>
                {t('approvals.approvals_workspace_page.s5', "تصفية الحالة:")}
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                  outline: 'none',
                }}
              >
                <option value="">{t('approvals.approvals_workspace_page.s6', "جميع الحالات")}</option>
                <option value="pending">{t('approvals.approvals_workspace_page.s7', "بانتظار الاعتماد (معلق)")}</option>
                <option value="approved">{t('approvals.approvals_workspace_page.s8', "معتمد رسمياً")}</option>
                <option value="rejected">{t('approvals.approvals_workspace_page.s9', "مرفوض")}</option>
              </select>

              <span style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#475569', marginInlineStart: '12px' }}>
                {t('approvals.approvals_workspace_page.s10', "الموديول:")}
              </span>
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                  outline: 'none',
                }}
              >
                <option value="">{t('approvals.approvals_workspace_page.s11', "كافة الموديولات")}</option>
                <option value="purchase_orders">{t('approvals.approvals_workspace_page.s12', "أوامر الشراء")}</option>
                <option value="purchases">{t('approvals.approvals_workspace_page.s13', "فواتير المشتريات")}</option>
                <option value="expenses">{t('approvals.approvals_workspace_page.s14', "المصروفات النقدية")}</option>
                <option value="treasury_transactions">{t('approvals.approvals_workspace_page.s15', "حركات وسندات الخزينة")}</option>
              </select>
            </div>

            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
              {t('approvals.approvals_workspace_page.s16', "إجمالي النتائج:")} <strong>{requests.length}</strong>
            </div>
          </div>

          <ApprovalRequestsTable
            requests={requests}
            loading={loading}
            onSelectRequest={(req) => {
              setSelectedRequest(req);
              setActionModalOpen(true);
            }}
          />
        </div>
      )}

      {/* INV-APPROVALS-SUMMARY-COUNT: reload the summary counts whenever the
          manager mutates a rule, otherwise rulesCount stays a mount-time
          snapshot (0 after a rule is created) until a full page reload. */}
      {activeTab === 'rules' && <ApprovalRulesManager onRulesChanged={reload} />}

      <ApprovalActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
        request={selectedRequest}
        onSuccess={reload}
      />
    </div>
  );
};
