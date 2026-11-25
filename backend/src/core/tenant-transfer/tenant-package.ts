import * as zlib from 'zlib';
import { sql, type Kysely } from 'kysely';
import { isPlatformTenantId } from '../auth/utils/tenant-boundary';
import { isProtectedTenantDataTarget } from './protected-tenant-target';

// Tenant package (.zsbak): every row of one tenant, moved between the cloud and a desktop install
// (both directions) with every row keeping its ORIGINAL id. Because nothing is renumbered, foreign
// keys, polymorphic reference_id/source_id columns and ids stored inside JSON all stay valid with no
// remapping — the same principle as RESTORE-2 (ARCHITECTURE_INVARIANTS.md §2.8). Rows travel as
// Postgres-generated JSON and are written back by jsonb_populate_recordset, so values never pass
// through JavaScript types (no lost microseconds, no float rounding of numerics or bigints).
//
// Format: gzip of text lines. Line 1: `ZSBAK1<TAB><manifest json>`. Then `<table><TAB><jsonb array>`
// per chunk of rows. jsonb text never contains a raw newline, so lines are safe to split.

export const PACKAGE_FORMAT = 'ZSBAK1';
export const RESERVED_OFFLINE_ID_BASE = 1_000_000_000;
export const OFFLINE_ID_BLOCK_SIZE = 1_000_000;
const INT4_MAX = 2_147_483_647;
export const MAX_OFFLINE_ID_BLOCKS = Math.floor((INT4_MAX - RESERVED_OFFLINE_ID_BASE + 1) / OFFLINE_ID_BLOCK_SIZE);
const EXPORT_CHUNK_ROWS = 2000;
const ORIGIN_SETTING_KEY = 'tenant_package_origin';

// Tables that carry tenant_id but belong to the platform or are session state: never exported,
// never overwritten by an import. Billing rows in particular must not be restorable by a tenant.
export const PLATFORM_TENANT_TABLES = new Set([
  'tenant_subscriptions',
  'tenant_subscription_payments',
  'trial_signups',
  'sessions',
  'backup_snapshots',
  'tenant_offline_id_blocks',
]);

export class TenantPackageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TenantPackageError';
  }
}

export interface ColumnSpec {
  name: string;
  identityAlways: boolean;
}
export interface TableSpec {
  name: string;
  kind: 'tenant' | 'child';
  // child tables have no tenant_id and belong to the tenant through one FK to a tenant table
  parent?: string;
  fkColumn?: string;
  parentColumn?: string;
  columns: ColumnSpec[];
  hasId: boolean;
  idSequence: string | null;
  accountIdIsForeignKey: boolean;
}

export interface OfflineIdBlock {
  index: number;
  start: number;
  end: number;
}

export interface PackageManifest {
  format: string;
  createdAt: string;
  source: string;
  tenant: {
    id: string;
    slug: string;
    businessName: string;
    ownerName: string;
    ownerPhone: string;
    ownerEmail: string;
    activityType: string | null;
  };
  // Set on packages exported from a desktop that was itself loaded from a cloud tenant.
  origin: { tenantId: string; slug: string } | null;
  migration: { latest: string; count: number };
  offlineIdBlock: OfflineIdBlock | null;
  tables: Record<string, { rows: number; columns: string[] }>;
}

export interface ImportTarget {
  tenantId: string;
  accountId: string;
  mode: 'desktop' | 'cloud';
  // cloud imports refuse a package whose tenant (or origin tenant) is a different tenant
  allowTenantMismatch?: boolean;
}

export interface ImportReport {
  tenantId: string;
  sourceTenant: PackageManifest['tenant'];
  tables: number;
  rows: number;
  warnings: string[];
}

interface ForeignKeyRow {
  table_name: string;
  foreign_table: string;
  cols: string[];
  fcols: string[];
}

export function offlineBlockRange(index: number): OfflineIdBlock {
  const start = RESERVED_OFFLINE_ID_BASE + index * OFFLINE_ID_BLOCK_SIZE;
  return { index, start, end: start + OFFLINE_ID_BLOCK_SIZE - 1 };
}

async function loadForeignKeys(db: Kysely<any>): Promise<ForeignKeyRow[]> {
  const result = await sql<ForeignKeyRow>`
    select c.conrelid::regclass::text as table_name,
           c.confrelid::regclass::text as foreign_table,
           array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as cols,
           array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord) as fcols
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
    order by 1, 2
  `.execute(db);
  return result.rows;
}

export async function listTenantTables(db: Kysely<any>): Promise<Map<string, TableSpec>> {
  const columns = await sql<{ table_name: string; column_name: string; identity_always: boolean }>`
    select c.relname::text as table_name, a.attname::text as column_name, (a.attidentity = 'a') as identity_always
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname, a.attnum
  `.execute(db);

  const byTable = new Map<string, ColumnSpec[]>();
  for (const row of columns.rows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push({ name: row.column_name, identityAlways: row.identity_always });
    byTable.set(row.table_name, list);
  }

  const fks = await loadForeignKeys(db);
  const specs = new Map<string, TableSpec>();

  const base = (name: string, cols: ColumnSpec[]) => ({
    name,
    columns: cols,
    hasId: cols.some((c) => c.name === 'id'),
    idSequence: null as string | null,
    accountIdIsForeignKey: fks.some(
      (fk) => fk.table_name === name && fk.cols.length === 1 && fk.cols[0] === 'account_id',
    ),
  });

  for (const [name, cols] of byTable) {
    if (name === 'tenants' || PLATFORM_TENANT_TABLES.has(name)) continue;
    if (cols.some((c) => c.name === 'tenant_id')) specs.set(name, { ...base(name, cols), kind: 'tenant' });
  }
  for (const [name, cols] of byTable) {
    if (specs.has(name) || name === 'tenants' || cols.some((c) => c.name === 'tenant_id')) continue;
    const link = fks.find(
      (fk) => fk.table_name === name && fk.cols.length === 1 && specs.get(fk.foreign_table)?.kind === 'tenant',
    );
    if (!link) continue;
    specs.set(name, {
      ...base(name, cols),
      kind: 'child',
      parent: link.foreign_table,
      fkColumn: link.cols[0],
      parentColumn: link.fcols[0],
    });
  }

  for (const spec of specs.values()) {
    if (!spec.hasId) continue;
    const seq = await sql<{ seq: string | null }>`select pg_get_serial_sequence(${spec.name}, 'id') as seq`.execute(db);
    spec.idSequence = seq.rows[0]?.seq ?? null;
  }
  return specs;
}

function ownedRows(spec: TableSpec, tenantId: string) {
  if (spec.kind === 'tenant') return sql`${sql.table(spec.name)}.tenant_id = ${tenantId}`;
  return sql`${sql.table(spec.name)}.${sql.ref(spec.fkColumn!)} in (
    select parent.${sql.ref(spec.parentColumn!)} from ${sql.table(spec.parent!)} as parent where parent.tenant_id = ${tenantId}
  )`;
}

async function latestMigration(db: Kysely<any>): Promise<{ latest: string; count: number }> {
  const result = await sql<{ latest: string | null; count: number }>`
    select max(name) as latest, count(*)::int as count from kysely_migration
  `.execute(db);
  return { latest: result.rows[0]?.latest ?? '', count: result.rows[0]?.count ?? 0 };
}

async function tableExists(db: Kysely<any>, name: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`select to_regclass(${'public.' + name}) is not null as ok`.execute(db);
  return Boolean(result.rows[0]?.ok);
}

// Allocated once per tenant and never reused. Only the cloud allocates; a desktop re-exporting a
// tenant it received carries the block from its origin record instead.
export async function allocateOfflineIdBlock(db: Kysely<any>, tenantId: string): Promise<OfflineIdBlock | null> {
  if (!(await tableExists(db, 'tenant_offline_id_blocks'))) return null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await sql`
        insert into tenant_offline_id_blocks (tenant_id, block_index)
        select ${tenantId}, coalesce(max(block_index) + 1, 0) from tenant_offline_id_blocks
        on conflict (tenant_id) do nothing
      `.execute(db);
      break;
    } catch (error: any) {
      if (error?.code !== '23505' || attempt === 4) throw error;
    }
  }
  const row = await sql<{ block_index: number }>`
    select block_index from tenant_offline_id_blocks where tenant_id = ${tenantId}
  `.execute(db);
  const index = row.rows[0]?.block_index;
  if (index == null) return null;
  if (index >= MAX_OFFLINE_ID_BLOCKS) {
    throw new TenantPackageError(
      'OFFLINE_BLOCKS_EXHAUSTED',
      `No offline id block left for tenant ${tenantId} (index ${index})`,
    );
  }
  return offlineBlockRange(index);
}

async function readOrigin(
  db: Kysely<any>,
  tenantId: string,
): Promise<{ tenantId: string; slug: string; offlineIdBlock: OfflineIdBlock | null } | null> {
  const result = await sql<{ value: string }>`
    select value from settings where tenant_id = ${tenantId} and key = ${ORIGIN_SETTING_KEY}
  `
    .execute(db)
    .catch(() => ({ rows: [] as { value: string }[] }));
  if (!result.rows[0]) return null;
  try {
    const parsed = JSON.parse(result.rows[0].value);
    return parsed && typeof parsed.tenantId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function exportTenantPackage(
  db: Kysely<any>,
  tenantId: string,
  options: { source: string; allocateOfflineBlock: boolean },
): Promise<{ buffer: Buffer; manifest: PackageManifest }> {
  const offlineIdBlockFromCloud = options.allocateOfflineBlock ? await allocateOfflineIdBlock(db, tenantId) : null;

  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      const specs = await listTenantTables(trx);
      const tenantRow = await sql<any>`
      select id, slug, business_name, owner_name, owner_phone, owner_email, activity_type from tenants where id = ${tenantId}
    `.execute(trx);
      const t = tenantRow.rows[0] ?? {};
      const origin = await readOrigin(trx, tenantId);

      const manifest: PackageManifest = {
        format: PACKAGE_FORMAT,
        createdAt: new Date().toISOString(),
        source: options.source,
        tenant: {
          id: tenantId,
          slug: String(t.slug ?? tenantId),
          businessName: String(t.business_name ?? ''),
          ownerName: String(t.owner_name ?? ''),
          ownerPhone: String(t.owner_phone ?? ''),
          ownerEmail: String(t.owner_email ?? ''),
          activityType: t.activity_type ?? null,
        },
        origin: origin ? { tenantId: origin.tenantId, slug: origin.slug } : null,
        migration: await latestMigration(trx),
        offlineIdBlock: offlineIdBlockFromCloud ?? origin?.offlineIdBlock ?? null,
        tables: {},
      };

      const lines: string[] = [];
      for (const spec of [...specs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const order = spec.hasId
          ? sql`order by ${sql.table(spec.name)}.id`
          : sql`order by ${sql.table(spec.name)}.ctid`;
        let offset = 0;
        let total = 0;
        for (;;) {
          const chunk = await sql<{ j: string; n: number }>`
          select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text as j, count(*)::int as n
          from (
            select ${sql.table(spec.name)}.* from ${sql.table(spec.name)}
            where ${ownedRows(spec, tenantId)}
            ${order}
            limit ${EXPORT_CHUNK_ROWS} offset ${offset}
          ) x
        `.execute(trx);
          const { j, n } = chunk.rows[0];
          if (n > 0) lines.push(`${spec.name}\t${j}`);
          total += n;
          offset += n;
          if (n < EXPORT_CHUNK_ROWS) break;
        }
        manifest.tables[spec.name] = { rows: total, columns: spec.columns.map((c) => c.name) };
      }

      const body = [`${PACKAGE_FORMAT}\t${JSON.stringify(manifest)}`, ...lines].join('\n');
      return { buffer: zlib.gzipSync(Buffer.from(body, 'utf8')), manifest };
    });
}

export function readPackage(buffer: Buffer): { manifest: PackageManifest; chunks: { table: string; json: string }[] } {
  let text: string;
  try {
    text = zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    throw new TenantPackageError('PACKAGE_INVALID', 'Not a tenant package (gzip expected)');
  }
  const lines = text.split('\n');
  const [format, manifestJson] = splitOnce(lines[0] ?? '');
  if (format !== PACKAGE_FORMAT || !manifestJson) {
    throw new TenantPackageError('PACKAGE_INVALID', 'Not a tenant package (bad header)');
  }
  const manifest = JSON.parse(manifestJson) as PackageManifest;
  if (
    !manifest ||
    manifest.format !== PACKAGE_FORMAT ||
    !manifest.tables ||
    typeof manifest.tables !== 'object' ||
    Array.isArray(manifest.tables)
  ) {
    throw new TenantPackageError('PACKAGE_INVALID', 'Package manifest has no valid table inventory');
  }
  for (const [table, info] of Object.entries(manifest.tables)) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(table) ||
      !info ||
      !Number.isSafeInteger(info.rows) ||
      info.rows < 0 ||
      !Array.isArray(info.columns)
    ) {
      throw new TenantPackageError('PACKAGE_INVALID', 'Invalid table inventory: ' + table);
    }
  }
  const chunks = lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [table, json] = splitOnce(line);
      if (!table || !json) throw new TenantPackageError('PACKAGE_INVALID', 'Corrupt tenant package line');
      return { table, json };
    });
  for (const chunk of chunks) {
    if (!Object.prototype.hasOwnProperty.call(manifest.tables, chunk.table)) {
      throw new TenantPackageError('PACKAGE_INVALID', 'Undeclared package table: ' + chunk.table);
    }
  }
  for (const [table, info] of Object.entries(manifest.tables)) {
    const found = chunks.filter((c) => c.table === table).length;
    if (info.rows > 0 && found === 0)
      throw new TenantPackageError('PACKAGE_INVALID', `Package is missing the rows of ${table}`);
  }
  return { manifest, chunks };
}

function splitOnce(line: string): [string, string] {
  const at = line.indexOf('\t');
  return at < 0 ? [line, ''] : [line.slice(0, at), line.slice(at + 1)];
}

export async function findOrphanedReferences(
  db: Kysely<any>,
  specs: Map<string, TableSpec>,
  tenantId: string,
  extraChildTables: string[] = [],
): Promise<string[]> {
  const fks = await loadForeignKeys(db);
  const problems: string[] = [];
  for (const fk of fks) {
    const spec = specs.get(fk.table_name);
    const extra = !spec && extraChildTables.includes(fk.table_name);
    if (!spec && !extra) continue;
    const scope = spec ? ownedRows(spec, tenantId) : sql`${sql.table(fk.table_name)}.tenant_id = ${tenantId}`;
    const notNull = sql.join(
      fk.cols.map((col) => sql`${sql.table(fk.table_name)}.${sql.ref(col)} is not null`),
      sql` and `,
    );
    const matches = sql.join(
      fk.cols.map((col, i) => sql`parent.${sql.ref(fk.fcols[i])} = ${sql.table(fk.table_name)}.${sql.ref(col)}`),
      sql` and `,
    );
    // A row may also point at an existing row of ANOTHER tenant (found in production: 3 journal
    // lines on another tenant's account). The FK is satisfied, so only this check catches it — and
    // it also stops a crafted package from linking a tenant's rows to someone else's data.
    const parentIsTenantScoped = specs.get(fk.foreign_table)?.kind === 'tenant';
    const foreign = parentIsTenantScoped
      ? sql`count(*) filter (where exists (select 1 from ${sql.table(fk.foreign_table)} as parent where ${matches} and parent.tenant_id <> ${tenantId}))::int`
      : sql`0`;
    const result = await sql<{ orphans: number; foreign_tenant: number }>`
      select count(*) filter (where not exists (select 1 from ${sql.table(fk.foreign_table)} as parent where ${matches}))::int as orphans,
             ${foreign} as foreign_tenant
      from ${sql.table(fk.table_name)}
      where ${scope} and ${notNull}
    `.execute(db);
    const orphans = result.rows[0]?.orphans ?? 0;
    const foreignTenant = result.rows[0]?.foreign_tenant ?? 0;
    if (orphans > 0) problems.push(`${fk.table_name}.${fk.cols.join('+')} -> ${fk.foreign_table}: ${orphans} missing`);
    if (foreignTenant > 0)
      problems.push(`${fk.table_name}.${fk.cols.join('+')} -> ${fk.foreign_table}: ${foreignTenant} of another tenant`);
  }
  return problems;
}

export async function importTenantPackage(
  db: Kysely<any>,
  buffer: Buffer,
  target: ImportTarget,
): Promise<ImportReport> {
  const { manifest, chunks } = readPackage(buffer);
  const warnings: string[] = [];

  if (isProtectedTenantDataTarget(target.tenantId)) {
    throw new TenantPackageError('TENANT_MISMATCH', 'Cannot import tenant package into platform root tenant');
  }

  return db.transaction().execute(async (trx) => {
    // 1. The package must not come from a newer schema than this install.
    const known = await sql<{ ok: boolean }>`
      select exists (select 1 from kysely_migration where name = ${manifest.migration.latest}) as ok
    `.execute(trx);
    if (manifest.migration.latest && !known.rows[0]?.ok) {
      throw new TenantPackageError(
        'PACKAGE_NEWER_THAN_APP',
        `The package was made by a newer version (${manifest.migration.latest}). Update this installation first.`,
      );
    }
    const here = await latestMigration(trx);
    if (here.latest !== manifest.migration.latest) {
      warnings.push(
        `Package schema ${manifest.migration.latest} is older than ${here.latest}; new columns get their defaults.`,
      );
    }

    // 2. Cloud imports only replace the tenant the package belongs to.
    if (target.mode === 'cloud') {
      const exists = await sql<{
        ok: boolean;
      }>`select exists (select 1 from tenants where id = ${target.tenantId}) as ok`.execute(trx);
      if (!exists.rows[0]?.ok)
        throw new TenantPackageError('TARGET_TENANT_MISSING', `Tenant ${target.tenantId} does not exist`);
      const belongs = manifest.tenant.id === target.tenantId || manifest.origin?.tenantId === target.tenantId;
      if (!belongs && !target.allowTenantMismatch) {
        throw new TenantPackageError(
          'TENANT_MISMATCH',
          `Package belongs to ${manifest.origin?.tenantId ?? manifest.tenant.id}, not ${target.tenantId}`,
        );
      }
    }

    await sql`set local session_replication_role = 'replica'`.execute(trx);
    await sql`set local statement_timeout = 0`.execute(trx);

    const specs = await listTenantTables(trx);

    // Older packages cannot erase live tables absent from their manifest.
    // The ownedRows predicate includes FK-scoped child tables without tenant_id.
    for (const spec of specs.values()) {
      if (Object.prototype.hasOwnProperty.call(manifest.tables, spec.name)) continue;
      const live = await sql<{ exists: boolean }>`
        select exists(select 1 from ${sql.table(spec.name)} where ${ownedRows(spec, target.tenantId)}) as exists
      `.execute(trx);
      if (live.rows[0]?.exists) {
        throw new TenantPackageError('PACKAGE_INCOMPLETE', 'Package omits live tenant table ' + spec.name);
      }
    }

    // 3. Clear the target tenant: children first (they are found through their parent rows).
    const ordered = [...specs.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'child' ? -1 : 1));
    for (const spec of ordered) {
      await sql`delete from ${sql.table(spec.name)} where ${ownedRows(spec, target.tenantId)}`.execute(trx);
    }
    // everyone must log in again against the imported users
    // Revocation is part of the same transaction as data replacement: a silent
    // failure here would leave old live sessions authorized after import.
    await sql`delete from sessions where tenant_id = ${target.tenantId}`.execute(trx);

    // 4. Insert with the original ids.
    let rows = 0;
    const insertedRowsByTable = new Map<string, number>();
    for (const chunk of chunks) {
      const spec = specs.get(chunk.table);
      if (!spec) {
        if ((manifest.tables[chunk.table]?.rows ?? 0) > 0) {
          throw new TenantPackageError('TABLE_MISSING', `This installation has no table ${chunk.table}`);
        }
        continue;
      }
      const packageColumns = new Set(manifest.tables[chunk.table]?.columns ?? []);
      const cols = spec.columns.filter((c) => packageColumns.has(c.name));
      const exprs = cols.map((c) => {
        if (c.name === 'tenant_id' && spec.kind === 'tenant') return sql`${target.tenantId}`;
        if (c.name === 'account_id' && spec.kind === 'tenant' && !spec.accountIdIsForeignKey)
          return sql`${target.accountId}`;
        return sql`p.${sql.ref(c.name)}`;
      });
      const overriding = cols.some((c) => c.identityAlways) ? sql`overriding system value` : sql``;
      try {
        const inserted = await sql`
          insert into ${sql.table(spec.name)} (${sql.join(cols.map((c) => sql.ref(c.name)))}) ${overriding}
          select ${sql.join(exprs)} from jsonb_populate_recordset(null::${sql.table(spec.name)}, ${chunk.json}::jsonb) as p
        `.execute(trx);
        const insertedRows = Number(inserted.numAffectedRows ?? 0);
        rows += insertedRows;
        insertedRowsByTable.set(chunk.table, (insertedRowsByTable.get(chunk.table) ?? 0) + insertedRows);
      } catch (error: any) {
        if (error?.code === '23505') {
          throw new TenantPackageError(
            'ID_CONFLICT',
            `${spec.name}: rows in the package use ids already taken here by other data (${error.detail ?? error.message})`,
          );
        }
        throw error;
      }
    }

    // A truncated multi-chunk file may contain at least one valid chunk but
    // fewer rows than promised. Verify inside the transaction before commit.
    for (const [table, info] of Object.entries(manifest.tables)) {
      if (!specs.has(table)) continue; // unknown nonempty tables are rejected above
      if ((insertedRowsByTable.get(table) ?? 0) !== info.rows) {
        throw new TenantPackageError('PACKAGE_INCOMPLETE', 'Imported row count differs from manifest for ' + table);
      }
    }

    // 5. Sequences. Desktop: continue inside this tenant's offline block, so rows created offline
    // can be imported back to the cloud. Cloud: never lower a sequence, never raise it into the
    // reserved offline range.
    const block = manifest.offlineIdBlock;
    for (const spec of specs.values()) {
      if (!spec.idSequence) continue;
      if (target.mode === 'desktop' && block) {
        await sql`
          select setval(${spec.idSequence}::regclass, greatest(
            coalesce((select max(id) from ${sql.table(spec.name)} where id between ${block.start} and ${block.end}), ${block.start - 1}),
            ${block.start - 1}
          ) + 1, false)
        `.execute(trx);
      } else if (target.mode === 'desktop') {
        await sql`
          select setval(${spec.idSequence}::regclass, coalesce((select max(id) from ${sql.table(spec.name)}), 0) + 1, false)
        `.execute(trx);
      } else {
        await sql`
          select setval(${spec.idSequence}::regclass, greatest(
            coalesce((select max(id) from ${sql.table(spec.name)} where id < ${RESERVED_OFFLINE_ID_BASE}), 0),
            coalesce(pg_sequence_last_value(${spec.idSequence}::regclass), 0),
            1
          ), true)
        `.execute(trx);
      }
    }
    if (target.mode === 'desktop' && !block) {
      warnings.push('Package has no offline id block: rows created here cannot be imported back to the cloud.');
    }

    // 6. Desktop: the tenant row and where the data came from.
    if (target.mode === 'desktop') {
      await sql`
        insert into tenants (id, slug, business_name, owner_name, owner_phone, owner_email, activity_type, status,
                             trial_starts_at, trial_ends_at, activated_at, created_at, updated_at)
        values (${target.tenantId}, ${target.tenantId}, ${manifest.tenant.businessName}, ${manifest.tenant.ownerName},
                ${manifest.tenant.ownerPhone}, ${manifest.tenant.ownerEmail}, ${manifest.tenant.activityType}, 'active',
                now(), now() + interval '10 years', now(), now(), now())
        on conflict (id) do update set
          business_name = excluded.business_name, owner_name = excluded.owner_name, owner_phone = excluded.owner_phone,
          owner_email = excluded.owner_email, activity_type = excluded.activity_type, updated_at = now()
      `.execute(trx);
      const origin = manifest.origin ?? { tenantId: manifest.tenant.id, slug: manifest.tenant.slug };
      await sql`
        insert into settings (key, value, tenant_id, account_id)
        values (${ORIGIN_SETTING_KEY}, ${JSON.stringify({ ...origin, offlineIdBlock: block, importedAt: new Date().toISOString() })},
                ${target.tenantId}, ${target.accountId})
        on conflict (tenant_id, key) do update set value = excluded.value
      `.execute(trx);
    }

    // 7. FK checks were off: verify every reference before commit (RESTORE-3).
    const problems = await findOrphanedReferences(
      trx,
      specs,
      target.tenantId,
      [...PLATFORM_TENANT_TABLES].filter((t) => t !== 'sessions'),
    );
    if (problems.length) {
      throw new TenantPackageError('ORPHANED_REFERENCES', `Import cancelled, nothing changed: ${problems.join(' | ')}`);
    }

    return {
      tenantId: target.tenantId,
      sourceTenant: manifest.tenant,
      tables: Object.values(manifest.tables).filter((t) => t.rows > 0).length,
      rows,
      warnings,
    };
  });
}
