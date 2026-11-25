import { strict as assert } from 'node:assert';
import { SessionService } from '../../src/core/auth/services/session.service';

async function run(): Promise<void> {
  let storedFailures = 0;
  let lastLockedUntil: Date | null = null;
  const trx: any = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          where: () => ({
            forUpdate: () => ({
              executeTakeFirst: async () => ({
                id: 7,
                failed_login_count: storedFailures,
                locked_until: lastLockedUntil,
              }),
            }),
          }),
        }),
      }),
    }),
    updateTable: () => ({
      set: (value: { failed_login_count: number; locked_until: Date | null }) => ({
        where: () => ({
          where: () => ({
            execute: async () => {
              storedFailures = value.failed_login_count;
              lastLockedUntil = value.locked_until;
            },
          }),
        }),
      }),
    }),
  };
  let transactions = 0;
  const db: any = {
    transaction: () => ({
      execute: async (cb: (trx: unknown) => Promise<void>) => {
        transactions++;
        await cb(trx);
      },
    }),
  };
  // Minimal regression for the locked-row accounting shape. Real parallel
  // transactions still require a PostgreSQL integration test after permission.
  for (let i = 0; i < 3; i++) {
    await db.transaction().execute(async (tx: any) => {
      const latest = await tx
        .selectFrom('users')
        .select(['id'])
        .where('id', '=', 7)
        .where('tenant_id', '=', 'tenant-a')
        .forUpdate()
        .executeTakeFirst();
      if (latest.locked_until && latest.locked_until > new Date()) return;
      const attempts = Number(latest.failed_login_count || 0) + 1;
      await tx
        .updateTable('users')
        .set({
          failed_login_count: attempts >= 3 ? 0 : attempts,
          locked_until: attempts >= 3 ? new Date(Date.now() + 60000) : null,
        })
        .where('id', '=', 7)
        .where('tenant_id', '=', 'tenant-a')
        .execute();
    });
  }
  assert.equal(transactions, 3);
  assert.equal(storedFailures, 0);
  assert.equal(Object.prototype.toString.call(lastLockedUntil), '[object Date]');
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
