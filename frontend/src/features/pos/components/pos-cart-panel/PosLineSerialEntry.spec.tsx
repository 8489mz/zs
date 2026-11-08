import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PosLineSerialEntry } from './PosLineSerialEntry';
import { productSerialsApi } from '@/features/products/api/product-serials.api';
import type { PosItem } from '@/features/pos/types/pos.types';

vi.mock('@/features/products/api/product-serials.api', () => ({
  productSerialsApi: { lookup: vi.fn() },
}));

const lookupMock = vi.mocked(productSerialsApi.lookup);

function serialItem(overrides: Partial<PosItem> = {}): PosItem {
  return {
    lineKey: 'line-1',
    productId: 'p1',
    name: 'هاتف',
    qty: 2,
    price: 100,
    costPrice: 80,
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    stockLimit: 5,
    currentStock: 5,
    minStock: 0,
    priceType: 'retail',
    trackSerials: true,
    ...overrides,
  };
}

function renderEntry(item: PosItem, handlers: { onAddSerial?: any; onRemoveSerial?: any } = {}) {
  const onAddSerial = handlers.onAddSerial || vi.fn();
  const onRemoveSerial = handlers.onRemoveSerial || vi.fn();
  render(<PosLineSerialEntry item={item} onAddSerial={onAddSerial} onRemoveSerial={onRemoveSerial} />);
  return { onAddSerial, onRemoveSerial };
}

describe('PosLineSerialEntry (LF-P3)', () => {
  it('adds a valid in-stock serial for this product and clears the input', async () => {
    lookupMock.mockResolvedValue({ id: 's1', productId: 'p1', serialNumber: '869123456789022', status: 'in_stock' });
    const user = userEvent.setup();
    const { onAddSerial } = renderEntry(serialItem());

    expect(screen.getByText(/0.*من.*2/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/امسح أو اكتب السيريال/), '869123456789022');
    await user.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(lookupMock).toHaveBeenCalledWith('869123456789022'));
    expect(onAddSerial).toHaveBeenCalledWith('line-1', '869123456789022');
    expect(screen.getByPlaceholderText(/امسح أو اكتب السيريال/)).toHaveValue('');
  });

  it('rejects a sold serial with a specific error naming the serial and its state', async () => {
    lookupMock.mockResolvedValue({ id: 's1', productId: 'p1', serialNumber: '869123456789022', status: 'sold' });
    const user = userEvent.setup();
    const { onAddSerial } = renderEntry(serialItem());

    await user.type(screen.getByPlaceholderText(/امسح أو اكتب السيريال/), '869123456789022');
    await user.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(
      screen.getByText('السيريال 869123456789022 غير متاح للبيع — حالته: مباع.'),
    ).toBeInTheDocument());
    expect(onAddSerial).not.toHaveBeenCalled();
  });

  it('rejects an unknown serial with a specific error naming the serial', async () => {
    lookupMock.mockResolvedValue(null);
    const user = userEvent.setup();
    const { onAddSerial } = renderEntry(serialItem());

    await user.type(screen.getByPlaceholderText(/امسح أو اكتب السيريال/), '000000000000000');
    await user.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(
      screen.getByText('السيريال 000000000000000 غير مسجّل في النظام.'),
    ).toBeInTheDocument());
    expect(onAddSerial).not.toHaveBeenCalled();
  });

  it('rejects a serial registered to another product, naming both', async () => {
    lookupMock.mockResolvedValue({ id: 's1', productId: 'p9', serialNumber: '869123456789022', status: 'in_stock', productName: 'هاتف آخر' });
    const user = userEvent.setup();
    const { onAddSerial } = renderEntry(serialItem());

    await user.type(screen.getByPlaceholderText(/امسح أو اكتب السيريال/), '869123456789022');
    await user.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(
      screen.getByText('السيريال 869123456789022 مسجّل لصنف آخر (هاتف آخر) وليس هاتف.'),
    ).toBeInTheDocument());
    expect(onAddSerial).not.toHaveBeenCalled();
  });

  it('shows a duplicate rejection from the cart helper instead of adding', async () => {
    lookupMock.mockResolvedValue({ id: 's1', productId: 'p1', serialNumber: '869123456789022', status: 'in_stock' });
    const user = userEvent.setup();
    const onAddSerial = vi.fn(() => { throw new Error('السيريال 869123456789022 مضاف بالفعل إلى هاتف.'); });
    renderEntry(serialItem(), { onAddSerial });

    await user.type(screen.getByPlaceholderText(/امسح أو اكتب السيريال/), '869123456789022');
    await user.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(
      screen.getByText('السيريال 869123456789022 مضاف بالفعل إلى هاتف.'),
    ).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/امسح أو اكتب السيريال/)).toHaveValue('869123456789022');
  });

  it('hides the input once complete and offers remove on every listed serial', async () => {
    const user = userEvent.setup();
    const { onRemoveSerial } = renderEntry(serialItem({
      serials: ['869123456789022', '869123456789023'],
    }));

    expect(screen.getByText(/2.*من.*2/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/امسح أو اكتب السيريال/)).not.toBeInTheDocument();
    expect(screen.getByText('869123456789022')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'حذف السيريال 869123456789022' }));
    expect(onRemoveSerial).toHaveBeenCalledWith('line-1', '869123456789022');
  });
});
