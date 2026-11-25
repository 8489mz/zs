import assert from 'node:assert/strict';
import { E2EClient } from './e2e-utils';

async function main() {
  const saasAdmin = new E2EClient();
  await saasAdmin.login(process.env.ADMIN_USER || 'dev', process.env.ADMIN_PASS || '1');

  // 1. Create Tenant A
  const tenantAStr = `A-${Date.now()}`;
  const ownerA = `owner-a-${tenantAStr}`;
  await saasAdmin.post('/api/saas-admin/tenants/trial', {
    slug: `tenant-a-${tenantAStr}`,
    businessName: 'Business A',
    ownerName: 'Owner A',
    ownerPhone: '01000000001',
    ownerEmail: `owner-a-${tenantAStr}@test.com`,
    activityType: 'retail',
    username: ownerA,
    password: 'Password123!@#',
    days: 14,
  });

  // 2. Create Tenant B
  const tenantBStr = `B-${Date.now()}`;
  const ownerB = `owner-b-${tenantBStr}`;
  await saasAdmin.post('/api/saas-admin/tenants/trial', {
    slug: `tenant-b-${tenantBStr}`,
    businessName: 'Business B',
    ownerName: 'Owner B',
    ownerPhone: '01000000002',
    ownerEmail: `owner-b-${tenantBStr}@test.com`,
    activityType: 'retail',
    username: ownerB,
    password: 'Password123!@#',
    days: 14,
  });

  const clientA = new E2EClient();
  await clientA.login(ownerA, 'Password123!@#');

  const clientB = new E2EClient();
  await clientB.login(ownerB, 'Password123!@#');

  // Populate Tenant A
  await clientA.post('/api/products', {
    name: 'Product A',
    categoryId: null,
    barcode: `BAR-A-${tenantAStr}`,
    costPrice: 10,
    retailPrice: 20,
    wholesalePrice: 15,
    minStock: 0,
    stock: 50,
    units: [
      {
        name: 'Piece',
        multiplier: 1,
        barcode: `BAR-A-${tenantAStr}`,
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ],
  });

  // Populate Tenant B
  await clientB.post('/api/products', {
    name: 'Product B',
    categoryId: null,
    barcode: `BAR-B-${tenantBStr}`,
    costPrice: 5,
    retailPrice: 10,
    wholesalePrice: 8,
    minStock: 0,
    stock: 20,
    units: [
      {
        name: 'Piece',
        multiplier: 1,
        barcode: `BAR-B-${tenantBStr}`,
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ],
  });

  // Export Backup from A
  const headersA = new Headers();
  const cookieA = (clientA as any).cookieHeader();
  if (cookieA) headersA.set('Cookie', cookieA);

  console.log('Exporting backup for Tenant A...');
  const backupRes = await fetch(`${(clientA as any).baseUrl}/api/backup`, { headers: headersA });
  assert.equal(backupRes.status, 200, 'Backup exported');
  const backupBlob = await backupRes.blob();

  // Verify Backup by A
  const verifyDataA = new FormData();
  verifyDataA.append('file', backupBlob, 'backup.zip');
  const csrfA = (clientA as any).cookies.get('zs_dev_csrf_token');
  if (csrfA) headersA.set('x-csrf-token', csrfA);

  const verifyResA = await fetch(`${(clientA as any).baseUrl}/api/backup/verify`, {
    method: 'POST',
    headers: headersA,
    body: verifyDataA as any,
  });
  assert.equal(verifyResA.status, 201, 'Verify OK for A');
  const verifyJsonA = await verifyResA.json();
  assert.equal(verifyJsonA.ok, true, 'Verify returned ok');

  // Verify Tenant B cannot read or restore Tenant A's backup
  // Wait, B verifying A's backup is allowed? Verification doesn't check ownership, it checks format.
  // But Restoration checks tenant ownership or just restores data? Let's check!
  const headersB = new Headers();
  const cookieB = (clientB as any).cookieHeader();
  if (cookieB) headersB.set('Cookie', cookieB);
  const csrfB = (clientB as any).cookies.get('zs_dev_csrf_token');
  if (csrfB) headersB.set('x-csrf-token', csrfB);

  const restoreDataB = new FormData();
  restoreDataB.append('file', backupBlob, 'backup.zip');
  restoreDataB.append('confirmation', 'RESTORE BACKUP');

  console.log('Tenant B trying to restore Tenant A backup...');
  const restoreResB = await fetch(`${(clientB as any).baseUrl}/api/backup/restore`, {
    method: 'POST',
    headers: headersB,
    body: restoreDataB as any,
  });
  // The system should block it or throw, or maybe it replaces B's data?
  // Let's see what happens.

  console.log('Restore by B status:', restoreResB.status);

  // Now Dry Run Restore by A
  const restoreDataA = new FormData();
  restoreDataA.append('file', backupBlob, 'backup.zip');
  restoreDataA.append('confirmation', 'RESTORE BACKUP');

  console.log('Tenant A Dry Run Restore...');
  const dryRunRes = await fetch(`${(clientA as any).baseUrl}/api/backup/restore?dryRun=true`, {
    method: 'POST',
    headers: headersA,
    body: restoreDataA as any,
  });
  assert.equal(dryRunRes.status, 201, 'Dry Run OK');
  const dryRunJson = await dryRunRes.json();
  assert.equal(dryRunJson.dryRun, true, 'Dry Run flag is true');

  // Add some data to A before restore
  await clientA.post('/api/products', {
    name: 'Product A Temp',
    categoryId: null,
    barcode: `BAR-A-TEMP`,
    costPrice: 1,
    retailPrice: 2,
    wholesalePrice: 1,
    minStock: 0,
    stock: 0,
    units: [
      { name: 'Piece', multiplier: 1, barcode: `BAR-A-TEMP`, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true },
    ],
  });

  // Actual Restore by A
  console.log('Tenant A Actual Restore...');
  // Need new FormData because FormData is consumed
  const actualRestoreDataA = new FormData();
  actualRestoreDataA.append('file', backupBlob, 'backup.zip');
  actualRestoreDataA.append('confirmation', 'RESTORE BACKUP');

  const actualRestoreRes = await fetch(`${(clientA as any).baseUrl}/api/backup/restore`, {
    method: 'POST',
    headers: headersA,
    body: actualRestoreDataA as any,
  });
  assert.equal(actualRestoreRes.status, 201, 'Actual Restore OK');

  // Verify A's data is exactly what was backed up (Product A exists, Temp doesn't)
  const productsAfterRestore = await clientA.get('/api/products');

  const productsArrayA = Array.isArray(productsAfterRestore)
    ? productsAfterRestore
    : (productsAfterRestore as any).products ||
      (productsAfterRestore as any).items ||
      (productsAfterRestore as any).data ||
      [];
  const barcodesA = productsArrayA.map((p: any) => p.barcode);
  assert.ok(barcodesA.includes(`BAR-A-${tenantAStr}`), 'Product A still exists');
  assert.ok(!barcodesA.includes(`BAR-A-TEMP`), 'Temp Product is gone');

  // Verify B's data is untouched
  const productsB = await clientB.get('/api/products');
  const productsArrayB = Array.isArray(productsB)
    ? productsB
    : (productsB as any).products || (productsB as any).items || (productsB as any).data || [];
  const barcodesB = productsArrayB.map((p: any) => p.barcode);
  assert.ok(barcodesB.includes(`BAR-B-${tenantBStr}`), 'Product B still exists');
  assert.ok(!barcodesB.includes(`BAR-A-${tenantAStr}`), 'Product A did not leak to B');

  // Verify non-admin cannot restore
  const cashierA = new E2EClient();
  await cashierA.login(ownerA, 'Password123!@#');
  // wait, owner is super_admin. Let's create a cashier for A
  await clientA.post('/api/users', {
    username: `cashier-a-${tenantAStr}`,
    password: 'Password123!@#',
    role: 'cashier',
  });
  await cashierA.login(`cashier-a-${tenantAStr}`, 'Password123!@#');

  const headersCashier = new Headers();
  const cookieCashier = (cashierA as any).cookieHeader();
  if (cookieCashier) headersCashier.set('Cookie', cookieCashier);
  const csrfCashier = (cashierA as any).cookies.get('zs_dev_csrf_token');
  if (csrfCashier) headersCashier.set('x-csrf-token', csrfCashier);

  const cashierRestoreData = new FormData();
  cashierRestoreData.append('file', backupBlob, 'backup.zip');
  cashierRestoreData.append('confirmation', 'RESTORE BACKUP');

  const cashierRestoreRes = await fetch(`${(cashierA as any).baseUrl}/api/backup/restore`, {
    method: 'POST',
    headers: headersCashier,
    body: cashierRestoreData as any,
  });
  assert.equal(cashierRestoreRes.status, 403, 'Cashier should get 403 for restore');

  // Corrupted File
  console.log('Testing corrupted file restore...');
  const corruptedBlob = new Blob(['this is not a zip file'], { type: 'application/zip' });
  const corruptedData = new FormData();
  corruptedData.append('file', corruptedBlob, 'corrupted.zip');
  corruptedData.append('confirmation', 'RESTORE BACKUP');

  const corruptedRes = await fetch(`${(clientA as any).baseUrl}/api/backup/restore`, {
    method: 'POST',
    headers: headersA,
    body: corruptedData as any,
  });
  assert.ok(corruptedRes.status >= 400, 'Corrupted file should be rejected');

  console.log('✅ Backup Restore Advanced E2E test passed!');
}

main().catch((error) => {
  console.error('Test Failed:', error);
  process.exit(1);
});
