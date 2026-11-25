/*
New file: backend/test/critical/field-collection-twin-scope.spec.ts
Pins the field-collection rapid-fire twin check (Phase 1, van F4,
collection site): the database backstop that guards against a
double-tapped field collection matched a recent payment on customer
+ amount + 4 seconds only. A second, genuinely different collection
— another trip, another rep, another channel — for the same customer
and amount inside 4 seconds was silently swallowed: the caller got
ok:true with the FIRST collection's receipt number, while no second
payment, ledger entry, or custody movement ever existed.

The in-process layers already key on the full fingerprint
(tenant:trip:rep:customer:amount). Only the database backstop lacked
the scope, because customer_payments carried no trip, rep, or
client-transaction columns — the client transaction id lived only as
a [tx:...] tag inside the free-text note.

WHAT THIS PINS:
- Migration 2040000000268 (production `up`, PGlite): the three
  columns exist, client_tx_id backfills from the legacy note tag,
  untagged rows stay NULL, notes are untouched, and the twin index
  exists; `down` removes them again.
- Driving the real recordFieldCollection with a mock DB:
  - Same trip + rep + channel + amount within 4s -> deduplicated,
    executor never runs (the backstop still works).
  - Same customer + amount, different trip -> proceeds (the old
    unscoped query would have swallowed it); the twin query carries
    van_trip_id, rep_id, and payment_channel predicates.
  - Same trip + rep, different channel -> proceeds.
  - clientTxId: the client_tx_id column is checked first (the tag
    query never runs on a column hit); on a column miss the legacy
    note tag still deduplicates (pre-migration rows).
- The scope helper: channel mapping onto the payment_channel check
  constraint, trip/rep/tx passthrough.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  up as twinScopeUp,
  down as twinScopeDown,
} from '../../src/database/migrations/2040000000268_field_collection_payment_scope';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import {
  fieldCollectionPaymentScope,
  resolveFieldCollectionChannel,
} from '../../src/modules/delivery-reps/services/van-common.util';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'innerJoin', 'orderBy', 'limit']) {
    builder[key] = () => builder;
  }
  Object.assign(builder, terminal);
  return builder;
}

interface TwinFixture {
  columnRow: any;
  tagRow: any;
  twinRow: any;
}

function buildService(fixture: TwinFixture, internalCalls: any[], queries: any[]) {
  const db: any = {
    selectFrom: (table: string) => {
      if (table === 'customers') {
        return chainable({ executeTakeFirst: async () => ({ name: 'Customer' }) });
      }
      if (table === 'customer_payments') {
        const wheres: any[][] = [];
        const record: any = { table, wheres, kind: null };
        queries.push(record);
        const builder = chainable({
          executeTakeFirst: async () => {
            if (wheres.some((w) => w[0] === 'client_tx_id')) {
              record.kind = 'column';
              return fixture.columnRow;
            }
            if (wheres.some((w) => w[1] === 'like')) {
              record.kind = 'tag';
              return fixture.tagRow;
            }
            record.kind = 'twin';
            return fixture.twinRow;
          },
        });
        const originalWhere = builder.where;
        builder.where = (...args: any[]) => {
          wheres.push(args);
          return originalWhere(...args);
        };
        return builder;
      }
      throw new Error(`unexpected query on table ${table}`);
    },
  };
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.recordFieldCollectionInternal = async (...args: any[]) => {
    internalCalls.push(args);
    return { ok: true, receiptNo: 'COL-NEW', amount: 100, customerName: 'Customer', previousBalance: 0, newBalance: 0 };
  };
  return service;
}

function clearCaches() {
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

const PAYMENT_NOTE = 'سند تحصيل (#COL-1) [tx:abc-1]';

async function drive(fixture: TwinFixture, payload: any) {
  clearCaches();
  const internalCalls: any[] = [];
  const queries: any[] = [];
  const service = buildService(fixture, internalCalls, queries);
  const result = await service.recordFieldCollection(7, 't1', 'a1', payload);
  return { result, internalCalls, queries };
}

async function main(): Promise<void> {
  // ---- Part 1: the migration, through the production `up` ----
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await sql`
    CREATE TABLE customer_payments (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      amount NUMERIC(14, 3) NOT NULL,
      payment_channel VARCHAR(20) NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT customer_payments_channel_allowed
        CHECK (payment_channel IN ('cash','bank','card','wallet','instapay'))
    )
  `.execute(db);
  await sql`
    INSERT INTO customer_payments (tenant_id, customer_id, amount, note)
    VALUES ('t1', 21, 100, ${'سند تحصيل (#COL-1) [tx:abc-1]'}),
           ('t1', 21, 50, 'سند تحصيل (#COL-2)')
  `.execute(db);
  await twinScopeUp(db as any);
  const cols = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'customer_payments'
      AND column_name IN ('van_trip_id', 'rep_id', 'client_tx_id')
  `.execute(db);
  assert.equal(cols.rows.length, 3, 'migration must add the three scope columns');
  const rows = await sql<{ note: string; client_tx_id: string | null }>`
    SELECT note, client_tx_id FROM customer_payments ORDER BY id
  `.execute(db);
  assert.equal(rows.rows[0].client_tx_id, 'abc-1', 'client_tx_id backfills from the note tag');
  assert.equal(rows.rows[0].note, 'سند تحصيل (#COL-1) [tx:abc-1]', 'backfill must not rewrite the note');
  assert.equal(rows.rows[1].client_tx_id, null, 'untagged rows stay NULL');
  const indexes = await sql<{ indexname: string }>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'customer_payments'
      AND indexname = 'idx_customer_payments_field_collection_twin'
  `.execute(db);
  assert.equal(indexes.rows.length, 1, 'twin index must exist');
  await twinScopeDown(db as any);
  const colsAfterDown = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'customer_payments'
      AND column_name IN ('van_trip_id', 'rep_id', 'client_tx_id')
  `.execute(db);
  assert.equal(colsAfterDown.rows.length, 0, 'down must remove the scope columns');
  await db.destroy();

  // ---- Part 2: the scope helper ----
  assert.equal(resolveFieldCollectionChannel('cash'), 'cash');
  assert.equal(resolveFieldCollectionChannel('instapay'), 'instapay');
  assert.equal(resolveFieldCollectionChannel('vodafone_cash'), 'wallet');
  assert.equal(resolveFieldCollectionChannel('bank_transfer'), 'bank');
  assert.equal(resolveFieldCollectionChannel(undefined), 'cash');
  assert.deepEqual(
    fieldCollectionPaymentScope({ tripId: 11, repId: 7, paymentMethod: 'instapay', clientTxId: 'abc-1' }),
    { van_trip_id: 11, rep_id: 7, client_tx_id: 'abc-1', payment_channel: 'instapay' },
  );
  assert.deepEqual(fieldCollectionPaymentScope({ tripId: 11, repId: 7 }), {
    van_trip_id: 11,
    rep_id: 7,
    client_tx_id: null,
    payment_channel: 'cash',
  });

  // ---- Part 3: the service drive ----
  const basePayload = { tripId: 11, customerId: 21, amount: 100, paymentMethod: 'cash' as const };

  // Same scope -> deduplicated, executor never runs.
  {
    const { result, internalCalls } = await drive(
      { columnRow: null, tagRow: null, twinRow: { id: 5, amount: 100, note: PAYMENT_NOTE } },
      { ...basePayload },
    );
    assert.equal(result.ok, true);
    assert.equal(result.receiptNo, 'COL-1');
    assert.equal(internalCalls.length, 0);
  }

  // Different trip -> proceeds; the twin query carries the scope.
  {
    const { result, internalCalls, queries } = await drive(
      { columnRow: null, tagRow: null, twinRow: null },
      { ...basePayload },
    );
    assert.equal(result.receiptNo, 'COL-NEW');
    assert.equal(internalCalls.length, 1);
    const twin = queries.find((q) => q.kind === 'twin');
    assert.ok(twin, 'twin query must run');
    const has = (col: string, op: string, val: unknown) =>
      twin.wheres.some((w: any[]) => w[0] === col && w[1] === op && w[2] === val);
    assert.ok(has('van_trip_id', '=', 11), 'twin query must scope by trip');
    assert.ok(has('rep_id', '=', 7), 'twin query must scope by rep');
    assert.ok(has('payment_channel', '=', 'cash'), 'twin query must scope by channel');
    assert.ok(has('amount', '=', 100), 'twin query must still match amount');
    assert.ok(has('customer_id', '=', 21), 'twin query must still match customer');
  }

  // Same trip + rep, different channel -> proceeds.
  {
    const { internalCalls, queries } = await drive(
      { columnRow: null, tagRow: null, twinRow: null },
      { ...basePayload, paymentMethod: 'vodafone_cash' as const },
    );
    assert.equal(internalCalls.length, 1);
    const twin = queries.find((q) => q.kind === 'twin');
    assert.ok(
      twin.wheres.some((w: any[]) => w[0] === 'payment_channel' && w[2] === 'wallet'),
      'vodafone_cash must scope as wallet',
    );
  }

  // clientTxId column hit -> deduplicated, tag query never runs.
  {
    const { result, internalCalls, queries } = await drive(
      {
        columnRow: { id: 9, amount: 100, note: PAYMENT_NOTE },
        tagRow: { id: 9, amount: 100, note: PAYMENT_NOTE },
        twinRow: null,
      },
      { ...basePayload, clientTxId: 'abc-1' },
    );
    assert.equal(result.receiptNo, 'COL-1');
    assert.equal(internalCalls.length, 0);
    assert.equal(queries.filter((q) => q.kind === 'tag').length, 0, 'tag fallback must not run on a column hit');
    assert.equal(queries.filter((q) => q.kind === 'column').length, 1);
  }

  // clientTxId column miss, legacy tag hit -> deduplicated.
  {
    const { result, internalCalls, queries } = await drive(
      { columnRow: null, tagRow: { id: 9, amount: 100, note: PAYMENT_NOTE }, twinRow: null },
      { ...basePayload, clientTxId: 'abc-1' },
    );
    assert.equal(result.receiptNo, 'COL-1');
    assert.equal(internalCalls.length, 0);
    assert.equal(queries.filter((q) => q.kind === 'column').length, 1);
    assert.equal(queries.filter((q) => q.kind === 'tag').length, 1);
  }

  // clientTxId, both miss -> twin check runs, proceeds.
  {
    const { result, internalCalls, queries } = await drive(
      { columnRow: null, tagRow: null, twinRow: null },
      { ...basePayload, clientTxId: 'abc-1' },
    );
    assert.equal(result.receiptNo, 'COL-NEW');
    assert.equal(internalCalls.length, 1);
    assert.equal(queries.filter((q) => q.kind === 'twin').length, 1);
  }

  console.log('Field collection twin scope tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
