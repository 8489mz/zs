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

/* Invoice detail amounts (INV-INVOICE-DETAIL-AMOUNTS): the detail card
 * itemises the collected tax and the discount the GET already returns —
 * a taxed invoice shows its tax row, a discounted invoice shows its
 * discount row with the percent, and a plain invoice shows no empty rows.
 */
describe('Sale detail card tax and discount rows', () => {
  const baseSale: Sale = {
    ...cardSale,
    docNo: 'Z-261105-16309',
    linkedReturns: [],
  };

  it('shows the collected tax row for a taxed invoice', async () => {
    renderCard({
      ...baseSale,
      subTotal: 150,
      discount: 0,
      taxRate: 14,
      taxAmount: 21,
      total: 171,
      paidAmount: 171,
      items: [
        { id: 'i1', productId: '10', name: 'صنف تجريبي', qty: 1, price: 150, total: 150, unitName: 'قطعة', unitMultiplier: 1, cost: 80, priceType: 'retail' },
      ],
    });

    expect(await screen.findByText('الضريبة (14%)')).toBeTruthy();
    expect(screen.getByText('21.00')).toBeTruthy();
    expect(screen.getByText('المجموع الفرعي')).toBeTruthy();
  });

  it('shows the discount row with its percent for a discounted invoice', async () => {
    renderCard({
      ...baseSale,
      docNo: 'Z-261105-16311',
      subTotal: 150,
      discount: 15,
      taxRate: 0,
      taxAmount: 0,
      total: 135,
      paidAmount: 135,
      items: [
        { id: 'i1', productId: '10', name: 'صنف تجريبي', qty: 1, price: 150, total: 150, unitName: 'قطعة', unitMultiplier: 1, cost: 80, priceType: 'retail' },
      ],
    });

    expect(await screen.findByText('الخصم (10%)')).toBeTruthy();
    expect(screen.getByText('15.00')).toBeTruthy();
  });

  it('shows no tax, discount or subtotal rows for a plain invoice', async () => {
    renderCard({
      ...baseSale,
      subTotal: 150,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 150,
      paidAmount: 150,
    });

    expect((await screen.findAllByText('150.00')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/الضريبة/)).toBeNull();
    expect(screen.queryByText(/الخصم/)).toBeNull();
    expect(screen.queryByText('المجموع الفرعي')).toBeNull();
  });
});
