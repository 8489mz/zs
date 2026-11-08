/*
New file: backend/test/critical/maintenance-batch2.spec.ts
Batch M2 package 8 — dedicated specs only (no production code here).

WHAT THIS PINS — the batch-2 END-TO-END behaviours the per-package
specs do not already own (base bd6edb52; package 5 merges first):
  (a) intake with a SOLD serial links the ticket to that sale
      (latest SOLD product_serials row matching serial_number OR
      imei_2, case-insensitive, tenant-scoped); an unknown or
      unsold (in_stock) serial leaves sale_id null;
  (b) warranty_end is computed as repaired_at + warranty_days when
      the ticket FIRST becomes repaired, and does not move on a
      later re-repair;
  (c) GET api/maintenance/tickets/counts aggregates per-status
      counts and totalRemaining, where totalRemaining is the SUM
      of max(0, (final_cost || expected_cost) - advance_payment)
      over tickets NOT IN (delivered, cancelled, unrepairable);
  (d) a non-financial edit after an advance is allowed, while a
      financial edit (expectedCost / finalCost / advancePayment)
      after an advance is rejected with 409;
  (e) final-amount delivery with a card payment posts the
      remainder to account 1120 (not cash 1110) — asserted here
      ONLY inside the combined end-to-end flow (L6). The isolated
      card-posting pin already lives in
      backend/test/acceptance/core-accounting.postgres.spec.ts
      ('maintcard' case) and is NOT repeated standalone here.

WHAT IT DOES NOT DUPLICATE:
  - Package 5's own per-package unit pins (warranty_end column /
    sale-link lookup / counts SQL / edit relaxation in isolation).
  - The isolated card-delivery GL pin (see (e) above).
  - The M1-P1 advance-guard / exact-settlement pins (acceptance
    spec owns them).

TWO LAYERS, SPLIT HONESTLY:
  - Part A runs on THIS base (PGlite + DTOs + the real
    MaintenanceService read methods, which are non-transactional
    and therefore PGlite-safe). It pins the DTO input shapes and
    the read side (listTickets / getTicket surface saleId).
  - Part B is LIVE-POSTGRES ONLY (ACCEPTANCE_DATABASE_URL, same
    localhost + test-database guards as
    core-accounting.postgres.spec.ts). Without that variable the
    file prints SKIP and exits 0. The live cases drive the REAL
    service through the Nest app, because createTicket /
    updateTicket / updateTicketStatus are transactional and hang
    on PGlite (known harness limit). They CANNOT pass on base
    bd6edb52 — package 5's code does not exist here yet — and are
    verified at merge time, after package 5 merges.

PACKAGE-5 CONTRACT ASSUMPTIONS (one call site each; rename if
package 5 names them differently — the live run then fails loudly,
it never passes silently):
  - Service method `getTicketCounts(auth)` returning
    { counts: { received, inspecting, in_progress, waiting_parts,
    repaired, delivered, unrepairable, cancelled, total },
    totalRemaining }. The task contract names the HTTP route
    (GET api/maintenance/tickets/counts), not the method name;
    `getTicketCounts` follows this service's naming
    (getTicket / listTickets). Accessed through a structural
    interface cast so `tsc --noEmit` stays green on base, where
    the method does not exist yet.
  - `warranty_end` is a timestamptz column on maintenance_tickets
    (read here with raw SQL, which is untyped and therefore
    compiles on base) and `getTicket` returns a `refundedAdvance`
    boolean (read through a documented contract-surface cast).

DECISIONS (package-8 agent, 2026-11-08):
  - D-P8-1: NO PGlite SQL-contract pins for the counts /
    warranty / sale-link formulas. No importable production
    function exists on base, and re-implementing the formulas in
    the test would certify the test's own SQL, not the endpoint
    (repo rule: tests import production code, never re-implement
    business formulas). Those behaviours are pinned ONLY in the
    live section, driving the real service.
  - D-P8-2: counts go through the structural `getTicketCounts`
    cast (see above), not through a guessed HTTP call — the
    acceptance specs drive services directly, and HTTP auth setup
    would be a second, unproven fixture.
  - D-P8-3: `warranty_end` / `refundedAdvance` are read via raw
    SQL / contract-surface casts, so the file typechecks on base
    while failing loudly at live-run time if the contract differs.
  - D-P8-4: (e) is asserted only inside the combined flow L6
    (sold-serial intake -> repair warranty -> card delivery ->
    counts), never as a standalone repeat of the 'maintcard' pin.

RUN:
  cd backend && npx ts-node test/critical/maintenance-batch2.spec.ts
    -> Part A passes on base; Part B prints SKIP, exit 0.
  ACCEPTANCE_DATABASE_URL=postgres://.../zs_acceptance_<name> \
    npx ts-node test/critical/maintenance-batch2.spec.ts
    -> full live run (CI-only; needs a fully migrated disposable
    local PostgreSQL database, exactly like the acceptance spec).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { KYSELY_DB } from '../../src/database/database.constants';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/core/auth/constants/super-admin-permissions';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { UpsertMaintenanceTicketDto } from '../../src/modules/maintenance/dto/upsert-maintenance-ticket.dto';
import { UpdateTicketStatusDto } from '../../src/modules/maintenance/dto/update-ticket-status.dto';

const STATUSES = [
  'received',
  'inspecting',
  'in_progress',
  'waiting_parts',
  'repaired',
  'delivered',
  'unrepairable',
  'cancelled',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- Part A
// Runs on base: real DTOs + the real MaintenanceService read methods
// (listTickets / getTicket are non-transactional, so PGlite-safe)
// over PGlite tables mirroring migration 0004.

function assertDtoValid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  assert.equal(errors.length, 0, `Expected valid payload, got ${JSON.stringify(errors)}`);
}

function assertDtoInvalid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  assert.ok(errors.length > 0, 'Expected payload to be invalid');
}

function testDtos(): void {
  const base = {
    customerName: 'Batch2 Customer',
    customerPhone: '01000000000',
    deviceModel: 'Test Model',
    problemDescription: 'Screen broken',
  };
  // (d) input shape: a non-financial-only edit payload (no money
  // fields at all) must validate — this is the payload the relaxed
  // edit path receives after an advance.
  assertDtoValid(UpsertMaintenanceTicketDto, {
    ...base,
    customerPhone: '01099999999',
  });
  // A financial payload validates too; the 409 is a service rule,
  // not a DTO rule.
  assertDtoValid(UpsertMaintenanceTicketDto, {
    ...base,
    expectedCost: 100,
    finalCost: 100,
    advancePayment: 20,
  });
  assertDtoInvalid(UpsertMaintenanceTicketDto, { ...base, finalCost: -5 });
  assertDtoInvalid(UpsertMaintenanceTicketDto, { ...base, advancePayment: -1 });
  assertDtoInvalid(UpsertMaintenanceTicketDto, { ...base, status: 'bogus' });
  for (const status of STATUSES) {
    assertDtoValid(UpsertMaintenanceTicketDto, { ...base, status });
    assertDtoValid(UpdateTicketStatusDto, { status });
  }
  // (e) input shape: delivery with a card payment method validates.
  assertDtoValid(UpdateTicketStatusDto, {
    status: 'delivered',
    finalCost: 100,
    collectedAmount: 80,
    paymentMethod: 'card',
  });
  assertDtoValid(UpdateTicketStatusDto, {
    status: 'delivered',
    finalCost: 100,
    collectedAmount: 80,
    paymentMethod: 'cash',
  });
  assertDtoInvalid(UpdateTicketStatusDto, { status: 'bogus' });
}

async function testReadSide(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE maintenance_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_no VARCHAR(60) NOT NULL,
        customer_id INTEGER,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        device_brand VARCHAR(100),
        device_model VARCHAR(150) NOT NULL,
        serial_number VARCHAR(120),
        passcode VARCHAR(100),
        problem_description TEXT NOT NULL,
        device_condition TEXT,
        expected_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        final_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        advance_payment NUMERIC(14, 3) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'received',
        technician_id INTEGER,
        technician_name VARCHAR(150),
        technician_notes TEXT,
        branch_id INTEGER,
        location_id INTEGER,
        sale_id INTEGER,
        warranty_days INTEGER NOT NULL DEFAULT 30,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        repaired_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE maintenance_ticket_parts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
        unit_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        unit_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
        location_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- Minimal treasury_transactions: getTicket reads it for refundedAdvance
      -- (package 5), so the read-side pins need the table to exist even
      -- though no refund row is seeded here. DDL mirrors the P5 spec.
      CREATE TABLE treasury_transactions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        reference_type VARCHAR(100),
        reference_id INTEGER
      );
      INSERT INTO maintenance_tickets
        (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model,
         problem_description, expected_cost, final_cost, advance_payment, status, sale_id, warranty_days)
        VALUES
        ('t1', 't1', 'ZM-260108-0001', 'Batch2 Customer', '01000000000', 'Test Model',
         'Screen broken', 100, 100, 20, 'received', 9001, 30),
        ('t1', 't1', 'ZM-260108-0002', 'Batch2 Customer', '01000000001', 'Test Model',
         'Battery swollen', 50, 50, 0, 'repaired', NULL, 14);
    `);

    // listTickets / getTicket only touch this.db, so the remaining
    // constructor deps (transaction helper, audit, posting,
    // foundation) are never called on these paths.
    const service = new MaintenanceService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const auth = { tenantId: 't1', accountId: 't1' } as AuthContext;

    // (a) read side: a ticket whose sale_id is set surfaces it in
    // both the list and the detail read; an unlinked ticket is null.
    // (Package 5 writes sale_id at intake; these reads do not change.)
    const listed = await service.listTickets(auth);
    assert.equal(listed.tickets.length, 2);
    const linked = listed.tickets.find((t) => t.ticketNo === 'ZM-260108-0001');
    const unlinked = listed.tickets.find((t) => t.ticketNo === 'ZM-260108-0002');
    assert.equal(linked?.saleId, '9001');
    assert.equal(unlinked?.saleId, null);

    const filtered = await service.listTickets(auth, { status: 'received' });
    assert.equal(filtered.tickets.length, 1);
    assert.equal(filtered.tickets[0].ticketNo, 'ZM-260108-0001');

    const detail = await service.getTicket(1, auth);
    assert.equal(detail.ticket.saleId, '9001');
    assert.equal(detail.ticket.warrantyDays, 30);
    assert.equal(detail.ticket.repairedAt, null);
    assert.deepEqual(detail.ticket.parts, []);

    await assert.rejects(
      service.getTicket(9999, auth),
      (e: unknown) => (e as { code?: string }).code === 'TICKET_NOT_FOUND',
    );

    console.log('maintenance-batch2 Part A (DTOs + read side) passed');
  } finally {
    await db.destroy();
  }
}

// ---------------------------------------------------------------- Part B
// Live-Postgres only. Mirrors the bootstrap + fixture shape of
// backend/test/acceptance/core-accounting.postgres.spec.ts (same env
// guards, same disposable-database discipline).

interface CountsResult {
  counts: {
    received: number;
    inspecting: number;
    in_progress: number;
    waiting_parts: number;
    repaired: number;
    delivered: number;
    unrepairable: number;
    cancelled: number;
    total: number;
  };
  totalRemaining: number;
}

// Package-5 contract surface for the counts endpoint (see header:
// the task names the HTTP route, not the service method name).
interface CountsCapable {
  getTicketCounts(auth: AuthContext): Promise<CountsResult>;
}

// Package-5 contract additions on the getTicket view.
type TicketView = {
  saleId: string | null;
  refundedAdvance?: boolean;
  warrantyEnd?: string | null;
};

type Fixture = {
  auth: AuthContext;
  branchId: number;
  locationId: number;
  productId: number;
};

async function runLive(): Promise<void> {
  const target = process.env.ACCEPTANCE_DATABASE_URL;
  if (!target) {
    console.log(
      'maintenance-batch2 Part B SKIPPED: set ACCEPTANCE_DATABASE_URL to a fully migrated disposable PostgreSQL database (CI-only live section)',
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
    SESSION_CSRF_SECRET: 'isolated-maintenance-batch2-csrf-only',
    ENABLE_BOOTSTRAP_ADMIN: 'false',
    SMTP_HOST: '',
    ERROR_TRACKING_ENABLED: 'false',
  });
  const { AppModule } = await import('../../src/app.module');
  const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const db = app.get<Kysely<Database>>(KYSELY_DB);
  const foundation = app.get(AccountingTenantFoundationService);
  const maintenance = app.get(MaintenanceService);
  const countsSvc = maintenance as unknown as CountsCapable;
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const secret = await createPasswordRecord('DisposableBatch2!2026#Only');

  async function fixture(label: string): Promise<Fixture> {
    const tenantId = `accept_${tag}_${label}`;
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        slug: tenantId,
        business_name: tenantId,
        owner_name: 'Batch2',
        owner_phone: tag + label,
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
        phone: tag + label,
        password_hash: secret.hash,
        password_salt: secret.salt,
        role: 'admin',
        is_active: true,
        must_change_password: false,
        permissions_json: JSON.stringify(SUPER_ADMIN_PERMISSIONS),
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    const auth: AuthContext = {
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
      .updateTable('branches')
      .set({ default_stock_location_id: Number(location.id) })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', branch.id)
      .execute();
    const product = await db
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: tenantId,
        name: 'Test product',
        barcode: `P_${tenantId}`,
        cost_price: 0,
        retail_price: 30,
        wholesale_price: 30,
        stock_qty: 0,
        reserved_qty: 0,
        is_active: true,
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('settings')
      .values({ tenant_id: tenantId, account_id: tenantId, key: 'currency', value: '"EGP"' } as any)
      .execute();
    await foundation.ensureForAuth(db, auth);
    return {
      auth,
      branchId: Number(branch.id),
      locationId: Number(location.id),
      productId: Number(product.id),
    };
  }

  const postingAmount = async (f: Fixture, code: string): Promise<number> => {
    const rows = await sql<{ amount: string }>`select coalesce(sum(l.debit-l.credit),0) as amount from journal_entry_lines l
      join journal_entries j on j.id=l.journal_entry_id and j.tenant_id=l.tenant_id
      join accounting_accounts a on a.id=l.account_id and a.tenant_id=l.tenant_id
      where l.tenant_id=${f.auth.tenantId} and a.code=${code} and j.status='posted'`.execute(db);
    return Number(Number(rows.rows[0].amount).toFixed(2));
  };

  const mkTicket = async (
    f: Fixture,
    overrides: Record<string, unknown> = {},
  ): Promise<number> => {
    const created = await maintenance.createTicket(
      {
        customerName: 'Batch2 Customer',
        customerPhone: '01000000000',
        deviceModel: 'Test Model',
        problemDescription: 'Repair',
        expectedCost: 100,
        finalCost: 100,
        advancePayment: 0,
        branchId: f.branchId,
        locationId: f.locationId,
        ...overrides,
      } as any,
      f.auth,
    );
    return Number(created.id);
  };

  const insertSerial = async (
    f: Fixture,
    row: {
      serial_number: string;
      imei_2: string | null;
      status: 'in_stock' | 'sold';
      sale_id: number | null;
    },
  ): Promise<void> => {
    await db
      .insertInto('product_serials')
      .values({
        tenant_id: f.auth.tenantId as string,
        account_id: f.auth.accountId as string,
        product_id: f.productId,
        serial_number: row.serial_number,
        imei_2: row.imei_2,
        status: row.status,
        branch_id: f.branchId,
        location_id: f.locationId,
        cost_price: 0,
        purchase_id: null,
        purchase_item_id: null,
        sale_id: row.sale_id,
        sale_item_id: null,
        notes: null,
      })
      .execute();
  };

  // Raw read of the package-5 warranty_end column (untyped SQL, so
  // this compiles on base where the column does not exist yet).
  const ticketRow = async (f: Fixture, id: number) => {
    const rows = await sql<{
      repaired_at: Date | null;
      warranty_end: Date | null;
      sale_id: number | null;
      final_cost: string;
      advance_payment: string;
      status: string;
    }>`select repaired_at, warranty_end, sale_id, final_cost, advance_payment, status
      from maintenance_tickets where tenant_id = ${f.auth.tenantId} and id = ${id}`.execute(db);
    return rows.rows[0];
  };

  const ticketView = async (f: Fixture, id: number): Promise<TicketView> =>
    (await maintenance.getTicket(id, f.auth)).ticket as unknown as TicketView;

  const pass = (label: string): void => console.log(`PASS ${label}`);

  try {
    // (a) L1 — intake links a SOLD serial to its sale; unknown /
    // in_stock serials stay unlinked. Case-insensitive, imei_2
    // match, latest SOLD row wins, tenant-scoped.
    const sf = await fixture('b2sale');
    const other = await fixture('b2saleother');
    await insertSerial(sf, { serial_number: 'B2SERIAL001', imei_2: 'B2IMEI001', status: 'sold', sale_id: 9001 });
    await insertSerial(sf, { serial_number: 'B2SERIAL002', imei_2: null, status: 'in_stock', sale_id: null });
    await insertSerial(sf, { serial_number: 'B2SERIAL003', imei_2: null, status: 'sold', sale_id: 9002 });
    await insertSerial(sf, { serial_number: 'B2SERIAL003', imei_2: null, status: 'sold', sale_id: 9003 });
    await insertSerial(sf, { serial_number: 'B2OTHER', imei_2: 'B2IMEI009', status: 'sold', sale_id: 9004 });
    // Same serial sold under ANOTHER tenant must never link here.
    await insertSerial(other, { serial_number: 'B2SERIAL001', imei_2: null, status: 'sold', sale_id: 9999 });

    const linkedId = await mkTicket(sf, { serialNumber: 'b2serial001' });
    assert.equal((await ticketView(sf, linkedId)).saleId, '9001', 'lowercase serial links the sold row, not the foreign-tenant row');
    const listed = await maintenance.listTickets(sf.auth);
    assert.equal(
      listed.tickets.find((t) => Number(t.id) === linkedId)?.saleId,
      '9001',
      'listTickets surfaces the sale link too',
    );
    const latestId = await mkTicket(sf, { serialNumber: 'B2SERIAL003' });
    assert.equal((await ticketView(sf, latestId)).saleId, '9003', 'latest SOLD row wins when a serial was sold twice');
    const imeiId = await mkTicket(sf, { serialNumber: 'B2IMEI009' });
    assert.equal((await ticketView(sf, imeiId)).saleId, '9004', 'imei_2 match links the sale');
    const stockId = await mkTicket(sf, { serialNumber: 'B2SERIAL002' });
    assert.equal((await ticketView(sf, stockId)).saleId, null, 'in_stock serial stays unlinked');
    const unknownId = await mkTicket(sf, { serialNumber: 'B2UNKNOWN001' });
    assert.equal((await ticketView(sf, unknownId)).saleId, null, 'unknown serial stays unlinked');
    pass('maintenance batch2 intake links sold serial (serial / imei_2 / case-insensitive / latest / tenant-scoped); unknown and unsold stay null');

    // (b) L2 — warranty_end = repaired_at + warranty_days at the
    // FIRST repair only; a later re-repair does not move it.
    const wf = await fixture('b2warranty');
    const w1 = await mkTicket(wf, { warrantyDays: 30 });
    await maintenance.updateTicketStatus(w1, { status: 'repaired' }, wf.auth);
    const w1First = await ticketRow(wf, w1);
    assert.ok(w1First.repaired_at, 'repaired_at is set on first repair');
    assert.ok(w1First.warranty_end, 'warranty_end is set on first repair');
    const w1Diff = new Date(w1First.warranty_end as Date).getTime() - new Date(w1First.repaired_at as Date).getTime();
    assert.ok(
      Math.abs(w1Diff - 30 * DAY_MS) <= 1000,
      `warranty_end must be repaired_at + 30 days, got diff ${w1Diff}ms`,
    );
    await maintenance.updateTicketStatus(w1, { status: 'in_progress' }, wf.auth);
    await maintenance.updateTicketStatus(w1, { status: 'repaired' }, wf.auth);
    const w1Second = await ticketRow(wf, w1);
    assert.equal(
      new Date(w1Second.warranty_end as Date).getTime(),
      new Date(w1First.warranty_end as Date).getTime(),
      're-repair must not move warranty_end',
    );
    assert.equal(
      new Date(w1Second.repaired_at as Date).getTime(),
      new Date(w1First.repaired_at as Date).getTime(),
      're-repair must not move repaired_at either',
    );
    const w2 = await mkTicket(wf, { warrantyDays: 0 });
    await maintenance.updateTicketStatus(w2, { status: 'repaired' }, wf.auth);
    const w2Row = await ticketRow(wf, w2);
    const w2Diff = new Date(w2Row.warranty_end as Date).getTime() - new Date(w2Row.repaired_at as Date).getTime();
    assert.ok(Math.abs(w2Diff) <= 1000, `0 warranty days means warranty_end == repaired_at, got diff ${w2Diff}ms`);
    const w3 = await mkTicket(wf, {});
    await maintenance.updateTicketStatus(w3, { status: 'repaired' }, wf.auth);
    const w3Row = await ticketRow(wf, w3);
    const w3Diff = new Date(w3Row.warranty_end as Date).getTime() - new Date(w3Row.repaired_at as Date).getTime();
    assert.ok(
      Math.abs(w3Diff - 30 * DAY_MS) <= 1000,
      `default warranty_days (30) applies when omitted, got diff ${w3Diff}ms`,
    );
    pass('maintenance batch2 warranty_end is repaired_at + warranty_days at first repair only');

    // (c) L3 — counts aggregate per status; totalRemaining sums
    // max(0, (final_cost || expected_cost) - advance) over
    // non-terminal tickets only.
    const cf = await fixture('b2counts');
    const c1 = await mkTicket(cf, { expectedCost: 100, finalCost: 100, advancePayment: 20 }); // received: 80
    const c2 = await mkTicket(cf, { expectedCost: 200, finalCost: 0, advancePayment: 0 }); // in_progress: 200 (fallback)
    await maintenance.updateTicketStatus(c2, { status: 'in_progress' }, cf.auth);
    const c3 = await mkTicket(cf, { expectedCost: 50, finalCost: 50, advancePayment: 20 }); // waiting_parts: max(0, 10-20) = 0
    await maintenance.updateTicketStatus(c3, { status: 'waiting_parts', finalCost: 10 }, cf.auth);
    const c4 = await mkTicket(cf, { expectedCost: 60, finalCost: 60, advancePayment: 60 }); // repaired: 0
    await maintenance.updateTicketStatus(c4, { status: 'repaired' }, cf.auth);
    const c5 = await mkTicket(cf, { expectedCost: 100, finalCost: 100, advancePayment: 20 }); // delivered: excluded
    await maintenance.updateTicketStatus(c5, { status: 'delivered', finalCost: 100, collectedAmount: 80 }, cf.auth);
    const c6 = await mkTicket(cf, { expectedCost: 70, finalCost: 70, advancePayment: 0 }); // cancelled: excluded
    await maintenance.updateTicketStatus(c6, { status: 'cancelled' }, cf.auth);
    const c7 = await mkTicket(cf, { expectedCost: 80, finalCost: 80, advancePayment: 0 }); // unrepairable: excluded
    await maintenance.updateTicketStatus(c7, { status: 'unrepairable' }, cf.auth);
    const counts = await countsSvc.getTicketCounts(cf.auth);
    assert.deepEqual(
      {
        received: Number(counts.counts.received),
        inspecting: Number(counts.counts.inspecting),
        in_progress: Number(counts.counts.in_progress),
        waiting_parts: Number(counts.counts.waiting_parts),
        repaired: Number(counts.counts.repaired),
        delivered: Number(counts.counts.delivered),
        unrepairable: Number(counts.counts.unrepairable),
        cancelled: Number(counts.counts.cancelled),
        total: Number(counts.counts.total),
      },
      {
        received: 1,
        inspecting: 0,
        in_progress: 1,
        waiting_parts: 1,
        repaired: 1,
        delivered: 1,
        unrepairable: 1,
        cancelled: 1,
        total: 7,
      },
    );
    assert.equal(
      Number(counts.totalRemaining),
      280,
      'totalRemaining = 80 + 200 + 0 + 0; terminal tickets contribute nothing',
    );
    pass('maintenance batch2 counts aggregate per status with totalRemaining over non-terminal tickets only');

    // (d) L4 — non-financial edit after an advance is allowed;
    // financial edits are rejected with 409 and change nothing.
    const ef = await fixture('b2edit');
    const e0 = await mkTicket(ef, { advancePayment: 0 });
    await maintenance.updateTicket(e0, {
      customerName: 'Batch2 Customer',
      customerPhone: '01088888888',
      deviceModel: 'Test Model',
      problemDescription: 'Repair',
    } as any, ef.auth);
    assert.equal((await ticketRow(ef, e0)).status, 'received');
    const e1 = await mkTicket(ef, { expectedCost: 100, finalCost: 100, advancePayment: 20 });
    await maintenance.updateTicket(e1, {
      customerName: 'Batch2 Customer',
      customerPhone: '01099999999',
      deviceModel: 'Test Model',
      problemDescription: 'Repair — updated notes',
    } as any, ef.auth);
    const e1After = await ticketRow(ef, e1);
    assert.equal(Number(e1After.final_cost), 100, 'non-financial edit leaves final_cost untouched');
    assert.equal(Number(e1After.advance_payment), 20, 'non-financial edit leaves the advance untouched');
    const editBase = {
      customerName: 'Batch2 Customer',
      customerPhone: '01099999999',
      deviceModel: 'Test Model',
      problemDescription: 'Repair',
    };
    for (const financial of [
      { finalCost: 120 },
      { expectedCost: 120 },
      { advancePayment: 30 },
    ]) {
      await assert.rejects(
        maintenance.updateTicket(e1, { ...editBase, ...financial } as any, ef.auth),
        (e: unknown) => (e as { statusCode?: number }).statusCode === 409,
        `financial edit ${JSON.stringify(financial)} after an advance must reject with 409`,
      );
    }
    const e1Final = await ticketRow(ef, e1);
    assert.equal(Number(e1Final.final_cost), 100, 'rejected financial edits change nothing');
    assert.equal(Number(e1Final.advance_payment), 20, 'rejected financial edits change nothing');
    pass('maintenance batch2 non-financial edit after advance allowed; financial edit rejected 409');

    // (B5) getTicket reports refundedAdvance only after a committed
    // advance refund (the P1-2 card text depends on this flag).
    const rf = await fixture('b2refund');
    const r1 = await mkTicket(rf, { expectedCost: 100, finalCost: 100, advancePayment: 20 });
    await maintenance.updateTicketStatus(r1, { status: 'cancelled', refundAdvance: true }, rf.auth);
    assert.equal((await ticketView(rf, r1)).refundedAdvance, true, 'cancelled + refunded advance reports true');
    assert.equal(await postingAmount(rf, '2150'), 0, 'refunded advance clears the 2150 liability');
    assert.equal(await postingAmount(rf, '1110'), 0, 'refunded advance returns the cash');
    const r2 = await mkTicket(rf, { expectedCost: 100, finalCost: 100, advancePayment: 20 });
    assert.equal((await ticketView(rf, r2)).refundedAdvance, false, 'advance held, not refunded, reports false');
    const r3 = await mkTicket(rf, { expectedCost: 100, finalCost: 100, advancePayment: 0 });
    await maintenance.updateTicketStatus(r3, { status: 'cancelled' }, rf.auth);
    assert.equal((await ticketView(rf, r3)).refundedAdvance, false, 'no advance at all reports false');
    pass('maintenance batch2 getTicket reports refundedAdvance only after a committed advance refund');

    // (a)+(b)+(d)+(e) L6 — the combined end-to-end flow: sold-serial
    // intake -> non-financial edit -> repair sets warranty_end ->
    // card delivery posts the remainder to 1120 -> counts reflect it.
    // (The isolated card-posting pin lives in the acceptance spec;
    // here it is asserted only as part of this flow.)
    const ff = await fixture('b2flow');
    await insertSerial(ff, { serial_number: 'B2FLOW001', imei_2: null, status: 'sold', sale_id: 9005 });
    const f1 = await mkTicket(ff, {
      serialNumber: 'B2FLOW001',
      warrantyDays: 14,
      expectedCost: 100,
      finalCost: 100,
      advancePayment: 20,
    });
    assert.equal((await ticketView(ff, f1)).saleId, '9005', 'flow ticket links its sold serial');
    await maintenance.updateTicket(f1, {
      customerName: 'Batch2 Customer',
      customerPhone: '01077777777',
      deviceModel: 'Test Model',
      problemDescription: 'Repair',
    } as any, ff.auth);
    await maintenance.updateTicketStatus(f1, { status: 'repaired' }, ff.auth);
    const fRow = await ticketRow(ff, f1);
    const fDiff = new Date(fRow.warranty_end as Date).getTime() - new Date(fRow.repaired_at as Date).getTime();
    assert.ok(Math.abs(fDiff - 14 * DAY_MS) <= 1000, `flow warranty_end must be repaired_at + 14 days, got diff ${fDiff}ms`);
    await maintenance.updateTicketStatus(
      f1,
      { status: 'delivered', finalCost: 100, collectedAmount: 80, paymentMethod: 'card' },
      ff.auth,
    );
    assert.equal(await postingAmount(ff, '1110'), 20, 'only the cash advance touches 1110');
    assert.equal(await postingAmount(ff, '1120'), 80, 'card remainder posts to bank 1120, not cash');
    assert.equal(await postingAmount(ff, '2150'), 0, 'advance liability cleared at delivery');
    assert.equal(await postingAmount(ff, '4200'), -100, 'recorded revenue is the final agreed amount');
    const cardTxns = await db
      .selectFrom('treasury_transactions')
      .select(['amount', 'payment_channel'])
      .where('tenant_id', '=', ff.auth.tenantId as string)
      .where('reference_type', '=', 'maintenance_ticket')
      .where('reference_id', '=', f1)
      .execute();
    assert.equal(cardTxns.find((row) => Number(row.amount) === 80)?.payment_channel, 'card');
    const flowCounts = await countsSvc.getTicketCounts(ff.auth);
    assert.equal(Number(flowCounts.counts.total), 1);
    assert.equal(Number(flowCounts.counts.delivered), 1);
    assert.equal(Number(flowCounts.counts.received), 0);
    assert.equal(Number(flowCounts.totalRemaining), 0, 'delivered ticket contributes nothing to totalRemaining');
    pass('maintenance batch2 sold-serial intake -> repair warranty -> card delivery -> counts end to end');

    console.log('maintenance-batch2 Part B (live Postgres) passed');
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  testDtos();
  await testReadSide();
  await runLive();
  console.log('maintenance-batch2.spec.ts passed');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
