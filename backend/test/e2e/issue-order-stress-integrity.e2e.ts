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

  const suffix = uniqueSuffix('iss-stress');

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

    const catName = `Cat ${suffix}`;
    await client.post('/api/categories', { name: catName }, 201);
    const categoriesPayload = await client.get('/api/categories');
    const categoryId = (categoriesPayload.categories as any[]).find((c: any) => c.name === catName).id;
    const totalProducts = 2000;
    const existingRes = await pg.query(
      "SELECT id FROM products WHERE name LIKE 'ProdIss issue-stress%' ORDER BY id ASC",
    );
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
      console.log('Inserting 2000 products for issue order test via API...');
      const itemsToCreate = Array.from({ length: totalProducts - productIds.length }, (_, i) => productIds.length + i);
      let createdCount = 0;

      await asyncPool(50, itemsToCreate, async (i) => {
        const p = await client.post(
          '/api/products',
          {
            categoryId,
            name: `ProdIss issue-stress - ${i}`,
            barcode: `BARIissue-stress-${i}`,
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

    // 3. Add initial stock via direct SQL for speed (since we already tested purchase integrity)
    // We add 10,000 qty to loc1 and loc2 for each product
    let stockValues = [];
    let stockParams = [];
    let sIdx = 1;
    for (const pid of productIds) {
      stockValues.push(`('default', 'default', $${sIdx++}, $${sIdx++}, 10000)`);
      stockParams.push(pid);
      stockParams.push(loc1Id);

      stockValues.push(`('default', 'default', $${sIdx++}, $${sIdx++}, 10000)`);
      stockParams.push(pid);
      stockParams.push(loc2Id);

      if (stockValues.length >= 1000) {
        await pg.query(
          `
          INSERT INTO product_location_stock (tenant_id, account_id, product_id, location_id, qty)
          VALUES ${stockValues.join(',')}
          ON CONFLICT ON CONSTRAINT product_location_stock_pkey 
          DO UPDATE SET qty = EXCLUDED.qty
        `,
          stockParams,
        );
        stockValues = [];
        stockParams = [];
        sIdx = 1;
      }
    }

    if (stockValues.length > 0) {
      await pg.query(
        `
        INSERT INTO product_location_stock (tenant_id, account_id, product_id, location_id, qty)
        VALUES ${stockValues.join(',')}
        ON CONFLICT ON CONSTRAINT product_location_stock_pkey 
        DO UPDATE SET qty = EXCLUDED.qty
      `,
        stockParams,
      );
    }

    // Also update global stock on products table
    await pg.query(`UPDATE products SET stock_qty = 20000 WHERE id = ANY($1::int[])`, [productIds]);

    console.log(`Added initial stock for all products.`);

    // 4. Stress testing Issue Orders (Stock Transfers)
    const testSizes = [100, 250, 500, 1000, 2000];
    let maxSuccess = 0;
    let firstFail = 0;

    for (const size of testSizes) {
      console.log(`\n--- Testing Issue Order with ${size} items ---`);

      const items = [];
      for (let i = 0; i < size; i++) {
        items.push({
          productId: productIds[i],
          qty: 1,
        });
      }

      const payload = {
        fromLocationId: Number(loc1Id),
        toLocationId: Number(loc2Id),
        items,
      };

      const start = Date.now();
      try {
        const transferRes = await client.post('/api/stock-transfers', payload, 201);
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
          // Check stock movements (deducted from loc1)
          const transferId = transferRes.transferId || transferRes.id || transferRes.transfer?.id;
          const movs = await pg.query(
            "SELECT COUNT(*) as c FROM stock_movements WHERE reference_type = 'transfer' AND reference_id = $1",
            [transferId],
          );
          // It creates TWO movements per item (send from loc1, receive in loc2)
          assert.equal(Number(movs.rows[0].c), 200, 'Should have 200 stock movements (send + receive)');

          // Test missing stock rollback:
          try {
            // Create one with 99999 qty for the first item
            await client.post(
              '/api/stock-transfers',
              {
                fromLocationId: Number(loc1Id),
                toLocationId: Number(loc2Id),
                items: [
                  ...items.slice(0, 99),
                  { productId: productIds[99], qty: 99999 }, // this will fail
                ],
              },
              409,
            );
            console.log('✅ Rollback/Failure on missing stock worked.');
          } catch (e) {
            throw new Error('Missing stock did not rollback correctly: ' + e);
          }
        }
      } catch (e: any) {
        const duration = Date.now() - start;
        console.error(`❌ Failed for ${size} items. Time: ${duration}ms. Error: ${e.message}`);
        if (!firstFail) firstFail = size;
        break; // Stop at first failure
      }
    }

    console.log(`\n=== STRESS TEST SUMMARY (ISSUE ORDERS) ===`);
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
