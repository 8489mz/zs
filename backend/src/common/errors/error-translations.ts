const ERROR_CODE_MESSAGES: Record<string, string> = {
  INTERNAL_ERROR: 'حدث خطأ داخلي في الخادم.',
  VALIDATION_ERROR: 'البيانات المرسلة غير صحيحة.',
  HR_EMPLOYEE_NO_EXISTS: 'رقم الموظف مستخدم بالفعل.',
  HR_EMPLOYEE_NO_INVALID: 'رقم الموظف يجب أن يكون أرقامًا فقط مثل 001.',
  HR_EMPLOYEE_NAME_REQUIRED: 'اسم الموظف مطلوب.',
  DAMAGE_NOTE_REQUIRED: 'لازم تكتب سبب في خانة الملاحظات.',
  LOCATION_BRANCH_MISMATCH: 'الموقع المختار لا يتبع الفرع المحدد.',
  FORBIDDEN: 'غير مسموح بتنفيذ هذه العملية.',
  UNAUTHORIZED: 'غير مصرح لك بالوصول.',
  CUSTOMER_EXISTS: 'يوجد عميل بنفس الاسم بالفعل.',
  CUSTOMER_NOT_FOUND: 'العميل غير موجود.',
  CUSTOMER_NAME_REQUIRED: 'اسم العميل مطلوب.',
  CUSTOMER_HAS_BALANCE: 'لا يمكن حذف العميل لأن لديه رصيدًا قائمًا.',
  CUSTOMER_HAS_CREDIT: 'لا يمكن حذف العميل لأن لديه رصيدًا دفتريًا.',
  CUSTOMER_HAS_HISTORY: 'لا يمكن حذف العميل لأن لديه سجل حركات أو تاريخًا ماليًا.',
  SUPPLIER_EXISTS: 'يوجد مورد بنفس الاسم بالفعل.',
  SUPPLIER_NOT_FOUND: 'المورد غير موجود.',
  SUPPLIER_NAME_REQUIRED: 'اسم المورد مطلوب.',
  SUPPLIER_HAS_BALANCE: 'لا يمكن حذف المورد لأن عليه رصيدًا قائمًا.',
  SUPPLIER_HAS_HISTORY: 'لا يمكن حذف المورد لأن لديه سجل حركات أو تاريخًا ماليًا.',
  SUPPLIER_IN_USE: 'لا يمكن حذف المورد لأنه مرتبط بأصناف موجودة.',
  /* INV-SUPPLIER-ADVANCE-UI-WIRING: the advance flow's codes had no
   * Arabic mapping, so every one of them surfaced as the generic
   * 'تعذر تنفيذ العملية المطلوبة.' (live: a 200 advance for a
   * zero-balance supplier failed SUPPLIER_NO_BALANCE with no usable
   * message). */
  SUPPLIER_NO_BALANCE: 'لا يوجد رصيد مستحق لهذا المورد — سجّل المبلغ كدفعة مقدمة بدلًا من سداد.',
  SUPPLIER_OVERPAYMENT: 'المبلغ أكبر من الرصيد المستحق للمورد — سدد المستحق فقط أو سجّل الزيادة كدفعة مقدمة.',
  SUPPLIER_ADVANCE_NOT_FOUND: 'الدفعة المقدمة غير موجودة.',
  SUPPLIER_ADVANCE_NOT_ADVANCE: 'هذا السند ليس دفعة مقدمة — لا يمكن تطبيقه على مستحقات.',
  SUPPLIER_ADVANCE_OVERAPPLY: 'المبلغ أكبر من المتبقي من الدفعة المقدمة.',
  SUPPLIER_ADVANCE_EXCEEDS_PAYABLE: 'المبلغ أكبر من الرصيد المستحق للمورد.',
  SUPPLIER_ADVANCE_PURCHASE_MISMATCH: 'الدفعة المقدمة تُطبق فقط على فاتورة شراء مفتوحة لنفس المورد.',
  CATEGORY_EXISTS: 'يوجد قسم بنفس الاسم بالفعل.',
  CATEGORY_NOT_FOUND: 'القسم غير موجود.',
  CATEGORY_NAME_REQUIRED: 'اسم القسم مطلوب.',
  CATEGORY_IN_USE: 'لا يمكن حذف القسم لأنه مرتبط بأصناف موجودة.',
  PRODUCT_EXISTS: 'يوجد صنف بنفس الاسم أو الباركود بالفعل.',
  PRODUCT_NOT_FOUND: 'الصنف غير موجود.',
  PRODUCT_NAME_REQUIRED: 'اسم الصنف مطلوب (بالعربية أو الإنجليزية).',
  STYLE_CODE_EXISTS: 'هذا الكود مستخدم بالفعل في صنف سابق.',
  STYLE_CODE_INVALID: 'كود المجموعة / الصنف الرئيسي يجب أن يكون أرقامًا فقط.',
  PRODUCT_HAS_STOCK: 'لا يمكن حذف الصنف لأن عليه مخزونًا حاليًا.',
  PRODUCT_HAS_HISTORY: 'لا يمكن حذف الصنف لأن له حركات أو تاريخًا سابقًا.',
  STOCK_UPDATE_FORBIDDEN: 'لا يمكن تعديل المخزون من شاشة بيانات الصنف. استخدم شاشة المخزون أو التسوية.',
  STOCK_COST_EDIT_FORBIDDEN: 'لا يمكن تعديل تكلفة المخزون الحالي مباشرة بدون تسوية مخزنية.',
  PRICE_CHANGE_FORBIDDEN: 'تعديل الأسعار يتطلب صلاحية تعديل الأسعار.',
  DISCOUNT_CHANGE_FORBIDDEN: 'تعديل الخصم يتطلب صلاحية تعديل الخصم.',
  CUSTOMER_PRICE_INVALID: 'سعر العميل غير صحيح.',
  CASHIER_SHIFT_NOT_FOUND: 'الوردية غير موجودة.',
  SHIFT_NOT_FOUND: 'الوردية غير موجودة.',
  SHIFT_ALREADY_OPEN: 'يوجد وردية مفتوحة بالفعل لهذا المستخدم.',
  SHIFT_ALREADY_CLOSED: 'الوردية مغلقة بالفعل.',
  SHIFT_CLOSED: 'لا يمكن تنفيذ العملية على وردية مغلقة.',
  SHIFT_FORBIDDEN: 'غير مسموح لك بتنفيذ هذه العملية على هذه الوردية.',
  SHIFT_OPEN_FAILED: 'تعذر فتح الوردية.',
  MANAGER_PIN_INVALID: 'رمز اعتماد المدير غير صحيح.',
  DRAWER_COUNTERPART_SAME_AS_CASH: 'لا يمكن تحويل النقدية إلى حساب الدرج نفسه؛ اختر حساب الخزنة الآمنة (1111) أو البنك.',
  DRAWER_COUNTERPART_REQUIRED: 'اختر الحساب المقابل للتحويل (الخزينة الآمنة أو البنك).',
  MANAGER_PASSWORD_INVALID: 'كلمة مرور المدير غير صحيحة.',
  MANAGER_PASSWORD_REQUIRED: 'كلمة مرور المدير مطلوبة.',
  MANAGER_AUTH_REQUIRED: 'رمز اعتماد المدير مطلوب لتنفيذ هذه العملية.',
  SALE_ITEMS_REQUIRED: 'لا يمكن حفظ فاتورة بدون أصناف.',
  SALE_EDIT_REASON_REQUIRED: 'سبب التعديل مطلوب.',
  HELD_DRAFT_ITEMS_REQUIRED: 'لا يمكن تعليق فاتورة بدون أصناف.',
  OPEN_SHIFT_REQUIRED: 'يجب فتح وردية كاشير أولاً.',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'البيع الآجل يتطلب تحديد عميل.',
  AMOUNT_INVALID: 'المبلغ يجب أن يكون أكبر من صفر.',
  COUNTED_CASH_INVALID: 'المبلغ المعدود غير صحيح.',
  NOTE_TOO_SHORT: 'اكتب سببًا أو ملاحظة واضحة لا تقل عن 8 أحرف.',
  SESSION_NOT_FOUND: 'الجلسة غير موجودة.',
  USER_NOT_FOUND: 'المستخدم غير موجود.',
  USER_EXISTS: 'يوجد مستخدم بنفس الاسم بالفعل.',
  USER_HAS_TRANSACTIONS: 'لا يمكن حذف هذا المستخدم لوجود فواتير أو حركات مخزنية مسجلة باسمه. يمكنك تعطيل حسابه بدلاً من الحذف للحفاظ على السجلات المالية.',
  INVALID_BACKUP_PATH: 'مسار المجلد غير صالح أو يحتوي على رموز غير مسموحة.',
  BACKUP_FOLDER_NOT_WRITABLE: 'تعذر الوصول أو الكتابة في مجلد النسخ الاحتياطي المحدد. تأكد من صحة المسار وصلاحيات الكتابة.',
  USERNAME_REQUIRED: 'اسم المستخدم مطلوب.',
  PASSWORD_REQUIRED: 'كلمة المرور مطلوبة.',
  PASSWORD_TOO_WEAK: 'كلمة المرور الجديدة قصيرة جداً؛ يجب ألا تقل عن الحد الأدنى المطلوب لدورك.',
  CURRENT_PASSWORD_INVALID: 'كلمة المرور الحالية غير صحيحة.',
  SETTINGS_INVALID: 'بيانات الإعدادات غير صحيحة.',
  APP_BOOTSTRAP_REQUIRED: 'يجب إكمال تهيئة النظام أولًا.',
  PURCHASE_NOT_FOUND: 'فاتورة الشراء غير موجودة.',
  SALE_NOT_FOUND: 'فاتورة البيع غير موجودة.',
  PAYMENT_NOT_FOUND: 'عملية الدفع غير موجودة.',
  LEDGER_ENTRY_NOT_FOUND: 'قيد الحساب غير موجود.',
  LOCATION_NOT_FOUND: 'الموقع غير موجود.',
  BRANCH_NOT_FOUND: 'الفرع غير موجود.',
  LOCATION_NAME_REQUIRED: 'اسم الموقع مطلوب.',
  BRANCH_NAME_REQUIRED: 'اسم الفرع مطلوب.',
  INVENTORY_ADJUSTMENT_INVALID: 'بيانات حركة المخزون غير صحيحة.',
  NO_STOCK: 'لا يوجد مخزون كافي لنقله في الموقع المصدر.',
  INVENTORY_COST_MISSING: 'الصنف ليس له سعر تكلفة مسجل لتوليد القيد المالي.',
  LEDGER_POSTING_MISSING: 'تعذر إنشاء قيد اليومية المالي للعملية.',
  TRANSFER_SERIALS_REQUIRED: 'يرجى تحديد أرقام السيريال المطلوب صرفها.',
  TRANSFER_SERIALS_INSUFFICIENT: 'رصيد السيريالات المتاحة في المخزن غير كافٍ لتغطية الكمية.',
  TRANSFER_SERIALS_NOT_AVAILABLE: 'أرقام السيريال المحددة غير متوفرة في مخزن الصرف.',
  TRANSFER_BATCH_ALLOCATION_REQUIRED: 'يرجى تحديد تشغيلات الصنف بدقة أو التأكد من توفر الرصيد.',
  TRANSFER_BATCH_ALLOCATION_INSUFFICIENT: 'رصيد تشغيلات الصنف في المخزن غير كافٍ لتغطية الكمية المطلوبة.',
  TRANSFER_BATCH_NOT_AVAILABLE: 'التشغيلة المحددة غير موجودة أو رصيدها غير كافٍ في المخزن.',
  TRANSFER_DESTINATION_MISSING: 'مخزن أو فرع الاستلام غير محدد.',
  FINAL_ISSUE_JOURNAL_MISSING: 'تعذر إنشاء قيد يومية متوازن لإذن الصرف النهائي.',
  DESTINATION_BRANCH_NOT_FOUND: 'فرع الوجهة المحدد غير موجود.',
  DESTINATION_LOCATION_NOT_FOUND: 'مخزن الوجهة المحدد غير موجود في هذا الفرع.',
  INVALID_TRANSFER: 'بيانات التحويل غير صالحة. تأكد من تحديد مخزن ومستلم مختلفين.',
  INVALID_TRANSFER_QUANTITY: 'كميات التحويل يجب أن تكون قيماً موجبة وصحيحة.',
  TRANSFER_STATUS_INVALID: 'حالة إذن التحويل الحالية لا تسمح بهذا الإجراء.',
  TRANSFER_RECEIPT_INVALID: 'بيانات استلام التحويل غير صحيحة.',
  TRANSIT_LOCATION_MISSING: 'موقع البضاعة بالطريق غير مهيأ في النظام.',
  TRANSFER_DESTINATION_BRANCH_MISMATCH: 'فرع وجهة التحويل لا يطابق مخزن الاستلام المحدد.',
  TRANSFER_SHRINKAGE_JOURNAL_MISSING: 'تعذر تسجيل قيد هالك وفاقد التحويل في الحسابات.',
  ADJUSTMENT_BRANCH_LOCATION_MISMATCH: 'المخزن المختار لا يتبع الفرع المحدد للتسوية.',
  LOCATION_REQUIRED_FOR_BRANCH: 'يرجى تحديد المخزن التابع للفرع لتنفيذ التسوية.',
  ADJUSTMENT_TRACKED_LOCATION_REQUIRED: 'يجب تحديد المخزن بدقة عند تسوية صنف متتبع بالسيريال أو التشغيلة.',
  ADJUSTMENT_UNEXPECTED_TRACE: 'الصنف غير متتبع؛ لا يقبل إدخال بيانات سيريال أو تشغيلة.',
  STOCK_COUNT_DUPLICATE_PRODUCT: 'لا يمكن تكرار الصنف في نفس جلسة الجرد.',
  INVALID_STOCK_RECOUNT: 'يرجى إدخال كمية وسبب إعادة الجرد بشكل صحيح.',
  SESSION_STATUS_INVALID: 'حالة جلسة الجرد الحالية لا تسمح بهذا الإجراء.',
  SESSION_ALREADY_POSTED: 'جلسة الجرد مرحلة مسبقاً ولا يمكن تعديلها أو حذفها.',
  SESSION_EMPTY: 'جلسة الجرد فارغة؛ أضف أصنافاً أولاً قبل الترحيل.',
  STOCK_COUNT_LOCATION_REQUIRED: 'الجرد المتتبع يتطلب تحديد المخزن بدقة.',
  STOCK_COUNT_STALE: 'حدثت حركات مخزنية على البند أثناء الجرد؛ يرجى تحديث بيانات البند قبل الاعتماد.',
  IN_TRANSIT_LOCATION_RESTRICTED: 'مخزن البضاعة بالطريق مخصص لحركات التحويل الآلية فقط.',
  LOCATION_SCOPE_FORBIDDEN: 'ليس لديك صلاحية على هذا المخزن أو الفرع.',
  SALE_SERIAL_INVALID: 'يرجى إدخال أرقام تسلسلية (سيريالات) صحيحة للصنف.',
  SALE_SERIAL_COUNT_MISMATCH: 'عدد الأرقام التسلسلية يجب أن يطابق تماماً عدد القطع المباعة.',
  SALE_SERIAL_UNAVAILABLE: 'رقم السيريال غير موجود بالمخزون أو سبق بيعه.',
  TRADEIN_DUPLICATE_SERIAL: 'الجهاز برقم السيريال هذا مسجل مسبقاً وما زال رصيده متاحاً بالمخزن.',
  PHARMACY_PRODUCT_NOT_LINKED: 'يجب ربط الصنف الدوائي المستورد بصنف مخزني في بطاقة الأصناف أولاً.',
  PHARMACY_BATCH_REQUIRED: 'الصنف الدوائي يتطلب إدخال رقم التشغيلة وتاريخ الصلاحية عند الشراء والاستلام.',
  PHARMACY_INVOICE_LINE_INVALID: 'بيانات سطر فاتورة الموزع غير صالحة أو غير متوافقة مع قواعد الصيدلية.',
  PHARMACY_INVOICE_TOTAL_INVALID: 'إجمالي فاتورة الموزع يتجاوز الحدود المالية المسموح بها.',
};

function looksArabic(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

function translateKnownEnglishMessage(message: string): string | null {
  const normalized = message.trim();

  const directMap: Record<string, string> = {
    'Internal server error': 'حدث خطأ داخلي في الخادم.',
    'Validation failed': 'البيانات المرسلة غير صحيحة.',
    'Unauthorized': 'غير مصرح لك بالوصول.',
    'Forbidden resource': 'غير مسموح لك بالوصول إلى هذا المورد.',
    'Missing required permissions': 'لا تملك الصلاحيات المطلوبة لتنفيذ هذه العملية.',
    'Invalid username or password': 'اسم المستخدم أو كلمة المرور غير صحيحين.',
    'Current password is incorrect': 'كلمة المرور الحالية غير صحيحة.',
    'Session not found': 'الجلسة غير موجودة.',
    'Settings payload must be an object': 'بيانات الإعدادات يجب أن تكون كائنًا صحيحًا.',
    'Customer already exists': 'يوجد عميل بنفس الاسم بالفعل.',
    'Customer not found': 'العميل غير موجود.',
    'Customer name is required': 'اسم العميل مطلوب.',
    'Customer has outstanding balance': 'لا يمكن حذف العميل لأن لديه رصيدًا قائمًا.',
    'Customer has store credit balance': 'لا يمكن حذف العميل لأن لديه رصيدًا دفتريًا.',
    'Customer has financial history and cannot be deleted': 'لا يمكن حذف العميل لأن لديه سجل حركات أو تاريخًا ماليًا.',
    'Supplier already exists': 'يوجد مورد بنفس الاسم بالفعل.',
    'Supplier not found': 'المورد غير موجود.',
    'Supplier name is required': 'اسم المورد مطلوب.',
    'Supplier has outstanding balance': 'لا يمكن حذف المورد لأن عليه رصيدًا قائمًا.',
    'Supplier has financial history and cannot be deleted': 'لا يمكن حذف المورد لأن لديه سجل حركات أو تاريخًا ماليًا.',
    'Supplier is used by products': 'لا يمكن حذف المورد لأنه مرتبط بأصناف موجودة.',
    'Category already exists': 'يوجد قسم بنفس الاسم بالفعل.',
    'Category not found': 'القسم غير موجود.',
    'Category name is required': 'اسم القسم مطلوب.',
    'Product not found': 'الصنف غير موجود.',
    'Product already exists': 'يوجد صنف بنفس الاسم أو الباركود بالفعل.',
    'Stock cannot be edited from product master data. Use inventory adjustment.': 'لا يمكن تعديل المخزون من شاشة بيانات الصنف. استخدم شاشة المخزون أو التسوية.',
    'Price changes require canEditPrice permission': 'تعديل الأسعار يتطلب صلاحية تعديل الأسعار.',
    'Discount changes require canDiscount permission': 'تعديل الخصم يتطلب صلاحية تعديل الخصم.',
    'Could not open cashier shift': 'تعذر فتح الوردية.',
    'MANAGER_AUTH_REQUIRED': 'رمز اعتماد المدير مطلوب لتنفيذ هذه العملية.',
    'Destination location or branch is required': 'يرجى تحديد مخزن أو فرع الاستلام.',
    'Source and destination locations must be different': 'مخزن المصدر ومخزن الوجهة يجب أن يكونا مختلفين.',
    'Destination branch not found': 'فرع الوجهة المحدد غير موجود.',
    'Only sent transfers can be received': 'يمكن استلام أذونات التحويل التي في حالة (تم الإرسال) فقط.',
    'Only sent transfers can be cancelled': 'يمكن إلغاء أذونات التحويل التي في حالة (تم الإرسال) فقط.',
    'No branch stock location found for destination branch': 'لا يوجد رصيد مخزون مرتبط بفرع الوجهة.',
    'Transfer items require valid product IDs and positive quantities with at most three decimal places': 'أصناف التحويل تتطلب معرفات صالحة وكميات موجبة بحد أقصى 3 منازل عشرية.',
    'Quantity must be strictly positive for add and deduct operations': 'الكمية يجب أن تكون أكبر من الصفر لعمليات الإضافة والخصم.',
    'Stock count session cannot be recounted': 'جلسة الجرد لا يمكن إعادة جردها في حالتها الحالية.',
    'Stock count session cannot be posted': 'لا يمكن ترحيل جلسة الجرد في حالتها الحالية.',
    'Stock count session has no items': 'جلسة الجرد لا تحتوي على أي بنود.',
    'A valid recount quantity and reason are required': 'يرجى إدخال كمية وسبب إعادة الجرد بشكل صحيح.',
  };

  if (directMap[normalized]) {
    return directMap[normalized];
  }

  if (normalized.startsWith('property ') && normalized.endsWith(' should not exist')) {
    const field = normalized.replace(/^property\s+/i, '').replace(/\s+should not exist$/i, '').trim();
    return `الحقل ${field} غير مسموح إرساله.`;
  }

  return null;
}

function translateByCodePattern(code: string): string | null {
  console.log('Translating error code pattern:', code);
  if (code.endsWith('_NOT_FOUND')) return 'العنصر المطلوب غير موجود.';
  if (code.endsWith('_EXISTS')) return 'يوجد عنصر مماثل بالفعل.';
  if (code.endsWith('_REQUIRED')) return 'هناك حقل مطلوب غير موجود.';
  if (code.endsWith('_INVALID')) return 'البيانات المدخلة غير صحيحة.';
  if (code.endsWith('_FORBIDDEN')) return 'غير مسموح بتنفيذ هذه العملية.';
  if (code.endsWith('_HAS_BALANCE')) return 'لا يمكن تنفيذ العملية لوجود رصيد قائم.';
  if (code.endsWith('_HAS_HISTORY')) return 'لا يمكن تنفيذ العملية لوجود سجل حركات أو تاريخ سابق.';
  if (code.endsWith('_IN_USE')) return 'لا يمكن تنفيذ العملية لأن العنصر مستخدم في بيانات أخرى.';
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return null;
}

export function translateErrorMessageFromCode(code?: string | null, fallbackMessage?: unknown, statusCode?: number): string {
  const fallback = firstString(fallbackMessage);

  if (code === 'VALIDATION_ERROR') {
    if (fallback && fallback !== ERROR_CODE_MESSAGES.VALIDATION_ERROR) {
      if (looksArabic(fallback)) return fallback;
      const translated = translateKnownEnglishMessage(fallback);
      if (translated && translated !== ERROR_CODE_MESSAGES.VALIDATION_ERROR) return translated;
      return fallback;
    }
    return ERROR_CODE_MESSAGES.VALIDATION_ERROR;
  }

  if (fallback && looksArabic(fallback) && fallback !== ERROR_CODE_MESSAGES[code || '']) {
    return fallback;
  }

  if (code) {
    if (ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
  }

  if (fallback) {
    if (looksArabic(fallback)) return fallback;
  }

  if (code) {
    console.log(`Translating error code pattern: ${code}`);
    const pattern = translateByCodePattern(code);
    if (pattern) return pattern;
  }

  if (fallback) {
    const translated = translateKnownEnglishMessage(fallback);
    if (translated) return translated;
  }

  if (statusCode === 401) return 'غير مصرح لك بالوصول.';
  if (statusCode === 403) return 'غير مسموح بتنفيذ هذه العملية.';
  if (statusCode === 404) return 'العنصر المطلوب غير موجود.';
  if (statusCode === 422) return 'البيانات المرسلة غير صحيحة.';

  return 'تعذر تنفيذ العملية المطلوبة.';
}
