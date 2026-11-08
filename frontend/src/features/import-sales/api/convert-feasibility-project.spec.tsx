/*
New file: frontend/src/features/import-sales/api/convert-feasibility-project.spec.tsx
Pins the I1-P2 wiring: approving a feasibility study must call the
convert endpoint of the EXISTING project, never the create-project
endpoint (trial problem 2, 2026-11-09: approving the study for
IMP-261108-0001 created a second project IMP-261109-0001).

WHAT WAS WRONG: the convert mutation fell through to
POST /api/import-sales/projects whenever the caller passed no
projectId, and the approval handler passed a create-project payload
with no projectId at all — so every approval minted a duplicate
project.

WHAT THIS PINS, driving the REAL useConvertFeasibilityToProjectMutation
with a mocked http layer:
- with a projectId it POSTs to
  /api/import-sales/projects/<id>/convert-feasibility with the DTO.
- without a projectId (including the old create-shaped payload) it
  fails closed with IMPORT_CONVERT_PROJECT_ID_REQUIRED and http is
  never called — no request can reach the create route through it.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/test-query-client';
import { useConvertFeasibilityToProjectMutation } from '@/features/import-sales/api/shipments.api';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

function renderMutation() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useConvertFeasibilityToProjectMutation(), { wrapper });
}

describe('convert feasibility approval wiring', () => {
  it('posts to the convert route of the existing project', async () => {
    httpMock.mockResolvedValueOnce({ success: true, projectId: 'proj-1' });
    const { result } = renderMutation();

    await result.current.mutateAsync({ projectId: 'proj-1' });

    expect(httpMock).toHaveBeenCalledTimes(1);
    const [url, options] = httpMock.mock.calls[0];
    expect(url).toBe('/api/import-sales/projects/proj-1/convert-feasibility');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).projectId).toBe('proj-1');
  });

  it('fails closed without a project id and never calls the create route', async () => {
    const { result } = renderMutation();

    await expect(
      result.current.mutateAsync({
        title: 'مشروع استيراد معتمد (Widget)',
        targetMarket: 'السوق المحلي المصري',
        countryOrigin: 'الصين',
        allocatedCapital: 1107.6,
        targetRoiPercentage: 25,
        feasibilityData: {},
        notes: 'تم تحويله آلياً من محرك دراسة الجدوى الاستيرادية',
      }),
    ).rejects.toThrow(/IMPORT_CONVERT_PROJECT_ID_REQUIRED/);
    expect(httpMock).not.toHaveBeenCalled();
  });
});
