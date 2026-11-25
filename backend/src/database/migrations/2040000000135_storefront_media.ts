import { createHash } from 'crypto';
import { sql, type Kysely } from 'kysely';

// SF-9. Storefront images move out of JSON blobs into a binary table, and every stored reference
// becomes a short content-addressed URL (/api/storefront/media/<id>/<sha256>).
//
// Before: product / category / banner images were base64 data URLs inside products.metadata and
// settings values, and the public catalog returned every product with its image inline — a
// multi-megabyte response the storefront had to download completely before rendering anything.
//
// Storage is Postgres (bytea) rather than the container filesystem on purpose: the backend container
// has no persistent volume (docker-compose.saas.yml), so files written to disk would vanish on the next
// deploy, and the desktop build has no stable writable path either. The table is deduplicated per
// tenant by content hash, and the URL is immutable, so browsers cache each image once.

const MEDIA_PREFIX = '/api/storefront/media/';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif']);

function parse(dataUrl: unknown): { mime: string; bytes: Buffer; sha: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  if (!ALLOWED.has(mime)) return null;
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return { mime, bytes, sha: createHash('sha256').update(bytes).digest('hex') };
}

async function store(db: Kysely<unknown>, tenantId: string, dataUrl: unknown): Promise<string | null> {
  const img = parse(dataUrl);
  if (!img) return null;
  const res = await sql<{ id: number }>`
    INSERT INTO storefront_media (tenant_id, sha256, mime_type, byte_size, content)
    VALUES (${tenantId}, ${img.sha}, ${img.mime}, ${img.bytes.length}, ${img.bytes})
    ON CONFLICT (tenant_id, sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
    RETURNING id
  `.execute(db);
  const id = res.rows[0]?.id;
  return id ? `${MEDIA_PREFIX}${id}/${img.sha}` : null;
}

/** Converts a data URL (or keeps anything else). Unconvertible data URLs are dropped, not kept. */
async function convert(db: Kysely<unknown>, tenantId: string, value: unknown): Promise<unknown> {
  if (typeof value !== 'string' || !/^data:image\//i.test(value.trim())) return value;
  return (await store(db, tenantId, value)) ?? '';
}

function parseJson(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    const once = JSON.parse(raw);
    return typeof once === 'string' ? JSON.parse(once) : once;
  } catch {
    return null;
  }
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS storefront_media (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        mime_type VARCHAR(32) NOT NULL,
        byte_size INTEGER NOT NULL,
        content BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_storefront_media_tenant_sha UNIQUE (tenant_id, sha256)
      )
    `.execute(db);

    // --- Backfill: products.metadata.imageUrl / image / gallery[] ---
    const products = await sql<{ id: number; tenant_id: string; metadata: unknown }>`
      SELECT id, tenant_id, metadata FROM products
      WHERE metadata::text LIKE '%data:image/%'
    `.execute(db);

    for (const row of products.rows) {
      const meta = parseJson(row.metadata);
      if (!meta || typeof meta !== 'object') continue;
      meta.imageUrl = await convert(db, row.tenant_id, meta.imageUrl);
      if ('image' in meta) meta.image = await convert(db, row.tenant_id, meta.image);
      if (Array.isArray(meta.gallery)) {
        const gallery: unknown[] = [];
        for (const g of meta.gallery) gallery.push(await convert(db, row.tenant_id, g));
        meta.gallery = gallery.filter(Boolean);
      }
      await sql`UPDATE products SET metadata = ${JSON.stringify(meta)} WHERE id = ${row.id} AND tenant_id = ${row.tenant_id}`.execute(
        db,
      );
    }

    // --- Backfill: settings (category image map, banners) ---
    const settings = await sql<{ tenant_id: string; key: string; value: string }>`
      SELECT tenant_id, key, value FROM settings
      WHERE key IN ('storefront_category_images', 'storefront_banner_url', 'storefront_banner_urls')
        AND value LIKE '%data:image/%'
    `.execute(db);

    for (const row of settings.rows) {
      let next: string | null = null;
      if (row.key === 'storefront_category_images') {
        const map = parseJson(row.value);
        if (!map || typeof map !== 'object') continue;
        for (const k of Object.keys(map)) map[k] = await convert(db, row.tenant_id, map[k]);
        // Same double-encoded shape updateCategoryImage writes.
        next = JSON.stringify(JSON.stringify(map));
      } else if (row.key === 'storefront_banner_urls') {
        const list = parseJson(row.value);
        if (!Array.isArray(list)) continue;
        const out: unknown[] = [];
        for (const u of list) out.push(await convert(db, row.tenant_id, u));
        next = JSON.stringify(out.filter(Boolean));
      } else {
        const single = parseJson(row.value) ?? row.value;
        next = JSON.stringify(await convert(db, row.tenant_id, single));
      }
      await sql`UPDATE settings SET value = ${next} WHERE tenant_id = ${row.tenant_id} AND key = ${row.key}`.execute(
        db,
      );
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // References already rewritten to media URLs are not converted back (that would re-bloat the
    // catalog); dropping the table only makes sense on a database that never ran the backfill.
    await sql`DROP TABLE IF EXISTS storefront_media`.execute(db);
  },
};
