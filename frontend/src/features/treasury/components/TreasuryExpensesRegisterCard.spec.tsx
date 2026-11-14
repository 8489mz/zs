/*
 * INV-EXPENSE-CANCEL-REVERSAL: the expenses register must offer a
 * cancel action on every posted expense and must show a cancelled
 * expense as ملغي instead of offering to cancel it again. Before
 * this fix the register had no actions column at all, so a created
 * expense (trial G04) could not be cancelled from anywhere in the
 * UI. This spec pins the register half; the backend cancel (reversing
 * journal + drawer restore + idempotency) is pinned by
 * backend/test/critical/treasury-expense-idempotency.spec.ts.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreasuryExpensesRegisterCard } from './TreasuryExpensesRegisterCard';
import type { ExpenseRecord } from '@/types/domain';

const activeExpense: ExpenseRecord = {
  id: '7',
  title: 'Trial G04 supplies',
  amount: 100,
  date: '2026-11-13T10:00:00.000Z',
  note: 'trial',
  createdBy: 'cashier',
};

const cancelledExpense: ExpenseRecord = {
  id: '6',
  title: 'Old supplies',
  amount: 50,
  date: '2026-11-12T10:00:00.000Z',
  note: '',
  createdBy: 'cashier',
  cancelledAt: '2026-11-13T11:00:00.000Z',
  cancelledBy: 'admin',
  cancelReason: 'duplicate',
};

function renderCard(onCancelExpense = vi.fn()) {
  return render(
    <TreasuryExpensesRegisterCard
      expenseSearch=""
      onExpenseSearchChange={() => {}}
      onReset={() => {}}
      expensesQuery={{ isLoading: false, isError: false }}
      expenses={[activeExpense, cancelledExpense]}
      expenseSummary={{ totalItems: 2 }}
      expensePagination={{ page: 1, totalPages: 1, pageSize: 20, totalItems: 2, rangeStart: 1, rangeEnd: 2 }}
      expensePageSize={20}
      setExpensePage={() => {}}
      setExpensePageSize={() => {}}
      onOpenCreate={() => {}}
      onCancelExpense={onCancelExpense}
    />,
  );
}

describe('TreasuryExpensesRegisterCard expense cancel', () => {
  it('shows a cancel button only on the active expense and a ملغي badge on the cancelled one', () => {
    renderCard();
    expect(screen.getByText('ملغي')).toBeInTheDocument();
    expect(screen.getByText('مسجل')).toBeInTheDocument();
    const cancelButtons = screen.getAllByRole('button', { name: 'إلغاء' });
    expect(cancelButtons).toHaveLength(1);
  });

  it('calls onCancelExpense with the active row when its cancel button is clicked', () => {
    const onCancelExpense = vi.fn();
    renderCard(onCancelExpense);
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onCancelExpense).toHaveBeenCalledTimes(1);
    expect(onCancelExpense).toHaveBeenCalledWith(expect.objectContaining({ id: '7' }));
  });

  it('offers no cancel button when no cancel handler is provided', () => {
    render(
      <TreasuryExpensesRegisterCard
        expenseSearch=""
        onExpenseSearchChange={() => {}}
        onReset={() => {}}
        expensesQuery={{ isLoading: false, isError: false }}
        expenses={[activeExpense]}
        expenseSummary={{ totalItems: 1 }}
        expensePagination={{ page: 1, totalPages: 1, pageSize: 20, totalItems: 1, rangeStart: 1, rangeEnd: 1 }}
        expensePageSize={20}
        setExpensePage={() => {}}
        setExpensePageSize={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'إلغاء' })).not.toBeInTheDocument();
  });
});
