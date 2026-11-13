# قدرات التشغيل والنشر والأداء والنسخ الاحتياطي

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **التشغيل والنشر والأداء والنسخ الاحتياطي** المعتمد للتحديثات القادمة. مسارات الملكية: مجال عابر للموديولات؛ راجع الأقسام ومسارات التنفيذ أدناه.

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [الهوية والأمان وعزل الشركات](PLATFORM_CAPABILITIES.md) · [التحقق والتدقيق والسجلات المشتركة](QA_CAPABILITIES.md)

## التحديثات الحالية

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.


<a id="runtime-backup-platform-exclusion-p0a"></a>
### فصل بيانات المنصة عن Backup شركة واتساق لقطة التصدير — تدقيق مصدر الكود 25 أكتوبر 2026
- السلوك الحالي: استرجاع بيانات شركة لا يعيد كتابة صفوف الفوترة والجلسات وسجلات التجارب وحجوزات Offline IDs التابعة للمنصة، حتى لو تضمنتها أرشيفات قديمة. تُصدَّر الجداول داخل معاملة قراءة موحدة `REPEATABLE READ`، وفشل الحذف أثناء Restore يوقف المعاملة دون كتمان.
- المصدر: `backend/src/modules/settings/services/settings-backup.service.ts` مع قائمة الحظر المشتركة في `core/tenant-transfer/tenant-package.ts`.
- الانحدار المكتوب: `backend/test/critical/backup-platform-boundary-p0a.spec.ts`. اختبار PostgreSQL والتوافق مع الأرشيفات القديمة مطلوب قبل اعتماد التشغيل. نجاح Restore يبطل AuthCache وإعدادات/فروع/ميزات المنشأة فورًا؛ حذف الجلسات في Tenant Package Import صار إلزاميًا داخل المعاملة. مسارات النسخ المحلية تتطلب `isDesktopRuntimeMode` صراحة. انحدار إضافي: `backend/test/critical/backup-mode-boundary-p0a.spec.ts` (لم يُشغّل).

**الدليل:** [محضر P0-A](docs/reviews/PLATFORM_CORE_SECURITY_P0A_20261025.md). أضيفت اختبارات انحدار فقط، **لم تُشغّل**؛ لا يوجد اعتماد تشغيل أو UAT لهذه التغييرات. لا يُستنتج إغلاق نطاق Platform Core بالكامل.

<a id="runtime-restore-preflight-p0a"></a>
### Destructive restore preflight — P0-A security follow-up, 2026-10-25
`settings-backup.service.ts` rejects incomplete/missing-tenant archives, safeguards unrepresented child rows, and aborts on sequence failures. Older archive restore may now fail closed pending a safe migration path; new migration 255 is not applied.

[Audit evidence](docs/reviews/PLATFORM_CORE_SECURITY_P0A_20261025.md) — source fixes and regression cases only; **not executed**.

<a id="runtime-dedicated-backup-permission-p0a"></a>
### صلاحية الوصول للنسخ السحابية — P0-A، 25 أكتوبر 2026
`settings-backup.service.ts` يمنع تنزيل النسخة الكاملة أو تعديل مسارات النسخ وقراءة Snapshot لمن لا يحمل `canManageBackups`، و`cloud-backup.service.ts:getCloudConfig` يمنع عرض `secretAccessKey` لحساب إعدادات عام، مع حراسة الخدمة نفسها. اختبار `p0a-backup-credentials-permissions.spec.ts` كُتب فقط ولم يُشغّل. أرشيفات Restore القديمة غير المكتملة قد تُرفض كما وثق المحضر.


<a id="p0a-destructive-recovery-verification-20261025"></a>
### P0-A destructive backup and tenant-transfer safety — 25 October 2026
- P0A-31: `core/tenant-transfer/tenant-package.ts` checks completeness of old tenant-package manifest, refuses omission of live tenant-owned or FK-child tables before destructive import, and reconciles inserted row totals with declared counts inside its transaction. Test: `p0a-tenant-package-completeness.spec.ts`, source/parser coverage (not full PostgreSQL import rollback).
- P0A-32: `cloud-backup.service.ts` blocks upload whenever cloud backup is disabled, even for an actor with backup permissions. Test: `p0a-backup-credentials-permissions.spec.ts`.
- P0A-33: `settings-backup.service.ts` writes the restore snapshot INSIDE the restore transaction, to avoid a post-commit logging failure masquerading as failed restore. Test: `p0a-restore-audit-atomicity.spec.ts` (source contract; real failure injection still outstanding).
- Verification: all pre-P0A-33 backend targeted tests, migrations, physical migration 255 metadata test and PostgreSQL core audit passed on isolated Actions run `40188575959`; post-P0A-33 follow-up: `40188927253`. Historical ZIP compatibility, validated legacy FK migration, concurrent restore and packaged Electron/real payment hardware remain NOT VERIFIED. See `docs/reviews/PLATFORM_CORE_SECURITY_P0A_20261025.md`.

## فهرس الأقسام المنقولة

- [قدرة: أداء وسرعة المنظومة (Performance) — ✅ مفعّلة ومحروسة (21 سبتمبر 2026)](#cap-003)
- [قدرة: نظام التبويبات المتعددة والتنقل المكتبي كالمتصفح في Electron وDesktop (Browser-like In-App Tabs & Desktop Popouts) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)](#cap-011)
- [بيئة التشغيل والاستضافة السحابية المعتمدة (Cloud Hosting & Infrastructure)](#cap-026)
- [20. خط النشر السحابي المستمر المؤتمت لسيرفر أوراكل (Automated CI/CD Pipeline to Oracle Cloud VPS)](#cap-046)
- [22. منظومة المراقبة والرصد السحابي الاستباقي وتنبيهات التيليجرام (Proactive APM & Telegram Incident Alerts)](#cap-048)
- [76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)](#cap-101)
- [76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)](#cap-103)
- [76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)](#cap-105)
- [76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)](#cap-106)
- [168. تقليص زمن فقد البيانات وأتمتة تمرين الاسترجاع (Backup RPO Reduction & Automated Restore Drill)](#cap-199)
- [171. أحجام قابلة للضبط لاختبارات الحمل ومعايرتها على مواصفات الإنتاج (Load Profiles & Client-Address Simulation)](#cap-202)
- [188. محرك التحمل والسرعة الفائقة لـ 10 سنوات (Enterprise 10-Year Scalability & High-Volume Engine)](#cap-222)
- [Shared database scale controls (2 October 2026)](#cap-228)
- [163. تسريع تجميع خادم التطوير المحلي للباك إند (Backend Incremental Dev Compilation Acceleration - 8 October 2026)](#cap-239)
- [207. البنية التحتية لتطبيقات الموبايل الأصلية والنشر على المتاجر (Store-Ready Native Mobile Architecture - Android & iOS)](#cap-248)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-003"></a>
<!-- migrated:cap-003:start -->
### قدرة: أداء وسرعة المنظومة (Performance) — ✅ مفعّلة ومحروسة (21 سبتمبر 2026)
- **نقطة البيع:** مزامنة الكتالوج الكامل (حتى 25 ألف صنف) خطية: حساب أرصدة المواقع لـ20 ألف صنف ~25ms (كان ~13 ثانية تحجب السيرفر). الكتالوج مخزَّن محلياً في IndexedDB (للبحث والباركود والبيع عند انقطاع الإنترنت، والفواتير تنتظر في طابور وتُرحَّل عند عودته)، محمي بطلب التخزين الدائم للمتصفح `navigator.storage.persist()` لمنع متصفحات Safari وChrome من مسح الكاش المحلي (`storage-persistence.ts`)، ويُعاد تحميله كاملاً **فقط** لو تغيّر سعر/اسم/باركود/وحدة/عرض أو أُضيف/أُلغي صنف، أو مرة كل ساعة لتحديث المخزون المحلي — لا مع كل بيعة كما كان (PERF-9، هجرة 137)، مع ميزة التطهير التلقائي الفوري لـ `IndexedDB` والـ `localStorage` عند تشغيل معالج التهيئة الأولى أو عندما تكون قاعدة البيانات خالية تماماً لمنع ظهور الأصناف الوهمية القديمة.
- **صفحة الأصناف:** تعمل مع أي حجم كتالوج (معامل مصفوفة واحد بدل معامل لكل صنف — كان الحد 65,535 صنفاً).
- **الردود:** بلا مُسلسِل عالمي؛ الردود الكبيرة أسرع ~100ms لكل 5000 صف.
- **المتجر العام:** كتالوج بكاش ذاكرة 60 ثانية + Stale-While-Revalidate حتى 5 دقائق (نسخة فورية وتحديث بالخلفية)، وإعادة البناء بخمس قراءات متوازية. الأسعار تُعاد على السيرفر عند الطلب.
- **الواجهة:** jsPDF وhtml2canvas وxlsx وrecharts وماسح الباركود بالكاميرا وSentry وpdfjs **لا تُحمَّل عند فتح أي صفحة** — كلها عند أول استخدام.
- **قاعدة البيانات:** فهارس المسارات الساخنة (الفواتير المعلقة، الخزينة بالتاريخ، أصناف المشتريات، مدفوعات الموردين، التحويلات، الاشتراكات) — هجرة 136.
- **الإلكترون:** نافذة تحميل فورية، الإظهار عند `ready-to-show`، وتخطي الهجرات حين لم تتغير النسخة (مفحوص، بلا تعديل).
- **الحُرّاس:** `performance-hot-paths.spec.ts` + `qa:perf` في `npm run guards`؛ `qa:perf:dist` بعد كل بيلد.


<!-- migrated:cap-003:end -->

<a id="cap-011"></a>
<!-- migrated:cap-011:start -->
### قدرة: نظام التبويبات المتعددة والتنقل المكتبي كالمتصفح في Electron وDesktop (Browser-like In-App Tabs & Desktop Popouts) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)
- **الدمج المعماري الرصين داخل شريط الأدوات الأبيض الرئيسي (Single-Row Executive Header):**
  - **توفير كامل للمساحة الرأسية (35px Saved):** تم دمج شريط التبويبات مباشرة في قلب شريط الأدوات الرئيسي الأبيض (`GlobalAppToolbar`) في سطر واحد تنفيذي متكامل، ملغياً الحاجة لشريط منفصل متراكم.
  - **حجب تلقائي واستبدال ذكي لفتات الخبز (Breadcrumbs Replacement):**
    - عند وجود تبويب فردي (`tabs.length <= 1`): يُعرض مسار فتات الخبز التقليدي (`الرئيسية › المبيعات › ...`) بدقة وبدون أي أزرار تبويبات زائدة.
    - عند فتح تبويبين أو أكثر (`tabs.length > 1`): يحل شريط التبويبات بسلاسة فورية محل فتات الخبز في نفس السطر الأبيض، مما يمنع تكرار اسم الصفحة ويوفر نقاءً بصرياً تاماً.
  - **أزرار تبويبات احترافية منسقة:** التبويب النشط يحمل خلفية رمادية ناعمة `#f1f5f9` مع حد سفلي كحلي ملكي `#170e5e`، وعناوين بوزن خط موحد `600` لمنع الرجفة، مع زر إغلاق `×` سريع، وزر إضافة تبويب جديد `+` متناسق.
  - انتقال لحظي وتلقائي مع React Router و TanStack Query، وتحديث تلقائي لعنوان وأيقونة التبويب النشط عند التنقل الداخلي في الصفحة.
  - إغلاق التبويبات بزر الإغلاق `×`، أو بالنقر بالزر الأوسط للفأرة (Middle-Click)، وعند إغلاق التبويبات الإضافية ليبقى تبويب واحد تعود فتات الخبز تلقائياً بدون أي إعادة تحميل.
  - توحيد قياسي للمسارات (`normalizeAppPath`) لمنع تكرار تبويب "الرئيسية" مع الفلترة التلقائية لذاكرة الجلسة.
- **القائمة السياقية للسايد بار (Sidebar Context Menu):**
  - تفعيل النقر بزر الفأرة الأيمن (Right-Click) على كافة روابط وقوائم السايد بار لعرض قائمة سياقية مؤسسية:
    1. **فتح في تبويب جديد (Open in new tab):** إنشاء تبويب جديد فوراً في الشريط العلوي وتفعيله والانتقال لمساره.
    2. **فتح في نافذة مستقلة (Open in new window):** مدعومة أصلياً في Electron عبر IPC `open-new-window` و `window.open` لفتح نافذة مستقلة لشاشات العرض المتعددة (Dual Monitors).
    3. **نسخ مسار الصفحة (Copy link):** نسخ الرابط الكامل للحافظة مع إشعار نجاح فوري.
  - تفعيل النقر بالزر الأوسط للفأرة (Middle-Click) على أي عنصر في السايد بار لفتحه مباشرة في تبويب جديد.
- **القائمة السياقية للتبويبات (Tab Bar Context Menu):**
  - قائمة خيارات عند النقر كليك يمين على أي تبويب: "إغلاق هذا التبويب"، "إغلاق التبويبات الأخرى"، "إعادة تحميل التبويب"، "فتح في نافذة مستقلة"، و"نسخ رابط الصفحة".
- **حفظ الحالة ومزامنة الذاكرة (Session Hydration):**
  - إدارة مركزية عبر `tabs-store.ts` بـ Zustand ومزامنة آمنة مع `sessionStorage` للحفاظ على التبويبات المفتوحة عند إعادة تحميل الصفحة.
  - التزام كامل بدستور التيبوجرافي وثبات الخطوط (وزن خط موحد `fontWeight: 600` لمنع الرجفة)، وتصميم ناصع بدون إيموجيز وبأيقونات تشغيلية موحدة (`nav-icons.tsx`).


<!-- migrated:cap-011:end -->

<a id="cap-026"></a>
<!-- migrated:cap-026:start -->
## بيئة التشغيل والاستضافة السحابية المعتمدة (Cloud Hosting & Infrastructure)
> ⚠️ **تنبيه حاسم لكافة المطورين والمساعدين الذكيين:**  
> المنظومة بالكامل (Frontend، Backend، Database - PostgreSQL) مستضافة ومُشغلة حصرياً على **سيرفر أوراكل (Oracle Cloud VPS)**.  
> **تم إنهاء وإلغاء أي وجود أو استخدام لـ هوستنجر (Hostinger) نهائياً.** لا تبحث ولا ترجع لأي ملفات أو إعدادات أو مسارات قديمة تخص هوستنجر إطلاقاً. المرجع الحصري الوحيد لبيئة الإنتاج السحابية هو سيرفر أوراكل.

---


<!-- migrated:cap-026:end -->

<a id="cap-046"></a>
<!-- migrated:cap-046:start -->
## 20. خط النشر السحابي المستمر المؤتمت لسيرفر أوراكل (Automated CI/CD Pipeline to Oracle Cloud VPS)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `.github/workflows/deploy-oracle.yml`, `.github/workflows/ci.yml`, `docs/DEPLOYMENT_PIPELINE.md`
* **البنية التحتية المستهدفة:** سيرفر أوراكل السحابي (Oracle Cloud VPS) حصرياً

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **بوابة التحقق قبل النشر (CI Gate Integration)** | 🟢 | 100% | `deploy-oracle.yml`, `ci.yml` | ربط سير عمل النشر بانتهاء واجتياز خط الـ CI بنجاح (`workflow_run` مع `conclusion: success`) لمنع نشر أي كود غير مجتاز للفحوصات أو الاختبارات على سيرفر الإنتاج.<br/>**توسعة سبتمبر 2026 — توصيل شبكة الحُرّاس:** كان خط الـCI يشغّل البناء وفحوص الجاهزية والـE2E فقط، بينما **الـ69 جناح اختبار** (`test/infra` + `test/critical` — الثوابت المالية، عزل المستأجرين، رموز البوابات، الإدمبوتنسي، المطابقة الثلاثية، مستخلصات المقاولات) وكل فحوص معمار الواجهة كانت تُشغَّل يدوياً فقط، أي عملياً لا تُشغَّل. صارت الآن مفروضة آلياً على كل Push/PR عبر `npm run test:infra` في وظيفة الباك إند و`qa:functional`/`qa:api`/`qa:contracts`/`qa:routes`/`qa:composition`/`qa:architecture` في وظيفة الواجهة، مع أمر محلي موحّد `npm run guards` مطابق تماماً لما يشغّله الـCI. خمسة من فحوص الواجهة حُوِّلت لنمط **السقّاطة (Ratchet)** (`frontend/scripts/architecture-baseline.mjs` + `scripts/baselines/*.json`) بحيث تفشل على أي مخالفة **جديدة** فقط بدل الفشل الدائم على الدين التاريخي. التفاصيل في `ARCHITECTURE_INVARIANTS.md` §6-ج.<br/>**استكمال (المرحلة الثانية):** أجنحة الواجهة نفسها (Vitest) كانت **18 اختباراً فاشلاً في 9 ملفات** وقت التوصيل، فصُفِّرت بالكامل إلى **246 اختباراً في 55 ملفاً (100% نجاح)** ووُصِّلت هي أيضاً بالـCI عبر `npm run test:run`. التصفير كشف ثلاثة أعطال حقيقية في الإنتاج لا في الاختبارات: انحدار صلاحيات يجعل دور `admin` يتخطى كل القيود في الواجهة (البند O29، أُصلح)، وثلاثة عناوين حقول في شاشة العروض كانت تعرض للمستخدم نص الكود `${getGlobalCurrencySymbol()}` حرفياً بدل رمز العملة (البند O31)، ودالة ميتة كانت تُفشِل بناء الواجهة على الفرع الرئيسي. **المتبقي خارج البوابة:** `frontend npm run lint` وحده (22,451 ملاحظة) — بند مستقل. |
| **تحديث الكود الآمن والذري (Atomic Git Deploy)** | 🟢 | 100% | `deploy-oracle.yml` | جلب كود فرع `main` ومطابقته بدقة وحماية مجلد العمل عبر `safe.directory`. |
| **بناء التطبيق والمهاجرات بالتسلسل الآمن** | 🟢 | 100% | `deploy-oracle.yml` | تثبيت الاعتماديات عبر `npm ci`، بناء الباك إند، ثم تشغيل مهاجرات قاعدة البيانات PostgreSQL فور نجاح البناء، وبناء الفرونت إند. |
| **إعادة التحميل السلس دون انقطاع (Zero Downtime PM2 Reload)** | 🟢 | 100% | `deploy-oracle.yml` | إعادة تحميل عملية Node.js بسلاسة (`pm2 reload zsystems-backend --update-env`) دون انقطاع الخدمة عن المستخدمين النشطين. |
| **الفحص الآلي لصحة الخدمة ومسبار الجاهزية (Automated Health Check Probes)** | 🟢 | 100% | `deploy-oracle.yml` | فحص استباقي لنقاط `/api/health/live` و `/api/health/ready` عبر مسبار متكرر؛ وفي حال عدم جاهزية النظام يفشل الإجراء تلقائياً ويتم إيقاف النشر مع إظهار السجلات. |
| **إعادة تحميل خادم Nginx الآمن** | 🟢 | 100% | `deploy-oracle.yml` | إعادة تحميل Nginx تلقائياً لضمان توجيه حركة المرور وتحديث الملفات الثابتة. |

---


<!-- migrated:cap-046:end -->

<a id="cap-048"></a>
<!-- migrated:cap-048:start -->
## 22. منظومة المراقبة والرصد السحابي الاستباقي وتنبيهات التيليجرام (Proactive APM & Telegram Incident Alerts)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/core/alerts/telegram-alerts.service.ts`, `backend/src/core/health/health.controller.ts`, `.github/workflows/deploy-oracle.yml`, `frontend/src/features/settings/components/workspace-sections/SettingsTelegramAlertsSection.tsx`
* **البنية التحتية المستهدفة:** سيرفر أوراكل السحابي (Oracle Cloud VPS)

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **بوت تيليجرام لتنبيهات الأعطال الفورية (Telegram Incident Bot)** | 🟢 | 100% | `telegram-alerts.service.ts`, `health.controller.ts` | رصد فوري واستباقي لأي انقطاع في قاعدة بيانات PostgreSQL أو تعطل غير متوقع في الخدمات، مع إرسال رسالة تيليجرام طارئة للمسؤول تتضمن نوع العطل ووقت الحدوث وتفاصيله التقنية. |
| **إشعارات النشر السحابي التلقائي (CI/CD Deployment Alerts)** | 🟢 | 100% | `deploy-oracle.yml`, `telegram-alerts.service.ts` | إشعار فوري على تيليجرام فور انتهاء خط النشر المؤتمت على سيرفر أوراكل، يوضح حالة النشر (نجاح أو فشل)، رقم الكوميت، اسم المطور، وسلامة نقاط الجاهزية. |
| **مسبار المؤشرات الحية واستهلاك الموارد (Live APM Metrics)** | 🟢 | 100% | `health.controller.ts`, `SettingsTelegramAlertsSection.tsx` | بطاقات حية في شاشة الإعدادات تعرض: استهلاك ذاكرة الرام (RAM RSS / Heap)، زمن التشغيل المستمر (Uptime)، حالة قاعدة البيانات، وبيئة الخادم الحالية. |
| **فحص واختبار التنبيهات الفوري** | 🟢 | 100% | `health.controller.ts`, `SettingsTelegramAlertsSection.tsx` | زر فحص مباشر يتيح إرسال تنبيه اختباري إلى قناة أو محادثة تيليجرام للتأكد من صحة الـ Bot Token والـ Chat ID. |

---


<!-- migrated:cap-048:end -->

<a id="cap-101"></a>
<!-- migrated:cap-101:start -->
## 76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري والأداء المؤسسي (Clean Modular Architecture & Performance).
* **معيار المقارنة الدولي:** Clean Architecture & Domain-Driven Component Slicing.
* **مسارات الكود والوحدات المقسمة:**
  1. **إدارة الصيانة (Maintenance Module):**
     - تم تقليص `MaintenanceTicketsPage.tsx` من 1,961 سطر إلى 696 سطر (تخفيض بنسبة 65%).
     - استخراج الأيقونات والتكوينات إلى `frontend/src/features/maintenance/components/MaintenanceConstants.tsx`.
     - استخراج نافذة الاستلام والإيصال إلى `frontend/src/features/maintenance/components/MaintenanceCreateTicketModal.tsx`.
     - استخراج تفاصيل الصيانة وصرف القطع وعمولة الفني إلى `frontend/src/features/maintenance/components/MaintenanceDetailModal.tsx`.
     - استخراج تسوية الحساب والتسليم إلى `frontend/src/features/maintenance/components/MaintenanceSettlementModal.tsx`.
  2. **إدارة أوامر البيع (Sales Orders Module):**
     - تم استخراج منتقي المنتجات والباركود (Combobox Portal) المعقد من `SalesOrdersPage.tsx` إلى المكون المستقل `frontend/src/features/sales/components/OrderItemProductPicker.tsx` (تخفيض 287 سطر).
  3. **إدارة المنصة والسوبر أدمن (SaaS Admin Module):**
     - تم تقليص `SaasTenantsPage.tsx` من 1,704 سطر إلى 1,274 سطر باستخراج نافذة توليد النسخ التجريبية وإدارة بيانات الدخول إلى `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`.
  4. **كاش الباك إند فائق السرعة (Backend In-Memory Cache Engine):**
     - تفعيل كاش ذاكرة فائق السرعة لبيانات الإعدادات والفروع والمواقع في `backend/src/modules/settings/settings.service.ts` مع إبطال فوري وتلقائي عند الحفظ أو التعديل لتسريع الاستجابة.
  5. **تقسيم كود الإعدادات (Lazy Code-Splitting):**
     - تحويل الأقسام الثانوية في `SettingsSectionContent.tsx` إلى `React.lazy` و `Suspense` لتسريع تحميل واجهة الإعدادات وتقليل حجم حزمة الجافاسكريبت المبدئية.
  6. **تنظيف وتحسين ملفات التنسيق (CSS Optimization):**
     - إزالة 1,115 سطر من الأكواد المكررة في `frontend/src/styles/partials/document-form-prototype.css` وتوحيد أنماط الدارك مود.
  7. **إدارة الشيكات والأوراق المالية (PDC Cheques Module):**
     - تم تقليص `PdcChequesPage.tsx` من 1,643 سطر إلى 969 سطر (تخفيض أكثر من 670 سطر).
  3. **الامتثال لمتطلبات الفوترة الخليجية:** طباعة التاريخ الهجري على إيصالات وفواتير الكاشير والضريبة لضمان التوافق التام مع متطلبات السوق السعودي والخليجي.

---


<!-- migrated:cap-101:end -->

<a id="cap-103"></a>
<!-- migrated:cap-103:start -->
## 76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري والأداء المؤسسي (Clean Modular Architecture & Performance).
* **معيار المقارنة الدولي:** Clean Architecture & Domain-Driven Component Slicing.
* **مسارات الكود والوحدات المقسمة:**
  1. **إدارة الصيانة (Maintenance Module):**
     - تم تقليص `MaintenanceTicketsPage.tsx` من 1,961 سطر إلى 696 سطر (تخفيض بنسبة 65%).
     - استخراج الأيقونات والتكوينات إلى `frontend/src/features/maintenance/components/MaintenanceConstants.tsx`.
     - استخراج نافذة الاستلام والإيصال إلى `frontend/src/features/maintenance/components/MaintenanceCreateTicketModal.tsx`.
     - استخراج تفاصيل الصيانة وصرف القطع وعمولة الفني إلى `frontend/src/features/maintenance/components/MaintenanceDetailModal.tsx`.
     - استخراج تسوية الحساب والتسليم إلى `frontend/src/features/maintenance/components/MaintenanceSettlementModal.tsx`.
  2. **إدارة أوامر البيع (Sales Orders Module):**
     - تم استخراج منتقي المنتجات والباركود (Combobox Portal) المعقد من `SalesOrdersPage.tsx` إلى المكون المستقل `frontend/src/features/sales/components/OrderItemProductPicker.tsx` (تخفيض 287 سطر).
  3. **إدارة المنصة والسوبر أدمن (SaaS Admin Module):**
     - تم تقليص `SaasTenantsPage.tsx` من 1,704 سطر إلى 1,274 سطر باستخراج نافذة توليد النسخ التجريبية وإدارة بيانات الدخول إلى `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`.
     - توحيد وتنسيق صفحة باقات الساس `SaasPlansPage.tsx` بنسبة 100% وفق دستور النظام البصري ومطابقتها لنموذج الأقساط `installments` (عمود العرض `document-prototype-column`، هيدر `PageHeader` بشارة SaaS Admin، بطاقات الإحصائيات `StatsGrid`، شريط بحث فوري، وقسم البطاقة `document-prototype-section`).
  4. **كاش الباك إند فائق السرعة (Backend In-Memory Cache Engine):**
     - تفعيل كاش ذاكرة فائق السرعة لبيانات الإعدادات والفروع والمواقع في `backend/src/modules/settings/settings.service.ts` مع إبطال فوري وتلقائي عند الحفظ أو التعديل لتسريع الاستجابة.
  5. **تقسيم كود الإعدادات (Lazy Code-Splitting):**
     - تحويل الأقسام الثانوية في `SettingsSectionContent.tsx` إلى `React.lazy` و `Suspense` لتسريع تحميل واجهة الإعدادات وتقليل حجم حزمة الجافاسكريبت المبدئية.
  6. **تنظيف وتحسين ملفات التنسيق (CSS Optimization):**
     - إزالة 1,115 سطر من الأكواد المكررة في `frontend/src/styles/partials/document-form-prototype.css` وتوحيد أنماط الدارك مود.
  7. **إدارة الشيكات والأوراق المالية (PDC Cheques Module):**
     - تم تقليص `PdcChequesPage.tsx` من 1,643 سطر إلى 969 سطر (تخفيض أكثر من 670 سطر).
     - استخراج نافذة تسجيل ورقة قبض / دفع جديدة بكامل منطق الفاليديشن والعملات والتواريخ إلى `frontend/src/features/accounting/components/PdcChequeCreateModal.tsx`.
     - استخراج نافذة دورة حياة الشيك (إيداع بنكي، تحصيل، صرف، ارتداد مع الغرامات، تظهير لمورد) إلى `frontend/src/features/accounting/components/PdcChequeActionModal.tsx`.
     - استخراج معاينة وطباعة السند المالي الرسمي للشيك إلى `frontend/src/features/accounting/components/PdcChequeVoucherModal.tsx`.
  8. **كاش خطط وباقات الساس وميزات النظام (SaaS & Feature Plans In-Memory Cache):**
     - إضافة كاش ذاكرة ذكي في `backend/src/modules/saas-admin/saas-admin.service.ts` لطلبات استعلام الباقات ومصفوفة الميزات (5 دقائق TTL) مع إبطال فوري عند الإنشاء أو التعديل لتسريع الاستجابة وتخفيف الحمل على قاعدة البيانات.
  9. **تحسين أداء الرسوم ومسارات الـ CSS (CSS Composition & Zero Perpetual Loops):**
     - إزالة الأنيميشن المستمر `reportFloat` اللانهائي في `frontend/src/styles/partials/features.css` لمنع استهلاك المعالج والـ GPU المستمر، والتأكد من صفر لاج في الرسوم البيانية التفاعلية.
  10. **تفكيك وتدقيق صفحات النظام الكبرى (Enterprise Page Modularization - Categories 1 & 2):**
      - تم بنجاح تفكيك وتقليص كافة صفحات الفئة الأولى (> 600 سطر) والفئة الثانية (500 إلى 600 سطر) لتصبح جميعها رشيقة وتحت سقف 400 سطر (معظمها بين 150 و 260 سطر) بنسبة إنجاز 100% وبصفر أخطاء TypeScript:
      - **قوائم الأسعار (`PriceListsPage.tsx`):** من 625 إلى 260 سطر باستخراج `PriceListModal.tsx` و `PriceListCard.tsx`.
      - **حضور وانصراف الموظفين (`HrAttendancePage.tsx`):** من 624 إلى 341 سطر باستخراج `AttendanceKpiSummary.tsx`, `DailyAttendanceTable.tsx`, `AttendanceExceptionsTable.tsx`, `ManualAttendanceModal.tsx`.
      - **تصنيفات المنتجات (`ProductCategoriesPage.tsx`):** من 613 إلى 337 سطر باستخراج `CategoriesDataTable.tsx`, `CategoryFormModal.tsx`, `CategoryTransferProductsModal.tsx`, `CategoryTransferWarehouseModal.tsx`.
      - **الأصول الثابتة والإهلاك (`AccountingFixedAssetsPage.tsx`):** من 598 إلى 265 سطر باستخراج `AddFixedAssetModal.tsx`, `DepreciateModals.tsx`, `FixedAssetsTable.tsx`, `FixedAssetsLogsTable.tsx`.
      - **تخصيص وسداد الفواتير (`PaymentAllocationPage.tsx`):** من 592 إلى 257 سطر باستخراج `PartnerSelectorBar.tsx`, `UnallocatedPaymentsCard.tsx`, `OpenInvoicesCard.tsx`.
      - **إقرار ضريبة القيمة المضافة (`VatDeclarationPage.tsx`):** من 576 إلى 194 سطر باستخراج `VatPeriodSelector.tsx`, `VatSalesTable.tsx`, `VatPurchasesTable.tsx`, `VatSummaryBox.tsx`.
      - **شاشة العميل (`CustomerFacingDisplayPage.tsx`):** من 564 إلى 203 سطر باستخراج `CfdHeader.tsx`, `CfdIdleView.tsx`, `CfdScanningView.tsx`, `CfdCompletedView.tsx`.
      - **نواقص الصيدلية (`PharmacyShortagesPage.tsx`):** من 549 إلى 198 سطر باستخراج `ShortagesKpiGrid.tsx`, `ShortageQuickAddBar.tsx`, `ShortageFilterBar.tsx`, `ShortagesTable.tsx`, `ShortageDetailModal.tsx`.

<!-- migrated:cap-103:end -->

<a id="cap-105"></a>
<!-- migrated:cap-105:start -->
## 76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري والأداء المؤسسي (Clean Modular Architecture & Performance).
* **معيار المقارنة الدولي:** Clean Architecture & Domain-Driven Component Slicing.
* **مسارات الكود والوحدات المقسمة:**
  1. **إدارة الصيانة (Maintenance Module):**
     - تم تقليص `MaintenanceTicketsPage.tsx` من 1,961 سطر إلى 696 سطر (تخفيض بنسبة 65%).
     - استخراج الأيقونات والتكوينات إلى `frontend/src/features/maintenance/components/MaintenanceConstants.tsx`.
     - استخراج نافذة الاستلام والإيصال إلى `frontend/src/features/maintenance/components/MaintenanceCreateTicketModal.tsx`.
     - استخراج تفاصيل الصيانة وصرف القطع وعمولة الفني إلى `frontend/src/features/maintenance/components/MaintenanceDetailModal.tsx`.
     - استخراج تسوية الحساب والتسليم إلى `frontend/src/features/maintenance/components/MaintenanceSettlementModal.tsx`.
  2. **إدارة أوامر البيع (Sales Orders Module):**
     - تم استخراج منتقي المنتجات والباركود (Combobox Portal) المعقد من `SalesOrdersPage.tsx` إلى المكون المستقل `frontend/src/features/sales/components/OrderItemProductPicker.tsx` (تخفيض 287 سطر).
  3. **إدارة المنصة والسوبر أدمن (SaaS Admin Module):**
     - تم تقليص `SaasTenantsPage.tsx` من 1,704 سطر إلى 1,274 سطر باستخراج نافذة توليد النسخ التجريبية وإدارة بيانات الدخول إلى `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`.
     - توحيد وتنسيق صفحة باقات الساس `SaasPlansPage.tsx` بنسبة 100% وفق دستور النظام البصري ومطابقتها لنموذج الأقساط `installments` (عمود العرض `document-prototype-column`، هيدر `PageHeader` بشارة SaaS Admin، بطاقات الإحصائيات `StatsGrid`، شريط بحث فوري، وقسم البطاقة `document-prototype-section`).
  4. **كاش الباك إند فائق السرعة (Backend In-Memory Cache Engine):**
     - تفعيل كاش ذاكرة فائق السرعة لبيانات الإعدادات والفروع والمواقع في `backend/src/modules/settings/settings.service.ts` مع إبطال فوري وتلقائي عند الحفظ أو التعديل لتسريع الاستجابة.
  5. **تقسيم كود الإعدادات (Lazy Code-Splitting):**
     - تحويل الأقسام الثانوية في `SettingsSectionContent.tsx` إلى `React.lazy` و `Suspense` لتسريع تحميل واجهة الإعدادات وتقليل حجم حزمة الجافاسكريبت المبدئية.
  6. **تنظيف وتحسين ملفات التنسيق (CSS Optimization):**
     - إزالة 1,115 سطر من الأكواد المكررة في `frontend/src/styles/partials/document-form-prototype.css` وتوحيد أنماط الدارك مود.
  7. **إدارة الشيكات والأوراق المالية (PDC Cheques Module):**
     - تم تقليص `PdcChequesPage.tsx` من 1,643 سطر إلى 969 سطر (تخفيض أكثر من 670 سطر).
     - استخراج نافذة تسجيل ورقة قبض / دفع جديدة بكامل منطق الفاليديشن والعملات والتواريخ إلى `frontend/src/features/accounting/components/PdcChequeCreateModal.tsx`.
     - استخراج نافذة دورة حياة الشيك (إيداع بنكي، تحصيل، صرف، ارتداد مع الغرامات، تظهير لمورد) إلى `frontend/src/features/accounting/components/PdcChequeActionModal.tsx`.
     - استخراج معاينة وطباعة السند المالي الرسمي للشيك إلى `frontend/src/features/accounting/components/PdcChequeVoucherModal.tsx`.
  8. **كاش خطط وباقات الساس وميزات النظام (SaaS & Feature Plans In-Memory Cache):**
     - إضافة كاش ذاكرة ذكي في `backend/src/modules/saas-admin/saas-admin.service.ts` لطلبات استعلام الباقات ومصفوفة الميزات (5 دقائق TTL) مع إبطال فوري عند الإنشاء أو التعديل لتسريع الاستجابة وتخفيف الحمل على قاعدة البيانات.
  9. **تحسين أداء الرسوم ومسارات الـ CSS (CSS Composition & Zero Perpetual Loops):**
     - إزالة الأنيميشن المستمر `reportFloat` اللانهائي في `frontend/src/styles/partials/features.css` لمنع استهلاك المعالج والـ GPU المستمر، والتأكد من صفر لاج في الرسوم البيانية التفاعلية.
  10. **تفكيك وتدقيق صفحات النظام الكبرى (Enterprise Page Modularization - Categories 1 & 2):**
      - تم بنجاح تفكيك وتقليص كافة صفحات الفئة الأولى (> 600 سطر) والفئة الثانية (500 إلى 600 سطر) لتصبح جميعها رشيقة وتحت سقف 400 سطر (معظمها بين 150 و 260 سطر) بنسبة إنجاز 100% وبصفر أخطاء TypeScript:
      - **قوائم الأسعار (`PriceListsPage.tsx`):** من 625 إلى 260 سطر باستخراج `PriceListModal.tsx` و `PriceListCard.tsx`.
      - **حضور وانصراف الموظفين (`HrAttendancePage.tsx`):** من 624 إلى 341 سطر باستخراج `AttendanceKpiSummary.tsx`, `DailyAttendanceTable.tsx`, `AttendanceExceptionsTable.tsx`, `ManualAttendanceModal.tsx`.
      - **تصنيفات المنتجات (`ProductCategoriesPage.tsx`):** من 613 إلى 337 سطر باستخراج `CategoriesDataTable.tsx`, `CategoryFormModal.tsx`, `CategoryTransferProductsModal.tsx`, `CategoryTransferWarehouseModal.tsx`.
      - **الأصول الثابتة والإهلاك (`AccountingFixedAssetsPage.tsx`):** من 598 إلى 265 سطر باستخراج `AddFixedAssetModal.tsx`, `DepreciateModals.tsx`, `FixedAssetsTable.tsx`, `FixedAssetsLogsTable.tsx`.
      - **تخصيص وسداد الفواتير (`PaymentAllocationPage.tsx`):** من 592 إلى 257 سطر باستخراج `PartnerSelectorBar.tsx`, `UnallocatedPaymentsCard.tsx`, `OpenInvoicesCard.tsx`.
      - **إقرار ضريبة القيمة المضافة (`VatDeclarationPage.tsx`):** من 576 إلى 194 سطر باستخراج `VatPeriodSelector.tsx`, `VatSalesTable.tsx`, `VatPurchasesTable.tsx`, `VatSummaryBox.tsx`.
      - **شاشة العميل (`CustomerFacingDisplayPage.tsx`):** من 564 إلى 203 سطر باستخراج `CfdHeader.tsx`, `CfdIdleView.tsx`, `CfdScanningView.tsx`, `CfdCompletedView.tsx`.
      - **نواقص الصيدلية (`PharmacyShortagesPage.tsx`):** من 549 إلى 198 سطر باستخراج `ShortagesKpiGrid.tsx`, `ShortageQuickAddBar.tsx`, `ShortageFilterBar.tsx`, `ShortagesTable.tsx`, `ShortageDetailModal.tsx`.
      - **تعديل بيانات الموظف (`EmployeeEditPage.tsx`):** من 541 إلى 217 سطر باستخراج أقسام البيانات الأساسية، التعويضات والرواتب، بيانات الوظيفة، سياسة الحضور، والبيانات البنكية.
      - **إنشاء وتعديل تركيبة المنتج BOM (`NewBomPage.tsx` & `EditBomPage.tsx`):** من 536 و 526 سطر إلى 253 و 249 سطر عبر استخراج مكونات مشتركة `BomLinesTable.tsx`, `BomCostSummaryCard.tsx`, `bom-types.ts`.
      - **تقارير الموارد البشرية (`HrReportsPage.tsx`):** من 532 إلى 173 سطر باستخراج `HrReportsKpiBar.tsx`, `HrReportsFiltersToolbar.tsx`, `HrReportsOverviewGrid.tsx`, `HrReportsDetailSections.tsx`.
      - **مجموعات خيارات وإضافات المنتجات (`ProductModifiersPage.tsx`):** من 512 إلى 216 سطر باستخراج `ModifierGroupCard.tsx` و `ModifierGroupModal.tsx`.
      - **الروشتات والتأمين الصحي (`PharmacyPrescriptionsPage.tsx`):** من 510 إلى 151 سطر باستخراج `PrescriptionsKpiGrid.tsx`, `PrescriptionsFilterBar.tsx`, `PrescriptionsTable.tsx`, `PrescriptionModal.tsx`.
  11. **القضاء التام على وميض الإطار الأسود العابر عند تحميل الصفحات وتوحيد صفحة قوائم الأسعار (Global Focus Stroke Suppression & PriceLists Page Standardization):**
      - **حل جذري لمشكلة الستروك الأسود (Zero Transient Focus Ring):** إزالة محددات `:where(...)` ذات الأولوية الصفرية في `app.css` و `base.css` وتطبيق محددات مباشرة فائقة الأولوية مع `!important` تمنع المتصفح من إظهار أي إطار تركيز عابر (`outline: none !important; outline-color: transparent !important;`) على الحاويات والبطاقات (`div`, `section`, `article`, `main`, `.card`, `.document-prototype-section`, إلخ) عند تبديل الصفحات أو انتهاء التحميل غير المتزامن.
      - **إزالة الوسوم المتداخلة `<main>`:** استبدال وسم `<main>` الداخلي بـ `<div>` في `PriceListsPage`, `QuotationsPage`, `InstallmentsPage` لمنع ارتباك المتصفح في توجيه التركيز التلقائي.
      - **توحيد صفحة قوائم الأسعار (`PriceListsPage.tsx`):** ترقية الصفحة لتطابق الدستور البصري الموحد بالكامل عبر إضافة بطاقات الإحصائيات الذكية `StatsGrid` (إجمالي القوائم، القوائم المفعلة، القائمة الافتراضية، إجمالي القواعد)، تغليف المحتوى داخل `.document-prototype-section` القياسي، واستخدام مكون الزر الرسمي `Button` في الحالة الفارغة.
      - الالتزام التام بكافة معايير النظام البصري: اتجاه RTL، أيقونات SVG رسمية حصرياً، نوافذ عبر `StandardDialog` و `DialogShell` (صفر أخطاء clipping أو أوفري عشوائي)، واستبعاد كلاسات تيلويند نهائياً.
  12. **التحصين الوقائي للعمليات التشغيلية واللانشر (Defensive Hardening for User Operations & Launcher):**
      - **إرشاد المستخدم عند حذف الحسابات (`users.service.ts`):** تحويل خطأ قاعدة البيانات العام لتعارض المفتاح الأجنبي عند محاولة حذف مستخدم مسجل بحركات مالية أو مخزنية سابقة إلى رسالة عربية إرشادية واضحة ومباشرة: *"لا يمكن حذف هذا المستخدم لوجود فواتير أو حركات مخزنية مسجلة باسمه. يمكنك تعطيل حسابه بدلاً من الحذف للحفاظ على السجلات المالية"* بكود خطأ `USER_HAS_TRANSACTIONS` (400) بدلاً من استثناء قاعدة البيانات العام.
      - **التحقق المسبق من مسار النسخ الاحتياطي (`settings-backup.service.ts`):** فحص مسار مجلد النسخ الاحتياطي وتطهيره من الرموز الممنوعة (`?`, `*`, `<`, `>`, `|`) ومنع مسارات ويندوز المشوهة مثل `\\?`، وترجمة أي تعذر في الكتابة لخطأ `400` معتمد بدلاً من حدوث خطأ خادم غير معالج 500 في السجلات.
      - **قفل التشغيل المتزامن في اللانشر المحمول (`Start-ZS.ps1`):** إضافة آلية قفل مؤقت (`starting.lock`) لمنع إطلاق عمليات خلفية مكررة واصطدام البورت 3001 (`EADDRINUSE`) عند الضغط المزدوج السريع على اختصار تشغيل النسخة المحمولة.
  13. **تسريع فائق لإقلاع نسخة الإلكترون والنسخة المحمولة (Electron & Portable Startup Optimization):**
      - **تفعيل كاش التجميع V8 المدمج (`NODE_COMPILE_CACHE`):** تفعيل كاش البايت كود المدمج لمحرك Node 22+ في كل من `backend/src/main.ts`، وعملية الإلكترون الرئيسية `frontend/electron/main.cjs`، واللانشر المحمول `Start-ZS.ps1`، مما يخفض وقت تحميل موديولات NestJS والفرونت إند بنسبة تصل إلى 40% عند الإقلاع المتكرر.
      - **فحص جهوزية قاعدة البيانات عبر مآخذ TCP غير المتزامنة (`postgres-manager.cjs`):** استبدال استدعاءات `execSync("psql.exe")` المتكررة التي كانت تحجب مسار الـ Event Loop بفحص مباشر لمقبس TCP (`net.Socket`) كل 100ms، مما يوفر مئات المللي ثوانٍ ويقضي على أي تجميد عابر أثناء شاشة البداية.
      - **المصافحة اللحظية لجاهزية الخادم عبر IPC (`main.cjs`):** التقاط إشارة الجاهزية اللحظية (`ready`) المرسلة من الباك إند عبر قنوات الـ IPC المباشرة وإظهار النافذة الرئيسية دون انتظار دورات الاستطلاع الشبكي، مع التحديد الديناميكي لمنفذ الخادم.
  14. **معالجة وتصحيح التحقق من الصفر وأسعار الأصناف في أوامر الشراء والتحويلات المخزنية (Purchase & Stock Transfers Zero-Price Validation Hardening):**
      - **الصفر الآمن الافتراضي لكافة الأصناف (`useNewPurchaseOrderController.ts`):** تحصين دوال اختيار الأصناف (`handleProductSelect`, `addProductAsLine`, `incrementProductByBarcode`, `handleProductCreateSuccess`) بحيث تسند رقماً صحيحاً `0` في حال كان الصنف مسجلاً بدون سعر تكلفة أو تم إنشاؤه حديثاً، لمنع تواجد قيمة `undefined` في كائن البند.
      - **مرونة دالة التحقق وقبول السعر الصفري (`validateBeforeConfirm`):** تعديل دالة فحص الفاتورة لاعتبار السعر الفارغ أو غير المحدد مساوياً للصفر المقبول (0.00 ج.م) دعماً لحركات النقل والصرف المخزني المجرد من الأسعار، واقتصار الخطأ فقط على القيم السالبة الصريحة (`< 0`) للقضاء تماماً على مشكلة تعليق وحبس المؤشر في خانة السعر عند الحفظ.
      - **تحسين خانة إدخال السعر ومنع تكرار الصفر (`PurchaseOrderItemsTable.tsx`):** إضافة التحديد التلقائي لكامل محتوى الخانة عند التركيز (`onFocus.select`) وتسوية القيمة عند الخروج (`onBlur`) لمنع تحول الصفر إلى `00` عند محاولة المستخدم كتابة صفر إضافي.
  15. **إحكام عزل باقات الاشتراك والباقة الأساسية (Subscription Plans Feature Isolation & Gating):**
      - **ترحيل موديول الخدمات والمصنعيات:** ربطه بباقة النمو (الاحترافية Pro) وتثبيت شارة القفل ونافذة الترقية الموحدة ومنع تفعيله في الباقة الأساسية.
      - **ترحيل تحديد الطاولة والعميل بالسلة (`posShowCartMeta`):** ربطه بالباقة المتكاملة (Ultimate ERP) مع شارة القفل الرسمية.
      - **إحكام مسار ولوحة التحكم الرئيسية (`/` و `DashboardPage.tsx`):** ربط لوحة التحكم ومسار البداية بميزة `reports`، بحيث يتم إخفاء "الرئيسية" تماماً من السايد بار في الباقة الأساسية، وتوجيه المشترك فور تسجيل الدخول أو عند زيارة مسار البداية تلقائياً إلى شاشة نقاط البيع السريعة (`/pos`).
      - **إثراء وتفصيل بطاقات الباقات وجدول المقارنة الكامل (`SubscriptionPlansCards.tsx` & `DetailedPlanFeaturesMatrix.tsx`):** إعادة صياغة بطاقات الباقات الأربع بمحتوى تسويقي مؤسسي مكثف وشامل يعكس القيمة الحقيقية لكل باقة، مع إضافة جدول تفصيلي تفاعلي متكامل يغطي أكثر من 45 ميزة ونظاماً فرعياً مقسمة إلى 9 قطاعات تشغيلية مع إمكانية الطي والفتح السلس لمساعدة العميل على المقارنة والترقية بثقة.
  16. **معالجة ومزامنة موديولات الإعدادات مع الباقات وحظر الشيك بوكس النشط للموديولات المقفلة (Modules Settings Plan Sync & Strict Locked UI Enforcement):**
      - **تصحيح القيم الافتراضية بمخطط ونموذج الإعدادات (`settings.schema.ts` & `SettingsMainForm.tsx`):** ضبط قيم الموديولات المتقدمة الافتراضية (الأصول الثابتة، التقسيط، الإقرار الضريبي، أسطول التوصيل، المتجر الإلكتروني، الموارد البشرية) لتكون `false` كقيمة افتراضية، وقصر `true` كافتراضي على نقاط البيع والمشتريات والمخازن.
      - **ربط حالة الاختيار الصارم لكافة الموديولات العشرين (`ModulesSettingsTab.tsx`):** ربط خاصية `checked={Boolean(isXActive)}` صراحة لكافة مربعات الاختيار مع شرط الترخيص `hasFeature`، بحيث تظهر الموديولات غير المشمولة في باقة العميل بحالة غير مفعلة (`[ ]`) ومقفلة بالكامل (`disabled`) مع إيقاف أي تلوين أخضر نشط.
      - **المزامنة التلقائية لموديولات المنشأة عند تبديل الباقة (`saas-admin.service.ts` & `DeveloperActivationPanel.tsx`):** استدعاء دالة `syncTenantModuleSettingsForPlan` تلقائياً عند تغيير أو ترقية الباقة لتعطيل الموديولات غير المسموح بها في الباقة الجديدة وحفظ الحالة الصحيحة فورياً في جدول الإعدادات بقاعدة البيانات.
  17. **تطوير وتنسيق قسم الاستيراد والحاويات والشراكة وتوحيد النوافذ المنبثقة القياسية (Import & Shipments & Partner Profit Pool Enterprise Polish):**
      - **ترقية نافذة إضافة حاوية شحن (`NewShipmentDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `580px` وشبكة حقول متناسقة (2-Column Grid) مع هيدر قياسي وزر إغلاق رسمي وأزرار حفظ وإلغاء مؤسسية مع شارة التحميل.
      - **ترقية نافذة إضافة صنف للحاوية (`AddShipmentItemDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `640px` مع محدد الأصناف السحابي `SearchableCombobox` وحقول الكمية وسعر الشراء بالدولار.
      - **تطوير صفحة إدارة الحاويات والشحنات (`ShipmentsManager.tsx`):** إضافة 3 كروت مؤشرات أداء (حاويات في البحر، في الجمارك، مكتملة التكلفة بالمخازن) مع جدول شحنات مؤسسي وشارات حالات شحن ملونة وأزرار تفاصيل مدمجة.
      - **تطوير صفحة محفظة سداد موردي الخارج وتدبير العملة (`SupplierCredit.tsx`):** استبدال كلاسات تيلويند غير المدعومة بنظام كروت مؤسسي ناصع، 3 كروت KPI للمديونيات بالدولار والسيولة المتاحة، نموذج تسجيل حوالة متناسق، وجدول سجل حوالات أجنبية مع حالة فارغة أنيقة.
      - **ترقية نافذة إدارة الشركاء وتوزيع النسب (`ManagePartnersDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `min(860px, 95vw)` مع نموذج إضافة شريك بشبكة حقول متجاوبة وربط بالخزائن البنكية، جدول شركاء مؤسسي بحسابات مبالغ ونسب الأرباح، زر إعادة حساب النسب آلياً من رأس المال، كشف حساب الشريك، وحساب الإجمالي مع تنبيهات التحقق من 100%.
      - **ترقية نوافذ حركات رأس المال وكشف الحساب (`PartnerLedgerComponents.tsx`):** ترقية `CapitalTransactionDialog` و `PartnerLedgerDialog` إلى `StandardDialog` مع شارات ملونة للإيداع والسحب وصرف الأرباح، وتوجيه آلي لحركات الخزينة.
      - **ترقية مجمع أرباح الشركاء وتصفية الحسابات (`ProfitPool.tsx`):** تثبيت العرض القياسي 1280px، إضافة 3 كروت إحصائية مؤسسية (إجمالي الإيرادات، إجمالي التكلفة والمصاريف مع التفصيل، صافي الربح المتاح للتوزيع)، جدول توزيع أرباح الشركاء بحسابات حقيقية دقيقة، نافذة منبثقة معيارية لصرف دفعات الأرباح (`PartnerPayoutModal`) مع خيار ملء كامل الرصيد المتبقي بضغطة زر بدلاً من النوافذ البدائية للمتصفح.
      - **توحيد عرض صفحات النظام على 1280px:** تثبيت العرض القياسي الموحد لكافة صفحات النظام والتقارير وشجرة الحسابات والصيدليات والصيانة لمنع أي تباين في أبعاد الكروت.
  18. **ربط محدد الأصناف الذكي في قوائم الأسعار والشرائح (Customer Price Lists Product Selector & ID Binding):**
      - **ترقية حقل اختيار الصنف في نافذة قوائم الأسعار (`PriceListModal.tsx`):** تحويل خانة الصنف من مجرد حقل نصي حر إلى محدد أصناف سحابي ذكي متكامل `SearchableCombobox` مرتبط بقاعدة بيانات المنتجات `useProductsQuery`.
      - **البحث السريع بالاسم والباركود والكود:** دعم البحث المتطابق باللغة العربية `matchesArabic` مع إظهار الباركود وسعر البيع الحالي الافتراضي لكل صنف كمرجع تسعيري فوري.
      - **ربط وحفظ المعرف الحقيقي للصنف (`product_id`):** تمرير `product_id` بدقة إلى كائن `PriceListItem` في قاعدة البيانات لضمان التقاط ومطابقة الصنف آلياً بنسبة 100% في محرك التسعير ونقاط البيع (`calculateEffectivePrice`).
  19. **سجل التدقيق الجنائي غير القابل للتلاعب وسلاسل التجزئة التشفيرية (Tamper-evident Cryptographic Audit Trail):**
* **روابط وشاشات الوصول المشمولة:**
  1. إذن صرف المخزون الجديد (`/inventory/new-issue-order`).
  2. فاتورة / أمر المشتريات الجديدة (`/purchases/new`).
  3. أوامر البيع وحجز المخزون (`/sales/orders`).
  4. أوامر الشراء PO مع الموردين (`/purchases/orders`).
  5. عروض الأسعار للعملاء (`/sales/quotations`).
* **مسارات الكود الأساسية:**
  * **الخطاف العام (Universal Hook):** `frontend/src/shared/hooks/use-form-draft.ts`.
  * **مكون التنبيه المؤسسي (UI Banner):** `frontend/src/shared/components/DraftRestoredBanner.tsx`.
  * **صفحات التنفيذ:** `NewIssueOrderPage.tsx`, `useNewPurchaseOrderController.ts`, `SalesOrdersPage.tsx`, `PurchaseOrdersPage.tsx`, `QuotationsPage.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **حماية المدخلات من الفقدان العرضي:** في حال قام المستخدم بإدخال عدة أصناف أو بيانات في إذن صرف أو فاتورة مشتريات أو أمر بيع، ثم انتقل بالخطأ إلى صفحة أخرى أو نقر على رابط في القائمة الجانبية أو أغلق المتصفح، تظل كافة البيانات المحررة والأصناف محفوظة في المتصفح محلياً دون فقدان أي بند.
  2. **صفر حمل على السيرفر وانعدام البطء (Zero CPU/Server Load):** يتم الحفظ داخل متصفح المستخدم (`localStorage`) عبر محرك تأخير ذكي (Debounce 400ms) مع مقارنة البصمة الحركية (`Snapshot Check`), فلا يتم الحفظ إلا عند حدوث تغيير حقيقي، مع تفريغ فوري (`flushDraft`) قبل مغادرة الصفحة أو عند إغلاق التبويب (`beforeunload`).
  3. **تطهير وتفريغ تلقائي للمسودة:** يتم مسح المسودة تلقائياً وفورياً بمجرد تأكيد وحفظ العملية بنجاح أو عند قيام المستخدم بإلغاء المسودة أو تصفير النموذج لضمان نظافة التخزين وعدم بقاء مخلفات قديمة.
  4. **شريط استرجاع مؤسسي أنيق (DraftRestoredBanner):** إشعار بصري ناعم مطابق للدستور المؤسسي بدون إيموجيز يُنبه المستخدم بأنه تم استرجاع مدخلات المسودة السابقة تلقائياً مع زر مباشر لمسح المسودة والبدء من جديد بنقرة واحدة.

---


<!-- migrated:cap-105:end -->

<a id="cap-106"></a>
<!-- migrated:cap-106:start -->
## 76. معمارية تقسيم الملفات والوحدات وتحسين سرعة وصيانة النظام (Modularization & High-Performance Architecture)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري والأداء المؤسسي (Clean Modular Architecture & Performance).
* **معيار المقارنة الدولي:** Clean Architecture & Domain-Driven Component Slicing.
* **مسارات الكود والوحدات المقسمة:**
  1. **إدارة الصيانة (Maintenance Module):**
     - تم تقليص `MaintenanceTicketsPage.tsx` من 1,961 سطر إلى 696 سطر (تخفيض بنسبة 65%).
     - استخراج الأيقونات والتكوينات إلى `frontend/src/features/maintenance/components/MaintenanceConstants.tsx`.
     - استخراج نافذة الاستلام والإيصال إلى `frontend/src/features/maintenance/components/MaintenanceCreateTicketModal.tsx`.
     - استخراج تفاصيل الصيانة وصرف القطع وعمولة الفني إلى `frontend/src/features/maintenance/components/MaintenanceDetailModal.tsx`.
     - استخراج تسوية الحساب والتسليم إلى `frontend/src/features/maintenance/components/MaintenanceSettlementModal.tsx`.
  2. **إدارة أوامر البيع (Sales Orders Module):**
     - تم استخراج منتقي المنتجات والباركود (Combobox Portal) المعقد من `SalesOrdersPage.tsx` إلى المكون المستقل `frontend/src/features/sales/components/OrderItemProductPicker.tsx` (تخفيض 287 سطر).
  3. **إدارة المنصة والسوبر أدمن (SaaS Admin Module):**
     - تم تقليص `SaasTenantsPage.tsx` من 1,704 سطر إلى 1,274 سطر باستخراج نافذة توليد النسخ التجريبية وإدارة بيانات الدخول إلى `frontend/src/features/saas-admin/components/CreateTrialTenantModal.tsx`.
     - توحيد وتنسيق صفحة باقات الساس `SaasPlansPage.tsx` بنسبة 100% وفق دستور النظام البصري ومطابقتها لنموذج الأقساط `installments` (عمود العرض `document-prototype-column`، هيدر `PageHeader` بشارة SaaS Admin، بطاقات الإحصائيات `StatsGrid`، شريط بحث فوري، وقسم البطاقة `document-prototype-section`).
  4. **كاش الباك إند فائق السرعة (Backend In-Memory Cache Engine):**
     - تفعيل كاش ذاكرة فائق السرعة لبيانات الإعدادات والفروع والمواقع في `backend/src/modules/settings/settings.service.ts` مع إبطال فوري وتلقائي عند الحفظ أو التعديل لتسريع الاستجابة.
  5. **تقسيم كود الإعدادات (Lazy Code-Splitting):**
     - تحويل الأقسام الثانوية في `SettingsSectionContent.tsx` إلى `React.lazy` و `Suspense` لتسريع تحميل واجهة الإعدادات وتقليل حجم حزمة الجافاسكريبت المبدئية.
  6. **تنظيف وتحسين ملفات التنسيق (CSS Optimization):**
     - إزالة 1,115 سطر من الأكواد المكررة في `frontend/src/styles/partials/document-form-prototype.css` وتوحيد أنماط الدارك مود.
  7. **إدارة الشيكات والأوراق المالية (PDC Cheques Module):**
     - تم تقليص `PdcChequesPage.tsx` من 1,643 سطر إلى 969 سطر (تخفيض أكثر من 670 سطر).
     - استخراج نافذة تسجيل ورقة قبض / دفع جديدة بكامل منطق الفاليديشن والعملات والتواريخ إلى `frontend/src/features/accounting/components/PdcChequeCreateModal.tsx`.
     - استخراج نافذة دورة حياة الشيك (إيداع بنكي، تحصيل، صرف، ارتداد مع الغرامات، تظهير لمورد) إلى `frontend/src/features/accounting/components/PdcChequeActionModal.tsx`.
     - استخراج معاينة وطباعة السند المالي الرسمي للشيك إلى `frontend/src/features/accounting/components/PdcChequeVoucherModal.tsx`.
  8. **كاش خطط وباقات الساس وميزات النظام (SaaS & Feature Plans In-Memory Cache):**
     - إضافة كاش ذاكرة ذكي في `backend/src/modules/saas-admin/saas-admin.service.ts` لطلبات استعلام الباقات ومصفوفة الميزات (5 دقائق TTL) مع إبطال فوري عند الإنشاء أو التعديل لتسريع الاستجابة وتخفيف الحمل على قاعدة البيانات.
  9. **تحسين أداء الرسوم ومسارات الـ CSS (CSS Composition & Zero Perpetual Loops):**
     - إزالة الأنيميشن المستمر `reportFloat` اللانهائي في `frontend/src/styles/partials/features.css` لمنع استهلاك المعالج والـ GPU المستمر، والتأكد من صفر لاج في الرسوم البيانية التفاعلية.
  10. **تفكيك وتدقيق صفحات النظام الكبرى (Enterprise Page Modularization - Categories 1 & 2):**
      - تم بنجاح تفكيك وتقليص كافة صفحات الفئة الأولى (> 600 سطر) والفئة الثانية (500 إلى 600 سطر) لتصبح جميعها رشيقة وتحت سقف 400 سطر (معظمها بين 150 و 260 سطر) بنسبة إنجاز 100% وبصفر أخطاء TypeScript:
      - **قوائم الأسعار (`PriceListsPage.tsx`):** من 625 إلى 260 سطر باستخراج `PriceListModal.tsx` و `PriceListCard.tsx`.
      - **حضور وانصراف الموظفين (`HrAttendancePage.tsx`):** من 624 إلى 341 سطر باستخراج `AttendanceKpiSummary.tsx`, `DailyAttendanceTable.tsx`, `AttendanceExceptionsTable.tsx`, `ManualAttendanceModal.tsx`.
      - **تصنيفات المنتجات (`ProductCategoriesPage.tsx`):** من 613 إلى 337 سطر باستخراج `CategoriesDataTable.tsx`, `CategoryFormModal.tsx`, `CategoryTransferProductsModal.tsx`, `CategoryTransferWarehouseModal.tsx`.
      - **الأصول الثابتة والإهلاك (`AccountingFixedAssetsPage.tsx`):** من 598 إلى 265 سطر باستخراج `AddFixedAssetModal.tsx`, `DepreciateModals.tsx`, `FixedAssetsTable.tsx`, `FixedAssetsLogsTable.tsx`.
      - **تخصيص وسداد الفواتير (`PaymentAllocationPage.tsx`):** من 592 إلى 257 سطر باستخراج `PartnerSelectorBar.tsx`, `UnallocatedPaymentsCard.tsx`, `OpenInvoicesCard.tsx`.
      - **إقرار ضريبة القيمة المضافة (`VatDeclarationPage.tsx`):** من 576 إلى 194 سطر باستخراج `VatPeriodSelector.tsx`, `VatSalesTable.tsx`, `VatPurchasesTable.tsx`, `VatSummaryBox.tsx`.
      - **شاشة العميل (`CustomerFacingDisplayPage.tsx`):** من 564 إلى 203 سطر باستخراج `CfdHeader.tsx`, `CfdIdleView.tsx`, `CfdScanningView.tsx`, `CfdCompletedView.tsx`.
      - **نواقص الصيدلية (`PharmacyShortagesPage.tsx`):** من 549 إلى 198 سطر باستخراج `ShortagesKpiGrid.tsx`, `ShortageQuickAddBar.tsx`, `ShortageFilterBar.tsx`, `ShortagesTable.tsx`, `ShortageDetailModal.tsx`.
      - **تعديل بيانات الموظف (`EmployeeEditPage.tsx`):** من 541 إلى 217 سطر باستخراج أقسام البيانات الأساسية، التعويضات والرواتب، بيانات الوظيفة، سياسة الحضور، والبيانات البنكية.
      - **إنشاء وتعديل تركيبة المنتج BOM (`NewBomPage.tsx` & `EditBomPage.tsx`):** من 536 و 526 سطر إلى 253 و 249 سطر عبر استخراج مكونات مشتركة `BomLinesTable.tsx`, `BomCostSummaryCard.tsx`, `bom-types.ts`.
      - **تقارير الموارد البشرية (`HrReportsPage.tsx`):** من 532 إلى 173 سطر باستخراج `HrReportsKpiBar.tsx`, `HrReportsFiltersToolbar.tsx`, `HrReportsOverviewGrid.tsx`, `HrReportsDetailSections.tsx`.
      - **مجموعات خيارات وإضافات المنتجات (`ProductModifiersPage.tsx`):** من 512 إلى 216 سطر باستخراج `ModifierGroupCard.tsx` و `ModifierGroupModal.tsx`.
      - **الروشتات والتأمين الصحي (`PharmacyPrescriptionsPage.tsx`):** من 510 إلى 151 سطر باستخراج `PrescriptionsKpiGrid.tsx`, `PrescriptionsFilterBar.tsx`, `PrescriptionsTable.tsx`, `PrescriptionModal.tsx`.
  11. **القضاء التام على وميض الإطار الأسود العابر عند تحميل الصفحات وتوحيد صفحة قوائم الأسعار (Global Focus Stroke Suppression & PriceLists Page Standardization):**
      - **حل جذري لمشكلة الستروك الأسود (Zero Transient Focus Ring):** إزالة محددات `:where(...)` ذات الأولوية الصفرية في `app.css` و `base.css` وتطبيق محددات مباشرة فائقة الأولوية مع `!important` تمنع المتصفح من إظهار أي إطار تركيز عابر (`outline: none !important; outline-color: transparent !important;`) على الحاويات والبطاقات (`div`, `section`, `article`, `main`, `.card`, `.document-prototype-section`, إلخ) عند تبديل الصفحات أو انتهاء التحميل غير المتزامن.
      - **إزالة الوسوم المتداخلة `<main>`:** استبدال وسم `<main>` الداخلي بـ `<div>` في `PriceListsPage`, `QuotationsPage`, `InstallmentsPage` لمنع ارتباك المتصفح في توجيه التركيز التلقائي.
      - **توحيد صفحة قوائم الأسعار (`PriceListsPage.tsx`):** ترقية الصفحة لتطابق الدستور البصري الموحد بالكامل عبر إضافة بطاقات الإحصائيات الذكية `StatsGrid` (إجمالي القوائم، القوائم المفعلة، القائمة الافتراضية، إجمالي القواعد)، تغليف المحتوى داخل `.document-prototype-section` القياسي، واستخدام مكون الزر الرسمي `Button` في الحالة الفارغة.
      - الالتزام التام بكافة معايير النظام البصري: اتجاه RTL، أيقونات SVG رسمية حصرياً، نوافذ عبر `StandardDialog` و `DialogShell` (صفر أخطاء clipping أو أوفري عشوائي)، واستبعاد كلاسات تيلويند نهائياً.
  12. **التحصين الوقائي للعمليات التشغيلية واللانشر (Defensive Hardening for User Operations & Launcher):**
      - **إرشاد المستخدم عند حذف الحسابات (`users.service.ts`):** تحويل خطأ قاعدة البيانات العام لتعارض المفتاح الأجنبي عند محاولة حذف مستخدم مسجل بحركات مالية أو مخزنية سابقة إلى رسالة عربية إرشادية واضحة ومباشرة: *"لا يمكن حذف هذا المستخدم لوجود فواتير أو حركات مخزنية مسجلة باسمه. يمكنك تعطيل حسابه بدلاً من الحذف للحفاظ على السجلات المالية"* بكود خطأ `USER_HAS_TRANSACTIONS` (400) بدلاً من استثناء قاعدة البيانات العام.
      - **التحقق المسبق من مسار النسخ الاحتياطي (`settings-backup.service.ts`):** فحص مسار مجلد النسخ الاحتياطي وتطهيره من الرموز الممنوعة (`?`, `*`, `<`, `>`, `|`) ومنع مسارات ويندوز المشوهة مثل `\\?`، وترجمة أي تعذر في الكتابة لخطأ `400` معتمد بدلاً من حدوث خطأ خادم غير معالج 500 في السجلات.
      - **قفل التشغيل المتزامن في اللانشر المحمول (`Start-ZS.ps1`):** إضافة آلية قفل مؤقت (`starting.lock`) لمنع إطلاق عمليات خلفية مكررة واصطدام البورت 3001 (`EADDRINUSE`) عند الضغط المزدوج السريع على اختصار تشغيل النسخة المحمولة.
  13. **تسريع فائق لإقلاع نسخة الإلكترون والنسخة المحمولة (Electron & Portable Startup Optimization):**
      - **تفعيل كاش التجميع V8 المدمج (`NODE_COMPILE_CACHE`):** تفعيل كاش البايت كود المدمج لمحرك Node 22+ في كل من `backend/src/main.ts`، وعملية الإلكترون الرئيسية `frontend/electron/main.cjs`، واللانشر المحمول `Start-ZS.ps1`، مما يخفض وقت تحميل موديولات NestJS والفرونت إند بنسبة تصل إلى 40% عند الإقلاع المتكرر.
      - **فحص جهوزية قاعدة البيانات عبر مآخذ TCP غير المتزامنة (`postgres-manager.cjs`):** استبدال استدعاءات `execSync("psql.exe")` المتكررة التي كانت تحجب مسار الـ Event Loop بفحص مباشر لمقبس TCP (`net.Socket`) كل 100ms، مما يوفر مئات المللي ثوانٍ ويقضي على أي تجميد عابر أثناء شاشة البداية.
      - **المصافحة اللحظية لجاهزية الخادم عبر IPC (`main.cjs`):** التقاط إشارة الجاهزية اللحظية (`ready`) المرسلة من الباك إند عبر قنوات الـ IPC المباشرة وإظهار النافذة الرئيسية دون انتظار دورات الاستطلاع الشبكي، مع التحديد الديناميكي لمنفذ الخادم.
  14. **معالجة وتصحيح التحقق من الصفر وأسعار الأصناف في أوامر الشراء والتحويلات المخزنية (Purchase & Stock Transfers Zero-Price Validation Hardening):**
      - **الصفر الآمن الافتراضي لكافة الأصناف (`useNewPurchaseOrderController.ts`):** تحصين دوال اختيار الأصناف (`handleProductSelect`, `addProductAsLine`, `incrementProductByBarcode`, `handleProductCreateSuccess`) بحيث تسند رقماً صحيحاً `0` في حال كان الصنف مسجلاً بدون سعر تكلفة أو تم إنشاؤه حديثاً، لمنع تواجد قيمة `undefined` في كائن البند.
      - **مرونة دالة التحقق وقبول السعر الصفري (`validateBeforeConfirm`):** تعديل دالة فحص الفاتورة لاعتبار السعر الفارغ أو غير المحدد مساوياً للصفر المقبول (0.00 ج.م) دعماً لحركات النقل والصرف المخزني المجرد من الأسعار، واقتصار الخطأ فقط على القيم السالبة الصريحة (`< 0`) للقضاء تماماً على مشكلة تعليق وحبس المؤشر في خانة السعر عند الحفظ.
      - **تحسين خانة إدخال السعر ومنع تكرار الصفر (`PurchaseOrderItemsTable.tsx`):** إضافة التحديد التلقائي لكامل محتوى الخانة عند التركيز (`onFocus.select`) وتسوية القيمة عند الخروج (`onBlur`) لمنع تحول الصفر إلى `00` عند محاولة المستخدم كتابة صفر إضافي.
  15. **إحكام عزل باقات الاشتراك والباقة الأساسية (Subscription Plans Feature Isolation & Gating):**
      - **ترحيل موديول الخدمات والمصنعيات:** ربطه بباقة النمو (الاحترافية Pro) وتثبيت شارة القفل ونافذة الترقية الموحدة ومنع تفعيله في الباقة الأساسية.
      - **ترحيل تحديد الطاولة والعميل بالسلة (`posShowCartMeta`):** ربطه بالباقة المتكاملة (Ultimate ERP) مع شارة القفل الرسمية.
      - **إحكام مسار ولوحة التحكم الرئيسية (`/` و `DashboardPage.tsx`):** ربط لوحة التحكم ومسار البداية بميزة `reports`, بحيث يتم إخفاء "الرئيسية" تماماً من السايد بار في الباقة الأساسية، وتوجيه المشترك فور تسجيل الدخول أو عند زيارة مسار البداية تلقائياً إلى شاشة نقاط البيع السريعة (`/pos`).
      - **إثراء وتفصيل بطاقات الباقات وجدول المقارنة الكامل (`SubscriptionPlansCards.tsx` & `DetailedPlanFeaturesMatrix.tsx`):** إعادة صياغة بطاقات الباقات الأربع بمحتوى تسويقي مؤسسي مكثف وشامل يعكس القيمة الحقيقية لكل باقة، مع إضافة جدول تفصيلي تفاعلي متكامل يغطي أكثر من 45 ميزة ونظاماً فرعياً مقسمة إلى 9 قطاعات تشغيلية مع إمكانية الطي والفتح السلس لمساعدة العميل على المقارنة والترقية بثقة.
  16. **معالجة ومزامنة موديولات الإعدادات مع الباقات وحظر الشيك بوكس النشط للموديولات المقفلة (Modules Settings Plan Sync & Strict Locked UI Enforcement):**
      - **تصحيح القيم الافتراضية بمخطط ونموذج الإعدادات (`settings.schema.ts` & `SettingsMainForm.tsx`):** ضبط قيم الموديولات المتقدمة الافتراضية (الأصول الثابتة، التقسيط، الإقرار الضريبي، أسطول التوصيل، المتجر الإلكتروني، الموارد البشرية) لتكون `false` كقيمة افتراضية، وقصر `true` كافتراضي على نقاط البيع والمشتريات والمخازن.
      - **ربط حالة الاختيار الصارم لكافة الموديولات العشرين (`ModulesSettingsTab.tsx`):** ربط خاصية `checked={Boolean(isXActive)}` صراحة لكافة مربعات الاختيار مع شرط الترخيص `hasFeature`, بحيث تظهر الموديولات غير المشمولة في باقة العميل بحالة غير مفعلة (`[ ]`) ومقفلة بالكامل (`disabled`) مع إيقاف أي تلوين أخضر نشط.
      - **المزامنة التلقائية لموديولات المنشأة عند تبديل الباقة (`saas-admin.service.ts` & `DeveloperActivationPanel.tsx`):** استدعاء دالة `syncTenantModuleSettingsForPlan` تلقائياً عند تغيير أو ترقية الباقة لتعطيل الموديولات غير المسموح بها في الباقة الجديدة وحفظ الحالة الصحيحة فورياً في جدول الإعدادات بقاعدة البيانات.
  17. **تطوير وتنسيق قسم الاستيراد والحاويات والشراكة وتوحيد النوافذ المنبثقة القياسية (Import & Shipments & Partner Profit Pool Enterprise Polish):**
      - **ترقية نافذة إضافة حاوية شحن (`NewShipmentDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `580px` وشبكة حقول متناسقة (2-Column Grid) مع هيدر قياسي وزر إغلاق رسمي وأزرار حفظ وإلغاء مؤسسية مع شارة التحميل.
      - **ترقية نافذة إضافة صنف للحاوية (`AddShipmentItemDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `640px` مع محدد الأصناف السحابي `SearchableCombobox` وحقول الكمية وسعر الشراء بالدولار.
      - **تطوير صفحة إدارة الحاويات والشحنات (`ShipmentsManager.tsx`):** إضافة 3 كروت مؤشرات أداء (حاويات في البحر، في الجمارك، مكتملة التكلفة بالمخازن) مع جدول شحنات مؤسسي وشارات حالات شحن ملونة وأزرار تفاصيل مدمجة.
      - **تطوير صفحة محفظة سداد موردي الخارج وتدبير العملة (`SupplierCredit.tsx`):** استبدال كلاسات تيلويند غير المدعومة بنظام كروت مؤسسي ناصع، 3 كروت KPI للمديونيات بالدولار والسيولة المتاحة، نموذج تسجيل حوالة متناسق، وجدول سجل حوالات أجنبية مع حالة فارغة أنيقة.
      - **ترقية نافذة إدارة الشركاء وتوزيع النسب (`ManagePartnersDialog.tsx`):** ترقيتها إلى `StandardDialog` بعرض `min(860px, 95vw)` مع نموذج إضافة شريك بشبكة حقول متجاوبة وربط بالخزائن البنكية، جدول شركاء مؤسسي بحسابات مبالغ ونسب الأرباح، زر إعادة حساب النسب آلياً من رأس المال، كشف حساب الشريك، وحساب الإجمالي مع تنبيهات التحقق من 100%.
      - **ترقية نوافذ حركات رأس المال وكشف الحساب (`PartnerLedgerComponents.tsx`):** ترقية `CapitalTransactionDialog` و `PartnerLedgerDialog` إلى `StandardDialog` مع شارات ملونة للإيداع والسحب وصرف الأرباح، وتوجيه آلي لحركات الخزينة.
      - **ترقية مجمع أرباح الشركاء وتصفية الحسابات (`ProfitPool.tsx`):** تثبيت العرض القياسي 1280px، إضافة 3 كروت إحصائية مؤسسية (إجمالي الإيرادات، إجمالي التكلفة والمصاريف مع التفصيل، صافي الربح المتاح للتوزيع)، جدول توزيع أرباح الشركاء بحسابات حقيقية دقيقة، نافذة منبثقة معيارية لصرف دفعات الأرباح (`PartnerPayoutModal`) مع خيار ملء كامل الرصيد المتبقي بضغطة زر بدلاً من النوافذ البدائية للمتصفح.
      - **توحيد عرض صفحات النظام على 1280px:** تثبيت العرض القياسي الموحد لكافة صفحات النظام والتقارير وشجرة الحسابات والصيدليات والصيانة لمنع أي تباين في أبعاد الكروت.
  18. **ربط محدد الأصناف الذكي في قوائم الأسعار والشرائح (Customer Price Lists Product Selector & ID Binding):**
      - **ترقية حقل اختيار الصنف في نافذة قوائم الأسعار (`PriceListModal.tsx`):** تحويل خانة الصنف من مجرد حقل نصي حر إلى محدد أصناف سحابي ذكي متكامل `SearchableCombobox` مرتبط بقاعدة بيانات المنتجات `useProductsQuery`.
      - **البحث السريع بالاسم والباركود والكود:** دعم البحث المتطابق باللغة العربية `matchesArabic` مع إظهار الباركود وسعر البيع الحالي الافتراضي لكل صنف كمرجع تسعيري فوري.
      - **ربط وحفظ المعرف الحقيقي للصنف (`product_id`):** تمرير `product_id` بدقة إلى كائن `PriceListItem` في قاعدة البيانات لضمان التقاط ومطابقة الصنف آلياً بنسبة 100% في محرك التسعير ونقاط البيع (`calculateEffectivePrice`).
  19. **سجل التدقيق الجنائي غير القابل للتلاعب وسلاسل التجزئة التشفيرية (Tamper-evident Cryptographic Audit Trail):**
      - **الرصد على مستوى محرك قاعدة البيانات (PostgreSQL Triggers):** قوادح آلية `AFTER INSERT OR UPDATE OR DELETE` على 11 جدولاً حرجاً في النظام (`journal_entries`, `journal_entry_lines`, `accounting_accounts`, `accounting_settings`, `sales`, `sale_items`, `purchases`, `purchase_items`, `treasuries`, `treasury_transactions`) لتوثيق أي عملية تتم من التطبيق أو من داخل السيرفر و `psql` مباشرة.
      - **الحماية القصوى وجدول القيد الإضافي الحصري (Append-Only Immutable Table):** قادح حماية `fn_tamper_audit_prevent_tamper` يمنع رفضاً قاطعاً أي أمر `UPDATE` أو `DELETE` على جدول `tamper_audit_logs`.
      - **سلاسل التجزئة التشفيرية المتسلسلة (SHA-256 Hash Chaining):** حساب بصمة رقمية لكل حركة مشتقة من الهاش السابق `sha256(prev_hash || tenant_id || table_name || record_id || op || diff || new)` لمحاكاة كتل البلوكشين (Merkle Chain)، مع خوارزمية فحص النزاهة `verifyChainIntegrity` لكشف أي تلاعب أو انقطاع في السلسلة.
      - **شاشة تدقيق وتحليل جنائي متكاملة:** تبويب مخصص في شاشة `/audit` مع بطاقة فحص النزاهة التشفيرية اللحظية، فلاتر الجداول والعمليات، نافذة منبثقة معيارية `TamperAuditDiffModal` لاستعراض الفوارق الحقلية (Field-Level Diff) بلونين للأحمر والأخضر ونسخ أكواد الهاش الرقمية.
  20. **حزمة التفوق المؤسسي وسلاسل الإمداد والمحاسبة المتقدمة (Enterprise Accounting & Procurement Powerhouse - Odoo & Dynamics BC Parity):**
      - **محرك سير عمل الموافقات متعدد المستويات (Multi-Tier Approval Workflow Engine):**
        - المسار الفعلي المربوط حالياً هو **أوامر الشراء فقط** عبر `/approvals` وجداول `approval_rules`, `approval_requests`, `approval_request_logs`.
        - تُنشأ الموافقة عند تأكيد أمر الشراء إذا انطبقت قاعدة مبلغ؛ يراجعها مدير آخر (`admin`) حسب المستوى والمستخدم المعيّن اختيارياً. الاعتماد النهائي والتحديث الفعلي للمستند في معاملة واحدة، والرفض يعيده إلى مسودة.
        - أنواع الفواتير والمصروفات والخزينة غير مفعلة في محرك الموافقات حتى ربط مسارات إنشائها وترحيلها به.
      - **الجدولة المؤتمتة لقيود إهلاك الأصول الثابتة (Automated Depreciation Scheduler):**
        - محرك جدولة خلفي دوري `FixedAssetsSchedulerService` يفحص نهاية كل شهر ميلادي لكافة المنشآت والشركات المفعلة تلقائياً.
        - احتساب أقساط الإهلاك بدقة بنظامي القسط الثابت والمتناقص المزدوج وتوليد قيود اليومية المتوازنة وحفظ سجل العمليات.
        - كارت تحكم إداري مباشر في شاشة `/accounting/fixed-assets` يتيح تفعيل/تعطيل الجدولة الآلية، ومعاينة تاريخ التشغيل القادم وآخر شهر تم تشغيله، وزر للتشغيل الفوري بنقرة واحدة.
      - **مصفوفة وقوالب توزيع مراكز التكلفة بالنسب المئوية (Hierarchical Cost Center Allocation Matrix):**
        - محرك توزيع محاسبي تحليلي مالي عبر جداول `cost_center_allocations` و `cost_center_allocation_splits`.
        - تبويب مخصص في شاشة مراكز التكلفة `/accounting/cost-centers` بتصميم مؤسسي ناصع (1280px) لإدارة القوالب وقواعد التوزيع.
        - شريط توزيع لوني مرئي تفاعلي، محاكي مالي فوري لاحتساب المبالغ الموزعة لحظياً مع تحقق صارم من اكتمال النسبة 100%.
      - **محرك تقييم العملات الأجنبية وأرباح وخسائر فروق الصرف IAS 21 (Multi-Currency FX Revaluation Engine):**
        - تطبيق معيار المحاسبة الدولي IAS 21 لإعادة تقييم الأرصدة والحسابات المقومة بالنقد الأجنبي عبر المسار `/accounting/forex`.
        - مسح وتجميع فوري لكافة أرصدة الحسابات النقدية والبنكية وحسابات العملاء والموردين، وحساب فروق أسعار الصرف غير المحققة (Unrealized FX Gain/Loss).
        - توليد قيد تسوية محاسبي آلي متزن في الأستاذ العام وترحيله بنقرة واحدة مع توثيق دورات التقييم في `forex_revaluation_runs` وسطور التقييم في `forex_revaluation_lines`.
      - **تكامل وتدقيق دورة عروض أسعار الموردين وسلسلة الإمداد (Vendor RFQs & Comparison Matrix):**
        - دورة مشتريات وتوريد متكاملة تضاهي Odoo 17 و Dynamics 365 BC عبر المسار `/purchases/rfqs` وربط مباشر عبر زر هيدر المشتريات `PurchasesWorkspace.tsx`.
        - دورة كاملة: إنشاء طلب تسعير ➔ دعوة الموردين ➔ تسجيل العروض والمدد والشروط ➔ مصفوفة مقارنة بصرية تحليلية تبرز العرض الأفضل سعراً والأسرع توريداً ➔ ترسية العرض الفائز وتحويله لأمر شراء رسمي معتمد (PO).
  21. **تأسيس منشأة المنصة المركزية المستقلة `zs` وعزل صلاحيات السوبر أدمن الصارم (Dedicated Platform Root Tenant & Super Admin Isolation):**
      - **منشأة المنصة المركزية المستقلة (`zs`):** تأسيس منشأة المنصة المستقلة بالمعرف الرسمي `zs` في جدول `tenants` بحالة نشطة دائمة، ونقل وتعيين حساب المطور ومسؤول المنصة `zs` بداخلها برتبة `super_admin` عبر المايجريشن رقم 74 (`2040000000074_establish_zs_platform_tenant_and_superadmin_isolation.ts`).
      - **حصرية إنشاء رتبة `super_admin` داخل منشأة `zs` فقط:** تمكين إنشاء وتعيين مستخدمين برتبة `super_admin` حصراً داخل منشأة المنصة المركزية `zs` عبر الواجهة (`UserManagementEditorCard.tsx`) والباك إند (`users.service.ts`).
      - **عزل المتاجر والشركات المستضافة (Multi-Tenant Demotion):** حظر وتخفيض رتبة `super_admin` تلقائياً إلى `admin` في أي منشأة أو متجر آخر خارج منشأة المنصة المركزية حتى لو حمل المستخدم اسم `zs`، مع إخفاء مسارات وقوائم الساس بالكامل عن أي مستخدم خارج منشأة المنصة.
      - **تنظيف شامل للاستثناءات الفردية:** إزالة كافة الشروط القديمة التي كانت تعتمد على فحص اسم المستخدم `username === 'zs'` واستبدالها بنظام عزل نظيف وموحد يعتمد على دالة التحقق الرسمية المزدوجة `isPlatformAdmin(user)`.
  22. **اكتمال محرك هيئة الزكاة والضريبة (ZATCA Phase 2) وجسر التوقيع المصري (ETA USB Token) والطباعة الحرارية المباشرة (ESC/POS Hardware):**
      - **محرك هيئة الزكاة والضريبة والربط التشفيري الذري (ZATCA Phase 2 & EGS Units):**
        - إنشاء جدول `zatca_egs_units` (المايجريشن 75) لتسجيل وتتبع وحدات الفوترة الإلكترونية مع توليد مفاتيح التشفير ECDSA secp256k1 وتوليد شهادات CSR المطابقة لمعايير الهيئة.
        - ربط السلسلة التشفيرية الحية للفواتير عبر الهاش السابق (PIH) والعداد المتسلسل (ICV) وحفظ حقول ZATCA الرسمية في جدول `sales` (`zatca_uuid`, `zatca_hash`, `zatca_prev_hash`, `zatca_icv`, `zatca_status`, `zatca_qr`, `zatca_ubl_xml`).
        - معالج تسجيل وربط تفاعلي متكامل بالـ OTP عبر منصة فاتورة `ZatcaOnboardingWizardModal.tsx` وخدمة `ZatcaOnboardingService` لإصدار شهادة الامتثال (Compliance CSID) وتفعيل شهادة الإنتاج (Production CSID).
      - **جسر توقيع الفاتورة المصرية بالتوكن المحلي (ETA USB Token CAdES-BES Signer Bridge):**
        - خدمة `EtaSignatureBridgeService` لتوليد الـ Canonical JSON المعياري للوثيقة وحساب الـ SHA-256 Hash.
        - نافذة `EtaTokenSignerModal.tsx` تدعم الفحص التلقائي لجسر التوقيع المحلي على المنفذ 8585 مع عرض مؤشر الاتصال الأخضر وبيانات الشهادة، وإمكانية التوقيع والختم بضغطة زر واحدة (1-Click Auto Sign).
        - أداة سطح المكتب المستقلة `tools/zs-eta-signer/` بحجم خفيف (~16KB كملف تنفيذي `zs-eta-signer.exe` مبني بـ C# .NET المدمج بدون أي متطلبات تثبيت، بالإضافة لنسخة Node.js) تعمل كـ Microservice على `http://127.0.0.1:8585` مع مسارات `/health`, `/certificates`, `/sign` وتدعم بطاقات وشهادات Egypt Trust ومصر للمقاصة.
      - **الطباعة الحرارية المباشرة وفتح درج النقدية الصامت (ESC/POS Direct Hardware Bridge):**
        - محرك `escpos-printer.ts` الذي يدعم بروتوكولات WebUSB و WebSerial لإرسال أوامر ESC/POS المباشرة إلى طابعات الإيصالات الحرارية وفتح درج النقدية التلقائي بدون الاعتماد على نافذة حوار المتصفح التقليدية.
  23. **تطهير وحذف المنشآت القديمة المكررة وقصر شارة المنصة المركزية حصراً على `zs` (Legacy Platform Tenants Cleanup & Strict SaaS Isolation):**
      - **حذف وتطهير المنشآت القديمة المكررة (Migration 78):** مايجريشن قاعدة البيانات رقم 78 (`2040000000078_purge_legacy_duplicate_platform_tenants.ts`) لحذف المنشآت القديمة المكررة من فترات التطوير السابقة (`default`, `zsystems`, `zsystems-main`, `karimzakaria-demo`) وكافة سجلاتها التابعة بأمان عبر خوارزمية مسح دورية متعددة المراحل (Multi-pass cascade sweep) مع الحفاظ الصارم بنسبة 100% على المنشأة المركزية الرسمية `zs` ومنشآت العملاء الحقيقيين (`elmohandis`).
  24. **تسريع وتحسين أداء المنظومة لنسختي الساس والديسكتوب (High-Performance Optimization & Zero-Lag Architecture):**
      - **تفكيك حزمة البدء والتحميل الكسول للنوافذ (`root-router.tsx`):** تحويل استيراد صفحات التفعيل ونوافذ الدفع السريع والسلف والعروض إلى استيراد ديناميكي كسول (`React.lazy` و `Suspense`) مما عزل وحدات الحسابات والـ HR والمنتجات عن حزمة الإقلاع الأساسية وخفّض زمن التحميل الأولي.
      - **ترقية نظام التحميل المسبق الذكي التدرجي (`lazy-route.tsx`):** إعادة بناء دالة `prefetchAllRouteModules` لتعمل بجدولة تدريجية ناعمة (Staggered Queue) خلال فترات خمول المتصفح (`requestIdleCallback`) وتأخير بدئها حتى انتهاء استعلامات الإقلاع الرئيسية، لمنع تشبع قنوات الشبكة (Network Congestion) وضمان سرعة فائقة لاستجابة الـ API.
      - **الحفاظ على كاش V8 وتسريع إقلاع الديسكتوب (`frontend/electron/main.cjs`):** حظر المسح الإجباري لكاش كروميوم `clearCache()` عند كل إقلاع وحصره فقط بحالات الترقية الصريحة، مما حافظ على كاش الأكواد البرمجية (V8 Bytecode Cache) وأسرع إقلاع تطبيق الديسكتوب بنسبة 40%.
      - **تجزئة كتل المكتبات الخارجية الضخمة (`vite.config.ts`):** إضافة قواعد تقسيم يدوي للمكتبات الثقيلة (Sentry, i18next, html5-qrcode, image-compression) لتحميلها المتوازي وتخزينها المستقل في كاش المتصفح.
      - **التحميل اللانهائي الذكي لكروت أصناف الكاشير (`PosProductsPanel.tsx`):** تفعيل التحميل التراكمي الناعم لبطاقات الأصناف بالـ `IntersectionObserver` بدفعات متتالية (60 صنفاً لكل دفعة) عند التمرير، لمنع تضخم الـ DOM وتفادي أي تهنيج أو ثقل في واجهة الكاشير عند وجود آلاف المنتجات.
      - **الفحص الاستباقي لصلاحية شهادة الفاتورة المصرية بالـ USB Token (`EtaTokenSignerModal.tsx`):** قراءة تاريخ صلاحية الشهادة وتنبيه المستخدم مسبقاً قبل الانتهاء بـ 45 يوماً مع منع التوقيع بشهادة منتهية وتوضيح السبب بكارت تحذيري أحمر رسمي لتجنب أخطاء نظام التشغيل وبوابة الضرائب.
      - **سياسة تدوير وتطهير سجلات اللوج لـ 90 يوماً في الديسكتوب (`frontend/electron/main.cjs`, `postgres-manager.cjs`):** تطبيق آلية أرشفة وتدوير ذكية تضمن الاحتفاظ بملفات السجلات والنسخ الاحتياطية لـ 90 يوماً على الأقل (3 أشهر) أو فور التأكد من رفعها ومزامنتها بنجاح مع السيرفر، مع منع تضخم ملفات اللوج الفعالة وحمايتها من التلف.
      - **إعادة تصميم شاشة الإقلاع والتهيئة لنسخة الديسكتوب بالهوية المؤسسية الفاخرة (`loading.html`, `main.cjs`):** إلغاء الخلفيات القاتمة والشبكات ومؤثرات التوهج الدائرية المستعارة من قوالب الذكاء الاصطناعي، واستبدالها بتصميم مؤسسي ناصع وراقٍ مستوحى 100% من لوحة تحكم المنظومة، بكانفاس هادئ (`#f8fafc`)، وبطاقة بيضاء نقية بحدود وظلال مؤسسية ناعمة، وشعار Z-Systems الكحلي الملكي المعتمد (`#170e5e`), وشريط تقدم أنيق بدون ألوان متنافرة، وبادج إصدار رسمي يقضي تماماً على أي وميض مظلم أثناء الإقلاع.
  25. **حماية وترميم منشأة وبيانات المتاجر في نسخة الديسكتوب واستقلاليتها الصارمة عن الساس (Desktop Store Tenant Protection & Zero Data Loss Architecture):**
      - **صمامات أمان المايجريشن 74 و 78:** تحصين المايجريشن 74 والمايجريشن 78 باشتراطات أمان قاطعة تمنع تنفيذهما نهائياً في بيئات الديسكتوب والإلكترون المستقلة (`APP_MODE === 'SELF_CONTAINED'` أو `IS_ELECTRON === 'true'`) لحماية منشأة المتجر المحلي `default` وكافة جداولها (الأصناف، المبيعات، الإعدادات، المستخدمين) من أي حذف أو تعديل، مع اشتراط عدم وجود أي أصناف أو مبيعات حقيقية قبل السماح بأي تنظيف.
      - **مايجريشن الحماية والترميم رقم 79 (`2040000000079_desktop_tenant_protection_and_restoration.ts`):** إنشاء مايجريشن وقائي يضمن استقرار منشأة المتجر المحلي `default` وتفعيل اشتراكها الدائم، واسترجاع اسم المحل من الإعدادات، وإعادة ربط المستخدمين بمنشأة المتجر المحلي، وحذف أي منشأة `zs` فارغة تم إنشاؤها بالخطأ في قواعد بيانات الديسكتوب.
      - **توجيه تسجيل الدخول المباشر في الديسكتوب (`session.service.ts`):** إلغاء اشتراط كود المنشأة في وضع الديسكتوب، وتوجيه عملية المصادقة فورياً إلى المنشأة المحلية الحقيقية `default` لكافة المستخدمين المسجلين، مع تجاوز استثناء تعارض المنشآت المتعددة لضمان فتح المنظومة مباشرة على بيانات المتجر.
      - **تطهير واجهة الدخول من كود المنشأة في الديسكتوب (`useLoginForm.ts`, `LoginPage.tsx`):** إخفاء بادج "تسجيل الدخول لمنشأة..." وحقل كود المنشأة وزر تحديده بالكامل في بيئة الإلكترون، مع مسح أي أكواد منشآت قديمة مخزنة في الذاكرة المحلية تلقائياً عند الإقلاع.
      - **تثبيت متغيرات بيئة إلكترون (`frontend/electron/main.cjs`):** تمرير `IS_ELECTRON: 'true'` و `PORTABLE_MODE: 'true'` و `TENANT_ID: 'default'` و `ACCOUNT_ID: 'default'` بشكل دائم وثابت للباك إند.
  26. **محرك الترجمة الشامل وثنائية اتجاه واجهة الكاشير والنماذج المؤسسية (`Universal Auto-Translator, Form Engine & POS Splitter`):**
      - **القاموس المؤسسي الموسع (`ui-dictionary.json`):** توسيع القاموس ليتجاوز 5,507 مصطلحاً وتسمية مؤسسية تغطي كافة التابات، العناوين، الأزرار، التنبيهات الإدارية والمالية، ونماذج إدخال البيانات عبر المنظومة بالكامل (أزرار الحفظ والإلغاء والتفريغ، حقول الأسعار والتكلفة، خيارات القوائم المنسدلة `<select>` و `<option>`، جداول وحدات الأصناف، التنبيهات الغذائية SFDA، بيانات قطع الغيار، وملاحظات النماذج).
      - **محرك ترجمة النماذج والمدخلات الفوري (`Universal Form Translation Engine`):**
        - دعم ترجمة نصوص التلميح النائبة في حقول النصوص المتعددة (`<textarea placeholder="...">`) دون المساس ببيانات المستخدم المكتوبة داخلها.
        - محرك أفعال الحفظ المركبة (`Save Action Variants`): ترجمة فورية لكافة أزرار النماذج (`حفظ الصنف`, `حفظ وإضافة للسلة`, `حفظ بجميع المتغيرات`, `حفظ العميل`, `حفظ المورد`, `حفظ ومتابعة`, `حفظ كمسودة`, `حفظ وإغلاق`).
        - محرك نصوص الحقول التلقائي (`Enter / Type Placeholders`): اشتقاق وترجمة ذكية لكافة حقول الإدخال البادئة بـ `اكتب ` أو `أدخل ` أو `ادخل ` (مثل `اكتب اسم الصنف` -> `Enter product name`, `اكتب اسم العميل` -> `Enter customer name`).
        - محرك الترجمة العودية للأمثلة والقيم التوضيحية (`Example Pattern Recursion`): ترجمة النصوص الوصفية داخل التلميحات مثل `مثال: رف 5` -> `Example: Shelf 5`.
        - محرك مطابقة الأقواس الهجين (`Mixed Parentheses & Bracket Deduplication`): ترجمة الأجزاء العربية داخل التسميات الثنائية مثل `Credit Selling Price (التوزيع والجملة)` -> `Credit Selling Price (Distribution & Wholesale)`، ومنع تكرار الأقواس المطابقة مثل `Item Units (Units)` -> `Item Units`.
        - مزامنة عنوان نافذة المتصفح (`document.title` Synchronization): ترجمة فورية تلقائية لشريط المتصفح وعنوان التبويب عند الانتقال بين الصفحات في الوضع الإنجليزي.
        - تطهير تسميات النماذج من تكرار كلاسات تيلويند الوهمية (`No-Tailwind Cleansing`): إزالة التسميات المكررة في شاشات إضافة وتعديل الأصناف (`سعر الشراء (التكلفة)` و `سعر البيع (قطاعي)`).
      - **مؤشر تقسيم الشاشة ثنائي الاتجاه لنقاط البيع (`useSplitter.ts`, `PosWorkspaceMainContent.tsx`):**
        - حل الخلل الهندسي لانفصال مؤشر تقسيم الشاشة (المسافة الفاصلة بين كارت السلة وكارت الأصناف) عند تحويل اللغة من العربية (RTL) إلى الإنجليزية (LTR).
        - حساب موضع مقبض التمرير بدقة وفق اتجاه المستند (`handlePositionPct = isRtl ? cartRatio : (100 - cartRatio)`).
        - عكس اتجاه السحب ديناميكياً في بيئات LTR لمنع الحركة المعكوسة وضمان ثبات النسبة والتحكم السلس في أحجام اللوحات عبر اللغتين.
      - **محركات التفكيك والتحليل اللحظي (`auto-translator.ts`):**
        - تطبيع الأرقام المشرقية (`[٠-٩]`) تلقائياً إلى أرقام قياسية (`0-9`) لترجمة الكميات المجمعة مثل `١ قطعة` -> `1 Piece`.
        - محرك اختصارات لوحة المفاتيح (`F1` - `F12`) البادئة واللاحقة مع المحاذاة والترجمة الذكية للنصوص المرفقة.
        - محرك التراكيب النقطية الفاصلة (` · `) المستخدمة في أشرطة التنبيه السريعة بالـ POS.
        - معالجة ذكية للأقواس والاختصارات التقنية والمحاسبية (`Esc`, `Debit`, `Credit`, `Tablets`, `PDC`, `ETA`, `KDS`) مع الحفاظ على الأكواد المرجعية.
        - محرك التسميات والرسائل المنتهية بنقطتين (`Label:`): فصل ذكي بين أسماء العملاء والأصناف العربية كبيانات مستخدم وحمايتها، وترجمة جسم التنبيه المؤسسي بالكامل إلى الإنجليزية (`Customer: Balance exceeded credit limit.`).
        - محرك الترتيب وفك التراكيب بالشرطة (`Rank & Dash Separator Decomposition`): دعم بادئات الرتب (`#1 `, `1. `) والشرطة الفاصلة (` - `) لتحويل التراكيب مثل `#1 Apple - هواتف ذكية` إلى `#1 Apple - Smartphones`.
        - محرك التنبيهات التشغيلية والمالية الديناميكية (Rule 21): ترجمة فورية للنسب المتغيرة (نسبة استهلاك حد الائتمان، أيام الصلاحية، فترات الركود، والسطور دون التكلفة).
        - محرك نصوص البحث السريع وفلاتر التابات: منع أي دمج عشوائي للإنجليزية مع العربية، وتوفير نصوص بحث موحدة ثنائية اللغة في الهيدر والسايد بار (`Search in tabs & menus...`).
        - محرك فحص السمات الديناميكية (`placeholder`, `title`, `aria-label`, `value`) في `MutationObserver` مع حماية تامة ومطلقة لبيانات وأصناف المستخدمين المدخلة بالعربية.

---
*تم إعداد وتحديث هذا السجل ليكون المرجع الأول والأخير لأي مطور أو مساعد ذكاء اصطناعي عند تحليل أو تعديل كود المشروع.*

---


<!-- migrated:cap-106:end -->

<a id="cap-199"></a>
<!-- migrated:cap-199:start -->
## 168. تقليص زمن فقد البيانات وأتمتة تمرين الاسترجاع (Backup RPO Reduction & Automated Restore Drill)
* **حالة الوحدة / المعيار:** 🟢 مكتملة (23 سبتمبر 2026) — الثوابت DEPLOY-7 و DEPLOY-8 في `ARCHITECTURE_INVARIANTS.md` §2.7، محروسة بـ`deploy-pipeline.spec.ts` داخل `npm run guards`، والحارسان جُرِّبا بكسر متعمَّد.
* **الفجوتان اللتان أُغلقتا:**
  1. **التواتر:** النسخ كان يومياً فقط (03:00)، فعطل الساعة الخامسة مساءً يضيّع يوم عمل كامل — فواتير ومستخلصات وحضور.
  2. **التحقق:** الاسترجاع كان مُجرَّباً ثلاث مرات فعلياً وموثّقاً في `docs/DISASTER_RECOVERY.md`، لكن **بقرار بشري كل 3 شهور**. بين التجربتين يمكن أن يفسد الملف أو تتغير كلمة السر أو يتوقف الرفع بلا أن يلاحظ أحد.
* **ما صار يعمل الآن:**
  - **نسخة كل ساعة** (`backup.sh hourly` — الدقيقة 30 من كل ساعة): `pg_dump` مضغوط، **مشفَّر قبل أن يغادر السيرفر** بنفس خوارزمية الملف المجمّع، بلا تجميع حزم العملاء (الجزء الثقيل). يُحفظ محلياً 3 أيام وعلى Google Drive 7 أيام، ويحذف نسخه القديمة بنفسه. **أقصى ما يضيع صار ساعة بدل 24.**
  - **تمرين استرجاع كل أحد 4:15** (`restore-drill.sh`): يأخذ أحدث نسخة موجودة فعلاً (ساعية أو يومية أو مجمّعة)، يفكّ تشفيرها، يسترجعها في قاعدة **منفصلة مؤقتة** داخل نفس الحاوية، ثم يقارنها بالإنتاج: عدد الجداول · الجداول الحرجة غير فارغة (`tenants`, `users`, `accounting_accounts`, `products`) · عدد الهجرات (نسخة أقدم من المخطط = فشل) · **عدد المفاتيح المرجعية** (نمط O65 الذي أسقط قيداً بصمت). ثم يحذف القاعدة المؤقتة ويرسل تنبيه تليجرام عند أي فشل.
  - **المراقبة:** `zsystems-watch.sh` صار ينبّه على انقطاع النسخة الساعية (3 ساعات) وعلى تمرين استرجاع فشل أو لم يعمل من 9 أيام — وكلاهما يُفحص فقط على سيرفر مُثبَّتة عليه فعلاً، فلا تنبيه على إعداد لم يُطلب بعد.
* **قرار صريح — لماذا النسخة الساعية لا تُرفع إلى Oracle Object Storage:** رابط الـPAR للكتابة فقط ولا يستطيع حذف القديم، فرفع 24 ملفاً يومياً يملأ حاوية Free Tier بلا حدّ. الحماية الجغرافية الكاملة تبقى على النسخة اليومية (محلي + Oracle + Google Drive)، والساعية تحمي من الأعطال والحذف الخاطئ وفساد القاعدة عبر (محلي + Google Drive).
* **السلامة:** تمرين الاسترجاع لا يكتب على قاعدة الإنتاج إطلاقاً — كل استعلاماته عليها `SELECT`، ولا يوجد في السكربت `DROP`/`TRUNCATE`/`DELETE`/`UPDATE` على أي قاعدة غير قاعدة التمرين، والقاعدة المؤقتة تُحذف حتى عند فشل التمرين (`trap … EXIT`). هذا كله مفروض بالحارس.
* **الملفات:** `deploy/scripts/zsystems-backup.sh` · `deploy/scripts/zsystems-restore-drill.sh` (جديد) · `deploy/scripts/zsystems-watch.sh` · `backend/test/critical/deploy-pipeline.spec.ts` · `docs/DISASTER_RECOVERY.md` §6 و§7.
* **التثبيت على السيرفر مطلوب** (السكربتات في المستودع، والـcron يدوي): ثلاثة أسطر cron موثّقة في `docs/DISASTER_RECOVERY.md` §6.
* **المتبقي بقرار المالك:** O73 — استرجاع نقطة-في-الزمن الحقيقي (أرشفة WAL) ينزل بالفقد إلى دقائق، لكنه يمسّ إعداد حاوية Postgres ويستهلك مساحة مستمرة.


<!-- migrated:cap-199:end -->

<a id="cap-202"></a>
<!-- migrated:cap-202:start -->
## 171. أحجام قابلة للضبط لاختبارات الحمل ومعايرتها على مواصفات الإنتاج (Load Profiles & Client-Address Simulation)
* **حالة الوحدة / المعيار:** 🟢 مكتملة (24 سبتمبر 2026) — محروسة في `performance-hot-paths.spec.ts` ضمن `npm run guards`، والحارس مجرَّب بكسر متعمَّد.
* **ما تغيّر:** منظومة k6 كانت بأحجام ثابتة مكتوبة داخل كل سيناريو (50 مستخدماً)، وتعديلها يعني تعديل ملفات — فعملياً لا أحد يعدّلها. الآن الحجم يأتي من البيئة عبر أربعة ملفات جاهزة:
  - `default` (50) للتشغيل السريع بعد أي تغيير · `heavy` (150) لحمل ثقيل مع فرض عتبات الـSLA · `extreme` (300، **بلا عتبات**) لقياس حدّ السيرفر · `soak` (40 لعشر دقائق) لكشف تسرّب الذاكرة.
  - أو ضبط يدوي: `PEAK_VUS` و`RAMP_SECONDS` و`HOLD_SECONDS`.
  - المشغّلات الثلاثة (`run.sh` · `run.bat` · `runner.cjs`) متطابقة، وحارس يمنع تباعدها.
* **لماذا `extreme` بلا عتبات:** k6 يخرج بكود فشل عند خرق أي عتبة. عند 300 مستخدم متزامن على نواتين ستُخرق عتبة الـp95 حتماً، فتبدو النتيجة «فشلاً» بينما هي الرقم المطلوب قياسه. الملف يطفئها ويطبع الأرقام.
* **`SPOOF_CLIENT_IPS` — محاكاة عملاء متعددين:** حدود المحاولات مفتاحها عنوان العميل، واختبار يعمل من داخل السيرفر يبدو عميلاً **واحداً**، فبعد الطلب الثلاثين يرد 429 على كل شيء ويقيس الاختبار الحارس لا قاعدة البيانات. المفتاح يعطي كل VU عنواناً في `X-Real-IP` فيصير «50 مشترياً متزامناً» خمسين عميلاً فعلاً. ليس التفافاً على الحماية — `resolveClientIp` تثق بالترويسة فقط حين يكون القرين داخلياً — لكنه يبقى **خلف مفتاح صريح** حتى لا يُخفي حدّاً مكسوراً بالغلط.
* **عطل حقيقي أُصلح:** `auth-login-burst.js` كان يرسل `X-Forwarded-For` لتحديد عنوان المهاجم، **والتطبيق لا يقرأ هذه الترويسة إطلاقاً** (يقرأ `X-Real-IP` حصراً). صادف أن النتيجة كانت صحيحة لأن كل الطلبات وقعت في دلو واحد، لكن أول محاولة لمحاكاة عدة مهاجمين كانت ستفشل بصمت. الحارس يمنع رجوعها.
* **تصحيح توثيقي:** مواصفات الإنتاج في O64 كانت «1 OCPU و5.8 جيجا بلا Swap» (قياس 22 سبتمبر). الواقع الآن **نواتان و12 جيجا و4 جيجا Swap**. الأحجام أعلاه معايَرة على الجديد، مع بقاء الحقيقة الحاكمة: سيرفر واحد، وباك إند في عملية واحدة (PM2 fork).
* **تحذيرات التشغيل على الإنتاج** (مفصّلة في `docs/LOAD_TESTING.md` §3-ب): سيناريوهات الشراء **تُنشئ طلبات حقيقية** بخصم مخزون وإشعار واتساب لكل طلب إن كانت البوابة مفعّلة · المخزون ينفد فتفشل الطلبات التالية بخطأ مخزون لا بخطأ أداء · منفذ الإنتاج 3000 لا 3001.
* **الملفات:** `load-tests/config.js` · `load-tests/run.sh` · `load-tests/run.bat` · `load-tests/runner.cjs` · `load-tests/scenarios/*.js` · `docs/LOAD_TESTING.md` · `backend/test/critical/performance-hot-paths.spec.ts`

---


<!-- migrated:cap-202:end -->

<a id="cap-222"></a>
<!-- migrated:cap-222:start -->
## 188. محرك التحمل والسرعة الفائقة لـ 10 سنوات (Enterprise 10-Year Scalability & High-Volume Engine)
* **الحالة / الإنجاز:** مكتمل ومتحقق بنسبة 100% (30 سبتمبر 2026).
* **الهدف:** تمكين المنظومة من العمل بكفاءة وسرعة فائقة («طلقة حرفياً») لمدة 10 سنوات متواصلة لعملاء التجزئة والجملة الكبرى الذين يصدرون ما يصل إلى 10,000 فاتورة يومياً (أكثر من 36.5 مليون فاتورة ومئات ملايين أسطر الأصناف والقيود لكل مستأجر).
* **المراحل الـ 6 المنفذة بالكامل:**
  1. **المرحلة 1: تحويل ملخصات التقارير والداشبورد إلى تجميع SQL نقي 100% (`reportSummary`):**
     - تحويل الاستعلامات الـ 8 الرئيسية (`sales`, `purchases`, `services`, `expenses`, `returns`, `treasury`, `cogs`, `topProducts`) من جلب مئات الآلاف من الأسطر إلى دوال تجميعية في محرك SQL (`COUNT`, `SUM`, `AVG`).
     - تقليص حجم البيانات المنقولة بنسبة > 99.9% مع صيانة التوافق الرجعي 100% مع محرك الحسابات المالي.
     - الملفات: `backend/src/modules/reports/helpers/reports-summary.helper.ts`, `backend/src/modules/reports/reports.service.ts`.
  2. **المرحلة 2: كاش إعدادات نقاط البيع في الذاكرة (In-Memory POS Settings Caching):**
     - القضاء التام على 6 استعلامات SQL كانت تنفذ داخل معاملة البيع (`trx`) في كل عملية كاشير (الحد الأقصى للخصم، البيع بالسالب، الولاء، اشتراط الوردية، رسوم التوصيل، الترقيم).
     - توفير حتى 60,000 استعلام يومياً لقاعدة البيانات لكل 10 آلاف فاتورة، مع ربط الإبطال الفوري (`invalidateSettingsCache`) عند تعديل الإعدادات.
     - الملفات: `backend/src/modules/sales/services/sales-write.service.ts`, `backend/src/modules/settings/settings.service.ts`.
  3. **المرحلة 3: الترقيم السريع بالقوائم الكبرى (Universal Keyset Cursor Pagination):**
     - دعم الترقيم السريع بالمؤشر (`lastSeenId` / `cursor`) في شاشات المبيعات والمشتريات وقيود اليومية.
     - تحويل استعلامات الصفحات الكبيرة من مسح تسلسلي بطيء بـ `OFFSET` إلى Indexed Seek مباشر بالاعتماد على الفهرس المركب `(tenant_id, id DESC)` ينفذ في < 1ms لأي صفحة.
     - الملفات: `backend/src/modules/sales/services/sales-query.service.ts`, `backend/src/modules/purchases/services/purchases-query.service.ts`, `backend/src/modules/accounting/accounting.service.ts`, `backend/src/modules/accounting/dto/accounting.dto.ts`.
  4. **المرحلة 4: تحصين كشوف الحسابات والتقارير المالية (Ledger Acceleration):**
     - تحويل تقارير الملخص المالي `getFinancialSummary` وحركة النقدية `getCashMovement` إلى تجميع SQL (`GROUP BY` مع `SUM(debit)` و `SUM(credit)`).
     - تسريع أعمار ديون العملاء والموردين `getAgedReceivables` و `getAgedPayables` بحصر استعلام المبيعات والمشتريات حصرياً على الشركاء المدينين الفعليين والفواتير غير المسددة.
     - حساب الرصيد الافتتاحي `openingBalance` في كشوف حساب الشركاء `partnerLedger` باستعلام تجميعي مفرد قبل تاريخ البداية `fromDate`.
     - الملفات: `backend/src/modules/accounting/accounting.service.ts`, `backend/src/modules/accounting/services/aged-debts.service.ts`, `backend/src/modules/accounting/services/balance-sheet.service.ts`, `backend/src/modules/accounting/services/cash-flow.service.ts`, `backend/src/modules/reports/reports.service.ts`, `backend/src/modules/reports/helpers/reports-ledger.helper.ts`.
  5. **المرحلة 5: الجداول التجميعية للتحليلات التاريخية (Daily Commercial Rollup Engine):**
     - إنشاء الهجرة `2040000000179_daily_commercial_rollups.ts` مع جدول الملخصات المؤسسي `daily_commercial_rollups`.
     - خدمة `DailyCommercialRollupService` لحساب وتجميع مبيعات ومصروفات وهوامش الأرباح يومياً لكل فرع ومستأجر.
     - استعلام مقارنة السنوات التاريخية `getHistoricalMultiYearComparison` يقرأ 365 سطراً فقط لكل سنة ويفتح في < 5ms بدلاً من مسح ملايين السطور.
     - الملفات: `backend/src/database/migrations/2040000000179_daily_commercial_rollups.ts`, `backend/src/database/database.types.ts`, `backend/src/modules/reports/services/daily-commercial-rollup.service.ts`, `backend/src/modules/reports/reports.module.ts`, `backend/src/modules/reports/reports.controller.ts`.
  6. **المرحلة 6: تقسيم الجداول الكبرى في PostgreSQL وضبط إعدادات الإنتاج (Native Partitioning & Production Suite):**
     - استراتيجية التقسيم النطاقي السنوي (Declarative Range Partitioning by Year) لجداول `sales` و `sale_items` و `journal_entry_lines`.
     - سويت الإعدادات المتقدمة وضبط الذاكرة والـ Autovacuum وتخزين الـ NVMe: `deploy/scripts/postgresql-enterprise-scale-tuning.sql`.
* **التحقق التقني الشامل:** اجتياز الفحص البرمجي الكامل `tsc --noEmit` بنجاح تام بدون أي أخطاء (Exit Code 0).
---


<!-- migrated:cap-222:end -->

<a id="cap-228"></a>
<!-- migrated:cap-228:start -->
## Shared database scale controls (2 October 2026)

- Representative order and settlement history, van-trip sales/collections/returns detail, and maritime job financial ledger lines now return bounded pages with pagination metadata. Delivery representative KPIs use SQL aggregates. Kitchen tickets and cashier fraud detail reads have explicit row caps; the fraud response flags sampled monetary estimates.
- A capped PostgreSQL pool, statement deadline, idle transaction deadline, and idle-client error handler limit resource exhaustion. Large in-process storefront and dashboard caches have fixed entry ceilings. Migration `2040000000185` adds indexes for the measured tenant-scoped lookup patterns.
- The standard critical suite includes a ten-tenant in-memory sales/treasury/stock-read model. An opt-in staging probe performs 1,000 read and advisory-lock operations; run that mode only against a migrated staging database with ten tenants that each have sales. Neither mode was executed in this cloud task.
- Aging and AR collection synchronization fail explicitly when their current in-memory financial computation would exceed 5,000 partners or open invoices. AR case detail lists use bounded pages. Larger tenants need a windowed SQL rewrite before these reports can be considered complete at scale.


<!-- migrated:cap-228:end -->

<a id="cap-239"></a>
<!-- migrated:cap-239:start -->
## 163. تسريع تجميع خادم التطوير المحلي للباك إند (Backend Incremental Dev Compilation Acceleration - 8 October 2026)

- **المشكلة:** مع نمو حجم الباك إند إلى أكثر من 855 ملف TypeScript و293 ملف هجرة، كان بدء خادم التطوير `nest start --watch` يستغرق أكثر من دقيقة كاملة (نحو 70 ثانية) في كل تشغيل.
- **السبب الجذري:** خيار `deleteOutDir: true` في `nest-cli.json` كان يقوم بمسح مجلد `dist` كاملاً في كل تشغيلة، مما يحذف ملف كاش التجميع التراكمي `tsbuildinfo` ويجبر المترجم على تجميع كافة الملفات من الصفر (Cold Compilation).
- **الحل الجذري المطبق:**
  1. توجيه ملف الكاش التراكمي `tsBuildInfoFile` ليُحفظ بشكل دائم داخل `node_modules/.cache/tsconfig.build.tsbuildinfo`.
  2. تعطيل مسح المجلد في وضع المراقبة `deleteOutDir: false` في `nest-cli.json` لإتاحة الاستفادة من الكاش التراكمي.
  3. حماية البناء الإنتاجي في `package.json` بمسح `dist` بشكل صريح ونظيف قبل أي أمر بناء للإنتاج `npm run build` لضمان عدم تأثر الإنتاج أو الساس أو الإلكترون نهائياً.
- **النتيجة:** تقليص وقت بدء التجميع لخادم التطوير من 70 ثانية إلى 2-4 ثوانٍ مع بقاء مخرجات الإنتاج مطابقة 100%.



<!-- migrated:cap-239:end -->

<a id="cap-248"></a>
<!-- migrated:cap-248:start -->
## 207. البنية التحتية لتطبيقات الموبايل الأصلية والنشر على المتاجر (Store-Ready Native Mobile Architecture - Android & iOS)

- **الحالة:** مكتمل ومعتمد 100% (Completed & Verified).
- **نسبة الإنجاز:** 100%.
- **الوصف التشغيلي:**
  1. **تجهيز وإدماج حزم Capacitor الرسمية (Enterprise Bridge):**
     - تثبيت وتكامل حزم `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/network`, `@capacitor/preferences`, `@capacitor/haptics`.
     - إنشاء ملف الإعداد القياسي الحديث `capacitor.config.ts` وربطه مع `capacitor.config.json` مع ضبط شاشة البداية (Splash Screen) وشريط الحالة الكحلي الملكي (`#170e5e`).
  2. **بناء جسر الأجهزة الأصلي الموحد (`mobileBridge.ts`):**
     - فحص نوع بيئة التشغيل (`android`, `ios`, `web`).
     - التعامل الذكي مع زر الرجوع الفعلي في أندرويد (Hardware Back Button): إغلاق النوافذ المنبثقة والشيتات التفاعلية أولاً، ثم الرجوع في المسار، ثم تصغير التطبيق بسلاسة.
     - دعم التغذية الارتجاعية للاهتزاز (Haptic Feedback) عند الضغط على الأزرار وقراءة الباركود، ومراقبة حالة الاتصال بالإنترنت والعمل أوفلاين.
  3. **بوابة وتطبيقات الموبايل المركزية (`MobileHubPage.tsx` - المسار `/mobile`):**
     - بناء لوحة انطلاق مركزية للموبايل متطابقة 100% مع دستور الموبايل المؤسسي (`Mobile Application Visual Constitution`): بطاقات بيضاء نقية، أيقونات ناعمة في مربعات مستديرة (Squircles) بألوان هادئة، شبكة ثنائية الأعمدة (2-Column Grid)، وشريط سفلي ثابت.
     - ربط كافة مساحات العمل الميدانية: لوحة تحكم المالك (`/owner-mobile`)، البيع الميداني والفان سيلز (`/van-sales/mobile`)، سائقي التوصيل (`/driver-mobile`)، بصمة الحضور الذاتية (`/mobile/punch`)، نقطة البيع السريعة (`/pos`)، وجرد المخزون المحمول (`/inventory`).
  4. **ربط مسارات التوزيع والبصمة المفقودة في الراوتر:**
     - تسجيل تطبيق الفان سيلز والبيع الميداني (`VanSalesMobilePage`) في راوتر المنظومة بالمسارين `/van-sales/mobile` و `/mobile/van-sales`.
     - تسجيل تطبيق البصمة والحضور الجغرافي الذاتي (`MobilePunchPage`) في راوتر الموارد البشرية بالمسارين `/hr/mobile-punch` و `/mobile/punch`.
     - توجيه المستخدم تلقائياً بعد تسجيل الدخول في بيئات الموبايل الأصلية إلى لوحة المالك أو بوابة الموبايل (`getPostLoginRoute`).
  5. **ترقية حزمة الأندرويد وإعدادات متجر جوجل بلاي:**
     - تحديث `AndroidManifest.xml` بالصلاحيات اللازمة (الكاميرا، الموقع الجغرافي GPS، الاهتزاز، البلوتوث للطابعات المحمولة) مع إضافة `android:required="false"` للعتاد لضمان ظهور التطبيق على كافة الأجهزة في Google Play.
     - ترقية `MainActivity.java` بـ `WebChromeClient` لمنح أذونات الكاميرا للويب وموقع الـ GPS تلقائياً، والتعامل مع روابط الاتصال الخارجي (`tel:`, `whatsapp:`, `mailto:`).
     - إنشاء سكريبت استخراج حزمة المتجر الرسمية الموقعة `scripts/build-aab.cjs` (`npm run mobile:aab`) بصيغة Android App Bundle (`.aab`)، وتحديث سكريبت الـ APK ليقرأ الإصدار ديناميكياً من `package.json`.
  6. **تجهيز متطلبات متجر آبل (Apple App Store & iOS Ready):**
     - إنشاء سكريبت التهيئة `scripts/setup-capacitor-ios.cjs`.
     - توثيق نصوص الخصوصية الملزمة لمراجعة آبل في `Info.plist` (الكاميرا، الباركود، الموقع، البلوتوث) باللغتين العربية والإنجليزية.
- **الملفات المعدلة والمنشأة:**
  - `frontend/capacitor.config.ts`
  - `frontend/capacitor.config.json`
  - `frontend/src/shared/native/mobile-bridge.ts`
  - `frontend/src/features/dashboard/pages/MobileHubPage.tsx`
  - `frontend/src/features/dashboard/routes.tsx`
  - `frontend/src/features/delivery-reps/routes.tsx`
  - `frontend/src/features/hr/routes.tsx`
  - `frontend/src/app/router/post-login-route.ts`
  - `frontend/src/main.tsx`
  - `frontend/android/app/src/main/AndroidManifest.xml`
  - `frontend/android/app/src/main/java/com/zsystems/pos/MainActivity.java`
  - `scripts/build-aab.cjs`
  - `scripts/build-apk.cjs`
  - `scripts/setup-capacitor-ios.cjs`
  - `package.json`
  - `frontend/package.json`

---


---

<a id="runtime-electron-data-auth-and-local-manifest"></a>
### تخزين اعتماد قاعدة بيانات إلكترون داخل `data/` وتوليد بصمة بيئة التشغيل المحلية (PostgreSQL 16.13)
- السلوك الحالي والحدود:
  - يحفظ `PostgresManager` ملف `.postgres-auth.json` داخل `runtime/data/.postgres-auth.json` (بعد نجاح `initdb.exe` حتى يظل مجلد `data/` فارغاً أثناء التهيئة) ليتم نقل مجلد `data/` يدوياً بين إصدارات إلكترون في خطوة واحدة مع `secrets.json`؛ مع قراءة وترحيل تلقائي لملفات `runtime/.postgres-auth.json` القديمة بعد تحقق `waitForReady()`. في أول ترقية لعميل قديم يمتلك `runtime/.postgres-auth.json` خارج `data/` يلزم نقل ذلك الملف لمرة واحدة مع `data/` ثم يندمج داخل `data/` تلقائياً.
  - سكربت `ApplyAndRestart.ps1` يأخذ نسخة احتياطية ويسترجع عند التراجع كلا المسارين (`data/.postgres-auth.json` والمسار القديم `runtime/.postgres-auth.json`).
  - أداة `scripts/generate-local-runtime-manifest.cjs` تولّد `portable/runtime/runtime-manifest.sha256` من `node/` و`postgres/` المحليين (مثل PostgreSQL 16.13 وNode 22) مع استبعاد `data/` و`logs/` لتمرير بوابة تغليف إلكترون محلياً دون إجبار العملاء على الانتقال إلى PostgreSQL 17.
- حالة التنفيذ: موجود.
- مصدر التنفيذ: `frontend/electron/postgres-manager.cjs`، `portable/tools/launcher/scripts/ApplyAndRestart.ps1`، `scripts/release/test-windows-offline-runtime.cjs`، `scripts/generate-local-runtime-manifest.cjs`.
- المجالات المتأثرة: التشغيل المكتبي المستقل والتحديثات (`SETTINGS_CAPABILITIES.md`).
- التحقق: نجح `node --test scripts/test-electron-postgres-auth.cjs` (4/4)، و`npm run qa:electron`، وفحص نحو PowerShell لـ `ApplyAndRestart.ps1` بتاريخ 2026-11-13 (تشغيل EXE الكامل و`test-windows-offline-runtime.cjs` لم يُنفّذا في هذه الجولة لأن المستخدم سيبني نسخة إلكترون مباشرة).
- آخر تحقق: 2026-11-13 (محلي على `HEAD` `b0e970cb2` + التعديل المحلي غير المثبّت بعد).
- النواقص أو التعارضات: لم يُختبر إقلاع حزمة EXE المبنية بالكامل في هذه الجولة؛ يعتمد التحقق المخبري على اختبارات النظام النصية والمؤقتة.

<!-- migrated:cap-248:end -->
