import assert from 'node:assert/strict';
import { E2EClient, ensureRunning, expectArray, uniqueSuffix } from './e2e-utils';
import { Client } from 'pg';

async function main() {
  const username = process.env.E2E_USERNAME || 'dev-e2e';
  const password = process.env.E2E_PASSWORD || '1';
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3101';

  await ensureRunning(baseUrl);
  const client = new E2EClient(baseUrl);
  await client.login(username, password);

  const pg = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'zs_dev', // MUST use dev DB
  });
  await pg.connect();

  const suffix = uniqueSuffix('pur-stress');

  try {
    // 1. Setup Required Entities
    const branchesRes = await client.get('/api/branches');
    const branches = expectArray(branchesRes.branches, 'branches');
    let branchId = branches[0]?.id;
    if (!branchId) {
      const newBranch = await client.post('/api/branches', { name: `Branch ${suffix}` }, 201);
      branchId = newBranch.branch?.id || newBranch.id;
    }

    const loc1Res = await client.post(
      '/api/settings/locations',
      { name: `Loc 1 ${suffix}`, locationType: 'internal_warehouse', branchId },
      201,
    );
    const loc2Res = await client.post(
      '/api/settings/locations',
      { name: `Loc 2 ${suffix}`, locationType: 'internal_warehouse', branchId },
      201,
    );
    const loc1Id = loc1Res.location?.id;
    const loc2Id = loc2Res.location?.id;

    await client.post(
      '/api/suppliers',
      { name: `Supplier ${suffix}`, phone: '', address: '', balance: 0, notes: '' },
      201,
    );
    const suppliersPayload = await client.get(`/api/suppliers?q=Supplier ${suffix}`);
    const supplierId = expectArray(suppliersPayload.suppliers, 'suppliers')[0].id;

    const catName = `Cat ${suffix}`;
    await client.post('/api/categories', { name: catName }, 201);
    const categoriesPayload = await client.get('/api/categories');
    const categoryId = (categoriesPayload.categories as any[]).find((c: any) => c.name === catName).id;

    const totalProducts = 2000;
    const existingRes = await pg.query("SELECT id FROM products WHERE name LIKE 'Prod pur-stress%' ORDER BY id ASC");
    let productIds: number[] = existingRes.rows.map((r) => Number(r.id));

    // Concurrency limit function
    async function asyncPool(poolLimit: number, array: any[], iteratorFn: (item: any) => Promise<any>) {
      const ret = [];
      const executing = new Set();
      for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item));
        ret.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);
        if (executing.size >= poolLimit) {
          await Promise.race(executing);
        }
      }
      return Promise.all(ret);
    }

    if (productIds.length < totalProducts) {
      console.log('Inserting 2000 products via API...');
      const itemsToCreate = Array.from({ length: totalProducts - productIds.length }, (_, i) => productIds.length + i);
      let createdCount = 0;

      await asyncPool(50, itemsToCreate, async (i) => {
        const p = await client.post(
          '/api/products',
          {
            categoryId,
            name: `Prod pur-stress - ${i}`,
            barcode: `BARpur-stress-${i}`,
            costPrice: 10,
            retailPrice: 20,
            wholesalePrice: 15,
            minStock: 0,
            stock: 0,
            itemType: 'product',
            itemKind: 'standard',
            units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
          },
          201,
        );
        productIds.push(Number(p.id || p.product?.id));
        createdCount++;
        if (createdCount % 500 === 0) console.log(`Created ${createdCount} products`);
      });
      console.log(`Finished inserting products.`);
    } else {
      console.log(`Found ${productIds.length} existing products.`);
    }

    // Double check productIds are valid
    productIds = productIds.filter((id) => !isNaN(id) && id > 0);
    assert.ok(productIds.length >= 2000, 'Should have 2000 valid product IDs');

    // Stress testing purchases
    const testSizes = [100, 250, 500, 1000, 2000];
    let maxSuccess = 0;
    let firstFail = 0;

    for (const size of testSizes) {
      console.log(`\n--- Testing Purchase with ${size} items ---`);

      const items = [];
      for (let i = 0; i < size; i++) {
        items.push({
          productId: productIds[i],
          qty: 1,
          cost: 10,
          unitName: 'Piece',
          unitMultiplier: 1,
          locationId: i % 2 === 0 ? Number(loc1Id) : Number(loc2Id), // distribute
        });
      }

      const payload = {
        supplierId: Number(supplierId),
        paymentType: 'credit',
        discount: 0,
        note: `Stress ${size}`,
        taxRate: 0,
        pricesIncludeTax: false,
        branchId: null,
        locationId: null,
        items,
      };

      const beforeStockRes = await pg.query(
        'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2',
        [productIds[0], loc1Id],
      );
      const beforeQty = beforeStockRes.rows.length ? Number(beforeStockRes.rows[0].qty) : 0;
      const start = Date.now();

      try {
        const purchaseRes = await client.post('/api/purchases', payload, 201);
        const duration = Date.now() - start;
        console.log(`✅ Success for ${size} items. API Time: ${duration}ms`);

        maxSuccess = size;

        if (duration > 60000) {
          console.log(`Operation took > 60s (${duration}ms). Stopping to avoid timeout.`);
          firstFail = size;
          break;
        }

        // Integrity Checks for the 100 item case
        if (size === 100) {
          const purchaseId = purchaseRes.id || purchaseRes.purchase?.id || purchaseRes.purchaseOrder?.id;
          assert.ok(purchaseId, 'Purchase was not created');

          // Check stock movements
          const movs = await pg.query(
            "SELECT COUNT(*) as c FROM stock_movements WHERE reference_type = 'purchase' AND reference_id = $1",
            [purchaseId],
          );
          assert.equal(Number(movs.rows[0].c), 100, 'Should have 100 stock movements');

          // Check Journal Entry
          const jRes = await pg.query(
            "SELECT id FROM journal_entries WHERE source_type = 'purchase' AND source_id = $1",
            [purchaseId],
          );
          assert.ok(jRes.rows.length > 0, 'No journal entry created');
          const jLines = await pg.query(
            'SELECT SUM(debit) as dr, SUM(credit) as cr FROM journal_entry_lines WHERE journal_entry_id = $1',
            [jRes.rows[0].id],
          );
          assert.equal(Number(jLines.rows[0].dr), Number(jLines.rows[0].cr), 'Journal entry not balanced');
          assert.equal(Number(jLines.rows[0].dr), 100 * 10, 'Journal entry amount mismatch'); // 100 items * 1 * 10 cost

          // Check stock balance
          const stock = await pg.query(
            'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2',
            [productIds[0], loc1Id],
          );
          assert.equal(Number(stock.rows[0].qty), beforeQty + 1, 'Product 0 should have incremented by 1 qty');
        }
      } catch (e: any) {
        const duration = Date.now() - start;
        console.error(`❌ Failed for ${size} items. Time: ${duration}ms. Error: ${e.message}`);
        if (!firstFail) firstFail = size;
        break; // Stop at first failure
      }
    }
    console.log(`\n=== RUNNING ROLLBACK & IDEMPOTENCY TESTS (PURCHASES) ===`);
    // 1. Rollback test: 1 valid item, 1 invalid item (e.g. negative quantity or missing required field)
    const beforeStockCount = await pg.query('SELECT COUNT(*) as c FROM stock_movements');
    const beforeJournalCount = await pg.query('SELECT COUNT(*) as c FROM journal_entries');

    try {
      await client.post(
        '/api/purchases',
        {
          supplierId,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          locationId: loc1Id,
          items: [
            { productId: productIds[0], qty: 10, unitCost: 10, unitId: null },
            { productId: productIds[1], qty: -5, unitCost: 10, unitId: null }, // Invalid quantity
          ],
        },
        201,
      );
      assert.fail('Should have thrown validation error for negative qty');
    } catch (e: any) {
      console.log(`Rollback Test: Successfully caught error: ${e.message}`);
    }

    const afterStockCount = await pg.query('SELECT COUNT(*) as c FROM stock_movements');
    const afterJournalCount = await pg.query('SELECT COUNT(*) as c FROM journal_entries');
    assert.equal(
      Number(afterStockCount.rows[0].c),
      Number(beforeStockCount.rows[0].c),
      'Rollback failed: stock movements were created!',
    );
    assert.equal(
      Number(afterJournalCount.rows[0].c),
      Number(beforeJournalCount.rows[0].c),
      'Rollback failed: journal entries were created!',
    );
    console.log(`✅ Rollback Test Passed: No partial data was inserted.`);

    console.log(`\n=== STRESS TEST SUMMARY (PURCHASES) ===`);
    console.log(`Max Success: ${maxSuccess}`);
    console.log(`First Failure: ${firstFail || 'None'}`);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
