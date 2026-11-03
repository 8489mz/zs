/*
New file: backend/test/critical/import-quotation-lock.spec.ts
Pins the quotation selection lock (INV-IMPORT-QUOTATION-LOCK).

WHAT WAS WRONG: selectQuotation had no status check, no row
lock and no expiry check — a rejected or expired quotation
could be (re-)selected, flipping a locked selection, and
concurrent selections for the same item could race.

WHAT THIS PINS, driving the real createQuotation and
selectQuotation on PGlite:
- A pending quotation selects and its same-(project, item)
  siblings are rejected atomically; other items are untouched.
- A rejected quotation cannot be selected, and the failed
  attempt mutates nothing.
- An expired quotation cannot be selected; an expiry date of
  today is still selectable (only strictly-past dates expire).
- Re-selecting the same selected quotation is an idempotent
  no-op (status and reason unchanged).
- A pending quotation created at or before an existing
  selection for the same (project, item) cannot flip the
  locked selection (stale round); a quotation created after
  the selection is a new round and may supersede it. The
  stale state is seeded directly: no API path creates a
  pending pre-selection quote (selection rejects siblings),
  so the guard exists for legacy / out-of-band rows.
- A project-less quotation selects without sibling logic.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_quotations (
      id text PRIMARY KEY DEFAULT ('q-' || md5(random()::text)),
      tenant_id text,
      project_id text,
      supplier_id bigint,
      quotation_no text,
      inquiry_date text,
      expiry_date text,
      incoterm text,
      currency text,
      item_name text,
      product_id bigint,
      unit_price_foreign numeric,
      moq int,
      production_lead_days int,
      port_of_loading text,
      estimated_freight_usd numeric,
      estimated_customs_rate_percent numeric,
      estimated_landed_cost_egp numeric,
      exchange_rate_used numeric(14, 4),
      exchange_rate_assumed boolean,
      customs_rate_assumed boolean,
      status text,
      selection_reason text,
      notes text,
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    INSERT INTO suppliers VALUES (1, 't1', 'Supplier A');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function makeQuote(
  service: any,
  overrides: Record<string, any> = {},
): Promise<any> {
  return await service.createQuotation('t1', {
    projectId: 'proj-1',
    supplierId: '1',
    quotationNo: `Q-${Math.random().toString(36).slice(2, 8)}`,
    itemName: 'Brake Kit',
    unitPriceForeign: 100,
    ...overrides,
  });
}

async function quoteStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any)
    .selectFrom('import_quotations')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function expectReject(promise: Promise<any>, code: string): Promise<void> {
  let err: any = null;
  try {
    await promise;
  } catch (e: any) {
    err = e;
  }
  assert.ok(err, `Expected rejection with ${code}`);
  assert.ok(
    String(err.message || '').includes(code),
    `Expected error to include ${code}, got: ${err?.message}`,
  );
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // Case 1: selection rejects same-group siblings atomically.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const a = await makeQuote(service, { quotationNo: 'Q-A' });
      const b = await makeQuote(service, { quotationNo: 'Q-B' });
      const other = await makeQuote(service, { quotationNo: 'Q-C', itemName: 'Turbo Charger' });
      const winner = await service.selectQuotation('t1', b.id, { selectionReason: 'Best price' });
      assert.equal(winner.status, 'selected');
      assert.equal(winner.selection_reason, 'Best price');
      assert.equal(await quoteStatus(db, a.id), 'rejected');
      assert.equal(await quoteStatus(db, b.id), 'selected');
      assert.equal(await quoteStatus(db, other.id), 'pending', 'Other items untouched');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a rejected quotation cannot be selected; the failed
  // attempt mutates nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const a = await makeQuote(service, { quotationNo: 'Q-A' });
      const b = await makeQuote(service, { quotationNo: 'Q-B' });
      await service.selectQuotation('t1', b.id, {});
      await expectReject(
        service.selectQuotation('t1', a.id, {}),
        'IMPORT_QUOTATION_NOT_SELECTABLE',
      );
      assert.equal(await quoteStatus(db, a.id), 'rejected');
      assert.equal(await quoteStatus(db, b.id), 'selected', 'Winner untouched by the failed attempt');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: expiry — past dates fail, today succeeds.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const expired = await makeQuote(service, { quotationNo: 'Q-OLD', expiryDate: todayPlus(-1) });
      await expectReject(
        service.selectQuotation('t1', expired.id, {}),
        'IMPORT_QUOTATION_EXPIRED',
      );
      assert.equal(await quoteStatus(db, expired.id), 'pending', 'Expired quote stays pending');
      const today = await makeQuote(service, { quotationNo: 'Q-TODAY', expiryDate: todayPlus(0), itemName: 'Turbo Charger' });
      const ok = await service.selectQuotation('t1', today.id, {});
      assert.equal(ok.status, 'selected', 'Expiry today is still selectable');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: re-selecting the winner is an idempotent no-op.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const a = await makeQuote(service, { quotationNo: 'Q-A' });
      const first = await service.selectQuotation('t1', a.id, { selectionReason: 'First decision' });
      const second = await service.selectQuotation('t1', a.id, { selectionReason: 'Changed mind' });
      assert.equal(second.status, 'selected');
      assert.equal(second.selection_reason, 'First decision', 'Reason unchanged by the no-op re-select');
      assert.equal(
        new Date(second.updated_at).getTime(),
        new Date(first.updated_at).getTime(),
        'updated_at unchanged by the no-op re-select',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5: stale round locked, new round supersedes (seeded
  // states — see the header note on why direct seeding is used).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const seed = async (values: Record<string, any>): Promise<string> => {
        const row: any = await (db as any).insertInto('import_quotations').values({
          tenant_id: 't1', project_id: 'proj-1', supplier_id: 1,
          quotation_no: `Q-${Math.random().toString(36).slice(2, 8)}`,
          inquiry_date: '2026-01-01', expiry_date: null, incoterm: 'FOB', currency: 'USD',
          item_name: 'Brake Kit', product_id: null, unit_price_foreign: 100, moq: 1,
          production_lead_days: 30, port_of_loading: null, estimated_freight_usd: 0,
          estimated_customs_rate_percent: 5, estimated_landed_cost_egp: 5000,
          status: 'pending', selection_reason: null, notes: null,
          ...values,
        }).returning('id').executeTakeFirstOrThrow();
        return String(row.id);
      };
      const winnerId = await seed({
        status: 'selected', selection_reason: 'Locked decision',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
      });
      const staleId = await seed({
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });
      await expectReject(
        service.selectQuotation('t1', staleId, {}),
        'IMPORT_QUOTATION_SELECTION_LOCKED',
      );
      assert.equal(await quoteStatus(db, winnerId), 'selected');
      assert.equal(await quoteStatus(db, staleId), 'pending', 'Stale quote stays pending');

      const freshId = await seed({
        created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
      });
      const winner2 = await service.selectQuotation('t1', freshId, {});
      assert.equal(winner2.status, 'selected', 'New-round quotation supersedes');
      assert.equal(await quoteStatus(db, winnerId), 'rejected', 'Old winner rejected by the new round');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: a project-less quotation selects standalone.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const q = await makeQuote(service, { quotationNo: 'Q-FREE', projectId: undefined });
      const res = await service.selectQuotation('t1', q.id, {});
      assert.equal(res.status, 'selected');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import quotation lock tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
