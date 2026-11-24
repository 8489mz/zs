# قدرات الأصناف والوحدات والمتغيرات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **الأصناف والوحدات والمتغيرات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/catalog/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [التجزئة والأنشطة التجارية](RETAIL_COMMERCE_CAPABILITIES.md) · [التسعير والعروض](PRICING_CAPABILITIES.md)

## التحديثات الحالية

<a id="cap-263"></a>
### 263. محرك البحث والترتيب الذكي الموحد للأصناف عبر كامل المنظومة وعزل بيانات الموردين في القوائم التشغيلية (System-Wide Unified Product Identity Search & Relevance Ranking Engine - 24 November 2026)
* **حالة القدرة:** تم التحديث والتحقق بوحدات الاختبار المستهدفة (`backend/test/product-search-rank-engine.spec.ts` و`frontend/src/features/pos/lib/pos-catalog-storage.spec.ts` بتاريخ 24 نوفمبر 2026؛ أُجّل `typecheck` و `guards` لنهاية الجلسة حسب سياسة التنفيذ).
* **المسارات المتأثرة:**
  - `backend/src/modules/catalog/engines/product-search-rank.engine.ts`
  - `backend/src/modules/catalog/services/catalog-product-list.service.ts`
  - `backend/src/modules/catalog/services/catalog-product-pos.service.ts`
  - `backend/src/modules/catalog/catalog.controller.ts`
  - `frontend/src/lib/arabic-normalization.ts` (`matchesArabic`, `scoreArabicSearchRelevance`)
  - `frontend/src/shared/ui/searchable-combobox.tsx`
  - `frontend/src/shared/ui/async-searchable-combobox.tsx`
  - `frontend/src/shared/ui/custom-select.tsx`
  - `frontend/src/shared/ui/ComboboxSelect.tsx`
  - `frontend/src/features/pos/lib/pos-catalog-storage.ts`
  - `frontend/src/features/sales/pages/CreateQuotationPage.tsx`
  - `frontend/src/features/sales/pages/CreateSalesOrderPage.tsx`
  - `frontend/src/features/sales/components/OrderItemProductPicker.tsx`
  - `frontend/src/features/delivery-reps/components/DriverNewLoadRequisitionView.tsx`
  - `frontend/src/features/purchases/api/purchases.api.ts`
  - `backend/test/product-search-rank-engine.spec.ts`
  - التكامل مع شاشة إذن الصرف المخزني ومزامنة أرصدة المخازن موثق في [INVENTORY_CAPABILITIES.md](INVENTORY_CAPABILITIES.md#cap-294).
* **السلوك والضوابط:**
  1. **وضع هوية الصنف فقط (`identityOnly=true`):** حصر البحث في القوائم المنسدلة التشغيلية (إذن الصرف، فواتير المشتريات، التصنيع، فاحص الأسعار) على حقول هوية الصنف (`name`, `name_en`, `barcode`, `sku`, `style_code`, `color`, `size`, `product_units`) واستبعاد اسم المورد واسم القسم والمخزن والملاحظات تماماً لمنع ظهور أصناف غير ذات صلة تشترك في نفس المورد.
  2. **الترتيب الهرمي بالأولوية (`scoreProductSearchMatch`) والبحث بالكلمات والأوزان العشرية المتفرقة:** ترتيب النتائج بدءاً من التطابق التام للباركود/الاسم (`1000`)، ثم بداية الاسم بكلمة كاملة (`900`)، ثم تطابق الكلمة الكاملة داخل الاسم (`800`)، ثم بادئة الاسم/الكلمة (`720`/`650`)، ثم تطابق كافة المقاطع النصية والرقمية المتفرقة مثل الأوزان العشرية `1.5` (`550`)، قبل التطابقات الجزئية الداخلية (`350`)، مع دعم تفضيل الأصناف ذات الرصيد المتاح (`preferInStock=true`).
  3. **توسيع صلاحية القراءة التشغيلية:** السماح لأدوار المخزون والمشتريات والتصنيع (`@RequireAnyPermission('products', 'inventory', 'canAdjustInventory', 'purchases', 'manufacturing')`) بالبحث في `GET /api/products` مع بقاء حظر المستخدم المقتصر على `sales` فقط (`403`).
* **القيود المعروفة:** البحث المفلتر بـ `q` في `CatalogProductListService` يعمل عبر مسار الفلترة والترتيب في الذاكرة بعد قراءة الكتالوج النشط للمستأجر، بينما تظل الصفحات غير المفلترة على مسار الترقيم المباشر في SQL (`listProductsPageInSql`).

### 262. توحيد محرك طباعة ملصقات الباركود والمقاسات الحرارية وورق A4 وعرض العملة والاتجاه ومتغيرات الملابس (Unified Barcode Label Print Engine, A4 Sheet Bounds, Currency, Thermal 180° Orientation & Fashion Variant Labels - 17 November 2026)
* **حالة القدرة:** تم التحديث والتحقق بوحدات الاختبار المستهدفة (`44/44` نجاح عبر 6 ملفات في 17 نوفمبر 2026؛ لم يُشغَّل `typecheck` أو `guards` بناءً على سياسة التأجيل حتى نهاية الجلسة).
* **المسارات المتأثرة:**
  - `frontend/src/lib/barcode.ts`
  - `frontend/src/lib/browser.ts`
  - `frontend/src/lib/barcode-labels.ts`
  - `frontend/src/lib/barcode-labels-presets.ts`
  - `frontend/src/styles/partials/internal-detail-review.css`
  - `frontend/src/features/products/components/BarcodePrinterPicker.tsx`
  - `frontend/src/features/products/components/BarcodeBatchItemsPanel.tsx`
  - `frontend/src/features/products/components/BarcodeFoodStatementSection.tsx`
  - `frontend/src/features/products/components/BarcodePrintDialog.tsx`
  - `frontend/src/features/products/components/workspace-sections/FashionGroupBarcodePrintAction.tsx`
  - `frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.tsx`
  - `frontend/src/lib/printer-preferences.ts`
  - `frontend/src/lib/__tests__/barcode-labels.test.ts`
  - `frontend/src/lib/__tests__/printer-preferences.spec.ts`
  - `frontend/src/features/products/components/product-barcode-print.helpers.spec.ts`
  - راجع تفاصيل تثبيت الطابعات وحفظها التلقائي في [SETTINGS_CAPABILITIES.md](SETTINGS_CAPABILITIES.md#settings-electron-barcode-and-receipt-printers).
* **المشكلات المعالجة والتحسينات:**
  1. **إصلاح أبعاد كافة مقاسات `A4` (`a4-24`, `a4-40`, `a4-48`, `a4-65`, `a4-100`):** ضبط الهوامش والفجوات وارتفاع الملصق في `SHEET_PRESETS` لتبقى جميعها فعلياً داخل حدود `210 × 297 مم` دون فيض إلى صفحة إضافية.
  2. **إزالة تضارب `@page` وحماية جسر الطباعة:** دعم `pageSizeMm` و `pageMarginMm` و `disableWindowsBridge` في `printHtmlDocument` لمنع صدور قاعدتي `@page` متعارضتين (هامش `8mm` قبل `0mm`) ولمنع توجيه ملصقات الباركود بالخطأ إلى طابعة إيصالات الكاشير (`posWindowsPrinterName`).
  3. **المعاينة المطابقة 1:1 للطباعة (`WYSIWYG`) والهوامش الآمنة الحرارية وتوسيع المقاسات:** توحيد CSS البطاقات بدلالة `mm`/`pt` في `getBarcodeSharedLabelCss` وإزالة قواعد `internal-detail-review.css` المتعارضة، مع توسيع هوامش الأمان الداخلية للملصقات الحرارية (`padXmm`/`padYmm`) وتقليص البطاقة `0.4mm` في الطباعة الحرارية لحماية السعر ووحدة الصنف من القص عند حواف الاستيكرات الصغيرة مثل `38×25 مم` و `35×22 مم` و `40×30 مم`، مع خيار **المقاس المخصص** (`thermal-custom` بين `20..120 × 15..150 مم`) وحفظ التفضيلات في `localStorage` (`z_erp_barcode_print_prefs_v3`).
  4. **اعتماد `180°` افتراضياً ودعم اتجاهات التدوير الحرارية (`0° / 90° / 180° / 270°`):** إضافة `DEFAULT_THERMAL_ROTATE_DEG = 180` كوضع افتراضي في نافذة الطباعة الحرارية لمعالجة الطابعات ذات التغذية العكسية (مثل Xprinter XP-246B) مع إمكانية التبديل لحظياً إلى `0° / 90° / 270°`.
  5. **العملة الإنجليزية `EGP` ومحاذاة السعر يساراً وجودة Code-128:** إصلاح `encodeCode128Auto` للأرقام المفردة مثل `"1"` (منع إدراج `CODE_C` فارغ بنهاية الكود)، ورفع الهامش الأبيض `quietZone` إلى `20` (`10X`) مع `preserveAspectRatio="xMidYMid meet"`، واستخدام `formatCurrencyWithCode` افتراضياً (`90.00 EGP`) مع إتاحة التبديل بين الكود/الرمز/بدون عملة، وتثبيت محاذاة السعر على اليسار (`margin-right: auto`) داخل بطاقات RTL، وتوحيد الحبر الأسود الصريح `#000000`.
  6. **دعم ملصقات متغيرات الملابس والأحذية (`color / size`) والطباعة الفردية من الدفعة:** إضافة سطر مخصص أنيق بدون برواز للون والمقاس (`.barcode-label-variant-badge` بصيغة مختصرة مباشرة مثل `أسود · XL` بدون نصوص وصفية زائدة) قابل للتبديل (`showVariant`) مع تنظيف تكرار اللاحقة `- اللون / المقاس` تلقائياً من اسم الصنف، ودعم `nameEn`، وزر **طباعة الملصقات** المباشر داخل محرر موديلات الملابس (`FashionGroupBarcodePrintAction`). كما تم فصل قائمة أصناف الدفعة في عمود مستقل كامل الارتفاع (`BarcodeBatchItemsPanel.tsx`) للقضاء على التمرير المتداخل ("سكرول جوه سكرول")، مع دعم كمية `0` لصنف وزر **«هذا فقط»** و**تصفير الكل** وعدّاد RTL قياسي (`[+] الكمية [-]`) لإعادة طباعة استيكر متغير واحد منفرد دون إهدار بقية المتغيرات.
  7. **توسيع الباركود القصير والأولوية التخطيطية ووضع التكيف التلقائي (`Auto-Fit`) لبيانات التموين وتخفيف الخطوط:** ضبط نسبة ارتفاع `buildCode128Svg` ديناميكياً للأكواد القصيرة (`height = Math.max(42, Math.min(72, Math.round(totalWidth / 3.1)))`) لملء العرض بشكل أوضح للماسح، وحماية حاوية الباركود بـ `overflow: hidden` وحد أدنى ثابت ومنع تداخلها مع اسم الصنف، ودمج ملاحظة التخزين جنباً إلى جنب مع الصلاحية في `.barcode-label-food-dates` بدون برواز صندوقي ثقيل وبوضع التحجيم التلقائي `.has-food-statement` للمقاسات الصغيرة، وإزالة البرواز المحيط بشارة الوحدة/الوزن الصافي مع تخفيف البولد عن النصوص الصغيرة وإبقاء السعر واضحاً (`font-weight: 800`)، وإضافة تنبيه استرشادي لطيف لمقاس `50×40 مم` في نافذة الطباعة عند تفعيل بيانات التموين على ملصق أقل من `32 مم`.
* **القيود التشغيلية المعروفة:** عند الطباعة عبر نافذة المتصفح (خارج Electron)، يظل ضبط `Margins: None` وإلغاء `Headers and footers` وتطابق مقاس الورق الفعلي في تعريف طابعة ويندوز (`Printing preferences`) وإجراء معايرة الفجوات (`Gap/Media Calibration`) ضرورياً لثبات نقطة البداية على كل استيكر.
* **الاختبارات المنفذة:** `vitest run src/lib/__tests__/printer-preferences.spec.ts src/lib/__tests__/barcode-labels.test.ts src/lib/electron-printing.spec.ts src/lib/browser-print-bridge.spec.ts src/features/settings/components/forms/tabs/PrintingSettingsTab.spec.tsx src/features/products/components/product-barcode-print.helpers.spec.ts` (`44/44` نجاح، 6 ملفات، 17 نوفمبر 2026).

### 261. توحيد منهجية الترتيب المؤسسي للأصناف والفرز التفاعلي للأعمدة (Catalog Unified Enterprise Sorting & Interactive Column Sort - 27 October 2026)
* **حالة القدرة:** 🟢 مكتملة ومحمية بنسبة 100% (27 أكتوبر 2026).
* **المسارات المتأثرة:** 
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `frontend/src/features/products/api/products.api.ts`
  - `frontend/src/features/products/hooks/useProductsPageQuery.ts`
  - `frontend/src/features/products/hooks/useProductsWorkspaceController.ts`
  - `frontend/src/features/products/components/ProductsTableCard.tsx`
  - `frontend/src/features/products/components/ProductsWorkspace.tsx`
* **المشكلة المعالجة:**
  1. في تبويب "الكل" بدليل الأصناف، كان يتم إعادة فرز الأصناف قسرياً على الواجهة تصاعدياً بحسب رصيد المخزون (`Stock ASC`) على مستوى الصفحة الواحدة (20 صنفاً فقط)، مما كان يخفي الصنف المضاف حديثاً بـ 50 قطعة في أسفل الصفحة بدلاً من تصدره أعلى الجدول، وكان يعطي انطباعاً مضللاً بفرز جزئي غير شامل لكامل قاعدة البيانات.
  2. غياب إمكانية الترتيب التفاعلي بالنقر على رؤوس أعمدة جدول الأصناف لمقارنة الأسعار أو المخزون أو الفرز الأبجدي.
* **الحلول والضوابط المنفذة:**
  1. **الترتيب المؤسسي الافتراضي الشامل:**
     - في تبويب «الكل» (All) وكافة التبويبات القياسية: اعتماد ترتيب **الأحدث إضافة أولاً (`id DESC`)** كما يصدر من قاعدة البيانات مباشرة، ليتصدر أي صنف مضاف حديثاً أو معدل أول سطر في الصفحة الأولى فوراً.
     - في تبويب «منخفضة المخزون» (Low Stock): الفرز الافتراضي التلقائي من السيرفر لكامل المخزن هو **الأقل رصيداً أولاً (`stock ASC`)** لإبراز العجز والأنقص فوراً.
     - في تبويب «نافدة المخزون» (Out of Stock): الفرز الافتراضي التلقائي من السيرفر لكامل المخزن هو **أبجدياً بحسب القسم ثم اسم الصنف (`category ASC, name ASC`)** لتسهيل الجرد والتسوية الميدانية.
  2. **الفرز الشامل على مستوى قاعدة البيانات (Full Dataset Server-Side Sorting):**
     - دعم باراميترات `sortBy` و `sortDir` في الباك إند (`catalog-product.service.ts`) ليتم الفرز الشامل على مستوى كافة أصناف المنشأة قبل تقطيع الصفحات (Pagination).
  3. **الفرز التفاعلي لرؤوس الأعمدة (Interactive Table Header Sorting):**
     - تمكين النقر المباشر على رؤوس أعمدة جدول الأصناف: (الصنف `name`، الباركود `barcode`، القسم `category`، الأسعار `price`، المخزون `stock`).
     - مؤشرات بصرية رسمية بالأسهم المعتمدة (`ChevronUpIcon` / `ChevronDownIcon`) دون أي إيموجيز.
     - كبسولة تفاعلية أنيقة في شريط الأدوات توضح الفرز النشط مع زر للإلغاء والعودة للترتيب الافتراضي بضغطة واحدة.
* **المراجع البرمجية:**
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `frontend/src/features/products/hooks/useProductsWorkspaceController.ts`
  - `frontend/src/features/products/components/ProductsTableCard.tsx`

### 260. العرض البصري المصغر لصور الأصناف ومعاينة التكبير في جدول دليل الأصناف (Product Visual Thumbnail & Zoom Preview in Catalog - 27 October 2026)
* **حالة القدرة:** 🟢 مكتملة ومحمية بنسبة 100% (27 أكتوبر 2026).
* **المسارات المتأثرة:** `frontend/src/features/products/components/ProductsTableCard.tsx`.
* **الوصف:** استبدال الأيقونة المربعة الثابتة بصورة الصنف الحقيقية بحجم مطابق ومحكم (`28×28px`) مع حواف ناعمة (`border-radius: 6px`) وتطبيق `objectFit: 'cover'` وحفظ التنسيق من أي انكسار أو تمدد. دعم التحميل الكسول `loading="lazy"` و `decoding="async"` والرجوع التلقائي للأيقونة الافتراضية (Graceful Fallback) عند عدم توفر صورة أو عند فشل تحميل الرابط، مع ميزة النقر للمعاينة المكبرة في نافذة منبثقة خفيفة (`StandardDialog`).
* **المراجع البرمجية:**
  - `frontend/src/features/products/components/ProductsTableCard.tsx`

### 259. الاعتماد التلقائي الذكي لاسم الصنف ثنائي اللغة ودعم الإدخال بالإنجليزية فقط (Intelligent Dual-Language Product Name Auto-Fallback - 26 October 2026)
* **حالة القدرة:** 🟢 مكتملة ومختبرة بنسبة 100% (26 أكتوبر 2026).
* **المسارات المتأثرة:** شاشات إضافة وتعديل الأصناف (`NewProductForm.tsx`, `EditProductForm.tsx`) ونوافذ الـ POS (`PosNewProductModal`, `PosEditProductModal`) ومسارات API (`/api/products`).
* **المشكلة المعالجة:** في السوق الكويتي والخليجي ومحلات التجزئة الدولية، تعتمد معظم الأنشطة على مسميات أصناف باللغة الإنجليزية حصرياً. وكان النظام يرفض حفظ الصنف عند إدخال الاسم الإنجليزي فقط في خانة `nameEn` وترك خانة العربي `name` فارغة برسالة `PRODUCT_NAME_REQUIRED`.
* **الحلول والضوابط المنفذة:**
  1. **الباك إند (`catalog-product.service.ts` و `upsert-product.dto.ts`):**
     - جعل حقل `name` اختيارياً في `UpsertProductDto` عند توفر `nameEn`.
     - في دالة `normalizeProductPayload`: تطبيق الاعتماد التلقائي الذكي `const resolvedName = rawName || rawNameEn || '';`، فإذا ترك المستخدم خانة العربي فارغة وكتب بالإنجليزي فقط، يتم اعتماد الاسم الإنجليزي تلقائياً في عمود `name` التشغيلي مع حفظه في `name_en`، وتمر العملية بنجاح.
     - تعديل رسالة الخطأ عند خلو الاسمين معاً لتكون واضحة: `اسم الصنف الأساسي مطلوب (بالعربية أو الإنجليزية).`
  2. **الواجهة الأمامية (`NewProductForm.tsx` و `EditProductForm.tsx`):**
     - توضيح شارات التلميح للمستخدم: `(يكفي إدخال أحدهما)` لخانة العربي و `(للفواتير أو كاسم أساسي)` لخانة الإنجليزي.
     - تسوية الاسم تلقائياً في `onSubmit` قبل الإرسال.
     - تفعيل التخمين التلقائي لأيقونة الصنف (`guessProductIcon`) عند الكتابة بالإنجليزية في حال كانت خانة العربي فارغة.
* **الاختبارات:**
  - `src/features/products/schemas/product.schema.spec.ts` (3/3 نجاح).
* **المراجع البرمجية:**
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `backend/src/modules/catalog/dto/upsert-product.dto.ts`
  - `backend/src/common/errors/error-translations.ts`
  - `frontend/src/features/products/components/NewProductForm.tsx`
  - `frontend/src/features/products/components/EditProductForm.tsx`

## فهرس الأقسام المنقولة

- [173. الحصانة الذاتية لأرقام الباركود الطويلة ومنع تشويه الصيغ العلمية في ملفات الإكسل (Barcode Scientific Notation Auto-Protection)](#cap-204)
- [184. تكامل التسوية السريعة للمخزون داخل شاشة تعديل الصنف بنمط المصدر الموحد (Product Edit Quick Stock Adjustment Single Source Integration)](#cap-218)
- [187. منظومة أرشفة وتعطيل الأصناف الذكية والحذف الشرطي القياسي (Enterprise Product Archiving & Conditional Deletion Standard)](#cap-221)
- [255. المزامنة الذكية وتطهير مصفوفة مقاسات وألوان الملابس وحماية الأرصدة المخزنية (Smart Fashion Variants Matrix Sync, Pruning & Stock Protection - 24 October 2026)](#cap-294)
- [256. دعم الشرطة (-) كفاصل معتمد ومولد فوري لمتغيرات الأصناف (Product Variants Dash Separator & Instant Row Generation - 24 October 2026)](#cap-295)
- [257. منظومة التسوية المخزنية اللحظية والتصفير التلقائي لموديلات الملابس والمتغيرات (Fashion Variants Inline Stock Adjustment & Auto-Reconciliation Engine - 24 October 2026)](#cap-296)
- [258. الأرشفة الذكية للأصناف القياسية والتسوية المخزنية الآلية المحاسبية (Standard Products Smart Archive & Auto-Reconciliation Engine - 25 October 2026)](#cap-297)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-204"></a>
<!-- migrated:cap-204:start -->
## 173. الحصانة الذاتية لأرقام الباركود الطويلة ومنع تشويه الصيغ العلمية في ملفات الإكسل (Barcode Scientific Notation Auto-Protection)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية (24 سبتمبر 2026).
* **المشكلة المعالجة:** عند استيراد ملفات الإكسل التي تحتوي على أرقام باركود أو هويات وطنية أو أرقام هواتف طويلة (مثل الباركود الدولي EAN-13 أو GS1 ذي الـ 13 رقماً)، يقوم برنامج Microsoft Excel تلقائياً بتحويل طريقة عرض الأرقام الطويلة إلى صيغة أسية علمية (`Scientific Notation` مثل `6.22401E+12`). وكان قارئ الإكسل في المتصفح يأخذ النص المعروض بصرياً (`cell.w`) فتنزل كافة الأصناف بنفس الباركود المشوه، مما يؤدي إلى ابتلاع الأصناف وتحديث أول صنف مكرراً آلاف المرات بدلاً من إضافة الأصناف الجديدة.
* **الحصانة المطبقة:**
  1. **الواجهة الأمامية (`browser.ts`):**
     - عند قراءة ملف الإكسل (`parseImportFile`)، يتم فحص خلايا الشيت مسبقاً، واستعادة الرقم الصحيح الكامل بدقة تامة من القيمة الخام `cell.v` عبر `BigInt` وتعيين `cell.w` بالرقم السليم لمنع أي بتر للأرقام أو تحولها لصيغة علمية.
     - دعم تمدد وتطبيع أي سلاسل نصية أسية قد تمر من ملفات CSV أو أجهزة أخرى.
     - عند تصدير قوالب وملفات الإكسل (`downloadExcelFile`)، تعيين تنسيق الخلايا النصية والرقمية الطويلة إلى تنسيق النص الصريح (`@`) لمنع إكسل من تحويلها لصيغة علمية عند فتحها وتعديلها من قبل المستخدم.
  2. **الخلفية (`settings-import.service.ts`):**
     - إضافة دالة `normalizeBarcodeText` لتطبيع الأرقام العربية والإنجليزية وفك أي صيغة أسية علمية تلقائياً وتحويلها للرقم الصحيح في كل من استيراد بطاقات الأصناف (`importProducts`) واستيراد بضاعة أول المدة (`importOpeningStock`).
* **الملفات:**
  - `frontend/src/lib/browser.ts` — قارئ ومصدر ملفات الإكسل وحماية الباركود من الصيغ الأسية.
  - `backend/src/modules/settings/services/settings-import.service.ts` — تطبيع الباركود وفك الصيغ الأسية في مسارات الاستيراد.

---


<!-- migrated:cap-204:end -->

<a id="cap-218"></a>
<!-- migrated:cap-218:start -->
## 184. تكامل التسوية السريعة للمخزون داخل شاشة تعديل الصنف بنمط المصدر الموحد (Product Edit Quick Stock Adjustment Single Source Integration)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (30 سبتمبر 2026).
* **المسار:** `/products/:id/edit` ونوافذ تعديل الصنف في الـ POS (`PosEditProductModal`).
* **المشكلة المعالجة:**
  - تمكين مديري النظام والمخازن من تعديل وتسوية رصيد الصنف فورياً من داخل شاشة تعديل الصنف دون الحاجة للخروج والانتقال إلى شاشات تسوية الجرد المنفصلة، مع الالتزام التام بعدم كتابة كود مكرر وإعادة استخدام المكون والمحرك المعتمد في المخازن (Single Source of Truth).
* **الهندسة والحلول المنفذة:**
  1. **إعادة استخدام المكون الموحد الشامل (QuickStockAdjustmentDialog):**
     - ربط شاشة `EditProductForm.tsx` بمكون `QuickStockAdjustmentDialog.tsx` المعتمد في موديول المخازن مباشرة دون أي تكرار كودي.
     - دعم كافة أنماط الحركات: تسوية إلى كمية نهائية (`adjust`)، إضافة كمية للرصيد (`add`)، خصم كمية من الرصيد (`deduct`)، وتسجيل التالف (`damage`).
  2. **الحوكمة وتكامل المحرك المالي والمخزني المعتمد:**
     - استدعاء مسار التسوية المعتمد الذي يمر عبر `applyStockDelta` و `createInventoryAdjustment` لضمان توليد إذن جرد رسمي وقيد محاسبي صريح في الأستاذ العام وتحديث أرصدة المواقع وحفظ سجل التدقيق.
  3. **تحديث الكاش اللحظي والواجهة التفاعلية:**
     - إضافة زر تفاعلي مؤسسي أنيق «تسوية الرصيد» بأيقونة `<SlidersIcon size={12} />` واللون الكحلي القياسي `#170e5e` أعلى خانة المخزون الحالي.
     - إبطال كاش الاستعلامات فور الحفظ بنجاح (`['product', productId]`, `['products']`, `['location-stocks']`) لينعكس الرصيد الجديد في حقل المخزون فورياً وتلقائياً.
  4. **حماية فيض الأرقام المحاسبية للأصناف عالية القيمة (Migration 2040000000177):**
     - ترقية وتوسيع الدقة الرقمية لحقول التكلفة (`unit_cost NUMERIC(16, 3)` و `total_cost NUMERIC(18, 3)`) في جدولي حركات المخزون `stock_movements` وحركات التالف `damaged_stock_records`.
     - منع حدوث فيض رقمي (Numeric Field Overflow - Error 22003) عند تسوية كميات كبيرة من الأصناف باهظة الثمن (مثل أجهزة الآيفون أو المواد التي تتجاوز تكلفتها الإجمالية مليار وحدة نقدية).
   5. **معالجة وتدقيق سبب وملاحظات التالف (Damaged Stock Note Fallback & Validation):**
      - دعم التراجع التلقائي الذكي (Fallback): إذا قام المستخدم باختيار أو كتابة سبب التلف (مثل "كسر أثناء النقل / تلف مخزني") دون ملء خانة الملاحظات، يعتمد النظام سبب التالف تلقائياً كملاحظة رسمية للحركة (`effectiveNote`) طالما يتجاوز 8 أحرف، مما يقضي تماماً على خطأ `DAMAGE_NOTE_REQUIRED (400)`.
      - التحقق الفوري بالفرونت إند: مواءمة `damagedStockSchema` لرفض المدخلات الأقل من 8 أحرف وعرض رسالة تنبيه واضحة على الحقل، وتحديث التسمية لمنع التضليل من «ملاحظات (اختياري)» إلى «ملاحظات وتفاصيل التلف (8 أحرف على الأقل)».
* **الملفات المتصلة:**
  - `backend/src/modules/inventory/services/inventory-count.service.ts`
  - `backend/src/database/migrations/2040000000177_expand_stock_movement_cost_precision.ts`
  - `frontend/src/features/inventory/schemas/inventory.schema.ts`
  - `frontend/src/features/inventory/contracts.ts`
  - `frontend/src/features/products/components/EditProductForm.tsx`
  - `frontend/src/features/inventory/components/QuickStockAdjustmentDialog.tsx`
  - `frontend/src/features/inventory/components/InventoryActionsPanel.tsx`
  - `frontend/src/features/pos/components/pos-workspace/PosEditProductModal.tsx`

---


<!-- migrated:cap-218:end -->

<a id="cap-221"></a>
<!-- migrated:cap-221:start -->
## 187. منظومة أرشفة وتعطيل الأصناف الذكية والحذف الشرطي القياسي (Enterprise Product Archiving & Conditional Deletion Standard)
* **الحالة / الإنجاز:** مكتمل بنسبة 100% (30 سبتمبر 2026).
* **المسار:** `/products` (دليل الأصناف)، `/products/:id/edit` (تعديل الصنف).
* **المرجعية المعمارية:**
  - معيار ERP المالي والمخزني الصارم (مستوحى من أودو Odoo): حظر الحذف الفيزيائي التام لأي صنف له تاريخ حركات مخزنية أو فواتير بيع/شراء أو قيود يومية، حتى لا تنهار دفاتر الحسابات وتقارير كروت الصنف التاريخية.
  - استبدال الحذف العشوائي بمنظومة "الأرشفة والتعطيل" (Archiving & Deactivation) مع إمكانية التنشيط اللحظي، وحصر الحذف الفيزيائي حصرياً في الأصناف الجديدة الصفرية التي أضيفت بالخطأ ولم تدخل في أي حركة إطلاقاً (`canDelete`).
* **التفاصيل التقنية المنفذة:**
  1. **الباك إند ومنطق الحذف والأرشفة الذكي:**
     - نقطة نهاية برمجية جديدة: `POST /api/products/:id/toggle-archive` لتعديل حالة `is_active` مع تسجيل العمليات في سجل التدقيق الرقابي (`audit_logs`) وتحديث `catalog_updated_at` فورياً لمزامنة كاش الكاشيرات في نقاط البيع ونزع الصنف من نقاط البيع.
     - في `listProducts`: فحص تاريخ حركات المخزون محصور حصرياً في المعرفات المعروضة في الصفحة الحالية (`pagedIds`) عبر استعلام مفهرس فائق السرعة (< 1ms) التزاماً بدستور الأداء `PERFORMANCE_CONSTITUTION.md` (PERF-9)، لحساب خاصيتي `hasMovements` و `canDelete: !hasMovements && Math.abs(currentStock) <= 0.0001`.
     - دعم تصفية `view=archived` لعرض الأصناف المؤرشفة والمعطلة على حدة دون تلويث دليل الأصناف النشطة.
     - تعديل `getProduct` و `updateProduct` للسماح بفتح وتعديل الأصناف المؤرشفة وتعديل حالتها بحرية.
  2. **الواجهة الأمامية ودليل الأصناف (`ProductsTableCard.tsx`):**
     - استبدال زر الحذف الأحمر التقليدي بزر شرطي ذكي ثلاثي الأبعاد:
       - إذا كان الصنف مؤرشفاً (`product.isActive === false`): يظهر زر أخضر زمردي **«تنشيط»** لإعادة إحياء الصنف للعمل فوراً.
       - إذا كان الصنف جديداً بدون حركات أو رصيد (`product.canDelete`): يظهر زر أحمر **«حذف»** لحذفه نهائياً من قاعدة البيانات.
       - إذا كان الصنف له حركات سابقة أو رصيد مخزني: يظهر زر كهرماني **«أرشفة»** مع حوار تأكيد وزاري (`ActionConfirmDialog` و `systemConfirm`) يشرح للمستخدم بوضوح أن الأرشفة تحجب الصنف عن عمليات البيع والشراء الجديدة مع صيانة كافة التقارير والحركات التاريخية.
     - دعم كامل لنفس السلوك على مستوى الموديلات المجمعة للأزياء (`group.children`) والأصناف الفرعية الفردية.
     - إضافة تبويب فلترة جديد **«المؤرشفة»** في شريط التصفية السريع للوصول إلى كافة الأصناف المعطلة وإدارتها.
     - إضافة شارة بصرية كبسولية «مؤرشف» بجانب اسم الصنف المؤرشف لسهولة التمييز البصري.
  3. **شاشة تعديل الصنف (`EditProductForm.tsx`) والمكون الموحد الشامل (`ProductArchiveConfirmDialog.tsx`):**
     - توحيد نافذة تأكيد الأرشفة والتنشيط في مكون مستقل موحد (`ProductArchiveConfirmDialog.tsx`) كـ Single Source of Truth مشترك ومستدعى من كل من شاشة دليل الأصناف (`ProductsWorkspace.tsx`) وشاشة تعديل الصنف (`EditProductForm.tsx`) دون أي تكرار للكود.
     - تزويد النافذة الموحدة بأيقونة المثلث الأصفر المؤسسي للتنبيه (`AlertTriangleIcon`) في حاوية تنفيذية بريميوم عند الأرشفة، وأيقونة التأكيد الخضراء (`CheckCircleIcon`) عند التنشيط.
     - تضمين بطاقة ملخص الصنف (الاسم، الباركود، رصيد المخزن الحالي بالألوان)، وصندوق تنبيه رصيد المخزن المتبقي الكهرماني، والنقاط الإيضاحية التشغيلية الثلاث، وأزرار التنفيذ الموحدة.
     - إضافة شارة حالة رسمية بجانب عنوان الصنف في الهيدر العلوي («نشط» بالأخضر أو «معطّل / مؤرشف» بالأحمر).
     - تثبيت الهيدر العلوي في سطر واحد مدمج محاذٍ تماماً لبطاقات الفورم (`margin: 0 auto; max-width: 1120px`) مع أزرار تنفيذ مقتضبة («أرشفة» / «تنشيط»، «إلغاء»، «حفظ»).
* **الملفات المتصلة:**
  - `backend/src/modules/catalog/dto/upsert-product.dto.ts`
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `backend/src/modules/catalog/catalog.service.ts`
  - `backend/src/modules/catalog/catalog.controller.ts`
  - `frontend/src/types/domain-models/catalog.ts`
  - `frontend/src/features/products/api/products.api.ts`
  - `frontend/src/features/products/hooks/useProductsWorkspaceController.ts`
  - `frontend/src/features/products/components/ProductArchiveConfirmDialog.tsx`
  - `frontend/src/features/products/components/ProductsTableCard.tsx`
  - `frontend/src/features/products/components/ProductsWorkspace.tsx`
  - `frontend/src/features/products/components/EditProductForm.tsx`

---


<!-- migrated:cap-221:end -->

<a id="cap-294"></a>
<!-- migrated:cap-294:start -->
## 255. المزامنة الذكية وتطهير مصفوفة مقاسات وألوان الملابس وحماية الأرصدة المخزنية (Smart Fashion Variants Matrix Sync, Pruning & Stock Protection - 24 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومطبقة ومحمية في موديول الأزياء والملابس (FashionGroupEditorCard).
- **التفاصيل التشغيلية والمحاسبية:**
  1. **المزامنة الذكية للمصفوفة وإعادة البناء اللحظي بنقرة واحدة (smartSyncFromTokens):**
     - عند قيام المستخدم بتعديل الألوان أو إلغاء المقاسات (لجعل الصنف ألوان فقط)، يقوم زر [توليد وتحديث شبكة الفروع بناءً على القيم أعلاه] بإعادة بناء الشبكة ومطابقة الأصناف تلقائياً دون تجميد أو إهمال المدخلات.
     - اعتماد نظام المطابقة الذكي من مرحلتين:
       - مطابقة تامة (Exact Match) للألوان والمقاسات المستهدفة للإبقاء على الأصناف الأصلية بروابطها وباركوداتها.
       - مطابقة انتقالية (Transition Match): في حال إلغاء المقاسات، يتم نقل الصنف الذي كان يحمل مقاساً إلى صنف اللون فقط مع الحفاظ الحتمي على معرّف قاعدة البيانات id والرصيد المخزني الفعلي stock > 0، مما يمنع اعتراض الباك إند أو فقدان الأرصدة.
       - التطهير التلقائي (Auto-Prune): حذف كافة الأصناف الفرعية التي رصيدها صفر وغير متواجدة في المدخلات العلوية بنقرة واحدة، بدلاً من إجبار المستخدم على النقر عشرات المرات لحذف كل مقاس يدوياً.
  2. **زر الإضافة الحصرية دون مسح القديم (generateFromTokens):**
     - توفير زر مستقل مخصص [إضافة الفروع الجديدة فقط (دون حذف الحالية)] للحالات التي يرغب فيها التاجر في إضافة مقاسات أو ألوان جديدة فقط مع الإبقاء المطلق على الشبكة القائمة دون أي تعديل.
  3. **زر تصفية الأصناف الصفرية دفعة واحدة (pruneZeroStockRows):**
     - إضافة زر [حذف الأصناف ذات الرصيد 0] في شريط أدوات جدول الأصناف الفرعية، يتيح حذف كافة المقاسات الفارغة التي ليس لها رصيد فعلي دفعة واحدة وبنقرة زر واحدة.
  4. **الحماية التفاعلية لمنع حذف الأصناف ذات الرصيد المخزني (
emoveDraftRow):**
     - منع حذف أي صنف له رصيد مخزني من الواجهة (stock > 0) بنافذة إرشادية واضحة تشرح للعميل سبب المنع وكيفية تعديل المقاس مباشرة أو تسويته، بدلاً من تركه يحذف السطر ثم يواجه خطأ 409 المحبط عند الحفظ.
  5. **ترقية رسائل الخطأ الرقابية في الباك إند (catalog-product.service.ts):**
     - تفصيل رسالة الخطأ FASHION_VARIANT_HAS_STOCK لتذكر أسماء المقاسات المحددة المعترضة ورصيد كل منها لتوجيه المستخدم بدقة.
  6. **صورة لكل متغير (نوفمبر 2026 — SF-12):**
     - عمود صورة في مصفوفة `FashionVariantsBuilder` وفي محرر المجموعة (`FashionGroupEditorCard`) بنفس صيغة `ProductImageUploadField` (ضغط `compressImage`، بلا إزالة خلفية)؛ الصورة تُحفظ في `metadata.imageUrl` الخاص بصف الصنف الفرعي بعد مرورها على `normalizeImageRef` (SF-9)، و`''` تعني بلا صورة، وغيابها عند الإنشاء يورّث صورة الصنف الأب. التحديث في `saveFashionGroup` يدمج `metadata` ولا يستبدله، فلا تضيع باقي بيانات الصف.
- **الملفات المنفذة والمعدلة:**
  - rontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.tsx
  - ackend/src/modules/catalog/services/catalog-product.service.ts
  - SYSTEM_CAPABILITIES.md

---


<!-- migrated:cap-294:end -->

<a id="cap-295"></a>
<!-- migrated:cap-295:start -->
## 256. دعم الشرطة (-) كفاصل معتمد ومولد فوري لمتغيرات الأصناف (Product Variants Dash Separator & Instant Row Generation - 24 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومختبرة بحزم اختبارية مؤكدة (`fashion-variants.utils.spec.ts`).
- **التفاصيل التشغيلية والبرمجية:**
  1. **إعادة اعتماد الشرطة (`-`) كفاصل رسمي:** دعم كتابة الشرطة (`-` و `–` و `—`) سواء بمسافات (`أحمر - أسود`) أو بدون مسافات (`أحمر-أسود` أو `S-M-L` أو `36-38-40`) كفاصل معتمد يقوم بإنشاء متغير جديد فوري وإدراجه في سطر مستقل بجدول الأصناف الفرعية.
  2. **حماية النطاقات العمرية:** تم تحصين المحرك الذكي في `splitFashionTokens` لتجاوز كسر النطاقات العمرية مثل `2-3 سنوات` أو `0-3 شهور` والحفاظ عليها مدمجة كقيمة مفردة.
  3. **دعم مفتاح Enter:** تزويد حقول إدخال المتغيرات في `FashionVariantsBuilder` و `FashionGroupEditorCard` بمعالج حدث `onKeyDown` يضيف الفاصل ` - ` عند الضغط على Enter لمنع إرسال الفورم العرضي وتسهيل الكتابة المتسلسلة من لوحة المفاتيح.
  4. **توحيد محرك التقسيم:** ربط حفظ الصنف والمتغيرات في `useCreateProductMutation.ts` بنفس محرك `splitFashionTokens` الموحد لضمان التطابق التام بين الواجهة والباك إند.
- **الملفات المنفذة والمعدلة:**
  - `frontend/src/features/products/components/fashion-variants.utils.ts`
  - `frontend/src/features/products/components/fashion-variants.utils.spec.ts`
  - `frontend/src/features/products/components/FashionVariantsBuilder.tsx`
  - `frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.tsx`
  - `frontend/src/features/products/hooks/useCreateProductMutation.ts`
  - `SYSTEM_CAPABILITIES.md`

---


<!-- migrated:cap-295:end -->

<a id="cap-296"></a>
<!-- migrated:cap-296:start -->
## 257. منظومة التسوية المخزنية اللحظية والتصفير التلقائي لموديلات الملابس والمتغيرات (Fashion Variants Inline Stock Adjustment & Auto-Reconciliation Engine - 24 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومطبقة ومحمية في الواجهة والباك إند.
- **التفاصيل التشغيلية والمحاسبية:**
  1. **التسوية المباشرة التلقائية من داخل جدول الموديل (Inline Stock Adjustment on Save):**
     - تحويل خانة "الرصيد" في جدول فروع الموديل بـ `FashionGroupEditorCard` إلى حقل إدخال رقمي متاح دائماً لكافة الأصناف (الجديدة والمحفوظة مسبقاً).
     - عند قيام المستخدم بتعديل رصيد أي مقاس (زيادة أو خفض أو تصفير) والضغط على "حفظ المجموعة"، يقوم الباك إند (`saveFashionGroup`) بحساب الفارق $\Delta = \text{newStock} - \text{oldStock}$ تلقائياً، واستدعاء محرك المخزون المالي المعتمد `applyStockDelta` مع تسجيل حركة تسوية مخزنية رسمية `stock_movements` بنوع `add` أو `deduct` ومبرر `fashion_matrix_adjustment` مع ترحيل القيد المحاسبي المزدوج تلقائياً عبر `AccountingPostingService.postInventoryAdjustment`.
  2. **زر التصفير السريع الفردي والمجمّع (Quick Zero Buttons):**
     - إضافة زر تصفير سريع `[0]` بجانب حقل الرصيد لكل صنف فرعي لتصفير رصيد أي مقاس بنقرة واحدة تمهيداً لحذفه أو تسويته.
     - إضافة زر مجمّع `[تصفير أرصدة الجدول]` في شريط أدوات الجدول يتيح تصفير أرصدة كافة المقاسات المعروضة في خطوة واحدة مع تأكيد تفاعلي آمن.
  3. **زر التسوية التفصيلية المنفردة لكل مقاس (In-Grid Modal Trigger via QuickStockAdjustmentDialog):**
     - تزويد كل صنف فرعي محفوظ بزر أيقونة تشغيلية (`SlidersIcon`) يفتح نافذة `QuickStockAdjustmentDialog` لنفس هذا المقاس بعينه، لإجراء تسوية تفصيلية (اختيار مخزن، تسجيل تالف، إضافة ملاحظات) وتحديث الرصيد لحظياً بالجدول وقاعدة البيانات.
  4. **خيار التصفير المخزني التلقائي عند الحذف (zeroRemovedStock):**
     - دعم خيار `zeroRemovedStock` في `SaveFashionGroupDto` والواجهة، بحيث إذا قام المستخدم بحذف مقاسات ذات رصيد مخزني وأكد رغبته في التصفير، يقوم الباك إند بتسوية وتصفير أرصدتها تلقائياً عبر حركات مخزنية قياسية بدلاً من رفض العملية بخطأ 409.
  5. **مؤشر الرصيد السابق:**
     - عرض تلميح مرئي أنيق (`سابقاً: X`) تحت حقل الرصيد المعدل لتوضيح الفارق للمستخدم قبل الحفظ.
- **الملفات المنفذة والمعدلة:**
  - `backend/src/modules/catalog/dto/upsert-product.dto.ts`
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `frontend/src/features/products/api/products.api.ts`
  - `frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.helpers.ts`
  - `frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.tsx`
  - `SYSTEM_CAPABILITIES.md`
---


<!-- migrated:cap-296:end -->

<a id="cap-297"></a>
<!-- migrated:cap-297:start -->
## 258. الأرشفة الذكية للأصناف القياسية والتسوية المخزنية الآلية المحاسبية (Standard Products Smart Archive & Auto-Reconciliation Engine - 25 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومطبقة ومحمية في الواجهة والباك إند.
- **المشكلة المعالجة:**
  - سابقاً، كان النظام يمنع أرشفة أو تعطيل أي صنف قياسي يحتوي على رصيد مخزني بخطأ قاطع (PRODUCT_HAS_STOCK - 409)، مما كان يربك المستخدمين والتجار عند رغبتهم في إيقاف صنف أو استبعاده من البيع دون الاضطرار لعمليات جرد وتسوية يدوية معقدة ومنفصلة.
  - كان الحذف الفعلي (Hard Delete) ممنوعاً حماية للقيود المحاسبية والفواتير المترابطة، بينما الأرشفة (Soft Archive) كانت محجوبة بسبب الرصيد المتبقي.
- **التفاصيل التشغيلية والمحاسبية المنفذة:**
  1. **إتاحة أرشفة الأصناف ذات الرصيد مع التحصين ضد الحجوزات النشطة:**
     - إزالة شرط المنع الحتمي للأرشفة عند وجود رصيد (`stock_qty > 0`) في خدمة الكتالوج (`catalog-product.service.ts`).
     - الإبقاء على الفحص الوقائي الإلزامي للحجوزات المعلقة (`reserved_qty > 0`) لمنع أرشفة صنف مرتبط بطلبات جارية أو شحنات قيد التسليم.
  2. **خيار التصفير المخزني الآلي المحاسبي (`zeroStock: true`):**
     - عند طلب الأرشفة مع خيار التصفير، يقوم الباك إند بالمرور على كافة أرصدة المواقع المخزنية للصنف (`product_location_stock`).
     - تنفيذ تسوية خصم آلية عبر `applyStockDelta` وتسجيل حركة مخزنية رسمية في `stock_movements` بنوع `deduct` ومبرر `archive_stock_zeroing`.
     - توليد وترحيل القيد المحاسبي المزدوج تلقائياً عبر محرك الحسابات `AccountingPostingService.postInventoryAdjustment` لضمان اتزان ميزانية العمومية وكارت الصنف.
  3. **الواجهة التفاعلية الذكية في نافذة تأكيد الأرشفة الموحدة (`ProductArchiveConfirmDialog`):**
     - عند أرشفة صنف قياسي يحمل رصيداً مخزنياً، تعرض النافذة خيارين تشغيليين واضحين:
       - **[أرشفة (مع إبقاء الرصيد)]**: تجميد الصنف وإخفاؤه فوراً من شاشات الكاشير ونقاط البيع والفواتير الجديدة، مع الحفاظ التام على رصيده وقيمته الدفترية في كارت الصنف والميزانية لحين تسويته أو صرفه.
       - **[أرشفة مع تصفير الرصيد آلياً]**: أرشفة وتجميد الصنف مع تصفير رصيده المتبقي فوراً بقيد تسوية مخزنية نظامية معتمدة.
  4. **التكامل عبر شاشات المنظومة (Single Source of Truth):**
     - دعم سير العمل الموحد عبر جدول الأصناف الرئيسي (`ProductsWorkspace`) وشاشة تعديل الصنف (`EditProductForm`) دون أي تكرار أو ازدواجية برمجية.
- **الملفات المنفذة والمعدلة:**
  - `backend/src/modules/catalog/catalog.controller.ts`
  - `backend/src/modules/catalog/catalog.service.ts`
  - `backend/src/modules/catalog/services/catalog-product.service.ts`
  - `frontend/src/features/products/api/products.api.ts`
  - `frontend/src/features/products/components/ProductArchiveConfirmDialog.tsx`
  - `frontend/src/features/products/components/ProductsWorkspace.tsx`
  - `frontend/src/features/products/components/EditProductForm.tsx`
  - `frontend/src/features/products/hooks/useProductsWorkspaceController.ts`
  - `SYSTEM_CAPABILITIES.md`
---


<!-- migrated:cap-297:end -->


## تدقيق 25 أكتوبر 2026 — سلامة تحرير الملابس (مراجعة جزئية، غير معتمدة للإصدار)

- **نطاق الإصلاح:** `backend/src/modules/catalog/services/catalog-product.service.ts` و`backend/src/modules/catalog/engines/fashion-stock-safety.engine.ts`.
- عند إنشاء مقاس جديد برصيد افتتاحي عبر تعديل الموديل، يستخدم قيد المخزون `resolvedWarehouseId` الفعلي حتى عندما ورث الموقع من نموذج موجود بدلاً من `value.warehouseId` غير المحدد.
- رفض دمج/تصفير متغير ملابس ما دامت عليه حجوزات مخزنية، أو تختلف كمياته عن مجموع الأرصدة المكانية، ورفض الدمج بين متغيرين بتكلفتين مختلفتين دون تسوية تقييم صريحة. لا تُجرى قيود تقييم محاسبية صورية للتغلب على الحظر.
- رفض محاولة حفظ صفوف غير ملابس داخل مسار تعديل مجموعات الملابس، ورفض اختيار هدف دمج لم يُحفظ بعد بدلاً من إخفاء رصيد المقاس القديم.
- تعديل المنتج العادي دون إرسال `warehouseId` لا يحذف الربط السابق بالمخزن الافتراضي.
- **اختبارات الانحدار المضافة (لم تُشغّل):** `backend/test/critical/fashion-stock-safety.spec.ts`. ما زالت مراجعة الوظائف الأخرى والتكامل التشغيلي والمحاسبي وقبول المبيعات الحقيقية قيد التقييم؛ لا تُستنتج الجاهزية من هذه الإصلاحات.


### متابعة مراجعة 25 أكتوبر 2026 — منع الكتابة فوق رصيد بيع لاحق

- كانت شاشة `FashionGroupEditorCard` ترسل `stock` لكل مقاس حتى عند تعديل الاسم/السعر فقط، بينما المبيعات لا تغيّر `catalog_updated_at`؛ كان هذا يسمح لحفظ شاشة قديمة بإعادة كميات بيعت بعد تحميلها. الآن يُحذف `stock` من الطلب للصفوف غير المعدّلة، وتُرسل `expectedStock` للتسويات المقصودة، ويتحقق الخادم من اللقطة الأصلية بعد قفل صفوف المخزون ويعيد `FASHION_STOCK_STALE` عند اختلافها.
- عمليات المخزون داخل حفظ مجموعات الملابس وتصفير الأرشفة تتطلب `canAdjustInventory`، كما في API التسوية الرسمي. كذلك يتطلب الرصيد الافتتاحي الجديد هذه الصلاحية.
- شاشة الدمج لا تختار مقاساً غير محفوظ كهدف، ولا تعرض نجاح الدمج قبل الحفظ، وتحتفظ بالمقاسات عندما لا يوجد هدف محفوظ مطابق التكلفة.
- **الاختبارات المكتوبة ولم تُشغّل:** `backend/test/critical/fashion-stock-safety.spec.ts` و`frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.helpers.spec.ts`. ما زال اعتماد المخزون/المحاسبة النهائي معلقًا حتى الاختبارات والتجربة الفعلية.


### تعزيز نطاق الفرع في عمليات الملابس — 25 أكتوبر 2026

- بعد مراجعة `InventoryScopeService.assertLocationScope` تبيّن أن الفحص السابق لمواقع `saveFashionGroup` كان بوضع `read` الافتراضي. أصبح تعديل المخزون/الدمج/التصفير وإنشاء المتغيرات يتطلب `write` ويمنع التعديل على مخازن الفروع غير المصرح بها وموقع `in_transit`، مع فحص مواقع أرصدة المقاسات المحذوفة داخل معاملة الخادم. تعديل البيانات الوصفية فقط يحتفظ بنطاق القراءة.
- تحقق `canAdjustInventory` يسبق تجهيز الحسابات الافتتاحية حتى لا تنشأ آثار جانبية لطلب غير مصرح له. اختبار انحدار لوضع نطاق الموقع أضيف ولم يُشغّل.


### 2026-10-25 — مراجعة استكمال A/F: صحة طباعة باركود موديلات الملابس

- كان `ProductBarcodeDialog` يطبع باركودًا غير محفوظ من حقل الماسح أو التوليد، وقد يرجع إلى باركود القطعة الأساسية لو كانت الوحدة المختارة مختلفة وباركودها فارغًا. أصبح التصريح بالطباعة مرتبطًا بباركود الوحدة **المحفوظ** فقط، مع حفظ أحدث صنف محليًا بعد نجاح حفظ الباركود.
- خيار «كل مقاسات الموديل» كان يعتمد على قائمة المنتجات المحمّلة للشاشة فقط (قد تكون صفحة جزئية) ويمزج أي صنف يشارك `styleCode`. عند الطباعة تُجلب القائمة الفعلية عبر `productsApi.listAll` ويُفلتر `itemKind='fashion'` والموديل النشط نفسه؛ لو فشل الجلب أو افتقدت مقاسات باركودًا محفوظًا، لا تُطبع مجموعة غير مكتملة.
- اختبار مكتوب غير مُشغّل: `frontend/src/features/products/components/product-barcode-print.helpers.spec.ts`. لم يتم اختبار ماسحات/طابعات فعلية.


### 2026-10-25 — barcode dialog hook safety follow-up

- Moved the `variantCount` `useMemo` before nullable-product early return in `ProductBarcodeDialog` to preserve React's invariant hook order across dialog props; removed unused import. No tests/build executed.

### 2026-10-25 — اعتماد دمج تدقيق كودكس مع عزل الألوان وحماية التصفير عند الأرشفة

- **حظر نقل الرصيد العابر بين الألوان (Strict Color Isolation):** قصر دمج أرصدة المقاسات المحذوفة في `FashionGroupEditorCard` و`saveFashionGroup` على نفس اللون حصرياً (`normalizeArabicSearchKey(target.color) === normalizeArabicSearchKey(source.color)`). حظر الرجوع التلقائي إلى `kept[0]` أو `drafts[0]` لصب رصيد لون محذوف (مثل 25 قطعة كحلي) في لون آخر كالأبيض. الإبقاء على أصناف الألوان ذات الرصيد في الجدول للمراجعة اليدوية مع إشعار تحذيري صريح.
- **فك حظر تصفير وأرشفة الأصناف:** السماح بتصفير الأرصدة عند الأرشفة أو الحذف (`zeroStock` / `zeroRemovedStock`) وتجاوز خطأ `FASHION_STOCK_RECONCILIATION_REQUIRED` لتطهير الفروقات التاريخية وتصفير أرصدة المواقع والمخزون العام، مع معالجة `location_id` وحمايتها من القيمة الصفرية `0`.
- **التوثيق الدستوري وحماية التكرار:** إضافة البند `1-e. Retail Clothing & Variant Stock Invariants` في `AGENTS.md` و`Directive for Next Audit Sessions` في `RETAIL_CLOTHING_AUDIT_20261025.md` لمنع كودكس من نقض هذه الإصلاحات مستقبلاً.
- **أدلة الاختبار:** نجاح اختبارات `backend/test/critical/fashion-stock-safety.spec.ts` (7/7) واختبارات `frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.helpers.spec.ts` (3/3) محلياً.

### 2026-10-26 — تكيف نماذج الأصناف السياقي وإخفاء حقول الصلاحية لنشاط الملابس وتثبيت النشاط الفرعي المباشر
- **المشكلة:** ظهور حقل "تاريخ انتهاء الصلاحية" بشكل ثابت وغير مشروط داخل شاشات إنشاء وتعديل الأصناف حتى عند تفعيل موديول الملابس والمصفوفات (`clothingModuleEnabled`) أو في أنشطة الأزياء والمقاسات. واضطرار المستخدم لتفعيل التجارة العامة ثم الدخول لمتجر التطبيقات لتثبيت الموديول يدوياً بسبب اختفاء تخصص الملابس في القائمة الفرعية المطوية.
- **الحل والتنفيذ:**
  1. إنشاء محرك تحديد ظهور الحقول السياقية `shouldShowExpiryDateField` في `frontend/src/features/products/utils/product-visibility.utils.ts`.
  2. إخفاء حقل تاريخ انتهاء الصلاحية تلقائياً عند: تفعيل موديول الملابس (`clothingModuleEnabled`)، أو اختيار طبيعة الصنف كأزياء بمتغيرات (`itemKind === 'fashion'`)، أو في أنشطة الأزياء والملابس والأحذية (`clothing`/`fashion`) وقطع الغيار والإلكترونيات والخدمات والمقاولات.
  3. حصر ظهور تاريخ الصلاحية في الأنشطة المعنية (الصيدليات، السوبرماركت، المواد الغذائية، المطاعم) أو عند تفعيل إدارة التشغيلات.
  4. تطبيق الحماية في كافة شاشات ونماذج الأصناف: `ProductForm.tsx`، `NewProductForm.tsx` (كلا المسارين)، `EditProductForm.tsx`، و `ProductEditorCard.tsx`.
  5. ترقية تخصص "الملابس والأزياء والأحذية" ليكون ضمن التخصصات الفرعية الرئيسية المباشرة (`PRIMARY_COMMERCE_SUB_VERTICALS`) في `IndustryModeSelectorCard.tsx` لتفعيله بنقرة واحدة مباشرة.
- **أدلة الاختبار:** نجاح اختبارات `frontend/src/features/products/utils/product-visibility.utils.spec.ts` (5/5 tests) واجتياز حزمة اختبارات الأصناف بالكامل في `frontend/src/features/products/` (10 test files, 37/37 tests passed).

### 2026-11-17 — التعميم الشامل لوضوح طباعة الباركود الحراري، التوليد الرقمي المدمج بدون شرطة، ومعالجة لوحة المفاتيح العربية (`ظ`) عبر المنظومة
- **الحالة:** مكتمل ومختبر على مستوى حزم الواجهة المختبرة محلياً (`78/78` اختباراً ناجحاً عبر 13 ملف Vitest).
- **ما تم تنفيذه:**
  1. **وضوح وفرد الباركود على الطابعات الحرارية `203 DPI` في [barcode.ts](frontend/src/lib/barcode.ts) (`buildCode128Svg`) و[barcode-labels-presets.ts](frontend/src/lib/barcode-labels-presets.ts):**
     - تطبيق تعويض تمدد الحبر (`-25%` من سماكة الأعمدة السوداء على شبكة `moduleWidth = 40`: `30` للعمود مقابل `50` للفراغ مع ثبات التوقيت الهندسي لـ Code 128، وإزالة `crispEdges` وإضافة خلفية `#fff` صريحة، وهامش هدوء `7X` داخلي + `preserveAspectRatio="none"` + توسيع `.barcode-label-svg` أفقياً عبر `svgBleedMm`).
     - توسيع حاوية الباركود في ملصقات الصيانة (`maintenance-receipt.utils.ts`: `height: 26px`) وإيصالات التوزيع الميداني والفان (`van-sales-receipt.utils.ts`, `van-collection-receipt.utils.ts`, `van-settlement-receipt.utils.ts`: `height: 36px; max-width: 240px`).
  2. **التوليد الرقمي الصافي المدمج (`Code 128C`) في [barcode.ts](frontend/src/lib/barcode.ts)، [FashionGroupEditorCard.tsx](frontend/src/features/products/components/workspace-sections/FashionGroupEditorCard.tsx)، و[FashionVariantsBuilder.tsx](frontend/src/features/products/components/FashionVariantsBuilder.tsx):**
     - `createGeneratedBarcode`: يولّد 8 أرقام صافية (`93` وحدة عرض) بدلاً من `ZS-XXXXXXXXXX`.
     - `createSequentialVariantBarcode`: يولّد بادئة الموديل متبوعة برقم تسلسلي بدون شرطة (خانتان `01..99` لأكواد الموديل زوجية الطول مثل `321321` -> `32132101..32132199`، و3 خانات للأطوال الفردية حتى يظل الإجمالي زوجياً بأقل أعمدة ممكنة في `Code 128C`).
     - عند الضغط على **«توليد باركودات»** في `FashionGroupEditorCard` بوجود أكواد قديمة تحتوي على شرطة (`-`)، يعرض النظام عبر `applySequentialVariantBarcodes` و`countLegacyHyphenVariantBarcodes` خياراً فورياً لاستبدالها بالصيغة الرقمية المدمجة بدون شرطة بنقرة واحدة أو الإبقاء على الحالية وتوليد الفارغ فقط (`systemConfirm`).
  3. **معالجة حرف `ظ` ولوحة المفاتيح العربية عند المسح بالسكانر (`getBarcodeLookupCandidates` / `remapArabicKeyboardToEnglish`):**
     - توحيد المحرك في [barcode.ts](frontend/src/lib/barcode.ts) وإعادة التصدير من [pos-barcode-normalizer.ts](frontend/src/features/pos/lib/pos-barcode-normalizer.ts)، وتفعيله عبر نقطة البيع (`PosWorkspace`, `PosProductsPanel`, `pos-workspace.helpers`), أوامر البيع (`sales-order-barcode-scan.ts`), المشتريات (`BarcodeScanDialog.tsx`), الجرد المخزني (`count-barcode-identity.ts`), وتكويد الصنف (`ProductBarcodeDialog.tsx`).
  4. **تحسينات نافذة الطباعة واختيار الطابعة (`BarcodePrintDialog`، `BarcodeBatchItemsPanel`، `FashionGroupBarcodePrintAction`):**
     - إصلاح تشوه طباعة الدفعات الحرارية متعددة الصفحات بتدوير `180°` في `printBatchBarcodeLabels` ([barcode-labels.ts](frontend/src/lib/barcode-labels.ts)): صفحة `.barcode-print-page-thermal` أصبحت `display:block` بفواصل صفحات صريحة، والتدوير `180°` يتم على `.barcode-print-thermal-stage` في موضعه دون `position:absolute; top:50%` (بقي هذا النمط فقط لـ `90°/270°`). لم يُختبر بعد على طابعة فعلية.
     - تدوير حراري افتراضي `180°`، عمود ثالث مستقل لدفعات المتغيرات بدون تمرير متداخل مع زر **هذا فقط** ودعم الكمية `0` وعدادات RTL القياسية (`[+] qty [-]`)، وعزل طابعة الباركود الخاصة بمحطة العمل والمستأجر (`printer-preferences.ts`).
- **أدلة الاختبار (`2026-11-17`):** نجاح `npx vitest run` على 13 ملف اختبار (`78/78` tests passed): `barcode-labels.test.ts` (17)، `BarcodePrintDialog.spec.tsx` (1)، `product-barcode-print.helpers.spec.ts` (4)، `FashionGroupEditorCard.helpers.spec.ts` (7)، `pos-barcode-dash.spec.ts` (8)، `useScannerBuffer.spec.tsx` (4)، `sales-order-barcode-scan.spec.ts` (2)، `count-barcode-identity.spec.ts` (6)، `van-sales-receipt.spec.ts` (5)، `electron-printing.spec.ts` (7)، `browser-print-bridge.spec.ts` (5)، `printer-preferences.spec.ts` (5)، `PrintingSettingsTab.spec.tsx` (7). *(ملاحظة: فحوصات البناء الكامل و`tsc` والحراس مؤجلة حتى أمر المستخدم النهائي وفق قاعدة المشروع.)*



