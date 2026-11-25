import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ZatcaOnboardingService } from '../../src/modules/tax-integration/services/zatca/zatca-onboarding.service';

type EgsRow = {
  id: number;
  tenant_id: string;
  device_uuid: string;
  csr_content: string;
  environment: 'sandbox' | 'simulation' | 'production';
  compliance_csid: string | null;
  compliance_secret: string | null;
  compliance_request_id?: string | null;
};

function fakeDb(egs: EgsRow) {
  let updateCount = 0;
  const db = {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({ where: () => ({ executeTakeFirst: async () => egs }) }),
      }),
    }),
    updateTable: () => {
      updateCount += 1;
      return { set: () => ({ where: () => ({ where: () => ({ execute: async () => [] }) }) }) };
    },
    get updateCount() {
      return updateCount;
    },
  };
  return db;
}

function response(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    let inserted: Record<string, unknown> = {};
    const insertDb = {
      selectFrom: () => ({
        select: () => ({ where: () => ({ executeTakeFirst: async () => ({ business_name: 'Test Taxpayer LLC' }) }) }),
      }),
      insertInto: () => ({
        values: (values: Record<string, unknown>) => {
          inserted = values;
          return { returning: () => ({ executeTakeFirstOrThrow: async () => ({ id: 1 }) }) };
        },
      }),
    };
    const unitService = new ZatcaOnboardingService(
      insertDb as any,
      {
        getSettings: async () => ({ tax_id: '300000000000003', environment: 'production' }),
      } as any,
    );
    await unitService.createEgsUnit('tenant-a', { deviceName: 'POS A', environment: 'production' });
    const csrPem = Buffer.from(String(inserted.csr_content), 'base64');
    const verification = spawnSync('openssl', ['req', '-verify', '-noout', '-inform', 'PEM'], {
      input: csrPem,
      encoding: 'utf8',
    });
    assert.equal(verification.status, 0, `CSR signature verification failed: ${verification.stderr}`);
    assert.match(`${verification.stdout}${verification.stderr}`, /verify OK/i);

    const productionEgs: EgsRow = {
      id: 1,
      tenant_id: 'tenant-a',
      device_uuid: 'egs-a',
      csr_content: 'csr',
      environment: 'production',
      compliance_csid: null,
      compliance_secret: null,
    };
    const complianceDb = fakeDb(productionEgs);
    globalThis.fetch = (async () => response(401, { message: 'invalid OTP' })) as typeof fetch;
    const service = new ZatcaOnboardingService(complianceDb as any, {} as any);
    // D9: egsId is NARROWED to string in RequestComplianceDto (the pipe
    // coerces a numeric egsId to '42'); this spec drives the SERVICE
    // directly, which still accepts a numeric egsId via String(), so
    // the numeric literal is cast here — the DTO is right, the spec
    // tests the service validator, which keeps its own String() as the
    // backstop for internal callers (D6 payment-allocation precedent).
    await assert.rejects(
      () => service.requestComplianceCsid('tenant-a', { egsId: 1 as unknown as string, otp: '123456' }),
      /ZATCA compliance request failed with HTTP 401/,
    );
    assert.equal(complianceDb.updateCount, 0, 'failed production compliance must not update the EGS');

    const productionReadyEgs = {
      ...productionEgs,
      compliance_csid: 'real-compliance',
      compliance_secret: 'real-secret',
      compliance_request_id: 'zatca-request-123',
    };
    const productionDb = fakeDb(productionReadyEgs);
    globalThis.fetch = (async () => response(503, { message: 'unavailable' })) as typeof fetch;
    const productionService = new ZatcaOnboardingService(productionDb as any, {} as any);
    await assert.rejects(
      () => productionService.requestProductionCsid('tenant-a', 1),
      /ZATCA production CSID request failed with HTTP 503/,
    );
    assert.equal(productionDb.updateCount, 0, 'failed production CSID must not activate the EGS');

    let postedRequestId = '';
    globalThis.fetch = (async (_url, init) => {
      postedRequestId = JSON.parse(String(init?.body)).compliance_request_id;
      return response(200, { binarySecurityToken: 'production-token', secret: 'production-secret' });
    }) as typeof fetch;
    await productionService.requestProductionCsid('tenant-a', 1);
    assert.equal(postedRequestId, 'zatca-request-123', 'production must use the compliance response request ID');
    assert.equal(productionDb.updateCount, 1);

    console.log('zatca-onboarding-safety.spec: ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
