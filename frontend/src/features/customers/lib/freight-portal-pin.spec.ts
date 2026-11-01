/* Pins INV-FREIGHT-PORTAL-PIN-UI: the staff PIN form checks presence,
   minimum length, and confirmation match only. Trivial-value strength
   rules stay server-side and are never duplicated here. */

import { describe, expect, it } from 'vitest';
import { validateFreightPortalPin } from './freight-portal-pin';

describe('freight portal PIN form validation', () => {
  it('requires a PIN', () => {
    expect(validateFreightPortalPin('', '')).toEqual(['PIN_REQUIRED']);
    expect(validateFreightPortalPin('   ', '   ')).toEqual(['PIN_REQUIRED']);
  });

  it('rejects a PIN shorter than 4 characters', () => {
    expect(validateFreightPortalPin('123', '123')).toEqual(['PIN_TOO_SHORT']);
  });

  it('rejects a confirmation that does not match', () => {
    expect(validateFreightPortalPin('4829', '4828')).toEqual(['PIN_MISMATCH']);
  });

  it('reports both a short PIN and a mismatch together', () => {
    expect(validateFreightPortalPin('12', '13')).toEqual(['PIN_TOO_SHORT', 'PIN_MISMATCH']);
  });

  it('accepts a matching PIN of 4 or more characters and trims surrounding spaces', () => {
    expect(validateFreightPortalPin('4829', '4829')).toEqual([]);
    expect(validateFreightPortalPin(' 4829 ', '4829')).toEqual([]);
  });

  it('passes strong-looking PINs through for the server to decide', () => {
    // '1234' looks valid to this helper; assertSecurePasscode on the
    // server rejects it. The helper must not pretend otherwise.
    expect(validateFreightPortalPin('1234', '1234')).toEqual([]);
  });
});
