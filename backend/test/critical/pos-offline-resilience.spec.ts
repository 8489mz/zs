import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import {
  decideOfflineSalePriceDrift,
  decideOfflineSaleStockGate,
  formatOfflineReconciliationNoteTags,
  resolvePosOfflineSyncIdentity,
} from '../../src/modules/sales/engines/pos-offline-sale.engine';
import { calculateAllowedSaleUnitPrice } from '../../src/modules/sales/helpers/sales-write.helper';
import { normalizeShiftOpenPayload } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';

async function runTests() {
  const fixedNow = new Date('2026-11-28T18:00:00.000Z');
  const twoHoursEarlier = new Date('2026-11-28T16:00:00.000Z');

  // 1. Request hash parity between online attempt and offline-sync replay
  {
    const service = new IdempotencyService({} as never);
    const baseSalePayload = {
      source: 'pos',
      branchId: 1,
      locationId: 1,
      paymentType: 'cash',
      paymentChannel: 'cash',
      expectedTotal: 150,
      note: 'عميل مستعجل',
      items: [{ productId: 10, qty: 2, price: 75 }],
    };
    const offlineReplayPayload = {
      ...baseSalePayload,
      offlineDocNo: 'INV-T4A2-261128-0001',
      offlineCreatedAt: twoHoursEarlier.toISOString(),
    };
    assert.equal(
      service.generateRequestHash(baseSalePayload),
      service.generateRequestHash(offlineReplayPayload),
      'Offline replay metadata must not change canonical idempotency requestHash',
    );
  }

  // 2. Fact-of-sale stock gate: online blocks, offline sync allows with shortfall audit
  {
    const onlineBlocked = decideOfflineSaleStockGate({
      isOfflineSyncSale: false,
      allowNegativeStockSales: false,
      hasBom: false,
      isService: false,
      availableStockQty: 1,
      requiredQty: 3,
      productId: 55,
      productName: 'لبن جهينة 1 لتر',
    });
    assert.equal(onlineBlocked.allowSale, false);
    assert.equal(onlineBlocked.shortfall, null);

    const offlineAllowed = decideOfflineSaleStockGate({
      isOfflineSyncSale: true,
      allowNegativeStockSales: false,
      hasBom: false,
      isService: false,
      availableStockQty: 1,
      requiredQty: 3,
      productId: 55,
      productName: 'لبن جهينة 1 لتر',
    });
    assert.equal(offlineAllowed.allowSale, true);
    assert.equal(offlineAllowed.allowNegativeMovement, true);
    assert.deepEqual(offlineAllowed.shortfall, {
      productId: 55,
      productName: 'لبن جهينة 1 لتر',
      availableQty: 1,
      requiredQty: 3,
      deficitQty: 2,
    });
  }

  // 3. Offer window evaluated at offlineCreatedAt rather than late sync time
  {
    const happyHourOffers = [
      {
        offer_type: 'price',
        value: 80,
        start_date: '2026-11-28',
        end_date: '2026-11-28',
        happy_hour_start: '13:00',
        happy_hour_end: '15:00',
      },
    ];
    // Sale occurred at 14:15 Cairo (12:15 UTC), synced at 20:00 Cairo (18:00 UTC)
    const saleInstant = new Date('2026-11-28T12:15:00.000Z');
    const syncInstant = new Date('2026-11-28T18:00:00.000Z');

    const allowedAtSaleTime = calculateAllowedSaleUnitPrice({
      retailPrice: 100,
      priceType: 'retail',
      offers: happyHourOffers,
      qty: 1,
      unitMultiplier: 1,
      now: saleInstant,
      businessTimezone: 'Africa/Cairo',
      moneyDigits: 2,
    });
    const allowedAtSyncTime = calculateAllowedSaleUnitPrice({
      retailPrice: 100,
      priceType: 'retail',
      offers: happyHourOffers,
      qty: 1,
      unitMultiplier: 1,
      now: syncInstant,
      businessTimezone: 'Africa/Cairo',
      moneyDigits: 2,
    });
    assert.equal(allowedAtSaleTime, 80, 'Happy-hour offer active at offline sale time must apply');
    assert.equal(allowedAtSyncTime, 100, 'Offer expired by sync time');
  }

  // 4. Price drift audit decision + reconciliation tags + provisional shift timestamp validation
  {
    const identity = resolvePosOfflineSyncIdentity(
      {
        offlineDocNo: 'INV-T4A2-261128-0007',
        offlineCreatedAt: twoHoursEarlier.toISOString(),
        terminalCode: 'T4A2',
      },
      fixedNow,
    );
    assert.equal(identity.isOfflineSyncSale, true);
    assert.equal(identity.posTerminalCode, 'T4A2');

    const drift = decideOfflineSalePriceDrift({
      isOfflineSyncSale: true,
      providedUnitPrice: 95,
      allowedUnitPrice: 105,
      productId: 12,
      productName: 'زيت عباد الشمس',
    });
    assert.equal(drift.acceptWithAudit, true);
    assert.equal(drift.drift?.soldUnitPrice, 95);
    assert.equal(drift.drift?.currentAllowedUnitPrice, 105);

    const tags = formatOfflineReconciliationNoteTags({
      shortfalls: [{ productId: 55, productName: 'لبن', availableQty: 0, requiredQty: 2, deficitQty: 2 }],
      priceDrifts: drift.drift ? [drift.drift] : [],
    });
    assert.equal(tags.length, 2);

    const normalizedShift = normalizeShiftOpenPayload({
      openingCash: 500,
      branchId: 1,
      terminalCode: 't4a2',
      offlineOpenedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(normalizedShift.terminalCode, 'T4A2');
    assert.ok(normalizedShift.offlineOpenedAt instanceof Date);
  }

  // 5. PGlite verification of resetTerminalFailedOperation safety invariants
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE operation_executions (
          id bigserial PRIMARY KEY,
          tenant_id text NOT NULL,
          account_id text NOT NULL,
          idempotency_key text NOT NULL,
          operation_type text NOT NULL,
          status text NOT NULL,
          request_hash text NOT NULL,
          document_id text,
          response_payload text,
          error_code text,
          created_at timestamptz DEFAULT NOW(),
          updated_at timestamptz DEFAULT NOW(),
          completed_at timestamptz
        );
      `);
      const service = new IdempotencyService(db as never);

      await db
        .insertInto('operation_executions')
        .values([
          {
            tenant_id: 't1',
            account_id: 'a1',
            idempotency_key: 'rolled-back-failed',
            operation_type: 'POST:/api/sales',
            status: 'failed',
            request_hash: 'h1',
            document_id: null,
          },
          {
            tenant_id: 't1',
            account_id: 'a1',
            idempotency_key: 'committed-sale',
            operation_type: 'POST:/api/sales',
            status: 'committed',
            request_hash: 'h2',
            document_id: '99',
          },
          {
            tenant_id: 't1',
            account_id: 'a1',
            idempotency_key: 'ambiguous-recovery',
            operation_type: 'POST:/api/sales',
            status: 'recovery_required',
            request_hash: 'h3',
            document_id: null,
          },
          {
            tenant_id: 't2',
            account_id: 'a2',
            idempotency_key: 'rolled-back-failed',
            operation_type: 'POST:/api/sales',
            status: 'failed',
            request_hash: 'h1',
            document_id: null,
          },
        ] as any)
        .execute();

      const okReset = await service.resetTerminalFailedOperation({
        tenantId: 't1',
        accountId: 'a1',
        operationType: 'POST:/api/sales',
        idempotencyKey: 'rolled-back-failed',
      });
      assert.equal(okReset.reset, true, 'Rolled-back failed row with null document_id must reset');

      const committedReset = await service.resetTerminalFailedOperation({
        tenantId: 't1',
        accountId: 'a1',
        operationType: 'POST:/api/sales',
        idempotencyKey: 'committed-sale',
      });
      assert.equal(committedReset.reset, false, 'Committed row must NEVER be reset');

      const recoveryReset = await service.resetTerminalFailedOperation({
        tenantId: 't1',
        accountId: 'a1',
        operationType: 'POST:/api/sales',
        idempotencyKey: 'ambiguous-recovery',
      });
      assert.equal(recoveryReset.reset, false, 'recovery_required row must NEVER be auto-reset');

      const t2Row = await db
        .selectFrom('operation_executions')
        .selectAll()
        .where('tenant_id', '=', 't2')
        .executeTakeFirst();
      assert.ok(t2Row, 'Other tenant row with identical key must remain untouched');
    } finally {
      await db.destroy();
    }
  }

  console.log('pos-offline-resilience.spec: ok');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
