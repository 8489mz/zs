/*
 * INV-REST-SUCCESS-FEEDBACK-TRUTH (Restaurant Batch 9, T2).
 *
 * Drives the pure comparison behind the honest settings-save toast:
 * a requested enableEnterpriseFeatures / posModuleEnabled only counts as
 * saved when the server response confirms that exact value. A different
 * boolean — or the key missing from the response, because an unconfirmed
 * value is not a persisted value — is an override the UI must say aloud
 * instead of toasting success.
 */

import { describe, expect, it } from 'vitest';
import { findOverriddenSettingsValues } from '@/features/settings/lib/settings-save-feedback';

describe('findOverriddenSettingsValues', () => {
  it('flags Simple Retail when the server keeps enterprise mode on', () => {
    expect(
      findOverriddenSettingsValues(
        { enableEnterpriseFeatures: false },
        { enableEnterpriseFeatures: true },
      ),
    ).toEqual(['enableEnterpriseFeatures']);
  });

  it('flags a requested POS enable when the server keeps POS off', () => {
    expect(
      findOverriddenSettingsValues(
        { posModuleEnabled: true },
        { posModuleEnabled: false },
      ),
    ).toEqual(['posModuleEnabled']);
  });

  it('flags both keys when both were overridden', () => {
    expect(
      findOverriddenSettingsValues(
        { enableEnterpriseFeatures: false, posModuleEnabled: true },
        { enableEnterpriseFeatures: true, posModuleEnabled: false },
      ),
    ).toEqual(['enableEnterpriseFeatures', 'posModuleEnabled']);
  });

  it('reports nothing when the server confirms the requested values', () => {
    expect(
      findOverriddenSettingsValues(
        { enableEnterpriseFeatures: false, posModuleEnabled: true },
        { enableEnterpriseFeatures: false, posModuleEnabled: true },
      ),
    ).toEqual([]);
  });

  it('never flags a key the user did not request', () => {
    expect(
      findOverriddenSettingsValues(
        { storeName: 'My Store' },
        { enableEnterpriseFeatures: true, posModuleEnabled: false },
      ),
    ).toEqual([]);
  });

  it('treats a key missing from the server response as unconfirmed, not saved', () => {
    expect(
      findOverriddenSettingsValues(
        { enableEnterpriseFeatures: false, posModuleEnabled: true },
        { storeName: 'My Store' },
      ),
    ).toEqual(['enableEnterpriseFeatures', 'posModuleEnabled']);
  });

  it('ignores unrelated keys even when they differ', () => {
    expect(
      findOverriddenSettingsValues(
        { storeName: 'A', enableEnterpriseFeatures: true },
        { storeName: 'B', enableEnterpriseFeatures: true },
      ),
    ).toEqual([]);
  });
});
