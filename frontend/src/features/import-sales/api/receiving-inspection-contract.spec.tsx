/*
New file: frontend/src/features/import-sales/api/receiving-inspection-contract.spec.tsx
Pins the GRN approval frontend/backend contract (INV-IMPORT-GRN-APPROVAL-POSTED-GATE).

WHAT WAS WRONG (live trial phase 2, problem D10): the GRN dialog
posted its own shape verbatim — shipmentId, projectId,
warehouseLocationId, inspectorName, overallStatus, notes, items —
to POST /api/import-sales/qc-inspections, whose DTO
(CreateQcInspectionDto) declares only stage, inspectionDate,
inspectorName, sampleSize, passedQuantity, failedQuantity,
defectNotes, status, projectId, shipmentId. The global validation
pipe (whitelist + forbidNonWhitelisted + stopAtFirstError) rejected
every submit before the service, and the frontend http layer maps
code VALIDATION_ERROR to the generic 'البيانات المدخلة غير صحيحة.',
discarding the backend's specific field message — so the user saw
only the generic error, twice, with no field named.

WHAT THIS PINS, driving the real mutation hook with a mocked http layer:
- The dialog-shaped payload is mapped to exactly the backend DTO
  fields (stage 'receiving', today's inspectionDate, inspectorName,
  sampleSize / passedQuantity / failedQuantity computed from the
  items, defectNotes from notes, status 'passed'); no legacy field
  (warehouseLocationId, overallStatus, notes, items) survives.
- The error helper surfaces the backend's specific message carried
  on ApiError.details instead of the generic VALIDATION_ERROR text.
- The backend posted-receipt + duplicate gates are pinned by
  backend/test/critical/import-grn-approval-posted-gate.spec.ts.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-query-client';
import {
  buildReceivingInspectionPayload,
  receivingInspectionErrorMessage,
  useCreateReceivingInspectionMutation,
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
  return renderHook(() => useCreateReceivingInspectionMutation(), { wrapper });
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const dialogDto = {
  shipmentId: 'sh-1',
  projectId: 'proj-1',
  warehouseLocationId: '10',
  inspectorName: 'Storekeeper',
  overallStatus: 'approved',
  notes: 'Seal intact',
  items: [
    { shipmentItemId: 'item-1', productId: 5, expectedQty: 10, receivedQty: 10, acceptedQty: 9, damagedQty: 1, shortageQty: 0 },
    { shipmentItemId: 'item-2', productId: 6, expectedQty: 4, receivedQty: 3, acceptedQty: 3, damagedQty: 0, shortageQty: 1 },
  ],
};

describe('receiving-inspection frontend contract', () => {
  it('maps the dialog payload to exactly the backend DTO fields', () => {
    const payload = buildReceivingInspectionPayload(dialogDto);
    expect(payload).toEqual({
      stage: 'receiving',
      inspectionDate: localToday(),
      inspectorName: 'Storekeeper',
      sampleSize: 13,
      passedQuantity: 12,
      failedQuantity: 2,
      defectNotes: 'Seal intact',
      status: 'passed',
      shipmentId: 'sh-1',
      projectId: 'proj-1',
    });
    expect(payload).not.toHaveProperty('warehouseLocationId');
    expect(payload).not.toHaveProperty('overallStatus');
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('items');
  });

  it('posts the mapped payload to the qc-inspections route', async () => {
    httpMock.mockResolvedValueOnce({ id: 'qc-1', stage: 'receiving' });
    const { result } = renderMutation();

    await result.current.mutateAsync(dialogDto);

    expect(httpMock).toHaveBeenCalledTimes(1);
    const [path, init] = httpMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe('/api/import-sales/qc-inspections');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.stage).toBe('receiving');
    expect(body.inspectionDate).toBe(localToday());
    expect(body.sampleSize).toBe(13);
    expect(body.passedQuantity).toBe(12);
    expect(body.failedQuantity).toBe(2);
    expect(body).not.toHaveProperty('warehouseLocationId');
    expect(body).not.toHaveProperty('items');
  });

  it('surfaces the backend specific message instead of the generic VALIDATION_ERROR text', () => {
    const err: any = new Error('البيانات المدخلة غير صحيحة.');
    err.code = 'VALIDATION_ERROR';
    err.details = {
      statusCode: 400,
      error: {
        message: 'الحقل stage مطلوب.',
        code: 'VALIDATION_ERROR',
        details: { messages: ['الحقل stage مطلوب.'] },
      },
    };
    expect(receivingInspectionErrorMessage(err)).toBe('الحقل stage مطلوب.');
  });

  it('falls back to the error message when no specific backend message survives', () => {
    const err: any = new Error('سند استلام هذه الشحنة مرحّل بالفعل؛ لا يمكن اعتماد محضر فحص واستلام ثانٍ. [IMPORT_GRN_RECEIPT_ALREADY_POSTED]');
    err.code = 'HTTP_ERROR';
    expect(receivingInspectionErrorMessage(err)).toBe(
      'سند استلام هذه الشحنة مرحّل بالفعل؛ لا يمكن اعتماد محضر فحص واستلام ثانٍ. [IMPORT_GRN_RECEIPT_ALREADY_POSTED]',
    );
    expect(receivingInspectionErrorMessage(null)).toBe('تعذر حفظ محضر الفحص والاستلام');
  });
});
