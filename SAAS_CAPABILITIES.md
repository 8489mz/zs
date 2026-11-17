# قدرات إدارة المنصة والاشتراكات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **إدارة المنصة والاشتراكات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/public/`، `backend/src/modules/saas-admin/`، `backend/src/modules/tenant-subscription/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [الهوية والأمان وعزل الشركات](PLATFORM_CAPABILITIES.md) · [الإعدادات والأنشطة والباقات](SETTINGS_CAPABILITIES.md)

## التحديثات الحالية

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

<a id="saas-plan-tiers-checkout-alignment"></a>
### مواءمة باقات النطاقات `BAND*_L*` في لوحة الساس والدفع الإلكتروني (2026-11-16)
- **السلوك الحالي والحدود:** تم ربط `PricingCatalogService.levelIdForLegacyPlanCode` و`TenantSubscriptionService.getMySubscription` و`SaasAdminService` و`TenantSubscriptionPage` و`TenantWelcomeShareModal` و`CreateTrialTenantModal` بمحرك توحيد الباقات، بحيث تُطابق صفحة اشتراك المنشأة صف `saas_plans` المطابق لـ `pricingBand` + `pricingLevel` قبل أي سقوط افتراضي، وتختفي أخطاء 404 عند تجديد أو ترقية باقات `BAND1_L1`..`BAND5_L3` أونلاين.
- **المجال المالك للتفاصيل والاختبارات:** [قدرات الإعدادات والأنشطة والباقات — توحيد توافق الباقات](SETTINGS_CAPABILITIES.md#settings-apps-store-plan-compatibility).
- **مصدر التنفيذ:** `backend/src/modules/saas-admin/saas-admin.service.ts`، `backend/src/modules/tenant-subscription/pricing/pricing-catalog.service.ts`، `backend/src/modules/tenant-subscription/tenant-subscription.service.ts`، `frontend/src/features/settings/api/tenant-subscription.api.ts`، `frontend/src/features/settings/pages/TenantSubscriptionPage.tsx`، `frontend/src/features/saas-admin/components/TenantWelcomeShareModal.tsx`، `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`.


<a id="saas-tenant-feature-overrides"></a>
### تجاوزات الميزات لكل منشأة من السوبر أدمن (2026-11-17)
- **السلوك الحالي والحدود:** يستطيع السوبر أدمن منح أو إخفاء أي ميزة لمنشأة معينة فوق إعدادات النمط الافتراضية (أول استخدام: نقطة البيع والدرج على `wholesale_van`)، عبر جدول `tenant_feature_overrides` (صف واحد لكل منشأة+ميزة، `granted` صحيح/خطأ، مع سبب ومدقق). المنح يفتح كل المستويات (حارس الصلاحيات `hasFeature`، `resolvePillarScopedFeatures`، إعدادات المنشأة، القائمة الجانبية، حارس المسارات `isRouteAllowedInVertical`)؛ الإخفاء يغلقها بإحكام حتى مع وجود الصلاحية. المنح يبقى بعد حفظ الإعدادات وتغيير النشاط ومزامنة الباقة؛ عند منح نقطة البيع يُكتب `posModuleEnabled=true` و`requireCashierShiftForSales=true`، ومبيعات نقطة البيع تخصم من مخزون فرع المستودع لا مخزون الفان، ونقد الدرج لا يختلط بنقد تسوية الرحلة. كل تغيير يُسجَّل بحدث تدقيق `SAAS_TENANT_FEATURE_OVERRIDE`. الإعدادات الافتراضية عند التهيئة لم تتغير.
- **مصدر التنفيذ:** `backend/src/database/migrations/2040000000336_tenant_feature_overrides.ts`، `backend/src/core/auth/services/plan-feature.service.ts`، `backend/src/core/tenant/industry-profiles.ts`، `backend/src/modules/settings/settings.service.ts`، `backend/src/modules/saas-admin/saas-admin.service.ts`، `backend/src/modules/sales/services/create-sale.service.ts`، `backend/src/modules/cash-drawer/cash-drawer.controller.ts`، `frontend/src/features/saas-admin/components/UpdateTenantPlanModal.tsx`.
- **الانحدار المكتوب:** `backend/test/critical/van-general-feature-overrides.spec.ts` (10 حالات، شُغِّل بـ `ts-node` العادي: نجاح، خروج 0) + `backend/test/critical/architecture-guard.spec.ts` (خروج 0). `INV-VAN-GENERAL-FEATURE-OVERRIDES`.

<a id="saas-sandbox-cloud-failclosed-p0a"></a>
### حصر محاكاة تجديد الاشتراك خارج Cloud SaaS — تدقيق مصدر الكود 25 أكتوبر 2026
- السلوك الحالي: إتمام دفع تجريبي يولّد اشتراكًا حقيقيًا، لذلك يُرفض في Cloud SaaS حتى لو غابت مفاتيح بوابات الدفع، ويُسمح به فقط في الوضع المحلي الصريح دون بوابة حقيقية. لا يتحول فشل XPay/Paymob/Stripe إلى نجاح افتراضي.
- الملفات المالكة: `tenant-subscription.controller.ts`، `gateways/payment-manager.service.ts`، `gateways/subscription-sandbox-policy.ts`، ملفات XPay/Paymob/Stripe.
- الانحدار المكتوب: `backend/test/critical/subscription-sandbox-boundary.spec.ts`. لا تعني هذه الحالة التحقق التنفيذي من بوابات الدفع الحقيقية، أو سلامة كل Webhook على الإنتاج.

**الدليل:** [محضر P0-A](docs/reviews/PLATFORM_CORE_SECURITY_P0A_20261025.md). أضيفت اختبارات انحدار فقط، **لم تُشغّل**؛ لا يوجد اعتماد تشغيل أو UAT لهذه التغييرات. لا يُستنتج إغلاق نطاق Platform Core بالكامل.

<a id="saas-paymob-query-hmac-p0a"></a>
### Paymob signed callback ingress — P0-A 2026-10-25
`tenant-subscription.controller.ts` forwards a Paymob callback's `?hmac=` value to the existing cryptographic verifier, without accepting unsigned payments. `p0a-cloud-header-paymob-webhook.spec.ts` was authored **but not executed**, and live payment settlement remains unverified. [Evidence](docs/reviews/PLATFORM_CORE_SECURITY_P0A_20261025.md).

## فهرس الأقسام المنقولة

- [15. إدارة المنصة والساس وتعدد المستأجرين (SaaS Admin & Multi-Tenancy)](#cap-041)
- [47. إدارة دورة حياة بيانات المشتركين وتصفير المنشآت من الساس (SaaS Tenant Demo Seeding & Factory Reset)](#cap-072)
- [157. منصة SaaS السحابية وحوكمة المشتركين وعزل المنصة المركزية وحراسة الباقات (Phase 11: Cloud SaaS Platform, Multi-Tenant Governance & Plan Enforcement)](#cap-189)
- [176. حوكمة حذف النسخ التجريبية والمستأجرين واستثناء التدقيق الجنائي أثناء التطهير الكامل (SaaS Tenant Purge Governance & Tamper Audit Exemption Invariant)](#cap-210)
- [205. دستور العزل التام لباقات وأسعار الاشتراكات السحابية حسب النشاط (Subscription Vertical Scope & Dynamic Catalog Resolution)](#cap-246)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-041"></a>
<!-- migrated:cap-041:start -->
## 15. إدارة المنصة والساس وتعدد المستأجرين (SaaS Admin & Multi-Tenancy)
* **حالة الوحدة العامة:** 🟢 مكتمل 100% · **مُدقَّق بالعمق (البند 3 — سبتمبر 2026):** قراءة كاملة سطراً بسطر لـ`saas-admin` و`tenant-subscription` و`activation`، أُصلحت خلالها **9 ثغرات** أبرزها تراكم فترات الاشتراك عند إعادة إرسال إشعار الدفع، وكلمة مرور لوحة المطوّرين المنشورة في الكود، واجتياز مسار في رفع ملفات التشخيص. التفاصيل في `ARCHITECTURE_INVARIANTS.md` §5-ب (المرحلة 14). **بنود مفتوحة مرتبطة:** O32 (تخفيض الباقة لا يُطفئ الموديولات)، O34 (انتحال الشخصية بلا أثر تدقيق مميَّز)، O37 (ترقية ذاتية عبر مسار المحاكاة)
* **مسارات الكود:** `backend/src/modules/saas-admin`, `backend/src/modules/tenant-subscription`, `frontend/src/features/saas-admin`
* **الجداول في قاعدة البيانات:** `tenants`, `tenant_subscriptions`, `subscription_plans`, `platform_users`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **عزل بيانات المستأجرين الصارم (Strict Tenant Isolation)** | 🟢 | 100% | `tenant-boundary.ts`, `Database.ts` | كل استعلام في النظام مقيد بالـ `tenant_id` لمنع أي تسريب بين العملاء نهائياً. |
| **هندسة الباقات الأربعة المعتمدة (4-Tier SaaS Matrix)** | 🟢 | 100% | `saas-admin.service.ts`, `plan-feature.service.ts`, `TenantSubscriptionPage.tsx`, `DeveloperActivationPanel.tsx`, `2040000000035_align_plans_matrix_and_modular_tiers.ts` | هيكل تسعير واشتراكات متدرج ومحكم بدقة: <br>1. **الأساسية (Basic):** 4 ميزات فقط (المبيعات ونقاط البيع POS، المنتجات والأصناف، ورديات العمل والكاشير، وصندوق الكاشير والخزينة والمصروفات). <br>2. **الاحترافية (Pro):** 7 ميزات (ما سبق في الأساسية + إدارة المشتريات والموردين، المخزون المتقدم والجرد، والتقارير المتقدمة وسجل النشاط). <br>3. **المتكاملة (Ultimate ERP):** 21 ميزة (ما سبق في الاحترافية + شجرة الحسابات، الأصول الثابتة، التقسيط، الفاتورة الإلكترونية، الإقرار الضريبي، الموارد البشرية، المناديب، نقاط الولاء، الصيانة وسيريال IMEI، الملابس، المطاعم، التصنيع، الاستيراد، والصيدليات - **بدون المتجر الإلكتروني**). <br>4. **التجارة الشاملة (Omnichannel Enterprise):** 22 ميزة بالكامل (كافة ميزات المتكاملة + المتجر الإلكتروني وطلبات الأونلاين وبوابات الدفع الإلكتروني Paymob/XPay/Stripe). |
| **إدارة الموديولات المفعلة ونظام القفل والترقية (Modular Toggles & Paywall)** | 🟢 | 100% | `ModulesSettingsTab.tsx`, `settings.schema.ts`, `feature-gate.tsx` | شاشة إدارة موديولات المنشأة؛ الميزات المشمولة في باقة العميل يملك حرية تفعيلها أو إيقافها، والميزات غير المشمولة تظهر مقفولة 🔒 مع بادج الباقة المطلوبة ونافذة منبثقة تفاعلية لطلب الترقية الفورية. |
| **التكيف الديناميكي للقائمة الجانبية (Dynamic Sidebar Filtering)** | 🟢 | 100% | `app-shell.tsx`, `access.ts` | تكييف القائمة الجانبية تلقائياً بحيث تختفي أي صفحة (مثل التقسيط، المتجر، الأصول الثابتة، الإقرار الضريبي، مناديب التوصيل، قسم الموبايل، الصيدلية، الاستيراد، التصنيع) فور تعطيلها في الإعدادات أو عدم شمولها في باقة العميل لمنع الازدحام، مع تحويل مسمى المالية إلى «الخزينة والمصروفات» تلقائياً في باقات التجزئة. |
| **الخطط والاشتراكات وفترات السماح (Subscriptions & Plans)** | 🟢 | 100% | `saas-admin.service.ts`, `SaasPlansPage.tsx` | باقات شهرية وسنوية، تجديد تلقائي، وإيقاف الصلاحيات بعد انتهاء فترة السماح. |
| **محاكاة منصة الساس وحوكمة المستأجرين الشاملة (SaaS Platform & Multi-Tenant Master Simulation Suite)** | 🟢 | 100% | `saas-platform-master-simulation.ts`, `saas-admin.service.ts`, `session.service.ts`, `audit.service.ts` | محاكاة واختبار E2E شامل تم تدقيقه واجتيازه بالكامل (13 مرحلة متعاقبة بنسبة نجاح 100% بدون أي محاكيات وهمية): (1) الحظر الثنائي لمسؤولي المنصة، (2) حماية المستأجر المركزي `zs` من التعطيل أو الحذف، (3) حظر الكلمات المحجوزة للـ Slug، (4) إنشاء النسخ التجريبية وتشفير Bcrypt للمالك، (5) تمديد فترة التجربة وسجلات التدقيق، (6) الإيقاف الإداري وتجميد الجلسات، (7) تفعيل الباقات المدفوعة، (8) تسجيل السداد وتجديد الاشتراك، (9) بروتوكول انتحال الشخصية الآمن وحوكمة O34 لتوثيق هوية المشغّل بدقة، (10) التبديل الديناميكي لميزات الباقة ومزامنة إعدادات الموديولات، (11) فك قفل المالك واستعادة كلمة المرور المشفرة، (12) إنهاء الاشتراكات، (13) الحذف الذري الشامل للنسخة وتطهير عزل البيانات 100%. |
| **النسخة المحمولة والمكتبية وأداة الطوارئ والصيانة (Windows Desktop & Portable with ZMT Emergency Tool)** | 🟢 | 100% | `portable/`, `scripts/zmt.cjs`, `scripts/zmt.ps1`, `zmt.bat` | تشغيل النظام كنسخة ديسكتوب وأوفلاين محمولة مع محرك بوستجرس محلي، وتضمين أداة ZMT للطوارئ بنقرة واحدة: (1) صيانة وتسريع قاعدة البيانات وتنظيف الجلسات المنتهية وإعادة بناء الفهارس (VACUUM FULL & REINDEX)، (2) استرجاع الإصدار السابق فوراً بنقرة زر واحدة (One-Click Emergency Rollback) واستعادة الملفات تلقائياً من النسخ الاحتياطية `runtime/backups/pre-update-*` في حال تعثر أي تحديث. |

---


<!-- migrated:cap-041:end -->

<a id="cap-072"></a>
<!-- migrated:cap-072:start -->
## 47. إدارة دورة حياة بيانات المشتركين وتصفير المنشآت من الساس (SaaS Tenant Demo Seeding & Factory Reset)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme & Strict Multi-Tenant Isolation).
* **روابط الوصول السريع:** `/saas-admin/tenants` (حصرياً لسوبر أدمن المنصة المركزية `isPlatformAdmin`).
* **مسارات الكود الأساسية:**
  * **الباك إند (Backend):** `backend/src/modules/saas-admin/saas-admin.controller.ts`, `backend/src/modules/saas-admin/saas-admin.service.ts`, `backend/src/modules/settings/services/settings-demo-data.service.ts`
  * **الفرونت إند (Frontend):** `frontend/src/features/saas-admin/api/saas-admin.api.ts`, `frontend/src/features/saas-admin/components/TenantActionHubModal.tsx`, `frontend/src/features/saas-admin/components/SeedTenantDemoModal.tsx`, `frontend/src/features/saas-admin/components/WipeTenantDataModal.tsx`, `frontend/src/features/saas-admin/pages/SaasTenantsPage.tsx`
* **الميزات والقدرات المفعلة:**
  1. **حقن باقات الأنشطة التجريبية للمشترك عن بُعد (Remote Tenant Demo Seeding):** تمكين السوبر أدمن من لوحة تحكم المشتركين المركزية من اختيار أي نشاط تجاري (سوبرماركت، ملابس وأزياء، كافيه ومطعم، إلكترونيات، صيدلية) وحقن بياناته مباشرة في حساب أي مشترك مع خيار الاستبدال التلقائي دون الحاجة لتسجيل الدخول بحساب العميل.
  2. **تصفير قاعدة بيانات المنشأة كلياً (Tenant Factory Reset to Zero):** تمكين السوبر أدمن بضغطة زر عندما يقرر العميل الاستقرار والبدء الفعلي للتشغيل من مسح وتصفير قاعدة بيانات المشترك بالكامل (كافة المنتجات، المخازن، الفواتير، المبيعات، المشتريات، الديون، القيود المحاسبية، الجلسات، والطلبات) لتعود منشأة جديدة تماماً برصيد صفري نظيف، ليدخل العميل بياناته الحقيقية.
  3. **الحفاظ الصارم على هوية المالك والاشتراك (Owner Identity & Subscription Preservation):** استثناء وحماية الحساب الإداري الأساسي لمالك المنشأة وفرعه الرئيسي واشتراكه السحابي تلقائياً من المسح أثناء التصفير، مع تطهير أي مستخدمين أو كاشيرات فرعية تم إنشاؤها عبر الباقات التجريبية.
  4. **الحماية المشددة وتأكيد كلمة مرور السوبر أدمن (Super Admin Password Verification):** اشتراط إدخال كلمة مرور السوبر أدمن الشخصية للتحقق الأمني قبل تنفيذ أي عملية تصفير لمنع أي خطأ بشري غير مقصود، مع أخذ نسخة احتياطية Snapshot فورية لقاعدة بيانات المنشأة قبل التصفير.
  5. **عزل صارم وحظر الوصول للمشتركين (Strict Multi-Tenant Isolation):** عزل تام لمسارات الـ API (`/api/saas-admin/tenants/:id/seed-demo` و `/api/saas-admin/tenants/:id/wipe-data`) بحراسة مزدوجة تشترط `SuperAdminRoleGuard` وهوية المنصة المركزية `isPlatformAdmin`، وحظر كامل لظهور أزرار التصفير أو معالجات المطورين لدى أي مشترك عادي.

---


<!-- migrated:cap-072:end -->

<a id="cap-189"></a>
<!-- migrated:cap-189:start -->
## 157. منصة SaaS السحابية وحوكمة المشتركين وعزل المنصة المركزية وحراسة الباقات (Phase 11: Cloud SaaS Platform, Multi-Tenant Governance & Plan Enforcement)
* **حالة الموديول العامة:** 🟢 مكتمل ومحكم 100% (Phase 11 Production-Ready & Invariant-Audited).
* **المعايير الهندسية والتشغيلية المعتمدة:** Rule 8 Strict Multi-Tenant Isolation / Double-Check Platform Isolation (`role === 'super_admin' && isPlatformTenant`) / Constitutional Invariant `PLATFORM_TENANT_ID` Immunity / Plan Quota Guards (Users & Branches) / Immediate Tenant Cache Invalidation / Unified Audit Event Codes (`AUDIT_EVENT_CODES.SAAS_*`) / 0 Emojis Policy.
* **المسارات في الكود:**
  - `backend/src/core/audit/audit.service.ts`:
    - إضافة 14 كود حدث ثابت لإدارة المشتركين السحابيين (`SAAS_TENANT_TRIAL_CREATED`, `SAAS_TENANT_ACTIVATED`, `SAAS_TENANT_SUSPENDED`, `SAAS_TENANT_EXPIRED`, `SAAS_TENANT_TRIAL_EXTENDED`, `SAAS_TENANT_DELETED`, `SAAS_TENANT_PLAN_UPDATED`, `SAAS_TENANT_SLUG_UPDATED`, `SAAS_TENANT_PASSWORD_RESET`, `SAAS_TENANT_OWNER_UNLOCKED`, `SAAS_SUBSCRIPTION_RENEWED`, `SAAS_PAYMENT_RECORDED`, `SAAS_IMPERSONATION_STARTED`, `SAAS_IMPERSONATION_ENDED`).
  - `backend/src/modules/saas-admin/saas-admin.service.ts`:
    1. استيراد واستخدام `AUDIT_EVENT_CODES` في كافة عمليات تسجيل التدقيق بدلاً من النصوص الوصفية العشوائية لتمكين الكشف الآلي من قراءتها.
    2. تحصين دالتي `updateTenantPlan` و `updateTenantSlug` بفرض فحص العزل المزدوج الصارم `this.assertPlatformAccess(auth)` لمنع أي مستخدم محلي برتبة `super_admin` من التلاعب بالباقات والمعرفات.
    3. فرض حماية دستورية لمنصة الإدارة المركزية `assertNotPlatformTenantTarget(id)` لمنع حذف أو تعطيل أو تعديل باقة منصة `zs`.
    4. تفعيل إبطال كاش المستأجر فورياً `this.authCache.invalidateTenant(id)` عند حذف المستأجر أو تعديل باقته أو معرّفه (Slug) لضمان عدم استمرار الجلسات المفتوحة.
  - `backend/src/modules/users/users.service.ts`:
    - حراسة حد المستخدمين الأقصى (`max_users`) بربطه مباشرة بجدول `saas_plans` من خلال اشتراك المستأجر النشط في `tenant_subscriptions`، وحظر إنشاء أي مستخدم يتجاوز السقف المحدد في الباقة.
  - `backend/src/modules/settings/settings.service.ts`:
    - تحصين دالة إنشاء الفروع `createBranch` بفرض فحص العزل المزدوج `isPlatformAdmin`، وربط سقف الفروع بالحد الأقصى الفعلي للباقة (`activeSub.max_branches` من `saas_plans`) ومنع التجاوز بصمت.
  - `backend/test/critical/phase11-saas-platform.spec.ts`:
    - إنشاء جناح اختبارات تدقيقي يغطي 6 سيناريوهات حتمية: العزل المزدوج وحظر السوبر أدمن المستأجر، حصانة منصة `zs` ضد الحذف والتعديل، تطهير والتحقق من معرفات المشتركين (slugs)، حراسة سقف المستخدمين والفروع للباقات، دورة حياة الاشتراكات وفترات السماح، وتكامل أكواد التدقيق SAAS_* والترقيم الموحد للسندات.
* **فحص الجودة والسلامة البرمجية:**
  - جناح الاختبارات الحاسم `npm run test:critical` (30 جناح اختبار): **اجتياز بنسبة 100% بنجاح تام (Exit code 0)**.
* **تدقيق مسار الاستدعاء الفعلي وإصلاحات الفوترة السحابية (تدقيق لاحق):**
  - `tenant-subscription.controller.ts`: مسار `POST /sandbox-checkout/complete` كان بلا مصادقة ويقبل `tenantId`/`planId`/`amount` من جسم الطلب مباشرة → ترقية باقة مجانية لأي مستأجر دون دفع فعلي. أُصلح بإضافة `SessionAuthGuard`، واشتقاق `tenantId` حصراً من الجلسة الموثّقة، وحارس `assertSandboxGatewayUsable()` يعطّل المحاكاة كلياً عند تفعيل أي مفتاح بوابة دفع حقيقي (XPay/Paymob/Stripe).
  - `xpay.gateway.ts` / `paymob.gateway.ts` / `stripe.gateway.ts` (`verifyAndParseWebhook`): كان التحقق التشفيري "فشلاً آمناً معكوساً" (`isValid = true` افتراضياً عند غياب سر التحقق من البيئة)؛ Stripe لم يكن يتحقق من التوقيع إطلاقاً. أُصلح بجعل الفشل آمناً (`isValid = false` افتراضياً)، وتحقق Stripe الحقيقي بصيغة `t=...,v1=...` على الجسم الخام (`req.rawBody`، مُلتقط الآن في `main.ts`) مع حماية ضد إعادة التشغيل (نافذة 300 ثانية)، ومقارنات `timingSafeEqual` في الجميع.
  - راجع `ARCHITECTURE_INVARIANTS.md` القسم 3 (F11, F12) والقسم 5-ب ("منصة SaaS والفوترة السحابية") والقسم 8 (O11, O12) للتفصيل الكامل وما تبقى مفتوحاً (جناح اختبار مخصص لم يُكتب بعد).


<!-- migrated:cap-189:end -->

<a id="cap-210"></a>
<!-- migrated:cap-210:start -->
## 176. حوكمة حذف النسخ التجريبية والمستأجرين واستثناء التدقيق الجنائي أثناء التطهير الكامل (SaaS Tenant Purge Governance & Tamper Audit Exemption Invariant)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (28 سبتمبر 2026).
* **المشكلة المعالجة:**
  - عند محاولة حذف نسخة تجريبية أو مستأجر من لوحة إدارة المشتركين (/saas-admin/tenants) عبر الـ SuperAdmin، كانت العملية تفشل بخطأ 500 (Internal Server Error) وتظهر رسالة "حدث خطأ داخلي في الخادم".
  - **السبب الجذري:** جدول سجلات التدقيق الجنائي الرقمي المانع للتلاعب (	amper_audit_logs) يحتوي على تريجر غير قابل للكسر (	rg_tamper_audit_immutable / n_tamper_audit_prevent_tamper) يرفع استثناءً غير مشروط (P0001: سجلات التدقيق الجنائي غير قابلة للتعديل أو الحذف نهائياً). عند حذف النسخة، يقوم محرك الحذف بتصفية كافة الجداول التي تحتوي على عمود 	enant_id، فكان يحاول الحذف من جدول 	amper_audit_logs فيصطدم بالتريجر وتنهار المعاملة المالية. بالإضافة إلى أن حذف الجداول المالية الأخرى (كالخزينة والحسابات والمبيعات) كان يُطلق تريجرات AFTER DELETE التي تحاول إدراج سجلات تدقيق جديدة للنسخة أثناء حذفها!
* **الحوكمة والمعالجة الهندسية المنفذة:**
  1. **هجرة قاعدة البيانات (2040000000161_allow_tenant_purge_in_tamper_audit.ts):**
     - تحديث دالة n_tamper_audit_prevent_tamper(): السماح بالحذف حصرياً وفقط إذا كانت الجلسة الحالية قد فعّلت راية التطهير المؤسسي على مستوى المعاملة (current_setting('app.allow_tenant_purge', true) = 'on'). وفيما عدا ذلك، يظل التريجر يمنع منعاً باتاً أي حذف أو تعديل لحماية النزاهة المالية والتدقيق الجنائي للشركات النشطة.
     - تحديث دالة n_tamper_evident_audit_trigger(): عند تفعيل راية التطهير pp.allow_tenant_purge = 'on'، يتجاوز التريجر تسجيل أي سجلات تدقيق جديدة فوراً عند حذف العمليات والقيود، مما يمنع توليد سجلات تدقيق لنسخة محذوفة.
  2. **محرك الخدمة السحابية (saas-admin.service.ts):**
     - تفعيل الراية محلياً داخل معاملة الحذف حصرياً: SET LOCAL app.allow_tenant_purge = 'on' لضمان اقتصارها على المعاملة المفتوحة لحذف المستأجر دون التأثير على بقية العمليات.
     - إضافة حماية دفاعية تمنع انهيار عملية الحذف في حال وجود أي نسخة قديمة من التريجر else if (table === 'tamper_audit_logs' && code === 'P0001').
     - عزل وتوثيق الحذف عبر سجلات تدقيق المنصة المركزية udit_logs برمز الحدث AUDIT_EVENT_CODES.SAAS_TENANT_DELETED.
* **الملفات المتصلة:**
  - ackend/src/database/migrations/2040000000161_allow_tenant_purge_in_tamper_audit.ts
  - ackend/src/modules/saas-admin/saas-admin.service.ts
  - ackend/test/critical/phase11-saas-platform.spec.ts
* **التحقق:**
  - تشغيل الهجرة بنجاح على قاعدة البيانات المحلية واختبار تفعيل وإلغاء تفعيل الراية (SET LOCAL app.allow_tenant_purge = 'on').
  - اختبار الوحدة الحرج: ackend/test/critical/phase11-saas-platform.spec.ts (7/7 اختبارات ناجحة).

---


<!-- migrated:cap-210:end -->

<a id="cap-246"></a>
<!-- migrated:cap-246:start -->
## 205. دستور العزل التام لباقات وأسعار الاشتراكات السحابية حسب النشاط (Subscription Vertical Scope & Dynamic Catalog Resolution)

- **الحالة:** مكتمل ومعتمد 100% (Completed & Verified).
- **نسبة الإنجاز:** 100%.
- **الوصف التشغيلي:**
  1. **التوافق التام بين نشاط المنشأة وكتالوج الأسعار (PRICE-S1 / PRICE-S3):**
     - القضاء التام على السقوط على أسعار محلات التجزئة العامة (`retail`) عند تشغيل المنظومة في قطاع الشحن واللوجستيات (`maritime`) أو المقاولات (`contracting`).
     - تحديث محرك حل التسعير `readPricingScope` في `tenant-subscription.service.ts` لفحص الأعلام التشغيلية المباشرة في جدول الإعدادات (`maritimeFreightModuleEnabled`, `contractingModuleEnabled`, إلخ) كأولوية قصوى حاكمة تعكس الواقع الفعلي للمنشأة، بدلاً من الاقتصار على قراءة حقل `businessIndustry` العام أو الاعتماد على القيمة الافتراضية لقاعدة البيانات `retail_general`.
  2. **دعم تلميح النطاق والربط اللحظي بين الواجهة والخادم:**
     - دعم تمرير تلميح النطاق `?vertical=` من واجهة المستخدم في مسار `GET /api/tenant-subscription/pricing`.
     - تحديث `resolveCurrentVertical` في الواجهة لتقديم فحص الأعلام التشغيلية المفعلة للموديولات المؤسسية الكبرى (`maritimeFreightModuleEnabled`, `contractingModuleEnabled`) قبل السقوط في القيمة الافتراضية `retail_general`.
     - تمرير إعدادات المنشأة الحية `settings` إلى مكون `CurrentSubscriptionHeroCard` لضمان مطابقة بطاقة الاشتراك وعرض «المكاتب والمقرات» في الشحن بدلاً من «الفروع».
  3. **عرض باقات الشحن واللوجستيات الحقيقية حصرياً:**
     - عند فتح صفحة الاشتراك في مود الشحن يتم عرض: **«نظام الشحن والتخليص والخدمات اللوجستية»** بمستوياته الثلاثة المعتمدة:
       - **مكتب (L1):** 45,000 ج.م/سنة (5 مستخدمين، 60 حاوية/شهر، أساس الشحن وأوامر التشغيل وبوالص B/L وغرامات الدموراج).
       - **شركة (L2):** 95,000 ج.م/سنة (12 مستخدم، حاويات غير محدودة، مصفوفة مقارنة الخطوط والترسية وتدقيق فواتير الناقل).
       - **مؤسسة (L3):** 180,000 ج.م/سنة (35 مستخدم، تعدد الشركات، الموارد البشرية، الفاتورة الإلكترونية والمحاسبة المالية).
     - منع ظهور أي ميزات كاشير، باركود، أو نقاط بيع في مود الشحن.
- **الملفات المعدلة:**
  - `backend/src/modules/tenant-subscription/tenant-subscription.service.ts`
  - `backend/src/modules/tenant-subscription/tenant-subscription.controller.ts`
  - `backend/src/modules/settings/settings.service.ts`
  - `backend/test/critical/subscription-read-only.spec.ts`
  - `frontend/src/shared/verticals/vertical-scope.ts`
  - `frontend/src/shared/verticals/vertical-scope.spec.ts`
  - `frontend/src/features/settings/api/tenant-subscription.api.ts`
  - `frontend/src/features/settings/pages/TenantSubscriptionPage.tsx`
  - `frontend/src/features/settings/pages/SettingsSectionContent.tsx`
  - `frontend/src/features/settings/components/subscription/CurrentSubscriptionHeroCard.tsx`
- **الاختبارات:** اجتياز 100% لكافة الاختبارات في `subscription-read-only.spec.ts` و `vertical-scope.spec.ts`.

---


<!-- migrated:cap-246:end -->
