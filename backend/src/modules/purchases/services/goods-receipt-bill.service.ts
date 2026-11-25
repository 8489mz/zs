import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type Kysely } from '../../../database/kysely';
import { type Database } from '../../../database/database.types';
import { type AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { CreateGrnBillDto } from '../dto/goods-receipt.dto';
import { allocateGrnAccrual, allocateGrniBillPortion } from '../engines/grni-settlement.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  fromMinorUnits,
  roundMoney,
  toMinorUnits,
} from '../../accounting/engines/money-minor-units.engine';
import { type AccountingPostingService } from '../../accounting/accounting-posting.service';
import { type PurchasesFinanceService } from './purchases-finance.service';
import { normalizeBillNumber } from '../engines/duplicate-bill-detector.engine';

/**
 * GoodsReceiptBillService — slice S3 of the goods-receipt split.
 * Pure move of the supplier-billing flow from the goods-receipt
 * service. No behavior change: the body is byte-identical; the
 * facade keeps a thin public delegate with the same name and
 * signature. This slice reaches the sibling slice only through
 * a bound dep — it never imports another slice service.
 */

export interface GoodsReceiptBillDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  purchasesFinance: PurchasesFinanceService;
  // Bound facade delegate (S0; bound from the facade itself, so this
  // slice is independent of merge order).
  resolveAccountByCode: (trx: any, tenantId: string, accountId: string, code: string) => Promise<number | null>;
}

@Injectable()
export class GoodsReceiptBillService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly purchasesFinance: PurchasesFinanceService;
  private readonly resolveAccountByCode: (
    trx: any,
    tenantId: string,
    accountId: string,
    code: string,
  ) => Promise<number | null>;

  constructor(deps: GoodsReceiptBillDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.purchasesFinance = deps.purchasesFinance;
    this.resolveAccountByCode = deps.resolveAccountByCode;
  }

  /** Invoice previously posted receipts without adding physical stock a second time. */
  async createBillFromReceipts(
    dto: CreateGrnBillDto,
    auth: AuthContext,
  ): Promise<{ purchaseId: number; docNo: string }> {
    const scope = requireTenantScope(auth);
    const invoiceNo = normalizeBillNumber(dto.supplierInvoiceNo);
    if (!invoiceNo || !Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('حدد رقم فاتورة المورد وبنود محاضر الاستلام');
    }
    const requestedIds = dto.lines.map((line) => Number(line.grnLineId));
    if (
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new BadRequestException('لا يجوز تكرار سطر محضر الاستلام في الفاتورة');
    }
    return this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const po = await trx
        .selectFrom('purchase_orders')
        .select(['id', 'supplier_id', 'status'])
        .where('id', '=', dto.purchaseOrderId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
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
      const supplier = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('id', '=', dto.supplierId)
        .where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!supplier) throw new NotFoundException('المورد غير موجود أو غير نشط');
      const existingInvoices = await trx
        .selectFrom('purchases')
        .select(['id', 'supplier_invoice_no'])
        .where('tenant_id', '=', scope.tenantId)
        .where('supplier_id', '=', dto.supplierId)
        .where('status', '!=', 'cancelled')
        .where('supplier_invoice_no', 'is not', null)
        .execute();
      if (existingInvoices.some((bill) => normalizeBillNumber(bill.supplier_invoice_no) === invoiceNo)) {
        throw new UnprocessableEntityException('رقم فاتورة المورد مسجل بالفعل لهذا المورد.');
      }
      const directBill = await trx
        .selectFrom('purchases')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('po_id', '=', dto.purchaseOrderId)
        .where('status', '!=', 'cancelled')
        .where((eb) => eb.or([eb('lifecycle_status', 'is', null), eb('lifecycle_status', '!=', 'grn_bill')]))
        .limit(1)
        .executeTakeFirst();
      if (directBill)
        throw new UnprocessableEntityException(
          'أمر الشراء مرتبط بفاتورة مباشرة سابقة؛ ألغِ المسودة أو سوِّ الفاتورة المنشورة قبل فواتير GRN',
        );

      const references = await trx
        .selectFrom('goods_receipt_lines')
        .select(['id', 'grn_id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', requestedIds)
        .execute();
      if (references.length !== requestedIds.length) throw new NotFoundException('أحد سطور الاستلام غير موجود');
      const grnIds = [...new Set(references.map((line) => Number(line.grn_id)))].sort((a, b) => a - b);
      const headers = await trx
        .selectFrom('goods_receipt_notes')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', grnIds)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (
        headers.length !== grnIds.length ||
        headers.some(
          (header) =>
            header.status !== 'posted' ||
            Number(header.supplier_id) !== Number(dto.supplierId) ||
            Number(header.purchase_order_id) !== Number(dto.purchaseOrderId) ||
            !header.grni_journal_entry_id,
        )
      ) {
        throw new UnprocessableEntityException(
          'كل محاضر الاستلام يجب أن تكون منشورة وعلى نفس أمر الشراء والمورد ولها قيد GRNI',
        );
      }
      const receiptLines = await trx
        .selectFrom('goods_receipt_lines')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('grn_id', 'in', grnIds)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      const receiptLineById = new Map(receiptLines.map((line) => [Number(line.id), line]));
      const accrualByLine = new Map<number, number>();
      for (const grnId of grnIds) {
        const portions = allocateGrnAccrual(
          receiptLines
            .filter((line) => Number(line.grn_id) === grnId)
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
            }),
          moneyDigits,
        );
        for (const [lineId, minor] of portions) accrualByLine.set(lineId, minor);
      }
      const poItems = await trx
        .selectFrom('purchase_order_items')
        .select(['id', 'product_id', 'product_name', 'unit_name', 'unit_cost'])
        .where('tenant_id', '=', scope.tenantId)
        .where('purchase_order_id', '=', dto.purchaseOrderId)
        .execute();
      const poItemById = new Map(poItems.map((item) => [Number(item.id), item]));
      const toleranceSetting = await trx
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', scope.tenantId)
        .where('key', '=', 'purchaseThreeWayTolerancePercent')
        .executeTakeFirst();
      let tolerancePercent = 2;
      if (toleranceSetting) {
        try {
          tolerancePercent = Number(JSON.parse(toleranceSetting.value));
        } catch {
          tolerancePercent = Number(toleranceSetting.value);
        }
      }
      if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
        throw new UnprocessableEntityException('نسبة تسامح المطابقة في إعدادات المنشأة غير صالحة');
      }
      const history = await trx
        .selectFrom('purchase_items as pi')
        .innerJoin('purchases as p', (join) =>
          join.onRef('p.id', '=', 'pi.purchase_id').onRef('p.tenant_id', '=', 'pi.tenant_id'),
        )
        .select(['pi.grn_line_id', 'pi.qty', 'pi.grni_amount'])
        .where('pi.tenant_id', '=', scope.tenantId)
        .where('pi.grn_line_id', 'in', requestedIds)
        .where('p.status', '!=', 'cancelled')
        .execute();
      const previous = new Map<number, { qty: number; minor: number }>();
      for (const line of history) {
        if (line.grni_amount == null)
          throw new UnprocessableEntityException(
            'فاتورة قديمة مرتبطة بالاستلام تحتاج تسوية GRNI قبل إصدار فاتورة أخرى',
          );
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
        const poItem = receipt?.purchase_order_item_id
          ? poItemById.get(Number(receipt.purchase_order_item_id))
          : undefined;
        const qty = Number(request.qty);
        const unitCost = Number(request.unitCost);
        if (
          !receipt ||
          !poItem ||
          Number(poItem.product_id) !== Number(receipt.product_id) ||
          !Number.isFinite(qty) ||
          qty <= 0 ||
          Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001 ||
          !Number.isFinite(unitCost) ||
          unitCost <= 0
        ) {
          throw new UnprocessableEntityException('سطر الفاتورة لا يطابق صنف ومحضر وأمر الشراء أو كمية/تكلفة صحيحة');
        }
        const orderedCost = Number(poItem.unit_cost);
        if (
          !Number.isFinite(orderedCost) ||
          orderedCost <= 0 ||
          unitCost > orderedCost * (1 + tolerancePercent / 100) + 0.000001
        ) {
          throw new UnprocessableEntityException(
            'سعر فاتورة المورد يتجاوز السعر المتفق عليه ونسبة التسامح؛ يتطلب اعتماد فرق السعر قبل الترحيل',
          );
        }
        const prior = previous.get(Number(receipt.id)) || { qty: 0, minor: 0 };
        const accruedMinor = allocateGrniBillPortion({
          lineAccrualMinor: accrualByLine.get(Number(receipt.id)) || 0,
          acceptedQty: Number(receipt.accepted_qty),
          previouslyBilledQty: prior.qty,
          previouslyClearedMinor: prior.minor,
          newQty: qty,
        });
        return {
          receipt,
          poItem,
          qty,
          unitCost,
          grniAmount: fromMinorUnits(accruedMinor, moneyDigits),
          lineTotal: roundMoney(qty * unitCost, moneyDigits),
        };
      });
      const subtotal = roundMoney(
        prepared.reduce((sum, line) => sum + line.lineTotal, 0),
        moneyDigits,
      );
      const taxAmount = Number(dto.taxAmount || 0);
      if (
        subtotal <= 0 ||
        !Number.isFinite(taxAmount) ||
        taxAmount < 0 ||
        Math.abs(taxAmount - roundMoney(taxAmount, moneyDigits)) > 0.000000001
      ) {
        throw new UnprocessableEntityException('قيمة الفاتورة أو الضريبة غير صالحة');
      }
      const total = roundMoney(subtotal + taxAmount, moneyDigits);
      const firstHeader = headers[0];
      const inserted = await trx
        .insertInto('purchases')
        .values({
          doc_no: 'TMP',
          supplier_id: dto.supplierId,
          payment_type: 'credit',
          subtotal,
          discount: 0,
          tax_rate: 0,
          tax_amount: taxAmount,
          prices_include_tax: false,
          total,
          note: `فاتورة محاضر استلام ${grnIds.join(', ')}`,
          status: 'posted',
          lifecycle_status: 'grn_bill',
          matched_status: 'matched',
          three_way_match_status: 'matched',
          po_id: dto.purchaseOrderId,
          grn_id: grnIds.length === 1 ? grnIds[0] : null,
          supplier_invoice_no: invoiceNo,
          branch_id: null,
          location_id: grnIds.length === 1 ? Number(firstHeader.location_id) : null,
          created_by: auth.userId,
          cancelled_at: null,
          cancelled_by: null,
          required_date: null,
          contact_id: null,
          shipping_address_id: null,
          cost_center_id: null,
          project_id: null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const purchaseId = Number(inserted.id);
      const docNo = formatDailyDocumentNumber(
        'ZP',
        purchaseId,
        new Date(),
        6,
        await getTenantTimezone(trx, scope.tenantId),
      );
      await trx
        .updateTable('purchases')
        .set({ doc_no: docNo })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', purchaseId)
        .execute();
      for (const line of prepared) {
        await trx
          .insertInto('purchase_items')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            purchase_id: purchaseId,
            po_item_id: Number(line.poItem.id),
            grn_line_id: Number(line.receipt.id),
            grni_amount: line.grniAmount,
            product_id: Number(line.receipt.product_id),
            product_name: line.poItem.product_name,
            qty: line.qty,
            unit_cost: line.unitCost,
            line_total: line.lineTotal,
            unit_name: line.poItem.unit_name || 'قطعة',
            unit_multiplier: 1,
            category_id: null,
            location_id: Number(
              headers.find((header) => Number(header.id) === Number(line.receipt.grn_id))!.location_id,
            ),
            received_qty: line.qty,
          })
          .execute();
      }
      await this.purchasesFinance.addSupplierLedgerEntry(
        trx,
        dto.supplierId,
        total,
        'purchase_credit',
        `فاتورة شراء من محاضر استلام ${docNo}`,
        'purchase',
        purchaseId,
        auth,
        null,
        grnIds.length === 1 ? Number(firstHeader.location_id) : null,
      );
      await this.resolveAccountByCode(trx, scope.tenantId, scope.accountId, '5190');
      await this.accountingPosting.postPurchase(trx, purchaseId, auth);
      return { purchaseId, docNo };
    });
  }
}
