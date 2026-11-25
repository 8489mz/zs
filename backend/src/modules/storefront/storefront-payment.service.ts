import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, type Transaction } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { StorefrontPaymentHelpersService } from './storefront-payment-helpers.service';
import { StorefrontPaymentSessionService } from './storefront-payment-session.service';
import { StorefrontPaymentWebhooksService } from './storefront-payment-webhooks.service';
import { StorefrontPaymentWebhooks2Service } from './storefront-payment-webhooks-2.service';
import {
  type LockedOnlineOrder,
  type StorefrontWebhookResult,
  type TenantPaymentConfig,
} from './storefront-payment.types';

@Injectable()
export class StorefrontPaymentService {
  private readonly helpers: StorefrontPaymentHelpersService;
  private readonly logger = new Logger(StorefrontPaymentService.name);
  private readonly session: StorefrontPaymentSessionService;
  private readonly webhooks: StorefrontPaymentWebhooksService;
  private readonly webhooks2: StorefrontPaymentWebhooks2Service;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {
    this.helpers = new StorefrontPaymentHelpersService({
      db: this.db,
    });
    this.session = new StorefrontPaymentSessionService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      findOrderByToken: this.findOrderByToken.bind(this),
      sandboxSessionOrThrow: this.sandboxSessionOrThrow.bind(this),
    });
    this.webhooks = new StorefrontPaymentWebhooksService({
      db: this.db,
      whatsappService: this.whatsappService,
      paymentReviewReason: this.paymentReviewReason.bind(this),
      markPaymentForReview: this.markPaymentForReview.bind(this),
      isCurrentPaymentSession: this.isCurrentPaymentSession.bind(this),
      isRepeatedPaidWebhook: this.isRepeatedPaidWebhook.bind(this),
      getTenantPaymentConfig: this.getTenantPaymentConfig.bind(this),
    });
    this.webhooks2 = new StorefrontPaymentWebhooks2Service({
      db: this.db,
      whatsappService: this.whatsappService,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      findOrderByToken: this.findOrderByToken.bind(this),
      expectedPaymentCurrency: this.expectedPaymentCurrency.bind(this),
      paymentReviewReason: this.paymentReviewReason.bind(this),
      markPaymentForReview: this.markPaymentForReview.bind(this),
      isCurrentPaymentSession: this.isCurrentPaymentSession.bind(this),
      isRepeatedPaidWebhook: this.isRepeatedPaidWebhook.bind(this),
      getTenantPaymentConfig: this.getTenantPaymentConfig.bind(this),
      resolveWebhookOrder: this.resolveWebhookOrder.bind(this),
      compensateFailedOrderPayment: this.compensateFailedOrderPayment.bind(this),
    });
  }

  private async expectedPaymentCurrency(
    trx: Transaction<Database>,
    tenantId: string,
    provider: string,
  ): Promise<string> {
    return this.helpers.expectedPaymentCurrency(trx, tenantId, provider);
  }

  private paymentReviewReason(
    order: LockedOnlineOrder,
    provider: string,
    sessionId: string,
    amountMinor: unknown,
    currency: unknown,
    expectedCurrency: string,
  ): string | null {
    return this.helpers.paymentReviewReason(order, provider, sessionId, amountMinor, currency, expectedCurrency);
  }

  private async markPaymentForReview(
    trx: Transaction<Database>,
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
    response: unknown,
    reason: string,
  ): Promise<StorefrontWebhookResult> {
    return this.helpers.markPaymentForReview(trx, order, provider, transactionId, sessionId, response, reason);
  }

  private isCurrentPaymentSession(order: LockedOnlineOrder, provider: string, sessionId: string): boolean {
    return this.helpers.isCurrentPaymentSession(order, provider, sessionId);
  }

  private isRepeatedPaidWebhook(
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
  ): boolean {
    return this.helpers.isRepeatedPaidWebhook(order, provider, transactionId, sessionId);
  }

  private async getTenantBySlug(slug: string) {
    return this.helpers.getTenantBySlug(slug);
  }

  private async findOrderByToken(tenantId: string, orderNumber: string, token: string | undefined) {
    return this.helpers.findOrderByToken(tenantId, orderNumber, token);
  }

  private sandboxSessionOrThrow(config: TenantPaymentConfig, session: Record<string, unknown>) {
    return this.helpers.sandboxSessionOrThrow(config, session);
  }

  async getTenantPaymentConfig(tenantId: string): Promise<TenantPaymentConfig> {
    return this.session.getTenantPaymentConfig(tenantId);
  }

  async initiatePaymentSession(slug: string, orderNumber: string, token: string | undefined, origin?: string) {
    return this.session.initiatePaymentSession(slug, orderNumber, token, origin);
  }

  private async resolveWebhookOrder(params: {
    provider: string;
    tenantId: string;
    orderNumber: string;
    gatewayOrderId: string;
  }) {
    return this.webhooks.resolveWebhookOrder(params);
  }

  private async compensateFailedOrderPayment(
    trx: Transaction<Database>,
    order: any,
    gatewayResponse: any,
  ): Promise<void> {
    return this.webhooks.compensateFailedOrderPayment(trx, order, gatewayResponse);
  }

  async processPaymobWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
    return this.webhooks.processPaymobWebhook(headers, body, rawBody);
  }

  async processXPayWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
    return this.webhooks.processXPayWebhook(headers, body, rawBody);
  }

  async processMockPayment(
    slug: string,
    orderNumber: string,
    token: string | undefined,
    payload?: { cardNumber?: string; cardHolder?: string },
  ) {
    return this.webhooks2.processMockPayment(slug, orderNumber, token, payload);
  }

  async getOrderPaymentStatus(slug: string, orderNumber: string, token: string | undefined) {
    return this.webhooks2.getOrderPaymentStatus(slug, orderNumber, token);
  }

  async processTapWebhook(headers: Record<string, any>, body: any, rawBody?: Buffer): Promise<StorefrontWebhookResult> {
    return this.webhooks2.processTapWebhook(headers, body, rawBody);
  }

  async processStripeWebhook(
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<StorefrontWebhookResult> {
    return this.webhooks2.processStripeWebhook(headers, body, rawBody);
  }
}
