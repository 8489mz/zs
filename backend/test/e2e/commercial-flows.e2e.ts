import assert from 'node:assert/strict';
import { expectArray, findByName, loginClient, uniqueSuffix } from './e2e-utils';

async function main() {
  const client = await loginClient();
  const suffix = uniqueSuffix('flows');
  const categoryName = `E2E Flow Category ${suffix}`;
  const supplierName = `E2E Flow Supplier ${suffix}`;
  const customerName = `E2E Flow Customer ${suffix}`;
  const productName = `E2E Flow Product ${suffix}`;

  await client.post('/api/categories', { name: categoryName }, 201);
  const categories = expectArray((await client.get('/api/categories')).categories, 'categories');
  const category = findByName(categories, categoryName);

  await client.post('/api/suppliers', {
    name: supplierName,
    phone: '',
    address: '',
    balance: 0,
    notes: 'Flow supplier',
  }, 201);
  const suppliers = expectArray((await client.get('/api/suppliers')).suppliers, 'suppliers');
  const supplier = findByName(suppliers, supplierName);

  await client.post('/api/customers', {
    name: customerName,
    phone: '',
    address: '',
    balance: 0,
    type: 'cash',
    creditLimit: 0,
    storeCreditBalance: 0,
  }, 201);
  const customers = expectArray((await client.get('/api/customers')).customers, 'customers');
  const customer = findByName(customers, customerName);

  await client.post('/api/products', {
    name: productName,
    barcode: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    categoryId: Number(category.id),
    supplierId: Number(supplier.id),
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    minStock: 2,
    notes: 'Flow product',
    stock: 0,
    units: [
      {
        name: 'قطعة',
        multiplier: 1,
        barcode: '',
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ],
  }, 201);
  const products = expectArray((await client.get(`/api/products?q=${encodeURIComponent(productName)}`)).products, 'products');
  const product = findByName(products, productName);

  const locationName = `E2E Location ${suffix}`;
  const createLocationRes = await client.post('/api/settings/locations', {
    name: locationName,
    locationType: 'internal_warehouse',
  }, 201);
  const location = createLocationRes.location || createLocationRes;
  assert.ok(location?.id, 'at least one location must exist after creation');

  // The cash sale below requires an open cashier shift (Q1 shift gate:
  // POST /api/sales returns 400 OPEN_SHIFT_REQUIRED with no open shift
  // for the cashier). Open one at the sale's location first and assert
  // it opened, so the flow tests the sale instead of the gate. The same
  // open shift also covers the cash sale return below (cash refunds need
  // an open shift unless the caller is admin/super_admin).
  const openShiftRes = await client.post('/api/cashier-shifts/open', {
    openingCash: 0,
    locationId: Number(location.id),
    note: 'E2E commercial flow shift',
  }, 201);
  const openedShifts = expectArray(openShiftRes.cashierShifts, 'cashierShifts');
  const openedShift = openedShifts.find((shift) =>
    Number(shift.locationId) === Number(location.id) && shift.status === 'open');
  assert.ok(openedShift?.id, 'cashier shift must be open before the cash sale');

  const purchase = await client.post('/api/purchases', {
    locationId: Number(location.id),
    supplierId: Number(supplier.id),
    paymentType: 'cash',
    discount: 0,
    taxRate: 0,
    pricesIncludeTax: false,
    note: 'E2E purchase',
    items: [
      {
        productId: Number(product.id),
        qty: 5,
        cost: 10,
        name: productName,
        unitName: 'قطعة',
        unitMultiplier: 1,
      },
    ],
  }, 201);
  assert.equal(purchase.ok, true);
  assert.ok(purchase.purchase?.id, 'purchase response must include purchase');

  const sale = await client.post('/api/sales', {
    locationId: Number(location.id),
    customerId: Number(customer.id),
    paymentType: 'cash',
    paymentChannel: 'cash',
    discount: 0,
    taxRate: 0,
    pricesIncludeTax: false,
    note: 'E2E sale',
    items: [
      {
        productId: Number(product.id),
        qty: 2,
        price: 15,
        unitName: 'قطعة',
        unitMultiplier: 1,
        priceType: 'retail',
      },
    ],
    payments: [{ paymentChannel: 'cash', amount: 30 }],
  }, 201);
  assert.equal(sale.ok, true);
  assert.ok(sale.sale?.id, 'sale response must include sale');

  const saleReturn = await client.post('/api/returns', {
    type: 'sale',
    invoiceId: Number(sale.sale.id),
    settlementMode: 'refund',
    refundMethod: 'cash',
    note: 'E2E sale return',
    items: [{ productId: Number(product.id), productName, qty: 1 }],
  }, 201);
  assert.equal(saleReturn.ok, true);
  assert.ok(Array.isArray(saleReturn.createdIds) && saleReturn.createdIds.length >= 1, 'sale return must create rows');

  const purchaseReturn = await client.post('/api/returns', {
    type: 'purchase',
    invoiceId: Number(purchase.purchase.id),
    refundMethod: 'cash',
    note: 'E2E purchase return',
    items: [{ productId: Number(product.id), productName, qty: 1 }],
  }, 201);
  assert.equal(purchaseReturn.ok, true);
  assert.ok(Array.isArray(purchaseReturn.createdIds) && purchaseReturn.createdIds.length >= 1, 'purchase return must create rows');

  const inventoryReport = await client.get('/api/reports/inventory');
  assert.ok(inventoryReport.summary, 'inventory report must include summary');

  const summary = await client.get('/api/reports/summary');
  assert.ok(summary.sales && summary.purchases && summary.commercial, 'summary report must include financial sections');

  const dashboard = await client.get('/api/dashboard/overview');
  assert.ok(dashboard.summary, 'dashboard must include summary');

  const returnsPayload = await client.get('/api/returns');
  const returnsRows = expectArray(returnsPayload.returns, 'returns');
  assert.ok(returnsRows.length >= 2, 'returns list should include newly created returns');

  const treasury = await client.get('/api/treasury-transactions');
  assert.ok(treasury.summary, 'treasury transactions must include summary');

  const audit = await client.get('/api/audit-logs');
  assert.ok(audit.pagination, 'audit logs must include pagination');

  console.log('commercial-flows.e2e: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
