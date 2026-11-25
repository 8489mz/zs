/*
 * INV-INV-COUNT-TRANSFER-SQL-PAGINATION: `listStockCountSessions` and
 * `listStockTransfers` must fetch only the requested page from the
 * database — never load the whole tenant set and slice one page out of
 * it in memory.
 *
 * THE BUG: both methods ran unbounded SELECTs, mapped the full set in
 * memory, then sliced one page with the former in-memory slicer
 * (defaultSize 8 / 10) — maxSize defaults to 100, so a client asking
 * pageSize=150 silently received 100 rows.
 *
 * RULES PINNED HERE, driving the REAL InventoryCountService and
 * InventoryTransferService on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows. Both methods.
 * 2. Only the requested page is returned, the old ORDER BY preserved
 *    (sessions: id DESC; transfers: id DESC).
 * 3. Defaults preserved: sessions 8 rows, transfers 10 rows.
 * 4. A page past the end clamps to the last page (page 99 -> last).
 * 5. SESSIONS — search is the Arabic-normalized whole-substring match
 *    (matchesArabic) over docNo (fallback 'COUNT-' + id), note,
 *    locationName, branchName: 'اعاده' finds the note with alef/hamza
 *    variants, '987' finds the doc with Eastern digits, 'مخزن' finds
 *    the diacritic note and the note containing the word, 'COUNT-3'
 *    finds the docNo fallback. Filter is the lowercased status compare
 *    with the 'draft'-also-matches-'posting' quirk. The summary stays
 *    exact over the FULL filtered set (draft/posted counts use EXACT
 *    status match on the mapped status; totalVariance sums item
 *    varianceQty over the full set).
 * 6. TRANSFERS — search is the PLAIN lowercase substring (no Arabic
 *    normalization, NO trim: ' first ' with spaces matches nothing).
 *    Filter is the lowercased status compare, no posting quirk. The
 *    summary stays exact over the FULL filtered set (counts use EXACT
 *    status match — 'SENT' counts in NEITHER bucket; totalQty sums item
 *    qty over the full set). locationId filters from OR to location.
 * 7. SCOPE — a branch-1 cashier sees branch-1 + NULL-branch rows only
 *    (sessions) and transfers whose BOTH branches are in scope (or
 *    NULL); a cashier with no branches sees nothing. The summary is
 *    computed over the scope-filtered set.
 * 8. The UNPAGINATED paths are preserved: {} returns the FULL
 *    scope-filtered list (sessions also carry damagedStockRecords).
 *
 * Prospective only; PGlite only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { InventoryCountService } from '../../src/modules/inventory/services/inventory-count.service';
import { InventoryTransferService } from '../../src/modules/inventory/services/inventory-transfer.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const ADMIN = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: ['inventory', 'canAdjustInventory'],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;
const CASHIER = {
  userId: 2,
  sessionId: 'sess-spec',
  username: 'cashier-1',
  role: 'cashier',
  permissions: ['inventory', 'canAdjustInventory'],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;
const NOBRANCH = {
  userId: 3,
  sessionId: 'sess-spec',
  username: 'cashier-2',
  role: 'cashier',
  permissions: ['inventory', 'canAdjustInventory'],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

type Page = { page: number; pageSize: number; totalItems: number; totalPages: number };

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE users (id int PRIMARY KEY, tenant_id text, username text, display_name text, default_branch_id int);
    CREATE TABLE user_branches (user_id int, branch_id int, tenant_id text);
    CREATE TABLE branches (id int PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id int PRIMARY KEY, tenant_id text, name text, branch_id int);
    CREATE TABLE products (id int PRIMARY KEY, tenant_id text, name text, name_en text, barcode text, style_code text);
    CREATE TABLE stock_count_sessions (id int PRIMARY KEY, tenant_id text, account_id text, doc_no text, branch_id int, location_id int, status text, note text, posted_at timestamptz, created_at timestamptz, counted_by int, approved_by int);
    CREATE TABLE stock_count_items (id int PRIMARY KEY, tenant_id text, session_id int, product_id int, product_name text, expected_qty numeric, counted_qty numeric, variance_qty numeric, counted_serials text, batch_counts text, reason text, note text);
    CREATE TABLE stock_transfers (id int PRIMARY KEY, tenant_id text, account_id text, doc_no text, from_location_id int, to_location_id int, from_branch_id int, to_branch_id int, status text, note text, recipient_name text, received_at timestamptz, cancelled_at timestamptz, created_at timestamptz, created_by int, received_by int, cancelled_by int);
    CREATE TABLE stock_transfer_items (id int PRIMARY KEY, tenant_id text, transfer_id int, product_id int, product_name text, qty numeric, serial_tracking boolean, batch_tracking boolean);
    CREATE TABLE damaged_stock_records (id int PRIMARY KEY, tenant_id text, product_id int, branch_id int, location_id int, qty numeric, reason text, note text, created_at timestamptz, created_by int);
  `);

  const now = '2026-11-24T10:00:00Z';
  await db
    .insertInto('users')
    .values([
      { id: 1, tenant_id: 't1', username: 'actor-1', display_name: 'Actor', default_branch_id: null },
      { id: 2, tenant_id: 't1', username: 'cashier-1', display_name: 'Cashier', default_branch_id: null },
      { id: 3, tenant_id: 't1', username: 'cashier-2', display_name: 'NoBranch', default_branch_id: null },
    ] as never)
    .execute();
  await db
    .insertInto('user_branches')
    .values([{ user_id: 2, branch_id: 1, tenant_id: 't1' }] as never)
    .execute();
  await db
    .insertInto('branches')
    .values([
      { id: 1, tenant_id: 't1', name: 'Branch One' },
      { id: 2, tenant_id: 't1', name: 'Branch Two' },
    ] as never)
    .execute();
  await db
    .insertInto('stock_locations')
    .values([
      { id: 1, tenant_id: 't1', name: 'Loc One', branch_id: 1 },
      { id: 2, tenant_id: 't1', name: 'Loc Two', branch_id: 2 },
    ] as never)
    .execute();
  await db
    .insertInto('products')
    .values([{ id: 1, tenant_id: 't1', name: 'Widget', name_en: 'Widget', barcode: null, style_code: null }] as never)
    .execute();
  await db
    .insertInto('damaged_stock_records')
    .values([
      {
        id: 1,
        tenant_id: 't1',
        product_id: 1,
        branch_id: 1,
        location_id: 1,
        qty: 1,
        reason: 'damage',
        note: '',
        created_at: now,
        created_by: 1,
      },
      {
        id: 2,
        tenant_id: 't1',
        product_id: 1,
        branch_id: 1,
        location_id: 1,
        qty: 2,
        reason: 'damage',
        note: '',
        created_at: now,
        created_by: 1,
      },
    ] as never)
    .execute();

  // ---- sessions: named 1-10 + filler 100-339 (240) = 250 ----
  type SessionSeed = {
    id: number;
    docNo: string | null;
    branchId: number | null;
    locationId: number | null;
    status: string | null;
    note: string;
    items: Array<{ id: number; variance: number }>;
  };
  const namedSessions: SessionSeed[] = [
    {
      id: 1,
      docNo: 'ZSC-001',
      branchId: 1,
      locationId: 1,
      status: 'draft',
      note: 'جرد المخزن الرئيسي',
      items: [
        { id: 1, variance: 1.5 },
        { id: 2, variance: 2.25 },
      ],
    },
    {
      id: 2,
      docNo: 'ZSC-002',
      branchId: 2,
      locationId: 2,
      status: 'posted',
      note: 'posted note',
      items: [{ id: 3, variance: -0.5 }],
    },
    { id: 3, docNo: null, branchId: null, locationId: null, status: null, note: '', items: [] },
    { id: 4, docNo: 'ZSC-004', branchId: 1, locationId: 1, status: 'posting', note: '', items: [] },
    { id: 5, docNo: 'ZSC-005', branchId: 1, locationId: 1, status: 'DRAFT', note: '', items: [] },
    { id: 6, docNo: 'ZSC-006', branchId: 1, locationId: 1, status: 'draft', note: 'إعادة الجرد', items: [] },
    { id: 7, docNo: 'ZSC-٩٨٧', branchId: 1, locationId: 1, status: 'draft', note: '', items: [] },
    { id: 8, docNo: 'ZSC-008', branchId: 1, locationId: 1, status: 'draft', note: 'مُخزن', items: [] },
    { id: 9, docNo: 'ZSC-009', branchId: 2, locationId: 2, status: 'cancelled', note: '', items: [] },
    { id: 10, docNo: 'ZSC-010', branchId: 1, locationId: 1, status: 'posted', note: 'second posted', items: [] },
  ];
  const sessionRows: Array<Record<string, unknown>> = [];
  const itemRows: Array<Record<string, unknown>> = [];
  for (const s of namedSessions) {
    sessionRows.push({
      id: s.id,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: s.docNo,
      branch_id: s.branchId,
      location_id: s.locationId,
      status: s.status,
      note: s.note,
      posted_at: null,
      created_at: now,
      counted_by: s.id === 3 ? null : 1,
      approved_by: null,
    });
    for (const it of s.items) {
      itemRows.push({
        id: it.id,
        tenant_id: 't1',
        session_id: s.id,
        product_id: 1,
        product_name: 'Widget',
        expected_qty: 0,
        counted_qty: it.variance,
        variance_qty: it.variance,
        counted_serials: null,
        batch_counts: null,
        reason: null,
        note: null,
      });
    }
  }
  for (let id = 100; id <= 339; id++) {
    sessionRows.push({
      id,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: `ZSC-${id}`,
      branch_id: 1,
      location_id: 1,
      status: 'draft',
      note: '',
      posted_at: null,
      created_at: now,
      counted_by: 1,
      approved_by: null,
    });
  }
  await db
    .insertInto('stock_count_sessions')
    .values(sessionRows as never)
    .execute();
  if (itemRows.length > 0)
    await db
      .insertInto('stock_count_items')
      .values(itemRows as never)
      .execute();

  // ---- transfers: named 1-8 + filler 100-339 (240) = 248 ----
  type TransferSeed = {
    id: number;
    docNo: string | null;
    fromLoc: number | null;
    toLoc: number | null;
    fromBranch: number | null;
    toBranch: number | null;
    status: string;
    note: string;
    qtys: number[];
  };
  const namedTransfers: TransferSeed[] = [
    {
      id: 1,
      docNo: 'TR-001',
      fromLoc: 1,
      toLoc: 2,
      fromBranch: 1,
      toBranch: 1,
      status: 'sent',
      note: 'first transfer',
      qtys: [2, 3],
    },
    {
      id: 2,
      docNo: 'TR-002',
      fromLoc: 2,
      toLoc: 1,
      fromBranch: 1,
      toBranch: 2,
      status: 'received',
      note: 'cross branch',
      qtys: [1.5],
    },
    {
      id: 3,
      docNo: 'TR-003',
      fromLoc: 2,
      toLoc: 2,
      fromBranch: 2,
      toBranch: 2,
      status: 'cancelled',
      note: '',
      qtys: [4],
    },
    {
      id: 4,
      docNo: null,
      fromLoc: null,
      toLoc: 1,
      fromBranch: null,
      toBranch: 1,
      status: 'sent',
      note: '',
      qtys: [0.5],
    },
    {
      id: 5,
      docNo: 'TR-005',
      fromLoc: 1,
      toLoc: null,
      fromBranch: 1,
      toBranch: null,
      status: 'sent',
      note: 'UPPER Note',
      qtys: [2],
    },
    { id: 6, docNo: 'TR-006', fromLoc: 1, toLoc: 1, fromBranch: 1, toBranch: 1, status: 'SENT', note: '', qtys: [] },
    {
      id: 7,
      docNo: 'TR-ABC',
      fromLoc: 1,
      toLoc: 2,
      fromBranch: 1,
      toBranch: 1,
      status: 'received',
      note: 'mixed CASE note',
      qtys: [],
    },
    { id: 8, docNo: 'TR-008', fromLoc: 2, toLoc: 1, fromBranch: 2, toBranch: 1, status: 'sent', note: '', qtys: [] },
  ];
  const transferRows: Array<Record<string, unknown>> = [];
  const transferItemRows: Array<Record<string, unknown>> = [];
  let transferItemId = 1;
  for (const t of namedTransfers) {
    transferRows.push({
      id: t.id,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: t.docNo,
      from_location_id: t.fromLoc,
      to_location_id: t.toLoc,
      from_branch_id: t.fromBranch,
      to_branch_id: t.toBranch,
      status: t.status,
      note: t.note,
      recipient_name: null,
      received_at: null,
      cancelled_at: null,
      created_at: now,
      created_by: 1,
      received_by: null,
      cancelled_by: null,
    });
    for (const qty of t.qtys) {
      transferItemRows.push({
        id: transferItemId++,
        tenant_id: 't1',
        transfer_id: t.id,
        product_id: 1,
        product_name: 'Widget',
        qty,
        serial_tracking: false,
        batch_tracking: false,
      });
    }
  }
  for (let id = 100; id <= 339; id++) {
    transferRows.push({
      id,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: `TR-${id}`,
      from_location_id: 1,
      to_location_id: 2,
      from_branch_id: 1,
      to_branch_id: 1,
      status: 'sent',
      note: '',
      recipient_name: null,
      received_at: null,
      cancelled_at: null,
      created_at: now,
      created_by: 1,
      received_by: null,
      cancelled_by: null,
    });
    transferItemRows.push({
      id: transferItemId++,
      tenant_id: 't1',
      transfer_id: id,
      product_id: 1,
      product_name: 'Widget',
      qty: 1,
      serial_tracking: false,
      batch_tracking: false,
    });
  }
  await db
    .insertInto('stock_transfers')
    .values(transferRows as never)
    .execute();
  await db
    .insertInto('stock_transfer_items')
    .values(transferItemRows as never)
    .execute();

  const scope = new InventoryScopeService(db);
  const countService = new InventoryCountService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    scope,
    {} as never,
    {} as never,
  );
  const transferService = new InventoryTransferService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    scope,
    {} as never,
    {} as never,
  );

  // ---------- sessions (admin) ----------
  const sDefault = (await countService.listStockCountSessions({ page: 1 }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
    pagination: Page;
    summary: { totalItems: number; draft: number; posted: number; totalVariance: number };
  };
  assert.equal(sDefault.stockCountSessions.length, 8, 'sessions default page is 8 rows');
  assert.deepEqual(sDefault.pagination, { page: 1, pageSize: 8, totalItems: 250, totalPages: 32 });
  assert.equal(sDefault.stockCountSessions[0].id, '339', 'sessions ordered id DESC');
  assert.deepEqual(sDefault.summary, { totalItems: 250, draft: 245, posted: 2, totalVariance: 3.25 });

  const sCap150 = (await countService.listStockCountSessions({ page: 1, pageSize: 150 }, ADMIN)) as {
    stockCountSessions: unknown[];
    pagination: Page;
  };
  assert.equal(sCap150.stockCountSessions.length, 150, 'sessions pageSize=150 returns 150 rows (old code: 100)');
  const sCap1000 = (await countService.listStockCountSessions({ page: 1, pageSize: 1000 }, ADMIN)) as {
    stockCountSessions: unknown[];
    pagination: Page;
  };
  assert.equal(sCap1000.stockCountSessions.length, 200, 'sessions pageSize=1000 caps at 200');
  assert.equal(sCap1000.pagination.pageSize, 200);

  const sPage2 = (await countService.listStockCountSessions({ page: 2 }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
  };
  assert.deepEqual(
    sPage2.stockCountSessions.map((r) => r.id),
    ['331', '330', '329', '328', '327', '326', '325', '324'],
  );
  const sClamp = (await countService.listStockCountSessions({ page: 99 }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
    pagination: Page;
  };
  assert.equal(sClamp.pagination.page, 32, 'sessions page 99 clamps to last page 32');
  assert.deepEqual(
    sClamp.stockCountSessions.map((r) => r.id),
    ['2', '1'],
  );

  const sSearchAleph = (await countService.listStockCountSessions({ search: 'اعاده' }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
    pagination: Page;
  };
  assert.deepEqual(
    sSearchAleph.stockCountSessions.map((r) => r.id),
    ['6'],
    'Arabic search matches alef/hamza variants',
  );
  const sSearchDigits = (await countService.listStockCountSessions({ search: '987' }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchDigits.stockCountSessions.map((r) => r.id),
    ['7'],
    'Arabic search matches Eastern digits',
  );
  const sSearchWord = (await countService.listStockCountSessions({ search: 'مخزن' }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchWord.stockCountSessions.map((r) => r.id),
    ['8', '1'],
    'Arabic search matches diacritic note and containing note',
  );
  const sSearchFallback = (await countService.listStockCountSessions({ search: 'COUNT-3' }, ADMIN)) as {
    stockCountSessions: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchFallback.stockCountSessions.map((r) => r.id),
    ['3'],
    'Arabic search matches the COUNT- fallback docNo',
  );

  const sFilterDraft = (await countService.listStockCountSessions({ filter: 'draft' }, ADMIN)) as {
    pagination: Page;
    summary: { totalItems: number; draft: number; posted: number; totalVariance: number };
  };
  assert.equal(sFilterDraft.pagination.totalItems, 247, 'filter draft matches posting quirk + DRAFT case');
  assert.deepEqual(sFilterDraft.summary, { totalItems: 247, draft: 245, posted: 0, totalVariance: 3.75 });
  const sFilterPosted = (await countService.listStockCountSessions({ filter: 'posted' }, ADMIN)) as {
    pagination: Page;
    summary: { totalItems: number; draft: number; posted: number; totalVariance: number };
  };
  assert.equal(sFilterPosted.pagination.totalItems, 2);
  assert.deepEqual(sFilterPosted.summary, { totalItems: 2, draft: 0, posted: 2, totalVariance: -0.5 });

  const sCashier = (await countService.listStockCountSessions({ page: 1 }, CASHIER)) as {
    pagination: Page;
    summary: { totalItems: number; draft: number; posted: number; totalVariance: number };
  };
  assert.equal(sCashier.pagination.totalItems, 248, 'branch-1 cashier sees branch-1 + NULL-branch sessions only');
  assert.deepEqual(sCashier.summary, { totalItems: 248, draft: 245, posted: 1, totalVariance: 3.75 });
  const sNoBranch = (await countService.listStockCountSessions({ page: 1 }, NOBRANCH)) as {
    stockCountSessions: unknown[];
    pagination: Page;
    summary: { totalItems: number; draft: number; posted: number; totalVariance: number };
  };
  assert.equal(sNoBranch.stockCountSessions.length, 0);
  assert.deepEqual(sNoBranch.pagination, { page: 1, pageSize: 8, totalItems: 0, totalPages: 1 });
  assert.deepEqual(sNoBranch.summary, { totalItems: 0, draft: 0, posted: 0, totalVariance: 0 });

  const sUnpaginated = (await countService.listStockCountSessions({}, ADMIN)) as {
    stockCountSessions: unknown[];
    damagedStockRecords: unknown[];
  };
  assert.equal(sUnpaginated.stockCountSessions.length, 250, 'unpaginated {} returns the full list');
  assert.equal(sUnpaginated.damagedStockRecords.length, 2, 'unpaginated {} still carries damagedStockRecords');

  // ---------- transfers (admin) ----------
  const tDefault = (await transferService.listStockTransfers({ page: 1 }, ADMIN)) as {
    stockTransfers: Array<{ id: string }>;
    pagination: Page;
    summary: { totalItems: number; sent: number; received: number; cancelled: number; totalQty: number };
  };
  assert.equal(tDefault.stockTransfers.length, 10, 'transfers default page is 10 rows');
  assert.deepEqual(tDefault.pagination, { page: 1, pageSize: 10, totalItems: 248, totalPages: 25 });
  assert.equal(tDefault.stockTransfers[0].id, '339', 'transfers ordered id DESC');
  assert.deepEqual(tDefault.summary, { totalItems: 248, sent: 244, received: 2, cancelled: 1, totalQty: 253 });

  const tCap150 = (await transferService.listStockTransfers({ page: 1, pageSize: 150 }, ADMIN)) as {
    stockTransfers: unknown[];
  };
  assert.equal(tCap150.stockTransfers.length, 150, 'transfers pageSize=150 returns 150 rows (old code: 100)');
  const tCap1000 = (await transferService.listStockTransfers({ page: 1, pageSize: 1000 }, ADMIN)) as {
    stockTransfers: unknown[];
    pagination: Page;
  };
  assert.equal(tCap1000.stockTransfers.length, 200, 'transfers pageSize=1000 caps at 200');
  assert.equal(tCap1000.pagination.pageSize, 200);

  const tClamp = (await transferService.listStockTransfers({ page: 99 }, ADMIN)) as {
    stockTransfers: Array<{ id: string }>;
    pagination: Page;
  };
  assert.equal(tClamp.pagination.page, 25, 'transfers page 99 clamps to last page 25');
  assert.deepEqual(
    tClamp.stockTransfers.map((r) => r.id),
    ['8', '7', '6', '5', '4', '3', '2', '1'],
  );

  const tFilterSent = (await transferService.listStockTransfers({ filter: 'sent' }, ADMIN)) as {
    pagination: Page;
    summary: { totalItems: number; sent: number; received: number; cancelled: number; totalQty: number };
  };
  assert.equal(tFilterSent.pagination.totalItems, 245, 'filter sent matches SENT case-insensitively');
  assert.deepEqual(tFilterSent.summary, { totalItems: 245, sent: 244, received: 0, cancelled: 0, totalQty: 247.5 });
  const tFilterReceived = (await transferService.listStockTransfers({ filter: 'received' }, ADMIN)) as {
    pagination: Page;
    summary: { totalItems: number; sent: number; received: number; cancelled: number; totalQty: number };
  };
  assert.equal(tFilterReceived.pagination.totalItems, 2);
  assert.deepEqual(tFilterReceived.summary, { totalItems: 2, sent: 0, received: 2, cancelled: 0, totalQty: 1.5 });

  const tSearchAbc = (await transferService.listStockTransfers({ search: 'tr-abc' }, ADMIN)) as {
    stockTransfers: Array<{ id: string }>;
  };
  assert.deepEqual(
    tSearchAbc.stockTransfers.map((r) => r.id),
    ['7'],
    'transfer search is plain lowercase substring',
  );
  const tSearchUpper = (await transferService.listStockTransfers({ search: 'upper' }, ADMIN)) as {
    stockTransfers: Array<{ id: string }>;
  };
  assert.deepEqual(
    tSearchUpper.stockTransfers.map((r) => r.id),
    ['5'],
  );
  const tSearchSpaced = (await transferService.listStockTransfers({ search: ' first ' }, ADMIN)) as {
    stockTransfers: unknown[];
    pagination: Page;
  };
  assert.equal(tSearchSpaced.stockTransfers.length, 0, 'transfer search does NOT trim the needle');
  assert.equal(tSearchSpaced.pagination.totalItems, 0);
  const tSearchDoc = (await transferService.listStockTransfers({ search: 'TR-001' }, ADMIN)) as {
    stockTransfers: Array<{ id: string }>;
  };
  assert.deepEqual(
    tSearchDoc.stockTransfers.map((r) => r.id),
    ['1'],
  );

  const tLocation = (await transferService.listStockTransfers({ locationId: 1 }, ADMIN)) as {
    stockTransfers: unknown[];
  };
  assert.equal(
    tLocation.stockTransfers.length,
    247,
    'locationId alone stays unpaginated (old shape) and filters from OR to location',
  );
  const tLocationPage = (await transferService.listStockTransfers({ locationId: 1, page: 1 }, ADMIN)) as {
    pagination: Page;
  };
  assert.equal(tLocationPage.pagination.totalItems, 247, 'locationId + page paginates the filtered set');

  const tCashier = (await transferService.listStockTransfers({ page: 1 }, CASHIER)) as {
    pagination: Page;
    summary: { totalItems: number; sent: number; received: number; cancelled: number; totalQty: number };
  };
  assert.equal(tCashier.pagination.totalItems, 245, 'branch-1 cashier sees only transfers with BOTH branches in scope');
  assert.deepEqual(tCashier.summary, { totalItems: 245, sent: 243, received: 1, cancelled: 0, totalQty: 247.5 });
  const tNoBranch = (await transferService.listStockTransfers({ page: 1 }, NOBRANCH)) as {
    stockTransfers: unknown[];
    pagination: Page;
  };
  assert.equal(tNoBranch.stockTransfers.length, 0);
  assert.deepEqual(tNoBranch.pagination, { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });

  const tUnpaginated = (await transferService.listStockTransfers({}, ADMIN)) as { stockTransfers: unknown[] };
  assert.equal(tUnpaginated.stockTransfers.length, 248, 'unpaginated {} returns the full list');

  await db.destroy();
  console.log('PASS inventory-count-transfer-sql-pagination');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
