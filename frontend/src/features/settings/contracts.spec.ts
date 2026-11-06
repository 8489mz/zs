/* INV-INSTAPAY-FIELD: the Z-Pay form never loaded the saved InstaPay IPA
 * back into the form (SettingsMainForm reset() mapped every field by hand
 * and omitted all seven Z-Pay fields), so a saved IPA rendered empty after
 * reload and the next save overwrote it with the schema default. These
 * specs pin buildZPayFormValues (the load-back mapping) and its round-trip
 * through buildSettingsUpdatePayload (the save path). */
import { describe, it, expect } from 'vitest';
import type { AppSettings } from '@/types/domain';
import { buildSettingsUpdatePayload, buildZPayFormValues } from './contracts';

const savedZPay = {
  storeName: 'My Store',
  instapayAddress: 'ahmed@instapay',
  walletNumber: '01012345678',
  walletProviderName: 'Orange Cash',
  paymentLinkBaseUrl: 'https://pay.example/checkout',
  enableDynamicPaymentQr: false,
  printPaymentQrOnReceipt: true,
  taxComplianceMode: 'optional_eta',
} as AppSettings;

describe('buildZPayFormValues', () => {
  it('loads a saved InstaPay IPA and the other Z-Pay fields back into the form', () => {
    const values = buildZPayFormValues(savedZPay);
    expect(values.instapayAddress).toBe('ahmed@instapay');
    expect(values.walletNumber).toBe('01012345678');
    expect(values.walletProviderName).toBe('Orange Cash');
    expect(values.paymentLinkBaseUrl).toBe('https://pay.example/checkout');
    expect(values.enableDynamicPaymentQr).toBe(false);
    expect(values.printPaymentQrOnReceipt).toBe(true);
    expect(values.taxComplianceMode).toBe('optional_eta');
  });

  it('falls back to the schema defaults when no Z-Pay settings are saved yet', () => {
    const values = buildZPayFormValues(undefined);
    expect(values.instapayAddress).toBe('01018017523');
    expect(values.walletNumber).toBe('01018017523');
    expect(values.walletProviderName).toBe('فودافون كاش');
    expect(values.paymentLinkBaseUrl).toBe('');
    expect(values.enableDynamicPaymentQr).toBe(true);
    expect(values.printPaymentQrOnReceipt).toBe(false);
    expect(values.taxComplianceMode).toBe('disabled');
  });

  it('falls back to the default when the saved IPA is empty or blank', () => {
    expect(buildZPayFormValues({ storeName: 'My Store', instapayAddress: '' } as AppSettings).instapayAddress).toBe(
      '01018017523',
    );
    expect(
      buildZPayFormValues({ storeName: 'My Store', instapayAddress: '   ' } as AppSettings).instapayAddress,
    ).toBe('01018017523');
  });

  it('trims a saved IPA and rejects an unknown tax compliance mode', () => {
    const values = buildZPayFormValues({
      storeName: 'My Store',
      instapayAddress: '  ahmed@instapay  ',
      taxComplianceMode: 'bogus',
    } as AppSettings);
    expect(values.instapayAddress).toBe('ahmed@instapay');
    expect(values.taxComplianceMode).toBe('disabled');
  });

  it('returns exactly the seven Z-Pay fields', () => {
    expect(Object.keys(buildZPayFormValues(savedZPay)).sort()).toEqual([
      'enableDynamicPaymentQr',
      'instapayAddress',
      'paymentLinkBaseUrl',
      'printPaymentQrOnReceipt',
      'taxComplianceMode',
      'walletNumber',
      'walletProviderName',
    ]);
  });
});

describe('Z-Pay save round-trip', () => {
  it('saving a form that carries the IPA keeps it and the other fields', () => {
    const values = { ...buildZPayFormValues(savedZPay), storeName: 'My Store' };
    const { settings } = buildSettingsUpdatePayload(savedZPay, values);
    expect(settings.instapayAddress).toBe('ahmed@instapay');
    expect(settings.walletNumber).toBe('01012345678');
    expect(settings.walletProviderName).toBe('Orange Cash');
    expect(settings.paymentLinkBaseUrl).toBe('https://pay.example/checkout');
    expect(settings.enableDynamicPaymentQr).toBe(false);
    expect(settings.printPaymentQrOnReceipt).toBe(true);
    expect(settings.taxComplianceMode).toBe('optional_eta');
  });

  it('saving a new IPA overwrites the previously saved one', () => {
    const { settings } = buildSettingsUpdatePayload(savedZPay, {
      instapayAddress: 'newname@instapay',
      storeName: 'My Store',
    });
    expect(settings.instapayAddress).toBe('newname@instapay');
    expect(settings.walletNumber).toBe('01012345678');
  });

  it('saving without an IPA does not clobber the saved one or the other fields', () => {
    const { settings } = buildSettingsUpdatePayload(savedZPay, { storeName: 'My Store' });
    expect(settings.instapayAddress).toBe('ahmed@instapay');
    expect(settings.walletNumber).toBe('01012345678');
    expect(settings.walletProviderName).toBe('Orange Cash');
  });
});
