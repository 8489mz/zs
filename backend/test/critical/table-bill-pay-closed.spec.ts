/*
New file: backend/test/critical/table-bill-pay-closed.spec.ts

WHAT THIS PINS (INV-TABLE-BILL-PAY-CLOSED): pay-at-table billing must
never mark a table bill paid without a verified gateway capture. The
public pay-bill route used to set paid_online with a generated
TAB-PAY reference and no payment of any kind — anyone who knew a
shop slug and a table number could close a check and walk out with
the food unpaid — and the storefront API helper then fabricated a
paid result for ANY error, so the guest modal showed "paid" even
when the backend refused. Both halves are closed: the service
throws ServiceUnavailableException before any read or write, and
the API helper propagates errors instead of inventing success.
Viewing the bill (getActiveTableBill) is unchanged; re-enabling
payment requires a gateway charge plus webhook-verified capture.

WHAT IS DRIVEN: the real payActiveTableBill on PGlite, with an
unpaid held bill present and with no bill at all. The throw precedes
every lookup, so the spec seeds only the tables the old code wrote.

DELEGATED DECISIONS, FLAGGED FOR REVERSAL: (1) the closed endpoint
answers 503 with one Arabic message telling the guest to pay at the
counter — no bill-existence detail is leaked either way; (2) the
route stays public and unauthenticated, it simply refuses; (3)
wiring a real gateway (Tap charge + webhook verification) is
separate future work, not smuggled into this package.

NOT DRIVEN: a live Postgres run; the frontend modal in a browser
(the modal already routes errors to its onError toast — the removed
fallback was the only thing converting failure into a paid screen);
a real gateway charge (none exists on this path).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text);
    CREATE TABLE held_sales (id bigint PRIMARY KEY, tenant_id text,
      paid_online boolean DEFAULT false, paid_online_amount numeric,
      paid_online_ref text, note text);
    CREATE TABLE restaurant_table_service_calls (id bigserial PRIMARY KEY,
      tenant_id text, table_number text, call_type text, status text,
      bill_amount numeric, tip_amount numeric, payment_reference text,
      payment_status text, resolved_at timestamptz);
    INSERT INTO tenants VALUES ('t1', 'demo-shop');
  `);
  return { pg, db };
}

function makeService(db: Kysely<Database>): StorefrontService {
  // The closed method touches no dependency: it throws before any
  // lookup, so stub collaborators are safe here and the spec proves
  // the throw, not the collaborators.
  return new StorefrontService(db as any, {} as any, {} as any, {} as any);
}

async function expectClosed(service: StorefrontService): Promise<void> {
  let caught: any = null;
  try {
    await service.payActiveTableBill('demo-shop', '12', { tipAmount: 5, paymentMethod: 'card', guestName: 'Guest' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'payActiveTableBill must throw');
  assert.match(String(caught.message || ''), /غير متاح/, 'the refusal names unavailability');
  const status = typeof caught.getStatus === 'function' ? caught.getStatus() : null;
  assert.equal(status, 503, 'the refusal is a 503, not a silent 400');
}

async function main(): Promise<void> {
  // Case 1: an unpaid held bill stays exactly unpaid — no marking, no row.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('held_sales' as never).values({
        id: 1, tenant_id: 't1', paid_online: false,
        paid_online_amount: null, paid_online_ref: null, note: 'original note',
      } as never).execute();
      const service = makeService(db);
      await expectClosed(service);
      const held = await (db as any).selectFrom('held_sales').selectAll().executeTakeFirstOrThrow();
      assert.equal(held.paid_online, false, 'the bill is not marked paid');
      assert.equal(held.paid_online_amount, null, 'no paid amount is stored');
      assert.equal(held.paid_online_ref, null, 'no generated reference is stored');
      assert.equal(held.note, 'original note', 'no paid stamp is appended to the note');
      const calls = await (db as any).selectFrom('restaurant_table_service_calls').select('id').execute();
      assert.equal(calls.length, 0, 'no bill_paid service-call row is written');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: with no bill at all, the same refusal — the throw precedes lookup.
  {
    const { pg, db } = await makeDb();
    try {
      const service = makeService(db);
      await expectClosed(service);
      const calls = await (db as any).selectFrom('restaurant_table_service_calls').select('id').execute();
      assert.equal(calls.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: source + invariant pins (presence only — no last-line pin).
  {
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/storefront/storefront.service.ts'), 'utf8');
    const methodStart = serviceSource.indexOf('async payActiveTableBill');
    assert.ok(methodStart >= 0, 'payActiveTableBill exists');
    const invariantAt = serviceSource.indexOf('INV-TABLE-BILL-PAY-CLOSED');
    assert.ok(invariantAt >= 0 && invariantAt < methodStart, 'the invariant is named in the closed method doc comment');
    const methodSource = serviceSource.slice(methodStart);
    assert.ok(methodSource.includes('ServiceUnavailableException'), 'the method fails closed with 503');
    assert.ok(!serviceSource.includes('TAB-PAY-'), 'no generated payment reference remains in the service');
    assert.ok(!serviceSource.includes('paid_online: true'), 'no paid_online marking remains in the service');
    assert.ok(!serviceSource.includes('restaurant_table_service_calls'), 'no service-call write remains in the service');
    const apiSource = readFileSync(resolve(here, '../../../frontend/src/features/storefront/api/storefront.api.ts'), 'utf8');
    assert.ok(apiSource.includes('INV-TABLE-BILL-PAY-CLOSED'), 'the API helper names the invariant');
    assert.ok(!apiSource.includes('paidOnline: true'), 'the API helper never fabricates a paid result');
    assert.ok(!apiSource.includes('REF-${Date.now'), 'no generated fallback reference remains in the API helper');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-TABLE-BILL-PAY-CLOSED').length - 1, 1, 'the invariant entry must exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('table bill pay-closed checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
