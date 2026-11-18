import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Kysely, Selectable, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database, GoodsReceiptLineTable, PurchaseOrderItemTable } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { CreateGoodsReceiptDto, CreateGrnBillDto, VerifyThreeWayMatchDto } from '../dto/goods-receipt.dto';
import { computeThreeWayMatch, ThreeWayMatchInput } from '../three-way-match.engine';
import { allocateGrnAccrual, allocateGrniBillPortion } from '../engines/grni-settlement.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, roundMoney, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { GoodsReceiptPostService } from './goods-receipt-post.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { GoodsReceiptHelpersService } from './goods-receipt-helpers.service';
import { normalizeBillNumber } from '../engines/duplicate-bill-detector.engine';
import { GoodsReceiptCreateService } from './goods-receipt-create.service';

@Injectable()
export class GoodsReceiptService {
  private readonly helpersService: GoodsReceiptHelpersService;
  private readonly create: GoodsReceiptCreateService;
  private readonly post: GoodsReceiptPostService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
    private readonly purchasesFinance: PurchasesFinanceService,
  ) {
    this.helpersService = new GoodsReceiptHelpersService();
    this.create = new GoodsReceiptCreateService({
      db: this.db,
      validateGrnFreight: this.validateGrnFreight.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.post = new GoodsReceiptPostService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      tenantPredicate: this.tenantPredicate.bind(this),
      validateGrnFreight: this.validateGrnFreight.bind(this),
      getGoodsReceipt: this.getGoodsReceipt.bind(this),
      resolveAccountByCode: this.resolveAccountByCode.bind(this),
    });
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private async resolveAccountByCode(trx: any, tenantId: string, accountId: string, code: string): Promise<number | null> {
    return this.helpersService.resolveAccountByCode(trx, tenantId, accountId, code);
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
    return this.create.createGoodsReceipt(dto, auth);
  }

  async listGoodsReceipts(filter: { supplierId?: number; status?: string; search?: string }, auth: AuthContext): Promise<any> {
    return this.create.listGoodsReceipts(filter, auth);
  }

  async getGoodsReceipt(id: number, auth: AuthContext, externalTrx?: any): Promise<any> {
    return this.create.getGoodsReceipt(id, auth, externalTrx);
  }

  async postGoodsReceipt(id: number, auth: AuthContext): Promise<any> {
    return this.post.postGoodsReceipt(id, auth);
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
      const docNo = formatDailyDocumentNumber('ZP', purchaseId, new Date(), 6, await getTenantTimezone(trx, scope.tenantId));
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
