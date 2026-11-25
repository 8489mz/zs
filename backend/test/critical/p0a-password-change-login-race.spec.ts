import { strict as assert } from 'node:assert';
import { UnauthorizedException } from '@nestjs/common';
import { SessionService } from '../../src/core/auth/services/session.service';

async function run(): Promise<void> {
  let inserts = 0;
  const db = {
    transaction: () => ({
      execute: async (fn: (trx: any) => Promise<unknown>) =>
        fn({
          selectFrom: () => ({
            select: () => ({
              where: () => ({
                where: () => ({
                  forUpdate: () => ({
                    executeTakeFirst: async () => ({
                      is_active: true,
                      locked_until: null,
                      password_hash: 'changed-password-hash',
                    }),
                  }),
                }),
              }),
            }),
          }),
          updateTable: () => ({
            set: () => ({ where: () => ({ where: () => ({ execute: async () => undefined }) }) }),
          }),
          insertInto: () => ({
            values: () => ({
              execute: async () => {
                inserts++;
              },
            }),
          }),
        }),
    }),
  };
  const service = new SessionService(db as any, { get: () => 'default' } as any, {} as any, {} as any);
  await assert.rejects(
    () =>
      (service as any).createAuthenticatedSession(
        {
          id: 7,
          username: 'owner',
          role: 'admin',
          permissions_json: '[]',
          tenant_id: 'store-a',
          account_id: 'store-a:main',
        },
        undefined,
        { expectedPasswordHash: 'old-password-hash', rehashPassword: null },
      ),
    UnauthorizedException,
  );
  assert.equal(inserts, 0, 'An obsolete password may not create a new session');
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
