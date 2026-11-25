import assert from 'node:assert/strict';
import {
  validatePackageHierarchy,
  calculatePackageGrossWeight,
  flattenPackageContents,
  validateUnpackAction,
  type PackageHierarchyNode,
} from '../src/modules/inventory/engines/package-barcode.engine';

console.log('--- Starting Package Barcode Engine Tests ---');

// Test 1: Hierarchy Validation
{
  const validPalletToBox = validatePackageHierarchy('pallet', 'box');
  assert.equal(validPalletToBox.valid, true, 'Pallet should be able to contain boxes');

  const validPalletToCrate = validatePackageHierarchy('pallet', 'crate');
  assert.equal(validPalletToCrate.valid, true, 'Pallet should be able to contain crates');

  const invalidBoxToPallet = validatePackageHierarchy('box', 'pallet');
  assert.equal(invalidBoxToPallet.valid, false, 'Box cannot contain a pallet');
  assert.ok(invalidBoxToPallet.reason?.includes('لا يمكن تعبئة'));

  console.log('✓ Test 1 Passed: Package hierarchy constraints strictly enforced');
}

// Test 2: Weight Calculation
{
  const tareWeight = 15.0; // 15kg pallet tare
  const directItems = [
    { quantity: 10, unitWeightKg: 0.5 }, // 5kg
    { quantity: 2, unitWeightKg: 2.5 }, // 5kg
  ];
  const childGrossWeights = [25.0, 30.5]; // 55.5kg

  const gross = calculatePackageGrossWeight(tareWeight, directItems, childGrossWeights);
  // 15 + 5 + 5 + 55.5 = 80.5
  assert.equal(gross, 80.5);

  console.log('✓ Test 2 Passed: Gross weight accurately aggregates tare, items, and children');
}

// Test 3: Recursive Hierarchy Tree Flattening
{
  const palletTree: PackageHierarchyNode = {
    id: 'pkg_pallet_1',
    packageNumber: 'PAL-260930-0001',
    packageType: 'pallet',
    status: 'sealed',
    items: [{ productId: 101, productName: 'Loose Cable', quantity: 5, unitName: 'متر' }],
    children: [
      {
        id: 'pkg_box_1',
        packageNumber: 'BOX-260930-0001',
        packageType: 'box',
        status: 'sealed',
        items: [
          { productId: 101, productName: 'Loose Cable', quantity: 20, unitName: 'متر' },
          { productId: 202, productName: 'Router AC1200', quantity: 10, unitName: 'قطعة' },
        ],
      },
      {
        id: 'pkg_box_2',
        packageNumber: 'BOX-260930-0002',
        packageType: 'box',
        status: 'sealed',
        items: [
          { productId: 202, productName: 'Router AC1200', quantity: 15, unitName: 'قطعة' },
          { productId: 303, productName: 'Power Adapter', quantity: 50, unitName: 'قطعة' },
        ],
      },
    ],
  };

  const flattened = flattenPackageContents(palletTree);
  assert.equal(flattened.length, 3, 'Should have exactly 3 unique products');

  const p101 = flattened.find((f) => f.productId === 101);
  const p202 = flattened.find((f) => f.productId === 202);
  const p303 = flattened.find((f) => f.productId === 303);

  assert.equal(p101?.totalQuantity, 25, 'Product 101 total: 5 on pallet + 20 in box 1 = 25');
  assert.equal(p202?.totalQuantity, 25, 'Product 202 total: 10 in box 1 + 15 in box 2 = 25');
  assert.equal(p303?.totalQuantity, 50, 'Product 303 total: 50 in box 2');

  console.log('✓ Test 3 Passed: Recursive tree traversal correctly aggregates nested quantities');
}

// Test 4: Unpack Action Validation
{
  const openAllowed = validateUnpackAction('sealed', 'unpack_all');
  assert.equal(openAllowed.allowed, true);

  const shippedBlocked = validateUnpackAction('shipped', 'unpack_all');
  assert.equal(shippedBlocked.allowed, false);
  assert.ok(shippedBlocked.reason?.includes('شحنه'));

  const consumedBlocked = validateUnpackAction('consumed', 'remove_item');
  assert.equal(consumedBlocked.allowed, false);

  console.log('✓ Test 4 Passed: Unpack safety guards block shipped and consumed packages');
}

console.log('\nAll 4 Package Barcode Engine tests passed with 100% precision.');
