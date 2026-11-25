import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { remapForeignKeys } from '../../src/modules/settings/services/settings-backup.service';

// Guard for the in-app backup restore invariants RESTORE-1..RESTORE-3 (ARCHITECTURE_INVARIANTS.md
// O65). Found by a real restore test on 2026-09-22: the old restore disabled FK checks, gave every
// row a new id, skipped remapping any column named account_id, and restored tables in an order
// where parents often came after children. A restore of production data left 20 of 23 journal
// lines pointing at chart-of-accounts rows that did not exist, plus orphaned branches, stock
// locations, installments and sale allocations — and reported success.

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', '..', 'src', relative), 'utf8').replace(/\r\n/g, '\n');
const service = read('modules/settings/services/settings-backup.service.ts');

// RESTORE-1: journal_entry_lines.account_id is remapped like any other FK; only tenant_id is skipped.
function testAccountIdFkIsRemapped(): void {
  const idMap = new Map<string, Map<string, string>>([
    ['accounting_accounts', new Map([['143', '7']])],
    ['journal_entries', new Map([['55', '900']])],
  ]);
  const row: Record<string, unknown> = { account_id: 143, journal_entry_id: 55, tenant_id: 'old-tenant', debit: 10 };
  remapForeignKeys(
    row,
    [
      { column_name: 'account_id', foreign_table_name: 'accounting_accounts' },
      { column_name: 'journal_entry_id', foreign_table_name: 'journal_entries' },
      { column_name: 'tenant_id', foreign_table_name: 'tenants' },
    ],
    idMap,
  );
  assert.equal(row.account_id, '7', 'journal line account_id must follow the remapped chart of accounts');
  assert.equal(row.journal_entry_id, '900');
  assert.equal(row.tenant_id, 'old-tenant', 'tenant_id is set by normalization, never by the FK remap');

  assert.ok(!/column_name === 'account_id'/.test(service), 'never skip the FK remap by the column name account_id');
  assert.ok(
    !/tableName !== 'journal_entry_lines'/.test(service),
    'account_id normalization must be decided by whether the column is an FK, not by a hardcoded table name',
  );
  assert.ok(/if \(!fkColumns\.has\('account_id'\)\) normalized\.account_id = scope\.accountId/.test(service));
}

// RESTORE-2: a tenant restoring its own backup keeps the original ids, so no reference needs remapping.
function testOriginalIdsAreKeptWhenFree(): void {
  const restore = service.slice(service.indexOf('async restoreBackup('));
  const clearAt = restore.indexOf('delete from ${sql.table(table)} where tenant_id');
  const keepAt = restore.indexOf('const keepOriginalIds = await this.canKeepOriginalIds(');
  const insertLoopAt = restore.indexOf('const restoredTables: string[] = []');
  assert.ok(clearAt > -1 && keepAt > -1 && insertLoopAt > -1, 'clear, id check and insert loop must all be present');
  assert.ok(
    clearAt < keepAt && keepAt < insertLoopAt,
    'the id-conflict check must run after the tenant rows are cleared and before anything is inserted',
  );
  assert.ok(
    /overriding system value/.test(service),
    'identity ALWAYS columns need OVERRIDING SYSTEM VALUE to keep ids',
  );
  assert.ok(
    /if \(!keepOriginalIds\) \{\s*remapForeignKeys\(/.test(service),
    'remapping only happens in the fallback mode',
  );
}

// RESTORE-3: FK checks are off during the restore, so every FK touching the restored tables is
// verified inside the same transaction; any orphan throws and rolls the whole restore back.
function testOrphanGateRunsBeforeCommit(): void {
  const restore = service.slice(service.indexOf('async restoreBackup('));
  const replicaAt = restore.indexOf("SET LOCAL session_replication_role = 'replica'");
  const gateAt = restore.indexOf('await this.assertNoOrphanedReferences(');
  const txEndAt = restore.indexOf('      });', gateAt);
  const snapshotAt = restore.indexOf('insert into backup_snapshots');
  assert.ok(replicaAt > -1 && gateAt > replicaAt, 'the orphan gate must run after FK checks are disabled');
  assert.ok(
    txEndAt > gateAt && snapshotAt > gateAt && snapshotAt < txEndAt,
    'the orphan gate AND durable restore snapshot must run inside the same transaction before commit',
  );
  assert.ok(
    restore.slice(snapshotAt, txEndAt).includes('.execute(trx)'),
    'a restore snapshot insert must use the same database transaction, not a post-commit connection',
  );

  const gate = service.slice(
    service.indexOf('private async assertNoOrphanedReferences('),
    service.indexOf('async restoreBackup('),
  );
  assert.ok(
    gate.includes('findOrphanedReferences(trx, specs, tenantId, extra)'),
    'the restore gate delegates to the shared tenant-transfer gate over ALL tenant tables',
  );
  assert.ok(
    /throw new AppError\([\s\S]*RESTORE_ORPHANED_REFERENCES/.test(gate),
    'orphans must fail the restore, not be skipped',
  );

  const engine = readFileSync(
    join(__dirname, '..', '..', 'src', 'core', 'tenant-transfer', 'tenant-package.ts'),
    'utf8',
  );
  const shared = engine.slice(
    engine.indexOf('export async function findOrphanedReferences('),
    engine.indexOf('export async function importTenantPackage('),
  );
  assert.ok(
    shared.includes('not exists (select 1 from ${sql.table(fk.foreign_table)} as parent where ${matches})'),
    'missing parents are counted',
  );
  assert.ok(
    shared.includes('parent.tenant_id <> ${tenantId}'),
    'parents that belong to another tenant are counted too',
  );
}

function testTopologicalOrderAndCircularResolution(): void {
  // 1. sessions must not be backed up or restored
  assert.ok(
    !/BACKUP_TABLES: BackupTableName\[\] = \[[^\]]*'sessions'/.test(service),
    'sessions must not be in BACKUP_TABLES',
  );

  // 2. Order of tables: parents before children
  const backupTablesMatch = service.match(/const BACKUP_TABLES: BackupTableName\[\] = \[([\s\S]*?)\];/);
  assert.ok(backupTablesMatch, 'BACKUP_TABLES array must exist');
  const tableNames = backupTablesMatch[1].match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];

  const idxOf = (t: string) => {
    const idx = tableNames.indexOf(t);
    assert.ok(idx > -1, `Table ${t} must be in BACKUP_TABLES`);
    return idx;
  };

  assert.ok(idxOf('branches') < idxOf('stock_locations'), 'branches must precede stock_locations');
  assert.ok(idxOf('stock_locations') < idxOf('users'), 'stock_locations must precede users');
  assert.ok(idxOf('users') < idxOf('journal_entries'), 'users must precede journal_entries');
  assert.ok(idxOf('branches') < idxOf('journal_entries'), 'branches must precede journal_entries');
  assert.ok(
    idxOf('accounting_accounts') < idxOf('journal_entry_lines'),
    'accounting_accounts must precede journal_entry_lines',
  );
  assert.ok(idxOf('sales') < idxOf('journal_entries'), 'sales must precede journal_entries');
  assert.ok(idxOf('purchases') < idxOf('journal_entries'), 'purchases must precede journal_entries');
  assert.ok(
    idxOf('sale_items') < idxOf('sale_line_stock_allocations'),
    'sale_items must precede sale_line_stock_allocations',
  );

  // 3. Circular FK resolution for branches and stock_locations
  assert.ok(
    /update branches set default_stock_location_id/.test(service),
    'branches.default_stock_location_id must be resolved in phase 2',
  );

  // 4. Dynamic wipe of all tenant tables before restore
  assert.ok(
    /const tenantSpecs = await listTenantTables/.test(service),
    'restoreBackup must dynamically discover and wipe all tenant tables',
  );
}

function run(): void {
  testAccountIdFkIsRemapped();
  testOriginalIdsAreKeptWhenFree();
  testOrphanGateRunsBeforeCommit();
  testTopologicalOrderAndCircularResolution();
  console.log('backup-restore-integrity.spec: all restore invariants hold (RESTORE-1..RESTORE-3)');
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
