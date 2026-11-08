import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { QueryFeedback } from '@/shared/components/query-feedback';
import type { Branch } from '@/types/domain';
import { settingsApi } from '@/features/settings/api/settings.api';
import { exportUsersCsv, normalizeUserRecord, printUsersList } from '@/features/settings/components/user-management.shared';
import {
  UserBulkActionDialog,
  UserDeleteDialog,
  UserManagementEditorPanel,
  UserManagementListPanel,
} from '@/features/settings/components/UserManagementPanels';
import {
  DeliveryRepsAccessPanel,
  EmployeeSelfServiceAccessPanel,
} from '@/features/settings/components/user-management/UnifiedAccessDirectoryPanel';
import {
  UsersIcon,
  TruckIcon,
  SmartphoneIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { useUserManagementController } from '@/features/settings/hooks/useUserManagementController';
import { useScrollIntoViewOnChange } from '@/shared/hooks/use-scroll-into-view-on-change';
import { DialogShell } from '@/shared/components/dialog-shell';
import { DataTable } from '@/shared/ui/data-table';
import { ReportMetricCard } from '@/shared/components/report-metric-card';
import { employeeReportsApi } from '@/shared/api/employee-reports';
import { formatEmployeeActivityDetails, getAuditActionLabel } from '@/features/audit';
import { formatCurrency, formatDate } from '@/lib/format';
import type { SetupStepKey } from '@/features/settings/hooks/useFirstRunSetupFlow';
import { useAuthStore } from '@/stores/auth-store';

export function UserManagementSection({ branches, setupMode = false, setupStepKey = null, onSetupAdvance }: { branches: Branch[]; setupMode?: boolean; setupStepKey?: SetupStepKey | null; onSetupAdvance?: () => void }) {
  const { t } = useTranslation();
  const controller = useUserManagementController({ branches, setupMode, setupStepKey, onSetupAdvance });
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const isMaritime = vertical === 'maritime';
  const isContracting = vertical === 'contracting';
  const [detailsUserId, setDetailsUserId] = useState('');
  const [userInteracted, setUserInteracted] = useState(false);
  const detailsQuery = useQuery({
    queryKey: ['settings-user-details', detailsUserId],
    queryFn: () => employeeReportsApi.employeeDetails(detailsUserId, { limit: 25 }),
    enabled: Boolean(detailsUserId),
  });
  const userEditorSectionRef = useRef<HTMLDivElement | null>(null);
  const {
    currentUserRole,
    usersQuery,
    managedUsers,
    userSummary,
    disableBulkSummary,
    selectedUsers,
    selectedUserKey,
    draft,
    setDraft,
    statusMessage,
    userSearch,
    setUserSearch,
    userFilter,
    setUserFilter,
    selectedIds,
    setSelectedIds,
    page,
    setPage,
    pageSize,
    setPageSize,
    bulkAction,
    setBulkAction,
    openBulkAction,
    deleteDialogOpen,
    activeTemplate,
    setDeleteDialogOpen,
    canDeleteSelected,
    canUnlockSelected,
    isCurrentUserSelected,
    selectedDraftDisableProtection,
    canDirectlyDisableSelected,
    actionMutation,
    loadUser,
    startNewUser,
    applyTemplate,
    applyDefaultPermissions,
    togglePermission,
    toggleBranch,
    resetSelectedDraft,
    saveCurrentDraft,
    unlockSelectedUser,
    deleteSelectedUser,
    copyPermissions,
    runBulkAction,
    planLimit,
  } = controller;

  useScrollIntoViewOnChange(selectedUserKey, userEditorSectionRef, { enabled: Boolean(selectedUserKey) && userInteracted });

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'erp-users' | 'drivers' | 'employees'>(() => {
    if ((isMaritime || isContracting) && urlTab === 'drivers') return 'erp-users';
    if (urlTab === 'drivers' && !isMaritime && !isContracting) return 'drivers';
    if (urlTab === 'employees') return 'employees';
    return 'erp-users';
  });

  useEffect(() => {
    if ((isMaritime || isContracting) && urlTab === 'drivers') {
      setActiveTab('erp-users');
    } else if (urlTab === 'drivers' || urlTab === 'employees' || urlTab === 'erp-users') {
      setActiveTab(urlTab as any);
    }
  }, [urlTab, isMaritime, isContracting]);

  const handleTabChange = (tab: 'erp-users' | 'drivers' | 'employees') => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'erp-users') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    });
  };

  const authUser = useAuthStore((s) => s.user);
  const authTenant = useAuthStore((s) => s.tenant);
  const isSuperAdmin = authUser?.role === 'super_admin';

  // 1. الأولوية المطلقة: الرقم المرتجع من السيرفر والمقروء مباشرة من جدول saas_plans
  // قيمة maxUsers = null تعني صراحةً: بلا حد (غير محدود)!
  const isServerUnlimited = planLimit ? (planLimit.isUnlimited || planLimit.maxUsers === null) : false;

  // 2. احتياط محلي فقط في حال عدم اكتمال استجابة السيرفر بعد
  const rawPlan = String(authTenant?.planId || authTenant?.plan || '').toLowerCase();
  const isFallbackUnlimited =
    isSuperAdmin ||
    rawPlan.includes('omnichannel') ||
    rawPlan.includes('commerce') ||
    rawPlan.includes('تجارة') ||
    rawPlan.includes('ultimate') ||
    rawPlan.includes('enterprise');

  const isTenantTierUnlimited =
    isSuperAdmin ||
    isServerUnlimited ||
    isFallbackUnlimited;

  const maxAllowedUsers = isTenantTierUnlimited
    ? Infinity
    : planLimit && typeof planLimit.maxUsers === 'number'
    ? planLimit.maxUsers
    : rawPlan.includes('pro')
    ? 10
    : authTenant?.isTrial
    ? 5
    : 3;

  const isUserLimitReached = !isSuperAdmin && (
    planLimit
      ? planLimit.isLimitReached
      : (maxAllowedUsers !== Infinity && (userSummary.totalItems || 0) >= maxAllowedUsers)
  );

  return (
    <>
      <section className="document-prototype-section settings-users-card">
        <div className="section-header-compact-row">
          <div>
            <h3 className="document-prototype-section-title">{t('settings.user_management_section.s0', "إدارة المستخدمين والهويات والوصول")}</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              {isMaritime
                ? t('settings.user_management_section.s1', "التحكم الشامل في حسابات تشغيل وتتبع الشحن الملاحي والتخليص وموظفي المكاتب والموانئ.")
                : isContracting
                ? t('settings.user_management_section.s2', "التحكم الشامل في حسابات مديري المشاريع ومهندسي المواقع ولوحة الإدارة والموظفين.")
                : t('settings.user_management_section.s3', "التحكم الشامل في حسابات دخول لوحة التحكم، مناديب الدليفري والتوزيع، وموظفي الخدمة الذاتية والبصمة.")}
            </p>
          </div>
          {activeTab === 'erp-users' && (
            <div className="section-header-actions-group">
              {!setupMode ? (
                isUserLimitReached ? (
                  <span
                    style={{
                      fontSize: '0.70rem',
                      padding: '3px 6px',
                      background: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #fde68a',
                      borderRadius: '6px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      whiteSpace: 'nowrap',
                    }}
                    title={`وصلت للحد الأقصى في باقتك (${maxAllowedUsers} مستخدمين).`}
                  >
                    {t('settings.user_management_section.s4', "حد الباقة (")}{maxAllowedUsers})
                  </span>
                ) : (
                  <Button type="button" variant="primary" className="section-header-action-btn" onClick={() => { startNewUser('cashier'); setIsEditorOpen(true); }}>
                    {t('settings.user_management_section.s5', "+ مستخدم جديد")}
                  </Button>
                )
              ) : null}
              {!setupMode ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="section-header-action-btn"
                  onClick={async () => {
                    const payload = await settingsApi.listAllUsers({ search: userSearch, filter: userFilter });
                    exportUsersCsv('users-results.csv', payload.rows.map(normalizeUserRecord));
                  }}
                >
                  {t('settings.user_management_section.s6', "تصدير")}
                </Button>
              ) : null}
              {!setupMode ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="section-header-action-btn"
                  onClick={async () => {
                    const payload = await settingsApi.listAllUsers({ search: userSearch, filter: userFilter });
                    printUsersList(t('settings.user_management_section.s7', "قائمة المستخدمين"), payload.rows.map(normalizeUserRecord));
                  }}
                >
                  {t('settings.user_management_section.s8', "طباعة")}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        {!setupMode && (
          <div
            className="settings-subtabs-scroll"
            style={{
              display: 'flex',
              gap: '6px',
              padding: '4px',
              background: '#f1f5f9',
              borderRadius: '10px',
              margin: '16px 0',
              border: '1px solid #e2e8f0',
              width: '100%',
              maxWidth: '100%',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              flexWrap: 'nowrap',
            }}
          >
            <button
              type="button"
              onClick={() => handleTabChange('erp-users')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'erp-users' ? '#170e5e' : 'transparent',
                color: activeTab === 'erp-users' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <UsersIcon size={16} color={activeTab === 'erp-users' ? '#ffffff' : '#64748b'} />
              <span>{t('settings.user_management_section.s9', "مستخدمو لوحة الإدارة (ERP)")}</span>
              <span
                style={{
                  background: activeTab === 'erp-users' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                  color: activeTab === 'erp-users' ? '#ffffff' : '#334155',
                  padding: '1px 7px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                }}
              >
                {userSummary.totalItems || 0}
              </span>
            </button>

            {!isMaritime && !isContracting && (
              <button
                type="button"
                onClick={() => handleTabChange('drivers')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: activeTab === 'drivers' ? '#170e5e' : 'transparent',
                  color: activeTab === 'drivers' ? '#ffffff' : '#475569',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <TruckIcon size={16} color={activeTab === 'drivers' ? '#ffffff' : '#64748b'} />
                <span>{t('settings.user_management_section.s10', "مناديب التوصيل والفان (Drivers)")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleTabChange('employees')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'employees' ? '#170e5e' : 'transparent',
                color: activeTab === 'employees' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <SmartphoneIcon size={16} color={activeTab === 'employees' ? '#ffffff' : '#64748b'} />
              <span>{t('settings.user_management_section.s11', "موظفو الخدمة الذاتية والبصمة (Staff)")}</span>
            </button>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'drivers' && !setupMode ? (
          <DeliveryRepsAccessPanel />
        ) : activeTab === 'employees' && !setupMode ? (
          <EmployeeSelfServiceAccessPanel />
        ) : (
          <QueryFeedback
            isLoading={usersQuery.isLoading}
            isError={usersQuery.isError}
            error={usersQuery.error}
            isEmpty={!userSummary.totalItems}
            loadingText={t('settings.user_management_section.s12', "جاري تحميل المستخدمين...")}
            emptyTitle={t('settings.user_management_section.s13', "لا توجد بيانات مستخدمين")}
            emptyHint={t('settings.user_management_section.s14', "سيظهر هنا المستخدمون بمجرد تحميلهم من الخادم، ويمكنك إنشاء مستخدم جديد من نفس الشاشة.")}
          >
            <div className="page-stack">
              <UserManagementListPanel
                managedUsers={managedUsers}
                summary={userSummary}
                selectedUserKey={selectedUserKey}
                selectedIds={selectedIds}
                userSearch={userSearch}
                userFilter={userFilter}
                page={usersQuery.data?.pagination?.page || page}
                pageSize={usersQuery.data?.pagination?.pageSize || pageSize}
                totalItems={userSummary.totalItems}
                onNewUser={() => { setUserInteracted(true); startNewUser(setupMode && setupStepKey === 'admin-user' ? 'admin' : 'cashier'); if (!setupMode) setIsEditorOpen(true); }}
                onApplyRolePermissions={() => applyDefaultPermissions(draft.role)}
                onApplyTemplate={applyTemplate}
                activeTemplate={activeTemplate}
                onCopyPermissions={() => void copyPermissions()}
                onUserSearchChange={setUserSearch}
                onUserFilterChange={setUserFilter}
                onLoadUser={(user) => { setUserInteracted(true); loadUser(user); if (!setupMode) setIsEditorOpen(true); }}
                onSelectedIdsChange={setSelectedIds}
                onPageChange={setPage}
                onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
                onBulkAction={openBulkAction}
                disableBulkSummary={disableBulkSummary}
                onOpenDetails={(user) => setDetailsUserId(String(user.id || ''))}
                setupMode={setupMode}
              />
              {setupMode && (
                <div ref={userEditorSectionRef}>
                  <UserManagementEditorPanel
                    branches={branches}
                    draft={draft}
                    currentUserRole={currentUserRole}
                    isCurrentUserSelected={isCurrentUserSelected}
                    selectedDraftDisableProtection={selectedDraftDisableProtection}
                    canDirectlyDisableSelected={canDirectlyDisableSelected}
                    canUnlockSelected={canUnlockSelected}
                    canDeleteSelected={canDeleteSelected}
                    isPending={actionMutation.isPending}
                    isError={actionMutation.isError}
                    isSuccess={actionMutation.isSuccess}
                    error={actionMutation.error}
                    statusMessage={statusMessage}
                    onDraftChange={(updater) => setDraft((current) => updater(current))}
                    onApplyRolePermissions={applyDefaultPermissions}
                    onToggleBranch={toggleBranch}
                    onTogglePermission={togglePermission}
                    onReset={resetSelectedDraft}
                    onUnlock={() => void unlockSelectedUser()}
                    onDelete={() => setDeleteDialogOpen(true)}
                    onSave={() => void saveCurrentDraft()}
                    setupMode={setupMode}
                    setupStepKey={setupStepKey}
                  />
                </div>
              )}
            </div>
          </QueryFeedback>
        )}
      </section>

      {/* Modal for Editing/Creating User in Non-Setup Mode */}
      {!setupMode && (
        <DialogShell
          open={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          width="min(1280px, 97vw)"
          ariaLabel={t('settings.user_management_section.s15', "تعديل المستخدم والصلاحيات")}
          showCloseButton={false}
          shellClassName="dialog-compact"
        >
          <div className="dialog-card user-management-dialog-card" style={{ padding: '12px 18px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #e2e8f0',
              paddingBottom: '8px',
              marginBottom: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  {draft.id ? `تعديل المستخدم: ${draft.name || draft.username}` : (isMaritime ? t('settings.user_management_section.s16', "إضافة مسؤول عمليات / مستخدم جديد") : isContracting ? t('settings.user_management_section.s17', "إضافة مهندس موقع / مستخدم جديد") : t('settings.user_management_section.s18', "إضافة مستخدم جديد"))}
                </h3>
                <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 500 }}>
                  {t('settings.user_management_section.s19', "(تحديد بيانات الحساب، المقرات، ومجموعات الصلاحيات)")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('settings.user_management_section.s20', "إغلاق")}
              >
                <XIcon size={18} />
              </button>
            </div>
            <UserManagementEditorPanel
              branches={branches}
              draft={draft}
              currentUserRole={currentUserRole}
              isCurrentUserSelected={isCurrentUserSelected}
              selectedDraftDisableProtection={selectedDraftDisableProtection}
              canDirectlyDisableSelected={canDirectlyDisableSelected}
              canUnlockSelected={canUnlockSelected}
              canDeleteSelected={canDeleteSelected}
              isPending={actionMutation.isPending}
              isError={actionMutation.isError}
              isSuccess={actionMutation.isSuccess}
              error={actionMutation.error}
              statusMessage={statusMessage}
              onDraftChange={(updater) => setDraft((current) => updater(current))}
              onApplyRolePermissions={applyDefaultPermissions}
              onToggleBranch={toggleBranch}
              onTogglePermission={togglePermission}
              onReset={resetSelectedDraft}
              onUnlock={() => void unlockSelectedUser()}
              onDelete={() => { setDeleteDialogOpen(true); setIsEditorOpen(false); }}
              onSave={async () => {
                await saveCurrentDraft();
                if (actionMutation.isSuccess) {
                  setIsEditorOpen(false);
                }
              }}
              setupMode={setupMode}
              setupStepKey={setupStepKey}
            />
          </div>
        </DialogShell>
      )}

      <UserDeleteDialog
        open={deleteDialogOpen}
        draft={draft}
        isBusy={actionMutation.isPending}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={(payload) => void deleteSelectedUser(payload)}
      />

      <DialogShell open={Boolean(detailsUserId)} onClose={() => setDetailsUserId('')} width="min(980px, 100%)" ariaLabel={t('settings.user_management_section.s21', "تفاصيل المستخدم")}>
        <div className="page-stack">
          <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0 }}>{t('settings.user_management_section.s22', "تفاصيل المستخدم")}</h3>
              <div className="muted small">{detailsQuery.data?.employee ? `${detailsQuery.data.employee.name} · ${detailsQuery.data.employee.username}` : t('settings.user_management_section.s23', "جاري التحميل...")}</div>
            </div>
            <Button variant="secondary" onClick={() => setDetailsUserId('')}>{t('settings.user_management_section.s24', "إغلاق")}</Button>
          </div>
          {detailsQuery.isLoading ? <div className="muted small">{t('settings.user_management_section.s25', "جاري تحميل التفاصيل...")}</div> : null}
          {detailsQuery.isError ? <div className="warning-box">{t('settings.user_management_section.s26', "تعذر تحميل تفاصيل المستخدم.")}</div> : null}
          {detailsQuery.data?.employee ? <>
            <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid">
              <ReportMetricCard label={t('settings.user_management_section.s27', "المبيعات")} value={detailsQuery.data.employee.salesTotal || 0} helper={`${detailsQuery.data.employee.salesCount || 0} فاتورة`} tone="primary" formatter={formatCurrency} progress={0} />
              <ReportMetricCard label={t('settings.user_management_section.s28', "المشتريات")} value={detailsQuery.data.employee.purchasesTotal || 0} helper={`${detailsQuery.data.employee.purchasesCount || 0} فاتورة`} tone="warning" formatter={formatCurrency} progress={0} />
              <ReportMetricCard label={t('settings.user_management_section.s29', "المرتجعات")} value={detailsQuery.data.employee.returnsTotal || 0} helper={`${detailsQuery.data.employee.returnsCount || 0} مستند`} tone="danger" formatter={formatCurrency} progress={0} />
              <ReportMetricCard label={t('settings.user_management_section.s30', "السجل")} value={detailsQuery.data.employee.auditCount || 0} helper={t('settings.user_management_section.s31', "أحداث رقابية")} tone="success" progress={0} />
            </div>
            <DataTable
              ariaLabel={t('settings.user_management_section.s32', "نشاط المستخدم")}
              rows={detailsQuery.data.activities || []}
              columns={[
                { key: 'title', header: t('settings.user_management_section.s33', "العنوان"), cell: (row) => row.activityType === 'audit' ? getAuditActionLabel(row.title) : row.title },
                { key: 'details', header: t('settings.user_management_section.s34', "التفاصيل"), cell: (row) => row.activityType === 'audit' ? formatEmployeeActivityDetails(row) : row.details || '—' },
                { key: 'amount', header: t('settings.user_management_section.s35', "القيمة"), cell: (row) => row.amount == null ? '—' : formatCurrency(row.amount || 0) },
                { key: 'date', header: t('settings.user_management_section.s36', "التاريخ والوقت"), cell: (row) => formatDate(row.createdAt) },
                { key: 'ref', header: t('settings.user_management_section.s37', "المرجع"), cell: (row) => row.referenceLabel || '—' },
              ]}
              empty={<div className="muted small">{t('settings.user_management_section.s38', "لا توجد حركات للمستخدم في النطاق الحالي.")}</div>}
            />
          </> : null}
        </div>
      </DialogShell>

      <UserBulkActionDialog
        open={Boolean(bulkAction)}
        action={bulkAction}
        selectedUsers={selectedUsers}
        disableBulkSummary={disableBulkSummary}
        isBusy={actionMutation.isPending}
        onCancel={() => setBulkAction(null)}
        onConfirm={() => runBulkAction()}
      />
    </>
  );
}
