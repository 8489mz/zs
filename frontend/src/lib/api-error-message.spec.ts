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

/*
 * INV-USER-GRANT-NAMES-PERMISSION: when the grant guard refuses a
 * save, the server message names the blocking permission in plain
 * Arabic. The static code map must never replace that specific
 * message with a sentence that does not say WHICH permission blocks
 * the save; the star/role codes carry no dynamic detail, so they map
 * statically instead of falling back to the generic 403 sentence.
 */
describe('getFriendlyApiErrorMessage — grant refusals name the permission', () => {
  const NAMED_MESSAGE =
    'لا يمكنك منح صلاحية «النسخ الاحتياطي والاسترداد» (canManageBackups) لأن حسابك لا يملكها. أزل علامة الصح عن هذه الصلاحية ثم أعد الحفظ.';

  it('prefers the server message naming the blocking permission over the static mapping', () => {
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: 'GRANT_EXCEEDS_ACTOR_PERMISSIONS',
          message: NAMED_MESSAGE,
        },
      },
    });
    expect(message).toBe(NAMED_MESSAGE);
  });

  it('falls back to the specific static Arabic sentence when the server sends no detail', () => {
    const message = getFriendlyApiErrorMessage({
      response: {
        data: {
          code: 'GRANT_EXCEEDS_ACTOR_PERMISSIONS',
          message: 'You cannot grant a permission you do not hold',
        },
      },
    });
    expect(message).toBe('لا يمكنك منح صلاحية لا يملكها حسابك — أزل علامة الصح عن الصلاحية التي لا تملكها ثم أعد الحفظ.');
  });

  it('maps the star and role grant codes to specific Arabic sentences, never the generic 403', () => {
    expect(
      getFriendlyApiErrorMessage({
        response: { data: { code: 'GRANT_STAR_FORBIDDEN', message: 'Only the platform tenant may grant the all-permissions grant' } },
      }),
    ).toBe('لا يمكن منح صلاحية "الكل" إلا من حساب منصة المنشأة الرئيسية.');
    expect(
      getFriendlyApiErrorMessage({
        response: { data: { code: 'GRANT_ROLE_ABOVE_ACTOR', message: 'You cannot grant a role above your own' } },
      }),
    ).toBe('لا يمكنك منح دور أعلى من دور حسابك الحالي.');
  });
});
