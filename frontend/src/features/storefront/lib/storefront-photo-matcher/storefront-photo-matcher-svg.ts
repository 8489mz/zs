import {
  SHIRT_PHOTO,
  SNEAKER_PHOTO,
  SMARTWATCH_PHOTO,
  PERFUME_PHOTO,
  HEADPHONES_PHOTO,
  BACKPACK_PHOTO,
  SUNGLASSES_PHOTO,
  JACKET_PHOTO,
  IPHONE_PHOTO,
  LAPTOP_PHOTO,
  WATCH_CLASSIC_PHOTO,
  SNEAKER_2_PHOTO,
} from '../product-photos-registry';

/**
 * Returns a real, studio-cutout transparent product photograph
 * matched to the product name and category (Zero cartoon SVGs, zero external 404s).
 */
export function generatePremiumProductSvg(productName: string, categoryName?: string): string {
  const cleanTitle = (productName || '').trim();
  const cleanCat = (categoryName || '').trim();
  const combined = `${cleanTitle} ${cleanCat}`.toLowerCase();

  if (/نظار|sunglass|glasses|uv400/.test(combined)) {
    return SUNGLASSES_PHOTO;
  }
  if (/حقيب|شنط|ظهر|backpack|bag/.test(combined)) {
    return BACKPACK_PHOTO;
  }
  if (/حذاء|كوتشي|جزمة|رياضي|sneaker|shoe|أحذية/.test(combined)) {
    return SNEAKER_PHOTO;
  }
  if (/عطر|عطور|مسك|عود|بخور|perfume|fragrance|parfum/.test(combined)) {
    return PERFUME_PHOTO;
  }
  if (/سماع|ايربودز|airpods|headphone|earbud|headset|صوت/.test(combined)) {
    return HEADPHONES_PHOTO;
  }
  if (/ذكية|smartwatch|ultra|سوار|باند/.test(combined)) {
    return SMARTWATCH_PHOTO;
  }
  if (/ساع|ساعة|ساعات|watch|إكسسوارات/.test(combined)) {
    return WATCH_CLASSIC_PHOTO;
  }
  if (/لابتوب|laptop|كمبيوتر|ماكبوك|macbook/.test(combined)) {
    return LAPTOP_PHOTO;
  }
  if (/ايفون|آيفون|iphone|سامسونج|samsung|شاومي|موبايل|هاتف|هواتف|phone|إلكترونيات/.test(combined)) {
    return IPHONE_PHOTO;
  }
  if (/جاكيت|شتوي|معطف|بلوفر|سويت شيرت|jacket|coat/.test(combined)) {
    return JACKET_PHOTO;
  }
  if (/قميص|تيشيرت|بنطلون|ملابس|أزياء|shirt|fashion/.test(combined)) {
    return SHIRT_PHOTO;
  }

  const fallbackPool = [
    SHIRT_PHOTO,
    SNEAKER_PHOTO,
    SMARTWATCH_PHOTO,
    PERFUME_PHOTO,
    HEADPHONES_PHOTO,
    BACKPACK_PHOTO,
    SUNGLASSES_PHOTO,
    JACKET_PHOTO,
    SNEAKER_2_PHOTO,
  ];
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) >>> 0;
  }
  return fallbackPool[hash % fallbackPool.length];
}
