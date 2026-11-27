import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { CreateContainerPreorderDto, ConvertPreorderToSaleDto, RefundImportPreorderDto } from '../dto/import-sales.dto';
import { allocateSaleFromImportLots, calculateImportSaleCost } from '../helpers/import-lot-allocation.helper';
import { applyStockDelta, lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { recordStockMovementRow } from '../../../common/utils/stock-movement-writer';

/**
 * ImportContainerPreordersService — slice S12 of the import-sales split.
 * Pure move of 6 methods from ImportSalesService (in-transit container
 * pre-orders). No behavior change: the bodies are byte-identical; the
 * facade keeps thin delegates with the same names and signatures.
 * The section banners (IN-TRANSIT CONTAINER PRE-ORDERS, CONVERT
 * CONTAINER PRE-ORDER TO CONFIRMED SALE INVOICE) stay in the facade
 * (S9 precedent); the 6-line I6-E doc comment travels with
 * replayContainerPreorderOrThrow (S11 precedent), and the 1-line
 * JSDoc travels with refundContainerPreorder.
 * Kernel helpers are bound from the facade (they stay there forever):
 * resolveTenantAccount, isUniqueViolation. allocateSaleFromImportLots
 * + calculateImportSaleCost are imported HELPERS (not methods), and
 * applyStockDelta / lockStockProducts are imported free functions —
 * all collected mechanically from the moved text.
 * The posting fallback (accountingPosting ?? new
 * AccountingPostingService(...)) is preserved verbatim in
 * createContainerPreorder + refundContainerPreorder +
 * convertPreorderToSale — accountingPosting arrives as an OPTIONAL
 * bound dep, so specs constructing new ImportSalesService(db,
 * undefined) keep working.
 * Money note (pre-existing, byte-preserved): the 7 toFixed(2) sites
 * compute reservation / refund / sale-invoice totals (totalPrice,
 * refund remaining + persisted refunded total, sale total +
 * appliedDeposit + balanceDue) that feed the posted JEs and
 * persisted rows.
 * replayContainerPreorderOrThrow is public here (private in the
 * facade delegate) — the facade, a different class, cannot call a
 * private slice method (tsc TS2341); the facade delegate stays
 * private, so the facade public surface is unchanged. Its only
 * caller (createContainerPreorder) moves with it.
 * This is the FINAL slice of the import-sales split: after this
 * merge the facade measures ~790 lines and its file-size baseline
 * entry is removed (merge-owned).
 */

export interface ImportContainerPreordersDeps {
  db: Kysely<any>;
  // Optional posting service (same fallback as the facade: the moved
  // createContainerPreorder / refundContainerPreorder /
  // convertPreorderToSale build their own AccountingPostingService
  // when this is undefined — specs constructing new
  // ImportSalesService(db, undefined) depend on that).
  accountingPosting?: AccountingPostingService;
  // Bound facade members (same names as the facade members, so the
  // moved bodies are byte-identical). resolveTenantAccount +
  // isUniqueViolation are the shared kernel helpers (stay in the
  // facade forever).
  resolveTenantAccount: (...args: any[]) => any;
  isUniqueViolation: (...args: any[]) => any;
}

@Injectable()
export class ImportContainerPreordersService {
  private readonly db: Kysely<any>;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly resolveTenantAccount: (...args: any[]) => any;
  private readonly isUniqueViolation: (...args: any[]) => any;

  constructor(deps: ImportContainerPreordersDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantAccount = deps.resolveTenantAccount;
    this.isUniqueViolation = deps.isUniqueViolation;
  }

  // I6-E: replay-or-fail-closed for a duplicate preorder write.
  // Same key + same payload is a retry: return the existing
  // reservation (no second B/L capacity consumed, no second
  // advance JE). Same key + different payload is a key
  // collision: fail closed with a named conflict. No row under
  // the key means the 23505 came from elsewhere — rethrow.
  async replayContainerPreorderOrThrow(
    tenantId: string,
    dto: CreateContainerPreorderDto,
    effectiveKey: string,
    originalError: any,
  ): Promise<any> {
    const existing: any = await this.db
      .selectFrom('import_container_preorders')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', effectiveKey)
      .executeTakeFirst();
    if (!existing) throw originalError;
    const samePayload =
      String(existing.shipment_id) === String(dto.shipmentId) &&
      Number(existing.customer_id) === Number(dto.customerId) &&
      Number(existing.product_id) === Number(dto.productId) &&
      Number(existing.reserved_quantity) === Number(dto.reservedQuantity) &&
      Number(existing.unit_price_egp) === Number(dto.unitPriceEgp) &&
      Number(existing.deposit_amount_egp) === Number(dto.depositAmountEgp || 0);
    if (samePayload) return existing;
    throw new ConflictException(
      'يوجد حجز بضاعة عايمة مسجل بنفس مفتاح عدم التكرار لكن ببيانات مختلفة؛ راجع الحجوزات المسجلة قبل إعادة الإرسال. [IMPORT_CONTAINER_PREORDER_DUPLICATE_KEY]',
    );
  }

  async createContainerPreorder(tenantId: string, userId: number, dto: CreateContainerPreorderDto) {
    // I6-E — idempotency contract, same shape as deposits: the key
    // is OPTIONAL on the DTO. A caller that sends idempotencyKey
    // owns the retry identity; a caller that does not (the live
    // form sends exactly the DTO fields and no key, after I4-D12
    // removed the dead field) gets a server-derived key from the
    // reservation identity — shipment + customer + product + qty +
    // unit price + deposit. A retry sends the identical payload,
    // so it replays; a genuinely different reservation gets a
    // different key. Known limit: two intentionally identical
    // reservations with no client key are indistinguishable from
    // a retry and the second returns the first; sending a client
    // key removes the ambiguity.
    const suppliedKey = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';
    if (dto.idempotencyKey !== undefined && (!suppliedKey || suppliedKey.length > 128)) {
      throw new BadRequestException(
        'مفتاح عدم تكرار الحجز يجب أن يكون نصاً غير فارغ لا يتجاوز 128 حرفاً. [IMPORT_CONTAINER_PREORDER_KEY_INVALID]',
      );
    }
    const effectiveKey =
      suppliedKey ||
      `preorder:${dto.shipmentId}:${dto.customerId}:${dto.productId}:${Number(dto.reservedQuantity)}:${Number(dto.unitPriceEgp)}:${Number(dto.depositAmountEgp || 0)}`;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const shipment = await trx
          .selectFrom('import_shipments')
          .selectAll()
          .where('id', '=', dto.shipmentId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();

        // INV-IMPORT-FLOATING-RESERVATION: a floating-goods reservation is
        // a PRE-RECEIPT allotment of B/L capacity. Once the container has
        // arrived (status 'Arrived', which posts the receipt) or any
        // inventory receipt row exists for it, the goods are stock, not
        // floating goods: a new reservation is refused fail-closed.
        // Existing reservations stay convertible to a sale through
        // convertPreorderToSale, which is the post-arrival path.
        if (shipment.status === 'Arrived') {
          throw new BadRequestException('وصلت الحاوية وتم استلامها؛ لا يمكن تسجيل حجز بضاعة عايمة جديد بعد الوصول.');
        }
        const receiptRow = await trx
          .selectFrom('import_inventory_receipts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('shipment_id', '=', dto.shipmentId)
          .executeTakeFirst();
        if (receiptRow) {
          throw new BadRequestException(
            'تم ترحيل استلام الحاوية للمخزون؛ لا يمكن تسجيل حجز بضاعة عايمة جديد بعد الاستلام.',
          );
        }

        const itemRows = await trx
          .selectFrom('import_shipment_items')
          .select(['quantity', 'received_quantity'])
          .where('shipment_id', '=', dto.shipmentId)
          .where('product_id', '=', Number(dto.productId))
          .where('tenant_id', '=', tenantId)
          .execute();

        if (!itemRows.length) {
          throw new BadRequestException('هذا الصنف غير مدرج في هذه الشحنة.');
        }
        // The same SKU can be represented by several distinct shipment lines.
        const customer = await trx
          .selectFrom('customers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', Number(dto.customerId))
          .executeTakeFirst();
        if (!customer) throw new BadRequestException('العميل المحدد لا ينتمي لهذه المنشأة.');
        if (dto.projectId && shipment.project_id && dto.projectId !== shipment.project_id) {
          throw new BadRequestException('مشروع الحجز لا يطابق مشروع الشحنة.');
        }
        const blQuantity = itemRows.reduce((sum, row) => sum + Number(row.received_quantity ?? row.quantity), 0);

        const existingOrders = await trx
          .selectFrom('import_container_preorders')
          .select('reserved_quantity')
          .where('shipment_id', '=', dto.shipmentId)
          .where('product_id', '=', Number(dto.productId))
          .where('tenant_id', '=', tenantId)
          .where('status', 'in', ['reserved', 'allocated', 'invoiced'])
          .execute();

        const alreadyReserved = existingOrders.reduce((acc, o) => acc + Number(o.reserved_quantity), 0);
        const requested = Number(dto.reservedQuantity);

        // Validate BEFORE the insert: the deposit rule used to be checked
        // after the insert (the throw rolled the transaction back, so no
        // row survived — but a fail-closed check belongs before the write).
        if (!Number.isFinite(requested) || requested <= 0) {
          throw new BadRequestException('الكمية المحجوزة يجب أن تكون أكبر من صفر.');
        }
        const totalPrice = Number((requested * Number(dto.unitPriceEgp)).toFixed(2));
        const depositAmount = Number(dto.depositAmountEgp || 0);
        if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > totalPrice) {
          throw new BadRequestException('قيمة العربون يجب أن تكون موجبة ولا تتجاوز إجمالي قيمة الحجز.');
        }

        if (alreadyReserved + requested > blQuantity) {
          const freeToReserve = Math.max(0, blQuantity - alreadyReserved);
          throw new BadRequestException(
            `لا يمكن تجاوز كمية البوليصة: المتاح للحجز فقط (${freeToReserve}) وحدة من إجمالي (${blQuantity})، والمطلوب (${requested}).`,
          );
        }

        const preorder = await trx
          .insertInto('import_container_preorders')
          .values({
            tenant_id: tenantId,
            preorder_no: `PRE-${randomUUID()}`,
            project_id: shipment.project_id ?? dto.projectId ?? null,
            shipment_id: dto.shipmentId,
            customer_id: Number(dto.customerId),
            product_id: Number(dto.productId),
            reserved_quantity: requested,
            unit_price_egp: dto.unitPriceEgp,
            total_price_egp: totalPrice,
            deposit_amount_egp: depositAmount,
            deposit_treasury_account_id: dto.depositTreasuryAccountId ? Number(dto.depositTreasuryAccountId) : null,
            status: 'reserved',
            expected_delivery_date: dto.expectedDeliveryDate || null,
            notes: dto.notes || null,
            created_by: userId,
            idempotency_key: effectiveKey,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        if (depositAmount > 0) {
          const bankAccId = await this.resolveTenantAccount(
            trx,
            tenantId,
            'bank',
            dto.depositTreasuryAccountId ? Number(dto.depositTreasuryAccountId) : null,
          );
          const unearnedRevAccId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');

          const scope = await trx
            .selectFrom('accounting_accounts')
            .select('account_id')
            .where('tenant_id', '=', tenantId)
            .where('id', '=', bankAccId)
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('treasury_transactions')
            .values({
              tenant_id: tenantId,
              account_id: scope.account_id,
              txn_type: 'import_customer_advance',
              amount: depositAmount,
              note: `عربون حجز حاوية #${preorder.preorder_no}`,
              reference_type: 'import_container_preorder',
              reference_id: Number(preorder.serial_id),
              created_by: userId,
            })
            .execute();
          const postingService =
            this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
          await postingService.postDomainJournal(trx, {
            sourceType: 'import_container_preorder',
            sourceId: Number(preorder.serial_id),
            tenantId,
            accountId: tenantId,
            entryDate: new Date(),
            description: `عربون حجز بضاعة عايمة للعميل #${dto.customerId} - حجز #${preorder.preorder_no}`,
            branchId: null,
            locationId: null,
            createdBy: userId,
            postedBy: userId,
            lines: [
              {
                accountId: bankAccId,
                debit: depositAmount,
                credit: 0,
                description: `تحصيل عربون حجز بضاعة شحنة #${dto.shipmentId}`,
                partnerType: 'customer',
                partnerId: Number(dto.customerId),
                branchId: null,
                locationId: null,
              },
              {
                accountId: unearnedRevAccId,
                debit: 0,
                credit: depositAmount,
                description: `أمانات/عربونات عملاء غير محققة - حجز #${preorder.preorder_no}`,
                partnerType: 'customer',
                partnerId: Number(dto.customerId),
                branchId: null,
                locationId: null,
              },
            ],
          });
        }

        return preorder;
      });
    } catch (err: any) {
      if (this.isUniqueViolation(err)) {
        return await this.replayContainerPreorderOrThrow(tenantId, dto, effectiveKey, err);
      }
      throw err;
    }
  }

  async listContainerPreorders(tenantId: string, shipmentId?: string, customerId?: string) {
    let q = this.db
      .selectFrom('import_container_preorders as po')
      .leftJoin('customers as c', 'c.id', 'po.customer_id')
      .leftJoin('products as p', 'p.id', 'po.product_id')
      .selectAll('po')
      .select(['c.name as customer_name', 'p.name as product_name'])
      .where('po.tenant_id', '=', tenantId);
    if (shipmentId) q = q.where('po.shipment_id', '=', shipmentId);
    if (customerId) q = q.where('po.customer_id', '=', Number(customerId));
    return await q.orderBy('po.created_at', 'desc').execute();
  }

  /** Refunds are append-only GL source events; original deposits remain immutable. */
  async refundContainerPreorder(tenantId: string, userId: number, preorderId: string, dto: RefundImportPreorderDto) {
    return this.db.transaction().execute(async (trx) => {
      const preorder = await trx
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', preorderId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (preorder.status === 'invoiced' || preorder.status === 'cancelled') {
        throw new BadRequestException('لا يجوز رد عربون حجز مفوتر أو ملغى.');
      }
      const requestKey = String(dto.idempotencyKey || '').trim();
      if (!requestKey || requestKey.length > 128) throw new BadRequestException('مفتاح عدم تكرار الرد إلزامي.');
      const existing = await trx
        .selectFrom('import_preorder_refund_events')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('preorder_id', '=', preorderId)
        .where('idempotency_key', '=', requestKey)
        .executeTakeFirst();
      if (existing) throw new ConflictException('رد العربون بنفس المفتاح مسجل بالفعل.');
      const amount = Number(dto.amountEgp);
      const remaining = Number(
        (Number(preorder.deposit_amount_egp || 0) - Number(preorder.refunded_amount_egp || 0)).toFixed(2),
      );
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Number(amount.toFixed(2)) !== amount ||
        amount > remaining + 0.001
      ) {
        throw new BadRequestException('مبلغ الرد أكبر من العربون المتبقي أو غير صالح.');
      }
      const preferred = Number(dto.treasuryAccountId || preorder.deposit_treasury_account_id || 0);
      const bankAccountId = await this.resolveTenantAccount(trx, tenantId, 'bank', preferred || undefined);
      const liabilityAccountId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');
      const bankScope = await trx
        .selectFrom('accounting_accounts')
        .select('account_id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bankAccountId)
        .executeTakeFirstOrThrow();
      const event = await trx
        .insertInto('import_preorder_refund_events')
        .values({
          tenant_id: tenantId,
          preorder_id: preorderId,
          idempotency_key: requestKey,
          amount_egp: amount,
          treasury_account_id: bankAccountId,
          created_by: userId,
        })
        .returning(['id', 'serial_id'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: bankScope.account_id,
          txn_type: 'import_customer_advance_refund',
          amount: -amount,
          note: `رد عربون حجز ${preorder.preorder_no}`,
          reference_type: 'import_preorder_refund',
          reference_id: Number(event.serial_id),
          created_by: userId,
        })
        .execute();
      const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
      const journalId = await posting.postDomainJournal(trx, {
        sourceType: 'import_preorder_refund',
        sourceId: Number(event.serial_id),
        tenantId,
        accountId: bankScope.account_id,
        entryDate: new Date(),
        description: `رد عربون حجز ${preorder.preorder_no}`,
        branchId: null,
        locationId: null,
        createdBy: userId,
        postedBy: userId,
        lines: [
          {
            accountId: liabilityAccountId,
            debit: amount,
            credit: 0,
            description: 'تخفيض التزام العربون المسترد',
            partnerType: 'customer',
            partnerId: Number(preorder.customer_id),
            branchId: null,
            locationId: null,
          },
          {
            accountId: bankAccountId,
            debit: 0,
            credit: amount,
            description: 'صرف رد عربون للعميل',
            partnerType: 'customer',
            partnerId: Number(preorder.customer_id),
            branchId: null,
            locationId: null,
          },
        ],
      });
      await trx
        .updateTable('import_preorder_refund_events')
        .set({ journal_entry_id: journalId })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', event.id)
        .execute();
      const updated = await trx
        .updateTable('import_container_preorders')
        .set({
          refunded_amount_egp: Number((Number(preorder.refunded_amount_egp || 0) + amount).toFixed(2)),
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', preorderId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { success: true, preorder: updated, refundEventId: event.id, journalEntryId: journalId };
    });
  }

  async cancelContainerPreorder(tenantId: string, preorderId: string, reason?: string) {
    return await this.db.transaction().execute(async (trx) => {
      const preorder = await trx
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (preorder.status === 'invoiced' || preorder.status === 'cancelled') {
        throw new BadRequestException('الحجز مفوتر أو ملغى بالفعل.');
      }
      if (Number(preorder.deposit_amount_egp || 0) - Number(preorder.refunded_amount_egp || 0) > 0.001) {
        throw new BadRequestException('لا يمكن إلغاء حجز بعربون قبل رد المبلغ وتسوية التزام العميل محاسبياً.');
      }

      return await trx
        .updateTable('import_container_preorders')
        .set({
          status: 'cancelled',
          notes: reason ? `${preorder.notes || ''} [سبب الإلغاء: ${reason}]` : preorder.notes,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async convertPreorderToSale(
    tenantId: string,
    userId: number,
    preorderId: string,
    dto: ConvertPreorderToSaleDto = {},
  ) {
    return await this.db.transaction().execute(async (trx) => {
      const preorder = await trx
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!preorder) throw new NotFoundException('حجز الحاوية غير موجود');
      if (preorder.status === 'invoiced') throw new BadRequestException('تم إصدار فاتورة لهذا الحجز مسبقاً');
      if (preorder.status === 'cancelled') throw new BadRequestException('الحجز ملغى ولا يمكن تحويله لفاتورة');

      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'phone'])
        .where('id', '=', preorder.customer_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const product = await trx
        .selectFrom('products')
        .select(['id', 'name', 'sku', 'account_id', 'cost_price'])
        .where('id', '=', preorder.product_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const qty = Number(preorder.reserved_quantity);
      const unitPrice = Number(preorder.unit_price_egp ?? preorder.agreed_unit_price_egp ?? 0);
      const total = Number((qty * unitPrice).toFixed(2));
      const depositAmount = Math.max(
        0,
        Number((Number(preorder.deposit_amount_egp || 0) - Number(preorder.refunded_amount_egp || 0)).toFixed(2)),
      );
      const appliedDeposit = Math.min(depositAmount, total);
      const balanceDue = Math.max(0, Number((total - appliedDeposit).toFixed(2)));

      // P10 guard (INV-IMPORT-PREARRIVAL-CONVERSION-GUARD): a container
      // preorder may only become a sale once the goods have physically
      // arrived AND been posted into stock. A receipt in state 'posted'
      // is the proof of arrival (the same test the late-expense and
      // broker paths already use); active lots for THIS shipment and
      // product whose remaining quantity covers the full preorder
      // quantity are the proof of allocation. Anything less fails
      // closed here, before any write — no stock deduction, no sale,
      // no journal, and no COGS credited against inventory that was
      // never debited. The preorder row is already locked above and
      // the lot rows are locked below, so a concurrent receipt
      // reversal (which zeroes lots and flips preorders back to
      // reserved) serialises against this check instead of racing it.
      const postedReceipt = await trx
        .selectFrom('import_inventory_receipts')
        .select(['id', 'state'])
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', preorder.shipment_id)
        .where('state', '=', 'posted')
        .forUpdate()
        .executeTakeFirst();
      if (!postedReceipt) {
        throw new BadRequestException(
          `لا يمكن تحويل الحجز إلى بيع قبل استلام مرحّل للشحنة: لا يوجد إيصال بحالة مرحّل. [IMPORT_PREORDER_CONVERSION_NO_POSTED_RECEIPT]`,
        );
      }
      const coveringLots = await trx
        .selectFrom('import_inventory_lots')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('shipment_id', '=', preorder.shipment_id)
        .where('product_id', '=', preorder.product_id)
        .where('status', '=', 'active')
        .forUpdate()
        .orderBy('id')
        .execute();
      const allocatedQty = coveringLots.reduce((sum, l) => sum + Number(l.remaining_quantity || 0), 0);
      if (allocatedQty + 0.0001 < qty) {
        throw new BadRequestException(
          `لا يمكن تحويل الحجز إلى بيع: الحصص المخصصة للشحنة (${allocatedQty}) أقل من كمية الحجز (${qty}). [IMPORT_PREORDER_CONVERSION_NOT_ALLOCATED]`,
        );
      }
      const lot = coveringLots[0];

      const branchId = dto.branchId || lot?.branch_id || 1;
      const locationId = dto.locationId || lot?.location_id || 1;

      // The P10 lot guard above proves this shipment's lots cover the
      // full quantity, so the deduction must never drive the location
      // balance negative: allowNegative is false, and a diverged
      // physical balance fails closed (INSUFFICIENT_STOCK) instead of
      // minting negative stock. The canonical delta result carries
      // the true scope before/after quantities stamped on the
      // movement row below.
      let stockDelta: { scopeBefore: number; scopeAfter: number } | null = null;
      if (product) {
        await lockStockProducts(trx as any, {
          tenantId,
          accountId: product.account_id || tenantId,
          productIds: [Number(preorder.product_id)],
        });
        stockDelta = await applyStockDelta(trx as any, {
          tenantId,
          accountId: product.account_id || tenantId,
          productId: Number(preorder.product_id),
          delta: -qty,
          branchId,
          locationId,
          allowNegative: false,
        });
      }

      // Create Sale Record
      const saleInsert = await trx
        .insertInto('sales')
        .values({
          customer_id: preorder.customer_id,
          customer_name: customer?.name || 'عميل حجز حاوية',
          customer_phone: customer?.phone || null,
          payment_type: appliedDeposit >= total ? 'cash' : appliedDeposit > 0 ? 'split' : 'credit',
          payment_channel: 'cash',
          subtotal: total,
          discount: 0,
          tax_rate: 0,
          tax_amount: 0,
          total: total,
          paid_amount: appliedDeposit,
          applied_amount: appliedDeposit,
          tendered_amount: appliedDeposit,
          change_amount: 0,
          status: 'posted',
          note: `فاتورة مبيعات محولة آلياً من حجز حاوية مسبق [حجز #${preorder.id.slice(0, 8)}] - دفعة مقدمة مسواة: ${appliedDeposit} ج.م`,
          branch_id: branchId,
          location_id: locationId,
          created_by: userId,
          tenant_id: tenantId,
          account_id: product?.account_id || tenantId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const saleId = Number(saleInsert.id);
      const docNo = `INV-IMP-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(saleId).padStart(4, '0')}`;
      await trx
        .updateTable('sales')
        .set({ doc_no: docNo, updated_at: sql`NOW()` })
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Insert Sale Item
      const saleItemInsert = await trx
        .insertInto('sale_items')
        .values({
          sale_id: saleId,
          product_id: preorder.product_id,
          product_name: product?.name || 'صنف مستورد',
          qty: qty,
          unit_price: unitPrice,
          line_total: total,
          net_unit_price: unitPrice,
          net_line_total: total,
          allocated_discount: 0,
          allocated_tax: 0,
          tenant_id: tenantId,
          account_id: product?.account_id || tenantId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      // Allocate from Import Lot to deplete remaining quantity and maintain project lineage
      const lotAllocation = await allocateSaleFromImportLots(trx, {
        tenantId,
        saleId,
        locationId,
        items: [
          {
            itemId: Number(saleItemInsert.id),
            productId: preorder.product_id,
            qty: qty,
            netUnitPrice: unitPrice,
            locationId,
          },
        ],
      });

      const saleAllocs = await trx
        .selectFrom('import_sale_allocations')
        .select(['quantity', 'unit_cost_egp'])
        .where('tenant_id', '=', tenantId)
        .where('sale_id', '=', saleId)
        .execute();

      // Cross-check: the helper's coverage must agree with the rows it just
      // wrote. Any disagreement is an internal inconsistency, not a costing
      // input to be averaged away — fail closed instead of posting a cost
      // built from two different pictures of the same allocation.
      const coverage = lotAllocation.items[0];
      if (!coverage) {
        throw new BadRequestException(
          'IMPORT_SALE_ALLOCATION_MISSING: lot allocation returned no coverage for the converted sale item.',
        );
      }
      const dbAllocatedQty = Number(saleAllocs.reduce((sum, a) => sum + Number(a.quantity || 0), 0).toFixed(4));
      if (Math.abs(dbAllocatedQty - coverage.allocatedQty) > 0.0001) {
        throw new BadRequestException(
          `IMPORT_SALE_ALLOCATION_MISMATCH: helper coverage (${coverage.allocatedQty}) disagrees with stored allocations (${dbAllocatedQty}) for sale ${saleId}; conversion refused rather than posting a reconciled cost.`,
        );
      }
      const allocCostEgp = saleAllocs.reduce(
        (acc, a) => acc + Number(a.quantity || 0) * Number(a.unit_cost_egp || 0),
        0,
      );
      // Shortfall top-up: uncovered units are costed at the shipment lot's
      // landed cost, else current WAC (products.cost_price). This preserves
      // the old fully-uncovered behaviour exactly (shortfall == qty, so the
      // total equals the old fallback) and generalises it to partial
      // coverage, where the old code silently dropped the uncovered units'
      // cost. The fallback lot here is shipment-scoped, not
      // location-scoped (same as before); WAC remains the GL basis for
      // ordinary POS sales and is the fallback of last resort here.
      const fallbackUnitCostEgp = Number(lot?.unit_landed_cost_egp || product?.cost_price || 0);
      const saleCost = calculateImportSaleCost({
        qty,
        allocatedQty: coverage.allocatedQty,
        allocCostEgp,
        fallbackUnitCostEgp,
      });
      const totalCostEgp = saleCost.totalCostEgp;
      const unitCostEgp = saleCost.unitCostEgp;

      // Guarantee, part 1: a stock-reducing sale (qty > 0) never completes
      // with stock decreased and no COGS/inventory pair. insertPostedJournal
      // rejects 0/0 lines (INVALID_JOURNAL_LINE), so a zero-cost pair cannot
      // be posted literally — the honest guarantee is fail-closed: when no
      // cost is knowable at all (no lot cost and WAC is 0), the whole
      // conversion rolls back and the preorder stays un-invoiced, instead
      // of the books silently diverging. A genuine zero-cost stock policy
      // needs an explicit, recorded override decision — not a silent
      // omission (see the note after the journal block).
      if (qty > 0 && totalCostEgp <= 0) {
        throw new BadRequestException(
          `IMPORT_SALE_ZERO_COST: cannot convert preorder ${preorder.id} — sale quantity ${qty} has no knowable cost ` +
            `(allocated ${coverage.allocatedQty} via lots, shortfall ${saleCost.shortfallQty}, ` +
            `fallback unit cost ${fallbackUnitCostEgp}). Set the lot landed cost or the product cost_price and retry.`,
        );
      }

      // The frozen unit cost is always recorded on the sale item, even when
      // it rounds to zero — the gate above, not this write, decides whether
      // the sale may complete. (Previously the write was skipped for a zero
      // unit cost, leaving a stale/default cost_price on the item.)
      await trx
        .updateTable('sale_items')
        .set({ cost_price: unitCostEgp })
        .where('id', '=', saleItemInsert.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (product) {
        // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the sale row goes
        // through the row-writer in row-only mode — the ledger call ran
        // 160 lines above (the sale insert + lot allocation sit between
        // it and the row), so the row is stamped from the carried
        // stockDelta. total_cost stays NULL (omitTotalCost): the same
        // NULL shape as the A7 sale rows, and the writer defaults the
        // missing reason to movementType 'sale'. stockDelta is
        // non-null here: the apply above either returned or threw, and
        // product is the same const tested in both blocks.
        const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx as any, tenantId));
        await recordStockMovementRow(trx as any, {
          productId: Number(preorder.product_id),
          branchId,
          locationId,
          tenantId,
          accountId: product.account_id || tenantId,
          movementType: 'sale',
          delta: -qty,
          beforeQty: stockDelta!.scopeBefore,
          afterQty: stockDelta!.scopeAfter,
          referenceType: 'sale',
          referenceId: saleId,
          note: `صرف مخزني لتحويل حجز حاوية مسبق #${docNo}`,
          unitCost: unitCostEgp,
          moneyDigits,
          omitTotalCost: true,
          createdBy: userId,
        });
      }

      if (balanceDue > 0 && preorder.customer_id) {
        await trx
          .updateTable('customers')
          .set({
            balance: sql`COALESCE(balance, 0) + ${balanceDue}`,
          })
          .where('id', '=', preorder.customer_id)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Guarantee, part 2: the COGS pair is decoupled from the revenue
      // total. Previously the whole journal was gated on `total > 0`, so a
      // free sale (unit price 0) with a positive cost posted NO journal at
      // all — stock decreased, COGS never posted. Now the journal posts
      // whenever revenue or cost is positive; the revenue line is added
      // only when total > 0 (a 0/0 line would be rejected by
      // insertPostedJournal), and the COGS/inventory pair is unconditional
      // inside this block because the zero-cost throw above guarantees
      // totalCostEgp > 0 whenever this block is reached with qty > 0.
      if (total > 0 || totalCostEgp > 0) {
        const journalLines: Array<{
          accountId: number;
          debit: number;
          credit: number;
          description: string;
          partnerType: 'customer' | 'supplier' | 'none';
          partnerId: number | null;
          branchId: number | null;
          locationId: number | null;
        }> = [];

        if (appliedDeposit > 0) {
          const customerAdvanceAccId = await this.resolveTenantAccount(trx, tenantId, 'customer_advance');
          journalLines.push({
            accountId: customerAdvanceAccId,
            debit: appliedDeposit,
            credit: 0,
            description: `تسوية دفعة مقدمة حجز حاوية للفاتورة #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        if (balanceDue > 0) {
          const receivableAccId = await this.resolveTenantAccount(trx, tenantId, 'receivable');
          journalLines.push({
            accountId: receivableAccId,
            debit: balanceDue,
            credit: 0,
            description: `استحقاق عميل فاتورة مبيعات حجز حاوية #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        if (total > 0) {
          const revenueAccId = await this.resolveTenantAccount(trx, tenantId, 'sales_revenue');
          journalLines.push({
            accountId: revenueAccId,
            debit: 0,
            credit: total,
            description: `إيراد مبيعات تحويل حجز حاوية #${docNo}`,
            partnerType: preorder.customer_id ? 'customer' : 'none',
            partnerId: preorder.customer_id ? Number(preorder.customer_id) : null,
            branchId,
            locationId,
          });
        }

        const cogsAccId = await this.resolveTenantAccount(trx, tenantId, 'cogs');
        const inventoryAccId = await this.resolveTenantAccount(trx, tenantId, 'inventory');
        journalLines.push(
          {
            accountId: cogsAccId,
            debit: totalCostEgp,
            credit: 0,
            description: `تكلفة البضاعة المباعة لحجز الحاوية #${docNo}`,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          },
          {
            accountId: inventoryAccId,
            debit: 0,
            credit: totalCostEgp,
            description: `تخفيض المخزون المستورد لحجز الحاوية #${docNo}`,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          },
        );

        const posting = this.accountingPosting ?? new AccountingPostingService(new AccountingTenantFoundationService());
        await posting.postDomainJournal(trx, {
          sourceType: 'sale',
          sourceId: saleId,
          tenantId,
          accountId: product?.account_id || tenantId,
          entryDate: new Date(),
          description: `فاتورة مبيعات حجز حاوية مستوردة #${docNo}`,
          branchId,
          locationId,
          createdBy: userId,
          postedBy: userId,
          lines: journalLines,
        });
      }

      // NOTE (deliberate non-change): if you later need genuinely zero-cost
      // stock to convert successfully, do NOT reintroduce a silent skip.
      // Add an explicit `allowZeroCost` flag to ConvertPreorderToSaleDto,
      // record the override on the sale note and the stock-movement note,
      // and accept that the journal will still carry no COGS pair — because
      // insertPostedJournal rejects 0/0 lines. The override must be a
      // recorded business decision, not a default.

      // Update preorder status
      const updatedPreorder = await trx
        .updateTable('import_container_preorders')
        .set({
          status: 'invoiced',
          sale_invoice_id: saleId,
          notes: `${preorder.notes || ''} [تم التحويل لفاتورة مبيعات #${docNo} برقم معرف ${saleId}]`.trim(),
          updated_at: sql`NOW()`,
        })
        .where('id', '=', preorderId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        preorder: updatedPreorder,
        saleId,
        docNo,
        total,
        settledDeposit: appliedDeposit,
        balanceDue,
      };
    });
  }
}
