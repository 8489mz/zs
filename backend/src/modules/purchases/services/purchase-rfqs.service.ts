import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface CreateRfqDto {
  title: string;
  deadline_date?: string;
  expected_delivery_date?: string;
  notes?: string;
  items: Array<{
    product_id: number;
    product_name: string;
    unit_name?: string;
    target_quantity: number;
    specifications?: string;
  }>;
}

export interface SubmitSupplierBidDto {
  supplier_id: number;
  supplier_name: string;
  supplier_phone?: string;
  payment_terms?: string;
  delivery_lead_days?: number;
  notes?: string;
  item_bids: Array<{
    rfq_item_id: number;
    quoted_unit_cost: number;
    tax_rate?: number;
  }>;
}

import { getDailyDocumentPrefix } from '../../../common/utils/document-number.util';

@Injectable()
export class PurchaseRfqsService {
  private readonly logger = new Logger(PurchaseRfqsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private async generateRfqNumber(tenantId: string): Promise<string> {
    const prefix = getDailyDocumentPrefix('RFQ');
    const countResult = await this.db
      .selectFrom('purchase_rfqs')
      .select([sql<number>`count(*)::int`.as('count')])
      .where('tenant_id', '=', tenantId)
      .where('rfq_number', 'like', `${prefix}%`)
      .executeTakeFirst();

    const seq = (countResult?.count || 0) + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  async listRfqs(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const rfqs = await this.db
      .selectFrom('purchase_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    // Get item & supplier counts for each RFQ
    const itemCounts = await this.db
      .selectFrom('purchase_rfq_items')
      .select(['rfq_id', sql<number>`count(*)::int`.as('items_count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('rfq_id')
      .execute();

    const supplierCounts = await this.db
      .selectFrom('purchase_rfq_vendor_bids')
      .select(['rfq_id', sql<number>`count(distinct supplier_id)::int`.as('suppliers_count')])
      .where('tenant_id', '=', tenantId)
      .groupBy('rfq_id')
      .execute();

    const itemMap = new Map<number, number>();
    for (const row of itemCounts) itemMap.set(Number(row.rfq_id), Number(row.items_count));

    const supplierMap = new Map<number, number>();
    for (const row of supplierCounts) supplierMap.set(Number(row.rfq_id), Number(row.suppliers_count));

    return rfqs.map((rfq) => ({
      ...rfq,
      id: Number(rfq.id),
      items_count: itemMap.get(Number(rfq.id)) || 0,
      suppliers_count: supplierMap.get(Number(rfq.id)) || 0,
    }));
  }

  async getRfq(auth: AuthContext, id: number) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('purchase_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!rfq) {
      throw new NotFoundException('طلب عرض السعر غير موجود');
    }

    const items = await this.db
      .selectFrom('purchase_rfq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', '=', id)
      .orderBy('id', 'asc')
      .execute();

    const bids = await this.db
      .selectFrom('purchase_rfq_vendor_bids')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', '=', id)
      .execute();

    // Group bids by supplier to build the Comparison Matrix
    const supplierBidsMap = new Map<number, {
      supplier_id: number;
      supplier_name: string;
      supplier_phone: string | null;
      delivery_lead_days: number;
      payment_terms: string | null;
      is_winner: boolean;
      total_quote: number;
      item_quotes: Record<number, { quoted_unit_cost: number; tax_rate: number }>;
    }>();

    for (const bid of bids) {
      const sId = Number(bid.supplier_id);
      if (!supplierBidsMap.has(sId)) {
        supplierBidsMap.set(sId, {
          supplier_id: sId,
          supplier_name: bid.supplier_name,
          supplier_phone: bid.supplier_phone,
          delivery_lead_days: Number(bid.delivery_lead_days || 0),
          payment_terms: bid.payment_terms,
          is_winner: Boolean(bid.is_winner),
          total_quote: 0,
          item_quotes: {},
        });
      }

      const sData = supplierBidsMap.get(sId)!;
      const unitCost = Number(bid.quoted_unit_cost || 0);
      sData.item_quotes[Number(bid.rfq_item_id)] = {
        quoted_unit_cost: unitCost,
        tax_rate: Number(bid.tax_rate || 0),
      };

      // Find item quantity to accumulate total
      const it = items.find((i) => Number(i.id) === Number(bid.rfq_item_id));
      const qty = it ? Number(it.target_quantity || 1) : 1;
      sData.total_quote += unitCost * qty;
    }

    return {
      ...rfq,
      id: Number(rfq.id),
      items: items.map((it) => ({
        ...it,
        id: Number(it.id),
        target_quantity: Number(it.target_quantity || 1),
      })),
      comparison_matrix: Array.from(supplierBidsMap.values()),
    };
  }

  async createRfq(auth: AuthContext, dto: CreateRfqDto) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const accountId = scope.accountId;

    if (!dto.title || !dto.title.trim()) {
      throw new BadRequestException('عنوان طلب عرض السعر مطلوب');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('يجب إضافة صنف واحد على الأقل في طلب عرض السعر');
    }

    const rfqNumber = await this.generateRfqNumber(tenantId);

    return await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('purchase_rfqs')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          rfq_number: rfqNumber,
          title: dto.title.trim(),
          status: 'draft',
          deadline_date: dto.deadline_date ? (dto.deadline_date as any) : null,
          expected_delivery_date: dto.expected_delivery_date ? (dto.expected_delivery_date as any) : null,
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const item of dto.items) {
        await trx
          .insertInto('purchase_rfq_items')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rfq_id: Number(inserted.id),
            product_id: Number(item.product_id),
            product_name: item.product_name,
            unit_name: item.unit_name || 'قطعة',
            target_quantity: item.target_quantity || 1,
            specifications: item.specifications || null,
          })
          .execute();
      }

      return inserted;
    });
  }

  async submitSupplierBid(auth: AuthContext, rfqId: number, dto: SubmitSupplierBidDto) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const accountId = scope.accountId;

    const rfq = await this.db
      .selectFrom('purchase_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId)
      .executeTakeFirst();

    if (!rfq) {
      throw new NotFoundException('طلب عرض السعر غير موجود');
    }

    return await this.db.transaction().execute(async (trx) => {
      // Delete existing bids for this supplier on this RFQ
      await trx
        .deleteFrom('purchase_rfq_vendor_bids')
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', rfqId)
        .where('supplier_id', '=', dto.supplier_id)
        .execute();

      for (const itemBid of dto.item_bids) {
        await trx
          .insertInto('purchase_rfq_vendor_bids')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rfq_id: rfqId,
            rfq_item_id: itemBid.rfq_item_id,
            supplier_id: dto.supplier_id,
            supplier_name: dto.supplier_name,
            supplier_phone: dto.supplier_phone || null,
            quoted_unit_cost: itemBid.quoted_unit_cost || 0,
            tax_rate: itemBid.tax_rate || 0,
            delivery_lead_days: dto.delivery_lead_days || 0,
            payment_terms: dto.payment_terms || null,
            notes: dto.notes || null,
            is_winner: false,
          })
          .execute();
      }

      // Update RFQ status to bids_received if still draft
      if (rfq.status === 'draft') {
        await trx
          .updateTable('purchase_rfqs')
          .set({ status: 'bids_received', updated_at: sql`now()` })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', rfqId)
          .execute();
      }

      return { success: true };
    });
  }

  /**
   * Evaluates comparison matrix, marks winner supplier, and converts to a real Purchase Order!
   */
  async selectWinnerAndConvertToPo(auth: AuthContext, rfqId: number, supplierId: number) {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const accountId = scope.accountId;

    const rfq = await this.db
      .selectFrom('purchase_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId)
      .executeTakeFirst();

    if (!rfq) {
      throw new NotFoundException('طلب عرض السعر غير موجود');
    }

    const supplierBids = await this.db
      .selectFrom('purchase_rfq_vendor_bids')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', '=', rfqId)
      .where('supplier_id', '=', supplierId)
      .execute();

    if (supplierBids.length === 0) {
      throw new BadRequestException('لا توجد عروض مسجلة لهذا المورد');
    }

    const rfqItems = await this.db
      .selectFrom('purchase_rfq_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', '=', rfqId)
      .execute();

    return await this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      // 1. Mark winning bids
      await trx
        .updateTable('purchase_rfq_vendor_bids')
        .set({ is_winner: false })
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', rfqId)
        .execute();

      await trx
        .updateTable('purchase_rfq_vendor_bids')
        .set({ is_winner: true })
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', rfqId)
        .where('supplier_id', '=', supplierId)
        .execute();

      // 2. Calculate PO totals
      let subtotal = 0;
      let taxAmount = 0;
      const poItemsToInsert: Array<{
        product_id: number;
        product_name: string;
        unit_name: string | null;
        quantity: number;
        unit_cost: number;
        tax_rate: number;
        discount: number;
        total: number;
      }> = [];

      for (const item of rfqItems) {
        const bid = supplierBids.find((b) => Number(b.rfq_item_id) === Number(item.id));
        const unitCost = bid ? Number(bid.quoted_unit_cost) : 0;
        const taxRate = bid ? Number(bid.tax_rate || 0) : 0;
        const qty = Number(item.target_quantity || 1);
        const itemSubtotal = unitCost * qty;
        const itemTax = itemSubtotal * (taxRate / 100);
        const itemTotal = itemSubtotal + itemTax;

        subtotal += itemSubtotal;
        taxAmount += itemTax;

        poItemsToInsert.push({
          product_id: Number(item.product_id),
          product_name: item.product_name,
          unit_name: item.unit_name,
          quantity: qty,
          unit_cost: unitCost,
          tax_rate: taxRate,
          discount: 0,
          total: itemTotal,
        });
      }

      const totalAmount = subtotal + taxAmount;
      const winnerName = supplierBids[0]?.supplier_name || 'مورد معتمد';
      const winnerPhone = supplierBids[0]?.supplier_phone || null;

      // 3. Generate PO Number
      const year = new Date().getFullYear();
      const poCountRes = await trx
        .selectFrom('purchase_orders')
        .select([sql<number>`count(*)::int`.as('count')])
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const poSeq = (poCountRes?.count || 0) + 1;
      const poNumber = `PO-${year}-${String(poSeq).padStart(4, '0')}`;

      // 4. Create Purchase Order
      const createdPo = await trx
        .insertInto('purchase_orders')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          order_number: poNumber,
          supplier_id: supplierId,
          supplier_name: winnerName,
          supplier_phone: winnerPhone,
          subtotal: roundMoney(subtotal, moneyDigits),
          tax_amount: roundMoney(taxAmount, moneyDigits),
          discount_amount: 0,
          total_amount: roundMoney(totalAmount, moneyDigits),
          status: 'confirmed',
          expected_delivery_date: rfq.expected_delivery_date ? (rfq.expected_delivery_date as any) : null,
          notes: `تم توليده تلقائياً من طلب عرض السعر رقم: ${rfq.rfq_number} بعد المفاضلة واعتماد العرض الفائز.`,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 5. Insert PO Items
      for (const poItem of poItemsToInsert) {
        await trx
          .insertInto('purchase_order_items')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            purchase_order_id: Number(createdPo.id),
            product_id: poItem.product_id,
            product_name: poItem.product_name,
            unit_name: poItem.unit_name,
            quantity: poItem.quantity,
            received_quantity: 0,
            unit_cost: poItem.unit_cost,
            tax_rate: poItem.tax_rate,
            discount: 0,
            total: roundMoney(poItem.total, moneyDigits),
          })
          .execute();
      }

      // 6. Update RFQ status
      await trx
        .updateTable('purchase_rfqs')
        .set({
          status: 'converted_to_po',
          winning_supplier_id: supplierId,
          winning_supplier_name: winnerName,
          converted_po_id: Number(createdPo.id),
          updated_at: sql`now()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', rfqId)
        .execute();

      return {
        success: true,
        rfqId,
        purchaseOrderId: Number(createdPo.id),
        orderNumber: poNumber,
        winnerSupplierName: winnerName,
      };
    });
  }

  async deleteRfq(auth: AuthContext, id: number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('purchase_rfq_vendor_bids')
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', id)
        .execute();

      await trx
        .deleteFrom('purchase_rfq_items')
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', id)
        .execute();

      await trx
        .deleteFrom('purchase_rfqs')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();

      return { success: true };
    });
  }
}
