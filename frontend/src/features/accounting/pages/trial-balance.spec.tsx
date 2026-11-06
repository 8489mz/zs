/* Trial balance page (INV-TRIAL-BALANCE-PAGE): the dedicated page shows
 * every account with its debit/credit columns, proves total debit = total
 * credit, and shows a zero-balance account with 0.00 / 0.00 instead of
 * dropping it.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TrialBalancePage } from './TrialBalancePage';

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/accounting/trial-balance' }),
}));

const balancedReport = {
  asOfDate: '2026-09-30',
  rows: [
    { id: 1, code: '1010', nameAr: 'الصندوق', nameEn: 'Cash', accountType: 'asset', totalDebit: 1000, totalCredit: 400, debit: 600, credit: 0 },
    { id: 2, code: '1020', nameAr: 'البنك', nameEn: 'Bank', accountType: 'asset', totalDebit: 0, totalCredit: 0, debit: 0, credit: 0 },
    { id: 4, code: '4100', nameAr: 'الإيرادات', nameEn: 'Revenue', accountType: 'revenue', totalDebit: 0, totalCredit: 1000, debit: 0, credit: 1000 },
    { id: 5, code: '5100', nameAr: 'المصروفات', nameEn: 'Expenses', accountType: 'expense', totalDebit: 400, totalCredit: 0, debit: 400, credit: 0 },
  ],
  totalDebit: 1000,
  totalCredit: 1000,
  difference: 0,
  isBalanced: true,
};

const mockTrialBalance = vi.fn(() => Promise.resolve(balancedReport));

vi.mock('@/features/accounting/api/accounting.api', () => ({
  financialReportsApi: {
    trialBalance: (...args: unknown[]) => mockTrialBalance(...args),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TrialBalancePage />
    </QueryClientProvider>,
  );
}

describe('TrialBalancePage', () => {
  it('shows every account with debit/credit columns and proves the balance', async () => {
    renderPage();
    expect(await screen.findByText('ميزان المراجعة متوازن محاسبياً بدقة 100%')).toBeTruthy();
    expect(await screen.findByText('الصندوق')).toBeTruthy();
    expect(await screen.findByText('البنك')).toBeTruthy();
    expect(await screen.findByText('الإيرادات')).toBeTruthy();
    // Cash nets to a 600.00 debit; totals prove 1,000.00 = 1,000.00.
    expect(await screen.findByText('600.00')).toBeTruthy();
    expect((await screen.findAllByText('1,000.00')).length).toBeGreaterThan(0);
    // The zero-balance bank account is shown, not dropped.
    expect((await screen.findAllByText('0.00')).length).toBeGreaterThan(0);
    expect(mockTrialBalance).toHaveBeenCalled();
  });

  it('names the real difference when the trial balance does not balance', async () => {
    mockTrialBalance.mockResolvedValueOnce({
      ...balancedReport,
      totalCredit: 900,
      difference: 100,
      isBalanced: false,
    });
    renderPage();
    expect(await screen.findByText(/يوجد فارق عدم توازن قدره:/)).toBeTruthy();
    expect(await screen.findByText(/100\.00/)).toBeTruthy();
  });

  it('is wired as a route with a navigation entry and a link from the balance sheet', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../routes.tsx'), 'utf8');
    expect(routes).toContain("path: 'accounting/trial-balance'");
    expect(routes).toContain("key: 'accounting-trial-balance'");
    expect(routes).toContain("to: '/accounting/trial-balance'");
    const balanceSheet = fs.readFileSync(path.resolve(__dirname, './BalanceSheetPage.tsx'), 'utf8');
    expect(balanceSheet).toContain("navigate('/accounting/trial-balance')");
  });
});
