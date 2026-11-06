/* Sales invoice detail (INV-SALES-INVOICE-DETAIL-PAYMENT): the detail card
 * names the real payment channel (a card sale shows 'بطاقة / فيزا', not
 * 'نقدي'), a credit sale still shows 'آجل', and a sale with linked
 * returns lists them with doc number, date, total, and a link to the
 * returns page. Renders the REAL SaleDetailCard.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { SaleDetailCard } from './SaleDetailCard';
import type { Sale } from '@/types/domain';

const cardSale: Sale = {
  id: '1',
  docNo: 'Z-261105-16304',
  customerId: '',
  customerName: 'أحمد محمد',
  paymentType: 'cash',
  paymentChannel: 'card',
  subTotal: 100,
  discount: 0,
  taxRate: 0,
  taxAmount: 0,
  pricesIncludeTax: false,
  total: 100,
  paidAmount: 100,
  status: 'posted',
  note: '',
  createdBy: 'cashier1',
  branchId: '',
  branchName: '',
  locationId: '',
  locationName: '',
  date: '2026-11-05T10:00:00.000Z',
  createdAt: '2026-11-05T10:00:00.000Z',
  items: [
    { id: 'i1', productId: '10', name: 'صنف تجريبي', qty: 1, price: 100, total: 100, unitName: 'قطعة', unitMultiplier: 1, cost: 80, priceType: 'retail' },
  ],
  linkedReturns: [
    { id: '1', docNo: 'ZR-261106-0001', createdAt: '2026-11-06T09:00:00.000Z', total: 25.5 },
  ],
};

const renderCard = (sale: Sale) =>
  render(
    <MemoryRouter>
      <SaleDetailCard sale={sale} />
    </MemoryRouter>,
  );

describe('Sale detail card payment + linked returns', () => {
  it('names the real payment channel and lists the linked return', async () => {
    renderCard(cardSale);

    expect(await screen.findByText('بطاقة / فيزا')).toBeTruthy();
    expect(await screen.findByText('المرتجعات المرتبطة')).toBeTruthy();
    const docLink = await screen.findByText('ZR-261106-0001');
    expect(docLink.closest('a')?.getAttribute('href')).toBe('/returns');
    expect(screen.getByText('25.50')).toBeTruthy();
  });

  it('keeps آجل for a credit sale', async () => {
    renderCard({ ...cardSale, paymentType: 'credit', paymentChannel: 'cash', paidAmount: 0, linkedReturns: [] });

    expect(await screen.findByText('آجل')).toBeTruthy();
    expect(screen.queryByText('آجل بالكامل')).toBeNull();
    expect(screen.queryByText('المرتجعات المرتبطة')).toBeNull();
  });

  it('shows no returns section when the sale has no linked returns', async () => {
    renderCard({ ...cardSale, linkedReturns: [] });

    expect(await screen.findByText('بطاقة / فيزا')).toBeTruthy();
    expect(screen.queryByText('المرتجعات المرتبطة')).toBeNull();
  });
});
