# قدرات المتجر الإلكتروني والمدفوعات والمنصات

[فهرس النظام](SYSTEM_CAPABILITIES.md) · [الخريطة المعمارية](SYSTEM_BLUEPRINT.md) · [قواعد التوثيق](docs/capabilities/README.md)

## النطاق وملكية التوثيق

هذا هو ملف تفاصيل **المتجر الإلكتروني والمدفوعات والمنصات** المعتمد للتحديثات القادمة. مسارات الملكية: `backend/src/modules/storefront/`

**حالة الدليل:** أُعيد تنظيم الوثائق في 25 أكتوبر 2026؛ لم تُعد اختبارات التشغيل في عملية النقل. نسب الجاهزية والتواريخ داخل السجلات المنقولة ادعاءات تاريخية بنطاقها، وليست اعتماداً جديداً. تحقق من الكود والاختبار والـcommit قبل اعتماد أي حالة.

**مجالات مرتبطة:** [المبيعات ونقاط البيع](SALES_CAPABILITIES.md) · [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [المحاسبة والخزينة والقيود](ACCOUNTING_CAPABILITIES.md) · [تكاملات شركات الشحن](SHIPPING_CAPABILITIES.md)

## التحديثات الحالية

عند تعديل قدرة، حدّث وصفها في مكانها أو أضف سجلاً بمعرّف ثابت: السلوك والحدود، مصادر الكود، الاختبارات ونتائجها الفعلية، تاريخ التحقق والـcommit. اربط المجالات المتأثرة دون نسخ تفاصيلها.

## فهرس الأقسام المنقولة

- [1. المتجر الإلكتروني وقنوات البيع الموحدة (Storefront & Omnichannel)](#cap-028)
- [23. بوابات الدفع الإلكتروني الخليجية والدولية (Tap Payments GCC & Stripe Global Integration)](#cap-049)
- [33. محرك الربط والمزامنة مع منصات التجارة الإلكترونية والماركت بليس (Marketplaces Suite - Amazon, Noon, Jumia, Trendyol, Profit Calculator & Studio)](#cap-058)
- [180. إدارة العقود والاشتراكات المتكررة للشركات والفوترة الآلية (B2B Recurring Invoicing & Subscriptions)](#cap-214)
- [Storefront audit follow-up (3 October 2026)](#cap-230)
- [208. منظومة الربط مع المنصات الإلكترونية وتأهيل حسابات التجار (Marketplaces Suite & Seller Onboarding Engine)](#cap-249)

## السجل المنقول من الفهرس المركزي

الأرقام القديمة محفوظة كمرجع تاريخي وقد تتكرر؛ المعرّفات `cap-*` فريدة وثابتة. التكرار السابق لا يعني وجود ميزتين.

<a id="cap-028"></a>
<!-- migrated:cap-028:start -->
## 1. المتجر الإلكتروني وقنوات البيع الموحدة (Storefront & Omnichannel)
* **حالة الوحدة العامة:** 🟢 مكتمل ومراجَع — مراجعة المتجر بمراحلها الثلاث أُغلقت في 21 سبتمبر 2026 (الوصول العام للطلبات والتحصيل، الخصم وطلب الطاولة والمقاسات، الصلاحيات والأسرار والترقيم والمخزون وحد الطلبات). بقي بندان موثقان ليسا أخطاء: O62 (قد يُطلب من الكاشير إذن خصم/سعر عند ترحيل طلب فيه كوبون أو مقاس من السلة) وO63 (المقاسات بلا مخزون مستقل، ومقاس واحد لكل صنف في الطلب)
* **مسارات الكود:** `backend/src/modules/storefront`, `frontend/src/features/storefront`
* **الجداول في قاعدة البيانات:** `tenants`, `settings`, `online_orders`, `storefront_abandoned_carts`, `storefront_coupons`, `storefront_delivery_zones`, `product_reviews`, `products`, `product_categories`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **واجهة الكتالوج العام للمتجر** | 🟢 | 100% | `PublicStorefrontPage.tsx`, `storefront.service.ts` | تصفح الأصناف، الأقسام، شريط البحث الفوري، فرز الأسعار، والمفضلة.<br/>**تحصين سبتمبر 2026 (O52):** الأصناف المحذوفة منطقياً (`is_active = false`) لم تعد تظهر في الكتالوج والبحث وصفحة الصنف، ولا يمكن طلبها أو تقييمها (مع مهلة كاش الكتالوج حتى 5 دقائق للعرض فقط؛ الطلب يُرفض فوراً). |
| **سلة المشتريات التفاعلية** | 🟢 | 100% | `StorefrontCartDrawer.tsx`, `StorefrontProductCard.tsx`, `storefront-variant-pricing.ts`, `online-order-pricing.engine.ts` | درج سلة جانبي، تعديل الكميات (+ و - بنظام RTL صحيح)، وحساب المجاميع فورياً.<br/>**المقاسات (سبتمبر 2026 — SF-4):** المقاس المختار يُرسل مع الطلب ويُسعَّر في السيرفر بنفس قاعدة العرض (سعر مطلق أو الأساس + فرق)، ويظهر اسمه للتاجر وفي الفاتورة وتذكرة المطبخ. **مقاس واحد لكل صنف في الطلب**: اختيار مقاس آخر لنفس الصنف يستبدل السطر مع تنبيه في نافذة المعاينة. الإضافة السريعة لصنف له مقاسات تفتح المعاينة. كمية المعاينة صارت تُحترم عند الإضافة. |
| **نافذة إتمام الطلب المحكمة** | 🟢 | 100% | `StorefrontCheckoutModal.tsx` | تحقق صارم برقم الموبايل المصري (11 رقم: 010/011/012/015)، الاسم، العنوان، وتثبيت زر الطلب Sticky CTA.<br/>**الدفع السريع للعميل الراجع (سبتمبر 2026):** لو بيانات العميل محفوظة على الجهاز وكلها صالحة، تظهر في سطر ملخص واحد («التوصيل إلى: الاسم · الهاتف · العنوان») مع زر «تعديل البيانات» بدل الحقول الثلاثة، فيصبح الطلب ضغطة واحدة. |
| **التحقق الدولي من الهاتف واختيار الدولة (International Phone Selector)** | 🟢 | 100% | `StorefrontCheckoutModal.tsx`, `online_orders` | محدد كود الدولة (مصر 20+، السعودية 966+، الإمارات 971+) مع التحقق التلقائي من طول ورقم الهاتف لكل دولة وتخزين كود الدولة بالطلب. |
| **الاستلام من الفرع / المتجر (Click & Collect / Branch Pickup)** | 🟢 | 100% | `StorefrontCheckoutModal.tsx`, `StorefrontSettingsTab.tsx`, `storefront.service.ts` | خيار الاستلام من الفرع في صفحة الدفع بإلغاء مصاريف التوصيل تلقائياً، مع تفعيل/تعطيل الميزة من إعدادات المتجر وتحديد الفرع والوقت التقديري. |
| **المعاينة السريعة ومشاركة الصنف (Quick View & Social Share)** | 🟢 | 100% | `StorefrontProductQuickViewModal.tsx`, `StorefrontProductCard.tsx`, `StorefrontModals.tsx` | نافذة منبثقة سريعة لتفاصيل الصنف والصورة الكبيرة ومحدد الكميات، مع زر مشاركة فوري عبر واتساب ونسخ رابط الصنف بدقة.<br/>**صورة المقاس (نوفمبر 2026 — SF-12):** اختيار مقاس له `imageUrl` في `metadata.variants` يبدّل الصورة المعروضة لصورة المقاس (ويرجع لصورة الصنف عند غيابها)، وسطر السلة يحمل صورة المقاس المختار؛ الصورة عرض فقط ولا تؤثر في السعر إطلاقاً (SF-4). |
| **شريط تقدم الشحن المجاني التفاعلي واقتراحات السلة (Interactive Free Shipping Progress & Upsell)** | 🟢 | 100% | `StorefrontLiveCartDock.tsx`, `StorefrontFreeShippingBar.tsx`, `StorefrontModals.tsx` | شريط تقدم بصري ديناميكي يحسب المبلغ المتبقي لنيل الشحن المجاني مع سمك ميكرو رشيق (4px)، صف اقتراحات أصناف ذكية (Cross-sell) بنقرة واحدة داخل السلة، ضغط فوتر السلة والأزرار المتجاورة، وتوسيع نافذة نجاح الطلب ديناميكياً لتشغل حتى 90vh وتستوعب حتى 18 صنفاً بأناقة دون أي سكرول خارجي. |
| **تخصيص الهوية البصرية ولون المتجر البراند (Custom Brand Theming)** | 🟢 | 100% | `StorefrontSettingsTab.tsx`, `PublicStorefrontPage.tsx`, `storefront.service.ts` | باليتة ألوان براند متكاملة بستة ألوان جاهزة ومحدد لون مخصص بالهيكس كود، مع حقن متغير CSS `--storefront-primary-color` في كافة مكونات المتجر. |
| **إدارة واسترداد السلات المتروكة (Abandoned Carts Recovery)** | 🟢 | 100% | `storefront_abandoned_carts`, `storefront.service.ts`, `MerchantOnlineOrdersPage.tsx` | التقاط صامت وفوري لبيانات العميل والسلة قبل إتمام الطلب، تبويب مخصص في لوحة التاجر، وزر استرداد فوري بنقرة واحدة يفتح محادثة واتساب مخصصة بمحتوى السلة، مع تمييز السلات المستردة تلقائياً عند إتمام الشراء. |
| **محرك بكسلات التتبع والتسويق (Multi-Pixel Marketing Engine)** | 🟢 | 100% | `storefront-pixel-tracker.ts`, `StorefrontSettingsTab.tsx`, `PublicStorefrontPage.tsx` | تتبع قياسي لأربعة منصات تسويقية (Meta / Facebook Pixel, Google Analytics 4, TikTok Pixel, Snapchat Pixel) لأحداث ViewContent, AddToCart, InitiateCheckout, Purchase. |
| **لوحة مؤشرات الأداء والتحليلات للتاجر (Storefront KPI Analytics Dashboard)** | 🟢 | 100% | `MerchantOnlineOrdersPage.tsx`, `storefront.service.ts` | بطاقات KPI إحصائية فورية أعلى صفحة الطلبات (إجمالي المبيعات، إجمالي الطلبات، متوسط قيمة الطلب AOV، ومعدل التحويل Conversion Rate) مع عداد لحظي للسلات المتروكة. |
| **تتبع الطلبات المباشر «طلباتي»** | 🟢 | 100% | `StorefrontCustomerOrderCard.tsx`, `StorefrontMyOrdersModal.tsx`, `customer-order-refs.ts`, `online-order-access.engine.ts` | شريط مراحل تتبع حي (تم الاستلام ➔ جاري التجهيز ➔ مع المندوب ➔ تم التسليم) مع إمكانية إلغاء وتعديل الطلب وهو pending وغير مسدد.<br/>**تحصين سبتمبر 2026 (SF-1):** كانت القائمة والإلغاء والتعديل تعتمد على رقم الطلب التسلسلي أو البحث برقم الهاتف، فكان أي زائر يقرأ بيانات كل العملاء ويلغي طلباتهم. صار لكل طلب **توكن سري** يُحفظ على جهاز العميل عند الطلب (السيرفر يخزن هاشه فقط) ويُرسل في الرأس `x-order-token`. **أُزيل البحث برقم الهاتف**: القائمة تعرض طلبات هذا الجهاز فقط، والطلبات الأقدم من التحديث لا تظهر للعميل (التاجر يديرها كالمعتاد). متابعة الطلب من جهاز آخر تحتاج دخولاً بـOTP (غير مبني بعد).<br/>**قفل الطلب عند استلامه (SF-6):** بمجرد أن ينزّل الكاشير الطلب في السلة أو يحوّله لفاتورة ينتقل إلى «جاري التجهيز» ولا يستطيع العميل تعديله أو إلغاءه. لو فتح الكاشير الطلب ثم تراجع، يعيده التاجر لـ«قيد الانتظار» من قائمة الحالة.<br/>**رابط التتبع و«اطلب تاني» (سبتمبر 2026):** بعد الطلب يصل العميل رابط متابعة في رسالة واتساب التأكيد (ويظهر في نافذة النجاح مع زر نسخ وزر «إرسال لنفسي على واتساب»)؛ فتحه من أي جهاز يضيف الطلب لـ«طلباتي» على ذلك الجهاز — بلا حساب ولا تسجيل دخول. والطلبات المكتملة أو الملغاة فيها زر «اطلب تاني» يملأ السلة بنفس الأصناف والمقاسات بأسعار اليوم، ويبلغ العميل بأي صنف لم يعد متاحاً.<br/>**تطوير وتحديث أكتوبر 2026:** توسيع النافذة لعرض مؤسسي فخم (`min(760px, 96vw)`) يتيح للمراحل التنفس بسلاسة، تكبير شريط المراحل الحركي (دوائر 38px مع شريط كبسولي متصل)، بطاقة حالة ذكية لكل مرحلة مع زر استفسار واتساب فوري، توحيد رمز العملة `<CurrencySymbol />` في تفاصيل الأصناف والإجماليات، إزالة `window.confirm` كلياً واستبدالها بنافذة تأكيد مدمجة داخلية فخمة تماشياً مع الدستور القياسي للنظام، وترقية أزرار الإجراءات وبطاقة مندوب التوصيل. |
| **ربط بيانات ومحادثة مندوب التوصيل** | 🟢 | 100% | `StorefrontCustomerOrderCard.tsx` | عند خروج الطلب مع المندوب يظهر اسمه ورقمه مع زر اتصال `tel:` ومحادثة واتساب مباشرة `wa.me`. |
| **كوبونات الخصم والعروض الترويجية** | 🟢 | 100% | `StorefrontCouponsManager.tsx`, `coupon.dto.ts`, `storefront.service.ts` | كوبونات خصم (نسبة مئوية مع سقف، مبلغ ثابت، أو شحن مجاني)، حدود استخدام، وتطبيق لحظي في الدفع.<br/>**المرحلة 3 (سبتمبر 2026 — SF-8):** حجز الاستخدام صار داخل معاملة الطلب (الطلب الفاشل لا يستهلك كوبوناً)، وإلغاء الطلب أو تعديله بدون الكوبون يعيد الاستخدام، وتعديل الطلب يعيد تقييم الكوبون بدل إسقاطه. وتخمين الأكواد محدود بـ20 محاولة/10 دقائق لكل IP.<br/>**تحصين سبتمبر 2026 (المرحلة 7):** كان عدّاد الاستخدام يُحدَّث بنمط قراءة-ثم-كتابة (`times_used = القيمة المقروءة + 1`) وفحص `usage_limit` يجري على قراءة غير مقفلة — أي **تحديث ضائع**: طلبان متزامنان يقرآن العدد نفسه ويكتبان الزيادة نفسها، فكوبون محدود بـ100 استخدام كان يمكن استهلاكه أضعاف حدّه تحت الضغط. صار الحجز **ذرياً في عبارة واحدة**: `times_used = times_used + 1` بشرط `(usage_limit IS NULL OR times_used < usage_limit)`، فتفرض قاعدة البيانات الحد على الصف الحي، ويُرفض الطلب برسالة واضحة عند صفر صفوف متأثرة (أي أن طلباً آخر التقط آخر استخدام). |
| **قاعدة الشحن المجاني التلقائي** | 🟢 | 100% | `StorefrontSettingsTab.tsx`, `StorefrontCheckoutModal.tsx` | إلغاء مصاريف التوصيل تلقائياً عند تجاوز سلة العميل حداً أدنى يحدده التاجر مع شريط تقدم تسويقي. |
| **تسعير التوصيل الذكي حسب المنطقة/المحافظة** | 🟢 | 100% | `StorefrontDeliveryZonesManager.tsx`, `delivery-zone.dto.ts` | مصفوفة مناطق وشحن، قوالب جاهزة بضغطة زر (محلي وشحن محافظات)، اختيار المنطقة بدقة، وحساب الفاتورة فورياً.<br/>**تصحيح سبتمبر 2026 (O56):** تعديل العميل لطلبه كان يعيد رسوم التوصيل الثابتة ويسقط المنطقة والشحن المجاني وإعفاء الاستلام. صار الإنشاء والتعديل يستخدمان حساباً واحداً. |
| **تكامل واتساب المباشر والتلقائي** | 🟢 | 100% | `storefront.service.ts`, `whatsapp-gateway.service.ts` | توليد رابط رسالة واتساب منسقة بالتفاصيل، وإشعار فوري عبر بوابة الواتساب عند كل طلب جديد. |
| **استوديو وضبط صور الأصناف** | 🟢 | 100% | `StorefrontProductStudio.tsx`, `image-compressor.ts`, `storefront-media.service.ts` | ضغط الصور، قص، ورفع ومعاينة مباشرة لصور الكتالوج والتصنيفات.<br/>**تخزين الصور (سبتمبر 2026 — SF-9):** الصور (الأصناف والأقسام والبانرات) تُحفظ مرة واحدة في جدول `storefront_media` ويُرسل للمتجر رابط قصير بدل الصورة نفسها، والمتصفح يخزّن كل صورة سنة كاملة. الكتالوج صار صغيراً جداً فيفتح المتجر أسرع، وبدل شاشة التحميل تظهر كروت رمادية بشكل الصفحة. وصارت صورة الصنف تظهر في بطاقة مشاركة واتساب/فيسبوك. نُقلت الصور القديمة تلقائياً (هجرة 135). |
| **بوابات الدفع الإلكتروني المتكاملة (Tap GCC & Stripe & Paymob & XPay & Mock)** | 🟢 | 100% | `storefront-payment.service.ts`, `StorefrontPaymentGatewaysManager.tsx`, `StorefrontOnlinePaymentModal.tsx`, `storefront-public.controller.ts` | دعم متكامل وشامل لـ 5 بوابات دفع رئيسية: **تاب (Tap Payments الخليجية)** لدعم بطاقات مدى السعودية، شبكة كي نت الكويتية، بطاقات ناباس القطرية، وبطاقات بنفت، و **Stripe العالمية** لدعم كافة البطاقات الدولية و Apple Pay و Google Pay، بالإضافة إلى **Paymob** و **XPay** للمدفوعات المصرية و **Sandbox Mock**، مع تأكيد سداد آلي عبر الـ Webhooks وإشعارات واتساب فورية.<br/>**تحصين سبتمبر 2026 (البند 9 و O25):** تحصين كافة نقاط الويب هوك بالفشل المغلق التام (`UnauthorizedException`)، التحقق المشفر من التواقيع الرقمية بـ `crypto.timingSafeEqual`، حماية إعادة الإرسال (300s Replay Protection) لـ Stripe، وحماية الإدمبوتنسية لمنع ازدواجية المعالجة. كما تم تصحيح تحويل طلبات الأونلاين المسددة إلكترونياً إلى مبيعات بحيث تُسجل فوراً بحالة `collected` وتمنع مطالبة مندوب التوصيل للعميل بالدفع نقداً (COD) مرة ثانية. جناح اختبار حرج `storefront-payment-webhooks.spec.ts` بنجاح 100%.<br/>**تحصين 21 سبتمبر 2026 (SF-2 / SF-3):** مسار الدفع التجريبي `mock-pay` كان عاماً بلا أي فحص، وإصلاح «`collected` بمجرد `paid`» جعله طريقاً لتعليم أي طلب مدفوعاً واستلامه بلا تحصيل. صار المحاكي متاحاً **فقط** حين يضع التاجر البوابة في وضع الاختبار، ويتطلب توكن الطلب، ولا يُحتسب تحصيلاً أبداً (`gateway_provider='mock'`). ومع بيانات بوابة حية، فشل الاتصال بالبوابة يُظهر خطأً للعميل بدلاً من شاشة دفع وهمية. جناح `storefront-order-access.spec.ts`.<br/>**حماية مفاتيح البوابات (سبتمبر 2026 — SF-7):** شاشة الإعدادات لم تعد تعرض المفاتيح السرية كاملة؛ تظهر مقنّعة بآخر 4 أحرف فقط، وحفظ الشاشة دون تغييرها لا يمس المفتاح المخزَّن (لتغييره: امسح الحقل والصق المفتاح الجديد). والشاشة تتطلب صلاحية المتجر أو الإعدادات. |
| **لوحة إدارة الطلبات للتاجر** | 🟢 | 100% | `MerchantOnlineOrdersPage.tsx`, `ConvertDeliveryModal.tsx`, `MerchantOrderDetailModal.tsx`, `storefront-pos-loader.ts`, `storefront.service.ts` | متابعة الطلبات، الفلترة حسب الحالة، وتنزيل الطلب بنقرة واحدة في سلة الـ POS أو تحويله مباشرة لفاتورة دليفري مع مندوب.<br/>**تحصين وتطوير سبتمبر 2026:**<br/>1. **إلغاء جماعي محمي بكلمة مرور الأدمن (Bulk Cancel with Admin Gate):** زر مخصص لإلغاء كافة الطلبات المعلقة دفعة واحدة مع نافذة تأكيد عبر `StandardDialog` تطلب إدخال كلمة مرور مسؤول النظام (`role in ('admin', 'super_admin')`)، وتمنع استخدام كلمات مرور الكاشير لمنع التلاعب، مع فك حجز المخزون فورياً لكل صنف (`stock_reserved`) وإعادة تفعيل الكوبونات.<br/>2. **استعلام الأعداد التجميعي السريع (Order Counts Aggregation):** إضافة مسار `/api/storefront/admin/orders/counts` يُرجع أعداد الحالات في ~2ms واستبدال عمليات السحب الدوري في `AppShell` و`PosWorkspaceHeader` به لمنع استنزاف الذاكرة وسحب آلاف الطلبات بالكامل دورياً، مما حل بطء الشاشة الرئيسية وشريط الإشعارات نهائياً.<br/>3. **التقسيم إلى صفحات (Pagination 50/page):** دعم التصفح عبر صفحات (50 طلباً لكل صفحة) مع أزرار التنقل الذكية لتسريع فتح صفحة إدارة الطلبات مهما بلغ عدد الطلبات التاريخية.<br/>**تحصين سبتمبر 2026 (SF-3):** شارة «حالة السداد» في تفاصيل الطلب (مسدد إلكترونياً / تحويل مؤكد / دفع تجريبي غير محصّل / بانتظار تأكيد التحويل / يُحصَّل عند الاستلام)، وزر **«تأكيد استلام التحويل»** لطلبات إنستاباي والمحفظة (`POST admin/orders/:id/confirm-payment`، بصلاحية `storefront` أو `sales`). اختيار العميل لإنستاباي لم يعد يجعل الفاتورة محصّلة: بدون تأكيد التاجر يطالب المندوب بالمبلغ.<br/>**تصحيحات المرحلة 2 (سبتمبر 2026):** خصم الكوبون صار يصل فاتورة الدليفري وسلة الكاشير<br/>**تحصين وتطوير أكتوبر 2026 (دورة عمل المتجر والسلة والتوصيل والتسوية):**<br/>1. **مزامنة حالة الطلب التلقائية عند التسليم:** ربط تسوية المندوب (settleOrder و settleAllOrders) وإثبات التسليم (ecordProofOfDelivery) بجدول online_orders بحيث ينتقل الطلب تلقائياً لحالة delivered في لوحة التاجر وعدادات الـ KPI فور التسليم دون الحاجة لتحديث يدوي.<br/>2. **ضبط طلبات الاستلام الذاتي من الفرع (Pickup):** تصحيح نوع الطلب في prepareOrderForPos و convertToSale ليتحول إلى 	akeaway بدلاً من فرض delivery بدون داعٍ، وإغلاق الطلب تلقائياً كمسلّم فور فوترته دون مطالبة بمندوب توصيل.<br/>3. **تحصين لوحة توجيه طلبات المطاعم (RestaurantDeliveryDispatcherModal):** إلزام تحويل الطلبات الأونلاين المعلقة لفواتير مبيعات وخصم المخزون الحقيقي قبل إسنادها للمندوب، وتحديث الفواتير المرتبطة إلى out_for_delivery.<br/>4. **تطهير التنبيهات المؤسسية:** استبدال تنبيهات المتصفح التقليدية (window.alert و window.confirm) في تطبيق المندوب واستوديو الصور وإدارة الكوبونات بنظام 	oast و systemConfirm القياسي. (كان يضيع فيحصّل المندوب الإجمالي كاملاً)، والطلبات المدفوعة بالبطاقة تُقيَّد على قناة البطاقة/البنك بعد أن كانت تُقيَّد نقداً في درج الكاشير. ملاحظة: التنزيل في سلة الكاشير قد يطلب إذن خصم أو تعديل سعر من الكاشير (O62). |
| **فلترة وتوجيه خيارات الشحن حسب وجهة الطلب (Order Shipping Destination Smart Routing)** | 🟢 | 100% | `order-shipping-destination.ts`, `MerchantOrdersTable.tsx`, `MerchantOrderDetailModal.tsx`, `storefront.service.ts` | توجيه ذكي وخاص لشركات الشحن حسب وجهة العميل: إخفاء شركات الشحن الخليجية (أرامكس وسمسا) عن الطلبات والعملاء داخل مصر مع عرض بوسطة والدليفري الداخلي حصراً، وإتاحة شركات الشحن الخليجية حصراً للطلبات المتجهة للسعودية ودول الخليج. |
| **هندسة وتجربة المستخدم المؤسسية للمتجر (Storefront UI/UX Modernization & Deal Spotlight Engine)** | 🟢 | 100% | `StorefrontDealSpotlight.tsx`, `StorefrontShelfSection.tsx`, `StorefrontBannerCarousel.tsx`, `StorefrontHeader.tsx`, `StorefrontFooter.tsx`, `StorefrontProductQuickViewModal.tsx`, `StorefrontCategoriesModal.tsx`, `storefront-photo-matcher.ts`, `StorefrontLiveCartDock.tsx`, `StorefrontLiveCartItem.tsx`, `StorefrontCartDrawer.tsx`, `StorefrontFilteredGrid.tsx`, `StorefrontLiveCartPill.tsx`, `StorefrontCategoryShowcase.tsx`, `StorefrontProductCard.tsx`, `storefront.css` | تطوير وتحديث معماري وبصري متكامل لواجهة المتجر الإلكتروني العام:<br/>1. **بطاقة المنتجات وشبكة الرفوف:** توحيد عرض البطاقات المريح (`minmax(225px, 1fr)`) مع 5 منتجات للشاشات الكبيرة (>1200px)، 4 للمتوسطة، 3 للتابلت، و2 للموبايل، وتوحيد السعر البارز وشارة التوفير الخضراء الواضحة مع إزالة الزر العائم المشوش للصور.<br/>2. **شريط السلة العائم الذكي:** رسو شريط السلة في الهامش الجانبي الشاغر للشاشات الكبيرة دون تغطية البطاقات، زر إخفاء ناعم بسهم لأسفل وتلميح توضيحي مريح، مع زيادة مساحة التنفس (+20%).<br/>3. **فقاعات الأقسام الدائرية:** عرض دائري نقي متكامل (`object-fit: cover`) مع هوامش دائرية وظلال ناعمة وتقسيم احترافي لاسم القسم وأعداد الأصناف.<br/>4. **البانر الإعلاني والهيدر التفاعلي:** توحيد خط الارتفاع الأفقي للهيدر (`40px Baseline`) مع زري طلباتي وخدمة العملاء، وتحويل البانر لعنصر تفاعلي بانزلاق ناعم للكتالوج وزر كبسولة عائم يساراً متوافق مع نمط القراءة العربي RTL ونقاط تبديل زجاجية بلورية.<br/>5. **العرض المميز ومعالجة المساحات الفارغة (Flagship Deal Spotlight with 3-Column Buy Box):** محرك ذكي لعروض الصنف الواحد (`StorefrontDealSpotlight`) يقسم المساحة العريضة إلى 3 قطاعات متوازنة: صورة كبيرة بدقة عالية يميناً، مواصفات وثلاث شارات ثقة مؤسسية (أصلي ومضمون، شحن سريع، معاينة قبل الدفع) في المنتصف، وصندوق شراء مستقل (Buy Box) على اليسار يضم السعر الكبير، نسبة الخصم، زر الإضافة للسلة أو العداد بالترتيب العربي، والطلب عبر واتساب، ليقضي تماماً على الفراغات ويمنح تجربة مماثلة لكبرى المنصات العالمية (Amazon/Noon).<br/>6. **نافذة المعاينة السريعة وحظر المنتجات غير المسعرة (QuickView & Zero-Price Shield):** إغلاق النافذة بمفتاح `Esc`، توحيد مربع عرض الصور بنسبة مربعة متناسقة 1:1 تمنع التمدد أو التشويه مع خلفية استوديو بيضاء وتمركز مصغرات المعرض، حل مشكلة اختفاء الصور بالاستدعاء التلقائي لـ `resolveProductPhoto`، وحظر المنتجات غير المسعرة (`price <= 0`) من الإضافة للسلة مع استبدال السعر بزر «استفسر عن السعر عبر واتساب» وشارة «تواصل لمعرفة السعر».<br/>7. **تحديث وتنسيق الفوتر المؤسسي (Storefront Footer Modernization):** إعادة تنظيم الروابط السريعة في شبكة ثنائية مدمجة (2-column mini grid) في سطرين بدلاً من التكدس الرأسي، توحيد لون رابط العروض بنفس اللون الرمادي الرصين للروابط بدون أي تمييز فاقع، استبدال زر الواتساب الفوسفوري بزر هادئ فاخر بخلفية خضراء باستيلية راقية، وتوحيد ارتفاع شارات الدفع (28px) وبطاقة الأمان والتشفير (SSL Trust Pill).<br/>8. **هندسة نافذة الأقسام المنقسمة وانعدام السكرول التام (Split-Panel Mega Directory & Zero-Scroll):** القضاء التام على السكرول الداخلي والازدحام عبر هيكل اللوحة المنقسمة أفقياً بعرض `min(1160px, 96vw)` وارتفاع ثابت `540px`: قائمة جانبية يمنى (260px) تضم زر «جميع المنتجات» وأزرار فئات الأقسام الكبرى مع شارات الأعداد وأيقونات معبرة، وشبكة رباعية الأعمدة يسرى (1fr) تعرض ماركات وأقسام الفئة المحددة لحظياً بحركة سلسة دون أي سكرول، مع شارات زجاجية مصنفرة (`frosted pills`) على الصور وصور فريدة لكل ماركة وتطهير كارت صوتيات.<br/>9. **ترقية السلة والفرز الفاخر (Floating Sort Popover & Ultra-Clean Cart Drawer):** استبدال قائمة الفرز الكلاسيكية التابعة لنظام التشغيل (`OS Native Select`) بقائمة عائمة تفاعلية فاخرة (`React Floating Popover`) بزوايا منحنية (12px) وظلال ناعمة وشارة صح على الخيار المختار مع تمييز لوني ديناميكي للزر، حل مشكلة اختفاء صور المنتجات في السلة بالربط التلقائي بمحرك الصور `resolveProductPhoto` وعرض أيقونة بديلة أنيقة في حال تعذر التحميل، تنظيف تكرار السعر والكمية بإخفاء سطر `(السعر × 1)` عندما تكون الكمية قطعة واحدة، وإخفاء شريط الاقتراحات التلقائي في السلة عندما تتجاوز المنتجات 3 أصناف لتوفير أقصى مساحة رؤية مريحة للمنتجات والإجمالي، وهيدر سلة موحد وأنيق مع نافذة تأكيد عائمة لتفريغ السلة بنقرة واحدة وتجربة خالية من الفوضى.<br/>10. **ترقية نافذة إتمام الطلب إلى النظام المنقسم ثنائي الأعمدة (2-Column Split Checkout Architecture):** تحويل نافذة إتمام الطلب `StorefrontCheckoutModal` على الشاشات الكبيرة من أنبوبة ضيقة ومزدحمة (480px) إلى نافذة مؤسسية فاخرة بعرض `min(860px, 95vw)` بنظام العمودين المتوازيين: العمود الأيمن لبيانات الاستلام والتوصيل وتحديد المنطقة وملاحظات مدمجة نظيفة، والعمود الأيسر لطرق الدفع وكود الخصم وعرض الشحن المجاني وبطاقة ملخص الحساب الصافية، مع التكيف التلقائي لشاشات الموبايل كعمود واحد مريح.<br/>11. **التطهير الشامل لرمز الدولار الزائد من النظام بالكامل (Global Literal `$` Elimination):** القضاء التام على طباعة رمز الدولار العشوائي `$ج.م` أو `$` في واجهات المستخدم عبر أكثر من 20 شاشة ومكون (المتجر الإلكتروني، الموارد البشرية، الصيدلية، المخازن، التصنيع، لوحة القيادة، فحص الأسعار، وكوبونات الخصم) التي نتجت عن كتابة الرمز بشكل خاطئ في نصوص JSX.<br/>12. **إعادة هندسة وضغط فوتر الموبايل فائق النعومة بنمط أمازون (Storefront Mobile Footer Ultra-Compression):** إضافة زر شريطي مقتضب في أعلى الفوتر للرجوع لأعلى الصفحة (`Back to Top`) بحركة انسيابية، ضغط شريط الضمان والمميزات من 4 كروت ضخمة إلى شريط ميكرو أفقي بارتفاع 30px، دمج هوية المتجر والعنوان وحظر تكسير اسم المتجر رأسياً، توحيد الروابط السريعة على سطر واحد أفقي متصل يفصل بينها نقاط ناعمة (`الرئيسية • الأقسام • العروض • طلباتي`)، توحيد شارات الدفع المقتصرة على 4 خيارات في سطر واحد مدمج وقفل التشفير أسفلها، وتقليص الفراغات الرأسية بنسبة تفوق 60%، مما خفّض إجمالي ارتفاع الفوتر على الموبايل من ~750px (شاشة كاملة) إلى أقل من ~170px مع بقاء نسخة الديسكتوب كاملة وغنية كما هي.<br/>13. **دعم زر الهروب (`Esc`) الشامل لكافة النوافذ وسلة المشتريات:** ترقية مستمعات أحداث لوحة المفاتيح في `DialogShell` وسلة المتجر العائمة `StorefrontLiveCartDock` ودرج السلة `StorefrontCartDrawer` لتعمل بوضع الالتقاط المباشر (`{ capture: true }`) لإغلاق أي نافذة أو سلة فورياً بمفتاح الهروب `Esc`.<br/>14. **تأمين انكسار عناوين البانرات والعدادات على الموبايل (Atomic Heading Units & Zero-Word Breaking):** فصل جمل العناوين وأعداد الأصناف والأقسام في كتل ذرية مستقلة محمية بـ `whiteSpace: 'nowrap'` مع `flexWrap: 'wrap'` في بانر استكشاف الأقسام وكروت أمازون الرباعية ومودال الأقسام، مما يمنع انكسار الكلمات أو الأقواس بمفردها على الموبايل، ونزول العداد كاملاً ككتلة متماسكة في سطر ثانٍ بالمنتصف عند ضيق الشاشة.<br/>15. **مطابقة لوجو وهوية ماستر كارد الرسمية (Official Mastercard Brand Logo & LTR Layout):** إعادة رسم شارة ماستر كارد في الفوتر برسم متجهي SVG دقيق يحاكي الهوية الرسمية للعلامة التجارية (دوائر متداخلة مع عدسة تداخل برتقالية) مع اتجاه `dir="ltr"` لمنع انقلاب الترتيب في بيئات RTL وكتابة الاسم الرسمي `Mastercard` بحرف M كبير وتيبوجرافي أنيق. |

---


<!-- migrated:cap-028:end -->

<a id="cap-049"></a>
<!-- migrated:cap-049:start -->
## 23. بوابات الدفع الإلكتروني الخليجية والدولية (Tap Payments GCC & Stripe Global Integration)
* **حالة الوحدة العامة:** 🟢 مكتمل 100%
* **مسارات الكود:** `backend/src/modules/storefront/storefront-payment.service.ts`, `backend/src/modules/storefront/storefront-public.controller.ts`, `frontend/src/features/storefront/components/StorefrontPaymentGatewaysManager.tsx`, `frontend/src/features/storefront/components/StorefrontOnlinePaymentModal.tsx`
* **الجداول في قاعدة البيانات:** `online_orders`, `settings`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **بوابة تاب للمدفوعات الخليجية (Tap Payments)** | 🟢 | 100% | `storefront-payment.service.ts`, `storefront-public.controller.ts`, `StorefrontPaymentGatewaysManager.tsx` | ربط مباشر ومكتمل مع API منصة Tap Payments (`api.tap.company/v2/charges`) مع دعم موحد (`src_all`) لبطاقات مدى السعودية 🇸🇦، شبكة كي نت الكويتية 🇰🇼، بطاقات ناباس القطرية 🇶🇦، بطاقات بنفت 🇧🇭، و Apple Pay 🍎. معالجة Webhook تلقائية لتحويل الطلبات إلى مدفوعة وإرسال إشعار الواتساب فورياً. |
| **بوابة سترايب للمدفوعات العالمية (Stripe Global Checkout)** | 🟢 | 100% | `storefront-payment.service.ts`, `storefront-public.controller.ts`, `StorefrontPaymentGatewaysManager.tsx` | تكامل كامل مع Stripe Checkout Sessions لدعم البطاقات الدولية (Visa, MasterCard, Amex) والعملات الأجنبية (USD, EUR, SAR, EGP) و Apple Pay و Google Pay، مع معالجة أحداث الويب هوك وتأكيد السداد التلقائي. |
| **محاكي البطاقات الخليجية والدولية التفاعلي (GCC & Global Card Simulator)** | 🟢 | 100% | `StorefrontOnlinePaymentModal.tsx` | بطاقة بنكية افتراضية تفاعلية تحاكي بطاقات مدى وكي نت وسترايب مع أزرار تعبئة سريعة لأرقام بطاقات الاختبار، تتيح فحص كامل دورة البيع والتأكيد بدون الحاجة لمفاتيح بنكية حقيقية. |
| **إدارة مفاتيح الربط والروابط الآلية للتاجر** | 🟢 | 100% | `StorefrontPaymentGatewaysManager.tsx` | بطاقات إعداد متجاوبة وأنيقة لإدخال المفاتيح السرية والعامة لكل بوابة، تبديل وضع التجربة (Sandbox/Staging)، مع نسخ روابط الـ Webhook بنقرة واحدة. |

---


<!-- migrated:cap-049:end -->

<a id="cap-058"></a>
<!-- migrated:cap-058:start -->
## 33. محرك الربط والمزامنة مع منصات التجارة الإلكترونية والماركت بليس (Marketplaces Suite - Amazon, Noon, Jumia, Trendyol, Profit Calculator & Studio)
* **حالة الوحدة العامة:** مكتمل 100%
* **مسارات الكود:**
  * **الباك إند والخدمات:** `backend/src/modules/storefront/services/marketplace-sync.service.ts`, `backend/src/modules/storefront/controllers/marketplace-sync.controller.ts`, `backend/src/modules/storefront/storefront.module.ts`
  * **الفرونت إند والواجهات:** `frontend/src/features/storefront/api/marketplace-sync.api.ts`, `frontend/src/features/settings/components/workspace-sections/SettingsMarketplacesSection.tsx`, `frontend/src/features/settings/pages/settings.page-config.ts`, `frontend/src/features/settings/pages/SettingsSectionContent.tsx`
* **الجداول في قاعدة البيانات:** `products`, `product_categories`, `online_orders`, `settings`, `audit_logs`, `tenants`

| الميزة التفصيلية | الحالة | نسبة الإنجاز | ملفات التنفيذ الأساسية | الشرح وملاحظات العمل |
| :--- | :---: | :---: | :--- | :--- |
| **محرك الربط والاعتماد لأمازون (Amazon SP-API Integration)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | إعدادات واتصال كامل مع Amazon Selling Partner API (LWA Client ID, Client Secret, Refresh Token, Seller ID, Marketplace ID) مع فحص الاتصال الحي الآلي وتخزين مؤمّن. |
| **محرك الربط والاعتماد لمنصة نون (Noon Marketplace API)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | ربط متكامل مع Noon Marketplace API (Business Identifier, API App Key, Auth Token) مع فحص الاتصال الحي وتحديد وضع التشغيل التجريبي أو الفعلي. |
| **محرك الربط والاعتماد لمنصتي جوميا وترينديول (Jumia & Trendyol Integration)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | دعم الربط السحابي مع Jumia Seller Center و Trendyol Marketplace API لمزامنة الأسعار والأرصدة والشحنات. |
| **حاسبة وهوامش أرباح المنصات («احسبلي» - Profit & Fee Engine)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | محرك حسابي متطور يربط تكلفة الصنف الحقيقية بالـ ERP مع عمولات المنصات حسب الفئة ورسوم الشحن والتجهيز (FBA/FBN) وضريبة القيمة المضافة ونقطة التعادل وصافي الربح وهامش الربح الصافي. |
| **استوديو تجهيز المنتجات وسيو المنصات («ستوديو / ليو» - Listing Studio)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | توليد عناوين احترافية متوافقة مع خوارزميات محركات بحث المنصات (عربي وإنجليزي)، و5 نقاط بيعية رئيسية (Bullet Points)، والكلمات المفتاحية الخلفية (Backend Search Terms)، والوصف التسويقي. |
| **تتبع أسعار المنافسين وصندوق الشراء («بكام» - Buy Box & Repricer Tracker)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | مراقبة أسعار المنافسين وسعر الـ Buy Box لكل صنف مربوط، مع شارات تنبيه ذكية (رابح لصندوق الشراء، في خطر +5%، خاسر للمبيعات) وإمكانية مطابقة السعر الفورية. |
| **تصدير شيتات الرفع الجماعي (1-Click Marketplace Flat File Exporter)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | تصدير الأصناف المربوطة بملفات متوافقة مع قوالب الرفع الرسمية لأمازون (Amazon Inventory Loader TSV) ونون (Noon Catalog CSV) وجوميا وترينديول للرفع المباشر. |
| **محرك مطابقة الأصناف والأكواد (SKU / ASIN Mapping Engine)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | مطابقة أصناف نظام ERP مع أكواد المنصات مع عرض فوري لتكلفة الـ ERP وسعر البيع المحلي ورصيد المخزن ومزامنة الكميات والأسعار المخصصة. |
| **استيراد شيت الأكواد الجماعي (Bulk SKU Mapping Import - CSV & Excel)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | استيراد جماعي لملفات CSV أو لصق أعمدة الإكسيل لمطابقة وتحديث مئات الأصناف دفعة واحدة، مع تحميل نموذج CSV تجريبي، والتحقق الذاتي من الباركود وكود الصنف والاسم. |
| **تسوية كشوف الحسابات وتوليد القيود المزدوجة (Settlement Reconciliation & GL Posting)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | تسوية كشوف الإيداعات الدورية للبنوك من أمازون ونون، فك تشابك العمولات ومصاريف الشحن اللوجستي FBA/FBN والمرتجعات، والتحقق المحاسبي المزدوج الآلي، وإنشاء قيد يومية متزن برقم موحد (`JV-YYMMDD-XXXX`) وتوجيه الحسابات بدفتر الأستاذ. |
| **البث اللحظي للأرصدة والمزامنة الفورية (Live Inventory Push & Real-time Handshake)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | بث فوري ولحظي للأرصدة عبر المنصات المرتبطة بنقرة زر واحدة أو تلقائياً مع تحديث فوري لطوابع المزامنة وحالات الأصناف. |
| **سحب ومحاكاة الطلبات الخارجية وحجز المخزون الفوري (Order Ingestion & Simulator)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | محرك سحب الطلبات الخارجية وإنشاء سجلات تلقائية في `online_orders` مع ربطها بشركات الشحن (`amazon_fbm`, `noon_direct`)، وخصم فوري للمخزون المحلي لتفادي البيع المزدوج، وإرسال تنبيه واتساب فوري لهاتف المالك. |
| **روبوت إعادة التسعير الآلي للـ Buy Box مع حماية الهامش (Automated Repricing Bot & Margin Guard)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | روبوت خوارزمي يرصد أسعار المنافسين وصندوق الشراء تلقائياً، ويعيد تسعير الأصناف صعوداً وهبوطاً للفوز بالـ Buy Box وفق قواعد محددة (`undercut_buy_box`, `match_buy_box`, `undercut_lowest`, `match_lowest`) مع سقف سعري (Ceiling Price) وحد أدنى صارم (Floor Price) يمنع البيع بأقل من التكلفة + 5% هامش أمان. |
| **سير عمل أذونات التوريد لمستودعات FBA و FBN وقوائم التعبئة (FBA / FBN Inbound Shipments & Packing Slips)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | إدارة وتجهيز الشحنات الواردة لمراكز التوزيع بتوليد أرقام موحدة (`FBA-YYMMDD-XXXX` / `FBN-YYMMDD-XXXX`)، وتوزيع الأصناف على الكراتين، مع عدادات RTL قياسية، وتصدير فوري لكشوف التعبئة والباركودات (Carton Packing Slip CSV) المتوافقة مع متطلبات أمازون ونون وحجز الأرصدة بالمستودع المحلي. |
| **مستقبل إشعارات الويب هوك اللحظي (Marketplace Webhooks Receiver Engine)** | مكتمل | 100% | `marketplace-sync.service.ts`, `marketplace-sync.controller.ts` | نقطة استقبال عامة ومؤمّنة للويب هوك (`/api/storefront/marketplaces/webhook/:marketplace`) لالتقاط إشعارات الطلبات الجديدة وتحديثات أسعار الـ Buy Box في أجزاء من الثانية دون الحاجة للاستعلام الدوري (Polling). |
| **الجدولة الخلفية الآلية لروبوت إعادة التسعير (Autonomous Background Repricing Cron)** | مكتمل | 100% | `marketplace-sync.service.ts` | مؤقت خلفي ذكي ينفذ دورياً كل 20 دقيقة عبر كافة المستأجرين (Tenants) لتحديث ومطابقة أسعار المنتجات وصندوق الشراء تلقائياً في الخلفية دون أي تدخل يدوي مع إدارة دورة حياة المعالجة (`OnModuleInit` / `OnModuleDestroy`). |
| **طباعة ملصقات الباركود FNSKU / FBN للطابعات الحرارية وورق A4 (Thermal FNSKU Barcode Label Generator)** | مكتمل | 100% | `SettingsMarketplacesSection.tsx`, `marketplace-sync.api.ts` | توليد وطباعة باركودات الوحدات الفردية المتوافقة مع متطلبات أمازون ونون عبر قوالب رول حراري (50×30 مم، 40×25 مم) وورق A4 مقسم 44 ملصق، مع رسوم باركود متجهات نقية (Pure SVG) ومعاينة حية وتحكم بعدد النسخ عبر عداد RTL القياسي. |
| **فحص الاستلام وعجز الشحنات ومطالبات Safe-T / Dispute الرسمية (FBA/FBN Receiving & Dispute Claims Engine)** | مكتمل | 100% | `marketplace-sync.service.ts`, `marketplace-sync.controller.ts`, `SettingsMarketplacesSection.tsx` | فحص الشحنات عند الاستلام في مستودعات المنصات ورصد القطع المفقودة واحتساب الخسارة المالية بالجنيه، مع توليد تقارير رسمية جاهزة للنسخ لفتح قضايا ومطالبات التعويض (Safe-T Claims لأمازون ونزاعات Noon Dispute) باللغتين العربية والإنجليزية. |
| **لوحة تحليلات وذكاء أعمال الماركت بليس (Marketplace BI & Performance Analytics)** | مكتمل | 100% | `marketplace-sync.service.ts`, `marketplace-sync.controller.ts`, `SettingsMarketplacesSection.tsx` | تبويب تحليلي متقدم يرصد إجمالي المبيعات، صافي التحصيلات البنكية، رسوم المنصات، ومعدل المرتجعات العام (Blended RTO %)، ومقارنة حصص وأرباح المنصات (أمازون، نون، جوميا، ترينديول) مع جدول بأكثر المنتجات مبيعاً وتدفقاً. |
| **معالج تأهيل وفتح حسابات البائعين وفاحص الاعتماد المسبق (Marketplace Seller Onboarding & Pre-Flight Verification)** | مكتمل | 100% | `marketplace-sync.service.ts`, `marketplace-sync.controller.ts`, `SettingsMarketplacesSection.tsx` | تبويب ومعالج متكامل يرشد التاجر خطوة بخطوة لفتح حسابات أمازون، نون، جوميا، وترينديول، مع احتساب مؤشر الجاهزية (Readiness Score %)، وفحص التطابق الحرفي بين اسم الشركة بالسجل التجاري واسم الحساب البنكي (Name Match) لتفادي أسباب الرفض الآلي الشائعة، وقائمة فحص تفاعلية لـ 6 مستندات قانونية ومصرفية. |
| **مولد خطابات التفويض الرسمية لإدارة الحساب (Letter of Authorization - LOA Generator & A4 Print)** | مكتمل | 100% | `marketplace-sync.service.ts`, `SettingsMarketplacesSection.tsx` | توليد خطابات تفويض قانونية معتمدة باللغتين العربية والإنجليزية لتقديمها لفرق التحقق بالمنصات مع أزرار نسخ لحظي وطباعة مباشرة لورقة A4 رسمية مهيأة للختم والتوقيع. |
| **معالج طلب إعفاء الباركود الدولي لأمازون ونون (GTIN / EAN Barcode Exemption Assistant)** | مكتمل | 100% | `marketplace-sync.service.ts`, `marketplace-sync.controller.ts`, `SettingsMarketplacesSection.tsx` | محرك مؤتمت لتوليد خطابات طلب إعفاء الباركود الدولي (GTIN Exemption) للمنتجات المحلية، العلامات الخاصة، والمنتجات اليدوية مع إرشادات التقديم الرسمية في Seller Central لتمكين التاجر من إدراج منتجاته دون شراء باركودات دولية GS1 باهظة التكلفة. |
| **استوديو فحص وتبييض صور المنتجات وضبط المقاس للمنصات (Marketplace Photo Studio & Canvas Optimizer)** | مكتمل | 100% | `SettingsMarketplacesSection.tsx` | استوديو مرئي لفحص صور المنتجات والتأكد من مطابقتها لاشتراطات أمازون ونون (خلفية بيضاء 100%، مقاس مربع 1:1، دقة تتجاوز 1000px لتفعيل التكبير Zoom)، مع معالج Canvas محلي يزيل الخلفية ويضبط الأبعاد إلى 1500×1500px وتصدير الصورة بضغطة زر. |

---

---


<!-- migrated:cap-058:end -->

<a id="cap-214"></a>
<!-- migrated:cap-214:start -->
## 180. إدارة العقود والاشتراكات المتكررة للشركات والفوترة الآلية (B2B Recurring Invoicing & Subscriptions)
* **حالة الوحدة / المعيار:** 🟢 مكتملة ومحمية بنسبة 100% (29 سبتمبر 2026).
* **المسار:** `/sales/subscriptions`.
* **المشكلة المعالجة:**
  - تمكين قطاعات الخدمات، الصيانة، الاستشارات، تراخيص البرمجيات، وعقود التوريد المتكررة من إدارة الاشتراكات الدورية آلياً، بدلاً من الفواتير اليدوية المتكررة التي ينتج عنها نسيان مواعيد الفوترة وضياع إيرادات الشركة.
* **الهندسة والحلول المنفذة:**
  1. **هجرة قاعدة البيانات (2040000000173_b2b_contracts_and_recurring_subscriptions.ts):**
     - إنشاء جدول عقود الاشتراكات (`commercial_subscriptions`) وجدول بنود الاشتراك (`commercial_subscription_lines`).
     - ضبط عزل المستأجر الصارم (`tenant_id`) والفهارس المركبة لسرعة استعلام العقود المستحقة للفوترة اليومية.
  2. **محرك الفوترة الدورية الصافي (subscription-billing.engine.ts):**
     - حساب مدد ودورات الفوترة بدقة تقويمية مطلقة (شهري، ربع سنوي، نصف سنوي، سنوي) دون تأثر بتغيرات فروق التوقيت أو نهايات الشهور (Calendar Clamping).
     - احتساب صافي السطور وضريبة القيمة المضافة والإجمالي المالي بدقة سنتورية.
     - تقييم أهليّة العقد للفوترة (`isDueForBilling`) والتحقق من التجديد التلقائي وانتهاء العقود غير المجددة.
     - تغطية شاملة باختبارات الوحدة (`backend/test/subscription-billing-engine.spec.ts`) بنجاح 100%.
  3. **خدمة الباك إند ووحدة التحكم (commercial-subscription.service.ts & commercial-subscription.controller.ts):**
     - إنشاء العقود، الترقيم المتسلسل التلقائي القياسي (`SUB-YYMMDD-XXXX`).
     - توليد الفواتير الآلية للمستحق (`generateDueInvoices`) وإدراج فاتورة المبيعات الآجلة برقم مستندي (`SUB-INV-YYMMDD-XXXX`) وترحيل تاريخ الفوترة القادم في معاملة ذرية.
     - تعديل حالات العقد (نشط، موقوف مؤقتاً، ملغي، منتهي).
  4. **واجهة المستخدم التفاعلية (SubscriptionsListPage.tsx & CreateSubscriptionModal.tsx):**
     - لوحة مؤشرات أداء حية: العقود النشطة، الإيراد الشهري المتكرر التقريبي (MRR)، إجمالي الفواتير الصادرة، والعقود المستحقة اليوم.
     - زر تحكم فوري لتشغيل محرك الفوترة وتوليد فواتير العقود المستحقة بنقرة واحدة مع تأكيد تفاعلي وإشعارات نجاح بعدد الفواتير المولدة.
     - نافذة منبثقة معيارية لإنشاء العقود ببنود متعددة متوافقة مع دستور النوافذ ودستور العدادات RTL وسياسة 0 إيموجيز.
* **الملفات المتصلة:**
  - `backend/src/database/migrations/2040000000173_b2b_contracts_and_recurring_subscriptions.ts`
  - `backend/src/database/database.types.ts`
  - `backend/src/modules/sales/engines/subscription-billing.engine.ts`
  - `backend/test/subscription-billing-engine.spec.ts`
  - `backend/src/modules/sales/dto/commercial-subscription.dto.ts`
  - `backend/src/modules/sales/services/commercial-subscription.service.ts`
  - `backend/src/modules/sales/controllers/commercial-subscription.controller.ts`
  - `backend/src/modules/sales/sales.module.ts`
  - `frontend/src/features/sales/api/commercial-subscriptions.api.ts`
  - `frontend/src/features/sales/components/CreateSubscriptionModal.tsx`
  - `frontend/src/features/sales/pages/SubscriptionsListPage.tsx`
  - `frontend/src/features/sales/routes.tsx`
  - `frontend/src/app/router/access.ts`
* **التحقق البرمجي:**
  - اختبارات الوحدة للمحرك: `backend/test/subscription-billing-engine.spec.ts` بنجاح 100% لكافة سيناريوهات الترحيل الزمني وحساب الضرائب والإلغاء والتجديد.

---


<!-- migrated:cap-214:end -->

<a id="cap-230"></a>
<!-- migrated:cap-230:start -->
## Storefront audit follow-up (3 October 2026)

- Gateway callbacks verify a matching payment session, currency and exact amount while the order is locked. Late/mismatched/additional payments are flagged for merchant review instead of silently confirming an unreserved order. POS conversion is blocked for unresolved gateway payments and review/failed orders.
- Idempotent order retries can recover the order's access token from a server-secret-derived token; stale edits and concurrent coupon/stock release conflicts are rejected or rolled back. Offer dates use the tenant business timezone, and BOGO badges are visible without falsely discounting a single unit.
- Quantity-dependent offer totals shown in the browser can differ from the final server-calculated checkout amount. A server quote and explicit shopper acceptance remain open work. No tests, typechecks, provider sandbox callbacks or load benchmarks were run in this audit environment.


<!-- migrated:cap-230:end -->

<a id="cap-249"></a>
<!-- migrated:cap-249:start -->
## 208. منظومة الربط مع المنصات الإلكترونية وتأهيل حسابات التجار (Marketplaces Suite & Seller Onboarding Engine)

- **الحالة:** مكتمل ومعتمد 100% (Completed & Verified).
- **نسبة الإنجاز:** 100%.
- **الوصف التشغيلي:**
  1. **معالج تأهيل واعتماد حسابات التجار المسبق (Seller Onboarding & Verification Engine):**
     - فحص ومطابقة بيانات المنشأة مع متطلبات أمازون مصر (Amazon Egypt)، نون (Noon)، جوميا، وترينديول لتفادي الرفض الآلي (Rejection Shield).
     - التمييز الآلي الصارم بين الكيان التجاري (شركة / مؤسسة) والبائع الفردي؛ وإلزامية السجل التجاري والبطاقة الضريبية وحساب بنكي للشركات، مع توضيح حقول الأفراد.
     - فحص تطابق الاسم بالسجل التجاري مع اسم صاحب الحساب البنكي بالحرف (Name Match) بنسبة تطابق تفوق 98% لتفادي الحظر الفوري.
     - التوليد الآلي لخطاب التفويض الإداري والبنكي المعتمد (Letter of Authorization - LOA) باللغتين العربية والإنجليزية جاهزاً للطباعة والختم.
      - **الحفظ المرحلي التراكمي للبيانات وسرعة الكتابة الفائقة (Progressive Draft Saving & 0ms Input Isolation):** إمكانية حفظ ما يتوفر من بيانات لدى التاجر جزئياً دون اشتراط ملء كافة الحقول دفعة واحدة؛ مع عزل نافذة الإدخال في مكون مستقل ومحمي بـ React.memo لمنع إعادة رسم الشاشة الرئيسية الضخمة عند كل نقرة زر، وتأخير حفظ المسودة في جلسة المتصفح (Debounced 500ms Session Storage) لتحقيق استجابة لحظية كاملة (0ms Latency) أثناء الكتابة، مع تحديث مؤشر الجاهزية بما تم إدخاله، وتوفير زرين مخصصين للحفظ («حفظ ما تم إدخاله ومتابعة لاحقاً» و «حفظ وتحديث مؤشر الجاهزية») مع شريط عداد ونسبة إنجاز لحظية (Progress Bar) وتوضيح أن علامة (*) تعبر عن متطلبات المنصات النهائية فقط دون منع الحفظ المرحلي.
     - **التوجيه المباشر لكل بيان وفتح الأقسام المستهدفة (Targeted Section Routing):** ربط كل بطاقة من بطاقات قائمة التحقق السبعة بقسمها المخصص بدقة متناهية؛ فبطاقة خطاب التفويض تفتح مباشرة نافذة الخطاب (LOA Generator) للطباعة والنسخ، وبطاقة الحساب البنكي تفتح مباشرة قسم الآيبان والبنك، وبطاقة السجل تفتح قسم السجل والكيان، وبطاقة الضرائب تفتح قسم الضرائب، مع توفير شريط تبويبات سريع أعلى النافذة للتنقل اللحظي بين الأقسام (0ms) أو استعراض كافة الحقول معاً.
  2. **محرك حساب هوامش الأرباح ورسوم المنصات (Profit & Fee Engine):**
     - جلب تلقائي لبيانات التكلفة وسعر البيع من المخزن المحلي بالـ ERP.
     - احتساب عمولة المنصة المحدثة (Referral Fee)، رسوم الشحن والتجهيز (FBA/FBN)، رسوم الإغلاق، وضريبة القيمة المضافة بدقة متناهية.
     - استخراج صافي الربح الحقيقي، نسبة هامش الربح، وأدنى سعر للتعادل (Break-Even Price) لحماية التاجر من البيع بخسارة.
  3. **استوديو تجهيز المنتجات وسيو المنصات (Listing Studio):**
     - توليد عناوين بيعية تنافسية محسنة للسيو ثنائية اللغة متوافقة مع خوارزميات محركات البحث (A9) بحدود 200 حرف دون مخالفات تسويقية.
     - صياغة النقاط البيعية الخمس المقنعة (5 Key Bullet Points) لرفع نسبة التحويل (Conversion Rate).
     - استخراج الكلمات المفتاحية الخلفية (Amazon Backend Search Terms) دون تكرار أو علامات ترقيم.
     - ميزة نسخ كامل محتوى القائمة بضغطة زر واحدة (1-Click Full Listing Copy).
     - بطاقات تفاعلية لإرشادات الإدراج المعتمدة وفاحص مقاسات الصور ومتطلبات الخلفية البيضاء النقية (RGB: 255, 255, 255).
  4. **مطابقة الأكواد وروبوت الأسعار وصندوق الشراء (SKU Mapping & Buy Box Repricer):**
     - ربط أكواد الـ ASIN و Partner SKU بأصناف المخزن المحلي لمزامنة الكميات الحية ومنع البيع على المكشوف (Overselling).
     - روبوت تتبع أسعار المنافسين والـ Buy Box وإعادة التسعير التلقائي بهامش محدد مع الالتزام بالحد الأدنى للربح (Floor Price).
     - تصدير شيتات الرفع المباشر المعتمدة (Amazon TSV & Noon CSV).
     - تحميل فوري لنموذج شيت الربط المعتمد (.CSV) وتسهيل الاستيراد الجماعي للمطابقة.
  5. **أذونات التوريد لمستودعات المنصات (FBA & FBN Inbound Shipments):**
     - حجز المخزون المحلي فور إنشاء الإذن لتفادي التكرار البيعي.
     - طباعة كشوف التعبئة الرسمية (Packing Slip) وملصقات الكراتين الخارجية موجهة لمراكز التوزيع (مثل CAI1 العاشر من رمضان أو EG01 ويست كابيتال).
     - طباعة باركودات المنتجات FNSKU بمقاسات الطابعات الحرارية المعتمدة (50x30 و 40x25).
  6. **تطهير شامل لكافة المصطلحات العامية وحظر الإيموجيز والأيقونات المحظورة:**
     - استبدال كافة التسميات العامية بمصطلحات مؤسسية رصينة تتوافق مع دستور النظام.
- **الملفات المعدلة:**
  - `backend/src/modules/storefront/services/marketplace-sync.service.ts`
  - `backend/src/modules/storefront/controllers/marketplace-sync.controller.ts`
  - `frontend/src/features/storefront/api/marketplace-sync.api.ts`
  - `frontend/src/features/settings/components/workspace-sections/SettingsMarketplacesSection.tsx`

---


<!-- migrated:cap-249:end -->

<a id="storefront-reservation-scheduler"></a>
### مجدول إلغاء الحجوزات المنتهية وفك حجب المخزون (Automated Reservation Reaper)
- **السلوك الحالي والحدود:** خدمة خلفية دورية تمنع هجمات حجب المخزون (Denial-of-Inventory) حيث تفحص كل دقيقتين الطلبات المعلقة غير المدفوعة وتلغي حجز كمياتها وتعيد تفعيل كوبوناتها تلقائياً، مع مسح انتهازي سريع عند إنشاء أي طلب جديد.
- **حالة التنفيذ:** موجود ومعتمد.
- **مصدر التنفيذ:** `backend/src/modules/storefront/services/storefront-reservation-scheduler.service.ts`، `backend/src/modules/storefront/storefront.module.ts`، `backend/src/modules/storefront/storefront.service.ts`.
- **المجالات المتأثرة:** [المخزون والمستودعات](INVENTORY_CAPABILITIES.md) · [المبيعات ونقاط البيع](SALES_CAPABILITIES.md).
- **التحقق:** بناء الباك إند بنجاح (exit code 0) والتأكد من تركيب الخدمة في دورة حياة التطبيق (`OnApplicationBootstrap`, `OnModuleDestroy`).
