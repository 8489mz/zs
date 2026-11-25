/**
 * MarketplaceSyncGtinService — slice S13 of the marketplace-sync split.
 * Pure move of 1 method from MarketplaceSyncService (GTIN exemption letter
 * generator). No behavior change: the body is byte-identical; the facade
 * keeps a thin delegate with the same name and signature.
 * Deps: db only (the method reads one product row through the facade's
 * db). NO kernel deps, NO audit dep, NO logger (the span logs nothing;
 * prep section 4 holds for this slice). Types come from
 * ./marketplace-sync.types (S0). Clock: two display dates (letter dates);
 * no instant comparison, no UTC normalizer.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { GtinExemptionApplication, SupportedMarketplace } from './marketplace-sync.types';

export interface MarketplaceSyncGtinDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MarketplaceSyncGtinService {
  private readonly db: Kysely<Database>;

  constructor(deps: MarketplaceSyncGtinDeps) {
    this.db = deps.db;
  }

  // =========================================================================
  // GTIN / BARCODE EXEMPTION ASSISTANT ("معالج إعفاء الباركود الدولي")
  // =========================================================================

  async generateGtinExemption(
    data: {
      productId?: number;
      brandName?: string;
      category?: string;
      marketplace?: SupportedMarketplace;
      reason?: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
    },
    auth: AuthContext,
  ): Promise<GtinExemptionApplication> {
    const scope = requireTenantScope(auth);
    const marketplace = data.marketplace || 'amazon';
    const reason = data.reason || 'unbranded';
    const brandName = (data.brandName || 'Generic / Generic Brand').trim();
    const category = (data.category || 'Home / Fashion / General Goods').trim();

    let productName = 'منتج محلي بدون باركود دولي';
    if (data.productId) {
      const prod = await this.db
        .selectFrom('products')
        .select(['name', 'retail_price'])
        .where('id', '=', data.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (prod) {
        productName = prod.name;
      }
    }

    const todayDateEn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const todayDateAr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

    const letterEn = `
APPLICATION FOR GTIN / UPC / EAN EXEMPTION

Date: ${todayDateEn}
To: ${marketplace.toUpperCase()} Catalog Quality & Seller Support Team
Subject: Request for GTIN Exemption under Category: [${category}]

Dear Support Team,

We are submitting this formal request for GTIN (UPC/EAN/ISBN) Exemption for our product catalog under the brand name "${brandName}".

Product Details:
- Item Name: ${productName}
- Target Category: ${category}
- Exemption Basis: ${
      reason === 'unbranded'
        ? 'Unbranded / Generic item with no manufacturer-provided barcode'
        : reason === 'private_label'
          ? 'Private Label product produced under proprietary custom manufacturing'
          : reason === 'custom_manufacturing'
            ? 'Handmade / Custom manufactured goods without standard GTIN'
            : 'Replacement parts and specialized industrial accessories'
    }

Declaration of Conformity:
1. We confirm that this product does not carry a standard barcode (UPC/EAN) provided by the manufacturer.
2. We certify that the brand "${brandName}" is legitimate and not infringing on registered trademarks.
3. We are prepared to supply high-resolution photos showing all sides of the product and its packaging verifying the absence of a pre-printed barcode.

We appreciate your prompt review and approval of this exemption so we can proceed with cataloging our inventory.

Sincerely,
Catalog Operations Management
`;

    const letterAr = `
طلب إعفاء رسمي من الباركود الدولي (GTIN / EAN Exemption Request)

تاريخ: ${todayDateAr}
إلى: فريق دعم كتالوج ومطابقة الأصناف لدى منصة (${marketplace.toUpperCase()})
الموضوع: طلب إعفاء من الرمز الشريطي الدولي للصنف ضمن تصنيف: [${category}]

تحية طيبة وبعد،،،

نتقدم إليكم بهذا الطلب الرسمي للموافقة على إعفاء منتجاتنا من تقديم الرمز الشريطي الدولي (GTIN / UPC / EAN) تحت العلامة التجارية "${brandName}".

تفاصيل المنتج:
- اسم المنتج: ${productName}
- تصنيف المنتج: ${category}
- سبب طلب الإعفاء: ${
      reason === 'unbranded'
        ? 'منتج محلي عام (Generic) لا توفر له الشركة المصنعة باركوداً دولياً'
        : reason === 'private_label'
          ? 'منتج علامة خاصة (Private Label) مصنع محلياً بمواصفاتنا الخاصة'
          : reason === 'custom_manufacturing'
            ? 'منتجات يدوية أو تفصيلية لا تخضع للترقيم الدولي'
            : 'قطع غيار وإكسسوارات تكميلية غير معبأة بباركود تجزئة'
    }

إقرار التاجر:
- نقر بأن هذا المنتج أصلي ومطابق للمواصفات ولا يتوفر له باركود تجاري عالمي.
- نحن على أتم الاستعداد لإرفاق صور واضحة لكافة جوانب المنتج وعبوته لإثبات خلوها من أي باركود مطبوع.

شاكرين تعاونكم الكريم وسرعة اعتماد الإعفاء لإتاحة رفع ونشر القائمة.

مع فائق الاحترام والتقدير،،
إدارة المنتجات والمخزون
`;

    const submissionInstructions = [
      marketplace === 'amazon'
        ? 'ادخل إلى حسابك في Amazon Seller Central ➔ قائمة "كتالوج" ➔ "إضافة منتجات" ➔ اضغط على رابط "ما هو إعفاء GTIN؟" أو "التقدم بطلب للحصول على إعفاء".'
        : 'ادخل إلى بوابة شركاء نون ➔ قسم الدعم والنزاعات ➔ افتح تذكرة نوعها "Catalog & Barcodes - Request Barcode Exemption".',
      `اختر الفئة: "${category}" واكتب اسم البراند: "${brandName}".`,
      'انسخ نص الخطاب باللغة الإنجليزية والصقه في خانة التوضيح والشرح.',
      'التقط صورتين واضحتين للمنتج بالهاتف (صورة للمنتج وصورة للعلبة أو التغليف توضح عدم وجود باركود مطبوع) وارفعها كمرفقات.',
      'يتم الرد والموافقة التلقائية عادة في خلال 30 دقيقة إلى 24 ساعة كحد أقصى.',
    ];

    return {
      productId: data.productId,
      productName,
      brandName,
      category,
      marketplace,
      reason,
      letterEn,
      letterAr,
      submissionInstructions,
    };
  }
}
