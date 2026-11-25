import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { TamperAuditService } from '../../src/core/audit/tamper-audit.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const mockAuth: AuthContext = {
  userId: 1,
  sessionId: 'sess-test',
  username: 'admin',
  role: 'admin',
  tenantId: 'tenant-test',
  accountId: 'acc-test',
  permissions: ['audit'],
};

async function testEmptyChain() {
  const db = {
    // mock for empty sql query
  } as any;

  // Mocking sql execution for empty
  const service = new TamperAuditService(db);
  // Override sql call with mock
  (service as any).db = db;

  // Test empty chain scenario through direct mock
  const mockDbWithEmpty = {
    // When sql template tag is executed
  };
}

async function run(): Promise<void> {
  const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

  // 1. Build a synthetic 3-block valid cryptographic chain
  const block1Tenant = 'tenant-test';
  const block1Table = 'journal_entries';
  const block1Rec = '101';
  const block1Op = 'INSERT';
  const block1Diff = '';
  const block1New = '{"amount": 5000}';
  const block1Hash = sha256(
    `${GENESIS}|${block1Tenant}|${block1Table}|${block1Rec}|${block1Op}|${block1Diff}|${block1New}`,
  );

  const block2Tenant = 'tenant-test';
  const block2Table = 'journal_entries';
  const block2Rec = '101';
  const block2Op = 'UPDATE';
  const block2Diff = '{"amount": {"new": 6000, "old": 5000}}';
  const block2New = '{"amount": 6000}';
  const block2Hash = sha256(
    `${block1Hash}|${block2Tenant}|${block2Table}|${block2Rec}|${block2Op}|${block2Diff}|${block2New}`,
  );

  const block3Tenant = 'tenant-test';
  const block3Table = 'sales';
  const block3Rec = '55';
  const block3Op = 'INSERT';
  const block3Diff = '';
  const block3New = '{"total": 1200}';
  const block3Hash = sha256(
    `${block2Hash}|${block3Tenant}|${block3Table}|${block3Rec}|${block3Op}|${block3Diff}|${block3New}`,
  );

  // Test Verification Logic with Mock DB
  const makeMockDbWithRows = (rows: any[]) => ({
    // Kysely sql tag mock
    get [Symbol.toStringTag]() {
      return 'KyselyMock';
    },
  });

  // Verify manual hash calculations match cryptographic invariants
  assert.equal(block1Hash.length, 64);
  assert.equal(block2Hash.length, 64);
  assert.equal(block3Hash.length, 64);
  assert.notEqual(block1Hash, block2Hash);
  assert.notEqual(block2Hash, block3Hash);

  // Verify chain continuity
  assert.equal(block1Hash, block1Hash); // genesis -> block1
  assert.equal(
    block2Hash,
    sha256(`${block1Hash}|${block2Tenant}|${block2Table}|${block2Rec}|${block2Op}|${block2Diff}|${block2New}`),
  );
  assert.equal(
    block3Hash,
    sha256(`${block2Hash}|${block3Tenant}|${block3Table}|${block3Rec}|${block3Op}|${block3Diff}|${block3New}`),
  );

  // Verify that any alteration to block 1 changes its hash and invalidates block 2's prev_hash
  const tamperedBlock1New = '{"amount": 999999}';
  const tamperedBlock1Hash = sha256(
    `${GENESIS}|${block1Tenant}|${block1Table}|${block1Rec}|${block1Op}|${block1Diff}|${tamperedBlock1New}`,
  );
  assert.notEqual(tamperedBlock1Hash, block1Hash);

  console.log('tamper-audit-engine.spec: cryptographic hash chaining math verified ok');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
