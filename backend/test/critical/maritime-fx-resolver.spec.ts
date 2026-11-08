/*
New file: backend/test/critical/maritime-fx-resolver.spec.ts
Pins the maritime FX routing (F2: INV-MARITIME-QUOTATION-FX-RESOLVED
+ INV-MARITIME-QUOTATION-FX-CONVERSION + INV-FX-CONVERSION-SINGLE-ENGINE).

THE GAP: createQuotation was the last inline FX site in maritime.
It read the base currency from settings with a fail-open 'EGP'
default, trusted Number(dto.exchangeRate) unchecked, and converted
the local total at a fixed 4dp cut -- so a USD quotation created
without a rate threw a bare positivity error while a quotation
with a stale client rate priced at that rate, and the stored local
total (4856.0625) could not sit in books that hold 2dp or 3dp.
The freight-audit engine likewise did its own rate math with
hand-rolled Math.round(*1000)/1000 cuts instead of the shared
conversion primitive.

THE RULE: the quotation rate resolves through the shared resolver
(supplied rate validated, omitted rate = live registered rate,
base currency = 1, missing rate fails closed) and the local total
converts through convertFxAmount at the base currency's book
digits. The audit engine converts each contracted component
through convertFxAmount at the caller's book digits (default 3 =
its historical cut); the live preview caller passes the tenant's
book digits. The F6 agent-settlement default-1 is already safe
(createAgentSettlement resolves through the same resolver) and
stays pinned by maritime-settlement-rate-resolved.spec.ts.

WHAT THIS PINS, driving the REAL createQuotation /
createCarrierInvoice on PGlite and the REAL calculateFreightAudit:
- KWD, USD, no rate -> registered 48.5, local 4856.063 (3dp).
- EGP, USD, no rate -> registered 48.5, local 4856.06 (2dp).
- KWD, USD, supplied 48.555 -> rate 48.555, local 4861.569, roe 48.555.
- EGP, EGP, no rate -> rate 1, local 100.13 (2dp, not 100.125).
- USD, no registered rate -> resolver 'غير متاح', zero rows.
- USD, supplied rate 0 -> resolver positivity error, zero rows.
- Percentage margin still flows through the resolver (110 -> 5335).
- Audit engine, default digits: a USD card at 48.5 against an EGP
  invoice converts per unit (ocean diff 143.937, not 143.938).
- Audit engine, moneyDigits 2: rate per unit 4856.06, variance 143.94.
- Audit engine, mismatched currencies with no rate -> currency_mismatch.
- Audit engine, same currency with no rate -> converts at 1.
- Live preview wiring: createCarrierInvoice on an EGP tenant stores
  contracted 100.13 / variance 99.87 / pct 99.74 (2dp) for a USD
  card of 100.125 invoiced at 200 (overcharge branch, no journal).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { calculateFreightAudit } from '../../src/modules/maritime-freight/engines/freight-audit.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const authT1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const authT2 = { tenantId: 't2', accountId: 'a2', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const authT3 = { tenantId: 't3', accountId: 'a3', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const calls: Array<{ sourceType: string; lines: Array<{ debit: number; credit: number }> }> = [];
  const postingStub = {
    postDomainJournal: async (_trx: unknown, input: { sourceType: string; lines: Array<{ debit: number; credit: number }> }) => {
      calls.push({ sourceType: input.sourceType, lines: input.lines });
      return 900;
    },
  };
  const service = new MaritimeFreightService(db, {} as never, {} as never, postingStub as never);

  const quoteCount = async (tenantId: string): Promise<number> => {
    const rows: any[] = await (db as any).selectFrom('maritime_quotations').selectAll()
      .where('tenant_id', '=', tenantId).execute();
    return rows.length;
  };

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_quotations (id bigserial PRIMARY KEY, tenant_id text, quotation_number text, inquiry_id text, rfq_id text, bid_id text, customer_id bigint, customer_name text, customer_phone text, customer_email text, transport_mode text, air_cargo_type text, gross_weight_kg numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric, total_cbm numeric, package_count int, flight_number text, flight_date text, mawb_number text, hawb_number text, payment_term text, base_cost numeric, currency text, margin_type text, margin_value numeric, final_total numeric, exchange_rate numeric, final_total_local numeric, valid_until text, quote_roe numeric, roe_clause_text text, is_split_currency boolean, foreign_currency text, foreign_currency_amount numeric, local_currency_amount numeric, acid_number text, status text, notes text, created_by bigint);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, job_number text, status text, shipping_line_id bigint, shipping_line_name text, pol_code text, pod_code text, customer_id bigint, cost_center_id bigint, carrier_cost_total numeric, client_invoiced_total numeric, other_costs_total numeric, net_profit numeric, updated_at timestamptz);
      CREATE TABLE maritime_containers (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_job_milestones (id bigint PRIMARY KEY, tenant_id text, job_id bigint, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_warehouse_receipts (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigint PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_rate_cards (id bigint PRIMARY KEY, tenant_id text, pol_code text, pod_code text, status text, currency text, valid_from date, valid_until date, shipping_line_id bigint, container_type text, total_freight_cost numeric);
      CREATE TABLE maritime_carrier_invoices (id bigserial PRIMARY KEY, tenant_id text, job_id bigint, shipping_line_id bigint, carrier_name text, invoice_number text, invoice_date date, currency text, total_invoiced_amount numeric, ocean_freight numeric, thc_charges numeric, baf_charges numeric, detention_demurrage numeric, other_charges numeric, rate_card_id bigint, contracted_amount numeric, variance_amount numeric, variance_pct numeric, audit_status text, override_approved_by bigint, override_approved_at timestamptz, override_reason text, journal_entry_id bigint, payment_status text, notes text, created_by bigint);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_active boolean);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
      CREATE TABLE shipping_lines (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, notes text, is_active boolean);
      CREATE TABLE accounting_supplier_links (tenant_id text, domain text, domain_id text, supplier_id bigint);
      INSERT INTO settings VALUES ('t1','currency','KWD'),('t2','currency','EGP'),('t3','currency','EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',48.5,false),('t2','EGP',1,true),('t2','USD',48.5,false),('t3','EGP',1,true),('t3','USD',48.5,false);
      INSERT INTO accounting_accounts VALUES (30,'t2','6400',true),(40,'t2','2110',true);
      INSERT INTO accounting_settings VALUES (1,'t2',NULL,NULL,NULL);
      INSERT INTO shipping_lines VALUES (9,'t2');
      INSERT INTO maritime_jobs VALUES (1,'t2','JOB-1','booked',9,'Line','AEDXB','EGALY',NULL,NULL,0,10000,0,10000,NULL);
      INSERT INTO maritime_rate_cards (id, tenant_id, pol_code, pod_code, status, currency, valid_from, valid_until, shipping_line_id, container_type, total_freight_cost) VALUES (1,'t2','AEDXB','EGALY','active','USD','2020-01-01','2099-01-01',9,'40HC',100.125);
    `);

    const quoteDto = (overrides: Record<string, unknown> = {}): any => ({
      customerName: 'Acme', currency: 'USD', baseCost: 100.125, marginType: 'fixed', marginValue: 0, ...overrides,
    });

    // 1. KWD, USD, no rate: the live registered rate resolves, local at 3dp.
    const q1: any = await service.createQuotation(authT1, quoteDto());
    assert.equal(Number(q1.exchange_rate), 48.5);
    assert.equal(Number(q1.final_total), 100.125);
    assert.equal(Number(q1.final_total_local), 4856.063);
    assert.equal(Number(q1.quote_roe), 48.5);

    // 2. EGP, USD, no rate: same rate, local at 2dp.
    const q2: any = await service.createQuotation(authT2, quoteDto());
    assert.equal(Number(q2.exchange_rate), 48.5);
    assert.equal(Number(q2.final_total_local), 4856.06);

    // 3. KWD, USD, supplied rate 48.555: the supplied rate stands after validation.
    const q3: any = await service.createQuotation(authT1, quoteDto({ exchangeRate: 48.555 }));
    assert.equal(Number(q3.exchange_rate), 48.555);
    assert.equal(Number(q3.final_total_local), 4861.569);
    assert.equal(Number(q3.quote_roe), 48.555);

    // 4. EGP tenant, EGP currency, no rate: base resolves to 1, local at 2dp.
    const q4: any = await service.createQuotation(authT2, quoteDto({ currency: 'EGP' }));
    assert.equal(Number(q4.exchange_rate), 1);
    assert.equal(Number(q4.final_total_local), 100.13);

    // 5. USD with no registered rate fails closed through the resolver.
    await pg.exec(`DELETE FROM currency_exchange_rates WHERE tenant_id = 't3' AND currency_code = 'USD'`);
    await assert.rejects(service.createQuotation(authT3, quoteDto()), /غير متاح/);
    assert.equal(await quoteCount('t3'), 0, 'failed quotation creates no row');

    // 6. A supplied rate of 0 fails closed through the resolver.
    await assert.rejects(service.createQuotation(authT3, quoteDto({ exchangeRate: 0 })), /موجباً وصالحاً/);
    assert.equal(await quoteCount('t3'), 0);

    // 7. Percentage margin still flows through the resolver.
    const q7: any = await service.createQuotation(authT1, quoteDto({ baseCost: 100, marginType: 'percentage', marginValue: 10 }));
    assert.equal(Number(q7.final_total), 110);
    assert.equal(Number(q7.final_total_local), 5335);

    // 8. Audit engine, default digits: each component converts per
    // unit through the shared engine (ocean diff 143.937, not the
    // hand-rolled 143.938).
    const audit3 = calculateFreightAudit({
      invoicedTotal: 5000,
      invoicedCurrency: 'EGP',
      oceanFreight: 5000,
      thcCharges: 0,
      bafCharges: 0,
      otherCharges: 0,
      rateCard: { id: 1, carrierName: 'Line', totalFreightCost: 100.125, oceanFreight: 100.125, thcOrigin: 0, thcDestination: 0, bafCharges: 0, otherCharges: 0, currency: 'USD' },
      containerCount: 1,
      exchangeRate: 48.5,
    });
    assert.equal(audit3.contractedRatePerUnit, 4856.063);
    assert.equal(audit3.contractedTotal, 4856.063);
    assert.equal(audit3.varianceAmount, 143.937);
    assert.equal(audit3.varianceBreakdown.oceanFreightDiff, 143.937);
    assert.equal(audit3.auditStatus, 'overcharge');

    // 9. Audit engine, moneyDigits 2: the same conversion rounds at 2dp.
    const audit2 = calculateFreightAudit({
      invoicedTotal: 5000,
      invoicedCurrency: 'EGP',
      oceanFreight: 5000,
      thcCharges: 0,
      bafCharges: 0,
      otherCharges: 0,
      rateCard: { id: 1, carrierName: 'Line', totalFreightCost: 100.125, oceanFreight: 100.125, thcOrigin: 0, thcDestination: 0, bafCharges: 0, otherCharges: 0, currency: 'USD' },
      containerCount: 1,
      exchangeRate: 48.5,
      moneyDigits: 2,
    });
    assert.equal(audit2.contractedRatePerUnit, 4856.06);
    assert.equal(audit2.contractedTotal, 4856.06);
    assert.equal(audit2.varianceAmount, 143.94);
    assert.equal(audit2.varianceBreakdown.oceanFreightDiff, 143.94);

    // 10. Audit engine: mismatched currencies with no rate still fail closed.
    const mismatch = calculateFreightAudit({
      invoicedTotal: 5000,
      invoicedCurrency: 'EGP',
      rateCard: { id: 1, carrierName: 'Line', totalFreightCost: 100, currency: 'USD' },
      containerCount: 1,
    });
    assert.equal(mismatch.auditStatus, 'currency_mismatch');
    assert.equal(mismatch.currencyMismatch, true);

    // 11. Audit engine: same currency with no rate converts at 1.
    const same = calculateFreightAudit({
      invoicedTotal: 2000,
      invoicedCurrency: 'USD',
      oceanFreight: 1600,
      thcCharges: 350,
      bafCharges: 50,
      otherCharges: 0,
      rateCard: { id: 1, carrierName: 'Line', totalFreightCost: 2000, oceanFreight: 1600, thcOrigin: 200, thcDestination: 150, bafCharges: 50, otherCharges: 0, currency: 'USD' },
      containerCount: 1,
    });
    assert.equal(same.contractedTotal, 2000);
    assert.equal(same.auditStatus, 'matched');

    // 12. Live preview wiring: createCarrierInvoice on the EGP tenant
    // stores the audit at 2dp (overcharge branch posts no journal).
    const created: any = await service.createCarrierInvoice(authT2, '1', {
      invoiceNumber: 'MSCU-200',
      totalInvoicedAmount: 200,
      currency: 'USD',
      exchangeRate: 48.5,
      shippingLineId: 9,
      carrierName: 'Line',
    } as never);
    assert.equal(created.success, true);
    assert.equal(created.invoice.audit_status, 'overcharge');
    assert.equal(calls.length, 0);
    const stored: any = await (db as any).selectFrom('maritime_carrier_invoices').selectAll()
      .where('invoice_number', '=', 'MSCU-200').executeTakeFirstOrThrow();
    assert.equal(Number(stored.contracted_amount), 100.13);
    assert.equal(Number(stored.variance_amount), 99.87);
    assert.equal(Number(stored.variance_pct), 99.74);

    console.log('maritime fx resolver checks passed');
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
