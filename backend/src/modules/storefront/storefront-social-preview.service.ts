import { Injectable } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import { buildStorePublicBase } from './engines/store-public-url.engine';

/**
 * يولّد صفحة HTML صغيرة تحمل وسوم Open Graph / Twitter Card لزواحف التواصل.
 *
 * **لماذا هذا موجود أصلاً:** الواجهة تطبيق Vite أحادي الصفحة بلا عرض من الخادم.
 * زواحف واتساب وفيسبوك وتليجرام **لا تنفّذ JavaScript**، فكانت ترى ملف
 * `index.html` الفارغ: لا عنوان ولا صورة ولا وصف. النتيجة أن أي رابط متجر أو
 * منتج يُرسَل في واتساب — وهي قناة التوزيع الأساسية في السوق — يظهر كنص عارٍ
 * بلا بطاقة معاينة، وهو فرق كبير في نسبة الضغط.
 *
 * الزاحف وحده يُوجَّه إلى هنا (قاعدة في بوابة nginx)؛ المستخدم الحقيقي يُخدَّم
 * التطبيق كالمعتاد. ومع ذلك نضع `<link rel="canonical">` ووسم تحويل فوري حتى لو
 * فتح إنسان هذا المسار بالصدفة.
 */

type PreviewPayload = {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName: string;
  price?: { amount: number; currency: string; availability: 'in stock' | 'out of stock' };
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(origin: string, maybePath: string): string {
  const value = String(maybePath || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  return `${origin.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
}

@Injectable()
export class StorefrontSocialPreviewService {
  constructor(private readonly storefront: StorefrontService) {}

  async buildPreview(slug: string, origin: string, productId?: string): Promise<string> {
    const info: any = await this.storefront.getStorefrontInfo(slug);
    const siteName = String(info?.businessName || info?.title || 'المتجر الإلكتروني').trim();
    const currency = String(info?.currency || 'ج.م');
    const storeUrl =
      buildStorePublicBase(origin, slug) || `${origin.replace(/\/$/, '')}/st/${encodeURIComponent(slug)}`;

    let payload: PreviewPayload = {
      title: String(info?.title || siteName),
      description: String(info?.description || info?.tagline || `تسوّق أونلاين من ${siteName} واطلب الآن.`),
      image: absoluteUrl(origin, info?.logoUrl || info?.bannerUrl || ''),
      url: storeUrl,
      siteName,
    };

    if (productId) {
      const catalog: any = await this.storefront.getStorefrontCatalog(slug);
      const product = (catalog?.products || []).find((p: any) => String(p.id) === String(productId));
      if (product) {
        const price = Number(product.price || 0);
        payload = {
          title: `${product.name} — ${siteName}`,
          description:
            String(product.description || '').trim() ||
            `${product.name} متاح الآن بسعر ${price.toLocaleString('ar-EG')} ${currency} من ${siteName}.`,
          image: absoluteUrl(origin, product.imageUrl || info?.logoUrl || ''),
          url: `${storeUrl}/p/${encodeURIComponent(String(product.id))}`,
          siteName,
          price: {
            amount: price,
            currency,
            availability: product.inStock ? 'in stock' : 'out of stock',
          },
        };
      }
    }

    return this.renderHtml(payload);
  }

  private renderHtml(p: PreviewPayload): string {
    const productTags = p.price
      ? `
  <meta property="og:type" content="product" />
  <meta property="product:price:amount" content="${escapeHtml(p.price.amount)}" />
  <meta property="product:price:currency" content="${escapeHtml(p.price.currency)}" />
  <meta property="product:availability" content="${escapeHtml(p.price.availability)}" />`
      : `
  <meta property="og:type" content="website" />`;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(p.title)}</title>
  <meta name="description" content="${escapeHtml(p.description)}" />
  <link rel="canonical" href="${escapeHtml(p.url)}" />
  <meta property="og:site_name" content="${escapeHtml(p.siteName)}" />
  <meta property="og:title" content="${escapeHtml(p.title)}" />
  <meta property="og:description" content="${escapeHtml(p.description)}" />
  <meta property="og:url" content="${escapeHtml(p.url)}" />${productTags}
  ${
    p.image
      ? `<meta property="og:image" content="${escapeHtml(p.image)}" />
  <meta property="og:image:alt" content="${escapeHtml(p.title)}" />`
      : ''
  }
  <meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${escapeHtml(p.title)}" />
  <meta name="twitter:description" content="${escapeHtml(p.description)}" />
  ${p.image ? `<meta name="twitter:image" content="${escapeHtml(p.image)}" />` : ''}
  <meta http-equiv="refresh" content="0; url=${escapeHtml(p.url)}" />
</head>
<body>
  <h1>${escapeHtml(p.title)}</h1>
  <p>${escapeHtml(p.description)}</p>
  <a href="${escapeHtml(p.url)}">${escapeHtml(p.siteName)}</a>
</body>
</html>`;
  }
}
