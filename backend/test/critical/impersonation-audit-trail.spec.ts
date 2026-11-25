import { strict as assert } from 'node:assert';
import { AuditService } from '../../src/core/audit/audit.service';

// Regression coverage for invariant IMP-1 (ARCHITECTURE_INVARIANTS.md section 4).
//
// impersonateTenant opens a session as the tenant's OWNER (sessions.user_id = owner.id).
// Before this, nothing else was recorded, so every audit row written during the visit
// carried created_by = owner.id and was indistinguishable from the owner's own work. Only
// the start and end of the visit were logged; everything in between — posting a journal,
// approving a settlement, deleting data — was attributed to the customer.
//
// These tests pin the two halves that make attribution real: the audit writer must persist
// the impersonator, and it must stay null for ordinary logins.

type CapturedInsert = Record<string, unknown>;

/** Minimal Kysely stand-in that captures the row an insert would have written. */
function fakeDb(captured: CapturedInsert[]) {
  return {
    insertInto(_table: string) {
      return {
        values(row: CapturedInsert) {
          captured.push(row);
          return {
            async execute() {
              /* no-op */
            },
          };
        },
      };
    },
  } as any;
}

async function testImpersonatorIsRecorded(): Promise<void> {
  const captured: CapturedInsert[] = [];
  const audit = new AuditService(fakeDb(captured));

  await audit.log('حذف فاتورة', 'تم حذف فاتورة', {
    userId: 42, // the tenant owner whose identity the session runs under
    tenantId: 'tenant-a',
    accountId: 'tenant-a:main',
    impersonatedBy: 7, // the platform admin actually driving it
  });

  assert.equal(captured.length, 1);
  const row = captured[0];
  assert.equal(row.created_by, 42, 'the acting identity stays the owner');
  assert.equal(row.impersonated_by, 7, 'the platform admin must be recorded');
  assert.equal(row.tenant_id, 'tenant-a', 'the row stays scoped to the visited tenant');

  console.log('  -> An action taken while impersonating records both identities.');
}

async function testOrdinaryLoginRecordsNoImpersonator(): Promise<void> {
  const captured: CapturedInsert[] = [];
  const audit = new AuditService(fakeDb(captured));

  await audit.log('تعديل الإعدادات', 'تم تعديل الإعدادات', {
    userId: 42,
    tenantId: 'tenant-a',
    accountId: 'tenant-a:main',
  });

  assert.equal(captured[0].impersonated_by, null, 'a normal session must not look impersonated');

  // Explicitly-null is the same as absent, so a caller that passes it through gets null too.
  const captured2: CapturedInsert[] = [];
  const audit2 = new AuditService(fakeDb(captured2));
  await audit2.log('x', 'y', {
    userId: 42,
    tenantId: 'tenant-a',
    accountId: 'tenant-a:main',
    impersonatedBy: null,
  });
  assert.equal(captured2[0].impersonated_by, null);

  console.log('  -> An ordinary login records no impersonator.');
}

async function testSystemActorStillWrites(): Promise<void> {
  // Gateway callbacks have no user behind them at all (see SUB-1). They must still log,
  // with both identity columns null, rather than throwing after a committed transaction.
  const captured: CapturedInsert[] = [];
  const audit = new AuditService(fakeDb(captured));

  await audit.log('تجديد آلي', 'عبر بوابة الدفع', {
    userId: null as unknown as number,
    tenantId: 'tenant-a',
    accountId: 'tenant-a:main',
  });

  assert.equal(captured[0].created_by, null);
  assert.equal(captured[0].impersonated_by, null);

  console.log('  -> A system actor with no user still writes a row, with both columns null.');
}

async function main(): Promise<void> {
  console.log('=== [O34] IMPERSONATION AUDIT ATTRIBUTION (IMP-1) ===\n');

  console.log('[Test 1] Impersonated actions record the platform admin');
  await testImpersonatorIsRecorded();

  console.log('[Test 2] Ordinary sessions record no impersonator');
  await testOrdinaryLoginRecordsNoImpersonator();

  console.log('[Test 3] A system actor still writes an audit row');
  await testSystemActorStillWrites();

  console.log('\n=== ALL IMPERSONATION AUDIT TRAIL TESTS PASSED (3/3) ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
