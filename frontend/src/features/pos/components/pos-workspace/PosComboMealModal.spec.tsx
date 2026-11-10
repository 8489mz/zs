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
/* T10-A (INV-REST-COMBO-TOTALS-TRUTH): the modal must price from the
 * shape the POS lookup actually returns — mapPosProduct carries
 * retailPrice only (catalog-product.service.ts:1273), no price and no
 * retail_price. At base the modal read p?.price || p?.retail_price,
 * so every step priced at 0.00 in production while this spec's old
 * snake_case fixture (price: 60, retail_price: 60) hid it. The
 * PRODUCTS fixture below is the real lookup shape; the cases pin the
 * step prices, the total, and the emitted payload against it. The
 * legacy snake_case shape is kept working via the reader's fallback
 * chain and pinned by the last case. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PosComboMealModal } from './PosComboMealModal';
import { formatCurrency } from '@/lib/format';

const PRODUCTS = [
  { id: 1, name: 'Burger', retailPrice: 60, stock: 10 },
  { id: 2, name: 'Fries', retailPrice: 25, stock: 10 },
  { id: 3, name: 'Cola', retailPrice: 15, stock: 10 },
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
      { productId: 2, name: 'طبق جانبي: Fries', price: 25, qty: 1, isComboComponent: true, catalogPrice: 25 },
      { productId: 3, name: 'مشروب: Cola', price: 15, qty: 1, isComboComponent: true, catalogPrice: 15 },
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

/* T11-A (INV-REST-COMBO-SUBMIT-TRUTH): the modal must never render a
 * silent 0.00 card for a product whose catalog price is non-zero — it
 * fails LOUD instead (error state naming the product, add blocked).
 * At base an unpriced product renders at 0.00 and the confirm happily
 * stamps a 0 modifier, which the server then re-prices to DB
 * retail_price and 422s SALE_TOTAL_MISMATCH. A genuinely free product
 * (an explicit 0 in a known shape, no other shape carrying a price)
 * still adds at 0 — the loud failure must not block free items. */
describe('PosComboMealModal — loud failure on an unpriced product (T11-A)', () => {
  const UNPRICED_SIDE = [
    { id: 1, name: 'Burger', retailPrice: 60, stock: 10 },
    { id: 2, name: 'Fries', stock: 10 },
    { id: 3, name: 'Cola', retailPrice: 15, stock: 10 },
  ];

  function pickUnpricedSide() {
    const utils = renderModal({ products: UNPRICED_SIDE });
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    return utils;
  }

  it('shows a loud missing-price error and blocks the add for a product with no price in any known shape', () => {
    const { onAddComboToCart } = pickUnpricedSide();

    // The error names the product — no silent 0.00 card.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('لا يوجد سعر صالح');
    expect(alert.textContent).toContain('Fries');
    expect(screen.getByText('لا يوجد سعر')).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(0))).toBeNull();

    // The add is blocked: the confirm stays disabled on step 3 and
    // nothing is emitted even if it is clicked.
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    const confirm = screen.getByRole('button', { name: /إضافة وجبة الكومبو/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onAddComboToCart).not.toHaveBeenCalled();
  }, 30000);

  it('fails loud when the reader yields 0 while another known shape carries a non-zero price', () => {
    const mixed = [
      { id: 1, name: 'Burger', retailPrice: 60, stock: 10 },
      { id: 2, name: 'Fries', retailPrice: 0, price: 75, stock: 10 },
      { id: 3, name: 'Cola', retailPrice: 15, stock: 10 },
    ];
    const { onAddComboToCart } = renderModal({ products: mixed });
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('لا يوجد سعر صالح');
    expect(alert.textContent).toContain('Fries');
    expect(screen.queryByText(formatCurrency(0))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    expect(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ })).toBeDisabled();
    expect(onAddComboToCart).not.toHaveBeenCalled();
  }, 30000);

  it('fails loud on open when the preselected main itself is unpriced', () => {
    const unpricedMain = [
      { id: 1, name: 'Burger', stock: 10 },
      { id: 2, name: 'Fries', retailPrice: 25, stock: 10 },
      { id: 3, name: 'Cola', retailPrice: 15, stock: 10 },
    ];
    renderModal({ products: unpricedMain });

    // The main is preselected on open, so the error is visible at once.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('لا يوجد سعر صالح');
    expect(alert.textContent).toContain('Burger');
    expect(screen.getByRole('button', { name: /الخطوة التالية/ })).toBeDisabled();
  }, 30000);

  it('still adds a genuinely free product (explicit 0, no other shape carrying a price)', () => {
    const freeSide = [
      { id: 1, name: 'Burger', retailPrice: 60, stock: 10 },
      { id: 2, name: 'Fries', retailPrice: 0, stock: 10 },
      { id: 3, name: 'Cola', retailPrice: 15, stock: 10 },
    ];
    const { onAddComboToCart, onClose } = renderModal({ products: freeSide });
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    expect(onAddComboToCart.mock.calls[0][0].modifiers).toEqual([
      expect.objectContaining({ productId: 2, name: 'طبق جانبي: Fries', price: 0, qty: 1, isComboComponent: true }),
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 30000);

  it('stamps prices that sum to the displayed total', () => {
    const TRIAL_PRODUCTS = [
      { id: 1, name: 'Burger', retailPrice: 99, stock: 10 },
      { id: 2, name: 'Fries', retailPrice: 75, stock: 10 },
      { id: 3, name: 'Cola', retailPrice: 25, stock: 10 },
    ];
    const { onAddComboToCart } = renderModal({ products: TRIAL_PRODUCTS });
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));

    // The displayed total the customer agreed to.
    const confirm = screen.getByRole('button', { name: /إضافة وجبة الكومبو/ });
    expect(confirm.textContent).toContain(formatCurrency(199));
    fireEvent.click(confirm);

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    const combo = onAddComboToCart.mock.calls[0][0];
    const stampedTotal = combo.price + combo.modifiers.reduce((sum: number, mod: { price: number }) => sum + mod.price, 0);
    expect(stampedTotal).toBe(199);
    // T11-A: each modifier also carries the catalog price it was read
    // from, so the stamp can refuse a 0 it would otherwise re-price.
    expect(combo.modifiers.map((mod: { catalogPrice: number }) => mod.catalogPrice)).toEqual([75, 25]);
  }, 30000);
});

describe('PosComboMealModal — prices from the real POS lookup shape (T10-A)', () => {
  // Trial-shaped prices: main 99, side 75, drink 25 — the shape the
  // trial's 99/174 mismatch came from (side stamped 0 at base).
  const TRIAL_PRODUCTS = [
    { id: 1, name: 'Burger', retailPrice: 99, stock: 10 },
    { id: 2, name: 'Fries', retailPrice: 75, stock: 10 },
    { id: 3, name: 'Cola', retailPrice: 25, stock: 10 },
  ];

  function buildTrialCombo() {
    const { onAddComboToCart, onClose } = renderModal({ products: TRIAL_PRODUCTS });
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
    return { onAddComboToCart, onClose };
  }

  it('shows real step prices and the summed total from retailPrice only', () => {
    const { onAddComboToCart } = renderModal({ products: TRIAL_PRODUCTS });
    // Step 1: the main card prices at its retailPrice, never 0.00.
    expect(screen.getAllByText(formatCurrency(99)).length).toBeGreaterThan(0);
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    // Step 2: the side card prices at its retailPrice.
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    expect(screen.getAllByText(formatCurrency(75)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    // Step 3: the drink card prices at its retailPrice.
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    expect(screen.getAllByText(formatCurrency(25)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
    // The summary and the confirm button carry the summed total 199.
    const confirm = screen.getByRole('button', { name: /إضافة وجبة الكومبو/ });
    expect(confirm.textContent).toContain(formatCurrency(199));
    expect(onAddComboToCart).not.toHaveBeenCalled();
  }, 30000);

  it('emits the payload with real retail prices, not stamped 0.00', () => {
    const { onAddComboToCart, onClose } = buildTrialCombo();
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    const combo = onAddComboToCart.mock.calls[0][0];
    expect(combo.productId).toBe(1);
    // The line price is the main's retailPrice; the modifiers carry
    // the same retailPrice the server re-prices combo components to,
    // so the frontend total (199) agrees with the server total.
    expect(combo.price).toBe(99);
    expect(combo.modifiers).toEqual([
      { productId: 2, name: 'طبق جانبي: Fries', price: 75, qty: 1, isComboComponent: true, catalogPrice: 75 },
      { productId: 3, name: 'مشروب: Cola', price: 25, qty: 1, isComboComponent: true, catalogPrice: 25 },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 30000);

  it('still prices legacy snake_case products via the fallback chain', () => {
    const legacy = [
      { id: 1, name: 'Burger', price: 60, retail_price: 60, stock: 10 },
      { id: 2, name: 'Fries', price: 25, retail_price: 25, stock: 10 },
      { id: 3, name: 'Cola', price: 15, retail_price: 15, stock: 10 },
    ];
    const { onAddComboToCart } = renderModal({ products: legacy });
    const mainButtons = screen.getAllByRole('button', { name: /Burger/ });
    fireEvent.click(mainButtons[mainButtons.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: /2\. الصنف الجانبي/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fries/ }));
    fireEvent.click(screen.getByRole('button', { name: /3\. المشروب/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cola/ }));
    fireEvent.click(screen.getByRole('button', { name: /إضافة وجبة الكومبو/ }));

    expect(onAddComboToCart).toHaveBeenCalledTimes(1);
    const combo = onAddComboToCart.mock.calls[0][0];
    expect(combo.price).toBe(60);
    expect(combo.modifiers).toEqual([
      { productId: 2, name: 'طبق جانبي: Fries', price: 25, qty: 1, isComboComponent: true, catalogPrice: 25 },
      { productId: 3, name: 'مشروب: Cola', price: 15, qty: 1, isComboComponent: true, catalogPrice: 15 },
    ]);
  }, 30000);
});
