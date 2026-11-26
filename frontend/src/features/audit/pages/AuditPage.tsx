import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/components/data-table';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { PageHeader } from '@/shared/components/page-header';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import { FilterChipGroup } from '@/shared/components/filter-chip-group';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { PaginationControls } from '@/shared/components/pagination-controls';
import { StatsGrid } from '@/shared/components/stats-grid';
import { formatDate } from '@/lib/format';
import { useAuditLogs } from '@/features/audit/hooks/useAuditLogs';
import { useAuditPageActions } from '@/features/audit/hooks/useAuditPageActions';
import { formatAuditDetails } from '@/shared/utils/audit-details-format';
import {
  getAuditActionLabel,
  getAuditActivityMeta,
  normalizeAuditDetailText,
  normalizeAuditUserDisplay,
  type AuditActivityType,
} from '@/shared/utils/audit-activity-presenter';
import { userDirectoryApi } from '@/shared/api/user-directory';
import type { AuditLog } from '@/types/domain';
import { FileTextIcon, ShieldAlertIcon, ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import { useAuthStore } from '@/stores/auth-store';
import { settingsApi } from '@/features/settings';
import { queryKeys } from '@/app/query-keys';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { CashierFraudRadarSection } from '../components/CashierFraudRadarSection';
import { TamperAuditTrailTab } from '../components/TamperAuditTrailTab';

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [activeTab, setActiveTab] = useState<'trail' | 'fraudRadar' | 'tamperTrail'>('trail');
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'today' | 'withDetails'>('all');
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | Exclude<AuditActivityType, 'general'>>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const authTenant = useAuthStore((state) => state.tenant);
  const { data: settings } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => settingsApi.settings(),
  });
  const currentVertical = resolveCurrentVertical(authTenant, settings);
  const showCashierFraudRadar =
    settings?.posModuleEnabled !== false &&
    currentVertical !== 'maritime' &&
    currentVertical !== 'contracting' &&
    currentVertical !== 'services';

  useEffect(() => {
    if (!showCashierFraudRadar && activeTab === 'fraudRadar') {
      setActiveTab('trail');
    }
  }, [showCashierFraudRadar, activeTab]);

  const auditFilterOptions = useMemo(() => [
    { value: 'all', label: isEn ? 'All Records' : 'كافة السجلات' },
    { value: 'today', label: isEn ? "Today's Activity" : 'نشاط اليوم' },
    { value: 'withDetails', label: isEn ? 'Records with Details' : 'سجلات بتفاصيل' },
  ], [isEn]);

  const auditTypeFilterOptions = useMemo((): Array<{ value: 'all' | Exclude<AuditActivityType, 'general'>; label: string }> => [
    { value: 'all', label: isEn ? 'All Types' : 'جميع الأنواع' },
    { value: 'auth', label: isEn ? 'Security & Auth' : 'أمان ودخول' },
    { value: 'settings', label: isEn ? 'System & Settings' : 'منظومة وإعدادات' },
    { value: 'sales', label: isEn ? 'Sales & Payments' : 'مبيعات ومدفوعات' },
    { value: 'purchases', label: isEn ? 'Purchases & Vendors' : 'مشتريات وموردين' },
    { value: 'inventory', label: isEn ? 'Inventory & Items' : 'مخزون وأصناف' },
    { value: 'maintenance', label: isEn ? 'Maintenance Tickets' : 'تذاكر صيانة' },
    { value: 'hr', label: isEn ? 'Human Resources' : 'موارد بشرية' },
    { value: 'import', label: isEn ? 'Import Operations' : 'عمليات استيراد' },
    { value: 'backup', label: isEn ? 'Backups' : 'نسخ احتياطي' },
    { value: 'sensitive', label: isEn ? 'Critical Actions' : 'عمليات حساسة' },
  ], [isEn]);

  const filteredActivityTypeOptions = useMemo(() => {
    return auditTypeFilterOptions.filter((opt) => {
      if (opt.value === 'maintenance' && (currentVertical === 'maritime' || currentVertical === 'contracting')) return false;
      return true;
    });
  }, [auditTypeFilterOptions, currentVertical]);

  const usersQuery = useQuery({ queryKey: ['audit-users-filter'], queryFn: userDirectoryApi.users });
  const query = useAuditLogs({ page, pageSize, search, mode: filterMode, userId: selectedUserId });
  const rows = query.data?.rows || [];
  const visibleRows = useMemo(() => {
    if (activityTypeFilter === 'all') return rows;
    return rows.filter((row) => getAuditActivityMeta(row, isEn).type === activityTypeFilter);
  }, [activityTypeFilter, isEn, rows]);

  const pagination = query.data?.pagination;
  const summary = query.data?.summary || { distinctUsers: 0, todayCount: 0 };

  useEffect(() => {
    setPage(1);
  }, [search, filterMode, selectedUserId, activityTypeFilter]);

  const totalRows = pagination?.totalItems || 0;
  const rangeStart = pagination?.rangeStart || 0;
  const rangeEnd = pagination?.rangeEnd || 0;

  const userOptions = useMemo(() => (usersQuery.data || []).map((user) => ({
    id: String(user.id || ''),
    label: String(user.name || user.username || (isEn ? 'User' : 'مستخدم')),
    role: String(user.role || ''),
  })), [isEn, usersQuery.data]);

  const selectedUserLabel = userOptions.find((entry) => entry.id === selectedUserId)?.label || '';

  const stats = [
    { key: 'total', label: isEn ? 'Total Records' : 'إجمالي السجلات', value: totalRows },
    { key: 'today', label: isEn ? "Today's Records" : 'سجلات اليوم', value: summary.todayCount },
    { key: 'users', label: isEn ? 'Distinct Actors' : 'عدد المنفذين', value: summary.distinctUsers },
    { key: 'range', label: isEn ? 'Currently Displayed' : 'المعروض حالياً', value: totalRows ? `${rangeStart}-${rangeEnd}` : '0' },
  ] as const;

  const { copyFeedback, isExporting, copyAuditSummary, exportAuditRows, printAuditRows } = useAuditPageActions({
    search,
    mode: filterMode,
    userId: selectedUserId,
    totalRows,
    summary,
    rangeStart,
    rangeEnd,
    isEn,
  });

  const resetAuditView = () => {
    setSearch('');
    setSelectedUserId('');
    setFilterMode('all');
    setActivityTypeFilter('all');
    setPage(1);
  };

  return (
    <div className="page-stack page-shell audit-page" dir={isEn ? 'ltr' : 'rtl'}>
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={isEn ? 'Audit & Verification Trail' : t('audit.audit_page.s0', "سجل التدقيق والمراجعة")}
          description={isEn ? 'Track and verify all administrative, financial, operational, and user actions across the system.' : t('audit.audit_page.s1', "متابعة وتدقيق كافة العمليات الإدارية والمالية والأمنية وحركات المستخدمين في المنظومة.")}
          badge={<span className="nav-pill" style={{ background: '#f1f5f9', color: '#334155', borderColor: '#cbd5e1' }}>Audit Trail</span>}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button variant="secondary" onClick={resetAuditView} style={{ padding: '6px 12px', fontSize: '12.5px' }}>
                {isEn ? 'Reset' : t('audit.audit_page.s2', "إعادة ضبط")}
              </Button>
              <Button variant="secondary" onClick={copyAuditSummary} disabled={!totalRows} style={{ padding: '6px 12px', fontSize: '12.5px' }}>
                {isEn ? 'Copy' : t('audit.audit_page.s3', "نسخ")}
              </Button>
              <Button variant="secondary" onClick={() => void exportAuditRows()} disabled={!totalRows || isExporting} style={{ padding: '6px 12px', fontSize: '12.5px' }}>
                {isExporting ? '...' : (isEn ? 'Export' : t('audit.audit_page.s4', "تصدير"))}
              </Button>
              <Button variant="secondary" onClick={() => void printAuditRows()} disabled={!totalRows || isExporting} style={{ padding: '6px 12px', fontSize: '12.5px' }}>
                {isExporting ? '...' : (isEn ? 'Print' : t('audit.audit_page.s5', "طباعة"))}
              </Button>
            </div>
          }
        />

        {copyFeedback ? <div className={copyFeedback.kind === 'error' ? 'warning-box' : 'success-box'}>{copyFeedback.text}</div> : null}

        {/* Workspace Tab Switcher */}
        <div
          className="audit-workspace-tabs"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '12px',
            marginBottom: '16px',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            maxWidth: '100%',
            paddingInline: '2px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('trail')}
            style={{
              border: 'none',
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 700,
              background: activeTab === 'trail' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'trail' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: activeTab === 'trail' ? '0 1px 3px rgba(23, 14, 94, 0.2)' : 'none',
              transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <FileTextIcon size={16} />
            <span>{isEn ? 'General Activity & Audit Trail' : t('audit.audit_page.s6', "سجل العمليات والأنشطة العام")}</span>
          </button>

          {showCashierFraudRadar && (
            <button
              type="button"
              onClick={() => setActiveTab('fraudRadar')}
              style={{
                border: 'none',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '13.5px',
                fontWeight: 700,
                background: activeTab === 'fraudRadar' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'fraudRadar' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'fraudRadar' ? '0 1px 3px rgba(23, 14, 94, 0.2)' : 'none',
                transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <ShieldAlertIcon size={16} />
              <span>{isEn ? 'Cashier Fraud & Shrinkage Radar' : t('audit.audit_page.s7', "رادار كشف التلاعب ومنع الخسائر")}</span>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: activeTab === 'fraudRadar' ? '#ef4444' : '#fee2e2',
                  color: activeTab === 'fraudRadar' ? '#ffffff' : '#991b1b',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Radar Live
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('tamperTrail')}
            style={{
              border: 'none',
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 700,
              background: activeTab === 'tamperTrail' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'tamperTrail' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: activeTab === 'tamperTrail' ? '0 1px 3px rgba(23, 14, 94, 0.2)' : 'none',
              transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <ShieldCheckIcon size={16} />
            <span>{isEn ? 'Tamper-Proof Audit Trail (DB Triggers & Hash Chain)' : t('audit.audit_page.s8', "سجل التدقيق الجنائي المشفّر (DB Triggers & Hash Chain)")}</span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: activeTab === 'tamperTrail' ? '#16a34a' : '#dcfce7',
                color: activeTab === 'tamperTrail' ? '#ffffff' : '#15803d',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              Zero Tamper
            </span>
          </button>
        </div>

        {activeTab === 'fraudRadar' && showCashierFraudRadar ? (
          <CashierFraudRadarSection />
        ) : activeTab === 'tamperTrail' ? (
          <TamperAuditTrailTab />
        ) : (
          <section className="document-prototype-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {isEn ? 'Activity & Operations Log' : t('audit.audit_page.s9', "سجل العمليات والأنشطة")}
            </h3>
            <FilterChipGroup value={filterMode} options={auditFilterOptions} onChange={(val) => setFilterMode(val as 'all' | 'today' | 'withDetails')} />
          </div>

          <SearchToolbar search={search} onSearchChange={setSearch} searchPlaceholder={isEn ? 'Search by activity, details, or actor name...' : t('audit.audit_page.s10', "ابحث بالإجراء أو تفاصيل العملية أو اسم المنفذ...")}>
            <Field label={isEn ? 'Activity Type' : t('audit.audit_page.s11', "نوع النشاط")}>
              <CustomSelect
                value={activityTypeFilter}
                onChange={(val) => setActivityTypeFilter(val as typeof activityTypeFilter)}
                options={filteredActivityTypeOptions}
              />
            </Field>
            <Field label={isEn ? 'Employee / Actor' : t('audit.audit_page.s12', "الموظف / المنفذ")}>
              <CustomSelect
                value={selectedUserId}
                onChange={(val) => setSelectedUserId(val)}
                options={[
                  { value: '', label: isEn ? 'All Employees' : t('audit.audit_page.s13', "كافة الموظفين") },
                  ...userOptions.map((user) => ({ value: user.id, label: user.label + (user.role ? ` — ${user.role}` : '') })),
                ]}
              />
            </Field>
          </SearchToolbar>

          <StatsGrid items={stats} className="stats-grid compact-grid audit-stats-grid" />

          <QueryFeedback
            isLoading={query.isLoading || usersQuery.isLoading}
            isError={query.isError || usersQuery.isError}
            error={query.error || usersQuery.error}
            isEmpty={!totalRows || !visibleRows.length}
            loadingText={isEn ? 'Loading activity log...' : t('audit.audit_page.s14', "جاري تحميل سجل النشاط...")}
            errorTitle={isEn ? 'Failed to load activity log' : t('audit.audit_page.s15', "تعذر تحميل سجل النشاط")}
            emptyTitle={!totalRows ? (isEn ? 'No activity records found' : t('audit.audit_page.s16', "لا توجد سجلات نشاط حاليًا")) : (isEn ? 'No activity matching this filter' : t('audit.audit_page.s17', "لا توجد أنشطة مطابقة لهذا الفلتر."))}
            emptyHint={isEn ? 'Operations will appear here once activities occur or after broadening filters.' : t('audit.audit_page.s18', "ستظهر العمليات هنا بمجرد تسجيل أنشطة أو بعد توسيع معايير الفلترة.")}
          >
            {selectedUserLabel ? (
              <div className="muted small" style={{ marginBottom: '8px' }}>
                {isEn ? 'Viewing activity for:' : t('audit.audit_page.s19', "عرض نشاط الموظف:")} <strong>{selectedUserLabel}</strong>
              </div>
            ) : null}

            <DataTable<AuditLog>
              data={visibleRows}
              getRowKey={(row, rowIndex) => String(row.id || row.createdAt || row.created_at || rowIndex)}
              defaultSort={{ columnId: 'date', direction: 'desc' }}
              columns={[
                {
                  id: 'action',
                  header: isEn ? 'Activity & Details' : t('audit.audit_page.s20', "النشاط والتفاصيل"),
                  className: 'audit-col-activity',
                  sortable: true,
                  sortValue: (row) => getAuditActionLabel(row.action || '', isEn),
                  render: (row) => {
                    const activityMeta = getAuditActivityMeta(row, isEn);
                    const actionLabel = getAuditActionLabel(row.action || '', isEn);
                    const rawDetail = formatAuditDetails(row);
                    const detailText = normalizeAuditDetailText(rawDetail, isEn);
                    return (
                      <div className="audit-action-cell" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div className="audit-action-head" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`audit-activity-badge ${activityMeta.badgeClass}`}>
                            {activityMeta.label}
                          </span>
                          <strong className="audit-action-label" style={{ fontSize: '13px', color: '#0f172a' }}>
                            {actionLabel}
                          </strong>
                        </div>
                        {detailText && detailText !== '—' && (
                          <span 
                            className="audit-detail-text" 
                            style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5, wordBreak: 'break-word' }}
                            title={detailText}
                          >
                            {detailText}
                          </span>
                        )}
                      </div>
                    );
                  },
                },
                {
                  id: 'user',
                  header: isEn ? 'Actor' : t('audit.audit_page.s21', "المنفذ"),
                  className: 'audit-col-user',
                  sortable: true,
                  sortValue: (row) => normalizeAuditUserDisplay(row),
                  render: (row) => {
                    const userName = normalizeAuditUserDisplay(row);
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
                          {userName}
                        </span>
                      </div>
                    );
                  },
                },
                {
                  id: 'date',
                  header: isEn ? 'Date & Time' : t('audit.audit_page.s22', "التاريخ والوقت"),
                  className: 'audit-col-date',
                  sortable: true,
                  sortValue: (row) => row.createdAt || row.created_at || '',
                  render: (row) => (
                    <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {formatDate(row.createdAt || row.created_at || '')}
                    </span>
                  ),
                }
              ]}
            />

            <PaginationControls
              page={pagination?.page || 1}
              totalPages={pagination?.totalPages || 1}
              pageSize={pagination?.pageSize || pageSize}
              pageSizeOptions={[25, 50, 100, 200]}
              totalItems={totalRows}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onPageChange={setPage}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
              itemLabel={isEn ? 'Record' : t('audit.audit_page.s23', "سجل")}
            />
          </QueryFeedback>
        </section>
      )}
      </main>
    </div>
  );
}
