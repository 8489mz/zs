import { describe, expect, it } from 'vitest';
import {
  getCustomerAddressValidation,
  getCustomerNameValidation,
  getDynamicPhoneValidation,
} from './StorefrontCheckoutModal';

describe('storefront checkout contact validation (INV-SPIRIT-STOREFRONT-CONTACT-MINIMA)', () => {
  it('accepts a two-letter name and rejects a one-letter name', () => {
    expect(getCustomerNameValidation('لي').isValid).toBe(true);
    expect(getCustomerNameValidation('ل').isValid).toBe(false);
    expect(getCustomerNameValidation('A').isValid).toBe(false);
    expect(getCustomerNameValidation('  ').isValid).toBe(false);
  });

  it('accepts any non-empty trimmed address', () => {
    expect(getCustomerAddressValidation('ab').isValid).toBe(true);
    expect(getCustomerAddressValidation('شارع').isValid).toBe(true);
    expect(getCustomerAddressValidation('   ').isValid).toBe(false);
    expect(getCustomerAddressValidation('').isValid).toBe(false);
  });

  it('keeps the Egyptian phone rule unchanged', () => {
    expect(getDynamicPhoneValidation('01012345678', 'EG').isValid).toBe(true);
    expect(getDynamicPhoneValidation('01512345678', 'EG').isValid).toBe(true);
    expect(getDynamicPhoneValidation('0101234567', 'EG').isValid).toBe(false);
    expect(getDynamicPhoneValidation('01912345678', 'EG').isValid).toBe(false);
    expect(getDynamicPhoneValidation('555123456', 'SA').isValid).toBe(true);
  });
});
