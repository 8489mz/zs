import { sql, type Kysely } from 'kysely';

/**
 * INV-TABLE-CALL-SLUG-TENANT: server-side storefront slug -> tenant
 * resolution shared by public write endpoints that must never trust a
 * caller-supplied tenant.
 *
 * The lookup steps mirror StorefrontService.getTenantBySlug (tenants.slug,
 * then custom_domain for dotted slugs, then the `storefront_slug`
 * setting, whose stored value may be JSON-quoted and mixed-case) so a
 * slug that serves a storefront resolves to the same tenant here.
 * Deliberately OMITTED: getTenantBySlug's demo fallbacks (tenant id
 * 'default', then the first tenant by creation date). A write endpoint
 * must never resolve an unknown slug to an arbitrary tenant; an
 * unresolved slug returns null and the caller fails closed. If the
 * lookup steps ever change, update both places together.
 */
export async function findTenantByStorefrontSlug(
  db: Kysely<any>,
  slug: string,
): Promise<{ id: string } | null> {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!cleanSlug || cleanSlug === 'admin') return null;

  const bySlug = await db
    .selectFrom('tenants')
    .select(['id'])
    .where('slug', '=', cleanSlug)
    .executeTakeFirst();
  if (bySlug) return { id: String((bySlug as any).id) };

  if (cleanSlug.includes('.')) {
    const byDomain = await db
      .selectFrom('tenants')
      .select(['id'])
      .where('custom_domain', '=', cleanSlug)
      .executeTakeFirst();
    if (byDomain) return { id: String((byDomain as any).id) };
  }

  const slugSetting = await db
    .selectFrom('settings')
    .select('tenant_id')
    .where('key', '=', 'storefront_slug')
    .where(sql<boolean>`LOWER(TRIM(BOTH '"' FROM value)) = ${cleanSlug}`)
    .executeTakeFirst();
  if (slugSetting) {
    const tenant = await db
      .selectFrom('tenants')
      .select(['id'])
      .where('id', '=', (slugSetting as any).tenant_id)
      .executeTakeFirst();
    if (tenant) return { id: String((tenant as any).id) };
  }

  return null;
}
