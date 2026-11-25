import { strict as assert } from 'node:assert';
import { PosTerminalService } from '../../src/modules/sales/services/pos-terminal.service';

const originalMode = process.env.APP_MODE;
const originalNodeEnv = process.env.NODE_ENV;
(async () => {
  try {
    const service = new PosTerminalService(undefined as any);
    (service as any).getTerminals = async () => [
      { id: 'sim', name: 'Simulator', provider: 'mock_sandbox', isDefault: true, ipAddress: '127.0.0.1' },
    ];
    process.env.APP_MODE = 'CLOUD_SAAS';
    process.env.NODE_ENV = 'test';
    await assert.rejects(
      service.initiatePayment('tenant-A', { terminalId: 'sim', amount: 100 } as any),
      /محاكي الدفع غير مسموح/,
    );
    process.env.APP_MODE = 'SELF_CONTAINED';
    process.env.NODE_ENV = 'production';
    await assert.rejects(
      service.initiatePayment('tenant-A', { terminalId: 'sim', amount: 100 } as any),
      /محاكي الدفع غير مسموح/,
    );
    console.log('POS mock production guard regressions passed');
  } finally {
    if (originalMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = originalMode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
