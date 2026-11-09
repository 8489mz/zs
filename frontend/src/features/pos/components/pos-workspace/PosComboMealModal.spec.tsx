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
/* R8-C (INV-REST-COMBO-MODAL-CLOSE): onAddComboToCart returns boolean
 * and the modal closes ONLY on true. The cases below pin it: on false
 * the modal stays open on step 3 (onClose NOT called, step-3 content
 * still in the document); on true onClose is called exactly once with
 * the same payload the I52 test pins. At base the modal called
 * onClose() unconditionally, so the false case fails there. The
 * default mock returns true — the old vi.fn() mocks returned
 * undefined, which the fixed modal treats as failure. */
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
  const onAddComboToCart = vi.fn().mockReturnValue(true);
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
    const { onAddComboToCart, onClose } = renderModal();
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
    // R8-C: a successful add closes the modal exactly once.
    expect(onClose).toHaveBeenCalledTimes(1);
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

describe('PosComboMealModal — close only on successful add (R8-C)', () => {
  function buildCombo() {
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
  }

  it('stays open when the add fails (onAddComboToCart returns false)', () => {
    const onAddComboToCart = vi.fn().mockReturnValue(false);
    const onClose = vi.fn();
    renderModal({ onAddComboToCart, onClose });
    buildCombo();
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    // The modal must NOT close: the cashier keeps the built combo on
    // step 3 and can fix it instead of rebuilding from scratch.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/اختر المشروب المنعش/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ })).toBeInTheDocument();
  }, 30000);

  it('closes exactly once when the add succeeds (returns true)', () => {
    const { onAddComboToCart, onClose } = renderModal();
    buildCombo();
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 30000);

  it('does not call the add or close when no main is selected', () => {
    const onAddComboToCart = vi.fn().mockReturnValue(true);
    const onClose = vi.fn();
    renderModal({ products: [], onAddComboToCart, onClose });
    // Jump to step 3 via the step indicator; the confirm button is
    // disabled with no main, and the handler guard returns early.
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    const confirm = screen.getByRole('button', { name: /إضافة وجبة الكومبو/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onAddComboToCart).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  }, 30000);
});
