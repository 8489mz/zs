# قدرات الإعدادات والأنشطة والباقات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **الإعدادات والأنشطة والباقات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/settings/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [الهوية والأمان وعزل الشركات](PLATFORM_CAPABILITIES.md) · [إدارة المنصة والاشتراكات](SAAS_CAPABILITIES.md) · [الواجهة والتنقل والتوطين](UI_CAPABILITIES.md)

## التحديثات الحالية

<a id="settings-anti-theft-shield"></a>
### إعدادات درع منع الخسائر ومكافحة السرقة وتنبيهات الملخص اليومي (Anti-Theft Shield Settings & Daily Digest Alerts - 28 November 2026)
- **السلوك الحالي والحدود:**
  - إضافة 14 إعداداً اختيارياً تحت `antiTheft*` (`anti-theft-settings.util.ts`) بوضع افتراضي آمن (`false` للأقفال الصارمة، `20` ساعة لمهلة المناديب، `0` لسقف المندوب، `4` ساعات للبضاعة بالطريق، `200` لمسح السلة، `500` للتالف) لضمان عدم تأثر أي منشأة قائمة (`Zero-Regression`).
  - توفير لوحة الإعدادات الموحدة مع زر **«تفعيل درع منع السرقة المشدد»** بنقرة واحدة في `SalesInventoryAntiTheft` (`Settings > Sales & Inventory`) وكذلك داخل تبويب الإعدادات في غرفة عمليات منع الخسائر، مع ربط `buildAntiTheftFormValues` في `SettingsMainForm.tsx` لضمان عدم مسح الإعدادات عند إعادة التحميل.
  - توسيع الملخص التنفيذي اليومي عبر واتساب (`DailyDigestService`) ليتضمن قسماً مخصصاً لإنذارات درع منع الخسائر (ملخص مسح السلة وفتح الدرج وإعادة الطباعة، التحويلات المتأخرة بالطريق، وعهد المناديب المتأخرة).
- **مصادر التنفيذ:** `backend/src/common/utils/anti-theft-settings.util.ts`، `backend/src/modules/settings/services/daily-digest.service.ts`، `frontend/src/types/domain-models/settings.ts`، `frontend/src/features/settings/schemas/settings.schema.ts`، `frontend/src/features/settings/contracts.ts`، `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`، `frontend/src/features/settings/components/forms/tabs/sales-inventory/sales-inventory-anti-theft.tsx`.
- **المجالات المتأثرة:** [المبيعات](SALES_CAPABILITIES.md#cap-loss-prevention-pos) · [المخزون](INVENTORY_CAPABILITIES.md#cap-295) · [المشتريات](PURCHASES_CAPABILITIES.md#cap-blind-grn) · [المناديب](DELIVERY_CAPABILITIES.md#cap-delivery-custody-shield) · [الثوابت المعمارية](ARCHITECTURE_INVARIANTS.md).

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

<a id="settings-electron-barcode-and-receipt-printers"></a>
### تثبيت وحفظ اختيار الطابعات (الكاشير والباركود والمستندات A4) في الإلكترون والساس (2026-11-17)
- **السلوك الحالي والحدود:**
  - إضافة طبقة موحدة لتثبيت وتذكّر الطابعات المختارة محلياً لكل جهاز/متصفح ولكل منشأة (`frontend/src/lib/printer-preferences.ts` عبر `z_erp_workstation_printer_prefs_v1`) مع مزامنة إعدادات المنشأة في قاعدة البيانات عند توفر صلاحية الإعدادات: أولوية الاختيار المحلي للجهاز تمنع تداخل أجهزة الكاشير مع أجهزة المخزن، وتحترم مسح الطابعة صراحة (`""`) دون إرجاع قيمة قديمة من قاعدة البيانات.
  - توسيع اختيار الطابعات المباشرة ليشمل **طابعة الفواتير والمستندات A4 الاختيارية** (`posElectronDocumentPrinter` في الإلكترون، و`posWindowsDocumentPrinterName` في الساس) و**طابعة الباركود عبر الجسر في الساس** (`posWindowsBarcodePrinterName` في `BridgeDirectPrintersSection.tsx`) دون تسريب ملصقات الباركود إلى طابعة الكاشير الحرارية (`posWindowsPrinterName`) أبداً.
  - إضافة منتقي الطابعة الذكي المباشر `BarcodePrinterPicker` داخل نافذة طباعة الباركود (`BarcodePrintDialog.tsx`) لقراءة طابعات الإلكترون أو طابعات جسر Z-Systems المحلي (`HardwareBridgeClient.listPrinters`) وحفظ الاختيار تلقائياً فور التغيير دون العودة للشاشات الجانبية أو تكرار الاختيار عند كل عملية طباعة؛ مع تحديث `tools/z-systems-bridge/Program.cs` لقراءة `pageSizeMm` عند حساب عرض الإطار للطباعة عبر الجسر.
  - القيد المعروف للمتصفح العادي (SaaS بدون تشغيل جسر Z-Systems المحلي وبدون الإلكترون): قيود أمان المتصفح تفرض فتح نافذة طباعة المتصفح وتعتمد على ذاكرة المتصفح لآخر طابعة مستخدمة؛ الحفظ التلقائي والطباعة الصامتة لطابعة محددة يعملان بالكامل في تطبيق Electron وفي الساس عند تشغيل جسر Z-Systems المحلي.
- **مصدر التنفيذ:**
  - `frontend/src/lib/printer-preferences.ts`، `frontend/src/lib/browser.ts`، `frontend/src/lib/pos-printing/open-receipt.ts`، `frontend/src/lib/barcode-labels.ts`، `frontend/src/lib/barcode.ts`، `frontend/electron/main.cjs`، `tools/z-systems-bridge/Program.cs`
  - `frontend/src/features/products/components/BarcodePrinterPicker.tsx`، `frontend/src/features/products/components/BarcodePrintDialog.tsx`
  - `frontend/src/features/settings/components/forms/tabs/ElectronDirectPrintersSection.tsx`، `frontend/src/features/settings/components/forms/tabs/BridgeDirectPrintersSection.tsx`، `frontend/src/features/settings/components/forms/tabs/PrintingSettingsTab.tsx`، `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`، `frontend/src/features/settings/hooks/useSettingsMutations.ts`، `frontend/src/features/settings/contracts.ts`، `frontend/src/features/settings/schemas/settings.schema.ts`، `frontend/src/types/domain-models/system.ts`
- **المجالات المتأثرة:** [المبيعات ونقاط البيع](SALES_CAPABILITIES.md) · [الأصناف والوحدات والمتغيرات](CATALOG_CAPABILITIES.md) · [الثوابت المعمارية](ARCHITECTURE_INVARIANTS.md) (`INV-ELECTRON-BARCODE-AND-RECEIPT-PRINTERS`)
- **التحقق:**
  - اجتياز 6 حزم اختبارات Vitest موجهة (44/44 اختباراً): `printer-preferences.spec.ts` (5/5)، `PrintingSettingsTab.spec.tsx` (7/7)، `electron-printing.spec.ts` (7/7)، `browser-print-bridge.spec.ts` (5/5)، `barcode-labels.test.ts` (16/16)، `product-barcode-print.helpers.spec.ts` (4/4). لم يُشغّل `npm run build` أو `typecheck` أو الحراس الشاملة التزاماً بسياسة المستودع.
- **آخر تحقق:** 2026-11-17.

<a id="settings-settlement-allocations-wipe-order"></a>
### ترتيب حذف `settlement_allocations` قبل `sales` و`customer_payments` عند المسح وإعادة التعيين (2026-11-17)
- **السلوك الحالي والحدود:**
  - يحمل جدول `settlement_allocations` (الهجرة 0331) القيد `settlement_allocations_one_source_chk` الذي يشترط إسناد الصف إلى مصدر واحد فقط (`sale_id` أو `customer_payment_id`) مع `ON DELETE SET NULL` لكلٍّ منهما؛ لذا فإن أي حذف لصفوف `sales` أو `customer_payments` قبل حذف `settlement_allocations` يصفّر المصدر الوحيد إلى `NULL` ويُبطل المعاملة بـ SQLSTATE `23514`.
  - تم ضمان حذف `settlement_allocations` (و`van_rep_financial_settlements` في مسارات التصفير الكلي) قبل `sales` و`customer_payments` و`van_sales_trips` في كافة مسارات الحذف المشتركة: `executeWipeTables`، `SettingsDemoDataService` (`resetStockBalances`، `wipeCatalogAndStock`، `clearDemoData`) عبر مساعد مشترك `clearVanSettlementRows`، و`SaasAdminService.deleteTenant` (بترتيب الجدول في أول قائمة الحذف دون الاعتماد على إعادة محاولة `23503`)، و`repair-platform-tenant-zs.js`، وجميع تنظيفات اختبارات E2E للفان (`van-sales-field-flow.e2e.ts` ورفاقها).
- **حالة التنفيذ:** منفّذ ومغطى باختبارات الوحدة الحرجة على PGlite فعلي، وبانتظار إثبات E2E في CI-full.
- **مصدر التنفيذ:**
  - `backend/src/modules/settings/services/settings-demo-data-wipe-tables.ts`
  - `backend/src/modules/settings/services/settings-demo-data.service.ts`
  - `backend/src/modules/saas-admin/saas-admin.service.ts`
  - `backend/scripts/repair-platform-tenant-zs.js`
  - `backend/test/e2e/van-sales-field-flow.e2e.ts` (و`van-distribution-comprehensive.e2e.ts`، `van-sales-rogue-rep-and-multi-rep.e2e.ts`، `fleet-vehicle-reassignment.e2e.ts`، `van-field-returns.e2e.ts`، `van-sales-distribution-master-simulation.ts`)
- **المجالات المتأثرة:** [التوزيع الميداني والفان](VANS_CAPABILITIES.md) · [إدارة المنصة والاشتراكات](SAAS_CAPABILITIES.md) · [الثوابت المعمارية](ARCHITECTURE_INVARIANTS.md) (`INV-SETTLEMENT-ALLOCATIONS-DELETE-ORDER`)
- **التحقق:**
  - `settlement-allocations-delete-order.spec.ts` (RED-proven قبل الإصلاح -> GREEN بعده على PGlite فعلي)، `tenant-wipe-fk-closure.spec.ts`، `architecture-guard.spec.ts`، و`tsc --noEmit`.
- **آخر تحقق:** 2026-11-17 (على الأساس `ffd9828c7` داخل worktree الإصلاح).
- **النواقص أو التعارضات:** التحقق من `van-sales-field-flow.e2e.ts` ضد PostgreSQL الحي يتم عبر GitHub Actions `ci-full`.

<a id="settings-apps-store-plan-compatibility"></a>
### توحيد توافق الباقات وحصر إدارة تطبيقات المتجر والموديولات في منصة الساس (2026-11-17)
- **السلوك الحالي والحدود:**
  - **حصر تفعيل وإيقاف كافة التطبيقات والموديولات في الساس (`INV-SAAS-ONLY-MODULE-CONTROL`):** قُفل التثبيت والإلغاء الذاتي عبر `PUT /api/settings` لجميع الموديولات الـ26 (`PROTECTED_MODULE_KEYS` في `settings-module-entitlement.engine.ts` شاملة الفان والمناديب والميزان والأقسام والمحاسبة المتقدمة) عن حسابات العملاء العاديين (`admin` / `cashier`)، مع بقاء الإعدادات التشغيلية اليومية (مثل بادئة الفاتورة وصيغة باركود الميزان والضرائب والطباعة) قابلة للتعديل من العميل.
  - **صلاحية منصة الساس وجلسات التصفح كمالك (`Impersonation`):** تنقل `SessionService` العلم `isPlatformImpersonation: Boolean(auth.impersonatedBy)` الموثق من جدول `sessions`؛ فتفتح الدالة المشتركة `canManagePlatformModules(user)` أزرار `تثبيت وتفعيل` و`إلغاء التثبيت` في `AppsStorePage` واختيارات `ModulesSettingsTab` للمشغّل المنصي عند التصفح كمالك أو السوبر أدمن المباشر دون منح صلاحية `/saas-admin` أو المساس بعزل `isPlatformAdmin`. أما العميل العادي فيرى `/apps` للعرض وطلب التفعيل فقط (`مُتاح عبر الإدارة` / `طلب التفعيل من الإدارة` للباقة المشمولة، أو `طلب التفعيل والترقية` للباقات الأعلى) ويرى بطاقة نمط التشغيل في `ModulesSettingsTab` للقراءة فقط.
  - **اعتماد مناديب التوصيل كنواة تجزئة شاملة (`INV-DELIVERY-REPS-RETAIL-SELF-INSTALL`):** تظل `'deliveryReps'` ضمن `defaultFeatures` لجميع أنشطة التجزئة الـ11 مع تهيئة `deliveryRepsModuleEnabled: true` افتراضياً للتجزئة الجديدة وإبقاء الفان (`vanSalesModuleEnabled`) محصوراً بالتوزيع/الجملة أو التفعيل الصريح من الساس.
  - توحيد قراءة رتب وأسماء وميزات الباقات القديمة (`plan_basic`..`plan_omnichannel`) وباقات النطاقات الـ15 (`tier_band1_L1`..`tier_band5_L3` / `BAND1_L1`..`BAND5_L3`) عبر `plan-tier.util.ts` و`plan-tiers.ts`، ومنع تحوّل أنشطة `services` و`wholesale_van` تلقائياً إلى `posModuleEnabled = true`، وربط `TradeInController` بميزة `'maintenance'`.
- **حالة التنفيذ:** منفذ ومُتحقّق على اختبارات الباك إند الحرجة (PGlite) واختبارات الواجهة (Vitest) وفحص حجم الملفات وطبقات الاستيراد.
- **مصدر التنفيذ:**
  - الخادم: `backend/src/core/tenant/industry-profiles.ts`، `backend/src/core/tenant/plan-tier.util.ts`، `backend/src/modules/settings/settings-module-entitlement.engine.ts`، `backend/src/modules/settings/settings.service.ts`، `backend/src/modules/saas-admin/saas-admin.service.ts`، `backend/src/modules/saas-admin/trial-tenant-provisioning.service.ts`، `backend/src/core/auth/services/plan-feature.service.ts`، `backend/src/core/auth/services/session.service.ts`، `backend/src/modules/users/engines/user-plan-limit.engine.ts`، `backend/src/modules/tradein/tradein.controller.ts`
  - الواجهة: `frontend/src/types/auth.ts`، `frontend/src/shared/system/runtime-environment.ts`، `frontend/src/shared/verticals/plan-tiers.ts`، `frontend/src/features/apps-store/pages/AppsStorePage.tsx`، `frontend/src/features/apps-store/components/AppCard.tsx`، `frontend/src/features/apps-store/components/AppUpgradeModal.tsx`، `frontend/src/features/apps-store/components/AppsKpiHeader.tsx`، `frontend/src/features/apps-store/data/apps-catalog.tsx`، `frontend/src/shared/layout/app-shell.tsx`، `frontend/src/features/delivery-reps/routes.tsx`، `frontend/src/shared/components/feature-gate.tsx`، `frontend/src/app/router/access.ts`، `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`، `frontend/src/features/settings/components/UserManagementSection.tsx`، `frontend/src/shared/system/DeveloperActivationPanel.tsx`
- **المجالات المتأثرة:** [إدارة المنصة والاشتراكات](SAAS_CAPABILITIES.md#saas-plan-tiers-checkout-alignment) · [التوصيل وأجور المناديب](DELIVERY_CAPABILITIES.md) · [الثوابت المعمارية](ARCHITECTURE_INVARIANTS.md) (`INV-SAAS-ONLY-MODULE-CONTROL`, `INV-APPS-STORE-PLAN-TIER-COMPATIBILITY`)
- **التحقق:**
  - الباك إند (`ts-node`): `apps-store-plan-compatibility.spec.ts`، `pos-weighted-barcode-toggle-persists.spec.ts`، `pos-plan-sync-module-durability.spec.ts`، `delivery-reps-retail-self-install.spec.ts`، `van-general-feature-overrides.spec.ts`، `user-plan-limit.spec.ts`، `subscription-read-only.spec.ts`، `storefront-order-entitlement.spec.ts`.
  - الواجهة (`vitest`): 8 ملفات (58 اختباراً): `AppCard.spec.tsx`، `AppsStorePage.spec.tsx`، `AppsStorePage.feedback.spec.tsx`، `AppsStorePage.tiers.spec.tsx`، `SalesInventorySettingsTab.weighted-barcode.spec.tsx`، `access.spec.ts`، `useSettingsMutations.spec.tsx`، `app-shell.spec.tsx`، مع اجتياز `file-size-guard.cjs` و`import-layer-check.mjs` و`page-composition-check.mjs`.
- **آخر تحقق:** 2026-11-17 (على التعديلات الحالية بعد `5488e207f` / `ffd9828c7`).
- **النواقص أو التعارضات:** لم يُشغّل `npm run build` ولا `tsc --noEmit` الكامل محلياً التزاماً بسياسة المستودع.

### 258. حوكمة استيراد الأصناف وتصدير القالب ديناميكياً وعزل تكرار المخازن (Smart Dynamic Location Template & Anti-Duplication Import Engine — 27 أكتوبر 2026)
- **المشكلة المعالجة:** كان قالب المنتجات ورصيد أول المدة ينزل بمسمى ثابت «المخزن الرئيسي»، وعندما يقوم المشترك الجديد برفعه يبحث الباك إند عن «المخزن الرئيسي» فلا يجده (لأن مخزن الفرع التلقائي اسمه «رصيد الفرع الرئيسي») فينشئ مخزناً ثانياً مكرراً يشتت رصيد الكاشير ونقطة البيع.
- **التصدير الديناميكي للقالب (Dynamic Template Export):**
  - تم تحويل تصدير قوالب الإكسيل (`products-template.xlsx` و `opening-stock-template.xlsx`) في `settings-page.helpers.tsx` ليقرأ اسم المخزن الافتراضي الفعلي للعميل (`resolveTenantPrimaryLocationName`)، فينزل القالب مطابقاً للمنشأة (مثل «رصيد الفرع الرئيسي»).
- **محرك الاستيراد الذكي ومنع التكرار (Resilient Import Engine):**
  - في `SettingsImportService.ensureLocation`:
    1. في حال ترك خانة المخزن فارغة، تنزل البضاعة تلقائياً في المخزن/الرصيد الافتراضي للمنشأة.
    2. في حال وجود مخزن وحيد للمنشأة، أي اسم يُكتب أو مرادفات عامة («المخزن الرئيسي»، «الرئيسي»، «مخزن الفرع»، «رصيد الفرع») تُوجّه تلقائياً إلى المخزن القائم دون إنشاء مخزن مكرر بصمت.
    3. إضافة كاش محلي `locationsCache` لتسريع معالجة الأسطر (0ms) ومنع الاستعلام المتكرر في الحلقات.
- **هجرة الدمج التلقائي (Migration 258):**
  - تم إنشاء الهجرة `2040000000258_consolidate_duplicate_default_stock_locations.ts` لدمج أي مخازن مكررة سابقة («المخزن الرئيسي») داخل «رصيد الفرع الرئيسي» وإعادة توجيه كافة الحركات والأرصدة مع التحقق الصارم من الحفاظ على كميات المخزون الإجمالية (Zero Stock Discrepancy Invariant).
- **مراجع التنفيذ:**
  - `backend/src/modules/settings/services/settings-import.service.ts`
  - `backend/src/database/migrations/2040000000258_consolidate_duplicate_default_stock_locations.ts`
  - `frontend/src/features/settings/pages/settings-page.helpers.tsx`
  - `backend/test/infra/settings-import.service.spec.ts`
- **أدلة التحقق:** نجاح اختبار `backend/test/infra/settings-import.service.spec.ts` بالكامل بتاريخ 27 أكتوبر 2026.

## فهرس الأقسام المنقولة

- [قدرة: دستور الفصل والعزل التام بين الأنماط المؤسسية (Universal Vertical Isolation) — ✅ مفعّلة ومحروسة (أكتوبر 2026)](#cap-016)
- [قدرة: العزل القطاعي الشامل لكافة صفحات وتبويبات وأقسام الإعدادات (Settings Universal Vertical Isolation) — ✅ مفعّلة ومحروسة (أكتوبر 2026)](#cap-018)
- [18. نظام باقات الاشتراك وفلترة القائمة الجانبية المعيارية (Modular Subscription Plans & Sidebar Dynamic Gating)](#cap-044)
- [26. معالج استيراد البيانات التجريبية السريعة حسب النشاط (One-Click Demo Data Wizard)](#cap-052)
- [44. معالج استيراد وتصفير البيانات التجريبية حسب النشاط (Demo Data Wizard & Clean Reset)](#cap-069)
- [50. معالج التخصيص الذكي للموديولات والأنشطة التجارية (Smart Modular Configurator & Industry Presets)](#cap-075)
- [51. الهيكلية النمطية الشاملة وتحويل النواة الكلاسيكية لموديولات اختيارية (Full Modular Core: Purchases, Advanced Inventory & HR)](#cap-076)
- [52. أتمتة تهيئة الموديولات عند التسطيب الأول في الإلكترون وصفحة الترحيب والتخصيص المستقلة في الساس (Desktop First-Run Setup & SaaS Full-Page Onboarding Hub)](#cap-077)
- [56. إعادة هيكلة وتوحيد شاشات وتبويبات الإعدادات وهرمية التنقل المؤسسية (Settings Architecture & Enterprise Navigation Overhaul)](#cap-081)
- [78. محرك التخصيص والعزل الرأسي للأنشطة والقطاعات (Industry Vertical Isolation Engine)](#cap-109)
- [79. معمارية المسارات والصفحات المستقلة لموديولات المقاولات والشحن البحري (Modular Sub-Route Architecture)](#cap-110)
- [92. العزل القطاعي الشامل والتهيئة الذكية للمودات الـ 16 (Total Vertical Isolation & 16-Mode Industry Automation)](#cap-127)
- [112. معمارية العزل القطاعي الصارم، الأجنحة المتكاملة، وحصر التخصيص في التهيئة الأولى (All-Inclusive Pillars & Onboarding-Only Selection)](#cap-147)
- [113. متجر التطبيقات والموديولات المؤسسي المستقل (Enterprise Apps Store & Modular Grid Ecosystem)](#cap-148)
- [114. التفعيل التلقائي الشامل ومزامنة خانات الاختيار للأجنحة التخصصية (All-Inclusive Suites Checkbox & State Synchronization)](#cap-149)
- [115. العزل والتوجيه الذكي للموديولات ومتجر التطبيقات بحسب النشاط المؤسسي (Context-Scoped Modules & Apps Isolation)](#cap-150)
- [114. التفعيل التلقائي الشامل ومزامنة خانات الاختيار للأجنحة التخصصية (All-Inclusive Suites Checkbox & State Synchronization)](#cap-152)
- [115. العزل والتوجيه الذكي للموديولات ومتجر التطبيقات بحسب النشاط المؤسسي (Context-Scoped Modules & Apps Isolation)](#cap-153)
- [132. إصلاح وحوكمة تفعيل موديولات متجر التطبيقات ومطابقة مخطط الإعدادات العامة (Apps Store Module Activation & Settings Validation Schema Alignment)](#cap-157)
- [133. حوكمة وتدقيق الأنماط القطاعية الأربعة والربط الموديولي الصارم (4 Industry Pillars Governance & Leak-Proof Module Alignment 100%)](#cap-158)
- [138. نقل بطاقة نمط المنظومة إلى تبويب تخصيص الموديولات والأنشطة (Relocating Industry Mode Selector to Modules Settings Tab)](#cap-163)
- [139. إزالة شريط القوالب القديم المكرر وتوحيد إدارة الأنماط والموديولات (Eliminating Duplicate QuickBar & Consolidating Modular Controls)](#cap-164)
- [141. إدارة تهيئة المخزون وتصفير البيانات للبدء الفعلي (Operational Inventory Reset & Catalog Wipe Engine)](#cap-169)
- [144. منظومة العزل والتخصيص الديناميكي لشاشات الإعدادات طبقاً لمود النشاط (Mode-Based Dynamic Settings Isolation & Vertical Configuration Suite)](#cap-170)
- [141. إدارة تهيئة المخزون وتصفير البيانات للبدء الفعلي (Operational Inventory Reset & Catalog Wipe Engine)](#cap-173)
- [164. معيار عزل نمط المحلات المبسط عن نمط المؤسسات المتقدم (Commercial Scope & Operation Mode Standard)](#cap-195)
- [190. دستور عزل الأنماط المؤسسية والباقات التابعة والتطابق متعدد القنوات (Universal Omnichannel Vertical Isolation, Dependent Plans Constitution & Real Functional Wiring)](#cap-225)
- [167. العزل والتخصيص القطاعي الشامل لتبويبات وشاشات الإعدادات (Vertical-Scoped Enterprise Settings Isolation & Specialization Suite - 8 October 2026)](#cap-244)
- [204. دستور عزل الإعدادات حسب النشاط (Vertical Isolation) وضغط نافذة المستخدمين بدون سكرول (Universal Zero-Scroll User Modal)](#cap-245)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-016"></a>
<!-- migrated:cap-016:start -->
### قدرة: دستور الفصل والعزل التام بين الأنماط المؤسسية (Universal Vertical Isolation) — ✅ مفعّلة ومحروسة (أكتوبر 2026)
- **المصدر الموحد للحقيقة:** محرك مركزي موحد `frontend/src/shared/verticals/vertical-scope.ts` يستنتج نمط عمل المنشأة بدقة (`maritime`, `contracting`, `wholesale_van`, `manufacturing`, `retail_general`, إلخ).
- **التطابق الشامل (Omnichannel Parity):** عزل تام للموديولات بين سطح المكتب والموبايل. منشأة الشحن واللوجستيات لا يظهر فيها أي أثر لكاشير نقطة البيع أو جرد التجزئة أو المقاولات أو المطاعم؛ ومنشأة التجزئة تظهر نقطة البيع فوراً وتختفي موديولات الشحن والمقاولات.
- **إصلاح أولوية استنتاج النمط ومنع حجب نقطة البيع لعملاء التجزئة ذوي الباقات المتقدمة:** القضاء التام على حجب نقطة البيع (`pos`) عند تفعيل باقة الأومني تشانل أو الميزات المتقدمة (`isEnterpriseCommerceActive`) وتثبيت ظهور نقطة البيع في شريط المبيعات والشريط الرئيسي، واعتماد الأولوية المطلقة للنمط المختار (`tenant.activityType` / `settings.businessIndustry`)، مع تطهير باقة الأومني من موديولات الشحن والمقاولات وفرض عزل الموديولات المانعة في الباك إند (`syncTenantModuleSettingsForPlan`)، وربط التعديلات بـ `account_id` الحقيقي للمستخدم.
- **تحديث وضبط نوافذ التخصيص وإجراءات المشتركين (`UpdateTenantPlanModal` & `TenantActionHubModal`):**
  1. منع الفتح التلقائي للقوائم المنسدلة عند فتح النوافذ المنبثقة عبر ضبط `openOnFocus: false` في `CustomSelect`.
  2. توسيع نافذة تخصيص نمط وباقة المشترك إلى `min(1060px, 96vw)` وترتيب النمط والباقة في صف ثنائي متوازن وشبكة رباعية الأعمدة للميزات دون أي سكرول داخلي (Zero Scrollbars) لظهور كافة الميزات وأزرار الحفظ في مشهد واحد.
  3. توسيع مركز إجراءات المشترك (`TenantActionHubModal`) إلى `min(880px, 95vw)` مع شبكة ثنائية فسيحة واستبدال أيقونة الصاعقة المحظورة بأيقونة ترقية مؤسسية متزنة.
- **تخصيص الموبايل اللحظي:** شريط التنقل السفلي في الموبايل (`MobileBottomNav.tsx`) ونافذة الإجراءات السريعة (`MobileQuickActionSheet.tsx`) تتكيف فورياً لعرض الأدوات الميدانية الخاصة بالنشاط (مثل تتبع الحاويات وأوامر تشغيل الشحنات واستفسارات الشحن للشحن؛ والمشاريع والمستخلصات ويوميات الموقع للمقاولات؛ وأذونات تحميل سيارات الفان لتوزيع الجملة).
- **حماية المسارات والبحث:** البحث الشامل (`GlobalSearchModal.tsx`) وحارس المسارات المباشرة (`hasRequiredFeature` في `access.ts`) يحجبان أي موديول غير مخصص لنمط المنشأة حتى عند كتابة الرابط يدوياً في المتصفح.


<!-- migrated:cap-016:end -->

<a id="cap-018"></a>
<!-- migrated:cap-018:start -->
### قدرة: العزل القطاعي الشامل لكافة صفحات وتبويبات وأقسام الإعدادات (Settings Universal Vertical Isolation) — ✅ مفعّلة ومحروسة (أكتوبر 2026)
- **العزل التام لتبويبات الإعدادات (`SettingsSectionTabs`):**
  - عند اختيار نمط الشحن والتوكيلات الملاحية (`maritime`) أو المقاولات (`contracting`): يتم حجب أقسام التجزئة والتجارة الإلكترونية تلقائياً (`storefront`, `marketplaces`, `locations`, `demo-data`) من شريط التبويبات العلوي، ويتم تحويل مسار المستخدم تلقائياً (`<Navigate to="/settings/core" replace />`) إذا حاول كتابة الرابط يدوياً في المتصفح.
- **التكييف الكامل لتبويب الفروع وأماكن التخزين (`SettingsReferenceSection` & `cards.tsx` & `row-actions.tsx`):**
  - في الشحن الملاحي: يتحول التبويب إلى **«المقرات الملاحية والموانئ ومحطات الحاويات»**؛ وتتحول الفروع إلى «المقرات والمكاتب الملاحية»، والمخازن إلى «الموانئ ومحطات ومستودعات الحاويات (UN/LOCODE)».
  - في المقاولات: يتحول التبويب إلى **«المقرات الإدارية ومواقع العمل والتشوين»** والمخازن إلى «مخازن التشوين الميدانية».
  - حجب خيارات نقاط البيع ومخزون البيع بالتجزئة (`مخزن البيع الأساسي`، `مصدر مخزون البيع`، `السماح بالبيع من المخازن الخارجية`) بالكامل عند تعديل المقر الملاحي أو موقع العمل في الأنماط غير التجزئية (`isNonPos`).
  - تكييف نوافذ التعديل والإضافة السريعة ومودالات تأكيد الحذف بمسميات قطاعية دقيقة (حذف المقر الملاحي / حذف الميناء / حذف موقع التشوين).
- **التكييف القطاعي لتبويب المستخدمين والصلاحيات (`UserManagementSection` & `UserManagementEditorCard` & `UserManagementPermissionGroups`):**
  - حظر صلاحيات التجزئة والكاشير ونقاط البيع (`cashDrawer`, `canDiscount`, `canSellWholesale`, `canAdjustInventory`, `pricingCenterManage`, إلخ) عن قطاعي الشحن والمقاولات؛ وتضمين الصلاحيات التشغيلية التخصصية الحصرية (بوالص الشحن، تتبع الحاويات، استفسارات الشحن، عروض أسعار النولون، مقارنة الخطوط RFQ للشحن؛ والمشاريع والمستخلصات والمقايسات ويوميات الموقع وأوامر التغيير للمقاولات).
  - **قاعدة التعيين التلقائي للفرع الواحد (Single Branch Auto-Selection):** عند وجود فرع أو مقر ملاحي واحد فقط بالمنشأة، يمسكه النظام ويعلم عليه تلقائياً للمستخدم الجديد (`newDraft.branchIds = [branches[0].id]`)، وعند وجود أكثر من فرع يترك التحديد فارغاً ويفرض اختيار فرع واحد على الأقل مع رسالة توجيهية مانعة للحفظ بدون اختيار فرع (`يجب اختيار مقر أو مكتب ملاحي واحد على الأقل`).
  - تكييف الأدوار الوظيفية والقوالب السريعة ومسميات الإحصائيات (مسؤول عمليات وتتبع للشحن، مهندس موقع للمقاولات).
  - تطبيق دستور الحظر التام للتمرير الخارجي (`Zero Scroll`) وتوسيع نافذة تعديل المستخدم إلى `min(1280px, 97vw)` مع شبكة متوازنة ثلاثية الأعمدة لمجموعات الصلاحيات وبطاقة سوبر أدمن مدمجة وتمرير داخلي انسيابي.
- **التكييف القطاعي لتبويبات النسخ الاحتياطي والاستيراد والمراسلات:**
  - في تبويب النسخ الاحتياطي (`SettingsBackupImportSection`): إخفاء كارت تصفير المخزون وكارت استيراد بضائع المخزن في الشحن، وتحويل الاستيراد إلى «استيراد دليل الخدمات ورسوم الشحن والنولون»، و«استيراد الشاحنين والمستلمين (Shippers & Consignees)»، و«استيراد الخطوط الملاحية والوكلاء والموانئ».
  - في بوابة الواتساب والملخص اليومي (`SettingsWhatsAppGatewaySection` & `SettingsDailyDigestSection`): تكييف رسائل الفواتير والتقارير الذكية لعكس بوالص الشحن والحاويات TEU والإنذارات الملاحية ومصاريف الأرضيات (Demurrage) أو المستخلصات ونسب الإنجاز في المقاولات.
- **تطهير كامل من الـ Native Alert / Confirm:** استبدال دوال `confirm(...)` بـ `await systemConfirm(...)` المعتمدة مؤسسياً في قسم أوضاع الشبكة المحلية (`SettingsLanModesSection`).


<!-- migrated:cap-018:end -->

<a id="cap-044"></a>
<!-- migrated:cap-044:start -->
## 18. نظام باقات الاشتراك وفلترة القائمة الجانبية المعيارية (Modular Subscription Plans & Sidebar Dynamic Gating)

> **الأسعار والتحزيم ليست هنا.** المرجع الوحيد للحقيقة في الأسعار والباقات والمنتجات
> القطاعية هو **[`PRICING_AND_PACKAGING.md`](./PRICING_AND_PACKAGING.md)**.
> التسعير القديم (الباقات الأربعة 3,500 / 7,500 / 15,000 / 24,000 ج.م) **مُبطَل بالكامل**
> وحُذف من هذا الملف؛ وما بقي في الهجرة 135 تاريخٌ لا يُستند إليه (البند C6 هناك).
> المبدأ الحاكم: **النشاط القطاعي هو هوية المنتج لا إضافة فوقه** (PRICE-P1..P3)،
> والمقاولات والشحن منتجان مستقلان لا حزمتان فوق باقة.
> **تحديث 25 سبتمبر 2026 (C1):** الباقات الأربعة القديمة (Basic/Pro/Ultimate/Omnichannel) لم تعد
> الحاجز الفعلي لمعظم القطاعات التجارية — `industry-profiles.ts` أصبحت تمنح فقط علم هوية القطاع
> وأساسيات نقطة البيع دائماً، والباقي (مخزون/مشتريات/تقارير/محاسبة/موارد بشرية/ضرائب) يأتي من
> 12 باقة جديدة مبنية على النطاق والمستوى (`tier_band{1-4}_L{1-3}`, هجرة `2040000000149`)، مطابقة
> لـ `pricing/pricing-catalog.json`. التجربة المجانية (`plan_ultimate`) غير متأثرة وتبقى كاملة
> المميزات. المقاولات والشحن (نطاق 5) ما زالا معزولين بالكامل بقرار صاحب المنتج، لم يُمسا.
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/database/migrations/2040000000035_align_plans_matrix_and_modular_tiers.ts`, `backend/src/modules/saas-admin`, `backend/src/core/auth/services/session.service.ts`, `frontend/src/shared/system/DeveloperActivationPanel.tsx`, `frontend/src/features/saas-admin/components/UpdateTenantPlanModal.tsx`, `frontend/src/shared/layout/app-shell.tsx`, `frontend/src/app/router/access.ts`
* **الجداول في قاعدة البيانات:** `plans`, `plan_features`, `saas_plans`, `tenants` (`plan_id`, `extra_features`)

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **هيكلة الباقات الأربعة المعيارية** | 🟢 | 100% | `2040000000035_align_plans_matrix_and_modular_tiers.ts`, `DeveloperActivationPanel.tsx` | توزيع دقيق لـ 22 ميزة على 4 باقات: 1) **الأساسية (4 ميزات):** POS، الوردية، الخزينة، الأصناف. 2) **الاحترافية (7 ميزات):** الأساسية + المشتريات والموردين + المخزون المتقدم + التقارير. 3) **المتكاملة (21 ميزة):** تشمل كافة ميزات الـ ERP المتقدمة عدا المتجر الإلكتروني. 4) **التجارة الشاملة (22 ميزة):** كافة الميزات بالكامل مع المتجر وبوابات الدفع. |
| **لوحة ترخيص المطورين الفورية (Developer Activation Console)** | 🟢 | 100% | `DeveloperActivationPanel.tsx`, `saas-admin.service.ts` | لوحة تحكم فورية (تفتح بـ Ctrl+Alt+Shift+L للـ Super Admin) تتيح تفعيل الباقات بضغطة زر مع تصفير التعديلات وتطبيق مصفوفة الميزات فورياً دون انتظار الشبكة، مع مفاتيح تبديل (iOS Style Toggles) لاستثناء أو إضافة ميزات حية. |
| **إدارة باقات النسخ بالسوبر أدمن (SaaS Admin Modal)** | 🟢 | 100% | `UpdateTenantPlanModal.tsx`, `saas-admin.service.ts` | نافذة منبثقة محدثة تتيح اختيار الباقة بدقة لجميع المشتركين وإضافة أو استثناء أي ميزة مع حفظ التعديلات في جدول `tenants`. |
| **الفلترة الذكية والإخفاء التلقائي للقائمة الجانبية (Sidebar Dynamic Gating)** | 🟢 | 100% | `app-shell.tsx`, `access.ts` | إخفاء تلقائي فوري لأي بند أو موديول غير مفعل في الباقة (مثل إخفاء المشتريات بالكامل في الأساسية، إخفاء المخزون المتقدم، إخفاء التقارير وسجل النشاط، تحويل مسمى المالية إلى "الخزينة والمصروفات"، وحصر المتجر بطلباته في باقة التجارة الشاملة). |
| **حماية الروابط البرمجية بالفرونت إند (Route-Level Feature Gating)** | 🟢 | 100% | `access.ts`, `root-router.tsx` | منع الوصول المباشر عبر شريط العنوان (URL) لأي شاشة تابعة لموديول غير مفعل في باقة المستأجر وتوجيهه فورياً لصفحة عدم المصرح أو الرئيسية. |
| **وصول مسؤول المنصة الكامل غير المقيد (Platform Admin Unrestricted Access)** | 🟢 | 100% | `app-shell.tsx`, `access.ts` | إعفاء حساب مسؤول المنصة المركزي (`isPlatformAdmin`) تلقائياً من أي حجب يخص باقة المنشأة، وعرض كامل موديولات النظام الـ 22 في القائمة الجانبية بنسبة 100%، وتخصيص مجموعة سريعة لإدارة المنصة والساس (`saas-group`) حصرياً لمسؤولي المنصة على نسخة `default`. |
| **عزل صلاحيات السوبر أدمن ومنع تسريب إدارة المشتركين للمستأجرين (Multi-Layer Platform Admin Isolation)** | 🟢 | 100% | `access.ts`, `super-admin-role.guard.ts`, `session.service.ts`, `saas-admin.controller.ts`, `saas-admin.service.ts`, `trial-tenant-provisioning.service.ts`, `activation.service.ts`, `users.service.ts` | **منظومة دفاعية سباعية الطبقات (7-Layer Defense-in-Depth) تضمن استحالة تسريب صلاحيات السوبر أدمن للشركات المستضافة:** <br>1. **طبقة الجارد وحماية المسارات المركزية (`SuperAdminRoleGuard`):** تشترط فحصاً مزدوجاً غير قابل للتجاوز (`role === 'super_admin'` + مطابقة `tenantId` لمنصة الإدارة المركزية `default`/`dev-tenant`). تم قفل كامل كونترولر الساس المركزي `SaasAdminController` بهذا الجارد. <br>2. **طبقة جلسة المستخدم (`SessionService` Coercion):** عند تسجيل الدخول أو استرجاع الجلسة أو استعلام الملف الشخصي (`buildMePayload`)، إذا كان المستخدم مسجلاً كـ `super_admin` في قاعدة البيانات لكنه لا ينتمي للمنصة المركزية، يتم إجباره وتخفيضه فورياً في الذاكرة إلى `admin`. <br>3. **طبقة الإنشاء والتهيئة:** إنشاء الشركات التجريبية (`trial-tenant-provisioning`) وإسكربتات التفعيل والتهيئة الأولى (`activation.service.ts`) تمنح دور `admin` حصرياً لأصحاب المتاجر والمستأجرين. <br>4. **طبقة إدارة المستخدمين (`users.service.ts`):** منع إنشاء أو ترقية أي مستخدم لرتبة `super_admin` خارج منصة الإدارة مع تحويله تلقائياً لـ `admin`. <br>5. **طبقة فحص الخدمة الصارم (`assertPlatformAccess`):** حظر فوري في كود الخدمات لأي استدعاء برمجي لا يحمل معرف المنصة. <br>6. **طبقة الفرونت إند والتوجيه (`access.ts` & `app-shell.tsx`):** حجب مسارات الساس وعناصر القوائم بالكامل عن غير مسؤولي المنصة، وإخفاء رتبة السوبر أدمن من شاشات إدارة المستخدمين للمستأجرين. <br>7. **شبكة اختبارات الأمان الآلية الدائمة (`test:auth` & `test:critical`):** تم دمج اختبارات آلية صارمة (`super-admin-role.guard.spec.ts` 7/7 و `session-auth.spec.ts`) تضمن فشل أي بيلد أو سير عمل CI مستقبلاً إذا حدث أي مساس أو تراجع في عزل السوبر أدمن. |
| **مايجريشن تطهير رتب السوبر أدمن القديمة للمستأجرين** | 🟢 | 100% | `2040000000047_sanitize_tenant_superadmin_roles.ts` | ترحيل بيانات آلي يفحص جدول `users` ويخفض تلقائياً أي حساب مستأجر تم إنشاؤه سابقاً بالخطأ برتبة `super_admin` إلى `admin` دون المساس بصلاحياته التشغيلية داخل منشأته لضمان الحماية الفورية. |
| **حصر رصد ومراقبة السيرفر (APM) بالسوبر أدمن ومنع انهيار المتصفح** | 🟢 | 100% | `settings.page-config.ts`, `SettingsPage.tsx`, `SettingsSectionTabs.tsx`, `SettingsTelegramAlertsSection.tsx` | حصر تبويب "المراقبة ورصد السيرفر (APM)" وتنبيهات تيليجرام للأعطال بسوبر أدمن منصة الإدارة المركزية حصرياً (`superAdminOnly` مع فحص `isPlatformAdmin`)، مع إخفائه تماماً عن كافة مستأجري ومتاجر النظام وإعادة توجيه أي محاولة دخول مباشرة، وحذف كود `process.version` غير المتوافق مع المتصفح لمنع خطأ انهيار القسم نهائياً. |
| **المزامنة الصارمة لحفظ موديولات النظام والعزل الديناميكي للسايدبار (Zero-Leak Modular Gating)** | 🟢 | 100% | `SettingsMainForm.tsx`, `ModulesSettingsTab.tsx`, `app-shell.tsx`, `GlobalSearchModal.tsx` | 1) حل جذري لعدم ثبات تفعيل الموديولات (`maritimeFreightModuleEnabled` و `contractingModuleEnabled`) داخل فورم الإعدادات وإضافتها لبيانات الحفظ والـ reset الافتراضية لمنع فقدان التحديد عند التحديث. <br>2) إزالة كافة القيود الشرطية التعسفية في تبويب الموديولات لتمكين المشرفين من تفعيل وإلغاء أي موديول بحرية كاملة دون إخفاء البطاقات. <br>3) عزل تام وفلترة صارمة لعناصر ومجموعات القائمة الجانبية ومودال البحث السريع: إخفاء مجموعات وبنود المبيعات والمخزون والمشتريات عند تعطيلها (مثل تفعيل المقاولات والشحن فقط وإلغاء الـ POS والمخزون) بحيث لا تتسرب فواتير أو أصناف التجزئة للقائمة إطلاقاً. |

---


<!-- migrated:cap-044:end -->

<a id="cap-052"></a>
<!-- migrated:cap-052:start -->
## 26. معالج استيراد البيانات التجريبية السريعة حسب النشاط (One-Click Demo Data Wizard)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **Backend Datasets & Logic:** `backend/src/modules/settings/services/demo-datasets/` (`types.ts`, `supermarket.dataset.ts`, `fashion.dataset.ts`, `cafe.dataset.ts`, `electronics.dataset.ts`, `pharmacy.dataset.ts`, `index.ts`), `backend/src/modules/settings/services/settings-demo-data.service.ts`, `backend/src/modules/settings/controllers/settings-admin.controller.ts`
  * **Frontend Wizard & Navigation:** `frontend/src/features/settings/api/demo-data.api.ts`, `frontend/src/features/settings/components/workspace-sections/SettingsDemoDataWizardSection.tsx`, `frontend/src/features/settings/pages/settings.page-config.ts`, `frontend/src/features/settings/pages/SettingsSectionContent.tsx`, `frontend/src/shared/system/SmartDemoOnboardingBanner.tsx`, `frontend/src/features/settings/components/workspace-sections/SettingsBackupImportSection.tsx`
* **الجداول في قاعدة البيانات:** `products`, `product_categories`, `product_location_stock`, `suppliers`, `customers`, `delivery_representatives`, `cashier_shifts`, `purchases`, `purchase_items`, `sales`, `sale_items`, `sale_payments`, `online_orders`, `hr_employees`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **5 باقات بيانات واقعية متخصصة بالأنشطة (5 Industry Datasets)** | 🟢 | 100% | `demo-datasets/` (`supermarket`, `fashion`, `cafe`, `electronics`, `pharmacy`) | بيانات جاهزة وواقعية لـ 5 أنشطة: (1) **سوبرماركت ومواد غذائية** (43 صنفاً، ألبان، معلبات، منظفات)، (2) **ملابس وأزياء وأحذية** (40 صنفاً بمقاسات وألوان ونمط fashion)، (3) **كافيه ومطعم ومشروبات** (40 صنفاً، إسبريسو، وجبات سريعة، طاولات وتيك أواي)، (4) **إلكترونيات وموبايل وصيانة** (38 صنفاً، هواتف، شواحن، قطع غيار)، (5) **صيدلية ومستحضرات تجميل** (38 صنفاً، أدوية، فيتامينات، مستحضرات). |
| **شاشة معالج التخصيص التفاعلية في الإعدادات (Demo Wizard Section)** | 🟢 | 100% | `SettingsDemoDataWizardSection.tsx`, `settings.page-config.ts`, `SettingsSectionContent.tsx` | شاشة مخصصة في الإعدادات (`/settings/demo-data`) بتصميم مؤسسي نظيف بنظام البطاقات المتجاوبة، بطاقات تفاعلية لكل نشاط مع استعراض شارات الأصناف ونبذة تخصصية، فحص آلي لحالة قاعدة البيانات، وتنبيه واضح بالحالة. |
| **التعبئة الفورية بضغطة زر واحدة (Instant 5-Second Seeding)** | 🟢 | 100% | `settings-demo-data.service.ts`, `settings-admin.controller.ts` (`/api/admin/demo-data/seed`) | إنشاء متزامن لكافة التصنيفات، الأصناف بالباركودات والأسعار وأرصدة المخازن، الموردين، العملاء، مناديب الدليفري، الكوادر والموظفين، فتح وردية كاشير في الـ POS، وتوليد فواتير مبيعات سابقة موزعة على 6 أشهر مع هوامش ربح متزنة لتغذية الداشبورد والرسوم البيانية فورياً في 5 ثوانٍ. |
| **توليد طلبات متجر إلكتروني سحابية وتكامل شركات الشحن** | 🟢 | 100% | `demo-datasets/`, `settings-demo-data.service.ts` | توليد طلبات متجر إلكتروني تلقائية في جدول `online_orders` بحالات مختلفة (معلقة، قيد التجهيز، مشحونة، مسلّمة) لتجربة دورة المتجر الإلكتروني وشحن البضائع وبوابات الدفع. |
| **التفريغ والتنظيف الآمن للبيانات التجريبية (Safe Demo Data Wipe)** | 🟢 | 100% | `settings-demo-data.service.ts`, `settings-admin.controller.ts` (`/api/admin/demo-data/clear`) | إمكانية مسح وتفريغ الأصناف والفواتير التجريبية فقط بنقرة واحدة عند رغبة التاجر في بدء التشغيل الفعلي على مخزن نظيف، مع حفظ تلقائي لنسخة احتياطية، وحماية كلمة المرور للسوبر أدمن. |
| **ترقية بنر الترحيب الذكي في الداشبورد والإسناد المتبادل** | 🟢 | 100% | `SmartDemoOnboardingBanner.tsx`, `SettingsBackupImportSection.tsx` | إتاحة زر الانتقال المباشر للمعالج من بنر الداشبورد الذكي ومن قسم النسخ الاحتياطي والاستيراد، مما يوفر وصولاً سريعاً لأي مستخدم جديد عند تسجيل الدخول. |

---


<!-- migrated:cap-052:end -->

<a id="cap-069"></a>
<!-- migrated:cap-069:start -->
## 44. معالج استيراد وتصفير البيانات التجريبية حسب النشاط (Demo Data Wizard & Clean Reset)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme).
* **روابط الوصول السريع:** `/settings/demo-data`.
* **مسارات الكود الأساسية:**
  * **الباك إند (Backend):** `backend/src/modules/settings/services/settings-demo-data.service.ts`, `backend/src/modules/settings/controllers/settings-admin.controller.ts`, `backend/src/modules/settings/services/demo-datasets/index.ts`
  * **الفرونت إند (Frontend):** `frontend/src/features/settings/api/demo-data.api.ts`, `frontend/src/features/settings/components/workspace-sections/SettingsDemoDataWizardSection.tsx`, `frontend/src/features/settings/pages/SettingsSectionContent.tsx`
* **الميزات والقدرات المفعلة:**
  1. **معالج استيراد بيانات النشاط بنقرة واحدة (One-Click Industry Seeding):** 5 باقات متكاملة (سوبرماركت ومواد غذائية، أزياء وملابس وأحذية، كافيه ومطعم، إلكترونيات وهواتف، صيدلية ومستحضرات) تملأ النظام فورياً بـ 50 صنفاً حقيقياً مع باركودات وأسعار شراء وبيع وأقسام متسقة.
  2. **توليد فواتير المبيعات التاريخية وحركات الكاشير:** محاكاة حركات بيع واقعية موزعة على 6 أشهر مع هوامش ربح متزنة لتفعيل لوحات التحكم والمؤشرات البيانية فوراً.
  3. **توليد طلبات المتجر السحابي:** إضافة طلبات إلكترونية بحالات شحن مختلفة لتجربة بوابات التوصيل والشحن.
  4. **حماية السوبر أدمن والنسخ الاحتياطي التلقائي:** اشتراط كلمة مرور السوبر أدمن عند استبدال البيانات، وأخذ نسخة احتياطية Snapshot تلقائياً قبل التصفير لحماية البيانات.
  5. **تفريغ ومسح البيانات التجريبية حصرياً للمنصة المركزية (Platform-Exclusive Reset):** حظر أزرار وخيارات التصفير أو مسح البيانات تماماً عن المشتركين والشركات المستضافة، وحصر صلاحية التصفير أو سكب البيانات على منصة الإدارة المركزية والسوبر أدمن، مع السماح للمشترك الجديد برؤية المعالج فقط عندما تكون قاعدة بياناته نظيفة وفارغة لاستكشاف النظام.
  6. **التوافق التام مع معيار العقود وتطهير الإيموجيز من الباك إند (0 Emojis & Resilient Cascade Ordering):** تطهير كامل لملفات الباقات التجريبية في الباك إند (`supermarket.dataset.ts`, `fashion.dataset.ts`, إلخ) واستبدال الإيموجيز بمعرفات قياسية (`shopping-cart`, `tag`, `utensils`, `smartphone`, `shield-check`) لضمان عدم إرسال أي إيموجيز نهائياً عبر الـ API، مع الحفاظ على التوافق بين كائنات الباك إند والفرونت إند. وضمان حذف البيانات بحسب الترتيب الهرمي الدقيق للعلاقات والمفاتيح الخارجية (Foreign Keys) لجداول الرواتب والقروض (`hr_payroll_loan_deduction_allocations`) والأقساط وعروض الأسعار ورحلات الفان لمنع أخطاء القيود (FK 23503) نهائياً أثناء التصفير وإعادة الاستيراد.
  7. **دورة حياة تبويب البيانات التجريبية والتوجيه التلقائي (Dynamic Demo Tab Lifecycle):** يظهر تبويب البيانات التجريبية (`/settings/demo-data`) للعميل فقط عندما تكون قاعدة بياناته خالية تماماً من المنتجات والمبيعات (`isEmpty === true`) لمساعدته في البداية، وبمجرد سكب البيانات أو تسجيل أي عمليات تجارية يختفي التبويب تماماً من القائمة الجانبية وشريط التبويبات، مع إعادة توجيه المستخدم تلقائياً إلى الإعدادات العامة في حال محاولة زيارة الرابط المباشر.

---


<!-- migrated:cap-069:end -->

<a id="cap-075"></a>
<!-- migrated:cap-075:start -->
## 50. معالج التخصيص الذكي للموديولات والأنشطة التجارية (Smart Modular Configurator & Industry Presets)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme & Full Width Responsive Grid).
* **روابط الوصول السريع:** `/settings/modules` (شاشة الموديولات في الإعدادات العامة) وشاشة التهيئة الأولى `/setup`.
* **مسارات الكود الأساسية:**
  * **محرك الأنشطة والاعتماديات:** `frontend/src/features/settings/components/modular-configurator/modular-presets.ts`
  * **معالج التخصيص التفاعلي:** `frontend/src/features/settings/components/modular-configurator/SmartModularConfiguratorModal.tsx`
  * **شريط الوصول السريع:** `frontend/src/features/settings/components/modular-configurator/SmartModularQuickBar.tsx`
  * **إدارة الموديولات بالمنظومة:** `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`
  * **مخطط التحقق:** `frontend/src/features/settings/schemas/settings.schema.ts`
  * **شاشة التهيئة الأولى:** `frontend/src/features/activation/components/onboarding/Step3Industry.tsx`
* **الميزات والقدرات المفعلة:**
  1. **مصفوفة الأنشطة الـ 10 المعيارية (10 Comprehensive Industry Presets):** تغطية شاملة لكافة قطاعات الأعمال في السوق العربي: (1) تجارة التجزئة والسوبرماركت، (2) مبيعات الجملة والتوزيع، (3) المطاعم والكافيهات، (4) الملابس والأزياء والأحذية، (5) الإلكترونيات ومراكز الصيانة، (6) الصيدليات والمراكز الطبية، (7) التصنيع الخفيف والورش، (8) الشركات الخدمية والمقاولات، (9) المتاجر الرقمية والبيع أونلاين، و (10) تخصيص يدوي حر.
  2. **معالج المنيو الذكي (Interactive 3-Step Modular Menu):** تجربة استخدام متكاملة تشبه "قائمة المنيو"؛ الخطوة الأولى لاختيار هوية النشاط، الخطوة الثانية مخصّص للموديولات مع فلاتر الفئات والبحث وشروحات عملية لكل موديول، والخطوة الثالثة ملخص دقيق لما تم تفعيله وما سيبقى مخفياً لتخفيف الواجهة.
  3. **شبكة الاعتماديات التلقائية (Smart Dependencies Resolver):** خوارزمية ذكية تفحص متطلبات كل موديول (مثل اعتماد المطاعم على نقاط البيع، والصيانة على الخدمات والمخزون) وتفعلها آلياً مع تنبيه المستخدم بوضوح.
  4. **محرك المطابقة الذكية للباقات (Smart SaaS Plan Recommendation):** تحليل فوري للموديولات المختارة ومطابقتها التلقائية مع مصفوفة باقات الساس الـ 4 المعتمدة في النظام (الأساسية، الاحترافية، المتكاملة، والتجارة الشاملة) مع إظهار الملخص التشغيلي. **الأسعار مصدرها الوحيد `PRICING_AND_PACKAGING.md`، ولا تُكتب في الكود ولا في الواجهة**.
  5. **شريط التبديل السريع بالهيدر (Smart Modular QuickBar):** كارت مؤسسي أنيق بأعلى صفحة الموديولات يتيح التبديل بنقرة واحدة بين الأنشطة الأكثر شيوعاً، مع زر تشغيل المعالج الكامل بلون الكحلي الملكي الرسمي.
  6. **الالتزام الكامل بالدستور البصري وحظر الإيموجيز (Enterprise Visual Constitution & 0 Emojis):** خلفية ناصعة (`#f8fafc`)، بطاقات بيضاء نقية (`#ffffff`)، حدود ناعمة (`#e2e8f0`)، زر إجراءات كحلي ملكي عميق (`#170e5e`)، وخلو تام ومطلق من أي إيموجيز أو رموز كرتونية مع الاعتماد الحصري على أيقونات SVG خطية معتمدة.

---


<!-- migrated:cap-075:end -->

<a id="cap-076"></a>
<!-- migrated:cap-076:start -->
## 51. الهيكلية النمطية الشاملة وتحويل النواة الكلاسيكية لموديولات اختيارية (Full Modular Core: Purchases, Advanced Inventory & HR)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme & Dynamic Sidebar Pruning).
* **روابط الوصول السريع:** `/settings/modules` (شاشة الموديولات في الإعدادات العامة) وكافة شاشات المنظومة.
* **مسارات الكود الأساسية:**
  * **المخطط والتحقق:** `frontend/src/features/settings/schemas/settings.schema.ts`, `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`
  * **شاشة التحكم والتبديل:** `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`
  * **محرك الأنشطة وقوالب الساس:** `frontend/src/features/settings/components/modular-configurator/modular-presets.ts`
  * **شريط التوجيه والقائمة الجانبية:** `frontend/src/shared/layout/app-shell.tsx`
* **الميزات والقدرات المفعلة:**
  1. **تحويل النواة الكلاسيكية لموديولات مرنة (Modular Core Transformation):** تحويل الأنظمة التي كانت تُعد ثابتة سابقاً (المشتريات والموردين، المخازن المتقدمة، والموارد البشرية HR) إلى موديولات نمطية قابلة للتفعيل والتعطيل بنقرة زر واحدة على غرار بنية Odoo العالمية.
  2. **الحفاظ الصارم على التوافقية العكسية (Default True Compatibility):** تعيين القيمة الافتراضية للموديولات الثلاثة إلى `true`، مما يضمن عدم تأثر أي حساب أو عميل قائم إطلاقاً، مع إتاحة التعطيل الفوري لأي منشأة ترغب في تبسيط واجهتها.
  3. **الحجب الذكي والكامل لعناصر ومجموعات القائمة الجانبية (Dynamic Sidebar Pruning):**
     * **المشتريات والموردين (`purchasesModuleEnabled`):** عند الإيقاف، يتم حجب إنشاء فاتورة شراء، سجل الفواتير، مرتجعات المشتريات، الموردين، مقترح إعادة الطلب الذكي، وتقارير المشتريات؛ وبذلك تصبح مجموعة `المشتريات والموردين` فارغة تماماً وتختفي كلياً من القائمة الجانبية تلقائياً.
     * **المخازن المتقدمة (`inventoryModuleEnabled`):** عند الإيقاف، يتم حجب أماكن المخزون، شجرة المخازن، أذونات الصرف والتحويلات، وتقارير المخزون؛ لتبقى الواجهة خفيفة ومناسبة للشركات الخدمية والمكاتب الاستشارية.
     * **الموارد البشرية (`hrModuleEnabled`):** عند الإيقاف، يتم حجب موديول الموارد البشرية والرواتب من مجموعة الإدارة والنظام، وحجب تقارير الموظفين من التقارير.
  4. **كروت تحكم مؤسسية بأيقونات رسمية موحدة (Enterprise Toggle Cards):** تم تصميم كروت التحكم الثلاثة في ترويسة تبويب الموديولات وفق الدستور البصري الموحد بأيقونات رسمية (`PackageIcon`, `ReceiptIcon`, `UsersIcon`)، مع فحص صلاحيات باقة الاشتراك السحابي (`useHasFeature`) وعرض شارة "ترقية مطلوبة" عند عدم توفر الميزة في الباقة.
  5. **التكامل مع معالج الأنشطة وترشيح الباقات (Preset Engine Integration):** ربط المفاتيح الثلاثة بمصفوفة الأنشطة الـ 10، حيث يقوم نشاط "الشركات الخدمية والمقاولات" بتعطيل المخازن والمشتريات تلقائياً لتحويل النظام إلى نظام محاسبي وفوترة فائق السرعة والخفة.
  6. **التطبيق الشامل للفلترة ومنع التجاوز العشوائي (Universal Sidebar Pruning Without Admin Bypass):** إلغاء استثناء السوبر أدمن التلقائي (`Platform Admin Bypass`) في شروط إخفاء الموديولات، بحيث يعكس السايد بار دائماً حالة إعدادات المنشأة الفعلية (`settings.*`) بدقة 100% للجميع؛ فإذا تم تعطيل موديول، يختفي فورياً من السايد بار حتى للسوبر أدمن لضمان مطابقة تجربة الاستخدام ومحاكاة بيئة العميل بدقة، مع اقتصار خصوصية السوبر أدمن على إدارة المنصة والساس (`saas-admin`) وإشراف النظام المركزي.
  7. **تطهير وهيكلة مسارات السايد بار وإلغاء الحشو (Sidebar Deduplication & Workflow Reorganization):** 
     - **إلغاء العناصر المكررة:** حذف «إنشاء فاتورة شراء» من السايد بار للاكتفاء بزر الإنشاء داخل «سجل فواتير المشتريات»، وحذف «إذن صرف جديد» للاكتفاء بزر الإنشاء داخل «سجل أذونات الصرف والتحويل».
     - **إعادة التموضع المنطقي الصحيح:** نقل «الإقرار الضريبي (ن10 و ZATCA)» إلى قسم «المالية والمحاسبة»، وتقديم «الخدمات» للأعلى مباشرة بعد «أقسام الأصناف» لتجاور كتالوج المنتجات.
     - **فصل شاشات التشغيل والمطاعم:** استحداث قسم مستقل لـ «المطاعم والكافيهات» يظهر حصرياً عند تفعيل الموديول ويحتوي على «شاشة المطبخ (KDS)»، مع تنظيف قسم المبيعات وترتيبه وفق تسلسل دورة البيع الطبيعية (عروض أسعار ➔ فواتير ➔ مرتجعات ➔ تقسيط ➔ عملاء ➔ مناديب ➔ فاتورة إلكترونية ➔ شاشات عروض).

---


<!-- migrated:cap-076:end -->

<a id="cap-077"></a>
<!-- migrated:cap-077:start -->
## 52. أتمتة تهيئة الموديولات عند التسطيب الأول في الإلكترون وصفحة الترحيب والتخصيص المستقلة في الساس (Desktop First-Run Setup & SaaS Full-Page Onboarding Hub)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme & Full-Page Clean Architecture).
* **روابط الوصول السريع:** مسار التهيئة الأولى للديسكتوب `/setup` ومسار الترحيب والتخصيص المستقل للساس `/onboarding` (مع دعم المعاينة المباشرة `?preview=1` أو `?onboarding=1`).
* **مسارات الكود الأساسية:**
  * **الباك إند (Backend):** `backend/src/modules/activation/dto/initialize-app.dto.ts`, `backend/src/modules/activation/activation.service.ts`
  * **الفرونت إند (Frontend - Desktop):** `frontend/src/types/activation.ts`, `frontend/src/features/activation/hooks/useFirstRunSetupPageController.ts`, `frontend/src/features/activation/components/onboarding/OnboardingWizard.tsx`, `frontend/src/features/activation/components/onboarding/Step3Industry.tsx`
  * **الفرونت إند (Frontend - SaaS):** `frontend/src/features/activation/pages/SaaSOnboardingPage.tsx`, `frontend/src/app/router/root-router.tsx`, `frontend/src/shared/layout/app-shell.tsx`, `frontend/src/features/settings/schemas/settings.schema.ts`, `frontend/src/features/settings/contracts.ts`, `frontend/src/features/settings/components/modular-configurator/modular-presets.ts`
* **الميزات والقدرات المفعلة:**
  1. **التهيئة الفورية في معالج الديسكتوب والإلكترون (Offline / Electron First-Run Automation):** ربط الخطوة الثالثة لاختيار النشاط التجاري في معالج التثبيت الأول (`/setup`) بحفظ وتطبيق حزمة الإعدادات والموديولات الكاملة في جدول `settings` المحلي تلقائياً داخل المعاملة (Transaction) ذاتها، ليدخل العميل بعد التسطيب ويجد النظام مفصلاً ومضبوطاً حسب نشاطه بنسبة 100%.
  2. **صفحة الترحيب والتخصيص الكاملة والمستقلة لمشتركي الساس (Full-Page SaaS Onboarding Experience):** الانتقال من نمط النوافذ المنبثقة الضيقة إلى صفحة كاملة مستقلة `/onboarding` تستقبل العميل ببيئة هادئة وناصعة (Clean White & Light Slate `#f8fafc`) تعرض شبكة الأنشطة الـ 10 المعيارية بأيقونات SVG خطية معبرة وفائقة الدقة بدون أي تآكل للحواف وبدون سكرول داخلي محشور.
  3. **التخصيص الفوري بنقرة واحدة (Instant 1-Click Environment Setup):** بمجرد اختيار النشاط والضغط على "تأكيد الإعداد وبدء العمل"، يتم تطبيق وضبط كافة مفاتيح الموديولات والأنماط وحجب ما لا يلزم في القائمة الجانبية وحفظ علامة الإكمال (`onboardingCompleted: true`) والتوجيه السلس إلى لوحة التحكم الرئيسية (`/`).
  4. **خيار التخطي المؤسسي (Graceful Skip & Dismissal):** إتاحة زر "تخطي والبدء بالإعدادات الافتراضية" ليتمكن العميل من بدء العمل بالإعدادات الافتراضية مع حفظ علامة الإكمال لعدم إزعاجه مرة أخرى، بالإضافة لخيار "تخصيص متقدم بنداً ببند" للانتقال السلس لمعالج الموديولات في الإعدادات.
  5. **عزل الصلاحيات وحماية السوبر أدمن (Privilege Guard):** حظر ظهور صفحة الترحيب لسوبر أدمن المنصة المركزية (`isPlatformAdmin`)، واقتصارها حصرياً على مديري المنشآت المستضافة (`admin` أو `super_admin`) عند كون `onboardingCompleted !== true`.
  6. **ثبات الكروت التام وهندسة انعدام الإزاحة البصرية (Zero Layout Shift on Selection):** تثبيت أبعاد الكروت بدقة متناهية؛ سمك الحدود ثابت دائماً `2px` وحجز مساحة علامة الفحص (Checkmark) الموحدة وتثبيت أحجام وأوزان الخطوط، مما يحقق ثباتاً هندسياً مطلقاً (CLS = 0) عند التبديل بين كروت الأنشطة دون أي اهتزاز أو تغير في الأبعاد أو التفاف النصوص.
  7. **لوحة الموديولات التفاعلية المترابطة (Interrelated Module Selector & Logical Grouping):** إعادة تنظيم وترتيب الموديولات الـ 20 وفق ترابطها وتكاملها التشغيلي (المشتريات متجاورة مع المخازن، والخدمات مع الصيانة والسيريال، واللوجستيات مع المتجر الإلكتروني، والمحاسبة مع التقسيط والضرائب) مع ترويسات فرعية أنيقة لكل مجموعة، وزر تأكيد سريع علوي لمنع الحاجة للنزول لآخر الصفحة.
  8. **تصحيح دورة المشتريات والمخازن للأنشطة التجارية (Correct Commercial Lifecycle):** تفعيل موديول المشتريات وإدارة الموردين وموديول المخازن المتقدمة تلقائياً لكافة الأنشطة التجارية (تجزئة، جملة، مطاعم، أزياء، أجهزة، إلخ) لحساب متوسط التكلفة المرجح WAC وجرد الأصناف بدقة.
  9. **حساب الباقة والمطابقة التلقائية اللحظية (Real-time Plan Tier Calculation):** حساب فوري ومباشر للباقة المتوافقة (الأساسية، باقة النمو، المتكاملة، التجارة الشاملة) استناداً إلى الموديولات المحددة فعلياً، وحفظ اختيارات العميل المخصصة بدقة تامة.
  10. **تكامل دورة التوجيه بعد تسجيل الدخول (End-to-End Post-Login Redirection):** فحص حالة التهيئة الأولية للمشترك الجديد لحظياً عبر مسار `auth/me` وجلسة المستخدم؛ حيث يتم توجيه مدير المنشأة تلقائياً إلى `/onboarding` في حال عدم اكتمال التهيئة (`onboardingCompleted: false`)، مع منع التخطي العشوائي، والتحويل الفوري إلى الرئيسية `/` وتكييف السايد بار لحظياً فور الحفظ.
  11. **دليل البداية السريعة لتشغيل المنشأة بالداشبورد (Tenant Quick-Start Checklist):** بطاقة إرشادية مؤسسية أنيقة وخفيفة في أعلى لوحة التحكم الرئيسية (`TenantQuickStartChecklist.tsx`) ترشد المشترك الجديد نحو أولى محطاته التشغيلية الثلاث: (1) ضبط بيانات المنشأة وترويسة الفواتير، (2) إضافة أول منتج أو استيراد بيانات تجريبية جاهزة، و(3) فتح أول وردية وبدء البيع (POS)، مع مؤشر إنجاز ناعم وزر إخفاء وحفظ الحالة محلياً.
  12. **تخصيص البيانات التجريبية حسب النشاط المختار (Industry-Aware Demo Data Engine):** ربط محرك سكب البيانات التجريبية (`settings-demo-data.service.ts`) بنشاط المنشأة المختار في التهيئة (`businessIndustry`)، بحيث يتم تلقائياً سكب أصناف وفواتير مطابقة تماماً للمجال (وجبات وطاولات للمطاعم، ملابس ومقاسات للأزياء، أجهزة وصيانة للإلكترونيات، أدوية وباتشات للصيدليات، وبقالة وسلع استهلاكية للتجزئة) وتحديث نصوص أزرار السكب السريع بالداشبورد ومعالج الإعدادات تلقائياً.
   13. **إتاحة العودة المستمرة لصفحة التهيئة والتخصيص طالما لم يتم إدخال أصناف (Onboarding Re-entry While Inventory is Empty):** السماح للمستخدم بفتح شاشة التهيئة وتعديل النشاط والموديولات (`/onboarding`) حتى لو كان قد ضغط على "تخطي" مسبقاً، وذلك طالما أن عدد الأصناف في المنشأة صفر (`totalProducts === 0`) لمنحه فرصة التعديل بحرية كاملة قبل بدء العمل الفعلي، مع توفير رابط وصول سريع ومباشر في ترويسة دليل البداية السريعة بالداشبورد (`TenantQuickStartChecklist`) يتيح فتح الشاشة بضغطة زر واحدة في أي وقت.
   14. **الإخفاء التلقائي لدليل البداية السريعة عند اكتمال الجاهزية 100% (Auto-dismiss on 100% Operational Readiness):** إخفاء بطاقة دليل البداية السريعة بالداشبورد (`TenantQuickStartChecklist.tsx`) تلقائياً وحفظ إغلاقها في التخزين المحلي بمجرد إنجاز الخطوات التشغيلية الثلاث بالكامل (100%) لمنع ازدحام لوحة التحكم واستقرار الداشبورد نظيفة للمستخدم.
   15. **التدفق الإرشادي المتصل والتوجيه التلقائي في شاشات الإعدادات (Guided Continuous QuickStart Stepper):** إضافة شريط إرشادي متصل بالترويسة (`QuickStart Banner`) في شاشة إعدادات المنشأة الأساسية (`/settings/core?setup=quickstart`) وشاشة استيراد البيانات التجريبية (`/settings/demo-data?setup=quickstart`) يوضح رقم الخطوة وما سيحدث بعدها، مع التوجيه التلقائي المباشر للخطوة التالية (تجهيز الأصناف) فور حفظ بيانات المنشأة دون ضياع المستخدم أو إجباره على العودة اليدوية للرئيسية.
   16. **نافذة التحميل الكاملة ومؤشر الانتظار الشفاف عند سكب البيانات التجريبية (Transparent Full-Screen Seeding Overlay):** عرض نافذة تحميل كاملة في منتصف الشاشة (`Full-Screen Loading Overlay`) أثناء سكب البيانات التجريبية توضح للمستخدم بالاسم والنص والعداد أنه جاري توليد 50 صنفاً وفواتير كاشير وعمليات خزينة لنشاطه المختار، مع استبدال إعادة تحميل الصفحة العشوائية (`window.location.reload`) بالتحديث الحي الناعم لكويريز البيانات (`queryClient.invalidateQueries`) وعرض نافذة نجاح تفاعلية توجهه مباشرة للخطوة الثالثة (فتح الكاشير).
   17. **توحيد ومطابقة معرف الحساب في سكب البيانات ودليل الأصناف (Demo Account ID Alignment & Resilient Catalog Predicate):** تصحيح دالة سكب البيانات التجريبية السحابية للمشتركين (`SettingsDemoDataService.seedTenantDemoData`) لتربط الأصناف والأقسام والمستودعات صراحةً بحساب المالك الفعلي للمنشأة (`account_id = primaryUser.account_id || tenantId:main`)، وترقية محرك الاستعلام في `CatalogProductService` و`ProductSerialsService` ليطابق الأصناف بمرونة (`account_id = accountId OR account_id = tenantId OR account_id IS NULL`) مع الالتزام التام والصلب بعزل المنشأة (`tenant_id`)، وتوليد هجرة 169 لتطبيع السجلات العملياتية المسكوبة مسبقاً.

---


<!-- migrated:cap-077:end -->

<a id="cap-081"></a>
<!-- migrated:cap-081:start -->
## 56. إعادة هيكلة وتوحيد شاشات وتبويبات الإعدادات وهرمية التنقل المؤسسية (Settings Architecture & Enterprise Navigation Overhaul)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **روابط وشاشات الوصول:** `/settings/*` (`core`, `reference`, `users`, `tax-integration`, `storefront`, `marketplaces`, `whatsapp`, `daily-digest`, `backup`, `subscription`, `lan-network`, `system-updates`, `monitoring`).
* **مسارات الكود الأساسية:**
  * **الفرونت إند (Frontend):**
    * `frontend/src/features/settings/pages/settings.page-config.ts` (تعريف الأقسام والتسميات الرسمية وخاصية `hiddenInTabs`).
    * `frontend/src/features/settings/pages/SettingsSectionTabs.tsx` (فلترة التبويبات الثانوية وتمييز التبويب الأب النشط تلقائياً).
    * `frontend/src/features/settings/pages/SettingsSectionContent.tsx` (حاويات التبديل الداخلية بين المتجر وأمازون ونون، والواتساب والملخص اليومي).
    * `frontend/src/features/settings/pages/settings-page.helpers.tsx` (تحديث التوصيفات الإدارية لكافة أقسام الإعدادات).
    * `frontend/src/features/settings/components/forms/SettingsMainForm.tsx` (تقليص تبويبات الإعدادات الأساسية إلى 4 تبويبات وإزالة تابة الأمان الزائدة).
    * `frontend/src/features/settings/components/forms/tabs/SalesInventorySettingsTab.tsx` (دمج حقل رمز المدير PIN مع كارت سقف الخصم، وإضافة رابط سريع للتكامل الضريبي).
* **الميزات والقدرات المفعلة:**
  1. **تقليص شريط التبويبات العلوي لمنع التكدس (Single-Row Clean Tab Bar):** تقليص التبويبات المعروضة في شريط الإعدادات من 14 تابة متراكمة على صفين إلى صف واحد متناسق (8 تابات أساسية)، مع الحفاظ الكامل على كافة المسارات والروابط المباشرة والعميقة عبر ميزة `hiddenInTabs`.
  2. **دمج وإعادة توحيد التجارة الإلكترونية والمنصات (Omnichannel Settings):** دمج شاشة المتجر الإلكتروني الخاص (`/settings/storefront`) والربط مع أمازون ونون (`/settings/marketplaces`) داخل تبويب رئيسي موحد بعنوان "التجارة الإلكترونية والمنصات"، مع شريط تبديل فرعي أنيق يتيح التنقل اللحظي بينهما دون مغادرة السياق.
  3. **دمج وإعادة توحيد الواتساب والتقارير الذكية (WhatsApp Intelligence):** دمج بوابة الواتساب السحابية وبوت الذكاء الاصطناعي (`/settings/whatsapp`) مع الملخص اليومي للمدير (`/settings/daily-digest`) داخل تبويب رئيسي موحد بعنوان "بوابة الواتساب والتقارير الذكية"، مع شريط تبديل داخلي فوري.
  4. **تبسيط نموذج الإعدادات الأساسية (`settings/core`):** تقليص التبويبات الداخلية إلى 4 تبويبات مركزة (عام، البيع وقواعد المخزون، موديولات النظام، الطباعة والإيصالات) بدلاً من 5 تبويبات، حيث تم نقل حقل `managerPin` مباشرة إلى موقعه الوظيفي الطبيعي في تبويب البيع والمخزون داخل كارت "سقف خصم الكاشير واعتماد المدير (PIN)"، والاستغناء عن تابة الأمان الشبه فارغة، والاعتماد على قسم النسخ والصيانة المخصص لإدارة الحفظ التلقائي.
  5. **ربط تكاملي سريع مع الفاتورة الإلكترونية:** إضافة بطاقة إرشادية ورابط مباشر داخل قسم الضريبة الأساسي ينقل المستخدم بنقرة واحدة إلى إعدادات الربط السحابي مع مصلحة الضرائب المصرية (ETA) وهيئة الزكاة والضريبة والجمارك (ZATCA).
  6. **الالتزام الكامل بالدستور البصري وسياسة منع الإيموجيز (Strict UI Constitution & 0 Emojis):** اعتماد التدرج الكحلي الملكي `#170e5e` للأزرار والتبويبات النشطة، والخلفيات الرمادية الهادئة `#f1f5f9`، والكروت البيضاء المتوازنة، والأيقونات الرسمية الحصرية من `@/shared/components/icons/AppIcons`.

---


<!-- migrated:cap-081:end -->

<a id="cap-109"></a>
<!-- migrated:cap-109:start -->
## 78. محرك التخصيص والعزل الرأسي للأنشطة والقطاعات (Industry Vertical Isolation Engine)

### نظرة عامة
تطوير منظومة عزل وفصل ثنائية الاتجاه (Bidirectional Vertical Isolation Engine) تجعل النظام يتكيف بالكامل مع طبيعة نشاط العميل وتمنحه شعوراً مطلقاً بأن المنظومة صُممت له خصيصاً كمنظومة مؤسسية متخصصة (ERP SaaS)، مع إخفاء تام وشامل لكافة الشاشات والمفاهيم والمصطلحات الدخيلة:

1. **قطاع المقاولات والهندسة (`contracting`):**
   - بيئة عمل مخصصة بالكامل للمشاريع، المقايسات (BOQ)، المستخلصات (IPC)، عقود الباطن، والتقارير اليومية.
   - إخفاء تام لنقاط البيع (POS)، درج الكاشير، الورديات، شاشات المطبخ (KDS)، المبيعات السريعة، وأنشطة الشحن والعيادات.
   - ترتيب هرمي علوي لمجموعات السايدبار يبدأ بالمقاولات ثم المشتريات ومستودعات المواقع ومحاسبة المشاريع.
   - تخصيص أزرار الوصول السريع في أعلى التطبيق: (لوحة التحكم، المشاريع، المستخلصات، جداول الكميات).

2. **قطاع الشحن البحري واللوجستيات (`maritime`):**
   - بيئة عمل مخصصة لأوامر التشغيل، الحاويات وفترات السماح (Demurrage)، ومصفوفة مقارنة الخطوط الملاحية.
   - إخفاء تام للـ POS، الورديات، تجزئة المنتجات، المقاولات، الصيدليات، والمطاعم.
   - أزرار وصول سريع مخصصة: (لوحة التحكم، أوامر التشغيل، تتبع الحاويات، عروض الأسعار).

3. **قطاعات التجزئة والمتاجر المتخصصة والتقسيط والتركيبات والتجارة الإلكترونية:**
   - تغطية شاملة لـ 16 نمطاً قطاعياً ومؤسسياً: (المقاولات، الشحن واللوجستيات، المتاجر الرقمية والتجارة الإلكترونية، الاستيراد والتصدير والرسائل الجمركية، السوبرماركت والمواد الغذائية، العطارة والمحامص، التجزئة العامة، معارض الأجهزة الكهربائية والتقسيط، الملابس والأزياء، العطور ومستحضرات التجميل والتركيبات، الصيدليات والرقابة الدوائية، الموبايل والإلكترونيات والصيانة، المطاعم والكافيهات، المكاتب والشركات الخدمية، تجارة الجملة والتوزيع، والتصنيع الخفيف والورش).
   - حظر وعزل قاطع لموديولات المقاولات والشحن البحري والتصنيع الثقيل والعيادات عن الأنشطة غير المعنية.
   - تركيز كامل على متطلبات كل قطاع (من بوابات الدفع والتجارة الإلكترونية، وحسابات التقسيط والكمبيالات، وتكاليف الحاويات والجمارك، إلى موازين الباركود وتتبع التشغيلات FEFO).

4. **العزل الذكي للبحث الشامل (Global Search Isolation):**
   - محرك البحث الفوري (`Ctrl + /`) يقوم بفلترة شاشات التنقل والبيانات بحيث لا تظهر نتائج مقاولات أو شحن لأصحاب أنشطة التجزئة والعطارة، ولا تظهر شاشات الكاشير لشركات المقاولات.

### الملفات المعدلة
| الملف | الدور |
| :--- | :--- |
| `backend/src/modules/saas-admin/dto/saas-admin.dto.ts` | إضافة خاصية نمط النشاط `businessIndustry` في DTO إنشاء المستأجرين الجدد |
| `backend/src/modules/saas-admin/trial-tenant-provisioning.service.ts` | بذر إعدادات الموديولات القطاعية آلياً في جدول `settings` عند إنشاء المستأجر مباشرة عبر `getIndustrySettingsPatch` لـ 16 نمطاً قطاعياً |
| `frontend/src/features/saas-admin/api/saas-admin.api.ts` | تمرير `businessIndustry` إلى واجهة برمجة تطبيقات السوبر أدمن |
| `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx` | اعتماد المكون القياسي الموحد `CustomSelect` (وفق نظام `combobox-system.css`) وتغطية الـ 16 نمطاً قطاعياً شاملاً مع باقات الميزات |
| `frontend/src/shared/layout/app-shell.tsx` | محرك العزل في السايدبار والشريط العلوي والترتيب الهرمي `preferredOrder` |
| `frontend/src/shared/components/GlobalSearchModal.tsx` | الفلترة الذكية لمحرك البحث حسب النشاط الفعلي لمنع تسريب الموديولات |
| `frontend/src/features/settings/schemas/settings.schema.ts` | اعتماد `contracting` و `maritime` في الـ schema الرسمية للأنشطة |
| `frontend/src/features/settings/components/modular-configurator/modular-presets.ts` | قوالب التكوين القطاعية الذكية الـ 16 وخوارزميات التعطيل المتبادل وحساب الباقة |
| `frontend/src/features/settings/components/modular-configurator/SmartModularQuickBar.tsx` | إدراج قوالب المقاولات والشحن البحري في شريط التخصيص السريع |
| `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx` | الأتمتة التلقائية ومحرك التهيئة `applyIndustryAutomation` عند تغيير النشاط |
| `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx` | عزل وحجب بطاقات الموديولات غير الملائمة لكل قطاع (POS، مقاولات، شحن، تصنيع، مطاعم، صيدليات، موازين) مع الحفاظ على رؤية السوبر أدمن التامة |
| `frontend/src/features/settings/components/modular-configurator/SmartModularConfiguratorModal.tsx` | أيقونات وعروض الموديولات في نافذة التكوين الذكي |
| `frontend/src/features/activation/components/onboarding/PresetIcon.tsx` | أيقونات SVG مؤسسية معتمدة لكافة القطاعات |

### جدول التحقق والجاهزية
| المتطلب | الحالة | النسبة | التفاصيل |
| :--- | :--- :---: | :---: | :--- |
| **اختيار النمط أثناء إنشاء حساب المستأجر (SaaS Admin)** | 🟢 | 100% | قائمة منسدلة بمكون `CustomSelect` الموحد تضم 16 نمطاً تجارياً وصناعياً وخدمياً ولوجستياً تغطي 100% من قدرات المنظومة |
| **البذر التلقائي لإعدادات الموديولات بالباك إند** | 🟢 | 100% | تفعيل وتعطيل الموديولات المناسبة فورياً في قاعدة البيانات بقيم صريحة لكافة الأنماط الـ 16 |
| **العزل التام في الإعدادات الداخلية (ModulesSettingsTab)** | 🟢 | 100% | منع ظهور أي موديول خارج تخصص العميل مع إتاحة التحكم الكامل للسوبر أدمن |
| **العزل الهرمي في السايدبار والشريط العلوي** | 🟢 | 100% | تخصيص مسميات وأولويات التنقل وإخفاء المجموعات غير ذات الصلة نهائياً |
| **عزل محرك البحث الشامل (Global Search)** | 🟢 | 100% | منع نتائج وروابط الموديولات غير المفعلة في شريط البحث السريع |
| **الامتثال لمعايير التصميم وخلو تام من الإيموجيز** | 🟢 | 100% | التزام كامل بـ `AppIcons` و `StandardDialog` و `CustomSelect` ودستور التيبوجرافي |

---


<!-- migrated:cap-109:end -->

<a id="cap-110"></a>
<!-- migrated:cap-110:start -->
## 79. معمارية المسارات والصفحات المستقلة لموديولات المقاولات والشحن البحري (Modular Sub-Route Architecture)

### نظرة عامة
تمت إعادة هيكلة موديولي **المقاولات الإنشائية (`contracting`)** و **الشحن البحري واللوجستيات (`maritime-freight`)** معمارياً من أسلوب الصفحة الواحدة المتضخمة المحملة بالتابات (Monolithic Workspace Tabs) إلى **معمارية المسارات الفرعية المستقلة (Modular Sub-Routes with Layout & Context)**:

1. **القضاء على عبء تحميل الـ Bundle والـ Monolithic State:**
   - تم تحويل الصفحات الأحادية إلى Layout مركزي خفيف مع سياق مشترك (`ContractingContext` و `MaritimeContext`).
   - تفعيل التحميل الكسول الحقيقي (True Code-Splitting & Lazy Loading) عبر `createLazyRoute` لكل شاشة فرعية مستقلة، بحيث لا يتم تنزيل كود شاشة المستخلصات أو الحاويات إلا عند زيارتها فعلياً.

2. **هيكلة موديول المقاولات (`contracting`):**
   - **الـ Layout الموحد:** `ContractingLayout.tsx` (يحتوي على الـ PageHeader، بطاقات KPIs المالية، شريط اختيار المشروع النشط المشترك، وشريط التبويبات).
   - **الصفحات المستقلة:**
     - `/contracting` & `/contracting/projects` -> `ContractingProjectsPage.tsx`
     - `/contracting/boq` -> `ContractingBoqPage.tsx`
     - `/contracting/gantt` -> `ContractingGanttPage.tsx`
     - `/contracting/change-orders` -> `ContractingChangeOrdersPage.tsx`
     - `/contracting/invoices` -> `ContractingInvoicesPage.tsx`
     - `/contracting/subcontracts` -> `ContractingSubcontractsPage.tsx`
     - `/contracting/materials` -> `ContractingMaterialsPage.tsx`
     - `/contracting/daily-logs` -> `ContractingDailyLogsPage.tsx`
     - `/contracting/rfis` -> `ContractingRfiPage.tsx`
   - **التوافق العكسي:** تحويل تلقائي لأي زيارات قديمة تعتمد `?tab=...` إلى المسار النظيف الجديد.

3. **هيكلة موديول الشحن البحري (`maritime-freight`):**
   - **الـ Layout الموحد:** `MaritimeLayout.tsx` (يحتوي على الـ PageHeader، بطاقات KPIs التشغيلية، وشريط التبويبات مع العدادات الحية).
   - **الصفحات المستقلة:**
     - `/maritime` & `/maritime/rfqs` -> `MaritimeRfqsPage.tsx`
     - `/maritime/matrix` -> `MaritimeMatrixPage.tsx`
     - `/maritime/quotations` -> `MaritimeQuotationsPage.tsx`
     - `/maritime/jobs` -> `MaritimeJobsPage.tsx`
     - `/maritime/containers` -> `MaritimeContainersPage.tsx`
     - `/maritime/lines` & `/maritime/master` -> `MaritimeLinesPage.tsx`
   - **التوافق العكسي:** توجيه تلقائي من `/maritime?tab=xxx` إلى المسار النظيف.

### جدول التحقق والجاهزية
| المتطلب | الحالة | النسبة | التفاصيل |
| :--- | :---: | :---: | :--- |
| **تقسيم صفحات موديول المقاولات إلى Sub-Routes** | 🟢 | 100% | 9 صفحات فرعية مستقلة مع Lazy Loading وسياق مشروع مشترك |
| **تقسيم صفحات موديول الشحن البحري إلى Sub-Routes** | 🟢 | 100% | 6 صفحات فرعية مستقلة مع عدادات وإدارة حالة مستقلة |
| **تخفيف أحجام ملفات الصفحات الرئيسية** | 🟢 | 100% | تفتيت الملفات من 750 سطر إلى صفحات بمتوسط 60-120 سطر فقط |
| **التوافق العكسي التام (Backward Compatibility)** | 🟢 | 100% | دعم الروابط القديمة `?tab=...` والتحويل التلقائي السلس |
| **خلو تام من أخطاء TypeScript** | 🟢 | 100% | فحص مزدوج للباك إند والفرونت إند بـ 0 أخطاء |



---


<!-- migrated:cap-110:end -->

<a id="cap-127"></a>
<!-- migrated:cap-127:start -->
## 92. العزل القطاعي الشامل والتهيئة الذكية للمودات الـ 16 (Total Vertical Isolation & 16-Mode Industry Automation)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (Zero Leaks, Zero Emojis & Clean Enterprise SaaS).
* **مسارات الكود الأساسية:**
  - الفرونت إند: `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`, `frontend/src/features/settings/components/forms/tabs/SalesInventorySettingsTab.tsx`, `frontend/src/features/settings/components/forms/tabs/PrintingSettingsTab.tsx`, `frontend/src/shared/layout/app-shell.tsx`, `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`, `frontend/src/features/settings/schemas/settings.schema.ts`
  - الباك إند: `backend/src/modules/saas-admin/trial-tenant-provisioning.service.ts`
* **القدرات التشغيلية والمشكلات المعالجة:**
  1. **الشمولية الكاملة لكافة الأنشطة (16 Business Industry Modes):**
     - التغطية الفورية لـ 16 قطاعاً ونشاطاً تشغيلياً: نشاط تجاري عام، تجزئة ومحلات، سوبر ماركت ومواد غذائية، مطاعم ومأكولات، كافيهات ومقاهي، صيدليات وأدوية، إلكترونيات وأجهزة، صيانة وهواتف، عطارة ومحامص، عطور ومستحضرات، ملابس وموضة، شحن بحري ولوجستيات، مقاولات وإنشاءات، أجهزة كهربائية وتقسيط، استيراد وتصدير وتخليص جمركي، خدمات واستشارات وإدارة أعمال.
  2. **القضاء التام على تسريب إعدادات نقاط البيع (Zero-Leak POS Settings Gating):**
     - تم إغلاق وحجب كافة إعدادات نقاط البيع (`showPosSettings`) عن الأنشطة غير المعتمدة على الكاشير كالمقاولات والشحن والخدمات والاستيراد، وشمل ذلك: إقفال الوردية الإجباري، خيارات وسقف خصم الكاشير، رسوم التوصيل والدليفري، أجهزة نقاط البيع ومدفوعات البطاقات POS Terminals، وبرامج نقاط المكافآت والولاء.
  3. **عزل الرقابة المخزنية وتنبيهات الجرد للقطاع الخدمي:**
     - حجب إعدادات تنبيهات الجرد والحد الأدنى للنواقص (`showPhysicalInventory`) عن الشركات الاستشارية والخدمية التي لا تتعامل مع بضاعة ملموسة.
  4. **أقسام إعدادات متخصصة لكل قطاع استثماري:**
     - **المقاولات:** ضبط نسبة الدفعة المقدمة المستقطعة، ونسبة ضمان الأعمال المحتجز (Retention).
     - **الشحن واللوجستيات:** ضبط أيام السماح المجانية لتأخير الحاويات (Demurrage Free Days)، وتحديد عملة تسعير النولون الدولية القياسية.
     - **الاستيراد والتصدير:** أساس توزيع تكاليف الشحن والمصاريف الجمركية على الشحنات (قيمة / وزن / حجم)، والربط الآلي لمصروفات الاعتمادات المستندية.
     - **الخدمات والاستشارات:** نمط الفوترة المعتمد (دفعات إنجاز مراحل / اشتراكات مستمرة Retainer)، وتنبيهات تجديد العقود السنوية الدورية.
  5. **عزل إعدادات الطباعة والفواتير:**
     - حصر خيارات الطابعات الحرارية وإيصالات الكاشير وطابعات المطبخ KOT على أنشطة التجزئة والمطاعم، وضبط نوع الفاتورة الافتراضي للأنشطة الكبرى والخدمية على الورق الرسمي A4.
  6. **عزل القوائم الجانبية ومساحات العمل المستقلة (Dedicated Workspaces):**
     - تخصيص مساحات عمل منفصلة بالقائمة الجانبية والشريط السريع لكل نشاط (`isDedicatedContractingOnly`, `isDedicatedMaritimeOnly`, `isDedicatedImportOnly`, `isDedicatedServicesOnly`) مع حجب كافة الروابط الشاذة عن كل نشاط ليشعر كل عميل أن النظام صُمم خصيصاً له وحده.
  7. **الالتزام بالقاعدة 13 وتحويل كافة القوائم المنسدلة إلى CustomSelect:**
     - استبدال كافة عناصر `<select>` التقليدية في فورم الإعدادات ونافذة إنشاء الشركات التجريبية بالمكون الموحد `CustomSelect` لتحقيق تجربة مستخدم مؤسسية متسقة.
  8. **العزل الديناميكي لشريط وتبويبات الإعدادات العامة (Dynamic Settings Tabs Gating):**
     - **التجارة الإلكترونية والمنصات (`storefront` & `marketplaces`):** حجب التبويب بالكامل وتوجيه مساراته تلقائياً إذا لم يكن موديول المتجر الإلكتروني مفعلاً في إعدادات المنشأة أو باقة المستأجر (`storefrontModuleEnabled`).
     - **المراقبة ورصد السيرفر (`monitoring` - APM):** حصر التبويب بسوبر أدمن منصة الإدارة المركزية وحجبه عن كافة المستأجرين.
     - **الإصدارات والتحديثات والشبكة المحلية (`system-updates` & `lan-network`):** إخفاؤها تلقائياً على خوادم السحابة (Cloud VPS) وحصرها بالنسخ الأوفلاين المكتبية (`isDesktopOfflineApp`).

---


<!-- migrated:cap-127:end -->

<a id="cap-147"></a>
<!-- migrated:cap-147:start -->
## 112. معمارية العزل القطاعي الصارم، الأجنحة المتكاملة، وحصر التخصيص في التهيئة الأولى (All-Inclusive Pillars & Onboarding-Only Selection)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومعتمد ومفعل عبر بيئتي الساس السحابي (Cloud SaaS) والديسكتوب (Electron) بنفس الكود والمنطق الموحد.
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/core/tenant/industry-profiles.ts`: سجل الأنماط القطاعية المعياري، ترقية المقاولات والشحن لأجنحة متكاملة (All-Inclusive Full Suites)، وحساب الصلاحيات الموجهة قطاعياً (`resolvePillarScopedFeatures`).
  - `backend/src/core/auth/guards/permissions.guard.ts`: سد الثغرة الأمنية في فحص الميزات وتقديم التحقق من `@RequireFeature` سيادياً في الخادم قبل أي فحص للصلاحيات الفردية.
  - `backend/src/core/auth/services/plan-feature.service.ts`: إعفاء أجنحة المقاولات والشحن من قيود تجزئة الباقات وتفعيل كافة موديولاتها التشغيلية والمالية تلقائياً.
  - `backend/src/core/auth/services/session.service.ts`: ربط سياق الجلسة بـ `activityType` و `pillar` وإبطال الكاش اللحظي للمستأجرين.
  - `backend/src/modules/activation/activation.service.ts`: حفظ `activity_type` وتحديث جدول `tenants` أثناء التهيئة الأولى في بيئة الديسكتوب.
  - `frontend/src/app/router/post-login-route.ts`: التوجيه المباشر بعد تسجيل الدخول (Direct Pillar Landing) لقطاعي المقاولات والشحن لمنع أي قفز أو وميض تحميل وسيط.
  - `frontend/src/features/activation/components/onboarding/Step3Industry.tsx`: معالج التهيئة الأولي بنسخة الديسكتوب يدعم الركائز الثلاث الكبرى والتخصصات الفرعية الـ 5 بأيقونات SVG بريميوم (0 Emojis).
  - `frontend/src/features/activation/pages/SaaSOnboardingPage.tsx`: صفحة التهيئة الأولى لعملاء الساس، ربطها بدوال `settingsApi.setActivityProfile` وتوجيه مباشر للقطاع بعد الاعتماد.
  - `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`: تطهير صفحة الإعدادات العامة من كروت التبديل واستبدالها بوسم مؤسسي هادئ وقارئ فقط (Read-only Badge) يثبت النشاط المعتمد للمنشأة ويحمي القيود المحاسبية.
  - `frontend/src/shared/layout/app-shell.tsx`: التفعيل التلقائي الشامل في القائمة الجانبية (Suite Pass in App Shell) لإظهار مجموعات المشتريات ومخازن المواقع ومحاسبة المشاريع والعمالة فورياً دون حاجة لتخصيص يدوي.
* **المعايير والخصائص الهندسية المنفذة:**
  1. **الأجنحة المؤسسية الشاملة للمقاولات والشحن (All-Inclusive Full Suites):**
     - **قطاع المقاولات (`contracting`):** منظومة كاملة مفعّلة تلقائياً بدون أي قيود باقات (المشاريع، المقايسات BOQ، المستخلصات IPC، مقاولو الباطن، المشتريات، المستودعات، موردي الخامات، الحسابات، الأصول، الموارد البشرية، الضرائب والتقارير).
     - **قطاع الشحن واللوجستيات (`maritime_freight`):** منظومة كاملة مفعّلة تلقائياً (الخطوط، الموانئ، مقارنة النولون RFQ، أوامر التشغيل، الحاويات والغرامات، فواتير الشحن، الحسابات، الموارد البشرية، والضرائب).
     - **قطاع التجارة العامة (`commerce`):** هو القطاع الوحيد الخاضع لنظام الباقات المتدرجة (Basic / Pro / Ultimate) والتخصصات الفرعية الـ 5 (تجزئة، صيدليات FEFO، مطاعم KDS، تصنيع خفيف BOM، صيانة أجهزة IMEI).
  2. **حصر اختيار النمط في التهيئة الأولى وقفل الإعدادات مع تحكم السوبر أدمن السيادي:**
      - يختار العميل نمط ونشاط منشأته مرة واحدة فقط عند التهيئة الأولى للنظام (سواء ساس أو إلكترون).
      - بمجرد اكتمال الإعداد، يختفي اختيار النمط نهائياً من إعدادات النظام للعملاء العاديين منعاً لأي تلاعب بالقيود، ويكتفي النظام بعرض وسم مؤسسي توضيحي غير قابل للتعديل.
      - **صلاحية السوبر أدمن السيادية:** يتاح للسوبر أدمن حصرياً بطاقة تحكم نمط المنظومة (`IndustryModeSelectorCard`) في صفحة الإعدادات العامة، وشريط التخصيص السريع (`SmartModularQuickBar`)، حيث يتم تحديث هوية المنشأة في السيرفر (`tenants.activity_type`) وإعادة بناء القائمة الجانبية بالكامل فوراً وتلقائياً بما يطابق النشاط الجديد (مقاولات، شحن ولوجستيات، أو تجارة عامة) مع مزامنة سياق الجلسة وإبطال الكاشات.
  3. **الحراسة الأمنية السيادية في السيرفر (Ironclad Guard Order):**
      - تم إصلاح ترتيب التحقق في `PermissionsGuard` بحيث يتم فحص الميزة المطلوبة `@RequireFeature` أولاً وقبل التحقق من الصلاحيات وقبل أي `return true` مبكر، مما يمنع نهائياً أي وصول غير مصرح عبر الـ API.
  4. **التفعيل التلقائي التام في السايد بار (Zero-Manual-Toggle Policy for Suites):**
      - تم تحديث منطق القائمة الجانبية بحيث يرى عميل المقاولات حزم (المشتريات ومقاولو الباطن، المستودعات ومخازن المواقع، المحاسبة ومراكز التكلفة، الموارد البشرية والعمالة) مفعلة وجاهزة فورياً دون الحاجة للدخول لمتجر الموديولات أو تفعيل أي شيء يدوياً.

---


<!-- migrated:cap-147:end -->

<a id="cap-148"></a>
<!-- migrated:cap-148:start -->
## 113. متجر التطبيقات والموديولات المؤسسي المستقل (Enterprise Apps Store & Modular Grid Ecosystem)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis, Responsive Grid & Clean Enterprise SaaS).
* **مسارات وملفات التنفيذ الأساسية:**
  - واجهة المتجر الرئيسية: `frontend/src/features/apps-store/pages/AppsStorePage.tsx`
  - كتالوج التطبيقات والبيانات التعريفية: `frontend/src/features/apps-store/data/apps-catalog.ts`
  - بطاقات التطبيقات التفاعلية: `frontend/src/features/apps-store/components/AppCard.tsx`
  - الترويسة الإحصائية للمتجر: `frontend/src/features/apps-store/components/AppsKpiHeader.tsx`
  - نافذة ترقية الباقات التلقائية: `frontend/src/features/apps-store/components/AppUpgradeModal.tsx`
  - توجيه المسار وموديول الراوتر: `frontend/src/features/apps-store/routes.tsx`, `frontend/src/app/router/registry.ts`, `frontend/src/app/router/root-router.tsx`
  - القائمة الجانبية والصلاحيات: `frontend/src/shared/layout/app-shell.tsx`, `frontend/src/app/router/access.ts`
  - تبويب الإعدادات العامة: `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`, `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`
* **القدرات التشغيلية والمشكلات المعالجة:**
  1. **التحول إلى عقلية المنصة السحابية (Odoo & Shopify Ecosystem Standard):**
     - تم تحويل مفهوم "موديولات النظام" من مجرد قائمة إعدادات تقليدية وخانات اختيار (Checkboxes) متكدسة، إلى **«متجر التطبيقات» (Apps Store)** متكامل ومستقل بمسار رسمي `/apps`.
  2. **شبكة الجريد العصرية المتجاوبة (Modern Apps Grid Layout):**
     - بطاقات متوازنة هندسياً داخل حاوية الـ 1280px القياسية تعرض 22 تطبيقاً مع أيقونات SVG بريميوم مؤسسية وشارات الفئات (مبيعات، مخازن، مالية، مقاولات، شحن، تصنيع، خدمات، لوجستيات).
     - شارات الحالة الثلاثية: [مُثبت ونشط]، [متاح للتثبيت]، و[يتطلب ترقية الباقة] مع قفل الأمان واسم الباقة المحددة.
  3. **التثبيت والإلغاء الفوري (Instant Real-time Toggle):**
     - إمكانية تفعيل أو إلغاء تثبيت أي تطبيق بضغطة زر واحدة مع تأكيد الأمان (`systemConfirm`) ومنع التعطيل العرضي للتطبيقات الحيوية، وتحديث القوائم الجانبية فورياً بدون إعادة تحميل الصفحة.
     - معالجة التبعيات التشغيلية (Dependencies Resolution) آلياً قبل التفعيل.
  4. **محرك ترقية الاشتراكات الذاتي (Upselling & Subscription Engine):**
     - التطبيقات التي تتجاوز باقة المستأجر الحالية تعرض زر "ترقية الباقة" الذي يفتح نافذة مواصفات التطبيق ومميزاته ورابطاً مباشراً لصفحة الاشتراكات والترقية.
  5. **شريط البحث والتصنيف اللحظي والمؤشرات (KPIs & Filters):**
     - 9 تبويبات تصفية سريعة مع عداد لحظي لكل تصنيف، وشريط بحث فوري يطابق اسم التطبيق، وصفه، وفئته ومميزاته، مع شريط إحصائيات علوي يرصد إجمالي التطبيقات والمفعل منها والمتاح.

---


<!-- migrated:cap-148:end -->

<a id="cap-149"></a>
<!-- migrated:cap-149:start -->
## 114. التفعيل التلقائي الشامل ومزامنة خانات الاختيار للأجنحة التخصصية (All-Inclusive Suites Checkbox & State Synchronization)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`: مزامنة خانات الاختيار (Checkboxes) لقطاعي المقاولات والشحن، إظهار الشارات التوضيحية الدقيقة ("مفعل تلقائياً للخطوط الملاحية ومصاريف الشحن"، "مفعل تلقائياً لمستودعات ومخازن المواقع"، "الموديول السيادي الأساسي للنشاط"، "معطل تلقائياً")، مع لافتة مؤسسية علوية للباقة الشاملة.
  - `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`: مزامنة قيم الموديولات عند تهيئة وتحميل النموذج (`form.reset`) وعند حفظ الإعدادات (`onSubmit`) لضمان عدم إرجاع أي موديول إلى false عند حفظ بيانات المؤسسة.
  - `frontend/src/features/settings/contracts.ts`: ضمان حراسة مصفوفة باقة المقاولات وباقة الشحن في دالة `toSettingsPayload` لتحويل المدخلات إلى السيرفر بحالة مفعلة دائماً.
  - `frontend/src/features/settings/components/modular-configurator/modular-presets.ts`: ضبط قوالب الشحن واللوجستيات والمقاولات لتشمل كافة موديولات الحزمة التشغيلية (الأصول الثابتة، الضرائب، المشتريات، الموارد البشرية).
  - `frontend/src/shared/layout/app-shell.tsx`: معالجة ترتيب المتغيرات في `sidebarGroups` ومنع أي خطأ TDZ، مع التفعيل التلقائي لكافة بنود القائمة لقطاعي المقاولات والشحن بدون أي قيود باقات تجارية.
  - `backend/src/modules/settings/settings.service.ts`: ترقية دوال `getSettings` و `updateSettings` و `setActivityProfile` لحفظ وإرجاع حزم الموديولات كاملة للمنشآت في قطاعي المقاولات والشحن تلقائياً.
* **القدرات التشغيلية المعتمدة:**
  1. **التوافق التام بين شاشات السايدبار وإعدادات الموديولات:**
     - أصبح العميل في مود المقاولات أو الشحن يرى الموديولات التابعة لنشاطه محددة بوضوح ومعلّمة كـ `checked` (مفعلة) داخل تبويب إعدادات الموديولات (`ModulesSettingsTab`)، ومصحوبة بشارات توضيحية خضراء تؤكد تفعيلها كجزء من الجناح الشامل.
  2. **باقة الشحن واللوجستيات المتكاملة (`maritime_freight`):**
     - تفعيل: موديول الشحن، فواتير وعروض أسعار العملاء (Sales & CRM)، الخطوط الملاحية والموردين ومصروفات الشحن (Purchases)، المالية ومحاسبة الشحن ومراكز التكلفة (Accounting & Cost Centers)، الموارد البشرية (HR)، الأصول الثابتة (Fixed Assets)، والإقرار الضريبي (Tax).
     - تعطيل تلقائي: نقاط البيع السريعة للتجزئة (POS) والمخزون السلعي للرفوف (Store Inventory) لعدم مناسبتها لطبيعة نشاط الشحن الخدمي واللوجستي المبني على الحاويات وأوامر التشغيل.
  3. **باقة المقاولات المتكاملة (`contracting`):**
     - تفعيل: موديول المقاولات، المشاريع، المقايسات، المستخلصات، مقاولو الباطن ومشتريات الخامات، مستودعات المواقع والتشوينات، محاسبة المشاريع ومراكز التكلفة، عمالة ومهندسو المشاريع (HR)، الأصول والمعدات، والضرائب.
     - تعطيل تلقائي: نقاط البيع السريعة للتجزئة (POS).
  4. **الحفظ والاسترجاع الآمن دون تضارب:**
     - أي عملية حفظ للإعدادات (`Save Settings`) عبر النموذج أو الـ API تحافظ بدقة على تفعيل هذه الموديولات وتمنع أي محاولة لتعطيلها أو تصفيرها.


---


<!-- migrated:cap-149:end -->

<a id="cap-150"></a>
<!-- migrated:cap-150:start -->
## 115. العزل والتوجيه الذكي للموديولات ومتجر التطبيقات بحسب النشاط المؤسسي (Context-Scoped Modules & Apps Isolation)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومفعل عبر كافة واجهات النظام (Settings & Apps Store).
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`: العزل الصارم لخانات الموديولات وإخفاء موديولات التجزئة والتجارة عن المقاولات والشحن، وحجب أشرطة التبديل العشوائية.
  - `frontend/src/features/apps-store/pages/AppsStorePage.tsx`: فلترة كتالوج متجر التطبيقات (`visibleCatalog`), إخفاء التصنيفات الفارغة (`availableCategories`), وإبراز لافتات الباقة الشاملة.
  - `frontend/src/features/apps-store/components/AppCard.tsx`: حماية الموديولات الأساسية للباقة الشاملة (`isCoreSuiteApp`) وإظهار شارة "أساسي في الباقة الشاملة" ومنع إلغاء تثبيتها.
* **المعايير والخصائص الهندسية المنفذة:**
  1. **التطهير والعزل القطاعي الصارم في شاشة إعدادات الموديولات (`ModulesSettingsTab`):**
     - **في مود المقاولات (`contracting`):** يرى العميل حصرياً الموديولات المكملة لقطاعه (المقاولات، المستودعات ومخازن المواقع، المشتريات ومقاولو الباطن، الحسابات، الأصول، الموارد البشرية، الضرائب). يتم إخفاء كافة موديولات التجزئة تماماً (نقاط البيع POS، الصيدليات FEFO، المطاعم KDS، صيانة الأجهزة IMEI، الملابس والمقاسات، باركود الميزان، المجموعات، الاستيراد، المتجر الإلكتروني، والأقساط وأسطول التوصيل).
     - **في مود الشحن والتوكيلات الملاحية (`maritime_freight`):** يرى العميل حصرياً موديولات الشحن واللوجستيات والخطوط الملاحية والمشتريات والحسابات والموارد البشرية والأصول والضرائب. يتم إخفاء التجزئة بالكامل والمخزون السلعي للرفوف لتناسب طبيعة النولون والحاويات.
     - **إخفاء شريط التبديل السريع (`SmartModularQuickBar`):** إخفاء شريط تغيير الباقات عن المستأجر في مود المقاولات والشحن، لمنع أي خروج أو عبث بتكوين الباقة المتكاملة، مع إبقائه متاحاً للسوبر أدمن فقط.
  2. **الفلترة الذكية واللافتات التوضيحية في متجر التطبيقات (`AppsStorePage`):**
     - حصر الكتالوج المعروض على التطبيقات التابعة لنشاط المنشأة فقط (`visibleCatalog`), وحساب مؤشرات المتجر العلوية (Total Apps, Active, Available) بناءً على الكتالوج المخصص فقط.
     - إخفاء تبويبات التصنيفات التي لا تحتوي على أي تطبيقات في سياق العميل تلقائياً لمنع أي أزرار فارغة.
     - عرض لافتة مؤسسية بريميوم توضح مزايا "باقة المقاولات الشاملة" أو "باقة الشحن واللوجستيات الشاملة" مع أيقونات SVG متخصصة ودون أي إيموجيز.
  3. **حماية الموديولات السيادية من التعطيل العرضي (`isCoreSuiteApp`):**
     - استبدال زر "إلغاء التثبيت" بشارة مؤسسية خضراء أنيقة `أساسي في الباقة الشاملة` للموديولات التخصصية في قطاعي المقاولات والشحن.
     - حظر طلبات الإلغاء في الواجهة والـ API مع إشعار تحذيري محكم إذا حاول المستخدم إيقاف موديول محوري لنشاطه.
     - **تحكم يدوي كلاسيكي (Manual Control):** تحكم يدوي في كل إجراء وزر.
  2. **محرك هوامش الربح الآلي (Autonomous Margin & Markup Engine):**
     - دعم كامل لهامش المبلغ المقطوع الثابت ($/TEU) أو النسبة المئوية المضافة (%)، مع حد أدنى للأمان الربحي (Margin Floor) لمنع أي بيع بخسارة.
  3. **مؤقت المهل الزمنية والترسية المبكرة (Cut-off Timers & Early Awarding):**
     - تحديد مهلة الردود تلقائياً للشحنات العادية (24 ساعة) والعاجلة (6 ساعات) مع عداد حي في تبويب المصفوفة.
     - دعم الترسية الفورية المبكرة إذا قدم أي خط ملاحي معتمد سعراً يقل عن سقف العميل المستهدف مع 14 يوماً سماح دون انتظار انقضاء الساعات.
  4. **مصفوفة محطات التوقف والمراجعة البشرية (Human-in-the-Loop Checkpoints):**
     - إمكانية تفعيل أو تعطيل التوقف البشري في أي مرحلة من المراحل الأربع (إرسال الـ RFQ، اعتماد الهامش والترسية، وإرسال العرض النهائي للعميل).

---


<!-- migrated:cap-150:end -->

<a id="cap-152"></a>
<!-- migrated:cap-152:start -->
## 114. التفعيل التلقائي الشامل ومزامنة خانات الاختيار للأجنحة التخصصية (All-Inclusive Suites Checkbox & State Synchronization)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`: مزامنة خانات الاختيار (Checkboxes) لقطاعي المقاولات والشحن، إظهار الشارات التوضيحية الدقيقة ("مفعل تلقائياً للخطوط الملاحية ومصاريف الشحن"، "مفعل تلقائياً لمستودعات ومخازن المواقع"، "الموديول السيادي الأساسي للنشاط"، "معطل تلقائياً"), مع لافتة مؤسسية علوية للباقة الشاملة.
  - `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`: مزامنة قيم الموديولات عند تهيئة وتحميل النموذج (`form.reset`) وعند حفظ الإعدادات (`onSubmit`) لضمان عدم إرجاع أي موديول إلى false عند حفظ بيانات المؤسسة.
  - `frontend/src/features/settings/contracts.ts`: ضمان حراسة مصفوفة باقة المقاولات وباقة الشحن في دالة `toSettingsPayload` لتحويل المدخلات إلى السيرفر بحالة مفعلة دائماً.
  - `frontend/src/features/settings/components/modular-configurator/modular-presets.ts`: ضبط قوالب الشحن واللوجستيات والمقاولات لتشمل كافة موديولات الحزمة التشغيلية (الأصول الثابتة، الضرائب، المشتريات، الموارد البشرية).
  - `frontend/src/shared/layout/app-shell.tsx`: معالجة ترتيب المتغيرات في `sidebarGroups` ومنع أي خطأ TDZ، مع التفعيل التلقائي لكافة بنود القائمة لقطاعي المقاولات والشحن بدون أي قيود باقات تجارية.
  - `backend/src/modules/settings/settings.service.ts`: ترقية دوال `getSettings` و `updateSettings` و `setActivityProfile` لحفظ وإرجاع حزم الموديولات كاملة للمنشآت في قطاعي المقاولات والشحن تلقائياً.
* **القدرات التشغيلية المعتمدة:**
  1. **التوافق التام بين شاشات السايدبار وإعدادات الموديولات:**
     - أصبح العميل في مود المقاولات أو الشحن يرى الموديولات التابعة لنشاطه محددة بوضوح ومعلّمة كـ `checked` (مفعلة) داخل تبويب إعدادات الموديولات (`ModulesSettingsTab`)، ومصحوبة بشارات توضيحية خضراء تؤكد تفعيلها كجزء من الجناح الشامل.
  2. **باقة الشحن واللوجستيات المتكاملة (`maritime_freight`):**
     - تفعيل: موديول الشحن، فواتير وعروض أسعار العملاء (Sales & CRM)، الخطوط الملاحية والموردين ومصروفات الشحن (Purchases), المالية ومحاسبة الشحن ومراكز التكلفة (Accounting & Cost Centers)، الموارد البشرية (HR)، الأصول الثابتة (Fixed Assets)، والإقرار الضريبي (Tax).
     - تعطيل تلقائي: نقاط البيع السريعة للتجزئة (POS) والمخزون السلعي للرفوف (Store Inventory) لعدم مناسبتها لطبيعة نشاط الشحن الخدمي واللوجستي المبني على الحاويات وأوامر التشغيل.
  3. **باقة المقاولات المتكاملة (`contracting`):**
     - تفعيل: موديول المقاولات، المشاريع، المقايسات، المستخلصات، مقاولو الباطن ومشتريات الخامات، مستودعات المواقع والتشوينات، محاسبة المشاريع ومراكز التكلفة، عمالة ومهندسو المشاريع (HR)، الأصول والمعدات، والضرائب.
     - تعطيل تلقائي: نقاط البيع السريعة للتجزئة (POS).
  4. **الحفظ والاسترجاع الآمن دون تضارب:**
     - أي عملية حفظ للإعدادات (`Save Settings`) عبر النموذج أو الـ API تحافظ بدقة على تفعيل هذه الموديولات وتمنع أي محاولة لتعطيلها أو تصفيرها.


---


<!-- migrated:cap-152:end -->

<a id="cap-153"></a>
<!-- migrated:cap-153:start -->
## 115. العزل والتوجيه الذكي للموديولات ومتجر التطبيقات بحسب النشاط المؤسسي (Context-Scoped Modules & Apps Isolation)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومفعل عبر كافة واجهات النظام (Settings & Apps Store).
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`: العزل الصارم لخانات الموديولات وإخفاء موديولات التجزئة والتجارة عن المقاولات والشحن، وحجب أشرطة التبديل العشوائية.
  - `frontend/src/features/apps-store/pages/AppsStorePage.tsx`: فلترة كتالوج متجر التطبيقات (`visibleCatalog`), إخفاء التصنيفات الفارغة (`availableCategories`), وإبراز لافتات الباقة الشاملة.
  - `frontend/src/features/apps-store/components/AppCard.tsx`: حماية الموديولات الأساسية للباقة الشاملة (`isCoreSuiteApp`) وإظهار شارة "أساسي في الباقة الشاملة" ومنع إلغاء تثبيتها.
* **المعايير والخصائص الهندسية المنفذة:**
  1. **التطهير والعزل القطاعي الصارم في شاشة إعدادات الموديولات (`ModulesSettingsTab`):**
     - **في مود المقاولات (`contracting`):** يرى العميل حصرياً الموديولات المكملة لقطاعه (المقاولات، المستودعات ومخازن المواقع، المشتريات ومقاولو الباطن، الحسابات، الأصول، الموارد البشرية، الضرائب). يتم إخفاء كافة موديولات التجزئة تماماً (نقاط البيع POS، الصيدليات FEFO، المطاعم KDS، صيانة الأجهزة IMEI، الملابس والمقاسات، باركود الميزان، المجموعات، الاستيراد، المتجر الإلكتروني، والأقساط وأسطول التوصيل).
     - **في مود الشحن والتوكيلات الملاحية (`maritime_freight`):** يرى العميل حصرياً موديولات الشحن واللوجستيات والخطوط الملاحية والمشتريات والحسابات والموارد البشرية والأصول والضرائب. يتم إخفاء التجزئة بالكامل والمخزون السلعي للرفوف لتناسب طبيعة النولون والحاويات.
     - **إخفاء شريط التبديل السريع (`SmartModularQuickBar`):** إخفاء شريط تغيير الباقات عن المستأجر في مود المقاولات والشحن، لمنع أي خروج أو عبث بتكوين الباقة المتكاملة، مع إبقائه متاحاً للسوبر أدمن فقط.
  2. **الفلترة الذكية واللافتات التوضيحية في متجر التطبيقات (`AppsStorePage`):**
     - حصر الكتالوج المعروض على التطبيقات التابعة لنشاط المنشأة فقط (`visibleCatalog`), وحساب مؤشرات المتجر العلوية (Total Apps, Active, Available) بناءً على الكتالوج المخصص فقط.
     - إخفاء تبويبات التصنيفات التي لا تحتوي على أي تطبيقات في سياق العميل تلقائياً لمنع أي أزرار فارغة.
     - عرض لافتة مؤسسية بريميوم توضح مزايا "باقة المقاولات الشاملة" أو "باقة الشحن واللوجستيات الشاملة" مع أيقونات SVG متخصصة ودون أي إيموجيز.
  3. **حماية الموديولات السيادية من التعطيل العرضي (`isCoreSuiteApp`):**
     - استبدال زر "إلغاء التثبيت" بشارة مؤسسية خضراء أنيقة `أساسي في الباقة الشاملة` للموديولات التخصصية في قطاعي المقاولات والشحن.
     - حظر طلبات الإلغاء في الواجهة والـ API مع إشعار تحذيري محكم إذا حاول المستخدم إيقاف موديول محوري لنشاطه.
  4. **صلاحيات السوبر أدمن الكاملة (Platform Super Admin Sovereignty):**
      - مستخدم السوبر أدمن لمنصة الإدارة المركزية (`zs` / `super_admin`) يمتلك الرؤية الشاملة لكافة الـ 22+ تطبيقاً وموديولاً مع إمكانية التبديل والتخصيص والتحكم دون قيود.

---

### 116. تفعيل موديول إدارة علاقات العملاء والصفقات (CRM) وتكامله الشامل مع كافة الأنشطة المؤسسية والتحويل القطاعي
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومفعل عبر كافة القطاعات الخدمية والمؤسسية (المقاولات، الشحن، التصنيع، الاستيراد، والخدمات) ومنظومة الصلاحيات.
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/modules/crm`: `crm.controller.ts`, `crm.service.ts`, جداول `crm_deals` و `crm_activities`.
  - `backend/src/core/tenant/industry-profiles.ts`: إضافة `'crm'`, `'sales'`, `'customers'` إلى `defaultFeatures` لقطاعات المقاولات (`contracting`)، الشحن البحري واللوجستيات (`maritime_freight`)، والتصنيع (`manufacturing`).
  - `backend/src/core/auth/constants/super-admin-permissions.ts`: إضافة صلاحية `'crm'` إلى مصفوفة صلاحيات السوبر أدمن التلقائية.
  - `backend/src/modules/settings/settings.service.ts`: تمكين السوبر أدمن من تغيير نشاط المنشأة (`tenants.activity_type` و `pillar`) ومواءمة موديولات الحزمة تلقائياً.
  - `frontend/src/app/router/access.ts`: ربط صلاحيات مسار `/crm` بالصلاحيات التشغيلية (`['sales', 'customers', 'crm', 'contracting', 'maritime_freight']`) وإلغاء متطلبات الباقات التجارية المقيدة (`routeFeatureMap = null`).
  - `frontend/src/shared/layout/app-shell.tsx`:
    - تعميم ظهور الـ CRM لكافة قطاعات الأعمال المؤسسية (`isContractingVertical`, `isMaritimeVertical`, `isImportVertical`, `isManufacturingVertical`, `isServicesVertical`).
    - إضافة مجموعة «العملاء والصفقات» (`crm-group` مع عنصري `crm` و `customers`) في السايدبار المخصص لقطاع المقاولات.
    - رفع استثناء الـ CRM من فلتر العزل الرأسي لقطاع المقاولات (`isContractingVertical`).
    - تضمين `crm` في مصفوفة الترتيب التنفيذي لقوائم المقاولات (`contractingOrder`).
    - تثبيت مجموعة «العملاء وعروض الأسعار» لقطاع الشحن واللوجستيات مع مسار الـ CRM ومطابقة أيقونة الـ SVG الرسمية.
  - `frontend/src/shared/components/GlobalSearchModal.tsx`: رفع استثناءات الـ CRM والأصناف من البحث السريع في بيئة المقاولات.
  - `frontend/src/features/apps-store/data/apps-catalog.tsx`: تسجيل تطبيق «إدارة علاقات العملاء والصفقات (CRM)» بأيقونة SVG بريميوم مؤسسية ومميزات مسار الصفقات كانبان وتسجيل الأنشطة وتتبع الاحتمالات المالية.
  - `frontend/src/features/settings/components/user-management.shared.ts`: إدراج موديول الـ CRM في مصفوفات الصلاحيات الافتراضية للمدير والمشغل وتسميات الصلاحيات العربية.
* **القدرات التشغيلية المعتمدة:**
  1. **مسار خط الصفقات التفاعلي (CRM Deals Pipeline & Kanban):**
     - لوحة كانبان متكاملة لمتابعة الصفقات من مرحلة التواصل الأولي حتى التعاقد والإغلاق (مع التقييم المالي، احتمالية الفوز، وربطها بالعميل وسجل الأنشطة).
  2. **التكامل الفوري مع المقاولات والشحن والتصنيع:**
     - متابعة مناقصات ومقايسات المقاولات وعقود التوريد الصناعية وعروض النولون اللوجستية قبل إصدار أوامر التشغيل.
  3. **التحويل القطاعي الفوري للسوبر أدمن (Instant Vertical Switch):**
     - تمكين السوبر أدمن من تغيير نشاط أي منشأة بين المقاولات أو الشحن أو التجارة مع تحديث فوري لقاعدة البيانات وقراءة الجلسة وإعادة بناء القائمة الجانبية في 0ms.

---

### 117. منظومة الربط الذكي للمدفوعات وسندات القبض بالشحنات الملاحية وسداد الشحنة من الرصيد الدائن المتاح (Smart Freight Payment Allocation & Advance Balance Settle)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% (Production Ready)
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/database/migrations/2040000000091_maritime_job_payment_tracking.ts`: إضافة أعمدة تتبع السداد (`client_paid_total`, `payment_status`, `paid_at`) لجدول `maritime_jobs`، وحقل `job_id` لجدول `customer_payments`.
  - `backend/src/database/database.types.ts`: مواءمة واجهات Kysely لـ `MaritimeJobTable` و `CustomerPaymentTable`.
  - `backend/src/modules/purchases/services/purchases-write.service.ts`:
    - دعم حقل `jobId` الاختياري في سند القبض وتوجيه السداد للشحنة فورياً.
    - خاصية المطابقة والتسوية الآلية (Zero-Click Auto-Match): إذا كان لدى العميل شحنة نشطة وحيدة غير مسددة، يربط النظام سند القبض بها تلقائياً ويحدث حالتها ويسجل حدث السداد في المعالم DCSA دون تدخل الموظف.
  - `backend/src/modules/maritime-freight/maritime-freight.service.ts` & `maritime-freight.controller.ts`:
    - دالة `settleJobFromCustomerBalance`: تسوية وخصم نولون الشحنة من رصيد العميل الدائن المتاح مع تحديث كشف الحساب والقيود وإلغاء حظر أذونات التسليم.
    - دالة `getCustomerActiveJobs`: جلب أوامر التشغيل المفتوحة للعميل مع المبالغ المفوترة والمسددة والمستحقة.
    - تحديث `getJobById` لإرجاع `customerBalance` و `customerAvailableCredit` لحظياً مع بيانات الشحنة.
  - `frontend/src/features/maritime-freight/api/maritime-freight.api.ts`: دوال الاستدعاء `settleJobFromBalance` و `getCustomerActiveJobs` والحقول المحدثة.
  - `frontend/src/features/maritime-freight/components/JobDetailsModal.tsx`:
    - عرض بطاقة الموقف المالي وحالة السداد (مسددة بالكامل / مسددة جزئياً / غير مسددة) في تبويبي النظرة العامة والحسابات.
    - لافتة الرصيد الدائن المتاح للعميل وزر الإجراء المباشر `[سداد الشحنة من الرصيد المتاح]` لتسوية الشحنة بضغطة زر وتحديث الصفحة لحظياً.
  - `frontend/src/features/maritime-freight/components/MaritimeJobsTab.tsx`: شارة حالة السداد (Payment Status) المدمجة مع إذن التسليم في جدول الشحنات.
  - `frontend/src/features/accounts/components/PaymentForms.tsx`:
    - قائمة منسدلة ذكية لجلب شحنات العميل المفتوحة ومبالغها المستحقة واختيار التخصيص لشحنة محددة أو التسوية على الحساب العام.
* **القدرات التشغيلية المعتمدة:**
  1. **التسوية الذكية بنقرة واحدة (One-Click Settle from Balance):**
     - تمكين مسؤولي الشحن والعمليات من سداد أي شحنة خصماً من الرصيد الدائن المتاح للعميل دون الحاجة لتسجيل سند قبض مكرر.
  2. **المطابقة الآلية التلقائية (Auto-Match):**
     - عند سداد دفعة مقدمة لعميل لديه شحنة واحدة نشطة فقط، يتم سداد الشحنة وفك احتجاز أذونات التسليم آلياً.
  3. **التخصيص المباشر في سند القبض:**
     - تمكين المحاسبين من ربط سند القبض بشحنة معينة بالاسم ورقم البوليصة من واقع القائمة المنسدلة في شاشة الحسابات.

---

### 118. الاستخراج والتحليل الذكي لبيانات الحجز الملاحي من إيميلات الخطوط العالمية (Smart Carrier Booking Confirmation Parser & 1-Click Verification)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% (Production Ready) ومطابق لمعايير DCSA و 0 Emojis.
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/modules/maritime-freight/maritime-freight.service.ts`:
    - دالة `parseCarrierBookingText`: محرك فحص نصوص متقدم يستخرج آلياً اسم الخط الملاحي (Maersk, MSC, CMA CGM, Hapag-Lloyd, Cosco, Evergreen, ONE, Yang Ming, ZIM, Wan Hai)، ورقم الحجز الملاحي (Booking Reference)، واسم السفينة ورقم الرحلة (Vessel & Voyage)، ومواعيد الإبحار والوصول (ETD & ETA)، وموعد إغلاق الميناء (Port Cut-Off)، ورقم بوليصة الشحن (MBL)، وأرقام الحاويات القياسية (ISO 6346 Containers).
  - `backend/src/modules/maritime-freight/maritime-freight.controller.ts`:
    - نقطة وصول سحابية `POST /api/maritime-freight/jobs/parse-booking-text`.
  - `backend/test/test-logistics-lifecycle.ts`:
    - اختبار عملي شامل وتكاملي يختبر الاستخراج من نص إيميل حقيقي، وفتح الشحنة، وتسوية المدفوعات، وتتبع كافة معالم DCSA التسعة حتى إغلاق الشحنة بنجاح 100%.
  - `frontend/src/features/maritime-freight/api/maritime-freight.api.ts`:
    - دالة `parseBookingText` للاتصال بالمحلل واستخراج الحقول المنظمة.
  - `frontend/src/features/maritime-freight/components/JobDetailsModal.tsx`:
    - زر إجراء علوي `[استخراج ذكي من إيميل الحجز]` في شريط أدوات تفاصيل الرحلة والبوالص.
    - نافذة منبثقة مؤسسية موحدة `StandardDialog` مخصصة للصق محتوى الإيميل أو إشعار الحجز مع معاينة تفاعلية فورية لنتائج الاستخراج داخل بطاقات بريميوم مؤسسية.
    - زر اعتماد وتحديث فوري للشحنة والحاويات بنقرة واحدة دون أي أخطاء إدخال يدوي.
* **القدرات التشغيلية المعتمدة:**
  1. **التعرف الآلي على الخطوط الملاحية العالمية:**
     - كشف تلقائي للخط الناقل استناداً لاسم الخط ومطابقة النصوص، مع ضبط مسار الشحنة.
  2. **الاستخراج الدقيق للمواعيد وأرقام الحاويات:**
     - استخراج تواريخ الإبحار والوصول والـ Cut-Off وتحويلها إلى التنسيق القياسي (ISO)، واستخراج أرقام الحاويات ISO 6346 وإدراجها كحاويات مخصصة للشحنة مباشرة.
  3. **الحوكمة البشرية والمراجعة السريعة (Human-in-the-Loop):**
     - معاينة بصرية للمعلومات المستخرجة قبل الاعتماد النهائي لمنع أي التباس وضمان دقة السجلات الملاحية.

---

### 119. إغلاق الثغرات التشغيلية والمالية لموديول المقاولات وإدارة المشاريع (Construction Lifecycle Loophole Closure & Real-world Workflows)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% (Production Ready) ومطابق لمعايير Z-Systems البصرية و 0 Emojis وحظر النوافذ والتنبيهات البدائية.
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/database/migrations/2040000000092_contracting_wir_and_handover_workflows.ts`: إنشاء جداول ضبط الجودة والفحص `contracting_inspection_requests`، قائمة الملاحظات والتسليمات `contracting_snag_items`، ومحاضر الاستلام `contracting_project_handovers`، وتوسيع جدول الفواتير `contracting_invoices` بحقل `subcontract_id`.
  - `backend/src/database/database.types.ts`: إضافة الواجهات الصارمة لجداول الفحص والملاحظات والاستلام وتوسيع جدول مستخلصات وفواتير المقاولات.
  - `backend/src/modules/contracting/contracting.types.ts`: تعريف النماذج البرمجية لـ `ContractingInspectionRequest`, `ContractingSnagItem`, `ContractingProjectHandover`, و `ContractingProjectCostBreakdown`.
  - `backend/src/modules/contracting/dto/contracting.dto.ts`: إضافة الـ DTOs للتحقق من طلبات الفحص وتحديث حالتها، قائمة الملاحظات وإغلاق العيوب، ومحاضر الاستلام الابتدائي والنهائي، وتحديث `CreateIpcInvoiceDto` لدعم عقود مقاولي الباطن.
  - `backend/src/modules/contracting/contracting.service.ts`:
    - إضافة وتوجيه القيود المحاسبية المزدوجة لمستخلصات مقاولي الباطن (Subcontractor IPCs) لتسجيل الالتزام بحساب الموردين/المقاولين (AP) وخصم تأمين الأعمال المحتجز (Retention Payable) بدلاً من توجيه الإيراد.
    - دعم حصر ومتابعة التزامات عقود الباطن، المفوتر منها، والمتبقي بدقة متناهية.
    - إضافة محرك التحليل الخماسي للتكاليف الفعلية للمشروع (`getProjectCostBreakdown`) شاملاً: المواد والخامات، العمالة الذاتية، مقاولي الباطن، المعدات والتجهيز، والعهد والمصروفات النثرية ومقارنتها بالميزانية التقديرية وانحرافات التكلفة.
    - إدارة دورة طلبات استلام الأعمال WIR (تقديم الطلب، المراجعة الاستشارية، المعاينة، الملاحظات والاعتماد).
    - إدارة دورة عيوب وملاحظات التسليم Punch List (تسجيل العيب، الأولوية، تحديد المسؤول، الإصلاح، وإغلاق الملاحظة).
    - إدارة محاضر الاستلام الابتدائي والنهائي وإطلاق نسب محجوز الضمان (Release 50% / 100% Retention).
  - `backend/src/modules/contracting/contracting.controller.ts`: إضافة نقاط النهاية السحابية لـ WIR (نقطة 30)، Punch List (نقطة 31)، محاضر الاستلام (نقطة 32)، والتحليل الخماسي للتكاليف (نقطة 29).
  - `frontend/src/features/contracting/contracting.types.ts` & `contracting.api.ts`: مواءمة واجهات البيانات ودوال استدعاء الـ API الكاملة.
  - `frontend/src/features/contracting/components/CreateIpcInvoiceModal.tsx`: دعم مستخلص مقاول الباطن التفاعلي، واختيار عقد الباطن، وعرض بطاقة الموقف المالي للعقد وقيمة المتبقي ونسبة وتأمين الأعمال تلقائياً.
  - `frontend/src/features/contracting/components/ContractingSubcontractsTab.tsx`: بطاقات KPI مالية لإجمالي التزامات الباطن والمنجز والمتبقي، وزر إصدار مستخلص باطن مباشر لكل عقد بنقرة واحدة.
  - `frontend/src/features/contracting/components/WorkInspectionModal.tsx`: نافذة موحدة `StandardDialog` لطلبات فحص واستلام الأعمال WIR ومتابعة توقيعات الاستشاري قبل صب الخرسانات أو اعتماد البنود.
  - `frontend/src/features/contracting/components/SnagListModal.tsx`: نافذة موحدة لإدارة قائمة الملاحظات وعيوب المصنعية وتتبع المعالجة الميدانية.
  - `frontend/src/features/contracting/components/ProjectHandoverModal.tsx`: نافذة محاضر الاستلام الابتدائي والنهائي وإطلاق محجوز الضمان وفترة الضمان العشري/التشغيلي.
  - `frontend/src/features/contracting/components/ProjectCostBreakdownModal.tsx`: نافذة تفصيلية للتحليل الخماسي للتكاليف التشغيلية للمشروع ومؤشرات أداء التكلفة الفورية.
  - `frontend/src/features/contracting/pages/ContractingFieldPage.tsx` & `ContractingFinancialsPage.tsx`: دمج أزرار الإجراءات السريعة ومودالات العمل الميداني والمالي في شريط الأدوات الرئيسي.
  - تطهير موديول المقاولات بالكامل من النوافذ البدائية (`window.alert`, `window.confirm`) واستبدالها حصرياً بـ `toast` و `systemConfirm` القياسية.
* **القدرات التشغيلية المعتمدة:**
  1. **إغلاق حلقة مقاولي الباطن (Subcontractor IPC Lifecycle):**
     - تمكين مقاولي الباطن من تقديم مستخلصات دورية، مع احتجاز نسب تأمين الأعمال آلياً، والترحيل المحاسبي الدقيق لحسابات الدائنين والتزامات العقود دون أي تداخل مع إيرادات العميل.
  2. **حوكمة الاستلامات الهندسية وضبط الجودة (WIR QA/QC Protocol):**
     - رقمنة طلبات استلام الأعمال لمهندس الموقع والاستشاري وفق المعايير الإنشائية المعتمدة قبل السماح بالمراحل التالية (مثل استلام حديد التسليح قبل الصب).
  3. **إدارة عيوب المصنعية والتسليم (Snag / Punch List Management):**
     - رصد وحصر الملاحظات المعمارية والإنشائية، وتصنيف درجة خطورتها، وتوجيهها للمقاول أو الفرقة المسؤولة مع توثيق تاريخ الإصلاح وإغلاق الملاحظة قبل التسليم.
  4. **بروتوكول الاستلام الابتدائي والنهائي وإطلاق الضمانات (Handover Protocol & Retention Release):**
     - توثيق محاضر لجان الاستلام الابتدائي وبدء فترة الصيانة التعاقدية، وتسهيل إجراءات الاستلام النهائي والإفراج التدريجي عن محجوز الضمان (Release Retention).
  5. **التحليل الخماسي المباشر للتكاليف (5-Stream Cost Breakdown vs Baseline):**
     - لوحة رقابية مالية تجمع التكاليف الفعلية المقيدة من 5 مصادر تشغيلية (الخامات والمشتريات + العمالة والمصنعيات + مقاولي الباطن + المعدات وتكاليف الموقع + العهد النثرية) ومقارنتها بالقيمة التعاقدية للمشروع لبيان هامش الربح والانحرافات بدقة.

---

### 120. محرك الاستيراد الذكي لكشوف الحسابات البنكية ومطابقة الأعمدة التلقائية (Smart Bank Statement Import, Multi-Bank Column Detection & Template Generator)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% (Production Ready) ومطابق لمعايير Z-Systems البصرية و 0 Emojis ودستور الكومبوبوكس الموحد.
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/accounting/utils/bankStatementParser.ts`:
    - محرك استخراج وتحليل ذكي يدعم ملفات Excel (`.xlsx`, `.xls`) و `.csv` والنصوص المنسوخة (Paste Text) مباشرة من الخدمات المصرفية للشركات أو كشوفات الـ PDF.
    - تجاوز أسطر الترويسة والبيانات الفوقية غير الجدولية (Metadata & Bank Info Skipping).
    - الكشف والتطبيع التلقائي للأعمدة الشائعة بكافة البنوك (Date, Description, Reference, Balance).
    - المعالجة المزدوجة لأنماط المبالغ: دعم الأعمدة المنفصلة للسحب والإيداع (Debit / Credit) أو العمود الموحد للمبلغ بإشارة (+ / -) وحساب الصافي رياضياً.
    - دالة `downloadBankStatementTemplate`: توليد وتنزيل قالب كشف حساب بنكي قياسي موحد بصيغة Excel.
  - `frontend/src/features/accounting/components/bank-reconciliation/CreateBankStatementModal.tsx`:
    - واجهة تفاعلية بريميوم مقسمة لتبويبين: «الاستيراد الذكي» و «مراجعة وإدخال الأسطر يدوياً».
    - منطقة سحب وإفلات للملفات (Drag & Drop Zone).
    - صندوق لصق الحركات المنسوخة من موقع البنك أو الـ PDF.
    - شريط المطابقة اليدوية للأعمدة (Visual Column Mapping Customizer) لتمكين المحاسب من إعادة تعيين أو توجيه أي عمود في الكشوف غير القياسية بنقرة واحدة.
    - شريط المؤشرات المالية الفورية (KPIs Strip): إجمالي الإيداعات، إجمالي السحوبات، صافي حركة الكشف، وعدد الأسطر المكتشفة.
    - جدول معاينة الحركات المستخرجة مع إمكانية حذف أي سطر بنقرة واحدة وتحديث رصيد النهاية تلقائياً.
    - استبدال الـ native select بـ `CustomSelect` القياسي التزاماً بدستور الكومبوبوكس الموحد.
* **القدرات التشغيلية المعتمدة:**
  1. **التعامل المرن مع تنوع صيغ البنوك (Multi-Bank Compatibility):**
     - التوافق التام مع كشوف الحسابات الصادرة من مختلف البنوك المصرية والعربية والدولية (CIB, البنك الأهلي المصري, بنك مصر, QNB, مصرف الراجحي, بنك الرياض, الإنماء, إلخ).
  2. **تخطي عقبة كشوفات الـ PDF (Copy & Paste Text Extraction):**
     - إتاحة نسخ جدول الحركات من أي ملف PDF ولصقه في مربع المعالجة النصية ليقوم النظام بفرزه واستخراج التاريخ والمبلغ والبيان بدقة متناهية دون الحاجة لتحويل الملف يدوياً.
  3. **الحساب الآلي لأرصدة الكشف (Auto Balance Calculation):**
     - تحديث رصيد النهاية المطلوب تلقائياً استناداً إلى رصيد البداية وصافي حركة السحب والإيداع.

---

### 121. دستور الترقيم الموحد للوثائق والأذونات ومطابقة العملة المركزية (Universal Document Numbering Engine & Central System Currency Standard)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري و 0 Emojis وسياسة العزل الصارم.
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/common/utils/document-number.util.ts`:
    - محرك الترقيم المركزي الموحد لدوال البادئة اليومية `getDailyDocumentPrefix(prefix, date)` وصيغة الترقيم `formatDailyDocumentNumber(prefix, seq, date, padding)`.
  - الموديولات والخدمات المحدثة:
    - طلبات عروض الأسعار للمشتريات: `backend/src/modules/purchases/services/purchase-rfqs.service.ts` (`RFQ-YYMMDD-XXXX`).
    - مستحقات نهاية الخدمة: `backend/src/modules/hr/services/end-of-service.service.ts` (`EOS-YYMMDD-XXXX`).
    - تذاكر الصيانة: `backend/src/modules/maintenance/maintenance.service.ts` (`ZM-YYMMDD-XXXX`).
    - موديول المقاولات: `backend/src/modules/contracting/contracting.service.ts` (أوامر التغيير `CO-YYMMDD-XXXX`، عقود الباطن `SC-YYMMDD-XXXX`، استفسارات الموقع `RFI-YYMMDD-XXXX`، أذون فحص الأعمال `WIR-YYMMDD-XXXX`، مرتجعات الموردين `RTN-YYMMDD-XXXX`، أذون الصرف النقدية `CSH-YYMMDD-XXXX`، والمشاريع `PRJ-YYMMDD-XXXX`).
    - الشحن البحري، المبيعات، المشتريات، والمخازن: اعتماد صيغ `JOB-YYMMDD-XXXX` و `Z-YYMMDD-XXXX` و `ZP-YYMMDD-XXXX` و `ZTR-YYMMDD-XXXX`.
  - معالجة العملة المركزية:
    - `frontend/src/lib/currencies.ts` و `frontend/src/shared/hooks/use-system-currency.ts`: إزالة أي تثبيت عشوائي للريال السعودي (`SAR`)، وربط العملة الافتراضية حصرياً بإعدادات المنشأة الحالية (`settings.currency`) وتفضيلات النظام المخزنة (`zs_system_currency`).
  - دستور النظام:
    - توثيق المعيار في `d:\zn\AGENTS.md` (بند 10) و `d:\zn\GEMINI.md` (بند 20).
* **القدرات التشغيلية المعتمدة:**
  1. **التاريخ السداسي اليومي الموحد (`YYMMDD`):** استبدال السنوات الرباعية القديمة (`2026`) بالتاريخ المباشر للسنة والشهر واليوم لسهولة الفرز الزمني ومنع تضخم أطوال الأكواد.
  2. **التسلسل المصفّر الرباعي (`0001`, `0002`...):** ضمان الاتساق الهندسي عبر كامل فروع وأذونات المنظومة.
  3. **تزامن نصوص الشاشات والـ Placeholders:** توحيد كافة النوافذ الإدخالية والأمثلة التوضيحية لتطابق الصيغة الجديدة بنسبة 100%.

---

### 122. ترقية وتطوير نافذة إنشاء الفرص البيعية وإدارة الصفقات المؤسسية (Enterprise CRM Opportunity Creation & Sales Pipeline Upgrades)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق لمعايير Z-Systems البصرية و 0 Emojis وحظر التنبيهات والقوائم البدائية.
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/crm/components/CrmDealCreateModal.tsx`:
    - الترقية إلى الهيكل القياسي `StandardDialog` لضمان الثبات الهندسي للأبعاد.
    - إضافة قائمة ذكية `CustomSelect` لاختيار عميل مسجل مسبقاً من قاعدة بيانات العملاء (`customersApi.list`) مع الملء التلقائي لكافة بياناته، أو إدخال عميل محتمل جديد.
    - إضافة قائمة لاختيار وتعيين مسؤول المتابعة / مندوب المبيعات من مستخدمي المنظومة (`userDirectoryApi.users`).
    - إضافة قائمة منسدلة لتحديد عملة الصفقة من العملات المدعومة (`SUPPORTED_CURRENCIES`) وربطها بعملة النظام الافتراضية.
    - إضافة حقل البريد الإلكتروني (`contactEmail`).
    - إضافة حقل تعديل نسبة احتمالية الفوز بالصفقة يدوياً (`probability %`).
    - حقل ديناميكي لتسجيل سبب الخسارة (`lostReason`) عند اختيار مرحلة الصفقة الخاسرة.
    - استبدال كافة القوائم البدائية بـ `CustomSelect` الموحد، واستبدال `alert` بـ `toast`.
  - `frontend/src/features/crm/components/CrmDealDetailModal.tsx`:
    - تطهير النافذة من القوائم البدائية واستبدال قائمة نقل المرحلة وقائمة نوع النشاط بـ `CustomSelect`.
    - استبدال التنبيه البدائي بـ `toast.warning`.
  - `backend/src/modules/crm/crm.service.ts` & `dto/crm.dto.ts`:
    - دعم حقل `customerId` و `lostReason` في عمليات إنشاء وتحديث الفرص البيعية وحفظها في قاعدة البيانات.
* **القدرات التشغيلية المعتمدة:**
  1. **الربط التلقائي بقاعدة العملاء والشركات:** تمكين فريق المبيعات من استدعاء أي عميل مسجل فوراً دون تكرار إدخال البيانات.
  2. **حوكمة ومتابعة أداء المناديب:** تحديد مسؤول المتابعة لكل فرصة لتوزيع المهام وقياس كفاءة الإغلاق.
  3. **الامتثال التام لدستور النظام (0 Alerts & 0 Raw Selects):** توافق كامل مع معايير Enterprise SaaS.

---

### 123. الفحص الشامل وتطوير نوافذ موديول الشحن واللوجستيات وفق النموذج المرجعي القياسي (Maritime Freight Suite Comprehensive Audit & Golden Reference Modal Upgrades)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق تماماً لدستور النوافذ المنبثقة (`StandardModalExample.tsx`)، 0 Emojis، 0 Native Alerts، و 0 Native Selects.
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/maritime-freight/components/DispatchRfqModal.tsx`:
    - تصحيح تموضع التذييل المعياري ونقله حصرياً إلى خاصية `footerActions={(<StandardDialogFooter .../>)}` بدلاً من وضعه داخل جسم النافذة.
    - ضبط العرض القياسي المعتمد `width="min(880px, 95vw)"` و `minHeight="auto"`.
    - ترقية بطاقات ملخص الشحنة وقائمة الخطوط إلى بنية البطاقات المقسمة المرقمة (Sectional Cards) مع أيقونات SVG رسمية من `AppIcons` وتنسيقات الـ 33px.
  - `frontend/src/features/maritime-freight/components/ContainerMilestoneModal.tsx`:
    - تصحيح تموضع التذييل ونقله إلى `footerActions` مع ربط الخصائص القياسية (`onSubmit`, `submitText`).
    - ضبط العرض القياسي `width="min(640px, 95vw)"`.
    - تقسيم الحقول إلى بطاقات منطقية تشغيلية (ملخص الحاوية، تواريخ التفريغ والبوابات، الملاحظات الميدانية) بنمط الـ 33px.
  - `frontend/src/features/maritime-freight/components/ImportCarriersModal.tsx`:
    - إزالة أزرار الحفظ والإلغاء اليدوية من أسفل جسم النافذة ونقلها إلى `footerActions` عبر `StandardDialogFooter`.
    - ضبط العرض القياسي `width="min(880px, 95vw)"` و `minHeight="auto"`.
  - `frontend/src/features/maritime-freight/components/CreateInquiryModal.tsx`:
    - إضافة ميزة البحث والاستدعاء التلقائي للعملاء المسجلين (`customersApi.list`) عبر قائمة منسدلة ذكية `CustomSelect` مع الملء الفوري لاسم الشركة والهاتف والبريد، مع إمكانية الإدخال اليدوي لعميل جديد.
  - `frontend/src/features/maritime-freight/components/JobDetailsModal.tsx` (النوافذ الفرعية Sub-modals):
    - نافذة تعديل بيانات الرحلة والبوالص (`showEditVoyage`): إعادة هيكلتها بالكامل إلى 3 بطاقات مقسمة (بيانات السفينة والحجز، المواعيد الزمنية للرحلة، بوالص الشحن والأطراف التعاقدية) مع حقول `Field` و `CustomSelect` وارتفاع 33px.
    - نافذة إضافة حاوية جديدة (`showAddContainer`): إعادة هيكلتها إلى بطاقتين منطقيتين (هوية الحاوية والمواصفات الفنية، شروط السماح والغرامات والتأمين) مع ربط `footerActions` بـ `onSubmit`.
    - نافذة تعديل الحاوية (`editingContainer`): تقسيمها إلى بطاقتي الختم والمواعيد، والغرامات وحالة التأمين.
    - نافذة إصدار فاتورة الخدمات الملاحية (`showInvoiceDialog`): ترقيتها لبطاقة إدخال موحدة مع `Field` وتذييل معتمد.
    - نافذة ترحيل سند المصروفات الملاحية (`showExpenseDialog`): ترقيتها لبطاقة إدخال موحدة مع `Field` وقوائم `CustomSelect`.
    - نافذة الاستخراج الذكي لبيانات الحجز (`showSmartParseModal`): توحيد خصائص التذييل المعياري `StandardDialogFooter`.
* **القدرات التشغيلية المعتمدة:**
  1. **التوافق التام مع النموذج المرجعي (Golden Reference Alignment):** القضاء التام على النوافذ المتضخمة أو العشوائية، وثبات أبعاد النوافذ المنبثقة.
  2. **الترابط اللوجستي مع منظومة العملاء:** تمكين مسؤولي الشحن من اختيار عملاء المنظومة المسجلين بنقرة واحدة عند إنشاء استفسار أو طلب شحن جديد.
  3. **استقرار التذييلات (Pinned Dialog Footers):** ضمان بقاء أزرار الإجراءات مثبتة في أسفل النافذة المنبثقة وعدم تمريرها واختفائها مع المحتوى الداخلي.

---

### 124. الفحص الشامل وتطوير شاشات ونوافذ إدارة علاقات العملاء والـ CRM وفق دستور النظام (CRM & Customer Relations Suite Comprehensive Audit & Golden Reference Upgrades)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق تماماً لدستور النوافذ المنبثقة (`StandardModalExample.tsx`)، 0 Emojis، 0 Native Alerts/Confirms، و 0 Native Selects.
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/crm/pages/CrmPipelinePage.tsx`:
    - استبدال فلاتر الـ `<select>` التقليدية البدائية للقوائم المنسدلة للأولوية والمرحلة البيعية بالقائمة المركزية الموحدة `CustomSelect`.
    - استبدال بنرات التغذية الراجعة السفلية بمنظومة الإشعارات الموحدة `toast.success` و `toast.error`.
  - `frontend/src/features/crm/components/CrmDealDetailModal.tsx`:
    - القضاء التام على نافذة التأكيد البدائية للمتصفح `window.confirm(...)` عند حذف الصفقة واستبدالها بحوار التأكيد المؤسسي الحديث `await systemConfirm(...)`.
    - الترقية من `DialogShell` إلى `StandardDialog` مع تذييل الإجراءات المعياري `StandardDialogFooter`.
    - إعادة تنظيم النافذة إلى 3 بطاقات مقسمة (شريط المراحل والإجراءات السريعة، الملخص المالي والملاحظات، سجل الأنشطة والمتابعات).
  - `frontend/src/features/customers/components/CustomerLoyaltyModal.tsx`:
    - القضاء التام على نوافذ التنبيه البدائية للمتصفح `alert(...)` (3 تنبيهات) واستبدالها بـ `toast.success` و `toast.error` و `toast.warning`.
    - الترقية من `DialogShell` إلى `StandardDialog` و `StandardDialogFooter`.
    - إعادة هيكلة المحتوى إلى 3 بطاقات مقسمة بنمط الـ 33px (إحصائيات رصيد النقاط، نموذج التعديل اليدوي، وسجل حركات النقاط مع الشارات الملونة).
  - `frontend/src/features/customers/components/WhatsAppMarketingModal.tsx`:
    - الترقية من `DialogShell` إلى `StandardDialog` وتثبيت أزرار الإجراءات ونسخ الأرقام في التذييل `footerActions`.
    - تقسيم الواجهة إلى 3 بطاقات مقسمة بأيقونات SVG كحلية رسمية (فلترة مدة الانقطاع والعدد المستهدف، قالب الرسالة الترويجية، وجدول المراسلة المباشرة بنقرة زر).
  - `frontend/src/features/customers/pages/CustomersPage.tsx`:
    - ترقية نوافذ إنشاء وتعديل العملاء من `DialogShell` إلى `StandardDialog` لضمان اتساق الهيدر وأزرار الإغلاق مع النموذج المرجعي.
  - `frontend/src/features/customers/components/CustomerForm.tsx` & `CustomerEditorCard.tsx`:
    - استبدال كلاسات Tailwind غير المدعومة في إعدادات الاستيراد بحقول وتنسيقات الـ CSS القياسية الصافية.
* **القدرات التشغيلية المعتمدة:**
  1. **التطهير الكامل من الرموز والتنبيهات البدائية (Zero-Native Standards):** خلو كامل من نوافذ `alert` أو `confirm` أو قوائم `select` التقليدية في كامل قطاع العملاء والـ CRM.
  2. **الهوية البصرية المؤسسية المتزنة (Sectional Cards Architecture):** تنسيق جميع النوافذ بنمط البطاقات المقسمة والأيقونات الرسمية وتذييلات `footerActions` المثبتة.
  3. **التكامل بين النماذج والعمليات اللوجستية والبيعية:** دعم كامل للعملاء المرجعيين، التخصيص التلقائي للمناديب، وإدارة حملات الاستهداف ونقاط الولاء.

---

### 125. الفحص الشامل وتطوير شاشات ونوافذ موديول المشتريات والموردين وفق دستور النظام (Purchases & Suppliers Suite Comprehensive Audit & Golden Reference Upgrades)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق تماماً لدستور النوافذ المنبثقة (`StandardModalExample.tsx`)، 0 Emojis، 0 Native Alerts/Confirms، و 0 Native Selects (100% CustomSelect).
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/suppliers/pages/SuppliersPage.tsx`:
    - ترقية نوافذ إنشاء وتعديل الموردين من `DialogShell` إلى `StandardDialog` المتوافق مع النموذج المرجعي.
  - `frontend/src/features/suppliers/components/SupplierForm.tsx` & `SupplierEditorCard.tsx`:
    - إصلاح الخطأ البرمجي في اسم العملة الافتتاحية (`${getGlobalCurrencySymbol()}`).
    - إزالة كلاسات Tailwind غير المدعومة في حقول الاستيراد، وترقية القوائم المنسدلة للعملة ونوع المورد إلى `CustomSelect` عبر `Controller`.
  - `frontend/src/features/purchases/pages/PurchaseOrdersPage.tsx`:
    - تطهير واستبدال 13 تنبيهاً بدائياً `alert(...)` بمنظومة الإشعارات الموحدة `toast.success` و `toast.error` و `toast.warning`.
  - `frontend/src/features/purchases/pages/PurchaseRfqsPage.tsx`:
    - استبدال نوافذ التأكيد البدائية `window.confirm(...)` بحوار التأكيد المؤسسي الحديث `await systemConfirm(...)`.
    - ترقية فلتر الحالة من `<select>` تقليدي إلى `CustomSelect`، واستبدال `alert` بـ `toast.success`.
  - `frontend/src/features/purchases/components/CreatePurchaseOrderModal.tsx`:
    - الترقية الكاملة من `DialogShell` بهيدر وتذييل يدويين إلى `StandardDialog` مع التذييل المثبت `StandardDialogFooter`.
  - `frontend/src/features/purchases/components/PurchaseOrderDetailsModal.tsx`:
    - استبدال تأكيدات الحذف والاعتماد البدائية بـ `await systemConfirm(...)`، والترقية إلى `StandardDialog` و `StandardDialogFooter`.
  - `frontend/src/features/purchases/components/PurchaseLandedCostsModal.tsx`:
    - الترقية من `DialogShell` وبطاقة داخلية إلى `StandardDialog` وتذييل `StandardDialogFooter`، وترقية قائمة أنواع المصروفات إلى `CustomSelect`.
  - `frontend/src/features/purchases/components/PurchaseEditDialog.tsx`:
    - الترقية من `DialogShell` إلى `StandardDialog` و `StandardDialogFooter`، واستبدال قائمة السداد إلى `CustomSelect`.
  - `frontend/src/features/purchases/components/PurchaseComposer.tsx`:
    - ترقية قوائم المورد، نوع السداد، الفرع، والمستودع إلى `CustomSelect` عبر `Controller`.
  - `frontend/src/features/purchases/components/purchase-composer/PurchaseQuickCreateDialog.tsx`:
    - الترقية من `DialogShell` إلى `StandardDialog` و `StandardDialogFooter`، واستبدال قوائم المجموعات والموردين بـ `CustomSelect`.
  - `frontend/src/features/purchases/components/PurchasePaymentScheduleCard.tsx`:
    - ترقية اختيار نمط الدفعات إلى `CustomSelect`.
  - `frontend/src/features/purchases/components/new-purchase-order/QuickCreateDialog.tsx`:
    - الترقية من شاشة مخصصة غير قياسية إلى `StandardDialog` و `CustomSelect` و `ActionConfirmDialog`.
  - `frontend/src/features/purchases/components/new-purchase-order/PurchaseOrderSuccessModal.tsx`:
    - الترقية إلى `StandardDialog` وإزالة كلاسات Tailwind غير المفعلة.
  - `frontend/src/features/purchases/components/smart-reorder/SmartReorderFilters.tsx`:
    - استبدال الفلاتر الأربعة بقوائم `CustomSelect`، وتطهير نصوص الخيارات من رموز النجوم (`★`).
  - `frontend/src/features/purchases/components/smart-reorder/SmartReorderSuccessModal.tsx` & `SmartReorderConfirmModal.tsx`:
    - الترقية إلى `StandardDialog` و `StandardDialogFooter`.
  - `frontend/src/features/purchases/components/PurchasesWorkspace.tsx`:
    - ترقية نافذة تفاصيل الفاتورة إلى `StandardDialog` و `StandardDialogFooter`.
  - `frontend/src/features/purchases/components/ReceivePurchaseOrderModal.tsx`:
    - ترقية نافذة إثبات الاستلام المخزني إلى `StandardDialog` و `StandardDialogFooter`.
  - `frontend/src/features/purchases/components/PurchaseRepricingDialog.tsx`:
    - الترقية إلى `StandardDialog` و `StandardDialogFooter` مع زر فتح مركز التسعير في `extraActions`.
  - `frontend/src/features/purchases/components/MarginProtectionModal.tsx`:
    - التطهير التام من كلاسات Tailwind وخلفية الـ overlay اليدوية، والترقية إلى `StandardDialog` و `StandardDialogFooter` مع بطاقات إحصائية متناسقة بنمط 33px.
  - `frontend/src/features/purchases/components/rfq/CreateRfqModal.tsx` & `RfqComparisonMatrixModal.tsx`:
    - توحيد استخدام `open` و `footerActions={<StandardDialogFooter .../>}` وإزالة أزرار الحفظ والإلغاء غير المثبتة.
* **القدرات التشغيلية المعتمدة:**
  1. **التوافق التام مع النموذج المرجعي (Golden Reference Modal Standard):** كافة نوافذ المشتريات والموردين (أكثر من 15 نافذة) تستخدم حصرياً `StandardDialog` و `StandardDialogFooter`.
  2. **100% تطهير من عناصر Select التقليدية:** استخدام الحصري لمكون `CustomSelect` في كافة الفلاتر ونماذج الإدخال والتوزيع.
  3. **صفرية التنبيهات البدائية (Zero-Native Alerts/Confirms):** ترقية كافة الإجراءات الحساسة (حذف، اعتماد، تحويل، إلغاء) إلى `await systemConfirm(...)` ومنظومة التوست الحديثة.

---

### 126. الفحص الشامل وتطوير شاشات ونوافذ موديول المخازن والأصناف والتصنيفات وفق دستور النظام (Inventory, Products, Categories & Barcodes Suite Comprehensive Audit & Golden Reference Upgrades)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق تماماً لدستور النوافذ المنبثقة (`StandardModalExample.tsx`)، معمارية البطاقات الرمادية المنظمة (`#f8fafc`)، 0 Emojis، 0 Native Alerts/Confirms، و 0 Native Selects (100% CustomSelect).
* **مسارات وملفات التنفيذ الأساسية:**
  - `frontend/src/features/inventory/components/InventoryActionsPanel.tsx`:
    - ربط نماذج التسوية المخزنية والتالف بالـ `Controller` مع المكون القياسي `CustomSelect` لكافة القوائم المنسدلة (المخازن والأسباب).
  - `frontend/src/features/inventory/components/sections/InventoryComposerCards.tsx`:
    - استبدال كافة القوائم المنسدلة التقليدية (6 قوائم) بـ `CustomSelect` مع دعم البحث والتطبيع اللحظي.
  - `frontend/src/features/products/pages/ProductModifiersPage.tsx`:
    - استبدال تنبيهات `window.confirm` و `alert` البدائية بـ `systemConfirm` ومنظومة `toast` الموحدة.
  - `frontend/src/features/products/components/offers/ProductOfferActiveCombosTab.tsx`:
    - استبدال نوافذ التأكيد البدائية `window.confirm` بـ `await systemConfirm`.
  - `frontend/src/features/products/components/ProductsTableCard.tsx`:
    - استبدال `window.confirm` لحذف الموديل بـ `systemConfirm`، وترقية نافذة الملاحظة `activeNoteModal` إلى `StandardDialog` وتذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/AddonsManagementDialog.tsx`:
    - الترقية الكاملة إلى `StandardDialog` وبطاقتين رماديتين منظمتين (`#f8fafc` مع أيقونة رسمية وهيدر كحلي): بطاقة بيانات الإضافة والتسعير + بطاقة جدول الإضافات المسجلة مع تذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/BarcodePrintDialog.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (إعدادات الطابعة والمقاس + معاينة الملصق الحية) مع `CustomSelect`.
  - `frontend/src/features/products/components/modifiers/ModifierGroupModal.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (بيانات المجموعة والقواعد + قائمة الخيارات والإضافات) مع `CustomSelect` وتذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/ProductBarcodeDialog.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (إعداد وقراءة الباركود + معاينة الباركود الحية) مع `CustomSelect` وتذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/ProductSerialsDialog.tsx`:
    - الترقية إلى `StandardDialog` و 3 بطاقات رمادية منظمة (ملخص أرصدة السيريالات + تسجيل أرقام تسلسلية جديدة + سجل السيريالات التفصيلي) مع `StandardDialogFooter`.
  - `frontend/src/features/products/components/ProductOfferDialog.tsx`:
    - ترقية الحاوية الخارجية إلى `StandardDialog` و `StandardDialogFooter` وإزالة الأزرار غير المثبتة.
  - `frontend/src/features/products/components/ScalePluExportModal.tsx`:
    - الترقية إلى `StandardDialog` و 3 بطاقات رمادية منظمة (إعدادات الميزان وصيغة التصدير + معاينة الأصناف الجاهزة + إرشادات التنزيل المباشر) مع `CustomSelect` وتذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/SerialLookupModal.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (مسح وفحص السيريال + تفاصيل الجهاز وسجل الضمان وحالة الصنف).
  - `frontend/src/features/products/components/categories/CategoryFormModal.tsx`:
    - الترقية إلى `StandardDialog` وبطاقة رمادية منظمة لبيانات القسم مع تذييل `StandardDialogFooter` وإزالة `DialogShell` البدائي.
  - `frontend/src/features/products/components/categories/CategoryTransferProductsModal.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (وجهة النقل والتصنيف المستهدف مع `CustomSelect` + تحديد الأصناف للنقل مع شريط الأدوات) وتذييل `StandardDialogFooter`.
  - `frontend/src/features/products/components/categories/CategoryTransferWarehouseModal.tsx`:
    - الترقية إلى `StandardDialog` وبطاقتين رماديتين (معلومات العملية + تحديد المخزن المصدر والوجهة عبر `CustomSelect` في عمودين متناسقين) وتذييل `StandardDialogFooter`.
* **القدرات التشغيلية المعتمدة:**
  1. **دستور البطاقات الرمادية المنظمة (Sectional Grey Cards Standard):** تقسيم الأجسام الداخلية لجميع النوافذ المنبثقة (16 نافذة) إلى بطاقات رمادية منظمة بخلفية `#f8fafc` وبوردر `#e2e8f0` وأيقونة رسمية وعنوان كحلي `#170e5e`، مما يوحد المسار الإدراكي للمستخدم.
  2. **تطهير شامل لكافة عناصر الإدخال البدائية:** 100% اعتماد على `CustomSelect` لجميع القوائم، وتطهير كامل من التنبيهات البدائية لصالح `toast.*` و `systemConfirm`.
  3. **استقرار الأبعاد وتذييلات مثبتة:** حماية كاملة من وميض النوافذ بفضل `StandardDialog` و `StandardDialogFooter`.

---

### 127. تدقيق ومراجعة الباك إند لموديول نقاط البيع والمبيعات والكاشير والالتزام بحظر تعديل الـ UI (POS & Sales Backend Audit & Standard Verification)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق لتعليمات المستخدم الصارمة (حظر كامل للمساس بواجهة الكاشير ونقطة البيع UI)، مع تدقيق وتصحيح كود الباك إند بالكامل وفق دستور النظام والمعايير الدستورية (Rule 10).
* **مسارات وملفات التنفيذ الأساسية:**
  - `backend/src/modules/sales/services/sales-orders.service.ts`:
    - ترقية وتوحيد خوارزمية ترقيم أوامر البيع (`order_number`) لتتوافق حرفياً مع دستور الترقيم الموحد للوثائق والأذونات (Rule 10) باستخدام `getDailyDocumentPrefix('SO')` والتسلسل اليومي التراكمي المسبوق بأصفار رباعية الخانات (`SO-YYMMDD-XXXX`) بدلاً من التسلسل القديم العشوائي.
  - `backend/src/modules/sales/services/sales-write.service.ts`:
    - مراجعة وتدقيق محرك ترقيم الفواتير النقدية والآجلة (`doc_no`) والتحقق من التزامه الصارم بتنسيق `Z-YYMMDD-XXXX` بالاعتماد على اليومية والتسلسل اليومي المحمي بالتينانت.
    - تدقيق وتأكيد قيود العزل المتعدد للمستأجرين (`tenant_id` & `account_id`) ومنع التداخل بين الحسابات.
    - تدقيق ومطابقة محرك حماية الخصومات (`assertDiscountChangeAllowed`) مع صلاحيات المدير وتخطي الـ PIN.
  - `backend/src/modules/cash-drawer/cash-drawer.service.ts` & `helpers/cash-drawer.helper.ts`:
    - مراجعة وتدقيق دورة حياة الورديات النقدية (فتح الوردية، تسجيل حركات الصرف والإيداع النثري، الإغلاق الأعمى Blind Close، وحساب الفروقات والعجز والزيادة).
  - `frontend/src/features/pos`:
    - الالتزام التام بنسبة 100% بالأمر المباشر من المستخدم بعدم لمس أو تغيير أو تعديل أي ملف في واجهة مستخدم الكاشير ونقاط البيع.
* **القدرات التشغيلية المعتمدة:**
  1. **الامتثال لدستور الترقيم الموحد (Universal Document Numbering Rule 10):** ضبط أوامر البيع اليومية بتسلسل نظامي مشفر باليوم والشهر والسنة (`SO-YYMMDD-XXXX`).
  2. **الحفاظ التام على استقرار نقطة البيع:** صفر تغييرات على واجهة الكاشير لحماية سير العمل اليومي للعميل.
  3. **سلامة التحقق النوعي 100%:** اجتياز الفحص البرمجي والأنواع في الباك إند والفرونت إند بنجاح تام.

---

### 128. الربط الهندسي الشامل للموديولات الأربعة ومزامنة الصلاحيات ورفع الحجب عن المخازن وشجرة المخازن والأرفف (Cross-Module Complete Suite Interconnection & Architecture Harmonization)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% ومطابق تماماً لدستور المنظومة المعماري والواجهات المؤسسية (0 Emojis & Clean Enterprise Architecture).
* **معيار المقارنة الدولي:** SAP S/4HANA & Odoo 18 Multi-Vertical Suite Harmonization Standard.
* **الموديولات الأربعة المشمولة بالتكامل الشامل:**
  1. **قطاع التجارة العامة والتجزئة (Commerce & Retail):**
     - تفعيل وحماية كونتينرات المخازن والأصناف التسعة كاملة: دليل الأصناف، أقسام الأصناف، المستودعات، شجرة المخازن، الأرفف، أذونات الصرف، إذن صرف جديد، جرد المخزون، ومركز التسعير.
     - تفعيل المبيعات، عروض الأسعار، أوامر البيع، الـ CRM، المشتريات، الموردين، المالية وشجرة الحسابات ومراكز التكلفة، والموارد البشرية.
  2. **قطاع التصنيع والإنتاج الصناعي (Manufacturing & Production):**
     - تفعيل أوامر الإنتاج والتشغيل، قوائم المكونات (BOM)، مكونات التصنيع، مراكز العمل، وإعدادات التصنيع.
     - ربط مستودعات ومخازن الخامات والمنتج التام بالكامل وشجرة المخازن والأرفف وأذونات الصرف ومركز التسعير.
     - إضافة مجموعة المبيعات وعروض الأسعار وأوامر التوريد والعملاء للمصنع وتقارير المبيعات.
  3. **قطاع المقاولات وإدارة المشاريع (Contracting & Construction):**
     - سجل المشاريع، مقايسات الكميات (BOQ)، المالية والمستخلصات، مقاولو الباطن، الميدان والجدول الزمني، وبنك بنود المقاولات المرجعي.
     - ربط مستودعات ومخازن المواقع بجميع مكوناتها (الأصناف، المستودعات، شجرة المخازن، الأرفف، أذونات الصرف للمواقع، مركز التسعير).
     - إضافة عروض الأسعار ومقايسات العطاءات ضمن مجموعة إدارة الصفقات وجهات الإسناد.
  4. **قطاع الشحن البحري واللوجستيات (Maritime Freight & Logistics):**
     - استفسارات الشحن والنولون، عروض أسعار الخطوط، مصفوفة المقارنة، عروض أسعار العملاء، أوامر تشغيل الشحنات، تتبع الحاويات، ودليل الموانئ والخطوط.
     - تفعيل اختياري مرن للمخازن ومستودعات التخزين ومواد التعبئة عند طلب تفعيلها من الإعدادات.
     - المالية والمحاسبة اللوجستية، الأصول الثابتة، والضرائب.
* **مسارات وملفات التنفيذ الأساسية:**
  - **الباك إند:**
    - `backend/src/core/tenant/industry-profiles.ts`: إضافة الحزمة الكاملة (`catalog`, `products`, `crm`, `pricing`, `suppliers`, `customers`) إلى الميزات الافتراضية لكافة القطاعات الأربعة.
    - `backend/src/core/auth/services/plan-feature.service.ts`: ترقية دالة فحص الميزات `hasFeature` لضمان إتاحة كامل الميزات التشغيلية المعتمدة لقطاع المنشأة تلقائياً.
    - `backend/src/modules/settings/settings.service.ts`: ترقية `setActivityProfile` لضمان تفعيل المخزون والمشتريات والـ CRM ونقاط البيع تلقائياً عند اختيار التجارة، وتطهير كاش المنشأة والإعدادات فورياً.
  - **الفرونت إند:**
    - `frontend/src/shared/components/feature-gate.tsx`: إضافة صمام أمان معماري في `useFeatureGate` يضمن عدم قفل أي شاشة تابعة للنشاط التشغيلي الفعال للشركة.
    - `frontend/src/app/router/access.ts`: تسجيل كافة مسارات المخازن وشجرة المخازن والأرفف وأذونات الصرف والأسعار وعروض الأسعار في خريطة الصلاحيات `routePermissionMap` وترقية `hasRequiredFeature`.
    - `frontend/src/shared/layout/app-shell.tsx`: إعادة هيكلة القوائم الجانبية ومصفوفات التوجيه بدقة لكل قطاع ورفع الحجب عن مركز التسعير والأرفف وشجرة المخازن.
    - ملفات الراوتر (`inventory/routes.tsx`, `products/routes.tsx`, `sales/routes.tsx`, `purchases/routes.tsx`): إضافة مسارات بديلة (Aliases) لضمان الوصول المباشر لأي رابط دون أخطاء 404.
* **القدرات التشغيلية المعتمدة:**
  1. **الاستقرار الشامل وسلامة التنقل (Zero Broken Links & Zero Missing Containers):** القضاء التام على اختفاء أو حجب أي شاشة أو كونتينر تابع لأي قطاع تشغيلي معتمد.
  2. **حماية التخصيص الرأسي والأفقي:** عزل شاشات القطاعات المتخصصة (مثل بوالص الشحن عن المقاولات، أو شاشات المطبخ عن المصانع) مع توفير الأدوات المشتركة (المخازن، الحسابات، المشتريات، المبيعات) بأعلى كفاءة.
  3. **التحقق البرمجي التام (100% Type-Safe):** اجتياز فحص الـ TypeScript Typecheck بنجاح كلي (0 errors) في كل من الواجهة الأمامية والخلفية.

---


<!-- migrated:cap-153:end -->

<a id="cap-157"></a>
<!-- migrated:cap-157:start -->
## 132. إصلاح وحوكمة تفعيل موديولات متجر التطبيقات ومطابقة مخطط الإعدادات العامة (Apps Store Module Activation & Settings Validation Schema Alignment)
* **حالة الموديول العامة:** 🟢 مكتمل 100% (Production Ready)
* **المسارات في الكود:**
  - `frontend/src/features/settings/api/settings.api.ts`: التغليف التلقائي لحزمة التحديث في `{ settings: payload }` لحماية طلبات متجر التطبيقات `/apps` من الرفض في الـ ValidationPipe.
  - `backend/src/modules/settings/settings.controller.ts`: مرونة استقبال حمولة الإعدادات (قبول كلا التنسيقين المغلف `{ settings: ... }` والمباشر `{ [appKey]: value }`) دون إثارة أخطاء عدم التصريح بالحقول.
  - `frontend/src/features/settings/schemas/settings.schema.ts`: تحويل حقل `businessIndustry` إلى `z.string().optional().default('retail_general')` بدلاً من الـ enum المقيد لتفادي كسر التحقق عند حفظ الإعدادات للأنشطة المختلفة (`retail_general`, `maintenance`, `maritime_freight`, إلخ).
* **وصف الإصلاح والتحسين:**
  1. **حل خطأ متجر التطبيقات (`الحقل inventoryModuleEnabled غير مسموح إرساله`):**
     - عند النقر على «تثبيت وتفعيل» لتطبيق مثل المخازن المتقدمة أو العروض أو الكاشير، كان الفرونت إند يرسل المفتاح مباشرة في الـ root payload، مما يسبب رفض الباك إند بسبب `forbidNonWhitelisted`. تم حلها مزدوجاً في الـ API والـ Controller.
  2. **حل خطأ حفظ الإعدادات العامة (`Invalid option: expected one of...`):**
     - كان مخطط Zod يرفض حفظ أي تعديلات إذا كانت المنشأة تحمل طبيعة نشاط `retail_general`، مما يمنع حفظ الموديولات. تم فتح التحقق ليكون نصاً مرناً يدعم كافة الأنماط القطاعية للمنظومة.
  3. **تفعيل موديول المخازن وشجرة المخازن:**
     - تفعيل `inventoryModuleEnabled: true` و `purchasesModuleEnabled: true` و `posModuleEnabled: true` في قاعدة البيانات وضمان ظهور كامل أقسام المخازن (المستودعات، شجرة المخازن، الأرفف، أذونات الصرف والتحويل، وجرد المخزون) في القائمة الجانبية فورياً.
* **فحص الجودة والسلامة البرمجية:**
  - فحص `npx tsc --noEmit` للفرونت إند: **Code 0 (Zero Errors)**.
  - فحص `npx tsc --noEmit` للباك إند: **Code 0 (Zero Errors)**.

---


<!-- migrated:cap-157:end -->

<a id="cap-158"></a>
<!-- migrated:cap-158:start -->
## 133. حوكمة وتدقيق الأنماط القطاعية الأربعة والربط الموديولي الصارم (4 Industry Pillars Governance & Leak-Proof Module Alignment 100%)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready - Strict Vertical Isolation)
* **المسارات في الكود:**
  - `frontend/src/features/settings/components/workspace-sections/IndustryModeSelectorCard.tsx`: بطاقة اختيار وتفعيل نمط المنظومة عبر الأعمدة الأربعة (Pillars) مع تطهير التخصصات الفرعية لقطاع التجارة وتأمين التحويل التلقائي عند التبديل بين الأنماط دون أي تعليق أو تضارب.
  - `backend/src/core/tenant/industry-profiles.ts`: عزل ركيزة التصنيع (`manufacturing`) كعمود مستقل ومنفصل تماماً عن التجارة، وإضافة ميزة الخزينة (`treasury`) لافتراضيات المقاولات والشحن والتصنيع، وحذف احتمالات تسرب ميزات التصنيع لقطاع المقاولات أو التجارة.
  - `backend/src/modules/settings/settings.service.ts`: ترقية دالة `setActivityProfile` لتصفير وتفعيل مصفوفات الموديولات (`modulePatch`) بصرامة حتمية (Deterministic Isolation)؛ بحيث يضمن تفعيل الموديولات الخاصة بالقطاع فقط وإطفاء كافة الموديولات المتعارضة (إلغاء التصنيع والصيدلية والمطاعم والصيانة عند تفعيل المقاولات أو الشحن أو العكس).
  - `frontend/src/shared/layout/app-shell.tsx`:
    - قطاع المقاولات: إدراج مفاتيح الملاحة المعيارية (`contracting-financials`, `contracting-procurement`, `contracting-field`, `contracting-master-boq`) في ترتيب `contractingOrder` وخريطة الأيقونات الرسمية SVG (`iconPathMap`) وضبط أسمائها المعربة.
    - قطاع التصنيع: إدراج مراكز العمل والماكينات (`manufacturing-work-centers`) في القائمة الجانبية للتصنيع، وترتيب `manufacturingOrder`، والأيقونة الرسمية، ومصفوفة `sidebarGroups`.
    - قطاع الشحن: الحفاظ على الربط الكامل لموديولات الشحن الـ 8 (الاستفسارات، عروض النولون، المقارنة، عروض الأسعار، أوامر التشغيل، تتبع الحاويات، دليل الخطوط والموانئ، أتمتة المراسلات) والشجرة المحاسبية والـ CRM.
    - قطاع التجارة: تثبيت وتفعيل نقاط البيع السريعة، درج النقدية، المخازن والباركود، المشتريات، الحسابات العامة، الخزينة والبنوك، والفاتورة الإلكترونية مع 4 تخصصات فرعية منضبطة (التجزئة العامة، الصيدليات FEFO، المطاعم KDS، مراكز الصيانة IMEI).
  - `frontend/src/shared/components/GlobalSearchModal.tsx`: تعريف حاسم لـ `isManufacturingVertical` ومنع ظهور نقاط البيع أو كاشير التجزئة في نتائج البحث للمصانع، وتطهير عناصر التصنيع من البحث في قطاع التجزئة إذا كان الموديول معطلاً.
* **القدرات التشغيلية المعتمدة للأوضاع الأربعة:**
  1. **قطاع المقاولات وإدارة المشاريع (Contracting ERP):** المشاريع • المقايسات • المستخلصات • مقاولو الباطن • الحسابات العامة • الموارد البشرية • مخازن المواقع ومواد البناء • اليوميات واستفسارات الموقع.
  2. **قطاع الشحن البحري واللوجستيات (Freight Forwarding):** استفسارات الشحن • تسعير النولون (RFQ) • مقارنة الخطوط • عروض أسعار العملاء • أوامر تشغيل الشحنات • الحاويات وفترات السماح • دليل الخطوط والموانئ • الشجرة المحاسبية والمالية اللوجستية • CRM الشحن.
  3. **قطاع التصنيع والإنتاج الصناعي (Industrial Production):** أوامر الإنتاج • قوائم المكونات BOM • مكونات ومستلزمات التصنيع • مراكز العمل والماكينات • مخازن المواد الخام والمنتج التام • مراكز التكلفة المحاسبية • مشتريات التوريد الصناعي • CRM العملاء والتوزيع.
  4. **قطاع التجارة وإدارة الأعمال (Commerce & Retail):** نقاط البيع السريعة • الوردية والدرج النقدي • المخازن والباركود • المشتريات والموردين • شجرة الحسابات والقيود • الخزينة والبنوك • الفاتورة الإلكترونية والإقرار الضريبي، مع التخصصات الرقابية الدقيقة (الصيدلية FEFO، المطاعم KDS، الصيانة IMEI، التجزئة العامة).
* **معايير العزل الصارم وحظر التداخل (Zero Cross-Pillar Leakage):**
  - تم القضاء تماماً على أي تداخل أو تسرب لأدوات البيع بالتجزئة (مثل الكاشير السريع أو شاشات المطبخ) داخل قطاعي المقاولات أو المصانع أو الشحن.
  - إمكانية التبديل الآني الفوري (0ms transition) بين الأنماط للسوبر أدمن وإدارة المنشأة مع إعادة رسم القوائم وتحديث صلاحيات الجلسة آلياً.

---


<!-- migrated:cap-158:end -->

<a id="cap-163"></a>
<!-- migrated:cap-163:start -->
## 138. نقل بطاقة نمط المنظومة إلى تبويب تخصيص الموديولات والأنشطة (Relocating Industry Mode Selector to Modules Settings Tab)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready - Logical Tab Separation)
* **المسارات في الكود:**
  - `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`:
    1. حذف استدعاء ومكون `IndustryModeSelectorCard` بالكامل من تبويب الإعدادات العامة («عام»).
    2. تحرير تبويب «عام» ليركز حصرياً على هوية المنشأة الأساسية (اسم النشاط، الشعار المطبوع، العملة، الضريبة، ومعلومات التواصل) دون أي بطاقات عزل موديولات ضخمة تؤثر على التناسق البصري.
    3. استعادة تعريف `isSuperAdmin` واستيراد `isPlatformAdmin` لمنع خطأ `ReferenceError: isSuperAdmin is not defined` وتحديث التلميح الذكي في بادج النشاط ليرشد إلى مكانه الجديد في تبويب «تخصيص المنظومة والنشاط».
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`:
    1. إدراج مكون `IndustryModeSelectorCard` في قمة تبويب «تخصيص المنظومة والنشاط» (`activeTab === 'modules'`) مخصصاً للسوبر أدمن (`isSuperAdmin`).
    2. التكامل السلس مع إدارة الموديولات والباقات التشغيلية بحيث يختار السوبر أدمن النمط والنشاط التشغيلي في نفس موضع التحكم بباقات وموديولات النظام.
* **فحص الجودة والسلامة البرمجية:**
  - فحص TypeScript للفرونت إند: **Code 0 (Zero Errors)**.

---


<!-- migrated:cap-163:end -->

<a id="cap-164"></a>
<!-- migrated:cap-164:start -->
## 139. إزالة شريط القوالب القديم المكرر وتوحيد إدارة الأنماط والموديولات (Eliminating Duplicate QuickBar & Consolidating Modular Controls)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready - Zero Duplication)
* **المسارات في الكود:**
  - `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`:
    1. حذف كارت شريط القوالب السريع القديم (`SmartModularQuickBar`) الذي كان يكرر أسماء الأنشطة والأنماط بشكل مزدوج أسفل بطاقة العزل القطاعي الشامل.
    2. اعتماد `IndustryModeSelectorCard` كمصدر موحد ووحيد للحقيقة (Single Source of Truth) لاختيار الأنماط والتخصصات الفرعية الـ 7.
    3. حذف نافذة «معالج التخصيص والمنيو القديم» (`SmartModularConfiguratorModal`) والزر المرتبط بها بالكامل للتخلص الجذري من تكرار قوالب الأنشطة الموروثة، ليصبح متجر التطبيقات الرسمي المعتمد (`/apps`) والخيارات اليدوية هما المرجعان الحصريان لإدارة موديولات المنظومة.
    4. إزالة البانر الأصفر القديم للسوبر أدمن («وضع السوبر أدمن: يمكنك تفعيل وتجربة أي موديول...») الذي كان يمثل حاجزاً بصرياً غير مبرر يقطع الصفحة، مما جعل الانتقال البصري بين بطاقة الأنماط ومتجر التطبيقات سلساً ومؤسسياً متكاملاً.
* **فحص الجودة والسلامة البرمجية:**
  - فحص TypeScript للفرونت إند: **Code 0 (Zero Errors)**.

---


<!-- migrated:cap-164:end -->

<a id="cap-169"></a>
<!-- migrated:cap-169:start -->
## 141. إدارة تهيئة المخزون وتصفير البيانات للبدء الفعلي (Operational Inventory Reset & Catalog Wipe Engine)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready)
* **المسارات في الكود:**
  - `backend/src/modules/settings/services/settings-demo-data.service.ts`: دوال `resetStockBalances` و `wipeCatalogAndStock` مع فحص كلمة مرور المدير (`assertAdminAndPassword`) وأخذ نسخة احتياطية Snapshot تلقائية وتسجيل النشاط في سجل التدقيق `audit_logs`.
  - `backend/src/modules/settings/controllers/settings-admin.controller.ts`: مسارات الـ API المحمية بجارد الإدارة (`POST /api/admin/reset-stock-balances` و `POST /api/admin/wipe-catalog-products`).
  - `frontend/src/features/settings/api/settings.api.ts`: دوال `resetStockBalances` و `wipeCatalogProducts`.
  - `frontend/src/features/settings/components/workspace-sections/SettingsBackupImportSection.tsx`: بطاقة `InventoryOperationsResetCard` المؤسسية التفاعلية مع نافذة تأكيد أمنية بحماية كلمة المرور وتوضيح شفاف للبيانات المحفوظة وتلك التي سيتم تصفيرها.
* **القدرات والوظائف المعتمدة:**
  1. **تصفير أرصدة المخزون والحركات لبدء العمل الفعلي (Reset Stock Balances to Zero):**
     - تصفير كميات وأرصدة كافة الأصناف في جميع المخازن لتصبح `0`، وحذف حركات المخزون والتحويلات وجلسات الجرد والتوالف والفواتير المعلقة، مع **الحفاظ الصارم والتام على بيانات الأصناف، الباركودات، الأسعار، التصنيفات، والوحدات**.
  2. **مسح كافة الأصناف والمخزون كلياً (Wipe All Catalog Products & Stock):**
     - مسح كافة الأصناف والتصنيفات والكتالوج بالكامل مع حركات المخزون للبدء بكتالوج جديد، مع **الحفاظ الصارم على بيانات المنشأة (اسم المنشأة، الشعار، العنوان، أرقام الهواتف)، الفروع، المخازن، المستخدمين والصلاحيات، التفضيلات، والاشتراك**.
  3. **الأمان والحوكمة والنسخ الاحتياطي التلقائي:**
     - اشتراط كلمة مرور حساب المدير للتنفيذ، مع أخذ لقطة احتياطية كاملة (Backup Snapshot) تلقائياً قبل أي عملية، وتسجيل العملية في سجلات التدقيق.





---


<!-- migrated:cap-169:end -->

<a id="cap-170"></a>
<!-- migrated:cap-170:start -->
## 144. منظومة العزل والتخصيص الديناميكي لشاشات الإعدادات طبقاً لمود النشاط (Mode-Based Dynamic Settings Isolation & Vertical Configuration Suite)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready)
* **المسارات في الكود:**
  - `frontend/src/features/settings/schemas/settings.schema.ts`: تعريف وضبط الحقول والتحققات لجميع المودات مع القيم الافتراضية الآمنة.
  - `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`: إدارة الحالة والتهيئة، الميتاداتا، والعناوين الديناميكية للتبويبات بناءً على نمط النشاط.
  - `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`: التخصيص التلقائي لتسميات المنشأة ونمط الكاشير، واستبدال عناصر القوائم بـ `CustomSelect`.
  - `frontend/src/features/settings/components/forms/tabs/SalesInventorySettingsTab.tsx`: العزل التام لإعدادات نقاط البيع والتجزئة، وإضافة الأجنحة التخصصية لكل قطاع تشغيلي مع أيقونات هندسية مخصصة.
  - `frontend/src/features/settings/components/forms/tabs/PrintingSettingsTab.tsx`: عزل خيارات إيصالات الكاشير الحرارية وطابعات المطبخ للمطاعم، وتوجيه الوثائق إلى ورق A4 الرسمي للقطاعات الهندسية والمؤسسية، وتوحيد القوائم عبر `CustomSelect`.
* **القدرات والوظائف المعتمدة:**
  1. **عزل إعدادات التجزئة ونقاط البيع عن الأنشطة المؤسسية:**
     - حظر ظهور إعدادات الكاشير والتجزئة (البيع على المكشوف بالسالب، إلزام إغلاق الورديات، تنبيهات صلاحية الأغذية والأدوية 15/30/60 يوم، أيام المنتجات الراكدة، نمط صرف المخزون للفروع، وتخصيص طاولات المطاعم) في مود المقاولات والشحن والاستيراد والخدمات، وقصرها حصرياً على مودات التجارة والتجزئة (`isRetailCommerce`).
  2. **الجناح التخصصي لمود المقاولات والمشاريع الكبرى (`contracting`):**
     - **نسبة ضمان حسن التنفيذ المحتجزة (Retention Guarantee %):** ضبط النسبة التعاقدية الافتراضية (افتراضي 5%) المحتجزة من مستخلصات المقاول العام ومقاولي الباطن.
     - **نمط استرداد الدفعة المقدمة (Advance Recovery Mode):** الاختيار بين الاسترداد النسبي التناسبي مع كل مستخلص (Proportional) أو الاستقطاع بمبلغ ثابت (Fixed).
     - **هوامش ومحددات التسعير الافتراضية لدراسة العطاءات (Tender Estimator Margins):** هامش الربح المستهدف %، المصاريف الإدارية والعمومية (Overhead %)، ونسبة الهالك المسموح به في المواد والبنود (Material Waste %).
     - **حوكمة صرف وتشوين المواد بالموقع:** خيار اشتراط الربط الصريح برقم بند المقايسة المعتمد (`contractingRequireBoqLinkForIssue`) لضبط الرقابة الميدانية.
     - **توريدات المالك/العميل بتكلفة صفرية (Zero Cost for Client-Supplied Items):** السماح بإدخال الخامات التوريدية من المالك بتكلفة 0 دون المساس بالقيود المحاسبية.
     - **رصيد الأمان الحرج للمواد بالموقع (Site Safety Stock Threshold):** حد أدنى حرج لتشغيل بنود ومواد الموقع الميدانية.
  3. **الجناح التخصصي لمود الشحن والعمليات الملاحية واللوجستية (`maritime`):**
     - ضبط فترة السماح لغرامات الأرضيات والتأخير (Demurrage Free Days - الافتراضي 14 يوم للحاويات)، وتحديد العملة التشغيلية المعتمدة لخطوط الملاحة (USD / EUR / EGP).
  4. **الجناح التخصصي لمود الاستيراد والتجارة الدولية (`import_export`):**
     - تحديد طريقة توزيع التكاليف والرسوم الجمركية على الشحنات (Landed Cost Allocation: بالوزن الإجمالي، القيمة الجمركية CIF، أو الحجم CBM)، والربط الآلي للمصروفات البنكية للاعتمادات المستندية.
  5. **الجناح التخصصي لمود التصنيع والإنتاج الصناعي (`manufacturing`):**
     - ضبط نمط صرف خامات ومكونات الإنتاج الافتراضي (صرف نهائي لأمر التشغيل / تحويل لمستودع تشغيل)، حد التنبيه لنقص المواد الخام والمكونات، السماح بسعر شراء صفر لخامات وعينات التشغيل، والسماح بصرف الخامات بالسالب لتفادي توقف خطوط الإنتاج.
  6. **الجناح التخصصي لمود الخدمات والاستشارات المهنية (`services`):**
     - تحديد طريقة الفوترة التشغيلية للمشاريع (بالساعة Hourly، حسب الإنجاز Milestone، أو اشتراك دوري Retainer)، وإشعارات تجديد عقود الصيانة والخدمة مسبقاً (30 يوم).
  7. **التخصيص الدقيق للتخصصات الفرعية لقطاع التجارة (Commerce Sub-Verticals):**
     - **المطاعم والكافيهات (`restaurant`):** قصر كارت "عدد طاولات الصالة" (1 إلى 200 طاولة)، طابعات المطبخ (KOT)، وتذاكر التحضير والمناداة حصرياً عليها.
     - **الصيدليات والمستلزمات الطبية (`pharmacy`):** إبراز محرك تواريخ الصلاحية والتشغيلات (FEFO) وتنبيهات الأدوية الراكدة، مع حجب إعدادات المطاعم والمقاولات.
     - **الملابس والأزياء (`clothing`):** تخصيص مسميات المتجر وبوتيك الأزياء ومصفوفة المقاسات والألوان.
     - **قطع الغيار والسيارات (`auto_parts`):** تخصيص مسميات مراكز ومنافذ بيع قطع الغيار وأرقام OEM.
     - **مراكز صيانة الأجهزة (`maintenance`):** تخصيص مسميات ورش ومراكز الصيانة وكروت الأجهزة وسيريال الـ IMEI.
  8. **الامتثال الصارم لدستور النظام البصري والمعماري:**
     - القضاء التام على كافة عناصر القوائم المنسدلة التقليدية `<select>` واستبدالها بنظام الكومبوبوكس الموحد `CustomSelect` (Rule 13).
     - الالتزام التام بـ 0 إيموجيز وحظر أيقونات النجوم/الشرارة واستخدام الأيقونات التشغيلية المعتمدة (Rule 4 & 7).
     - توافق الشاشات من 14 إلى 32 بوصة وتخطيط RTL متكامل (Rule 11).

---


<!-- migrated:cap-170:end -->

<a id="cap-173"></a>
<!-- migrated:cap-173:start -->
## 141. إدارة تهيئة المخزون وتصفير البيانات للبدء الفعلي (Operational Inventory Reset & Catalog Wipe Engine)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Enterprise Production Ready)
* **المسارات في الكود:**
  - `backend/src/modules/settings/services/settings-demo-data.service.ts`: دوال `resetStockBalances` و `wipeCatalogAndStock` مع فحص كلمة مرور المدير (`assertAdminAndPassword`) وأخذ نسخة احتياطية Snapshot تلقائية وتسجيل النشاط في سجل التدقيق `audit_logs`.
  - `backend/src/modules/settings/controllers/settings-admin.controller.ts`: مسارات الـ API المحمية بجارد الإدارة (`POST /api/admin/reset-stock-balances` و `POST /api/admin/wipe-catalog-products`).
  - `frontend/src/features/settings/api/settings.api.ts`: دوال `resetStockBalances` و `wipeCatalogProducts`.
  - `frontend/src/features/settings/components/workspace-sections/SettingsBackupImportSection.tsx`: بطاقة `InventoryOperationsResetCard` المؤسسية التفاعلية مع نافذة تأكيد أمنية بحماية كلمة المرور وتوضيح شفاف للبيانات المحفوظة وتلك التي سيتم تصفيرها.
* **القدرات والوظائف المعتمدة:**
  1. **تصفير أرصدة المخزون والحركات لبدء العمل الفعلي (Reset Stock Balances to Zero):**
     - تصفير كميات وأرصدة كافة الأصناف في جميع المخازن لتصبح `0`، وحذف حركات المخزون والتحويلات وجلسات الجرد والتوالف والفواتير المعلقة، مع **الحفاظ الصارم والتام على بيانات الأصناف، الباركودات، الأسعار، التصنيفات، والوحدات**.
  2. **مسح كافة الأصناف والمخزون كلياً (Wipe All Catalog Products & Stock):**
     - مسح كافة الأصناف والتصنيفات والكتالوج بالكامل مع حركات المخزون للبدء بكتالوج جديد، مع **الحفاظ الصارم على بيانات المنشأة (اسم المنشأة، الشعار، العنوان، أرقام الهواتف)، الفروع، المخازن، المستخدمين والصلاحيات، التفضيلات، والاشتراك**.
  3. **الأمان والحوكمة والنسخ الاحتياطي التلقائي:**
     - اشتراط كلمة مرور حساب المدير للتنفيذ، مع أخذ لقطة احتياطية كاملة (Backup Snapshot) تلقائياً قبل أي عملية، وتسجيل العملية في سجلات التدقيق.

---


<!-- migrated:cap-173:end -->

<a id="cap-195"></a>
<!-- migrated:cap-195:start -->
## 164. معيار عزل نمط المحلات المبسط عن نمط المؤسسات المتقدم (Commercial Scope & Operation Mode Standard)
* **حالة الوحدة العامة:** 🟢 مكتمل ومطبق 100% (Production Ready).
* **المشكلة المعمارية التي تم حلها:**
  - القضاء التام على ظاهرة "صدمة التعقيد" (Cognitive Overload) لدى أصحاب المحلات والأنشطة التجارية الصغيرة، حيث كان يظهر للمحل البسيط أكثر من 38 عنصراً معقداً في القائمة الجانبية (شجرة حسابات، قيود يومية، شيكات PDC، تسويات بنكية، أرفف تخزين Bins، أوامر شراء RFQ، أوامر بيع SO...).
* **الحل المعماري المنجز:**
  1. **النمط التجاري المبسط (Simple Retail Mode - `enableEnterpriseFeatures: false`):**
     - **المبيعات:** تقتصر على نقاط البيع (POS)، سجل الفواتير، مرتجعات المبيعات، العملاء، والمناديب. (إخفاء CRM، أوامر البيع وحجز المخزون، عروض الأسعار، وقوائم الأسعار).
     - **المشتريات:** تقتصر على فواتير المشتريات المباشرة، إنشاء فاتورة شراء، المرتجعات، والموردين. (إخفاء أوامر الشراء PO، عروض الأسعار RFQ، ومقترح إعادة الطلب).
     - **المخزون:** يقتصر على دليل الأصناف، إضافة صنف، الأقسام، المستودعات، وجرد المخزون. (إخفاء شجرة المخازن، أرفف التخزين Bins، وأذونات الصرف والتحويل).
     - **المالية:** تحويل المسمى حصرياً إلى **"الخزينة والمصروفات"**، وتقتصر على الخزينة/درج النقدية والمصروفات اليومية. (إخفاء شجرة الحسابات، قيود اليومية، مراكز التكلفة، حافظة الشيكات PDC، التسويات البنكية، الميزانية العمومية، التدفقات النقدية، الإقرارات الضريبية، والأصول والإهلاك).
  2. **النمط المؤسسي المتقدم (Enterprise Trading Mode - `enableEnterpriseFeatures: true`):**
     - تفعيل الدورة المستندية المحاسبية واللوجستية الكاملة للمؤسسات والشركات الكبرى وتجارة الجملة.
  3. **بطاقة اختيار نمط التشغيل في الإعدادات (`GeneralSettingsTab.tsx`):**
     - بطاقة تفاعلية أنيقة تتيح لمدير المنشأة التبديل الفوري بنقرة واحدة بين النمطين مع شارة توضيحية وحفظ التفضيل.
  4. **دستور المحاسبة الصامتة في الخلفية (Silent Double-Entry Ledger):**
     - الباك إند يستمر في تدوين القيود المحاسبية وتغذية الأستاذ العام تلقائياً تحت السطح في النمط المبسط، لضمان جهوزية الدفاتر والقوائم المالية فور ترقية النشاط للنمط المؤسسي.
  5. **عزل الأنشطة التخصصية:**
     - تثبيت النمط المؤسسي تلقائياً لقطاعات المقاولات، الشحن، والتصنيع لطبيعتها التعاقدية.
* **الملفات المحدثة:**
  - `frontend/src/shared/layout/app-shell.tsx`: حجب العناصر المتقدمة تلقائياً وتحديث مسمى وقوائم مجموعة المالية والمشتريات والمبيعات والمخزون وفق النمط.
  - `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`: إضافة بطاقة اختيار نمط تشغيل المنشأة (Operation Mode).
  - `backend/src/modules/settings/settings.service.ts`: تمكين مسؤولي المنشأة من حفظ خيار النمط التشغيلي دون قفلها على السوبر أدمن حصراً.
  - `backend/src/modules/saas-admin/trial-tenant-provisioning.service.ts`: ضبط القيمة الافتراضية للمحلات والتجزئة بالنمط المبسط، وللأنشطة الكبرى بالنمط المتقدم.
  - `AGENTS.md` (بند 18) و `GEMINI.md` (بند 29).
* **فحص الجودة والسلامة البرمجية:**
  - فحص TypeScript (Frontend + Backend): `npx tsc --noEmit` نظيف بنسبة 100% بدون أي أخطاء (`0 errors`).

---


<!-- migrated:cap-195:end -->

<a id="cap-225"></a>
<!-- migrated:cap-225:start -->
## 190. دستور عزل الأنماط المؤسسية والباقات التابعة والتطابق متعدد القنوات (Universal Omnichannel Vertical Isolation, Dependent Plans Constitution & Real Functional Wiring)
* **الحالة / الإنجاز:** 🟢 مكتمل 100% ومتحقق على مستوى كامل المنظومة (2 أكتوبر 2026).
* **المرجعية المعمارية:** `PRICING_AND_PACKAGING.md`, `ARCHITECTURE_INVARIANTS.md` §2.10 (ISO-VERT-1..8).
* **المشكلة التي تم استئصالها:**
  1. عند اختيار نمط الشحن اللوجستي أو المقاولات، كان الكمبيوتر معزولاً بنجاح بينما واجهة الموبايل تسرب أزرار التجزئة (نقطة البيع POS في الشريط السفلي، وأزرار قارئ الباركود وإضافة منتج وفاتورة شراء في نافذة `+`).
  2. في نافذة تعديل باقة المنشأة ولوحة الساس، عند اختيار نمط الشحن أو المقاولات كانت القائمة المنسدلة للباقات تعرض مسميات تجزئة غير متوافقة ("تجزئة عامة — محل"، "معارض ومحلات").
  3. محرك مزامنة الإعدادات بالباك إند (`syncTenantModuleSettingsForPlan`) كان يفرض تفعيل `posModuleEnabled = true` و `weightedBarcodeEnabled = true` عند وجود ميزة `sales` دون التحقق من هوية ونشاط المنشأة.
* **الحلول والترقيات الهندسية المنفذة:**
  1. **المصدر الموحد لاستنتاج النمط وعزله (`vertical-scope.ts`):**
     - دالة `resolveCurrentVertical(tenant, settings)` لاستنتاج النمط المعتمد (`maritime`, `contracting`, `wholesale_van`, `manufacturing`, `restaurant`, `pharmacy`, `maintenance`, `services`, `retail_general`).
     - مصفوفة الحظر والسماح الصارم للمسارات والموديولات `isRouteAllowedInVertical` لحجب أي صفحة غير متوافقة حتى مع التصفح بالرابط المباشر.
  2. **التطابق الشامل للموبايل (Omnichannel Mobile Parity):**
     - شريط تنقل سفلي ديناميكي (`MobileBottomNav`): للشحن (أوامر التشغيل)، للمقاولات (المشاريع والمستخلصات)، للجملة (المناديب وفواتير الجملة)، للتصنيع (أوامر الإنتاج)، وللتجزئة فقط (نقطة البيع).
     - نافذة إجراءات سريعة ميدانية مخصصة (`MobileQuickActionSheet`): 6 إجراءات متخصصة لكل نمط (تتبع الحاويات وبوالص الشحن في اللوجستيات؛ مستخلصات ويوميات الموقع في المقاولات).
  3. **دستورية مصفوفة الأنماط والباقات التابعة (`vertical-catalog.ts`):**
     - اعتماد الأنماط الستة عشر الرسمية المطابقة لدستور التسعير والتحزيم:
       - النطاق 5: الشحن اللوجستي والموانئ، المقاولات والمشاريع الهندسية.
       - النطاق 4: تجارة وتوزيع الجملة والفان، التصنيع والإنتاج، الاستيراد والتصدير، الشركات الخدمية الاستشارية، المتاجر الرقمية.
       - النطاق 3: المطاعم والكافيهات والضيافة.
       - النطاق 2: الصيدليات، الإلكترونيات والصيانة، معارض التقسيط.
       - النطاق 1: السوبرماركت، الملابس، العطارة والمحامص، العطور، والتجزئة العامة.
     - تصفية الباقات ديناميكياً (`getPlansForVertical`): عند اختيار الشحن أو المقاولات تُحجب كافة باقات التجزئة والمحلات تلقائياً وتقتصر الخيارات حصرياً على باقات المؤسسات الكبرى.
  4. **الربط الفعلي والتنفيذي بقاعدة البيانات (Real Functional DB Wiring):**
     - تحديث `updateTenantPlan` في `saas-admin.service.ts` لحفظ `activity_type` وتطبيق `getIndustrySettingsPatch` ومزامنة مفاتيح الموديولات وإبطال الكاشات تلقائياً.
     - تحصين `syncTenantModuleSettingsForPlan`: منع تفعيل `posModuleEnabled` أو `weightedBarcodeEnabled` قطعياً للمنشآت غير التجزئة (الشحن، المقاولات، الجملة، الخدمات) واعتبار `sales` في هذه القطاعات ترخيصاً لمستخلصات وفواتير المطالبات وعقود النولون.
     - دعم كامل لكافة الأنماط الـ 16 في `industry-profiles.ts` و `trial-tenant-provisioning.service.ts`.
* **الملفات المتصلة:**
  - `frontend/src/shared/verticals/vertical-scope.ts`
  - `frontend/src/shared/verticals/vertical-catalog.ts`
  - `frontend/src/shared/layout/MobileBottomNav.tsx`
  - `frontend/src/shared/layout/MobileQuickActionSheet.tsx`
  - `frontend/src/features/saas-admin/components/UpdateTenantPlanModal.tsx`
  - `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`
  - `backend/src/modules/saas-admin/saas-admin.service.ts`
  - `backend/src/modules/saas-admin/trial-tenant-provisioning.service.ts`
  - `backend/src/core/tenant/industry-profiles.ts`
  - `frontend/src/shared/system/DeveloperActivationPanel.tsx`
  - `frontend/src/app/router/access.ts`
  - `frontend/src/shared/components/GlobalSearchModal.tsx`
  - `frontend/src/shared/layout/app-shell.tsx`


<!-- migrated:cap-225:end -->

<a id="cap-244"></a>
<!-- migrated:cap-244:start -->
## 167. العزل والتخصيص القطاعي الشامل لتبويبات وشاشات الإعدادات (Vertical-Scoped Enterprise Settings Isolation & Specialization Suite - 8 October 2026)
- **الحالة:** مكتملة بنسبة 100% ومطبقة عبر الباك إند والفرونت إند.
- **التفاصيل التشغيلية:**
  1. **عزل وتخصيص الإعدادات العامة (`settings/core`):**
     - إخفاء قسم "مصدر مخزون البيع للفرع" التابع لنقاط البيع والتجزئة في أنشطة الشحن والمقاولات.
     - تعديل الترويسات والمسميات ديناميكياً: "المكتب الملاحي والمقر التشغيلي الافتراضي" في الشحن، و"المقر وموقع العمل التشغيلي الافتراضي" في المقاولات، مع الحفاظ على مسميات الفروع للتجزئة.
  2. **عزل وتخصيص البيانات المرجعية (`settings/reference`):**
     - فلترة وحجب سيارات التوزيع والفان (`VAN_*` / "سيارة مندوب") من الظهور في مواقع التخزين لأنشطة الشحن والمقاولات.
     - تخصيص ترويسات ومسميات البطاقات: "المقرات والمكاتب الملاحية" و"الموانئ ومحطات ومستودعات الحاويات" في الشحن، و"المقرات ومواقع العمل" و"مخازن التشوين الميدانية" في المقاولات.
  3. **عزل وإعادة هيكلة إدارة المستخدمين والأدوار (`settings/users`):**
     - تخصيص الدور التشغيلي بدلاً من كاشير: "مسؤول عمليات شحن وتتبع ملاحي (Operations Specialist)" في الشحن، و"مهندس موقع / مسؤول مشاريع ومستخلصات" في المقاولات.
     - تخصيص أمثلة الحقول والـ Placeholders (`ahmed_ops` للشحن و`eng_ahmed` للمقاولات بدلاً من `ahmed_pos`).
     - إعادة هيكلة مجموعات الصلاحيات ديناميكياً حسب النشاط: إبراز مجموعات الشحن (Jobs, Containers, RFQs, Inquiries, Quotations, Policies) والمقاولات (Projects, IPC, BOQ, Daily Logs) مع حجب صلاحيات التجزئة ونقاط البيع (وردية الكاشير، فتح الدرج، البيع بالجملة، المرتجع المباشر).
     - تحديث قوالب الصلاحيات السريعة وإحصائيات المستخدمين لتطابق مسميات القطاع.
  4. **حجب المتجر الإلكتروني والربط الخارجي (`settings/storefront` & `settings/marketplaces`):**
     - حظر ظهور تبويبات المتجر والمنصات الخارجية في شريط الإعدادات للقطاعات غير التجارية، وحمايتها في `vertical-scope.ts`.
  5. **محاذاة كتالوج الاشتراكات والباقات السحابية (`settings/subscription`):**
     - ترقية محرك الباقات بالباك إند (`pricing-catalog.service.ts`) لمطابقة مسميات الأنشطة القياسية (`maritime_freight` -> `maritime`, `construction` -> `contracting`) وعرض الباقات السنوية المتخصصة لكل قطاع بدلاً من باقات محلات التجزئة العامة.
     - تخصيص شارات وبطاقات الاستهلاك للحدود القياسية لكل قطاع (المكاتب والمقرات، المشاريع النشطة، الحاويات الشهرية).
- **الملفات المعدلة:**
  - `backend/src/modules/tenant-subscription/pricing/pricing-catalog.service.ts`
  - `backend/src/modules/tenant-subscription/tenant-subscription.service.ts`
  - `frontend/src/shared/verticals/vertical-scope.ts`
  - `frontend/src/features/settings/pages/SettingsSectionTabs.tsx`
  - `frontend/src/features/settings/components/forms/tabs/GeneralSettingsTab.tsx`
  - `frontend/src/features/settings/hooks/useSettingsReferenceFilters.ts`
  - `frontend/src/features/settings/components/workspace-sections/reference-section/cards.tsx`
  - `frontend/src/features/settings/components/user-management.shared.ts`
  - `frontend/src/features/settings/components/user-management/UserManagementPermissionGroups.tsx`
  - `frontend/src/features/settings/components/user-management-panels/UserManagementEditorCard.tsx`
  - `frontend/src/features/settings/components/user-management/UserManagementListControls.tsx`
  - `frontend/src/features/settings/components/UserManagementPanels.tsx`
  - `frontend/src/features/settings/components/UserManagementSection.tsx`
  - `frontend/src/features/settings/hooks/useUserManagement.helpers.ts`
  - `frontend/src/features/settings/hooks/useUserManagement.helpers.spec.ts`
  - `frontend/src/features/settings/hooks/useUserManagementController.ts`
  - `frontend/src/features/settings/components/subscription/CurrentSubscriptionHeroCard.tsx`
  - `frontend/src/shared/components/dialog-shell.tsx`

---


<!-- migrated:cap-244:end -->

<a id="cap-245"></a>
<!-- migrated:cap-245:start -->
## 204. دستور عزل الإعدادات حسب النشاط (Vertical Isolation) وضغط نافذة المستخدمين بدون سكرول (Universal Zero-Scroll User Modal)

- **الحالة:** مكتمل ومعتمد 100% (Completed & Verified).
- **نسبة الإنجاز:** 100%.
- **الوصف التشغيلي:**
  1. **حل مشكلة سكرول الماوس بالكامل في النوافذ المنبثقة (`dialog-shell.tsx`):**
     - إصلاح اعتراض أحداث عجلة الفأرة (`preventBackgroundWheel`) بالسماح بالتمرير الداخلي السلس عند وجود مساحة تمرير فعلية في النافذة وحظر تسريب التمرير إلى خلفية الشاشة عند بلوغ الحدود فقط.
  2. **دستور العرض الكامل والضغط الفائق بدون سكرول (Universal Zero-Scroll Standard):**
     - توسيع النافذة إلى `width="min(1280px, 97vw)"`، هيدر مدمج بسطر واحد، وتوزيع بيانات المستخدم في صفين فقط (4 أعمدة متوازنة).
     - القضاء التام على قطع وبتر النصوص (`textOverflow: 'ellipsis'`) وإظهار أسماء الصلاحيات كاملة مع الالتفاف الطبيعي (`whiteSpace: 'normal'`) وتوسيع خانات البنود إلى أعمدة رحبة (`minmax(210px, 1fr)` للعمليات و `minmax(160px, 1fr)` للبيانات).
     - توزيع مجموعات الصلاحيات في شبكة متوازنة ثلاثية الأعمدة (البطاقة الرئيسية تمتد على خانتين وبجوارها الموارد البشرية، والصف الثاني يضم البطاقات الثلاث المتبقية)، مما يحقق امتلاءً بنسبة 100% بدون أي خانات فارغة.
  3. **الاختيار التلقائي والإلزامي للمقرات والفروع:**
     - عند وجود فرع/مقر ملاحي واحد فقط يتم اختياره وتعيينه كمقر افتراضي تلقائياً عند فتح إضافة مستخدم جديد.
     - عند وجود أكثر من فرع لا يتم تحديد أي منها تلقائياً، ويتم إلزام المدير باختيار فرع واحد على الأقل مع منع الحفظ وإظهار رسالة تحقق مخصصة حسب النشاط.
  4. **العزل والتطهير التام لمود الشحن الملاحي (Maritime Freight Isolation):**
     - تطهير مصفوفة صلاحيات الشحن من بنود التجزئة البحتة: حذف `canDiscount` (تعديل الخصم)، و `canEditPrice` (تعديل السعر)، و `services` (الخدمات).
     - تخصيص مسميات الصلاحيات لتناسب التوكيلات الملاحية: «الخطوط الملاحية والناقلون»، «كشوف حسابات العملاء والخطوط»، «طباعة بوالص الشحن والفواتير»، و«تعديل فواتير ومطالبات الشحن».
     - حجب تبويب `مناديب التوصيل والفان (Drivers)` من شاشة المستخدمين عند تفعيل مود الشحن أو المقاولات.
     - حجب تبويب `التجارة الإلكترونية والمنصات` (Amazon / Noon / Storefront) من شريط الإعدادات الرئيسي عند تفعيل مود الشحن أو المقاولات.
- **الاختبارات:** اجتياز 100% لكافة الاختبارات في `useUserManagement.helpers.spec.ts` و `vertical-scope.spec.ts`.

---

## تحديث 2026-11-15: تحرير باركود الميزان عبر كافة أنشطة المنظومة

- أُزيلت قيود حجب وتصفير `weightedBarcodeEnabled` من `SettingsMainForm.tsx` (`isWarehousingVertical`) و `AppsStorePage.tsx` (`CONTRACTING_ALLOWED_KEYS` / `MARITIME_ALLOWED_KEYS` مع إبطال `queryKeys.posSettings`) و `apps-catalog.tsx` و `modular-presets.ts` (إزالة التبعية القسرية لـ `posModuleEnabled` وحذفها من `disabledModules`) و `SalesInventorySettingsTab.tsx` و `ModulesSettingsTab.tsx` بحيث يظهر ويعمل إعداد باركود الميزان طالما كان مفعّلاً أياً كان نشاط المنشأة.
- تفاصيل محرك القراءة والاختبارات المالك لها في [SALES_CAPABILITIES.md](SALES_CAPABILITIES.md#L155) والثوابت في [ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md#L3073-L3074).

<!-- migrated:cap-245:end -->
