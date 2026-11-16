import { http } from '@/lib/http';

export type TenantSubscriptionData = {
  tenant: {
    id: string;
    slug: string;
    businessName: string;
    ownerName: string;
    ownerPhone: string;
    status: string;
    planId?: string | null;
    activityType?: string | null;
    pillar?: string | null;
    features?: string[];
    trialStartsAt: string | null;
    trialEndsAt: string | null;
    createdAt: string;
  };
  subscription: {
    id: number;
    status: string;
    startsAt: string;
    endsAt: string;
    graceEndsAt: string | null;
    autoRenew: boolean;
    planId: number;
    planName: string;
    planCode: string;
    planPrice: number;
    planCurrency: string;
    billingPeriodMonths: number;
  } | null;
  usage: {
    users: { current: number; max: number | null };
    branches: { current: number; max: number | null };
    locations: { current: number };
    products: { current: number };
    sales: { current: number };
  };
  statusMeta: {
    daysRemaining: number | null;
    isExpiringSoon: boolean;
    isExpired: boolean;
  };
  availablePlans: Array<{
    id: number;
    name: string;
    code: string;
    price: number;
    currency: string;
    billingPeriodMonths: number;
    maxUsers: number | null;
    maxBranches: number | null;
    featurePlanId: string | null;
    pricingBand?: number | null;
    pricingLevel?: number | null;
  }>;
  payments: Array<{
    id: number;
    amount: number;
    currency: string;
    method: string;
    reference: string | null;
    paidAt: string;
    planName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
};

/* ------------------------------------------------------------------ *
 * التسعير المعتمد — مصدره `pricing/pricing-catalog.json` عبر الخادم.
 * لا رقم سعر مكتوب في الواجهة (الثابت PRICE-2 · النمط المحظور F40).
 * ولا حقل داخلي هنا: لا نطاق ولا مضاعف جغرافي ولا أرضية تفاوض.
 * ------------------------------------------------------------------ */

export type ResolvedPricingFeatureGroup = {
  name: string;
  items: string[];
};

export type ResolvedPricingLevel = {
  id: string;
  name: string;
  limits: {
    branches?: number | null;
    posTerminals?: number | null;
    users?: number | null;
    activeProjects?: number | null;
    containersPerMonth?: number | null;
    multiCompany?: boolean;
  };
  currency: string;
  monthly: number;
  annual: number;
  featureGroups: ResolvedPricingFeatureGroup[];
  /** ميزات النشاط نفسه — في المستوى الأول فقط */
  sectorFeatures: string[];
};

export type ResolvedPricing = {
  catalogVersion: string;
  product: { id: string; name: string; pos: boolean };
  country: { code: string; currency: string; requiresWrittenDisclosure: boolean };
  /** المقاولات والشحن تُعرض بالسنوي فقط */
  quoteAnnuallyOnly: boolean;
  annualEqualsMonths: number;
  trialDays: number;
  levels: ResolvedPricingLevel[];
  floors: Array<{
    id: string;
    name: string;
    monthly: number | null;
    contactForPrice: boolean;
    includedFromLevel: string | null;
    pricingRule?: string;
  }>;
  addons: {
    extraUserMonthly: number | null;
    extraBranchMonthly: number | null;
  };
};

export const tenantSubscriptionApi = {
  getMySubscription: () => http<TenantSubscriptionData>('/api/tenant-subscription/me'),
  getPricing: (vertical?: string) =>
    http<ResolvedPricing>(`/api/tenant-subscription/pricing${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ''}`),
  requestRenewal: (payload: { planId: number; billingPeriodMonths?: number; paymentMethod?: string; notes?: string }) =>
    http<{ ok: boolean; message: string; plan: { id: number; name: string; price: number; currency: string } }>(
      '/api/tenant-subscription/request-renewal',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  initiateOnlinePayment: (payload: { planId: number; billingPeriodMonths?: number; gateway?: 'xpay' | 'paymob' | 'stripe'; redirectUrl?: string }) =>
    http<{ ok: boolean; paymentUrl: string; transactionReference: string; gateway: string; message?: string }>(
      '/api/tenant-subscription/initiate-online-payment',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};
