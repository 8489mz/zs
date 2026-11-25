import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import { sql } from 'kysely';
import { createDb } from '../database/migration-runner';
import {
  buildBundle,
  decryptBundle,
  encryptBundle,
  isEncrypted,
  readBundle,
  resolveTenantPackage,
} from '../core/tenant-transfer/backup-bundle';
import {
  exportTenantPackage,
  importTenantPackage,
  readPackage,
  TenantPackageError,
} from '../core/tenant-transfer/tenant-package';

// Server-side tool for the nightly backup bundle and for moving tenants (docs/DISASTER_RECOVERY.md).
// Runs from backend/: node --env-file=.env dist/tools/zs-backup-tool.js <command> [--flags]
//
//   bundle         --full <dump.sql.gz> --out <file> [--passphrase-file <f>]
//   list           --in <file> [--passphrase-file <f>]
//   extract        --in <file> --entry <name> --out <path|-> [--passphrase-file <f>]
//   export-tenant  --tenant <id> --out <file.zsbak>
//   import-tenant  --in <file> --tenant <target id> --account <account id> --mode cloud|desktop
//                  [--pick <slug|id>] [--passphrase-file <f>] [--allow-tenant-mismatch]

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      i += 1;
    }
  }
  return flags;
}

function need(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function passphrase(flags: Flags): string | undefined {
  const file = flags['passphrase-file'];
  if (typeof file !== 'string') return undefined;
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`Passphrase file ${file} is empty`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`[zs-backup-tool] ${message}\n`);
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (command === 'list') {
    const raw = fs.readFileSync(need(flags, 'in'));
    const plain = isEncrypted(raw) ? decryptBundle(raw, passphrase(flags) ?? '') : raw;
    process.stdout.write(`${JSON.stringify(readBundle(plain).manifest, null, 2)}\n`);
    return;
  }

  if (command === 'extract') {
    const raw = fs.readFileSync(need(flags, 'in'));
    const plain = isEncrypted(raw) ? decryptBundle(raw, passphrase(flags) ?? '') : raw;
    const data = readBundle(plain).entry(need(flags, 'entry'));
    const out = need(flags, 'out');
    if (out === '-') process.stdout.write(data);
    else fs.writeFileSync(out, data);
    return;
  }

  const db = createDb();
  try {
    if (command === 'bundle') {
      const full = fs.readFileSync(need(flags, 'full'));
      const tenants = await sql<{ id: string }>`select id from tenants order by created_at, id`.execute(db);
      const packages = [];
      const failedTenants = [];
      for (const { id } of tenants.rows) {
        try {
          packages.push(
            await exportTenantPackage(db, id, { source: `cloud:${os.hostname()}`, allocateOfflineBlock: true }),
          );
        } catch (error: any) {
          // one broken tenant must not cost the whole night's backup; the full dump still has it
          failedTenants.push({ tenantId: id, error: String(error?.message ?? error) });
          log(`tenant ${id} not packaged: ${error?.message ?? error}`);
        }
      }
      const migration = await sql<{ latest: string; count: number }>`
        select max(name) as latest, count(*)::int as count from kysely_migration
      `.execute(db);
      const { zip, manifest } = buildBundle({ fullDump: full, packages, failedTenants, migration: migration.rows[0] });
      const pass = passphrase(flags);
      fs.writeFileSync(need(flags, 'out'), pass ? encryptBundle(zip, pass) : zip);
      log(
        `bundle written: ${manifest.tenants.length} tenant packages, ${failedTenants.length} failed, encrypted=${Boolean(pass)}`,
      );
      if (failedTenants.length) process.exitCode = 2;
      return;
    }

    if (command === 'export-tenant') {
      const { buffer, manifest } = await exportTenantPackage(db, need(flags, 'tenant'), {
        source: `cloud:${os.hostname()}`,
        allocateOfflineBlock: flags['no-offline-block'] !== true,
      });
      fs.writeFileSync(need(flags, 'out'), buffer);
      log(`exported ${manifest.tenant.slug}: ${Object.values(manifest.tables).reduce((s, t) => s + t.rows, 0)} rows`);
      return;
    }

    if (command === 'import-tenant') {
      const mode = need(flags, 'mode');
      if (mode !== 'cloud' && mode !== 'desktop') throw new Error('--mode must be cloud or desktop');
      const { packageBuffer } = resolveTenantPackage(fs.readFileSync(need(flags, 'in')), {
        passphrase: passphrase(flags),
        pick: typeof flags.pick === 'string' ? flags.pick : undefined,
      });
      readPackage(packageBuffer);
      const report = await importTenantPackage(db, packageBuffer, {
        tenantId: need(flags, 'tenant'),
        accountId: need(flags, 'account'),
        mode,
        allowTenantMismatch: flags['allow-tenant-mismatch'] === true,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    throw new Error(
      `Unknown command "${command ?? ''}". Commands: bundle, list, extract, export-tenant, import-tenant`,
    );
  } finally {
    await db.destroy();
  }
}

run().catch((error: unknown) => {
  const e = error as any;
  const code = e instanceof TenantPackageError ? ` [${e.code}]` : '';
  process.stderr.write(`[zs-backup-tool] FAILED${code}: ${e?.message ?? e}\n`);
  if (Array.isArray(e?.bundleTenants)) {
    for (const t of e.bundleTenants) process.stderr.write(`  - ${t.slug} (${t.tenantId}) ${t.businessName}\n`);
  }
  process.exit(1);
});
