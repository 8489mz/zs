/* Sales register amounts (INV-INVOICE-DETAIL-AMOUNTS): the register's
 * 'الضرائب' column shows the collected tax amount stored on each sale
 * (it used to render an e-invoice status that was never populated, so it
 * could only ever show '—'), and the register has a discount column
 * showing the discount stored on each sale.
 */
import { describe, it, expect } from 'vitest';
import { getSalesTableColumns } from './sales-mappers';
import type { Sale } from '@/types/domain';

const taxedSale = {
  id: '1',
  docNo: 'Z-261105-16309',
  subTotal: 150,
  discount: 0,
  taxRate: 14,
  taxAmount: 21,
  total: 171,
} as Sale;

const discountedSale = {
  id: '2',
  docNo: 'Z-261105-16311',
  subTotal: 150,
  discount: 15,
  taxRate: 0,
  taxAmount: 0,
  total: 135,
} as Sale;

describe('sales register tax and discount columns', () => {
  it('shows the collected tax amount in the taxes column, not —', () => {
    const columns = getSalesTableColumns();
    const taxColumn = columns.find((column) => column.key === 'tax');

    expect(taxColumn).toBeTruthy();
    expect(taxColumn?.header).toBe('الضرائب');
    expect(taxColumn?.cell(taxedSale)).toBe('21.00');
    expect(taxColumn?.cell(discountedSale)).toBe('0.00');
  });

  it('shows the discount amount in the discount column', () => {
    const columns = getSalesTableColumns();
    const discountColumn = columns.find((column) => column.key === 'discount');

    expect(discountColumn).toBeTruthy();
    expect(discountColumn?.header).toBe('الخصم');
    expect(discountColumn?.cell(discountedSale)).toBe('15.00');
    expect(discountColumn?.cell(taxedSale)).toBe('0.00');
  });
});
