/*
New file: backend/test/critical/table-call-slug-tenant.spec.ts
Pins INV-TABLE-CALL-SLUG-TENANT: POST /api/sales/table-calls stays
public (a storefront guest rings the waiter bell), but the tenant is
resolved server-side from the storefront slug. Driving the REAL
TableServiceCallsController + TableServiceCallsService + the
TableCallRateLimitGuard on PGlite.

WHAT THE AUDIT FEARED: the handler had no guards and resolved scope as
`authContext?.tenantId || x-tenant-id header || ?tenantId || 'default'`,
so any unauthenticated caller could insert a phantom service call
under ANY tenant, including tenants that do not exist.

WHAT THIS PINS:
1. A slug matching tenants.slug stores the call under that tenant.
2. A dotted slug matching tenants.custom_domain stores the call under
   that tenant.
3. A slug matching the `storefront_slug` setting (JSON-quoted,
   mixed-case value) stores the call under that tenant.
4. An unknown slug, a missing slug, and the reserved slug 'admin'
   fail closed with 404 and insert nothing: no 'default' tenant.
5. A caller-supplied x-tenant-id header (and any legacy ?tenantId)
   is ignored: the call lands under the slug's tenant.
6. A staff session still wins: authContext tenant is used and no slug
   is needed.
7. The abuse bound triggers: 30 calls per 10 minutes per IP+slug are
   allowed, the 31st is refused with 429; a different slug has its own
   bucket.

Deliberately NOT driven here: the frontend call-site edit (the hook
passes cleanSlug instead of tenantId) is verified by inspection; no
vite build is run in this harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TableServiceCallsService } from '../../src/modules/sales/services/table-service-calls.service';
import { TableServiceCallsController } from '../../src/modules/sales/controllers/table-service-calls.controller';
import { TableCallRateLimitGuard } from '../../src/modules/sales/guards/table-call-rate-limit.guard';
import { InMemoryRateLimitService } from '../../src/common/security/in-memory-rate-limit.service';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text);
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE restaurant_table_service_calls (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, table_number text, call_type text, status text, created_at timestamptz DEFAULT NOW(), resolved_at timestamptz);
    `);
    await anyDb.insertInto('tenants').values([
      { id: 't-slug', slug: 'myshop', custom_domain: null, business_name: 'Slug Shop', status: 'active' },
      { id: 't-domain', slug: 'other', custom_domain: 'shop.example.com', business_name: 'Domain Shop', status: 'active' },
      { id: 't-setting', slug: 'third', custom_domain: null, business_name: 'Setting Shop', status: 'active' },
      { id: 'staff-tenant', slug: 'staff', custom_domain: null, business_name: 'Staff', status: 'active' },
    ]).execute();
    await anyDb.insertInto('settings').values({ tenant_id: 't-setting', key: 'storefront_slug', value: '"MySettingShop"' }).execute();

    const service = new TableServiceCallsService(db);
    const controller = new TableServiceCallsController(service);

    // Nest HttpExceptions carry the status on `.status` / `.getStatus()`,
    // not on `.statusCode` (which only appears in the response body).
    const httpStatus = (code: number) => (err: any) =>
      err && (err.status === code || err.statusCode === code || (typeof err.getStatus === 'function' && err.getStatus() === code));

    async function callCount(): Promise<number> {
      const rows = await anyDb.selectFrom('restaurant_table_service_calls').select('id').execute();
      return rows.length;
    }

    // 1. Slug match.
    const viaSlug: any = await controller.createCall({} as never, { tableNumber: 'T1', callType: 'waiter' }, 'myshop');
    assert.equal(viaSlug.tenant_id, 't-slug');

    // 2. Custom-domain match.
    const viaDomain: any = await controller.createCall({} as never, { tableNumber: 'T2', callType: 'bill' }, 'shop.example.com');
    assert.equal(viaDomain.tenant_id, 't-domain');

    // 3. Settings match (quoted, mixed-case stored value).
    const viaSetting: any = await controller.createCall({} as never, { tableNumber: 'T3', callType: 'waiter' }, 'mysettingshop');
    assert.equal(viaSetting.tenant_id, 't-setting');

    // 4. Unknown / missing / reserved slugs fail closed with nothing inserted.
    const before = await callCount();
    await assert.rejects(controller.createCall({} as never, { tableNumber: 'T4', callType: 'waiter' }, 'no-such-shop'), httpStatus(404));
    await assert.rejects(controller.createCall({} as never, { tableNumber: 'T4', callType: 'waiter' }, undefined), httpStatus(404));
    await assert.rejects(controller.createCall({} as never, { tableNumber: 'T4', callType: 'waiter' }, 'admin'), httpStatus(404));
    await assert.rejects(controller.createCall({} as never, { tableNumber: 'T4', callType: 'waiter' }, 'default'), httpStatus(404));
    assert.equal(await callCount(), before);

    // 5. Caller-supplied tenant signals are ignored: a hostile header
    // naming another tenant cannot steer the insert.
    const hostileReq: any = {
      headers: { 'x-tenant-id': 't-domain' },
      authContext: undefined,
    };
    const steered: any = await controller.createCall(hostileReq, { tableNumber: 'T5', callType: 'waiter' }, 'myshop');
    assert.equal(steered.tenant_id, 't-slug');

    // 6. Staff session wins and needs no slug.
    const staffReq: any = { headers: {}, authContext: { tenantId: 'staff-tenant' } };
    const staffCall: any = await controller.createCall(staffReq, { tableNumber: 'T6', callType: 'waiter' }, undefined);
    assert.equal(staffCall.tenant_id, 'staff-tenant');

    // 7. Abuse bound: 30 allowed, 31st refused; another slug unaffected.
    const guard = new TableCallRateLimitGuard(new InMemoryRateLimitService());
    function fakeContext(slug: string): any {
      return {
        switchToHttp: () => ({
          getRequest: () => ({ ip: '203.0.113.7', socket: {}, headers: {}, query: { slug }, body: {} }),
          getResponse: () => ({ setHeader: () => undefined }),
        }),
      };
    }
    for (let i = 0; i < 30; i++) {
      assert.equal(await guard.canActivate(fakeContext('myshop')), true);
    }
    await assert.rejects(guard.canActivate(fakeContext('myshop')), httpStatus(429));
    assert.equal(await guard.canActivate(fakeContext('other-shop')), true);

    console.log('table call slug tenant checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
