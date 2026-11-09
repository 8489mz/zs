/* R4-C I52 (INV-REST-MODIFIER-CONTRACT-2): the combo modal must emit
 * real catalog products as modifiers — real productId, real retail
 * price, qty 1 — never the hardcoded side/drink names with invented
 * EGP deltas. At base the sides/drinks are hardcoded arrays
 * (fries +12, onion rings +15, ...) and handleConfirmCombo emits
 * modifiers carrying only {name, price}, so every assertion below
 * fails there; the backend then costs those mods at 0 with no stock
 * movement. State must also fully reset on open (at base the selected
 * main/side/drink persist across opens and the main is preselected
 * during render). */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PosComboMealModal } from './PosComboMealModal';

const PRODUCTS = [
  { id: 1, name: 'Burger', price: 60, retail_price: 60, stock: 10 },
  { id: 2, name: 'Fries', price: 25, retail_price: 25, stock: 10 },
  { id: 3, name: 'Cola', price: 15, retail_price: 15, stock: 10 },
];

function renderModal(props: Partial<Parameters<typeof PosComboMealModal>[0]> = {}) {
  const onAddComboToCart = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter>
      <PosComboMealModal
        open
        onClose={onClose}
        products={PRODUCTS}
        onAddComboToCart={onAddComboToCart}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onAddComboToCart, onClose };
}

describe('PosComboMealModal — real catalog products (I52)', () => {
  it('emits combo sides/drinks as real products with real prices', () => {
    const { onAddComboToCart } = renderModal();
    // Step 1: pick the main. (The step indicator also names the
    // preselected main, so the product card is the last match.)
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    // Step 2: pick a real side product (not a hardcoded delta).
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    // Step 3: pick a real drink product.
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
    // Confirm: combo price is the sum of the components.
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    const combo = onAddComboToCart.mock.calls[0][0];
    expect(combo.productId).toBe(1);
    expect(combo.price).toBe(60);
    expect(combo.modifiers).toEqual([
      { productId: 2, name: 'طبق جانبي: Fries', price: 25, qty: 1, isComboComponent: true },
      { productId: 3, name: 'مشروب: Cola', price: 15, qty: 1, isComboComponent: true },
    ]);
  }, 30000);

  it('shows no hardcoded side/drink with invented deltas', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    expect(screen.queryByText('بطاطس مقلية بالجبنة الشيدر')).toBeNull();
    expect(screen.queryByText('حلقات بصل مقرمشة (6 قطع)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    expect(screen.queryByText('عصير برتقال فريش طبيعي')).toBeNull();
    expect(screen.queryByText('شاي مثلج بالخوخ (آيس تي)')).toBeNull();
  });

  it('resets main/side/drink state when reopened', () => {
    const { rerender, onAddComboToCart } = renderModal();
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    // Close, then reopen: nothing from the previous build survives.
    rerender(
      <MemoryRouter>
        <PosComboMealModal
          open={false}
          onClose={vi.fn()}
          products={PRODUCTS}
          onAddComboToCart={onAddComboToCart}
        />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <PosComboMealModal
          open
          onClose={vi.fn()}
          products={PRODUCTS}
          onAddComboToCart={onAddComboToCart}
        />
      </MemoryRouter>,
    );
    // The summary must not still name the previously picked side.
    expect(screen.queryByText(/Fries \+|\+ Fries/)).toBeNull();
    // Confirming now emits a fresh build: the main is preselected on
    // open, but the old side/drink are gone.
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));
    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    expect(onAddComboToCart.mock.calls[0][0].modifiers).toEqual([]);
  }, 30000);
});
