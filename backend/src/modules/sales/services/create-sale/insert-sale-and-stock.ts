import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { applyStockDelta } from '../../../../common/utils/location-stock-ledger';
import { roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { allocateSaleFromImportLots } from '../../../import-sales/helpers/import-lot-allocation.helper';
import { offlineSaleTimestamps } from '../../../cash-drawer/helpers/cash-drawer.helper';
import { computeSaleAllocationLegs, resolvePostedSalePaymentChannel } from '../../helpers/sales-write.helper';
import { tripSaleContribution } from '../../../delivery-reps/van-trip-counters.engine';
import { applyTripCounterDelta, lockOpenTripRow } from '../sales-edit-and-cancel/sales-edit-and-cancel-types';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class InsertSaleAndStockService {
  constructor(
    private readonly generateSaleDocNo: CreateSaleDeps['generateSaleDocNo'],
    private readonly lockSaleStockRows: CreateSaleDeps['lockSaleStockRows'],
    private readonly autoProduceShortfall: CreateSaleDeps['autoProduceShortfall'],
    private readonly resolveSaleModifierCosts: CreateSaleDeps['resolveSaleModifierCosts'],
    private readonly planFeatureService: CreateSaleDeps['planFeatureService'],
    private readonly loadFlatAddonCosts: CreateSaleDeps['loadFlatAddonCosts'],
    private readonly claimSaleSerials: CreateSaleDeps['claimSaleSerials'],
    private readonly lockProductRow: CreateSaleDeps['lockProductRow'],
    private readonly buildInsufficientStockError: CreateSaleDeps['buildInsufficientStockError'],
    private readonly deductPharmacyBatchesFefo: CreateSaleDeps['deductPharmacyBatchesFefo'],
    private readonly deductInventoryBatchesFefo: CreateSaleDeps['deductInventoryBatchesFefo'],
    private readonly recordImportLotShortfalls: CreateSaleDeps['recordImportLotShortfalls'],
  ) {}

  /**
   * Phase 5 — insert the sale, its payments and terminal audit, lock stock
   * rows, auto-produce shortfalls, resolve modifier/flat-addon costs and
   * deduct stock. Facade L1414-1867.
   */
  async insertSaleAndStock(ctx: CreateSaleContext): Promise<void> {
    const {
      trx,
      scope,
      normalized,
      payload,
      auth,
      floorApproval,
      belowFloorItems,
      payments,
      paidAmount,
      total,
      moneyDigits,
      effectiveDiscount,
      systemCashDiscountAmount,
      taxAmount,
      allocationByItem,
      preparedItems,
      autoProduceItems,
      eligibleLocations,
      allowNegativeStockSales,
      customer,
      exchange,
      effectiveTerms,
      offlineDocNo,
      effectivePaymentType,
      subtotal,
      resolvedDeliveryFeeMode,
      finalTenderedAmount,
      changeAmount,
      deliveryRepId,
      deliveryStatus,
      collectionStatus,
      posTerminalCode,
      offlineCreatedAt,
      vanTripAttribution,
    } = ctx;
    let saleNote = normalized.note;
    if (offlineDocNo && !saleNote.includes(offlineDocNo)) {
      const offlineTag = `[إيصال أوفلاين: ${offlineDocNo}]`;
      saleNote = saleNote ? `${saleNote} | ${offlineTag}` : offlineTag;
    }
    if (floorApproval) {
      saleNote = `${saleNote ? `${saleNote} | ` : ''}[اعتماد بيع تحت الحد: ${floorApproval.authorizedByName}; أصناف ${belowFloorItems.join(',')}]`;
    } else if (belowFloorItems.length) {
      saleNote = `${saleNote ? `${saleNote} | ` : ''}[بيع تحت الحد: أصناف ${belowFloorItems.join(',')}]`;
    }
    if (normalized.terminalAuthCode) {
      const terminalTag = `[تفويض شبكة: ${normalized.cardScheme || 'بطاقة'} | ${normalized.terminalAuthCode}${normalized.terminalRrn ? ` | مرجع: ${normalized.terminalRrn}` : ''}]`;
      saleNote = saleNote ? `${saleNote} | ${terminalTag}` : terminalTag;
    }

    // F7 (POS-to-trip attribution): the pre-transaction candidate
    // is re-checked inside this transaction — the trip row is
    // locked and only a still-OPEN trip accepts the stamp and its
    // counters (a trip settled between resolution and insert
    // receives neither; the sale still posts). A delivery already
    // stamped its rep in Phase 4; a counter sale gains both the
    // trip and the rep. Anything else posts exactly as before,
    // with both columns NULL.
    let vanTripId: number | null = null;
    let attributedRepId: number | null = deliveryRepId;
    const tripCandidate = vanTripAttribution;
    if (tripCandidate) {
      const tripOpen = await lockOpenTripRow(trx, scope.tenantId, tripCandidate.tripId);
      if (tripOpen) {
        vanTripId = tripCandidate.tripId;
        if (!attributedRepId) attributedRepId = tripCandidate.repId;
      }
    }

    const saleInsert = await trx
      .insertInto('sales')
      .values({
        customer_id: normalized.customerId,
        customer_name: customer?.name || 'عميل نقدي',
        customer_phone: payload.customerPhone || null,
        customer_address: payload.customerAddress || null,
        payment_type: effectivePaymentType,
        payment_channel: resolvePostedSalePaymentChannel(effectivePaymentType, payments),
        subtotal: roundMoney(subtotal, moneyDigits),
        discount: effectiveDiscount,
        // INV-VAN-PRICE-LIST-WIRING (F8): the system cash discount
        // for this sale, stored distinctly from the line/invoice
        // discounts (the portal's column, same meaning).
        system_cash_discount_amount: systemCashDiscountAmount,
        delivery_fee: normalized.deliveryFee,
        delivery_fee_mode: resolvedDeliveryFeeMode,
        tax_rate: normalized.taxRate,
        tax_amount: taxAmount,
        prices_include_tax: normalized.pricesIncludeTax,
        total,
        paid_amount: paidAmount,
        applied_amount: paidAmount,
        tendered_amount: finalTenderedAmount,
        change_amount: changeAmount,
        store_credit_used: normalized.storeCreditUsed,
        exchange_return_id: exchange?.returnId ?? null,
        status: 'posted',
        note: saleNote,
        branch_id: normalized.branchId,
        location_id: normalized.locationId,
        table_number: String(normalized.tableNumber || '').trim(),
        order_type: String(normalized.orderType || 'takeaway').trim(),
        dining_course: normalized.diningCourse || null,
        service_charge: normalized.serviceCharge || 0,
        tip_amount: Number((normalized as any).tipAmount || 0),
        guest_count: normalized.guestCount || 1,
        delivery_rep_id: attributedRepId,
        van_trip_id: vanTripId,
        delivery_status: deliveryStatus,
        collection_status: collectionStatus,
        created_by: auth.userId,
        cancel_reason: '',
        terminal_id: normalized.terminalId || null,
        terminal_auth_code: normalized.terminalAuthCode || null,
        terminal_rrn: normalized.terminalRrn || null,
        card_scheme: normalized.cardScheme || null,
        card_last_four: normalized.cardLastFour || null,
        pager_number: normalized.pagerNumber || null,
        // INV-REST-SHIFT-CLOSE-CONTROL (I24/I26) + clock P2: station
        // code for shift attribution, and the offline sale's original
        // timestamp (only when the client sent a valid one — otherwise
        // the column default NOW() applies) + received_at for audit.
        pos_terminal_code: posTerminalCode,
        ...offlineSaleTimestamps(offlineCreatedAt),
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();

    const id = Number(saleInsert.id);
    if (exchange) {
      const linkedReturn = await trx
        .updateTable('return_documents')
        .set({ exchange_sale_id: id })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', exchange.returnId)
        .where('exchange_sale_id', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!linkedReturn) throw new AppError('تعذر ربط طرفَي الاستبدال', 'EXCHANGE_LINK_FAILED', 409);
    }
    const docNo = await this.generateSaleDocNo(trx, id, scope.tenantId, offlineCreatedAt ?? undefined);
    await trx
      .updateTable('sales')
      .set({ doc_no: docNo, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    // F7: the trip counters move by the same contribution the
    // field flow applies at creation (tripSaleContribution mirrors
    // its five payment branches exactly), so the trip reads the
    // sale the moment it posts — and the edit/cancel paths, which
    // already reverse a sale's contribution from its stored
    // van_trip_id, stay exactly balanced. A zero contribution
    // applies nothing (applyTripCounterDelta early-returns).
    if (vanTripId) {
      const contribution = tripSaleContribution({
        total,
        paidAmount,
        paymentChannel: resolvePostedSalePaymentChannel(effectivePaymentType, payments),
        payments: payments.map((payment) => ({ amount: payment.amount, payment_channel: payment.paymentChannel })),
      });
      await applyTripCounterDelta(trx, scope.tenantId, vanTripId, contribution);
    }

    if (payments.length > 0) {
      await trx
        .insertInto('sale_payments')
        .values(
          payments.map((payment) => ({
            sale_id: id,
            payment_channel: payment.paymentChannel,
            amount: payment.amount,
            applied_amount: payment.amount,
            tendered_amount: payment.tenderedAmount,
            change_amount: payment.changeAmount,
            terminal_id: payment.paymentChannel === 'card' ? normalized.terminalId || null : null,
            card_auth_code: payment.paymentChannel === 'card' ? normalized.terminalAuthCode || null : null,
            card_rrn: payment.paymentChannel === 'card' ? normalized.terminalRrn || null : null,
            card_scheme: payment.paymentChannel === 'card' ? normalized.cardScheme || null : null,
            card_last_four: payment.paymentChannel === 'card' ? normalized.cardLastFour || null : null,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })),
        )
        .execute();
    }

    if (normalized.terminalAuthCode) {
      await trx
        .insertInto('pos_audit_events')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          event_type: 'terminal_payment_approved',
          user_id: auth.userId,
          sale_id: id,
          product_id: null,
          amount: payments.find((p) => p.paymentChannel === 'card')?.amount || total,
          reason: `تفويض دفع إلكتروني ناجح من جهاز ${normalized.terminalId || 'EDC'} (${normalized.cardScheme || 'بطاقة'})`,
          metadata: JSON.stringify({
            terminalId: normalized.terminalId,
            authCode: normalized.terminalAuthCode,
            rrn: normalized.terminalRrn,
            cardScheme: normalized.cardScheme,
            cardLastFour: normalized.cardLastFour,
          }),
        })
        .execute();
    }

    await this.lockSaleStockRows(trx, scope, preparedItems);
    await this.autoProduceShortfall(trx, autoProduceItems, id, normalized.branchId, normalized.locationId, scope, auth);
    await this.resolveSaleModifierCosts(
      trx,
      preparedItems,
      scope.tenantId,
      this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
      // SF-3 D-SF-03: an online order costs its frozen modifiers the
      // same way it prices them; a walk-in sale passes none.
      effectiveTerms?.approvedModifierPrices,
    );

    // Deadlock prevention: stock rows (products + product_location_stock) must always be
    // locked in a deterministic global order. Client-supplied item order is arbitrary, so two
    // concurrent sales carrying the same products in opposite order would deadlock (SQLSTATE 40P01).
    // Sorting by productId enforces one canonical lock order across all concurrent transactions.
    // R8-A INV-REST-FLAT-ADDON-COSTING: flat addons carry no stock —
    // the deduction loop below must skip them entirely (no lock, no
    // movement, no allocation). Cost without stock.
    const flatAddonCosts = await this.loadFlatAddonCosts(trx, scope.tenantId, preparedItems);
    const stockOrderedItems = [...preparedItems].sort((a, b) => Number(a.productId || 0) - Number(b.productId || 0));

    for (const item of stockOrderedItems) {
      const itemSerials = Array.isArray(item.serials) ? item.serials : [];
      const insertedLine = await trx
        .insertInto('sale_items')
        .values({
          sale_id: id,
          product_id: item.productId,
          product_name: item.productName,
          product_name_en: item.productNameEn || null,
          qty: item.qty,
          unit_price: item.unitPrice,
          line_total: item.lineTotal,
          line_discount: Number(item.lineDiscount || 0),
          net_unit_price: allocationByItem.get(item)!.netUnitPrice,
          net_line_total: allocationByItem.get(item)!.netLineTotal,
          allocated_discount: allocationByItem.get(item)!.allocatedDiscount,
          allocated_tax: allocationByItem.get(item)!.allocatedTax,
          unit_name: item.unitName,
          unit_multiplier: item.unitMultiplier,
          cost_price: item.costPrice,
          price_type: item.priceType as 'retail' | 'wholesale' | 'half_wholesale' | 'credit',
          notes: item.notes,
          modifiers:
            item.originalPrice || item.offerDiscount || item.offerName
              ? JSON.stringify({
                  mods: Array.isArray(item.modifiers) ? item.modifiers : [],
                  offer: {
                    originalPrice: item.originalPrice,
                    offerDiscount: item.offerDiscount,
                    offerName: item.offerName,
                  },
                })
              : item.modifiers
                ? JSON.stringify(item.modifiers)
                : '[]',
          serials: itemSerials.length > 0 ? JSON.stringify(itemSerials) : '[]',
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      const saleLineId = Number(insertedLine.id);

      const claimedSerials = await this.claimSaleSerials(trx, item, id, saleLineId, scope.tenantId);
      if (claimedSerials.length > 0)
        await trx
          .updateTable('sale_items')
          .set({ serials: JSON.stringify(claimedSerials) })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', saleLineId)
          .execute();

      if (item.isService) {
        continue;
      }

      let remainingQty = item.requiredQty;
      let allocationOrder = 1;
      const allocations = [];

      // Lock-order normalization: applyStockDelta (and therefore purchases, transfers and
      // production) always locks products BEFORE product_location_stock. Taking the location rows
      // first here would invert that order and deadlock against those flows (ABBA). Acquiring the
      // product row up front makes the global order products -> product_location_stock everywhere.
      await this.lockProductRow(trx, item.productId, scope);

      // INV-FLOATING-POOL-ALLOCATION-LEG: assigned locations first,
      // then the unassigned pool as the final leg (see
      // computeSaleAllocationLegs in sales-write.helper.ts). The pool
      // row is read only when the assigned legs leave a shortfall,
      // and never when an eligible leg already targets a null
      // location (that read already targets a null-location row).
      const locationAvailabilities: Array<{
        locationId: number | null;
        branchId: number | null;
        availableQty: number;
      }> = [];
      for (const loc of eligibleLocations) {
        const locStock = await trx
          .selectFrom('product_location_stock')
          .select(['qty', 'reserved_qty'])
          .where('product_id', '=', item.productId)
          .where('location_id', '=', loc.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .forUpdate()
          .executeTakeFirst();

        locationAvailabilities.push({
          locationId: loc.id,
          branchId: loc.branchId,
          availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
        });
      }
      let allocationLegs = computeSaleAllocationLegs({
        requiredQty: remainingQty,
        locationAvailabilities,
        poolAvailableQty: 0,
        saleLocationId: normalized.locationId,
        saleBranchId: normalized.branchId,
      });
      if (allocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
        const poolRow = await trx
          .selectFrom('product_location_stock')
          .select(['qty', 'reserved_qty'])
          .where('product_id', '=', item.productId)
          .where('location_id', 'is', null)
          .where('branch_id', 'is', null)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .forUpdate()
          .executeTakeFirst();
        allocationLegs = computeSaleAllocationLegs({
          requiredQty: remainingQty,
          locationAvailabilities,
          poolAvailableQty: Math.max(0, Number(poolRow?.qty || 0) - Number(poolRow?.reserved_qty || 0)),
          saleLocationId: normalized.locationId,
          saleBranchId: normalized.branchId,
        });
      }
      for (const leg of allocationLegs.legs) {
        allocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
      }
      remainingQty = allocationLegs.remainingQty;

      if (remainingQty > 0) {
        if (!allowNegativeStockSales) {
          throw await this.buildInsufficientStockError(trx, {
            productId: item.productId,
            productName: item.productName,
            currentLocationId: eligibleLocations.length === 1 ? eligibleLocations[0].id : null,
            currentLocationName: eligibleLocations.length > 1 ? 'المخازن المتاحة للفرع' : undefined,
            excludedLocationIds: eligibleLocations.map((l) => l.id).filter((id): id is number => id != null),
            currentAvailableQty: allocationLegs.pooledAvailableQty,
            requiredQty: item.qty,
            tenantId: scope.tenantId,
          });
        }
        allocations.push({ locationId: normalized.locationId, branchId: normalized.branchId, qty: remainingQty });
        remainingQty = 0;
      }

      for (const alloc of allocations) {
        const stockChange = await applyStockDelta(trx, {
          productId: item.productId,
          delta: -alloc.qty,
          branchId: alloc.branchId,
          locationId: alloc.locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: `Insufficient stock for ${item.productName}`,
          allowNegative: allowNegativeStockSales,
        });

        await trx
          .insertInto('stock_movements')
          .values({
            product_id: item.productId,
            movement_type: 'sale',
            qty: -alloc.qty,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            unit_cost: item.costPrice, // INV-SALE-MOVEMENT-UNIT-COST: frozen line cost, same value as sale_items.cost_price
            reason: 'sale',
            note: `Sale S-${id}`,
            reference_type: 'sale',
            reference_id: id,
            branch_id: alloc.branchId,
            location_id: alloc.locationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          } as any)
          .execute();

        await trx
          .insertInto('sale_line_stock_allocations')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            sale_id: id,
            sale_line_id: saleLineId,
            product_id: item.productId,
            location_id: alloc.locationId as number,
            quantity: alloc.qty,
            allocation_order: allocationOrder++,
          })
          .execute();
      }

      await this.deductPharmacyBatchesFefo(trx, item.productId, allocations, scope, id, saleLineId);
      // INV-VAN-GENERIC-FEFO: the generic ledger deducts the same
      // allocations when the pharmacy ledger does not own the product.
      await this.deductInventoryBatchesFefo(trx, item.productId, allocations, scope, id, saleLineId);
      for (const alloc of allocations) {
        const lotAllocation = await allocateSaleFromImportLots(trx, {
          tenantId: scope.tenantId,
          saleId: id,
          locationId: alloc.locationId ?? normalized.locationId,
          items: [
            {
              itemId: saleLineId,
              productId: item.productId,
              qty: alloc.qty,
              netUnitPrice: allocationByItem.get(item)!.netUnitPrice,
              locationId: alloc.locationId ?? normalized.locationId,
            },
          ],
        });
        // INV-IMPORT-LOT-SHORTFALL-RECORD: never discard the coverage.
        await this.recordImportLotShortfalls(trx, scope, id, saleLineId, lotAllocation, auth);
      }

      if (
        item.modifiers &&
        Array.isArray(item.modifiers) &&
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')
      ) {
        for (const mod of item.modifiers) {
          const rawModProductId = Number(mod.productId || 0);
          const consumptionRate = Number(mod.consumptionQty || 1);

          // R8-A: a flat addon (no optionId, productId is an addons
          // row) has no stock to deduct — skip the whole loop body.
          const isFlatAddon =
            rawModProductId > 0 &&
            !Number(mod.optionId || mod.option_id || mod.id || 0) &&
            flatAddonCosts.has(rawModProductId);
          if (rawModProductId > 0 && !isFlatAddon) {
            const modifierQty = Number((Number(mod.qty || 1) * Number(item.qty || 1) * consumptionRate).toFixed(3));

            let modRemainingQty = modifierQty;
            let modAllocationOrder = 1;
            const modAllocations = [];

            // Same canonical lock order as the parent item (products -> product_location_stock).
            await this.lockProductRow(trx, rawModProductId, scope);

            // INV-FLOATING-POOL-ALLOCATION-LEG: same assigned-first,
            // pool-last leg computation as the parent item (see
            // computeSaleAllocationLegs in sales-write.helper.ts).
            const modLocationAvailabilities: Array<{
              locationId: number | null;
              branchId: number | null;
              availableQty: number;
            }> = [];
            for (const loc of eligibleLocations) {
              const locStock = await trx
                .selectFrom('product_location_stock')
                .select(['qty', 'reserved_qty'])
                .where('product_id', '=', rawModProductId)
                .where('location_id', '=', loc.id)
                .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                .forUpdate()
                .executeTakeFirst();

              modLocationAvailabilities.push({
                locationId: loc.id,
                branchId: loc.branchId,
                availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
              });
            }
            let modAllocationLegs = computeSaleAllocationLegs({
              requiredQty: modRemainingQty,
              locationAvailabilities: modLocationAvailabilities,
              poolAvailableQty: 0,
              saleLocationId: normalized.locationId,
              saleBranchId: normalized.branchId,
            });
            if (modAllocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
              const modPoolRow = await trx
                .selectFrom('product_location_stock')
                .select(['qty', 'reserved_qty'])
                .where('product_id', '=', rawModProductId)
                .where('location_id', 'is', null)
                .where('branch_id', 'is', null)
                .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                .forUpdate()
                .executeTakeFirst();
              modAllocationLegs = computeSaleAllocationLegs({
                requiredQty: modRemainingQty,
                locationAvailabilities: modLocationAvailabilities,
                poolAvailableQty: Math.max(0, Number(modPoolRow?.qty || 0) - Number(modPoolRow?.reserved_qty || 0)),
                saleLocationId: normalized.locationId,
                saleBranchId: normalized.branchId,
              });
            }
            for (const leg of modAllocationLegs.legs) {
              modAllocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
            }
            modRemainingQty = modAllocationLegs.remainingQty;

            if (modRemainingQty > 0) {
              if (!allowNegativeStockSales) {
                throw new AppError(`Insufficient stock for modifier ${mod.name}`, 'INSUFFICIENT_MODIFIER_STOCK', 400);
              }
              modAllocations.push({
                locationId: normalized.locationId,
                branchId: normalized.branchId,
                qty: modRemainingQty,
              });
              modRemainingQty = 0;
            }

            for (const alloc of modAllocations) {
              const modStockChange = await applyStockDelta(trx, {
                productId: rawModProductId,
                delta: -alloc.qty,
                branchId: alloc.branchId,
                locationId: alloc.locationId,
                tenantId: scope.tenantId,
                accountId: scope.accountId,
                errorCode: 'INSUFFICIENT_MODIFIER_STOCK',
                errorMessage: `Insufficient stock for modifier ${mod.name}`,
                allowNegative: allowNegativeStockSales,
              });

              await trx
                .insertInto('stock_movements')
                .values({
                  product_id: rawModProductId,
                  movement_type: 'sale',
                  qty: -alloc.qty,
                  before_qty: modStockChange.scopeBefore,
                  after_qty: modStockChange.scopeAfter,
                  // INV-SALE-MOVEMENT-UNIT-COST: per-stock-unit WAC = frozen per-serving cost / consumption rate (qty counts stock units).
                  unit_cost: Number((Number(mod.costPrice || 0) / Number(mod.consumptionQty || 1)).toFixed(6)),
                  reason: 'sale_modifier',
                  note: `Sale S-${id} (${item.productName})`,
                  reference_type: 'sale',
                  reference_id: id,
                  branch_id: alloc.branchId,
                  location_id: alloc.locationId,
                  created_by: auth.userId,
                  tenant_id: scope.tenantId,
                  account_id: scope.accountId,
                } as any)
                .execute();

              await trx
                .insertInto('sale_line_stock_allocations')
                .values({
                  tenant_id: scope.tenantId,
                  account_id: scope.accountId,
                  sale_id: id,
                  sale_line_id: saleLineId,
                  product_id: rawModProductId,
                  location_id: alloc.locationId as number,
                  quantity: alloc.qty,
                  allocation_order: modAllocationOrder++,
                })
                .execute();
            }
          }
        }
      }
    }
    ctx.id = id;
    ctx.docNo = docNo;
  }
}
