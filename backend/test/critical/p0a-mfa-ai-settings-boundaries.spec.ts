import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { AiCopilotController } from '../../src/modules/ai-copilot/ai-copilot.controller';
import { AiCopilotService } from '../../src/modules/ai-copilot/ai-copilot.service';

// Source-level regression fixture: requests must be rejected BEFORE reaching the
// shared configuration service, independent of client-side button visibility.
async function run(): Promise<void> {
  let writes = 0;
  const copilot = {
    saveConfig: async () => {
      writes++;
      return { ok: true };
    },
    getConfig: async () => ({}),
  };
  const controller = new AiCopilotController(copilot as any, {} as any, {} as any);
  const cashier = { authContext: { role: 'cashier', tenantId: 'store-a', accountId: 'store-a:main', permissions: [] } };
  assert.throws(() => controller.saveConfig({ apiKey: 'attacker-key' }, cashier as any), ForbiddenException);
  assert.throws(() => controller.getConfig(cashier as any), ForbiddenException);
  assert.throws(() => controller.getModels({ provider: 'gemini' }, cashier as any), ForbiddenException);
  assert.equal(writes, 0);
  await controller.saveConfig({ provider: 'gemini' }, {
    authContext: { ...cashier.authContext, permissions: ['canManageSettings'] },
  } as any);
  assert.equal(writes, 1);
  const service = new AiCopilotService({} as any);
  await assert.rejects(
    () => service.saveConfig({ apiKey: 'attacker-key' }, cashier.authContext as any),
    ForbiddenException,
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
