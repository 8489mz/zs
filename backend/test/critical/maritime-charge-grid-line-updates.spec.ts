/*
 * Charge grid line updates (INV-MARITIME-CHARGE-GRID-LINE-UPDATES).
 *
 * THE GAP: updateJobCharges deleted ALL charge rows and
 * reinserted the payload, trusting the caller-supplied
 * isInvoiced flag. Every save destroyed invoiced history:
 * re-sent invoiced rows were recreated with fresh ids and
 * caller-chosen amounts, an omitted invoiced row vanished,
 * and a new row could arrive already marked invoiced. The
 * marked-total guard also read the exchange rate through the
 * pool handle inside its own transaction.
 *
 * THE RULE: the grid updates line by line, keyed by the
 * stored row id. The stored is_invoiced flag is authoritative:
 * a caller flag is IGNORED on existing rows (an invoiced row
 * is left byte-untouched however the payload revalues it) and
 * REJECTED on new rows (a new row cannot invent invoiced
 * history). Unknown ids and duplicate ids in one payload are
 * rejected. Stored rows absent from the payload are deleted
 * EXCEPT invoiced rows, which survive omission. The
 * marked-total guard runs over the STORED invoiced rows after
 * the update, converting through the shared resolver on the
 * transaction handle, against the posted maritime_job
 * revenue. A completed job still rejects the whole update.
 * The charges tab maps its rows to this DTO shape (keeping
 * the row id) and never marks a new row invoiced.
 *
 * WHAT THIS PINS, driving the REAL updateJobCharges on PGlite
 * (KWD base, USD live 56 as seeded data; one posted journal
 * with 5600 credit behind job 1):
 * - a tampered invoiced row is byte-untouched and keeps its
 *   flag, a plain row takes new amounts but keeps flag false
 *   despite the caller claiming invoiced, a new row inserts
 *   uninvoiced, and an omitted plain row is deleted;
 * - a new row claiming isInvoiced throws and changes nothing;
 * - an unknown id and duplicate ids throw and change nothing;
 * - an omitted INVOICED row survives omission;
 * - the guard fires over stored invoiced rows even when the
 *   caller marks nothing (job 2: invoiced 200 USD > posted
 *   5600) and the edit rolls back;
 * - a completed job rejects before any write;
 * - source pins: the guard resolves on the transaction
 *   handle, the delete is id-scoped, and the DTO carries id.
 *
 * HONEST LIMIT: the frontend tab mapping is pinned by source
 * read, not proven in a browser; frontend typecheck/vitest
 * were not run here. The guard converts stored invoiced rows
 * at the CURRENT rate (the only signal stored); a large rate
 * move after invoicing can trip it exactly as the old
 * caller-marked guard could -- recorded, not changed here.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  async function charges(jobId: number): Promise<any[]> {
    return (db as any).selectFrom('maritime_job_charges').selectAll().where('job_id', '=', String(jobId)).orderBy('id', 'asc').execute();
  }

  const row = (id: number, code: string, cost: number, sell: number, invoiced: boolean, extra: any = {}): any => ({
    id, chargeCode: code, chargeNameAr: code, chargeNameEn: code, currency: 'USD',
    costAmount: cost, sellAmount: sell, isInvoiced: invoiced, ...extra,
  });

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, status text, customer_id bigint);
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric);
      CREATE TABLE maritime_job_charges (id bigserial PRIMARY KEY, tenant_id text, job_id text, charge_code text, charge_name_ar text, charge_name_en text, currency text, cost_amount numeric, sell_amount numeric, profit_amount numeric, is_local_charge boolean, tax_rate_percent numeric, tax_amount numeric, is_invoiced boolean);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',56,false);
      INSERT INTO maritime_jobs VALUES (1,'t1','active',NULL),(2,'t1','active',NULL),(3,'t1','completed',NULL);
      INSERT INTO maritime_job_charges (id, tenant_id, job_id, charge_code, charge_name_ar, charge_name_en, currency, cost_amount, sell_amount, profit_amount, is_local_charge, tax_rate_percent, tax_amount, is_invoiced) VALUES
        (1,'t1','1','O/F','O/F','O/F','USD',100,100,0,false,0,0,true),
        (2,'t1','1','THC','THC','THC','USD',20,30,10,false,0,0,false),
        (3,'t1','1','DOC','DOC','DOC','USD',5,10,5,false,0,0,false),
        (4,'t1','2','O/F','O/F','O/F','USD',100,200,100,false,0,0,true),
        (5,'t1','2','THC','THC','THC','USD',20,30,10,false,0,0,false);
      INSERT INTO journal_entries (id, tenant_id, status, source_type, source_id) VALUES (1,'t1','posted','maritime_job',1),(2,'t1','posted','maritime_job',2);
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit) VALUES ('t1',1,1130,0,5600),('t1',2,1130,0,5600);
      SELECT setval(pg_get_serial_sequence('maritime_job_charges', 'id'), 5);
    `);

    // 1. Tamper attempt: invoiced row frozen, plain row updated
    // (flag ignored), new row inserted, omitted row deleted.
    const after1: any = await service.updateJobCharges(auth, 1, {
      charges: [
        row(1, 'O/F', 9999, 9999, false),
        row(2, 'THC', 25, 40, true),
        row(undefined as never, 'SEAL', 10, 15, false),
      ],
    } as never);
    assert.equal(after1.length, 3);
    const rows1 = await charges(1);
    const frozen = rows1.find((r: any) => Number(r.id) === 1);
    assert.equal(Number(frozen.cost_amount), 100, 'invoiced cost untouched');
    assert.equal(Number(frozen.sell_amount), 100, 'invoiced sell untouched');
    assert.equal(frozen.is_invoiced, true);
    const edited = rows1.find((r: any) => Number(r.id) === 2);
    assert.equal(Number(edited.sell_amount), 40);
    assert.equal(Number(edited.cost_amount), 25);
    assert.equal(edited.is_invoiced, false, 'the caller flag never marks a row invoiced');
    const added = rows1.find((r: any) => r.charge_code === 'SEAL');
    assert.ok(added, 'new row inserted');
    assert.equal(added.is_invoiced, false);
    assert.equal(rows1.find((r: any) => Number(r.id) === 3), undefined, 'omitted plain row deleted');

    // 2. A new row claiming invoiced throws; nothing changes.
    const before2 = await charges(1);
    await assert.rejects(
      service.updateJobCharges(auth, 1, { charges: [row(2, 'THC', 25, 40, false), row(undefined as never, 'X', 1, 2, true)] } as never),
      /لا يمكن إنشاء بند جديد موسوماً/,
    );
    assert.deepEqual(await charges(1), before2);

    // 3. Unknown id and duplicate ids throw; nothing changes.
    await assert.rejects(
      service.updateJobCharges(auth, 1, { charges: [row(999, 'X', 1, 2, false)] } as never),
      /غير موجود/,
    );
    await assert.rejects(
      service.updateJobCharges(auth, 1, { charges: [row(2, 'THC', 25, 40, false), row(2, 'THC', 25, 40, false)] } as never),
      /مكرر/,
    );
    assert.deepEqual(await charges(1), before2);

    // 4. An omitted INVOICED row survives omission (the plain
    // SEAL row omitted alongside it is correctly deleted).
    await service.updateJobCharges(auth, 1, { charges: [row(2, 'THC', 26, 41, false)] } as never);
    const rows4 = await charges(1);
    assert.equal(rows4.length, 2, 'invoiced row survives, edited row survives, omitted plain row deleted');
    assert.ok(rows4.find((r: any) => Number(r.id) === 1), 'invoiced row still present');
    assert.equal(rows4.find((r: any) => r.charge_code === 'SEAL'), undefined);
    assert.equal(Number(rows4.find((r: any) => Number(r.id) === 2).sell_amount), 41);

    // 5. The guard fires over stored invoiced rows even when the
    // caller marks nothing: job 2's invoiced 200 USD (11200)
    // exceeds its posted 5600, so the edit rolls back.
    const before5 = await charges(2);
    await assert.rejects(
      service.updateJobCharges(auth, 2, { charges: [row(5, 'THC', 21, 31, false)] } as never),
      /تتجاوز فواتير العميل/,
    );
    assert.deepEqual(await charges(2), before5);

    // 6. A completed job rejects before any write.
    await assert.rejects(
      service.updateJobCharges(auth, 3, { charges: [row(undefined as never, 'X', 1, 2, false)] } as never),
      /أعد فتح الشحنة/,
    );

    // 7. Source pins.
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const updateStart = source.indexOf('async updateJobCharges(');
    const forexStart = source.indexOf('async calculateJobForexGainLoss(');
    const updateBody = source.slice(updateStart, forexStart);
    assert.ok(updateBody.includes('resolveFxRate(trx,'), 'the guard must resolve on the transaction handle');
    assert.ok(!updateBody.includes('resolveFreightExchangeRate'), 'no pool-handle rate read inside the transaction');
    assert.ok(updateBody.includes("where('id', 'in'"), 'deletion must be id-scoped');
    assert.ok(updateBody.includes('is_invoiced'), 'the stored flag must drive the logic');
    const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/dto/itemized-charges.dto.ts'), 'utf8');
    assert.ok(dtoSource.includes('id?: number'), 'the DTO must carry the row id');
    const tabSource = readFileSync(resolve(__dirname, '../../../frontend/src/features/maritime-freight/components/job-details/JobChargesTab.tsx'), 'utf8');
    assert.ok(tabSource.includes('toChargePayload'), 'the tab must map rows to the DTO shape');
    assert.ok(tabSource.includes('id: c.id'), 'the tab must forward the row id');
    assert.ok(!tabSource.includes('isInvoiced: true'), 'no new row may claim invoiced from the tab');

    console.log('maritime charge grid line updates checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
