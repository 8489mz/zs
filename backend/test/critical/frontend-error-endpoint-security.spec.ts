import { strict as assert } from 'node:assert';
import { LogsController } from '../../src/core/logging/logs.controller';

let accepted = 0;
let block = false;
const logger: any = {
  error() {
    accepted++;
  },
};
const limiter: any = {
  async hit(key: string, limit: number, seconds: number) {
    assert.equal(key, 'frontend-error:127.0.0.1');
    assert.equal(limit, 10);
    assert.equal(seconds, 60);
    return { allowed: !block };
  },
};
const ctrl = new LogsController(logger, limiter);
const request = { ip: '127.0.0.1' };
(async () => {
  assert.deepEqual(await ctrl.logFrontendError({ message: 'test' }, request), { ok: true });
  assert.equal(accepted, 1);
  await assert.rejects(ctrl.logFrontendError({ message: 'X'.repeat(11_000) }, request), /payload is too large/);
  assert.equal(accepted, 1);
  block = true;
  await assert.rejects(ctrl.logFrontendError({ message: 'test' }, request), /Too many frontend error reports/);
  assert.equal(accepted, 1);
  console.log('Frontend-error endpoint abuse regressions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
