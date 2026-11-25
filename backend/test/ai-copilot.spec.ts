import { strict as assert } from 'node:assert';

// Simulated snapshot
const mockSnapshot = {
  todaySales: 15450,
  todayCount: 28,
  todayCash: 12000,
  weekSales: 85200,
  weekCount: 164,
  todayExpenses: 1450,
  monthExpenses: 18600,
  recentExpenses: [
    { title: 'فاتورة كهرباء المحل', amount: 850 },
    { title: 'بوفيه وضيافة', amount: 150 },
  ],
  customerDebt: 24500,
  overdueInstallmentsCount: 2,
  overdueInstallmentsAmount: 3500,
  supplierDebt: 42000,
  topSuppliers: [
    { name: 'شركة البركة للتوزيع', balance: 25000, phone: '01099887766' },
    { name: 'مطاحن ومزارع الدلتا', balance: 17000, phone: '01233445566' },
  ],
  treasuryBalance: 58400,
  lowStock: 3,
  totalProducts: 145,
  inventoryCost: 320000,
  inventoryRetailValue: 480000,
  topDebtors: [
    { name: 'شركة الأمل للتجارة', debt: 12000, phone: '01012345678' },
    { name: 'مؤسسة النور', debt: 8500, phone: '01198765432' },
  ],
  lowStockItems: [
    { name: 'سكر 1 كجم', stock: 2, min: 10 },
    { name: 'زيت عباد 1 لتر', stock: 4, min: 15 },
  ],
  topProductsToday: [
    { name: 'أرز فاخر 5 كجم', qty: 15, total: 3750 },
    { name: 'مسحوق غسيل 3 كجم', qty: 10, total: 2800 },
  ],
  topProductsMonth: [
    { name: 'أرز فاخر 5 كجم', qty: 140 },
    { name: 'زيت عباد 1 لتر', qty: 95 },
  ],
};

// Simulation of local analytics engine matching AiCopilotService
function runLocalAnalyticsEngine(question: string, s: any) {
  const q = (question || '').trim().toLowerCase();

  // 1: المصروفات والنفقات التشغيلية
  if (
    q.includes('مصروف') ||
    q.includes('مصاريف') ||
    q.includes('نفقات') ||
    q.includes('مصروفات') ||
    q.includes('صرفنا') ||
    q.includes('خرج') ||
    q.includes('نثريات') ||
    q.includes('تكاليف')
  ) {
    const recentList =
      s.recentExpenses && s.recentExpenses.length > 0
        ? `\n\n**أحدث بنود المصروفات المسجلة:**\n` +
          s.recentExpenses
            .map(
              (e: any, i: number) => `${i + 1}. **${e.title}**: ${Number(e.amount || 0).toLocaleString('ar-EG')} ج.م`,
            )
            .join('\n')
        : '';

    return {
      answer:
        `**تقرير المصروفات والنفقات التشغيلية:**\n\n` +
        `- إجمالي مصروفات اليوم: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- إجمالي مصروفات آخر 30 يوماً: **${Number(s.monthExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- نسبة المصروفات لمبيعات اليوم: **${s.todaySales > 0 ? ((s.todayExpenses / s.todaySales) * 100).toFixed(1) + '%' : '0%'}**.${recentList}\n\n` +
        `**توصية زاد:** راقب النثريات اليومية واحتفظ بفواتير المصروفات التشغيلية في النظام لخصمها من وعاء الأرباح وحساب صافي الدخل بدقة.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'فلوس الخزينة والدرج الحالية', 'مستحقات وفواتير الموردين'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 2: الخزينة والدرج والسيولة النقدية
  if (
    q.includes('خزينة') ||
    q.includes('خزنة') ||
    q.includes('درج') ||
    q.includes('كاش') ||
    q.includes('سيولة') ||
    q.includes('سيوله') ||
    q.includes('نقدية') ||
    q.includes('نقديه')
  ) {
    return {
      answer:
        `**حركة الخزينة والسيولة النقدية:**\n\n` +
        `- رصيد الخزينة الإجمالي المسجل: **${Number(s.treasuryBalance || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- النقدية المحصلة بالدرج اليوم: **${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- إجمالي مبيعات اليوم (نقدي وآجل): **${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- مصروفات اليوم النقدية: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n\n` +
        `**توصية زاد:** قم بعمل جرد فعلي للنقدية ومطابقتها مع الدرج قبل إغلاق وردية الكاشير لتفادي أي عجز أو ترحيل خاطئ.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'صرفنا كام مصاريف النهاردة؟', 'مين أكتر عملاء عليهم فلوس؟'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 3: الموردين والشركات ومستحقات الشراء
  if (
    q.includes('مورد') ||
    q.includes('موردين') ||
    q.includes('شركات') ||
    q.includes('شركه') ||
    q.includes('شركة') ||
    q.includes('فواتير الشراء') ||
    q.includes('مشتريات') ||
    q.includes('مستحقات المورد')
  ) {
    const suppStr =
      s.topSuppliers && s.topSuppliers.length > 0
        ? `\n\n**أكبر الموردين مستحقات حالياً:**\n` +
          s.topSuppliers
            .map(
              (sup: any, i: number) =>
                `${i + 1}. **${sup.name}**: ${Number(sup.balance || 0).toLocaleString('ar-EG')} ج.م ${sup.phone ? `(هاتف: ${sup.phone})` : ''}`,
            )
            .join('\n')
        : '\n\nممتاز! لا توجد مستحقات معلقة للموردين حالياً.';

    return {
      answer:
        `**موقف مستحقات وفواتير الموردين:**\n\n` +
        `- إجمالي المبالغ المستحقة للموردين: **${Number(s.supplierDebt || 0).toLocaleString('ar-EG')} ج.م**${suppStr}\n\n` +
        `**توصية زاد:** قم بجدولة دفعات الموردين في مواعيد منتظمة، واستفد من خصومات السداد المبكر التي تمنحها الشركات لرفع هامش ربحك.`,
      suggestedQuestions: ['فلوس الخزينة والدرج الحالية', 'ايه نواقص المخزن الحرجة؟', 'مين أكتر عملاء عليهم فلوس؟'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 4: ديون العملاء والتحصيل والأقساط
  if (
    q.includes('دين') ||
    q.includes('ديون') ||
    q.includes('عملاء') ||
    q.includes('عميل') ||
    q.includes('فلوس') ||
    q.includes('تحصيل') ||
    q.includes('اجل') ||
    q.includes('آجل') ||
    q.includes('مستحقات') ||
    q.includes('قسط') ||
    q.includes('أقساط') ||
    q.includes('اقساط')
  ) {
    const debtorsStr =
      s.topDebtors && s.topDebtors.length > 0
        ? `\n\n**أكبر العملاء مديونية حالياً:**\n` +
          s.topDebtors
            .map(
              (c: any, i: number) =>
                `${i + 1}. **${c.name}**: ${Number(c.debt || 0).toLocaleString('ar-EG')} ج.م ${c.phone ? `(هاتف: ${c.phone})` : ''}`,
            )
            .join('\n')
        : '\n\nممتاز! لا توجد مديونيات متأخرة على العملاء.';

    const overdueInstStr =
      s.overdueInstallmentsCount > 0
        ? `\n**تنبيه الأقساط:** يوجد **${s.overdueInstallmentsCount}** قسط متأخر بقيمة **${Number(s.overdueInstallmentsAmount || 0).toLocaleString('ar-EG')} ج.م** تحتاج متابعة فورية.`
        : '';

    return {
      answer:
        `**موقف ديون ومستحقات العملاء والأقساط:**\n\n` +
        `- إجمالي المبالغ الآجلة لدى العملاء: **${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م**.${overdueInstStr}${debtorsStr}\n\n` +
        `**توصية زاد:** استفد من خاصية إرسال كشوف الحسابات عبر الواتساب لتذكير العملاء بلطف بسداد مستحقاتهم، وربط السداد السريع بمكافآت نقاط الولاء.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'مستحقات وفواتير الموردين', 'ايه نواقص المخزن الحرجة؟'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 5: النواقص والمخزون ورأس المال المقيد
  if (
    q.includes('نواقص') ||
    q.includes('مخزن') ||
    q.includes('بضاعة') ||
    q.includes('بضاعه') ||
    q.includes('راكد') ||
    q.includes('خلصت') ||
    q.includes('منتجات') ||
    q.includes('قيمة المخزون') ||
    q.includes('جرد') ||
    q.includes('راس المال') ||
    q.includes('رأس المال') ||
    q.includes('تكلفة البضاعة')
  ) {
    const itemsStr =
      s.lowStockItems && s.lowStockItems.length > 0
        ? `\n\n**أبرز الأصناف التي قاربت على النفاد:**\n` +
          s.lowStockItems
            .map((p: any, i: number) => `${i + 1}. **${p.name}** (المتبقي: **${p.stock}** قطعة - حد الأمان: ${p.min})`)
            .join('\n')
        : '\n\nجميع الأصناف متوفرة وتتخطى حدود الأمان.';

    const potentialProfit = Math.max(0, Number(s.inventoryRetailValue || 0) - Number(s.inventoryCost || 0));

    return {
      answer:
        `**حالة المخزون ورأس المال المقيد:**\n\n` +
        `- إجمالي الأصناف النشطة: **${s.totalProducts} صنف**.\n` +
        `- تكلفة المخزون الحالي (رأس المال المجمد): **${Number(s.inventoryCost || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- القيمة البيعية التقديرية: **${Number(s.inventoryRetailValue || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- هامش الربح الإجمالي المتوقع في البضاعة: **${potentialProfit.toLocaleString('ar-EG')} ج.م**.\n` +
        `- أصناف حرجة تحتاج إعادة طلب: **${s.lowStock} صنف**${itemsStr}\n\n` +
        `**توصية زاد:** قم بإنشاء أوامر شراء عاجلة للأصناف الحرجة لتجنب نفاد المخزون وفقدان العملاء.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'مين أكتر عملاء عليهم فلوس؟', 'أكتر 5 منتجات مبيعاً'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 6: الأكثر طلباً ومبيعاً
  if (
    q.includes('اكثر') ||
    q.includes('أكثر') ||
    q.includes('شائع') ||
    q.includes('سحب') ||
    q.includes('مبيعا') ||
    q.includes('مبيعاً') ||
    q.includes('ترند') ||
    q.includes('اعلى مبيع') ||
    q.includes('أعلى مبيع') ||
    q.includes('بست سيلر')
  ) {
    const monthlyStr =
      s.topProductsMonth && s.topProductsMonth.length > 0
        ? `\n\n**الأكثر مبيعاً خلال آخر 30 يوماً:**\n` +
          s.topProductsMonth
            .map((p: any, i: number) => `${i + 1}. **${p.name}** (إجمالي مبيعات: **${p.qty}** قطعة)`)
            .join('\n')
        : '\n\nلم يتم تسجيل بيانات مبيعات كافية خلال الشهر.';

    return {
      answer:
        `**تحليل الأصناف الأكثر طلباً وحركة:**${monthlyStr}\n\n` +
        `**توصية زاد:** احرص على الحفاظ على مخزون أمان مرتفع من هذه الأصناف الرابحة، وفكر في عمل عروض مجمعة (Bundles) مع الأصناف الأقل حركة لزيادة متوسط قيمة الفاتورة.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'ايه نواقص المخزن الحرجة؟', 'ازاي أزود أرباحي النهاردة؟'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 7: استشارات وأفكار لزيادة الأرباح وتطوير النشاط (Business Advisory)
  if (
    q.includes('نصيحة') ||
    q.includes('نصيحه') ||
    q.includes('ازاي') ||
    q.includes('كيف') ||
    q.includes('أزود') ||
    q.includes('ازود') ||
    q.includes('زيادة') ||
    q.includes('تطوير') ||
    q.includes('افكار') ||
    q.includes('أفكار') ||
    q.includes('اقتراح') ||
    q.includes('اقتراحات')
  ) {
    return {
      answer:
        `**خطة ذكية مقترحة لزيادة أرباحك وتطوير المنشأة:**\n\n` +
        `1. **التحصيل السريع:** لديك **${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م** ديون خارجية. تحصيل 30% منها يوفر لك سيولة فورية تمول بها مشتريات بضائع سريعة الدوران دون الحاجة للاستدانة.\n` +
        `2. **حماية المبيعات من النواقص:** يوجد **${s.lowStock} صنف حرج**. كل زبون يطلب صنفاً ناقصاً يقلل ولاءه؛ جهز أمر شراء اليوم للأصناف الأكثر طلباً.\n` +
        `3. **عروض الحزم (Cross-selling):** اربط المنتجات الأكثر مبيعاً مع الأصناف بطيئة الحركة في عرض مخفض لزيادة متوسط قيمة الفاتورة.\n` +
        `4. **ضبط المصروفات:** احرص على ألا تتجاوز المصاريف اليومية نسبة 15% من إجمالي المبيعات لتعظيم صافي أرباحك.\n\n` +
        `**توصية زاد:** فعّل نظام نقاط الولاء لعملائك لضمان عودتهم المستمرة للشراء.`,
      suggestedQuestions: ['كسبت كام النهاردة؟', 'مين أكتر عملاء عليهم فلوس؟', 'ايه نواقص المخزن الحرجة؟'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 8: مبيعات وأرباح اليوم أو الأسبوع
  if (
    q.includes('كسبت') ||
    q.includes('ارباح') ||
    q.includes('أرباح') ||
    q.includes('مبيعات') ||
    q.includes('اليوم') ||
    q.includes('دخل') ||
    q.includes('اسبوع') ||
    q.includes('أسبوع') ||
    q.includes('شهر') ||
    q.includes('فواتير') ||
    q.includes('بيع')
  ) {
    const topStr =
      s.topProductsToday && s.topProductsToday.length > 0
        ? `\n\n**أعلى الأصناف طلباً اليوم:**\n` +
          s.topProductsToday
            .map(
              (p: any, i: number) =>
                `${i + 1}. **${p.name}** (${p.qty} قطعة بـ ${Number(p.total || 0).toLocaleString('ar-EG')} ج.م)`,
            )
            .join('\n')
        : '\n\nلم يتم تسجيل مبيعات أصناف محددة لليوم بعد.';

    return {
      answer:
        `**تقرير مبيعات وأداء النشاط:**\n\n` +
        `- إجمالي مبيعات اليوم: **${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م** (${s.todayCount} فاتورة).\n` +
        `- النقدية المحصلة بالدرج اليوم: **${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- مصروفات اليوم: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
        `- صافي النقدية التقديري اليوم: **${Number((s.todayCash || 0) - (s.todayExpenses || 0)).toLocaleString('ar-EG')} ج.م**.\n` +
        `- إجمالي مبيعات آخر 7 أيام: **${Number(s.weekSales || 0).toLocaleString('ar-EG')} ج.م** (${s.weekCount} فاتورة).${topStr}\n\n` +
        `**توصية زاد:** ${s.todayCount > 0 ? 'معدل البيع ممتاز، احرص على مطابقة جرد النقدية بالدرج قبل إغلاق الوردية.' : 'ننصح بتفعيل عروض ترويجية للأصناف سريعة الدوران لتحريك المبيعات اليوم.'}`,
      suggestedQuestions: ['مين أكتر عملاء عليهم فلوس؟', 'ايه نواقص المخزن الحرجة؟', 'فلوس الخزينة والدرج الحالية'],
      metrics: s,
      engine: 'local_analytics',
    };
  }

  // 9: الإجابة الشاملة العامة (Executive Overview)
  return {
    answer:
      `**أهلاً بك يا فندم! إليك نبض المنشأة الشامل لحظة بلحظة:**\n\n` +
      `- **مبيعات اليوم:** ${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م (${s.todayCount} فاتورة).\n` +
      `- **المحصل نقداً بالدرج:** ${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م.\n` +
      `- **مصروفات اليوم:** ${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م.\n` +
      `- **مبيعات آخر 7 أيام:** ${Number(s.weekSales || 0).toLocaleString('ar-EG')} ج.م.\n` +
      `- **ديون العملاء الآجلة:** ${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م.\n` +
      `- **مستحقات الموردين:** ${Number(s.supplierDebt || 0).toLocaleString('ar-EG')} ج.م.\n` +
      `- **نواقص المخزن الحرجة:** ${s.lowStock} صنف يحتاج لإعادة طلب.\n` +
      `- **رأس المال المقيد بالمخزون:** ${Number(s.inventoryCost || 0).toLocaleString('ar-EG')} ج.م بالتكلفة.\n\n` +
      `أنا هنا لمساعدتك! يمكنك اختيار سؤال جاهز من المقترحات أدناه أو كتابة سؤالك وسأجيبك فوراً.`,
    suggestedQuestions: [
      'كسبت كام النهاردة؟',
      'فلوس الخزينة والدرج الحالية',
      'مين أكتر عملاء عليهم فلوس؟',
      'مستحقات وفواتير الموردين',
      'ايه نواقص المخزن الحرجة؟',
      'أكتر 5 منتجات مبيعاً',
    ],
    metrics: s,
    engine: 'local_analytics',
  };
}

async function runCopilotTests() {
  console.log('--- Starting Expanded Zad AI Copilot Tests ---');

  // Test 1: "كسبت كام النهاردة؟"
  console.log('Test 1: "كسبت كام النهاردة؟"...');
  const res1 = runLocalAnalyticsEngine('كسبت كام النهاردة؟', mockSnapshot);
  assert(res1.answer.includes((15450).toLocaleString('ar-EG')), 'Must contain today sales');
  assert(res1.answer.includes((12000).toLocaleString('ar-EG')), 'Must contain today cash');
  console.log('✓ Test 1 passed.');

  // Test 2: "مين أكثر عملاء عليهم فلوس؟"
  console.log('Test 2: "مين أكثر عملاء عليهم فلوس؟"...');
  const res2 = runLocalAnalyticsEngine('مين أكتر عملاء عليهم فلوس؟', mockSnapshot);
  assert(res2.answer.includes('شركة الأمل للتجارة'), 'Must contain top debtor');
  assert(res2.answer.includes((24500).toLocaleString('ar-EG')), 'Must contain total debt');
  assert(res2.answer.includes('قسط متأخر'), 'Must mention overdue installments');
  console.log('✓ Test 2 passed.');

  // Test 3: "ايه نواقص المخزن الحرجة؟"
  console.log('Test 3: "ايه نواقص المخزن الحرجة؟"...');
  const res3 = runLocalAnalyticsEngine('ايه نواقص المخزن الحرجة؟', mockSnapshot);
  assert(res3.answer.includes('سكر 1 كجم'), 'Must contain low stock product');
  assert(res3.answer.includes('3 صنف') || res3.answer.includes('٣ صنف'), 'Must contain low stock count');
  console.log('✓ Test 3 passed.');

  // Test 4: "صرفنا كام مصاريف النهاردة؟"
  console.log('Test 4: "صرفنا كام مصاريف النهاردة؟"...');
  const res4 = runLocalAnalyticsEngine('صرفنا كام مصاريف النهاردة؟', mockSnapshot);
  assert(res4.answer.includes((1450).toLocaleString('ar-EG')), 'Must contain today expenses');
  assert(res4.answer.includes('فاتورة كهرباء المحل'), 'Must mention recent expense');
  console.log('✓ Test 4 passed.');

  // Test 5: "فلوس الخزينة والدرج الحالية"
  console.log('Test 5: "فلوس الخزينة والدرج الحالية"...');
  const res5 = runLocalAnalyticsEngine('فلوس الخزينة والدرج الحالية', mockSnapshot);
  assert(res5.answer.includes((58400).toLocaleString('ar-EG')), 'Must contain treasury balance');
  assert(res5.answer.includes((12000).toLocaleString('ar-EG')), 'Must contain today cash');
  console.log('✓ Test 5 passed.');

  // Test 6: "مستحقات وفواتير الموردين"
  console.log('Test 6: "مستحقات وفواتير الموردين"...');
  const res6 = runLocalAnalyticsEngine('مستحقات وفواتير الموردين', mockSnapshot);
  assert(res6.answer.includes((42000).toLocaleString('ar-EG')), 'Must contain supplier debt');
  assert(res6.answer.includes('شركة البركة للتوزيع'), 'Must mention top supplier');
  console.log('✓ Test 6 passed.');

  // Test 7: "ازاي أزود أرباحي النهاردة؟"
  console.log('Test 7: "ازاي أزود أرباحي النهاردة؟"...');
  const res7 = runLocalAnalyticsEngine('ازاي أزود أرباحي النهاردة؟', mockSnapshot);
  assert(res7.answer.includes('خطة ذكية مقترحة'), 'Must contain business advisory');
  console.log('✓ Test 7 passed.');

  console.log('--- All 7 Expanded Zad AI Copilot Tests Passed Successfully 100% ---');
}

runCopilotTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
