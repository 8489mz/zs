import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { checkClientBusinessDay, CLIENT_BUSINESS_DATE_PAST_DAYS } from '../../../common/utils/client-date-bounds.util';
import { CreateGoodsReceiptDto } from '../dto/goods-receipt.dto';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { assertGrnRequestedLocationScope } from '../engines/grn-location-policy.engine';

/**
 * GoodsReceiptCreateService — slice S1 of the goods-receipt split.
 * Pure move of the create/list/get surface from the facade. No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. The two pure kernel
 * helpers stay in the facade and are bound here through the Deps
 * interface. The receipt-date bound check travels with its method,
 * unchanged, with its tenant-timezone argument.
 */

export interface GoodsReceiptCreateDeps {
  db: Kysely<Database>;
  validateGrnFreight: (freight: number | undefined, moneyDigits: 2 | 3) => number;
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
}

@Injectable()
export class GoodsReceiptCreateService {
  private readonly db: Kysely<Database>;
  private readonly validateGrnFreight: (freight: number | undefined, moneyDigits: 2 | 3) => number;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;

  constructor(deps: GoodsReceiptCreateDeps) {
    this.db = deps.db;
    this.validateGrnFreight = deps.validateGrnFreight;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, auth: AuthContext): Promise<any> {
    const scope = requireTenantScope(auth);

    // Single-server-clock rule (P6, RC-5): the receipt date becomes the
    // GRNI journal entryDate, so a supplied receivedAt must fall inside
    // the tenant's recent window [today-7d, today] — an older or future
    // date is a tampered or mistaken date, not a receipt. Omitted stays
    // server-now (the existing default).
    if (dto.receivedAt) {
      const receivedDay = checkClientBusinessDay(dto.receivedAt, await getTenantTimezone(this.db, scope.tenantId), {
        minDayOffset: -CLIENT_BUSINESS_DATE_PAST_DAYS,
        maxDayOffset: 0,
      });
      if (!receivedDay.ok) {
        throw new BadRequestException('تاريخ الاستلام خارج النطاق المسموح (آخر 7 أيام حتى اليوم).');
      }
    }

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('يجب إدخال بند واحد على الأقل في إذن الاستلام.');
    }

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const freight = this.validateGrnFreight(dto.freight, moneyDigits);

    // Verify supplier exists
    const supplier = await this.db
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
    let location =
      locationId > 0
        ? await this.db
            .selectFrom('stock_locations')
            .select(['id', 'name'])
            .where('id', '=', locationId)
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst()
        : null;
    // Never silently reroute an explicitly requested warehouse. The old
    // fallback could create real stock and GRNI entries at the wrong location.
    assertGrnRequestedLocationScope(locationId, location);

    if (!location) {
      // 1. If PO is specified, check if the PO has a warehouse_id that belongs to tenant
      if (dto.purchaseOrderId) {
        const po = await this.db
          .selectFrom('purchase_orders')
          .select(['warehouse_id'])
          .where('id', '=', dto.purchaseOrderId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (po?.warehouse_id) {
          const poLoc = await this.db
            .selectFrom('stock_locations')
            .select(['id', 'name'])
            .where('id', '=', Number(po.warehouse_id))
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst();
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
    const products = await this.db
      .selectFrom('products')
      .select('id')
      .where('id', 'in', productIds)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
    if (products.length !== productIds.length) throw new NotFoundException('أحد أصناف إذن الاستلام لا يتبع المنشأة.');
    if (!dto.purchaseOrderId && dto.lines.some((line) => line.purchaseOrderItemId)) {
      throw new BadRequestException('يلزم تحديد أمر الشراء عند ربط أحد بنوده بإذن الاستلام.');
    }
    if (dto.purchaseOrderId && dto.lines.some((line) => Number(line.acceptedQty) > 0 && !line.purchaseOrderItemId)) {
      throw new BadRequestException('اربط كل كمية مقبولة ببند أمر الشراء حتى يمكن فوترتها وتسوية GRNI.');
    }
    const quarantineIds = [
      ...new Set(dto.lines.map((line) => Number(line.quarantineLocationId || 0)).filter((id) => id > 0)),
    ];
    if (quarantineIds.length) {
      const quarantineLocations = await this.db
        .selectFrom('stock_locations')
        .select(['id', 'location_type'])
        .where('id', 'in', quarantineIds)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      if (quarantineLocations.length !== quarantineIds.length)
        throw new NotFoundException('مكان الحجر لا يتبع المنشأة.');
      // INV-GRN-REAL-QUARANTINE: a quarantine pointer is only real
      // when the location is typed quarantine — any other type stays
      // sellable, so accepting it here would recreate the name-only
      // bug (goods entering normal sellable stock under a quarantine
      // label). Fail closed at creation, not at posting.
      if (quarantineLocations.some((loc) => String(loc.location_type || '') !== 'quarantine')) {
        throw new BadRequestException(
          'مكان الحجر يجب أن يكون مخزناً من نوع حجر صحي؛ لا يجوز تحويل مخزن بيع عادي إلى حجر.',
        );
      }
    }
    if (dto.purchaseOrderId) {
      const order = await this.db
        .selectFrom('purchase_orders')
        .select(['id', 'supplier_id', 'status'])
        .where('id', '=', dto.purchaseOrderId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (!order || Number(order.supplier_id) !== Number(dto.supplierId)) {
        throw new BadRequestException('أمر الشراء لا يتبع المورد المحدد في المنشأة.');
      }
      // INV-SPIRIT-GRN-PENDING-REVIEW: a draft (unapproved) order may
      // receive as a pending-review receipt — the draft is recorded at
      // post time and billing stays blocked until the order is
      // approved. Only a cancelled order (a deliberate stop) still
      // blocks receipt creation.
      if (
        !['draft', 'confirmed', 'partially_received', 'received', 'converted_to_bill'].includes(String(order.status))
      ) {
        throw new BadRequestException('لا يجوز الاستلام على أمر شراء ملغي أو غير معتمد');
      }
      const orderItemIds = [
        ...new Set(dto.lines.map((line) => Number(line.purchaseOrderItemId || 0)).filter((id) => id > 0)),
      ];
      if (orderItemIds.length) {
        const orderItems = await this.db
          .selectFrom('purchase_order_items')
          .select(['id', 'product_id'])
          .where('id', 'in', orderItemIds)
          .where('purchase_order_id', '=', order.id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
        const byId = new Map(orderItems.map((item) => [Number(item.id), Number(item.product_id)]));
        if (
          dto.lines.some(
            (line) => line.purchaseOrderItemId && byId.get(Number(line.purchaseOrderItemId)) !== Number(line.productId),
          )
        ) {
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
      await trx
        .updateTable('goods_receipt_notes')
        .set({
          doc_no: formatDailyDocumentNumber(
            'GRN',
            Number(grn.id),
            new Date(),
            4,
            await getTenantTimezone(trx, scope.tenantId),
          ),
        })
        .where('id', '=', Number(grn.id))
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      const lineValues = dto.lines.map((l) => {
        const received = Number(l.receivedQty || 0);
        const accepted = Number(l.acceptedQty || 0);
        const rejected = Number(l.rejectedQty || 0);

        if (Math.abs(received - (accepted + rejected)) > 0.001) {
          throw new BadRequestException(
            `إجمالي الكمية المستلمة (${received}) يجب أن يساوي المقبول (${accepted}) + المرفوض (${rejected}).`,
          );
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

  async listGoodsReceipts(
    filter: { supplierId?: number; status?: string; search?: string },
    auth: AuthContext,
  ): Promise<any> {
    let query = this.db
      .selectFrom('goods_receipt_notes as g')
      .leftJoin('suppliers as s', (join: any) =>
        join.onRef('s.id', '=', 'g.supplier_id').onRef('s.tenant_id', '=', 'g.tenant_id'),
      )
      .leftJoin('purchase_orders as po', (join: any) =>
        join.onRef('po.id', '=', 'g.purchase_order_id').onRef('po.tenant_id', '=', 'g.tenant_id'),
      )
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
    const q = externalTrx || this.db;

    const grn = await q
      .selectFrom('goods_receipt_notes as g')
      .leftJoin('suppliers as s', (join: any) =>
        join.onRef('s.id', '=', 'g.supplier_id').onRef('s.tenant_id', '=', 'g.tenant_id'),
      )
      .leftJoin('purchase_orders as po', (join: any) =>
        join.onRef('po.id', '=', 'g.purchase_order_id').onRef('po.tenant_id', '=', 'g.tenant_id'),
      )
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
      .leftJoin('products as p', (join: any) =>
        join.onRef('p.id', '=', 'gl.product_id').onRef('p.tenant_id', '=', 'gl.tenant_id'),
      )
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
}
