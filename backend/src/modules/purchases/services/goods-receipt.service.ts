import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, Selectable, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database, GoodsReceiptLineTable, PurchaseOrderItemTable } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { CreateGoodsReceiptDto, CreateGrnBillDto, VerifyThreeWayMatchDto } from '../dto/goods-receipt.dto';
import { computeThreeWayMatch, ThreeWayMatchInput } from '../three-way-match.engine';
import { applyStockDelta, lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { allocateGrnAccrual, allocateGrniBillPortion } from '../engines/grni-settlement.engine';
import { allocateLandedCosts } from '../engines/landed-cost-allocation.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, roundMoney, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { advancePurchaseOrderReceipt } from '../engines/purchase-order-receipt.engine';
import { normalizeBillNumber } from '../engines/duplicate-bill-detector.engine';
import { assertGrnRequestedLocationScope } from '../engines/grn-location-policy.engine';
import { stockMovementTotal } from '../../catalog/engines/stock-movement-total.engine';

@Injectable()
export class GoodsReceiptService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly purchasesFinance: PurchasesFinanceService,
  ) {}

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  /**
   * Resolve a system account by code, creating it when the tenant's chart lacks it.
   * The previous `if (account) { ...post... }` pattern silently skipped the whole journal when an
   * account was missing, while the stock side had already been written.
   */
  private async resolveAccountByCode(trx: any, tenantId: string, accountId: string, code: string): Promise<number | null> {
    const existing = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) {
      if (!existing.is_active) throw new UnprocessableEntityException(`الحساب المحاسبي ${code} معطل؛ يلزم تفعيله قبل الترحيل`);
      return Number(existing.id);
    }

    const known: Record<string, { ar: string; en: string; type: string; group: string; balance: string }> = {
      '2125': { ar: 'بضاعة مستلمة غير مفوترة', en: 'Goods Received Not Invoiced', type: 'liability', group: 'current_liabilities', balance: 'credit' },
      '1140': { ar: 'مخزون بضاعة ومواد خام', en: 'Inventory', type: 'asset', group: 'current_assets', balance: 'debit' },
      '5190': { ar: 'فروق أسعار مشتريات', en: 'Purchase Price Variance', type: 'expense', group: 'expenses', balance: 'debit' },
    };
    const spec = known[code];
    if (!spec) return null;

    const [created] = await trx
      .insertInto('accounting_accounts')
      .values({
        tenant_id: tenantId,
        account_id: accountId || tenantId,
        code,
        name_ar: spec.ar,
        name_en: spec.en,
        account_type: spec.type,
        account_group: spec.group,
        normal_balance: spec.balance,
        is_active: true,
        is_system: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .execute();
    return created ? Number(created.id) : null;
  }

  /*
   * INV-SHIPPING-ALLOCATION: freight on a receipt must be a
   * book-digits amount — a sub-minor amount fails closed instead of
   * rounding silently into the WAC. Absent freight is 0 and the
   * receipt posts exactly as before.
   */
  private validateGrnFreight(freight: number | undefined, moneyDigits: 2 | 3): number {
    if (freight == null || freight === 0) return 0;
    try {
      const minor = toMinorUnits(Number(freight), moneyDigits);
      if (minor <= 0) throw new Error('Non-positive');
      return fromMinorUnits(minor, moneyDigits);
    } catch {
      throw new BadRequestException('مبلغ الشحن لا يطابق دقة عملة الأساس.');
    }
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('يجب إدخال بند واحد على الأقل في إذن الاستلام.');
    }

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const freight = this.validateGrnFreight(dto.freight, moneyDigits);

    // Verify supplier exists
    const supplier = await (this.db as any)
      .selectFrom('suppliers')
      .select(['id', 'name'])
      .where('id', '=', dto.supplierId)
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!supplier) {
      throw new NotFoundException('المورد المحدد غير موجود.');
    }

    let locationId = Number(dto.locationId || 0);

    // Verify location exists in tenant or resolve fallback
    let location = locationId > 0
      ? await this.db.selectFrom('stock_locations').select(['id', 'name'])
          .where('id', '=', locationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst()
      : null;
    // Never silently reroute an explicitly requested warehouse. The old
    // fallback could create real stock and GRNI entries at the wrong location.
    assertGrnRequestedLocationScope(locationId, location);

    if (!location) {
      // 1. If PO is specified, check if the PO has a warehouse_id that belongs to tenant
      if (dto.purchaseOrderId) {
        const po = await this.db.selectFrom('purchase_orders').select(['warehouse_id'])
          .where('id', '=', dto.purchaseOrderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (po?.warehouse_id) {
          const poLoc = await this.db.selectFrom('stock_locations').select(['id', 'name'])
            .where('id', '=', Number(po.warehouse_id)).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
          if (poLoc) {
            location = poLoc;
            locationId = Number(poLoc.id);
          }
        }
      }

      // 2. If no location was requested and no PO warehouse was available,
      // auto-resolve tenant's default active location
      if (!location) {
        const defaultLoc = await this.db
          .selectFrom('stock_locations')
          .select(['id', 'name'])
          .where('tenant_id', '=', scope.tenantId)
          .where('is_active', '=', true)
          .orderBy('id', 'asc')
          .executeTakeFirst();

        if (!defaultLoc) {
          throw new NotFoundException('مكان الاستلام غير موجود في المنشأة ولا يوجد أي مخزن نشط.');
        }
        location = defaultLoc;
        locationId = Number(defaultLoc.id);
      }
    }
    const productIds = [...new Set(dto.lines.map((line) => Number(line.productId)))];
    if (productIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('أحد أصناف إذن الاستلام غير صالح.');
    }
    const products = await this.db.selectFrom('products').select('id')
      .where('id', 'in', productIds).where('tenant_id', '=', scope.tenantId).execute();
    if (products.length !== productIds.length) throw new NotFoundException('أحد أصناف إذن الاستلام لا يتبع المنشأة.');
    if (!dto.purchaseOrderId && dto.lines.some((line) => line.purchaseOrderItemId)) {
      throw new BadRequestException('يلزم تحديد أمر الشراء عند ربط أحد بنوده بإذن الاستلام.');
    }
    if (dto.purchaseOrderId && dto.lines.some((line) => Number(line.acceptedQty) > 0 && !line.purchaseOrderItemId)) {
      throw new BadRequestException('اربط كل كمية مقبولة ببند أمر الشراء حتى يمكن فوترتها وتسوية GRNI.');
    }
    const quarantineIds = [...new Set(dto.lines.map((line) => Number(line.quarantineLocationId || 0)).filter((id) => id > 0))];
    if (quarantineIds.length) {
      const quarantineLocations = await this.db.selectFrom('stock_locations').select('id')
        .where('id', 'in', quarantineIds).where('tenant_id', '=', scope.tenantId).execute();
      if (quarantineLocations.length !== quarantineIds.length) throw new NotFoundException('مكان الحجر لا يتبع المنشأة.');
    }
    if (dto.purchaseOrderId) {
      const order = await this.db.selectFrom('purchase_orders').select(['id', 'supplier_id', 'status'])
        .where('id', '=', dto.purchaseOrderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
      if (!order || Number(order.supplier_id) !== Number(dto.supplierId)) {
        throw new BadRequestException('أمر الشراء لا يتبع المورد المحدد في المنشأة.');
      }
      // INV-SPIRIT-GRN-PENDING-REVIEW: a draft (unapproved) order may
      // receive as a pending-review receipt — the draft is recorded at
      // post time and billing stays blocked until the order is
      // approved. Only a cancelled order (a deliberate stop) still
      // blocks receipt creation.
      if (!['draft', 'confirmed', 'partially_received', 'received', 'converted_to_bill'].includes(String(order.status))) {
        throw new BadRequestException('لا يجوز الاستلام على أمر شراء ملغي أو غير معتمد');
      }
      const orderItemIds = [...new Set(dto.lines.map((line) => Number(line.purchaseOrderItemId || 0)).filter((id) => id > 0))];
      if (orderItemIds.length) {
        const orderItems = await this.db.selectFrom('purchase_order_items').select(['id', 'product_id'])
          .where('id', 'in', orderItemIds).where('purchase_order_id', '=', order.id)
          .where('tenant_id', '=', scope.tenantId).execute();
        const byId = new Map(orderItems.map((item) => [Number(item.id), Number(item.product_id)]));
        if (dto.lines.some((line) => line.purchaseOrderItemId && byId.get(Number(line.purchaseOrderItemId)) !== Number(line.productId))) {
          throw new BadRequestException('بند أمر الشراء لا يطابق الصنف المستلم.');
        }
      }
    }

    return await this.db.transaction().execute(async (trx: any) => {
      const [grn] = await trx
        .insertInto('goods_receipt_notes')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId || scope.tenantId,
          doc_no: `GRN-TMP-${randomUUID()}`,
          purchase_order_id: dto.purchaseOrderId || null,
          supplier_id: dto.supplierId,
          location_id: locationId,
          received_at: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
          received_by: auth.userId,
          supplier_delivery_note_ref: dto.supplierDeliveryNoteRef || null,
          freight_amount: freight,
          status: 'draft',
          notes: dto.notes || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .execute();

      // The generated row id is unique across concurrent receipts; COUNT(*) + 1 is not.
      await trx.updateTable('goods_receipt_notes')
        .set({ doc_no: formatDailyDocumentNumber('GRN', Number(grn.id)) })
        .where('id', '=', Number(grn.id))
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      const lineValues = dto.lines.map((l) => {
        const received = Number(l.receivedQty || 0);
        const accepted = Number(l.acceptedQty || 0);
        const rejected = Number(l.rejectedQty || 0);

        if (Math.abs(received - (accepted + rejected)) > 0.001) {
          throw new BadRequestException(`إجمالي الكمية المستلمة (${received}) يجب أن يساوي المقبول (${accepted}) + المرفوض (${rejected}).`);
        }

        return {
          tenant_id: scope.tenantId,
          grn_id: Number(grn.id),
          purchase_order_item_id: l.purchaseOrderItemId || null,
          product_id: l.productId,
          ordered_qty: Number(l.orderedQty || 0),
          received_qty: received,
          accepted_qty: accepted,
          rejected_qty: rejected,
          rejection_reason: l.rejectionReason || null,
          batch_number: l.batchNumber || null,
          expiry_date: l.expiryDate ? new Date(l.expiryDate) : null,
          manufacturing_date: l.manufacturingDate ? new Date(l.manufacturingDate) : null,
          unit_cost: Number(l.unitCost || 0),
          quarantine_location_id: l.quarantineLocationId || null,
          coa_document_id: l.coaDocumentId || null,
          notes: l.notes || null,
          created_at: new Date(),
        };
      });

      await trx.insertInto('goods_receipt_lines').values(lineValues).execute();

      return this.getGoodsReceipt(Number(grn.id), auth, trx);
    });
  }

  async listGoodsReceipts(filter: { supplierId?: number; status?: string; search?: string }, auth: AuthContext): Promise<any> {
    let query = (this.db as any)
      .selectFrom('goods_receipt_notes as g')
      .leftJoin('suppliers as s', (join: any) => join.onRef('s.id', '=', 'g.supplier_id').onRef('s.tenant_id', '=', 'g.tenant_id'))
      .leftJoin('purchase_orders as po', (join: any) => join.onRef('po.id', '=', 'g.purchase_order_id').onRef('po.tenant_id', '=', 'g.tenant_id'))
      .where(this.tenantPredicate(auth, 'g'))
      .select([
        'g.id',
        'g.doc_no',
        'g.purchase_order_id',
        'po.order_number as po_doc_no',
        'g.supplier_id',
        's.name as supplier_name',
        'g.location_id',
        'g.received_at',
        'g.status',
        'g.pending_review',
        'g.pending_review_reason',
        'g.supplier_delivery_note_ref',
        'g.grni_journal_entry_id',
        'g.created_at',
      ])
      .orderBy('g.id', 'desc');

    if (filter.supplierId) {
      query = query.where('g.supplier_id', '=', filter.supplierId);
    }
    if (filter.status) {
      query = query.where('g.status', '=', filter.status);
    }
    if (filter.search) {
      const term = `%${filter.search}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('g.doc_no', 'ilike', term),
          eb('s.name', 'ilike', term),
          eb('g.supplier_delivery_note_ref', 'ilike', term),
        ]),
      );
    }

    const rows = await query.execute();
    return rows.map((r: any) => ({
      id: Number(r.id),
      docNo: r.doc_no,
      purchaseOrderId: r.purchase_order_id ? Number(r.purchase_order_id) : null,
      poDocNo: r.po_doc_no || null,
      supplierId: Number(r.supplier_id),
      supplierName: r.supplier_name || 'مورد عام',
      locationId: Number(r.location_id),
      receivedAt: r.received_at,
      status: r.status,
      pendingReview: Boolean(r.pending_review),
      pendingReviewReason: r.pending_review_reason,
      supplierDeliveryNoteRef: r.supplier_delivery_note_ref,
      grniJournalEntryId: r.grni_journal_entry_id ? Number(r.grni_journal_entry_id) : null,
      createdAt: r.created_at,
    }));
  }

  async getGoodsReceipt(id: number, auth: AuthContext, externalTrx?: any): Promise<any> {
    const q = externalTrx || (this.db as any);

    const grn = await q
      .selectFrom('goods_receipt_notes as g')
      .leftJoin('suppliers as s', (join: any) => join.onRef('s.id', '=', 'g.supplier_id').onRef('s.tenant_id', '=', 'g.tenant_id'))
      .leftJoin('purchase_orders as po', (join: any) => join.onRef('po.id', '=', 'g.purchase_order_id').onRef('po.tenant_id', '=', 'g.tenant_id'))
      .where('g.id', '=', id)
      .where(this.tenantPredicate(auth, 'g'))
      .select([
        'g.id',
        'g.doc_no',
        'g.purchase_order_id',
        'po.order_number as po_doc_no',
        'g.supplier_id',
        's.name as supplier_name',
        'g.location_id',
        'g.received_at',
        'g.status',
        'g.pending_review',
        'g.pending_review_reason',
        'g.supplier_delivery_note_ref',
        'g.grni_journal_entry_id',
        'g.freight_amount',
        'g.notes',
        'g.created_at',
      ])
      .executeTakeFirst();

    if (!grn) {
      throw new NotFoundException(`إذن الاستلام رقم ${id} غير موجود.`);
    }

    const lines = await q
      .selectFrom('goods_receipt_lines as gl')
      .leftJoin('products as p', (join: any) => join.onRef('p.id', '=', 'gl.product_id').onRef('p.tenant_id', '=', 'gl.tenant_id'))
      .where('gl.grn_id', '=', id)
      .where(this.tenantPredicate(auth, 'gl'))
      .select([
        'gl.id',
        'gl.product_id',
        'p.name as product_name',
        'p.sku as product_sku',
        'gl.purchase_order_item_id',
        'gl.ordered_qty',
        'gl.received_qty',
        'gl.accepted_qty',
        'gl.rejected_qty',
        'gl.rejection_reason',
        'gl.over_received_qty',
        'gl.batch_number',
        'gl.expiry_date',
        'gl.manufacturing_date',
        'gl.unit_cost',
        'gl.allocated_landed_cost',
        'gl.landed_unit_cost',
        'gl.quarantine_location_id',
        'gl.coa_document_id',
        'gl.notes',
      ])
      .orderBy('gl.id', 'asc')
      .execute();

    return {
      id: Number(grn.id),
      docNo: grn.doc_no,
      purchaseOrderId: grn.purchase_order_id ? Number(grn.purchase_order_id) : null,
      poDocNo: grn.po_doc_no,
      supplierId: Number(grn.supplier_id),
      supplierName: grn.supplier_name,
      locationId: Number(grn.location_id),
      receivedAt: grn.received_at,
      status: grn.status,
      pendingReview: Boolean(grn.pending_review),
      pendingReviewReason: grn.pending_review_reason,
      supplierDeliveryNoteRef: grn.supplier_delivery_note_ref,
      grniJournalEntryId: grn.grni_journal_entry_id ? Number(grn.grni_journal_entry_id) : null,
      freightAmount: Number(grn.freight_amount || 0),
      notes: grn.notes,
      createdAt: grn.created_at,
      lines: lines.map((l: any) => ({
        id: Number(l.id),
        productId: Number(l.product_id),
        productName: l.product_name,
        productSku: l.product_sku,
        purchaseOrderItemId: l.purchase_order_item_id ? Number(l.purchase_order_item_id) : null,
        orderedQty: Number(l.ordered_qty || 0),
        receivedQty: Number(l.received_qty || 0),
        acceptedQty: Number(l.accepted_qty || 0),
        rejectedQty: Number(l.rejected_qty || 0),
        rejectionReason: l.rejection_reason,
        overReceivedQty: Number(l.over_received_qty || 0),
        batchNumber: l.batch_number,
        expiryDate: l.expiry_date,
        manufacturingDate: l.manufacturing_date,
        unitCost: Number(l.unit_cost || 0),
        allocatedLandedCost: Number(l.allocated_landed_cost || 0),
        landedUnitCost: l.landed_unit_cost != null ? Number(l.landed_unit_cost) : null,
        quarantineLocationId: l.quarantine_location_id ? Number(l.quarantine_location_id) : null,
        coaDocumentId: l.coa_document_id ? Number(l.coa_document_id) : null,
        notes: l.notes,
      })),
    };
  }

  async postGoodsReceipt(id: number, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    return await this.db.transaction().execute(async (trx: any) => {
      // Book precision for every amount in this flow. goods-receipt previously
      // used no moneyDigits at all — every site below was hard-coded to 2.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const receiptLink = await trx.selectFrom('goods_receipt_notes')
        .select('purchase_order_id')
        .where('id', '=', id).where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (!receiptLink) throw new NotFoundException(`إذن الاستلام رقم ${id} غير موجود.`);
      if (receiptLink.purchase_order_id) {
        const lockedOrder = await trx.selectFrom('purchase_orders').select(['id', 'status'])
          .where('id', '=', Number(receiptLink.purchase_order_id))
          .where('tenant_id', '=', scope.tenantId).forUpdate().executeTakeFirstOrThrow();
        // INV-SPIRIT-GRN-PENDING-REVIEW: a draft order posts as a
        // pending-review receipt (flagged below); only a cancelled
        // order blocks posting.
        if (!['draft', 'confirmed', 'partially_received', 'received', 'converted_to_bill'].includes(String(lockedOrder.status))) {
          throw new BadRequestException('تم رفض ترحيل الاستلام: أمر الشراء غير معتمد أو ملغي');
        }
      }
      // 1. Pessimistic lock on GRN header to prevent concurrent double-posting
      const grnRow = await trx
        .selectFrom('goods_receipt_notes')
        .selectAll()
        .where('id', '=', id)
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();

      if (!grnRow) {
        throw new NotFoundException(`إذن الاستلام رقم ${id} غير موجود.`);
      }
      if (Number(grnRow.purchase_order_id || 0) !== Number(receiptLink.purchase_order_id || 0)) {
        throw new BadRequestException('تغير ارتباط محضر الاستلام بأمر الشراء أثناء الترحيل.');
      }

      if (grnRow.status === 'posted') {
        throw new BadRequestException('تم ترحيل إذن الاستلام هذا مسبقاً.');
      }
      if (grnRow.status === 'cancelled') {
        throw new BadRequestException('لا يمكن ترحيل محضر استلام ملغى.');
      }
      const alreadyReceivedBill = await trx.selectFrom('purchases').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'posted')
        .where((eb: any) => eb.or([eb('lifecycle_status', 'is', null), eb('lifecycle_status', '!=', 'grn_bill')]))
        .where((eb: any) => eb.or([
          eb('grn_id', '=', id),
          ...(grnRow.purchase_order_id ? [eb('po_id', '=', Number(grnRow.purchase_order_id))] : []),
        ]))
        .limit(1).executeTakeFirst();
      if (alreadyReceivedBill) {
        throw new BadRequestException('فاتورة مرتبطة بهذا الاستلام رحّلت المخزون بالفعل؛ لا يجوز ترحيله مرتين.');
      }

      const grn = await this.getGoodsReceipt(id, auth, trx);
      await lockStockProducts(trx, { ...scope, productIds: grn.lines.map((line: any) => Number(line.productId)) });

      // INV-SHIPPING-ALLOCATION: freight on the receipt is allocated
      // to item cost at posting time by the same canonical allocator
      // the direct invoice uses (value proportion), so the WAC
      // reflects the true landed cost instead of the bare item cost.
      // Rejected quantities never carry freight: only accepted stock
      // is valued, and a receipt with no accepted value fails closed
      // instead of posting freight into nothing.
      const freight = this.validateGrnFreight(grn.freightAmount, moneyDigits);
      const acceptedLines = [...grn.lines]
        .sort((a, b) => Number(a.productId) - Number(b.productId))
        .filter((line: any) => Number(line.acceptedQty || 0) > 0);
      if (freight > 0 && !acceptedLines.some((line: any) => Number(line.acceptedQty || 0) * Number(line.unitCost || 0) > 0)) {
        throw new BadRequestException('الشحن يحتاج صنفاً مقبولاً واحداً على الأقل في إذن الاستلام؛ الكميات المرفوضة وحدها لا تحمل تكلفة وصول.');
      }
      const freightByLineId = new Map<number, number>();
      if (freight > 0) {
        const shares = allocateLandedCosts(
          freight,
          acceptedLines.map((line: any) => Math.max(0, Number(line.acceptedQty || 0) * Number(line.unitCost || 0))),
          moneyDigits,
        );
        acceptedLines.forEach((line: any, i: number) => freightByLineId.set(Number(line.id), shares[i]));
      }

      let totalGrniAmount = 0;

      // Stock movements must carry branch attribution like every other stock path does.
      const grnLocation = await trx
        .selectFrom('stock_locations')
        .select('branch_id')
        .where('id', '=', grn.locationId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const grnBranchId = grnLocation?.branch_id != null ? Number(grnLocation.branch_id) : null;

      // 2. Update physical inventory for accepted quantities & write audit movements
      for (const line of [...grn.lines].sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const accepted = Number(line.acceptedQty || 0);
        if (accepted > 0) {
          const lineUnitCost = Number(line.unitCost || 0);
          if (!Number.isFinite(lineUnitCost) || lineUnitCost <= 0 || roundMoney(accepted * lineUnitCost, moneyDigits) <= 0) {
            throw new BadRequestException(`لا يمكن ترحيل استلام الصنف ${line.productId} بدون تكلفة مالية صالحة.`);
          }
          // INV-SHIPPING-ALLOCATION: this line's share of the receipt
          // freight, by value. The landed line total is the bare line
          // total at book digits plus the share, so the GRNI journal
          // below (the sum of these totals) can never diverge from
          // the stored movement totals by rounding.
          const allocatedFreight = freightByLineId.get(Number(line.id)) || 0;
          const landedUnitCost = allocatedFreight > 0
            ? Number((lineUnitCost + allocatedFreight / accepted).toFixed(6))
            : lineUnitCost;
          const landedLineTotal = stockMovementTotal(accepted, lineUnitCost, moneyDigits) + allocatedFreight;
          totalGrniAmount += landedLineTotal;

          // Route stock through the shared ledger helper instead of writing the two balance tables
          // by hand. Doing it by hand skipped the canonical lock order (products BEFORE
          // product_location_stock), which deadlocked against concurrent sales, and produced
          // stock_movements rows whose before/after balances were hardcoded 0 / accepted.
          const stockChange = await applyStockDelta(trx, {
            productId: Number(line.productId),
            delta: accepted,
            branchId: grnBranchId,
            locationId: grn.locationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId || scope.tenantId,
            allowNegative: true, // a receipt only adds; never reject it on a negative-stock rule
          });

          // Moving average cost on receipt. Without this, goods arriving at a new price never
          // updated products.cost_price, so COGS kept using a stale cost indefinitely.
          // INV-WAC-SINGLE-WRITER: the one writer blends the receipt
          // through the canonical engine. accepted > 0 and lineUnitCost
          // > 0 are enforced above; the engine never returns a negative
          // cost, so the old non-negativity guard is subsumed. The
          // product row is locked by the stock delta above, so the
          // writer's read cannot miss it.
          // INV-SHIPPING-ALLOCATION: freight carried on the receipt
          // blends into the receipt value, so the WAC reflects the true
          // landed cost instead of the bare item cost — the same blend
          // the direct invoice performs at its own receipt.
          await valueStockReceipt(trx, scope.tenantId, Number(line.productId), stockChange.globalAfter, accepted, accepted * landedUnitCost);

          // INV-SHIPPING-ALLOCATION: the landed line total is the proof
          // the freight reached this line; unit_cost stays the net item
          // cost on the pharmacy batch below, exactly as the
          // post-posting step leaves it.
          if (allocatedFreight > 0) {
            await trx.updateTable('goods_receipt_lines').set({
              allocated_landed_cost: allocatedFreight,
              landed_unit_cost: landedUnitCost,
            }).where('id', '=', Number(line.id)).where('tenant_id', '=', scope.tenantId).execute();
          }

          // Record formal stock movement with the real running balances.
          await trx
            .insertInto('stock_movements')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId || scope.tenantId,
              product_id: line.productId,
              movement_type: 'goods_receipt',
              qty: accepted,
              before_qty: stockChange.scopeBefore,
              after_qty: stockChange.scopeAfter,
              unit_cost: landedUnitCost,
              // INV-GRN-JOURNAL-CENTRAL-POSTING: the stored movement total
              // is the single book-digits computation (stockMovementTotal
              // plus the line's allocated freight), so it can never
              // diverge from the posted GRNI leg by rounding. The old
              // toFixed(4) stored 100.125 for a 2dp tenant while the
              // journal leg rounded to 100.13.
              total_cost: landedLineTotal,
              reason: 'goods_receipt',
              note: `إذن استلام مخزني GRN - ${grn.docNo}`,
              reference_type: 'goods_receipt',
              reference_id: grn.id,
              branch_id: grnBranchId,
              location_id: grn.locationId,
              created_by: auth.userId,
            })
            .execute();

          const drug = await trx.selectFrom('pharmacy_drugs').select('id')
            .where('tenant_id', '=', scope.tenantId).where('product_id', '=', Number(line.productId))
            .executeTakeFirst();
          const batchNumber = String(line.batchNumber || '').trim();
          const rawExpiry = line.expiryDate;
          const expiryDate = rawExpiry ? (rawExpiry instanceof Date
            ? rawExpiry.toISOString().slice(0, 10) : String(rawExpiry).slice(0, 10)) : '';
          if (drug && (!batchNumber || !expiryDate)) {
            throw new UnprocessableEntityException('محضر استلام الدواء يتطلب رقم التشغيلة وتاريخ الصلاحية');
          }
          if (batchNumber) {
            const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
            if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(expiryDate) ||
              (expiryDate.length === 7 ? expiryDate < today.slice(0, 7) : expiryDate < today)) {
              throw new UnprocessableEntityException('لا يمكن ترحيل تشغيلة منتهية أو بتاريخ صلاحية غير صالح');
            }
            const existingBatch = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'expiry_date'])
              .where('tenant_id', '=', scope.tenantId).where('product_id', '=', Number(line.productId))
              .where('location_id', '=', grn.locationId).where('batch_number', '=', batchNumber)
              .forUpdate().executeTakeFirst();
            if (existingBatch) {
              if (String(existingBatch.expiry_date).slice(0, 10) !== expiryDate) {
                throw new UnprocessableEntityException('تاريخ صلاحية التشغيلة المسجلة لا يطابق محضر الاستلام');
              }
              await trx.updateTable('pharmacy_batches').set({
                quantity: Number((Number(existingBatch.quantity) + accepted).toFixed(3)),
                expiry_date: expiryDate, unit_cost: lineUnitCost, status: 'active', updated_at: sql`NOW()`,
              }).where('tenant_id', '=', scope.tenantId).where('id', '=', Number(existingBatch.id)).execute();
            } else {
              await trx.insertInto('pharmacy_batches').values({
                tenant_id: scope.tenantId, account_id: scope.accountId,
                product_id: Number(line.productId), drug_id: drug?.id || null,
                batch_number: batchNumber, expiry_date: expiryDate, quantity: accepted,
                unit_cost: lineUnitCost, location_id: grn.locationId,
                supplier_name: grn.supplierName || null, status: 'active', notes: `وارد ${grn.docNo}`,
              }).execute();
            }
          }
        }
      }

      // INV-SPIRIT-GRN-PENDING-REVIEW: reflect this receipt on its
      // purchase order in the same transaction, after every stock write
      // above succeeded, so a failed receipt advances nothing. Rejected
      // quantities never advance: only accepted stock counts as received.
      // Over-receipt is measured against the ordered quantity still
      // unreceived BEFORE this receipt advances it, in GRN line order,
      // so a second line for the same PO item only counts the part past
      // what the first line already filled. A draft order advances its
      // received quantities but keeps status 'draft' — receiving must
      // not approve the order by side effect.
      let pendingReview = false;
      let pendingReviewReason: string | null = null;
      if (grn.purchaseOrderId) {
        const poRow = await trx.selectFrom('purchase_orders').select(['status'])
          .where('id', '=', Number(grn.purchaseOrderId))
          .where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        const poUnapproved = String(poRow?.status || '') === 'draft';
        const poItemStates = await trx.selectFrom('purchase_order_items')
          .select(['id', 'quantity', 'received_quantity'])
          .where('purchase_order_id', '=', Number(grn.purchaseOrderId))
          .where('tenant_id', '=', scope.tenantId)
          .forUpdate().execute();
        const remainingByItem = new Map<number, number>();
        for (const item of poItemStates) {
          remainingByItem.set(Number(item.id), Math.max(0, Number(item.quantity || 0) - Number(item.received_quantity || 0)));
        }
        const overReceivedByLineId = new Map<number, number>();
        for (const line of grn.lines) {
          const poItemId = line.purchaseOrderItemId ? Number(line.purchaseOrderItemId) : 0;
          const accepted = Number(line.acceptedQty || 0);
          if (poItemId > 0 && accepted > 0 && remainingByItem.has(poItemId)) {
            const remaining = remainingByItem.get(poItemId) || 0;
            const excess = Math.max(0, Number((accepted - remaining).toFixed(3)));
            if (excess > 0) overReceivedByLineId.set(Number(line.id), excess);
            remainingByItem.set(poItemId, Math.max(0, Number((remaining - accepted).toFixed(3))));
          }
        }
        const receivedByItem = new Map<number, number>();
        for (const line of grn.lines) {
          const accepted = Number(line.acceptedQty || 0);
          const poItemId = line.purchaseOrderItemId ? Number(line.purchaseOrderItemId) : 0;
          if (accepted > 0 && poItemId > 0) {
            receivedByItem.set(poItemId, Number(((receivedByItem.get(poItemId) || 0) + accepted).toFixed(3)));
          }
        }
        if (receivedByItem.size > 0) {
          await advancePurchaseOrderReceipt(
            trx,
            scope.tenantId,
            Number(grn.purchaseOrderId),
            [...receivedByItem.entries()].map(([poItemId, quantity]) => ({ poItemId, quantity })),
            { allowUnapproved: true },
          );
        }
        for (const [lineId, excess] of overReceivedByLineId) {
          await trx.updateTable('goods_receipt_lines')
            .set({ over_received_qty: excess })
            .where('id', '=', lineId)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }
        const reasonParts: string[] = [];
        if (poUnapproved) reasonParts.push('أمر الشراء غير معتمد بعد');
        if (overReceivedByLineId.size > 0) reasonParts.push('كمية مستلمة زائدة عن الكمية المطلوبة في أمر الشراء');
        pendingReview = reasonParts.length > 0;
        pendingReviewReason = pendingReview ? `استلام قيد المراجعة: ${reasonParts.join('؛ ')}` : null;
      }

      // 3. Generate GRNI Journal Entry (Dr. Inventory Asset 1140 / Cr. GRNI 2125)
      let grniEntryId: number | null = null;
      if (totalGrniAmount > 0 && roundMoney(totalGrniAmount, moneyDigits) <= 0) {
        throw new BadRequestException('تكلفة البضاعة المستلمة أقل من أصغر وحدة نقدية؛ تعذر إنشاء قيد المخزون.');
      }
      if (totalGrniAmount > 0) {
        const entryDate = grn.receivedAt ? new Date(grn.receivedAt) : new Date();

        const grniAccount = await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '2125');
        const invAccount = await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '1140');

        // Never skip the journal silently. Stock has already been increased above; posting the GRN
        // without its GRNI liability would leave the books short by the full receipt value with no
        // error and no trace.
        if (!grniAccount || !invAccount) {
          throw new BadRequestException(
            'تعذر ترحيل إذن الاستلام: حساب استحقاق البضاعة المستلمة (2125) أو حساب المخزون (1140) غير متاح في شجرة الحسابات.',
          );
        }

        const grniAmount = roundMoney(totalGrniAmount, moneyDigits);

        // INV-GRN-JOURNAL-CENTRAL-POSTING: the GRNI journal posts only
        // through the central boundary on this same transaction. The
        // boundary stamps posted_by/posted_at, numbers the entry JE-<id>,
        // re-rounds both legs at book digits, validates branch/location/
        // partner references against this tenant, and asserts the period
        // is open — the old direct inserts carried none of that, and
        // branch/location reporting missed every GRN journal. The
        // pre-resolved accounts above are kept: resolveAccountByCode
        // creates 1140/2125 when the tenant's chart lacks them, and the
        // boundary would fail closed instead. Double-posting is still
        // guarded by the GRN row lock + posted-status check above;
        // 'goods_receipt' is not a dedup-key source in the boundary.
        grniEntryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'goods_receipt',
          sourceId: grn.id,
          tenantId: scope.tenantId,
          accountId: scope.accountId || scope.tenantId,
          entryDate,
          description: `إثبات استلام بضاعة مخزنية GRNI - إذن رقم ${grn.docNo}`,
          branchId: grnBranchId,
          locationId: grn.locationId,
          createdBy: auth.userId,
          postedBy: auth.userId,
          lines: [
            {
              accountId: Number(invAccount),
              description: `إضافة مخزون مستلم - ${grn.docNo}`,
              debit: grniAmount,
              credit: 0,
              // Inventory is not a supplier sub-ledger account. Tagging it with the supplier
              // polluted supplier statements and aging with inventory debits.
              partnerType: 'none',
              partnerId: null,
              branchId: grnBranchId,
              locationId: grn.locationId,
            },
            {
              accountId: Number(grniAccount),
              description: `استحقاق بضاعة مستلمة غير مفوترة GRNI - ${grn.docNo}`,
              debit: 0,
              credit: grniAmount,
              // postPurchase convention: a supplier partner only when the
              // document carries a real supplier id; a supplier-less
              // receipt posts the liability untagged instead of failing
              // the boundary's partner validation on id 0.
              partnerType: Number(grn.supplierId) > 0 ? 'supplier' : 'none',
              partnerId: Number(grn.supplierId) > 0 ? Number(grn.supplierId) : null,
              branchId: grnBranchId,
              locationId: grn.locationId,
            },
          ],
        });
      }

      await trx
        .updateTable('goods_receipt_notes')
        .set({
          status: 'posted',
          pending_review: pendingReview,
          pending_review_reason: pendingReviewReason,
          grni_journal_entry_id: grniEntryId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where(this.tenantPredicate(auth))
        .execute();

      return {
        success: true,
        grnId: id,
        docNo: grn.docNo,
        status: 'posted',
        pendingReview,
        pendingReviewReason,
        grniJournalEntryId: grniEntryId,
        totalGrniAmount: roundMoney(totalGrniAmount, moneyDigits),
        freightAmount: freight,
      };
    });
  }

  /** Invoice previously posted receipts without adding physical stock a second time. */
  async createBillFromReceipts(dto: CreateGrnBillDto, auth: AuthContext): Promise<{ purchaseId: number; docNo: string }> {
    const scope = requireTenantScope(auth);
    const invoiceNo = normalizeBillNumber(dto.supplierInvoiceNo);
    if (!invoiceNo || !Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('حدد رقم فاتورة المورد وبنود محاضر الاستلام');
    }
    const requestedIds = dto.lines.map((line) => Number(line.grnLineId));
    if (new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('لا يجوز تكرار سطر محضر الاستلام في الفاتورة');
    }
    return this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const po = await trx.selectFrom('purchase_orders').select(['id', 'supplier_id', 'status'])
        .where('id', '=', dto.purchaseOrderId).where('tenant_id', '=', scope.tenantId)
        .forUpdate().executeTakeFirst();
      if (!po || Number(po.supplier_id) !== Number(dto.supplierId)) {
        throw new BadRequestException('أمر الشراء لا يتبع المورد والمنشأة المحددين');
      }
      // INV-SPIRIT-GRN-PENDING-REVIEW: supplier billing stays pending
      // until the order is approved. A pending-review receipt already
      // posted its stock and GRNI journal; invoicing it would settle
      // the liability against an order nobody approved.
      if (String(po.status) === 'draft') {
        throw new UnprocessableEntityException('لا يمكن فوترة محضر استلام قيد المراجعة: أمر الشراء غير معتمد بعد');
      }
      const supplier = await trx.selectFrom('suppliers').select('id')
        .where('id', '=', dto.supplierId).where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true).forUpdate().executeTakeFirst();
      if (!supplier) throw new NotFoundException('المورد غير موجود أو غير نشط');
      const existingInvoices = await trx.selectFrom('purchases').select(['id', 'supplier_invoice_no'])
        .where('tenant_id', '=', scope.tenantId).where('supplier_id', '=', dto.supplierId)
        .where('status', '!=', 'cancelled').where('supplier_invoice_no', 'is not', null).execute();
      if (existingInvoices.some((bill) => normalizeBillNumber(bill.supplier_invoice_no) === invoiceNo)) {
        throw new UnprocessableEntityException('رقم فاتورة المورد مسجل بالفعل لهذا المورد.');
      }
      const directBill = await trx.selectFrom('purchases').select('id')
        .where('tenant_id', '=', scope.tenantId).where('po_id', '=', dto.purchaseOrderId)
        .where('status', '!=', 'cancelled')
        .where((eb) => eb.or([eb('lifecycle_status', 'is', null), eb('lifecycle_status', '!=', 'grn_bill')]))
        .limit(1).executeTakeFirst();
      if (directBill) throw new UnprocessableEntityException('أمر الشراء مرتبط بفاتورة مباشرة سابقة؛ ألغِ المسودة أو سوِّ الفاتورة المنشورة قبل فواتير GRN');

      const references = await trx.selectFrom('goods_receipt_lines').select(['id', 'grn_id'])
        .where('tenant_id', '=', scope.tenantId).where('id', 'in', requestedIds).execute();
      if (references.length !== requestedIds.length) throw new NotFoundException('أحد سطور الاستلام غير موجود');
      const grnIds = [...new Set(references.map((line) => Number(line.grn_id)))].sort((a, b) => a - b);
      const headers = await trx.selectFrom('goods_receipt_notes').selectAll()
        .where('tenant_id', '=', scope.tenantId).where('id', 'in', grnIds)
        .orderBy('id', 'asc').forUpdate().execute();
      if (headers.length !== grnIds.length || headers.some((header) => header.status !== 'posted' ||
        Number(header.supplier_id) !== Number(dto.supplierId) || Number(header.purchase_order_id) !== Number(dto.purchaseOrderId) ||
        !header.grni_journal_entry_id)) {
        throw new UnprocessableEntityException('كل محاضر الاستلام يجب أن تكون منشورة وعلى نفس أمر الشراء والمورد ولها قيد GRNI');
      }
      const receiptLines = await trx.selectFrom('goods_receipt_lines').selectAll()
        .where('tenant_id', '=', scope.tenantId).where('grn_id', 'in', grnIds)
        .orderBy('id', 'asc').forUpdate().execute();
      const receiptLineById = new Map(receiptLines.map((line) => [Number(line.id), line]));
      const accrualByLine = new Map<number, number>();
      for (const grnId of grnIds) {
        const portions = allocateGrnAccrual(receiptLines.filter((line) => Number(line.grn_id) === grnId)
          .map((line) => {
            // INV-SHIPPING-ALLOCATION: a receipt line that carried
            // freight settles at its landed total (bare line total at
            // book digits + allocated freight), so the bill clears the
            // full GRNI journal — including the freight — instead of
            // stranding it in 2125.
            const acceptedQty = Number(line.accepted_qty);
            const allocated = Number((line as any).allocated_landed_cost || 0);
            return {
              id: Number(line.id),
              acceptedQty,
              unitCost: Number(line.unit_cost),
              ...(allocated > 0
                ? { landedLineTotal: roundMoney(acceptedQty * Number(line.unit_cost), moneyDigits) + allocated }
                : {}),
            };
          }), moneyDigits);
        for (const [lineId, minor] of portions) accrualByLine.set(lineId, minor);
      }
      const poItems = await trx.selectFrom('purchase_order_items').select(['id', 'product_id', 'product_name', 'unit_name', 'unit_cost'])
        .where('tenant_id', '=', scope.tenantId).where('purchase_order_id', '=', dto.purchaseOrderId).execute();
      const poItemById = new Map(poItems.map((item) => [Number(item.id), item]));
      const toleranceSetting = await trx.selectFrom('settings').select('value')
        .where('tenant_id', '=', scope.tenantId).where('key', '=', 'purchaseThreeWayTolerancePercent').executeTakeFirst();
      let tolerancePercent = 2;
      if (toleranceSetting) {
        try { tolerancePercent = Number(JSON.parse(toleranceSetting.value)); }
        catch { tolerancePercent = Number(toleranceSetting.value); }
      }
      if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
        throw new UnprocessableEntityException('نسبة تسامح المطابقة في إعدادات المنشأة غير صالحة');
      }
      const history = await trx.selectFrom('purchase_items as pi')
        .innerJoin('purchases as p', (join) => join.onRef('p.id', '=', 'pi.purchase_id').onRef('p.tenant_id', '=', 'pi.tenant_id'))
        .select(['pi.grn_line_id', 'pi.qty', 'pi.grni_amount'])
        .where('pi.tenant_id', '=', scope.tenantId).where('pi.grn_line_id', 'in', requestedIds)
        .where('p.status', '!=', 'cancelled').execute();
      const previous = new Map<number, { qty: number; minor: number }>();
      for (const line of history) {
        if (line.grni_amount == null) throw new UnprocessableEntityException('فاتورة قديمة مرتبطة بالاستلام تحتاج تسوية GRNI قبل إصدار فاتورة أخرى');
        const id = Number(line.grn_line_id);
        const value = previous.get(id) || { qty: 0, minor: 0 };
        value.qty += Number(line.qty);
        // Stored grni_amount values are exact minor-unit multiples (post-fix)
        // or legacy 2dp values; the strict conversion fails closed on anything
        // else instead of silently re-basing the cleared total.
        value.minor += toMinorUnits(Number(line.grni_amount), moneyDigits);
        previous.set(id, value);
      }
      const prepared = dto.lines.map((request) => {
        const receipt = receiptLineById.get(Number(request.grnLineId));
        const poItem = receipt?.purchase_order_item_id ? poItemById.get(Number(receipt.purchase_order_item_id)) : undefined;
        const qty = Number(request.qty);
        const unitCost = Number(request.unitCost);
        if (!receipt || !poItem || Number(poItem.product_id) !== Number(receipt.product_id) ||
          !Number.isFinite(qty) || qty <= 0 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001 ||
          !Number.isFinite(unitCost) || unitCost <= 0) {
          throw new UnprocessableEntityException('سطر الفاتورة لا يطابق صنف ومحضر وأمر الشراء أو كمية/تكلفة صحيحة');
        }
        const orderedCost = Number(poItem.unit_cost);
        if (!Number.isFinite(orderedCost) || orderedCost <= 0 ||
          unitCost > orderedCost * (1 + tolerancePercent / 100) + 0.000001) {
          throw new UnprocessableEntityException('سعر فاتورة المورد يتجاوز السعر المتفق عليه ونسبة التسامح؛ يتطلب اعتماد فرق السعر قبل الترحيل');
        }
        const prior = previous.get(Number(receipt.id)) || { qty: 0, minor: 0 };
        const accruedMinor = allocateGrniBillPortion({
          lineAccrualMinor: accrualByLine.get(Number(receipt.id)) || 0,
          acceptedQty: Number(receipt.accepted_qty), previouslyBilledQty: prior.qty,
          previouslyClearedMinor: prior.minor, newQty: qty,
        });
        return { receipt, poItem, qty, unitCost, grniAmount: fromMinorUnits(accruedMinor, moneyDigits),
          lineTotal: roundMoney(qty * unitCost, moneyDigits) };
      });
      const subtotal = roundMoney(prepared.reduce((sum, line) => sum + line.lineTotal, 0), moneyDigits);
      const taxAmount = Number(dto.taxAmount || 0);
      if (subtotal <= 0 || !Number.isFinite(taxAmount) || taxAmount < 0 ||
        Math.abs(taxAmount - roundMoney(taxAmount, moneyDigits)) > 0.000000001) {
        throw new UnprocessableEntityException('قيمة الفاتورة أو الضريبة غير صالحة');
      }
      const total = roundMoney(subtotal + taxAmount, moneyDigits);
      const firstHeader = headers[0];
      const inserted = await trx.insertInto('purchases').values({
        doc_no: 'TMP', supplier_id: dto.supplierId, payment_type: 'credit', subtotal,
        discount: 0, tax_rate: 0, tax_amount: taxAmount, prices_include_tax: false, total,
        note: `فاتورة محاضر استلام ${grnIds.join(', ')}`, status: 'posted',
        lifecycle_status: 'grn_bill', matched_status: 'matched', three_way_match_status: 'matched',
        po_id: dto.purchaseOrderId, grn_id: grnIds.length === 1 ? grnIds[0] : null,
        supplier_invoice_no: invoiceNo, branch_id: null, location_id: grnIds.length === 1 ? Number(firstHeader.location_id) : null,
        created_by: auth.userId, cancelled_at: null, cancelled_by: null, required_date: null,
        contact_id: null, shipping_address_id: null, cost_center_id: null, project_id: null,
        tenant_id: scope.tenantId, account_id: scope.accountId,
      }).returning('id').executeTakeFirstOrThrow();
      const purchaseId = Number(inserted.id);
      const docNo = formatDailyDocumentNumber('ZP', purchaseId, new Date(), 6);
      await trx.updateTable('purchases').set({ doc_no: docNo })
        .where('tenant_id', '=', scope.tenantId).where('id', '=', purchaseId).execute();
      for (const line of prepared) {
        await trx.insertInto('purchase_items').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, purchase_id: purchaseId,
          po_item_id: Number(line.poItem.id), grn_line_id: Number(line.receipt.id), grni_amount: line.grniAmount,
          product_id: Number(line.receipt.product_id), product_name: line.poItem.product_name,
          qty: line.qty, unit_cost: line.unitCost, line_total: line.lineTotal,
          unit_name: line.poItem.unit_name || 'قطعة', unit_multiplier: 1,
          category_id: null, location_id: Number(headers.find((header) => Number(header.id) === Number(line.receipt.grn_id))!.location_id),
          received_qty: line.qty,
        }).execute();
      }
      await this.purchasesFinance.addSupplierLedgerEntry(trx, dto.supplierId, total, 'purchase_credit',
        `فاتورة شراء من محاضر استلام ${docNo}`, 'purchase', purchaseId, auth, null,
        grnIds.length === 1 ? Number(firstHeader.location_id) : null);
      await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '5190');
      await this.accountingPosting.postPurchase(trx, purchaseId, auth);
      return { purchaseId, docNo };
    });
  }

  async verifyPurchaseThreeWayMatch(purchaseId: number, dto: VerifyThreeWayMatchDto, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    const matchResult = await this.db.transaction().execute(async (trx) => {
    const purchase = await trx
      .selectFrom('purchases')
      .where('id', '=', purchaseId)
      .where('tenant_id', '=', scope.tenantId)
      .selectAll()
      .forUpdate()
      .executeTakeFirst();

    if (!purchase) {
      throw new NotFoundException(`فاتورة المشتريات رقم ${purchaseId} غير موجودة.`);
    }
    if (purchase.status === 'cancelled') {
      throw new BadRequestException('لا يمكن اعتماد مطابقة فاتورة مشتريات ملغاة.');
    }
    if (dto.allowOverride && (!purchase.created_by || Number(purchase.created_by) === Number(auth.userId))) {
      throw new BadRequestException('يجب أن يعتمد تجاوز المطابقة مستخدم غير منشئ الفاتورة ومعروف الهوية.');
    }
    const configuredTolerance = await trx.selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', scope.tenantId)
      .where('key', '=', 'purchaseThreeWayTolerancePercent')
      .executeTakeFirst();
    let tolerance = 2;
    if (configuredTolerance) {
      try {
        tolerance = Number(JSON.parse(configuredTolerance.value));
      } catch {
        tolerance = Number(configuredTolerance.value);
      }
    }
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
      throw new BadRequestException('نسبة التسامح المسجلة للمنشأة غير صالحة.');
    }
    if (dto.tolerancePercentage !== undefined && dto.tolerancePercentage > tolerance) {
      throw new BadRequestException('لا يجوز رفع نسبة التسامح التعاقدية من طلب الاعتماد.');
    }
    const linkedPoId = purchase.po_id ? Number(purchase.po_id) : null;
    if (!linkedPoId && !purchase.grn_id) {
      throw new BadRequestException('المطابقة الثلاثية مخصصة للفواتير المرتبطة بأمر شراء أو محضر استلام.');
    }
    if (linkedPoId) {
      const order = await trx.selectFrom('purchase_orders')
        .select(['id', 'supplier_id'])
        .where('id', '=', linkedPoId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!order || Number(order.supplier_id) !== Number(purchase.supplier_id)) {
        throw new BadRequestException('أمر الشراء لا يتبع المورد المحدد في الفاتورة.');
      }
    }

    const purchaseItems = await trx
      .selectFrom('purchase_items')
      .where('purchase_id', '=', purchaseId)
      .where('tenant_id', '=', scope.tenantId)
      .selectAll()
      .execute();

    const products = await trx.selectFrom('products')
      .select(['id', 'item_type'])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', purchaseItems.map((item) => Number(item.product_id)))
      .execute();
    const productTypes = new Map(products.map((product) => [Number(product.id), product.item_type]));
    if (purchaseItems.some((item) => !productTypes.has(Number(item.product_id)))) {
      throw new BadRequestException('أحد أصناف الفاتورة غير موجود في المنشأة.');
    }
    const allServices = purchaseItems.length > 0 && purchaseItems.every((item) => productTypes.get(Number(item.product_id)) === 'service');
    if (dto.isServiceItem && !allServices) {
      throw new BadRequestException('لا يمكن تجاوز الاستلام المخزني لصنف غير خدمي.');
    }

    // Fetch PO items if purchase is linked to a PO.
    // purchases.po_id is added by migration 113; before it existed this was always undefined and the
    // price-variance leg of the match could never fire.
    let poItems: Selectable<PurchaseOrderItemTable>[] = [];
    if (linkedPoId) {
      poItems = await trx
        .selectFrom('purchase_order_items')
        .where('purchase_order_id', '=', linkedPoId)
        .where('tenant_id', '=', scope.tenantId)
        .selectAll()
        .execute();
    }

    // Fetch GRN lines if purchase is linked to GRN or PO
    let grnLines: Selectable<GoodsReceiptLineTable>[] = [];
    if (purchase.grn_id) {
      const header = await trx.selectFrom('goods_receipt_notes')
        .select(['id', 'purchase_order_id', 'supplier_id', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(purchase.grn_id))
        .forUpdate()
        .executeTakeFirst();
      if (!header || header.status !== 'posted' || Number(header.supplier_id) !== Number(purchase.supplier_id) ||
          Number(header.purchase_order_id || 0) !== Number(linkedPoId || 0)) {
        throw new BadRequestException('محضر الاستلام غير منشور أو لا يتبع المورد وأمر الشراء في الفاتورة.');
      }
      grnLines = await trx
        .selectFrom('goods_receipt_lines')
        .where('grn_id', '=', purchase.grn_id)
        .where('tenant_id', '=', scope.tenantId)
        .selectAll()
        .execute();
    } else if (linkedPoId) {
      const grns = await trx
        .selectFrom('goods_receipt_notes')
        .select('id')
        .where('purchase_order_id', '=', linkedPoId)
        .where('supplier_id', '=', Number(purchase.supplier_id))
        .where('status', '=', 'posted')
        .where(this.tenantPredicate(auth))
        .execute();
      const grnIds = grns.map((g) => Number(g.id));
      if (grnIds.length > 0) {
        grnLines = await trx
          .selectFrom('goods_receipt_lines')
          .where('grn_id', 'in', grnIds)
          .where(this.tenantPredicate(auth))
          .selectAll()
          .execute();
      }
    }

    // MATCH-1 requires the quantities already invoiced against this PO/GRN by OTHER purchase
    // invoices. Without it priorQty was always 0, so the same delivery could be billed and paid
    // an unlimited number of times — the precise fraud this invariant exists to prevent.
    let historicalInvoicedLines: Array<{ poItemId?: number; productId: number; qty: number }> = [];
    if (linkedPoId || purchase.grn_id) {
      let histQuery = trx
        .selectFrom('purchase_items as pi')
        .innerJoin('purchases as p', (join) => join.onRef('p.id', '=', 'pi.purchase_id').onRef('p.tenant_id', '=', 'pi.tenant_id'))
        .select(['pi.po_item_id', 'pi.product_id', 'pi.qty'])
        .where('p.tenant_id', '=', scope.tenantId)
        .where('p.id', '!=', purchaseId)
        .where('p.status', '!=', 'cancelled');

      histQuery = linkedPoId
        ? histQuery.where('p.po_id', '=', linkedPoId)
        : histQuery.where('p.grn_id', '=', Number(purchase.grn_id));

      const histRows = await histQuery.execute();
      historicalInvoicedLines = histRows.map((r) => ({
        poItemId: r.po_item_id ? Number(r.po_item_id) : undefined,
        productId: Number(r.product_id),
        qty: Number(r.qty || 0),
      }));
    }

    // Separation of duties: the person keying the invoice cannot clear their own block.
    // A full override (accepting goods never received) requires elevated authority.
    const requestedScope = dto.overrideScope === 'full' ? 'full' : 'price_only';
    if (dto.allowOverride) {
      const role = String(auth.role || '').trim();
      const canOverridePrice = ['admin', 'super_admin', 'manager', 'accountant'].includes(role);
      const canOverrideFull = ['admin', 'super_admin'].includes(role);
      if (!canOverridePrice || (requestedScope === 'full' && !canOverrideFull)) {
        throw new BadRequestException(
          'صلاحيتك لا تسمح بتجاوز نتيجة المطابقة الثلاثية بهذا النطاق. تجاوز فروق الكميات يتطلب اعتماد الإدارة.',
        );
      }
      if (!String(dto.overrideReason || '').trim()) {
        throw new BadRequestException('يجب توثيق سبب لتجاوز المطابقة الثلاثية.');
      }
    }

    // Build ThreeWayMatchInput
    const input: ThreeWayMatchInput = {
      historicalInvoicedLines,
      overrideScope: requestedScope,
      poItems: poItems.map((poi) => ({
        id: Number(poi.id),
        productId: Number(poi.product_id),
        qty: Number(poi.quantity || 0),
        unitCost: Number(poi.unit_cost || 0),
        isService: productTypes.get(Number(poi.product_id)) === 'service',
      })),
      grnLines: grnLines.map((gl) => ({
        id: Number(gl.id),
        grnId: Number(gl.grn_id),
        poItemId: gl.purchase_order_item_id ? Number(gl.purchase_order_item_id) : undefined,
        productId: Number(gl.product_id),
        receivedQty: Number(gl.received_qty || 0),
        acceptedQty: Number(gl.accepted_qty || 0),
        rejectedQty: Number(gl.rejected_qty || 0),
        unitCost: Number(gl.unit_cost || 0),
      })),
      invoiceItems: purchaseItems.map((pi) => ({
        id: Number(pi.id),
        poItemId: pi.po_item_id ? Number(pi.po_item_id) : undefined,
        grnLineId: pi.grn_line_id ? Number(pi.grn_line_id) : undefined,
        productId: Number(pi.product_id),
        qty: Number(pi.qty || 0),
        unitCost: Number(pi.unit_cost || 0),
      })),
      tolerancePercentage: dto.tolerancePercentage ?? tolerance,
      // The gate verifies the BILL's own VAT: its stored tax_rate
      // (percent) converted to the engine's fraction, and its
      // prices_include_tax flag so tax-inclusive lines extract VAT
      // instead of stacking a second VAT on top. The old call passed
      // no rate at all, so every bill was verified at the engine's
      // hardcoded 14% default.
      vatRate: Number(purchase.tax_rate || 0) / 100,
      pricesIncludeTax: Boolean(purchase.prices_include_tax),
      // The verification gate rounds to book precision; defaulting to 2 here
      // would reintroduce the GRNI loss inside the check that is supposed to
      // catch it. The engine throws on any other value.
      minorUnits: currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)),
      isServiceItem: allServices,
      serviceCompletionRef: dto.serviceCompletionRef,
      allowOverride: dto.allowOverride,
      overrideReason: dto.overrideReason,
    };

    const computedMatch = computeThreeWayMatch(input);

    // Real quantity variance instead of the hardcoded 0 that previously misrepresented every record.
    const qtyVariance = Number(
      computedMatch.lines
        .reduce((sum, l) => sum + Math.max(0, l.cumulativeInvoicedQty - l.acceptedGrnQty), 0)
        .toFixed(4),
    );

    // Both writes in one transaction: previously a failure between them left the match table and
    // the purchase header disagreeing about whether the invoice was matched.
      await trx
        .insertInto('purchase_three_way_matches')
        .values({
          tenant_id: scope.tenantId,
          purchase_id: purchaseId,
          purchase_order_id: linkedPoId,
          grn_id: purchase.grn_id || null,
          match_status: computedMatch.overallStatus,
          price_variance_amount: computedMatch.totalPpv,
          qty_variance_amount: qtyVariance,
          tolerance_percentage: computedMatch.tolerancePercentage,
          is_service_item: allServices,
          service_completion_ref: dto.serviceCompletionRef || null,
          override_approved_by: dto.allowOverride ? auth.userId : null,
          override_reason: dto.overrideReason || null,
          override_scope: dto.allowOverride ? requestedScope : null,
          blocking_codes: computedMatch.blockingCodes,
          reconciliation_discrepancy: computedMatch.reconciliationDiscrepancy,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'purchase_id']).doUpdateSet({
            purchase_order_id: linkedPoId,
            match_status: computedMatch.overallStatus,
            price_variance_amount: computedMatch.totalPpv,
            qty_variance_amount: qtyVariance,
            override_approved_by: dto.allowOverride ? auth.userId : null,
            override_reason: dto.overrideReason || null,
            override_scope: dto.allowOverride ? requestedScope : null,
            blocking_codes: computedMatch.blockingCodes,
            reconciliation_discrepancy: computedMatch.reconciliationDiscrepancy,
            updated_at: new Date(),
          }),
        )
        .execute();

      await trx
        .updateTable('purchases')
        .set({ three_way_match_status: computedMatch.overallStatus })
        .where('id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return computedMatch;
    });
    if (!matchResult.isValidForPosting) {
      throw new UnprocessableEntityException({
        message: 'لم تجتز الفاتورة المطابقة الثلاثية.',
        blockingCodes: matchResult.blockingCodes,
        blockingReasons: matchResult.blockingReasons,
      });
    }
    return matchResult;
  }
}
