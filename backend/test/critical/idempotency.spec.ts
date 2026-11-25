import { strict as assert } from 'node:assert';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AppError } from '../../src/common/errors/app-error';
import { idempotencyStorage } from '../../src/core/idempotency/idempotency.context';

// Mock DB
let insertSuccess = true;
let existingRecord: any = null;
const updatedRecord: any = null;
let updates: any[] = [];

const mockDb: any = {
  insertInto: () => ({
    values: (data: any) => ({
      execute: async () => {
        if (!insertSuccess) {
          const err = new Error('duplicate key');
          (err as any).code = '23505';
          throw err;
        }
        existingRecord = data;
      }
    })
  }),
  selectFrom: () => {
    const filters: [string, string, any][] = [];
    const builder: any = {
      selectAll: () => builder,
      select: () => builder,
      where: (col: any, op?: any, val?: any) => {
        if (typeof col === 'string') {
          filters.push([col, op, val]);
        }
        return builder;
      },
      executeTakeFirst: async () => {
        if (!existingRecord) return null;
        for (const [col, op, val] of filters) {
          if (col === 'operation_type' && op === '=' && existingRecord.operation_type !== val) {
            return null;
          }
        }
        return existingRecord;
      },
      execute: async () => {
        if (!existingRecord) return [];
        for (const [col, op, val] of filters) {
          if (col === 'operation_type' && op === '=' && existingRecord.operation_type !== val) {
            return [];
          }
        }
        return [existingRecord];
      },
    };
    return builder;
  },
  updateTable: () => ({
    set: (data: any) => ({
      where: () => ({
        where: () => ({
          where: () => ({
            where: () => ({
              where: () => ({
                where: () => ({
                  execute: async () => {
                    updates.push(data);
                    if (existingRecord) existingRecord.status = data.status;
                  }
                }),
                execute: async () => {
                  updates.push(data);
                  if (existingRecord) existingRecord.status = data.status;
                }
              }),
              execute: async () => {
                updates.push(data);
                if (existingRecord) existingRecord.status = data.status;
              }
            })
          })
        })
      })
    })
  })
};

const service = new IdempotencyService(mockDb);

async function runTests() {
  console.log('Running idempotency tests...');

  // 1. Request Hash
  const hash1 = service.generateRequestHash({ a: 1, b: 2 });
  const hash2 = service.generateRequestHash({ b: 2, a: 1 });
  assert.equal(hash1, hash2, 'Canonical serialization failed');

  // 2. Successful reservation
  insertSuccess = true;
  let result = await service.reserveOperation({
    tenantId: 't1', accountId: 'a1', idempotencyKey: 'k1', operationType: 'test', requestHash: hash1
  });
  assert.equal(result, null, 'Expected reservation to succeed (return null)');

  // 3. Duplicate key with same hash
  insertSuccess = false;
  existingRecord = { status: 'processing', request_hash: hash1, operation_type: 'test' };
  result = await service.reserveOperation({
    tenantId: 't1', accountId: 'a1', idempotencyKey: 'k1', operationType: 'test', requestHash: hash1
  });
  assert.equal(result?.status, 'processing');

  // 4. Duplicate key with different hash
  insertSuccess = false;
  existingRecord = { status: 'processing', request_hash: 'different_hash', operation_type: 'test' };
  try {
    await service.reserveOperation({
      tenantId: 't1', accountId: 'a1', idempotencyKey: 'k1', operationType: 'test', requestHash: hash1
    });
    assert.fail('Expected error for different payload');
  } catch (error: any) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  }

  // 5. AsyncLocalStorage context
  await new Promise<void>((resolve) => {
    idempotencyStorage.run({ idempotencyKey: 'key_123', operationType: 'op' }, () => {
      const ctx = idempotencyStorage.getStore();
      assert.equal(ctx?.idempotencyKey, 'key_123');
      resolve();
    });
  });

  // 6. Record failure update condition (must not overwrite committed)
  updates = [];
  await service.recordFailure({ tenantId: 't1', accountId: 'a1', idempotencyKey: 'k1', operationType: 'test' }, 'ERR');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'failed');

  // 7. Path parameters (resource IDs) produce distinct canonical identity
  const hashResource1 = service.generateRequestHash({ amount: 100 }, { id: '123' });
  const hashResource2 = service.generateRequestHash({ amount: 100 }, { id: '456' });
  assert.notEqual(hashResource1, hashResource2, 'Different resource IDs must produce different request hashes');

  // 8. Reusing same key for different operation type must be rejected
  existingRecord = {
    tenant_id: 't1',
    account_id: 'a1',
    idempotency_key: 'k_multi_op',
    operation_type: 'POST:/api/orders/cancel',
    request_hash: hash1,
    status: 'committed',
    response_payload: JSON.stringify({ cancelled: true }),
  };
  try {
    await service.reserveOperation({
      tenantId: 't1',
      accountId: 'a1',
      idempotencyKey: 'k_multi_op',
      operationType: 'POST:/api/returns',
      requestHash: hash1,
    });
    assert.fail('Expected rejection when reusing key across different operation types');
  } catch (error: any) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_OPERATION');
  }

  // 9. Check respects operationType scoping and prevents cross-contamination
  const checkMatching = await service.check('k_multi_op', { tenantId: 't1', accountId: 'a1' }, 'POST:/api/orders/cancel');
  assert.deepEqual(checkMatching, { response: { cancelled: true } });

  const checkDifferentOp = await service.check('k_multi_op', { tenantId: 't1', accountId: 'a1' }, 'POST:/api/returns');
  assert.equal(checkDifferentOp, null, 'Check must not return committed response of a different operation type');

  console.log('idempotency.spec: ok');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
