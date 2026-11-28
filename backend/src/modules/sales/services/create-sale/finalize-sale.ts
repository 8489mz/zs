import { sql } from '../../../../database/kysely';
import { roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { calculateStoreCreditBalance } from '../../helpers/sales-write.helper';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class FinalizeSaleService {
  constructor(
    private readonly finance: CreateSaleDeps['finance'],
    private readonly accountingPosting: CreateSaleDeps['accountingPosting'],
    private readonly idempotency: CreateSaleDeps['idempotency'],
    private readonly transferKdsTicketStateInTrx: CreateSaleDeps['transferKdsTicketStateInTrx'],
    private readonly refreshClosedShiftsForBackdatedOfflineSale: CreateSaleDeps['refreshClosedShiftsForBackdatedOfflineSale'],
  ) {}

  /**
   * Phase 6 — store credit, loyalty redeem/earn, customer debt, treasury /
   * courier, postSale, the idempotency commit, the online-order release
   * and the backdated-offline shift refresh. Facade L1869-2114.
   */
  async finalizeSale(ctx: CreateSaleContext): Promise<void> {
    const {
      trx,
      scope,
      normalized,
      auth,
      customer,
      moneyDigits,
      pointsAfterRedeem,
      loyaltyDiscount,
      loyaltyEnabled,
      pointsPer100Egp,
      paidAmount,
      remainingDebt,
      collectibleTotal,
      isCodDelivery,
      payments,
      isDelivery,
      resolvedDeliveryFeeMode,
      collectionStatus,
      effectivePaymentType,
      deliveryRepId,
      docNo,
      id,
      onlineOrderToRelease,
      offlineCreatedAt,
      idemCtx,
    } = ctx;
    if (normalized.storeCreditUsed > 0 && customer) {
      await trx
        .updateTable('customers')
        .set({
          store_credit_balance: calculateStoreCreditBalance(
            Number(customer.store_credit_balance || 0),
            -normalized.storeCreditUsed,
            moneyDigits,
          ),
          updated_at: sql`NOW()`,
        })
        .where('id', '=', customer.id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
    }

    if (normalized.loyaltyPointsRedeemed > 0 && customer) {
      await trx
        .updateTable('customers')
        .set({ loyalty_points: pointsAfterRedeem, updated_at: sql`NOW()` })
        .where('id', '=', customer.id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      await trx
        .insertInto('customer_loyalty_logs')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          customer_id: customer.id,
          points_change: -normalized.loyaltyPointsRedeemed,
          balance_after: pointsAfterRedeem,
          action_type: 'redeem',
          sale_id: id,
          notes: `استبدال ${normalized.loyaltyPointsRedeemed} نقطة بخصم ${loyaltyDiscount} ج.م في الفاتورة S-${id}`,
          created_at: sql`NOW()`,
        })
        .execute();
    }

    // Automatically award loyalty points based on paid amount
    if (customer && paidAmount > 0 && loyaltyEnabled && pointsPer100Egp > 0) {
      const pointsEarned = Math.floor((paidAmount / 100) * pointsPer100Egp);
      if (pointsEarned > 0) {
        const startingPoints =
          normalized.loyaltyPointsRedeemed > 0 ? pointsAfterRedeem : Number(customer?.loyalty_points || 0);
        const finalPoints = Number((startingPoints + pointsEarned).toFixed(2));

        await trx
          .updateTable('customers')
          .set({ loyalty_points: finalPoints, updated_at: sql`NOW()` })
          .where('id', '=', customer.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        await trx
          .insertInto('customer_loyalty_logs')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            customer_id: customer.id,
            points_change: pointsEarned,
            balance_after: finalPoints,
            action_type: 'earn',
            sale_id: id,
            notes: `اكتساب ${pointsEarned} نقطة من مشتريات الفاتورة S-${id} (بمعدل ${pointsPer100Egp} نقطة لكل 100 ج.م)`,
            created_at: sql`NOW()`,
          })
          .execute();
      }
    }

    if (customer && remainingDebt > 0) {
      await this.finance.createCustomerLedgerEntry(
        trx,
        customer.id,
        remainingDebt,
        `فاتورة بيع S-${id}${paidAmount > 0 ? ' (متبقي آجل)' : ''}`,
        id,
        auth,
      );
    } else if (customer && remainingDebt === 0) {
      // INV-CUSTOMER-SUPPLIER-STATEMENTS: a fully-settled sale used to
      // write no customer-ledger row at all, so the invoice (and a
      // later return of it) vanished from the customer statement even
      // though the final balance was right. Post the charge and its
      // settlement as a pair netting to zero, so the document stays
      // visible while the balance stays exactly unchanged. The pair
      // must not go through createCustomerLedgerEntry: its limit gate
      // would block a settled sale for a customer near the limit.
      // 'sale_paid' (not 'sale_credit') keeps the van split-sale and
      // trip-counter readers, which take the latest 'sale_credit'
      // row as the unpaid portion, from mistaking this charge for
      // a debt.
      const settled = roundMoney(collectibleTotal - remainingDebt, moneyDigits);
      if (settled > 0) {
        await this.finance.addCustomerLedgerLeg(
          trx,
          customer.id,
          settled,
          'sale_paid',
          `فاتورة بيع S-${id}`,
          'sale',
          id,
          auth,
        );
        await this.finance.addCustomerPaymentLedgerEntry(
          trx,
          customer.id,
          -settled,
          `سداد فاتورة بيع S-${id}`,
          'sale',
          id,
          auth,
          normalized.branchId,
          normalized.locationId,
        );
      }
    }

    if (!isCodDelivery) {
      for (const payment of payments) {
        if (payment.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(
          trx,
          payment.amount,
          `فاتورة بيع S-${id} - نقدي`,
          id,
          auth,
          normalized.branchId,
          normalized.locationId,
        );
      }

      // When a delivery order with a freelance courier is fully prepaid online (prepaid_online),
      // the courier takes their delivery fee in cash directly from the active cash drawer.
      // Auto-record a cash_out treasury transaction so the cashier's expected cash in drawer decreases accurately.
      if (isDelivery && resolvedDeliveryFeeMode === 'freelance_courier' && normalized.deliveryFee > 0) {
        // Only eligible when customer prepaid online in full (never for credit/COD)

        const isElectronicPaidInFull =
          payments.length > 0 &&
          payments.every((p) => p.paymentChannel === 'wallet' || p.paymentChannel === 'instapay') &&
          paidAmount + 0.0001 >= collectibleTotal;

        const isEligiblePrepaidOnlineDelivery =
          (collectionStatus === 'prepaid_online' || isElectronicPaidInFull) &&
          effectivePaymentType !== 'credit' &&
          collectionStatus !== 'cod' &&
          paidAmount + 0.0001 >= collectibleTotal;
        if (collectionStatus !== 'prepaid_by_rep' && isEligiblePrepaidOnlineDelivery) {
          const openShift = await trx
            .selectFrom('cashier_shifts')
            .select(['id', 'branch_id', 'location_id'])
            .where('opened_by', '=', auth.userId)
            .where('status', '=', 'open')
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .orderBy('id', 'desc')
            .executeTakeFirst();

          if (openShift) {
            const repRow = deliveryRepId
              ? await trx
                  .selectFrom('delivery_representatives')
                  .select(['name'])
                  .where('id', '=', Number(deliveryRepId))
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .executeTakeFirst()
              : null;
            const repLabel = repRow?.name ? repRow.name : `مندوب #${deliveryRepId || ''}`;

            await trx
              .insertInto('treasury_transactions')
              .values({
                txn_type: 'cash_out',
                amount: -Math.abs(normalized.deliveryFee),
                note: `صرف أجرة توصيل نقداً للمندوب ${repLabel} عن فاتورة #${docNo || id}`,
                reference_type: 'cashier_shift',
                reference_id: openShift.id,
                branch_id: normalized.branchId || openShift.branch_id,
                location_id: normalized.locationId || openShift.location_id,
                created_by: auth.userId,
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              })
              .execute();

            // R8-A (M12): no stored expected_cash update here — the
            // live recompute (computeShiftCashDrawerMovements) already
            // nets this treasury leg for open shifts, and the close
            // path recomputes and overwrites; writing it here
            // subtracted the fee twice, and hr.service reads the
            // stored value as a fallback. The treasury leg above is
            // the record of the payout.
          }
        }
      }
    }

    // A journal failure must roll back stock, tenders and the invoice together.
    await this.accountingPosting.postSale(trx, id, auth);
    await this.accountingPosting.clearPostingFailure(trx, scope, 'sale', id);

    // Commit idempotency record atomically inside the business transaction
    if (idemCtx?.idempotencyKey && idemCtx?.operationType) {
      await this.idempotency.commitOperation(
        trx,
        {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          idempotencyKey: idemCtx.idempotencyKey,
          operationType: idemCtx.operationType,
        },
        { ok: true, saleId: id },
        String(id),
      );
    }

    if (onlineOrderToRelease) {
      await trx
        .updateTable('online_orders')
        .set({
          sale_id: id,
          stock_reserved: false,
          status: normalized.orderType === 'delivery' ? 'shipped' : 'delivered',
          updated_at: new Date(),
        })
        .where('id', '=', onlineOrderToRelease.id)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      if (onlineOrderToRelease.kitchen_draft_sale_id) {
        const draftSaleId = Number(onlineOrderToRelease.kitchen_draft_sale_id);
        if (draftSaleId && draftSaleId !== id) {
          // R4-E I17: move the kitchen ticket's progress BEFORE the draft
          // rows are deleted — the pointer is nulled below, so any later
          // transfer (retireKitchenDraft) would find nothing to move.
          // Trx-aware on purpose: the public transfer opens its own
          // transaction, which would nest inside this one.
          await this.transferKdsTicketStateInTrx(trx, scope.tenantId, draftSaleId, id);
          await trx
            .deleteFrom('sale_items')
            .where('sale_id', '=', draftSaleId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          await trx
            .deleteFrom('sales')
            .where('id', '=', draftSaleId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .where('status', '=', 'draft')
            .execute();
          await trx
            .updateTable('online_orders')
            .set({ kitchen_draft_sale_id: null, updated_at: new Date() })
            .where('id', '=', onlineOrderToRelease.id)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
        }
      }
    }

    // INV-REST-SHIFT-CLOSE-CONTROL (I26): a sale posted into a
    // shift that closed while this transaction ran may need that
    // shift's stored figures corrected now, inside this
    // transaction, so the close record reflects the sale. Under
    // server-time dating (INV-OFFLINE-SYNC-SERVER-TIMESTAMP) the
    // timestamp matched here is the server sync instant, so a
    // closed shift can only contain it if it closed mid-sync —
    // a backdated offline sale no longer exists. A no-op when no
    // closed shift contains the timestamp.
    if (offlineCreatedAt) {
      await this.refreshClosedShiftsForBackdatedOfflineSale(
        trx,
        ctx.serverSyncAt,
        id,
        normalized.branchId,
        normalized.locationId,
        auth,
        scope.tenantId,
      );
    }
  }
}
