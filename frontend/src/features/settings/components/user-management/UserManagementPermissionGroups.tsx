import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { getFilteredPermissionGroups, getPermissionLabel } from '@/features/settings/components/user-management.shared';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';

export function UserManagementBranchAccess({
  branches,
  selectedBranchIds,
  onToggleBranch,
}: {
  branches: Array<{ id: string; name: string }>;
  selectedBranchIds: string[];
  onToggleBranch: (branchId: string) => void;
}) {
  const { t } = useTranslation();
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const title = vertical === 'maritime'
    ? 'المقرات والمكاتب الملاحية المسموح بها'
    : vertical === 'contracting'
    ? 'المقرات ومواقع العمل المسموح بها'
    : 'الفروع المسموح بها';
  const emptyHint = vertical === 'maritime'
    ? 'أضف مقراً ملاحياً أولاً من أعلى الإعدادات.'
    : vertical === 'contracting'
    ? 'أضف موقع عمل أو مقراً أولاً من أعلى الإعدادات.'
    : 'أضف فرعًا أولًا من أعلى الإعدادات.';

  const isMandatoryNotice = branches.length > 1 && selectedBranchIds.length === 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '2px 0' }}>
      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
        {title}:
        <span style={{ color: '#dc2626', marginInlineStart: '2px' }} title={t('settings.user_management.user_management_permission_groups.s0', "إلزامي")}>*</span>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {branches.length ? branches.map((branch) => {
          const isChecked = selectedBranchIds.includes(branch.id);
          return (
            <label key={branch.id} style={{
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 8px',
              borderRadius: '6px',
              border: isChecked ? '1px solid #170e5e' : '1px solid #cbd5e1',
              background: isChecked ? '#f1f5f9' : '#ffffff',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: isChecked ? '#170e5e' : '#0f172a',
              userSelect: 'none',
              boxShadow: isChecked ? '0 1px 2px rgba(23, 14, 94, 0.08)' : 'none',
            }}>
              <input
                type="checkbox"
                style={{ width: 14, height: 14, margin: 0, accentColor: '#170e5e', cursor: 'pointer' }}
                checked={isChecked}
                onChange={() => onToggleBranch(branch.id)}
              />
              <span>{branch.name}</span>
            </label>
          );
        }) : <span className="muted small" style={{ fontSize: '0.72rem' }}>{emptyHint}</span>}
        {isMandatoryNotice ? (
          <span style={{ fontSize: '0.70rem', color: '#dc2626', fontWeight: 600 }}>
            {vertical === 'maritime'
              ? t('settings.user_management.user_management_permission_groups.s1', "(اختر مقراً ملاحياً واحداً على الأقل لتسري الصلاحيات عليه)")
              : vertical === 'contracting'
              ? t('settings.user_management.user_management_permission_groups.s2', "(اختر موقع عمل أو مقراً واحداً على الأقل لتسري الصلاحيات عليه)")
              : t('settings.user_management.user_management_permission_groups.s3', "(اختر فرعاً واحداً على الأقل لتسري الصلاحيات عليه)")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function UserManagementPermissionGroups({
  permissions,
  role,
  onTogglePermission,
}: {
  permissions: string[];
  role: 'super_admin' | 'admin' | 'cashier';
  onTogglePermission: (permission: string) => void;
}) {
  const { t } = useTranslation();
  const tenant = useAuthStore((s) => s.tenant);
  const vertical = resolveCurrentVertical(tenant);
  // INV-USER-GRANT-NAMES-PERMISSION: the actor's own permissions.
  // A permission the actor does not hold cannot be granted
  // (INV-USER-GRANT-SUBSET), so its box stays untickable while it is
  // unchecked; a checked one stays enabled so it can always be
  // REMOVED (removing never needs the grant). Unknown actor (no
  // session permissions — first-run setup) disables nothing.
  const actorPermissions = useAuthStore((s) => s.user?.permissions);
  const canGrant = (permission: string): boolean =>
    !actorPermissions || actorPermissions.includes('*') || actorPermissions.includes(permission);

  const visibleGroups = useMemo(() => {
    return getFilteredPermissionGroups(tenant?.features, vertical);
  }, [tenant?.features, vertical]);

  const ungrantableVisible = useMemo(
    () => visibleGroups.flatMap((group) => group.items).filter((permission) => !permissions.includes(permission) && !canGrant(permission)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleGroups, permissions, actorPermissions],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155' }}>{t('settings.user_management.user_management_permission_groups.s4', "مجموعات الصلاحيات التفصيلية")}</span>
        {tenant?.features && tenant.features.length > 0 ? (
          <span style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, border: '1px solid #bfdbfe' }}>
            {t('settings.user_management.user_management_permission_groups.s5', "مخصصة وفق باقة المنشأة الحالية")}
          </span>
        ) : null}
      </div>

      {/* INV-USER-GRANT-NAMES-PERMISSION: name the boxes the actor
        cannot grant in the same plain Arabic words the form shows,
        so the merchant sees why they are greyed out instead of
        guessing — and knows to ask the platform owner for them. */}
      {ungrantableVisible.length > 0 ? (
        <div style={{ padding: '8px 10px', border: '1px solid #fde68a', borderRadius: '8px', background: '#fffbeb', fontSize: '0.76rem', color: '#92400e', lineHeight: 1.7 }}>
          <strong>صلاحيات لا يملكها حسابك فلا يمكنك منحها: </strong>
          {ungrantableVisible.map((permission) => getPermissionLabel(permission, vertical)).join('، ')}
          <span> — لو احتاجها المستخدم الجديد، اطلبها من مالك المنصة.</span>
        </div>
      ) : null}

      {/* Balanced 3-Column Layout: Primary operations group spans 2 cols, filling row 1 & row 2 with zero gaps */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: visibleGroups.length === 5 ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '6px',
        alignItems: 'stretch'
      }}>
        {visibleGroups.map((group, groupIdx) => {
          const isMainOpsGroup = groupIdx === 0 && visibleGroups.length === 5;
          const activeInGroup = group.items.filter((p) => permissions.includes(p)).length;
          return (
            <div
              key={group.title}
              style={{
                gridColumn: isMainOpsGroup ? 'span 2' : 'span 1',
                padding: '6px 8px',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                background: '#fafbfc',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <strong style={{ fontSize: '0.76rem', color: '#0f172a', fontWeight: 800 }}>{group.title}</strong>
                <span style={{
                  fontSize: '0.66rem',
                  background: activeInGroup > 0 ? '#dcfce7' : '#f1f5f9',
                  color: activeInGroup > 0 ? '#166534' : '#64748b',
                  padding: '1px 5px',
                  borderRadius: '6px',
                  fontWeight: 700
                }}>
                  {activeInGroup} / {group.items.length} {t('settings.user_management.user_management_permission_groups.s6', "مفعّل")}
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMainOpsGroup
                  ? 'repeat(auto-fill, minmax(210px, 1fr))'
                  : 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '5px',
                flex: 1,
              }}>
                {group.items.map((permission) => {
                  const isChecked = permissions.includes(permission);
                  const isDisabled = !isChecked && !canGrant(permission);
                  return (
                    <label
                      key={permission}
                      title={`${getPermissionLabel(permission, vertical)} (${permission})${isDisabled ? ' — لا يملكها حسابك فلا يمكنك منحها' : ''}`}
                      style={{
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 8px',
                        minHeight: '32px',
                        borderRadius: '6px',
                        border: isChecked ? '1px solid #86efac' : '1px solid #e2e8f0',
                        background: isDisabled ? '#f8fafc' : isChecked ? '#f0fdf4' : '#ffffff',
                        boxSizing: 'border-box',
                        userSelect: 'none',
                        transition: 'all 0.12s ease',
                        opacity: isDisabled ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={isDisabled}
                        style={{
                          width: 15,
                          height: 15,
                          margin: 0,
                          accentColor: '#166534',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          flexShrink: 0
                        }}
                        checked={isChecked}
                        onChange={() => onTogglePermission(permission)}
                      />
                      <span style={{
                        fontWeight: isChecked ? 700 : 500,
                        fontSize: '0.74rem',
                        color: isChecked ? '#14532d' : '#1e293b',
                        lineHeight: 1.35,
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                      }}>
                        {getPermissionLabel(permission, vertical)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* بطاقة خاصة ومستقلة للسوبر أدمن (إدارة المنصة المركزية) */}
      {role === 'super_admin' ? (
        <div style={{
          padding: '14px 16px',
          border: '1px solid #fde68a',
          borderRadius: '10px',
          background: '#fffdf5',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          marginTop: '6px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
              </svg>
              <strong style={{ fontSize: '0.88rem', color: '#92400e', fontWeight: 800 }}>
                {t('settings.user_management.user_management_permission_groups.s7', "خاص بالسوبر أدمن (إدارة المنصة المركزية)")}
              </strong>
            </div>
            <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '8px', fontWeight: 700, border: '1px solid #fde68a' }}>
              {t('settings.user_management.user_management_permission_groups.s8', "صلاحية منصة شاملة")}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.76rem', color: '#78350f', lineHeight: 1.6 }}>
            {t('settings.user_management.user_management_permission_groups.s9', "هذا الحساب يملك رتبة")} <strong>{t('settings.user_management.user_management_permission_groups.s10', "سوبر أدمن المنصة")}</strong>{t('settings.user_management.user_management_permission_groups.s11', "؛ تشمل صلاحياته الحصرية الوصول للوحة تحكم المستأجرين (SaaS Tenants)، إدارة وتعديل الباقات والاشتراكات، والتحكم في إعدادات السيرفر وقواعد البيانات المركزية.")}
          </p>
        </div>
      ) : null}
    </div>
  );
}


