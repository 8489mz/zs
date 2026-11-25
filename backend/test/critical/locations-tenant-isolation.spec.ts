import { strict as assert } from 'node:assert';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

// We will mock the database and capture the queries sent to it.
const capturedWhereClauses: any[][] = [];

const mockDb: any = {
  selectFrom: (table: string) => mockQueryBuilder,
  updateTable: (table: string) => mockQueryBuilder,
  insertInto: (table: string) => mockQueryBuilder,
  deleteFrom: (table: string) => mockQueryBuilder,
};

const mockQueryBuilder: any = {
  select: () => mockQueryBuilder,
  selectAll: () => mockQueryBuilder,
  leftJoin: () => mockQueryBuilder,
  where: (...args: any[]) => {
    capturedWhereClauses.push(args);
    return mockQueryBuilder;
  },
  orderBy: () => mockQueryBuilder,
  set: () => mockQueryBuilder,
  values: () => mockQueryBuilder,
  returning: () => mockQueryBuilder,
  execute: async () => [],
  executeTakeFirst: async () => ({ id: 1, is_active: true, total_qty: 0 }),
  executeTakeFirstOrThrow: async () => ({ id: 1, is_active: true, count: 0 }),
};

// Dummy audit service
const mockAudit: any = {
  log: async () => {},
};

const mockAuthCache: any = {
  invalidateTenant: () => {},
  getTenantPayload: () => null,
  setTenantPayload: () => {},
};

async function runTenantIsolationTest() {
  console.log('Running SettingsService Locations Tenant Isolation Test...');
  const settingsService = new SettingsService(mockDb, mockAudit, mockAuthCache);

  const actor: AuthContext = {
    userId: 99,
    tenantId: 'secure-tenant-123',
    accountId: 'secure-account-123',
    username: 'tester',
    role: 'admin',
    permissions: [],
    sessionId: 'mock-session-id',
  };

  // 1. Test List Locations
  capturedWhereClauses.length = 0;
  await settingsService.listLocations(actor);
  let hasTenantPredicate = false;
  for (const args of capturedWhereClauses) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0].toOperationNode) {
      const node = args[0].toOperationNode();
      const sqlNodeString = JSON.stringify(node);
      if (sqlNodeString.includes('secure-tenant-123') && sqlNodeString.includes('secure-account-123')) {
        hasTenantPredicate = true;
      }
    }
  }
  assert.ok(hasTenantPredicate, 'listLocations must apply tenantPredicate for tenant_id = secure-tenant-123');

  // 2. Test Update Location
  capturedWhereClauses.length = 0;
  await settingsService.updateLocation(14, { name: 'Test', locationType: 'branch_stock', branchId: 1 }, actor);
  hasTenantPredicate = false;
  for (const args of capturedWhereClauses) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0].toOperationNode) {
      const node = args[0].toOperationNode();
      const sqlNodeString = JSON.stringify(node);
      if (sqlNodeString.includes('secure-tenant-123')) {
        hasTenantPredicate = true;
      }
    }
  }
  assert.ok(hasTenantPredicate, 'updateLocation must apply tenantPredicate for tenant_id = secure-tenant-123');

  // 3. Test Delete Location
  capturedWhereClauses.length = 0;
  let errorThrown = false;
  try {
    await settingsService.deleteLocation(15, actor);
  } catch (e: any) {
    if (e.code === 'LOCATION_IS_DEFAULT_FOR_BRANCH') {
      errorThrown = true;
    } else {
      throw e;
    }
  }
  assert.ok(errorThrown, 'deleteLocation must throw an error when deleting a default stock location');
  hasTenantPredicate = false;
  for (const args of capturedWhereClauses) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0].toOperationNode) {
      const node = args[0].toOperationNode();
      const sqlNodeString = JSON.stringify(node);
      if (sqlNodeString.includes('secure-tenant-123')) {
        hasTenantPredicate = true;
      }
    }
  }
  assert.ok(hasTenantPredicate, 'deleteLocation must apply tenantPredicate for tenant_id = secure-tenant-123');

  console.log(
    'locations-tenant-isolation.spec: ok (Locations operations are strictly isolated per tenant and account)',
  );

  // 4. Test Preserve Location Type
  // mock DB executeTakeFirst is set to return { id: 1, is_active: true, total_qty: 0 } which in updateLocation will be used as location
  // We can mock executeTakeFirst to return a branch_stock location.
  mockQueryBuilder.executeTakeFirst = async () => ({ id: 1, is_active: true, location_type: 'branch_stock' });

  let setArguments: any = null;
  mockQueryBuilder.set = (args: any) => {
    setArguments = args;
    return mockQueryBuilder;
  };

  await settingsService.updateLocation(14, { name: 'New Name', branchId: 1 }, actor);
  assert.equal(
    setArguments.location_type,
    'branch_stock',
    'updateLocation must preserve location_type when not provided',
  );

  console.log('locations-tenant-isolation.spec: ok (locationType is preserved correctly)');

  // 5. Test createLocation Validation
  let errorObj: any;

  try {
    await settingsService.createLocation({ name: 'Test', locationType: 'in_transit' }, actor);
  } catch (err) {
    errorObj = err;
  }
  assert.equal(errorObj?.code, 'INVALID_LOCATION_TYPE', 'createLocation should reject in_transit');

  errorObj = null;
  try {
    await settingsService.createLocation({ name: 'Test', locationType: 'branch_stock' }, actor);
  } catch (err) {
    errorObj = err;
  }
  assert.equal(
    errorObj?.code,
    'BRANCH_REQUIRED_FOR_BRANCH_STOCK',
    'createLocation should reject branch_stock without branchId',
  );

  errorObj = null;
  try {
    await settingsService.createLocation({ name: 'Test', locationType: 'magic_box' }, actor);
  } catch (err) {
    errorObj = err;
  }
  assert.equal(errorObj?.code, 'INVALID_LOCATION_TYPE', 'createLocation should reject unknown locationType');

  console.log('locations-tenant-isolation.spec: ok (createLocation validation applied)');
}

runTenantIsolationTest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
