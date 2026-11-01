export interface StorefrontInfo {
  tenantId: string;
  slug: string;
  businessName: string;
  enabled: boolean;
  title: string;
  description?: string;
  address?: string;
  bio: string;
  announcement: string;
  bannerUrl: string;
  bannerUrls?: string[];
  bannerFit?: 'contain' | 'cover';
  bannerPosition?: string;
  bannerPositions?: string[];
  bannerIntervalSeconds?: number;
  smartDealsEnabled?: boolean;
  freeShippingEnabled?: boolean;
  freeShippingMinOrder?: number;
  deliveryFee: number;
  deliveryZones?: StorefrontDeliveryZone[];
  minOrder: number;
  whatsappPhone: string;
  currency: string;
  countryCode?: string;
  onlinePaymentEnabled?: boolean;
  onlinePaymentTestMode?: boolean;
  onlinePaymentProvider?: string;
  paymobApiKey?: string;
  paymobIntegrationId?: string;
  paymobIframeId?: string;
  paymobHmacSecret?: string;
  paymobTestMode?: boolean;
  xpayApiKey?: string;
  xpayCommunityId?: string;
  xpayTestMode?: boolean;
  tapSecretKey?: string;
  tapPublishableKey?: string;
  tapTestMode?: boolean;
  stripeSecretKey?: string;
  stripePublishableKey?: string;
  stripeWebhookSecret?: string;
  stripeTestMode?: boolean;
  logo_url?: string;
  logoUrl?: string;
  brandColor?: string;
  brandSecondaryColor?: string;
  brandSurfaceColor?: string;
  themePreset?: string;
  metaPixelId?: string;
  ga4Id?: string;
  tiktokPixelId?: string;
  snapchatPixelId?: string;
  pickupEnabled?: boolean;
  allowOutOfStockOrders?: boolean;
  showOutOfStockProducts?: boolean;
  midBannersEnabled?: boolean;
  midBanners?: StorefrontMidBanner[];
  heroBannerFullBleed?: boolean;
  heroHeadline?: string;
  heroSubtitle?: string;
  supportEmail?: string;
  contactPhone?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  telegramUrl?: string;
}

export interface StorefrontMidBanner {
  id: string;
  imageUrl: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  linkType?: 'category' | 'deals' | 'url' | 'none';
  categoryId?: number;
  customUrl?: string;
  slot?: 'after_deals' | 'after_row_1' | 'after_row_2' | 'bottom';
  isEnabled?: boolean;
}

export interface StorefrontCategory {
  id: number;
  name: string;
  imageUrl?: string;
}

export interface StorefrontProduct {
  id: number;
  name: string;
  barcode: string;
  price: number;
  originalPrice?: number;
  hasDiscount?: boolean;
  discountPercent?: number;
  offerBadge?: string;
  offerType?: string;
  offerValue?: number;
  bogoBuyQty?: number;
  bogoGetQty?: number;
  bogoDiscountPercent?: number;
  minQty?: number;
  categoryId: number | null;
  categoryName: string;
  stockQty: number;
  inStock: boolean;
  icon: string;
  imageUrl: string;
  description: string;
  rating?: number;
  reviewCount?: number;
  variants?: StorefrontProductVariant[];
  /** Set on a cart line only: the chosen variant, priced by storefront-variant-pricing (SF-4). */
  variantName?: string | null;
  /** Set on a cart line only: the catalog price before the variant was applied. */
  basePrice?: number;
}

export interface StorefrontProductVariant {
  name: string;
  price?: number | string | null;
  extraPrice?: number | string | null;
  /** Display-only photo for this variant (mirror of the server's
   * ProductVariantDef). Never priced; the QuickView swaps to it when the
   * variant is picked, falling back to the product photo. */
  imageUrl?: string | null;
}

export interface StorefrontReview {
  id: number;
  rating: number;
  customerName: string;
  comment?: string;
  createdAt: string;
}

export interface StorefrontCatalogResponse {
  categories: StorefrontCategory[];
  products: StorefrontProduct[];
}

export interface CartItem {
  product: StorefrontProduct;
  quantity: number;
}

export interface CreateOnlineOrderPayload {
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerNotes?: string;
  items: Array<{
    productId: number | string;
    quantity: number;
    notes?: string;
    variantName?: string;
  }>;
  paymentMethod?: string;
  couponCode?: string;
  deliveryZoneId?: number;
  deliveryZoneName?: string;
  orderType?: 'delivery' | 'dine_in';
  tableNumber?: string;
  fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';
  countryCode?: string;
  pickupBranchId?: number;
  idempotencyKey?: string;
}

export interface QuoteCartPayload {
  items: Array<{
    productId: number | string;
    quantity: number;
    variantName?: string | null;
  }>;
  couponCode?: string;
  deliveryZoneId?: number;
  deliveryZoneName?: string;
  fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';
  orderType?: 'delivery' | 'dine_in';
  tableNumber?: string;
}

export interface QuoteCartItemResult {
  productId: number | string;
  name: string;
  variantName?: string | null;
  barcode?: string;
  quantity: number;
  baseUnitPrice: number;
  unitPrice: number;
  total: number;
  originalTotal: number;
  hasDiscount?: boolean;
  discountPercent?: number;
  offerBadge?: string;
  offerType?: string;
}

export interface QuoteCartResponse {
  ok: boolean;
  subtotal: number;
  originalSubtotal: number;
  bogoSavings: number;
  discountAmount: number;
  deliveryFee: number;
  deliveryZoneId?: number | null;
  deliveryZoneName?: string | null;
  appliedCouponCode?: string | null;
  totalAmount: number;
  items: QuoteCartItemResult[];
}

export interface CreateOnlineOrderResponse {
  ok: boolean;
  orderId: number;
  orderNumber: string;
  /** Secret for this order's public routes (SF-1). Returned once; store it with the order number. */
  accessToken?: string;
  /** Link that opens this order's tracking on any device (token in the URL fragment). */
  trackingUrl?: string | null;
  totalAmount: number;
  subtotal: number;
  deliveryFee: number;
  deliveryZoneId?: number | null;
  deliveryZoneName?: string | null;
  discountAmount?: number;
  couponCode?: string | null;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  orderType?: 'delivery' | 'dine_in' | 'pickup' | string;
  tableNumber?: string | number | null;
  whatsappUrl: string | null;
}

export interface OnlineOrderRecord {
  id: number;
  orderNumber: string;
  orderType?: 'delivery' | 'dine_in' | 'pickup' | string;
  order_type?: string;
  tableNumber?: string | number | null;
  table_number?: string | number | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  customerNotes: string | null;
  deliveryZoneId?: number | null;
  deliveryZoneName?: string | null;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  discountAmount?: number;
  couponCode?: string | null;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: string;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  gatewayProvider?: string | null;
  gatewayTransactionId?: string | null;
  paidAt?: string | null;
  saleId: number | null;
  deliveryRepName?: string | null;
  deliveryRepPhone?: string | null;
  shippingCarrier?: 'internal' | 'bosta' | string | null;
  bostaDeliveryId?: string | null;
  bostaTrackingNumber?: string | null;
  bostaStatus?: string | null;
  bostaAwbUrl?: string | null;
  bostaCreatedAt?: string | null;
  gccShippingCarrier?: 'aramex' | 'smsa' | string | null;
  gccShippingId?: string | null;
  gccTrackingNumber?: string | null;
  gccShippingStatus?: string | null;
  gccAwbUrl?: string | null;
  gccShippingCreatedAt?: string | null;
  gcc_shipping_carrier?: 'aramex' | 'smsa' | string | null;
  gcc_shipping_id?: string | null;
  gcc_tracking_number?: string | null;
  gcc_shipping_status?: string | null;
  gcc_awb_url?: string | null;
  gcc_shipping_created_at?: string | null;
  countryCode?: string | null;
  country_code?: string | null;
  currency?: string | null;
  createdAt: string;
  updatedAt?: string;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    notes?: string;
  }>;
}

export interface BostaSettings {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  apiKey: string;
  pickupBusinessName?: string;
  pickupPhone?: string;
  pickupCity?: string;
  pickupAddress?: string;
}

export interface BostaShipmentPayload {
  specs?: {
    packageType?: 'Parcel' | 'Document';
    size?: 'SMALL' | 'MEDIUM' | 'LARGE';
    itemsCount: number;
    description: string;
    weight?: number;
  };
  cod?: number;
  notes?: string;
  receiverAddress?: string;
  receiverCity?: string;
}

export interface StorefrontSettingsPayload {
  enabled?: boolean;
  title?: string;
  address?: string;
  bio?: string;
  logoUrl?: string;
  logo_url?: string;
  announcement?: string;
  bannerUrl?: string;
  bannerUrls?: string[];
  bannerFit?: 'contain' | 'cover';
  bannerPosition?: string;
  bannerPositions?: string[];
  bannerIntervalSeconds?: number;
  smartDealsEnabled?: boolean;
  freeShippingEnabled?: boolean;
  freeShippingMinOrder?: number;
  deliveryFee?: number;
  minOrder?: number;
  whatsappPhone?: string;
  customDomain?: string;
  onlinePaymentEnabled?: boolean;
  onlinePaymentProvider?: string;
  paymobApiKey?: string;
  paymobIntegrationId?: string;
  paymobIframeId?: string;
  paymobHmacSecret?: string;
  paymobTestMode?: boolean;
  xpayApiKey?: string;
  xpayCommunityId?: string;
  xpayTestMode?: boolean;
  tapSecretKey?: string;
  tapPublishableKey?: string;
  tapTestMode?: boolean;
  stripeSecretKey?: string;
  stripePublishableKey?: string;
  stripeWebhookSecret?: string;
  stripeTestMode?: boolean;
  brandColor?: string;
  brandSecondaryColor?: string;
  brandSurfaceColor?: string;
  themePreset?: string;
  allowOutOfStockOrders?: boolean;
  showOutOfStockProducts?: boolean;
  midBannersEnabled?: boolean;
  midBanners?: StorefrontMidBanner[];
  heroBannerFullBleed?: boolean;
  heroHeadline?: string;
  heroSubtitle?: string;
  supportEmail?: string;
  contactPhone?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  telegramUrl?: string;
}

export interface StorefrontPaymentSessionResponse {
  ok: boolean;
  mode: 'paymob' | 'xpay' | 'tap' | 'stripe' | 'mock';
  provider: string;
  orderNumber: string;
  amount: number;
  currency?: string;
  testMode?: boolean;
  paymentToken?: string;
  iframeId?: string;
  iframeUrl?: string;
  checkoutUrl?: string;
  transactionId?: string;
  orderId?: string;
  isPaid?: boolean;
  message?: string;
}

export interface StorefrontPaymentStatusResponse {
  ok: boolean;
  orderNumber: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  orderStatus: string;
  totalAmount: number;
  gatewayProvider?: string | null;
  gatewayTransactionId?: string | null;
  paidAt?: string | null;
}

export interface StorefrontCoupon {
  id: number;
  code: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping';
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  timesUsed: number;
  isActive: boolean;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCouponPayload {
  code: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping';
  discountValue: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateCouponPayload extends Partial<CreateCouponPayload> {}

export interface ValidateCouponResponse {
  ok: boolean;
  code?: string;
  discountType?: 'percentage' | 'fixed' | 'free_shipping';
  discountValue?: number;
  discountAmount?: number;
  isFreeShipping?: boolean;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  message?: string;
}

export interface StorefrontDeliveryZone {
  id: number;
  name: string;
  deliveryFee: number;
  estimatedTime?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateDeliveryZonePayload {
  name: string;
  deliveryFee: number;
  estimatedTime?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateDeliveryZonePayload extends Partial<CreateDeliveryZonePayload> {}

export interface AbandonedCartRecord {
  id: number;
  customerName: string;
  customerPhone: string;
  countryCode: string;
  items: Array<{
    productId: number | string;
    quantity: number;
    name?: string;
    unitPrice?: number;
    total?: number;
  }>;
  subtotal: number;
  recovered: boolean;
  createdAt: string;
}

export interface StorefrontAnalytics {
  totalOrders: number;
  totalRevenue: number;
  deliveredOrders: number;
  cancelledOrders: number;
  pendingOrders: number;
  confirmedOrders?: number;
  processingOrders?: number;
  shippedOrders?: number;
  averageOrderValue: number;
  unrecoveredAbandoned: number;
  recoveredAbandoned: number;
  abandonedCartsCount?: number;
  conversionRate: number;
  todayOrders?: number;
  todayRevenue?: number;
  topSellingProducts?: Array<{
    productId: number;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
  lowStockStorefrontProducts?: Array<{
    id: number;
    name: string;
    stock: number;
    price: number;
  }>;
  statusBreakdown?: Record<string, number>;
}


