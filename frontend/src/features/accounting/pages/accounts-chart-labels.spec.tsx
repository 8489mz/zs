/* Accounts chart labels (INV-ACCOUNTS-CHART-LABELS): the accounts page
 * shows the liability type as 'خصوم' (never the bare 'خصم'), the root
 * groups as 'أصول' (1000) and 'خصوم' (2000), and the COGS leaf 5100 as
 * 'تكلفة البضاعة'; the 1200 subgroup still shows 'أصول ثابتة'. The
 * account form pins the liability option label 'خصوم / التزام' by a
 * source read.
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
    id: '1', code: '1000', nameAr: 'الأصول', nameEn: '', accountType: 'asset',
    accountGroup: 'assets', parentId: '', depth: 0, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '2', code: '1200', nameAr: 'الأصول الثابتة', nameEn: '', accountType: 'asset',
    accountGroup: 'fixed_assets', parentId: '1', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '3', code: '2000', nameAr: 'الخصوم', nameEn: '', accountType: 'liability',
    accountGroup: 'liabilities', parentId: '', depth: 0, normalBalance: 'credit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '4', code: '5100', nameAr: 'تكلفة بضاعة مباعة', nameEn: '', accountType: 'expense',
    accountGroup: 'cogs', parentId: '', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
];

vi.mock('@/features/accounting/api/accounting.api', () => ({
  accountingApi: {
    accounts: vi.fn(() => Promise.resolve({ accounts: mockAccounts })),
    deleteAccount: vi.fn(),
  },
}));

describe('Accounts chart labels', () => {
  it('shows خصوم for liabilities and the root/COGS group labels', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountingAccountsPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('تكلفة البضاعة')).toBeTruthy();
    expect(await screen.findByText('أصول ثابتة')).toBeTruthy();
    expect(screen.getAllByText('خصوم').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('أصول').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('خصم')).toBeNull();
  });

  it('pins the liability option label in the account form', () => {
    const form = fs.readFileSync(
      path.resolve(__dirname, '../components/AccountingAccountForm.tsx'),
      'utf8',
    );
    expect(form).toContain('خصوم / التزام (Liabilities)');
    expect(form).not.toContain('خصم / التزام (Liabilities)');
  });
});
