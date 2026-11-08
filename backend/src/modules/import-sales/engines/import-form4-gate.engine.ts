/**
 * Form 4 clearance gate: the single place that decides whether a
 * shipment may move into customs clearance or receipt posting
 * without a Form 4 on record. Pure and framework-free: imported
 * identically by the production service and the test suite.
 *
 * Rule (INV-IMPORT-FORM4-CLEARANCE-GATE): Form 4 number/date are
 * OPTIONAL when a transfer is recorded. They become REQUIRED
 * before clearance/receipt posting for a bank-channel-funded
 * commercial shipment whose B/L value exceeds the threshold.
 * Cash-carried money is exempt: no bank arranged the currency, so
 * no bank-issued Form 4 exists to require. When no funding is
 * recorded against the project at all, the gate does not apply:
 * the funding is unrecorded, and the gate must not invent a
 * requirement from silence (that scoping is recorded, not
 * hidden). The threshold lives here and nowhere else.
 *
 * SUPERSEDED SCOPING (I1-P4, trial 2026-11-09 problem 4): the
 * "no funding recorded" branch above no longer exempts a real
 * shipment. Every shipment now carries a funding_type
 * (migration 2040000000303, default bank_transfer), and the
 * service ALWAYS passes it as a funding method — so in
 * production the methods list is never empty and the gate
 * applies to every bank-default shipment above the threshold,
 * even one with no supplier_payments rows at all. The empty
 * branch below survives only as this pure function's defined
 * behaviour for a caller with genuinely no funding
 * information; it is not a live exemption path.
 */

/** Form 4 becomes mandatory above this B/L value, in US dollars. Single source of truth. */
export const FORM4_REQUIRED_THRESHOLD_USD = 2000;

export interface Form4GateInput {
  /** B/L value: sum of item quantity x factory unit price in USD. */
  shipmentUsdValue: number;
  /** Payment methods of the project-linked transfers that funded this shipment. */
  fundingMethods: Array<string | null | undefined>;
  /** Form 4 number recorded on the shipment itself. */
  shipmentForm4Number?: string | null;
  /** Form 4 numbers recorded on project-linked transfers. */
  transferForm4Numbers: Array<string | null | undefined>;
}

export interface Form4GateDecision {
  required: boolean;
  satisfied: boolean;
  reason: string;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateForm4Gate(input: Form4GateInput): Form4GateDecision {
  const methods = input.fundingMethods.filter(
    (m): m is string => typeof m === 'string' && m.trim().length > 0,
  );
  const allCashCarried = methods.length > 0 && methods.every((m) => m === 'cash_carried');
  const required =
    Number(input.shipmentUsdValue) > FORM4_REQUIRED_THRESHOLD_USD &&
    methods.length > 0 &&
    !allCashCarried;
  if (!required) {
    return {
      required: false,
      satisfied: true,
      reason: allCashCarried
        ? 'Cash-carried funding is exempt from the Form 4 requirement.'
        : methods.length === 0
          ? 'No project-linked funding is recorded, so the gate does not apply.'
          : 'Shipment value is at or below the Form 4 threshold.',
    };
  }
  const satisfied =
    hasValue(input.shipmentForm4Number) ||
    input.transferForm4Numbers.some((n) => hasValue(n));
  return {
    required: true,
    satisfied,
    reason: satisfied
      ? 'A Form 4 number is on record for the shipment or its funding transfer.'
      : `Form 4 is required before clearance for bank-channel-funded shipments above USD ${FORM4_REQUIRED_THRESHOLD_USD}.`,
  };
}
