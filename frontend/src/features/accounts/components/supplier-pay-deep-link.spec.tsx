/* Supplier pay deep link (INV-SUPPLIER-PAY-DEEP-LINK): the suppliers
 * register card links each row to /accounts?supplierId=<id>, but the
 * landing was broken for a zero-balance supplier — the payment form's
 * options came from payableSuppliers (balance > 0 only), the form never
 * preselected the deep-linked supplier (unlike the customer form), and
 * the party card rendered its empty state instead of the form when no
 * supplier had a balance. The controller now includes the deep-linked
 * supplier in the payment options, the workspace renders the form from
 * that list, and the form preselects the deep-linked supplier.
 */
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SupplierPaymentForm } from './PaymentForms';
import { useAccountsWorkspaceController } from '../hooks/useAccountsWorkspaceController';

let mockSearchParams = new URLSearchParams('');
const mockSetSearchParams = vi.fn();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/accounts' }),
}));

const routeStateStub = {
  customersQuery: { isLoading: false, isError: false, error: null },
  suppliersQuery: { isLoading: false, isError: false, error: null },
  customerBalancesQuery: { isLoading: false, isError: false, error: null },
  supplierBalancesQuery: { isLoading: false, isError: false, error: null },
  customerLedgerQuery: { isLoading: false, isError: false, error: null },
  supplierLedgerQuery: { isLoading: false, isError: false, error: null },
  customers: [],
  suppliers: [
    { id: 1, name: 'مورد أ' },
    { id: 2, name: 'مورد ب' },
  ],
  customerBalanceOptions: [],
  supplierBalanceOptions: [
    { id: 1, balance: 100 },
    { id: 2, balance: 0 },
  ],
  customerEntries: [],
  supplierEntries: [],
  customerLedgerSummary: {},
  supplierLedgerSummary: {},
  customerLedgerPagination: {},
  supplierLedgerPagination: {},
};

vi.mock('@/features/accounts/hooks/useAccountsRouteState', () => ({
  useAccountsRouteState: vi.fn(() => routeStateStub),
}));

vi.mock('@/features/accounts/hooks/useAccountingMutations', () => ({
  useCustomerPaymentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null })),
  useSupplierPaymentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null })),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

const payableSupplier = { id: 1, name: 'مورد أ', balance: 100 } as any;
const zeroBalanceSupplier = { id: 2, name: 'مورد ب', balance: 0 } as any;

describe('Supplier pay deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams('');
  });

  it('controller: the deep-linked zero-balance supplier joins the payment options', () => {
    mockSearchParams = new URLSearchParams('supplierId=2');
    const { result } = renderHook(() => useAccountsWorkspaceController(), { wrapper });
    expect(result.current.selectedSupplier?.id).toBe(2);
    expect(result.current.payableSuppliers.map((s: any) => s.id)).toEqual([1]);
    expect(result.current.supplierPaymentSuppliers.map((s: any) => s.id).sort()).toEqual([1, 2]);
  });

  it('controller: without a deep link the payment options stay the payable list', () => {
    const { result } = renderHook(() => useAccountsWorkspaceController(), { wrapper });
    expect(result.current.supplierPaymentSuppliers.map((s: any) => s.id)).toEqual([1]);
  });

  it('form: the deep-linked supplier is preselected on mount', async () => {
    render(
      <SupplierPaymentForm suppliers={[payableSupplier, zeroBalanceSupplier]} activeSupplierId="2" />,
      { wrapper },
    );
    expect(await screen.findByDisplayValue('مورد ب')).toBeTruthy();
  });

  it('form: the deep-linked supplier is preselected when the id arrives after mount', async () => {
    const { rerender } = render(
      <SupplierPaymentForm suppliers={[payableSupplier, zeroBalanceSupplier]} activeSupplierId="" />,
      { wrapper },
    );
    expect(screen.queryByDisplayValue('مورد ب')).toBeNull();
    rerender(<SupplierPaymentForm suppliers={[payableSupplier, zeroBalanceSupplier]} activeSupplierId="2" />);
    expect(await screen.findByDisplayValue('مورد ب')).toBeTruthy();
  });

  it('workspace wiring: the supplier card renders the form from the payment options', () => {
    const workspace = fs.readFileSync(
      path.resolve(__dirname, 'AccountsWorkspace.tsx'),
      'utf8',
    );
    expect(workspace).toContain('suppliers={controller.supplierPaymentSuppliers');
    expect(workspace).toContain('isEmpty={!controller.supplierPaymentSuppliers.length}');
    const forms = fs.readFileSync(path.resolve(__dirname, 'PaymentForms.tsx'), 'utf8');
    expect(forms).toContain("form.setValue('supplierId', activeSupplierId)");
  });
});
