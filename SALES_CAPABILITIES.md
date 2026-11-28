# قدرات المبيعات ونقاط البيع

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **المبيعات ونقاط البيع** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/sales/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md) · [المرتجعات](RETURNS_CAPABILITIES.md) · [التسعير والعروض](PRICING_CAPABILITIES.md) · [التجزئة والأنشطة التجارية](RETAIL_COMMERCE_CAPABILITIES.md)

## التحديثات الحالية

### 260. التزامن الديناميكي لشريط السلة العائم مع إخفاء شريط التنقل السفلي في نقاط البيع للموبايل (Mobile POS Dynamic Floating Cart Bar & Bottom Nav Synchronizer - 26 October 2026)
* **حالة القدرة:** 🟢 مكتملة ومختبرة بنسبة 100% (26 أكتوبر 2026).
* **المسارات المتأثرة:** شاشة نقطة البيع للموبايل وشاشات الكاشير اللمسية (`/pos`).
* **المشكلة المعالجة:** عند التمرير لأسفل في شاشة نقطة البيع للموبايل، يختفي شريط التنقل السفلي (`MobileBottomNav`)، لكن شريط السلة العائم (`pos-mobile-floating-cart-bar`) كان يظل ثابتاً في موضعه المرتفع (`bottom: 64px`)، تاركاً فراغاً تحته وقاطعاً نصف شاشة الأصناف بصرياً.
* **الحلول والضوابط المنفذة:**
  1. **المزامنة الحركية التلقائية في CSS (`mobile-layout.css`):**
     - ربط انزلاق شريط السلة العائم بحالة إخفاء شريط التنقل عبر `body:has(.mobile-bottom-nav.is-hidden)`, `body.mobile-nav-hidden`, و `body.pos-scroll-hides-nav`.
     - تغيير الإحداثي السفلي لشريط السلة من `bottom: 64px` إلى `bottom: 10px` لحظياً عند إخفاء شريط التنقل ليحل محله أسفل الشاشة تماماً.
     - إضافة انتقال انسيابي ناعم `transition: bottom 0.28s cubic-bezier(0.16, 1, 0.3, 1)` يطابق تماماً سرعة حركة شريط التنقل.
  2. **مزامنة أحداث التمرير والشريط السفلي (`MobileBottomNav.tsx` و `PosProductsPanel.tsx`):**
     - التقاط أحداث التمرير عبر نمط الـ Capture على `window` و `.content-wrap` لضمان استجابة شريط التنقل لكافة حاويات التمرير بما فيها شبكة الأصناف.
     - مزامنة حالة الإخفاء مع `document.body.classList.toggle('mobile-nav-hidden', isHidden)`.
* **المراجع البرمجية:**
  - `frontend/src/shared/layout/MobileBottomNav.tsx`
  - `frontend/src/features/pos/components/PosProductsPanel.tsx`
  - `frontend/src/styles/partials/mobile-layout.css`

### 261. ثبات وتناسق هيدر نقطة البيع للموبايل (Mobile POS Top Header Layout Stability - 26 October 2026)
* **حالة القدرة:** 🟢 مكتملة ومختبرة بنسبة 100% (26 أكتوبر 2026).
* **المسارات المتأثرة:** شاشة نقطة البيع للموبايل وشاشات الكاشير اللمسية (`/pos`).
* **المشكلة المعالجة:** عند تجربة تثبيت الهيدر العلوي بـ `position: fixed` تسبب في خروجه من إطار البطاقة وتداخله مع شريط التبويبات ("الأصناف" و"السلة") واختفائه مع السحب.
* **الحلول والضوابط المنفذة:**
  1. **الاستقرار الهيكلي الطبيعي للهيدر (`mobile-layout.css`):**
     - إعادة الهيدر إلى موضعه الطبيعي المتناسق داخل شل نقطة البيع، مع الحفاظ على هوامشه القياسية وخلفيته البيضاء وحدوده الناعمة، دون أي تداخل مع التبويبات.
  2. **حصر سلوك الإخفاء التلقائي على الشريط السفلي وكارت السلة:**
     - عند التمرير لأسفل: يختفي الشريط السفلي وينزل كارت السلة العائم إلى أسفل الشاشة (`bottom: 10px`) للاستفادة الكاملة من المساحة.
     - عند التمرير لأعلى: يرتفع الشريط السفلي في مكانه بسلاسة تامة.
* **المراجع البرمجية:**
  - `frontend/src/shared/layout/MobileBottomNav.tsx`
  - `frontend/src/features/pos/components/PosProductsPanel.tsx`
  - `frontend/src/styles/partials/mobile-layout.css`

### 262. الطباعة الصامتة اللحظية عبر جسر العتاد المحلي (v1.2.0) والإغلاق التلقائي لنافذة إتمام البيع (Instant Silent Windows Printing via Hardware Bridge v1.2.0 & Post-Sale Auto-Close - 11 November 2026)
* **حالة القدرة:** 🟢 مكتملة ومختبرة (11 نوفمبر 2026).
* **المسارات المتأثرة:** جسر العتاد المحلي على ويندوز (`tools/z-systems-bridge`)، ومحرك طباعة إيصالات نقاط البيع (`frontend/src/lib/browser.ts`, `frontend/src/lib/pos-printing.ts`, `frontend/src/lib/pos-printing/hardware.ts`)، ونافذة نجاح البيع (`PosWorkspace.tsx`).
* **الحلول والضوابط المنفذة:**
  1. **جسر العتاد المحلي (`tools/z-systems-bridge/Program.cs` - v1.2.0):** أيقونة شريط مهام مؤسسية مخصصة بشعار `Z` على خلفية كحلية (`#170e5e`) مع مؤشر اتصال أخضر وقائمة سياق عربية باتجاه `RightToLeft.Yes`، ورفع `MaxJsonLength = int.MaxValue` مع قراءة جسم الطلب بترميز `Encoding.UTF8` الصريح، وتنفيذ `PrintHtmlOnWindowsPrinter` على الخيط الرئيسي (`_uiDispatcher.Invoke`) عبر ملف HTML مؤقت بترميز UTF-8 BOM داخل `Form` مخفية، وتقليص زمن الضخ المتزامن إلى `600ms` مع تأجيل حذف الملف المؤقت عبر `Timer` خلفي.
  2. **محرك الطباعة في الواجهة (`browser.ts`, `pos-printing.ts`, `hardware.ts`, `kitchen.ts`):** قراءة إعدادات الطباعة من `queryKeys.settings ?? queryKeys.posSettings` وتمرير `windowsPrinterName` صراحةً في `openReceiptDocument` و `printKitchenTicket`، وتخطي فحص المنافذ الخام (`8080` و `9100`) في `printPostedSaleReceipt` و `tryPrintViaHardware` عند تحديد طابعة ويندوز (`posWindowsPrinterName`).
  3. **إغلاق نافذة نجاح البيع تلقائياً عند الطباعة (`PosWorkspace.tsx`):** ربط أزرار الطباعة (`F2`, `F4`, `F10`, طباعة المطبخ) بإغلاق `PosSaleSuccessDialog` واستدعاء `completePostSaleCycle` وإعادة التركيز لحقل الباركود فوراً.
* **أدلة الاختبار:** `npm --prefix frontend run test -- --run src/lib/browser-print-bridge.spec.ts src/lib/pos-printing/hardware.spec.ts src/features/pos/components/pos-workspace/PosSaleSuccessDialog.spec.tsx src/features/pos/components/PosWorkspace.keyboard-safety.spec.tsx` (29/29 اختباراً ناجحاً).

### 263. صلاحية الأدمن ومالك المتجر الكاملة في الخصومات وتعديل الأسعار وحظر طلب الـ PIN للمدير (Admin & Store Owner POS Discount & Price Authority - 11 November 2026)
* **حالة القدرة:** 🟢 مكتملة ومحمية بسبيك شامل (11 نوفمبر 2026).
* **المسارات المتأثرة:** بوابات الخصم والأسعار والحد الأدنى في الباك إند (`sales-write.service.ts`)، وهوك وواجهات الكاشير والدفع بالفرونت إند (`usePosWorkspace.ts`, `usePosWorkspaceDerived.ts`, `PosCheckoutDialog.tsx`, `PosCheckoutExpressSection.tsx`, `PosCartPanel.tsx`).
* **القواعد والضوابط المنفذة (INV-POS-ADMIN-DISCOUNT-AUTHORITY):**
  1. **معاملة الأدمن كمالك ومدير للمتجر:** رتبة `admin` في حسابات المستأجرين تمثل أعلى سلطة إدارية، لذا تم إعفاء `admin` و `super_admin` تماماً من طلب كلمة مرور أو رمز المدير عند الخصم في `assertDiscountChangeAllowed` وتعديل السعر في `assertUnitPriceChangeAllowed`.
  2. **البيع تحت حد التكلفة للأدمن:** عند نزول صافي السعر تحت التكلفة أو الحد الأدنى (`belowFloorItems`) أثناء بيع أو تعديل الأدمن، لا يتم حظر العملية ولا يُطلب PIN مدير، بل يتم تسجيل الأصناف في ملاحظة الفاتورة (`[بيع تحت الحد: أصناف ...]`) دون اسم معتمد؛ بينما يبقى الكاشير خاضعاً للإلزام الصارم باعتماد المدير.
  3. **مرآة الواجهة والتنبيه غير المانع:** تمرير `authRole` من `authUser` لـ `usePosWorkspaceDerived` ومطابقة سلطة الأدمن في الفرونت إند مع عرض تنبيه تحذيري غني يوضح السعر النهائي المطلوب بالعملة دون قفل زر البيع إطلاقاً.
  4. **إظهار اعتماد المدير للكاشير:** إزالة شرط حجب زر الاعتماد عن الأدمن في `PosCheckoutDialog` بحيث يظهر زر وحقل إدخال رمز المدير لأي مستخدم مقفول عليه الخصم (الكاشير).
* **أدلة الاختبار:** `npx ts-node test/critical/admin-discount-authority.spec.ts` (6/6 نجاح)، `npx ts-node test/critical/sale-edit-cost-floor.spec.ts` (نجاح)، `npx ts-node test/critical/discount-tiers.spec.ts` (نجاح)، واختبارات الفرونت إند `npm --prefix frontend test -- usePosWorkspaceDerived.spec.tsx PosCheckoutDialog.spec.tsx --run` (14/14 نجاح).

### 264. إصلاح تبديل قنوات الدفع وإعادة تصميم نافذة إتمام البيع بنقاط البيع وإزالة أسهم الأرقام (POS Checkout Payment Channel Switching, Spinner Removal & Layout Redesign - 16 November 2026)
* **حالة القدرة:** 🟢 مكتملة ومحققة باختبارات الوحدة المستهدفة (16 نوفمبر 2026).
* **المسارات المتأثرة:** نافذة إتمام البيع وشريط الدفع وإجراءات نقطة البيع (`createPosWorkspaceBaseActions.ts`, `pos-workspace.helpers.ts`, `PosCheckoutDialog.tsx`, `PosCheckoutDialogSections.tsx`, `PosCheckoutExpressSection.tsx`, `PosCartPaymentSection.tsx`, `pos-checkout-dialog-polish.css`).
* **الإصلاحات والضوابط المنفذة:**
  1. **إصلاح `setPaymentPreset` ومنع تضارب القنوات:** التمييز الصارم بين التقسيم الفعلي (`otherSum > 0 && otherSum < total && selfAmount === 0` لملء المتبقي فقط) وبين التبديل الكامل لطريقة الدفع عندما تغطي القنوات الأخرى الإجمالي (`otherSum >= total`)؛ بحيث يؤدي النقر على `فيزا / كارت` أو `نقدي` أو `تحويلات / محافظ` إلى نقل الإجمالي بالكامل لخانة الزرار المختار وتصفير باقي الخانات، مع الحفاظ على تبديل شبكات `K-NET` / `مدى` و`InstaPay` / `محافظ إلكترونية`.
  2. **تصحيح تمييز الزرار النشط (`isPaymentActive` و`normalizePaymentChannel` و`isPresetActive`):** حظر إضاءة زرارين معاً في الدفع الأحادي، وعدم إضاءة زرار `نقدي` أثناء الدفع عند الاستلام (`cod`) غير المدفوع، مع إبراز حالة الدفع المقسّم بصرياً فقط عندما تحتوي أكثر من خانة على مبالغ فعلية (`> 0`)، وإعادة ضبط التوصيل عند الرجوع من المنصات إلى `مباشر (المحل)`.
  3. **إزالة أسهم الزيادة/النقصان من كافة خانات المبالغ:** تطبيق `.no-spin-arrows` وقواعد CSS في `pos-checkout-dialog-polish.css` على حقول المبالغ والخصم والتوصيل والإكرامية مع `onWheel` blur وتحديد النص عند التركيز، وتعطيل خانات التحصيل أثناء البيع الآجل (`credit`).
  4. **ثبات حجم النافذة والهيدر، إلغاء الأنيميشن، واللغة البصرية المؤسسية (`PosCheckoutDialog` & `PosCheckoutDialogSections` & `pos-checkout-dialog-polish.css`):** تثبيت ارتفاع النافذة التفصيلية (`min(645px, calc(100vh - 20px))`) وارتفاع الهيدر (`min-height: 41px`) وحصر أزرار تبديل `دفع سريع / تفصيلي` على الموبايل فقط (`isMobile`) مع حماية `flex: 1 1 auto` لوضع Express، وتخصيص حشوة `12px 18px` لمنع السكرول الداخلي في كافة الأوضاع، وحجز ارتفاع ثابت لصف الخيارات الفرعية (`38px`)، ونقل رسالة التحقق داخل سطر الفوتر دون تكرار، وإلغاء جميع حركات `transition`/`animation`/`scale3d` داخل النافذة لاستجابة `0ms` فورية، وإزالة الكبسولات الدائرية والحقول مزدوجة الإطار لصالح تصميم Z-Systems ERP المسطح المباشر.
* **أدلة الاختبار:** تشغيل اختبارات Vitest المستهدفة من داخل `frontend`: `npx vitest run src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx src/features/pos/components/pos-workspace/PosCheckoutDeliverySection.spec.tsx src/features/pos/components/pos-workspace/pos-express-amount-sync.spec.tsx src/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions.spec.ts` (4 ملفات / 63 اختباراً ناجحاً بتاريخ 16 نوفمبر 2026).

### 265. إصلاح سرقة التركيز للخلفية واختصارات طرق الدفع (`Alt + 1..5`) في نافذة إتمام البيع بنقاط البيع (POS Checkout Focus Lock & Alt+Digit Payment Shortcuts - 17 November 2026)
* **حالة القدرة:** 🟢 مكتملة ومحققّة بالاختبارات المستهدفة (17 نوفمبر 2026).
* **المسارات المتأثرة:** إجراءات نقطة البيع ومساحة العمل (`createPosWorkspaceBaseActions.ts`, `usePosWorkspaceActions.ts`, `PosWorkspace.tsx`, `PosProductsPanel.tsx`, `useScannerBuffer.ts`) ومكونات نافذة الدفع (`pos-checkout-shortcuts.ts`, `PosCheckoutDialog.tsx`, `PosCheckoutDialogSections.tsx`, `PosCheckoutExpressSection.tsx`, `PosCheckoutExpressFooter.tsx`).
* **المشكلة المعالجة والحلول المنفذة:**
  1. **منع سحب الكيرسور لخانة السيرش خلف النافذة (Root Focus-Steal Fix):** إزالة النداء غير المشروط لـ `params.requestBarcodeFocus()` من `setPaymentPreset` (وحصره في خيار صريح `{ focusBarcode?: boolean }`)، وإضافة فحص `isPosModalOpen()` داخل كل من `focusBarcodeEntry` و`focusSearchInput` (قبل وجوه `requestAnimationFrame`) وكذلك في مستمع `handleWindowKeyDown` داخل `useScannerBuffer` لمنع تسرب أي ضغطات أو سرقة تركيز إلى الخلفية طالما أي مودال مفتوح.
  2. **التوجيه التلقائي الذكي للتركيز داخل النافذة (`PosCheckoutDialog` & `PosCheckoutDialogSections` & `PosCheckoutExpressSection`):** إضافة مراجع الحقول (`cardAmountInputRef`, `transferAmountInputRef`, `expressCashInputRef`) وتوجيه التركيز وتحديد القيمة آلياً داخل النافذة إلى حقل الطريقة المختارة (`نقدي` أو `فيزا / كارت` أو `تحويلات / محافظ`) عند الفتح أو التبديل، مع إبقاء حقل بحث العميل في حالة البيع الآجل.
  3. **اختصارات `Alt + 1..4/5` الآمنة لطرق الدفع (`pos-checkout-shortcuts.ts`):** ربط اختصارات `Alt+1..4` (أو `Alt+1..5` لأنظمة الكويت والسعودية) المعتمدة على `event.code` (`Digit1..5` و`Numpad1..5` مع دعم الأرقام العربية كـ fallback) مع شارات `<kbd aria-hidden="true">` دون التأثير على كتابة المبالغ أو الأسماء الوصولية للأزرار، واحترام قفل تفويض الماكينة (`canChangePaymentAfterTerminalApproval`).
* **أدلة الاختبار:** اختبارات Vitest المستهدفة لملفات `pos-checkout-shortcuts.spec.tsx` و`PosCheckoutDialog.spec.tsx` و`PosWorkspace.keyboard-safety.spec.tsx` و`createPosWorkspaceBaseActions.spec.ts` و`useScannerBuffer.spec.tsx`.

### 266. المعمارية المتكاملة للبيع الأوفلاين المرن في نسخة الساس (`Cloud SaaS Local-First POS Vault, Circuit Breaker & Fact-of-Sale Reconciliation` - 28 November 2026)
* **حالة القدرة:** مفعّلة ومحقّقة بالاختبارات المستهدفة (28 November 2026).
* **المسارات المتأثرة:** نقاط البيع والخزينة والـ Idempotency والـ Shell (`network-circuit-breaker.ts`, `pos-offline-vault.ts`, `pos-offline-sync.ts`, `pos-catalog-storage.ts`, `pos.api.ts`, `usePosSaleMutation.ts`, `usePosOfflineSync.ts`, `usePosWorkspace.ts`, `usePosWorkspaceMutations.ts`, `createPosWorkspaceAsyncActions.ts`, `PosOpenShiftModal.tsx`, `PosRecentSalesReprintModal.tsx`, `PosCheckoutTerminalBanner.tsx`, `PosOfflineQueueModal.tsx`, `PosGlobalOfflineSyncHost.tsx`, `app-shell-main.tsx`, `app-shell.tsx`, `idempotency.service.ts`, `idempotency.controller.ts`, `pos-offline-sale.engine.ts`, `load-sale-context.ts`, `prepare-sale-items.ts`, `compute-totals-and-gates.ts`, `allocate-tenders-and-delivery.ts`, `insert-sale-and-stock.ts`, `cash-drawer-write.service.ts`).
* **الحلول والضوابط المنفذة:**
  1. **خزنة التشغيل الأوفلاين الموحدة والمعزولة بالمستأجر (`pos-offline-vault.ts`):** حفظ لقطة التشغيل الفورية (`settings`, `branches`, `locations`, `openShifts`, `customers`) في `IndexedDB` مع مرآة إقلاع متزامنة تمنع تعطل الكاشير عند تحديث الصفحة (`F5`) أو انقطاع الكهرباء أثناء فصل الإنترنت، مع عزل صارم بمفتاح `${tenantId}::${accountId}` وسعة غير محدودة لطابور الفواتير المالي (`outbox_sales`) وتنزيل نسخة طوارئ (`JSON`).
  2. **قاطع الشبكة الذكي والمهلة السريعة (`network-circuit-breaker.ts`):** خفض مهلة إتمام البيع التفاعلي إلى `4.5` ثوانٍ بدل `30` ثانية، مع التحول الفوري لمسار الحفظ الأوفلاين (`0ms`) عند سقوط خط الإنترنت الخارجي رغم بقاء الواي فاي متصلاً بالراوتر، ومسبار صحة خلفي يفحص `/api/health/live` كل `15` ثانية لاستئناف المزامنة تلقائياً فور عودة الإنترنت.
  3. **فتح الوردية الصباحية أوفلاين والعمليات المساندة:** دعم فتح وردية أوفلاين مؤقتة (`Provisional Shift`) برصيد افتتاحي وتزامن تلقائي مسبق (`offlineOpenedAt`) قبل ترحيل الفواتير، وتعليق واسترجاع الفواتير محلياً (`Hold/Recall`)، وإضافة عميل سريع أوفلاين، وفتح درج النقدية تلقائياً في المبيعات النقدية الأوفلاين، وخصم الرصيد محلياً من `IndexedDB`، وأرشيف محلي لآخر `100` فاتورة لإعادة الطباعة (`F9`)، وبديل إدخال مرجع إيصال ماكينة الدفع المستقلة (`4G EDC`) أوفلاين.
  4. **المزامنة الشمولية عبر التطبيق وحماية الجلسة وتوحيد الـ `Idempotency`:** تشغيل `PosGlobalOfflineSyncHost` كسولاً داخل `AppShellMain` بقفل تبويبات متقاطع (`navigator.locks`) وحارس `beforeunload` وتنبيه تسجيل الخروج، وتعليق المزامنة بحالة `auth_required` عند انتهاء الجلسة (`401`) بدل إتلاف الطابور، وتوحيد بصمة `SHA-256` مع إتاحة إعادة محاولة العمليات المؤكد تراجعها (`status = 'failed' && document_id IS NULL`) عبر `/reset-failed`.
  5. **سياسة الباك إند لحقيقة البيع الفعلي (`pos-offline-sale.engine.ts`):** تقييم العروض الترويجية وساعات التخفيض بتوقيت البيع الأصلي `offlineCreatedAt`، وقبول نسب الفاتورة لوردية مغلقة تاريخياً وقعت الفاتورة في نافذتها الزمنية، وترحيل الفواتير الأوفلاين التي نفد رصيدها أو تغير سعرها على الخادم أثناء الانقطاع مع تسجيل وسوم رقابية وسجلات `pos_audit_events` للمدير.
* **القيود المعروفة:** الشاشات متعددة الأطراف داخل الصالة الواحدة (مثل تزامن تابلت ويتر مع شاشة مطبخ `KDS` منفصلة أثناء انقطاع الإنترنت الخارجي) تظل معتمدة على الشبكة السحابية ما لم يُفعّل موزع شبكة داخلية محلي.
* **أدلة الاختبار (2026-11-28):** نجح `backend typecheck` (`0` أخطاء) و`19` اختبار باك إند حرج (بما فيها `pos-offline-resilience.spec.ts` و`idempotency*.spec.ts` و`offline-sale-backdate-bound.spec.ts` و`closed-shift-post-close-refresh.spec.ts` و`performance-hot-paths.spec.ts` و`module-doors.spec.ts`)، ونجحت كامل اختبارات `frontend/src/features/pos` (`81` ملفاً / `845` اختباراً) وحارسا `qa:perf` و`qa:architecture` بدون أي خطأ `tsc` في ملفات البيع الأوفلاين.

## فهرس الأقسام المنقولة

- [قدرة: منظومة الدفع والـ QR الذكي متعدد القنوات (Z-Pay Multi-Channel Smart Payment Hub) لماكينات Sunmi ونقاط البيع — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)](#cap-004)
- [قدرة: النمط الذكي المزدوج لمسح الباركود بنقاط البيع (Smart Dual-Mode Barcode Scanning Architecture) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)](#cap-005)
- [2. نقاط البيع والمبيعات والكاشير (POS & Sales Management)](#cap-029)
- [27. شاشة عرض العميل المقابلة للكاشير (Customer Facing Display - CFD)](#cap-053)
- [32. رادار كشف تلاعب وسرقات الكاشير ومنع الخسائر (Cashier Loss Prevention & Fraud Audit Radar) 🕵️‍♂️🚨](#cap-057)
- [35. شاشة العروض الترويجية الرقمية لصالة العرض (Digital Signage / Promo Board) 📺✨](#cap-060)
- [48. تحويل نقطة البيع والكاشير إلى موديول اختياري مرن (Modular POS & Cashier Workspace for B2B & Wholesale ERP)](#cap-073)
- [65. أوامر البيع وحجز المخزون المؤقت (Sales Orders & Stock Reservation Engine)](#cap-090)
- [65. أوامر البيع وحجز المخزون المؤقت (Sales Orders & Stock Reservation Engine)](#cap-102)
- [134. توحيد أبعاد أزرار نافذة إتمام البيع السريع وإضافة اختصار طباعة النسختين F4 (POS Sale Success Dialog Uniform Buttons & Dual Print F4 Shortcut)](#cap-159)
- [185. معيار ثبات نافذة خيارات وتفريعات الأصناف بنقاط البيع داخل مجال الرؤية المباشر (POS Variants Modal Viewport-Anchored Standard)](#cap-219)
- [POS and cashier integrity (2 October 2026)](#cap-226)
- [Retail and POS field-readiness follow-up (5 October 2026)](#cap-232)
- [POS financial controls follow-up (5 October 2026)](#cap-233)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-004"></a>
<!-- migrated:cap-004:start -->
### قدرة: منظومة الدفع والـ QR الذكي متعدد القنوات (Z-Pay Multi-Channel Smart Payment Hub) لماكينات Sunmi ونقاط البيع — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)
- **معمارية الدفع الميداني الديناميكي (Dynamic On-Screen Payment QR Engine):**
  - توليد لحظي لرموز QR عالية الدقة والمتوافقة مع أنظمة الدفع المصرية والمحافظ الإلكترونية:
    1. **انستاباي (InstaPay Dynamic QR):** توليد رابط دفع عميق مشفر بصيغة `instapay://pay?account=...&amount=...&currency=EGP&ref=...` مدمج به القيمة الدقيقة للفاتورة ورقم المرجع، لتمكين العميل من مسح الرمز بكاميرا تطبيق InstaPay وتعبئة البيانات والمبلغ آلياً بنقرة واحدة.
    2. **المحافظ الإلكترونية (Mobile Wallets QR):** دعم منظومة ميزة ديجيتال ومحافظ شركات الاتصالات (فودافون كاش، أورنج كاش، اتصالات كاش، وي باي) بصيغة موحدة قياسية `TEL:...|AMT:...|CUR:...|REF:...|PROVIDER:...`.
    3. **روابط السداد المباشر (Card Payment Links & Apple Pay):** توليد روابط بوابات الدفع الإلكتروني (Paymob / Geidea / Hosted Gateway) مع المبلغ والمرجع للسداد بالبطاقات المصرفية عبر هاتف العميل.
  - محرك توليد SVG نقي محلي بدون أي اعتماديات ثقيلة (`frontend/src/lib/payment-qr.ts` ومكتبة `@/lib/qrcode`) متوافق 100% مع دستور الأداء PERFORMANCE_CONSTITUTION.
- **نافذة الكاشير والتحصيل التفاعلية بنقطة البيع (`PosCheckoutDialogSections.tsx`):**
  - بطاقة تحصيل ذكية `PosPaymentQrCard` تظهر فور اختيار "InstaPay" أو "محفظة إلكترونية" في شاشة الدفع السريع.
  - عرض رمز الـ QR بدقة متناهية على شاشة ماكينة Sunmi V2 Pro أو الشاشة المقابلة للعميل.
  - إبراز المبلغ المطلوب بخط عريض، وعرض رقم الحساب/المحفظة مع زر نسخ لحظي بنقرة واحدة وتنبيه Toast فوري.
  - زر طباعة إيصال التحويل السريع وزر تأكيد استلام التحويل لإنهاء الفاتورة (F2).
- **طباعة باركود السداد على الفواتير الحرارية (`frontend/src/lib/pos-printing/template.ts`):**
  - دعم إدراج قسم رمز QR التحويل أسفل الفاتورة الورقية الحرارية (مقاس 58mm لماكينات Sunmi ومقاس 80mm لطابعات الكاشير القياسية).
  - تباين طباعة ناصع فائق الوضوح بلون أسود صافٍ `#000000` على خلفية بيضاء `#ffffff` لضمان سرعة مسحه بكاميرات كافة الهواتف.
  - خيار تحكم كامل ومرن في الإعدادات `printPaymentQrOnReceipt` لتمكين أو تعطيل طباعة الـ QR توفيراً لرولات الورق الحراري.
- **لوحة الإعدادات وتخصيص بيانات التاجر (`SalesInventorySettingsTab.tsx`):**
  - بطاقة مخصصة في إعدادات المبيعات والمخزون تتيح للتاجر تعديل:
    - حساب / هاتف انستاباي (`instapayAddress`)
    - رقم المحفظة الإلكترونية (`walletNumber`)
    - مزود المحفظة (`walletProviderName`: فودافون كاش، أورنج، اتصالات، وي)
    - رابط بوابة الدفع الخارجي (`paymentLinkBaseUrl`)
    - مفتاح التفعيل اللحظي على شاشة الكاشير (`enableDynamicPaymentQr`)
    - مفتاح الطباعة التلقائية أسفل الفواتير الورقية (`printPaymentQrOnReceipt`)


<!-- migrated:cap-004:end -->

<a id="cap-005"></a>
<!-- migrated:cap-005:start -->
### قدرة: النمط الذكي المزدوج لمسح الباركود بنقاط البيع (Smart Dual-Mode Barcode Scanning Architecture) — ✅ مفعّلة ومكتملة 100% (أكتوبر 2026)
- **التعرف التلقائي على بيئة التشغيل (`frontend/src/shared/utils/hardware-scanner.ts`):**
  - فحص فوري وذكي للبيئة: التمييز التلقائي بين متصفحات الهواتف العادية (iOS / Android Chrome) وماكينات الـ POS العتادية (Sunmi V2 Pro / POS Terminals).
  - كشف ماكينات صن مي عبر الجسور البرمجية المحقونة (`__sunmi_hooked`, `SunmiPrinter`, `SunmiScanner`) والـ User-Agent (`V2_PRO`, `SUNMI`).
- **الموبايل العادي (Personal Smartphones):**
  - استمرار تشغيل محرك الكاميرا الخاص بالمنظومة بكامل كفاءته عبر `CameraBarcodeScannerModal` و `ZXing` لمسح الباركود عبر كاميرا الهاتف دون أي مساس به.
- **ماكينات الـ POS والصن مي (Hardware POS Terminals):**
  - حظر فتح نوافذ الكاميرا البطيئة أو طلب أذونات الكاميرا غير المدعومة بالماكينة.
  - تحويل زر الباركود في شاشة البيع (`PosProductsPanel.tsx`) إلى زر مسح عتادي سريع بأيقونة الباركود الرسمية وتوجيه الكاشير لاستخدام الزر الجانبي (البرتقالي).
  - دعم الاستقبال الفوري للباركود عبر طريقتين متزامنتين:
    1. محاكاة لوحة المفاتيح العتادية (Keyboard Wedge + Instant Enter Handling) في `useScannerBuffer.ts`.
    2. استقبال بث الباركود العتادي المباشر (`com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED`) وإعادة توجيهه للواجهة عبر جسر `listenToHardwareBarcode`.
  - تحديث تطبيق الأندرويد الخفيف `android-app-lite` لدعم أذونات الكاميرا والـ WebChromeClient، واستقبال بث حساس المسح المباشر فور ضغط الزرار البرتقالي الجانبي، وتوليد وتثبيت `Z-POS-Lite.apk`.


<!-- migrated:cap-005:end -->

<a id="cap-029"></a>
<!-- migrated:cap-029:start -->
## 2. نقاط البيع والمبيعات والكاشير (POS & Sales Management)
> 📖 **المرجع القطاعي المستقل والشامل لمود التجارة والتجزئة:** تم استخراج وتوثيق وتفصيل كافة مواصفات، مكونات، واجهات، وهجرات قطاع التجارة والتجزئة ونقاط البيع السريعة والأنشطة التخصصية (الملابس والأزياء والألوان والمقاسات، السوبرماركت، الصيدليات، مراكز الصيانة، معارض التقسيط، وقطع الغيار) في الوثيقة المستقلة: [`RETAIL_COMMERCE_CAPABILITIES.md`](./RETAIL_COMMERCE_CAPABILITIES.md).
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/modules/sales`, `backend/src/modules/sessions`, `backend/src/modules/cash-drawer`, `frontend/src/features/pos`, `frontend/src/features/sales`
* **الجداول في قاعدة البيانات:** `sales`, `sale_items`, `cashier_sessions`, `cash_drawer_transactions`, `pos_drafts`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **شاشة الكاشير السريعة وأنماط العرض (POS Workspace & Sale Modes)** | 🟢 | 100% | `PosWorkspace.tsx`, `PosCart.tsx`, `pos-sale-modes.css` | نمطان رئيسيان للبيع بتصميم مؤسسي نظيف بنظام العمودين المتجاوبين: نمط «سكانر» لمنافذ الباركود السريع والسوبرماركت مع تركيز واسع على السلة، ونمط «تاتش» لشاشات اللمس والأجهزة اللوحية والكاونتر مع شبكة بطاقات بصرية، مع تجاوب تلقائي وسلس لكافة مقاسات الشاشات والموبايل. |
| **طرق الدفع المتعددة والمجزأة والاحتساب الذكي للباقي النقدي** | 🟢 | 100% | `PaymentModal.tsx`, `PosCheckoutExpressSection.tsx`, `usePosWorkspaceState.ts`, `createPosWorkspaceAsyncActions.ts`, `sales.service.ts` | نقدي، فيزا/ماستركارد، آجل، محافظ إلكترونية، مع إمكانية تجزئة الفاتورة الواحدة بين أكثر من طريقة دفع؛ واجهة الدفع السريع المحدثة (Express Checkout) تعتمد تلقائياً المبلغ الإجمالي المطلوب افتراضياً بنقرة واحدة (Zero-Click Exact Cash) مع خانة إدخال حرة مخصصة لكتابة المبلغ المستلم من العميل (مثل 100 أو 200)، واختصارات سريعة للفئات الورقية الحقيقية في التداول، واحتساب لحظي للباقي بلون أخضر مميز، وتمرير المبلغ المستلم والباقي تلقائياً لمحرك الفاتورة وإيصال الطباعة وشاشة النجاح. |
| **تعليق واسترجاع الفواتير (Park/Hold Cart)** | 🟢 | 100% | `pos-drafts`, `HoldCartModal.tsx` | تعليق الفاتورة لخدمة زبون آخر واسترجاعها بضغطة زر واحدة. |
| **الورديات والجلسات النقدية (Shifts)** | 🟢 | 100% | `sessions.service.ts`, `CashDrawerPage.tsx`, `CashDrawerFormsPanel.tsx`, `ShiftModal.tsx`, `PosOpenShiftModal.tsx` | فتح الوردية برصيد افتتاحي، إغلاق الوردية، جرد الكاش الفعلي، ربط زر إغلاق الوردية في الكاشير بالبوب اب المباشر فورياً عبر `?action=close`، وحساب العجز والزيادة تلقائياً.<br/>**تحصين سبتمبر 2026:** العد الأعمى مفروض على **حمولة الـAPI** لا على الواجهة (الخادم يُصفّر الحقول المالية لدور الكاشير، وإغلاق الكاشير يُحوَّل لحالة `pending_review` تتطلب مراجعة مدير). فرق الوردية يُقيَّد فوراً بقيد مزدوج متزن داخل نفس المعاملة، ويُمنع تصافي العجز مع الزيادة (حسابان مختلفان: عجز 7200 / زيادة 7100). أُضيف مسار تسوية حقيقي: العجز **فوق حد التسامح** (`settings.cashierShortageTolerance`، افتراضه صفر) يُحمَّل كذمة مدينة على أمين الصندوق (حساب 1135) باسمه في الأستاذ المساعد بدل شطبه كمصروف، مع تسجيل `variance_resolution` و`variance_journal_entry_id` والمعتمِد (هجرة 108). كما صُحِّح تحديث ضائع في حركات الخزينة (الإدراج وإعادة الحساب والتحديث كانت خارج أي معاملة).<br/>**تحديث أكتوبر 2026:** إضافة خيار اختياري في الإعدادات (`requirePasswordOnShiftOpen`) لاشتراط التحقق من كلمة مرور المستخدم الحالي أو رمز المدير عند فتح الوردية وتأكيد رصيد البداية في شاشة نقطة البيع (`PosOpenShiftModal`) وشاشة ورديات الدرج (`CashDrawerFormsPanel`) لتعزيز الأمان والرقابة على الأجهزة المشتركة. |
| **حركات درج النقدية والمصروفات النثرية** | 🟢 | 100% | `cash-drawer.service.ts`, `CashDrawerModal.tsx` | تسجيل سحب نقدية، إيداع نقدية، دفع مصروفات من الدرج، مع ترحيلها لقيود اليومية. |
| **إلغاء ومرتجع الفواتير وصلاحيات المدير** | 🟢 | 100% | `returns.service.ts`, `manager-actions.service.ts` | مرتجع كامل أو جزئي، طلب إذن المدير للخصومات أو الإلغاء، وتأثير المرتجع على المخزون والخزينة. |
| **طباعة الفواتير والإيصالات الحرارية والمحرك العتادي المباشر لماكينات الكاشير الذكية** | 🟢 | 100% | `pos-printing.ts`, `pos-printing/hardware.ts`, `pos-printing/template.ts`, `escpos-printer.ts`, `PosRecentSalesReprintModal.tsx` | دعم طابعات الإيصالات (80mm و 57mm)، طباعة A4، ومحرك طباعة عتادي ذكي وشامل (Universal Hardware Print Engine) يدعم كافة ماكينات نقاط البيع الذكية (Sunmi V2 / PAX / Nexgo / ESC-POS Port 9100) عبر الفحص الآلي الصامت (Zero-Dialog Silent Print خلال ~200ms) مع استرجاع تلقائي آمن لنافذة طباعة المتصفح لأجهزة الكمبيوتر العادية، بالإضافة لإعادة الطباعة السريعة (F9 لآخر فاتورة وقائمة آخر 5 فواتير) بتصميم مؤسسي نظيف وأزرار مدمجة وخالٍ من البانرات القاتمة. |
| **البيع بدون إنترنت والمزامنة الذكية (Offline POS & Multi-Cashier Smart Caching)** | 🟢 | 100% | `usePosOfflineSync.ts`, `pos-offline-sync.ts`, `pos-catalog-storage.ts`, `usePosCatalogWarmup.ts`, `usePosCatalog.ts`, `PosOfflineQueueModal.tsx`, `lazy-route.tsx`, `CashDrawerFormsPanel.tsx` | منظومة بيع أوفلاين متكاملة: ترقيم وثائقي موحد متعدد الكاشيرات وفق الدستور مع كود طرفية مميز لكل جهاز (`INV-${terminal}-${dateStr}-${seq}`) لمنع أي تعارض، تخزين محلي دائم في IndexedDB يستوعب أكثر من 20,000 صنف، تحمية ذكية بالخلفية (Background Warmup) تسحب الأصناف تلقائياً عند الفتح وتفحص تحديثات الأسعار والأصناف عبر نبضات خفيفة للغاية (<50 بايت) بدون استهلاك رامات وبزمن قراءة 1-2ms للباركود، حماية التنقل بين الشاشات بدون إنترنت، استعادة الجلسة بأمان، نافذة إدارة ومراجعة الفواتير المعلقة، تنبيه ومنع إغلاق الوردية قبل ترحيل الفواتير المعلقة، ومزامنة ذكية تلقائية فور عودة الاتصال مع معالجة القيود المحاسبية الآمنة بتصميم مؤسسي نظيف.<br/>**تصحيح حرج سبتمبر 2026:** كان النص السابق يصف «تجديد مفاتيح الـ Idempotency» عند إعادة المحاولة كأنه ميزة — **وهو في الحقيقة كان يُنتج فواتير مكررة**: عند رد الخادم بـ409 (الطلب الأصلي ما زال قيد التنفيذ) أو 422 (حجز قديم قد يكون رُحِّل فعلاً) كانت الواجهة تولّد مفتاحاً عشوائياً جديداً وتُعيد الإرسال، فتُرحَّل الفاتورة مرتين ويُخصم المخزون مرتين ويتضاعف الإيراد. **القاعدة الآن: `sale.id` هو مفتاح الإدمبوتنسي المستقر ولا يُستبدل أبداً**؛ عند 409 تبقى الفاتورة في الطابور ويُعاد الإرسال لاحقاً **بنفس المفتاح**، وعند 422 يُستعلم الخادم عن الحالة الفعلية (`GET /api/operations/:type/:key/status`) فإن كانت مُرحَّلة تُشطب من الطابور، وإن تعذر التأكد تُعلَّم `failed` للمراجعة اليدوية بدل التخمين. |
| **توجيه المخزون الذكي ورسائل الرصيد التفاعلية** | 🟢 | 100% | `sales-write.service.ts`, `createPosWorkspaceAsyncActions.ts` | عند عدم كفاية الرصيد في المخزن الحالي، يقوم النظام ديناميكياً بفحص سائر المخازن وعرض رسالة ترشد الكاشير لاسم المخزن الحالي ورصيده، مع بيان المخازن البديلة التي يتوفر بها الصنف وكمياتها. |
| **فك وتشفير باركود الميزان الوزني في الكاشير ونقاط البيع والمبيعات (Universal Weighted Barcode Resolution)** | 🟢 | تحقق مستهدف 2026-11-15 | `shared/lib/weighted-barcode.ts`, `pos/lib/weighted-barcode.ts`, `pos-remote-weighted-barcode.ts`, `pos-barcode-lookup.helper.ts`, `PosProductsPanel.tsx`, `PosWorkspace.tsx`, `CreateSalesOrderPage.tsx`, `sales-order-barcode-scan.ts` | تشغيل شامل لباركود الميزان طالما `weightedBarcodeEnabled = true` عبر كافة مودات التجزئة (`scanner`, `touch`) وأنشطة النظام (`AppsStorePage`, `SettingsMainForm`, `modular-presets`, `CreateSalesOrderPage`) دون ربط بـ `posModuleEnabled`. يشمل تطبيع الأرقام العربية (`٠-٩`)، البحث بالباركود أو `sku` أو `style_code` أو باركود الوحدة مع تكافؤ الأصفار البادئة (مثل `'9'` ↔ `'00009'`) وإزالة البحث النصي المضلل `q` (`LIMIT 5`)، الإرسال التلقائي في `useScannerBuffer` بدون `Enter`، السقوط الآمن على IndexedDB دون إنترنت، والحفاظ على رسائل رفض الرصيد أو عدم تطابق السعر بدل استبدالها برسالة «لم يتم العثور». |
| **إشعارات الواتساب الفورية للمالك عند إغلاق الوردية والمرتجعات (Shift Close & Refund WhatsApp Alerts)** | 🟢 | 100% | `whatsapp-gateway.service.ts`, `cash-drawer.service.ts`, `returns.service.ts` | إرسال رسالة واتساب تلقائية فورية للمالك عند إغلاق أي كاشير للوردية (تتضمن اسم الكاشير، الفرع، رصيد الافتتاح، مبيعات الكاش، العجز/الزيادة، وملاحظات الإغلاق)، بالإضافة لإشعار فوري عند إجراء أي مرتجع مبيعات نقدي. |
| **شاشة متابعة المالك المتنقلة (Owner Mobile Companion PWA)** | 🟢 | 100% | `OwnerCompanionPage.tsx`, `app-shell.tsx` | لوحة متابعة مصممة خصيصاً لهاتف المالك لمراقبة المبيعات الحية، الورديات المفتوحة، وتنبيهات النواقص، مع دعم التثبيت المباشر كتطبيق PWA بنقرة واحدة دون الحاجة لمتاجر التطبيقات. |
| **تكامل ماكينات الدفع البنكي الذكية في الكاشير وبروتوكول الربط المالي (Smart POS Terminal & Multi-Terminal ECR Financial Protocol)** | 🟢 | 100% | `pos-terminal.service.ts`, `pos-terminal.controller.ts`, `PosCheckoutDialogSections.tsx`, `PosCheckoutDialog.tsx`, `SalesInventorySettingsTab.tsx`, `pos-printing/template.ts`, `pos.api.ts`, `hardware-bridge-client.ts`, `tools/z-systems-bridge/` (`Program.cs`, `bridge-server.js`, `pax-driver.js`, `geidea-driver.js`, `escpos-driver.js`, `diagnostics.html`), `android-app/` (`PaymentActivity.java`, `EcrServerService.java`, `SunmiPrinterHelper.java`, `build.ps1`), `tools/pos-terminal-simulator/` (`simulator-server.js`, `public/index.html`, `launch-sunmi-simulator.ps1`), `2040000000211_pos_terminal_ecr_metadata.ts` | منظومة متكاملة لبروتوكول الربط المالي المباشر (ECR Direct Protocol) مع ماكينات الدفع البنكية الذكية لكافة دول الخليج ومصر: Geidea POS (شبكة مدى / السعودية)، KNET POS (أجهزة الدفع كي نت / الكويت)، Network International (أجهزة الدفع البنكي / الإمارات)، Fawry POS / PAX و Paymob Smart POS (مصر)، وماكينات Sunmi V2 Pro عبر تطبيق أندرويد متكامل وتطبيق C# Native Service؛ دعم ربط وتوصيل ماكينات دفع إلكتروني متعددة (Multi-Terminal ECR) على نفس نقطة البيع مع إمكانية إضافة وحذف وتعيين الماكينة الافتراضية، واختيار الماكينة المستهدفة لحظياً أثناء الدفع في شاشة الكاشير؛ قناة تتابع سحابي متقدمة (Outbound HTTPS Cloud Relay) تعتمد على الاستطلاع الممتد (Long-Polling) لتخطي كافة حواجز أمان المتصفح (Mixed Content & Private Network Access) وتمكين المنصة السحابية الموزعة (Cloud SaaS) من إرسال مبالغ الدفع بدقة القروش والجنيهات للماكينات المحلية فورياً؛ شاشة دفع تفاعلية كاملة على ماكينات الصن مي والأندرويد (`PaymentActivity`) تعرض المبلغ والعد التنازلي وتتيح التأكيد والإلغاء وتدعم ملامسة بطاقات NFC والتنبيهات الصوتية؛ دعم كامل لأوامر الإلغاء الفوري ثنائية الاتجاه (Bidirectional Remote Cancel) لإغلاق شاشة الدفع بالماكينة فور إلغائها من الكاشير؛ قراءة واعتماد الدفع اللحظي الصارم وحظر الموافقات الوهمية (Zero-Mock Auto-Approvals) وقيد كود التفويض البنكي (AUTH Code) ورقم المرجع البنكي (RRN) ونوع شبكة البطاقة (مدى / كي نت / فيزا / ماستركارد / ميزة) وآخر 4 أرقام من البطاقة (PAN) وتخزينها في قاعدة البيانات مع طباعة إيصال الدفع الإلكتروني الرسمي (EDC Slip) على طابعة الماكينة وطابعة الفواتير. |
| **استيراد المبيعات الخارجية (Bulk Sales Import)** | 🟢 | 100% | `import-sales.service.ts`, `import-sales` | استيراد فواتير مبيعات سابقة من ملفات Excel و CSV مع التحقق والمطابقة. |
| **هيدر الكاشير الذكي وقائمة الوردية الموحدة وتجاوب الموبايل (POS Workspace Header, Unified Shift Dropdown & Mobile Responsiveness)** | 🟢 | 100% | `PosWorkspaceHeader.tsx`, `PosSaleSuccessDialog.tsx`, `mobile-layout.css`, `hardware-bridge-client.ts`, `PosTablesFloorPlanDialog.tsx`, `PosWorkspace.tsx` | تصميم متطور ومضغوط لشريط هيدر نقطة البيع في سطر واحد دون التفاف (Zero-Wrap Single Row Toolbar) يلائم الشاشات من 14 إلى 32 بوصة؛ إزالة زر «فتح الدرج» المستقل من شريط الهيدر الرئيسي نهائياً مع تفعيل فتح الدرج التلقائي الصامت فور إتمام أي فاتورة نقدية (Auto Cash Drawer Kick) عبر تطبيق الديسكتوب (Electron) أو جسر العتاد المحلي (`HardwareBridgeClient` على `127.0.0.1:18181`)؛ دمج «تقرير الوردية اللحظي (X)» والفتح اليدوي المشروط للدرج (No-Sale للطوارئ بعد اعتماد المشرف) وإغلاق الوردية (Z) داخل زر مدمج ذكي منسدل بجوار «تقفيل الوردية» مع دعم النقر الخارجي وأيقونات SVG مؤسسية رصينة (0 Emojis)؛ دعم كامل لتجاوب الموبايل والشاشات الصغيرة (< 900px) بإخفاء الأزرار وأدوات الطاولات والأجهزة الثانوية لضمان بقاء الهيدر في سطر واحد رشيق وخالٍ من التكسير أو الازدحام. |
| **شاشة العميل الرقمية (POS Customer-Facing Display)** | 🟢 | 100% | `CustomerFacingDisplayPage.tsx`, `pos-customer-display.css`, `usePosWorkspace.ts` | شاشة مستقلة موجهة للعميل تعرض تفاصيل السلة الحالية والأسعار والعروض التسويقية وتحديث السلة آنياً بنظام البث المحلي/المزامنة. |
| **شاشات العروض الرقمية والأسعار (Digital Signage & Price Board)** | 🟢 | 100% | `DigitalSignagePage.tsx`, `SignageHeader.tsx`, `SignageNavDrawer.tsx`, `sales/routes.tsx`, `app-shell.tsx` | لوحة عرض تفاعلية ترويجية لقوائم الأسعار والعروض الترويجية في صالة العرض مع تحديث ديناميكي للمنتجات والأسعار، مزودة بزر عودة فوري للنظام ولوحة التحكم وزر دروج جانبي سحابي للتنقل السريع بين أقسام المنظومة وحماية نسخة الديسكتوب (Electron) من الاحتجاز مع دعم زر Esc. |
| **مكتب طلبات الهاتف والتوصيل السريع وكاشف المتصل (Phone Order Desk, Caller ID, Doorstep Payments & Delivery Zones)** | 🟢 | 100% | `PosPhoneOrderDialog.tsx`, `PosCallerIdFloatingAlert.tsx`, `pos-caller-id-service.ts`, `ModulesSettingsTab.tsx`, `settings.service.ts`, `partners.service.ts`, `partners.controller.ts`, `delivery-reps.api.ts` | بيئة متكاملة وشاملة لطلبات الهاتف والتوصيل السريع بمستوى كبرى سلاسل المطاعم وفق المعيار الذهبي العالمي (Foodics / Domino's Pulse / Toast): بحث تنبؤي ذكي يبدأ بعد 6 أرقام للهاتف (لتجاوز تشابه كود شركات المحمول 010/011/012/015) أو حرفين للاسم، شبكة بطاقات متطابقة لاختيار العميل بدقة دون استعجال فتح الملف، تفعيل فوري لملف العميل الكامل ومساحة العمل التشغيلية عند المطابقة التامة 1-to-1 أو الاختيار الصريح، استرجاع فوري لملف العميل ونقاط الولاء والعناوين السابقة ووسم العناوين (المنزل/العمل/أخرى)، سجل تفصيلي لآخر الطلبات مع ميزة تكرار الطلب بضغطة واحدة (1-Click Reorder)، تحديد مناطق ورسوم التوصيل ووقت الوصول التقديري (ETA)، تحديد طريقة الدفع عند الاستلام (كاش مع حساب الفكة المطلوبة للطيار / فيزا مع ماكينة POS المحمولة / إنستاباي ومحفظة)، تعيين مندوب التوصيل المتاح، سجل مباشر للمكالمات الواردة الأخيرة (Caller ID Log) مع فتح الطلب الفوري، ربط أجهزة كاشف المتصل (USB Serial Caller ID) ومحاكي الرنين مع تنبيهات صوتية ومرئية ودعم اختصار F7 المباشر و Alt+P / Alt+D، مع خيار تشغيل/إيقاف مخصص في إعدادات الموديولات (`phoneOrdersModuleEnabled`) وتفعيل ذكي تلقائي للأنشطة المعتمدة على التوصيل (مطاعم، صيدليات، سوبرماركت)، مع تصميم مضغوط عالي التوافق يلائم كافة مقاسات الشاشات من 14 بوصة إلى 32 بوصة بدون أي سكرول خارجي (Zero-Scroll Layout). |
| **أوامر البيع وحجز المخزون (Sales Orders & Stock Reservation)** | 🟢 | 100% | `CreateSalesOrderPage.tsx`, `SalesOrdersPage.tsx`, `sales-order.service.ts` | تحويل كامل لشاشة إنشاء وتعديل أوامر البيع إلى صفحة مخصصة متكاملة وفق معيار UniversalDocumentFormTemplate بدلاً من النوافذ المنبثقة، تتضمن اختيار العميل، تواريخ التسليم والشحن، حجز المخزون التلقائي، شريط الأدوات السريع، جدول بنود تفاعلي يعرض الرصيد المتاح بالمخزن، وحسابات الإجماليات والخصم والضرائب بنظام التقسيم 60/40. |
| **عروض أسعار العملاء (Customer Quotations)** | 🟢 | 100% | `CreateQuotationPage.tsx`, `QuotationsPage.tsx`, `quotations.service.ts` | تحويل شاشة إنشاء عروض الأسعار إلى صفحة كاملة مخصصة وفق معيار UniversalDocumentFormTemplate بدلاً من النوافذ المنبثقة، تتضمن اختيار العميل، تواريخ العرض وفترة الصلاحية، شريط الأدوات السريع، جدول بنود تفاعلي بأسعار الوحدات والضرائب والخصومات، الشروط والأحكام التعاقدية، والمرفقات مع كارت ملخص الإجماليات بنظام التقسيم 60/40. |
| **ربط وصفات الإضافات بالمواد الخام والخصم المخزني التلقائي (F&B Modifier Recipe & Raw Material Depletion)** | 🟢 | 100% | `ModifierGroupModal.tsx`, `ProductModifiersPage.tsx`, `ModifierGroupCard.tsx`, `addons.service.ts`, `sales-write.service.ts` | ربط خيارات الإضافات والمعدلات بالمواد الخام والمستودعات في واجهة المستخدم، وتحديد كمية ووحدة الاستهلاك، مع شارات الخصم المخزني على بطاقات الإضافات، والخصم التلقائي اللحظي من المخزون مع كل بيع وامتصاص التكلفة بدفتر الأستاذ. |
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/modules/inventory`, `backend/src/modules/catalog`, `frontend/src/features/inventory`, `frontend/src/features/products`
* **الجداول في قاعدة البيانات:** `products`, `product_units`, `product_categories`, `warehouses`, `inventory_transactions`, `stock_adjustments`, `stock_transfers`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **دليل المنتجات والوحدات المتعددة** | 🟢 | 100% | `catalog.service.ts`, `ProductsPage.tsx` | صنف مع وحدات متعددة (قطعة/كرتونة مع معامل التحويل)، وسعر وتكلفة لكل وحدة. |
| **المستودعات المتعددة (Multi-Warehouse)** | 🟢 | 100% | `inventory.service.ts`, `WarehousesPage.tsx` | تعريف عدة مخازن وفروع، وتحديد رصيد كل صنف في كل مخزن على حدة. |
| **التحويلات المخزنية بين الفروع والمستودعات** | 🟢 | 100% | `stock_transfers`, `inventory-transfer.service.ts`, `TransfersPage.tsx` | نقل بضاعة بين المخازن عبر مخزن ترانزيت حقيقي (`in_transit`) مع دورة اعتماد وتحديث الأرصدة تلقائياً.<br/>**تحصين سبتمبر 2026 (المرحلة 3):** كان `stock_transfer_items` يحمل كمية واحدة (`qty`) فقط، فكانت الوجهة **مضطرة لاستلام ما أُرسل بالضبط** ولا سبيل لتسجيل فاقد النقل — إرسال 100 واستلام 98 كان يترك الوحدتين عالقتين في مخزن الترانزيت إلى الأبد كرصيد وهمي لا يجرده أحد. أُضيفت `dispatched_qty`/`received_qty`/`variance_qty` (هجرة 114) بقيد `CHECK` يضمن `received ≤ dispatched` وأن الفرق مطابق؛ وعند الاستلام تخرج الكمية المُرسلة **كاملة** من الترانزيت، فيدخل المستلَم للوجهة ويُشطب العجز كحركة `transfer_transit_loss` **تُنقص الرصيد العام** (البضاعة غادرت المصدر ولم تصل فعلاً). |
| **أذون التسوية والإضافة والصرف المخزني** | 🟢 | 100% | `stock_adjustments`, `AdjustmentsPage.tsx` | إثبات الهالك، بضاعة تالفة، عجز مخزني، أو بضاعة مهداة مع الترحيل المحاسبي. |
| **الجرد الفعلي الدوري والمفاجئ** | 🟢 | 100% | `StockCountPage.tsx`, `inventory-count.service.ts` | جرد المخزون الفعلي ومقارنته بالدفتري واستخراج فروق الجرد وتوليد تسوية فورية. يلتقط لقطة `expected_qty` عند فتح الجلسة ويُعيد التحقق منها عند الترحيل فيرفض الترحيل إن تحرك الرصيد أثناء العد (حماية تزامن صحيحة). |
| **جرد تسوية عداد المخزون العام (Global Stock Counter Reconciliation)** | 🟢 | 100% | `2040000000115_stock_global_counter_reconciliation.ts`, `stock_reconciliation_log` | **عملية لمرة واحدة** لإصلاح الانحراف التاريخي بين `products.stock_qty` ومجموع `product_location_stock`. سببه أن مسارات سابقة (بيع السيارات، استلام أوامر الشراء) كانت تكتب أرصدة المواقع دون المساس بالعداد العام؛ المسارات أُصلحت لكن **الانحراف المتراكم لا يُشفى ذاتياً**. مصدر الحقيقة هو مجموع أرصدة المواقع شاملاً الرصيد غير المخصص — وهو نفس تعريف `trueGlobalQty` داخل `applyStockDelta` فيتطابق الطرفان بالبناء بعدها. **ضمانات الأمان:** كل تصحيح يُسجَّل في `stock_reconciliation_log` قبل تطبيقه · الأصناف التي لها رصيد عام بلا أي صف موقع **تُحفَظ على الرصيد غير المخصص ولا تُصفَّر** (الحذف كان سيكون إتلافاً) · تأكيد بعدي يرمي استثناءً إن بقي أي انحراف · `down()` يستعيد الأرصدة السابقة من السجل · وإعادة التشغيل لا تُصحِّح شيئاً إضافياً بعد التطابق. |
| **تنبيهات النواقص والحد الأدنى للطلب** | 🟢 | 100% | `LowStockAlerts.tsx`, `inventory.service.ts` | كشف الأصناف التي قاربت على النفاد بناءً على حد إعادة الطلب. |
| **حركة كارت الصنف التفصيلية (Stock Card)** | 🟢 | 100% | `ProductHistoryModal.tsx` | تتبع كل حركة دخول وخروج ورقم الفاتورة والرصيد المتبقي للصنف بالتاريخ والوقت. |
| **تصدير وبرمجة موازين الباركود الإلكترونية (Scale PLU Export Engine)** | 🟢 | 100% | `ScalePluExportModal.tsx`, `ProductsWorkspace.tsx` | توليد وتصدير ملفات الأصناف والأسعار المتوافقة بضغطة زر لمختلف موازين الباركود الأكثر انتشاراً في السوق: Rongta (RLS1000 / RLink)، CAS (CL5000 / CL-Works)، Dibal (Series 500 / Wind)، وملف Universal Excel/CSV، مع ترقيم الـ PLU التلقائي، وتطبيع طول الأكواد، وإرشادات التنزيل المباشر للميزان. |
| **أرقام التشغيلات وتواريخ الصلاحية ونظام FEFO** | 🟢 | 100% | `pharmacy_batches`, `sales-write.service.ts`, `PharmacyBatchesExpiryPage.tsx` | تتبع رقم التشغيلة (Batch) وتاريخ الانتهاء، وصرف الأسبق انتهاءً تلقائياً في الكاشير مع حظر بيع المنتهي الصلاحية نهائياً (انظر تفاصيل الوحدة 13). |
| **تتبع التشغيلات وتواريخ الصلاحية الشامل لكافة الأنشطة (Universal Batches & Expiry)** | 🟢 | 100% | `InventoryBatchesPage.tsx`, `purchases-write.service.ts`, `pharmacy.service.ts`, `inventory/routes.tsx` | شاشة شاملة لإدارة وتتبع أرقام التشغيلات وتواريخ الانتهاء في المخازن العامة للصيدليات والأغذية والتوزيع والتجزئة عبر المسار `/inventory/batches`، وتحديث تلقائي لبيانات التشغيلة عند الشراء، مع مؤشرات ذكية وتمديد الصلاحية السريع (+3M, +6M, +1Y, +2Y). |
| **مركز التسعير الجماعي ومحاكاة الأثر المالي (Batch Pricing Center & Financial Simulation)** | 🟢 | 100% | `PricingCenterPage.tsx`, `PricingScopeFormulaSection.tsx`, `PricingSimulationSection.tsx`, `PricingPreviewTableSection.tsx`, `PricingRunsHistorySection.tsx`, `pricing.service.ts` | محرك تسعير جماعي ذكي ومتقدم للأصناف عبر المسار `/pricing-center`، يشمل تحديد نطاق الأصناف حسب المورد أو القسم أو نوع الصنف، ومعادلات زيادة أو تخفيض الأسعار (نسبة، قيمة ثابتة، هامش ربح من التكلفة) مع قواعد التقريب الذكية، وشاشة محاكاة مالية فورية متجاوبة جنباً إلى جنب مع نطاق التسعير لاحتساب أثر التعديل على قيمة المخزون وهوامش الربح وفحص أمان التكلفة، وجدول معاينة تفصيلي لقبل وبعد، مع سجل تدقيق كامل لموجات التسعير وإمكانية التراجع الفوري بضغطة زر. |
| **توليد وطباعة ملصقات الباركود والرف التموينية وبطاقة بيان السلع (Barcode & Regulatory Shelf Label Printing Engine)** | 🟢 | 100% | `BarcodePrintDialog.tsx`, `barcode-labels.ts`, `internal-detail-review.css`, `ProductsWorkspace.tsx`, `ProductsTableCard.tsx`, `PurchaseDetailCard.tsx` | نافذة توليد وطباعة ملصقات الباركود والرفوف المتطورة المتوافقة مع معيار ملاءمة الشاشات (Zero-Scroll Standard)؛ دعم متكامل لكافة طابعات الرول الحراري وشيتات الـ A4 اللاصقة، إدراج استيكرات الرفوف التموينية القانونية (60×30 مم و 70×35 مم) بخطوط عريضة للسعر وعبارة "شامل الضريبة المضافة" وفق القرار الوزاري 330 لسنة 2017، بطاقة بيان السلع الغذائية والمعبأة المكتملة قانونياً لحماية المتاجر والسوبرماركت ومحامص العطارة من محاضر التموين والسلع مجهولة المصدر: (تاريخ الإنتاج، تاريخ التعبئة، فترة الصلاحية بالشهور أو تاريخ انتهاء صريح، بيان الوزن الصافي الرسمي "صافي: X" وفق المواصفة القياسية المصرية 2613 لسنة 2008، وشروط وتعليمات التخزين بقوالب سريعة للأغذية الجافة والمبردة والمجمدة)، ميزة الطباعة المجمعة للأصناف المحددة من جدول المنتجات بضغطة زر مع ضبط كميات النسخ، والطباعة المباشرة لملصقات باركود كافة بنود فواتير المشتريات بالكميات المستلمة أو المطلوبة فورياً. |



---


<!-- migrated:cap-029:end -->

<a id="cap-053"></a>
<!-- migrated:cap-053:start -->
## 27. شاشة عرض العميل المقابلة للكاشير (Customer Facing Display - CFD)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **أنواع البيانات والبريدج:** `frontend/src/features/pos/types/pos-customer-display.types.ts`, `frontend/src/features/pos/lib/pos-customer-display-bridge.ts`
  * **البث والمزامنة الحية:** `frontend/src/features/pos/hooks/usePosCustomerDisplayBroadcaster.ts`, `frontend/src/features/pos/hooks/usePosWorkspace.ts`
  * **واجهة العرض المستقلة:** `frontend/src/features/pos/pages/CustomerFacingDisplayPage.tsx`, `frontend/src/styles/partials/pos-customer-display.css`
  * **التحكم والروابط:** `frontend/src/features/pos/components/pos-workspace/PosWorkspaceHeader.tsx`, `frontend/src/app/router/root-router.tsx`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **شاشة خمول وترويج رقمية تفاعلية (Idle Digital Signage & Branding)** | 🟢 | 100% | `CustomerFacingDisplayPage.tsx`, `pos-customer-display.css` | شاشة متطورة تعزز هوية المتجر أثناء خمول الكاشير؛ تتضمن ترويسة بشعار واسم المتجر والفرع، ساعة وتاريخ رقمي مباشر باللغة العربية، بطاقة ترحيب فندقية راقية، وشبكة عروض ترويجية تفاعلية دوارة كل 6 ثوانٍ تروج للخصومات ونقاط الولاء وخدمات التوصيل. |
| **مزامنة حية وفورية لسلة المشتريات (Sub-millisecond Realtime Cart Sync)** | 🟢 | 100% | `usePosCustomerDisplayBroadcaster.ts`, `pos-customer-display-bridge.ts`, `CustomerFacingDisplayPage.tsx` | ربط محلي لحظي صفر-لاغ (0ms Latency) يعتمد على `BroadcastChannel` المدمجة في المتصفح مع دعم احتياطي عبر `localStorage`؛ يعرض قائمة الأصناف الممسوحة لحظة بلحظة مع شارات الكميات، أسعار الوحدات، الإجمالي لكل بند، مع تأثير وميض بصري أخضر نابض على آخر صنف تمت إضافته. |
| **شارة ترحيب العميل ونقاط الولاء (Customer Loyalty Welcome Pill)** | 🟢 | 100% | `usePosCustomerDisplayBroadcaster.ts`, `CustomerFacingDisplayPage.tsx` | عند اختيار العميل في شاشة الكاشير تظهر فورياً شارة ترحيبية خضراء في شاشة الزبون باسم العميل ورصيد نقاط المكافآت والولاء المتاحة له لاستبدالها. |
| **توليد رمز الدفع السريع بالـ QR الذكي (Instant Dynamic QR Payment)** | 🟢 | 100% | `qrcode.ts`, `CustomerFacingDisplayPage.tsx`, `pos-customer-display.types.ts` | توليد فوري لرمز الاستجابة السريعة (Pure SVG QR Code) بمبلغ الفاتورة المحدد عند الانتقال لمرحلة السداد؛ يتيح للعميل مسح الكود بهاتفه للدفع المباشر عبر تطبيق إنستاباي (InstaPay) أو المحافظ الإلكترونية (فودافون كاش، اتصالات...) دون الحاجة لأي خدمات خارجية أو إنترنت، مع حساب تفصيلي للنقدية والمتبقي المسترد للعميل. |
| **شاشة الاحتفال بنجاح الفاتورة (Checkout Celebration & Change Summary)** | 🟢 | 100% | `CustomerFacingDisplayPage.tsx`, `pos-customer-display.css` | فور إتمام الفاتورة بواسطة الكاشير، تتحول شاشة العميل تلقائياً إلى بطاقة احتفالية خضراء فخمة («تمت عملية الشراء بنجاح! 💚 شكراً لتسوقكم معنا»)، مع إبراز رقم الفاتورة، المبلغ الإجمالي، المبلغ المدفوع، والمتبقي المسترد للعميل بخط عريض جداً ومميز، مع رجوع تلقائي سلس لشاشة الترويج بعد 12 ثانية أو عند بدء عملية بيع جديدة. |
| **زر التشغيل والتحكم المباشر من الكاشير (One-Click POS Header CFD Launcher)** | 🟢 | 100% | `PosWorkspaceHeader.tsx`, `pos-customer-display-bridge.ts` | زر مباشر ومميز في شريط أدوات الكاشير العلوي «شاشة العميل 🖥️» يتيح فتح الشاشة المقابلة بضغطة زر واحدة على الشاشة الثانوية الممتدة (Extended Display) أو جهاز التابلت المقابل، مع إمكانية ملء الشاشة الكامل (Fullscreen Mode) وإخفاء أي أشرطة متصفح. |

---


<!-- migrated:cap-053:end -->

<a id="cap-057"></a>
<!-- migrated:cap-057:start -->
## 32. رادار كشف تلاعب وسرقات الكاشير ومنع الخسائر (Cashier Loss Prevention & Fraud Audit Radar) 🕵️‍♂️🚨
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **الباك إند والخدمات:** `backend/src/modules/sales/services/cashier-fraud-radar.service.ts`, `backend/src/modules/sales/controllers/cashier-fraud-radar.controller.ts`, `backend/src/modules/sales/services/sales-write.service.ts`, `backend/src/modules/sales/sales.module.ts`
  * **الفرونت إند والواجهات:** `frontend/src/features/audit/api/cashier-fraud-radar.api.ts`, `frontend/src/features/audit/components/CashierFraudRadarSection.tsx`, `frontend/src/features/audit/pages/AuditPage.tsx`
* **الجداول في قاعدة البيانات:** `audit_logs`, `sales`, `sale_items`, `users`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **رصد وتتبع الأنماط المشبوهة في نقاط البيع (Suspicious POS Telemetry)** | 🟢 | 100% | `sales-write.service.ts`, `cashier-fraud-radar.service.ts` | التقاط فوري لعمليات: (1) حذف الأصناف من السلة بعد مسحها بالباركود (`cart_remove`)، (2) إلغاء الفواتير المسودة قبل الحفظ (`draft_cancel`)، (3) الفواتير الملغاة رسمياً (`sale_cancelled`)، (4) تجاوزات الخصومات اليدوية (`discount_override`)، مع تسجيل اسم الصنف وقيمته وسببه.<br/>**تحصين سبتمبر 2026:** كان الرادار يكشف الأحداث بـ**مطابقة نصوص عربية** على عمود `action` (`LIKE '%خصم%'`, `'%حذف عنصر من السلة%'`) في ثلاثة مواضع (`getSummary`, `getEvents`, `checkAndAlertAnomaly`) — أي أن **إعادة صياغة رسالة سجل تدقيق واحدة كانت تُعمي الرادار بصمت**. أُضيف عمود `audit_logs.event_code` مع ثوابت `AUDIT_EVENT_CODES` ودالة تصنيف موحدة `classifyRadarEvent` (هجرة 109)، وتم **ترحيل السجلات التاريخية** بأكوادها حتى لا تضيع الكشوف السابقة؛ ومطابقة النص بقيت **فقط** للصفوف القديمة التي لا تحمل كوداً (`event_code IS NULL`). القاعدة الآن: أي كشف جديد يُضاف بكود ثابت لا برسالة. |
| **خوارزمية مؤشر الخطر الذكية لكل كاشير (Cashier Risk Score 0-100)** | 🟢 | 100% | `cashier-fraud-radar.service.ts`, `CashierFraudRadarSection.tsx` | احتساب مؤشر خطورة مركب لكل كاشير يجمع أوزان الأحداث المشبوهة، مع تطبيعه وفق حجم مبيعات الكاشير الناجحة لتجنب الظلم وتصنيف الكاشيرات إلى: 🟢 طبيعي وآمن، 🟡 تحت الملاحظة (30%-59%)، 🔴 عالي الخطورة (&ge; 60%). |
| **إنذار استباقي وفوري عبر الواتساب للمالك عند الاشتباه** | 🟢 | 100% | `cashier-fraud-radar.service.ts`, `whatsapp-gateway.service.ts` | فحص فوري عند كل عملية؛ وإذا تجاوز الكاشير 5 عمليات حذف سلة خلال ساعة واحدة، يتم إطلاق إنذار طارئ لهاتف المالك عبر الواتساب مع اسم الكاشير وتوقيته ورابط الفحص، مع آلية Debounce كل 60 دقيقة لمنع التكرار المزعج. |
| **شاشة رادار تفاعلية ومستقلة داخل سجل التدقيق (Fraud Radar UI)** | 🟢 | 100% | `CashierFraudRadarSection.tsx`, `AuditPage.tsx` | تبويب مخصص في شاشة التدقيق والمراجعة بتصميم مؤسسي نظيف يتضمن: شريط المؤشرات العامة، بنر الأمان الحي، محدد الفترات الزمنية (اليوم، 7 أيام، 30 يوماً)، وزر التحديث الفوري. |
| **بطاقات تحليل وتقييم سلوك الكاشيرات (Cashier Profiles Grid)** | 🟢 | 100% | `CashierFraudRadarSection.tsx`, `cashier-fraud-radar.api.ts` | بطاقات متناظرة تعرض ترتيب الكاشيرات حسب درجة الخطر، وشريط تقدم ملون، وإحصائية تفصيلية لكل كاشير (كمية حذوفات السلة، إلغاء المسودات، الفواتير الملغاة، وتجاوزات الخصم) مع توقيت آخر حركة مشبوهة. |
| **شريط الرصد الحي التفاعلي للعمليات المشبوهة (Live Telemetry Feed)** | 🟢 | 100% | `CashierFraudRadarSection.tsx` | سجل حي يتحدث تلقائياً كل 30 ثانية يعرض آخر العمليات المشبوهة لحظة بلحظة مع شارة نوع الحدث، اسم الكاشير، تفاصيل الصنف المحذوف، وقيمة الخسائر المرصودة أو المحمية. |

---

---


<!-- migrated:cap-057:end -->

<a id="cap-060"></a>
<!-- migrated:cap-060:start -->
## 35. شاشة العروض الترويجية الرقمية لصالة العرض (Digital Signage / Promo Board) 📺✨
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:**
  * **الفرونت إند والواجهات:** `frontend/src/features/pos/pages/DigitalSignagePage.tsx`, `frontend/src/features/pos/lib/pos-customer-display-bridge.ts`, `frontend/src/app/router/root-router.tsx`, `frontend/src/features/pos/components/pos-workspace/PosWorkspaceHeader.tsx`
* **الجداول في قاعدة البيانات:** `products`, `settings`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **وضع تشغيل التلفزيونات والشاشات الجدارية (Fullscreen TV Mode)** | 🟢 | 100% | `DigitalSignagePage.tsx`, `root-router.tsx` | واجهة عرض سينمائية عالية التباين والدقة بدعم كامل للشاشات التلفزيونية والتابلت الجداري عبر المسارين المستقلين `/signage` و `/promo-board`. |
| **المظهر المزدوج الفاخر والتبديل اللحظي (Cinematic Dark & Clean Light)** | 🟢 | 100% | DigitalSignagePage.tsx, SignageHeader.tsx, SignageHeroCard.tsx | دعم النمط السينمائي الفاخر (Dark Luxury Kiosk) والنمط النقي (Clean Light) مع زر تبديل فوري بالهيدر وحفظ التفضيل محلياً. |
| **محرك البدائل الذكي وحظر الإفراغ (Smart Fallback Engine)** | 🟢 | 100% | DigitalSignagePage.tsx, SignageShowroomWelcome.tsx | منع تعليق الشاشة على شاشات التحميل الفارغة؛ إذا كانت العروض 0 يتم التبديل لعرض المنتجات المميزة أو لوحة الترحيب التفاعلية بالمعرض. |
| **سلايدر العروض التلقائي مع شريط التقدم الزمني** | 🟢 | 100% | `DigitalSignagePage.tsx` | انتقال انسيابي تلقائي بين العروض الترويجية والمنتجات الأكثر مبيعاً مع شريط تقدم علوي حي وأزرار إيقاف مؤقت أو تنقل يدوي. |
| **حساب ومقارنة الأسعار وشارات التوفير (Save Badges)** | 🟢 | 100% | `DigitalSignagePage.tsx` | عرض بارز للسعر الأصلي مشطوباً والسعر المخفض الجديد، مع احتساب فوري لمبلغ التوفير ونسبة الخصم المئوية (مثال: وفر 70 ج.م - خصم 20%). |
| **شريط إخباري متحرك سفلي مخصص (Live Marquee Ticker)** | 🟢 | 100% | `DigitalSignagePage.tsx` | شريط متحرك لبث الترحيبات ورسائل العروض وساعات العمل مع إمكانية تعديل النص الحي من درج الإعدادات السريع. |
| **رمز الاستجابة السريع للطلب الفوري عبر الهاتف (Storefront QR Code)** | 🟢 | 100% | `DigitalSignagePage.tsx` | توليد ديناميكي لرمز QR متصل بمتجر PWA الإلكتروني، يتيح للعملاء الواقفين بالمعرض مسح الكود بهواتفهم والطلب والتسوق فورياً. |
| **درج تحكم وإعدادات تفاعلي سريع للشاشة** | 🟢 | 100% | `DigitalSignagePage.tsx` | درج إعدادات منبثق لضبط سرعة انتقال الشرائح (5ث، 8ث، 12ث، 20ث)، تصفية مصدر المنتجات (العروض فقط أو الكل)، وتعديل نص النشرة. |

---


<!-- migrated:cap-060:end -->

<a id="cap-073"></a>
<!-- migrated:cap-073:start -->
## 48. تحويل نقطة البيع والكاشير إلى موديول اختياري مرن (Modular POS & Cashier Workspace for B2B & Wholesale ERP)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Light Enterprise Theme).
* **روابط الوصول السريع:** `/settings/modules` (تبويب الموديولات في الإعدادات العامة).
* **مسارات الكود الأساسية:**
  * **النماذج والعقود:** `frontend/src/types/domain-models/settings.ts`, `frontend/src/types/domain-models/system.ts`, `frontend/src/features/settings/schemas/settings.schema.ts`, `frontend/src/features/settings/contracts.ts`, `frontend/src/features/settings/components/forms/SettingsMainForm.tsx`
  * **واجهة الإعدادات والتحكم:** `frontend/src/features/settings/components/forms/tabs/ModulesSettingsTab.tsx`
  * **الشل والقوائم والتوجيه:** `frontend/src/shared/layout/app-shell.tsx`, `frontend/src/features/pos/pages/PosPage.tsx`, `frontend/src/features/cash-drawer/pages/CashDrawerPage.tsx`, `frontend/src/shared/layout/MobileBottomNav.tsx`, `frontend/src/shared/layout/MobileQuickActionSheet.tsx`
* **الميزات والقدرات المفعلة:**
  1. **بطاقة تحكم مؤسسية في شاشة الموديولات (POS Toggle Card):** بطاقة بيضاء نظيفة بأيقونة SVG رسمية (`MonitorIcon`) في ترويسة شبكة الموديولات تتيح للمنشأة تفعيل أو إيقاف واجهات نقاط البيع السريعة والورديات بالكامل بنقرة زر واحدة.
  2. **الاستمرارية الافتراضية للتجزئة (Zero-Breaking Backward Compatibility):** القيمة الافتراضية هي `true` (مفعل)، مما يضمن عدم تأثر أي عميل تجزئة أو سوبرماركت أو مطعم قائم، مع إتاحة التعطيل الفوري للشركات التي لا تحتاج كاشير.
  3. **تكييف القائمة الجانبية والأوامر السريعة (Dynamic Sidebar & Primary Keys Adaptation):** عند إيقاف الكاشير، تختفي صفحات الكاشير (`/pos`) والوردية والدرج النقدي (`/cash-drawer`) والشاشات الملحقة (`/kds`, `/signage`) من القائمة الجانبية، ويتكيف شريط الأوامر السريعة الرئيسي ليصبح: `الرئيسية (Dashboard)`، `سجل الفواتير والمبيعات (Sales)`، و`طلبات المتجر (Online Orders)` لمخاطبة شركات الجملة والمؤسسات كـ Enterprise B2B ERP.
  4. **حماية التوجيه وإعادة التحويل التلقائي (Route-Level Auto-Redirects):** أي محاولة دخول مباشرة للمسار `/pos` عند تعطيل الموديول يُعاد توجيهها فورياً لـ `/sales`، وأي محاولة دخول لـ `/cash-drawer` يُعاد توجيهها لحركات الخزينة `/treasury`.
  5. **التكيف المحمول لشاشات الهواتف (Responsive Mobile Bottom Nav & Quick Actions):** يتحول الزر الرابع في شريط الجوال السفلي تلقائياً من "نقطة البيع" إلى "المخزون" (`/inventory`)، ويتحول زر الإجراء السريع في القائمة المنبثقة من كاشير التجزئة إلى "سجل الفواتير والمبيعات" لإنشاء وإصدار الفواتير الميدانية والتجارية.


<!-- migrated:cap-073:end -->

<a id="cap-090"></a>
<!-- migrated:cap-090:start -->
## 65. أوامر البيع وحجز المخزون المؤقت (Sales Orders & Stock Reservation Engine)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Odoo 17 Sales Orders & Stock Allocation / Reservation Engine.
* **روابط وشاشات الوصول:** `/sales/orders` (القائمة الجانبية: المبيعات ➔ أوامر البيع وحجز المخزون).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000059_sales_orders_stock_reservation.ts`, `backend/src/database/migrations/2040000000145_subwarehouse_stock_reservation.ts`, `backend/src/database/database.types.ts` (`products.reserved_qty`, `product_location_stock.reserved_qty`, `online_orders` tracking columns, `sales_orders`, `sales_order_items`).
  * **الباك إند:** `backend/src/common/utils/location-stock-ledger.ts` (`reserveLocationStock`, `releaseLocationStock`), `backend/src/modules/storefront/storefront.service.ts`, `backend/src/modules/sales/services/sales-orders.service.ts`, `backend/src/modules/sales/services/sales-write.service.ts`, `backend/src/modules/sales/controllers/sales-orders.controller.ts`, `backend/src/modules/sales/sales.module.ts`.
  * **الفرونت إند:** `frontend/src/features/sales/api/sales-orders.api.ts`, `frontend/src/features/sales/pages/SalesOrdersPage.tsx`, `frontend/src/features/sales/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **حجز المخزون المؤقت الآلي (Real-Time Stock Reservation):** فور تأكيد أمر البيع، يتم حجز الكميات المطلوبة في المخزون (`reserved_qty`) لمنع بيعها أو تكرار حجزها في نقاط البيع (POS) أو المتجر الإلكتروني، مع احتساب دقيق للرصيد المتاح للبيع للآخرين (`available_qty = stock_qty - reserved_qty`).
  2. **صلاحية الحجز ومتابعة التسليم:** تحديد تاريخ انتهاء لصلاحية الحجز وتاريخ التسليم المتوقع لكل طلبية.
  3. **التحويل بنقرة واحدة إلى فاتورة بيع فعلية (1-Click Convert to Sale Invoice):** تحويل أمر البيع المؤكد مباشرة إلى فاتورة بيع مرحلة في نظام المبيعات، مع فك الحجز آلياً وخصم الكميات من المخزون الفعلي دون أي تدخل يدوي أو ازدواجية.
  4. **إلغاء أمر البيع وفك الحجز الفوري:** إمكانية إلغاء أمر البيع بضغطة زر لفك حجز المخزون فورياً وإعادته للرصيد المتاح للبيع.
  5. **لوحة فحص جاهزية المخزون (Stock Readiness Modal):** فحص فوري لكل بند في أمر البيع ومقارنة الكمية المطلوبة بالكمية المحجوزة والرصيد الفعلي بالمستودع والرصيد المتاح للآخرين.
  6. **حجز المخزون لطلبات المتجر الإلكتروني على مستوى الفروع والمواقع (Sub-warehouse Online Orders Reservation - البند O7):** ربط دورة حياة طلبات المتجر الإلكتروني (`online_orders`) بحجز فوري للكميات في المخزن الفرعي المحدد للفرع (`product_location_stock.reserved_qty`) تزامناً مع حجز الصنف العام، مما يمنع البيع الزائد (Overselling) على الكاشيرات أو بين طلبات الويب المتزامنة.
  7. **إدارة دورة حياة الحجز بالمتجر (تعديل ذري، فك عند الإلغاء، تحويل للمبيعات):** إلغاء الطلب من المتجر أو تحويل حالته إلى `cancelled` يفك الحجز فورياً. تعديل الطلب يفك القديم ويحجز التشكيلة الجديدة ذرياً في نفس المعاملة. فوترة الطلب في الـ POS أو تحويله لمبيعات يفك الحجز أولاً ثم يخصم المخزون الفعلي الفيزيائي دون ازدواجية الخصم ودون الوقوع في عجز وهمي.
  8. **قيد عدم السالبية وترتيب الأقفال الكانوني لمنع الـ Deadlock:** قيد هيكلي صارم `chk_product_location_stock_reserved_non_negative` في قاعدة البيانات، واستخدام دالة السلامة `GREATEST(0, reserved_qty - delta)` عند فك الحجز، والالتزام بالترتيب القانوني الصارم للأقفال (`products` ثم `product_location_stock` مرتبة تصاعدياً بـ `productId`) للقضاء التام على تعليق العمليات المتبادل (SQLSTATE 40P01).


<!-- migrated:cap-090:end -->

<a id="cap-102"></a>
<!-- migrated:cap-102:start -->
## 65. أوامر البيع وحجز المخزون المؤقت (Sales Orders & Stock Reservation Engine)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Odoo 17 Sales Orders & Stock Allocation / Reservation Engine.
* **روابط وشاشات الوصول:** `/sales/orders` (القائمة الجانبية: المبيعات ➔ أوامر البيع وحجز المخزون).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000059_sales_orders_stock_reservation.ts`, `backend/src/database/database.types.ts` (`products.reserved_qty`, `sales_orders`, `sales_order_items`).
  * **الباك إند:** `backend/src/modules/sales/services/sales-orders.service.ts`, `backend/src/modules/sales/controllers/sales-orders.controller.ts`, `backend/src/modules/sales/sales.module.ts`.
  * **الفرونت إند:** `frontend/src/features/sales/api/sales-orders.api.ts`, `frontend/src/features/sales/pages/SalesOrdersPage.tsx`, `frontend/src/features/sales/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **حجز المخزون المؤقت الآلي (Real-Time Stock Reservation):** فور تأكيد أمر البيع، يتم حجز الكميات المطلوبة في المخزون (`reserved_qty`) لمنع بيعها أو تكرار حجزها في نقاط البيع (POS) أو المتجر الإلكتروني، مع احتساب دقيق للرصيد المتاح للبيع للآخرين (`available_qty = stock_qty - reserved_qty`).
  2. **صلاحية الحجز ومتابعة التسليم:** تحديد تاريخ انتهاء لصلاحية الحجز وتاريخ التسليم المتوقع لكل طلبية.
  3. **التحويل بنقرة واحدة إلى فاتورة بيع فعلية (1-Click Convert to Sale Invoice):** تحويل أمر البيع المؤكد مباشرة إلى فاتورة بيع مرحلة في نظام المبيعات، مع فك الحجز آلياً وخصم الكميات من المخزون الفعلي دون أي تدخل يدوي أو ازدواجية.
  4. **إلغاء أمر البيع وفك الحجز الفوري:** إمكانية إلغاء أمر البيع بضغطة زر لفك حجز المخزون فورياً وإعادته للرصيد المتاح للبيع.
  5. **لوحة فحص جاهزية المخزون (Stock Readiness Modal):** فحص فوري لكل بند في أمر البيع ومقارنة الكمية المطلوبة بالكمية المحجوزة والرصيد الفعلي بالمستودع والرصيد المتاح للآخرين.


<!-- migrated:cap-102:end -->

<a id="cap-159"></a>
<!-- migrated:cap-159:start -->
## 134. توحيد أبعاد أزرار نافذة إتمام البيع السريع وإضافة اختصار طباعة النسختين F4 (POS Sale Success Dialog Uniform Buttons & Dual Print F4 Shortcut)
* **حالة الموديول العامة:** 🟢 مكتمل 100% ومطابق لمعايير التناسق البصري ودستور النظام
* **المسارات في الكود:**
  - `frontend/src/features/pos/components/pos-workspace/PosSaleSuccessDialog.tsx`:
    1. إضافة اختصار لوحة المفاتيح `F4` لطباعة النسختين المزدوجتين (نسخة العميل + نسخة المحل / المطبخ / الدليفري) عبر استدعاء `safePrint(onPrintDualReceipt || onPrintReceipt)`.
    2. تأمين مستمع الاختصارات `handleShortcut` من اعتراض `Alt+F4` لعدم التشويش على اختصار إغلاق النوافذ في بيئة نظام التشغيل Windows.
    3. توحيد التوزيع البصري للأزرار التشغيلية: تحويل الصفوف إلى نسب متكافئة بدقة هندسية (`flex: '1 1 0'`, `minWidth: 0`) في الصف الأول والصف الثاني، مما يجعل جميع الأزرار متساوية الحجم تماماً ومتطابقة هوامش المحاذاة العمودية والأفقية مع منع تفاوت العرض أو تآكل النصوص.
  - `frontend/src/features/pos/components/pos-workspace/PosSaleSuccessDialog.spec.tsx`:
    - إضافة اختبار وحدة آلي شامل للتحقق من ظهور نص الزر «طباعة نسختين (عميل + محل) F4» وتنفيذ الطباعة المزدوجة فورياً عند الضغط على زر `F4` في لوحة المفاتيح.
* **النتائج البرمجية:**
  - جميع اختبارات الوحدة نجحت (7 passed).
  - فحص TypeScript للفرونت إند: Code 0 (Zero Errors).

---


<!-- migrated:cap-159:end -->

<a id="cap-219"></a>
<!-- migrated:cap-219:start -->
## 185. معيار ثبات نافذة خيارات وتفريعات الأصناف بنقاط البيع داخل مجال الرؤية المباشر (POS Variants Modal Viewport-Anchored Standard)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (30 سبتمبر 2026).
* **المسار:** `/pos` (شاشة نقاط البيع والكاشير).
* **المشكلة المعالجة:**
  - عند التمرير لأسفل (Scroll down) في شبكة منتجات نقطة البيع لمسافات طويلة والنقر على صنف يحتوي على تفريعات أو خيارات (ألوان، مقاسات، عبوات)، كانت النافذة المنبثقة للاختيارات (`InlineGroupPicker`) تفتح في أعلى منطقة التمرير (`top: 0` للحاوية الممررة الداخلية)، مما يجبر الكاشير على التمرير للأعلى لرؤية الخيارات، ويشتت الانتباه ويفقد موقع التمرير.
* **الهندسة والحلول المنفذة:**
  1. **حاوية الرؤية المباشرة غير القابلة للتمرير (`pos-products-viewport-wrapper`):**
     - فصل منطقة التمرير الداخلي (`pos-products-scroll`) عن الحاوية المرجعية النسبية، لتكون حاوية الرؤية الخارجية `position: relative; flex: 1 1 0%; overflow: hidden;`، ونقل نافذة الخيارات لتكون ابناً مباشراً لهذه الحاوية المرجعية.
  2. **التثبيت الدائم في واجهة الكاشير (Viewport Anchoring):**
     - تتمركز نافذة الخيارات المنبثقة مباشرة أمام أعين الكاشير وفي مجال الرؤية الحالي بغض النظر عن مدى عمق السكرول الذي وصل إليه في شبكة المنتجات (`inset: 0` نسبةً لحاوية الشاشة المباشرة).
  3. **تجميد اهتزاز وسكرول الخلفية (Zero Background Jitter & Scroll Lock):**
     - تطبيق `overflowY: openGroup ? 'hidden' : 'auto'` على شبكة المنتجات أثناء فتح نافذة الخيارات لمنع تحرك الأصناف بالخلفية عند استخدام عجلة الماوس أو اللمس، وعند الإغلاق يستأنف السكرول بنفس الموضع السابق تماماً (0 Scroll Jump).
  4. **الحفاظ التام على أداء نقاط البيع:**
     - صفر وميض وصفر إعادة تحميل للكتالوج مع بقاء سلة المشتريات والحسابات الجارية ثابتة ومحمية.
* **الملفات المتصلة:**
  - `frontend/src/features/pos/components/PosProductsPanel.tsx`
  - `frontend/src/styles/partials/pos-compact-fix.css`

---


<!-- migrated:cap-219:end -->

<a id="cap-226"></a>
<!-- migrated:cap-226:start -->
## POS and cashier integrity (2 October 2026)

- Cashier shift opening is serialized per cashier and tenant, validates branch and location ownership, and has a database uniqueness guard for open shifts. Closing recalculates expected cash inside the transaction and stores the signed variance.
- POS checkout checks the active shift on the sale branch, posts its journal in the sale transaction, serializes customer credit balance checks, and requires recorded manager approval for sales below cost or the product's optional minimum selling price.
- Returns enforce remaining invoice quantity by product and original line. Cash refunds draw from an open shift on the invoice branch. Terminal payment simulation is unavailable in Cloud SaaS until a real provider is connected.


<!-- migrated:cap-226:end -->

<a id="cap-232"></a>
<!-- migrated:cap-232:start -->
## Retail and POS field-readiness follow-up (5 October 2026)

- Configured scale prefixes (including 20–29 and 99) decode EAN-13 weighted or price-value labels with check-digit validation; quantity is kept to the stock ledger's three-decimal precision. Price-value labels reject mismatches against the active unit price, including quantity-dependent offers.
- Serialized checkout validates unique IMEI/serial rows against tenant and stock status before posting. Returns restore only serials sold by the original invoice line; partial returns accept explicit serial selections. Sale edits and cancellations release their sold serial rows. Migration `2040000000191` adds tenant-prefixed case-insensitive serial and second-IMEI lookup indexes.
- Offline invoice retries retain the same idempotency key; the queue is scoped to the authenticated tenant and account. Committed retries retrieve the original invoice by its stored sale ID. Legacy unscoped offline queue entries require manual reconciliation and are excluded from automatic SaaS replay.
- Receipt output supports 58 mm and 80 mm; Electron silently prints to the configured device. The success dialog sends one cash drawer kick per displayed posted invoice with an actual cash payment; reopening after a page reload can send another kick. Device errors do not roll back the committed sale.
- Store-credit returns and redemptions now post to customer advances liability account `2150`. Historical store-credit journals posted to receivables need an accountant-approved reclassification before ledger balances are certified.
- POS instant exchange accepts positive sale lines and negative return lines linked to one original sale. It locks the original sale and product rows, settles the net amount, and posts one combined journal inside the same transaction. The original sale must be fully paid for the same registered customer and branch; generic edit/cancel is blocked on the linked exchange invoice.
- No tests, builds, or physical printer checks were run under the owner's current instruction.


<!-- migrated:cap-232:end -->

<a id="cap-233"></a>
<!-- migrated:cap-233:start -->
## POS financial controls follow-up (5 October 2026)

- Cash checkout stores tendered, applied, and change amounts per payment. Noncash overpayment is rejected; drawer expectations use only the applied cash, including on older sales without payment rows.
- Sale lines persist proportional invoice discount, allocated tax, net value, and net unit price. Returns use those saved amounts and original unit cost under the sale and stock locks. A legacy return with unreconciled line values needs manual reconciliation before another return.
- Sale refunds are allocated to outstanding receivable, original cash, original electronic payment, or customer store credit. Cash cannot exceed the original cash paid without manager authorization and a recorded reason. Mixed returns reduce the cashier drawer by the actual cash payout.
- The backend records tenant-scoped POS audit events, requires an open shift for POS sales and no-sale drawer events, and posts blind-close variances to dedicated Cash Over and Cash Short accounts. The POS drawer control now records the user, shift and reason before sending a desktop kick; a hardware failure leaves the audit record intact.
- No build, typecheck, tests, migration execution, or hardware check was run under the owner's instruction. This is not a production verification claim.


<!-- migrated:cap-233:end -->

### P0-C three-decimal KWD/OMR sale source (25 October 2026; branch only)

- `sales-write.service.ts`, `sales-write.helper.ts`, invoice discount and tender allocation engines now accept the tenant book's 2/3-digit precision for sale source line amounts, discount/tax distribution, applied cash and receivables. `accounting-posting.service.ts` uses the same precision before journal-line aggregation for revenue/COGS and AR. `sales-finance.service.ts` retains the running customer-ledger mill value.
- Additive migration `2040000000258_sale_minor_unit_precision.ts` widens required sale, product-price and customer-balance storage without truncating historic postings on rollback.
- Disposable PostgreSQL acceptance now checks a 0.001 KWD credit sale from product stock and cost through customer debt and four-account GL. **Do not mark certified until the new SHA's CI/PG runs pass**. Mixed tender, tax, exchange, cancellation, downstream reporting and 8-cycle/11-sector certification still need testing.

## POS Out-of-Stock Handling & Display Control (27 October 2026)

- Out-of-stock items in POS catalog grid (`stock <= 0`, non-services and non-BOM) are visually dimmed (`opacity: 0.55`, grayscale) with a distinct red badge (`نفد`) and disabled when negative stock sales are prohibited (`allowNegativeStockSales = false`).
- Clicking or selecting out-of-stock items via keyboard Enter triggers non-blocking toast feedback (`الصنف نافذ من المخزون ولا يمكن بيعه حالياً`) and blocks cart addition. Variant options in `InlineGroupPicker` mirror this isolation per variant.
- Introduced `posHideOutOfStockItems` setting in tenant settings (`SalesInventorySettingsTab`) and per-workstation customization (`PosCustomizationDialog`) to completely filter out-of-stock products from browsing shelves when negative selling is blocked, while maintaining searchable discovery upon explicit name/barcode lookup.
- Implementation: `PosProductsPanel.tsx`, `usePosUiCustomization.ts`, `PosCustomizationDialog.tsx`, `SalesInventorySettingsTab.tsx`, `settings.schema.ts`, `contracts.ts`, `settings.ts`, `system.ts`.
- Verification evidence: `frontend/src/features/pos/components/PosProductsPanel.spec.tsx` (4/4 tests passing on 27 October 2026).

## POS Mobile & Handheld Terminal Virtual Keyboard Suppression (27 October 2026)

- On mobile devices and smart POS handheld terminals (Sunmi, Pax, iMin, etc.), on-screen soft keyboard auto-popup is completely suppressed on mount by setting `autoFocus={!isMobile}` and defaulting the search input to `inputMode="none"`.
- Keystrokes from hardware laser scanners, camera scanners, and Bluetooth scanners continue to be received without popping up the virtual keyboard over the catalog grid and cart.
- Added a dedicated keyboard toggle button (`KeyboardIcon`) in the search bar on mobile screens allowing the cashier to explicitly activate the virtual keyboard (`inputMode="text"`) on demand for manual text search by name, and auto-dismisses on Enter or blur.
- Updated Android application configuration (`AndroidManifest.xml`) with `android:windowSoftInputMode="stateAlwaysHidden|adjustPan"`.
- Implementation: `PosProductsPanel.tsx`, `AppIcons.tsx`, `frontend/android/app/src/main/AndroidManifest.xml`.
- Verification evidence: `frontend/src/features/pos/components/PosProductsPanel.spec.tsx` (5/5 tests passing on 27 October 2026, commit `c152d95d`).

### 265. إعادة تأهيل نافذة الاستبدال الفوري في نقطة البيع (`PosInstantExchangeDialog`) — واجهة مؤسسية ثنائية الأعمدة وعدادات RTL القياسية
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `frontend/src/features/pos/components/pos-workspace/PosInstantExchangeDialog.tsx`: التحويل من حاوية خام غير منسقة إلى `StandardDialog` القياسي (`compact`, `shellClassName="pos-exchange-dialog-shell"`) بهيدر ثابت وزر إغلاق (`X`) وفوتر (`إلغاء` + `اعتماد الاستبدال`/`التحقق من نتيجة الطلب`)، وإظهار `docNo` و`customerName` بدلاً من المعرفات الرقمية الخام، وتوزيع متوازن بعمودين (`السطور المرتجعة` بعداد RTL قياسي `[+] [qty] [-]` مع `.no-spin-arrows` و`استرجاع الكل`/`تصفير الكل`، مقابل `السطور الجديدة` ومؤشرات مقارنة الصافي وقوائم `CustomSelect`)، وحماية حقل رمز المشرف باستخدام `.secure-password-field` وسمات منع الملء التلقائي للمتصفح، مع الإبقاء على منطق عدم التكرار (`x-idempotency-key`) واسترداد العمليات المعلقة.
  - `frontend/src/styles/partials/pos-exchange-dialog.css`: تثبيت أبعاد النافذة عبر الشاشات ومنع الانزلاق والأنيميشن (`transition: none`, `animation: none`, `transform: none`) ومنع قص قوائم `CustomSelect`.
  - `frontend/src/features/pos/api/pos.api.ts`: تحديث نوع `getSaleForExchange` ليشمل `docNo` و`customerName` و`customerPhone` و`paymentChannel`.
  - `frontend/src/features/pos/components/pos-workspace/PosInstantExchangeDialog.spec.tsx`: اختبارات وحدة/مكون لفتح النافذة وتحميل الفاتورة وترتيب عداد RTL وحساب الصافي وحماية حقل رمز المشرف وإرسال المعاملة وحماية الإغلاق أثناء الاسترداد.
- **نطاق التحقق والأدلة:**
  - تشغيل `npx vitest run src/features/pos/components/pos-workspace/PosInstantExchangeDialog.spec.tsx src/features/pos/components/pos-workspace/pos-exchange-recovery.spec.ts src/features/pos/components/pos-workspace/pos-exchange-serial-validation.spec.ts src/features/pos/components/PosWorkspace.keyboard-safety.spec.tsx src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx` -> اجتياز **5 ملفات / 30 اختباراً** (`PosInstantExchangeDialog`: 3/3، `PosCheckoutDialog`: 14/14، `PosWorkspace.keyboard-safety`: 7/7، `pos-exchange-serial-validation`: 3/3، `pos-exchange-recovery`: 3/3).
- **القيود المعلومة:** تم التحقق في بيئة Vitest/JSDOM مع محاكاة طلبات الشبكة؛ لم يُشغَّل `npm run build` أو معاينة متصفح حية بناءً على سياسة تأجيل البناء حتى أمر المستخدم.

### 266. توازن الارتفاع وإبراز كروت المبالغ وإصلاح التمدد العرضي لكارت العميل في وضع التوصيل (`PosCheckoutDialog`)
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialog.tsx`: مد شبكة الأعمدة لتملأ الارتفاع المتاح (`flex: 1 1 auto; minHeight: 0`)، وتمرير `emphasizeTotal` لصندوق ملخص الفاتورة، وإخفاء شريط `تم إضافة العميل...` المتكرر أعلى النافذة حتى لا يدفع وضع الدليفري نحو السكرول مع الإبقاء الكامل على رسائل الأخطاء والتحقق (`T11-A`).
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialogSections.tsx`: تمديد بطاقة `طريقة الدفع والتحصيل` (`.pos-checkout-payment-card`) وتثبيت كروت المبالغ الثلاثة (`.pos-checkout-money-cards` عبر `marginTop: auto`) بارتفاع `62px` وحجم خط `19px`، وإعادة بناء كارت العميل المختار (`.pos-checkout-selected-customer-card`) بصفين متراصين بدلاً من شبكة 4 أعمدة التي كانت تتداخل أفقياً، وضغط ارتفاع حقول التوصيل (`34px`) وإبراز خانة الإكرامية المخصصة (`.pos-checkout-tip-custom-input`).
  - `frontend/src/features/pos/components/pos-cart-panel/PosTotalsBreakdown.tsx`: إضافة الخاصية الاختيارية `emphasizeTotal` لإبراز صف `الإجمالي` بحجم `17.5px` داخل نافذة إتمام البيع دون تغيير السلة أو شاشة العميل.
  - `frontend/src/styles/partials/pos-checkout-dialog-polish.css`: ضبط ارتفاع وضع التفصيلي على الديسكتوب إلى `min(675px, calc(100vh - 20px))` ومحاذاة `.pos-checkout-main-grid` إلى `stretch` وتوضيح لون النص التوضيحي لخانة `مخصص`.
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx`: إضافة اختبارات تحقّق لتمديد البطاقة وتثبيت كروت المبالغ وتكبير أرقامها وإبراز الإجمالي وكارت العميل المختار وعدم ظهور الشريط الزائد.
- **نطاق التحقق والأدلة:**
  - تشغيل `npx vitest run src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx src/features/pos/components/pos-workspace/PosCheckoutDeliverySection.spec.tsx src/features/pos/components/pos-workspace/PosCheckoutExpressSection.spec.tsx src/features/pos/components/pos-workspace/pos-express-amount-sync.spec.tsx` -> اجتياز **4 ملفات / 34 اختباراً** (`PosCheckoutDialog`: 16/16، `PosCheckoutExpressSection`: 6/6، `pos-express-amount-sync`: 7/7، `PosCheckoutDeliverySection`: 5/5).
- **القيود المعلومة:** تم التحقق في بيئة Vitest/JSDOM؛ لم يُشغَّل `npm run build` أو معاينة متصفح حية التزاماً بقاعدة تأجيل البناء حتى أمر المستخدم.

### 267. توحيد وتأهيل النوافذ والحقول التشغيلية بنقطة البيع (`PosOpenShiftModal`، `No-Sale`، `PosWorkspaceConfirmDialogs`، وحقول الإدخال والقوائم)
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `frontend/src/features/pos/components/pos-workspace/PosOpenShiftModal.tsx`: تحويل نافذة فتح الوردية إلى `StandardDialog` القياسي (`compact`، هيدر وفوتر `إلغاء` + `فتح وردية نقطة البيع`)، واستبدال `<select>` الفرع والمخزن بمكون `CustomSelect`، وإضافة `.no-spin-arrows` لحقل رصيد الفتح، وحماية حقل كلمة المرور عبر `.secure-password-field` وسمات منع الملء التلقائي للمتصفح.
  - `frontend/src/features/pos/components/pos-workspace/PosWorkspaceHeader.tsx`: تحويل نافذة `فتح الدرج بدون بيع` (`No-Sale`) من `DialogShell` خام إلى `StandardDialog` بهيدر قياسي وفوتر بأزرار `إلغاء` و`فتح الدرج`.
  - `frontend/src/features/pos/components/pos-workspace/PosWorkspaceConfirmDialogs.tsx`: توحيد نافذة `هل تريد تفريغ الفاتورة الحالية؟` باستخدام `ActionConfirmDialog` بدلاً من الدائرة المتدرجة والأزرار المتحركة السابقة، لتطابق باقي نوافذ التأكيد في نقطة البيع.
  - `frontend/src/features/pos/components/pos-cart-panel/PosCartItemsList.tsx`: إضافة `.no-spin-arrows` ومعالج `onWheel` لحقلي الكمية وخصم السطر.
  - `frontend/src/features/pos/components/pos-workspace/PosManagerCompModal.tsx`: حماية حقل PIN المدير باستخدام `.secure-password-field` ومنع الملء التلقائي، وإضافة `.no-spin-arrows` لمبلغ الضيافة المخصص.
  - `frontend/src/features/pos/components/pos-workspace/Pos86ItemsModal.tsx`، `frontend/src/features/pos/components/pos-workspace/PosFoodWasteModal.tsx`، `frontend/src/features/pos/components/pos-workspace/PosTransferItemModal.tsx`: استبدال قوائم `<select>` المتصفح بمكون `CustomSelect` القياسي وإضافة `.no-spin-arrows` لحقول الهدر الرقمية.
  - `frontend/src/features/pos/components/pos-workspace/PosOpenShiftModal.spec.tsx`، `frontend/src/features/pos/components/pos-cart-panel/PosCartItemsList.spec.tsx`، `frontend/src/features/pos/components/pos-workspace/PosWorkspaceHeader.lazy-modals.spec.tsx`: إضافة تحقق من `StandardDialog` و`.secure-password-field` و`.no-spin-arrows`.
- **نطاق التحقق والأدلة:**
  - تشغيل `npx vitest run src/features/pos/components/pos-workspace/PosOpenShiftModal.spec.tsx src/features/pos/components/pos-workspace/PosWorkspaceHeader.lazy-modals.spec.tsx src/features/pos/components/PosWorkspace.keyboard-safety.spec.tsx src/features/pos/components/pos-workspace/PosManagerCompModal.spec.tsx src/features/pos/components/pos-cart-panel/PosCartItemsList.spec.tsx src/features/pos/pages/SelfOrderingKioskPage.spec.tsx src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx src/features/pos/components/pos-workspace/PosInstantExchangeDialog.spec.tsx` -> اجتياز **8 ملفات / 62 اختباراً**.
- **القيود المعلومة:** تم التحقق في بيئة Vitest/JSDOM مع محاكاة استعلامات API؛ النوافذ الجانبية الأربعة في استدعاءات `PosTableReservationsModal` و`PosPhoneOrderDialog` و`PosTipPoolModal` أبقيت على `<select>` لتفادي كسر اختبارات `getByRole('option')` أو الجداول الضيقة، ولم يُشغَّل `npm run build` التزاماً بقاعدة تأجيل البناء حتى أمر المستخدم.

### 268. تقليص الاحتكاك الزائد في رموز اعتماد المدير وكلمات مرور الكاشير مع إبقاء إلزامية كلمة المرور عند إغلاق الوردية
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `backend/src/modules/cash-drawer/cash-drawer.service.ts` و`frontend/src/features/cash-drawer/pages/CashDrawerPage.tsx`: إبقاء إغلاق الوردية (`closeCashierShift`) بكلمة مرور إجبارية لكل الأدوار بما فيها المدير بناءً على قرار المالك، وإعفاء `admin`/`super_admin` عند ترك الرمز فارغاً في السحوبات (`cash_out`/`safe_drop`) مع فحص أي رمز مُدخَل فعلياً، وإبقاء الإلزام لغير المديرين.
  - `frontend/src/features/pos/components/pos-workspace/PosOpenShiftModal.tsx`: إخفاء حقل تأكيد كلمة المرور تماماً عند تعطيل إعداد `requirePasswordOnShiftOpen` وإرسال `password: undefined`.
  - `backend/src/modules/returns/returns.service.ts` و`backend/src/modules/sales/services/create-sale.service.ts` و`frontend/src/features/pos/components/pos-workspace/PosInstantExchangeDialog.tsx`: إعفاء `admin`/`super_admin` في الاستبدال الفوري عند ترك الرمز فارغاً، وقصر طلب رمز المشرف لغير المديرين على حالة رد نقدي من الدرج `>= posLargeCashRefundThreshold` (مع تمرير معاملة القاعدة `trx` إلى `getLargeCashRefundThreshold` لمنع تعليق المعاملة)، وإعفاء الاستبدال المتساوي أو التحصيل الموجب أو `store_credit` أو النقدي الأقل من الحد.
  - `backend/src/modules/sales/services/restaurant-advanced-fnb.service.ts` و`backend/src/modules/sales/controllers/restaurant-advanced-fnb.controller.ts` و`frontend/src/features/pos/components/pos-workspace/PosManagerCompModal.tsx`: إعفاء `admin`/`super_admin` من إعادة إدخال PIN الضيافة عند تركه فارغاً مع استمرار إلزام PIN لحاملي صلاحية `pos_manager` غير المديرين وحظر الكاشير العادي (`403`).
  - `backend/src/modules/sales/services/sales-edit-and-cancel.service.ts` و`frontend/src/features/sales/components/SaleEditDialog.tsx` و`frontend/src/features/sales/components/SalesWorkspace.tsx`: إعفاء `admin`/`super_admin` من إعادة إدخال PIN عند تعديل الفاتورة بعد الإغلاق (`updateSale`) أو إلغاء الفاتورة (`cancelSale`) عند ترك الحقل فارغاً، مع فحصه إذا أُدخل وإبقاء الإلزام للكاشير.
- **نطاق التحقق والأدلة:**
  - Frontend Vitest (`npx vitest run` على `PosInstantExchangeDialog.spec.tsx`, `PosManagerCompModal.spec.tsx`, `PosCheckoutDialog.spec.tsx`, `PosWorkspace.keyboard-safety.spec.tsx`, `PosOpenShiftModal.spec.tsx`): اجتياز **5 ملفات / 36 اختباراً**.
  - Backend Critical Specs (`npx ts-node`): اجتياز كل من `returns-shift-gate.spec.ts` (الحالات `0`..`14` بما فيها `8b`)، `restaurant-manager-comp-gate.spec.ts` (8/8)، `restaurant-fnb-claims-post.spec.ts` (27/27)، `sale-edit-post-close.spec.ts`، `drawer-disbursement-gate-boundary.spec.ts` (بما فيها حالة `admin outbound bypasses empty secret while close stays mandatory`)، `cross-shift-cancel-cash.spec.ts`، `returns-conditional-discount-forfeit.spec.ts`، `returns-payout-truth.spec.ts`، `cash-drawer-movement-types.spec.ts`، و`cash-drawer-shift-close-control.spec.ts`.
- **القيود المعلومة:** شاشات `CashDrawerPage.tsx` و`SaleEditDialog.tsx` و`SalesWorkspace.tsx` تم التحقق من بواباتها الخلفية بالكامل via specs ولم يُكتب لها spec مكون React مستقل؛ وتم تأجيل `npm run build` و`npm run guards` و`tsc` التزاماً بتوجيهات عدم تشغيل البناء أو الحراس الموسعين قبل أمر المستخدم.

### 269. تثبيت الأبعاد الصارم ومنع أي تمدد أو إزاحة في نافذة إتمام البيع (`PosCheckoutDialog` — `تحصيل عند التسليم` وكل التفاعلات)
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `frontend/src/styles/partials/pos-checkout-dialog-polish.css`: تثبيت حاوية الشبكة (`.pos-checkout-main-grid`) على وضع سطح المكتب مع فصل ارتفاع العمودين داخل `.pos-checkout-col-pane` (`height: 100%`, `min-height: 0`, `overflow-y: auto`, `scrollbar-gutter: stable`) لمنع ظهور سكرول خارجي يُزيح العناصر أفقياً أو يسحب كروت المبالغ لأسفل عند تفعيل التوصيل، وتثبيت ارتفاع الفوتر (`.pos-checkout-dialog-actions`) على `46px`.
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialog.tsx`: فصل عمودي البيانات والدفع بمسار `.pos-checkout-col-pane` لمنع تمدد عمود التوصيل من دفع كروت الدفع السفلية، وضبط ضغط عمود التوصيل وإشعارات الفوتر على ارتفاع ثابت `30px`.
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialogSections.tsx`: تثبيت ارتفاع هيدر كارت الدفع `.pos-checkout-payment-card-header` على `26px` وشارة `تحصيل عند التسليم` / `دفع مقسّم` على `22px` (`lineHeight: 1`)، وتثبيت حاوية الشريط الثانوي `.pos-checkout-payment-subslot` على `38px` مع منع التفاف أزرار `المستلم` أو النص التوضيحي، وتثبيت صف عناوين حقول الدفع على `20px` وتوحيد سمك الحدود `1.5px`، وتثبيت شريط `إكرامية` (`.pos-checkout-tip-row`) على `36px` بدون التفاف، وتثبيت `pos-collection-status-summary` على `46px` وتوحيد `fontWeight: 700` لأزرار قنوات التوصيل.
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx`: إضافة اختبار التحقق من ثبات أبعاد الهيدر (`26px`) والشريط الفرعي (`38px`) وشريط الإكرامية (`36px`) وملخص التحصيل (`46px`) وفصل العمودين عند تفعيل وإلغاء `تحصيل عند التسليم`.
- **نطاق التحقق والأدلة:**
  - تشغيل `npx vitest run src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx src/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions.spec.ts src/features/pos/components/PosWorkspace.keyboard-safety.spec.tsx` -> اجتياز **3 ملفات / 61 اختباراً** (`PosCheckoutDialog.spec.tsx` 17/17، `PosWorkspace.keyboard-safety.spec.tsx` 7/7، `createPosWorkspaceBaseActions.spec.ts` 37/37).
- **القيود المعلومة:** تم التحقق عبر Vitest/JSDOM مع محاكاة بيانات الواجهة، وأُجّل `npm run build` و`tsc` لحين أمر المستخدم.

### 270. إصلاح تآكل أزرار فوتر إتمام البيع واستكمال نواقص تقسيم الشيك (`PosSplitBillModal`)
- **التاريخ:** 2026-11-16
- **المراجع:**
  - `frontend/src/styles/partials/pos-checkout-dialog-polish.css`: إزالة قيد `height: 46px` / `max-height: 46px` / `overflow: hidden` عن `.pos-checkout-dialog-actions` واستبداله بـ `min-height: 52px` و`height: auto` وحشو مريح (`10px 0 4px`) و`overflow: visible` لمنع قص الحافة السفلية لأزرار الفوتر.
  - `frontend/src/features/pos/components/pos-workspace/PosCheckoutDialog.tsx` و`PosCheckoutDialogSections.tsx` و`PosCheckoutCustomerSection.tsx` و`PosCheckoutFulfillmentSections.tsx` و`PosCheckoutExpressSection.tsx` و`PosCheckoutExpressFooter.tsx` و`PosWorkspaceHeader.tsx` و`PosWorkspaceHeaderModals.tsx` و`frontend/src/features/pos/components/PosWorkspace.tsx` و`PosSplitBillModal.tsx` و`pos-split-bill.helpers.ts`: نقل بطاقة ملخص الإجمالي والمجموع الفرعي (`.pos-checkout-totals-card`) إلى أسفل العمود الأيمن (`marginTop: auto`) بعد العميل والمندوب والملاحظات لتتحاذى أفقياً مع كروت `المطلوب دفعه / المدفوع / المتبقي`، وإزالة استيراد `formatCurrency` غير المستخدم، وتمرير `terminalCode` (`getPosTerminalCode()`) و`managerPin` (من اعتماد الخصم داخل نافذة الدفع عبر `initialManagerPin` أو `pos.discountApprovalSecret`) في تحصيل الشيك المفرد وتحصيل الضيوف بالتساوي، وإضافة خيار الدفع تحويل / InstaPay (`تحصيل تحويل` و`سداد تحويل` مع قناة `instapay`)، ومزامنة باقي الخصم والإكرامية والنقاط ورسوم التوصيل مع السلة عند السداد الجزئي للشيكات، ومنح الطلبات المعلقة بدون رقم طاولة تسمية مميزة (`b.name || شيك k`) بدلاً من سلسلة فارغة، مع تفكيك الدوال والأقسام الفرعية للملفات الكبيرة لتتوافق مع حد حجم الملفات (`file-size-check`).
  - `frontend/src/features/pos/components/pos-workspace/PosSplitBillModal.spec.tsx`: إضافة اختبارين يثبتان تمرير `terminalCode` و`initialManagerPin` وقناة `instapay` ومزامنة المتبقي وأسماء المعلقات بدون طاولة.
- **نطاق التحقق والأدلة:**
  - تشغيل `npx vitest run src/features/pos/components/pos-workspace/PosCheckoutDialog.spec.tsx src/features/pos/components/pos-workspace/PosSplitBillModal.spec.tsx` (ضمن حزمة من 6 ملفات) -> اجتياز `PosSplitBillModal.spec.tsx` (**57/57**) و`PosCheckoutDialog.spec.tsx` (**17/17**).
- **القيود المعلومة:** تم التحقق في بيئة Vitest/JSDOM دون `npm run build` أو معاينة متصفح حية التزاماً بتأجيل البناء حتى أمر المستخدم.

### 271. تسريع مسار الكاشير بالكامل (ضرب الباركود، حفظ الفاتورة، والطباعة الصامتة والعادية اللحظية) وإضافة زر الطباعة التلقائية (`posAutoPrintReceipt`)
- **التاريخ:** 2026-11-26
- **المراجع:**
  - `frontend/src/features/pos/lib/pos-workspace.helpers.ts` و`frontend/src/features/pos/components/PosProductsPanel.tsx` و`PosProductsToolbar.tsx` و`pos-compact-fix.css`: بناء فهرس `WeakMap` بسرعة `O(1)` لمطابقة الباركود والكود وباركود الوحدات، خفض `scanFlushMs` إلى `20ms`، تنفيذ الإضافة الفورية على `Enter` دون تمرير نص البحث الوسيط لإعادة رسم الشبكة، وإلغاء حركات `animation`/`transition` المبطئة لعناصر الكاشير.
  - `frontend/src/lib/browser.ts` و`frontend/src/lib/pos-printing.ts` و`frontend/src/lib/pos-printing/logo-cache.ts` و`template-header.ts` و`template-payments.ts` و`cup-label.ts` و`frontend/src/features/pos/hooks/usePosSaleMutation.ts` و`frontend/src/features/pos/lib/hardware-bridge-client.ts` و`frontend/src/features/pos/components/PosWorkspace.tsx`: استيراد ثابت مباشر لعميل الجسر المحلي، فتح اتصال استماع دائم (`/events` عبر `EventSource`) لإبقاء الجسر ومكدس TCP صاحيين في الذاكرة، تسخين الطابعات المختارة ومقاس الصفحة مسبقاً (`/api/printer/warm`) وبناء قالب HTML الريسيت مسبقاً (`prestagePostedSaleReceipt`) في اللحظة `0ms` أثناء طيران `POST /api/sales` مع حقن رقم الفاتورة وباركود `Code128` فور وصول الرد، تخزين شعار المتجر في الذاكرة كـ `Base64 Data URI` (`warmReceiptLogoDataUri`) لتصفير انتظار تحميل الصور، خصم أرصدة الأصناف المباعة لحظياً في ذاكرة الكاشير وتأجيل `invalidateSalesDomain` لمدة `180ms` لمنع تزاحم إعادة الجلب مع لحظة الطباعة، توجيه ملصقات الأكواب والباركود مباشرة لطابعة الباركود الصامتة (`50x30mm`)، إلغاء فحص `127.0.0.1:9100` الأعمى، وإزالة تأخير `220ms–260ms` قبل الطباعة عبر نافذة المتصفح.
  - `tools/z-systems-bridge/Program.cs` و`tools/z-systems-bridge/z-systems-bridge.exe` و`src/server/bridge-server.js` و`src/drivers/printer/escpos-driver.js`: تجهيز نافذة ومحرك الطباعة الخفي (`EnsureWarmPrintBrowser`) مسبقاً على خيط `STA` عند بدء الجسر مع تحميل وثيقة تسخين أولية (`__warmup__`)، التقديم المباشر للإيصال من الذاكرة (`_inMemoryPrintDocs` على `/internal/print-doc`) بدلاً من إنشاء ملفات `.html` في `%TEMP%` (تجنباً لكتابة القرص وفحص Windows Defender اللحظي)، إزالة `Thread.Sleep` من خيط `STA` واستبداله بـ `Thread.Yield()` + `Application.DoEvents()` مع ترحيل استعادة إعدادات الصفحة والطابعة الافتراضية لمؤقت خلفية غير حاجز (`_postPrintRestoreTimer`)، التوجه المباشر للطابعة المختارة فقط عبر `OpenPrinter`/`GetDefaultPrinter` من `winspool.drv` مع كاش `_verifiedPrinterNames` دون مسح `InstalledPrinters` أو لمس أي طابعة أخرى على ويندوز، تفعيل `TCP_NODELAY` بلا `Thread.Sleep`، وإعادة ترجمة وتشغيل `z-systems-bridge.exe`.
  - `frontend/electron/thermal-label-printer.cjs` و`frontend/electron/main.cjs`: إبقاء نافذة الرسم الخفية (`offscreen BrowserWindow`) وعامل طباعة `PowerShell System.Drawing` دافئين ومستمرين في الخلفية مع كاش مقاسات الورق (`$script:paperStockCache`) للطابعة المحددة فقط بدل تشغيل عملية `powershell.exe` جديدة وإنشاء نافذة جديدة لكل إيصال، مع تراجع تلقائي آمن للوضع الفردي عند أي خطأ.
  - `frontend/src/features/settings/components/forms/tabs/PrintingSettingsTab.tsx` و`settings.schema.ts` و`SettingsMainForm.tsx` و`contracts.ts` و`settings-field-metadata.ts` و`settings.ts` و`createPosWorkspaceAsyncActions.ts`: إضافة إعداد `posAutoPrintReceipt` (مفعّل افتراضياً `true`) لطباعة فاتورة الكاشير وفتح الدرج في نفس لحظة إتمام البيع والعودة الفورية لشاشة بيع جديدة، وعند إيقافه (`false`) فتح نافذة ما بعد البيع بانتظار ضغط `F2`.
  - `backend/src/modules/accounting/accounting-tenant-foundation.service.ts` و`backend/src/modules/accounting/services/sales-returns-posting/post-sale.ts` و`backend/src/modules/sales/services/create-sale/insert-sale-and-stock.ts` و`prepare-sale-items.ts` و`resolve-pos-trip-attribution.ts` و`price-list-resolution.engine.ts` و`sales-query.service.ts` و`create-sale.service.ts`: حفظ كاش `initializedTenants` عند ثبات التهيئة داخل المعاملات، جلب حسابات ترحيل المبيعات في استعلام SQL واحد بدل 9 استعلامات متتالية، الجلب المجمع لبنود قوائم الأسعار (`prefetchPriceListItemsByProduct`) وسعر الآجل، الفحص المجمع لملكية السيريالات والتشغيلات الدوائية والعامة ولوطات الاستيراد مرة واحدة قبل حلقة الأصناف، توازي استعلامات نسبة الرحلة (`resolvePosTripAttribution`) وفلترة الرحلات المفتوحة في SQL، وتنفيذ قراءة الفاتورة وبنودها ومدفوعاتها بالتوازي في جولة واحدة مع تخطي استعلام المرتجعات للفاتورة المنشأة حديثاً (`skipLinkedReturns`).
- **نطاق التحقق والأدلة:**
  - إعادة ترجمة `tools/z-systems-bridge/z-systems-bridge.exe` عبر `csc.exe` بنجاح، وتشغيل الجسر فعلياً في الخلفية وفحص استجابة `GET http://127.0.0.1:18181/health` (`ONLINE`) و`POST http://127.0.0.1:18181/api/printer/warm` (`{"success":true}`).
  - تشغيل `npx vitest run` على `createPosWorkspaceAsyncActions.spec.ts` (**20/20**) و`browser-print-bridge.spec.ts` (**5/5**) -> اجتياز **25/25 اختباراً** بما فيها التجهيز المتوازي (`warmPrinters`) قبل اكتمال `createSale.mutateAsync` وسلوك `posAutoPrintReceipt` في حالتي التفعيل والإيقاف.
- **القيود المعلومة:** التزاماً بقواعد المشروع، تم تأجيل تشغيل `npm run build` و`npm run guards` و`tsc` لحين أمر صريح من المستخدم.
