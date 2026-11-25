import { strict as assert } from 'node:assert';
import { buildManagerActionInsights } from '../../src/modules/manager-actions/helpers/manager-actions.helper';

(() => {
  const insights = buildManagerActionInsights({
    now: new Date('2026-04-27T12:00:00.000Z'),
    limit: 8,
    products: [
      {
        id: 1,
        name: 'قميص',
        retail_price: 80,
        cost_price: 100,
        stock_qty: 4,
        min_stock_qty: 8,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'حذاء',
        retail_price: 120,
        cost_price: 110,
        stock_qty: 0,
        min_stock_qty: 3,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    productLastSales: [{ product_id: 1, last_sold_at: '2026-01-10T00:00:00.000Z' }],
    sales: [{ id: 10, doc_no: 'S-10', subtotal: 1000, discount: 250, total: 750 }],
    saleMargins: [{ sale_id: 10, doc_no: 'S-10', revenue: 750, cost: 780, below_cost_lines: 1 }],
    customers: [
      { id: 20, name: 'عميل نقدي', balance: 900, credit_limit: 800 },
      { id: 21, name: 'عميل قريب', balance: 820, credit_limit: 1000 },
    ],
    customerBalances: [],
  });

  const ids = insights.map((insight) => insight.id);
  assert.ok(ids.includes('product-below-cost-1'));
  assert.ok(ids.includes('product-out-of-stock-2'));
  assert.ok(ids.includes('sale-high-discount-10'));
  assert.ok(ids.includes('sale-below-cost-lines-10'));
  assert.ok(ids.includes('customer-over-credit-20'));
  assert.ok(ids.includes('customer-near-credit-21'));
  assert.equal(insights[0].severity, 'danger');
  assert.ok(insights.every((insight) => insight.title && insight.message && insight.actionHref));

  // Test custom stagnantThresholdDays and expiryAlertDays
  const customInsights = buildManagerActionInsights({
    now: new Date('2026-04-27T12:00:00.000Z'),
    limit: 10,
    stagnantThresholdDays: 120,
    expiryAlertDays: 60,
    products: [
      {
        id: 3,
        name: 'منتج راكد مخصص',
        retail_price: 150,
        cost_price: 100,
        stock_qty: 10,
        min_stock_qty: 2,
        metadata: { expiryDate: '2026-06-15' }, // 49 days left -> within 60 days alert
      },
    ],
    productLastSales: [
      { product_id: 3, last_sold_at: '2026-03-01T00:00:00.000Z' }, // 57 days ago -> NOT stagnant since threshold is 120
    ],
    sales: [],
    saleMargins: [],
    customers: [],
    customerBalances: [],
  });

  const customIds = customInsights.map((i) => i.id);
  assert.ok(
    customIds.includes('product-near-expiry-3'),
    'Should alert on near-expiry product within custom 60-day threshold',
  );
  assert.ok(!customIds.includes('product-stagnant-warning-3'), 'Should not alert on stagnant if under 120 days');

  // Test new domains: pharmacy batches, installments, online orders
  const newDomainInsights = buildManagerActionInsights({
    now: new Date('2026-04-27T12:00:00.000Z'),
    limit: 15,
    products: [],
    productLastSales: [],
    sales: [],
    saleMargins: [],
    customers: [],
    customerBalances: [],
    pharmacyBatches: [
      { id: 101, product_name: 'بانادول', batch_number: 'B-2026', expiry_date: '2026-05-10', quantity: 50 },
    ],
    installments: [
      {
        id: 201,
        customer_name: 'أحمد محمود',
        customer_id: 5,
        amount: 500,
        due_date: '2026-04-20',
        installment_number: 2,
      },
    ],
    onlineOrders: [
      { id: 301, order_number: 'ORD-301', customer_name: 'سارة', total: 350, created_at: '2026-04-27T11:00:00.000Z' },
    ],
  });

  const newDomainIds = newDomainInsights.map((i) => i.id);
  assert.ok(newDomainIds.includes('pharmacy-batch-near-expiry-101'), 'Should include near-expiry pharmacy batch');
  assert.ok(newDomainIds.includes('installment-due-201'), 'Should include overdue installment');
  assert.ok(newDomainIds.includes('online-order-pending-301'), 'Should include pending online order');

  console.log('manager-actions.helper.spec: ok');
})();
