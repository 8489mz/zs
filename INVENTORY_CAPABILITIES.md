# قدرات المخزون والمستودعات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **المخزون والمستودعات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/inventory/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [الأصناف والوحدات والمتغيرات](CATALOG_CAPABILITIES.md) · [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md) · [التصنيع والجودة](MANUFACTURING_CAPABILITIES.md)

## التحديثات الحالية

<a id="cap-294"></a>
### 294. مزامنة أرصدة المخازن اللحظية ومنع سباق التوقيت والقطع المبكر في بحث أصناف «إذن صرف جديد» (Issue Order Product Picker Real-Time Stock Sync & Race-Free Combobox - 24 November 2026)
* **حالة القدرة:** تم التحديث في الكود (24 نوفمبر 2026؛ التحقق الموسع مؤجل لنهاية الجلسة).
* **المسارات المتأثرة:**
  - `backend/src/modules/inventory/services/inventory-scope.service.ts` (`getAllLocationStocks`)
  - `frontend/src/shared/ui/searchable-combobox.tsx`
  - `frontend/src/shared/ui/async-searchable-combobox.tsx`
  - `frontend/src/shared/hooks/use-inventory-action-catalog.ts`
  - `frontend/src/shared/api/inventory.api.ts`
  - `frontend/src/app/query-keys.ts`
  - `frontend/src/app/query-invalidation.ts`
  - `frontend/src/features/inventory/components/issue-order/types.ts`
  - `frontend/src/features/inventory/components/issue-order/useNewIssueOrderController.ts`
  - `frontend/src/features/inventory/components/issue-order/IssueOrderItemsTable.tsx`
  - `frontend/src/features/inventory/components/issue-order/IssueOrderMobileCards.tsx`
  - `frontend/src/features/inventory/pages/NewIssueOrderPage.tsx`
  - يعتمد ترتيب هوية الأصناف واستبعاد ضوضاء الموردين على المحرك الموثق في [CATALOG_CAPABILITIES.md](CATALOG_CAPABILITIES.md#cap-263).
* **السلوك والضوابط:**
  1. **القضاء على سباق التوقيت والوميض القديم في `AsyncSearchableCombobox`:** إعادة تقييم نتائج البحث لحظياً (`0ms`) عبر `refreshKey` فور اكتمال جلب `/api/location-stocks` أو تغيير «من مخزن»، مع فلترة محلية فورية تمنع وميض خيارات سابقة غير مطابقة وعرض «جارٍ البحث...» أثناء انتظار الشبكة، ورفع سقف القائمة المنسدلة إلى `50` صنفاً (`maxResults=50`).
  2. **دقة الأرصدة المتاحة وإبطال الكاش اللحظي:** توحيد شرط `account_id` في `getAllLocationStocks` وإرجاع `availableQty` صافية من المحجوزات (`reserved_qty`)، وضبط `staleTime: 0` و`refetchOnMount: 'always'` لمفتاح `queryKeys.locationStocks` مع إبطاله تلقائياً بعد فواتير المشتريات وإضافة الأصناف وأذونات الصرف.
  3. **وضوح الأصناف الصفرية وغير المسندة:** تصدُّر الأصناف المتاحة في المخزن المحدد مع شارة رصيدها، وعرض الأصناف الصفرية أو المتاحة بمخازن أخرى أو غير المسندة لمخزن في أسفل القائمة بشارة توضيحية وتنبيه `toast.warning` عند النقر بدلاً من الإخفاء الصامت بعبارة «لا توجد نتائج».

### Foundation P1 — 26 October 2026 (verification pending)
Inventory adjustment, physical count and damage source writes now use the tenant base-currency minor-unit scale (KWD/OMR 3, EGP 2) in the same transaction as GL posting. This removes the verified cent-rounding mismatch for a one-fil variance. Regression evidence: `backend/test/acceptance/core-accounting.postgres.spec.ts` exercises the real KWD adjustment, damaged stock and count source, matching inventory/expense GL, period-lock rollback and count retry; **written, not yet certified until new branch CI is green**.


عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

## فهرس الأقسام المنقولة

- [قدرة: نمط ومساحة عمل إدارة المستودعات والتحويلات المخزنية المعزولة (Dedicated Warehousing & Multi-Branch Stock Transfers Sub-Vertical — WMS) — ✅ مفعّلة ومحروسة 100% (أكتوبر 2026)](#cap-017)
- [29. محرك إمداد الأرفف الذكي وأمر التحميل والملخص التنفيذي واللوجستي اليومي (Smart Shelf Replenishment & Executive Daily Digest) ⚡🌙](#cap-055)
- [73. أماكن التخزين والأرفف والجرد الفوري بالباركود (Warehouse Bins, Shelves & Mobile Audit)](#cap-098)
- [181. إدارة الطرود والتعبئة متعددة الطبقات والطبليات (Pack-in-Pack & Pallet Barcoding)](#cap-215)
- [186. محرك قواعد إعادة الطلب التلقائي وتوليد أوامر الشراء (Automated Reordering Rules & Min/Max Auto-PO Generation - Odoo 18 Standard)](#cap-220)
- [Purchases and inventory integrity (2 October 2026)](#cap-227)
- [221. منظومة عزل وتخصيص تقارير وجرد المخازن المستقلة (Strict Warehouse-Scoped Inventory Reports & Stock Counting)](#cap-289)
- [115. تقسيم وتبويب أماكن المخزون الذكي وفصل سيارات التوزيع عن المستودعات الثابتة (Warehouse Locations Segmentation & Van Stock Isolation)](#cap-290-2)
- [254. أدوات التصفير السريع والجرد الصفري الذكي لجلسات جرد المخزون (Smart Zero-Count & Quick Zeroing Tools for Inventory Sessions - 23 October 2026)](#cap-293)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-017"></a>
<!-- migrated:cap-017:start -->
### قدرة: نمط ومساحة عمل إدارة المستودعات والتحويلات المخزنية المعزولة (Dedicated Warehousing & Multi-Branch Stock Transfers Sub-Vertical — WMS) — ✅ مفعّلة ومحروسة 100% (أكتوبر 2026)
- **الغرض والجمهور المستهدف:** مخصص للمنشآت والمؤسسات التي تستخدم المنظومة كإدارة مستودعات متقدمة ومراكز توزيع وتحويلات بين الفروع والمخازن دون الحاجة لنقاط البيع (POS) أو ورديات الكاشير أو التجارة الإلكترونية.
- **العزل البنيوي الشامل (Zero POS / Zero Retail Leakage):**
  - **حظر تام لنقطة البيع والكاشير:** حظر مسارات `/pos`، `cash-drawer`، ورديات العمل، شاشات العرض والمطابخ، المناديب، والمتجر الإلكتروني في محرك النمط (`vertical-scope.ts`) ومصفوفة الوصول (`access.ts`) مع رسالة توجيهية مؤسسية بديلة في صفحة الكاشير تحول المستخدم إلى مساحة المستودعات.
  - **قفل الإعدادات والترحيل الآلي (`SettingsMainForm.tsx` & `settings.service.ts` & `saas-admin.service.ts`):** عند اختيار نمط "إدارة المستودعات والتحويلات" أو إسناد الباقة، يتم قفل `posModuleEnabled = false` و `requireCashierShiftForSales = false` تلقائياً وفرض تمكين المستودعات والمشتريات والميزات المؤسسية.
  - **صفحة الهبوط المباشرة (`post-login-route.ts`):** تحويل المستخدم فور تسجيل الدخول مباشرة إلى مساحة المستودعات `/inventory` بدلاً من شاشات البيع أو نقاط البيع.
- **شريط التنقل ومساحة العمل المؤسسية المتخصصة (`app-shell.tsx`):**
  - شريط إجراءات رئيسي علوي يركز على (لوحة العمليات، المستودعات والتحويلات، الفروع والمخازن، المشتريات).
  - سايد بار تنفيذي معزول يضم 7 مجموعات وظيفية دقيقة:
    1. المستودعات والتحويلات (أرصدة المخزون، الفروع والمستودعات، أذون الصرف المخزني، شجرة ومواقع التخزين، الأرفف والخلايا).
    2. الأصناف والباركود (كتالوج الأصناف والوحدات، التصنيفات).
    3. المشتريات والتوريد (فواتير الشراء، أوامر الشراء، حدود إعادة الطلب، مرتجعات المشتريات، الموردون).
    4. المبيعات وصرف البضاعة (أوامر البيع، فواتير المبيعات وصرف البضاعة، عروض الأسعار، العملاء، المرتجعات).
    5. المالية والمحاسبة (القيود اليومية، شجرة الحسابات، مراكز التكلفة، الخزينة، المصروفات، الميزانية العمومية).
    6. الموارد البشرية وفريق العمل.
    7. تقارير المخزون والأداء اللوجستي.
- **شاشات التخصيص والتهيئة وبطاقات النمط:**
  - إضافة بطاقة النمط الفرعي "إدارة المستودعات" في إعدادات المنظومة (`IndustryModeSelectorCard.tsx`) بخلفية نظيفة وأيقونة الطبقات المؤسسية.
  - إضافة النمط في خطوات تهيئة المشترك الجديد Onboarding (`Step3Industry.tsx`).
  - دعم النمط في المودال الإعدادي الموديولي للمنظومة (`modular-presets.ts`).
- **كتالوج التسعير والباقات (`pricing-catalog.json` & `PricingCatalogService`):**
  - اعتماد باقة ومنتج مستقل "إدارة المستودعات والتحويلات المخزنية" (`warehousing`) بنطاق Band 3 وتجاوز مجموعات الميزات (`warehousing_core`) لضمان خلو بطاقات الباقة ومطوياتها من أي ذكر للكاشير أو نقاط البيع، واجتياز حارس كتالوج التسعير بنجاح تام 100%.
- **الحراسة الآلية المستمرة:**
  - اختبارات وحدة صارمة في `frontend/src/shared/verticals/vertical-scope.spec.ts` تثبت الاستنتاج التلقائي للنمط وحظر مسار POS وكافة مسارات التجزئة وتمكين مسارات المستودعات بدقة 100%.


<!-- migrated:cap-017:end -->

<a id="cap-055"></a>
<!-- migrated:cap-055:start -->
## 29. محرك إمداد الأرفف الذكي وأمر التحميل والملخص التنفيذي واللوجستي اليومي (Smart Shelf Replenishment & Executive Daily Digest) ⚡🌙
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **الباك إند والخدمات:** `backend/src/modules/inventory/services/inventory-replenishment.service.ts`, `backend/src/modules/inventory/inventory.controller.ts`, `backend/src/modules/inventory/inventory.module.ts`, `backend/src/modules/settings/services/daily-digest.service.ts`, `backend/src/modules/settings/controllers/daily-digest.controller.ts`, `backend/src/modules/settings/settings.module.ts`
  * **الفرونت إند والواجهات:** `frontend/src/features/inventory/api/inventory-replenishment.api.ts`, `frontend/src/features/inventory/components/SmartReplenishmentModal.tsx`, `frontend/src/features/inventory/components/ReplenishmentPickListPrintModal.tsx`, `frontend/src/features/pos/components/pos-workspace/PosWorkspaceHeader.tsx`, `frontend/src/features/inventory/components/InventoryWorkspaceHeader.tsx`, `frontend/src/features/settings/api/daily-digest.api.ts`, `frontend/src/features/settings/components/workspace-sections/SettingsDailyDigestSection.tsx`, `frontend/src/features/settings/pages/settings.page-config.ts`, `frontend/src/features/settings/pages/SettingsSectionContent.tsx`
* **الجداول في قاعدة البيانات:** `stock_transfers`, `stock_transfer_items`, `stock_movements`, `product_location_stock`, `products`, `product_units`, `sales`, `sale_items`, `settings`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **محرك الاحتساب الذكي لإمداد الأرفف وتغطية 48 ساعة** | 🟢 | 100% | `inventory-replenishment.service.ts`, `inventory.controller.ts` | فحص آلي لمبيعات صالة المحل خلال الـ 48 ساعة الماضية، وحصر الأصناف التي نفدت تماماً والأصناف الحرجة التي قاربت على النفاد، مع تقريب الكميات آلياً إلى وحدات التعبئة الكبرى (الكرتونة / الباكتة) بناءً على `product_units`، مع تقييد المقترح بالرصيد المتاح فعلياً في المستودع الرئيسي. |
| **تتبع أرصدة سائر المخازن (7 مخازن) وتوجيه الصرف للحاجات المتوفرة فقط** | 🟢 | 100% | `inventory-replenishment.service.ts`, `SmartReplenishmentModal.tsx` | قراءة أرصدة الصنف في كافة مخازن المؤسسة بالكامل؛ منع النظام من اقتراح كميات لصنف من مستودع رصيده فيه صفر، وتنبيه الكاشير فورياً بالمخازن البديلة التي يتوفر بها الصنف ورصيده في كل مخزن (مثال: متوفر في مخزن 2: 40 قطعة) لتوجيه الصرف بدقة. |
| **محرك التنبؤ بمواعيد الشراء ونفاد المخزون (Predictive Purchase Deadlines)** | 🟢 | 100% | `inventory-replenishment.service.ts`, `daily-digest.service.ts`, `SmartReplenishmentModal.tsx` | حساب معدل الاستهلاك اليومي (Burn Rate) استناداً إلى مبيعات الأسبوع، وحساب أيام التغطية المتبقية لإجمالي رصيد المؤسسة (`Days of Supply`)، وإصدار تاريخ شراء إلزامي محدد (مثال: يجب الشراء قبل الأربعاء 9 سبتمبر لتفادي توقف البيع) يظهر في شاشة الإمداد وفي رسالة الواتساب اليومية للمدير. |
| **نافذة الكاشير والمشرف التفاعلية لإذن الصرف (Smart Restock Modal)** | 🟢 | 100% | `SmartReplenishmentModal.tsx`, `inventory-replenishment.api.ts` | نافذة مؤسسية متجاوبة تعرض شارات النواقص الحية، وتحليل أعداد القطع المطلوبة، وجدول تفاعلي يتيح تعديل الكميات بسهولة (+ أو - أو إدخال رقمي مباشر) مع بيان المعادل بالكراتين، وحذف أو إضافة الأصناف. |
| **الاعتماد الآلي بنقرة واحدة وطباعة أمر التحميل (Pick-List)** | 🟢 | 100% | `SmartReplenishmentModal.tsx`, `ReplenishmentPickListPrintModal.tsx`, `inventory-transfer.service.ts` | بنقرة واحدة: ترحيل إذن التحويل المخزني معتمداً رسمياً برقم مسلسل موحد، خصم رصيد المستودع وزيادة رصيد صالة المحل دفترياً فورياً ومحاسبياً، وانبثاق نافذة طباعة رسمية لأمر التحميل والنقل مزودة بمربعات تدقيق `[ ]` وخانات توقيع المسلِّم والمستلم للطباعة على طابعات A4 والطابعات الحرارية للعامل. |
| **أزرار الإطلاق السريع في نقاط البيع وإدارة المخازن** | 🟢 | 100% | `PosWorkspaceHeader.tsx`, `InventoryWorkspaceHeader.tsx` | زر وصول سريع وبارز «⚡ إمداد الأرفف الذكي» في ترويسة الكاشير والـ POS وفي شريط أدوات المخزون والتحويلات للتشغيل المباشر دون الحاجة للانتقال بين القوائم. |
| **الملخص التنفيذي واللوجستي اليومي المجدول عبر الواتساب للمدير (Executive Daily Digest)** | 🟢 | 100% | `daily-digest.service.ts`, `daily-digest.controller.ts`, `SettingsDailyDigestSection.tsx`, `daily-digest.api.ts` | خدمة خلفية مجدولة ترسل رسالة واتساب منسقة ليلياً للمدير تشمل: (1) ملخص مبيعات اليوم والسيولة النقدية والشبكة والأصناف الأكثر رواجاً، (2) كشف تفصيلي بكل إذن صرف وتحويل نُقل للمحل اليوم (اسم كل صنف وكميته المنصرفة بدقة)، (3) تنبيهات استباقية لنواقص المخازن مع مواعيد الشراء الإلزامية المحددة باليوم والتاريخ. |
| **شاشة إعدادات التقرير ومحاكي رسائل الواتساب الحي** | 🟢 | 100% | `SettingsDailyDigestSection.tsx`, `settings.page-config.ts`, `SettingsSectionContent.tsx` | شاشة إدارة مخصصة في الإعدادات لضبط رقم هاتف المدير، توقيت الإرسال اليومي، مفاتيح تفعيل/تعطيل أقسام التقرير، محاكي محادثة واتساب حي يعرض شكل الرسالة كما ستصل لهاتف المالك، وزر فحص مباشر لإرسال ملخص تجريبي فوري. |

---


<!-- migrated:cap-055:end -->

<a id="cap-098"></a>
<!-- migrated:cap-098:start -->
## 73. أماكن التخزين والأرفف والجرد الفوري بالباركود (Warehouse Bins, Shelves & Mobile Audit)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Odoo 18 Storage Locations / Putaway Rules & Barcode Stock Audit.
* **روابط وشاشات الوصول:** `/inventory/bins` (القائمة الجانبية: المخزون والأصناف ➔ أماكن التخزين والأرفف).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000064_warehouse_bin_locations.ts`, `backend/src/database/database.types.ts` (`warehouse_bins`, `product_bin_allocations`).
  * **الباك إند:** `backend/src/modules/inventory/services/warehouse-bins.service.ts`, `backend/src/modules/inventory/controllers/warehouse-bins.controller.ts`, `backend/src/modules/inventory/inventory.module.ts`.
  * **الفرونت إند:** `frontend/src/features/inventory/api/warehouse-bins.api.ts`, `frontend/src/features/inventory/pages/WarehouseBinsPage.tsx`, `frontend/src/features/inventory/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **دليل وهيكل أماكن التخزين الثلاثي (Aisle / Rack / Shelf / Bin):** إدارة الأرفف والمسارات التخزينية داخل كل مستودع وتعيين سعات تخزينية قصوى ونوع التخزين المخصص.
  2. **تخصيص وربط مواقع الأصناف (Product Allocations):** تعيين موقع التخزين الأساسي والثانوي لكل صنف لتسهيل عمليات التجهيز والانتقاء (Picking & Putaway).
  3. **الجرد الفوري بالباركود من الجوال وقارئ الباركود (Instant Barcode Stock Audit):** مسح كود الرف وكود الصنف لتسجيل الرصيد الفعلي ومقارنته بالرصيد الدفتري فورياً مع تبيان الفروقات وحفظ سجل التدقيق.

---


<!-- migrated:cap-098:end -->

<a id="cap-215"></a>
<!-- migrated:cap-215:start -->
## 181. إدارة الطرود والتعبئة متعددة الطبقات والطبليات (Pack-in-Pack & Pallet Barcoding)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (29 سبتمبر 2026).
* **المسار:** `/inventory/packages`.
* **المشكلة المعالجة:**
  - تمكين المستودعات والمصانع ومراكز التوزيع من إدارة التعبئة الهرمية متعددة المستويات (قطعة -> علبة/صندوق -> كرتونة -> طبلية/بالتة خشبية -> حاوية شحن)، والقضاء على العجز في جرد أو مناولة البضائع المعبأة في طبليات دون الحاجة لفتح كل صندوق ومعرفة إجمالي ما بداخل الطبلية بمسحة باركود واحدة.
* **الهندسة والحلول المنفذة:**
  1. **هجرة قاعدة البيانات (2040000000174_warehouse_packages_and_pallet_barcodes.ts):**
     - إنشاء جدول الطرود والطبليات (`warehouse_packages`) مع الحقول الهرمية (`parent_package_id`, `package_type`, `gross_weight_kg`, `status`).
     - إنشاء جدول بنود الطرود (`warehouse_package_items`) لربط الأصناف بالتشغيلات والأرقام التسلسلية.
     - فهارس مركبة وعزل مستأجر صارم (`tenant_id`) وفهرس فريد لباركود الطرد (`tenant_id, package_number`).
  2. **محرك التعبئة والتفكيك والوزن القائم الصافي (package-barcode.engine.ts):**
     - محرك حسابي نقي وخالٍ من الاعتماديات الخارجية.
     - التحقق الصارم من صحة الهيكل الهرمي (منع وضع طبلية داخل كرتونة، والسماح بالكرتونة داخل الطبلية).
     - احتساب الوزن القائم التراكمي (وزن الفارغ Tare + الأوزان الصافية للأصناف + مجاميع الطرود الفرعية).
     - تفكيك وتسطيح الشجرة التراكمية (`flattenPackageContents`) لمعرفة إجمالي كل صنف داخل الطبلية حتى لو كان موزعاً على 50 كرتونة فرعية.
     - التحقق الأمني من عمليات الفك والتفريغ (حظر التفكيك للطرود المشحونة أو المستهلكة).
     - تغطية شاملة باختبارات الوحدة (`backend/test/package-barcode-engine.spec.ts`) بنجاح 100%.
  3. **خدمة الباك إند ووحدة التحكم (warehouse-packages.service.ts & warehouse-packages.controller.ts):**
     - توليد الترقيم الباركودي الموحد القياسي (`PAL-YYMMDD-XXXX` للطبليات، `BOX-YYMMDD-XXXX` للصناديق).
     - استرجاع كامل الهيكل الشجري الهرمي بمسحة قارئ الباركود (Barcode Scanner) أو المعرف.
     - فك وإفراغ الطرود بالكامل أو إزالة صناديق محددة في معاملات ذرية آمنة.
  4. **واجهة المستخدم التفاعلية (PackagesManagementPage.tsx, CreatePackageModal.tsx, PackageDetailsModal.tsx):**
     - شريط مسح باركود فوري يتيح لأمناء المخازن توجيه قارئ الباركود لفتح محتويات أي طبلية فورياً.
     - شجرة تفاعلية متداخلة لطبقات التعبئة تعرض الطرود الفرعية والأصناف المعبأة.
     - جدول إجمالي المحتويات التراكمي الذي يجمع كميات كل صنف عبر كامل الشجرة.
     - خيارات الختم (Sealing)، الفتح (Opening)، والتفكيك الكامل بنقرة واحدة مع تأكيدات أمان نظامية.
* **الملفات المتصلة:**
  - `backend/src/database/migrations/2040000000174_warehouse_packages_and_pallet_barcodes.ts`
  - `backend/src/database/database.types.ts`
  - `backend/src/modules/inventory/engines/package-barcode.engine.ts`
  - `backend/test/package-barcode-engine.spec.ts`
  - `backend/src/modules/inventory/dto/warehouse-package.dto.ts`
  - `backend/src/modules/inventory/services/warehouse-packages.service.ts`
  - `backend/src/modules/inventory/controllers/warehouse-packages.controller.ts`
  - `backend/src/modules/inventory/inventory.module.ts`
  - `frontend/src/features/inventory/api/warehouse-packages.api.ts`
  - `frontend/src/features/inventory/components/CreatePackageModal.tsx`
  - `frontend/src/features/inventory/components/PackageDetailsModal.tsx`
  - `frontend/src/features/inventory/pages/PackagesManagementPage.tsx`
  - `frontend/src/features/inventory/routes.tsx`
  - `frontend/src/app/router/access.ts`
* **التحقق البرمجي:**
  - اختبارات الوحدة للمحرك: `backend/test/package-barcode-engine.spec.ts` بنجاح 100% لكافة سيناريوهات الهرمية، والأوزان، والتجميع الشجري، وحراس التفكيك.

---


<!-- migrated:cap-215:end -->

<a id="cap-220"></a>
<!-- migrated:cap-220:start -->
## 186. محرك قواعد إعادة الطلب التلقائي وتوليد أوامر الشراء (Automated Reordering Rules & Min/Max Auto-PO Generation - Odoo 18 Standard)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية ومختبرة بنسبة 100% (30 سبتمبر 2026).
* **المسار:** `/inventory/reordering` و `/inventory` (زر وصول سريع بهيدر المخزون وقائمة التنقل الجانبية).
* **المشكلة المعالجة والمطابقة مع أودو 18:**
  - منع نفاد المخزون (Stockouts) والاعتماد على التقدير اليدوي أو مراقبة الأرفف، ومطابقة معيار أودو 18 (Odoo 18 Automated Reordering Rules) عبر حساب المخزون التقديري الافتراضي (Forecasted Virtual Stock) واحتساب البضاعة التي بالطريق وتوليد أوامر شراء مسودة مجمعة لكل مورد تلقائياً.
* **الهندسة والحلول المنفذة:**
  1. **المخزون الافتراضي التقديري (Forecasted / Virtual Stock Standard):**
     - القاعدة لا تفحص الرصيد الفعلي بالمستودع بمفرده (On-Hand) بل تحسب المعادلة المؤسسية المعتمدة:
       $$\text{Forecasted Stock} = \text{On-Hand} + \text{Incoming (Open POs)} - \text{Outgoing (Sales Reservations)}$$
     - تم ربط الكميات المحجوزة فعلياً لطلبات البيع (`reserved_qty`) من جدول أرصدة المواقع `product_location_stock` وجدول الأصناف `products`، ليتم خصمها بالمليم من رصيد الصنف المتوقع، مما يمنع الازدواج المالي ويحمي من عجز التوريد.
  2. **محرك الحسابات النقي المعزول (Pure Calculation Engine):**
     - استخراج كامل المنطق الحسابي في `reordering-rule.engine.ts` مستقلاً عن قاعدة البيانات، ويشمل:
       - `calculateForecastedStock`: حساب المخزون التقديري (الفعلي + الوارد - المحجوز).
       - `evaluateReorderingRule`: فحص خرق الحد الأدنى (`forecastedStock < min_qty`) وحساب الكمية المطلوبة للوصول إلى الحد الأقصى (`max_qty - forecastedStock`) مع تطبيق مضاعف الدفعة (Batch Multiple Rounding).
       - `groupReorderItemsBySupplier`: تجميع البنود المنتهية حسب المورد المفضل (Preferred Supplier) لدمجها في أمر شراء واحد.
  3. **تقريب مضاعف العبوات (Batch Multiple Rounding):**
     - عند تحديد مضاعف كمية (مثل عبوة كرتونة 12 أو 24 قطعة)، يقوم المحرك بتقريب الكمية المطلوبة تلقائياً للأعلى إلى أقرب مضاعف صحيح باستخدام `Math.ceil(shortage / multiple) * multiple`.
  4. **تجميع وتوليد أوامر الشراء المسودة (Supplier Consolidation & Auto-PO Generation):**
     - الخدمة `reordering-rules.service.ts` تقوم بفحص جميع القواعد المفعلة، واسترجاع الكميات المفتوحة في أوامر الشراء المعلقة وأذونات الصرف، وتجميع الأصناف التي خرقت الحد الأدنى حسب المورد المفضل.
     - توليد أمر شراء مسودة واحد مجمع (Draft PO) لكل مورد يحمل ترقيماً مستندياً موحداً بالصيغة المؤسسية `PO-YYMMDD-XXXX`.
     - تسجيل توقيت آخر فحص (`last_evaluated_at`) وحالة الخرق (`is_breached`) في جدول `reordering_rules`.
  5. **الجدولة والأتمتة الآلية في الخلفية (Background Reordering Scheduler):**
     - خدمة `ReorderingSchedulerService` تعمل بنمط `OnApplicationBootstrap` لفحص دوري أوتوماتيكي عبر كافة الشركات والمستأجرين كل 6 ساعات (مع فحص مبدئي بعد 45 ثانية من الإقلاع)، لتوليد أوامر الشراء المسودة للنواقص تلقائياً في الخلفية تماماً كمعيار أودو دون انتظار التدخل البشري.
  6. **قاعدة البيانات وهيكل الهجرة (Migration 2040000000178):**
     - إنشاء جدول `reordering_rules` مدعوماً بفهارس عزل المستأجر `tenant_id`، معرّف الصنف `product_id`، موقع التخزين `location_id`، والمورد المفضل `preferred_supplier_id`.
  7. **واجهة المستخدم التفاعلية وإدارة القواعد الكاملة (ReorderingRulesPage.tsx & CreateReorderingRuleModal.tsx):**
     - بطاقات إحصائيات سريعة (إجمالي القواعد المفعلة، الأصناف الخارقة للحد الأدنى، إجمالي أوامر الشراء المقترحة).
     - جدول استعراض القواعد بالحد الأدنى والأقصى ومضاعف العبوة مع تفصيل كامل للأرصدة (الرصيد الفعلي، الوارد بالطريق، المحجوز لطلبات البيع، والمخزون التقديري الصافي).
     - دعم كامل لعمليات الإدارة (Full CRUD): إنشاء قاعدة جديدة، تعديل قاعدة قائمة بنقرة زر، وحذف القاعدة مع حوار تأكيد رسمي `systemConfirm`.
     - زر فحص وتشغيل يدوي فوري «تشغيل فحص إعادة الطلب وتوليد أوامر الشراء» مع إشعارات نجاح فورية وأرقام أوامر الشراء الصادرة.
* **الملفات المتصلة:**
  - `backend/src/database/migrations/2040000000178_inventory_automated_reordering_rules.ts`
  - `backend/src/database/database.types.ts`
  - `backend/src/modules/inventory/engines/reordering-rule.engine.ts`
  - `backend/test/reordering-rule-engine.spec.ts`
  - `backend/src/modules/inventory/dto/reordering-rule.dto.ts`
  - `backend/src/modules/inventory/services/reordering-rules.service.ts`
  - `backend/src/modules/inventory/services/reordering-scheduler.service.ts`
  - `backend/src/modules/inventory/controllers/reordering-rules.controller.ts`
  - `backend/src/modules/inventory/inventory.module.ts`
  - `frontend/src/features/inventory/api/reordering-rules.api.ts`
  - `frontend/src/features/inventory/components/reordering/CreateReorderingRuleModal.tsx`
  - `frontend/src/features/inventory/components/reordering/ReorderingRulesPage.tsx`
  - `frontend/src/features/inventory/components/InventoryWorkspaceHeader.tsx`
  - `frontend/src/features/inventory/routes.tsx`
  - `frontend/src/app/router/access.ts`
* **التحقق البرمجي:**
  - اختبارات الوحدة للمحرك: `backend/test/reordering-rule-engine.spec.ts` بنجاح 100% لفحص الحالات الحدية، التقريب للمضاعف، وتجميع الأصناف حسب المورد، وحساب المخزون الافتراضي.


<!-- migrated:cap-220:end -->

<a id="cap-227"></a>
<!-- migrated:cap-227:start -->
## Purchases and inventory integrity (2 October 2026)

- Active supplier invoice references are protected by a tenant/supplier database unique index; supplier payments lock balances before checking availability. GRN document numbers use the inserted row ID instead of a concurrent `COUNT(*) + 1` calculation.
- Goods receipts validate tenant ownership of supplier, location, purchase order, order lines, and products. In-transit transfers require a valid destination and reject invalid or duplicate receipt quantities.
- Stock-count posting runs in resumable 64-product transactions. Each committed chunk has its own balanced variance journal. Stale pending items require an audited recount before processing can continue.


<!-- migrated:cap-227:end -->

<a id="cap-289"></a>
<!-- migrated:cap-289:start -->
## 221. منظومة عزل وتخصيص تقارير وجرد المخازن المستقلة (Strict Warehouse-Scoped Inventory Reports & Stock Counting)
* **الحالة:** مكتمل بنسبة 100% ومعتمد رقابياً ومخزنياً وميدانياً.
* **الأثر والمبرر التشغيلي:**
  منع التسريب الصامت لأرصدة وبضائع المخازن الأخرى عند اختيار مخزن محدد للطباعة أو التصدير أو الجرد الميداني. في السابق كان تصدير أو طباعة كشف الجرد أو المخزون لمخزن أو سيارة مندوب محددة يُصدّر كامل أصناف الشركة بالأرصدة الإجمالية العالمية بدلاً من رصيد ذلك المخزن فقط، كما كان معالج الجرد الشامل يدرج كميات النظام الكلية مما يتسبب في احتساب عجز وفروقات وهمية.
* **القدرات والإجراءات المطبقة:**
  1. **العزل الصارم لتقارير المخزون في مركز التقارير الشامل (`/reports/inventory`):**
     - عند تحديد مخزن معين من شريط التصفية العلوي، يتم قصر التصدير إلى Excel والطباعة A4 والإيصالات الحرارية حصرياً على الأصناف التابعة للمخزن المحدد وبرصيدها الفعلي داخل هذا المخزن فقط.
     - تزويد ملف Excel المصدّر بلاحقة اسم المخزن (`أرصدة ونواقص المخزون - [اسم المخزن].xlsx`) وعمود المخزن المخصص.
     - تضمين اسم المخزن الصريح في رأس ووثيقة التقرير المطبوع وإحصائيات الكمية والتكلفة والقيمة البيعية التقديرية.
     - تحديث محرك الباك إند `reports.service.ts` لفلترة توزيع المواقع `locationBreakdownRows` والأصناف النشطة `totalActive` وقسم المخازن الأكثر متابعة بالـ `locationId` المحدد فقط لمنع ظهور أسماء مخازن أخرى كأكبر موقع للصنف.
  2. **تصحيح تجربة الاستخدام الافتراضية لمنع الارتباك البصري (Zero Empty-State Confusion):**
     - ضبط الفلتر الافتراضي لجدول المخزون على «الكل» بدلاً من «يحتاج متابعة»، لضمان ظهور كافة بضائع المنشأة فور فتح التقرير ومنع إظهار جدول فارغ مضلل للمستخدم عند خلو المنشأة من النواقص.
     - ديناميكية عنوان ووصف بطاقة التقرير بحسب الفلتر المختار («أرصدة وتقييم المخزون» / «أصناف قاربت على النفاد» / «أصناف نافدة المخزون» / «تحليل المخزون الراكد»).
  3. **عزل معالج شيتات الجرد والتصدير الميداني (`/inventory/counts`):**
     - في شاشة بدء جلسة الجرد `StockCountComposerCard`، عند اختيار مخزن محدد يتم قصر نطاق الأصناف «جرد شامل للمخزن» حصرياً على الأصناف المسجلة في هذا المخزن من خلال `locationStocks`.
     - حساب «كمية النظام» في شيت العد المطبوع والمصدّر لـ Excel اعتماداً على رصيد المخزن المحدد `locationStock.qty` حصرياً، ومنع استخدام الرصيد الكلي للنظام.
     - تسمية ملف شيت الجرد بـ `شيت جرد - [اسم المخزن].xlsx` وتوثيق اسم المخزن في عنوان شيت العد المطبوع.
     - في وضع الإدخال الإلكتروني، يتم تعيين الكمية المتوقعة للأصناف بناءً على رصيد المخزن المحدد، لمنع احتساب فروقات وعجز وهمي عند اعتماد الجلسة.
  4. **عزل الطباعة والتصدير في مساحة عمل متابعة المخزون اليومية (`/inventory`):**
     - ربط تصدير Excel والطباعة من الهيدر الرئيسي بفلتر المخزن النشط `locationFilter` وتوثيق اسم المخزن في التقرير المطبوع واسم ملف الإكسيل.
* **الملفات المعدلة:**
  - `backend/src/modules/reports/reports.service.ts`
  - `frontend/src/features/reports/hooks/useReportsWorkspaceActions.ts`
  - `frontend/src/features/reports/hooks/useReportsWorkspaceController.ts`
  - `frontend/src/features/reports/hooks/useReportsWorkspaceState.ts`
  - `frontend/src/features/reports/components/sections/InventoryReportSection.tsx`
  - `frontend/src/features/inventory/components/sections/InventoryComposerCards.tsx`
  - `frontend/src/features/inventory/components/sections/StockCountSheetTools.tsx`
  - `frontend/src/features/inventory/components/InventoryWorkspace.tsx`
  - `frontend/src/features/inventory/hooks/useInventoryWorkspaceController.ts`
  - `frontend/src/features/inventory/hooks/useInventoryWorkspaceSectionActions.ts`
  - `frontend/src/features/inventory/lib/inventory-documents.ts`
  - `frontend/src/lib/inventory-printing.ts`

---


<!-- migrated:cap-289:end -->

<a id="cap-290-2"></a>
<!-- migrated:cap-290-2:start -->
### 115. تقسيم وتبويب أماكن المخزون الذكي وفصل سيارات التوزيع عن المستودعات الثابتة (Warehouse Locations Segmentation & Van Stock Isolation)
* **الحالة:** 🟢 مكتمل بنسبة 100%
* **الوصف والمنطق التشغيلي:**
  1. **الفصل الذكي للمستودعات:** إضافة شريط فلترة وتبويب مقطعي (`warehouse-filter-nav`) في شاشة أماكن المخزون (`/inventory/warehouses`) يتيح التبديل الفوري بين:
     - **المستودعات والفروع المركزية (الافتراضي):** يعرض حصرياً المستودعات الثابتة والمخازن الرئيسية ومعارض البيع دون إغراق الشاشة بسيارات المناديب.
     - **سيارات التوزيع والمناديب:** تبويب مستقل مخصص للمخازن المتنقلة (`van_stock`) مع إظهار أعدادها وأرصدتها اللحظية.
     - **كافة الأماكن:** عرض شامل لجميع المواقع والمستودعات الثابتة والمتنقلة.
  2. **الهوية البصرية والتعريب المؤسسي:**
     - تعريب وسم النوع من الرمز البرمجي `van_stock` إلى المسمى المؤسسي الرصين: **"سيارة توزيع (فان)"**.
     - تمييز كروت سيارات المناديب بأيقونة الشاحنة المؤسسية `TruckIcon` مع وسم بنفسجي ناعم مخصص (`badge-van-stock`) بدلاً من أيقونة المستودع الثابت.
  3. **حماية التكامل والربط الميداني:**
     - حظر حذف مستودعات سيارات المناديب من شاشة المخازن العامة عبر اعتراض الحذف وتنبيه المستخدم مؤسسياً بأن المستودع مرتبط تشغيلياً بملف المندوب وأسطول الحركة ومبيعات الفان الميدانية لحماية سلامة قيود ودفاتر المخزون.
* **الملفات المنفذة والمعدلة:**
  - `frontend/src/features/inventory/pages/WarehousesGridPage.tsx`
  - `frontend/src/styles/partials/features.css`



<!-- migrated:cap-290-2:end -->

<a id="cap-293"></a>
<!-- migrated:cap-293:start -->
## 254. أدوات التصفير السريع والجرد الصفري الذكي لجلسات جرد المخزون (Smart Zero-Count & Quick Zeroing Tools for Inventory Sessions - 23 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومطبقة ومحمية في شاشة جلسات الجرد الإلكتروني.
- **التفاصيل التشغيلية والمحاسبية:**
  1. **زر تصفير المتبقي الذكي `[تصفير المتبقي (X)]`:**
     - يتيح لأمين المخزن ولجنة الجرد عد الأصناف المتواجدة فعلياً فقط، ثم بنقرة زر واحدة وضع رصيد معدود صفري (`countedQty = 0`) لكافة الأصناف المتبقية التي لم يتم عدها بعد (`isCounted === false`)، مع الحفاظ الصارم والتام على ما تم عده وإدخاله سابقاً.
     - يعرض الزر عداداً ديناميكياً حياً بعدد الأصناف المتبقية (`تصفير المتبقي (193)`، `تصفير المتبقي (180)`، إلخ)، ويصبح معطلاً تلقائياً بمجرد اكتمال عد كافة الأصناف.
     - محمي بنافذة تأكيد تنفيذية `systemConfirm` لمنع التصفير العرضي بالخطأ، مع إشعار نجاح فوري `toast.success`.
  2. **زر التصفير الشامل `[تصفير الكل (0)]`:**
     - يتيح تصفير كافة أصناف الجلسة دفعة واحدة كـ "جرد صفري شامل"، لإثبات فراغ المخزن أو البدء من الصفر ثم مسح الأصناف المتواجدة بالباركود لزيادتها تدريجياً (+1).
     - محمي بنافذة تأكيد تفاعلية تحذر المستخدم في حال وجود أصناف معدودة مسبقاً قبل استبدالها.
  3. **حماية وترقية أزرار التحكم السريع:**
     - ترقية زري `[ملء برصيد النظام]` و `[إفراغ الخانات (أعمى)]` للتأكيد المؤسسي `systemConfirm` لحماية مدخلات المستخدم من الفقدان غير المقصود.
     - دعم كامل للتجاوب والانسياب (`flex-wrap: wrap`) لمنع تداخل أزرار الأدوات على الشاشات من 14 إلى 32 بوصة.
  4. **منع التحديد التلقائي الإجباري لجلسات الجرد (Zero Auto-Select on Sessions History):**
     - إلغاء التحديد التلقائي للجلسة الأولى (`sessions[0]`) عند الدخول لتبويب "سجل ومراجعة الجلسات"، بحيث تفتح الشاشة دائماً على جدول استعراض كافة الجلسات المسجلة وحالاتها، ولا يتم الانتقال لشاشة تدقيق ومطابقة الجلسة إلا عند النقر الصريح على الجلسة أو زر `[فحص وتدقيق الجلسة]`.
     - تنظيف معرّف الجلسة المحددة `selectedSessionId` عند النقر على `[العودة لقائمة كافة الجلسات]` أو حذف مسودة الجلسة.
- **الملفات المنفذة والمعدلة:**
  - `frontend/src/features/inventory/components/sections/InventoryComposerCards.tsx`
  - `frontend/src/features/inventory/components/sections/StockCountMonitorCard.tsx`
  - `frontend/src/features/inventory/components/InventoryWorkspace.tsx`
  - `frontend/src/features/inventory/lib/inventory-workspace.helpers.ts`
  - `frontend/src/styles/partials/stock-count-workflow-polish.css`
  - `SYSTEM_CAPABILITIES.md`
---


<!-- migrated:cap-293:end -->


### 2026-10-25 — D/F: warehouse count scope and inventory UI

- `StockCountComposerCard` formerly showed the **whole tenant catalog** when `locationStocks` was an empty array, rather than a genuinely empty warehouse. A selected warehouse now uses only its location-stock entries (including zero balances); an absent/unavailable snapshot prevents start, rather than falling back to global stock. Location map avoids O(products × stocks) filtering.
- Quick manual count in `useInventoryWorkspaceController` previously used global `product.stock` for `expectedQty`; now it uses the selected warehouse's physical balance, defaulting to 0 only if a valid location snapshot confirms no row.
- Written (not executed) `frontend/src/features/inventory/lib/count-location-scoping.spec.ts`. Remaining physical count/ledger postings and live database concurrency tests are not yet validated.


### 2026-10-25 — A/D/F: clothing stock count barcode safety

- `InventoryComposerCards.handleBarcodeScan` formerly treated `styleCode` shared by all fashion colors/sizes as an individual SKU barcode, silently counting the first variant. Now only a persisted product or unit barcode can identify the size; shared/ambiguous barcodes and model codes are rejected. Unit barcode increments by unit `multiplier` in base pieces; first scanned expected stock derives from selected location, not company aggregate. Regression `count-barcode-identity.spec.ts` written, not executed.


### 2026-10-25 — D: prevent conflicting barcode units inside one SKU

- Unit-level stock scanning previously selected the first matching barcode in one product, even if another unit on that **same** product used the same barcode but a different multiplier. The count engine now rejects this ambiguity as it already rejects duplicate SKU barcodes, so a carton barcode cannot silently count as a single piece. Two identical base-unit representations with multiplier 1 remain valid. Regression specs authored, not executed.


### 2026-10-25 — D: idempotency operation names for transfer recovery

- `useInventoryWorkspaceMutations` passed made-up operation labels `createStockTransfer`, `receiveStockTransfer`, `cancelStockTransfer` to the generic status poller, but the Nest interceptor reserves `POST:/api/stock-transfers`, `POST:/api/stock-transfers/:id/receive`, and `POST:/api/stock-transfers/:id/cancel`. Polling could not locate a reserved operation after a lost response. Production now uses `inventory-operation-types.ts` for the exact route strings. Regression authored but not executed. Distinct retry keys and the shared poller's treatment of recorded failure remain separate open work.


### 2026-10-25 — D: stable keyed creation of transfers and count sessions
- The transfer dialog formerly minted a new key per retry, and stock-count drafts were submitted with no idempotency key. The mutation layer now freezes each attempted payload and key in memory, rejects changed fields while an attempt is unresolved, queries the server operation status, and only clears an attempt on a committed response or confirmed failed/never-received request. Count create now passes the supported idempotency header. No credentials are persisted to storage. `inventory-operation-attempt.spec.ts` authored, not run. Shared `withIdempotency` polling semantics and browser reload remain Core review blockers.


### 2026-10-25 — D: bulk stock transfer receive/cancel recovery

- A multi-selected transfer action originally minted a new operation key per document each time the whole batch was retried; a timeout after the first committed receive could cause a second receive/cancel attempt with a fresh key. The hook now retains a stable, frozen keyed request per transfer/action until the batch finishes. Rerunning a batch replays committed documents with their old keys instead of creating duplicate movements, and refuses switching selected IDs/action or altering partial quantities while any operation is unresolved. Written tests for unique document/action keys and immutable receipt payloads remain unexecuted. Browser reload and real transfer transaction failures still need UAT.

## 25 October 2026 — P0-C inventory-to-ledger integration checkpoint (NOT CLOSED)

- Review uncovered unverified valuation/GL integration for maintenance parts, trade-in intake and pharmacy distributor batches (including independently committed lot rows and a swallowed treasury failure).
- Existing purchase/sale/return PostgreSQL acceptance and stock-movement code are **not** sufficient to certify the sector-specific integration.
- Three-decimal KWD/OMR minor units also require coherent inventory receipt/landed-cost and ledger precision, not isolated rounding changes.
- Detailed coverage/status and unresolved defects: [P0-C checkpoint](docs/reviews/CROSS_MODULE_ACCOUNTING_INVENTORY_P0C_20261025.md). Do not mark this module P0-C verified yet.


### P0-C 2026-10-25 — landed cost currency digits (pending final CI)

- `backend/src/modules/purchases/engines/landed-cost-allocation.engine.ts` and `landed-cost-wac.engine.ts` allocate incoming receipt costs and sold-stock COGS in base-currency minor units (2 or 3), always reconciling the original sum exactly.
- `backend/src/modules/purchases/services/purchase-landed-costs.service.ts` obtains tenant base currency, validates source money precision, and carries thousandths into stock WAC and GL. Purchase import legacy assumptions and full mixed-currency receipts remain release blockers.
