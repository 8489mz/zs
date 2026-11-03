/*
New file: backend/test/critical/import-tariff-versioning.spec.ts
Pins explicit, versioned tariff data (INV-IMPORT-TARIFF-VERSIONING).

WHAT WAS WRONG: every read of the tariff list silently seeded
the bundled snapshot whenever fewer than 15 rows existed, and
every refresh overwrote tenant-edited rows (doUpdateSet) — a
tenant's corrected rate vanished on the next list or refresh,
with no record of which snapshot the data came from. The
calculator additionally rendered an unknown HS code as zeros
with a success toast, the backend's warning message ignored.

WHAT THIS PINS, driving the real syncOfficialTariffs,
listCustomsTariffs and calculateCustomsTax on PGlite:
- A list read never seeds: an empty tenant stays empty.
- Refresh is insert-only: a tenant-edited row keeps its rate
  and keeps a NULL version (untouched); new rows carry the
  TARIFF_DATA_VERSION stamp; counts report inserted/skipped.
- A second refresh inserts nothing.
- The calculator labels an unknown HS code (zeros +
  isDocumentedTariff false + message) and honours a documented
  official row's rates; a tenant custom row stays labelled
  unofficial.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import {
  EGYPT_CUSTOMS_TARIFFS,
  TARIFF_DATA_VERSION,
} from '../../src/modules/import-sales/data/egypt-customs-tariffs.data';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_customs_tariffs (
      id text PRIMARY KEY DEFAULT ('tar-' || md5(random()::text)),
      tenant_id text,
      hs_code text,
      description_ar text,
      description_en text,
      duty_rate_percent numeric,
      vat_rate_percent numeric,
      regulatory_body text,
      inspection_fees_percent numeric,
      official_source text,
      is_official boolean,
      sector text,
      category_ar text,
      data_version text,
      created_at timestamptz DEFAULT NOW(),
      UNIQUE (tenant_id, hs_code)
    );
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function rowCount(db: Kysely<Database>, tenantId: string): Promise<number> {
  const rows: any[] = await (db as any)
    .selectFrom('import_customs_tariffs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .execute();
  return rows.length;
}

async function main(): Promise<void> {
  const total = EGYPT_CUSTOMS_TARIFFS.length;
  assert.ok(total >= 15, 'The bundled snapshot is non-trivial');

  // Case 1: a list read never seeds.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const rows = await service.listCustomsTariffs('t1');
      assert.deepEqual(rows, [], 'Empty tenant lists empty');
      assert.equal(await rowCount(db, 't1'), 0, 'No silent seeding on read');
      const calc = await service.calculateCustomsTax('t1', '9999.99', 100000);
      assert.equal(calc.isDocumentedTariff, false);
      assert.equal(calc.totalCustomsDues, 0);
      assert.ok(String(calc.message).length > 0, 'Unknown HS code carries a warning message');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: refresh inserts the snapshot, stamps the version,
  // and reports honest counts; a second refresh inserts nothing.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.syncOfficialTariffs('t1');
      assert.equal(first.success, true);
      assert.equal(first.total, total);
      assert.equal(first.inserted, total);
      assert.equal(first.skipped, 0);
      assert.equal(first.dataVersion, TARIFF_DATA_VERSION);
      assert.equal(await rowCount(db, 't1'), total);

      const stamped: any[] = await (db as any)
        .selectFrom('import_customs_tariffs')
        .select('data_version')
        .where('tenant_id', '=', 't1')
        .execute();
      assert.ok(stamped.every((r) => r.data_version === TARIFF_DATA_VERSION), 'Every inserted row carries the version');

      const second = await service.syncOfficialTariffs('t1');
      assert.equal(second.inserted, 0);
      assert.equal(second.skipped, total);
      assert.equal(await rowCount(db, 't1'), total, 'Second refresh adds no rows');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a tenant-edited row is never overwritten, and a
  // tenant custom row keeps its own rate.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const bundled = EGYPT_CUSTOMS_TARIFFS[0];
      await (db as any).insertInto('import_customs_tariffs').values({
        tenant_id: 't1',
        hs_code: bundled.hs_code,
        description_ar: 'Tenant corrected description',
        description_en: null,
        duty_rate_percent: 99,
        vat_rate_percent: 14,
        inspection_fees_percent: 1,
        regulatory_body: 'GOEIC',
        sector: bundled.sector,
        category_ar: bundled.category_ar,
        official_source: bundled.official_source,
        is_official: true,
        data_version: null,
      }).execute();

      const res = await service.syncOfficialTariffs('t1');
      assert.equal(res.inserted, total - 1, 'Only the missing rows are inserted');
      assert.equal(res.skipped, 1, 'The existing row is skipped, not overwritten');

      const kept: any = await (db as any)
        .selectFrom('import_customs_tariffs')
        .selectAll()
        .where('tenant_id', '=', 't1')
        .where('hs_code', '=', bundled.hs_code)
        .executeTakeFirstOrThrow();
      assert.equal(Number(kept.duty_rate_percent), 99, 'Tenant-edited rate survives the refresh');
      assert.equal(kept.description_ar, 'Tenant corrected description');
      assert.equal(kept.data_version, null, 'Untouched rows keep a NULL version');

      // The calculator honours the tenant rate for that HS code.
      const calc = await service.calculateCustomsTax('t1', bundled.hs_code, 100000);
      assert.equal(calc.isDocumentedTariff, true);
      assert.equal(calc.customsDuty, 99000, 'Calculator uses the stored (tenant) rate');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: a documented official row calculates; a tenant
  // custom (unofficial) row stays labelled unofficial.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.syncOfficialTariffs('t1');
      const bundled = EGYPT_CUSTOMS_TARIFFS[1];
      const calc = await service.calculateCustomsTax('t1', bundled.hs_code, 200000);
      assert.equal(calc.isDocumentedTariff, true);
      assert.equal(calc.isOfficialTariff, true);
      const expectedDuty = Number((200000 * (Number(bundled.duty_rate_percent) / 100)).toFixed(2));
      assert.equal(calc.customsDuty, expectedDuty);

      await (db as any).insertInto('import_customs_tariffs').values({
        tenant_id: 't1',
        hs_code: '5555.55',
        description_ar: 'Custom estimate',
        description_en: null,
        duty_rate_percent: 7,
        vat_rate_percent: 14,
        inspection_fees_percent: 0,
        regulatory_body: null,
        sector: null,
        category_ar: null,
        official_source: null,
        is_official: false,
        data_version: null,
      }).execute();
      const custom = await service.calculateCustomsTax('t1', '5555.55', 100000);
      assert.equal(custom.isDocumentedTariff, false, 'Custom rows are never presented as documented');
      assert.equal(custom.customsDuty, 7000);
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import tariff versioning tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
