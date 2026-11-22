# قدرات الموارد البشرية والرواتب

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **الموارد البشرية والرواتب** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/hr/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md) · [التوزيع الميداني والفان](VANS_CAPABILITIES.md)

## التحديثات الحالية

### قدرة: عزل صلاحيات الموارد البشرية ومنع تسرب لوحة متابعة المالك (HR RBAC Hardening & Owner-Companion Route Guard) — 16 نوفمبر 2026
- **تأمين مسارات المالك والجوال (`frontend/src/app/router/access.ts`, `root-router.tsx`, `OwnerCompanionPage.tsx`, `OwnerMobileDashboardPage.tsx`, `MobileHubPage.tsx`):**
  - إضافة مسارات `owner-companion` و`owner-mobile` و`mobile/owner` إلى `routePermissionMap` بصلاحية `'reports'` لمنع وصول الكاشير إليها أو ظهورها في البحث الشامل أو لوحة تطبيقات الموبايل، وحمايتها أيضاً داخل مكونات الصفحات.
  - إضافة `findWorkspaceFallbackRoute` في `ProtectedLayout` (`root-router.tsx`) بحيث يرتد المسار المرفوض دائماً إلى أول مساحة عمل تشغيلية مناسبة لدور المستخدم (`/pos` أو `/hr/attendance` للكاشير، أو شاشة انعدام الصلاحيات `NoWorkspaceAccess` عند عدم وجود صلاحيات) دون التوجيه أبداً إلى `/owner-companion` أو `/owner-mobile` أو `/mobile`.
- **تقييد مسارات وتابات الموارد البشرية حسب الصلاحية الفعلية:**
  - `HrSectionNav.tsx` (عبر إعادة التصدير في `shared/hooks/use-permission.ts` التزاماً بحدود الطبقات): تصفية التابات عبر `canAccessPath` وإخفاء نظرة عامة `/hr` عند الاقتصار على التحضير (`isAttendanceOnlyHrUser`)؛ وتوجيه رابط «الموارد البشرية» في `app-shell.tsx` والصفحة `/hr` (`HrComingSoonPage.tsx`) مباشرة إلى `/hr/attendance` لمن يملك `hrAttendance` فقط.
  - تصفية بطاقات الملخص وأزرار الإجراءات السريعة في `HrComingSoonPage.tsx`، وأزرار الهيدر في `HrAttendancePage.tsx` و`HrReportsPage.tsx` و`HrSettingsPage.tsx` و`HrLoansPage.tsx` و`HrPayrollPage.tsx`، وتقييد استعلامات `useHr.ts` واختصار الحضور السريع (`QuickAttendanceShortcut`) حسب الصلاحية.
  - تشديد مسارات `hr/settlements` (`hrSalaryView`/`hrSalaryManage`/`hrPayrollApprove`)، `hr/recruitment` (`hrEmployees`)، `hr/reports` (`hrEmployees`/`hrLoans`/`hrPayroll*`/`hrSalary*`)، و`hr/settings` (`hrEmployees`/`hrPayrollManage`/`hrSalaryManage`/`settings`/`canManageSettings`) بدلاً من الصلاحية العامة `'hr'`.
- **تشديد نقاط الباك إند (`backend/src/modules/hr/`):**
  - حماية `RecruitmentAtsController` (`recruitment-ats.controller.ts` + `recruitment-ats.service.ts`) بـ `PermissionsGuard` و`@RequireFeature('hr')` وصلاحية `hrEmployees` (و`hrSalaryManage` عند التعيين)، وإلغاء تجاوز `admin` و`'hr'` العامة.
  - تشديد `GET /api/hr/reports/summary` (`hr.controller.ts` + `hr-reports.service.ts`) وتصفية الأقسام المالية (الرواتب والسلف) في الاستجابة حسب الصلاحيات، وتشديد تعديلات الأقسام والمسميات والوظائف والعطلات الرسمية من `'hr'` العامة إلى صلاحيات الإدارة المعنية.
  - حجب الحقول الشخصية والمالية الحساسة (`nationalId`, `hourlyRate`, `insuranceSalary`, `commission*`, `bank*`) في `HrEmployeesService.listEmployees` لمن يملك `hrAttendance` فقط دون `hrEmployees` / `canViewSalary`.
- **التحقق:** اختبارات الوحدة المستهدفة `frontend/src/app/router/access.spec.ts` و`frontend/src/features/hr/components/HrSectionNav.spec.tsx`.

### قدرة: منظومة صرف المسحوبات النقدية من الراتب وسلف الكاشير السريعة (Quick Cash Advance & Earned Salary Withdrawal Engine) — 25 أكتوبر 2026
- **المحرك الحسابي للاستحقاق اللحظي (`employee-withdrawal-balance.engine.ts`):**
  - احتساب الاستحقاق الفعلي اللحظي للموظف بدقة ملليمترية بحسب دورة القبض (بالساعة عبر البصمات `summarizeHourlyAttendance`، باليوم عبر عدد الأيام المسجلة، أو بالشهر عبر الكشف النشط أو النسبة العقدية `prorateMonthlyWage`).
  - رصد واستقطاع السلف القائمة والمسحوبات غير المسددة من جدول `hr_employee_loans`.
  - حساب صافي الرصيد المتاح (`netAvailableBalance`) وتحديد أهلية الصرف المباشر (`canDisburseDirectly`).
- **قواعد الصرف والرقابة المالية والدرج النقدية (`hr.service.ts` -> `createQuickCashAdvance`):**
  - دعم التبويب المزدوج: `actionType === 'advance'` (سلفة على الحساب مسموحة في أي يوم خلال الدورة) مقابل `actionType === 'wage_payout'` (صرف الراتب وتصفية مستحقات الفترة).
  - **حوكمة مواعيد القبض الرسمية (Due Date Governance):**
    - اليومي: مستحق للصرف يومياً.
    - الأسبوعي: مستحق يوم الخميس/الجمعة، وفي باقي أيام الأسبوع يتطلب الصرف موافقة المدير.
    - النصف شهري: مستحق يوم 15/16 ونهاية الشهر.
    - الشهري: مستحق في نهاية دورة الشهر (يوم 28 فما فوق).
    - الصرف المبكر قبل موعد الاستحقاق (`isEarlyWagePayout`): محظور على الكاشير ويتطلب إدخال كلمة مرور المدير أو رمز PIN لاعتماده كـ "تسوية وصرف مبكر / إخلاء طرف"، بينما للمدير متاح مباشرة مع توثيق السجل.
  - إذا كان المبلغ المطلوب ضمن رصيد الموظف ومستحق الموعد: يُسمح للكاشير بالصرف المباشر وتوثيق المسحوب على درج الوردية المفتوحة وقيد سند الخزينة (`reference_type: 'cashier_shift'`) وقيد اليومية المحاسبي (Dr 1160 / Cr 1110)، مع إعادة بناء مسير الرواتب النشط لمنع ازدواجية الصرف.
  - إذا تجاوز المبلغ الرصيد المتاح: تُطلب كلمة مرور المدير أو رمز PIN للاعتماد الإداري كـ "سلفة على المكشوف".
- **الواجهة والتجربة المؤسسية (`QuickCashAdvanceModal.tsx`):**
  - تفعيل الاختصار العالمي `Ctrl + Alt + X` للوصول الفوري في أي شاشة (نقاط البيع POS، المبيعات، أو لوحات التحكم).
  - توفير تبويبين متكاملين: **[سلفة / مسحوب على الحساب]** و **[صرف الراتب وتصفية المستحقات]** مع ملء تلقائي لصافي المستحق والملاحظات.
  - تثبيت الكروت الثلاثة الاستراتيجية بصورة دائمة (الأجر المستحق، المسحوبات والسلف، المتاح للصرف) مع نصوص فرعية ديناميكية تتكيف مع ساعات العمل، أو أيام الاستحقاق اليومية، أو شهر العقد، وعرض ميعاد القبض القادم والأيام المتبقية.
  - ثبات الأبعاد ومنع القفز (Anti-Ballooning): اعتماد `minHeight="590px"` ومسار توجيه بارتفاع محجوز موحد يمنع أي تغير في أبعاد النافذة عند التبديل بين التبويبين.
  - اختبارات الوحدة: `employee-withdrawal-balance.engine.spec.ts` (5 اختبارات معتمدة 100% بنجاح تشمل محرك المواعيد).

### قدرة: التكييف الذكي الديناميكي لمسميات الأجر والراتب الأساسي (Smart Dynamic Wage vs Salary Labeling) — 26 أكتوبر 2026
- **التكييف السياقي بحسب نظام التعاقد ودورة الصرف (`HrPayrollPage.tsx`, `HrPayrollTopSections.tsx`, `PayrollReviewItemModal.tsx`):**
  - **كشوف اليومية والساعة والأسبوعي:** التحول التلقائي النظيف من مصطلح "الراتب الأساسي" إلى **"الأجر الأساسي"** في ترويسة الجدول، و**"الأجور الأساسية"** في بطاقات المؤشرات العلوية KPI، مع الحفاظ على التصميم المؤسسي النظيف وتفقيط الساعات أسفل المبلغ `(40 س × 20.00 ج.م/س)` دون أي شارات أو عناصر بصرية دخيلة.
  - **قسائم واستمارات الصرف المطبوعة (A4 / Thermal Slip):** توليد مستند "قسيمة استلام أجر (Wage Payslip)" وإيصال الأجر الحراري وتوقيع "العامل / الموظف بالاستلام" تلقائياً عند طباعة موظف بالساعة/اليومية، والحفاظ على قسيمة الراتب للموظف الشهري.

## فهرس الأقسام المنقولة

- [قدرة: منظومة كشوف المرتبات والأجور ودورات الصرف المتعددة والتعريب الإقليمي لمصر والخليج (HR Multi-Frequency Payroll & Regional Egyptian Terminology Hub) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)](#cap-002)
- [9. الموارد البشرية والرواتب (HR & Payroll)](#cap-035)
- [38. بصمة الحضور والانصراف بالـ GPS وصورة الوجه من هاتف الموظف (Mobile GPS Geofenced & Face Attendance)](#cap-063)
- [42. بوابة الخدمة الذاتية للموظف (Employee Self-Service - ESS Portal)](#cap-067)
- [75. محرك تصفية المستحقات ومكافأة نهاية الخدمة والعهد (HR End of Service Settlement & Gratuity Engine)](#cap-100)
- [183. منظومة تتبع المتقدمين للوظائف ومجمعات المواهب (Recruitment ATS & Talent Pools)](#cap-217)
- [HR, Payroll, Loans and End-of-Service Hardening (5 October 2026)](#cap-234)
- [Automated Statutory Policy Jurisdiction & Non-Blocking Payroll Approvals (26 October 2026)](#cap-236)
- [Individual Employee Disbursement & POS Cash Drawer Integration (26 October 2026)](#cap-237)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-002"></a>
<!-- migrated:cap-002:start -->
### قدرة: منظومة كشوف المرتبات والأجور ودورات الصرف المتعددة والتعريب الإقليمي لمصر والخليج (HR Multi-Frequency Payroll & Regional Egyptian Terminology Hub) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)
- **التمييز الإقليمي الذكي للمصطلحات بين مصر والخليج (Egyptian vs Gulf Localization Engine):**
  - الاستبدال التلقائي الذكي لمصطلح "مسير" ومسيرات الرواتب بمصطلح "كشف المرتبات" و"كشوف المرتبات والأجور" و"تجهيز كشف المرتبات" في كافة شاشات ومودالات وتقارير ومطبوعات الموارد البشرية عند ضبط إعدادات المنشأة على جمهورية مصر العربية (`code: 'EG'` أو العملة `EGP`)، مع الحفاظ على مصطلح "مسير الرواتب" في دول الخليج العربي (السعودية، الكويت، الإمارات، إلخ).
  - تطهير شاشات بوابة الموظف (`EmployeePortalPage`)، الملف الشخصي للموظف (`EmployeeProfilePage`)، تقارير الرواتب (`HrReportsPage`)، والطباعة الرسمية من الكلمات المستوردة واستبدالها بمصطلحات محاسبية مصرية معتمدة ورصينة.
- **دعم دورات الصرف المتعددة في شاشة المرتبات (Multi-Frequency Payroll Runs in HR Workstation):**
  - تمكين إنشاء كشوف/مسيرات الرواتب لكافة دورات القبض المحددة في شاشة الموظف:
    - **شهري (`monthly`)**: لموظفي الرواتب الثابتة الشهرية.
    - **نصف شهري (`biweekly`)**: لنظام القبض مرتين بالشهر (كل 15 يوماً).
    - **أسبوعي (`weekly`)**: لعمال اليوميات والتشغيل الأسبوعي.
    - **يومي (`daily`)**: لعمال اليوميات والتشغيل المياومة.
    - **الكل (`all`)**: صرف لكافة العاملين بالمنشأة دفعة واحدة مع التوزيع التناسبي.
  - دعم إظهار عدد الموظفين المستحقين والنشطين لكل دورة صرف مباشرة داخل القائمة المنسدلة (`CustomSelect`).
- **المعالج الذكي للشرائح الزمنية ومنع تداخل التواريخ (Smart Overlap-Safe Date Slices):**
  - أزرار شرائح تاريخ سريعة بنقرة واحدة تتكيف تلقائياً مع دورة الصرف المختارة لمنع تعارض الفترات المحاسبية (`HR_PAYROLL_PERIOD_OVERLAP`):
    - **النصف شهري**: النصف الأول (1 - 15) والنصف الثاني (16 - نهاية الشهر).
    - **الأسبوعي**: الأسبوع 1 (1 - 7)، الأسبوع 2 (8 - 14)، الأسبوع 3 (15 - 21)، الأسبوع 4 (22 - نهاية الشهر).
    - **الشهري والكل**: الشهر بالكامل (1 - نهاية الشهر).
- **الفلترة والعرض والتقارير المتقدمة (`HrPayrollPage.tsx` & `PayrollRunsTable.tsx`):**
  - إضافة فلتر دورة الصرف (شهري، أسبوعي، نصف شهري، يومي) بجانب فلتر الشهر والقسم والحالة.
  - دعم طباعة كشف المرتبات المالي والتفصيلي بصيغة إقليمية متوافقة مع مسميات الشركات المصرية.
- **تحديثات الباك إند والـ DTO (`hr.dto.ts`):**
  - تحديث `CreatePayrollRunDto` للسماح بقيمة `'all'` وتكاملها المباشر مع محرك الاحتساب التناسبي للأجور في `hr.service.ts`.


<!-- migrated:cap-002:end -->

<a id="cap-035"></a>
<!-- migrated:cap-035:start -->
## 9. الموارد البشرية والرواتب (HR & Payroll)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/modules/hr`, `frontend/src/features/hr`
* **الجداول في قاعدة البيانات:** `employees`, `attendance`, `payroll_runs`, `employee_advances`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **دليل الموظفين والملفات الشخصية** | 🟢 | 100% | `hr.service.ts`, `EmployeesPage.tsx` | بيانات الموظفين، الرواتب الأساسية، البدلات، المسميات الوظيفية، وتاريخ التعيين. |
| **حركات الحضور والانصراف والغياب والحصانة الزمنية الدولية (Attendance, Anti-Tampering & Multi-Tenant Timezone)** | 🟢 | 100% | `hr.service.ts`, `mobile-attendance.service.ts`, `tenant-timezone.util.ts`, `quick-attendance-shortcut.tsx`, `DailyAttendanceTable.tsx`, `attendance-punch.engine.ts`, `test/critical/tenant-timezone-attendance.spec.ts` | تسجيل ومتابعة الحضور والانصراف والورديات المتعددة واستثناءات التأخير والأوفر تايم؛ **حصانة تامة ضد التلاعب بساعة الأجهزة**: فرض توقيت السيرفر الرسمي (`useServerTime: true` و `punchAction: check_in / check_out`) وتجريد العميل من حق فرض توقيت جهازه في التسجيل السريع وبصمة الموبايل. **تحصين سبتمبر 2026 (المرحلة 15):** الحصانة كانت تشمل **لحظة** البصمة فقط بينما `work_date` — اليوم الذي تُقيَّد عليه البصمة وما يقرؤه مسيّر الرواتب — ظل يأتي من العميل ويأخذ الأولوية، فكان عميل معدَّل يسجّل بصمة بتوقيت سيرفر صحيح على أي يوم يختاره. صار الحسم كله في محرك نقي واحد `attendance-punch.engine.ts` يُسقط أي `workDate` مرسل من العميل متى كانت البصمة مثبّتة بوقت السيرفر، ويمنع تحويل طلب الانصراف إلى حضور جديد، ويجري مسار البصمة كله داخل معاملة واحدة بقفل على صف اليوم لمنع ازدواج البصمة أو محو وردية مكتملة عند النقر المزدوج؛ **محرك المناطق الزمنية الذكي للمستأجرين (Dynamic Tenant Timezone Engine)**: قراءة `timezone` من إعدادات كل منشأة (`settings.timezone` مع كاش سريع 5 دقائق) لتحديد تاريخ العمل `work_date` والوقت المعروض بدقة بلد المشترك (الكويت `Asia/Kuwait`، السعودية `Asia/Riyadh`، الإمارات `Asia/Dubai`، مصر `Africa/Cairo`) مع الحماية من انزلاق تاريخ اليوم عبر حدود منتصف الليل. |
| **مسير الرواتب والسلف والخصومات** | 🟢 | 100% | `payroll_runs`, `hr.service.ts`, `PayrollPage.tsx`, `hr-treasury` | احتساب المرتبات شهرياً، استقطاع السلف والغياب، وصرف الرواتب وترحيلها للخزينة والمصروفات.<br/>**⚠️ تصحيح مالي حرج سبتمبر 2026 (المرحلة 6):** كان قسط القرض يُسجَّل **بكامل قيمته المجدولة** في `loan_deduction_amount` ثم يُقصَّ صافي الأجر إلى صفر عند عدم الكفاية (`Math.max(0, rawNetPay)`) — بينما `settlePayrollLoanDeductions` يُرصِّد أقساط القرض بذلك المبلغ الكامل. النتيجة: **الشركة تُسقط من رصيد القرض مبلغاً لم تستقطعه فعلياً من الموظف** (مثال: إجمالي 5,000 وخصومات 4,500 وقسط 1,000 → الموظف يقبض صفراً، والمتاح للقسط 500 فقط، ومع ذلك كان القرض يُرصَّد 1,000 فتضيع 500 على الشركة في كل حالة). **الحالة الآن:** أولوية خصومات صريحة — القسط يأخذ المتاح فقط `min(المجدول، الإجمالي − الخصومات)`، ويُحفظ المستقطع **الفعلي** لا المجدول، والفرق يُؤجَّل بملاحظة موثقة على بند المسير. طُبِّق على مساري الاحتساب (البناء الكامل وإعادة الاحتساب اليدوي).<br/>**⚠️ تصحيح مالي حرج ثانٍ سبتمبر 2026 (المرحلة 17):** توزيع الخصم على أقساط القرض كان يعيد قراءة المبلغ المسدَّد من قاعدة البيانات في كل دورة بينما يستخدم **رصيد القرض من لقطة الاستعلام الأولى**. فإذا غطّى خصم شهر واحد قسطين من نفس القرض (موظف فاته شهر)، ينتهي المسدَّد والمتبقي غير متصالحَين مع أصل القرض، ويظهر القرض **مديناً بعد سداده بالكامل فيُخصم من راتب الشهر التالي مرة أخرى**، كما يفقد سقف الخصم معناه فيسمح باستقطاع أكثر مما على القرض فعلاً. **الحالة الآن:** التوزيع في محرك نقي `payroll-loan-allocation.engine.ts` يقرأ رصيد القرض حديثاً في كل دورة، وحارس تطابق الأرصدة الذي كان موجوداً أصلاً — وكانت اللقطة القديمة تمتص الفارق فتجعله غير قابل للوصول — صار يعمل فعلاً ويرفض البيانات غير المتصالحة بصوت عالٍ بدل تخزين أرصدة فاسدة. |
| **بوابة الخدمة الذاتية للموظف (Employee Self-Service Portal)** | 🟢 | 100% | `EmployeePortalPage.tsx`, `employee-portal.service.ts`, `employee-portal.controller.ts` | بوابة مخصصة للموظف تتيح له تسجيل الدخول بكوده الوظيفي وكلمة المرور المشفرة للاطلاع على ملفه، رصيد الإجازات، سجل الحضور، مفردات المرتب، وتقديم طلبات السلف والإجازات مع عزل كامل لصلاحيات الإدارة. |
| **إدارة العهد العينية والنقدية للموظفين (Employee Custody & Assets)** | 🟢 | 100% | `HrAssetsPage.tsx`, `hr.service.ts`, `hr_employee_assets`, `employee-portal.service.ts` | نظام كامل لإدارة العهد العينية (سيارات، لابتوبات، هواتف، أجهزة) والنقدية، وتتبع تسليمها واسترجاعها، مع إثبات تلقائي للخصومات المالية على راتب الموظف عند التلف أو الفقدان، وربطها الصارم بإخلاء الطرف وتصفية مستحقات نهاية الخدمة (`endOfService`) وبوابة الموظف الذاتية (`EmployeePortalPage`). **تحديث (بند O2):** سجلات العهد كانت تُكتب بلا نطاق منشأة فكان حارس إخلاء الطرف لا يراها ولا يحجب أبداً؛ صارت تُكتب بالنطاق، وتعديل حالة العهدة صار مقيّداً بمنشأتها (هجرة 127 للترميم). |
| **مخالصات ومستحقات نهاية الخدمة والربط المحاسبي وحارس العهد (HR End of Service Settlement & Accounting Integration)** | 🟢 | 100% | `end-of-service.service.ts`, `accounting-posting.service.ts`, `EndOfServicePage.tsx`, `2040000000117_hr_end_of_service_uniqueness_and_indexes.ts` | احتساب مكافأة نهاية الخدمة آلياً وفق قانون العمل السعودي (المادتان 84 و85 بدقة الكسور الصريحة لمنع فاقد التقريب) وقانون العمل المصري (المادة 125)، مع احتساب بدل رصيد الإجازات وراتب الشهر المعلق وبدل الإنذار؛ توليد قيد اليومية الآلي المتوازن 100% في الأستاذ العام عبر `postEndOfServiceSettlement` مع تطبيق سقف امتصاص الاستقطاعات (Absorption Invariant)؛ التوجيه السليم لحسابات المصروفات (6200) وسلف الموظفين (1160) وإيرادات استرداد العهد والجزاءات (7100)؛ تحديث فوري وإقفال لأرصدة السلف والأقساط المستحقة في `hr_employee_loans` ودفتر الأستاذ المساعد `hr_employee_ledger`؛ حارس رقابي إلزامي لحجب صرف المخالصة في حال وجود عهد نشطة إلا بوجود إخلاء طرف معتمد أو استقطاع قيمتها (**كان معطلاً فعلياً حتى بند O2 لأن سجلات العهد كانت بلا نطاق منشأة — صار نافذاً الآن، وشاشة المعاينة تقرأ بنفس النطاق الذي يقرأ به الحارس**)؛ ترقيم تسلسلي قياسي حصين عبر المعرف الفريد بدون `COUNT(*)`؛ مؤشر تفرد جزئي يمنع ازدواج القيود برقم هجرة 117. |
| **ملف حماية الأجور والرواتب البنكي (WPS / SIF Payroll Export)** | 🟢 | 100% | `hr.service.ts`, `hr.controller.ts`, `PayrollWpsExportModal.tsx`, `HrPayrollPage.tsx`, `2040000000055_hr_employee_bank_details.ts` | معيار BambooHR و Deel للشركات: تسجيل الحسابات البنكية للموظفين والآيبان IBAN وكود السويفت SWIFT، وتصدير ملف حماية الأجور المعتمد للبنوك الخليجية والسعودية والمصرية (تنسيق SIF: سجل المؤسسة SCR + سجلات الموظفين EDR) وملف CSV المعتمد بنقرة واحدة من صفحة الرواتب. |


---


<!-- migrated:cap-035:end -->

<a id="cap-063"></a>
<!-- migrated:cap-063:start -->
## 38. بصمة الحضور والانصراف بالـ GPS وصورة الوجه من هاتف الموظف (Mobile GPS Geofenced & Face Attendance)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **الباك إند والخدمات:** `backend/src/modules/hr/mobile-attendance.service.ts`, `backend/src/modules/hr/mobile-attendance.controller.ts`, `backend/src/modules/hr/hr.module.ts`, `backend/src/database/migrations/2040000000046_qr_table_ordering_and_gps_attendance.ts`
  * **الفرونت إند والواجهات:** `frontend/src/features/hr/api/mobile-punch.api.ts`, `frontend/src/features/hr/pages/MobilePunchPage.tsx`, `frontend/src/app/router/root-router.tsx`
* **الجداول في قاعدة البيانات:** `branches` (أعمدة `latitude`, `longitude`, `geofence_radius_meters`), `hr_employees` (أعمدة `pin_code`, `mobile_punch_enabled`), `hr_attendance_records` (أعمدة `gps_latitude`, `gps_longitude`, `selfie_image_url`, `distance_meters`, `is_geofence_verified`, `source='mobile_gps'`)

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **بوابة الموبايل المخصصة للبصمة السريعة (Mobile Punch Portal)** | 🟢 | 100% | `MobilePunchPage.tsx`, `root-router.tsx` | شاشة ويب متجاوبة مخصصة للموبايل عبر الرابطين السريعين `/punch` و `/attendance/punch` تتيح للموظف تسجيل الحضور والانصراف بهاتفه دون الحاجة لأجهزة بصمة مادية باهظة الثمن. |
| **تسجيل الدخول الآمن برقم الهاتف والـ PIN السري** | 🟢 | 100% | `mobile-attendance.service.ts`, `MobilePunchPage.tsx` | تسجيل دخول فوري بالرقم القومي أو رقم هاتف الموظف وكود PIN سري مكون من 4 إلى 6 أرقام مع إصدار توكن مشفر ومؤمّن بـ HMAC SHA-256. |
| **رادار السياج الجغرافي وحساب المسافة بدقة المتر (Haversine Geofence Engine)** | 🟢 | 100% | `mobile-attendance.service.ts`, `MobilePunchPage.tsx` | التقاط إحداثيات GPS الدقيقة لهاتف الموظف وحساب المسافة الفاصلة بينه وبين فرع عمله بمعادلة هافرسين الجيوديسية، ومنع البصمة تماماً إذا كان الموظف خارج النطاق المحدد (افتراضياً 100 متر). |
| **التقاط صورة السيلفي الحية لمنع التلاعب والتبصيم الودي (Live Face Selfie)** | 🟢 | 100% | `MobilePunchPage.tsx`, `mobile-attendance.service.ts` | تفعيل كاميرا الهاتف الأمامية مباشرة في واجهة البصمة لالتقاط صورة حية للموظف لحظة التبصيم وتخزينها مشفرة مع سجل الحضور لإثبات الهوية. |
| **التبديل التلقائي الذكي بين الحضور والانصراف (Auto State Switcher)** | 🟢 | 100% | `mobile-attendance.service.ts`, `MobilePunchPage.tsx` | تحديد نوع البصمة آلياً (حضور عند أول بصمة في اليوم، وانصراف عند البصمة التالية)، مع إمكانية الاختيار اليدوي وعرض سجل بصمات اليوم للموظف مباشرة. |
| **لوحة تحكم إعدادات السياج الجغرافي للفروع وأكواد الموظفين** | 🟢 | 100% | `mobile-attendance.controller.ts`, `mobile-punch.api.ts` | نقاط تحكم لمدير النظام لتحديد خطوط الطول والعرض للفرع ونصف قطر السماح بالأمتار، وتوليد أو تغيير الـ PIN السري لكل موظف وتفعيل ميزة البصمة له. |

---


<!-- migrated:cap-063:end -->

<a id="cap-067"></a>
<!-- migrated:cap-067:start -->
## 42. بوابة الخدمة الذاتية للموظف (Employee Self-Service - ESS Portal)
* **حالة الوحدة:** 🟢 مكتمل 100% (Backend + Frontend) ومطابق بالكامل لدستور النظام البصري.
* **روابط الوصول السريع:** `/portal` و `/employee-portal` و `/ess`.
* **مسارات الكود الأساسية:**
  * **الباك إند (Backend):** `backend/src/modules/hr/employee-portal.service.ts`, `backend/src/modules/hr/employee-portal.controller.ts`, `backend/src/modules/hr/hr.module.ts`
  * **الفرونت إند (Frontend):** `frontend/src/features/hr/api/employee-portal.api.ts`, `frontend/src/features/hr/pages/EmployeePortalPage.tsx`, `frontend/src/app/router/root-router.tsx`
* **الميزات والقدرات المفعلة:**
  1. **تسجيل دخول آمن وخفيف للموظف (PIN & Phone/Code Login):** تسجيل دخول مباشر برقم هاتف الموظف أو كوده الوظيفي مع رمز الـ PIN السري (4-6 أرقام) دون الحاجة لحساب مستخدم إداري على الـ ERP، مع توكن جلسة مشفر بـ HMAC ومحمي ضد التزوير.
  2. **لوحة معلومات الموظف (Overview & Profile):** بطاقة شخصية موحدة تتضمن المسمى الوظيفي، القسم، تاريخ التعيين، الفرع، كود الموظف، وحالة العمل.
  3. **شريط حالة اليوم والربط مع البصمة الجغرافية (Live Today Status):** إشعار فوري بحالة بصمة اليوم (لم يحضر بعد / حاضر منذ الساعة X / انتهى يوم العمل) مع زر اختصار مباشر ينقل الموظف لشاشة البصمة الجغرافية الذاتية `/punch` لتسجيل الحضور بالسيلفي ونظام الـ GPS.
  4. **كشوفات ومسيرات الرواتب (Monthly Payslips):** استعراض تاريخي لكشوف الرواتب الشهرية المصروفة، الراتب الأساسي، البدلات، المكافآت، الاستقطاعات، التأمينات، وصافي الراتب، مع نافذة مفردات مرتب تفصيلية مطابقة للمواصفات وقابلة للطباعة.
  5. **أرصدة وطلبات الإجازات (Leaves & Requests):** شاشات إحصائية فورية لأرصدة الإجازات السنوية المستحقة والمستهلكة والمتبقية، واستعراض سجل الطلبات، مع نافذة تقديم طلب إجازة ذاتي يرسل فوراً لمدير الموارد البشرية للموافقة أو الرفض.
  6. **سجل الحضور والانصراف التفصيلي (Attendance History):** جدول شهري دقيق يعرض لكل يوم: وقت الحضور، وقت الانصراف، ساعات العمل الفعلية، ساعات التأخير، وحالة اليوم (حضور طبيعي، تأخير، إجازة، عطلة).
  7. **السلف النقدية والعهد العينية (Financial Advances & Assets):** استعراض كشف السلف القائمة والمبالغ المتبقية، وسجل العهد العينية المسلمة للموظف وتواريخ تسليمها، مع إمكانية تقديم طلب سلفة نقدية ذاتياً مع تحديد الغرض وتاريخ السداد المقترح.
  8. **التوافق البصري والتجاوب الكامل مع الموبايل وصفر إيموجي (Mobile-First Responsive ESS & 0 Emojis):** تصميم مؤسسي راقٍ بالكامل متوافق مع لوحة تحكم Z-Systems، متجاوب 100% مع الهواتف الذكية والشاشات الصغيرة (< 768px و < 480px) كتطبيق جوال أصيل (Native-like Mobile App)؛ توزيع متكافئ للأزرار لتسهيل اللمس بالإبهام، شريط تنقل أفقي سلس باللمس، التفاف عمودي ذكي لكروت الرواتب والسلف بدون أي انحشار للأرقام، ونوافذ منبثقة محكومة السكرول بارتفاع الهواتف، وخالٍ تماماً من أي إيموجيز كرتونية بالاعتماد الحصري على أيقونات `@/shared/components/icons/AppIcons`.

---


<!-- migrated:cap-067:end -->

<a id="cap-100"></a>
<!-- migrated:cap-100:start -->
## 75. محرك تصفية المستحقات ومكافأة نهاية الخدمة والعهد (HR End of Service Settlement & Gratuity Engine)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Jisr / ZenHR / SAP B1 End of Service Indemnity & Clearance Engine.
* **روابط وشاشات الوصول:** `/hr/settlements` (القائمة الجانبية: الإدارة والنظام ➔ مخالصات ونهاية الخدمة).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000066_hr_end_of_service_settlements.ts`, `backend/src/database/database.types.ts` (`hr_end_of_service_settlements`).
  * **الباك إند:** `backend/src/modules/hr/services/end-of-service.service.ts`, `backend/src/modules/hr/controllers/end-of-service.controller.ts`, `backend/src/modules/hr/hr.module.ts`.
  * **الفرونت إند:** `frontend/src/features/hr/api/end-of-service.api.ts`, `frontend/src/features/hr/pages/HrEndOfServicePage.tsx`, `frontend/src/features/hr/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **حاسبة مكافأة نهاية الخدمة وفق أنظمة العمل (Saudi & Egyptian Labor Law Gratuity):** احتساب آلي للمكافأة طبقاً للمادتين 84 و 85 من نظام العمل السعودي (التفريق بين إنهاء العقد والاستقالة وسنوات الخدمة: أقل من سنتين، 2-5 سنوات، 5-10 سنوات، 10+ سنوات) وقانون العمل المصري المادة 125، أو السياسات المخصصة.
  2. **تصفية شاملة للمستحقات والاستقطاعات:** احتساب بدل رصيد الإجازات السنوية المتبقية، وأيام الشهر الحالي، والخصم الآلي لكافة السلف والقروض غير المسددة من صافي المستحق.
  3. **كشف العهد والأجهزة المسلمة وإقرار إخلاء الطرف:** استعراض مباشر لكافة الأجهزة والعهد العينية المسلمة للموظف (لابتوب، سيارات، عهد مالية) مع التحقق من استرجاعها وإثبات إخلاء الطرف.
  4. **الترحيل المحاسبي بنقرة واحدة (1-Click Journal Entry):** توليد قيد اليومية المالي آلياً لمديونية مصروف/مخصص نهاية الخدمة وتسوية سلف الموظفين وصرف الصافي من الخزينة أو البنك مع ربط رقم القيد بالمخالصة لمنع الازدواجية.
  5. **نموذج مخالصة وإخلاء طرف رسمي قابل للطباعة (Official Clearance Document):** شهادة مخالصة نهائية متكاملة بصيغة قانونية تحتوي على إقرار الموظف باستلام مستحقاته وإبراء ذمة المنشأة مع مساحات لتواقيع الموظف وإدارة الموارد البشرية والإدارة المالية.

---


<!-- migrated:cap-100:end -->

<a id="cap-217"></a>
<!-- migrated:cap-217:start -->
## 183. منظومة تتبع المتقدمين للوظائف ومجمعات المواهب (Recruitment ATS & Talent Pools)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (29 سبتمبر 2026).
* **المسار:** `/hr/recruitment`.
* **المشكلة المعالجة:**
  - تمكين إدارات الموارد البشرية والتوظيف من إدارة خط أنابيب المرشحين (Candidate Pipeline) بصرياً عبر لوحة كانبان تفاعلية، وتصنيف السير الذاتية في مجمعات مواهب متخصصة (Talent Pools)، والتحويل المباشر بنقرة واحدة من مرشح وظيفي إلى موظف رسمي معتمد دون إعادة إدخال البيانات يدوياً.
* **الهندسة والحلول المنفذة:**
  1. **هجرة قاعدة البيانات (2040000000176_recruitment_ats_and_talent_pools.ts):**
     - إنشاء جدول الوظائف الشاغرة (`recruitment_job_openings`) مع حقول الترقيم (`job_code`)، القسم، والعدد المستهدف (`headcount`)، وعدد المعينين (`hired_count`).
     - إنشاء جدول المتقدمين ومجمعات المواهب (`recruitment_applicants`) مع مراحل التوظيف (`stage`)، التقييم (`rating`)، وسوم المواهب (`talent_pool_tag`)، والربط بالموظف الرسمي (`hired_employee_id`).
     - تطبيق عزل المستأجر الصارم (`tenant_id`) والفهارس المركبة لسرعة استعلام مراحل الكانبان.
  2. **محرك حوكمة مراحل التوظيف والتحويل الوظيفي الصافي (recruitment-ats.engine.ts):**
     - محرك حسابي نقي وخالٍ من الاعتماديات الخارجية.
     - التحقق الصارم من انتقال المراحل (منع التراجع بعد اكتمال التعيين `hired`، والسماح بالرفض `rejected` أو إعادة التفعيل من أي مرحلة).
     - فحص السعة والشواغر الوظيفية (`checkJobOpeningHeadcount`) وإغلاق الوظيفة آلياً عند اكتمال العدد المطلوب.
     - اشتقاق وتوليد كائن بيانات الموظف المعتمد (`buildEmployeeFromApplicant`) لربطه بجدول `hr_employees`.
     - احتساب قمع التوظيف ومعدل التحويل الناجح (`conversionRatePercent`).
     - تغطية شاملة باختبارات الوحدة (`backend/test/recruitment-ats-engine.spec.ts`) بنجاح 100%.
  3. **خدمة الباك إند ووحدة التحكم (recruitment-ats.service.ts & recruitment-ats.controller.ts):**
     - الترقيم المستندي القياسي للوظائف (`JOB-YYMMDD-XXXX`) وللمتقدمين (`APP-YYMMDD-XXXX`).
     - تدفق التعيين الفوري بنقرة واحدة (1-Click Hire): إنشاء الموظف في `hr_employees` عبر `HrService.upsertEmployee`، وتحديث سجل المتقدم بالمعرف `#id`، وزيادة عداد التعيين في الوظيفة الشاغرة وإغلاقها تلقائياً عند الاكتمال في معاملة ذرية.
  4. **واجهة المستخدم التفاعلية (RecruitmentKanbanPage.tsx, CreateJobOpeningModal.tsx, CreateApplicantModal.tsx, ApplicantDetailsModal.tsx):**
     - شريط مؤشرات أداء قمع التوظيف (Recruitment Funnel): إجمالي المتقدمين، قيد الفحص والمقابلات، عروض العمل، تم التعيين، ومعدل التحويل الناجح.
     - لوحة كانبان (Kanban Board) بـ 5 أعمدة تفاعلية لعرض بطاقات المرشحين وبيانات الاتصال والراتب المتوقع والتقييم.
     - فلاتر سريعة للوظائف ومجمعات المواهب وبحث فوري بالاسم والهاتف.
     - نافذة ملف المرشح التفصيلي مع زر التعيين الفوري (`Hire to Employee`) مع حوارات تأكيد وحماية.
* **الملفات المتصلة:**
  - `backend/src/database/migrations/2040000000176_recruitment_ats_and_talent_pools.ts`
  - `backend/src/database/database.types.ts`
  - `backend/src/modules/hr/engines/recruitment-ats.engine.ts`
  - `backend/test/recruitment-ats-engine.spec.ts`
  - `backend/src/modules/hr/dto/recruitment-ats.dto.ts`
  - `backend/src/modules/hr/services/recruitment-ats.service.ts`
  - `backend/src/modules/hr/controllers/recruitment-ats.controller.ts`
  - `backend/src/modules/hr/hr.module.ts`
  - `frontend/src/features/hr/api/recruitment-ats.api.ts`
  - `frontend/src/features/hr/components/recruitment/CreateJobOpeningModal.tsx`
  - `frontend/src/features/hr/components/recruitment/CreateApplicantModal.tsx`
  - `frontend/src/features/hr/components/recruitment/ApplicantDetailsModal.tsx`
  - `frontend/src/features/hr/pages/RecruitmentKanbanPage.tsx`
  - `frontend/src/features/hr/routes.tsx`
  - `frontend/src/app/router/access.ts`
* **التحقق البرمجي:**
  - اختبارات الوحدة للمحرك: `backend/test/recruitment-ats-engine.spec.ts` بنجاح 100% لحوكمة الانتقال بين المراحل، ومطابقة السعة والشواغر، وتوليد كائن الموظف، ومقاييس القمع التوظيفي.

---


<!-- migrated:cap-217:end -->

<a id="cap-234"></a>
<!-- migrated:cap-234:start -->
## HR, Payroll, Loans and End-of-Service Hardening (5 October 2026)

- **Pure Calculation Engines:** All business formulas extracted into standalone pure engines:
  - `eos-calculation.engine.ts`: End of service benefits (gratuity under Saudi Art. 84/85/80 and Egyptian Art. 125, vacation leave encashment, and settlement absorption).
  - `payroll-calculation.engine.ts`: Daily/hourly rates, 1.5x overtime multiplier, progressive attendance delay deduction policies, dual-sided social insurance (GOSI), progressive income tax brackets, 50% labor law deduction cap, and GL double-entry reconciliation.
- **Physical Column Backfill & Leave Balance Integrity (Migration 2040000000194):** Added column `used_annual_leaves` to `hr_employees` and backfilled from approved leave requests, eliminating the silent 21-day overpayment bug where `undefined` was read from disk. Leave requests execute inside transactions with `FOR UPDATE` locks; approval verifies `annual_leave_balance - used_annual_leaves >= days` (throwing 400 `HR_LEAVE_INSUFFICIENT_BALANCE` on overdraft) and atomically increments `used_annual_leaves`. Cancellation restores `used_annual_leaves` via `GREATEST(0, used_annual_leaves - days)`.
- **Double-Entry General Ledger Balance (7-Way Balanced Journal):**
  - Resolved system accounts: `6200` (Gross Salaries Expense), `6210` (Employer Social Insurance Expense), `2140` (Payroll Net Payable), `2145` (Social Insurance Authority Payable), `2146` (Income Tax Payable), `1160` (Employee Advances & Loans), `7100` (Operational & Attendance Penalties).
  - `postPayrollAccrual` asserts `Total Debit == Total Credit` down to 0.01 precision. Zero discrepancies, zero silent skips.
- **Cash Advance & Loan Governance:**
  - `createLoan`: Enforces cumulative exposure cap (`outstandingDebt + amount <= 3x monthly salary`), canonical numbering `LOAN-YYMMDD-XXXX`.
  - `approveLoan`: Enforces Maker-Checker separation (`loan.created_by !== auth.userId`).
  - `createQuickCashAdvance`: Caps at 1 month salary, records to `hr_employee_ledger`, generates canonical `LOAN-YYMMDD-XXXX`, and triggers GL journal `postEmployeeLoanDisbursement` (Dr 1160 / Cr 1110).
- **Statutory Deduction Priority & 50% Labor Law Cap:**
  - Statutory deductions (GOSI, Tax) take precedence over operational penalties and discretionary loan installments.
  - Total non-statutory deductions are bounded by the 50% gross salary cap. Loan installments only take remaining pool; any shortfall is deferred (`deferredLoanDeduction`) without forgiving uncollected debt. Excess operational penalties are tracked as `carriedForwardDeduction`. Net pay is guaranteed non-negative (`>= 0`).
- **Critical Tests:** Verified 100% green via `backend/test/critical/payroll-calculation-engine.spec.ts` (all 6 test suites passing) and `backend/test/critical/phase6-hr-eos.spec.ts` (all 14 test suites passing).

<!-- migrated:cap-234:end -->

<a id="cap-235"></a>
<!-- migrated:cap-235:start -->
## Cashier Quick Cash Advance & Wage Payout Governance (26 October 2026)

- **Dual-Tab Operational Architecture (`Ctrl + Alt + X`):**
  - **Tab 1: Cash Advance (`سلفة / مسحوب على الحساب`):**
    - Governs intra-cycle borrowings with strict cashier limits:
      - Direct Cashier Advance Cap (`maxDirectAdvance`): Capped at conservative **50%** of net accrued earnings AND absolute monetary ceiling of **2,000 EGP** per single POS drawer advance.
      - Any advance exceeding 50% or 2,000 EGP, or overdraft advance (`isOverdraft`), strictly requires Manager PIN / Admin Password authorization (`HR_ADVANCE_OVER_DIRECT_CAP_REQUIRES_MANAGER_APPROVAL` / `HR_ADVANCE_MANAGER_APPROVAL_REQUIRED`).
      - Smart non-lethal quick buttons: `[سلفة 25%]`, `[الحد المباشر 50%]`, and `[كامل المستحق (اعتماد مدير)]`.
  - **Tab 2: Wage Payout & Settlement (`صرف وتسوية الراتب`):**
    - Formal period wage settlement:
      - Enforces official pay cycle due date (`resolvePayoutSchedule` across daily, weekly, biweekly, and monthly frequencies).
      - Early wage payout before the period end strictly locks direct cashier disbursement, requiring Manager PIN/Password (`HR_EARLY_PAYOUT_REQUIRES_MANAGER_APPROVAL`) and tagging records with `[تسوية وصرف أجر مبكر معتمد برمز المدير: ...]`.
      - Automatic reconciliation with approved payroll runs: marks approved run items as `status = 'paid'` to prevent double payouts.
- **Accrual Leak Sealing & Strict Proration (`employee-withdrawal-balance.engine.ts`):**
  - Eliminated the critical vulnerability where active unfinalized draft payroll runs credited 100% of future unworked days.
  - Ongoing or draft payroll runs (`runStatus !== 'approved'` or `todayDate < cycleEnd`) are strictly prorated by elapsed days (`daysElapsed / totalCycleDays`), recognizing only earned days up to `today`.
- **Shift Drawer Liquidity Guard (`cashier_shifts`):**
  - Verifies shift drawer expected cash (`expected_cash >= amount`) before disbursement, blocking cashiers from driving drawer liquidity into the negative without manager approval (`HR_DRAWER_INSUFFICIENT_CASH`).
- **Verifications:**
  - `backend/src/modules/hr/engines/employee-withdrawal-balance.engine.spec.ts`: 100% green across hourly, debit, monthly proration, draft vs approved run handling, and 4 payout schedule frequencies.
<!-- migrated:cap-235:end -->

<a id="cap-236"></a>
<!-- migrated:cap-236:start -->
## Automated Statutory Policy Jurisdiction & Non-Blocking Payroll Approvals (26 October 2026)

- **System-Wide Country & Currency Auto-Inference (`inferStatutoryCountry`):**
  - Seamlessly maps tenant accounting currency to legal jurisdiction (`EGP` -> `EG`, `SAR` -> `SA`, `KWD` -> `KW`, `QAR` -> `QA`, `OMR` -> `OM`) or falls back to system tenant settings (`settings.country`).
  - Pre-populates clean defaults: `statutoryEffectiveFrom = '2020-01-01'` and `statutoryLegalReference = 'اللائحة الداخلية للمنشأة'`.
- **Non-Blocking Payroll Approval (`approvePayrollRun`):**
  - Eliminated the error `حدد الدولة وتاريخ السريان والمرجع القانوني وأكد المراجعة قبل حساب الاستقطاعات` when approving payroll runs.
  - For standard tenants without statutory deductions (`!hrSocialInsuranceEnabled && !hrIncomeTaxEnabled`), `statutoryReviewed` is automatically verified (`true`), and currency strictness checks are skipped so basic payroll approvals are never blocked.
  - When statutory deductions are enabled, currency matching and date ranges validate against auto-inferred system settings seamlessly.
- **Streamlined UI in HR Settings (`HrSettingsStaticSections.tsx`):**
  - Replaced the intimidating manual statutory input banner with an automatic system badge: `دولة المرتبات: مصر (EGP) (تلقائياً من إعدادات النظام)`.
  - Removed manual date-of-validity restrictions and manual review checkboxes.
  - Focused the screen strictly on business-essential toggles: Social Insurance rates and Income Tax brackets.
- **Verifications:**
  - `backend/test/critical/hr-statutory-policy.spec.ts`: 100% green.
  - `backend/test/critical/hr-payroll-run-engine.spec.ts`: 100% green.
<!-- migrated:cap-236:end -->
<a id="cap-237"></a>
<!-- migrated:cap-237:start -->
## Individual Employee Disbursement & POS Cash Drawer Integration (26 October 2026)

- **Individual Employee Payout Workflow (`payPayrollRunItem`):**
  - Added dedicated endpoint `POST /api/hr/payroll-run-items/:id/pay` and service method allowing retail and branch managers to pay individual employees on their specific payday without waiting for or forcing full-run bulk disbursements.
  - Generates atomic double-entry accounting journals (`postPayrollItemPayment` Dr 2140 / Cr 1110 Drawer/Treasury or 1120 Bank) tagged with the specific employee's identity and run metadata.
  - Logs transaction in `hr_employee_ledger` with `entry_type = 'wage_payout'` and auto-updates run status to `partially_paid` while items remain, or `paid` once all approved employees are cleared.
- **POS Cash Drawer Disbursement (`channel = 'drawer'`):**
  - Solved cash disbursement for small retail shops and outlets where neither a central treasury nor a corporate bank account is available.
  - Multi-Cashier Live Shift Selection: When multiple cashier shifts are open concurrently across POS counters, managers/admins have a complete real-time readout of every open cash drawer, the responsible cashier name, and expected cash balance (`expected_cash`), allowing them to pick whichever cashier's drawer to pay out from.
  - Automatically queries active open cashier shifts (`/api/cashier-shifts?status=open`), detecting all cashiers, doc numbers, and available drawer balances (`expected_cash`).
  - Evaluates real-time shift liquidity dynamically via `CashDrawerService.computeShiftExpectedCash(shiftId, auth, trx)`, taking into account opening cash, cash sales, and manual drawer movements instead of stale static column values.
  - Guards against insufficient cash in the selected drawer with real-time liquidity checking, providing an administrative overdraft exception toggle (`allowOverdraft`).
  - Automatically deducts the disbursed wage amount from the selected `cashier_shifts.expected_cash` and writes a corresponding `cash_out` record to `treasury_transactions` referencing the cashier and shift ID for audit and shift close reconciliation.
- **Unified Payout Modal Architecture (`PayPayrollRunModal`):**
  - Upgraded from legacy native select to modern `StandardDialog` architecture matching Z-Systems visual standards.
  - Supports both target-item mode (paying a single approved employee) and bulk-run mode (paying all approved items).
  - Three clean operational channels:
    1. **درج الكاشير (ورديات النقدية النشطة)**: Live multi-shift drawer selection, expected cash readout per cashier, active shift switching, and shortfall warning.
    2. **الخزينة العامة (الصندوق الرئيسي)**: Direct cash ledger outflow.
    3. **تحويل بنكي / محفظة إلكترونية**: Formal bank transaction reference tracking.
- **Direct Subtable & Employee Detail Screen Triggers:**
  - Added instant `[صرف الراتب الآن]` button and `[تم الصرف (مدفوع)]` badge inside the employee review modal `PayrollReviewItemModal` (in both the Net Payable banner and footer actions).
  - Added quick `[صرف]` action button in `HrPayrollPage` items subtable for rows with `status === 'approved'`.
  - Added `partially_paid` ("صرف جزئي") badge and `[صرف المتبقي]` button to `PayrollRunsTable`.
- **Database Schema & Constraints:**
  - Migration `2040000000257_hr_payroll_individual_and_drawer_disbursement.ts` added check constraint support for `partially_paid` and `drawer`, plus item tracking columns (`paid_at`, `paid_by`, `payment_channel`, `payment_reference`, `shift_id`, `journal_entry_id`).
- **Financial Statement & Ledger Zero-Discrepancy Synchronization:**
  - Upgraded `buildEmployeeFinancialStatement` (`employee-financial-statement.engine.ts`) to recognize individual item payouts (`itemStatus = 'paid'`) and runs in `partially_paid` state, guaranteeing that an individual payout accurately zeroes the employee's net financial balance to `0.00` (`status = 'settled'`).
  - Anchored gross entitlement timestamps chronologically before net payout timestamps when salaries are disbursed early to prevent phantom negative dips in running ledger calculations.
  - Aligned `hr.service.ts` (`getEmployeeFinancialStatement` and `getEmployeeWithdrawalBalance`) to `COALESCE` item-level and run-level payment metadata and prevent double-withdrawal of already disbursed pay cycles.
- **Verification & Stress Simulations:**
  - `backend/test/critical/hr-payroll-comprehensive-master-simulation.spec.ts`: 100% green.
    1. Cash advance lifecycle + payroll deduction + cash drawer disbursement + 100% zeroed statement.
    2. Individual early disbursement vs pending disbursement (`partially_paid` run state).
    3. All 4 pay frequency cycles (`monthly`, `biweekly`, `weekly`, `daily`) and due date resolutions.
    4. Monte Carlo 50,000 synthetic real-world iterations across all salary, advance, and cap combinations (passed in 1.4s).
    5. Double-entry accounting GL balance reconciliation (total debit = total credit, discrepancy = 0.00).
<!-- migrated:cap-237:end -->

## Universal Biometric Attendance Integration: Raw File Parser, Binary `user.dat` Decoder, Cloud ADMS Push & LAN Sync (21 November 2026)

- **Pure Biometric Log Parser & Daily Punch Aggregator (`backend/src/modules/hr/engines/biometric-log-parser.engine.ts`):**
  - Directly parses headerless ZKTeco / Realand / ZK-OEM USB attendance files (`attlog.dat`, `.dat`, `.txt`), Hikvision / Dahua / Anviz single-punch CSV/Excel logs, and pre-paired attendance tables in **any column order** without requiring intermediate Excel formatting.
  - **Content-Based Heuristic Column Auto-Detector & Explicit Mapping Override (`autoDetectBiometricColumns`):** Scans sample rows and headers against temporal patterns (`YYYY-MM-DD HH:MM:SS`, `DD/MM/YYYY`, `HH:MM AM/PM`) and tenant employee PINs (`knownEmployeePins`) to automatically identify `pinColIndex`, `dateTimeColIndex`, `dateColIndex`, `checkInTimeColIndex`, `checkOutTimeColIndex`, and `directionColIndex` regardless of column order, while exposing `columnMapping` overrides for interactive UI customization.
  - **Smart Daily First-In / Last-Out Pairing & Debounce:** Groups punches per `(pin, workDate)`, deduplicates accidental consecutive double-taps within a configurable debounce window (`debounceMinutes`, default 3 minutes), assigns earliest punch to `checkInAt` and latest punch (if session span >= 10 minutes or explicit check-out status) to `checkOutAt`, and leaves single-punch days with `checkOutAt = null` so they surface in `HrAttendanceExceptionsService` (`missing_check_out`).
  - **ZKTeco 72-Byte Binary `user.dat` Decoder (`parseZkUserDatBuffer`):** Decodes raw binary `user.dat` dumps from ZKTeco TFT terminals (such as IN01-A, K40, F18) to extract `uid`, `userId`, `name`, `privilegeRole` (`super_admin` code 14, `admin`, `usb_manager` code 8, `user` code 0), and registered plaintext PIN/password.
  - **3-Tier Employee PIN Resolver (`buildBiometricEmployeeResolver`):** Maps numeric hardware PINs to active HR employees in $O(1)$ via: (1) explicit `hr_employees.biometric_pin`, (2) exact `employee_no`, or (3) unambiguous numeric core (`4645` -> `EMP-04645`).
- **Backend Biometric Service, ADMS Webhook & LAN UDP Tester (`backend/src/modules/hr/services/biometric-attendance.service.ts`, `backend/src/modules/hr/controllers/biometric-attendance.controller.ts`):**
  - Migration `2040000000341_hr_biometric_devices_and_logs.ts`: created `hr_biometric_devices` (unique `serial_number` for tenant-isolated ADMS routing, `ip_address`, `port`, `comm_key`, `last_sync_at`, `total_punches_received`) and added `biometric_pin` to `hr_employees`.
  - **ZKTeco ADMS / iClock Cloud Push Protocol (`GET / POST /api/hr/biometric/iclock/cdata` & `/iclock/cdata`):** Authenticates hardware terminals strictly by active registered `serial_number`, resolves `tenant_id`, pairs live incoming `ATTLOG` punches against existing same-day `hr_attendance_records`, and routes writes through `HrService.bulkImportAttendanceRecords` (preserving open-payroll-month bounds, advisory lock, and exception refresh).
  - **Direct LAN TCP/UDP Connectivity Probe & Live Attendance Pull (`POST /api/hr/biometric/devices/:id/test-lan` & `POST /api/hr/biometric/devices/:id/pull-lan`, `zkteco-lan.client.ts`):** Probes ZKTeco devices on `ip_address:port` (default `4370`), authenticates via `CMD_AUTH` (`1102` / `makeZkCommKeyPayload`) when `2005` is returned, and pulls device users (`CMD_USERTEMP_RRQ = 9`, `fct = 5`, password field stripped) and buffered attendance logs (`CMD_ATTLOG_RRQ = 13` / `decodeZkPackedTimestamp`) using **reliable TCP port 4370 framing (`50 50 82 7d`) first** (zero packet loss on 15k+ record buffers; verified live against ZKTeco `MB20/ID` pulling 15,534 records & 248 users in 8.4s) with automatic UDP fallback for legacy terminals.
  - **Self-Healing Schema Guard (`ensureBiometricSchema`):** Guarantees `hr_biometric_devices` and `hr_employees.biometric_pin` exist idempotently on first access even before a full migration restart.
- **Frontend Biometric Hub Modal & Unified Attendance Import (`frontend/src/features/hr/components/attendance/BiometricIntegrationModal.tsx`, `BiometricFileImportTab.tsx`, `BiometricPendingPunchesTab.tsx`, `BiometricDevicesAndPinsTabs.tsx`, `HrAttendancePage.tsx`):**
  - Consolidated legacy duplicate Excel `ImportWorkbench` panel out of `HrAttendancePage.tsx` into a single unified `"استيراد الحضور وأجهزة البصمة"` button and 4-tab `StandardDialog` (1. File Import & `user.dat` decoder + blank Excel CSV template + CSV converter + unmatched PIN quick-linker/creator + **3-mode Date Scope bar (`since_last` incremental watermark from `MAX(work_date)` of `source='import'`, `open_month`, or `custom` clamped to open month)** + **collapsible column-mapping override hidden by default**; 2. Pending Unmatched Biometric Punches Inbox with badge count; 3. Cloud ADMS / LAN devices manager; 4. Employee biometric PIN directory).
- **Biometric Staging Inbox & Optional Auto-Provisioning (22 November 2026):**
  - Migration `2040000000342_hr_biometric_raw_punches_staging.ts` + `backend/src/modules/hr/services/biometric-staging.service.ts`: introduces `hr_biometric_raw_punches` (unique index on `(tenant_id, device_pin, work_date)`) so unmatched open-month punches from USB files, LAN UDP pulls, and real-time Cloud ADMS pushes are never silently dropped.
  - Endpoints in `biometric-attendance.controller.ts`: `GET /api/hr/biometric/pending-punches`, `POST /api/hr/biometric/create-employee`, `POST /api/hr/biometric/bulk-create-employees`, `DELETE /api/hr/biometric/pending-punches/:pin`.
  - Linking a PIN (`POST /api/hr/biometric/employee-pin/:employeeId`, matching exact or leading-zero-equivalent PINs) or creating an employee from a PIN / `user.dat` automatically posts all pending open-month days into `hr_attendance_records` via `HrService.bulkImportAttendanceRecords`.
  - Optional `autoCreateEmployees` checkbox on file import + bulk employee creation from regular users in `user.dat`, while defaulting to staging unmatched records for safe HR review (preventing technician/super-admin PINs like `99999` from auto-entering payroll).
  - Hardened `autoDetectBiometricColumns` in `biometric-log-parser.engine.ts` to prioritize explicit PIN headers (`كود الموظف`, `User ID`, `AC-No.`, `PIN`) with `+500`, exclude constant flag/work-code/status columns (`الرمز`, `workcode`, `verify`, `status`), and score distinct DB PIN matches instead of repeated constant values.
- **Limitations:** Direct UDP LAN test requires the backend runtime to be on the same local subnet as the biometric terminal (e.g. `SELF_CONTAINED` desktop or local server); cloud deployments receive real-time punches via the HTTP ADMS Push endpoint (`/api/hr/biometric/iclock/cdata`) or USB `.dat` file upload. Auto-created employees are provisioned with active status and a note prompting HR to complete salary/contract and shift settings before payroll approval.
  - **Critical HR Facade Binding Fix (`backend/src/modules/hr/hr.service.ts`):** Fixed 13 broken `.bind(this)` sub-service bindings in `HrService` constructor (including `this.attendanceExceptionsService.refreshAttendanceExceptionForEmployeeDate.bind(this.attendanceExceptionsService)`) that previously bound the `HrService` facade as `this` instead of the owning slice instance, causing `TypeError: this.buildAttendanceException is not a function` (HTTP 500) whenever `bulkImportAttendanceRecords` or `bulkSaveAttendance` generated an attendance exception.
  - **Multi-Brand Egyptian/GCC Market Protocols (`backend/src/modules/hr/services/http-biometric-lan.client.ts`, `BiometricMultiBrandWebhookController`):**
    - **Hikvision ISAPI (LAN + Cloud):** Pure Node.js RFC 2617 HTTP Digest Auth (MD5/SHA-256), `GET /ISAPI/System/deviceInfo` probe, paginated `POST /ISAPI/AccessControl/AcsEvent?format=json` LAN pull, and real-time `POST /api/hr/biometric-push/hikvision` (supports JSON & multipart/form-data `AccessControllerEvent` payloads).
    - **Dahua HTTP CGI (LAN):** RFC 2617 Digest Auth, `GET /cgi-bin/magicBox.cgi?action=getSystemInfo` probe, and `recordFinder.cgi` (`factory.create` -> `startFind` -> paginated `doFind` -> `destroy`, with automatic single-shot `action=find` fallback) converting Unix timestamps into tenant timezone.
    - **Universal JSON Push (`POST /api/hr/biometric-push/json`):** Accepts `{ serialNumber, punches: [{ pin, timestamp, status }] }` for Anviz, Suprema, Dahua DSS, or local bridge agents, authenticated strictly by active registered `serial_number`.
    - Credentials stored in `hr_biometric_devices.comm_key` (`username:password` for HTTP devices) are automatically masked (`admin:••••••••`) in `listDevices` responses and preserved across non-credential edits.
- **Verification Evidence (2026-11-22):**
  - `npx --prefix backend ts-node -P backend/tsconfig.json --transpile-only backend/src/modules/hr/services/http-biometric-lan.client.spec.ts` — passed all assertions including live local HTTP Digest server tests for Hikvision ISAPI (probe + 2-page AcsEvent pull + multipart webhook), Dahua CGI (probe + paginated `factory.create`/`doFind` pull), and Universal JSON Push.
  - `npx --prefix backend ts-node backend/src/modules/hr/engines/biometric-log-parser.engine.spec.ts` — passed all assertions including Case D regression test confirming `كود الموظف (User ID)` beats constant `الرمز (1)` even when `knownEmployeePins` contains `001`/`1`.
  - `npx --prefix backend ts-node --transpile-only backend/test/critical/clock-p6-client-date-bounds.spec.ts` — `§B service` (`bulkSaveAttendance` / `bulkImportAttendanceRecords` + `refreshAttendanceExceptionForEmployeeDate`) passed without `buildAttendanceException` TypeError.
  - `npx --prefix backend ts-node --transpile-only backend/test/critical/import-deposit-amount-3dp.spec.ts` and `van-transfer-loaded-amount-3dp.spec.ts` — both passed after advancing `HIGHEST_MIGRATION_FILE` to `2040000000342_hr_biometric_raw_punches_staging.ts`.
  - `node frontend/scripts/file-size-check.mjs --root frontend/src --baseline frontend/scripts/baselines/file-size.json` — passed (2,121 files checked; all created/modified biometric files <= 1,000 lines).



