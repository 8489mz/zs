# قدرات المرتجعات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **المرتجعات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/returns/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المبيعات ونقاط البيع](SALES_CAPABILITIES.md) · [المشتريات والموردون](PURCHASES_CAPABILITIES.md) · [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md)

## التحديثات الحالية

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

## نقطة البداية من التنفيذ

لم يكن لهذا المجال قسم مستقل في السجل القديم؛ لا يعني ذلك عدم وجوده.

مرتجعات البيع والشراء وربط البنود بالمصدر وحركة المخزون وتسوية الطرف والترحيل. المصدر: `backend/src/modules/returns/returns.service.ts`. راجع أيضاً ملفات المبيعات والمشتريات والمخزون والمحاسبة قبل تغيير الدورة.

حالة التغطية: وصف حدود من خريطة النظام، وليس تدقيقاً تفصيلياً أو نتيجة اختبارات جديدة. يلزم استكمال قائمة العمليات واختبارات كل عملية أثناء مراجعة المجال.

### P0-C 2026-10-25 — KWD/OMR return and partner settlement precision (review branch)

- Sales and vendor return sources now use tenant monetary minor units for cumulative line-value allocation, credited/refunded amounts and historical inventory cost movements. Refund tender split and supplier payable allocation preserve 0.001; `AccountingPostingService` uses the same digits for return journal line aggregation. Additive migration 259 widens posted return values without lossy rollback.
- Critical pure tests verify 0.001 returns and receivable/cash tender routing. Disposable real PostgreSQL acceptance covers return source, AR/AP, physical stock and posted balanced journals. Results pending on the new SHA; partial refunds, taxed multi-item mixed tenders, exchanges and historical reconciliation remain open.

### INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT 2026-11-12 — وضعا مرتجع لخصم الفاتورة: السعر الأصلي أو إلغاء الخصم

- خصم الفاتورة (header) قد يكون مشروطاً بكمية الصفقة (صفقة bundle) أو عاماً، والسيستم لا يعرف أيهما، فالاختيار بيد التاجر في كل مرتجع — زراران جنب بعض قبل الحفظ: (1) "إرجاع بالسعر الأصلي" يرد صافي السطر المسجل بعد توزيع الخصم (267 للقطعة) والخصم يفضل سارياً على الباقي؛ (2) "إرجاع بإلغاء الخصم" يلغي خصم الفاتورة بالكامل ويعيد تسعير القطع المتبقية بالسعر الأصلي؛ المبلغ المسترد = إجمالي الفاتورة − ما سبق رده من بضاعة − صافي الباقي بالسعر الأصلي (مرساة على مستوى الفاتورة، فالمرتجعات المتتابعة تبقى دقيقة حتى بعد رد سابق بالقاعدة التناسبية القديمة). مثال مثبت: 3×300=900، خصم 100، مدفوع 800 — رد قطعتين = 533.33 بالسعر الأصلي و 500 بإلغاء الخصم، رد قطعة = 266.67 و 200. لا يُرد بسعر القطعة الإجمالي أبداً. الوضع المختار يُسجَّل على مستند المرتجع (`header_discount_mode`، والقيمة الملغاة تُسجَّل فقط عند اختيار وضع الإلغاء فعلاً).
- شاشة المرتجع تعرض المبلغين من معاينة الخادم (المدفوع، الباقي بالسعر الأصلي، المحسوبان، سقف التسوية الودية) قبل الحفظ، ولا تحسب أي مبلغ محلياً. تجاوز ودي محدود حتى سعر القطع المرتجعة الإجمالي، بسبب واضح واعتماد مدير لغير الأدمن (الأدمن: تنبيه فقط)، ويسري على الرقم المختار أياً كان الوضع؛ يُسجَّل كبندي `goodwill_amount`/`goodwill_reason` منفصلين مع `forfeited_header_discount` على مستند المرتجع (ترحيل 0318). إلغاء الخصم مع الاستبدال مرفوض (FORFEIT_EXCHANGE_NOT_SUPPORTED). القطع المرتجعة ترجع بتكلفتها المجمدة؛ القيد والخزنة يتبعان الإجمالي المعاد تسعيره. خصم السطر يبقى على القطع المحتفظ بها ويُعكس على المرتجعة.
- المصدر: `backend/src/modules/returns/engines/conditional-header-discount-return.engine.ts`، `backend/src/modules/returns/returns.service.ts` (computeForfeitForReturn)، `frontend/src/features/returns/components/ReturnsCreateModal.tsx` + `ReturnsWorkspace.tsx`.
- الاختبار: `backend/test/critical/returns-conditional-discount-forfeit.spec.ts` (محرك E1–E8 + خدمة S1–S12 على PGlite: الوضعان 500/200 مقابل 533.33/266.67، التسوية الودية في الوضعين، رفض الكاشير في الوضعين، تفاعل خصم السطر 170/200، المرتجع المتتابع، الاستبدال) — أخضر محلياً؛ إثبات الإزالة: إبقاء الخصم حياً على القطع المحتفظ بها يعطي 533.33 فيفشل السبك. `ReturnsCreateModal.spec.tsx` (7 حالات: الزراران والتبديل والتسوية الودية لكل وضع). النتائج النهائية على الـSHA الجديد بعد الدفع؛ لم تُختبر حياً بعد النشر، والعميل الأوفلاين يحتاج بناء exe جديد.
