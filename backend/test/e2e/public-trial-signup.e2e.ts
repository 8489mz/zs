import assert from 'node:assert/strict';
import { E2EClient } from './e2e-utils';

async function main(): Promise<void> {
  const admin = new E2EClient();
  const visitor = new E2EClient();
  const superAdminPassword = process.env.E2E_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '';
  await admin.login();

  const suffix = String(Date.now());
  const email = `trial-${suffix}@example.test`;
  const phone = `010${suffix.slice(-8)}`;
  const payload = {
    businessName: `Audit Trial ${suffix}`,
    ownerPhone: phone,
    ownerEmail: email,
  };

  try {
    const signup = await visitor.post('/api/public/trial-signup', payload);
    assert.equal(signup.ok, true);
    if (process.env.PUBLIC_TRIAL_DEBUG_CREDENTIALS !== 'true') {
      assert.equal('debug' in signup, false, 'public signup must not disclose credentials');
    }

    const found = await admin.get(`/api/saas-admin/tenants?search=${encodeURIComponent(email)}`);
    assert.equal(found.tenants?.length, 1, 'exactly one trial tenant should be provisioned');
    assert.equal(found.tenants[0].status, 'trial');
    assert.equal(found.tenants[0].ownerIsActive, true);
    assert.ok(found.tenants[0].ownerUsername);
    assert.ok(found.tenants[0].trialEndsAt);

    const duplicate = await visitor.request('POST', '/api/public/trial-signup', payload);
    assert.equal(duplicate.response.status, 400, 'same email or phone must not create another trial');
  } finally {
    const found = await admin.get(`/api/saas-admin/tenants?search=${encodeURIComponent(email)}`);
    for (const tenant of found.tenants || []) {
      await admin.post(`/api/saas-admin/tenants/${tenant.id}/delete`, { superAdminPassword });
    }
  }

  console.log('public trial signup e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
