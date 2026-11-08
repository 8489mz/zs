/*
 * Maritime freight tax (T2, unification batch U1).
 *
 * THE GAP: createQuotation, createJob and updateJobCharges each
 * computed a freight charge's tax inline from the client-sent
 * chg.taxRatePercent (taxAmt = base * taxPct / 100) and stored it
 * as tax_rate_percent / tax_amount. Any rate the client sent was
 * accepted -- 7% on a 15% tenant, a typo, a stale rate -- with no
 * check against the tenant's configured rate.
 *
 * THE RULE: the rate at all three sites resolves through the
 * canonical engine resolveSaleTaxRate(payloadRate, configuredRate):
 * exactly the tenant's configured settings rate (taxRate, legacy
 * tax_rate fallback) or 0 (exempt); anything else throws
 * SALE_TAX_RATE_MISMATCH and the whole transaction rolls back.
 * The stored fields (tax_rate_percent / tax_amount) and the
 * existing bases are unchanged -- cost basis (tot) in
 * createQuotation, sell basis in createJob and updateJobCharges --
 * and an explicitly supplied taxAmount still wins over the
 * computed amount. The configured rate is read once per call on
 * the transaction handle, never the pool handle. Stored history
 * is untouched: the fix is prospective only.
 *
 * WHAT THIS PINS, driving the REAL service methods on PGlite
 * (tenant t1 configured taxRate 15; tenant t2 legacy tax_rate 14):
 * - createQuotation (cost basis): rate 15 on tot 100 stores
 *   15 / 15; rate 7 throws SALE_TAX_RATE_MISMATCH and creates no
 *   quotation; rate 0 stores 0 / 0; an explicit taxAmount 20 with
 *   rate 15 stores 15 / 20; t2's legacy tax_rate 14 is honoured
 *   (rate 14 stores, rate 7 throws);
 * - createJob (sell basis): rate 15 on sell 200 stores 15 / 30;
 *   rate 7 throws and creates no job; rate 0 stores 0 / 0;
 * - updateJobCharges (sell basis): re-saving a row at rate 15
 *   stores 15 / 30; rate 7 throws and leaves the stored row
 *   byte-untouched; a new row at rate 15 inserts at 15 / 7.5;
 *   rate 0 stores 0 / 0;
 * - source pins: all three sites call
 *   resolveSaleTaxRate(chg.taxRatePercent, configuredTaxRate),
 *   the configured rate is resolved on the transaction handle
 *   three times, and no inline `Number(chg.taxRatePercent || 0)`
 *   survives anywhere in the service.
 *
 * HONEST LIMIT: the mismatch error surfaces to the caller as the
 * engine's AppError (code SALE_TAX_RATE_MISMATCH, 400); how the
 * maritime frontend renders it is not proven here. A charge that
 * genuinely needs a rate other than the tenant's configured rate
 * (or 0) is now rejected -- the same strictness sales already
 * has -- rather than silently stored.
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

const mismatch = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'SALE_TAX_RATE_MISMATCH';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const authT1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const authT2 = { tenantId: 't2', accountId: 'a2', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  const quoteCharges = async (quotationId: number): Promise<any[]> =>
    (db as any).selectFrom('maritime_quotation_charges').selectAll()
      .where('quotation_id', '=', String(quotationId)).orderBy('id', 'asc').execute();
  const jobCharges = async (jobId: number): Promise<any[]> =>
    (db as any).selectFrom('maritime_job_charges').selectAll()
      .where('job_id', '=', String(jobId)).orderBy('id', 'asc').execute();
  const count = async (table: string, tenantId: string): Promise<number> => {
    const rows: any[] = await (db as any).selectFrom(table).selectAll()
      .where('tenant_id', '=', tenantId).execute();
    return rows.length;
  };

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_quotations (id bigserial PRIMARY KEY, tenant_id text, quotation_number text, inquiry_id text, rfq_id text, bid_id text, customer_id bigint, customer_name text, customer_phone text, customer_email text, transport_mode text, air_cargo_type text, gross_weight_kg numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric, total_cbm numeric, package_count int, flight_number text, flight_date text, mawb_number text, hawb_number text, payment_term text, base_cost numeric, currency text, margin_type text, margin_value numeric, final_total numeric, exchange_rate numeric, final_total_local numeric, valid_until text, quote_roe numeric, roe_clause_text text, is_split_currency boolean, foreign_currency text, foreign_currency_amount numeric, local_currency_amount numeric, acid_number text, status text, notes text, created_by bigint);
      CREATE TABLE maritime_quotation_charges (id bigserial PRIMARY KEY, tenant_id text, quotation_id text, charge_code text, charge_name_ar text, charge_name_en text, currency text, unit_rate numeric, quantity numeric, total_amount numeric, is_local_charge boolean, tax_rate_percent numeric, tax_amount numeric);
      CREATE TABLE maritime_jobs (id bigserial PRIMARY KEY, tenant_id text, job_number text, inquiry_id text, quotation_id text, rfq_id text, customer_id bigint, customer_name text, direction text, transport_mode text, air_cargo_type text, gross_weight_kg numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric, total_cbm numeric, package_count int, flight_number text, flight_date text, mawb_number text, hawb_number text, payment_term text, shipping_line_id text, shipping_line_name text, booking_number text, vessel_name text, voyage_number text, pol_code text, pol_name text, pod_code text, pod_name text, etd timestamptz, eta timestamptz, port_cut_off timestamptz, bl_type text, mbl_number text, hbl_number text, shipper_details text, consignee_details text, notify_party text, milestone_status text, cost_center_id text, tracking_token text, parent_job_id text, is_consolidation_master boolean, acid_number text, acid_issue_date text, acid_expiry_date text, foreign_exporter_id text, importer_tax_id text, quote_roe numeric, actual_roe numeric, forex_gain_loss numeric, roe_clause_agreed boolean, si_cutoff_date timestamptz, vgm_cutoff_date timestamptz, port_cutoff_date timestamptz, delivery_address text, status text, notes text, created_by bigint);
      CREATE TABLE maritime_job_charges (id bigserial PRIMARY KEY, tenant_id text, job_id text, charge_code text, charge_name_ar text, charge_name_en text, currency text, cost_amount numeric, sell_amount numeric, profit_amount numeric, is_local_charge boolean, tax_rate_percent numeric, tax_amount numeric, is_invoiced boolean);
      CREATE TABLE maritime_containers (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, milestone_key text, milestone_title text, location text, notes text, recorded_by bigint, occurred_at timestamptz);
      CREATE TABLE maritime_cargo_insurances (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_warehouse_receipts (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE maritime_inland_trucking_trips (id bigserial PRIMARY KEY, tenant_id text, job_id bigint);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, is_active boolean, description text);
      INSERT INTO settings VALUES ('t1','currency','EGP'),('t1','taxRate','15'),('t2','currency','EGP'),('t2','tax_rate','14');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','EGP',1,true),('t2','EGP',1,true);
      INSERT INTO maritime_jobs (id, tenant_id, status, customer_id) VALUES (1,'t1','active',NULL),(2,'t1','active',NULL);
      INSERT INTO maritime_job_charges (id, tenant_id, job_id, charge_code, charge_name_ar, charge_name_en, currency, cost_amount, sell_amount, profit_amount, is_local_charge, tax_rate_percent, tax_amount, is_invoiced) VALUES
        (1,'t1','1','O/F','O/F','O/F','USD',100,100,0,false,0,0,false),
        (2,'t1','2','THC','THC','THC','USD',100,100,0,false,0,0,false);
      SELECT setval(pg_get_serial_sequence('maritime_job_charges', 'id'), 2);
      SELECT setval(pg_get_serial_sequence('maritime_jobs', 'id'), 2);
    `);

    const quoteDto = (charges: any[]): any => ({
      customerName: 'Acme', currency: 'EGP', baseCost: 0, charges,
    });
    const jobDto = (charges: any[]): any => ({
      customerName: 'Acme', direction: 'export', transportMode: 'sea',
      polCode: 'EGALY', polName: 'Alexandria', podCode: 'JED', podName: 'Jeddah',
      charges,
    });
    const qCharge = (totalAmount: number, taxRatePercent: number, extra: any = {}): any => ({
      chargeCode: 'O/F', chargeNameAr: 'O/F', chargeNameEn: 'O/F', currency: 'EGP',
      quantity: 1, unitRate: totalAmount, totalAmount, taxRatePercent, ...extra,
    });
    const jCharge = (sellAmount: number, taxRatePercent: number, extra: any = {}): any => ({
      chargeCode: 'O/F', chargeNameAr: 'O/F', chargeNameEn: 'O/F', currency: 'EGP',
      costAmount: 100, sellAmount, taxRatePercent, ...extra,
    });

    // 1. createQuotation, cost basis: configured rate 15 on tot 100 stores 15 / 15.
    const quote1: any = await service.createQuotation(authT1, quoteDto([qCharge(100, 15)]));
    const qc1 = await quoteCharges(Number(quote1.id));
    assert.equal(qc1.length, 1);
    assert.equal(Number(qc1[0].tax_rate_percent), 15, 'quotation rate is the configured 15');
    assert.equal(Number(qc1[0].tax_amount), 15, 'quotation tax is 15% of the cost basis tot');

    // 2. createQuotation: a 7% client rate throws and creates no quotation (rollback).
    await assert.rejects(service.createQuotation(authT1, quoteDto([qCharge(100, 7)])), mismatch);
    assert.equal(await count('maritime_quotations', 't1'), 1, 'mismatched quotation rolled back');

    // 3. createQuotation: exempt 0 stores 0 / 0.
    const quote3: any = await service.createQuotation(authT1, quoteDto([qCharge(100, 0)]));
    const qc3 = await quoteCharges(Number(quote3.id));
    assert.equal(Number(qc3[0].tax_rate_percent), 0);
    assert.equal(Number(qc3[0].tax_amount), 0);

    // 4. createQuotation: an explicitly supplied taxAmount still wins; the rate is resolved.
    const quote4: any = await service.createQuotation(authT1, quoteDto([qCharge(100, 15, { taxAmount: 20 })]));
    const qc4 = await quoteCharges(Number(quote4.id));
    assert.equal(Number(qc4[0].tax_rate_percent), 15);
    assert.equal(Number(qc4[0].tax_amount), 20, 'supplied taxAmount is preserved');

    // 5. createQuotation on t2 (legacy tax_rate 14 only): 14 stores, 7 throws.
    const quote5: any = await service.createQuotation(authT2, quoteDto([qCharge(100, 14)]));
    const qc5 = await quoteCharges(Number(quote5.id));
    assert.equal(Number(qc5[0].tax_rate_percent), 14, 'legacy tax_rate fallback honoured');
    assert.equal(Number(qc5[0].tax_amount), 14);
    await assert.rejects(service.createQuotation(authT2, quoteDto([qCharge(100, 7)])), mismatch);
    assert.equal(await count('maritime_quotations', 't2'), 1, 'mismatched t2 quotation rolled back');

    // 6. createJob, sell basis: configured rate 15 on sell 200 stores 15 / 30.
    const job1: any = await service.createJob(authT1, jobDto([jCharge(200, 15)]));
    const jc1 = await jobCharges(Number(job1.id));
    assert.equal(jc1.length, 1);
    assert.equal(Number(jc1[0].tax_rate_percent), 15, 'job rate is the configured 15');
    assert.equal(Number(jc1[0].tax_amount), 30, 'job tax is 15% of the sell basis');

    // 7. createJob: a 7% client rate throws and creates no job (rollback).
    await assert.rejects(service.createJob(authT1, jobDto([jCharge(200, 7)])), mismatch);
    assert.equal(await count('maritime_jobs', 't1'), 3, 'mismatched job rolled back (2 seeded + 1 created)');

    // 8. createJob: exempt 0 stores 0 / 0.
    const job3: any = await service.createJob(authT1, jobDto([jCharge(200, 0)]));
    const jc3 = await jobCharges(Number(job3.id));
    assert.equal(Number(jc3[0].tax_rate_percent), 0);
    assert.equal(Number(jc3[0].tax_amount), 0);

    // 9. updateJobCharges, sell basis: re-saving row 1 at rate 15 stores 15 / 30.
    const upd1: any = await service.updateJobCharges(authT1, 1, {
      charges: [{ id: 1, ...jCharge(200, 15) }],
    } as never);
    assert.equal(upd1.length, 1);
    assert.equal(Number(upd1[0].tax_rate_percent), 15);
    assert.equal(Number(upd1[0].tax_amount), 30);

    // 10. updateJobCharges: rate 7 throws and the stored row is byte-untouched.
    await assert.rejects(service.updateJobCharges(authT1, 2, {
      charges: [{ id: 2, ...jCharge(200, 7) }],
    } as never), mismatch);
    const jc2 = await jobCharges(2);
    assert.equal(Number(jc2[0].sell_amount), 100, 'rejected edit leaves sell untouched');
    assert.equal(Number(jc2[0].tax_rate_percent), 0, 'rejected edit leaves rate untouched');
    assert.equal(Number(jc2[0].tax_amount), 0, 'rejected edit leaves amount untouched');

    // 11. updateJobCharges: a new row at rate 15 inserts at 15 / 7.5 (row 1 kept).
    const upd3: any = await service.updateJobCharges(authT1, 1, {
      charges: [
        { id: 1, ...jCharge(200, 15) },
        { ...jCharge(50, 15), chargeCode: 'THC' },
      ],
    } as never);
    assert.equal(upd3.length, 2);
    const inserted = upd3.find((r: any) => r.charge_code === 'THC');
    assert.equal(Number(inserted.tax_rate_percent), 15);
    assert.equal(Number(inserted.tax_amount), 7.5);

    // 12. updateJobCharges: exempt 0 stores 0 / 0 (both rows kept).
    const upd4: any = await service.updateJobCharges(authT1, 1, {
      charges: [
        { id: 1, ...jCharge(200, 0) },
        { id: Number(inserted.id), ...jCharge(50, 0), chargeCode: 'THC' },
      ],
    } as never);
    assert.equal(upd4.length, 2);
    assert.ok(upd4.every((r: any) => Number(r.tax_rate_percent) === 0 && Number(r.tax_amount) === 0));

    // 13. Source pins: all three sites route through the canonical
    // engine on the transaction handle; no inline DTO rate survives.
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const engineCalls = source.match(/resolveSaleTaxRate\(chg\.taxRatePercent, configuredTaxRate\)/g) || [];
    assert.equal(engineCalls.length, 3, 'all three tax sites call the canonical engine');
    const trxResolves = source.match(/resolveTenantConfiguredTaxRate\(trx, tenantId\)/g) || [];
    assert.equal(trxResolves.length, 3, 'the configured rate is resolved on the transaction handle at all three sites');
    assert.ok(!source.includes('Number(chg.taxRatePercent || 0)'), 'no inline DTO-rate computation survives');
    assert.ok(!source.includes('resolveFreightTaxRate'), 'no invented freight tax engine');
    const fxSites = source.match(/exchangeRate/g) || [];
    assert.ok(fxSites.length > 0, 'sanity: the file still has its FX sites untouched by this package');

    console.log('maritime freight tax checks passed (12 behaviour checks + source pins)');
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
