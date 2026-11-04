/*
 * Consolidation totals computed for real (INV-MARITIME-CONSOLIDATION-TOTALS-REAL).
 *
 * THE GAP: the invariants file claimed child jobs auto-sync
 * the consolidation parent's totals, but no sync code existed
 * anywhere -- createJob only bumped sub_job_count and set the
 * master flag, and updateJob edited one job at a time. A
 * parent's gross weight, CBM and package count were whatever
 * was typed at creation, drifting from its line items forever.
 *
 * THE RULE: a consolidation parent's totals are DERIVED from
 * its children, recomputed on every child change (create and
 * update, in the same transaction): gross_weight_kg, total_cbm
 * and package_count are the sums of the child jobs' values,
 * and for an air parent the volumetric and chargeable weights
 * are recomputed from the summed gross/CBM through the same
 * pure air engine every air job uses. A parent with no
 * children keeps its manually entered totals -- an empty sum
 * never wipes them. Editing a parent directly leaves its
 * totals as edited until the next child change re-derives
 * them.
 *
 * WHAT THIS PINS, driving the REAL syncConsolidationParentTotals
 * on PGlite:
 * - a sea parent's totals become the exact child sums;
 * - a childless parent's manual totals are untouched and the
 *   sync reports not-synced;
 * - an air parent's volumetric/chargeable weights are
 *   recomputed from the summed figures by the shared engine;
 * - a missing parent is a no-op, not an error;
 * - source pins: createJob and updateJob both call the sync,
 *   and createConsolidationSubJob funnels through createJob.
 *
 * HONEST LIMIT: the integrated create/update drive is a
 * live-Postgres rehearsal item (createJob's advisory lock and
 * cost-center creation make full PGlite driving fragile).
 * There is no job-delete path, so no delete-triggered sync
 * is needed.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  async function parentRow(id: number): Promise<any> {
    return (db as any).selectFrom('maritime_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  try {
    await pg.exec(`
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, parent_job_id text, transport_mode text, gross_weight_kg numeric, total_cbm numeric, package_count numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric, updated_at timestamptz);
      INSERT INTO maritime_jobs VALUES
        (1,'t1',NULL,'sea',999,999,999,NULL,NULL,NULL),
        (2,'t1','1','sea',10,1.5,3,NULL,NULL,NULL),
        (3,'t1','1','sea',20,2.5,7,NULL,NULL,NULL),
        (4,'t1',NULL,'sea',5,5,5,NULL,NULL,NULL),
        (5,'t1',NULL,'air',999,999,999,999,999,NULL),
        (6,'t1','5','air',100,1,2,NULL,NULL,NULL),
        (7,'t1','999','sea',10,1,1,NULL,NULL,NULL);
    `);

    // 1. Sea parent: exact child sums.
    const sea = await service.syncConsolidationParentTotals(db as never, 't1', 1);
    assert.equal(sea.synced, true);
    assert.deepEqual([sea.grossWeightKg, sea.totalCbm, sea.packageCount], [30, 4, 10]);
    const parent1 = await parentRow(1);
    assert.equal(Number(parent1.gross_weight_kg), 30);
    assert.equal(Number(parent1.total_cbm), 4);
    assert.equal(Number(parent1.package_count), 10);

    // 2. Childless parent: manual totals untouched.
    const empty = await service.syncConsolidationParentTotals(db as never, 't1', 4);
    assert.equal(empty.synced, false);
    const parent4 = await parentRow(4);
    assert.equal(Number(parent4.gross_weight_kg), 5);
    assert.equal(Number(parent4.total_cbm), 5);
    assert.equal(Number(parent4.package_count), 5);

    // 3. Air parent: volumetric/chargeable recomputed by the engine.
    const air = await service.syncConsolidationParentTotals(db as never, 't1', 5);
    assert.equal(air.synced, true);
    const parent5 = await parentRow(5);
    assert.equal(Number(parent5.gross_weight_kg), 100);
    assert.equal(Number(parent5.total_cbm), 1);
    assert.ok(Math.abs(Number(parent5.volumetric_weight_kg) - 1000000 / 6000) < 1e-9, 'volumetric = 1 CBM at the 6000 divisor');
    assert.equal(Number(parent5.chargeable_weight_kg), 167, 'chargeable rounds up to the next 0.5 kg');

    // 4. Missing parent: no-op, not an error.
    const missing = await service.syncConsolidationParentTotals(db as never, 't1', 999);
    assert.equal(missing.synced, false);
    assert.equal(missing.grossWeightKg, 10);

    // 5. Source pins: both write paths call the sync.
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const createStart = source.indexOf('async createJob(');
    const updateStart = source.indexOf('async updateJob(');
    const milestoneStart = source.indexOf('async addJobMilestone(');
    assert.ok(source.slice(createStart, updateStart).includes('syncConsolidationParentTotals'), 'createJob must sync the parent');
    assert.ok(source.slice(updateStart, milestoneStart).includes('syncConsolidationParentTotals'), 'updateJob must sync the parent');
    const subJobStart = source.indexOf('async createConsolidationSubJob(');
    assert.ok(source.slice(subJobStart, subJobStart + 1500).includes('createJob('), 'sub-job creation must funnel through createJob');

    console.log('maritime consolidation totals real checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
