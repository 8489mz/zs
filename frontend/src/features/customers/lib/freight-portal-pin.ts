/**
 * Client-side form checks for the staff freight-portal PIN reset.
 *
 * The server is the authority on PIN strength
 * (INV-FREIGHT-PORTAL-PIN-HASHED, assertSecurePasscode): it rejects
 * trivial values including '1234', repeated digits, and PINs matching
 * the end of the customer's phone number, and it never returns the
 * stored PIN. This helper deliberately checks only what the form can
 * know without duplicating that server rule set: a PIN is present, it
 * is at least 4 characters, and the confirmation matches. Anything
 * stronger-looking still goes to the server, whose rejection is
 * surfaced verbatim. Duplicating the trivial-pattern blacklist here
 * would drift from the server list and give a false sense of safety.
 *
 * Error codes are stable English identifiers; the card maps them to
 * display text. The PIN itself is never returned in an error.
 */

export type FreightPortalPinValidationCode =
  | 'PIN_REQUIRED'
  | 'PIN_TOO_SHORT'
  | 'PIN_MISMATCH';

export function validateFreightPortalPin(
  pin: string,
  confirmPin: string,
): FreightPortalPinValidationCode[] {
  const trimmedPin = String(pin || '').trim();
  if (!trimmedPin) return ['PIN_REQUIRED'];
  const codes: FreightPortalPinValidationCode[] = [];
  if (trimmedPin.length < 4) codes.push('PIN_TOO_SHORT');
  if (trimmedPin !== String(confirmPin || '').trim()) codes.push('PIN_MISMATCH');
  return codes;
}
