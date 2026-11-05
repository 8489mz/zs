/*
New file: frontend/src/shared/components/mutation-feedback.spec.tsx

WHAT THIS PINS (INV-TRANSFER-SAME-BRANCH-RECEIPT): a failed transfer
receipt must show the server's real reason -- its error code and the
database constraint/detail when the server sent one -- instead of only
the generic friendly message. MutationFeedback renders the code
suffix only when showErrorCode is set, so every other caller keeps
its current text unchanged.

The fake errors below mirror the real ApiError shape built by
frontend/src/lib/http.ts: { message, status, code, details } where
details is the full response payload
{ statusCode, error: { message, code, details: { constraint } } }.
*/

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MutationFeedback } from '@/shared/components/mutation-feedback';

const CHECK_VIOLATION_ERROR = {
  message: 'قيمة غير صحيحة في أحد الحقول.',
  status: 400,
  code: 'DB_CHECK_VIOLATION',
  details: {
    statusCode: 400,
    error: {
      message: 'قيمة غير صحيحة في أحد الحقول.',
      code: 'DB_CHECK_VIOLATION',
      details: { constraint: 'stock_transfers_location_diff' },
    },
  },
};

const NAMED_ERROR = {
  message: 'كمية أو بند استلام التحويل غير صالح',
  status: 400,
  code: 'TRANSFER_RECEIPT_INVALID',
  details: null,
};

function errorBoxText(): string {
  return screen.getByText((_, element) => element?.className === 'error-box').textContent || '';
}

describe('MutationFeedback showErrorCode', () => {
  it('shows the server code and constraint when showErrorCode is set', () => {
    render(<MutationFeedback isError error={CHECK_VIOLATION_ERROR} showErrorCode />);
    const text = errorBoxText();
    expect(text).toContain('قيمة غير صحيحة في أحد الحقول.');
    expect(text).toContain('DB_CHECK_VIOLATION');
    expect(text).toContain('stock_transfers_location_diff');
  });

  it('shows only the friendly message without showErrorCode', () => {
    render(<MutationFeedback isError error={CHECK_VIOLATION_ERROR} />);
    const text = errorBoxText();
    expect(text).toContain('قيمة غير صحيحة في أحد الحقول.');
    expect(text).not.toContain('DB_CHECK_VIOLATION');
    expect(text).not.toContain('stock_transfers_location_diff');
  });

  it('shows the code for a named server error with no constraint detail', () => {
    render(<MutationFeedback isError error={NAMED_ERROR} showErrorCode />);
    const text = errorBoxText();
    expect(text).toContain('كمية أو بند استلام التحويل غير صالح');
    expect(text).toContain('TRANSFER_RECEIPT_INVALID');
  });

  it('shows the server detail message for an invalid-text error', () => {
    const invalidTextError = {
      message: 'قيمة غير صحيحة في أحد الحقول.',
      status: 400,
      code: 'DB_INVALID_TEXT_REPRESENTATION',
      details: {
        statusCode: 400,
        error: {
          message: 'قيمة غير صحيحة في أحد الحقول.',
          code: 'DB_INVALID_TEXT_REPRESENTATION',
          details: { message: 'invalid input syntax for type numeric: "NaN"' },
        },
      },
    };
    render(<MutationFeedback isError error={invalidTextError} showErrorCode />);
    const text = errorBoxText();
    expect(text).toContain('DB_INVALID_TEXT_REPRESENTATION');
    expect(text).toContain('invalid input syntax for type numeric');
  });
});
