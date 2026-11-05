import { describe, expect, it } from 'vitest';
import { extractServerDetailMessage, getSubmitSaleErrorMessage } from './pos-submit-error';

/*
 * The HTTP layer wraps failures in an ApiError whose message is the friendly
 * code-mapped text (VALIDATION_ERROR -> 'البيانات المدخلة غير صحيحة.') while the
 * server's specific reason lives on ApiError.details (the raw error payload).
 * The submit path must show the specific reason, not the generic banner.
 */
describe('POS submit error message', () => {
  it('shows the server detailed validation message instead of the generic banner', () => {
    const apiError = {
      message: 'البيانات المدخلة غير صحيحة.',
      status: 400,
      code: 'VALIDATION_ERROR',
      details: {
        statusCode: 400,
        error: {
          message: "الحقل 'أصناف الطلب' غير مسموح بإرسال nameEn",
          code: 'VALIDATION_ERROR',
        },
        path: '/api/sales',
      },
    };
    expect(getSubmitSaleErrorMessage(apiError))
      .toBe("الحقل 'أصناف الطلب' غير مسموح بإرسال nameEn");
  });

  it('extracts the detail from a response-shaped error as well', () => {
    const error = {
      message: 'Request failed with status code 400',
      response: { data: { error: { message: 'الحقل المطلوب غير موجود', code: 'VALIDATION_ERROR' } } },
    };
    expect(extractServerDetailMessage(error)).toBe('الحقل المطلوب غير موجود');
    expect(getSubmitSaleErrorMessage(error)).toBe('الحقل المطلوب غير موجود');
  });

  it('falls back to the error message when there is no server detail', () => {
    expect(getSubmitSaleErrorMessage(new Error('البيانات المدخلة غير صحيحة.')))
      .toBe('البيانات المدخلة غير صحيحة.');
    expect(getSubmitSaleErrorMessage(new Error('تعذر الاتصال بالخادم')))
      .toBe('تعذر الاتصال بالخادم');
  });

  it('still shows the server detailed stock message directly', () => {
    const apiError = {
      message: 'البيانات المدخلة غير صحيحة.',
      details: { error: { message: 'رصيد الصنف "منتج" غير كافٍ: المتوفر 2 والمطلوب 5', code: 'INSUFFICIENT_STOCK' } },
    };
    expect(getSubmitSaleErrorMessage(apiError))
      .toBe('رصيد الصنف "منتج" غير كافٍ: المتوفر 2 والمطلوب 5');
  });

  it('still rewrites a generic stock message to the fixed Arabic text', () => {
    expect(getSubmitSaleErrorMessage(new Error('insufficient stock for item')))
      .toBe('الكمية المطلوبة أكبر من المخزون المتاح في المخزن الحالي. راجع الكميات في السلة قبل إتمام البيع.');
  });

  it('returns the fallback text when the error carries nothing', () => {
    expect(getSubmitSaleErrorMessage(new Error(''))).toBe('تعذر حفظ الفاتورة');
    expect(getSubmitSaleErrorMessage(undefined)).toBe('تعذر حفظ الفاتورة');
    expect(extractServerDetailMessage(new Error('x'))).toBe('');
  });
});
