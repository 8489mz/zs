/*
New file: backend/test/critical/zatca-network-failure-never-clears.spec.ts
Pins the ZATCA submission failure rule (INV-ZATCA-NETWORK-FAILURE-NEVER-CLEARS).

THE GAP: when the live ZATCA request threw a network error, the
catch block marked the invoice 'cleared' (B2B) or 'reported'
(B2C) with a PASS validation in every non-production
environment — as if ZATCA had accepted an invoice it never
received. The invoice then looked compliant, locked against
edits, and vanished from the pending queue.

THE RULE: a network error means ZATCA was never reached, so the
submission is 'failed' in every environment. The sale keeps its
built ICV/PIH package and stays pending for a real retry.

WHAT THIS PINS, driving the REAL submitInvoice on PGlite with
a stubbed builder and stubbed fetch (sandbox EGS unit):
- fetch throws (network down) -> result failed, sale row
  'failed', no cleared XML, transmission log records FAILED.
- fetch answers 200 REPORTED -> result reported, sale row
  'reported' (the live sandbox path still works).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ZatcaSubmissionService } from '../../src/modules/tax-integration/services/zatca/zatca-submission.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  void auth;

  const fakePkg = {
    invoiceHash: 'aGFzaA==',
    uuid: '11111111-1111-1111-1111-111111111111',
    ublXml: '<Invoice/>',
  } as never;
  const builderStub = { buildZatcaInvoice: async () => fakePkg };
  const taxSettingsStub = { getSettings: async () => ({ environment: 'sandbox' }) } as never;
  const service = new ZatcaSubmissionService(db, builderStub as never, taxSettingsStub);

  const realFetch = globalThis.fetch;
  let fetchMode: 'throw' | 'report' = 'throw';
  (globalThis as any).fetch = async () => {
    if (fetchMode === 'throw') throw new Error('network down');
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ reportingStatus: 'REPORTED', validationResults: { warningMessages: [] } }),
    } as never;
  };

  try {
    await pg.exec(`
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, created_at timestamptz, total numeric, tax_amount numeric, customer_name text, customer_id bigint, branch_id bigint, zatca_egs_id bigint, zatca_status text, zatca_uuid text, zatca_icv bigint, zatca_submitted_at timestamptz, zatca_response_json text, zatca_cleared_xml text, zatca_invoice_type text, status text, updated_at timestamptz);
      CREATE TABLE zatca_egs_units (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, environment text, production_csid text, compliance_csid text, production_secret text, compliance_secret text, status text);
      CREATE TABLE zatca_transmission_logs (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, egs_id bigint, action_type text, environment text, request_uuid text, invoice_hash text, http_status int, response_status text, validation_results text, raw_response text, created_at timestamptz);
      INSERT INTO zatca_egs_units VALUES (1,'t1',NULL,'sandbox',NULL,'CSID','SECRET-KEY','SECRET',NULL);
      INSERT INTO sales (id, tenant_id, doc_no, created_at, total, tax_amount, status) VALUES (1,'t1','INV-1','2026-10-15',1140,140,'posted'),(2,'t1','INV-2','2026-10-15',1140,140,'posted');
    `);

    // 1. Network failure in sandbox: failed, never cleared.
    const failed = await service.submitInvoice('t1', 1);
    assert.equal(failed.success, false);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.httpStatus, 0);
    const saleRow = await pg.query<{ zatca_status: string; zatca_cleared_xml: string | null }>(
      'SELECT zatca_status, zatca_cleared_xml FROM sales WHERE id = 1',
    );
    assert.equal(saleRow.rows[0].zatca_status, 'failed');
    assert.equal(saleRow.rows[0].zatca_cleared_xml, null);
    const logRow = await pg.query<{ response_status: string; http_status: number | null }>(
      'SELECT response_status, http_status FROM zatca_transmission_logs WHERE sale_id = 1',
    );
    assert.equal(logRow.rows[0].response_status, 'FAILED');
    assert.equal(logRow.rows[0].http_status, null);
    const pending = await service.getPendingInvoices('t1');
    assert.ok(pending.some((row) => row.id === '1' && row.zatca_status === 'failed'));

    // 2. A real 200 REPORTED answer still reports.
    fetchMode = 'report';
    const reported = await service.submitInvoice('t1', 2);
    assert.equal(reported.success, true);
    assert.equal(reported.status, 'reported');
    const saleRow2 = await pg.query<{ zatca_status: string }>('SELECT zatca_status FROM sales WHERE id = 2');
    assert.equal(saleRow2.rows[0].zatca_status, 'reported');

    console.log('ZATCA network failure never clears tests passed.');
  } finally {
    globalThis.fetch = realFetch;
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
