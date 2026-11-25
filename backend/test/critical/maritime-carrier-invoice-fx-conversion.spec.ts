/*
New file: backend/test/critical/maritime-carrier-invoice-fx-conversion.spec.ts
Pins the carrier-invoice journal FX conversion (INV-MARITIME-CARRIER-INVOICE-FX-CONVERSION).

THE GAP: postCarrierInvoiceJournal resolved its rate through the
shared resolver but converted at hard-coded 2 decimals
(Math.round(*100)/100), bypassing the shared conversion engine —
so a 3-decimal tenant's carrier invoice was cut to cents at posting
time, and the job's carrier-cost total and net profit accumulated
the cut amount.

THE RULE: the carrier-invoice journal converts through
convertFxAmount at the base currency's book digits. No rate
resolution behavior changes: the rate already came from the shared
resolver.

WHAT THIS PINS, driving the REAL postCarrierInvoiceJournal on
PGlite (KWD base, USD live 48.5, stubbed posting service):
- a USD carrier invoice converts at base digits (100.125 -> 4856.063)
  and rolls the converted amount into carrier_cost_total/net_profit.
- a base-currency carrier invoice converts at rate 1 at base digits.
- a missing rate fails closed with zero journals posted and the job
  totals untouched.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
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
  const calls: Array<{ sourceType: string; lines: Array<{ debit: number; credit: number }> }> = [];
  const postingStub = {
    postDomainJournal: async (
      _trx: unknown,
      input: { sourceType: string; lines: Array<{ debit: number; credit: number }> },
    ) => {
      calls.push({ sourceType: input.sourceType, lines: input.lines });
      return 900;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, cost_center_id bigint, shipping_line_name text, carrier_cost_total numeric, client_invoiced_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE shipping_lines (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, notes text, is_active boolean);
      CREATE TABLE accounting_supplier_links (tenant_id text, domain text, domain_id text, supplier_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
      INSERT INTO accounting_accounts VALUES (30,'t1','6400',true),(40,'t1','2110',true);
      INSERT INTO accounting_settings VALUES (1,'t1',NULL,NULL,NULL);
      INSERT INTO shipping_lines VALUES (9,'t1');
      INSERT INTO maritime_jobs VALUES (1,'t1','JOB-1',NULL,'Line',0,10000,0,10000,NULL);
    `);

    await (service as any).postCarrierInvoiceJournal(db, 't1', {
      job: { id: 1, job_number: 'JOB-1', shipping_line_name: 'Line' },
      invoiceNumber: 'INV-1',
      carrierName: 'Line',
      shippingLineId: 9,
      totalAmount: 100.125,
      currency: 'USD',
      entryDate: new Date(),
      userId: 1,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceType, 'maritime_carrier_invoice');
    assert.equal(Number(calls[0].lines[0].debit), 4856.063);
    assert.equal(Number(calls[0].lines[1].credit), 4856.063);
    const jobAfterUsd = await db
      .selectFrom('maritime_jobs' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(Number((jobAfterUsd as any).carrier_cost_total), 4856.063);
    assert.equal(Number((jobAfterUsd as any).net_profit), 5143.937);

    await (service as any).postCarrierInvoiceJournal(db, 't1', {
      job: { id: 1, job_number: 'JOB-1', shipping_line_name: 'Line' },
      invoiceNumber: 'INV-2',
      carrierName: 'Line',
      shippingLineId: 9,
      totalAmount: 100.125,
      currency: 'KWD',
      entryDate: new Date(),
      userId: 1,
    });
    assert.equal(calls.length, 2);
    assert.equal(Number(calls[1].lines[0].debit), 100.125);

    await pg.exec(`DELETE FROM currency_exchange_rates WHERE tenant_id = 't1' AND currency_code = 'USD'`);
    await assert.rejects(
      (service as any).postCarrierInvoiceJournal(db, 't1', {
        job: { id: 1, job_number: 'JOB-1', shipping_line_name: 'Line' },
        invoiceNumber: 'INV-3',
        carrierName: 'Line',
        shippingLineId: 9,
        totalAmount: 100,
        currency: 'USD',
        entryDate: new Date(),
        userId: 1,
      }),
      /غير متاح/,
    );
    assert.equal(calls.length, 2);
    const jobAfterFail = await db
      .selectFrom('maritime_jobs' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(Number((jobAfterFail as any).carrier_cost_total), 4956.188);

    console.log('maritime carrier invoice fx conversion checks passed');
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
