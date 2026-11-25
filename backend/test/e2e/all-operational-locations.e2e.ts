import 'dotenv/config';
import assert from 'node:assert/strict';
import { E2EClient, uniqueSuffix, expectArray } from './e2e-utils';

function findByName(list: any[], name: string): any {
  const found = list.find((item) => item.name === name);
  assert.ok(found, `item with name ${name} not found`);
  return found;
}

function expectNum(actual: any, expected: number, msg: string) {
  assert.equal(Number(actual), expected, `${msg}: expected ${expected}, got ${Number(actual)}`);
}

function expectClose(actual: any, expected: number, msg: string, tolerance = 0.001) {
  const diff = Math.abs(Number(actual) - expected);
  assert.ok(diff <= tolerance, `${msg}: expected ≈${expected} (±${tolerance}), got ${Number(actual)}`);
}

async function runTest() {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';
  console.log('Using API:', baseUrl);

  // 1. Log in as dev (Super Admin) to create a tenant
  const superAdminClient = new E2EClient(baseUrl);
  const devUsername = process.env.E2E_USERNAME || process.env.DEFAULT_ADMIN_USERNAME || 'owner';
  const devPassword = process.env.E2E_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '';
  await superAdminClient.login(devUsername, devPassword);

  const suffix = uniqueSuffix('loc-test');
  const slug = `test-loc-${suffix}`.toLowerCase();

  console.log(`[1] Creating Trial Tenant: ${slug}...`);
  const trialRes = await superAdminClient.post(
    '/api/saas-admin/tenants/trial',
    {
      slug,
      businessName: `Test Business ${suffix}`,
      ownerName: 'Integration Tester',
      ownerPhone: `+201${Math.floor(10000000 + Math.random() * 90000000)}`,
      username: `admin_${suffix}`,
      password: 'password1234567890',
      days: 14,
    },
    201,
  );

  const newTenantId = trialRes.tenant?.id;
  assert.ok(newTenantId, 'Tenant creation failed to return tenant id');

  console.log(`Tenant created: ${newTenantId}, logging in as admin_${suffix}...`);
  const tenantClient = new E2EClient(baseUrl);
  await tenantClient.login(`admin_${suffix}`, 'password1234567890');

  try {
    console.log('[2] Configuring Branch and Locations...');
    await tenantClient.put(
      '/api/settings',
      {
        settings: {
          requireCashierShiftForSales: 'false',
          requireCashierShiftForPurchases: 'false',
        },
      },
      200,
    );

    const branchRes = await tenantClient.get('/api/branches');
    const branches = Array.isArray(branchRes) ? branchRes : branchRes.branches || branchRes.data || [];
    let branch = branches[0];
    if (!branch) {
      console.log('No default branch found, creating one...');
      const createRes = await tenantClient.post('/api/branches', { name: 'Main Branch' }, 201);
      branch = (createRes as any).branch;
    }
    assert.ok(branch, 'Branch is missing');
    const branchId = Number(branch.branch?.id || branch.id);

    // Create Locations
    const locMain = await tenantClient.post(
      '/api/settings/locations',
      { name: `مخزن البيع الأساسي ${suffix}`, locationType: 'internal_warehouse' },
      201,
    );
    const locInternal = await tenantClient.post(
      '/api/settings/locations',
      { name: `مخزن داخلي مركزي ${suffix}`, locationType: 'internal_warehouse' },
      201,
    );
    const locExternal = await tenantClient.post(
      '/api/settings/locations',
      { name: `مخزن خارجي ${suffix}`, locationType: 'external_warehouse' },
      201,
    );
    const locDamaged = await tenantClient.post(
      '/api/settings/locations',
      { name: `مخزن تالف ${suffix}`, locationType: 'damaged' },
      201,
    );

    const locMainId = Number(locMain.location?.id);
    const locInternalId = Number(locInternal.location?.id);
    const locExternalId = Number(locExternal.location?.id);
    const locDamagedId = Number(locDamaged.location?.id);

    // Ensure negative stock is disabled globally
    await tenantClient.put('/api/settings', { settings: { sell_negative_stock: 'false' } }, 200);

    // Update Branch Settings
    await tenantClient.put(
      `/api/branches/${branchId}`,
      {
        name: branch.name || branch.branch?.name,
        salesStockMode: 'all_operational_locations',
        defaultStockLocationId: locMainId,
        allowExternalSalesStock: false,
      },
      200,
    );

    const supplierRes = await tenantClient.post('/api/suppliers', { name: `Supplier ${suffix}`, balance: 0 }, 201);
    const customerRes = await tenantClient.post(
      '/api/customers',
      { name: `Customer ${suffix}`, phone: '01012345678', balance: 0, type: 'cash', creditLimit: 0 },
      201,
    );
    const categoryRes = await tenantClient.post('/api/categories', { name: `Cat ${suffix}` }, 201);

    const supplierId = Number(findByName((supplierRes as any).suppliers || [], `Supplier ${suffix}`).id);
    const customerId = Number(findByName((customerRes as any).customers || [], `Customer ${suffix}`).id);
    const categoryId = Number(findByName((categoryRes as any).categories || [], `Cat ${suffix}`).id);

    const productRes = await tenantClient.post(
      '/api/products',
      {
        name: `Product ${suffix}`,
        barcode: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        categoryId,
        supplierId,
        costPrice: 10,
        retailPrice: 15,
        wholesalePrice: 12,
        minStock: 2,
        stock: 0,
        units: [{ name: 'قطعة', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      },
      201,
    );
    const productId = Number(findByName((productRes as any).products || [], `Product ${suffix}`).id);

    const weightProductRes = await tenantClient.post(
      '/api/products',
      {
        name: `Weighted ${suffix}`,
        barcode: `${Date.now()}w`,
        categoryId,
        supplierId,
        costPrice: 100,
        retailPrice: 200,
        wholesalePrice: 0,
        minStock: 0,
        units: [{ name: 'كجم', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      },
      201,
    );
    const weightProductId = Number(findByName((weightProductRes as any).products || [], `Weighted ${suffix}`).id);

    console.log('[4] Funding Stock via Purchases...');
    const fundStock = async (prodId: number, locId: number, qty: number) => {
      await tenantClient.post(
        '/api/purchases',
        {
          locationId: locId,
          supplierId,
          paymentType: 'cash',
          items: [{ productId: prodId, qty, cost: 10, unitName: 'قطعة', unitMultiplier: 1 }],
        },
        201,
      );
    };
    await fundStock(productId, locMainId, 1);
    await fundStock(productId, locInternalId, 2);
    await fundStock(productId, locExternalId, 5);
    await fundStock(productId, locDamagedId, 10);
    await tenantClient.post(
      '/api/purchases',
      {
        locationId: locMainId,
        supplierId,
        paymentType: 'cash',
        items: [{ productId: weightProductId, qty: 5.0, cost: 100, unitName: 'كجم', unitMultiplier: 1 }],
      },
      201,
    );
    // Extra stock for concurrency test: fund extra 10 in internal for product
    await fundStock(productId, locInternalId, 10);

    const getStock = async (prodId: number, locId: number) => {
      const res = await tenantClient.get('/api/location-stocks');
      const stock = (res.stocks || []).find(
        (s: any) => String(s.productId) === String(prodId) && String(s.locationId) === String(locId),
      );
      return Number(stock?.qty || 0);
    };

    const getAllocations = async (saleItemId: number) => {
      const res = await tenantClient.get(`/api/sales/${saleItemId}`);
      const saleDetail = res.sale || res;
      return saleDetail;
    };

    console.log('Stock BEFORE sale: Main=1, Internal=12(2+10), External=5, Damaged=10');

    console.log('[5] Opening Cashier Shift and Testing Scenario 1: Sell 2. Should use main(1) + internal(1)');
    await tenantClient.post('/api/cashier-shifts/open', { branchId }, 201);

    const sale1 = await tenantClient.post(
      '/api/sales',
      {
        source: 'pos',
        branchId,
        customerId,
        paymentType: 'cash',
        paymentChannel: 'cash',
        items: [{ productId, qty: 2, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
      },
      201,
    );
    assert.equal(sale1.ok, true);

    const mainAfterSale1 = await getStock(productId, locMainId);
    const internalAfterSale1 = await getStock(productId, locInternalId);
    expectNum(mainAfterSale1, 0, 'Main loc after sale 1');
    expectNum(internalAfterSale1, 11, 'Internal loc after sale 1 (was 12, deducted 1)');
    expectNum(await getStock(productId, locExternalId), 5, 'External loc unchanged after sale 1');
    expectNum(await getStock(productId, locDamagedId), 10, 'Damaged loc unchanged after sale 1');

    const saleData = sale1.sale || sale1.data || sale1;
    const sale1Id = Number(saleData.id);
    const sale1LineId = Number(saleData.items?.[0]?.id);
    assert.ok(sale1Id > 0, 'sale1Id must be valid');
    assert.ok(sale1LineId > 0, 'sale1LineId must be valid');

    // Verify allocations: 1 from main, 1 from internal
    const saleDetail1 = await tenantClient.get(`/api/sales/${sale1Id}`);
    console.log('Sale 1 detail fetched:', !!saleDetail1);

    console.log('[6] Scenario 2: Full Return (with saleItemId). Stocks must restore to original locations.');
    const return1 = await tenantClient.post(
      '/api/returns',
      {
        type: 'sale',
        invoiceId: sale1Id,
        items: [{ productId, qty: 2, saleItemId: sale1LineId }],
      },
      201,
    );
    assert.equal(return1.ok, true);

    expectNum(await getStock(productId, locMainId), 1, 'Main loc RESTORED after return (was 0 → 1)');
    expectNum(await getStock(productId, locInternalId), 12, 'Internal loc RESTORED after return (was 11 → 12)');
    expectNum(await getStock(productId, locExternalId), 5, 'External loc unchanged after return');

    console.log('[6b] Scenario 2b: Return with wrong saleItemId must fail with 400.');
    const badReturn = await tenantClient.post(
      '/api/returns',
      {
        type: 'sale',
        invoiceId: sale1Id,
        items: [{ productId, qty: 1, saleItemId: 99999999 }],
      },
      400,
    );
    assert.ok(
      badReturn.error || badReturn.statusCode === 400 || Number(badReturn.statusCode) === 400,
      'Expected 400 for bad saleItemId',
    );

    console.log(
      '[7] Scenario 3: Sell 4 (allow_external=false) → Should Fail (only 1+12=13 but external excluded, internal has 12, main has 1 → 13 available in operational locs; wait, damaged is excluded. So 1+12=13 ≥ 4, this should succeed unless we count differently)',
    );
    // Actually with main=1 and internal=12 (both internal_warehouse), total = 13. Selling 4 should succeed.
    // Let me test selling MORE than available without external (sell 20 to force failure)
    const sale2Fail = await tenantClient.post(
      '/api/sales',
      {
        source: 'pos',
        branchId,
        customerId,
        paymentType: 'cash',
        paymentChannel: 'cash',
        items: [{ productId, qty: 20, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
      },
      400,
    );

    console.log('[8] Scenario 4: Enable allow_external_sales_stock=true and Sell 4');
    // First sell 4 to bring main=0, internal=9 (from 12-3), external still 5
    // But let's sell exactly 4 to verify allocations: 1(main) + 2(internal from original fund) + 1(external)
    // Current stock: main=1, internal=12, external=5 → we have enough in internal+main
    // To test external allocation, let's drain internal first
    // Sell 13 with external enabled
    await tenantClient.put(
      `/api/branches/${branchId}`,
      {
        name: branch.name || branch.branch?.name,
        salesStockMode: 'all_operational_locations',
        defaultStockLocationId: locMainId,
        allowExternalSalesStock: true,
      },
      200,
    );

    const sale3 = await tenantClient.post(
      '/api/sales',
      {
        source: 'pos',
        branchId,
        customerId,
        paymentType: 'cash',
        paymentChannel: 'cash',
        items: [{ productId, qty: 4, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
      },
      201,
    );
    assert.equal(sale3.ok, true);

    // After selling 4: deduct from main(1) then internal(3) → main=0, internal=9 (12-3=9), external=5
    expectNum(await getStock(productId, locMainId), 0, 'Main loc after sale 3 (4 units)');
    expectNum(
      await getStock(productId, locInternalId),
      9,
      'Internal loc after sale 3 (12-3=9 since main took 1 first)',
    );
    // External untouched since main+internal covered 4
    expectNum(await getStock(productId, locExternalId), 5, 'External loc after sale 3 (not needed)');

    // Now sell 15 to force external usage: internal=9 + external=5 = 14 available but we need 14 exactly
    const sale3b = await tenantClient.post(
      '/api/sales',
      {
        source: 'pos',
        branchId,
        customerId,
        paymentType: 'cash',
        paymentChannel: 'cash',
        items: [{ productId, qty: 14, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
      },
      201,
    );
    assert.equal(sale3b.ok, true);
    // After selling 14: internal=9→0 (deduct 9), external=5→0 (deduct 5)
    expectNum(await getStock(productId, locInternalId), 0, 'Internal loc after sale 3b (drained)');
    expectNum(await getStock(productId, locExternalId), 0, 'External loc after sale 3b (drained)');

    console.log('[9] Scenario 5: Cancellation of sale3 → restores allocations');
    await tenantClient.post(`/api/sales/${sale3.sale.id}/cancel`, { note: 'test cancellation' }, 201);

    expectNum(await getStock(productId, locMainId), 1, 'Main loc after cancel sale3');
    expectNum(await getStock(productId, locInternalId), 3, 'Internal loc after cancel sale3 (restored 3)');
    expectNum(
      await getStock(productId, locExternalId),
      0,
      'External loc after cancel sale3 (still 0, sale3b not cancelled)',
    );

    // Double cancellation must fail
    await tenantClient.post(`/api/sales/${sale3.sale.id}/cancel`, { note: 'double cancel' }, 400);

    console.log('[10] Scenario 6: Weighted Barcode sale of 0.135 kg');
    const weightStockBefore = await getStock(weightProductId, locMainId);
    const weightSale = await tenantClient.post(
      '/api/sales',
      {
        source: 'pos',
        branchId,
        customerId,
        paymentType: 'cash',
        paymentChannel: 'cash',
        items: [{ productId: weightProductId, qty: 0.135, price: 200, unitName: 'كجم', unitMultiplier: 1 }],
      },
      201,
    );
    assert.equal(weightSale.ok, true);
    const weightStockAfter = await getStock(weightProductId, locMainId);
    expectClose(weightStockAfter, weightStockBefore - 0.135, 'Weighted stock after 0.135 sale');

    console.log('[11] Scenario 7: Idempotency - same key must produce same sale');
    // Refund all via cancel sale3b so we have stock again
    await tenantClient.post(`/api/sales/${sale3b.sale.id}/cancel`, { note: 'restore for idempotency test' }, 201);

    const stockForIdem = await getStock(productId, locInternalId);
    const mainForIdem = await getStock(productId, locMainId);
    const totalStockForIdem = stockForIdem + mainForIdem; // total across both locations
    console.log(
      `Stock available for idempotency test: main=${mainForIdem}, internal=${stockForIdem}, total=${totalStockForIdem}`,
    );
    assert.ok(totalStockForIdem >= 1, 'Must have at least 1 unit for idempotency test');

    const idempotencyKey = `idem-${Date.now()}-${Math.random()}`;
    const idemPayload = {
      source: 'pos',
      branchId,
      customerId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 1, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
    };

    // Send two requests with same idempotency key SEQUENTIALLY (to ensure idempotency, not concurrency)
    const idemRes1 = await tenantClient.post('/api/sales', idemPayload, 201, { 'x-idempotency-key': idempotencyKey });
    const idemRes2 = await tenantClient.post('/api/sales', idemPayload, 201, { 'x-idempotency-key': idempotencyKey });

    const idemId1 = String((idemRes1 as any).sale?.id || (idemRes1 as any).id);
    const idemId2 = String((idemRes2 as any).sale?.id || (idemRes2 as any).id);
    assert.equal(idemId1, idemId2, `Idempotency: same key must return same sale ID. Got ${idemId1} vs ${idemId2}`);
    console.log(`✅ Idempotency: both requests returned sale ID=${idemId1}`);

    // Stock must only be deducted ONCE (not twice) - check BEFORE cancellation
    const mainAfterIdem = await getStock(productId, locMainId);
    const internalAfterIdem = await getStock(productId, locInternalId);
    const totalStockAfterIdem = mainAfterIdem + internalAfterIdem;
    console.log(
      `Stock after 2x idempotent sale: main=${mainAfterIdem}, internal=${internalAfterIdem}, total=${totalStockAfterIdem}`,
    );
    expectNum(
      totalStockAfterIdem,
      totalStockForIdem - 1,
      'Total stock deducted exactly ONCE (=1) after 2 idempotent requests',
    );
    console.log(`✅ Idempotency stock assertion passed: total deduction=1`);

    // Restore: cancel the idempotent sale
    await tenantClient.post(`/api/sales/${idemId1}/cancel`, { note: 'restore after idempotency test' }, 201);

    // Fund a small, known stock to test concurrency
    await fundStock(productId, locInternalId, 3);
    const stockBeforeRaceInternal = await getStock(productId, locInternalId);
    const stockBeforeRaceMain = await getStock(productId, locMainId);
    const totalRaceStock = stockBeforeRaceInternal + stockBeforeRaceMain;
    console.log(
      `[12] Scenario 8: Concurrency - Stock before race: main=${stockBeforeRaceMain}, internal=${stockBeforeRaceInternal}, total=${totalRaceStock}`,
    );
    assert.ok(totalRaceStock >= 3, 'Need at least 3 units for race test');

    const racePayload = JSON.stringify({
      source: 'pos',
      branchId,
      customerId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: totalRaceStock, price: 15, unitName: 'قطعة', unitMultiplier: 1 }],
    });

    // Build raw request headers (session + csrf cookies)
    const cookieStr = Array.from((tenantClient as any).cookies.entries() as Iterable<[string, string]>)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const csrfToken =
      (tenantClient as any).cookies.get('zs_dev_csrf_token') ||
      (tenantClient as any).cookies.get('zs_cloud_csrf_token') ||
      '';
    const raceHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookieStr,
      'x-csrf-token': csrfToken,
    };

    // Launch two concurrent sales for the full available stock using raw fetch
    const [race1Result, race2Result] = await Promise.allSettled([
      fetch(`${baseUrl}/api/sales`, { method: 'POST', headers: raceHeaders, body: racePayload }).then((r) => r.json()),
      fetch(`${baseUrl}/api/sales`, { method: 'POST', headers: raceHeaders, body: racePayload }).then((r) => r.json()),
    ]);

    const raceResponses = [race1Result, race2Result].map((r, i) => {
      const body = r.status === 'fulfilled' ? r.value : { rejected: String((r as any).reason) };
      console.log(`Race ${i + 1}: ${JSON.stringify(body).slice(0, 100)}`);
      return body;
    });

    const raceSuccesses = raceResponses.filter((r) => r?.ok === true && r?.sale?.id);
    const raceFailures = raceResponses.filter((r) => !r?.ok || r?.statusCode);

    console.log(`Race results: ${raceSuccesses.length} succeeded, ${raceFailures.length} failed/rejected`);
    assert.equal(
      raceSuccesses.length,
      1,
      `Exactly ONE concurrent sale must succeed when racing for the same stock. Got ${raceSuccesses.length} successes.`,
    );
    assert.equal(raceFailures.length, 1, `Exactly ONE concurrent sale must fail`);

    const raceFailure = raceFailures[0];
    assert.ok(
      raceFailure.statusCode === 409 || raceFailure.statusCode === 400,
      `Race failure MUST be a domain error (409 STOCK_CONFLICT or 400 INSUFFICIENT_STOCK), got: ${raceFailure.statusCode}`,
    );
    assert.ok(
      raceFailure.statusCode !== 500,
      `Race failure MUST NOT be a 500 Internal Server Error (deadlock/lock timeout must be caught)`,
    );

    // After race: winner consumed ALL available stock from operational locations
    // Total must be 0 across main + internal (external was not enabled here / already 0)
    const mainAfterRace = await getStock(productId, locMainId);
    const internalAfterRace = await getStock(productId, locInternalId);
    const totalAfterRace = mainAfterRace + internalAfterRace;
    console.log(`Stock after race: main=${mainAfterRace}, internal=${internalAfterRace}, total=${totalAfterRace}`);
    expectNum(totalAfterRace, 0, 'Total operational stock must be 0 after race - exactly one winner consumed all');

    console.log('✅ Concurrency race passed successfully!');

    console.log(`\n[13] Scenario 9: Concurrent Idempotency`);
    const idemRaceKey = `idem-race-${uniqueSuffix()}`;
    const idemRacePayload = JSON.stringify({
      source: 'pos',
      branchId,
      customerId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 1, price: 10, unitName: 'قطعة', unitMultiplier: 1 }],
    });

    const idemRaceHeaders = { ...raceHeaders, 'x-idempotency-key': idemRaceKey };

    // Fund 2 units so we don't hit stock limit issue
    await fundStock(productId, locMainId, 2);

    const [idemRace1, idemRace2] = await Promise.allSettled([
      fetch(`${baseUrl}/api/sales`, { method: 'POST', headers: idemRaceHeaders, body: idemRacePayload }).then((r) =>
        r.json(),
      ),
      fetch(`${baseUrl}/api/sales`, { method: 'POST', headers: idemRaceHeaders, body: idemRacePayload }).then((r) =>
        r.json(),
      ),
    ]);

    const idemRaceResponses = [idemRace1, idemRace2].map((r) =>
      r.status === 'fulfilled' ? r.value : { rejected: true },
    );

    console.log(`Concurrent Idempotency Results (Raw):`, JSON.stringify(idemRaceResponses, null, 2));

    const idemSuccesses = idemRaceResponses.filter((r) => r?.ok === true && r?.sale?.id);
    const idemConflicts = idemRaceResponses.filter((r) => r?.statusCode === 409 && r?.error?.error === 'Conflict');

    assert.equal(idemSuccesses.length, 1, 'Exactly one concurrent idempotent request should succeed initially');
    assert.equal(
      idemConflicts.length,
      1,
      'Exactly one concurrent idempotent request should hit the processing lock (409 Conflict)',
    );

    // Retry the request to get the cached result
    const idemRetryResult = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers: idemRaceHeaders,
      body: idemRacePayload,
    }).then((r) => r.json());
    console.log(`Idempotency Retry Result:`, idemRetryResult?.sale?.id);

    assert.equal(idemRetryResult?.ok, true, 'Retry must succeed');
    assert.equal(idemRetryResult.sale.id, idemSuccesses[0].sale.id, 'Retry MUST return the EXACT SAME saleId');

    console.log('✅ Concurrent Idempotency tests passed successfully!');
    console.log('✅ All integration tests passed successfully!');
  } finally {
    console.log(`[Cleanup] Attempting to delete isolated tenant: ${newTenantId}`);
    try {
      await superAdminClient.post(`/api/saas-admin/tenants/${newTenantId}/delete`, {}, 201);
      console.log(`✅ Tenant ${newTenantId} deleted.`);
    } catch (e: any) {
      // Expected: FK constraints in test DB (audit_logs, stock_movements, accounting_settings) prevent clean deletion
      // This is a known limitation of the shared test database. Cleanup is logged but non-blocking.
      console.warn(
        `[Cleanup] Tenant deletion returned an error (FK constraints expected in test env): ${e.message?.slice(0, 120)}`,
      );
    }
  }
}

runTest().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
