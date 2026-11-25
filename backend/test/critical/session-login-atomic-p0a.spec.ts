import { strict as assert } from 'node:assert';
import { UnauthorizedException } from '@nestjs/common';
import { SessionService } from '../../src/core/auth/services/session.service';

async function run(): Promise<void> {
  const user = {
    id: 10,
    username: 'manager',
    role: 'admin',
    permissions_json: '[]',
    tenant_id: 'merchant-a',
    account_id: 'merchant-a:main',
  };
  const trace: string[] = [];
  let isActive = true;
  let failInsert = false;
  const trx: any = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          where: () => ({
            forUpdate: () => ({
              executeTakeFirst: async () => {
                trace.push('locked-user');
                return { is_active: isActive, locked_until: null };
              },
            }),
          }),
        }),
      }),
    }),
    updateTable: () => ({
      set: () => ({
        where: () => ({
          where: () => ({
            execute: async () => {
              trace.push('update-user');
            },
          }),
        }),
      }),
    }),
    insertInto: () => ({
      values: () => ({
        execute: async () => {
          trace.push('insert-session');
          if (failInsert) throw new Error('database insert failed');
        },
      }),
    }),
  };
  const db: any = {
    transaction: () => ({
      execute: async (callback: (transaction: any) => Promise<unknown>) => {
        trace.push('begin');
        try {
          const result = await callback(trx);
          trace.push('commit');
          return result;
        } catch (error) {
          trace.push('rollback');
          throw error;
        }
      },
    }),
  };
  const service = new SessionService(db, { get: () => 'default' } as any, {} as any, {} as any);

  isActive = false;
  await assert.rejects(() => (service as any).createAuthenticatedSession(user), UnauthorizedException);
  assert.deepEqual(trace, ['begin', 'locked-user', 'rollback']);
  trace.length = 0;

  isActive = true;
  failInsert = true;
  await assert.rejects(() => (service as any).createAuthenticatedSession(user), /database insert failed/);
  assert.deepEqual(trace, ['begin', 'locked-user', 'update-user', 'insert-session', 'rollback']);
  trace.length = 0;

  failInsert = false;
  const result = await (service as any).createAuthenticatedSession(user);
  assert.ok(result.sessionId);
  assert.deepEqual(trace, ['begin', 'locked-user', 'update-user', 'insert-session', 'commit']);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
