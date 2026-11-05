/*
 * POS submit error message: prefer the server's detailed message over the generic
 * code-mapped banner.
 *
 * The HTTP layer wraps every failure in an ApiError whose message is the friendly
 * code-mapped text (VALIDATION_ERROR -> 'البيانات المدخلة غير صحيحة.') while the
 * server's specific reason lives on ApiError.details (the raw error payload,
 * details.error.message). Showing only the mapped text hides the actual problem
 * (e.g. which field the server rejected), so the submit path reads the detail
 * first and falls back to the error's own message when there is no detail.
 */
export function extractServerDetailMessage(error: unknown): string {
  const candidates: Array<unknown> = [];
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const details = record.details as Record<string, unknown> | undefined;
    if (details && typeof details === 'object') {
      const nested = details.error as Record<string, unknown> | undefined;
      if (nested && typeof nested === 'object') candidates.push(nested.message);
      candidates.push(details.message);
    }
    const response = record.response as Record<string, unknown> | undefined;
    if (response && typeof response === 'object') {
      const data = response.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        const nested = data.error as Record<string, unknown> | undefined;
        if (nested && typeof nested === 'object') candidates.push(nested.message);
        candidates.push(data.message);
      }
    }
  }
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function getSubmitSaleErrorMessage(error: unknown) {
  const serverMessage = extractServerDetailMessage(error);
  const raw = (serverMessage || (error instanceof Error ? String(error.message || '').trim() : '')).trim();
  if (!raw) return 'تعذر حفظ الفاتورة';

  // If the server provided our detailed, dynamic stock message, display it directly!
  if (
    raw.includes('رصيد الصنف')
    || raw.includes('غير كافٍ')
    || raw.includes('متوفر في:')
  ) {
    return raw;
  }

  const normalized = raw.toLowerCase();
  if (
    normalized.includes('الكمية المطلوبة أكبر من المخزون المتاح')
    || normalized.includes('insufficient stock')
    || normalized.includes('stock')
    || normalized.includes('inventory')
  ) {
    return 'الكمية المطلوبة أكبر من المخزون المتاح في المخزن الحالي. راجع الكميات في السلة قبل إتمام البيع.';
  }
  return raw;
}
