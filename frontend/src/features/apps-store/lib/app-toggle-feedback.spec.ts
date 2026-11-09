/*
 * INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2).
 *
 * Drives the pure verification behind the honest Apps Store toast: a
 * requested module toggle only counts as installed when the server
 * response confirms that exact value for every key in the payload. A
 * different boolean — or the key missing from the response, because an
 * unconfirmed value is not a persisted value — means the toggle was
 * rejected (the backend deletes posModuleEnabled for non-super-admin
 * actors and forces it false for warehousing tenants) and must be
 * reported as rejected, never toasted as success.
 */

import { describe, expect, it } from 'vitest';
import { resolveAppToggleFeedback } from '@/features/apps-store/lib/app-toggle-feedback';

describe('resolveAppToggleFeedback', () => {
  it('confirms an install the server persisted', () => {
    expect(
      resolveAppToggleFeedback({ posModuleEnabled: true }, { posModuleEnabled: true }),
    ).toEqual({ kind: 'applied', enabled: true });
  });

  it('rejects a POS install the server forced off', () => {
    expect(
      resolveAppToggleFeedback({ posModuleEnabled: true }, { posModuleEnabled: false }),
    ).toEqual({ kind: 'rejected', enabled: true, rejectedKeys: ['posModuleEnabled'] });
  });

  it('rejects an install the server response never confirms', () => {
    expect(resolveAppToggleFeedback({ posModuleEnabled: true }, {})).toEqual({
      kind: 'rejected',
      enabled: true,
      rejectedKeys: ['posModuleEnabled'],
    });
  });

  it('rejects an install when the server returns nothing', () => {
    expect(resolveAppToggleFeedback({ posModuleEnabled: true }, null)).toEqual({
      kind: 'rejected',
      enabled: true,
      rejectedKeys: ['posModuleEnabled'],
    });
  });

  it('confirms an uninstall the server persisted', () => {
    expect(
      resolveAppToggleFeedback({ posModuleEnabled: false }, { posModuleEnabled: false }),
    ).toEqual({ kind: 'applied', enabled: false });
  });

  it('rejects an uninstall the server did not apply', () => {
    expect(
      resolveAppToggleFeedback({ posModuleEnabled: false }, { posModuleEnabled: true }),
    ).toEqual({ kind: 'rejected', enabled: false, rejectedKeys: ['posModuleEnabled'] });
  });

  it('rejects only the key that did not persist in a multi-key install', () => {
    expect(
      resolveAppToggleFeedback(
        { posModuleEnabled: true, weightedBarcodeEnabled: true },
        { posModuleEnabled: false, weightedBarcodeEnabled: true },
      ),
    ).toEqual({ kind: 'rejected', enabled: true, rejectedKeys: ['posModuleEnabled'] });
  });
});
