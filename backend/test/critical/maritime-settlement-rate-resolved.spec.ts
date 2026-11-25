/*
New file: backend/test/critical/maritime-settlement-rate-resolved.spec.ts
Pins the agent-settlement exchange-rate rule
(INV-MARITIME-SETTLEMENT-RATE-RESOLVED).

THE GAP: createAgentSettlement computed the local equivalent
with `dto.exchangeRate || 1`, so a foreign-currency settlement
created without an explicit rate was booked at parity — a
100 USD settlement on an EGP tenant recorded a 100 EGP local
equivalent instead of ~4800. The rate field is optional in the
DTO, so omission was API-legal and silent.

THE RULE: the settlement resolves its rate through the same
resolver every other maritime path uses — 1 only for the tenant
base currency, a supplied positive rate, or the registered rate
for the settlement currency; fail closed when no rate exists.
The settlement currency defaults to USD, so an omitted currency
with an omitted rate resolves the registered USD rate, not 1.

WHAT THIS PINS, driving the REAL createAgentSettlement on
PGlite (EGP base tenant, registered USD rate 48):
- USD, no rate -> rate 48, local equivalent 4800.
- USD, supplied rate 50 -> rate 50, local equivalent 5000.
- EGP, no rate -> rate 1, local equivalent 100.
- USD, no registered rate -> BadRequestException, zero rows.
- USD, supplied rate 0 -> BadRequestException, zero rows.
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
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_agent_settlements (id bigserial PRIMARY KEY, tenant_id text, agent_id text, agent_name text, job_id text, job_number text, settlement_type text, currency text, amount numeric, profit_share_percent numeric, local_equivalent_amount numeric, exchange_rate numeric, reference_number text, status text, notes text);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','EGP',1,true),('t1','USD',48,false);
    `);

    const base = { agentName: 'Agent', settlementType: 'debit_note', amount: 100 };

    const resolved = await service.createAgentSettlement(auth, { ...base, currency: 'USD' } as never);
    assert.equal(Number(resolved.exchange_rate), 48);
    assert.equal(Number(resolved.local_equivalent_amount), 4800);
    assert.equal(resolved.currency, 'USD');

    const supplied = await service.createAgentSettlement(auth, { ...base, currency: 'USD', exchangeRate: 50 } as never);
    assert.equal(Number(supplied.exchange_rate), 50);
    assert.equal(Number(supplied.local_equivalent_amount), 5000);

    const baseCurrency = await service.createAgentSettlement(auth, { ...base, currency: 'EGP' } as never);
    assert.equal(Number(baseCurrency.exchange_rate), 1);
    assert.equal(Number(baseCurrency.local_equivalent_amount), 100);

    const omittedCurrency = await service.createAgentSettlement(auth, { ...base } as never);
    assert.equal(omittedCurrency.currency, 'USD');
    assert.equal(Number(omittedCurrency.exchange_rate), 48);

    await pg.exec(`DELETE FROM currency_exchange_rates WHERE tenant_id = 't1' AND currency_code = 'USD'`);
    await assert.rejects(service.createAgentSettlement(auth, { ...base, currency: 'USD' } as never), /سعر صرف/);
    await assert.rejects(
      service.createAgentSettlement(auth, { ...base, currency: 'USD', exchangeRate: 0 } as never),
      /سعر الصرف/,
    );

    const count = await pg.query<{ n: string }>('SELECT count(*)::text AS n FROM maritime_agent_settlements');
    assert.equal(Number(count.rows[0].n), 4);

    console.log('Maritime settlement rate resolved tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
