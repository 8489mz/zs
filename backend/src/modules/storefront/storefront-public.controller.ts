import { Body, Controller, Get, Header, Headers, Param, ParseIntPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorefrontService } from './storefront.service';
import { StorefrontPaymentService } from './storefront-payment.service';
import { StorefrontSocialPreviewService } from './storefront-social-preview.service';
import { StorefrontMediaService } from './storefront-media.service';
import { MarketplaceSyncService, type SupportedMarketplace } from './services/marketplace-sync.service';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { CreateOnlineOrderDto } from './dto/create-online-order.dto';
import { CreateProductReviewDto } from './dto/create-product-review.dto';
import { RecordAbandonedCartDto } from './dto/abandoned-cart.dto';
import { CustomerOrderLookupDto } from './dto/customer-order-lookup.dto';
import { ORDER_ACCESS_TOKEN_HEADER } from './engines/online-order-access.engine';

@Controller('api/storefront')
export class StorefrontPublicController {
  constructor(
    private readonly service: StorefrontService,
    private readonly paymentService: StorefrontPaymentService,
    private readonly socialPreviewService: StorefrontSocialPreviewService,
    private readonly mediaService: StorefrontMediaService,
    private readonly marketplaceSyncService: MarketplaceSyncService,
  ) {}

  /**
   * SF-9: storefront images. Declared first so no `:slug/...` route can shadow it. The URL is
   * content-addressed (id + sha256), so the response never changes and is cached for a year.
   */
  @Get('media/:id/:sha')
  async getMedia(
    @Param('id', ParseIntPipe) id: number,
    @Param('sha') sha: string,
    @Res() res: Response,
  ) {
    const media = await this.mediaService.getMedia(id, String(sha || '').toLowerCase());
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Content-Length', String(media.content.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(media.content);
  }

  // Short shared cache + revalidation (Express adds an ETag, so an unchanged catalog costs a 304).
  // The server keeps its own 60 s catalog cache; this lets browsers and any CDN skip the round trip
  // on quick re-visits and back-navigation.
  @Get(':slug/info')
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
  getInfo(@Param('slug') slug: string) {
    return this.service.getStorefrontInfo(slug);
  }

  /**
   * كتالوج المتجر العام.
   *
   * **بلا معاملات** يعيد الكتالوج كاملاً كما كان — الواجهة الحالية تبحث وتفرز في المتصفح على
   * المصفوفة كاملة، فتغيير الافتراضي يكسر الصفحة. لكنه يُرَدّ الآن من **نصّ مُسلسَل مخزَّن**: كان
   * Express يعيد بناء نحو ثلاثة ميجابايت من JSON لكل زائر على منشأة بـ12 ألف صنف، حتى والبيانات
   * مخزَّنة، لأن التخزين كان يوفّر الاستعلام لا التسلسل.
   *
   * **مع `page` أو `pageSize` أو `categoryId` أو `q`** يعيد صفحة مُصفّاة على السيرفر ومعها
   * `totalCount` و`hasMore`. هذا هو المسار الذي تهاجر إليه الواجهة حين يتحرّك البحث والفرز إلى
   * السيرفر؛ حتى ذلك الحين يبقى موجوداً لمن يريده.
   */
  @Get(':slug/catalog')
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async getCatalog(
    @Param('slug') slug: string,
    @Query() query: Record<string, unknown>,
  ): Promise<string> {
    const wantsPage = ['page', 'pageSize', 'limit', 'categoryId', 'q']
      .some((key) => query?.[key] !== undefined && String(query[key]).trim() !== '');
    if (wantsPage) {
      return JSON.stringify(await this.service.getStorefrontCatalogPage(slug, query));
    }
    return this.service.getStorefrontCatalogJson(slug);
  }

  /**
   * بطاقة المعاينة لزواحف التواصل (واتساب/فيسبوك/تليجرام/جوجل).
   * بوابة nginx وحدها هي من توجّه الزواحف إلى هنا — المستخدم يُخدَّم التطبيق.
   */
  @Get(':slug/social-preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  socialPreview(@Param('slug') slug: string, @Req() req: RequestWithAuth) {
    return this.socialPreviewService.buildPreview(slug, this.resolveOrigin(req));
  }

  @Get(':slug/social-preview/:productId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  socialPreviewProduct(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.socialPreviewService.buildPreview(slug, this.resolveOrigin(req), productId);
  }

  /** يبني الأصل من رؤوس الوكيل حتى تكون روابط og:url مطلقة وصحيحة خلف nginx. */
  private resolveOrigin(req: RequestWithAuth): string {
    const configured = String(process.env.APP_PUBLIC_URL || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
  }

  @Get(':slug/search/suggest')
  getSearchSuggestions(
    @Param('slug') slug: string,
    @Query('q') q: string,
  ) {
    return this.service.getSearchSuggestions(slug, q);
  }

  @Get(':slug/products/:productId')
  getProductDetails(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
  ) {
    return this.service.getProductDetails(slug, Number(productId));
  }

  @Get(':slug/tables-qr')
  getTablesQr(
    @Param('slug') slug: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Headers('host') host?: string,
  ) {
    const baseUrl = host ? `http://${host}` : undefined;
    return this.service.getTablesQrCodes(slug, Number(from || 1), Number(to || 20), baseUrl);
  }

  @Post(':slug/products/:productId/reviews')
  submitProductReview(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
    @Body() body: CreateProductReviewDto,
  ) {
    return this.service.submitProductReview(slug, Number(productId), body);
  }

  @Get(':slug/products/:productId/reviews')
  getProductReviews(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
  ) {
    return this.service.getProductReviews(slug, Number(productId));
  }

  @Post(':slug/coupons/validate')
  validateCoupon(
    @Param('slug') slug: string,
    @Body() body: { code: string; subtotal: number },
  ) {
    return this.service.validateCoupon(slug, body.code, Number(body.subtotal || 0));
  }

  @Post(':slug/cart/quote')
  quoteCart(
    @Param('slug') slug: string,
    @Body() body: any,
  ) {
    return this.service.quoteOnlineOrder(slug, body);
  }

  @Post(':slug/quote')
  quoteAlias(
    @Param('slug') slug: string,
    @Body() body: any,
  ) {
    return this.service.quoteOnlineOrder(slug, body);
  }

  @Post(':slug/orders')
  createOrder(@Param('slug') slug: string, @Body() body: CreateOnlineOrderDto, @Req() req: RequestWithAuth) {
    // The origin the shopper is on, so the tracking link sent to them opens the same store.
    return this.service.createOnlineOrder(slug, body, this.resolveOrigin(req));
  }

  // SF-1: every route below that names a specific order requires that order's access token
  // (header `x-order-token`). The list is a POST so tokens never travel in a URL / access log.
  @Post(':slug/orders/lookup')
  lookupCustomerOrders(
    @Param('slug') slug: string,
    @Body() body: CustomerOrderLookupDto,
  ) {
    return this.service.lookupCustomerOrders(slug, body?.orders || []);
  }

  @Post(':slug/orders/:orderNumber/cancel')
  cancelCustomerOrder(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Headers(ORDER_ACCESS_TOKEN_HEADER) token?: string,
  ) {
    return this.service.cancelCustomerOrder(slug, orderNumber, token);
  }

  @Put(':slug/orders/:orderNumber')
  updateCustomerOrder(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Body() body: CreateOnlineOrderDto,
    @Headers(ORDER_ACCESS_TOKEN_HEADER) token?: string,
  ) {
    return this.service.updateCustomerOrder(slug, orderNumber, token, body);
  }

  @Post(':slug/abandoned-cart')
  recordAbandonedCart(
    @Param('slug') slug: string,
    @Body() body: RecordAbandonedCartDto,
  ) {
    return this.service.recordAbandonedCart(slug, body);
  }

  // --- Online Payment Gateway Endpoints ---

  @Post(':slug/orders/:orderNumber/payment-session')
  createPaymentSession(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Headers(ORDER_ACCESS_TOKEN_HEADER) token?: string,
    @Req() req?: RequestWithAuth,
  ) {
    return this.paymentService.initiatePaymentSession(slug, orderNumber, token, req ? this.resolveOrigin(req) : undefined);
  }

  @Get(':slug/orders/:orderNumber/payment-status')
  getPaymentStatus(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Headers(ORDER_ACCESS_TOKEN_HEADER) token?: string,
  ) {
    return this.paymentService.getOrderPaymentStatus(slug, orderNumber, token);
  }

  @Post(':slug/orders/:orderNumber/mock-pay')
  mockPayOrder(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Body() body: { cardNumber?: string; cardHolder?: string },
    @Headers(ORDER_ACCESS_TOKEN_HEADER) token?: string,
  ) {
    return this.paymentService.processMockPayment(slug, orderNumber, token, body);
  }

  @Post('webhooks/paymob')
  handlePaymobWebhook(
    @Headers() headers: Record<string, any>,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentService.processPaymobWebhook(headers, body, (req as any)?.rawBody);
  }

  @Get('webhooks/paymob')
  handlePaymobCallback(
    @Query() query: Record<string, any>,
  ) {
    return { ok: true, message: 'Paymob callback processed', query };
  }

  @Post('webhooks/xpay')
  handleXPayWebhook(
    @Headers() headers: Record<string, any>,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentService.processXPayWebhook(headers, body, (req as any)?.rawBody);
  }

  @Get('webhooks/xpay')
  handleXPayCallback(
    @Query() query: Record<string, any>,
  ) {
    return { ok: true, message: 'XPay callback received', query };
  }

  @Post('webhooks/tap')
  handleTapWebhook(
    @Headers() headers: Record<string, any>,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentService.processTapWebhook(headers, body, (req as any)?.rawBody);
  }

  @Get('webhooks/tap-callback')
  handleTapCallback(
    @Query() query: Record<string, any>,
  ) {
    return { ok: true, message: 'Tap callback received', query };
  }

  @Post('webhooks/stripe')
  handleStripeWebhook(
    @Headers() headers: Record<string, any>,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentService.processStripeWebhook(headers, body, (req as any)?.rawBody);
  }

  /**
   * Inbound marketplace webhooks (INV-MARKETPLACE-WEBHOOK-PERSISTENCE).
   * Public by necessity: marketplace gateways cannot hold a staff
   * session (the previous route lived behind SessionAuthGuard, so no
   * external gateway could ever reach it). The handler ONLY persists
   * the raw payload and returns 200 after the insert -- it creates no
   * order, moves no stock, and runs no repricing. Acting on these
   * payloads needs signature verification first (separate package).
   */
  @Post('webhooks/marketplace/:marketplace')
  handleMarketplaceWebhook(
    @Param('marketplace') marketplace: SupportedMarketplace,
    @Body() body: any,
  ) {
    return this.marketplaceSyncService.receiveMarketplaceWebhook(marketplace, body);
  }

  /**
   * Next-Gen F&B: Get active table check / bill for Pay-at-Table via QR code
   */
  @Get(':slug/table/:tableNumber/bill')
  getTableBill(
    @Param('slug') slug: string,
    @Param('tableNumber') tableNumber: string,
  ) {
    return this.service.getActiveTableBill(slug, tableNumber);
  }

  /**
   * Next-Gen F&B: Pay active table check / bill via QR online checkout
   */
  @Post(':slug/table/:tableNumber/pay-bill')
  payTableBill(
    @Param('slug') slug: string,
    @Param('tableNumber') tableNumber: string,
    @Body() body: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string },
  ) {
    return this.service.payActiveTableBill(slug, tableNumber, body);
  }
}

