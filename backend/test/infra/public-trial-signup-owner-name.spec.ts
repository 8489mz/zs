/* Public trial signup ownerName: the website form already requires the
 * visitor's name, but the API used to drop it and stored the business
 * name as the owner name instead. The DTO now accepts an optional
 * ownerName, the service passes the resolved name (business name as
 * fallback) to provisioning and to the welcome mail, and older clients
 * that send no ownerName keep working byte-for-byte. The spec drives
 * the real DTO validation and the real signup service with stubbed
 * infrastructure only (database, rate limiter, provisioning, mail);
 * it asserts the captured inputs, never a local copy of the logic. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { PublicTrialSignupDto } from '../../src/modules/public/dto/public-trial-signup.dto';
import { PublicTrialSignupService } from '../../src/modules/public/public-trial-signup.service';

async function dtoErrors(patch: Record<string, unknown>): Promise<string[]> {
  const dto = Object.assign(new PublicTrialSignupDto(), {
    businessName: 'Test Store',
    ownerPhone: '01012345678',
    ownerEmail: 'owner@example.com',
    ...patch,
  });
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

function emptyQuery(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.executeTakeFirst = async () => undefined;
  return chain;
}

async function main(): Promise<void> {
  // DTO: ownerName is optional, 2-80 chars when present.
  assert.deepEqual(await dtoErrors({ ownerName: 'Ahmed Mohamed' }), []);
  assert.deepEqual(await dtoErrors({}), []);
  assert.deepEqual(await dtoErrors({ ownerName: 'A' }), ['ownerName']);
  assert.deepEqual(await dtoErrors({ ownerName: 'x'.repeat(81) }), ['ownerName']);
  assert.deepEqual(await dtoErrors({ ownerName: 123 }), ['ownerName']);

  // Service: stubbed infrastructure, real signup flow.
  const captured: {
    provisioning: Record<string, unknown> | null;
    mail: Record<string, unknown> | null;
  } = { provisioning: null, mail: null };

  const service = new PublicTrialSignupService(
    { selectFrom: () => emptyQuery() } as never,
    { hit: async () => ({ allowed: true }) } as never,
    {
      normalizePhoneDigits: (value: unknown) => String(value ?? '').replace(/\D/g, ''),
      createTrialTenant: async (input: Record<string, unknown>) => {
        captured.provisioning = input;
        return {
          tenant: { id: 1, slug: 'test-store', businessName: input.businessName, trialEndsAt: new Date() },
          owner: { username: 'owner', temporaryPassword: 'tmp' },
        };
      },
    } as never,
    {
      sendTrialCredentials: async (payload: Record<string, unknown>) => {
        captured.mail = payload;
      },
    } as never,
  );

  const withName = await service.signup(
    Object.assign(new PublicTrialSignupDto(), {
      businessName: 'Test Store',
      ownerName: 'Ahmed Mohamed',
      ownerPhone: '01012345678',
      ownerEmail: 'owner@example.com',
    }),
    '127.0.0.1',
  );
  assert.equal(withName.ok, true);
  assert.equal(captured.provisioning?.ownerName, 'Ahmed Mohamed');
  assert.equal(captured.provisioning?.businessName, 'Test Store');
  assert.equal(captured.mail?.ownerName, 'Ahmed Mohamed');

  const withoutName = await service.signup(
    Object.assign(new PublicTrialSignupDto(), {
      businessName: 'Test Store',
      ownerPhone: '01012345678',
      ownerEmail: 'owner@example.com',
    }),
    '127.0.0.1',
  );
  assert.equal(withoutName.ok, true);
  assert.equal(captured.provisioning?.ownerName, 'Test Store');
  assert.equal(captured.mail?.ownerName, 'Test Store');

  console.log('public-trial-signup-owner-name: OK');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
