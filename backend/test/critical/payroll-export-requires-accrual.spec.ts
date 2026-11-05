/*
New file: backend/test/critical/payroll-export-requires-accrual.spec.ts
Pins that the payroll bank review export requires a booked,
non-reversed accrual journal (INV-PAYROLL-EXPORT-REQUIRES-ACCRUAL).

THE GAP: generatePayrollWps exported the bank review CSV for any
approved run without ever checking that the accrual journal was
posted. A run whose accrual was missing — or had been reversed
after approval — still produced a bank file with live IBANs and
amounts, outrunning the ledger.

THE RULE: the export passes only when an hr_payroll_accrual
journal exists for the run with status 'posted' and no reversal
link (the posting service's own definition of an active
journal). A missing journal fails closed with
HR_PAYROLL_EXPORT_ACCRUAL_MISSING; a reversed one with
HR_PAYROLL_EXPORT_ACCRUAL_REVERSED.

WHAT THIS PINS, driving the REAL generatePayrollWps on PGlite:
- Active accrual: the export succeeds and the CSV carries the
  employee and the net pay at book precision.
- No accrual journal: the export rejects and emits nothing.
- Reversed accrual: the export rejects with the reversal code.

CALLER PRECONDITION (D5, INV-WPS-PAID-RUN-EXPORT): the caller holds
hrPayrollManage — exporting bank details is manage-only. This spec pins
the accrual gate, not the permission gate.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: ['hrPayrollManage'] } as unknown as AuthContext;
  const service = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, employee_no text, national_id text, display_name text, bank_name text, bank_account_number text, iban text, bank_swift_code text);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, name text, period_month text, start_date date, end_date date, status text);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint, net_pay numeric, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, status text);
      CREATE TABLE journal_entries (id bigint PRIMARY KEY, tenant_id text, source_type text, source_id bigint, status text, reversed_by_entry_id bigint);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO hr_employees VALUES (1,'t1','E-1','29901010101010','Emp One','Bank A','123456','EG123456','SWIFT1');
      INSERT INTO hr_payroll_runs VALUES (7,'t1','Run 7','2026-10','2026-10-01','2026-10-31','approved');
      INSERT INTO hr_payroll_runs VALUES (8,'t1','Run 8','2026-10','2026-10-01','2026-10-31','approved');
      INSERT INTO hr_payroll_runs VALUES (9,'t1','Run 9','2026-10','2026-10-01','2026-10-31','approved');
      INSERT INTO hr_payroll_run_items VALUES (1,'t1',7,1,5000,5000,0,0,0,0,'approved');
      INSERT INTO hr_payroll_run_items VALUES (2,'t1',8,1,5000,5000,0,0,0,0,'approved');
      INSERT INTO hr_payroll_run_items VALUES (3,'t1',9,1,5000,5000,0,0,0,0,'approved');
      INSERT INTO journal_entries VALUES (77,'t1','hr_payroll_accrual',7,'posted',NULL);
      INSERT INTO journal_entries VALUES (78,'t1','hr_payroll_accrual',9,'posted',99);
    `);

    // 1. Active accrual: export succeeds.
    const exported = await service.generatePayrollWps(7, {}, auth);
    assert.equal(exported.ok, true);
    assert.match(String(exported.csvContent), /Emp One/);
    assert.match(String(exported.csvContent), /5000\.00/);

    // 2. No accrual journal: fail closed.
    await assert.rejects(
      service.generatePayrollWps(8, {}, auth),
      /HR_PAYROLL_EXPORT_ACCRUAL_MISSING/,
    );

    // 3. Reversed accrual: fail closed with the reversal code.
    await assert.rejects(
      service.generatePayrollWps(9, {}, auth),
      /HR_PAYROLL_EXPORT_ACCRUAL_REVERSED/,
    );

    console.log('Payroll export requires accrual tests passed.');
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
