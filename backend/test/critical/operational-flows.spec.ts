import { strict as assert } from 'node:assert';
import { computeInvoiceTotals } from '../../src/common/utils/invoice-totals';
import { validateSalePayments } from '../../src/common/utils/financial-integrity';
import { normalizeReturnItems } from '../../src/modules/returns/helpers/return-payload.helper';
import { buildLastNDays, filterScope, parseRange } from '../../src/modules/reports/helpers/reports-range.helper';
import { mapPurchaseRows, summarizePurchases } from '../../src/modules/purchases/helpers/purchases-query.helper';
import { normalizeSalePayload } from '../../src/modules/sales/helpers/sales-payload.helper';
import { mapSaleRows, summarizeSales } from '../../src/modules/sales/helpers/sales-query.helper';

(() => {
  const normalizedCredit = normalizeSalePayload({
    customerId: 10,
    paymentType: 'credit',
    paymentChannel: 'credit',
    discount: 0,
    taxRate: 0,
    storeCreditUsed: 0,
    note: ' credit sale ',
    branchId: 1,
    locationId: 2,
    items: [{ productId: 1, qty: 1, price: 75, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' }],
    payments: [{ paymentChannel: 'cash', amount: 75 }],
  } as any);

  assert.equal(normalizedCredit.customerId, 10);
  assert.equal(normalizedCredit.paymentType, 'credit');
  assert.equal(normalizedCredit.paymentChannel, 'credit');
  assert.equal(normalizedCredit.payments.length, 0);
  assert.equal(normalizedCredit.note, 'credit sale');

  assert.throws(
    () =>
      normalizeSalePayload({
        paymentType: 'credit',
        paymentChannel: 'credit',
        discount: 0,
        taxRate: 0,
        storeCreditUsed: 0,
        note: '',
        branchId: 1,
        locationId: 2,
        items: [{ productId: 1, qty: 1, price: 75, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' }],
        payments: [],
      } as any),
    (error: any) => error?.code === 'CREDIT_SALE_REQUIRES_CUSTOMER',
  );

  const normalized = normalizeSalePayload({
    paymentType: 'cash',
    paymentChannel: 'cash',
    discount: 10,
    taxRate: 14,
    storeCreditUsed: 20,
    note: '  test sale  ',
    branchId: 1,
    locationId: 2,
    items: [{ productId: 1, qty: 2, price: 100, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' }],
    payments: [
      { paymentChannel: 'cash', amount: 50 },
      { paymentChannel: 'card', amount: 146.6 },
      { paymentChannel: 'card', amount: 0 },
    ],
  } as any);

  assert.equal(normalized.paymentChannel, 'mixed');
  assert.equal(normalized.note, 'test sale');
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.payments.length, 2);

  // Invalid lines must abort the entire sale, not disappear from the receipt or stock ledger.
  for (const invalidItem of [
    { productId: 0, qty: 1, price: 50 },
    { productId: 2, qty: 0, price: 50 },
    { productId: 2, qty: -1, price: 50 },
    { productId: 2, qty: 1, price: -50 },
    { productId: 2, qty: 1, price: 50, unitMultiplier: -1 },
    { productId: 2, qty: 1, price: 50, unitMultiplier: 0 },
  ]) {
    assert.throws(
      () =>
        normalizeSalePayload({
          paymentType: 'cash',
          items: [{ productId: 1, qty: 1, price: 20 }, invalidItem],
        } as any),
      (error: any) => error?.code === 'SALE_ITEM_INVALID',
    );
  }

  const totals = computeInvoiceTotals(200, normalized.discount, normalized.taxRate, false);
  assert.equal(totals.taxAmount, 26.6);
  assert.equal(totals.total, 216.6);

  const paymentSummary = validateSalePayments({
    paymentType: 'cash',
    collectibleTotal: Number((totals.total - normalized.storeCreditUsed).toFixed(2)),
    payments: normalized.payments,
  });
  assert.equal(paymentSummary.paidAmount, 196.6);

  const sales = mapSaleRows(
    [
      {
        id: 1,
        doc_no: 'S-1',
        customer_id: 10,
        customer_name: 'عميل دائم',
        payment_type: 'cash',
        payment_channel: 'mixed',
        subtotal: 200,
        discount: 10,
        tax_rate: 14,
        tax_amount: 26.6,
        total: 216.6,
        paid_amount: 196.6,
        store_credit_used: 20,
        status: 'posted',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        doc_no: 'S-2',
        customer_id: 11,
        customer_name: 'عميل آجل',
        payment_type: 'credit',
        payment_channel: 'credit',
        subtotal: 75,
        discount: 0,
        tax_rate: 0,
        tax_amount: 0,
        total: 75,
        paid_amount: 0,
        store_credit_used: 0,
        status: 'posted',
        created_at: new Date().toISOString(),
      },
    ],
    [
      {
        id: 11,
        sale_id: 1,
        product_id: 1,
        product_name: 'A',
        qty: 2,
        unit_price: 100,
        line_total: 200,
        unit_name: 'قطعة',
        unit_multiplier: 1,
        cost_price: 60,
        price_type: 'retail',
      },
      {
        id: 12,
        sale_id: 2,
        product_id: 2,
        product_name: 'B',
        qty: 1,
        unit_price: 75,
        line_total: 75,
        unit_name: 'قطعة',
        unit_multiplier: 1,
        cost_price: 40,
        price_type: 'retail',
      },
    ],
    [
      { id: 21, sale_id: 1, payment_channel: 'cash', amount: 50 },
      { id: 22, sale_id: 1, payment_channel: 'card', amount: 146.6 },
    ],
  );
  const salesSummary = summarizeSales(sales as any);
  assert.equal(salesSummary.totalItems, 2);
  assert.equal(salesSummary.totalSales, 291.6);
  assert.equal(salesSummary.cashTotal, 216.6);
  assert.equal(salesSummary.creditTotal, 75);
  assert.equal((sales[0] as any).items.length, 1);
  assert.equal((sales[0] as any).payments.length, 2);
  assert.equal((sales[1] as any).customerId, '11');
  assert.equal((sales[1] as any).customerName, 'عميل آجل');
  assert.equal((sales[1] as any).paymentType, 'credit');

  const purchases = mapPurchaseRows(
    [
      {
        id: 5,
        doc_no: 'P-5',
        supplier_id: 9,
        supplier_name: 'المورد الأول',
        payment_type: 'credit',
        subtotal: 300,
        total: 300,
        status: 'posted',
        created_at: new Date().toISOString(),
      },
      {
        id: 6,
        doc_no: 'P-6',
        supplier_id: 9,
        supplier_name: 'المورد الأول',
        payment_type: 'cash',
        subtotal: 50,
        total: 50,
        status: 'cancelled',
        created_at: new Date().toISOString(),
      },
    ],
    [
      { id: 31, purchase_id: 5, product_id: 1, product_name: 'A', qty: 3, unit_cost: 100, line_total: 300 },
      { id: 32, purchase_id: 6, product_id: 2, product_name: 'B', qty: 1, unit_cost: 50, line_total: 50 },
    ],
  );
  const purchaseSummary = summarizePurchases(purchases as any);
  assert.equal(purchaseSummary.totalItems, 2);
  assert.equal(purchaseSummary.totalAmount, 350);
  assert.equal(purchaseSummary.creditTotal, 300);
  assert.equal(purchaseSummary.cancelledCount, 1);
  assert.equal(purchaseSummary.topSuppliers[0]?.name, 'المورد الأول');

  const normalizedReturn = normalizeReturnItems({
    type: 'sale',
    invoiceId: 15,
    items: [{ productId: 1, qty: 2, productName: 'A' }],
    settlementMode: 'refund',
  } as any);
  assert.equal(normalizedReturn.length, 1);
  assert.equal(normalizedReturn[0]?.productId, 1);

  assert.throws(
    () =>
      normalizeReturnItems({
        type: 'sale',
        invoiceId: 15,
        items: [{ productId: 0, qty: 1 }],
        settlementMode: 'refund',
      } as any),
    (error: any) => error?.code === 'RETURN_ITEM_INVALID',
  );

  assert.throws(
    () =>
      normalizeReturnItems({
        type: 'purchase',
        invoiceId: 22,
        items: [{ productId: 1, qty: 1 }],
        settlementMode: 'store_credit',
      } as any),
    (error: any) => error?.code === 'PURCHASE_RETURN_SETTLEMENT_INVALID',
  );

  const defaultRange = parseRange({} as any);
  assert.ok(defaultRange.from);
  assert.ok(defaultRange.to);
  const scoped = filterScope(
    [
      { id: 1, branch_id: 1, location_id: 2 },
      { id: 2, branch_id: 2, location_id: 2 },
    ],
    { branchId: 1, locationId: 2 } as any,
  );
  assert.equal(scoped.length, 1);
  assert.equal((scoped[0] as any).id, 1);
  assert.equal(buildLastNDays(7).length, 7);

  console.log('operational-flows.spec: ok');
})();
