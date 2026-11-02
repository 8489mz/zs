/*
New file: frontend/src/features/import-sales/api/payment-method-evidence.spec.tsx
Pins the payment-method frontend/backend contract
(INV-IMPORT-PAYMENT-METHODS).

WHAT WAS WRONG: the transfer form sent no payment method and no
evidence at all: a bank transfer, cash carried by a traveller, an
LC, CAD, and an open-account payment were indistinguishable in the
money record. The approvals form sent only an EGP estimate, which
never matched the foreign amount at execution, so its approvals
could not bind a transfer at all.

WHAT THIS PINS, driving the real mutation hook with a mocked http
layer and the real payload builder:
- The builder carries the method and its evidence with the money
  record and drops empty evidence values so the backend sees only
  what the user entered.
- The required-evidence field sets match the backend engine per
  method: bank transfer needs a reference; cash carried needs
  carrier + travel date + handover receipt; LC needs number +
  issuing bank + expiry + documents; CAD needs handover proof;
  open account needs terms + due date.
- The transfer mutation POSTs the method and evidence to the
  backend route unchanged.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-query-client';
import {
  buildForeignTransferPayload,
  paymentMethodEvidenceFields,
  useRecordForeignTransferMutation,
} from '@/features/import-sales/api/shipments.api';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

function renderMutation() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRecordForeignTransferMutation(), { wrapper });
}

describe('payment-method evidence contract', () => {
  it('requires the backend evidence set per method', () => {
    expect(paymentMethodEvidenceFields('bank_transfer')).toEqual(['paymentReference']);
    expect(paymentMethodEvidenceFields('cash_carried')).toEqual([
      'carrierName',
      'travelDate',
      'handoverReceiptNo',
    ]);
    expect(paymentMethodEvidenceFields('letter_of_credit')).toEqual([
      'lcNumber',
      'lcIssuingBank',
      'lcExpiryDate',
      'lcDocuments',
    ]);
    expect(paymentMethodEvidenceFields('cash_against_documents')).toEqual(['cadHandoverProof']);
    expect(paymentMethodEvidenceFields('open_account')).toEqual(['paymentTerms', 'paymentDueDate']);
    expect(paymentMethodEvidenceFields('wire')).toEqual([]);
  });

  it('builds a cash-carried payload with method, evidence and custody account', () => {
    const payload = buildForeignTransferPayload(
      {
        supplierId: '1',
        amountEgp: 50000,
        amountForeign: 1000,
        currency: 'USD',
        bankAccountId: 24,
        idempotencyKey: 'key-1',
        notes: 'handover',
      },
      'cash_carried',
      { carrierName: 'Ahmed', travelDate: '2026-02-01', handoverReceiptNo: 'HR-9', lcNumber: '' },
    );
    expect(payload.paymentMethod).toBe('cash_carried');
    expect(payload.carrierName).toBe('Ahmed');
    expect(payload.travelDate).toBe('2026-02-01');
    expect(payload.handoverReceiptNo).toBe('HR-9');
    expect(payload.bankAccountId).toBe(24);
    expect(payload.lcNumber).toBeUndefined();
  });

  it('posts the method and evidence to the foreign-transfer route unchanged', async () => {
    httpMock.mockResolvedValueOnce({ success: true });
    const { result } = renderMutation();

    const payload = buildForeignTransferPayload(
      {
        supplierId: '1',
        amountEgp: 51000,
        amountForeign: 1000,
        currency: 'USD',
        idempotencyKey: 'key-2',
      },
      'bank_transfer',
      { paymentReference: 'SWIFT-REF-1', bankSwiftCode: 'CIBEEGCX' },
    );
    await result.current.mutateAsync(payload);

    expect(httpMock).toHaveBeenCalledTimes(1);
    const [url, options] = httpMock.mock.calls[0];
    expect(url).toBe('/api/import-sales/foreign-transfer');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.paymentMethod).toBe('bank_transfer');
    expect(body.paymentReference).toBe('SWIFT-REF-1');
    expect(body.bankSwiftCode).toBe('CIBEEGCX');
    expect(body.form4Number).toBeUndefined();
  });
});
