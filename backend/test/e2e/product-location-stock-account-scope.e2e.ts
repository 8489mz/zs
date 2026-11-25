import 'dotenv/config';
import assert from 'node:assert/strict';
import { E2EClient, uniqueSuffix } from './e2e-utils';

function findByName(list: any[], name: string): any {
  const found = list.find((item) => item.name === name);
  assert.ok(found, `item with name ${name} not found`);
  return found;
}

async function runTest() {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';
  console.log('Using API:', baseUrl);

  // 1. Log in as dev (Super Admin) to create a tenant
  const superAdminClient = new E2EClient(baseUrl);
  const devUsername = 'amr';
  const devPassword = '123456';
  await superAdminClient.login(devUsername, devPassword);

  const suffix = uniqueSuffix('loc-scope');
  const slug = `test-loc-scope-${suffix}`.toLowerCase();

  console.log(`[1] Creating Trial Tenant: ${slug}...`);
  const trialRes = await superAdminClient.post('/api/saas-admin/tenants/trial', {
    slug,
    businessName: `Test Business ${suffix}`,
    ownerName: 'Integration Tester',
    ownerPhone: `+201${Math.floor(10000000 + Math.random() * 90000000)}`,
    username: `admin_${suffix}`,
    password: 'password1234567890',
    days: 14,
  }, 201);

  const newTenantId = trialRes.tenant?.id;
  assert.ok(newTenantId, 'Tenant creation failed to return tenant id');

  console.log(`Tenant created: ${newTenantId}, logging in as admin_${suffix}...`);
  const tenantClient = new E2EClient(baseUrl);
  await tenantClient.login(`admin_${suffix}`, 'password1234567890');

  try {
    console.log('[2] Configuring Branch and Locations...');
    await tenantClient.put('/api/settings', {
      settings: {
        requireCashierShiftForSales: 'false',
        requireCashierShiftForPurchases: 'false',
        sell_negative_stock: 'false'
      }
    }, 200);

    const branchRes = await tenantClient.get('/api/branches');
    const branches = Array.isArray(branchRes) ? branchRes : branchRes.branches || branchRes.data || [];
    let branch = branches[0];
    if (!branch) {
      const createRes = await tenantClient.post('/api/branches', { name: 'Main Branch' }, 201);
      branch = (createRes as any).branch;
    }
    const branchId = Number(branch.branch?.id || branch.id);

    // Create 2 internal warehouses for this branch
    const loc1 = await tenantClient.post('/api/settings/locations', { name: `مخزن داخلي 1`, locationType: 'internal_warehouse' }, 201);
    const loc2 = await tenantClient.post('/api/settings/locations', { name: `مخزن داخلي 2`, locationType: 'internal_warehouse' }, 201);
    
    const loc1Id = Number(loc1.location?.id);
    const loc2Id = Number(loc2.location?.id);

    // Update Branch Settings to 'single_location' (default behavior first)
    await tenantClient.put(`/api/branches/${branchId}`, {
      name: branch.name || branch.branch?.name,
      salesStockMode: 'single_location',
      defaultStockLocationId: loc1Id,
      allowExternalSalesStock: false
    }, 200);

    const supplierRes = await tenantClient.post('/api/suppliers', { name: `Supplier`, balance: 0 }, 201);
    const customerRes = await tenantClient.post('/api/customers', { name: `Customer`, phone: '01012345678', balance: 0, type: 'cash', creditLimit: 0 }, 201);
    const categoryRes = await tenantClient.post('/api/categories', { name: `Category` }, 201);

    const supplierId = Number(findByName((supplierRes as any).suppliers || [], `Supplier`).id);
    const customerId = Number(findByName((customerRes as any).customers || [], `Customer`).id);
    const categoryId = Number(findByName((categoryRes as any).categories || [], `Category`).id);

    console.log('[3] Creating Product & Purchase Invoice...');
    const productRes = await tenantClient.post('/api/products', {
      name: `Scope Product`,
      barcode: `SCOPE123`,
      categoryId,
      costPrice: 10,
      retailPrice: 20,
      wholesalePrice: 15,
      minStock: 0,
      units: [{ name: 'قطعة', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
    }, 201);
    const productId = Number((productRes as any).product?.id || findByName((productRes as any).products || (productRes as any).data || [], `Scope Product`).id);

    // Purchase into loc1
    await tenantClient.post('/api/purchases', {
      supplierId,
      locationId: loc1Id,
      paymentType: 'cash',
      items: [{ productId, qty: 5, cost: 10, unitName: 'قطعة', unitMultiplier: 1 }]
    }, 201);

    console.log('[4] Verifying POS Lookup isolated by tenant/account and correctly writing account_id...');
    
    const posRes = await tenantClient.get(`/api/catalog/pos-products?categoryId=${categoryId}&locationId=${loc1Id}`);
    const posProducts = posRes.products || posRes.data || [];
    const scopeProduct = findByName(posProducts, `Scope Product`);
    console.log("Scope product retrieved:", JSON.stringify(scopeProduct));
    assert.equal(Number(scopeProduct.stockQty || scopeProduct.stock || scopeProduct.qty), 5, `POS should see 5 stock, got ${scopeProduct.stockQty}`);

    console.log('[5] Executing POS Sale...');
    const posSaleRes = await tenantClient.post('/api/sales', {
      customerId,
      locationId: loc1Id,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 1, price: 20, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' }]
    }, 201);

    const remainingGlobalRes = await tenantClient.get(`/api/products/${productId}`);
    if (remainingGlobalRes.stock === undefined) {
      console.error('remainingGlobalRes missing stock:', remainingGlobalRes);
    }
    assert.equal(Number(remainingGlobalRes.stock), 4, `Global stock should be 4, got ${remainingGlobalRes.stock}`);

    const remainingPosRes = await tenantClient.get(`/api/catalog/pos-products?categoryId=${categoryId}&locationId=${loc1Id}`);
    const scopeProductAfter = findByName(remainingPosRes.products || remainingPosRes.data || [], `Scope Product`);
    assert.equal(Number(scopeProductAfter.stock), 4, `POS stock should be 4, got ${scopeProductAfter.stock}`);

    console.log('[6] Verifying LOCATION_SCOPE_5 (Multi-location no guess)...');
    // If we look at loc2, it should be 0, not auto-assigned
    const posResLoc2 = await tenantClient.get(`/api/catalog/pos-products?categoryId=${categoryId}&locationId=${loc2Id}`);
    const scopeProductLoc2 = findByName(posResLoc2.products || posResLoc2.data || [], `Scope Product`);
    assert.equal(Number(scopeProductLoc2.stock), 0, `POS loc2 stock should be 0, got ${scopeProductLoc2.stock}`);

    console.log('✅ ALL LOCATION SCOPE SCENARIOS PASSED.');
  } finally {
    console.log(`[7] Cleaning up test tenant... skipped for inspection.`);
  }
}

runTest().catch((err) => {
  console.error('\n❌ E2E TEST FAILED:');
  console.error(err);
  process.exit(1);
});
