import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateStorefrontSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  announcement?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bannerUrls?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrder?: number;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsString()
  bannerFit?: 'contain' | 'cover';

  @IsOptional()
  @IsString()
  bannerPosition?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bannerPositions?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  bannerIntervalSeconds?: number;

  @IsOptional()
  @IsString()
  customDomain?: string;

  @IsOptional()
  @IsBoolean()
  smartDealsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  freeShippingEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeShippingMinOrder?: number;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsBoolean()
  onlinePaymentEnabled?: boolean;

  @IsOptional()
  @IsString()
  onlinePaymentProvider?: string;

  @IsOptional()
  @IsString()
  paymobApiKey?: string;

  @IsOptional()
  @IsString()
  paymobIntegrationId?: string;

  @IsOptional()
  @IsString()
  paymobIframeId?: string;

  @IsOptional()
  @IsString()
  paymobHmacSecret?: string;

  @IsOptional()
  @IsBoolean()
  paymobTestMode?: boolean;

  @IsOptional()
  @IsString()
  xpayApiKey?: string;

  @IsOptional()
  @IsString()
  xpayCommunityId?: string;

  @IsOptional()
  @IsBoolean()
  xpayTestMode?: boolean;

  // Tap Payments (GCC)
  @IsOptional()
  @IsString()
  tapSecretKey?: string;

  @IsOptional()
  @IsString()
  tapPublishableKey?: string;

  @IsOptional()
  @IsBoolean()
  tapTestMode?: boolean;

  // Stripe (International)
  @IsOptional()
  @IsString()
  stripeSecretKey?: string;

  @IsOptional()
  @IsString()
  stripePublishableKey?: string;

  @IsOptional()
  @IsString()
  stripeWebhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  stripeTestMode?: boolean;

  // Custom Branding (3-Color Premium Identity)
  @IsOptional()
  @IsString()
  brandColor?: string;

  @IsOptional()
  @IsString()
  brandSecondaryColor?: string;

  @IsOptional()
  @IsString()
  brandSurfaceColor?: string;

  @IsOptional()
  @IsString()
  themePreset?: string;

  // Tracking Pixels
  @IsOptional()
  @IsString()
  metaPixelId?: string;

  @IsOptional()
  @IsString()
  ga4Id?: string;

  @IsOptional()
  @IsString()
  tiktokPixelId?: string;

  @IsOptional()
  @IsString()
  snapchatPixelId?: string;

  // Fulfillment Options
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  // Stock Availability
  @IsOptional()
  @IsBoolean()
  allowOutOfStockOrders?: boolean;

  @IsOptional()
  @IsBoolean()
  showOutOfStockProducts?: boolean;

  /**
   * من أي مخازن يبيع المتجر الإلكتروني:
   *   `follow_branch`   — كإعداد الفرع (الافتراضي، فلا يتغيّر سلوك منشأة قائمة)
   *   `branch_only`     — مخزن الفرع وحده، حتى لو كان الكاشير يبيع من كل المخازن
   *   `all_operational` — كل المخازن التشغيلية، حتى لو كان الكاشير مقيَّداً
   *
   * التجاوز موجود لحالة حقيقية: مالكٌ عنده عدة مخازن يريد محلّه يبيع من كلها بينما موقعه لا يبيع
   * إلا مما في المحل. والكتالوج يعرض الرصيد المحسوب من **نفس** هذه المخازن، فلا يرى الزبون صنفاً
   * لا يستطيع طلبه.
   */
  @IsOptional()
  @IsIn(['follow_branch', 'branch_only', 'all_operational'])
  stockMode?: 'follow_branch' | 'branch_only' | 'all_operational';

  // Mid-Page Interstitial Banners & Full-Bleed Layout
  @IsOptional()
  @IsBoolean()
  midBannersEnabled?: boolean;

  @IsOptional()
  @IsArray()
  midBanners?: any[];

  @IsOptional()
  @IsBoolean()
  heroBannerFullBleed?: boolean;

  // Storefront Marketing Copy & Headlines
  @IsOptional()
  @IsString()
  heroHeadline?: string;

  @IsOptional()
  @IsString()
  heroSubtitle?: string;

  // Contact & Support Information
  @IsOptional()
  @IsString()
  supportEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  // Social Media Channels
  @IsOptional()
  @IsString()
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  instagramUrl?: string;

  @IsOptional()
  @IsString()
  twitterUrl?: string;

  @IsOptional()
  @IsString()
  tiktokUrl?: string;

  @IsOptional()
  @IsString()
  youtubeUrl?: string;

  @IsOptional()
  @IsString()
  telegramUrl?: string;
}
