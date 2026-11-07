/* Edit-dialog balance label (INV-EDIT-DIALOG-BALANCE-LABEL): the edit
 * card's disabled "opening balance" input shows the stored
 * customers.balance column, while the hint underneath promises the
 * current book balance. The ledger-derived balance (GET
 * /api/reports/customer-balances) is rendered as a separate read-only
 * line: a customer whose stored balance is 0 but whose ledger balance
 * is 1250 must show 1,250.00 on that line, while the opening-balance
 * input still shows 0 and stays disabled. A failed balances fetch must
 * name the actual problem instead of a generic error, and while the
 * fetch is pending no (wrong) value may be shown.
 */
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CustomerEditorCard } from './CustomerEditorCard';
import { createTestQueryClient } from '@/test/test-query-client';
import type { Customer } from '@/types/domain';

const { mockBalances } = vi.hoisted(() => ({
  mockBalances: vi.fn(),
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: {} }),
}));

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/shared/api/customers.api', () => ({
  customersApi: { balances: mockBalances },
}));

const storedZeroCustomer: Customer = {
  id: '7',
  name: 'محل الاختبار',
  phone: '01000000000',
  address: 'شارع الاختبار',
  balance: 0,
  type: 'cash',
  creditLimit: 0,
  storeCreditBalance: 0,
};

function renderCard(customer: Customer = storedZeroCustomer) {
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CustomerEditorCard customer={customer} />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe('CustomerEditorCard ledger current balance', () => {
  it('shows the ledger-derived balance on its own line while the opening-balance input keeps the stored column value and stays disabled', async () => {
    mockBalances.mockResolvedValue([{ ...storedZeroCustomer, balance: 1250 }]);

    const { container } = renderCard();

    await screen.findByText(/1,250\.00/);
    const ledgerLine = screen.getByTestId('ledger-current-balance');
    expect(ledgerLine.textContent).toContain('1,250.00');
    expect(ledgerLine.textContent).toContain('الرصيد الدفتري الحالي');

    const openingInput = container.querySelector('input[type="number"][disabled]') as HTMLInputElement | null;
    expect(openingInput).not.toBeNull();
    expect(openingInput).toBeDisabled();
    expect(openingInput!.value).toBe('0');
  });

  it('shows a specific load-error naming the ledger balance when the balances fetch fails', async () => {
    mockBalances.mockRejectedValue(new Error('network down'));

    renderCard();

    expect(
      await screen.findByText(/تعذّر تحميل الرصيد الدفتري الحالي من كشف الحساب/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-current-balance')).not.toBeNull();
  });

  it('shows a neutral loading state, not a wrong value, while the balances fetch is pending', () => {
    mockBalances.mockImplementation(() => new Promise(() => {}));

    renderCard();

    expect(screen.getByText(/جارٍ تحميل الرصيد الدفتري الحالي/)).toBeInTheDocument();
    expect(screen.queryByText(/1,250\.00/)).not.toBeInTheDocument();
  });
});
