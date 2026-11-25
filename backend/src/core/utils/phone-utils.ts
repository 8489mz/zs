/**
 * Phone Number Validation & Normalization Utility
 * Supports Egypt (+20), Saudi Arabia (+966), Qatar (+974), UAE (+971), Kuwait (+965),
 * Oman (+968), Bahrain (+973), Jordan (+962), and International E.164.
 *
 * Strict Enterprise Standards: Zero emojis, explicit validation rules, canonical normalization.
 */

export interface CountryPhoneDefinition {
  code: string;
  name: string;
  dialCode: string;
  digitsCode: string;
  placeholder: string;
  hint: string;
  validate: (rawInput: string) => { isValid: boolean; error?: string; normalized: string; nationalNumber: string };
}

export const SUPPORTED_COUNTRIES: CountryPhoneDefinition[] = [
  {
    code: 'EG',
    name: 'مصر \u200E(+20)',
    dialCode: '+20',
    digitsCode: '20',
    placeholder: '01012345678',
    hint: '11 رقماً يبدأ بـ 010 أو 011 أو 012 أو 015',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('20') && digits.length === 12) {
        local = digits.slice(2);
      } else if (digits.startsWith('0') && digits.length === 11) {
        local = digits.slice(1);
      }
      if (local.length !== 10 || !/^1[0125]\d{8}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف المصري يجب أن يتكون من 11 رقماً ويبدأ بـ 010 أو 011 أو 012 أو 015',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+20${local}`,
        nationalNumber: `0${local}`,
      };
    },
  },
  {
    code: 'SA',
    name: 'السعودية \u200E(+966)',
    dialCode: '+966',
    digitsCode: '966',
    placeholder: '0512345678',
    hint: '9 أرقام تبدأ بـ 5 (أو 10 أرقام تبدأ بـ 05)',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('966') && digits.length === 12) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 10) {
        local = digits.slice(1);
      }
      if (local.length !== 9 || !/^5\d{8}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف السعودي يجب أن يتكون من 9 أرقام ويبدأ بـ 5 (أو 05)',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+966${local}`,
        nationalNumber: `0${local}`,
      };
    },
  },
  {
    code: 'QA',
    name: 'قطر \u200E(+974)',
    dialCode: '+974',
    digitsCode: '974',
    placeholder: '33123456',
    hint: '8 أرقام تبدأ بـ 3 أو 5 أو 6 أو 7',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('974') && digits.length === 11) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 9) {
        local = digits.slice(1);
      }
      if (local.length !== 8 || !/^[3567]\d{7}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف القطري يجب أن يتكون من 8 أرقام ويبدأ بـ 3 أو 5 أو 6 أو 7',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+974${local}`,
        nationalNumber: local,
      };
    },
  },
  {
    code: 'AE',
    name: 'الإمارات \u200E(+971)',
    dialCode: '+971',
    digitsCode: '971',
    placeholder: '0501234567',
    hint: '9 أرقام تبدأ بـ 5 (أو 10 أرقام تبدأ بـ 05)',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('971') && digits.length === 12) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 10) {
        local = digits.slice(1);
      }
      if (local.length !== 9 || !/^5\d{8}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف الإماراتي يجب أن يتكون من 9 أرقام ويبدأ بـ 5 (أو 05)',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+971${local}`,
        nationalNumber: `0${local}`,
      };
    },
  },
  {
    code: 'KW',
    name: 'الكويت \u200E(+965)',
    dialCode: '+965',
    digitsCode: '965',
    placeholder: '91234567',
    hint: '8 أرقام تبدأ بـ 5 أو 6 أو 9',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('965') && digits.length === 11) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 9) {
        local = digits.slice(1);
      }
      if (local.length !== 8 || !/^[569]\d{7}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف الكويتي يجب أن يتكون من 8 أرقام ويبدأ بـ 5 أو 6 أو 9',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+965${local}`,
        nationalNumber: local,
      };
    },
  },
  {
    code: 'OM',
    name: 'عمان \u200E(+968)',
    dialCode: '+968',
    digitsCode: '968',
    placeholder: '91234567',
    hint: '8 أرقام تبدأ بـ 7 أو 9',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('968') && digits.length === 11) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 9) {
        local = digits.slice(1);
      }
      if (local.length !== 8 || !/^[79]\d{7}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف العماني يجب أن يتكون من 8 أرقام ويبدأ بـ 7 أو 9',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+968${local}`,
        nationalNumber: local,
      };
    },
  },
  {
    code: 'BH',
    name: 'البحرين \u200E(+973)',
    dialCode: '+973',
    digitsCode: '973',
    placeholder: '31234567',
    hint: '8 أرقام تبدأ بـ 3 أو 6',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('973') && digits.length === 11) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 9) {
        local = digits.slice(1);
      }
      if (local.length !== 8 || !/^[36]\d{7}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف البحريني يجب أن يتكون من 8 أرقام ويبدأ بـ 3 أو 6',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+973${local}`,
        nationalNumber: local,
      };
    },
  },
  {
    code: 'JO',
    name: 'الأردن \u200E(+962)',
    dialCode: '+962',
    digitsCode: '962',
    placeholder: '0791234567',
    hint: '9 أرقام تبدأ بـ 7 (أو 10 أرقام تبدأ بـ 07)',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      let local = digits;
      if (digits.startsWith('962') && digits.length === 12) {
        local = digits.slice(3);
      } else if (digits.startsWith('0') && digits.length === 10) {
        local = digits.slice(1);
      }
      if (local.length !== 9 || !/^7\d{8}$/.test(local)) {
        return {
          isValid: false,
          error: 'رقم الهاتف الأردني يجب أن يتكون من 9 أرقام ويبدأ بـ 7 (أو 07)',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+962${local}`,
        nationalNumber: `0${local}`,
      };
    },
  },
  {
    code: 'OTHER',
    name: 'دولي (أخرى)',
    dialCode: '+',
    digitsCode: '',
    placeholder: '+1234567890',
    hint: 'رقم دولي كامل يبدأ برمز الدولة (7 إلى 15 خانة)',
    validate: (rawInput: string) => {
      const digits = rawInput.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        return {
          isValid: false,
          error: 'رقم الهاتف الدولي يجب أن يتراوح بين 7 و 15 رقماً',
          normalized: '',
          nationalNumber: '',
        };
      }
      return {
        isValid: true,
        normalized: `+${digits}`,
        nationalNumber: digits,
      };
    },
  },
];

export const COUNTRY_BY_CODE = new Map<string, CountryPhoneDefinition>(SUPPORTED_COUNTRIES.map((c) => [c.code, c]));

/**
 * Intelligent country detector based on raw input or dial code
 */
export function detectCountryFromPhone(phone: string): string {
  const trimmed = String(phone || '').trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+20') || digits.startsWith('201')) return 'EG';
  if (trimmed.startsWith('+966') || digits.startsWith('9665')) return 'SA';
  if (trimmed.startsWith('+974') || digits.startsWith('974')) return 'QA';
  if (trimmed.startsWith('+971') || digits.startsWith('9715')) return 'AE';
  if (trimmed.startsWith('+965') || digits.startsWith('965')) return 'KW';
  if (trimmed.startsWith('+968') || digits.startsWith('968')) return 'OM';
  if (trimmed.startsWith('+973') || digits.startsWith('973')) return 'BH';
  if (trimmed.startsWith('+962') || digits.startsWith('9627')) return 'JO';

  // Check Egyptian local: 010, 011, 012, 015 (11 digits)
  if (/^01[0125]\d{8}$/.test(digits)) return 'EG';

  // Check Saudi local: 05... (10 digits)
  if (/^05\d{8}$/.test(digits)) return 'SA';

  // Check Qatar local: 8 digits starting with 3, 5, 6, 7
  if (/^[3567]\d{7}$/.test(digits)) return 'QA';

  // Check Kuwait local: 8 digits starting with 5, 6, 9
  if (/^[569]\d{7}$/.test(digits)) return 'KW';

  // Check Jordan local: 07... (10 digits)
  if (/^07\d{8}$/.test(digits)) return 'JO';

  return 'EG';
}

/**
 * Validates and normalizes phone number with respect to specified country or auto-detection
 */
export function validateAndNormalizePhone(
  phone: string | null | undefined,
  targetCountryCode?: string,
): { isValid: boolean; error?: string; normalized: string; countryCode: string; nationalNumber: string } {
  const trimmed = String(phone || '').trim();
  if (!trimmed) {
    return {
      isValid: false,
      error: 'رقم الهاتف المحمول مطلوب ولا يمكن تركه فارغاً',
      normalized: '',
      countryCode: targetCountryCode || 'EG',
      nationalNumber: '',
    };
  }

  const selectedCode =
    targetCountryCode && COUNTRY_BY_CODE.has(targetCountryCode) ? targetCountryCode : detectCountryFromPhone(trimmed);

  const countryDef = COUNTRY_BY_CODE.get(selectedCode) || COUNTRY_BY_CODE.get('EG')!;
  const result = countryDef.validate(trimmed);

  return {
    ...result,
    countryCode: selectedCode,
  };
}

/**
 * Generate extensive database search variants for any phone string entered during login.
 * This guarantees match regardless of whether DB holds +20..., 20..., 010..., or local digits.
 */
export function generatePhoneSearchVariants(rawInput: string): string[] {
  const trimmed = String(rawInput || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits || digits.length < 7) return [trimmed].filter(Boolean);

  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(digits);
  variants.add(`+${digits}`);

  // Egyptian variants
  if (digits.startsWith('20') && digits.length >= 11) {
    const local = digits.slice(2);
    variants.add(`0${local}`);
    variants.add(local);
    variants.add(`+20${local}`);
    variants.add(`20${local}`);
  } else if (digits.startsWith('01') && digits.length === 11) {
    const local = digits.slice(1);
    variants.add(`+20${local}`);
    variants.add(`20${local}`);
    variants.add(digits);
    variants.add(local);
  }

  // Saudi variants
  if (digits.startsWith('966') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(`0${local}`);
    variants.add(local);
    variants.add(`+966${local}`);
    variants.add(`966${local}`);
  } else if (digits.startsWith('05') && digits.length === 10) {
    const local = digits.slice(1);
    variants.add(`+966${local}`);
    variants.add(`966${local}`);
    variants.add(digits);
    variants.add(local);
  }

  // Qatar variants
  if (digits.startsWith('974') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(local);
    variants.add(`+974${local}`);
    variants.add(`974${local}`);
  } else if (/^[3567]\d{7}$/.test(digits)) {
    variants.add(`+974${digits}`);
    variants.add(`974${digits}`);
    variants.add(digits);
  }

  // UAE variants
  if (digits.startsWith('971') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(`0${local}`);
    variants.add(local);
    variants.add(`+971${local}`);
    variants.add(`971${local}`);
  } else if (digits.startsWith('05') && digits.length === 10) {
    const local = digits.slice(1);
    variants.add(`+971${local}`);
    variants.add(`971${local}`);
  }

  // Kuwait variants
  if (digits.startsWith('965') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(local);
    variants.add(`+965${local}`);
    variants.add(`965${local}`);
  } else if (/^[569]\d{7}$/.test(digits)) {
    variants.add(`+965${digits}`);
    variants.add(`965${digits}`);
  }

  // Oman variants
  if (digits.startsWith('968') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(local);
    variants.add(`+968${local}`);
    variants.add(`968${local}`);
  }

  // Bahrain variants
  if (digits.startsWith('973') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(local);
    variants.add(`+973${local}`);
    variants.add(`973${local}`);
  }

  // Jordan variants
  if (digits.startsWith('962') && digits.length >= 11) {
    const local = digits.slice(3);
    variants.add(`0${local}`);
    variants.add(local);
    variants.add(`+962${local}`);
    variants.add(`962${local}`);
  } else if (digits.startsWith('07') && digits.length === 10) {
    const local = digits.slice(1);
    variants.add(`+962${local}`);
    variants.add(`962${local}`);
  }

  return Array.from(variants);
}
