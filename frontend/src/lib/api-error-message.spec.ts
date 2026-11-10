/*
 * INV-REST-KIOSK-OWN-CATALOG-TRUTH (T14-B): a Postgres 23502 on the
 * sale_items.modifiers column must name the field end to end. The
 * kiosk trial showed only the generic "يوجد حقل مطلوب لم يتم إدخاله."
 * because `modifiers` was missing from the named maps on both sides —
 * the UI masked a database error as a missing form field, which is
 * exactly what the specific-errors rule forbids.
 *
 * These cases drive the real getFriendlyApiErrorMessage over the real
 * API_FIELD_REQUIRED_MESSAGES map: a 23502 naming `modifiers` (by code
 * or by raw message) returns the field-named message, never the
 * generic fallback; an unnamed column still falls back generically.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { getFriendlyApiErrorMessage } from './api-error-message';

const FIELD_MESSAGE = 'الإضافات مطلوبة.';
const GENERIC_MESSAGE = 'يوجد حقل مطلوب لم يتم إدخاله.';

afterEach(() => {
  document.documentElement.lang = '';
  document.documentElement.dir = 'rtl';
  window.localStorage.removeItem('i18nextLng');
});

describe('getFriendlyApiErrorMessage — modifiers 23502 names the field (T14-B)', () => {
  it('names the field for a DB_NOT_NULL_VIOLATION carrying the modifiers column', () => {
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: 'DB_NOT_NULL_VIOLATION',
          message: FIELD_MESSAGE,
          details: { column: 'modifiers' },
        },
      },
    });
    expect(message).toBe(FIELD_MESSAGE);
  });

  it('names the field for a raw 23502 message naming the modifiers column', () => {
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: '23502',
          message: 'null value in column "modifiers" of relation "sale_items" violates not-null constraint',
        },
      },
    });
    expect(message).toBe(FIELD_MESSAGE);
  });

  it('still falls back generically for a 23502 on an unnamed column', () => {
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: '23502',
          message: 'null value in column "mystery_col" violates not-null constraint',
        },
      },
    });
    expect(message).toBe(GENERIC_MESSAGE);
  });

  it('translates the field-named message in English mode', () => {
    document.documentElement.lang = 'en';
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: 'DB_NOT_NULL_VIOLATION',
          message: FIELD_MESSAGE,
          details: { column: 'modifiers' },
        },
      },
    });
    expect(message).toBe('Modifiers are required.');
  });
});
