import { BadRequestException } from '@nestjs/common';
import { isValidTimezone } from '../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

/**
 * storefront-helpers.ts — shared free functions for the storefront split.
 * Pure move of the 8 free functions (L66-182 of storefront.service.ts,
 * base 963d18934), created with the T8 merge (first in merge order).
 * Function bodies are byte-identical — only the `export` keyword is
 * added to each top-level declaration so the facade and the slices can
 * import them. The facade imports from here ('./storefront-helpers');
 * slices import '../storefront-helpers'. The contact-minima INV comment
 * and the O58 stock comment travel with their functions, byte-identical.
 */

/** Country-aware phone rule shared by order creation and edit (O56: edit used to accept Egypt only). */
export function assertValidCustomerPhone(rawPhone: string | undefined, countryCode: string): void {
  const cleanCustomerPhone = String(rawPhone || '').replace(/[^0-9+]/g, '');
  const digitsOnly = cleanCustomerPhone.replace(/\D/g, '');
  if (countryCode === 'EG' && (cleanCustomerPhone.startsWith('01') || cleanCustomerPhone.length === 11)) {
    if (!/^01[0125]\d{8}$/.test(digitsOnly)) {
      throw new BadRequestException(
        'يرجى إدخال رقم هاتف محمول مصري صحيح مكون من 11 رقماً ويبدأ بـ (010، 011، 012، 015)',
      );
    }
  } else if (digitsOnly.length < 7 || digitsOnly.length > 16) {
    throw new BadRequestException('يرجى إدخال رقم هاتف صحيح');
  }
}

/*
 * INV-SPIRIT-STOREFRONT-CONTACT-MINIMA: a recipient name needs at
 * least two letters (a two-letter name is a real name); a delivery
 * address needs only to be non-empty after trimming. The phone rule
 * above is deliberately unchanged — Egypt keeps 11 digits starting
 * 010/011/012/015, other countries keep 7-16 digits.
 */
export function assertValidCustomerName(cleanName: string): void {
  const letters = (cleanName.match(/[\p{L}\p{M}]/gu) || []).length;
  if (letters < 2) {
    throw new BadRequestException('يرجى إدخال اسم مستلم صحيح لا يقل عن حرفين');
  }
}

export function assertValidCustomerAddress(cleanAddress: string): void {
  if (!cleanAddress) {
    throw new BadRequestException('يرجى إدخال عنوان توصيل');
  }
}

export function offerTimezone(settings: Map<string, string>): string {
  const configured = settings.get('timezone') || process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  return isValidTimezone(configured) ? configured : 'Africa/Cairo';
}

/**
 * Book digits for storefront display and checkout pricing
 * (INV-STOREFRONT-PRICING-DIGITS), from the same currency source the
 * order functions already read (settings currency, then the tenant's
 * currency, then EGP). An unreadable currency string keeps the
 * historical 2-decimal display instead of failing a public catalog
 * read; the posting path (tenantBaseCurrency) still throws on it, so
 * no order can post on a misconfigured currency.
 */
export function storefrontMoneyDigits(settings: Map<string, string>, tenant?: unknown): MoneyDigits {
  const tenantCurrency = (tenant as { currency?: unknown } | null | undefined)?.currency;
  const code = String(settings.get('currency') || tenantCurrency || 'EGP')
    .trim()
    .toUpperCase();
  try {
    return currencyMoneyDigits(code);
  } catch {
    return 2;
  }
}

export function catalogImageRef(value: unknown): string {
  return typeof value === 'string' && value && !value.startsWith('data:') ? value : '';
}

/** Same rule the public catalog uses to show items as orderable when stock is zero. */
export function isOutOfStockOrderingAllowed(
  settings: Map<string, string>,
  tenantSlug: string,
  tenantActivity?: string | null,
): boolean {
  const normActivity = (tenantActivity || '').toLowerCase().trim();
  const normSettingType = (settings.get('activityType') || '').toLowerCase().trim();
  const normIndustry = (settings.get('businessIndustry') || '').toLowerCase().trim();
  const normLegacyInd = (settings.get('industry') || '').toLowerCase().trim();
  const normLegacyBiz = (settings.get('business_type') || '').toLowerCase().trim();

  const isRestaurant =
    normActivity === 'restaurant' ||
    normActivity === 'مطعم' ||
    normActivity === 'مطاعم' ||
    normActivity.includes('مطعم') ||
    normActivity.includes('كافيه') ||
    normSettingType === 'restaurant' ||
    normSettingType === 'مطعم' ||
    normSettingType.includes('مطعم') ||
    normIndustry === 'restaurant' ||
    normIndustry === 'مطعم' ||
    normIndustry.includes('مطعم') ||
    normLegacyInd === 'restaurant' ||
    normLegacyBiz === 'restaurant';

  const explicitSetting = settings.get('storefront_allow_out_of_stock');
  if (explicitSetting === 'false' || explicitSetting === (false as any)) return false;
  if (explicitSetting === 'true' || explicitSetting === (true as any)) return true;
  if (settings.get('storefront_unlimited_stock') === 'true') return true;

  if (isRestaurant) return true;

  const cleanSlug = (tenantSlug || '').toLowerCase().trim();
  const isDemoOrDev = cleanSlug === 'default' || cleanSlug === 'dev-tenant';

  return isDemoOrDev;
}

/**
 * O58: the old check was `stock_qty <= 0`, so a product with 1 unit left accepted an order for 50.
 * It is still an advisory check (the stock is actually moved when the cashier posts the sale through
 * SalesService, which enforces it for real), but it stops the store from promising what it cannot ship.
 */
export function assertOnlineStockAvailable(
  name: string,
  stockQty: number,
  requestedQty: number,
  allowOutOfStock: boolean,
): void {
  if (allowOutOfStock) return;
  if (stockQty <= 0) {
    throw new BadRequestException(`عفواً، نفد مخزون الصنف "${name}"، يرجى حذفه من السلة لإتمام الطلب.`);
  }
  if (requestedQty > stockQty) {
    throw new BadRequestException(`عفواً، المتاح من الصنف "${name}" هو ${stockQty} فقط، يرجى تعديل الكمية في السلة.`);
  }
}
