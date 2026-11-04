/**
 * Pure ACID (Advance Cargo Information Declaration) gates for
 * shipments importing into Egyptian ports.
 *
 * Egypt requires a 19-digit ACID number for import shipments
 * arriving at Egyptian ports (UN/LOCODE country prefix EG).
 * The gate is strict ONLY where the number is required; anywhere
 * else a malformed supplied value is a warning, never a block
 * (spirit of the law: never block real work for a formal rule
 * that does not apply to the shipment).
 *
 * The engine is pure on purpose (AGENTS.md Rule 13): it never
 * throws and never touches the database, so the truth table is
 * pinned directly and the service gate stays a thin caller.
 * The format is exactly 19 ASCII digits after trimming --
 * spaces and hyphens are not accepted, because the number is
 * validated digit-for-digit downstream.
 */

export function requiresAcidNumber(
  direction: string | null | undefined,
  podCode: string | null | undefined,
): boolean {
  const normalizedDirection = String(direction || '').trim().toLowerCase();
  const normalizedPod = String(podCode || '').trim().toUpperCase();
  return normalizedDirection === 'import' && normalizedPod.startsWith('EG');
}

export function isValidAcidNumber(value: string | null | undefined): boolean {
  return /^\d{19}$/.test(String(value || '').trim());
}

export function evaluateAcidNumber(
  direction: string | null | undefined,
  podCode: string | null | undefined,
  acidNumber: string | null | undefined,
): { required: boolean; valid: boolean } {
  return {
    required: requiresAcidNumber(direction, podCode),
    valid: isValidAcidNumber(acidNumber),
  };
}
