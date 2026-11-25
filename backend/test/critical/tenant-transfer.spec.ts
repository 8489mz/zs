import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import {
  buildBundle,
  decryptBundle,
  encryptBundle,
  isEncrypted,
  readBundle,
  resolveTenantPackage,
  tenantEntryName,
} from '../../src/core/tenant-transfer/backup-bundle';
import {
  MAX_OFFLINE_ID_BLOCKS,
  OFFLINE_ID_BLOCK_SIZE,
  PACKAGE_FORMAT,
  PLATFORM_TENANT_TABLES,
  RESERVED_OFFLINE_ID_BASE,
  offlineBlockRange,
  readPackage,
  type PackageManifest,
} from '../../src/core/tenant-transfer/tenant-package';

// Guard for tenant transfer between cloud and desktop, TRANSFER-1..TRANSFER-5
// (ARCHITECTURE_INVARIANTS.md §2.9). Verified end to end on 2026-09-22 against a copy of production:
// cloud -> desktop -> offline edits -> cloud, byte-identical, other tenants untouched.

const engine = readFileSync(
  join(__dirname, '..', '..', 'src', 'core', 'tenant-transfer', 'tenant-package.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

function manifest(overrides: Partial<PackageManifest['tenant']> = {}): PackageManifest {
  return {
    format: PACKAGE_FORMAT,
    createdAt: '2026-09-22T00:00:00.000Z',
    source: 'spec',
    tenant: {
      id: 'tenant-uuid-1234567890',
      slug: 'shop',
      businessName: 'Shop',
      ownerName: '',
      ownerPhone: '',
      ownerEmail: '',
      activityType: null,
      ...overrides,
    },
    origin: null,
    migration: { latest: '2040000000138_tenant_offline_id_blocks', count: 231 },
    offlineIdBlock: offlineBlockRange(0),
    tables: { customers: { rows: 1, columns: ['id', 'name', 'tenant_id'] } },
  };
}

function packageBuffer(m: PackageManifest, lines: string[]): Buffer {
  return zlib.gzipSync(Buffer.from([`${PACKAGE_FORMAT}\t${JSON.stringify(m)}`, ...lines].join('\n'), 'utf8'));
}

// TRANSFER-1: rows travel as Postgres JSON text and are never parsed by JavaScript, so a numeric
// or bigint beyond float precision and microsecond timestamps survive untouched.
function testRowsAreNotParsedByJavascript(): void {
  const json =
    '[{"id": 12345678901234567890, "name": "a\\nb", "tenant_id": "x", "at": "2026-09-22T10:00:00.123456+00:00"}]';
  const { manifest: m, chunks } = readPackage(packageBuffer(manifest(), [`customers\t${json}`]));
  assert.equal(m.tenant.slug, 'shop');
  assert.equal(chunks[0].json, json, 'the rows text must reach Postgres byte for byte');
  assert.throws(() => readPackage(packageBuffer(manifest(), [])), /missing the rows of customers/);
  assert.throws(() => readPackage(Buffer.from('not gzip')), /gzip expected/);
  assert.ok(engine.includes('jsonb_populate_recordset(null::${sql.table(spec.name)}, ${chunk.json}::jsonb)'));
  assert.ok(
    engine.includes("coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text"),
    'export uses jsonb text: no raw newlines, exact values',
  );
}

// TRANSFER-2: ids are never renumbered. Offline rows get a per-tenant block above the reserved
// base, inside int4, and the cloud never raises a sequence into that range.
function testOfflineIdBlocks(): void {
  assert.equal(RESERVED_OFFLINE_ID_BASE, 1_000_000_000);
  const last = offlineBlockRange(MAX_OFFLINE_ID_BLOCKS - 1);
  assert.ok(last.end <= 2_147_483_647, 'every block must fit in integer id columns');
  assert.equal(offlineBlockRange(3).start, RESERVED_OFFLINE_ID_BASE + 3 * OFFLINE_ID_BLOCK_SIZE);
  assert.ok(engine.includes('where id < ${RESERVED_OFFLINE_ID_BASE}'), 'cloud sequences stay below the reserved range');
  assert.ok(
    engine.includes('where id between ${block.start} and ${block.end}'),
    'desktop sequences continue inside the tenant block',
  );
  assert.ok(!/remapForeignKeys|idMap/.test(engine), 'tenant transfer never remaps ids');
}

// TRANSFER-3: platform/billing tables are never exported or overwritten, and a cloud import only
// replaces the tenant the package came from.
function testPlatformTablesAndTenantMatch(): void {
  for (const t of [
    'tenant_subscriptions',
    'tenant_subscription_payments',
    'trial_signups',
    'sessions',
    'tenant_offline_id_blocks',
  ]) {
    assert.ok(PLATFORM_TENANT_TABLES.has(t), `${t} must never travel in a tenant package`);
  }
  assert.ok(/TENANT_MISMATCH/.test(engine) && /manifest\.origin\?\.tenantId === target\.tenantId/.test(engine));
  assert.ok(/PACKAGE_NEWER_THAN_APP/.test(engine), 'a package from a newer schema is refused');
}

// TRANSFER-4: FK checks are off during import, so the shared gate (missing parents AND parents of
// another tenant) runs before commit and cancels everything on any problem.
function testGateBeforeCommit(): void {
  const importFn = engine.slice(engine.indexOf('export async function importTenantPackage('));
  const replicaAt = importFn.indexOf("set local session_replication_role = 'replica'");
  const gateAt = importFn.indexOf('await findOrphanedReferences(');
  const returnAt = importFn.indexOf('return {', gateAt);
  assert.ok(replicaAt > -1 && gateAt > replicaAt && returnAt > gateAt, 'gate must run after replica and before commit');
  assert.ok(/ORPHANED_REFERENCES/.test(importFn));
}

// TRANSFER-5: the bundle is one zip (full dump + a package per tenant), entries checksummed, and
// encryption is openssl-compatible so it can be opened without this code.
function testBundle(): void {
  const pkg = packageBuffer(manifest(), [`customers\t[{"id":1,"name":"a","tenant_id":"x"}]`]);
  const full = zlib.gzipSync(Buffer.from('-- PostgreSQL database dump complete\n'));
  const { zip, manifest: bm } = buildBundle({
    fullDump: full,
    packages: [{ manifest: manifest(), buffer: pkg }],
    migration: manifest().migration,
  });
  assert.equal(bm.tenants[0].entry, tenantEntryName(manifest()));
  assert.equal(
    tenantEntryName(manifest({ slug: '../../etc', id: 'a/b' })),
    'tenants/-etc__ab.zsbak',
    'entry names are sanitized',
  );

  const enc = encryptBundle(zip, 'pass-123');
  assert.ok(isEncrypted(enc));
  assert.throws(() => decryptBundle(enc, 'wrong'), /Wrong backup passphrase/);
  const plain = decryptBundle(enc, 'pass-123');
  assert.ok(readBundle(plain).entry(bm.full!.entry).equals(full));

  const picked = resolveTenantPackage(enc, { passphrase: 'pass-123', pick: 'shop' });
  assert.ok(picked.packageBuffer.equals(pkg));
  assert.ok(resolveTenantPackage(pkg, {}).packageBuffer.equals(pkg), 'a bare package is accepted as is');
  assert.throws(() => resolveTenantPackage(enc, {}), /passphrase is required/);

  // openssl enc -d must open what we write (when openssl is available on this machine)
  try {
    const dir = mkdtempSync(join(tmpdir(), 'zsb-'));
    writeFileSync(join(dir, 'b.enc'), enc);
    writeFileSync(join(dir, 'p'), 'pass-123');
    execFileSync(
      'openssl',
      [
        'enc',
        '-d',
        '-aes-256-cbc',
        '-pbkdf2',
        '-iter',
        '200000',
        '-md',
        'sha256',
        '-in',
        join(dir, 'b.enc'),
        '-out',
        join(dir, 'b.zip'),
        '-pass',
        `file:${join(dir, 'p')}`,
      ],
      { stdio: 'ignore' },
    );
    assert.ok(readFileSync(join(dir, 'b.zip')).equals(zip), 'openssl decrypts the bundle byte for byte');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function run(): void {
  testRowsAreNotParsedByJavascript();
  testOfflineIdBlocks();
  testPlatformTablesAndTenantMatch();
  testGateBeforeCommit();
  testBundle();
  console.log('tenant-transfer.spec: all tenant transfer invariants hold (TRANSFER-1..TRANSFER-5)');
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
