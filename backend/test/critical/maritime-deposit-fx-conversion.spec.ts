/*
New file: backend/test/critical/maritime-deposit-fx-conversion.spec.ts
Pins the container-deposit FX conversion (INV-MARITIME-DEPOSIT-FX-CONVERSION).

THE GAP: the container-deposit 'open' journal read its rate with an
inline query and converted at hard-coded 2 decimals
(Math.round(*100)/100), bypassing both the shared resolver and the
shared conversion engine — so a 3-decimal tenant's deposit was cut
to cents at posting time, and a settings/rate mismatch silently
resolved through the row's is_base flag instead of failing closed.

THE RULE: the 'open' branch resolves through resolveFxRate on the
same transaction and converts through convertFxAmount at the base
currency's book digits. The refund/forfeit branches are deliberately
unchanged: they reuse the opening journal's stored debit, keeping
the historical rate the deposit was booked at.

WHAT THIS PINS, driving the REAL postContainerDepositJournal on
PGlite (KWD base, USD live 48.5, stubbed posting service):
- a USD deposit converts at base digits (100.125 -> 4856.063).
- a base-currency deposit converts at rate 1 at base digits.
- a missing rate fails closed with zero journals posted.
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
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
      INSERT INTO accounting_accounts VALUES (10,'t1','1170',true),(20,'t1','1110',true);
      INSERT INTO accounting_settings VALUES (1,'t1',NULL,NULL,NULL);
    `);

    await (service as any).postContainerDepositJournal(db, 't1', '7', 100.125, 'USD', 'open', 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceType, 'maritime_container_deposit_open');
    assert.equal(Number(calls[0].lines[0].debit), 4856.063);
    assert.equal(Number(calls[0].lines[1].credit), 4856.063);

    await (service as any).postContainerDepositJournal(db, 't1', '8', 100.125, 'KWD', 'open', 1);
    assert.equal(calls.length, 2);
    assert.equal(Number(calls[1].lines[0].debit), 100.125);

    await pg.exec(`DELETE FROM currency_exchange_rates WHERE tenant_id = 't1' AND currency_code = 'USD'`);
    await assert.rejects(
      (service as any).postContainerDepositJournal(db, 't1', '9', 100, 'USD', 'open', 1),
      /غير متاح/,
    );
    assert.equal(calls.length, 2);

    console.log('maritime deposit fx conversion checks passed');
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
