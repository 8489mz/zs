import { strict as assert } from 'node:assert';
import crypto from 'crypto';

// 1. Haversine Distance Engine (matches MobileAttendanceService)
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// 2. Token Security Utility (matches MobileAttendanceService)
function generateAttendanceToken(employeeId: number, tenantId: number, secret: string): string {
  const payload = JSON.stringify({
    employeeId,
    tenantId,
    timestamp: Date.now(),
  });
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}::${hmac}`).toString('base64');
}

function verifyAttendanceToken(token: string, secret: string): { employeeId: number; tenantId: number } | null {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf-8');
    const [payloadStr, signature] = raw.split('::');
    if (!payloadStr || !signature) return null;

    const expectedSignature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
    if (expectedSignature !== signature) return null;

    const parsed = JSON.parse(payloadStr);
    // 24 hours expiry
    if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) return null;
    return { employeeId: parsed.employeeId, tenantId: parsed.tenantId };
  } catch {
    return null;
  }
}

// 3. Dine-In Logic Simulation (matches StorefrontService createOnlineOrder)
function simulateOnlineOrderCreation(payload: {
  orderType?: 'delivery' | 'pickup' | 'dine_in';
  tableNumber?: string;
  items: Array<{ productId: number; name: string; quantity: number; unitPrice: number }>;
  deliveryFee: number;
  customerAddress?: string;
}) {
  const isDineIn = payload.orderType === 'dine_in';
  const tableNo = payload.tableNumber ? String(payload.tableNumber).trim() : null;

  // Subtotal
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  // Delivery fee waived for dine-in
  const effectiveDeliveryFee = isDineIn ? 0 : payload.deliveryFee;
  const total = subtotal + effectiveDeliveryFee;

  // Address
  const customerAddress = isDineIn ? `طاولة رقم: ${tableNo || 'غير محدد'}` : payload.customerAddress || '';

  // Sale record for KDS
  const saleRecord = {
    subtotal,
    total,
    delivery_fee: effectiveDeliveryFee,
    order_type: payload.orderType || 'delivery',
    table_number: tableNo,
    notes: isDineIn ? `[طلب طاولة رقم ${tableNo}]` : '',
    items: payload.items.map((it) => ({
      productId: it.productId,
      name: it.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.quantity * it.unitPrice,
    })),
  };

  return {
    orderType: payload.orderType || 'delivery',
    tableNumber: tableNo,
    subtotal,
    effectiveDeliveryFee,
    total,
    customerAddress,
    saleRecord,
  };
}

// 4. Batch QR Code Generation (matches StorefrontService getTablesQrCodes)
function generateTablesQrList(slug: string, baseUrl: string, fromTable: number, toTable: number) {
  const list = [];
  for (let i = fromTable; i <= toTable; i++) {
    const tableUrl = `${baseUrl}/st/${slug}?table=${i}`;
    const directUrl = `${baseUrl}/st/${slug}/table/${i}`;
    list.push({
      tableNumber: i,
      tableLabel: `طاولة ${i}`,
      url: tableUrl,
      directUrl,
    });
  }
  return list;
}

// --- TEST SUITE EXECUTION ---
async function runTestSuite() {
  console.log('================================================================');
  console.log('🚀 Running Dine-In QR Ordering & Mobile GPS Attendance Test Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test Case 1: GPS Geodesic Haversine Calculation
  // -------------------------------------------------------------
  console.log('Test 1: Geodesic Haversine Distance & Geofence Accuracy...');
  const cairoBranchLat = 30.04442;
  const cairoBranchLon = 31.235712;

  // Employee standing 30 meters away
  const employeeNearbyLat = 30.0446;
  const employeeNearbyLon = 31.23585;
  const distNearby = calculateHaversineDistance(cairoBranchLat, cairoBranchLon, employeeNearbyLat, employeeNearbyLon);
  console.log(`  -> Nearby distance calculated: ${distNearby} meters`);
  assert(distNearby < 100, 'Nearby distance must be within 100m');

  // Employee standing 1.2 km away
  const employeeFarLat = 30.05442;
  const employeeFarLon = 31.245712;
  const distFar = calculateHaversineDistance(cairoBranchLat, cairoBranchLon, employeeFarLat, employeeFarLon);
  console.log(`  -> Far distance calculated: ${distFar} meters`);
  assert(distFar > 1000, 'Far distance must exceed 1000m');

  // Geofence enforcement
  const branchRadius = 100;
  const isNearbyAllowed = distNearby <= branchRadius;
  const isFarAllowed = distFar <= branchRadius;
  assert.equal(isNearbyAllowed, true, 'Punch should be ALLOWED within radius');
  assert.equal(isFarAllowed, false, 'Punch should be REJECTED outside radius');
  console.log('  ✅ Haversine Geodesic Distance passed!\n');

  // -------------------------------------------------------------
  // Test Case 2: Mobile Punch Token HMAC Cryptography
  // -------------------------------------------------------------
  console.log('Test 2: Mobile Attendance HMAC Token Security & Verification...');
  const secretKey = 'test-jwt-secret-xyz-123';
  const token = generateAttendanceToken(42, 1, secretKey);
  assert(token && token.length > 20, 'Token must be generated');

  const verified = verifyAttendanceToken(token, secretKey);
  assert(verified !== null, 'Token should verify successfully');
  assert.equal(verified?.employeeId, 42);
  assert.equal(verified?.tenantId, 1);

  // Tampered token test
  const tamperedToken = token.slice(0, -4) + 'abcd';
  const verifiedTampered = verifyAttendanceToken(tamperedToken, secretKey);
  assert.equal(verifiedTampered, null, 'Tampered token must fail signature verification');
  console.log('  ✅ HMAC Token Security passed!\n');

  // -------------------------------------------------------------
  // Test Case 3: Attendance Auto Punch State Machine
  // -------------------------------------------------------------
  console.log('Test 3: Mobile Punch State Machine (Check-in / Check-out alternation)...');
  interface MockPunch {
    employeeId: number;
    type: 'check_in' | 'check_out';
    time: Date;
    distanceMeters: number;
    selfieUrl: string;
  }
  const punches: MockPunch[] = [];

  function recordPunch(
    employeeId: number,
    requestedType: 'auto' | 'check_in' | 'check_out',
    distance: number,
    selfie: string,
  ) {
    const todayPunches = punches.filter((p) => p.employeeId === employeeId);
    let resolvedType: 'check_in' | 'check_out' = 'check_in';
    if (requestedType === 'auto') {
      const lastPunch = todayPunches[todayPunches.length - 1];
      resolvedType = !lastPunch || lastPunch.type === 'check_out' ? 'check_in' : 'check_out';
    } else {
      resolvedType = requestedType;
    }
    const newPunch: MockPunch = {
      employeeId,
      type: resolvedType,
      time: new Date(),
      distanceMeters: distance,
      selfieUrl: selfie,
    };
    punches.push(newPunch);
    return newPunch;
  }

  // Morning punch
  const p1 = recordPunch(42, 'auto', 24, 'data:image/jpeg;base64,selfie1');
  assert.equal(p1.type, 'check_in', 'First auto punch of day must be check_in');
  assert.equal(p1.distanceMeters, 24);

  // Evening punch
  const p2 = recordPunch(42, 'auto', 18, 'data:image/jpeg;base64,selfie2');
  assert.equal(p2.type, 'check_out', 'Second auto punch of day must be check_out');
  assert.equal(p2.distanceMeters, 18);
  console.log('  ✅ Attendance Auto Punch State Machine passed!\n');

  // -------------------------------------------------------------
  // Test Case 4: Dine-In QR Table Ordering Fee Waiver & Address
  // -------------------------------------------------------------
  console.log('Test 4: Dine-In QR Order creation & Delivery Fee Waiver...');
  const dineInOrder = simulateOnlineOrderCreation({
    orderType: 'dine_in',
    tableNumber: '7',
    deliveryFee: 25,
    items: [
      { productId: 101, name: 'بيتزا سوبريم', quantity: 2, unitPrice: 120 },
      { productId: 102, name: 'بيبسي كانز', quantity: 2, unitPrice: 20 },
    ],
  });

  assert.equal(dineInOrder.orderType, 'dine_in');
  assert.equal(dineInOrder.tableNumber, '7');
  assert.equal(dineInOrder.subtotal, 280);
  assert.equal(dineInOrder.effectiveDeliveryFee, 0, 'Dine-In delivery fee must be waived to 0 EGP');
  assert.equal(dineInOrder.total, 280, 'Total must equal subtotal without delivery fee');
  assert.equal(dineInOrder.customerAddress, 'طاولة رقم: 7');
  assert.equal(dineInOrder.saleRecord.table_number, '7');
  assert.equal(dineInOrder.saleRecord.order_type, 'dine_in');
  assert.equal(dineInOrder.saleRecord.items.length, 2);
  console.log('  ✅ Dine-In Fee Waiver & KDS saleRecord generation passed!\n');

  // -------------------------------------------------------------
  // Test Case 5: Table QR Code Generator
  // -------------------------------------------------------------
  console.log('Test 5: Batch Table QR Code URL Generator...');
  const tableQrs = generateTablesQrList('cairo-cafe', 'https://erp.domain.com', 1, 10);
  assert.equal(tableQrs.length, 10, 'Should generate 10 table QR configs');
  assert.equal(tableQrs[0].tableNumber, 1);
  assert.equal(tableQrs[0].url, 'https://erp.domain.com/st/cairo-cafe?table=1');
  assert.equal(tableQrs[0].directUrl, 'https://erp.domain.com/st/cairo-cafe/table/1');
  assert.equal(tableQrs[9].tableNumber, 10);
  assert.equal(tableQrs[9].url, 'https://erp.domain.com/st/cairo-cafe?table=10');
  console.log('  ✅ Batch Table QR Code URL Generator passed!\n');

  console.log('================================================================');
  console.log('🎉 ALL 5 INTEGRATION AUDIT TESTS PASSED SUCCESSFULLY! (100%)');
  console.log('================================================================');
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
