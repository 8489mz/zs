import type { CartItem, CreateOnlineOrderResponse, StorefrontInfo } from '../../types/storefront.types';

export const STOREFRONT_SAVED_CUSTOMER_KEY = 'zsystems.storefront.saved_customer';

export interface StorefrontCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  info?: StorefrontInfo;
  deliveryFee?: number;
  tenantSlug?: string;
  tableNumber?: string | null;
  orderType?: 'delivery' | 'dine_in';
  editingOrderNumber?: string;
  onEditSuccess?: (orderNumber: string) => void;
  onOrderSuccess?: (orderData: CreateOnlineOrderResponse) => void;
  onSubmitOrder?: (formData: {
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    customerNotes: string;
    paymentMethod?: string;
    couponCode?: string;
    deliveryZoneId?: number;
    deliveryZoneName?: string;
    orderType?: 'delivery' | 'dine_in';
    tableNumber?: string;
    fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';
    countryCode?: string;
  }) => Promise<void>;
}

export interface CountryOption {
  code: string;
  name: string;
  nameEn: string;
  dialCode: string;
  placeholder: string;
  placeholderEn: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'EG', name: 'مصر', nameEn: 'Egypt', dialCode: '+20', placeholder: '01012345678 (11 رقم)', placeholderEn: '01012345678 (11 digits)' },
  { code: 'SA', name: 'السعودية', nameEn: 'Saudi Arabia', dialCode: '+966', placeholder: '501234567 (9 أرقام)', placeholderEn: '501234567 (9 digits)' },
  { code: 'AE', name: 'الإمارات', nameEn: 'UAE', dialCode: '+971', placeholder: '501234567 (9 أرقام)', placeholderEn: '501234567 (9 digits)' },
  { code: 'KW', name: 'الكويت', nameEn: 'Kuwait', dialCode: '+965', placeholder: '91234567 (8 أرقام)', placeholderEn: '91234567 (8 digits)' },
  { code: 'OM', name: 'عمان', nameEn: 'Oman', dialCode: '+968', placeholder: '91234567 (8 أرقام)', placeholderEn: '91234567 (8 digits)' },
  { code: 'QA', name: 'قطر', nameEn: 'Qatar', dialCode: '+974', placeholder: '51234567 (8 أرقام)', placeholderEn: '51234567 (8 digits)' },
  { code: 'BH', name: 'البحرين', nameEn: 'Bahrain', dialCode: '+973', placeholder: '31234567 (8 أرقام)', placeholderEn: '31234567 (8 digits)' },
  { code: 'OTHER', name: 'دولي / أخرى', nameEn: 'International / Other', dialCode: '+', placeholder: 'رقم الهاتف', placeholderEn: 'Phone number' },
];

export function getDynamicPhoneValidation(phone: string, countryCode: string = 'EG', isEn = false): { isValid: boolean; message: string; isComplete: boolean } {
  const clean = phone.replace(/[^0-9+]/g, '');
  if (!clean) return { isValid: false, message: '', isComplete: false };

  if (countryCode === 'EG') {
    const digits = clean.replace(/\D/g, '');
    if (!digits.startsWith('01')) {
      return { isValid: false, message: isEn ? 'Must start with 01' : 'يجب أن يبدأ بـ 01', isComplete: false };
    }
    if (digits.length >= 3 && !['010', '011', '012', '015'].includes(digits.slice(0, 3))) {
      return { isValid: false, message: isEn ? 'Invalid carrier prefix (010, 011, 012, 015)' : 'كود شبكة غير صحيح (010, 011, 012, 015)', isComplete: false };
    }
    if (digits.length === 11) {
      return { isValid: true, message: isEn ? 'Valid phone number (11 digits)' : 'رقم هاتف صحيح (11 رقم)', isComplete: true };
    }
    return { isValid: false, message: isEn ? `${11 - digits.length} digits remaining` : `متبقي ${11 - digits.length} أرقام`, isComplete: false };
  }

  if (countryCode === 'SA') {
    const digits = clean.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
    if (digits.length === 9 && digits.startsWith('5')) {
      return { isValid: true, message: isEn ? 'Valid Saudi phone number' : 'رقم هاتف سعودي صحيح', isComplete: true };
    }
    if (digits.length < 9) {
      return { isValid: false, message: isEn ? `${9 - digits.length} digits remaining` : `متبقي ${9 - digits.length} أرقام`, isComplete: false };
    }
    return { isValid: true, message: isEn ? 'Complete phone number' : 'رقم هاتف مكتمل', isComplete: true };
  }

  if (countryCode === 'KW') {
    const digits = clean.replace(/\D/g, '').replace(/^965/, '').replace(/^00965/, '').replace(/^0/, '');
    if (digits.length > 0 && !['2', '5', '6', '9'].includes(digits[0])) {
      return { isValid: false, message: isEn ? 'Must start with 2, 5, 6, or 9' : 'يجب أن يبدأ بـ 2, 5, 6, أو 9', isComplete: false };
    }
    if (digits.length === 8) {
      return { isValid: true, message: isEn ? 'Valid Kuwait phone number (8 digits)' : 'رقم هاتف كويتي صحيح (8 أرقام)', isComplete: true };
    }
    if (digits.length < 8) {
      return { isValid: false, message: isEn ? `${8 - digits.length} digits remaining` : `متبقي ${8 - digits.length} أرقام`, isComplete: false };
    }
    return { isValid: false, message: isEn ? 'Kuwait phone number is 8 digits' : 'رقم الهاتف الكويتي يتكون من 8 أرقام', isComplete: false };
  }

  const generalDigits = clean.replace(/\D/g, '');
  if (generalDigits.length >= 7 && generalDigits.length <= 15) {
    return { isValid: true, message: isEn ? 'Valid phone number' : 'رقم الهاتف صحيح', isComplete: true };
  }
  return { isValid: false, message: isEn ? 'Incomplete phone number' : 'رقم الهاتف غير مكتمل', isComplete: false };
}

export function getEgyptianPhoneValidation(phone: string): { isValid: boolean; message: string; isComplete: boolean } {
  return getDynamicPhoneValidation(phone, 'EG');
}

export function getCustomerNameValidation(name: string, isEn = false): { isValid: boolean; message: string } {
  const trimmed = name.trim();
  if (!trimmed) return { isValid: false, message: '' };
  const lettersCount = (trimmed.match(/[\p{L}\p{M}]/gu) || []).length;
  if (lettersCount < 2) {
    return { isValid: false, message: isEn ? 'Name must be at least 2 letters' : 'الاسم يجب ألا يقل عن حرفين' };
  }
  return { isValid: true, message: isEn ? 'Name complete' : 'الاسم مكتمل' };
}

export function getCustomerAddressValidation(address: string, isEn = false): { isValid: boolean; message: string } {
  const trimmed = address.trim();
  if (!trimmed) return { isValid: false, message: '' };
  return { isValid: true, message: isEn ? 'Address complete' : 'العنوان مكتمل' };
}

export function cleanArabicText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .trim();
}

export const KUWAIT_POPULAR_AREAS = [
  // العاصمة
  'مدينة الكويت', 'الشرق', 'المرقاب', 'القبلة', 'الصالحية', 'بنيد القار', 'الدسمة', 'الدعية', 'المنصورية', 'ضاحية عبد الله السالم', 'النزهة', 'الفيحاء', 'الشامية', 'الروضة', 'العديلية', 'الخالدية', 'كيفان', 'القادسية', 'قرطبة', 'السرة', 'اليرموك', 'الشويخ', 'غرناطة', 'الصليبيخات', 'الدوحة', 'مدينة جابر الأحمد',
  // حولي
  'حولي', 'السالمية', 'الرميثية', 'الجابرية', 'مشرف', 'بيان', 'سلوى', 'البدع', 'الشعب', 'ميدان حولي', 'السلام', 'حطين', 'الصديق', 'الزهراء', 'الشهداء',
  // الفروانية
  'الفروانية', 'خيطان', 'الأندلس', 'إشبيلية', 'جليب الشيوخ', 'العمرية', 'الرابية', 'الرحاب', 'صباح الناصر', 'الفردوس', 'العارضية', 'الرقعي', 'عبد الله المبارك', 'غرب عبد الله المبارك',
  // الأحمدي
  'الأحمدي', 'الفحيحيل', 'المنقف', 'الصباحية', 'الرقة', 'هدية', 'أبو حليفة', 'المهبولة', 'العقيلة', 'الظهر', 'جابر العلي', 'مدينة صباح الأحمد', 'الوفرة', 'الخيران', 'بنيدر', 'الجليعة',
  // مبارك الكبير
  'العدان', 'القصور', 'القرين', 'مبارك الكبير', 'صباح السالم', 'المسيلة', 'أبو فطيرة', 'الفنيطيس', 'صبحان',
  // الجهراء
  'الجهراء', 'الواحة', 'العيون', 'القصر', 'النسيم', 'تيماء', 'النعيم', 'مدينة سعد العبد الله', 'الصليبية', 'كبد', 'المطلاع',
];

export function assembleKuwaitAddress(parts: {
  area?: string;
  block?: string;
  street?: string;
  avenue?: string;
  house?: string;
  apartment?: string;
  extra?: string;
}): string {
  const chunks: string[] = [];
  if (parts.area?.trim()) chunks.push(`المنطقة: ${parts.area.trim()}`);
  if (parts.block?.trim()) chunks.push(`قطعة: ${parts.block.trim()}`);
  if (parts.street?.trim()) chunks.push(`شارع: ${parts.street.trim()}`);
  if (parts.avenue?.trim()) chunks.push(`جادة: ${parts.avenue.trim()}`);
  if (parts.house?.trim()) chunks.push(`منزل/مبنى: ${parts.house.trim()}`);
  if (parts.apartment?.trim()) chunks.push(`دور/شقة: ${parts.apartment.trim()}`);
  if (parts.extra?.trim()) chunks.push(`علامة مميزة: ${parts.extra.trim()}`);
  return chunks.join('، ');
}

export function parseKuwaitAddress(addr: string): {
  area: string;
  block: string;
  street: string;
  avenue: string;
  house: string;
  apartment: string;
  extra: string;
} {
  const res = { area: '', block: '', street: '', avenue: '', house: '', apartment: '', extra: '' };
  if (!addr) return res;
  const matchArea = addr.match(/المنطقة:\s*([^،,]+)/);
  if (matchArea) res.area = matchArea[1].trim();
  const matchBlock = addr.match(/قطعة:\s*([^،,]+)/);
  if (matchBlock) res.block = matchBlock[1].trim();
  const matchStreet = addr.match(/شارع:\s*([^،,]+)/);
  if (matchStreet) res.street = matchStreet[1].trim();
  const matchAvenue = addr.match(/جادة:\s*([^،,]+)/);
  if (matchAvenue) res.avenue = matchAvenue[1].trim();
  const matchHouse = addr.match(/منزل\/مبنى:\s*([^،,]+)/);
  if (matchHouse) res.house = matchHouse[1].trim();
  const matchApt = addr.match(/دور\/شقة:\s*([^،,]+)/);
  if (matchApt) res.apartment = matchApt[1].trim();
  const matchExtra = addr.match(/علامة مميزة:\s*([^،,]+)/);
  if (matchExtra) res.extra = matchExtra[1].trim();
  return res;
}
