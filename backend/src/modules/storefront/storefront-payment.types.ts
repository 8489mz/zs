import { type Selectable } from 'kysely';
import { Database } from '../../database/database.types';

export interface TenantPaymentConfig {
  enabled: boolean;
  provider: 'paymob' | 'xpay' | 'tap' | 'stripe' | 'mock';
  apiKey: string;
  secretKey?: string;
  publicKey?: string;
  integrationId: string;
  iframeId: string;
  hmacSecret: string;
  testMode: boolean;
  xpayApiKey: string;
  xpayCommunityId: string;
  xpayTestMode: boolean;
  tapSecretKey: string;
  tapPublishableKey: string;
  tapTestMode: boolean;
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeWebhookSecret: string;
  stripeTestMode: boolean;
}

export interface StorefrontWebhookResult {
  ok: boolean;
  status?: string;
  orderNumber?: string;
  alreadyPaid?: boolean;
  message?: string;
  received?: boolean;
}

export type LockedOnlineOrder = Selectable<Database['online_orders']>;
