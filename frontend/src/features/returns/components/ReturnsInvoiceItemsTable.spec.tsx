/* SPICE-PKG3 (a) — weighed returns: selection is KEY PRESENCE in
 * selectedItems, never the quantity. A weighed line being corrected
 * through '' / 0 must stay selected with its input enabled, and a
 * partial weighed qty (0.25 of 0.750 kg) is a valid selection.
 * On the base isSelected is Number(qty) > 0, so the '' and '0'
 * cases below render unchecked + disabled and fail there. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsInvoiceItemsTable } from './ReturnsInvoiceItemsTable';
import type { SaleItem } from '@/types/domain';

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

function renderTable(selectedItems: Record<string, string>, handlers: Record<string, unknown> = {}) {
  const onToggleItem = vi.fn();
  const onSetItemQty = vi.fn();
  const utils = render(
    <ReturnsInvoiceItemsTable
      invoiceItems={[weighedItem()]}
      selectedItems={selectedItems}
      selectedSerials={{}}
      onToggleItem={onToggleItem}
      onSetItemQty={onSetItemQty}
      onSetSerials={vi.fn()}
      returnedQtyByLine={{}}
      blockedProductIds={[]}
      returnHistoryReady
      {...(handlers as object)}
    />,
  );
  const qtyInput = utils.container.querySelector('input[type="number"]') as HTMLInputElement;
  return { ...utils, onToggleItem, onSetItemQty, qtyInput };
}

describe('ReturnsInvoiceItemsTable weighed selection (SPICE-PKG3)', () => {
  it('keeps a line selected while its qty is being corrected through an empty value', () => {
    const { qtyInput } = renderTable({ '10': '' });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput).not.toBeDisabled();
    expect(qtyInput.value).toBe('');
  });

  it('keeps a line selected while its qty is being corrected through 0', () => {
    const { qtyInput } = renderTable({ '10': '0' });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput).not.toBeDisabled();
    expect(qtyInput.value).toBe('0');
  });

  it('shows a partial weighed qty (0.25 of 0.750 kg) as selected with its pro-rata value', () => {
    const { qtyInput } = renderTable({ '10': '0.25' });

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(qtyInput).not.toBeDisabled();
    expect(qtyInput.value).toBe('0.25');
    expect(screen.getByText('100.10')).toBeInTheDocument();
  });

  it('leaves an unselected line unchecked with its qty input disabled', () => {
    const { qtyInput } = renderTable({});

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(qtyInput).toBeDisabled();
  });

  it('reports the toggle and the typed qty back to the workspace', () => {
    const { onToggleItem, onSetItemQty, qtyInput } = renderTable({ '10': '0.25' });

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleItem).toHaveBeenCalledWith('10', false);

    fireEvent.change(qtyInput, { target: { value: '0.5' } });
    expect(onSetItemQty).toHaveBeenCalledWith('10', '0.5');
  });
});
