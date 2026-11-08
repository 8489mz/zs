/*
New file: frontend/src/features/pos/components/pos-workspace/PosCreditLimitNotice.spec.tsx

WHAT THIS PINS (INV-POS-CREDIT-LIMIT): the checkout dialog shows the
customer's credit position — limit, current balance, balance after
this sale — and a near/over warning BEFORE confirmation, whenever
this sale adds debt to a customer who has a credit limit. The
notice is warning-only: it never blocks confirmation; the backend
gate rejects an over-limit sale with the numbered Arabic message
(pinned by backend/test/critical/pos-credit-limit.spec.ts).

THE GAP, WORKED ONCE (test10k, build 1.1.40): limit 500.00,
balance 79.80, credit sale 494.20 — the dialog showed only
المطلوب/المدفوع/المتبقي, no limit, no balance, no warning; the
block appeared only at confirmation, as a generic message. The
cart panel already showed the limit/balance (without the cart),
but the confirmation screen did not.
*/

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosCreditLimitNotice, getCreditLimitPreview } from './PosCreditLimitNotice';
import { createTestQueryClient } from '@/test/test-query-client';
import { formatCurrency } from '@/lib/format';

const { customerPosSummaryMock } = vi.hoisted(() => ({
  customerPosSummaryMock: vi.fn(),
}));

vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    customerPosSummary: customerPosSummaryMock,
  },
}));

function summary(overrides: Record<string, unknown> = {}) {
  return {
    customerId: '201',
    balance: 79.8,
    creditLimit: 500,
    remainingCredit: 420.2,
    storeCreditBalance: 0,
    customerType: 'cash',
    lastSaleAt: null,
    totalSalesAmount: 0,
    invoiceCount: 0,
    averageInvoice: 0,
    returnCount: 0,
    ...overrides,
  };
}

function renderNotice(props: { customerId?: string | null; total: number; paidAmount: number }) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PosCreditLimitNotice
        customerId={props.customerId !== undefined ? props.customerId : '201'}
        total={props.total}
        paidAmount={props.paidAmount}
      />
    </QueryClientProvider>,
  );
}

describe('getCreditLimitPreview', () => {
  it('marks the worked example over, with next balance 574.00 and excess 74.00', () => {
    const preview = getCreditLimitPreview({ creditLimit: 500, balance: 79.8, amount: 494.2 }, 2);
    expect(preview.nextBalance).toBe(574);
    expect(preview.excess).toBe(74);
    expect(preview.remainingAfter).toBe(-74);
    expect(preview.state).toBe('over');
  });

  it('marks 80% usage and above near, never over, while the sale stays within the limit', () => {
    expect(getCreditLimitPreview({ creditLimit: 500, balance: 420, amount: 10 }, 2).state).toBe('near');
    expect(getCreditLimitPreview({ creditLimit: 500, balance: 79.8, amount: 420.2 }, 2).state).toBe('near');
    expect(getCreditLimitPreview({ creditLimit: 500, balance: 79.8, amount: 420.2 }, 2).excess).toBe(0);
  });

  it('marks a small within-limit sale ok', () => {
    const preview = getCreditLimitPreview({ creditLimit: 500, balance: 79.8, amount: 10 }, 2);
    expect(preview.state).toBe('ok');
    expect(preview.nextBalance).toBe(89.8);
  });
});

describe('PosCreditLimitNotice', () => {
  beforeEach(() => {
    customerPosSummaryMock.mockClear();
    customerPosSummaryMock.mockResolvedValue(summary());
  });

  it('shows the limit, the balance, the balance after the sale and the excess before confirmation', async () => {
    renderNotice({ total: 494.2, paidAmount: 0 });

    await waitFor(() => expect(screen.getByLabelText('موضع العميل الائتماني')).toBeInTheDocument());
    expect(screen.getByText(formatCurrency(500))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(79.8))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(574))).toBeInTheDocument();
    const warning = screen.getByText(/سيتجاوز هذا البيع الحد الائتماني/);
    expect(warning.textContent).toContain(formatCurrency(74));
    expect(customerPosSummaryMock).toHaveBeenCalledWith('201');
  });

  it('warns near the limit without claiming an overrun', async () => {
    customerPosSummaryMock.mockResolvedValue(summary({ balance: 420 }));
    renderNotice({ total: 10, paidAmount: 0 });

    await waitFor(() => expect(screen.getByLabelText('موضع العميل الائتماني')).toBeInTheDocument());
    expect(screen.getByText('قريب من حد الائتمان — الرصيد بعد البيع يصل إلى 86% من الحد.')).toBeInTheDocument();
    expect(screen.queryByText(/سيتجاوز هذا البيع الحد الائتماني/)).not.toBeInTheDocument();
  });

  it('shows the figures with no warning for a small within-limit sale', async () => {
    renderNotice({ total: 10, paidAmount: 0 });

    await waitFor(() => expect(screen.getByLabelText('موضع العميل الائتماني')).toBeInTheDocument());
    expect(screen.getByText(formatCurrency(89.8))).toBeInTheDocument();
    expect(screen.queryByText(/سيتجاوز هذا البيع الحد الائتماني/)).not.toBeInTheDocument();
    expect(screen.queryByText(/قريب من حد الائتمان/)).not.toBeInTheDocument();
  });

  it('shows the debt after a partial payment, not the full total', async () => {
    renderNotice({ total: 494.2, paidAmount: 400 });

    await waitFor(() => expect(screen.getByLabelText('موضع العميل الائتماني')).toBeInTheDocument());
    expect(screen.getByText(formatCurrency(174))).toBeInTheDocument();
    expect(screen.queryByText(/سيتجاوز هذا البيع الحد الائتماني/)).not.toBeInTheDocument();
  });

  it('renders nothing when the customer has no credit limit', async () => {
    customerPosSummaryMock.mockResolvedValue(summary({ creditLimit: 0 }));
    const { container } = renderNotice({ total: 494.2, paidAmount: 0 });

    await waitFor(() => expect(customerPosSummaryMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nothing is left on credit, and does not fetch a summary', () => {
    const { container } = renderNotice({ total: 494.2, paidAmount: 494.2 });

    expect(container).toBeEmptyDOMElement();
    expect(customerPosSummaryMock).not.toHaveBeenCalled();
  });

  it('renders nothing without a customer, and does not fetch a summary', () => {
    const { container } = renderNotice({ customerId: null, total: 494.2, paidAmount: 0 });

    expect(container).toBeEmptyDOMElement();
    expect(customerPosSummaryMock).not.toHaveBeenCalled();
  });
});
