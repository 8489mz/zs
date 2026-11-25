import assert from 'assert';
import { E2EClient } from './e2e-utils';

async function main() {
  const saasAdmin = new E2EClient();
  const newTenantOwner = new E2EClient();

  // Use the isolated E2E platform administrator prepared by the test harness.
  await saasAdmin.login(
    process.env.E2E_USERNAME || process.env.DEFAULT_ADMIN_USERNAME || 'owner',
    process.env.E2E_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '',
  );

  // 4. Create Trial Tenant
  const uniqueStr = Date.now().toString();
  const tenantSlug = `trial-tenant-${uniqueStr}`;
  const ownerUsername = `owner-${uniqueStr}`;
  const ownerPassword = `Pass@${uniqueStr}`;

  console.log(`Creating trial tenant: ${tenantSlug}...`);
  const createTenantPayload = {
    businessName: `Test Tenant ${uniqueStr}`,
    slug: tenantSlug,
    ownerName: `Owner ${uniqueStr}`,
    ownerPhone: '01000000000',
    ownerEmail: `owner${uniqueStr}@test.com`,
    activityType: 'retail',
    username: ownerUsername,
    password: ownerPassword,
    days: 14,
  };

  const tenantRes = await saasAdmin.post('/api/saas-admin/tenants/trial', createTenantPayload);
  assert.ok(
    tenantRes.tenant && tenantRes.tenant.id,
    `Tenant should be created. Response: ${JSON.stringify(tenantRes)}`,
  );
  assert.strictEqual(tenantRes.tenant.status, 'trial');
  const tenantId = tenantRes.tenant.id;
  let deleted = false;
  try {
    // 5. Login as the new owner
    console.log(`Logging in as new tenant owner: ${ownerUsername}...`);
    await newTenantOwner.login(ownerUsername, ownerPassword);

    // 6. Verify Owner access to own tenant data
    const profile = await newTenantOwner.get('/api/auth/me');
    assert.strictEqual(profile.user.tenantId, tenantId, 'Owner should belong to the new tenant');
    assert.strictEqual(profile.user.role, 'admin');
    const saasAdminCheck = await newTenantOwner.get('/api/saas-admin/tenants', 403);
    assert.strictEqual(saasAdminCheck.statusCode, 403);

    // Verify the new tenant can operate within its own scope.
    await newTenantOwner.post('/api/categories', { name: 'Tenant Category' });
    const categoriesPayload = await newTenantOwner.get('/api/categories');
    const catId = categoriesPayload.categories[0].id;

    const barcode1 = `B-${Date.now()}`;
    await newTenantOwner.post('/api/products', {
      name: 'Tenant Product',
      categoryId: Number(catId),
      barcode: barcode1,
      costPrice: 10,
      retailPrice: 20,
      wholesalePrice: 15,
      minStock: 0,
      stock: 0,
      units: [
        {
          name: 'قطعة',
          multiplier: 1,
          barcode: barcode1,
          isBaseUnit: true,
          isSaleUnit: true,
          isPurchaseUnit: true,
        },
      ],
    });

    // 7. Extend Trial
    console.log('Extending trial...');
    const extendRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/extend-trial`, {
      days: 7,
    });
    assert.ok(extendRes.ok, 'Extend trial should succeed');

    // 8. Suspend Tenant
    console.log('Suspending tenant...');
    const suspendRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/suspend`, {
      reason: 'Administrative suspension',
    });
    assert.ok(suspendRes.ok);

    // Verify owner cannot perform protected operations
    console.log('Verifying suspended tenant operations...');
    const barcodeFail = `B-FAIL-${Date.now()}`;
    const failProdRes = await newTenantOwner.post(
      '/api/products',
      {
        name: 'Fail Product',
        categoryId: Number(catId),
        barcode: barcodeFail,
        costPrice: 10,
        retailPrice: 20,
        wholesalePrice: 15,
        minStock: 0,
        stock: 0,
        units: [
          {
            name: 'قطعة',
            multiplier: 1,
            barcode: barcodeFail,
            isBaseUnit: true,
            isSaleUnit: true,
            isPurchaseUnit: true,
          },
        ],
      },
      401,
    );
    assert.strictEqual(failProdRes.statusCode, 401);
    assert.ok(
      failProdRes.error.message.includes('غير مصرح') ||
        failProdRes.error.message.includes('suspended') ||
        failProdRes.error.message.includes('Tenant is not active') ||
        failProdRes.error.message.includes('Inactive tenant') ||
        failProdRes.error.message.includes('غير مفعل') ||
        failProdRes.error.message.includes('معلق'),
      'Should reject operation on suspended tenant',
    );

    // 10. Activate Tenant
    console.log('Activating tenant...');
    const plansRes = await saasAdmin.get('/api/saas-admin/plans');
    let planId = plansRes.items?.[0]?.id;
    if (!planId) {
      const planRes = await saasAdmin.post('/api/saas-admin/plans', {
        name: `Pro Plan ${Date.now()}`,
        code: `PRO_${Date.now()}`,
        price: 100,
        billingPeriodMonths: 1,
      });
      planId = planRes.id;
    }

    const activateRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/activate`, {
      planId: planId,
      durationMonths: 1,
    });
    assert.ok(activateRes.ok);

    // Owner should be able to operate again
    await newTenantOwner.login(ownerUsername, ownerPassword);
    const barcodeSucc = `B-SUCC-${Date.now()}`;
    await newTenantOwner.post('/api/products', {
      name: 'Success Product',
      categoryId: Number(catId),
      barcode: barcodeSucc,
      costPrice: 10,
      retailPrice: 20,
      wholesalePrice: 15,
      minStock: 0,
      stock: 0,
      units: [
        {
          name: 'قطعة',
          multiplier: 1,
          barcode: barcodeSucc,
          isBaseUnit: true,
          isSaleUnit: true,
          isPurchaseUnit: true,
        },
      ],
    });

    // 11. Expire Tenant
    console.log('Expiring tenant...');
    const expireRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/expire`, {
      reason: 'Subscription ended',
    });
    assert.ok(expireRes.ok);

    // 12. Renew the tenant lifecycle without exercising payment gateways.
    console.log('Renewing tenant...');
    const renewRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/renew`, {
      planId: planId,
      durationMonths: 1,
    });
    assert.ok(renewRes.ok);

    // Check Timeline
    const timeline = await saasAdmin.get(`/api/saas-admin/tenants/${tenantId}/timeline`);
    assert.ok(timeline.events.length > 0, 'Timeline should have events');

    // Check Subscriptions
    const subscriptions = await saasAdmin.get(`/api/saas-admin/tenants/${tenantId}/subscriptions`);
    assert.ok(subscriptions.subscriptions.length > 0, 'Subscriptions should have records');

    // 13. Delete Tenant (isolated cleanup)
    console.log('Deleting isolated tenant...');
    const deleteRes = await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/delete`, {});
    assert.ok(deleteRes.ok, 'Delete tenant should succeed');
    deleted = true;

    // Ensure owner login fails now
    console.log('Verifying deleted tenant access...');
    try {
      await newTenantOwner.login(ownerUsername, ownerPassword);
      assert.fail('Should not be able to login to a deleted tenant');
    } catch (e: any) {
      assert.ok(e.message.includes('401') || e.message.includes('Login failed'), 'Login should fail');
    }

    console.log('✅ SaaS Lifecycle E2E test passed successfully!');
  } finally {
    if (!deleted) {
      try {
        await saasAdmin.post(`/api/saas-admin/tenants/${tenantId}/delete`, {});
      } catch (cleanupError) {
        console.error('Could not remove the temporary SaaS tenant after test failure:', cleanupError);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
