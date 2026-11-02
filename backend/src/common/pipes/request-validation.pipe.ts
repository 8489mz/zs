import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

const FIELD_LABELS: Record<string, string> = {
  storeName: 'اسم المحل',
  managerPin: 'رمز اعتماد المدير',
  theme: 'الثيم',
  openingCash: 'الرصيد الافتتاحي',
  countedCash: 'المبلغ المعدود',
  note: 'الملاحظة',
  reason: 'السبب',
  name: 'الاسم',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  displayName: 'الاسم الظاهر',
  phone: 'رقم الهاتف',
  address: 'العنوان',
  balance: 'الرصيد',
  creditLimit: 'حد الائتمان',
  storeCreditBalance: 'رصيد الرصيد الدفتري',
  companyName: 'اسم الشركة',
  ownerName: 'اسم المالك',
  taxNumber: 'الرقم الضريبي',
  type: 'النوع',
  amount: 'المبلغ',
  from: 'من',
  to: 'إلى',
  branchId: 'الفرع',
  locationId: 'الموقع',
  categoryId: 'القسم',
  supplierId: 'المورد',
  customerId: 'العميل',
  productId: 'الصنف',
  barcode: 'الباركود',
  costPrice: 'سعر الشراء',
  retailPrice: 'سعر البيع',
  wholesalePrice: 'سعر الجملة',
  minStock: 'الحد الأدنى للمخزون',
  stock: 'المخزون',
  qty: 'الكمية',
  page: 'الصفحة',
  pageSize: 'حجم الصفحة',
  search: 'البحث',
  filter: 'الفلتر',
  code: 'الكود',
  isActive: 'الحالة',
  permissions: 'الصلاحيات',
  role: 'الدور',
  units: 'الوحدات',
  offers: 'العروض',
  customerPrices: 'أسعار العملاء',
  multiplier: 'المضاعف',
  isBaseUnit: 'الوحدة الأساسية',
  isSaleUnit: 'وحدة البيع',
  isPurchaseUnit: 'وحدة الشراء',
  value: 'القيمة',
  customerName: 'اسم المستلم',
  customerPhone: 'رقم الهاتف',
  customerAddress: 'العنوان',
  customerNotes: 'ملاحظات العميل',
  items: 'أصناف الطلب',
  totalAmount: 'إجمالي المبلغ',
  subtotal: 'المجموع الفرعي',
};

function cleanFieldPath(field: string): string {
  return field.replace(/\.\d+\./g, '.').replace(/\.\d+$/g, '');
}

function translateFieldSegment(segment: string): string {
  return FIELD_LABELS[segment] || segment;
}

function formatFieldName(field: string): string {
  if (!field) return 'الحقل';
  const cleaned = cleanFieldPath(field);
  const parts = cleaned.split('.');
  const translated = parts.map(translateFieldSegment);
  return translated.join(' > ');
}

function translateConstraint(message: string, field: string): string {
  // If the constraint message already contains Arabic text (custom message on DTO), preserve it directly
  if (/[\u0600-\u06FF]/.test(message)) {
    return message;
  }

  const label = formatFieldName(field);

  if (message.includes('should not exist')) {
    return `الحقل ${label} غير مسموح إرساله.`;
  }

  if (message.includes('must not be less than')) {
    const match = message.match(/must not be less than\s+([\d.]+)/i);
    const min = match?.[1] || '';
    return `الحقل ${label} يجب أن يكون ${min ? `أكبر من أو يساوي ${min}` : 'ضمن الحد الأدنى المطلوب'}.`;
  }

  if (message.includes('must not be greater than')) {
    const match = message.match(/must not be greater than\s+([\d.]+)/i);
    const max = match?.[1] || '';
    return `الحقل ${label} يجب أن يكون ${max ? `أقل من أو يساوي ${max}` : 'ضمن الحد الأعلى المسموح'}.`;
  }

  if (message.includes('must be a number')) {
    return `الحقل ${label} يجب أن يكون رقمًا صحيحًا.`;
  }

  if (message.includes('must be a string')) {
    return `الحقل ${label} يجب أن يكون نصًا.`;
  }

  if (message.includes('must be a boolean')) {
    return `الحقل ${label} يجب أن يكون صح أو خطأ.`;
  }

  if (message.includes('must be an object')) {
    return `الحقل ${label} يجب أن يكون كائنًا صالحًا.`;
  }

  if (message.includes('must be an array')) {
    return `الحقل ${label} يجب أن يكون قائمة.`;
  }

  if (message.includes('should not be empty')) {
    return `الحقل ${label} مطلوب.`;
  }

  if (message.includes('must be longer than or equal to')) {
    const match = message.match(/must be longer than or equal to\s+([\d]+)/i);
    const min = match?.[1] || '';
    return `الحقل ${label} يجب ألا يقل عن ${min || 'الحد الأدنى المطلوب'} أحرف.`;
  }

  if (message.includes('must be shorter than or equal to')) {
    const match = message.match(/must be shorter than or equal to\s+([\d]+)/i);
    const max = match?.[1] || '';
    return `الحقل ${label} يجب ألا يزيد عن ${max || 'الحد الأقصى المسموح'} حرفًا.`;
  }

  if (message.includes('must be one of the following values')) {
    const values = message.split(':')[1]?.trim() || '';
    return `الحقل ${label} يجب أن تكون قيمته واحدة من: ${values}.`;
  }

  if (message.includes('must be a valid ISO 8601 date string')) {
    return `الحقل ${label} يجب أن يكون تاريخًا صحيحًا.`;
  }

  if (message.includes('must be an email')) {
    return `الحقل ${label} يجب أن يكون بريدًا إلكترونيًا صحيحًا.`;
  }

  if (message.includes('must match')) {
    return `الحقل ${label} بصيغة غير صحيحة.`;
  }

  return `قيمة الحقل ${label} غير صحيحة.`;
}

function flattenValidationErrors(errors: ValidationError[], parentPath = ''): string[] {
  const messages: string[] = [];

  for (const error of errors) {
    const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;

    if (error.constraints) {
      for (const constraintMessage of Object.values(error.constraints)) {
        messages.push(translateConstraint(constraintMessage, fieldPath));
      }
    }

    if (error.children?.length) {
      messages.push(...flattenValidationErrors(error.children, fieldPath));
    }
  }

  return messages;
}

export const requestValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  stopAtFirstError: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
  exceptionFactory: (errors: ValidationError[] = []) => {
    const messages = flattenValidationErrors(errors);
    console.error('VALIDATION ERRORS:', JSON.stringify(errors, null, 2));
    console.error('FLATTENED MESSAGES:', messages);
    const message = messages[0] || 'البيانات المرسلة غير صحيحة.';

    return new BadRequestException({
      message,
      code: 'VALIDATION_ERROR',
      details: {
        messages,
      },
    });
  },
});
