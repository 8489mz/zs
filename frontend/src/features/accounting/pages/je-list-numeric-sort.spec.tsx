/* JE-list numeric document order (INV-ACCOUNTING-JE-LIST-NUMERIC-SORT).
 * Live re-test R10: the JE list sorted JE-00015026 after JE-00015009.
 * The page defaulted to sorting by entry day (date desc), and
 * JE-00015026 is dated 2026-11-08 while JE-00015009 is dated
 * 2026-11-09, so the newer document landed after the older one; the
 * entryNo column also sorted by the row identity instead of the
 * visible number. The mock below returns the rows in the old served
 * order (id desc: 15026, 15009, 15029) with the backdated dates, and
 * pins the DOM order the user actually sees: newest document first,
 * JE-00015029, JE-00015026, JE-00015009 — 15026 in its correct place
 * between 15029 and 15009. Clicking the entryNo header flips to
 * ascending numeric order 15009, 15026, 15029. The backend half
 * (served order + entry_no cursor) is pinned by
 * backend/test/critical/je-list-numeric-sort.spec.ts.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AccountingJournalEntriesPage } from '@/features/accounting/pages/AccountingJournalEntriesPage';

// jsdom has no scrollIntoView; the page auto-scrolls to the detail section
// when a row is selected, and the uncaught TypeError would fail the run.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

// Served in the old id-desc order, ids anti-correlated with the numbers,
// and the higher number carries the earlier date — the exact R10 shape.
const mockJournalEntries = vi.fn(() =>
  Promise.resolve({
    entries: [
      { id: '902', entryNo: 'JE-00015026', entryDate: '2026-11-08', description: 'broker advance', sourceType: 'manual', sourceId: '', status: 'posted' },
      { id: '901', entryNo: 'JE-00015009', entryDate: '2026-11-09', description: 'earlier journal', sourceType: 'manual', sourceId: '', status: 'posted' },
      { id: '900', entryNo: 'JE-00015029', entryDate: '2026-11-09', description: 'invoice', sourceType: 'sale', sourceId: '', status: 'posted' },
    ],
    pagination: { totalItems: 3 },
  }),
);

const mockJournalEntry = vi.fn(() =>
  Promise.resolve({
    entry: {
      id: '900',
      entryNo: 'JE-00015029',
      entryDate: '2026-11-09',
      description: 'invoice',
      sourceType: 'sale',
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

function listedEntryNos(): string[] {
  return screen.getAllByText(/^JE-000150\d\d$/).map((el) => el.textContent || '');
}

describe('AccountingJournalEntriesPage numeric document order', () => {
  it('lists JE-00015026 between JE-00015029 and JE-00015009 by default, newest document first', async () => {
    renderWithClient(<AccountingJournalEntriesPage />);
    expect(await screen.findByText('JE-00015029')).toBeTruthy();
    expect(listedEntryNos()).toEqual(['JE-00015029', 'JE-00015026', 'JE-00015009']);
  });

  it('sorts the entryNo column in true ascending numeric order when its header is clicked', async () => {
    renderWithClient(<AccountingJournalEntriesPage />);
    expect(await screen.findByText('JE-00015029')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /رقم القيد/ }));
    expect(listedEntryNos()).toEqual(['JE-00015009', 'JE-00015026', 'JE-00015029']);
  });
});
