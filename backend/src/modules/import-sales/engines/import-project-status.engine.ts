/**
 * Import project display status: the single place that decides what
 * state an import project reads in the list (and the detail view).
 * Pure and framework-free: imported identically by the production
 * service and the test suite.
 *
 * Rule (INV-IMPORT-PROJECT-STATUS-APPROVED): the stored
 * import_projects.status column is NOT the project's real state.
 * Only three writers ever touch it — create writes 'feasibility',
 * convertFeasibilityToProject writes 'sourcing', closeProject
 * writes 'closed' — while the rest of the lifecycle (an approved
 * proforma, a PO, a shipment, an arrival, a posted receipt, a sale)
 * never advances it, and 'warehousing' / 'selling' have no writer
 * at all. Live proof (re-test 2026-11-09, deployed 4d811676):
 * IMP-261108-0001 and IMP-261109-0001 ran the full cycle — approved
 * PIs, shipments, an Arrived container, a posted receipt
 * (JE-00015025) and a sale invoiced (Z-261109-16323) — while the
 * list still read 'feasibility' for both, because their feasibility
 * studies were never converted (approval failed with
 * IMPORT_EXCHANGE_RATE_REQUIRED / went to a duplicate project).
 *
 * The displayed status is therefore DERIVED at read time from the
 * authoritative lifecycle evidence, in this precedence:
 * - 'closed' is terminal: a closed project never re-opens, whatever
 *   its shipments say.
 * - any shipment 'Arrived' means the goods are in the warehouse:
 *   'warehousing'.
 * - a stored forward state ('selling', 'warehousing') is never
 *   downgraded by this derivation.
 * - a converted study (feasibility_converted_at set), an approved
 *   proforma, or any shipment at all means sourcing is under way:
 *   'sourcing'. A draft-only proforma proves nothing approved yet,
 *   so it does not move the state.
 * - otherwise the project is still at the study stage:
 *   'feasibility'.
 * A stored value outside the known set passes through untouched
 * (honest fallback, never a wrong specific state), and a blank
 * stored value reads 'feasibility' (the create default).
 */

export interface ImportProjectLifecycleSignals {
  /** Set once convertFeasibilityToProject succeeds (never cleared). */
  feasibilityConvertedAt?: Date | string | null;
  /** At least one proforma invoice for the project is 'approved'. */
  hasApprovedProforma: boolean;
  /** At least one shipment exists for the project. */
  hasShipment: boolean;
  /** At least one shipment for the project is 'Arrived'. */
  hasArrivedShipment: boolean;
}

const KNOWN_PROJECT_STATUSES = new Set([
  'feasibility',
  'sourcing',
  'warehousing',
  'selling',
  'closed',
]);

export function resolveImportProjectDisplayStatus(
  storedStatus: string | null | undefined,
  signals: ImportProjectLifecycleSignals,
): string {
  const stored = (storedStatus || '').trim().toLowerCase();
  if (!KNOWN_PROJECT_STATUSES.has(stored)) {
    // Unknown stored value: pass through untouched (or the create
    // default when blank) instead of inventing a state.
    return stored || 'feasibility';
  }
  // 'closed' is terminal.
  if (stored === 'closed') return 'closed';
  // Arrived goods are in the warehouse, whatever the stored column says.
  if (signals.hasArrivedShipment) return 'warehousing';
  // A stored forward state is never downgraded by this derivation.
  if (stored === 'selling' || stored === 'warehousing') return stored;
  // Approved / in-flight work means sourcing is under way.
  if (
    signals.feasibilityConvertedAt ||
    signals.hasApprovedProforma ||
    signals.hasShipment
  ) {
    return 'sourcing';
  }
  if (stored === 'sourcing') return 'sourcing';
  return 'feasibility';
}
