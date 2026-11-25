import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { Database } from '../../database/database.types';
import { verifyOrderAccessToken, isSandboxPaymentAllowed } from './engines/online-order-access.engine';
import { resolveGatewayCurrency, toGatewayMinorAmount } from './engines/gateway-amount.engine';
import {
  type TenantPaymentConfig,
  type StorefrontWebhookResult,
  type LockedOnlineOrder,
} from './storefront-payment.types';

/**
 * StorefrontPaymentHelpersService — slice S1 of the storefront-payment split.
 * Pure move of the eight small helpers from StorefrontPaymentService. No
 * behavior change: the bodies are byte-identical except for the forced
 * visibility change below; the facade keeps thin delegates with the same
 * names and signatures. This slice is the leaf of the split — it takes
 * only the database handle and never imports another slice service. The
 * helpers are public here (private in the facade) — the facade, a
 * different class, cannot call a private slice method (tsc TS2341); the
 * facade delegates stay private, so the facade public surface is
 * unchanged.
 */

export interface StorefrontPaymentHelpersDeps {
  db: Kysely<Database>;
}

@Injectable()
export class StorefrontPaymentHelpersService {
  private readonly db: Kysely<Database>;
  private readonly logger = new Logger(StorefrontPaymentHelpersService.name);

  constructor(deps: StorefrontPaymentHelpersDeps) {
    this.db = deps.db;
  }

  async expectedPaymentCurrency(trx: Transaction<Database>, tenantId: string, provider: string): Promise<string> {
    const row = await trx
      .selectFrom('settings')
      .select('value')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('key', '=', 'currency')
      .executeTakeFirst();
    let value = String(row?.value || '');
    try {
      value = String(JSON.parse(value));
    } catch {}
    return resolveGatewayCurrency(provider, value);
  }

  paymentReviewReason(
    order: LockedOnlineOrder,
    provider: string,
    sessionId: string,
    amountMinor: unknown,
    currency: unknown,
    expectedCurrency: string,
  ): string | null {
    if (
      order.status === 'cancelled' ||
      order.status === 'payment_failed' ||
      order.status === 'review_required' ||
      order.sale_id != null ||
      (order.stock_reserved === false && order.stock_reserved_at != null)
    ) {
      return 'late_or_released_order';
    }
    if (
      order.gateway_provider !== provider ||
      !order.gateway_order_id ||
      !sessionId ||
      String(order.gateway_order_id) !== sessionId
    )
      return 'payment_session_mismatch';
    const paidMinor = Number(amountMinor);
    const expectedMinor = toGatewayMinorAmount(Number(order.total_amount), expectedCurrency);
    if (!Number.isSafeInteger(paidMinor) || paidMinor !== expectedMinor) return 'amount_mismatch';
    if (typeof currency !== 'string' || currency.toUpperCase() !== expectedCurrency) return 'currency_mismatch';
    return null;
  }

  async markPaymentForReview(
    trx: Transaction<Database>,
    order: LockedOnlineOrder,
    provider: string,
    transactionId: string,
    sessionId: string,
    response: unknown,
    reason: string,
  ): Promise<StorefrontWebhookResult> {
    await trx
      .updateTable('online_orders')
      .set({
        payment_status: 'paid',
        status: 'review_required',
        gateway_provider: order.payment_status === 'paid' ? order.gateway_provider : provider,
        gateway_transaction_id: order.payment_status === 'paid' ? order.gateway_transaction_id : transactionId,
        gateway_response_json: JSON.stringify({
          reason,
          receivedTransactionId: transactionId,
          receivedSessionId: sessionId,
          previousTransactionId: order.gateway_transaction_id,
          webhook: response,
        }),
        paid_at: order.paid_at || new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', order.id)
      .where(sql<boolean>`tenant_id = ${order.tenant_id}`)
      .execute();
    this.logger.warn(`${provider} payment requires review for online order ${order.id}: ${reason}`);
    return { ok: true, status: 'review_required', orderNumber: order.order_number };
  }

  isCurrentPaymentSession(order: LockedOnlineOrder, provider: string, sessionId: string): boolean {
    return (
      order.gateway_provider === provider &&
      Boolean(sessionId) &&
      Boolean(order.gateway_order_id) &&
      String(order.gateway_order_id) === sessionId
    );
  }

  isRepeatedPaidWebhook(order: LockedOnlineOrder, provider: string, transactionId: string, sessionId: string): boolean {
    return (
      order.payment_status === 'paid' &&
      order.gateway_provider === provider &&
      Boolean(transactionId) &&
      String(order.gateway_transaction_id || '') === transactionId &&
      this.isCurrentPaymentSession(order, provider, sessionId)
    );
  }

  async getTenantBySlug(slug: string) {
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
    if (!cleanSlug || cleanSlug === 'admin') throw new NotFoundException('المتجر غير موجود');

    let tenant = await this.db.selectFrom('tenants').selectAll().where('slug', '=', cleanSlug).executeTakeFirst();

    if (!tenant && cleanSlug.includes('.')) {
      tenant = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('custom_domain', '=', cleanSlug)
        .executeTakeFirst();
    }

    if (!tenant) {
      const slugSetting = await this.db
        .selectFrom('settings')
        .select('tenant_id')
        .where('key', '=', 'storefront_slug')
        .where(sql<boolean>`LOWER(TRIM(BOTH '"' FROM value)) = ${cleanSlug}`)
        .executeTakeFirst();

      if (slugSetting) {
        tenant = await this.db
          .selectFrom('tenants')
          .selectAll()
          .where('id', '=', slugSetting.tenant_id)
          .executeTakeFirst();
      }
    }

    if (
      !tenant &&
      (cleanSlug === 'default' ||
        cleanSlug === 'almhnds' ||
        cleanSlug === 'slmhnds' ||
        cleanSlug === 'elmhnds' ||
        cleanSlug === 'almohandes' ||
        cleanSlug === 'elmohandes')
    ) {
      tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', 'default').executeTakeFirst();

      if (!tenant) {
        tenant = await this.db.selectFrom('tenants').selectAll().orderBy('created_at', 'asc').executeTakeFirst();
      }
    }

    if (!tenant) throw new NotFoundException('المتجر غير موجود');
    return tenant;
  }

  /** SF-1: same contract as StorefrontService.findCustomerOrderByToken — one 404 for "missing" and "wrong token". */
  async findOrderByToken(tenantId: string, orderNumber: string, token: string | undefined) {
    const cleanOrderNumber = String(orderNumber || '').trim();
    if (!cleanOrderNumber || !token) {
      throw new NotFoundException('الطلب غير موجود');
    }
    const candidates = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('order_number', '=', cleanOrderNumber)
      .limit(10)
      .execute();
    const order = candidates.find((row) => verifyOrderAccessToken(token, row.access_token_hash));
    if (!order) {
      throw new NotFoundException('الطلب غير موجود');
    }
    return order;
  }

  /**
   * SF-2: the simulator screen is offered only in test mode. With live credentials a failed
   * gateway call must surface as an error, never silently degrade into a fake checkout.
   */
  sandboxSessionOrThrow(config: TenantPaymentConfig, session: Record<string, unknown>) {
    if (!isSandboxPaymentAllowed(config)) {
      throw new BadRequestException(
        'تعذر بدء جلسة الدفع الإلكتروني حالياً، يرجى المحاولة لاحقاً أو اختيار الدفع عند الاستلام',
      );
    }
    return session;
  }
}
