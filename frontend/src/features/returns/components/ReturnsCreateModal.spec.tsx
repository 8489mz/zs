/* T10-D (INV-REST-RETURN-RELIEF-TRUTH): the return dialog must show
 * the refund the backend actually pays — goods + tip relief +
 * courier relief — as separate lines, read from the backend preview,
 * never a second local copy of the relief ratio. On the base the
 * modal has no reliefPreview prop and renders no relief line, so
 * these cases fail there and pass after the fix. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsCreateModal } from './ReturnsCreateModal';
import { createEmptyReturnForm } from '@/features/returns/lib/returns-workspace.helpers';
import type { Sale, SaleItem } from '@/types/domain';

const noop = () => undefined;

function saleItem(): SaleItem {
  return {
    id: '10',
    productId: '10',
    name: 'Widget',
    qty: 1,
    price: 75,
    total: 75,
    unitName: 'piece',
    unitMultiplier: 1,
    cost: 0,
    priceType: 'retail',
  };
}

function sale(): Sale {
  return {
    id: '1',
    docNo: 'S-1',
    total: 85,
    customerName: 'Cash customer',
    items: [saleItem()],
  } as unknown as Sale;
}

function renderModal(overrides: Record<string, unknown> = {}) {
  const form = { ...createEmptyReturnForm('sale'), invoiceId: '1' };
  return render(
    <ReturnsCreateModal
      isOpen
      onClose={noop}
      form={form}
      invoiceRows={[sale()]}
      selectedInvoice={sale()}
      invoiceItems={[saleItem()]}
      selectedItems={{ '10': '1' }}
      selectedSerials={{}}
      selectedItemsCount={1}
      selectedQtyTotal={1}
      expectedReturnValue={85}
      canUseCreditSettlement={false}
      settlementNeedsRefundMethod
      isBusy={false}
      isError={false}
      isSuccess={false}
      error={null}
      onFormChange={noop}
      onResetForm={noop}
      onToggleItem={noop}
      onSetItemQty={noop}
      onSetSerials={noop}
      onOpenConfirm={vi.fn()}
      returnedQtyByLine={{}}
      blockedProductIds={[]}
      returnHistoryReady
      returnQuantitiesValid
      {...(overrides as object)}
    />,
  );
}

describe('ReturnsCreateModal relief lines (T10-D)', () => {
  it('shows goods, tip relief and the 85 refund total for a full tipped return', () => {
    renderModal({
      reliefPreview: { goodsTotal: 75, tipRelief: 10, courierRelief: 0, totalRelief: 10, refundTotal: 85 },
    });

    expect(screen.getByText(/قيمة البضاعة المرتجعة/)).toBeInTheDocument();
    expect(screen.getByText(/استرداد الإكرامية/)).toBeInTheDocument();
    expect(screen.queryByText(/استرداد رسوم التوصيل/)).not.toBeInTheDocument();
    expect(screen.getAllByText('85.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10.00').length).toBeGreaterThan(0);
  });

  it('shows both relief lines for a partial return with tip and courier fee', () => {
    renderModal({
      expectedReturnValue: 65,
      reliefPreview: { goodsTotal: 50, tipRelief: 5, courierRelief: 10, totalRelief: 15, refundTotal: 65 },
    });

    expect(screen.getByText(/قيمة البضاعة المرتجعة/)).toBeInTheDocument();
    expect(screen.getByText(/استرداد الإكرامية/)).toBeInTheDocument();
    expect(screen.getByText(/استرداد رسوم التوصيل/)).toBeInTheDocument();
    expect(screen.getAllByText('65.00').length).toBeGreaterThan(0);
  });

  it('shows no relief lines when the backend preview carries no relief', () => {
    renderModal({
      expectedReturnValue: 75,
      reliefPreview: { goodsTotal: 75, tipRelief: 0, courierRelief: 0, totalRelief: 0, refundTotal: 75 },
    });

    expect(screen.queryByText(/استرداد الإكرامية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/استرداد رسوم التوصيل/)).not.toBeInTheDocument();
    expect(screen.getAllByText('75.00').length).toBeGreaterThan(0);
  });

  it('shows no relief lines at all before any preview arrives', () => {
    renderModal({ expectedReturnValue: 75 });

    expect(screen.queryByText(/قيمة البضاعة المرتجعة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/استرداد الإكرامية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/استرداد رسوم التوصيل/)).not.toBeInTheDocument();
  });

  it('disables confirm while the sale relief preview is still loading', () => {
    renderModal({ isReliefPreviewLoading: true });

    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).toBeDisabled();
  });
});

/* T11-C (INV-REST-RETURN-RELIEF-LOUD-TRUTH): a failed relief preview
 * must fail LOUD — the error is shown, the displayed amount is
 * flagged as unverified, and confirm stays blocked until the
 * preview loads or the retry succeeds. On the base the modal has no
 * preview-error prop and renders nothing, so these cases fail there
 * and pass after the fix. */
describe('ReturnsCreateModal relief preview failure (T11-C)', () => {
  it('renders the preview error and disables confirm while the preview is errored', () => {
    renderModal({
      expectedReturnValue: 75,
      isReliefPreviewError: true,
      reliefPreviewError: 'تعذر الاتصال بالخادم.',
      onRetryReliefPreview: vi.fn(),
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/تعذّر حساب مبلغ الاسترداد/);
    expect(screen.getByRole('alert')).toHaveTextContent(/تعذر الاتصال بالخادم/);
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).toBeDisabled();
  });

  it('offers a retry that calls back to the workspace preview query', () => {
    const onRetryReliefPreview = vi.fn();
    renderModal({
      expectedReturnValue: 75,
      isReliefPreviewError: true,
      onRetryReliefPreview,
    });

    screen.getByRole('button', { name: /إعادة حساب الاسترداد/ }).click();
    expect(onRetryReliefPreview).toHaveBeenCalledTimes(1);
  });

  it('shows the preview loading state instead of a silent unverified total', () => {
    renderModal({ isReliefPreviewLoading: true });

    expect(screen.getByRole('status')).toHaveTextContent(/جارٍ حساب مبلغ الاسترداد/);
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).toBeDisabled();
  });

  it('does not show the preview error when the preview succeeds', () => {
    renderModal({
      reliefPreview: { goodsTotal: 75, tipRelief: 10, courierRelief: 0, totalRelief: 10, refundTotal: 85 },
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });
});
