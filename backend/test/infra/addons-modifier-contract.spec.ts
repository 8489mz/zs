/* INV-REST-MODIFIER-CONTRACT-2 (R4-C): AddonsService over PGlite.
 * Direct service calls, fresh database per phase, teardown with
 * db.destroy() only.
 *
 * WHAT THIS PINS (I49 + I50):
 * - Editing only a group's name preserves its display order, active
 *   flag and splittable flag (at base the update defaults them back
 *   to 0 / true / false because the page never sends them).
 * - A negative option price is rejected with 400 on create and on
 *   update, and a negative flat-addon price is rejected with 400
 *   (at base all three are stored silently).
 * - getProductModifiers returns [] for a product with no linked
 *   groups (at base it returns every active group), and only the
 *   linked groups for a linked product.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AddonsService } from '../../src/modules/addons/addons.service';

const AUTH = {
  tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin',
  permissions: [],
} as unknown as AuthContext;

const AUDIT_STUB = { log: async () => {} } as never;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL);
    CREATE TABLE addons (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, price numeric NOT NULL DEFAULT 0, cost_price numeric NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE pos_modifier_groups (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, name_en text, selection_type text NOT NULL DEFAULT 'multiple', is_mandatory boolean NOT NULL DEFAULT false, min_selections integer NOT NULL DEFAULT 0, max_selections integer NOT NULL DEFAULT 10, display_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, is_splittable_in_half boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, group_id bigint NOT NULL, name text NOT NULL, name_en text, price numeric NOT NULL DEFAULT 0, cost_price numeric NOT NULL DEFAULT 0, is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, display_order integer NOT NULL DEFAULT 0, component_product_id bigint, consumption_qty numeric, unit_name text, portion_allowed text NOT NULL DEFAULT 'both', preparation_time_minutes integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE product_pos_modifiers (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, modifier_group_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW());
  `);
  return { pg, db };
}

async function main(): Promise<void> {
  // Phase 1: editing only the name preserves order / active / splittable.
  // On the base code the update defaults them to 0 / true / false.
  {
    const { db } = await makeDb();
    try {
      const service = new AddonsService(db, AUDIT_STUB);
      const created = await service.createModifierGroup({
        name: 'Sauces', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10, displayOrder: 5,
        isActive: false, isSplittableInHalf: true,
        options: [{ name: 'Ketchup', price: 2, costPrice: 1 }],
      }, AUTH);
      const groupId = Number(created.id);
      // The modifiers page payload: it never sends the three fields.
      await service.updateModifierGroup(groupId, {
        name: 'Sauces renamed', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10,
        options: [{ name: 'Ketchup', price: 2, costPrice: 1 }],
      }, AUTH);
      const reloaded = (await service.listModifierGroups(AUTH)).groups
        .find((g) => Number(g.id) === groupId)!;
      assert.equal(reloaded.name, 'Sauces renamed');
      assert.equal(reloaded.displayOrder, 5, 'edit must not zero the display order');
      assert.equal(reloaded.isActive, false, 'edit must not reactivate the group');
      assert.equal(reloaded.isSplittableInHalf, true, 'edit must not clear splittable');
      // And an explicit send still wins over the stored value.
      await service.updateModifierGroup(groupId, {
        name: 'Sauces renamed', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10, displayOrder: 9,
        isActive: true, isSplittableInHalf: false,
        options: [{ name: 'Ketchup', price: 2, costPrice: 1 }],
      }, AUTH);
      const resent = (await service.listModifierGroups(AUTH)).groups
        .find((g) => Number(g.id) === groupId)!;
      assert.equal(resent.displayOrder, 9);
      assert.equal(resent.isActive, true);
      assert.equal(resent.isSplittableInHalf, false);
      console.log('addons modifier contract: phase 1 (edit preserves flags) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 2: negative prices are rejected, never stored.
  {
    const { db } = await makeDb();
    try {
      const service = new AddonsService(db, AUDIT_STUB);
      await assert.rejects(
        service.createModifierGroup({
          name: 'Bad prices', selectionType: 'multiple', isMandatory: false,
          minSelections: 0, maxSelections: 10,
          options: [{ name: 'Negative', price: -5, costPrice: 0 }],
        }, AUTH),
        (e: any) => e.statusCode === 400,
      );
      await assert.rejects(
        service.createModifierGroup({
          name: 'Bad prices', selectionType: 'multiple', isMandatory: false,
          minSelections: 0, maxSelections: 10,
          options: [{ name: 'NaN price', price: NaN, costPrice: 0 }],
        }, AUTH),
        (e: any) => e.statusCode === 400,
      );
      const created = await service.createModifierGroup({
        name: 'Good', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10,
        options: [{ name: 'Ok', price: 3, costPrice: 1 }],
      }, AUTH);
      await assert.rejects(
        service.updateModifierGroup(Number(created.id), {
          name: 'Good', selectionType: 'multiple', isMandatory: false,
          minSelections: 0, maxSelections: 10,
          options: [{ name: 'Ok', price: -1, costPrice: 1 }],
        }, AUTH),
        (e: any) => e.statusCode === 400,
      );
      await assert.rejects(
        service.createAddon({ name: 'Bad addon', price: -2 } as any, AUTH),
        (e: any) => e.statusCode === 400,
      );
      await assert.rejects(
        service.createAddon({ name: 'Bad addon', price: 5, costPrice: -1 } as any, AUTH),
        (e: any) => e.statusCode === 400,
      );
      const groups = (await service.listModifierGroups(AUTH)).groups;
      assert.equal(groups.length, 1, 'rejected creates store nothing');
      assert.equal((await service.listAddons(AUTH)).addons.length, 0);
      console.log('addons modifier contract: phase 2 (negative prices rejected) OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 3: unlinked products get no groups; linked products get only theirs.
  {
    const { db } = await makeDb();
    try {
      const service = new AddonsService(db, AUDIT_STUB);
      const first = await service.createModifierGroup({
        name: 'Group A', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10,
        options: [{ name: 'A1', price: 1, costPrice: 0 }],
      }, AUTH);
      const second = await service.createModifierGroup({
        name: 'Group B', selectionType: 'multiple', isMandatory: false,
        minSelections: 0, maxSelections: 10,
        options: [{ name: 'B1', price: 2, costPrice: 0 }],
      }, AUTH);
      const unlinked = await service.getProductModifiers(101, AUTH);
      assert.deepEqual(unlinked.groups, [], 'unlinked product shows no groups');
      await service.linkProductModifiers(101, [Number(first.id)], AUTH);
      const linked = await service.getProductModifiers(101, AUTH);
      assert.equal(linked.groups.length, 1);
      assert.equal(linked.groups[0].name, 'Group A');
      const other = await service.getProductModifiers(102, AUTH);
      assert.deepEqual(other.groups, [], 'another unlinked product still shows no groups');
      await service.linkProductModifiers(101, [Number(first.id), Number(second.id)], AUTH);
      assert.equal((await service.getProductModifiers(101, AUTH)).groups.length, 2);
      console.log('addons modifier contract: phase 3 (linked-only groups) OK');
    } finally {
      await db.destroy();
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
