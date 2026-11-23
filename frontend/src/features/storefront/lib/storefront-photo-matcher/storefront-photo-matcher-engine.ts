import { cleanArabic } from './storefront-photo-matcher-shared';
import { SEMANTIC_PHOTO_RULES } from './storefront-photo-matcher-rules';
import { generatePremiumProductSvg } from './storefront-photo-matcher-svg';
import type { SemanticPhotoRule, ProductPhotoSource, ResolvedProductPhoto } from './storefront-photo-matcher-shared';

const photoCache = new Map<string, string>();

const photoSourceCache = new Map<string, ProductPhotoSource>();

/**
 * يعيد الصورة **ومصدرها** حتى تستطيع الواجهة التمييز بين صورة المنتج الحقيقية
 * وصورة القسم التوضيحية.
 *
 * كانت مطابقة اسم القسم تعطي 70 نقطة — أعلى من عتبة القبول (40) — فكل منتجات
 * القسم تحصل على **نفس** الصورة وتبدو كأنها صور منتجاتها. في متجر مطاعم يعني
 * ذلك ظهور نفس صورة الدجاج على ستة أصناف مختلفة.
 */
export function resolveProductPhoto(productName: string, categoryName?: string): ResolvedProductPhoto {
  const url = getAutoProductPhoto(productName, categoryName);
  const source = photoSourceCache.get(`${productName}:::${categoryName || ''}`) || 'placeholder';
  return { url, source };
}

export function getAutoProductPhoto(productName: string, categoryName?: string): string {
  const cacheKey = `${productName}:::${categoryName || ''}`;
  const cached = photoCache.get(cacheKey);
  if (cached) return cached;

  const cleanName = cleanArabic(productName);
  const cleanCat = cleanArabic(categoryName || '');
  const words = cleanName.split(/\s+/).filter(Boolean);

  let bestRule: SemanticPhotoRule | null = null;
  let highestScore = 0;
  // هل جاء أعلى سكور من اسم المنتج أم من اسم القسم فقط؟
  let bestFromNameOnly = false;

  for (const rule of SEMANTIC_PHOTO_RULES) {
    let score = 0;
    let scoreFromName = 0;

    for (const kw of rule.keywords) {
      const cleanKw = cleanArabic(kw);
      if (!cleanKw) continue;

      if (cleanKw.includes(' ')) {
        // Multi-word phrase exact match in name (Highest precision: +25 bonus!)
        if (cleanName.includes(cleanKw)) {
          score = Math.max(score, rule.weight + 25);
          scoreFromName = Math.max(scoreFromName, rule.weight + 25);
        }
      } else {
        // Single word exact match
        if (words.some((w) => w === cleanKw)) {
          score = Math.max(score, rule.weight);
          scoreFromName = Math.max(scoreFromName, rule.weight);
        } else if (cleanName.includes(cleanKw) && cleanKw.length >= 4) {
          // Substring match for longer words
          score = Math.max(score, rule.weight - 10);
          scoreFromName = Math.max(scoreFromName, rule.weight - 10);
        }
      }

      // Check category name for solid contextual fallback (e.g., product in known category or category tile itself)
      if (cleanCat && cleanCat.includes(cleanKw)) {
        // High confidence contextual score: 70
        // Allows items like "1*3" in "كابلات" to inherit authentic cable photo,
        // while direct product-name matches (weight 95+) still take priority.
        score = Math.max(score, 70);
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestRule = rule;
      bestFromNameOnly = scoreFromName >= score;
    }
  }

  // Only accept a photo match if confidence score is solid (>= 40) AND not an external unverified host.
  const matched = Boolean(bestRule && highestScore >= 40);
  const candidateUrl = matched ? (bestRule as SemanticPhotoRule).imageUrl : '';
  const isExternalHost = candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://');
  const result = matched && !isExternalHost
    ? candidateUrl
    : generatePremiumProductSvg(productName, categoryName);

  photoCache.set(cacheKey, result);
  photoSourceCache.set(cacheKey, matched ? (bestFromNameOnly ? 'name' : 'category') : 'placeholder');
  return result;
}
