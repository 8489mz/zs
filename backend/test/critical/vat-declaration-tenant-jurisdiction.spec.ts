/*
New file: backend/test/critical/vat-declaration-tenant-jurisdiction.spec.ts
Pins the VAT declaration jurisdiction and identity rules
(INV-VAT-DECLARATION-TENANT-JURISDICTION).

THE GAP: getDeclaration took the country from the caller's query
string, so any caller could request another country's form, rate
and currency for any tenant; and when the tenant had no tax
registration it printed a fixed fabricated tax number
('300000000000003') on the form.

THE RULE: the country follows the tenant's own settings — an
explicit country setting wins, the base currency maps second —
and the caller's country is ignored. An unresolved jurisdiction
or a jurisdiction outside EG/SA fails closed (no form exists
for KW/QA/OM). A missing tax registration fails closed too:
no placeholder number is ever printed.

WHAT THIS PINS, driving the REAL getDeclaration on PGlite:
- country setting SA beats currency EGP and beats the caller's
  EG: SA form, 15%, SAR, registered tax number.
- currency-only SAR (no country setting): SA form.
- currency-only EGP (no country setting): EG form, 14%, EGP.
- no tax settings row: VAT_DECLARATION_TAX_ID_MISSING.
- country KW: VAT_DECLARATION_COUNTRY_UNSUPPORTED.
- no country and no currency settings:
  VAT_DECLARATION_COUNTRY_UNRESOLVED.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VatDeclarationService } from '../../src/modules/tax-integration/services/vat-declaration/vat-declaration.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AppError } from '../../src/common/errors/app-error';

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new VatDeclarationService(db);
  const query = { from: '2026-10-01', to: '2026-10-31', country: 'EG' } as never;

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY, business_name text, owner_name text, owner_phone text);
      CREATE TABLE tenant_tax_settings (id serial PRIMARY KEY, tenant_id text, account_id text, provider text, tax_id text, is_active boolean);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, subtotal numeric, discount numeric, service_charge numeric, tax_amount numeric, total numeric, tax_rate numeric, prices_include_tax boolean);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, subtotal numeric, discount numeric, tax_amount numeric, total numeric, tax_rate numeric, prices_include_tax boolean);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz, total numeric);
      CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, allocated_tax numeric);
      INSERT INTO tenants VALUES ('t1','Test Co','Owner','0100');
      INSERT INTO sales VALUES (1,'t1','posted','2026-10-15',1000,0,0,140,1140,14,false);
      INSERT INTO purchases VALUES (1,'t1','posted','2026-10-15',500,0,70,570,14,false);
      INSERT INTO settings VALUES ('t1','country','SA'),('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      INSERT INTO tenant_tax_settings (tenant_id, account_id, provider, tax_id, is_active) VALUES ('t1','a1','ZATCA','310123456700003',true);
    `);

    // 1. Explicit country setting wins over currency and caller.
    const sa = await service.getDeclaration(query, auth);
    assert.equal(sa.period.country, 'SA');
    assert.equal(sa.period.standard_rate_percent, 15);
    assert.equal(sa.summary.currency, 'SAR');
    assert.equal(sa.entity.tax_id, '310123456700003');
    assert.equal(sa.output_tax.standard_rated_tax, 140);

    // 2. Currency-only derivation: SAR -> SA.
    await pg.exec(`DELETE FROM settings WHERE tenant_id = 't1' AND key = 'country'`);
    await pg.exec(`UPDATE settings SET value = 'SAR' WHERE tenant_id = 't1' AND key = 'currency'`);
    await pg.exec(`UPDATE currency_exchange_rates SET currency_code = 'SAR' WHERE tenant_id = 't1' AND is_base = true`);
    const saByCurrency = await service.getDeclaration(query, auth);
    assert.equal(saByCurrency.period.country, 'SA');

    // 3. Currency-only derivation: EGP -> EG.
    await pg.exec(`UPDATE settings SET value = 'EGP' WHERE tenant_id = 't1' AND key = 'currency'`);
    await pg.exec(`UPDATE currency_exchange_rates SET currency_code = 'EGP' WHERE tenant_id = 't1' AND is_base = true`);
    await pg.exec(
      `INSERT INTO tenant_tax_settings (tenant_id, account_id, provider, tax_id, is_active) VALUES ('t1','a1','ETA_EGYPT','123456789',true)`,
    );
    const eg = await service.getDeclaration(query, auth);
    assert.equal(eg.period.country, 'EG');
    assert.equal(eg.period.standard_rate_percent, 14);
    assert.equal(eg.summary.currency, 'EGP');
    assert.equal(eg.entity.tax_id, '123456789');

    // 4. No tax registration: fail closed, never a fabricated number.
    await pg.exec(`DELETE FROM tenant_tax_settings WHERE tenant_id = 't1'`);
    await expectCode(service.getDeclaration(query, auth), 'VAT_DECLARATION_TAX_ID_MISSING');

    // 5. Supported-currency tenant outside EG/SA: fail closed.
    await pg.exec(
      `INSERT INTO tenant_tax_settings (tenant_id, account_id, provider, tax_id, is_active) VALUES ('t1','a1','ETA_EGYPT','123456789',true)`,
    );
    await pg.exec(`INSERT INTO settings VALUES ('t1','country','KW')`);
    await expectCode(service.getDeclaration(query, auth), 'VAT_DECLARATION_COUNTRY_UNSUPPORTED');

    // 6. No jurisdiction settings at all: fail closed.
    await pg.exec(`DELETE FROM settings WHERE tenant_id = 't1'`);
    await expectCode(service.getDeclaration(query, auth), 'VAT_DECLARATION_COUNTRY_UNRESOLVED');

    console.log('VAT declaration tenant jurisdiction tests passed.');
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
