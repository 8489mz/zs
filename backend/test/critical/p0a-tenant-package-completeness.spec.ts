import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PACKAGE_FORMAT, readPackage, type PackageManifest } from '../../src/core/tenant-transfer/tenant-package';

// Partial source-contract coverage. Full transaction/rollback requires PostgreSQL.
const src = readFileSync(join(__dirname, '../../src/core/tenant-transfer/tenant-package.ts'), 'utf8');
const fn = src.slice(src.indexOf('export async function importTenantPackage('));
const preflightAt = fn.indexOf('Package omits live tenant table');
const deleteAt = fn.indexOf('// 3. Clear the target tenant');
const countAt = fn.indexOf('insertedRowsByTable.get(table)');
const orphanAt = fn.indexOf('await findOrphanedReferences(');
assert.ok(preflightAt > 0 && preflightAt < deleteAt, 'preflight missing tables before deletes');
assert.ok(countAt > deleteAt && countAt < orphanAt, 'count inserted rows before commit');
assert.ok(fn.includes('ownedRows(spec, target.tenantId)'), 'preflight child tables too');
const m: PackageManifest = {
  format: PACKAGE_FORMAT,
  createdAt: '2026-10-25T00:00:00Z',
  source: 'spec',
  tenant: { id: 't1', slug: 't1', businessName: '', ownerName: '', ownerPhone: '', ownerEmail: '', activityType: null },
  origin: null,
  migration: { latest: '', count: 0 },
  offlineIdBlock: null,
  tables: { products: { rows: 1, columns: ['id', 'tenant_id'] } },
};
function pkg(manifest: PackageManifest, rows: string[]): Buffer {
  return gzipSync(Buffer.from([PACKAGE_FORMAT + '\t' + JSON.stringify(manifest), ...rows].join('\n')));
}
assert.throws(() => readPackage(pkg(m, ['customers\t[{"id":1}]'])), /Undeclared package table/);
assert.throws(
  () => readPackage(pkg({ ...m, tables: { products: { rows: -1, columns: [] } } }, [])),
  /Invalid table inventory/,
);
assert.throws(() => readPackage(pkg(m, [])), /missing the rows/);
console.log('p0a-tenant-package-completeness: source contract and archive parser checks passed');
