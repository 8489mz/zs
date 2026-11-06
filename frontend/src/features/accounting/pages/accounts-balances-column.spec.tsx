/* Accounts balances column (INV-ACCOUNTS-BALANCES-COLUMN): the accounts
 * page shows a "balance" column from posted journal lines only,
 * oriented by normal balance (0 when an account has no lines), and the
 * manual journal entry dialog invalidates the accounts query after
 * posting so the column refreshes without a manual reload.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AccountingAccountsPage } from './AccountingAccountsPage';

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/accounting/accounts' }),
}));

const mockAccounts = [
  {
    id: '1', code: '1140', nameAr: 'المخزون', nameEn: '', accountType: 'asset',
    accountGroup: 'current_assets', parentId: '', depth: 0, normalBalance: 'debit',
    balance: 60, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: true, isTax: false },
    sortOrder: 0,
  },
  {
    id: '2', code: '2140', nameAr: 'الدائنون', nameEn: '', accountType: 'liability',
    accountGroup: 'current_liabilities', parentId: '', depth: 0, normalBalance: 'credit',
    balance: 150, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: true, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '5', code: '1010', nameAr: 'الصندوق', nameEn: '', accountType: 'asset',
    accountGroup: 'current_assets', parentId: '', depth: 0, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
];

vi.mock('@/features/accounting/api/accounting.api', () => ({
  accountingApi: {
    accounts: vi.fn(() => Promise.resolve({ accounts: mockAccounts })),
    deleteAccount: vi.fn(),
  },
}));

describe('Accounts balances column', () => {
  it('shows a balance column with posted-lines balances (0 for no lines)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountingAccountsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('الرصيد')).toBeTruthy();
    expect(await screen.findByText('60.00')).toBeTruthy();
    expect(await screen.findByText('150.00')).toBeTruthy();
    expect(await screen.findByText('0.00')).toBeTruthy();
  });

  it('the journal entry dialog invalidates the accounts query after posting', () => {
    const dialog = fs.readFileSync(
      path.resolve(__dirname, '../components/ManualJournalEntryDialog.tsx'),
      'utf8',
    );
    expect(dialog).toContain("invalidateQueries({ queryKey: ['accounting', 'accounts'] })");
  });
});
