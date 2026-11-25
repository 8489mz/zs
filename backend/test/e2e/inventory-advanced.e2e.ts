import { E2EClient } from './e2e-utils';
import { Client } from 'pg';
import assert from 'node:assert/strict';

async function main() {
  const admin = new E2EClient();
  await admin.login(process.env.TEST_USER || 'dev', process.env.TEST_PASSWORD || '1');

  const clientB = new E2EClient();
  await clientB.login(process.env.TEST_TENANT2_USER || 't2_admin', process.env.TEST_TENANT2_PASSWORD || '1');

  const pg = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5433,
    database: process.env.DB_NAME || 'zstest',
  });
  await pg.connect();

  try {
    const tenantId = 'default';

    // Get locations from DB
    const locRes = await pg.query(
      "SELECT id, branch_id FROM stock_locations WHERE tenant_id = 'default' AND location_type != 'transit_stock' LIMIT 2",
    );
    if (locRes.rows.length < 2) {
      throw new Error('Test requires at least 2 locations in DB.');
    }
    const sourceLocationId = Number(locRes.rows[0].id);
    const destLocationId = Number(locRes.rows[1].id);
    let branchId = locRes.rows[0].branch_id ? Number(locRes.rows[0].branch_id) : undefined;
    if (!branchId) {
      const bRes = await pg.query("SELECT id FROM branches WHERE tenant_id = 'default' LIMIT 1");
      branchId = bRes.rows.length ? Number(bRes.rows[0].id) : undefined;
    }

    // Create Category
    const catName = 'E2E InvCat ' + Date.now();
    await admin.post('/api/categories', { name: catName }, 201);
    const categoriesPayload = await admin.get('/api/categories');
    const category = (categoriesPayload.categories as any[]).find((c: any) => c.name === catName);

    // Create Product
    const prodName = 'E2E InvProd ' + Date.now();
    const baseBarcode = 'INV' + Date.now();
    await admin.post(
      '/api/products',
      {
        categoryId: Number(category.id),
        name: prodName,
        barcode: baseBarcode,
        costPrice: 10,
        retailPrice: 20,
        wholesalePrice: 15,
        minStock: 0,
        stock: 0,
        units: [
          {
            name: 'قطعة',
            multiplier: 1,
            barcode: baseBarcode,
            isBaseUnit: true,
            isSaleUnit: true,
            isPurchaseUnit: true,
          },
        ],
      },
      201,
    );

    const productsPayload = await admin.get('/api/products?limit=100');
    const product = (productsPayload.products as any[]).find((p: any) => p.name === prodName);
    const productId = Number(product.id);

    console.log(`[Setup] Product: ${productId}, Source Loc: ${sourceLocationId}, Dest Loc: ${destLocationId}`);

    // Setup: Add initial stock
    await admin.post('/api/inventory-adjustments', {
      productId,
      locationId: sourceLocationId,
      actionType: 'adjust',
      qty: 1000,
      reason: 'Test Setup',
      note: 'Initial Stock',
    });

    const getStock = async (locId: number) => {
      const res = await pg.query('SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2', [
        productId,
        locId,
      ]);
      return Number(res.rows[0]?.qty || 0);
    };

    const checkJournal = async (sourceType: string, sourceId: number, expectedAmount: number) => {
      const jRes = await pg.query(
        "SELECT id FROM journal_entries WHERE source_type = $1 AND source_id = $2 AND tenant_id = 'default'",
        [sourceType, sourceId],
      );
      assert.ok(jRes.rows.length > 0, `No journal entry for ${sourceType} ${sourceId}`);
      const jId = jRes.rows[0].id;
      const lRes = await pg.query(
        'SELECT SUM(debit) as dr, SUM(credit) as cr FROM journal_entry_lines WHERE journal_entry_id = $1',
        [jId],
      );
      assert.equal(Number(lRes.rows[0].dr), Number(lRes.rows[0].cr), `Journal entry ${jId} not balanced`);
      assert.equal(Number(lRes.rows[0].dr), expectedAmount, `Journal entry ${jId} amount mismatch`);
      return jId;
    };

    // 1. TRANSFERS
    console.log('\n--- Testing Transfers ---');

    // 1.1 Prevent transfer to same location
    try {
      await admin
        .post(
          '/api/stock-transfers',
          {
            fromLocationId: sourceLocationId,
            toLocationId: sourceLocationId,
            items: [{ productId, qty: 10 }],
          },
          400,
        )
        .catch((e) => {
          if (!e.message.includes('400')) throw e;
        });
      console.log('✅ Prevent transfer to same location');
    } catch (e) {
      console.error('❌ Prevent transfer to same location failed', e);
      process.exit(1);
    }

    // 1.2 Prevent transfer over available qty
    try {
      await admin
        .post(
          '/api/stock-transfers',
          {
            fromLocationId: sourceLocationId,
            toLocationId: destLocationId,
            items: [{ productId, qty: 99999 }],
          },
          409,
        )
        .catch((e) => {
          if (!e.message.includes('409') && !e.message.includes('400')) throw e;
        });
      console.log('✅ Prevent transfer over available qty');
    } catch (e) {
      console.error('❌ Prevent transfer over available qty failed', e);
      process.exit(1);
    }

    // 1.3 Create transfer and verify transit
    let transferId: number;
    try {
      const initialSourceStock = await getStock(sourceLocationId);
      await admin.post('/api/stock-transfers', {
        fromLocationId: sourceLocationId,
        toLocationId: destLocationId,
        items: [{ productId, qty: 5 }],
      });
      const lastTransferRes = await pg.query('SELECT id FROM stock_transfers ORDER BY id DESC LIMIT 1');
      transferId = Number(lastTransferRes.rows[0].id);

      const afterSourceStock = await getStock(sourceLocationId);
      assert.equal(afterSourceStock, initialSourceStock - 5);

      // Verify transit location created implicitly
      const transitRes = await pg.query(
        "SELECT id FROM stock_locations WHERE location_type = 'transit_stock' AND tenant_id = $1 LIMIT 1",
        [tenantId],
      );
      if (transitRes.rows.length > 0) {
        const transitStock = await getStock(Number(transitRes.rows[0].id));
        assert.ok(transitStock >= 5);
      }
      console.log('✅ Create transfer and verify stock deducted');
    } catch (e) {
      console.error('❌ Create transfer failed', e);
      process.exit(1);
    }

    // 1.4 Tenant Isolation on Transfers
    try {
      await clientB.post(`/api/stock-transfers/${transferId}/receive`, {}, 403).catch((e) => {
        if (e.message.includes('404') || e.message.includes('403')) return;
        throw e;
      });
      await clientB.post(`/api/stock-transfers/${transferId}/cancel`, {}, 403).catch((e) => {
        if (e.message.includes('404') || e.message.includes('403')) return;
        throw e;
      });
      console.log('✅ Tenant B cannot access Tenant A transfers');
    } catch (e) {
      console.error('❌ Tenant isolation on transfers failed', e);
      process.exit(1);
    }

    // 1.5 Receive transfer
    try {
      const initialDestStock = await getStock(destLocationId);
      await admin.post(`/api/stock-transfers/${transferId}/receive`, {});
      const afterDestStock = await getStock(destLocationId);
      assert.equal(afterDestStock, initialDestStock + 5);
      console.log('✅ Receive transfer adds to dest');
    } catch (e) {
      console.error('❌ Receive transfer failed', e);
      process.exit(1);
    }

    // 1.6 Cancel transfer
    try {
      const initialSourceStock = await getStock(sourceLocationId);
      await admin.post('/api/stock-transfers', {
        fromLocationId: sourceLocationId,
        toLocationId: destLocationId,
        items: [{ productId, qty: 7 }],
      });
      const lastTransferRes2 = await pg.query('SELECT id FROM stock_transfers ORDER BY id DESC LIMIT 1');
      const tId2 = Number(lastTransferRes2.rows[0].id);

      await admin.post(`/api/stock-transfers/${tId2}/cancel`, {});
      const finalSourceStock = await getStock(sourceLocationId);
      assert.equal(finalSourceStock, initialSourceStock);
      console.log('✅ Cancel transfer restores source stock');
    } catch (e) {
      console.error('❌ Cancel transfer failed', e);
      process.exit(1);
    }

    // 2. STOCK COUNT
    console.log('\n--- Testing Stock Count ---');
    let sessionId: number;
    try {
      const currentStock = await getStock(sourceLocationId);
      const newQty = currentStock - 2;

      await admin.post('/api/stock-count-sessions', {
        locationId: sourceLocationId,
        branchId,
        note: 'E2E Count',
        items: [{ productId, countedQty: newQty }],
      });
      const lastSessionRes = await pg.query('SELECT id FROM stock_count_sessions ORDER BY id DESC LIMIT 1');
      sessionId = Number(lastSessionRes.rows[0].id);

      // Post session
      await admin.post(`/api/stock-count-sessions/${sessionId}/post`, {});
      const finalStock = await getStock(sourceLocationId);
      assert.equal(finalStock, newQty);

      const movs = await pg.query(
        'SELECT * FROM stock_movements WHERE product_id = $1 AND location_id = $2 ORDER BY id DESC LIMIT 1',
        [productId, sourceLocationId],
      );
      assert.ok(['stock_count_loss', 'stock_count_gain'].includes(movs.rows[0].movement_type));
      assert.equal(Math.abs(Number(movs.rows[0].qty)), 2); // 2 deducted

      // Verify Accounting
      const cost = 10; // costPrice is 10
      await checkJournal('stock_count', sessionId, 2 * cost);

      console.log('✅ Stock Count Session completed, adjusted stock, and created balanced journal');
    } catch (e) {
      console.error('❌ Stock Count failed', e);
      process.exit(1);
    }

    // 2.2 Stale Stock Count Session & Double Approval
    try {
      const curStock = await getStock(sourceLocationId);

      // create session
      await admin.post('/api/stock-count-sessions', {
        locationId: sourceLocationId,
        branchId,
        note: 'E2E Stale',
        items: [{ productId, countedQty: curStock + 10 }],
      });
      const lastSessionRes = await pg.query('SELECT id FROM stock_count_sessions ORDER BY id DESC LIMIT 1');
      const staleSessionId = Number(lastSessionRes.rows[0].id);

      // change stock using manual adjustment
      await admin.post('/api/inventory-adjustments', {
        productId,
        locationId: sourceLocationId,
        actionType: 'add',
        qty: 1,
        reason: 'E2E Stock Change',
      });

      // try to post session -> should be rejected because STALE
      await admin.post(`/api/stock-count-sessions/${staleSessionId}/post`, {}, 409).catch((e) => {
        if (!e.message.includes('400') && !e.message.includes('409')) throw e;
      });

      // try to post the previously posted session -> should fail
      await admin.post(`/api/stock-count-sessions/${sessionId}/post`, {}, 400).catch((e) => {
        if (!e.message.includes('400')) throw e;
      });

      console.log('✅ Stock Count prevents STALE and double approval');
    } catch (e) {
      console.error('❌ STALE Session check failed', e);
      process.exit(1);
    }

    // 3. DAMAGED STOCK
    console.log('\n--- Testing Damaged Stock ---');
    try {
      const initialStock = await getStock(sourceLocationId);
      await admin.post('/api/damaged-stock', {
        productId,
        locationId: sourceLocationId,
        qty: 3,
        note: 'E2E Damage',
        reason: 'Broken',
      });
      const afterStock = await getStock(sourceLocationId);
      assert.equal(afterStock, initialStock - 3);

      const dmgRes = await pg.query(
        'SELECT * FROM damaged_stock_records WHERE product_id = $1 AND location_id = $2 ORDER BY id DESC LIMIT 1',
        [productId, sourceLocationId],
      );
      assert.equal(Number(dmgRes.rows[0].qty), 3);
      const dmgId = Number(dmgRes.rows[0].id);

      // Verify Accounting
      const cost = 10;
      await checkJournal('damaged_stock', dmgId, 3 * cost);

      console.log('✅ Damaged Stock deducted correctly and created balanced journal');
    } catch (e) {
      console.error('❌ Damaged Stock failed', e);
      process.exit(1);
    }

    try {
      await admin
        .post(
          '/api/damaged-stock',
          {
            productId,
            locationId: sourceLocationId,
            qty: 99999,
            note: 'E2E Overdraft Damage',
          },
          409,
        )
        .catch((e) => {
          if (!e.message.includes('400') && !e.message.includes('409')) throw e;
        });
      console.log('✅ Damaged Stock prevents overdraft');
    } catch (e) {
      console.error('❌ Damaged Stock overdraft check failed', e);
      process.exit(1);
    }

    // 4. MANUAL ADJUSTMENTS
    console.log('\n--- Testing Manual Adjustments ---');
    try {
      const initialStock = await getStock(sourceLocationId);

      // Deduct
      await admin.post('/api/inventory-adjustments', {
        productId,
        locationId: sourceLocationId,
        actionType: 'deduct',
        qty: 1,
        reason: 'E2E Deduct',
      });
      let curStock = await getStock(sourceLocationId);
      assert.equal(curStock, initialStock - 1);

      const movs = await pg.query(
        'SELECT * FROM stock_movements WHERE product_id = $1 AND location_id = $2 ORDER BY id DESC LIMIT 1',
        [productId, sourceLocationId],
      );
      const adjId = Number(movs.rows[0].id); // Journal entry uses stock_movement ID for inventory adjustments
      await checkJournal('inventory_adjustment', adjId, 1 * 10);

      // Add
      await admin.post('/api/inventory-adjustments', {
        productId,
        locationId: sourceLocationId,
        actionType: 'add',
        qty: 4,
        reason: 'E2E Add',
      });
      curStock = await getStock(sourceLocationId);
      assert.equal(curStock, initialStock + 3);

      console.log('✅ Manual Adjustments Add/Deduct work correctly with journals');
    } catch (e) {
      console.error('❌ Manual Adjustments failed', e);
      process.exit(1);
    }

    try {
      await admin
        .post(
          '/api/inventory-adjustments',
          {
            productId,
            locationId: sourceLocationId,
            actionType: 'deduct',
            qty: 99999,
            reason: 'E2E Overdraft',
          },
          409,
        )
        .catch((e) => {
          if (!e.message.includes('400') && !e.message.includes('409')) throw e;
        });
      console.log('✅ Manual Adjustments prevent overdraft');
    } catch (e) {
      console.error('❌ Manual Adjustments overdraft check failed', e);
      process.exit(1);
    }

    // 5. CONSOLIDATED ADVANCED SCENARIOS
    console.log('\n--- Testing Zero Quantity & Precisions ---');
    try {
      const note = 'QA-INV-ZADD-' + Date.now();
      await admin
        .post(
          '/api/inventory-adjustments',
          { productId, locationId: sourceLocationId, actionType: 'add', qty: 0, reason: 'test zero add', note },
          400,
        )
        .catch((e) => {
          if (!e.message.includes('400')) throw e;
        });
      console.log('✅ Adjust Zero Add rejected');
    } catch (e: any) {
      console.error('❌ Adjust Zero Add failed', e);
      process.exit(1);
    }

    try {
      const startLocStock = await getStock(sourceLocationId);
      await admin.post('/api/damaged-stock', {
        productId,
        locationId: sourceLocationId,
        qty: 0.135,
        note: 'QA-INV-DMW-' + Date.now(),
      });
      const endLocStock = await getStock(sourceLocationId);
      assert.ok(Math.abs(endLocStock - (startLocStock - 0.135)) < 0.001);
      console.log('✅ Exact precision 0.135 deducted');
    } catch (e: any) {
      console.error('❌ Precision 0.135 deduction failed', e);
      process.exit(1);
    }

    console.log('\n--- Testing Advanced & Idempotency ---');
    try {
      const note = 'QA-INV-CATOM-' + Date.now();
      const fakeProductId = 999999;
      await admin
        .post(
          '/api/stock-count-sessions',
          {
            branchId,
            locationId: sourceLocationId,
            note,
            items: [
              { productId, countedQty: 5 },
              { productId: fakeProductId, countedQty: 3 },
            ],
          },
          404,
        )
        .catch((e) => {
          if (!e.message.includes('400') && !e.message.includes('404')) throw e;
        });

      const sessionsAfter = await pg.query('SELECT count(*) FROM stock_count_sessions WHERE note = $1', [note]);
      assert.equal(Number(sessionsAfter.rows[0].count), 0, 'No session should be created');
      console.log('✅ Atomicity: full reject on bad product');
    } catch (e: any) {
      console.error('❌ Atomicity check failed', e);
      process.exit(1);
    }

    try {
      const idempotencyKey = 'DMG-IDEM-' + Date.now();
      const note = 'QA-INV-DIDEM-' + Date.now();
      const payload = { productId, locationId: sourceLocationId, qty: 1, note };

      const p1 = admin
        .post('/api/damaged-stock', payload, 201, { 'X-Idempotency-Key': idempotencyKey })
        .catch((e) => e);
      const p2 = admin
        .post('/api/damaged-stock', payload, 201, { 'X-Idempotency-Key': idempotencyKey })
        .catch((e) => e);
      await Promise.all([p1, p2]);

      await new Promise((r) => setTimeout(r, 1000));
      await admin.post('/api/damaged-stock', payload, 201, { 'X-Idempotency-Key': idempotencyKey }).catch((e) => e);

      const dmgs = await pg.query('SELECT count(*) FROM damaged_stock_records WHERE note = $1', [note]);
      assert.equal(Number(dmgs.rows[0].count), 1, 'Should only create one damage record');

      console.log('✅ Concurrent+Sequential Idempotency on Damage');
    } catch (e: any) {
      console.error('❌ Damage Idempotency failed', e);
      process.exit(1);
    }

    try {
      const note = 'QA-INV-MPIN-' + Date.now();
      await admin.post('/api/stock-count-sessions', {
        locationId: sourceLocationId,
        branchId,
        items: [{ productId, countedQty: 10 }],
        note,
      });
      const sId = await pg
        .query('SELECT id FROM stock_count_sessions WHERE note = $1', [note])
        .then((r) => r.rows[0].id);

      await admin.post(`/api/stock-count-sessions/${sId}/post`, { managerPin: 'WRONG' }, 403).catch((e) => {
        if (!e.message.includes('403') && !e.message.includes('400')) throw e;
      });
      console.log('✅ managerPin enforcement verified');
    } catch (e: any) {
      console.error('❌ Manager Pin check failed', e);
      process.exit(1);
    }

    // Check Accounting Rollback
    console.log('\n--- Testing Rollback on Account Failure ---');
    try {
      // Add Trigger to simulate failure
      await pg.query(`
        CREATE OR REPLACE FUNCTION fail_accounting_trigger() RETURNS trigger AS $$
        BEGIN
          IF NEW.source_type = 'inventory_adjustment' THEN
            RAISE EXCEPTION 'Simulated Accounting Failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Ensure we replace it properly
      await pg.query(`DROP TRIGGER IF EXISTS fail_accounting_trig ON journal_entries`);
      await pg.query(`
        CREATE TRIGGER fail_accounting_trig
        BEFORE INSERT ON journal_entries
        FOR EACH ROW EXECUTE FUNCTION fail_accounting_trigger()
      `);

      const initialStock = await getStock(sourceLocationId);
      const initialMovs = await pg.query(
        'SELECT COUNT(*) as c FROM stock_movements WHERE product_id = $1 AND location_id = $2',
        [productId, sourceLocationId],
      );

      // This should fail and rollback!
      try {
        await admin.post('/api/inventory-adjustments', {
          productId,
          locationId: sourceLocationId,
          actionType: 'add',
          qty: 10,
          reason: 'E2E Rollback',
          note: 'FAIL_ACCOUNTING',
        });
        assert.fail('Should have failed');
      } catch (e: any) {
        assert.ok(
          e.message.includes('Simulated Accounting Failure') || e.message.includes('500') || e.message.includes('400'),
          'Expected failure message: ' + e.message,
        );
      }

      const afterStock = await getStock(sourceLocationId);
      assert.equal(afterStock, initialStock, 'Stock should rollback');

      const afterMovs = await pg.query(
        'SELECT COUNT(*) as c FROM stock_movements WHERE product_id = $1 AND location_id = $2',
        [productId, sourceLocationId],
      );
      assert.equal(Number(afterMovs.rows[0].c), Number(initialMovs.rows[0].c), 'Movements should rollback');

      console.log('✅ Rollback correctly performed on accounting failure');
    } catch (e) {
      console.error('❌ Rollback test failed', e);
      process.exit(1);
    }

    console.log('\n🎉 ALL ADVANCED INVENTORY TESTS PASSED!');
  } finally {
    try {
      await pg.query(`DROP TRIGGER IF EXISTS fail_accounting_trig ON journal_entries`);
    } catch (e) {}
    try {
      await pg.query(`DROP FUNCTION IF EXISTS fail_accounting_trigger()`);
    } catch (e) {}
    await pg.end();
  }
}

main().catch((e) => {
  console.error('Fatal Error:', e);
  process.exit(1);
});
