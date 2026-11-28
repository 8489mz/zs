# قدرات المشتريات والموردون

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **المشتريات والموردون** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/purchases/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md) · [العملاء والتحصيل والولاء](PARTNERS_CAPABILITIES.md) · [الموافقات واستثناءات المدير](APPROVALS_CAPABILITIES.md)

## التحديثات الحالية

<a id="cap-blind-grn"></a>
### الاستلام الأعمى لبضاعة الموردين وإنذار فروقات الاستلام (Blind GRN & Discrepancy WhatsApp Alert - 28 November 2026)
* **حالة القدرة:** منفذة في الباك إند والفرونت إند (2026-11-28).
* **السلوك والضوابط:**
  - عند تفعيل `antiTheftEnforceBlindPurchaseReceiving` يكون استلام غير المديرين أعمى: مسار `GET /api/purchase-orders/:id?forReceiving=true` يحجب `quantity` و`received_quantity` و`unit_cost` و`total` ويعيد `blindReceivingMode: true`، كما تخفي نافذة `GoodsReceiptModal.tsx` عمود «المطلوب» وتبدأ حقول الاستلام بقيمة `0` لإلزام أمين المخزن بالعد والوزن الفعلي.
  - عند ترحيل إذن الاستلام (`postGoodsReceipt`) تقارن الخدمة الكميات المستلمة والمرفوضة ببنود أمر الشراء، وتسجل مخالفة تدقيق وترسل إنذار واتساب فورياً للمالك عند أي فارق أو كمية مرفوضة.
* **مصادر التنفيذ:** `backend/src/modules/purchases/controllers/purchase-orders.controller.ts`، `services/purchase-orders.service.ts`، `services/goods-receipt.service.ts`، `frontend/src/features/purchases/components/GoodsReceiptModal.tsx`.
* **مجالات مرتبطة:** [غرفة عمليات منع الخسائر](SALES_CAPABILITIES.md#cap-loss-prevention-pos) · [الإعدادات](SETTINGS_CAPABILITIES.md#settings-anti-theft-shield).

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

## فهرس الأقسام المنقولة

- [4. المشتريات وحسابات الموردين (Purchases & Suppliers)](#cap-030)
- [66. دورة أوامر الشراء واعتماد الموردين والاستلام المخزني (Purchase Orders & Goods Receipt)](#cap-091)
- [71. طلبات عروض أسعار الموردين ومصفوفة المقارنة والترسية (Vendor RFQs & Comparison Matrix)](#cap-096)
- [177. كاشف فواتير الموردين المكررة ورادار التحذير الاستباقي وحوكمة التجاوز (Vendor Duplicate Bill & Fraud Detection Engine)](#cap-211)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-030"></a>
<!-- migrated:cap-030:start -->
## 4. المشتريات وحسابات الموردين (Purchases & Suppliers)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/modules/purchases`, `backend/src/modules/partners`, `frontend/src/features/purchases`, `frontend/src/features/suppliers`
* **الجداول في قاعدة البيانات:** `purchases`, `purchase_items`, `purchase_returns`, `suppliers`, `supplier_transactions`, `goods_receipt_notes`, `goods_receipt_lines`, `purchase_three_way_matches`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **تسجيل فواتير المشتريات** | 🟢 | 100% | `purchases.service.ts`, `PurchasesPage.tsx` | إضافة فواتير المشتريات، تعديل متوسط التكلفة (Moving Average Cost)، وتغذية المخزون فوراً. |
| **أذون الاستلام المخزني والمطابقة الثلاثية وحساب وسيط التوريدات (Goods Receipt Notes, 3-Way Matching & GRNI Settlement Engine)** | 🟢 | 100% | `goods-receipt.service.ts`, `goods-receipt.controller.ts`, `three-way-match.engine.ts`, `GoodsReceiptModal.tsx`, `ThreeWayMatchModal.tsx`, `GoodsReceiptsListModal.tsx`, `2040000000106_goods_receipt_notes_and_three_way_matching.ts` | منظومة استلام مخزني ومطابقة ثلاثية قياسية مطابقة لمعايير SAP ERP و Oracle NetSuite؛ إنشاء أذون استلام مخزني رسمية بترقيم موحد (`GRN-YYMMDD-XXXX`)، فحص الجودة وفصل الكميات المقبولة عن المرفوضة مع تسجيل أسباب الرفض والتشغيلات (Batch #) وتواريخ الصلاحية، توليد قيد وسيط التوريد غير المفوتر GRNI آلياً (من حـ/ المخزون 1140 إلى حـ/ بضاعة مستلمة غير مفوترة 2125)، محرك المطابقة الثلاثية الصارم (Three-Way Match) بين أمر الشراء (PO) وإذن الاستلام (GRN) وفاتورة المورد، فرض ثوابت الحظر (MATCH-1: حظر الفوترة الزائدة عن المستلم، MATCH-2: سقف التسامح السعري 2% وترحيل الفروق لحساب PPV 5190، MATCH-3: استثناء البنود الخدمية بشرط شهادة الإنجاز)، وتسوية قيد الفاتورة التراكمي وتصفير الفارق الحسابي بدقة 0.000 ج.م مع دعم التجاوز الإداري المبرر من المدير المالي.<br/>**تحصين سبتمبر 2026 (المرحلة 2 من التدقيق):** كانت الثوابت معلنة وغير فاعلة فعلياً — صُحِّح الآتي: (1) `historicalInvoicedLines` لم يكن يُمرَّر للمحرك فكان MATCH-1 معطلاً وأمكن فوترة نفس الشحنة مراراً؛ (2) أعمدة الربط `po_id`/`po_item_id` لم تكن موجودة في المخطط فكان ضلع أمر الشراء (MATCH-2) ميتاً بنيوياً وأُضيفت في هجرة 113؛ (3) دفتر استهلاك داخل الفاتورة الواحدة يمنع تجاوز الحد بتقسيم البند لسطرين؛ (4) التجاوز صار **مقيَّد النطاق** (`price_only` لا يُسقط حجب الكمية، و`full` يتطلب صلاحية إدارة وسبباً ≥ 10 أحرف) بدلاً من مفتاح واحد يُسقط كل الحواجز بنص حر؛ (5) المطابقة أصبحت **بوابة تحجب سداد الموردين** فعلياً بعد أن كانت وسماً استشارياً لا يمنع ترحيلاً ولا صرفاً؛ (6) فارق التسوية صار يحجب الترحيل بعد أن كان يُحسب ويُهمل؛ (7) ضريبة القيمة المضافة تُحتسب لكل سطر بمعدله لدعم الفواتير مختلطة المعدلات؛ (8) حجب الزيادة السعرية فقط دون الفرق المواتي للمشتري. **الحارس:** `test/critical/purchases-three-way-match.spec.ts`. |
| **مرتجع المشتريات للمورد** | 🟢 | 100% | `purchase_returns`, `PurchaseReturnsPage.tsx` | إرجاع بضاعة للمورد، خصمها من المخزن وتخفيض مديونية المورد أو استرداد نقدي. |
| **سجل وحسابات الموردين (Supplier Ledger)** | 🟢 | 100% | `partners.service.ts`, `SuppliersPage.tsx` | كشف حساب تفصيلي، أرصدة سابقة، مديونيات، وسجل الفواتير السابقة. |
| **سندات صرف دفعات الموردين** | 🟢 | 100% | `treasury.service.ts`, `PaymentVoucherModal.tsx` | سداد نقدي أو شيك أو تحويل بنكي للمورد وخصمه من الخزينة وكشف حساب المورد. |
| **محرك تكاليف الشحن والجمارك الموزعة (Purchase Landed Costs Engine)** | 🟢 | 100% | `purchase-landed-costs.service.ts`, `purchases.controller.ts`, `PurchaseLandedCostsModal.tsx`, `PurchaseDetailCard.tsx`, `2040000000054_purchase_landed_costs.ts` | محرك احتساب تكاليف الشحن البحري والجوي والتخليص الجمركي والنقل والتأمين الإضافية وتوزيعها آلياً حسب القيمة أو الكمية على بنود فاتورة المشتريات، وتحديث تكلفة الوحدة المخزنية `landed_unit_cost` وسعر التكلفة `cost_price` في المخازن، وتوليد القيود المحاسبية المقابلة.<br/>**تحصين سبتمبر 2026 (المرحلة 2):** (1) التكلفة الإضافية تُقسَّم الآن بين الوحدات المتبقية (رسملة على المخزون) والوحدات المباعة بالفعل (تحميل على تكلفة المبيعات 5110)، بعد أن كانت تُرسمل بالكامل على المتبقي فتُضخّم تكلفته ويبقى ربح المبيعات السابقة مُبالغاً فيه؛ (2) أُزيل الفرع الذي كان **يمحو المتوسط المرجح** ويستبدله بتكلفة الشحنة وحدها عندما يكون أغلب الكمية قد بيع؛ (3) حارس ضد إعادة التطبيق (`landed_cost_applied_at` كان يُكتب ولا يُقرأ، فكان التكرار يُضاعف التكلفة بلا حد)؛ (4) القيد يُرحَّل بتاريخ الفاتورة لا بتاريخ اليوم؛ (5) فحص قفل الفترة المحاسبية أُضيف؛ (6) أُزيل التخطي الصامت للقيد عند غياب الحساب. |
| **مقترح إعادة الطلب والتوريد الذكي (Smart Reorder & Procurement Suggestions)** | 🟢 | 100% | `SmartReorderPage.tsx`, `purchases.api.ts`, `SmartReorderStats.tsx`, `SmartReorderFilters.tsx`, `SmartReorderSupplierGroupCard.tsx` | تحليل معدلات استهلاك المخزون وأيام التغطية وفترة التوريد عبر المسار `/purchases/reorder` بتصميم مؤسسي قياسي مطابق لـ `installments` مع هيدر النظام وعمود العرض الموحد `document-prototype-column`, وتجميع مقترحات الشراء آلياً حسب الموردين، وتوليد مسودات أوامر شراء مجمعة لكافة الموردين بنقرة واحدة. |
| **أوامر الشراء والصفحة الكاملة المستقلة ومحدد الأصناف والموردين (Purchase Orders & Dedicated Create Page)** | 🟢 | 100% | `PurchaseOrdersPage.tsx`, `CreatePurchaseOrderPage.tsx`, `CreatePurchaseOrderModal.tsx`, `purchase-orders.api.ts`, `SearchableCombobox.tsx`, `combobox-system.css` | إدارة أوامر الشراء وإصدارها للموردين عبر المسار `/purchases/orders`؛ تحويل إنشاء أمر الشراء إلى **صفحة كاملة مستقلة فسيحة** عبر المسار `/purchases/orders/new` مطابقة لمعايير Z-Systems (حاوية 1280px بدون قص)، تدعم حفظ واسترجاع المسودات تلقائياً (`useFormDraft`)، وإدخال بيانات المورد وشروط التوريد والمستودع، وجدول بنود ديناميكي متقدم مزود بمحدد أصناف وموردين (`SearchableCombobox`) يدعم البحث الفوري بالأصناف المسجلة (الاسم، الباركود، الكود) وإمكانية إدخال أصناف جديدة غير مسجلة بالدليل للتعاقد الحر، واحتساب لحظي للإجماليات والخصومات، مع معالجة وتثبيت موضع وطبقات القوائم المنسدلة (`z-index: 10050` و `position: fixed !important`). |
| **طلبات عروض أسعار الموردين ومصفوفة المقارنة الترسية (Vendor RFQs & Quotation Comparison Matrix)** | 🟢 | 100% | `purchase-rfqs.service.ts`, `purchase-rfqs.controller.ts`, `PurchaseRfqsPage.tsx`, `CreateRfqModal.tsx`, `RfqBidsModal.tsx`, `RfqComparisonMatrixModal.tsx`, `PurchasesWorkspace.tsx`, `2040000000067_purchase_rfqs.ts` | دورة مشتريات وتوريد متكاملة تضاهي Odoo 17 و Dynamics 365 BC عبر المسار `/purchases/rfqs` مع زر وصول مباشر في شريط أدوات مساحة المشتريات الرئيسية؛ إنشاء طلبات عروض الأسعار وتحديد بنود الأصناف والكميات المطلوبة وتاريخ الإغلاق، دعوة الموردين، تسجيل عروض الأسعار المتلقاة من كل مورد (سعر الوحدة، مدة التوريد، شروط السداد، وملاحظات الجودة)، مصفوفة مقارنة بصرية تحليلية تبرز العرض الأفضل سعراً والأسرع توريداً، مع ترسية العرض الفائز بنقرة واحدة وتحويله تلقائياً لأمر شراء رسمي معتمد (PO). |
| **دستور وثائق وفورمز المعاملات الكبرى الموحد (Universal Document Form Standard & Template)** | 🟢 | 100% | `UniversalDocumentFormTemplate.tsx`, `CreatePurchaseOrderPage.tsx`, `NewPurchaseOrderPage.tsx`, `document-form-prototype.css` | توحيد معماري وهندسي شامل لكافة صفحات وفورمز الوثائق التجارية (فواتير، أوامر شراء، أوامر بيع، عروض أسعار، أذون صرف)؛ اعتماد معيار الصفحة الكاملة 1280px، هيدر موحد بأزرار القرار أعلى اليسار وشارات الحالة والإجمالي، الفواصل الرأسية الملكية للأقسام (`|`)، شريط الأدوات السريع للجدول والأزرار المتقطعة السفلية، وتوازن الملاحظات يميناً والإجماليات يساراً مع كود مرجعي نموذجي جاهز للنسخ والتطبيق الفوري. |

---


<!-- migrated:cap-030:end -->

<a id="cap-091"></a>
<!-- migrated:cap-091:start -->
## 66. دورة أوامر الشراء واعتماد الموردين والاستلام المخزني (Purchase Orders & Goods Receipt)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Odoo 18 Purchase Orders (PO) & 3-Way Matching Flow.
* **روابط وشاشات الوصول:** `/purchases/orders` (القائمة الجانبية: المشتريات والموردين ➔ أوامر الشراء PO).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000060_purchase_orders_and_unbuild.ts`, `backend/src/database/database.types.ts` (`purchase_orders`, `purchase_order_items`).
  * **الباك إند:** `backend/src/modules/purchases/services/purchase-orders.service.ts`, `backend/src/modules/purchases/controllers/purchase-orders.controller.ts`, `backend/src/modules/purchases/purchases.module.ts`.
  * **الفرونت إند:** `frontend/src/features/purchases/api/purchase-orders.api.ts`, `frontend/src/features/purchases/pages/PurchaseOrdersPage.tsx`, `frontend/src/features/purchases/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **إصدار واعتماد أوامر الشراء الرسمية (Purchase Orders):** إنشاء أوامر شراء بمسودة أولية مع الموردين، حساب المجاميع والضرائب والخصومات، وتأكيد الأمر بنقرة زر واحدة لإرساله للمورد.
  2. **دورة الاستلام المخزني الجزئي والكامل (Goods Receipt Flow):** نافذة مخصصة لإثبات استلام الشحنات والبضائع الواردة، وتغذية أرصدة المخزون الفعلية فورياً، مع تصنيف دقيق لحالة الاستلام (`partially_received` أو `received`).
  3. **التحويل المباشر لفاتورة مشتريات رسمية (Convert to Bill):** تحويل أمر الشراء المستلم بضغطة زر واحدة إلى فاتورة مشتريات مرحلة في حسابات الموردين دون إعادة إدخال البيانات، مع حفظ رقم الفاتورة المرجعي.
  4. **إلغاء وحذف الأوامر المسودة والملغاة:** حوكمة صارمة لمنع التعديل على الأوامر التي تم ترحيلها لفواتير رسمية.

---


<!-- migrated:cap-091:end -->

<a id="cap-096"></a>
<!-- migrated:cap-096:start -->
## 71. طلبات عروض أسعار الموردين ومصفوفة المقارنة والترسية (Vendor RFQs & Comparison Matrix)
* **حالة الوحدة:** 🟢 مكتمل 100% ومطابق لدستور النظام البصري (0 Emojis & Clean Enterprise SaaS).
* **معيار المقارنة الدولي:** Odoo 18 Purchase RFQ & Vendor Tender Comparison Matrix.
* **روابط وشاشات الوصول:** `/purchases/rfqs` (القائمة الجانبية: المشتريات والموردين ➔ طلبات عروض الأسعار RFQ).
* **مسارات الكود الأساسية:**
  * **قاعدة البيانات:** `backend/src/database/migrations/2040000000062_purchase_rfqs.ts`, `backend/src/database/database.types.ts` (`purchase_rfqs`, `purchase_rfq_items`, `purchase_rfq_vendor_bids`).
  * **الباك إند:** `backend/src/modules/purchases/services/purchase-rfqs.service.ts`, `backend/src/modules/purchases/controllers/purchase-rfqs.controller.ts`, `backend/src/modules/purchases/purchases.module.ts`.
  * **الفرونت إند:** `frontend/src/features/purchases/api/purchase-rfqs.api.ts`, `frontend/src/features/purchases/pages/PurchaseRfqsPage.tsx`, `frontend/src/features/purchases/routes.tsx`.
* **الميزات والقدرات المفعلة:**
  1. **إدارة دورة طلبات عروض الأسعار المفتوحة (Purchase RFQs):** إنشاء طلبات تسعير بأصناف وكميات محددة مع تحديد موعد استحقاق نهائي لاستقبال العطاءات.
  2. **تسجيل ومقارنة عروض الموردين المتنافسة (Bid Comparison Matrix):** جدول مقارنة بصري تفاعلي يقارن الأسعار المقدمة ومواعيد التسليم المقترحة وشروط الدفع بين مختلف الموردين.
  3. **الترسية وتوليد أمر الشراء بضغطة زر (1-Click Award to PO):** اختيار العرض الفائز وترسيته بنقرة واحدة لتحويله تلقائياً إلى أمر شراء رسمي (PO) في موديول المشتريات وإغلاق المناقصة.

---


<!-- migrated:cap-096:end -->

<a id="cap-211"></a>
<!-- migrated:cap-211:start -->
## 177. كاشف فواتير الموردين المكررة ورادار التحذير الاستباقي وحوكمة التجاوز (Vendor Duplicate Bill & Fraud Detection Engine)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (29 سبتمبر 2026).
* **المشكلة المعالجة:**
  - تكرار تسجيل فواتير المشتريات من نفس المورد عن طريق الخطأ أو الاحتيال (سواء برقم الفاتورة الورقية للمورد نفسه، أو مع أخطاء إملائية طفيفة مثل استبدال أرقام أو حروف، أو تسجيل فاتورة بنفس المبلغ الدقيق خلال نافذة زمنية متقاربة دون الانتباه لتسجيلها سابقاً).
  - عدم وجود حقل صريح مخصص ومفهرس لرقم فاتورة المورد الورقية (`supplier_invoice_no`) بجانب الرقم المسلسلي للمنظومة (`invoice_number`).
* **الهندسة والحلول المنفذة:**
  1. **هجرة قاعدة البيانات (2040000000170_vendor_duplicate_bill_detection.ts):**
     - إضافة الأعمدة: `supplier_invoice_no` (نصي لرقم فاتورة المورد الأصلية)، `duplicate_override_reason` (مبرر التجاوز بحد أدنى 10 أحرف)، `duplicate_overridden_by` (معرف المستخدم الإداري الذي وافق على التجاوز).
     - إضافة فهارس أداء مركبة فائقة السرعة مع عزل المستأجر الصارم: `idx_purchases_tenant_supplier_inv_no` و `idx_purchases_tenant_vendor_amount_created`.
  2. **محرك الفحص الرياضي الصافي (duplicate-bill-detector.engine.ts):**
     - محرك حسابي نقي وخالٍ من الآثار الجانبية يطبق ثلاث طبقات حماية:
       1. **التطابق القطعي للرقم (Exact Match - HARD_BLOCK):** في حال تطابق رقم فاتورة المورد لنفس المورد بالضبط، يتم حظر العملية قطعياً لمنع ازدواج الصرف.
       2. **كشف الأخطاء المطبعية والتشابه النصي (Levenshtein Distance Typo - WARNING):** رصد التشابه الشديد في رقم الفاتورة (مسافة إيديت 1-2) لتنبيه المستخدم باحتمال وجود خطأ كتابي في رقم الفاتورة لنفس المورد.
       3. **رادار المبالغ المتطابقة في النافذة الزمنية (Identical Amount Heuristic - WARNING):** رصد أي فواتير لنفس المورد بنفس المبلغ الصافي بالضبط خلال نافذة 30 يوماً تنبيهاً لاحتمال تكرار إدخال نفس الفاتورة.
  3. **حوكمة الاستثناءات وفصل المهام (Maker-Checker Governance):**
     - حظر التجاوز العشوائي؛ يقتصر التجاوز على مديري النظام (`admin` / `super_admin`).
     - اشتراط مبرر إداري رسمي لا يقل عن 10 أحرف وتأكيد صريح، وتوثيق هوية المدير الذي وافق في الحقل `duplicate_overridden_by`.
  4. **واجهة المستخدم وتجربة الإدخال السلسة (PurchaseComposer.tsx & VendorDuplicateBillAlert.tsx):**
     - إضافة حقل صريح في ترويسة فاتورة المشتريات: «رقم فاتورة المورد الأصلية (الورقية)».
     - فحص فوري استباقي غير معطل عبر الـ Debounce عند كتابة رقم الفاتورة أو تغيير المورد أو المبلغ.
     - تنبيه مؤسسي متزن (`VendorDuplicateBillAlert`) خالٍ تماماً من الإيموجيز ويعتمد أيقونات المنظومة المعتمدة (`AlertCircleIcon`, `CheckShieldIcon`, `InfoIcon`).
     - تعطيل زر الحفظ تلقائياً في حالة التعارض القطعي ما لم يتم إدخال مبرر التجاوز من قبل المدير المسؤول.
* **الملفات المتصلة:**
  - `backend/src/database/migrations/2040000000170_vendor_duplicate_bill_detection.ts`
  - `backend/src/database/database.types.ts`
  - `backend/src/modules/purchases/engines/duplicate-bill-detector.engine.ts`
  - `backend/test/duplicate-bill-detector.spec.ts`
  - `backend/src/modules/purchases/dto/upsert-purchase.dto.ts`
  - `backend/src/modules/purchases/services/purchases-query.service.ts`
  - `backend/src/modules/purchases/services/purchases-write.service.ts`
  - `backend/src/modules/purchases/purchases.controller.ts`
  - `backend/src/modules/purchases/purchases.service.ts`
  - `frontend/src/features/purchases/api/purchases.api.ts`
  - `frontend/src/features/purchases/schemas/purchase.schema.ts`
  - `frontend/src/features/purchases/contracts.ts`
  - `frontend/src/features/purchases/components/VendorDuplicateBillAlert.tsx`
  - `frontend/src/features/purchases/hooks/usePurchaseComposerController.ts`
  - `frontend/src/features/purchases/components/PurchaseComposer.tsx`
* **التحقق البرمجي:**
  - اختبارات الوحدة للمحرك: `backend/test/duplicate-bill-detector.spec.ts` بنجاح 100% لكافة سيناريوهات المنع والتنبيه والتجاوز.

---


<!-- migrated:cap-211:end -->


## 25 أكتوبر 2026 — منع تغيير مخزن إذن الاستلام بصمت

- راجعنا مسار `GoodsReceiptService.createGoodsReceipt` حتى فحص المورد والمخزن والأصناف وإنشاء رأس وبنود GRN. في السابق، معرف مخزن محدد صراحة وغير موجود في المنشأة كان يسبب اختيار مخزن أمر الشراء أو أول مخزن نشط بدلاً من رفضه. أصبح طلب المخزن الصريح الفاشل يرجع `GRN_LOCATION_NOT_FOUND` قبل إنشاء المستند. لا يزال الطلب الذي لم يحدد مخزناً يستخدم مخزن أمر الشراء ثم المخزن النشط الافتراضي كما كان.
- ملفات التعديل: `backend/src/modules/purchases/services/goods-receipt.service.ts`, `backend/src/modules/purchases/engines/grn-location-policy.engine.ts`؛ اختبار `backend/test/critical/grn-explicit-location.spec.ts` **مكتوب ولم يُشغّل**. التحقق المالي التشغيلي وترحيل GRN ما زال يحتاج اختبارات فعلية ومراجعة تفصيلية قبل الاعتماد.

### P0-C KWD/OMR thousandth-denominated purchase journey — 2026-10-25 (branch-only)

- Vendor invoice normalization/discount allocation and stock receipts preserve the tenant book's 2/3-digit minor unit in `purchases-write.helper.ts`, `purchases-write.service.ts` and `accounting-posting.service.ts`.
- Additive migration `2040000000257_purchase_minor_unit_precision.ts` widens purchase/line/supplier ledger and stock-movement unit-cost columns; down refuses data loss. Unit and disposable PostgreSQL acceptance now verify the 0.001 purchase → supplier/AP → inventory/WAC → GL retry path. CI pending on this SHA; do not merge before it passes.
- This does **not** certify cash/credit returns, multicurrency exchange, sales, three-way GRN, or legacy tenant balances.

### P0-C 2026-10-25 — KWD/OMR supplier/customer payment voucher precision

- Supplier and customer payment endpoints validate the tenant base currency's two/three decimal precision before any transaction; supplier installment-unrestricted balance is also computed at the same scale. `AccountingPostingService` uses that precision when preparing both payment voucher GL journals.
- Disposable PostgreSQL acceptance now exercises 0.001 KWD AP/AR settlement with matching supplier/customer ledger, one cash voucher each, and posted balanced journals. The new SHA's tests must pass before claiming verification.
- FX, schedule aggregation, multi-channel reconciliations and remaining sector modules still require dedicated tests.

### 2026-11-16 — إعادة تصميم بطاقة المورد وكشف الحساب ودعم التصدير PDF وطباعة A4 والريسيت

- **المراجع التنفيذية:**
  - الواجهة وتجربة التعديل (`frontend/src/features/suppliers/pages/SuppliersPage.tsx`، `frontend/src/features/suppliers/pages/suppliers-page/useSuppliersPageController.ts`، `frontend/src/features/suppliers/components/SupplierEditorCard.tsx`، `frontend/src/features/suppliers/components/SupplierForm.tsx`، `frontend/src/features/suppliers/components/SupplierBillForm.tsx`، `frontend/src/features/suppliers/components/SupplierBillsList.tsx`، `frontend/src/styles/partials/features.css`): إعادة هيكلة نافذة تعديل وإضافة المورد ببطاقات مقسمة وشبكات متوازنة (`supplier-modal-fields-3col` / `supplier-bills-split`) مع إزالة الزر العائم فوق التابات وتثبيت ارتفاع منطقة التابات على `min(480px, 68vh)` وضغط محتوى `البيانات الأساسية` ليظهر كاملاً بدون سكرول مع توسيع النافذة إلى `min(620px, 90vh)`، وتوحيد `fontWeight: 600` ومنع `transition` بين التابات، وتصحيح تسميات الحقول التي كانت متأثرة بإزاحة مفاتيح `ar.json` (`s0..s27`) وإزالة الأمثلة الوصفية من الحقول، ومزامنة `selectedSupplier` الحية من قائمة الموردين، وتعديل `supplierFormSchema` للسماح بالأرصدة الائتمانية السالبة، وإصلاح خصائص `SubmitButton` و`MutationFeedback`، واستخراج مصفوفة الحسابات بأمان من `{ accounts }` العائد من `accountingApi.accounts()`، وتبسيط نموذج `SupplierBillForm` إلى **`الوصف *`** و**`المبلغ *`** فقط مع التوجيه المحاسبي التلقائي، وإصلاح تداخل أيقونة البحث في شريط كشف الحساب.
  - دقة وصلاحيات كشف حساب المورد وإبراز الدفعات المقدمة (`backend/src/modules/reports/reports.controller.ts`، `backend/src/modules/reports/services/reports-summary.service.ts`، `backend/src/modules/reports/helpers/reports-ledger.helper.ts`، `frontend/src/shared/api/suppliers.api.ts`، `frontend/src/features/suppliers/components/SupplierStatementTab.tsx`): السماح لحاملي صلاحية `suppliers` بقراءة `/api/reports/suppliers/:id/ledger`، وتمرير `digits` واحتساب `openAdvanceBalance` من `supplier_payments` (بعد التحقق الصريح من وجود أعمدة `is_advance` و`applied_amount`) في `buildSupplierLedgerPayload`، وجلب كل صفحات الكشف عبر `suppliersApi.listAllLedger` افتراضياً منذ البداية (`2000-01-01`) مع خيارات فترة (`آخر 30 يوم` / `الشهر الحالي` / `فترة مخصصة`)، وعرض `resolveEffectiveSupplierPosition` (`لك عند المورد (دفعة مقدمة)` / `مستحق للمورد` / `الحساب متزن`) في البطاقة والكشف، وتصدير PDF ديناميكي بدون قص أفقي للعمود الأيسر (`table-layout: fixed` + `<colgroup>` وعرض `820px`) وطباعة `A4` وريسيت `80mm`/`58mm` خالٍ من إشارة `-` المزدوجة عبر `frontend/src/features/suppliers/lib/supplier-statement-print.ts`.
- **نطاق التحقق والأدلة:**
  - اختبارات الباك إند (`npx ts-node` بفحص صارم لكود الخروج): اجتياز `backend/test/infra/reports-ledger.helper.spec.ts` و`backend/test/critical/customer-supplier-statements.spec.ts` (شاملاً الحالات `1`..`5` والكشف التاريخي الكامل vs آخر 30 يوم) و`backend/test/critical/supplier-advance-overdraft.spec.ts` (بما فيه إثبات `openAdvanceBalance = 1500`) بخروج `0`.
  - اختبارات الواجهة (`npx vitest run`): اجتياز `SupplierEditorCard.spec.tsx` (`2/2`)، `supplier-bills.api.spec.ts` (`17/17`)، `supplier.schema.spec.ts` (`10/10`)، و`supplier-statement.utils.spec.ts` (`4/4`) — إجمالي **4 ملفات / 33 اختباراً**.
- **القيود المعلومة:** تم التحقق عبر Vitest/JSDOM وPGlite مع محاكاة `html2canvas`/`jsPDF` ووظائف الطباعة في الاختبارات؛ وأُجّل `npm run build` و`tsc` و`npm run guards` لحين أمر المستخدم.
