import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PosCartItemsList } from './PosCartItemsList';
import type { PosItem } from '@/features/pos/types/pos.types';

const mockSettings: { data: any } = {
  data: {},
};

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => mockSettings,
}));

const cart: PosItem[] = [
  { lineKey: 'line-1', productId: 'p1', name: 'قميص', qty: 1, price: 100, costPrice: 80, unitId: 'u1', unitName: 'قطعة', unitMultiplier: 1, stockLimit: 10, currentStock: 10, minStock: 1, priceType: 'retail' },
  { lineKey: 'line-2', productId: 'p2', name: 'حذاء', qty: 2, price: 150, costPrice: 120, unitId: 'u1', unitName: 'قطعة', unitMultiplier: 1, stockLimit: 10, currentStock: 10, minStock: 1, priceType: 'retail' },
];

describe('PosCartItemsList', () => {
  it('marks cart rows with alternating visual classes', () => {
    render(
      <PosCartItemsList
        cart={cart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    const rows = screen.getAllByText(/قميص|حذاء/).map((entry) => entry.closest('.pos-cart-grid-row'));
    expect(rows[0]).toHaveClass('pos-cart-row-odd');
    expect(rows[1]).toHaveClass('pos-cart-row-even');
  });

  it('hides per-item notes button in retail / perfumes mode', () => {
    mockSettings.data = {
      businessIndustry: 'perfumes',
      clothingModuleEnabled: true,
      restaurantModuleEnabled: false,
    };

    render(
      <PosCartItemsList
        cart={cart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    expect(screen.queryByTitle(/إضافة ملاحظة على الصنف/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/إضافة ملاحظة وتجهيز للمطبخ/)).not.toBeInTheDocument();
  });

  it('shows per-item notes button when restaurantModuleEnabled is true', () => {
    mockSettings.data = {
      restaurantModuleEnabled: true,
    };

    render(
      <PosCartItemsList
        cart={cart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    const noteButtons = screen.getAllByTitle(/إضافة ملاحظة وتجهيز للمطبخ/);
    expect(noteButtons.length).toBe(cart.length);
  });

  /* INV-POS-LINE-DISCOUNT + INV-POS-LINE-DISCOUNT-AMOUNT (2026-11-27):
   * the row shows the net total for a discounted line (24 - 12 = 12)
   * and the per-line discount input takes an AMOUNT — the stored
   * lineDiscount, shown as-is. Typing 25 on a 24.00 line reports
   * 25.00 (the handler clamps it to the 24.00 gross); the input
   * never converts to or from a percent. Without the handler the
   * input is not rendered at all. */
  it('shows the net line total and reports the per-line discount input', () => {
    const onLineDiscountChange = vi.fn();
    const discountedCart: PosItem[] = [
      { ...cart[0], price: 24, lineDiscount: 12 },
    ];
    render(
      <PosCartItemsList
        cart={discountedCart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onLineDiscountChange={onLineDiscountChange}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    const discountInput = screen.getByLabelText(/خصم الصنف/) as HTMLInputElement;
    expect(discountInput.value).toBe('12');
    // Typing 25 reports the typed AMOUNT 25.00 — a percent input
    // would have reported 25% of the 24.00 line as 6.00.
    fireEvent.change(discountInput, { target: { value: '25' } });
    expect(onLineDiscountChange).toHaveBeenCalledWith('line-1', 25);
  });

  it('does not render the per-line discount input without the handler', () => {
    render(
      <PosCartItemsList
        cart={cart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/خصم الصنف/)).not.toBeInTheDocument();
  });
  it('renders subtle add discount button for undiscounted row and opens micro input on click', () => {
    const onLineDiscountChange = vi.fn();
    render(
      <PosCartItemsList
        cart={cart}
        lastAddedLineKey=""
        selectedLineKey=""
        canApplyDiscount
        onQtyChange={vi.fn()}
        onLineDiscountChange={onLineDiscountChange}
        onRemoveItem={vi.fn()}
        onSelectLine={vi.fn()}
        onItemNoteChange={vi.fn()}
      />,
    );

    // Initial state: input is not shown, "+ خصم" button is shown
    expect(screen.queryByLabelText(/خصم الصنف/)).not.toBeInTheDocument();
    const addButtons = screen.getAllByRole('button', { name: /خصم/ });
    expect(addButtons.length).toBeGreaterThan(0);

    // Clicking "+ خصم" reveals the micro input
    fireEvent.click(addButtons[0]);
    const input = screen.getByLabelText(/خصم الصنف/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.classList.contains('no-spin-arrows')).toBe(true);

    // Changing value calls the handler with the typed AMOUNT: 25 on
    // the 100.00 first line is 25.00.
    fireEvent.change(input, { target: { value: '25' } });
    expect(onLineDiscountChange).toHaveBeenCalledWith(cart[0].lineKey, 25);

    // The second row proves the value is an amount, not a percent:
    // 25 on the 300.00 second line is 25.00, not 25% (75.00). Blur the
    // first input first — the panel closes an undiscounted row's
    // input on blur, and the second row only opens once the first is
    // closed.
    fireEvent.blur(input);
    const reopenedAddButtons = screen.getAllByRole('button', { name: /خصم/ });
    fireEvent.click(reopenedAddButtons[1]);
    const secondInput = screen.getByLabelText(/خصم الصنف/) as HTMLInputElement;
    fireEvent.change(secondInput, { target: { value: '25' } });
    expect(onLineDiscountChange).toHaveBeenCalledWith(cart[1].lineKey, 25);

    const qtyInputs = screen.getAllByLabelText(/الكمية/) as HTMLInputElement[];
    expect(qtyInputs[0].classList.contains('no-spin-arrows')).toBe(true);
  });
});