import assert from 'node:assert/strict';
import { E2EClient, ensureRunning, expectArray, uniqueSuffix } from './e2e-utils';

async function main() {
  const username = process.env.E2E_USERNAME || 'dev-e2e';
  const password = process.env.E2E_PASSWORD || '1';
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';

  const parsedUrl = new URL(baseUrl);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const isLocal = allowedHosts.has(parsedUrl.hostname);

  if (!isLocal && process.env.E2E_ALLOW_REMOTE !== 'true') {
    console.error(
      'Safety Guard: E2E tests are not allowed to run against remote environments to prevent accidental data loss. Use E2E_ALLOW_REMOTE=true to override.',
    );
    process.exit(1);
  }

  await ensureRunning(baseUrl);
  const client = new E2EClient(baseUrl);
  await client.login(username, password);

  const suffix = uniqueSuffix('multi-loc');
  const supplierName = `E2E Supplier ${suffix}`;
  const productName1 = `E2E Prod1 ${suffix}`;
  const productName2 = `E2E Prod2 ${suffix}`;

  let branchId: string | undefined;
  let loc1Id: string | undefined;
  let loc2Id: string | undefined;
  let supplierId: string | undefined;
  let p1Id: string | undefined;
  let p2Id: string | undefined;
  let purchaseId: string | undefined;

  try {
    // 1. Get branches
    const branchesRes = await client.get('/api/branches');
    const branches = expectArray(branchesRes.branches, 'branches');
    branchId = branches[0]?.id;
    if (!branchId) {
      const newBranch = await client.post('/api/branches', { name: `E2E Branch ${suffix}` }, 201);
      branchId = newBranch.branch?.id || newBranch.id;
    }
    assert.ok(branchId, 'Must have at least one branch');

    // 2. Create two locations
    const loc1 = await client.post(
      '/api/settings/locations',
      { name: `Loc 1 ${suffix}`, locationType: 'internal_warehouse', branchId },
      201,
    );
    const loc2 = await client.post(
      '/api/settings/locations',
      { name: `Loc 2 ${suffix}`, locationType: 'internal_warehouse', branchId },
      201,
    );
    loc1Id = loc1.location?.id;
    loc2Id = loc2.location?.id;
    assert.ok(loc1Id, 'loc1Id is missing');
    assert.ok(loc2Id, 'loc2Id is missing');

    // 3. Create a supplier
    const createdSupplier = await client.post(
      '/api/suppliers',
      {
        name: supplierName,
        phone: '',
        address: '',
        balance: 0,
        notes: 'Multi loc supplier',
      },
      201,
    );
    supplierId = String(createdSupplier?.id || createdSupplier?.supplier?.id || '');
    if (!supplierId || supplierId === 'undefined') {
      const suppliersPayload = await client.get(`/api/suppliers?q=${encodeURIComponent(supplierName)}`);
      const suppliersList = expectArray(suppliersPayload.suppliers, 'suppliers');
      supplierId = String(suppliersList.find((s: any) => s.name === supplierName)?.id);
    }
    assert.ok(supplierId && supplierId !== 'undefined', 'supplierId is missing');

    // 4. Create two products (no default category or location)
    const productPayload = {
      barcode: '',
      itemType: 'product',
      itemKind: 'standard',
      costPrice: 50,
      retailPrice: 100,
      wholesalePrice: 100,
      minStock: 0,
      stock: 0,
      units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
    };
    await client.post('/api/products', { name: productName1, ...productPayload }, 201);
    await client.post('/api/products', { name: productName2, ...productPayload }, 201);

    const p1Payload = await client.get(`/api/products?q=${encodeURIComponent(productName1)}`);
    const p2Payload = await client.get(`/api/products?q=${encodeURIComponent(productName2)}`);
    p1Id = String(expectArray(p1Payload.products, 'products').find((p: any) => p.name === productName1)?.id);
    p2Id = String(expectArray(p2Payload.products, 'products').find((p: any) => p.name === productName2)?.id);

    assert.ok(p1Id !== 'undefined', 'p1Id is missing');
    assert.ok(p2Id !== 'undefined', 'p2Id is missing');

    // 5. Create a Purchase Order with lines in different locations
    const purchasePayload = {
      supplierId: Number(supplierId),
      paymentType: 'credit',
      discount: 0,
      note: 'Multi location test',
      taxRate: 0,
      pricesIncludeTax: false,
      branchId: null,
      locationId: null, // NO HEADER LOCATION
      items: [
        {
          productId: Number(p1Id),
          qty: 10,
          cost: 50,
          unitName: 'Piece',
          unitMultiplier: 1,
          locationId: Number(loc1Id), // Line 1 targets Loc 1
        },
        {
          productId: Number(p2Id),
          qty: 20,
          cost: 50,
          unitName: 'Piece',
          unitMultiplier: 1,
          locationId: Number(loc2Id), // Line 2 targets Loc 2
        },
      ],
    };

    const purchaseRes = await client.post('/api/purchases', purchasePayload, 201);
    console.log('Purchase response:', JSON.stringify(purchaseRes));
    purchaseId = purchaseRes.id || purchaseRes.purchase?.id || purchaseRes.purchaseOrder?.id;
    assert.ok(purchaseId, 'Purchase was not created');

    // 7. Verify stock
    const allStockRes = await client.get(`/api/location-stocks`);
    const allStock = expectArray(allStockRes.stocks || allStockRes.data || allStockRes, 'allStock');
    const stock1 = allStock.filter((s: any) => String(s.productId || s.product_id) === String(p1Id));
    const stock2 = allStock.filter((s: any) => String(s.productId || s.product_id) === String(p2Id));

    const stock1Loc1 = stock1.find((s: any) => String(s.locationId || s.location_id) === String(loc1Id));
    const stock1Loc2 = stock1.find((s: any) => String(s.locationId || s.location_id) === String(loc2Id));

    assert.equal(stock1Loc1?.qty, 10, 'Product 1 stock in Loc 1 must be 10');
    assert.ok(!stock1Loc2 || stock1Loc2.qty === 0, 'Product 1 stock in Loc 2 must be 0 or undefined');

    const stock2Loc1 = stock2.find((s: any) => String(s.locationId || s.location_id) === String(loc1Id));
    const stock2Loc2 = stock2.find((s: any) => String(s.locationId || s.location_id) === String(loc2Id));

    assert.equal(stock2Loc2?.qty, 20, 'Product 2 stock in Loc 2 must be 20');
    assert.ok(!stock2Loc1 || stock2Loc1.qty === 0, 'Product 2 stock in Loc 1 must be 0 or undefined');

    console.log('purchase-multi-location.e2e: ok');
  } finally {
    // Cleanup
    const del = async (path: string) => {
      try {
        await client.del(path);
      } catch (e) {
        // ignore cleanup errors
      }
    };
    if (purchaseId) await del(`/api/purchases/${purchaseId}`);
    if (p1Id) await del(`/api/products/${p1Id}`);
    if (p2Id) await del(`/api/products/${p2Id}`);
    if (supplierId) await del(`/api/suppliers/${supplierId}`);
    if (loc1Id) await del(`/api/settings/locations/${loc1Id}`);
    if (loc2Id) await del(`/api/settings/locations/${loc2Id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
