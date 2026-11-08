/*
New file: backend/test/critical/maintenance-diagnosis-quote.spec.ts
Pins batch M3 package 9 (review P2-5 / P2-6).

THE GAPS: diagnosis was free-text technician_notes only — no
structured finding, no quoted price, and no customer-approval step
before repair started; and 'waiting_parts' existed in statusConfig
and the KPI counts but had no button in the detail-modal stepper, so
no operator could ever reach it from the screen.

THE FIX: migration 0302 adds maintenance_tickets.diagnosis (text),
quoted_cost numeric(14,3), quote_approved_at (timestamptz) and
quote_approved_by (integer) — all nullable, no constraint, no
backfill. The technician records diagnosis + quoted cost during
'inspecting' through the status-update path; the customer approval
is recorded by staff as quote_approved_at = now,
quote_approved_by = auth.userId on an EXPLICIT approveQuote flag
(there is no customer portal — never a customer signature — and
approval is never inferred from a status change). Moving a ticket
to 'in_progress' requires an approved quote WHEN a quoted cost
exists (non-null and > 0) and rejects otherwise with the specific
MAINTENANCE_QUOTE_APPROVAL_REQUIRED (422); tickets with no quoted
cost (quick jobs) proceed without approval. getTicket exposes
diagnosis / quotedCost / quoteApprovedAt / quoteApprovedBy. The
detail modal gains the 'waiting_parts' stepper button between
in_progress and repaired (plain status change, no money movement;
the backend already validates it and the filter tab + KPI counting
already exist) plus the diagnosis / quote UI.

WHAT THIS PINS, driving the REAL code:
- DTO: the status-update DTO accepts diagnosis / quotedCost /
  approveQuote, and rejects a negative quotedCost.
- Pure helpers (no DB): resolveQuoteFields records diagnosis +
  quoted cost, stamps who/when only on an explicit approveQuote,
  refuses approval with no quoted cost, refuses a negative quote,
  and a re-quote invalidates the old approval; the gate rejects
  the unapproved in_progress move, passes an approved one, passes
  a no-quote / zero-quote / already-in_progress move.
- Migration 0302 on PGlite: up adds the four columns (idempotent
  re-run ok, quoted_cost is numeric(14,3)); down drops them.
- getTicket through the REAL service (plain selects only, so no
  PGlite transaction hang): the four fields are exposed, null when
  unset.

NOT pinned here (transactional service methods hang on PGlite — the
known harness limit, same as the P5 spec): updateTicketStatus end
to end — the gate rejecting, the approval recording, and the
waiting_parts transition through the real service. Those live as
CI-only cases in Part B below (live Postgres via
ACCEPTANCE_DATABASE_URL, skipped without it). The stepper button
itself is covered by the existing MaintenanceDetailModal Vitest
suite run (no regression); a dedicated stepper assertion belongs in
that spec file, which is outside this package's file list.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  MaintenanceService,
  assertInProgressQuoteAllowed,
  resolveQuoteFields,
} from '../../src/modules/maintenance/maintenance.service';
import { UpdateTicketStatusDto } from '../../src/modules/maintenance/dto/update-ticket-status.dto';
import { up as diagnosisQuoteUp, down as diagnosisQuoteDown } from '../../src/database/migrations/2040000000302_maintenance_ticket_diagnosis_quote';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const NO_QUOTE = { diagnosis: null, quoted_cost: null, quote_approved_at: null, quote_approved_by: null };
const QUOTED = { diagnosis: 'Screen cracked', quoted_cost: 850, quote_approved_at: null, quote_approved_by: null };
const APPROVED = { diagnosis: 'Screen cracked', quoted_cost: 850, quote_approved_at: new Date('2026-11-08T09:00:00.000Z'), quote_approved_by: 7 };

function assertDtoValid(payload: unknown): void {
  const errors = validateSync(plainToInstance(UpdateTicketStatusDto, payload) as object);
  assert.equal(errors.length, 0, `Expected valid payload, got ${JSON.stringify(errors)}`);
}

function assertDtoInvalid(payload: unknown): void {
  const errors = validateSync(plainToInstance(UpdateTicketStatusDto, payload) as object);
  assert.ok(errors.length > 0, 'Expected payload to be invalid');
}

function testDtos(): void {
  assertDtoValid({ status: 'inspecting', diagnosis: 'Screen cracked', quotedCost: 850 });
  assertDtoValid({ status: 'inspecting', approveQuote: true });
  assertDtoValid({ status: 'in_progress', diagnosis: 'Board fault', quotedCost: 0 });
  assertDtoInvalid({ status: 'inspecting', quotedCost: -1 });
  assertDtoInvalid({ status: 'inspecting', approveQuote: 'yes' });
  assertDtoInvalid({ status: 'inspecting', diagnosis: 42 });
  assertDtoValid({ status: 'waiting_parts' });
}

function testPureHelpers(): void {
  // Recording a diagnosis + quote writes only the sent keys.
  const recorded = resolveQuoteFields({ diagnosis: '  Screen cracked  ', quotedCost: 850 }, NO_QUOTE, 7, NOW);
  assert.deepEqual(recorded.updates, { diagnosis: 'Screen cracked', quoted_cost: 850 });
  assert.equal(recorded.effectiveQuotedCost, 850);
  assert.equal(recorded.effectiveApproved, false, 'recording a quote is not an approval');

  // An empty diagnosis clears the stored one, explicitly.
  const cleared = resolveQuoteFields({ diagnosis: '   ' }, QUOTED, 7, NOW);
  assert.equal(cleared.updates.diagnosis, null);
  assert.equal(cleared.effectiveQuotedCost, 850, 'omitted quotedCost keeps the stored quote');

  // Approval is an explicit flag: it stamps who approved and when.
  const approved = resolveQuoteFields({ approveQuote: true }, QUOTED, 7, NOW);
  assert.equal(approved.updates.quote_approved_at, NOW);
  assert.equal(approved.updates.quote_approved_by, 7);
  assert.equal(approved.effectiveApproved, true);

  // Approval + quote in ONE call (record then approve) also works.
  const both = resolveQuoteFields({ diagnosis: 'Board fault', quotedCost: 1200, approveQuote: true }, NO_QUOTE, 9, NOW);
  assert.equal(both.updates.quoted_cost, 1200);
  assert.equal(both.updates.quote_approved_by, 9);
  assert.equal(both.effectiveApproved, true);

  // Approving with no quoted cost is a specific failure, not a silent
  // stamp of nothing: there is no quote to approve.
  assert.throws(
    () => resolveQuoteFields({ approveQuote: true }, NO_QUOTE, 7, NOW),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_WITHOUT_QUOTE',
  );
  // A zero quote is a free job, not a quote to approve either.
  assert.throws(
    () => resolveQuoteFields({ approveQuote: true }, { ...NO_QUOTE, quoted_cost: 0 }, 7, NOW),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_WITHOUT_QUOTE',
  );
  // Approval without an authenticated staff user is refused too.
  assert.throws(
    () => resolveQuoteFields({ approveQuote: true }, QUOTED, null, NOW),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_INVALID',
  );

  // A negative quote is refused before anything is written.
  assert.throws(
    () => resolveQuoteFields({ quotedCost: -5 }, NO_QUOTE, 7, NOW),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_COST_INVALID',
  );

  // A re-quote invalidates the old approval: the stored approval
  // covered 850, not the new 1200 — the ticket needs a fresh one.
  const requoted = resolveQuoteFields({ quotedCost: 1200 }, APPROVED, 7, NOW);
  assert.equal(requoted.effectiveApproved, false, 're-quote drops the stale approval');
  assert.equal(requoted.effectiveQuotedCost, 1200);
  // Re-sending the SAME amount keeps the approval.
  const same = resolveQuoteFields({ quotedCost: 850 }, APPROVED, 7, NOW);
  assert.equal(same.effectiveApproved, true, 'same-amount re-send keeps the approval');
  // No new amount at all: the stored approval stands.
  const untouched = resolveQuoteFields({ diagnosis: 'Still cracked' }, APPROVED, 7, NOW);
  assert.equal(untouched.effectiveApproved, true);
  assert.equal(untouched.effectiveQuotedCost, 850);

  // The gate: the move INTO in_progress is what is gated.
  assert.throws(
    () => assertInProgressQuoteAllowed('in_progress', 'inspecting', 850, false),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_REQUIRED',
  );
  assert.throws(
    () => assertInProgressQuoteAllowed('in_progress', 'received', 850, false),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_REQUIRED',
  );
  assert.throws(
    () => assertInProgressQuoteAllowed('in_progress', 'waiting_parts', 850, false),
    (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_REQUIRED',
  );
  // Approved quote: the move passes.
  assertInProgressQuoteAllowed('in_progress', 'inspecting', 850, true);
  // No quoted cost (quick job) or a zero quote: no approval needed.
  assertInProgressQuoteAllowed('in_progress', 'inspecting', null, false);
  assertInProgressQuoteAllowed('in_progress', 'inspecting', 0, false);
  // Already in_progress: a same-status call (e.g. editing the total)
  // is not a move and is never gated.
  assertInProgressQuoteAllowed('in_progress', 'in_progress', 850, false);
  // Any other target status is never gated.
  assertInProgressQuoteAllowed('repaired', 'in_progress', 850, false);
  assertInProgressQuoteAllowed('waiting_parts', 'in_progress', 850, false);
}

async function columnInfo(pg: PGlite, column: string): Promise<{ exists: boolean; type?: string; scale?: number }> {
  const res = await pg.query(
    `SELECT data_type, numeric_scale FROM information_schema.columns WHERE table_name = 'maintenance_tickets' AND column_name = $1`,
    [column],
  );
  if (res.rows.length === 0) return { exists: false };
  const row = res.rows[0] as { data_type: string; numeric_scale: number | null };
  return { exists: true, type: row.data_type, scale: row.numeric_scale === null ? undefined : Number(row.numeric_scale) };
}

async function main(): Promise<void> {
  testDtos();
  testPureHelpers();

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    await pg.exec(`
      CREATE TABLE maintenance_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_no VARCHAR(60) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        device_model VARCHAR(150) NOT NULL,
        problem_description TEXT NOT NULL,
        expected_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
        final_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
        advance_payment NUMERIC(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'received',
        technician_notes TEXT,
        received_at TIMESTAMPTZ,
        repaired_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );
      CREATE TABLE maintenance_ticket_parts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        qty NUMERIC NOT NULL,
        unit_cost NUMERIC NOT NULL DEFAULT 0,
        unit_price NUMERIC NOT NULL,
        location_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE treasury_transactions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        reference_type VARCHAR(100),
        reference_id INTEGER
      );
    `);

    // Migration 0302: up adds the four columns (idempotent re-run ok).
    for (const column of ['diagnosis', 'quoted_cost', 'quote_approved_at', 'quote_approved_by']) {
      assert.equal((await columnInfo(pg, column)).exists, false, `${column} must not exist before the migration`);
    }
    await diagnosisQuoteUp(db as never);
    await diagnosisQuoteUp(db as never);
    for (const column of ['diagnosis', 'quoted_cost', 'quote_approved_at', 'quote_approved_by']) {
      assert.equal((await columnInfo(pg, column)).exists, true, `${column} must exist after the migration`);
    }
    const quotedInfo = await columnInfo(pg, 'quoted_cost');
    assert.equal(quotedInfo.type, 'numeric', 'quoted_cost is numeric');
    assert.equal(quotedInfo.scale, 3, 'quoted_cost keeps 3 decimals (14,3)');

    // getTicket through the REAL service (plain selects only): the
    // four fields are exposed, null when unset, separate from
    // technician_notes.
    const service = new MaintenanceService(db as any, null as any, null as any, null as any, null as any);
    const auth = { tenantId: 't1', accountId: 'a1', userId: 7 } as any;
    const quotedIdRes = await pg.query(
      `INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status, technician_notes, diagnosis, quoted_cost, quote_approved_at, quote_approved_by)
       VALUES ('t1', 'a1', 'ZM-260108-0001', 'Customer', '01000000000', 'Model', 'Problem', 'inspecting', 'Free notes', 'Screen cracked', 850.5, '2026-11-08T09:00:00.000Z', 7)
       RETURNING id`,
    );
    const quotedId = Number((quotedIdRes.rows[0] as { id: number }).id);
    const plainIdRes = await pg.query(
      `INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status)
       VALUES ('t1', 'a1', 'ZM-260108-0002', 'Customer', '01000000000', 'Model', 'Problem', 'received')
       RETURNING id`,
    );
    const plainId = Number((plainIdRes.rows[0] as { id: number }).id);

    const quoted = await service.getTicket(quotedId, auth);
    assert.equal(quoted.ticket.diagnosis, 'Screen cracked', 'getTicket exposes diagnosis');
    assert.equal(quoted.ticket.technicianNotes, 'Free notes', 'diagnosis stays separate from technician_notes');
    assert.equal(quoted.ticket.quotedCost, 850.5, 'getTicket exposes quotedCost as a number');
    assert.equal(
      new Date(quoted.ticket.quoteApprovedAt as any).getTime(),
      new Date('2026-11-08T09:00:00.000Z').getTime(),
      'getTicket exposes quoteApprovedAt',
    );
    assert.equal(quoted.ticket.quoteApprovedBy, 7, 'getTicket exposes quoteApprovedBy');

    const plain = await service.getTicket(plainId, auth);
    assert.equal(plain.ticket.diagnosis, null, 'unset diagnosis reads null, not empty');
    assert.equal(plain.ticket.quotedCost, null, 'unset quotedCost reads null, not 0');
    assert.equal(plain.ticket.quoteApprovedAt, null);
    assert.equal(plain.ticket.quoteApprovedBy, null);

    // Migration 0302 down drops the four columns again.
    await diagnosisQuoteDown(db as never);
    for (const column of ['diagnosis', 'quoted_cost', 'quote_approved_at', 'quote_approved_by']) {
      assert.equal((await columnInfo(pg, column)).exists, false, `${column} must be gone after down`);
    }

    console.log('maintenance-diagnosis-quote.spec.ts Part A passed');
  } finally {
    await db.destroy();
  }

  await runLivePartB();
}

async function runLivePartB(): Promise<void> {
  const target = process.env.ACCEPTANCE_DATABASE_URL;
  if (!target) {
    console.log(
      'maintenance-diagnosis-quote.spec.ts Part B SKIPPED: set ACCEPTANCE_DATABASE_URL to a fully migrated disposable PostgreSQL database (CI-only live section)',
    );
    return;
  }
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Acceptance tests are local-only');
  assert.ok(
    /^\/(zs_core_audit_test|zs_acceptance_[a-z0-9_]+)$/.test(url.pathname),
    'Refusing a non-test database',
  );
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_MODE: 'CLOUD_SAAS',
    TENANT_ID: 'zs',
    ACCOUNT_ID: 'zs',
    DATABASE_HOST: url.hostname,
    DATABASE_PORT: url.port || '5432',
    DATABASE_NAME: url.pathname.slice(1),
    DATABASE_USER: decodeURIComponent(url.username),
    DATABASE_PASSWORD: decodeURIComponent(url.password),
    DATABASE_SSL: 'false',
    DATABASE_POOL_MAX: '8',
    SESSION_CSRF_SECRET: 'isolated-maintenance-diagnosis-quote-csrf-only',
    ENABLE_BOOTSTRAP_ADMIN: 'false',
    SMTP_HOST: '',
    ERROR_TRACKING_ENABLED: 'false',
  });
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../src/app.module');
  const { KYSELY_DB } = await import('../../src/database/database.constants');
  const { AccountingTenantFoundationService } = await import(
    '../../src/modules/accounting/accounting-tenant-foundation.service'
  );
  const { createPasswordRecord } = await import('../../src/core/auth/utils/password-hasher');
  const { SUPER_ADMIN_PERMISSIONS } = await import('../../src/core/auth/constants/super-admin-permissions');
  const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const db = app.get<Kysely<Database>>(KYSELY_DB);
  const foundation = app.get(AccountingTenantFoundationService);
  const maintenance = app.get(MaintenanceService);
  const tag = `dq${Date.now().toString(36)}`;
  const tenantId = `accept_${tag}`;
  const secret = await createPasswordRecord('DisposableDiagQuote!2026#Only');

  try {
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        slug: tenantId,
        business_name: tenantId,
        owner_name: 'DiagQuote',
        owner_phone: tag,
        owner_email: `${tenantId}@example.invalid`,
        activity_type: 'retail_general',
        status: 'active',
        plan_id: 'plan_omnichannel',
        country_code: 'EG',
        trial_starts_at: new Date(),
        trial_ends_at: new Date('2100-01-01'),
        activated_at: new Date(),
        extra_features: '[]',
      } as any)
      .execute();
    const user = await db
      .insertInto('users')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        username: tenantId,
        phone: tag,
        password_hash: secret.hash,
        password_salt: secret.salt,
        role: 'admin',
        is_active: true,
        must_change_password: false,
        permissions_json: JSON.stringify(SUPER_ADMIN_PERMISSIONS),
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    const auth: any = {
      tenantId,
      accountId: tenantId,
      userId: Number(user.id),
      role: 'admin',
      username: tenantId,
      sessionId: `session_${tenantId}`,
      permissions: [...SUPER_ADMIN_PERMISSIONS],
    };
    const branch = await db
      .insertInto('branches')
      .values({ tenant_id: tenantId, account_id: tenantId, name: 'Main', code: `B_${tenantId}` } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    const location = await db
      .insertInto('stock_locations')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        branch_id: Number(branch.id),
        name: 'Warehouse',
        code: `L_${tenantId}`,
        location_type: 'internal_warehouse',
        is_active: true,
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('settings')
      .values({ tenant_id: tenantId, account_id: tenantId, key: 'currency', value: '"EGP"' } as any)
      .execute();
    await foundation.ensureForAuth(db, auth);

    const created = await maintenance.createTicket(
      {
        customerName: 'DiagQuote Customer',
        customerPhone: '01000000000',
        deviceModel: 'Test Model',
        problemDescription: 'Screen broken',
        expectedCost: 100,
        finalCost: 100,
        advancePayment: 0,
        branchId: Number(branch.id),
        locationId: Number(location.id),
      } as any,
      auth,
    );
    const ticketId = Number(created.id);
    const view = async () => (await maintenance.getTicket(ticketId, auth)).ticket as any;

    // Record diagnosis + quote while inspecting (same-status call).
    await maintenance.updateTicketStatus(
      ticketId,
      { status: 'inspecting', diagnosis: 'Screen cracked, needs replacement', quotedCost: 850 } as any,
      auth,
    );
    const recorded = await view();
    assert.equal(recorded.diagnosis, 'Screen cracked, needs replacement');
    assert.equal(recorded.quotedCost, 850);
    assert.equal(recorded.quoteApprovedAt, null, 'recording a quote is not an approval');
    assert.equal(recorded.technicianNotes, null, 'diagnosis did not leak into technician_notes');

    // The gate: unapproved in_progress is rejected with the specific code.
    await assert.rejects(
      maintenance.updateTicketStatus(ticketId, { status: 'in_progress' } as any, auth),
      (e: any) => e.code === 'MAINTENANCE_QUOTE_APPROVAL_REQUIRED',
    );
    assert.equal((await view()).status, 'inspecting', 'rejected move leaves the status untouched');

    // Explicit approval stamps who approved and when.
    const before = Date.now();
    await maintenance.updateTicketStatus(ticketId, { status: 'inspecting', approveQuote: true } as any, auth);
    const approvedView = await view();
    assert.ok(approvedView.quoteApprovedAt, 'approval stamps a time');
    assert.ok(new Date(approvedView.quoteApprovedAt).getTime() >= before - 1000, 'approval time is now, not a past date');
    assert.equal(approvedView.quoteApprovedBy, auth.userId, 'approval records the authenticated staff user');

    // Approved: the move to in_progress passes, and waiting_parts is
    // a plain reachable status from there.
    await maintenance.updateTicketStatus(ticketId, { status: 'in_progress' } as any, auth);
    assert.equal((await view()).status, 'in_progress');
    await maintenance.updateTicketStatus(ticketId, { status: 'waiting_parts' } as any, auth);
    assert.equal((await view()).status, 'waiting_parts');

    // A quick job with no quoted cost needs no approval at all.
    const quick = await maintenance.createTicket(
      {
        customerName: 'Quick Customer',
        customerPhone: '01000000001',
        deviceModel: 'Test Model',
        problemDescription: 'Software reset',
        expectedCost: 50,
        finalCost: 50,
        advancePayment: 0,
        branchId: Number(branch.id),
        locationId: Number(location.id),
      } as any,
      auth,
    );
    const quickId = Number(quick.id);
    await maintenance.updateTicketStatus(quickId, { status: 'in_progress' } as any, auth);
    assert.equal((await maintenance.getTicket(quickId, auth)).ticket.status, 'in_progress');

    console.log('maintenance-diagnosis-quote.spec.ts Part B passed');
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
