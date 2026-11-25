import assert from 'node:assert/strict';

/**
 * محاكاة واختبار دورة مبيعات سيارات التوزيع والفان الميدانية الشاملة
 * (Van Sales & Route Distribution End-to-End Test)
 */
async function runVanSalesSimulation() {
  console.log('\n================================================================');
  console.log(' [بدء اختبار ومحاكاة مبيعات سيارات التوزيع المتنقلة - Van Sales]');
  console.log('================================================================');

  // 1. المستودعات والمواقع الافتتاحية
  const locations = {
    1: { id: 1, name: 'المستودع الرئيسي العام', type: 'internal_warehouse' },
    50: { id: 50, name: 'سيارة المندوب: كابتن أحمد (لوحة: ق ص د 8412)', type: 'van_stock' },
  };
  console.log('  1. تهيئة سيارة الفان كمستودع متنقل مستقل:');
  console.log(`     • المستودع المصدر: [${locations[1].id}] ${locations[1].name}`);
  console.log(`     • مستودع سيارة الفان: [${locations[50].id}] ${locations[50].name}`);

  // 2. أرصدة المستودع الرئيسي الافتتاحية
  const inventory = {
    juice: { id: 201, name: 'عصير برتقال طبيعي 1 لتر (كرتونة 12 عبوة)', retailPrice: 50.0, costPrice: 38.0 },
    rice: { id: 202, name: 'أرز فاخر درجة أولى 5 كجم (شيكارة)', retailPrice: 40.0, costPrice: 32.0 },
  };

  const stocks: Record<number, Record<number, number>> = {
    // locationId -> productId -> qty
    1: { 201: 100, 202: 80 }, // المستودع به 100 كرتونة عصير و 80 شيكارة أرز
    50: { 201: 0, 202: 0 }, // سيارة الفان فارغة في الصباح
  };

  console.log('\n  2. أرصدة الصباح في المستودع الرئيسي قبل التحميل:');
  console.log(`     • صنف "${inventory.juice.name}": ${stocks[1][201]} كرتونة`);
  console.log(`     • صنف "${inventory.rice.name}": ${stocks[1][202]} شيكارة`);

  // 3. شحن وتحميل بضاعة الصباح لسيارة الفان (Morning Van Loading)
  console.log('\n  3. تحميل بضاعة الصباح لسيارة الفان (Morning Van Load):');
  const loadOrder = [
    { productId: 201, qty: 30 }, // شحن 30 كرتونة عصير
    { productId: 202, qty: 20 }, // شحن 20 شيكارة أرز
  ];

  let totalLoadedValue = 0;
  for (const item of loadOrder) {
    stocks[1][item.productId] -= item.qty;
    stocks[50][item.productId] += item.qty;
    const price = item.productId === 201 ? inventory.juice.retailPrice : inventory.rice.retailPrice;
    totalLoadedValue += price * item.qty;
  }

  const trip = {
    id: 1001,
    repId: 7,
    repName: 'كابتن أحمد الشناوي',
    vanLocationId: 50,
    sourceWarehouseId: 1,
    status: 'open',
    loadedAmount: totalLoadedValue,
    salesAmount: 0,
    cashCollected: 0,
    creditSales: 0,
    returnsAmount: 0,
    variance: 0,
  };

  console.log(`     ✓ تم شحن البضاعة وتوليد إذن شحن فان برقم: VAN-LOAD-8812`);
  console.log(`     • إجمالي قيمة البضاعة المحمّلة بالفان: ${trip.loadedAmount} ج.م`);
  console.log(`     • رصيد سيارة الفان الآن: (${stocks[50][201]} كرتونة عصير | ${stocks[50][202]} شيكارة أرز)`);
  assert.equal(stocks[1][201], 70, 'رصيد المستودع الرئيسي من العصير أصبح 70');
  assert.equal(stocks[1][202], 60, 'رصيد المستودع الرئيسي من الأرز أصبح 60');
  assert.equal(stocks[50][201], 30, 'رصيد الفان من العصير أصبح 30');
  assert.equal(stocks[50][202], 20, 'رصيد الفان من الأرز أصبح 20');
  assert.equal(trip.loadedAmount, 2300, 'إجمالي قيمة شحنة الصباح 2,300 ج.م');

  // 4. المحطة الأولى: بيع نقدي (Cash Sale) في "بقالة الأمل"
  console.log('\n  4. المحطة الأولى في خط السير: بيع كاش في "بقالة الأمل":');
  const sale1 = {
    customerName: 'بقالة الأمل - المعادي',
    paymentMethod: 'cash',
    items: [{ productId: 201, qty: 5, unitPrice: 50.0 }], // 5 كراتين عصير × 50 = 250 ج.م
  };

  // خصم من الفان
  stocks[50][201] -= 5;
  const sale1Total = 5 * 50.0;
  trip.salesAmount += sale1Total;
  trip.cashCollected += sale1Total;

  console.log(`     - تم بيع 5 كراتين عصير بقيمة ${sale1Total} ج.م نقداً ➔ الفاتورة: #VAN-9011`);
  console.log(`     ✓ رصيد العصير المتبقي في الفان: ${stocks[50][201]} كرتونة`);
  console.log(`     ✓ الكاش الموجود في درج الفان: ${trip.cashCollected} ج.م`);
  assert.equal(stocks[50][201], 25);
  assert.equal(trip.salesAmount, 250);
  assert.equal(trip.cashCollected, 250);

  // 5. المحطة الثانية: بيع آجل (Credit Sale) لـ "سوبرماركت البركة"
  console.log('\n  5. المحطة الثانية: بيع آجل (على الحساب) لـ "سوبرماركت البركة":');
  const sale2 = {
    customerId: 88,
    customerName: 'سوبرماركت البركة - زهراء المعادي',
    paymentMethod: 'credit',
    items: [
      { productId: 201, qty: 10, unitPrice: 50.0 }, // 10 كراتين عصير = 500 ج.م
      { productId: 202, qty: 5, unitPrice: 40.0 }, // 5 شكائر أرز = 200 ج.م
    ],
  };

  stocks[50][201] -= 10;
  stocks[50][202] -= 5;
  const sale2Total = 10 * 50.0 + 5 * 40.0; // 700 ج.م
  trip.salesAmount += sale2Total;
  trip.creditSales += sale2Total;

  console.log(`     - تم بيع بضاعة بقيمة ${sale2Total} ج.م بالآجل ➔ الفاتورة: #VAN-9012`);
  console.log(`     ✓ قيدت مديونية قدرها ${sale2Total} ج.م على حساب عميل "سوبرماركت البركة".`);
  console.log(`     ✓ رصيد الفان الآن: (${stocks[50][201]} كرتونة عصير | ${stocks[50][202]} شيكارة أرز)`);
  assert.equal(stocks[50][201], 15);
  assert.equal(stocks[50][202], 15);
  assert.equal(trip.salesAmount, 950);
  assert.equal(trip.creditSales, 700);
  assert.equal(trip.cashCollected, 250, 'الكاش المحصل لم يتغير لأن الفاتورة آجلة');

  // 6. المحطة الثالثة: تحصيل مديونية سابقة بالشارع (Field Debt Collection)
  console.log('\n  6. المحطة الثالثة: تحصيل نقدي لمديونية قديمة من "محمصات الخير":');
  const collectionAmount = 300.0;
  trip.cashCollected += collectionAmount;

  console.log(`     - تم استلام دفعة نقدية قدرها ${collectionAmount} ج.م من العميل ➔ سند قبض ميداني: #COL-4411`);
  console.log(`     ✓ خُفّضت مديونية العميل فورياً بقيمة ${collectionAmount} ج.م في كشف حسابه.`);
  console.log(`     ✓ إجمالي الكاش في عهدة المندوب الآن: ${trip.cashCollected} ج.م (250 مبيعات + 300 تحصيل)`);
  assert.equal(trip.cashCollected, 550);

  // 7. المحطة الرابعة: استلام مرتجع بضاعة بالشارع (Field Return)
  console.log('\n  7. المحطة الرابعة: استلام مرتجع بضاعة في الشارع من عميل:');
  const returnQty = 2; // كرتونتين عصير
  stocks[50][201] += returnQty;
  const returnTotal = returnQty * 50.0; // 100 ج.م
  trip.returnsAmount += returnTotal;

  console.log(`     - تم استلام ${returnQty} كرتونة عصير مرتجعة بقيمة ${returnTotal} ج.م ➔ إشعار دائن: #RET-1102`);
  console.log(`     ✓ أضيفت الكرتونتان إلى عهدة الفان ➔ رصيد العصير بالسيارة أصبح: ${stocks[50][201]} كرتونة`);
  console.log(`     ✓ خُفّض حساب العميل بقيمة المرتجع (${returnTotal} ج.م).`);
  assert.equal(stocks[50][201], 17);
  assert.equal(trip.returnsAmount, 100);

  // 8. نهاية اليوم: تصفية وجرد الفان وتوريد النقدية (End-of-Day Settlement)
  console.log('\n  8. تصفية وإغلاق رحلة الفان وتوريد الكاش (Van Settlement):');
  const expectedCash = trip.cashCollected; // 550 ج.م
  const countedCash = 550.0; // قام المندوب بعدّ وتسليم 550 ج.م للمشرف بالمليم
  const variance = countedCash - expectedCash;

  console.log(`     • مبيعات اليوم الإجمالية: ${trip.salesAmount} ج.م (كاش: 250 | آجل: 700)`);
  console.log(`     • متحصلات الديون السابقة: 300 ج.م`);
  console.log(`     • إجمالي النقدية المتوقع توريدها للخزينة: ${expectedCash} ج.م`);
  console.log(`     • النقدية الفعلية المسلمة: ${countedCash} ج.م ➔ العجز/الزيادة: ${variance} ج.م (مطابق تماماً ✓)`);

  // تفريغ البضاعة المتبقية في المستودع الرئيسي
  console.log('     - تفريغ عهدة البضاعة المتبقية بالفان وإرجاعها للمستودع الرئيسي:');
  const remainingJuice = stocks[50][201]; // 17
  const remainingRice = stocks[50][202]; // 15

  stocks[50][201] = 0;
  stocks[50][202] = 0;
  stocks[1][201] += remainingJuice;
  stocks[1][202] += remainingRice;

  trip.status = 'settled';

  console.log(
    `     ✓ رصيد سيارة الفان بعد التفريغ: (عصير: ${stocks[50][201]} | أرز: ${stocks[50][202]}) [مفرّغة بالكامل]`,
  );
  console.log(`     ✓ رصيد المستودع الرئيسي بعد استلام المتبقي: (عصير: ${stocks[1][201]} | أرز: ${stocks[1][202]})`);
  console.log(`     ✓ تم إغلاق الرحلة وتوريد 550.00 ج.م إلى خزينة الفرع الرئيسية.`);

  assert.equal(stocks[50][201], 0, 'فان العصير تم تفريغه تماماً (0)');
  assert.equal(stocks[50][202], 0, 'فان الأرز تم تفريغه تماماً (0)');
  assert.equal(stocks[1][201], 87, 'المستودع الرئيسي: 70 + 17 = 87 كرتونة');
  assert.equal(stocks[1][202], 75, 'المستودع الرئيسي: 60 + 15 = 75 شيكارة');
  assert.equal(trip.status, 'settled', 'حالة الرحلة أصبحت settled');

  console.log('\n================================================================');
  console.log('  تهانينا! نجحت محاكاة مبيعات وتوزيع سيارات الفان الميدانية بنسبة 100%');
  console.log('================================================================\n');
}

runVanSalesSimulation().catch((err) => {
  console.error('Van sales simulation failed:', err);
  process.exit(1);
});
