/* T10-D (INV-REST-RETURN-RELIEF-TRUTH): the return dialog must show
 * the refund the backend actually pays — goods + tip relief +
 * courier relief — as separate lines, read from the backend preview,
 * never a second local copy of the relief ratio. On the base the
 * modal has no reliefPreview prop and renders no relief line, so
 * these cases fail there and pass after the fix. */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsCreateModal } from './ReturnsCreateModal';
import { createEmptyReturnForm } from '@/features/returns/lib/returns-workspace.helpers';
import { isSelectedReturnQuantityValid, toggleReturnLineSelection } from '@/features/returns/lib/return-remaining-quantity';
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

/* INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: when the backend preview
 * says the header discount can forfeit, the modal shows TWO refund
 * mode buttons side by side — "إرجاع بالسعر الأصلي" (the recorded
 * pro-rata amount) and "إرجاع بإلغاء الخصم" (the forfeit amount) —
 * each with its own computed amount before the merchant presses it,
 * plus the breakdown and the optional goodwill input — all numbers
 * read from the preview, never computed locally. */
describe('ReturnsCreateModal conditional header-discount forfeit', () => {
  const forfeitPreview = {
    goodsTotal: 500, originalGoodsTotal: 533.33, tipRelief: 0, courierRelief: 0, totalRelief: 0, refundTotal: 500,
    forfeit: {
      applies: true, invoiceTotal: 800, priorGoodsRefunded: 0, remainingNetAtOriginal: 300,
      computedGoodsRefund: 500, forfeitedHeaderDiscount: 100, repricedReturnedTotal: 500,
      goodwillCap: 600, goodwillAmount: 0,
    },
  };

  it('shows both refund mode buttons with their amounts and the forfeit breakdown', () => {
    renderModal({ expectedReturnValue: 500, reliefPreview: forfeitPreview });

    expect(screen.getByRole('button', { name: /إرجاع بالسعر الأصلي/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /إرجاع بإلغاء الخصم/ })).toBeInTheDocument();
    expect(screen.getByText(/القطعة ترجع بسعرها اللي في الفاتورة/)).toBeInTheDocument();
    expect(screen.getByText(/خصم الفاتورة يتلغي والقطع اللي فضلت/)).toBeInTheDocument();
    expect(screen.getAllByText('533.33').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/الباقي مع العميل بالسعر الأصلي/)).toBeInTheDocument();
    expect(screen.getByText(/خصم الفاتورة الملغي/)).toBeInTheDocument();
    expect(screen.getByText(/المبلغ المسترد المحسوب/)).toBeInTheDocument();
    expect(screen.getByText(/أعلى مبلغ يمكن منحه/)).toBeInTheDocument();
    expect(screen.getAllByText('300.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('600.00').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('533.33')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });

  it('calls back with the forfeit mode when the merchant presses its button', () => {
    const onDiscountModeChange = vi.fn();
    renderModal({ expectedReturnValue: 500, reliefPreview: forfeitPreview, onDiscountModeChange });

    screen.getByRole('button', { name: /إرجاع بإلغاء الخصم/ }).click();
    expect(onDiscountModeChange).toHaveBeenCalledTimes(1);
    expect(onDiscountModeChange).toHaveBeenCalledWith('forfeit');
  });

  it('shows the manager-PIN note for a cashier raising the refund above the computed amount in forfeit mode', () => {
    renderModal({
      expectedReturnValue: 550,
      reliefPreview: { ...forfeitPreview, refundTotal: 550, goodsTotal: 550, forfeit: { ...forfeitPreview.forfeit, goodwillAmount: 50 } },
      discountMode: 'forfeit',
      goodwillRefundAmount: '550',
      goodwillReason: 'عميلة قديمة',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
    });

    expect(screen.getByText(/تتطلب رمز المدير عند التأكيد/)).toBeInTheDocument();
    expect(screen.queryByText(/تنبيه: المبلغ أعلى من المحسوب/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });

  it('shows the warning-only note for an admin raising the refund above the computed amount in forfeit mode', () => {
    renderModal({
      expectedReturnValue: 550,
      reliefPreview: { ...forfeitPreview, refundTotal: 550, goodsTotal: 550, forfeit: { ...forfeitPreview.forfeit, goodwillAmount: 50 } },
      discountMode: 'forfeit',
      goodwillRefundAmount: '550',
      goodwillReason: 'عميلة قديمة',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
      isAdminRole: true,
    });

    expect(screen.getByText(/تنبيه: المبلغ أعلى من المحسوب/)).toBeInTheDocument();
    expect(screen.queryByText(/تتطلب رمز المدير عند التأكيد/)).not.toBeInTheDocument();
  });

  it('blocks confirm while a goodwill extra has no reason', () => {
    renderModal({
      expectedReturnValue: 550,
      reliefPreview: { ...forfeitPreview, refundTotal: 550, goodsTotal: 550, forfeit: { ...forfeitPreview.forfeit, goodwillAmount: 50 } },
      discountMode: 'forfeit',
      goodwillRefundAmount: '550',
      goodwillReason: '',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
    });

    expect(screen.getByText(/اكتب سبب التسوية الودية قبل التأكيد/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).toBeDisabled();
  });

  it('measures the goodwill extra against the original mode amount when that mode is chosen', () => {
    renderModal({
      expectedReturnValue: 550,
      reliefPreview: { ...forfeitPreview, refundTotal: 550, goodsTotal: 550, forfeit: { ...forfeitPreview.forfeit, goodwillAmount: 16.67 } },
      discountMode: 'original',
      goodwillRefundAmount: '550',
      goodwillReason: 'عميلة قديمة',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
    });

    expect(screen.getByText(/تتطلب رمز المدير عند التأكيد/)).toBeInTheDocument();
    expect(screen.getByText(/16.67/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });

  it('shows no forfeit panel when the preview carries no forfeit', () => {
    renderModal({
      reliefPreview: { goodsTotal: 75, tipRelief: 10, courierRelief: 0, totalRelief: 10, refundTotal: 85 },
    });

    expect(screen.queryByText(/خصم الفاتورة مشروط بكمية الصفقة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/إرجاع بالسعر الأصلي/)).not.toBeInTheDocument();
    expect(screen.queryByText(/إرجاع بإلغاء الخصم/)).not.toBeInTheDocument();
    expect(screen.queryByText(/المبلغ المسترد المطلوب/)).not.toBeInTheDocument();
  });
});

/* INV-RETURN-CREATE-MODAL-STABLE-HEIGHT: the create-return dialog
 * must open and REMAIN at one fixed height — switching refund mode
 * or selecting an item must never resize the popup. jsdom has no
 * real layout, so this pins the STYLE CONTRACT: the dialog shell
 * carries a fixed height + minHeight, the outer wrapper fills it
 * (height 100%), the body scrolls internally (overflowY auto,
 * minHeight 0 so flex:1 can shrink it and the footer stays
 * visible), and both mode buttons are border-box so the 1px/2px
 * border swap cannot change their outer size. On the base the shell
 * has no height at all, so the height assertions fail there. */
describe('ReturnsCreateModal stable dialog height (INV-RETURN-CREATE-MODAL-STABLE-HEIGHT)', () => {
  const forfeitPreview = {
    goodsTotal: 500, originalGoodsTotal: 533.33, tipRelief: 0, courierRelief: 0, totalRelief: 0, refundTotal: 500,
    forfeit: {
      applies: true, invoiceTotal: 800, priorGoodsRefunded: 0, remainingNetAtOriginal: 300,
      computedGoodsRefund: 500, forfeitedHeaderDiscount: 100, repricedReturnedTotal: 500,
      goodwillCap: 600, goodwillAmount: 0,
    },
  };

  const dialogHeightOf = () => {
    const dialog = screen.getByRole('dialog');
    // NOTE: height is 88vh + maxHeight 860px (used height identical
    // to min(860px, 88vh)); jsdom drops min() on `height` while
    // accepting it on minHeight, so the min() form is unassertable
    // here even though real browsers accept it.
    expect(dialog).toHaveStyle({ height: '88vh', maxHeight: '860px', minHeight: 'min(860px, 88vh)' });
    return dialog.style.height;
  };

  it('keeps the same fixed dialog height when toggling the refund mode, even as the goodwill alert mounts', () => {
    // Goodwill 520 sits between the two computed amounts: below the
    // original-mode 533.33 (no alert) and above the forfeit-mode
    // 500.00 (alert + reason field mount).
    const { unmount } = renderModal({
      expectedReturnValue: 500,
      reliefPreview: forfeitPreview,
      discountMode: 'original',
      goodwillRefundAmount: '520',
      goodwillReason: '',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
    });
    expect(screen.queryByText(/تتطلب رمز المدير عند التأكيد/)).not.toBeInTheDocument();
    expect(screen.queryByText(/اكتب سبب التسوية الودية قبل التأكيد/)).not.toBeInTheDocument();
    const heightOriginal = dialogHeightOf();
    expect(screen.getAllByText('533.33').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500.00').length).toBeGreaterThan(0);
    unmount();

    renderModal({
      expectedReturnValue: 500,
      reliefPreview: forfeitPreview,
      discountMode: 'forfeit',
      goodwillRefundAmount: '520',
      goodwillReason: '',
      onGoodwillRefundAmountChange: vi.fn(),
      onGoodwillReasonChange: vi.fn(),
    });
    expect(screen.getByText(/تتطلب رمز المدير عند التأكيد/)).toBeInTheDocument();
    expect(screen.getByText(/اكتب سبب التسوية الودية قبل التأكيد/)).toBeInTheDocument();
    const heightForfeit = dialogHeightOf();
    expect(heightForfeit).toBe(heightOriginal);
    // Mode amounts and hero total are byte-identical across the toggle.
    expect(screen.getAllByText('533.33').length).toBeGreaterThan(0);
    expect(screen.getAllByText('500.00').length).toBeGreaterThan(0);
  });

  it('keeps the same fixed dialog height before and after selecting an item', () => {
    const { unmount } = renderModal({
      selectedItems: {},
      selectedSerials: {},
      selectedItemsCount: 0,
      selectedQtyTotal: 0,
      expectedReturnValue: 0,
    });
    const heightEmpty = dialogHeightOf();
    unmount();

    renderModal();
    const heightSelected = dialogHeightOf();
    expect(heightSelected).toBe(heightEmpty);
  });

  it('fills the fixed shell and scrolls content internally instead of resizing the shell', () => {
    renderModal({ expectedReturnValue: 500, reliefPreview: forfeitPreview });

    const dialog = screen.getByRole('dialog');
    const wrapper = dialog.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({ height: '100%' });

    const body = screen.getByTestId('returns-create-modal-body');
    expect(body).toHaveStyle({ overflowY: 'auto' });
    expect(Number.parseFloat(body.style.minHeight)).toBe(0);
  });

  it('keeps both refund-mode buttons border-box so the 1px/2px border swap cannot resize them', () => {
    renderModal({ expectedReturnValue: 500, reliefPreview: forfeitPreview });

    expect(screen.getByRole('button', { name: /إرجاع بالسعر الأصلي/ })).toHaveStyle({ boxSizing: 'border-box' });
    expect(screen.getByRole('button', { name: /إرجاع بإلغاء الخصم/ })).toHaveStyle({ boxSizing: 'border-box' });
  });
});

/* SPICE-PKG3 (a) — weighed returns through the real modal: the
 * harness wires the modal's callbacks exactly the way
 * ReturnsWorkspace does (toggle through toggleReturnLineSelection
 * with the line's remaining qty; setQty stores the typed value),
 * so the decision under test — the stamped qty and the
 * key-presence selection — is the production code, not a copy.
 * W07: a 0.750 kg sale line, return 0.250 kg. On the base the
 * checkbox stamps '1' (invalid: 1 > 0.750) and clearing the qty
 * un-checks the line and disables the input, so all three cases
 * fail there. */
describe('ReturnsCreateModal weighed returns (SPICE-PKG3)', () => {
  const REMAINING = 0.75;

  function weighedItem(): SaleItem {
    return {
      id: '10',
      productId: '10',
      name: 'جبنة بيضاء',
      qty: 0.75,
      price: 400.40,
      total: 300.30,
      unitName: 'كجم',
      unitMultiplier: 1,
      cost: 0,
      priceType: 'retail',
    };
  }

  function weighedSale(): Sale {
    return {
      id: '1',
      docNo: 'S-1',
      total: 300.30,
      customerName: 'Cash customer',
      items: [weighedItem()],
    } as unknown as Sale;
  }

  function renderWeighedModal() {
    function Harness() {
      const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
      const form = { ...createEmptyReturnForm('sale'), invoiceId: '1' };
      const entries = Object.entries(selectedItems)
        .map(([id, value]) => ({ id, qty: Number(value || 0) }))
        .filter((entry) => entry.qty > 0);
      const valid = entries.length > 0 && entries.every((entry) =>
        isSelectedReturnQuantityValid('10', '10', REMAINING, entry.qty, {}, [], true));
      return (
        <ReturnsCreateModal
          isOpen
          onClose={noop}
          form={form}
          invoiceRows={[weighedSale()]}
          selectedInvoice={weighedSale()}
          invoiceItems={[weighedItem()]}
          selectedItems={selectedItems}
          selectedSerials={{}}
          selectedItemsCount={entries.length}
          selectedQtyTotal={entries.reduce((sum, entry) => sum + entry.qty, 0)}
          expectedReturnValue={entries.reduce((sum, entry) => sum + entry.qty * 400.40, 0)}
          canUseCreditSettlement={false}
          settlementNeedsRefundMethod
          isBusy={false}
          isError={false}
          isSuccess={false}
          error={null}
          onFormChange={noop}
          onResetForm={noop}
          onToggleItem={(itemId, checked) =>
            setSelectedItems((current) => toggleReturnLineSelection(current, itemId, checked, REMAINING))}
          onSetItemQty={(itemId, value) =>
            setSelectedItems((current) => ({ ...current, [itemId]: value }))}
          onSetSerials={noop}
          onOpenConfirm={vi.fn()}
          returnedQtyByLine={{}}
          blockedProductIds={[]}
          returnHistoryReady
          returnQuantitiesValid={valid}
        />
      );
    }
    const utils = render(<Harness />);
    // DialogShell portals its content to document.body, outside the
    // render container — query the qty input from the document.
    const qtyInput = () => document.querySelector('input[type="number"]') as HTMLInputElement;
    return { ...utils, qtyInput };
  }

  it('checks a weighed line at its remaining 0.750 kg — never the hardcoded 1', () => {
    const { qtyInput } = renderWeighedModal();

    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput().value).toBe('0.75');
    expect(qtyInput()).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });

  it('keeps the line selected and the input enabled while the qty is cleared mid-correction', () => {
    const { qtyInput } = renderWeighedModal();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(qtyInput().value).toBe('0.75');
    fireEvent.change(qtyInput(), { target: { value: '' } });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput()).not.toBeDisabled();
    expect(qtyInput().value).toBe('');
  });

  it('accepts the partial weighed return 0.250 kg of the 0.750 kg line (W07)', () => {
    const { qtyInput } = renderWeighedModal();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(qtyInput(), { target: { value: '0.25' } });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput()).not.toBeDisabled();
    expect(qtyInput().value).toBe('0.25');
    // 0.25 kg x 400.40 = 100.10 — shown in the line total, the hero
    // refund total and the footer pill alike.
    expect(screen.getAllByText('100.10').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'تسجيل وتأكيد مرتجع البيع' })).not.toBeDisabled();
  });
});
