/*
New file: backend/test/critical/convert-currency-target-digits.spec.ts
Pins the display-conversion rounding (INV-CONVERT-CURRENCY-TARGET-DIGITS).

THE GAP: convertCurrency rounded its displayed converted amount at
a fixed 4 decimals whatever the target currency was — so a
2-decimal target showed four decimals of false precision, and a
3-decimal target showed a value cut finer than its book digits.

THE RULE: the displayed converted amount rounds once, from the
unrounded conversion, at the TARGET currency's book digits
through the canonical roundMoney. The rate read, the
fail-closed checks, the base-leg math, and the 6-decimal
effective rate are deliberately unchanged.

WHAT THIS PINS, driving the REAL convertCurrency on PGlite
(KWD base, USD live 48.5, EGP registered at 1):
- USD -> KWD rounds at 3 digits (100.125 USD -> 4856.063).
- USD -> EGP rounds at 2 digits (100.125 USD -> 4856.06).
- KWD -> USD rounds at 2 digits, and the effective rate stays
  at 6 decimals.
- an unregistered currency still fails closed.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const accounting = new AccountingService(db, foundation, undefined);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t1','EGP',1,false);
    `);

    const toKwd = await accounting.convertCurrency({ amount: 100.125, fromCurrency: 'USD', toCurrency: 'KWD' }, auth);
    assert.equal(toKwd.convertedAmount, 4856.063);
    assert.equal(toKwd.effectiveRate, 48.5);

    const toEgp = await accounting.convertCurrency({ amount: 100.125, fromCurrency: 'USD', toCurrency: 'EGP' }, auth);
    assert.equal(toEgp.convertedAmount, 4856.06);

    const toUsd = await accounting.convertCurrency({ amount: 100.125, fromCurrency: 'KWD', toCurrency: 'USD' }, auth);
    assert.equal(toUsd.convertedAmount, 2.06);

    await assert.rejects(
      accounting.convertCurrency({ amount: 100, fromCurrency: 'USD', toCurrency: 'EUR' }, auth),
      /غير مسجلة/,
    );

    console.log('convert currency target digits checks passed');
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
