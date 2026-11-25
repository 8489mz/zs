import { strict as assert } from 'node:assert';
import { tenantScopedReferences } from '../../src/database/migrations/2040000000255_platform_tenant_fk_hardening';

function run(): void {
  assert.deepEqual(
    tenantScopedReferences.map((r) => [r.child, r.column, r.parent, r.onDelete]),
    [
      ['user_mfa', 'user_id', 'users', 'CASCADE'],
      ['maritime_rfq_bids', 'rfq_id', 'maritime_rfqs', 'CASCADE'],
      ['maritime_containers', 'job_id', 'maritime_jobs', 'CASCADE'],
      ['maritime_job_milestones', 'job_id', 'maritime_jobs', 'CASCADE'],
    ],
  );
}
run();
