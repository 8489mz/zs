/* T10-D (INV-REST-RETURN-RELIEF-TRUTH): the register card must show
 * the actual refund (goods total + relief), with the tip/courier
 * relief as its own lines — not the stored goods-only total. On the
 * base the card renders selectedReturn.total only, so the 85 case
 * fails there and passes after the fix. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsSelectedReturnCard } from './ReturnsSelectedReturnCard';
import type { ReturnRecord } from '@/types/domain';

function record(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: '1',
    docNo: 'ZR-261110-0001',
    returnType: 'sale',
    invoiceId: '1',
    invoiceDocNo: 'S-1',
    partyName: 'Cash customer',
    productName: 'Widget',
    qty: 1,
    total: 75,
    note: '',
    date: '2026-11-10',
    settlementMode: 'refund',
    refundMethod: 'cash',
    ...overrides,
  };
}

describe('ReturnsSelectedReturnCard relief lines (T10-D)', () => {
  it('shows the 85 actual refund with the 10 tip relief as its own line', () => {
    render(
      <ReturnsSelectedReturnCard
        selectedReturn={record({ tipRelief: 10, courierRelief: 0, refundTotal: 85 })}
        onPrint={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText(/استرداد الإكرامية/)).toBeInTheDocument();
    expect(screen.queryByText(/استرداد رسوم التوصيل/)).not.toBeInTheDocument();
    expect(screen.getByText('الإجمالي المسترد:')).toBeInTheDocument();
    expect(screen.getAllByText('85.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10.00').length).toBeGreaterThan(0);
  });

  it('shows both relief lines for a return with tip and courier relief', () => {
    render(
      <ReturnsSelectedReturnCard
        selectedReturn={record({ total: 50, tipRelief: 5, courierRelief: 10, refundTotal: 65 })}
        onPrint={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText(/استرداد الإكرامية/)).toBeInTheDocument();
    expect(screen.getByText(/استرداد رسوم التوصيل/)).toBeInTheDocument();
    expect(screen.getAllByText('65.00').length).toBeGreaterThan(0);
  });

  it('falls back to the stored total when no relief was recorded', () => {
    render(
      <ReturnsSelectedReturnCard
        selectedReturn={record()}
        onPrint={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.queryByText(/استرداد الإكرامية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/استرداد رسوم التوصيل/)).not.toBeInTheDocument();
    expect(screen.getAllByText('75.00').length).toBeGreaterThan(0);
  });
});
