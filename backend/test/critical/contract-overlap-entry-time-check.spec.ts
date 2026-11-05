/*
 * Contract overlap surfaces at ENTRY time (F7): creating or updating a
 * contract whose inclusive-day span overlaps another live contract for
 * the same employee fails closed here — not only at payroll time.
 * INV-CONTRACT-OVERLAP-ENTRY-TIME-CHECK.
 *
 * Harness: fresh PGlite, raw DDL, real HrService (the same advisory-lock
 * + transaction shape the S5/P6 harnesses proved PGlite-safe). Every
 * service call is wrapped in a 25s timeout guard: a silent hang is a
 * failure, never a pass.
 *
 * Bars: overlapping create throws HR_CONTRACT_OVERLAP (409) and writes
 * nothing; an abutting contract (starting the day after the first ends)
 * succeeds; an open-ended overlap throws; overlap against a CANCELLED
 * sibling is allowed; updating a contract INTO an overlap throws and
 * leaves the stored span unchanged; a non-overlapping update succeeds;
 * overlapping dates for a DIFFERENT employee succeed.
 * Run: npx ts-node test/critical/contract-overlap-entry-time-check.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: ['hrSalaryView'] } as never;
const AUDIT_STUB = { log: async () => ({}) } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

type Row = { id: string; contractNo: string; startDate: string; endDate: string; status: string; baseSalary: number };

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql.raw(`CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`).execute(db);
    await sql.raw(`CREATE TABLE hr_employees (id integer PRIMARY KEY, tenant_id text NOT NULL, display_name text, status text)`).execute(db);
    await sql.raw(`CREATE TABLE hr_employment_contracts (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, employee_id integer NOT NULL, contract_no text, contract_type text, status text NOT NULL DEFAULT 'draft', start_date date NOT NULL, end_date date, base_salary numeric(14,3) NOT NULL, currency text, notes text, created_by integer, updated_by integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`).execute(db);
    await sql.raw(`CREATE TABLE hr_payroll_runs (id bigserial PRIMARY KEY, tenant_id text NOT NULL, start_date date, end_date date, status text)`).execute(db);
    await sql.raw(`CREATE TABLE hr_payroll_run_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, run_id integer, employee_id integer, status text)`).execute(db);
    await sql.raw(`INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO hr_employees (id, tenant_id, display_name, status) VALUES (1, 't1', 'Ahmed', 'active'), (2, 't1', 'Sara', 'active')`).execute(db);

    const service = new HrService(db, new TransactionHelper(), AUDIT_STUB, {} as never, {} as never, undefined);

    const upsert = (employeeId: number, id: number | null, payload: Record<string, unknown>) =>
      withTimeout(service.upsertContract(employeeId, id, payload as never, AUTH), 25000, `upsertContract ${JSON.stringify(payload)}`);
    const rowsOf = (res: Record<string, unknown>) => (res.rows as Row[]);
    const countContracts = async (employeeId: number) => {
      const r = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM hr_employment_contracts WHERE employee_id = ${employeeId}`.execute(db);
      return Number(r.rows[0]?.n || 0);
    };
    const expectOverlap = async (employeeId: number, id: number | null, payload: Record<string, unknown>, label: string) => {
      let error: unknown = null;
      try { await upsert(employeeId, id, payload); } catch (caught) { error = caught; }
      assert.equal((error as any)?.code, 'HR_CONTRACT_OVERLAP', `${label}: throws HR_CONTRACT_OVERLAP`);
      assert.equal((error as any)?.statusCode, 409, `${label}: 409`);
    };

    // 1. First contract: 2026-01-01 -> 2026-06-30.
    const createdA = rowsOf(await upsert(1, null, { contractNo: 'CON-A', status: 'active', startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: 5000 }));
    const idA = Number(createdA.find((r) => r.contractNo === 'CON-A')?.id);
    assert.ok(idA > 0, 'contract A created');
    assert.equal(await countContracts(1), 1, 'one contract stored');

    // 2. Overlapping create: shares June -> throws, writes nothing.
    await expectOverlap(1, null, { contractNo: 'CON-B', status: 'active', startDate: '2026-06-01', endDate: '2026-12-31', baseSalary: 5000 }, 'overlapping create');
    assert.equal(await countContracts(1), 1, 'no contract written by the refused create');

    // 3. Abutting create: starts the day after A ends -> succeeds.
    const createdC = rowsOf(await upsert(1, null, { contractNo: 'CON-C', status: 'active', startDate: '2026-07-01', endDate: '2026-12-31', baseSalary: 5000 }));
    const idC = Number(createdC.find((r) => r.contractNo === 'CON-C')?.id);
    assert.ok(idC > 0, 'abutting contract created');
    assert.equal(await countContracts(1), 2, 'two contracts stored');

    // 4. Open-ended overlap: 2026-05-01 -> null covers A and C -> throws.
    await expectOverlap(1, null, { contractNo: 'CON-D', status: 'active', startDate: '2026-05-01', baseSalary: 5000 }, 'open-ended overlap');
    assert.equal(await countContracts(1), 2, 'no contract written by the open-ended overlap');

    // 5. Overlap against a CANCELLED sibling only -> allowed.
    await upsert(1, null, { contractNo: 'CON-F', status: 'cancelled', startDate: '2027-01-01', endDate: '2027-06-30', baseSalary: 5000 });
    const createdG = rowsOf(await upsert(1, null, { contractNo: 'CON-G', status: 'active', startDate: '2027-03-01', endDate: '2027-09-30', baseSalary: 5000 }));
    assert.ok(createdG.some((r) => r.contractNo === 'CON-G'), 'overlap vs cancelled sibling allowed');
    assert.equal(await countContracts(1), 4, 'four contracts stored');

    // 6. Update INTO an overlap: move C's start back into A -> throws, C unchanged.
    await expectOverlap(1, idC, { contractNo: 'CON-C', status: 'active', startDate: '2026-06-15', endDate: '2026-12-31', baseSalary: 5000 }, 'update into overlap');
    const storedC = await sql<{ s: string }>`SELECT to_char(start_date, 'YYYY-MM-DD') AS s FROM hr_employment_contracts WHERE id = ${idC}`.execute(db);
    assert.equal(storedC.rows[0]?.s, '2026-07-01', 'C start unchanged after refused update');

    // 7. Non-overlapping update: same dates, new salary -> succeeds.
    const updatedC = rowsOf(await upsert(1, idC, { contractNo: 'CON-C', status: 'active', startDate: '2026-07-01', endDate: '2026-12-31', baseSalary: 5500 }));
    assert.equal(updatedC.find((r) => r.contractNo === 'CON-C')?.baseSalary, 5500, 'salary update succeeds');

    // 8. Update A to open-ended: would swallow C -> throws, A unchanged.
    await expectOverlap(1, idA, { contractNo: 'CON-A', status: 'active', startDate: '2026-01-01', baseSalary: 5000 }, 'update to open-ended overlap');
    const storedA = await sql<{ e: string }>`SELECT to_char(end_date, 'YYYY-MM-DD') AS e FROM hr_employment_contracts WHERE id = ${idA}`.execute(db);
    assert.equal(storedA.rows[0]?.e, '2026-06-30', 'A end unchanged after refused update');

    // 9. Same dates for a DIFFERENT employee -> succeeds.
    const other = rowsOf(await upsert(2, null, { contractNo: 'CON-H', status: 'active', startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: 5000 }));
    assert.ok(other.some((r) => r.contractNo === 'CON-H'), 'other employee unaffected');

    console.log('contract-overlap-entry-time-check.spec: ok (throw / abut / open-ended / cancelled / update-in / update-ok / other-employee)');
  } finally {
    await db.destroy();
  }
}

main();
