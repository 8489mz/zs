/* INV-REST-MODIFIER-LINK-LOAD-TRUTH (Trial 3, G2): the GET
 * products/:productId/modifiers handler lacked @RequirePermissions, so
 * PermissionsGuard threw (→500) on EVERY load while the POST save
 * succeeded — the UI toasted success and then showed
 * "تعذر تحميل مجموعات الصنف" on every reload, and the re-selected
 * checkboxes came back unchecked. The data was saved; only the read
 * was broken.
 *
 * WHAT THIS PINS:
 * - The GET handler carries @RequirePermissions('products'), exactly
 *   like its POST sibling (at base the metadata is absent).
 * - With a REAL Reflector, PermissionsGuard.canActivate returns true
 *   for a user holding 'products' on the GET handler (at base it
 *   throws "lacks @RequirePermissions" — the production 500), and
 *   still throws ForbiddenException for a user without 'products'.
 * - The save→reload round-trip persists: linkProductModifiers then
 *   getProductModifiers returns the linked group (service anchor;
 *   passes at base too — the service was never broken).
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { AddonsController } from '../../src/modules/addons/addons.controller';
import { AddonsService } from '../../src/modules/addons/addons.service';

const AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: ['products'],
} as unknown as AuthContext;

const NO_PRODUCTS_AUTH = { ...AUTH, permissions: [] } as unknown as AuthContext;

const AUDIT_STUB = { log: async () => {} } as never;

function makeGuard(): PermissionsGuard {
  return new PermissionsGuard(
    new Reflector(),
    {
      hasAllPermissions: (granted: string[], required: string[]) =>
        required.every((permission) => granted.includes(permission)),
      hasAnyPermission: (granted: string[], required: string[]) =>
        required.some((permission) => granted.includes(permission)),
    } as never,
    { hasFeature: () => true } as never,
    {} as never,
  );
}

function guardContext(auth: AuthContext): any {
  return {
    getHandler: () => AddonsController.prototype.getProductModifiers,
    getClass: () => AddonsController,
    switchToHttp: () => ({ getRequest: () => ({ url: '/api/addons/products/1/modifiers', authContext: auth }) }),
  };
}

async function makeDb(): Promise<{ db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL);
    CREATE TABLE addons (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, price numeric NOT NULL DEFAULT 0, cost_price numeric NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE pos_modifier_groups (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, name_en text, selection_type text NOT NULL DEFAULT 'multiple', is_mandatory boolean NOT NULL DEFAULT false, min_selections integer NOT NULL DEFAULT 0, max_selections integer NOT NULL DEFAULT 10, display_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, is_splittable_in_half boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, group_id bigint NOT NULL, name text NOT NULL, name_en text, price numeric NOT NULL DEFAULT 0, cost_price numeric NOT NULL DEFAULT 0, is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, display_order integer NOT NULL DEFAULT 0, component_product_id bigint, consumption_qty numeric, unit_name text, portion_allowed text NOT NULL DEFAULT 'both', preparation_time_minutes integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE product_pos_modifiers (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, modifier_group_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW());
  `);
  return { db };
}

async function main(): Promise<void> {
  // Phase 1: the GET handler carries @RequirePermissions('products').
  {
    const perms = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AddonsController.prototype.getProductModifiers) || [];
    assert.deepEqual(perms, ['products'], 'GET products/:productId/modifiers must require products permission');
    const postPerms = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AddonsController.prototype.linkProductModifiers) || [];
    assert.deepEqual(postPerms, ['products'], 'POST sibling must keep requiring products permission');
    console.log('product-modifier-link-load: phase 1 (decorator present) OK');
  }

  // Phase 2: the real guard lets a permitted user through the GET
  // handler and still blocks a user without the permission.
  {
    const guard = makeGuard();
    assert.equal(
      guard.canActivate(guardContext(AUTH)),
      true,
      'permitted user must pass the guard on the GET handler',
    );
    assert.throws(
      () => guard.canActivate(guardContext(NO_PRODUCTS_AUTH)),
      ForbiddenException,
      'user without products permission must still be forbidden',
    );
    console.log('product-modifier-link-load: phase 2 (guard allows permitted user) OK');
  }

  // Phase 3: save→reload round-trip persists the link.
  {
    const { db } = await makeDb();
    try {
      const service = new AddonsService(db, AUDIT_STUB);
      const product = await sql<{ id: string }>`INSERT INTO products (tenant_id, name) VALUES ('t1', 'Test product') RETURNING id`
        .execute(db)
        .then((r) => r.rows[0]);
      const productId = Number(product.id);
      const created = await service.createModifierGroup({
        name: 'Side dish', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10,
        options: [{ name: 'Fries', price: 5, costPrice: 2 }],
      }, AUTH);
      const groupId = Number(created.id);

      const before = await service.getProductModifiers(productId, AUTH);
      assert.deepEqual(before.groups, [], 'unlinked product shows no groups');

      await service.linkProductModifiers(productId, [groupId], AUTH);
      const after = await service.getProductModifiers(productId, AUTH);
      assert.equal(after.groups.length, 1, 'reload after save must return the linked group');
      assert.equal(Number(after.groups[0].id), groupId);
      assert.equal(after.groups[0].name, 'Side dish');

      // Unlinking persists too: the reload must go back to empty.
      await service.linkProductModifiers(productId, [], AUTH);
      const cleared = await service.getProductModifiers(productId, AUTH);
      assert.deepEqual(cleared.groups, [], 'unlink must persist on reload');
      console.log('product-modifier-link-load: phase 3 (save→reload round-trip) OK');
    } finally {
      await db.destroy();
    }
  }

  console.log('product-modifier-link-load.spec: ok');
}

void main();
