/*
New file: frontend/src/features/crm/components/CrmDealCreateModal.spec.tsx
Pins the CRM opportunity form wipe (INV-CRM-OPPORTUNITY-FORM-RESET).

THE GAP: useSystemCurrency() returned a fresh object (and fresh closures) on
every render, so the modal's initialDealForm useMemo -- keyed on the whole
systemCurrency object -- produced a new identity on every render, and the
reset useEffect ([open, initialDealForm]) re-ran on every render, resetting
the form to empty while the user was typing. A typed title never survived
to submit, so creating an opportunity was impossible (the submit guard
showed "يرجى إدخال عنوان الفرصة البيعية." for a title the user had typed).

THE RULE: the form resets only when the modal opens (closed -> open
transition); typing and re-renders while open never wipe the draft. The
currency dependency is the stable currencyCode string, not the hook's
fresh object identity.

WHAT THIS PINS, driving the REAL CrmDealCreateModal (http mocked at the
transport, so the real crmApi.create POST is asserted):
- typing a title survives keystrokes and a parent re-render while open.
- submit posts POST /api/crm/deals with the typed title and closes the modal.
- closing and reopening the modal resets the form to an empty title
  (the intended reset-on-open still works).

PRE-FIX FAILURE MODE (proven 2026-11-05): without the fix these modal
tests do not fail by assertion -- they never settle at all. The reset
effect re-ran on every render and called setDealForm with a fresh object,
which scheduled another render, forever; a pre-fix run was killed after
70 s with zero test progress (vitest's own 15 s test timeout never fired).
The fast-failing guard is use-system-currency.spec.tsx, which fails by
assertion in ~50 ms without the fix. If these modal tests ever hang again,
the wipe bug has regressed.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmDealCreateModal } from '@/features/crm/components/CrmDealCreateModal';
import { createTestQueryClient } from '@/test/test-query-client';

const { httpMock } = vi.hoisted(() => ({
  httpMock: vi.fn(),
}));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const TITLE = 'توريد معدات لمستشفى الشفاء';

function renderModal() {
  const queryClient = createTestQueryClient();
  const onClose = vi.fn();
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  function Modal({ open }: { open: boolean }) {
    return <CrmDealCreateModal open={open} onClose={onClose} />;
  }
  const view = render(<Modal open />, { wrapper: Wrapper });
  return {
    ...view,
    onClose,
    rerenderModal: (open: boolean) => view.rerender(<Modal open={open} />),
  };
}

describe('CrmDealCreateModal', () => {
  beforeEach(() => {
    httpMock.mockReset();
    httpMock.mockImplementation(async (path: unknown, init?: { method?: string; body?: string }) => {
      if (path === '/api/crm/deals' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { title?: string };
        return { ok: true, deal: { id: 1, title: body.title ?? '' } };
      }
      if (path === '/api/customers') return { customers: [] };
      if (path === '/api/users') return { users: [] };
      return {};
    });
  });

  it('keeps a typed title across re-renders instead of resetting it', async () => {
    const user = userEvent.setup();
    const { rerenderModal } = renderModal();

    const title = await screen.findByPlaceholderText(/توريد شحنة معدات/);
    await user.type(title, TITLE);
    expect(title).toHaveValue(TITLE);

    // A parent re-render (e.g. the pipeline page re-rendering) must not wipe the draft.
    rerenderModal(true);
    expect(screen.getByPlaceholderText(/توريد شحنة معدات/)).toHaveValue(TITLE);
  });

  it('submits the typed title with POST /api/crm/deals and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    const title = await screen.findByPlaceholderText(/توريد شحنة معدات/);
    await user.type(title, TITLE);
    await user.click(screen.getByRole('button', { name: 'حفظ الفرصة البيعية' }));

    await waitFor(() =>
      expect(httpMock).toHaveBeenCalledWith(
        '/api/crm/deals',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(TITLE),
        }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('resets the form when the modal is closed and reopened', async () => {
    const user = userEvent.setup();
    const { rerenderModal } = renderModal();

    const title = await screen.findByPlaceholderText(/توريد شحنة معدات/);
    await user.type(title, TITLE);
    expect(title).toHaveValue(TITLE);

    rerenderModal(false);
    rerenderModal(true);

    expect(await screen.findByPlaceholderText(/توريد شحنة معدات/)).toHaveValue('');
  });
});
