import { describe, expect, it } from 'vitest';
import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';

/*
 * INV-IMPORT-CONTAINER-DEPOSIT (I3-D8): the deposit form always failed
 * with the generic "البيانات المدخلة غير صحيحة." because the record
 * mutation sent `idempotencyKey` (and `receiptNo`), fields the
 * RecordContainerDepositDto does not declare, so the whitelist +
 * forbidNonWhitelisted validation pipe rejected the request before the
 * service ran. The pipe names the field ("الحقل idempotencyKey غير
 * مسموح إرساله.") and the backend preserves it, but this mapper
 * replaced every VALIDATION_ERROR with the generic code text and
 * threw the field name away. A VALIDATION_ERROR must keep the
 * backend's field-specific message; other codes keep their mapped
 * text, and the generic backend fallback still maps to generic.
 */
describe('api-error-message VALIDATION_ERROR (I3-D8)', () => {
  const validationBody = (message: string) => ({
    statusCode: 400,
    error: {
      message,
      code: 'VALIDATION_ERROR',
      details: { messages: [message] },
    },
    timestamp: '2026-11-09T00:00:00.000Z',
    path: '/api/import-sales/container-deposits',
    requestId: null,
  });

  it('keeps the field-specific backend message for a rejected deposit field', () => {
    const body = validationBody('الحقل idempotencyKey غير مسموح إرساله.');
    expect(getFriendlyApiErrorMessage(body)).toBe('الحقل idempotencyKey غير مسموح إرساله.');
  });

  it('keeps the field-specific message for a missing required field', () => {
    const body = validationBody('الحقل expectedReturnDate مطلوب.');
    expect(getFriendlyApiErrorMessage(body)).toBe('الحقل expectedReturnDate مطلوب.');
  });

  it('still returns the generic text when the backend message itself is generic', () => {
    const body = validationBody('البيانات المرسلة غير صحيحة.');
    expect(getFriendlyApiErrorMessage(body)).toBe('البيانات المدخلة غير صحيحة.');
  });

  it('does not change the mapped text of other error codes', () => {
    expect(
      getFriendlyApiErrorMessage({
        statusCode: 404,
        error: { message: 'Product not found.', code: 'PRODUCT_NOT_FOUND', details: null },
      }),
    ).toBe('الصنف المطلوب غير موجود أو تم حذفه.');
    expect(
      getFriendlyApiErrorMessage({
        statusCode: 400,
        error: { message: 'Amount must be greater than zero', code: 'AMOUNT_INVALID', details: null },
      }),
    ).toBe('المبلغ يجب أن يكون أكبر من صفر.');
  });

  it('still passes through a specific message that carries no mapped code', () => {
    expect(
      getFriendlyApiErrorMessage({
        statusCode: 400,
        error: {
          message: 'الحساب المحاسبي المحدد (11) غير صالح لدور (bank) أو معطل.',
          code: 'HTTP_ERROR',
          details: null,
        },
      }),
    ).toBe('الحساب المحاسبي المحدد (11) غير صالح لدور (bank) أو معطل.');
  });
});
