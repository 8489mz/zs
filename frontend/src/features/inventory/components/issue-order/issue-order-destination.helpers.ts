/*
 * INV-TRANSFER-WAREHOUSE-DESTINATION: the new issue-order (stock transfer)
 * form accepted only a branch as destination. Its destination combobox
 * listed branches, and submit converted the chosen id to toBranchId and
 * required a branch_stock location for that branch, so a warehouse such as
 * T10K-WH2 could never be a destination — even though the backend already
 * accepts toLocationId and receives the transfer into that exact location
 * (the inventory-workspace composer already uses that path).
 *
 * WHAT THIS PINS, driving the REAL helpers the issue-order controller
 * calls in handleSubmit:
 * - the destination list holds branches (kind 'branch', plain name) AND
 *   every non-in-transit location (kind 'warehouse', labelled as a
 *   warehouse or a location), so a warehouse is choosable at all;
 *   in-transit is never offered.
 * - a warehouse destination resolves to { toLocationId } with no
 *   toBranchId, in either issue mode, and needs no branch_stock location.
 * - a branch destination resolves to { toBranchId } exactly as before:
 *   transfer_to_branch_stock still requires a branch_stock location for
 *   the branch, final_issue still does not.
 * - an unknown, empty or in-transit warehouse id fails with a NAMED
 *   error, never a generic failure.
 */

export type IssueOrderDestinationKind = 'branch' | 'warehouse';

export interface IssueOrderDestinationOption {
  id: string;
  name: string;
  searchTerms: string;
  kind: IssueOrderDestinationKind;
}

export interface TransferDestinationLocation {
  id: number | string;
  name?: string;
  branchId?: number | string | null;
  locationType?: string;
}

export interface TransferDestinationBranch {
  id: number | string;
  name?: string;
}

const WAREHOUSE_LOCATION_TYPES = new Set(['internal_warehouse', 'external_warehouse']);

/** Branches first, then every location that can receive stock. The
 *  in-transit location is a system-owned clearing location and is never a
 *  destination a merchant can pick. */
export function buildTransferDestinationOptions(
  branches: TransferDestinationBranch[],
  locations: TransferDestinationLocation[],
): IssueOrderDestinationOption[] {
  const branchOptions: IssueOrderDestinationOption[] = branches.map((branch) => {
    const name = String(branch.name ?? '');
    return { id: String(branch.id), name, searchTerms: name.toLowerCase(), kind: 'branch' as const };
  });
  const warehouseOptions: IssueOrderDestinationOption[] = locations
    .filter((location) => String(location.locationType || '') !== 'in_transit')
    .map((location) => {
      const name = String(location.name ?? '');
      const isWarehouse = WAREHOUSE_LOCATION_TYPES.has(String(location.locationType || ''));
      const label = isWarehouse ? `${name} (مخزن)` : `${name} (موقع)`;
      return {
        id: String(location.id),
        name: label,
        searchTerms: `${name} ${label}`.toLowerCase(),
        kind: 'warehouse' as const,
      };
    });
  return [...branchOptions, ...warehouseOptions];
}

export type ResolvedTransferDestination =
  | { ok: true; toBranchId?: number; toLocationId?: number }
  | { ok: false; error: string };

/** Change-detection identity for the issue-order submit. The destination
 *  kind is part of the identity: the same numeric id can be both a branch
 *  and a warehouse, and reusing an idempotency key across kinds would
 *  replay the wrong destination's committed response. */
export function buildIssueOrderPayloadIdentity(input: {
  fromLocationId: string;
  toLocationId: string;
  toDestinationKind: IssueOrderDestinationKind;
  recipientName: string;
  note: string;
  issueMode: 'final_issue' | 'transfer_to_branch_stock';
  lines: Array<{ productId: string | number | undefined; qty: number; locId: string | undefined }>;
}): string {
  return JSON.stringify(input);
}

/** Resolve the chosen destination into the stock-transfer payload legs.
 *  A branch keeps the old behaviour (toBranchId; the backend resolves it
 *  to the branch's branch_stock location at receipt, so transfer mode
 *  still requires one to exist). A warehouse is the destination location
 *  itself: it is sent as toLocationId and the backend receives the
 *  transfer into that exact location, so no branch_stock check applies. */
export function resolveTransferDestination(input: {
  kind: IssueOrderDestinationKind;
  destinationId: string;
  locations: TransferDestinationLocation[];
  issueMode: 'final_issue' | 'transfer_to_branch_stock';
}): ResolvedTransferDestination {
  const { kind, destinationId, locations, issueMode } = input;
  if (kind === 'warehouse') {
    const destinationIdNum = Number(destinationId);
    if (!Number.isSafeInteger(destinationIdNum) || destinationIdNum <= 0) {
      return { ok: false, error: 'يرجى تحديد مخزن الوجهة بشكل صحيح' };
    }
    const location = locations.find((entry) => String(entry.id) === String(destinationId));
    if (!location) {
      return { ok: false, error: 'مخزن الوجهة المحدد غير موجود؛ أعد اختيار الوجهة' };
    }
    if (String(location.locationType || '') === 'in_transit') {
      return { ok: false, error: 'لا يمكن اختيار موقع البضاعة بالطريق كوجهة للتحويل' };
    }
    return { ok: true, toLocationId: destinationIdNum };
  }
  const toBranchIdNum = Number(destinationId);
  if (!Number.isSafeInteger(toBranchIdNum) || toBranchIdNum <= 0) {
    return { ok: false, error: 'يرجى تحديد فرع المستلم بشكل صحيح' };
  }
  if (issueMode === 'transfer_to_branch_stock') {
    const branchLocs = locations.filter(
      (entry) => String(entry.branchId) === String(destinationId) && entry.locationType === 'branch_stock',
    );
    if (branchLocs.length === 0) {
      return { ok: false, error: 'لا يوجد رصيد مخزون مرتبط بهذا الفرع. أنشئ رصيد فرع أولًا من أماكن المخزون.' };
    }
  }
  return { ok: true, toBranchId: toBranchIdNum };
}
