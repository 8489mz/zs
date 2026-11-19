import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** سر فارغ = إعداد ناقص، يُرفَض مغلقاً — لا سر افتراضي معروف للجميع. */
function normalizeSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new AppError('CSRF secret is not configured.', 'CSRF_SECRET_MISSING', 500);
  }
  return trimmed;
}

export function createCsrfToken(sessionId: string, secret: string): string {
  return createHmac('sha256', normalizeSecret(secret)).update(sessionId).digest('hex');
}

export function verifyCsrfToken(sessionId: string, secret: string, token: string): boolean {
  const expected = createCsrfToken(sessionId, secret);
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(String(token || ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
