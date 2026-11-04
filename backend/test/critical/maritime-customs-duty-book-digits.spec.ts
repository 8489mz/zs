/*
 * Customs duty at book digits, flowing to cost/GL, statuses guarded
 * (INV-MARITIME-CUSTOMS-DUTY-BOOK-DIGITS).
 *
 * THE GAP: both duty computations rounded with a hardcoded
 * Math.round(x * 100) / 100 (2dp always), so a 3-decimal tenant
 * lost the third decimal on every duty line and its totals
 * were unrounded sums; the status update allowed any-to-any
 * transitions with no transaction; and clearance posted
 * NOTHING -- the duty never reached cost or the ledger, so
 * landed cost was incomplete.
 *
 * THE RULE: every line duty rounds once at the tenant's book
 * digits and header totals are sums of the rounded lines.
 * Statuses follow a permissive-forward, strict-backward
 * machine (pending -> submitted/cleared/held/rejected,
 * submitted -> cleared/held/rejected, held -> submitted/
 * cleared/rejected, cleared -> terminal, rejected ->
 * submitted/pending). Clearing posts the duty: converted from
 * the declaration currency through the shared resolver at
 * book digits (fail closed with no rate), Dr 6400 (fallback
 * 5100) / Cr 2110 with the job's cost center, partnerType
 * 'none', idempotent per declaration, and rolled into the
 * job's other_costs_total / net_profit by the same formula
 * the other posting paths use -- all inside one transaction,
 * so a failed posting rolls the status change back too.
 *
 * WHAT THIS PINS, driving the REAL declaration methods on
 * PGlite (KWD base, USD live 56 as seeded data, a posting
 * stub that writes real journal rows):
 * - a 100.25 @ 10% line keeps its third decimal (10.025,
 *   where 2dp rounding would give 10.03) and the header
 *   total is the sum of rounded lines;
 * - an added item accumulates at book digits;
 * - cleared -> pending and submitted -> pending are rejected,
 *   while the legal forward moves succeed;
 * - clearing posts Dr 6400 / Cr 2110 at the converted amount
 *   and rolls the job totals, and a second clear is
 *   impossible (cleared is terminal);
 * - a declaration in a currency with no registered rate fails
 *   closed on clear with the status untouched and no journal;
 * - missing expense/payable accounts fail closed on clear
 *   with the status untouched;
 * - source pins: no Math.round duty math remains in either
 *   creation path, and the status method calls the clearance
 *   poster.
 *
 * HONEST LIMIT: the posting branch is stubbed exactly as in
 * the close-posting spec; the end-to-end clearance on live
 * Postgres is a rehearsal item. The supplier subledger is
 * not written (not decided).
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

const approx = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const postingStub = {
    postDomainJournal: async (trx: any, input: any) => {
      const [row] = await trx
        .insertInto('journal_entries')
        .values({
          tenant_id: input.tenantId,
          status: 'posted',
          entry_date: input.entryDate,
          entry_no: `JE-${input.sourceType}-${input.sourceId}`,
          source_type: input.sourceType,
          source_id: input.sourceId,
        })
        .returning('id')
        .execute();
      const id = Number(row.id);
      for (const line of input.lines) {
        await trx
          .insertInto('journal_entry_lines')
          .values({
            tenant_id: input.tenantId,
            journal_entry_id: id,
            account_id: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            cost_center_id: line.costCenterId ?? null,
          })
          .execute();
      }
      return id;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  async function journalLines(sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
    const rows = await (db as any)
      .selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as jl', (j: any) => j.onRef('jl.journal_entry_id', '=', 'je.id'))
      .innerJoin('accounting_accounts as a', (j: any) => j.onRef('a.id', '=', 'jl.account_id'))
      .select(['a.code', 'jl.debit', 'jl.credit'])
      .where('je.source_type', '=', 'maritime_customs_declaration')
      .where('je.source_id', '=', sourceId)
      .execute();
    return rows.map((r: any) => ({ code: String(r.code), debit: Number(r.debit), credit: Number(r.credit) }));
  }

  async function declarationRow(id: number): Promise<any> {
    return (db as any).selectFrom('maritime_customs_declarations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, account_group text, parent_id bigint, is_active boolean, is_system boolean, allow_manual_entries boolean, is_control_account boolean, is_cash_bank boolean, is_receivable boolean, is_payable boolean, is_inventory boolean, is_tax boolean, description_ar text, sort_order int);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, cost_center_id text, client_invoiced_total numeric, carrier_cost_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE maritime_customs_declarations (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, declaration_number text, declaration_type text, customs_authority text, broker_name text, status text, total_customs_value numeric, total_duty_amount numeric, currency text, notes text, created_by bigint, submitted_date date, cleared_date date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE maritime_customs_declaration_items (id bigserial PRIMARY KEY, tenant_id text, declaration_id text, hs_code text, commodity_description text, quantity numeric, unit text, customs_value numeric, duty_rate_percent numeric, duty_amount numeric, notes text);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text, entry_date timestamptz, entry_no text, source_type text, source_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric, description text, partner_type text, partner_id bigint, cost_center_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',56,false);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, name_en, account_type, is_active) VALUES
        (2110,'t1','a1','2110','Payables','liability',true),
        (6400,'t1','a1','6400','Freight Expense','expense',true);
      INSERT INTO maritime_jobs VALUES (1,'t1','JOB-1',NULL,10000,2000,500,7500,NULL);
    `);

    // 1. Creation rounds each line at book digits (3dp).
    const created: any = await service.createCustomsDeclaration(auth, '1', {
      declarationNumber: 'DEC-1',
      currency: 'USD',
      items: [
        { hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 100.25, dutyRatePercent: 10 },
        { hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 50, dutyRatePercent: 10 },
      ],
    } as never);
    const dec1Id = Number(created.declaration.id);
    const lineDuty = Number(created.items[0].dutyAmount);
    assert.ok(lineDuty > 10.02 && lineDuty < 10.03, `3dp duty must keep the third decimal, got ${lineDuty}`);
    assert.equal(Number(created.items[1].dutyAmount), 5);
    approx(Number(created.declaration.totalDutyAmount), 15.025);
    approx(Number((await declarationRow(dec1Id)).total_duty_amount), 15.025);

    // 2. Added items accumulate at book digits.
    const added: any = await service.addCustomsDeclarationItem(auth, String(dec1Id), {
      hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 33.33, dutyRatePercent: 10,
    } as never);
    const addedDuty = Number(added.dutyAmount);
    assert.ok(addedDuty > 3.33 && addedDuty < 3.34, `added duty must keep the third decimal, got ${addedDuty}`);
    approx(Number((await declarationRow(dec1Id)).total_duty_amount), 18.358);

    // 3. Status machine: illegal moves rejected, legal moves pass.
    // A pre-cleared declaration can never move again.
    await pg.exec(`INSERT INTO maritime_customs_declarations (id, tenant_id, job_id, declaration_number, declaration_type, status, total_customs_value, total_duty_amount, currency) VALUES (900,'t1',1,'DEC-0','import','cleared',0,0,'USD')`);
    await assert.rejects(
      service.updateCustomsDeclarationStatus(auth, '900', { status: 'pending' } as never),
      /لا يمكن نقل/,
    );
    assert.equal((await declarationRow(900)).status, 'cleared', 'the failed move leaves the cleared status intact');
    assert.equal((await journalLines(900)).length, 0, 'no journal from a rejected move');
    const created2: any = await service.createCustomsDeclaration(auth, '1', {
      declarationNumber: 'DEC-2', currency: 'USD',
      items: [{ hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 10, dutyRatePercent: 10 }],
    } as never);
    const dec2Id = Number(created2.declaration.id);
    await assert.rejects(
      service.updateCustomsDeclarationStatus(auth, String(dec2Id), { status: 'submitted' } as never).then(async () => {
        await service.updateCustomsDeclarationStatus(auth, String(dec2Id), { status: 'pending' } as never);
      }),
      /لا يمكن نقل/,
    );
    assert.equal((await declarationRow(dec2Id)).status, 'submitted');
    const held: any = await service.updateCustomsDeclarationStatus(auth, String(dec2Id), { status: 'held' } as never);
    assert.equal(held.status, 'held');
    const resubmitted: any = await service.updateCustomsDeclarationStatus(auth, String(dec2Id), { status: 'submitted' } as never);
    assert.equal(resubmitted.status, 'submitted');

    // 4. Clearing posts the converted duty and rolls the job totals;
    // a second clear is impossible (cleared is terminal).
    const created3: any = await service.createCustomsDeclaration(auth, '1', {
      declarationNumber: 'DEC-3', currency: 'USD',
      items: [{ hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 1000, dutyRatePercent: 10 }],
    } as never);
    const dec3Id = Number(created3.declaration.id);
    const cleared: any = await service.updateCustomsDeclarationStatus(auth, String(dec3Id), { status: 'cleared' } as never);
    assert.equal(cleared.status, 'cleared');
    assert.deepEqual(await journalLines(dec3Id), [
      { code: '6400', debit: 5600, credit: 0 },
      { code: '2110', debit: 0, credit: 5600 },
    ]);
    const job = await (db as any).selectFrom('maritime_jobs').select(['other_costs_total', 'net_profit']).where('id', '=', 1).executeTakeFirstOrThrow();
    assert.equal(Number(job.other_costs_total), 6100);
    assert.equal(Number(job.net_profit), 1900);
    await assert.rejects(
      service.updateCustomsDeclarationStatus(auth, String(dec3Id), { status: 'pending' } as never),
      /لا يمكن نقل/,
    );
    assert.equal((await journalLines(dec3Id)).length, 2, 'no second journal from the rejected move');

    // 5. A currency with no registered rate fails closed on clear.
    const created4: any = await service.createCustomsDeclaration(auth, '1', {
      declarationNumber: 'DEC-4', currency: 'EUR',
      items: [{ hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 100, dutyRatePercent: 10 }],
    } as never);
    const dec4Id = Number(created4.declaration.id);
    await assert.rejects(
      service.updateCustomsDeclarationStatus(auth, String(dec4Id), { status: 'cleared' } as never),
      /سعر صرف EUR غير متاح/,
    );
    assert.equal((await declarationRow(dec4Id)).status, 'pending');
    assert.equal((await journalLines(dec4Id)).length, 0);

    // 6. Missing accounts fail closed on clear.
    await pg.exec(`DELETE FROM accounting_accounts WHERE code IN ('6400','2110')`);
    const created5: any = await service.createCustomsDeclaration(auth, '1', {
      declarationNumber: 'DEC-5', currency: 'USD',
      items: [{ hsCode: '8708', commodityDescription: 'Parts', quantity: 1, customsValue: 100, dutyRatePercent: 10 }],
    } as never);
    const dec5Id = Number(created5.declaration.id);
    await assert.rejects(
      service.updateCustomsDeclarationStatus(auth, String(dec5Id), { status: 'cleared' } as never),
      /غير متاح/,
    );
    assert.equal((await declarationRow(dec5Id)).status, 'pending');
    assert.equal((await journalLines(dec5Id)).length, 0);

    // 7. Source pins.
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const createStart = source.indexOf('async createCustomsDeclaration(');
    const addStart = source.indexOf('async addCustomsDeclarationItem(');
    const statusStart = source.indexOf('async updateCustomsDeclarationStatus(');
    const createBody = source.slice(createStart, addStart);
    const addBody = source.slice(addStart, statusStart);
    assert.ok(createBody.includes('roundMoney('), 'creation must round at book digits');
    assert.ok(!createBody.includes('Math.round('), 'no hardcoded 2dp math in creation');
    assert.ok(addBody.includes('roundMoney('), 'item addition must round at book digits');
    assert.ok(!addBody.includes('Math.round('), 'no hardcoded 2dp math in item addition');
    const statusEnd = source.indexOf('// Freight Audit', statusStart);
    const statusBody = source.slice(statusStart, statusEnd);
    assert.ok(statusBody.includes('postCustomsDutyAtClearance'), 'clearing must post the duty');
    assert.ok(statusBody.includes("cleared: []"), 'cleared must be terminal in the machine');

    console.log('maritime customs duty book digits checks passed');
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
