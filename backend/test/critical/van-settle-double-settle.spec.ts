/*
New file: backend/test/critical/van-settle-double-settle.spec.ts
Pins the double-settle guard (Phase 1, van F1): settleTrip checked the
trip's status only OUTSIDE any transaction, on an unlocked read, and
never re-checked it inside the settlement transaction. Two concurrent
settles both passed the pre-check and both ran the stock deductions,
unload transfers, and trip update; only the journal was saved, by the
SELECT guard in postVanTripSettlement returning the existing entry —
so the second settle committed duplicated stock effects with no
journal at all.

WHAT THIS PINS, driving the real settleTrip with mock DB objects:
- Inside the settlement transaction, the trip row is re-read with
  FOR UPDATE before any other query. A trip that is already
  'settled' there is rejected with TRIP_ALREADY_SETTLED and no stock
  or journal query runs.
- The re-read happens on the transaction object, not on the outer
  connection: the outer trip read (the pre-check) runs exactly once.
- An open trip passes the guard and reaches the stock read (the mock
  refuses it, which is the expected proof the guard did not block it).
  The money re-read (INV-VAN-TRIP-LOCKED-STATE-RECHECK: expenses sum
  + collected cash + base currency, all inside the transaction under
  the trip lock) runs between the guard and the stock read, so the
  mock answers those three tables and still refuses the stock read.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'innerJoin', 'orderBy', 'limit']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildService(opts: { preCheckTrip: any; inTxTrip: any; counters: any }) {
  const trx: any = {
    selectFrom: (table: string) => {
      if (table === 'van_sales_trips') {
        opts.counters.trxTripReads += 1;
        const builder = chainable({
          executeTakeFirst: async () => opts.inTxTrip,
        });
        const originalForUpdate = builder.forUpdate;
        builder.forUpdate = () => {
          opts.counters.trxForUpdate = true;
          return originalForUpdate();
        };
        return builder;
      }
      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: after the guard, settleTrip
      // re-reads the money inputs inside the transaction (base currency,
      // expenses sum) before the stock read — the mock answers those.
      if (table === 'settings') {
        return chainable({ executeTakeFirst: async () => ({ value: 'EGP' }) });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      if (table === 'van_trip_expenses') {
        return chainable({ executeTakeFirst: async () => ({ totalExpenses: 0 }) });
      }
      throw new Error(`unexpected in-transaction query on table ${table}: the double-settle guard must fire first`);
    },
  };
  const db: any = {
    selectFrom: (table: string) => {
      if (table === 'van_sales_trips as vt' || table === 'van_sales_trips') {
        opts.counters.outerTripReads += 1;
        return chainable({ executeTakeFirst: async () => opts.preCheckTrip });
      }
      if (table === 'delivery_representatives') {
        return chainable({ executeTakeFirst: async () => ({ id: 4, name: 'Rep', phone: null }) });
      }
      if (table === 'van_trip_expenses') {
        return chainable({ executeTakeFirst: async () => ({ totalExpenses: 0 }) });
      }
      // Slice 7 P6: settleTrip resolves the tenant book currency on
      // the outer connection before the transaction (same pattern as
      // submitTripSettlement). The mock answers the two reads with
      // a consistent EGP base so the guard assertions below still
      // test the in-transaction order only.
      if (table === 'settings') {
        return chainable({ executeTakeFirst: async () => ({ value: 'EGP' }) });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      throw new Error(`unexpected outer query on table ${table}`);
    },
    transaction: () => ({ execute: async (cb: any) => cb(trx) }),
  };
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.accountingPosting = {
    postVanTripSettlement: async () => {
      throw new Error('postVanTripSettlement must not run after a rejected double-settle');
    },
  };
  service.recordSuspicionEvent = async () => {
    throw new Error('recordSuspicionEvent must not run in these cases');
  };
  service.resolveSystemAuthContext = async () => {
    throw new Error('resolveSystemAuthContext must not run before the guard');
  };
  return service;
}

const adminAuth: any = { tenantId: 't1', accountId: 'a1', userId: 99, role: 'admin', permissions: [] };
const payload: any = { tripId: 11, countedCash: 500, unloadRemainingToWarehouse: false, endOdometer: 120 };

function openTrip(): any {
  return {
    id: 11, tenant_id: 't1', rep_id: 4, status: 'open',
    van_location_id: 10, vehicle_id: 5,
    start_odometer: 100, end_odometer: null, cash_collected: 500,
  };
}

async function main() {
  // 1. The trip settled between the pre-check and the transaction:
  // rejected inside the transaction, before any stock/journal work.
  {
    const counters = { outerTripReads: 0, trxTripReads: 0, trxForUpdate: false };
    const service = buildService({
      preCheckTrip: openTrip(),
      inTxTrip: { ...openTrip(), status: 'settled' },
      counters,
    });
    await assert.rejects(
      async () => service.settleTrip(4, 't1', 'a1', payload, adminAuth),
      /TRIP_ALREADY_SETTLED/,
    );
    assert.equal(counters.outerTripReads, 1, 'the pre-check read runs once');
    assert.equal(counters.trxTripReads, 1, 'the trip is re-read inside the transaction');
    assert.equal(counters.trxForUpdate, true, 'the in-transaction re-read locks the row');
  }

  // 2. An open trip passes the guard and reaches the stock read.
  {
    const counters = { outerTripReads: 0, trxTripReads: 0, trxForUpdate: false };
    const service = buildService({
      preCheckTrip: openTrip(),
      inTxTrip: { ...openTrip(), status: 'open' },
      counters,
    });
    await assert.rejects(
      async () => service.settleTrip(4, 't1', 'a1', payload, adminAuth),
      /unexpected in-transaction query on table product_location_stock/,
    );
    assert.equal(counters.trxTripReads, 1);
    assert.equal(counters.trxForUpdate, true);
  }

  // 3. A trip already settled at the pre-check is still rejected there
  // (existing behaviour, unchanged).
  {
    const counters = { outerTripReads: 0, trxTripReads: 0, trxForUpdate: false };
    const service = buildService({
      preCheckTrip: null,
      inTxTrip: { ...openTrip(), status: 'settled' },
      counters,
    });
    await assert.rejects(
      async () => service.settleTrip(4, 't1', 'a1', payload, adminAuth),
      /TRIP_NOT_FOUND/,
    );
    assert.equal(counters.trxTripReads, 0, 'no transaction starts when the pre-check fails');
  }

  console.log('Van double-settle guard tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
