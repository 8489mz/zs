/*
 * INV-USER-GRANT-NAMES-PERMISSION: the owner/admin template must be
 * scoped to the tenant's vertical, and a template must never
 * pre-tick a permission the actor does not hold.
 *
 * The corrected diagnosis: DEFAULT_ADMIN_PERMS is 57 keys = the 45
 * retail keys the activation owner holds PLUS 12 hidden
 * maritime/contracting keys that no retail tenant contains. The form
 * only shows the tenant's vertical, so those 12 boxes never existed
 * on screen — yet the draft carried them and the grant guard refused
 * the whole save. These cases drive the real template helpers:
 * the retail owner template is exactly the 45-key activation set,
 * a maritime tenant adds back only its own 6 keys (51), a
 * contracting tenant only its own 6 (51), and the actor split
 * never pre-ticks a permission the actor lacks.
 */

import { describe, expect, it } from 'vitest';
import {
  blankUserDraft,
  getAdminTemplatePermissions,
  getUserRoleTemplates,
  splitPermissionsByActorGrant,
  USER_ROLE_TEMPLATES,
} from '@/features/settings/components/user-management.shared';

/* The activation owner's set, verbatim from
 * backend/src/core/auth/constants/super-admin-permissions.ts
 * (activation.service.ts grants exactly this to the owner admin). */
const ACTIVATION_OWNER_PERMISSIONS = [
  'dashboard', 'products', 'sales', 'kitchen', 'purchases', 'inventory', 'suppliers', 'customers', 'accounts', 'accounting', 'returns', 'reports', 'audit', 'treasury', 'services', 'hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryView', 'hrSalaryManage', 'settings', 'pricingCenterView', 'pricingCenterManage', 'canEditUsers', 'canManageUsers', 'canManageSettings', 'canManageBackups', 'canPrint', 'canDiscount', 'canEditPrice', 'canSellWholesale', 'canViewProfit', 'canDelete', 'canEditInvoices', 'canDirectReturn', 'canAdjustInventory', 'canManageBranchStock', 'cashDrawer', 'deliveryReps', 'crm',
];

const MARITIME_KEYS = ['maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'maritimePolicies'];
const CONTRACTING_KEYS = ['contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors'];

describe('owner template is scoped to the tenant vertical (INV-USER-GRANT-NAMES-PERMISSION)', () => {
  it('retail owner template is exactly the 45-key activation set — no hidden vertical key', () => {
    const owner = USER_ROLE_TEMPLATES.owner;
    expect(owner.role).toBe('admin');
    expect([...owner.permissions].sort()).toEqual([...ACTIVATION_OWNER_PERMISSIONS].sort());
    expect(owner.permissions).toHaveLength(45);
    for (const key of [...MARITIME_KEYS, ...CONTRACTING_KEYS]) {
      expect(owner.permissions).not.toContain(key);
    }
  });

  it('maritime owner template adds back only its own 6 keys (51)', () => {
    const owner = getUserRoleTemplates('maritime').owner;
    expect(owner.permissions).toHaveLength(51);
    for (const key of MARITIME_KEYS) expect(owner.permissions).toContain(key);
    for (const key of CONTRACTING_KEYS) expect(owner.permissions).not.toContain(key);
  });

  it('contracting owner template adds back only its own 6 keys (51)', () => {
    const owner = getUserRoleTemplates('contracting').owner;
    expect(owner.permissions).toHaveLength(51);
    for (const key of CONTRACTING_KEYS) expect(owner.permissions).toContain(key);
    for (const key of MARITIME_KEYS) expect(owner.permissions).not.toContain(key);
  });

  it('blankUserDraft(admin) never carries a hidden vertical key', () => {
    expect([...blankUserDraft('admin').permissions].sort()).toEqual([...ACTIVATION_OWNER_PERMISSIONS].sort());
    expect([...blankUserDraft('admin', 'maritime').permissions].sort()).toEqual(
      [...ACTIVATION_OWNER_PERMISSIONS, ...MARITIME_KEYS].sort(),
    );
    expect(blankUserDraft('admin', 'contracting').permissions).toHaveLength(51);
  });

  it('getAdminTemplatePermissions defaults to the retail set', () => {
    expect(getAdminTemplatePermissions()).toHaveLength(45);
    expect(getAdminTemplatePermissions(undefined)).toHaveLength(45);
  });
});

describe('splitPermissionsByActorGrant', () => {
  it('keeps only what the actor holds, preserving order, and names the withheld rest', () => {
    const requested = ['dashboard', 'canManageBackups', 'maritimeJobs', 'sales'];
    const actor = ['dashboard', 'sales', 'canManageUsers'];
    const split = splitPermissionsByActorGrant(requested, actor);
    expect(split.granted).toEqual(['dashboard', 'sales']);
    expect(split.withheld).toEqual(['canManageBackups', 'maritimeJobs']);
  });

  it('an actor holding "*" may grant everything', () => {
    const split = splitPermissionsByActorGrant(['maritimeJobs', 'canManageBackups'], ['*']);
    expect(split.granted).toEqual(['maritimeJobs', 'canManageBackups']);
    expect(split.withheld).toEqual([]);
  });

  it('an unknown actor (no session permissions — first-run setup) is not filtered', () => {
    expect(splitPermissionsByActorGrant(['a', 'b'], undefined)).toEqual({ granted: ['a', 'b'], withheld: [] });
    expect(splitPermissionsByActorGrant(['a', 'b'], null)).toEqual({ granted: ['a', 'b'], withheld: [] });
  });
});
