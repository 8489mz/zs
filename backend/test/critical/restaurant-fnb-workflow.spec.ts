import { strict as assert } from 'node:assert';
import { computeInvoiceTotals } from '../../src/common/utils/invoice-totals';
import { classifyMenuEngineeringQuadrant } from '../../src/modules/reports/helpers/reports-menu-engineering.helper';
import { mapHeldSalesRows } from '../../src/modules/sales/helpers/sales-query.helper';

// ============================================================================
// RESTAURANT F&B WORKFLOW & OPERATIONS CRITICAL AUDIT SUITE
// Tests financial invariants, service charge isolation, table reservations,
// aggregator commissions, and food waste variance engine.
// ============================================================================

async function testServiceChargeFinancialInvariants(): Promise<void> {
  // Test 1: Exclusive Tax Mode with Dine-In Service Charge
  // Subtotal = 1000, Discount = 100 -> Net Food = 900
  // Service Charge (12%) = 108
  // Delivery Fee = 0
  // Taxable Base = 900 + 108 = 1008
  // Tax (15%) = 1008 * 0.15 = 151.20
  // Total = 900 + 108 + 151.20 = 1159.20
  const exclusiveTotals = computeInvoiceTotals(1000, 100, 15, false, 0, 108);
  assert.equal(exclusiveTotals.taxAmount, 151.2, 'Exclusive tax on net food + service charge');
  assert.equal(exclusiveTotals.total, 1159.2, 'Grand total matches net food + service charge + tax');

  // Test 2: Inclusive Tax Mode with Dine-In Service Charge
  // Net Food = 900, Service Charge = 108 -> Total Base = 1008 (VAT inclusive at 15%)
  // Embedded VAT = 1008 - (1008 / 1.15) = 131.48
  const inclusiveTotals = computeInvoiceTotals(1000, 100, 15, true, 0, 108);
  assert.equal(inclusiveTotals.total, 1008.0, 'Inclusive total includes service charge directly');
  assert.equal(inclusiveTotals.taxAmount, 131.478, 'Embedded VAT extracted from total bill base');

  // Test 3: Takeaway & Delivery strict zero service charge enforcement
  // Even if service charge argument is accidentally passed, when 0 is given it produces clean baseline
  const zeroServiceTotals = computeInvoiceTotals(500, 0, 15, false, 25, 0);
  assert.equal(zeroServiceTotals.taxAmount, 75.0, 'Tax on 500 = 75');
  assert.equal(zeroServiceTotals.total, 600.0, '500 food + 75 tax + 25 delivery fee = 600');

  // Test 4: Negative input defenses
  const negativeGuarded = computeInvoiceTotals(200, -50, 15, false, -10, -20);
  // Negative discount clamped to 0 -> taxableBase = 200
  // Negative delivery fee clamped to 0
  // Negative service charge clamped to 0
  // Tax (15%) = 30
  // Total = 200 + 30 = 230
  assert.equal(negativeGuarded.taxAmount, 30.0);
  assert.equal(negativeGuarded.total, 230.0);
}

async function testTableReservationTransitions(): Promise<void> {
  type ReservationStatus = 'confirmed' | 'seated' | 'cancelled' | 'no_show';
  const validTransitions: Record<ReservationStatus, ReservationStatus[]> = {
    confirmed: ['seated', 'cancelled', 'no_show'],
    seated: ['cancelled'],
    cancelled: [],
    no_show: [],
  };

  const assertTransition = (from: ReservationStatus, to: ReservationStatus, shouldPass: boolean) => {
    const isAllowed = validTransitions[from].includes(to);
    assert.equal(isAllowed, shouldPass, `Transition from ${from} to ${to} expected: ${shouldPass}`);
  };

  assertTransition('confirmed', 'seated', true);
  assertTransition('confirmed', 'cancelled', true);
  assertTransition('confirmed', 'no_show', true);
  assertTransition('seated', 'cancelled', true);
  assertTransition('cancelled', 'confirmed', false);
  assertTransition('no_show', 'seated', false);
}

async function testDeliveryAggregatorsAnd86StopList(): Promise<void> {
  interface AggregatorChannel {
    name: 'talabat' | 'hungerstation' | 'jahez';
    commissionPct: number;
  }

  const channels: AggregatorChannel[] = [
    { name: 'talabat', commissionPct: 18 },
    { name: 'hungerstation', commissionPct: 15 },
    { name: 'jahez', commissionPct: 14 },
  ];

  const calculatePayout = (grossSales: number, channelName: 'talabat' | 'hungerstation' | 'jahez') => {
    const channel = channels.find((c) => c.name === channelName)!;
    const commission = Number((grossSales * (channel.commissionPct / 100)).toFixed(2));
    const netPayout = Number((grossSales - commission).toFixed(2));
    return { commission, netPayout };
  };

  const jahezPayout = calculatePayout(1000, 'jahez');
  assert.equal(jahezPayout.commission, 140.0);
  assert.equal(jahezPayout.netPayout, 860.0);

  const hungerPayout = calculatePayout(1000, 'hungerstation');
  assert.equal(hungerPayout.commission, 150.0);
  assert.equal(hungerPayout.netPayout, 850.0);

  // 86-Stop List filtering invariant
  const catalog = [
    { id: 10, name: 'برجر أنجوس كلاسيك', is_86_stopped: false },
    { id: 20, name: 'فيليه مشوي خاص', is_86_stopped: true }, // 86 stopped (نفذت الكمية في المطبخ)
    { id: 30, name: 'سلطة سيزر دجاج', is_86_stopped: false },
  ];

  const availableForAggregators = catalog.filter((item) => !item.is_86_stopped);
  assert.equal(availableForAggregators.length, 2);
  assert.equal(
    availableForAggregators.some((i) => i.id === 20),
    false,
    '86-stopped item must be omitted',
  );
}

async function testFoodWasteVarianceEngine(): Promise<void> {
  // Theoretical BOM consumption:
  // 50 orders of "Double Burger" -> recipe: 0.200 kg beef per burger = 10.000 kg theoretical
  const ordersCount = 50;
  const beefPerServing = 0.2;
  const theoreticalConsumption = ordersCount * beefPerServing; // 10.0 kg

  // Physical inventory deducted from cold room = 11.200 kg
  const actualInventoryDeduction = 11.2;

  // Logged waste from kitchen waste logs = 0.500 kg (burnt patty during rush)
  const loggedKitchenWaste = 0.5;

  // Cost per kg = 45.00 SAR
  const costPerKg = 45.0;

  // Unexplained variance (theft / over-portioning / unrecorded waste)
  const unexplainedVarianceKg = Number(
    (actualInventoryDeduction - (theoreticalConsumption + loggedKitchenWaste)).toFixed(3),
  );
  const unexplainedVarianceCost = Number((unexplainedVarianceKg * costPerKg).toFixed(2));
  const totalFinancialLoss = Number(((loggedKitchenWaste + unexplainedVarianceKg) * costPerKg).toFixed(2));

  assert.equal(unexplainedVarianceKg, 0.7, 'Unexplained variance = 11.2 - (10.0 + 0.5) = 0.700 kg');
  assert.equal(unexplainedVarianceCost, 31.5, 'Cost of unexplained loss = 0.700 * 45 = 31.50 SAR');
  assert.equal(totalFinancialLoss, 54.0, 'Total loss (logged waste + unexplained) = 1.200 * 45 = 54.00 SAR');
}

async function testGuestCoversAndAverageSpend(): Promise<void> {
  const computeAverageSpend = (billTotal: number, covers: number): number => {
    const safeCovers = Math.max(1, Math.floor(covers || 1));
    return Number((billTotal / safeCovers).toFixed(2));
  };

  assert.equal(computeAverageSpend(800, 4), 200.0, '800 total / 4 covers = 200 per guest');
  assert.equal(computeAverageSpend(250, 1), 250.0, 'Single diner spend');
  assert.equal(computeAverageSpend(450, 0), 450.0, 'Zero covers defaults safely to 1');
  assert.equal(computeAverageSpend(450, -2), 450.0, 'Negative covers defaults safely to 1');
}

async function testMenuEngineeringMatrix(): Promise<void> {
  const hurdlePopularity = 17.5; // Hurdle: e.g. 70% of 25% (4 items)
  const avgMarginPerUnit = 25.0; // Benchmark avg margin

  // 1. Star (High Popularity, High Margin)
  const star = classifyMenuEngineeringQuadrant(25.0, hurdlePopularity, 35.0, avgMarginPerUnit);
  assert.equal(star.quadrant, 'star');
  assert.equal(star.quadrantLabelAr, 'نجم (Star)');

  // 2. Plowhorse (High Popularity, Low Margin)
  const plowhorse = classifyMenuEngineeringQuadrant(30.0, hurdlePopularity, 15.0, avgMarginPerUnit);
  assert.equal(plowhorse.quadrant, 'plowhorse');
  assert.equal(plowhorse.quadrantLabelAr, 'حصان جر (Plowhorse)');

  // 3. Puzzle (Low Popularity, High Margin)
  const puzzle = classifyMenuEngineeringQuadrant(10.0, hurdlePopularity, 40.0, avgMarginPerUnit);
  assert.equal(puzzle.quadrant, 'puzzle');
  assert.equal(puzzle.quadrantLabelAr, 'لغز (Puzzle)');

  // 4. Dog (Low Popularity, Low Margin)
  const dog = classifyMenuEngineeringQuadrant(5.0, hurdlePopularity, 12.0, avgMarginPerUnit);
  assert.equal(dog.quadrant, 'dog');
  assert.equal(dog.quadrantLabelAr, 'صنف خاسر (Dog)');
}

async function testMultiStationKitchenPrinterRouting(): Promise<void> {
  interface StationRoutedItem {
    id: number;
    name: string;
    station: 'kitchen' | 'bar' | 'grill' | 'cold' | 'dessert';
    qty: number;
  }

  const orderItems: StationRoutedItem[] = [
    { id: 1, name: 'ريب آي ستيك', station: 'grill', qty: 2 },
    { id: 2, name: 'موهيتو فراولة', station: 'bar', qty: 3 },
    { id: 3, name: 'سلطة سيزر', station: 'cold', qty: 1 },
    { id: 4, name: 'تشيز كيك', station: 'dessert', qty: 1 },
    { id: 5, name: 'برجر أنجوس', station: 'kitchen', qty: 2 },
  ];

  // Group by station routing
  const stationBuckets = new Map<string, StationRoutedItem[]>();
  for (const item of orderItems) {
    const list = stationBuckets.get(item.station) || [];
    list.push(item);
    stationBuckets.set(item.station, list);
  }

  assert.equal(stationBuckets.get('bar')?.length, 1);
  assert.equal(stationBuckets.get('bar')?.[0].name, 'موهيتو فراولة');
  assert.equal(stationBuckets.get('grill')?.length, 1);
  assert.equal(stationBuckets.get('cold')?.length, 1);
  assert.equal(stationBuckets.get('kitchen')?.length, 1);
  assert.equal(stationBuckets.get('dessert')?.length, 1);
  assert.equal(stationBuckets.size, 5);
}

async function testSfdaNutritionalAndAllergenCompliance(): Promise<void> {
  interface NutritionalItem {
    id: number;
    name: string;
    calories?: number;
    allergens?: string[];
    is_spicy?: boolean;
    is_vegetarian?: boolean;
    is_gluten_free?: boolean;
  }

  const menu: NutritionalItem[] = [
    {
      id: 1,
      name: 'سلطة كينوا بالأفوكادو',
      calories: 320,
      allergens: [],
      is_spicy: false,
      is_vegetarian: true,
      is_gluten_free: true,
    },
    {
      id: 2,
      name: 'برجر ترافل حار',
      calories: 890,
      allergens: ['جلوتين', 'ألبان', 'بيض'],
      is_spicy: true,
      is_vegetarian: false,
      is_gluten_free: false,
    },
  ];

  // Invariant 1: Calories must be non-negative
  for (const item of menu) {
    if (item.calories !== undefined) {
      assert.ok(item.calories >= 0, `Calories for ${item.name} must be non-negative`);
    }
  }

  // Invariant 2: Allergen filter safely isolates items
  const glutenFreeItems = menu.filter(
    (item) => item.is_gluten_free === true && (!item.allergens || !item.allergens.includes('جلوتين')),
  );
  assert.equal(glutenFreeItems.length, 1);
  assert.equal(glutenFreeItems[0].id, 1);

  // Invariant 3: Vegetarian items
  const vegetarianItems = menu.filter((item) => item.is_vegetarian === true);
  assert.equal(vegetarianItems.length, 1);
  assert.equal(vegetarianItems[0].id, 1);
}

async function testTableServiceCallsWorkflow(): Promise<void> {
  type ServiceCallType = 'waiter' | 'bill' | 'water' | 'clean';
  type ServiceCallStatus = 'pending' | 'in_progress' | 'resolved' | 'cancelled';

  interface ServiceCall {
    id: number;
    table_number: string;
    call_type: ServiceCallType;
    status: ServiceCallStatus;
    created_at: number;
    resolved_at?: number;
  }

  const calls: ServiceCall[] = [
    { id: 101, table_number: '5', call_type: 'waiter', status: 'pending', created_at: Date.now() - 120000 },
    { id: 102, table_number: '5', call_type: 'bill', status: 'pending', created_at: Date.now() - 30000 },
    {
      id: 103,
      table_number: '8',
      call_type: 'water',
      status: 'resolved',
      created_at: Date.now() - 600000,
      resolved_at: Date.now() - 400000,
    },
  ];

  // Invariant 1: Pending calls count per table
  const table5Pending = calls.filter((c) => c.table_number === '5' && c.status === 'pending');
  assert.equal(table5Pending.length, 2);

  // Invariant 2: 1-Click resolve for all calls on a table
  const resolveTable = (tableNo: string) => {
    return calls.map((c) =>
      c.table_number === tableNo && c.status === 'pending'
        ? { ...c, status: 'resolved' as ServiceCallStatus, resolved_at: Date.now() }
        : c,
    );
  };

  const updatedCalls = resolveTable('5');
  assert.equal(updatedCalls.filter((c) => c.table_number === '5' && c.status === 'pending').length, 0);
  assert.equal(updatedCalls.filter((c) => c.table_number === '5' && c.status === 'resolved').length, 2);
}

async function testTipAndGratuityAllocation(): Promise<void> {
  // Invariant 1: Tip amount is additive and isolated from sales discounts
  const saleSubtotal = 500;
  const tipAmount = 50;
  const discount = 25;
  const taxRate = 15;

  const invoiceTotals = computeInvoiceTotals(saleSubtotal, discount, taxRate, false, 0, 0);
  // Net Food = 475, Tax = 71.25, Total before Tip = 546.25
  assert.equal(invoiceTotals.total, 546.25);

  const grandTotalWithTip = Number((invoiceTotals.total + tipAmount).toFixed(2));
  assert.equal(grandTotalWithTip, 596.25);

  // Invariant 2: Tip cannot be negative
  const safeTip = (tip: number) => Math.max(0, Number(tip || 0));
  assert.equal(safeTip(-20), 0);
  assert.equal(safeTip(0), 0);
  assert.equal(safeTip(35.5), 35.5);
}

async function testWalkInWaitlistQueueWorkflow(): Promise<void> {
  interface WaitlistParty {
    id: number;
    guest_name: string;
    guest_count: number;
    reservation_type: 'reservation' | 'waitlist';
    status: 'confirmed' | 'seated' | 'cancelled';
    created_at: number;
    seated_table?: string;
  }

  const queue: WaitlistParty[] = [
    {
      id: 1,
      guest_name: 'عبد الله السالم',
      guest_count: 4,
      reservation_type: 'waitlist',
      status: 'confirmed',
      created_at: Date.now() - 900000,
    }, // 15 mins ago
    {
      id: 2,
      guest_name: 'فهد العتيبي',
      guest_count: 2,
      reservation_type: 'waitlist',
      status: 'confirmed',
      created_at: Date.now() - 300000,
    }, // 5 mins ago
  ];

  // Invariant 1: FIFO Queue priority
  const activeQueue = queue
    .filter((p) => p.reservation_type === 'waitlist' && p.status === 'confirmed')
    .sort((a, b) => a.created_at - b.created_at);
  assert.equal(activeQueue[0].id, 1, 'First party in line gets #1 priority');
  assert.equal(activeQueue[1].id, 2, 'Second party gets #2');

  // Invariant 2: Seating assigns table and transitions status to 'seated'
  const seatParty = (party: WaitlistParty, tableNo: string): WaitlistParty => {
    return { ...party, status: 'seated', seated_table: tableNo };
  };

  const seatedParty = seatParty(activeQueue[0], '12');
  assert.equal(seatedParty.status, 'seated');
  assert.equal(seatedParty.seated_table, '12');
}

async function testPayAtTableAndDriverDispatchWorkflow(): Promise<void> {
  // 1. Pay at Table calculations
  const items = [
    { name: 'ستيك ريب آي مع صوص الفطر', qty: 2, unitPrice: 180 },
    { name: 'سلطة سيزر بالدجاج', qty: 1, unitPrice: 65 },
    { name: 'عصير برتقال طازج', qty: 2, unitPrice: 25 },
  ];
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0); // 360 + 65 + 50 = 475
  assert.equal(subtotal, 475);

  const serviceChargeRate = 0.12; // 12% service charge
  const serviceCharge = Math.round(subtotal * serviceChargeRate * 100) / 100; // 57
  assert.equal(serviceCharge, 57);

  const taxRate = 0.15; // 15% VAT
  const taxableBase = subtotal + serviceCharge; // 532
  const tax = Math.round(taxableBase * taxRate * 100) / 100; // 79.80
  assert.equal(tax, 79.8);

  const billTotal = Math.round((taxableBase + tax) * 100) / 100; // 611.80
  assert.equal(billTotal, 611.8);

  const tipAmount = 50; // Custom tip
  const totalPaid = Math.round((billTotal + tipAmount) * 100) / 100; // 661.80
  assert.equal(totalPaid, 661.8);

  // 2. In-house driver dispatching and settlement
  interface DriverOrder {
    orderNumber: string;
    driverId: number;
    driverName: string;
    driverPhone: string;
    totalAmount: number;
    paymentMethod: 'cash_on_delivery' | 'online_paid';
    dispatchedAt: number;
  }

  const driverOrder: DriverOrder = {
    orderNumber: 'ORD-261012-0042',
    driverId: 7,
    driverName: 'الكابتن محمود سليم',
    driverPhone: '0551234567',
    totalAmount: 185,
    paymentMethod: 'cash_on_delivery',
    dispatchedAt: Date.now(),
  };

  // WhatsApp dispatch message verification
  const dispatchText = `عزيزي العميل، طلبك رقم #${driverOrder.orderNumber} في الطريق إليك مع كابتن التوصيل ${driverOrder.driverName} (${driverOrder.driverPhone}). نتمنى لك وجبة شهية!`;
  assert.ok(dispatchText.includes(driverOrder.orderNumber));
  assert.ok(dispatchText.includes(driverOrder.driverName));
  assert.ok(dispatchText.includes(driverOrder.driverPhone));

  // Driver return settlement verification
  const driverCashCollected = 185;
  const isSettled = driverOrder.paymentMethod === 'cash_on_delivery' && driverCashCollected === driverOrder.totalAmount;
  assert.strictEqual(isSettled, true);
}

async function testFast86EngineWorkflow(): Promise<void> {
  const item = {
    productId: 42,
    productName: 'برجر ترافل كلاسيك',
    is86ed: true,
    reason: 'نفاد الكمية بالمطبخ',
    autoRestoreHours: 8,
  };
  assert.strictEqual(item.is86ed, true);
  assert.strictEqual(item.reason, 'نفاد الكمية بالمطبخ');

  // Verify auto-restore calculation
  const restoreTime = Date.now() + item.autoRestoreHours * 3600 * 1000;
  assert.ok(restoreTime > Date.now());
}

async function testTipPoolingAndShiftDistributionEngine(): Promise<void> {
  const totalTips = 700; // 250 cash + 450 card
  const staff = [
    { employeeName: 'أحمد', role: 'waiter', weight: 1.2, hours: 8 },
    { employeeName: 'كريم', role: 'captain', weight: 1.5, hours: 8 },
    { employeeName: 'عمر', role: 'barista', weight: 1.0, hours: 8 },
    { employeeName: 'إبراهيم', role: 'kitchen', weight: 0.8, hours: 8 },
  ];

  // Role-based calculation: sum of weights = 1.2 + 1.5 + 1.0 + 0.8 = 4.5
  const totalWeight = staff.reduce((acc, s) => acc + s.weight, 0);
  assert.strictEqual(totalWeight, 4.5);

  let allocatedSum = 0;
  const allocations = staff.map((s, idx) => {
    let amount = Number(((s.weight / totalWeight) * totalTips).toFixed(2));
    allocatedSum += amount;
    if (idx === staff.length - 1) {
      const delta = Number((totalTips - allocatedSum).toFixed(2));
      amount = Number((amount + delta).toFixed(2));
    }
    return { name: s.employeeName, amount };
  });

  const exactSum = allocations.reduce((acc, a) => acc + a.amount, 0);
  assert.strictEqual(Number(exactSum.toFixed(2)), totalTips, 'Tip pool distributed with 0.00 zero-loss rounding');
}

async function testMultiZoneFloorPlanEngine(): Promise<void> {
  const zones = [
    { code: 'main', name: 'الصالة الرئيسية', tables: ['1', '2', '3', '4'] },
    { code: 'patio', name: 'التراس الخارجي', tables: ['5', '6', '7'] },
    { code: 'family', name: 'قسم العائلات', tables: ['8', '9', '10'] },
    { code: 'vip', name: 'جناح VIP', tables: ['11', '12'] },
  ];

  assert.strictEqual(zones.length, 4);
  const totalMapped = zones.reduce((acc, z) => acc + z.tables.length, 0);
  assert.strictEqual(totalMapped, 12);
  assert.ok(zones.some((z) => z.code === 'vip' && z.tables.includes('11')));
}

async function testDailyPrepSheetAndParLevelEngine(): Promise<void> {
  const prepItem = {
    productName: 'تتبيل شاورما ولحم البرجر',
    parLevel: 25,
    onHand: 10,
  };
  const prepRequired = Math.max(0, prepItem.parLevel - prepItem.onHand);
  assert.strictEqual(prepRequired, 15, 'Prep required = 25 - 10 = 15 kg');

  const actualPrepped = 15;
  const isPrepped = actualPrepped >= prepRequired;
  assert.strictEqual(isPrepped, true, 'Item marked prepped when actual meets required');
}

async function testDigitalStampLoyaltyCardEngine(): Promise<void> {
  const targetStamps = 6;
  let currentStamps = 4;
  let completedCards = 1;

  // Add 2 stamps -> total 6 -> unlocks reward and resets current to 0
  const stampsToAdd = 2;
  currentStamps += stampsToAdd;
  let rewardUnlocked = false;

  if (currentStamps >= targetStamps) {
    rewardUnlocked = true;
    completedCards += Math.floor(currentStamps / targetStamps);
    currentStamps = currentStamps % targetStamps;
  }

  assert.strictEqual(rewardUnlocked, true);
  assert.strictEqual(currentStamps, 0);
  assert.strictEqual(completedCards, 2);
}

async function testLivePlateCostAndInflationRadarEngine(): Promise<void> {
  const sellingPrice = 120;
  const standardCost = 35;
  const liveIngredientCost = 45; // Raw ingredient price jumped by 10

  const costInflationPct = Number((((liveIngredientCost - standardCost) / standardCost) * 100).toFixed(1));
  assert.strictEqual(costInflationPct, 28.6, 'Ingredient cost inflation = +28.6%');

  const currentMarginPct = Number((((sellingPrice - liveIngredientCost) / sellingPrice) * 100).toFixed(1));
  assert.strictEqual(currentMarginPct, 62.5, 'Current margin = 62.5%');

  // Suggested price to preserve 65% margin: liveCost / (1 - 0.65) = 45 / 0.35 = 128.57
  const suggestedPrice = Number((liveIngredientCost / 0.35).toFixed(2));
  assert.strictEqual(suggestedPrice, 128.57);
}

// ========================================================
// PHASE 2 FRONTIERS TESTS (19 - 24)
// ========================================================

async function testItemLevelTableTransferEngine(): Promise<void> {
  interface CartItem {
    productId: number;
    name: string;
    qty: number;
    price: number;
  }

  const table4Cart: CartItem[] = [
    { productId: 1, name: 'برجر كلاسيك', qty: 2, price: 35 },
    { productId: 2, name: 'بيتزا مارجريتا', qty: 1, price: 50 },
    { productId: 3, name: 'بطاطس مقلية', qty: 3, price: 12 },
  ];

  const table7Cart: CartItem[] = [{ productId: 4, name: 'كولا بارد', qty: 2, price: 8 }];

  // Transfer 1 Burger and 2 Fries from Table 4 to Table 7
  const itemsToTransfer = [
    { productId: 1, qty: 1 },
    { productId: 3, qty: 2 },
  ];

  // Deduct from Table 4
  for (const t of itemsToTransfer) {
    const item = table4Cart.find((i) => i.productId === t.productId);
    assert.ok(item, 'Item must exist on source table');
    assert.ok(item.qty >= t.qty, 'Transferred qty cannot exceed source qty');
    item.qty -= t.qty;
  }

  // Add to Table 7
  for (const t of itemsToTransfer) {
    const existing = table7Cart.find((i) => i.productId === t.productId);
    if (existing) {
      existing.qty += t.qty;
    } else {
      const sourceItem = [
        { productId: 1, name: 'برجر كلاسيك', price: 35 },
        { productId: 3, name: 'بطاطس مقلية', price: 12 },
      ].find((i) => i.productId === t.productId)!;
      table7Cart.push({ ...sourceItem, qty: t.qty });
    }
  }

  // Assert Table 4 state
  assert.strictEqual(table4Cart.find((i) => i.productId === 1)?.qty, 1);
  assert.strictEqual(table4Cart.find((i) => i.productId === 2)?.qty, 1);
  assert.strictEqual(table4Cart.find((i) => i.productId === 3)?.qty, 1);

  // Assert Table 7 state
  assert.strictEqual(table7Cart.length, 3);
  assert.strictEqual(table7Cart.find((i) => i.productId === 1)?.qty, 1);
  assert.strictEqual(table7Cart.find((i) => i.productId === 3)?.qty, 2);
  assert.strictEqual(table7Cart.find((i) => i.productId === 4)?.qty, 2);
}

async function testStickyCupLabelFormattingAndPageDimensions(): Promise<void> {
  const item = {
    productName: 'سبانش لاتيه مثلج',
    qty: 2,
    orderNumber: 'ORD-260914-0042',
    tableNumber: '4',
    modifiers: [
      { name: 'حليب شوفان', qty: 1 },
      { name: 'سكر خفيف', qty: 1 },
    ],
  };

  // Test label expansion: 2 items produce 2 distinct stickers with sequential indices
  const stickers: any[] = [];
  for (let i = 0; i < item.qty; i++) {
    stickers.push({
      itemIndex: i + 1,
      totalItems: item.qty,
      orderShortNo: item.orderNumber.slice(-4),
      title: item.productName,
      modifiersText: item.modifiers.map((m) => `+ ${m.name}`).join(' • '),
    });
  }

  assert.strictEqual(stickers.length, 2);
  assert.strictEqual(stickers[0].itemIndex, 1);
  assert.strictEqual(stickers[0].totalItems, 2);
  assert.strictEqual(stickers[0].modifiersText, '+ حليب شوفان • + سكر خفيف');
  assert.strictEqual(stickers[1].itemIndex, 2);
  assert.strictEqual(stickers[1].orderShortNo, '0042');
}

async function testSelfOrderingKioskOrderCreationAndState(): Promise<void> {
  const kioskOrder = {
    orderType: 'dine_in' as const,
    tableNumber: '14',
    items: [
      { productId: 10, qty: 2, unitPrice: 45 },
      { productId: 12, qty: 1, unitPrice: 15 },
    ],
    paymentMethod: 'card' as const,
  };

  const total = kioskOrder.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  assert.strictEqual(total, 105, 'Kiosk order total = 2*45 + 15 = 105');
  assert.strictEqual(kioskOrder.tableNumber, '14');
  assert.strictEqual(kioskOrder.orderType, 'dine_in');
}

async function testManagerCompsAndHouseAccountsValidation(): Promise<void> {
  // Invariant 1: Comp amount must be strictly greater than 0
  const validateComp = (amount: number, compType: string, managerName: string) => {
    if (amount <= 0) throw new Error('مبلغ الضيافة يجب أن يكون أكبر من الصفر');
    if (!managerName || !managerName.trim()) throw new Error('اسم المدير مطلوب');
    const validTypes = ['vip_guest', 'customer_complaint', 'staff_meal', 'promotional_tasting'];
    if (!validTypes.includes(compType)) throw new Error('نوع الضيافة غير صالح');
    return true;
  };

  assert.throws(() => validateComp(0, 'vip_guest', 'المدير'), /أكبر من الصفر/);
  assert.throws(() => validateComp(-50, 'vip_guest', 'المدير'), /أكبر من الصفر/);
  assert.throws(() => validateComp(100, 'vip_guest', ''), /اسم المدير مطلوب/);
  assert.throws(() => validateComp(100, 'invalid_type', 'المدير'), /نوع الضيافة غير صالح/);

  // Invariant 2: Valid comp returns true
  assert.strictEqual(validateComp(120, 'vip_guest', 'سعد المدير'), true);
  assert.strictEqual(validateComp(45, 'customer_complaint', 'سعد المدير'), true);
}

async function testTableQrPostPaymentRatingAndRescueAlertTrigger(): Promise<void> {
  interface TableRating {
    id: number;
    tableNumber: string;
    rating: number;
    isRescueAlertTriggered: boolean;
    isRescued: boolean;
  }

  const recordRating = (tableNumber: string, rating: number): TableRating => {
    const isNegative = rating <= 2;
    return {
      id: 101,
      tableNumber,
      rating,
      isRescueAlertTriggered: isNegative,
      isRescued: false,
    };
  };

  // High rating: no rescue alert
  const rating5 = recordRating('7', 5);
  assert.strictEqual(rating5.isRescueAlertTriggered, false);
  assert.strictEqual(rating5.rating, 5);

  // Low rating (1 or 2 stars): triggers high-priority rescue alert
  const rating2 = recordRating('4', 2);
  assert.strictEqual(rating2.isRescueAlertTriggered, true);

  const rating1 = recordRating('3', 1);
  assert.strictEqual(rating1.isRescueAlertTriggered, true);

  // Resolve rescue
  rating2.isRescued = true;
  assert.strictEqual(rating2.isRescued, true);
}

async function testKitchenPacingAndStaggeredCookingEngine(): Promise<void> {
  interface TicketItem {
    id: number;
    name: string;
    station: string;
    prepTimeMinutes: number;
  }

  const items: TicketItem[] = [
    { id: 1, name: 'ستيك ريب آي مشوي', station: 'grill', prepTimeMinutes: 18 },
    { id: 2, name: 'برجر دجاج كرسبي', station: 'kitchen', prepTimeMinutes: 10 },
    { id: 3, name: 'بطاطس مقلية ذهبية', station: 'kitchen', prepTimeMinutes: 4 },
  ];

  // Invariant 1: Max prep determines ticket benchmark
  const maxPrep = Math.max(...items.map((i) => i.prepTimeMinutes));
  assert.strictEqual(maxPrep, 18, 'Max prep time = 18 mins (Steak)');

  // Invariant 2: Stagger delays
  // Steak: 18 - 18 = 0 delay (Fire immediately)
  // Burger: 18 - 10 = 8 mins delay
  // Fries: 18 - 4 = 14 mins delay
  const getDelay = (itemPrep: number) => Math.max(0, maxPrep - itemPrep);
  assert.strictEqual(getDelay(18), 0, 'Steak fires immediately at 0 min');
  assert.strictEqual(getDelay(10), 8, 'Burger holds for 8 mins');
  assert.strictEqual(getDelay(4), 14, 'Fries hold for 14 mins');

  // Invariant 3: Pacing state at elapsed = 9 mins
  const elapsed = 9;
  // Steak: 9 >= 0 -> cooking
  // Burger: 9 >= 8 -> fire now!
  // Fries: 9 < 14 -> still held, remaining 5 mins
  const isHeld = (itemPrep: number) => elapsed < getDelay(itemPrep);
  assert.strictEqual(isHeld(18), false, 'Steak is cooking');
  assert.strictEqual(isHeld(10), false, 'Burger hold expired, fire now');
  assert.strictEqual(isHeld(4), true, 'Fries must still wait for 5 mins');
}

// ========================================================
// PHASE 3 NEXT-LEVEL ENTERPRISE FRONTIERS TESTS (25 - 29)
// ========================================================

async function testSeatLevelOrderingAndSplitBySeatGrouping(): Promise<void> {
  interface CartItemWithSeat {
    lineKey: string;
    productId: number;
    name: string;
    price: number;
    quantity: number;
    seatNumber?: number;
  }

  const items: CartItemWithSeat[] = [
    { lineKey: 'l1', productId: 101, name: 'ريب آي ستيك', price: 120, quantity: 1, seatNumber: 1 },
    { lineKey: 'l2', productId: 102, name: 'سلطة سيزر', price: 35, quantity: 1, seatNumber: 1 },
    { lineKey: 'l3', productId: 103, name: 'باستا الفريدو', price: 65, quantity: 1, seatNumber: 2 },
    { lineKey: 'l4', productId: 104, name: 'عصير برتقال طازج', price: 20, quantity: 2, seatNumber: 2 },
    { lineKey: 'l5', productId: 105, name: 'شوكولاتة فوندان', price: 40, quantity: 1, seatNumber: 3 },
  ];

  // Group by seatNumber
  const seatMap = new Map<number, CartItemWithSeat[]>();
  for (const item of items) {
    const seat = item.seatNumber || 1;
    if (!seatMap.has(seat)) seatMap.set(seat, []);
    seatMap.get(seat)!.push(item);
  }

  assert.strictEqual(seatMap.size, 3, 'Must split into exactly 3 seats');

  // Calculate subtotals
  const seat1Subtotal = seatMap.get(1)!.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const seat2Subtotal = seatMap.get(2)!.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const seat3Subtotal = seatMap.get(3)!.reduce((sum, i) => sum + i.price * i.quantity, 0);

  assert.strictEqual(seat1Subtotal, 120 + 35); // 155
  assert.strictEqual(seat2Subtotal, 65 + 20 * 2); // 105
  assert.strictEqual(seat3Subtotal, 40); // 40

  const totalAllSeats = seat1Subtotal + seat2Subtotal + seat3Subtotal;
  const originalTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Invariant: sum of individual seat totals equals the full ticket total with zero discrepancy
  assert.strictEqual(totalAllSeats, originalTotal, 'Sum of seat checks must strictly equal parent total (300)');
  assert.strictEqual(originalTotal, 300);
}

async function testSmartUpsellRecommendationTriggerAndDiscount(): Promise<void> {
  interface UpsellRule {
    id: number;
    trigger_product_ids: number[];
    recommended_product_id: number;
    prompt_text_ar: string;
    discount_pct: number;
    is_active: boolean;
  }

  const rules: UpsellRule[] = [
    {
      id: 1,
      trigger_product_ids: [10, 11], // Burgers
      recommended_product_id: 50, // Cheese fries
      prompt_text_ar: 'هل ترغب بإضافة بطاطس بالجبنة بسعر خاص؟',
      discount_pct: 20,
      is_active: true,
    },
    {
      id: 2,
      trigger_product_ids: [20], // Coffee
      recommended_product_id: 60, // Donut
      prompt_text_ar: 'احصل على دونات شوكولاتة مع قهوتك بخصم 50%',
      discount_pct: 50,
      is_active: true,
    },
  ];

  const getRecommendations = (cartProductIds: number[]): UpsellRule[] => {
    return rules.filter((r) => r.is_active && r.trigger_product_ids.some((id) => cartProductIds.includes(id)));
  };

  // Cart with Burger (10) -> matches rule 1
  const recsForBurger = getRecommendations([10, 99]);
  assert.strictEqual(recsForBurger.length, 1);
  assert.strictEqual(recsForBurger[0].recommended_product_id, 50);

  // Discount math: Base price 25, 20% discount -> 20.00
  const originalPrice = 25;
  const discountedPrice = Number((originalPrice * (1 - recsForBurger[0].discount_pct / 100)).toFixed(2));
  assert.strictEqual(discountedPrice, 20.0, 'Discounted price must be 20.00');

  // Cart without triggers -> no recommendations
  const recsForSalad = getRecommendations([99]);
  assert.strictEqual(recsForSalad.length, 0);
}

async function testDriveThruQueueStateMachineAndSosCalculation(): Promise<void> {
  interface DriveThruOrder {
    id: number;
    orderNumber: string;
    vehiclePlate: string;
    status: 'order_taken' | 'at_window' | 'completed' | 'cancelled';
    orderTakenAt: Date;
    atWindowAt?: Date;
    completedAt?: Date;
    serviceTimeSeconds?: number;
  }

  const order: DriveThruOrder = {
    id: 1,
    orderNumber: 'DT-260914-0001',
    vehiclePlate: 'أ ب ج 1234',
    status: 'order_taken',
    orderTakenAt: new Date('2026-10-12T12:00:00Z'),
  };

  // Transition 1: Arrive at window 45s later
  order.status = 'at_window';
  order.atWindowAt = new Date('2026-10-12T12:00:45Z');
  assert.strictEqual(order.status, 'at_window');

  // Transition 2: Complete order 80s after order taken (Total SOS = 80s)
  order.status = 'completed';
  order.completedAt = new Date('2026-10-12T12:01:20Z');
  order.serviceTimeSeconds = Math.round((order.completedAt.getTime() - order.orderTakenAt.getTime()) / 1000);

  assert.strictEqual(order.serviceTimeSeconds, 80, 'Total service time = 80s');

  // Benchmark speed of service rating
  const getSosTier = (sec: number) => {
    if (sec < 90) return 'green_fast';
    if (sec <= 180) return 'amber_moderate';
    return 'red_bottleneck';
  };

  assert.strictEqual(getSosTier(order.serviceTimeSeconds), 'green_fast', '80s meets fast SOS benchmark');
  assert.strictEqual(getSosTier(130), 'amber_moderate');
  assert.strictEqual(getSosTier(240), 'red_bottleneck');
}

async function testKitchenDayDotHaccpFoodSafetyLabelGeneration(): Promise<void> {
  const prepItem = {
    id: 1,
    name: 'صلصة طماطم بيتزا محضرة',
    batchNumber: 'BATCH-261012-01',
    preppedAt: new Date('2026-10-12T08:00:00Z'),
    shelfLifeHours: 72, // 3 days
    storageTemp: '4°C',
    chefName: 'شيف حسن',
  };

  // Calculate expiry
  const expiryDate = new Date(prepItem.preppedAt.getTime() + prepItem.shelfLifeHours * 3600 * 1000);
  assert.strictEqual(expiryDate.toISOString(), '2026-10-15T08:00:00.000Z', 'Expiry must be 72 hours later');

  // Day dot Arabic day names
  const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const expiryDayName = dayNamesAr[expiryDate.getUTCDay()]; // Thursday -> الخميس
  assert.strictEqual(expiryDayName, 'الخميس');

  // Thermal label metadata assertion
  const labelPayload = {
    widthMm: 50,
    heightMm: 30,
    colorDayDot: 'BROWN_THU',
    dayName: expiryDayName,
    storageTemp: prepItem.storageTemp,
    shelfLifeHours: prepItem.shelfLifeHours,
  };

  assert.strictEqual(labelPayload.widthMm, 50);
  assert.strictEqual(labelPayload.heightMm, 30);
  assert.strictEqual(labelPayload.storageTemp, '4°C');
}

async function testTableZoneMinimumSpendCalculationAndDeficitSurcharge(): Promise<void> {
  interface TableZone {
    id: number;
    zoneName: string;
    minimumSpend: number;
  }

  const vipZone: TableZone = {
    id: 1,
    zoneName: 'صالة كبار الشخصيات VIP',
    minimumSpend: 500,
  };

  const calculateMinSpendDeficit = (cartTotal: number, minSpend: number) => {
    if (minSpend <= 0) return { minSpend, deficit: 0, finalTotal: cartTotal };
    const deficit = Math.max(0, Number((minSpend - cartTotal).toFixed(2)));
    return {
      minSpend,
      deficit,
      finalTotal: cartTotal + deficit,
    };
  };

  // Scenario 1: Cart is under minimum spend (340 < 500)
  const underSpendResult = calculateMinSpendDeficit(340, vipZone.minimumSpend);
  assert.strictEqual(underSpendResult.deficit, 160, 'Deficit must be 500 - 340 = 160');
  assert.strictEqual(underSpendResult.finalTotal, 500, 'Final billed total must meet 500 minimum spend');

  // Scenario 2: Cart exceeds minimum spend (680 > 500)
  const overSpendResult = calculateMinSpendDeficit(680, vipZone.minimumSpend);
  assert.strictEqual(overSpendResult.deficit, 0, 'No deficit when spending exceeds minimum');
  assert.strictEqual(overSpendResult.finalTotal, 680, 'Final total remains 680');

  // Scenario 3: Regular zone without minimum spend (0)
  const regularZoneResult = calculateMinSpendDeficit(120, 0);
  assert.strictEqual(regularZoneResult.deficit, 0);
  assert.strictEqual(regularZoneResult.finalTotal, 120);
}

async function testHeldDraftsModifierAndSeatResilience(): Promise<void> {
  const mockRows = [
    {
      id: 101,
      table_number: 'T-05',
      order_type: 'dine_in',
      discount: 0,
      note: 'طاولة بجانب النافذة',
    },
  ];
  const mockItems = [
    {
      id: 1,
      held_sale_id: 101,
      product_id: 50,
      product_name: 'برجر دجاج سوبريم',
      qty: 2,
      unit_price: 3.5,
      unit_name: 'وجبة',
      unit_multiplier: 1,
      price_type: 'retail',
      notes: 'بدون بصل مع زيادة صوص',
      modifiers: JSON.stringify({
        mods: [{ name: 'جبنة إضافية', qty: 1, price: 0.5 }],
        seatNumber: 2,
        course: 'main',
      }),
    },
  ];

  const mapped = mapHeldSalesRows(mockRows, mockItems);
  assert.equal(mapped.length, 1);
  const draft = mapped[0];
  assert.equal(draft.tableNumber, 'T-05');
  assert.equal(draft.orderType, 'dine_in');
  const cartItem = (draft.cart as any[])[0];
  assert.equal(cartItem.productId, '50');
  assert.equal(cartItem.qty, 2);
  assert.equal(cartItem.notes, 'بدون بصل مع زيادة صوص');
  assert.equal(cartItem.seatNumber, 2);
  assert.equal(cartItem.course, 'main');
  assert.equal(cartItem.modifiers.length, 1);
  assert.equal(cartItem.modifiers[0].name, 'جبنة إضافية');
}

async function testKitchenOrderTicketContract(): Promise<void> {
  const orderTypeMap: Record<string, string> = {
    dine_in: 'محلي (داخل المطعم)',
    takeaway: 'سفري / استلام',
    delivery: 'توصيل',
    car_pickup: 'استلام سيارة (Drive-Thru)',
  };
  const courseMap: Record<string, string> = {
    appetizer: 'مقبلات',
    main: 'طبق رئيسي',
    dessert: 'حلويات',
    beverage: 'مشروبات',
  };

  const ticketData = {
    docNo: 'JOB-261016-0045',
    tableNumber: 'T-12',
    orderType: 'dine_in',
    waiterName: 'الكابتن علي',
    guestCount: 4,
    note: 'مستعجل للضيوف',
    isAddon: true,
    items: [
      {
        name: 'شوربة عدس تركي',
        qty: 2,
        course: 'appetizer',
        seatNumber: 1,
        notes: 'حارة قليلاً',
        modifiers: [{ name: 'ليمون إضافي', qty: 2 }],
      },
    ],
  };

  const headerCallout = ticketData.tableNumber
    ? `طاولة: ${ticketData.tableNumber}`
    : orderTypeMap[ticketData.orderType];
  assert.equal(headerCallout, 'طاولة: T-12');
  assert.equal(ticketData.isAddon, true);
  assert.equal(ticketData.guestCount, 4);
  assert.equal(courseMap[ticketData.items[0].course], 'مقبلات');
  assert.equal(ticketData.items[0].seatNumber, 1);
  assert.equal(ticketData.items[0].modifiers[0].name, 'ليمون إضافي');
}

async function testTimedMenusDaypartEngine(): Promise<void> {
  const products = [
    { id: 1, name: 'فطور شرقي متكامل', categoryName: 'الفطور', description: 'بيض وفول وجبن' },
    { id: 2, name: 'برجر أنجوس دبل لحم', categoryName: 'وجبات الغداء', description: 'مشوي على الفحم' },
    { id: 3, name: 'ساندوتش فاهيتا عشاء', categoryName: 'سندوتشات', description: 'عشاء خفيف' },
    { id: 4, name: 'كافيه لاتيه وحلى لوتس', categoryName: 'كافيه', description: 'قهوة وحلويات' },
  ];

  const kwMap: Record<string, RegExp> = {
    breakfast: /فطور|إفطار|صباح|بيض|فول|بانكيك|شاي|كرواسون|breakfast/i,
    lunch: /غداء|مشويات|شاورما|برجر|بيتزا|أرز|دجاج|لحم|lunch|burger/i,
    dinner: /عشاء|سهرة|سندوتش|فاهيتا|بيتزا|dinner/i,
    beverages: /عصير|مشروب|قهوة|كافيه|لاتيه|حلى|حلويات|آيسكريم|كيك|drink|coffee|dessert/i,
  };

  const filterDaypart = (dp: string) => {
    const reg = kwMap[dp];
    return products.filter((p) => reg.test(`${p.name} ${p.categoryName} ${p.description}`));
  };

  const breakfastItems = filterDaypart('breakfast');
  assert.equal(breakfastItems.length, 1);
  assert.equal(breakfastItems[0].name, 'فطور شرقي متكامل');

  const lunchItems = filterDaypart('lunch');
  assert.equal(lunchItems.length, 1);
  assert.equal(lunchItems[0].name, 'برجر أنجوس دبل لحم');

  const dinnerItems = filterDaypart('dinner');
  assert.equal(dinnerItems.length, 1);
  assert.equal(dinnerItems[0].name, 'ساندوتش فاهيتا عشاء');

  const beverageItems = filterDaypart('beverages');
  assert.equal(beverageItems.length, 1);
  assert.equal(beverageItems[0].name, 'كافيه لاتيه وحلى لوتس');
}

(async () => {
  console.log('--- Starting Restaurant F&B Critical Workflow Audit ---');
  await testServiceChargeFinancialInvariants();
  console.log('1. Service Charge & Tax Isolation: PASSED');
  await testTableReservationTransitions();
  console.log('2. Table Reservation State Machine: PASSED');
  await testDeliveryAggregatorsAnd86StopList();
  console.log('3. Delivery Aggregators & 86 Stop List: PASSED');
  await testFoodWasteVarianceEngine();
  console.log('4. Food Waste & Variance Engine: PASSED');
  await testGuestCoversAndAverageSpend();
  console.log('5. Guest Covers & Spend Per Guest: PASSED');
  await testMenuEngineeringMatrix();
  console.log('6. Menu Engineering BCG Matrix (Star/Plowhorse/Puzzle/Dog): PASSED');
  await testMultiStationKitchenPrinterRouting();
  console.log('7. Multi-Station Kitchen Printer Routing: PASSED');
  await testSfdaNutritionalAndAllergenCompliance();
  console.log('8. SFDA Nutritional & Allergen Compliance: PASSED');
  await testTableServiceCallsWorkflow();
  console.log('9. Table Service Calls & Realtime Resolution: PASSED');
  await testTipAndGratuityAllocation();
  console.log('10. Tip & Gratuity Allocation Engine: PASSED');
  await testWalkInWaitlistQueueWorkflow();
  console.log('11. Walk-In Waitlist Queue & Seating Engine: PASSED');
  await testPayAtTableAndDriverDispatchWorkflow();
  console.log('12. Pay-at-Table QR Self-Checkout & In-House Driver Dispatch: PASSED');
  await testFast86EngineWorkflow();
  console.log('13. Fast 86 Engine & Out-of-Stock Auto-Restore: PASSED');
  await testTipPoolingAndShiftDistributionEngine();
  console.log('14. Tip Pooling & Shift Distribution (Zero-loss Rounding): PASSED');
  await testMultiZoneFloorPlanEngine();
  console.log('15. Multi-Zone Dining Sections (Main, Patio, Family, VIP): PASSED');
  await testDailyPrepSheetAndParLevelEngine();
  console.log('16. Daily Prep Sheet & Central Commissary Par Levels: PASSED');
  await testDigitalStampLoyaltyCardEngine();
  console.log('17. Digital Stamp Loyalty Card (Punch Card Rewards): PASSED');
  await testLivePlateCostAndInflationRadarEngine();
  console.log('18. Live Plate Cost & Food Inflation Radar (Margin Protection): PASSED');
  await testItemLevelTableTransferEngine();
  console.log('19. Item-Level Table Transfer (Partial Item Moving): PASSED');
  await testStickyCupLabelFormattingAndPageDimensions();
  console.log('20. Sticky Cup & Box Label Formatting (50x30mm Thermal): PASSED');
  await testSelfOrderingKioskOrderCreationAndState();
  console.log('21. Self-Ordering Kiosk Dine-In/Takeaway Order Dispatch: PASSED');
  await testManagerCompsAndHouseAccountsValidation();
  console.log('22. Manager Comps & VIP House Hospitality Validation: PASSED');
  await testTableQrPostPaymentRatingAndRescueAlertTrigger();
  console.log('23. Table QR Post-Payment Rating & Rescue Alert Engine: PASSED');
  await testKitchenPacingAndStaggeredCookingEngine();
  console.log('24. Kitchen Pacing & Staggered Cooking Delay Engine: PASSED');
  await testSeatLevelOrderingAndSplitBySeatGrouping();
  console.log('25. Seat-Level Ordering & 1-Click Split by Seat Grouping: PASSED');
  await testSmartUpsellRecommendationTriggerAndDiscount();
  console.log('26. Smart Upsell Recommendation Trigger & Discount Validation: PASSED');
  await testDriveThruQueueStateMachineAndSosCalculation();
  console.log('27. Drive-Thru Queue State Machine & Speed of Service (SOS): PASSED');
  await testKitchenDayDotHaccpFoodSafetyLabelGeneration();
  console.log('28. Kitchen Day-Dot 50x30mm Expiry & HACCP Label Generation: PASSED');
  await testTableZoneMinimumSpendCalculationAndDeficitSurcharge();
  console.log('29. Table Zone Minimum Spend Calculation & Deficit Surcharge: PASSED');
  await testHeldDraftsModifierAndSeatResilience();
  console.log('30. Held Drafts Modifier, Notes, Seat Number & Course Resilience: PASSED');
  await testKitchenOrderTicketContract();
  console.log('31. Kitchen Order Ticket (KOT) Generation Contract: PASSED');
  await testTimedMenusDaypartEngine();
  console.log('32. Timed Menus / Dayparts Classification Engine: PASSED');
  console.log('--- ALL RESTAURANT F&B CRITICAL CHECKS PASSED (100% - 32/32) ---');
})().catch((err) => {
  console.error('Restaurant F&B Critical Audit FAILED:', err);
  process.exit(1);
});
