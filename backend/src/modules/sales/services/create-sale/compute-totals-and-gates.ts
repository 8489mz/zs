import { AppError } from '../../../../common/errors/app-error';
import { computeInvoiceTotals } from '../../../../common/utils/invoice-totals';
import { getCashDiscountPercent, getVanRepDiscountCapPercent } from '../../../../common/utils/rep-settings.slice';
import { allocateInvoiceDiscount } from '../../engines/invoice-discount.engine';
import { resolveSaleServiceCharge } from '../../engines/sale-service-charge.engine';
import { resolveSaleTaxRate } from '../../engines/sale-tax-rate.engine';
import {
  calculateCollectibleTotal,
  findBelowFloorSaleItems,
  roundSaleInvoiceTotals,
  roundSaleResidual,
} from '../../helpers/sales-write.helper';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class ComputeTotalsAndGatesService {
  constructor(
    private readonly getTenantSettingsMap: CreateSaleDeps['getTenantSettingsMap'],
    private readonly assertDiscountChangeAllowed: CreateSaleDeps['assertDiscountChangeAllowed'],
    private readonly authz: CreateSaleDeps['authz'],
    private readonly returnsService: CreateSaleDeps['returnsService'],
  ) {}

  /**
   * Phase 3 — settings, loyalty, discounts, service charge, tax, totals,
   * the expected-total check, discount allocation, the cost-floor check,
   * the exchange settlement and the collectible total. Facade L1006-1154.
   */
  async computeTotalsAndGates(ctx: CreateSaleContext): Promise<void> {
    const {
      trx,
      scope,
      normalized,
      payload,
      auth,
      customer,
      subtotal,
      preparedItems,
      productMap,
      exchange,
      moneyDigits,
      effectiveTerms,
      approvedTerms,
    } = ctx;
    // Fetch loyalty and cashier settings from high-speed in-memory cache
    const settingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);

    // Tax F1: the invoice tax rate is the tenant's configured rate or
    // 0 (exempt) — never whatever the client sent. resolveSaleTaxRate
    // throws SALE_TAX_RATE_MISMATCH before any totals, stock, or
    // journal work; the resolved rate replaces the payload rate so
    // the stored tax_rate and the computed totals agree exactly.
    // The legacy `tax_rate` spelling falls back behind `taxRate`,
    // mirroring the held-draft bill formatter's defensive read.
    normalized.taxRate = resolveSaleTaxRate(
      normalized.taxRate,
      settingsMap.get('taxRate') ?? settingsMap.get('tax_rate'),
    );

    const loyaltyEnabledVal = settingsMap.get('loyaltyEnabled');
    const loyaltyEnabled = loyaltyEnabledVal === true || loyaltyEnabledVal === 'true';
    const pointsPer100Egp = Number(settingsMap.get('loyaltyPointsPer100Egp') ?? 10);
    const pointRedeemValue = Number(settingsMap.get('loyaltyPointRedeemValue') ?? 0.1);
    const minRedeemPoints = Number(settingsMap.get('loyaltyMinRedeemPoints') ?? 0);
    const maxDiscountPercentage = Number(settingsMap.get('loyaltyMaxDiscountPercentage') ?? 100);

    let effectiveDiscount = normalized.discount;
    let loyaltyDiscount = 0;
    let pointsAfterRedeem = Number(customer?.loyalty_points || 0);

    if (normalized.loyaltyPointsRedeemed > 0 && customer) {
      if (!loyaltyEnabled) {
        throw new AppError('برنامج نقاط الولاء معطل حالياً في إعدادات النظام', 'LOYALTY_PROGRAM_DISABLED', 400);
      }
      const availablePoints = Number(customer?.loyalty_points || 0);
      if (normalized.loyaltyPointsRedeemed > availablePoints + 0.001) {
        throw new AppError('رصيد نقاط الولاء غير كافٍ للاستبدال', 'INSUFFICIENT_LOYALTY_POINTS', 400);
      }
      if (minRedeemPoints > 0 && availablePoints < minRedeemPoints - 0.001) {
        throw new AppError(
          `الحد الأدنى لرصيد النقاط للاستبدال هو ${minRedeemPoints} نقطة`,
          'MIN_LOYALTY_POINTS_NOT_MET',
          400,
        );
      }
      const calculatedDiscount = roundSaleResidual(normalized.loyaltyPointsRedeemed * pointRedeemValue, moneyDigits);
      const maxAllowedDiscount = roundSaleResidual((subtotal * maxDiscountPercentage) / 100, moneyDigits);
      loyaltyDiscount = Math.min(calculatedDiscount, maxAllowedDiscount);
      effectiveDiscount = roundSaleResidual(effectiveDiscount + loyaltyDiscount, moneyDigits);
      pointsAfterRedeem = Math.max(0, Number((availablePoints - normalized.loyaltyPointsRedeemed).toFixed(2)));
    }

    // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: per-line discounts are
    // discounts granted at conversion too, so they count toward the
    // gated amount alongside the header discount (the POS sends
    // lineDiscount too since INV-POS-LINE-DISCOUNT, so a direct
    // sale's gated amount includes its line discounts).
    const lineDiscountTotal = roundSaleResidual(
      normalized.items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0),
      moneyDigits,
    );
    const unapprovedDiscount = Math.max(
      0,
      roundSaleResidual(
        roundSaleResidual(normalized.discount - Number(approvedTerms?.approvedDiscount || 0), moneyDigits) +
          lineDiscountTotal,
        moneyDigits,
      ),
    );
    await this.assertDiscountChangeAllowed(trx, auth, unapprovedDiscount, normalized.managerPin, subtotal);
    // F1a (INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING): the tenant rep
    // cap binds the COMBINED discount in POS too. The portal path
    // enforces it; POS never did, so a rep posted 8% (4% line + 4%
    // invoice, Z-261121-16629) and 50% (25% + 25%, Z-261121-16630)
    // with no supervisor PIN. The cap applies ONLY when the seller
    // is a delivery rep — the acting user linked to a
    // delivery_representatives row, by the same phone/username link
    // resolveRepLinkedUserId uses in reverse (rep.phone matches the
    // user's phone or username). Ordinary cashiers keep their tier
    // behaviour above, and the admin bypass stays exactly as it is
    // (INV-POS-ADMIN-DISCOUNT-AUTHORITY). The combined percent is
    // (line discounts + invoice discount) / gross subtotal — the
    // portal's combinedDiscountPercent definition. Note ctx subtotal
    // is NET of line discounts (buildPreparedSaleItem subtracts
    // them from each line total), so the gross base is subtotal +
    // lineDiscountTotal; using the net subtotal would read an exact
    // 5% as 5.13% and refuse a sale sitting on the cap. Rounded at
    // book digits before the comparison so an exact 5% never reads
    // as 5.000000000000001. Above the cap, only an approved supervisor
    // override (the same manager-PIN path the tier gate uses) lets
    // the sale through; anything else is refused with the named
    // 403 below. The zero-discount guard keeps discount-free sales
    // (the hot path) free of the two link lookups.
    const isAdminSellerForRepCap = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdminSellerForRepCap && !this.authz.hasPermission(auth, '*') && unapprovedDiscount > 0.0001) {
      // The rep link is the acting user's identifiers: the username
      // is in memory, the phone comes from the users row. Either
      // leg may match a delivery_representatives phone. Both reads
      // use selectAll + a JS filter on purpose: naming the phone
      // column in SQL would abort this open transaction (25P02) on
      // any harness whose users / delivery_representatives table
      // has no phone column, and a caught 42703 cannot un-abort it
      // (the portal hoists such reads before the transaction for
      // exactly this reason; here the transaction is already open,
      // so the read must never fail). select * returns whatever
      // columns exist, so a missing phone simply matches nothing.
      // In production both columns exist; rep rows per tenant are
      // few, so the tenant-wide read is cheap.
      const linkValues = [String(auth.username || '').trim()].filter((value) => value.length > 0);
      const actingUser = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', Number(auth.userId))
        .executeTakeFirst();
      for (const value of [actingUser?.phone, actingUser?.username]) {
        const trimmed = String(value || '').trim();
        if (trimmed.length > 0 && !linkValues.includes(trimmed)) linkValues.push(trimmed);
      }
      const repRows = await trx
        .selectFrom('delivery_representatives')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      const repLink = repRows.find((row) => linkValues.includes(String(row.phone || '').trim()));
      if (repLink) {
        const repCapPercent = await getVanRepDiscountCapPercent(trx, scope.tenantId);
        const grossSubtotal = roundSaleResidual(subtotal + lineDiscountTotal, moneyDigits);
        const combinedDiscountPercent = roundSaleResidual(
          grossSubtotal > 0 ? (unapprovedDiscount / grossSubtotal) * 100 : 0,
          moneyDigits,
        );
        if (combinedDiscountPercent > repCapPercent) {
          let supervisorOverrideApproved = false;
          try {
            await this.authz.authorizeDiscountOverride(String(normalized.managerPin || '').trim(), auth, trx);
            supervisorOverrideApproved = true;
          } catch {
            supervisorOverrideApproved = false;
          }
          if (!supervisorOverrideApproved) {
            throw new AppError(
              `الخصم الإجمالي على الفاتورة (${combinedDiscountPercent}%) يتجاوز سقف خصم المناديب (${repCapPercent}%) ويتطلب اعتماد المشرف برمز PIN`,
              'COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
              403,
            );
          }
        }
      }
    }
    if (effectiveDiscount > subtotal) throw new AppError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT', 400);
    // R4-A (INV-REST-SALE-MONEY-TRUTH): the dine-in service charge
    // is a tenant decision, not a client assertion — same shape as
    // the Tax F1 gate above. The engine returns null for a non-POS
    // source (the charge stays exactly as sent) and 0 for a
    // non-dine-in order or a disabled charge; otherwise it
    // recomputes (subtotal - effectiveDiscount) x percent at book
    // digits. This overwrite happens BEFORE computeInvoiceTotals,
    // so the stored sales.service_charge, the totals, the tender
    // allocation and postSale all consume the recomputed truth.
    const recomputedServiceCharge = resolveSaleServiceCharge({
      orderType: normalized.orderType,
      source: normalized.source,
      enabled:
        settingsMap.get('restaurantServiceChargeEnabled') ?? settingsMap.get('restaurant_service_charge_enabled'),
      percent: settingsMap.get('restaurantServiceChargePercent') ?? settingsMap.get('restaurant_service_charge_rate'),
      netBase: subtotal - effectiveDiscount,
      digits: moneyDigits,
    });
    if (recomputedServiceCharge !== null) normalized.serviceCharge = recomputedServiceCharge;
    // Pre-round the sale-side totals to book digits before allocation
    // (INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND): computeInvoiceTotals
    // always rounds to 3 decimals, but the allocation engine fails
    // closed on anything finer than book digits. The shared totals
    // util is untouched; postSale re-rounds these same book-digits
    // values, so the journal legs are unchanged.
    let { taxAmount, total } = roundSaleInvoiceTotals(
      computeInvoiceTotals(
        subtotal,
        effectiveDiscount,
        normalized.taxRate,
        normalized.pricesIncludeTax,
        normalized.deliveryFee,
        normalized.serviceCharge,
        Number(normalized.tipAmount || 0),
      ),
      moneyDigits,
    );
    // R5-A (INV-REST-TOTALS-TRUTH-2, R-I53): the POS sends the total
    // it displayed as expectedTotal. The server never trusts it —
    // it cross-checks it against the total it just recomputed, and a
    // drift bigger than one minor unit is a loud 422 naming both
    // totals, never a silently posted wrong invoice. This is what
    // catches the next frontend/backend formula drift (today: the
    // loyalty cap and the service-charge percent disagreed three
    // ways). Callers that never send expectedTotal (dashboard,
    // order conversions, offline sync) skip the check. Placed here,
    // after computeInvoiceTotals and before any stock, journal or
    // tender work, so a mismatch writes nothing.
    if (normalized.expectedTotal != null && Number(normalized.expectedTotal) > 0) {
      const expectedTotalDrift = Math.abs(total - Number(normalized.expectedTotal));
      if (expectedTotalDrift > Math.pow(10, -moneyDigits)) {
        throw new AppError(
          `إجمالي الفاتورة المعروض (${Number(normalized.expectedTotal)}) لا يطابق الإجمالي المحسوب (${total})`,
          'SALE_TOTAL_MISMATCH',
          422,
        );
      }
    }
    let { taxAmount: itemOnlyTaxAmount } = roundSaleInvoiceTotals(
      computeInvoiceTotals(subtotal, effectiveDiscount, normalized.taxRate, normalized.pricesIncludeTax, 0, 0, 0),
      moneyDigits,
    );
    const allocatedLines = allocateInvoiceDiscount({
      lines: preparedItems.map((item) => ({ lineTotal: item.lineTotal, qty: item.qty })),
      invoiceDiscount: effectiveDiscount,
      invoiceTax: itemOnlyTaxAmount,
      pricesIncludeTax: normalized.pricesIncludeTax,
      digits: moneyDigits,
    });
    const allocationByItem = new Map(preparedItems.map((item, index) => [item, allocatedLines[index]]));
    if (normalized.storeCreditUsed > total + 0.0001)
      throw new AppError('Store credit cannot exceed invoice total', 'INVALID_STORE_CREDIT', 400);

    // Distribute the invoice discount across lines before checking the real selling floor.
    // INV-SALE-EDIT-COST-FLOOR: the floor computation is the shared
    // findBelowFloorSaleItems helper, also called by updateSale.
    const belowFloorItems = findBelowFloorSaleItems(
      preparedItems.map((item) => {
        const product = productMap.get(item.productId);
        return {
          productId: item.productId,
          isService: item.isService,
          costPrice: item.costPrice,
          unitMultiplier: item.unitMultiplier,
          qty: item.qty,
          minSellingPrice: Number(product?.min_selling_price || 0),
          effectiveAllowedUnitPrice: item.effectiveAllowedUnitPrice,
          netLineTotal: allocationByItem.get(item)!.netLineTotal,
        };
      }),
    );
    // INV-POS-ADMIN-DISCOUNT-AUTHORITY: an admin selling below the
    // floor is not blocked (the admin is the approver); the lines are
    // still recorded in the sale note below. A cashier still needs the
    // manager approval.
    const isAdminSeller = auth.role === 'admin' || auth.role === 'super_admin';
    const floorApproval =
      belowFloorItems.length && !isAdminSeller
        ? await this.authz.authorizeDiscountOverride(normalized.managerPin, auth, trx)
        : null;

    // INV-VAN-PRICE-LIST-WIRING (F8): the SYSTEM cash discount in
    // POS — the portal path (execute-field-sale-internal) computes
    // it server-side from the tenant cashDiscountPercent setting
    // and POS never did, so an immediate-cash sale posted the full
    // price while the same sale in the field got the discount.
    // Immediate cash only: paymentType 'cash' with every declared
    // tender leg on the cash channel (no legs = the tender
    // engine's cash fallback) — card, wallet, instapay and mixed
    // tenders never see it, exactly like the portal's
    // card/instapay/split branches — and never a delivery: the POS
    // COD model treats any cash-paid delivery as cash out for
    // collection, not cash in hand at posting. Applied AFTER the
    // rep-cap check above (a rep at the 5% cap still posts with the
    // cash discount, no PIN — the portal's rule), after the
    // expected-total check (the frontend displays the pre-discount
    // total, so the check compares against that) and after the
    // line allocation + floor check (the portal never allocates
    // the system discount to lines). The base is the net
    // (subtotal − invoice discount), the portal's totalSale base,
    // and — like the portal — the amount joins effectiveDiscount
    // so the stored discount and the tax base both carry it, while
    // systemCashDiscountAmount is also stored distinctly on the
    // sale for the invoice to show it separately.
    let systemCashDiscountAmount = 0;
    const declaredLegs = normalized.payments || [];
    const fallbackChannel = ['card', 'wallet', 'instapay'].includes(normalized.paymentChannel)
      ? normalized.paymentChannel
      : 'cash';
    const isImmediateCashSale =
      normalized.paymentType === 'cash' &&
      String(normalized.orderType || '').trim() !== 'delivery' &&
      (declaredLegs.length === 0
        ? fallbackChannel === 'cash'
        : declaredLegs.every((entry) => entry.paymentChannel === 'cash'));
    if (isImmediateCashSale) {
      const cashDiscountPercent = await getCashDiscountPercent(trx, scope.tenantId);
      const cashDiscountBase = roundSaleResidual(subtotal - effectiveDiscount, moneyDigits);
      if (cashDiscountPercent > 0 && cashDiscountBase > 0) {
        const computed = roundSaleResidual(cashDiscountBase * (cashDiscountPercent / 100), moneyDigits);
        if (computed > 0 && computed < cashDiscountBase) {
          systemCashDiscountAmount = computed;
          effectiveDiscount = roundSaleResidual(effectiveDiscount + systemCashDiscountAmount, moneyDigits);
          const recomputed = roundSaleInvoiceTotals(
            computeInvoiceTotals(
              subtotal,
              effectiveDiscount,
              normalized.taxRate,
              normalized.pricesIncludeTax,
              normalized.deliveryFee,
              normalized.serviceCharge,
              Number(normalized.tipAmount || 0),
            ),
            moneyDigits,
          );
          taxAmount = recomputed.taxAmount;
          total = recomputed.total;
          itemOnlyTaxAmount = roundSaleInvoiceTotals(
            computeInvoiceTotals(subtotal, effectiveDiscount, normalized.taxRate, normalized.pricesIncludeTax, 0, 0, 0),
            moneyDigits,
          ).taxAmount;
        }
      }
    }

    if (exchange) {
      const settlement = await this.returnsService.settleExchangeReturn(
        trx,
        exchange,
        total,
        payload.exchangeRefundMethod || 'cash',
        auth,
        normalized.managerPin || payload.managerPin,
      );
      normalized.storeCreditUsed = settlement.appliedCredit;
      if (!customer) throw new AppError('عميل الاستبدال غير موجود', 'CUSTOMER_NOT_FOUND', 404);
      const refreshed = await trx
        .selectFrom('customers')
        .select('store_credit_balance')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', normalized.customerId!)
        .forUpdate()
        .executeTakeFirstOrThrow();
      customer.store_credit_balance = refreshed.store_credit_balance;
    }
    const collectibleTotal = calculateCollectibleTotal(total, normalized.storeCreditUsed, moneyDigits);
    ctx.settingsMap = settingsMap;
    ctx.loyaltyEnabled = loyaltyEnabled;
    ctx.pointsPer100Egp = pointsPer100Egp;
    ctx.pointRedeemValue = pointRedeemValue;
    ctx.minRedeemPoints = minRedeemPoints;
    ctx.maxDiscountPercentage = maxDiscountPercentage;
    ctx.effectiveDiscount = effectiveDiscount;
    ctx.loyaltyDiscount = loyaltyDiscount;
    ctx.pointsAfterRedeem = pointsAfterRedeem;
    ctx.taxAmount = taxAmount;
    ctx.total = total;
    ctx.itemOnlyTaxAmount = itemOnlyTaxAmount;
    ctx.allocatedLines = allocatedLines;
    ctx.allocationByItem = allocationByItem;
    ctx.belowFloorItems = belowFloorItems;
    ctx.isAdminSeller = isAdminSeller;
    ctx.floorApproval = floorApproval;
    ctx.collectibleTotal = collectibleTotal;
    ctx.systemCashDiscountAmount = systemCashDiscountAmount;
  }
}
