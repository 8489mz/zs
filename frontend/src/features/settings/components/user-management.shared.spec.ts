/*
 * INV-USER-GRANT-NAMES-PERMISSION: the owner/admin template must be
 * scoped to the tenant's vertical, and a template must never
 * pre-tick a permission the actor does not hold.
 *
 * The corrected diagnosis: DEFAULT_ADMIN_PERMS is 58 keys = the 46
 * retail keys the activation owner holds PLUS 12 hidden
 * maritime/contracting keys that no retail tenant contains. The form
 * only shows the tenant's vertical, so those 12 boxes never existed
 * on screen — yet the draft carried them and the grant guard refused
 * the whole save. These cases drive the real template helpers:
 * the retail owner template is exactly the 46-key activation set,
 * a maritime tenant adds back only its own 6 keys (52), a
 * contracting tenant only its own 6 (52), and the actor split
 * never pre-ticks a permission the actor lacks.
 */

import { describe, expect, it } from 'vitest';
import {
  blankUserDraft,
  DEFAULT_CASHIER_PERMS,
  getAdminTemplatePermissions,
  getUserRoleTemplates,
  splitPermissionsByActorGrant,
  USER_ROLE_TEMPLATES,
} from '@/features/settings/components/user-management.shared';

/* The activation owner's set, verbatim from
 * backend/src/core/auth/constants/super-admin-permissions.ts
 * (activation.service.ts grants exactly this to the owner admin). */
const ACTIVATION_OWNER_PERMISSIONS = [
  'dashboard', 'products', 'sales', 'kitchen', 'purchases', 'inventory', 'suppliers', 'customers', 'accounts', 'accounting', 'returns', 'reports', 'audit', 'treasury', 'services', 'hr', 'hrEmployees', 'hrAttendance', 'hrContracts', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryView', 'hrSalaryManage', 'settings', 'pricingCenterView', 'pricingCenterManage', 'canEditUsers', 'canManageUsers', 'canManageSettings', 'canManageBackups', 'canPrint', 'canDiscount', 'canEditPrice', 'canSellWholesale', 'canViewProfit', 'canDelete', 'canEditInvoices', 'canDirectReturn', 'canAdjustInventory', 'canManageBranchStock', 'cashDrawer', 'deliveryReps', 'deliveryRepsAdmin', 'crm',
];

const MARITIME_KEYS = ['maritimeJobs', 'maritimeContainers', 'maritimeInquiries', 'maritimeQuotations', 'maritimeRfqs', 'maritimePolicies'];
const CONTRACTING_KEYS = ['contractingProjects', 'contractingInvoices', 'contractingBoq', 'contractingDailyLogs', 'contractingChangeOrders', 'contractingSubcontractors'];

describe('owner template is scoped to the tenant vertical (INV-USER-GRANT-NAMES-PERMISSION)', () => {
  it('retail owner template is exactly the 46-key activation set — no hidden vertical key', () => {
    const owner = USER_ROLE_TEMPLATES.owner;
    expect(owner.role).toBe('admin');
    expect([...owner.permissions].sort()).toEqual([...ACTIVATION_OWNER_PERMISSIONS].sort());
    expect(owner.permissions).toHaveLength(46);
    for (const key of [...MARITIME_KEYS, ...CONTRACTING_KEYS]) {
      expect(owner.permissions).not.toContain(key);
    }
  });

  it('maritime owner template adds back only its own 6 keys (52)', () => {
    const owner = getUserRoleTemplates('maritime').owner;
    expect(owner.permissions).toHaveLength(52);
    for (const key of MARITIME_KEYS) expect(owner.permissions).toContain(key);
    for (const key of CONTRACTING_KEYS) expect(owner.permissions).not.toContain(key);
  });

  it('contracting owner template adds back only its own 6 keys (52)', () => {
    const owner = getUserRoleTemplates('contracting').owner;
    expect(owner.permissions).toHaveLength(52);
    for (const key of CONTRACTING_KEYS) expect(owner.permissions).toContain(key);
    for (const key of MARITIME_KEYS) expect(owner.permissions).not.toContain(key);
  });

  it('blankUserDraft(admin) never carries a hidden vertical key', () => {
    expect([...blankUserDraft('admin').permissions].sort()).toEqual([...ACTIVATION_OWNER_PERMISSIONS].sort());
    expect([...blankUserDraft('admin', 'maritime').permissions].sort()).toEqual(
      [...ACTIVATION_OWNER_PERMISSIONS, ...MARITIME_KEYS].sort(),
    );
    expect(blankUserDraft('admin', 'contracting').permissions).toHaveLength(52);
  });

  it('getAdminTemplatePermissions defaults to the retail set', () => {
    expect(getAdminTemplatePermissions()).toHaveLength(46);
    expect(getAdminTemplatePermissions(undefined)).toHaveLength(46);
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

describe('cashier template is maximal for the daily job (INV-CASHIER-DEFAULT-MAXIMAL)', () => {
  /* The cashier default must give a new cashier everything that
   * removes a supervisor gate or speeds the daily job — discount,
   * direct return, price fix, wholesale price, and the read-only
   * screens — and nothing that opens the books, rewrites posted
   * invoices, deletes, or administers the system. Reps and
   * attendance were already in the default (deliveryReps gates
   * every rep endpoint; hrAttendance gates the attendance
   * endpoints and the employees list) and stay pinned here.
   * canManageBranchStock and canAdjustInventory were added so a
   * new cashier can add a product and create it with opening
   * stock without a supervisor gate (branch-stock write and
   * opening-stock create are server-gated on those keys).
   * 'reports' was REMOVED: a cashier seeing reports mid-shift
   * breaks the blind close. */
  const EXPECTED_CASHIER_PERMISSIONS = [
    'accounts', 'canAdjustInventory', 'canDirectReturn', 'canDiscount', 'canEditPrice',
    'canManageBranchStock', 'canPrint', 'canSellWholesale',
    'cashDrawer', 'customers', 'dashboard', 'deliveryReps', 'hr', 'hrAttendance', 'inventory',
    'kitchen', 'pricingCenterView', 'products', 'purchases', 'returns', 'sales',
    'services', 'suppliers', 'treasury',
  ];
  const FORBIDDEN_CASHIER_PERMISSIONS = [
    'accounting', 'canEditInvoices', 'canDelete', 'settings',
    'canManageSettings', 'canManageBackups', 'canEditUsers', 'canManageUsers', 'reports',
  ];

  it('cashier template is exactly the 24-key maximal set', () => {
    const cashier = USER_ROLE_TEMPLATES.cashier;
    expect(cashier.role).toBe('cashier');
    expect([...cashier.permissions].sort()).toEqual([...EXPECTED_CASHIER_PERMISSIONS].sort());
    expect(cashier.permissions).toHaveLength(24);
  });

  it('blankUserDraft(cashier) carries the same set', () => {
    expect([...blankUserDraft('cashier').permissions].sort()).toEqual([...EXPECTED_CASHIER_PERMISSIONS].sort());
  });

  it('DEFAULT_CASHIER_PERMS is the same set (single source of truth)', () => {
    expect([...DEFAULT_CASHIER_PERMS].sort()).toEqual([...EXPECTED_CASHIER_PERMISSIONS].sort());
  });

  it('includes the two supervisor gates the owner ticked by hand (discount + direct return)', () => {
    expect(USER_ROLE_TEMPLATES.cashier.permissions).toContain('canDiscount');
    expect(USER_ROLE_TEMPLATES.cashier.permissions).toContain('canDirectReturn');
  });

  it('includes the branch-stock and inventory-adjustment gates (product add / opening stock)', () => {
    /* canManageBranchStock: inventory-scope.service.ts
     * assertLocationScope 'write' on branch_stock locations throws
     * LOCATION_SCOPE_FORBIDDEN without it — this is why cashier
     * Baghdadi could not add a product. canAdjustInventory: product
     * create with opening stock > 0 throws
     * INVENTORY_ADJUSTMENT_FORBIDDEN without it. */
    expect(USER_ROLE_TEMPLATES.cashier.permissions).toContain('canManageBranchStock');
    expect(USER_ROLE_TEMPLATES.cashier.permissions).toContain('canAdjustInventory');
    expect(DEFAULT_CASHIER_PERMS).toContain('canManageBranchStock');
    expect(DEFAULT_CASHIER_PERMS).toContain('canAdjustInventory');
  });

  it('keeps reports out of the default (blind close)', () => {
    expect(USER_ROLE_TEMPLATES.cashier.permissions).not.toContain('reports');
    expect(DEFAULT_CASHIER_PERMS).not.toContain('reports');
  });

  it('keeps the books, posted invoices, delete and system admin out of the default', () => {
    for (const key of FORBIDDEN_CASHIER_PERMISSIONS) {
      expect(USER_ROLE_TEMPLATES.cashier.permissions).not.toContain(key);
    }
  });
});
