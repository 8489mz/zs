/*
New file: backend/test/critical/eta-document-tax.spec.ts
Pins tax unification package 2: the ETA document attests the POSTED
invoice through the shared buildDocumentTax engine — never a
recomputation at a hardcoded 14%. The old serializer recomputed
every line's tax as 14% of the gross line total (discount-blind,
tax-inclusive-blind), so an exempt sale was reported at 14%, a 5%
sale at 14%, and a tax-inclusive sale at 14% of its tax-inclusive
total, with the line discount always reported as 0.

WHAT THIS PINS:
- The real serializeSaleToEtaFormat, driven with a mock DB: stored
  allocations win (rate, amount, and discount all from the posted
  rows); legacy lines without allocations fall back to the STORED
  rate only, with tax-inclusive extraction; document totals equal
  the sum of the document lines.
- Fail-closed: a corrupt stored rate rejects instead of signing a
  nonsense document; missing ETA settings still throw as before.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { EtaSerializerService } from '../../src/modules/tax-integration/services/eta-serializer/eta-serializer.service';

async function main(): Promise<void> {
  function drive(
    sale: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    settings: Record<string, unknown> | null,
  ) {
    function chainable(result: unknown) {
      const q: any = {
        select: () => q,
        selectAll: () => q,
        where: () => q,
        execute: async () => result,
        executeTakeFirst: async () => result,
        executeTakeFirstOrThrow: async () => {
          if (result == null) throw new Error('no row');
          return result;
        },
      };
      return q;
    }
    const svc: any = Object.create(EtaSerializerService.prototype);
    svc.db = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenant_tax_settings')
          return chainable(
            settings == null ? [] : [{ provider: 'ETA_EGYPT', tax_id: (settings as any).tax_id, is_active: true }],
          );
        return chainable(null);
      },
    };
    svc.taxSettings = { getSettings: async () => settings };
    return svc.serializeSaleToEtaFormat('tenant-1', 7) as Promise<any>;
  }

  const baseSale = {
    id: 7,
    doc_no: 'INV-7',
    status: 'posted',
    customer_id: null,
    customer_name: 'Cash',
    created_at: new Date('2026-10-30T10:00:00.000Z'),
    discount: 0,
  };
  const baseItem = {
    qty: 2,
    unit_price: 100,
    product_id: 11,
    product_name: 'Widget',
  };

  // Stored 5% sale reports 5% — the old serializer reported 14%.
  const five = await drive(
    { ...baseSale, tax_rate: 5, tax_amount: 10, prices_include_tax: false },
    [{ ...baseItem, line_total: 200, net_line_total: 200, allocated_discount: 0, allocated_tax: 10 }],
    { tax_id: '123456789' },
  );
  assert.equal(five.invoiceLines[0].taxableItems[0].amount, 10);
  assert.equal(five.invoiceLines[0].taxableItems[0].rate, 5);
  assert.equal(five.invoiceLines[0].netTotal, 200);
  assert.equal(five.invoiceLines[0].total, 210);
  assert.equal(five.taxTotals[0].amount, 10);
  assert.equal(five.totalAmount, 210);

  // Exempt sale reports 0 — the old serializer reported 14% / 114.
  const exempt = await drive(
    { ...baseSale, tax_rate: 0, tax_amount: 0, prices_include_tax: false },
    [{ ...baseItem, qty: 1, line_total: 100, net_line_total: 100, allocated_discount: 0, allocated_tax: 0 }],
    { tax_id: '123456789' },
  );
  assert.equal(exempt.invoiceLines[0].taxableItems[0].amount, 0);
  assert.equal(exempt.invoiceLines[0].taxableItems[0].rate, 0);
  assert.equal(exempt.invoiceLines[0].total, 100);
  assert.equal(exempt.totalAmount, 100);

  // Stored allocation wins over recomputation: 10.01 posted, not 10.00 recomputed.
  const storedWins = await drive(
    { ...baseSale, tax_rate: 15, tax_amount: 10.01, prices_include_tax: false },
    [{ ...baseItem, qty: 1, line_total: 66.7, net_line_total: 66.7, allocated_discount: 0, allocated_tax: 10.01 }],
    { tax_id: '123456789' },
  );
  assert.equal(storedWins.invoiceLines[0].taxableItems[0].amount, 10.01);
  assert.equal(storedWins.invoiceLines[0].total, 76.71);

  // Legacy tax-inclusive sale without allocations: stored 14% extracted.
  const legacy = await drive(
    { ...baseSale, tax_rate: 14, tax_amount: 14, prices_include_tax: true },
    [{ ...baseItem, qty: 1, line_total: 114, net_line_total: null, allocated_discount: null, allocated_tax: null }],
    { tax_id: '123456789' },
  );
  assert.equal(legacy.invoiceLines[0].netTotal, 100);
  assert.equal(legacy.invoiceLines[0].taxableItems[0].amount, 14);
  assert.equal(legacy.invoiceLines[0].total, 114);

  // Discounted line: discount and base from the posted allocation.
  const discounted = await drive(
    { ...baseSale, tax_rate: 14, tax_amount: 14, prices_include_tax: false, discount: 20 },
    [{ ...baseItem, qty: 1, line_total: 120, net_line_total: 100, allocated_discount: 20, allocated_tax: 14 }],
    { tax_id: '123456789' },
  );
  assert.equal(discounted.invoiceLines[0].netTotal, 100);
  assert.equal(discounted.invoiceLines[0].itemsDiscount, 20);
  assert.equal(discounted.invoiceLines[0].taxableItems[0].amount, 14);
  assert.equal(discounted.invoiceLines[0].total, 114);
  assert.equal(discounted.totalDiscountAmount, 20);

  // Fail-closed on a corrupt stored rate; missing settings still throw.
  await assert.rejects(
    drive({ ...baseSale, tax_rate: -5, prices_include_tax: false }, [{ ...baseItem, line_total: 100 }], {
      tax_id: '123456789',
    }),
    /DOCUMENT_TAX_RATE_INVALID/,
  );
  await assert.rejects(
    drive({ ...baseSale, tax_rate: 14, prices_include_tax: false }, [{ ...baseItem, line_total: 100 }], null),
    /ETA Settings not configured/,
  );

  console.log('ETA document-tax tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
