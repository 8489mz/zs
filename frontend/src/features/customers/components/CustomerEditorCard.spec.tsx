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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CustomerEditorCard } from './CustomerEditorCard';
import { customerFormSchema } from '@/features/customers/schemas/customer.schema';
import { createTestQueryClient } from '@/test/test-query-client';
import type { Customer } from '@/types/domain';

const { mockBalances, mockMutate } = vi.hoisted(() => ({
  mockBalances: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock('@/features/customers/hooks/useCustomerActions', () => ({
  useUpdateCustomerMutation: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  }),
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

/* F14 (van trial problem 16): C-1057 was over-collected to a stored
 * balance of -50.00 (problem 2's residue, fixed at source by F2), and
 * the edit dialog could not save the customer at all: the disabled
 * opening-balance input is prefilled with the stored balance, but the
 * shared form schema requires balance >= 0, so the red validation
 * error sat under a field the user cannot change and handleSubmit
 * never fired. The disabled field round-trips the stored value — the
 * backend update refuses any CHANGED balance
 * (CUSTOMER_BALANCE_EDIT_FORBIDDEN) and carries no Min(0) on it — so
 * the edit form must accept whatever the book already holds. */
describe('CustomerEditorCard negative stored balance (F14)', () => {
  const overCollectedCustomer: Customer = {
    ...storedZeroCustomer,
    id: '1057',
    name: 'عميل اختبار',
    balance: -50,
  };

  it('saves an over-collected customer: the disabled opening-balance field shows -50 and the save posts it back unchanged', async () => {
    mockBalances.mockResolvedValue([{ ...overCollectedCustomer, balance: -50 }]);
    mockMutate.mockClear();

    const { container } = renderCard(overCollectedCustomer);

    const openingInput = (await screen.findByDisplayValue('-50')) as HTMLInputElement;
    expect(openingInput).toBeDisabled();
    expect(container.querySelector('input[type="number"][disabled]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /حفظ تعديلات المحل/ }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ balance: -50 }));
  });

  it('still refuses a negative opening balance typed on the create form', () => {
    expect(
      customerFormSchema.safeParse({
        name: 'عميل اختبار',
        phone: '',
        address: '',
        balance: -50,
        type: 'cash',
        creditLimit: 0,
      }).success,
    ).toBe(false);
  });
});
