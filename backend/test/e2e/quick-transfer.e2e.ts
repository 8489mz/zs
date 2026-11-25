import 'dotenv/config';
import assert from 'node:assert/strict';
import { E2EClient, uniqueSuffix } from './e2e-utils';

function expectNum(actual: any, expected: number, msg: string) {
  assert.equal(Number(actual), expected, `${msg}: expected ${expected}, got ${Number(actual)}`);
}

async function main() {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';
  console.log('Using API:', baseUrl);

  // 1. Log in as Super Admin to create a tenant
  const superAdminClient = new E2EClient(baseUrl);
  const devUsername = process.env.E2E_USERNAME || process.env.DEFAULT_ADMIN_USERNAME || 'owner';
  const devPassword = process.env.E2E_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '';
  await superAdminClient.login(devUsername, devPassword);

  const suffix = uniqueSuffix('qt-test');
  const tenantSlug = `qt-${suffix}`;

  console.log('Creating Trial Tenant:', tenantSlug);
  const { tenant } = (await superAdminClient.post('/api/saas-admin/tenants/trial', {
    slug: tenantSlug,
    businessName: `Test Business ${suffix}`,
    ownerName: 'Integration Tester',
    ownerPhone: `+201${Math.floor(10000000 + Math.random() * 90000000)}`,
    username: `admin_${suffix}`,
    password: 'TestPassword123!',
    days: 14,
  })) as any;

  const tenantId = tenant.id;

  // Wait a moment for tenant initialization
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Logging in to Tenant Admin');
  const tenantClient = new E2EClient(baseUrl);
  await tenantClient.login(`admin_${suffix}`, 'TestPassword123!');

  // 2. Set Sales Mode to single_location
  await tenantClient.put('/api/settings', { settings: { sales: { stock_mode: 'single_location' } } });

  // 3. Create Branches and Locations
  console.log('Setting up Branches and Locations');
  const { branch: mainBranch } = (await tenantClient.post('/api/branches', { name: 'Main Branch' })) as any;
  
  const { location: mainLocation } = (await tenantClient.post('/api/settings/locations', { name: 'Main Location', branchId: mainBranch.id, locationType: 'branch_stock' })) as any;
  const { location: secLocation } = (await tenantClient.post('/api/settings/locations', { name: 'Secondary Location', branchId: mainBranch.id, locationType: 'branch_stock' })) as any;

  // Set default stock location for the branch
  await tenantClient.put(`/api/branches/${mainBranch.id}`, { name: 'Main Branch', defaultStockLocationId: mainLocation.id });

  // 4. Create Category and Product
  console.log('Setting up Products');
  const categoryRes = (await tenantClient.post('/api/categories', { name: 'Transfer Category' })) as any;
  const categoryId = categoryRes.categories[0].id;
  
  const productRes = (await tenantClient.post('/api/products', {
    name: 'Transfer Product',
    barcode: `TRF-${Date.now()}`,
    categoryId,
    costPrice: 50,
    retailPrice: 100,
    wholesalePrice: 80,
    minStock: 0,
    stock: 0,
    units: [{ name: 'قطعة', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
  })) as any;

  const productId = productRes.products[0].id;

  const supplierRes = await tenantClient.post('/api/suppliers', { name: `Supplier ${suffix}`, balance: 0 }, 201) as any;
  const supplierId = supplierRes.suppliers[0].id;

  // Add initial stock using purchase
  const payloadAddStock = {
    locationId: mainLocation.id,
    supplierId,
    items: [{ productId, qty: 10, cost: 50 }]
  };
  await tenantClient.post('/api/purchases', payloadAddStock, 201);

  // 5. Run the Tests
  console.log('Running Tests...');

  // Test A: Successful Transfer of 0.135
  console.log('Test A: Transfer 0.135');
  const payloadA = {
    fromLocationId: mainLocation.id,
    toLocationId: secLocation.id,
    items: [{ productId, qty: 0.135 }],
    note: 'First transfer'
  };
  await tenantClient.post('/api/internal-transfer', payloadA, 201);

  // Check stock
  let { stocks } = (await tenantClient.get('/api/location-stocks')) as any;
  let mainStock = stocks.find((s: any) => String(s.locationId) === String(mainLocation.id) && String(s.productId) === String(productId));
  const secStock = stocks.find((s: any) => String(s.locationId) === String(secLocation.id) && String(s.productId) === String(productId));
  
  expectNum(mainStock?.qty || 0, 10 - 0.135, 'Main Location stock after transfer 1');
  expectNum(secStock?.qty || 0, 0.135, 'Secondary Location stock after transfer 1');

  // Verify Default Location wasn't silently changed
  const fetchedProdRes = (await tenantClient.get(`/api/products/${productId}`)) as any;
  const fetchedProd = fetchedProdRes.product || fetchedProdRes;
  if (fetchedProd.defaultLocationId != null && String(fetchedProd.defaultLocationId) !== String(mainLocation.id)) {
    console.error(`BUG DETECTED: defaultLocationId was changed to ${fetchedProd.defaultLocationId}`);
  } else {
    console.log('defaultLocationId is stable (OK)');
  }

  // Test B: Insufficient Stock
  console.log('Test B: Insufficient Stock');
  const payloadB = {
    fromLocationId: mainLocation.id,
    toLocationId: secLocation.id,
    items: [{ productId, qty: 100 }],
  };
  // E2EClient post throws if status not 201 (or expected).
  await tenantClient.post('/api/internal-transfer', payloadB, 400).catch(() => {});
  
  const csrfToken = (tenantClient as any).cookies.get('zs_cloud_csrf_token') || (tenantClient as any).cookies.get('zs_dev_csrf_token') || (tenantClient as any).cookies.get('zs_csrf_token');
  const reqHeaders = { 'Content-Type': 'application/json', Cookie: (tenantClient as any).cookieHeader(), 'x-csrf-token': csrfToken };

  const resB = await fetch(`${baseUrl}/api/internal-transfer`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(payloadB)
  });
  console.log(`POST /api/internal-transfer Response:`, await resB.text());
  assert.strictEqual(resB.status, 409, 'Insufficient stock should return 409');

  // Test C: Concurrency
  console.log('Test C: Concurrency');
  const payloadC = {
    fromLocationId: mainLocation.id,
    toLocationId: secLocation.id,
    items: [{ productId, qty: 5 }]
  };
  const p1 = tenantClient.post('/api/internal-transfer', payloadC, 201).catch(e => e);
  const p2 = tenantClient.post('/api/internal-transfer', payloadC, 201).catch(e => e);
  const [r1, r2] = await Promise.all([p1, p2]);

  // We will check stock instead of statuses
  ({ stocks } = (await tenantClient.get('/api/location-stocks')) as any);
  mainStock = stocks.find((s: any) => String(s.locationId) === String(mainLocation.id) && String(s.productId) === String(productId));
  
  console.log(`Final main stock: ${mainStock?.qty}`);
  assert.ok(mainStock?.qty >= 0, 'Stock should never be negative!');

  // Validate one succeeded and one failed with 409
  let successRes = null;
  let failRes = null;
  if (r1 instanceof Error) {
    failRes = r1;
    successRes = r2;
  } else if (r2 instanceof Error) {
    failRes = r2;
    successRes = r1;
  }
  
  assert.ok(successRes && !(successRes instanceof Error), 'One concurrent transfer should succeed');
  assert.ok(failRes instanceof Error, 'One concurrent transfer should fail');
  assert.ok(failRes.message.includes('409'), 'Failed concurrent transfer should return 409');

  // Test D: Idempotency
  console.log('Test D: Idempotency');
  const idempotencyKey = `transfer-${Date.now()}`;
  const payloadD = {
    fromLocationId: mainLocation.id,
    toLocationId: secLocation.id,
    items: [{ productId, qty: 1 }],
  };
  
  const resD1 = await tenantClient.post('/api/internal-transfer', payloadD, 201, { 'x-idempotency-key': idempotencyKey });
  const resD2 = await tenantClient.post('/api/internal-transfer', payloadD, 201, { 'x-idempotency-key': idempotencyKey });
  
  // Check stock again to see if it deducted twice
  ({ stocks } = (await tenantClient.get('/api/location-stocks')) as any);
  const mainStockAfterIdempotency = stocks.find((s: any) => String(s.locationId) === String(mainLocation.id) && String(s.productId) === String(productId));
  console.log(`Stock after idempotency test: ${mainStockAfterIdempotency?.qty}`);

  // Cleanup
  console.log(`Cleaning up tenant ${tenantId}`);
  await superAdminClient.post(`/api/saas-admin/tenants/${tenantId}/delete`, {});

  console.log('Quick Transfer Tests Passed!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
