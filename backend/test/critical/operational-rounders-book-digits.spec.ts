/*
New file: backend/test/critical/operational-rounders-book-digits.spec.ts
Style follows backend/test/critical/cash-drawer-expected-cash-precision.spec.ts
and backend/test/critical/vat-declaration-tenant-jurisdiction.spec.ts
(PGlite + Kysely, imports production service code, no duplicated formulas).

WHAT THIS PINS (U2 D3 operational rounders): the private 2dp rounders
in the daily commercial rollup, margin protection and VAT declaration
services now round through the canonical engine (money-minor-units
roundMoney) at the tenant's book digits, resolved once per method from
tenantBaseCurrency (fail-closed). The cash-drawer service is already
digits-aware (toBookMoney) and its dead legacy 2dp toMoney had zero
callers, so this package only removes it. reports-math.helper.ts is
already digits-aware (its toMoney takes a digits param, default 2) and
is deliberately NOT re-wired here: its pinned toFixed half-cent
semantics (test/infra/reports-summary.helper.spec.ts: toMoney(-10.505)
is -10.51) differ from canonical roundMoney (-10.5), so delegating it
would break that pinned spec; the helper's digits contract is pinned
below instead, and its callers that never pass digits are a follow-up.

WHAT THIS PINS, driving the REAL services on PGlite (one tenant per
case, so no fixture leaks between cases):
- Rollup (KWD tenant): a 100.125 sale stays 100.125 (the old 2dp
  toMoney stored 100.13), COGS 10.125, gross 90, expenses 5.125,
  net 84.875 — in the returned summary, in the stored
  daily_commercial_rollups row, and in the multi-year comparison
  that re-sums stored rows.
- Rollup (EGP tenant): the same 100.125 sale answers 100.13, exactly
  as the old 2dp rounder did — 2dp behaviour is unchanged.
- Margin (KWD tenant): previousCost 9.125, newCost 10.125,
  currentRetailPrice 20.125 and recommendedWholesalePrice 11.912
  (old 2dp: 9.13 / 10.13 / 20.13 / 11.91); recommended retail 13.5.
- Margin (EGP tenant): newCost 10.13, identical to the old 2dp value.
- VAT (EGP tenant, end to end): tax 140.125 answers 140.13 and net
  VAT due 70 — identical to the old 2dp rounder.
- VAT 3dp: a KWD tenant has no declaration form by design
  (VAT_DECLARATION_COUNTRY_UNSUPPORTED), so the 3dp path is pinned
  at the private rounder the live method calls with book digits:
  roundCurrency(100.125, 3) is 100.125, not 100.13.
- reports-math: toMoney(100.125, 3) is 100.125, toMoney(100.125)
  stays 100.13, and sumMoney with digits 3 preserves 3dp.

The fail-without-fix check reverts the three services to their 2dp
rounders: the KWD assertions above must then fail (100.13 instead
of 100.125, 11.91 instead of 11.912).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { DailyCommercialRollupService } from '../../src/modules/reports/services/daily-commercial-rollup.service';
import { MarginProtectionService } from '../../src/modules/purchases/services/margin-protection.service';
import { VatDeclarationService } from '../../src/modules/tax-integration/services/vat-declaration/vat-declaration.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { toMoney, sumMoney } from '../../src/modules/reports/helpers/reports-math.helper';

function authFor(tenantId: string): AuthContext {
  return { tenantId, accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auditStub = { log: async () => {} } as unknown as AuditService;
  const rollup = new DailyCommercialRollupService(db);
  const margin = new MarginProtectionService(db, auditStub);
  const vat = new VatDeclarationService(db);

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, business_name text, owner_name text, owner_phone text);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO tenants VALUES ('t-kwd','KWD Co','Owner','0100'),('t-egp','EGP Co','Owner','0100'),('t-vat','VAT Co','Owner','0100');
      INSERT INTO settings VALUES
        ('t-kwd','currency','KWD'),('t-egp','currency','EGP'),('t-vat','currency','EGP'),('t-vat','country','EG');
      INSERT INTO currency_exchange_rates VALUES ('t-kwd','KWD',true,1),('t-egp','EGP',true,1),('t-vat','EGP',true,1);

      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, branch_id bigint,
        total numeric, payment_type text, payment_channel text, subtotal numeric, discount numeric, service_charge numeric,
        tax_amount numeric, tax_rate numeric, prices_include_tax boolean);
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, qty numeric, cost_price numeric);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, amount numeric, expense_date timestamptz);
      CREATE TABLE daily_commercial_rollups (tenant_id text, rollup_date date, branch_id bigint, branch_key bigint,
        sales_count bigint, sales_total numeric, cash_sales_total numeric, credit_sales_total numeric, cogs_total numeric,
        gross_profit numeric, returns_count bigint, returns_total numeric, expenses_total numeric, net_profit numeric, updated_at timestamptz,
        UNIQUE (tenant_id, rollup_date, branch_key));

      CREATE TABLE suppliers (id bigint PRIMARY KEY, name text);
      CREATE TABLE products (id bigint PRIMARY KEY, name text, barcode text, cost_price numeric, retail_price numeric, wholesale_price numeric);
      CREATE TABLE purchases (id bigint PRIMARY KEY, doc_no text, supplier_id bigint, tenant_id text, status text,
        created_at timestamptz, subtotal numeric, discount numeric, tax_amount numeric, total numeric, tax_rate numeric, prices_include_tax boolean);
      CREATE TABLE purchase_items (id bigint PRIMARY KEY, purchase_id bigint, product_id bigint, tenant_id text,
        unit_cost numeric, total_cost numeric, quantity numeric);

      CREATE TABLE tenant_tax_settings (id serial PRIMARY KEY, tenant_id text, account_id text, provider text, tax_id text, is_active boolean);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz, total numeric);
      CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, allocated_tax numeric);
    `);

    // Identical 3dp rollup + margin fixtures on the KWD and EGP tenants.
    const tenantIds: Array<[string, number]> = [['t-kwd', 1], ['t-egp', 2]];
    for (const [tenant, n] of tenantIds) {
      await pg.exec(`
        INSERT INTO sales VALUES (${n},'${tenant}','posted','2026-10-15 10:00:00+00',NULL,100.125,'cash','cash',100.125,0,0,0,0,false);
        INSERT INTO sale_items VALUES (${n},'${tenant}',${n},1,10.125);
        INSERT INTO expenses VALUES (${n},'${tenant}',NULL,5.125,'2026-10-15 10:00:00+00');
        INSERT INTO suppliers VALUES (${n},'Supplier');
        INSERT INTO products VALUES (${n},'Widget','BAR-1',9.125,20.125,15.125);
        INSERT INTO purchases VALUES (${n},'PO-${n}',${n},'${tenant}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
        INSERT INTO purchase_items VALUES (${n},${n},${n},'${tenant}',10.125,10.125,1);
      `);
    }
    // VAT fixture on its own EGP tenant.
    await pg.exec(`
      INSERT INTO sales VALUES (3,'t-vat','posted','2026-10-15 10:00:00+00',NULL,1140.125,'cash','cash',1000,0,0,140.125,14,false);
      INSERT INTO purchases VALUES (3,'PO-VAT',1,'t-vat','posted','2026-10-15 10:00:00+00',500,0,70.125,570.125,14,false);
      INSERT INTO tenant_tax_settings (tenant_id, account_id, provider, tax_id, is_active) VALUES ('t-vat','a1','ETA_EGYPT','123456789',true);
    `);

    // ---- 1. Rollup, KWD: 3dp preserved end to end ----
    const kwd = await rollup.computeAndStoreDailyRollup('t-kwd', '2026-10-15');
    assert.equal(kwd.salesTotal, 100.125);
    assert.equal(kwd.cashSalesTotal, 100.125);
    assert.equal(kwd.creditSalesTotal, 0);
    assert.equal(kwd.cogsTotal, 10.125);
    assert.equal(kwd.grossProfit, 90);
    assert.equal(kwd.expensesTotal, 5.125);
    assert.equal(kwd.netProfit, 84.875);
    const stored = await (db as any)
      .selectFrom('daily_commercial_rollups')
      .selectAll()
      .where('tenant_id', '=', 't-kwd')
      .executeTakeFirst() as unknown as Record<string, unknown>;
    assert.equal(Number(stored.sales_total), 100.125);
    assert.equal(Number(stored.net_profit), 84.875);
    const kwdYears = await rollup.getHistoricalMultiYearComparison('t-kwd', [2026]);
    assert.equal(kwdYears.length, 1);
    assert.equal(kwdYears[0].salesTotal, 100.125);
    assert.equal(kwdYears[0].cogsTotal, 10.125);
    assert.equal(kwdYears[0].netProfit, 84.875);

    // ---- 2. Rollup, EGP: 2dp behaviour identical to the old rounder ----
    const egp = await rollup.computeAndStoreDailyRollup('t-egp', '2026-10-15');
    assert.equal(egp.salesTotal, 100.13);
    assert.equal(egp.cogsTotal, 10.13);
    assert.equal(egp.grossProfit, 90);
    assert.equal(egp.expensesTotal, 5.13);
    assert.equal(egp.netProfit, 84.87);

    // ---- 3. Margin, KWD: 3dp preserved ----
    const kwdMargin = await margin.analyzePurchaseMargins(1, 25, authFor('t-kwd'));
    assert.equal(kwdMargin.items.length, 1);
    const kwdItem = kwdMargin.items[0];
    assert.equal(kwdItem.previousCost, 9.125);
    assert.equal(kwdItem.newCost, 10.125);
    assert.equal(kwdItem.currentRetailPrice, 20.125);
    assert.equal(kwdItem.currentWholesalePrice, 15.125);
    assert.equal(kwdItem.recommendedRetailPrice, 13.5);
    assert.equal(kwdItem.recommendedWholesalePrice, 11.912);
    assert.equal(kwdItem.costChangePercent, 11);
    assert.equal(kwdItem.currentMarginPercent, 49.7);
    assert.equal(kwdItem.previousMarginPercent, 54.7);

    // ---- 4. Margin, EGP: 2dp behaviour identical to the old rounder ----
    const egpMargin = await margin.analyzePurchaseMargins(2, 25, authFor('t-egp'));
    assert.equal(egpMargin.items.length, 1);
    assert.equal(egpMargin.items[0].previousCost, 9.13);
    assert.equal(egpMargin.items[0].newCost, 10.13);
    assert.equal(egpMargin.items[0].currentRetailPrice, 20.13);
    assert.equal(egpMargin.items[0].recommendedWholesalePrice, 11.91);

    // ---- 5. VAT, EGP end to end: 2dp behaviour identical ----
    const declaration = await vat.getDeclaration({ from: '2026-10-01', to: '2026-10-31' }, authFor('t-vat'));
    assert.equal(declaration.period.country, 'EG');
    assert.equal(declaration.output_tax.standard_rated_tax, 140.13);
    assert.equal(declaration.output_tax.total_output_vat, 140.13);
    assert.equal(declaration.input_tax.standard_rated_tax, 70.13);
    assert.equal(declaration.input_tax.total_input_vat, 70.13);
    assert.equal(declaration.summary.net_vat_due, 70);

    // ---- 6. VAT 3dp pin at the rounder the live method calls ----
    // No KW declaration form exists by design, so the 3dp VAT path is
    // pinned on the private rounder itself (same method getDeclaration
    // calls with book digits).
    assert.equal((vat as any).roundCurrency(100.125, 3), 100.125);
    assert.equal((vat as any).roundCurrency(100.125, 2), 100.13);

    // ---- 7. reports-math digits contract (helper already digits-aware) ----
    assert.equal(toMoney(100.125, 3), 100.125);
    assert.equal(toMoney(100.125), 100.13);
    assert.equal(sumMoney([{ v: 100.125 }, { v: 0.005 }], (row) => row.v, 3), 100.13);
    assert.equal(sumMoney([{ v: 100.125 }], (row) => row.v), 100.13);

    console.log('Operational rounders book digits tests passed');
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
