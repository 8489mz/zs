import assert from 'assert';
import {
  calculateAllowedSaleUnitPrice,
  isOfferActive,
  calculateOfferAdjustedPrice,
  getOfferMinQty,
  pickBestApplicableOffer,
  SaleProductOfferRow,
} from '../../src/modules/sales/helpers/sales-write.helper';
import {
  resolveBestStorefrontOffer,
  RawStorefrontOffer,
} from '../../src/modules/storefront/engines/storefront-offers.engine';

async function runComprehensiveOffersAudit(): Promise<void> {
  console.log('================================================================');
  console.log('⚡ AUDIT: COMPREHENSIVE VERIFICATION OF ALL PROMOTION & OFFER SYSTEMS');
  console.log('================================================================\n');

  const todayIso = '2026-10-12';
  const baseRetail = 100;

  // -------------------------------------------------------------
  // 1. Percentage Discount (نسبة مئوية)
  // -------------------------------------------------------------
  console.log('--- [1] Percentage Discount Verification ---');
  {
    const offer: SaleProductOfferRow = {
      offer_type: 'percent',
      value: 20, // 20%
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    const allowedPrice = calculateAllowedSaleUnitPrice({
      moneyDigits: 2,
      retailPrice: baseRetail,
      priceType: 'retail',
      offers: [offer],
      qty: 1,
      todayIso,
    });
    assert.equal(allowedPrice, 80, '20% off 100 EGP should be 80 EGP');
    console.log('  ✓ 20% discount applies cleanly: 100 EGP -> 80 EGP');

    // With minimum quantity
    const offerMinQty: SaleProductOfferRow = {
      offer_type: 'percent',
      value: 25,
      min_qty: 3,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [offerMinQty],
        qty: 2,
        todayIso,
      }),
      100,
      'Qty 2 is below minQty 3, should remain base retail price 100 EGP',
    );
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [offerMinQty],
        qty: 3,
        todayIso,
      }),
      75,
      'Qty 3 meets minQty 3, 25% discount should apply -> 75 EGP',
    );
    console.log('  ✓ Percentage minQty threshold strictly enforced (2 units: 100 EGP, 3 units: 75 EGP)');
  }

  // -------------------------------------------------------------
  // 2. Fixed Discount (خصم مبلغ ثابت)
  // -------------------------------------------------------------
  console.log('\n--- [2] Fixed Amount Discount Verification ---');
  {
    const offer: SaleProductOfferRow = {
      offer_type: 'fixed',
      value: 15, // 15 EGP off
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    const allowedPrice = calculateAllowedSaleUnitPrice({
      moneyDigits: 2,
      retailPrice: baseRetail,
      priceType: 'retail',
      offers: [offer],
      qty: 1,
      todayIso,
    });
    assert.equal(allowedPrice, 85, '15 EGP off 100 EGP should be 85 EGP');
    console.log('  ✓ Fixed discount applies cleanly: 100 EGP -> 85 EGP');

    // Does not go below 0
    const hugeDiscountOffer: SaleProductOfferRow = {
      offer_type: 'fixed',
      value: 150,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    const clampedPrice = calculateAllowedSaleUnitPrice({
      moneyDigits: 2,
      retailPrice: baseRetail,
      priceType: 'retail',
      offers: [hugeDiscountOffer],
      qty: 1,
      todayIso,
    });
    assert.equal(clampedPrice, 0, 'Excessive discount should clamp price safely at 0');
    console.log('  ✓ Fixed discount clamped at 0 without negative balances');
  }

  // -------------------------------------------------------------
  // 3. Special Override Price (سعر خاص بديل)
  // -------------------------------------------------------------
  console.log('\n--- [3] Special Override Price Verification ---');
  {
    const offer: SaleProductOfferRow = {
      offer_type: 'price',
      value: 69.5, // Special promo price
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    const allowedPrice = calculateAllowedSaleUnitPrice({
      moneyDigits: 2,
      retailPrice: baseRetail,
      priceType: 'retail',
      offers: [offer],
      qty: 1,
      todayIso,
    });
    assert.equal(allowedPrice, 69.5, 'Special price override to 69.5 EGP');
    console.log('  ✓ Special price override applied cleanly: 100 EGP -> 69.5 EGP');
  }

  // -------------------------------------------------------------
  // 4. Bundle / Pack Quantity Offer (عروض الباقات والكميات)
  // -------------------------------------------------------------
  console.log('\n--- [4] Bundle / Pack Quantity Offer Verification ---');
  {
    // Buy bundle of 5 items for 350 EGP (original was 5 * 100 = 500 EGP)
    const bundleOffer: SaleProductOfferRow = {
      offer_type: 'bundle',
      value: 350,
      min_qty: 5,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };

    // Below bundle threshold (3 pieces)
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bundleOffer],
        qty: 3,
        todayIso,
      }),
      100,
      'Below bundle threshold (3 items): should remain 100 EGP each',
    );

    // Exactly 1 bundle (5 pieces) -> 350 / 5 = 70 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bundleOffer],
        qty: 5,
        todayIso,
      }),
      70,
      '1 bundle of 5 items for 350 EGP -> 70 EGP each',
    );

    // 1 bundle + 2 remainder pieces (7 pieces total)
    // 1 bundle (5 * 70 = 350) + 2 regular (2 * 100 = 200) = 550 total / 7 = 78.57 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bundleOffer],
        qty: 7,
        todayIso,
      }),
      78.57,
      '7 items = 1 bundle (350) + 2 single items (200) = 550 / 7 = 78.57 EGP each',
    );
    console.log(
      '  ✓ Bundle offers accurately calculate full bundles and remainder pieces (3: 100, 5: 70, 7: 78.57 EGP)',
    );
  }

  // -------------------------------------------------------------
  // 5. BOGO (اشتري X واحصل على Y بخصم Z%)
  // -------------------------------------------------------------
  console.log('\n--- [5] BOGO (Buy X Get Y) Verification ---');
  {
    // Case 5A: Buy 1 Get 1 Free (100% off)
    const bogo1Plus1: SaleProductOfferRow = {
      offer_type: 'bogo',
      bogo_buy_qty: 1,
      bogo_get_qty: 1,
      bogo_discount_percent: 100,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };

    // 1 piece: not eligible yet
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bogo1Plus1],
        qty: 1,
        todayIso,
      }),
      100,
      '1 item does not qualify for BOGO',
    );

    // 2 pieces: 1 paid, 1 free -> total 100 / 2 = 50 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bogo1Plus1],
        qty: 2,
        todayIso,
      }),
      50,
      '2 items in Buy 1 Get 1 Free -> 50 EGP each',
    );

    // 3 pieces: 1 paid + 1 free + 1 regular -> total 200 / 3 = 66.67 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bogo1Plus1],
        qty: 3,
        todayIso,
      }),
      66.67,
      '3 items in Buy 1 Get 1 Free -> 66.67 EGP each',
    );

    // 4 pieces: 2 paid + 2 free -> total 200 / 4 = 50 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bogo1Plus1],
        qty: 4,
        todayIso,
      }),
      50,
      '4 items in Buy 1 Get 1 Free (2 cycles) -> 50 EGP each',
    );
    console.log('  ✓ BOGO Buy 1 Get 1 Free: 1pc = 100 EGP, 2pcs = 50 EGP, 3pcs = 66.67 EGP, 4pcs = 50 EGP');

    // Case 5B: Buy 2 Get 1 at 50% discount
    const bogo2Plus1Half: SaleProductOfferRow = {
      offer_type: 'bogo',
      bogo_buy_qty: 2,
      bogo_get_qty: 1,
      bogo_discount_percent: 50,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };
    // 3 pieces: 2 paid @ 100 + 1 paid @ 50 = 250 / 3 = 83.33 EGP each
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [bogo2Plus1Half],
        qty: 3,
        todayIso,
      }),
      83.33,
      '3 items in Buy 2 Get 1 @ 50% -> 83.33 EGP each',
    );
    console.log('  ✓ BOGO Buy 2 Get 1 @ 50% off: 3pcs = 83.33 EGP each');
  }

  // -------------------------------------------------------------
  // 6. Happy Hours & Day-of-Week Scheduling (الساعات السعيدة وأيام الأسبوع)
  // -------------------------------------------------------------
  console.log('\n--- [6] Happy Hours & Days of Week Scheduling Verification ---');
  {
    const happyHourOffer: SaleProductOfferRow = {
      offer_type: 'percent',
      value: 30, // 30% off
      happy_hour_start: '16:00',
      happy_hour_end: '20:00',
      days_of_week: '1,2,3', // Mon, Tue, Wed
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };

    // Valid Tuesday at 17:30
    const validTuesday = new Date('2026-10-13T17:30:00'); // Day 2 (Tue)
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [happyHourOffer],
        qty: 1,
        todayIso: '2026-10-13',
        now: validTuesday,
      }),
      70,
      'Inside happy hour on valid day should apply 30% discount -> 70 EGP',
    );

    // Tuesday at 21:00 (outside window)
    const outsideHoursTuesday = new Date('2026-10-13T21:00:00');
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [happyHourOffer],
        qty: 1,
        todayIso: '2026-10-13',
        now: outsideHoursTuesday,
      }),
      100,
      'Outside happy hour window should remain regular retail price -> 100 EGP',
    );

    // Friday at 17:30 (inside window but invalid day)
    const fridayDate = new Date('2026-10-16T17:30:00'); // Day 5 (Fri)
    assert.equal(
      calculateAllowedSaleUnitPrice({
        moneyDigits: 2,
        retailPrice: baseRetail,
        priceType: 'retail',
        offers: [happyHourOffer],
        qty: 1,
        todayIso: '2026-10-16',
        now: fridayDate,
      }),
      100,
      'Invalid day of week should not activate offer -> 100 EGP',
    );
    console.log(
      '  ✓ Happy Hours and Days-of-Week scheduling precisely filter activation (Tue 17:30 = 70, Tue 21:00 = 100, Fri 17:30 = 100)',
    );
  }

  // -------------------------------------------------------------
  // 7. Storefront Offers Engine Synchronization
  // -------------------------------------------------------------
  console.log('\n--- [7] Storefront Offers Engine Synchronization ---');
  {
    const storefrontOffers: RawStorefrontOffer[] = [
      {
        id: 10,
        offer_type: 'bogo',
        value: 100,
        bogo_buy_qty: 1,
        bogo_get_qty: 1,
        bogo_discount_percent: 100,
        is_active: true,
        start_date: '2026-10-01',
        end_date: '2026-10-31',
      },
    ];
    const sfResult = resolveBestStorefrontOffer(100, storefrontOffers, 2, todayIso, undefined, 'Africa/Cairo', 2);
    assert.equal(sfResult.hasDiscount, true);
    assert.equal(sfResult.price, 50);
    assert.equal(sfResult.discountPercent, 50);
    console.log('  ✓ Storefront resolves BOGO matching the backend and POS engine: 50 EGP each');
  }

  // -------------------------------------------------------------
  // 8. Multiple Active Offers - Best Savings for Customer
  // -------------------------------------------------------------
  console.log('\n--- [8] Best-Offer Arbitration Verification ---');
  {
    const offer1: SaleProductOfferRow = {
      offer_type: 'percent',
      value: 10,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    }; // 90 EGP
    const offer2: SaleProductOfferRow = {
      offer_type: 'fixed',
      value: 25,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    }; // 75 EGP (better)
    const offer3: SaleProductOfferRow = {
      offer_type: 'price',
      value: 80,
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    }; // 80 EGP

    const bestPrice = calculateAllowedSaleUnitPrice({
      moneyDigits: 2,
      retailPrice: baseRetail,
      priceType: 'retail',
      offers: [offer1, offer2, offer3],
      qty: 1,
      todayIso,
    });
    assert.equal(bestPrice, 75, 'Best offer offering lowest price (75 EGP) must win');
    console.log('  ✓ Best offer selection confirmed: 75 EGP picked automatically among competing offers');
  }

  console.log('\n================================================================');
  console.log('✅ ALL PROMOTION AND OFFER AUDIT CHECKS PASSED (100% GREEN)');
  console.log('================================================================\n');
}

runComprehensiveOffersAudit().catch((error) => {
  console.error('Audit failed with error:', error);
  process.exit(1);
});
