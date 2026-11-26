# دستور الأداء — ملف حماية السرعة (Performance Constitution)

> 🔴 **تحذير إلزامي لأي مساعد ذكي (Claude / Gemini / Antigravity / غيره) أو مطوّر:**
> هذا الملف يحمي تحسينات أداء **مقيسة ومُختبَرة**. كل بند فيه كان تباطؤاً حقيقياً وصل للإنتاج **بصمت** —
> لا شيء انكسر وظيفياً، السستم بس بقى تقيل. لذلك لا يكتشفه أي اختبار وظيفي، ولا يظهر في `tsc`.
>
> **قبل أي تعديل** على: `vite.config.ts` · `backend/src/main.ts` · كتالوج الأصناف ونقطة البيع
> (`catalog-product.service.ts`) · كتالوج المتجر العام (`storefront.service.ts:getStorefrontCatalog`) ·
> مكوّنات الـShell (`app-shell` وما يستورده) · أي هجرة فهارس — **اقرأ هذا الملف كاملاً.**
>
> لو حارس من حراس الأداء فشل: **الحارس غالباً على حق.** لا توسّعه ولا تحذفه — انقل الاستيراد الثقيل
> خلف `import()` أو صحّح الحلقة. تعديل الحارس نفسه قرار يحتاج مبرراً مكتوباً هنا.

**تاريخ الاعتماد:** 21 سبتمبر 2026 · **مرجع التفاصيل الفنية:** `ARCHITECTURE_INVARIANTS.md` §2.6

---

## 1. الحُرّاس الآليون (شغّلهم — لا تعتمد على الذاكرة)

| الأمر | ماذا يحرس | في `npm run guards` (الـCI)؟ |
|---|---|---|
| `npm --prefix backend run test:critical` → `performance-hot-paths.spec.ts` | PERF-1 … PERF-4 وPERF-9 وPERF-15 (الباك إند) | ✅ |
| `npm --prefix backend run test:e2e` → `test/e2e/dashboard-overview-aggregates.e2e.ts` | PERF-12 (تطابق حساب SQL الجديد مع القديم على حالات حديّة، داخل معاملة حقيقية تُلغى) | ✅ **26 سبتمبر 2026** — يعمل بعد الهجرات (`test:e2e` يشغَّل بعد `migration:run` في CI) |
| `npm --prefix frontend run test:run` → `pos-catalog-sync-policy.spec.ts` | PERF-9 (متى يعيد الكاشير تحميل الكتالوج) | ✅ |
| `npm --prefix frontend run qa:perf` | PERF-5 … PERF-8 وPERF-11 وPERF-13 وPERF-14 (الواجهة، بلا بيلد) | ✅ |
| `npm --prefix frontend run qa:perf:dist` | ناتج البيلد الفعلي: لا تحميل مسبق لمكتبة ثقيلة + ميزانية حجم ملف الدخول (650KB) | ✅ **من 23 سبتمبر 2026 في `ci.yml`** بعد خطوة البناء مباشرة (البناء يحدث هناك أصلاً). قبلها كان يعتمد على تشغيل يدوي بعد بيلد يطلبه المالك، أي عملياً لم يكن يعمل مع الرفعات |

`qa:perf` يتتبع **شجرة الاستيراد الثابت الكاملة** من `src/main.tsx` ويفشل لو وصل لأي مكتبة ثقيلة،
ويطبع السلسلة كاملة (مين استورد مين) عشان تعرف تصلّح فين.


### PERF-10 — كتالوج المتجر العام يُسلسَل مرة لكل بناء، لا مرة لكل زائر

التخزين المؤقت كان يحفظ **الكائن**، وExpress يعيد `JSON.stringify` له في **كل طلب**. على منشأة
بـ12,140 صنفاً (قياس 24 سبتمبر 2026) يعني ذلك بناء نحو ثلاثة ميجابايت من النصّ لكل زائر، على
نواتين، والبيانات مخزَّنة أصلاً: **التخزين كان يوفّر الاستعلام ولا يوفّر المعالج.**

- `catalogCache` يحفظ `{ data, json }`، والتسلسل يقع حيث يُبنى الكتالوج مرة واحدة.
- `getStorefrontCatalogJson()` تُرجِع النصّ المخزَّن، والمسار العام يردّ به مع
  `@Header('Content-Type', 'application/json; charset=utf-8')` — **بدونها يرسل Express النصّ
  كـ`text/html`.** (تُحقِّق منه تجربةٌ مباشرة: الردّ مطابق بايتاً ببايت لما كان `res.json` يرسله.)
- `?page&pageSize&categoryId&q` تعيد صفحة مُصفّاة داخل SQL بحدّ أقصى **200** صنف، مع
  `totalCount` و`hasMore`.
- **الطلب بلا معاملات يظل يعيد الكتالوج كاملاً.** الواجهة الحالية تبحث وتفرز وتعدّ التصنيفات في
  المتصفح على المصفوفة كاملة، فتغيير الافتراضي يكسر صفحة المتجر. نقل البحث والفرز إلى السيرفر هو
  النصف الباقي، وهو بند مفتوح — انظر `ARCHITECTURE_INVARIANTS.md`.

**ممنوع:** إعادة الكائن من المسار العام (يعيد التسلسل لكل زائر) · إسقاط ترويسة نوع المحتوى ·
سقف صفحة غير محدود.

---

## 2. الثوابت (PERF-1 … PERF-16)

| # | الثابت | الموضع | لماذا (القياس) |
|---|---|---|---|
| **PERF-1** | **ممنوع** تسجيل `ClassSerializerInterceptor` عالمياً | `backend/src/main.ts` | كل الردود صفوف Kysely عادية بلا `@Exclude/@Expose`، فالمُسلسِل كان ينسخ كل رد نسخاً عميقاً بلا فائدة: **~100ms حجب لحلقة الأحداث لكل رد بـ5000 صف**، فوق `JSON.stringify`. لإخفاء حقل: لا تختاره في الـ`select` |
| **PERF-2** | تجميع أرصدة المواقع في **مرور واحد** على صفوف المخزون؛ حلقة الأصناف تقرأ من `Map` فقط. وقوائم المعرّفات التي قد تشمل كل الكتالوج تُرسَل **كمعامل مصفوفة واحد** `productIdAny()` (`= ANY($1::bigint[])`) لا `IN (?, ?, …)` | `catalog-product.service.ts:resolveScopedStockByProduct` و`buildListProductsContext` | الحلقة القديمة `stockRows.filter(...)` لكل صنف = O(أصناف × صفوف): **~13 ثانية حجب كامل للسيرفر** لمزامنة كتالوج نقطة بيع بـ20 ألف صنف (وتتكرر مع كل تغيير نسخة الكتالوج). بعد الإصلاح: أجزاء من الثانية. و`IN` بمعامل لكل معرّف: Postgres يرفض أكثر من 65,535 معاملاً → **صفحة الأصناف كانت ستنهار** عند مستأجر بكتالوج كبير |
| **PERF-3** | فهارس المسارات الساخنة في هجرة **136**، وحذف 5 فهارس **مكررة تماماً وغير فريدة** | `2040000000136_performance_hot_path_indexes.ts` | `held_sales` و`tenant_subscriptions` بلا أي فهرس بالمستأجر؛ `treasury_transactions` تُقرأ بالمستأجر+التاريخ والفهرس الموجود يبدأ بالفرع؛ `purchase_items` بلا فهرس بالصنف. والمكررات كانت تضاعف كلفة كتابة `journal_entry_lines` مع **كل فاتورة مرحّلة**. **ممنوع** حذف فهرس فريد أو مفتاح أساسي بحجة التكرار |
| **PERF-4** | كتالوج المتجر العام: **Stale-While-Revalidate حقيقي** + القراءات الخمس بعد تحديد المستأجر تجري **بالتوازي** | `storefront.service.ts:getStorefrontCatalog` | كان أول زائر بعد كل دقيقة ينتظر إعادة البناء كاملة (5 استعلامات متتالية). الآن يأخذ النسخة المخزنة فوراً والتحديث في الخلفية. الأسعار/المخزون المعروضة **للعرض فقط** — إنشاء الطلب يعيد التسعير والتحقق من المخزون على السيرفر (SF-7/SF-8)، فلا أثر مالي |
| **PERF-5** | `manualChunks` يطابق **اسم الحزمة بالضبط**، ويثبّت مساعدات التشغيل المشتركة (`vite/preload-helper`، `commonjsHelpers`، `@babel/runtime`، `tslib`) في `vendor-runtime`، و`use-sync-external-store`/`react-is` في `vendor-react` | `frontend/vite.config.ts` | Rollup يسحب أي تبعية مشتركة **غير مُعيَّنة** داخل الـchunk اليدوي الذي يستخدمها. مساعد التحميل المسبق كان داخل `vendor-jspdf`، فكل صفحة — **بما فيها المتجر العام للعملاء** — كانت تحمّل **~390KB من jsPDF** عند الفتح. و`'/react/'` كنص فرعي كان يطابق `@sentry/react` |
| **PERF-6** | ماسح الكاميرا (`html5-qrcode` + zxing، ~335KB) يُحمَّل **عند أول فتح فقط** | `CameraBarcodeScannerModal.tsx` (غلاف كسول) ← `CameraBarcodeScannerView.tsx` (التنفيذ) | الـShell يستورد المودال (`MobileQuickActionSheet` → `PriceStockCheckerModal`)، فكان الماسح في حزمة البداية لكل صفحة. **ممنوع** استيراد `CameraBarcodeScannerView` مباشرة |
| **PERF-7** | `@sentry/react` يُحمَّل **فقط لو تتبع الأخطاء مفعّل** | `frontend/src/lib/error-tracking.ts` | كان مستورداً ثابتاً في `main.tsx` و`SilentErrorBoundary`، يدفع ثمنه كل مستخدم والتتبع مطفأ افتراضياً. **ممنوع** `import … from '@sentry/react'` خارج هذا الملف |
| **PERF-8** | مودال استيراد المقايسة (`pdfjs-dist` ~1MB) يُحمَّل عند الفتح | `LazyImportBoqModal.tsx` | كان داخل chunk تخطيط المقاولات (1.48MB) ويُنزَّل مع كل صفحة مقاولات. **ممنوع** استيراد `ImportBoqModal` مباشرة |
| **PERF-9** | **كتالوج الكاشير المحلي (للبيع بدون إنترنت) لا يُعاد تحميله إلا لو الكتالوج تغيّر فعلاً أو مرّت ساعة.** رقم النسخة يُبنى من `products.catalog_updated_at` (يحدّثه **trigger** في قاعدة البيانات عند أي تغيير في الصنف **ما عدا** `stock_qty`/`reserved_qty`/`cost_price`) + `MAX(updated_at)` للوحدات والعروض + أعداد الأصناف والوحدات والعروض النشطة. **ممنوع** الرجوع لـ`products.updated_at` في النسخة، و**ممنوع** حذف/تصغير نسخة IndexedDB أو مسارات الرجوع لها في `usePosCatalog`/`PosWorkspace` | `catalog-product.service.ts:getPosCatalogVersion` · `catalog/engines/pos-catalog-version.engine.ts` · هجرة 137 · `frontend/src/features/pos/lib/pos-catalog-sync-policy.ts` | `applyStockDelta` يحدّث `products.updated_at` مع كل بيعة، فكان أي بيع في أي فرع يغيّر النسخة ⇒ **كل كاشير يعيد تحميل حتى 25 ألف صنف كل 5 دقائق طول اليوم**. الـtrigger بدل تحديث العمود من الكود لأن الأسعار تُكتب من أماكن كثيرة (شاشة الصنف، مركز التسعير، حماية الهامش، الاستيراد، الاستعادة) — عمود يعتمد على تذكّر كل كاتب هو بالضبط نمط «المنطق الصحيح غير الموصول». أي عمود يُضاف مستقبلاً للأصناف يُعتبر تغييراً في الكتالوج افتراضياً (الفشل الآمن = تحميل زائد لا سعر قديم) |
| **PERF-11** | حاوية الواجهة في الإنتاج (Docker، `docker-compose.saas.yml`/`.prod.yml`/`.yml`) تخدم `dist` عبر nginx بترويسة `gzip on` وترويسات `Cache-Control` صحيحة (`no-cache` لـ`index.html`، `public, immutable` لـ`/assets/`) — مطابقة لـ`deploy/nginx/oracle-site.conf` | `frontend/nginx.conf` · `frontend/Dockerfile` | إعداد nginx القديم كان مولَّداً بسطر `printf` واحد **بلا `gzip` وبلا أي `Cache-Control`**، فكل حِزَم JS/CSS (تشمل حزمة تشغيل الصفحة الرئيسية) كانت تُنزَّل كاملة بلا ضغط في كل زيارة أولى، ولا يُخزَّن أي أصل مؤقتاً في المتصفح حتى للزيارات المتكررة على نفس النسخة |
| **PERF-12** | لوحة التحكم الرئيسية (`ReportsService.dashboardOverview`) تحسب `productsCount`/`lowStockCount`/`outOfStockCount`/`inventoryCost`/`inventorySaleValue`/`customersCount`/`suppliersCount`/`customerDebt`/`supplierDebt`/`nearCreditLimit`/`aboveCreditLimit`/`highSupplierBalances`/أعلى 5 عملاء/أعلى 5 موردين **بالكامل في SQL** (`COUNT`/`SUM`، بعضها بـ`FILTER`، وبعضها بـJOIN على جدول فرعي مجمَّع لكل شريك) — لا يوجد أي استعلام يسحب كل صف نشط من `products`/`customers`/`suppliers` بعد الآن | `reports.service.ts:dashboardOverview` · `reports-dashboard.helper.ts` (`buildInventorySnapshot`, `buildPartnerExposureSnapshot` — بقيتا لتشكيل الناتج فقط، لا لحساب المجاميع) | كانت (PO-2 سابقاً) تسحب كل صنف/عميل/مورد نشط للمنشأة كصفوف كاملة وتُجمِّع/تُصفِّي في Node — خطي بحجم الكتالوج على كل تحميل للصفحة الرئيسية. **جُرِّبت المعادلة الجديدة مقابل القديمة** بحالات حديّة (صنف بحد أدنى = صفر لا يُحسب "منخفض المخزون"، شريك معطَّل يُستبعد من العدّ لكن رصيده في الليدجر يبقى داخل الإجمالي العام كالقديم تماماً، شريك عند حافة حد الائتمان بالضبط، شريك بلا أي حركة ليدجر) داخل معاملة حقيقية على Postgres تُلغى (`ROLLBACK`) دائماً — طابقت النتيجتان في كل حالة. الحارس الدائم: `test/e2e/dashboard-overview-aggregates.e2e.ts` (`npm run test:e2e:reports`، داخل `test:e2e`) |
| **PERF-13** | لا تحميل شامل لوحدات جميع الصفحات بعد فتح التطبيق؛ التحميل المسبق يحدث للوجهة التي يشير إليها المستخدم فقط | `app-shell.tsx` · `lazy-route.tsx` · `route-prefetch.ts` | التحميل الشامل كان يحمّل وحدات نحو 153 مساراً بالتتابع ويستهلك الشبكة والمعالج أثناء عمل الكاشير. الحارس: `qa:perf` |
| **PERF-14** | قراءة مسودة نقطة البيع من `localStorage` مرة واحدة عند تركيب الشاشة، لا مع كل إعادة رسم أو ضغطة مفتاح | `usePosWorkspaceState.ts` | `localStorage` و`JSON.parse` يحجبان خيط الواجهة، والمسودة كانت تُقرأ مجدداً أثناء الكتابة وتغيير السلة. الحارس: `qa:perf` |
| **PERF-15** | قراءة إعدادات البيع عند غياب الكاش تتم على اتصال المعاملة الحالية، وتقتصر على مفاتيح البيع | `sales-write.service.ts:getTenantSettingsMap` | القراءة السابقة عبر `this.db` كانت تطلب اتصالاً ثانياً بينما معاملة البيع تحجز اتصالها. مع عدد معاملات يساوي حجم المسبح، تنتظر كلها الاتصال الإضافي حتى المهلة. الحارس: `performance-hot-paths.spec.ts` |
| **PERF-16** | استعلامات تقارير المدير والتنبيهات في الرئيسية تبدأ بعد وصول الملخص الأساسي، حتى لا تتزاحم معه على اتصالات قاعدة البيانات عند الفتح الأول | `DashboardPage.tsx` · `useDashboardManagerOverview.ts` · `useManagerActions.ts` | الرئيسية تطلق ملخصاً يحسب عدة تجميعات SQL؛ إضافة تقارير المدير بالتوازي تؤخر ظهورها. الحارس: `DashboardPage.manager-actions.spec.tsx` |
| **PERF-17** | تجميد التابات الخاملة في مساحات العمل المتعددة (`KeepAliveTabPane` بـ `React.memo`) والتحميل الكسول للتاب عند أول زيارة (`visitedTabs`) | `MaritimeLayout.tsx` · `ContractingLayout.tsx` | يمنع إعادة رسم الجداول المخفية في الذاكرة وتخطي السيرفر، ويحقق سرعة تنقل لحظية (0ms - 15ms) دون أي إعادة رسم أو حجب لخيط الواجهة الرئيسي |
| **PERF-18** | عدادات شارات التابات تُحسب حصرياً باستعلام SQL تجميعي مجمع (`/counts` أو `COUNT(*)`)؛ **ممنوع** سحب الجداول بمصفوفاتها لحساب `.length` للشارات | `maritime-freight.service.ts:getCounts` · `maritime-freight.controller.ts` | سحب الجداول الكاملة يملأ مسبح اتصالات المتصفح (Max 6 TCP connections) ويخلق طوابير انتظار شبكية تؤدي لسقوط الطلبات بـ Timeout وظهور شاشات فارغة وهمية |
| **PERF-19** | مسار الكاشير الساخن (مسح الباركود ← حفظ البيع `POST /api/sales` ← الطباعة الصامتة والعادية): مطابقة الباركود في الذاكرة بفهرس `O(1)` عبر `WeakMap` (`pos-workspace.helpers.ts`)، تجميع استعلامات الحسابات المحاسبية والتشغيلات والسيريالات واللوطات وقوائم الأسعار مرة واحدة قبل حلقة الأصناف، كاش تهيئة شجرة الحسابات (`AccountingTenantFoundationService`) عند عدم وجود تعديلات غير مرحّلة، وإبقاء محركات الطباعة الصامتة دافئة في الذاكرة (`Program.cs` عبر `/internal/print-doc` من الـ RAM بلا ملفات `%TEMP%` وبلا `Thread.Sleep` على خيط `STA` + استرداد مؤجل بعد الطباعة + خط `/events` مفتوح + تجهيز متوازٍ `/api/printer/warm` أثناء طيران `POST /api/sales`، و`thermal-label-printer.cjs` في Electron) بلا مسح `InstalledPrinters` وبلا فحص عشوائي لمنفذ `9100` وبلا تأخيرات `setTimeout(220ms+)` | `pos-workspace.helpers.ts` · `PosProductsPanel.tsx` · `browser.ts` · `pos-printing.ts` · `hardware-bridge-client.ts` · `createPosWorkspaceAsyncActions.ts` · `PosWorkspace.tsx` · `tools/z-systems-bridge/Program.cs` · `thermal-label-printer.cjs` · `insert-sale-and-stock.ts` · `prepare-sale-items.ts` · `post-sale.ts` · `accounting-tenant-foundation.service.ts` | يلغي البحث الخطي المتكرر لـ20+ ألف صنف مع كل ضربة باركود، ويختصر عشرات الاستعلامات المتسلسلة داخل قفل المخزون والترحيل المحاسبي، ويلغي تأخير فحص الملفات بـ Windows Defender وتأخير `~1,000ms–2,000ms` في الطباعة الصامتة عبر الجسر أو Electron |

---

## 3. الأنماط المحظورة للأداء (راجعها قبل أي كود جديد)

| # | النمط المحظور | البديل |
|---|---|---|
| P1 | `array.filter/find/some/reduce` على نتيجة استعلام **داخل حلقة** على نتيجة استعلام آخر (O(N×M)) | ابنِ `Map`/`Set` في مرور واحد ثم اقرأ منه |
| P2 | استعلام قاعدة بيانات داخل `for` على صفوف (N+1) في مسار قراءة | استعلام واحد بـ`= ANY(...)` ثم تجميع في `Map` |
| P3 | `where('x', 'in', ids)` حيث `ids` قد تكون **كل** صفوف المستأجر | `sql\`col = ANY(${ids}::bigint[])\`` (انظر `productIdAny`) |
| P4 | `await` متتالية لاستعلامات **مستقلة** في مسار يراه المستخدم | `Promise.all([...])` (خارج المعاملات فقط؛ داخل `trx` الترتيب قد يكون مقصوداً لأجل الأقفال — §2.1) |
| P5 | Interceptor/Middleware عالمي يمشي على جسم الرد كله (تسلسل، تحويل، تنظيف) | لا شيء عالمي على الرد؛ اختر الحقول في الاستعلام |
| P6 | `import` ثابت لمكتبة ثقيلة (`jspdf`, `html2canvas`, `xlsx`, `recharts`, `html5-qrcode`, `pdfjs-dist`, `@sentry/react`, `browser-image-compression`) من أي ملف يصله الـShell | `await import('lib')` داخل الدالة، أو `React.lazy` للمكوّن. `qa:perf` يرفضها آلياً |
| P7 | قاعدة `manualChunks` بنص فرعي فضفاض (`id.includes('react')`) أو إضافة مكتبة لـchunk يدوي دون التأكد أن تبعياتها المشتركة مثبّتة | طابق اسم الحزمة بالضبط؛ ثبّت التبعيات المشتركة (انظر PERF-5)؛ شغّل `qa:perf:dist` بعد البيلد |
| P8 | إزالة كاش قائم (كاش الجلسات، كاش المستأجر، كاش كتالوج المتجر، كتالوج نقطة البيع في IndexedDB) "للتبسيط" | الكاش جزء من التصميم. لو البيانات قديمة: أصلح **الإبطال** (`invalidate…`) لا الكاش |
| P9 | فهرس جديد يُنشأ يدوياً على السيرفر بلا هجرة، أو هجرة فهارس بلا `IF NOT EXISTS` | هجرة مرقمة، `CREATE INDEX IF NOT EXISTS`، وتجربتها `up → up → down` داخل معاملة تُلغى |
| P10 | فهرس لكل عمود "احتياطاً" | كل فهرس يُدفع ثمنه في كل `INSERT/UPDATE`. أضف فهرساً فقط لاستعلام ساخن **موجود فعلاً**، واذكره في تعليق الهجرة |
| P11 | تحميل كافة تابات مساحة العمل دفعة واحدة في الـ DOM عند الفتح الأول (Eager Hidden Mounting) دون استخدام `visitedTabs` | التحميل الكسول الصارم للتاب عند أول نقرة فقط |
| P12 | استدعاء استعلامات جداول كاملة فقط لحساب عدد الشارة في التاب أو القائمة | استعلام SQL تجميعي خفيف (`/counts`) يعيد الأرقام مباشرة في ~2ms |

---

## 4. ما قيس قبل وبعد (21 سبتمبر 2026)

| المسار | قبل | بعد |
|---|---|---|
| مزامنة كتالوج نقطة البيع (20 ألف صنف، بفرع/مخزن) — حساب أرصدة المواقع | ~13,000ms حجب كامل للسيرفر | < 50ms |
| رد بـ5000 صف (قوائم/تقارير) — تسلسل | ~100ms إضافية لكل رد | 0 |
| صفحة الأصناف لمستأجر > 65 ألف صنف | خطأ Postgres (حد المعاملات) | تعمل (معامل مصفوفة واحد، مجرَّب بـ80 ألف معرّف) |
| التحميل الأول لأي صفحة (والمتجر العام) | + jsPDF (~390KB) + ماسح QR (~335KB) + Sentry | لا شيء منها حتى يُحتاج |
| حجم استجابة حزم JS/CSS عبر الشبكة على حاوية الإنتاج (SaaS) | بلا `gzip` (نص خام) وبلا كاش متصفح لأي أصل | مضغوطة (`gzip`، نص عادةً 70-80% أصغر) + `Cache-Control: public, immutable` على `/assets/` |
| لوحة التحكم الرئيسية: بيانات تُسحب من قاعدة البيانات لكل تحميل | كل صف نشط في `products`/`customers`/`suppliers` (خطي بحجم الكتالوج، بلا حدّ أقصى) | ثوابت SQL فقط: أرقام مجمَّعة + 8 صفوف "منخفض مخزون" + 5+5 صفوف "أعلى شريك" — بلا علاقة بحجم الكتالوج |
| صفحات المقاولات | chunk بـ1.48MB يشمل pdfjs | pdfjs عند فتح مودال الاستيراد فقط |
| أول زائر للمتجر بعد انتهاء الكاش | ينتظر 5 استعلامات متتالية | نسخة فورية + تحديث بالخلفية |
| إعادة تحميل كتالوج الكاشير الكامل | كل 5 دقائق لكل جهاز طالما حصل أي بيع | عند تغيّر سعر/اسم/باركود/وحدة/عرض فقط، أو مرة كل ساعة |

---

## 5. بنود أداء معروفة **لم تُنفَّذ عمداً** (تحتاج قرار المالك)

| # | البند | لماذا لم يُنفَّذ |
|---|---|---|
| ~~PO-1~~ | ~~كل بيعة كانت تجعل كل كاشير يعيد تحميل الكتالوج كاملاً كل 5 دقائق~~ | ✅ **نُفِّذ بقرار المالك (21 سبتمبر 2026) — أصبح الثابت PERF-9.** إعادة التحميل عند تغيّر الكتالوج فعلاً + تحميل احتياطي كل ساعة. البيع بدون إنترنت كما هو |
| ~~PO-2~~ | ~~ملخص لوحة التحكم يحمّل كل الأصناف والعملاء والموردين ويجمع في JavaScript~~ | ✅ **نُفِّذ بقرار المالك (26 سبتمبر 2026) — أصبح الثابت PERF-12.** الجمع بالكامل صار SQL، لا حدّ أقصى لحجم الكتالوج |
| PO-3 | `inventory-scope.service.ts:assignProductsToLocation` يكتب `product_location_stock` مباشرة وبـ`find` داخل حلقة | مخالفة لـ§2.1 (`applyStockDelta`) قبل أن تكون مسألة أداء — تُعالج كبند تدقيق لا كتحسين سرعة |
| PO-4 | chunk المقاولات ما زال يستورد `xlsx` ثابتاً (عبر `originalWorkbookPricer`) | `xlsx` في chunk مستقل ويُخزَّن في الكاش؛ مكسب أقل من مخاطرة تعديل ثلاث شاشات |

---

## 6. قائمة التحقق قبل أن تقول «خلصت» في أي تعديل يلمس الأداء

1. [ ] `npm run guards` أخضر (يشمل `performance-hot-paths.spec.ts` و`qa:perf`).
2. [ ] لا استيراد ثابت لمكتبة ثقيلة في مسار الـShell (P6).
3. [ ] لا حلقة داخل حلقة على نتائج استعلامات (P1/P2).
4. [ ] أي فهرس جديد في هجرة مرقمة وجُرِّب `up/up/down` (P9).
5. [ ] بعد أي بيلد يطلبه المالك: `npm --prefix frontend run qa:perf:dist` أخضر.
6. [ ] حدّثت هذا الملف و`ARCHITECTURE_INVARIANTS.md` §2.6 لو أضفت ثابتاً أو كسرت واحداً بقرار.

## Shared database limits (2 October 2026)

Representative, van-trip, AR-case and maritime ledger lists now cap pages at 200 rows. KDS has a fixed read cap; cashier fraud counts aggregate in SQL, while its monetary estimate uses at most 2,000 detailed rows and signals `sampled` when incomplete. Aging and AR sync initially rejected overlarge financial scopes; the Rocket-Speed sprint below replaces that temporary guard with SQL aggregation and bounded pages. Migration `2040000000185` indexes only existing representative, cost-center and cashier-audit filters. The storefront keeps its full-response legacy contract for now, but its in-memory catalog cache is limited to 16 tenant slugs. No performance guards or migration checks were run here because the owner delegated verification to the local pair.

## Rocket-Speed sprint (2 October 2026)

- API JSON larger than 1 KB uses `compression@1.8.1`, whose source negotiates Brotli, gzip and deflate on Node 22 (Brotli quality 4). Express weak ETags and `private, no-cache, must-revalidate` allow conditional revalidation of authenticated master data without shared proxy caching. Actual Brotli delivery and sub-100 ms latency must still be measured through the deployed reverse proxy.
- Session authorization and tenant feature payloads use a 60-second, 20,000-entry in-process LRU. Settings, branches, locations and plan features use 60-second, tenant-keyed caches with 2,000-entry limits. Existing explicit invalidation remains mandatory on writes and logout.
- Aging reports allocate balances with SQL window functions and filtered sums; global totals and a maximum 200-partner page are computed in PostgreSQL. AR collection synchronization reads 200 customers at a time and calculates FIFO overdue exposure in SQL, with bounded write transactions. Do not restore invoice-row hydration or a 5,000-row rejection cap.
- `GET /api/storefront/:slug/catalog?page=1&limit=50` reads only the requested product page, its stock and reviews, and returns `totalCount`/`hasMore`. The no-parameter legacy route still returns the full catalog for the current storefront UI, whose local search, facets and ordering require all products. Moving those features to SQL is the remaining prerequisite to making pagination the default.
- Sidebar hover/focus prefetch runs in an idle callback for the hovered destination only; product table columns and row ID derivation are memoized. POS already memoizes its product panel and search derivations; preserve those guards.
- No build, typecheck, automated tests, or latency benchmarks were run in this cloud workspace at the owner's request. The local pair must verify correctness and production p50/p95 latency before the <100 ms goal can be stated as achieved.
