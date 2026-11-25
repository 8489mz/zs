import { strict as assert } from 'node:assert';
import { evaluateFmcgCartPromotions, FmcgPromotion } from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import { optimizeRouteTsp, RouteStopInput } from '../../src/modules/delivery-reps/route-optimization.engine';

// ==========================================
// TEST 1: FMCG Mix & Match Promotion (Buy X + Y -> Get Z Free)
// ==========================================
const samplePromos: FmcgPromotion[] = [
  {
    id: 101,
    name: 'عرض باقة العصائر: 5 مانجو + 2 جوافة = 1 تفاح مجاناً',
    code: 'PROMO-JUICE-01',
    promoType: 'mix_and_match',
    applyType: 'free_bonus',
    buyConditions: [
      { productId: 10, minQty: 5, productName: 'عصير مانجو 1 لتر' },
      { productId: 20, minQty: 2, productName: 'عصير جوافة 1 لتر' },
    ],
    reward: {
      bonusProductId: 30,
      bonusProductName: 'عصير تفاح 1 لتر',
      bonusQty: 1,
      bonusUom: 'كرتونة',
      bonusReason: 'عرض باقة العصائر الترويجي',
    },
    isActive: true,
    maxApplicationsPerOrder: 2,
  },
  {
    id: 102,
    name: 'شريحة كميات: اشترِ 20 كرتونة مياه واحصل على 8% خصم',
    code: 'PROMO-WATER-TIER',
    promoType: 'tiered_qty',
    applyType: 'discount_percent',
    buyConditions: { productId: 40, minQty: 20, productName: 'مياه معدنية 600 مل' },
    reward: { discountPercent: 8 },
    isActive: true,
  },
  {
    id: 103,
    name: 'بونص سقف الفاتورة: إذا تجاوزت الفاتورة 5,000 ج.م احصل على خصم 200 ج.م',
    code: 'PROMO-INVOICE-5K',
    promoType: 'invoice_threshold',
    applyType: 'discount_amount',
    buyConditions: { minInvoiceTotal: 5000 },
    reward: { discountAmount: 200 },
    isActive: true,
  },
];

// Cart with complete mix & match (5 mango + 2 guava)
const cart1 = [
  { productId: 10, productName: 'عصير مانجو 1 لتر', qty: 5, unitPrice: 100 },
  { productId: 20, productName: 'عصير جوافة 1 لتر', qty: 2, unitPrice: 90 },
];

const res1 = evaluateFmcgCartPromotions({
  cartItems: cart1,
  activePromotions: samplePromos,
});

assert.equal(res1.appliedPromotions.length, 1);
assert.equal(res1.appliedPromotions[0].promoCode, 'PROMO-JUICE-01');
assert.equal(res1.bonusItemsToAdd.length, 1);
assert.equal(res1.bonusItemsToAdd[0].productId, 30);
assert.equal(res1.bonusItemsToAdd[0].qty, 1);
assert.equal(res1.bonusItemsToAdd[0].unitPrice, 0);
assert.equal(res1.bonusItemsToAdd[0].isBonus, true);

// ==========================================
// TEST 2: Incomplete Mix & Match Cart -> Generates Upsell Nudge
// ==========================================
const cart2 = [
  { productId: 10, productName: 'عصير مانجو 1 لتر', qty: 5, unitPrice: 100 },
  // missing guava!
];

const res2 = evaluateFmcgCartPromotions({
  cartItems: cart2,
  activePromotions: samplePromos,
});

assert.equal(res2.appliedPromotions.length, 0);
assert.equal(res2.bonusItemsToAdd.length, 0);
assert.ok(res2.upsellNudges.length >= 1);
assert.equal(res2.upsellNudges[0].promoId, 101);
assert.ok(res2.upsellNudges[0].hintText.includes('عصير جوافة'));

// ==========================================
// TEST 3: Tiered Quantity & Invoice Threshold
// ==========================================
const cart3 = [
  { productId: 40, productName: 'مياه معدنية 600 مل', qty: 25, unitPrice: 200 }, // Total = 5000
];

const res3 = evaluateFmcgCartPromotions({
  cartItems: cart3,
  invoiceSubtotal: 5000,
  activePromotions: samplePromos,
});

// Should trigger both promo 102 (tiered qty: 8% of 5000 = 400) and promo 103 (threshold: 200)
assert.equal(res3.appliedPromotions.length, 2);
assert.equal(res3.totalPromotionalDiscount, 600); // 400 + 200

// ==========================================
// TEST 4: Dynamic Route Optimization (TSP with 2-Opt)
// ==========================================
// Setup 4 stops along a road in a zigzag order (A -> C -> B -> D)
// Correct sequential path should be (A -> B -> C -> D)
const zigzagStops: RouteStopInput[] = [
  { id: 1, name: 'متجر التوحيد', lat: 30.01, lng: 31.2, customerCode: 'C-01' }, // Stop A
  { id: 3, name: 'سوبرماركت البركة', lat: 30.03, lng: 31.2, customerCode: 'C-03' }, // Stop C
  { id: 2, name: 'بقالة الأمانة', lat: 30.02, lng: 31.2, customerCode: 'C-02' }, // Stop B (middle)
  { id: 4, name: 'ماركت النور', lat: 30.04, lng: 31.2, customerCode: 'C-04' }, // Stop D
  { id: 5, name: 'عميل بلا إحداثيات', lat: null, lng: null, customerCode: 'C-05' },
];

const tspResult = optimizeRouteTsp(zigzagStops, {
  startLat: 30.005,
  startLng: 31.2,
});

assert.equal(tspResult.stats.totalStops, 5);
assert.equal(tspResult.stats.mappedStopsCount, 4);
assert.equal(tspResult.stats.unmappedStopsCount, 1);
assert.ok(tspResult.stats.savedDistanceMeters > 0, 'Optimization must save distance over zigzag');
assert.ok(tspResult.stats.savingsPercent > 0);

// Verify mapped stops are visited in ascending latitude order A (1) -> B (2) -> C (3) -> D (4)
const mappedOrderedIds = tspResult.orderedStops.slice(0, 4).map((s) => s.id);
assert.deepEqual(mappedOrderedIds, [1, 2, 3, 4], 'Route must be untangled to sequential order');

// Verify unmapped stop is at the end
assert.equal(tspResult.orderedStops[4].id, 5);
assert.equal(tspResult.orderedStops[4].isUnmappedGps, true);

console.log('✅ ALL FMCG PROMOTIONS & ROUTE OPTIMIZATION SPEC TESTS PASSED 100%');
