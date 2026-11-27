import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { USER_ROLE_TEMPLATES } from '@/features/settings/components/user-management.shared';
import type { UserBulkAction } from '@/features/settings/hooks/useUserManagementController';
import { isPlatformAdmin } from '@/shared/system/runtime-environment';
import { useAuthStore } from '@/stores/auth-store';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';

export function UserManagementQuickActions({
  setupMode,
  onNewUser: _onNewUser,
  onApplyRolePermissions,
  onApplyTemplate,
  activeTemplate,
  onCopyPermissions,
}: {
  setupMode?: boolean;
  onNewUser: () => void;
  onApplyRolePermissions: () => void;
  onApplyTemplate: (templateKey: keyof typeof USER_ROLE_TEMPLATES) => void;
  activeTemplate?: string | null;
  onCopyPermissions: () => void;
}) {
  const { t } = useTranslation();
  const tenant = useAuthStore((s) => s.tenant);

  if (setupMode) return null;

  const vertical = resolveCurrentVertical(tenant);
  const isMaritime = vertical === 'maritime';
  const isContracting = vertical === 'contracting';

  return (
    <div
      className="settings-users-template-strip"
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        padding: '8px 12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        marginBottom: '12px',
        maxWidth: '100%',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginInlineEnd: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>{t('settings.user_management.user_management_list_controls.s0', "قوالب الصلاحيات السريعة:")}</span>
      <Button
        type="button"
        variant="secondary"
        style={{ fontSize: '11.5px', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
        onClick={onApplyRolePermissions}
      >
        {t('settings.user_management.user_management_list_controls.s1', "تطبيق صلاحيات الدور")}
      </Button>
      <Button
        type="button"
        variant={activeTemplate === 'cashier' ? 'primary' : 'secondary'}
        style={{
          fontSize: '11.5px',
          padding: '4px 10px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...(activeTemplate === 'cashier' ? { outline: '2px dashed var(--primary-color, #170c5c)', outlineOffset: '2px' } : {}),
        }}
        onClick={() => onApplyTemplate('cashier')}
      >
        {isMaritime ? t('settings.user_management.user_management_list_controls.s2', "قالب عمليات") : isContracting ? t('settings.user_management.user_management_list_controls.s3', "قالب مشاريع") : t('settings.user_management.user_management_list_controls.s4', "قالب كاشير")}
      </Button>
      <Button
        type="button"
        variant={activeTemplate === 'owner' ? 'primary' : 'secondary'}
        style={{
          fontSize: '11.5px',
          padding: '4px 10px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...(activeTemplate === 'owner' ? { outline: '2px dashed var(--primary-color, #170c5c)', outlineOffset: '2px' } : {}),
        }}
        onClick={() => onApplyTemplate('owner')}
      >
        {isMaritime ? t('settings.user_management.user_management_list_controls.s5', "قالب مدير ملاحي") : isContracting ? t('settings.user_management.user_management_list_controls.s6', "قالب مدير عام") : t('settings.user_management.user_management_list_controls.s7', "قالب مالك")}
      </Button>
      <Button
        type="button"
        variant={activeTemplate === 'inventory' ? 'primary' : 'secondary'}
        style={{
          fontSize: '11.5px',
          padding: '4px 10px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...(activeTemplate === 'inventory' ? { outline: '2px dashed var(--primary-color, #170c5c)', outlineOffset: '2px' } : {}),
        }}
        onClick={() => onApplyTemplate('inventory')}
      >
        {isMaritime ? t('settings.user_management.user_management_list_controls.s8', "قالب حاويات ومستودعات") : isContracting ? t('settings.user_management.user_management_list_controls.s9', "قالب تشوين ومهمات") : t('settings.user_management.user_management_list_controls.s10', "قالب مخزن")}
      </Button>
      <Button
        type="button"
        variant={activeTemplate === 'accountant' ? 'primary' : 'secondary'}
        style={{
          fontSize: '11.5px',
          padding: '4px 10px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...(activeTemplate === 'accountant' ? { outline: '2px dashed var(--primary-color, #170c5c)', outlineOffset: '2px' } : {}),
        }}
        onClick={() => onApplyTemplate('accountant')}
      >
        {isMaritime ? t('settings.user_management.user_management_list_controls.s11', "قالب محاسب نولون") : isContracting ? t('settings.user_management.user_management_list_controls.s12', "قالب محاسب مشاريع") : t('settings.user_management.user_management_list_controls.s13', "قالب محاسب")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        style={{ fontSize: '11.5px', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
        onClick={onCopyPermissions}
      >
        {t('settings.user_management.user_management_list_controls.s14', "نسخ الصلاحيات")}
      </Button>
    </div>
  );
}

export function UserManagementStatsFilters({
  summary,
  userSearch,
  userFilter,
  onUserSearchChange,
  onUserFilterChange,
}: {
  summary: { totalItems: number; superAdmins: number; admins: number; cashiers: number; inactive: number; locked: number; };
  userSearch: string;
  userFilter: 'all' | 'super-admins' | 'admins' | 'cashiers' | 'inactive' | 'locked';
  onUserSearchChange: (value: string) => void;
  onUserFilterChange: (value: 'all' | 'super-admins' | 'admins' | 'cashiers' | 'inactive' | 'locked') => void;
}) {
  const { t } = useTranslation();
  const isPlatform = isPlatformAdmin(useAuthStore.getState().user);
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const isMaritime = vertical === 'maritime';
  const isContracting = vertical === 'contracting';

  const adminsStatLabel = isMaritime ? 'مديرو العمليات' : isContracting ? 'مديرو المشاريع' : 'مديرو النظام';
  const cashiersStatLabel = isMaritime ? 'مسؤولو العمليات والتتبع' : isContracting ? 'مهندسو الموقع' : 'الكاشير';

  return (
    <>
      <div className="stats-grid settings-users-stats-grid" style={{ marginBottom: 8 }}>
        <div className="stat-card"><span>{t('settings.user_management.user_management_list_controls.s15', "الإجمالي")}</span><strong>{summary.totalItems}</strong></div>
        {isPlatform ? <div className="stat-card"><span>{t('settings.user_management.user_management_list_controls.s16', "السوبر أدمن")}</span><strong>{summary.superAdmins}</strong></div> : null}
        <div className="stat-card"><span>{adminsStatLabel}</span><strong>{summary.admins}</strong></div>
        <div className="stat-card"><span>{cashiersStatLabel}</span><strong>{summary.cashiers}</strong></div>
        <div className="stat-card"><span>{t('settings.user_management.user_management_list_controls.s17', "الموقوفون")}</span><strong>{summary.inactive}</strong></div>
      </div>
      <div className="page-stack settings-users-filters" style={{ gap: 8, marginBottom: 8 }}>
        <Field label={t('settings.user_management.user_management_list_controls.s18', "بحث سريع")}>
          <input value={userSearch} onChange={(e) => onUserSearchChange(e.target.value)} placeholder={t('settings.user_management.user_management_list_controls.s19', "ابحث بالاسم أو المستخدم أو الصلاحية")} />
        </Field>
        <div className="filter-chip-row" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', WebkitOverflowScrolling: 'touch' }}>
          {[
            ['all', t('settings.user_management.user_management_list_controls.s20', "الكل")],
            ...(isPlatform ? [['super-admins', t('settings.user_management.user_management_list_controls.s21', "السوبر أدمن")]] : []),
            ['admins', adminsStatLabel],
            ['cashiers', cashiersStatLabel],
            ['inactive', t('settings.user_management.user_management_list_controls.s22', "الموقوفون")],
            ['locked', t('settings.user_management.user_management_list_controls.s23', "المقفلون")]
          ].map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={userFilter === value ? 'primary' : 'secondary'}
              style={{ fontSize: '11.5px', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
              onClick={() => onUserFilterChange(value as 'all' | 'super-admins' | 'admins' | 'cashiers' | 'inactive' | 'locked')}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}

export function UserManagementBulkToolbar({
  selectedIds,
  onSelectedIdsChange,
  onBulkAction,
  disableBulkSummary,
}: {
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onBulkAction: (action: UserBulkAction) => void;
  disableBulkSummary: {
    selectedCount: number;
    disableEligibleCount: number;
    protectedCount: number;
    canRunDisable: boolean;
    reasonSummaries: string[];
    helperText: string;
  };
}) {
  const { t } = useTranslation();
  if (!selectedIds.length) return null;
  return (
    <div className="bulk-toolbar">
      <div className="bulk-toolbar-meta">
        <strong>{t('settings.user_management.user_management_list_controls.s24', "تحديد نشط:")} {selectedIds.length}</strong>
        <span className="muted small">
          {t('settings.user_management.user_management_list_controls.s25', "يمكنك فتح القفل للحسابات المحددة، فرض تغيير كلمة المرور، أو إيقاف الحسابات المسموح بها.")}
          {disableBulkSummary.helperText ? ` ${disableBulkSummary.helperText}` : ''}
        </span>
        {disableBulkSummary.protectedCount > 0 ? (
          <span className="muted small">
            {t('settings.user_management.user_management_list_controls.s26', "قابل للإيقاف:")} {disableBulkSummary.disableEligibleCount} {t('settings.user_management.user_management_list_controls.s27', "· محمي:")} {disableBulkSummary.protectedCount}
            {disableBulkSummary.reasonSummaries.length ? ` · ${disableBulkSummary.reasonSummaries.join(t('settings.user_management.user_management_list_controls.s28', "، "))}` : ''}
          </span>
        ) : null}
      </div>
      <div className="actions compact-actions">
        <Button type="button" variant="secondary" onClick={() => onSelectedIdsChange([])}>{t('settings.user_management.user_management_list_controls.s29', "مسح التحديد")}</Button>
        <Button type="button" variant="secondary" onClick={() => onBulkAction('unlock')}>{t('settings.user_management.user_management_list_controls.s30', "فتح القفل")}</Button>
        <Button type="button" variant="secondary" onClick={() => onBulkAction('require-password-change')}>{t('settings.user_management.user_management_list_controls.s31', "فرض تغيير كلمة المرور")}</Button>
        <Button type="button" variant="danger" onClick={() => onBulkAction('deactivate')} disabled={!disableBulkSummary.canRunDisable}>{t('settings.user_management.user_management_list_controls.s32', "إيقاف المحدد")}</Button>
      </div>
    </div>
  );
}
