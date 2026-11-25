import { E2EClient } from './e2e-utils';
import assert from 'node:assert/strict';

async function main() {
  const admin = new E2EClient();
  await admin.login(process.env.TEST_USER || 'dev', process.env.TEST_PASSWORD || '1');

  const clientB = new E2EClient();
  await clientB.login(process.env.TEST_TENANT2_USER || 't2_admin', process.env.TEST_TENANT2_PASSWORD || '1');

  const limitedUser = new E2EClient();
  const username = `lim_usr_${Date.now()}`;
  const password = `Pass123456!`;

  console.log('\n--- Testing User Creation ---');
  let userId: number;
  try {
    const res = await admin.post(
      '/api/users',
      {
        username,
        password,
        role: 'cashier',
        permissions: ['sales'],
        isActive: true,
        name: 'Limited User',
      },
      201,
    );

    // Fetch user list to get ID
    const users = await admin.get('/api/users');
    const user = (users.users || users.data || users).find((u: any) => u.username === username);
    assert.ok(user, 'User should be created');
    userId = Number(user.id);
    console.log('✅ Admin created limited user successfully');
  } catch (e) {
    console.error('❌ Failed to create limited user', e);
    process.exit(1);
  }

  console.log('\n--- Testing Login & Allowed Operations ---');
  try {
    await limitedUser.login(username, password);
    const me = await limitedUser.get('/api/auth/me');
    assert.equal(me.user.username, username);
    assert.ok(me.user.permissions.includes('sales'));

    // Allowed operation
    await limitedUser.get('/api/catalog/pos-products?limit=1');
    console.log('✅ Limited user logged in and performed allowed operation');
  } catch (e) {
    console.error('❌ Failed login or allowed operation', e);
    process.exit(1);
  }

  console.log('\n--- Testing Disallowed Operations ---');
  try {
    // Missing 'products' permission
    await limitedUser.get('/api/products', 403).catch((e) => {
      if (!e.message.includes('403')) throw e;
    });
    console.log('✅ Disallowed operation returned 403');
  } catch (e) {
    console.error('❌ Disallowed operation check failed', e);
    process.exit(1);
  }

  console.log('\n--- Testing Lack of User Management & Elevation ---');
  try {
    // Try to create a user
    await limitedUser
      .post(
        '/api/users',
        {
          username: `hacker_${Date.now()}`,
          password: 'Password1!',
          role: 'admin',
          permissions: ['canManageUsers'],
        },
        403,
      )
      .catch((e) => {
        if (!e.message.includes('403')) throw e;
      });

    // Try to elevate own permissions via users endpoint
    await limitedUser
      .put(
        `/api/users/${userId}`,
        {
          username,
          role: 'admin',
          permissions: ['canManageUsers', 'canViewProducts', 'canCreateSales'],
        },
        403,
      )
      .catch((e) => {
        if (!e.message.includes('403') && !e.message.includes('404')) throw e;
      });

    const meAfter = await limitedUser.get('/api/auth/me');
    assert.ok(!meAfter.user.permissions.includes('canManageUsers'), 'User should not have elevated permissions');
    console.log('✅ User cannot create users or elevate their own permissions');
  } catch (e) {
    console.error('❌ User management/elevation check failed', e);
    process.exit(1);
  }

  console.log('\n--- Testing Tenant Isolation ---');
  try {
    const bUsers = await clientB.get('/api/users');
    const bUserFound = (bUsers.users || bUsers.data || bUsers).find((u: any) => u.username === username);
    assert.ok(!bUserFound, 'Tenant B should not see Tenant A user');

    await clientB
      .put(
        `/api/users/${userId}`,
        {
          username,
          role: 'admin',
          permissions: [],
        },
        403,
      )
      .catch((e) => {
        if (!e.message.includes('403') && !e.message.includes('404')) throw e;
      });
    console.log('✅ Tenant B cannot see or modify Tenant A users');
  } catch (e) {
    console.error('❌ Tenant isolation check failed', e);
    process.exit(1);
  }

  console.log('\n--- Testing Disabled User ---');
  try {
    await admin.put(`/api/users/${userId}`, {
      username,
      role: 'cashier',
      permissions: ['sales'],
      isActive: false,
    });

    // Logout and try to login again
    await limitedUser.post('/api/auth/logout', {});

    await limitedUser.login(username, password).catch((e) => {
      // Should fail
      return e;
    });

    // Test if login actually failed
    const meCheck = await limitedUser.get('/api/auth/me').catch((e) => e);
    assert.ok(
      meCheck.statusCode >= 400 || meCheck.status >= 400 || meCheck.actual >= 400 || meCheck.message?.includes('401'),
      'Login should have failed',
    );
    console.log('✅ Disabled user cannot log in');
  } catch (e) {
    console.error('❌ Disabled user check failed', e);
    process.exit(1);
  }

  console.log('\n🎉 ALL PERMISSION TESTS PASSED!');
}

main().catch((e) => {
  console.error('Fatal Error:', e);
  process.exit(1);
});
