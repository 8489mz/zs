/*
 * user-management-activity-log.spec.tsx — INV-ACTIVITY-LOG-USER-DETAILS-LABELS.
 *
 * THE BUG (proven live on test10k 2026-11-08): the Settings user-details
 * dialog (تفاصيل المستخدم → نشاط المستخدم) renders the SAME activity
 * rows as the Reports log, but it printed row.details verbatim and
 * row.title verbatim — so the recorded count-session events #26296 /
 * #26295 showed raw JSON, and HR titles showed raw English, although
 * the shared formatter (formatEmployeeActivityDetails) and the action
 * labeller (getAuditActionLabel) already translate both.
 *
 * WHAT THIS PINS, driving the REAL UserManagementSection with mocked
 * http (the R2 ledger-panel pattern): opening the details dialog for a
 * user shows the recorded approve-session and post-batch events as
 * labelled text (no JSON, no raw keys), the recorded loan title in
 * Arabic, and a non-audit row verbatim.
 */
import '@/lib/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { UserManagementSection } from './UserManagementSection';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

// Recorded live 2026-11-08 in the user-details activity log (session 24).
const APPROVE_DETAILS = JSON.stringify({
  actorUserId: '67',
  after: { sessionId: 24, status: 'posted', skippedItemIds: [] },
});

// Recorded live 2026-11-08 in the user-details activity log (session 24).
const POST_BATCH_DETAILS = JSON.stringify({
  sessionId: 24,
  firstItemId: '5212',
  itemCount: 1,
  journalEntryId: 15018,
  remaining: false,
  skippedItemIds: [],
});

const USERS_PAYLOAD = {
  users: [{ id: '67', username: 'muse', name: 'muse', role: 'admin', isActive: true, permissions: [], branchIds: [], failedLoginCount: 0 }],
  pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 },
  summary: { totalItems: 1 },
  planLimit: null,
};

const DETAILS_PAYLOAD = {
  employee: {
    id: '67',
    name: 'muse',
    username: 'muse',
    salesTotal: 0,
    salesCount: 0,
    purchasesTotal: 0,
    purchasesCount: 0,
    returnsTotal: 0,
    returnsCount: 0,
    auditCount: 3,
  },
  summary: {},
  activities: [
    {
      id: '26296',
      activityType: 'audit',
      title: 'اعتماد جلسة جرد',
      details: APPROVE_DETAILS,
      amount: null,
      createdAt: '2026-11-08T14:00:00.000Z',
      referenceLabel: '',
    },
    {
      id: '26295',
      activityType: 'audit',
      title: 'ترحيل دفعة جرد',
      details: POST_BATCH_DETAILS,
      amount: null,
      createdAt: '2026-11-08T14:01:00.000Z',
      referenceLabel: '',
    },
    {
      id: '26262',
      activityType: 'audit',
      title: 'Create HR employee loan',
      details: 'Employee loan created by muse',
      amount: null,
      createdAt: '2026-11-08T13:00:00.000Z',
      referenceLabel: '',
    },
    {
      id: '9',
      activityType: 'sale',
      title: 'بيع نقدي',
      details: 'فاتورة مبيعات #123',
      amount: 150,
      createdAt: '2026-11-08T12:00:00.000Z',
      referenceLabel: '',
    },
  ],
};

function renderSection(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <UserManagementSection branches={[]} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('UserManagementSection — user-details activity log (INV-ACTIVITY-LOG-USER-DETAILS-LABELS)', () => {
  it('renders the recorded count-session rows as labelled text, HR titles in Arabic, and non-audit rows verbatim', async () => {
    httpMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/reports/employees/')) return DETAILS_PAYLOAD;
      if (typeof url === 'string' && url.startsWith('/api/users')) return USERS_PAYLOAD;
      throw new Error(`unexpected http call in spec: ${String(url)}`);
    });
    renderSection();

    const detailsButton = await screen.findByRole('button', { name: 'تفاصيل' });
    fireEvent.click(detailsButton);

    await waitFor(() => expect(screen.getByText(/رقم القيد: #15018/)).toBeInTheDocument());
    expect(screen.getByText(/رقم المستخدم: 67/)).toBeInTheDocument();
    expect(screen.getByText(/الحالة: مرحّلة/)).toBeInTheDocument();
    expect(screen.getByText(/بنود متبقية: لا يوجد/)).toBeInTheDocument();
    expect(screen.getByText('إنشاء سلفة موظف')).toBeInTheDocument();
    expect(screen.getByText(/تم إنشاء سلفة موظف بواسطة muse/)).toBeInTheDocument();
    expect(screen.getByText('فاتورة مبيعات #123')).toBeInTheDocument();

    const text = document.body.textContent || '';
    expect(text).not.toContain('actorUserId');
    expect(text).not.toContain('sessionId');
    expect(text).not.toContain('firstItemId');
    expect(text).not.toContain('Create HR employee loan');
    expect(text).not.toContain('Employee loan created');
  });
});
