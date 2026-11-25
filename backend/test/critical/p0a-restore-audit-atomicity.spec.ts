import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-contract regression: a snapshot failure must abort the restore transaction.
// Database rollback and concurrent restore need a separate PostgreSQL integration fixture.
const src = readFileSync(join(__dirname, '../../src/modules/settings/services/settings-backup.service.ts'), 'utf8');
const method = src.slice(src.indexOf('async restoreBackup('));
const snapshot = method.indexOf('insert into backup_snapshots');
const transactionClose = method.indexOf('      });', method.indexOf('await this.db.transaction().execute('));
const orphanGuard = method.indexOf('await this.assertNoOrphanedReferences(');
const cacheInvalidation = method.indexOf('this.authCache.invalidateTenant(');
assert.ok(snapshot > orphanGuard && snapshot < transactionClose, 'snapshot insert must be in restore transaction');
assert.ok(cacheInvalidation > transactionClose, 'auth caches must invalidate only after commit');
assert.match(method.slice(snapshot, transactionClose), /\.execute\(trx\)/, 'record write must use same transaction');
assert.ok(
  !method.slice(transactionClose).includes('insert into backup_snapshots'),
  'no failing snapshot write after commit',
);
console.log('p0a-restore-audit-atomicity: source transaction boundary verified');
