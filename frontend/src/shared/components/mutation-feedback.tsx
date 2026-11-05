import { getFriendlyApiErrorMessage } from '@/lib/errors';

interface MutationFeedbackProps {
  isError?: boolean;
  isSuccess?: boolean;
  error?: unknown;
  errorFallback?: string;
  successText?: string;
  /**
   * INV-TRANSFER-SAME-BRANCH-RECEIPT: when true, the rendered error also
   * shows the server's real code (and constraint/detail when the server
   * sent one), so a receipt that fails again names the actual problem
   * instead of only the generic friendly message. Off by default: other
   * callers keep their current text unchanged.
   */
  showErrorCode?: boolean;
}

function serverErrorCode(error: unknown): string | undefined {
  const candidate = error as { code?: unknown } | null;
  if (candidate && typeof candidate.code === 'string' && candidate.code.trim()) return candidate.code.trim();
  return undefined;
}

function serverErrorDetail(error: unknown): string | undefined {
  const details = (error as { details?: unknown } | null)?.details as
    | { error?: { details?: unknown }; details?: unknown }
    | null
    | undefined;
  const payload = (details?.error as { details?: unknown } | undefined)?.details ?? details?.details;
  if (payload && typeof payload === 'object') {
    const record = payload as { constraint?: unknown; message?: unknown };
    if (typeof record.constraint === 'string' && record.constraint.trim()) return record.constraint.trim();
    if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  }
  return undefined;
}

export function MutationFeedback({
  isError,
  isSuccess,
  error,
  errorFallback = '\u062a\u0639\u0630\u0631 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629.',
  successText,
  showErrorCode,
}: MutationFeedbackProps) {
  if (isError) {
    const friendly = getFriendlyApiErrorMessage(error, errorFallback);
    const code = showErrorCode ? serverErrorCode(error) : undefined;
    const detail = showErrorCode ? serverErrorDetail(error) : undefined;
    const suffix = code ? ` (${code}${detail ? ` \u00b7 ${detail}` : ''})` : '';
    return <div className="error-box">{friendly}{suffix}</div>;
  }

  if (isSuccess && successText) {
    return <div className="success-box">{successText}</div>;
  }

  return null;
}