import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { fieldCollectionPaymentScope, resolveFieldCollectionChannel } from '../services/van-common.util';
import { VanCollectionsAndSwapsService } from '../services/van-collections-and-swaps.service';
import type {
  RecordFieldCollectionPayload,
  RecordFieldCollectionInternalPayload,
  ExecuteDamagedSwapPayload,
  ExecuteDamagedSwapResult,
} from './van-sales-types';

export class FieldCollectionService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly getCollectionsAndSwaps: () => VanCollectionsAndSwapsService,
    private readonly inFlightCollectionPromises: Map<string, Promise<any>>,
    private readonly recentCollectionsCache: Map<string, { result: any; timestamp: number }>,
    // Lazy getter for the FACADE's recordFieldCollectionInternal (resolved
    // at call time): specs mock that method on the facade instance after
    // construction, and the mock must win over this slice's own method.
    private readonly getRecordFieldCollectionInternal: () => (
      repId: number,
      tenantId: string,
      accountId: string,
      payload: RecordFieldCollectionInternalPayload,
    ) => Promise<{
      ok: boolean;
      receiptNo: string;
      amount: number;
      customerName: string;
      previousBalance: number;
      newBalance: number;
    }>,
  ) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Records a field debt collection from a customer in the street.
   */
  async recordFieldCollection(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordFieldCollectionPayload,
  ): Promise<{
    ok: boolean;
    receiptNo: string;
    amount: number;
    customerName: string;
    previousBalance: number;
    newBalance: number;
  }> {
    const amount = Number(payload.amount || 0);
    if (amount <= 0) throw new AppError('المبلغ المحصل يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT', 400);

    const txKey = payload.clientTxId ? `${tenantId}:${payload.tripId}:${payload.clientTxId}` : null;
    // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B3): the fingerprint must
    // include the payment channel — a cash collection then an
    // instapay collection of the same amount within 5s are two
    // different collections, not a retry. The channel resolves by the
    // same rule the posting uses (omitted method counts as cash), so
    // a true retry (same channel, same everything) still dedups.
    const fingerprintKey = `${tenantId}:${payload.tripId}:${repId}:${payload.customerId}:${amount}:${resolveFieldCollectionChannel(payload.paymentMethod)}`;

    // 1. In-flight Promise Deduplication: Await concurrent request and return its result
    if (txKey && this.inFlightCollectionPromises.has(txKey)) {
      return await this.inFlightCollectionPromises.get(txKey)!;
    }
    if (this.inFlightCollectionPromises.has(fingerprintKey)) {
      return await this.inFlightCollectionPromises.get(fingerprintKey)!;
    }

    // 2. Recent In-Memory Cache Deduplication (< 5 seconds for fingerprint, < 30s for txKey)
    const nowMs = Date.now();
    if (txKey && this.recentCollectionsCache.has(txKey)) {
      const entry = this.recentCollectionsCache.get(txKey)!;
      if (nowMs - entry.timestamp < 30000) return entry.result;
    }
    if (this.recentCollectionsCache.has(fingerprintKey)) {
      const entry = this.recentCollectionsCache.get(fingerprintKey)!;
      if (nowMs - entry.timestamp < 5000) return entry.result;
    }

    // Register collection promise IMMEDIATELY (synchronously) before any await
    const colPromise = (async () => {
      // INV-REP-FIELD-COLLECTION-MONEY-PRECISION (M10/B6): REJECT — never
      // silently round — a collection amount that does not fit the
      // tenant's money digits, mirroring the general customer-payment
      // path (createCustomerPayment, INVALID_PAYMENT_AMOUNT). Rounding
      // would silently alter the cash the driver actually holds and
      // the amount the customer actually paid, while only the journal
      // rounds (postVanFieldCollection via toBookMoney) — so the
      // payment row, customer balance, trip totals and ledger would
      // disagree with the journal by fractions of a minor unit on
      // every collection. This runs FIRST inside the closure — before
      // the dedup reads and before recordFieldCollectionInternal — so
      // a refused amount writes nothing: no payment row, no balance
      // change, no JE, no trip total. It stays inside the closure
      // (rather than above the promise registration) so concurrent
      // identical requests still register synchronously and dedup.
      const baseCurrency = await tenantBaseCurrency(this.anyDb, tenantId);
      const moneyDigits = currencyMoneyDigits(baseCurrency);
      const scale = 10 ** moneyDigits;
      if (Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
        throw new AppError(
          `Field collection amount must have at most ${moneyDigits} decimal places for the tenant currency (${baseCurrency})`,
          'INVALID_PAYMENT_AMOUNT',
          400,
        );
      }

      // 3. Database Idempotency Check via client_tx_id, falling back to
      // the legacy [tx:clientTxId] note tag for rows written before
      // migration 2040000000268 (whose backfill could not parse a tag).
      if (payload.clientTxId) {
        // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B8): the client_tx_id
        // lookup is scoped by van_trip_id as well — a customer key
        // reused on a different trip is a NEW collection for that
        // trip, not a replay of the first trip's payment. The legacy
        // note-tag fallback is scoped the same way: an unscoped tag
        // match would leave the same hole open through the fallback.
        const existingByColumn = await this.anyDb
          .selectFrom('customer_payments')
          .select(['id', 'amount', 'note'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', payload.customerId)
          .where('van_trip_id', '=', payload.tripId)
          .where('client_tx_id', '=', payload.clientTxId)
          .executeTakeFirst();
        const existingPayment =
          existingByColumn ??
          (await this.anyDb
            .selectFrom('customer_payments')
            .select(['id', 'amount', 'note'])
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', payload.customerId)
            .where('van_trip_id', '=', payload.tripId)
            .where('note', 'like', `%[tx:${payload.clientTxId}]%`)
            .executeTakeFirst());

        if (existingPayment) {
          // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B7): a dedup replay
          // returns the REAL balances, not 0/0. newBalance is the
          // customer's current balance (re-read here, after the
          // original collection posted); previousBalance is that
          // balance plus the stored payment amount — the balance just
          // before this collection, the same figure the receipt
          // screen derives as newBalance + amount. Exact when no
          // later collection intervened; always a real current
          // balance, never 0/0.
          const cust = await this.anyDb
            .selectFrom('customers')
            .select(['name', 'balance'])
            .where('id', '=', payload.customerId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          const currentBalance = Number(cust?.balance || 0);
          const paidAmount = Number(existingPayment.amount);
          return {
            ok: true,
            receiptNo: existingPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
            amount: paidAmount,
            customerName: cust?.name || 'العميل',
            previousBalance: currentBalance + paidAmount,
            newBalance: currentBalance,
          };
        }
      }

      // 4. Database Rapid-Fire Duplicate Check (within last 4 seconds for
      // the same trip, rep, customer, channel, and amount). The pre-0268
      // check matched customer + amount only, so a second legitimate
      // collection — another trip, another rep, another channel — inside
      // the window was swallowed and reported as the first collection.
      const twinScope = fieldCollectionPaymentScope({
        tripId: payload.tripId,
        repId,
        paymentMethod: payload.paymentMethod,
        clientTxId: payload.clientTxId,
      });
      const fourSecondsAgo = new Date(Date.now() - 4000);
      const recentDbPayment = await this.anyDb
        .selectFrom('customer_payments')
        .select(['id', 'amount', 'note'])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', payload.customerId)
        .where('van_trip_id', '=', twinScope.van_trip_id)
        .where('rep_id', '=', twinScope.rep_id)
        .where('payment_channel', '=', twinScope.payment_channel)
        .where('amount', '=', amount)
        .where('created_at', '>=', fourSecondsAgo)
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (recentDbPayment) {
        // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B7): same real-balance
        // replay as the clientTxId branch above — the stored twin's
        // amount plus the customer's current balance.
        const cust = await this.anyDb
          .selectFrom('customers')
          .select(['name', 'balance'])
          .where('id', '=', payload.customerId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const currentBalance = Number(cust?.balance || 0);
        const paidAmount = Number(recentDbPayment.amount);
        return {
          ok: true,
          receiptNo: recentDbPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
          amount: paidAmount,
          customerName: cust?.name || 'العميل',
          previousBalance: currentBalance + paidAmount,
          newBalance: currentBalance,
        };
      }

      // 5. Execute internal collection — through the facade method (see
      // ctor): a spec mock on the facade instance must intercept this call.
      return await this.getRecordFieldCollectionInternal()(repId, tenantId, accountId, payload);
    })();

    if (txKey) this.inFlightCollectionPromises.set(txKey, colPromise);
    this.inFlightCollectionPromises.set(fingerprintKey, colPromise);

    try {
      const result = await colPromise;
      const ts = Date.now();
      if (txKey) this.recentCollectionsCache.set(txKey, { result, timestamp: ts });
      this.recentCollectionsCache.set(fingerprintKey, { result, timestamp: ts });

      if (this.recentCollectionsCache.size > 200) {
        const threshold = ts - 60000;
        for (const [k, v] of this.recentCollectionsCache.entries()) {
          if (v.timestamp < threshold) this.recentCollectionsCache.delete(k);
        }
      }
      return result;
    } finally {
      if (txKey) this.inFlightCollectionPromises.delete(txKey);
      this.inFlightCollectionPromises.delete(fingerprintKey);
    }
  }

  async recordFieldCollectionInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordFieldCollectionInternalPayload,
  ) {
    return this.getCollectionsAndSwaps().recordFieldCollectionInternal(repId, tenantId, accountId, payload);
  }

  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: ExecuteDamagedSwapPayload,
  ): Promise<ExecuteDamagedSwapResult> {
    return this.getCollectionsAndSwaps().executeDamagedSwap(repId, tenantId, accountId, payload);
  }

  /**
   * Lists all damaged goods swaps performed on a trip.
   */
  async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    return this.getCollectionsAndSwaps().assertTripOwnedByRep(tenantId, tripId, repId);
  }

  async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    return this.getCollectionsAndSwaps().listRepServedCustomerIds(tenantId, repId);
  }

  async listCustomerServingRepIds(tenantId: string, customerId: number): Promise<Set<number>> {
    return this.getCollectionsAndSwaps().listCustomerServingRepIds(tenantId, customerId);
  }

  async assertRepRouteForSale(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.getCollectionsAndSwaps().assertRepRouteForSale(tenantId, repId, customerId);
  }

  async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.getCollectionsAndSwaps().assertRepServedCustomer(tenantId, repId, customerId);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    return this.getCollectionsAndSwaps().listTripDamagedSwaps(tenantId, tripId, repId);
  }
}
