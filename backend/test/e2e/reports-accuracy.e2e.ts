import { E2EClient } from './e2e-utils';
import assert from 'node:assert/strict';

async function main() {
  const client = new E2EClient();
  await client.login(process.env.TEST_USER || 'dev', process.env.TEST_PASSWORD || '1');

  const me = await client.get('/api/auth/me');
  const branchId = me.user.branchIds[0];
  const locs = await client.get(`/api/locations`);
  const locationId = locs.locations[0].id;

  const q = ``;
  
  const sumB = await client.get(`/api/reports/summary${q}`);
  const dashB = await client.get(`/api/dashboard/overview${q}`);
  const treasB = await client.get(`/api/treasury-transactions${q}`);
  const invB = await client.get(`/api/reports/inventory`);

  const suppName = 'Rep Sup ' + Date.now();
  const supReq = await client.post('/api/suppliers', { name: suppName, phone: '123' });
  const supplierId = (supReq.suppliers || []).find((s: any) => s.name === suppName)?.id;
  assert.ok(supplierId, "Missing supplierId");

  const catName = 'Rep Cat ' + Date.now();
  const catReq = await client.post('/api/categories', { name: catName });
  const categoryId = (catReq.categories || []).find((c: any) => c.name === catName)?.id;
  assert.ok(categoryId, "Missing categoryId");

  const prodName = 'Rep Prod ' + Date.now();
  const prodReq = await client.post('/api/products', {
    categoryId, name: prodName, barcode: `RP-${Date.now()}`,
    costPrice: 50, retailPrice: 100, wholesalePrice: 80, minStock: 0, stock: 0,
    units: [{ name: 'Piece', multiplier: 1, barcode: `RP-${Date.now()}`, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
  });
  const productId = (prodReq.products || []).find((p: any) => p.name === prodName)?.id;
  assert.ok(productId, "Missing productId");

  // Purchase
  const purchReq = await client.post('/api/purchases', {
    supplierId, locationId, branchId,
    paymentType: 'cash', discount: 0,
    items: [{ productId, qty: 10, cost: 50 }]
  });

  // Sale
  const custName = 'Rep Cust ' + Date.now();
  const custReq = await client.post('/api/customers', { name: custName, phone: '01012345678', creditLimit: 0 });
  const customerId = (custReq.customers || []).find((c: any) => c.name === custName)?.id;
  assert.ok(customerId, "Missing customerId");

  const saleReq = await client.post('/api/sales', {
    customerId, locationId, branchId,
    paymentChannel: 'cash', discount: 0, tenderedAmount: 400,
    items: [{ productId, qty: 4, price: 100 }]
  });
  const saleId = saleReq.sale?.id || saleReq.createdIds?.[0] || saleReq.id;
  assert.ok(saleId, "Missing saleId");

  // Return
  await client.post('/api/returns', {
    type: 'sale', invoiceId: saleId, settlementMode: 'refund', refundMethod: 'cash',
    items: [{ productId, qty: 1 }]
  });

  // Expense
  await client.post('/api/expenses', {
    title: 'Test Expense', amount: 50, date: new Date().toISOString()
  });

  // Service
  await client.post('/api/services', {
    service: { name: 'Test Service', amount: 70, paymentChannel: 'cash', date: new Date().toISOString() }
  });

  const sumA = await client.get(`/api/reports/summary${q}`);
  const dashA = await client.get(`/api/dashboard/overview${q}`);
  const treasA = await client.get(`/api/treasury-transactions${q}`);
  const invA = await client.get(`/api/reports/inventory`);

  // Assertions (Differences)
  
  const assertDiff = (before: number, after: number, expectedDiff: number, name: string) => {
    const diff = Number((after - before).toFixed(2));
    assert.strictEqual(diff, expectedDiff, `${name} diff mismatch. Expected: ${expectedDiff}, Got: ${diff}`);
  };

  // 1. Dashboard Stats
  assertDiff(dashB.stats.todaySalesAmount, dashA.stats.todaySalesAmount, 400, 'todaySalesAmount');
  assertDiff(dashB.stats.todayPurchasesAmount, dashA.stats.todayPurchasesAmount, 500, 'todayPurchasesAmount');
  assertDiff(dashB.stats.inventoryCost, dashA.stats.inventoryCost, 350, 'inventoryCost');
  assertDiff(dashB.stats.inventorySaleValue, dashA.stats.inventorySaleValue, 700, 'inventorySaleValue');

  // 2. Summary Endpoint
  assertDiff(sumB.sales.total, sumA.sales.total, 470, 'sales.total'); // 400 merch + 70 service
  assertDiff(sumB.sales.netSales, sumA.sales.netSales, 370, 'sales.netSales'); // 400 - 100 refund + 70 service
  assertDiff(sumB.purchases.total, sumA.purchases.total, 500, 'purchases.total');
  assertDiff(sumB.purchases.netPurchases, sumA.purchases.netPurchases, 500, 'purchases.netPurchases');
  assertDiff(sumB.expenses.total, sumA.expenses.total, 50, 'expenses.total');
  assertDiff(sumB.services.total, sumA.services.total, 70, 'services.total');
  assertDiff(sumB.returns.salesTotal, sumA.returns.salesTotal, 100, 'returns.salesTotal');
  assertDiff(sumB.treasury.cashIn, sumA.treasury.cashIn, 470, 'treasury.cashIn'); // 400 sale + 70 service
  assertDiff(sumB.treasury.cashOut, sumA.treasury.cashOut, 650, 'treasury.cashOut'); // 500 purchase + 100 return + 50 expense
  assertDiff(sumB.treasury.net, sumA.treasury.net, -180, 'treasury.net');
  assertDiff(sumB.commercial.cogs, sumA.commercial.cogs, 150, 'commercial.cogs'); // (4*50) - (1*50) = 150
  assertDiff(sumB.commercial.grossProfit, sumA.commercial.grossProfit, 220, 'commercial.grossProfit'); // 370 Net Sales - 150 COGS = 220
  
  // 3. Dashboard Summary
  assertDiff(dashB.summary.sales.netSales, dashA.summary.sales.netSales, 370, 'dash.summary.sales.netSales');
  assertDiff(dashB.summary.commercial.cogs, dashA.summary.commercial.cogs, 150, 'dash.summary.commercial.cogs');

  // 4. Treasury Transactions
  // (Array length is paginated, so we skip checking exact difference, totals are verified above in summary)

  // 5. Inventory Report
  const invAFiltered = await client.get(`/api/reports/inventory?search=${encodeURIComponent(prodName)}`);
  const invProdA = invAFiltered.items?.find((i: any) => String(i.id) === String(productId));
  const qtyA = invProdA ? invProdA.stockQty : 0;
  assertDiff(0, qtyA, 7, 'inventory report product qty');
  
  console.log('✅ All report accuracy assertions passed successfully!');
}

main().catch(console.error);
