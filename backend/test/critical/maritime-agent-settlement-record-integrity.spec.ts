/*
New file: backend/test/critical/maritime-agent-settlement-record-integrity.spec.ts
Pins INV-MARITIME-AGENT-SETTLEMENT-RECORD-INTEGRITY.

THE GAP, two halves of one record:
(a) createAgentSettlement stored local_equivalent_amount as the raw
float product amount * rate -- 4856.0625 for a KWD tenant, a fourth
decimal the books cannot hold, while every sibling maritime posting
converts at the tenant's book digits through the shared engine.
(b) the generated reference_number used a random 4-digit sequence
(Math.random), so two settlements on the same day could share a
number; every other numbered maritime document derives its sequence
from the returned row identity instead.

THE RULE: the local equivalent converts through convertFxAmount at
the tenant's book digits, and a generated reference number is the
id-derived daily number (PREFIX-YYMMDD-<id padded to 4>) written by
the temp-then-rename pattern in the same transaction. A
caller-supplied reference number is kept verbatim.

WHAT THIS PINS, driving the REAL createAgentSettlement on PGlite:
- KWD base, USD 100.125 @ 48.5: local equivalent 4856.063 (3dp),
  reference APS-<today>-<id>;
- a second settlement gets a different id-derived number;
- debit_note / credit_note prefixes ADN / ACN;
- a caller-supplied reference number is kept verbatim;
- EGP base (2dp), USD 100.005 @ 48.5: local equivalent 4850.24.

NOT COVERED HERE (decision-blocked, grounding note M6b/M6d): the SOA
mixed-currency totals and the absence of a GL posting for
settlements. The day embedded in the number is host-local, exactly as
every other maritime numbered document (the numbering util records
tenant-timezone resolution as remaining work for all of them).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatDailyDocumentNumber } from '../../src/common/utils/document-number.util';

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
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
    `);

    const dto = (over: Record<string, unknown>) => ({
      agentName: 'Agent',
      settlementType: 'profit_share',
      currency: 'USD',
      amount: 100.125,
      exchangeRate: 48.5,
      ...over,
    });

    // 1. KWD: 3dp conversion + id-derived APS number.
    const first = await service.createAgentSettlement(auth, dto({}) as never);
    assert.equal(Number(first.local_equivalent_amount), 4856.063);
    assert.equal(first.reference_number, formatDailyDocumentNumber('APS', Number(first.id)));
    assert.equal(first.status, 'pending');

    // 2. Second settlement: different id-derived number.
    const second = await service.createAgentSettlement(auth, dto({ amount: 50 }) as never);
    assert.notEqual(second.reference_number, first.reference_number);
    assert.equal(second.reference_number, formatDailyDocumentNumber('APS', Number(second.id)));

    // 3. Prefixes per settlement type.
    const debit = await service.createAgentSettlement(auth, dto({ settlementType: 'debit_note' }) as never);
    assert.equal(debit.reference_number, formatDailyDocumentNumber('ADN', Number(debit.id)));
    const credit = await service.createAgentSettlement(auth, dto({ settlementType: 'credit_note' }) as never);
    assert.equal(credit.reference_number, formatDailyDocumentNumber('ACN', Number(credit.id)));

    // 4. Caller-supplied reference number kept verbatim.
    const supplied = await service.createAgentSettlement(auth, dto({ referenceNumber: 'AGT-2026-001' }) as never);
    assert.equal(supplied.reference_number, 'AGT-2026-001');

    // 5. EGP base: 2dp conversion.
    await pg.exec(`UPDATE settings SET value = 'EGP' WHERE tenant_id = 't1' AND key = 'currency'`);
    await pg.exec(`UPDATE currency_exchange_rates SET is_base = (currency_code = 'EGP') WHERE tenant_id = 't1'`);
    const egp = await service.createAgentSettlement(auth, dto({ amount: 100.005 }) as never);
    assert.equal(Number(egp.local_equivalent_amount), 4850.24);

    console.log('maritime agent settlement record integrity checks passed');
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
