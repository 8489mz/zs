import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AuditService, AUDIT_EVENT_CODES } from '../../../../core/audit/audit.service';
import { AppError } from '../../../../common/errors/app-error';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { resolveVanMoneyAuditActor } from '../van-common.util';
import { getTenantTimezone, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import { computeVanLoadAvailableQty, getLocationAvailability } from '../../../../common/utils/location-stock-ledger';
import { parseRequisitionItems, pendingHoldQtyFor } from '../van-load-availability.helper';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import { type VanTripLifecycleDeps } from './van-trip-types';

/**
 * INV-VAN-LOAD-AVAILABLE-QTY (F10): the pending load permits that will
 * draw a product from a warehouse. Read only on the refusal path, so
 * the happy path pays no extra query. A pending permit reserves
 * NOTHING in the ledger — it is named so the rep/admin sees which
 * permit is waiting on the same stock, not as a claim that it holds
 * the reservation.
 */
async function findPendingLoadHolds(
  trxAny: any,
  tenantId: string,
  productId: number,
  warehouseId: number,
): Promise<Array<{ docNo: string; qty: number }>> {
  const rows = await trxAny
    .selectFrom('van_load_requisitions')
    .select(['doc_no', 'requested_items', 'approved_items'])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'pending')
    .where('source_warehouse_id', '=', warehouseId)
    .orderBy('id', 'asc')
    .execute();
  const holds: Array<{ docNo: string; qty: number }> = [];
  for (const row of rows || []) {
    const requested = parseRequisitionItems(row.requested_items);
    const items = requested.length > 0 ? requested : parseRequisitionItems(row.approved_items);
    const qty = pendingHoldQtyFor(items, productId, warehouseId);
    if (qty > 0) holds.push({ docNo: String(row.doc_no), qty });
  }
  return holds;
}

@Injectable()
export class TripOpenLoadService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly getOrCreateVanLocation: VanTripLifecycleDeps['getOrCreateVanLocation'],
    private readonly sortItemsByProductId: VanTripLifecycleDeps['sortItemsByProductId'],
    private readonly moveVanStock: VanTripLifecycleDeps['moveVanStock'],
    private readonly moveVanPharmacyBatches: VanTripLifecycleDeps['moveVanPharmacyBatches'],
    private readonly moveVanInventoryBatches: VanTripLifecycleDeps['moveVanInventoryBatches'],
    private readonly resolveSystemAuthContext: VanTripLifecycleDeps['resolveSystemAuthContext'],
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Opens a new morning trip and loads merchandise from the main warehouse into the car stock.
   */
  async openTripAndLoad(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      sourceWarehouseId?: number;
      startOdometer?: number;
      items?: { productId: number; qty: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id'])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (existingTrip) {
      throw new AppError(
        'توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة',
        'TRIP_ALREADY_OPEN',
        400,
      );
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    // Lookup rep's assigned vehicle for starting odometer & plate
    const assignedVehicle = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select(['id', 'current_odometer'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) => eb.or([eb('assigned_rep_id', '=', repId), eb('van_location_id', '=', vanLoc.id)]))
      .orderBy('id', 'desc')
      .executeTakeFirst();

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    // INV-VAN-DAILY-SPLIT-SETTLEMENT: the tenant-local day the trip
    // opens on, resolved on the pool handle before the transaction
    // (P2 pattern) — the trip never spans days silently from here on.
    const tenantTimezone = await getTenantTimezone(this.anyDb, tenantId);
    let createdTripId = 0;
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    // INV-VAN-TRIP-STARTED-AUDIT: resolve the actor before the
    // transaction (same pattern as the field-sale row) so the audit
    // row below names the acting rep's linked login — or null with
    // the rep named in the details when the rep has no linked login.
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.db
      .transaction()
      .execute(async (trx) => {
        const trxAny = trx as any;

        // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the pre-check above runs on
        // an unlocked read, so two concurrent opens both pass it. This
        // locked re-check is the first statement of the transaction; the
        // partial unique index uq_van_trips_one_open_per_rep (migration
        // 2040000000314) is the backstop for the zero-row case a FOR
        // UPDATE read cannot lock (see the .catch on the transaction
        // below, which translates its violation to TRIP_ALREADY_OPEN).
        const lockedExistingTrip = await trxAny
          .selectFrom('van_sales_trips')
          .select(['id'])
          .where('rep_id', '=', repId)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'open')
          .forUpdate()
          .executeTakeFirst();
        if (lockedExistingTrip) {
          throw new AppError(
            'توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة',
            'TRIP_ALREADY_OPEN',
            400,
          );
        }

        if (hasItemsToLoad) {
          if (sourceLocId === vanLoc.id) {
            throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
          }

          for (const item of this.sortItemsByProductId(payload.items!)) {
            const pid = Number(item.productId);
            const qty = Number(item.qty || 0);
            if (qty <= 0) continue;

            const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
            if (effectiveLocId === vanLoc.id) {
              throw new AppError(
                'لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب',
                'INVALID_SOURCE_WAREHOUSE',
                400,
              );
            }

            // CANONICAL LOCK ORDER: Lock products first!
            const prod = await trxAny
              .selectFrom('products')
              .select(['id', 'name', 'cost_price', 'retail_price'])
              .where('id', '=', pid)
              .where('tenant_id', '=', tenantId)
              .forUpdate()
              .executeTakeFirst();

            if (!prod) {
              throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
            }

            // INV-VAN-LOAD-AVAILABLE-QTY (F10): the pre-check reads the
            // same canonical available the gate enforces (on-hand minus
            // reserved, capped by the global leg) through the ledger's
            // read-only availability — never the raw on-hand qty. The
            // locked gate (applyStockDelta, inside moveVanStock below)
            // stays the authority: it re-locks the product and the
            // balances in canonical order, so a concurrent move that
            // lands after this read still fails closed there.
            const availability = await getLocationAvailability(trx, {
              tenantId,
              accountId,
              productId: pid,
              locationId: effectiveLocId,
            });
            const avail = computeVanLoadAvailableQty(availability);
            if (avail < qty) {
              const holds = await findPendingLoadHolds(trxAny, tenantId, pid, effectiveLocId);
              const holdsText =
                holds.length > 0
                  ? ` — طلبات تحميل معلقة لنفس الصنف من هذا المخزن: ${holds.map((h) => `#${h.docNo} (${h.qty})`).join('، ')}`
                  : '';
              throw new AppError(
                `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر للتحميل: ${avail}، المطلوب: ${qty}${holdsText}`,
                'INSUFFICIENT_SOURCE_STOCK',
                400,
              );
            }

            const price = Number(prod?.retail_price || 0);
            const cost = Number(prod?.cost_price || 0);
            totalLoadedValue += price * qty;
            totalLoadedCost += cost * qty;

            // Loading a van is a location-to-location move
            await this.moveVanStock(trx, {
              productId: pid,
              delta: -qty,
              locationId: effectiveLocId,
              tenantId,
              accountId,
              userId: null,
              movementType: 'van_load_out',
              note: `تحميل سيارة توزيع - خروج من المستودع`,
              referenceType: 'van_sales_trip',
              referenceId: 0,
              skipGlobalUpdate: false,
              unitCost: cost,
            });

            // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
            await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);
            // INV-VAN-GENERIC-FEFO: the generic batches travel too.
            await this.moveVanInventoryBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

            await this.moveVanStock(trx, {
              productId: pid,
              delta: qty,
              locationId: vanLoc.id,
              tenantId,
              accountId,
              userId: null,
              movementType: 'van_load_in',
              note: `تحميل سيارة توزيع - دخول للسيارة`,
              referenceType: 'van_sales_trip',
              referenceId: 0,
              skipGlobalUpdate: false,
              unitCost: cost,
            });
          }
        } else {
          // Start trip with existing stock already in van
          const existingStock = await trxAny
            .selectFrom('product_location_stock as pls')
            .innerJoin('products as p', 'p.id', 'pls.product_id')
            .select([
              sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
              sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
              sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
            ])
            .where('pls.location_id', '=', vanLoc.id)
            .where('pls.tenant_id', '=', tenantId)
            .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
            .execute();

          for (const s of existingStock) {
            totalLoadedValue += Number(s.qty || 0) * Number(s.retailPrice || 0);
            totalLoadedCost += Number(s.qty || 0) * Number(s.costPrice || 0);
          }
        }

        const insertedTrip = await trxAny
          .insertInto('van_sales_trips')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            vehicle_id: assignedVehicle?.id ? Number(assignedVehicle.id) : null,
            start_odometer:
              payload.startOdometer != null
                ? Number(payload.startOdometer)
                : assignedVehicle?.current_odometer
                  ? Number(assignedVehicle.current_odometer)
                  : null,
            van_location_id: vanLoc.id,
            source_warehouse_id: sourceLocId || vanLoc.id,
            status: 'open',
            settlement_status: 'open',
            business_day: todayTenantDate(tenantTimezone),
            loaded_amount: roundMoney(totalLoadedValue, moneyDigits),
            sales_amount: 0,
            cash_collected: 0,
            credit_sales: 0,
            returns_amount: 0,
            variance: 0,
            notes:
              payload.notes ||
              (hasItemsToLoad
                ? 'تحميل وتجهيز بضاعة الصباح لرحلة التوزيع الميداني'
                : 'بدء رحلة التوزيع بالبضاعة المتوفرة بالسيارة'),
            opened_at: sql`NOW()`,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();

        createdTripId = Number(insertedTrip.id);

        // INV-VAN-TRIP-STARTED-AUDIT: one audit row per trip start, in
        // this same transaction — a rolled-back open leaves no audit
        // trace, and a committed open always has one. Before this the
        // trip start wrote nothing, so the trip was invisible in the
        // admin audit log while its settlement is audited. The
        // function-check guards harnesses that pass a `{}` audit stub;
        // in production Nest always injects the real AuditService.
        if (this.audit && typeof this.audit.logWithExecutor === 'function') {
          await this.audit.logWithExecutor(
            trx,
            'بدء رحلة توزيع',
            `بدأ المندوب ${auditActor.repName} (#${Number(repId)}) رحلة التوزيع #${createdTripId} — بضاعة محملة بقيمة ${roundMoney(totalLoadedValue, moneyDigits)} (${Number(payload.items?.length || 0)} صنف)`,
            { userId: auditActor.userId, tenantId, accountId },
            { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_STARTED },
          );
        }

        // Post van loading stock transfer journal
        if (hasItemsToLoad && totalLoadedCost > 0) {
          const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
          const vanLocRow = await trxAny
            .selectFrom('stock_locations')
            .select(['branch_id'])
            .where('id', '=', vanLoc.id)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
          await this.accountingPosting.postVanStockTransfer(
            trx,
            createdTripId,
            {
              sourceLocationId: sourceLocId || vanLoc.id,
              targetLocationId: vanLoc.id,
              totalCost: totalLoadedCost,
              branchId,
              type: 'load',
            },
            systemAuth,
          );
        }
      })
      .catch((err: any) => {
        // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the unique-index backstop
        // (uq_van_trips_one_open_per_rep) fired — a concurrent open won
        // the race. Translate only that index's violation; any other
        // error (journal dedup, stock) rethrows untouched.
        const message = String(err?.message || '');
        if (message.includes('uq_van_trips_one_open_per_rep')) {
          throw new AppError(
            'توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة',
            'TRIP_ALREADY_OPEN',
            400,
          );
        }
        throw err;
      });

    return {
      ok: true,
      tripId: createdTripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items?.length || 0,
    };
  }

  /**
   * Loads supplementary stock into an existing active van trip (e.g. from an approved load requisition).
   * Adheres strictly to canonical lock order, dual stock movements, and ledger posting invariants.
   */
  async loadSupplementaryStockToActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    tripId: number,
    payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', tripId)
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (!existingTrip) {
      throw new AppError('رحلة التوزيع المحددة غير موجودة أو تم إغلاقها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    if (!hasItemsToLoad) {
      return { ok: true, tripId, totalLoadedValue: 0, itemsCount: 0 };
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      if (sourceLocId === vanLoc.id) {
        throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
      }

      for (const item of this.sortItemsByProductId(payload.items)) {
        const pid = Number(item.productId);
        const qty = Number(item.qty || 0);
        if (qty <= 0) continue;

        const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
        if (effectiveLocId === vanLoc.id) {
          throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
        }

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
        }

        // INV-VAN-LOAD-AVAILABLE-QTY (F10): same canonical pre-check
        // as openTripAndLoad — the ledger's available (on-hand minus
        // reserved, capped by the global leg), never the raw on-hand
        // qty. The locked gate inside moveVanStock stays the
        // authority for concurrent moves.
        const availability = await getLocationAvailability(trx, {
          tenantId,
          accountId,
          productId: pid,
          locationId: effectiveLocId,
        });
        const avail = computeVanLoadAvailableQty(availability);
        if (avail < qty) {
          const holds = await findPendingLoadHolds(trxAny, tenantId, pid, effectiveLocId);
          const holdsText =
            holds.length > 0
              ? ` — طلبات تحميل معلقة لنفس الصنف من هذا المخزن: ${holds.map((h) => `#${h.docNo} (${h.qty})`).join('، ')}`
              : '';
          throw new AppError(
            `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر للتحميل: ${avail}، المطلوب: ${qty}${holdsText}`,
            'INSUFFICIENT_SOURCE_STOCK',
            400,
          );
        }

        const price = Number(prod?.retail_price || 0);
        const cost = Number(prod?.cost_price || 0);
        totalLoadedValue += price * qty;
        totalLoadedCost += cost * qty;

        // Loading supplementary van stock is a location-to-location move
        await this.moveVanStock(trx, {
          productId: pid,
          delta: -qty,
          locationId: effectiveLocId,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_out',
          note: `تحميل سيارة توزيع إضافي (استعواض) - خروج من المستودع`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });

        // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
        await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);
        // INV-VAN-GENERIC-FEFO: the generic batches travel too.
        await this.moveVanInventoryBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

        await this.moveVanStock(trx, {
          productId: pid,
          delta: qty,
          locationId: vanLoc.id,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_in',
          note: `تحميل سيارة توزيع إضافي (استعواض) - دخول للسيارة`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });
      }

      const additionalNote = payload.notes || 'تحميل بضاعة إضافية (استعواض أثناء اليوم)';
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          loaded_amount: sql`coalesce(loaded_amount, 0) + ${roundMoney(totalLoadedValue, moneyDigits)}`,
          notes: sql`case 
            when notes is null or notes = '' then ${additionalNote}
            else notes || E'\n' || ${additionalNote}
          end`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', tripId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Post van loading stock transfer journal
      if (totalLoadedCost > 0) {
        const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
        const vanLocRow = await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLoc.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
        await this.accountingPosting.postVanStockTransfer(
          trx,
          tripId,
          {
            sourceLocationId: sourceLocId || vanLoc.id,
            targetLocationId: vanLoc.id,
            totalCost: totalLoadedCost,
            branchId,
            type: 'load',
          },
          systemAuth,
        );
      }
    });

    return {
      ok: true,
      tripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items.length,
    };
  }
}
