/* JE-list tenant-timezone date display (INV-IMPORT-JE-LIST-TENANT-TIMEZONE-DATE,
 * proposed): journal_entries.entry_date is TIMESTAMPTZ -- the true instant.
 * JE-00015025 posted at 00:03 EET on 2026-11-09 arrives from the API as
 * 2026-11-08T22:03:00.000Z, and the list + detail rendered
 * String(entryDate).slice(0, 10) on that UTC ISO string, showing the wrong
 * day 2026-11-08. The cost-centre report entries table had the same defect
 * through formatDateOnly, which takes the UTC date part of a timestamptz
 * string. The fix reads the date in the tenant's configured timezone
 * (settings.timezone, default Africa/Cairo) via formatTenantDateKey.
 * Every expected date string below is built from literal YYYY-MM-DD
 * constants -- the helper itself builds from Intl parts in the tenant
 * zone, never from a UTC toISOString() slice.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { formatTenantDateKey } from '@/lib/format';
import { AccountingJournalEntriesPage } from '@/features/accounting/pages/AccountingJournalEntriesPage';
import { CostCenterReportModal } from '../components/cost-centers/CostCenterReportModal';

// jsdom has no scrollIntoView; the page auto-scrolls to the detail section
// when a row is selected, and the uncaught TypeError would fail the run.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

const trialInstant = '2026-11-08T22:03:00.000Z'; // 00:03 EET on 2026-11-09

const mockJournalEntries = vi.fn(() =>
  Promise.resolve({
    entries: [
      {
        id: '15025',
        entryNo: 'JE-00015025',
        entryDate: trialInstant,
        description: 'استلام شحنة',
        sourceType: 'purchase',
        sourceId: '',
        status: 'posted',
      },
    ],
    pagination: { totalItems: 1 },
  }),
);

const mockJournalEntry = vi.fn(() =>
  Promise.resolve({
    entry: {
      id: '15025',
      entryNo: 'JE-00015025',
      entryDate: trialInstant,
      description: 'استلام شحنة',
      sourceType: 'purchase',
      sourceId: '',
      status: 'posted',
      canReverse: false,
      lines: [],
      totals: { debit: 0, credit: 0 },
    },
  }),
);

vi.mock('@/features/accounting/api/accounting.api', () => ({
  accountingApi: {
    // Lazy wrappers: vi.mock factories are hoisted above the mock consts,
    // so the references must only be read at call time.
    journalEntries: (...args: Parameters<typeof mockJournalEntries>) => mockJournalEntries(...args),
    journalEntry: (...args: Parameters<typeof mockJournalEntry>) => mockJournalEntry(...args),
    reverseJournalEntry: vi.fn(() => Promise.resolve({ ok: true, message: 'ok' })),
    accounts: () => Promise.resolve({ accounts: [] }),
  },
}));

vi.mock('@/features/accounting/api/cost-centers.api', () => ({
  costCentersApi: {
    list: () => Promise.resolve([]),
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: { timezone: 'Africa/Cairo' } }),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('formatTenantDateKey', () => {
  it('shows the trial JE posted at 00:03 EET Nov 9 as 2026-11-09, not the UTC 2026-11-08', () => {
    expect(String(trialInstant).slice(0, 10)).toBe('2026-11-08');
    expect(formatTenantDateKey(trialInstant, 'Africa/Cairo')).toBe('2026-11-09');
  });

  it('keeps an afternoon JE on the same tenant day', () => {
    // 13:30 UTC = 15:30 EET on 2026-11-09.
    expect(formatTenantDateKey('2026-11-09T13:30:00.000Z', 'Africa/Cairo')).toBe('2026-11-09');
  });

  it('moves a late-UTC-evening JE to the next tenant day', () => {
    // 22:30 UTC on 2026-11-09 = 00:30 EET on 2026-11-10.
    expect(formatTenantDateKey('2026-11-09T22:30:00.000Z', 'Africa/Cairo')).toBe('2026-11-10');
  });

  it('lets the tenant zone drive the day, not the machine zone', () => {
    // 21:30 UTC on 2026-11-08 is 23:30 in Cairo (still Nov 8) but 01:30 in Dubai (Nov 9).
    expect(formatTenantDateKey('2026-11-08T21:30:00.000Z', 'Africa/Cairo')).toBe('2026-11-08');
    expect(formatTenantDateKey('2026-11-08T21:30:00.000Z', 'Asia/Dubai')).toBe('2026-11-09');
  });

  it('passes a calendar-day string through untouched and accepts a Date', () => {
    expect(formatTenantDateKey('2026-11-09', 'Asia/Dubai')).toBe('2026-11-09');
    expect(formatTenantDateKey(new Date(trialInstant), 'Africa/Cairo')).toBe('2026-11-09');
  });

  it('defaults to Africa/Cairo and handles empty/invalid values like formatDateOnly', () => {
    expect(formatTenantDateKey(trialInstant)).toBe('2026-11-09');
    expect(formatTenantDateKey('')).toBe('—');
    expect(formatTenantDateKey(null)).toBe('—');
    expect(formatTenantDateKey('not-a-date', 'Africa/Cairo')).toBe('not-a-date');
  });

  it('never throws on an unknown zone', () => {
    expect(formatTenantDateKey(trialInstant, 'Mars/Olympus')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('AccountingJournalEntriesPage tenant-timezone dates', () => {
  it('lists JE-00015025 under 2026-11-09 and shows the same day in its detail', async () => {
    renderWithClient(<AccountingJournalEntriesPage />);
    expect(await screen.findByText('JE-00015025')).toBeTruthy();
    expect(await screen.findByText('2026-11-09')).toBeTruthy();
    expect(screen.queryByText('2026-11-08')).toBeNull();

    fireEvent.click(screen.getByText('JE-00015025'));
    // findAllByText resolves as soon as ANY match exists, so wait for the
    // detail to load (its entry number appears a second time) before
    // counting the date cells.
    await waitFor(() => expect(screen.getAllByText('JE-00015025')).toHaveLength(2));
    // List cell + detail line both show the tenant day now.
    expect(screen.getAllByText('2026-11-09')).toHaveLength(2);
    expect(screen.queryByText('2026-11-08')).toBeNull();
  });
});

describe('CostCenterReportModal tenant-timezone dates', () => {
  it('shows the JE line under 2026-11-09, not the UTC 2026-11-08', async () => {
    const reportData = {
      center: { name: 'مشروع', code: 'CC-1' },
      summary: { totalDebit: 100, totalCredit: 100 },
      entries: [
        {
          entryDate: trialInstant,
          entryNumber: 'JE-00015025',
          accountName: 'المخزون',
          description: 'استلام شحنة',
          debit: 100,
          credit: 0,
        },
      ],
    };
    renderWithClient(
      <CostCenterReportModal
        centerId={1}
        onClose={() => {}}
        reportData={reportData}
        isLoading={false}
        fromDate="2026-11-01"
        toDate="2026-11-30"
        onFromDateChange={() => {}}
        onToDateChange={() => {}}
      />,
    );
    expect(await screen.findByText('2026-11-09')).toBeTruthy();
    expect(screen.queryByText('2026-11-08')).toBeNull();
  });
});
