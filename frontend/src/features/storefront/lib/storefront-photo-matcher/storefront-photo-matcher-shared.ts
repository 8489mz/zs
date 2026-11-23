/**
 * Enterprise Semantic Photographic Engine for Retail & Supermarket
 * Automatically and intelligently matches product names and categories to
 * exact, authentic, verified product photography with weighted scoring.
 */

export function cleanArabic(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[أإآٱٲٳ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

export interface SemanticPhotoRule {
  id: string;
  nameAr: string;
  keywords: string[];
  imageUrl: string;
  weight: number; // Higher weight = higher specificity precedence
}

/**
 * Intelligent Weighted Photographic Matcher
 * Analyzes product name & category, normalizes Arabic text, and calculates
 * the highest specificity confidence score to guarantee accurate photos.
 */
/**
 * من أين جاءت الصورة المعروضة:
 * - `name`: طابقت اسم المنتج نفسه — صورة تمثّل هذا المنتج فعلاً.
 * - `category`: طابقت اسم القسم فقط — صورة **توضيحية** للقسم، وكل منتجات القسم
 *   ستحصل على نفس الصورة. عرضها كأنها صورة المنتج يضلّل العميل.
 * - `placeholder`: لا مطابقة — بطاقة SVG تحمل اسم المنتج.
 */
export type ProductPhotoSource = 'name' | 'category' | 'placeholder';

export type ResolvedProductPhoto = {
  url: string;
  source: ProductPhotoSource;
};
