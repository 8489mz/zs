import { Body, Controller, Get, Header, Logger, NotFoundException, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PublicTrialSignupDto } from './dto/public-trial-signup.dto';
import { PublicTrialSignupService } from './public-trial-signup.service';
import { PricingCatalogService } from '../tenant-subscription/pricing/pricing-catalog.service';

@Controller('api/public')
export class PublicController {
  private readonly logger = new Logger(PublicController.name);

  constructor(
    private readonly service: PublicTrialSignupService,
    private readonly pricing: PricingCatalogService,
  ) {}

  private maskEmail(value: unknown): string {
    const email = String(value || '').trim().toLowerCase();
    const [localRaw, domainRaw] = email.split('@');
    const local = localRaw || '';
    const domain = domainRaw || '';
    if (!local || !domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private maskPhone(value: unknown): string {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '***';
    return `${'*'.repeat(Math.max(8, digits.length - 3))}${digits.slice(-3)}`;
  }

  private sanitizeError(error: unknown): Record<string, unknown> {
    const candidate = (error ?? {}) as Record<string, unknown>;
    const status = typeof (candidate as { status?: unknown }).status === 'number'
      ? (candidate as { status: number }).status
      : typeof (candidate as { statusCode?: unknown }).statusCode === 'number'
        ? (candidate as { statusCode: number }).statusCode
        : undefined;

    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      table: typeof candidate.table === 'string' ? candidate.table : undefined,
      column: typeof candidate.column === 'string' ? candidate.column : undefined,
      status,
    };
  }

  @Post('trial-signup')
  async signup(@Body() body: PublicTrialSignupDto, @Req() req: Request) {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
    const maskedEmail = this.maskEmail(body.ownerEmail);
    const maskedPhone = this.maskPhone(body.ownerPhone);

    this.logger.log(`POST /api/public/trial-signup start | email=${maskedEmail} | phone=${maskedPhone}`);
    this.logger.log(`POST /api/public/trial-signup before service | email=${maskedEmail} | phone=${maskedPhone}`);

    try {
      const result = await this.service.signup(body, ip);
      this.logger.log(`POST /api/public/trial-signup after service | email=${maskedEmail} | phone=${maskedPhone}`);
      return result;
    } catch (error) {
      this.logger.error(
        `POST /api/public/trial-signup service threw | email=${maskedEmail} | phone=${maskedPhone}`,
        JSON.stringify(this.sanitizeError(error)),
      );
      throw error;
    }
  }

  /**
   * الرقم المُلزِم للموقع التسويقي وللوحة الساس معاً — نفس المصدر (`pricing-catalog.json`)
   * عبر نفس المحرك (`PricingCatalogService`) اللي بيبني شاشة الاشتراك الداخلية، فمفيش أي
   * فرصة يختلف الرقم المعروض على الموقع عن الرقم اللي هيتحصّل فعلياً (PRICING_AND_PACKAGING.md §13).
   *
   * - `?product=pharmacy&country=EG` → عرض واحد محلول (نفس شكل شاشة الاشتراك).
   * - من غير باراميترات → الكتالوج العام كامل (كل منتج × كل بلد منشور) لبناء صفحات الموقع.
   * لا حقل داخلي يخرج من هنا أبداً — `PricingCatalogService.resolvePublicOffer`
   * هو الحارس للعرض الواحد (يرفض المجهول/المحظور بـ 404)، و`resolveForTenant`
   * للكتالوج الكامل (F40).
   */
  @Get('pricing-catalog')
  @Header('Cache-Control', 'public, max-age=300')
  pricingCatalog(@Query('product') product?: string, @Query('country') country?: string) {
    if (product && country) {
      // المسار الصارم فقط: منتج أو بلد مجهول/محظور يرد 404 بدل عرض أسعار
      // منتج أو بلد آخر بصمت. مسار المنشأة الداخلي يحتفظ بسقوطه الافتراضي.
      const offer = this.pricing.resolvePublicOffer({ industryPresetId: product, countryCode: country });
      if (!offer) {
        throw new NotFoundException({
          code: 'pricing_offer_not_found',
          message: 'No published pricing for the requested product and country.',
        });
      }
      return offer;
    }

    const products = this.pricing.listProducts();
    const countries = this.pricing.listCountries();
    const catalog = products.flatMap((p) =>
      countries.map((c) => this.pricing.resolveForTenant({ industryPresetId: p.id, countryCode: c.code })),
    );

    return {
      version: this.pricing.version,
      products,
      countries,
      catalog,
    };
  }
}

