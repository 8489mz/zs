import { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsApi, type ManagedUserRecord, type PlanLimitInfo } from '@/features/settings/api/settings.api';
import { blankUserDraft, getPermissionLabel, normalizeUserRecord, splitPermissionsByActorGrant } from '@/features/settings/components/user-management.shared';
import {
  applyRolePermissions,
  buildTemplateDraft,
  toggleDraftBranch,
  toggleDraftPermission,
  validateUserDraft,
} from '@/features/settings/hooks/useUserManagement.helpers';
import { useSettingsUsersPageQuery } from '@/features/settings/hooks/useSettingsUsersPageQuery';
import { runUserBulkAction } from '@/features/settings/hooks/user-management/user-management.bulk-actions';
import { useUserManagementEffects } from '@/features/settings/hooks/user-management/useUserManagementEffects';
import { useUserManagementMutation } from '@/features/settings/hooks/user-management/useUserManagementMutation';
import type { UserBulkAction } from '@/features/settings/hooks/user-management/user-management.types';
import type { SetupStepKey } from '@/features/settings/hooks/useFirstRunSetupFlow';
import { useAuthStore } from '@/stores/auth-store';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import type { Branch } from '@/types/domain';
import { SINGLE_STORE_MODE } from '@/config/product-scope';

export type { UserBulkAction } from '@/features/settings/hooks/user-management/user-management.types';

export function useUserManagementController({
  branches = [],
  setupMode = false,
  setupStepKey = null,
  onSetupAdvance,
}: {
  branches?: Branch[];
  setupMode?: boolean;
  setupStepKey?: SetupStepKey | null;
  onSetupAdvance?: () => void;
}) {
  const currentUserId = useAuthStore((state) => state.user?.id || '');
  const currentUserRole = useAuthStore((state) => state.user?.role || 'cashier');
  // INV-USER-GRANT-NAMES-PERMISSION: the actor's own permissions are
  // the second layer (after vertical scoping) that keeps a save from
  // ever carrying a permission the actor does not hold — a visible
  // permission the actor lacks is never pre-ticked, so creating an
  // owner/admin with the standard template cannot fail the grant
  // guard for a permission the merchant could see but not grant.
  const actorPermissions = useAuthStore((state) => state.user?.permissions);
  const tenant = useAuthStore((state) => state.tenant);
  const vertical = resolveCurrentVertical(tenant);
  const [selectedUserKey, setSelectedUserKey] = useState('');
  const [draft, setDraft] = useState<ManagedUserRecord>(() => {
    const initial = blankUserDraft('cashier', vertical);
    if (!SINGLE_STORE_MODE && branches && branches.length === 1) {
      initial.branchIds = [branches[0].id];
      initial.defaultBranchId = branches[0].id;
    }
    return initial;
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'super-admins' | 'admins' | 'cashiers' | 'inactive' | 'locked'>('all');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [bulkAction, setBulkAction] = useState<UserBulkAction | null>(null);
  const usersQuery = useSettingsUsersPageQuery({ page, pageSize, search: userSearch, filter: userFilter });

  const usersRows = useMemo(() => {
    const data = usersQuery.data as Record<string, unknown> | undefined;
    const rows = (data?.rows || data?.users || []) as ManagedUserRecord[];
    return Array.isArray(rows) ? rows : [];
  }, [usersQuery.data]);

  const managedUsers = useMemo(() => usersRows.map(normalizeUserRecord), [usersRows]);
  const selectedSourceUser = useMemo(() => managedUsers.find((user) => String(user.id) === selectedUserKey) || null, [managedUsers, selectedUserKey]);

  const userSummary = useMemo(() => {
    const summary = (((usersQuery.data as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined) || {});
    return {
      totalItems: Number(summary.totalItems ?? summary.total ?? managedUsers.length ?? 0),
      superAdmins: Number(summary.superAdmins ?? 0),
      admins: Number(summary.admins ?? 0),
      cashiers: Number(summary.cashiers ?? 0),
      inactive: Number(summary.inactive ?? 0),
      locked: Number(summary.locked ?? 0),
      activePrivilegedUsers: Number(summary.activePrivilegedUsers ?? 0),
    };
  }, [usersQuery.data, managedUsers.length]);

  const planLimit = useMemo(() => {
    return ((usersQuery.data as any)?.planLimit || null) as PlanLimitInfo | null;
  }, [usersQuery.data]);

  const selectedUsers = useMemo(() => managedUsers.filter((user) => selectedIds.includes(String(user.id || user.username))), [managedUsers, selectedIds]);
  const activeAddedUsers = useMemo(() => managedUsers.filter((user) => user.isActive !== false && String(user.id) !== currentUserId), [managedUsers, currentUserId]);
  const activePrivilegedUsers = useMemo(
    () => managedUsers.filter((user) => user.isActive !== false && (user.role === 'admin' || user.role === 'super_admin')),
    [managedUsers],
  );

  const disableProtectionByUserId = useMemo(() => {
    const map = new Map<string, 'super_admin' | 'current_user' | 'last_active_privileged'>();
    const disableCandidateAdmins = selectedUsers.filter((user) => {
      const id = String(user.id || '');
      return id && id !== currentUserId && user.role === 'admin' && user.isActive !== false;
    });
    const remainingPrivilegedIfDisable = activePrivilegedUsers.length - disableCandidateAdmins.length;
    const shouldProtectLastPrivileged = remainingPrivilegedIfDisable < 1 && disableCandidateAdmins.length > 0;

    for (const user of selectedUsers) {
      const id = String(user.id || '');
      if (!id) continue;
      if (user.role === 'super_admin') {
        map.set(id, 'super_admin');
        continue;
      }
      if (id === currentUserId) {
        map.set(id, 'current_user');
        continue;
      }
      if (shouldProtectLastPrivileged && user.role === 'admin' && user.isActive !== false) {
        map.set(id, 'last_active_privileged');
      }
    }
    return map;
  }, [selectedUsers, currentUserId, activePrivilegedUsers.length]);

  const disableBulkSummary = useMemo(() => {
    const selectedCount = selectedUsers.length;
    const protectedUsers = selectedUsers.filter((user) => disableProtectionByUserId.has(String(user.id || '')));
    const disableEligibleUsers = selectedUsers.filter((user) => !disableProtectionByUserId.has(String(user.id || '')));
    const reasonLabels: Record<'super_admin' | 'current_user' | 'last_active_privileged', string> = {
      super_admin: 'سوبر أدمن',
      current_user: 'الحساب الحالي',
      last_active_privileged: 'آخر حساب إداري فعّال',
    };
    const reasonCounts: Record<string, number> = {};
    for (const user of protectedUsers) {
      const key = disableProtectionByUserId.get(String(user.id || ''));
      if (!key) continue;
      reasonCounts[reasonLabels[key]] = Number(reasonCounts[reasonLabels[key]] || 0) + 1;
    }
    const reasonSummaries = Object.entries(reasonCounts).map(([reason, count]) => `${reason} (${count})`);
    return {
      selectedCount,
      disableEligibleCount: disableEligibleUsers.length,
      protectedCount: protectedUsers.length,
      canRunDisable: disableEligibleUsers.length > 0,
      reasonSummaries,
      helperText: protectedUsers.length ? 'سيتم تخطي الحسابات المحمية عند تنفيذ الإيقاف.' : '',
    };
  }, [selectedUsers, disableProtectionByUserId]);

  const loadUser = useCallback((user?: ManagedUserRecord | null) => {
    if (!user) return;
    setSelectedUserKey(user.id ? String(user.id) : '__new__');
    setDraft(normalizeUserRecord(user, vertical));
    setActiveTemplate(null);
    setStatusMessage('');
  }, [vertical]);

  const startNewUser = useCallback((role: 'super_admin' | 'admin' | 'cashier' = 'cashier') => {
    setSelectedUserKey('__new__');
    const newDraft = blankUserDraft(role, vertical);
    const split = splitPermissionsByActorGrant(newDraft.permissions, actorPermissions);
    newDraft.permissions = split.granted;
    if (!SINGLE_STORE_MODE && branches && branches.length === 1) {
      newDraft.branchIds = [branches[0].id];
      newDraft.defaultBranchId = branches[0].id;
    } else {
      newDraft.branchIds = [];
      newDraft.defaultBranchId = '';
    }
    setDraft(newDraft);
    setActiveTemplate(null);
    setStatusMessage('');
  }, [vertical, branches, actorPermissions]);

  useEffect(() => {
    if (selectedUserKey === '__new__' && !SINGLE_STORE_MODE && branches && branches.length === 1) {
      setDraft((current) => {
        if (!current.id && (!current.branchIds || current.branchIds.length === 0)) {
          return {
            ...current,
            branchIds: [branches[0].id],
            defaultBranchId: branches[0].id,
          };
        }
        return current;
      });
    }
  }, [selectedUserKey, branches]);

  function applyTemplate(templateKey: 'cashier' | 'owner' | 'inventory' | 'accountant') {
    const template = buildTemplateDraft(draft, templateKey, vertical);
    const split = splitPermissionsByActorGrant(template.nextDraft.permissions, actorPermissions);
    setDraft({ ...template.nextDraft, permissions: split.granted });
    setActiveTemplate(templateKey);
    // Name what was left unticked in the same plain Arabic words the
    // form shows, so the merchant knows exactly why those boxes are
    // empty instead of wondering.
    setStatusMessage(split.withheld.length
      ? `تم تطبيق ${template.label}. لم تُعلَّم هذه الصلاحيات لأن حسابك لا يملكها: ${split.withheld.map((permission) => getPermissionLabel(permission, vertical)).join('، ')}.`
      : `تم تطبيق ${template.label}.`);
  }

  useUserManagementEffects({
    managedUsers,
    selectedUserKey,
    setSelectedUserKey,
    loadUser,
    setDraft,
    setPage,
    setSelectedIds,
    userSearch,
    userFilter,
    setupMode,
    setupStepKey,
    currentUserId,
    operationalAdminsCount: activeAddedUsers.length,
    startNewUser,
  });

  const actionMutation = useUserManagementMutation({
    draft,
    setupMode,
    setupStepKey,
    currentUserId,
    loadUser,
    startNewUser,
    onSetupAdvance,
    setDeleteDialogOpen,
    setSelectedIds: (value) => setSelectedIds(value),
    setStatusMessage,
    setUserSearch,
    setUserFilter,
    setPage,
  });

  const canDeleteSelected = Boolean(draft.id && managedUsers.length > 1 && String(draft.id) !== currentUserId);
  const canUnlockSelected = Boolean(draft.id && draft.lockedUntil);
  const isCurrentUserSelected = Boolean(draft.id && String(draft.id) === currentUserId);
  type DisableProtectionReason = 'super_admin' | 'current_user' | 'last_active_privileged';
  const selectedDraftDisableProtection = useMemo<DisableProtectionReason | null>(() => {
    const id = String(draft.id || '');
    if (!id) return null;
    if (draft.role === 'super_admin') return 'super_admin';
    if (id === currentUserId) return 'current_user';
    if (draft.role === 'admin' && draft.isActive !== false && activePrivilegedUsers.length <= 1) return 'last_active_privileged';
    return null;
  }, [draft.id, draft.role, draft.isActive, currentUserId, activePrivilegedUsers.length]);
  const canDirectlyDisableSelected = !selectedDraftDisableProtection;

  function applyDefaultPermissions(role: 'super_admin' | 'admin' | 'cashier') {
    setDraft((current) => {
      const split = splitPermissionsByActorGrant(applyRolePermissions(role, vertical), actorPermissions);
      return { ...current, role, permissions: split.granted };
    });
  }

  function togglePermission(permission: string) {
    setDraft((current) => toggleDraftPermission(current, permission));
  }

  function toggleBranch(branchId: string) {
    setDraft((current) => toggleDraftBranch(current, branchId));
  }

  function resetSelectedDraft() {
    if (selectedUserKey === '__new__') {
      startNewUser(draft.role);
      return;
    }
    if (selectedSourceUser) loadUser(selectedSourceUser);
  }

  async function saveCurrentDraft() {
    try {
      setStatusMessage('');
      const normalizedDraft = validateUserDraft({ draft, managedUsers, branches, vertical });
      await actionMutation.mutateAsync(normalizedDraft.id ? { type: 'update', id: String(normalizedDraft.id), payload: normalizedDraft } : { type: 'create', payload: normalizedDraft });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'تعذر حفظ المستخدم');
    }
  }

  async function unlockSelectedUser() {
    if (!draft.id) return;
    try {
      setStatusMessage('');
      await actionMutation.mutateAsync({ type: 'unlock', id: String(draft.id) });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'تعذر فتح قفل المستخدم');
    }
  }

  async function deleteSelectedUser(payload: { managerPin: string }) {
    if (!draft.id) return;
    try {
      setStatusMessage('');
      await actionMutation.mutateAsync({ type: 'delete', id: String(draft.id), managerPin: payload.managerPin });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'تعذر حذف المستخدم');
    }
  }

  async function copyPermissions() {
    try {
      await navigator.clipboard?.writeText((draft.permissions || []).join(', '));
      setStatusMessage('تم نسخ الصلاحيات الحالية.');
    } catch {
      setStatusMessage('تعذر نسخ الصلاحيات من المتصفح الحالي.');
    }
  }

  async function runBulkAction() {
    try {
      setStatusMessage('');
      if (bulkAction === 'deactivate' && !disableBulkSummary.canRunDisable) {
        setStatusMessage('لا يوجد مستخدم قابل للإيقاف ضمن التحديد الحالي.');
        setBulkAction(null);
        return;
      }
      const hasRun = await runUserBulkAction({
        bulkAction,
        selectedUsers,
        currentUserId,
        userSummary,
        setStatusMessage,
        settingsApi,
      });
      if (!hasRun) return;
      await usersQuery.refetch();
      setBulkAction(null);
      setSelectedIds([]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'تعذر تنفيذ العملية الجماعية على المستخدمين');
    }
  }

  function openBulkAction(action: UserBulkAction) {
    if (action === 'deactivate' && !disableBulkSummary.canRunDisable) {
      setStatusMessage('لا يوجد مستخدم قابل للإيقاف ضمن التحديد الحالي.');
      return;
    }
    setBulkAction(action);
  }

  return {
    currentUserRole,
    usersQuery,
    managedUsers,
    userSummary,
    disableBulkSummary,
    selectedUsers,
    selectedUserKey,
    setSelectedUserKey,
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
  };
}
