/**
 * INV-LEAVE-BALANCE-DEDUCTION: one rule decides whether an approved
 * leave deducts from the employee's stored annual-leave balance, and
 * it is the SAME rule for approval and for cancellation (release).
 *
 * THE BUG IT FIXES: approval deducted only when the leave type's
 * `deducts_from_balance` flag was true, but no UI form ever exposed
 * that flag, so every type created through the settings form stored
 * false and no approval ever moved `used_annual_leaves` — the
 * employee profile kept showing 21 remaining / 0 used while
 * end-of-service recomputed the used days from the approved requests
 * and showed 19. Two screens disagreed on the same balance.
 *
 * THE RULE (approved requests deduct — the behaviour end-of-service
 * already assumes):
 * 1. An explicit flag wins: `deducts_from_balance = true` deducts,
 *    for any type. The settings form now exposes the flag, so an
 *    admin can mark a non-annual paid type as deducting.
 * 2. An annual leave deducts by type semantics, whatever the stored
 *    flag says: code `annual` / `vacation`, a name containing
 *    `سنوية` or `اعتيادية`, or a request text of `annual` / `vacation`
 *    or containing `سنوية` / `اعتيادية`. No annual type could ever have
 *    had its flag set deliberately — the form never exposed the field,
 *    so every stored `false` on an annual type is an artefact of the
 *    missing control, not a choice — and end-of-service already counts
 *    exactly these requests as used. The text check matters because the
 *    create form stores the type NAME as the request text: when the
 *    type row join misses (deleted or cross-tenant type), the text is
 *    the only surviving identity. `اعتيادية` belongs here because the
 *    legacy branch already treats that word as annual — a typed type
 *    named `اعتيادية` must not deduct differently from a text-only
 *    request saying the same word.
 * 3. Legacy text-only requests (no `leave_type_id`) keep the old
 *    behaviour: an empty text or `annual` / `paid` / `vacation` /
 *    `سنوية` / `اعتيادية` deducts.
 * 4. Anything else does not deduct (e.g. a sick type with the flag
 *    off), and cancelling an approved leave releases exactly the
 *    days its approval deducted — never below zero.
 *
 * INV-LEAVE-BALANCE-NOT-DEDUCTING: the stored `used_annual_leaves`
 * counter only moves on approvals posted AFTER the Batch 7 fix, and
 * the deploy-time backfill (migration 2040000000194) only counted
 * requests approved BEFORE it ran — so an annual leave approved in
 * between was counted NOWHERE and the profile kept showing 21 / 21
 * for an employee with an approved 2-day leave. The counter alone
 * can never be trusted as the balance: every balance read reconciles
 * it against the approved requests under this ONE shared rule
 * (`deductibleApprovedLeaveDays` + `reconciledUsedAnnualLeaves` in
 * the services), taking the MAX of stored and recomputed. MAX never
 * decreases the counter: a cancellation releases through its own
 * decrement, and the recompute excludes cancelled requests, so the
 * two can never disagree upward. The approval guard and the
 * increment use the reconciled value too, so a stale counter can
 * neither hide used days nor let an approval exceed the entitlement.
 *
 * Prospective only: approvals already posted stay as stored; the
 * end-of-service recompute (used == 0) still backfills annual
 * requests approved before this fix.
 */

export interface LeaveBalanceTypeIdentity {
  /** Stored `deducts_from_balance` on the leave type row (null when no type row). */
  deductsFromBalance?: boolean | null;
  /** `hr_leave_requests.leave_type_id` (null for legacy text-only requests). */
  leaveTypeId?: number | null;
  /** `hr_leave_types.code` of the joined type row. */
  leaveTypeCode?: string | null;
  /** `hr_leave_types.name` of the joined type row. */
  leaveTypeName?: string | null;
  /** `hr_leave_requests.leave_type` free text. */
  leaveTypeText?: string | null;
}

function cleanLower(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Annual-leave identity, mirroring the end-of-service recompute
 * (code annual/vacation, name containing سنوية, request text
 * annual/vacation): the same requests end-of-service counts as used.
 * The name also matches `اعتيادية` (the legacy branch already treats
 * that word as annual), and the text matches a name-like text
 * containing `سنوية` / `اعتيادية`, because the create form stores
 * the type NAME as the request text.
 */
export function isAnnualLeaveType(identity: LeaveBalanceTypeIdentity): boolean {
  const code = cleanLower(identity.leaveTypeCode);
  if (code === 'annual' || code === 'vacation') return true;
  const name = String(identity.leaveTypeName || '');
  if (name.includes('سنوية') || name.includes('اعتيادية')) return true;
  const text = cleanLower(identity.leaveTypeText);
  if (text === 'annual' || text === 'vacation') return true;
  if (text.includes('سنوية') || text.includes('اعتيادية')) return true;
  return false;
}

export function shouldDeductLeaveFromBalance(identity: LeaveBalanceTypeIdentity): boolean {
  if (identity.deductsFromBalance === true) return true;
  if (isAnnualLeaveType(identity)) return true;
  if (identity.leaveTypeId == null) {
    const text = cleanLower(identity.leaveTypeText);
    if (!text || ['annual', 'paid', 'vacation', 'سنوية', 'اعتيادية'].includes(text)) return true;
  }
  return false;
}

/** One approved request row as read back with its joined type row. */
export interface ApprovedLeaveDeductionRow extends LeaveBalanceTypeIdentity {
  /** `hr_leave_requests.days_count` for the request. */
  daysCount: number | null;
}

/**
 * INV-LEAVE-BALANCE-NOT-DEDUCTING: the deductible days inside a set
 * of APPROVED requests, under the one shared rule above. Services
 * reconcile the stored `used_annual_leaves` counter against this
 * sum (taking the MAX) instead of trusting the counter, so approvals
 * posted before the forward deduction existed still count.
 */
export function deductibleApprovedLeaveDays(rows: ApprovedLeaveDeductionRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (shouldDeductLeaveFromBalance(row)) total += Math.max(0, Number(row.daysCount || 0));
  }
  return Number(total.toFixed(2));
}
